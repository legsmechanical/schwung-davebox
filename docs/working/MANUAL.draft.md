<!-- DRAFT-BANNER-START -->
> ⚠️ **WORKING DRAFT — for the next release.** Edit *this* file (`MANUAL.draft.md`) for every user-facing change as it lands. The **released** manual is `MANUAL.md` — do **not** edit it directly; `scripts/cut_release.sh` promotes this draft into `MANUAL.md` (banner stripped) at release time. Tracked for history/backup, but it is not the published manual until a release.
<!-- DRAFT-BANNER-END -->

# The dAVEBOx Manual

dAVEBOx is a **MIDI sequencer for the Ableton Move**. It records, arranges, and
plays back MIDI — notes and automation — and sends it to an instrument. It makes
no sound of its own: the sound comes from whatever each track is pointed at, which
is one of Move's own instruments, a Schwung effect chain, or an external synth on
the USB-A port.

dAVEBOx runs inside [Schwung](https://github.com/charlesvestal/schwung) and takes
over Move's pads, knobs, and screen while it's open. It borrows Move's vocabulary —
tracks, clips, and sets — and a **Like Move** note flags where something works as
it does on Move.

> 🚀 **New here?** The [**Quick Start guide**](QUICKSTART.md) walks you from a
> blank set to a running arrangement in about fifteen minutes. This manual is the
> full reference.

---

## Contents

1. [Overview](#1-overview)
2. [Connect & Configure](#2-connect--configure)
3. [Operating the Sequencer](#3-operating-the-sequencer)
4. [Tracks](#4-tracks)
5. [Melodic Clips](#5-melodic-clips)
6. [Drum Clips](#6-drum-clips)
7. [The Conductor](#7-the-conductor)
8. [Clip Timing & Grid](#8-clip-timing--grid)
9. [Effects](#9-effects)
10. [Automation](#10-automation)
11. [Arranging](#11-arranging)
12. [Performance Mode](#12-performance-mode)
13. [Routing & Sync](#13-routing--sync)
14. [Bake, Merge & Export](#14-bake-merge--export)
15. [Settings & Sets](#15-settings--sets)
16. [The Browser Editor](#16-the-browser-editor)
17. [Quick Reference](#17-quick-reference)

---

# 1. Overview

## How a dAVEBOx set is built

Everything in dAVEBOx nests like this:

- A **note** (or an automation point) sits on a **step** — one slot of a clip's grid.
- A run of steps makes a **clip** — the basic unit you program and play. A clip
  also carries its own [effects](#9-effects) and [automation](#10-automation).
- A **track** holds **16 clips** and points at one instrument. Only one of its
  clips plays at a time.
- A **scene** is one clip from each of the 8 tracks, launched together.
- The whole thing is saved inside the **Move set**.

> **Like Move:** tracks, clips, and sets are the same objects you already know
> from Move. (Scenes are dAVEBOx's own.) dAVEBOx replaces Move's sequencer, not its
> instruments.

## What it does and doesn't do

dAVEBOx sequences **MIDI**, so its reach ends at the note and controller data it
sends:

- It **plays notes** to an instrument — it never generates audio, and it has no
  per-track volume or audio effects. Level and tone live on the instrument (the
  Move mixer, or the Schwung chain).
- Its **effects** — arpeggiators, note-delay, harmony, and the rest — are **MIDI
  effects.** They add and reshape notes on the way out and change nothing you
  programmed into the clip.

## The two views

You work in one of two views and switch between them with **Note/Session**:

| | Track View | Session View |
|---|---|---|
| For | Building one clip in detail | Launching and arranging clips |
| Pads | Play notes / drum lanes | The clip grid |
| Steps | The clip's steps | Scene launchers |

## Three kinds of track

Each track is one of three types. The type sets how you enter notes and how the
track sequences them:

| Type | How it works |
|---|---|
| **Melodic** | Scale-snapped notes on the pads and steps — see [Melodic Clips](#5-melodic-clips) |
| **Drum** | The pads become 32 drum lanes, each its own step sequence — see [Drum Clips](#6-drum-clips) |
| **Conductor** | Plays no notes of its own; it transposes the other tracks live — see [The Conductor](#7-the-conductor) |

---

# 2. Connect & Configure

## Point each track at an instrument

dAVEBOx reaches its instruments over MIDI channels, so Move and Schwung each need
to listen on a matching channel. **This is a one-time setup.**

**On Move** — set tracks 1–4 to receive on channels 1–4, and turn each track's
MIDI **Out** off:

| Move track | MIDI In | MIDI Out |
|---|---|---|
| 1 | Ch 1 | Off |
| 2 | Ch 2 | Off |
| 3 | Ch 3 | Off |
| 4 | Ch 4 | Off |

**In Schwung** — set slots 1–4 to receive on channels 5–8, with each slot's
Forward Channel set to **Auto**:

| Schwung slot | Receive channel |
|---|---|
| 1 | Ch 5 |
| 2 | Ch 6 |
| 3 | Ch 7 |
| 4 | Ch 8 |

The result is the default routing: **tracks 1–4 play Move instruments** and
**tracks 5–8 play Schwung chains**. Any track's channel and route can be changed
later — see [Routing & Sync](#131-instruments--routing).

## Open dAVEBOx

Load a Move set, then launch dAVEBOx from Schwung's tool menu — **Shift + Step 13**
(the star).

## Set tempo, key, and scale

These live in the **Settings menu** (**Shift + Note/Session**):

- **BPM** sets the tempo.
- **Key** and **Scale** set the root and scale that melodic tracks snap to.

Changing Key or Scale offers to move your existing notes with it — see
[Key & Scale](#152-key--scale).

---

# 3. Operating the Sequencer

## 3.1 The controls

While dAVEBOx is open, Move's controls map like this:

```
   ┌─────────────────────────────────────────┐
   │              OLED screen                │   Volume
   └─────────────────────────────────────────┘

  Jog     ①   ②   ③   ④   ⑤   ⑥   ⑦   ⑧      ← eight knobs

       ┌──┐   ┌──┬──┬──┬──┬──┬──┬──┬──┐
       │  │   │  │  │  │  │  │  │  │  │   top row
     4 side   ├──┼──┼──┼──┼──┼──┼──┼──┤
     buttons  │  │  │  │  │  │  │  │  │   4 × 8 pad grid
       │  │   ├──┼──┼──┼──┼──┼──┼──┼──┤
       └──┘   │  │  │  │  │  │  │  │  │   bottom row
              └──┴──┴──┴──┴──┴──┴──┴──┘

            [ 1][ 2][ 3][ 4] … [13][14][15][16]   ← 16 step buttons
```

| Control | Role |
|---|---|
| **Knobs 1–8** | Adjust the active bank's parameters. |
| **Jog** | Turn to cycle parameter banks and scroll lists. |
| **Volume** | Master output level. |
| **Pad grid** | Plays notes and drum lanes, or shows the clip grid. |
| **Side buttons** | Switch clips on the active track. |
| **Step buttons 1–16** | Show the active clip's steps, or launch scenes. |

The **named buttons** — Play, Record, Loop, Mute, Delete, Copy, Capture, Sample,
Undo, Note/Session, Shift, +/−, and the arrows — each have their own job (covered where
it comes up) and double as *modifiers* when held with another control. A held
combination is written "**Modifier + X**" (for example, **Shift + Note/Session**).
The full list of gestures is in the [Quick Reference](#17-quick-reference).

## 3.2 Transport

**Play** starts and stops the sequencer. By default the sequencer runs on
dAVEBOx's own clock; it can instead lock to Move's transport or send clock to
external gear — see [Routing & Sync](#134-clock-follow).

## 3.3 Switching views

Tap **Note/Session** to switch between Track View and Session View; hold it to
peek at the other view without leaving.

## 3.4 Selecting a track

There are no dedicated track buttons. Change the active track with:

| Gesture | Works in |
|---|---|
| **Shift + jog turn** | Both views |
| **Shift + bottom-row pad (1–8)** | Track View |
| **Tap a pad in a column** | Session View |

A box around a track number marks the active track.

## 3.5 Parameter banks

In Track View, the eight knobs control a **bank** of parameters, and the **jog**
cycles through the banks. Which banks exist depends on the track type; they are
covered in [Clip Timing & Grid](#8-clip-timing--grid), [Effects](#9-effects), and
[Automation](#10-automation).

- **Touch** a knob to see its full name and current value; **turn** it for a large
  read-out. The LED under a knob lights when its parameter is set away from default.
- **Click the jog** to switch a bank between its primary and alternate parameters
  (the labels change). A **down-arrow** in the header marks any bank that has
  alternates, and blinks while the alternates are showing. Click again, or change
  bank or track, to return to the primary set.
- The bank display falls back to a track overview after a moment. **Touch the jog**
  to bring it back.

## 3.6 The Settings menu

**Shift + Note/Session** opens the Settings menu — the active track's settings
first, then the session-wide settings. The full list is in
[Settings & Sets](#15-settings--sets), and many settings have a **Shift + Step**
shortcut (see the [Quick Reference](#17-quick-reference)).

## 3.7 Saving, suspending & exiting

dAVEBOx saves your set automatically whenever you leave it:

| Action | Result |
|---|---|
| **Hold Back** (~½ s) | Suspend — dAVEBOx keeps playing in the background |
| **Shift + Back** | Exit to Schwung |
| **Settings menu → Quit** | Exit to Schwung |

There is no manual "save." For named backups you can return to, use
[Save state](#153-snapshots).

---

# 4. Tracks

dAVEBOx has **8 tracks**. Each holds **16 clips**, plays one clip at a time, and
points at one instrument (its channel and route — see
[Routing & Sync](#131-instruments--routing)).

## 4.1 Track type

A track's **type** sets how you enter notes into it and how it sequences them. Set
it in the Settings menu under **Mode**, where scrolling previews the candidate type
and clicking commits it:

| Type | Menu label | How it works |
|---|---|---|
| Melodic | `Keys` | Scale-snapped notes on the pads and steps — [Melodic Clips](#5-melodic-clips) |
| Drum | `Drums` | 32 drum lanes, each its own step sequence — [Drum Clips](#6-drum-clips) |
| Conductor | `Conduct` | Plays no notes of its own; transposes the other tracks — [The Conductor](#7-the-conductor) |

Melodic is the default. A track keeps its color, clips, and routing whatever its
type.

## 4.2 Changing type

Changing type **carries your notes** across all 16 clips (their pitch, length, and
per-step conditions), but **resets effects, arpeggiators, and automation** to
defaults.

- **Melodic ↔ Drum** asks you to confirm when the track holds notes. An empty
  track switches at once.
- **To or from Conductor** keeps your notes and is only available with the
  transport stopped. Only one Conductor can exist in a set at a time.

---

# 5. Melodic Clips

A melodic clip is a sequence of scale-snapped notes on a step grid. This chapter
covers writing, editing, and recording into one; the [Effects](#9-effects) and
[Automation](#10-automation) that shape it have their own chapters.

## 5.1 Playing and placing notes

The pads play notes from the current [key and scale](#152-key--scale). **+ / −**
shifts the pad octave. To place notes on the grid, use the **16 step
buttons**:

| Action | Result |
|---|---|
| Tap an empty step | Places the last note you played, at velocity 100 |
| Tap a filled step | Clears it |
| Hold a step | Opens [note edit](#53-editing-notes) (an empty step is filled first) |
| Tap several steps together | Toggles each |

Steps past the clip's length are dimmed.

**Pad layout.** By default the pads show only in-scale notes, with the root in the
track color (`Keys` layout). **Shift + Step 8** switches to a chromatic layout —
all 12 semitones, with the in-scale notes highlighted. The **Layout** setting in
the Settings menu does the same.

## 5.2 Chords

A step holds up to **eight notes**. Build a chord two ways:

- **Pads first:** hold one or more pads, then press a step.
- **Step first:** hold a step, then tap pads one at a time. Tap a held note again
  to remove it.

## 5.3 Editing notes

<img src="img/step-editor.png" width="384" alt="Note edit screen: a note box on the left, then knobs for length, velocity, nudge, and per-step conditions">

Hold a step to edit its notes. Edits apply to every note in the step; hold several
steps to edit them together. While holding a step, **+ / −** moves the octave
range so you can reach higher or lower notes.

| Knob | On screen | Adjusts |
|---|---|---|
| 1 | `Note` | Pitch, by scale degree |
| 2 | `Oct` | Pitch, by octave |
| 3 | `Leng` | Note length (gate) |
| 4 | `Vel` | Velocity |
| 5 | `Nudg` | Timing, up to ±1 step |
| 6 | `Iter` | Iteration (below) |
| 7 | `Prob` | Probability (below) |
| 8 | `Ratch` | Ratchet (below) |

### Per-step conditions

Three settings decide *whether and how* a step fires. Each defaults to `--` (off):

- **Iteration** (`Iter`) plays the step only on certain passes of the loop. `2/3`
  plays on the 2nd pass of every three. The counter resets on a cold start (Stop →
  Play).
- **Probability** (`Prob`) gives the step a chance of playing, from 100 % down to
  1 %. The roll is per note, so chords thin out unevenly.
- **Ratchet** (`Ratch`) retriggers the step 2, 3, or 4 times within its slot.

They stack in that order: iteration decides if the step plays, probability rolls
per note, and a note that plays fires all its ratchets.

## 5.4 Recording

Press **Record** to play notes into the active clip in real time.

| Transport | What happens |
|---|---|
| Stopped | A 1-bar count-in, then recording and playback start together |
| Playing a fixed-length clip | Records from the current position |
| Playing an empty clip | Arms, and starts at the next bar — Record blinks until then |

Recording adds to what's there; it never erases. For a clean take, clear the clip
first (**Delete + side button**), which also frees its length so the take sizes
itself to what you play. Notes played in the last half-beat of the count-in land
on step 1. You can switch tracks mid-take — recording follows the active track.

Recording runs in the **Forward** [playback direction](#81-clip-bank). A clip set
to another direction offers to bake itself to Forward first.

## 5.5 Capture

dAVEBOx is always listening. Everything you play on the pads while a track is not
recording is held in a buffer, so if you play something you want to keep, tap
**Capture** and it becomes real clip data. The Capture button lights bright while
there is buffered input to keep.

> **Like Move:** this is Move's Capture — play first, keep it after.

What Capture does depends on the transport:

| Transport | What Capture does |
|---|---|
| Playing | Adds the buffered notes to the active clip where you played them; knob moves become [automation](#10-automation) |
| Stopped, empty set | Reads a tempo from your playing, sizes a clip to whole bars, and starts it |
| Stopped, set with clips | Fits the take to the current tempo; a screen lets the jog pick how many bars it fills |

After a stopped capture into an empty set, a tempo chooser offers the detected BPM
and a few nearby candidates over a strip showing your take against the bars —
playback keeps rolling as you scroll them, so you can hear which one fits. Capture
works on drum clips too. To clear the buffer, hold **Shift** and tap **Capture**.

## 5.6 Clip length & the loop

A clip runs up to **256 steps**, shown as **pages** of 16. **Left / Right** moves
between pages, and **Loop + jog** changes the clip length by a step.

Hold **Loop** for the **loop view**, where the step buttons stand for pages — a
page inside the loop lights in the track color (pulsing if it holds notes). While
Loop is held:

| Gesture | Sets the loop to |
|---|---|
| Jog ±1 | Grow or shrink from the end |
| Tap a page | Page 1 through the tapped page |
| Hold one page, tap another | The range between them |

Notes outside the loop are kept and return when you widen it.

## 5.7 Undo

**Undo** reverses the last edit; **Shift + Undo** repeats it. It covers step and
clip edits, copy and clear, recording, bakes, and more.

---

# 6. Drum Clips

On a drum track, each sound is a **lane** — its own step sequence with its own
length, timing, and effects. A track has **32 lanes**, each mapped to a MIDI note
that triggers one sound in the instrument.

The pad grid splits in two:

| Half | Holds |
|---|---|
| **Left 4×4** | 16 drum lanes. Tap one to hear its sound and select it — the steps then show that lane. |
| **Right 4×4** | Velocity zones, or a [note-repeat](#63-note-repeat) mode |

The left pads show 16 lanes at a time; **+ / −** switches between lane **bank
A** and **bank B** for all 32. The screen shows the active bank.

## 6.1 Placing hits

Select a lane, then tap **steps 1–16** to add or clear its hits. The steps always
show the selected lane.

**Velocity zones** (the right 4×4) set the velocity for the hits you place next —
16 zones from 8 (bottom-left) to 127 (top-right).

**A lane's sound** is set by its MIDI note, on the [NOTE FX bank](#91-note-fx):
knob 1 moves it by an octave, knob 2 by a semitone. The screen shows the note,
e.g. `Pad: C1 (36)`.

Editing a hit (length, velocity, nudge, and per-step conditions) works the same as
[note edit](#53-editing-notes), minus the two pitch knobs.

## 6.2 Per-lane loops

Each lane has its own loop length, set with **Loop + jog** on the selected lane.
A kick looping over 16 steps, a hat over 12, and a percussion lane over 10 each
cycle against the shared transport — a polyrhythm from one clip.

## 6.3 Note Repeat

Note Repeat retriggers a lane at a steady rate. **Shift + Step 8** cycles the right
pads between velocity zones and the two repeat modes.

The bottom two rows of the right pads are **rates**; the top two rows are a **gate
mask**:

```
   top row      [ gate 1 ][ gate 2 ][ gate 3 ][ gate 4 ]   gate mask
                [ gate 5 ][ gate 6 ][ gate 7 ][ gate 8 ]   (8-step loop)
                [ 1/32T  ][ 1/16T  ][ 1/8T   ][ 1/4T   ]   triplet rates
   bottom row   [ 1/32   ][ 1/16   ][ 1/8    ][ 1/4    ]   straight rates
```

- **Rpt1** repeats the **selected** lane: hold a rate pad. Velocity follows pad
  pressure, and you can change lanes while holding.
- **Rpt2** repeats **any** lane at a rate you assign it: tap a rate pad to assign
  it to the selected lane, then hold a lane pad. Hold several for layered repeats.

**Latch** keeps a repeat going after you let go: **Loop + rate pad** (Rpt1) or
**Loop + lane pad** (Rpt2). Tapping **Loop** with no pads held releases all
latches on the track; **Delete + Loop** stops them too. Latched lanes light cyan,
and stopping the transport clears them.

**The gate mask** (top two rows) is a looping on/off pattern over the repeats — all
on by default, tap to toggle. **Loop + a gate pad** sets its cycle length (1–8).
Per-step velocity and timing for the mask live in the
[REPEAT GROOVE bank](#84-repeat-groove-bank).

## 6.4 Copying & muting lanes

- **Copy + lane pad**, then tap another lane to paste (the destination keeps its
  own MIDI note). **Shift + Copy** cuts.
- **Mute + lane pad** mutes a lane; **Shift + Mute + lane pad** solos it.

---

# 7. The Conductor

A **Conductor** is a track that transposes every playing melodic clip up or down
in real time, following the note it plays. It sends no MIDI of its own — its
sequence (and its live pads) only steer the transposition. The written notes on
the other tracks never change; the shift is live and reversible. **A set can hold
one Conductor at a time.**

This lets one track lead a key change or chord move across the whole arrangement:
sequence a progression on the Conductor, and every responding track follows it.

## 7.1 Creating one

Set a track's **Mode** to `Conduct` in the Settings menu (transport stopped). Its
notes carry over; its effects, arps, and automation reset. A Conductor's channel
and route are inert (shown `-`), and **Mute** pauses its conducting — the
responders snap back to their written pitch.

## 7.2 How the shift works

Zero transposition is the **session root at octave 4** — the default pad note. Play
that and nothing shifts; play higher and the responders rise, lower and they fall.
The Conductor's own octave scales the move, so an octave up on the Conductor is an
octave of transposition.

The shift follows the global **Scale Aware** setting — by scale degree (staying in
key) when it's on, by semitone when it's off. An empty Conductor step, or a muted
Conductor, holds the responders at zero. Drum tracks never respond.

## 7.3 The Conductor's banks

<img src="img/bank-conductor-octave.png" width="384" alt="C-OCTAVE bank: a per-track octave value for each of the eight tracks">

A Conductor's jog cycles five banks, each headed with a **`C-`** so you always
know you're on the Conductor:

| Bank | Controls |
|---|---|
| **Conduct** | The Conductor's own timing and direction, plus **Cond Lock** (`CdLk`): *Off* holds the shift only for each note's length; *Lock* holds it until the next Conductor note. |
| **NoteFX** | Shapes the Conductor's note before the shift is worked out — an octave, an offset, and a per-note random amount. |
| **Responder** | An on/off cell per track (`Tr1…Tr8`) — on means the track follows. Drum tracks read `--`. |
| **Octave** | A per-track octave (**−4…+4**) added on top of the shift while the Conductor sounds. |
| **When** | Per track: **Next** (a responder takes the shift at its next note) or **Now** (a sounding note is retriggered at the new pitch at once). |

## 7.4 Making it permanent

The Conductor's transposition can be folded into the responding clips when you
[bake a scene](#141-bake) or [export to Live](#143-export-to-live), each offering
an **Apply Conductor?** step. The Conductor track itself has no bake and exports as
a silent placeholder.

---

# 8. Clip Timing & Grid

These banks reshape a clip's step grid and the notes on it. Most of their changes
**rewrite the notes directly** — **Undo** reverses them.

**Resetting a bank** (this works on any bank, including [Effects](#9-effects)):

| Gesture | Result |
|---|---|
| **Delete + jog click** | Reset every parameter in the active bank |
| **Shift + Delete + jog click** | Reset all effects across every bank |
| **Shift + Delete + side button** | Reset the whole clip — notes and all parameters |

## 8.1 CLIP bank

<img src="img/bank-clip.png" width="384" alt="CLIP bank: resolution, stretch, shift, legato, input quantize, direction, follow">

A melodic clip's grid, direction, and note transforms.

| Knob | On screen | What it does | Default |
|---|---|---|---|
| 1 | `Res` | **Resolution** — the step grid size; rescales the notes. *Alt:* **Zoom** (regrid without moving notes). | 1/16 |
| 2 | `Stch` | **Stretch** — one detent doubles (right) or halves (left) the clip. | — |
| 3 | `Shft` | **Shift** — rotate all notes by whole steps. *Alt:* **Nudge** (finer). | 0 |
| 4 | `Lgto` | **Legato** — turn right to confirm; lengthens every note to reach the next. | — |
| 5 | `InQ` | **Input Quantize** — snap recorded notes to the grid. | Off |
| 7 | `Dir` | **Direction** — Forward, Backward, or ping-pong. *Alt:* **Reverse Style**. | Fwd |
| 8 | `SqFl` | **Follow** — scroll the step display to keep up with the playhead. | On |

Recording needs **Forward** direction; [bake](#141-bake) and [export](#143-export-to-live)
freeze the direction into the notes and reset it to Forward.

## 8.2 DRUM LANE bank

<img src="img/bank-drumlane.png" width="384" alt="DRUM LANE bank: resolution, stretch, shift, legato, euclid, direction, follow">

The **selected lane's** grid — the drum counterpart to the CLIP bank.

| Knob | On screen | What it does | Default |
|---|---|---|---|
| 1 | `Res` | **Resolution.** *Alt:* **Zoom.** | 1/16 |
| 2 | `Stch` | **Stretch.** | — |
| 3 | `Shft` | **Shift.** *Alt:* **Nudge.** | 0 |
| 4 | `Lgto` | **Legato** (this lane). | — |
| 5 | `Eucl` | **Euclid** — spread N hits evenly across the lane. Hand-placed hits stay. | 0 |
| 7 | `Dir` | **Direction.** *Alt:* **Reverse Style.** | Fwd |
| 8 | `SqFl` | **Follow.** | On |

Lane length is **Loop + jog**; the lane's MIDI note is on the
[NOTE FX bank](#91-note-fx).

## 8.3 ALL LANES bank

<img src="img/bank-alllanes.png" width="384" alt="ALL LANES bank: apply resolution, stretch, shift, quantize, velocity, input quantize, direction, and repeat sync to all lanes">

Applies one setting to **all 32 lanes** at once. Because that rewrites every lane,
the bank opens on a **"Edits will affect all lanes. Proceed?"** screen — **click
the jog to confirm** before the knobs, Loop, or the Shift + Step shortcuts do
anything.

| Knob | On screen | What it does |
|---|---|---|
| 1 | `Res` | **Resolution** for all lanes |
| 2 | `Stch` | **Stretch** all lanes (`NO ROOM` if any can't fit) |
| 3 | `Shft` | **Shift.** *Alt:* **Nudge.** |
| 4 | `Qnt` | **Quantize** all lanes at playback (leaves the notes alone) |
| 5 | `VelIn` | Velocity input override for the track |
| 6 | `InQ` | Recording input quantize for the track |
| 7 | `Dir` | **Direction** for all lanes. *Alt:* **Reverse Style.** |
| 8 | `SyncRpt` | **Repeat Sync** — held repeats wait for the beat grid (On) or fire at once (Off) |

## 8.4 REPEAT GROOVE bank

<img src="img/bank-repeatgroove.png" width="384" alt="REPEAT GROOVE bank: a velocity bar for each of the eight gate-mask steps">

On a drum track while a [Note Repeat](#63-note-repeat) mode is active, this bank
shapes the 8-step gate mask, per lane.

| Knobs | Screen page | After jog-click |
|---|---|---|
| 1–8 | **Velocity** per gate step — `Thru` (the pad's own velocity) or a value 1–127 | **Nudge** per gate step (±50 % of the step) |

**Delete + jog click** resets the selected lane's groove.

---

# 9. Effects

dAVEBOx's effects are **MIDI effects** — they add and reshape notes on the way to
the instrument and change nothing you programmed. Return a knob to its default and
the clip plays exactly as written. Every note runs the same chain:

```
 LIVE INPUT ──▶ [LIVE ARP] ──┐
                             ├─▶ NOTE FX ─▶ HARMONY ─▶ DELAY ─▶ SEQ ARP ─▶ OUT
 SEQUENCED NOTES ────────────┘
```

The **LIVE ARP** runs on live pad and external input only. Global
[swing](#151-global-settings) is applied after the chain; [Performance Mode](#12-performance-mode)
comes last. NOTE FX, HARMONY, DELAY, and SEQ ARP are stored per clip; LIVE ARP is
per track.

## 9.1 NOTE FX

<img src="img/bank-notefx.png" width="384" alt="NOTE FX bank: octave, offset, velocity, quantize, length, gate, random">

Shifts every note's pitch, velocity, timing, and length.

| Knob | On screen | What it does | Default |
|---|---|---|---|
| 1 | `Oct` | Octave shift (±4) | 0 |
| 2 | `Ofs` | Note offset — scale degrees or semitones (±24) | 0 |
| 3 | `Vel` | Velocity offset (±127) | 0 |
| 4 | `Qnt` | Quantize at playback (0–100 %) | 0 % |
| 5 | `Len>` | Fixed note length in step-multiples (`--` = as written) | -- |
| 6 | `Gate` | Scale the length — under 100 % shortens, over 100 % lengthens | 100 % |
| 8 | `Rnd` | Pitch randomness (0–24). *Alt:* Walk, Uniform, or Gaussian | 0 |

<img src="img/bank-drum-notefx.png" width="384" alt="NOTE FX on a drum track: knobs 1 and 2 set the lane's MIDI note">

On a **drum track**, knobs 1 and 2 set the selected lane's MIDI note (octave and
semitone); knobs 3–6 apply to that lane.

## 9.2 HARMONY

<img src="img/bank-harmony.png" width="384" alt="HARMONY bank: an octave voice and three harmony voices">

Adds voices above every note (melodic tracks): an octave voice and three
scale-aware harmony intervals (each ±24, default 0).

## 9.3 DELAY

<img src="img/bank-delay.png" width="384" alt="DELAY bank: rate, level, repeats, velocity feedback, pitch feedback, gate, retrigger, random">

Echoes every note in rhythm.

| Knob | On screen | What it does | Default |
|---|---|---|---|
| 1 | `Rate` | Delay time (dotted and triplet values included). *Alt:* nudge each repeat | 1/8D |
| 2 | `Lvl` | Echo velocity | 127 |
| 3 | `Rep` | Number of echoes (0 = off) | 0 |
| 4 | `Vfb` | Velocity change per repeat | 0 |
| 5 | `Pfb` | Pitch change per repeat (scale-aware) | 0 |
| 6 | `Gate` | Fixed echo length (Off = natural) | Off |
| 7 | `Rtrg` | A new note clears the echoes in flight | On |
| 8 | `Rnd` | Pitch randomness on echoes. *Alt:* algorithm | 0 |

## 9.4 SEQ ARP

<img src="img/bank-seqarp.png" width="384" alt="SEQ ARP bank: style, rate, octave, gate, steps mode, retrigger, sync">

An arpeggiator running after Delay, on both sequenced and live notes (melodic
tracks). Per clip.

| Knob | On screen | What it does | Default |
|---|---|---|---|
| 1 | `Styl` | Style — Up, Down, Up/Down, Converge, Diverge, Ordered, Random, and more | Off |
| 2 | `Rate` | Arp rate | 1/16 |
| 3 | `Oct` | Octave range (±4) | Off |
| 4 | `Gate` | Note length (under 100 % shortens, over lengthens) | 100 % |
| 5 | `Stps` | How silenced steps behave — rest (`Mute`) or skip (`Step`) | Mute |
| 6 | `Rtrg` | Restart the arp on each new note | On |
| 7 | `Sync` | Wait for the next rate boundary | On |

**Click the jog** for the per-step editor: knobs 1–8 set each step's pitch offset,
and with **Shift** held they set each step's velocity (`Thru` passes the incoming
velocity). The pads write coarse velocities per step, and **Loop + pad** sets the
step-loop length.

## 9.5 LIVE ARP

<img src="img/bank-livearp.png" width="384" alt="LIVE ARP bank: the same controls as SEQ ARP plus a latch">

An arpeggiator for live pad and external input (melodic tracks). Per track; it
leaves sequenced notes alone. Drum tracks use [Note Repeat](#63-note-repeat)
instead.

The controls match SEQ ARP, plus a **Latch** (`Ltch`, knob 8) that keeps the arp
running after you release. With pads held, tapping **Loop** latches; **Delete +
Loop** unlatches. Latch survives track and channel changes and clears on Stop.
**Shift + Step 11** toggles LIVE ARP on and off with the last style.

---

# 10. Automation

<img src="img/bank-auto.png" width="384" alt="AUTOMATION bank: eight lanes labelled with CC, AT, and Sch targets, and a curve with a playhead">

Each of the eight knobs drives an **automation lane** — a recordable stream of
control-change or aftertouch data that plays back with the clip. A lane holds up to
1024 points, smoothly joined, plus an optional resting value it returns to each
loop. The bank works the same on melodic and drum clips.

## 10.1 Choosing what a lane sends

**Click the jog** to enter assign mode, then turn a knob to pick its target:
aftertouch (`AT`), a CC number (`CC0`–`CC127`), or — on a Schwung-routed track — a
Schwung chain knob (`Sch1`–`Sch8`). The target applies to the whole track. A lane
starts at `—` (sends nothing); turn up from there to reach 0.

## 10.2 Resting values and recording

A plain turn (no step held) sets the lane's **resting value** while stopped, and
sends it live. With the transport playing and **Record armed**, turning a knob
records — it writes the knob's value at the playhead and keeps writing, loop after
loop, until you stop. Lanes you don't touch keep what they had.

## 10.3 Editing and clearing

Hold a step to see each lane's value there and turn a knob to drop a point,
starting from the shown value. Clearing:

| Gesture | Clears |
|---|---|
| **Delete** (tap) | Opens a menu to clear AT and/or CC |
| **Delete + knob** | That lane |
| **Delete + step** | Every lane at that step |
| **Delete + jog click** | All automation in the clip |

## 10.4 Per-lane loops

A lane can loop independently of the clip — a short filter sweep under a long
melody, say. **Hold Loop on this bank** (the last-touched knob is the lane): the
step buttons set the length, the jog trims it by a step, **Left / Right** change
its playback speed, and **+ / −** change its step density.

---

# 11. Arranging

Arranging happens in **Session View** — the clip grid on the pads, 8 tracks across
and 4 rows visible, with the jog scrolling through all 16 rows. The screen keeps
showing the active bank.

## 11.1 Launching clips

| Gesture | Result |
|---|---|
| Tap a clip | Launch or queue it |
| Tap an empty clip | Focus it for recording |
| **Shift + clip** | Open it in Track View. While stopped, a clip with notes opens without launching; an empty clip launches. |

Launching a clip replaces whatever was playing **on that track**. Switching to a
track launches its focused clip only if that clip is empty, so you can move between
tracks without triggering the ones that hold notes.

## 11.2 Scenes

A scene launches one clip from every track at once — tap a **scene launcher** (left
of the grid) or a **step button (1–16)**. **Shift + scene launcher** launches at
the next bar. An empty cell in a scene leaves its track playing what it had.

| Gesture | Result |
|---|---|
| **Copy + scene launcher**, then a row | Copy all 8 clips |
| **Shift + Copy + scene launcher** | Cut the row |
| **Capture + scene launcher** | Snapshot the playing clips into the row |
| **Delete + scene launcher** | Clear the row's notes |
| **Shift + Delete + scene launcher** | Reset the row's clips |

## 11.3 Copying and clearing clips

The clipboard stays loaded after a paste, so you can paste to several places from
one source; it clears when you release **Copy**. **Cut is Shift + Copy** — the
source clears after the first paste.

| Level | Copy | Clear |
|---|---|---|
| Step | Copy + step → step (same clip) | Delete + step |
| Clip | Copy + clip / side button → destination | Delete + clip (Session), or Delete + side button (Track) |
| Reset a clip | — | Shift + Delete + side button (notes and parameters) |
| Drum lane | Copy + lane pad → lane | Delete + lane pad — see [Drum Clips](#64-copying--muting-lanes) |

Clearing a clip with the side button also frees its length for the next recording.

## 11.4 Mute, solo, and snapshots

| Where | Mute | Solo |
|---|---|---|
| Track View | **Mute** | **Shift + Mute** |
| Session View | **Mute + clip** | **Shift + Mute + clip** |
| Drum lanes | **Mute + lane pad** | **Shift + Mute + lane pad** |

**Delete + Mute** clears every mute and solo. A muted track goes silent but a live
pad you hold still plays through.

**Snapshots** store up to 16 mute/solo states. In Session View, hold **Mute** and
the step buttons light (grey = empty, yellow = saved): hold a step to save, tap a
saved step to recall, **Mute + Delete + step** to clear one. Snapshots persist
across reboots.

## 11.5 Volume

The **Volume** knob controls Move's master output. There is no per-track volume —
set level on the instrument (the Move mixer, or the Schwung chain).

---

# 12. Performance Mode

<img src="img/view-perf.png" width="384" alt="Performance Mode screen: the active mods listed, with Hold, Sync, and Latch chips and the rate">

Performance Mode grabs a short loop of what's playing and lets you transform it
live from a grid of effects. It runs in **Session View**.

## 12.1 Entering and exiting

**Tap Loop** to turn it on and keep it on hands-free; **hold Loop** to use it only
while held. Switching to Track View leaves Performance Mode and keeps your mod state.

## 12.2 The grid

```
   top row      wild mods        — blue
                velocity / gate  — yellow
                pitch mods       — magenta (melodic only)
   bottom row   length · hold · sync · latch
```

The **bottom row** sets the capture length and mode:

| Pad | Sets |
|---|---|
| 1–5 | Capture length: 1/32, 1/16, 1/8, 1/4, 1/2 bar |
| 6 | **Hold** — keep the loop when you release a length pad |
| 7 | **Sync** — clock-aligned capture |
| 8 | **Latch** — sticky mods |

The three **mod rows** transform the loop. With **Latch** on, tapping a mod pad
toggles it and it stays on until you tap it again; with Latch off, a mod runs only
while you hold its pad. Press a lit pad to turn its mod off.

<details>
<summary><b>Pitch mods</b> (magenta, melodic only)</summary>

| Pad | Name | Effect |
|---|---|---|
| 1 | Oct Up | Alternates octave up / original |
| 2 | Oct Down | Alternates octave down / original |
| 3 | Scale Up | +1/+2/+3 scale degrees over 3 loops, then resets |
| 4 | Scale Down | −1/−2/−3 over 3 loops |
| 5 | Fifth | Ascending fifths |
| 6 | Tritone | 4th, 6th, octave+2nd over 4 loops |
| 7 | Drift | ±1 random walk, drifts to ±6 |
| 8 | Storm | Random ±6 scale degrees per note — chaotic, in key |

</details>

<details>
<summary><b>Velocity / gate mods</b> (yellow, all tracks)</summary>

| Pad | Name | Effect |
|---|---|---|
| 1 | Decrescendo | Velocity ×0.85 per loop |
| 2 | Swell | 16-loop triangle |
| 3 | Crescendo | Velocity ×1.15 per loop |
| 4 | Pulse | Even loops full, odd loops 20 % |
| 5 | Sidechain | −15 % per successive note in a loop |
| 6 | Staccato | Gates to 1/8 of the loop |
| 7 | Legato | Gates to the full loop |
| 8 | Ramp Gate | Gate ramps up across notes |

</details>

<details>
<summary><b>Wild mods</b> (blue)</summary>

| Pad | Name | Effect |
|---|---|---|
| 1 | Half Time | Every other loop dropped |
| 2 | 3 Skip | Every third loop dropped |
| 3 | Phantom | Ghost note an octave below, ¼ velocity |
| 4 | Sparse | ~50 % of notes dropped |
| 5 | Glitch | ±2 scale-degree shift per note |
| 6 | Stagger | Notes offset +0, +1, +2… scale degrees |
| 7 | Shuffle | Pitch/hit order shuffled each loop |
| 8 | Backwards | Pitch/hit order reversed each loop |

</details>

## 12.3 Which tracks it captures

A track feeds Performance Mode when its **Looper** setting is on
([Track settings](#154-track-settings)). While Performance Mode is locked, touch a
knob to toggle its track's Looper — the knob LED is the track color when on.

## 12.4 Presets

The **step buttons are 16 preset slots**: tap to recall, hold to save, **Delete +
step** to clear. Slots 1–8 ship with combinations (Float, Sink, Heartbeat, Fairy
Dust, Robot, Dissolve, Chaos, Lift); 9–16 are yours.

---

# 13. Routing & Sync

## 13.1 Instruments & Routing

Two settings decide where a track's MIDI goes ([Track settings](#154-track-settings)):

- **Channel** — MIDI channel 1–16 (by default track N uses channel N).
- **Route** — Move, Schwung, or External (USB-A).

The default is tracks 1–4 to Move and 5–8 to Schwung, from
[Connect & Configure](#2-connect--configure). Several tracks can route External at
once for a multitimbral rig.

## 13.2 External MIDI in and out

A USB-A controller plays the **active track**, its notes moved onto that track's
channel; filter by channel with **MIDI In** in the Settings menu. Whether the
effects chain shapes live input depends on the route:

| Route | Effects on external input |
|---|---|
| Schwung | Full chain |
| External | Full chain, out USB-A |
| Move | Bypassed (it would loop back) |

On an **External** track, everything goes out USB-A — the sequence, live pads,
effects, and automation. Transport Stop sends note-offs; **Delete + Play** while
stopped sends a MIDI panic on every channel.

## 13.3 Editing an instrument in place

You can edit a track's instrument — a Move instrument or a Schwung chain — without
leaving dAVEBOx. The screen, jog, and knobs hand off to the editor while playback
continues.

Open it with **Shift + Step 3**, or from **Edit Synth… / Edit Slot…** in the
Settings menu. Inside, the jog navigates, the knobs drive chain parameters, and a blinking
**Step 3** exits. **Mute** changes hands: it mutes the Move instrument you're on,
or bypasses a Schwung chain slot (Mute + jog-click). *Requires Schwung 0.9.18 or
later.*

## 13.4 Clock Follow

By default dAVEBOx runs its own clock. Set **Clock Follow → Move** in the Settings
menu and it locks to Move's transport instead — dAVEBOx becomes the sequencer while
Move supplies clock, transport, and voices.

- **Tempo comes from Move.** BPM shows `Move` and is read-only; Tap Tempo is off.
- **Play drives Move.** dAVEBOx's Play starts and stops Move's transport, and both
  launch from the same downbeat; pressing Move's Play works too.
- **Recording** starts Move and counts one bar on its clock before it records.
- If Move's clock stops, so does dAVEBOx — though held arpeggios and synced delay
  keep running at Move's tempo.

This assumes Move's own sequencer is empty on the tracks dAVEBOx feeds. Leave Clock
Follow **Off** for the normal internal clock.

## 13.5 Clock Out

**Clock Out → On** sends MIDI clock and start/stop out the USB-A port, so external
gear locks to dAVEBOx. It applies while free-running; when Clock Follow = Move it is
suppressed and shows `—` (Move's own clock out drives external gear instead).
*Requires Schwung 0.9.16 or later.*

---

# 14. Bake, Merge & Export

## 14.1 Bake

**Bake** (the **Sample** button) renders a clip's effects — NOTE FX, HARMONY,
DELAY, SEQ ARP — into plain notes, then resets those effects. The clip plays the
same, now with a clean effects chain to build on.

- **A melodic clip** (Track View): tap **Sample**, then choose the loop count (1× /
  2× / 4×) and whether to wrap the delay tails for a seamless loop.
- **A drum clip** adds a first choice — the whole clip, or just the selected lane.
- **A scene** (Session View): tap **Sample**, pick a row (or **Sample + scene
  launcher**), then the same choices. Empty clips are skipped.

If a [Conductor](#7-the-conductor) is active, an **Apply Conductor?** step can fold
its transposition into each responding clip.

## 14.2 Live Merge

**Live Merge** records the actual output of your tracks — arps, delays, knob rides
and all — into plain clips.

Arm it with **Shift + Record** from a stopped transport; a notice reads "Rec to
start, Back to cancel." Press **Record** to begin. It plays a 1-bar count-in, then
captures a clean take from the top. The view you arm from sets the scope:

- **Session View** — all 8 tracks, committed to a scene row you pick.
- **Track View** — the active track alone; when you stop, the empty clips on that
  track blink, and you tap one to save the take.

Press **Record** again to stop (or it stops at the 256-step limit). Then tap a
destination to place the take.

## 14.3 Export to Live

**Settings menu → Export to Ableton** writes an `.ablbundle` that desktop Live opens
directly (transport stopped). It lands at
`/data/UserData/schwung/davebox-exports/` (retrieve over SFTP) as **8 MIDI tracks ×
16 scene slots** with tempo and key.

- **Move-routed tracks** export the real Move instrument, preset, and color;
  Schwung and External tracks get a placeholder.
- **Notes are baked** — each clip exports what you hear, effects rendered, delay
  tails wrapped, drum polymeters flattened, and randomized clips written as several
  loops of variation.
- An **Apply Conductor?** step works as it does for [bake](#141-bake), and never
  changes your live set.

The bundle carries its own samples. Requires **Live 12.1+** for Move Drum Racks;
export is one-way.

---

# 15. Settings & Sets

Open the Settings menu with **Shift + Note/Session**. It holds the active track's
settings and the session-wide settings.

## 15.1 Global settings

| Setting | Values | Default |
|---|---|---|
| Clock Follow | Off, Move | Off |
| Clock Out | Off, On | Off |
| BPM | 40–250 | 120 |
| Tap Tempo | tap the pads | — |
| Key | C…B | C |
| Scale | Major … Diminished | Major |
| Scale Aware | On, Off | On |
| Launch Quant | Now … 1 bar | Now |
| Swing Amt | 50–75 % | 50 % |
| Swing Res | 1/16, 1/8 | 1/16 |
| MIDI In | All, 1–16 | All |
| Metro | Off, Cnt-In, Play, Always | Off |
| Metro Vol | 0–150 % | 100 % |
| Beat Markers | On, Off | On |
| Export to Ableton | action | — |
| Save state / Load state | action | — |
| Clear Session | action | — |
| Quit | action | — |

**Scales:** Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic
Minor, Melodic Minor, Pentatonic Major, Pentatonic Minor, Blues, Whole Tone,
Diminished.

## 15.2 Key & Scale

Editing **Key** or **Scale** moves your melodic clips with it. As you turn, the
pads rearrange and, while playing, you hear a live preview. **Click to commit**: if
any melodic clip holds notes, a **Transpose clips?** step asks first (yes moves the
notes; no applies the new key/scale and leaves the notes put). Backing out cancels.
Key moves by the shortest distance; Scale remaps by scale degree between scales of
the same size, otherwise to the nearest in-scale note. Drum tracks are untouched. A
committed transpose can't be undone — check the preview before you confirm.

## 15.3 Snapshots

dAVEBOx auto-saves whenever you suspend or exit — there is no manual save. For
named backups, **Save state** keeps up to **16 snapshots** per set, each stamped
with the date and time; **Load state** restores one. Snapshots belong to the set
and survive **Clear Session**.

## 15.4 Track settings

The top of the menu, for the active track. Entries that don't apply to the track's
type or route are hidden.

| Setting | Values | Notes |
|---|---|---|
| Channel | 1–16 | MIDI channel |
| Route | Move, Schwung, External | Where its MIDI goes |
| Mode | Keys, Drums, Conduct | [Track type](#41-track-type) |
| Layout | Scale, Chrom | Melodic pad layout |
| VelIn | Live, 1–127 | Fixed value overrides input velocity |
| Looper | On, Off | Feeds [Performance Mode](#12-performance-mode) |
| AftTch | Off, Poly, Channel | Pad-pressure aftertouch (melodic) |
| Edit Synth… / Edit Slot… | action | [Edit the instrument in place](#133-editing-an-instrument-in-place) |

## 15.5 Sets & compatibility

<img src="img/dialog-confirm.png" width="384" alt="Incompatible State confirm dialog with No and Yes buttons">

dAVEBOx stores its data inside the Move set. Duplicating a set inherits it;
deleting a set removes it on the next launch. Loading a set saved by an **older
dAVEBOx** shows an **Incompatible State** dialog — **No** (default) exits with the
old file kept, **Yes** erases it and starts clean.

**Saved per set:** all notes, effects, automation, and timing; each track's
settings; the global settings; mute/solo state and all snapshots; Performance Mode
presets; and Note Repeat masks and rates.

---

# 16. The Browser Editor

With dAVEBOx loaded, open the Schwung web manager (`http://move.local:7700`) →
**Remote UI → Tool tab** for a full clip editor in the browser. It mirrors the
device both ways — edits on either side show up on the other.

- **Session grid:** click a clip to launch it (Alt/Shift-click views it without
  launching); drag to move (Alt-drag copies); a clip's **≡ menu** duplicates,
  copies, cuts, pastes, or deletes. Track headers mute (click), solo
  (right-click), and set route/channel (**☰**).
- **Piano roll:** the **Draw** tool adds and drags notes on the toolbar **Snap**;
  right-click or **Erase** deletes; **Select** marquee-edits a group. On drum
  tracks, drag a hit vertically between lanes. The **step band** sets per-step
  conditions, and the velocity and automation lanes edit below.
- **Transport:** the header runs the device's transport on a synced clock, so the
  playhead stays smooth over WiFi; a **sync** button forces a re-read if the two
  drift apart.

---

# 17. Quick Reference

### Track View

| Control | Action |
|---|---|
| Pad | Play a note |
| Pads + step / step + pads | Chord entry |
| Step tap / hold | Toggle / edit |
| +/− / Left-Right | Octave / page |
| Side buttons | Switch clips |
| Jog turn / click | Cycle banks / alt-parameters |
| Shift + jog / Shift + bottom pad | Switch tracks |
| Loop (hold) / Loop + jog | Loop view / clip length |
| Play / Shift + Play / Loop + Play | Start-stop / restart / restart at page |
| Record / Shift + Record | Record / Live Merge |
| Capture / Shift + Capture | Keep / clear buffered play |
| Sample | Bake |
| Mute / Shift + Mute / Delete + Mute | Mute / solo / clear all |
| Delete + step / side | Clear step / clip |
| Shift + Delete + side / jog click | Reset clip / effects |
| Delete + jog click | Reset bank |
| Delete + Play | Deactivate clips (running) · panic (stopped) |
| Undo / Shift + Undo | Undo / redo |
| Note/Session (tap / hold) | Switch / peek view |
| Shift + Note/Session | Settings menu |

### Shift + Step shortcuts

| Step | Action | Views |
|---|---|---|
| 2 | Settings menu (globals) | Both |
| 3 | Edit the instrument in place | Track |
| 5 | Tap Tempo | Both |
| 6 | Metro (Cnt-In ↔ Always) | Both |
| 7 | Swing | Both |
| 8 | Chromatic layout / cycle right-pad mode | Track |
| 9 | Scale | Both |
| 10 | VelIn (Live ↔ 100) | Track |
| 11 | LIVE ARP on/off | Track (melodic) |
| 15 | Double-and-fill loop | Track |
| 16 | Quantize 100 % | Track |

### Session View

| Control | Action |
|---|---|
| Clip / empty clip | Launch · queue / focus for recording |
| Shift + clip | Open in Track View |
| Scene launcher / steps 1–16 | Launch scene |
| Shift + scene launcher | Launch at next bar |
| Jog / +/− | Scroll rows (1 / 4) |
| Mute + clip / Shift + Mute + clip | Mute / solo track |
| Mute (hold) + step | Save · recall mute snapshot |
| Copy + clip / scene launcher | Copy clip / row |
| Capture + scene launcher | Snapshot to row |
| Sample + scene launcher | Bake row |
| Delete + clip / scene launcher | Delete clip / clear row |
| Loop (tap / hold) | Lock / hold Performance Mode |

### Drum track (additions)

| Control | Action |
|---|---|
| Lane pad | Trigger + select lane |
| +/− | Lane bank A ↔ B |
| Shift + Step 8 | Cycle velocity / Rpt1 / Rpt2 |
| Loop + jog / lane pad | Lane length / latch repeat |
| Copy + lane · Mute + lane | Copy · mute lane |

### LED & screen states

**Clip pads / side buttons** — off = empty; dim track color = holds notes; solid =
focused; flashing = playing (1/8) or queued (1/16).

**Step buttons** — Track View: white = playhead, track color = filled step, dim =
beat markers. Session View: red = rows in view, white = out-of-view content.

**Knob LEDs** — lit when a parameter is off default. On the [AUTO bank](#10-automation),
white = resting value, yellow = has automation, red = recording, green = playback.

**Screen header** — the active track's number sits inside a box; a muted track's
number blinks, and a soloed track's number shows filled in. The bank strip on the
right shows where you are among the track's banks.

### Limitations

- External MIDI on a Move-routed track skips the effects chain (it would loop) —
  route to Schwung for effects on external input.
- No per-track volume; set level on the instrument.
- Automation lanes are not swung, by design.
