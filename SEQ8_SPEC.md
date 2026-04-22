# SEQ8 — Complete Design Specification
**Version 0.2 · April 2026**

> **This document supersedes v0.1.** It reflects all architecture corrections, design decisions, and hardware findings from development through Phase 5d. Items not yet built are clearly marked **[NOT BUILT]**.

SEQ8 is a Schwung **tool module** for Ableton Move: a standalone 8-track MIDI step sequencer inspired by the Yamaha RS7000. Runs natively on Move's ARM hardware as a tool in the Schwung ecosystem. No audio output.

---

## 1. Platform

| Item | Detail |
|------|--------|
| Hardware | Ableton Move (firmware 2.1+) |
| Framework | Schwung tool module (`component_type: "tool"`) — core v0.9.7 |
| Repository | `~/schwung-seq8` |
| Language | C (DSP engine) + JavaScript (UI, QuickJS) |
| Audio | None — MIDI sequencer only |
| Display | 128×64 pixel monochrome OLED |
| Sample rate | 44100 Hz, 128 frames/block |
| Menu location | **Tools menu** (not Overtake module menu) |

> **Architecture correction from v0.1:** The original spec specified `component_type: "overtake"`. SEQ8 uses `component_type: "tool"` with `tool_config: { interactive: true, skip_file_browser: true }`. This enables the interactive tool reconnect path required for background running. The distinction matters: tool modules appear in the Tools menu, not the Overtake menu, and have a different suspend/resume lifecycle.

---

## 2. Hardware Reference

### 2.1 Confirmed CC / Note Map

| Control | CC / Note | Confirmed | SEQ8 Function |
|---------|-----------|-----------|---------------|
| Pads 1–32 | Notes 68–99 | ✅ | Live note input / clip launch / step edit |
| Step buttons 1–16 | Notes 16–31 | ✅ | Step toggle / page nav / scene map / clip length |
| Track buttons 1–4 | CCs 43–40 (reversed) | ✅ | Track launch / scene launch |
| Knobs 1–8 | CCs 71–78 | ✅ | Parameter control. **Relative encoder:** clockwise = 1–63, counter-clockwise = 64–127 |
| Knob touches 1–8 | Notes 0–7 | ✅ | Touch detection (on = 127, off = 0–63). No turn required. |
| Volume encoder touch | Note 8 (`MoveMasterTouch`) | ✅ | — |
| Volume encoder | CC 79 | — | Move system volume — SEQ8 must not consume this CC, pass through to firmware **[NOT BUILT — currently being consumed]** |
| Jog wheel rotate | CC 14 (`MoveMainKnob`) | ✅ | Cycle through parameter banks in Track View (no modifier). Shift + jog = cycle through tracks 1–8. **[NOT BUILT]** |
| Jog wheel click | Note 3 (`MoveMainButton`) | ✅ | Confirm / power-down confirm |
| Jog wheel touch | Note 9 (`MoveMainTouch`) | ✅ | — |
| Shift | CC 49 | ✅ | Modifier |
| Play | CC 85 | ✅ | Start/stop transport |
| Record | CC 86 | — | Step record arm **[NOT BUILT]** |
| Mute | CC 88 | ✅ | Mute current track |
| Delete | CC 119 | — | Delete clip **[NOT BUILT]** |
| Undo | CC 56 | — | Undo **[NOT BUILT]** |
| Copy | CC 60 | — | Copy clip **[NOT BUILT]** |
| Sample / Record | **CC 118** (`MoveSample`, aliased to `MoveRecord` — same physical button) | ✅ | Hold to print/bake **[NOT BUILT]** |
| Back | CC 51 | ✅ | Exit menu / return |
| Note/Session toggle | **CC 50** | ✅ | Toggle Track View / Session View |
| Up / + | CC 55 | ✅ | Scene scroll up (Session View) / octave up per track (Track View) |
| Down / - | CC 54 | ✅ | Scene scroll down (Session View) / octave down per track (Track View) |
| Left arrow | CC 62 | ✅ | Previous step page |
| Right arrow | CC 63 | ✅ | Next step page |
| Loop | **CC 58** | ✅ | Hold + step = set clip length |

> **Note on Note/Session toggle:** Original spec listed this as "CC TBD." Confirmed as CC 50 (`MoveMenu` in constants). Fires d2=127 on press, d2=0 on release — both events arrive and must be handled.

### 2.2 Confirmed Pad Layout

> **Architecture correction from v0.1:** The original spec had the pad row note assignments backwards. Confirmed on hardware:

```
Top row (near display):     pads 25–32  notes 92–99
Row 3:                       pads 17–24  notes 84–91
Row 2:                        pads 9–16  notes 76–83
Bottom row (near player):     pads 1–8   notes 68–75
```

Notes increase bottom-to-top, same scheme as Push 2's upper 4 rows.

### 2.3 Shift Combos

| Combo | Function | Status |
|-------|----------|--------|
| Shift + Play | MIDI panic (all notes off, internal only) | ✅ Built |
| Shift + Back | Hide SEQ8 (background running) | ✅ Built |
| Shift + Step buttons 1–8 | (Reserved — not implemented) | — |
| Shift + Pads bottom row (pads 1–8, notes 68–75) | Track select (tracks 1–8) | ✅ Built |
| Shift + Pads top row (pads 25–32, notes 92–99) | Parameter bank select (Track View) | ✅ Built |
| Jog wheel rotate (no modifier) | Cycle through parameter banks (Track View) | **[NOT BUILT]** |
| Shift + Jog wheel rotate | Cycle through tracks 1–8 | **[NOT BUILT]** |
| Step button (Session View) | Navigate to scene group (no launch) | ✅ Built |
| Shift + Step button (Session View) | Navigate to scene group AND launch that scene row | ✅ Built |
| Mute + Undo | Clear all mutes and solos | **[NOT BUILT]** — currently unassigned |
| Loop (hold) + step button | Set clip length | ✅ Built |
| Hold CC 50 (Note/Session toggle) | Show Session Overview on display | **[NOT BUILT]** |

### 2.3.1 Delete Key Combos **[NOT BUILT]**

Delete (CC 119) acts as a modifier when held:

| Combo | Function | Undoable |
|-------|----------|----------|
| Delete + step button (Track View) | Clear all notes from that step (deactivates step) | Yes |
| Delete + track button (Track View) | Clear all sequence data from active clip on that track | Yes |
| Delete + clip pad (Session View) | Clear all sequence data from that clip | Yes |

> **Note:** Undo/redo (roadmap item 14) is not yet built. Delete operations should be designed with undo in mind but the undo part is a stub until that feature is built.

