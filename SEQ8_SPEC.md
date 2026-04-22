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
| Track buttons 1–4 | CCs 43–40 (reversed) | Track launch / scene launch |
| Knobs 1–8 | CCs 71–78 | Parameter control. Relative: CW=1–63, CCW=64–127 |
| Knob touches 1–8 | Notes 0–7 | Touch on=127, off=0–63 |
| Volume encoder | CC 79 | Move system volume — do not consume **[BROKEN — fix pending]** |
| Jog wheel rotate | CC 14 | Bank cycle (no modifier); Shift+jog = track cycle **[NOT BUILT]** |
| Jog wheel click | **CC 3 (0xB0)** | Menu confirm / power-down. NOT a note-on — fires as 0xB0. |
| Jog wheel touch | Note 9 | — |
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
| Up | CC 55 | Scene scroll (Session) / octave up per track (Track) |
| Down | CC 54 | Scene scroll (Session) / octave down per track (Track) |
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
| Shift + Play | MIDI panic | ✅ |
| Shift + Back | Hide SEQ8 (background run) | ✅ |
| Shift + CC 50 | Open Global Menu (Track View only) | ✅ |
| Shift + bottom pads (68–75) | Track select 1–8 | ✅ |
| Shift + top pads (92–99) | Parameter bank select | ✅ |
| Hold CC 50 | Session Overview display | ✅ |
| Loop + step button | Set clip length | ✅ |
| Delete + step button (Track View) | Atomically clear step | ✅ |
| Delete + track button (Track View) | Clear clip at that track button's scene position | ✅ |
| Delete + clip pad (Session View) | Clear that clip | ✅ |
| Step button (Session View) | Navigate scene group | ✅ |
| Shift + step (Session View) | Navigate + launch scene row | ✅ |
| Jog rotate (no modifier) | Cycle parameter banks | NOT BUILT |
| Shift + jog rotate | Cycle tracks 1–8 | NOT BUILT |
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
- Per-track: MIDI channel, route (SCHWUNG/EXTERNAL), octave (−4..+4), mute, solo [NOT BUILT]
- Play effects chain per track (see §5)
- Colors: T1=Red(127/65), T2=Blue(125/95), T3=Yellow(7/29), T4=Green(126/32), T5=Magenta, T6=Cyan, T7=Orange, T8=SkyBlue
- LED palette is a fixed 128-entry color index — NOT a brightness scale. Always use explicit dim palette partners.

### Clip
- ID: track(1–8) × scene(A–P). Example: `3-C` = track 3, scene C.
- Length: 16–256 steps (16-step pages; 1–16 pages)
- One clip active per track at a time
- Legato launch: `new_position = old_position % new_clip_length`
- Empty scene slot on scene launch → that track stops

### Step
- Up to 4 notes per step (chord entry)
- Invariant: `steps[s]==1` iff `step_note_count[s]>=1` — must always hold
- Fresh/cleared steps: `step_note_count=0` (no notes)
- Per-step: velocity, gate (default: 12 of 24 ticks per step)

### State File
- Path: `/data/UserData/schwung/seq8-state.json`
- Version-gated (`"v":2`) — wrong/missing version deletes file and starts clean. Bump `v` for any format change.
- Persists: `steps[]`, `length`, `active_clip`, `step_notes`/`step_note_count` (sparse)
- Does NOT persist: `step_vel`, `step_gate`, clip lengths, `stretch_exp`

---

## 3. Views

### Track View (default on boot)

**Step buttons:** Tap = toggle step on/off (preserves note data). Hold (~200ms) = enter step edit mode. Multiple steps can be tapped simultaneously. Playback head always shows bright white regardless of step active state.

**Pad grid:** Isomorphic 4ths diatonic layout. Root pad = bright track color, other scale pads = dim track color. Always highlights currently sounding notes in bright white (sequencer + live input combined).

**Step Edit Mode (hold step):**
- Notes assigned to that step light bright white on pad grid
- Tap pad = toggle note assignment on/off (up to 4 notes per step)
- Up/Down shifts visible octave range (reuses `trackOctave`)
- Audio preview fires on pad tap if transport stopped
- Display: track/clip/step header + note names (e.g. "C4 E4 G4" or "(empty)")
- Release step button to exit

**Parameter Banks:** Shift + top pad row (92–99) selects bank. Jog touch = Shift modifier for bank switch only.

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

**Display priority (highest to lowest):**
1. Compress Limit overlay (~1500ms)
2. Octave overlay (~1000ms)
3. Step edit (step held) — header + note names
4. Knob touched — param name + value
5. Jog touched or bank-select timeout (~2000ms) — 4-knob overview
6. Normal — track/clip/page header

