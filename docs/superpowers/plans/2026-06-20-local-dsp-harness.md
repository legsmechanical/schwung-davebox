# Local DSP Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native (macOS, no Docker) test/debug harness that compiles the davebox DSP and drives it through its real `plugin_api_v2` ABI with a stub host, capturing emitted MIDI, param round-trips, and state serialization — so DSP logic can be exercised and debugged without deploying to the Move.

**Architecture:** A reusable foundation under `tests/harness/` (stub host with process-global MIDI capture, a macOS `fmemopen` shim, and a white-box test API that `#include`s the single `seq8.c` translation unit) plus small per-scenario `test_*.c` files, each compiled to its own binary by `tests/run.sh`. The first scenario (`test_smoke.c`) validates all four observability surfaces.

**Tech Stack:** C11, `clang`, plain shell runner. No Docker, no external deps. White-box access via `#include "seq8.c"`.

Design spec: `docs/superpowers/specs/2026-06-20-local-dsp-harness-design.md`.

**Branch:** `local-dsp-harness` (already created off `main`).

**Commit trailer:** every commit in this plan ends with:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh
```

## File Structure

| File | Responsibility |
|------|----------------|
| `tests/harness/compat.h` | macOS `fmemopen` prototype (guarded `__APPLE__`); any other portability declarations. |
| `tests/harness/compat.c` | macOS `fmemopen` implementation via `funopen`. |
| `tests/harness/stub_host.h` | Capture types + stub-host API (build host, reset/query capture, set bpm, read log). |
| `tests/harness/stub_host.c` | `host_api_v1_t` builder; process-global MIDI capture rings; `seq8_ilog` log buffer; configurable bpm. |
| `tests/harness/harness.h` | White-box test API; `#include`s `compat.h`, `stub_host.h`, and `../../dsp/seq8.c`; `hx_*` helpers + `HX_ASSERT`. |
| `tests/test_smoke.c` | First scenario: exercises MIDI capture, param round-trip, time advance, state serialize/restore. |
| `tests/run.sh` | Compile each `test_*.c` (link `stub_host.c` + `compat.c`) and run; print PASS/FAIL summary. |
| `tests/README.md` | How to run; how to add a scenario. |

---

### Task 1: macOS `fmemopen` shim + native compile probe

De-risks the single known portability landmine (`seq8.c:9370` calls glibc-only `fmemopen`) and proves the 5000-line TU compiles natively before any harness is built.

**Files:**
- Create: `tests/harness/compat.h`
- Create: `tests/harness/compat.c`
- Create (temporary): `tests/harness/_probe.c`

- [ ] **Step 1: Write `compat.h`**

```c
/* tests/harness/compat.h — host-machine portability shims for building the
 * davebox DSP off-device. */
#ifndef HX_COMPAT_H
#define HX_COMPAT_H

#include <stdio.h>
#include <stddef.h>

#ifdef __APPLE__
/* macOS libc has no fmemopen(); provided by compat.c via funopen(). */
FILE *fmemopen(void *buf, size_t size, const char *mode);
#endif

#endif /* HX_COMPAT_H */
```

- [ ] **Step 2: Write `compat.c`**

```c
/* tests/harness/compat.c */
#include "compat.h"

#ifdef __APPLE__
#include <stdlib.h>
#include <string.h>

struct hx_fmem { char *buf; size_t size; size_t pos; };

static int hx_fmem_write(void *c, const char *data, int n) {
    struct hx_fmem *m = (struct hx_fmem *)c;
    size_t avail = (m->pos < m->size) ? (m->size - m->pos) : 0;
    size_t k = ((size_t)n < avail) ? (size_t)n : avail;
    memcpy(m->buf + m->pos, data, k);
    m->pos += k;
    if (m->pos < m->size) m->buf[m->pos] = '\0'; /* keep NUL-terminated */
    return (int)k;
}
static int hx_fmem_read(void *c, char *data, int n) {
    struct hx_fmem *m = (struct hx_fmem *)c;
    size_t avail = (m->pos < m->size) ? (m->size - m->pos) : 0;
    size_t k = ((size_t)n < avail) ? (size_t)n : avail;
    memcpy(data, m->buf + m->pos, k);
    m->pos += k;
    return (int)k;
}
static fpos_t hx_fmem_seek(void *c, fpos_t off, int whence) {
    struct hx_fmem *m = (struct hx_fmem *)c;
    size_t base = (whence == SEEK_CUR) ? m->pos
                : (whence == SEEK_END) ? m->size : 0;
    m->pos = base + (size_t)off;
    return (fpos_t)m->pos;
}
static int hx_fmem_close(void *c) { free(c); return 0; }

FILE *fmemopen(void *buf, size_t size, const char *mode) {
    struct hx_fmem *m = (struct hx_fmem *)calloc(1, sizeof(*m));
    if (!m) return NULL;
    m->buf = (char *)buf; m->size = size; m->pos = 0;
    int writing = (strchr(mode, 'w') != NULL);
    if (writing && size > 0) ((char *)buf)[0] = '\0';
    return funopen(m,
                   writing ? NULL : hx_fmem_read,
                   writing ? hx_fmem_write : NULL,
                   hx_fmem_seek, hx_fmem_close);
}
#endif /* __APPLE__ */
```

