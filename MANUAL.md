# The dAVEBOx Manual

dAVEBOx is an 8-track MIDI sequencer for Ableton Move. It runs as a tool module inside the [Schwung](https://github.com/charlesvestal/schwung) framework and uses Move's pads, knobs, and screen. dAVEBOx generates no audio of its own — every note it produces is handed off to Move's native instruments, to Schwung's effect chains, or to an external synth over USB-A.

Sequence melodic parts and drums on the same instrument. Build patterns one step at a time or jam them in live. Run notes through arpeggiators, harmonizers, delays, and a per-step sequence arp. Capture short loops and transform them in real time. Save 16 clip variations per track and fire them as scenes.

This manual is written for two readers: someone who just powered the device on, and someone who knows their way around and needs to look something up. The first three chapters teach the system. Everything after is reference.

---

## How to read this manual

| If you are… | Start here |
|---|---|
| New to dAVEBOx | **Chapter 1 (Quick Start)**, then skim **Chapter 2 (The Mental Model)** |
| Comfortable, looking for depth | Jump to the chapter for the feature you want |
| Looking up a control | **Appendix C — Controls Cheat Sheet** |
| Decoding a screen or LED | **Appendix A — LED Reference** · **Appendix B — OLED Reference** |

Every chapter is self-contained. Cross-references are explicit when one feature depends on another. Throughout, boxed notes flag three kinds of aside:

> **Try this.** A hands-on example worth playing with.

> **Connection point.** How this feature relates to another.

> **Advanced.** Power-user detail you can skip on a first read.

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

**Part III — Arranging & Performing**
7. [Scenes](#7-scenes)
8. [Performance Mode](#8-performance-mode)
9. [Bake & Live Merge](#9-bake--live-merge)

**Part IV — Studio**
10. [Editing — Copy, Cut, Paste, Undo](#10-editing--copy-cut-paste-undo)
11. [Mixing — Volume, Mute, Solo](#11-mixing--volume-mute-solo)

**Part V — Configuration**
12. [MIDI Routing](#12-midi-routing)
13. [Global Settings](#13-global-settings)
14. [State & Persistence](#14-state--persistence)

**Part VI — Reference**
15. [Limitations & Gotchas](#15-limitations--gotchas)
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

When dAVEBOx opens, you're in **Session View** — an 8×16 grid where each column is a track and each row is a *scene*. The active track is shown on the OLED with a 1px box drawn around its number (1–8).

Two views, two ways to switch:

- Tap **Note/Session** to toggle Session ↔ Track View.
- Hold **Note/Session** to peek the other view momentarily (returns on release).

In **Track View**, switch the active track by:

- **Shift + jog rotate** — steps ±1 track per detent (clamped to tracks 1–8).
- **Shift + bottom-row pad** — the 1st pad in the bottom row selects track 1, the 2nd selects track 2, and so on through pad 8 → track 8.

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
- With a lane selected, tap **step buttons 1–16** to add hits at those positions.
- Press **Play** to start transport.

You've made a one-bar drum pattern.

## 1.4 Add a melodic part

Switch to **track 5**: hold **Shift** and tap the 5th pad in the bottom row. Track 5 is melodic by default and routes to Schwung's slot 1.

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

**Shift + Note/Session** opens the menu. Jog rotate to **Save state**, then jog click. dAVEBOx confirms with "STATE SAVED" on the OLED. **Load state** brings any saved snapshot back (see [§3.5](#35-save-states-snapshots)).

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
- **HARMONY** adds extra voices on top: octave, three harmony intervals.
- **DELAY** generates rhythmic echoes with pitch and velocity feedback.
- **SEQUENCE ARP** is a step-arpeggiator after delay, with a per-step pitch/velocity mask. (The mask only applies while a Style is active — Style = Off bypasses the engine entirely.)

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

A track is either **Melodic** or **Drum** (set in Track Config). They share most concepts but differ in a few important ways.

| | Melodic | Drum |
|---|---|---|
| **Pad grid** | Plays scale-snapped notes; Up/Down shifts octave | Left 4×4 plays 32 drum lanes (banked A/B); right 4×4 is a function area (Velocity / Rpt1 / Rpt2) |
| **Step buttons** | One pattern per clip | One pattern *per lane*; switch lanes to see different patterns |
| **Banks available** | CLIP, NOTE FX, HARMONY, DELAY, SEQUENCE ARP, ARP IN, CC AUTOMATION | DRUM LANE (replaces CLIP), NOTE FX (limited), DELAY, REPEAT GROOVE, CC AUTOMATION, ALL LANES — HARMONY and SEQUENCE ARP hidden |
| **Per-clip independence** | Notes + FX per clip | Notes + FX per clip, *and* per lane within the clip |

Drum tracks unlock per-lane loop lengths (polyrhythm with no setup) and Note Repeat (live drum rolls). They lose live harmony and the step-arp on the chain.

**Switching Mode converts the track's notes.** Changing **Mode** carries the sequenced notes across all 16 clips into the new type — your part follows the track instead of disappearing. Only the notes move (timing, pitch, velocity, gate); effects, arpeggiator, and harmony reset to defaults.

- **Drum → Melodic** (sometimes called "Keys" for the pitched notes it produces): each lane's hits become pitched notes at the same times; hits that land together become chords. Converts immediately.
- **Melodic → Drum**: each distinct pitch maps to its own drum lane (lowest pitch on the first pad, ascending). A part using more than 32 distinct pitches keeps the 32 most-used. Because drum-specific settings (Note Repeat, per-lane grooves) have no melodic equivalent, this direction shows a **`Warning: Existing notes may be lost. Proceed?`** confirm first — *only* when the track actually has notes.

An empty track switches instantly with no prompt either way.

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
- **Side clip buttons** — the four buttons on the **left** of the pad grid. (Move's native UI calls these "track buttons"; dAVEBOx repurposes them to switch clips on the active track.)
- **Step buttons** — the 16 buttons below the pad grid; used for sequencing and Shift-shortcuts.
- **Modifier buttons** — Shift, Note/Session, Up, Down, Capture, Copy, Delete.
- **Transport buttons** — Play, Record, Mute, Sample, Loop, Undo, ◁, ▷.
- **Back** — suspends dAVEBOx (sequencer keeps playing). **Shift + Back** fully exits.

There is **no dedicated row of 8 track-select buttons**. To change the active track:

- **Shift + jog rotate** (Track View) steps ±1 track per detent.
- **Shift + bottom-row pad** (Track View) — pad 1 → track 1, pad 2 → track 2, … pad 8 → track 8.
- **Tap any pad in a column** (Session View) sets that column's track as active.

The active track is shown on the OLED as a 1px box drawn around its number (1–8).

## 3.2 Track View

The primary editing environment. Shows the active track and clip.

| Control | Action |
|---|---|
| Pads | Play notes (melodic) or trigger drum lanes (drum) |
| Step buttons 1–16 | Toggle steps in the active clip |
| Side clip buttons (4, left edge) | Switch between clips on the active track |
| K1–K8 | Adjust parameters in the active bank |
| Jog rotate | Cycle parameter banks |
| Jog click | On a bank with alt parameters (CLIP, DELAY, AUTOMATION; DRUM LANE, REPEAT GROOVE, ALL LANES; SEQ ARP / ARP IN), toggle alt-param mode — knob labels flip to their alternates (Nudg/Zoom/ClkF; AUTOMATION → ASSIGN, retarget CC/AT). A small down-arrow in the header flashes while you're in it. Switching banks, switching tracks, or entering Session View reverts to the primary params. |
| Shift + jog rotate | Switch tracks 1–8 |
| Shift + bottom-row pad (1–8) | Switch to that track |
| Loop (held) | Enter loop view — step buttons now show pages of the clip |
| Loop (held) + jog | Adjust clip length ±1 step per detent |
| Up / Down | Shift the pad octave range (−4 to +4) |
| Left / Right arrows | Navigate clip pages (for clips longer than 16 steps) |
| Note/Session (tap) | Switch to Session View |
| Note/Session (hold) | Momentary peek at Session View |
| Volume encoder | Master output volume (handled by Move firmware) |
| Delete + jog click | Reset all params in the active bank |
| Shift + Delete + jog click | Reset all play FX across every bank (active clip/lane) |

The OLED shows the active bank's parameters across all 8 knobs. Touching a knob highlights its row. The LED below each knob lights when that parameter has been changed from its default.

**Switching tracks while transport is running** auto-launches the destination track's focused clip if nothing is currently playing or queued there — so moving into a track gives you sound without an extra launch. (This only happens while the transport is playing; see [§4.5](#45-live-recording) for how transport start itself behaves.)

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
| Loop (tap) | Lock Performance Mode |
| Loop (hold) | Temporary Performance Mode |
| Shift + Loop | Toggle Performance Mode latch |

Mute and solo controls work the same in both views — see [Chapter 11](#11-mixing--volume-mute-solo).

The active track shows a 1px box around its number on the OLED's track row. Each track's currently-focused clip slot shows dark grey in Session View, so you can always see which slot is in focus. In Track View's OLED overview, clip letters for playing or will-relaunch clips display inverted (black on white) so active clips are visible at a glance.

## 3.4 The Global Menu

Open with **Shift + Note/Session**. Jog to navigate; click to enter edit mode; click again to commit; **Note/Session** to close.

While the menu is open, pads, step buttons, and side clip buttons keep functioning normally — only the jog wheel is captured by the menu. This means you can keep playing while you edit settings.

The menu starts with **Track [N] Config** (the *active* track's configuration; updates live if you switch tracks while the menu is open). Below a `── Global ──` divider, all global items follow.

See [Chapter 13](#13-global-settings) for every item in the menu.

## 3.5 Shift+Step shortcuts

In Track View, while you hold **Shift**, step buttons that have an available shortcut light solid (and the icon-row LEDs above them light too).

| Step | Action | Where |
|---|---|---|
| 2 | Open Global Menu at the **Global** section header | Both views |
| 3 | Edit the active track's synth — **Move-routed:** open Move device-edit / preset browser. **Schwung-routed:** open the chain editor on the track's current slot. Silent no-op on External-routed tracks or on stock Schwung without the chain-edit shim. | Track View only |
| 5 | Open Tap Tempo screen | Both views |
| 6 | Metro toggle (Cnt-In ↔ Always) | Both views |
| 7 | Open Global Menu at **Swing Amt** | Both views |
| 8 | **Drum:** cycle right-pad mode (Velocity / Rpt1 / Rpt2). **Melodic:** toggle chromatic pad layout | Track View only |
| 9 | Open Global Menu at **Scale** | Both views |
| 10 | VelIn toggle (Live ↔ Fixed 100) | Track View only |
| 11 | ARP IN on/off (last-used style) | Track View, melodic only |
| 15 | Double-and-fill loop | Track View only |
| 16 | Quantize active clip 100% | Track View only |

The five menu/tempo shortcuts (2, 5, 6, 7, 9) work in both Session and Track View; everything else is Track-View only.

The Metro toggle here is intentionally narrow (Cnt-In ↔ Always): use the Global Menu for the full four-state setting (Off / Cnt-In / Play / Always). The **Mute + Play** shortcut in Track View flips Metro Off ↔ its previous non-Off state.

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
| Performance Mode (locked) | Closes Performance Mode, returns to Track View |

## 3.5 Save states (snapshots)

Beyond the automatic save, you can keep up to **16 named save states** per set — full snapshots of everything (clips, notes, track config, tempo, scale). Use them to bookmark a version before a big change, or to keep alternate takes.

- **Save state** (Global Menu) writes a new snapshot, stamped with the date and time (e.g. `05-24 14:32`). The OLED confirms "STATE SAVED".
- **Load state** (Global Menu) opens a list of your snapshots, newest first. **Jog** to highlight one, **jog click** to pick it, then confirm **Yes** — dAVEBOx replaces the current state with the snapshot. (Loading discards unsaved changes, so it asks first.)
- When you already have 16 snapshots, **Save state** opens a picker instead: choose which existing snapshot to overwrite, and confirm.
- **Note/Session** backs out of the list (or out of a confirm prompt).

Snapshots belong to the set they were saved in — each set has its own list. **Clear Session does not delete your snapshots**, so they remain available to load even after you clear the live project.

After a dAVEBOx update that changes the save format, older snapshots can't be loaded; the Load list marks them `(old)` and offers to remove them the first time you open it.

---

# Part II — Making Music

# 4. Sequencing

## 4.1 Step entry (melodic)

The 16 step buttons represent the current page of the active clip. Steps are either active (lit) or empty (dark) — there's no third state.

| Action | Behavior |
|---|---|
| Quick tap (<200ms) on empty step | Activates the step with the **last note played** on the pads, at velocity 100 (or **VelIn** if set on this track) |
| Quick tap on active step | Clears it (notes deleted immediately) |
| Hold (≥200ms) on active step | Opens step edit overlay (see [§4.2](#42-step-edit)) |
| Hold (≥200ms) on empty step | Activates the step with the last note played AND opens step edit in the same gesture, so the edit knobs work immediately. If no note has been played yet, the OLED shows a "no note" flash and the step stays empty. |
| Tap multiple steps together | Toggles each one |

Steps beyond the clip's length light dark grey (out of bounds).

The step grid defaults to **1/16 resolution** — each step is a 16th note. Resolution is per-clip; change it in the CLIP bank (K1): values from 1/32 up to 1-bar.

> **Try this.** Set one clip to 1/32 resolution and another to 1/8. Sequence the same notes in both. Switch between them — same pattern, completely different feel.

### Pad layout

By default the pads show an **In-Key** layout: only notes within the active scale are present, arranged by octave, with the root lit in the track color. Press **Shift + Step 8** to toggle **Chromatic** layout — all 12 semitones visible, in-scale notes lit dim, root in track color.

**Up / Down** shifts the visible octave range (−4 to +4 octaves from default).

## 4.2 Step edit

Hold any step button to open the step edit overlay. Edits apply to *every* note in the step simultaneously, non-destructively relative to neighboring steps. The overlay is a two-row grid:

| Knob | Cell | Function |
|---|---|---|
| K1 | Oct  | Shift notes by octave |
| K2 | Note | Shift notes by scale degree (scale-aware) or semitone (scale-aware off). Oct + Note share a single centered note-name display. |
| K3 | Leng | Adjust note length — touch shows a gate length overlay on the step buttons |
| K4 | Vel  | Adjust velocity |
| K5 | Nudg | Shift notes forward/backward in time (±23 ticks max). Step blinks when notes are on the grid. Notes that cross into an adjacent step reassign there on release. |
| K6 | Iter | **Trig condition** — see [§4.2.1](#421-trig-conditions-iter--prob--ratch) |
| K7 | Prob | **Probability** — see [§4.2.1](#421-trig-conditions-iter--prob--ratch) |
| K8 | Ratch | **Ratchet** — see [§4.2.1](#421-trig-conditions-iter--prob--ratch) |

While holding a step, the OLED shows the notes in it, e.g. `C4 E4 G4`. **Up / Down** shifts the visible octave range to reach notes outside the current pad window.

Hold multiple step buttons at once to edit them all together.

On **drum tracks** the overlay uses the same 2-row 4-column layout: row 1 = Leng / Vel / Nudg / — (K1-K4), row 2 = Iter / Prob / Ratch / — (K5-K8).

### 4.2.1 Trig conditions: Iter / Prob / Ratch

Three per-step conditions reshape *how* and *when* a step fires. The default for all three is `--` (no condition), shown when the knob sits at its minimum position.

**Iter (Iteration)** — gates the step to play only on certain loop cycles. Turn K6 to step through values `1/2, 2/2, 1/3, 2/3, 3/3, … 8/8`. A value like `2/3` reads as "play on cycle 2 of every 3-cycle group," i.e. silent on cycles 1 and 3, fires on cycle 2 (and then 5, 8, …). The loop-cycle counter is per-clip: it persists across clip switches and length changes, and **resets only on the cold transport-start edge** (Stop → Play). Different steps in the same clip with different Iter values create polyrhythms; the per-clip counter keeps them in phase.

**Prob (Probability)** — sets per-step play probability 0–100%. The roll happens **per-note** at fire time, so on a chord step set to 50% some loops may play 0 / 1 / 2 / 3 notes independently — voicings flicker organically rather than the whole step playing or not as one. Default (`--`) = always fires. Each playback is non-deterministic.

**Ratch (Ratchet)** — retriggers the step `x2 / x3 / x4` times within one step. Sub-hits are evenly spaced over the step (TPS / ratchet) regardless of the step's Leng knob, so a step always retriggers within its own grid slot. Each sub-hit runs through the full effects chain (drum lane FX, melodic NOTE FX / HARMZ / MIDI DLY) just like the original.

**Interactions.** Iter is checked first; if Iter says "skip this cycle," all ratchet sub-hits stay silent for that cycle. Prob rolls once per note; if a note passes the roll, all its ratchet sub-hits play. Different notes in a chord roll independently.

**Persistence.** Trig conditions save with the clip and survive set switches. State format is v=34; clips from older saves are wiped on first load after upgrade.

**Bake.** [Capture](#) (bake) treats trig conditions as real playback: it walks the requested loop count, applies Iter cycle by cycle, rolls Prob per note per cycle, and writes Ratchet sub-hits as discrete sub-step notes. The baked clip ends up with `step_iter / step_random / step_ratchet` reset to defaults — the resulting notes embody whatever pattern the trigs produced. Long chord + high ratchet bakes can exceed the 8-notes-per-step cap; excess sub-hits drop silently. Ableton `.ablbundle` export applies the same gates.

> **Try this.** Set a snare on step 5 to **Iter 1/2** and a hi-hat on step 6 to **Iter 2/2** — they alternate cycles, building a 2-bar pattern from a 1-bar clip. Add **Prob 60%** to a tom on step 12 and **Ratch x3** to a clap on step 8 — the loop breathes without ever editing the underlying notes.

## 4.3 Chord entry

Two methods work — use whichever feels natural:

- **Pad-first.** Hold one or more pads, then press a step button. All held notes are captured into that step at once.
- **Step-first.** Hold a step, then tap pads one at a time. Notes add additively. Tap a pad already in the step to remove it.

Both methods support up to four notes per step.

> **Try this.** Hold a step, press **Up** a couple of times to reach higher notes, then tap a pad — you've built a chord that spans more than the visible range.

## 4.4 Pages and loop view

When a clip is longer than 16 steps, it spans multiple pages. **Left / Right** navigate between pages. The OLED position bar at the bottom shows page structure and the playhead.

Hold **Loop** to enter loop view — each step button now represents a *page* (bar) of the clip:

- **White** — currently selected page (held during a range gesture, see below)
- **Track color** — page is within the loop window
- **Track color, pulsing** — page contains notes
- **Off** — page is outside the loop window

Three ways to change the loop window while Loop is held:

- **Jog ±1 step per detent** — grows or shrinks the window from the end (start stays fixed).
- **Tap a page button** — sets the window to pages `[0, N]` where `N` is the page you tapped. If the loop is already exactly 2 pages and you tap page 2, it shrinks to 1 page.
- **Hold a page + tap another page** — sets the window to `[start, end]`. The held page anchors the **start**; the tap sets the **end**. The range is always `[min, max]`; the held page lights white while you're mid-gesture.

The bottom OLED bar shows pages in the window only. Small 1px ticks at the bar's left/right edges signal that note content exists outside the visible window — non-destructive, those notes are preserved and play again if you expand the window.

> **Advanced.** **Bake** ([§9.1](#91-bake)) re-anchors the window at step 0, so you can grow the length back to 256 steps after baking a sub-range.

## 4.5 Live recording

Press **Record** to capture pad input into the active clip.

| Starting from | Behavior |
|---|---|
| Stopped | One-bar count-in (step buttons flash on each beat). Recording and transport start together when count-in ends. Pressing **Play** during count-in cancels both. |
| Playing, **fixed-length clip** | Records immediately at the current step — mid-page is meaningful in an existing clip structure. Record button goes solid Red. |
| Playing, **adaptive clip** (empty + length not set) | Recording arms but defers to the next 16-step bar boundary. The clip's playhead resets to step 0 at that moment so the bar boundary becomes the new clip start (no empty leading page). Record button **blinks Red** while pending, solid once recording begins. |

To stop: **Record** again (transport continues) or **Play** (also stops transport).

**Recording is always additive — existing notes are never erased.** To get a fresh take, clear the clip first (Delete + side clip button).

### What Play does

Pressing **Play** from a stopped state resumes whatever was playing when you last stopped: every track that had a clip playing relaunches it; tracks that were silent stay silent. On a freshly loaded set or right after Clear Session, no track has anything to relaunch, so **Play alone makes no sound** — start sound by launching a clip in Session View, or by switching into a track in Track View while the transport runs (which auto-launches that track's focused clip; see [§3.2](#32-track-view)).

### Count-in pre-roll

Notes pressed in the last half-beat of the count-in are captured on **step 1** of the clip. They appear from the second loop pass onward — the system waits for the note to release and for the first full loop to complete before firing, to prevent double-triggering if the pad is still held when transport starts.

> **Advanced.** **Solo does not affect count-in** — track solo/mute never silences the count-in click or any held pads (ARP IN latch, Rpt1, Rpt2) during the pre-roll. **ARP IN during count-in:** when ARP IN is on, the arpeggiator runs through the count-in too, so you hear the pattern you're about to record from the moment you press. The first arpeggiator note after the count-in lands on step 1 regardless of sync mode; with Sync = Off, output produced in the last half-beat of the count-in also records onto step 1.

### Track switching while recording

While record-armed, switching tracks is free. Recording follows the focused track. Notes on the previous track are closed out cleanly; record arm stays on.

### Clip targeting

New recordings go into whichever clip slot is currently focused. To record into a specific clip, select it in Session View first, then switch to Track View and press Record. Targeting an *empty* clip with no preset length creates an adaptive clip — it grows until you stop recording. The OLED status bar shows **Adap** for adaptive or **Fix** for fixed-length.

### Undo

Arming live recording snapshots the clip. A single **Undo** reverts the entire recorded session. On drum tracks the snapshot covers all 32 lanes. Undo also covers clip clear, hard reset, copy, cut, bake, legato, double-fill, scene operations, and automation clears — any of these can be reverted with one press of the Undo button. **Shift + Undo** redoes the last undone action.

---

# 5. The Effects Chain

```
 LIVE INPUT ──> [ARP IN] ──┐
                           ├─> NOTE FX ─> HARMONY ─> DELAY ─> SEQUENCE ARP ─> OUTPUT
 SEQUENCED NOTES ──────────┘
```

Seven banks of parameters control every track. On melodic tracks, all seven are available. On drum tracks, **HARMONY** and **SEQUENCE ARP** are hidden (jog skips them), **CLIP** is replaced by **DRUM LANE**, and the ARP IN slot becomes **REPEAT GROOVE** when a repeat mode is active; bank 7 is **ALL LANES**.

Rotate the **jog wheel** to cycle banks. The OLED shows all 8 knob parameters and their values, with a `Tr[n]` indicator on the right of the heading showing the active track. Touching a knob inverts its row to highlight it. The LED below each knob lights when that parameter has been changed from default.

Every parameter in NOTE FX, HARMONY, DELAY, SEQUENCE ARP, and CC AUTOMATION is **per-clip**. ARP IN is per-track. CLIP-bank settings (length, resolution, etc.) are per-clip.

### Destructive vs non-destructive

Bank parameters fall into two categories:

- **Non-destructive** (play FX) — applied at render time. The underlying notes aren't modified. Returning the knob to default leaves the clip unchanged. **NOTE FX, HARMONY, DELAY, SEQUENCE ARP, ARP IN** are all non-destructive.
- **Destructive** — modifies the underlying note data immediately. Returning the knob to default does *not* revert; use **Undo** instead. The destructive controls are the **CLIP** bank's Resolution, Stretch, Clock Shift (+ AltMode Nudge); the equivalent per-lane controls in **DRUM LANE** (plus K5 Eucl); and **ALL LANES** Resolution, Stretch, and Clock Shift (+ AltMode Nudge). Clip length is set non-destructively via **Loop + jog rotate** — notes outside the active loop window are preserved on disk but not played.

**CC AUTOMATION** records automation data — recording overwrites the lane along the playhead (latch); reverting needs an explicit clear (Delete + jog click clears all; Delete + knob touch clears one).

### Resetting effects

- **Delete + jog click** — reset all params in the active bank for the active clip (or active lane on drum tracks).
- **Shift + Delete + jog click** — reset all play FX (every bank except CLIP) across the active clip. *Excludes* ARP IN (its per-track settings are intentionally preserved) and SEQUENCE ARP on drum lanes.
- **Shift + Delete + side clip button** — hard reset that clip: clears notes *and* resets all per-clip params. Undoable.

> **Try this.** Build a simple 4-note sequence. Dial DELAY Rep to 3 and Pfb to +7. Your sequence now generates its own counter-melody every loop.

---

## 5.1 CLIP bank

Timing and playback settings for the active clip. **K1–K3 are destructive** — they modify the note data directly (see [Destructive vs non-destructive](#destructive-vs-non-destructive)). On drum tracks, this slot is replaced by DRUM LANE — see [§6.5](#65-drum-lane-bank).

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Resolution / **Zoom** | Per-clip playback speed: 1/32, 1/16 (default), 1/8, 1/4, 1/2, 1-bar. Rescales note positions proportionally. **AltMode + turn** = Zoom: keeps absolute note positions, adjusts the step grid around them. |
| K2 | Stretch | One-shot. Each detent doubles (right) or halves (left) the clip. Blocked if compression would put two notes on the same step. |
| K3 | Clock Shift / **Nudg** | Plain turn: rotates all notes forward/backward by whole steps. **AltMode + turn:** nudges all notes at tick resolution (finer than Clock Shift). The K3 label flips to `Nudg` in AltMode. |
| K4 | `Lgto` (Apply Legato) | **Destructive one-shot.** Right-turn the knob to open a confirm popup; click jog to apply. Rewrites every note's gate to the distance from its tick to the next note's tick (clip end for the last note); same-tick chord notes share one gate. Both extends short notes and compresses long ones — every note ends exactly when the next note begins. Undoable via the Undo button. Left-turn is a no-op. |
| K5 | InQ (Input Quantize) | Per-track recording snap: Off, 1/64, 1/32, 1/16, 1/16T, 1/8, 1/8T, 1/4, 1/4T. Snaps each recorded note to the nearest boundary on this grid. Off = capture raw timing. On drum tracks the equivalent control lives at ALL LANES K6 (same underlying per-track field). |
| K7 | Dir (Playback Direction) | Per-clip playback direction: **Fwd** (forward, default), **Bwd** (backward — playhead starts at last step, walks down), **PPf** (pingpong, forward start), **PPb** (pingpong, backward start). Pingpong endpoints play once per direction change, so a steady rhythm pattern stays steady through the bounce. Persisted with the set. Mid-playback changes pivot live without resetting the playhead. **AltMode + turn = RvSt** (Reverse Style): toggles **Step** (default) ↔ **Audio**. Audio style swaps note-on with note-off during any reverse motion (notes play "tape-reversed") and switches pingpong to endpoint-plays-twice (cycle = 2L) — exactly what you want for fugue-machine-style polyrhythms. |
| K8 | SeqFollow | On (default): Track View auto-scrolls to follow the playhead. Off: view stays put. |

K6 is unassigned on the CLIP bank. Clip length is set via **Loop + jog rotate** — hold Loop and turn the jog wheel to grow/shrink the active clip by ±1 step. See [Loop view (Track View + Loop held)](#loop-view-track-view--loop-held).

**Direction notes.** Step LEDs, OLED playhead, and live recording all follow the visual playhead — recording into a Bwd clip captures notes at the step the playhead is on, so you can play and record in any direction. *Adaptive record arm* (the "grow when near end" press-record behavior) is forward-biased and is forced to fixed-mode arm when the active clip is non-Forward. Within each step, micro-timing still flows forward; the engine reverses step order, not the notes themselves.

**Bake / Ableton export honor direction.** Capturing a non-Forward clip writes a Forward-playing clip whose note positions match the directional playback. A 4-step Bwd source bakes to a 4-step clip at [3, 2, 1, 0]; a 4-step PP source bakes to a 6-step clip at [0, 1, 2, 3, 2, 1]. Pingpong endpoints play once per direction change (matching live). After bake, the output clip's direction is reset to Forward — direction is "frozen" into the new note positions, so you can re-set direction on the baked clip without compounding. Same behavior for the Ableton `.ablbundle` export. In whole-drum-clip bake, the longest lane's *playback cycle* (including PP doubling) sets the output's loop unit; shorter-cycle lanes loop more times to fill the full extent.

**Audio-reverse bake.** Clips set to **Audio** reverse style bake with the matching layout: a note is placed at the output position where its audio-reverse note-on would audibly fire (the note's end position in the direction's cycle, with within-step micro-timing reversed where applicable). Pingpong-Audio cycle = 2L (endpoint plays twice), so each note appears twice per cycle in the baked output — once forward, once audio-reversed.

## 5.2 NOTE FX bank

Non-destructive transforms applied to every note before output.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Octave | Shifts all notes up/down by octave (±4) |
| K2 | Offset | Shifts by semitones (±24), or scale degrees when Scale Aware is on |
| K3 | Velocity | Scales note velocity |
| K4 | Quantize | Quantization amount applied at render time. |
| K5 | `Len>` | Fixed pre-gate note length, non-destructive. **`--`** = passthrough (use note's source gate). **`.25`** · **`.50`** · **`.75`** · **`1`** · **`2`** · **`4`** · **`8`** · **`16`** = note rings for that many step-multiples (independent of position in cycle). K6 `>Gate` then scales the result. For destructive legato (set each note's gate to the distance to the next note), see CLIP K8 / DRUM LANE K8. |
| K6 | `>Gate` | Scales note duration 0–400%. 100% = unchanged. Below = staccato; above = legato. |
| K8 | Pitch Random | 0 = off. 1–24 = max deviation. **Shift + turn** to select algorithm: **Walk** (default — each note steps ±1 from previous, accumulating), **Uniform** (random offset within range), **Gaussian** (offsets cluster around center). Scale-aware: random pitches stay in key. |

K7 is blocked on the NOTE FX bank (melodic).

**On drum tracks**, the NOTE FX bank reuses the cells for per-lane controls: **K1+K2 (merged Oct/Note)** edit the active lane's MIDI note (K1 = ±12 semitones, K2 = ±1 semitone); **K3 (Vel), K4 (Qnt), K5 (Len>), K6 (>Gate)** apply to the active lane; K7 and K8 are blocked. Use ALL LANES K4 to quantize every lane at once.

> **Try this.** Set Pitch Random to Walk at a low value (3–5) on a melody. The sequence drifts gradually rather than jumping — coherent variation without chaos.

## 5.3 HARMONY bank (melodic tracks only)

Adds harmonic voices on top of every note. Hidden on drum tracks.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Octaver | Adds an octave voice |
| K2 | Hrm1 | Harmony voice 1 — semitones or scale degrees (Scale Aware) |
| K3 | Hrm2 | Harmony voice 2 — semitones or scale degrees (Scale Aware) |
| K4 | Hrm3 | Harmony voice 3 — semitones or scale degrees (Scale Aware) |

K5–K8 are unassigned.

## 5.4 DELAY bank

A MIDI delay that generates rhythmic echoes of every note.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Rate / **ClkF** | Delay time: 1/64 through 1-bar with dotted variants and triplets for 1/16, 1/8, 1/4. Default: 1/8 dotted. Use Rep = 0 to bypass. **Shift + turn** = Clock Feedback (timing shift per repeat, ±100); the label flips Rate ↔ ClkF while Shift is held. |
| K2 | Lvl | Echo velocity level |
| K3 | Rep | Number of echoes. Default 0 (bypass). |
| K4 | Vfb | Velocity change per repeat |
| K5 | Pfb | Pitch shift per repeat — semitones or scale degrees |
| K6 | Gate | Off = natural note length. 1–10 = fixed gate length applied to all echoes. |
| K7 | Rtrg | On (default): a new note-on drops any in-flight delay echoes for this track so the new note's repeats start fresh. Off: tails overlap (useful for cascading textures). |
| K8 | Rnd | Same range and algorithm options as NOTE FX K3 (**Shift + turn** for algorithm). Applies to echo pitches. |

> **Try this.** Rate 1/16, Rep 4, low Vfb. Tap a chord on the pads — it cascades off in time, perfect for one-finger rhythmic textures.

## 5.5 SEQUENCE ARP bank (melodic tracks only)

A step arpeggiator that runs after Delay. Per-clip. Applies to both sequenced output and live pad input. Hidden on drum tracks.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off · Up · Down · Up/Down · Down/Up · Converge · Diverge · Play Order · Random · Random Other. Default: Off. |
| K2 | Rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1-bar |
| K3 | Oct | Bipolar. Positive = adds octaves above; negative = below. |
| K4 | Gate | 1–200%. 100% = note ends as next begins. Below = staccato; above = legato overlap. |
| K5 | Steps | **Mute** · **Step**. Gates per-step playback once the Arp Steps editor (below) has assigned step levels. Mute: level-0 steps are silenced, the cycle continues. Step: level-0 steps are removed from the cycle entirely. |
| K6 | Rtrg | On (default): pattern resets to step 1 on each new note and at clip loop boundary. Off: arp runs free. |
| K7 | Sync | On (default): the first arp step waits for the next global rate boundary, locking phase with transport. Off: fires from anchor. |

**Arp Steps editor.** **Click the jog wheel** while on this bank to enter the persistent Arp Steps editor (OLED reads `SEQ ARP Steps`). Knobs K1–K8 set a **scale-degree pitch offset** (±14) for each of the 8 arp steps — applied scale-aware on top of whatever pitch the arp engine picks. The pad grid is the step-velocity editor (8 columns × up to 4 rows). **Hold Loop + tap any pad** sets the step-loop length (1–8); pads past the loop go dark. Click the jog, turn the jog, or press Note/Session to exit. While the editor is active, pads do not fire notes and Loop is repurposed as a modifier. The editor's state is **per-clip** for SEQUENCE ARP.

**Bank reset.** **Delete + jog click** (or **Shift + Delete + jog click**) while on this bank resets every SEQUENCE ARP parameter — including step velocities, step intervals, and step-loop length — back to defaults.

## 5.6 ARP IN bank

A *live* arpeggiator for pad input and external MIDI. **Per-track**, not per-clip. Does not affect sequenced notes. On drum tracks, ARP IN is bypassed (its slot becomes REPEAT GROOVE when a repeat mode is active).

> **Connection point.** ARP IN only sees what you play live; SEQUENCE ARP only sees what's sequenced. They're two independent arpeggiators running in parallel on the same track — use both at once for different feels on live vs sequenced material.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Style | Off (disables arp) · Up · Down · Up/Down · Down/Up · Converge · Diverge · Play Order · Random · Random Other |
| K2 | Rate | 1/32, 1/16, 1/16t, 1/8, 1/8t, 1/4, 1/4t, 1/2, 1/2t, 1-bar |
| K3 | Oct | −4 to +4 (0 displays as Off). Negative = arpeggiate down; positive = up. |
| K4 | Gate | 1–200% |
| K5 | Steps | **Mute** · **Step**. Mute: level-0 steps are rests, the cycle continues underneath. Step: level-0 steps removed from the cycle entirely. |
| K6 | Rtrg | On: pattern resets on each new note. **Off (default).** |
| K7 | Sync | On (default): waits for the next rate boundary before firing. Off: fires immediately on pad press. |
| K8 | Latch | Off (default) · On. On: arp keeps running after release. First touch of a new gesture replaces the latched set; additional presses add notes. |

**Latch shortcut.** While holding pads with ARP IN active, tap **Loop** to toggle latch on/off without entering the bank. **Delete + Loop** also unlatches. With latch already on and notes latched, tapping **Loop with no pads held** clears the latched chord without turning latch off — the next chord you play latches as usual.

**Latch visual feedback.** When Latch is on, every pad in the current ARP IN input buffer stays lit white — held *and* latched-after-release — so you can see which notes are feeding the arp. The `Arp` indicator in the Track View header inverts (black-on-white chip) while latched. The **Loop button** also blinks in the active track's color at the arpeggiator's step-fire rate while the active track is latched with notes in the buffer — a tempo-visible hint that ARP IN is running on this track. Change the Rate knob and the blink rate follows.

> **Advanced — latch lifecycle.** The latch is per-track musical intent and persists across track / route / channel / MIDI-in changes — switching tracks does not drop the latched buffer. It clears on: transport Stop, Delete + Play, and Session View entry (active track only). Muting a track silences the latched output but preserves the latch (unmute resumes mid-phrase). With `Rtrg = Off` and `Latch = On`, re-pressing a pad whose note is latched but not physically held removes that single note from the buffer — useful for plucking voices out of a stacked chord.

**Arp Steps editor.** Same gesture as SEQUENCE ARP — **click the jog** to enter (OLED reads `ARP IN Steps`); K1–K8 set per-step scale-degree offsets (±14); pads are the step-velocity editor; **Loop + pad column** sets the step-loop length (1–8). ARP IN's editor state is **per-track**.

**Bank reset.** **Delete + jog click** while on ARP IN resets every ARP IN parameter back to defaults (including the held buffer). **Shift + Delete + jog click does NOT reset ARP IN** — that's the broad melodic FX reset and intentionally preserves per-track ARP IN settings.

Quick toggle: **Shift + Step 11** flips ARP IN on/off using the last-used style.

> **Try this.** Enable ARP IN with Style = Up, Rate = 1/16, Latch = On. Play a chord, then switch to a different track. The arp runs hands-free on the first track while you sequence on the second.

## 5.7 AUTOMATION bank — "AUTO" (melodic tracks only)

The bank header reads **AUTO**. It's the home for all of a clip's continuous-modulation data: the 8 CC knob lanes plus recorded **pad-pressure aftertouch** (see [§13.1 AftTch](#131-track-config)). When the focused clip contains data, inverted badges appear in the header — **AT** (recorded aftertouch) and/or **CC** (knob automation or a resting value). A Pitch Bend (**PB**) badge is reserved for later. A type with no data shows no badge.

Each of the 8 knobs is an independent **continuous-modulation lane**. Each lane holds, **per clip**: recorded automation (up to 1024 points, 1/32 resolution, interpolated on playback) plus an optional **resting value** ("clip CC") the lane falls back to. Output follows the track's Route and MIDI channel.

Knob→target **assignment is per-track**; the resting value and automation are **per-clip** — switching the focused clip shows that clip's CC values.

**The "—" floor.** Every knob's value range starts with **"—"** (unset = send nothing). Turn **down past 0 → "—"**; turn **up from "—" → 0, 1 … 127**. "—" everywhere means "no value defined here."

**Assigning a target (Shift + turn).** Hold Shift and turn a knob to step through the target ladder: **AT** (channel-pressure aftertouch) ↔ **CC0 … CC127**. The label shows `AT` or the CC number. Aftertouch ignores the CC number.

**Setting the resting value (normal turn, no step held).**
- **Stopped** (or playing on a lane with no automation): turning sets the active clip's resting value and sends it live so you hear it. Turn to "—" to clear it.
- **Record-armed + transport running:** turning records automation by latch overwrite (see Recording below).
- **Playing on an automated lane (not armed):** turning is a transient live audition only — it does **not** change the resting value.

**Loop reset.** With a resting value set, the lane eases back to it at each loop boundary (a smooth closed curve that resets every cycle). Left at "—", the value simply carries over the loop (holds).

**Displayed value.** Stopped → the resting value (or "—"); playing → the value defined at the playhead (or "—"); holding a step → the value recorded at that step (or "—"), plus the **computed value that plays there** shown in parentheses for ramp/gap steps.

**Active lane + step-LED gradient.** The **last knob you touched** is the active lane: its overview cell stays highlighted, and its automation is drawn across the **step buttons (16)** as a 3-level white brightness gradient (dim / mid / full; "—" = off); the **playhead step shows the track color**. Out-of-window steps are dim grey. The gradient holds steady as the playhead moves. Touch another knob to follow it. Like every other parameter bank, the AUTOMATION OLED auto-dismisses back to the Track-View overview after the standard idle window — touch a knob or turn the jog to bring it back.

**Knob acceleration.** Turning a knob to edit a value ramps with the turn: the first few clicks of a continuous turn move finely, and a sustained spin speeds up so you can sweep the range quickly. Change direction or pause and it resets to fine control. (The Shift assignment turn stays fixed for precision.)

**Knob LED states (this bank only):**

| State | Knob LED |
|---|---|
| No automation, no resting value | Off |
| Resting value set (stopped) | White |
| Has automation for this clip | Vivid yellow |
| Recording armed | Red — brightness scales with the resting value |
| Playback with a defined value | Green — brightness scales with the value at the playhead |

**Recording (latch overwrite).** While recording is armed and transport is running, **turning** a knob latches it into overwrite recording: from that moment the lane is continuously rewritten along the playhead with the knob's current value, **replacing** whatever automation was there — and it keeps writing the last value even after you stop turning, loop after loop, until you stop recording. Turn it and leave it → the lane flattens to that value; keep nudging → you draw the curve live. The first turn picks up from the value already playing there (no jump). **Touching** a knob without turning does nothing. Untouched knobs keep playing their existing automation. After each loop (and when you stop recording) the lane is tidied — redundant points on a flat hold or straight ramp collapse to their endpoints, with no change to what you hear. Switching clips while recording finalizes the latch on the old clip (it won't bleed into the new one).

**Step-edit.** Hold a step in this bank: the OLED shows "CC S1–S16" with a 4×2 knob grid. Turning a knob writes a clean flat hold across that step (no stray ramp). From an unset step, turning up sets a value; turning **down past 0 clears** that knob's point back to "—".

**Clearing.** All automation clears are undoable via the **Undo** button.
- **Tap Delete** (press & release, without turning the jog) opens the **CLEAR AUTOMATION** menu: jog to scroll the list — **Aftertouch (AT)**, **Pitch bend (PB)** (disabled placeholder), **Control Change (CC)**, **CLEAR**, **Cancel** — jog-click to check AT and/or CC, then **CLEAR** to wipe the checked types for the active clip. Exit without changing anything via **Cancel**, the **Note/Session** button, or **tapping Delete again**.
- **Delete + jog click** and **Shift + Delete + jog** clear **all** automation (CC + AT) for the clip.
- **Delete + knob touch (or turn)** clears that one knob's CC (automation + resting value). **Delete + a step button** clears **all** knobs' CC points at that step.
- **Clearing the clip** (notes) also removes all of its automation.

---

# 6. Drum Tracks

Drum mode reshapes a track for percussion: the pad grid becomes 32 lanes, each step pattern lives on a per-lane basis, and a Note Repeat system replaces the live arp.

## 6.1 Switching to drum mode

**Shift + Note/Session** → Track Config → **Mode = Drum**. On a track that already has notes, the mode switch converts them (see [§2.5](#25-melodic-vs-drum-tracks)).

## 6.2 Pad layout

| Pad block | Contents |
|---|---|
| Left 4×4 | 16 drum lane pads (bank A or B — jog click cycles modes, see below) |
| Right 4×4 | Function area — content depends on mode |

Two banks of 16 lanes (A and B) give you 32 lanes total. The active bank is shown in the OLED.

**Right 4×4 modes** (cycle by tapping the jog wheel, or **Shift + Step 8**):

- **Velocity** (default). 16 zones from velocity 8 (bottom-left) to velocity 127 (top-right). Used for live monitoring, step-edit velocity, and recording. Step-tap velocity defaults to 100 until you've pressed a vel-pad on this track; after that the most recently pressed zone is sticky (persists across sessions). Drum vel zones — sticky or actively pressed — override VelIn.
- **Rpt1.** Single-lane Note Repeat. See [§6.7](#67-note-repeat).
- **Rpt2.** Multi-lane Note Repeat. See [§6.7](#67-note-repeat).

OLED shows `Vel`, `Rpt1`, or `Rpt2` to indicate the current mode.

## 6.3 Step sequencing on drums

Step sequencing is **per-lane** on drum tracks.

1. Tap a lane pad — it's now the active lane (its LED pulses).
2. Tap step buttons 1–16 to add or remove hits *for that lane*.
3. Switch to another lane and edit independently.

The step buttons always show the active lane's pattern. To **select a lane silently** (without triggering its sound): hold **Capture** and tap the lane.

**Step edit on drum tracks** — hold a step button to open the overlay:

| Knob | Function |
|---|---|
| K1 (Leng) | Adjust the hit's gate length |
| K2 (Vel) | Adjust velocity |
| K3 (Ndg) | Nudge timing (±23 ticks max) |

To change a lane's MIDI note, use NOTE FX bank K1+K2 (per-lane Oct/Note).

## 6.4 Per-lane independence (the polyrhythm trick)

Each lane has its own **loop length** within the clip. Set with **Loop + jog rotate** on the active lane.

> **Connection point.** This is the heart of dAVEBOx's drum design. Polyrhythmic textures need no special setup: just give each lane a different length. The clip's overall length is just the longest active lane.

> **Try this.** Set your kick to 16 steps, hi-hat to 12, and a percussion lane to 10. Each loops at its own rate against a shared transport — the pattern is 240 steps long before it repeats exactly.

## 6.5 DRUM LANE bank

Per-lane settings for the active lane. (Replaces CLIP on drum tracks.) **K1–K3 and K5 are destructive** (modify per-lane note data).

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Resolution / **Zoom** | Plain turn: per-lane resolution (1/32 · 1/16 · 1/8 · 1/4 · 1/2 · 1-bar). **AltMode + turn:** Zoom — keeps absolute note positions, adjusts the step grid. Label flips to `Zoom`. |
| K2 | Stretch | Per-lane beat stretch (one-shot). Blocked if compression impossible. |
| K3 | Clock Shift / **Nudg** | Plain turn: shifts the active lane by whole steps. **AltMode + turn:** nudges at tick resolution. Label flips to `Nudg`. |
| K4 | `Lgto` (Apply Legato) | **Destructive one-shot, per-lane.** Right-turn opens the confirm popup; click jog to apply. Rewrites every note in the active drum lane's clip to gate = distance-to-next-note (clip end for last note); same-tick notes share one gate. Both extends and compresses. Undoable. Left-turn is a no-op. |
| K5 | Eucl (Euclidean) | Spreads N hits evenly across the active lane's length (0..length). Only the positions that change between the old and new count update, so hand-placed hits outside the Euclidean grid are preserved. Persists per-lane, per-clip. |
| K7 | Dir (Playback Direction) | Per-lane playback direction (same modes as melodic CLIP K7: Fwd · Bwd · PPf · PPb). Each lane has its own direction — mix Fwd hats with a Bwd snare for free, and each lane stays in phase across mid-play clip switches. **AltMode + turn = RvSt** (Reverse Style): per-lane toggle of **Step** ↔ **Audio**; same semantics as melodic — Audio swaps note-on/off in reverse motion and uses 2L pingpong cycle. |
| K8 | SeqFollow | Per-clip auto-scroll on/off |

K6 is unassigned on the DRUM LANE bank. Per-lane length is set via **Loop + jog rotate** — hold Loop and turn the jog wheel to grow/shrink the active lane by ±1 step. Lane MIDI note assignment is on NOTE FX K1+K2 (per-lane Oct/Note).

Lane MIDI note assignments and playback direction persist across saves and reloads.

## 6.6 ALL LANES bank

Bank 7 on drum tracks. Applies parameters to all 32 lanes simultaneously. **K1 (Res), K2–K3 are destructive** (modify note data across all lanes); **K4 (Qnt)** is non-destructive playback quantize; **K5 (VelIn)** and **K6 (InQ)** are track-config settings; **K7 (Dir)** sets playback direction on all lanes.

| Knob | Parameter | Notes |
|---|---|---|
| K1 | Resolution | Sets resolution on all 32 lanes to the same value (1/32 · 1/16 · 1/8 · 1/4 · 1/2 · 1-bar). Rescales notes proportionally per lane. Display resets to `--` after touch release. |
| K2 | Stretch | Beat stretch applied atomically. If any lane can't compress or expand, the operation is a no-op ("NO ROOM" popup). |
| K3 | Clock Shift / **Nudg** | Plain turn: shifts all lanes by whole steps. **AltMode + turn:** nudges all lanes at tick resolution. Label flips to `Nudg`. |
| K4 | Quantize | Playback quantize for all 32 lanes. Display resets to `--` after touch release. |
| K5 | VelIn | Velocity input override for this track |
| K6 | InQ | Recording input quantize (Off · 1/64 · 1/32 · 1/16 · 1/16T · 1/8 · 1/8T · 1/4 · 1/4T) |
| K7 | Dir / **RvSt** | Sets playback direction on all 32 lanes (Fwd · Bwd · PPf · PPb). Display resets to `--` after touch release. **AltMode + turn = RvSt**: sets audio-reverse style (Step · Audio) on all lanes, also resets on release. |
| K8 | SyncRpt (Repeat Sync) | Per-track toggle, default **On**. Controls first-fire timing for held repeat pads — see [§6.7](#67-note-repeat). |

## 6.7 Note Repeat

Note Repeat retriggers drum lanes at rhythmic intervals. Two modes — **Rpt1** (single-lane) and **Rpt2** (multi-lane).

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

- **Tap a rate pad** to *assign* it to the active lane (doesn't trigger on its own). Default rate is 1/8.
- **Hold a lane pad** to repeat that lane at its assigned rate.
- Hold multiple lane pads simultaneously — each repeats independently at its rate.
- Velocity is pressure-sensitive per held pad.

### First-fire timing (Repeat Sync)

The first fire of a held Rpt1 / Rpt2 pad is gated by the **Repeat Sync** toggle (ALL LANES K6, per-track, default On):

- **On (default):** the first fire waits for the next boundary on the repeat-rate grid; subsequent fires roll at the repeat rate.
- **Off:** the first fire is instant.

> **Advanced.** The Repeat Sync grid is anchored to a free-running clock that resets at transport play and count-in fire, so two repeat presses at the same rate phase-lock to each other regardless of when each was pressed — in stopped, playing, and count-in states. Holding a repeat pad through the count-in click is audible and seamlessly fires the first recorded hit at the start of the loop window. Repeat Sync is independent of InQ.

### Mute interaction

Holding a repeat pad on a muted track makes its repeats audible — a held pad is "monitoring through the chain." Latched repeats that aren't physically held respect mute as usual.

### Latching

**Rpt1:** Loop + rate pad starts and latches. While holding a repeat, tap Loop to latch. Press the active rate pad again, or **Delete + Loop**, to stop.

**Rpt2:** Loop + lane pad latches that lane. Hold a lane + Loop latches all currently-held lanes. Tap a latched lane to unlatch it. **Delete + Loop** stops all.

**Tap Loop alone** (drum track, no pads or lanes held) — unlatches all latched Rpt1 + Rpt2 lanes on the active track in one go.

**Visual feedback.** Latched Rpt1 / Rpt2 lane pads stay lit Cyan regardless of the current right-pad mode. Track mute silences latched output but preserves the latch — unmute resumes mid-phrase. Transport Stop clears all latches across every track. Rpt1's last rate (per-track) and Rpt2's per-lane rates persist across save/load.

### Gate mask

The top 2 rows of the right 4×4 (8 pads) form a looping **gate mask**:

- All 8 steps active by default.
- Tap to toggle a step off (rest); tap again to restore.
- Per-lane; persists across clip/track switches and save/load.
- OLED shows each step as a solid bar (active) or empty outline (off).
- **Delete + gate mask pad** resets that step's velocity scaling and nudge offset to defaults (doesn't affect the gate toggle).

**Repeat loop length.** Hold **Loop + tap a gate pad** to set the repeat cycle length (1–8 steps). Gate pads beyond cycle length go dark.

### REPEAT GROOVE bank

Available on drum tracks when a repeat mode is active (replaces the ARP IN slot). Per-lane, persists.

- **K1–K8, unshifted** — velocity scaling per gate step. Range 0–200%. Default 100%. Applied to the pressure-sensitive velocity input.
- **K1–K8, Shift held** — nudge offset per gate step. Range −50% to +50% of step interval. Stored as a percentage so the groove shape is consistent at every rate.

**Delete + jog click** (in Rpt1 or Rpt2) resets the entire groove for the current lane — all gates on, all velocity 100%, all nudge 0%.

> **Try this.** In Rpt2, assign different rates to different lanes (kick = 1/4, hi-hat = 1/16, snare = 1/8). Hold all three for a driving pattern, then release individual lanes to strip it back.

## 6.8 Drum loop view

Hold **Loop** on a drum track to see loop view on the step buttons:

- Pages with notes: pulse between track color and off
- Empty in-window pages: solid track color
- Out-of-window pages: off
- Held start page during a range gesture: white

The window-set gestures match the melodic loop view (see [§4.4](#44-pages-and-loop-view)): tap = length-only `[0, N]`; hold + tap = range `[A, B]`. On a specific drum lane the gesture writes that lane only; in **ALL LANES** view (bank 7) it applies to all 32 lanes at once.

## 6.9 Drum-specific copy / mute

The general copy/cut/paste workflow lives in [Chapter 10](#10-editing--copy-cut-paste-undo); mute and solo live in [Chapter 11](#11-mixing--volume-mute-solo). Two drum-only specifics:

- **Lane copy** — `Copy + lane pad` (source blinks white) → press another lane pad to paste all step data. The destination lane's MIDI note is preserved. Clipboard is sticky; **Shift + Copy** = cut. Drum *clip* copy copies all 32 lanes at once.
- **Lane mute / solo / silent-select** — Mute + lane pad mutes; Shift + Mute + lane pad solos; Capture + lane pad selects without triggering.

---

# Part III — Arranging & Performing

# 7. Scenes

A **scene** is a row of clips across all 8 tracks. Launching a scene fires every clip in that row together.

## 7.1 Launching scenes

| Control | Behavior |
|---|---|
| Scene launcher (left of each Session row) | Launches the scene per the global Launch Quant setting (immediate by default). Playing clips on each track stop and the new clips start per the quantize. |
| **Shift + scene launcher** | Always launches the row at the next bar boundary, regardless of the global Launch Quant setting — for the "queue this row to land on the downbeat" gesture without changing the global setting. |
| Step buttons 1–16 (Session View) | Also launch the corresponding scene row. (Shift + step in Session View is reserved for the menu shortcuts; for the next-bar gesture use Shift + scene launcher.) |

Empty cells in the scene don't affect their column — that track keeps doing whatever it was doing.

## 7.2 Scene copy, cut, capture, clear

Scene-row editing follows the same model as clip editing — full details in [Chapter 10](#10-editing--copy-cut-paste-undo). In brief:

| Control | Behavior |
|---|---|
| Copy + scene launcher | Copy all 8 clips in that row; press another row to paste |
| Shift + Copy + scene launcher | Cut the row |
| Capture + scene launcher | Snapshot whatever's currently playing into that row (see below) |
| Delete + scene launcher | Clear all notes in the row's 8 clips. Undoable. |
| Shift + Delete + scene launcher | Hard reset — clears notes **and** per-clip params for all 8 clips. Undoable. |

**Capture scene from what's playing.** `Capture + scene launcher` copies each track's currently-active clip into the pressed row, in one gesture (works in both views). Two skip rules protect the target row: tracks whose active clip has no notes are skipped (existing content stays), and tracks already on the target row are skipped (no self-copy). OLED confirms `CAPTURED / TO ROW N`, or `NOTHING / TO CAPTURE` if every track was skipped.

---

# 8. Performance Mode

Performance Mode is a real-time effect layer in Session View. It captures a short loop from the sequencer output and plays it back through a grid of live transformations.

## 8.1 Entering and exiting

Use the **Loop** button (in Session View):

| Action | Result |
|---|---|
| Tap Loop | **Lock** — persists hands-free. Loop blinks at 1/8-note rate. |
| Hold Loop | **Temporary** — pads active while held, exits on release. |
| Shift + Loop *or* tap **Latch** pad (R0-8) | Toggle latch mode. Toggling latch only changes how mod pads behave (sticky vs momentary) — it does **not** wipe currently active mods. |

While Loop is held to enter, press a **step button** to set the **capture length**:

| Step | Length | + Step 16 held |
|---|---|---|
| 1 | 1/32 | 1/32 triplet |
| 2 | 1/16 | 1/16 triplet |
| 3 | 1/8 | 1/8 triplet |
| 4 | 1/4 | 1/4 triplet |
| 5 | 1/2 bar | 1/2 bar triplet |
| 6 | 1 bar | 1 bar triplet |

The looper waits for the next aligned clock boundary (when Sync is on — default), captures, then loops continuously.

## 8.2 Per-track inclusion

Each track has a **Looper** flag in Track Config:

- **On** — the track feeds the looper and is silenced during loop playback.
- **Off** — the track plays through normally; the looper ignores it.

**Shortcut.** While Performance Mode is locked, **touch a knob** to toggle that track's Looper flag (K1 = track 1, … K8 = track 8). The knob LED lights in the track's color when its Looper is on, dark when off. A `LOOPER ON / TRACK N` popup confirms the change.

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

**Pressing a mod pad whose LED is lit always clears that bit**, regardless of latch mode. So you can take a recalled preset and dial individual mods off by tapping their pads.

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
| 8 | **Latch** — toggle latch mode. Dark olive when off, bright green when on. |

Length pads (1–5) are dark grey when idle and bright white when their rate is engaged. R0 covers 1/32 through 1/2 bar; for 1-bar captures, use step button 6 while entering Performance Mode (Loop held).

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
| Hold step ~0.75s | Save current mod state (sticky + held) to slot. Step double-blinks to confirm; OLED shows `PERF PRESET / SAVED`. |
| Delete + step | Clear that slot. OLED shows `PERF PRESET / CLEARED`. |

After recalling a preset you can dial individual mods off by tapping their pads.

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

## 8.5 Loop control and persistence

- **Change length while running:** press a different length pad to queue — current cycle finishes, then a fresh capture begins.
- **Retrigger:** press the same length pad again to immediately recapture.
- **Lock vs Hold:** Lock (tap Loop) persists hands-free; Hold (hold Loop) is momentary.
- **Switching to Track View** unlocks and stops the loop but preserves your mod state.

Latched mods, latch mode, the recalled preset slot, and user presets (slots 9–16) persist when you leave Performance Mode and across saves.

---

# 9. Bake & Live Merge

These are two ways to commit transformations into clip data. They operate on the same chain from different angles.

> **Connection point.** **Bake** runs the chain *offline* on a clip's existing notes and writes the result back, then resets the chain to defaults. **Live Merge** captures the chain's *live* output into a new clip while it's running. Bake is deterministic; Live Merge captures one specific performance.

## 9.1 Bake

Bake = **Capture** button. Tap **Capture** in Track View to open the bake dialog for the active clip; tap **Capture** in Session View to open the scene-bake picker ([§9.1.3](#913-scene-bake)).

### 9.1.1 Melodic bake

Two dialogs in sequence:

1. **Loop count:** 1x / 2x / 4x / CANCEL (default 1x)
2. **WRAP TAILS?** YES / NO / CANCEL

- **1x** bakes the clip once.
- **2x / 4x** stack multiple loops end-to-end, letting delay echoes bleed between them.
- **WRAP TAILS = YES** wraps echoes that fall past the clip end back to the beginning — use it for seamless loops.

The full chain runs: NOTE FX → HARMONY → DELAY → SEQUENCE ARP. Walk-mode Pitch Random produces independent sequences per loop.

### 9.1.2 Drum bake

Three dialogs in sequence:

1. **CLIP / LANE / CANCEL** — choose mode
2. **1x / 2x / 4x / CANCEL** — loop count
3. **WRAP TAILS?** YES / NO / CANCEL

- **CLIP mode** — full chain runs per lane. HARMONY can move hits between lanes. Notes at pitches with no matching lane are dropped. All lane FX params reset to defaults.
- **LANE mode** — processes the active lane only. Captures velocity, gate, timing, and SEQUENCE ARP. Pitch transforms and HARMONY are not applied.

If the clip is empty, bake does nothing.

> **Try this.** Bake a clip at 4x, then load fresh effects on top of the baked result and bake again. Layer by layer, you can build patterns that would be impossible to sequence by hand.

### 9.1.3 Scene bake

Two ways in:

- **Session View, tap Capture** → "BAKE SCENE / Tap row or scene step to pick destination" picker. Tap a scene launcher or a step button (1–16) to pick the row; tap any other input to cancel.
- **Session View, hold Sample + tap a scene row** → goes directly to the scene-bake confirm dialog (legacy direct gesture).

Confirm dialog: **CANCEL / 1x / 2x / 4x** (loop count), then **WRAP TAILS? YES / NO / CANCEL**. Each track in the column runs the chain its per-clip bake would (melodic = full chain; drum = CLIP-mode semantics). Empty clips on a track are skipped silently.

## 9.2 Live Merge

Live Merge captures the running chain output from **all 8 tracks simultaneously** into a deferred buffer; on stop, you pick a scene row to drop the captured clips into.

| Step | Control |
|---|---|
| Arm | Session View, tap **Sample** (LED red; OLED popup describes the operation) |
| Capture starts | At the next bar boundary if transport is already running; on transport start otherwise |
| Stop | Tap **Sample** again — capture finalizes at the next 16-step page boundary |
| Auto-stop | At 256 steps (max clip length) |
| Place | After stop, OLED prompts "PLACE MERGED CLIPS / Tap row or scene step to pick destination" — tap any row or scene step to commit |
| Cancel placement | Tap **Capture** instead of a row — captured notes are discarded |

**Selective per-track placement.** Each track is committed independently:

- Tracks that **captured at least one note** during the window overwrite their existing clip at the destination row.
- Tracks that **captured nothing** leave their existing clip at the destination row untouched.

So you can overlay a merged drum + bass onto a row that already has piano and guitar parts — the piano and guitar tracks stay intact because they weren't playing during the merge window.

> **Try this.** Run a sequence with heavy Pitch Random and Delay for a while, then live merge. You've captured the actual randomized output as fixed note data — a snapshot of one specific performance of the chain.

---

## 9.3 Export to Ableton Live

**Global Menu → Export to Ableton.** Writes the current set as an Ableton `.ablbundle` that desktop Live opens directly (then *Save As* `.als`).

| Step | What happens |
|---|---|
| Transport check | Must be **stopped**. If it's running you'll see **STOP TRANSPORT / FOR EXPORT** and nothing is written. |
| Confirm | A Yes/No dialog (No default) appears — jog to choose, click to confirm, **Back** to cancel. |
| Export | The OLED shows **EXPORTING…** while it works, then a persistent **EXPORTED TO** screen with the full file path — dismiss it with **OK** (jog-click or **Back**). |

The bundle lands at `/data/UserData/schwung/davebox-exports/<set name>-<date>.ablbundle` (a same-day repeat gets `-2`, `-3`, …) — the path shown on the EXPORTED screen. Retrieve it over SFTP. It opens in Live as **8 MIDI tracks × 16 scene slots**, carrying your set's tempo and key. It is **self-contained** — the instruments' samples are bundled inside, so it opens with all sounds even on a computer that doesn't have the Move sample packs installed.

**Track instruments and names follow each track's route:**

| Track route | In Live |
|---|---|
| **Move** | The actual Move instrument for that channel (drum kit or melodic), named after the Move preset, with its color. |
| **Schwung** | A placeholder Drift instrument, named `SCH-<chain name>`. |
| **External** | A placeholder Drift instrument, named `Ext ch <n>`. |

**Clip notes are baked** — each clip exports the *"what you hear"* result with its effects rendered into actual notes (SEQUENCE ARP runs, MIDI Delay echoes, Harmony stacks, gate length). The exported clip plays back in Live the same as it sounds in dAVEBOx, with no live effects needed. **Drum clips** flatten their lanes onto one clip: because lanes can each loop at a different length (polymeter), the exported drum clip length is the **least common multiple** of the active lanes' loops, so it repeats seamlessly with every drum keeping its own cycle. **Randomized clips** export **8 cycles** of distinct variations (so the randomness plays out instead of freezing on one loop); **clips with Delay** are wrapped so the echoes loop seamlessly.

> Move Drum Racks need **Live 12.1+** (older versions substitute Simpler and sound different). Export is **one-way** — a saved `.als` can't be loaded back onto Move.


---

# Part IV — Studio

# 10. Editing — Copy, Cut, Paste, Undo

All of dAVEBOx's content editing lives here: copying and cutting at every level (step, clip, scene, drum lane), clearing, resetting, and undo. Feature chapters point here for the full semantics.

## 10.1 The sticky clipboard

The clipboard stays live after each paste — paste to multiple destinations from the same source without re-selecting. The clipboard clears when you release the Copy button. **Cut** is **Shift + Copy**: same workflow, but the source clears after the first paste.

## 10.2 Copy / cut by level

| Level | Copy | Paste | Notes |
|---|---|---|---|
| **Step** (within a clip) | Copy + source step (blinks white) | Press destination step | Copies notes, gate lengths, velocities, timing offsets. Same clip only. |
| **Clip** | Copy + side clip button (Track View) or clip pad (Session View) | Press destination | "COPIED" pops up; "PASTED" on paste. |
| **Scene row** | Copy + scene launcher | Press another scene launcher | Copies all 8 clips in the row. |
| **Drum lane** | Copy + lane pad (Track View, drum) | Press destination lane | Destination lane's MIDI note is preserved. |
| **Drum clip** | Copy + side clip button (drum track) | Press destination | Copies all 32 lanes; each destination lane's MIDI note preserved. Cross-track works; pasting to a melodic track is ignored. |

Mixing clip-level and scene-row-level kinds in a single press-and-paste sequence is rejected.

## 10.3 Clear and reset

dAVEBOx distinguishes **Clear** (wipe note data only, structure survives) from **Reset / hard reset** (wipe notes *and* structure/params).

| Control (Track View) | Action |
|---|---|
| Delete + step | Clear that step |
| Delete + side clip button | Clear all notes in the clip. Length, loop window, resolution, destructive CLIP-bank params, per-clip play FX, and CC automation all survive. Pops "SEQUENCE CLEARED". |
| Shift + Delete + side clip button | Hard reset clip — clears notes **and** length / loop / per-clip params / CC automation. Pops "CLIP CLEARED". |
| Delete + lane-pad (drum) | Clear all notes in that lane. Preserves lane length, loop window, per-lane play FX, per-lane Rpt groove, and MIDI note. Pops "LANE CLEARED". |
| Shift + Delete + lane-pad (drum) | Hard reset lane — wipes notes, length / loop / per-lane play FX, and per-lane Rpt groove. MIDI note is preserved (a kick lane stays a kick lane). Pops "LANE RESET". |
| Delete + jog click | Reset all params in the active bank (active clip/lane) |
| Shift + Delete + jog click | Reset all play FX across every bank (active clip/lane); preserves ARP IN |

| Control (Session View) | Action |
|---|---|
| Delete + clip pad | Delete clip immediately |
| Delete + scene launcher | Clear all notes in the row. Pops "SEQUENCES CLEARED". |
| Shift + Delete + scene launcher | Hard reset all clips in the row. Pops "CLIPS CLEARED". |
| Delete + Mute | Clear all mutes/solos |

## 10.4 Undo / Redo

dAVEBOx supports **one level** of undo and redo.

- **Undo** — Undo button. **Redo** — Shift + Undo.
- After undoing, performing any new action discards the redo state.
- If nothing to undo/redo, brief "NOTHING TO UNDO" / "NOTHING TO REDO" on the OLED.

**Undoable actions** include: step clear, step copy, clip clear, clip copy/cut, hard reset (single clip or scene row), row clear, row copy, live recording session, bank param reset, full bank reset, Loop Double, drum lane copy/cut, drum clip copy/cut, drum lane clear, drum lane reset.

---

# 11. Mixing — Volume, Mute, Solo

## 11.1 Output volume

Turn the **Volume encoder** in either view (no modifier held) to adjust master output. The volume goes through Move's hardware audio path.

Per-track volume is not implemented in dAVEBOx — the Volume encoder is passed through to Move's firmware, which controls master output only. For per-track levels, adjust the gain on the destination (Move's native track mixer or the Schwung slot's chain).

## 11.2 Mute and solo

| View | Mute | Solo |
|---|---|---|
| **Track View** | Press **Mute** — toggles mute on the active track | **Shift + Mute** — toggles solo on the active track |
| **Session View** | Hold **Mute + tap a pad** in a column | Hold **Shift + Mute + tap a pad** in a column |
| **Drum lanes** (Track View) | **Mute + lane pad** | **Shift + Mute + lane pad** |

**Either view: Delete + Mute** clears all mutes and solos.

Mute and solo are mutually exclusive: soloing a muted track clears its mute; muting a soloed track clears its solo. Same for drum lanes.

> **Advanced.** Track mute silences sequenced notes *and* latched ARP IN / Rpt output, but held live/repeat pads still monitor through the chain (see [§6.7](#67-note-repeat)). Latches are preserved through mute — unmute resumes mid-phrase.

## 11.3 Mute/solo snapshots

16 slots save and recall full mute/solo state (including per-lane drum mutes). In Session View, hold **Mute** and the step buttons light: dark grey = empty slot, vivid yellow = saved state.

| Control | Behavior |
|---|---|
| Mute + hold a step ~0.75s | **Save** — step double-blinks to confirm |
| Mute + tap a lit step | **Recall** — all tracks jump to the saved state immediately |
| Mute + Delete + step | **Clear** the slot |

Snapshots persist across reboots.

---

# Part V — Configuration

# 12. MIDI Routing

## 12.1 The default setup

dAVEBOx ships configured to drive Move and Schwung simultaneously:

- **Tracks 1–4** → MIDI channels 1–4 → **Move's native instruments** (tracks 1–4 inside Move).
- **Tracks 5–8** → MIDI channels 5–8 → **Schwung** (slots 1–4).

For this to work, Move and Schwung must receive on matching channels — configure them per [§1.1](#11-configure-move-and-schwung--one-time-setup). Set **MIDI Out = Off** on the Move tracks (prevents an echo loop), and set each Schwung slot's **Forward Channel** to **Auto** (not the default **Thru**, which silently blocks routing).

## 12.2 Per-track channel and route

Each track independently configures, via **Track Config** in the Global Menu:

- **Channel** — MIDI channel 1–16. Default: track N on channel N.
- **Route** — **Move** (native instruments), **Schwung** (internal chain), or **External** (USB-A out).

## 12.3 External MIDI input

dAVEBOx receives external MIDI from a controller on Move's USB-A port. Filter by channel in the Global Menu **MIDI In** field (All or 1–16).

External MIDI is always routed to the **active track**. Switching tracks closes notes cleanly on the previous track. It integrates with step input: playing a note while holding a step adds it to the step exactly like a pad would. dAVEBOx rechannelizes incoming MIDI to the active track's configured channel — your controller doesn't need to be on the synth's channel.

## 12.4 Live effects on external MIDI

| Route | Live effects on external MIDI |
|---|---|
| **Schwung** | Full chain applies — ARP IN, NOTE FX, HARMONY, DELAY all process external MIDI like pad input. |
| **Move** | The chain does **not** apply. Notes reach the Move instrument directly. |
| **External** | The chain applies; output goes back out via USB-A. |

> **⚠ Important.** Routing live external MIDI through the chain on Move-routed tracks would create an echo cascade. dAVEBOx bypasses the chain for live input on Move-routed tracks regardless (Schwung v0.9.13 also suppresses it upstream; earlier versions could crash). Use **Schwung** routing if you need effects on a live external controller.

## 12.5 External MIDI output

When a track's Route is **External**, all of that track's MIDI goes out via USB-A: sequencer playback, live pad input, echoed external MIDI input, the full effects chain, ARP IN output, and Performance Mode mods. Notes are sent on the track's configured channel. Multiple tracks can route to External at once for multi-timbral setups on one connection.

Transport Stop sends note-offs for sounding notes and clears ARP IN latches across every track. Delete + Play (stopped) sends a full panic on all channels and clears Rpt1, Rpt2, and ARP IN latches across all tracks; Delete + Play (running) deactivates all clips and clears the same latches.

## 12.6 Continuous-modulation output (CC / aftertouch)

The CC AUTOMATION bank lanes run at 1/32 resolution with interpolation on playback, plus an opt-in per-clip resting value the lane resets to at each loop boundary. Each lane sends either a **CC** (its assigned number) or **channel-pressure aftertouch** (`AT`), per the knob's type. On External-routed tracks the output goes via USB-A. Knob→target assignment and per-knob type are per-track; resting values and automation are per-clip — see [§5.7](#57-cc-automation-bank-melodic-tracks-only).

---

# 13. Global Settings

Open the menu with **Shift + Note/Session**. Jog navigates; jog click enters edit; jog rotate changes the value; jog click commits; **Note/Session** closes.

## 13.1 Track Config

The first section, showing the **active** track's configuration. Header reads `Track [N] Config`. Values update live if you switch tracks while the submenu is open.

| Entry | Values | Notes |
|---|---|---|
| Channel | 1–16 | MIDI channel for this track |
| Route | Move · Schwung · External | Output routing |
| Mode | Melodic · Drum | Converts the track's notes when switched (see [§2.5](#25-melodic-vs-drum-tracks)) |
| VelIn | Live · 1–127 | Live = raw velocity. A fixed value overrides all input velocity on this track, applied pre-sequencer. |
| Looper | On · Off | Whether this track feeds Performance Mode |
| AftTch | Off · Poly · Channel | Pad-pressure aftertouch send. **Shown on melodic tracks only** (on drum tracks pad pressure drives repeat velocity instead). Hold a note and press harder to send aftertouch to the track output; when the track is record-armed the pressure is also recorded into the clip and replays each loop (see [§5.7](#57-automation-bank--auto-melodic-tracks-only)). The toggle gates *incoming* aftertouch only — recorded aftertouch always plays back until cleared. **Poly** sends per-note aftertouch (`0xA0`); **Channel** sends one track-wide channel-pressure value (`0xD0`). On **Move**-routed tracks only Off · Poly is offered (Move instruments take poly aftertouch). Default Off. |
| **Edit Slot...** | Action | Open Schwung's native chain-slot editor for this track. Shown only on **Schwung-routed** tracks. |
| **Edit Synth...** | Action | Open Move firmware's preset browser and device-edit pages for this track. Shown only on **Move-routed** tracks. |

Both `Edit Slot...` and `Edit Synth...` require the patched Schwung shim from [`legsmechanical/schwung`](https://github.com/legsmechanical/schwung); on stock Schwung these entries are hidden. Both run *alongside* dAVEBOx — the sequencer keeps playing so you can audition changes against the running pattern.

### Edit Slot... — Schwung chain editor

Hands the **OLED, jog wheel, side clip buttons, and knob row** to Schwung's native chain-slot editor while dAVEBOx keeps the pads, step buttons, and transport.

- **First use** prompts a slot picker (1–4); your choice is remembered per track.
- **Side clip buttons** inside the editor switch which slot you're editing.
- **Knobs (K1–K8)** drive the focused chain component's parameters — turn to adjust, touch to peek the current value.
- **Menu** exits and returns to dAVEBOx. **Back** also exits as a fallback (framework gesture). Inside the chain editor, Back pops one level within the editor's sub-views (component/patches/hierarchy); at the top level Back is silent so Menu is the explicit exit.
- **Shift + Edit Slot...** (selecting the menu item with Shift held) reopens the slot picker to reassign this track to a different slot.

### Edit Synth... — Move device editor

Hands the **OLED, jog wheel, side clip buttons (input), Shift, Back, the 8 device-edit knobs, and the master knob** to Move's native preset browser and device-edit pages. dAVEBOx keeps the pads, step buttons, transport, and Menu.

- **On entry,** dAVEBOx lands Move on the track matching this track's **Channel** (channel 1 → Move Track 1, … channel 4 → Move Track 4), opening straight to that device's page with its knob-ring LEDs lit. On channels outside 1–4, pick a Move track manually.
- **Side clip-button LEDs** are lit solid white during co-run as a "press to switch Move tracks" affordance. Move firmware doesn't continuously repaint those LEDs on its own (it only emits writes on certain events), so dAVEBOx paints them itself for a consistent read; pressing one still routes to Move firmware and switches the focused Move track. On exit, dAVEBOx reclaims the knob-ring LEDs immediately.
- **Menu** exits and returns to dAVEBOx. Back is routed to Move's preset/device editor for in-Move navigation, so Menu is the explicit exit.
- **Drum-mode tracks:** tapping a left-4-column pad silently selects the matching cell in Move's drum-instrument editor. dAVEBOx still fires the drum from its sequencer, so there's no double-trigger.

While either co-run is active, pad colors switch to a grayscale scheme to signal split-UI mode; normal colors restore on exit.

A `── Global ──` separator divides Track Config from the global items.

## 13.2 Global items

| Item | Description |
|---|---|
| **Metro** | Off · Cnt-In · Play · Always. When the metronome click is audible. Count-in click plays on all 4 beats. **Shortcuts:** Mute + Play (Track View) toggles Off ↔ last non-Off; Shift + Step 6 cycles Cnt-In ↔ Always. |
| **Metro Vol** | 0–150%. 100% = full scale; 150% = hot. |
| **Tap Tempo** | Full-screen tap interface. Any pad tap calculates BPM from a rolling average. Jog adjusts ±1 BPM per detent. Jog click or Note/Session exits and applies. |
| **BPM** | 40–250. Updates in real time. Note/Session cancels and restores previous. |
| **Key** | Global root note (A through G#) |
| **Scale** | Major · Minor · Dorian · Phrygian · Lydian · Mixolydian · Locrian · Harmonic Minor · Melodic Minor · Pentatonic Major · Pentatonic Minor · Blues · Whole Tone · Diminished |
| **Scale Aware** | On (default) / Off. When On, scale-aware parameters (NOTE FX Offset and Rnd, HARMONY Hrm1/Hrm2, DELAY Pfb and Rnd) step in scale degrees rather than semitones. Bypassed on drum tracks. |
| **Launch Quant** | **Now (default)** · 1/16 · 1/8 · 1/4 · 1/2 · 1-bar. When set to Now, clip launches are immediate and legato if a clip is already playing. All other values wait for the next boundary and start from the beginning. |
| **MIDI In** | All (default) / 1–16. Channel filter for external MIDI input. |
| **Swing Amt** | 50%–75%. 50% = no swing. 66% = perfect triplet swing. Applied globally at render time. |
| **Swing Res** | 1/16 (default) · 1/8. Which note positions are affected by swing. |
| **Beat Markers** | On (default) / Off. When On, step buttons 1, 5, 9, 13 show a dim track-color marker in Track View when not otherwise active. |
| **Clear Session** | Resets the entire dAVEBOx instance (Yes/No dialog, defaults to No). Only the active set is affected. Resets all tracks to defaults — including per-track ARP IN latch state — so latched chords don't keep firing into the cleared session. |
| **Save** | Closes the menu and saves DSP state and UI state immediately. Shows "STATE SAVED". |
| **Quit** | Saves current state and exits dAVEBOx (equivalent to Shift+Back). |

---

# 14. State & Persistence

## 14.1 What saves, and when

State saves automatically when you:

- **Suspend** dAVEBOx (press **Back** — the sequencer keeps playing in the background).
- **Exit** dAVEBOx (**Shift + Back** or **Quit** — equivalent).

Use **Save** in the Global Menu for an immediate manual save at any time. State is **not** saved continuously during use.

## 14.2 What persists per set

- All note data (per clip, per track)
- Per-clip params (NOTE FX, HARMONY, DELAY, SEQUENCE ARP, CC AUTOMATION per clip) and CLIP-bank values per clip
- Track settings: channel, route, mode, octave shift, VelIn, Looper
- Per-track active param bank (which bank each track was on when last left)
- Global settings (BPM, key, scale, scale-aware, launch quant, metro, swing, MIDI in, beat markers)
- Mute / solo state and all 16 snapshots (including per-lane drum mutes)
- ARP IN per-track state (except latch, which resets on transport Stop, Delete + Play, or Session View entry — but persists across track switches)
- Performance Mode user presets (slots 9–16) and currently-latched mods
- Note Repeat per-lane gate masks, groove, and lengths

## 14.3 Set duplication and state inheritance

When you duplicate a Move set via the native set page, the new set inherits dAVEBOx state from the source on first launch. Behavior depends on how many known parent sets are found:

- **One known parent.** Silent auto-inherit, no dialog.
- **Zero known parents.** Silent blank start.
- **Two or more candidates.** A dialog appears: **"Copied Move set detected / Inherit dAVEBOx state from?"** with each candidate listed plus a **Start blank** option. Jog to navigate, jog click to confirm; **Sample** cancels (= Start blank).

Sources whose Move set has since been deleted are filtered out of the picker. Selecting **Start blank** cleanly resets the DSP with no carryover.

## 14.4 Orphan cleanup

On launch, dAVEBOx prunes its own state files for any Move set that has been deleted. Schwung's files in those folders are left untouched.

---

# Part VI — Reference

# 15. Limitations & Gotchas

| Limitation | Notes |
|---|---|
| **External MIDI into Move-routed tracks bypasses the effects chain** | Routing live external MIDI through the chain on a Move-routed track would create an echo cascade, so dAVEBOx skips the chain for live input there; the keyboard plays the Move track whose MIDI In matches its channel. Use **Schwung** routing if you need effects on live external MIDI. |
| **The hardware volume knob is master-only** | Per-track volume isn't implemented; adjust gain on the destination instead. |
| **Powering Move off from within dAVEBOx causes a brief hang** before shutdown. | — |
| **CC automation lanes are not swung** | Intentional — keeps automation precisely on the grid. |

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
| Playing | Flash between bright and dim track color at 1/8-note rate |
| Focused, will relaunch | Slow pulse between bright and dim track color |
| Focused (not playing) | Solid bright track color |
| Has content, not focused | Dim track color |
| Empty | Dark grey |

### Step buttons (Track View)

| State | LED |
|---|---|
| Playhead position | White |
| Active step (has notes) | Track color |
| Inactive step within clip | Off (beat-marker positions 1/5/9/13 show dim track color when Beat Markers is on) |
| Out of bounds (beyond clip length) | Dark grey |

### Step buttons (Session View — scene scroll indicator)

| State | LED |
|---|---|
| Rows currently in view | Red (pulsing if any clip in that row is playing) |
| Rows out of view with playing clips | Pulsing white |
| Rows out of view with content | Solid white |
| Rows out of view, all empty | Off |

### Knob LEDs

**Performance Mode (locked):** each knob LED shows the looper state for the corresponding track — track color when looper is on, off when off. Touching a knob toggles that track's looper and updates the LED immediately.

**All banks except CC AUTOMATION (Track View):** lit when the parameter has been changed from its default; off when at default.

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
| Active track muted | Solid |
| Active track soloed | Blinking (~4 Hz) |
| Neither | Solid dim |

### Mute/solo snapshot slots (Session View, while holding Mute)

| State | LED |
|---|---|
| Empty slot | Dark grey |
| Saved state | Vivid yellow |

---

# Appendix B — OLED Reference

### Bank header format

Bank headers use `[ LABEL ]` format, e.g. `[ NOTE FX ]`, with a `Tr[n]` indicator on the right showing the active track. On drum tracks, headers use a prefix convention: `DRUM LANE >>` for the DRUM LANE bank itself, `>> BANKNAME` for other per-lane banks (e.g. `>> NOTE FX`), and `ALL LANES` (no prefix).

### Bank parameter display

All 8 parameters and their values show at once in Track View. Touching or turning a knob inverts that parameter's row (black on white); the highlight clears on release. The full overview is always visible — touching a knob never replaces it.

### Idle screen — melodic track

**Row 1 (status bar):** Metro mode · VelIn indicator (Live or fixed value) · Fix / Adap recording indicator.

| Indicator | Meaning |
|---|---|
| Fix | Clip has content or a preset length — recording loops at the existing size |
| Adap | Clip slot is empty with no preset length — recording grows until stopped |

**Row 2:** `Oct:+0` · `Arp` (only when ARP IN is active; inverts when latched) · current key and scale right-aligned (`A Min`, `C# Pent+`). When Scale Aware is on, a 1px underline appears beneath key/scale.

### Idle screen — drum track

**Pad info row:** `Bank: A   Pad: C3 (48)` — active bank (A/B) and the active lane's MIDI note name + number.
**Mute/solo row:** mute/solo status for the active lane.

### Performance Mode

- **Header bar** — preset name when a slot is recalled (e.g. `Float`); otherwise `PERFORMANCE`. White-on-black.
- **Body** — abbreviated list of all active mods (sticky + held), e.g. `Oct+  Sc+  Drift  Sprs`, up to four lines. When none: `no mods active / tap pad to engage`.
- **Footer chips** — `Latch` (filled = sticky mode), `Hold` (filled when engaged), `Sync` (filled = clock-aligned), and the current loop rate on the right when a length is engaged.

Pressing a mod pad briefly replaces the body with the full mod name. Hold-saving a preset shows `PERF PRESET / SAVED`; clearing shows `PERF PRESET / CLEARED`.

### Track number row

Track numbers 1–8 across the OLED width.

| State | Display |
|---|---|
| Active track | 1px box around the number |
| Muted track | Number blinks |
| Soloed track | Filled box, solid inverted number (does not blink) |

### Position bar

A segmented bar at the bottom of Track View showing the clip's page structure (window-relative):

| Segment | Meaning |
|---|---|
| Solid block | Page currently in view |
| Outline box | Page the playhead is on (when different from view page) |
| Bottom edge line | Other pages with content |

A dot moves across the bar tracking the playhead; it inverts to black when crossing the solid block so it stays visible. 1px ticks at the edges signal content beyond the visible window.

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
| Drum lane clear | LANE CLEARED |
| Drum lane reset | LANE RESET |
| Scene captured | CAPTURED / TO ROW N |
| Nothing to capture | NOTHING / TO CAPTURE |
| Mute snapshot saved / cleared | MUTE STATE / SAVED · MUTE STATE / CLEARED |
| Perf preset saved / cleared | PERF PRESET / SAVED · PERF PRESET / CLEARED |
| Beat stretch blocked (no room) | NO ROOM |
| Resolution zoom blocked | NOTES OUT OF RANGE |
| State saved | STATE SAVED |
| Undo / nothing to undo | UNDO · NOTHING TO UNDO |
| Redo / nothing to redo | REDO · NOTHING TO REDO |

(`COMPRESS LIMIT`, shown when a beat-stretch compress is blocked, appears as a brief on-screen dialog rather than an action popup.)

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
| Shift + jog rotate | Switch tracks 1–8 |
| Shift + bottom-row pad (1–8) | Switch to that track |
| Loop + jog rotate | Adjust clip length ±1 step |
| Delete + jog click | Reset params in active bank |
| Shift + Delete + jog click | Reset all play FX (preserves ARP IN) |
| Left / Right arrows | Navigate clip pages |
| Volume encoder | Master output volume |
| Play | Resume previously-playing clips (start/stop transport) |
| Shift + Play | Restart transport from start |
| Loop + Play | Restart with active clip at the visible page's first step (others land in sync) |
| Delete + Play (running) | Deactivate all clips + unlatch ARP IN / Rpt1 / Rpt2 on every track |
| Delete + Play (stopped) | MIDI panic + unlatch on every track |
| Record | Start / stop recording |
| Capture | Open clip-bake dialog |
| Loop | Enter loop view |
| Mute | Toggle mute on active track |
| Shift + Mute | Toggle solo on active track |
| Delete + Mute | Clear all mutes/solos |
| Copy + step | Copy step → press dest step |
| Copy + side clip | Copy clip → press dest |
| Shift + Copy + side clip | Cut clip |
| Delete + step | Clear step |
| Delete + side clip | Clear all notes in clip |
| Shift + Delete + side clip | Hard reset clip |
| Undo / Shift + Undo | Undo / Redo |
| Note/Session (tap / hold) | Switch to / peek Session View |
| Shift + Note/Session | Open Global Menu |
| K1–K8 | Adjust parameter in active bank |
| Shift + K2 (CLIP) | Nudge (label flips to `Nudg`) |
| Shift + K3 (CLIP) | Resolution Zoom mode |
| Mute + Play | Metro toggle (Off ↔ last non-Off) |

**Shift + Step shortcuts (Track View):** 2 = Global Menu (Global) · 3 = Edit Synth/Slot · 5 = Tap Tempo · 6 = Metro toggle · 7 = Swing Amt · 8 = Chromatic layout · 9 = Scale · 10 = VelIn toggle · 11 = ARP IN on/off · 15 = Double-and-fill loop · 16 = Quantize clip 100%. (See [§3.5](#35-shiftstep-shortcuts) for which work in Session View.)

## Track View — drum

All melodic Track View controls apply except as noted.

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
| Copy + lane pad | Copy lane → press dest lane |
| Shift + Copy + lane pad | Cut lane |
| Delete + lane pad | Clear lane notes |
| Shift + Delete + lane pad | Hard reset lane |
| Delete + Loop | Stop all latched repeats |
| Delete + jog click (Rpt1/Rpt2) | Reset groove for active lane |
| Loop + rate pad (Rpt1) | Start and latch repeat at that rate |
| Loop + lane pad (Rpt2) | Latch repeat on that lane |
| Held lanes + Loop (Rpt2) | Latch all currently held lanes |
| Loop + gate mask pad | Set repeat cycle length (1–8) |

**Drum step edit (hold step):** K3 = gate length · K4 = velocity · K5 = nudge timing.

## Session View

| Control | Action |
|---|---|
| Clip pad (tap) | Launch or queue clip (queue-to-stop if already playing) |
| Empty clip pad (tap) | Focus for recording |
| Shift + clip pad | Launch and jump to Track View |
| Scene launcher | Launch full scene row |
| Shift + scene launcher | Launch row at next bar (regardless of Launch Quant) |
| Step buttons 1–16 | Launch corresponding scene row |
| Jog rotate | Scroll scene rows |
| +/− | Scroll by 4 rows |
| Tap a pad in any column | Set that track as active |
| Volume encoder | Master output volume |
| Play / Shift + Play | Start-stop / restart transport |
| Delete + Play (running / stopped) | Deactivate all + unlatch / MIDI panic + unlatch |
| Mute + clip pad | Mute / unmute track |
| Shift + Mute + clip pad | Solo / unsolo track |
| Delete + Mute | Clear mutes/solos |
| Mute (held) + step (tap / hold ~0.75s) | Recall / save mute-solo snapshot |
| Mute + Delete + step | Clear snapshot slot |
| Copy + clip pad / Shift + Copy + clip pad | Copy / cut clip |
| Copy + scene launcher / Shift + Copy + scene launcher | Copy / cut scene row |
| Capture + scene launcher | Snapshot active clips into that row |
| Capture (tap) | Open scene-bake picker |
| Sample (tap) | Arm / stop multi-track Live Merge |
| Sample + scene launcher | Scene-bake confirm (direct) |
| Delete + clip pad | Delete clip |
| Delete + scene launcher | Clear all notes in row |
| Shift + Delete + scene launcher | Hard reset row |
| Undo / Shift + Undo | Undo / Redo |
| Loop (tap / hold) | Lock / temporary Performance Mode |
| Shift + Loop | Toggle Performance Mode latch |
| Note/Session (tap / hold) | Switch to / peek Track View |
| Shift + Note/Session | Open Global Menu |

**Shift + Step shortcuts (Session View):** 2 = Global Menu · 5 = Tap Tempo · 6 = Metro toggle · 7 = Swing Amt · 9 = Scale.

## Performance Mode (Session View + Loop)

| Control | Action |
|---|---|
| Loop (tap / hold) | Lock / temporary |
| Shift + Loop | Toggle latch mode |
| R0 length pads 1–5 (1/32 – 1/2) | Set capture length, trigger capture |
| Step 6 (while holding Loop to enter) | 1-bar capture length |
| Step 16 (held) + length pad | Triplet variant of that length |
| R0 Hold / Sync / Latch pads | Persistent hold / clock-aligned capture / latch mode |
| R1 / R2 / R3 pads | Pitch / vel-gate / wild mods |
| Knob touch (K1–K8) | Toggle that track's Looper flag |
| Tap mod pad (lit) | Clear that mod (either latch state) |
| Step (tap / hold ~0.75s) | Recall / save preset slot |
| Delete + step | Clear preset slot |

## Loop view (Track View + Loop held)

| Control | Action |
|---|---|
| Jog rotate | Adjust clip length ±1 step |
| Two page buttons | Set loop start and end |
| Page (tap) | Set window `[0, N]` |
| Play | Restart with active clip at the visible page's first step |
| Delete | Delete active clip |
| Delete + page | Clear all notes in that page |
| Copy + page | Copy page |
| Shift + Step 15 | Double-and-fill loop |

## Step edit overlay (Track View — hold a step)

| Control | Action |
|---|---|
| K1 / K2 | Shift notes by octave / scale degree |
| K3 / K4 / K5 | Gate length / velocity / nudge timing (±23 ticks) |
| Up / Down | Shift pad octave range |
| Pads | Add/remove notes (step-first chord entry) |
| Multiple steps held | Apply edits to all held steps |

## Global Menu (Shift + Note/Session)

| Control | Action |
|---|---|
| Jog rotate | Navigate items (change value in edit mode) |
| Jog click | Enter edit mode / confirm |
| Note/Session | Close menu |
| Pads / step buttons | Function normally while menu is open |
