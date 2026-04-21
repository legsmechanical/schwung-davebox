# SEQ8

SEQ8 is a Schwung **tool module** (`component_type: tool`) for Ableton Move — a standalone 8-track MIDI sequencer inspired by the Yamaha RS7000. No audio output. Written in C (DSP engine) + JavaScript (UI).

**Important:** SEQ8 is `component_type: "tool"` (not `"overtake"`). This enables the interactive tool reconnect path for background running. It appears in the **Tools menu**, not the Overtake module menu.

## Current build phase

**Phase 5 — 8 tracks, 256 steps, arpeggiator, Track View.**
- Phase 5a complete — live pad input via `shadow_send_midi_to_dsp`, polyphony, no stuck notes.
- Phase 5b complete — latency investigation, poll throttling, batch `state_snapshot`.
- Phase 5c complete — clip length control via Loop + step buttons.
- Phase 5d complete — Track View parameter banks: Beat Stretch, Clock Shift, Note FX, Harmonize, MIDI Delay, per-track live pad octave shift, step out-of-bounds LEDs.
- Phase 5e complete — Gate time shortening fix: per-step `step_gate`/`step_gate_orig` arrays in `clip_t`; render loop fires note-off at `step_gate[current_step]` ticks instead of fixed GATE_TICKS; `noteFX_gate` destructively scales all active steps; range extended to 0–400%; clock_shift and beat_stretch preserve gate arrays; Gate knob K3 NOTE FX bank wired, sens=2.
- Phase 5f complete — Polyphonic step data model: `step_note[256]` replaced with `step_notes[256][4]` + `step_note_count[256]` in `clip_t`; `pending_note` replaced with `pending_notes[4]` + `pending_note_count` in `seq8_track_t`; render loop fires note-on/off for each note in the step; clock_shift and beat_stretch rotate/compress all note columns atomically; new get param `tN_cC_step_S_notes`, new set param `tN_cC_step_S_toggle`; state file persists step notes as sparse format; version-gated load (wrong/missing `"v":1` → delete file, start clean).

Phase 4 complete — clip model, Session View, background running via tool suspend.
Phase 3 complete — 4-track expansion with Note View LEDs and track selection.
Phase 2 complete — NoteTwist port + play effects chain (Note FX, Harmonize, MIDI Delay).
Phase 1 complete — single-track 16-step sequencer, transport, step LEDs, BPM 140.
Phase 0 complete — scaffold, MIDI buffer stress test, and button logging.

## What's Built (current feature summary)

Intended as a quick-start for a new session. Verify against code before acting on anything here.

**Transport**: Play/Stop/Panic via Move Play button. Shift+Play = panic. BPM follows host (cached every 512 blocks).

**8 tracks, 16 clips each, 256 steps per clip**: Full clip model in DSP and JS. Step sequencer running on all 8 tracks simultaneously. Clip launch per-track or as scenes (all tracks at once).

**Two views — Track View and Session View**:
- **Track View** (default): 16 step buttons show current page of active clip. Pads play live notes (isomorphic 4ths diatonic layout). Left/Right nav between pages. Track selection via Shift + bottom pad row.
- **Session View** (toggle via CC 50): 4×8 pad grid shows all clips for the visible scene group. Step buttons show scene map. Up/Down (CC 54/55) scrolls scene groups. Shift+step launches scene. Track buttons launch clips or scenes.

**Clip length control** (Phase 5c): Hold Loop (CC 58) + press step button N → clip length = (N+1)×16 steps (16..256). Step LEDs show pages-in-use (bright) vs unused (dim) while held. Page is clamped on shrink.

**Step out-of-bounds indicator** (Phase 5d): In Track View, step buttons whose absolute index is ≥ clip length light White, making the clip boundary visible while editing.

**Live pad input**: Pads play notes through the active Schwung chain via `shadow_send_midi_to_dsp` directly from JS. No C DSP involvement. Isomorphic 4ths diatonic layout, per-track octave. Velocity floor at 80 (`Math.max(80, d2)`).

