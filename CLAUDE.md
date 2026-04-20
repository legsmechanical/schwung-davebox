# SEQ8

SEQ8 is a Schwung **tool module** (`component_type: tool`) for Ableton Move — a standalone 8-track MIDI sequencer inspired by the Yamaha RS7000. No audio output. Written in C (DSP engine) + JavaScript (UI).

**Important:** SEQ8 is `component_type: "tool"` (not `"overtake"`). This enables the interactive tool reconnect path for background running. It appears in the **Tools menu**, not the Overtake module menu.

## Current build phase

**Phase 5 — 8 tracks, 256 steps, arpeggiator, Track View (in progress).**
Phase 4 complete — clip model, Session View, background running via tool suspend.
Phase 3 complete — 4-track expansion with Note View LEDs and track selection.
Phase 2 complete — NoteTwist port + play effects chain (Note FX, Harmonize, MIDI Delay).
Phase 1 complete — single-track 16-step sequencer, transport, step LEDs, BPM 140.
Phase 0 complete — scaffold, MIDI buffer stress test, and button logging.

## Phase 5 todos

- **Session View navigation — Up/Down buttons**: CC 54 (Up) and CC 55 (Down) scroll the scene row view one row at a time. Currently the view is fixed at `sceneGroup * 4`.
- **Session View navigation — step buttons as scene map**: In Session View, the 16 step buttons (notes 16–31) show the current scene position across all 16 rows (one LED per row) and navigate to that row on press.
- **Shift + step button launches scene**: In Session View, Shift + step button press launches that scene row (equivalent to pressing all 4 pads in a row).
- **8-track expansion**: Expand from 4 tracks to 8 tracks in both DSP and UI.
- **256-step clips**: Expand from 16 steps to 256 steps per clip.
- **Arpeggiator**: Port sequencer arpeggiator from NoteTwist reference.
- **Track View**: New view mode showing all 8 tracks simultaneously.

## Known limitations

- **Do not load SEQ8 from within SEQ8** — selecting SEQ8 from the Tools menu while already inside SEQ8 causes LED corruption. The Tools menu button sets `SHADOW_UI_FLAG_JUMP_TO_TOOLS` (0x80) via the shim's ui_flags bitmask; shadow_ui.js polls this with `shadow_get_ui_flags()` and calls `enterToolsMenu()` directly. `onMidiMessageInternal` is never called — there is no MIDI event to intercept. Workaround: hide first (Shift+Back), then re-enter from the Tools menu.

## Background running (Phase 4 — confirmed working on hardware)

- **Hide (Shift+Back)**: `host_hide_module()` → `hideToolOvertake()`. DSP stays alive, MIDI keeps playing. Returns to Tools menu. `overtakeModuleLoaded` stays true, `toolHiddenFile="_hidden_"`, `toolHiddenModulePath` set.
- **Re-entry**: select SEQ8 from Tools menu → `startInteractiveTool()` detects `dspAlreadyLoaded=true` → reconnect branch: **no `overtake_dsp:load`**, only JS reloaded. Brief loading screen on re-entry is expected and correct — JS-only reload, DSP and MIDI are uninterrupted.
- **Hard exit** (DSP destroyed): only if another tool loads while SEQ8 is hidden (replaces `overtakeModuleLoaded`). Cold boot falls through to Option C state file recovery.
- **Cold boot recovery (Option C)**: `create_instance` reads `/data/UserData/schwung/seq8-state.json` to restore clips, active_clip. File written on every step change, transport change, launch_clip/scene, and destroy_instance.
- **Power button behavior**: hide SEQ8 first (Shift+Back), then power down from the Move UI. The power button sends a D-Bus signal (not MIDI); JS cannot intercept it.

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
- **Interactive tool reconnect path**: `component_type: "tool"` with `tool_config: { interactive: true, skip_file_browser: true }` enables `startInteractiveTool()` → `dspAlreadyLoaded` check → reconnect branch (no `overtake_dsp:load`, JS-only reload). Both waveform-editor and song-mode confirm tools can have `api_version: 2` + `dsp.so`.
- **`hideToolOvertake()` vs `suspendOvertakeMode()`**: both keep DSP alive. Tool path (`hideToolOvertake`) additionally sets `toolHiddenFile`/`toolHiddenModulePath` so `startInteractiveTool` can detect the hidden session on re-entry. Standard overtake suspend has no equivalent re-entry detection.
- **No direct hardware gesture for tool re-entry**: `JUMP_TO_OVERTAKE` (Shift+Vol+Back) always calls `enterOvertakeMenu()` when not in module view — goes to the Overtake module menu, not Tools menu. SEQ8 as a tool re-enters via Tools menu → select SEQ8 → instant reconnect.
- **JS state reset on re-entry**: `shadow_load_ui_module()` re-evaluates the entire `ui.js` file on every re-entry, resetting all module-level variables. `init()` calls `host_module_get_param` to recover all DSP state (1024 step reads + transport/track state).
- **`shadow_set_suspend_overtake` accessible from module code**: confirmed — all overtake/tool modules share the same QuickJS globalThis as shadow_ui.js. Native C globals registered in the runtime are accessible from module code.

## MIDI routing reference (overtake api_version 2 + DSP)

### C DSP routing

SEQ8 uses two routing destinations, selected per-track via `tN_route` param (`"schwung"` or `"move"`):

- **`ROUTE_SCHWUNG` (default, tracks 0–3)**: `host->midi_send_internal` → Schwung synth chains. These are the chains attached to the active scene in Ableton Move. Confirmed correct for sequencer output.
- **`ROUTE_MOVE` (planned for tracks 4–7)**: `move_midi_inject_to_move()` → native Move tracks (the Move's own internal tracks, separate internal bus from Schwung chains, no channel collision). Looked up at init time via `dlsym(RTLD_DEFAULT, "move_midi_inject_to_move")` — `NULL` if not available, `pfx_send` falls back to `midi_send_internal`.

These are **separate internal buses** — Schwung chains and native Move tracks do not share MIDI channels. No collision risk when routing tracks to different buses.

- **`host->midi_send_external`**: Sends to **USB-A** via SPI hardware (`spi_fd`, `hw_mmap` in shim log). Does **not** appear on USB-C — USB-C is Move's host/charging port (connects to Ableton Live), not a MIDI output. External MIDI hardware connects via USB-A only.
  - **CRITICAL — never call from the render path, under any circumstances.** SPI I/O is blocking. Calling `midi_send_external` inside `render_block`, or in any function invoked from `render_block` (including `pfx_send`), causes audio cracking and can deadlock `suspend_overtake` on shutdown. Confirmed in Phase 4 testing. Any external MIDI monitoring must use a deferred queue flushed from outside the render callback.

### JS routing

- **`shadow_send_midi_to_dsp([status, d1, d2])`**: JS global for Schwung DSP chain's sound generator. Used by pure-JS overtake modules (api_version 1, no DSP). In api_version 2 + DSP, use `host->midi_send_internal` from C instead.
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
