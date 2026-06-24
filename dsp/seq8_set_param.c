/* ------------------------------------------------------------------ */
/* set_param helpers                                                    */
/* ------------------------------------------------------------------ */

/* Silence all sounding notes on a track, with ROUTE_MOVE workaround.
 * pfx_send from set_param context doesn't release Move synth voices, so
 * for ROUTE_MOVE we reschedule queued note-offs to fire from render_block
 * and wipe active_notes (same pattern as transport stop). */
static void silence_track_from_set_param(seq8_instance_t *inst, seq8_track_t *tr) {
    play_fx_t *fx = &tr->pfx;
    silence_track_notes_v2(inst, tr);
    if (fx->route == ROUTE_MOVE) {
        int ei;
        for (ei = 0; ei < fx->event_count; ei++)
            fx->events[ei].fire_at = fx->sample_counter;
        memset(fx->active_notes, 0, sizeof(fx->active_notes));
    } else {
        fx->event_count = 0;
        memset(fx->active_notes, 0, sizeof(fx->active_notes));
    }
}

/* Apply a play-effects key/value to a track's live pfx and to a caller-supplied
 * pfx_params (melodic: active clip; drum: specific lane). */
static void pfx_set(seq8_instance_t *inst, seq8_track_t *tr,
                    clip_pfx_params_t *cp, const char *key, const char *val) {
    play_fx_t *fx = &tr->pfx;

#define PFX_SET_BOTH(fx_field, cp_field, lo, hi) \
    { int _v = clamp_i(my_atoi(val), (lo), (hi)); fx->fx_field = _v; cp->cp_field = _v; }

    if (!strcmp(key, "noteFX_octave"))
        { PFX_SET_BOTH(octave_shift, octave_shift, -4, 4); return; }
    if (!strcmp(key, "noteFX_offset"))
        { PFX_SET_BOTH(note_offset, note_offset, -24, 24); return; }
    if (!strcmp(key, "noteFX_gate"))
        { PFX_SET_BOTH(gate_time, gate_time, 0, 400); return; }
    if (!strcmp(key, "noteFX_velocity"))
        { PFX_SET_BOTH(velocity_offset, velocity_offset, -127, 127); return; }
    if (!strcmp(key, "noteFX_random"))
        { PFX_SET_BOTH(note_random, note_random, 0, 24); return; }
    if (!strcmp(key, "noteFX_random_mode"))
        { PFX_SET_BOTH(note_random_mode, note_random_mode, 0, 2); return; }
    if (!strcmp(key, "noteFX_length_mode")) {
        /* NOTE FX K5 Len: 0=`--` passthrough, 1..8 = fixed multiples
         * (.25/.5/.75/1/2/4/8/16). Lives only on clip_pfx_params (no
         * play_fx_t mirror — render reads cl->pfx_params directly). */
        int _v = clamp_i(my_atoi(val), 0, 8);
        cp->note_length_mode = (uint8_t)_v;
        return;
    }

    if (!strcmp(key, "harm_octaver"))
        { PFX_SET_BOTH(octaver, octaver, -4, 4); return; }
    if (!strcmp(key, "harm_interval1"))
        { PFX_SET_BOTH(harmonize_1, harmonize_1, -24, 24); return; }
    if (!strcmp(key, "harm_interval2"))
        { PFX_SET_BOTH(harmonize_2, harmonize_2, -24, 24); return; }
    if (!strcmp(key, "harm_interval3"))
        { PFX_SET_BOTH(harmonize_3, harmonize_3, -24, 24); return; }

    if (!strcmp(key, "delay_time"))
        { PFX_SET_BOTH(delay_time_idx, delay_time_idx, 0, NUM_CLOCK_VALUES - 1); return; }
    if (!strcmp(key, "delay_level"))
        { PFX_SET_BOTH(delay_level, delay_level, 0, 127); return; }
    if (!strcmp(key, "delay_repeats"))
        { PFX_SET_BOTH(repeat_times, repeat_times, 0, MAX_REPEATS); return; }
    if (!strcmp(key, "delay_vel_fb"))
        { PFX_SET_BOTH(fb_velocity, fb_velocity, -127, 127); return; }
    if (!strcmp(key, "delay_pitch_fb"))
        { PFX_SET_BOTH(fb_note, fb_note, -24, 24); return; }
    if (!strcmp(key, "delay_pitch_random"))
        { PFX_SET_BOTH(fb_note_random, fb_note_random, 0, 24); return; }
    if (!strcmp(key, "delay_pitch_random_mode"))
        { PFX_SET_BOTH(fb_note_random_mode, fb_note_random_mode, 0, 2); return; }
    if (!strcmp(key, "delay_gate_fb"))
        { PFX_SET_BOTH(fb_gate_time, fb_gate_time, 0, 10); return; }
    if (!strcmp(key, "delay_clock_fb"))
        { PFX_SET_BOTH(fb_clock, fb_clock, -100, 100); return; }
    if (!strcmp(key, "delay_retrig"))
        { PFX_SET_BOTH(delay_retrig, delay_retrig, 0, 1); return; }

    if (!strcmp(key, "quantize"))
        { PFX_SET_BOTH(quantize, quantize, 0, 100); return; }

    /* SEQ ARP — write to both live arp engine and per-clip params.
     * Style 0 = Off (bypass): silence sounding output on transition into Off. */
    if (!strcmp(key, "seq_arp_style")) {
        int _v = clamp_i(my_atoi(val), 0, 9);
        int _was = (int)fx->arp.style;
        cp->seq_arp_style = _v;
        fx->arp.style     = (uint8_t)_v;
        if (_was != 0 && _v == 0) arp_silence(inst, tr);
        return;
    }
    if (!strcmp(key, "seq_arp_rate")) {
        int _v = clamp_i(my_atoi(val), 0, 9);
        cp->seq_arp_rate = _v;
        fx->arp.rate_idx = (uint8_t)_v;
        return;
    }
    if (!strcmp(key, "seq_arp_octaves")) {
        int _v = clamp_i(my_atoi(val), -4, 4);
        cp->seq_arp_octaves = _v;
        fx->arp.octaves     = (int8_t)_v;
        return;
    }
    if (!strcmp(key, "seq_arp_gate")) {
        int _v = clamp_i(my_atoi(val), 1, 200);
        cp->seq_arp_gate = _v;
        fx->arp.gate_pct = (uint16_t)_v;
        return;
    }
    if (!strcmp(key, "seq_arp_steps_mode")) {
        int _v = clamp_i(my_atoi(val), 0, 2);
        cp->seq_arp_steps_mode = _v;
        fx->arp.steps_mode     = (uint8_t)_v;
        return;
    }
    if (!strcmp(key, "seq_arp_retrigger")) {
        int _v = my_atoi(val) ? 1 : 0;
        cp->seq_arp_retrigger = _v;
        fx->arp.retrigger     = (uint8_t)_v;
        return;
    }
    if (!strcmp(key, "seq_arp_sync")) {
        int _v = my_atoi(val) ? 1 : 0;
        cp->seq_arp_sync  = _v;
        fx->seq_arp_sync  = (uint8_t)_v;
        return;
    }
    if (!strcmp(key, "seq_arp_step_vel")) {
        /* Format: "S L" — step index 0..7, level 0..4 (0=step off, 4=full incoming). */
        const char *p = val;
        int s = 0, lv = 0;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') { lv = lv * 10 + (*p - '0'); p++; }
        if (s < 0 || s > 7) return;
        lv = clamp_i(lv, 0, 4);
        cp->seq_arp_step_vel[s] = (uint8_t)lv;
        fx->arp.step_vel[s]     = (uint8_t)lv;
        return;
    }
    if (!strcmp(key, "seq_arp_step_int")) {
        /* Format: "S I" — step index 0..7, signed interval -24..+24 (scale degrees). */
        const char *p = val;
        int s = 0, iv = 0, sign = 1;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
        while (*p == ' ') p++;
        if (*p == '-') { sign = -1; p++; }
        else if (*p == '+') { p++; }
        while (*p >= '0' && *p <= '9') { iv = iv * 10 + (*p - '0'); p++; }
        if (s < 0 || s > 7) return;
        iv = clamp_i(iv * sign, -24, 24);
        cp->seq_arp_step_int[s] = (int8_t)iv;
        fx->arp.step_int[s]     = (int8_t)iv;
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "seq_arp_step_loop_len")) {
        int _v = clamp_i(my_atoi(val), 1, 8);
        cp->seq_arp_step_loop_len = (uint8_t)_v;
        fx->arp.step_loop_len     = (uint8_t)_v;
        inst->state_dirty = 1;
        return;
    }

#undef PFX_SET_BOTH

    if (!strcmp(key, "pfx_reset")) {
        arp_silence(inst, tr);
        pfx_reset(fx);
        clip_pfx_params_init(cp);
        return;
    }
    if (!strcmp(key, "pfx_noteFx_reset")) {
        fx->octave_shift     = 0; cp->octave_shift     = 0;
        fx->note_offset      = 0; cp->note_offset      = 0;
        fx->gate_time        = 100; cp->gate_time      = 100;
        fx->velocity_offset  = 0; cp->velocity_offset  = 0;
        fx->quantize         = 0; cp->quantize         = 0;
        fx->note_random      = 0; cp->note_random      = 0;
        fx->note_random_mode = 2; cp->note_random_mode = 2;
        fx->note_random_walk = 0;
        return;
    }
    if (!strcmp(key, "pfx_harm_reset")) {
        fx->octaver     = 0; cp->octaver     = 0;
        fx->harmonize_1 = 0; cp->harmonize_1 = 0;
        fx->harmonize_2 = 0; cp->harmonize_2 = 0;
        fx->harmonize_3 = 0; cp->harmonize_3 = 0;
        return;
    }
    if (!strcmp(key, "pfx_delay_reset")) {
        fx->delay_time_idx  = DEFAULT_DELAY_TIME_IDX; cp->delay_time_idx  = DEFAULT_DELAY_TIME_IDX;
        fx->delay_level     = 0; cp->delay_level     = 0;
        fx->repeat_times    = 0; cp->repeat_times    = 0;
        fx->fb_velocity     = 0; cp->fb_velocity     = 0;
        fx->fb_note         = 0; cp->fb_note         = 0;
        fx->fb_note_random      = 0; cp->fb_note_random      = 0;
        fx->fb_note_random_mode = 2; cp->fb_note_random_mode = 2;
        fx->fb_gate_time    = 0; cp->fb_gate_time    = 0;
        fx->fb_clock        = 0; cp->fb_clock        = 0;
        return;
    }
    if (!strcmp(key, "pfx_seq_arp_reset")) {
        cp->seq_arp_style     = 0;
        cp->seq_arp_rate      = ARP_RATE_DEFAULT;
        cp->seq_arp_octaves   = 1;
        cp->seq_arp_gate      = 100;
        cp->seq_arp_steps_mode = 0;
        cp->seq_arp_retrigger = 1;
        cp->seq_arp_sync      = 1;
        int _i;
        for (_i = 0; _i < 8; _i++) cp->seq_arp_step_vel[_i] = 4;
        arp_silence(inst, tr);
        arp_init_defaults(&fx->arp);
        fx->seq_arp_sync = 1;
        return;
    }

    if (!strcmp(key, "print")) {
        if (!strcmp(val, "1") && !inst->printing) {
            inst->printing = 1;
            seq8_ilog(inst, "SEQ8 print: started");
        } else if (!strcmp(val, "0") && inst->printing) {
            inst->printing = 0;
            pfx_reset(fx);
            clip_pfx_params_init(cp);
            seq8_ilog(inst, "SEQ8 print: done, chain reset to neutral");
        }
        return;
    }
}

/* Send targeted note-offs for all gen_notes of active entries in active_notes[].
 * Used on stop/panic for ROUTE_MOVE tracks — send_panic's 128-note flood
 * exceeds midi_inject_to_move's rate limit, so only a few notes make it through. */
static void silence_active_notes_move(seq8_instance_t *inst, seq8_track_t *tr) {
    play_fx_t *fx = &tr->pfx;
    uint8_t off_s = (uint8_t)(0x80 | tr->channel);
    uint8_t cc_s  = (uint8_t)(0xB0 | tr->channel);
    int n, i, sent = 0;
    int has_inject = (g_host && g_host->midi_inject_to_move) ? 1 : 0;

    /* Pass 1: notes still in active_notes (gate not yet expired) */
    for (n = 0; n < 128; n++) {
        pfx_active_t *an = &fx->active_notes[n];
        if (!an->active) continue;
        for (i = 0; i < an->gen_count; i++) {
            pfx_send(fx, off_s, an->gen_notes[i], 0);
            sent++;
        }
    }

    /* Pass 2: note-offs already queued in event queue but not yet fired.
     * pfx_note_off clears active_notes immediately when it queues; these
     * notes are sounding on Move but won't reach it when event_count is
     * cleared. Fire them now before the queue is wiped. */
    for (i = 0; i < fx->event_count; i++) {
        uint8_t status = fx->events[i].msg[0];
        if ((status & 0xF0) == 0x80) {
            pfx_send(fx, status, fx->events[i].msg[1], fx->events[i].msg[2]);
            sent++;
        }
    }

    /* Pass 3: CC 123 (All Notes Off) as safety net */
    pfx_send(fx, cc_s, 123, 0);

    {
        char _lb[64];
        snprintf(_lb, sizeof(_lb), "silence_move: inject=%d pp=%d eq=%d sent=%d",
                 has_inject, (int)tr->play_pending_count, fx->event_count, sent);
        seq8_ilog(inst, _lb);
    }
}

/* ------------------------------------------------------------------ */
/* Transport edges (shared by set_param "play"/"stop" and clock-follow   */
/* on_midi 0xFA/0xFC). Factored out so the playhead reset / note-silence */
/* logic has one source of truth. Allocation- and file-IO-free, so they  */
/* are safe to call from on_midi (RT SPI thread).                        */
/* ------------------------------------------------------------------ */

/* Reset every track to its window start, re-assert automation, relaunch
 * armed clips, and set playing=1. Unconditional (no !playing guard) so an
 * incoming 0xFA re-anchors a running davebox to bar 1 (decision #1). */
static void ext_transport_start(seq8_instance_t *inst) {
    int t;
    inst->global_tick         = 0;
    inst->tick_accum          = 0;
    inst->master_tick_in_step = 0;
    inst->arp_master_tick     = 0;
    inst->ext_tick_pending    = 0;
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
        if (_tr->drum_clips[_tr->active_clip]) {
            int _dl;
            for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                clip_t *_dlc = &_tr->drum_clips[_tr->active_clip]->lanes[_dl].clip;
                _tr->drum_current_step[_dl] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
                _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
            }
        }
        memset(_tr->drum_tick_in_step, 0, sizeof(_tr->drum_tick_in_step));
        /* Re-assert CC + aftertouch automation at the playhead on (re)start. */
        memset(_tr->cc_auto_last_sent, 0xFF, 8);
        memset(_tr->at_last_sent, 0xFF, AT_MAX_LANES);
        if (_tr->will_relaunch) {
            _tr->clip_playing      = 1;
            _tr->will_relaunch     = 0;
            _tr->pending_page_stop = 0;
        }
    }
    inst->playing = 1;
}

/* Silence/finalize all tracks, panic, and set playing=0. Mirrors the
 * set_param "stop" body (note-offs rescheduled to render_block for ROUTE_MOVE,
 * since a set_param-context inject doesn't release Move voices; from on_midi
 * they fire on the next render pass). */
static void ext_transport_stop(seq8_instance_t *inst) {
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
        if (inst->tracks[t].clip_playing) {
            inst->tracks[t].will_relaunch = 1;
            inst->tracks[t].clip_playing  = 0;
        }
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
    inst->playing          = 0;
    inst->count_in_ticks   = 0;
    inst->ext_tick_pending = 0;
    inst->follow_solo      = 0;   /* solo-clock fallback evaporates when the take stops */
    inst->solo_tick_accum  = 0;
    send_panic(inst);
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *_tr = &inst->tracks[t];
        cc_auto_t *_ca = &_tr->clip_cc_auto[_tr->active_clip];
        int _k;
        for (_k = 0; _k < 8; _k++) {
            if (_ca->rest_val[_k] != 0xFF) {
                cc_emit(_tr, _k, _ca->rest_val[_k]);
                _tr->cc_auto_cur_val[_k] = _ca->rest_val[_k];
            }
            _tr->cc_auto_last_sent[_k] = 0xFF;
        }
    }
}

/* Clock-follow: route a transport-start gesture. When Move is already running,
 * start davebox now locked to the live clock (no Move restart). When Move is
 * stopped, arm a MovePlay inject (drained from render_block) and wait for the
 * returning 0xFA to start davebox phase-locked. kind: 1 = plain play, 2 =
 * record count-in (count_in_ticks already armed by the caller). */
static void follow_request_start(seq8_instance_t *inst, uint8_t kind) {
    inst->follow_play_request = 1;
    if (inst->ext_transport_running) {
        if (kind != 2 && !inst->playing) ext_transport_start(inst);
        /* count-in: leave count_in_ticks running off the live clock. */
        return;
    }
    if (inst->move_play_inject_phase == 0) {
        inst->move_play_inject_phase = 1;                 /* arm press→release */
        /* Wait long enough for Move's Ableton Link transport-sync to land (up to
         * ~1 bar) before giving up. Sized to ~1.5 bars at the last-known tempo and
         * clamped — the old fixed 1.5 s gave up mid-Link-sync and dropped the
         * count-in. We only READ cached_bpm here (don't write db's tempo). */
        double _bpm = (double)inst->tracks[0].pfx.cached_bpm;
        if (_bpm < 20.0 || _bpm > 400.0) _bpm = 120.0;
        double _bar = (double)inst->sample_rate * 60.0 / _bpm * 4.0;  /* samples per bar */
        int32_t _to = (int32_t)(_bar * 1.5);                         /* ~1.5 bars */
        int32_t _lo = (int32_t)(inst->sample_rate * 2);              /* >= 2 s */
        int32_t _hi = (int32_t)(inst->sample_rate * 9);              /* <= 9 s */
        if (_to < _lo) _to = _lo;
        if (_to > _hi) _to = _hi;
        inst->follow_start_timeout    = _to;
        inst->follow_start_kind       = kind;
    }
}

/* Clock-follow: route a transport-stop gesture. Toggle Move off if it's running
 * (davebox stops on the returning 0xFC / staleness); otherwise stop locally. */
static void follow_request_stop(seq8_instance_t *inst) {
    inst->follow_play_request = 0;
    inst->follow_start_timeout = 0;
    inst->follow_start_kind    = 0;
    if (inst->ext_transport_running) {
        if (inst->move_play_inject_phase == 0)
            inst->move_play_inject_phase = 1;             /* toggle Move off */
    } else {
        if (inst->playing || inst->count_in_ticks > 0) ext_transport_stop(inst);
    }
}

/* ------------------------------------------------------------------ */
/* set_param                                                            */
/* ------------------------------------------------------------------ */