**Per-track live pad octave shift** (Phase 5d): Up button (CC 55) / Down button (CC 54) shifts `trackOctave[activeTrack]` ±1 (range −4..+4) while in Track View. Applied as `trackOctave[activeTrack] * 12` to the base pitch at note-on, clamped to 0–127. `padPitch[32]` stores the shifted pitch sent at note-on so the matching note-off is always correct. Display shows a 1-second "Octave: ±N" overlay after each shift.

**Play effects chain** (full NoteTwist port in C DSP): Note FX (octave, offset, gate, velocity), Harmonize (unison, octaver, interval 1+2), MIDI Delay (time, level, repeats, feedback). Applied to sequencer MIDI output. Fully exposed via Track View parameter banks.

**Track View parameter banks** (Phase 5d): 8 knob-driven parameter banks accessible via Shift + top-row pad (notes 92–98). See **Parameter Bank Reference** below for full table. Display priority state machine:
1. Compress Limit overlay (~1500ms after blocked beat-stretch compress) — highest priority
2. Octave overlay (~1000ms after Up/Down octave shift)
3. State 1 (knob touched) — single parameter name + value
4. States 2/3 (jog touched or bank-select timeout) — 4-knob overview grid
5. State 4 (normal) — track/clip/page header

**Beat Stretch** (Phase 5d): Knob 1 of TIMING bank (lock=true, sens=16). CW doubles clip length (expand); CCW halves it (compress). Compress is blocked entirely if any two active steps would map to the same destination — `stretch_blocked` flag set in DSP, checked by JS after set_param. "COMPRESS LIMIT" overlay shown for ~1500ms on block. `stretch_exp` tracks the current stretch exponent (0=1x, +1=x2, −1=/2).

**Clock Shift** (Phase 5d): Knob 2 of TIMING bank (continuous rotation, sens=8). CW/CCW rotates all steps in the active clip by one position. JS mirrors the rotation in `clipSteps`.

**Background running**: Shift+Back hides SEQ8 (DSP stays alive, MIDI keeps playing). Re-entry via Tools menu reconnects instantly (JS-only reload). Cold boot recovery via `seq8-state.json`.

**State persistence**: Clips, lengths, active clips written to `/data/UserData/schwung/seq8-state.json` on every step change, transport change, launch, and destroy.

## Upcoming tasks (in order)

1. **Melodic step entry UI** — Use `tN_cC_step_S_toggle` to assign pads to steps. Data model is ready (Phase 5f). UI: enter step-edit mode, highlight active step, pads assign/remove notes, display shows chord members.
2. **Arpeggiator** — Port sequencer arpeggiator from NoteTwist reference. New DSP build required.
3. **Mute/Solo** — Per-track mute/solo, likely via Shift + track-select pads.
4. **Drum + Chromatic pad modes** — `pad_mode` param already wired in TRACK bank K3; DSP and JS logic not yet implemented.
5. **Global menu** — BPM, key, scale, swing controls accessible from a top-level menu.

## Parameter Bank Reference

Banks are selected via **Shift + top-row pad** (notes 92–99). Pressing the same bank again returns to TRACK (0). Pad 99 (bank 7) is reserved and ignored.

| Bank | Pad | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|------|-----|----|----|----|----|----|----|----|----|
| 0 TRACK | 92 | Ch (stub) | Rte (route, track) | Mode (pad_mode, track) | Res (stub) | Len (clip_length, track, sens=4) | — | — | — |
| 1 TIMING | 93 | Stch (beat_stretch, action, sens=16, lock) | Shft (clock_shift, action, sens=8) | — | — | — | — | — | — |
| 2 NOTE FX | 94 | Oct (noteFX_octave, track, sens=6) | Ofs (noteFX_offset, track, sens=4) | Gate (noteFX_gate, track, sens=2) | Vel (noteFX_velocity, track) | — | — | — | — |
| 3 HARMZ | 95 | Unis (harm_unison, track, sens=4) | Oct (harm_octaver, track, sens=4) | Hrm1 (harm_interval1, track, sens=4) | Hrm2 (harm_interval2, track, sens=4) | — | — | — | — |
| 4 SEQ ARP | 96 | On (stub) | Type (stub) | Sort (stub) | Hold (stub) | OctR (stub) | Spd (stub) | — | — |
| 5 MIDI DLY | 97 | Dly (delay_time, track) | Lvl (delay_level, track) | Rep (delay_repeats, track) | Vfb (delay_vel_fb, track) | Pfb (delay_pitch_fb, track) | Gfb (delay_gate_fb, track) | Clk (delay_clock_fb, track) | Rnd (delay_pitch_random, track) |
| 6 LIVE ARP | 98 | On (stub) | Type (stub) | Sort (stub) | Hold (stub) | OctR (stub) | Spd (stub) | — | — |
| 7 RESERVED | 99 | — | — | — | — | — | — | — | — |