> **Design change from v0.1:** Original spec assigned "Mute + Play" to clear all mutes and solos. Changed to **Mute + Undo** to avoid conflict with transport. Not yet implemented — currently unassigned.

### 2.4 Physical Connections

| Port | SEQ8 Use |
|------|----------|
| USB-A | MIDI out to external hardware (via `midi_send_external`, deferred JS queue) **[NOT WIRED IN UI]** |
| USB-A | WIDI Bud Pro — wireless MIDI bridge (confirmed working) |
| USB-C | Host/charging only — **not a MIDI device port** |

> **Routing finding:** USB-A → USB-C loopback is impossible — both are host ports. WIDI Bud Pro is the only confirmed external MIDI path.

---

## 3. Data Model

### 3.1 Project

```
project/
  bpm:        follows host (cached every 512 render blocks)
  key:        A   (global, default)
  scale:      minor (global, shared by all scale-locked tracks)
  swing:      0%   (global) [NOT BUILT]
  tracks[8]
  scenes[16]
  clips[8][16]       (track × scene)
```

**State persistence:** Auto-save to `/data/UserData/schwung/seq8-state.json` on every step change, transport change, clip launch, and destroy. Restores on load including across full device reboots (cold boot recovery confirmed working). State file is version-gated (`"v":2`) — wrong or missing version causes file deletion and clean start. Per-step note assignments (`step_notes`, `step_note_count`) are persisted in a sparse format. Per-step velocity and gate values are not yet persisted.

> **Design change from v0.1:** Original spec said "explicit save only." Auto-save is the current implementation. User-facing project save/load in `.sq8` format is **[NOT BUILT]**.

### 3.2 Track

```
track/
  number:         1–8
  color:          fixed per track (see color table)
  mode:           drum | melodic_chromatic | melodic_scale
  midi_channel:   1–16 (default: track number)
  route:          ROUTE_SCHWUNG | ROUTE_EXTERNAL
  octave:         0 (per-track, shifted by Up/Down buttons) ✅
  resolution:     1/16 (only; 1/8 not yet exposed)
  muted:          false
  soloed:         false [NOT BUILT]
  play_fx:        { note_fx, harmonize, midi_delay } [BUILT — no UI yet]
  active_clip:    clip reference
```

**Track colors (confirmed on hardware):**

| Track | Color | Bright Palette | Dim Palette |
|-------|-------|---------------|------------|
| 1 | Red | 127 | 65 (DeepRed) |
| 2 | Blue | 125 | 95 (DarkBlue) |
| 3 | Yellow | 7 (VividYellow) | 29 (Mustard) |
| 4 | Green | 126 | 32 (DeepGreen) |
| 5 | Magenta | HotMagenta | DeepMagenta |
| 6 | Cyan | Cyan | PurpleBlue |
| 7 | Orange | Bright | BurntOrange |
| 8 | Sky Blue | SkyBlue | DeepBlue |

> **Design change from v0.1:** Track 8 was specified as White. Changed to Sky Blue during development. Dim palette pairs must be explicit — the LED palette is a fixed 128-color lookup, NOT a brightness scale. Arbitrary low index values show that palette slot's color, not a dim version of the intended color.

> **Routing finding:** `ROUTE_SCHWUNG` and `ROUTE_MOVE` in the original spec both turned out to use `midi_send_internal`. All exhaustive attempts to route to multiple independent Schwung chains failed (see §9 MIDI Routing). `ROUTE_MOVE` is reserved but currently equivalent to `ROUTE_SCHWUNG`. `ROUTE_EXTERNAL` is defined in DSP but not wired through UI.

### 3.3 Clip

```
clip/
  id:          "1-A" … "8-P"    (track × scene)
  track:       1–8
  scene:       1–16
  length:      16–256 steps     (in 16-step pages; 1–16 pages)
  steps[256]:  step_t
  playing:     bool
  queued:      bool
```

> **Design change from v0.1:** Minimum clip length is 16 steps (1 page), not 1 step. Clip length set via Loop + step button (see §8.4).

### 3.4 Step

```
step/
  active:      bool                (steps[s] == 1 iff step_note_count[s] >= 1)
  notes[4]:    uint8 (up to 4 MIDI note numbers per step — chord entry)
  note_count:  uint8 (0..4; default 1 at SEQ_NOTE=60)
  velocity:    1–127               (per-step, shared across all notes in chord)
  gate:        uint8               (ticks; default 12 of 24 per step)
  pitch_off:   int8 (semitone offset, parameter lock) [NOT BUILT — no UI]
```

> **Phase 5f:** Step data model restructured to support up to 4 notes per step (chords). `step_note[256]` replaced with `step_notes[256][4]` + `step_note_count[256]`. Render loop fires note-on/off for all notes in a step atomically. clock_shift and beat_stretch handle all note columns together.

> **Timing detail:** Gate default = 12 ticks of 24 per step. Note-off fires at tick 12; next step's note-on fires at tick 0 of the next step.

### 3.5 Scene

A scene is a horizontal row (A–P, indices 1–16). It has no data of its own — defined entirely by the clips at that row index across all 8 tracks. Launching a scene triggers all clips in that row simultaneously.

---

## 4. Clip / Scene Behavior

### 4.1 Launching

- **Pad press (Session View):** Launches clip at that pad's track/scene position. Only affects that track.
- **Scene launch (Session View):** Shift + step button (transport running) OR track button → launches all clips in visible scene row simultaneously.
- **Individual clip launch:** Pad press in Session View, or track button selects active clip for Track View.

### 4.2 Legato Playback

When a new clip launches on a track that already has a clip playing, the new clip inherits the playback position:

```
new_position = old_position % new_clip_length
```

Always on. No hard-switch mode.

### 4.3 Empty Scene Slots

If a scene is launched and a track has no clip at that scene row, that track stops.

### 4.4 One Clip Per Track

Only one clip plays per track at a time.

### 4.5 Clip State Colors (Session View pads)

| State | Color |
|-------|-------|
| Empty | Unlit |
| Has content | Track color (dim) |
| Playing | Track color (bright) |
| Queued | Track color (blinking) **[NOT BUILT — blinking not yet implemented]** |

---

## 5. Views

SEQ8 has **two views**. The Note/Session toggle (CC 50) switches between them.

> **Architecture correction from v0.1:** The original spec described three views: Note View, Session View, and Track View (overlay). This was incorrect. SEQ8 has **two views only**: Track View (the main editing view, previously called Note View in early development) and Session View. Track View is the default top-level view — not an overlay.

### 5.0 Note/Session Toggle Behavior (CC 50)

The toggle button (CC 50) uses press/hold distinction:

- **Tap** → switch between Track View and Session View (existing behavior)
- **Hold** → show Session Overview on OLED display; release → return to previous view

### 5.0.1 Session Overview (Hold CC 50) ✅ BUILT (Phase 5m)

A full-display graphical overview of the entire session, accessible from either view by holding the Note/Session toggle.

- **Display:** Pure graphical 8×16 cell grid filling the 128×64 OLED (16×4 px per cell). 8 columns = tracks, 16 rows = scenes. No text labels.
- **Cell states:**
  - Empty slot — unlit
  - Has content (not active clip) — center bar (14×2 px)
  - Active clip (non-active track) — solid 16×4 fill
  - Active clip on active track — blinking (alternates solid fill and center bar)
- **Interaction:** Display only — all input swallowed except CC 50 release.
- **Exit:** Release CC 50 → return to previous view immediately.

### 5.1 Track View (Default)

**Entered on boot. Toggle via CC 50.**

#### Step Buttons

- Show active steps for current clip / current page (lit = active, unlit = inactive)
- Press to toggle step on/off
- Left/Right arrows (CC 62/63) page through clip if longer than 16 steps
- Display shows current page and total pages (PG X/Y)
- **Loop held:** Step buttons show pages-in-use (bright track color) vs unused (DarkGrey). Press to set clip length.

#### Pad Grid — Live Note Input

- **Isomorphic 4ths diatonic layout (scale mode, currently only mode implemented)**
- Bottom row (pads 1–8, notes 68–75): root note + ascending scale degrees
- Each row up = perfect fourth higher
- Root note pad = bright track color; other scale pads = dim track color
- Live notes sent via `shadow_send_midi_to_dsp([status, pitch, vel])` directly from JS — no C DSP involvement
- **Status byte encodes active track as MIDI channel:** `0x90 | activeTrack` (e.g. track 1 = 0x91, track 2 = 0x92). This is how live pad notes are associated with the correct track for chain routing. Confirmed fix — earlier versions sent on channel 0.
- Velocity floor: `Math.max(80, d2)` — preserves relative dynamics above 80, ensures audible signal from light taps
- Polyphonic, no stuck notes
- `padPitch[32]`: stores pitch at note-on per pad, ensures matching note-off even if track changes while pad is held
- **Drum mode pad layout:** [NOT BUILT]
- **Chromatic mode pad layout:** [NOT BUILT]

#### Track Buttons (Track View)

Track buttons (CCs 43–40) launch clips on the **active track** at the scene row corresponding to that button's position within the currently visible scene group. They do not trigger scene launches — each button affects the active track only.

#### Track Selection

- Shift + bottom pad row (pads 1–8, notes 68–75) = select tracks 1–8

#### Parameter Banks (Track View)

**[BUILT ✅]** Shift + top pad row (notes 92–99) = select parameter bank. The 8 knobs (CCs 71–78) control that bank's parameters. Jog wheel touch acts as Shift modifier for bank switching only. First bank (TRACK) is active by default on all tracks at startup. `claims_master_knob: true` is set in module.json.

Bank scope rules:
- **Track + Clip scoped:** TIMING, NOTE FX, HARMZ, SEQ ARP, MIDI DLY — each clip on a track can have independent settings. **[Clip-specific DSP data model not yet built — currently stored at track level. Restructure scheduled after full play effects chain is complete.]**
- **Track only (not clip-specific):** LIVE ARP, TRACK — persist across clips on a track.
- **Global (not in banks):** Root note, scale, BPM, swing amount, swing resolution, incoming velocity override — accessed via global menu (not yet built).

| Pad (note) | Bank | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|---|---|---|---|---|---|---|---|---|---|
| 92 | TRACK | Ch | Route | Mode | Res | Len | — | — | — |
| 93 | TIMING | Stretch | Shift | — | — | — | — | — | — |
| 94 | NOTE FX | Oct | Ofs | Gate | Vel | — | — | — | — |
| 95 | HARMZ | Unison | Oct | Hrm1 | Hrm2 | — | — | — | — |
| 96 | SEQ ARP | On | Type | Sort | Hold | OctR | Spd | — | — |
| 97 | MIDI DLY | Dly | Lvl | Rep | Vfb | Pfb | Gfb | Clk | Rnd |
| 98 | LIVE ARP | On | Type | Sort | Hold | OctR | Spd | — | — |
| 99 | — | Reserved | — | — | — | — | — | — | — |

Bank notes:
- TRACK: Mode selects Drum or Melody pad grid. Len duplicates Loop+step functionality for convenience.
- TIMING: Stretch and Shift operate on sequenced MIDI step tick positions only (DSP not yet built).
- NOTE FX: Gate and Vel operate on sequenced MIDI only. Oct and Ofs transpose sequenced output.
- HARMZ: Currently operates on sequenced MIDI only. Wiring to live pad input is a future task.
- SEQ ARP: Sequenced MIDI only. DSP not yet built.
- MIDI DLY: Operates on both sequenced and live MIDI output.
- LIVE ARP: Track-scoped but NOT clip-specific. Operates on live input only. DSP not yet built.
- Knob sensitivity (slow params use accumulator — multiple ticks required per increment, direction reversal resets accumulator):
- NOTE FX Oct (K1): divisor 6
- NOTE FX Ofs (K2): divisor 4
- All HARMZ params (K1–K4): divisor 4
- All other knobs: divisor 1 (delta 1 per tick)

#### Display — Track View

```
TR1 · A  PG 1/1
KNOB: [TRACK]
1 2 3 4 5 6 7 8
A L L L L L L L
```

- Line 1: Active track number · Active clip scene letter · Page (PG X/Y)
- Line 2: Active parameter bank name, format "KNOB: [BANKNAME]"
- Line 3: Track numbers 1–8
- Line 4: Active clip scene letter for each track

**Display priority (highest to lowest):**
1. Compress Limit overlay (~1500ms after blocked beat-stretch compress)
2. Octave overlay (~1000ms after Up/Down octave shift)
3. Step edit display (while step button held) — shows track/clip/step header + assigned note names
4. Knob touched — single parameter name + value
5. Jog touched or bank-select timeout (~2000ms) — 4-knob overview grid
6. Normal — track/clip/page header

**While Loop held:**
```
LOOP LEN: 32 STEPS
2 OF 16 PAGES
```

### 5.2 Session View

**Entered via Note/Session toggle (CC 50).**

#### Pad Grid

32 pads arranged as 8 columns (tracks) × 4 rows (scenes visible):
- Each column = one track
- Each row = one scene
- Shows 4 scenes at a time
- Clip state reflected via track color (dim = has content, bright = playing)

#### Step Buttons (Session View)