- [ ] **Step 3: Write the temporary compile probe `tests/harness/_probe.c`**

```c
/* tests/harness/_probe.c — TEMPORARY. Proves seq8.c compiles + links natively
 * and that create/destroy work with a bare host. Deleted at end of Task 1. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "compat.h"            /* fmemopen decl before seq8.c uses it */
#include "host/plugin_api_v1.h"

static void probe_log(const char *m) { (void)m; }
static int  probe_send(const uint8_t *m, int n) { (void)m; return n; }
static int  probe_inject(const uint8_t *m, int n) { (void)m; return n; }
static float probe_bpm(void) { return 120.0f; }

#include "../../dsp/seq8.c"   /* white-box: brings in move_plugin_init_v2 */

int main(void) {
    host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    host.api_version       = MOVE_PLUGIN_API_VERSION_2;
    host.sample_rate       = MOVE_SAMPLE_RATE;
    host.frames_per_block  = MOVE_FRAMES_PER_BLOCK;
    host.log               = probe_log;
    host.midi_send_internal = probe_send;
    host.midi_send_external = probe_send;
    host.midi_inject_to_move = probe_inject;
    host.get_bpm           = probe_bpm;

    plugin_api_v2_t *api = move_plugin_init_v2(&host);
    if (!api) { fprintf(stderr, "FAIL: move_plugin_init_v2 returned NULL\n"); return 1; }
    void *inst = api->create_instance(".", NULL);
    if (!inst) { fprintf(stderr, "FAIL: create_instance returned NULL\n"); return 1; }
    api->destroy_instance(inst);
    printf("PROBE OK\n");
    return 0;
}
```

- [ ] **Step 4: Compile and run the probe**

Run (from repo root `schwung-davebox/`):
```bash
clang -std=c11 -Idsp -Itests/harness -Wall -Wno-unused-function -g \
  tests/harness/_probe.c tests/harness/compat.c -o /tmp/davebox_probe && /tmp/davebox_probe
```
Expected: `PROBE OK`.

If compilation fails with errors **beyond** `fmemopen` (e.g. another glibc-only symbol), add the minimal prototype/shim to `compat.h`/`compat.c` guarded by `#ifdef __APPLE__`, and note it in `compat.h` with a one-line comment. Re-run until `PROBE OK`. Do not modify `dsp/seq8.c` or `dsp/seq8_set_param.c`.

- [ ] **Step 5: Delete the probe and commit**

```bash
rm tests/harness/_probe.c
git add tests/harness/compat.h tests/harness/compat.c
git commit -m "test(harness): macOS fmemopen shim; davebox DSP compiles natively

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh"
```

---

### Task 2: Stub host with MIDI capture, log buffer, bpm

The host callbacks (`midi_send_internal/external`, `midi_inject_to_move`, `get_bpm`, `log`) are context-free, so capture state is a process-global in this TU. One harness drives one instance at a time.

**Files:**
- Create: `tests/harness/stub_host.h`
- Create: `tests/harness/stub_host.c`

- [ ] **Step 1: Write `stub_host.h`**

