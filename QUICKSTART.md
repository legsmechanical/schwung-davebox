# dAVEBOx Quick Start

A hands-on walkthrough that takes you from a blank set to a looping pattern with
effects, scenes, and a taste of Performance Mode — in about fifteen minutes.

Work through the lessons in order. Each one builds on the last. When you want the
full detail on anything you meet here, the [**dAVEBOx Manual**](MANUAL.md) is the
complete reference — this guide links into it as you go.

> **What is dAVEBOx?** An 8-track MIDI sequencer that runs as a tool module
> inside [Schwung](https://github.com/charlesvestal/schwung) on the Ableton Move.
> It makes no sound of its own — every note it plays is sent to Move's built-in
> instruments, to Schwung's effect chains, or out to an external synth over USB.

---

## Before you start: one-time setup

dAVEBOx talks to Move and Schwung over MIDI channels, so they each need to be
listening on the right channel. You only have to do this once.

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

With that done, dAVEBOx tracks 1–4 play Move's instruments and tracks 5–8 play
Schwung's chains. (You can change any track's channel and routing later — see the
manual's [MIDI Routing](MANUAL.md#15-midi-routing) chapter.)

Now load a Move set and open dAVEBOx from Schwung's tool menu
(**Shift + Step button 13** — the star).

---

## A two-minute tour

dAVEBOx has **two views**, and you switch between them with the **Note/Session**
button:

- **Session View** (where you start) — a grid of clips. Each column is a track,
  each row is a *scene*. This is where you launch and arrange clips.
- **Track View** — the detailed editor for one clip at a time: pads play notes,
  the 16 step buttons hold its pattern.

A few things worth knowing before the first lesson:

- **There are no track buttons.** To change the active track, hold **Shift** and
  tap a pad in the **bottom row** (pads 1–8 = tracks 1–8), or hold **Shift** and
  turn the **jog wheel**.
- **The jog wheel** (the clickable encoder on the left) cycles through *parameter
  banks* in Track View — this is how you reach the effects and clip settings.
- **The Global Menu** opens with **Shift + Note/Session**. It holds the active
  track's configuration and all global settings (tempo, key, scale, and more).

That's enough to begin.

---

## Lesson 1 — Your first drum beat

Tracks start out melodic, so first we'll turn track 1 into a drum track.

1. Open the Global Menu: **Shift + Note/Session**.
2. Turn the jog wheel to highlight **Mode**, click the jog to edit, turn to
   **Drums**, then click to confirm (an empty track converts instantly).
3. Close the menu by tapping **Note/Session**, then tap **Note/Session** again to
   switch into **Track View**.

The pad grid is now split. The **left 4×4 pads are drum lanes** — one drum sound
each. The right 4×4 is a function area (velocity, repeats) you can ignore for now.

4. Tap a few of the left pads. You'll hear each lane's sound, and the last one you
   tap becomes the *selected* lane.
5. With a lane selected, tap **step buttons 1–16** (the row below the pads) to
   place hits. Try steps 1, 5, 9, and 13 for a steady pulse.
6. Select a different lane pad and place a different rhythm — a snare on 5 and 13,
   a hat on every step.
7. Press **Play**. Your beat loops.

Each lane is its own little sequencer, so you can even give them different
lengths later for polyrhythms. Full detail lives in the manual's
[Drum Tracks](MANUAL.md#7-drum-tracks) chapter.

---

## Lesson 2 — Add a melodic part

Now let's play some notes on another track.

1. Hold **Shift** and tap the **5th pad in the bottom row** — you're now on track
   5 (which routes to Schwung slot 1).
2. The pads now play **pitched notes**, snapped to the current scale. Tap around
   to hear them. **Up / Down** shifts the octave.
3. To sequence a note, **hold a pad and tap a step button** — that step gets the
   held note.
4. For a chord, **hold two or three pads and tap a step** (up to four notes per
   step).
5. Press **Play** if it isn't already running. Track 5 plays alongside your drums.

Want a different key or scale for everything? Open the Global Menu
(**Shift + Note/Session**) and edit **Key** or **Scale** — as you turn the knob
you'll *hear* a live preview, and a confirm asks before it commits. See
[Key & Scale](MANUAL.md#27-changing-key-or-scale) in the manual.

---

## Lesson 3 — Shape the sound with effects

Every clip carries its own effects, reached through the parameter banks.

1. Make sure you're on your melodic track (track 5) in Track View.
2. **Turn the jog wheel** to cycle the banks. Watch the screen header and stop on
   **DELAY**.
3. Turn **K3** (labelled *Rep*) up to **3** — each note now echoes three times.
4. Turn **K5** (*Pfb*) to **+5** — the echoes climb in pitch as they repeat.

These settings belong to *this clip only*. Effects are non-destructive: they
transform the sound at playback without changing your written notes, so returning
a knob to its default undoes it cleanly. Explore the other banks (NOTE FX,
HARMONY, SEQ ARP) the same way — turn the jog, turn the knobs. The
[Effects Banks](MANUAL.md#10-effects-banks) chapter covers every one.

---

## Lesson 4 — Launch clips and build a scene

So far you've been editing one clip per track. Each track holds **16 clips**, and
a row of clips across all tracks is a **scene**.

1. Tap **Note/Session** to return to **Session View**.
2. You'll see your two tracks lit in the leftmost columns. The clips you've been
   playing are in row 1.
3. **Tap an empty clip pad** in track 5's column, row 2 — it becomes focused for
   editing. Switch to Track View (**Note/Session**), make a different melodic
   pattern, then come back.
4. Back in Session View, **tap that row-2 clip** to launch it — track 5 swaps to
   the new pattern while the drums keep going. Launching one clip only replaces
   what was playing *on that track*.
5. To switch a whole row at once, tap a **scene launcher** (the buttons left of
   the grid) or **step buttons 1–16**. Every track jumps to that scene together.

Empty cells in a scene leave their track untouched — handy for keeping the drums
running while you change the melody. More in [Session View](MANUAL.md#4-session-view)
and [Scenes](MANUAL.md#12-scenes--performance-mode).

---

## Lesson 5 — A taste of Performance Mode

Performance Mode grabs a short loop of whatever's playing and lets you mangle it
live with a grid of effects.

1. In **Session View**, with your pattern playing, **hold the Loop button**.
   The pad grid turns into a mod grid (release Loop to exit, or *tap* Loop to lock
   it hands-free).
2. The bottom row sets the capture length — tap one of pads 1–5 (1/32 up to 1/2
   bar) to choose how much it loops.
3. The three rows above are effects: **magenta** = pitch tricks, **yellow** =
   volume/gate, **cyan** = wild. Hold a pad to hear its effect; release to drop
   it.
4. The **step buttons are presets** — tap one of slots 1–8 to recall a
   ready-made combination (try slot 1, "Float").

Performance Mode is deep — capture lengths, latching, and 16 preset slots are all
covered in [Performance Mode](MANUAL.md#12-scenes--performance-mode).

---

## Lesson 6 — Save your work

dAVEBOx saves automatically, so you rarely have to think about it:

- Pressing **Back** suspends the module (it keeps playing in the background) and
  saves.
- **Shift + Back** fully exits and saves.
- In the Global Menu, **Quit** saves and exits.

For named backups you can return to, use **Save state** in the Global Menu — it
keeps up to 16 timestamped snapshots per set. See
[Save states](MANUAL.md#16-global-settings--persistence).

---

## Where to go next

You now know enough to make complete patterns. When you're ready for more:

- **Editing notes precisely** — hold any step to open the step editor (length,
  velocity, nudge, probability, ratchets): [Step Entry & Editing](MANUAL.md#6-step-entry--editing).
- **Longer clips and loops** — clips can run up to 256 steps; hold **Loop** in
  Track View to set the loop window: [Pages and the loop window](MANUAL.md#64-pages-and-the-loop-window).
- **Recording live** — press **Record** to capture pad playing into a clip:
  [Live recording](MANUAL.md#65-live-recording).
- **Automation** — record knob moves that play back with the clip:
  [Automation](MANUAL.md#11-automation).
- **Conductor tracks** — a track that transposes all the others in real time:
  [Conductor Tracks](MANUAL.md#8-conductor-tracks).
- **Exporting to Ableton Live** — render your whole set to an `.ablbundle`:
  [Export](MANUAL.md#133-export-to-ableton-live).

And whenever you need a quick reminder of a control, the manual's
[Cheat Sheet](MANUAL.md#17-cheat-sheet) lists every gesture on one screen.

Have fun.
