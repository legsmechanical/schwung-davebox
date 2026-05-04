# SEQ8 Upcoming Tasks

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
4. **Step/note editing fixes** — see pending fixes in planning doc.
6. **Full instance reset**
7. **State snapshots** (16 slots)
9. **MIDI clock sync**
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.
20. **Scene bake**: bake all 8 tracks at a given clip index. Needs: DSP `bake_scene` set_param handler (loop over tracks, call bake_clip/bake_drum_clip per type); JS multi-track post-bake resync; new confirm dialog. Per-clip bake functions already exist; `launch_scene` is the precedent for scene-level DSP loops.
21. **Shift+step shortcuts + step icon LEDs**: Shift+step (Track View, no modifier, steps 1–12 and 14–16) is free for custom shortcuts. Step icon LEDs = CCs 16–31 (distinct from step button notes 16–31), currently unused — drive via `move_midi_internal_send`. Step 13 reserved (framework resume shortcut).
