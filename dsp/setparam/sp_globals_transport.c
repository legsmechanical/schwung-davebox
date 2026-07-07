/* FILE-SCOPE GLOBALS HANDLER for set_param()'s transport / tempo / tonality /
 * metronome / clock / count-in global keys -- part of the seq8.c single
 * translation unit; #included at FILE scope by seq8_set_param.c (before
 * set_param), NOT a standalone TU; never compile or lint this file on its own.
 * Globals handler (phase 4B group 13, THE FINAL group): dispatched BEFORE the
 * tN_ block, so it uses only inst/key/val (never tidx/tr/sub -- they aren't in
 * scope at the globals dispatch point).
 * Covers GLOBAL-key branches: transport, record_count_in,
 * record_count_in_cancel, metro_on, metro_vol, active_track, clock_follow_on,
 * clock_send_on, bpm, key, scale, scale_aware, inp_quant, swing_amt, swing_res,
 * midi_in_channel, launch_quant. Each is a top-level `strcmp(key,...)` branch.
 * Returns 1 when it handled the key (caller returns from set_param), 0 to fall
 * through to the tN_ block.
 * NOTE: the transport play_focus `val="play"` rewrite (below) reassigns the
 * unpacked LOCAL `val` copy only -- cx->val is never mutated, so downstream
 * handlers dispatched after this one (there are none among the globals; the
 * tN_ block follows) are unaffected. Do not write back to cx->val. */
