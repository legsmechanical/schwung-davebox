/* FILE-SCOPE GLOBALS HANDLER for set_param()'s looper/merge/bake/scene keys --
 * part of the seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (before set_param), NOT a standalone TU; never compile or
 * lint this file on its own. Globals handler (phase 4B group 11): dispatched
 * BEFORE the tN_ block, so it uses only inst/key/val (never tidx/tr/sub --
 * they aren't in scope at the globals dispatch point).
 * Covers GLOBAL-key branches: looper_arm, looper_stop, looper_retrigger,
 * looper_sync, merge_arm, merge_stop, merge_place_row, merge_cancel, bake,
 * bake_scene, perf_mods, launch_scene, launch_scene_quant, mute_all_clear,
 * snap_save, snap_load, snap_delete. Each is a top-level `strcmp(key,...)`
 * branch. Returns 1 when it handled the key (caller returns from set_param),
 * 0 to fall through to the remaining globals segments / the tN_ block. */
static int sp_globals_misc(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *key = cx->key;
    const char *val = cx->val;

    if (!strcmp(key, "looper_arm")) {
        int t = clamp_i(my_atoi(val), 1, 65535);
        if (inst->looper_state == LOOPER_STATE_LOOPING) {
            if ((uint16_t)t == inst->looper_capture_ticks)
                inst->looper_pending_rate_ticks = 0;
            else
                inst->looper_pending_rate_ticks = (uint16_t)t;
            return 1;
        }
        looper_stop(inst);
        inst->looper_capture_ticks = (uint16_t)t;
        inst->looper_state = inst->looper_sync
                             ? LOOPER_STATE_ARMED
                             : LOOPER_STATE_CAPTURING;
        inst->looper_pos           = 0;
        inst->looper_event_count   = 0;
        inst->looper_play_idx      = 0;
        return 1;
    }
    if (!strcmp(key, "looper_stop")) {
        looper_stop(inst);
        return 1;
    }
    if (!strcmp(key, "looper_retrigger")) {
        /* Atomic stop + arm. Always re-captures fresh, regardless of current state.
         * Used by the JS held-loop re-trigger gesture (press same length pad while held). */
        int t = clamp_i(my_atoi(val), 1, 65535);
        looper_stop(inst);
        inst->looper_capture_ticks = (uint16_t)t;
        inst->looper_state = inst->looper_sync
                             ? LOOPER_STATE_ARMED
                             : LOOPER_STATE_CAPTURING;
        inst->looper_pos         = 0;
        inst->looper_event_count = 0;
        inst->looper_play_idx    = 0;
        return 1;
    }
    if (!strcmp(key, "looper_sync")) {
        inst->looper_sync = my_atoi(val) ? 1 : 0;
        return 1;
    }
    if (!strcmp(key, "merge_arm")) {
        /* Arm live merge. val "tN" = single-track mode: capture ONLY track
         * N's output (Track-View single-clip merge; JS auto-places into the
         * focused clip on CAPTURED). Any other val (legacy "1") = capture
         * all 8 tracks, destination scene row chosen post-stop via
         * merge_place_row. TPS is global at TICKS_PER_STEP so all tracks
         * share a coherent timeline. */
        int t;
        for (t = 0; t < NUM_TRACKS; t++) inst->merge_pending_count[t] = 0;
        inst->merge_solo_track = (val && val[0] == 't')
            ? (uint8_t)clamp_i(my_atoi(val + 1), 0, NUM_TRACKS - 1)
            : 0xFF;
        inst->merge_tps = (uint32_t)TICKS_PER_STEP;
        /* Live Merge is a STOPPED-transport operation (JS gates arm on !playing).
         * Run a 1-bar count-in (reusing the record count-in machinery, but with
         * count_in_merge=1). The count-in completion (seq8_render.c) resets all
         * positions to the top, starts the transport, launches every will_relaunch
         * clip below, and lets the main sequencer's ARMED→CAPTURING fire — so
         * capture begins cleanly at bar 1. Solo mode launches only its track (a
         * clean isolated resample); scene mode launches all 8. */
        inst->merge_state    = MERGE_STATE_ARMED;
        inst->count_in_ticks = 4 * PPQN;   /* 1 bar; tick_delta tracks actual BPM */
        inst->count_in_track = (inst->merge_solo_track != 0xFF) ? inst->merge_solo_track : 0;
        inst->count_in_merge = 1;
        inst->tick_accum     = 0;
        if (inst->metro_on >= 1) inst->metro_beat_count++;
        for (t = 0; t < NUM_TRACKS; t++) {
            if (inst->merge_solo_track == 0xFF || t == inst->merge_solo_track) {
                inst->tracks[t].queued_clip   = -1;
                inst->tracks[t].will_relaunch = 1;
            }
        }
        if (inst->clock_follow_on) follow_request_start(inst, 2);
        return 1;
    }
    if (!strcmp(key, "merge_stop")) {
        if (inst->count_in_merge) {
            /* Stop pressed during the count-in: abort the merge, stay stopped
             * (don't let the count-in complete + start the transport). */
            int t;
            inst->count_in_ticks = 0;
            inst->count_in_merge = 0;
            for (t = 0; t < NUM_TRACKS; t++) {
                inst->tracks[t].will_relaunch = 0;
                inst->merge_pending_count[t]  = 0;
            }
            inst->merge_state      = MERGE_STATE_IDLE;
            inst->merge_solo_track = 0xFF;
            return 1;
        }
        if (inst->merge_solo_track != 0xFF) {
            /* Single-track (Track-View) merge: finalize immediately in set_param
             * context (→ CAPTURED, no render-thread page-boundary wait, so no
             * STOPPING race), stop playback (ending a merge always halts the
             * transport), then wait for the user to pick a destination clip on
             * the merge track (JS switches to Session View + blinks the empty
             * clips). ext_transport_stop's merge_finalize is a no-op on CAPTURED,
             * so the captured take + merge_solo_track survive for placement. */
            merge_finalize(inst);   /* ARMED→IDLE; CAPTURING/STOPPING→CAPTURED */
            ext_transport_stop(inst);
            return 1;
        }
        if (inst->merge_state == MERGE_STATE_CAPTURING)
            inst->merge_state = MERGE_STATE_STOPPING;
        else
            merge_finalize(inst);
        return 1;
    }
    if (!strcmp(key, "merge_place_row")) {
        merge_place(inst, my_atoi(val));
        return 1;
    }
    if (!strcmp(key, "merge_cancel")) {
        /* Discard any captured pending notes without writing to clips. Also
         * abandon a count-in if one is mid-flight (defensive). */
        int t;
        for (t = 0; t < NUM_TRACKS; t++) inst->merge_pending_count[t] = 0;
        if (inst->count_in_merge) {
            inst->count_in_ticks = 0;
            inst->count_in_merge = 0;
            for (t = 0; t < NUM_TRACKS; t++) inst->tracks[t].will_relaunch = 0;
        }
        inst->merge_state      = MERGE_STATE_IDLE;
        inst->merge_solo_track = 0xFF;
        return 1;
    }
    if (!strcmp(key, "bake")) {
        /* val = "T C [M] [N] [L] [W]" — M: 0=melodic, 1=drum lane, 2=drum clip; N: loops 1/2/4; L: lane (mode 1); W: 1=wrap tails */
        int bt = 0, bc = 0, bm = 0, bn = 1, bl = 0, bw = 0;
        sscanf(val, "%d %d %d %d %d %d", &bt, &bc, &bm, &bn, &bl, &bw);
        if (bt >= 0 && bt < NUM_TRACKS && bc >= 0 && bc < NUM_CLIPS) {
            if (bm == 1)      bake_drum_lane(inst, bt, bc, clamp_i(bl, 0, DRUM_LANES-1), clamp_i(bn, 1, 4), bw ? 1 : 0);
            else if (bm == 2) bake_drum_clip(inst, bt, bc, clamp_i(bn, 1, 4), bw ? 1 : 0);
            else              bake_clip(inst, bt, bc, clamp_i(bn, 1, 4), bw ? 1 : 0, 0); /* clip bake: never folds conductor */
        }
        return 1;
    }
    if (!strcmp(key, "bake_scene")) {
        /* val = "C N W [A]" — C: clip index, N: loop count (1/2/4), W: 1=wrap
         * tails, A: 1=Apply Conductor (fold transposition + auto-disable
         * responders). A defaults to 0 if absent (back-compat). */
        int sc = 0, sn = 1, sw = 0, sa = 0;
        int t;
        sscanf(val, "%d %d %d %d", &sc, &sn, &sw, &sa);
        if (sc >= 0 && sc < NUM_CLIPS) {
            sn = clamp_i(sn, 1, 4);
            sw = sw ? 1 : 0;
            sa = sa ? 1 : 0;
            undo_begin_scene_bake(inst, sc);  /* snapshots conductor clip incl. cond_resp[] */
            inst->undo_locked = 1;
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->tracks[t].pad_mode == PAD_MODE_DRUM)
                    bake_drum_clip(inst, t, sc, sn, sw);
                else
                    bake_clip(inst, t, sc, sn, sw, sa);
            }
            inst->undo_locked = 0;
            /* Auto-disable: clear the Conductor clip C's responder flags for the
             * tracks just folded, so live playback won't double-apply. */
            if (sa && inst->conductor_track >= 0) {
                clip_t *ccl = &inst->tracks[inst->conductor_track].clips[sc];
                for (t = 0; t < NUM_TRACKS; t++) {
                    if (t == inst->conductor_track) continue;
                    if (inst->tracks[t].pad_mode == PAD_MODE_DRUM) continue;
                    if (inst->tracks[t].pad_mode == PAD_MODE_CONDUCT) continue;
                    if (ccl->cond_resp[t]) ccl->cond_resp[t] = 0;
                }
            }
            inst->state_dirty = 1;
            seq8_ilog(inst, "SEQ8 bake_scene");
        }
        return 1;
    }
    if (!strcmp(key, "perf_mods")) {
        inst->perf_mods_active = (uint32_t)(unsigned int)my_atoi(val);
        return 1;
    }

    if (!strcmp(key, "launch_scene")) {
        int cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
        int t;
        if (inst->launch_quant == 0 && inst->playing) {
            /* Now + transport running: fire per-track immediately */
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr2 = &inst->tracks[t];
                clip_t  *_ncl   = &tr2->clips[cidx];
                uint16_t newlen = _ncl->length;
                uint16_t _nls   = _ncl->loop_start;
                tr2->current_step     = tr2->clip_playing
                                       ? (uint16_t)(_nls + tr2->current_step % newlen)
                                       : (uint16_t)(_nls + inst->global_tick % newlen);
                tr2->active_clip      = (uint8_t)cidx;
                pfx_sync_from_clip(tr2);
                if (tr2->pad_mode == PAD_MODE_DRUM && tr2->drum_clips[cidx]) {
                    int _dl;
                    for (_dl = 0; _dl < DRUM_LANES; _dl++)
                        drum_lane_anchor_playhead(inst, tr2, _dl,
                            &tr2->drum_clips[cidx]->lanes[_dl].clip);
                }
                tr2->clip_playing     = 1;
                tr2->queued_clip      = -1;
                tr2->pending_page_stop = 0;
                tr2->will_relaunch    = 0;
            }
        } else {
            /* Quantized or stopped: queue at next boundary */
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->tracks[t].clip_playing)
                    inst->tracks[t].pending_page_stop = 1;
                inst->tracks[t].queued_clip   = (int8_t)cidx;
                inst->tracks[t].will_relaunch = 0;
            }
        }
        seq8_ilog(inst, "SEQ8 launch_scene");
        return 1;
    }

    if (!strcmp(key, "launch_scene_quant")) {
        /* Shift+row gesture (JS): queue at next bar boundary regardless of
         * global launch_quant. pending_page_stop=1 + queued_clip arms the
         * bar-aligned transition handled in render_block at L7374. */
        int cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
        int t;
        for (t = 0; t < NUM_TRACKS; t++) {
            if (inst->tracks[t].clip_playing)
                inst->tracks[t].pending_page_stop = 1;
            inst->tracks[t].queued_clip   = (int8_t)cidx;
            inst->tracks[t].will_relaunch = 0;
        }
        seq8_ilog(inst, "SEQ8 launch_scene_quant");
        return 1;
    }

    if (!strcmp(key, "mute_all_clear")) {
        int t;
        for (t = 0; t < NUM_TRACKS; t++) {
            inst->mute[t] = 0;
            inst->solo[t] = 0;
        }
        rui_touch(inst);   /* rui_index mute/solo (all tracks) */
        return 1;
    }

    if (!strcmp(key, "snap_save")) {
        /* Format: "N m0..m7 s0..s7 dm0..dm7" — dm values are uint32 drum eff-mute bitmasks */
        const char *p = val;
        int n = 0, t, v;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') n = n * 10 + (*p++ - '0');
        if (n < 0 || n >= 16) return 1;
        for (t = 0; t < NUM_TRACKS; t++) {
            while (*p == ' ') p++;
            v = 0;
            while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
            inst->snap_mute[n][t] = v ? 1 : 0;
        }
        for (t = 0; t < NUM_TRACKS; t++) {
            while (*p == ' ') p++;
            v = 0;
            while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
            inst->snap_solo[n][t] = v ? 1 : 0;
        }
        for (t = 0; t < NUM_TRACKS; t++) {
            while (*p == ' ') p++;
            uint32_t uv = 0;
            while (*p >= '0' && *p <= '9') uv = uv * 10 + (uint32_t)(*p++ - '0');
            inst->snap_drum_eff_mute[n][t] = uv;
        }
        inst->snap_valid[n] = 1;
        return 1;
    }

    if (!strcmp(key, "snap_load")) {
        int n = my_atoi(val), t;
        if (n < 0 || n >= 16 || !inst->snap_valid[n]) return 1;
        for (t = 0; t < NUM_TRACKS; t++) {
            inst->mute[t] = inst->snap_mute[n][t];
            inst->solo[t] = inst->snap_solo[n][t];
            inst->tracks[t].drum_lane_mute = inst->snap_drum_eff_mute[n][t];
            inst->tracks[t].drum_lane_solo = 0;
        }
        silence_muted_tracks(inst);
        rui_touch(inst);   /* rui_index mute/solo (snapshot recall, all tracks) */
        return 1;
    }

    if (!strcmp(key, "snap_delete")) {
        int n = my_atoi(val);
        if (n < 0 || n >= 16) return 1;
        inst->snap_valid[n] = 0;
        inst->state_dirty = 1;
        return 1;
    }

    return 0;
}
