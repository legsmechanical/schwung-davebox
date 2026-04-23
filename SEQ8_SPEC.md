# SEQ8 — Design Specification
**April 2026 | Read alongside CLAUDE.md. This document covers design intent and behavior. CLAUDE.md covers implementation details.**

SEQ8 is a Schwung tool module for Ableton Move: a standalone 8-track MIDI step sequencer inspired by the Yamaha RS7000. No audio output.

---

## 1. Hardware Reference

### CC / Note Map

| Control | CC / Note | SEQ8 Function |
|---------|-----------|---------------|
| Pads 1–32 | Notes 68–99 | Live note input / clip launch / step edit |
| Step buttons 1–16 | Notes 16–31 | Step toggle / page nav / scene map / clip length |
| Track buttons 1–4 | CCs 43–40 (reversed) | Clip select (Track View) / scene row launch (Session View) |
| Knobs 1–8 | CCs 71–78 | Parameter control. Relative: CW=1–63, CCW=64–127 |
| Knob touches 1–8 | Notes 0–7 | Touch on=127, off=0–63 |
| Volume encoder | CC 79 | Move system volume — do not consume **[BROKEN — fix pending]** |
| Jog wheel rotate | CC 14 | Track View: cycle banks (no modifier, clamped 0–6) / cycle tracks (Shift, clamped). Session View: scroll one row at a time (clamped). Global menu: menu navigation. |
| Jog wheel click | **CC 3 (0xB0)** | Menu confirm / power-down. NOT a note-on — fires as 0xB0. |
| Jog wheel touch | Note 9 | Swallowed — no behavior. |
| Shift | CC 49 | Modifier |
| Play | CC 85 | Start/stop transport. LED: green when playing |
| Record | CC 86 | Recording arm/disarm. LED: red when armed |
| Mute | CC 88 | Mute current track |
| Delete | CC 119 | Held modifier for clip/step clear |
| Undo | CC 56 | [NOT BUILT] |
| Copy | CC 60 | [NOT BUILT] |
| Sample | CC 118 | Print/bake [NOT BUILT] |
| Back | CC 51 | Exit / return |
| Note/Session toggle | CC 50 | Tap=switch views, Hold=Session Overview, Shift+tap=Global Menu |
| Up | CC 55 | Scene group scroll (Session) / octave up per track (Track) |
| Down | CC 54 | Scene group scroll (Session) / octave down per track (Track) |
| Left | CC 62 | Previous step page |
| Right | CC 63 | Next step page |
| Loop | CC 58 | Hold + step = set clip length |

### Pad Layout (bottom to top)
```
Top row (near display):  pads 25–32  notes 92–99
Row 3:                   pads 17–24  notes 84–91
Row 2:                   pads  9–16  notes 76–83
Bottom row (near user):  pads  1–8   notes 68–75
```

### Combos & Modifiers

| Combo | Function | Status |
|-------|----------|--------|
| Shift + Play | Deactivate all active clips (stop at next 16-step page boundary; immediate if transport stopped) | ✅ |
| Delete + Play | MIDI panic | ✅ |
| Shift + Back | Hide SEQ8 (background run) | ✅ |
| Shift + CC 50 | Open Global Menu (Track View only) | ✅ |
| Shift + bottom pads (68–75) | Track select 1–8 | ✅ |
| Shift + top pads (92–99) | Parameter bank select | ✅ |
| Hold CC 50 | Session Overview display | ✅ |
| Loop + step button | Set clip length | ✅ |
| Delete + step button (Track View) | Atomically clear step | ✅ |
| Delete + track button (Track View) | Clear clip at that track button's scene position | ✅ |
| Delete + clip pad (Session View) | Clear that clip | ✅ |
| Step button (Session View) | Navigate scene group; tapping scrolls view so selected row is at top | ✅ |
| Shift + step (Session View) | Launch scene row | ✅ |
| Jog rotate, Track View, no Shift | Cycle banks 0–6, clamped (no wrap) | ✅ |
| Shift + jog rotate, Track View | Cycle tracks 0–7, clamped (no wrap) | ✅ |
| Jog rotate, Session View | Scroll one row at a time, clamped at first/last | ✅ |
| Shift + jog, Session View | No-op | ✅ |
| Mute + Undo | Clear all mutes/solos | NOT BUILT |

---

## 2. Data Model

