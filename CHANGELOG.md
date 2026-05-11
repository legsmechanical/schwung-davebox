# Changelog

All notable changes to dAVEBOx are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com). Add entries to
`[Unreleased]` as user-facing changes land; `scripts/cut_release.sh` finalizes
the section into a versioned heading at release time.

## [Unreleased]

### Features
- Perf Mode preset mods are now individually toggleable — pressing a mod pad clears its bit whether latch is on or off
- Latch toggle is purely a mode switch (mod pads sticky vs momentary); it no longer wipes mod state
- Perf Mode OLED redesigned: header (preset name / PERFORMANCE), tiny-font active mod list (up to 4 lines), footer chips (Latch · Hold · Sync, filled = active) + right-aligned rate
- Action popups now render in Perf Mode (e.g. "PERF PRESET / SAVED")
- Top-row Perf pad LEDs are static — no more flashing: DarkGrey/White (rates), DeepRed/Red (Hold), DeepGreen/Green (Sync), DarkOlive/BrightGreen (Latch)

### Fixes
- Removed the rec-arm count-in OLED takeover; the normal track view stays visible during count-in

### Performance / UX
- Action popup duration halved (~1 s → ~520 ms)
- Step hold-to-save duration shortened (~1.6 s → ~750 ms) — affects both Perf preset and Mute snapshot saves

### Documentation
- MANUAL.md rewritten as a comprehensive user guide; code-verified against `ui.js` / `seq8.c`
- MANUAL.md Performance Mode + Appendix B updated for the toggleable-preset / latch-as-pure-mode-switch / new-OLED-layout behavior; new `PERF PRESET / SAVED` and `PERF PRESET / CLEARED` action pop-ups documented
- README maintained on GitHub directly (pre-commit hook blocks local commits)

## [0.1.0] — 2026-05-11

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
