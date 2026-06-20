# Local DSP Test Harness — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending implementation plan
**Scope:** `schwung-davebox` (module-local). Foundation structured for later reuse in audio modules (osirus/jv880/obxd).

## Problem

Testing davebox DSP today requires a full build + deploy + reboot cycle to the Move
device for every change. This is slow and makes bug reproduction (e.g. the #11
knob-desync note-output stall) and regression checking expensive. The DSP is in
fact highly decoupled from the hardware, so most logic can be exercised off-device.

## Goal

A native (macOS, no Docker) test/debug harness that compiles the davebox DSP and
drives it through its real ABI, capturing its observable outputs. Optimized to be
**driven by Claude during debugging/development sessions** — fast recompile, full
visibility into internals, clear text output, cheap-to-author new scenarios.

Serves three uses on one foundation:
1. **Reproduce known bugs** off-device (scriptable MIDI-in → MIDI-out replay).
2. **Regression safety net** (assertions run before deploy).
3. **Fast iteration loop** for new DSP logic.

## Why local testing is feasible (verified)

- **ABI is tiny.** Module exports `move_plugin_init_v2(const host_api_v1_t*)` →
  a struct of 8 fn pointers (`create_instance`, `destroy_instance`, `on_midi`,
  `set_param`, `get_param`, `render_block`, ...). Header is vendored at
  `dsp/host/plugin_api_v1.h` — no host checkout needed.
- **Host surface used at runtime is ~6 fields:** `sample_rate`, `log`,
  `midi_send_internal`, `midi_send_external`, `midi_inject_to_move`, `get_bpm`.
  No SHM, no SPI — that all lives in the host shim, not the module.
- **davebox is MIDI-only:** `render_block` memsets the output to zero. The
  interesting outputs are emitted MIDI, param get/set, and state serialization —
  not audio.
- **Single translation unit:** `seq8.c` `#include`s `seq8_set_param.c`. A test
  that `#include "seq8.c"` gets full white-box access to the instance struct and
  every static function.
- **Device-isms fail gracefully:** `/data/UserData/...` paths and the metro WAV
  mmap silently no-op when absent.
- **Only one macOS portability landmine:** a single `fmemopen` call
  (`seq8.c:9370`, glibc-only) for state serialization. Resolved with a ~30-line
  `fmemopen` shim under `#ifdef __APPLE__`. No NEON, no `_GNU_SOURCE`, no other
  glibc-isms.
- **Precedent exists:** `schwung/tests/host/test_arp_clock_status.c` already
  builds a `host_api_v1_t` on the stack with stub fn pointers and drives the API.

## Architecture

```
schwung-davebox/tests/
  harness/
    harness.h        # test API; #includes seq8.c (white-box) + stub_host
    stub_host.h      # host_api_v1_t builder + capture API declarations
    stub_host.c      # stub fn pointers; MIDI capture rings; log buffer
    compat.c         # macOS fmemopen shim; optional FS-path redirect to tmp dir
  test_smoke.c       # first validation test (all four observability surfaces)
  test_*.c           # future scenarios / bug repros
  run.sh             # native clang: compile each test_*.c, run, PASS/FAIL summary
```

Two layers:
- **Foundation** (`harness/`) — reusable plumbing.
- **Tests** (`test_*.c`) — each self-contained, `#include "harness.h"`, provides
  its own `main()`, compiled to its own binary by `run.sh`.

### Design-for-reuse note
The stub-host + capture core is written **module-agnostic**: the only
davebox-specific coupling is (a) which TU `harness.h` includes and (b) the
MIDI-centric helpers. An **audio capture hook** (capture `render_block` output
into a buffer for later assertion) is included in the stub-host even though
davebox never produces audio, so the core can be lifted into osirus/jv880/obxd
later with minimal change. No other speculative generalization (YAGNI).

## Observability surfaces (the debug tools)

1. **MIDI capture.** Every `midi_send_internal` / `midi_send_external` /
   `midi_inject_to_move` is recorded *with call order* into rings.
   - `hx_dump_midi()` — human-readable dump.
   - assert helpers: presence/count/ordering (e.g. `hx_expect_note_on(ch,note)`).
2. **Param round-trip.** `set_param`/`get_param` driver + a
   `get_param("state_full")` → `set_param("state_load", ...)` serialize/restore
   assert.
3. **Time advance.** `hx_render(inst, n_blocks)` pumps the tick-driven logic
   (~44/94 Hz). MIDI clock (`0xF8`) injectable via `send_midi`; `get_bpm`
   configurable — together these exercise Clock-Follow paths.
4. **Internal inspection.** Direct reads of the instance struct (white-box) plus
   the captured `seq8_ilog` output buffer.

## Harness API (sketch)

```c
// harness.h
hx_t *hx_create(const char *json_defaults);   // build stub host + create_instance
void  hx_destroy(hx_t *h);
void  hx_send_midi(hx_t *h, const uint8_t *msg, int len, int source);
void  hx_set_param(hx_t *h, const char *key, const char *val);
int   hx_get_param(hx_t *h, const char *key, char *buf, int len);
void  hx_render(hx_t *h, int n_blocks);        // advance time
void  hx_set_bpm(hx_t *h, float bpm);

// capture / assert
void  hx_clear_capture(hx_t *h);
void  hx_dump_midi(hx_t *h);                   // ordered dump of all 3 channels
int   hx_count_midi(hx_t *h, int channel_kind);
// + targeted expect_* helpers and HX_ASSERT(cond, msg)
```

`hx_t` exposes the underlying `void *inst` so tests can cast to the davebox
instance type and read internals directly.

## Build / run

- `tests/run.sh`: `clang -std=c11 -I dsp -I tests/harness` per `test_*.c`, link
  `stub_host.c` + `compat.c`, run each binary, aggregate PASS/FAIL.
- Native only. No Docker. No CI wiring (run on demand).
- `harness.h` includes `seq8.c` once per test binary — no cross-test symbol
  collisions.

## First deliverable (foundation validation)

`test_smoke.c` exercising all four surfaces:
1. `hx_create` → set a couple params → send a note-on via `hx_send_midi`.
2. `hx_render` a few blocks.
3. Assert MIDI was captured.
4. `get_param("state_full")` → `set_param("state_load", ...)` → assert round-trip.

Green smoke test ⇒ foundation works; every future scenario is a small new `.c`.

## Natural next target (post-foundation, separate plan)

The **#11 knob-desync** repro: drive interleaved `set_param`(knob CC) + `hx_render`
and inspect call-ordered MIDI capture to surface the "note-output stall+jump under
knob-CC load" symptom off-device.

## Out of scope (YAGNI)

- Audio output assertions for davebox (MIDI-only; the audio hook is plumbing-only).
- JSON/text data-driven scenario files (white-box C is more powerful for repros).
- Docker, CI integration.
- Any change to the host (`schwung/`) — harness is module-local.

## Risks / open questions

- **State persistence paths.** Tests exercising save/load may need the FS-path
  redirect (`compat.c`) to a tmp dir; smoke test uses in-memory `state_full`
  serialization to avoid device paths.
- **seq8.c evolves.** White-box struct access couples tests to internals; accept
  this for debug leverage, keep assertions on observable behavior where possible.
- **First native compile may surface incidental warnings/errors** beyond
  `fmemopen` (the scan was static); the plan's first step is "make it compile."
