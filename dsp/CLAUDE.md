# SEQ8 DSP

Read this when starting DSP work. Covers details not in root CLAUDE.md.

## Files

`seq8.c` (~4998 lines) `#include`s `seq8_set_param.c` (~3390 lines). Single translation unit — no extern declarations between them. All DSP logic lives here.

Reference port: `~/schwung-notetwist` — NoteTwist pfx stages. API reference: `docs/SEQ8_API.md`.

## Build

```sh
./scripts/build.sh          # Docker cross-compile (aarch64)
nm -D dist/seq8/dsp.so | grep GLIBC   # must be ≤ 2.35
```

GLIBC ≤ 2.35 required. No complex static initializers. Schwung core v0.9.9.

## Logging

**Use `seq8_ilog(inst, msg)`** — writes to `seq8.log` via `inst->log_fp`.

**Never use `fprintf(stderr, ...)`** — goes to MoveOriginal's uncaptured stderr, will NOT appear in seq8.log.

```sh
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

## MIDI routing

`midi_send_internal` → Schwung chain (safe from render path).
`midi_send_external` → USB-A — **never call from render/tick path** (deadlock).

## State format

Version v=25 (only v=25 accepted). v≠25 → deleted + clean start.

Note format: `tick:pitch:vel:gate;`

Key prefixes:
- SEQ ARP: `_arst` / `_arrt` / `_aroc` / `_argt` / `_arsm` / `_artg`
- TRACK ARP: `t%d_taon` / `tast` / `tart` / `taoc` / `tagt` / `tasm` / `talc` / `tasv%d`
- VelIn: `t%d_tvo` (sparse, missing=0=Live)
- Note Repeat gate: `t%dl%drg` (sparse, default 255)
- Note Repeat vel scale: `t%dl%dvs%d`
- Note Repeat nudge: `t%dl%dnd%d`
- Drum lane mute/solo: `t%ddlm` / `t%ddls`
- Swing: `_swa` (0–100) / `_swr` (0=1/16, 1=1/8) — sparse, default 0

`state_load` calls `drum_track_init` + `drum_repeat_init_defaults` before applying saved values.

## Deferred save

Handlers set `inst->state_dirty = 1` — no file I/O on audio thread.

JS `pollDSP()` calls `get_param("state_full")` every `POLL_INTERVAL` ticks. When dirty, DSP serializes via `fmemopen` into `inst->state_buf[65536]`; JS writes via `host_write_file` (~2ms). Overflow (>63KB) falls back to synchronous write with log warning.

Suspend path (`set_param("save")`) calls `seq8_save_state` synchronously — host may kill JS before async write completes.

Handlers that never called `seq8_save_state` (bpm, key, scale, pfx bank knobs) only save on suspend.