```c
/* tests/harness/stub_host.h — stub host + capture API. */
#ifndef HX_STUB_HOST_H
#define HX_STUB_HOST_H

#include <stdint.h>
#include "host/plugin_api_v1.h"

typedef enum {
    HX_MIDI_INTERNAL = 0,
    HX_MIDI_EXTERNAL = 1,
    HX_MIDI_INJECT   = 2
} hx_midi_kind;

typedef struct {
    hx_midi_kind kind;
    uint8_t bytes[4];   /* USB-MIDI packet [cable|CIN, status, d1, d2] */
    int len;
} hx_midi_event;

/* Returns a configured, process-global host (sample_rate, log, all MIDI
 * sends, get_bpm wired to capture/config). */
host_api_v1_t *hx_stub_host(void);

/* Capture control + queries (ordered across all three MIDI channels). */
void                  hx_stub_reset_capture(void);
int                   hx_stub_event_count(void);
const hx_midi_event  *hx_stub_event(int i);      /* NULL if out of range */
int                   hx_stub_count_kind(hx_midi_kind k);

/* Config + introspection. */
void        hx_stub_set_bpm(float bpm);
const char *hx_stub_log_text(void);              /* accumulated seq8_ilog output */

#endif /* HX_STUB_HOST_H */
```

- [ ] **Step 2: Write `stub_host.c`**

```c
/* tests/harness/stub_host.c */
#include "stub_host.h"
#include <string.h>

#define HX_CAP_MAX  8192
#define HX_LOG_MAX  65536

static hx_midi_event g_events[HX_CAP_MAX];
static int           g_event_count;
static char          g_log[HX_LOG_MAX];
static size_t        g_log_len;
static float         g_bpm = 120.0f;

static void push_event(hx_midi_kind kind, const uint8_t *msg, int len) {
    if (g_event_count >= HX_CAP_MAX) return;
    hx_midi_event *e = &g_events[g_event_count++];
    e->kind = kind;
    e->len = (len > 4) ? 4 : len;
    memset(e->bytes, 0, sizeof(e->bytes));
    memcpy(e->bytes, msg, (size_t)e->len);
}

static void  stub_log(const char *m) {
    if (!m) return;
    size_t n = strlen(m);
    if (g_log_len + n + 1 >= HX_LOG_MAX) return;
    memcpy(g_log + g_log_len, m, n);
    g_log_len += n;
    g_log[g_log_len++] = '\n';
    g_log[g_log_len] = '\0';
}
static int   stub_internal(const uint8_t *m, int n) { push_event(HX_MIDI_INTERNAL, m, n); return n; }
static int   stub_external(const uint8_t *m, int n) { push_event(HX_MIDI_EXTERNAL, m, n); return n; }
static int   stub_inject(const uint8_t *m, int n)   { push_event(HX_MIDI_INJECT,   m, n); return n; }
static float stub_get_bpm(void) { return g_bpm; }

host_api_v1_t *hx_stub_host(void) {
    static host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    host.api_version        = MOVE_PLUGIN_API_VERSION_2;
    host.sample_rate        = MOVE_SAMPLE_RATE;
    host.frames_per_block   = MOVE_FRAMES_PER_BLOCK;
    host.log                = stub_log;
    host.midi_send_internal = stub_internal;
    host.midi_send_external = stub_external;
    host.midi_inject_to_move = stub_inject;
    host.get_bpm            = stub_get_bpm;
    return &host;
}

void                 hx_stub_reset_capture(void) { g_event_count = 0; g_log_len = 0; g_log[0] = '\0'; }
int                  hx_stub_event_count(void)   { return g_event_count; }
const hx_midi_event *hx_stub_event(int i)        { return (i >= 0 && i < g_event_count) ? &g_events[i] : NULL; }
int                  hx_stub_count_kind(hx_midi_kind k) {
    int c = 0; for (int i = 0; i < g_event_count; i++) if (g_events[i].kind == k) c++; return c;
}
void                 hx_stub_set_bpm(float bpm)  { g_bpm = bpm; }
const char          *hx_stub_log_text(void)      { return g_log; }
```

- [ ] **Step 3: Verify it compiles standalone**

Run:
```bash
clang -std=c11 -Idsp -Itests/harness -Wall -c tests/harness/stub_host.c -o /tmp/stub_host.o && echo "COMPILE OK"
```
Expected: `COMPILE OK`.

- [ ] **Step 4: Commit**

```bash
git add tests/harness/stub_host.h tests/harness/stub_host.c
git commit -m "test(harness): stub host with ordered MIDI capture, log buffer, bpm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh"
```

---

### Task 3: White-box test API (`harness.h`)

**Files:**
- Create: `tests/harness/harness.h`

- [ ] **Step 1: Write `harness.h`**