**Scope notes**: `track` = key sent as `tN_<dspKey>`; `action` = one-shot DSP trigger (no bounded value), read-back via `tN_<dspKey><actionSuffix>`; `stub` = JS-only, no DSP call.

**Sensitivity**: default sens=1 (1 tick per unit). Slow knobs listed above with explicit `sens=N`.

**Lock**: Beat Stretch only — fires once per touch, then blocks until knob is released.

## DSP Parameter Key Reference

All new keys added in Phase 5d. All `tN_` keys accept N = 0..7 (track index).

| Key | Direction | Format | Notes |
|-----|-----------|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand (+1) or compress (−1) active clip. Compress silently no-ops if blocked. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"x4"`, `"/2"`, `"/4"`, … | Current stretch exponent as formatted string. |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress attempt was blocked by step collision. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps in active clip right (+1) or left (−1) by one position. |
| `tN_clock_shift_pos` | get | integer string | Current shift position (0..length−1). |
| `tN_clip_length` | set/get | integer string `"1"`..`"256"` | Active clip length in steps. Clamps current_step if needed. Calls `seq8_save_state`. |
| `tN_cC_step_S_notes` | get | space-separated MIDI note numbers, or `""` if count=0 | Notes assigned to step S of clip C on track N. e.g. `"60"`, `"60 64 67"`. |
| `tN_cC_step_S_toggle` | set | MIDI note number as string, e.g. `"64"` | Toggle note into/out of step S. Adds if absent (up to 4-note limit), removes if present. Activates/deactivates step automatically. Calls `seq8_save_state`. |

Previously existing keys (for reference): `tN_active_clip`, `tN_current_step`, `tN_queued_clip`, `tN_cC_steps`, `tN_cC_length`, `tN_cC_step_S`, `tN_launch_clip`, `launch_scene`, `transport`, `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `noteFX_octave/offset/gate/velocity`, `harm_unison/octaver/interval1/interval2`, `delay_time/level/repeats/vel_fb/pitch_fb/gate_fb/clock_fb/pitch_random`.

## DSP Struct Reference

### `clip_t` (current fields)
```c
typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 256 steps, 0/1 */
    uint8_t  step_notes[SEQ_STEPS][4];    /* up to 4 notes per step; [0] = primary */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..4; invariant: steps[s]==1 iff count[s]>=1 */
    uint8_t  step_vel[SEQ_STEPS];
    uint8_t  step_gate[SEQ_STEPS];        /* gate ticks 1..GATE_TICKS; render loop fires note-off here */
    uint8_t  step_gate_orig[SEQ_STEPS];   /* original gate before noteFX_gate scaling; init=GATE_TICKS */
    uint16_t length;                      /* active length, 1..256 */
    uint8_t  active;
    uint16_t clock_shift_pos;             /* current rotation offset; wraps at length */
    int8_t   stretch_exp;                 /* beat stretch exponent: 0=1x, +1=x2, -1=/2. Not persisted. */
} clip_t;
```

### `seq8_track_t` (relevant fields)
```c
typedef struct {
    /* ... */
    uint8_t   pending_notes[4];     /* notes fired at last note-on; used for note-off matching */
    uint8_t   pending_note_count;   /* number of valid entries in pending_notes */
    uint8_t   stretch_blocked;      /* 1 if last compress was blocked by step collision; cleared on expand or non-blocked compress */
} seq8_track_t;
```

### Beat Stretch compress — collision detection

Dry-run using `uint8_t seen[SEQ_STEPS]` before any mutations. If any two active steps in the current clip would map to the same destination (`i/2`), sets `stretch_blocked=1` and returns without touching `steps[]` or `stretch_exp`. This ensures atomicity — no partial rewrites.

