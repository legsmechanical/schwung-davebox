# The dAVEBOx Manual

dAVEBOx is an 8-track MIDI sequencer for Ableton Move. It runs as a tool module
inside [Schwung](https://github.com/charlesvestal/schwung) and uses Move's pads,
knobs, and screen. dAVEBOx generates no audio — every note it produces goes to
Move's native instruments, Schwung's effect chains, or an external synth over
USB-A.

> **New here?** Start with the [**Quick Start guide**](QUICKSTART.md) — a
> hands-on walkthrough that gets you making music in about fifteen minutes. This
> manual is the complete reference: use it to look things up.

---

## Table of Contents

**Part I — Foundations**
1. [Overview & Setup](#1-overview--setup)
2. [Controls & Navigation](#2-controls--navigation)

**Part II — The Two Views**
3. [Track View](#3-track-view)
4. [Session View](#4-session-view)

**Part III — Building Patterns**
5. [Tracks, Clips & Scenes](#5-tracks-clips--scenes)
6. [Step Entry & Editing](#6-step-entry--editing)
7. [Drum Tracks](#7-drum-tracks)
8. [Conductor Tracks](#8-conductor-tracks)

**Part IV — Parameter Banks**
9. [Clip & Lane Banks](#9-clip--lane-banks)
10. [Effects Banks](#10-effects-banks)
11. [Automation](#11-automation)

**Part V — Performance & Output**
12. [Scenes & Performance Mode](#12-scenes--performance-mode)
13. [Bake, Live Merge & Export](#13-bake-live-merge--export)
14. [Editing & Mixing](#14-editing--mixing)
15. [Sound Sources & Co-Run Editing](#15-sound-sources--co-run-editing)
16. [MIDI Routing](#16-midi-routing)

**Part VI — Reference**
17. [Global Settings & Persistence](#17-global-settings--persistence)
18. [Cheat Sheet](#18-cheat-sheet)
19. [Parameter Reference](#19-parameter-reference)
20. [LED & OLED Reference](#20-led--oled-reference)

---

# Part I — Foundations

# 1. Overview & Setup

## What dAVEBOx is

dAVEBOx is a standalone MIDI sequencer with **8 tracks**, **16 clips per track**,
and clips up to **256 steps** long. Each clip stores notes plus its own effects.
A track is one of three types — **Melodic**, **Drum**, or **Conductor** — and a
row of clips across all 8 tracks is a **scene**.

Because dAVEBOx makes no sound itself, its job is to send well-shaped MIDI to a
sound source. Each track routes to one of three destinations: **Move** (a native
Move instrument), **Schwung** (a Schwung effect chain), or **External** (a synth
on the USB-A port).

## One-time setup

Before dAVEBOx can make sound, Move and Schwung need to receive on matching MIDI
channels. You only do this once.

**Move** — set tracks 1–4 to receive on channels 1–4. Turn MIDI Out **off** on
each (prevents echo loops):

| Move track | MIDI In | MIDI Out |
|---|---|---|
| 1 | Ch 1 | Off |
| 2 | Ch 2 | Off |
| 3 | Ch 3 | Off |
| 4 | Ch 4 | Off |

**Schwung** — set slots 1–4 to receive on channels 5–8. Set each slot's Forward
Channel to **Auto** (not Thru):

| Schwung slot | Rcv Channel |
|---|---|
| 1 | Ch 5 |
| 2 | Ch 6 |
| 3 | Ch 7 |
| 4 | Ch 8 |

With that done, the default routing is: dAVEBOx **tracks 1–4 → Move** instruments
and **tracks 5–8 → Schwung** chains. Any track's channel and routing can be
changed later in [Track Config](#171-track-config); see [MIDI Routing](#16-midi-routing).

For a guided first session, see the [Quick Start guide](QUICKSTART.md).

---

# 2. Controls & Navigation

## 2.1 Hardware layout

```
   ┌─────────────────────────────────────────┐
   │              OLED display               │   (vol)
   └─────────────────────────────────────────┘

  (jog)    K1   K2   K3   K4   K5   K6   K7   K8

       ┌──┐   ┌──┬──┬──┬──┬──┬──┬──┬──┐
       │c1│   │  │  │  │  │  │  │  │  │   R3
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │c2│   │  │  │  │  │  │  │  │  │   R2
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │c3│   │  │  │  │  │  │  │  │  │   R1
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │c4│   │  │  │  │  │  │  │  │  │   R0
       └──┘   └──┴──┴──┴──┴──┴──┴──┴──┘

            [s1][s2][s3][s4][s5][s6][s7][s8][s9]…[s16]
```

## 2.2 Terminology

| Name | What it is |
|---|---|
| K1–K8 | Eight knobs above the pad grid |
| Jog | Clickable encoder on the left. "Jog rotate" = turn, "jog click" = press |
| Volume | Encoder at top right. Master output only (passed to Move firmware) |
| R0–R3 | Pad grid rows, bottom to top |
| Side clip buttons (c1–c4) | Four buttons left of the pad grid |
| Step buttons (s1–s16) | 16 buttons below the pad grid |
| Back | Suspends dAVEBOx. **Shift + Back** fully exits |

## 2.3 Transport & modifier buttons

The named buttons (Play, Record, Loop, Mute, Delete, Copy, Capture, Sample,
Undo, Note/Session, Shift, Up/Down, Left/Right) drive transport and act as
*modifiers* when held with another control. A modifier combo is written
"Modifier + X" — e.g. **Shift + Note/Session** means hold Shift and press
Note/Session.

| Button | On its own | As a modifier (held) |
|---|---|---|
| Play | Start / stop transport | — |
| Record | Start / stop live recording | — |
| Loop | Track View: hold for loop view. Session View: Performance Mode | Loop + jog, Loop + step, etc. |
| Mute | Toggle mute on active track/lane | Mute + pad/step, Mute + Play |
| Delete | Open clear menu (context-dependent) | Delete + step/clip/lane/jog |
| Copy | — | Copy + step/clip/lane/scene |
| Capture | Bake dialog (Track View) / scene-bake (Session View) | Capture + lane pad, Capture + scene |
| Sample | Live Merge arm/stop (Session View) | Sample + scene launcher |
| Undo | Undo last destructive action | Shift + Undo = redo |
| Note/Session | Switch views (tap) / peek (hold) | Shift + Note/Session = Global Menu |
| Shift | — | The primary modifier; combines with most controls |

## 2.4 Switching the active track

There are no dedicated track buttons. To change the active track:

| Method | Where it works |
|---|---|
| Shift + jog rotate | Both views |
| Shift + bottom-row pad (1–8) | Track View |
| Tap any pad in a column | Session View |

The OLED shows a 1px box around the active track number (1–8).

## 2.5 The two views

| | Track View | Session View |
|---|---|---|
| Purpose | Edit one clip in detail | Launch and arrange clips across all tracks |
| Pad grid | Plays notes or drum lanes | Shows the clip grid |
| Step buttons | Step pattern for active clip | Scene launchers |
| Jog rotate | Cycle parameter banks | Scroll scene rows |
| Note/Session | Switch views (tap) or peek (hold) | Same |

## 2.6 The Global Menu

**Shift + Note/Session** opens the menu. Jog rotates through items; jog click
enters edit mode; rotate to change value; click to confirm; Note/Session closes
the menu.

The menu starts with the active track's settings (**Track Config**), followed by
global settings below a separator. Pads, steps, and transport keep working while
the menu is open. The full item list is in
[Global Settings & Persistence](#17-global-settings--persistence).

## 2.7 Changing Key or Scale

When you edit **Key** or **Scale** in the Global Menu, all of your melodic clips
move with it:

- **While you turn the knob**, you get a live preview — the pads relayout and, if
  the sequencer is playing, you *hear* every melodic clip transposed to the
  candidate key/scale. Nothing is committed yet.
- **Click the knob to commit.** If any melodic clip has notes, a **"Transpose
  clips?"** prompt appears (jog to pick **YES** / **NO**, click to confirm). YES
  bakes the transpose into every melodic clip; NO leaves everything where it was.
  If no clip has notes, the click just applies the new Key/Scale with no prompt.
- **Backing out** (Note/Session, or turning back to the original value) cancels —
  nothing moves.

How notes move: changing **Key** transposes by the shortest distance (C→D up a
step; C→B down one). Changing **Scale** reshapes each note by scale degree when
the two scales have the same number of notes (e.g. Major↔Minor — the 3rd stays
the 3rd), or snaps to the nearest in-scale note when they differ (e.g. into a
Pentatonic). Harmonies and arpeggios follow the new key/scale in the preview too.
Drum tracks are unaffected. Transpose is not undoable — the prompt is the
safeguard.

---

# Part II — The Two Views

# 3. Track View

The primary editing environment. Shows the active track's clip.

## Basic controls

| Control | Action |
|---|---|
| Pads | Play notes (melodic) or trigger drum lanes |
| Steps 1–16 | Toggle steps in the active clip |
| Side clip buttons | Switch clips on the active track |
| K1–K8 | Adjust parameters in the active bank |
| Jog rotate | Cycle parameter banks |
| Jog click | Toggle alt-param mode on banks that support it (label flips to alternate; a down-arrow blinks in the header). Switching banks or tracks reverts to primary params. |
| Jog touch | Reveal the active bank's display (hold to keep it up) |
| Up / Down | Shift pad octave range (−4 to +4) |
| Left / Right | Navigate clip pages (clips longer than 16 steps) |
| Loop (hold) | Enter loop view |
| Loop (hold) + jog | Adjust clip length ±1 step |

The OLED shows all 8 knob parameters and values. Touching a knob highlights its
row. The LED below each knob lights when that parameter differs from default.

The bank display returns to the track overview after about a second of inactivity.
**Touch the jog wheel** at any time to bring the active bank's display back —
it stays up while you hold the touch — wherever a bank display applies (melodic,
drum, and Conductor banks alike). The reveal is disabled while the Global Menu is
open.

The header shows a compact **bank position strip** at the right edge — on both
the resting track overview and every parameter-bank overview (where it takes the
place of the old `Tr#` track-number readout). A tall block marks the active bank;
short stubs show the others — a glanceable reminder of where you are in the bank
cycle. It follows jog navigation order (melodic: CLIP → NOTE FX → HARMONY → DELAY
→ SEQ ARP → ARP IN → AUTO; drum: DRUM LANE → NOTE FX → DELAY → ALL LANES → REPEAT
GROOVE → AUTO). Conductor headers blink a "C-" prefix instead.

## Switching tracks while playing

Switching to a track that has nothing playing or queued auto-launches that
track's focused clip **only if that clip is empty**. A clip that already has
notes is left as you set it — switching to it won't start it. The same rule
applies when you press Play: an empty focused clip goes live, but a focused clip
with notes that you've left off stays off until you launch it yourself. (To turn
a clip on, tap its clip pad in Session View or its clip side button in Track
View.)

## Shift + step shortcuts

While holding Shift in Track View, available shortcuts light up on the step
buttons:

| Step | Action |
|---|---|
| 2 | Open Global Menu at Global section |
| 3 | Open sound source editor (Edit Synth / Edit Slot) — see [Ch. 15](#15-sound-sources--co-run-editing). Requires Schwung 0.9.18+ |
| 5 | Tap Tempo screen (shows "BPM controlled by Move" when Clock Follow is on) |
| 6 | Metro toggle (Cnt-In ↔ Always) |
| 7 | Open Global Menu at Swing |
| 8 | Drum: cycle right-pad mode (Vel/Rpt1/Rpt2). Melodic: toggle chromatic layout |
| 9 | Open Global Menu at Scale |
| 10 | VelIn toggle (Live ↔ Fixed 100) |
| 11 | ARP IN on/off (melodic only) |
| 15 | Double-and-fill loop |
| 16 | Quantize active clip 100% |

Steps 2, 5, 6, 7, 9 also work in Session View. The rest are Track View only.

**Mute + Play** (Track View): toggles metronome Off ↔ last non-Off state.

---

# 4. Session View

The 8×16 clip grid. 8 rows visible at a time; jog scrolls to all 16.

| Control | Action |
|---|---|
| Tap clip pad | Launch/queue that clip |
| Tap empty clip pad | Focus it for recording |
| Shift + clip pad | Open the clip in Track View for editing. While stopped, a clip that has notes is left off (not launched); an empty clip — or any clip while the transport is playing — is launched. |
| Scene launcher (side) or steps 1–16 | Launch all clips in that row |
| Shift + scene launcher | Launch row at next bar boundary (ignores Launch Quant setting) |
| Jog rotate | Scroll scene rows |
| +/− | Scroll by 4 rows |
| Loop (tap) | Lock Performance Mode |
| Loop (hold) | Temporary Performance Mode |

Empty cells in a scene row don't affect their track — that track keeps playing
whatever it had.

Mute/solo controls work the same in both views (see
[Editing & Mixing](#14-editing--mixing)).

---

# Part III — Building Patterns

# 5. Tracks, Clips & Scenes

dAVEBOx has **8 tracks**. Each track holds **16 clips**. Each clip stores notes
plus its own effects settings. A row of clips across all 8 tracks is a **scene**.

Clips on a track play one at a time. Launching a new clip replaces what was
playing on that track only. Launching a scene swaps every track at once.

## 5.1 Track types

A track is one of three types, set by **Mode** in [Track Config](#171-track-config):

| Type | Menu label | What it does |
|---|---|---|
| Melodic | **Keys** | Plays scale-snapped pitched notes |
| Drum | **Drums** | 32 drum lanes, each its own mini-sequencer — see [Drum Tracks](#7-drum-tracks) |
| Conductor | **Conduct** | Transposes the *other* melodic tracks in real time — see [Conductor Tracks](#8-conductor-tracks) |

### Melodic vs Drum

| | Melodic | Drum |
|---|---|---|
| Pad grid | Plays scale-snapped notes | Left 4×4 = 32 drum lanes (banked A/B); right 4×4 = function area |
| Step pattern | One pattern per clip | One pattern per lane within each clip |
| Per-lane loops | No | Yes — each lane can loop independently (polyrhythm) |
| Available banks | CLIP, NOTE FX, HARMONY, DELAY, SEQ ARP, ARP IN, AUTO | DRUM LANE, NOTE FX, DELAY, ALL LANES, REPEAT GROOVE, AUTO |

## 5.2 Switching type converts your notes

Changing **Mode** carries sequenced notes (note, duration, iteration,
probability) across all 16 clips into the new type. Only notes move — **effects,
ARP, and automation reset to defaults**.

The Mode menu is **preview-on-scroll**: scrolling only shows the candidate type,
and **clicking the jog commits it** behind a confirm dialog.

- **Melodic↔Drum** shows a confirm dialog when the track has notes (drum-specific
  settings have no melodic equivalent). Empty tracks switch instantly.
- **To/from Conductor** keeps your notes but is **blocked during playback** (stop
  the transport first). Only one Conductor can exist at a time.

---

# 6. Step Entry & Editing

## 6.1 Step entry (melodic)

| Action | Result |
|---|---|
| Quick tap empty step | Activates with the last note played on pads, velocity 100 (or VelIn if set) |
| Quick tap active step | Clears it |
| Hold step ≥200ms (active) | Opens step edit |
| Hold step ≥200ms (empty) | Activates the step and opens step edit in one gesture |
| Tap multiple steps at once | Toggles each |

Steps beyond the clip's length show dark grey.

**Pad layout.** Default is **In-Key**: only scale notes present, root lit in track
color. **Shift + Step 8** toggles **Chromatic**: all 12 semitones visible,
in-scale notes highlighted. (You can also set this with the **Layout** entry in
Track Config.) **Up/Down** shifts octave.

## 6.2 Chord entry

- **Pad-first:** hold one or more pads, then press a step. All held notes go into
  that step.
- **Step-first:** hold a step, then tap pads one at a time. Tap a pad already in
  the step to remove it.

Both methods support up to 4 notes per step.

## 6.3 Step edit and trig conditions

Hold any step button to open the edit overlay. Edits apply to all notes in the
step simultaneously. Hold multiple steps to edit them all at once. While holding
a step, Up/Down shifts the octave range for reaching higher/lower notes.

**Melodic step edit:**

| Knob | Label | Function |
|---|---|---|
| K1 | Oct | Shift by octave |
| K2 | Note | Shift by scale degree (or semitone if Scale Aware is off) |
| K3 | Leng | Gate length |
| K4 | Vel | Velocity |
| K5 | Nudg | Nudge timing (±1 step minus 1 tick). Step blinks when on-grid. Notes that cross into an adjacent step reassign on release. |
| K6 | Iter | Iteration — see below |
| K7 | Prob | Probability — see below |
| K8 | Ratch | Ratchet — see below |

**Drum step edit:**

| Knob | Label | Function |
|---|---|---|
| K1 | Leng | Gate length |
| K2 | Vel | Velocity |
| K3 | Nudg | Nudge timing |
| K5 | Iter | Iteration |
| K6 | Prob | Probability |
| K7 | Ratch | Ratchet |

### Trig conditions: Iter, Prob, Ratch

Three per-step conditions that reshape when and how a step fires. Default for all
is `--` (no condition).

**Iter (Iteration)** — gates the step to play only on certain loop cycles.
Values: `1/2, 2/2, 1/3, 2/3, 3/3, … 8/8`. Example: `2/3` means "play on cycle 2
of every 3," silent on cycles 1 and 3. The cycle counter is per-clip and resets
only on cold transport start (Stop → Play).

**Prob (Probability)** — per-step play chance, 0–100%. The roll is per-note: on a
chord step set to 50%, each note independently has a 50% chance, so voicings vary
naturally.

**Ratch (Ratchet)** — retriggers the step x2, x3, or x4 times within one step
slot. Sub-hits are evenly spaced. Each runs through the full effects chain.

**How they interact:** Iter is checked first — if it says skip, no sub-hits fire.
Prob rolls once per note; if a note passes, all its ratchet sub-hits play.

## 6.4 Pages and the loop window

Clips longer than 16 steps span multiple pages. **Left/Right** navigates pages.

Hold **Loop** to enter loop view — step buttons represent pages:

- **Track color** = page is in the loop window (pulsing = contains notes)
- **White** = start of a range selection (during hold+tap gesture)
- **Off** = outside the loop window

Three ways to set the loop window while Loop is held:

| Gesture | Result |
|---|---|
| Jog ±1 | Grow or shrink the loop from the end (beginning stays fixed) |
| Tap a page button | Loop runs from page 1 through the page you tapped |
| Hold one page button + tap another | Loop runs from the held page through the tapped page |

Notes outside the window are preserved — they play again if you expand the
window.

## 6.5 Live recording

Press **Record** to capture pad input into the active clip.

| Starting from | Behavior |
|---|---|
| Stopped | 1-bar count-in, then recording + transport start together |
| Playing, fixed-length clip | Records immediately at current position |
| Playing, empty clip (no length set) | Arms recording, defers to next bar boundary. Record blinks red while pending. |

> When **Clock Follow = Move**, arming Record from stopped first starts Move's
> transport, then runs the one-bar count-in. Move quantizes its start to its
> Ableton Link grid, so there can be a brief wait (up to ~1 bar) before the
> count-in begins — dAVEBOx waits through it, and falls back to its own clock if
> Move never starts. See [§16.6 Clock Follow](#166-clock-follow-syncing-to-move).

Stop recording: press **Record** again (transport continues) or **Play** (stops
transport).

Recording is always additive — existing notes are never erased. Clear the clip
first (Delete + side clip button) for a fresh take.

**Count-in pre-roll:** notes pressed in the last half-beat of the count-in are
captured on step 1.

**Track switching while recording:** switching tracks is free. Recording follows
the focused track.

**What Play does from stopped:** resumes whatever was playing when you last
stopped. On a fresh set, no clips are active, so Play alone makes no sound — start
sound by launching a clip or switching tracks while playing.

> **Live recording only works in Forward direction.** A clip set to a non-Forward
> [playback direction](#91-clip-bank-melodic) shows a popup when you try to
> record, offering to bake it to Forward first.

## 6.6 Undo

The **Undo** button reverts the last destructive action (one level). **Shift +
Undo** redoes.

Undoable actions: step/clip/lane clear, copy/cut/paste, hard reset, live
recording, bank reset, loop double, bake, legato, scene operations, automation
clears.

---

# 7. Drum Tracks

On a drum track, each sound gets its own **lane** — a separate step pattern with
its own loop length, timing, and effects. Think of each lane as an independent
mini-sequencer for one drum sound (kick, snare, hi-hat, etc.). A drum track has
32 lanes total, each assigned to a MIDI note that triggers a specific sound in the
destination instrument.

The pad grid is split into two halves:

| Pad block | Contents |
|---|---|
| Left 4×4 | 16 drum lane pads. Tap one to hear its sound and select it — the step buttons then show that lane's pattern. The other 16 lanes are on bank B (see below). |
| Right 4×4 | Function area: Velocity zones (default), Rpt1, or Rpt2 |

The left pads show 16 lanes at a time. There are two banks — **A** and **B** —
giving you 32 lanes total. The OLED shows which bank is active. **Up / Down**
switches lane bank A ↔ B. Cycle right-pad modes (Velocity → Rpt1 → Rpt2) with
**Shift + Step 8**.

**Velocity mode:** 16 zones from velocity 8 (bottom-left) to 127 (top-right).
Pressing a zone sets the velocity for subsequent step taps. Drum velocity zones
override VelIn.

To change which MIDI note (and therefore which drum sound) a lane triggers, use
the NOTE FX bank — K1 shifts by octave (±12 semitones) and K2 shifts by single
semitones. The OLED shows the lane's note name and number (e.g. `Pad: C3 (48)`).

## 7.1 Step sequencing

Tap a lane pad to select it, then tap steps 1–16 to place or remove hits for that
lane. The step buttons always show the selected lane's pattern.

**Capture + lane pad** selects a lane silently (no trigger).

## 7.2 Per-lane loops (polyrhythm)

Each lane has its own loop length. Set with **Loop + jog rotate** on the active
lane. Example: kick at 16 steps, hi-hat at 12, percussion at 10 — each loops
independently against shared transport.

## 7.3 Drum lane banks

The drum-specific knob banks (DRUM LANE, ALL LANES) and the shared banks (NOTE
FX, DELAY, AUTO) are all documented together in
[Part IV — Parameter Banks](#9-clip--lane-banks). In brief:

- **DRUM LANE** — per-lane timing grid, stretch, shift, legato, Euclid, direction.
- **ALL LANES** — apply those settings to all 32 lanes at once, plus per-track
  VelIn / InQ / Repeat Sync.

## 7.4 Note Repeat

Retriggers drum lanes at rhythmic intervals. Two modes: **Rpt1** (single-lane)
and **Rpt2** (multi-lane). Cycle to a repeat mode with **Shift + Step 8**.

### Right-pad layout (both modes)

```
   Row 3    [Gate 0] [Gate 1] [Gate 2] [Gate 3]    ← gate mask
   Row 2    [Gate 4] [Gate 5] [Gate 6] [Gate 7]    ← gate mask
   Row 1    [1/32T]  [1/16T]  [1/8T]  [1/4T]      ← triplet rates
   Row 0    [1/32]   [1/16]   [1/8]   [1/4]        ← straight rates
```

### Rpt1 (single-lane)

Hold a rate pad to retrigger the active lane at that rate. Velocity is
pressure-sensitive. Switch lanes while holding without interruption.

### Rpt2 (multi-lane)

Tap a rate pad to assign it to the active lane (default 1/8). Hold a lane pad to
repeat it at its assigned rate. Hold multiple lanes for simultaneous repeats.
Velocity is pressure-sensitive per pad.

### Latching

- **Rpt1:** Loop + rate pad starts and latches. Hold repeat + tap Loop to latch.
  Press active rate or Delete + Loop to stop.
- **Rpt2:** Loop + lane pad latches. Hold lanes + Loop latches all held. Tap
  latched lane to unlatch. Delete + Loop stops all.
- **Tap Loop alone** (no pads held): unlatches all Rpt1 + Rpt2 on the active
  track.

Latched lanes stay lit cyan. Transport Stop clears all latches. Mute silences but
preserves latch.

### Gate mask

The top 2 rows (8 pads) form a looping gate pattern. All 8 on by default. Tap to
toggle. Per-lane, persists across saves.

**Loop + gate pad** sets repeat cycle length (1–8). **Delete + gate pad** resets
that step's velocity scaling and nudge.

### REPEAT GROOVE bank

Available when a repeat mode is active — see
[REPEAT GROOVE](#94-repeat-groove-bank). Per-lane, persists.

- **K1–K8 (unshifted):** velocity scaling per gate step (0–200%, default 100%).
- **K1–K8 (Shift held):** nudge offset per gate step (±50% of step interval).

**Delete + jog click** resets the groove for the active lane.

## 7.5 Drum-specific copy / mute

- **Copy + lane pad** → tap another lane to paste. Destination MIDI note
  preserved. Shift + Copy = cut.
- **Mute + lane pad** mutes. **Shift + Mute + lane pad** solos. **Capture + lane
  pad** selects silently.

---

# 8. Conductor Tracks

A **Conductor** track transposes all *playing melodic clips* up or down in real
time, non-destructively, driven by the note the Conductor is currently playing.
It emits no MIDI itself — its sequencer (and live pad play) only steers the
transposition. The clips' written notes are never changed; the shift is live and
reversible. **Only one Conductor can exist at a time.**

This lets one track "conduct" a key change or melodic move across your whole
arrangement — sequence a chord progression on the Conductor and every responding
track follows it.

## 8.1 Making a track a Conductor

In [Track Config](#171-track-config), set **Mode** to **Conduct** (the Mode entry
offers Keys / Drums / Conduct). The menu is preview-on-scroll: scrolling only shows
the candidate type, and **clicking the jog commits it** behind a confirm dialog.

- Converting to/from Conductor **keeps your sequenced notes** (note, duration,
  iteration, probability across all 16 clips) but **resets effects, ARP, and
  automation** to defaults.
- **Blocked during playback** — stop the transport first (an on-screen note says
  so).
- Trying to make a *second* Conductor is refused with **"Conductor exists on
  T_n_"** — convert the existing one back to Keys first.
- A Conductor **keeps its track color**. Its **Channel and Route are inert**
  (shown as "-"). **Mute** works (temporarily stops conducting → responders snap
  back to written pitch); **Solo** is disabled.

## 8.2 How the transposition works

Zero transposition = the session **root note at octave 4** (the default pad note).
Play that and nothing shifts. Play higher and responders shift up; play lower,
they shift down — and the Conductor's pad octave scales the move (an octave up on
the Conductor = an octave of transposition).

The shift is **scale-aware or chromatic following the global Scale-Aware
setting**: scale-aware moves responders by scale *degrees* (staying in key);
chromatic moves them by *semitones*.

- **Empty Conductor step** or **Conductor muted** → responders play their written
  pitch (zero shift).
- A drum track never responds.

Conductor steps still carry **Iter / Prob** trig conditions like any melodic step.

## 8.3 The five Conductor banks

A Conductor's jog wheel cycles exactly five banks (no FX/ARP/Auto): **Conduct →
NoteFX → Responder → Octave → When**. Headers blink a **"C-"** prefix so you
always know you're on the Conductor; when idle the banks fall back to the
overview screen (touch the jog to bring the active bank's display back).

| Bank | What it does |
|---|---|
| **Conduct** | Like the melodic CLIP bank (Res, Stch, Shft, Lgto, InQ, Dir, SqFl) plus **CdLk** (K6). **CdLk Off** = gate-hold: the transpose lasts only the Conductor note's gate and snaps to zero in the gaps. **CdLk Lock** = sample-and-hold: the transpose persists through gaps and only changes when the Conductor plays its next note (play the root@oct4 to return to zero). Mute snaps to zero in both modes. |
| **NoteFX** | Shapes the Conductor's *own* note before the shift is computed: **Octave** (K1), **Offset** (K2), **Random** (K8), and Random mode via jog-click alt-mode + K8 (uniform/gaussian/walk). Octave/Offset are a master shift on all responders; Random jitters the whole transposition per Conductor note. Per Conductor clip. |
| **Responder** | One cell per track (Tr1…Tr8), tap-toggle **on/off** — on = follows the Conductor, off = ignores it. **Default on.** The Conductor's own cell reads **"Cndc"** (inert); drum tracks show **"--"** (can't respond). Per Conductor clip. |
| **Octave** | One cell per track, **−4…+4** (center **"--"** = 0). Added on top of the Conductor's shift (scale-aware), applied only while the Conductor is sounding and that track is On in Responder. Conductor/drum cells inert ("--"). Per Conductor clip. |
| **When** | One cell per track, **Next / Now**. **Next** = a responder latches the new shift at its next note-on (notes already sounding keep their pitch). **Now** = a sounding responder note is cut and retriggered at the new pitch immediately, keeping its original note-off. Mix Next and Now across tracks freely. Per Conductor clip. |

## 8.4 Baking, merging, and export

The Conductor can be folded permanently into responder clips at **scene bake**
time, or applied non-destructively at **Ableton export** time — both via an
"Apply Conductor?" prompt. See [Bake](#131-bake) and
[Export to Ableton Live](#133-export-to-ableton-live). The Conductor track itself
has no bake action and exports as a silent dummy track.

---

# Part IV — Parameter Banks

The knobs control different things depending on which parameter bank is active.
Rotate the **jog wheel** to cycle through banks:

- **Melodic tracks:** CLIP, NOTE FX, HARMONY, DELAY, SEQ ARP, ARP IN, AUTO
- **Drum tracks:** DRUM LANE, NOTE FX, DELAY, ALL LANES, REPEAT GROOVE, AUTO

This part covers them all:

- **Chapter 9 — Clip & Lane Banks** (CLIP, DRUM LANE, ALL LANES): timing grid,
  playback direction, and note transformations. Most of these changes are
  permanent and directly alter your sequenced notes (use Undo to revert).
- **Chapter 10 — Effects Banks** (NOTE FX, HARMONY, DELAY, SEQ ARP, ARP IN):
  non-destructive transformations applied at playback time.
- **Chapter 11 — Automation** (AUTO): recordable CC / aftertouch lanes.

Each bank's display returns to the track overview after about a second of
inactivity; **touch the jog wheel** to bring the current bank's display back
(it stays up while held). See [Track View](#3-track-view).

**Alt-params:** some knobs have a secondary function (marked **Alt** in the tables
below). **Jog click** toggles between primary and alt — the label on screen flips
and a down-arrow blinks in the header. Jog click again, switching banks, or
switching tracks returns to the primary function.

**Resetting parameters:**

| Control | Result |
|---|---|
| Delete + jog click | Reset all params in the active bank |
| Shift + Delete + jog click | Reset all effect params across every bank (preserves ARP IN) |
| Shift + Delete + side clip | Hard reset clip: clears notes and all params |

---

# 9. Clip & Lane Banks

## 9.1 CLIP bank (melodic)

Controls the clip's timing grid, playback direction, and note transformations.
**K1–K4 permanently change your notes** — use Undo to revert.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Res | Resolution — sets the step grid size for the clip. Rescales note positions proportionally. **Alt: Zoom** — adjusts the grid without moving notes. | 1/32, 1/16, 1/8, 1/4, 1/2, 1bar | 1/16 |
| K2 | Stch | Beat Stretch — each detent doubles (right) or halves (left) the clip. Blocked if notes would overlap. | — | — |
| K3 | Shft | Clock Shift — rotates all notes forward/backward by whole steps. **Alt: Nudg** — shifts at tick resolution (finer). | — | 0 |
| K4 | Lgto | Apply Legato — turn right to open confirm dialog. Rewrites every note's length to reach the next note. Undoable. | → (action) | — |
| K5 | InQ | Input Quantize — snaps recorded notes to the nearest grid position. Per-track. | Off, 1/64, 1/32, 1/16, 1/16T, 1/8, 1/8T, 1/4, 1/4T | Off |
| K7 | Dir | Playback Direction — controls the order steps are played. **Alt: RvSt** — Reverse Style (Step vs Audio). Audio swaps note-on/off during reverse motion for a tape-reverse feel. | Fwd, Bwd, PPf, PPb | Fwd |
| K8 | SqFl | Seq Follow — auto-scroll the step display to follow the playhead. | On/Off | On |

**Direction:** Fwd plays normally. Bwd plays steps in reverse. PPf/PPb are
pingpong modes — the playhead bounces back and forth (endpoints play once per
direction change). **Live recording only works in Fwd mode** — non-Fwd clips show
a popup when you try to record, offering to bake the clip to Fwd first. Bake and
Ableton export freeze direction into note positions and reset to Fwd. Audio
reverse style uses a 2L pingpong cycle (endpoints play twice).

## 9.2 DRUM LANE bank

Controls the active drum lane's timing grid, playback, and note transformations.
**K1–K3 and K5 permanently change notes** — use Undo to revert.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Res | Resolution. **Alt: Zoom.** | 1/32–1bar | 1/16 |
| K2 | Stch | Beat Stretch (one-shot) | — | — |
| K3 | Shft | Clock Shift. **Alt: Nudg.** | — | 0 |
| K4 | Lgto | Apply Legato — per-lane. Turn right to confirm. Undoable. | → (action) | — |
| K5 | Eucl | Euclidean — spreads N hits evenly across lane length. Hand-placed hits outside the pattern are preserved. | 0–length | 0 |
| K7 | Dir | Playback direction per-lane. **Alt: RvSt** (Step/Audio). | Fwd, Bwd, PPf, PPb | Fwd |
| K8 | SqFl | Seq Follow | On/Off | On |

Lane length: **Loop + jog rotate**. Lane MIDI note: NOTE FX K1+K2.

## 9.3 ALL LANES bank

Applies settings to all 32 drum lanes at once. Because every change here rewrites
all 32 lanes, the bank opens on an **"Edits will affect all lanes. Proceed?"**
screen — **jog-click to confirm**. Until you confirm, *nothing* is applied: the
knobs, the **Loop** button (length and loop window), and the Shift+Step
double-and-fill / quantize shortcuts are all inert — the gated shortcut steps stay
dark and holding Loop does nothing, so no edit can land before you say so.
**K1–K3 permanently change notes across all lanes.**

| Knob | Label | Function |
|---|---|---|
| K1 | Res | Resolution — sets all lanes to the same value. Permanently changes notes. Display resets after release. |
| K2 | Stch | Beat Stretch — applied to all lanes. Shows "NO ROOM" if any lane can't fit. Permanently changes notes. |
| K3 | Shft | Clock Shift. **Alt: Nudg.** Permanently changes notes. |
| K4 | Qnt | Quantize all lanes at playback (does not change stored notes). Display resets after release. |
| K5 | VelIn | Velocity input override for this track (same as Track Config VelIn). |
| K6 | InQ | Recording input quantize for this track. |
| K7 | Dir | Playback direction on all lanes. Display resets after release. **Alt: RvSt** for all lanes. |
| K8 | SyncRpt | Repeat Sync — controls first-fire timing for held repeat pads. On = wait for the beat grid; Off = fire instantly. Default On. |

## 9.4 REPEAT GROOVE bank

Available on drum tracks when a Note Repeat mode (Rpt1/Rpt2) is active. Per-lane,
persists. See [Note Repeat](#74-note-repeat) for the gate-mask context.

| K | Label (unshifted) | Label (Shift held) |
|---|---|---|
| 1–8 | Velocity scaling per gate step (0–200%, default 100%) | Nudge offset per gate step (±50% of step interval) |

**Delete + jog click** resets the groove for the active lane.

---

# 10. Effects Banks

Every note — sequenced, played live, or from external MIDI — passes through the
same effects chain before reaching a sound source:

```
 LIVE INPUT ──> [ARP IN] ──┐
                            ├─> NOTE FX ─> HARMONY ─> DELAY ─> SEQ ARP ─> OUTPUT
 SEQUENCED NOTES ───────────┘
```

- **ARP IN** processes live input only. Sequenced notes skip it.
- After the chain, global **Swing** is applied.
- If Performance Mode is active, its mods apply last.

All effects are **non-destructive** — they transform notes at playback time
without changing the underlying sequenced data. Returning a knob to its default
leaves the clip unchanged. NOTE FX, HARMONY, DELAY, and SEQ ARP settings are
**per-clip**. ARP IN is **per-track**.

## 10.1 NOTE FX bank

Transforms every note's pitch, velocity, timing, and length.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Oct | Octave shift | ±4 | 0 |
| K2 | Ofs | Note offset (scale-aware: steps in scale degrees when on, semitones when off) | ±24 | 0 |
| K3 | Vel | Velocity offset | ±127 | 0 |
| K4 | Qnt | Quantize amount at playback | 0–100% | 0% |
| K5 | Len> | Fixed pre-gate note length. `--` = passthrough. Values are step-multiples; K6 Gate then scales the result. | --, .25, .50, .75, 1, 2, 4, 8, 16 | -- |
| K6 | Gate | Scales note duration. Below 100% = staccato, above = legato. | 0–400% | 100% |
| K8 | Rnd | Pitch randomness (scale-aware). 0 = off. **Alt: algorithm select** — jog click to enter alt mode, then turn to choose Walk (accumulating ±1), Uniform (random within range), or Gaussian (clusters around center). | 0–24 | 0 |

On **drum tracks**, K1+K2 edit the active lane's MIDI note (K1 = ±12 semitones,
K2 = ±1); K3–K6 apply per-lane.

## 10.2 HARMONY bank (melodic only)

Adds harmonic voices on top of every note.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Oct | Octave voice | ±4 | 0 |
| K2 | Hrm1 | Harmony voice 1 (scale-aware) | ±24 | 0 |
| K3 | Hrm2 | Harmony voice 2 (scale-aware) | ±24 | 0 |
| K4 | Hrm3 | Harmony voice 3 (scale-aware) | ±24 | 0 |

## 10.3 DELAY bank

MIDI delay generating rhythmic echoes of every note.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Rate | Delay time. **Alt: ClkF** — offsets the timing of each successive repeat. | 1/64, 1/64D, 1/32, 1/16T, 1/32D, 1/16, 1/8T, 1/16D, 1/8, 1/4T, 1/8D, 1/4, 1/4D, 1/2, 1/2D, 1/1, 1/1D | 1/8D |
| K2 | Lvl | Echo velocity level | 0–127 | 127 |
| K3 | Rep | Number of echoes. 0 = bypass. | 0–16 | 0 |
| K4 | Vfb | Velocity change per repeat | ±127 | 0 |
| K5 | Pfb | Pitch shift per repeat (scale-aware) | ±24 | 0 |
| K6 | Gate | Fixed gate for echoes. Off = natural length. | Off, 1/64, 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4, 1/2, 1bar | Off |
| K7 | Rtrg | Retrigger — new note-on drops in-flight echoes. Off lets tails overlap. | On/Off | On |
| K8 | Rnd | Pitch randomness on echoes (scale-aware). **Alt: algorithm select** — same options as NOTE FX Rnd. | 0–24 | 0 |

## 10.4 SEQ ARP bank (melodic only)

Step arpeggiator running after Delay. Per-clip. Applies to both sequenced and
live input.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Styl | Style | Off, Up, Dn, U/D, D/U, Cnv, Div, Ord, Rnd, RnO | Off |
| K2 | Rate | Arp rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1bar | 1/16 |
| K3 | Oct | Octave range. Positive = above, negative = below. | ±4 (0 = Off) | Off |
| K4 | Gate | Note gate. Below 100% = staccato, above = legato overlap. | 1–200% | 100% |
| K5 | Stps | Steps Mode — how level-0 steps behave in the Arp Steps editor. | Mute (rests), Step (removed from cycle) | Mute |
| K6 | Rtrg | Retrigger — resets pattern on each new note and at loop boundary. | On/Off | On |
| K7 | Sync | Waits for next rate boundary before firing. Off = fires from anchor. | On/Off | On |

**Arp Steps editor:** jog click on this bank enters the editor. K1–K8 set
per-step pitch offsets (±24 scale degrees). Pads are a step-velocity editor (8
columns × 4 rows). **Loop + pad** sets step-loop length (1–8). Jog click, jog
turn, or Note/Session exits. State is per-clip.

## 10.5 ARP IN bank (melodic only)

Live arpeggiator for pad input and external MIDI. **Per-track**, not per-clip.
Does not affect sequenced notes. Drum tracks use [Note Repeat](#74-note-repeat)
instead.

| Knob | Label | Function | Range | Default |
|---|---|---|---|---|
| K1 | Styl | Style | Off, Up, Dn, U/D, D/U, Cnv, Div, Ord, Rnd, RnO | Off |
| K2 | Rate | Arp rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1bar | 1/16 |
| K3 | Oct | Octave range | ±4 (0 = Off) | Off |
| K4 | Gate | Note gate | 1–200% | 100% |
| K5 | Stps | Steps Mode | Mute, Step | Mute |
| K6 | Rtrg | Retrigger on each new note | On/Off | Off |
| K7 | Sync | Wait for rate boundary | On/Off | On |
| K8 | Ltch | Latch — arp runs after release. First touch of a new gesture replaces the latched set; additional presses add notes. | On/Off | Off |

**Latch shortcuts:**
- While holding pads with ARP IN active, tap **Loop** to toggle latch.
- **Delete + Loop** also unlatches.
- Tap **Loop with no pads held** (latch already on): clears the latched chord
  without turning latch off.

**Latch feedback:** latched pads stay lit white. The `Arp` indicator inverts on
the OLED. The Loop button blinks at the arp's step rate while latched.

**Latch persists** across track/route/channel changes. Clears on: transport Stop,
Delete + Play, and Session View entry (active track only). Muting silences latched
output but preserves the latch.

**Arp Steps editor:** same as SEQ ARP — jog click to enter. State is per-track for
ARP IN.

Quick toggle: **Shift + Step 11** flips ARP IN on/off using the last-used style.

---

# 11. Automation

## 11.1 AUTO bank

Each of the 8 knobs controls its own automation lane — a recordable stream of CC
or aftertouch data that plays back with the clip. Each lane can hold up to 1024
recorded points (at 1/32 resolution, smoothly interpolated between points) plus an
optional resting value that the lane returns to at each loop. **The AUTO bank works
identically on melodic and drum tracks** — record, play back, step-edit, set resting
values, and per-lane loops all work the same way on both.

**Assigning what a knob controls:** jog click to enter alt mode on this bank, then
turn a knob to step through the target options: aftertouch (AT), any CC number
(CC0–CC127), or — on Schwung-routed tracks with Schwung 0.9.17 or later — Schwung chain
knob assignments (Sch1–Sch8). Sch lanes automate the knob assignments configured
on the track's chain slot. The assignment applies to the whole track — all clips
on that track share it.

**The "—" floor:** every knob starts at "—" (send nothing). Turn below 0 to reach
"—"; turn up from "—" to reach 0.

**Setting the resting value (normal turn, no step held):**
- **Stopped** (or playing with no automation): sets the clip's resting value and
  sends it live.
- **Record-armed + playing:** records by latch overwrite (see below).
- **Playing, not armed:** transient live audition only — does not change the
  resting value.

**Loop reset:** when a resting value is set, the lane smoothly returns to it each
time the clip loops. If the resting value is "—", the lane holds whatever value it
ended on into the next loop.

**Step button display:** the last knob you touched shows its automation values
across the step buttons as a brightness gradient (brighter = higher value, off =
no value). The playhead step shows white.

**Knob LED states (this bank):**

| State | LED |
|---|---|
| No data | Off |
| Resting value set (stopped) | White |
| Has automation | Yellow |
| Record armed | Red (brightness = value) |
| Playback | Green (brightness = value at playhead) |

**Recording:** while record-armed and playing, turning a knob starts recording on
that lane — it continuously writes the knob's current value at the playhead
position, replacing whatever was there. It keeps writing even after you stop
turning (holding the last value), loop after loop, until you stop recording. Knobs
you don't touch keep their existing automation. Switching clips stops recording on
the previous clip.

**Step-edit:** hold a step on this bank. Turn a knob to write a flat value at that
step. Turn below 0 to clear that knob's point back to "—".

**Clearing (all undoable):**
- **Delete** (tap) opens the CLEAR AUTOMATION menu — check AT and/or CC, then
  CLEAR.
- **Delete + jog click** or **Shift + Delete + jog** clears all automation for the
  clip.
- **Delete + knob touch/turn** clears that one lane.
- **Delete + step** clears all lanes at that step.
- Clearing the clip (notes) also removes all its automation.

## 11.2 Per-lane loops

Each automation lane can have its own independent loop — separate from the clip's
note loop. This lets you create polyrhythmic automation: a 3-step filter sweep
cycling over a 4-bar melody, an LFO-like pattern at a different rate than the
drums, etc.

Lanes inherit the clip's loop length and resolution by default. Once you set a
custom loop, the lane cycles independently using the global transport — it fires
at the same time as the clip but loops at its own rate.

**Setting a lane loop (Hold Loop on AUTO bank):**

The last-touched knob is the active lane. All Loop gestures target it.

| Gesture | Effect |
|---|---|
| **Step buttons** | Set loop length by page (same as clip loop) |
| **Jog wheel** | Adjust loop length by 1 step |
| **Left / Right** | Change resolution (playback speed) — same data, faster or slower cycle |
| **Up / Down** | Change zoom (step grid density) — same time span, more or fewer steps |
| **Delete + Loop** or **Loop + Delete** | Reset lane to clip defaults (length, resolution, zoom all cleared) |
| **Shift + Step 15** | Double lane loop with data copy |

**Resolution vs zoom:**

- **Resolution** changes how fast the lane plays through its steps. At 1/8
  resolution, a 16-step loop takes twice as long as at 1/16. The step LED display
  doesn't change — same data, different speed.
- **Zoom** changes the step grid granularity. Zooming in shows finer divisions
  (more steps, more pages). Zooming out shows coarser divisions (fewer steps). The
  total time span stays the same. Breakpoints stay at their exact tick positions —
  the grid moves around them.

Both are shown on the Loop config screen and the idle AUTO bank display.

**OLED display (AUTO bank idle):** shows the bank header with Sch/AT/CC badges,
the active lane's knob label + real-time value, resolution + zoom indicators, an
automation value graph (black background, white line with playhead cursor), and a
lane-aware progress bar.

**OLED display (step held):** split-screen with compact graph (showing held-step
position marker) above the progress bar, and the 8-knob step-edit values below the
header. Active lane is highlighted.

**Step LED colors (AUTO bank):**

| Value | Color |
|---|---|
| No data ("—") | Off |
| 0 | Dim warm |
| Low | Yellow/orange (rising) |
| Mid | Orange/red |
| High–127 | Bright white |
| Playhead | White |
| Out of loop | Dark grey |

Steps with real recorded breakpoints blip briefly (~every 0.5s) to distinguish
them from interpolated values.

**Pad colors (AUTO bank):** grayscale version of the note layout — root notes
bright, in-scale notes grey, chromatic out-of-scale off.

**Undo:** lane double-fill, lane reset, Delete+step, live latch recording, and
clear automation are all undoable (Shift + Step 1 in loop view, or the Undo
button).

---

# Part V — Performance & Output

# 12. Scenes & Performance Mode

## 12.1 Scenes

A scene is a row of clips across all 8 tracks. Launch with a scene launcher or
step buttons 1–16 in Session View.

### Scene editing (Session View)

| Control | Result |
|---|---|
| Copy + scene launcher → another row | Copy all 8 clips |
| Shift + Copy + scene launcher | Cut the row |
| Capture + scene launcher | Snapshot the currently-playing/queued clips into that row (skips tracks whose clip is empty or already the target row) |
| Delete + scene launcher | Clear notes in all 8 clips |
| Shift + Delete + scene launcher | Hard reset all 8 clips |

## 12.2 Performance Mode

Performance Mode captures a short loop of what's currently playing and lets you
transform it in real time using a grid of effects. It works in Session View.

### Entering and exiting

| Action | Result |
|---|---|
| Loop (tap) in Session View | Lock — persists hands-free |
| Loop (hold) | Temporary — exits on release |
| Shift + Loop or Latch pad (R0-8) | Toggle latch mode |

Set the capture length with the **R0 length pads** (bottom pad row): pads 1–5 =
1/32, 1/16, 1/8, 1/4, 1/2 bar. (See the **R0 — controls** table below.)

### Per-track inclusion

Each track's **Looper** flag ([Track Config](#171-track-config)) controls whether
it feeds Performance Mode. While locked, touch K1–K8 to toggle each track's Looper
(knob LED = track color when on, off when off).

### The mod grid

```
   R3   Wild mods       — blue
   R2   Vel/Gate mods   — yellow
   R1   Pitch mods      — magenta (melodic only, bypassed on drums)
   R0   Length / Hold / Sync / Latch controls
```

With **Latch on**, tapping a mod pad toggles it on or off — it stays active until
you tap it again. With **Latch off**, mods are only active while you hold the pad.
You can combine both: latched mods stay active while you hold additional pads for
momentary effects on top. Pressing a lit pad always turns that mod off.

### R0 — controls

| Pad | Function |
|---|---|
| 1–5 | Capture lengths: 1/32, 1/16, 1/8, 1/4, 1/2 bar |
| 6 | Hold — loop persists when you release a length pad |
| 7 | Sync — clock-aligned capture on/off |
| 8 | Latch — sticky mod mode on/off |

### R1 — Pitch mods (magenta, melodic only)

| Pad | Name | Effect |
|---|---|---|
| 1 | Oct Up | Alternating octave up / original |
| 2 | Oct Down | Alternating octave down / original |
| 3 | Scale Up | +1/+2/+3 scale degrees across 3 cycles, resets |
| 4 | Scale Down | −1/−2/−3 across 3 cycles |
| 5 | Fifth | Ascending fifths pattern |
| 6 | Tritone | 4th, 6th, octave+2nd across 4 cycles |
| 7 | Drift | ±1 scale degree random walk, accumulates to ±6 |
| 8 | Storm | Random ±6 scale degrees per note per play — chaotic but in key |

### R2 — Velocity/gate mods (yellow, all tracks)

| Pad | Name | Effect |
|---|---|---|
| 1 | Decrescendo | Velocity ×0.85 per cycle |
| 2 | Swell | 16-cycle triangle wave |
| 3 | Crescendo | Velocity ×1.15 per cycle |
| 4 | Pulse | Even cycles full, odd cycles 20% |
| 5 | Sidechain | −15% velocity per successive note in cycle |
| 6 | Staccato | Gates to 1/8 of loop length |
| 7 | Legato | Gates to full loop length |
| 8 | Ramp Gate | Gate ramps up across notes |

### R3 — Wild mods (blue)

| Pad | Name | Effect |
|---|---|---|
| 1 | Half Time | Every other cycle suppressed |
| 2 | 3 Skip | Every third cycle suppressed |
| 3 | Phantom | Ghost note 1 octave below, quarter velocity |
| 4 | Sparse | ~50% chance each note suppressed |
| 5 | Glitch | ±2 scale degree random shift per note |
| 6 | Stagger | Notes offset by +0, +1, +2… scale degrees |
| 7 | Shuffle | Pitch/hit order randomized each cycle |
| 8 | Backwards | Pitch/hit order reversed each cycle |

### Presets

Step buttons 1–16 are preset slots. Tap to recall (replaces sticky mods). Hold
~0.75s to save. Delete + step clears. (On the OLED, names appear in a condensed
form — e.g. "Heartbt", "F.Dust".)

**Factory presets (1–8):**

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

Slots 9–16 are user slots (empty by default).

### Loop control

- Press a different length pad to queue a new capture (finishes current cycle
  first).
- Press the same length pad to immediately recapture.
- Switching to Track View exits Performance Mode but preserves mod state.

Latched mods, latch mode, user presets, and the recalled slot persist across
saves.

---

# 13. Bake, Live Merge & Export

## 13.1 Bake

The **Capture** button. Bake renders a clip's effects (NOTE FX, HARMONY, DELAY,
SEQ ARP) into permanent note data, then resets the effects to defaults. The result
sounds the same without any effects applied — useful for layering new effects on
top, or for freezing a specific sound.

### Melodic bake (Track View)

Tap **Capture** → two dialogs:
1. Loop count: 1x / 2x / 4x
2. Wrap tails? Yes / No (Yes wraps echoes past clip end back to the beginning for
   seamless loops)

Full chain runs: NOTE FX → HARMONY → DELAY → SEQ ARP. Trig conditions
(Iter/Prob/Ratch) are applied per the loop count — the baked result embodies
whatever pattern they produced.

### Drum bake (Track View)

Tap **Capture** → three dialogs:
1. Clip / Lane (Clip = all lanes with full chain; Lane = active lane only, no
   pitch transforms)
2. Loop count: 1x / 2x / 4x
3. Wrap tails? Yes / No

### Scene bake (Session View)

Tap **Capture** → pick a target row (tap scene launcher or step 1–16). Then loop
count and wrap tails. Each track runs its per-clip bake. Empty clips are skipped.

Alternative: **Sample + scene launcher** goes directly to the confirm dialog.

**Apply Conductor?** — if a Conductor exists and its clip at the baked scene has
any Responder turned on, an extra **Apply Conductor? — YES / NO / CANCEL** step
appears after Wrap. **YES** folds the Conductor's transposition permanently into
each responding clip (honoring gate-hold vs CdLk Lock, the Conductor clip's
Iter/Prob trig conditions, NOTE FX, and per-track Octave), then automatically
turns off that Conductor clip's Responder flags for the baked tracks so live
playback doesn't transpose them a second time. **NO** bakes the written pitches
only. **CANCEL** aborts the whole scene bake. (Note-FX random and step probability
are re-rolled while folding — the result is a frozen snapshot, not a re-derivable
live performance.) Single-track clip bake has no Conductor option — scene context
is required.

## 13.2 Live Merge

Live Merge records the actual output of all 8 tracks simultaneously as they play —
capturing a live performance, effects and all, into new clips.

| Step | Control |
|---|---|
| Arm | Session View, tap **Sample** |
| Capture starts | Next bar boundary (or on transport start) |
| Stop | Tap **Sample** again (finalizes at the next page boundary) |
| Auto-stop | Reaching the 256-step max clip length |
| Place | After stop, tap a scene row to commit |
| Cancel | Tap **Capture** instead of a row |

Tracks that captured notes overwrite their clip at the target row. Tracks that
captured nothing leave the existing clip untouched.

## 13.3 Export to Ableton Live

**Global Menu → Export to Ableton.** Writes an `.ablbundle` that desktop Live
opens directly (then Save As .als).

Requirements: transport must be stopped. Confirm dialog appears.

The bundle lands at
`/data/UserData/schwung/davebox-exports/<set name>-<date>.ablbundle`. Retrieve via
SFTP. Opens in Live as 8 MIDI tracks × 16 scene slots with tempo and key.

**Track instruments follow routing:** Move-routed tracks get the actual Move
instrument with its preset and color. Schwung-routed get a placeholder Drift.
External-routed get a placeholder Drift.

**Notes are baked** — each clip exports "what you hear" with effects rendered. Drum
clips flatten per-lane polymeters to their least common multiple. Randomized clips
export 8 cycles of variations. Delay echoes wrap for seamless loops.

**Apply Conductor?** — if the session has a Conductor, the export confirm adds an
**Apply Conductor? — YES / NO / CANCEL** step. **YES** folds the Conductor's
transposition into each exported responder clip (only where that scene's Conductor
clip has notes and the track responds), using the same chain as scene bake —
gate-hold vs CdLk Lock, the Conductor clip's Iter/Prob trig conditions, NOTE FX,
and per-track Octave — plus polymeter auto-extend so multi-page Conductors are
fully captured. **NO** (default) exports the written pitches. **CANCEL** aborts the
export. This is non-destructive — your live session is never changed. The
Conductor track itself exports as a silent dummy track named "Conductor" (empty
clips), preserving the 8-track layout.

The bundle is self-contained — samples are included. Requires Live 12.1+ for Move
Drum Racks. Export is one-way.

---

# 14. Editing & Mixing

## 14.1 Copy, cut, paste

The clipboard stays live after paste — paste to multiple destinations from one
source. Clipboard clears when you release Copy. **Cut = Shift + Copy** (source
clears after first paste).

| Level | Copy gesture | Paste gesture |
|---|---|---|
| Step | Copy + source step → destination step | Same clip only |
| Clip | Copy + side clip button (Track View) or clip pad (Session View) | Press destination clip |
| Scene row | Copy + scene launcher (Session View) | Press another scene launcher |
| Drum lane | Copy + lane pad → destination lane | MIDI note preserved |
| Drum clip | Copy + side clip button (drum) → destination | All 32 lanes; MIDI notes preserved |

## 14.2 Clear and reset

| Control | Action |
|---|---|
| Delete + step | Clear that step |
| Delete + side clip button | Clear notes (structure survives) |
| Shift + Delete + side clip | Hard reset — notes and all params |
| Delete + lane pad (drum) | Clear lane notes |
| Shift + Delete + lane pad | Hard reset lane (MIDI note preserved) |
| Delete + jog click | Reset active bank params |
| Shift + Delete + jog click | Reset all play-FX (preserves ARP IN) |
| Delete + clip pad (Session) | Delete clip |
| Delete + scene launcher | Clear notes in row |
| Shift + Delete + scene launcher | Hard reset row |

## 14.3 Mute and solo

| View | Mute | Solo |
|---|---|---|
| Track View | Mute button | Shift + Mute |
| Session View | Mute + clip pad | Shift + Mute + clip pad |
| Drum lanes | Mute + lane pad | Shift + Mute + lane pad |

**Delete + Mute** clears all mutes and solos.

Mute and solo are mutually exclusive per track/lane. Track mute silences sequenced
notes and latched output, but held live pads still monitor through.

### Mute/solo snapshots

16 slots. In Session View, hold **Mute** and step buttons light (dark grey =
empty, yellow = saved).

| Control | Action |
|---|---|
| Mute + hold step ~0.75s | Save |
| Mute + tap lit step | Recall |
| Mute + Delete + step | Clear slot |

Snapshots persist across reboots.

## 14.4 Volume

The Volume encoder controls master output only (passed to Move firmware).
Per-track volume is not available in dAVEBOx — adjust gain on the destination (Move
mixer or Schwung chain).

---

# 15. Sound Sources & Co-Run Editing

**Co-run** lets you edit a track's sound source — Move's native synth or a Schwung effect chain — from within dAVEBOx without suspending. The OLED, jog wheel, and knobs hand off to the editor while dAVEBOx's transport and sequencer keep running.

**Requires Schwung 0.9.18 or later.** Edit Slot and Edit Synth appear automatically on qualifying builds and stay hidden on older versions.

## 15.1 Entering co-run

| Method | Where |
|---|---|
| **Shift + Step 3** | Track View |
| **Track Config → Edit Slot...** | Schwung-routed tracks only |
| **Track Config → Edit Synth...** | Move-routed tracks only |

**Edit Slot** opens Schwung's chain editor for the slot receiving the active track's MIDI channel. **Edit Synth** opens Move's native preset browser and instrument editor, landing on the track's current instrument.

## 15.2 Controls in the editor

Once in co-run, the OLED and jog transfer to the external editor. dAVEBOx playback continues normally.

| Control | Action |
|---|---|
| Jog rotate | Navigate the editor |
| Jog click | Select / enter |
| K1–K8 | Drive chain parameter assignments (Edit Slot) |
| Back | Navigate within the editor |
| **Step 3** | **Exit co-run** |
| Shift | Works normally — Shift navigation is fully supported inside co-run |

**Step 3 blinks** during co-run as the exit affordance. Every other step is darkened while in the editor.

### Mute is handed to Move/Schwung during co-run

While co-running Move's native instruments and drum pads (Edit Synth, or Shift + Step 3 on a Move-routed track), the **Mute** button mutes the *Move* instrument or drum pad you're working with, instead of toggling dAVEBOx's own track mute.

In the Schwung **chain editor** (Edit Slot), Mute is the chain's **bypass** modifier — hold **Mute** and **jog-click** a slot to bypass that component — so dAVEBOx no longer captures Mute for its own track mute/solo while editing a chain. Outside co-run, Mute is unchanged (dAVEBOx track mute/solo, plus Delete + Mute to clear).

*Requires Schwung with the Mute co-run group; on older Schwung builds Mute stays with dAVEBOx in every mode, exactly as before.*

### Edit Synth details (Move-routed tracks)

- **Drum pads:** tapping a drum pad plays a single hit at the velocity you pressed and selects that drum sound in Move's per-drum editor.
- **Lane display:** pads invert into track colors — selected lane = track color, unselected = white.
- **Side clip buttons:** lit solid white in Edit Synth.

## 15.3 Exiting co-run

Press **Step 3** to exit. dAVEBOx reclaims the OLED, pads, knobs, and LEDs and clears any held modifier state. You can also exit Schwung co-run via the **Menu** button.

---

# 16. MIDI Routing

## 16.1 Default setup

- **Tracks 1–4** → channels 1–4 → Move's native instruments
- **Tracks 5–8** → channels 5–8 → Schwung slots 1–4

Requires Move and Schwung configured per [Overview & Setup](#1-overview--setup).

## 16.2 Per-track settings (Track Config)

- **Channel** — MIDI channel 1–16 (default: track N = channel N)
- **Route** — Move, Schwung, or External (USB-A output)

## 16.3 External MIDI input

External MIDI from a USB-A controller routes to the active track. Filter by
channel in Global Menu (MIDI In: All or 1–16). dAVEBOx rechannelizes incoming MIDI
to the active track's channel.

### Live effects on external input

| Route | Live effects |
|---|---|
| Schwung | Full chain applies |
| Move | Chain bypassed (would cause feedback loop) |
| External | Full chain applies; output goes via USB-A |

## 16.4 External MIDI output

When Route = External, all MIDI goes out via USB-A: sequencer, live pads, external
echo, effects, ARP IN, Performance Mode. Multiple tracks can route External for
multi-timbral setups.

**Transport Stop** sends note-offs and clears ARP IN latches on all tracks.
**Delete + Play (stopped)** sends MIDI panic on all channels and clears Rpt1,
Rpt2, and ARP IN latches. **Delete + Play (running)** deactivates all clips and
clears latches.

## 16.5 CC and aftertouch output

The AUTO bank lanes output CC, aftertouch, or Schwung chain knob (Sch) data at
1/32 resolution with smooth interpolation. On External-routed tracks, CC/AT output
goes via USB-A. Sch lanes send CC 102-109 on the internal Schwung MIDI path to
control chain knob assignments (requires Schwung 0.9.17 or later). Aftertouch can also be
recorded live via pad pressure when the track's AftTch setting is enabled (see
[Track Config](#171-track-config)).

## 16.6 Clock Follow (syncing to Move)

By default dAVEBOx runs on its own internal clock. Set **Global Menu → Clock
Follow → Move** to instead lock dAVEBOx to Move's transport:

- **Tempo follows Move.** dAVEBOx advances from Move's MIDI clock, so it plays at
  Move's tempo and stays phase-locked. BPM shows **Move** and is read-only; Tap
  Tempo is disabled (the menu item and the Shift + Step 5 shortcut show a "BPM
  controlled by Move" notice instead). Turn Move's tempo and dAVEBOx tracks it.
- **Play drives Move.** Pressing dAVEBOx's **Play** starts (or stops) *Move's*
  transport; dAVEBOx then follows Move's start/stop so both launch from the same
  downbeat. Pressing Move's own Play works too — dAVEBOx follows either way.
- **Bar 1 re-anchors on start.** dAVEBOx resets to the start of its pattern each
  time Move starts, so the two share a downbeat. (Restart gestures re-anchor
  dAVEBOx locally; they don't reposition Move.)
- **Record count-in.** Arming Record while stopped starts Move and counts a
  one-bar lead-in on Move's clock, then begins recording on the downbeat (your
  bar 1 lands on Move's bar 2 — a constant, inaudible offset). Because Move
  quantizes its *own* transport start to its Ableton Link grid, there can be a
  short wait — up to about a bar — between pressing Record and Move actually
  starting. dAVEBOx waits through that Link sync so the count-in always lands on
  Move's downbeat at the current tempo, instead of starting early with no lead-in.
  If Move never starts at all (for example if it isn't the Link transport leader),
  dAVEBOx falls back to its own clock at the last-known tempo and shows a brief
  on-screen notice, so you still get a count-in and a take.
- **Stops with Move.** If Move's clock stops (Stop, or the clock simply stops
  arriving), dAVEBOx's sequencer stops too.
- **Tempo is captured automatically.** dAVEBOx reads its internal tempo from
  Move's clock while following, so the BPM stays matched without setting it by
  hand — including after Move stops (it keeps Move's last tempo).
- **Live arp & delay keep running while stopped.** Holding pads to arpeggiate, or
  using tempo-synced delay, keeps grooving at Move's tempo even when the transport
  is stopped — it no longer freezes when Move isn't running. (The main sequencer
  still stays stopped until Move starts again.)

This assumes Move's own sequencer is empty on the tracks dAVEBOx feeds —
dAVEBOx *replaces* the sequencer while Move provides clock, transport, and
voices. Leave Clock Follow **Off** for the normal free-running behavior; the
setting is saved per set but never auto-starts Move on load.

### Clock Out (dAVEBOx as clock master)

**Global Menu → Clock Out → On** makes dAVEBOx send MIDI clock and start/stop
messages out the USB-A port, so external synths and drum machines lock to
dAVEBOx's tempo and transport. This is for the **free-running** case (Clock
Follow = Off): dAVEBOx is the master and external gear chases it.

- **On only when free-running.** When **Clock Follow = Move**, Clock Out is
  automatically suppressed and the row shows **—** (your On/Off preference is
  remembered). While following, let Move's own *MIDI Clock Out* setting drive
  external gear — having dAVEBOx send clock too would put two clocks on the same
  USB-A port.
- **Requires Schwung 0.9.16 or later** for the tight, audio-rate clock path; on
  older Schwung the toggle has no effect.
- Saved per set; defaults **Off** and never sends clock on load until the
  transport actually runs.

> **Known limitation:** with Move's sequencer running underneath, some of Move's
> native clip/step/row-button LEDs can flicker against dAVEBOx's own LEDs. A fix
> is planned; it doesn't affect timing or playback.

---

# Part VI — Reference

# 17. Global Settings & Persistence

## 17.1 Track Config

Shown at the top of the Global Menu for the active track. Updates live if you
switch tracks. (Some entries are hidden when they don't apply to the current track
type or route.)

| Entry | Values | Notes |
|---|---|---|
| Channel | 1–16 | MIDI channel. Inert (shows "-") on a Conductor. |
| Route | Move, Schwung, External | Output routing. Inert (shows "-") on a Conductor. |
| Mode | Keys, Drums, Conduct | Track type. Preview-on-scroll; click to commit (confirm dialog). Converting carries notes — see [Switching type](#52-switching-type-converts-your-notes). |
| Layout | Scale, Chrom | Pad layout for melodic tracks (same as Shift + Step 8). Shows "-" on non-melodic tracks. |
| VelIn | Live, 1–127 | Live = raw velocity. A fixed value overrides all input velocity. |
| Looper | On, Off | Whether the track feeds Performance Mode. |
| AftTch | Off, Poly, Channel | Pad-pressure aftertouch (melodic tracks only). Poly sends individual pressure per note; Channel sends one pressure value for the whole track. Move-routed tracks only offer Off/Poly. Default Off. |
| Edit Slot... | Action | Open Schwung chain editor (Schwung-routed only). Requires Schwung 0.9.18 or later. |
| Edit Synth... | Action | Open Move preset browser (Move-routed only). Requires Schwung 0.9.18 or later. |

> See [Chapter 15 — Sound Sources & Co-Run Editing](#15-sound-sources--co-run-editing) for full controls and Schwung version requirements.

## 17.2 Global settings

Below the Track Config separator, in on-device menu order. (Several on-screen
labels are abbreviated — shown in parentheses.)

| Item | Values | Default | Notes |
|---|---|---|---|
| Clock Follow | Off, Move | Off | Follow Move's transport + tempo — see [Clock Follow](#166-clock-follow-syncing-to-move) |
| Clock Out | Off, On | Off | Send MIDI clock + start/stop out USB-A (dAVEBOx as clock master). Shows **—** and is suppressed while Clock Follow = Move — see [Clock Follow](#166-clock-follow-syncing-to-move) |
| BPM | 40–250 | 120 | Tempo. Shows **Move** (read-only) when Clock Follow = Move |
| Tap Tempo | — | — | Full-screen tap interface. Pad taps calculate BPM. Jog ±1 BPM. Disabled while Clock Follow = Move |
| Key | C through B | C | Session root note |
| Scale | (see list below) | Major | Active scale |
| Scale Aware | On, Off | On | Scale-aware params step in scale degrees instead of semitones |
| Launch Quant (*Launch*) | Now, 1/16, 1/8, 1/4, 1/2, 1-bar | Now | Now = clips start immediately. Other values wait for the next beat boundary. |
| Swing Amt | 50–75% | 50% | 50% = no swing, 66% = triplet swing |
| Swing Res | 1/16, 1/8 | 1/16 | Which positions are affected |
| MIDI In | All, 1–16 | All | External input channel filter |
| Metro | Off, Cnt-In, Play, Always | Off | Metronome timing |
| Metro Vol | 0–150% | 100% | Metronome level |
| Beat Markers (*Beat Marks*) | On, Off | On | Dim markers on steps 1, 5, 9, 13 |
| Export to Ableton | Action | — | Write an `.ablbundle` (transport stopped) — see [Export](#133-export-to-ableton-live) |
| Save state | Action | — | Write a timestamped snapshot (confirms first) — see [Save states](#173-save-states-snapshots) |
| Load state | Action | — | Restore a snapshot |
| Clear Session (*Clear Sess*) | Action | — | Resets the entire instance (confirm dialog) |
| Quit | Action | — | Save and exit |

**Scale list:** Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian,
Harmonic Minor, Melodic Minor, Pentatonic Major, Pentatonic Minor, Blues, Whole
Tone, Diminished.

> **Saving.** There is no plain "Save" menu action — dAVEBOx saves automatically
> when you suspend (**Back**), fully exit (**Shift + Back**), or choose **Quit**.
> For named backups you can return to, use **Save state** (snapshots, below).

## 17.3 Save states (snapshots)

Up to **16 snapshots** per set — full state backups stamped with date/time.

- **Save state** (Global Menu) asks you to confirm first (showing how many
  snapshots you have), then writes a new snapshot. When 16 exist, a picker opens to
  choose which to overwrite.
- **Load state** opens a list (newest first). Jog to select, click to confirm.
  Loading discards unsaved changes.
- Snapshots belong to the set. **Clear Session does not delete snapshots.**
- After a format-changing update, old snapshots are marked `(old)` and can be
  removed.

## 17.4 Version compatibility

If you load a set that was saved by an older dAVEBOx version, a dialog appears:

> **Incompatible State** — Session incompatible with current dB ver. Erase and
> proceed?

- **Yes** — erases the old state and starts with a clean session.
- **No** (default) / **Back** — exits the module. The old state file is preserved
  so you can back it up or downgrade.

## 17.5 What persists per set

Auto-saves on suspend (Back) and exit (Shift+Back / Quit).

- All note data, per-clip effects, CLIP/DRUM LANE params, CC automation
- Track settings: channel, route, mode, octave, VelIn, Looper, AftTch
- Per-track active bank and pad layout (Scale / Chrom)
- Global settings (BPM, key, scale, swing, launch quant, metro, etc.)
- Mute/solo state and all 16 snapshots
- ARP IN state (latch clears on Stop/Delete+Play/Session entry but persists across
  track switches)
- Performance Mode presets, latched mods
- Note Repeat gate masks, grooves, per-lane rates

## 17.6 Set duplication

Duplicating a Move set via the native set page inherits dAVEBOx state:
- **1 parent found:** silent auto-inherit
- **0 parents:** blank start
- **2+ candidates:** picker dialog

## 17.7 Cleanup

When you delete a Move set, dAVEBOx automatically removes its own saved data for
that set the next time it launches.

---

# 18. Cheat Sheet

## Track View — Melodic

| Control | Action |
|---|---|
| Pad | Play note |
| Pads held + step | Chord entry (pad-first) |
| Step held + pads | Chord entry (step-first) |
| Step tap | Toggle step on/off |
| Step hold (≥200ms) | Open step edit |
| Up / Down | Shift octave |
| Left / Right | Navigate pages |
| Side clip buttons | Switch clips |
| Jog rotate | Cycle banks |
| Jog click | Toggle alt-param mode |
| Shift + jog rotate | Switch tracks |
| Shift + bottom-row pad | Switch to track 1–8 |
| K1–K8 | Adjust active bank params |
| Loop (hold) | Loop view |
| Loop + jog | Adjust clip length |
| Play | Start/stop transport |
| Shift + Play | Restart from start |
| Loop + Play | Restart at visible page |
| Record | Start/stop recording |
| Capture | Bake dialog |
| Mute | Toggle mute |
| Shift + Mute | Toggle solo |
| Delete + Mute | Clear all mutes/solos |
| Mute + Play | Metro Off ↔ last non-Off |
| Copy + step/clip | Copy → press destination |
| Shift + Copy + clip | Cut |
| Delete + step | Clear step |
| Delete + side clip | Clear clip notes |
| Shift + Delete + side clip | Hard reset clip |
| Delete + jog click | Reset bank params |
| Shift + Delete + jog click | Reset all play-FX |
| Delete + Play (running) | Deactivate all clips + unlatch |
| Delete + Play (stopped) | MIDI panic + unlatch |
| Undo | Undo |
| Shift + Undo | Redo |
| Note/Session tap | Switch to Session View |
| Note/Session hold | Peek Session View |
| Shift + Note/Session | Global Menu |

### Shift + step shortcuts

| Step | Action | Views |
|---|---|---|
| 2 | Global Menu (global section) | Both |
| 3 | Open sound source editor (Edit Synth / Edit Slot) | Track |
| 5 | Tap Tempo | Both |
| 6 | Metro (Cnt-In ↔ Always) | Both |
| 7 | Swing | Both |
| 8 | Chromatic toggle (melodic) / cycle right-pad mode (drum) | Track |
| 9 | Scale | Both |
| 10 | VelIn toggle (Live ↔ 100) | Track |
| 11 | ARP IN on/off | Track (melodic) |
| 15 | Double-and-fill loop | Track |
| 16 | Quantize 100% | Track |

## Track View — Drum (additions/changes)

| Control | Action |
|---|---|
| Lane pad | Trigger + select lane |
| Capture + lane pad | Select silently |
| Up / Down | Switch lane bank A ↔ B |
| Shift + Step 8 | Cycle right-pad mode (Vel/Rpt1/Rpt2) |
| Step hold | Drum step edit (K1 Leng, K2 Vel, K3 Nudg, K5 Iter, K6 Prob, K7 Ratch) |
| Mute + lane pad | Mute/unmute lane |
| Shift + Mute + lane pad | Solo/unsolo lane |
| Copy + lane pad → dest | Copy lane |
| Shift + Copy + lane pad | Cut lane |
| Delete + lane pad | Clear lane |
| Shift + Delete + lane pad | Hard reset lane |
| Loop + jog | Set active lane length |
| Loop + rate pad (Rpt1) | Latch repeat |
| Loop + lane pad (Rpt2) | Latch lane repeat |
| Held lanes + Loop (Rpt2) | Latch all held |
| Delete + Loop | Stop all latched repeats |
| Loop + gate pad | Set repeat cycle length |
| Delete + gate pad | Reset gate step's vel scaling + nudge |

## Session View

| Control | Action |
|---|---|
| Clip pad | Launch/queue clip |
| Empty clip pad | Focus for recording |
| Shift + clip pad | Open clip in Track View (launches empty clips, or any clip while playing) |
| Scene launcher / steps 1–16 | Launch scene row |
| Shift + scene launcher | Launch at next bar |
| Jog rotate | Scroll rows |
| +/− | Scroll by 4 |
| Mute + clip pad | Mute/unmute track |
| Shift + Mute + clip pad | Solo/unsolo track |
| Delete + Mute | Clear mutes/solos |
| Mute (hold) + step tap | Recall mute snapshot |
| Mute (hold) + step hold | Save mute snapshot |
| Mute + Delete + step | Clear snapshot slot |
| Copy + clip pad | Copy clip |
| Shift + Copy + clip pad | Cut clip |
| Copy + scene launcher | Copy row |
| Capture + scene launcher | Snapshot playing clips to row |
| Capture (tap) | Scene-bake picker |
| Sample (tap) | Arm/stop Live Merge |
| Sample + scene launcher | Direct scene bake |
| Delete + clip pad | Delete clip |
| Delete + scene launcher | Clear row notes |
| Shift + Delete + scene launcher | Hard reset row |
| Loop (tap) | Lock Performance Mode |
| Loop (hold) | Temporary Performance Mode |
| Shift + Loop | Toggle latch mode |

## Performance Mode

| Control | Action |
|---|---|
| R0 pads 1–5 | Set capture length (1/32–1/2 bar) |
| R0-6 Hold | Persistent hold |
| R0-7 Sync | Clock-aligned capture |
| R0-8 Latch | Latch mode |
| R1–R3 pads | Pitch / vel-gate / wild mods |
| Lit pad tap | Clear that mod |
| K1–K8 touch | Toggle track's Looper |
| Step tap | Recall preset |
| Step hold ~0.75s | Save preset |
| Delete + step | Clear preset |

## Loop View (Track View + Loop held)

| Control | Action |
|---|---|
| Jog rotate | Adjust length ±1 step |
| Tap page | Set window [start, tapped] |
| Hold page + tap page | Set range [held, tapped] |
| Play | Restart at visible page |
| Delete | Delete clip |
| Delete + page | Clear page notes |
| Copy + page | Copy page |
| Shift + Step 15 | Double-and-fill |

## Step Edit (hold step)

| Control | Action |
|---|---|
| K1–K5 | Oct / Note / Leng / Vel / Nudg (melodic) |
| K6–K8 | Iter / Prob / Ratch (melodic) |
| K1–K3, K5–K7 | Leng / Vel / Nudg / Iter / Prob / Ratch (drum) |
| Up / Down | Shift octave range |
| Pads | Add/remove notes |
| Multiple steps held | Edit all at once |

---

# 19. Parameter Reference

## CLIP bank (melodic)

| K | Label | Range | Default | Destructive | Alt-mode |
|---|---|---|---|---|---|
| 1 | Res | 1/32, 1/16, 1/8, 1/4, 1/2, 1bar | 1/16 | Yes | Zoom |
| 2 | Stch | Halve ← · → Double | — | Yes | — |
| 3 | Shft | Whole steps ±N | 0 | Yes | Nudg (tick resolution) |
| 4 | Lgto | → (right-turn opens confirm) | — | Yes (one-shot) | — |
| 5 | InQ | Off, 1/64, 1/32, 1/16, 1/16T, 1/8, 1/8T, 1/4, 1/4T | Off | No (per-track) | — |
| 7 | Dir | Fwd, Bwd, PPf, PPb | Fwd | No | RvSt (Step, Audio) |
| 8 | SqFl | On, Off | On | No | — |

## DRUM LANE bank

| K | Label | Range | Default | Destructive | Alt-mode |
|---|---|---|---|---|---|
| 1 | Res | 1/32, 1/16, 1/8, 1/4, 1/2, 1bar | 1/16 | Yes | Zoom |
| 2 | Stch | Halve ← · → Double | — | Yes | — |
| 3 | Shft | Whole steps ±N | 0 | Yes | Nudg |
| 4 | Lgto | → (right-turn opens confirm) | — | Yes (one-shot) | — |
| 5 | Eucl | 0–lane length | 0 | Yes | — |
| 7 | Dir | Fwd, Bwd, PPf, PPb | Fwd | No | RvSt (Step, Audio) |
| 8 | SqFl | On, Off | On | No | — |

## NOTE FX bank

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Oct | ±4 octaves | 0 | |
| 2 | Ofs | ±24 | 0 | Scale-aware |
| 3 | Vel | ±127 | 0 | Velocity offset (signed) |
| 4 | Qnt | 0–100% | 0% | Playback quantize |
| 5 | Len> | --, .25, .50, .75, 1, 2, 4, 8, 16 | -- | Fixed pre-gate length (step-multiples). -- = passthrough. |
| 6 | Gate | 0–400% | 100% | Post-Len gate scale. <100% = staccato, >100% = legato. |
| 8 | Rnd | 0–24 | 0 | Pitch random (scale-aware). Alt: Walk/Uniform/Gaussian. |

On drums: K1+K2 = lane MIDI note, K3–K6 = per-lane.

## HARMONY bank (melodic only)

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Oct | ±4 | 0 | |
| 2 | Hrm1 | ±24 | 0 | Scale-aware |
| 3 | Hrm2 | ±24 | 0 | Scale-aware |
| 4 | Hrm3 | ±24 | 0 | Scale-aware |

## DELAY bank

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Rate | 1/64 through 1/1D (17 values incl. dotted/triplet) | 1/8D | Alt: ClkF (offsets timing per repeat, ±100) |
| 2 | Lvl | 0–127 | 127 | Echo velocity |
| 3 | Rep | 0–16 | 0 | 0 = bypass |
| 4 | Vfb | ±127 | 0 | Velocity per repeat |
| 5 | Pfb | ±24 | 0 | Pitch per repeat (scale-aware) |
| 6 | Gate | Off, 1/64, 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4, 1/2, 1bar | Off | Fixed echo gate |
| 7 | Rtrg | On, Off | On | New note drops in-flight echoes |
| 8 | Rnd | 0–24 | 0 | Echo pitch random (scale-aware). Alt: algorithm. |

## SEQ ARP bank (melodic only)

| K | Label | Range | Default |
|---|---|---|---|
| 1 | Styl | Off, Up, Dn, U/D, D/U, Cnv, Div, Ord, Rnd, RnO | Off |
| 2 | Rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1bar | 1/16 |
| 3 | Oct | ±4 (0 = Off) | Off |
| 4 | Gate | 1–200% | 100% |
| 5 | Stps | Mute, Step | Mute |
| 6 | Rtrg | On, Off | On |
| 7 | Sync | On, Off | On |

Jog click → Arp Steps editor.

## ARP IN bank (melodic only, per-track)

| K | Label | Range | Default |
|---|---|---|---|
| 1 | Styl | Off, Up, Dn, U/D, D/U, Cnv, Div, Ord, Rnd, RnO | Off |
| 2 | Rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1bar | 1/16 |
| 3 | Oct | ±4 (0 = Off) | Off |
| 4 | Gate | 1–200% | 100% |
| 5 | Stps | Mute, Step | Mute |
| 6 | Rtrg | On, Off | Off |
| 7 | Sync | On, Off | On |
| 8 | Ltch | On, Off | Off |

Jog click → Arp Steps editor.

## ALL LANES bank (drum)

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Res | 1/32–1bar | -- (resets after release) | Sets all lanes |
| 2 | Stch | Halve/Double | — | Atomic; "NO ROOM" if blocked |
| 3 | Shft | ±N steps | 0 | Alt: Nudg |
| 4 | Qnt | 0–100% | -- (resets after release) | Non-destructive |
| 5 | VelIn | Live, 1–127 | Live | Per-track |
| 6 | InQ | Off, 1/64–1/4T | Off | Per-track |
| 7 | Dir | Fwd, Bwd, PPf, PPb | -- (resets) | Alt: RvSt |
| 8 | SyncRpt | On, Off | On | Repeat first-fire timing |

## REPEAT GROOVE bank (drum, repeat active)

| K | Label (unshifted) | Label (Shift) |
|---|---|---|
| 1–8 | Velocity scaling per gate step (0–200%) | Nudge offset per gate step (±50%) |

Per-lane. Delete + jog click resets.

## Step edit — melodic

| K | Label | Range |
|---|---|---|
| 1 | Oct | ±octaves |
| 2 | Note | ±scale degrees (scale-aware) |
| 3 | Leng | Gate length |
| 4 | Vel | 0–127 |
| 5 | Nudg | ±1 step minus 1 tick |
| 6 | Iter | --, 1/2, 2/2, … 8/8 |
| 7 | Prob | --, 0–100% |
| 8 | Ratch | --, x2, x3, x4 |

## Step edit — drum

| K | Label | Range |
|---|---|---|
| 1 | Leng | Gate length |
| 2 | Vel | 0–127 |
| 3 | Nudg | ±1 step minus 1 tick |
| 5 | Iter | --, 1/2, 2/2, … 8/8 |
| 6 | Prob | --, 0–100% |
| 7 | Ratch | --, x2, x3, x4 |

---

# 20. LED & OLED Reference

## Clip pads (Session View)

| State | LED |
|---|---|
| Empty | Off |
| Has content, inactive | Very dim track color |
| Active empty (focused) | Dark grey |
| Will relaunch on Play | Solid bright track color |
| Playing | Flash dim/bright track color at 1/8-note rate |
| Queued to launch | Flash at 1/16-note rate |
| Queued to stop | Flash dim/off at 1/16-note rate |

## Side clip buttons (Track View)

| State | LED |
|---|---|
| Playing | Flash bright/dim track color at 1/8-note rate |
| Focused, will relaunch | Slow pulse bright/dim |
| Focused (not playing) | Solid bright track color |
| Has content, not focused | Dim track color |
| Empty | Dark grey |

## Step buttons (Track View)

| State | LED |
|---|---|
| Playhead | White |
| Active step (has notes) | Track color |
| Inactive step | Off (beat markers 1/5/9/13 dim track color when Beat Markers on) |
| Beyond clip length | Dark grey |

## Step buttons (Session View)

| State | LED |
|---|---|
| Rows in view | Red (pulsing if row has playing clips) |
| Out-of-view with playing clips | Pulsing white |
| Out-of-view with content | Solid white |
| Out-of-view, empty | Off |

## Knob LEDs

- **Performance Mode (locked):** track color = Looper on, off = Looper off.
- **Most banks:** lit = param changed from default, off = at default.
- **AUTO bank:** see [Automation](#11-automation).

## Mute button (Track View)

| State | LED |
|---|---|
| Muted | Solid |
| Soloed | Blinking (~4 Hz) |
| Neither | Solid dim |

## OLED — Track View header

**Melodic:** Metro mode · VelIn · Fix/Adap indicator · `Oct:±N` · `Arp` (inverts
when latched) · Key + Scale (underlined when Scale Aware on)

**Drum:** `Bank:A/B   Pad:C3 (48)` · mute/solo status for active lane

**Bank strip** (both types): a right-aligned row of blocks in the header — tall
block = active bank, short stubs = others. Order matches jog navigation. Shown on
the resting overview and on every parameter-bank overview, where it replaces the
old `Tr#` indicator.

## OLED — Track numbers

| State | Display |
|---|---|
| Active | 1px box around number |
| Muted | Number blinks |
| Soloed | Filled box, solid inverted |

## OLED — Position bar

Segmented bar at bottom of Track View: solid block = current page, outline =
playhead page (if different), bottom edge = other pages with content. Dot tracks
playhead. 1px ticks at edges signal content outside window.

## Action popups (~520ms)

| Action | Message |
|---|---|
| Copy/Cut/Paste | COPIED / CUT / PASTED |
| Clip clear | SEQUENCE CLEARED |
| Row clear | SEQUENCES CLEARED |
| Hard reset (clip) | CLIP CLEARED |
| Hard reset (row) | CLIPS CLEARED |
| Bank reset | BANK RESET |
| Full FX reset | CLIP PARAMS RESET |
| Loop double | LOOP DOUBLED |
| Loop at max | CLIP FULL |
| Lane clear / reset | LANE CLEARED / LANE RESET |
| Scene capture | CAPTURED / TO ROW N |
| Nothing to capture | NOTHING / TO CAPTURE |
| Mute snapshot save/clear | MUTE STATE / SAVED · CLEARED |
| Perf preset save/clear | PERF PRESET / SAVED · CLEARED |
| Stretch blocked | NO ROOM |
| Zoom blocked | NOTES OUT OF RANGE |
| State saved | STATE SAVED |
| Undo / nothing | UNDO · NOTHING TO UNDO |
| Redo / nothing | REDO · NOTHING TO REDO |

---

## Limitations

| Limitation | Notes |
|---|---|
| External MIDI on Move-routed tracks bypasses the effects chain | Would cause feedback loop. Use Schwung routing for effects on external input. |
| Volume encoder is master-only | Per-track volume: adjust on destination. |
| CC automation lanes are not swung | By design — keeps automation on the grid. |
| Powering off from within dAVEBOx causes a brief hang | — |
