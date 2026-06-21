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