Step buttons 1–16 show the scene map — which of the 16 scene groups are in use:
- Bright = currently visible group
- Dim = group has at least one clip
- Unlit = group is completely empty

- Press step button → navigate to that scene group (no launch)
- Shift + step button → navigate AND launch that scene row (no transport state check)

#### Scene Navigation

Up (CC 55) / Down (CC 54) scroll scene groups.

#### Track Buttons (Session View)

Launch all clips in the corresponding visible scene row (scene launch).

#### Mute / Solo (Session View)

**[NOT BUILT]** Mute + bottom pad row toggles mute for tracks 1–8. Solo via Shift + Mute + bottom pad row.

#### Display — Session View

```
001 · 140bpm · Am
[████████░░] 8/16
1 2 3 4 5 6 7 8
M - - S - - - -
```

Line 4 (mute/solo status) not yet correctly implemented.

---

## 6. Sequencer Engine

### 6.1 Timing

- Internal resolution: 96 PPQN
- Block size: 128 frames at 44100 Hz ≈ 2.9ms per block
- Tick accumulator: `tick_accum += FRAMES_PER_BLOCK * BPM * PPQN`; fires when `>= sample_rate * 60`
- At 140 BPM / 96 PPQN: delta ≈ 1,720,320 / threshold = 2,646,000 → ~1.54 blocks per tick
- BPM follows host, cached every 512 render blocks (not per-block — host API boundary safety)
- All MIDI scheduling in C `render_block()` — not JavaScript

### 6.2 Transport

| Action | Behavior |
|--------|----------|
| Play (stopped) | Start from bar 1, reset tick_accum |
| Play (playing) | Stop transport |
| Shift + Play | MIDI panic — all notes off via `midi_send_internal` on all 128 notes, all active channels |
| Module exit | MIDI panic |

> **Implementation note:** Panic uses `midi_send_internal` only. `midi_send_external` was removed from panic — 512 SPI writes fired synchronously caused ~1 second audio glitch and could deadlock `suspend_overtake`.

### 6.3 Step Buttons

Step buttons (notes 16–31) fire as `0x90` note-on. d2 > 0 = press, d2 = 0 = release. Toggle on press only.

### 6.4 Note Input

#### Step Entry (Transport Stopped or Playing)

Hold a step button to enter step edit mode for that step.

**Pad grid behavior while step held:**
- Layout stays in current isomorphic layout (no change)
- Notes assigned to that step light bright white
- Only notes within the currently visible octave range are shown — Up/Down buttons shift the visible octave range while step is held
- Press a pad to assign or remove that note from the step (toggle)
- If transport is stopped, pressing a pad plays the note as audio feedback
- If transport is playing, pad presses are silent
- Release step button to exit step edit mode
- Does not auto-advance — allows polyphonic chord entry on a single step

**Note defaults on entry:**
- Duration: step resolution (1/16 or 1/8 per track setting)
- Velocity: 96, or global input velocity override value if active

**Step note length:** Hold step button + press a step button to the right → sets note duration to span that many steps. (See roadmap item 16.)

**Step edit display and param menu:** When a step button with active notes is held, show a step edit overlay. Parameters adjust all notes in the step simultaneously:
- Relative velocity offset
- Relative length offset
- Relative octave transposition
- Relative scale-aware interval transposition
- Note nudge (sub-step timing offset, for use with real-time recorded notes) **[NOT BUILT — requires sub-step timing in step_t]**

#### Drum Track Step Entry

Same as melodic step entry except:
- Each note has its own sequencer lane, accessed by tapping the corresponding drum pad
- Lanes are monophonic — no hold-step-to-input paradigm
- No relative scaling of step edit params per note (each drum hit is independent)

#### Real-Time Recording ✅ BUILT (Phase 5n/5o/5p)

- **Arm:** Press Record (CC 86) while transport is stopped → 1-bar DSP-side count-in, then transport + recording start atomically from audio thread. While playing → arms immediately, no count-in. Record LED lights red.
- **Count-in:** JS calls `record_count_in` param from `onMidiMessageInternal`. DSP counts down one bar using the sequencer tick accumulator scaled to actual BPM. When complete, DSP atomically sets `playing=1` and `track.recording=1` from the audio thread. JS observes via `count_in_active` flag (26th value in `state_snapshot`). Step buttons flash bright white at 1/4 note intervals during count-in.
- **Pre-roll:** Pad presses in the last 1/16th of the count-in bar are written to step 0 via `_add` so notes land correctly on the downbeat.
- **Recording:** Notes played on pads are captured into the active clip at the current sequencer position via `tN_cC_step_S_add` (additive/overdub — never removes existing notes). Input is quantized to nearest step.
- **Disarm:** Press Record again at any time → disarms, triggers state save flush. Stop/panic also clears recording.
- **No auto-disarm** — recording stays active until user presses Record again.
- **Post-recording quantize:** Shift + Step 16 → moves all notes 50% closer to nearest grid position. Multiple presses converge. **[NOT BUILT]**

#### Transport LEDs
- Play button: ✅ lit green when transport is active
- Record button: ✅ lit red when recording is armed

### 6.5 Beat Stretch (TIMING Bank K1) — BUILT ✅

Destructive expand/compress of active clip step data. Preserves note count, changes spacing and clip length. Two operations only:

- **Expand (x2):** each active step at position N moves to N×2. Clip length doubles. Intermediate steps become inactive. Clamped at 256 steps.
- **Compress (/2):** each active step at position N moves to N÷2. Clip length halves. Blocked entirely if any two steps would map to the same destination (dry-run collision check). Shows "COMPRESS LIMIT" for 1500ms if blocked. Clamped at 1 step minimum.

Stretch factor tracked as signed exponent (stretch_exp) relative to original:
- 0 = 1x, +1 = x2, +2 = x4, -1 = /2, -2 = /4 etc.
- Display: "1x" at baseline, "x2"/"x4" for expand, "/2""/4" for compress

Knob behavior: momentary trigger. Accumulator threshold 16 ticks before firing. Locks after firing until touch released (MoveKnob1Touch, note 0). Direction reversal before threshold resets accumulator without firing.

DSP keys: tN_beat_stretch (set, 1=expand/-1=compress), tN_beat_stretch_factor (get, formatted string), tN_beat_stretch_blocked (get, 1=last compress was blocked)

### 6.6 Clock Shift (TIMING Bank K2) — BUILT ✅

Destructive rotation of the active clip's step data. Rotates all steps forward or backward by one position per operation. Wraps around — no data is lost. Persists to state file.