static int sp_globals_transport(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *key = cx->key;
    const char *val = cx->val;

    /* Body below kept at its Stage-A segment indentation (4 spaces) so it
     * byte-diffs against the pre-conversion segment; reindent only in a
     * dedicated cleanup pass after the group is device-blessed. */

    if (!strcmp(key, "transport")) {
        /* play_focus:T:C — same as "play" but ARM the focused track's
         * clip to launch on this transport-start: sets will_relaunch=1
         * + active_clip=C + queued_clip=-1 BEFORE the play loop runs,
         * so clip_playing becomes 1 inside the same buffer (no separate
         * launch_clip set_param needed, which would coalesce). Used by
         * the JS Play press handler after a clip clear that left
         * will_relaunch=0. */
        if (!strncmp(val, "play_focus:", 11)) {
            const char *p = val + 11;
            int focus_t = 0, focus_c = 0;
            while (*p >= '0' && *p <= '9') { focus_t = focus_t * 10 + (*p++ - '0'); }
            if (*p == ':') p++;
            while (*p >= '0' && *p <= '9') { focus_c = focus_c * 10 + (*p++ - '0'); }
            focus_t = clamp_i(focus_t, 0, NUM_TRACKS - 1);
            focus_c = clamp_i(focus_c, 0, NUM_CLIPS - 1);
            if (!inst->playing) {
                seq8_track_t *_ftr = &inst->tracks[focus_t];
                _ftr->active_clip   = (uint8_t)focus_c;
                _ftr->queued_clip   = -1;
                _ftr->will_relaunch = 1;
                pfx_sync_from_clip(_ftr);
            }
            /* Fall through into the normal play path below. */
            val = "play";
        }
        if (!strcmp(val, "play")) {
            /* Clock-follow: single source of truth is Move's transport — request
             * a Move start (inject MovePlay / start-on-returning-0xFA) instead
             * of starting davebox independently. */
            if (inst->clock_follow_on) {
                follow_request_start(inst, 1);
            } else if (!inst->playing) {
                ext_transport_start(inst);
            }
        } else if (!strcmp(val, "stop")) {
            if (inst->clock_follow_on) {
                follow_request_stop(inst);
            } else if (inst->playing) {
                ext_transport_stop(inst);
                seq8_ilog(inst, "SEQ8 transport: stop");
            }
        } else if (!strcmp(val, "restart")) {
            /* Clock-follow: a free restart-while-playing can't reposition Move
             * via a single Play (decision #4). Tier-1: re-anchor davebox locally
             * to bar 1 (tempo stays locked to Move); if Move is stopped, request
             * a start. Move's own playhead is left untouched. */
            if (inst->clock_follow_on) {
                if (inst->ext_transport_running) ext_transport_start(inst);
                else follow_request_start(inst, 1);
                return 1;
            }
            /* Atomic stop+play: silence + finalize as in stop, then reset positions
             * + replay as in play. Single set_param avoids coalescing flakiness. */
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                play_fx_t *fx = &inst->tracks[t].pfx;
                silence_track_notes_v2(inst, &inst->tracks[t]);
                if (fx->route == ROUTE_MOVE) {
                    int ei;
                    for (ei = 0; ei < fx->event_count; ei++)
                        fx->events[ei].fire_at = fx->sample_counter;
                    memset(fx->active_notes, 0, sizeof(fx->active_notes));
                } else {
                    fx->event_count = 0;
                    memset(fx->active_notes, 0, sizeof(fx->active_notes));
                }
                inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                inst->tracks[t].pending_page_stop = 0;
                inst->tracks[t].record_armed      = 0;
                if (inst->tracks[t].recording) {
                    finalize_pending_notes(&inst->tracks[t].clips[inst->tracks[t].active_clip],
                                           &inst->tracks[t]);
                    clip_clear_suppress(&inst->tracks[t].clips[inst->tracks[t].active_clip]);
                }
                inst->tracks[t].recording   = 0;
                inst->tracks[t].queued_clip = -1;
            }
            send_panic(inst);

            inst->global_tick         = 0;
            inst->tick_accum          = 0;
            inst->master_tick_in_step = 0;
            inst->arp_master_tick     = 0;
            inst->count_in_ticks      = 0;
            reset_all_loop_cycles(inst);
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *_tr = &inst->tracks[t];
                {
                    clip_t *_mcl = &_tr->clips[_tr->active_clip];
                    _tr->current_step = initial_clip_step(_mcl->loop_start, _mcl->length, _mcl->playback_dir);
                    _mcl->pp_dir_state = initial_pp_dir(_mcl->playback_dir);
                }
                _tr->tick_in_step       = 0;
                _tr->note_active        = 0;
                _tr->pfx.sample_counter = 0;
                /* Re-peg queued ROUTE_MOVE events (note-offs kept above) to
                 * fire immediately: their fire_at was pegged to the counter
                 * we just zeroed — without this they'd never fire, stranding
                 * stuck Move voices (mirrors the count-in exit re-peg). */
                {
                    play_fx_t *_fx = &_tr->pfx;
                    int _ei;
                    for (_ei = 0; _ei < _fx->event_count; _ei++)
                        _fx->events[_ei].fire_at = 0;
                }
                if (_tr->drum_clips[_tr->active_clip]) {
                    int _dl;
                    for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                        clip_t *_dlc = &_tr->drum_clips[_tr->active_clip]->lanes[_dl].clip;
                        _tr->drum_current_step[_dl] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
                        _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
                    }
                }
                memset(_tr->drum_tick_in_step, 0, sizeof(_tr->drum_tick_in_step));
                if (_tr->will_relaunch) {
                    _tr->clip_playing      = 1;
                    _tr->will_relaunch     = 0;
                    _tr->pending_page_stop = 0;
                }
            }
            inst->playing = 1;
            seq8_ilog(inst, "SEQ8 transport: restart");
        } else if (!strncmp(val, "restart_at:", 11)) {
            /* Loop+Play: restart with active track's clip starting at page*16.
             * Format: "restart_at:<at>:<page>:<drumLane>" — drumLane -1 for melodic.
             * Other tracks land at musically-equivalent position (master_off % own_clip_ticks). */
            /* Clock-follow: arbitrary repositioning can't be mirrored to Move via a
             * single Play (decision #4). Tier-1: re-anchor to bar 1 locally rather
             * than silently drifting davebox away from Move. */
            if (inst->clock_follow_on) {
                if (inst->ext_transport_running) ext_transport_start(inst);
                else follow_request_start(inst, 1);
                return 1;
            }
            int at = 0, page = 0, lane = -1;
            int parsed = sscanf(val + 11, "%d:%d:%d", &at, &page, &lane);
            if (parsed < 2) { return 1; }
            if (at < 0) at = 0; if (at >= NUM_TRACKS) at = NUM_TRACKS - 1;
            if (page < 0) page = 0;

            seq8_track_t *atr = &inst->tracks[at];
            uint16_t step_tps;
            if (atr->pad_mode == PAD_MODE_DRUM && lane >= 0 && lane < DRUM_LANES
                    && atr->drum_clips[atr->active_clip]) {
                step_tps = atr->drum_clips[atr->active_clip]->lanes[lane].clip.ticks_per_step;
            } else {
                step_tps = atr->clips[atr->active_clip].ticks_per_step;
            }
            if (step_tps == 0) step_tps = TICKS_PER_STEP;
            uint64_t master_off = (uint64_t)page * 16ULL * (uint64_t)step_tps;

            /* Silence / finalize prelude (mirrors restart branch). */
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                play_fx_t *fx = &inst->tracks[t].pfx;
                silence_track_notes_v2(inst, &inst->tracks[t]);
                if (fx->route == ROUTE_MOVE) {
                    int ei;
                    for (ei = 0; ei < fx->event_count; ei++)
                        fx->events[ei].fire_at = fx->sample_counter;
                    memset(fx->active_notes, 0, sizeof(fx->active_notes));
                } else {
                    fx->event_count = 0;
                    memset(fx->active_notes, 0, sizeof(fx->active_notes));
                }
                inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                inst->tracks[t].pending_page_stop = 0;
                inst->tracks[t].record_armed      = 0;
                if (inst->tracks[t].recording) {
                    finalize_pending_notes(&inst->tracks[t].clips[inst->tracks[t].active_clip],
                                           &inst->tracks[t]);
                    clip_clear_suppress(&inst->tracks[t].clips[inst->tracks[t].active_clip]);
                }
                inst->tracks[t].recording   = 0;
                inst->tracks[t].queued_clip = -1;
            }
            send_panic(inst);

            inst->global_tick         = (uint32_t)(master_off / TICKS_PER_STEP);
            inst->master_tick_in_step = (uint32_t)(master_off % TICKS_PER_STEP);
            inst->tick_accum          = 0;
            inst->arp_master_tick     = (uint32_t)master_off;
            inst->count_in_ticks      = 0;
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr = &inst->tracks[t];
                clip_t *cl = &tr->clips[tr->active_clip];
                uint16_t ttps = cl->ticks_per_step ? cl->ticks_per_step : TICKS_PER_STEP;
                uint32_t clip_ticks = (uint32_t)cl->length * ttps;
                uint32_t track_off  = clip_ticks ? (uint32_t)(master_off % clip_ticks) : 0;
                /* Window-aware + direction-aware: phase-align playhead inside
                 * [loop_start, loop_start+length). For non-Forward modes the
                 * step layout mirrors live playback (see advance_clip_step). */
                {
                    uint16_t fwd_step = (uint16_t)(track_off / ttps);
                    uint16_t L = cl->length;
                    uint16_t target;
                    int8_t target_pp = +1;
                    switch (cl->playback_dir) {
                    case 1: target = (uint16_t)(L - 1u - fwd_step); break;
                    case 2: { /* PPFwd: cycle = 2L-2 (endpoint plays once) */
                        if (L <= 1) { target = 0; break; }
                        uint32_t cyc = (uint32_t)(track_off / ttps);
                        cyc %= (uint32_t)(2u * L - 2u);
                        if (cyc <= (uint32_t)(L - 1)) { target = (uint16_t)cyc;            target_pp = +1; }
                        else                          { target = (uint16_t)(2u*L - 2u - cyc); target_pp = -1; }
                        break;
                    }
                    case 3: { /* PPBwd */
                        if (L <= 1) { target = 0; break; }
                        uint32_t cyc = (uint32_t)(track_off / ttps);
                        cyc %= (uint32_t)(2u * L - 2u);
                        if (cyc <= (uint32_t)(L - 1)) { target = (uint16_t)(L - 1u - cyc); target_pp = -1; }
                        else                          { target = (uint16_t)(cyc - (L - 1u)); target_pp = +1; }
                        break;
                    }
                    case 0:
                    default: target = fwd_step; break;
                    }
                    tr->current_step = (uint16_t)(cl->loop_start + target);
                    cl->pp_dir_state = target_pp;
                }
                tr->tick_in_step = track_off % ttps;
                if (tr->drum_clips[tr->active_clip]) {
                int l;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_t *dcl = &tr->drum_clips[tr->active_clip]->lanes[l].clip;
                    uint16_t dtps = dcl->ticks_per_step ? dcl->ticks_per_step : TICKS_PER_STEP;
                    uint32_t dct  = (uint32_t)dcl->length * dtps;
                    uint32_t dto  = dct ? (uint32_t)(master_off % dct) : 0;
                    /* Phase-align per direction (same as melodic above). */
                    uint16_t fwd_step = (uint16_t)(dto / dtps);
                    uint16_t L = dcl->length;
                    uint16_t target;
                    int8_t target_pp = +1;
                    switch (dcl->playback_dir) {
                    case 1: target = (uint16_t)(L - 1u - fwd_step); break;
                    case 2: {
                        if (L <= 1) { target = 0; break; }
                        uint32_t cyc = (uint32_t)(dto / dtps);
                        cyc %= (uint32_t)(2u * L - 2u);
                        if (cyc <= (uint32_t)(L - 1)) { target = (uint16_t)cyc;            target_pp = +1; }
                        else                          { target = (uint16_t)(2u*L - 2u - cyc); target_pp = -1; }
                        break;
                    }
                    case 3: {
                        if (L <= 1) { target = 0; break; }
                        uint32_t cyc = (uint32_t)(dto / dtps);
                        cyc %= (uint32_t)(2u * L - 2u);
                        if (cyc <= (uint32_t)(L - 1)) { target = (uint16_t)(L - 1u - cyc); target_pp = -1; }
                        else                          { target = (uint16_t)(cyc - (L - 1u)); target_pp = +1; }
                        break;
                    }
                    case 0:
                    default: target = fwd_step; break;
                    }
                    tr->drum_current_step[l] = (uint16_t)(dcl->loop_start + target);
                    dcl->pp_dir_state = target_pp;
                    tr->drum_tick_in_step[l] = dto % dtps;
                }
                }
                tr->note_active        = 0;
                tr->pfx.sample_counter = 0;
                /* Re-peg queued ROUTE_MOVE events to fire immediately —
                 * same stranding hazard as the restart branch above. */
                {
                    play_fx_t *_fx = &tr->pfx;
                    int _ei;
                    for (_ei = 0; _ei < _fx->event_count; _ei++)
                        _fx->events[_ei].fire_at = 0;
                }
                if (tr->will_relaunch) {
                    tr->clip_playing      = 1;
                    tr->will_relaunch     = 0;
                    tr->pending_page_stop = 0;
                }
            }
            inst->playing = 1;
            {
                char _lpbuf[128];
                snprintf(_lpbuf, sizeof(_lpbuf),
                         "SEQ8 transport: restart_at t%d page %d lane %d (step_tps %u, master_off %u)",
                         at, page, lane, (unsigned)step_tps, (unsigned)master_off);
                seq8_ilog(inst, _lpbuf);
            }
        } else if (!strcmp(val, "panic")) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                play_fx_t *fx = &inst->tracks[t].pfx;
                silence_track_notes_v2(inst, &inst->tracks[t]);
                if (fx->route == ROUTE_MOVE) {
                    int ei;
                    for (ei = 0; ei < fx->event_count; ei++)
                        fx->events[ei].fire_at = fx->sample_counter;
                    memset(fx->active_notes, 0, sizeof(fx->active_notes));
                } else {
                    fx->event_count = 0;
                    memset(fx->active_notes, 0, sizeof(fx->active_notes));
                }
                inst->tracks[t].clips[inst->tracks[t].active_clip].clock_shift_pos = 0;
                inst->tracks[t].clip_playing      = 0;
                inst->tracks[t].will_relaunch     = 0;
                inst->tracks[t].pending_page_stop = 0;
                inst->tracks[t].record_armed      = 0;
                if (inst->tracks[t].recording) {
                    finalize_pending_notes(&inst->tracks[t].clips[inst->tracks[t].active_clip],
                                           &inst->tracks[t]);
                    clip_clear_suppress(&inst->tracks[t].clips[inst->tracks[t].active_clip]);
                }
                inst->tracks[t].recording         = 0;
                inst->tracks[t].queued_clip       = -1;
            }
            merge_finalize(inst);
            inst->playing        = 0;
            inst->count_in_ticks = 0;
            send_panic(inst);
            looper_stop(inst);  /* also queues deferred silence for ROUTE_MOVE looper notes */
            seq8_ilog(inst, "SEQ8 transport: panic");
        } else if (!strcmp(val, "deactivate_all")) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->tracks[t].clip_playing)
                    inst->tracks[t].pending_page_stop = 1;
                inst->tracks[t].queued_clip  = -1;
                inst->tracks[t].record_armed = 0;
            }
            seq8_ilog(inst, "SEQ8 transport: deactivate_all");
        }
        return 1;
    }

    /* --- DSP-side count-in --- */
    if (!strcmp(key, "record_count_in")) {
        int track = clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        if (inst->tracks[track].pad_mode == PAD_MODE_DRUM)
            undo_begin_drum_clip(inst, track, (int)inst->tracks[track].active_clip);
        else
            undo_begin_single(inst, track, (int)inst->tracks[track].active_clip);
        inst->count_in_track = (uint8_t)track;
        inst->count_in_ticks = 4 * PPQN;  /* 1 bar; tick_delta already tracks actual BPM */
        inst->tick_accum     = 0;          /* reset phase so first beat fires on schedule */
        if (inst->metro_on >= 1) inst->metro_beat_count++;  /* beat 1 fires immediately */
        /* PHASE-1: clear inbound press/release slots for this track so stale
         * active=1 flags from a prior recording session can't leak into the
         * upcoming preroll capture. The recording=1 transition fires inside
         * render_block (not via tN_recording set_param), so that path's
         * slot-clear doesn't run for count-in flows. */
        memset(inst->on_midi_press_active[track], 0,    sizeof(inst->on_midi_press_active[track]));
        memset(inst->on_midi_release_active[track], 0,  sizeof(inst->on_midi_release_active[track]));
        memset(inst->on_midi_drum_press_active[track], 0,
               sizeof(inst->on_midi_drum_press_active[track]));
        memset(inst->on_midi_drum_release_active[track], 0,
               sizeof(inst->on_midi_drum_release_active[track]));
        /* Clock-follow: start Move so the count-in lead-in bar is clocked by its
         * 0xF8 (decision #4 count-in-from-stopped). count_in_ticks counts down
         * on the incoming clock; at the downbeat the existing fire path arms +
         * launches. If Move never responds, the start-timeout falls back to an
         * internal start so the arm can't hang. */
        if (inst->clock_follow_on) follow_request_start(inst, 2);
        return 1;
    }
    if (!strcmp(key, "record_count_in_cancel")) {
        inst->count_in_ticks = 0;
        return 1;
    }

    /* --- Metronome --- */
    if (!strcmp(key, "metro_on")) {
        inst->metro_on = (uint8_t)clamp_i(my_atoi(val), 0, 3);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "metro_vol")) {
        inst->metro_vol = (uint8_t)clamp_i(my_atoi(val), 0, 150);
        inst->state_dirty = 1;
        return 1;
    }

    /* --- Active track --- */
    if (!strcmp(key, "active_track")) {
        inst->active_track = (uint8_t)clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        return 1;
    }

    if (!strcmp(key, "clock_follow_on")) {
        uint8_t on = (uint8_t)(my_atoi(val) ? 1 : 0);
        if (on == inst->clock_follow_on) { inst->state_dirty = 1; return 1; }
        inst->clock_follow_on = on;
        /* Reset follow bookkeeping on every toggle so a stale view of Move's
         * transport / a half-finished inject can't leak across mode changes. */
        inst->ext_tick_pending      = 0;
        inst->ext_transport_running = 0;
        inst->ext_clock_seen        = 0;
        inst->follow_play_request    = 0;
        inst->move_play_inject_phase = 0;
        inst->move_play_inject_wait = 0;
        inst->follow_start_timeout   = 0;
        inst->follow_start_kind      = 0;
        inst->follow_solo            = 0;   /* drop any solo-clock fallback on mode toggle */
        inst->solo_tick_accum        = 0;
        /* Restart tempo capture so a stale estimate can't leak across toggles. */
        inst->ext_clock_period_ema    = 0.0f;
        inst->clock_follow_bpm_applied = 0.0;
        /* Flush anything ringing so toggling mid-transport never hangs a note. */
        if (inst->playing || inst->count_in_ticks > 0) ext_transport_stop(inst);
        inst->state_dirty = 1;
        return 1;
    }

    /* Clock OUT: db emits realtime to external gear when free-running (master).
     * Suppressed while following (Move owns external sync). New global key —
     * verified reaching DSP the same way clock_follow_on does. */
    if (!strcmp(key, "clock_send_on")) {
        inst->clock_send_on = (uint8_t)(my_atoi(val) ? 1 : 0);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(key, "bpm")) {
        /* Tempo is read-only (EXT) while following — Move owns it. Ignore writes
         * (UI also hides the control), but never error. */
        if (inst->clock_follow_on) return 1;
        double bpm = (double)my_atoi(val);
        if (bpm < 40.0 || bpm > 250.0) return 1;
        inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
        int tb, tbl;
        for (tb = 0; tb < NUM_TRACKS; tb++) {
            inst->tracks[tb].pfx.cached_bpm = bpm;
            for (tbl = 0; tbl < DRUM_LANES; tbl++)
                inst->tracks[tb].drum_lane_pfx[tbl].cached_bpm = bpm;
        }
        inst->state_dirty = 1;
        return 1;
    }

    /* --- Global pad tonality --- */
    if (!strcmp(key, "key")) {
        inst->pad_key = (uint8_t)clamp_i(my_atoi(val), 0, 11);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "scale")) {
        inst->pad_scale = (uint8_t)clamp_i(my_atoi(val), 0, 13);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "scale_aware")) {
        inst->scale_aware = my_atoi(val) ? 1 : 0;
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "inp_quant")) {
        inst->inp_quant = my_atoi(val) ? 1 : 0;
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "swing_amt")) {
        inst->swing_amt = (uint8_t)clamp_i(my_atoi(val), 0, 100);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "swing_res")) {
        inst->swing_res = (uint8_t)clamp_i(my_atoi(val), 0, 1);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "midi_in_channel")) {
        inst->midi_in_channel = (uint8_t)clamp_i(my_atoi(val), 0, 16);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(key, "launch_quant")) {
        uint8_t old_q = inst->launch_quant;
        uint8_t new_q = (uint8_t)clamp_i(my_atoi(val), 0, 5);
        inst->launch_quant = new_q;
        /* Switching to Now while transport running: fire all queued clips immediately */
        if (new_q == 0 && old_q != 0 && inst->playing) {
            int t;
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr2 = &inst->tracks[t];
                if (tr2->queued_clip >= 0) {
                    clip_t  *_qcl   = &tr2->clips[tr2->queued_clip];
                    uint16_t newlen = _qcl->length;
                    uint16_t _qls   = _qcl->loop_start;
                    tr2->current_step     = tr2->clip_playing
                                           ? (uint16_t)(_qls + tr2->current_step % newlen)
                                           : (uint16_t)(_qls + inst->global_tick % newlen);
                    tr2->active_clip      = (uint8_t)tr2->queued_clip;
                    pfx_sync_from_clip(tr2);
                    if (tr2->pad_mode == PAD_MODE_DRUM && tr2->drum_clips[tr2->active_clip]) {
                        int _dl;
                        for (_dl = 0; _dl < DRUM_LANES; _dl++)
                            drum_lane_anchor_playhead(inst, tr2, _dl,
                                &tr2->drum_clips[tr2->active_clip]->lanes[_dl].clip);
                    }
                    tr2->clip_playing     = 1;
                    tr2->queued_clip      = -1;
                    tr2->pending_page_stop = 0;
                }
            }
        }
        inst->state_dirty = 1;
        return 1;
    }

    return 0;
}
