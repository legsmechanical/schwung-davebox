<!-- DRAFT-BANNER-START -->
> ⚠️ **WORKING DRAFT — for the next release.** Edit *this* file (`MANUAL.draft.md`) for every user-facing change as it lands. The **released** manual is `MANUAL.md` — do **not** edit it directly; `scripts/cut_release.sh` promotes this draft into `MANUAL.md` (banner stripped) at release time. Tracked for history/backup, but it is not the published manual until a release.
<!-- DRAFT-BANNER-END -->

# The dAVEBOx Manual

**dAVEBOx** is an 8-track MIDI sequencer for the Ableton Move. It runs as a tool
module inside [Schwung](https://github.com/charlesvestal/schwung) and takes over
Move's pads, knobs, and screen while it's open.

dAVEBOx makes **no sound of its own**. Every note it plays is sent as MIDI to a
sound source — one of Move's built-in instruments, a Schwung effect chain, or an
external synth on the USB-A port. Think of it as the brain that drives the
voices Move and Schwung already give you.

If you've used Move's own sequencer, much of dAVEBOx will feel familiar: a clip
grid, step buttons, scenes, Capture, note repeat, mute and solo. Throughout this
manual, a **Like Move** note points out where a feature mirrors something you
already know.

> 🚀 **New here?** Start with the [**Quick Start guide**](QUICKSTART.md) — six
> short lessons that get you from a blank set to a looping pattern in about
> fifteen minutes. Come back to this manual when you want the full detail.

---

## Table of Contents

**Part I · Getting Started**
1. [What dAVEBOx Is](#1-what-davebox-is)
2. [First-Time Setup](#2-first-time-setup)
3. [Controls & Navigation](#3-controls--navigation)

**Part II · Building Patterns**
4. [Tracks, Clips & Scenes](#4-tracks-clips--scenes)
5. [Notes & Steps](#5-notes--steps)
6. [Drum Tracks](#6-drum-tracks)
7. [Conductor Tracks](#7-conductor-tracks)
8. [Recording](#8-recording)

**Part III · Shaping Sound**
9. [Working with Parameter Banks](#9-working-with-parameter-banks)
10. [Clip & Timing Banks](#10-clip--timing-banks)
11. [Effects Banks](#11-effects-banks)
12. [Automation](#12-automation)

**Part IV · Performing & Arranging**
13. [Session View & Scenes](#13-session-view--scenes)
14. [Performance Mode](#14-performance-mode)
15. [Mixing: Mute, Solo & Volume](#15-mixing-mute-solo--volume)

**Part V · Sound Sources & Output**
16. [Sound Sources & Editing In Place](#16-sound-sources--editing-in-place)
17. [Routing, Clock & Sync](#17-routing-clock--sync)
18. [Bake, Live Merge & Export](#18-bake-live-merge--export)

**Part VI · Reference**
19. [Global Menu & Saving](#19-global-menu--saving)
20. [The Remote UI](#20-the-remote-ui)
21. [Cheat Sheet](#21-cheat-sheet)
22. [Parameter Reference](#22-parameter-reference)
23. [Screen & LED Reference](#23-screen--led-reference)

---

# Part I · Getting Started

# 1. What dAVEBOx Is

dAVEBOx is a standalone MIDI sequencer with:

- **8 tracks**, each holding **16 clips**
- **Clips up to 256 steps** long, each with its own notes *and* its own effects
- **Three track types** — Melodic, Drum, and Conductor
- **Scenes** — a row of clips across all 8 tracks, launched together

Because it produces no audio, dAVEBOx's whole job is to send well-shaped MIDI to
a sound source. Each track points at one of three destinations:

| Route | Sends notes to |
|---|---|
| **Move** | A native Move instrument |
| **Schwung** | A Schwung effect chain |
| **External** | A synth on Move's USB-A port |

Out of the box, tracks 1–4 play Move instruments and tracks 5–8 play Schwung
chains — see [First-Time Setup](#2-first-time-setup). You can change any track's
route and channel later in [Track Config](#191-track-config).

## The mental model

Three words describe everything dAVEBOx does:

- A **clip** is a pattern of notes plus the effects that shape it. Clips play one
  at a time on their track.
- A **track** is a lane of 16 clips pointed at one sound source.
- A **scene** is one clip from every track, launched as a set.

Two screens let you work at either scale: **Track View** to build one clip in
detail, and **Session View** to launch and arrange clips across all tracks. You
switch between them with one button.

---

# 2. First-Time Setup

dAVEBOx reaches its sound sources over MIDI channels, so Move and Schwung each
need to listen on the right channel. **You only do this once.**

**On Move** — set tracks 1–4 to receive on channels 1–4, and turn each track's
MIDI **Out** off (this prevents echo loops):

| Move track | MIDI In | MIDI Out |
|---|---|---|
| 1 | Ch 1 | Off |
| 2 | Ch 2 | Off |
| 3 | Ch 3 | Off |
| 4 | Ch 4 | Off |

**In Schwung** — set slots 1–4 to receive on channels 5–8, with each slot's
Forward Channel set to **Auto** (not Thru):

| Schwung slot | Receive channel |
|---|---|
| 1 | Ch 5 |
| 2 | Ch 6 |
| 3 | Ch 7 |
| 4 | Ch 8 |

That gives the default routing: **tracks 1–4 → Move instruments**, **tracks 5–8 →
Schwung chains**.

**To open dAVEBOx:** load a Move set, then launch dAVEBOx from Schwung's tool
menu (**Shift + Step 13**, the star). For a guided first session, follow the
[Quick Start guide](QUICKSTART.md).

---

# 3. Controls & Navigation

## 3.1 The hardware

While dAVEBOx is open, Move's controls map like this:

```
   ┌─────────────────────────────────────────┐
   │              OLED display               │   Volume
   └─────────────────────────────────────────┘

  Jog     K1   K2   K3   K4   K5   K6   K7   K8      ← eight knobs

       ┌──┐   ┌──┬──┬──┬──┬──┬──┬──┬──┐
       │  │   │  │  │  │  │  │  │  │  │   top row
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │  │   │  │  │  │  │  │  │  │  │
     4 side   ├──┼──┼──┼──┼──┼──┼──┼──┤   4×8 pad grid
     buttons  │  │  │  │  │  │  │  │  │
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │  │   │  │  │  │  │  │  │  │  │   bottom row
       └──┘   └──┴──┴──┴──┴──┴──┴──┴──┘

            [ 1][ 2][ 3][ 4] … [13][14][15][16]   ← 16 step buttons
```

| Control | What it is |
|---|---|
| **Knobs (K1–K8)** | The eight knobs above the grid. Adjust whatever the active parameter bank shows. |
| **Jog** | The clickable encoder at the left. *Turn* to cycle banks or scroll; *click* to enter/confirm; *touch* to reveal a screen. |
| **Volume** | The top-right encoder. Master output only, handed to Move. |
| **Pad grid** | 4 rows × 8 columns. Plays notes, triggers drum lanes, or shows the clip grid. |
| **Side buttons** | The four buttons left of the grid. Switch clips on the active track. |
| **Step buttons (1–16)** | The row below the grid. Hold a clip's step pattern, or launch scenes. |

The **named buttons** — Play, Record, Loop, Mute, Delete, Copy, Capture, Sample,
Undo, Note/Session, Shift, and the arrow keys — drive transport and act as
*modifiers* when held with another control. A held combination is written
"**Modifier + X**" (for example, **Shift + Note/Session**).

## 3.2 Transport & modifier buttons

| Button | On its own | Held as a modifier |
|---|---|---|
| **Play** | Start / stop the transport | — |
| **Record** | Start / stop live recording | **Shift + Record** = [Live Merge](#182-live-merge) |
| **Loop** | Track View: hold for [loop view](#54-clip-length--the-loop-window). Session View: [Performance Mode](#14-performance-mode) | Combines with jog, steps, and pads |
| **Mute** | [Mute](#15-mixing-mute-solo--volume) the active track or lane | Mute + pad / step / Play |
| **Delete** | Open a clear action (context-dependent) | Delete + step / clip / lane / jog |
| **Copy** | — | Copy + step / clip / lane / scene |
| **Capture** | Keep what you just played — [retrospective recording](#82-capture) | Capture + scene = snapshot to a row |
| **Sample** | [Bake](#181-bake) a clip's effects into notes | Sample + scene = bake that row |
| **Undo** | Undo the last edit | **Shift + Undo** = redo |
| **Note/Session** | Switch views (tap) or peek (hold) | **Shift + Note/Session** = [Global Menu](#34-the-global-menu) |
| **Shift** | — | The primary modifier |

> **Like Move:** Play, Record, Undo, mute/solo, Capture, and note repeat all
> behave the way their Move counterparts do — the muscle memory carries over.

## 3.3 The two views

You switch between the two views by tapping **Note/Session**. Hold it to *peek*
at the other view without leaving the one you're in.

| | Track View | Session View |
|---|---|---|
| **Purpose** | Build one clip in detail | Launch and arrange clips |
| **Pads** | Play notes / drum lanes | The clip grid |
| **Step buttons** | The clip's step pattern | Scene launchers |
| **Jog turn** | Cycle parameter banks | Scroll scene rows |

### Switching the active track

There are no dedicated track buttons. Change the active track with any of:

| Gesture | Works in |
|---|---|
| **Shift + jog turn** | Both views |
| **Shift + bottom-row pad (1–8)** | Track View |
| **Tap any pad in a column** | Session View |

The screen draws a box around the active track number (1–8).

## 3.4 The Global Menu

**Shift + Note/Session** opens the Global Menu. Turn the jog to move through
items, click to edit, turn to change the value, and click to confirm.
Note/Session closes it. Pads, steps, and transport keep working while it's open.

The menu opens on the active track's settings (**Track Config**), followed by
the global settings below a divider. The full list is in
[Global Menu & Saving](#19-global-menu--saving).

Several settings have a **step-button shortcut** that jumps straight to them —
see the [Cheat Sheet](#21-cheat-sheet).

## 3.5 Backing out & suspending

A tap of **Back** steps out one level. In order of priority, it:

1. Cancels an open dialog or picker
2. Closes the Global Menu
3. Exits a locked [Performance Mode](#14-performance-mode)
4. In Track View, drops out of a bank's secondary view, then returns to the
   track's home bank

The **Back LED** lights whenever a tap will back out of something, so you can see
at a glance when there's a level to leave.

To leave dAVEBOx:

| Action | Result |
|---|---|
| **Hold Back** (~½ s) | Suspend — dAVEBOx keeps running in the background, and saves |
| **Shift + Back** | Fully exit to Schwung, and save |
| **Global Menu → Quit** | Save and exit |

dAVEBOx saves automatically on all three, so you rarely need to think about it.
For named backups, use [Save state](#194-snapshots).

## 3.6 Reading the screen

The OLED shows the active parameter bank as a 2×4 grid of knob widgets, each
with its label beneath it:

- **Touch** a knob (without turning) to highlight it — the header shows its full
  name and the label strip shows its live value.
- **Turn** a knob to pop up a large read-out of just that value (or a scrolling
  picker for option parameters). The pop-up holds until you release.
- The **LED under each knob** lights when that parameter is set away from its
  default.

The bank display falls back to a track overview after about a second of
inactivity. **Touch the jog** at any time to bring the current bank's display
back; it stays up while you hold. Full screen details are in the
[Screen & LED Reference](#23-screen--led-reference).

---

# Part II · Building Patterns

# 4. Tracks, Clips & Scenes

dAVEBOx has **8 tracks**. Each track holds **16 clips**, and each clip stores its
own notes plus its own effects. A **scene** is one clip from each of the 8 tracks.

- **Launching a clip** replaces whatever was playing *on that track only*.
- **Launching a scene** swaps every track at once.
- **Empty cells in a scene** leave their track alone — it keeps playing what it had.

> **Like Move:** the clip-and-scene model is the same idea as Move's session grid
> (and Ableton Live's) — columns are tracks, rows are scenes.

## 4.1 Track types

Every track is one of three types, set by **Mode** in
[Track Config](#191-track-config):

| Type | Menu label | What it does |
|---|---|---|
| **Melodic** | `Keys` | Plays pitched, scale-snapped notes — see [Notes & Steps](#5-notes--steps) |
| **Drum** | `Drums` | 32 independent drum lanes — see [Drum Tracks](#6-drum-tracks) |
| **Conductor** | `Conduct` | Transposes the *other* melodic tracks live — see [Conductor Tracks](#7-conductor-tracks) |

Melodic and Drum tracks differ in a few key ways:

| | Melodic | Drum |
|---|---|---|
| Pads | Play scale-snapped notes | Left half = drum lanes; right half = functions |
| Pattern | One per clip | One per lane, within each clip |
| Independent lane loops | No | Yes (polyrhythm) |
| Banks | CLIP · NOTE FX · HARMONY · DELAY · SEQ ARP · LIVE ARP · AUTO | DRUM LANE · NOTE FX · DELAY · ALL LANES · REPEAT GROOVE · AUTO |

## 4.2 Switching a track's type

Changing **Mode** carries your sequenced notes (pitch, length, iteration,
probability) across all 16 clips into the new type. Only notes move — **effects,
arpeggiators, and automation reset to defaults.**

The Mode setting previews as you scroll: turning the jog only shows the candidate
type, and **clicking commits it.**

- **Melodic ↔ Drum** asks you to confirm when the track has notes (drum settings
  have no melodic equivalent). Empty tracks switch instantly.
- **To or from Conductor** keeps your notes but is **blocked during playback** —
  stop first. Only one Conductor can exist at a time.

## 4.3 Working with clips

| Gesture | Result |
|---|---|
| **Side buttons** (Track View) | Switch clips on the active track |
| **Tap a clip pad** (Session View) | Launch or queue that clip |
| **Tap an empty clip pad** | Focus it for recording |
| **Left / Right** (Track View) | Move between [pages](#54-clip-length--the-loop-window) of a long clip |

Switching to a track auto-launches its focused clip **only if that clip is
empty.** A focused clip that already holds notes stays silent until you launch
it, so you can move between tracks freely without triggering them.

Copying, clearing, and moving clips are covered in
[Mixing & editing](#15-mixing-mute-solo--volume) and, for the browser, the
[Remote UI](#20-the-remote-ui).

---

# 5. Notes & Steps

This chapter covers melodic tracks. Drum entry is in [Drum Tracks](#6-drum-tracks).

## 5.1 Playing and laying down notes

The pads play scale-snapped notes; **Up / Down** shifts the pad octave (−4 to
+4). To build a pattern, use the **16 step buttons**:

| Action | Result |
|---|---|
| Tap an empty step | Adds the last note you played, at velocity 100 |
| Tap an active step | Clears it |
| Hold a step (~200 ms) | Opens [step edit](#53-editing-a-step) |
| Hold an empty step | Adds *and* opens step edit in one move |
| Tap several steps at once | Toggles each |

Steps beyond the clip's length are dimmed.

> **Like Move:** placing notes on the 16 steps is the same step-sequencing gesture
> as Move's note mode.

**Pad layout.** The default **In-Key** layout shows only scale notes, with the
root lit in the track color. **Shift + Step 8** switches to **Chromatic** — all
12 semitones, with in-scale notes highlighted. (You can also set this from the
**Layout** entry in [Track Config](#191-track-config).)

## 5.2 Chords

Up to **four notes per step**, entered two ways:

- **Pad-first:** hold one or more pads, then press a step.
- **Step-first:** hold a step, then tap pads one at a time (tap a held note again
  to remove it).

## 5.3 Editing a step

<img src="img/step-editor.png" width="384" alt="Step edit overlay: a Note box on the left, then Length, Velocity, Nudge, and trig-condition knobs">

Hold any step to open the edit overlay. Edits apply to **all notes in the step**
at once; hold several steps to edit them together. While holding, **Up / Down**
shifts the octave range so you can reach higher or lower notes.

| Knob | Label | Function |
|---|---|---|
| K1 | `Note` | Shift pitch by scale degree |
| K2 | `Oct` | Shift by octave |
| K3 | `Leng` | Gate length |
| K4 | `Vel` | Velocity |
| K5 | `Nudg` | Nudge timing (±1 step) |
| K6 | `Iter` | [Iteration](#trig-conditions) |
| K7 | `Prob` | [Probability](#trig-conditions) |
| K8 | `Ratch` | [Ratchet](#trig-conditions) |

**On drum tracks,** a step has no pitch, so the two pitch knobs drop out: `Leng`,
`Vel`, and `Nudg` move to K1–K3, and `Iter` / `Prob` / `Ratch` sit on K5–K7. The
exact drum mapping is in the [Parameter Reference](#step-edit).

### Trig conditions

Three per-step conditions reshape *when and how* a step fires. All default to
`--` (off).

- **Iteration** (`Iter`) plays the step only on certain loop cycles. `2/3` means
  "play on cycle 2 of every 3." The cycle counter resets only on a cold start
  (Stop → Play).
- **Probability** (`Prob`) gives the step a play chance, from 100 % down to 1 %.
  The roll is *per note*, so chords thin out naturally.
- **Ratchet** (`Ratch`) retriggers the step 2, 3, or 4 times within its slot,
  evenly spaced.

They combine in order: Iteration decides whether the step fires at all;
Probability rolls per note; a note that passes plays all its ratchet hits.

> **Like Move:** iteration, probability, and ratchets work like Move's per-step
> "chance" and repeat conditions.

## 5.4 Clip length & the loop window

Clips can run up to **256 steps**, spanning multiple **pages** of 16.
**Left / Right** moves between pages.

Hold **Loop** to enter **loop view**, where the step buttons represent pages:

- **Track color** = page is inside the loop (pulsing if it contains notes)
- **Off** = outside the loop

While Loop is held:

| Gesture | Result |
|---|---|
| Jog ±1 | Grow or shrink the loop from the end |
| Tap a page | Loop runs from page 1 through that page |
| Hold one page + tap another | Loop runs between the two |
| Loop + jog (no loop view) | Adjust clip length ±1 step |

Notes outside the window are kept — they return if you expand it again.

## 5.5 Undo

**Undo** reverts the last edit (one level); **Shift + Undo** redoes. It covers
step, clip, and lane clears; copy/cut/paste; hard resets; live recording; bank
resets; loop-double; bake; legato; scene operations; and automation clears.

> **Like Move:** Undo / redo works as you'd expect from Move.

---

# 6. Drum Tracks

On a drum track, each sound has its own **lane** — a separate step pattern with
its own length, timing, and effects. A track has **32 lanes**, each mapped to a
MIDI note that triggers one sound in the destination instrument.

The pad grid splits in two:

| Half | Contents |
|---|---|
| **Left 4×4** | 16 drum-lane pads. Tap one to hear its sound and select it — the step buttons then show that lane's pattern. |
| **Right 4×4** | A function area: velocity zones (default), or a note-repeat mode |

The left pads show 16 lanes at a time. **Up / Down** switches between lane **bank
A** and **bank B** for the full 32; the screen shows which is active.

> **Like Move:** the 4×4 drum layout and its velocity zones mirror Move's drum
> track and pad velocity.

## 6.1 Sequencing hits

Tap a lane pad to select it, then tap **steps 1–16** to place or remove hits. The
step buttons always show the selected lane's pattern.

**Velocity zones** (the right 4×4 by default) set the velocity for the next hits
you place — 16 zones from 8 (bottom-left) to 127 (top-right). Zones override the
track's VelIn setting.

**To change a lane's sound,** open the [NOTE FX bank](#111-note-fx): K1 shifts the
lane's MIDI note by an octave, K2 by a semitone. The screen shows the note name
and number (e.g. `Pad: C1 (36)`).

## 6.2 Per-lane loops (polyrhythm)

Each lane has its own loop length, set with **Loop + jog** on the selected lane.
A kick at 16 steps, a hat at 12, and a percussion lane at 10 each cycle
independently against the shared transport.

## 6.3 Note Repeat

Note Repeat retriggers drum lanes at a rhythmic rate. Cycle the right pads
between velocity zones and the two repeat modes with **Shift + Step 8**.

> **Like Move:** this is dAVEBOx's take on Move's Note Repeat.

**The rate pads** (right 4×4, bottom two rows) choose the rate; the top two rows
are the **gate mask**:

```
   top row     [ Gate 0 ][ Gate 1 ][ Gate 2 ][ Gate 3 ]   gate mask
               [ Gate 4 ][ Gate 5 ][ Gate 6 ][ Gate 7 ]   (8-step loop)
               [ 1/32T  ][ 1/16T  ][ 1/8T   ][ 1/4T   ]   triplet rates
   bottom row  [ 1/32   ][ 1/16   ][ 1/8    ][ 1/4    ]   straight rates
```

**Two modes:**

- **Rpt1 (single-lane):** hold a rate pad to repeat the *selected* lane at that
  rate. Velocity follows pad pressure. Switch lanes without interrupting.
- **Rpt2 (multi-lane):** tap a rate pad to assign it to the selected lane
  (default 1/8), then hold a lane pad to repeat it at its rate. Hold several for
  simultaneous repeats.

**Latching** frees your hands — the repeat keeps going after you let go:

| Mode | Latch | Stop |
|---|---|---|
| Rpt1 | Loop + rate pad, or hold repeat + tap Loop | Press the active rate, or Delete + Loop |
| Rpt2 | Loop + lane pad (or hold lanes + Loop for all held) | Tap a latched lane to release it; Delete + Loop stops all |

Tapping **Loop** alone (no pads held) releases all latches on the track. Latched
lanes stay lit cyan; transport Stop clears every latch; muting silences but keeps
the latch.

**The gate mask** (top two rows, 8 pads) is a looping on/off pattern applied to
the repeats — all on by default, tap to toggle. **Loop + a gate pad** sets the
cycle length (1–8). Fine velocity and timing per gate step live in the
[REPEAT GROOVE bank](#104-repeat-groove).

## 6.4 Copy & mute on drum tracks

- **Copy + lane pad**, then tap another lane to paste (the destination keeps its
  own MIDI note). **Shift + Copy** cuts.
- **Mute + lane pad** mutes a lane; **Shift + Mute + lane pad** solos it.

---

# 7. Conductor Tracks

A **Conductor** transposes every *playing* melodic clip up or down in real time,
following the note it's currently playing. It sends no MIDI itself — its
sequencer and live pads only steer the transposition. The written notes never
change; the shift is live and reversible. **Only one Conductor can exist at a
time.**

This lets one track "conduct" a key change or chord move across your whole
arrangement — sequence a progression on the Conductor and every responding track
follows.

## 7.1 Creating one

In [Track Config](#191-track-config), set **Mode** to `Conduct`.

- Converting keeps your notes but resets effects, arps, and automation.
- It's **blocked during playback** — stop first.
- A second Conductor is refused (`Conductor exists on T_n_`) — convert the first
  back to `Keys`.
- A Conductor keeps its color. Its **Channel and Route are inert** (shown `-`).
  **Mute** pauses conducting (responders snap back to written pitch); **Solo** is
  disabled.

## 7.2 How the shift works

Zero transposition is the **session root at octave 4** — the default pad note.
Play that and nothing shifts. Play higher and responders rise; play lower and
they fall. The Conductor's pad octave scales the move (an octave up = an octave
of transposition).

The shift follows the global **Scale Aware** setting: scale-aware moves
responders by scale *degrees* (staying in key); otherwise by *semitones*. An
empty Conductor step, or a muted Conductor, means zero shift. Drum tracks never
respond. Conductor steps still honor Iteration and Probability
[trig conditions](#trig-conditions).

## 7.3 The five Conductor banks

<img src="img/bank-conductor-octave.png" width="384" alt="C-OCTAVE bank: a per-track octave value for each of the 8 tracks">

A Conductor's jog cycles exactly five banks — no effects, arp, or automation.
Their headers carry a **`C-`** prefix so you always know you're on the Conductor.

| Bank | What it controls |
|---|---|
| **Conduct** | The Conductor's own timing/direction (like the melodic [CLIP bank](#101-clip)), plus **Cond Lock** (`CdLk`, K6). *Off* = the transpose lasts only the note's gate, snapping to zero in the gaps. *Lock* = the transpose holds through gaps until the next Conductor note. |
| **NoteFX** | Shapes the Conductor's own note before the shift is computed: **Octave**, **Offset**, and **Random** (with a mode chooser via jog-click). Octave/Offset shift all responders; Random jitters the whole transposition per note. |
| **Responder** | One on/off cell per track (`Tr1…Tr8`) — on = follows the Conductor. Default on. The Conductor's own cell reads `Cndc`; drum tracks read `--`. |
| **Octave** | One cell per track, **−4…+4**, added on top of the Conductor's shift while it sounds. |
| **When** | One cell per track: **Next** (a responder takes the new shift at its next note-on) or **Now** (a sounding note is cut and retriggered immediately at the new pitch). Mix freely across tracks. |

All five banks store their settings per Conductor clip.

## 7.4 Making it permanent

The Conductor can be folded into responder clips at [scene bake](#181-bake) time
or applied at [Ableton export](#183-export-to-ableton-live) — both via an "Apply
Conductor?" prompt. The Conductor track itself has no bake action and exports as
a silent placeholder.

---

# 8. Recording

There are two ways to turn playing into clip data: **live recording** (arm, then
play) and **Capture** (play first, keep it after).

## 8.1 Live recording

Press **Record** to capture pad input into the active clip.

| Starting from | Behavior |
|---|---|
| Stopped | 1-bar count-in, then recording and transport start together |
| Playing, fixed-length clip | Records immediately at the current position |
| Playing, empty clip | Arms and starts at the next bar (Record blinks until then) |

Recording is always **additive** — existing notes are never erased. For a clean
take, clear the clip first (**Delete + side button**); that also resets its
length so the new take grows to fit what you play.

- **Stop recording:** Record again (transport continues) or Play (stops transport).
- **Count-in pre-roll:** notes played in the last half-beat of the count-in land
  on step 1.
- Switching tracks mid-recording is free — recording follows the focused track.

> Live recording only runs in **Forward** [playback direction](#101-clip). A
> reversed or ping-pong clip offers to bake itself to Forward first.

> **Like Move:** arming Record for a count-in and an overdub take is the familiar
> Move recording flow.

## 8.2 Capture

<a id="capture"></a>
dAVEBOx is **always listening.** Everything you play on the pads (and every
effect-knob move) while a track is *not* record-armed is quietly buffered. Play
something you like but forgot to record? Tap **Capture** and it becomes real clip
data. The Capture LED lights **bright** whenever there's buffered input waiting.

> **Like Move:** this is exactly Move's Capture button — nothing to arm, just
> keep what you already played.

What a tap does depends on the transport:

| Situation | Result |
|---|---|
| **Playing** | Overdubs the buffered notes into the focused clip, exactly where you heard them. Knob moves land as automation. Clip length is unchanged. |
| **Stopped, brand-new session** | Treats your first note as the take's start: estimates the tempo, sizes the clip to whole bars, and starts playback so you hear it. |
| **Stopped, session already has clips** | Fits the take to the existing tempo. A screen opens where the jog picks how many bars it fills. |

After a stopped capture into a new session, a **tempo chooser** opens — the
detected BPM plus a few candidates, over a strip showing your take against the
bar grid. Turn the jog to audition (playback keeps rolling) and click to keep one.

Capture works on melodic and drum tracks alike. To throw the buffer away, hold
**Shift** and tap **Capture**.

---

# Part III · Shaping Sound

# 9. Working with Parameter Banks

In Track View, the eight knobs control different things depending on the active
**parameter bank**. Turn the **jog** to cycle banks:

- **Melodic:** CLIP · NOTE FX · HARMONY · DELAY · SEQ ARP · LIVE ARP · AUTO
- **Drum:** DRUM LANE · NOTE FX · DELAY · ALL LANES · REPEAT GROOVE · AUTO

The banks fall into three groups:

| Group | Banks | What they do |
|---|---|---|
| [**Clip & timing**](#10-clip--timing-banks) | CLIP, DRUM LANE, ALL LANES | Reshape the grid and the notes themselves — mostly **permanent** (use Undo) |
| [**Effects**](#11-effects-banks) | NOTE FX, HARMONY, DELAY, SEQ ARP, LIVE ARP | Transform notes at playback — **non-destructive** |
| [**Automation**](#12-automation) | AUTO | Recordable CC / aftertouch lanes |

> **Reading a bank:** touch a knob to see its full name, turn it for a big
> read-out, and watch the LED beneath (lit = away from default). The
> [Parameter Reference](#22-parameter-reference) lists every value.

## Alt-parameters

Some knobs have a second function, marked **Alt** below. **Click the jog** to flip
a bank to its alt functions — the labels change and a down-arrow blinks in the
header. Click again, change banks, or change tracks to return to the primary set.

## Resetting

| Gesture | Result |
|---|---|
| **Delete + jog click** | Reset every parameter in the active bank |
| **Shift + Delete + jog click** | Reset all effects across every bank (keeps LIVE ARP) |
| **Shift + Delete + side button** | Hard reset the clip — clears notes *and* all parameters |

---

# 10. Clip & Timing Banks

These banks reshape the step grid and the notes on it. Most of their changes
**directly rewrite your notes** — use **Undo** to revert.

## 10.1 CLIP

<img src="img/bank-clip.png" width="384" alt="CLIP bank: Resolution, Beat Stretch, Clock Shift, Legato, Input Quantize, Direction, Seq Follow">

The melodic clip's grid, direction, and note transforms.

| Knob | Label | Function | Default |
|---|---|---|---|
| K1 | `Res` | **Resolution** — the step grid size. Rescales note positions. *Alt:* **Zoom** (regrid without moving notes). | 1/16 |
| K2 | `Stch` | **Beat Stretch** — each detent doubles (right) or halves (left) the clip. Blocked if notes would collide. | — |
| K3 | `Shft` | **Clock Shift** — rotate all notes by whole steps. *Alt:* **Nudge** (finer, tick resolution). | 0 |
| K4 | `Lgto` | **Legato** — turn right to confirm; rewrites every note to reach the next. | — |
| K5 | `InQ` | **Input Quantize** — snap recorded notes to the grid (per-track). | Off |
| K7 | `Dir` | **Direction** — Forward, Backward, or ping-pong. *Alt:* **Reverse Style** (Step vs Audio). | Fwd |
| K8 | `SqFl` | **Seq Follow** — auto-scroll the step display to the playhead. | On |

**Direction** plays the clip Forward, Backward, or bouncing (ping-pong). Live
recording needs Forward (see [Recording](#81-live-recording)); bake and export
freeze the direction into note positions and reset to Forward.

## 10.2 DRUM LANE

<img src="img/bank-drumlane.png" width="384" alt="DRUM LANE bank: Resolution, Beat Stretch, Clock Shift, Legato, Euclid, Direction, Seq Follow">

The **selected lane's** grid, direction, and note transforms — the drum
counterpart to CLIP.

| Knob | Label | Function | Default |
|---|---|---|---|
| K1 | `Res` | **Resolution.** *Alt:* **Zoom.** | 1/16 |
| K2 | `Stch` | **Beat Stretch.** | — |
| K3 | `Shft` | **Clock Shift.** *Alt:* **Nudge.** | 0 |
| K4 | `Lgto` | **Legato** (per-lane). | — |
| K5 | `Eucl` | **Euclid** — spread N hits evenly across the lane. Hand-placed hits are kept. | 0 |
| K7 | `Dir` | **Direction.** *Alt:* **Reverse Style.** | Fwd |
| K8 | `SqFl` | **Seq Follow.** | On |

Lane length is **Loop + jog**; the lane's MIDI note is on the
[NOTE FX bank](#111-note-fx).

## 10.3 ALL LANES

<img src="img/bank-alllanes.png" width="384" alt="ALL LANES bank: apply Resolution, Stretch, Shift, Quantize, VelIn, Input Quantize, Direction, Repeat Sync to all 32 lanes">

Applies one setting to **all 32 lanes** at once. Because that rewrites every lane,
the bank opens on a **"Edits will affect all lanes. Proceed?"** screen — **click
the jog to confirm.** Until then the knobs, Loop button, and Shift+Step shortcuts
are inert.

| Knob | Label | Function |
|---|---|---|
| K1 | `Res` | **Resolution** for all lanes |
| K2 | `Stch` | **Beat Stretch** all lanes (`NO ROOM` if any can't fit) |
| K3 | `Shft` | **Clock Shift.** *Alt:* **Nudge.** |
| K4 | `Qnt` | **Quantize** all lanes at playback (non-destructive) |
| K5 | `VelIn` | Velocity input override for the track |
| K6 | `InQ` | Recording input quantize for the track |
| K7 | `Dir` | **Direction** for all lanes. *Alt:* **Reverse Style.** |
| K8 | `SyncRpt` | **Repeat Sync** — held repeats wait for the beat grid (On) or fire instantly (Off) |

## 10.4 REPEAT GROOVE

<img src="img/bank-repeatgroove.png" width="384" alt="REPEAT GROOVE bank: a velocity bar for each of the 8 gate steps">

Available on a drum track while a [Note Repeat](#63-note-repeat) mode is active.
It shapes the 8-step gate mask, per-lane.

| Knobs | Standard page | After jog-click |
|---|---|---|
| K1–K8 | **Velocity** per gate step — `Thru` (fire at the pad's own velocity) or a locked value 1–127 | **Nudge** offset per gate step (±50 % of the step) |

**Delete + jog click** resets the groove for the selected lane.

---

# 11. Effects Banks

Every note — sequenced, played live, or arriving as external MIDI — runs through
the same chain before it reaches a sound source:

```
 LIVE INPUT ──▶ [LIVE ARP] ──┐
                             ├─▶ NOTE FX ─▶ HARMONY ─▶ DELAY ─▶ SEQ ARP ─▶ OUT
 SEQUENCED NOTES ────────────┘
```

- **LIVE ARP** processes live input only; sequenced notes skip it.
- Global **Swing** is applied after the chain; [Performance Mode](#14-performance-mode)
  mods, if any, apply last.

Effects are **non-destructive** — they reshape playback without touching your
written notes, so returning a knob to its default leaves the clip untouched. NOTE
FX, HARMONY, DELAY, and SEQ ARP are **per-clip**; LIVE ARP is **per-track**.

## 11.1 NOTE FX

<img src="img/bank-notefx.png" width="384" alt="NOTE FX bank: Octave, Offset, Velocity, Quantize, Length, Gate, Random">

Transforms every note's pitch, velocity, timing, and length.

| Knob | Label | Function | Default |
|---|---|---|---|
| K1 | `Oct` | Octave shift (±4) | 0 |
| K2 | `Ofs` | Note offset — scale degrees or semitones (±24) | 0 |
| K3 | `Vel` | Velocity offset (±127) | 0 |
| K4 | `Qnt` | Playback quantize (0–100 %) | 0 % |
| K5 | `Len>` | Fixed note length in step-multiples (`--` = passthrough) | -- |
| K6 | `Gate` | Scale note duration — under 100 % staccato, over 100 % legato | 100 % |
| K8 | `Rnd` | Pitch randomness (0–24). *Alt:* algorithm — Walk, Uniform, or Gaussian | 0 |

<img src="img/bank-drum-notefx.png" width="384" alt="NOTE FX on a drum track: K1/K2 merge into a lane-note box">

On **drum tracks**, K1 + K2 set the selected lane's MIDI note (K1 = octave, K2 =
semitone); K3–K6 apply per-lane.

## 11.2 HARMONY (melodic)

<img src="img/bank-harmony.png" width="384" alt="HARMONY bank: an octave voice plus three harmony voices">

Adds up to four voices on top of every note — an octave voice and three
scale-aware harmony intervals (each ±24, default 0).

## 11.3 DELAY

<img src="img/bank-delay.png" width="384" alt="DELAY bank: Rate, Level, Repeats, Vel feedback, Pitch feedback, Gate, Retrigger, Random">

A MIDI delay that generates rhythmic echoes of every note.

| Knob | Label | Function | Default |
|---|---|---|---|
| K1 | `Rate` | Delay time (dotted/triplet values included). *Alt:* **Clock Fine** — nudge each repeat | 1/8D |
| K2 | `Lvl` | Echo velocity level | 127 |
| K3 | `Rep` | Number of echoes (0 = off) | 0 |
| K4 | `Vfb` | **Velocity feedback** — velocity change per repeat | 0 |
| K5 | `Pfb` | **Pitch feedback** — pitch shift per repeat (scale-aware) | 0 |
| K6 | `Gate` | Fixed echo gate (Off = natural length) | Off |
| K7 | `Rtrg` | Retrigger — a new note drops in-flight echoes | On |
| K8 | `Rnd` | Pitch randomness on echoes. *Alt:* algorithm | 0 |

## 11.4 SEQ ARP (melodic)

<img src="img/bank-seqarp.png" width="384" alt="SEQ ARP bank: Style, Rate, Octave, Gate, Steps mode, Retrigger, Sync">

A step arpeggiator running after Delay, applied to both sequenced and live notes.
Per-clip.

| Knob | Label | Function | Default |
|---|---|---|---|
| K1 | `Styl` | Style — Off, Up, Down, Up/Down, Down/Up, Converge, Diverge, Ordered, Random, Rnd Order | Off |
| K2 | `Rate` | Arp rate | 1/16 |
| K3 | `Oct` | Octave range (±4, 0 = off) | Off |
| K4 | `Gate` | Note gate (staccato below 100 %, legato above) | 100 % |
| K5 | `Stps` | Steps mode — how silenced steps behave (Mute = rest, Step = skipped) | Mute |
| K6 | `Rtrg` | Retrigger on each new note and at loop | On |
| K7 | `Sync` | Wait for the next rate boundary | On |

**Arp Steps editor** — **click the jog** to open a per-step pattern editor:

- **Pitch page** (default): K1–K8 set per-step pitch offsets (±24 scale degrees).
- **Velocity page** (hold **Shift**): K1–K8 set each step's absolute velocity;
  one click past 127 is `Thru` (fire at the incoming velocity). **Delete + pad**
  resets a step to `Thru`.
- The **pads** are a coarse velocity editor (rows write 32 / 64 / 96 / 127;
  re-pressing the bottom row turns a step off). **Loop + pad** sets the step-loop
  length. Jog turn/click or Note/Session exits.

## 11.5 LIVE ARP (melodic)

<img src="img/bank-livearp.png" width="384" alt="LIVE ARP bank: same controls as SEQ ARP plus a Latch knob">

A live arpeggiator for pad and external-MIDI input. **Per-track**; it does not
touch sequenced notes. (Drum tracks use [Note Repeat](#63-note-repeat) instead.)

Same controls as SEQ ARP, plus:

| Knob | Label | Function | Default |
|---|---|---|---|
| K8 | `Ltch` | **Latch** — the arp keeps running after you release. The first press of a new gesture replaces the set; more presses add notes. | Off |

**Latch controls:** with pads held, tap **Loop** to latch; **Delete + Loop**
unlatches; tapping **Loop** with no pads held clears the chord without leaving
latch. Latched pads stay lit white and the Loop button blinks at the arp rate.
Latch survives track/route/channel changes; it clears on Stop, Delete + Play, and
entering Session View.

Quick toggle: **Shift + Step 11** flips LIVE ARP on and off using the last style.

---

# 12. Automation

<img src="img/bank-auto.png" width="384" alt="AUTOMATION bank: eight lanes labelled with CC/AT/Sch targets, and a curve with a playhead">

Each of the eight knobs drives its own **automation lane** — a recordable stream
of CC or aftertouch that plays back with the clip. A lane holds up to 1024 points
(smoothly interpolated) plus an optional resting value it returns to each loop.
The AUTO bank works **identically on melodic and drum tracks.**

## 12.1 Assigning a lane

**Click the jog** to enter assign mode, then turn a knob to choose its target:
aftertouch (`AT`), any CC (`CC0`–`CC127`), or — on Schwung-routed tracks — a
Schwung chain knob (`Sch1`–`Sch8`). The assignment applies to the **whole track**
(all clips share it).

Every knob starts at `—` (send nothing). Turn up from `—` to reach 0; turn below
0 to return to `—`.

## 12.2 Resting values & recording

**Setting a resting value** (a plain turn, no step held):

| State | Result |
|---|---|
| Stopped | Sets the clip's resting value and sends it live |
| Record-armed + playing | Records (see below) |
| Playing, not armed | A transient live audition — doesn't change the resting value |

When a resting value is set, the lane returns to it each loop; if it's `—`, the
lane holds wherever it ended.

**Recording:** while record-armed and playing, turning a knob writes its value at
the playhead, replacing what was there — and keeps writing (holding the last
value) loop after loop until you stop. Untouched knobs keep their automation.

## 12.3 Editing & clearing

**Step-edit:** hold a step on this bank; the display shows each lane's value
there (interpolated values in parentheses). Turn a knob to drop a point at that
step, starting from the shown value — nudge it up or down and the curve stays
smooth. Turn a point below 0 to clear it.

**Clearing** (all undoable):

| Gesture | Clears |
|---|---|
| **Delete** (tap) | Opens the CLEAR AUTOMATION menu (choose AT / CC) |
| **Delete + knob** | That one lane |
| **Delete + step** | All lanes at that step |
| **Delete + jog click** | All automation in the clip |

Clearing a clip's notes also removes its automation.

## 12.4 Per-lane loops

Each lane can loop **independently** of the clip — a 3-step filter sweep over a
4-bar melody, an LFO at its own rate, and so on. Lanes inherit the clip's length
until you set a custom one.

**Hold Loop on the AUTO bank** (the last-touched knob is the target lane):

| Gesture | Effect |
|---|---|
| Step buttons | Set loop length by page |
| Jog | Adjust length ±1 step |
| Left / Right | Change **resolution** (playback speed) — same data, faster/slower |
| Up / Down | Change **zoom** (grid density) — same span, more/fewer steps |
| Delete + Loop | Reset the lane to clip defaults |
| Shift + Step 15 | Double the lane loop with a data copy |

The step-button and pad colors for this bank are in the
[Screen & LED Reference](#automation-auto-bank).

---

# Part IV · Performing & Arranging

# 13. Session View & Scenes

Session View is the launch-and-arrange screen. The **8×16 clip grid** lives on
the pads — 8 tracks across, 4 rows visible at a time — and the jog scrolls
through all 16 rows. The screen keeps showing the current bank; there's no
separate Session screen.

> **Like Move:** this is the session/clip-launch grid you know from Move and
> Ableton Live.

| Gesture | Result |
|---|---|
| Tap a clip pad | Launch or queue that clip |
| Tap an empty clip pad | Focus it for recording |
| **Shift + clip pad** | Open the clip in Track View. While stopped, a clip with notes opens *without* launching; empty clips (or any clip while playing) launch. |
| Scene launcher, or steps 1–16 | Launch every clip in that row |
| **Shift + scene launcher** | Launch the row at the next bar (ignores Launch Quantize) |
| Jog turn | Scroll rows one at a time |
| Up / Down | Scroll by 4 rows |

Empty cells in a row don't touch their track — it keeps playing what it had.
Mute and solo work the same in both views — see
[Mixing](#15-mixing-mute-solo--volume).

## 13.1 Scene editing

| Gesture | Result |
|---|---|
| **Copy + scene launcher**, then another row | Copy all 8 clips |
| **Shift + Copy + scene launcher** | Cut the row |
| **Capture + scene launcher** | Snapshot the playing/queued clips into that row |
| **Delete + scene launcher** | Clear notes in all 8 clips |
| **Shift + Delete + scene launcher** | Hard reset all 8 clips |

---

# 14. Performance Mode

<img src="img/view-perf.png" width="384" alt="Performance Mode screen: the active mods listed, with Hold / Sync / Latch chips and the rate">

Performance Mode grabs a short loop of whatever's playing and lets you mangle it
live with a grid of real-time effects. It works in **Session View**.

## 14.1 Entering & exiting

| Action | Result |
|---|---|
| **Tap Loop** | Lock — stays on hands-free |
| **Hold Loop** | Temporary — exits when you release |
| **Shift + Loop** (or the Latch pad) | Toggle latch mode |

Switching to Track View exits Performance Mode but keeps your mod state.

## 14.2 The mod grid

```
   top row      Wild mods         — blue
                Velocity / gate   — yellow
                Pitch mods        — magenta (melodic only)
   bottom row   Length / Hold / Sync / Latch controls
```

With **Latch on**, tapping a mod pad toggles it and it stays active until you tap
it again. With **Latch off**, a mod is active only while you hold its pad. You can
combine both — hold momentary mods on top of latched ones. Pressing a lit pad
always turns that mod off.

**The bottom row** sets the capture length and mode:

| Pad | Function |
|---|---|
| 1–5 | Capture length: 1/32, 1/16, 1/8, 1/4, 1/2 bar |
| 6 | **Hold** — the loop persists when you release a length pad |
| 7 | **Sync** — clock-aligned capture on/off |
| 8 | **Latch** — sticky-mod mode on/off |

Press a *different* length pad to queue a new capture (it finishes the current
cycle first); press the *same* one to recapture immediately.

**The three mod rows:**

<details>
<summary><b>Pitch mods</b> (magenta, melodic only)</summary>

| Pad | Name | Effect |
|---|---|---|
| 1 | Oct Up | Alternates octave up / original |
| 2 | Oct Down | Alternates octave down / original |
| 3 | Scale Up | +1/+2/+3 scale degrees over 3 cycles, then resets |
| 4 | Scale Down | −1/−2/−3 over 3 cycles |
| 5 | Fifth | Ascending fifths |
| 6 | Tritone | 4th, 6th, octave+2nd over 4 cycles |
| 7 | Drift | ±1 random walk, drifts to ±6 |
| 8 | Storm | Random ±6 scale degrees per note — chaotic but in key |

</details>

<details>
<summary><b>Velocity / gate mods</b> (yellow, all tracks)</summary>

| Pad | Name | Effect |
|---|---|---|
| 1 | Decrescendo | Velocity ×0.85 per cycle |
| 2 | Swell | 16-cycle triangle |
| 3 | Crescendo | Velocity ×1.15 per cycle |
| 4 | Pulse | Even cycles full, odd cycles 20 % |
| 5 | Sidechain | −15 % per successive note in a cycle |
| 6 | Staccato | Gates to 1/8 of the loop |
| 7 | Legato | Gates to the full loop |
| 8 | Ramp Gate | Gate ramps up across notes |

</details>

<details>
<summary><b>Wild mods</b> (blue)</summary>

| Pad | Name | Effect |
|---|---|---|
| 1 | Half Time | Every other cycle suppressed |
| 2 | 3 Skip | Every third cycle suppressed |
| 3 | Phantom | Ghost note an octave below, ¼ velocity |
| 4 | Sparse | ~50 % chance each note is suppressed |
| 5 | Glitch | ±2 scale-degree random shift per note |
| 6 | Stagger | Notes offset +0, +1, +2… scale degrees |
| 7 | Shuffle | Pitch/hit order randomized each cycle |
| 8 | Backwards | Pitch/hit order reversed each cycle |

</details>

## 14.3 Which tracks are included

A track feeds Performance Mode only if its **Looper** flag is on
([Track Config](#191-track-config)). While Performance Mode is locked, touch
K1–K8 to toggle each track's Looper (the knob LED shows the track color when on).

## 14.4 Presets

The **step buttons are 16 preset slots.** Tap to recall (this replaces any
latched mods); hold ~0.75 s to save; **Delete + step** clears. Slots 1–8 ship
with factory combinations:

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

Slots 9–16 are empty for your own. Latched mods, latch mode, user presets, and
the recalled slot all persist across saves.

---

# 15. Mixing: Mute, Solo & Volume

## 15.1 Mute & solo

| Where | Mute | Solo |
|---|---|---|
| Track View | **Mute** button | **Shift + Mute** |
| Session View | **Mute + clip pad** | **Shift + Mute + clip pad** |
| Drum lanes | **Mute + lane pad** | **Shift + Mute + lane pad** |

**Delete + Mute** clears every mute and solo. Mute and solo are mutually
exclusive per track or lane. A track mute silences its sequenced and latched
output, but a live pad you're holding still monitors through.

> **Like Move:** mute and solo are the standard Move gestures.

### Mute/solo snapshots

Store up to **16 mute/solo states.** In Session View, hold **Mute** and the step
buttons light (dark grey = empty, yellow = saved):

| Gesture | Action |
|---|---|
| Mute + hold step (~0.75 s) | Save |
| Mute + tap a lit step | Recall |
| Mute + Delete + step | Clear that slot |

Snapshots persist across reboots.

## 15.2 Copy, cut & clear

The clipboard stays live after a paste, so you can paste to several destinations
from one source; it clears when you release **Copy**. **Cut is Shift + Copy** (the
source clears after the first paste).

| Level | Copy | Clear |
|---|---|---|
| Step | Copy + step → step (same clip) | Delete + step |
| Clip | Copy + side button / clip pad → destination | Delete + side button (clears notes, resets length) |
| Hard reset clip | — | Shift + Delete + side button (notes + params) |
| Scene row | Copy + scene launcher → row | Delete + scene launcher |
| Drum lane | Copy + lane pad → lane (MIDI note kept) | Delete + lane pad |

## 15.3 Volume

The **Volume** encoder controls master output only (handed to Move). There's no
per-track volume in dAVEBOx — set gain on the destination instead (the Move mixer,
or the Schwung chain).

---

# Part V · Sound Sources & Output

# 16. Sound Sources & Editing In Place

You can edit a track's sound source — a Move instrument or a Schwung chain —
**without leaving dAVEBOx.** The screen, jog, and knobs hand off to the editor
while dAVEBOx's transport and sequencer keep running.

> Requires **Schwung 0.9.18 or later.** The entry points appear automatically on
> supported builds and stay hidden otherwise.

## 16.1 Opening the editor

| How | For |
|---|---|
| **Shift + Step 3** | The active track |
| **Track Config → Edit Slot…** | Schwung-routed tracks |
| **Track Config → Edit Synth…** | Move-routed tracks |

**Edit Slot** opens Schwung's chain editor for the slot receiving the track's
channel. **Edit Synth** opens Move's own preset browser and instrument editor on
the track's current instrument.

## 16.2 While editing

Playback continues normally. The controls map to the editor:

| Control | Action |
|---|---|
| Jog turn / click | Navigate / select |
| K1–K8 | Chain parameters (Edit Slot) |
| Back | Navigate within the editor |
| **Step 3** (blinking) | **Exit** back to dAVEBOx |
| Shift | Works normally |

**Mute changes hands during editing.** With a **Move** instrument, Mute mutes the
Move instrument or drum pad you're working on. In a **Schwung** chain, Mute is the
chain's bypass modifier — hold **Mute + jog-click** a slot to bypass it. Outside
the editor, Mute is dAVEBOx's own track mute again.

When editing a **Move** instrument, drum pads play a single hit at the velocity
you press and select that sound for editing; the pads invert into track colors
(selected lane in color, the rest white).

Exit with **Step 3** (or the **Menu** button for Schwung chains). dAVEBOx reclaims
the screen, pads, knobs, and LEDs.

---

# 17. Routing, Clock & Sync

## 17.1 Routing a track

Two per-track settings in [Track Config](#191-track-config) decide where a track's
MIDI goes:

- **Channel** — MIDI channel 1–16 (default: track N = channel N)
- **Route** — Move, Schwung, or External (USB-A)

The default is tracks 1–4 → Move and tracks 5–8 → Schwung, per
[First-Time Setup](#2-first-time-setup). Multiple tracks can route **External**
at once for a multitimbral rig.

## 17.2 External MIDI in & out

**Input.** A USB-A controller plays the active track; dAVEBOx rechannelizes its
notes to that track's channel. Filter by channel with **Global Menu → MIDI In**.
Whether the effects chain applies to live input depends on the route:

| Route | Live effects on external input |
|---|---|
| Schwung | Full chain applies |
| External | Full chain applies; output goes out USB-A |
| Move | Chain bypassed (it would form a feedback loop) |

**Output.** On an External-routed track, everything goes out USB-A — sequencer,
live pads, effects, LIVE ARP, and Performance Mode. The
[AUTO bank](#12-automation) also sends its CC and aftertouch there; `Sch` lanes
send on the internal Schwung path instead.

**Panic.** Transport Stop sends note-offs and clears LIVE ARP latches.
**Delete + Play** while stopped sends a MIDI panic on all channels and clears all
repeat and arp latches; while running it deactivates all clips and clears latches.

## 17.3 Clock Follow — sync to Move

By default dAVEBOx runs its own clock. Set **Global Menu → Clock Follow → Move**
to lock it to Move's transport instead. dAVEBOx then *replaces* Move's sequencer
while Move supplies clock, transport, and voices.

- **Tempo follows Move.** BPM shows `Move` and is read-only; Tap Tempo is
  disabled. Turn Move's tempo and dAVEBOx tracks it — including keeping Move's
  last tempo after a stop.
- **Play drives Move.** dAVEBOx's **Play** starts or stops *Move's* transport, and
  dAVEBOx follows, so both launch from the same downbeat. Pressing Move's own Play
  works too.
- **Bar 1 re-anchors** each time Move starts, so the two share a downbeat.
- **Record count-in.** Arming Record while stopped starts Move and counts one bar
  on its clock before recording (your bar 1 lands on Move's bar 2 — a constant,
  inaudible offset). Because Move quantizes its start to its Link grid, there can
  be up to a bar's wait; dAVEBOx waits through it, and falls back to its own clock
  with a brief notice if Move never starts.
- **Stops with Move.** If Move's clock stops, so does dAVEBOx's sequencer — but
  held arpeggios and tempo-synced delay keep grooving at Move's tempo.

This assumes Move's own sequencer is empty on the tracks dAVEBOx feeds. Leave
Clock Follow **Off** for normal free-running. The setting saves per set and never
auto-starts Move on load.

## 17.4 Clock Out — drive external gear

**Global Menu → Clock Out → On** sends MIDI clock and start/stop out the USB-A
port, so external synths and drum machines lock to dAVEBOx.

- It's for the **free-running** case only. When Clock Follow = Move, Clock Out is
  suppressed and shows `—` (let Move's own MIDI Clock Out drive external gear, so
  two clocks don't share the port). Your On/Off choice is remembered.
- Requires **Schwung 0.9.16 or later.** Saves per set; defaults **Off** and never
  sends clock until the transport actually runs.

> **Known limitation:** with Move's sequencer running underneath, some of Move's
> native clip/step/row LEDs can flicker against dAVEBOx's. It doesn't affect
> timing or playback.

---

# 18. Bake, Live Merge & Export

Three ways to commit what you hear into solid data.

## 18.1 Bake

**Bake** (the **Sample** button) renders a clip's effects — NOTE FX, HARMONY,
DELAY, SEQ ARP — into permanent notes, then resets the effects to defaults. The
result sounds the same with no effects applied: useful for layering new effects
on top, or freezing a variation.

**Melodic bake** (Track View) — tap **Sample**, then answer:
1. Loop count — 1× / 2× / 4×
2. Wrap tails? — Yes wraps echoes past the clip end back to the start for a
   seamless loop

**Drum bake** (Track View) adds a first question: **Clip** (all lanes, full
chain) or **Lane** (the selected lane only, no pitch transforms).

**Scene bake** (Session View) — tap **Sample**, pick a target row (or use
**Sample + scene launcher**), then loop count and wrap. Each track runs its own
bake; empty clips are skipped.

**Apply Conductor?** If a [Conductor](#7-conductor-tracks) exists with responders
turned on for the baked scene, an extra **YES / NO / CANCEL** step appears:

- **YES** folds the transposition permanently into each responding clip, then
  turns off those Responder flags so live playback doesn't transpose them again.
- **NO** bakes the written pitches only.
- **CANCEL** aborts the bake.

(Baking re-rolls note-FX random and step probability — the result is a frozen
snapshot, not a re-derivable performance.)

## 18.2 Live Merge

**Live Merge** records the actual output of your tracks as they play — arps,
delays, knob rides and all — into solid clips.

Arm it with **Shift + Record** from a **stopped** transport — a notice reads "Rec
to start, Back to cancel." Press **Record** to begin; it plays a **1-bar
count-in**, then captures a clean take from the top of the pattern.

The view you arm from sets the scope:

- **Session View** — all 8 tracks at once, committed to a scene row you pick.
- **Track View** — just the active track, played in isolation. When you stop,
  dAVEBOx switches to Session View and blinks the empty clips on that track; tap
  one to save the take.

| Step | Control |
|---|---|
| Arm | **Shift + Record** (stopped) → notice |
| Start | **Record** (or **Back** to cancel) |
| Stop | **Record** — Session View finalizes at the next page boundary; Track View immediately |
| Auto-stop | Reaching the 256-step limit |
| Place | Tap a scene row (Session) or a blinking empty clip (Track) |

In Session View, tracks that captured notes overwrite their clip at the target
row; tracks that captured nothing are left alone.

## 18.3 Export to Ableton Live

**Global Menu → Export to Ableton** writes an `.ablbundle` that desktop Live opens
directly (then Save As `.als`). The transport must be stopped; a confirm dialog
appears.

The bundle lands at `/data/UserData/schwung/davebox-exports/<set>-<date>.ablbundle`
(retrieve over SFTP) and opens as **8 MIDI tracks × 16 scene slots** with tempo
and key.

- **Instruments follow routing:** Move-routed tracks export the real Move
  instrument, preset, and color; Schwung- and External-routed tracks get a
  placeholder Drift.
- **Notes are baked** — each clip exports what you hear, effects rendered. Drum
  clips flatten per-lane polymeters to their least common multiple; randomized
  clips export 8 cycles of variation; delay echoes wrap for seamless loops.
- **Apply Conductor?** works the same as [scene bake](#181-bake), non-destructively
  — your live session is never changed.

The bundle is self-contained (samples included). Requires **Live 12.1+** for Move
Drum Racks. Export is one-way.

---

# Part VI · Reference

# 19. Global Menu & Saving

Open with **Shift + Note/Session**. Turn the jog to move, click to edit, turn to
change, click to confirm.

## 19.1 Track Config

The top section — settings for the active track, updating live as you switch
tracks. Entries that don't apply to the current track type or route are hidden.

| Entry | Values | Notes |
|---|---|---|
| Channel | 1–16 | MIDI channel. Inert (`-`) on a Conductor. |
| Route | Move, Schwung, External | Output. Inert (`-`) on a Conductor. |
| Mode | Keys, Drums, Conduct | Track type — [switching carries notes](#42-switching-a-tracks-type). |
| Layout | Scale, Chrom | Melodic pad layout (same as Shift + Step 8). |
| VelIn | Live, 1–127 | Live = raw velocity; a fixed value overrides all input. |
| Looper | On, Off | Whether the track feeds [Performance Mode](#14-performance-mode). |
| AftTch | Off, Poly, Channel | Pad-pressure aftertouch (melodic). Move-routed offers Off/Poly only. |
| Edit Slot… | Action | Open the Schwung chain editor — [edit in place](#16-sound-sources--editing-in-place). |
| Edit Synth… | Action | Open Move's instrument editor — [edit in place](#16-sound-sources--editing-in-place). |

## 19.2 Global settings

Below the divider, in on-device order:

| Item | Values | Default | Notes |
|---|---|---|---|
| Clock Follow | Off, Move | Off | [Sync to Move](#173-clock-follow--sync-to-move) |
| Clock Out | Off, On | Off | [Drive external gear](#174-clock-out--drive-external-gear); shows `—` while Clock Follow = Move |
| BPM | 40–250 | 120 | Shows `Move` (read-only) under Clock Follow |
| Tap Tempo | Action | — | Tap pads to set BPM; jog ±1. Disabled under Clock Follow |
| Key | C…B | C | Session root |
| Scale | (list below) | Major | Active scale |
| Scale Aware | On, Off | On | Scale-aware params step by scale degree, not semitone |
| Launch Quant | Now, 1/16…1-bar | Now | When launched clips start |
| Swing Amt | 50–75 % | 50 % | 50 % = none, 66 % = triplet |
| Swing Res | 1/16, 1/8 | 1/16 | Which positions swing |
| MIDI In | All, 1–16 | All | External input filter |
| Metro | Off, Cnt-In, Play, Always | Off | Metronome |
| Metro Vol | 0–150 % | 100 % | Metronome level |
| Beat Markers | On, Off | On | Dim markers on steps 1, 5, 9, 13 |
| Export to Ableton | Action | — | [Export](#183-export-to-ableton-live) |
| Save state | Action | — | Write a snapshot (confirms first) |
| Load state | Action | — | Restore a snapshot |
| Clear Session | Action | — | Reset the whole instance (confirms) |
| Quit | Action | — | Save and exit |

**Scales:** Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic
Minor, Melodic Minor, Pentatonic Major, Pentatonic Minor, Blues, Whole Tone,
Diminished.

## 19.3 Changing Key or Scale

When you edit **Key** or **Scale**, your melodic clips move with it:

- **As you turn**, you get a live preview — the pads relayout and, if playing, you
  *hear* every melodic clip in the candidate key/scale. Nothing is committed yet.
- **Click to commit.** If any melodic clip has notes, a **"Transpose clips?"**
  prompt asks first (YES bakes the move into every clip; NO applies the new
  key/scale but leaves notes put). No notes means no prompt.
- **Backing out** (Note/Session, or turning back) cancels.

Key moves by the shortest distance; Scale remaps by scale degree when the two
scales have the same number of notes, otherwise snapping to the nearest in-scale
note. Drum tracks are unaffected. A committed transpose can't be undone — check
the preview before you confirm.

## 19.4 Snapshots

dAVEBOx **auto-saves** on suspend (Back), exit (Shift + Back), and Quit — there's
no manual "Save." For named backups, use **Save state**: up to **16 snapshots**
per set, each stamped with date and time.

- **Save state** confirms first (showing your count), then writes one. At 16, a
  picker asks which to overwrite.
- **Load state** lists them newest-first; loading discards unsaved changes.
- Snapshots belong to the set — **Clear Session doesn't delete them.**
- After a format-changing update, old snapshots are marked `(old)`.

## 19.5 Sets & version compatibility

<img src="img/dialog-confirm.png" width="384" alt="Incompatible State confirm dialog with No and Yes buttons">

- **Duplicating a Move set** inherits dAVEBOx's state: silent if there's one
  parent, a picker for several, blank for none.
- **Deleting a Move set** removes dAVEBOx's data for it on the next launch.
- **Loading a set from an older dAVEBOx version** shows an **Incompatible State**
  dialog. **No** (default) exits with the old file preserved so you can back it
  up; **Yes** erases it and starts clean.

**What persists per set:** all notes, per-clip effects and timing, automation;
track settings (channel, route, mode, octave, VelIn, Looper, AftTch, layout);
global settings; mute/solo state and all 16 snapshots; LIVE ARP state; Performance
Mode presets and latched mods; Note Repeat gate masks, grooves, and rates.

---

# 20. The Remote UI

With dAVEBOx loaded, open the Schwung web manager
(`http://move.local:7700`) → **Remote UI → Tool tab** for a full clip editor in
your browser. It mirrors the device live in **both directions** — edits on either
side appear on the other. A **⚠ clip too dense** badge means a clip has more notes
than the editor can load at once (thin it on-device to reach the rest).

**Session grid.** Tracks are columns, scenes are rows, like a DAW.

- **Click a clip** to launch it (respecting Launch Quantize); **Alt/Shift-click**
  views it without launching. **▶ A–P** launches a scene.
- **Drag** a clip to move it (**Alt-drag** copies); same-type tracks only.
- A clip's **≡ menu** offers Duplicate, Copy, Cut, Paste, Delete.
- Track headers: **click** = mute, **right-click** = solo, **☰** = route/channel.

**Piano roll.** The **Draw** tool adds and drags notes (honoring the toolbar
**Snap**); right-click or the **Erase** tool deletes. The **Select** tool
marquee-selects to move, nudge, or velocity-edit together. On **drum tracks**,
drag a hit vertically to move it between lanes. The **step band** below sets
per-step trig conditions, matching an on-device step hold. **Zoom** with the drag
strips by the rulers, or pinch/wheel; the velocity and automation lanes resize by
dragging their top edge.

**Transport.** The header shows transport, position, and BPM, and the play button
starts/stops the device. The playhead runs on a clock synced to the device's own
timestamps, so it stays smooth over congested WiFi. If the two ever disagree after
heavy simultaneous editing, the **sync** button forces a full re-read.

---

# 21. Cheat Sheet

### Track View — melodic

| Control | Action |
|---|---|
| Pad | Play a note |
| Pads + step | Chord (pad-first) |
| Step + pads | Chord (step-first) |
| Step tap | Toggle step |
| Step hold | Step edit |
| Up / Down | Octave |
| Left / Right | Page |
| Side buttons | Switch clips |
| Jog turn | Cycle banks |
| Jog click | Alt-parameters |
| Shift + jog | Switch tracks |
| Shift + bottom-row pad | Track 1–8 |
| Loop (hold) | Loop view |
| Loop + jog | Clip length |
| Play | Start / stop |
| Shift + Play | Restart from start |
| Loop + Play | Restart at visible page |
| Record | Record |
| Shift + Record | Live Merge |
| Capture | Keep buffered play |
| Shift + Capture | Discard buffer |
| Sample | Bake |
| Mute / Shift + Mute | Mute / solo |
| Delete + Mute | Clear mutes/solos |
| Mute + Play | Metro off ↔ last |
| Delete + step / side | Clear step / clip |
| Shift + Delete + side | Hard reset clip |
| Delete + jog click | Reset bank |
| Shift + Delete + jog click | Reset all effects |
| Delete + Play (running / stopped) | Deactivate clips / MIDI panic |
| Undo / Shift + Undo | Undo / redo |
| Note/Session (tap / hold) | Switch / peek view |
| Shift + Note/Session | Global Menu |

### Shift + step shortcuts

| Step | Action | Views |
|---|---|---|
| 2 | Global Menu (global section) | Both |
| 3 | Sound-source editor | Track |
| 5 | Tap Tempo | Both |
| 6 | Metro (Cnt-In ↔ Always) | Both |
| 7 | Swing | Both |
| 8 | Chromatic toggle / cycle right-pad mode | Track |
| 9 | Scale | Both |
| 10 | VelIn (Live ↔ 100) | Track |
| 11 | LIVE ARP on/off | Track (melodic) |
| 15 | Double-and-fill loop | Track |
| 16 | Quantize 100 % | Track |

### Track View — drum (changes)

| Control | Action |
|---|---|
| Lane pad | Trigger + select lane |
| Up / Down | Lane bank A ↔ B |
| Shift + Step 8 | Cycle right-pad mode |
| Loop + jog | Lane length |
| Loop + rate pad (Rpt1) / lane pad (Rpt2) | Latch repeat |
| Delete + Loop | Stop latched repeats |
| Loop + gate pad | Repeat cycle length |
| Mute / Shift + Mute + lane pad | Mute / solo lane |
| Copy + lane pad → dest | Copy lane |
| Delete / Shift + Delete + lane pad | Clear / hard reset lane |

### Session View

| Control | Action |
|---|---|
| Clip pad | Launch / queue |
| Empty clip pad | Focus for recording |
| Shift + clip pad | Open in Track View |
| Scene launcher / steps 1–16 | Launch row |
| Shift + scene launcher | Launch at next bar |
| Jog / Up-Down | Scroll rows (1 / 4) |
| Mute / Shift + Mute + clip pad | Mute / solo track |
| Mute (hold) + step (tap / hold) | Recall / save snapshot |
| Copy + clip pad / scene launcher | Copy clip / row |
| Capture + scene launcher | Snapshot to row |
| Sample (tap) / + scene launcher | Scene-bake picker / direct |
| Delete + clip pad / scene launcher | Delete clip / clear row |
| Loop (tap / hold) | Lock / temporary Performance Mode |

### Performance Mode

| Control | Action |
|---|---|
| Bottom row 1–5 | Capture length |
| Bottom row 6 / 7 / 8 | Hold / Sync / Latch |
| Mod rows | Pitch / vel-gate / wild mods |
| Lit pad tap | Clear that mod |
| K1–K8 touch | Toggle track Looper |
| Step tap / hold | Recall / save preset |
| Delete + step | Clear preset |

---

# 22. Parameter Reference

Labels shown as they appear on the OLED. "Alt" = the alternate function reached
by [jog-click](#alt-parameters).

### CLIP (melodic)

| K | Label | Range | Default | Rewrites notes | Alt |
|---|---|---|---|---|---|
| 1 | Res | 1/32, 1/16, 1/8, 1/4, 1/2, 1bar | 1/16 | Yes | Zoom |
| 2 | Stch | Halve ← · → Double | — | Yes | — |
| 3 | Shft | ±N whole steps | 0 | Yes | Nudg (tick) |
| 4 | Lgto | → (confirm) | — | Yes | — |
| 5 | InQ | Off, 1/64…1/4T | Off | No (per-track) | — |
| 7 | Dir | Fwd, Bwd, PPf, PPb | Fwd | No | RvSt (Step/Audio) |
| 8 | SqFl | On, Off | On | No | — |

### DRUM LANE

| K | Label | Range | Default | Rewrites notes | Alt |
|---|---|---|---|---|---|
| 1 | Res | 1/32…1bar | 1/16 | Yes | Zoom |
| 2 | Stch | Halve/Double | — | Yes | — |
| 3 | Shft | ±N steps | 0 | Yes | Nudg |
| 4 | Lgto | → (confirm) | — | Yes | — |
| 5 | Eucl | 0–lane length | 0 | Yes | — |
| 7 | Dir | Fwd, Bwd, PPf, PPb | Fwd | No | RvSt |
| 8 | SqFl | On, Off | On | No | — |

### ALL LANES (drum)

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Res | 1/32…1bar | `--` | All lanes |
| 2 | Stch | Halve/Double | — | `NO ROOM` if blocked |
| 3 | Shft | ±N steps | 0 | Alt: Nudg |
| 4 | Qnt | 0–100 % | `--` | Non-destructive |
| 5 | VelIn | Live, 1–127 | Live | Per-track |
| 6 | InQ | Off, 1/64…1/4T | Off | Per-track |
| 7 | Dir | Fwd, Bwd, PPf, PPb | `--` | Alt: RvSt |
| 8 | SyncRpt | On, Off | On | Repeat first-fire |

### NOTE FX

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Oct | ±4 | 0 | Drum: lane note (octave) |
| 2 | Ofs | ±24 | 0 | Scale-aware. Drum: lane note (semitone) |
| 3 | Vel | ±127 | 0 | Velocity offset |
| 4 | Qnt | 0–100 % | 0 % | Playback quantize |
| 5 | Len> | --, .25, .50, .75, 1, 2, 4, 8, 16 | -- | Fixed length |
| 6 | Gate | 0–400 % | 100 % | Post-length scale |
| 8 | Rnd | 0–24 | 0 | Scale-aware. Alt: Walk/Uniform/Gaussian |

### HARMONY (melodic)

| K | Label | Range | Default |
|---|---|---|---|
| 1 | Oct | ±4 | 0 |
| 2–4 | Hrm1–3 | ±24 (scale-aware) | 0 |

### DELAY

| K | Label | Range | Default | Notes |
|---|---|---|---|---|
| 1 | Rate | 1/64…1/1D (dotted/triplet) | 1/8D | Alt: ClkF (±100) |
| 2 | Lvl | 0–127 | 127 | Echo velocity |
| 3 | Rep | 0–16 | 0 | 0 = off |
| 4 | Vfb | ±127 | 0 | Velocity per repeat |
| 5 | Pfb | ±24 | 0 | Pitch per repeat (scale-aware) |
| 6 | Gate | Off, 1/64…1bar | Off | Fixed echo gate |
| 7 | Rtrg | On, Off | On | New note drops echoes |
| 8 | Rnd | 0–24 | 0 | Scale-aware. Alt: algorithm |

### SEQ ARP / LIVE ARP

| K | Label | Range | SEQ default | LIVE default |
|---|---|---|---|---|
| 1 | Styl | Off, Up, Dn, U/D, D/U, Cnv, Div, Ord, Rnd, RnO | Off | Off |
| 2 | Rate | 1/32…1bar (incl. triplets) | 1/16 | 1/16 |
| 3 | Oct | ±4 (0 = Off) | Off | Off |
| 4 | Gate | 1–200 % | 100 % | 100 % |
| 5 | Stps | Mute, Step | Mute | Mute |
| 6 | Rtrg | On, Off | On | Off |
| 7 | Sync | On, Off | On | On |
| 8 | Ltch | On, Off | — | Off (LIVE only) |

Jog-click opens the **Arp Steps editor** on either bank.

### Step edit

| K | Melodic | Drum |
|---|---|---|
| 1 | Note (scale degrees) | Leng |
| 2 | Oct | Vel |
| 3 | Leng | Nudg |
| 4 | Vel | — |
| 5 | Nudg | Iter |
| 6 | Iter | Prob |
| 7 | Prob | Ratch |
| 8 | Ratch | — |

Iter: `--`, 1/2…8/8 · Prob: `--`, 0–100 % · Ratch: `--`, ×2, ×3, ×4.

---

# 23. Screen & LED Reference

## Clip pads (Session View)

| State | LED |
|---|---|
| Empty | Off |
| Has content, inactive | Very dim track color |
| Focused, empty | Dark grey |
| Will relaunch on Play | Solid bright track color |
| Playing | Flash at 1/8-note rate |
| Queued to launch / stop | Flash at 1/16-note rate |

## Side buttons (Track View)

| State | LED |
|---|---|
| Playing | Flash bright/dim track color |
| Focused, will relaunch | Slow pulse |
| Focused, not playing | Solid bright track color |
| Has content | Dim track color |
| Empty | Dark grey |

## Step buttons

**Track View:** playhead = white; active step = track color; beat markers
(1/5/9/13) = dim track color; beyond clip length = dark grey.

**Session View:** rows in view = red (pulsing if a clip is playing); out-of-view
with playing clips = pulsing white; out-of-view with content = solid white.

<a id="automation-auto-bank"></a>
**Automation (AUTO bank):** step brightness tracks the value (off = no data,
warm/yellow/red rising, bright white high); the playhead step is white. Steps with
real recorded points blip briefly to distinguish them from interpolated ones.
Melodic pads show a greyscale note layout; drum pads keep playing their sounds
(active lane in track color, sounding lanes dim, others grey).

## Knob LEDs

- **Most banks:** lit = parameter away from default, off = at default.
- **AUTO bank:** off = no data · white = resting value set · yellow = has
  automation · red = recording (brightness = value) · green = playback.
- **Performance Mode (locked):** track color = Looper on.

## OLED header

- **Melodic:** metronome mode · VelIn · fixed/adaptive · `Oct:±N` · `Arp`
  (inverts when latched) · Key + Scale (underlined when Scale Aware is on).
- **Drum:** `Bank:A/B  Pad:C1 (36)` · mute/solo for the active lane.
- **Bank strip** (both): a right-aligned row of blocks — a tall block for the
  active bank, short stubs for the others, in jog order.

Track numbers show a box around the active track, blink when muted, and fill solid
when soloed. A **position bar** along the bottom of Track View shows the current
page, the playhead page, and which pages hold content.

## Action pop-ups

Brief on-screen confirmations for edits — COPIED / CUT / PASTED, SEQUENCE
CLEARED, BANK RESET, LOOP DOUBLED, CAPTURED, STATE SAVED, UNDO / REDO, and so on.
`NO ROOM` (stretch blocked) and `NOTES OUT OF RANGE` (zoom blocked) flag an edit
that couldn't be applied.

## Limitations

| Limitation | Notes |
|---|---|
| External MIDI on Move-routed tracks skips the effects chain | Avoids a feedback loop — use Schwung routing for effects on external input |
| Volume is master-only | Set per-track gain on the destination |
| Automation lanes aren't swung | By design — keeps automation on the grid |
| Powering off from within dAVEBOx briefly hangs | — |
