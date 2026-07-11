/* FILE-SCOPE HANDLER for set_param()'s tN_ track-config keys -- part of the
 * seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (immediately before set_param), NOT a standalone TU;
 * never compile or lint this file on its own. First Stage B handler
 * (phase 4B): the former mid-function segment is now a real
 * static int sp_track_config(sp_ctx_t *).
 * Covers tN_ track keys: xpose_prev ... track_looper.
 * See also sp_track_config2.c (clip_resolution, pad_octave, pad_mode,
 * convert_to_*, tarp_*, track_vel_override -- the other config-flavored keys).
 * Returns 1 when it handled the key (caller returns), 0 to fall through to
 * the sibling tN_ handlers. The tN_ guard and the tidx/sub/tr locals live in
 * the parent dispatcher now (seq8_set_param.c). */
static int sp_track_config(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    /* --- Transpose all melodic clips on Key/Scale change ---
     * Global op (clips on all tracks); carried on a per-track key (t0_)
     * because Schwung drops new global set_param keys. tr is ignored. */
    if (!strcmp(sub, "xpose_prev")) {
        /* "<oldK> <oldS> <newK> <newS>" — arm/refresh the live preview */
        int ok = 9, os = 1, nk = 9, ns = 1;
        sscanf(val, "%d %d %d %d", &ok, &os, &nk, &ns);
        build_xpose_lut(inst, clamp_i(ok, 0, 11), clamp_i(os, 0, 13),
                              clamp_i(nk, 0, 11), clamp_i(ns, 0, 13));
        inst->xpose_preview_key    = (uint8_t)clamp_i(nk, 0, 11);
        inst->xpose_preview_scale  = (uint8_t)clamp_i(ns, 0, 13);
        inst->xpose_preview_active = 1;
        return 1;
    }
    if (!strcmp(sub, "xpose_apply")) {
        /* "<oldK> <oldS> <newK> <newS> <flag>" — flag 1=commit, 0=cancel.
         * Self-contained (rebuilds the LUT from the descriptor) so a commit
         * can't ride a stale preview, and so notes + key/scale move atomically. */
        int ok = 9, os = 1, nk = 9, ns = 1, flag = 0;
        sscanf(val, "%d %d %d %d %d", &ok, &os, &nk, &ns, &flag);
        inst->xpose_preview_active = 0;
        if (flag) {
            ok = clamp_i(ok, 0, 11); os = clamp_i(os, 0, 13);
            nk = clamp_i(nk, 0, 11); ns = clamp_i(ns, 0, 13);
            build_xpose_lut(inst, ok, os, nk, ns);
            xpose_commit_all_clips(inst);
            inst->pad_key     = (uint8_t)nk;
            inst->pad_scale   = (uint8_t)ns;
            inst->state_dirty = 1;
        }
        return 1;
    }

    /* tN_launch_clip: Now=immediate, quantized=queue at next boundary */
    if (!strcmp(sub, "launch_clip")) {
        int new_cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
        if (inst->launch_quant == 0 && (tr->clip_playing || inst->playing)) {
            /* Now + transport active: fire immediately */
            silence_track_notes_v2(inst, tr);
            clip_t  *_ncl   = &tr->clips[new_cidx];
            uint16_t newlen = _ncl->length;
            uint16_t _nls   = _ncl->loop_start;
            if (_ncl->playback_dir == 0) {
                tr->current_step     = tr->clip_playing
                                       ? (uint16_t)(_nls + tr->current_step % newlen)
                                       : (uint16_t)(_nls + inst->global_tick % newlen);
            } else {
                /* Non-forward direction: jump to directional initial step.
                 * Polyrhythmic phase-align across mid-play launch is forward-
                 * only for now; re-trigger transport to resync cleanly. */
                tr->current_step = initial_clip_step(_nls, newlen, _ncl->playback_dir);
                _ncl->pp_dir_state = initial_pp_dir(_ncl->playback_dir);
            }
            tr->active_clip      = (uint8_t)new_cidx;
            pfx_sync_from_clip(tr);
            if (tr->tick_in_step >= tr->clips[new_cidx].ticks_per_step)
                tr->tick_in_step = 0;
            /* Clear lingering recording-suppressor flags on the newly-
             * active clip (see render_block queued-launch path). */
            clip_clear_suppress(&tr->clips[new_cidx]);
            if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[new_cidx]) {
                int dl;
                for (dl = 0; dl < DRUM_LANES; dl++) {
                    clip_t *_dnc = &tr->drum_clips[new_cidx]->lanes[dl].clip;
                    clip_clear_suppress(_dnc);
                    drum_lane_anchor_playhead(inst, tr, dl, _dnc);
                }
            }
            tr->clip_playing     = 1;
            tr->queued_clip      = -1;
            tr->pending_page_stop = 0;
            tr->will_relaunch    = 0;
        } else {
            /* Quantized or stopped: queue for next boundary. When stopped
             * with launch_quant=Now, also set will_relaunch so the next
             * transport=play kicks clip_playing=1 synchronously (without
             * this, JS pre-launch before play has no effect and the clip
             * stays silent until pollDSP's delayed launch lands ~1 step
             * later). For quantized launches (launch_quant != Now), keep
             * will_relaunch=0 so the launch still waits for the quant
             * boundary after transport starts. */
            tr->queued_clip = (int8_t)new_cidx;
            tr->will_relaunch = (inst->launch_quant == 0 && !inst->playing) ? 1 : 0;
            /* Preview queued clip pfx for JS display while stopped.
             * Safe: render loop exits immediately when !inst->playing. */
            if (!inst->playing) {
                tr->active_clip = (uint8_t)new_cidx;
                pfx_sync_from_clip(tr);
            }
        }
        return 1;
    }

    /* tN_stop_at_end: arm track to stop at next 16-step page boundary */
    if (!strcmp(sub, "stop_at_end")) {
        tr->pending_page_stop = 1;
        return 1;
    }

    /* tN_deactivate: cancel all pending/playing state immediately */
    if (!strcmp(sub, "deactivate")) {
        tr->clip_playing        = 0;
        tr->will_relaunch       = 0;
        tr->queued_clip         = -1;
        tr->pending_page_stop   = 0;
        tr->record_armed        = 0;
        tr->step_dispatch_mask  = 0;
        tr->next_early_mask     = 0;
        return 1;
    }

    /* tN_mute: set mute state; setting mute clears solo on same track */
    if (!strcmp(sub, "mute")) {
        inst->mute[tidx] = (val[0] == '1') ? 1 : 0;
        if (inst->mute[tidx]) inst->solo[tidx] = 0;
        silence_muted_tracks(inst);
        return 1;
    }

    /* tN_solo: set solo state; setting solo clears mute on same track.
     * The Conductor track can never be soloed — solo is inert on it (it
     * emits no MIDI; soloing it would also wrongly silence every other
     * track). Mute stays functional. */
    if (!strcmp(sub, "solo")) {
        if (tr->pad_mode == PAD_MODE_CONDUCT) return 1;
        inst->solo[tidx] = (val[0] == '1') ? 1 : 0;
        if (inst->solo[tidx]) inst->mute[tidx] = 0;
        silence_muted_tracks(inst);
        return 1;
    }

    /* tN_channel: set MIDI channel for this track (1-indexed in, 0-indexed stored) */
    if (!strcmp(sub, "channel")) {
        tr->channel = (uint8_t)clamp_i(my_atoi(val) - 1, 0, 15);
        return 1;
    }

    /* tN_route: set MIDI routing for this track */
    if (!strcmp(sub, "route")) {
        uint8_t rt;
        if (!strcmp(val, "schwung"))      rt = ROUTE_SCHWUNG;
        else if (!strcmp(val, "move"))    rt = ROUTE_MOVE;
        else if (!strcmp(val, "external")) rt = ROUTE_EXTERNAL;
        else return 1;
        tr->pfx.route = rt;
        { int _rl; for (_rl = 0; _rl < DRUM_LANES; _rl++) tr->drum_lane_pfx[_rl].route = rt; }
        return 1;
    }

    /* tN_track_looper: include/exclude this track from the global MIDI looper */
    if (!strcmp(sub, "track_looper")) {
        uint8_t lo = (uint8_t)(my_atoi(val) ? 1 : 0);
        tr->pfx.looper_on = lo;
        { int _ll; for (_ll = 0; _ll < DRUM_LANES; _ll++) tr->drum_lane_pfx[_ll].looper_on = lo; }
        inst->state_dirty = 1;
        return 1;
    }

    return 0;
}