static void set_param(void *instance, const char *key, const char *val) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst || !key || !val) return;


    /* --- Transport (global) --- */
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
                return;
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
                return;
            }
            int at = 0, page = 0, lane = -1;
            int parsed = sscanf(val + 11, "%d:%d:%d", &at, &page, &lane);
            if (parsed < 2) { return; }
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
        return;
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
        return;
    }
    if (!strcmp(key, "record_count_in_cancel")) {
        inst->count_in_ticks = 0;
        return;
    }

    /* --- Metronome --- */
    if (!strcmp(key, "metro_on")) {
        inst->metro_on = (uint8_t)clamp_i(my_atoi(val), 0, 3);
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "metro_vol")) {
        inst->metro_vol = (uint8_t)clamp_i(my_atoi(val), 0, 150);
        inst->state_dirty = 1;
        return;
    }

    /* --- Active track --- */
    if (!strcmp(key, "active_track")) {
        inst->active_track = (uint8_t)clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        return;
    }

    if (!strcmp(key, "clock_follow_on")) {
        uint8_t on = (uint8_t)(my_atoi(val) ? 1 : 0);
        if (on == inst->clock_follow_on) { inst->state_dirty = 1; return; }
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
        return;
    }

    /* Clock OUT: db emits realtime to external gear when free-running (master).
     * Suppressed while following (Move owns external sync). New global key —
     * verified reaching DSP the same way clock_follow_on does. */
    if (!strcmp(key, "clock_send_on")) {
        inst->clock_send_on = (uint8_t)(my_atoi(val) ? 1 : 0);
        inst->state_dirty = 1;
        return;
    }

    if (!strcmp(key, "bpm")) {
        /* Tempo is read-only (EXT) while following — Move owns it. Ignore writes
         * (UI also hides the control), but never error. */
        if (inst->clock_follow_on) return;
        double bpm = (double)my_atoi(val);
        if (bpm < 40.0 || bpm > 250.0) return;
        inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
        int tb, tbl;
        for (tb = 0; tb < NUM_TRACKS; tb++) {
            inst->tracks[tb].pfx.cached_bpm = bpm;
            for (tbl = 0; tbl < DRUM_LANES; tbl++)
                inst->tracks[tb].drum_lane_pfx[tbl].cached_bpm = bpm;
        }
        inst->state_dirty = 1;
        return;
    }

    /* --- Global pad tonality --- */
    if (!strcmp(key, "key")) {
        inst->pad_key = (uint8_t)clamp_i(my_atoi(val), 0, 11);
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "scale")) {
        inst->pad_scale = (uint8_t)clamp_i(my_atoi(val), 0, 13);
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "scale_aware")) {
        inst->scale_aware = my_atoi(val) ? 1 : 0;
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "inp_quant")) {
        inst->inp_quant = my_atoi(val) ? 1 : 0;
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "swing_amt")) {
        inst->swing_amt = (uint8_t)clamp_i(my_atoi(val), 0, 100);
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "swing_res")) {
        inst->swing_res = (uint8_t)clamp_i(my_atoi(val), 0, 1);
        inst->state_dirty = 1;
        return;
    }
    if (!strcmp(key, "midi_in_channel")) {
        inst->midi_in_channel = (uint8_t)clamp_i(my_atoi(val), 0, 16);
        inst->state_dirty = 1;
        return;
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
        return;
    }
    if (!strcmp(key, "debug_log")) {
        seq8_ilog(inst, val);
        return;
    }

    if (!strcmp(key, "save")) {
        inst->xpose_preview_active = 0;  /* defensive: never persist/leave a preview stuck on suspend */
        if (!inst->state_version_mismatch)
            seq8_save_state(inst);
        return;
    }

    /* Walk /data/UserData/schwung/set_state/ and remove seq8-state.json +
     * seq8-ui-state.json for any UUID-named subdir whose corresponding Move
     * set folder no longer exists. Leaves Schwung core's master_fx_*.json,
     * shadow_chain_config.json, slot_*.json untouched. */
    if (!strcmp(key, "prune_orphan_states")) {
        DIR *d = opendir("/data/UserData/schwung/set_state");
        if (!d) { seq8_ilog(inst, "SEQ8 prune: opendir failed"); return; }
        struct dirent *de;
        char buf[256];
        int scanned = 0, removed = 0;
        while ((de = readdir(d)) != NULL) {
            const char *n = de->d_name;
            /* UUID format: 8-4-4-4-12 hex chars with hyphens at fixed positions. */
            if (strlen(n) != 36) continue;
            if (n[8] != '-' || n[13] != '-' || n[18] != '-' || n[23] != '-') continue;
            int hex_ok = 1, _i;
            for (_i = 0; _i < 36 && hex_ok; _i++) {
                if (_i == 8 || _i == 13 || _i == 18 || _i == 23) continue;
                char c = n[_i];
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
                    hex_ok = 0;
            }
            if (!hex_ok) continue;
            scanned++;
            snprintf(buf, sizeof(buf), "/data/UserData/UserLibrary/Sets/%s", n);
            struct stat st;
            if (stat(buf, &st) == 0) continue;
            snprintf(buf, sizeof(buf), "/data/UserData/schwung/set_state/%s/seq8-state.json", n);
            int u1 = unlink(buf);
            snprintf(buf, sizeof(buf), "/data/UserData/schwung/set_state/%s/seq8-ui-state.json", n);
            int u2 = unlink(buf);
            /* Snapshot files (seq8-snap-index.json + seq8-snap-<id>-*.json) have
             * variable names — enumerate the orphaned set's folder and remove
             * any. Without this the rmdir below always fails for sets that had
             * snapshots, leaving the folder + snap files behind. */
            snprintf(buf, sizeof(buf), "/data/UserData/schwung/set_state/%s", n);
            DIR *sd = opendir(buf);
            if (sd) {
                struct dirent *sde;
                char sbuf[512];
                while ((sde = readdir(sd)) != NULL) {
                    if (strncmp(sde->d_name, "seq8-snap-", 10) != 0) continue;
                    snprintf(sbuf, sizeof(sbuf),
                             "/data/UserData/schwung/set_state/%s/%s", n, sde->d_name);
                    unlink(sbuf);
                }
                closedir(sd);
            }
            snprintf(buf, sizeof(buf), "/data/UserData/schwung/set_state/%s", n);
            rmdir(buf);  /* silently fails if other module's files remain */
            if (u1 == 0 || u2 == 0) removed++;
        }
        closedir(d);
        {
            char log[96];
            snprintf(log, sizeof(log), "SEQ8 prune: scanned=%d removed=%d", scanned, removed);
            seq8_ilog(inst, log);
        }
        return;
    }

    if (!strcmp(key, "state_path")) {
        strncpy(inst->state_path, val, sizeof(inst->state_path) - 1);
        inst->state_path[sizeof(inst->state_path) - 1] = '\0';
        seq8_ilog(inst, inst->state_path);
        return;
    }

    if (!strcmp(key, "state_load")) {
        /* val is the UUID from JS (36 chars); construct path from it. Fallback if empty. */
        if (val && val[0])
            snprintf(inst->state_path, sizeof(inst->state_path),
                     "/data/UserData/schwung/set_state/%s/seq8-state.json", val);
        else
            strncpy(inst->state_path, SEQ8_STATE_PATH_FALLBACK,
                    sizeof(inst->state_path) - 1);
        seq8_ilog(inst, inst->state_path);
        /* Reset internal state without MIDI panic to avoid flooding the MIDI buffer. */
        {
            int t2, c2;
            inst->merge_state = MERGE_STATE_IDLE;
            for (t2 = 0; t2 < NUM_TRACKS; t2++) inst->merge_pending_count[t2] = 0;
            inst->playing        = 0;
            inst->count_in_ticks = 0;
            for (t2 = 0; t2 < NUM_TRACKS; t2++) {
                seq8_track_t *tr2 = &inst->tracks[t2];
                tr2->note_active         = 0;
                tr2->pending_note_count  = 0;
                tr2->pfx.event_count     = 0;
                memset(tr2->pfx.active_notes, 0, sizeof(tr2->pfx.active_notes));
                tr2->clip_playing        = 0;
                tr2->will_relaunch       = 0;
                tr2->pending_page_stop   = 0;
                tr2->record_armed        = 0;
                tr2->recording           = 0;
                tr2->queued_clip         = -1;
                tr2->active_clip         = 0;
                tr2->current_step        = 0;
                tr2->step_dispatch_mask  = 0;
                tr2->next_early_mask     = 0;
                tr2->drum_repeat_active  = 0;
                tr2->drum_repeat2_active = 0;
                /* Reset pad_mode to the create_instance default so Clear Session
                 * (v=0 state file → seq8_load_state deletes file, leaves in-memory
                 * track state untouched) doesn't leave previously-drum tracks
                 * stuck in drum mode. JS re-pushes t0_pad_mode=DRUM after the
                 * pendingDspSync drain via restoreUiSidecar's first-run defaults
                 * branch, so t0 still ends up in DRUM as expected; t1-7 stay
                 * MELODIC. For valid v=28 files, seq8_load_state below overwrites
                 * this with the saved value. */
                tr2->pad_mode            = PAD_MODE_MELODIC_SCALE;
                tr2->active_drum_lane    = 0;
                tr2->drum_perform_mode   = 0;
                /* Additional track-config fields that also drift after Clear
                 * Session if not reset here. JS doClearSession resets the JS
                 * mirrors but never pushes them to DSP; for v=0 (cleared) state
                 * files seq8_load_state leaves in-memory values untouched. */
                /* track N → ch N (tracks 1-4 → ch 1-4 for Move, tracks 5-8 →
                 * ch 5-8 for Schwung). */
                tr2->channel             = (uint8_t)t2;
                tr2->pad_octave          = 3;
                tr2->pfx.looper_on       = 1;
                tr2->pfx.route           = (t2 < 4) ? ROUTE_MOVE : ROUTE_SCHWUNG;
                { int _rl; for (_rl = 0; _rl < DRUM_LANES; _rl++) tr2->drum_lane_pfx[_rl].route = tr2->pfx.route; }
                for (c2 = 0; c2 < NUM_CLIPS; c2++)
                    clip_init(&tr2->clips[c2]);
                /* CC automation isn't part of clip_t — reset it explicitly so
                 * points don't accumulate (loader appends) and rest_val
                 * defaults back to "—" across set switches. */
                for (c2 = 0; c2 < NUM_CLIPS; c2++)
                    cc_auto_reset(&tr2->clip_cc_auto[c2]);
                for (c2 = 0; c2 < NUM_CLIPS; c2++)
                    at_auto_reset(&tr2->clip_at_auto[c2]);
                memset(tr2->cc_type, 0, 8);
                memset(tr2->cc_auto_last_sent, 0xFF, 8);
                memset(tr2->cc_auto_cur_val, 0xFF, 8);
                memset(tr2->at_last_sent, 0xFF, AT_MAX_LANES);
                drum_clips_free(tr2);
                drum_track_init(tr2, t2);
                { int _rl; for (_rl = 0; _rl < DRUM_LANES; _rl++) tr2->drum_lane_pfx[_rl].route = tr2->pfx.route; }
                drum_repeat_init_defaults(tr2);
                /* TRACK ARP (TARP) per-track state — wasn't reset, so latched
                 * TARP, held chord, and style/rate would carry across Clear
                 * Session. tarp_init_defaults zeroes tarp_on, tarp_latch,
                 * tarp_sync, style, retrigger, and clears the held buffer +
                 * runtime via arp_clear_runtime. tarp_physical is a runtime
                 * flag not touched by tarp_init_defaults; clear explicitly. */
                tarp_init_defaults(tr2);
                tr2->tarp_physical = 0;
                memcpy(tr2->cc_assign, CC_ASSIGN_DEFAULT, 8);
                tr2->track_vel_override = 0;
                tr2->drum_inp_quant     = 0;
                tr2->drum_repeat_sync   = 1;
            }
        }
        inst->pad_key         = 9;
        inst->pad_scale       = 1;
        inst->launch_quant    = 0;
        inst->scale_aware     = 0;
        inst->inp_quant       = 0;
        inst->midi_in_channel = 0;
        inst->metro_on        = 1;
        inst->metro_vol       = 80;
        inst->swing_amt       = 0;
        inst->swing_res       = 0;
        memset(inst->mute, 0, NUM_TRACKS);
        memset(inst->solo, 0, NUM_TRACKS);
        inst->conductor_track = -1;
        inst->conductor_sounding = 0;
        inst->conductor_off_deg  = 0;
        inst->conductor_off_semi = 0;
        inst->conductor_held     = 0;
        { int _sn;
          for (_sn = 0; _sn < 16; _sn++) {
              inst->snap_valid[_sn] = 0;
              memset(inst->snap_mute[_sn], 0, NUM_TRACKS);
              memset(inst->snap_solo[_sn], 0, NUM_TRACKS);
              memset(inst->snap_drum_eff_mute[_sn], 0, NUM_TRACKS * sizeof(uint32_t));
          }
        }
        seq8_load_state(inst);
        return;
    }

    /* --- Scene launch (global): all tracks to clip M --- */
    /* Global MIDI Looper: arm with capture length in master 96-PPQN ticks.
     * Behavior depends on current state:
     *   IDLE / ARMED / CAPTURING — drop in-flight state and re-arm fresh.
     *   LOOPING — queue the new rate; transition fires at the next loop
     *     boundary (in looper_tick) so the switch lands cleanly on the beat.
     *   LOOPING with rate already equal to current — clear any pending queue
     *     (this is the path used to "cancel" a queued switch when the user
     *     releases a newer step button while still holding an older one). */
    if (!strcmp(key, "looper_arm")) {
        int t = clamp_i(my_atoi(val), 1, 65535);
        if (inst->looper_state == LOOPER_STATE_LOOPING) {
            if ((uint16_t)t == inst->looper_capture_ticks)
                inst->looper_pending_rate_ticks = 0;
            else
                inst->looper_pending_rate_ticks = (uint16_t)t;
            return;
        }
        looper_stop(inst);
        inst->looper_capture_ticks = (uint16_t)t;
        inst->looper_state = inst->looper_sync
                             ? LOOPER_STATE_ARMED
                             : LOOPER_STATE_CAPTURING;
        inst->looper_pos           = 0;
        inst->looper_event_count   = 0;
        inst->looper_play_idx      = 0;
        return;
    }
    if (!strcmp(key, "looper_stop")) {
        looper_stop(inst);
        return;
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
        return;
    }
    if (!strcmp(key, "looper_sync")) {
        inst->looper_sync = my_atoi(val) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "merge_arm")) {
        /* Multi-track arm: capture all 8 tracks at once. Destination scene
         * row is chosen post-stop via merge_place_row. TPS is global at
         * TICKS_PER_STEP so all tracks share a coherent timeline. */
        int t;
        for (t = 0; t < NUM_TRACKS; t++) inst->merge_pending_count[t] = 0;
        inst->merge_tps = (uint32_t)TICKS_PER_STEP;
        if (inst->playing && inst->master_tick_in_step == 0) {
            inst->merge_state     = MERGE_STATE_CAPTURING;
            inst->merge_start_abs = inst->global_tick * TICKS_PER_STEP;
        } else {
            inst->merge_state = MERGE_STATE_ARMED;
        }
        return;
    }
    if (!strcmp(key, "merge_stop")) {
        if (inst->merge_state == MERGE_STATE_CAPTURING)
            inst->merge_state = MERGE_STATE_STOPPING;
        else
            merge_finalize(inst);
        return;
    }
    if (!strcmp(key, "merge_place_row")) {
        merge_place(inst, my_atoi(val));
        return;
    }
    if (!strcmp(key, "merge_cancel")) {
        /* Discard any captured pending notes without writing to clips. */
        int t;
        for (t = 0; t < NUM_TRACKS; t++) inst->merge_pending_count[t] = 0;
        inst->merge_state = MERGE_STATE_IDLE;
        return;
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
        return;
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
        return;
    }
    if (!strcmp(key, "perf_mods")) {
        inst->perf_mods_active = (uint32_t)(unsigned int)my_atoi(val);
        return;
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
        return;
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
        return;
    }

    if (!strcmp(key, "mute_all_clear")) {
        int t;
        for (t = 0; t < NUM_TRACKS; t++) {
            inst->mute[t] = 0;
            inst->solo[t] = 0;
        }
        return;
    }

    if (!strcmp(key, "snap_save")) {
        /* Format: "N m0..m7 s0..s7 dm0..dm7" — dm values are uint32 drum eff-mute bitmasks */
        const char *p = val;
        int n = 0, t, v;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') n = n * 10 + (*p++ - '0');
        if (n < 0 || n >= 16) return;
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
        return;
    }

    if (!strcmp(key, "snap_load")) {
        int n = my_atoi(val), t;
        if (n < 0 || n >= 16 || !inst->snap_valid[n]) return;
        for (t = 0; t < NUM_TRACKS; t++) {
            inst->mute[t] = inst->snap_mute[n][t];
            inst->solo[t] = inst->snap_solo[n][t];
            inst->tracks[t].drum_lane_mute = inst->snap_drum_eff_mute[n][t];
            inst->tracks[t].drum_lane_solo = 0;
        }
        silence_muted_tracks(inst);
        return;
    }

    if (!strcmp(key, "snap_delete")) {
        int n = my_atoi(val);
        if (n < 0 || n >= 16) return;
        inst->snap_valid[n] = 0;
        inst->state_dirty = 1;
        return;
    }

    if (!strcmp(key, "clip_copy")) {
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            clip_t *src = &inst->tracks[srcT].clips[srcC];
            clip_t *dst = &inst->tracks[dstT].clips[dstC];
            if (srcT == dstT && srcC == dstC) return;
            undo_begin_single(inst, dstT, dstC);
            dst->length        = src->length;
            dst->loop_start    = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->playback_dir   = src->playback_dir;
            dst->playback_audio_reverse = src->playback_audio_reverse;
            dst->pp_dir_state   = initial_pp_dir(dst->playback_dir);
            dst->pfx_params    = src->pfx_params;
            memcpy(dst->steps,           src->steps,           SEQ_STEPS);
            memcpy(dst->step_notes,      src->step_notes,      SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->step_vel,        src->step_vel,        SEQ_STEPS);
            memcpy(dst->step_gate,       src->step_gate,       SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            inst->tracks[dstT].clip_cc_auto[dstC] = inst->tracks[srcT].clip_cc_auto[srcC];
            inst->tracks[dstT].clip_at_auto[dstC] = inst->tracks[srcT].clip_at_auto[srcC];
            if ((int)inst->tracks[dstT].active_clip == dstC)
                pfx_sync_from_clip(&inst->tracks[dstT]);
        }
        return;
    }

    if (!strcmp(key, "row_copy")) {
        const char *p = val;
        int srcRow = 0, dstRow = 0, t;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') srcRow = srcRow*10 + (*p++ - '0');
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') dstRow = dstRow*10 + (*p++ - '0');
        srcRow = clamp_i(srcRow, 0, NUM_CLIPS-1);
        dstRow = clamp_i(dstRow, 0, NUM_CLIPS-1);
        if (srcRow == dstRow) return;
        undo_begin_row(inst, dstRow);
        for (t = 0; t < NUM_TRACKS; t++) {
            clip_t *src = &inst->tracks[t].clips[srcRow];
            clip_t *dst = &inst->tracks[t].clips[dstRow];
            dst->length         = src->length;
            dst->loop_start     = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->playback_dir   = src->playback_dir;
            dst->playback_audio_reverse = src->playback_audio_reverse;
            dst->pp_dir_state   = initial_pp_dir(dst->playback_dir);
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,           src->steps,           SEQ_STEPS);
            memcpy(dst->step_notes,      src->step_notes,      SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->step_vel,        src->step_vel,        SEQ_STEPS);
            memcpy(dst->step_gate,       src->step_gate,       SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            inst->tracks[t].clip_cc_auto[dstRow] = inst->tracks[t].clip_cc_auto[srcRow];
            inst->tracks[t].clip_at_auto[dstRow] = inst->tracks[t].clip_at_auto[srcRow];
            if ((int)inst->tracks[t].active_clip == dstRow)
                pfx_sync_from_clip(&inst->tracks[t]);
        }
        /* Copy drum clips for all tracks */
        for (t = 0; t < NUM_TRACKS; t++) {
            drum_clip_t *dsrc = inst->tracks[t].drum_clips[srcRow];
            drum_clip_t *ddst = inst->tracks[t].drum_clips[dstRow];
            int l;
            if (!dsrc) { /* nothing to copy; free dst if allocated */
                if (ddst) { free(ddst); inst->tracks[t].drum_clips[dstRow] = NULL; }
                continue;
            }
            if (!ddst) { /* allocate dst */
                ddst = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!ddst) continue;
                inst->tracks[t].drum_clips[dstRow] = ddst;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_init(&ddst->lanes[l].clip);
                    drum_pfx_params_init(&ddst->lanes[l].pfx_params);
                    ddst->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
                }
            }
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = ddst->lanes[l].midi_note;
                clip_t *sc = &dsrc->lanes[l].clip;
                clip_t *dc = &ddst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length         = sc->length;
                dc->loop_start     = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->playback_dir   = sc->playback_dir;
                dc->playback_audio_reverse = sc->playback_audio_reverse;
                dc->pp_dir_state   = initial_pp_dir(dc->playback_dir);
                dc->active         = sc->active;
                ddst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
            }
        }
        inst->state_dirty = 1;
        return;
    }

    if (!strcmp(key, "clip_cut")) {
        /* clip_cut "srcT srcC dstT dstC" — copy src→dst then hard-reset src; atomic undo */
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            if (srcT == dstT && srcC == dstC) return;
            seq8_track_t *srcTr = &inst->tracks[srcT];
            seq8_track_t *dstTr = &inst->tracks[dstT];
            clip_t *src = &srcTr->clips[srcC];
            clip_t *dst = &dstTr->clips[dstC];
            undo_begin_clip_pair(inst, srcT, srcC, dstT, dstC);
            dst->length         = src->length;
            dst->loop_start     = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->playback_dir   = src->playback_dir;
            dst->playback_audio_reverse = src->playback_audio_reverse;
            dst->pp_dir_state   = initial_pp_dir(dst->playback_dir);
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,            src->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            dstTr->clip_cc_auto[dstC] = srcTr->clip_cc_auto[srcC];
            dstTr->clip_at_auto[dstC] = srcTr->clip_at_auto[srcC];
            if ((int)dstTr->active_clip == dstC) pfx_sync_from_clip(dstTr);
            silence_track_notes_v2(inst, srcTr);
            clip_init(src);
            cc_auto_reset(&srcTr->clip_cc_auto[srcC]);
            at_auto_reset(&srcTr->clip_at_auto[srcC]);
            if ((int)srcTr->active_clip == srcC) pfx_sync_from_clip(srcTr);
            srcTr->rec_pending_count = 0;
            srcTr->recording = 0;
            if (srcTr->queued_clip == srcC) srcTr->queued_clip = -1;
            inst->state_dirty = 1;
        }
        return;
    }

    if (!strcmp(key, "row_cut")) {
        /* row_cut "srcRow dstRow" — copy all tracks src→dst then hard-reset src; atomic undo */
        const char *p = val;
        int srcRow = 0, dstRow = 0, t;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') srcRow = srcRow*10 + (*p++ - '0');
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') dstRow = dstRow*10 + (*p++ - '0');
        srcRow = clamp_i(srcRow, 0, NUM_CLIPS-1);
        dstRow = clamp_i(dstRow, 0, NUM_CLIPS-1);
        if (srcRow == dstRow) return;
        undo_begin_row_pair(inst, srcRow, dstRow);
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *src = &tr->clips[srcRow];
            clip_t *dst = &tr->clips[dstRow];
            dst->length         = src->length;
            dst->loop_start     = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,            src->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            tr->clip_cc_auto[dstRow] = tr->clip_cc_auto[srcRow];
            tr->clip_at_auto[dstRow] = tr->clip_at_auto[srcRow];
            if ((int)tr->active_clip == dstRow) pfx_sync_from_clip(tr);
            silence_track_notes_v2(inst, tr);
            clip_init(src);
            cc_auto_reset(&tr->clip_cc_auto[srcRow]);
            at_auto_reset(&tr->clip_at_auto[srcRow]);
            if ((int)tr->active_clip == srcRow) pfx_sync_from_clip(tr);
            tr->rec_pending_count = 0;
            tr->recording = 0;
            if (tr->queued_clip == srcRow) tr->queued_clip = -1;
        }
        /* Copy drum clips src→dst then clear src for all tracks */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            drum_clip_t *dsrc = tr->drum_clips[srcRow];
            drum_clip_t *ddst = tr->drum_clips[dstRow];
            int l;
            if (!dsrc && !ddst) continue;
            if (!dsrc) {
                /* Nothing to copy; re-init dst lanes (still drum mode) */
                for (l = 0; l < DRUM_LANES; l++) {
                    pfx_note_off_imm(inst, tr, ddst->lanes[l].midi_note);
                    clip_init(&ddst->lanes[l].clip);
                }
                continue;
            }
            if (!ddst) {
                ddst = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!ddst) continue;
                tr->drum_clips[dstRow] = ddst;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_init(&ddst->lanes[l].clip);
                    drum_pfx_params_init(&ddst->lanes[l].pfx_params);
                    ddst->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
                }
            }
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = ddst->lanes[l].midi_note;
                uint8_t src_midi_note = dsrc->lanes[l].midi_note;
                clip_t *sc = &dsrc->lanes[l].clip;
                clip_t *dc = &ddst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length         = sc->length;
                dc->loop_start     = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->active         = sc->active;
                ddst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
                pfx_note_off_imm(inst, tr, src_midi_note);
                clip_init(sc);
                dsrc->lanes[l].midi_note = src_midi_note;
            }
        }
        inst->state_dirty = 1;
        return;
    }

    if (!strcmp(key, "drum_clip_copy")) {
        /* drum_clip_copy "srcT srcC dstT dstC" — copy all 32 lanes; preserve dst midi_notes */
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            if (srcT == dstT && srcC == dstC) return;
            drum_clip_t *src = inst->tracks[srcT].drum_clips[srcC];
            drum_clip_t *dst = inst->tracks[dstT].drum_clips[dstC];
            if (!src || !dst) return;
            int l;
            undo_begin_drum_clip(inst, dstT, dstC);
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = dst->lanes[l].midi_note;
                clip_t *sc = &src->lanes[l].clip;
                clip_t *dc = &dst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length        = sc->length;
                dc->loop_start    = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->playback_dir  = sc->playback_dir;
                dc->playback_audio_reverse = sc->playback_audio_reverse;
                dc->pp_dir_state  = initial_pp_dir(dc->playback_dir);
                dc->active        = sc->active;
                dst->lanes[l].pfx_params = src->lanes[l].pfx_params;
                dst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
            }
            if (dstC == (int)inst->tracks[dstT].active_clip)
                pfx_sync_from_clip(&inst->tracks[dstT]);
            inst->state_dirty = 1;
        }
        return;
    }

    if (!strcmp(key, "drum_clip_cut")) {
        /* drum_clip_cut "srcT srcC dstT dstC" — copy all 32 lanes then clear src; undo dst only */
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            if (srcT == dstT && srcC == dstC) return;
            seq8_track_t *srcTr = &inst->tracks[srcT];
            seq8_track_t *dstTr = &inst->tracks[dstT];
            drum_clip_t *src = srcTr->drum_clips[srcC];
            drum_clip_t *dst = dstTr->drum_clips[dstC];
            if (!src || !dst) return;
            int l;
            undo_begin_drum_clip(inst, dstT, dstC);
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = dst->lanes[l].midi_note;
                uint8_t src_midi_note = src->lanes[l].midi_note;
                clip_t *sc = &src->lanes[l].clip;
                clip_t *dc = &dst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length        = sc->length;
                dc->loop_start    = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->playback_dir  = sc->playback_dir;
                dc->playback_audio_reverse = sc->playback_audio_reverse;
                dc->pp_dir_state  = initial_pp_dir(dc->playback_dir);
                dc->active        = sc->active;
                dst->lanes[l].pfx_params = src->lanes[l].pfx_params;
                dst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
                pfx_note_off_imm(inst, srcTr, src_midi_note);
                clip_init(sc);
                drum_pfx_params_init(&src->lanes[l].pfx_params);
                src->lanes[l].midi_note = src_midi_note;
            }
            if (dstC == (int)dstTr->active_clip)
                pfx_sync_from_clip(dstTr);
            if (srcC == (int)srcTr->active_clip)
                pfx_sync_from_clip(srcTr);
            inst->state_dirty = 1;
        }
        return;
    }

    if (!strcmp(key, "row_clear")) {
        int rowIdx = clamp_i(my_atoi(val), 0, NUM_CLIPS-1);
        int t, i;
        undo_begin_row(inst, rowIdx);
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *cl = &tr->clips[rowIdx];
            for (i = 0; i < SEQ_STEPS; i++) {
                cl->steps[i] = 0;
                memset(cl->step_notes[i], 0, 8);
                cl->step_note_count[i] = 0;
                cl->step_vel[i]  = (uint8_t)SEQ_VEL;
                cl->step_gate[i] = (uint16_t)GATE_TICKS;
                memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
            }
            cl->active          = 0;
            cl->stretch_exp     = 0;
            cl->clock_shift_pos = 0;
            cl->nudge_pos       = 0;
            cl->ticks_per_step  = TICKS_PER_STEP;
            cl->loop_start      = 0;
            clip_pfx_params_init(&cl->pfx_params);
            cl->note_count = 0;
            memset(cl->notes, 0, sizeof(cl->notes));
            cl->occ_dirty  = 1;
            if ((int)tr->active_clip == rowIdx) {
                silence_track_notes_v2(inst, tr);
                pfx_sync_from_clip(tr);
                tr->clip_playing      = 0;
                tr->will_relaunch     = 0;
                tr->queued_clip       = -1;
                tr->pending_page_stop = 0;
                tr->record_armed      = 0;
                tr->recording         = 0;
            } else if (tr->queued_clip == rowIdx) {
                tr->queued_clip = -1;
            }
        }
        /* Clear drum clips at rowIdx for all tracks */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            drum_clip_t *dc = tr->drum_clips[rowIdx];
            int l;
            if (!dc) continue;
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t midi_note = dc->lanes[l].midi_note;
                pfx_note_off_imm(inst, tr, midi_note);
                clip_init(&dc->lanes[l].clip);
                dc->lanes[l].midi_note = midi_note;
            }
        }
        inst->state_dirty = 1;
        return;
    }

    if (!strcmp(key, "undo_restore")) {
        int i;
        if (inst->drum_undo_valid) {
            /* Drum recording undo */
            int t = (int)inst->drum_undo_track, c = (int)inst->drum_undo_clip;
            drum_clip_t *dc = inst->tracks[t].drum_clips[c];
            if (!dc) {
                dc = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!dc) return;
                inst->tracks[t].drum_clips[c] = dc;
                int _li;
                for (_li = 0; _li < DRUM_LANES; _li++) {
                    clip_init(&dc->lanes[_li].clip);
                    drum_pfx_params_init(&dc->lanes[_li].pfx_params);
                    dc->lanes[_li].midi_note = (uint8_t)(DRUM_BASE_NOTE + _li);
                }
            }
            /* Capture redo */
            for (i = 0; i < DRUM_LANES; i++) {
                const drum_lane_t *lane = &dc->lanes[i];
                const clip_t *src = &lane->clip;
                drum_rec_snap_lane_t *dst = &inst->drum_redo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length     = src->length;
                dst->loop_start = src->loop_start;
                dst->active     = src->active;
                dst->playback_dir = src->playback_dir;
                dst->playback_audio_reverse = src->playback_audio_reverse;
                dst->pfx_params = lane->pfx_params;
            }
            inst->drum_redo_track = (uint8_t)t;
            inst->drum_redo_clip  = (uint8_t)c;
            inst->drum_redo_valid = 1;
            /* Restore */
            for (i = 0; i < DRUM_LANES; i++) {
                drum_lane_t *lane = &dc->lanes[i];
                clip_t *dst = &lane->clip;
                const drum_rec_snap_lane_t *src = &inst->drum_undo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length        = src->length;
                dst->loop_start    = src->loop_start;
                dst->active        = src->active;
                dst->playback_dir  = src->playback_dir;
                dst->playback_audio_reverse = src->playback_audio_reverse;
                dst->pp_dir_state  = initial_pp_dir(dst->playback_dir);
                lane->pfx_params   = src->pfx_params;
                clip_migrate_to_notes(dst);
            }
            if ((int)inst->tracks[t].active_clip == c)
                pfx_sync_from_clip(&inst->tracks[t]);
            inst->drum_undo_valid = 0;
            snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "d %d %d", t, c);
            return;
        }
        if (!inst->undo_valid) return;
        inst->redo_clip_count = inst->undo_clip_count;
        memcpy(inst->redo_clip_tracks,  inst->undo_clip_tracks,  inst->undo_clip_count);
        memcpy(inst->redo_clip_indices, inst->undo_clip_indices, inst->undo_clip_count);
        for (i = 0; i < (int)inst->undo_clip_count; i++) {
            int t = (int)inst->undo_clip_tracks[i], c = (int)inst->undo_clip_indices[i];
            memcpy(&inst->redo_clips[i], &inst->tracks[t].clips[c], sizeof(clip_t));
            memcpy(&inst->redo_auto_cc[i], &inst->tracks[t].clip_cc_auto[c], sizeof(cc_auto_t));
            memcpy(&inst->redo_auto_at[i], &inst->tracks[t].clip_at_auto[c], sizeof(at_auto_t));
        }
        inst->redo_valid = 1;
        apply_clip_restore(inst, inst->undo_clips,
                           inst->undo_clip_tracks, inst->undo_clip_indices,
                           inst->undo_clip_count);
        for (i = 0; i < (int)inst->undo_clip_count; i++) {
            int t = (int)inst->undo_clip_tracks[i], c = (int)inst->undo_clip_indices[i];
            memcpy(&inst->tracks[t].clip_cc_auto[c], &inst->undo_auto_cc[i], sizeof(cc_auto_t));
            memcpy(&inst->tracks[t].clip_at_auto[c], &inst->undo_auto_at[i], sizeof(at_auto_t));
            if ((int)inst->tracks[t].active_clip == c) {
                memset(inst->tracks[t].cc_auto_last_sent, 0xFF, 8);
                memset(inst->tracks[t].at_last_sent, 0xFF, AT_MAX_LANES);
            }
        }
        inst->undo_valid = 0;
        /* Also restore drum rows if snapshotted alongside melodic row undo */
        if (inst->drum_row_undo_valid) {
            int _s;
            /* Capture redo */
            for (_s = 0; _s < (int)inst->drum_row_undo_valid; _s++)
                drum_row_snap(inst, (int)inst->drum_row_undo_clips[_s], inst->drum_row_redo_lanes[_s]);
            memcpy(inst->drum_row_redo_clips, inst->drum_row_undo_clips, inst->drum_row_undo_valid);
            inst->drum_row_redo_valid = inst->drum_row_undo_valid;
            /* Restore */
            for (_s = 0; _s < (int)inst->drum_row_undo_valid; _s++)
                drum_row_restore(inst, (int)inst->drum_row_undo_clips[_s], inst->drum_row_undo_lanes[_s]);
            inst->drum_row_undo_valid = 0;
        }
        {
            int _i, _off = snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "m");
            for (_i = 0; _i < (int)inst->redo_clip_count; _i++)
                _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                 " %d %d", (int)inst->redo_clip_tracks[_i], (int)inst->redo_clip_indices[_i]);
            if (inst->drum_row_redo_valid) {
                int _s;
                for (_s = 0; _s < (int)inst->drum_row_redo_valid; _s++)
                    _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                     " DR %d", (int)inst->drum_row_redo_clips[_s]);
            }
        }
        return;
    }

    if (!strcmp(key, "redo_restore")) {
        int i;
        if (inst->drum_redo_valid) {
            /* Drum recording redo */
            int t = (int)inst->drum_redo_track, c = (int)inst->drum_redo_clip;
            drum_clip_t *dc = inst->tracks[t].drum_clips[c];
            if (!dc) {
                dc = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!dc) return;
                inst->tracks[t].drum_clips[c] = dc;
                int _li;
                for (_li = 0; _li < DRUM_LANES; _li++) {
                    clip_init(&dc->lanes[_li].clip);
                    drum_pfx_params_init(&dc->lanes[_li].pfx_params);
                    dc->lanes[_li].midi_note = (uint8_t)(DRUM_BASE_NOTE + _li);
                }
            }
            /* Capture new undo */
            for (i = 0; i < DRUM_LANES; i++) {
                const drum_lane_t *lane = &dc->lanes[i];
                const clip_t *src = &lane->clip;
                drum_rec_snap_lane_t *dst = &inst->drum_undo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length     = src->length;
                dst->loop_start = src->loop_start;
                dst->active     = src->active;
                dst->playback_dir = src->playback_dir;
                dst->playback_audio_reverse = src->playback_audio_reverse;
                dst->pfx_params = lane->pfx_params;
            }
            inst->drum_undo_track = (uint8_t)t;
            inst->drum_undo_clip  = (uint8_t)c;
            inst->drum_undo_valid = 1;
            /* Restore redo */
            for (i = 0; i < DRUM_LANES; i++) {
                drum_lane_t *lane = &dc->lanes[i];
                clip_t *dst = &lane->clip;
                const drum_rec_snap_lane_t *src = &inst->drum_redo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length       = src->length;
                dst->loop_start   = src->loop_start;
                dst->active       = src->active;
                lane->pfx_params  = src->pfx_params;
                clip_migrate_to_notes(dst);
            }
            if ((int)inst->tracks[t].active_clip == c)
                pfx_sync_from_clip(&inst->tracks[t]);
            inst->drum_redo_valid = 0;
            snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "d %d %d", t, c);
            return;
        }
        if (!inst->redo_valid) return;
        inst->undo_clip_count = inst->redo_clip_count;
        memcpy(inst->undo_clip_tracks,  inst->redo_clip_tracks,  inst->redo_clip_count);
        memcpy(inst->undo_clip_indices, inst->redo_clip_indices, inst->redo_clip_count);
        for (i = 0; i < (int)inst->redo_clip_count; i++) {
            int t = (int)inst->redo_clip_tracks[i], c = (int)inst->redo_clip_indices[i];
            memcpy(&inst->undo_clips[i], &inst->tracks[t].clips[c], sizeof(clip_t));
            memcpy(&inst->undo_auto_cc[i], &inst->tracks[t].clip_cc_auto[c], sizeof(cc_auto_t));
            memcpy(&inst->undo_auto_at[i], &inst->tracks[t].clip_at_auto[c], sizeof(at_auto_t));
        }
        inst->undo_valid = 1;
        apply_clip_restore(inst, inst->redo_clips,
                           inst->redo_clip_tracks, inst->redo_clip_indices,
                           inst->redo_clip_count);
        for (i = 0; i < (int)inst->redo_clip_count; i++) {
            int t = (int)inst->redo_clip_tracks[i], c = (int)inst->redo_clip_indices[i];
            memcpy(&inst->tracks[t].clip_cc_auto[c], &inst->redo_auto_cc[i], sizeof(cc_auto_t));
            memcpy(&inst->tracks[t].clip_at_auto[c], &inst->redo_auto_at[i], sizeof(at_auto_t));
            if ((int)inst->tracks[t].active_clip == c) {
                memset(inst->tracks[t].cc_auto_last_sent, 0xFF, 8);
                memset(inst->tracks[t].at_last_sent, 0xFF, AT_MAX_LANES);
            }
        }
        inst->redo_valid = 0;
        /* Also restore drum rows if snapshotted alongside melodic row redo */
        if (inst->drum_row_redo_valid) {
            int _s;
            /* Capture new undo */
            for (_s = 0; _s < (int)inst->drum_row_redo_valid; _s++)
                drum_row_snap(inst, (int)inst->drum_row_redo_clips[_s], inst->drum_row_undo_lanes[_s]);
            memcpy(inst->drum_row_undo_clips, inst->drum_row_redo_clips, inst->drum_row_redo_valid);
            inst->drum_row_undo_valid = inst->drum_row_redo_valid;
            /* Restore */
            for (_s = 0; _s < (int)inst->drum_row_redo_valid; _s++)
                drum_row_restore(inst, (int)inst->drum_row_redo_clips[_s], inst->drum_row_redo_lanes[_s]);
            inst->drum_row_redo_valid = 0;
        }
        {
            int _i, _off = snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "m");
            for (_i = 0; _i < (int)inst->undo_clip_count; _i++)
                _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                 " %d %d", (int)inst->undo_clip_tracks[_i], (int)inst->undo_clip_indices[_i]);
            if (inst->drum_row_undo_valid) {
                int _s;
                for (_s = 0; _s < (int)inst->drum_row_undo_valid; _s++)
                    _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                     " DR %d", (int)inst->drum_row_undo_clips[_s]);
            }
        }
        return;
    }

    /* --- Track-prefixed params: tN_<subkey> --- */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

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
            return;
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
            return;
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
            return;
        }

        /* tN_stop_at_end: arm track to stop at next 16-step page boundary */
        if (!strcmp(sub, "stop_at_end")) {
            tr->pending_page_stop = 1;
            return;
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
            return;
        }

        /* tN_mute: set mute state; setting mute clears solo on same track */
        if (!strcmp(sub, "mute")) {
            inst->mute[tidx] = (val[0] == '1') ? 1 : 0;
            if (inst->mute[tidx]) inst->solo[tidx] = 0;
            silence_muted_tracks(inst);
            return;
        }

        /* tN_solo: set solo state; setting solo clears mute on same track.
         * The Conductor track can never be soloed — solo is inert on it (it
         * emits no MIDI; soloing it would also wrongly silence every other
         * track). Mute stays functional. */
        if (!strcmp(sub, "solo")) {
            if (tr->pad_mode == PAD_MODE_CONDUCT) return;
            inst->solo[tidx] = (val[0] == '1') ? 1 : 0;
            if (inst->solo[tidx]) inst->mute[tidx] = 0;
            silence_muted_tracks(inst);
            return;
        }

        /* tN_channel: set MIDI channel for this track (1-indexed in, 0-indexed stored) */
        if (!strcmp(sub, "channel")) {
            tr->channel = (uint8_t)clamp_i(my_atoi(val) - 1, 0, 15);
            return;
        }

        /* tN_route: set MIDI routing for this track */
        if (!strcmp(sub, "route")) {
            uint8_t rt;
            if (!strcmp(val, "schwung"))      rt = ROUTE_SCHWUNG;
            else if (!strcmp(val, "move"))    rt = ROUTE_MOVE;
            else if (!strcmp(val, "external")) rt = ROUTE_EXTERNAL;
            else return;
            tr->pfx.route = rt;
            { int _rl; for (_rl = 0; _rl < DRUM_LANES; _rl++) tr->drum_lane_pfx[_rl].route = rt; }
            return;
        }

        /* tN_track_looper: include/exclude this track from the global MIDI looper */
        if (!strcmp(sub, "track_looper")) {
            uint8_t lo = (uint8_t)(my_atoi(val) ? 1 : 0);
            tr->pfx.looper_on = lo;
            { int _ll; for (_ll = 0; _ll < DRUM_LANES; _ll++) tr->drum_lane_pfx[_ll].looper_on = lo; }
            inst->state_dirty = 1;
            return;
        }

        /* tN_cM_step_S or tN_cM_length: clip data */
        if (sub[0] == 'c' && sub[1] >= '0' && sub[1] <= '9') {
            int cidx = 0;
            const char *p = sub + 1;
            while (*p >= '0' && *p <= '9') { cidx = cidx * 10 + (*p - '0'); p++; }
            if (cidx >= NUM_CLIPS) return;
            clip_t *cl = &tr->clips[cidx];

            if (!strncmp(p, "_step_", 6)) {
                const char *q = p + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return;

                if (!strcmp(q, "_toggle")) {
                    /* tN_cC_step_S_toggle val="note [velocity [0..127]]"
                     * If note present: remove it. If absent and room: add it.
                     * Activates/deactivates step as count crosses 0.
                     * On first note added to empty step: sets step_vel from optional field. */
                    const char *tp = val;
                    int note = clamp_i(my_atoi(tp), 0, 127);
                    while (*tp && *tp != ' ') tp++;
                    int tvel = (*tp == ' ') ? clamp_i(my_atoi(tp + 1), 0, 127) : SEQ_VEL;
                    int has_tvel = (*tp == ' ');
                    int n, found = -1;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++) {
                        if (cl->step_notes[sidx][n] == (uint8_t)note) { found = n; break; }
                    }
                    if (found >= 0) {
                        /* remove: shift remaining notes and offsets down */
                        for (n = found; n < (int)cl->step_note_count[sidx] - 1; n++) {
                            cl->step_notes[sidx][n] = cl->step_notes[sidx][n + 1];
                            cl->note_tick_offset[sidx][n] = cl->note_tick_offset[sidx][n + 1];
                        }
                        cl->step_notes[sidx][cl->step_note_count[sidx] - 1] = 0;
                        cl->note_tick_offset[sidx][cl->step_note_count[sidx] - 1] = 0;
                        cl->step_note_count[sidx]--;
                        if (cl->step_note_count[sidx] == 0)
                            cl->steps[sidx] = 0;
                    } else if (cl->step_note_count[sidx] < 8) {
                        int was_empty = (cl->step_note_count[sidx] == 0);
                        int ni2 = (int)cl->step_note_count[sidx];
                        cl->step_notes[sidx][ni2] = (uint8_t)note;
                        cl->note_tick_offset[sidx][ni2] = 0;
                        cl->step_note_count[sidx]++;
                        if (cl->step_note_count[sidx] == 1)
                            cl->steps[sidx] = 1;
                        if (was_empty && has_tvel)
                            cl->step_vel[sidx] = (uint8_t)tvel;
                    }
                    /* else: 8-note limit reached — silent no-op */
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    return;
                }

                if (!strcmp(q, "_add")) {
                    /* tN_cC_step_S_add val="p1 o1 v1 [p2 o2 v2 ...]"
                     * One or more space-separated note triplets (pitch offset velocity).
                     * Add-only per note; vel on first note of empty step sets step_vel. */
                    const char *p = val;
                    int any_added = 0;
                    while (*p) {
                        while (*p == ' ') p++;
                        if (!*p) break;
                        int note = clamp_i(my_atoi(p), 0, 127);
                        while (*p && *p != ' ') p++;
                        int offset_val = 0, vel_val = SEQ_VEL, has_vel = 0;
                        if (*p == ' ') {
                            p++;
                            offset_val = clamp_i(my_atoi(p), -(cl->ticks_per_step-1), (cl->ticks_per_step-1));
                            while (*p && *p != ' ') p++;
                            if (*p == ' ') {
                                p++;
                                vel_val = clamp_i(my_atoi(p), 0, 127);
                                has_vel = 1;
                                while (*p && *p != ' ') p++;
                            }
                        }
                        int n, found = 0;
                        for (n = 0; n < (int)cl->step_note_count[sidx]; n++) {
                            if (cl->step_notes[sidx][n] == (uint8_t)note) { found = 1; break; }
                        }
                        if (!found && cl->step_note_count[sidx] < 8) {
                            int ni2 = (int)cl->step_note_count[sidx];
                            int was_empty = (ni2 == 0);
                            cl->step_notes[sidx][ni2] = (uint8_t)note;
                            cl->note_tick_offset[sidx][ni2] = (int16_t)offset_val;
                            cl->step_note_count[sidx]++;
                            if (cl->step_note_count[sidx] == 1) cl->steps[sidx] = 1;
                            if (was_empty && has_vel) cl->step_vel[sidx] = (uint8_t)vel_val;
                            any_added = 1;
                        }
                    }
                    if (any_added) {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                        if (tr->recording) LRS_SET(tr, sidx);
                        clip_migrate_to_notes(cl);
                    }
                    return;
                }

                if (!strcmp(q, "_clear")) {
                    /* tN_cC_step_S_clear — atomically deactivate step and wipe all step data */
                    undo_begin_single(inst, tidx, cidx);
                    cl->steps[sidx] = 0;
                    memset(cl->step_notes[sidx], 0, 8);
                    cl->step_note_count[sidx] = 0;
                    cl->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                    cl->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                    memset(cl->note_tick_offset[sidx], 0, 8 * sizeof(int16_t));
                    cl->step_iter[sidx]       = 0;
                    cl->step_random[sidx]     = 0;
                    cl->step_ratchet[sidx]    = 0;
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    return;
                }
                if (!strcmp(q, "_vel")) {
                    if (cl->step_note_count[sidx] == 0) return;
                    cl->step_vel[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_gate")) {
                    if (cl->step_note_count[sidx] == 0) return;
                    { int gmax = SEQ_STEPS * cl->ticks_per_step; if (gmax > 65535) gmax = 65535;
                    cl->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, gmax); }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_nudge")) {
                    if (cl->step_note_count[sidx] == 0) return;
                    { int tps_m1 = cl->ticks_per_step - 1;
                    int new_val = clamp_i(my_atoi(val), -tps_m1, tps_m1);
                    int delta = new_val - (int)cl->note_tick_offset[sidx][0];
                    int ni;
                    for (ni = 0; ni < (int)cl->step_note_count[sidx]; ni++) {
                        int o = (int)cl->note_tick_offset[sidx][ni] + delta;
                        cl->note_tick_offset[sidx][ni] = (int16_t)clamp_i(o, -tps_m1, tps_m1);
                    } }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_iter")) {
                    /* val: 0 = default, else (cycle_len<<4) | cycle_idx */
                    int raw = clamp_i(my_atoi(val), 0, 255);
                    if (raw != 0) {
                        int len = (raw >> 4) & 0xF, idx = raw & 0xF;
                        if (len < 1 || len > 8 || idx < 1 || idx > len) raw = 0;
                    }
                    cl->step_iter[sidx] = (uint8_t)raw;
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_rand")) {
                    cl->step_random[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 100);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_ratch")) {
                    cl->step_ratchet[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 4);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_reassign")) {
                    /* Move notes from step sidx to dstStep, adjusting offsets.
                     * If dstStep is empty: simple move. If occupied: merge; dst notes
                     * take precedence (duplicate pitches from src are dropped). */
                    int dstStep = clamp_i(my_atoi(val), 0, (int)cl->length - 1);
                    if (dstStep == sidx) return;
                    if (cl->step_note_count[sidx] == 0) return;
                    {
                        int tps_m1 = cl->ticks_per_step - 1;
                        int offset_adjust = ((int)sidx - dstStep) * cl->ticks_per_step;
                        int ni;
                        if (cl->step_note_count[dstStep] == 0) {
                            /* Empty dst: move everything */
                            for (ni = 0; ni < (int)cl->step_note_count[sidx]; ni++) {
                                cl->step_notes[dstStep][ni] = cl->step_notes[sidx][ni];
                                int new_off = (int)cl->note_tick_offset[sidx][ni] + offset_adjust;
                                cl->note_tick_offset[dstStep][ni] =
                                    (int16_t)clamp_i(new_off, -tps_m1, tps_m1);
                            }
                            cl->step_note_count[dstStep] = cl->step_note_count[sidx];
                            cl->step_vel[dstStep]        = cl->step_vel[sidx];
                            cl->step_gate[dstStep]       = cl->step_gate[sidx];
                            cl->step_iter[dstStep]       = cl->step_iter[sidx];
                            cl->step_random[dstStep]     = cl->step_random[sidx];
                            cl->step_ratchet[dstStep]    = cl->step_ratchet[sidx];
                            cl->steps[dstStep]           = cl->steps[sidx];
                        } else {
                            /* Occupied dst: merge; dst notes take precedence on pitch collision */
                            for (ni = 0; ni < (int)cl->step_note_count[sidx]; ni++) {
                                uint8_t pitch = cl->step_notes[sidx][ni];
                                int nj, dup = 0;
                                for (nj = 0; nj < (int)cl->step_note_count[dstStep]; nj++) {
                                    if (cl->step_notes[dstStep][nj] == pitch) { dup = 1; break; }
                                }
                                if (dup || cl->step_note_count[dstStep] >= 8) continue;
                                int slot = (int)cl->step_note_count[dstStep];
                                cl->step_notes[dstStep][slot] = pitch;
                                int new_off = (int)cl->note_tick_offset[sidx][ni] + offset_adjust;
                                cl->note_tick_offset[dstStep][slot] =
                                    (int16_t)clamp_i(new_off, -tps_m1, tps_m1);
                                cl->step_note_count[dstStep]++;
                            }
                            /* dst vel/gate unchanged; activate if src was active */
                            if (cl->steps[sidx]) cl->steps[dstStep] = 1;
                        }
                        memset(cl->step_notes[sidx], 0, 8);
                        memset(cl->note_tick_offset[sidx], 0, 8 * sizeof(int16_t));
                        cl->step_note_count[sidx] = 0;
                        cl->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                        cl->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                        cl->step_iter[sidx]       = 0;
                        cl->step_random[sidx]     = 0;
                        cl->step_ratchet[sidx]    = 0;
                        cl->steps[sidx]           = 0;
                    }
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)cl->length; k++) if (cl->steps[k]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_copy_to")) {
                    /* tN_cC_step_S_copy_to — copy all step data to dstStep (overwrite); src unchanged */
                    int dstStep = clamp_i(my_atoi(val), 0, (int)cl->length - 1);
                    if (dstStep == sidx) return;
                    if (cl->step_note_count[sidx] == 0) return;
                    undo_begin_single(inst, tidx, cidx);
                    memcpy(cl->step_notes[dstStep], cl->step_notes[sidx], 8);
                    memcpy(cl->note_tick_offset[dstStep], cl->note_tick_offset[sidx], 8 * sizeof(int16_t));
                    cl->step_note_count[dstStep] = cl->step_note_count[sidx];
                    cl->step_vel[dstStep]        = cl->step_vel[sidx];
                    cl->step_gate[dstStep]       = cl->step_gate[sidx];
                    cl->step_iter[dstStep]       = cl->step_iter[sidx];
                    cl->step_random[dstStep]     = cl->step_random[sidx];
                    cl->step_ratchet[dstStep]    = cl->step_ratchet[sidx];
                    cl->steps[dstStep]           = cl->steps[sidx];
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)cl->length; k++) if (cl->steps[k]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_pitch")) {
                    if (!cl->steps[sidx]) return;
                    int delta = my_atoi(val), n;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++)
                        cl->step_notes[sidx][n] = (uint8_t)clamp_i(
                            (int)cl->step_notes[sidx][n] + delta, 0, 127);
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_set_notes")) {
                    if (!cl->steps[sidx]) return;
                    int notes[8], cnt = 0;
                    const char *np = val;
                    while (*np && cnt < 8) {
                        while (*np == ' ') np++;
                        if (!*np) break;
                        int note = 0;
                        while (*np >= '0' && *np <= '9') note = note * 10 + (*np++ - '0');
                        notes[cnt++] = clamp_i(note, 0, 127);
                    }
                    if (cnt > 0) {
                        int i;
                        cl->step_note_count[sidx] = (uint8_t)cnt;
                        for (i = 0; i < cnt; i++) cl->step_notes[sidx][i] = (uint8_t)notes[i];
                        for (i = cnt; i < 8; i++) {
                            cl->step_notes[sidx][i] = 0;
                            cl->note_tick_offset[sidx][i] = 0;
                        }
                        clip_migrate_to_notes(cl);
                        if (!tr->recording) inst->state_dirty = 1;
                    }
                    return;
                }
                return;
            }
            if (!strncmp(p, "_length", 7) && p[7] == '\0') {
                int max_len = SEQ_STEPS - (int)cl->loop_start;
                if (max_len < 1) max_len = 1;
                cl->length = (uint16_t)clamp_i(my_atoi(val), 1, max_len);
                if (cidx == (int)tr->active_clip) {
                    uint16_t le = (uint16_t)(cl->loop_start + cl->length);
                    if (tr->current_step < cl->loop_start || tr->current_step >= le)
                        tr->current_step = cl->loop_start;
                    /* Anchor playhead to global tick during playback so phase
                     * stays consistent when length changes mid-playback (same
                     * idea as drum_lane_anchor_playhead). */
                    if (inst->playing) {
                        uint16_t mtps  = cl->ticks_per_step > 0 ? cl->ticks_per_step
                                                                 : (uint16_t)TICKS_PER_STEP;
                        uint32_t elapsed = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                           + (uint32_t)inst->master_tick_in_step;
                        uint32_t steps = elapsed / mtps;
                        tr->current_step = (uint16_t)(cl->loop_start + (steps % cl->length));
                        tr->tick_in_step = (uint16_t)(elapsed % mtps);
                    }
                }
                clip_migrate_to_notes(cl);
                return;
            }
            if (!strncmp(p, "_loop_set", 9) && p[9] == '\0') {
                /* tN_cC_loop_set "packed" — atomic loop window write.
                 * packed = loop_start * 65536 + length (both 1..256, sum <= SEQ_STEPS).
                 * Single set_param to avoid the per-buffer coalescing hazard
                 * that two separate keys would hit. */
                long packed = 0;
                const char *vp = val;
                while (*vp == ' ') vp++;
                while (*vp >= '0' && *vp <= '9') packed = packed * 10 + (*vp++ - '0');
                int ls  = (int)((packed >> 16) & 0xFFFF);
                int len = (int)(packed & 0xFFFF);
                if (len < 1) len = 1;
                if (ls  < 0) ls  = 0;
                if (ls > SEQ_STEPS - 1) ls = SEQ_STEPS - 1;
                if (ls + len > SEQ_STEPS) len = SEQ_STEPS - ls;
                cl->loop_start = (uint16_t)ls;
                cl->length     = (uint16_t)len;
                if (cidx == (int)tr->active_clip) {
                    uint16_t le = (uint16_t)(cl->loop_start + cl->length);
                    if (tr->current_step < cl->loop_start || tr->current_step >= le)
                        tr->current_step = cl->loop_start;
                    if (inst->playing) {
                        uint16_t mtps  = cl->ticks_per_step > 0 ? cl->ticks_per_step
                                                                 : (uint16_t)TICKS_PER_STEP;
                        uint32_t elapsed = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                           + (uint32_t)inst->master_tick_in_step;
                        uint32_t steps = elapsed / mtps;
                        tr->current_step = (uint16_t)(cl->loop_start + (steps % cl->length));
                        tr->tick_in_step = (uint16_t)(elapsed % mtps);
                    }
                }
                clip_migrate_to_notes(cl);
                inst->state_dirty = 1;
                return;
            }
            if (p[0] == '_' && p[1] == 'k' && p[2] >= '0' && p[2] <= '7') {
                int _kidx = p[2] - '0';
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                if (!strcmp(p + 3, "_cc_loop_set")) {
                    long packed = 0;
                    const char *vp = val;
                    while (*vp == ' ') vp++;
                    while (*vp >= '0' && *vp <= '9') packed = packed * 10 + (*vp++ - '0');
                    int ls  = (int)((packed >> 16) & 0xFFFF);
                    int len = (int)(packed & 0xFFFF);
                    if (len < 0) len = 0;
                    if (ls < 0) ls = 0;
                    if (ls > SEQ_STEPS - 1) ls = SEQ_STEPS - 1;
                    if (len > 0 && ls + len > SEQ_STEPS) len = SEQ_STEPS - ls;
                    _ca->lane_loop_start[_kidx] = (uint16_t)ls;
                    _ca->lane_length[_kidx] = (uint16_t)len;
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(p + 3, "_cc_lane_length")) {
                    int len = (int)strtol(val, NULL, 10);
                    if (len < 0) len = 0;
                    uint16_t ls = _ca->lane_loop_start[_kidx];
                    if (len > 0 && (int)ls + len > SEQ_STEPS) len = SEQ_STEPS - (int)ls;
                    _ca->lane_length[_kidx] = (uint16_t)len;
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(p + 3, "_cc_lane_tps")) {
                    int tps_val = (int)strtol(val, NULL, 10);
                    if (tps_val == 0) {
                        _ca->lane_tps[_kidx] = 0;
                    } else {
                        int vi, valid = 0;
                        for (vi = 0; vi < 6; vi++)
                            if (tps_val == (int)TPS_VALUES[vi]) { valid = 1; break; }
                        _ca->lane_tps[_kidx] = valid ? (uint16_t)tps_val : 0;
                    }
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(p + 3, "_cc_lane_res_tps")) {
                    int tps_val = (int)strtol(val, NULL, 10);
                    if (tps_val == 0) {
                        _ca->lane_res_tps[_kidx] = 0;
                    } else {
                        int vi, valid = 0;
                        for (vi = 0; vi < 6; vi++)
                            if (tps_val == (int)TPS_VALUES[vi]) { valid = 1; break; }
                        _ca->lane_res_tps[_kidx] = valid ? (uint16_t)tps_val : 0;
                    }
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(p + 3, "_cc_lane_reset")) {
                    undo_begin_single(inst, tidx, cidx);
                    _ca->lane_loop_start[_kidx] = 0;
                    _ca->lane_length[_kidx] = 0;
                    _ca->lane_tps[_kidx] = 0;
                    _ca->lane_res_tps[_kidx] = 0;
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(p + 3, "_cc_lane_double_fill")) {
                    undo_begin_single(inst, tidx, cidx);
                    uint16_t _old_len = _ca->lane_length[_kidx];
                    if (_old_len == 0) _old_len = cl->length;
                    uint16_t _ltps = _ca->lane_tps[_kidx] > 0
                                   ? _ca->lane_tps[_kidx] : cl->ticks_per_step;
                    uint32_t _half_ticks = (uint32_t)_old_len * _ltps;
                    uint16_t _new_len = (uint16_t)(_old_len * 2);
                    if (_new_len > SEQ_STEPS) return;
                    int _n = (int)_ca->count[_kidx];
                    /* Add seam point at the boundary: evaluate what the loop
                     * would produce at the last tick of the first half, so the
                     * wrap-back transition is captured as an explicit point. */
                    if (_n > 0 && _n < CC_AUTO_MAX_POINTS) {
                        uint32_t _seam_t = _half_ticks > 0 ? _half_ticks - 1 : 0;
                        int _has_seam = 0, _si;
                        for (_si = 0; _si < _n; _si++)
                            if (_ca->ticks[_kidx][_si] == (uint16_t)_seam_t) { _has_seam = 1; break; }
                        if (!_has_seam) {
                            int _def;
                            int _sv = cc_auto_eval(_ca, _kidx, _seam_t, 0, _half_ticks, &_def);
                            if (_def && _sv >= 0 && _sv <= 127) {
                                cc_auto_set_point(_ca, _kidx, (uint16_t)_seam_t, (uint8_t)_sv);
                                _n = (int)_ca->count[_kidx];
                            }
                        }
                    }
                    int _added = 0;
                    int _orig_n = _n;
                    for (int _i = 0; _i < _orig_n && _n + _added < CC_AUTO_MAX_POINTS; _i++) {
                        uint16_t _ot = _ca->ticks[_kidx][_i];
                        if (_ot >= _half_ticks) continue;
                        uint32_t _nt = (uint32_t)_ot + _half_ticks;
                        if (_nt > 65535) continue;
                        _ca->ticks[_kidx][_n + _added] = (uint16_t)_nt;
                        _ca->vals[_kidx][_n + _added]  = _ca->vals[_kidx][_i];
                        _added++;
                    }
                    _ca->count[_kidx] = (uint16_t)(_n + _added);
                    /* Sort the combined array (insertion sort — small N) */
                    { int _total = (int)_ca->count[_kidx];
                      int _j;
                      for (_j = 1; _j < _total; _j++) {
                          uint16_t _kt = _ca->ticks[_kidx][_j];
                          uint8_t  _kv = _ca->vals[_kidx][_j];
                          int _jj = _j - 1;
                          while (_jj >= 0 && _ca->ticks[_kidx][_jj] > _kt) {
                              _ca->ticks[_kidx][_jj + 1] = _ca->ticks[_kidx][_jj];
                              _ca->vals[_kidx][_jj + 1]  = _ca->vals[_kidx][_jj];
                              _jj--;
                          }
                          _ca->ticks[_kidx][_jj + 1] = _kt;
                          _ca->vals[_kidx][_jj + 1]  = _kv;
                      }
                    }
                    _ca->lane_length[_kidx] = _new_len;
                    inst->state_dirty = 1;
                    return;
                }
            }
            if (!strncmp(p, "_pfx_set", 8) && p[8] == '\0') {
                /* tN_cC_pfx_set "key value" — apply pfx param to this clip's
                 * pfx_params (any clip, not just active). Mirrors drum-lane
                 * pfx_set but targets melodic per-clip pfx_params. */
                const char *sp = val;
                char pfx_key[64]; int ki = 0;
                while (*sp && *sp != ' ' && ki < 63) pfx_key[ki++] = *sp++;
                pfx_key[ki] = '\0';
                while (*sp == ' ') sp++;
                pfx_set(inst, tr, &cl->pfx_params, pfx_key, sp);
                if ((int)tr->active_clip == cidx)
                    pfx_sync_from_clip(tr);
                inst->state_dirty = 1;
                return;
            }
            /* Conductor per-clip control banks. Payload "<trackIdx> <value>".
             * Phase 2: storage only — no transposition behavior yet. */
            if (!strcmp(p, "_cond_resp")) {
                int ti = my_atoi(val);
                const char *vp = val;
                while (*vp && *vp != ' ') vp++;
                int vv = (*vp == ' ') ? my_atoi(vp + 1) : 0;
                if (ti >= 0 && ti < NUM_TRACKS)
                    cl->cond_resp[ti] = (uint8_t)(vv ? 1 : 0);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p, "_cond_lock")) {
                cl->cond_lock = (uint8_t)(my_atoi(val) ? 1 : 0);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p, "_cond_oct")) {
                int ti = my_atoi(val);
                const char *vp = val;
                while (*vp && *vp != ' ') vp++;
                int vv = (*vp == ' ') ? my_atoi(vp + 1) : 0;
                if (ti >= 0 && ti < NUM_TRACKS)
                    cl->cond_oct[ti] = (int8_t)clamp_i(vv, -4, 4);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p, "_cond_when")) {
                int ti = my_atoi(val);
                const char *vp = val;
                while (*vp && *vp != ' ') vp++;
                int vv = (*vp == ' ') ? my_atoi(vp + 1) : 0;
                if (ti >= 0 && ti < NUM_TRACKS)
                    cl->cond_when[ti] = (uint8_t)(vv ? 1 : 0);
                inst->state_dirty = 1;
                return;
            }
            if (!strncmp(p, "_clear", 6) && p[6] == '\0') {
                /* tN_cC_clear — wipe step data in clip.
                 * Preserves: length, loop_start, ticks_per_step, stretch_exp,
                 * clock_shift_pos, nudge_pos, and pfx_params. Only step note
                 * data is wiped. Hard Reset (_hard_reset) is the gesture that
                 * wipes structure too. */
                int i;
                undo_begin_single(inst, tidx, cidx);
                for (i = 0; i < SEQ_STEPS; i++) {
                    cl->steps[i] = 0;
                    memset(cl->step_notes[i], 0, 8);
                    cl->step_note_count[i] = 0;
                    cl->step_vel[i]  = (uint8_t)SEQ_VEL;
                    cl->step_gate[i] = (uint16_t)GATE_TICKS;
                    memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                cl->active     = 0;
                cl->note_count = 0;
                memset(cl->notes, 0, sizeof(cl->notes));
                cl->occ_dirty = 1;
                /* Clip clear also removes all automation (CC + AT, + PB later). */
                cc_auto_reset(&tr->clip_cc_auto[cidx]);
                at_auto_reset(&tr->clip_at_auto[cidx]);
                memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
                /* Deactivate track if the cleared clip is active or queued */
                if ((int)tr->active_clip == cidx) {
                    silence_track_notes_v2(inst, tr);
                    pfx_sync_from_clip(tr);
                    tr->clip_playing      = 0;
                    tr->will_relaunch     = 0;
                    tr->queued_clip       = -1;
                    tr->pending_page_stop = 0;
                    tr->record_armed      = 0;
                    tr->recording         = 0;
                } else if (tr->queued_clip == cidx) {
                    tr->queued_clip = -1;
                }
                inst->state_dirty = 1;
                return;
            }
            if (!strncmp(p, "_clear_keep", 11) && p[11] == '\0') {
                /* tN_cC_clear_keep — wipe step data, preserve playback state.
                 * Same preserve list as _clear (length, loop_start, tps, stretch,
                 * clock_shift, nudge, pfx) — only step note data is wiped. The
                 * difference vs _clear is that clip_playing / queued / armed
                 * state stay put so the focused clip keeps ticking through. */
                int i;
                undo_begin_single(inst, tidx, cidx);
                for (i = 0; i < SEQ_STEPS; i++) {
                    cl->steps[i] = 0;
                    memset(cl->step_notes[i], 0, 8);
                    cl->step_note_count[i] = 0;
                    cl->step_vel[i]  = (uint8_t)SEQ_VEL;
                    cl->step_gate[i] = (uint16_t)GATE_TICKS;
                    memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                cl->active     = 0;
                cl->note_count = 0;
                memset(cl->notes, 0, sizeof(cl->notes));
                cl->occ_dirty = 1;
                /* Clip clear also removes all automation (CC + AT, + PB later). */
                cc_auto_reset(&tr->clip_cc_auto[cidx]);
                at_auto_reset(&tr->clip_at_auto[cidx]);
                memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
                silence_track_notes_v2(inst, tr);
                pfx_sync_from_clip(tr);
                tr->rec_pending_count = 0;
                tr->recording = 0;
                if (tr->queued_clip == cidx) tr->queued_clip = -1;
                inst->state_dirty = 1;
                { char _zb[160]; snprintf(_zb, sizeof(_zb),
                    "Z3 _clear_keep DONE t%d c%d nc_after=%u rec=%d",
                    tidx, cidx, (unsigned)cl->note_count, (int)tr->recording);
                  seq8_ilog(inst, _zb); }
                return;
            }
            if (!strncmp(p, "_hard_reset", 11) && p[11] == '\0') {
                /* tN_cC_hard_reset — full factory reset: undo snapshot, silence, clip_init */
                undo_begin_single(inst, tidx, cidx);
                silence_track_notes_v2(inst, tr);
                clip_init(cl);
                cc_auto_reset(&tr->clip_cc_auto[cidx]);
                at_auto_reset(&tr->clip_at_auto[cidx]);
                if ((int)tr->active_clip == cidx)
                    pfx_sync_from_clip(tr);
                tr->rec_pending_count = 0;
                tr->recording = 0;
                if (tr->queued_clip == cidx) tr->queued_clip = -1;
                inst->state_dirty = 1;
                return;
            }
            if (!strncmp(p, "_at_clear", 9) && p[9] == '\0') {
                /* tN_cC_at_clear — wipe this clip's pad-pressure aftertouch automation. */
                undo_begin_single(inst, tidx, cidx);
                at_auto_reset(&tr->clip_at_auto[cidx]);
                memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
                inst->state_dirty = 1;
                return;
            }
            if (!strncmp(p, "_drum_clear", 11) && p[11] == '\0') {
                /* tN_cC_drum_clear val="0"=deactivate|"1"=keep transport
                 * Clears all lane step data in clip C; midi_note/length/tps/pfx preserved */
                int keep = my_atoi(val);
                int l, s;
                drum_clip_t *dc = tr->drum_clips[cidx];
                if (!dc) return;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_t *lc = &dc->lanes[l].clip;
                    for (s = 0; s < SEQ_STEPS; s++) {
                        lc->steps[s] = 0;
                        memset(lc->step_notes[s], 0, 8);
                        lc->step_note_count[s] = 0;
                        lc->step_vel[s] = (uint8_t)SEQ_VEL;
                        lc->step_gate[s] = (uint16_t)GATE_TICKS;
                        memset(lc->note_tick_offset[s], 0, 8 * sizeof(int16_t));
                    }
                    lc->active = 0;
                    lc->note_count = 0;
                    memset(lc->notes, 0, sizeof(lc->notes));
                    lc->occ_dirty = 1;
                }
                if (!keep) {
                    silence_track_notes_v2(inst, tr);
                    if (tr->active_clip == (uint8_t)cidx) {
                        tr->clip_playing = 0;
                        tr->will_relaunch = 0;
                    }
                    if (tr->queued_clip == cidx) tr->queued_clip = -1;
                    tr->recording = 0;
                    tr->rec_pending_count = 0;
                }
                inst->state_dirty = 1;
                return;
            }
            if (!strncmp(p, "_drum_reset", 11) && p[11] == '\0') {
                /* tN_cC_drum_reset — factory reset all lanes in clip C
                 * clip_init on each lane's clip_t; midi_note preserved (sibling field in drum_lane_t) */
                int l;
                drum_clip_t *dc = tr->drum_clips[cidx];
                if (!dc) return;
                silence_track_notes_v2(inst, tr);
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_init(&dc->lanes[l].clip);
                    tr->drum_current_step[l] = 0;
                    tr->drum_tick_in_step[l] = 0;
                }
                if (tr->active_clip == (uint8_t)cidx) {
                    tr->clip_playing = 0;
                    tr->will_relaunch = 0;
                    tr->recording = 0;
                    tr->rec_pending_count = 0;
                }
                if (tr->queued_clip == cidx) tr->queued_clip = -1;
                inst->state_dirty = 1;
                return;
            }
            return;
        }

        /* tN_clip_resolution — change per-clip ticks_per_step; rescale notes proportionally */
        if (!strcmp(sub, "clip_resolution")) {
            if (tr->recording) return;
            int idx = clamp_i(my_atoi(val), 0, 5);
            uint16_t new_tps = TPS_VALUES[idx];
            clip_t *cl = &tr->clips[tr->active_clip];
            uint16_t old_tps = cl->ticks_per_step;
            if (new_tps == old_tps) return;
            /* Rescale all notes proportionally */
            { uint32_t gmax_res = (uint32_t)SEQ_STEPS * new_tps;
              if (gmax_res > 65535) gmax_res = 65535;
              uint16_t ni;
              for (ni = 0; ni < cl->note_count; ni++) {
                  note_t *n = &cl->notes[ni];
                  n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                  uint32_t new_gate = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                  if (new_gate < 1) new_gate = 1;
                  if (new_gate > gmax_res) new_gate = gmax_res;
                  n->gate = (uint16_t)new_gate;
              }
            }
            cl->ticks_per_step = new_tps;
            /* Rescale current playback position */
            if (old_tps > 0)
                tr->tick_in_step = (uint32_t)((uint64_t)tr->tick_in_step * new_tps / old_tps);
            if (tr->tick_in_step >= new_tps) tr->tick_in_step = 0;
            /* Rebuild step arrays from rescaled notes */
            clip_build_steps_from_notes(cl);
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "clip_resolution_zoom")) {
            if (tr->recording) return;
            int idx = clamp_i(my_atoi(val), 0, 5);
            uint16_t new_tps = TPS_VALUES[idx];
            clip_t *cl = &tr->clips[tr->active_clip];
            uint16_t old_tps = cl->ticks_per_step;
            if (new_tps == old_tps) return;
            uint32_t old_ticks = (uint32_t)cl->length * (uint32_t)old_tps;
            uint32_t new_len32 = (old_ticks + (uint32_t)new_tps - 1) / (uint32_t)new_tps;
            if (new_len32 > SEQ_STEPS) return;
            uint32_t abs_clip_tick = (uint32_t)tr->current_step * (uint32_t)old_tps + tr->tick_in_step;
            cl->ticks_per_step = new_tps;
            cl->length = (uint16_t)new_len32;
            tr->current_step = (uint16_t)(abs_clip_tick / (uint32_t)new_tps);
            tr->tick_in_step  = abs_clip_tick % (uint32_t)new_tps;
            {
                uint16_t _le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= _le) {
                    tr->current_step = cl->loop_start;
                    tr->tick_in_step = 0;
                }
            }
            clip_build_steps_from_notes(cl);
            inst->state_dirty = 1;
            return;
        }

        /* tN_pad_octave / tN_pad_mode */
        if (!strcmp(sub, "pad_octave")) {
            tr->pad_octave = (uint8_t)clamp_i(my_atoi(val), 0, 8);
            return;
        }
        if (!strcmp(sub, "pad_mode")) {
            uint8_t new_mode = (uint8_t)clamp_i(my_atoi(val), 0, 1);
            if (new_mode == PAD_MODE_DRUM && tr->pad_mode != PAD_MODE_DRUM)
                drum_clips_alloc(inst, tr);
            else if (new_mode != PAD_MODE_DRUM && tr->pad_mode == PAD_MODE_DRUM)
                drum_clips_free(tr);
            tr->pad_mode = new_mode;
            tarp_silence(inst, tr);
            return;
        }
        /* Track-type conversion: translate note content AND flip pad_mode
         * atomically (single set_param, no coalescing drop). Idempotent guards
         * make a redundant push a no-op. */
        if (!strcmp(sub, "convert_to_drum")) {
            if (tr->pad_mode != PAD_MODE_DRUM)
                convert_track_melodic_to_drum(inst, tidx);
            return;
        }
        if (!strcmp(sub, "convert_to_melodic")) {
            if (tr->pad_mode == PAD_MODE_DRUM)
                convert_track_drum_to_melodic(inst, tidx);
            else if (tr->pad_mode == PAD_MODE_CONDUCT)
                tr->pad_mode = PAD_MODE_MELODIC_SCALE;  /* note data already melodic */
            /* Leaving the Conductor role: clear the one-Conductor latch. */
            if (inst->conductor_track == tidx) {
                inst->conductor_track = -1;
                inst->state_dirty = 1;
            }
            return;
        }
        if (!strcmp(sub, "convert_to_conduct")) {
            if (inst->conductor_track >= 0 && inst->conductor_track != tidx) {
                return; /* JS reads back conductor_track and shows the OLED message */
            }
            if (tr->pad_mode == PAD_MODE_CONDUCT)
                return; /* idempotent: already the Conductor, redundant push is a no-op */
            convert_track_to_conduct(inst, tidx);
            inst->conductor_track = (int8_t)tidx;
            inst->state_dirty = 1;
            return;
        }

        /* TRACK ARP set_param handlers */
        if (!strcmp(sub, "tarp_on")) {
            int _v = my_atoi(val) ? 1 : 0;
            if (tr->tarp_on && !_v) tarp_silence(inst, tr);
            tr->tarp_on = (uint8_t)_v;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_style")) {
            int _v = clamp_i(my_atoi(val), 0, 9);
            if (_v == 0) {
                if (tr->tarp_on) tarp_silence(inst, tr);
                tr->tarp_on = 0;
            } else {
                tr->tarp_on = 1;
            }
            tr->tarp.style = (uint8_t)_v;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_rate")) {
            int _v = clamp_i(my_atoi(val), 0, 9);
            tr->tarp.rate_idx = (uint8_t)_v;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_octaves")) {
            int _v = clamp_i(my_atoi(val), -4, 4);
            tr->tarp.octaves = (int8_t)_v;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_gate")) {
            int _v = clamp_i(my_atoi(val), 1, 200);
            tr->tarp.gate_pct = (uint16_t)_v;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_steps_mode")) {
            int _v = clamp_i(my_atoi(val), 0, 2);
            tr->tarp.steps_mode = (uint8_t)_v;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "track_vel_override")) {
            tr->track_vel_override = (uint8_t)clamp_i(my_atoi(val), 0, 127);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_step_vel")) {
            /* Format: "S L" — step index 0..7, level 0..4 */
            const char *p = val;
            int s = 0, lv = 0;
            while (*p == ' ') p++;
            while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
            while (*p == ' ') p++;
            while (*p >= '0' && *p <= '9') { lv = lv * 10 + (*p - '0'); p++; }
            if (s < 0 || s > 7) return;
            lv = clamp_i(lv, 0, 4);
            tr->tarp.step_vel[s] = (uint8_t)lv;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_step_int")) {
            /* Format: "S I" — step index 0..7, signed interval -24..+24 (scale degrees). */
            const char *p = val;
            int s = 0, iv = 0, sign = 1;
            while (*p == ' ') p++;
            while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
            while (*p == ' ') p++;
            if (*p == '-') { sign = -1; p++; }
            else if (*p == '+') { p++; }
            while (*p >= '0' && *p <= '9') { iv = iv * 10 + (*p - '0'); p++; }
            if (s < 0 || s > 7) return;
            iv = clamp_i(iv * sign, -24, 24);
            tr->tarp.step_int[s] = (int8_t)iv;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_step_loop_len")) {
            tr->tarp.step_loop_len = (uint8_t)clamp_i(my_atoi(val), 1, 8);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_reset")) {
            (void)val;
            arp_silence(inst, tr);
            tarp_drop_latched(inst, tr);
            arp_init_defaults(&tr->tarp);
            tr->tarp.held_count = 0;
            tr->tarp_on        = 0;
            tr->tarp_latch     = 0;
            tr->tarp_sync      = 1;
            tr->tarp_physical  = 0;
            inst->state_dirty  = 1;
            return;
        }
        if (!strcmp(sub, "tarp_latch")) {
            int _v = my_atoi(val) ? 1 : 0;
            uint8_t prev = tr->tarp_latch;
            tr->tarp_latch = (uint8_t)_v;
            if (prev && !_v) {
                /* Latch ON → OFF: drop latched (non-physical) entries from the
                 * held buffer, keep pads still physically held. If nothing is
                 * physically held, fall through to full silence. */
                tarp_drop_latched(inst, tr);
            }
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_clear_latched")) {
            /* User shortcut: drop latched (non-physical) entries from the held
             * buffer but keep tarp_latch=1. Functionally identical to the
             * latch-off compaction above, minus toggling tarp_latch. */
            tarp_drop_latched(inst, tr);
            return;
        }
        if (!strcmp(sub, "tarp_sync")) {
            tr->tarp_sync = (uint8_t)(my_atoi(val) ? 1 : 0);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "tarp_retrigger")) {
            tr->tarp.retrigger = (uint8_t)(my_atoi(val) ? 1 : 0);
            inst->state_dirty = 1;
            return;
        }

        /* CC PARAM bank set_params */
        if (!strcmp(sub, "cc_assign")) {
            /* Format: "K CC" — knob index 0-7, CC number 0-127 */
            const char *_p = val;
            int _k = 0, _cc = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _cc = _cc * 10 + (*_p - '0'); _p++; }
            if (_k < 0 || _k > 7) return;
            tr->cc_assign[_k] = (uint8_t)clamp_i(_cc, 0, 127);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_type_assign")) {
            /* Format: "K T A" — knob index 0-7, type 0-2, assign 0-127. Atomic. */
            const char *_p = val;
            int _k = 0, _tp = 0, _cc = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _tp = _tp * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _cc = _cc * 10 + (*_p - '0'); _p++; }
            if (_k < 0 || _k > 7) return;
            tr->cc_type[_k] = (uint8_t)clamp_i(_tp, 0, 2);
            tr->cc_assign[_k] = (uint8_t)clamp_i(_cc, 0, 127);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_type")) {
            /* Format: "K T" — knob index 0-7, type 0=CC, 1=Channel Pressure, 2=Chain knob (Sch). */
            const char *_p = val;
            int _k = 0, _tp = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _tp = _tp * 10 + (*_p - '0'); _p++; }
            if (_k < 0 || _k > 7) return;
            tr->cc_type[_k] = (uint8_t)clamp_i(_tp, 0, 2);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_send")) {
            /* Format: "K V" — knob index 0-7, CC value 0-127. Transmits immediately. */
            const char *_p = val;
            int _k = 0, _v = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _v = _v * 10 + (*_p - '0'); _p++; }
            if (_k < 0 || _k > 7) return;
            _v = clamp_i(_v, 0, 127);
            cc_emit(tr, _k, (uint8_t)_v);
            tr->cc_live_val[_k] = (uint8_t)_v;
            /* Latch this knob into overwrite recording on the first turn while
             * record-armed. The render path then writes the lane along the
             * playhead from cc_live_val (no point written here). Track-level —
             * works on drum and melodic alike (automation is not lane-aware).
             * Reset the latch snap on the 0->1 edge so the first 1/32 cell writes. */
            if (tr->recording) {
                if (!((tr->cc_latched >> _k) & 1)) {
                    if (tr->cc_latched == 0)
                        undo_begin_single(inst, tidx, (int)tr->active_clip);
                    tr->cc_latched |= (uint8_t)(1u << _k);
                    tr->cc_latch_last_snap[_k] = 0xFFFFFFFFu;
                }
            }
            return;
        }
        if (!strcmp(sub, "cc_touch")) {
            /* Format: "K 1 V" (touch on, initial value V) or "K 0 0" (touch off) */
            const char *_p = val;
            int _k = 0, _on = 0, _v = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p++ - '0'); }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _on = _on * 10 + (*_p++ - '0'); }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _v = _v * 10 + (*_p++ - '0'); }
            if (_k < 0 || _k > 7) return;
            if (_on) {
                tr->cc_live_val[_k]        = (uint8_t)clamp_i(_v, 0, 127);
                tr->cc_touch_held         |= (uint8_t)(1u << _k);
                tr->cc_touch_last_snap[_k] = 0xFFFFFFFFu; /* force write on first tick */
            } else {
                tr->cc_touch_held &= (uint8_t)~(1u << _k);
            }
            return;
        }
        if (!strcmp(sub, "cc_rest")) {
            /* Format: "C K V" — set clip C's resting value for knob K.
             * V 0..127 = set (and transmit live); V=255 = unset ("—", send
             * nothing). Used when stopped or playing on an un-automated lane.
             * Clip is explicit (JS focused clip may differ from active_clip). */
            const char *_p = val;
            int _c = 0, _k = 0, _v = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _v = _v * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return;
            cc_auto_t *_ca = &tr->clip_cc_auto[_c];
            if (_v >= 128) {
                _ca->rest_val[_k] = 0xFF;     /* "—" */
            } else {
                _v = clamp_i(_v, 0, 127);
                _ca->rest_val[_k]  = (uint8_t)_v;
                tr->cc_live_val[_k] = (uint8_t)_v;
                cc_emit(tr, _k, (uint8_t)_v); /* audible while turning */
            }
            if (_c == (int)tr->active_clip)
                tr->cc_auto_last_sent[_k] = 0xFF; /* re-assert on next play */
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_auto_set")) {
            /* Format: "C K T V" — clip, knob, tick, value. Writes step-edit automation. */
            const char *_p = val;
            int _c = 0, _k = 0, _tv = 0, _vv = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _tv = _tv * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _vv = _vv * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return;
            cc_auto_set_point(&tr->clip_cc_auto[_c], _k,
                              (uint16_t)clamp_i(_tv, 0, 65535),
                              (uint8_t)clamp_i(_vv, 0, 127));
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_auto_set2")) {
            /* Format: "C K T1 T2 V" — writes V at both T1 and T2; used for step-hold automation. */
            const char *_p = val;
            int _c = 0, _k = 0, _t1 = 0, _t2 = 0, _vv = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _t1 = _t1 * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _t2 = _t2 * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _vv = _vv * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return;
            _vv = clamp_i(_vv, 0, 127);
            _t1 = clamp_i(_t1, 0, 65535);
            _t2 = clamp_i(_t2, 0, 65535);
            /* Flat hold: drop any interior points in [t1,t2] first so a step
             * edit is a clean flat value with no stray recorded points. */
            cc_auto_clear_range(&tr->clip_cc_auto[_c], _k,
                                (uint16_t)_t1, (uint16_t)_t2);
            cc_auto_set_point(&tr->clip_cc_auto[_c], _k, (uint16_t)_t1, (uint8_t)_vv);
            if (_t2 != _t1)
                cc_auto_set_point(&tr->clip_cc_auto[_c], _k, (uint16_t)_t2, (uint8_t)_vv);
            if (_c == (int)tr->active_clip)
                tr->cc_auto_last_sent[_k] = 0xFF;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_auto_clear_k")) {
            /* Format: "C K" — clear all automation points for knob K in clip C. */
            {   const char *_pc = val; int _cc = 0;
                while (*_pc == ' ') _pc++;
                while (*_pc >= '0' && *_pc <= '9') { _cc = _cc * 10 + (*_pc - '0'); _pc++; }
                if (_cc >= 0 && _cc < NUM_CLIPS) undo_begin_single(inst, tidx, _cc);
            }
            const char *_p = val;
            int _c = 0, _k = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return;
            tr->clip_cc_auto[_c].count[_k] = 0;
            memset(tr->clip_cc_auto[_c].ticks[_k], 0,
                   CC_AUTO_MAX_POINTS * sizeof(uint16_t));
            memset(tr->clip_cc_auto[_c].vals[_k], 0, CC_AUTO_MAX_POINTS);
            tr->clip_cc_auto[_c].rest_val[_k] = 0xFF;   /* reset → "—" */
            if (_c == (int)tr->active_clip)
                tr->cc_auto_last_sent[_k] = 0xFF;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_auto_clear_range")) {
            /* Format: "C K T1 T2" — drop knob K's points in [T1,T2] for clip C
             * (single-step clear / turn-to-"—"). Keeps the resting value. */
            const char *_p = val;
            int _c = 0, _k = 0, _t1 = 0, _t2 = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _t1 = _t1 * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _t2 = _t2 * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return;
            cc_auto_clear_range(&tr->clip_cc_auto[_c], _k,
                                (uint16_t)clamp_i(_t1, 0, 65535),
                                (uint16_t)clamp_i(_t2, 0, 65535));
            if (_c == (int)tr->active_clip)
                tr->cc_auto_last_sent[_k] = 0xFF;
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_auto_clear_step")) {
            /* Format: "C T1 T2" — drop ALL knobs' points in [T1,T2] for clip C
             * (whole-step wipe). Atomic so the 8 lanes don't coalesce. */
            {   const char *_pc = val; int _cc = 0;
                while (*_pc == ' ') _pc++;
                while (*_pc >= '0' && *_pc <= '9') { _cc = _cc * 10 + (*_pc - '0'); _pc++; }
                if (_cc >= 0 && _cc < NUM_CLIPS) undo_begin_single(inst, tidx, _cc);
            }
            const char *_p = val;
            int _c = 0, _t1 = 0, _t2 = 0, _k;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _t1 = _t1 * 10 + (*_p - '0'); _p++; }
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _t2 = _t2 * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS) return;
            for (_k = 0; _k < 8; _k++)
                cc_auto_clear_range(&tr->clip_cc_auto[_c], _k,
                                    (uint16_t)clamp_i(_t1, 0, 65535),
                                    (uint16_t)clamp_i(_t2, 0, 65535));
            if (_c == (int)tr->active_clip)
                memset(tr->cc_auto_last_sent, 0xFF, 8);
            inst->state_dirty = 1;
            return;
        }
        if (!strcmp(sub, "cc_auto_clear")) {
            /* Format: "C" — clear all CC automation + resting values for clip C. */
            const char *_p = val;
            int _c = 0;
            while (*_p == ' ') _p++;
            while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
            if (_c < 0 || _c >= NUM_CLIPS) return;
            undo_begin_single(inst, tidx, _c);
            cc_auto_reset(&tr->clip_cc_auto[_c]);       /* points + rest → "—" */
            if (_c == (int)tr->active_clip)
                memset(tr->cc_auto_last_sent, 0xFF, 8);
            inst->state_dirty = 1;
            return;
        }

        /* tN_lL_* — drum lane setters */
        if (sub[0] == 'l' && sub[1] >= '0' && sub[1] <= '9') {
            int lane_idx = 0;
            const char *p2 = sub + 1;
            while (*p2 >= '0' && *p2 <= '9') { lane_idx = lane_idx * 10 + (*p2 - '0'); p2++; }
            if (lane_idx < 0 || lane_idx >= DRUM_LANES) return;
            /* Schwung host drops tN_pad_mode and tN_convert_to_drum, so
             * pad_mode may not be set on the DSP side when JS sends lane
             * writes. tN_lL_* keys are drum-only by construction (JS never
             * sends them for melodic tracks), so allocate here on first
             * lane write as the reliable drum-mode entry point. */
            if (tr->pad_mode != PAD_MODE_DRUM) {
                tr->pad_mode = PAD_MODE_DRUM;
                drum_clips_alloc(inst, tr);
            }
            drum_clip_t *_dlc_guard = tr->drum_clips[tr->active_clip];
            if (!_dlc_guard) { drum_clips_alloc(inst, tr); _dlc_guard = tr->drum_clips[tr->active_clip]; }
            if (!_dlc_guard) return;
            drum_lane_t *dlane = &_dlc_guard->lanes[lane_idx];
            clip_t      *dlc   = &dlane->clip;

            if (!strcmp(p2, "_lane_note")) {
                dlane->midi_note = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p2, "_mute")) {
                uint32_t bit = 1u << (uint32_t)lane_idx;
                if (my_atoi(val)) {
                    tr->drum_lane_mute |= bit;
                    pfx_note_off(inst, tr, dlane->midi_note);
                } else {
                    tr->drum_lane_mute &= ~bit;
                }
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p2, "_solo")) {
                uint32_t bit = 1u << (uint32_t)lane_idx;
                if (my_atoi(val)) {
                    tr->drum_lane_solo |= bit;
                    /* Silence all lanes that just became effectively muted */
                    int ll;
                    for (ll = 0; ll < DRUM_LANES; ll++) {
                        if (ll == lane_idx) continue;
                        uint8_t n2 = tr->drum_clips[tr->active_clip]->lanes[ll].midi_note;
                        pfx_note_off(inst, tr, n2);
                    }
                } else {
                    tr->drum_lane_solo &= ~bit;
                }
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p2, "_clip_length")) {
                int max_len = SEQ_STEPS - (int)dlc->loop_start;
                if (max_len < 1) max_len = 1;
                int newlen = clamp_i(my_atoi(val), 1, max_len);
                dlc->length = (uint16_t)newlen;
                {
                    uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                /* Re-anchor lane playhead to global tick so cross-lane phase
                 * stays consistent when length changes mid-playback. Stopped
                 * transport: anchor pins to loop_start (same as the clamp). */
                if (inst->playing)
                    drum_lane_anchor_playhead(inst, tr, lane_idx, dlc);
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return;
            }
            /* Playback direction for one drum lane's clip (v=35).
             * Mid-flight change keeps current playhead; pp_dir_state resets. */
            if (!strcmp(p2, "_playback_dir")) {
                dlc->playback_dir = (uint8_t)clamp_i(my_atoi(val), 0, 3);
                dlc->pp_dir_state = initial_pp_dir(dlc->playback_dir);
                silence_track_from_set_param(inst, tr);
                inst->state_dirty = 1;
                return;
            }
            /* Playback style for one drum lane: 0=Step, 1=Audio. */
            if (!strcmp(p2, "_playback_audio_reverse")) {
                dlc->playback_audio_reverse = (uint8_t)clamp_i(my_atoi(val), 0, 1);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p2, "_loop_set")) {
                /* tN_lL_loop_set "packed" — atomic loop window write for one drum lane. */
                long packed = 0;
                const char *vp = val;
                while (*vp == ' ') vp++;
                while (*vp >= '0' && *vp <= '9') packed = packed * 10 + (*vp++ - '0');
                int ls  = (int)((packed >> 16) & 0xFFFF);
                int len = (int)(packed & 0xFFFF);
                if (len < 1) len = 1;
                if (ls  < 0) ls  = 0;
                if (ls > SEQ_STEPS - 1) ls = SEQ_STEPS - 1;
                if (ls + len > SEQ_STEPS) len = SEQ_STEPS - ls;
                dlc->loop_start = (uint16_t)ls;
                dlc->length     = (uint16_t)len;
                {
                    uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                if (inst->playing)
                    drum_lane_anchor_playhead(inst, tr, lane_idx, dlc);
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p2, "_clear")) {
                /* tN_lL_clear — wipe all steps in this drum lane.
                 * Preserves length, loop_start, ticks_per_step, pfx_params,
                 * and midi_note (per-lane sibling). Snapshots the drum clip
                 * for global Undo (same granularity as _hard_reset). */
                int i;
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                for (i = 0; i < SEQ_STEPS; i++) {
                    dlc->steps[i] = 0;
                    memset(dlc->step_notes[i], 0, 8);
                    dlc->step_note_count[i] = 0;
                    dlc->step_vel[i]  = (uint8_t)SEQ_VEL;
                    dlc->step_gate[i] = (uint16_t)GATE_TICKS;
                    memset(dlc->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                dlc->active    = 0;
                dlc->note_count = 0;
                memset(dlc->notes, 0, sizeof(dlc->notes));
                dlc->occ_dirty = 1;
                inst->state_dirty = 1;
                return;
            }

            if (!strcmp(p2, "_hard_reset")) {
                /* tN_lL_hard_reset — full factory reset for one drum lane.
                 * Wipes clip data via clip_init AND the per-lane drum-repeat
                 * groove fields (gate, gate_len, vel_scale, nudge, Rpt2 rate)
                 * back to drum_repeat_init_defaults values. midi_note is
                 * preserved (lane identity — a kick lane stays a kick lane).
                 * Snapshot covers per-clip (all 16 lanes); Rpt groove fields
                 * are NOT undoable. */
                int _rs;
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                clip_init(dlc);
                tr->drum_current_step[lane_idx]   = 0;
                tr->drum_tick_in_step[lane_idx]   = 0;
                tr->drum_repeat_gate[lane_idx]      = 0xFF;
                tr->drum_repeat_gate_len[lane_idx]  = 8;
                tr->drum_repeat2_rate_idx[lane_idx] = 2; /* 1/8 default */
                for (_rs = 0; _rs < 8; _rs++) {
                    tr->drum_repeat_vel_scale[lane_idx][_rs] = 100;
                    tr->drum_repeat_nudge[lane_idx][_rs]     = 0;
                }
                inst->state_dirty = 1;
                return;
            }

            if (!strcmp(p2, "_loop_double_fill")) {
                int len = (int)dlc->length;
                int ls  = (int)dlc->loop_start;
                int i;
                /* See melodic loop_double_fill: bounds check + copy source
                 * indices must respect loop_start>0. */
                if (ls + len * 2 > SEQ_STEPS) return;
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                for (i = 0; i < len; i++) {
                    int src = ls + i;
                    int dst = ls + len + i;
                    dlc->steps[dst]           = dlc->steps[src];
                    memcpy(dlc->step_notes[dst], dlc->step_notes[src], 8);
                    dlc->step_note_count[dst] = dlc->step_note_count[src];
                    dlc->step_vel[dst]        = dlc->step_vel[src];
                    dlc->step_gate[dst]       = dlc->step_gate[src];
                    memcpy(dlc->note_tick_offset[dst], dlc->note_tick_offset[src], 8 * sizeof(int16_t));
                }
                dlc->length = (uint16_t)(len * 2);
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= _le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return;
            }

            if (!strcmp(p2, "_clip_resolution")) {
                int idx = clamp_i(my_atoi(val), 0, 5);
                uint16_t new_tps = TPS_VALUES[idx];
                uint16_t old_tps = dlc->ticks_per_step;
                if (new_tps == old_tps) return;
                { uint32_t gmax_dr = (uint32_t)SEQ_STEPS * new_tps;
                  if (gmax_dr > 65535) gmax_dr = 65535;
                  uint16_t ni;
                  for (ni = 0; ni < dlc->note_count; ni++) {
                      note_t *n = &dlc->notes[ni];
                      n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                      uint32_t ng = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                      if (ng < 1) ng = 1;
                      if (ng > gmax_dr) ng = gmax_dr;
                      n->gate = (uint16_t)ng;
                  }
                }
                dlc->ticks_per_step = new_tps;
                if (old_tps > 0)
                    tr->drum_tick_in_step[lane_idx] =
                        (uint32_t)((uint64_t)tr->drum_tick_in_step[lane_idx] * new_tps / old_tps);
                if (tr->drum_tick_in_step[lane_idx] >= new_tps)
                    tr->drum_tick_in_step[lane_idx] = 0;
                clip_build_steps_from_notes(dlc);
                inst->state_dirty = 1;
                return;
            }

            if (!strcmp(p2, "_beat_stretch")) {
                int dir = my_atoi(val);
                int len = (int)dlc->length;
                int i, ni2, new_len, any;
                uint8_t  tmp_steps[SEQ_STEPS];
                uint8_t  tmp_notes[SEQ_STEPS][8];
                uint8_t  tmp_nc[SEQ_STEPS];
                uint8_t  tmp_vel[SEQ_STEPS];
                uint16_t tmp_gate[SEQ_STEPS];
                int16_t  tmp_tick_offset[SEQ_STEPS][8];
                { int gmax_bs = SEQ_STEPS * dlc->ticks_per_step; if (gmax_bs > 65535) gmax_bs = 65535;
                  int off_clamp = dlc->ticks_per_step - 1;
                  if (dir == 1) {
                      if (len * 2 > SEQ_STEPS) return;
                      new_len = len * 2;
                      for (i = len - 1; i >= 1; i--) {
                          int ng = (int)dlc->step_gate[i] * 2;
                          if (ng > gmax_bs) ng = gmax_bs;
                          dlc->steps[i*2]           = dlc->steps[i];
                          memcpy(dlc->step_notes[i*2], dlc->step_notes[i], 8);
                          dlc->step_note_count[i*2] = dlc->step_note_count[i];
                          dlc->step_vel[i*2]        = dlc->step_vel[i];
                          dlc->step_gate[i*2]       = (uint16_t)ng;
                          for (ni2 = 0; ni2 < 8; ni2++) {
                              int nt = (int)dlc->note_tick_offset[i][ni2] * 2;
                              if (nt > off_clamp) nt = off_clamp; else if (nt < -off_clamp) nt = -off_clamp;
                              dlc->note_tick_offset[i*2][ni2] = (int16_t)nt;
                          }
                          dlc->steps[i] = 0;
                      }
                      { int ng = (int)dlc->step_gate[0] * 2;
                        if (ng > gmax_bs) ng = gmax_bs;
                        dlc->step_gate[0] = (uint16_t)ng;
                        for (ni2 = 0; ni2 < 8; ni2++) {
                            int nt = (int)dlc->note_tick_offset[0][ni2] * 2;
                            if (nt > off_clamp) nt = off_clamp; else if (nt < -off_clamp) nt = -off_clamp;
                            dlc->note_tick_offset[0][ni2] = (int16_t)nt;
                        }
                      }
                      for (i = 1; i < new_len; i += 2) {
                          dlc->steps[i] = 0;
                          memset(dlc->step_notes[i], 0, 8);
                          dlc->step_note_count[i] = 0;
                          dlc->step_vel[i]        = SEQ_VEL;
                          dlc->step_gate[i]       = GATE_TICKS;
                          memset(dlc->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                      }
                      dlc->length = (uint16_t)new_len;
                      dlc->stretch_exp++;
                      tr->stretch_blocked = 0;
                  } else {
                      if (len < 2) return;
                      { uint8_t seen[SEQ_STEPS];
                        memset(seen, 0, sizeof(seen));
                        for (i = 0; i < len; i++) {
                            if (dlc->steps[i]) {
                                int dst = i / 2;
                                if (seen[dst]) { tr->stretch_blocked = 1; return; }
                                seen[dst] = 1;
                            }
                        }
                      }
                      tr->stretch_blocked = 0;
                      new_len = len / 2;
                      memset(tmp_steps, 0, sizeof(tmp_steps));
                      for (i = 0; i < SEQ_STEPS; i++) {
                          memset(tmp_notes[i], 0, 8);
                          tmp_nc[i]   = 0;
                          tmp_vel[i]  = SEQ_VEL;
                          tmp_gate[i] = GATE_TICKS;
                          memset(tmp_tick_offset[i], 0, 8 * sizeof(int16_t));
                      }
                      for (i = 0; i < len; i++) {
                          if (dlc->steps[i]) {
                              int dst = i / 2;
                              if (!tmp_steps[dst]) {
                                  int ng = ((int)dlc->step_gate[i] + 1) / 2;
                                  if (ng < 1) ng = 1;
                                  tmp_steps[dst] = 1;
                                  memcpy(tmp_notes[dst], dlc->step_notes[i], 8);
                                  tmp_nc[dst]   = dlc->step_note_count[i];
                                  tmp_vel[dst]  = dlc->step_vel[i];
                                  tmp_gate[dst] = (uint16_t)ng;
                                  for (ni2 = 0; ni2 < 8; ni2++) {
                                      int nt = (int)dlc->note_tick_offset[i][ni2] / 2;
                                      tmp_tick_offset[dst][ni2] = (int16_t)nt;
                                  }
                              }
                          }
                      }
                      for (i = 0; i < len; i++) {
                          if (!dlc->steps[i] && dlc->step_note_count[i] > 0) {
                              int dst = i / 2;
                              if (tmp_nc[dst] == 0) {
                                  int ng = ((int)dlc->step_gate[i] + 1) / 2;
                                  if (ng < 1) ng = 1;
                                  memcpy(tmp_notes[dst], dlc->step_notes[i], 8);
                                  tmp_nc[dst]   = dlc->step_note_count[i];
                                  tmp_vel[dst]  = dlc->step_vel[i];
                                  tmp_gate[dst] = (uint16_t)ng;
                                  for (ni2 = 0; ni2 < 8; ni2++) {
                                      int nt = (int)dlc->note_tick_offset[i][ni2] / 2;
                                      tmp_tick_offset[dst][ni2] = (int16_t)nt;
                                  }
                              }
                          }
                      }
                      memcpy(dlc->steps,           tmp_steps,       sizeof(tmp_steps));
                      memcpy(dlc->step_notes,      tmp_notes,       sizeof(tmp_notes));
                      memcpy(dlc->step_note_count, tmp_nc,          sizeof(tmp_nc));
                      memcpy(dlc->step_vel,        tmp_vel,         sizeof(tmp_vel));
                      memcpy(dlc->step_gate,       tmp_gate,        sizeof(tmp_gate));
                      memcpy(dlc->note_tick_offset, tmp_tick_offset, sizeof(tmp_tick_offset));
                      dlc->length = (uint16_t)new_len;
                      dlc->stretch_exp--;
                  }
                } /* end gmax_bs/off_clamp block */
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= _le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                any = 0;
                for (i = 0; i < (int)dlc->length; i++)
                    if (dlc->steps[i]) { any = 1; break; }
                dlc->active = (uint8_t)any;
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return;
            }

            if (!strcmp(p2, "_clock_shift")) {
                int dir = my_atoi(val);
                int len = (int)dlc->length;
                if (len < 2) return;
                uint8_t tmp_s, tmp_nc, tmp_ns[8], tmp_v;
                uint16_t tmp_g;
                int16_t tmp_toff[8];
                if (dir == 1) {
                    tmp_s  = dlc->steps[len-1];
                    memcpy(tmp_ns, dlc->step_notes[len-1], 8);
                    tmp_nc = dlc->step_note_count[len-1];
                    tmp_v  = dlc->step_vel[len-1];
                    tmp_g  = dlc->step_gate[len-1];
                    memcpy(tmp_toff, dlc->note_tick_offset[len-1], 8 * sizeof(int16_t));
                    memmove(&dlc->steps[1],              &dlc->steps[0],              (size_t)(len-1));
                    memmove(&dlc->step_notes[1][0],      &dlc->step_notes[0][0],      (size_t)(len-1) * 8);
                    memmove(&dlc->step_note_count[1],    &dlc->step_note_count[0],    (size_t)(len-1));
                    memmove(&dlc->step_vel[1],           &dlc->step_vel[0],           (size_t)(len-1));
                    memmove(&dlc->step_gate[1],          &dlc->step_gate[0],          (size_t)(len-1) * 2);
                    memmove(&dlc->note_tick_offset[1][0], &dlc->note_tick_offset[0][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                    dlc->steps[0] = tmp_s;
                    memcpy(dlc->step_notes[0], tmp_ns, 8);
                    dlc->step_note_count[0] = tmp_nc;
                    dlc->step_vel[0] = tmp_v;
                    dlc->step_gate[0] = tmp_g;
                    memcpy(dlc->note_tick_offset[0], tmp_toff, 8 * sizeof(int16_t));
                    dlc->clock_shift_pos = (uint16_t)((dlc->clock_shift_pos + 1) % (uint16_t)len);
                } else {
                    tmp_s  = dlc->steps[0];
                    memcpy(tmp_ns, dlc->step_notes[0], 8);
                    tmp_nc = dlc->step_note_count[0];
                    tmp_v  = dlc->step_vel[0];
                    tmp_g  = dlc->step_gate[0];
                    memcpy(tmp_toff, dlc->note_tick_offset[0], 8 * sizeof(int16_t));
                    memmove(&dlc->steps[0],              &dlc->steps[1],              (size_t)(len-1));
                    memmove(&dlc->step_notes[0][0],      &dlc->step_notes[1][0],      (size_t)(len-1) * 8);
                    memmove(&dlc->step_note_count[0],    &dlc->step_note_count[1],    (size_t)(len-1));
                    memmove(&dlc->step_vel[0],           &dlc->step_vel[1],           (size_t)(len-1));
                    memmove(&dlc->step_gate[0],          &dlc->step_gate[1],          (size_t)(len-1) * 2);
                    memmove(&dlc->note_tick_offset[0][0], &dlc->note_tick_offset[1][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                    dlc->steps[len-1] = tmp_s;
                    memcpy(dlc->step_notes[len-1], tmp_ns, 8);
                    dlc->step_note_count[len-1] = tmp_nc;
                    dlc->step_vel[len-1] = tmp_v;
                    dlc->step_gate[len-1] = tmp_g;
                    memcpy(dlc->note_tick_offset[len-1], tmp_toff, 8 * sizeof(int16_t));
                    dlc->clock_shift_pos = (uint16_t)((dlc->clock_shift_pos + (uint16_t)(len-1)) % (uint16_t)len);
                }
                { int i2, any = 0;
                  for (i2 = 0; i2 < len; i2++) if (dlc->steps[i2]) { any = 1; break; }
                  dlc->active = (uint8_t)any;
                }
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return;
            }

            if (!strcmp(p2, "_nudge")) {
                int dir = my_atoi(val);
                if (dir == 0) { dlc->nudge_pos = 0; inst->state_dirty = 1; return; }
                if (dir != 1 && dir != -1) return;
                int len = (int)dlc->length;
                if (len < 1) return;
                int tps = (int)dlc->ticks_per_step;
                int midpoint = tps / 2;
                struct { int16_t dst, dst_off; uint8_t pitch, vel, active; uint16_t gate; } cross[512];
                int ncross = 0;
                int s, ni, wi;
                for (s = 0; s < len; s++) {
                    if (dlc->step_note_count[s] == 0) continue;
                    wi = 0;
                    for (ni = 0; ni < (int)dlc->step_note_count[s]; ni++) {
                        int new_off = (int)dlc->note_tick_offset[s][ni] + dir;
                        if (new_off >= midpoint) {
                            if (ncross < 512) {
                                cross[ncross].dst     = (int16_t)((s + 1) % len);
                                cross[ncross].dst_off = (int16_t)(new_off - tps);
                                cross[ncross].pitch   = dlc->step_notes[s][ni];
                                cross[ncross].vel     = dlc->step_vel[s];
                                cross[ncross].gate    = dlc->step_gate[s];
                                cross[ncross].active  = dlc->steps[s];
                                ncross++;
                            }
                        } else if (new_off < -midpoint) {
                            if (ncross < 512) {
                                cross[ncross].dst     = (int16_t)((s - 1 + len) % len);
                                cross[ncross].dst_off = (int16_t)(new_off + tps);
                                cross[ncross].pitch   = dlc->step_notes[s][ni];
                                cross[ncross].vel     = dlc->step_vel[s];
                                cross[ncross].gate    = dlc->step_gate[s];
                                cross[ncross].active  = dlc->steps[s];
                                ncross++;
                            }
                        } else {
                            dlc->step_notes[s][wi]       = dlc->step_notes[s][ni];
                            dlc->note_tick_offset[s][wi] = (int16_t)new_off;
                            wi++;
                        }
                    }
                    for (ni = wi; ni < (int)dlc->step_note_count[s]; ni++) {
                        dlc->step_notes[s][ni]       = 0;
                        dlc->note_tick_offset[s][ni] = 0;
                    }
                    dlc->step_note_count[s] = (uint8_t)wi;
                    if (wi == 0) {
                        dlc->steps[s]     = 0;
                        dlc->step_vel[s]  = (uint8_t)SEQ_VEL;
                        dlc->step_gate[s] = (uint16_t)GATE_TICKS;
                    }
                }
                { int ci;
                  for (ci = 0; ci < ncross; ci++) {
                      int dst = (int)cross[ci].dst;
                      if (dlc->step_note_count[dst] >= 8) continue;
                      int slot = (int)dlc->step_note_count[dst];
                      dlc->step_notes[dst][slot]       = cross[ci].pitch;
                      dlc->note_tick_offset[dst][slot] = cross[ci].dst_off;
                      if (slot == 0) {
                          dlc->step_vel[dst]  = cross[ci].vel;
                          dlc->step_gate[dst] = cross[ci].gate;
                      }
                      if (cross[ci].active) dlc->steps[dst] = 1;
                      dlc->step_note_count[dst]++;
                  }
                }
                { int any2 = 0;
                  for (s = 0; s < len; s++) if (dlc->steps[s]) { any2 = 1; break; }
                  dlc->active = (uint8_t)any2;
                }
                dlc->nudge_pos += (int16_t)dir;
                clip_migrate_to_notes(dlc);
                return;
            }

            if (!strcmp(p2, "_clip_resolution_zoom")) {
                if (tr->recording) return;
                int idx = clamp_i(my_atoi(val), 0, 5);
                uint16_t new_tps = TPS_VALUES[idx];
                uint16_t old_tps = dlc->ticks_per_step;
                if (new_tps == old_tps) return;
                uint32_t old_ticks = (uint32_t)dlc->length * (uint32_t)old_tps;
                uint32_t new_len32 = (old_ticks + (uint32_t)new_tps - 1) / (uint32_t)new_tps;
                if (new_len32 > SEQ_STEPS) return;
                uint32_t abs_tick = (uint32_t)tr->drum_current_step[lane_idx] * (uint32_t)old_tps
                                  + tr->drum_tick_in_step[lane_idx];
                dlc->ticks_per_step = new_tps;
                dlc->length = (uint16_t)new_len32;
                tr->drum_current_step[lane_idx] = (uint16_t)(abs_tick / (uint32_t)new_tps);
                tr->drum_tick_in_step[lane_idx] = abs_tick % (uint32_t)new_tps;
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= _le) {
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                        tr->drum_tick_in_step[lane_idx] = 0;
                    }
                }
                clip_build_steps_from_notes(dlc);
                inst->state_dirty = 1;
                return;
            }

            /* tN_lL_step_S_toggle  val="vel"
             * Empty step: add lane note, activate. Active: deactivate. Inactive-with-note: reactivate. */
            if (!strcmp(p2, "_pfx_set")) {
                /* val = "pfx_key value" — apply pfx param to this lane's pfx_params */
                const char *sp = val;
                char pfx_key[64]; int ki = 0;
                while (*sp && *sp != ' ' && ki < 63) pfx_key[ki++] = *sp++;
                pfx_key[ki] = '\0';
                while (*sp == ' ') sp++;
                if (!strcmp(pfx_key, "pfx_reset") || !strcmp(pfx_key, "pfx_noteFx_reset") ||
                    !strcmp(pfx_key, "pfx_harm_reset") || !strcmp(pfx_key, "pfx_delay_reset"))
                    undo_begin_single(inst, tidx, (int)tr->active_clip);
                drum_pfx_set(inst, tr, &dlane->pfx_params, &tr->drum_lane_pfx[lane_idx], pfx_key, sp);
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_lgto_apply: destructive legato on this drum lane's clip.
             * Each note's gate becomes (next-active-tick − this-tick); last-
             * active note's gate fills to clip_end. Undoable. */
            if (!strcmp(p2, "_lgto_apply")) {
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                apply_legato_to_clip(&dlane->clip);
                inst->state_dirty = 1;
                return;
            }
            if (!strcmp(p2, "_pfx_reset")) {
                undo_begin_single(inst, tidx, (int)tr->active_clip);
                drum_pfx_set(inst, tr, &dlane->pfx_params, &tr->drum_lane_pfx[lane_idx], "pfx_reset", "1");
                inst->state_dirty = 1;
                return;
            }

            /* tN_lL_copy_to "dstLane" — copy active clip's lane L to dstLane; preserve dst midi_note */
            if (!strcmp(p2, "_copy_to")) {
                int dstLane = clamp_i(my_atoi(val), 0, DRUM_LANES - 1);
                if (dstLane == lane_idx) return;
                {
                    drum_lane_t *dst = &tr->drum_clips[(int)tr->active_clip]->lanes[dstLane];
                    uint8_t dst_midi_note = dst->midi_note;
                    undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                    memcpy(dst->clip.steps,            dlc->steps,            SEQ_STEPS);
                    memcpy(dst->clip.step_notes,       dlc->step_notes,       SEQ_STEPS * 8);
                    memcpy(dst->clip.step_note_count,  dlc->step_note_count,  SEQ_STEPS);
                    memcpy(dst->clip.step_vel,         dlc->step_vel,         SEQ_STEPS);
                    memcpy(dst->clip.step_gate,        dlc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                    memcpy(dst->clip.note_tick_offset, dlc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                    memcpy(dst->clip.step_iter,    dlc->step_iter,    SEQ_STEPS);
                    memcpy(dst->clip.step_random,  dlc->step_random,  SEQ_STEPS);
                    memcpy(dst->clip.step_ratchet, dlc->step_ratchet, SEQ_STEPS);
                    dst->clip.length        = dlc->length;
                    dst->clip.loop_start    = dlc->loop_start;
                    dst->clip.ticks_per_step = dlc->ticks_per_step;
                    dst->clip.playback_dir   = dlc->playback_dir;
                    dst->clip.playback_audio_reverse = dlc->playback_audio_reverse;
                    dst->clip.pp_dir_state   = initial_pp_dir(dst->clip.playback_dir);
                    dst->clip.active        = dlc->active;
                    dst->midi_note          = dst_midi_note;
                    dst->pfx_params         = dlane->pfx_params;
                    clip_migrate_to_notes(&dst->clip);
                    drum_pfx_apply_params(&tr->drum_lane_pfx[dstLane], &dst->pfx_params);
                    /* Copy repeat groove params */
                    tr->drum_repeat_gate[dstLane]     = tr->drum_repeat_gate[lane_idx];
                    tr->drum_repeat_gate_len[dstLane] = tr->drum_repeat_gate_len[lane_idx];
                    memcpy(tr->drum_repeat_vel_scale[dstLane], tr->drum_repeat_vel_scale[lane_idx], 8);
                    memcpy(tr->drum_repeat_nudge[dstLane],     tr->drum_repeat_nudge[lane_idx],     8);
                    inst->state_dirty = 1;
                }
                return;
            }

            /* tN_lL_cut_to "dstLane" — copy then clear src; atomic undo */
            if (!strcmp(p2, "_cut_to")) {
                int dstLane = clamp_i(my_atoi(val), 0, DRUM_LANES - 1);
                if (dstLane == lane_idx) return;
                {
                    drum_lane_t *dst = &tr->drum_clips[(int)tr->active_clip]->lanes[dstLane];
                    uint8_t dst_midi_note = dst->midi_note;
                    uint8_t src_midi_note = dlane->midi_note;
                    undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                    memcpy(dst->clip.steps,            dlc->steps,            SEQ_STEPS);
                    memcpy(dst->clip.step_notes,       dlc->step_notes,       SEQ_STEPS * 8);
                    memcpy(dst->clip.step_note_count,  dlc->step_note_count,  SEQ_STEPS);
                    memcpy(dst->clip.step_vel,         dlc->step_vel,         SEQ_STEPS);
                    memcpy(dst->clip.step_gate,        dlc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                    memcpy(dst->clip.note_tick_offset, dlc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                    memcpy(dst->clip.step_iter,    dlc->step_iter,    SEQ_STEPS);
                    memcpy(dst->clip.step_random,  dlc->step_random,  SEQ_STEPS);
                    memcpy(dst->clip.step_ratchet, dlc->step_ratchet, SEQ_STEPS);
                    dst->clip.length        = dlc->length;
                    dst->clip.loop_start    = dlc->loop_start;
                    dst->clip.ticks_per_step = dlc->ticks_per_step;
                    dst->clip.playback_dir   = dlc->playback_dir;
                    dst->clip.playback_audio_reverse = dlc->playback_audio_reverse;
                    dst->clip.pp_dir_state   = initial_pp_dir(dst->clip.playback_dir);
                    dst->clip.active        = dlc->active;
                    dst->midi_note          = dst_midi_note;
                    clip_migrate_to_notes(&dst->clip);
                    /* Move repeat groove params */
                    tr->drum_repeat_gate[dstLane]     = tr->drum_repeat_gate[lane_idx];
                    tr->drum_repeat_gate_len[dstLane] = tr->drum_repeat_gate_len[lane_idx];
                    memcpy(tr->drum_repeat_vel_scale[dstLane], tr->drum_repeat_vel_scale[lane_idx], 8);
                    memcpy(tr->drum_repeat_nudge[dstLane],     tr->drum_repeat_nudge[lane_idx],     8);
                    tr->drum_repeat_gate[lane_idx]     = 0xFF;
                    tr->drum_repeat_gate_len[lane_idx] = 8;
                    memset(tr->drum_repeat_vel_scale[lane_idx], 100, 8);
                    memset(tr->drum_repeat_nudge[lane_idx],     0,   8);
                    drum_lane_note_off_imm(inst, tr, src_midi_note);
                    clip_init(dlc);
                    dlane->midi_note = src_midi_note;
                    inst->state_dirty = 1;
                }
                return;
            }

            /* tN_lL_euclid_stamp  val="prevN newN vel"
             * Atomic Euclid diff: unstamp positions in (prev \ new), stamp positions in (new \ prev).
             * Hand-edits at non-Euclid positions are preserved. */
            if (!strcmp(p2, "_euclid_stamp")) {
                int prevN = 0, newN = 0, vel = SEQ_VEL;
                {
                    const char *sp = val;
                    prevN = my_atoi(sp);
                    while (*sp && *sp != ' ') sp++;
                    while (*sp == ' ') sp++;
                    newN = my_atoi(sp);
                    while (*sp && *sp != ' ') sp++;
                    while (*sp == ' ') sp++;
                    if (*sp) vel = my_atoi(sp);
                }
                vel = clamp_i(vel, 1, 127);
                int len = (int)dlc->length;
                if (len <= 0) return;
                if (prevN < 0) prevN = 0; if (prevN > len) prevN = len;
                if (newN  < 0) newN  = 0; if (newN  > len) newN  = len;
                if (prevN == newN) return;
                int old_pos[SEQ_STEPS], new_pos[SEQ_STEPS];
                int no = bjorklund_positions(prevN, len, old_pos);
                int nn = bjorklund_positions(newN,  len, new_pos);
                /* Both arrays are ascending. Merge-walk to compute symmetric difference. */
                int io = 0, in_ = 0;
                while (io < no || in_ < nn) {
                    int op = (io < no) ? old_pos[io] : SEQ_STEPS;
                    int np = (in_ < nn) ? new_pos[in_] : SEQ_STEPS;
                    if (op == np) { io++; in_++; continue; }
                    if (op < np) {
                        /* old-only: unstamp (clear step) */
                        int s = op;
                        if (dlc->steps[s] || dlc->step_note_count[s]) {
                            dlc->steps[s]           = 0;
                            dlc->step_note_count[s]  = 0;
                            dlc->step_vel[s]         = (uint8_t)SEQ_VEL;
                            dlc->step_gate[s]        = (uint16_t)GATE_TICKS;
                            memset(dlc->note_tick_offset[s], 0, sizeof(dlc->note_tick_offset[s]));
                            memset(dlc->step_notes[s], 0, 8);
                            dlc->step_iter[s]        = 0;
                            dlc->step_random[s]      = 0;
                            dlc->step_ratchet[s]     = 0;
                            drum_lane_note_off_imm(inst, tr, dlane->midi_note);
                        }
                        io++;
                    } else {
                        /* new-only: stamp (activate step with lane note) */
                        int s = np;
                        if (dlc->step_note_count[s] == 0) {
                            dlc->step_notes[s][0]      = dlane->midi_note;
                            dlc->step_note_count[s]     = 1;
                            dlc->step_vel[s]            = (uint8_t)vel;
                            dlc->step_gate[s]           = (uint16_t)GATE_TICKS;
                            dlc->note_tick_offset[s][0] = 0;
                            dlc->steps[s]               = 1;
                        } else {
                            /* Has notes (possibly hand-placed): just ensure active */
                            dlc->steps[s] = 1;
                        }
                        in_++;
                    }
                }
                { int i, any = 0;
                  for (i = 0; i < (int)dlc->length; i++) if (dlc->steps[i]) { any = 1; break; }
                  dlc->active = (uint8_t)any; }
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return;
            }

            if (!strncmp(p2, "_step_", 6)) {
                const char *q = p2 + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return;

                if (!strcmp(q, "_toggle")) {
                    int vel = clamp_i(my_atoi(val), 1, 127);
                    if (vel == 0) vel = SEQ_VEL;
                    if (dlc->step_note_count[sidx] == 0) {
                        /* Empty: add lane note and activate */
                        dlc->step_notes[sidx][0]       = dlane->midi_note;
                        dlc->step_note_count[sidx]      = 1;
                        dlc->step_vel[sidx]             = (uint8_t)vel;
                        dlc->step_gate[sidx]            = (uint16_t)GATE_TICKS;
                        dlc->note_tick_offset[sidx][0]  = 0;
                        dlc->steps[sidx]                = 1;
                    } else {
                        /* Has note: toggle active/inactive */
                        int was_on = dlc->steps[sidx];
                        dlc->steps[sidx] = was_on ? 0 : 1;
                        if (was_on) drum_lane_note_off_imm(inst, tr, dlane->midi_note);
                    }
                    { int i, any = 0;
                      for (i = 0; i < SEQ_STEPS; i++) if (dlc->steps[i]) { any = 1; break; }
                      dlc->active = (uint8_t)any; }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_clear")) {
                    dlc->steps[sidx]          = 0;
                    dlc->step_note_count[sidx] = 0;
                    dlc->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                    dlc->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                    memset(dlc->note_tick_offset[sidx], 0, sizeof(dlc->note_tick_offset[sidx]));
                    dlc->step_iter[sidx]       = 0;
                    dlc->step_random[sidx]     = 0;
                    dlc->step_ratchet[sidx]    = 0;
                    { int i, any = 0;
                      for (i = 0; i < SEQ_STEPS; i++) if (dlc->steps[i]) { any = 1; break; }
                      dlc->active = (uint8_t)any; }
                    clip_migrate_to_notes(dlc);
                    pfx_note_off_imm(inst, tr, dlane->midi_note);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_vel")) {
                    if (dlc->step_note_count[sidx] == 0) return;
                    dlc->step_vel[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_gate")) {
                    if (dlc->step_note_count[sidx] == 0) return;
                    dlc->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, 65535);
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_nudge")) {
                    if (dlc->step_note_count[sidx] == 0) return;
                    { int tps_m1 = dlc->ticks_per_step - 1;
                    int new_val = clamp_i(my_atoi(val), -tps_m1, tps_m1);
                    int delta = new_val - (int)dlc->note_tick_offset[sidx][0];
                    int ni;
                    for (ni = 0; ni < (int)dlc->step_note_count[sidx]; ni++) {
                        int o = (int)dlc->note_tick_offset[sidx][ni] + delta;
                        dlc->note_tick_offset[sidx][ni] = (int16_t)clamp_i(o, -tps_m1, tps_m1);
                    } }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_iter")) {
                    int raw = clamp_i(my_atoi(val), 0, 255);
                    if (raw != 0) {
                        int len = (raw >> 4) & 0xF, idx = raw & 0xF;
                        if (len < 1 || len > 8 || idx < 1 || idx > len) raw = 0;
                    }
                    dlc->step_iter[sidx] = (uint8_t)raw;
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_rand")) {
                    dlc->step_random[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 100);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_ratch")) {
                    dlc->step_ratchet[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 4);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_reassign")) {
                    int dstStep = clamp_i(my_atoi(val), 0, (int)dlc->length - 1);
                    if (dstStep == sidx) return;
                    if (dlc->step_note_count[sidx] == 0) return;
                    {
                        int tps_m1 = dlc->ticks_per_step - 1;
                        int offset_adjust = ((int)sidx - dstStep) * dlc->ticks_per_step;
                        int ni;
                        if (dlc->step_note_count[dstStep] == 0) {
                            for (ni = 0; ni < (int)dlc->step_note_count[sidx]; ni++) {
                                dlc->step_notes[dstStep][ni] = dlc->step_notes[sidx][ni];
                                int new_off = (int)dlc->note_tick_offset[sidx][ni] + offset_adjust;
                                dlc->note_tick_offset[dstStep][ni] =
                                    (int16_t)clamp_i(new_off, -tps_m1, tps_m1);
                            }
                            dlc->step_note_count[dstStep] = dlc->step_note_count[sidx];
                            dlc->step_vel[dstStep]        = dlc->step_vel[sidx];
                            dlc->step_gate[dstStep]       = dlc->step_gate[sidx];
                            dlc->step_iter[dstStep]       = dlc->step_iter[sidx];
                            dlc->step_random[dstStep]     = dlc->step_random[sidx];
                            dlc->step_ratchet[dstStep]    = dlc->step_ratchet[sidx];
                            dlc->steps[dstStep]           = dlc->steps[sidx];
                        } else {
                            for (ni = 0; ni < (int)dlc->step_note_count[sidx]; ni++) {
                                uint8_t pitch = dlc->step_notes[sidx][ni];
                                int nj, dup = 0;
                                for (nj = 0; nj < (int)dlc->step_note_count[dstStep]; nj++) {
                                    if (dlc->step_notes[dstStep][nj] == pitch) { dup = 1; break; }
                                }
                                if (dup || dlc->step_note_count[dstStep] >= 8) continue;
                                int slot = (int)dlc->step_note_count[dstStep];
                                dlc->step_notes[dstStep][slot] = pitch;
                                int new_off = (int)dlc->note_tick_offset[sidx][ni] + offset_adjust;
                                dlc->note_tick_offset[dstStep][slot] =
                                    (int16_t)clamp_i(new_off, -tps_m1, tps_m1);
                                dlc->step_note_count[dstStep]++;
                            }
                            if (dlc->steps[sidx]) dlc->steps[dstStep] = 1;
                        }
                        memset(dlc->step_notes[sidx], 0, 8);
                        memset(dlc->note_tick_offset[sidx], 0, 8 * sizeof(int16_t));
                        dlc->step_note_count[sidx] = 0;
                        dlc->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                        dlc->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                        dlc->step_iter[sidx]       = 0;
                        dlc->step_random[sidx]     = 0;
                        dlc->step_ratchet[sidx]    = 0;
                        dlc->steps[sidx]           = 0;
                    }
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)dlc->length; k++) if (dlc->steps[k]) { any = 1; break; }
                        dlc->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return;
                }
                if (!strcmp(q, "_copy_to")) {
                    /* tN_lL_step_S_copy_to — copy step data to dstStep; src unchanged */
                    int dstStep = clamp_i(my_atoi(val), 0, (int)dlc->length - 1);
                    if (dstStep == sidx) return;
                    if (dlc->step_note_count[sidx] == 0) return;
                    memcpy(dlc->step_notes[dstStep], dlc->step_notes[sidx], 8);
                    memcpy(dlc->note_tick_offset[dstStep], dlc->note_tick_offset[sidx], 8 * sizeof(int16_t));
                    dlc->step_note_count[dstStep] = dlc->step_note_count[sidx];
                    dlc->step_vel[dstStep]        = dlc->step_vel[sidx];
                    dlc->step_gate[dstStep]       = dlc->step_gate[sidx];
                    dlc->step_iter[dstStep]       = dlc->step_iter[sidx];
                    dlc->step_random[dstStep]     = dlc->step_random[sidx];
                    dlc->step_ratchet[dstStep]    = dlc->step_ratchet[sidx];
                    dlc->steps[dstStep]           = dlc->steps[sidx];
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)dlc->length; k++) if (dlc->steps[k]) { any = 1; break; }
                        dlc->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return;
                }
            }

            /* tN_lL_repeat_gate_toggle "step" — toggle gate bit for step 0-7 */
            if (!strcmp(p2, "_repeat_gate_toggle")) {
                int step_r = clamp_i(my_atoi(val), 0, 7);
                tr->drum_repeat_gate[lane_idx] ^= (uint8_t)(1u << step_r);
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_gate_set "mask" — directly set gate bitmask 0-255 */
            if (!strcmp(p2, "_repeat_gate_set")) {
                tr->drum_repeat_gate[lane_idx] = (uint8_t)clamp_i(my_atoi(val), 0, 255);
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_gate_len "len" — set gate cycle length 1-8 */
            if (!strcmp(p2, "_repeat_gate_len")) {
                tr->drum_repeat_gate_len[lane_idx] = (uint8_t)clamp_i(my_atoi(val), 1, 8);
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_gate_and_len "mask len" — atomically set gate bitmask and cycle length */
            if (!strcmp(p2, "_repeat_gate_and_len")) {
                const char *sp_gl = strchr(val, ' ');
                tr->drum_repeat_gate[lane_idx]     = (uint8_t)clamp_i(my_atoi(val), 0, 255);
                tr->drum_repeat_gate_len[lane_idx] = (uint8_t)clamp_i(sp_gl ? my_atoi(sp_gl + 1) : 8, 1, 8);
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_vel_scale "step pct" — set velocity scaling 0-200 for step */
            if (!strcmp(p2, "_repeat_vel_scale")) {
                const char *sp_r = val;
                while (*sp_r == ' ') sp_r++;
                int step_r = 0;
                while (*sp_r >= '0' && *sp_r <= '9') { step_r = step_r * 10 + (*sp_r++ - '0'); }
                step_r = clamp_i(step_r, 0, 7);
                while (*sp_r == ' ') sp_r++;
                int pct_r = clamp_i(my_atoi(sp_r), 0, 200);
                tr->drum_repeat_vel_scale[lane_idx][step_r] = (uint8_t)pct_r;
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_nudge "step pct" — set nudge -50..50 for step */
            if (!strcmp(p2, "_repeat_nudge")) {
                const char *sp_r = val;
                while (*sp_r == ' ') sp_r++;
                int step_r = 0;
                while (*sp_r >= '0' && *sp_r <= '9') { step_r = step_r * 10 + (*sp_r++ - '0'); }
                step_r = clamp_i(step_r, 0, 7);
                while (*sp_r == ' ') sp_r++;
                int pct_r = clamp_i(my_atoi(sp_r), -50, 50);
                tr->drum_repeat_nudge[lane_idx][step_r] = (int8_t)pct_r;
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_defaults "step" — reset vel_scale and nudge to defaults (not gate) */
            if (!strcmp(p2, "_repeat_defaults")) {
                int step_r = clamp_i(my_atoi(val), 0, 7);
                tr->drum_repeat_vel_scale[lane_idx][step_r] = 100;
                tr->drum_repeat_nudge[lane_idx][step_r]     = 0;
                inst->state_dirty = 1;
                return;
            }
            /* tN_lL_repeat_groove_reset — reset all groove params for this lane */
            if (!strcmp(p2, "_repeat_groove_reset")) {
                tr->drum_repeat_gate[lane_idx]     = 0xFF;
                tr->drum_repeat_gate_len[lane_idx] = 8;
                { int s; for (s = 0; s < 8; s++) {
                    tr->drum_repeat_vel_scale[lane_idx][s] = 100;
                    tr->drum_repeat_nudge[lane_idx][s]     = 0;
                }}
                inst->state_dirty = 1;
                return;
            }
            return;
        }

        if (!strcmp(sub, "recording")) {
            int rv = my_atoi(val);
            if (rv) {
                int snap_clip = (tr->queued_clip >= 0) ? (int)tr->queued_clip : (int)tr->active_clip;
                if (tr->pad_mode == PAD_MODE_DRUM)
                    undo_begin_drum_clip(inst, tidx, snap_clip);
                else
                    undo_begin_single(inst, tidx, snap_clip);
                /* Fresh recording session: clear pass mask so existing notes play back */
                memset(tr->live_recorded_steps, 0, 32);
                memset(tr->cc_auto_touch_frame, 0, sizeof(tr->cc_auto_touch_frame));
                /* PHASE-1: clear inbound press/release slots so a stale active=1
                 * from a prior recording session can't leak into this pass. */
                memset(inst->on_midi_press_active[tidx], 0, sizeof(inst->on_midi_press_active[tidx]));
                memset(inst->on_midi_release_active[tidx], 0, sizeof(inst->on_midi_release_active[tidx]));
                memset(inst->on_midi_drum_press_active[tidx], 0, sizeof(inst->on_midi_drum_press_active[tidx]));
                memset(inst->on_midi_drum_release_active[tidx], 0, sizeof(inst->on_midi_drum_release_active[tidx]));
                /* Reset drum-repeat per-pass accumulation detector so this pass's
                 * first fire on each lane-step is treated as new (preserves the
                 * write-once-across-passes semantic for Rpt1/Rpt2 recording). */
                memset(tr->drum_last_rec_step, 0xFF, sizeof(tr->drum_last_rec_step));
                /* Clear any tarp notes held before recording started — their note-offs
                 * can't reach live_note_off once activelyRecording=true in JS.
                 * Skip when transport is already running: TARP is already firing
                 * in steady state, and silencing it resets master_anchor=0,
                 * which jumps the step index and audibly drifts the latched
                 * chord (fix g, 1.0-tweaks). */
                if (!inst->playing) tarp_silence(inst, tr);
                /* JS sends rv=2 for adaptive-mode arms (defer to next bar +
                 * reset playhead at fire time) and rv=1 for fixed-mode arms or
                 * any non-playing start (immediate). The defer-with-reset only
                 * activates for rv==2 with transport+clip playing. */
                if (tr->clip_playing && inst->playing && rv == 2) {
                    /* Adaptive arm only makes sense in Forward playback
                     * (the "grow when near the end" heuristic is forward-biased
                     * and the playhead doesn't approach the end in Bwd/PPb at
                     * all). Force fixed-mode arm when active clip is non-Fwd. */
                    uint8_t _pd = (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip])
                        ? tr->drum_clips[tr->active_clip]->lanes[tr->active_drum_lane].clip.playback_dir
                        : tr->clips[tr->active_clip].playback_dir;
                    if (_pd != 0) {
                        tr->recording_pending_page = 1;
                        tr->recording_adaptive_arm = 0;
                    } else {
                        tr->recording_pending_page = 1;
                        tr->recording_adaptive_arm = 1;
                    }
                } else if (tr->clip_playing) {
                    /* Fixed-mode arm during playback (rv==1), or clip-playing
                     * with transport stopped: begin recording immediately. */
                    tr->recording = 1;
                } else if (tr->queued_clip >= 0) {
                    tr->record_armed = 1;
                } else {
                    tr->recording = 1;
                }
            } else {
                finalize_pending_notes(&tr->clips[tr->active_clip], tr);
                clip_clear_suppress(&tr->clips[tr->active_clip]);
                tr->recording              = 0;
                tr->record_armed           = 0;
                tr->recording_pending_page = 0;
                tr->recording_adaptive_arm = 0;
                tr->cc_touch_held = 0;
                /* Cancel any pending count-in for this track. Arming from stopped
                 * schedules a 1-bar count-in that fires recording from the render
                 * thread when it completes (seq8.c). A disarm that lands while the
                 * count-in is still counting must cancel it too — otherwise the
                 * count-in completes and re-arms recording AFTER the user disarmed
                 * (the "keeps recording after disarm" bug). */
                if ((int)inst->count_in_track == tidx) inst->count_in_ticks = 0;
            }
            return;
        }

        if (!strcmp(sub, "record_note_on")) {
            /* tN_record_note_on "p1 v1 [p2 v2 ...]"
             * JS batches all chord note-ons into one call to survive set_param coalescing.
             * PHASE-1: per-pitch tick comes from on_midi_press_tick slots (audio-thread
             * single-buffer precision); fallback is current_clip_tick at handler arrival
             * (stock-Schwung path, no slot snapshot). */
            if (!tr->recording) return;
            clip_t *cl = &tr->clips[tr->active_clip];

            uint16_t tps = cl->ticks_per_step;
            uint32_t clip_ticks = (uint32_t)cl->length * tps;
            if (clip_ticks == 0) return;
            /* current_clip_tick is already window-anchored in
             * [loop_start*tps, (loop_start+length)*tps); modulo by
             * clip_ticks would collapse it to [0, clip_ticks) and
             * drop the loop_start offset. */
            uint32_t fallback_tick = tr->current_clip_tick;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);

                while (*sp == ' ') sp++;
                int vel = SEQ_VEL;
                if (*sp >= '0' && *sp <= '9') {
                    vel = 0;
                    while (*sp >= '0' && *sp <= '9') { vel = vel * 10 + (*sp++ - '0'); }
                    vel = clamp_i(vel, 0, 127);
                }
                vel = effective_vel(tr, vel);

                /* PHASE-1: prefer the actual hardware-press tick captured by
                 * on_midi over the late current_clip_tick. Consume the slot.
                 * On patched Schwung the slot must be active — if it isn't,
                 * the press was filtered by on_midi (e.g., early-count-in
                 * window outside the last 1/8 note) and must be dropped to
                 * preserve the filter. Stock Schwung falls back to
                 * current_clip_tick (no slots written). */
                uint32_t abs_tick;
                if (inst->dsp_inbound_enabled) {
                    if (!inst->on_midi_press_active[tidx][pitch]) {
                        continue;
                    }
                    abs_tick = inst->on_midi_press_tick[tidx][pitch];
                    inst->on_midi_press_active[tidx][pitch] = 0;
                } else {
                    abs_tick = fallback_tick;
                }
                /* Per-track InQ: 9 values (0=Off..8=1/4T) via DRUM_INQ_TICKS.
                 * Shared per-track field with drum tracks (drum_inp_quant is
                 * historical name; field is per-track-type-agnostic). Global
                 * inp_quant removed in favor of per-track granularity. */
                if (tr->drum_inp_quant > 0) {
                    uint32_t qt = (uint32_t)DRUM_INQ_TICKS[tr->drum_inp_quant];
                    abs_tick = ((abs_tick + qt / 2) / qt) * qt;
                }

                /* Audio-reverse recording: in audio mode + reverse motion the
                 * snapshot tick is the audible press position. On the next
                 * playback pass, audio-reverse fires note-on at clip_tick +
                 * gate, so to play back at the press position we need to
                 * store clip_tick = press - GATE_TICKS. (GATE_TICKS is the
                 * default recording gate; if the actual release-derived gate
                 * differs the audible position shifts by that delta — a small
                 * approximation acceptable for v1.) Clamp to loop_start. */
                if (cl->playback_audio_reverse && clip_in_reverse_motion(cl)) {
                    uint32_t _ws = (uint32_t)cl->loop_start * (uint32_t)tps;
                    if (abs_tick >= _ws + (uint32_t)GATE_TICKS)
                        abs_tick -= (uint32_t)GATE_TICKS;
                    else
                        abs_tick = _ws;
                }

                /* TRACK ARP active: arp output will be recorded in tarp_fire_step.
                 * Feed raw input only into the arp held buffer. PHASE-1: on
                 * patched Schwung on_midi already called live_note_on (which
                 * feeds the arp held buffer), so skip to avoid double-feed. */
                if (tr->tarp_on && tr->pad_mode != PAD_MODE_DRUM) {
                    if (!inst->dsp_inbound_enabled)
                        live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
                    continue;
                }

                int ni = clip_insert_note(cl, abs_tick, (uint16_t)GATE_TICKS,
                                          (uint8_t)pitch, (uint8_t)vel);
                if (ni >= 0) {
                    cl->notes[ni].suppress_until_wrap = 1;
                    if (tr->rec_pending_count < 10) {
                        int ri = (int)tr->rec_pending_count;
                        tr->rec_pending[ri].pitch      = (uint8_t)pitch;
                        tr->rec_pending[ri].tick_at_on = abs_tick;
                        tr->rec_pending_count++;
                    }
                }

                /* Mirror to step arrays. Use note_step() (rounded) so sidx
                 * matches the _steps get_param reader and clip_build_steps_from_notes;
                 * truncation here previously caused step LED / hold-read divergence
                 * for notes recorded in the upper half of a step with InQ Off. */
                {
                    uint16_t sidx = note_step(abs_tick, cl->length, tps);
                    int16_t  off  = (int16_t)((int32_t)abs_tick
                                              - (int32_t)sidx * tps);
                    if (sidx < SEQ_STEPS) {
                        if (!cl->steps[sidx] && cl->step_note_count[sidx] > 0) {
                            int si;
                            for (si = 0; si < 8; si++) {
                                cl->step_notes[sidx][si] = 0;
                                cl->note_tick_offset[sidx][si] = 0;
                            }
                            cl->step_note_count[sidx] = 0;
                            cl->step_vel[sidx]  = (uint8_t)SEQ_VEL;
                            cl->step_gate[sidx] = (uint16_t)GATE_TICKS;
                        }
                        if (cl->step_note_count[sidx] < 8) {
                            int ni2 = (int)cl->step_note_count[sidx];
                            if (ni2 == 0) {
                                cl->step_vel[sidx]  = (uint8_t)vel;
                                cl->step_gate[sidx] = (uint16_t)GATE_TICKS;
                            }
                            cl->step_notes[sidx][ni2]          = (uint8_t)pitch;
                            cl->note_tick_offset[sidx][ni2]    = off;
                            cl->step_note_count[sidx]++;
                            cl->steps[sidx] = 1;
                            cl->active      = 1;
                            LRS_SET(tr, sidx);
                        }
                    }
                }
                /* Live monitoring for ROUTE_MOVE: play note immediately so the
                 * performer hears it without a separate live_notes set_param that
                 * would race/coalesce with this record_note_on call. PHASE-1:
                 * on patched Schwung on_midi already fired live_note_on on the
                 * audio thread (faster), so skip to avoid double monitor. */
                if (tr->pfx.route == ROUTE_MOVE && !inst->dsp_inbound_enabled)
                    live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
            }
            return;
        }

        if (!strcmp(sub, "record_note_off")) {
            /* tN_record_note_off "p1 [p2 ...]"
             * JS batches simultaneous chord releases into one call.
             * PHASE-1: per-pitch off_tick comes from on_midi_release_tick slot
             * (audio-thread); fallback is current_clip_tick. */
            if (!tr->recording) return;
            clip_t *cl = &tr->clips[tr->active_clip];

            uint16_t tps = cl->ticks_per_step;
            uint32_t clip_ticks = (uint32_t)cl->length * tps;
            if (clip_ticks == 0) return;
            /* Window-anchored: see record_note_on. */
            uint32_t fallback_off_tick = tr->current_clip_tick;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);

                /* PHASE-1: prefer the actual hardware-release tick. Consume. */
                uint32_t off_tick;
                if (inst->dsp_inbound_enabled && inst->on_midi_release_active[tidx][pitch]) {
                    off_tick = inst->on_midi_release_tick[tidx][pitch];
                    inst->on_midi_release_active[tidx][pitch] = 0;
                } else {
                    off_tick = fallback_off_tick;
                }

                /* TRACK ARP active: note was never written to rec_pending; update
                 * arp held buffer and let tarp_fire_step own clip recording.
                 * PHASE-1: on patched Schwung on_midi already fired live_note_off
                 * (which updates the arp held buffer), so skip. */
                if (tr->tarp_on && tr->pad_mode != PAD_MODE_DRUM) {
                    if (!inst->dsp_inbound_enabled)
                        live_note_off(inst, tr, (uint8_t)pitch);
                    continue;
                }

                /* Find matching rec_pending entry */
                int ri;
                for (ri = 0; ri < (int)tr->rec_pending_count; ri++) {
                    if (tr->rec_pending[ri].pitch == (uint8_t)pitch) break;
                }
                if (ri >= (int)tr->rec_pending_count) continue;

                uint32_t on_tick = tr->rec_pending[ri].tick_at_on;

                uint32_t gate_ticks;
                if (off_tick >= on_tick)
                    gate_ticks = off_tick - on_tick;
                else
                    gate_ticks = clip_ticks - on_tick + off_tick;
                if (gate_ticks < 1) gate_ticks = 1;
                { uint32_t gmax = (uint32_t)SEQ_STEPS * tps; if (gmax > 65535) gmax = 65535;
                  if (gate_ticks > gmax) gate_ticks = gmax; }

                /* Update matching note_t gate (scan from newest) */
                {
                    uint16_t ni2;
                    for (ni2 = (uint16_t)(cl->note_count > 0 ? cl->note_count - 1 : 0);
                         ni2 < cl->note_count; ni2--) {
                        note_t *n = &cl->notes[ni2];
                        if (n->active && n->pitch == (uint8_t)pitch
                                && n->tick == on_tick) {
                            n->gate = (uint16_t)gate_ticks;
                            break;
                        }
                        if (ni2 == 0) break;
                    }
                }

                /* Mirror gate to step arrays. Use note_step() (rounded) to match the
                 * sidx used by the record_note_on mirror (line ~3045) and the
                 * _steps get_param reader. Previously this used truncation
                 * (`on_tick / tps`), which for notes pressed in the upper half of
                 * a step caused the off mirror to update the wrong step's gate
                 * — and since the guard `cl->steps[sidx]` fails on the empty
                 * truncated step, the rounded step kept its default GATE_TICKS
                 * (~0.5 step), making the note play back too short. */
                {
                    uint16_t sidx = note_step(on_tick, cl->length, tps);
                    if (sidx < SEQ_STEPS && cl->steps[sidx])
                        cl->step_gate[sidx] = (uint16_t)gate_ticks;
                }

                /* Remove rec_pending slot */
                tr->rec_pending[ri] = tr->rec_pending[tr->rec_pending_count - 1];
                tr->rec_pending_count--;

                /* Live monitoring for ROUTE_MOVE. PHASE-1: on patched Schwung
                 * on_midi already fired live_note_off on the audio thread. */
                if (tr->pfx.route == ROUTE_MOVE && !inst->dsp_inbound_enabled)
                    live_note_off(inst, tr, (uint8_t)pitch);
            }
            return;
        }

        if (!strcmp(sub, "drum_mute_all_clear")) {
            /* tN_drum_mute_all_clear: unmute and unsolo all drum lanes. */
            tr->drum_lane_mute = 0;
            tr->drum_lane_solo = 0;
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "diq")) {
            /* tN_diq "value" — per-track drum input quantize: 0=Off, 1-8 = index into DRUM_INQ_TICKS */
            tr->drum_inp_quant = (uint8_t)clamp_i(my_atoi(val), 0, 8);
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "drum_repeat_sync")) {
            /* tN_drum_repeat_sync "value" — per-track drum repeat sync: 0=Off, 1=On */
            tr->drum_repeat_sync = (uint8_t)clamp_i(my_atoi(val), 0, 1);
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "drum_lanes_qnt")) {
            /* tN_drum_lanes_qnt "value" — set NoteFX quantize on all 32 lanes of active drum clip. */
            int v = clamp_i(my_atoi(val), 0, 100);
            drum_clip_t *dc = tr->drum_clips[tr->active_clip];
            if (!dc) return;
            int l;
            for (l = 0; l < DRUM_LANES; l++) {
                dc->lanes[l].pfx_params.quantize = v;
                drum_pfx_apply_params(&tr->drum_lane_pfx[l], &dc->lanes[l].pfx_params);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_clip_resolution")) {
            /* tN_all_lanes_clip_resolution "idx" — set resolution on all 32 drum lanes. */
            int idx = clamp_i(my_atoi(val), 0, 5);
            uint16_t new_tps = TPS_VALUES[idx];
            drum_clip_t *dc_ar = tr->drum_clips[tr->active_clip];
            if (!dc_ar) return;
            int l_ar;
            for (l_ar = 0; l_ar < DRUM_LANES; l_ar++) {
                clip_t *dlc = &dc_ar->lanes[l_ar].clip;
                uint16_t old_tps = dlc->ticks_per_step;
                if (new_tps == old_tps) continue;
                { uint32_t gmax = (uint32_t)SEQ_STEPS * new_tps;
                  if (gmax > 65535) gmax = 65535;
                  uint16_t ni;
                  for (ni = 0; ni < dlc->note_count; ni++) {
                      note_t *n = &dlc->notes[ni];
                      n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                      uint32_t ng = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                      if (ng < 1) ng = 1;
                      if (ng > gmax) ng = gmax;
                      n->gate = (uint16_t)ng;
                  }
                }
                dlc->ticks_per_step = new_tps;
                if (old_tps > 0)
                    tr->drum_tick_in_step[l_ar] =
                        (uint32_t)((uint64_t)tr->drum_tick_in_step[l_ar] * new_tps / old_tps);
                if (tr->drum_tick_in_step[l_ar] >= new_tps)
                    tr->drum_tick_in_step[l_ar] = 0;
                clip_build_steps_from_notes(dlc);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_playback_dir")) {
            /* tN_all_lanes_playback_dir "value" — set playback direction on all 32 drum lanes. */
            int v = clamp_i(my_atoi(val), 0, 3);
            drum_clip_t *dc_ad = tr->drum_clips[tr->active_clip];
            if (!dc_ad) return;
            int l_ad;
            for (l_ad = 0; l_ad < DRUM_LANES; l_ad++) {
                dc_ad->lanes[l_ad].clip.playback_dir = (uint8_t)v;
                dc_ad->lanes[l_ad].clip.pp_dir_state = initial_pp_dir((uint8_t)v);
            }
            silence_track_from_set_param(inst, tr);
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_playback_audio_reverse")) {
            /* tN_all_lanes_playback_audio_reverse "value" — set audio reverse on all 32 drum lanes. */
            int v = clamp_i(my_atoi(val), 0, 1);
            drum_clip_t *dc_av = tr->drum_clips[tr->active_clip];
            if (!dc_av) return;
            int l_av;
            for (l_av = 0; l_av < DRUM_LANES; l_av++) {
                dc_av->lanes[l_av].clip.playback_audio_reverse = (uint8_t)v;
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_beat_stretch")) {
            /* tN_all_lanes_beat_stretch "dir" — stretch/shrink all 32 drum lanes.
             * Pre-flight: if ANY lane is blocked, no-op entirely and set result=-1. */
            int dir = my_atoi(val);
            drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
            if (!dc_al) return;
            int l_al;
            /* Pre-flight: check all lanes before modifying any */
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc_pf = &dc_al->lanes[l_al].clip;
                int len_pf = (int)dlc_pf->length;
                if (dir == 1) {
                    if (len_pf * 2 > SEQ_STEPS) { inst->all_lanes_stretch_result = -1; return; }
                } else {
                    if (len_pf < 2) { inst->all_lanes_stretch_result = -1; return; }
                    /* Check note collision: two active steps would map to same compressed slot */
                    int i_pf;
                    uint8_t seen_pf[SEQ_STEPS];
                    memset(seen_pf, 0, sizeof(seen_pf));
                    for (i_pf = 0; i_pf < len_pf; i_pf++) {
                        if (dlc_pf->steps[i_pf]) {
                            int dst_pf = i_pf / 2;
                            if (seen_pf[dst_pf]) { inst->all_lanes_stretch_result = -1; return; }
                            seen_pf[dst_pf] = 1;
                        }
                    }
                }
            }
            inst->all_lanes_stretch_result = 1;
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc = &dc_al->lanes[l_al].clip;
                int len = (int)dlc->length;
                int i, ni2, new_len, any;
                uint8_t  tmp_steps[SEQ_STEPS];
                uint8_t  tmp_notes[SEQ_STEPS][8];
                uint8_t  tmp_nc[SEQ_STEPS];
                uint8_t  tmp_vel[SEQ_STEPS];
                uint16_t tmp_gate[SEQ_STEPS];
                int16_t  tmp_tick_offset[SEQ_STEPS][8];
                int gmax_bs = SEQ_STEPS * dlc->ticks_per_step; if (gmax_bs > 65535) gmax_bs = 65535;
                int off_clamp = dlc->ticks_per_step - 1;
                if (dir == 1) {
                    if (len * 2 > SEQ_STEPS) continue;
                    new_len = len * 2;
                    for (i = len - 1; i >= 1; i--) {
                        int ng = (int)dlc->step_gate[i] * 2;
                        if (ng > gmax_bs) ng = gmax_bs;
                        dlc->steps[i*2]           = dlc->steps[i];
                        memcpy(dlc->step_notes[i*2], dlc->step_notes[i], 8);
                        dlc->step_note_count[i*2] = dlc->step_note_count[i];
                        dlc->step_vel[i*2]        = dlc->step_vel[i];
                        dlc->step_gate[i*2]       = (uint16_t)ng;
                        for (ni2 = 0; ni2 < 8; ni2++) {
                            int nt = (int)dlc->note_tick_offset[i][ni2] * 2;
                            if (nt > off_clamp) nt = off_clamp; else if (nt < -off_clamp) nt = -off_clamp;
                            dlc->note_tick_offset[i*2][ni2] = (int16_t)nt;
                        }
                        dlc->steps[i] = 0;
                    }
                    { int ng = (int)dlc->step_gate[0] * 2;
                      if (ng > gmax_bs) ng = gmax_bs;
                      dlc->step_gate[0] = (uint16_t)ng;
                      for (ni2 = 0; ni2 < 8; ni2++) {
                          int nt = (int)dlc->note_tick_offset[0][ni2] * 2;
                          if (nt > off_clamp) nt = off_clamp; else if (nt < -off_clamp) nt = -off_clamp;
                          dlc->note_tick_offset[0][ni2] = (int16_t)nt;
                      }
                    }
                    for (i = 1; i < new_len; i += 2) {
                        dlc->steps[i] = 0;
                        memset(dlc->step_notes[i], 0, 8);
                        dlc->step_note_count[i] = 0;
                        dlc->step_vel[i]        = SEQ_VEL;
                        dlc->step_gate[i]       = GATE_TICKS;
                        memset(dlc->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                    }
                    dlc->length = (uint16_t)new_len;
                    dlc->stretch_exp++;
                } else {
                    if (len < 2) continue;
                    { uint8_t seen[SEQ_STEPS];
                      memset(seen, 0, sizeof(seen));
                      int blocked = 0;
                      for (i = 0; i < len; i++) {
                          if (dlc->steps[i]) {
                              int dst = i / 2;
                              if (seen[dst]) { blocked = 1; break; }
                              seen[dst] = 1;
                          }
                      }
                      if (blocked) continue;
                    }
                    new_len = len / 2;
                    memset(tmp_steps, 0, sizeof(tmp_steps));
                    for (i = 0; i < SEQ_STEPS; i++) {
                        memset(tmp_notes[i], 0, 8);
                        tmp_nc[i]   = 0;
                        tmp_vel[i]  = SEQ_VEL;
                        tmp_gate[i] = GATE_TICKS;
                        memset(tmp_tick_offset[i], 0, 8 * sizeof(int16_t));
                    }
                    for (i = 0; i < len; i++) {
                        if (dlc->steps[i]) {
                            int dst = i / 2;
                            if (!tmp_steps[dst]) {
                                int ng = ((int)dlc->step_gate[i] + 1) / 2;
                                if (ng < 1) ng = 1;
                                tmp_steps[dst] = 1;
                                memcpy(tmp_notes[dst], dlc->step_notes[i], 8);
                                tmp_nc[dst]   = dlc->step_note_count[i];
                                tmp_vel[dst]  = dlc->step_vel[i];
                                tmp_gate[dst] = (uint16_t)ng;
                                for (ni2 = 0; ni2 < 8; ni2++) {
                                    int nt = (int)dlc->note_tick_offset[i][ni2] / 2;
                                    tmp_tick_offset[dst][ni2] = (int16_t)nt;
                                }
                            }
                        }
                    }
                    for (i = 0; i < len; i++) {
                        if (!dlc->steps[i] && dlc->step_note_count[i] > 0) {
                            int dst = i / 2;
                            if (tmp_nc[dst] == 0) {
                                int ng = ((int)dlc->step_gate[i] + 1) / 2;
                                if (ng < 1) ng = 1;
                                memcpy(tmp_notes[dst], dlc->step_notes[i], 8);
                                tmp_nc[dst]   = dlc->step_note_count[i];
                                tmp_vel[dst]  = dlc->step_vel[i];
                                tmp_gate[dst] = (uint16_t)ng;
                                for (ni2 = 0; ni2 < 8; ni2++) {
                                    int nt = (int)dlc->note_tick_offset[i][ni2] / 2;
                                    tmp_tick_offset[dst][ni2] = (int16_t)nt;
                                }
                            }
                        }
                    }
                    memcpy(dlc->steps,           tmp_steps,       sizeof(tmp_steps));
                    memcpy(dlc->step_notes,      tmp_notes,       sizeof(tmp_notes));
                    memcpy(dlc->step_note_count, tmp_nc,          sizeof(tmp_nc));
                    memcpy(dlc->step_vel,        tmp_vel,         sizeof(tmp_vel));
                    memcpy(dlc->step_gate,       tmp_gate,        sizeof(tmp_gate));
                    memcpy(dlc->note_tick_offset, tmp_tick_offset, sizeof(tmp_tick_offset));
                    dlc->length = (uint16_t)new_len;
                    dlc->stretch_exp--;
                }
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[l_al] < dlc->loop_start
                            || tr->drum_current_step[l_al] >= _le)
                        tr->drum_current_step[l_al] = dlc->loop_start;
                }
                any = 0;
                for (i = 0; i < (int)dlc->length; i++)
                    if (dlc->steps[i]) { any = 1; break; }
                dlc->active = (uint8_t)any;
                clip_migrate_to_notes(dlc);
                /* Suppress notes already passed this loop pass so they don't double-fire
                 * (stretch moves notes to later ticks; without this they fire twice). */
                if (tr->clip_playing) {
                    uint32_t cct = (uint32_t)tr->drum_current_step[l_al]
                                   * (uint32_t)dlc->ticks_per_step
                                   + tr->drum_tick_in_step[l_al];
                    int qnt = dc_al->lanes[l_al].pfx_params.quantize;
                    uint16_t ni2;
                    for (ni2 = 0; ni2 < dlc->note_count; ni2++) {
                        note_t *n = &dlc->notes[ni2];
                        if (effective_note_tick(n, dlc, qnt) < cct)
                            n->suppress_until_wrap = 1;
                    }
                }
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_clock_shift")) {
            /* tN_all_lanes_clock_shift "dir" — rotate all 32 drum lanes by one step. */
            int dir = my_atoi(val);
            drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
            if (!dc_al) return;
            int l_al;
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc = &dc_al->lanes[l_al].clip;
                int len = (int)dlc->length;
                if (len < 2) continue;
                uint8_t tmp_s, tmp_nc2, tmp_ns[8], tmp_v;
                uint16_t tmp_g;
                int16_t tmp_toff[8];
                if (dir == 1) {
                    tmp_s  = dlc->steps[len-1];
                    memcpy(tmp_ns, dlc->step_notes[len-1], 8);
                    tmp_nc2 = dlc->step_note_count[len-1];
                    tmp_v  = dlc->step_vel[len-1];
                    tmp_g  = dlc->step_gate[len-1];
                    memcpy(tmp_toff, dlc->note_tick_offset[len-1], 8 * sizeof(int16_t));
                    memmove(&dlc->steps[1],              &dlc->steps[0],              (size_t)(len-1));
                    memmove(&dlc->step_notes[1][0],      &dlc->step_notes[0][0],      (size_t)(len-1) * 8);
                    memmove(&dlc->step_note_count[1],    &dlc->step_note_count[0],    (size_t)(len-1));
                    memmove(&dlc->step_vel[1],           &dlc->step_vel[0],           (size_t)(len-1));
                    memmove(&dlc->step_gate[1],          &dlc->step_gate[0],          (size_t)(len-1) * 2);
                    memmove(&dlc->note_tick_offset[1][0], &dlc->note_tick_offset[0][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                    dlc->steps[0] = tmp_s;
                    memcpy(dlc->step_notes[0], tmp_ns, 8);
                    dlc->step_note_count[0] = tmp_nc2;
                    dlc->step_vel[0] = tmp_v;
                    dlc->step_gate[0] = tmp_g;
                    memcpy(dlc->note_tick_offset[0], tmp_toff, 8 * sizeof(int16_t));
                    dlc->clock_shift_pos = (uint16_t)((dlc->clock_shift_pos + 1) % (uint16_t)len);
                } else {
                    tmp_s  = dlc->steps[0];
                    memcpy(tmp_ns, dlc->step_notes[0], 8);
                    tmp_nc2 = dlc->step_note_count[0];
                    tmp_v  = dlc->step_vel[0];
                    tmp_g  = dlc->step_gate[0];
                    memcpy(tmp_toff, dlc->note_tick_offset[0], 8 * sizeof(int16_t));
                    memmove(&dlc->steps[0],              &dlc->steps[1],              (size_t)(len-1));
                    memmove(&dlc->step_notes[0][0],      &dlc->step_notes[1][0],      (size_t)(len-1) * 8);
                    memmove(&dlc->step_note_count[0],    &dlc->step_note_count[1],    (size_t)(len-1));
                    memmove(&dlc->step_vel[0],           &dlc->step_vel[1],           (size_t)(len-1));
                    memmove(&dlc->step_gate[0],          &dlc->step_gate[1],          (size_t)(len-1) * 2);
                    memmove(&dlc->note_tick_offset[0][0], &dlc->note_tick_offset[1][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                    dlc->steps[len-1] = tmp_s;
                    memcpy(dlc->step_notes[len-1], tmp_ns, 8);
                    dlc->step_note_count[len-1] = tmp_nc2;
                    dlc->step_vel[len-1] = tmp_v;
                    dlc->step_gate[len-1] = tmp_g;
                    memcpy(dlc->note_tick_offset[len-1], tmp_toff, 8 * sizeof(int16_t));
                    dlc->clock_shift_pos = (uint16_t)((dlc->clock_shift_pos + (uint16_t)(len-1)) % (uint16_t)len);
                }
                { int i2, any = 0;
                  for (i2 = 0; i2 < len; i2++) if (dlc->steps[i2]) { any = 1; break; }
                  dlc->active = (uint8_t)any;
                }
                clip_migrate_to_notes(dlc);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_nudge")) {
            /* tN_all_lanes_nudge "dir" — nudge all 32 drum lanes; dir=0 resets nudge_pos. */
            int dir = my_atoi(val);
            drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
            if (!dc_al) return;
            int l_al;
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc = &dc_al->lanes[l_al].clip;
                if (dir == 0) { dlc->nudge_pos = 0; continue; }
                if (dir != 1 && dir != -1) continue;
                int len = (int)dlc->length;
                if (len < 1) continue;
                int tps = (int)dlc->ticks_per_step;
                int midpoint = tps / 2;
                struct { int16_t dst, dst_off; uint8_t pitch, vel, active; uint16_t gate; } cross[512];
                int ncross = 0;
                int s, ni, wi;
                for (s = 0; s < len; s++) {
                    if (dlc->step_note_count[s] == 0) continue;
                    wi = 0;
                    for (ni = 0; ni < (int)dlc->step_note_count[s]; ni++) {
                        int new_off = (int)dlc->note_tick_offset[s][ni] + dir;
                        if (new_off >= midpoint) {
                            if (ncross < 512) {
                                cross[ncross].dst     = (int16_t)((s + 1) % len);
                                cross[ncross].dst_off = (int16_t)(new_off - tps);
                                cross[ncross].pitch   = dlc->step_notes[s][ni];
                                cross[ncross].vel     = dlc->step_vel[s];
                                cross[ncross].gate    = dlc->step_gate[s];
                                cross[ncross].active  = dlc->steps[s];
                                ncross++;
                            }
                        } else if (new_off < -midpoint) {
                            if (ncross < 512) {
                                cross[ncross].dst     = (int16_t)((s - 1 + len) % len);
                                cross[ncross].dst_off = (int16_t)(new_off + tps);
                                cross[ncross].pitch   = dlc->step_notes[s][ni];
                                cross[ncross].vel     = dlc->step_vel[s];
                                cross[ncross].gate    = dlc->step_gate[s];
                                cross[ncross].active  = dlc->steps[s];
                                ncross++;
                            }
                        } else {
                            dlc->step_notes[s][wi]       = dlc->step_notes[s][ni];
                            dlc->note_tick_offset[s][wi] = (int16_t)new_off;
                            wi++;
                        }
                    }
                    for (ni = wi; ni < (int)dlc->step_note_count[s]; ni++) {
                        dlc->step_notes[s][ni]       = 0;
                        dlc->note_tick_offset[s][ni] = 0;
                    }
                    dlc->step_note_count[s] = (uint8_t)wi;
                    if (wi == 0) {
                        dlc->steps[s]     = 0;
                        dlc->step_vel[s]  = (uint8_t)SEQ_VEL;
                        dlc->step_gate[s] = (uint16_t)GATE_TICKS;
                    }
                }
                { int ci;
                  for (ci = 0; ci < ncross; ci++) {
                      int dst = (int)cross[ci].dst;
                      if (dlc->step_note_count[dst] >= 8) continue;
                      int slot = (int)dlc->step_note_count[dst];
                      dlc->step_notes[dst][slot]       = cross[ci].pitch;
                      dlc->note_tick_offset[dst][slot] = cross[ci].dst_off;
                      if (slot == 0) {
                          dlc->step_vel[dst]  = cross[ci].vel;
                          dlc->step_gate[dst] = cross[ci].gate;
                      }
                      if (cross[ci].active) dlc->steps[dst] = 1;
                      dlc->step_note_count[dst]++;
                  }
                }
                { int any2 = 0;
                  for (s = 0; s < len; s++) if (dlc->steps[s]) { any2 = 1; break; }
                  dlc->active = (uint8_t)any2;
                }
                dlc->nudge_pos += (int16_t)dir;
                clip_migrate_to_notes(dlc);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_length")) {
            /* tN_all_lanes_length "steps" — set clip length on all 32 drum lanes.
             * Per-lane clamp respects each lane's own loop_start; re-anchor to
             * global tick during playback so cross-lane phase stays in sync. */
            int reqlen = my_atoi(val);
            drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
            if (!dc_al) return;
            int l_al;
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc = &dc_al->lanes[l_al].clip;
                int max_len = SEQ_STEPS - (int)dlc->loop_start;
                if (max_len < 1) max_len = 1;
                int newlen = clamp_i(reqlen, 1, max_len);
                dlc->length = (uint16_t)newlen;
                uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
                if (tr->drum_current_step[l_al] < dlc->loop_start
                        || tr->drum_current_step[l_al] >= le)
                    tr->drum_current_step[l_al] = dlc->loop_start;
                if (inst->playing)
                    drum_lane_anchor_playhead(inst, tr, l_al, dlc);
                clip_migrate_to_notes(dlc);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_loop_set")) {
            /* tN_all_lanes_loop_set "packed" — atomic loop window write across all
             * 32 drum lanes of the active drum clip. Mirrors tN_lL_loop_set
             * semantics on every lane. */
            long packed = 0;
            const char *vp = val;
            while (*vp == ' ') vp++;
            while (*vp >= '0' && *vp <= '9') packed = packed * 10 + (*vp++ - '0');
            int ls  = (int)((packed >> 16) & 0xFFFF);
            int len = (int)(packed & 0xFFFF);
            if (len < 1) len = 1;
            if (ls  < 0) ls  = 0;
            if (ls > SEQ_STEPS - 1) ls = SEQ_STEPS - 1;
            if (ls + len > SEQ_STEPS) len = SEQ_STEPS - ls;
            drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
            if (!dc_al) return;
            int l_al;
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc = &dc_al->lanes[l_al].clip;
                dlc->loop_start = (uint16_t)ls;
                dlc->length     = (uint16_t)len;
                uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
                if (tr->drum_current_step[l_al] < dlc->loop_start
                        || tr->drum_current_step[l_al] >= le)
                    tr->drum_current_step[l_al] = dlc->loop_start;
                if (inst->playing)
                    drum_lane_anchor_playhead(inst, tr, l_al, dlc);
                clip_migrate_to_notes(dlc);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "all_lanes_double_fill")) {
            /* tN_all_lanes_double_fill — double-and-fill all 32 drum lanes. */
            drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
            if (!dc_al) return;
            int l_al, i;
            undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
            for (l_al = 0; l_al < DRUM_LANES; l_al++) {
                clip_t *dlc = &dc_al->lanes[l_al].clip;
                int len = (int)dlc->length;
                if (len * 2 > SEQ_STEPS) continue;
                for (i = 0; i < len; i++) {
                    dlc->steps[len + i]           = dlc->steps[i];
                    memcpy(dlc->step_notes[len + i], dlc->step_notes[i], 8);
                    dlc->step_note_count[len + i] = dlc->step_note_count[i];
                    dlc->step_vel[len + i]        = dlc->step_vel[i];
                    dlc->step_gate[len + i]       = dlc->step_gate[i];
                    memcpy(dlc->note_tick_offset[len + i], dlc->note_tick_offset[i], 8 * sizeof(int16_t));
                }
                dlc->length = (uint16_t)(len * 2);
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[l_al] < dlc->loop_start
                            || tr->drum_current_step[l_al] >= _le)
                        tr->drum_current_step[l_al] = dlc->loop_start;
                }
                clip_migrate_to_notes(dlc);
            }
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "active_drum_lane")) {
            /* Bundle 2A: JS mirror of S.activeDrumLane[t]. Pushed at every
             * mutation site in ui.js (8 sites) + init + sidecar restore.
             * Read by on_midi.drum_pad_event for vel-pad preview. */
            int lane_adl = atoi(val);
            tr->active_drum_lane = (uint8_t)clamp_i(lane_adl, 0, DRUM_LANES - 1);
            return;
        }

        if (!strcmp(sub, "delete_held")) {
            /* Phase 1 / Bundle 2C-Rpt2: Delete-held edge push. JS sends
             * a SINGLE push (carrier key shape is tN_delete_held — any
             * tN works) on every Delete CC edge. Writes to the GLOBAL
             * inst->delete_held since Delete is a global modifier, not
             * per-track. Earlier fan-out of 8 calls (one per track)
             * coalesced — only the last N reached DSP. drum_pad_event
             * reads inst->delete_held to bail before classifying;
             * mirrors JS's "bail on Delete-held" pad-handler branches. */
            inst->delete_held = (uint8_t)(my_atoi(val) ? 1 : 0);
            return;
        }

        if (!strcmp(sub, "drum_lane_page")) {
            /* Phase 1 / Bundle 2C-Rpt2: JS mirror of S.drumLanePage[t].
             * Used by drum_pad_event to translate left-half padIdx →
             * absolute drum lane index for Rpt2 lane-pad classification
             * and for Rpt1 lane-swap-while-holding. Pushed by JS on every
             * page change (Up/Down arrow on drum track + init + sidecar
             * restore). */
            int page_dlp = atoi(val);
            tr->drum_lane_page = (uint8_t)clamp_i(page_dlp, 0, (DRUM_LANES + 15) / 16 - 1);
            return;
        }

        if (!strcmp(sub, "drum_perform_mode")) {
            /* Bundle 2A: JS mirror of S.drumPerformMode[t] (0=NORMAL,
             * 1=Rpt1, 2=Rpt2). Pushed via setDrumPerformMode helper
             * (2 mutation sites in ui.js). on_midi.drum_pad_event gates
             * the vel-zone preview branch on this — Rpt modes leave the
             * right-pad classifier to JS (Bundle 2C will move it). */
            int mode_dpm = atoi(val);
            tr->drum_perform_mode = (uint8_t)clamp_i(mode_dpm, 0, 2);
            return;
        }

        if (!strcmp(sub, "drum_repeat_start")) {
            /* tN_drum_repeat_start "lane rate_idx vel" — activate repeat for a drum lane.
             * Phase 1 / Bundle 2C: delegates to drum_repeat_start_internal so the
             * on_midi path (drum_pad_event) and set_param path share one body. */
            const char *sp = val;
            while (*sp == ' ') sp++;
            int lane_r = 0;
            while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
            while (*sp == ' ') sp++;
            int rate_r = 0;
            while (*sp >= '0' && *sp <= '9') { rate_r = rate_r * 10 + (*sp++ - '0'); }
            while (*sp == ' ') sp++;
            int vel_r = 100;
            if (*sp >= '0' && *sp <= '9') {
                vel_r = 0;
                while (*sp >= '0' && *sp <= '9') { vel_r = vel_r * 10 + (*sp++ - '0'); }
            }
            drum_repeat_start_internal(inst, tr, lane_r, rate_r, vel_r);
            return;
        }

        if (!strcmp(sub, "drum_repeat_vel")) {
            /* tN_drum_repeat_vel "vel" — update repeat velocity from pad pressure */
            tr->drum_repeat_vel = (uint8_t)clamp_i(my_atoi(val), 1, 127);
            return;
        }

        if (!strcmp(sub, "drum_repeat_stop")) {
            /* tN_drum_repeat_stop — deactivate repeat; also clears latch mirror */
            drum_repeat_stop_internal(tr);
            return;
        }

        if (!strcmp(sub, "drum_repeat_lane")) {
            /* tN_drum_repeat_lane "lane" — switch active lane without resetting phase/step */
            drum_repeat_lane_internal(tr, my_atoi(val));
            return;
        }

        if (!strcmp(sub, "drum_repeat_latched")) {
            /* Phase 1 / Bundle 2C: JS one-shot edge push. Set to 1 immediately
             * after firing tN_drum_repeat_start when Loop is held at press time.
             * drum_repeat_start_internal clears this back to 0 on every start,
             * so JS never needs to push the 0-edge — set_param ordering across
             * latched/unlatched transitions is self-cleaning. drum_pad_event
             * reads this to detect "re-tap of latched pad = stop NOW" on the
             * audio thread, avoiding the JS-tick race that would otherwise
             * fire one extra repeat at fast rates. */
            tr->drum_repeat_latched = (uint8_t)(my_atoi(val) ? 1 : 0);
            return;
        }

        if (!strcmp(sub, "drum_repeat2_lane_on")) {
            /* tN_drum_repeat2_lane_on "lane vel" — add lane; uses lane's stored rate.
             * Phase 1 / Bundle 2C-Rpt2: delegates to drum_repeat2_lane_on_internal
             * so the on_midi path (drum_pad_event) and set_param path share one body. */
            const char *sp = val;
            while (*sp == ' ') sp++;
            int lane_r = 0;
            while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
            while (*sp == ' ') sp++;
            int vel_r = 100;
            if (*sp >= '0' && *sp <= '9') {
                vel_r = 0;
                while (*sp >= '0' && *sp <= '9') { vel_r = vel_r * 10 + (*sp++ - '0'); }
            }
            drum_repeat2_lane_on_internal(inst, tr, lane_r, vel_r);
            return;
        }

        if (!strcmp(sub, "drum_repeat2_lane_off")) {
            /* tN_drum_repeat2_lane_off "lane" — remove lane from active+pending+latched bitmasks */
            drum_repeat2_lane_off_internal(tr, my_atoi(val));
            return;
        }

        if (!strcmp(sub, "drum_repeat2_rate")) {
            /* tN_drum_repeat2_rate "lane rate_idx" — set per-lane rate */
            const char *sp = val;
            while (*sp == ' ') sp++;
            int lane_r = 0;
            while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
            while (*sp == ' ') sp++;
            int rate_r = 0;
            while (*sp >= '0' && *sp <= '9') { rate_r = rate_r * 10 + (*sp++ - '0'); }
            drum_repeat2_rate_internal(tr, lane_r, rate_r);
            return;
        }

        if (!strcmp(sub, "drum_repeat2_latch_held")) {
            /* Phase 1 / Bundle 2C-Rpt2: atomic "latch every currently
             * held/pending lane." JS fires this when Loop is tapped while
             * lanes are held (replaces a per-lane push loop that was
             * coalescing on its shared key). DSP-side OR of active+pending
             * into latched bitmask captures every engaged lane regardless
             * of InQ boundary state. */
            tr->drum_repeat2_latched_lanes |= tr->drum_repeat2_active;
            tr->drum_repeat2_latched_lanes |= tr->drum_repeat2_pending;
            return;
        }

        if (!strcmp(sub, "drum_repeat2_lane_latched")) {
            /* Phase 1 / Bundle 2C-Rpt2: JS one-shot per-lane edge push,
             * "<lane> <0|1>". JS fires the 1-edge immediately after a
             * Loop-held lane-pad press. drum_repeat2_lane_on_internal
             * clears the lane's bit on every lane-on so JS doesn't push
             * 0-edges. drum_pad_event reads this bitmask on lane-pad
             * press to detect "re-tap of latched lane = lane_off NOW"
             * synchronously on the audio thread, closing the JS-tick
             * race that could otherwise fire extra repeats at fast rates. */
            const char *sp = val;
            while (*sp == ' ') sp++;
            int lane_r = 0;
            while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
            lane_r = clamp_i(lane_r, 0, DRUM_LANES - 1);
            while (*sp == ' ') sp++;
            int on = (*sp >= '0' && *sp <= '9') ? my_atoi(sp) : 0;
            if (on)
                tr->drum_repeat2_latched_lanes |=  (1u << (unsigned)lane_r);
            else
                tr->drum_repeat2_latched_lanes &= ~(1u << (unsigned)lane_r);
            return;
        }

        if (!strcmp(sub, "drum_repeat2_stop")) {
            /* tN_drum_repeat2_stop — clear all active Rpt2 lanes (and any pending).
             * Bundle 2C-Rpt2: also clears the latched-lanes bitmask. */
            tr->drum_repeat2_active        = 0;
            tr->drum_repeat2_pending       = 0;
            tr->drum_repeat2_latched_lanes = 0;
            return;
        }

        if (!strcmp(sub, "drum_repeat2_vel")) {
            /* tN_drum_repeat2_vel "lane vel" — update per-lane velocity (aftertouch) */
            const char *sp = val;
            while (*sp == ' ') sp++;
            int lane_r = 0;
            while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
            lane_r = clamp_i(lane_r, 0, DRUM_LANES - 1);
            while (*sp == ' ') sp++;
            int vel_r = 100;
            if (*sp >= '0' && *sp <= '9') {
                vel_r = 0;
                while (*sp >= '0' && *sp <= '9') { vel_r = vel_r * 10 + (*sp++ - '0'); }
            }
            tr->drum_repeat2_vel[lane_r] = (uint8_t)clamp_i(vel_r, 1, 127);
            return;
        }

        if (!strcmp(sub, "drum_record_note_on")) {
            /* tN_drum_record_note_on "p1 v1 [p2 v2 ...]"
             * JS batches all queued drum note-ons for the recordArmedTrack into
             * one call so a chord-press lands in DSP within a single audio
             * buffer (previously trickled one-per-tick via .shift()).
             * Each pitch routes to the drum lane whose midi_note matches and
             * inserts a step hit at that lane's current playback position.
             * Gate initially GATE_TICKS; updated to actual hold time on
             * drum_record_note_off. */
            if (!tr->recording) return;
            {
                int ac = (int)tr->active_clip;
                drum_clip_t *dc = tr->drum_clips[ac];
                if (!dc) return;
                const char *sp = val;
                while (*sp) {
                    while (*sp == ' ') sp++;
                    if (!*sp) break;
                    int pitch = 0;
                    while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                    pitch = clamp_i(pitch, 0, 127);
                    while (*sp == ' ') sp++;
                    int vel = SEQ_VEL;
                    if (*sp >= '0' && *sp <= '9') {
                        vel = 0;
                        while (*sp >= '0' && *sp <= '9') { vel = vel * 10 + (*sp++ - '0'); }
                    }
                    vel = clamp_i(vel, 1, 127);
                    /* Find lane by matching midi_note */
                    int lane = -1;
                    { int l; for (l = 0; l < DRUM_LANES; l++) {
                        if (dc->lanes[l].midi_note == (uint8_t)pitch) { lane = l; break; }
                    }}
                    if (lane >= 0) {
                    clip_t   *dlc  = &dc->lanes[lane].clip;
                    /* PHASE-1: prefer the audio-thread press snapshot for this
                     * lane's (step, tick_in_step). On patched Schwung the slot
                     * must be active — if it isn't, the press was filtered by
                     * on_midi (e.g., outside the preroll capture window). Drop
                     * it to preserve the filter. Stock Schwung uses the live
                     * drum playhead at handler arrival. */
                    uint16_t base_step;
                    int16_t  base_off;
                    if (inst->dsp_inbound_enabled) {
                        if (!inst->on_midi_drum_press_active[tidx][lane]) {
                            continue;  /* drop filtered preroll press; sp already past this entry */
                        }
                        base_step = inst->on_midi_drum_press_step[tidx][lane];
                        base_off  = inst->on_midi_drum_press_off[tidx][lane];
                        inst->on_midi_drum_press_active[tidx][lane] = 0;
                    } else {
                        base_step = tr->drum_current_step[lane];
                        base_off  = (int16_t)tr->drum_tick_in_step[lane];
                    }
                    uint16_t step = base_step;
                    int16_t  off  = base_off;
                    uint8_t  diq  = tr->drum_inp_quant;
                    /* Window-aware wrap: base_step lives in
                     * [loop_start, loop_start+length); wrapping past the
                     * window end must return to loop_start, not 0. */
                    uint16_t _we = (uint16_t)(dlc->loop_start + dlc->length);
                    if (off >= (int16_t)(TICKS_PER_STEP / 2)) {
                        uint16_t ns = (uint16_t)(step + 1);
                        if (ns >= _we) ns = dlc->loop_start;
                        step = ns;
                        off -= (int16_t)TICKS_PER_STEP;
                    }

                    if (diq > 0) {
                        /* Quantize global tick position so InQ values coarser
                         * than 1/16 (qt > TICKS_PER_STEP) snap to multi-step
                         * boundaries instead of collapsing to the current step
                         * (the prior per-step-only math always produced sn=0
                         * for qt > TICKS_PER_STEP). */
                        int qt = (int)DRUM_INQ_TICKS[diq];
                        int abs_tick = (int)base_step * (int)TICKS_PER_STEP + (int)base_off;
                        int sn_abs = ((abs_tick + qt / 2) / qt) * qt;
                        int sn_step = sn_abs / (int)TICKS_PER_STEP;
                        int sn_off  = sn_abs - sn_step * (int)TICKS_PER_STEP;
                        /* Window wrap: if quantize lands outside the loop
                         * window, fall back to loop_start step boundary. */
                        if (sn_step < (int)dlc->loop_start || sn_step >= (int)_we) {
                            sn_step = (int)dlc->loop_start;
                            sn_off  = 0;
                        }
                        step = (uint16_t)sn_step;
                        off  = (int16_t)sn_off;
                    }
                    if (step < _we && dlc->step_note_count[step] == 0) {
                        dlc->step_notes[step][0]       = (uint8_t)pitch;
                        dlc->step_note_count[step]     = 1;
                        dlc->step_vel[step]            = (uint8_t)vel;
                        dlc->step_gate[step]           = (uint16_t)GATE_TICKS;
                        /* Timing snap: per-track InQ takes priority over global inp_quant.
                         * InQ: nearest quant boundary within step (rounds to nearest multiple).
                         * global inp_quant ON: snap to step boundary (offset=0).
                         * Both Off: capture raw sub-step timing. */
                        dlc->note_tick_offset[step][0] = off;
                        dlc->steps[step]               = 1;
                        dlc->active                    = 1;
                        clip_migrate_to_notes(dlc);
                        /* Suppress sequencer replay of freshly recorded note until clip wraps — prevents double-trigger */
                        { uint16_t ni3;
                          uint32_t rec_tick = (uint32_t)step * dlc->ticks_per_step
                                              + (uint32_t)dlc->note_tick_offset[step][0];
                          for (ni3 = 0; ni3 < dlc->note_count; ni3++) {
                              if (dlc->notes[ni3].tick == rec_tick)
                                  dlc->notes[ni3].suppress_until_wrap = 1;
                          }
                        }
                        /* Store pending state so drum_record_note_off can close the gate.
                         * PHASE-1: use the snapshot (base_step, base_off) so the gate
                         * compares like-for-like against the release snapshot. */
                        tr->drum_rec_pending_tick[lane]   = (uint32_t)base_step * TICKS_PER_STEP
                                                            + (uint32_t)base_off;
                        tr->drum_rec_pending_step[lane]   = step;
                        tr->drum_rec_pending_active[lane] = 1;
                    }
                    /* Live monitoring for ROUTE_MOVE: play note immediately so the
                     * performer hears it without a separate live_notes set_param that
                     * would race/coalesce with this drum_record_note_on call. Mirrors
                     * the melodic record_note_on pattern. PHASE-1: on patched
                     * Schwung on_midi already fired live_note_on on the audio
                     * thread (faster), so skip to avoid double monitor. */
                    if (tr->pfx.route == ROUTE_MOVE && !inst->dsp_inbound_enabled)
                        live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
                    }
                }
            }
            return;
        }

        if (!strcmp(sub, "drum_record_note_off")) {
            /* tN_drum_record_note_off "p1 [p2 ...]"
             * JS batches all queued drum note-offs for the recordArmedTrack into
             * one call. Each pitch closes the gate for the last
             * drum_record_note_on on the matching lane, computing actual hold
             * duration from elapsed render ticks. */
            if (!tr->recording) return;
            {
                int ac2    = (int)tr->active_clip;
                drum_clip_t *dc2 = tr->drum_clips[ac2];
                if (!dc2) return;
                const char *sp2 = val;
                while (*sp2) {
                    while (*sp2 == ' ') sp2++;
                    if (!*sp2) break;
                    int pitch2 = 0;
                    while (*sp2 >= '0' && *sp2 <= '9') { pitch2 = pitch2 * 10 + (*sp2++ - '0'); }
                    pitch2 = clamp_i(pitch2, 0, 127);
                    int lane2  = -1;
                    { int l2; for (l2 = 0; l2 < DRUM_LANES; l2++) {
                        if (dc2->lanes[l2].midi_note == (uint8_t)pitch2) { lane2 = l2; break; }
                    }}
                    if (lane2 >= 0 && tr->drum_rec_pending_active[lane2]) {
                        clip_t   *dlc2     = &dc2->lanes[lane2].clip;
                        uint16_t  step2    = tr->drum_rec_pending_step[lane2];
                        uint32_t  tps2     = TICKS_PER_STEP;
                        uint32_t  on_tick  = tr->drum_rec_pending_tick[lane2];
                        /* PHASE-1: prefer the audio-thread release snapshot. Consume. */
                        uint32_t  off_tick;
                        if (inst->dsp_inbound_enabled && inst->on_midi_drum_release_active[tidx][lane2]) {
                            off_tick = (uint32_t)inst->on_midi_drum_release_step[tidx][lane2] * tps2
                                       + (uint32_t)inst->on_midi_drum_release_off[tidx][lane2];
                            inst->on_midi_drum_release_active[tidx][lane2] = 0;
                        } else {
                            off_tick = (uint32_t)tr->drum_current_step[lane2] * tps2
                                       + tr->drum_tick_in_step[lane2];
                        }
                        uint32_t  clip_ticks = (uint32_t)dlc2->length * tps2;
                        uint32_t  gate;
                        if (off_tick >= on_tick) gate = off_tick - on_tick;
                        else                     gate = clip_ticks - on_tick + off_tick;
                        if (gate < 1)          gate = 1;
                        if (gate > clip_ticks) gate = clip_ticks;
                        if (step2 < (uint16_t)(dlc2->loop_start + dlc2->length)) {
                            dlc2->step_gate[step2] = (uint16_t)gate;
                            clip_migrate_to_notes(dlc2);
                        }
                        tr->drum_rec_pending_active[lane2] = 0;
                    }
                }
            }
            return;
        }

        if (!strcmp(sub, "live_notes")) {
            /* tN_live_notes "off p ... on p v ... [off p|on p v]..."
             * Batched live note events processed left-to-right. JS queues all
             * note events from one JS turn into pendingLiveNotes and drains
             * them into a single tN_live_notes payload via a microtask at
             * end-of-turn, so chord-press survives the host's same-buffer
             * set_param coalescing (which is per-buffer last-wins regardless
             * of key — distinct keys do NOT defeat it).
             * Routes through pfx_note_on/pfx_note_off_imm so play effects apply.
             *
             * When dsp_inbound_enabled is set, on_midi already dispatched
             * the pad event on the audio thread — skip the JS fallback to
             * avoid double-triggering. JS always queues live notes as a
             * fallback for when the padmap push didn't reach DSP (the
             * sentinel exists but on_midi can't dispatch without a valid
             * pad_note_map). */
            if (inst->dsp_inbound_enabled) return;
            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;
                int is_on = -1;
                if (sp[0]=='o' && sp[1]=='n' && (sp[2]==' '||!sp[2]))
                    { is_on = 1; sp += 2; }
                else if (sp[0]=='o' && sp[1]=='f' && sp[2]=='f' && (sp[3]==' '||!sp[3]))
                    { is_on = 0; sp += 3; }
                else break;
                while (*sp == ' ') sp++;
                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);
                if (is_on) {
                    while (*sp == ' ') sp++;
                    int vel = SEQ_VEL;
                    if (*sp >= '0' && *sp <= '9') {
                        vel = 0;
                        while (*sp >= '0' && *sp <= '9') { vel = vel * 10 + (*sp++ - '0'); }
                    }
                    live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)clamp_i(vel, 1, 127));
                } else {
                    live_note_off(inst, tr, (uint8_t)pitch);
                }
            }
            return;
        }

        if (!strcmp(sub, "live_at")) {
            /* tN_live_at "<pitch> <pressure> <mode>" — live pad-pressure
             * aftertouch. mode: 1 = poly (0xA0, pitch carries the sounded note),
             * 2 = channel (0xD0, track-wide, pitch ignored). Routed via pfx_send
             * so it reaches the track's output the same as notes (ROUTE_MOVE
             * inject / ROUTE_EXTERNAL USB / ROUTE_SCHWUNG internal). Stateless —
             * no recording/playback here (Phase 2). */
            int pitch = 0, press = 0, mode = 1;
            sscanf(val, "%d %d %d", &pitch, &press, &mode);
            uint8_t ch = tr->channel & 0x0F;
            uint8_t pv = (uint8_t)clamp_i(press, 0, 127);
            if (mode == 2) {
                pfx_send(&tr->pfx, (uint8_t)(0xD0 | ch), pv, 0);
                tr->last_poly_at_press = 0;  /* channel mode: no replay needed */
            } else {
                /* Store latest pressure so arp_fire_step / tarp_fire_step can
                 * replay it onto each newly-spawned voice. Without replay the
                 * stream stalls between knuckle motions and new arp voices
                 * are born at AT=0. */
                tr->last_poly_at_press = pv;
                if (tr->pfx.arp.style != 0 || tr->tarp.style != 0) {
                    /* Arp active: fan out across every currently-sounding
                     * output pitch (HARMZ copies, delay echoes, the sounding
                     * arp pitch). Falls back to the pad pitch when nothing
                     * is sounding mid-step. */
                    int any = 0, p;
                    for (p = 0; p < 128; p++) {
                        if (tr->pfx.pitch_refcount[p] > 0) {
                            pfx_send(&tr->pfx, (uint8_t)(0xA0 | ch),
                                     (uint8_t)p, pv);
                            any = 1;
                        }
                    }
                    if (!any) {
                        pfx_send(&tr->pfx, (uint8_t)(0xA0 | ch),
                                 (uint8_t)clamp_i(pitch, 0, 127), pv);
                    }
                } else {
                    pfx_send(&tr->pfx, (uint8_t)(0xA0 | ch),
                             (uint8_t)clamp_i(pitch, 0, 127), pv);
                }
            }
            /* Record into the active clip when armed+recording on a melodic track.
             * The live send above runs regardless, so AT is monitored during the
             * count-in (recording=0 then); capture starts at recording proper.
             * Snap to 1/32 (matches CC); lane keyed by pitch (poly) / 255 (chan). */
            if (tr->recording) {
                uint8_t  key  = (mode == 2) ? AT_LANE_CHAN : (uint8_t)clamp_i(pitch, 0, 127);
                /* Drum tracks freeze tr->current_clip_tick (only per-lane playheads
                 * advance), so derive the record tick from the master clock wrapped
                 * to the clip window — AT automation is track-level, not lane-aware. */
                uint32_t _at_rec = tr->current_clip_tick;
                if (tr->pad_mode == PAD_MODE_DRUM) {
                    clip_t *_atacl = &tr->clips[tr->active_clip];
                    uint32_t _atwl = (uint32_t)_atacl->length * _atacl->ticks_per_step;
                    uint32_t _atabs = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                    + (uint32_t)inst->master_tick_in_step;
                    _at_rec = (uint32_t)_atacl->loop_start * _atacl->ticks_per_step
                            + (_atwl ? (_atabs % _atwl) : 0);
                }
                uint32_t snap = (_at_rec / 12) * 12;
                int lane = at_auto_alloc_lane(&tr->clip_at_auto[tr->active_clip], key);
                if (lane >= 0) {
                    at_auto_set_point(&tr->clip_at_auto[tr->active_clip], lane,
                                      (uint16_t)(snap <= 65534 ? snap : 65534),
                                      (uint8_t)clamp_i(press, 0, 127));
                    inst->state_dirty = 1;
                }
            }
            return;
        }

        if (!strcmp(sub, "padmap")) {
            /* tN_padmap "p0 p1 p2 ... p31" — 32 space-separated resolved
             * MIDI pitches for the 32 pads on track t. Pushed by JS whenever
             * computePadNoteMap recomputes (key / scale / scale-aware /
             * pad octave / layout / pad mode change). 0xFF = unmapped.
             * Consumed on the audio thread by on_midi. */
            const char *sp = val;
            int i;
            for (i = 0; i < 32; i++) {
                while (*sp == ' ') sp++;
                if (!*sp) break;
                int p = 0;
                while (*sp >= '0' && *sp <= '9') { p = p * 10 + (*sp++ - '0'); }
                if (p < 0)   p = 0xFF;
                if (p > 255) p = 0xFF;
                inst->pad_note_map[tidx][i] = (uint8_t)p;
            }
            /* Anything we didn't read stays at its previous value. JS is
             * expected to always send the full 32-entry payload.
             *
             * JS only ever pushes tN_padmap for the *currently active* track
             * (computePadNoteMap uses S.activeTrack), so the act of pushing
             * signals "this is now the active track." We piggyback active-
             * track sync here because the Schwung host drops module-defined
             * global set_param keys (only per-track-prefixed keys reach DSP
             * reliably).
             *
             * The push also serves as the capability signal for Phase 1:
             * JS only pushes tN_padmap when shadow_inbound_pad_midi_active
             * is present (patched Schwung). Pushing it survives DSP instance
             * recreate (state_load destroy/recreate path) because JS pushes
             * on every computePadNoteMap recompute, not just at init.
             * PHASE-1: remove the enable line when patches upstreamed. */
            inst->active_track = (uint8_t)tidx;
            inst->dsp_inbound_enabled = 1;
            /* 33rd token = pad_dispatch_muted. When set, on_midi skips
             * drum_pad_event so modal gestures (Shift+bottom-row track
             * shortcut, Delete/Loop/Mute/Copy/Capture holds, etc.) don't
             * trigger Rpt1/Rpt2 latch on the prior active track. */
            while (*sp == ' ') sp++;
            if (*sp) {
                int pdm = 0;
                while (*sp >= '0' && *sp <= '9') { pdm = pdm * 10 + (*sp++ - '0'); }
                inst->pad_dispatch_muted = (pdm != 0) ? 1 : 0;
            }
            /* 34th token = delete_held. Moved here from the separate
             * t0_delete_held set_param to share the padmap's tick-based
             * self-heal and avoid onMidiMessage coalescing. */
            while (*sp == ' ') sp++;
            if (*sp) {
                int dh = 0;
                while (*sp >= '0' && *sp <= '9') { dh = dh * 10 + (*sp++ - '0'); }
                inst->delete_held = (dh != 0) ? 1 : 0;
            }
            /* 35th token = corun_left_silent. Set when computePadNoteMap
             * intentionally maps the left-column drum pads to 0xFF for
             * Move-native co-run (double-hit suppression). on_midi uses it to
             * exclude these benign 0xFF presses from the pad-drop diagnostic. */
            while (*sp == ' ') sp++;
            if (*sp) {
                int cls = 0;
                while (*sp >= '0' && *sp <= '9') { cls = cls * 10 + (*sp++ - '0'); }
                inst->corun_left_silent = (cls != 0) ? 1 : 0;
            }
            return;
        }

        if (!strcmp(sub, "clip_length")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            int max_len = SEQ_STEPS - (int)cl->loop_start;
            if (max_len < 1) max_len = 1;
            cl->length = (uint16_t)clamp_i(my_atoi(val), 1, max_len);
            {
                uint16_t _le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= _le)
                    tr->current_step = cl->loop_start;
            }
            return;
        }

        /* Playback direction for active melodic clip (v=35).
         * 0=Forward, 1=Backward, 2=Pingpong-Forward, 3=Pingpong-Backward.
         * Mid-flight change keeps the current playhead position; pp_dir_state
         * resets so PP modes pick up a sane direction on the next advance. */
        if (!strcmp(sub, "clip_playback_dir")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            cl->playback_dir = (uint8_t)clamp_i(my_atoi(val), 0, 3);
            cl->pp_dir_state = initial_pp_dir(cl->playback_dir);
            silence_track_from_set_param(inst, tr);
            inst->state_dirty = 1;
            return;
        }
        /* Playback style for active melodic clip: 0=Step, 1=Audio (note-on at
         * note's end when playhead is in reverse motion). */
        if (!strcmp(sub, "clip_playback_audio_reverse")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            cl->playback_audio_reverse = (uint8_t)clamp_i(my_atoi(val), 0, 1);
            inst->state_dirty = 1;
            return;
        }

        if (!strcmp(sub, "clock_shift")) {
            int dir = my_atoi(val);
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            if (len < 2) return;
            uint8_t tmp_s, tmp_nc, tmp_ns[8], tmp_v;
            uint16_t tmp_g;
            int16_t tmp_toff[8];
            if (dir == 1) {
                tmp_s    = cl->steps[len-1];
                memcpy(tmp_ns, cl->step_notes[len-1], 8);
                tmp_nc   = cl->step_note_count[len-1];
                tmp_v    = cl->step_vel[len-1];
                tmp_g    = cl->step_gate[len-1];
                memcpy(tmp_toff, cl->note_tick_offset[len-1], 8 * sizeof(int16_t));
                memmove(&cl->steps[1],              &cl->steps[0],              (size_t)(len-1));
                memmove(&cl->step_notes[1][0],      &cl->step_notes[0][0],      (size_t)(len-1) * 8);
                memmove(&cl->step_note_count[1],    &cl->step_note_count[0],    (size_t)(len-1));
                memmove(&cl->step_vel[1],           &cl->step_vel[0],           (size_t)(len-1));
                memmove(&cl->step_gate[1],          &cl->step_gate[0],          (size_t)(len-1) * 2);
                memmove(&cl->note_tick_offset[1][0], &cl->note_tick_offset[0][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                cl->steps[0]           = tmp_s;
                memcpy(cl->step_notes[0], tmp_ns, 8);
                cl->step_note_count[0] = tmp_nc;
                cl->step_vel[0]        = tmp_v;
                cl->step_gate[0]       = tmp_g;
                memcpy(cl->note_tick_offset[0], tmp_toff, 8 * sizeof(int16_t));
                cl->clock_shift_pos = (uint16_t)((cl->clock_shift_pos + 1) % (uint16_t)len);
            } else {
                tmp_s    = cl->steps[0];
                memcpy(tmp_ns, cl->step_notes[0], 8);
                tmp_nc   = cl->step_note_count[0];
                tmp_v    = cl->step_vel[0];
                tmp_g    = cl->step_gate[0];
                memcpy(tmp_toff, cl->note_tick_offset[0], 8 * sizeof(int16_t));
                memmove(&cl->steps[0],              &cl->steps[1],              (size_t)(len-1));
                memmove(&cl->step_notes[0][0],      &cl->step_notes[1][0],      (size_t)(len-1) * 8);
                memmove(&cl->step_note_count[0],    &cl->step_note_count[1],    (size_t)(len-1));
                memmove(&cl->step_vel[0],           &cl->step_vel[1],           (size_t)(len-1));
                memmove(&cl->step_gate[0],          &cl->step_gate[1],          (size_t)(len-1) * 2);
                memmove(&cl->note_tick_offset[0][0], &cl->note_tick_offset[1][0], (size_t)(len-1) * 8 * sizeof(int16_t));
                cl->steps[len-1]           = tmp_s;
                memcpy(cl->step_notes[len-1], tmp_ns, 8);
                cl->step_note_count[len-1] = tmp_nc;
                cl->step_vel[len-1]        = tmp_v;
                cl->step_gate[len-1]       = tmp_g;
                memcpy(cl->note_tick_offset[len-1], tmp_toff, 8 * sizeof(int16_t));
                cl->clock_shift_pos = (uint16_t)((cl->clock_shift_pos + (uint16_t)(len-1)) % (uint16_t)len);
            }
            int i, any = 0;
            for (i = 0; i < len; i++) if (cl->steps[i]) { any = 1; break; }
            cl->active = (uint8_t)any;
            clip_migrate_to_notes(cl);
            return;
        }

        if (!strcmp(sub, "nudge")) {
            int dir = my_atoi(val);
            if (dir == 0) { tr->clips[tr->active_clip].nudge_pos = 0; return; }
            if (dir != 1 && dir != -1) return;
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            if (len < 1) return;
            int tps = (int)cl->ticks_per_step;
            int midpoint = tps / 2;
            /* crossing notes bounded at notes[] capacity; dst_off preserves absolute timing */
            struct { int16_t dst, dst_off; uint8_t pitch, vel, active; uint16_t gate; } cross[512];
            int ncross = 0;
            int s, ni, wi;
            for (s = 0; s < len; s++) {
                if (cl->step_note_count[s] == 0) continue;
                wi = 0;
                for (ni = 0; ni < (int)cl->step_note_count[s]; ni++) {
                    int new_off = (int)cl->note_tick_offset[s][ni] + dir;
                    if (new_off > midpoint) {
                        /* crossed midpoint forward — same threshold as step overlay */
                        if (ncross < 512) {
                            cross[ncross].dst     = (int16_t)((s + 1) % len);
                            cross[ncross].dst_off = (int16_t)(new_off - tps);
                            cross[ncross].pitch   = cl->step_notes[s][ni];
                            cross[ncross].vel     = cl->step_vel[s];
                            cross[ncross].gate    = cl->step_gate[s];
                            cross[ncross].active  = cl->steps[s];
                            ncross++;
                        }
                    } else if (new_off < -midpoint) {
                        /* crossed midpoint backward */
                        if (ncross < 512) {
                            cross[ncross].dst     = (int16_t)((s - 1 + len) % len);
                            cross[ncross].dst_off = (int16_t)(new_off + tps);
                            cross[ncross].pitch   = cl->step_notes[s][ni];
                            cross[ncross].vel     = cl->step_vel[s];
                            cross[ncross].gate    = cl->step_gate[s];
                            cross[ncross].active  = cl->steps[s];
                            ncross++;
                        }
                    } else {
                        cl->step_notes[s][wi]       = cl->step_notes[s][ni];
                        cl->note_tick_offset[s][wi] = (int16_t)new_off;
                        wi++;
                    }
                }
                for (ni = wi; ni < (int)cl->step_note_count[s]; ni++) {
                    cl->step_notes[s][ni]       = 0;
                    cl->note_tick_offset[s][ni] = 0;
                }
                cl->step_note_count[s] = (uint8_t)wi;
                if (wi == 0) {
                    cl->steps[s]     = 0;
                    cl->step_vel[s]  = (uint8_t)SEQ_VEL;
                    cl->step_gate[s] = (uint16_t)GATE_TICKS;
                }
            }
            { int ci;
              for (ci = 0; ci < ncross; ci++) {
                int dst = (int)cross[ci].dst;
                if (cl->step_note_count[dst] >= 8) continue;
                int slot = (int)cl->step_note_count[dst];
                cl->step_notes[dst][slot]       = cross[ci].pitch;
                cl->note_tick_offset[dst][slot] = cross[ci].dst_off;
                if (slot == 0) {
                    cl->step_vel[dst]  = cross[ci].vel;
                    cl->step_gate[dst] = cross[ci].gate;
                }
                if (cross[ci].active) cl->steps[dst] = 1;
                cl->step_note_count[dst]++;
              }
            }
            { int any2 = 0;
              for (s = 0; s < len; s++) if (cl->steps[s]) { any2 = 1; break; }
              cl->active = (uint8_t)any2;
            }
            cl->nudge_pos += (int16_t)dir;
            clip_migrate_to_notes(cl);
            return;
        }

        if (!strcmp(sub, "beat_stretch")) {
            int dir = my_atoi(val);
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            int i, ni2, new_len, any;
            uint8_t  tmp_steps[SEQ_STEPS];
            uint8_t  tmp_notes[SEQ_STEPS][8];
            uint8_t  tmp_nc[SEQ_STEPS];
            uint8_t  tmp_vel[SEQ_STEPS];
            uint16_t tmp_gate[SEQ_STEPS];
            int16_t  tmp_tick_offset[SEQ_STEPS][8];
            /* gate cap: per-clip resolution; capped at uint16_t max for large TPS */
            { int gmax_bs = SEQ_STEPS * cl->ticks_per_step; if (gmax_bs > 65535) gmax_bs = 65535;
            int off_clamp = cl->ticks_per_step - 1;

            if (dir == 1) {
                /* EXPAND x2: clamp if doubling would exceed 256 steps */
                if (len * 2 > SEQ_STEPS) { return; }
                new_len = len * 2;
                for (i = len - 1; i >= 1; i--) {
                    int ng = (int)cl->step_gate[i] * 2;
                    if (ng > gmax_bs) ng = gmax_bs;
                    cl->steps[i*2]           = cl->steps[i];
                    memcpy(cl->step_notes[i*2], cl->step_notes[i], 8);
                    cl->step_note_count[i*2] = cl->step_note_count[i];
                    cl->step_vel[i*2]        = cl->step_vel[i];
                    cl->step_gate[i*2]       = (uint16_t)ng;
                    for (ni2 = 0; ni2 < 8; ni2++) {
                        int nt = (int)cl->note_tick_offset[i][ni2] * 2;
                        if (nt > off_clamp) nt = off_clamp; else if (nt < -off_clamp) nt = -off_clamp;
                        cl->note_tick_offset[i*2][ni2] = (int16_t)nt;
                    }
                    cl->steps[i] = 0;
                }
                /* step 0 stays, scale its gate and offsets too */
                {
                    int ng = (int)cl->step_gate[0] * 2;
                    if (ng > gmax_bs) ng = gmax_bs;
                    cl->step_gate[0] = (uint16_t)ng;
                    for (ni2 = 0; ni2 < 8; ni2++) {
                        int nt = (int)cl->note_tick_offset[0][ni2] * 2;
                        if (nt > off_clamp) nt = off_clamp; else if (nt < -off_clamp) nt = -off_clamp;
                        cl->note_tick_offset[0][ni2] = (int16_t)nt;
                    }
                }
                for (i = 1; i < new_len; i += 2) {
                    cl->steps[i]           = 0;
                    memset(cl->step_notes[i], 0, 8);
                    cl->step_note_count[i] = 0;
                    cl->step_vel[i]        = SEQ_VEL;
                    cl->step_gate[i]       = GATE_TICKS;
                    memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                cl->length = (uint16_t)new_len;
                cl->stretch_exp++;
                tr->stretch_blocked = 0;
            } else {
                /* COMPRESS /2: dry-run collision check — abort entirely if any two
                 * active steps would map to the same destination position. */
                if (len < 2) return;
                {
                    uint8_t seen[SEQ_STEPS];
                    memset(seen, 0, sizeof(seen));
                    for (i = 0; i < len; i++) {
                        if (cl->steps[i]) {
                            int dst = i / 2;
                            if (seen[dst]) {
                                tr->stretch_blocked = 1;
                                return;
                            }
                            seen[dst] = 1;
                        }
                    }
                }
                tr->stretch_blocked = 0;
                new_len = len / 2;
                memset(tmp_steps, 0, sizeof(tmp_steps));
                for (i = 0; i < SEQ_STEPS; i++) {
                    memset(tmp_notes[i], 0, 8);
                    tmp_nc[i]   = 0;
                    tmp_vel[i]  = SEQ_VEL;
                    tmp_gate[i] = GATE_TICKS;
                    memset(tmp_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                /* First pass: active steps — these win any destination conflict */
                for (i = 0; i < len; i++) {
                    if (cl->steps[i]) {
                        int dst = i / 2;
                        if (!tmp_steps[dst]) {
                            int ng = ((int)cl->step_gate[i] + 1) / 2;
                            if (ng < 1) ng = 1;
                            tmp_steps[dst] = 1;
                            memcpy(tmp_notes[dst], cl->step_notes[i], 8);
                            tmp_nc[dst]   = cl->step_note_count[i];
                            tmp_vel[dst]  = cl->step_vel[i];
                            tmp_gate[dst] = (uint16_t)ng;
                            for (ni2 = 0; ni2 < 8; ni2++) {
                                int nt = (int)cl->note_tick_offset[i][ni2] / 2;
                                tmp_tick_offset[dst][ni2] = (int16_t)nt;
                            }
                        }
                    }
                }
                /* Second pass: inactive steps with notes — fill empty destinations only */
                for (i = 0; i < len; i++) {
                    if (!cl->steps[i] && cl->step_note_count[i] > 0) {
                        int dst = i / 2;
                        if (tmp_nc[dst] == 0) {
                            int ng = ((int)cl->step_gate[i] + 1) / 2;
                            if (ng < 1) ng = 1;
                            /* tmp_steps[dst] stays 0 (inactive) */
                            memcpy(tmp_notes[dst], cl->step_notes[i], 8);
                            tmp_nc[dst]   = cl->step_note_count[i];
                            tmp_vel[dst]  = cl->step_vel[i];
                            tmp_gate[dst] = (uint16_t)ng;
                            for (ni2 = 0; ni2 < 8; ni2++) {
                                int nt = (int)cl->note_tick_offset[i][ni2] / 2;
                                tmp_tick_offset[dst][ni2] = (int16_t)nt;
                            }
                        }
                    }
                }
                memcpy(cl->steps,           tmp_steps,       sizeof(tmp_steps));
                memcpy(cl->step_notes,      tmp_notes,       sizeof(tmp_notes));
                memcpy(cl->step_note_count, tmp_nc,          sizeof(tmp_nc));
                memcpy(cl->step_vel,        tmp_vel,         sizeof(tmp_vel));
                memcpy(cl->step_gate,       tmp_gate,        sizeof(tmp_gate));
                memcpy(cl->note_tick_offset, tmp_tick_offset, sizeof(tmp_tick_offset));
                cl->length = (uint16_t)new_len;
                cl->stretch_exp--;
            }
            } /* end gmax_bs/off_clamp block */

            {
                uint16_t _le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= _le)
                    tr->current_step = cl->loop_start;
            }

            any = 0;
            for (i = 0; i < (int)cl->length; i++)
                if (cl->steps[i]) { any = 1; break; }
            cl->active = (uint8_t)any;
            clip_migrate_to_notes(cl);

            return;
        }

        if (!strcmp(sub, "loop_double_fill")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            int len = (int)cl->length;
            int ls  = (int)cl->loop_start;
            int i;
            /* Doubling the loop window must fit inside storage from loop_start.
             * Old check `len*2 > SEQ_STEPS` ignored loop_start; with ls>0 it
             * would accept doublings that overflow the storage extent. */
            if (ls + len * 2 > SEQ_STEPS) return;
            undo_begin_single(inst, tidx, (int)tr->active_clip);
            /* Copy the loop window forward by `len` steps so the doubled window
             * [ls, ls+len*2) holds two copies of the original content. Old
             * code wrote steps[len..2len-1] from steps[0..len-1] — only
             * correct when loop_start == 0. */
            for (i = 0; i < len; i++) {
                int src = ls + i;
                int dst = ls + len + i;
                cl->steps[dst]           = cl->steps[src];
                memcpy(cl->step_notes[dst], cl->step_notes[src], 8);
                cl->step_note_count[dst] = cl->step_note_count[src];
                cl->step_vel[dst]        = cl->step_vel[src];
                cl->step_gate[dst]       = cl->step_gate[src];
                memcpy(cl->note_tick_offset[dst], cl->note_tick_offset[src], 8 * sizeof(int16_t));
            }
            cl->length = (uint16_t)(len * 2);
            {
                uint16_t _le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= _le)
                    tr->current_step = cl->loop_start;
            }
            clip_migrate_to_notes(cl);
            inst->state_dirty = 1;
            return;
        }

        /* tN_lgto_apply: destructive legato on the active clip. Each note's
         * gate becomes (next-active-tick − this-tick); last-active note's
         * gate fills to clip_end. Undoable. */
        if (!strcmp(sub, "lgto_apply")) {
            undo_begin_single(inst, tidx, (int)tr->active_clip);
            apply_legato_to_clip(&tr->clips[tr->active_clip]);
            pfx_sync_from_clip(tr);
            inst->state_dirty = 1;
            return;
        }

        /* Snapshot before pfx reset commands */
        if (!strcmp(sub, "pfx_reset") || !strcmp(sub, "pfx_noteFx_reset") ||
            !strcmp(sub, "pfx_harm_reset") || !strcmp(sub, "pfx_delay_reset"))
            undo_begin_single(inst, tidx, (int)tr->active_clip);
        /* All play effects params */
        pfx_set(inst, tr, &tr->clips[tr->active_clip].pfx_params, sub, val);
        return;
    }
}

