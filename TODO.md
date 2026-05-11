# SEQ8 Upcoming Tasks

## Bugs to fix

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
7. **State snapshots** (16 slots)
9. **MIDI clock sync**
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.
20. **Scene bake**: bake all 8 tracks at a given clip index. Needs: DSP `bake_scene` set_param handler (loop over tracks, call bake_clip/bake_drum_clip per type); JS multi-track post-bake resync; new confirm dialog. Per-clip bake functions already exist; `launch_scene` is the precedent for scene-level DSP loops.
22. **Drum bake undo — pfx restore**: `undo_begin_drum_clip` already snapshots `pfx_params` (seq8.c:4520) and the restore handler writes it back (seq8_set_param.c:1185, 1270), but neither path calls `pfx_sync_from_clip(tr)` so the runtime mirror stays stale until the next clip switch. Fix: call `pfx_sync_from_clip` after both restore loops, guarded on `tr->active_clip == c` (mirrors melodic `apply_clip_restore` at seq8.c:4549).