- Forward rotation (K2 right): last step wraps to position 0
- Backward rotation (K2 left): first step wraps to last position
- Accumulator divisor: 8 ticks per rotation step
- Direction reversal resets accumulator
- Rotation offset reset to 0 on transport stop and panic
- DSP keys: tN_clock_shift (set, direction 1/-1), tN_clock_shift_pos (get, display value)

### 6.7 Swing (Sequencer Engine Stage 7) **[NOT BUILT]**

Global, applied to final output timing after all stream processing.

| Parameter | Values | Description |
|-----------|--------|-------------|
| Swing amount | 50% – 75% | Timing offset percentage (50% = straight) |
| Swing resolution | 1/16 / 1/8 | Which subdivisions are swung |

### 6.8 Undo **[NOT BUILT]**

3 levels of undo/redo. Applies to: live recording, overdub, step toggling, print/bake, clip copy/paste/delete, scene copy/delete. Does not apply to parameter changes, mute/solo, BPM/key.

---

## 7. Play Effects Chain

### 7.1 Architecture

Per-track, real-time, non-destructive serial chain. All stages always present at neutral/passthrough defaults. MIDI never feeds back through the chain — delay echoes and all outputs go directly to MIDI Out only.

**Fixed chain order:**

```
Step Data (tick positions)
      ↓
[1. Beat Stretch]   ← destructive step data operation ✅
      ↓
[2. Clock Shift]    ← destructive step data rotation ✅
      ↓
[3. Note FX]        ← octave, offset, gate, velocity [BUILT — no UI for gate shortening]
      ↓
[4. Harmonize]      ← unison, octaver, two intervals [BUILT — no UI]
      ↓
[5. Arpeggiator]    ← sequencer arpeggiator [NOT BUILT]
      ↓
[6. MIDI Delay]     ← echo chain output, forward only [BUILT — no UI]
      ↓
[7. Swing]          ← global final timing [NOT BUILT]
      ↓
   MIDI Out (no feedback into chain)
```

Stages 3, 4, 6 are fully implemented in DSP (NoteTwist port) with neutral defaults. No UI parameter bank yet — all parameters are inaccessible until Track View banks are built.

**Implementation distinction:**
- Stages 1, 2, 7: operate on **step tick positions** in the sequencer engine before note dispatch
- Stages 3–6: **MIDI stream processors** — receive note events and transform or generate MIDI messages

### 7.2 Note FX (Stage 3) — BUILT (no UI)

Ported from NoteTwist stages 1 (octave transposer) and 3 (note page), merged.

| Parameter | Values | Description |
|-----------|--------|-------------|
| Octave shift | -4 – +4 octaves | Transposes all notes by octave |
| Note offset | -24 – +24 semitones | Shifts all notes by semitones (after octave) |
| Gate time | 0 – 400% | Scales note duration. 100% = no change |
| Velocity offset | -127 – +127 | Added to velocity, clamped 1–127 |

### 7.3 Harmonize (Stage 4) — BUILT (no UI)

Ported directly from NoteTwist stage 2.

| Parameter | Values | Description |
|-----------|--------|-------------|
| Unison | Off / x2 / x3 | Adds 1 or 2 copies of each note with ~5ms stagger |
| Octaver | -4 – +4 octaves | Adds one note N octaves above or below. 0 = off |
| Harmony 1 | -24 – +24 semitones | Adds harmony note at this interval. 0 = off |
| Harmony 2 | -24 – +24 semitones | Adds second harmony note at this interval. 0 = off |

All added notes mirror the note-off of their corresponding note-on.

### 7.4 Sequencer Arpeggiator (Stage 5) — **[NOT BUILT]**

New — not in NoteTwist. Arpeggiate result including harmonized voices from stage 4.

| Parameter | Values | Description |
|-----------|--------|-------------|
| On/off | bool | Enable/disable |
| Type | Up / Down / Alternate 1 / Alternate 2 / Random | Arpeggio pattern |
| Sort | Pitch order / Play order | Note ordering |
| Hold | bool | Hold last played notes |
| Octave range | 1 – 4 | Range in octaves |
| Speed | 1/32, 1/16, 1/8, 1/4, 1/2, 1/1 | Note division rate |

### 7.5 MIDI Delay (Stage 6) — BUILT (no UI)

Ported from NoteTwist stage 5. Output forward only — echoes to MIDI Out, never back into chain.

Tempo sync: rolling 24-tick window (ported from NoteTwist). Falls back to global BPM when clock stops.

| Parameter | Values | Description |
|-----------|--------|-------------|
| Delay time | 0, 1/64, 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4, 1/2, 1/1 | Time between repeats |
| Delay level | 0 – 127 | Velocity of first repeat |
| Repeats | 0 – 64 | Number of echo repeats. 0 = off |
| Velocity feedback | -127 – +127 | Velocity change per repeat |
| Pitch feedback | -24 – +24 semitones | Pitch shift per repeat |
| Pitch random | Off / On | Random ±12 semitones per repeat |
| Gate feedback | -100 – +100% | Gate time multiplier per repeat |
| Clock feedback | -100 – +100% | Delay time multiplier per repeat |

### 7.6 Live Arpeggiator (Global) **[NOT BUILT]**

Processes live pad input before recording buffer. Global — one instance, routes to focused track. Recordable (what gets recorded is the arpeggiated output). Independent settings from sequencer arpeggiator.

Same parameters as Sequencer Arpeggiator (§7.4).

**Complete signal flow including live arp:**

```
Pad Input
      ↓
[Live Arpeggiator]   ← global, recordable [NOT BUILT]
      ↓
  Recording buffer
      ↓
  Step Data
      ↓
[1–7. Play Effects Chain]
      ↓
   MIDI Out
```

### 7.7 Print / Bake **[NOT BUILT]**

Hold Sample button (CC TBD — check constants.mjs) during playback → SEQ8 continuously overwrites current clip's step data with chain output in real time. Release → chain snaps to neutral. Baked data plays back raw. Undoable.

### 7.8 Implementation Status Summary

| Stage | Component | Source | Status |
|-------|-----------|--------|--------|
| 1 | Beat Stretch | New (destructive step data) | ✅ Built |
| 2 | Clock Shift | New (destructive step rotation) | ✅ Built |
| 3 | Note FX | NoteTwist stages 1+3 port | ✅ Built, UI wired. Gate shortening fixed (Phase 5e). |
| 4 | Harmonize | NoteTwist stage 2 port | ✅ Built, UI wired |
| 5 | Seq Arpeggiator | New | **NOT BUILT** |
| 6 | MIDI Delay | NoteTwist stage 5 port | ✅ Built, UI wired |
| 7 | Swing | New (sequencer engine) | **NOT BUILT** |
| Global | Live Arpeggiator | New | **NOT BUILT** |