### Project
- **BPM:** SEQ8-owned (40–250). Read from `get_bpm()` once at init as default. User controls via global menu only — do NOT poll or overwrite after init.
- **Key:** global root note (A–G#)
- **Scale:** global scale type
- **Swing:** global [NOT BUILT]
- 8 tracks × 16 scenes × 256 steps per clip

### Track
- Modes: `drum` | `melodic_chromatic` | `melodic_scale`
- Per-track: MIDI channel (1–16, user-controllable), route (SCHWUNG/EXTERNAL, user-controllable), octave (−4..+4), mute [NOT BUILT], solo [NOT BUILT]
- Play effects chain per track (see §5)
- Colors: T1=Red(127/65), T2=Blue(125/95), T3=Yellow(7/29), T4=Green(126/32), T5=Magenta, T6=Cyan, T7=Orange, T8=SkyBlue
- LED palette is a fixed 128-entry color index — NOT a brightness scale. Always use explicit dim palette partners.

### Clip
- ID: track(1–8) × scene(A–P). Example: `3-C` = track 3, scene C.
- Length: 16–256 steps (16-step pages; 1–16 pages)
- One clip active per track at a time
- Legato launch: `new_position = old_position % new_clip_length`
- Empty scene slot on scene launch → that track stops
- Clips can be deactivated (stop at end of current loop). Deactivated state: `clip_stopped=1`, playback head frozen, no note-ons fired.

### Step
- Up to 4 notes per step (chord entry)
- Invariant: `steps[s]==1` iff `step_note_count[s]>=1` — must always hold
- Fresh/cleared steps: `step_note_count=0` (no notes)
- Per-step: velocity, gate (default: 12 of 24 ticks per step)

### State File
- Path: `/data/UserData/schwung/seq8-state.json`
- Version-gated (`"v":2`) — wrong/missing version deletes file and starts clean. Bump `v` for any format change.
- Persists: `steps[]`, `length`, `active_clip`, `step_notes`/`step_note_count` (sparse), per-track channel (`t%d_ch`), per-track route (`t%d_rt`)
- Does NOT persist: `step_vel`, `step_gate`, clip lengths, `stretch_exp`

---

## 3. Views

### Track View (default on boot)

**Step buttons:** Tap = toggle step on/off (preserves note data). Hold (~200ms) = enter step edit mode. Multiple steps can be tapped simultaneously. Playback head always shows bright white regardless of step active state. Playback head freezes when clip is deactivated.

**Track side buttons (CCs 43–40):** Select which clip is active on the current track. The button corresponding to the active clip always shows bright solid track color, regardless of clip content. Tapping the active clip's button deactivates it (stop at end of current loop). Tapping a non-active clip launches it.

**Pad grid:** Isomorphic 4ths diatonic layout. Root pad = bright track color, other scale pads = dim track color. Always highlights currently sounding notes in bright white (sequencer + live input combined).

**Step Edit Mode (hold step):**
- Notes assigned to that step light bright white on pad grid
- Tap pad = toggle note assignment on/off (up to 4 notes per step)
- Up/Down shifts visible octave range (reuses `trackOctave`)
- Audio preview fires on pad tap if transport stopped
- Display: track/clip/step header + note names (e.g. "C4 E4 G4" or "(empty)")
- Release step button to exit

**Parameter Banks:** Shift + top pad row (92–99) selects bank. Active bank persists when switching tracks. **[BANK PERSISTENCE NOT YET BUILT]**

| Pad | Bank | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|-----|------|----|----|----|----|----|----|----|----|
| 92 | TRACK | Ch | Route | Mode | Res | Len | — | — | — |
| 93 | TIMING | Stretch | Shift | — | — | — | — | — | — |
| 94 | NOTE FX | Oct | Ofs | Gate | Vel | — | — | — | — |
| 95 | HARMZ | Unis | Oct | Hrm1 | Hrm2 | — | — | — | — |
| 96 | SEQ ARP | On | Type | Sort | Hold | OctR | Spd | — | — |
| 97 | MIDI DLY | Dly | Lvl | Rep | Vfb | Pfb | Gfb | Clk | Rnd |
| 98 | LIVE ARP | On | Type | Sort | Hold | OctR | Spd | — | — |
| 99 | Reserved | — | — | — | — | — | — | — | — |

**Ch (K1, TRACK bank):** Per-track MIDI channel, 1–16, 1-indexed display. Default: track N sends on channel N+1.
**Route (K2, TRACK bank):** Per-track destination — Schwung internal or external USB-A. Default: all tracks internal. External sends use deferred JS ext_queue — never midi_send_external from DSP render path.

**Display priority (highest to lowest):**
1. Compress Limit overlay (~1500ms)
2. Octave overlay (~1000ms)
3. Step edit (step held) — header + note names
4. Knob touched — parameter name highlighted on bank overview **[HIGHLIGHT NOT YET BUILT — currently shows edit overlay]**
5. Jog touched or bank-select timeout (~2000ms) — 4-knob overview
6. Normal — track/clip/page header

**While Loop held:** Shows "LOOP LEN: N STEPS / M OF 16 PAGES"

### Session View

- 32 pads = 8 tracks × 4 visible scenes. Dim = has content, bright = active/playing.
- Tapping an active clip pad deactivates it (stop at end of current loop). Tapping again while pending cancels. Clips with pending stop show as inactive immediately in LED state.
- Step buttons = scene map (bright=visible, dim=has clips, unlit=empty). Tapping a step button scrolls view so that row appears at the top. Step buttons reflect current view position.
- Up/Down (CC 55/54) scroll scene groups (4 rows at a time).
- Jog rotate scrolls one row at a time, clamped at first/last row. Step buttons update to reflect position.
- Track buttons = launch all clips in visible scene row (launch_scene).
- Shift + step button = launch scene row.

### Session Overview (hold CC 50) ✅
Full-display 8×16 graphical grid (16×4px per cell). Empty=unlit, has content=center bar, active clip=solid fill, active clip on active track=blinking. Input swallowed. Release returns to previous view.

### Global Menu (Shift + CC 50) ✅
Schwung platform menu framework. Jog rotate = navigate, CC 3 = confirm/edit, Back = exit/cancel. Global menu only captures jog inputs (CC 14, CC 3) — all other inputs (pads, shift, track buttons, etc.) pass through normally while menu is open.
Items: BPM (40–250, real-time preview, Back cancels), Key, Scale, Swing [stub], Velocity override [stub], Input quantize [stub], Save + Unload [NOT BUILT].

---

## 4. Sequencer Engine

- 96 PPQN. All MIDI scheduling in C `render_block()`.
- BPM owned by SEQ8. Updated via `set_param("bpm")` from global menu. Do not add polling.
- Transport: Play while stopped = start from bar 1. Play while playing = stop. Shift+Play = deactivate all active clips. Delete+Play = panic.
- Panic uses `midi_send_internal` only (never `midi_send_external` — blocks render path).
- Clip deactivation on transport play: any track with `pending_stop=1` is immediately converted to `clip_stopped=1` on the control thread before `playing=1` is set — no race with audio thread.

### Real-Time Recording ✅
- Record (CC 86) while stopped → JS calls `record_count_in` param → DSP counts down 1 bar → atomically sets `playing=1` + `track.recording=1` from audio thread. Step buttons flash white at 1/4 note during count-in.
- Record while playing → arms immediately, no count-in.
- Recording is additive overdub via `tN_cC_step_S_add`. Never removes existing notes.
- Pre-roll: pads pressed in last 1/16th of count-in write to step 0.
- Disarm: press Record again, or Stop/panic.
- Record arm is global — switching tracks while armed should immediately begin recording into the newly active track. **[NOT YET BUILT]**
- Recorded notes should capture actual note length (note-on to note-off duration) rather than defaulting to step gate. **[NOT YET BUILT]**

---

## 5. Play Effects Chain

Per-track, non-destructive. Fixed order:
```
Step Data → [Beat Stretch ✅] → [Clock Shift ✅] → [Note FX ✅] → [Harmonize ✅] → [Seq Arp ✗] → [MIDI Delay ✅] → [Swing ✗] → MIDI Out
```

**CRITICAL KNOWN GAP:** Live pad input goes via `liveSendNote` JS helper (honors Ch/Rte), but bypasses the DSP play effects chain entirely. Harmonize and MIDI Delay have no effect on live notes. Do not attempt to fix without a design decision — options are (A) route live through DSP chain, (B) reimplement in JS. Unresolved.

### Beat Stretch (TIMING K1) ✅
Destructive. Expand (×2) doubles, Compress (÷2) halves. Compress blocked on step collision — shows "COMPRESS LIMIT" overlay.

### Clock Shift (TIMING K2) ✅
Destructive rotation. All steps shift forward/backward one position. Wraps.

### Note FX (NOTE FX bank) ✅
Oct (−4..+4 oct), Offset (−24..+24 semitones), Gate (0–400%), Velocity offset (−127..+127).

### Harmonize (HARMZ bank) ✅
Unison (off/×2/×3), Octaver (−4..+4), Harmony 1 (−24..+24 semitones), Harmony 2 (−24..+24 semitones).

### MIDI Delay (MIDI DLY bank) ✅
Time, Level, Repeats (0–64), Vel/Pitch/Gate/Clock feedback, Pitch random. Forward-only echoes.

### Arpeggiator [NOT BUILT]
SEQ ARP (bank 96): Up/Down/Alt1/Alt2/Random, Sort, Hold, OctRange (1–4), Speed (1/32..1/1).
LIVE ARP (bank 98): same params, operates on live pad input only, recordable.

### Swing [NOT BUILT]
Global. Amount 50–75%, Resolution 1/16 or 1/8. Applied last before MIDI Out.

---

## 6. Clip Management

### Clip Length ✅
Loop (CC 58) + step N → length = (N+1)×16 steps (16–256). Known gap: not persisted on cold boot.

### Clip Deactivation ✅
- Tap active clip pad (Session View) or active track side button (Track View) → stop at end of current loop (`pending_stop=1`). Tap again while pending → cancel.
- Shift+Play → deactivate all active clips. Stop at next 16-step page boundary when transport running; immediate when stopped.
- Transport stopped → immediate deactivation (sets `clip_stopped=1` directly).
- On stop: `clip_stopped=1`, playback head freezes, note-ons suppressed. Re-launching via `tN_launch_clip` clears both `pending_stop` and `clip_stopped`.
- Transport persistence: `clip_stopped` state is preserved across transport stop/start. On transport play, any `pending_stop=1` tracks are immediately converted to `clip_stopped=1` on the control thread before `playing=1` is set — prevents note-ons slipping through on first audio buffer.
- LED: clips with `pending_stop=1` immediately show as inactive — do not wait for DSP polling cycle.

### Clip Operations [NOT BUILT]
Copy/Delete via Copy (CC 60) / Delete (CC 119) + clip pad or scene row. All undoable.

### Mute Scene Save/Recall [NOT BUILT]
Mute + Shift + step stores snapshot. Mute + step recalls. Session View only.

---

## 7. MIDI Routing

Per-track channel (Ch, K1 TRACK bank) and destination (Route, K2 TRACK bank) are user-controllable.

**Defaults:** Track N → channel N+1, destination = Schwung internal. Matches previous hardwired behavior.

**Internal (Schwung):** `midi_send_internal` → active Schwung chain. MIDI channel does NOT route to different Schwung chains — hardware confirmed. Users layer tracks by setting chains to omni mode.

**External (USB-A):** Uses deferred JS ext_queue pattern. DSP writes outgoing events to `ext_queue` ring buffer (64 slots). JS tick loop drains via `move_midi_external_send`. **Never call `midi_send_external` from the DSP render path — blocks SPI, can deadlock.**

Live pad input honors Ch/Rte per track via `liveSendNote(t, type, pitch, vel)` JS helper.

---

## 8. Features Not Yet Built

The following are specced but not implemented. Do not build without being asked:
- Drum mode pad layout + per-lane sequencing
- Chromatic mode pad layout
- Mute/Solo
- Arpeggiator (Seq + Live)
- Swing
- Step edit param overlay (vel/length/oct/interval while step held)
- Post-recording quantize (Shift + Step 16)
- Bank overview display fix (8 params, all values visible)
- Parameter edit display: replace knob edit overlay with highlighted param name on bank overview
- Scale definitions in DSP + scale-awareness toggles
- Undo/Redo
- Print/Bake (CC 118)
- Project save/load
- Global menu: Save + Unload option
- Clip copy/delete operations
- Metronome / MIDI Clock I/O
- Clip blink state (queued)
- Knob bank persists when switching tracks
- Live recording carries over to newly selected track (record arm is global)
- Recorded note length captures actual note-on to note-off duration
- Track View always shows active clip or last-active clip if no clip currently active
- MIDI clock sync via cable 2 (DSP reads 0xF8 on cable 2 via on_midi, exposes transport_playing/detected_bpm/ppqn24 as params, JS reads on tick())

---

## 9. Critical Pitfalls

- **GLIBC max 2.35** — use `my_atoi()`/`my_atof()`. Verify: `nm -D dist/seq8/dsp.so | grep GLIBC`
- **`seq8_save_state` in `tick()`** — blocks and fails silently. Always trigger saves from `onMidiMessageInternal`.
- **`midi_send_external` in render path** — blocks SPI, causes audio cracking, can deadlock. Always use deferred JS ext_queue for external MIDI.
- **`raw_midi: true` or `raw_ui: true`** — causes shim crash on boot. Do not set.
- **Jog click is CC 3 (0xB0)** — not a note-on. Handle in CC block, not note block.
- **Jog touch (Note 9)** — swallowed, no behavior. Do not add handling.
- **Do not load SEQ8 from within SEQ8** — LED corruption. Hide first (Shift+Back), then re-enter.
- **BPM:** `get_bpm()` called once at init only. Do not add periodic polling.
- **Transport/BPM sync:** `get_clock_status()` is NULL in v0.9.7 — do NOT use. Correct approach: read raw MIDI clock (0xF8) on cable 2 via on_midi. Not yet implemented.
- **Step invariant** — `steps[s]==1` iff `step_note_count[s]>=1`. Both sides must be updated atomically.
- **State file version** — currently `"v":2`. Bump `v` for any format change; old files auto-delete.
- **Deploy process** — JS-only changes: `cp ui.js dist/seq8/ui.js → ./scripts/install.sh`. Only run `build.sh` for DSP C changes. Skipping build for JS-only is correct; running install without copying first silently ships stale JS.
