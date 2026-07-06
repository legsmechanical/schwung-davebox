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
            /* snprintf returns the INTENDED length — clamp _off or the size
             * argument underflows once the buffer fills (16-clip row ops). */
            const int _cap = (int)sizeof(inst->last_restore_info) - 1;
            int _i, _off = snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "m");
            for (_i = 0; _i < (int)inst->redo_clip_count && _off < _cap; _i++)
                _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                 " %d %d", (int)inst->redo_clip_tracks[_i], (int)inst->redo_clip_indices[_i]);
            if (inst->drum_row_redo_valid) {
                int _s;
                for (_s = 0; _s < (int)inst->drum_row_redo_valid && _off < _cap; _s++)
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
            /* snprintf returns the INTENDED length — clamp _off or the size
             * argument underflows once the buffer fills (16-clip row ops). */
            const int _cap = (int)sizeof(inst->last_restore_info) - 1;
            int _i, _off = snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "m");
            for (_i = 0; _i < (int)inst->undo_clip_count && _off < _cap; _i++)
                _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                 " %d %d", (int)inst->undo_clip_tracks[_i], (int)inst->undo_clip_indices[_i]);
            if (inst->drum_row_undo_valid) {
                int _s;
                for (_s = 0; _s < (int)inst->drum_row_undo_valid && _off < _cap; _s++)
                    _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                     " DR %d", (int)inst->drum_row_undo_clips[_s]);
            }
        }
        return;
    }

    /* --- Track-prefixed params: tN_<subkey> --- */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_config.c"

        /* tN_cM_step_S or tN_cM_length: clip data */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_clip.c"

        /* tN_clip_resolution — change per-clip ticks_per_step; rescale notes proportionally */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_config2.c"

        /* CC PARAM bank set_params */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_ccauto.c"

        /* tN_lL_* — drum lane setters */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_drum.c"

/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_record.c"

/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_drum2.c"

/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_track_live.c"

/* LOAD-BEARING SPACING: the blank line above this include (pristine 5863)
 * stays here in the parent, and exactly one blank line follows the include
 * before EOF (pristine trailing blank 6238). Spacing and the segment-file
 * head/tail are part of the phase-4A re-runnable gate -- the split is
 * proven by the preprocessed TU being byte-identical pre/post
 * (`clang -E -P`). Do not tidy. */
#include "setparam/sp_track_misc.c"