> **Known gap — live input bypasses play effects chain:** Live pad input is sent directly from JS via `shadow_send_midi_to_dsp`, completely bypassing the C DSP play effects chain. Harmonize and MIDI Delay (and all other chain stages) currently have no effect on live pad notes — they only process sequencer output from `render_block`. Two options for fixing: (A) route live pad input through the DSP chain (C-side path, cleaner architecture, latency implications to evaluate); (B) reimplement Harmonize and MIDI Delay in JS for the live path (keeps latency minimal, adds JS complexity). Design decision pending.

---

## 8. Clip Management

### 8.1 Clip ID System

Every clip has a coordinate ID: Track number (1–8) + Scene letter (A–P). Example: `3-C` = track 3, scene 3.

### 8.2 Setting Clip Length ✅ BUILT

Hold Loop (CC 58) + press step button N → clip length = (N+1) × 16 steps (range: 16–256 steps, 1–16 pages).

While Loop is held:
- Step LEDs show pages-in-use (bright track color) vs unused (DarkGrey)
- Display shows: "LOOP LEN: N STEPS / M OF 16 PAGES"
- Current page is clamped to new last page on shrink

> **Known gap:** Clip length changes are not persisted to `seq8-state.json` on cold boot. The DSP `_length` set_param does not call `seq8_save_state`. Acceptable for now.

### 8.3 Clip Operations **[NOT BUILT]**

| Operation | Access | Undoable |
|-----------|--------|----------|
| Create | Record into empty slot | Yes |
| Delete | Delete button + select clip | Yes |
| Copy | Copy button + select clip | Yes |
| Copy scene | Copy button + scene row | Yes |
| Delete scene | Delete button + scene row | Yes |

### 8.4 Mute Scene Save/Recall **[NOT BUILT]**

Mute + Shift + step 1–16 stores mute state snapshot. Mute + step recalls. Session View only.

---

## 9. MIDI Routing

### 9.1 Confirmed Routing Architecture

> **Major finding from development:** The original spec assumed `internal` routing could reach specific native Move tracks or Schwung chains via MIDI channel. This was exhaustively tested and disproved. Current state:

**All 8 SEQ8 tracks → `midi_send_internal` → active Schwung chain only.**

MIDI channel in the status byte does NOT route to different chains. Hardware test confirmed: channel 2 did not reach a chain configured to receive on channel 2. `midi_send_internal` reaches only whichever chain is currently active in the current scene, regardless of channel.

Users can layer SEQ8 tracks by setting all Schwung chains to receive on all channels (omni mode).

### 9.2 What Was Tested and Failed (Route to Multiple Chains)

All of the following were implemented and tested on hardware. All failed:

- `dlsym(RTLD_DEFAULT, "move_midi_inject_to_move")` — always returns NULL (shim exports zero dynamic symbols)
- `move_midi_inject_to_move` as JS global — exists and callable, but injects pad press simulation (notes 68–99) only, not arbitrary-pitch note sequencing
- JS bridge (C DSP → param queue → JS → inject) — fails for same reason above
- MIDI channel routing via `midi_send_internal` — hardware confirmed single chain only
- USB-A loopback — impossible, both ports are host
- `/schwung-midi-inject` SHM — struct layout unknown, no safe write path

`ROUTE_MOVE` is reserved as a label but currently equivalent to `ROUTE_SCHWUNG`.

### 9.3 External MIDI (ROUTE_EXTERNAL)

`ROUTE_EXTERNAL` is defined in DSP. `midi_send_external` sends to USB-A via SPI hardware.

> **CRITICAL:** Never call `midi_send_external` from the render path. SPI I/O is blocking — calling it in `render_block()` causes audio cracking and can deadlock `suspend_overtake`. Safe only from a deferred JS queue.

External routing is not wired through UI. Will be exposed via Track View MIDI bank (bank 7) when Track View is built.

WIDI Bud Pro confirmed working for wireless USB-A MIDI.

### 9.4 JS Routing Reference

| Function | Purpose | Notes |
|----------|---------|-------|
| `shadow_send_midi_to_dsp([status, d1, d2])` | Live pad MIDI → Schwung chain | Confirmed working in api_version 2 + DSP tool modules. Used for live pad input only. |
| `host->midi_send_internal` (C) | Sequencer MIDI → Schwung chain | Used in `render_block()` for all sequencer output |
| `move_midi_external_send([...])` | USB-A external MIDI | Safe from JS tick (deferred); never from render path |
| `move_midi_inject_to_move([...])` | Pad press simulation | Notes 68–99 only — not instrument pitch routing |
| `move_midi_internal_send([...])` | Move hardware MIDI (LEDs, buttons) | Not for instrument notes |

---

## 10. Background Running ✅ BUILT

- **Hide:** Shift + Back → `host_hide_module()` → `hideToolOvertake()`. DSP stays alive, MIDI continues playing. Returns to Tools menu.
- **Re-entry:** Select SEQ8 from Tools menu → `startInteractiveTool()` detects `dspAlreadyLoaded=true` → reconnect branch (no `overtake_dsp:load`; JS-only reload). Brief loading screen on re-entry is expected and correct.
- **Hard exit:** Only occurs if another tool loads while SEQ8 is hidden (replaces `overtakeModuleLoaded`). Cold boot recovery via state file.
- **Cold boot recovery:** `create_instance` reads `/data/UserData/schwung/seq8-state.json` to restore clips and transport state.
- **Power button:** Not a MIDI event. Sends D-Bus signal — JS cannot intercept. Always hide SEQ8 (Shift+Back) before powering down.
- **JS state reset on re-entry:** `shadow_load_ui_module()` re-evaluates entire `ui.js` on every re-entry. `init()` calls `host_module_get_param` to recover all DSP state (1024 step reads + transport/track state).

---

## 11. Performance Findings

### 11.1 Live Pad Latency

- **Floor: ~3–7ms** — structural, cannot be closed
- JS runtime ticks at ~196Hz (~5.1ms per tick). A pad press arriving mid-tick waits up to 5ms plus dispatch overhead
- No C-level hook exposed to tool modules; native Move performance mode unavailable

### 11.2 Poll Optimization

- `pollDSP()` called every 4 ticks (`POLL_INTERVAL = 4`, ~49Hz) — not every tick
- Batch `state_snapshot` param: replaces 25 individual `host_module_get_param` calls with one IPC call
  - Format: `"playing cs0..cs7 ac0..ac7 qc0..qc7"` (25 space-separated ints)