```c
/* tests/harness/harness.h — white-box test API for the davebox DSP.
 * Each test_*.c that includes this gets its own copy of the seq8.c TU and
 * thus full access to its instance struct and static functions. */
#ifndef HX_HARNESS_H
#define HX_HARNESS_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "compat.h"          /* fmemopen decl BEFORE seq8.c uses it */
#include "stub_host.h"
#include "../../dsp/seq8.c"  /* white-box: defines move_plugin_init_v2 + statics */

typedef struct {
    plugin_api_v2_t *api;
    void *inst;             /* cast to the davebox instance type for white-box reads */
} hx_t;

#define HX_ASSERT(cond, msg) do { \
    if (!(cond)) { fprintf(stderr, "FAIL: %s (%s:%d)\n", (msg), __FILE__, __LINE__); exit(1); } \
} while (0)

static inline hx_t *hx_create(const char *json_defaults) {
    static hx_t h;
    host_api_v1_t *host = hx_stub_host();
    h.api = move_plugin_init_v2(host);
    if (!h.api) return NULL;
    hx_stub_reset_capture();
    h.inst = h.api->create_instance(".", json_defaults);
    return h.inst ? &h : NULL;
}
static inline void hx_destroy(hx_t *h) {
    if (h && h->api && h->inst) h->api->destroy_instance(h->inst);
}

static inline void hx_send_midi(hx_t *h, const uint8_t *msg, int len, int source) {
    h->api->on_midi(h->inst, msg, len, source);
}
static inline void hx_set_param(hx_t *h, const char *key, const char *val) {
    h->api->set_param(h->inst, key, val);
}
static inline int hx_get_param(hx_t *h, const char *key, char *buf, int len) {
    return h->api->get_param(h->inst, key, buf, len);
}
/* Last rendered audio block, retained for assertion. davebox renders silence,
 * so this is plumbing-only here — present so the harness can be lifted to an
 * audio module (osirus/jv880/obxd) without restructuring (see spec, reuse). */
static int16_t hx_last_block[MOVE_FRAMES_PER_BLOCK * 2];

static inline void hx_render(hx_t *h, int n_blocks) {
    for (int i = 0; i < n_blocks; i++)
        h->api->render_block(h->inst, hx_last_block, MOVE_FRAMES_PER_BLOCK);
}
/* Pointer to the most recently rendered stereo-interleaved block
 * ([L0,R0,...,L127,R127]); valid after at least one hx_render(). */
static inline const int16_t *hx_last_audio(void) { return hx_last_block; }

static inline void hx_set_bpm(hx_t *h, float bpm) { (void)h; hx_stub_set_bpm(bpm); }

/* Capture helpers. */
static inline void hx_clear_capture(hx_t *h) { (void)h; hx_stub_reset_capture(); }
static inline int  hx_count_midi(hx_t *h, hx_midi_kind k) { (void)h; return hx_stub_count_kind(k); }

static inline void hx_dump_midi(hx_t *h) {
    (void)h;
    int n = hx_stub_event_count();
    fprintf(stderr, "--- MIDI capture (%d events) ---\n", n);
    for (int i = 0; i < n; i++) {
        const hx_midi_event *e = hx_stub_event(i);
        fprintf(stderr, "[%d] kind=%d  %02x %02x %02x %02x\n",
                i, e->kind, e->bytes[0], e->bytes[1], e->bytes[2], e->bytes[3]);
    }
}

/* True if any captured packet is a note-on (status 0x9n, velocity>0) on the
 * given channel (0-15) and note number. */
static inline int hx_seen_note_on(hx_t *h, int ch, int note) {
    (void)h;
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if ((e->bytes[1] & 0xF0) == 0x90 && (e->bytes[1] & 0x0F) == ch
            && e->bytes[2] == (uint8_t)note && e->bytes[3] > 0)
            return 1;
    }
    return 0;
}

#endif /* HX_HARNESS_H */
```

- [ ] **Step 2: Verify it includes cleanly**

Run (compiles a throwaway TU that just includes the header):
```bash
printf '#include "harness.h"\nint main(void){ return hx_create(NULL) ? 0 : 1; }\n' > /tmp/hx_inc.c
clang -std=c11 -Idsp -Itests/harness -Wall -Wno-unused-function -g \
  /tmp/hx_inc.c tests/harness/stub_host.c tests/harness/compat.c -o /tmp/hx_inc && /tmp/hx_inc && echo "INCLUDE OK"
```
Expected: `INCLUDE OK`.

