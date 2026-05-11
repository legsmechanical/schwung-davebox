# dAVEBOx User Manual

dAVEBOx is an 8-track MIDI sequencer running as a tool module on the [Schwung](https://github.com/charlesvestal/schwung) platform for Ableton Move. It supports melodic and drum tracks, per-clip effects chains, live recording, step editing, and external MIDI I/O. Tracks can be routed to Move's native instruments, Schwung's internal chains, or an external device via USB-A.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Views and Navigation](#2-views-and-navigation)
3. [Tracks and Clips](#3-tracks-and-clips)
4. [Step Sequencing — Melodic Tracks](#4-step-sequencing--melodic-tracks)
5. [Live Recording](#5-live-recording)
6. [Effects Chain](#6-effects-chain)
7. [Drum Tracks](#7-drum-tracks)
8. [Bake and Live Merge](#8-bake-and-live-merge)
9. [Scenes](#9-scenes)
10. [Performance Mode](#10-performance-mode)
11. [Mixing](#11-mixing)
12. [Copy, Cut & Paste](#12-copy-cut--paste)
13. [Undo / Redo](#13-undo--redo)
14. [Global Settings](#14-global-settings)
15. [MIDI](#15-midi) — [Recommended Setup](#151-recommended-setup)
16. [State and Persistence](#16-state-and-persistence)
17. [Appendix A: LED Reference](#appendix-a-led-reference)
18. [Appendix B: OLED Reference](#appendix-b-oled-reference)
19. [Appendix C: Controls Quick Reference](#appendix-c-controls-quick-reference)

---

## 1. Overview

dAVEBOx opens in Session View, ready to play. On a fresh instance:

- BPM is seeded from Move's current tempo
- Tracks 1–4 are on MIDI channels 1–4, routed to Move's native instruments
- Tracks 5–8 are on MIDI channels 5–8, routed to Schwung
- Launch quantization defaults to 1-bar
- Scale Aware is on

Each track holds 16 clips. Each clip has its own note data and its own set of effects parameters — the same notes can sound completely different depending on which clip is active. Drum tracks extend this further: each of 32 lanes has independent loop length, effects, and repeat settings per clip.

---

## 2. Views and Navigation

### Track View

The primary editing environment. Shows the active track and clip: step buttons represent the current page of the clip, the pad grid shows notes and accepts input, the OLED displays the active parameter bank, and four side buttons switch between clips on the active track.

**In Track View:**

| Control | Action |
|---|---|
| Left / Right arrows | Navigate between pages of the active clip |
| Up / Down buttons | Shift the pad octave range (−4 to +4) |
| Jog rotate | Cycle through parameter banks (clamped) |
| Shift + jog rotate | Cycle through tracks 1–8 (clamped) |
| Loop (held) | Adjust clip length: jog ±1 step per detent |
| Note/Session (tap) | Switch to Session View |
| Note/Session (hold) | Momentary peek at Session View — returns on release |

### Session View

An 8×16 grid showing all clips across all tracks. Each column is a track; each row is a scene. Eight rows are visible at a time; scroll to see all 16.

| Control | Action |
|---|---|
| Tap a clip pad | Launch or queue that clip |
| Tap an empty clip pad | Focus it for recording |
| Shift + clip pad | Activate clip and jump to Track View focused on it |
| Step buttons 1–16 | Launch the corresponding scene row |
| Jog rotate | Scroll scene rows (clamped) |
| +/− buttons | Scroll by 4 rows at a time |
| Hold Mute + pad | Mute / unmute that pad's track |
| Shift + Mute + pad | Solo that track |
| Delete + Mute | Clear all mutes and solos |

The active track label shows in brackets, e.g. `[T1]`. The active empty clip slot for each track shows dark grey so you can always see which slot is in focus. Tapping a clip in Session View also updates Track View's focus — switching to Track View after a launch puts you directly in the right place to edit.

### Global Menu

Open with **Shift + Note/Session**. Jog to navigate items; jog click to enter edit mode; tap **Note/Session** to close.

While the menu is open, all pads, step buttons, and track buttons continue to function normally — only jog inputs are captured by the menu.

See [Section 14](#14-global-settings) for all menu items.

### Navigation Summary

| Control | Context | Action |
|---|---|---|
| Jog rotate | Track View | Cycle parameter banks |
| Jog rotate | Track View + Shift | Cycle tracks 1–8 |
| Jog rotate | Track View + Loop | Adjust clip length ±1 step |
| Jog rotate | Session View | Scroll scene rows |
| Jog rotate | Global Menu | Navigate / edit items |
| Jog click | Global Menu | Confirm selection |
| Delete + jog click | Track View | Reset all params in the active bank (active clip or lane) |
| Shift + Delete + jog click | Track View | Reset all play FX params across all banks (active clip or lane). Sequence Arp excluded on drum lanes. |
| +/− | Track View | Shift pad octave range |
| +/− | Session View | Scroll scene rows by 4 |
| Left / Right | Track View | Navigate clip pages |

### Shift+Step Shortcuts

While Shift is held in Track View, step buttons with available shortcuts blink to indicate they're active.

| Step | Action |
|---|---|
| Step 2 | Open BPM menu |
| Step 5 | Tap tempo |
| Step 6 | Metro toggle (Cnt-In → Play → Always) |
| Step 7 | Open Swing menu |
| Step 8 | Drum tracks: cycle Note Repeat mode / Melodic tracks: toggle chromatic pad layout |
| Step 9 | Open Key menu |
| Step 10 | VelIn toggle (Live ↔ Fixed 127) |
| Step 11 | *(Melodic only)* Arp In on/off |
| Step 15 | Double-and-fill |
| Step 16 | Quantize clip 100% |

---

## 3. Tracks and Clips

### Tracks

dAVEBOx has 8 tracks. Each track is independently configured with a MIDI channel, output route, and mode (Melodic or Drum). Track configuration lives in the Global Menu under **Track Config**.

Tracks are switched via the track buttons in Track View, or by selecting a column in Session View.

### Clips

Each track holds 16 clips. A clip is a container for notes (or drum steps), plus its own copy of the effects chain parameters. Clips are selected via the four side buttons in Track View, or by pressing pads in Session View.

**Clip states:**

| State | Description |
|---|---|
| Empty | No note data, no length set |
| Inactive | Has content, not playing |
| Will relaunch | Was playing when transport stopped; relaunches on next play |
| Queued | Waiting for the next launch quantization boundary |
| Playing | Currently running |

### Per-Clip Parameters

NoteFX, Harmony, Delay, and Sequence Arp parameters are stored per-clip. Launching a different clip changes the sound, timing, and harmonic behavior automatically. Copying a clip carries all parameter settings with the note data. Clearing a clip resets its parameters to defaults.

Arp In is per-track, not per-clip.

### Clip Launch Behavior

How clips launch depends on the **Launch Quantization** setting (Global Menu):

- **Now:** If a clip is already playing on that track, the new clip takes over immediately from the same position (legato). If no clip is playing, it starts from the beginning.
- **1/16 – 1-bar:** Always waits for the next quantization boundary and starts from the beginning. Default is 1-bar.

**Stopping a clip:** Tap a playing clip pad in Session View to queue it to stop at the end of the current bar.

**Transport stop and restart:** When transport stops, which clips were playing is remembered. On restart, those clips automatically relaunch from the beginning. Shift+Play restarts transport immediately from the top. Delete+Play while transport is running deactivates all clips; while stopped, sends a full MIDI panic.



## 4. Step Sequencing — Melodic Tracks

### Step Basics

The 16 step buttons represent the current page of the active clip. Steps are either active (lit) or empty (dark) — there is no intermediate state.

- **Quick tap (< 200ms) on empty step:** Activates the step and assigns the last note played on the pads
- **Quick tap on active step:** Clears it — notes deleted immediately
- **Hold (≥ 200ms):** Opens step edit mode (see below)
- Multiple steps can be tapped at the same time to toggle several at once

Steps beyond the clip's length light white (out of bounds).

The step grid defaults to 1/16 resolution — each step is a 16th note. Set a different resolution per clip in the CLIP bank (K4), or globally adjust quantization in the Global Menu.

> **Try this:** Set one clip to 1/32 resolution and another to 1/8. Sequence the same notes in both and switch between them during playback — same pattern, completely different feel.

### Pad Layout — Melodic Tracks

By default, pads are in **In-Key** mode: only notes within the active scale are shown, arranged by octave, with the root note lit in the track color. Shift+Step 8 toggles **Chromatic** mode — all 12 semitones visible, notes in the scale lit dimly, root in track color.

Use the Up/Down buttons to shift the octave range of the pad grid.

### Step Edit

Hold any step button to open the step edit overlay. All edits apply to every note in the step simultaneously and are non-destructive relative to neighboring steps.

| Knob | Function |
|---|---|
| K1 (Oct) | Shift all notes in the step up/down by octave |
| K2 (Pitch) | Shift all notes by scale degree (scale-aware) |
| K3 (Gate) | Adjust note length — touching K3 shows a gate length overlay on the step buttons |
| K4 (Vel) | Adjust velocity |
| K5 (Nudge) | Shift notes forward/backward in time (±23 ticks max). Step blinks when notes are on the grid. On release, notes that crossed into an adjacent step reassign there. |

While holding a step, the OLED shows the notes assigned to it (e.g. `C4 E4 G4`). Use Up/Down to shift the octave range and reach notes outside the current 4-row window.

Hold multiple step buttons simultaneously to edit several at once.

### Chord Entry

Two methods work:

- **Pad-first:** Hold one or more pads, then press a step button — all held notes are captured simultaneously into that step
- **Step-first:** Hold a step, then tap pads one at a time to add notes additively. Tap a pad already in the step to remove it.

Both methods support up to four notes per step.

> **Try this:** Hold a step and press Up a couple of times to reach higher notes, building a chord that spans more than the visible pad range.

### Pages and Loop View

When a clip is longer than 16 steps, it spans multiple pages. Use Left/Right arrows to navigate between pages. The OLED position bar at the bottom shows the page structure and playhead position.

Hold the **Loop** button to enter pages view — each step button represents a bar of the clip:

- **White:** Currently selected bar
- **Track color:** Bar is within the clip
- **Dim grey:** Beyond clip length

To change the clip's loop length in pages view: hold Loop and jog, or press two step buttons simultaneously to define the start and end.

---

## 5. Live Recording

### Starting and Stopping

- **From stopped:** Press **Record**. dAVEBOx plays a one-bar count-in (step buttons flash on each quarter-note beat). Recording and playback start when the count-in ends. Pressing Play during the count-in cancels the count-in without starting transport.
- **While playing:** Press **Record** at any time. Recording arms immediately with no count-in.
- **Stop recording:** Press **Record** again (transport keeps running), or **Play/Stop** (stops transport too).

Recording is always additive — existing notes are never erased.

### Count-In Pre-Roll

Notes played in the last half-beat of the count-in are captured and placed on step 1 of the recording. The pre-roll note appears on step 1 from the second loop pass onward — it waits for the note to be released and for the first loop pass to complete before firing, which prevents double-triggering if the pad is still held when transport starts.

### Track Switching During Recording

While record-armed, switch tracks freely. Recording follows the focused track. Notes on the previous track are closed out cleanly and record arm stays on.

### Clip Targeting

New recordings go into whichever clip slot is currently focused. To record into a specific clip, select it first in Session View, then switch to Track View and press Record.

### Live Recording Undo

Arming live recording creates a snapshot of the clip at that moment. A single undo reverts the entire recorded session. On drum tracks, the snapshot covers all 32 lanes.

---

## 6. Effects Chain

Each clip carries an independent effects chain that processes notes before they reach the MIDI output. The chain runs in this order:

```
NoteFX + Harmony → Delay → Sequence Arp
```

Then global **Swing** is applied last.

Six banks are accessible in Track View. Jog rotate to cycle banks (clamped, no wrap). The OLED shows all 8 parameters and their values. Touching a knob highlights that parameter row. The LED below each knob lights when that parameter has been changed from its default.

All play FX parameters are **per-clip** (except Arp In, which is per-track).

> **Try this:** Build a simple 4-note sequence, then dial up Delay Repeats to 3 and set Pitch Feedback to +7. Your sequence now generates its own counter-melody.

---

### 6.1 CLIP Bank

Timing and playback settings for the active clip.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Beat Stretch | One-shot: each detent doubles (right) or halves (left) the clip. Blocked if compression would cause two notes to land on the same step. |
| K2 | Clock Shift | Rotates all notes forward/backward by steps. Shows cumulative signed offset while held; resets to 0 on release. |
| K3 | Nudge | Shifts all notes at tick resolution. Shows cumulative offset while held; resets on release. Notes wrap at clip boundary. |
| K4 | Resolution | Per-clip playback speed: 1/32 · 1/16 (default) · 1/8 · 1/4 · 1/2 · 1-bar. Changing rescales all note positions proportionally. Shift+K4 = Zoom mode: keeps note absolute positions fixed and adjusts the step grid around them instead. |
| K5 | Length | Clip length in steps, 1–256. Takes effect immediately. |
| K8 | SeqFollow | On (default): Track View auto-scrolls to follow the playhead. Off: view stays wherever you left it. |

---

### 6.2 NoteFX Bank

Non-destructive transforms applied to every note at render time.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Octave | Shifts all notes up/down by octave |
| K2 | Offset | Shifts notes by semitones, or scale degrees when Scale Aware is on |
| K3 | Pitch Random | 0 = off. 1–24 = max deviation in either direction. Scale-aware — random pitches stay in key. Hold Shift + turn to select algorithm: **Walk** (default — each note steps ±1 from the previous, accumulating), **Uniform** (random offset within range), **Gaussian** (offsets cluster around center). |
| K4 | Gate Time | Scales note duration as % of original (0–400%). 100% = unchanged. Below = staccato; above = legato. |
| K5 | Velocity | Scales note velocity |
| K6 | Quantize | Quantization amount at render time. On drum tracks, affects the active lane only. Use ALL LANES K7 for all lanes simultaneously. |
| K7 | Oct (Lane Note) | **Drum tracks only.** Shifts the active lane's MIDI note up/down by octave. Per-lane. OLED shows note name and number. |
| K8 | Note (Lane Note) | **Drum tracks only.** Shifts the active lane's MIDI note up/down by semitone. Per-lane. |

> **Try this:** Set Pitch Random to Walk mode at a low value (3–5) on a melody. The sequence drifts gradually rather than jumping — coherent variation without chaos.

---

### 6.3 Harmony Bank

Adds harmonic voices on top of each note.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Unison | Adds a unison voice |
| K2 | Octaver | Adds an octave voice |
| K3 | Hrm1 | Harmony voice 1 — semitones or scale degrees when Scale Aware is on |
| K4 | Hrm2 | Harmony voice 2 — semitones or scale degrees when Scale Aware is on |

---

### 6.4 Delay Bank

A MIDI delay that generates rhythmic echoes of each note.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Delay Time | Straight values 1/64–1-bar, dotted variants for all, triplets for 1/16, 1/8, and 1/4. Default: 1/8 Dotted. Use Repeats = 0 to bypass. |
| K2 | Level | Echo velocity level |
| K3 | Repeats | Number of echoes. Default: 0 (bypass). |
| K4 | Velocity Feedback | Velocity change per repeat |
| K5 | Pitch Feedback | Pitch shift per repeat — semitones or scale degrees when Scale Aware is on |
| K6 | Gate | 0 = notes play at natural length. 1–10 = fixed gate length applied to all echoes. |
| K7 | Clock Feedback | Timing shift per repeat |
| K8 | Pitch Random | Same range and algorithm options as NoteFX Pitch Random. Applies to the echo pitches. |

> **Try this:** Set Delay Time to 1/16, Repeats to 4, and Velocity Feedback low. Tap a single chord on the pads and watch it cascade off in time.

---

### 6.5 Sequence Arp Bank

A step arpeggiator applied after Delay. Per-clip. Applies to both sequenced note output and live pad input.

When Style = Off and Steps = Mute or Skip, the step pattern acts as a standalone rhythmic gate — notes pass through on active steps and are silenced on muted steps, without arpeggiation. This enables per-clip trance gate behavior.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off · Up · Down · Up/Down · Down/Up · Converge · Diverge · Play Order · Random · Random Other. Default: Off. |
| K2 | Rate | 1/32 · 1/16 · 1/16t · 1/8 · 1/8t · 1/4 · 1/4t · 1/2 · 1/2t · 1-bar |
| K3 | Octaves | Bipolar. Positive = adds octaves above; negative = below. |
| K4 | Gate | 1–200%. 100% = note ends as next begins. Below = staccato; above = legato overlap. |
| K5 | Steps | Off · Mute · Skip. When Mute or Skip: touch K5 to open the step velocity editor on the pads (8 columns × 4 rows; column = step, row = velocity level: 10 / 52 / 94 / 127). |
| K6 | Retrigger | On (default): pattern resets to step 1 on each new note and at clip loop boundary. Off: arp runs free. |
| K7 | Sync | On (default): first arp step waits for the next global rate boundary, locking in phase with transport. |

---

### 6.6 Arp In Bank

A live arpeggiator for pad input and external MIDI. Per-track (not per-clip). Does not affect sequenced notes.

**Latch shortcut:** While holding pads with Arp In active, tap **Loop** to toggle latch on/off without entering the Arp In bank.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off (disables arp) · Up · Down · Up/Down · Down/Up · Converge · Diverge · Play Order · Random · Random Other |
| K2 | Rate | 1/32 · 1/16 · 1/16t · 1/8 · 1/8t · 1/4 · 1/4t · 1/2 · 1/2t · 1-bar |
| K3 | Octaves | −4 to +4. Negative = arpeggiate downward; positive = upward. 0 is skipped (−1 to +1). |
| K4 | Gate | 1–200%. 100% = note ends as next begins. |
| K5 | Steps | Off · Mute · Skip. Touch K5 to open the step velocity editor. Mute: muted steps are rests, arp cycle continues underneath. Skip: muted steps removed from cycle entirely. |
| K6 | Retrigger | On (default): pattern resets on each new note. Off: arp runs free. |
| K7 | Sync | On (default): waits for the next rate boundary before firing the first step. Off: fires immediately on pad press. |
| K8 | Latch | Off · On. On: arp keeps running after pad release. First touch of a new gesture replaces the latched note set; additional presses during the same gesture add notes. Latch resets on track switch or entering Session View. |

> **Try this:** Enable Arp In with Style = Up, Rate = 1/16, Latch = On. Play a chord, latch it, then switch to a different track. The arp runs hands-free while you sequence on another track.

---

### 6.7 CC Automation Bank

Melodic tracks only. Each of the 8 knobs is independently assignable to a MIDI CC number. CC assignments are per-track; automation data is per-clip at 1/32 resolution with interpolation on playback.

**Knob LED states in CC Automation bank:**

| State | LED |
|---|---|
| Unassigned | Off |
| Assigned, no automation | White |
| Has automation for this clip | Vivid yellow |
| Recording armed | Red (brightness = current CC value) |
| Playback with live automation | Green (brightness = automation value at playhead) |

Hold Shift + turn a knob to assign it to a CC number. CC output follows the track's configured Route and MIDI channel.

---

## 7. Drum Tracks

Switching a track to Drum mode (Track Config → Mode in the Global Menu) changes it to a drum sequencer. The pad grid becomes 32 lanes arranged across two 4×4 banks (A and B). Each lane plays a distinct MIDI note.

### Pad Layout

- **Left 4×4:** Drum lane pads (16 lanes, bank A or B)
- **Right 4×4:** Function area — varies by mode: Velocity, Rpt1, or Rpt2

**Velocity mode** (default): The right 4×4 is a 16-zone velocity pad. Zones map from velocity 8 (bottom-left) to velocity 127 (top-right). Used for live monitoring, step-edit velocity, and live recording.

Switch modes via DRUM LANE bank K7, or jog click (cycles Velocity → Rpt1 → Rpt2 → Velocity). The OLED header shows the current mode: `Vel`, `Rpt1`, or `Rpt2`.

### Step Sequencing

Drum step sequencing works per-lane. Tap a lane pad to select it (the lane LED pulses), then use the step buttons to add or remove hits for that lane. To select a lane silently without triggering it, use **Capture + lane pad**.

- **Quick tap on empty step:** Adds a hit at that step for the active lane
- **Quick tap on active step:** Removes the hit
- **Hold (≥ 200ms):** Opens step edit mode

Multiple lanes can be viewed and edited independently — select a lane, edit its steps, then select another lane. The step buttons always show the active lane's pattern.

**Step edit on drum tracks:**

| Knob | Function |
|---|---|
| K3 (Gate) | Adjust the hit's gate length |
| K4 (Vel) | Adjust the hit's velocity |
| K5 (Nudge) | Shift the hit forward/backward in time (±23 ticks max) |

K1 (Oct) and K2 (Pitch) are not available in drum step edit — use the NoteFX bank K7/K8 to change a lane's MIDI note assignment.

### Per-Lane Loop Length

Each lane can have an independent loop length within the clip, enabling polyrhythmic patterns without any extra setup. Set a lane's length via the CLIP bank K5 (applies to the active lane only), or by holding Loop and jogging.

> **Try this:** Set your kick to 16 steps, your hi-hat to 12, and a percussion lane to 10. Each loops at its own rate against a shared transport.



Per-lane settings for the active lane.

| Knob | Parameter | Notes |
|---|---|---|
| K2 | Clock Shift | Shifts the active lane only |
| K3 | Nudge | Nudges the active lane only |
| K7 | Mode | Cycles Velocity → Rpt1 → Rpt2 |

Lane MIDI note assignments persist across saves and reloads. Use NoteFX bank K7/K8 to shift a lane's MIDI note by octave or semitone.

### ALL LANES Bank

Bank 7 on drum tracks only. Applies CLIP-style parameters to all 32 lanes simultaneously.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Stretch | Beat stretch applied atomically. If any lane can't compress or expand, the entire operation is a no-op ("NO ROOM" popup). |
| K2 | Clock Shift | Shifts all lanes simultaneously |
| K3 | Nudge | Nudges all lanes simultaneously |
| K4 | Resolution | Sets step resolution for all lanes |
| K5 | Length | Sets clip length for all lanes |
| K6 | Velocity Input | Global velocity input setting for all lanes |
| K7 | Quantize | Sets NoteFX quantize for all 32 lanes simultaneously |

### Note Repeat

Note Repeat retriggers drum lanes at rhythmic intervals. Available in Rpt1 (single-lane) and Rpt2 (multi-lane) modes.

**Right-side pad layout (Rpt1 and Rpt2):**

| Row | Pads |
|---|---|
| Top 2 rows (8 pads) | Gate mask steps 0–7 |
| Row 2 | Rates: 1/32T · 1/16T · 1/8T · 1/4T |
| Bottom row | Rates: 1/32 · 1/16 · 1/8 · 1/4 |

**Rpt1 — single-lane repeat:**
- Hold a rate pad to retrigger the active drum lane at that rate; release to stop
- Velocity is pressure-sensitive (aftertouch); VelIn override applies
- Switch lanes while holding a rate pad without interrupting the repeat

**Rpt2 — multi-lane repeat:**
- Tap a rate pad to assign it to the active lane (does not trigger on its own)
- Hold any drum lane pad to repeat that lane at its assigned rate
- Hold multiple lane pads simultaneously — each repeats independently at its assigned rate
- Velocity is pressure-sensitive per held pad

**Latching:**

*Rpt1:* Loop + rate pad starts and latches. Loop tap while holding latches the current repeat. Press the active rate pad again or Delete+Loop to stop.

*Rpt2:* Loop + lane pad latches that lane. Hold lane pad + Loop latches all currently held lanes. Tap a latched lane to unlatch it. Delete+Loop stops all.

**Repeat loop length:** Hold Loop + tap a gate pad to set how many steps the repeat pattern cycles through (1–8). Gate pads beyond the active cycle length go dark.

> **Try this:** In Rpt2, assign different rates to different lanes (kick = 1/4, hi-hat = 1/16, snare = 1/8). Hold all three simultaneously for a full driving pattern, then release individual lanes to strip it back.

### Gate Mask

The top 2 rows of the right 4×4 (8 pads) form a looping gate mask:

- All 8 steps active by default
- Tap to toggle a step off (rest); tap again to restore
- Per-lane; persists across clip/track switches and save/load
- OLED shows each step as a solid bar (active) or empty outline (off)
- Delete + gate mask pad: resets that step's velocity scaling and nudge offset to defaults (does not affect the gate toggle state)

### RPT GROOVE Bank

Available on drum tracks only (replaces Arp In when a repeat mode is active). Per-lane, persists.

**Unshifted (K1–K8) — Velocity Scaling:** One knob per gate mask step. Range 0–200%. Default: 100% (passthrough). Applied to the pressure-sensitive velocity input.

**Shift + knob — Nudge Offset:** Range −50% to +50% of the step interval. Stored as a percentage so the groove shape is consistent at all rates.

Delete + jog click (in Rpt1 or Rpt2): resets entire groove for the current lane — all gates on, all velocity 100%, all nudge 0%.

### Lane Mute / Solo

- **Mute a lane:** Hold Mute + press the lane pad
- **Solo a lane:** Hold Shift + Mute + press the lane pad
- **Select lane without playing:** Capture + press the lane pad

Mute and solo are mutually exclusive: soloing a muted lane clears its mute; muting a soloed lane clears its solo.

### Drum Loop View

Hold the **Loop** button on a drum track to see pages view on the step buttons:

- Pages with notes: pulse between track color and off
- Empty pages within clip length: solid track color
- Pages beyond clip length: dim grey

### Lane and Clip Copy / Cut

**Lane copy (Track View):**
- Hold Copy + press a lane pad → source blinks white
- Press another lane pad → pastes all step data. The destination lane's MIDI note is preserved.
- Clipboard is sticky — paste to multiple lanes without re-selecting source
- Shift+Copy = cut: source clears after first paste

**Drum clip copy:** Same as melodic clip copy (see [Section 12](#12-copy-cut--paste)) but copies all 32 lanes. Each destination lane's MIDI note is preserved. Works cross-track; pasting to a melodic track is ignored.

---

## 8. Bake and Live Merge

### Bake

Bake applies the active clip's effects chain to its note data offline, writes the results back into the clip, and resets all effect parameters to defaults. Undo restores original notes and parameters.

Press **Sample** to open the bake dialog.

**Melodic bake:**

The dialog always appears with options: CANCEL / 1× / 2× / 4× / 8× (defaults to 1×).

- **1×:** Bakes the clip once
- **2×/4×/8×:** Bakes N loops end-to-end; delay echoes bleed from the end of each loop into the start of the next
- After selecting 2×/4×/8×, a second dialog asks **WRAP TAILS?** — Yes wraps delay echoes that fall past the clip end back to the beginning (useful for seamless looping clips)

Full chain is applied: NoteFX + Harmony → Delay → Sequence Arp. Walk mode Pitch Random produces independent sequences per loop.

**Drum bake:**

Dialog options: CANCEL / CLIP / LANE / 1×.

- **CLIP mode:** Full chain runs per lane. Harmony can move hits between lanes. Notes at pitches with no matching lane are dropped. All lane effect params reset to defaults.
- **LANE mode:** Processes the active lane only. Captures velocity, gate, timing, and Sequence Arp. Pitch transforms and Harmony are not applied.

If the clip is empty, bake does nothing.

> **Try this:** Bake a clip at 4×, then load fresh effects on top of the baked result and bake again. Layer by layer, you can build complex patterns that would be impossible to sequence by hand.

### Live Merge

Live Merge captures the active track's post-effects MIDI output into the first available empty clip slot in real time.

- **Shift + Sample:** Arm (LED turns red)
- Transport starts → LED turns green (capturing)
- **Sample:** Schedule stop at the next 16-step page boundary
- Auto-finalizes at 256 steps

On melodic tracks, notes are captured with all effects applied. On drum tracks, captured notes are routed to matching lanes by pitch.

Undoable. If no empty clip slot is available, a "NO EMPTY CLIP SLOT" message appears.

> **Try this:** Run a sequence with heavy Pitch Random and Delay for a while, then Live Merge it. You capture the actual randomized output as fixed note data — a snapshot of one particular performance of the effects chain.

---

## 9. Scenes

### Launching Scenes

A scene is a horizontal row of clips across all 8 tracks. Any clip in that row fires together.

- **Scene button** (left of each row in Session View): launches the scene — playing clips stop at end of current bar; all clips in the row start together at the next bar boundary
- **Step buttons 1–16 (Session View):** Launch the corresponding scene row

### Scene Copy and Duplicate

- **Hold Copy + scene row button:** Copy all 8 clips in that row
- **Hold Shift+Copy + scene row button:** Cut the row

Paste by pressing another scene row button.

To duplicate a scene in Control mode, hold Copy and press the scene's pad in the Main track column — the duplicate appears below the original.

### Scene Clear

- **Delete + scene row button:** Clears all notes from all 8 clips in that row. Clips stop playing.
- **Shift+Delete + scene row button:** Hard reset — clears notes AND resets all per-clip params. Fires "CLIPS CLEARED" pop-up. Undoable.

---

## 10. Performance Mode

Performance Mode is a real-time effect layer in Session View. It captures a short loop from the sequencer output and plays it back with live transformations applied.

### Activation

In Session View, use the **Loop** button:

| Action | Result |
|---|---|
| Tap Loop | Lock perf mode — persists hands-free; Loop blinks at 1/8-note rate |
| Hold Loop | Temporary — pads active while held, exits on release |
| Shift + Loop | Toggle latch mode (mod pads toggle on/off rather than momentary) |

While Loop is held, press a step button to set the capture length. The looper waits for the next aligned clock boundary, captures, then loops continuously.

**Capture lengths:** Step 1=1/32 · Step 2=1/16 · Step 3=1/8 · Step 4=1/4 · Step 5=1/2 bar · Step 6=1 bar. Hold Step 16 while selecting a length for the triplet variant.

**Per-track inclusion:** Track Config → Looper (On/Off). On = track feeds the looper and is silenced during playback. Off = track plays normally throughout.

### Pad Layout

```
R3 (top)   Wild mods      — cyan
R2         Vel/Gate mods  — yellow
R1         Pitch mods     — magenta
R0 (bottom) 1/32 | 1/16 | 1/8 | 1/4 | 1/2 | Hold | · | Latch
```

All active mods (held + latched + recalled presets) layer simultaneously.

**R0 controls:**
- **Length pads (1/32–1/2):** Select capture length and trigger capture
- **Hold:** Persistent hold mode — releasing a length pad doesn't stop the loop. Press Hold again to cancel.
- **Latch:** Toggle latch mode

### R1 — Pitch Mods

Scale-aware; bypassed on drum tracks.

| Pad | Name | Behavior |
|---|---|---|
| 1 | Oct Up | Odd cycles = original; even cycles = +1 octave |
| 2 | Oct Down | Odd cycles = original; even cycles = −1 octave |
| 3 | Scale Up | +1/+2/+3 scale degrees across 3 cycles, then resets |
| 4 | Scale Down | −1/−2/−3 scale degrees across 3 cycles, then resets |
| 5 | Fifth | Ascends by 5th each cycle, then octave+2nd, then octave+5th |
| 6 | Tritone | Ascends by 4th, 6th, octave+2nd across 4 cycles |
| 7 | Drift | ±1 scale degree random walk per cycle, accumulates up to ±6 |
| 8 | Storm | Each note gets a random ±6 scale degree shift every play — chaotic but always in key |

### R2 — Velocity & Gate Mods

Applies to all tracks including drums.

| Pad | Name | Behavior |
|---|---|---|
| 1 | Decrescendo | Vel ×0.85 per cycle — fades out over ~6–7 cycles |
| 2 | Swell | 16-cycle triangle wave — loud at 0 and 16, quietest at 8 |
| 3 | Crescendo | Vel ×1.15 per cycle |
| 4 | Pulse | Even cycles = full vel; odd cycles = 20% vel |
| 5 | Sidechain | Successive notes within each cycle get −15% vel per note |
| 6 | Staccato | Gates all notes to 1/8 of loop length |
| 7 | Legato | Gates all notes to full loop length |
| 8 | Ramp Gate | Gate ramps up across notes in cycle — first shortest, last longest |

### R3 — Wild Mods

| Pad | Name | Behavior |
|---|---|---|
| 1 | Half Time | Every other cycle suppressed |
| 2 | 3 Skip | Every third cycle suppressed |
| 3 | Phantom | Ghost note 1 octave below each note — quarter vel, short gate |
| 4 | Sparse | ~50% chance each note suppressed per cycle |
| 5 | Glitch | Each note ±2 scale degrees random shift |
| 6 | Stagger | Note 1 = original, note 2 = +1 scale degree, note 3 = +2, etc. |
| 7 | Shuffle | Pitch order randomizes each cycle; drum hit order shuffles |
| 8 | Backwards | Pitch order reverses each cycle; drum sequence reverses |

> **Try this:** Activate Storm (R1-8) + Sparse (R3-4) + Decrescendo (R2-1) simultaneously. The result is an unpredictable, thinning-out melodic scatter that sounds nothing like where it came from.

### Preset Slots

Step buttons 1–16 are preset slots in Performance Mode:

- **Tap:** Recall that slot (mods layer on top of held/latched)
- **Hold ~0.75s:** Save current mod state to slot (step buttons double-blink to confirm)
- **Delete + step:** Clear that slot

Steps 1–8 are factory presets:

| Slot | Name | Mods |
|---|---|---|
| 1 | Float | Scale Up + Legato |
| 2 | Sink | Oct Down + Decrescendo + Staccato |
| 3 | Heartbeat | Pulse + Half Time |
| 4 | Fairy Dust | Storm + Swell + Sparse |
| 5 | Robot | Tritone + Pulse + 3 Skip |
| 6 | Dissolve | Drift + Decrescendo + Phantom |
| 7 | Chaos | Storm + Glitch + Backwards |
| 8 | Lift | Scale Up + Crescendo + Ramp Gate |

Steps 9–16 are user slots.

### Loop Control

- **Changing length while running:** Press a different length pad to queue a new length — current cycle finishes, then fresh capture starts. Press the same pad again to immediately retrigger.
- **Lock mode (tap Loop while in perf mode):** Loop blinks at 1/8-note rate. Loops and mods persist hands-free. Tap Loop again to unlock and stop. Switching to Track View also unlocks and stops, but preserves mod state.

### Persistence

Latched mods, latch mode, recalled preset slot, and custom presets (slots 9–16) persist when leaving Performance Mode.

---

## 11. Mixing

### Output Volume

Turn the **Volume encoder** in Track View or Session View (without holding anything) to adjust the overall output level.

### Track Volume

Hold the **track button** for any track and turn the **Volume encoder** to adjust that track's volume in dB. The track button LED turns red when adjusting. During playback, track button LEDs reflect current volume levels: track color for low to medium, white at high levels.

### Mute

**Track View:**
- Press **Mute:** Toggle mute on the focused track
- Mute button LED: blinking at 1/8 = muted; solid = soloed; off = neither

**Session View:**
- Hold **Mute** + press any pad in a column: toggle mute on that track

**Either view:**
- Delete + Mute: clear all mutes and solos

### Solo

**Track View:** Shift + Mute — toggle solo on the focused track

**Session View:** Shift + Mute + press any pad in a column — toggle solo on that track

Muting a soloed track clears the solo. Soloing a muted track clears the mute.

### Mute/Solo Snapshots

16 slots for saving and recalling mute/solo state, including per-lane drum mutes. Access them by holding **Mute** in Session View — step buttons light up: **light purple** = empty slot, **bright blue** = saved state.

- **Save:** Hold Mute + hold a step button ~0.75s → step buttons double-blink to confirm
- **Recall:** Mute + tap a lit step button → all tracks jump to the saved state immediately
- **Clear:** Mute + Delete + step button

Snapshots persist across reboots.

---

## 12. Copy, Cut & Paste

### Sticky Clipboard

The clipboard stays live after each paste, so you can paste to multiple destinations from the same source without re-selecting. The clipboard clears when you release the Copy button.

### Step Copy

In Track View: hold **Copy** + press the source step (blinks white) → press the destination step. Copies all data: notes, gate lengths, velocities, timing offsets. Same clip only.

### Clip Copy / Cut

**Copy:**
- Hold **Copy** + press a clip button (Track View) or clip pad (Session View) → source blinks, "COPIED" shown
- Press destination to paste

**Cut (Shift + Copy):**
- Hold **Shift+Copy** + press source → "CUT" shown
- Press destination → source clears, destination receives content
- Source clears after first paste, but clipboard remains for subsequent pastes

**Scene row copy/cut:** Hold Copy/Shift+Copy + scene row button → copies/cuts all 8 clips in that row. Mixing clip and scene-row kinds is rejected.

All copy/cut/paste operations are undoable.

### Drum Lane Copy

In Track View: hold **Copy** + press source lane pad → press destination lane pad. Pastes all step data; destination lane's MIDI note is preserved.

---

## 13. Undo / Redo

dAVEBOx supports one level of undo and redo.

- **Undo:** Undo button
- **Redo:** Shift + Undo
- After undoing, performing any new action discards the redo state
- If nothing to undo/redo: brief "NOTHING TO UNDO" / "NOTHING TO REDO" on OLED

**Undoable actions:** step clear, step copy, clip clear, clip copy/cut, hard reset (single clip or scene row), row clear, row copy, live recording session, bank param reset, full bank reset, Loop Double, drum lane copy/cut, drum clip copy/cut.

---

## 14. Global Settings

Open with **Shift + Note/Session**.

### Track Config

At the top of the Global Menu, above global settings. Shows the active track number: e.g. "Track [3] Config". All values update live if the track changes while the submenu is open.

| Entry | Values | Notes |
|---|---|---|
| Channel | 1–16 | MIDI channel for this track |
| Route | Move · Schwung · External | Output routing |
| Mode | Melodic · Drum | Switches immediately; existing clip data is cleared |
| VelIn | Live · 1–127 | Live = raw velocity. Fixed value overrides all input velocity on this track, applied pre-sequencer. |
| Looper | On · Off | Whether this track feeds Performance Mode |

A "── Global ──" separator appears below Track Config.

### Global Settings

| Item | Description |
|---|---|
| Metro | Cnt-In · Play · Always. Controls when the metronome click is audible. Count-in click plays on all 4 beats. |
| Metro Vol | 0–150%. 100% = full scale; 150% = hot. |
| Tap Tempo | Full-screen tap interface. Any pad tap calculates BPM from rolling average. Jog adjusts ±1 BPM per detent. Jog click or Note/Session exits and applies. |
| BPM | Set tempo 40–250. Updates in real time. Note/Session cancels and restores previous. |
| Key | Global root note (A through G#) |
| Scale | Major · Minor · Dorian · Phrygian · Lydian · Mixolydian · Locrian · Harmonic Minor · Melodic Minor · Pentatonic Major · Pentatonic Minor · Blues · Whole Tone · Diminished |
| Scale Aware | On (default) / Off. When On, scale-aware parameters (NoteFX Offset and Pitch Random, Harmony Hrm1/Hrm2, Delay Pitch Feedback and Pitch Random) step in scale degrees rather than semitones. Bypassed on drum tracks. |
| Launch Quantization | Now · 1/16 · 1/8 · 1/4 · 1/2 · 1-bar (default). When set to Now, clip launches are immediate and legato if a clip is already playing. All other values wait for the next boundary and always start from the beginning. |
| MIDI In | All / 1–16. Channel filter for external MIDI input. |
| Swing Amt | 50%–75%. 50% = no swing. 66% = perfect triplet swing. Applied globally at render time. |
| Swing Res | 1/16 (default) · 1/8. Controls which note positions are affected by swing. |
| Input Quantize | On / Off. When On, live recorded notes snap to the current step grid. |
| Beat Markers | On / Off. When On, step buttons 1, 5, 9, and 13 show a dim white marker in Track View when not otherwise active. |
| Clear Session | Resets the entire dAVEBOx instance. Presents a Yes/No dialog (defaults to No). Only the active set is affected. |
| Save | Closes the menu and saves DSP state and UI sidecar immediately. Shows "STATE SAVED". |
| Quit | Saves current state and exits dAVEBOx. |

---

## 15. MIDI

### 15.1 Recommended Setup

dAVEBOx's default routing sends tracks 1–4 to Move's native instruments and tracks 5–8 to Schwung. For this to work correctly, Move and Schwung need to be configured to receive on the right channels.

**Move tracks 1–4:**

| Move Track | MIDI In | MIDI Out |
|---|---|---|
| Track 1 | Channel 1 | Off |
| Track 2 | Channel 2 | Off |
| Track 3 | Channel 3 | Off |
| Track 4 | Channel 4 | Off |

Set MIDI Out to Off to prevent Move from echoing MIDI back out and causing loops.

**Schwung slots 1–4:**

| Schwung Slot | Rcv Channel |
|---|---|
| Slot 1 | Channel 5 |
| Slot 2 | Channel 6 |
| Slot 3 | Channel 7 |
| Slot 4 | Channel 8 |

Also ensure each Schwung slot's Forward Channel is set to **Auto** or a specific channel — not Thru. Thru is the default for new slots and will silently prevent channel routing from working.

Once configured, dAVEBOx tracks 1–4 play Move instruments directly, and tracks 5–8 play through Schwung's effects chains.

---

### 15.2 Per-Track Channel and Route

Each track independently configures:

- **Channel:** MIDI channel 1–16. Default: track N on channel N.
- **Route:** Move (native instruments), Schwung (internal chain), or External (USB-A MIDI out).

Set both via Track Config in the Global Menu.

### 15.3 External MIDI Input

dAVEBOx receives external MIDI from controllers connected to Move's USB-A port. Filter by channel in the Global Menu (All or 1–16).

External MIDI is always routed to the active track. Switching tracks sends a clean note-off to the previous track. External MIDI integrates with step input: playing a note while holding a step adds that pitch exactly like tapping a pad.

dAVEBOx automatically rechannelizes incoming MIDI to match the active track's configured channel — your controller doesn't need to match the synth channel.

### 15.4 Live Effects on External MIDI

| Route | Live effects on external MIDI |
|---|---|
| Schwung | Full play effects chain applies — Arp In, NoteFX, Harmony, Delay all process external MIDI exactly like pad input |
| Move | Effects chain does not apply. Notes reach the Move instrument directly. Routing live MIDI through the pfx chain on a Move-routed track creates an echo loop that crashes the device — this is an architectural constraint. |

> ⚠️ **Do not send external MIDI into Move-routed tracks.** Use Schwung routing if you need effects processing on live MIDI input.

### 15.5 External MIDI Output

When a track's Route is set to External, all MIDI output for that track goes via USB-A:

- Sequencer playback
- Live pad input
- External MIDI input (echoed to USB-A)
- Full play effects chain output
- Arp In output
- Performance Mode mods

Notes are sent on the track's configured MIDI channel. Multiple tracks can all route to External simultaneously, enabling multi-timbral setups on a single USB-A connection.

Transport stop sends note-offs for all sounding notes. Delete+Play (stopped) sends a full panic on all channels.

### 15.6 CC Automation

CC automation is recorded per-clip at 1/32 resolution with interpolation on playback. On External-routed tracks, CC values are sent via USB-A. See [Section 6.7](#67-cc-param-bank) for bank details.

---

## 16. State and Persistence

### Saving

State saves automatically when you:
- **Suspend** dAVEBOx (press **Back** — the sequencer keeps playing in the background)
- **Exit** dAVEBOx (**Shift+Back** or **Quit** from the Global Menu — these are equivalent)

Use **Save** in the Global Menu for an immediate manual save at any time.

State is not saved continuously during use.

### What Persists Per Set

- All note data (per clip, per track)
- Per-clip params (NoteFX, Harmony, Delay, Sequence Arp per clip)
- Track settings (channel, route, mode, octave shift)
- CLIP bank values per clip
- Global settings (BPM, Key, Scale, Launch Quantization, Scale Aware)
- Mute/solo state and all 16 snapshots (including drum lane mutes)
- MIDI In channel setting
- Note Repeat per-lane settings

### Move Set Duplication — State Inheritance

When you duplicate a Move set via the native set page, the new set inherits the dAVEBOx state from the source on first launch. The exact behavior depends on how many known parent sets are found:

- **One known parent:** Silent auto-inherit, no dialog
- **Zero known parents:** Silent blank start
- **Two or more candidates:** A dialog appears: "Copied Move set detected / Inherit dAVEBOx state from?" listing each candidate plus a "Start blank" option. Jog to navigate, jog click to confirm; Sample cancels (= Start blank).

Sources whose Move set has since been deleted are filtered out of the picker.

Selecting "Start blank" cleanly resets the DSP with no carryover.

### Orphan Cleanup

On launch, dAVEBOx prunes its own state files for any Move set that has been deleted. Schwung's files in those folders are left untouched.

---

## Known Limitations

- **External MIDI into Move-routed tracks causes a crash.** Use Schwung routing if you need effects processing on live MIDI input.
- **The hardware volume knob briefly interrupts MIDI output when turned.** Avoid adjusting during performance-critical moments.
- **Powering Move off from within dAVEBOx causes a brief hang** before shutdown.

---

## Appendix A: LED Reference

### Clip Pads (Session View)

| State | LED |
|---|---|
| Empty slot | Unlit |
| Has content, inactive | Very dim track color |
| Active empty slot (focused) | Dark grey |
| Will relaunch when transport starts | Solid bright track color |
| Playing | Flash between dim and bright track color at 1/8-note rate |
| Queued to launch | Flash between dim and bright track color at 1/16-note rate |
| Queued to stop | Flash between dim track color and off at 1/16-note rate |

All playing clips flash in sync, locked to the main clock.

### Side Clip Buttons (Track View)

| State | LED |
|---|---|
| Currently editing (not playing) | Solid bright track color |
| Currently editing AND playing | Flash at 1/8-note rate |
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
| Rows currently in view | Red (pulsing red if any clip in that row is playing) |
| Rows out of view with playing clips | Pulsing white |
| Rows out of view with content | Dim white |
| Rows out of view, all empty | Off |

### Knob LEDs (Track View)

**All banks except CC Automation:** Lit when the parameter has been changed from its default. Off when at default.

**CC Automation bank:**

| State | LED |
|---|---|
| Unassigned | Off |
| Assigned, no automation | White |
| Has automation data for this clip | Vivid yellow |
| Recording armed | Red — brightness = current knob value (0–127) |
| Playback with live automation | Green — brightness = automation value at playhead |

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

## Appendix B: OLED Reference

### Bank Header Format

All bank headers use `[ LABEL ]` format with a space inside the brackets, e.g. `[ NoteFX ]`, `[ DRUM LANE ]`.

On drum tracks, headers use a prefix convention to indicate context:
- `DRUM LANE >>` — the DRUM LANE bank (per-lane)
- `>> BANKNAME` — all other per-lane banks (e.g. `>> NoteFX`, `>> Delay`)
- `ALL LANES` — no prefix

### Bank Parameter Display

All 8 parameters and their current values are shown simultaneously in Track View. When you touch or turn a knob, that parameter's row inverts (black text on white background) to highlight it. The highlight clears when you release the knob. The full overview remains visible at all times — touching a knob never replaces it.

### Idle Screen — Melodic Track

Two rows below the bank label:

**Row 1 (status bar):** Metro mode indicator · VelIn indicator (Live or fixed value) · Fix/Adap recording indicator

| Indicator | Meaning |
|---|---|
| Fix | Clip has content or a pre-set length — recording loops at the existing size |
| Adap | Clip slot is empty with no set length — recording grows until stopped |

**Row 2:** `Oct:+0` · `Arp` (visible only when Arp In is active) · Current key and scale (right-aligned, e.g. `A Min`, `C# Pent+`). When Scale Aware is on, a 1px underline appears beneath the key/scale text.

### Idle Screen — Drum Track

Below the bank label:

**Pad info row:** `Bank: A  Pad: C3 (48)` — shows the active bank (A or B) and the active lane's MIDI note name and number.

**Mute/solo row:** Shows the mute/solo status for the active lane only.

### Performance Mode OLED

When a mod pad is pressed, the OLED briefly shows the full mod name (e.g. `Scale Up`, `Decrescendo`). It then settles to show an abbreviated list of all currently active mods simultaneously.

### Track Number Row

Track numbers 1–8 are distributed across the full OLED width.

| State | Display |
|---|---|
| Active track | 1px box drawn around the number |
| Muted track | Inverted (white background, black number) |
| Soloed track | Blinking |

### Position Bar

A segmented bar at the bottom of Track View shows the clip's page structure:

| Segment | Meaning |
|---|---|
| Solid block | Page currently in view |
| Outline box | Page the playhead is on (when different from view page) |
| Bottom edge line | Other pages with content |

A dot moves across the full bar tracking the playhead in real time. When the dot passes over the solid block, it inverts to black to remain visible.

### Action Pop-ups (500ms)

Pop-ups are dismissed immediately if you touch a knob or enter step edit.

| Action | Message |
|---|---|
| Copy source selected | COPIED |
| Cut source selected | CUT |
| Copy/cut destination confirmed | PASTED |
| Clip clear | SEQUENCE CLEARED |
| Scene row clear | SEQUENCES CLEARED |
| Hard reset (single clip) | CLIP CLEARED |
| Hard reset (scene row) | CLIPS CLEARED |
| Bank param reset | BANK RESET |
| Full bank reset | CLIP PARAMS RESET |
| Loop doubled successfully | LOOP DOUBLED |
| Loop double at max length | CLIP FULL |
| Beat stretch blocked (no room) | NO ROOM |
| Resolution zoom blocked | NOTES OUT OF RANGE |
| Beat stretch compress blocked | COMPRESS LIMIT |
| State saved | STATE SAVED |
| Undo | UNDO |
| Nothing to undo | NOTHING TO UNDO |
| Redo | REDO |
| Nothing to redo | NOTHING TO REDO |

---

## Appendix C: Controls Quick Reference

### Track View — Melodic

| Control | Action |
|---|---|
| Pad | Play note; add to step if a step is held (step-first chord entry) |
| Pads (held) + step button | Capture all held notes into that step (pad-first chord entry) |
| Up / Down | Shift pad octave range |
| Step button (tap) | Add or remove hit; assigns last played note to empty steps |
| Step button (hold) | Open step edit overlay |
| Step buttons (simultaneous tap) | Toggle multiple steps at once |
| Side clip buttons | Switch active clip |
| Track buttons | Switch active track |
| Track button (hold) | Momentarily view that track without switching |
| Jog rotate | Cycle parameter banks |
| Shift + jog rotate | Cycle tracks 1–8 |
| Loop + jog rotate | Adjust clip length ±1 step |
| Delete + jog click | Reset all params in active bank (active clip) |
| Shift + Delete + jog click | Reset all play FX params across all banks (active clip) |
| Left / Right arrows | Navigate clip pages |
| Volume encoder | Adjust output volume |
| Track button (held) + Volume encoder | Adjust that track's volume |
| Play | Start / stop transport |
| Shift + Play | Restart transport from beginning |
| Delete + Play (running) | Deactivate all clips |
| Delete + Play (stopped) | MIDI panic |
| Record | Start / stop recording |
| Capture | Capture played notes into clip |
| Shift + Capture | Clear capture input |
| Loop | Enter pages / loop view |
| Mute | Toggle mute on active track |
| Shift + Mute | Toggle solo on active track |
| Mute + track button | Mute / unmute that track |
| Shift + Mute + track button | Solo / unsolo that track |
| Delete + Mute | Clear all mutes and solos |
| Copy | Duplicate active clip |
| Copy + step button | Copy step (press dest step to paste) |
| Copy + side clip button | Copy clip (press dest to paste) |
| Shift + Copy + side clip button | Cut clip |
| Delete | Delete active clip |
| Delete + side clip button | Clear all notes in clip |
| Shift + Delete + side clip button | Hard reset clip — clears notes and resets all per-clip params |
| Undo | Undo last action |
| Shift + Undo | Redo |
| Sample | Open bake dialog |
| Shift + Sample | Arm Live Merge |
| Note/Session | Switch to Session View |
| Note/Session (hold) | Momentary peek at Session View |
| Shift + Note/Session | Open Global Menu |
| K1–K8 | Adjust parameter in active bank |
| Shift + K4 (CLIP bank) | Resolution Zoom mode — adjusts step grid without rescaling note positions |
| Shift + Step 2 | Open BPM menu |
| Shift + Step 5 | Tap tempo |
| Shift + Step 6 | Metro toggle |
| Shift + Step 7 | Open Swing menu |
| Shift + Step 8 | Toggle chromatic pad layout |
| Shift + Step 9 | Open Key menu |
| Shift + Step 10 | VelIn toggle (Live ↔ Fixed 127) |
| Shift + Step 11 | Arp In on / off |
| Shift + Step 15 | Double-and-fill loop |
| Shift + Step 16 | Quantize clip |

---

### Track View — Drum

All Track View — Melodic controls apply except where noted below.

| Control | Action |
|---|---|
| Lane pad (left 4×4) | Trigger that lane / select it as active |
| Capture + lane pad | Select lane silently without triggering |
| Jog click | Cycle mode: Velocity → Rpt1 → Rpt2 |
| Shift + Step 8 | Cycle Note Repeat mode (same as jog click) |
| Step button (tap) | Add or remove hit on the active lane |
| Step button (hold) | Open step edit overlay for the active lane |
| Mute + lane pad | Mute / unmute that lane |
| Shift + Mute + lane pad | Solo / unsolo that lane |
| Delete + loop | Stop all latched repeats |
| Delete + jog click (Rpt1 or Rpt2) | Reset groove for the active lane |
| Loop + rate pad (Rpt1) | Start and latch repeat at that rate |
| Loop + lane pad (Rpt2) | Latch repeat on that lane |
| Lane pad (held) + Loop (Rpt2) | Latch all currently held lanes |
| Loop + gate mask pad | Set repeat cycle length (1–8 steps) |

**Step edit on drum tracks:**

| Control | Action |
|---|---|
| Hold step + K3 | Adjust gate length |
| Hold step + K4 | Adjust velocity |
| Hold step + K5 | Nudge timing |

---

### Session View

| Control | Action |
|---|---|
| Clip pad (tap) | Launch or queue that clip |
| Clip pad (tap, playing) | Queue clip to stop at end of bar |
| Empty clip pad (tap) | Focus it for recording |
| Shift + clip pad | Launch clip and jump to Track View |
| Scene row button | Launch full scene row |
| Step buttons 1–16 | Launch corresponding scene row |
| Jog rotate | Scroll scene rows |
| + / − | Scroll scene rows by 4 |
| Left / Right arrows | (no function) |
| Track buttons | Switch active track |
| Volume encoder | Adjust output volume |
| Track button (held) + Volume encoder | Adjust that track's volume |
| Play | Start / stop transport |
| Shift + Play | Restart transport from beginning |
| Delete + Play (running) | Deactivate all clips |
| Delete + Play (stopped) | MIDI panic |
| Mute + clip pad | Mute / unmute that clip's track |
| Shift + Mute + clip pad | Solo / unsolo that clip's track |
| Delete + Mute | Clear all mutes and solos |
| Mute (held) + step button (tap) | Recall mute/solo snapshot |
| Mute (held) + step button (hold ~0.75s) | Save mute/solo snapshot |
| Mute + Delete + step button | Clear mute/solo snapshot slot |
| Copy + clip pad | Copy clip (press dest pad to paste) |
| Shift + Copy + clip pad | Cut clip |
| Copy + scene row button | Copy scene row |
| Shift + Copy + scene row button | Cut scene row |
| Delete + clip pad | Delete clip immediately |
| Delete + scene row button | Clear all notes in scene row |
| Shift + Delete + scene row button | Hard reset all clips in scene row |
| Undo | Undo last action |
| Shift + Undo | Redo |
| Loop | Enter Performance Mode (see below) |
| Shift + Loop | Toggle Performance Mode latch |
| Note/Session | Switch to Track View |
| Note/Session (hold) | Momentary peek at Track View |
| Shift + Note/Session | Open Global Menu |

---

### Performance Mode (Session View + Loop)

| Control | Action |
|---|---|
| Loop (tap) | Lock Performance Mode on / off |
| Loop (hold) | Temporary — active while held |
| Shift + Loop | Toggle latch mode |
| R0 length pads (Steps 1–6) | Set capture length and trigger capture |
| Hold Step 16 + length pad | Select triplet capture length |
| R0 Hold pad | Persistent hold — loop continues after releasing a length pad |
| R0 Latch pad | Toggle latch mode |
| R1 pads (magenta) | Pitch mods (momentary or latched) |
| R2 pads (yellow) | Velocity / gate mods |
| R3 pads (cyan) | Wild mods |
| Step button (tap) | Recall preset slot |
| Step button (hold ~0.75s) | Save current mod state to slot |
| Delete + step button | Clear preset slot |

---

### Loop / Pages View (Track View + Loop held)

| Control | Action |
|---|---|
| Loop (held) + jog rotate | Adjust clip length ±1 step |
| Shift + Loop (held) + jog rotate | Adjust clip length in fine increments |
| Loop (held) + two step buttons | Set loop start and end |
| Step button (tap, held) | Select / deselect bar |
| Step button (double-tap) | Set loop to that single bar |
| Hold step + jog rotate | Adjust note lengths for all notes in bar |
| Hold step + Volume encoder | Adjust note velocities for all notes in bar |
| Hold step + +/− | Transpose all notes in bar |
| Hold step + Left / Right arrows | Nudge all notes in bar |
| Delete | Delete active clip |
| Delete + step button | Clear all notes in that bar |
| Copy + step button | Copy bar (press dest step to paste) |
| Shift + Step 15 | Double-and-fill loop |

---

### Step Edit Overlay (Track View — hold a step button)

| Control | Action |
|---|---|
| K1 | Shift all notes in step by octave |
| K2 | Shift all notes by scale degree |
| K3 | Adjust gate length |
| K4 | Adjust velocity |
| K5 | Nudge timing (±23 ticks) |
| Up / Down | Shift visible octave range on pad grid |
| Pads | Add or remove notes (step-first chord entry) |
| Hold multiple steps | Apply edits to all held steps simultaneously |

---

### Global Menu (Shift + Note/Session)

| Control | Action |
|---|---|
| Jog rotate | Navigate menu items |
| Jog click | Enter edit mode / confirm selection |
| Jog rotate (edit mode) | Change value |
| Jog click (edit mode) | Confirm and exit edit |
| Note/Session | Close menu and return |
| Pads / step buttons | Function normally while menu is open |