- `isNoiseMessage` filter: drops 0xA0 (poly aftertouch) and 0xD0 (channel aftertouch) at top of `onMidiMessageInternal` — high-frequency pressure grid noise

### 11.3 MIDI Buffer

300+ packets per burst with zero drops. 64 packets/frame is a safe working limit, not a hard ceiling.

---

## 12. What Remains to Build (Suggested Order)

| Priority | Feature | Notes |
|----------|---------|-------|
| 1 | **Track View parameter banks** | ✅ Complete. All 8 banks built, knob touch display, jog touch, 2s timeout, per-track bank memory. |
| 2 | **Beat Stretch + Clock Shift** | ✅ Complete. Both destructive step data operations. |
| 2a | **Gate time shortening fix** | ✅ Complete. Per-step `step_gate`/`step_gate_orig` arrays; noteFX_gate destructively scales all active steps. |
| 2b | **Polyphonic step data model** | ✅ Complete (Phase 5f/5k). `step_notes[256][4]` + `step_note_count[256]`. New params: `tN_cC_step_S_notes` (get), `tN_cC_step_S_toggle` (set), `tN_cC_step_S_clear` (atomic step clear), `tN_cC_clear` (atomic clip clear). State file persists note data (version-gated, v=2). |
| 3 | **Step entry — melodic** | ✅ Complete (Phase 5g/5h/5i/5k/5l). Hold step → step edit mode. Tap pads to assign/remove notes. Tap step to toggle on/off. Multi-step simultaneous tap. Playback head shows bright white. Pad grid always reflects sounding notes. |
| 3-fix | **Volume knob (CC 79)** | `claims_master_knob: true` causes firmware to skip its own CC 79 handler and forward to SEQ8. `host_get_volume()` / `host_set_volume(int)` are the correct API but fix is not yet working. On backburner. |
| 3a | **Step entry — drum** | Per-note lanes, monophonic, tap drum pad to access lane. |
| 3b | **Real-time recording** | ✅ Complete (Phase 5n/5o/5p). Press Record while stopped → 1-bar DSP count-in (step buttons flash white) → transport + recording start atomically. Press Record while playing → arm immediately. Additive overdub via `tN_cC_step_S_add`. Manual disarm. Play LED green, Record LED red. |
| 3b-fix | **Count-in** | ✅ Complete (Phase 5p). DSP-side count-in timer, atomic transport+record start from audio thread, pre-roll capture for downbeat notes. |
| 3c | **Post-recording quantize** | Shift + Step 16 → 50% snap toward grid. Multiple presses converge. |
| 3d | **Global menu** | Jog click enters. Jog turns navigate, jog click confirms, Back exits. Contains: root note, scale, BPM, swing amount, swing resolution, incoming velocity override, input quantize toggle, metronome volume. |
| 3e | **Session Overview display** | ✅ Complete (Phase 5m). Hold CC 50 → full-display 8×16 graphical clip grid. Solid fill = active clip, center bar = has content, empty = unlit, blink = active clip on active track. Release returns to previous view. Tap still switches views. |
| 3f | **Delete key combos** | ✅ Complete (Phase 5j/5k). Delete + step = atomic step clear (`tN_cC_step_S_clear`). Delete + track button = atomic clip clear (`tN_cC_clear`). Delete + clip pad (Session View) = clear that clip. |
| 3f-fix | **Delete + track button clip targeting** | Currently Delete + track button always clears the active clip regardless of which track button is pressed. Should clear the clip corresponding to that track button's position in the visible scene group, without switching the active clip. **Pending.** |
| 3g | **Jog wheel bank + track navigation** | Jog wheel (no modifier) cycles through parameter banks in Track View. Shift + jog cycles through tracks 1–8. Both additive to existing Shift + pad methods. |
| 4 | **Arpeggiator (Seq + Live)** | New DSP build — not in NoteTwist. |
| 5 | **Mute/Solo** | Full implementation — mute/solo per track, Session View pad control, reset via Mute+Undo. |
| 6 | **Drum + Chromatic pad modes** | Pad layout expansion. Set via TRACK bank Mode param. |
| 7 | **Clip-specific data model restructure** | Move play_fx from track_t to clip_t. Schedule after full play effects chain complete. |
| 8 | **External MIDI routing UI** | Wire ROUTE_EXTERNAL through TRACK bank. Deferred JS queue. |
| 9 | **Print / Bake** | Hold Sample button (CC 118). |
| 10 | **Project save/load** | .sq8 format, project browser. |
| 11 | **Swing** | Sequencer engine, global. |
| 12 | **Metronome** | Audio click, volume via CC 79. |
| 13 | **MIDI Clock I/O** | Master/slave. |
| 14 | **Undo/Redo** | 3-level. |
| 15 | **Velocity sensitivity** | Fixed at Math.max(80, d2) currently. |
| 16 | **Step note length editing** | Hold step + tap step to the right to set note-off point. |
| 17 | **Note nudge** | Per-note sub-step timing offset in step edit params. Requires sub-step timing in step_t. |
| 18 | **Mute scene save/recall** | Mute + Shift + step stores snapshot. |
| 19 | **Step button out-of-bounds indicator** | ✅ Complete. Steps beyond clip length show white. |
| 20 | **Clip blink state** | Queued clips not yet blinking. |
| 21 | **Mute/solo display** | Session View line 4 not correctly implemented. |
| x.1 | **Chord input: hold pads + press step** | Hold one or more pads then press a step button to additively assign all held notes to that step. Attempted in Phase 5l — root cause is MIDI queue ordering: pad note-ons queued after the step press haven't been processed when capture fires; phantom note-off/note-on pairs add a secondary race. Deferred settling window approach was tried but felt unreliable. Needs a more robust architecture — deferred to v1.1. |
| x.1 | **Per-lane loop length (drum tracks)** | Each note lane in a drum track has its own independent loop length, enabling polyrhythmic patterns within a single clip (e.g. kick on 16 steps, hi-hat on 12). Requires data model extension: per-lane length field in drum clip structure. |
| x.1 | **Euclidean sequencing (drum tracks)** | Per-lane euclidean rhythm generation — distribute N hits across M steps using Bjorklund algorithm. Applied per note lane. Works with per-lane loop length. |

---

## 13. Module Structure

```
~/schwung-seq8/
  module.json
  ui.js                  ← QuickJS UI (JavaScript)
  dsp/
    seq8.c               ← Sequencer engine (C, ARM64)
  scripts/
    build.sh             ← Docker ARM64 cross-compile
    install.sh           ← SSH deploy to move.local
  Dockerfile
  CLAUDE.md              ← CC reads automatically on session start
```

### module.json (confirmed working)

