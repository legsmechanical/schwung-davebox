# SEQ8

SEQ8 is a Schwung overtake module (`component_type: overtake`) for Ableton Move — a standalone 8-track MIDI sequencer inspired by the Yamaha RS7000. No audio output. Written in C (DSP engine) + JavaScript (UI).

## Current build phase

**Phase 4 — clip model and Session View (in progress, fixes pending).**
Phase 3 complete — 4-track expansion with Note View LEDs and track selection.
Phase 2 complete — NoteTwist port + play effects chain (Note FX, Harmonize, MIDI Delay).
Phase 1 complete — single-track 16-step sequencer, transport, step LEDs, BPM 140.
Phase 0 complete — scaffold, MIDI buffer stress test, and button logging.

## Known issues (Phase 4)

- **Session View blink color**: clips blink between dim track color and full track color — fix deployed (TRACK_DIM_COLORS), needs hardware verification next session.
- **Session View row order / LED geometry**: multiple issues found and patched (row reversal, blank-pad formula) — needs full hardware verification next session.
- **Transport stop audio glitch**: was caused by `send_panic` calling `midi_send_external` for 512 SPI writes synchronously. Fixed — `send_panic` now uses `midi_send_internal` only.
- **Power button deadlock**: was caused by `pfx_send` calling `midi_send_external` from the render path, blocking the audio thread on SPI. When the power button was pressed, `suspend_overtake` in the shim tried to halt the DSP but deadlocked against the blocked render thread. Fix: `midi_send_external` removed from `pfx_send` entirely.

## Phase 0 findings