**While Loop held:** Shows "LOOP LEN: N STEPS / M OF 16 PAGES"

### Session View
- 32 pads = 8 tracks × 4 visible scenes. Dim = has content, bright = playing.
- Step buttons = scene map (bright=visible, dim=has clips, unlit=empty)
- Track buttons = launch all clips in visible scene row
- Up/Down scroll scene groups

### Session Overview (hold CC 50) ✅
Full-display 8×16 graphical grid (16×4px per cell). Empty=unlit, has content=center bar, active clip=solid fill, active clip on active track=blinking. Input swallowed. Release returns to previous view.

### Global Menu (Shift + CC 50) ✅
Schwung platform menu framework. Jog rotate = navigate, CC 3 = confirm/edit, Back = exit/cancel.
Items: BPM (40–250, real-time preview, Back cancels), Key, Scale, Swing [stub], Velocity override [stub], Input quantize [stub].

---

## 4. Sequencer Engine

- 96 PPQN. All MIDI scheduling in C `render_block()`.
- BPM owned by SEQ8. Updated via `set_param("bpm")` from global menu. Do not add polling.
- Transport: Play while stopped = start from bar 1. Play while playing = stop. Shift+Play = panic.
- Panic uses `midi_send_internal` only (never `midi_send_external` — blocks render path).

### Real-Time Recording ✅
- Record (CC 86) while stopped → JS calls `record_count_in` param → DSP counts down 1 bar → atomically sets `playing=1` + `track.recording=1` from audio thread. Step buttons flash white at 1/4 note during count-in.
- Record while playing → arms immediately, no count-in.
- Recording is additive overdub via `tN_cC_step_S_add`. Never removes existing notes.
- Pre-roll: pads pressed in last 1/16th of count-in write to step 0.
- Disarm: press Record again, or Stop/panic.

---

## 5. Play Effects Chain

Per-track, non-destructive. Fixed order:
```
Step Data → [Beat Stretch ✅] → [Clock Shift ✅] → [Note FX ✅] → [Harmonize ✅] → [Seq Arp ✗] → [MIDI Delay ✅] → [Swing ✗] → MIDI Out
```

**CRITICAL KNOWN GAP:** Live pad input goes via `shadow_send_midi_to_dsp` directly from JS, bypassing the DSP chain entirely. Harmonize and MIDI Delay have no effect on live notes. Do not attempt to fix without a design decision — options are (A) route live through DSP chain, (B) reimplement in JS. Unresolved.

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

### Clip Operations [NOT BUILT]
Copy/Delete via Copy (CC 60) / Delete (CC 119) + clip pad or scene row. All undoable.

### Mute Scene Save/Recall [NOT BUILT]
Mute + Shift + step stores snapshot. Mute + step recalls. Session View only.

---

## 7. MIDI Routing

All 8 SEQ8 tracks → `midi_send_internal` → active Schwung chain only. MIDI channel does NOT route to different chains — hardware confirmed. Users layer tracks by setting Schwung chains to omni mode.

`ROUTE_EXTERNAL` uses `midi_send_external` (USB-A/SPI). **Never call from render path** — blocks and can deadlock. Safe only from deferred JS queue. Not yet wired through UI.

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
- Jog wheel bank/track navigation
- Bank overview display fix (8 params, all values visible)
- Scale definitions in DSP + scale-awareness toggles
- Undo/Redo
- Print/Bake (CC 118)
- Project save/load
- External MIDI routing UI
- Clip copy/delete operations
- Metronome / MIDI Clock I/O
- Clip blink state (queued)

---

## 9. Critical Pitfalls

- **GLIBC max 2.35** — use `my_atoi()`/`my_atof()`. Verify: `nm -D dist/seq8/dsp.so | grep GLIBC`
- **`seq8_save_state` in `tick()`** — blocks and fails silently. Always trigger saves from `onMidiMessageInternal`.
- **`midi_send_external` in render path** — blocks SPI, causes audio cracking, can deadlock `suspend_overtake`.
- **`raw_midi: true` or `raw_ui: true`** — causes shim crash on boot. Do not set.
- **Jog click is CC 3 (0xB0)** — not a note-on. Handle in CC block, not note block.
- **Do not load SEQ8 from within SEQ8** — LED corruption. Hide first (Shift+Back), then re-enter.
- **BPM:** `get_bpm()` called once at init only. Do not add periodic polling — it doesn't track Move UI changes while stopped and would overwrite user edits.
- **host BPM/transport sync not available** — `get_clock_status()` is NULL in Schwung v0.9.7.
- **Step invariant** — `steps[s]==1` iff `step_note_count[s]>=1`. Both sides must be updated atomically.
- **State file version** — currently `"v":2`. Bump `v` for any format change; old files auto-delete.