```json
{
  "id": "seq8",
  "name": "SEQ8",
  "version": "0.1.0",
  "api_version": 2,
  "abbrev": "SEQ8",
  "component_type": "tool",
  "tool_config": {
    "interactive": true,
    "skip_file_browser": true
  },
  "capabilities": {
    "midi_in": true,
    "midi_out": true,
    "claims_master_knob": true
  }
}
```

> **Critical:** Do NOT set `raw_midi: true` or `raw_ui: true` in capabilities. These cause a shim crash on boot for api_version 2 modules with DSP binaries.

---

## 14. Key Files

| File | Path |
|------|------|
| DSP | `~/schwung-seq8/dsp/seq8.c` |
| UI | `~/schwung-seq8/ui.js` |
| CLAUDE.md | `~/schwung-seq8/CLAUDE.md` |
| Log | `/data/UserData/schwung/seq8.log` |
| State | `/data/UserData/schwung/seq8-state.json` |
| NoteTwist reference | `~/schwung-notetwist/src/notetwist.c` |
| RS7000 manual | Project files: `RS7000E1.pdf` (pages 87–93 = Play Effects) |
| Schwung constants | `/data/UserData/schwung/shared/constants.mjs` |

---

## 15. Deploy + Debug

```bash
# Build and deploy
./scripts/build.sh && ./scripts/install.sh

# Watch log
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"

# GLIBC check — run after every build
nm -D dist/seq8/dsp.so | grep GLIBC

# Start CC
cd ~/schwung-seq8
claude --dangerously-skip-permissions
```

---

## 16. Build Notes — Known Pitfalls

### 16.1 GLIBC Version (Critical)

Move's libc tops out at **GLIBC 2.35**. Ubuntu 24.04 / GCC 13 compiles `atoi()` as `__isoc23_strtol@GLIBC_2.38`. Module silently fails to load.

**Solution:** Use `my_atoi()`, `my_atof()` — inline equivalents. Verify after every build:
```bash
nm -D dist/seq8/dsp.so | grep GLIBC
```
No symbols above 2.35 should appear.

### 16.2 Normal vs Error Boot Messages

`[CRASH] [shim] Shim init: pid=NNN ppid=NNN` — **This is a NORMAL startup message** written by the Schwung shim every boot. Not an error. Only worry if it repeats without resolving.

### 16.3 midi_send_external

**Never call from render path.** SPI I/O is blocking — causes audio cracking and can deadlock `suspend_overtake`. Only call from deferred JS queue.

### 16.4 Do Not Load SEQ8 from Within SEQ8

Selecting SEQ8 from the Tools menu while already inside SEQ8 causes LED corruption. The Tools menu button sets `SHADOW_UI_FLAG_JUMP_TO_TOOLS` (0x80) via ui_flags; `onMidiMessageInternal` is never called so it cannot be intercepted. Workaround: hide first (Shift+Back), then re-enter from Tools menu.

### 16.4.1 LED State on Exit to Native UI

Exiting SEQ8 back to the native Move UI (via Shift+Back or tool exit) can leave LEDs in a corrupted state in the native UI — pads and buttons may show wrong colors or remain lit. This generally resolves after some user interaction with the native UI. Root cause not yet investigated — likely SEQ8 is not fully restoring LED state on exit. Known issue, not yet fixed.

### 16.5 Power Button

Not a MIDI CC — D-Bus signal. The shim detects it and shows "Press wheel to shut down." Encoder push (note 3) confirms. Always exit SEQ8 (Shift+Back) before powering down.

### 16.6 Static Initializers

Avoid complex global/static variable initializers. Initialize all DSP state in explicit `seq8_init()` called from `create_instance()`, not at static scope.

### 16.7 BPM Caching

Cache BPM every 512 render blocks — not every block. Accessing host BPM per-block can cause crashes at host API boundaries.

### 16.8 LED Palette

Fixed 128-entry color index palette — **NOT a brightness scale**. Adjacent values are unrelated colors. Always use explicit dim palette partners for each track color. Low arbitrary index values show that palette slot's color, not a dim version of the intended color.

### 16.9 Sequence of Operations: MIDI Panic

Use `midi_send_internal` only for panic. 128 notes × all active channels via `midi_send_external` = hundreds of synchronous SPI writes → ~1 second audio glitch + potential deadlock.

---

## 17. RS7000 Reference

The full RS7000 Owner's Manual is in project files (`RS7000E1.pdf`). Pages 87–93 cover Play Effects parameters in detail. Reference when implementing Track View parameter banks and arpeggiator to verify parameter ranges and behaviors match the original hardware inspiration.

---

*End of SEQ8 Specification v0.2 — Built through Phase 5p*

---

## 18. Development Workflow

### Roles
- **Claude.ai (this session)** — planning, spec maintenance, prompt authoring, architecture decisions, interpreting CC output, troubleshooting. Has access to project files. Cannot access the device directly.
- **Claude Code (CC)** — coding, building, deploying, testing on hardware. Reads CLAUDE.md and SEQ8_SPEC.md from the repo at `~/schwung-seq8/`. Cannot access Claude.ai project files.

### Session Workflow
1. **Research** — CC reads files and reports findings only, no code written
2. **Plan** — Claude.ai designs implementation based on CC's report
3. **Fresh CC session** — new terminal session (`cd ~/schwung-seq8 && claude --dangerously-skip-permissions`). CC reads CLAUDE.md automatically on start.
4. **Implement** — single focused task per session
5. **Test** — on hardware, report results to Claude.ai
6. **CLAUDE.md update** — CC updates CLAUDE.md at end of every session before closing
7. **Spec update** — Claude.ai updates SEQ8_SPEC.md in Claude.ai outputs; human copies to device as `~/schwung-seq8/SEQ8_SPEC.md`

### Key Rules
- Claude.ai always provides CC prompts in a single copyable text block
- CC sessions are kept short and focused — one task per session
- All prompts from Claude.ai include explicit read-first instructions
- Claude.ai updates the spec incrementally after every design decision — no full rewrites
- Spec is dated on output (e.g. SEQ8_SPEC_2026-04-21.md) for version tracking; device copy is always SEQ8_SPEC.md (undated)
- New Claude.ai sessions: re-upload latest dated spec to project files and tell Claude.ai we're continuing SEQ8 development

### File Locations
- CLAUDE.md: `~/schwung-seq8/CLAUDE.md` — CC's working reference (implementation details, param keys, struct fields, known pitfalls)
- SEQ8_SPEC.md: `~/schwung-seq8/SEQ8_SPEC.md` — design authority (what the module does and why)
- State file: `/data/UserData/schwung/seq8-state.json`
- Log: `/data/UserData/schwung/seq8.log`
