# Changelog

All notable changes to dAVEBOx are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com). Add entries to
`[Unreleased]` as user-facing changes land; `scripts/cut_release.sh` finalizes
the section into a versioned heading at release time.

## [Unreleased]
### Features
- **Capture + scene-row button** — snapshots the current performance into the pressed scene row: copies each track's currently-active clip into that row in one gesture. Skips tracks where the active clip is already on the target row (self-copy) or empty (so target keeps its prior contents on unused tracks). View-agnostic — works in both Session View and Track View. OLED shows `CAPTURED / TO ROW N` (or `NOTHING / TO CAPTURE` if nothing applied).
- Track menu: **Edit Slot...** — hands the OLED + jog wheel + track buttons over to Schwung's native chain editor while dAVEBOx keeps pads, step buttons, knobs, and transport. First use shows a slot picker (1-4); the choice persists per track. Hold **Shift** while selecting `Edit Slot...` to reopen the picker and reassign. Press **Back** to navigate up within the editor, **Menu** to exit co-run. Entry is shown only on **Schwung-routed tracks** (symmetric with Edit Synth, which is shown only on Move-routed tracks). **Capability-gated**: requires the patched Schwung shim from [`legsmechanical/schwung`](https://github.com/legsmechanical/schwung) (adds `shadow_set_corun_chain_edit` + `corun_chain_edit_slot` in shadow_control). On stock Schwung the entry is hidden and the feature is invisible.
- Track menu: **Edit Synth...** (Phase A) — for tracks set to **Route: Move**, hands the OLED + jog + track buttons + Shift + Back + device-edit knobs + master knob to Move firmware's native preset browser and device-edit pages, while dAVEBOx keeps pads, step buttons, transport, and Menu. The sequencer keeps firing audibly so you can audition presets and parameter changes against the playing pattern. Auto-taps the matching track button on entry based on the track's MIDI channel (channel 1-4 → Move tracks 1-4); on channels outside 1-4 the user picks the Move track manually via Move's track buttons. **Menu** exits co-run. On **Drum**-mode tracks: tapping a pad in the left 4 columns silently selects the corresponding cell in Move's drum-instrument editor (via a synthesized Shift+pad gesture) while dAVEBOx still fires the drum from its sequencer — no double trigger. **Capability-gated**: requires the patched Schwung shim from [`legsmechanical/schwung`](https://github.com/legsmechanical/schwung) (adds `shadow_set_corun_move_native` + `corun_move_native_track` in shadow_control). On stock Schwung or on non-Route-Move tracks the entry is hidden. Implementation note: pad and step-button LEDs freeze at entry-time state during co-run — verified harmless in real use.

### Performance / UX
- **Unified step-entry velocity rule.** Velocity written to a step now follows one rule across melodic and drum tracks: **VelIn** (when set 1–127) wins; else a live pad press wins (chord-entry pad / drum vel-pad while step held); else the drum sticky vel-zone if a vel-pad has been pressed on that track; else **100**. Previously VelIn was ignored at step-write time, drum step-tap defaulted to zone 12 (≈104) even with no vel-pad pressed, and melodic step-tap inherited `lastPadVelocity` from incidental pad activity. Now consistent: VelIn forces the value, otherwise step taps are 100 unless you've explicitly armed a zone or held a pad.
- **Nudge knob folded onto the Shft knob.** In CLIP, DRUM LANE, and ALL LANES banks, K3 (Nudge) is removed and `Shift + K2 (Shft)` now performs Nudge. The K2 OLED label flips to `Nudg` while Shift is held. Nudge mode is 2× snappier than Clock Shift (sens=4 vs 8). On melodic CLIP, K4–K8 shift down by one (Res → K3, Len → K4, SqFl → K7). On drum lanes / ALL LANES, the middle knobs shift left but K7/K8 (LaneOct/LaneNote on drum CLIP; unused on ALL LANES) stay in place.
- **Loop** and **Capture** buttons now light with a visible dim grey ambient (Loop was invisible at peer-button palette idx 16; Capture was unlit). Loop uses a custom-RGB scratch palette entry; Capture uses DarkGrey. Loop's perf-mode and drum-repeat indicator overrides are preserved.
- **Shift + jog wheel** in Session View now steps the active track 0–7 (was a no-op). Plain jog still scrolls scene rows. Track View behavior unchanged.
- **NoteFX Gate** knob is now 4× snappier: each detent changes the value by ±2% (was 1% per 2 detents). Useful precision preserved for the 0–400% range; other NoteFX knobs unchanged.
- **NoteFX Quantize** knob now changes by ±2% per detent (was ±1%), 2× faster sweep across the 0–100% range.
- **Melodic step-edit Pit knob** snappier: shifts a scale degree every 10 detents (was 16).

### Fixes
- **Step-entry velocity inconsistency.** Tapping a step button (without holding a pad) now writes a fixed velocity of **100** instead of inheriting `lastPadVelocity` — which was silently being mutated by drum velocity-pad presses, so step taps on melodic tracks would silently shift after touching a drum vel-pad. Affects melodic step-tap (with last-played note) and the multi-toggle path when a primary step is held. Chord-entry (hold step + press pad) is unchanged — pad press velocity still wins.
- **Shift+Step 2/7/9 menu shortcuts** now target by label (`Global` / `Swing Amt` / `Scale`) instead of hardcoded numeric menu indices. The conditional `Edit Slot...` / `Edit Synth...` items were shifting the indices so the shortcuts landed on the wrong items (e.g. Step 7 was hitting `Launch`, Step 9 was hitting `Tap Tempo`). Now stable under future menu reorders.
- MIDI DLY **Lvl** now defaults to 127 on **all drum lanes across all 8 tracks** (was 0 on tracks 1–7 — only track 0 got the JS-side seed). This also makes **Vel Fdbk** audible on those drum lanes: previously, with `Lvl=0` the DSP skipped all delay scheduling, so even non-zero Vel Fdbk produced no effect. Set `Rep ≥ 1` and Vel Fdbk now shapes the repeat-velocity slope as documented. Defaults fixed at the DSP layer (both `drum_pfx_params_init` and `clip_pfx_params_init`); the JS first-run seeding workaround is removed. Saved sets with explicit per-clip/per-lane delay_level keep their stored values; sparse-default sets pick up the new 127 default on next load.
- Panic (Delete+Play when stopped) now sweeps all 16 MIDI channels on every active route, not just the channels that tracks happen to be configured for. ROUTE_SCHWUNG: 128 note-offs × 16 channels; ROUTE_EXTERNAL: CC 120+123 × 16 channels; ROUTE_MOVE: CC 123 × 16 channels (in addition to the existing targeted active-note silencing).

### Persistence
- UI sidecar bumped to v=5: per-track `drumVelZoneArmed` (`dva`) — tracks whether a velocity-pad has been pressed on each drum track, gating the sticky vel-zone fallback for step entry. Old v=4 sidecars load with `dva` defaulted to `false` for all tracks (re-arm by pressing a vel-pad once).
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