- [ ] **Step 3: Commit**

```bash
git add tests/harness/harness.h
git commit -m "test(harness): white-box hx_* test API over seq8.c

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh"
```

---

### Task 4: Test runner (`run.sh`)

**Files:**
- Create: `tests/run.sh`

- [ ] **Step 1: Write `tests/run.sh`**

```bash
#!/usr/bin/env bash
# Compile and run every tests/test_*.c natively. No Docker.
set -u
cd "$(dirname "$0")/.." || exit 2   # repo root (schwung-davebox/)

CC="${CC:-clang}"
FLAGS="-std=c11 -Idsp -Itests/harness -Wall -Wno-unused-function -g"
OUT="/tmp/davebox-tests"
mkdir -p "$OUT"

pass=0; fail=0
shopt -s nullglob
for t in tests/test_*.c; do
    name="$(basename "$t" .c)"
    bin="$OUT/$name"
    log="$OUT/$name.build.log"
    if ! $CC $FLAGS "$t" tests/harness/stub_host.c tests/harness/compat.c -o "$bin" 2> "$log"; then
        echo "BUILD FAIL: $name"; cat "$log"; fail=$((fail+1)); continue
    fi
    if "$bin"; then echo "PASS: $name"; pass=$((pass+1)); else echo "FAIL: $name"; fail=$((fail+1)); fi
done
echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
```

- [ ] **Step 2: Make it executable; verify it runs with no tests yet**

Run:
```bash
chmod +x tests/run.sh && tests/run.sh
```
Expected: `0 passed, 0 failed` (no `test_*.c` files exist yet), exit 0.

- [ ] **Step 3: Commit**

```bash
git add tests/run.sh
git commit -m "test(harness): native clang test runner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh"
```

---

### Task 5: Smoke test — validate all four observability surfaces

This is the foundation's acceptance test: create → param set → MIDI in → render (time advance) → MIDI capture, then a `state_full` → `state_load` serialize/restore round-trip.

**Files:**
- Create: `tests/test_smoke.c`

- [ ] **Step 1: Write `tests/test_smoke.c`**

```c
/* tests/test_smoke.c — foundation smoke test. Touches MIDI capture, param
 * round-trip, time advance, and state serialize/restore. */
#include "harness.h"

int main(void) {
    /* --- create --- */
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    /* --- param set (a long-grandfathered global key; see dsp/CLAUDE.md) --- */
    hx_set_param(h, "bpm", "120");

    /* --- param read-back of a serialization key --- */
    char buf[65536];
    int n = hx_get_param(h, "state_full", buf, (int)sizeof(buf));
    HX_ASSERT(n > 0, "get_param state_full returned no data");

    /* --- state round-trip: load what we just serialized --- */
    char saved[65536];
    HX_ASSERT((size_t)n < sizeof(saved), "state_full larger than buffer");
    memcpy(saved, buf, (size_t)n);
    saved[n] = '\0';
    hx_set_param(h, "state_load", saved);

    char buf2[65536];
    int n2 = hx_get_param(h, "state_full", buf2, (int)sizeof(buf2));
    HX_ASSERT(n2 > 0, "second get_param state_full returned no data");
    HX_ASSERT(n2 == n && memcmp(buf, buf2, (size_t)n) == 0,
              "state_full not stable across save/load round-trip");

    /* --- MIDI in + time advance + capture --- */
    hx_clear_capture(h);
    uint8_t note_on[3]  = { 0x90, 60, 100 };  /* ch1 note-on C4 vel100 */
    uint8_t note_off[3] = { 0x80, 60, 0 };
    hx_send_midi(h, note_on,  3, MOVE_MIDI_SOURCE_EXTERNAL);
    hx_render(h, 8);                            /* advance ~8 blocks */
    hx_send_midi(h, note_off, 3, MOVE_MIDI_SOURCE_EXTERNAL);
    hx_render(h, 4);

    int total = hx_stub_event_count();
    if (total == 0) {
        /* Diagnostic aid for the engineer: dump what (if anything) was emitted
         * and the DSP log, so a behavior change here is debuggable. */
        hx_dump_midi(h);
        fprintf(stderr, "--- DSP log ---\n%s\n", hx_stub_log_text());
    }
    HX_ASSERT(total > 0, "expected DSP to emit MIDI for an external note-on");

    hx_destroy(h);
    printf("PASS: smoke (create, param round-trip, state restore, MIDI capture)\n");
    return 0;
}
```