## JS State Variables (Phase 5d additions)

```js
let activeBank     = new Array(NUM_TRACKS).fill(0);   /* active bank index 0-7 per track; 0 = TRACK (default) */
let knobTouched    = -1;                              /* 0-7 = which knob is currently touched; -1 = none */
let jogTouched     = false;                           /* jog wheel capacitive touch (MoveMainTouch = note 9) */
let knobAccum      = new Array(8).fill(0);            /* raw encoder tick accumulator per knob */
let knobLastDir    = new Array(8).fill(0);            /* last direction per knob for reversal detection */
let knobLocked     = new Array(8).fill(false);        /* blocks further firing until touch release (lock=true params) */
let bankSelectTick = -1;                              /* tickCount at last bank select; -1 = timeout not active */
const BANK_DISPLAY_TICKS = 392;                       /* ~2000ms at 196Hz */
let stretchBlockedEndTick = -1;                       /* tickCount deadline for COMPRESS LIMIT overlay; -1 = inactive */
const STRETCH_BLOCKED_TICKS = 294;                    /* ~1500ms at 196Hz */
let trackOctave = new Array(NUM_TRACKS).fill(0);      /* per-track live pad octave shift, -4..+4 */
let octaveOverlayEndTick = -1;                        /* tickCount deadline for octave overlay; -1 = inactive */
const OCTAVE_OVERLAY_TICKS = 196;                     /* ~1000ms at 196Hz */
let bankParams = Array.from({length: NUM_TRACKS}, () =>
    BANKS.map(bank => bank.knobs.map(k => k.def)));   /* [track][bankIdx][knobIdx] = integer value */
```

## Known limitations

- **Do not load SEQ8 from within SEQ8** — selecting SEQ8 from the Tools menu while already inside SEQ8 causes LED corruption. The Tools menu button sets `SHADOW_UI_FLAG_JUMP_TO_TOOLS` (0x80) via the shim's ui_flags bitmask; shadow_ui.js polls this with `shadow_get_ui_flags()` and calls `enterToolsMenu()` directly. `onMidiMessageInternal` is never called — there is no MIDI event to intercept. Workaround: hide first (Shift+Back), then re-enter from the Tools menu.
- **Live pad latency floor: ~3–7ms** — structural, cannot be closed. See Phase 5 findings.
- **All 8 tracks route to the same Schwung chain** — no confirmed multi-chain path exists. See ROUTE_MOVE investigation.
- **`step_vel`, `step_gate`/`step_gate_orig` not persisted** — The state file stores `steps[]`, `length`, `active_clip`, and `step_notes`/`step_note_count` (sparse). Per-step velocity and gate values reset to defaults on cold boot (vel=100, gate=GATE_TICKS). Acceptable until step entry UI is built.
- **State file is version-gated** — Format field `"v":1` required at load time. Any file without `"v":1` (including all pre-5f files) is deleted and SEQ8 starts clean. No backward compatibility — bump `v` when format changes.
- **`step_notes`/`step_note_count` persist format** — State file uses sparse key `"tNcC_sn":"S:n1,n2;S2:n3;"` per clip. Steps matching the default (count=1, note=60) are omitted; absent key means all-default for that clip.
- **MIDI Delay repeats: no upper clamp enforced** — the `delay_repeats` param accepts 0–64 but high values can create very long feedback chains. TODO: clamp to 8 in DSP `set_param` handler and update BANKS range to match.
- **Clip lengths not persisted via state file** — `tN_clip_length` and `tN_cC_length` set_param handlers do not call `seq8_save_state`. Cold boot restores step data but not clip lengths. Known gap, acceptable for now.
- **`stretch_exp` not persisted** — Beat Stretch exponent resets to 0 on every cold boot or JS re-entry. Not saved to state file.

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

## Phase 5 findings

### Live pad input (Phase 5a)

