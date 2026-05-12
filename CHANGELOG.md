# Changelog

All notable changes to dAVEBOx are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com). Add entries to
`[Unreleased]` as user-facing changes land; `scripts/cut_release.sh` finalizes
the section into a versioned heading at release time.

## [Unreleased]
### Features
- Track menu: **Edit Slot...** — hands the OLED + jog wheel + track buttons over to Schwung's native chain editor while dAVEBOx keeps pads, step buttons, knobs, and transport. First use shows a slot picker (1-4); the choice persists per track. Hold **Shift** while selecting `Edit Slot...` to reopen the picker and reassign. Press **Back** to navigate up within the editor, **Menu** to exit co-run. Entry is shown only on **Schwung-routed tracks** (symmetric with Edit Synth, which is shown only on Move-routed tracks). **Capability-gated**: requires the patched Schwung shim from [`legsmechanical/schwung`](https://github.com/legsmechanical/schwung) (adds `shadow_set_corun_chain_edit` + `corun_chain_edit_slot` in shadow_control). On stock Schwung the entry is hidden and the feature is invisible.
- Track menu: **Edit Synth...** (Phase A) — for tracks set to **Route: Move**, hands the OLED + jog + track buttons + Shift + Back + device-edit knobs + master knob to Move firmware's native preset browser and device-edit pages, while dAVEBOx keeps pads, step buttons, transport, and Menu. The sequencer keeps firing audibly so you can audition presets and parameter changes against the playing pattern. Auto-taps the matching track button on entry based on the track's MIDI channel (channel 1-4 → Move tracks 1-4); on channels outside 1-4 the user picks the Move track manually via Move's track buttons. **Menu** exits co-run. On **Drum**-mode tracks: tapping a pad in the left 4 columns silently selects the corresponding cell in Move's drum-instrument editor (via a synthesized Shift+pad gesture) while dAVEBOx still fires the drum from its sequencer — no double trigger. **Capability-gated**: requires the patched Schwung shim from [`legsmechanical/schwung`](https://github.com/legsmechanical/schwung) (adds `shadow_set_corun_move_native` + `corun_move_native_track` in shadow_control). On stock Schwung or on non-Route-Move tracks the entry is hidden. Implementation note: pad and step-button LEDs freeze at entry-time state during co-run — verified harmless in real use.

### Persistence
- UI sidecar bumped to v=4: per-track Schwung-slot assignment (`ss`). Old v=3 sidecars upgrade in place; new slots default to unassigned.

## [0.2.0] — 2026-05-11
### Features
- Loop+Play (Track View): restarts playback with the active clip starting at the first step of the visible step-view page; other tracks land at the musically-equivalent offset (preserves sync)
- Perf Mode preset mods are now individually toggleable — pressing a mod pad clears its bit whether latch is on or off
- Latch toggle is purely a mode switch (mod pads sticky vs momentary); it no longer wipes mod state
- Perf Mode OLED redesigned: header (preset name / PERFORMANCE), tiny-font active mod list (up to 4 lines), footer chips (Latch · Hold · Sync, filled = active) + right-aligned rate
- Action popups now render in Perf Mode (e.g. "PERF PRESET / SAVED")
- Top-row Perf pad LEDs are static — no more flashing: DarkGrey/White (rates), DeepRed/Red (Hold), DeepGreen/Green (Sync), DarkOlive/BrightGreen (Latch)

### Fixes
- Removed the rec-arm count-in OLED takeover; the normal track view stays visible during count-in
- Melodic live-recording: notes pressed in the upper half of a step no longer play back stuck at the default ~½-step gate — the note-off step-array mirror now uses the same `note_step()` rounding as the rest of the recording path

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