- [ ] **Step 2: Run the smoke test**

Run:
```bash
tests/run.sh
```
Expected: `PASS: test_smoke` and `1 passed, 0 failed`.

If the MIDI-emission assertion fails, the smoke test prints the capture dump + DSP log. Investigate whether an external note-on actually routes to output in davebox's default state (it may require a track/route to be configured). If default davebox emits nothing for a bare external note-on, **relax that surface** to assert on a known-emitting path instead: send a step/clock or set a routing param first — adjust `test_smoke.c` so the MIDI-capture surface is exercised by a path that genuinely emits, and note the reason in a comment. The other three surfaces (param round-trip, state restore, time advance) must remain asserted as-is.

- [ ] **Step 3: Commit**

```bash
git add tests/test_smoke.c
git commit -m "test(harness): smoke test exercising all four observability surfaces

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh"
```

---

### Task 6: Docs + worklog

**Files:**
- Create: `tests/README.md`
- Modify: `../_worklogs/schwung-davebox.md` (workspace-level; create if absent)
- Modify: `../_worklogs/OUTSTANDING.md` (workspace-level cross-repo board)

- [ ] **Step 1: Write `tests/README.md`**

```markdown
# davebox local DSP tests

Native (macOS, no Docker) harness for exercising the davebox DSP off-device.
Design: `docs/superpowers/specs/2026-06-20-local-dsp-harness-design.md`.

## Run

    tests/run.sh        # compiles + runs every tests/test_*.c, prints PASS/FAIL

Override the compiler with `CC=...`. Build/run artifacts go to `/tmp/davebox-tests/`.

## How it works

- `tests/harness/harness.h` `#include`s the single `dsp/seq8.c` translation unit,
  so each test has white-box access to the instance struct and static functions.
- `tests/harness/stub_host.c` provides a `host_api_v1_t` and captures all emitted
  MIDI (internal / external / inject) in call order, plus the `seq8_ilog` output.
- `tests/harness/compat.c` supplies a macOS `fmemopen` shim (glibc-only on device).

## Add a scenario

Create `tests/test_<name>.c`:

    #include "harness.h"
    int main(void) {
        hx_t *h = hx_create(NULL);
        HX_ASSERT(h, "create failed");
        /* hx_set_param / hx_send_midi / hx_render / hx_get_param ... */
        /* assert with HX_ASSERT and hx_seen_note_on / hx_count_midi /
           hx_stub_event(); inspect internals by casting h->inst. */
        hx_destroy(h);
        printf("PASS: <name>\n");
        return 0;
    }

`tests/run.sh` picks it up automatically.
```

- [ ] **Step 2: Update the worklog and outstanding board**

Prepend a dated entry to `../_worklogs/schwung-davebox.md` (newest on top; create the file with a `# schwung-davebox worklog` heading if it does not exist) recording: the local DSP harness landed on branch `local-dsp-harness` (native off-device test foundation: stub host + MIDI capture + state round-trip + `test_smoke`), with a link to the spec and plan, and the noted next target (the #11 knob-desync repro as a separate scenario).

On `../_worklogs/OUTSTANDING.md`, add/refresh a line under schwung-davebox noting the harness foundation exists and that the knob-desync (#11) off-device repro is the queued next use.

- [ ] **Step 3: Commit (davebox repo only)**

```bash
git add tests/README.md
git commit -m "docs(harness): README for the local DSP test harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017fZojSLfPB7Cpn4SLDh5Xh"
```

(The `_worklogs/` files live in the workspace container, not in the davebox repo, and are not committed there.)

---

## Verification (whole plan)

- [ ] `tests/run.sh` prints `1 passed, 0 failed` and exits 0.
- [ ] No changes were made to `dsp/seq8.c`, `dsp/seq8_set_param.c`, or anything under `schwung/` (host untouched).
- [ ] `git status` clean on branch `local-dsp-harness`; the temporary `_probe.c` is gone.
- [ ] Adding a new `tests/test_*.c` and re-running `tests/run.sh` picks it up with no other changes.

## Out of scope (do not build)

Audio-output *assertions* for davebox (it renders silence — the `hx_last_audio()` capture hook exists per the spec's reuse intent, but no davebox test asserts on it), JSON/data-driven scenario files, Docker, CI wiring, and the #11 knob-desync repro itself (separate plan).