- **Correct pattern: `shadow_send_midi_to_dsp([status, d1, d2])`** called directly from JS `onMidiMessageInternal`. No C DSP involvement, no `host_module_set_param`, no SPSC queue. Confirmed working in api_version 2 + DSP tool modules — all overtake/tool modules share the same QuickJS globalThis as shadow_ui.js, so `shadow_send_midi_to_dsp` is accessible. No stuck notes, polyphony works correctly.
- **Previous architecture (removed)**: Live pad notes were routed `host_module_set_param → C set_param → midi_send_internal`. This caused stuck notes and out-of-order note-off/note-on pairs under polyphonic pressure. The SPSC pad queue, `pad_bypass_chain` flag, `live_notes[128]` timeout table, and all related C infrastructure were fully removed in Phase 5a.
- **`shadow_send_midi_to_dsp` in api_version 2 + DSP**: Confirmed working for live pad input. The note in the JS routing section ("In api_version 2 + DSP, use `host->midi_send_internal` from C instead") applies to the *sequencer engine* output in `render_block` — not to live pad input from JS. Both paths coexist correctly.
- **`on_midi` does not receive internal MIDI in tool mode**: Confirmed on hardware. The C `on_midi` callback only fires for external USB-A MIDI. Internal pad/button events route exclusively to JS `onMidiMessageInternal`.
- **Velocity floor**: `Math.max(80, d2)` — ensures light hardware taps produce audible signal while preserving relative dynamics above 80.
- **`padPitch[32]`**: Stores the pitch sent at note-on per pad (including octave shift). Ensures matching note-off pitch even if `padNoteMap` or `trackOctave` changes while a pad is held. Value -1 = pad not active.
- **Move pressure grid phantom note-offs**: Move sends phantom note-off/note-on pairs during simultaneous multi-pad presses. With `shadow_send_midi_to_dsp` these are harmless pass-throughs. No state tracking required.

### Latency and poll performance (Phase 5b)

- **Live pad input latency floor: ~3–7ms** (JS architecture limit). The JS runtime ticks at ~196Hz (~5ms intervals); a pad press arriving mid-tick waits up to 5ms plus shadow_ui.js dispatch overhead. Native Move performance mode bypasses JS entirely — no equivalent C-level hook is exposed to tool modules. This gap is structural and cannot be closed.
- **JS tick rate**: Measured at 196Hz (~5.1ms per tick) on hardware.
- **Poll throttling**: `pollDSP()` is called every 4 ticks (`POLL_INTERVAL = 4`, ~49Hz) rather than every tick. Reduces JS thread blocking window.
- **Batch `state_snapshot` param**: Replaces 25 individual `host_module_get_param` calls in `pollDSP()` with one. Format: `"playing cs0..cs7 ac0..ac7 qc0..qc7"` (25 space-separated ints). Each IPC call blocks the JS thread; 25 calls per tick was the largest single source of MIDI event queuing delay.
- **`isNoiseMessage` filtering**: Filters 0xA0 (poly aftertouch) and 0xD0 (channel aftertouch) at the top of `onMidiMessageInternal` — these are high-frequency noise from the Move pressure grid and were adding dispatch overhead on every pad hold.
- **`host_module_set_param` key filtering**: Schwung API silently drops calls for keys not matching registered param patterns. Only keys registered in the C `set_param` dispatch table reach C. Do not use `host_module_set_param` for MIDI output — use `shadow_send_midi_to_dsp` directly.

### Clip length control (Phase 5c)

- **Hold Loop (CC 58) + step button N** sets clip length to (N+1)×16 steps (16..256 in 16-step pages).
- **`loopHeld` state**: `true` while CC 58 is held. `updateStepLEDs()` and `drawUI()` both branch on `loopHeld` so tick()'s render loop owns the display immediately on press.
- **Step LEDs while held**: pages-in-use show bright track color; unused pages show DarkGrey.
- **Display while held**: line 2 shows "LOOP LEN: N STEPS", line 3 shows "M OF 16 PAGES".
- **Page clamped on shrink**: `trackCurrentPage[activeTrack]` is clamped to the new last page if current page would be out of bounds.
- **DSP `_length` set_param does not call `seq8_save_state`**: Clip lengths are not persisted on cold boot via the state file. This is a known gap — acceptable for now.

### Track View parameter banks (Phase 5d)