- **MIDI output buffer**: 300+ packets per burst with zero drops. Buffer overflow is not a concern for SEQ8's use case. The "64 packets per frame" figure is a safe working limit, not the hard ceiling.
- **DSP entry point**: `move_plugin_init_v2` with `plugin_api_v2_t` works correctly for overtake modules with DSP binaries.
- **module.json**: `component_type: "overtake"` must be at the **top level**, not inside `capabilities`. Setting `raw_midi: true` or `raw_ui: true` in capabilities causes a shim crash on boot for api_version 2 modules with DSP binaries — do not set these.
- **MIDI routing in overtake mode**: Internal device MIDI (button/pad presses) routes to JS `onMidiMessageInternal` only — the C `on_midi` callback fires for external MIDI (USB-A input) only.
- **Note/Session toggle**: CC 50 (`0x32`), d2=127 on press, d2=0 on release. Schwung constants name this `MoveMenu` but on Move hardware it is the three-bar toggle button left of the track buttons. Both press and release events fire.
- **JS logging**: `console.log` and `host_log()` both go to `/dev/null` on device (inherited from MoveLauncher). DSP plugin writes directly via `fopen(SEQ8_LOG_PATH, "a")`. JS has no file I/O; internal MIDI is shown on the display instead.
- **`[CRASH] [shim] Shim init: pid=NNN ppid=NNN`**: Normal startup diagnostic written by the Schwung shim every boot — not an error.
- **Move pad row layout (confirmed on hardware)**: 32 pads in 4 rows of 8. Notes increase bottom-to-top (same scheme as Push 2's upper 4 rows):
  - Bottom row, nearest player: notes **68–75** (pads 1–8)
  - Row 2: notes **76–83** (pads 9–16)
  - Row 3: notes **84–91** (pads 17–24)
  - Top row, nearest display: notes **92–99** (pads 25–32)
  - Original spec had this backwards (assumed 92–99 = bottom). Corrected in Phase 3.

## Phase 1 findings

- **`midi_send_internal` routes to Schwung chain instruments**: Confirmed. In overtake api_version 2 + DSP, `host->midi_send_internal` correctly routes note-on/off to the active chain's sound generator. This is the right function for sequencer MIDI output — not `midi_send_external`.
- **Step buttons are note-addressed**: Step buttons (notes 16–31) fire as `0x90` note-on (d2 > 0 = press, d2 = 0 = release). Toggle on press only (d2 > 0).
- **JS param bridge confirmed**: `host_module_get_param(key)` and `host_module_set_param(key, value)` are the JS globals for the C DSP ↔ JS bridge. Found in `sound_generator_ui.mjs`.
- **Tick accumulator**: `tick_accum += FRAMES_PER_BLOCK * BPM * PPQN`; fires when `>= sample_rate * 60`. At 140 BPM / 96 PPQN: delta=1,720,320 / threshold=2,646,000. Averages ~1.54 blocks per tick. Zero overflow risk for uint32.
- **Transport**: Play resets step to 0 and clears tick accum. Stop/panic sends brute-force note-off (0x80) for all 128 notes on each active channel. CC 123 not used — Braids and some instruments ignore it.
- **Gate**: 12 ticks (of 24 per step). Note-off fires at tick 12; next step's note-on fires at tick 0 of the following step.

## Phase 4 findings

- **Move LED palette**: Fixed 128-entry color index palette — NOT a brightness scale. Adjacent values are unrelated colors. `setLED(note, velocity)` selects a palette color by index, not brightness. Using an arbitrary low value (e.g. 15) will show the color at that palette slot (Cyan=14, so 15 is near-cyan), not a dim version of the intended color.
- **Dim color pairs**: Each track color has an explicit dim palette partner. Current pairs used in Session View:
  - Red (127) → DeepRed (65)
  - Blue (125) → DarkBlue (95)
  - VividYellow (7) → Mustard (29)
  - Green (126) → DeepGreen (32)
- **Power button is not MIDI**: Move's power button sends a D-Bus signal to the Schwung shim — not a MIDI CC. The shim detects it, shows "Press wheel to shut down" on screen, and waits for the encoder push (MoveMainButton = note 3) to confirm. There is no power button CC to filter in `onMidiMessageInternal`.
- **suspend_overtake**: The shim's `suspend_overtake` is called during shutdown to halt the DSP cleanly. If the audio render thread is blocked (e.g., on SPI I/O), `suspend_overtake` deadlocks. This was the mechanism behind the persistent power button failure in Phase 4 testing.
- **`midi_send_external` in `send_panic`**: 128 notes × 4 channels = 512 SPI writes fired synchronously on Stop/Panic. Caused ~1 second audio glitch. Removed — panic now uses `midi_send_internal` only.

## MIDI routing reference (overtake api_version 2 + DSP)

- **`host->midi_send_internal`**: Routes to the active chain's Schwung sound generator. **Confirmed correct** for sequencer note output in overtake api_version 2 + DSP mode. Implemented as `overtake_midi_send_internal` in the shim.
- **`host->midi_send_external`**: Sends to **USB-A** via SPI hardware (`spi_fd`, `hw_mmap` in shim log). Does **not** appear on USB-C — USB-C is Move's host/charging port (connects to Ableton Live), not a MIDI output. External MIDI hardware connects via USB-A only.
  - **CRITICAL — never call from the render path, under any circumstances.** SPI I/O is blocking. Calling `midi_send_external` inside `render_block`, or in any function invoked from `render_block` (including `pfx_send`), causes audio cracking and can deadlock `suspend_overtake` on shutdown. Confirmed in Phase 4 testing. Any external MIDI monitoring must use a deferred queue flushed from outside the render callback. See Phase 5.
- **`shadow_send_midi_to_dsp([status, d1, d2])`**: JS global that routes 3-byte MIDI to the Schwung DSP chain's sound generator. Used by pure-JS overtake modules (e.g. `control`, api_version 1, no DSP). In api_version 2 + DSP, use `host->midi_send_internal` from C instead — it is the equivalent and confirmed working.
- **`move_midi_internal_send([cable|CIN, status, d1, d2])`**: JS global for Move hardware MIDI (LEDs, button lights) — NOT for instrument notes.
- **`move_midi_external_send([cable|CIN, status, d1, d2])`**: JS global for USB-A external MIDI.

## Key constraints

- GLIBC max 2.35 on Move — nothing newer may be linked.
- No complex static initializers.
- Cache BPM every 512 render blocks (not per-block).

## Always run after every build

```sh
nm -D dist/seq8/dsp.so | grep GLIBC
```

## Deploy

```sh
./scripts/build.sh && ./scripts/install.sh
```

## Debug log

DSP plugin writes directly to `/data/UserData/schwung/seq8.log` (stdout/stderr go to /dev/null on device).

```sh
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

`debug.log` contains only the Schwung shim's own output.

## NoteTwist reference

`~/schwung-notetwist` contains a working Schwung MIDI FX module whose C code we will port into SEQ8. Key files to reference:

- `src/notetwist.c` — the main DSP implementation
- `scripts/build.sh` — build system to adapt for SEQ8
- `Dockerfile` — cross-compilation environment to adapt

Stages to port directly: octave transposer, note page, harmonize, MIDI delay, tempo sync.

Stages to build new: beat stretch, clock shift (bidirectional, operates on step tick positions not MIDI stream), sequencer arpeggiator, live arpeggiator, swing (applied last, before MIDI out).
