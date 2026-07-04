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

## Phase 0 characterization suite (refactor safety net)

Added 2026-07-04 ahead of the modularity refactor (see
`docs/superpowers/plans/2026-07-04-refactor-roadmap.md`). These tests pin
CURRENT behavior — they gate the refactor phases and must stay green through
every structural move:

- `test_state_roundtrip.c` — populated v36 state serialize→load→re-serialize
  byte-identical (gates the `seq8_state.c` split). Loads go into a FRESH
  instance: the on-device `state_load` handler resets state before
  `seq8_load_state`; an in-place reload double-appends note lanes by design.
- `test_state_migration.c` + `tests/fixtures/` — v36-minimal defaults (with an
  explicit fixture-read guard) and the v≠36 gate (`state_version_mismatch`,
  nothing applied).
- `test_setparam_domains.c` — one key per set_param domain, pinned via
  serialized-state substrings (gates the Phase 4 `set_param` split). Note its
  scope limit: it does NOT verify each handler sets `state_dirty` itself.
- `test_engine_goldens.c` + `tests/goldens/*.txt` — ordered MIDI captures for
  7 deterministic scenarios (gates the Phase 3 engine split), incl. `looper`
  (global MIDI looper capture + replay, gates the Phase 3 `seq8_looper.c`
  split). **Golden
  workflow:** regenerate ONLY when a behavior change is intended and approved:
  `UPDATE_GOLDENS=1 tests/run.sh`, then diff the goldens in the commit. Never
  hand-edit (exact compare incl. newlines). Line format:
  `kind cable|CIN status d1 d2`.
- `test_bake_convert.c` — white-box characterization of the two destructive
  clip rewrites: `bake_scene` loop-unroll + pfx velocity fold (gates the
  Phase 2 `seq8_bake.c` split) and the melodic<->drum `convert` round-trip
  (gates the Phase 2 `seq8_convert.c` split).
- `test_padmap_contract.c` — the `tN_padmap` piggyback contract
  (active_track + dsp_inbound_enabled + 35-token payload incl. trailing
  pad_dispatch_muted / delete_held / corun_left_silent, each pinned at both
  polarities). Phase 6's `ui_dsp_bridge.mjs` must preserve this exactly.
- `test_rui_budget.c` — remote-UI snapshot well-formedness + size canary
  (~4x baseline; bump deliberately on legitimate growth) + density floor.
  The pathological >64 KB overflow (audit remote-ui-3) is parked; extend this
  test when that fix lands.

**Characterization discipline:** these tests pass immediately by definition —
when adding one, prove it can fail (corrupt a value/golden, watch it fail,
revert) before committing.

## JS pure-helper tests (`tests/js/`)

Node-based unit pins for the pure helpers in `ui/ui_constants.mjs`
(`test_constants.mjs`) and the pure(-read) helpers extracted to
`ui/ui_pure.mjs` in Phase 1 (`test_pure.mjs`: drum pad/velzone,
clip-content, bank-cycle, and scale-nudge helpers — pins hand-derived from
the pre-move ui.js source, S read-surface set on the real imported `S`).
`tests/js/run.sh` bundles each
`test_*.mjs` via `tests/js/build.mjs` (esbuild JS API; a resolve plugin maps
the on-device `/data/UserData/schwung/shared/constants.mjs` import to
`tests/js/stubs/shared_constants.mjs`) and runs it under node. `tests/run.sh`
runs this automatically when node is present (`JS: PASS/FAIL/SKIPPED` lines;
folded into the exit code). This checks pure-function behavior only — QuickJS
compatibility is covered by esbuild + on-device verification, not here.

## davebox gotchas for test authors

- **Emitting MIDI:** `on_midi` ignores external MIDI (`source != 0`). To make the
  DSP emit, arm a track with a `t0_padmap` set_param (sets `pad_note_map`,
  `active_track=0`, `dsp_inbound_enabled=1`), then send an INTERNAL pad note
  (note 68-99). Track 0 defaults to ROUTE_MOVE, so it emits via
  `midi_inject_to_move` (captured as `HX_MIDI_INJECT`). See `test_smoke.c`.
- **State restore:** `state_load`'s value is a UUID (a file path), not a JSON
  blob. To round-trip state off-device, write the `state_full` output to a temp
  file, set `inst->state_path` (white-box), and call `seq8_load_state(inst)`.
- **State serialize:** `state_full` returns "" unless `state_dirty` is set; an
  idempotent `bpm` set_param re-marks it dirty.
