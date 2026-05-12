# dAVEBOx Upcoming Tasks

## Bugs to fix

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
7. **State snapshots** (16 slots)
9. **MIDI clock sync**
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.
20. **Scene bake**: bake all 8 tracks at a given clip index. Needs: DSP `bake_scene` set_param handler (loop over tracks, call bake_clip/bake_drum_clip per type); JS multi-track post-bake resync; new confirm dialog. Per-clip bake functions already exist; `launch_scene` is the precedent for scene-level DSP loops.
21. **Move-native synth preset browser access** (`Edit Synth...`): split-mode co-run portal that hands OLED + 16 navigation CCs + jog/knob touch notes to Move firmware while pads/sequencer/transport stay live in dAVEBOx. Mirrors chain-edit co-run architecturally; capability-gated; lives on `feat/move-synth-edit` branch + parallel Schwung-fork branch. Phase 1 (verifications) complete, Phase A (frozen-LED ship) is next, Phase B (split drawUI for live LEDs across both co-run features) is optional follow-on. Full design at `/Users/josh/.claude/plans/6-spicy-waterfall.md`; architecture summary in memory entry [`project_move_native_preset_access`].
