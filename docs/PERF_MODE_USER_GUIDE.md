# Performance Mode

## What It Is

Performance Mode is a real-time effect layer that sits on top of the Global MIDI Looper. It captures a short loop of your sequencer's output and plays it back with transformations applied — pitch shifts, velocity curves, gate overrides, and rhythmic manipulations — that animate and mutate the loop as it repeats. Everything happens in real time; press a pad to hear the effect immediately.

---

## Entering Performance Mode

Performance Mode lives in Session View. Hold the **Loop** button and press one of the first five step buttons to set your capture length and start the loop:

| Step | Length |
|------|--------|
| 1 | 1/32 bar |
| 2 | 1/16 bar |
| 3 | 1/8 bar |
| 4 | 1/4 bar |
| 5 | 1/2 bar |

While Loop is held, each step button pulses at its own rate so you can feel the lengths before committing. Once you press a length, the looper waits for the next aligned clock boundary, captures that window of your sequence, then loops it continuously. The tracks contributing to the loop (those with **Lpr=On** in TRACK bank K8) are silenced during playback — you're hearing the looper's replay, not the sequencer direct.

Releasing all held length buttons stops the loop and returns the tracks to normal playback.

---

## The Pad Layout

When Performance Mode is active, the 32 pads reorganize into four rows:

```
R3 (top)    [  Wild mods — cyan      ]  8 pads
R2          [  Vel/Gate mods — yellow ]  8 pads
R1          [  Pitch mods — magenta   ]  8 pads
R0 (bottom) [ 1/32 | 1/16 | 1/8 | 1/4 | 1/2 | Hold | · | Latch ]
```

R0 is the transport/control row. R1–R3 are the modifier pads.

---

## Modifier Pads — How They Work

**Momentary** (default): hold a pad, the effect is active while you hold it. Release and it stops.

**Latch mode** (press the Latch pad): pads now toggle on/off on each press. The active mods stay engaged after you lift your finger. Press Latch again to exit latch mode and clear all toggled mods. Long-pressing Latch clears all toggles without exiting latch mode.

**Combining mods**: all active mods — from holding, latching, and recalled presets — layer together simultaneously. You can stack mods across rows freely. The effects compose: e.g. Sc↑ + Staccato + ½time gives ascending scale motion, short gates, and every other cycle suppressed.

When you press any mod pad, the OLED briefly shows the full name of that effect, then settles back to showing all currently active mod names in abbreviated form.

---

## R1 — Pitch Mods

All R1 mods are **scale-aware** (results stay in-key) and **bypass on drum tracks** entirely.

Pitch mods are **cycle-based** — they animate over successive loop cycles rather than applying a fixed offset. Each time the loop wraps, the cycle counter increments, driving the animation forward.

| Pad | Name | What it does |
|-----|------|-------------|
| 1 | **Oct Up** | Alternates: odd cycles play at original pitch, even cycles up one octave. Gives a leaping, call-and-response feel. |
| 2 | **Oct Down** | Same alternation but down one octave. |
| 3 | **Scale Up** | Steps up by scale degree each cycle: +1 on cycle 1, +2 on cycle 2, +3 on cycle 3, original on cycle 4, repeat. Gradually climbs the scale. |
| 4 | **Scale Down** | Same but descending: −1, −2, −3, original. |
| 5 | **Fifth** | Ascends by perfect 5th each cycle (+4 scale degrees), then an octave+2nd, then octave+5th, then resets. Harmonically strong, expansive. |
| 6 | **Tritone** | Ascends by a 4th, 6th, then octave+2nd across 4 cycles. More dissonant movement. |
| 7 | **Drift** | Each cycle, pitch drifts ±1 scale degree (random walk), accumulating up to ±6 degrees. The loop gradually wanders away from its original pitch, then slowly wanders back. |
| 8 | **Storm** | Each individual note gets a different random ±6 scale degree shift every time it plays. Chaotic but always in-key. |

---

## R2 — Velocity & Gate Mods

These affect loudness and note duration. They work on all tracks including drums.

| Pad | Name | What it does |
|-----|------|-------------|
| 1 | **Decrescendo** | Velocity multiplies down by 15% each cycle (proportional, so louder notes fade faster in absolute terms). The loop fades out over roughly 6–7 cycles. |
| 2 | **Swell** | Velocity follows a 16-cycle triangle wave — loud at cycle 0, quietest at cycle 8, loud again at cycle 16. A slow breath-in/breath-out shape. |
| 3 | **Crescendo** | Velocity multiplies up 15% each cycle. The loop grows louder each pass until it clips at max velocity. |
| 4 | **Pulse** | Even cycles play at full velocity; odd cycles drop to 20%. Creates a strong/soft pumping feel, like a sidechain compressor. |
| 5 | **Sidechain** | Within each cycle, successive notes get progressively quieter (−15% per note). First note hits hardest; last note is softest. Mimics a decaying envelope across the chord/pattern. |
| 6 | **Staccato** | Gates all notes to 1/8 of the loop length — sharply clipped, percussive feel regardless of original gate. |
| 7 | **Legato** | Gates all notes to the full loop length — everything rings through to the very end of the cycle. |
| 8 | **Ramp Gate** | Gate length ramps up across notes in each cycle — the first note is very short, the last note is nearly the full cycle length. |

