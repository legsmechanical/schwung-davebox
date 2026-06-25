# dAVEBOx

**MORE BETTER TRACKS FOR YOUR MOVE** 

**dAVEBOx is a creative 8-track MIDI sequencer for the [Schwung](https://github.com/charlesvestal/schwung) framework on Ableton Move.**

![dAVEBOx](https://github.com/user-attachments/files/28072600/Untitled.-.May.20.2026.at.14.49.53.2.bmp)

dAVEBOx is an integrated sequencing environment & MIDI playground capable of fully replacing the functionality of the native Move sequencer. There are lots of weird little things to explore that can radically transform your compositions — and probably overload the Move CPU when you overdo it. You'll have a good time getting to that point, though.

dAVEBOx is designed to be immediate, creative, and performative. Each track can be freely routed to native Move instruments, Schwung slots, or external MIDI. Each track holds 16 clips, each with its own loop length, arpeggiator, and chain of creative MIDI effects. Drum tracks support per-drum loop length, MIDI effects, and note repeat/groove settings. 

dAVEBOx was built by AI goblins and meticulously designed by a human who is not Dave.

**[Read the full user manual](MANUAL.md)**<br>
**[Video Overview](https://www.youtube.com/watch?v=bKRPJhNgEO8)**

---

## Basic Stuff:

**Sequence 4 Move instruments and 4 Schwung slots simultaneously from one device.** That's 4 extra tracks with full control over each. External midi supported too.

**Workflow mimics native Move sequencer.** The Move you know with double the tracks, double the clips, and way more functionality.

**Every clip has its own effects chain.** Pitch randomization, harmonization, MIDI delay, and a step-based arpeggiator sit between the sequencer and MIDI output of every clip. Settings are per-clip, so the same source notes can morph into something completely different depending on which clip is playing. 

**Drum lanes are basically mini-tracks.** Each of the 32 lanes on a drum track has its own step sequence, loop length, effects chain, and note repeat settings — independent per clip. Set different loop lengths across lanes and you get polyrhythmic patterns without any extra setup.

**Scale-aware everything.** Pitch randomization, harmonizer, delay transposition, manual transposition — they all snap to the active key and scale. Random pitches stay in key. Walk-mode pitch random drifts up and down by one scale degree at a time, building coherent melodic variation rather than noise.

**Bake the chain into notes.** Once you like what the effects are doing, render them down into actual note data. Multi-loop bake (1×–8×) carries delay tails between loops; an optional wrap mode folds tails past the clip end back to the start for seamless loops. Then you can layer fresh effects on top and bake again.

**Per-step note editing:** Pitch, velocity, gate length, timing nudge, probability, iteration, and ratchets set per-step.

**Export to Live.** dAVEBOx sessions can be exported to Ableton Live sets, even carrying over your Move instruments. 

**Process life input through real-time midi effects.** On drum tracks and Schwung-routed melodic tracks, what you play live is processed through the same effects chain as sequenced notes. The arpeggiator picks up your held chord, the delay echoes your live taps, pitch random applies in real time.

**Customizable note repeat pads with groove options.** Drum tracks have single-lane and multi-lane repeat modes with configurable rate, velocity, groove, latch, and a cycle length that lets you build evolving drum patterns without step-sequencing them.

**Conductor tracks.** Live-play and sequence in-key clip transpositions in real-time. 

**Performance mode.** Tap the Loop button in Session View to turn the pads into real-time mod controllers. Hold for temporary, tap to lock hands-free, Shift+Loop for latch. 16 snapshot slots for preset mod combinations.

---

## Cool Stuff

- 8 tracks (melodic + drum), 16 clips per track, up to 256 steps per clip
- Arpeggiators (Sequence Arp and Arp In) with per-step velocity and note editing
- 16 mute/solo snapshot slots for saving and recalling track states
- Copy/paste for notes, steps, clips, and scenes
- Per-clip and per-drum lane playback direction options
- Seamless suspend and resume between dAVEBOx and Schwung/Move native
- Auto-save, Move set association, and save state snapshots that can be loaded on demand
- 8 assignable automation lanes per track with per-clip automation, per lane length, and value-per step editing at 1/32 resolution (interpolated). Target MIDI CC's or Schwung instrument params.
- Per-track MIDI channel and routing options (Move · Schwung · External)
- Follow Move's internal clock or follow and send dAVEBOx's own internal clock.

  
## Requirements

Schwung **v0.9.16 or later**

---

## Status

Active development. 

## Disclaimer

If dAVEBOx breaks your Move, makes your child cry, or cleans out your fridge, that's on you. dAVEBOx has proven safe, joy-inducing, and satiated in testing but comes with no warranties, implied, express, or otherwise. 
