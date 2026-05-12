# dAVEBOx Upcoming Tasks

## Bugs to fix

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
7. **State snapshots** (16 slots)
9. **MIDI clock sync**
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.
20. **Scene bake**: bake all 8 tracks at a given clip index. Needs: DSP `bake_scene` set_param handler (loop over tracks, call bake_clip/bake_drum_clip per type); JS multi-track post-bake resync; new confirm dialog. Per-clip bake functions already exist; `launch_scene` is the precedent for scene-level DSP loops.
21. **Move-native synth preset browser access**: surface Move's native preset browser (Drift, Drum Cell, Wavetable…) from within dAVEBOx, analogous to chain-edit co-run for Schwung slots. Different architecture (Move firmware is a separate process; likely `display_mode = 0` handoff + addressing via `~/schwung-docs/ADDRESSING_MOVE_SYNTHS.md`). See memory entry [`project_move_native_preset_access`].
