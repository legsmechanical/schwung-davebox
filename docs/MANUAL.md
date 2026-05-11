# The dAVEBOx Manual

dAVEBOx is an 8-track MIDI sequencer for Ableton Move. It runs as a tool module inside the [Schwung](https://github.com/charlesvestal/schwung) framework and uses Move's pads, knobs, and screen. dAVEBOx generates no audio of its own — every note it produces is handed off to Move's native instruments, to Schwung's effect chains, or to an external synth over USB-A.

Sequence melodic parts and drums on the same instrument. Build patterns one step at a time or jam them in live. Run notes through arpeggiators, harmonizers, delays, and a step-arp that doubles as a trance gate. Capture short loops and transform them in real time. Save 16 clip variations per track and fire them as scenes.

This manual is written for two readers: someone who just powered the device on, and someone who knows their way around and needs to look something up. The first three chapters teach the system. Everything after is reference.

---

## How to read this manual

| If you are… | Start here |
|---|---|
| New to dAVEBOx | **Chapter 1 (Quick Start)**, then skim **Chapter 2 (Mental Model)** |
| Comfortable, looking for depth | Jump to the chapter for the feature you want |
| Looking up a control | **Appendix C — Controls Cheat Sheet** |
| Decoding a screen or LED | **Appendix A — LED Reference** · **Appendix B — OLED Reference** |

Every chapter is self-contained. Cross-references are explicit when one feature depends on another.

---

## Table of Contents

**Part I — Foundations**
1. [Quick Start](#1-quick-start)
2. [The Mental Model](#2-the-mental-model)
3. [Navigation & Layout](#3-navigation--layout)

**Part II — Making Music**
4. [Sequencing](#4-sequencing)
5. [The Effects Chain](#5-the-effects-chain)
6. [Drum Tracks](#6-drum-tracks)

**Part III — Performance & Capture**
7. [Scenes](#7-scenes)
8. [Performance Mode](#8-performance-mode)
9. [Bake and Live Merge](#9-bake-and-live-merge)

**Part IV — Studio**
10. [Mixing](#10-mixing)
11. [Editing — Copy, Cut, Paste, Undo](#11-editing--copy-cut-paste-undo)
12. [MIDI Routing](#12-midi-routing)
13. [Global Settings](#13-global-settings)
14. [State and Persistence](#14-state-and-persistence)

**Part V — Reference**
15. [Limitations and Gotchas](#15-limitations-and-gotchas)
- [Appendix A — LED Reference](#appendix-a--led-reference)
- [Appendix B — OLED Reference](#appendix-b--oled-reference)
- [Appendix C — Controls Cheat Sheet](#appendix-c--controls-cheat-sheet)

---

# Part I — Foundations

# 1. Quick Start

A 10-minute walkthrough that touches the parts of dAVEBOx you'll use daily. Power on your Move and open dAVEBOx (load a Schwung set, then open the dAVEBOx slot).

## 1.1 Configure Move and Schwung — one-time setup

Before sequenced notes can make sound, Move's native tracks and Schwung's slots need to be listening on the right MIDI channels. dAVEBOx's defaults send tracks 1–4 to Move's native instruments and tracks 5–8 to Schwung — but those destinations need to be configured to receive on the matching channels.

**In Move**, set each of tracks 1–4 to receive on its corresponding channel, and turn MIDI Out off so notes don't echo back into a feedback loop:

| Move track | MIDI In | MIDI Out |
|---|---|---|
| Track 1 | Ch 1 | Off |
| Track 2 | Ch 2 | Off |
| Track 3 | Ch 3 | Off |
| Track 4 | Ch 4 | Off |

**In Schwung**, set each of slots 1–4 to receive on channels 5–8. Also set **Forward Channel** to **Auto** on each slot — *not* the default **Thru**, which silently blocks routing:

| Schwung slot | Rcv Channel |
|---|---|
| Slot 1 | Ch 5 |
| Slot 2 | Ch 6 |
| Slot 3 | Ch 7 |
| Slot 4 | Ch 8 |

This is a one-time setup. Once done, dAVEBOx's defaults Just Work. Full MIDI details: [Chapter 12](#12-midi-routing).

## 1.2 Find your way around

When dAVEBOx opens, you're in **Session View** — an 8×16 grid where each column is a track and each row is a *scene*. The currently active track is shown on the OLED with a 1px box drawn around its number (1–8) in the track row.

Two views, two ways to switch:

- Tap **Note/Session** to toggle Session ↔ Track View.
- Hold **Note/Session** to peek the other view momentarily (returns on release).

In **Track View**, switch the active track by:

- **Shift + jog rotate** — steps ±1 track per detent (clamped to 0–7).
- **Shift + bottom-row pad** — the 1st pad in the bottom row of the pad grid selects track 1, 2nd pad → track 2, and so on through pad 8 → track 8.

In **Session View**, tap any pad in a column to make that track active.

## 1.3 Make a kick pattern

Switch to **Track View** (tap Note/Session if you're not there already).

Convert track 1 to a drum track:

1. **Shift + Note/Session** opens the Global Menu.
2. Jog rotate until **Mode** is highlighted (under "Track [1] Config" at the top).
3. **Jog click** to enter edit mode for that field.
4. Jog rotate to select **Drum**, then **jog click** to commit.
5. Tap **Note/Session** to close the menu.

Track 1 is now a drum track. The left 4×4 of the pad grid is 16 drum lanes; the right 4×4 is a velocity zone (default).

- Tap any left-side pad — that lane plays its sound and becomes the active lane (its LED pulses).
- With a lane selected, tap **step buttons 1–16** above the pad grid to add hits at those positions.
- Press **Play** to start transport.

You've made a one-bar drum pattern.

## 1.4 Add a melodic part

Switch to **track 5**: hold **Shift** and tap the 5th pad in the bottom row of the pad grid. Track 5 is melodic by default and routes to Schwung's slot 1.

The pad grid now plays scale-snapped notes. The active scale's root is lit in the track color.

- Tap pads to hear Schwung respond.
- Hold a pad, then tap a step button: that step is armed with the held note.
- Hold two pads at once and tap a step for a chord (up to 4 notes per step).

## 1.5 Try the effects chain

Each track runs notes through a chain of seven banks. Rotate the jog wheel to cycle banks (no modifier held):

```
CLIP → NOTE FX → HARMONY → DELAY → SEQUENCE ARP → ARP IN → CC AUTOMATION
```

Stop on **DELAY**. Turn knob **K3** (Rep — number of echoes) to 3 or 4. Listen: each note now has a tail. Now turn **K5** (Pfb — pitch feedback) to +5, and the echoes climb a fifth above each other.

Every parameter you turned is **per-clip**. Switch to a different clip on this track using one of the **four side clip buttons** on Move's left edge — the parameters now reflect that clip's settings. The same notes sound completely different per clip.

## 1.6 Save your work

**Shift + Note/Session** opens the menu. Jog rotate to **Save**, then jog click. dAVEBOx confirms with "STATE SAVED" on the OLED.

dAVEBOx also auto-saves when you press **Back** to suspend, or when you fully exit (Shift + Back, or **Quit** from the menu).

That's the whole picture. The rest of this manual fills in the details.

---

# 2. The Mental Model

Three concepts run through every part of dAVEBOx. Once they're clear, everything else hangs off them.

## 2.1 Tracks, clips, scenes

dAVEBOx has **8 tracks**. Each track holds **16 clips**. Each clip holds **notes** (or drum hits) *plus its own effects-chain settings*. A row of clips across all 8 tracks is a **scene**.

```
            T1   T2   T3   T4   T5   T6   T7   T8
Scene 1   [ A ][ A ][   ][ A ][ A ][   ][   ][   ]
Scene 2   [ B ][ B ][   ][ B ][ B ][   ][   ][   ]
Scene 3   [   ][   ][ A ][   ][   ][ A ][ A ][ A ]
…
Scene 16
```

Clips on a track play one at a time. Launching a new clip on a track replaces what was playing on that track only; other tracks keep going. Launching a *scene* swaps every track at once.

> **Connection point.** Because effects parameters live *with the clip*, switching clips is also a sound-design change. Switching scenes is sound design across the whole instrument. You're sequencing not just notes, but transformations — and the scene grid is your arrangement.

## 2.2 Two views

dAVEBOx has two main views. Tap **Note/Session** to switch.

| | Track View | Session View |
|---|---|---|
| **Purpose** | Edit one clip in detail | Launch and arrange clips across all tracks |
| **Pad grid** | Plays notes (melodic) or drum lanes (drum) | Shows the clip grid (8 cols × 8 visible rows of 16) |
| **Step buttons** | The active clip's step pattern | Scene launchers (rows 1–16) |
| **Jog wheel** | Cycle effects banks | Scroll scene rows |
| **Side clip buttons** | Switch clip on the focused track | Launch full scene rows |

**Holding** Note/Session momentarily peeks the other view — release to return. Useful for spot-checking arrangement without losing your editing focus.

## 2.3 The effects chain

Every note in dAVEBOx — whether sequenced, played live on the pads, or arriving over external MIDI — passes through the same chain before it reaches a sound source:

```
 LIVE INPUT (pads, ext MIDI) ──> [ARP IN] ──┐
                                            ├─> NOTE FX ─> HARMONY ─> DELAY ─> SEQUENCE ARP ─> OUTPUT
 SEQUENCED NOTES ───────────────────────────┘
```

- **ARP IN** intercepts live input only. Sequenced notes skip it.
- **NOTE FX** transforms each note: octave, semitone offset, pitch randomness, gate, velocity, quantize.
- **HARMONY** adds extra voices on top: unison, octave, two harmony intervals.
- **DELAY** generates rhythmic echoes with pitch and velocity feedback.
- **SEQUENCE ARP** is a step-arpeggiator after delay. Set Style to Off and use the step mask alone, and it acts as a per-clip trance gate.

After this chain, global **Swing** is applied. If a Performance Mode loop is active, its mods are applied last.

> **Connection point.** The chain runs in *one direction*. **Live Recording** captures what you play *before* the chain runs (so the recorded notes still get transformed every playback). **Bake** captures what the chain *produces* and writes it back as note data (the FX go away). **Live Merge** captures the running output into a new clip. Each one freezes a different snapshot of the same flow.

## 2.4 Where settings live

dAVEBOx has three scopes for settings. This table tells you where each lives — and therefore what changes when, and what gets saved.

| Scope | What's stored here | When it changes |
|---|---|---|
| **Per-clip** | Notes; NOTE FX, HARMONY, DELAY, SEQUENCE ARP params; CLIP-bank params (length, resolution); CC automation data | Switching clips on that track |
| **Per-track** | MIDI channel, route, mode, VelIn, Looper-on, ARP IN params, CC assignments, octave shift | Switching tracks |
| **Global** | BPM, key, scale, scale-aware, swing, launch quantization, metronome, MIDI-in channel, mute/solo state and snapshots, Performance Mode mods and presets | Never (unless you change them) |

Drum tracks add a fourth scope: **per-lane**. Each of the 32 lanes has its own loop length, resolution, MIDI note assignment, repeat gate mask, and groove settings — all stored within the active clip.

## 2.5 Melodic vs drum tracks

A track is either melodic or drum (set in Track Config). They share most concepts but differ in a few important ways.

| | Melodic | Drum |
|---|---|---|
| **Pad grid** | Plays scale-snapped notes; Up/Down shifts octave | Left 4×4 plays 32 drum lanes (banked A/B); right 4×4 is a function area (Velocity / Rpt1 / Rpt2) |
| **Step buttons** | One pattern per clip | One pattern *per lane*; switch lanes to see different patterns |
| **Banks available** | CLIP, NOTE FX, HARMONY, DELAY, SEQUENCE ARP, ARP IN, CC AUTOMATION | DRUM LANE (replaces CLIP), NOTE FX (limited), DELAY, REPEAT GROOVE, CC AUTOMATION, ALL LANES — HARMONY and SEQUENCE ARP hidden |
| **Per-clip independence** | Notes + FX per clip | Notes + FX per clip, *and* per lane within the clip |

Drum tracks unlock per-lane loop lengths (polyrhythm with no setup) and Note Repeat (live drum rolls). They lose live harmony and the step-arp on the chain.

---

# 3. Navigation & Layout

## 3.1 Move hardware controls

For full visual reference, see Ableton's [Move manual](https://www.ableton.com/en/move/manual/). An approximation of the layout used throughout this manual:

```
   ┌─────────────────────────────────────────┐
   │              OLED display               │   (vol)
   └─────────────────────────────────────────┘

           K1   K2   K3   K4   K5   K6   K7   K8       (jog)

       ┌──┐   ┌──┬──┬──┬──┬──┬──┬──┬──┐
       │c1│   │  │  │  │  │  │  │  │  │   R3
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │c2│   │  │  │  │  │  │  │  │  │   R2
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │c3│   │  │  │  │  │  │  │  │  │   R1
       ├──┤   ├──┼──┼──┼──┼──┼──┼──┼──┤
       │c4│   │  │  │  │  │  │  │  │  │   R0   ← Shift + this row switches tracks 1–8
       └──┘   └──┴──┴──┴──┴──┴──┴──┴──┘

            [s1][s2][s3][s4][s5][s6][s7][s8][s9]…[s16]

       (Modifier and transport buttons along the right side and bottom edge:
        Shift · Note/Session · Up · Down · Capture · Copy · Delete ·
        Play · Record · Mute · Sample · Loop · Undo · Back · ◁ · ▷)
```

Throughout this manual:

- **K1–K8** — the eight macro knobs above the pad grid, left to right.
- **Jog wheel** — clickable encoder on the right side. "Jog rotate" turns it; "jog click" presses.
- **Volume encoder** — at the top right of the device. Master output only; passed through to Move's firmware.
- **R0–R3** — the four rows of the pad grid, bottom to top.
- **Side clip buttons** — the four buttons on the **left** of the pad grid (called "track buttons" in Move's native UI; repurposed by dAVEBOx as clip-switch buttons on the active track).
- **Step buttons** — the 16 buttons below the pad grid; used for sequencing and Shift-shortcuts.
- **Modifier buttons** — Shift, Note/Session, Up, Down, Capture, Copy, Delete.
- **Transport buttons** — Play, Record, Mute, Sample, Loop, Undo, ◁, ▷.
- **Back** — suspends dAVEBOx (sequencer keeps playing). **Shift + Back** fully exits.

There is **no dedicated row of 8 track-select buttons**. To change the active track:

- **Shift + jog rotate** (Track View) steps ±1 track per detent, clamped 0–7.
- **Shift + bottom-row pad** (Track View) — pad 1 → track 1, pad 2 → track 2, … pad 8 → track 8.
- **Tap any pad in a column** (Session View) sets that column's track as active.

The active track is shown on the OLED as a 1px box drawn around its number (1–8) in the track row.

## 3.2 Track View

The primary editing environment. Shows the active track and clip.

| Control | Action |
|---|---|
| Pads | Play notes (melodic) or trigger drum lanes (drum) |
| Step buttons 1–16 | Toggle steps in the active clip |
| Side clip buttons (4, left edge) | Switch between clips on the active track |
| K1–K8 | Adjust parameters in the active bank |
| Jog rotate | Cycle parameter banks |
| Shift + jog rotate | Switch tracks 1–8 |
| Shift + bottom-row pad (1–8) | Switch to that track |
| Loop (held) | Enter pages / loop view — step buttons now show pages of the clip |
| Loop (held) + jog | Adjust clip length ±1 step per detent |
| Loop (held) + two step buttons | Set loop start and end (defines the loop range across pages) |
| Up / Down | Shift the pad octave range (−4 to +4) |
| Left / Right arrows | Navigate clip pages (for clips longer than 16 steps) |
| Note/Session (tap) | Switch to Session View |
| Note/Session (hold) | Momentary peek at Session View |
| Volume encoder | Master output volume (handled by Move firmware) |
| Delete + jog click | Reset all params in the active bank |
| Shift + Delete + jog click | Reset all play FX across every bank (active clip/lane) |

The OLED shows the active bank's parameters across all 8 knobs. Touching a knob highlights its row. The LED below each knob lights when that parameter has been changed from its default.

## 3.3 Session View

The 8×16 clip grid. 8 rows are visible at a time; scroll to reach all 16.

| Control | Action |
|---|---|
| Tap a clip pad | Launch or queue that clip |
| Tap an empty clip pad | Focus it for recording |
| Shift + clip pad | Launch the clip *and* jump to Track View focused on it |
| Scene launcher (left of each row) | Launch all 8 clips in that row |
| Step buttons 1–16 | Also launch the corresponding scene row |
| Jog rotate | Scroll scene rows |
| +/− buttons | Scroll by 4 rows at a time |
| Hold Mute + pad | Mute / unmute that pad's track |
| Shift + Mute + pad | Solo / unsolo that pad's track |
| Delete + Mute | Clear all mutes and solos |
| Loop (tap) | Lock Performance Mode |
| Loop (hold) | Temporary Performance Mode |
| Shift + Loop | Toggle Perf Mode latch mode |

The active track is shown on the OLED's track row as a 1px box drawn around its track number (1–8). Each track's currently-focused clip slot shows dark grey in Session View, so you can always see which slot is in focus.

## 3.4 The Global Menu

Open with **Shift + Note/Session**. Jog to navigate; click to enter edit mode; click again or jog click to commit; **Note/Session** to close.

While the menu is open, pads, step buttons, and side clip buttons keep functioning normally — only the jog wheel is captured by the menu. This means you can keep playing while you edit settings.

The menu starts with **Track [N] Config** (the *active* track's configuration; updates live if you switch tracks while the menu is open). Below a `── Global ──` divider, all global items follow.

See [Chapter 13](#13-global-settings) for every item in the menu.

## 3.5 Shift+Step shortcuts

In Track View, while you hold **Shift**, step buttons that have an available shortcut blink to indicate they're active. The icon-row LEDs (above each step button) light too.

| Step | Action |
|---|---|
| 2 | Open BPM menu |
| 5 | Open Tap Tempo screen |
| 6 | Metro toggle (Cnt-In ↔ Always) |
| 7 | Open Swing menu |
| 8 | **Drum:** cycle right-pad mode (Velocity / Rpt1 / Rpt2) — same as jog click. **Melodic:** toggle chromatic pad layout |
| 9 | Open Key menu |
| 10 | VelIn toggle (Live ↔ Fixed 127) |
| 11 | **Melodic only:** ARP IN on/off |
| 15 | Double-and-fill loop |
| 16 | Quantize active clip 100% |

The Metro toggle here is intentionally narrow (binary): use the Global Menu for the full four-state setting (Off / Cnt-In / Play / Always). The **Mute + Play** shortcut in Track View flips Metro Off ↔ its previous non-Off state.

## 3.6 Quick navigation reference

| Where you are | What jog rotate does |
|---|---|
| Track View (default) | Cycle parameter banks |
| Track View + Shift held | Switch tracks 1–8 |
| Track View + Loop held | Adjust clip length ±1 step |
| Session View | Scroll scene rows |
| Global Menu open | Navigate / edit menu items |

| Where you are | What Note/Session does |
|---|---|
| Track View | Tap: go to Session View · Hold: peek Session View |
| Session View | Tap: go to Track View · Hold: peek Track View |
| Global Menu | Close the menu (also closes Tap Tempo, BPM menu, confirm dialogs) |
| Performance Mode (locked) | Closes perf, returns to Track View |

---

# Part II — Making Music

# 4. Sequencing

## 4.1 Step entry (melodic)

The 16 step buttons represent the current page of the active clip. Steps are either active (lit) or empty (dark) — there's no third state.

| Action | Behavior |
|---|---|
| Quick tap (<200ms) on empty step | Activates the step with the **last note played** on the pads |
| Quick tap on active step | Clears it (notes deleted immediately) |
| Hold (≥200ms) | Opens step edit overlay (see [§4.2](#42-step-edit)) |
| Tap multiple steps together | Toggles each one |

Steps beyond the clip's length light dark grey (out of bounds).

The step grid defaults to **1/16 resolution** — each step is a 16th note. Resolution is per-clip; change it in the CLIP bank (K4): values from 1/32 up to 1-bar.

> **Try this.** Set one clip to 1/32 resolution and another to 1/8. Sequence the same notes in both. Switch between them — same pattern, completely different feel.

### Pad layout

By default the pads show an **In-Key** layout: only notes within the active scale are present, arranged by octave, with the root lit in the track color. Press **Shift + Step 8** to toggle **Chromatic** layout — all 12 semitones visible, in-scale notes lit dim, root in track color.

**Up / Down** shifts the visible octave range (−4 to +4 octaves from default).

## 4.2 Step edit

Hold any step button to open the step edit overlay. Edits apply to *every* note in the step simultaneously, non-destructively relative to neighboring steps.

| Knob | Function |
|---|---|
| K1 (Oct) | Shift notes by octave |
| K2 (Pit) | Shift notes by scale degree (scale-aware) or semitone (scale-aware off) |
| K3 (Dur) | Adjust note length — touch shows a gate length overlay on the step buttons |
| K4 (Vel) | Adjust velocity |
| K5 (Ndg) | Shift notes forward/backward in time (±23 ticks max). Step blinks when notes are on the grid. Notes that cross into an adjacent step reassign there on release. |

While holding a step, the OLED shows the notes in it, e.g. `C4 E4 G4`. **Up / Down** shifts the visible octave range to reach notes outside the current pad window.

Hold multiple step buttons at once to edit them all together.

## 4.3 Chord entry

Two methods work — use whichever feels natural:

- **Pad-first.** Hold one or more pads, then press a step button. All held notes are captured into that step at once.
- **Step-first.** Hold a step, then tap pads one at a time. Notes add additively. Tap a pad already in the step to remove it.

Both methods support up to four notes per step.

> **Try this.** Hold a step, press **Up** a couple of times to reach higher notes, then tap a pad — you've built a chord that spans more than the visible range.

## 4.4 Pages and loop view

When a clip is longer than 16 steps, it spans multiple pages. **Left / Right** navigate between pages. The OLED position bar at the bottom shows page structure and the playhead.

Hold **Loop** to enter pages view — each step button now represents a *bar* of the clip:

- **White** — currently selected bar
- **Track color** — bar is within the clip
- **Dim grey** — beyond clip length

While Loop is held, to change clip length: jog ±1 step per detent, or press two step buttons together to set start and end.

## 4.5 Live recording

Press **Record** to capture pad input into the active clip.

| Starting from | Behavior |
|---|---|
| Stopped | One-bar count-in (step buttons flash on each beat). Recording and transport start together when count-in ends. Pressing **Play** during count-in cancels both. |
| Playing | Recording arms immediately; no count-in. |

To stop: **Record** again (transport continues) or **Play** (also stops transport).

**Recording is always additive — existing notes are never erased.** To get a fresh take, clear the clip first (Delete + side clip button).

### Count-in pre-roll

Notes pressed in the last half-beat of the count-in are captured on **step 1** of the clip. They appear from the second loop pass onward — the system waits for the note to release and for the first full loop to complete before firing, to prevent double-triggering if the pad is still held when transport starts.

### Track switching while recording

While record-armed, switching tracks is free. Recording follows the focused track. Notes on the previous track are closed out cleanly; record arm stays on.

### Clip targeting

New recordings go into whichever clip slot is currently focused. To record into a specific clip, select it in Session View first, then switch to Track View and press Record. Targeting an *empty* clip with no preset length creates an adaptive clip — it grows until you stop recording. The OLED status bar shows **Adap** for adaptive or **Fix** for fixed-length.

### Undo

Arming live recording snapshots the clip. A single **Undo** reverts the entire recorded session. On drum tracks the snapshot covers all 32 lanes.

---

# 5. The Effects Chain

```
 LIVE INPUT ──> [ARP IN] ──┐
                           ├─> NOTE FX ─> HARMONY ─> DELAY ─> SEQUENCE ARP ─> OUTPUT
 SEQUENCED NOTES ──────────┘
```

Seven banks of parameters control every track. On melodic tracks, all seven are available. On drum tracks, **HARMONY** and **SEQUENCE ARP** are hidden (jog skips them) and **CLIP** is replaced by **DRUM LANE**; bank 7 becomes **ALL LANES**.

Rotate the **jog wheel** to cycle banks. The OLED shows all 8 knob parameters and their values. Touching a knob inverts its row to highlight it. The LED below each knob lights when that parameter has been changed from default.

Every parameter in NOTE FX, HARMONY, DELAY, SEQUENCE ARP, and CC AUTOMATION is **per-clip**. ARP IN is per-track. CLIP-bank settings (length, resolution, etc.) are per-clip.

### Destructive vs non-destructive

Bank parameters fall into two categories:

- **Non-destructive** (play FX) — applied at render time. The underlying notes aren't modified. Returning the knob to default leaves the clip unchanged. **NOTE FX, HARMONY, DELAY, SEQUENCE ARP, ARP IN** are all non-destructive.
- **Destructive** — modifies the underlying note data immediately. Returning the knob to default does *not* revert the change; use **Undo** instead. The **CLIP** bank (Stretch, Clock Shift, Nudge, Resolution, Length), the equivalent per-lane controls in **DRUM LANE**, and **ALL LANES K1–K3** (Stretch / Clock Shift / Nudge) are destructive.

**CC AUTOMATION** records automation data — recording adds points to the clip; reverting needs an explicit clear (Delete + jog click clears all; Delete + knob touch clears one).

### Resetting effects

- **Delete + jog click** — reset all params in the active bank for the active clip (or active lane on drum tracks).
- **Shift + Delete + jog click** — reset all play FX (every bank except CLIP) across the active clip. SEQUENCE ARP is excluded on drum lanes.
- **Shift + Delete + side clip button** — hard reset that clip: clears notes *and* resets all per-clip params. Undoable.

> **Try this.** Build a simple 4-note sequence. Dial DELAY Rep to 3 and Pfb to +7. Your sequence now generates its own counter-melody every loop.

---

## 5.1 CLIP bank

Timing and playback settings for the active clip. **K1–K5 are destructive** — they modify the note data directly. K8 (SeqFollow) is a display toggle and non-destructive. (On drum tracks, this slot is replaced by DRUM LANE — see [§6.5](#65-drum-lane-bank).)

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Stretch | One-shot. Each detent doubles (right) or halves (left) the clip. Blocked if compression would put two notes on the same step. |
| K2 | Clock Shift | Rotates all notes forward/backward by whole steps. Shows cumulative signed offset while held; resets to 0 on release. |
| K3 | Nudge | Shifts all notes at tick resolution. Shows offset while held; resets on release. Notes wrap at clip boundary. |
| K4 | Resolution | Per-clip playback speed: 1/32, 1/16 (default), 1/8, 1/4, 1/2, 1-bar. Rescales note positions proportionally. **Shift + K4** = Zoom mode: keeps absolute note positions, adjusts the step grid around them. |
| K5 | Length | Clip length in steps, 1–256. Immediate. |
| K8 | SeqFollow | On (default): Track View auto-scrolls to follow the playhead. Off: view stays put. |

K6 and K7 are unassigned on the CLIP bank.

## 5.2 NOTE FX bank

Non-destructive transforms applied to every note before output.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Octave | Shifts all notes up/down by octave |
| K2 | Offset | Shifts by semitones (or scale degrees when Scale Aware is on) |
| K3 | Pitch Random | 0 = off. 1–24 = max deviation. **Shift + turn** to select algorithm: **Walk** (default — each note steps ±1 from previous, accumulating), **Uniform** (random offset within range), **Gaussian** (offsets cluster around center). Scale-aware: random pitches stay in key. |
| K4 | Gate Time | Scales note duration 0–400%. 100% = unchanged. Below = staccato; above = legato. |
| K5 | Velocity | Scales note velocity |
| K6 | Quantize | Quantization amount applied at render time. **Melodic only.** |

K7 and K8 are unassigned on the NOTE FX bank (melodic).

**On drum tracks**, the NOTE FX bank is limited to **K1 (Gate), K2 (Vel), K3 (Qnt)** — applied to the active lane. K4–K8 are blocked. Use ALL LANES K4 to quantize every lane at once.

> **Try this.** Set Pitch Random to Walk at a low value (3–5) on a melody. The sequence drifts gradually rather than jumping — coherent variation without chaos.

## 5.3 HARMONY bank (melodic tracks only)

Adds harmonic voices on top of every note. Hidden on drum tracks.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Unison | Adds a unison voice |
| K2 | Octaver | Adds an octave voice |
| K3 | Hrm1 | Harmony voice 1 — semitones or scale degrees (Scale Aware) |
| K4 | Hrm2 | Harmony voice 2 — semitones or scale degrees (Scale Aware) |

K5–K8 are unassigned.

## 5.4 DELAY bank

A MIDI delay that generates rhythmic echoes of every note.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Delay Time | 1/64 through 1-bar with dotted variants and triplets for 1/16, 1/8, 1/4. Default: 1/8 dotted. Use Rep = 0 to bypass. |
| K2 | Lvl | Echo velocity level |
| K3 | Rep | Number of echoes. Default 0 (bypass). |
| K4 | Vfb | Velocity change per repeat |
| K5 | Pfb | Pitch shift per repeat — semitones or scale degrees |
| K6 | Gate | 0 = natural note length. 1–10 = fixed gate length applied to all echoes. |
| K7 | Clk | Timing shift per repeat |
| K8 | Rnd | Same range and algorithm options as NOTE FX K3 (**Shift + turn** for algorithm). Applies to echo pitches. |

> **Try this.** Time 1/16, Rep 4, low Vfb. Tap a chord on the pads — it cascades off in time, perfect for one-finger rhythmic textures.

## 5.5 SEQUENCE ARP bank (melodic tracks only)

A step arpeggiator that runs after Delay. Per-clip. Applies to both sequenced output and live pad input. Hidden on drum tracks.

The **Steps** field (K5) gates or skips slots within the arp's cycle, but only when an arp style is active — Style = Off short-circuits the entire engine, including the step gate.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off · Up · Down · Up/Down · Down/Up · Converge · Diverge · Play Order · Random · Random Other. Default: Off. |
| K2 | Rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1-bar |
| K3 | Oct | Bipolar. Positive = adds octaves above; negative = below. |
| K4 | Gate | 1–200%. 100% = note ends as next begins. Below = staccato; above = legato overlap. |
| K5 | Steps | Off · Mute · Skip. When Mute or Skip: **touch K5** to open the step velocity editor on the pads (8 columns × 4 rows: column = step, row = velocity level 10/52/94/127). |
| K6 | Rtrg | On (default): pattern resets to step 1 on each new note and at clip loop boundary. Off: arp runs free. |
| K7 | Sync | On (default): the first arp step waits for the next global rate boundary, locking phase with transport. Off: fires from anchor. |

## 5.6 ARP IN bank

A *live* arpeggiator for pad input and external MIDI. **Per-track**, not per-clip. Does not affect sequenced notes. On drum tracks, ARP IN is bypassed.

> **Connection point.** ARP IN only sees what you play live; SEQUENCE ARP only sees what's sequenced. They're two independent arpeggiators running in parallel on the same track. You can use both at once for different feels on live vs sequenced material.

**Latch shortcut.** While holding pads with ARP IN active, tap **Loop** to toggle latch on/off without entering the bank. **Delete + Loop** also unlatches.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off (disables arp) · Up · Down · Up/Down · Down/Up · Converge · Diverge · Play Order · Random · Random Other |
| K2 | Rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1-bar |
| K3 | Oct | −4 to +4. Negative = arpeggiate down; positive = up. 0 is skipped (−1 to +1). |
| K4 | Gate | 1–200% |
| K5 | Steps | Off · Mute · Skip. Touch K5 to open the step velocity editor. Mute: muted steps are rests, arp cycle continues underneath. Skip: muted steps removed from cycle entirely. |
| K6 | Rtrg | On (default): pattern resets on each new note. Off: arp runs free. |
| K7 | Sync | On (default): waits for the next rate boundary before firing. Off: fires immediately on pad press. |
| K8 | Latch | Off · On. On: arp keeps running after release. First touch of a new gesture replaces the latched set; additional presses add notes. Latch resets on track switch or Session View entry. |

Quick toggle: **Shift + Step 11** flips ARP IN on/off using the last-used style.

> **Try this.** Enable ARP IN with Style = Up, Rate = 1/16, Latch = On. Play a chord, then switch to a different track. The arp runs hands-free on the first track while you sequence on the second.

## 5.7 CC AUTOMATION bank (melodic tracks only)

Each of the 8 knobs is independently assignable to a MIDI CC number. **CC assignments are per-track**; automation data is **per-clip** at 1/32 resolution with interpolation on playback. CC output follows the track's Route and MIDI channel.

To assign: **hold Shift + turn a knob** in the CC AUTOMATION bank. Jog to pick a CC number.

**Knob LED states (CC AUTOMATION bank only):**

| State | LED |
|---|---|
| Unassigned | Off |
| Assigned, no automation | White |
| Has automation for this clip | Vivid yellow |
| Recording armed (transport running + Record on) | Red — brightness scales with current CC value |
| Playback with automation | Green — brightness scales with automation value at playhead |

**Touch-record.** While recording is armed and transport is running, *holding* a knob arms touch-record for it: every 1/32 boundary, the knob's current value writes to the automation lane. Releases the touch ends touch-record. Touch-record overrides playback for that knob until cleared.

**Step-edit.** Hold a step while in CC AUTOMATION bank: the OLED shows "CC S1–S16" with a 4×2 knob grid. Each knob writes a staircase hold over the step.

**Clearing.** Delete + jog click clears all CC automation for the active clip. Delete + knob touch (or knob turn) clears that knob's automation only.

---

# 6. Drum Tracks

Drum mode reshapes a track for percussion: the pad grid becomes 32 lanes, each step pattern lives on a per-lane basis, and a Note Repeat system replaces the live arp.

## 6.1 Switching to drum mode

**Shift + Note/Session** → Track Config → **Mode = Drum**. The mode switch is immediate and **clears existing clip data on that track**.

## 6.2 Pad layout

| Pad block | Contents |
|---|---|
| Left 4×4 | 16 drum lane pads (bank A or B — jog click cycles modes, see below) |
| Right 4×4 | Function area — content depends on mode |

```
   ┌──────┬──────┐
   │ Left │Right │
   │ 4×4  │ 4×4  │
   │      │ mode │
   │lanes │ pads │
   └──────┴──────┘
```

Two banks of 16 lanes (A and B) give you 32 lanes total. The active bank is shown in the OLED.

**Right 4×4 modes** (cycle by tapping the jog wheel, or **Shift + Step 8**):

- **Velocity** (default). 16 zones from velocity 8 (bottom-left) to velocity 127 (top-right). Used for live monitoring, step-edit velocity, and recording.
- **Rpt1.** Single-lane Note Repeat. See [§6.7](#67-note-repeat).
- **Rpt2.** Multi-lane Note Repeat.

OLED shows `Vel`, `Rpt1`, or `Rpt2` to indicate the current mode.

## 6.3 Step sequencing on drums

Step sequencing is **per-lane** on drum tracks.

1. Tap a lane pad — it's now the active lane (its LED pulses).
2. Tap step buttons 1–16 to add or remove hits *for that lane*.
3. Switch to another lane and edit independently.

The step buttons always show the active lane's pattern.

To **select a lane silently** (without triggering its sound): hold **Capture** and tap the lane.

**Step edit on drum tracks** — hold a step button to open the overlay:

| Knob | Function |
|---|---|
| K3 (Dur) | Adjust the hit's gate length |
| K4 (Vel) | Adjust velocity |
| K5 (Ndg) | Nudge timing (±23 ticks max) |

K1 (Oct) and K2 (Pit) are not available in drum step edit. To change a lane's MIDI note, use DRUM LANE bank K7/K8.

## 6.4 Per-lane independence (the polyrhythm trick)

Each lane has its own **loop length** within the clip. Set with DRUM LANE bank K5 on the active lane, or hold **Loop** and jog.

> **Connection point.** This is the heart of dAVEBOx's drum design. Polyrhythmic textures need no special setup: just give each lane a different length. The clip's overall length is just the longest active lane.

> **Try this.** Set your kick to 16 steps, hi-hat to 12, and a percussion lane to 10. Each loops at its own rate against a shared transport — the pattern is technically 240 steps long before it repeats exactly.

## 6.5 DRUM LANE bank

Per-lane settings for the active lane. (This bank replaces CLIP on drum tracks; jog rotate from CLIP position lands here.) **K1–K5 are destructive** (modify per-lane note data); K6 (SeqFollow) is a display toggle; **K7–K8 (Lane Note Oct/Note)** change the lane's MIDI note assignment and persist.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Stretch | Per-lane beat stretch (one-shot). Blocked if compression impossible. |
| K2 | Clock Shift | Shifts the active lane only |
| K3 | Nudge | Nudges the active lane only |
| K4 | Resolution | Per-lane playback resolution |
| K5 | Length | Per-lane clip length |
| K6 | SeqFollow | Per-clip auto-scroll on/off |
| K7 | Oct (Lane Note) | Shifts the active lane's MIDI note by ±1 octave. OLED shows note name and number. |
| K8 | Note (Lane Note) | Shifts the active lane's MIDI note by ±1 semitone |

Lane MIDI note assignments persist across saves and reloads.

## 6.6 ALL LANES bank

Bank 7 on drum tracks. Applies parameters to all 32 lanes simultaneously. **K1–K3 are destructive** (modify note data across all lanes); **K4 (Qnt)** is non-destructive playback quantize; **K5 (VelIn)** and **K6 (InQ)** are track-config settings and don't modify existing note data.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Stretch | Beat stretch applied atomically. If any lane can't compress or expand, the operation is a no-op ("NO ROOM" popup). |
| K2 | Clock Shift | Shifts all lanes |
| K3 | Nudge | Nudges all lanes |
| K4 | Quantize | Playback quantize for all 32 lanes |
| K5 | VelIn | Velocity input override for this track |
| K6 | InQ | Recording input quantize (Off · 1/32 · 1/16 · 1/8 · 1/4 · 1/4T · 1/8T · 1/16T · 1/32T) |

K7 and K8 are unassigned.

## 6.7 Note Repeat

Note Repeat retriggers drum lanes at rhythmic intervals. Two modes are available — **Rpt1** (single-lane) and **Rpt2** (multi-lane).

### Right-pad layout (Rpt1 and Rpt2)

```
   Row 3 (top)    [Gate steps 0-3]      ←  gate mask
   Row 2          [Gate steps 4-7]      ←  gate mask
   Row 1          [1/32T 1/16T 1/8T 1/4T]  ←  triplet rates
   Row 0 (bottom) [1/32  1/16  1/8  1/4 ]  ←  straight rates
```

### Rpt1 — single-lane

- **Hold a rate pad** to retrigger the active lane at that rate. Release stops.
- Velocity is pressure-sensitive (aftertouch); VelIn override applies.
- Switch lanes while holding a rate pad without interrupting the repeat.

### Rpt2 — multi-lane

- **Tap a rate pad** to *assign* it to the active lane (doesn't trigger on its own).
- **Hold a lane pad** to repeat that lane at its assigned rate.
- Hold multiple lane pads simultaneously — each repeats independently at its rate.
- Velocity is pressure-sensitive per held pad.

### Latching

**Rpt1:** Loop + rate pad starts and latches. While holding a repeat, tap Loop to latch. Press the active rate pad again, or **Delete + Loop**, to stop.

**Rpt2:** Loop + lane pad latches that lane. Hold a lane + Loop latches all currently-held lanes. Tap a latched lane to unlatch it. **Delete + Loop** stops all.

### Gate mask

The top 2 rows of the right 4×4 (8 pads) form a looping **gate mask**:

- All 8 steps active by default.
- Tap to toggle a step off (rest); tap again to restore.
- Per-lane; persists across clip/track switches and save/load.
- OLED shows each step as a solid bar (active) or empty outline (off).
- **Delete + gate mask pad** resets that step's velocity scaling and nudge offset to defaults (doesn't affect the gate toggle).

**Repeat loop length.** Hold **Loop + tap a gate pad** to set the repeat cycle length (1–8 steps). Gate pads beyond cycle length go dark.

### REPEAT GROOVE bank

Available on drum tracks when a repeat mode is active (replaces ARP IN slot). Per-lane, persists.

- **K1–K8, unshifted** — velocity scaling per gate step. Range 0–200%. Default 100%. Applied to the pressure-sensitive velocity input.
- **K1–K8, Shift held** — nudge offset per gate step. Range −50% to +50% of step interval. Stored as percentage so the groove shape is consistent at every rate.

**Delete + jog click** (in Rpt1 or Rpt2): resets the entire groove for the current lane — all gates on, all velocity 100%, all nudge 0%.

> **Try this.** In Rpt2, assign different rates to different lanes (kick = 1/4, hi-hat = 1/16, snare = 1/8). Hold all three simultaneously for a driving pattern, then release individual lanes to strip it back.

## 6.8 Lane mute / solo

- **Mute lane:** Mute + lane pad
- **Solo lane:** Shift + Mute + lane pad
- **Select silently:** Capture + lane pad

Mute and solo are mutually exclusive: soloing a muted lane clears its mute; muting a soloed lane clears its solo.

## 6.9 Drum loop view

Hold **Loop** on a drum track to see pages view on the step buttons:

- Pages with notes: pulse between track color and off
- Empty pages within clip length: solid track color
- Pages beyond clip length: dim grey

## 6.10 Lane and clip copy / cut

**Lane copy (Track View):**

- **Copy + lane pad** — source blinks white.
- **Press another lane pad** — pastes all step data. Destination lane's MIDI note is preserved.
- Clipboard is sticky (paste to multiple lanes without re-selecting source).
- **Shift + Copy** = cut: source clears after first paste.

**Drum clip copy:** Same workflow as melodic clip copy (see [Chapter 11](#11-editing--copy-cut-paste-undo)) but copies all 32 lanes at once. Each destination lane's MIDI note is preserved. Works cross-track; pasting to a melodic track is ignored.

---

# Part III — Performance & Capture

# 7. Scenes

A **scene** is a row of clips across all 8 tracks. Launching a scene fires every clip in that row together.

## 7.1 Launching scenes

| Control | Behavior |
|---|---|
| Scene launcher (left of each Session row) | Launches the scene. Playing clips on each track stop at end of current bar; new clips start at the next bar boundary. |
| Step buttons 1–16 (Session View) | Also launch the corresponding scene row. |

Empty cells in the scene don't affect their column — that track keeps doing whatever it was doing.

## 7.2 Scene copy and cut

| Control | Behavior |
|---|---|
| Copy + scene row button | Copy all 8 clips in that row |
| Shift + Copy + scene row button | Cut the row |
| (after either) Press another scene row | Paste |

Mixing clip copy and scene-row copy (in the same press-and-paste sequence) is rejected.

## 7.3 Scene clear

| Control | Behavior |
|---|---|
| Delete + scene row button | Clears all notes from all 8 clips in that row. Clips stop playing. Undoable. |
| Shift + Delete + scene row button | Hard reset — clears notes **and** resets per-clip params for all 8 clips. Fires "CLIPS CLEARED" popup. Undoable. |

---

# 8. Performance Mode

Performance Mode is a real-time effect layer in Session View. It captures a short loop from the sequencer output and plays it back through a grid of live transformations.

## 8.1 Entering and exiting

Use the **Loop** button (in Session View):

| Action | Result |
|---|---|
| Tap Loop | **Lock** perf mode — persists hands-free. Loop blinks at 1/8-note rate. |
| Hold Loop | **Temporary** — pads active while held, exits on release. |
| Shift + Loop *or* tap **Latch** pad (R0-8) | Toggle latch mode. Toggling latch only changes how mod pads behave (sticky vs momentary) — it does **not** wipe currently active mods. |

While Loop is held to enter, press a **step button** to set the **capture length**:

| Step | Length | Step | Length (with Step 16 also held) |
|---|---|---|---|
| 1 | 1/32 | 1 | 1/32 triplet |
| 2 | 1/16 | 2 | 1/16 triplet |
| 3 | 1/8 | 3 | 1/8 triplet |
| 4 | 1/4 | 4 | 1/4 triplet |
| 5 | 1/2 bar | 5 | 1/2 bar triplet |
| 6 | 1 bar | 6 | 1 bar triplet |

The looper waits for the next aligned clock boundary (when Sync is on — default), captures, then loops continuously.

## 8.2 Per-track inclusion

Each track has a **Looper** flag in Track Config:

- **On** — the track feeds the looper and is silenced during loop playback.
- **Off** — the track plays through normally; the looper ignores it.

## 8.3 The mod grid

While Performance Mode is active (locked, held, or latched), the pad grid becomes 32 mod pads in 4 rows.

```
   R3 (top)   Wild mods       — cyan
   R2         Vel/Gate mods   — yellow
   R1         Pitch mods      — magenta
   R0 (bottom) length / hold / sync / latch — see below
```

Mods come from two sources that layer simultaneously:

- **Sticky mods** — set by latch-mode taps and by recalling a preset. Persist until you toggle them off (or recall a different preset, which replaces sticky mods with the preset's bits).
- **Momentary mods** — held with the mod pad while latch is off. Released when the pad is released.

**Pressing a mod pad whose LED is lit always clears that bit**, regardless of latch mode. This means you can take a recalled preset and dial individual mods off by tapping their pads.

### R0 — length and controls

| R0 Pad | Function |
|---|---|
| 1 | 1/32 capture |
| 2 | 1/16 capture |
| 3 | 1/8 capture |
| 4 | 1/4 capture |
| 5 | 1/2 bar capture |
| 6 | **Hold** — persistent hold mode (releasing a length pad doesn't stop the loop). Dim red when off, bright red when on. |
| 7 | **Sync** — toggle clock-aligned capture. On = wait for next boundary; Off = capture starts immediately. Dim green when off, bright green when on. |
| 8 | **Latch** — toggle latch mode (sticky vs momentary mod pads). Dark olive when off, bright green when on. |

Length pads (1–5) are dark grey when idle and bright white when their rate is engaged. None of the R0 pads blink — colors are static.

R0 covers 1/32 through 1/2 bar only. For 1-bar captures, use step button 6 while entering Performance Mode (Loop held).

### R1 — Pitch mods (magenta, melodic only — bypassed on drum tracks)

| Pad | Name | Behavior |
|---|---|---|
| 1 | Oct Up | Even cycles +1 octave; odd cycles original |
| 2 | Oct Down | Even cycles −1 octave; odd cycles original |
| 3 | Scale Up | +1/+2/+3 scale degrees across 3 cycles, then resets |
| 4 | Scale Down | −1/−2/−3 scale degrees across 3 cycles, then resets |
| 5 | Fifth | Ascends by 5th each cycle, then octave+2nd, then octave+5th |
| 6 | Tritone | Ascends by 4th, 6th, octave+2nd across 4 cycles |
| 7 | Drift | ±1 scale degree random walk per cycle, accumulates up to ±6 |
| 8 | Storm | Each note gets a random ±6 scale degree shift every play — chaotic but always in key |

### R2 — Velocity and gate mods (yellow, applies to all tracks)

| Pad | Name | Behavior |
|---|---|---|
| 1 | Decrescendo | Vel ×0.85 per cycle — fades out over ~6–7 cycles |
| 2 | Swell | 16-cycle triangle wave — loud at 0 and 16, quietest at 8 |
| 3 | Crescendo | Vel ×1.15 per cycle |
| 4 | Pulse | Even cycles = full vel; odd cycles = 20% vel |
| 5 | Sidechain | Successive notes within each cycle get −15% vel per note |
| 6 | Staccato | Gates all notes to 1/8 of loop length |
| 7 | Legato | Gates all notes to full loop length |
| 8 | Ramp Gate | Gate ramps up across notes in cycle |

### R3 — Wild mods (cyan)

| Pad | Name | Behavior |
|---|---|---|
| 1 | Half Time | Every other cycle suppressed |
| 2 | 3 Skip | Every third cycle suppressed |
| 3 | Phantom | Ghost note 1 octave below each — quarter vel, short gate |
| 4 | Sparse | ~50% chance each note suppressed per cycle |
| 5 | Glitch | Each note ±2 scale degrees random shift |
| 6 | Stagger | Note 1 = original, note 2 = +1, note 3 = +2, etc. |
| 7 | Shuffle | Pitch order randomizes each cycle; drum hit order shuffles |
| 8 | Backwards | Pitch order reverses each cycle; drum sequence reverses |

> **Try this.** Activate Storm (R1-8) + Sparse (R3-4) + Decrescendo (R2-1) together. The result is an unpredictable, thinning-out melodic scatter that sounds nothing like the source pattern.

## 8.4 Preset slots

In Performance Mode, step buttons 1–16 are preset slots.

| Control | Behavior |
|---|---|
| Tap step | Recall slot — replaces sticky mods with the preset's bits. Tap the same slot again to clear. |
| Hold step ~0.75s | Save current mod state (sticky + held) to slot. Step double-blinks to confirm; OLED briefly shows `PERF PRESET / SAVED`. |
| Delete + step | Clear that slot. OLED shows `PERF PRESET / CLEARED`. |

After recalling a preset you can dial individual mods off by tapping their pads — preset bits become sticky in the same way latch-toggled bits are, so a single press clears them.

**Steps 1–8 are factory presets:**

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

**Steps 9–16 are user slots** — empty by default.

## 8.5 Loop control

- **Change length while running:** press a different length pad to queue — current cycle finishes, then a fresh capture begins.
- **Retrigger:** press the same length pad again to immediately recapture.
- **Lock vs Hold:** Lock mode (tap Loop) persists hands-free; Hold mode (hold Loop) is momentary.
- **Switching to Track View** unlocks and stops the loop, but preserves your mod state.

## 8.6 Persistence

Latched mods, latch mode, recalled preset slot, and user presets (slots 9–16) persist when you leave Performance Mode and across saves.

---

# 9. Bake and Live Merge

These are two ways to commit transformations into clip data. They operate on the same chain but from different angles.

> **Connection point.** **Bake** runs the chain *offline* on a clip's existing notes and writes the result back, then resets the chain to defaults. **Live Merge** captures the chain's *live* output into a new clip while it's running. Bake is deterministic; Live Merge captures one specific performance.

## 9.1 Bake

Press **Sample** to open the bake dialog.

### Melodic bake

Two dialogs in sequence:

1. **Loop count:** 1x / 2x / 4x / CANCEL (default 1x)
2. **WRAP TAILS?** YES / NO / CANCEL

- **1x** bakes the clip once.
- **2x / 4x** bake N loops end-to-end; delay echoes bleed from the end of each loop into the start of the next.
- **WRAP TAILS = YES** wraps delay echoes that fall past the clip end back to the beginning (useful for seamless looping).

The full chain runs: NOTE FX → HARMONY → DELAY → SEQUENCE ARP. Walk-mode Pitch Random produces independent sequences per loop.

### Drum bake

Three dialogs in sequence:

1. **CLIP / LANE / CANCEL** — choose mode
2. **1x / 2x / 4x / CANCEL** — loop count
3. **WRAP TAILS?** YES / NO / CANCEL

- **CLIP mode** — full chain runs per lane. HARMONY can move hits between lanes. Notes at pitches with no matching lane are dropped. All lane FX params reset to defaults.
- **LANE mode** — processes the active lane only. Captures velocity, gate, timing, and SEQUENCE ARP. Pitch transforms and HARMONY are not applied.

If the clip is empty, bake does nothing.

> **Try this.** Bake a clip at 4x, then load fresh effects on top of the baked result and bake again. Layer by layer, you can build patterns that would be impossible to sequence by hand.

## 9.2 Live Merge

Live Merge captures the active track's post-effects MIDI output into the first available empty clip slot, in real time.

| Step | Control |
|---|---|
| Arm | Shift + Sample (LED turns red) |
| Capture starts | When transport begins (LED turns green) |
| Stop | Sample — schedules stop at the next 16-step page boundary |
| Auto-stop | At 256 steps (max clip length) |

On melodic tracks, notes are captured with all effects applied. On drum tracks, captured notes are routed to matching lanes by pitch.

Undoable. If no empty clip slot is available, a "NO EMPTY CLIP SLOT" message appears.

### Cross-clip merging on the same track

The merge captures whatever's playing **on the merge track**, regardless of which clip that track is currently launching. Switch clips on the merge track mid-capture, and the new clip's output starts feeding the destination too. This lets you stitch together a composite clip from multiple sources: launch clip 1 for the verse, switch to clip 3 for the chorus, switch to clip 5 for a fill — the destination ends up with all of it merged in time.

> **Try this.** Sequence three short complementary patterns across clips 1, 2, and 3 of the same track. Arm Live Merge (Shift + Sample), start transport, then launch clip 1, clip 2, clip 3 in sequence — letting each play for a bar or two. Stop Merge. The destination clip holds the combined melody.

> **Try this.** Run a sequence with heavy Pitch Random and Delay for a while, then Live Merge it. You've captured the actual randomized output as fixed note data — a snapshot of one specific performance of the chain.

---

# Part IV — Studio

# 10. Mixing

## 10.1 Output volume

Turn the **Volume encoder** in Track View or Session View (no modifier held) to adjust master output level. The volume goes through Move's hardware audio path.

Per-track volume is not implemented in dAVEBOx — the Volume encoder is passed through to Move's firmware, which controls master output level only. For per-track levels, adjust the slot or instrument gain on the destination (Move's native track mixer or the Schwung slot's chain).

## 10.2 Mute

**Track View:**
- Press **Mute** to toggle mute on the focused track.

**Session View:**
- Hold **Mute + tap a pad** in a column to toggle mute on that track.

**Either view:**
- **Delete + Mute** clears all mutes and solos.

Mute button LED: blinking at 1/8 = muted; solid = soloed; off = neither.

## 10.3 Solo

**Track View:** **Shift + Mute** — toggle solo on the focused track.

**Session View:** Hold **Shift + Mute + tap a pad** in a column — toggle solo on that track.

Muting a soloed track clears its solo. Soloing a muted track clears its mute.

## 10.4 Mute/Solo snapshots

16 slots for saving and recalling mute/solo state (including per-lane drum mutes). In Session View, hold **Mute**: step buttons light up:

- **Light purple** — empty slot
- **Bright blue** — saved state

| Control | Behavior |
|---|---|
| Mute + hold a step ~0.75s | **Save** — step double-blinks to confirm |
| Mute + tap a lit step | **Recall** — all tracks jump to saved state immediately |
| Mute + Delete + step | **Clear** the slot |

Snapshots persist across reboots.

---

# 11. Editing — Copy, Cut, Paste, Undo

## 11.1 The sticky clipboard

The clipboard stays live after each paste — paste to multiple destinations from the same source without re-selecting. The clipboard clears when you release the Copy button.

## 11.2 Step copy (within a clip)

In Track View: **Copy + press source step** (source blinks white) → **press destination step**. Copies all data: notes, gate lengths, velocities, timing offsets. Same clip only.

## 11.3 Clip copy / cut

**Copy:** **Copy + press a side clip button** (Track View) or **clip pad** (Session View). Source blinks; "COPIED" pops up. Press destination to paste.

**Cut (Shift + Copy):** Same workflow, but the source clears after the first paste. "CUT" pops up first; "PASTED" on the paste.

## 11.4 Scene row copy / cut

| Control | Behavior |
|---|---|
| Copy + scene row | Copy all 8 clips in that row |
| Shift + Copy + scene row | Cut |
| (after either) Press another scene row | Paste |

Mixing clip kinds and scene-row kinds in a single press is rejected.

## 11.5 Drum lane copy

In Track View on a drum track: **Copy + source lane pad** → **destination lane pad**. All step data copies; destination lane's MIDI note is preserved.

## 11.6 Drum clip copy

Same workflow as melodic clip copy, but copies all 32 lanes. Each destination lane's MIDI note is preserved. Cross-track works; pasting to a melodic track is ignored.

## 11.7 Undo / Redo

dAVEBOx supports **one level** of undo and redo.

- **Undo** — Undo button
- **Redo** — Shift + Undo
- After undoing, performing any new action discards the redo state.
- If nothing to undo/redo, brief "NOTHING TO UNDO" / "NOTHING TO REDO" on OLED.

**Undoable actions** include: step clear, step copy, clip clear, clip copy/cut, hard reset (single clip or scene row), row clear, row copy, live recording session, bank param reset, full bank reset, Loop Double, drum lane copy/cut, drum clip copy/cut.

## 11.8 Clear and reset shortcuts

| Control (Track View) | Action |
|---|---|
| Delete + step | Clear that step |
| Delete + side clip button | Clear all notes in that clip |
| Shift + Delete + side clip button | Hard reset clip — clears notes **and** all per-clip params |
| Delete + jog click | Reset all params in the active bank (active clip/lane) |
| Shift + Delete + jog click | Reset all play FX across every bank (active clip/lane) |

| Control (Session View) | Action |
|---|---|
| Delete + clip pad | Delete clip immediately |
| Delete + scene row | Clear all notes in the row |
| Shift + Delete + scene row | Hard reset all clips in the row |
| Delete + Mute | Clear all mutes/solos |

---

# 12. MIDI Routing

## 12.1 The default setup

dAVEBOx ships configured to drive Move and Schwung simultaneously:

- **Tracks 1–4** → MIDI channels 1–4 → **Move's native instruments** (tracks 1–4 inside Move).
- **Tracks 5–8** → MIDI channels 5–8 → **Schwung** (slots 1–4).

For this to work, Move and Schwung need to receive on matching channels. Configure them as follows:

**Move tracks 1–4:**

| Move Track | MIDI In | MIDI Out |
|---|---|---|
| Track 1 | Channel 1 | Off |
| Track 2 | Channel 2 | Off |
| Track 3 | Channel 3 | Off |
| Track 4 | Channel 4 | Off |

Set **MIDI Out = Off** to prevent Move from echoing MIDI back out and creating a loop.

**Schwung slots 1–4:**

| Schwung Slot | Rcv Channel |
|---|---|
| Slot 1 | Channel 5 |
| Slot 2 | Channel 6 |
| Slot 3 | Channel 7 |
| Slot 4 | Channel 8 |

Also: each Schwung slot's **Forward Channel** must be set to **Auto** or a specific channel — not **Thru**. Thru is the default for new slots and will silently prevent channel routing from working.

Once configured, tracks 1–4 play Move instruments directly, and tracks 5–8 play through Schwung's chains.

## 12.2 Per-track channel and route

Each track independently configures:

- **Channel** — MIDI channel 1–16. Default: track N on channel N.
- **Route** — **Move** (native instruments), **Schwung** (internal chain), or **External** (USB-A out).

Both are set via **Track Config** in the Global Menu.

## 12.3 External MIDI input

dAVEBOx receives external MIDI from a controller connected to Move's USB-A port. Filter by channel in the Global Menu **MIDI In** field (All or 1–16).

External MIDI is always routed to the **active track**. Switching tracks closes notes cleanly on the previous track. External MIDI integrates with step input: playing a note while holding a step adds it to the step exactly like a pad would.

dAVEBOx rechannelizes incoming MIDI to match the active track's configured channel — your controller doesn't need to be on the synth's channel.

## 12.4 Live effects on external MIDI

| Route | Live effects on external MIDI |
|---|---|
| **Schwung** | Full chain applies — ARP IN, NOTE FX, HARMONY, DELAY all process external MIDI exactly like pad input. |
| **Move** | The effects chain does **not** apply. Notes reach the Move instrument directly, on the channel matching your controller's output. |
| **External** | The chain applies; output goes back out via USB-A. |

> **⚠ Important.** Routing live external MIDI through dAVEBOx's effect chain on Move-routed tracks causes an echo cascade that crashes the device. This is an architectural constraint and is the reason ROUTE_MOVE bypasses the chain for live input. Use **Schwung** routing if you need effects processing on a live external controller.

## 12.5 External MIDI output

When a track's Route is set to **External**, all MIDI output for that track goes out via USB-A:

- Sequencer playback
- Live pad input
- External MIDI input (echoed to USB-A)
- Full effects chain output
- ARP IN output
- Performance Mode mods

Notes are sent on the track's configured MIDI channel. Multiple tracks can all route to External simultaneously, enabling multi-timbral setups on one USB-A connection.

Transport stop sends note-offs for sounding notes. Delete + Play (stopped) sends a full panic on all channels.

## 12.6 CC automation output

CC automation runs at 1/32 resolution with interpolation on playback. On External-routed tracks, CCs are sent via USB-A. Per-track CC assignments and per-clip automation data are stored — see [§5.7](#57-cc-automation-bank-melodic-tracks-only).

---

# 13. Global Settings

Open the menu with **Shift + Note/Session**. Jog navigates; jog click enters edit; jog rotate changes the value; jog click commits; **Note/Session** closes.

## 13.1 Track Config

The first section, showing the **active** track's configuration. Header reads `Track [N] Config`. All values update live if you switch tracks while the submenu is open.

| Entry | Values | Notes |
|---|---|---|
| Channel | 1–16 | MIDI channel for this track |
| Route | Move · Schwung · External | Output routing |
| Mode | Melodic · Drum | Switches immediately; existing clip data is cleared |
| VelIn | Live · 1–127 | Live = raw velocity. Fixed value overrides all input velocity on this track, applied pre-sequencer. |
| Looper | On · Off | Whether this track feeds Performance Mode |

Below Track Config, a `── Global ──` separator divides Track Config from global items.

## 13.2 Global items

| Item | Description |
|---|---|
| **Metro** | Off · Cnt-In · Play · Always. Controls when the metronome click is audible. Count-in click plays on all 4 beats. **Shortcut:** Mute + Play in Track View toggles between Off and the last non-Off state. **Shift + Step 6** cycles between Cnt-In and Always only. |
| **Metro Vol** | 0–150%. 100% = full scale; 150% = hot. |
| **Tap Tempo** | Full-screen tap interface. Any pad tap calculates BPM from a rolling average. Jog adjusts ±1 BPM per detent. Jog click or Note/Session exits and applies. |
| **BPM** | Set tempo 40–250. Updates in real time. Note/Session cancels and restores previous. |
| **Key** | Global root note (A through G#) |
| **Scale** | Major · Minor · Dorian · Phrygian · Lydian · Mixolydian · Locrian · Harmonic Minor · Melodic Minor · Pentatonic Major · Pentatonic Minor · Blues · Whole Tone · Diminished |
| **Scale Aware** | On (default) / Off. When On, scale-aware parameters (NOTE FX Offset and Rnd, HARMONY Hrm1/Hrm2, DELAY Pfb and Rnd) step in scale degrees rather than semitones. Bypassed on drum tracks. |
| **Launch Quant** | Now · 1/16 · 1/8 · 1/4 · 1/2 · 1-bar (default). When set to Now, clip launches are immediate and legato if a clip is already playing. All other values wait for the next boundary and always start from the beginning. |
| **MIDI In** | All / 1–16. Channel filter for external MIDI input. |
| **Swing Amt** | 50%–75%. 50% = no swing. 66% = perfect triplet swing. Applied globally at render time. |
| **Swing Res** | 1/16 (default) · 1/8. Controls which note positions are affected by swing. |
| **Input Quantize** | On / Off. When On, live recorded notes snap to the current step grid. |
| **Beat Markers** | On / Off. When On, step buttons 1, 5, 9, 13 show a dim track-color marker in Track View when not otherwise active. |
| **Clear Session** | Resets the entire dAVEBOx instance. Presents a Yes/No dialog (defaults to No). Only the active set is affected. |
| **Save** | Closes the menu and saves DSP state and UI sidecar immediately. Shows "STATE SAVED". |
| **Quit** | Saves current state and exits dAVEBOx (equivalent to Shift+Back). |

---

# 14. State and Persistence

## 14.1 What saves and when

State is saved automatically when you:

- **Suspend** dAVEBOx (press **Back** — the sequencer keeps playing in the background).
- **Exit** dAVEBOx (**Shift + Back** or **Quit** in the Global Menu — equivalent).

Use **Save** in the Global Menu for an immediate manual save at any time.

State is **not** saved continuously during use.

## 14.2 What persists per set

- All note data (per clip, per track)
- Per-clip params (NOTE FX, HARMONY, DELAY, SEQUENCE ARP, CC AUTOMATION per clip)
- Track settings (channel, route, mode, octave shift, VelIn, Looper)
- CLIP-bank values per clip
- Global settings (BPM, key, scale, scale-aware, launch quant, metro, swing, MIDI in, beat markers)
- Mute / solo state and all 16 snapshots (including per-lane drum mutes)
- ARP IN per-track state (except latch, which resets on track switch / Session entry)
- Performance Mode user presets (slots 9–16) and currently-latched mods
- Note Repeat per-lane gate masks, groove, lengths

## 14.3 Set duplication and state inheritance

When you duplicate a Move set via the native set page, the new set inherits dAVEBOx state from the source on first launch. The exact behavior depends on how many known parent sets are found:

- **One known parent.** Silent auto-inherit, no dialog.
- **Zero known parents.** Silent blank start.
- **Two or more candidates.** A dialog appears: **"Copied Move set detected / Inherit dAVEBOx state from?"** with each candidate listed plus a **Start blank** option. Jog to navigate, jog click to confirm; **Sample** cancels (= Start blank).

Sources whose Move set has since been deleted are filtered out of the picker.

Selecting **Start blank** cleanly resets the DSP with no carryover.

## 14.4 Orphan cleanup

On launch, dAVEBOx prunes its own state files for any Move set that has been deleted. Schwung's files in those folders are left untouched.

---

# Part V — Reference

# 15. Limitations and Gotchas

These are real-world quirks worth knowing.

| Limitation | Notes |
|---|---|
| **External MIDI into Move-routed tracks bypasses the effects chain** | Routing live external MIDI through pfx on a Move-routed track causes an echo cascade and crashes the device. dAVEBOx skips the chain for live input on Move-routed tracks; the keyboard plays the Move track whose MIDI In matches the keyboard's channel. Use **Schwung** routing if you need effects on live external MIDI. |
| **Hardware volume knob briefly interrupts MIDI** when turned. Avoid adjusting during performance-critical moments. |
| **Powering Move off from within dAVEBOx causes a brief hang** before shutdown. |
| **Drum bake undo** restores notes but not per-lane FX params (pending fix). |
| **Recording with Input Quantize Off can double-swing** notes (swing applied on input AND on playback). |
| **CC automation lanes are not swung** (intentional — keeps automation precisely on the grid). |

---

# Appendix A — LED Reference

### Clip pads (Session View)

| State | LED |
|---|---|
| Empty slot | Off |
| Has content, inactive | Very dim track color |
| Active empty slot (focused) | Dark grey |
| Will relaunch when transport starts | Solid bright track color |
| Playing | Flash between dim and bright track color at 1/8-note rate |
| Queued to launch | Flash at 1/16-note rate |
| Queued to stop | Flash between dim and off at 1/16-note rate |

All playing clips flash in sync, locked to the main clock.

### Side clip buttons (Track View)

| State | LED |
|---|---|
| Currently editing (not playing) | Solid bright track color |
| Currently editing AND playing | Flash at 1/8-note rate |
| Other clips with content | Dim track color |
| Empty slots | Off |

### Step buttons (Track View)

| State | LED |
|---|---|
| Active step (has notes) | White |
| Inactive step within clip | Off (beat-marker positions 1/5/9/13 show dim track color when Beat Markers is on) |
| Out of bounds (beyond clip length) | Dark grey |
| Playhead position | Bright track color |

### Step buttons (Session View — scene scroll indicator)

| State | LED |
|---|---|
| Rows currently in view | Red (pulsing if any clip in that row is playing) |
| Rows out of view with playing clips | Pulsing white |
| Rows out of view with content | Dim white |
| Rows out of view, all empty | Off |

### Knob LEDs

**All banks except CC AUTOMATION:** Lit when the parameter has been changed from its default. Off when at default.

**CC AUTOMATION bank:**

| State | LED |
|---|---|
| Unassigned | Off |
| Assigned, no automation | White |
| Has automation for this clip | Vivid yellow |
| Recording armed | Red — brightness = current knob value |
| Playback with automation | Green — brightness = automation value at playhead |

### Mute button LED (Track View)

| State | LED |
|---|---|
| Active track muted | Blinking at 1/8 |
| Active track soloed | Solid |
| Neither | Off |

### Mute/Solo snapshot slots (Session View, while holding Mute)

| State | LED |
|---|---|
| Empty slot | Light purple |
| Saved state | Bright blue |

---

# Appendix B — OLED Reference

### Bank header format

All bank headers use `[ LABEL ]` format with spaces inside the brackets, e.g. `[ NOTE FX ]`, `[ DRUM LANE ]`.

On drum tracks, headers use a prefix convention to indicate context:

- `DRUM LANE >>` — the DRUM LANE bank itself (per-lane)
- `>> BANKNAME` — other per-lane banks (e.g. `>> NOTE FX`, `>> DELAY`)
- `ALL LANES` — no prefix

### Bank parameter display

All 8 parameters and their values are shown at once in Track View. Touching or turning a knob inverts that parameter's row (black text on white background). The highlight clears on release. The full overview is always visible — touching a knob never replaces it.

### Idle screen — melodic track

Two rows below the bank header.

**Row 1 (status bar):** Metro mode · VelIn indicator (Live or fixed value) · Fix / Adap recording indicator

| Indicator | Meaning |
|---|---|
| Fix | Clip has content or a preset length — recording loops at the existing size |
| Adap | Clip slot is empty with no preset length — recording grows until stopped |

**Row 2:** `Oct:+0` · `Arp` (only when ARP IN is active) · current key and scale right-aligned (`A Min`, `C# Pent+`). When Scale Aware is on, a 1px underline appears beneath key/scale.

### Idle screen — drum track

Below the bank header:

**Pad info row:** `Bank: A   Pad: C3 (48)` — shows the active bank (A or B) and the active lane's MIDI note name and number.

**Mute/solo row:** Mute/solo status for the active lane.

### Performance Mode

The OLED takes over while in Performance Mode (Loop held or perf view locked):

- **Header bar (top)** — preset name when a slot is recalled (e.g. `Float`, `Robot`); otherwise `PERFORMANCE`. White-on-black inverted bar.
- **Body** — abbreviated list of all currently active mods (sticky + held), e.g. `Oct+  Sc+  Drift  Sprs`. Up to four lines in a tiny pixel font. When no mods are active: `no mods active / tap pad to engage`.
- **Footer chips** — three small status indicators on the left and a rate chip on the right:
  - `Latch` — filled = latch mode on (mod pads sticky); outlined = momentary
  - `Hold` — filled when Hold pad is engaged or any rate is sticky-held
  - `Sync` — filled = clock-aligned capture; outlined = free capture
  - `1/4`, `1/16`, etc. on the right — current loop rate (only when a length is engaged)

Pressing a mod pad briefly replaces the body with the full mod name (e.g. `Scale Up`). Hold-saving a preset slot briefly replaces the body with `PERF PRESET / SAVED`; clearing a slot shows `PERF PRESET / CLEARED`.

### Track number row

Track numbers 1–8 distributed across the OLED width.

| State | Display |
|---|---|
| Active track | 1px box around the number |
| Muted track | Inverted (white bg, black number) |
| Soloed track | Blinking |

### Position bar

A segmented bar at the bottom of Track View showing the clip's page structure:

| Segment | Meaning |
|---|---|
| Solid block | Page currently in view |
| Outline box | Page the playhead is on (when different from view page) |
| Bottom edge line | Other pages with content |

A dot moves across the full bar tracking the playhead. When the dot crosses the solid block, it inverts to black to remain visible.

### Action pop-ups (~520 ms)

Dismissed immediately if you touch a knob or enter step edit.

| Action | Message |
|---|---|
| Copy source selected | COPIED |
| Cut source selected | CUT |
| Paste confirmed | PASTED |
| Clip clear | SEQUENCE CLEARED |
| Scene row clear | SEQUENCES CLEARED |
| Hard reset (single clip) | CLIP CLEARED |
| Hard reset (scene row) | CLIPS CLEARED |
| Bank param reset | BANK RESET |
| Full bank reset | CLIP PARAMS RESET |
| Loop double | LOOP DOUBLED |
| Loop double at max length | CLIP FULL |
| Perf preset saved (hold step in Perf Mode) | PERF PRESET / SAVED |
| Perf preset cleared (Delete + step in Perf Mode) | PERF PRESET / CLEARED |
| Beat stretch blocked (no room) | NO ROOM |
| Resolution zoom blocked | NOTES OUT OF RANGE |
| Beat stretch compress blocked | COMPRESS LIMIT |
| State saved | STATE SAVED |
| Undo | UNDO |
| Nothing to undo | NOTHING TO UNDO |
| Redo | REDO |
| Nothing to redo | NOTHING TO REDO |

---

# Appendix C — Controls Cheat Sheet

## Track View — melodic

| Control | Action |
|---|---|
| Pad | Play note; add to step if step held (step-first chord entry) |
| Pads held + step | Capture all held notes into that step (pad-first chord entry) |
| Up / Down | Shift pad octave range |
| Step (tap) | Add/remove hit; assigns last played note to empty steps |
| Step (hold ≥200ms) | Open step edit overlay |
| Multiple steps tapped | Toggle several at once |
| Side clip buttons (left edge, 4) | Switch active clip on the current track |
| Jog rotate | Cycle parameter banks |
| Shift + jog rotate | Cycle tracks 1–8 |
| Shift + bottom-row pad (1–8) | Switch to that track |
| Loop + jog rotate | Adjust clip length ±1 step |
| Delete + jog click | Reset params in active bank |
| Shift + Delete + jog click | Reset all play FX |
| Left / Right arrows | Navigate clip pages |
| Volume encoder | Master output volume |
| Play | Start / stop transport |
| Shift + Play | Restart transport from start |
| Loop + Play | Restart with active clip at the visible page's first step (other tracks land in sync) |
| Delete + Play (running) | Deactivate all clips |
| Delete + Play (stopped) | MIDI panic |
| Record | Start / stop recording |
| Capture | Capture played notes into clip |
| Loop | Enter pages / loop view |
| Mute | Toggle mute on active track |
| Shift + Mute | Toggle solo on active track |
| Delete + Mute | Clear all mutes/solos |
| Copy + step | Copy step → press dest step to paste |
| Copy + side clip | Copy clip → press dest |
| Shift + Copy + side clip | Cut clip |
| Delete + step | Clear step |
| Delete + side clip | Clear all notes in clip |
| Shift + Delete + side clip | Hard reset clip |
| Undo | Undo |
| Shift + Undo | Redo |
| Sample | Open bake dialog |
| Shift + Sample | Arm Live Merge |
| Note/Session (tap) | Switch to Session View |
| Note/Session (hold) | Momentary peek at Session View |
| Shift + Note/Session | Open Global Menu |
| K1–K8 | Adjust parameter in active bank |
| Shift + K4 (CLIP bank) | Resolution Zoom mode |
| Shift + Step 2 | BPM menu |
| Shift + Step 5 | Tap tempo |
| Shift + Step 6 | Metro toggle (Cnt-In ↔ Always) |
| Shift + Step 7 | Swing menu |
| Shift + Step 8 | Toggle chromatic pad layout |
| Shift + Step 9 | Key menu |
| Shift + Step 10 | VelIn toggle (Live ↔ Fixed 127) |
| Shift + Step 11 | ARP IN on/off |
| Shift + Step 15 | Double-and-fill loop |
| Shift + Step 16 | Quantize clip 100% |
| Mute + Play | Metro toggle (Off ↔ last non-Off) |

## Track View — drum

All melodic Track View controls apply except as noted below.

| Control | Action |
|---|---|
| Lane pad (left 4×4) | Trigger lane / select as active |
| Capture + lane pad | Select lane silently (no trigger) |
| Jog click | Cycle right-pad mode: Velocity → Rpt1 → Rpt2 |
| Shift + Step 8 | Cycle right-pad mode (same as jog click) |
| Step (tap) | Add/remove hit on active lane |
| Step (hold) | Open step edit overlay for active lane (K3/K4/K5 only) |
| Mute + lane pad | Mute / unmute lane |
| Shift + Mute + lane pad | Solo / unsolo lane |
| Delete + Loop | Stop all latched repeats |
| Delete + jog click (Rpt1 or Rpt2) | Reset groove for active lane |
| Loop + rate pad (Rpt1) | Start and latch repeat at that rate |
| Loop + lane pad (Rpt2) | Latch repeat on that lane |
| Held lanes + Loop (Rpt2) | Latch all currently held lanes |
| Loop + gate mask pad | Set repeat cycle length (1–8) |

### Step edit on drum tracks

| Control | Action |
|---|---|
| Hold step + K3 | Adjust gate length |
| Hold step + K4 | Adjust velocity |
| Hold step + K5 | Nudge timing |

## Session View

| Control | Action |
|---|---|
| Clip pad (tap) | Launch or queue clip |
| Clip pad (tap, playing) | Queue clip to stop at end of bar |
| Empty clip pad (tap) | Focus for recording |
| Shift + clip pad | Launch and jump to Track View |
| Scene launcher | Launch full scene row |
| Step buttons 1–16 | Launch corresponding scene row |
| Jog rotate | Scroll scene rows |
| +/− | Scroll by 4 rows |
| Tap a pad in any column | Sets that track as active |
| Volume encoder | Master output volume |
| Play | Start / stop transport |
| Shift + Play | Restart from start |
| Delete + Play (running) | Deactivate all clips |
| Delete + Play (stopped) | MIDI panic |
| Mute + clip pad | Mute / unmute track |
| Shift + Mute + clip pad | Solo / unsolo track |
| Delete + Mute | Clear mutes/solos |
| Mute (held) + step (tap) | Recall mute/solo snapshot |
| Mute (held) + step (hold ~0.75s) | Save snapshot |
| Mute + Delete + step | Clear snapshot slot |
| Copy + clip pad | Copy clip |
| Shift + Copy + clip pad | Cut clip |
| Copy + scene row | Copy scene row |
| Shift + Copy + scene row | Cut scene row |
| Delete + clip pad | Delete clip |
| Delete + scene row | Clear all notes in row |
| Shift + Delete + scene row | Hard reset row |
| Undo | Undo |
| Shift + Undo | Redo |
| Loop | Enter Performance Mode |
| Shift + Loop | Toggle Perf Mode latch |
| Note/Session (tap) | Switch to Track View |
| Note/Session (hold) | Momentary peek at Track View |
| Shift + Note/Session | Open Global Menu |

## Performance Mode (Session View + Loop)

| Control | Action |
|---|---|
| Loop (tap) | Lock Perf Mode on / off |
| Loop (hold) | Temporary — active while held |
| Shift + Loop | Toggle latch mode |
| R0 length pads 1–5 (1/32 – 1/2) | Set capture length, trigger capture |
| Step 6 (while holding Loop to enter) | 1-bar capture length |
| Step 16 (held) + length pad | Triplet variant of that length |
| R0 Hold pad | Persistent hold — loop continues after release |
| R0 Sync pad | Toggle clock-aligned capture |
| R0 Latch pad | Toggle latch mode |
| R1 pads (magenta) | Pitch mods |
| R2 pads (yellow) | Velocity / gate mods |
| R3 pads (cyan) | Wild mods |
| Tap mod pad (lit) | Clear that mod (works in either latch state) |
| Step (tap) | Recall preset slot — replaces sticky mods |
| Step (hold ~0.75s) | Save current mods to slot |
| Delete + step | Clear preset slot |

## Loop / Pages View (Track View + Loop held)

| Control | Action |
|---|---|
| Jog rotate | Adjust clip length ±1 step |
| Two step buttons | Set loop start and end |
| Step (tap) | Select bar |
| Play | Restart with active clip at the visible page's first step (other tracks land in sync) |
| Delete | Delete active clip |
| Delete + step | Clear all notes in that bar |
| Copy + step | Copy bar |
| Shift + Step 15 | Double-and-fill loop |

## Step edit overlay (Track View — hold a step)

| Control | Action |
|---|---|
| K1 | Shift notes by octave |
| K2 | Shift notes by scale degree |
| K3 | Adjust gate length |
| K4 | Adjust velocity |
| K5 | Nudge timing (±23 ticks) |
| Up / Down | Shift pad octave range |
| Pads | Add/remove notes (step-first chord entry) |
| Multiple steps held | Apply edits to all held steps |

## Global Menu (Shift + Note/Session)

| Control | Action |
|---|---|
| Jog rotate | Navigate items |
| Jog click | Enter edit mode / confirm |
| Jog rotate (in edit) | Change value |
| Jog click (in edit) | Confirm and exit |
| Note/Session | Close menu |
| Pads / step buttons | Function normally while menu is open |
