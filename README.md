# dAVEBOx

**A creative 8-track MIDI sequencer for the [Schwung](https://github.com/charlesvestal/schwung) framework on Ableton Move.**

<a href="https://youtu.be/-OMpxbtUNpo?si=JSRkPo88e6qOXEvN">
  <img width="323" height="171" alt="IMG_0177" src="https://github.com/user-attachments/assets/b84d5136-706b-41f7-a551-5799be8daaab" />
</a>

dAVEBOx is an integrated sequencing environment & MIDI playground capable of fully replacing the functionality of the native Move sequencer. There are lots of weird little things to explore that can radically transform your compositions — and probably overload the Move CPU when you overdo it. You'll have a good time getting to that point, though.

dAVEBOx is designed to be immediate, creative, and performative. Each track can be freely routed to native Move instruments, Schwung slots, or external MIDI. Each track holds 16 clips, each with its own loop length, arpeggiator, and chain of creative MIDI effects. Drum tracks support per-drum loop length, MIDI effects, and note repeat/groove settings. 

dAVEBOx was built by AI goblins and meticulously designed by a human who is not Dave.

**[Read the full user manual](docs/MANUAL.md)**<br>
**[Video Overview](https://www.youtube.com/watch?v=bKRPJhNgEO8)**

---

## Cool stuff:

**Every clip has its own effects chain.** Pitch randomization, harmonization, MIDI delay, and a step-based arpeggiator sit between the sequencer and MIDI output of every clip. Settings are per-clip, so the same source notes can morph into something completely different depending on which clip is playing.

**Drum lanes are basically mini-tracks.** Each of the 32 lanes on a drum track has its own step sequence, loop length, effects chain, and note repeat settings — independent per clip. Set different loop lengths across lanes and you get polyrhythmic patterns without any extra setup.

**Scale-aware everything.** Pitch randomization, harmonizer, delay transposition, manual transposition — they all snap to the active key and scale. Random pitches stay in key. Walk-mode pitch random drifts up and down by one scale degree at a time, building coherent melodic variation rather than noise.

**Bake the chain into notes.** Once you like what the effects are doing, render them down into actual note data. Multi-loop bake (1×–8×) carries delay tails between loops; an optional wrap mode folds tails past the clip end back to the start for seamless loops. Then you can layer fresh effects on top and bake again.

**Live input goes through the effects.** On drum tracks and Schwung-routed melodic tracks, what you play live is processed through the same effects chain as sequenced notes. The arpeggiator picks up your held chord, the delay echoes your live taps, pitch random applies in real time.

**Note repeat with loop cycle length.** Drum tracks have single-lane and multi-lane repeat modes with configurable rate, velocity, groove, latch, and a cycle length that lets you build evolving drum patterns without step-sequencing them.

**Performance mode.** Tap the Loop button in Session View to turn the pads into real-time mod controllers. Hold for temporary, tap to lock hands-free, Shift+Loop for latch. 16 snapshot slots for preset mod combinations.

---

## Also includes

- 8 tracks (melodic + drum), 16 clips per track, up to 256 steps per clip
- Step sequencing and live recording on the same timeline
- Count-in with pre-roll capture
- Global swing (50–75%, 1/16 or 1/8 resolution)
- Both arpeggiators (Sequence Arp and Arp In) support per-step velocity editing and trance-gating
- Per-step note editing: pitch, velocity, gate length, and timing nudge
- 16 mute/solo snapshot slots for saving and recalling track states
- Copy/paste for notes, steps, clips, and scenes
- 8 assignable CC lanes per track with per-clip automation at 1/32 resolution (interpolated)
- Per-track MIDI channel and routing (Move · Schwung · External)

## Known Limitations

- External MIDI input into Move-routed tracks will cause Move to crash. Use Schwung routing if you need effects on live MIDI input.
- Pressing Back to suspend dAVEBOx while a Move-routed drum track is actively playing can crash Move. Stop transport first.
- The hardware volume knob briefly interrupts MIDI output when turned.
- Powering Move off from within dAVEBOx causes a brief hang.


---

## Status

Active development. Expect breaking changes.