- **Bank select**: Shift + top-row pad (notes 92–98). `activeBank[activeTrack]` set to 0–6. Pressing the same bank again returns to TRACK (0). Pad 99 (bank 7) reserved, ignored.
- **`bankSelectTick`**: Set to `tickCount` on bank select. Triggers State 3 (overview display) for ~2000ms (`BANK_DISPLAY_TICKS = 392`). Cleared when timeout expires or State 4 returns.
- **Knob touch (notes 0–7)**: d2=127 = touch-on → `knobTouched = knobIdx`. d2 < 64 or 0x80 note-off = touch-off → `knobTouched = -1`, `knobLocked[k] = false`, `knobAccum[k] = 0`.
- **Jog touch (note 9)**: `jogTouched = true/false`. Triggers State 2 (overview display, no timeout).
- **Sensitivity accumulator**: `knobAccum[k]++` per raw encoder tick in that direction. Fires one unit change when `>= pm.sens`. Reversal (direction change) resets `knobAccum` to 0.
- **`parseActionRaw(raw, def)`**: Decodes DSP's formatted exponent strings (`"1x"` → 0, `"x2"` → 1, `"/2"` → -1, etc.) back to integer exponents for `bankParams` storage.
- **Beat Stretch compress collision**: JS checks `tN_beat_stretch_blocked` immediately after calling `set_param`. If `"1"`, sets `stretchBlockedEndTick` and does NOT mirror the step rewrite in `clipSteps`. If `"0"`, mirrors the expand/compress in `clipSteps` and reads `tN_beat_stretch_factor` back from DSP as authoritative.
- **Clock Shift JS mirror**: After each shift set_param, JS rotates `clipSteps[t][ac]` in the same direction. `bankParams[t][bank][knobIdx]` updated as `(cur + delta) % len` (wrapping position counter for display).
- **`applyBankParam` clip_length side-effect**: When `dspKey === 'clip_length'`, JS also updates `clipLength[t][ac]` and clamps `trackCurrentPage[t]` to the new last page.
- **`readBankParams`**: Called on bank select and during `init()` for TRACK bank (index 0). Uses `parseActionRaw` for `scope === 'action'` params.

### Step entry research (pre-implementation)

Completed a full read of `seq8.c` and `SEQ8_SPEC.md` to establish baseline before implementing melodic step entry.

**There is no `step_t` struct.** Step data is stored as parallel arrays in `clip_t` — no per-step wrapper type exists. Phase 5f restructured the note fields to support polyphony. Current `clip_t` fields:

```c
typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 0=off, 1=on */
    uint8_t  step_notes[SEQ_STEPS][4];    /* up to 4 notes per step; [0] = primary; default SEQ_NOTE */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..4; default 1; invariant: steps[s]==1 iff count[s]>=1 */
    uint8_t  step_vel[SEQ_STEPS];         /* default SEQ_VEL (100) */
    uint8_t  step_gate[SEQ_STEPS];        /* gate ticks 1..GATE_TICKS (capped) */
    uint8_t  step_gate_orig[SEQ_STEPS];   /* original gate before noteFX_gate scaling */
    uint16_t length;                      /* 1..256, default 16 */
    uint8_t  active;                      /* 1 if any step is on */
    uint16_t clock_shift_pos;
    int8_t   stretch_exp;
} clip_t;
```

**`step_notes[s][0]` is wired into the render loop.** All active steps fire all their notes (count 1..4) at note-on, and fire matching note-offs at the gate tick. New params `tN_cC_step_S_toggle` and `tN_cC_step_S_notes` expose note assignment. Step note data is persisted to the state file (sparse format).

**Polyphony: 4 notes per step.** Step entry UI (upcoming) will use `tN_cC_step_S_toggle` to assign notes.

### Hardware and external MIDI (Phase 5)

- **WIDI Bud Pro**: Confirmed working for wireless USB-A MIDI. Plugs into Move's USB-A port and appears as a standard USB MIDI device. Useful for connecting external hardware wirelessly.
- **Master knob (CC 14, `MoveMainKnob`)**: `claims_master_knob: true` is set in module.json. Not yet handled in ui.js — reserved for future use.
- **Move encoder constants** (from `/data/UserData/schwung/shared/constants.mjs`):
  - `MoveMainKnob = 14` (CC, no LED)
  - `MoveMainButton = 3` (note, no LED — also used to confirm power-down)
  - `MoveMainTouch = 9` (note, no LED)

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

