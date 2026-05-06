# SEQ8 Upcoming Tasks

## Bugs to fix

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
4. **Step/note editing fixes** — see pending fixes in planning doc.
6. **Full instance reset**
7. **State snapshots** (16 slots)
9. **MIDI clock sync**
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.
20. **Scene bake**: bake all 8 tracks at a given clip index. Needs: DSP `bake_scene` set_param handler (loop over tracks, call bake_clip/bake_drum_clip per type); JS multi-track post-bake resync; new confirm dialog. Per-clip bake functions already exist; `launch_scene` is the precedent for scene-level DSP loops.
21. **Pad latency reduction**: patch `shadow_midi.c` to pre-inject pad note-ons (notes 68–99) into the DSP/Move synth queue before the JS callback fires, eliminating one block of latency. Requires a small C-side mirror of activeTrack+trackRoute (set via set_param) so the shim can make the fast-path decision without waiting for JS. Affects both ROUTE_SCHWUNG and ROUTE_MOVE.
