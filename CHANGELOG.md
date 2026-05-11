# Changelog

All notable changes to dAVEBOx are documented here.

## 0.1.0 — 2026-05-11

Initial public release.

### Features
- 8 tracks (melodic + drum), 16 clips per track, up to 256 steps per clip
- Per-clip effects chain: TARP, NOTE FX, HARMZ, MIDI DLY, SEQ ARP
- Bake — render the effects chain back into note data (multi-loop, wrap mode)
- Live recording with count-in pre-roll
- 32-lane drum tracks with per-lane loop length, effects, and note repeat
- Scale-aware everything: pitch random, harmonizer, delay, manual transposition
- Performance Mode: 24 mods × 16 snapshot slots, hold/lock/latch interaction
- 8 CC automation lanes per track, per-clip at 1/32 resolution
- Mute/solo with 16 snapshot slots
- Copy/paste for notes, steps, clips, and scenes
- Per-track MIDI channel and routing (Move · Schwung · External)
- Suspend/resume — background playback while browsing Move's native UI
- Set state inheritance — duplicate a Move set, inherit dAVEBOx state by name

### Known limitations
- External MIDI input into Move-routed tracks crashes Move
- Suspending while a Move-routed drum track is playing can crash Move
- Volume knob briefly interrupts MIDI output
- Powering Move off from within dAVEBOx causes a brief hang
