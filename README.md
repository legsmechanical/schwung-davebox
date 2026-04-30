# SEQ8 — Master Feature Reference

*Synthesized from development sessions 2–12. Later sessions take precedence over earlier ones where conflicts exist. Last updated: Session 12 (April 28–29, 2026).*

---

## Table of Contents

1. [Overview](#1-overview)
2. [Views](#2-views)
3. [Navigation](#3-navigation)
4. [Parameter Banks](#4-parameter-banks)
5. [Melodic Track — Step Sequencing & Editing](#5-melodic-track--step-sequencing--editing)
6. [Drum Track](#6-drum-track)
7. [Clips](#7-clips)
8. [Scenes](#8-scenes)
9. [Live Recording](#9-live-recording)
10. [Track Controls — Mute, Solo, and Volume](#10-track-controls--mute-solo-and-volume)
11. [Copy, Cut & Paste](#11-copy-cut--paste)
12. [Undo / Redo](#12-undo--redo)
13. [Global Settings (Global Menu)](#13-global-settings-global-menu)
14. [MIDI](#14-midi)
15. [OLED Display](#15-oled-display)
16. [LED Behavior Reference](#16-led-behavior-reference)

---

## 1. Overview

SEQ8 is an 8-track MIDI sequencer running running as a tool module on the schwung platform for the Ableton Move. It supports melodic and drum tracks, per-clip parameter sets, note-centric timing, live recording, step editing, and external MIDI I/O. Tracks can be routed to Move's native instruments or to Schwung's internal chains.

SEQ8 is inspired by the Yamaha RM1X and RS7000 sequencers.

**Defaults on fresh load:**
- Opens in Session View
- BPM seeded from Move's current tempo
- Tracks 1–4: channels 1–4, routed to Move
- Tracks 5–8: channels 5–8, routed to Schwung
- Launch Quantization: 1-bar
- Scale Aware: On

---

## 2. Views

SEQ8 has three main views: **Track View**, **Session View**, and **Session Overview**. A persistent **Global Menu** is accessible from any view.

### 2.1 Track View

The primary editing view for a single track and clip. Shows:
- Bank label and parameter values on the OLED
- Step buttons representing the active clip's current page (16 steps per page)
- Pad grid for note input and display
- Side clip buttons (4) for switching between clips on the active track
- Position bar at the bottom of the OLED (see Section 15)
- Active track indicated by a 1px box around the track number in the OLED track row

**Navigation within Track View:**
- Left/Right arrow buttons move between pages of the active clip
- Up/Down buttons shift the pad octave range for the active track (range: −4 to +4)
- Jog wheel (rotate, no modifier) cycles through parameter banks — clamped, no wrap
- Shift + jog rotate cycles through tracks 1–8 — clamped, no wrap

### 2.2 Session View

An 8×8 grid showing all clips across all tracks and scenes. Each column is a track; each row is a scene.

- Tap a clip pad to launch or queue that clip
- Tap an empty clip pad to focus it for recording
- Shift + clip pad: activates the clip (if not playing) and immediately switches to Track View focused on that clip
- Step buttons 1–16 launch the corresponding scene row (same as the scene button to the left of the row)
- Jog rotate: scrolls scene rows one at a time (clamped)
- +/− buttons: scroll by a full scene group (4 rows) at a time
- Hold Mute + pad: mute/unmute that pad's track
- Hold Shift + Mute + pad: solo that track
- Delete + Mute: clear all mutes and solos

**Active track indicator:** The active track label shows with brackets, e.g. `[T1]`.

**Active empty slot visibility:** The currently active clip slot for each track shows as dim grey-white when empty, so you can always see which slot is in focus.

**Clip launch focuses Track View:** Tapping a clip pad in Session View updates Track View's focus to match — switching to that track and selecting that clip. Switching to Track View after a Session View launch puts you directly in the right place to edit the clip.

### 2.3 Session Overview

Hold the Note/Session toggle button for ~200ms. The OLED shows a bird's-eye grid of all 8 tracks × 16 scenes:

| Cell state | Display |
|---|---|
| Empty | Unlit |
| Has content | Small center bar |
| Active clip | Solid filled |
| Active clip on active track | Blinking |

No buttons are active while the overview is shown. Release the toggle to return to the previous view. A quick tap still switches between Track View and Session View normally.

### 2.4 Global Menu

Open with **Shift + Note/Session toggle**. Jog rotate navigates items; jog click enters edit mode; Back button exits (canceling changes in progress).

While the menu is open, only jog inputs are captured by the menu — all other controls (pads, step buttons, track buttons) continue to function normally.

See Section 13 for all menu items.

---

## 3. Navigation

### Jog Wheel

| Context | Rotate | Click |
|---|---|---|
| Track View (no modifier) | Cycles parameter banks (clamped) | See bank-specific behavior |
| Track View + Shift | Cycles tracks 1–8 (clamped) | — |
| Track View + Loop held | Adjusts active clip length (±1 step per detent, clamped 1–256) | — |
| Session View | Scrolls scene rows (clamped) | — |
| Global Menu | Navigates / edits items | Confirms selection |
| Delete + click | Resets active bank params to defaults (NOTE FX, HARMZ, SEQ ARP, MIDI DLY) | — |
| Shift + Delete + click | Resets all non-destructive banks (NOTE FX, HARMZ, SEQ ARP, MIDI DLY) | — |

Jog touch (capacitive) has no function.

### +/− Buttons

- Session View: scroll scene rows by a full scene group (4 rows) at a time
- Track View: shift octave range of the pad grid for the active track

### Arrow Buttons

- Track View: navigate between pages of the active clip
- Session View: (no function — scene scrolling handled by jog and +/−)

---

## 4. Parameter Banks

Eight banks are accessible in Track View. Hold **Shift + top-row pad** to select a bank, or rotate the jog wheel. The OLED displays all 8 parameters and their values for the current bank. Touching a knob highlights its row inline (inverted) without replacing the overview. Parameter values are **per-clip** for NOTE FX, HARMZ, SEQ ARP, and MIDI DLY banks — each clip remembers its own settings independently.

The LED below each knob lights when that parameter has been changed from its default. LEDs update immediately on knob turn, clip switch, track switch, or reset.

### 4.1 TRACK Bank

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Channel | MIDI channel 1–16; displayed 1-indexed |
| K2 | Route | Schwung internal or Move internal |
| K3 | Track Mode | Drum or Melodic |
| K4 | (unused) | — |
| K5 | (unused) | — |

Settings are saved and restored with project state.

### 4.2 CLIP Bank

*(formerly TIMING bank, renamed Session 8)*

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Beat Stretch | One-shot: each detent doubles (right) or halves (left) clip. OLED shows ×2 or ÷2. |
| K2 | Clock Shift | Rotates all notes forward/backward by steps. OLED shows cumulative signed offset while held; resets to 0 on release. |
| K3 | Nudge | Shifts all notes in the clip forward/backward at tick resolution. OLED shows cumulative offset while held; resets on release. Notes wrap at clip boundary. |
| K4 | Resolution | Per-clip playback speed. Options: 1/32 · 1/16 (default) · 1/8 · 1/4 · 1/2 · 1-bar. Changing resolution on a clip with notes rescales all positions proportionally. Shift+K4 = Zoom mode (see below). |
| K5 | Length | Clip length in steps, 1–256. Changes take effect immediately. |
| K6 | Clip Start | Stub (display only) |
| K7 | Clip End | Stub (display only) |
| K8 | SeqFollow | ON (default): Track View auto-scrolls to follow the playhead. OFF: view stays wherever you left it. Per-clip. *(Persistence unconfirmed — needs verification.)* |

**Beat Stretch limits:** Clip length clamped 1–256 steps. Compress blocked if it would cause two notes to land on the same step (OLED: COMPRESS LIMIT).

**Resolution Zoom Mode (Shift+K4):** Adjusting resolution while holding Shift keeps note absolute tick positions fixed while the step grid adjusts around them. Blocked if zooming in would push notes past the 256-step tick boundary (OLED: NOTES OUT OF RANGE). Also blocked while recording is armed or a step is held. Standard K4 (proportional rescale) is unchanged.

### 4.3 NOTE FX Bank

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Octave | Shifts all notes up/down by octave |
| K2 | Offset | Shifts notes by semitones (or scale degrees when Scale Aware is On) |
| K3 | Gate Time | Scales note duration as % of original (0–400%). 100% = original. Staccato below, legato above. |
| K4 | Velocity | Scales note velocity |
| K5 | Quantize | Amount of quantization applied at render time |
| K6–K8 | — | — |

### 4.4 HARMZ Bank

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Unison | — |
| K2 | Octaver | — |
| K3 | Hrm1 | Harmony voice 1 (semitones or scale degrees when Scale Aware On) |
| K4 | Hrm2 | Harmony voice 2 (semitones or scale degrees when Scale Aware On) |
| K5–K8 | — | — |

### 4.5 SEQ ARP Bank

Per-clip arpeggiator. Sits as the **last stage** of the play-effects chain (after MIDI DLY), capturing every note-on/off coming out of the upstream stages — sequencer, live pads, external MIDI, even MIDI DLY echoes — into a held buffer, and re-emitting picks at its own clock. Free-runs even when transport is stopped, so live pads arpeggiate at any time.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off · Up · Dn · U/D · D/U · Cnv · Div · Ord · Rnd · RnO. **Off bypasses the arp entirely** (notes pass through unchanged). Default Off. |
| K2 | Rate | 1/32 · 1/16 · 1/16t · 1/8 · 1/8t · 1/4 · 1/4t · 1/2 · 1/2t · 1bar. Default 1/16. |
| K3 | Octaves | Bipolar `-4..-1, +1..+4` (zero is skipped). Positive ascends by 12 semitones per octave; negative descends. Default `+1`. |
| K4 | Gate | 1–200 % of the rate interval. Default 50 %. |
| K5 | Steps Mode | `Off` (8-step pattern ignored) · `Mut` (level-0 step rests but cycle advances) · `Stp` (level-0 step skips entirely). Default Off. |
| K6 | Retrigger | On/Off. **On**: cycle/pattern position restarts whenever a new note enters the buffer **and** at every active-clip loop wrap. **Off**: pattern free-runs anchored to the master clock. Default On. |
| K7–K8 | — | unused |

**Step-vel pad-grid editor** — when Steps Mode is `Mut` or `Stp`, holding K5 turns the pad grid into an 8-column × 4-row velocity-level editor for the 8-step pattern. Each column is a step; the row pressed sets the level (1=bottom row → vel 10, 4=top row → incoming vel; intermediate levels lerp). Pressing the bottom row again clears that step to level 0 (off).

**Knob LEDs (CC 71–78)** light White when the corresponding parameter is non-default — i.e. anything other than Style=Off, Oct=+1, Steps=Off, Retrigger=On, etc.

Style → Off silences any sounding output and clears the held buffer.

### 4.6 MIDI DLY Bank

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Delay Time | — |
| K2 | Level | — |
| K3 | Repeats | — |
| K4 | Velocity Feedback | — |
| K5 | Pitch Feedback | Semitones or scale degrees when Scale Aware On |
| K6 | Gate Feedback | — |
| K7 | Clock Feedback | — |
| K8 | Pitch Random | Semitones or scale degrees when Scale Aware On |

### 4.7 LIVE ARP Bank

On/off, type, sort, hold, octave range, speed. Per-track (not per-clip).

### 4.8 DRUM SEQ Bank

Used only on drum tracks. See Section 6.

---

## 5. Melodic Track — Step Sequencing & Editing

### 5.1 Step Basics

- **Quick tap (< 200ms):** Toggles a step on/off without affecting stored notes. Activating an empty step auto-assigns the last note played on the pads.
- **Hold (≥ 200ms):** Enters step edit mode — see Section 5.2.
- Multiple step buttons can be tapped simultaneously to toggle several at once.
- Step buttons out of bounds (beyond clip length) light white.

### 5.2 Step Edit Overlay

Holding a step button opens a 5-knob editing overlay. All edits apply to all notes in the step simultaneously and are destructive.

| Knob | Function |
|---|---|
| K1 (Oct) | Shifts all notes in step up/down by octave |
| K2 (Pitch) | Shifts all notes by scale degree (scale-aware) |
| K3 (Gate) | Adjusts note length as a relative delta. While touching, step LEDs show a visual representation of the longest gate. |
| K4 (Vel) | Adjusts velocity as a relative delta |
| K5 (Nudge) | Shifts notes forward/backward in time (±23 ticks max — just under one full step). Step blinks in track color when notes land on a grid position. On release, notes that crossed into an adjacent step's window reassign to that step. |

While holding a step, Up/Down shift the visible octave range on the pad grid to reach notes outside the current 4-row window.

The OLED shows which notes are assigned to the step (e.g. `C4 E4 G4`).

### 5.3 Chord Entry

While holding a step, tap multiple pads to build a chord — up to four notes per step. Each tapped note is added (or removed if already present).

### 5.4 Pad Grid

The pad grid always reflects what's currently sounding — from both the sequencer and live pad playing. Sequencer-triggered notes light bright white; live pad presses also light white. Both show simultaneously.

### 5.5 Playback Head

A bright white light moves through the step buttons, showing the current sequencer position. Visible even when all 16 steps are active (playhead uses bright white; active steps use track color).

### 5.6 Idle Screen (Melodic Track)

The idle OLED shows two rows of information below the bank label:
- **Left**: current octave shift (e.g. `Oct: +0`)
- **Right**: current key and scale name, right-aligned (e.g. `A Minor`, `C# Pent Major`)

Scale names abbreviated: H Minor, M Minor, Pent Major, Pent Minor. When Scale Aware is on, a 1px underline appears beneath the key/scale text.

---

## 6. Drum Track

### 6.1 Overview

Selecting drum mode (TRACK bank K3) changes the track to a drum sequencer. The pad grid becomes 32 lanes (or 2×16 with bank switching). Each lane plays a distinct MIDI note.

### 6.2 DRUM SEQ Bank

| Knob | Parameter | Notes |
|---|---|---|
| K1 | — | — |
| K2 | Clock Shift | Shifts active lane only (immediate, no full resync). Shows cumulative signed offset while held. |
| K3 | Nudge | — |
| K4 | — | — |
| K5 | — | — |
| K6 | — | — |
| K7 | Oct (Lane Note) | Shifts the active lane's MIDI note up/down one octave per detent. Clamps at MIDI 0–127. OLED shows note name + number (e.g. `C3 48`) inverted. |
| K8 | Note (Lane Note) | Shifts active lane MIDI note up/down one semitone per detent. Same display. |

Lane note assignments persist across saves and reloads.

### 6.3 16-Level Velocity Pads

The right-side 4×4 grid is a velocity pad zone. The zone is determined by which pad you press (not pressure). Zones map evenly from velocity 8 (bottom-left) to velocity 127 (top-right). The fixed zone velocity is used identically for:
- Live monitoring
- Step-edit velocity (hold a step, tap a velocity pad)
- Live recording

The LED highlights the pressed zone.

### 6.4 Lane Mute / Solo

- **Mute a lane:** Hold Mute + press the lane pad
- **Solo a lane:** Hold Shift + Mute + press the lane pad
- Mute and solo are mutually exclusive: soloing a muted lane clears its mute; muting a soloed lane clears its solo
- The OLED idle view shows the mute/solo indicator for the **currently active lane only**
- The pad info row (`Bank: A  Pad: C3 (48)`) and mute/solo status row are always visible simultaneously

### 6.5 Loop View (Pages View)

Holding the Loop button on a drum track shows the pages view on step buttons — matching melodic track behavior:
- Pages with notes: pulse between track color and off (music-synced at 16th-note rate during playback, slower when stopped)
- Empty pages within clip length: solid track color
- Pages beyond clip length: dim grey

### 6.6 Snapshots Include Lane Mute State

The 16 mute/solo snapshots (see Section 10.3) now include each drum track's per-lane mute state.
- **Save**: stores the effective mute bitmask (soloed lanes treated as active/not-muted)
- **Recall**: restores the stored bitmask and clears any solo state

### 6.7 Lane and Clip Copy / Cut / Paste

**Lane copy/paste (Track View):**
- Hold Copy + press a lane pad → source blinks white, "COPIED" appears
- Press another lane pad → pastes all step data (steps, velocity, gate, nudge offsets, length, ticks-per-step). The destination lane's MIDI note is preserved.
- Clipboard is sticky — paste to multiple lanes without re-selecting source
- Shift+Copy = cut source; after first paste, source is cleared and clipboard converts to a regular copy

Lane copy operates within the active clip and same track only.

**Drum clip copy/paste:**
- Same as melodic clip copy/paste (Section 11.2) but copies all 32 lanes
- Each destination lane's MIDI note is preserved
- Works cross-track. Pasting to a melodic track is ignored.

### 6.8 Live Recording Undo

Arming live recording on a drum track creates an undo snapshot of all 32 lanes' step data at the moment of arming. Undo reverts all lanes. Drum and melodic undo snapshots are mutually exclusive — arming on one type clears the other's snapshot.

---

## 7. Clips

### 7.1 Data Model

Notes are independent objects stored at precise tick positions within a clip. There is no polyphony cap — any number of notes can share the same tick position (true chord recording). The step grid is a visual overlay for editing, not a data container.

### 7.2 Per-Clip Parameters

Each clip carries its own independent set of play effect parameters for NOTE FX, HARMZ, SEQ ARP, and MIDI DLY banks. TRACK and LIVE ARP remain per-track.

- Launching a different clip can now change the sound, timing, and harmonic behavior automatically
- New clips start with clean default values
- Copying a clip carries all param settings along with note data
- Clearing a clip resets its params to defaults

### 7.3 Clip Resolution

Each clip has its own resolution (CLIP bank K4), independent of all other clips. Options: 1/32 · 1/16 (default) · 1/8 · 1/4 · 1/2 · 1-bar. Changing resolution on a clip with notes rescales all positions proportionally.

### 7.4 Clip Launch Behavior

**Launching a clip (Session View — tap clip pad):**
- If another clip is playing on that track: new clip takes over immediately from the same position (legato)
- If no clip is playing on that track: new clip waits for the next bar and starts from the beginning

**Stopping a clip:** Tap a playing clip pad to queue it to stop at the end of the current bar.

**Launch Quantization** (Global Menu): controls when clips and scenes launch.
- **Now**: immediate; legato if a clip is already playing
- **1/16, 1/8, 1/4, 1/2, 1-bar**: waits for the next boundary; always starts from beginning

Default: **1-bar**.

**Transport stop/start:** When you stop transport, clips that were playing are remembered. When transport restarts, those clips automatically relaunch from the beginning.

**Shift+Play:** Restart transport.
- Transport running: atomic stop + replay — all positions reset to step 0, currently-playing clips keep playing from the start, recording is finalized.
- Transport stopped: starts transport (same as plain Play).

**Delete+Play:**
- Transport running: stops all playing clips gracefully at the end of the current bar; cancels queued launches (same as the previous Shift+Play behavior).
- Transport stopped: immediately clears all clip state across all tracks (panic); step data preserved.

### 7.5 Empty Clips

Empty clips can be activated and edited. Pressing an empty clip in Session View launches and focuses it. Empty clips show unlit in the pad grid until step data is added.

### 7.6 Clip Length

Set via CLIP bank K5 (1–256 steps), or by holding Loop and rotating the jog wheel (±1 step per detent). Also settable by holding Loop and pressing two step buttons to define start and end pages.

### 7.7 Loop Double (Shift+Loop)

Doubles the active clip's length and fills the new second half with an exact copy of the first half's note data. Blocked if the clip is already at 256 steps (OLED: CLIP FULL). Undoable.

### 7.8 Clearing Clips

- **Delete + clip button (Track View)** / **Delete + clip pad (Session View)**: clears all notes from that clip. Clip remains active and continues playing empty — transport is not interrupted. *(Session View behavior unconfirmed — needs device testing.)*
- **Shift+Delete + clip button / clip pad**: hard reset — clears all notes AND resets all per-clip params (NOTE FX, HARMZ, MIDI DLY) to defaults, and resets clip length to 16 steps and resolution to 1/16. Fires CLIP CLEARED pop-up. Undoable.

---

## 8. Scenes

### 8.1 Launching Scenes

- **Scene button** (left of each row in Session View): full scene launch. Any playing clips in that row stop at end of current bar; all clips in the row start together from the beginning at the next bar boundary.
- **Step buttons 1–16 (Session View)**: launch the corresponding scene row — same as the scene button.

### 8.2 Scene Row Clear

- **Delete + scene row button (Session View)**: clears all notes from all 8 clips in that row immediately. Clips stop playing.
- **Shift+Delete + scene row button**: hard reset — clears all notes AND resets per-clip params for all 8 clips simultaneously. Fires CLIPS CLEARED pop-up. Undoable.

---

## 9. Live Recording

### 9.1 Starting and Stopping

- **From stopped**: press Record. SEQ8 gives a one-bar count-in (step buttons flash white on each quarter-note beat). Playback and recording start simultaneously when count-in ends.
- **While playing**: press Record at any time. Recording arms immediately with no count-in.
- **Stop recording**: press Record again (transport keeps running), or press Play/Stop (stops transport too).

Recording is **always additive (overdub)** — existing notes are never erased. Record LED is solid red when recording; dimly lit when armed but not recording.

### 9.2 Timing Accuracy

Recording timing is captured at the DSP level (≤2.9ms jitter). The exact tick position within a step is captured by the audio engine at the moment of pad press. Gate length (including notes held across the loop boundary) is also captured accurately. Notes appear in the sequencer immediately on press and are finalized on release.

### 9.3 Track Switching During Recording

While record-armed, you can switch tracks freely. Recording follows the focused track. Notes on the previous track are closed out cleanly. Record arm stays on.

### 9.4 Live Recording Undo

Arming live recording creates an undo snapshot of the clip (or all 32 drum lanes on drum tracks) at the moment of arming. A single undo reverts the entire recorded session.

---

## 10. Track Controls — Mute, Solo, and Volume

### 10.1 Mute

**Track View:**
- Press Mute: toggle mute on the focused track
- Mute button LED: blinking at 1/8 = muted; solid = soloed; off = neither. Updates on track switch.

**Session View:**
- Hold Mute + press any pad in a column: toggle mute on that column's track

**Either view:**
- Delete + Mute: clear all mutes and solos across all 8 tracks

### 10.2 Solo

**Track View:**
- Shift + Mute: toggle solo on the focused track

**Session View:**
- Shift + Mute + press any pad in a column: toggle solo on that track

**Behavior:** Muting a soloed track clears the solo; soloing a muted track clears the mute. Most recent action wins.

**Track number display:** Muted tracks show inverted (white background, black number). Soloed tracks blink.

### 10.3 Mute/Solo Snapshots

Save and recall mute/solo state (including drum lane mute state) across 16 slots.

While holding Mute in Session View, step buttons 1–16 light up: **light purple** = empty slot, **bright blue** = saved state.

- **Save**: Shift + Mute + step button → saves current mute/solo state of all 8 tracks (and lane mutes) to that slot
- **Recall**: Mute + lit step button → all tracks immediately jump to the saved state

Snapshots persist across reboots.

### 10.4 Volume

Move's hardware volume knob (CC 79) functions normally within SEQ8.

---

## 11. Copy, Cut & Paste

### 11.1 Sticky Clipboard

The clipboard remains live after each paste, allowing multiple destinations from the same source without re-selecting. The clipboard stays active until you release the Copy button. Applies to clip copy, step copy, and cut.

### 11.2 Clip Copy / Cut

**Copy:**
- Hold Copy + press clip button (Track View) or clip pad (Session View) → source blinks white, "COPIED" appears
- Press destination clip to paste

**Cut (Shift+Copy):**
- Hold Shift+Copy + press clip button or clip pad → source blinks white, "CUT" appears
- Press destination → source is cleared, destination receives source content
- After first paste, source clears visually, but clipboard data remains for subsequent pastes
- Cancel: press Copy again after selecting a source

**Scene row copy/cut:**
- Hold Copy/Shift+Copy + scene row button → copies/cuts all 8 clips in that row
- Mixing kinds (clip → scene row, or vice versa) is rejected

All copy/cut/paste operations are undoable.

### 11.3 Step Copy

In Track View, hold Copy + press source step (blinks white) → press destination step. Copies all data: notes, gate lengths, velocities, timing offsets. Same clip only.

---

## 12. Undo / Redo

SEQ8 supports one level of undo and redo.

- **Undo**: reverts last destructive action
- **Shift + Undo**: redoes last undone action
- After undoing, performing any new action discards the redo state
- If nothing to undo/redo: brief "NOTHING TO UNDO" / "NOTHING TO REDO" message on OLED

**Undoable actions:**
- Step clear (Delete+step)
- Step copy
- Clip clear (Delete+clip)
- Clip copy / cut
- Hard reset (Shift+Delete+clip or Shift+Delete+scene row)
- Row clear (Delete+scene row)
- Row copy
- Live recording session (entire session, restoring clip to pre-arm state)
- Bank param reset (Delete+jog click)
- Full bank reset (Shift+Delete+jog click)
- Loop Double (Shift+Loop)
- Drum lane copy / cut
- Drum clip copy / cut

---

## 13. Global Settings (Global Menu)

Open with **Shift + Note/Session toggle**. Jog rotate navigates; jog click confirms/enters edit; Back cancels.

| Item | Description |
|---|---|
| BPM | Set tempo 40–250 BPM. Updates in real time while turning. Back cancels and restores previous. SEQ8 owns its own tempo; not slaved to Move's native tempo. |
| Tap Tempo | Sub-screen for tap-based BPM entry. All 32 pads light dim white; tapping any pad flashes all pads blue and registers a tap. BPM is derived from a sliding-window average of the last 8 intervals; tapping noticeably faster/slower (>1.8× ratio change) starts a fresh tap session, and a 2-second pause also resets. Jog rotate adjusts BPM ±1 without disturbing the tap session. Jog click or Back applies the BPM and exits. Clamps 40–250. |
| Key | Global root note (A through G#), shared across all tracks |
| Scale | Global scale: Major · Minor · Dorian · Phrygian · Lydian · Mixolydian · Locrian · Harmonic Minor · Melodic Minor · Pentatonic Major · Pentatonic Minor · Blues · Whole Tone · Diminished |
| Scale Aware | On (default) / Off. When On: NOTE FX Offset, HARMZ Hrm1/Hrm2, MIDI DLY Pitch Feedback and Pitch Random all step in scale degrees rather than semitones. Automatically bypassed for drum tracks. |
| Launch Quantization | Now · 1/16 · 1/8 · 1/4 · 1/2 · 1-bar (default). Controls when clip and scene launches take effect. |
| MIDI In | All / 1–16. Channel filter for external MIDI input. |
| Swing | Stub (not yet implemented) |
| Velocity Override | Stub (not yet implemented) |
| Input Quantize | Stub (not yet implemented) |
| Clear Session | Resets the entire SEQ8 instance to a clean slate. Presents a confirmation dialog (Yes/No, defaults to No). Confirming deletes the current set's state file and reinitializes SEQ8, seeding BPM from Move's current tempo. Only the active set is affected. |
| Quit | Saves current state and terminates the SEQ8 instance. |

---

## 14. MIDI

### 14.1 Per-Track MIDI Channel and Route

Each track independently configures:
- **Channel (TRACK K1)**: MIDI channel 1–16 (1-indexed). Default: track N on channel N.
- **Route (TRACK K2)**: Schwung internal chain, or external MIDI via USB-A, or Move native instrument.

Both sequenced notes and live pad input honor per-track channel and route settings.

**Default routing (new instances):**
- Tracks 1–4: channels 1–4, routed to Move's native instruments
- Tracks 5–8: channels 5–8, routed to Schwung

### 14.2 Move Native Instrument Routing

When a track's Route is set to Move, MIDI is sent via Move's internal injection path on the track's configured channel, reaching Move's onboard instruments directly.

### 14.3 External MIDI Input

SEQ8 receives external MIDI from controllers connected to Move's USB-A port. Channel filtering via MIDI In in the Global Menu (All or 1–16).

External MIDI is always routed to the track currently focused in Track View, even when you're in Session View. Switching tracks sends a clean note-off to the previous track. External MIDI integrates with step input: playing a note while holding a step adds that pitch exactly like tapping a pad.

---

## 15. OLED Display

### 15.1 Bank Header Format

All bank headers use `[ LABEL ]` format with a space inside the brackets (e.g. `[ NOTE FX ]`, `[ DRUM SEQ ]`). Applies to both the bank overview grid and the idle Knob label line.

### 15.2 Knob Label Position

The `Knob: [ BANK ]` label is pinned to the very top of the OLED (y=0) on all track views and modes.

### 15.3 Bank Parameter Display

When any bank param knob is touched or turned, the full bank overview stays visible and the active parameter row **inverts** (black text on white background). The highlight clears when you release the knob. All 8 parameters and their values are visible simultaneously (rows for K1–K8).

### 15.4 Track Number Row

Track numbers 1–8 are evenly distributed across the full 128px OLED width (16px per slot). Clip letters on the row below align to the same x positions.

| State | Display |
|---|---|
| Active track | Number has a 1px box drawn around it with 1px padding |
| Muted track | Number shown inverted (white background, black number) |
| Soloed track | Number blinks; if active and soloed, blinks inside the outline box |

### 15.5 Position Bar

A segmented bar at the bottom of the OLED in Track View shows the clip's page structure:

| Segment state | Meaning |
|---|---|
| Solid block | Page currently in view |
| Outline box | Page the playhead is currently on (when different from view page) |
| Bottom edge line | Other pages with content |

A dot moves across the full 128px width of the position bar, tracking the playhead in real time at step resolution during playback. When the dot passes over the solid block (view page), it inverts to black to remain visible.

### 15.6 Action Confirmation Pop-ups

Brief 500ms OLED messages appear after key actions:

| Action | Message |
|---|---|
| Copy source selected | COPIED |
| Copy/cut destination confirmed | PASTED |
| Cut source selected | CUT |
| Clip clear | SEQUENCE CLEARED |
| Scene row clear | SEQUENCES CLEARED |
| Hard reset (single clip) | CLIP CLEARED |
| Hard reset (scene row) | CLIPS CLEARED |
| Bank param reset | BANK RESET |
| Full bank reset | CLIP PARAMS RESET |
| Undo | UNDO |
| Redo | REDO |
| Loop double at max length | CLIP FULL |
| Resolution zoom blocked | NOTES OUT OF RANGE |
| Beat stretch compress blocked | COMPRESS LIMIT |

Pop-ups are dismissed immediately if you touch a knob or enter step edit.

---

## 16. LED Behavior Reference

### Clip Pads (Session View)

| State | LED |
|---|---|
| Empty slot | Unlit |
| Has content, inactive | Very dim track color |
| Active, empty slot (focused) | Dim grey-white |
| Will relaunch when transport starts | Solid bright track color |
| Playing | Flash between dim and bright track color at 1/8 note rate |
| Queued to launch | Flash between dim and bright track color at 1/16 note rate |
| Queued to stop | Flash between dim track color and off at 1/16 note rate |

All playing clips flash in sync, locked to the main clock.

### Side Clip Buttons (Track View)

| State | LED |
|---|---|
| Currently editing (not playing) | Solid bright track color |
| Currently editing AND playing | Flash at 1/8 note rate |
| Other clips with content | Dim track color |
| Empty slots | Unlit |

### Step Buttons (Track View)

| State | LED |
|---|---|
| Active step (has notes) | Bright track color |
| Inactive step within clip | Dim track color |
| Out of bounds (beyond clip length) | White |
| Playback head position | Bright white |

### Step Buttons (Session View — scene scroll indicator)

| State | LED |
|---|---|
| Rows in view | Red (pulsing red if any clip in that row is playing) |
| Rows out of view with playing clips | Pulsing white |
| Rows out of view with content | Dim white |
| Rows out of view, all empty | Off |

### Knob LEDs (Track View)

- Lit when the parameter has been changed from its default value
- Off when at default

### Mute Button LED (Track View)

| State | LED |
|---|---|
| Active track is muted | Blinking at 1/8 |
| Active track is soloed | Solid |
| Neither | Off |

### Mute/Solo Snapshot Slots (Session View, while holding Mute)

| State | LED |
|---|---|
| Empty slot | Light purple |
| Saved state | Bright blue |

---

## Appendix: State Persistence

SEQ8 saves and loads separate state per native Move set. When you switch sets in Move, SEQ8 automatically saves current work and loads the state for the new set.

**State is saved** when you background SEQ8 (Shift+Back) or exit it. State is not saved continuously during use.

**What persists per set:**
- All note data (per clip, per track)
- Per-clip params (NOTE FX, HARMZ, SEQ ARP, MIDI DLY per clip)
- Track settings (channel, route, mode, octave shift)
- CLIP bank values (beat stretch position, clock shift position, per-clip params)
- Global settings (BPM, Key, Scale, Launch Quantization, Scale Aware)
- Mute/solo state and all 16 snapshots (including drum lane mutes)
- MIDI In channel setting


---

## In Development

Items are organized by the section of SEQ8 they interact with. Items marked **[deferred]** are specced but not actively being built. Items marked **[fix]** are corrections to existing behavior.

---

### Views

**Session View — Jog Hold: Quick Bank Access**
Holding the jog wheel touch in Session View brings up the OLED and knob display for the active parameter bank on the active track — the same view available in Track View. Rotating the jog wheel (to scroll scene rows) overrides and dismisses this view.

**Session View — Knob Touch: Track Focus**
Touching any knob in Session View immediately switches the active track to the track corresponding to that knob's position. Knobs map 1:1 to tracks 1–8.

---

### Parameter Banks

**Drum Track — All-Lanes Quantize (DRUM SEQ K6)**
A macro quantize knob for drum tracks. Turning K6 sets the NoteЕX quantize value on all 32 lanes simultaneously. Non-destructive — quantization is applied at render time and can be dialed back to 0. Replaces the sstart parameter. Send is also removed from the DRUM SEQ bank for drum tracks.

**Harmonizer — Rand 1 and Rand 2 Voices**
Two new knobs added to the HARMZ bank. Both are scale-aware (values are scale degrees). Each adds an additional note voice alongside the source note. Rand 1 widens a randomized range from ±1 to ±7 scale degrees. Rand 2 is bipolar — CW adds a random voice up to 7 degrees above; CCW adds one up to 7 degrees below.

**MIDI Delay — Dotted Timing and Rnd Refinement**
Dotted is added as a third timing option alongside Straight and Triplet. Null timing is removed. Default changes to 1/8 Dotted. The Pitch Random knob (K8) is extended from a ±12 toggle to a 0–24 continuous range (0=off, 24=±24 semitones/degrees).

**Arpeggiator — LIVE ARP**
SEQ ARP is implemented (see Section 4.5). LIVE ARP (per-track, sits before NOTE FX so its picks then flow through the rest of the chain — distinct from SEQ ARP which captures the chain output) is still a stub.

**Swing**
Global swing amount and resolution, applied last in the play effects chain. Currently a stub in the Global Menu.

**Bank Overview Display [fix]**
The bank overview currently shows labels for all 8 parameters but only displays values for 4 of them. All 8 values should be visible.

---

### Melodic Track

**Chromatic Pad Layout Toggle**
A per-track toggle in the TRACK bank switches between the current isomorphic (Wicki-Hayden 4ths) layout and a chromatic layout where each pad to the right is +1 semitone and each pad up is +5 semitones (guitar fretboard style). Setting persists per track.

**Step Preview**
A global toggle in the Global Menu. When on and transport is stopped, holding a step that contains notes triggers live playback of those notes. Has no effect while transport is running.

---

### Drum Track

**Drum Mode Default for Track 1**
On new project creation, Track 1 defaults to drum mode. Tracks 2–8 default to melodic.

**Per-Lane Loop Length [deferred]**
Each drum lane can have an independent loop length within a clip, enabling polyrhythmic patterns. Requires a data model extension.

**Euclidean Sequencing [deferred]**
Per-lane Bjorklund algorithm for generating euclidean rhythms.

**Melodic ↔ Drum Track Conversion [deferred]**
A confirmation dialog on the TRACK bank K3 mode switch that converts an existing melodic track to drum mode (or vice versa), migrating clip data where possible.

---

### Clips

**Clip Loop Start Position**
In Loop view (hold Loop button), holding a step sets the page the clip begins on; tapping a step to the right sets the end page. Currently clips always start at step 0.

**Clip Clear Keeps Playback Active [fix]**
Clearing a clip via Delete+clip button in Track View or Session View should not stop playback of the cleared clip. The clip should remain active and continue playing (now empty). Applies to both melodic and drum tracks.

---

### Live Recording

**Live Merge (Shift+Capture)**
Records the post-effects MIDI output of the active track into the first empty clip slot from the bottom of that track. The clip does not loop during recording — it captures up to 256 steps. When stopped, the clip comes in with default effect params (effects are already baked into the recorded notes). Useful for committing a live performance with effects into a new clip.

**Print / Bake**
Renders the currently playing clip with all play effects applied to the note data, replacing the source clip with the processed result. Activated by holding a dedicated button during playback.

**Undo in Overdub Recording [fix]**
Current undo behavior during overdub is unsatisfactory. Needs a design decision on what undo should do mid-overdub vs. after disarm before implementing.

**Live Input Through Play Effects**
Currently, live pad input bypasses the play effects chain — Harmonizer and MIDI Delay do not affect notes played live, only sequenced notes. A routing fix would apply play effects to live input as well. Design decision pending.

---

### Track Controls

**Mute/Solo OLED Indicators on Track Numbers [fix]**
The M and S indicators displayed on track numbers in the OLED track row when a track is muted or soloed need to be corrected.

---

### Global Settings

**Scale-Aware Key/Scale Transpose**
A Transpose toggle in the Global Menu. When on, changing the Key or Scale transposes all notes across all clips on all tracks to fit the new key/scale. Notes that don't land on a scale degree snap to the nearest. Drum tracks are bypassed.

**State Snapshots**
16 snapshot slots in Session View (Shift+Capture+step to save, Capture+step to recall). Each snapshot captures the full SEQ8 instance state: which clips are active on each track, track mute/solo status, and all clip-level effect params (NOTE FX, HARMZ, MIDI DLY). TRACK and LIVE ARP settings are excluded.

**Transport Sync**
Synchronize SEQ8's transport and BPM to an external source. Two candidate approaches: MIDI clock (0xF8 messages via USB-A) or a native Move transport API (pending Schwung update).

**Velocity Override and Input Quantize**
Both are already present as stubs in the Global Menu. Will be wired to DSP when implemented.

---

### MIDI

**External MIDI Input — Pad LED Feedback [fix]**
When external MIDI notes are received in Track View, the corresponding pads should light up the same way they do for pad input. Currently only physical pad presses trigger LED feedback.

**Schwung Chain Access**
Expose Schwung's native effects chain (reverb, delay, etc.) from within SEQ8. Access method to be determined — options include a dedicated button combo, a new parameter bank, or a Global Menu entry.

---

### OLED Display

**Metronome Menu Label [fix]**
The Metro toggle label "On" is ambiguous. To be replaced with a clearer label (options: Active/Inactive, Enabled/Disabled, or rename the entry to "Click").

---

### LED Behavior

**Playhead Dot — Flashes on Inactive Clips During Transport [fix]**
In Track View, the playhead dot on step 1 of an inactive clip is static when transport is stopped (intentional). When transport is running and the clip is inactive, the dot should flash at the 1/16 rate.

**Beat Markers**
Steps 1, 5, 9, and 13 show a dim white marker in Track View when the step is not otherwise active. Matches native Move step button behavior.

**Context-Sensitive Button Lighting**
Buttons that are currently accessible light dim white to indicate availability: Mute, Shift, Delete, Capture, Undo, +/−, Left/Right Arrow, Loop.

**Clip Color Pulse**
Active non-empty clips pulse between dim track color and white at a 1/4-note interval.

**LED Corruption on Exit [fix]**
Native Move UI LEDs are left in a corrupted state after SEQ8 backgrounds. Root cause unknown — likely a cleanup step missing from the background lifecycle handler.

---

### System

**GitHub Repository Setup**
Create a remote repository, push the main branch and drum mode branch history, and configure .gitignore. To be done before any further major features to establish a clean remote baseline.

**Move Native Set Copy**
When a Move set is duplicated, the SEQ8 state associated with the original set should be copied and linked to the new set UUID. Requires investigation into the Schwung framework.

**Power Button Shutdown [fix]**
Pressing Move's power button from within SEQ8 does not begin the shutdown process. Needs a Schwung shutdown/suspend lifecycle hook.

**Rename Click Wave File**
The metronome click asset should be renamed to `click.wave`.

**Multiple Simultaneous Clip Pad Presses**
The Session View pad handler currently does not correctly handle two clip pads pressed at the same time. Each press should be processed independently.

---

### v1.1 / Long-term

**Impressive Chords Port**
Port the schwung-impressive-chords DSP into SEQ8 as a dedicated play effects bank. Includes a 52-preset chord table, strum timing, velocity tilt, articulation, retrigger, gate, and choke. Strum timing requires sample-accurate scheduling across render blocks.

**Global MIDI Looper**
Activated by Loop+step in Session View during transport. Captures all post-effects outgoing MIDI across all tracks. Step button determines capture length (Step 1=1 bar, Step 2=1/2 bar, etc.). Stops immediately on release.

**Per-Track MIDI Looper**
Same concept as the global looper but scoped to a single track. Lives in a reserved bank slot.

**Port to Standalone (RNBO)**
Run SEQ8 independently of Move's native instrument layer on the CM4, using RNBO as the host. Requires investigation with the Schwung developer.