---

## R3 — Wild Mods

These affect rhythm, density, and more unusual transformations.

| Pad | Name | What it does |
|-----|------|-------------|
| 1 | **Half Time** | Every other cycle is completely suppressed — nothing plays. The pattern effectively runs at half speed. |
| 2 | **3 Skip** | Every third cycle is suppressed. Creates a syncopated, triplet-feel rhythm over the loop. |
| 3 | **Phantom** | Adds a ghost note one octave below each note — same timing, quarter velocity, short gate. Creates a subtle shadow/echo below every hit. Works on melodic and drum tracks. |
| 4 | **Sparse** | Each note has roughly a 50% chance of being suppressed each time through. The loop thins out unpredictably, with different notes dropping each cycle. |
| 5 | **Glitch** | Each note gets a small random pitch shift (±2 scale degrees) — enough to create unexpected in-key variations without sounding wrong. |
| 6 | **Stagger** | Note 1 plays at its original pitch, note 2 goes up 1 scale degree, note 3 up 2, etc. Spreads a chord or pattern into a rising staircase of pitches. |
| 7 | **Shuffle** | The pitch order of notes randomizes each cycle — the same notes play but in a different sequence every loop. On drum tracks, the hit order shuffles instead. |
| 8 | **Backwards** | Pitch order reverses each cycle — retrograde motion. On drum tracks, the hit sequence reverses. |

---

## Preset Slots

The 16 step buttons are **preset snapshot slots**. Steps 1–8 come pre-loaded with factory presets:

| Slot | Name | Mods |
|------|------|------|
| 1 | Float | Scale Up + Legato |
| 2 | Sink | Oct Down + Decrescendo + Staccato |
| 3 | Heartbeat | Pulse + Half Time |
| 4 | Fairy Dust | Storm + Swell + Sparse |
| 5 | Robot | Tritone + Pulse + 3 Skip |
| 6 | Dissolve | Drift + Decrescendo + Phantom |
| 7 | Chaos | Storm + Glitch + Backwards |
| 8 | Lift | Scale Up + Crescendo + Ramp Gate |

Slots 9–16 are empty and available for your own saves.

- **Tap** a slot to recall it — the step goes White, and those mods layer on top of anything you're already holding or have latched.
- **Tap the same slot again** to clear the recall.
- **Shift+tap** to save your current mod state (held + latched + recalled) into that slot.
- Recalled mods **combine** with held and latched mods via OR — use a preset as a base and hold additional pads on top.

---

## Changing Loop Length While Running

Press a different length pad while a loop is already running — it queues the new length. The current cycle finishes, then immediately captures fresh at the new rate. You don't lose the beat or get a gap.

Pressing the **same** length pad again (while holding it) re-triggers the capture — discards the current loop and starts a new capture immediately at the same length.

---

## Hold Pad

The Hold pad (R0, 6th from left) puts the length pads into a persistent hold mode. While Hold is active, releasing a length pad doesn't stop the loop — useful for playing with mods hands-free without having to keep a finger on a length pad.

Press the Hold pad again to cancel and stop the loop.

---

## Sticky Lengths (Shift + Length Pad)

**Shift+length pad** makes that length pad sticky — the loop at that rate stays running even when you release Loop. This is similar to Hold but per-length: the specific rate is anchored, and releasing it doesn't pop the stack. Shift+same pad again to unstick.

---

## Lock Mode

**Double-tap Loop** quickly to lock Performance Mode. The Loop button starts blinking at 1/8-note rate. The view stays alive, loops keep running, mods stay engaged — even after you release Loop entirely. Use this to go hands-free while the loop and effects run.

- **Single-tap Loop while locked** → unlock and stop the loop
- **Switch to Track View** → also unlocks and stops the loop, but your mod state is preserved

---

## Persistence

Your mod palette — latched mods, latch mode on/off, recalled preset slot, and any custom presets you've saved to slots 9–16 — **persists when you leave Performance Mode and switch views**. Come back to Session View, start a new loop, and your mods are still set exactly as you left them.

**Shift+Back** (the normal save gesture) saves all of this to the set. It reloads automatically next time you open the set.

---

## Per-Track Inclusion

By default every track contributes to the looper. To exclude a track — let it pass through unaffected while the loop runs — set **TRACK bank K8 (Lpr)** to Off on that track. An excluded track is neither captured nor silenced during looping; it plays its sequencer output normally regardless of what the looper is doing.