`pfx_send` uses `host->midi_send_internal` for all tracks. `ROUTE_SCHWUNG` and `ROUTE_MOVE` are preserved as labels in the `tN_route` param API but both currently use the same path.

- **`host->midi_send_internal`**: Routes to the **active Schwung chain** in the overtake/tool context. MIDI channel in the status byte does NOT route to different chains — hardware test confirmed channel 2 did not reach a chain set to receive on channel 2. All 8 SEQ8 tracks play through whichever chain is active in the current scene. Users can layer SEQ8 tracks by setting all Schwung chains to receive on all channels (omni).
- **`host->midi_send_external`**: Sends to **USB-A** via SPI hardware. Does **not** appear on USB-C — USB-C is Move's host/charging port, not a device port. **CRITICAL — never call from the render path.** SPI I/O is blocking; calling it in `render_block` causes audio cracking and can deadlock `suspend_overtake`. Confirmed Phase 4. Safe from a JS deferred queue if needed for external hardware.

### ROUTE_MOVE investigation (Phase 5 — exhaustively confirmed no path)

All approaches to routing MIDI to multiple native Move chains independently were tested and failed:

- **`dlsym(RTLD_DEFAULT, "move_midi_inject_to_move")`**: Always returns NULL. The shim binary exports zero dynamic symbols — `nm -D shadow_ui` returns empty.
- **`move_midi_inject_to_move` as a JS global**: Exists and callable from JS (`song-mode` uses it). Injects into the Move hardware MIDI event stream simulating **physical pad presses** (notes 68–99). Does NOT route arbitrary MIDI pitches to chain sound generators — hardware confirmed.
- **JS bridge (C DSP → param queue → JS → inject)**: Implemented and tested. Fails for the same reason as above.
- **MIDI channel routing via `midi_send_internal`**: Hardware-tested — channel 2 did not reach a chain set to receive on channel 2. `midi_send_internal` reaches only the active chain regardless of MIDI channel.
- **USB-A loopback via `midi_send_external`**: Not possible — USB-A is a host port, cannot connect to USB-C (also host).
- **`/schwung-midi-inject` SHM**: Exists (`SHADOW_MIDI_INJECT_BUFFER_SIZE 256`, `shadow_drain_midi_inject`). Struct layout unknown, no safe write path identified.
- **`song-mode` mechanism**: Launches clips via pad note injection (68–99) only — not arbitrary-pitch note sequencing.

**Current state**: All 8 SEQ8 tracks use `midi_send_internal` → active Schwung chain. ROUTE_MOVE reserved. ROUTE_EXTERNAL available for real external USB-A hardware (including WIDI Bud Pro) via deferred JS queue if needed in future.

### JS routing

- **`shadow_send_midi_to_dsp([status, d1, d2])`**: JS global for live pad MIDI output to the Schwung chain. Confirmed working in api_version 2 + DSP tool modules. Used for live pad input only — sequencer MIDI output uses `host->midi_send_internal` from C.
- **`move_midi_internal_send([cable|CIN, status, d1, d2])`**: JS global for Move hardware MIDI (LEDs, button lights) — NOT for instrument notes.
- **`move_midi_inject_to_move([cable|CIN, status, d1, d2])`**: JS global. Injects into Move hardware MIDI event stream. Simulates pad presses for notes 68–99 (clip launch). Does NOT play arbitrary pitches on chain instruments.
- **`move_midi_external_send([cable|CIN, status, d1, d2])`**: JS global for USB-A external MIDI. Safe from JS tick (deferred); never call from render path.

## Key constraints

- GLIBC max 2.35 on Move — nothing newer may be linked.
- No complex static initializers.
- Cache BPM every 512 render blocks (not per-block).
- **Schwung core on device: v0.9.7** (installed Apr 14 2026; no version file — date confirmed from binary timestamps).

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
- `SEQ8_SPEC.md` — Full design specification. Read at the start of every session and consult when making architectural decisions.

Stages to port directly: octave transposer, note page, harmonize, MIDI delay, tempo sync.

Stages to build new: beat stretch, clock shift (bidirectional, operates on step tick positions not MIDI stream), sequencer arpeggiator, live arpeggiator, swing (applied last, before MIDI out).
