/* ------------------------------------------------------------------ */
/* set_param helpers                                                    */
/* ------------------------------------------------------------------ */

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

    if (!strcmp(key, "harm_unison")) {
        int _v;
        if      (!strcmp(val, "OFF") || !strcmp(val, "0")) _v = 0;
        else if (!strcmp(val, "x2")  || !strcmp(val, "1")) _v = 1;
        else if (!strcmp(val, "x3")  || !strcmp(val, "2")) _v = 2;
        else _v = clamp_i(my_atoi(val), 0, 2);
        fx->unison = _v; cp->unison = _v;
        return;
    }
    if (!strcmp(key, "harm_octaver"))
        { PFX_SET_BOTH(octaver, octaver, -4, 4); return; }
    if (!strcmp(key, "harm_interval1"))
        { PFX_SET_BOTH(harmonize_1, harmonize_1, -24, 24); return; }
    if (!strcmp(key, "harm_interval2"))
        { PFX_SET_BOTH(harmonize_2, harmonize_2, -24, 24); return; }

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
    if (!strcmp(key, "delay_pitch_random")) {
        int _v = (!strcmp(val, "on") || !strcmp(val, "1")) ? 1 : 0;
        fx->fb_note_random = _v; cp->fb_note_random = _v;
        return;
    }
    if (!strcmp(key, "delay_gate_fb"))
        { PFX_SET_BOTH(fb_gate_time, fb_gate_time, -100, 100); return; }
    if (!strcmp(key, "delay_clock_fb"))
        { PFX_SET_BOTH(fb_clock, fb_clock, -100, 100); return; }

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
        if (_v == 0) _v = 1; /* skip zero */
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

#undef PFX_SET_BOTH

    if (!strcmp(key, "pfx_reset")) {
        arp_silence(inst, tr);
        pfx_reset(fx);
        clip_pfx_params_init(cp);
        return;
    }
    if (!strcmp(key, "pfx_noteFx_reset")) {
        fx->octave_shift    = 0; cp->octave_shift    = 0;
        fx->note_offset     = 0; cp->note_offset     = 0;
        fx->gate_time       = 100; cp->gate_time       = 100;
        fx->velocity_offset = 0; cp->velocity_offset = 0;
        fx->quantize        = 0; cp->quantize        = 0;
        return;
    }
    if (!strcmp(key, "pfx_harm_reset")) {
        fx->unison      = 0; cp->unison      = 0;
        fx->octaver     = 0; cp->octaver     = 0;
        fx->harmonize_1 = 0; cp->harmonize_1 = 0;
        fx->harmonize_2 = 0; cp->harmonize_2 = 0;
        return;
    }
    if (!strcmp(key, "pfx_delay_reset")) {
        fx->delay_time_idx  = 0; cp->delay_time_idx  = 0;
        fx->delay_level     = 0; cp->delay_level     = 0;
        fx->repeat_times    = 0; cp->repeat_times    = 0;
        fx->fb_velocity     = 0; cp->fb_velocity     = 0;
        fx->fb_note         = 0; cp->fb_note         = 0;
        fx->fb_note_random  = 0; cp->fb_note_random  = 0;
        fx->fb_gate_time    = 0; cp->fb_gate_time    = 0;
        fx->fb_clock        = 0; cp->fb_clock        = 0;
        return;
    }
    if (!strcmp(key, "pfx_seq_arp_reset")) {
        cp->seq_arp_style     = 0;
        cp->seq_arp_rate      = ARP_RATE_DEFAULT;
        cp->seq_arp_octaves   = 1;
        cp->seq_arp_gate      = 50;
        cp->seq_arp_steps_mode = 0;
        cp->seq_arp_retrigger = 1;
        int _i;
        for (_i = 0; _i < 8; _i++) cp->seq_arp_step_vel[_i] = 4;
        arp_silence(inst, tr);
        arp_init_defaults(&fx->arp);
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
/* set_param                                                            */
/* ------------------------------------------------------------------ */

static void set_param(void *instance, const char *key, const char *val) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst || !key || !val) return;

    /* --- Transport (global) --- */
    if (!strcmp(key, "transport")) {
        if (!strcmp(val, "play")) {
            if (!inst->playing) {
                int t;
                inst->global_tick         = 0;
                inst->tick_accum          = 0;
                inst->master_tick_in_step = 0;
                inst->arp_master_tick     = 0;
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].current_step      = 0;
                    inst->tracks[t].tick_in_step      = 0;
                    inst->tracks[t].note_active        = 0;
                    inst->tracks[t].pfx.sample_counter = 0;
                    memset(inst->tracks[t].drum_current_step, 0, sizeof(inst->tracks[t].drum_current_step));
                    memset(inst->tracks[t].drum_tick_in_step,  0, sizeof(inst->tracks[t].drum_tick_in_step));
                    if (inst->tracks[t].will_relaunch) {
                        inst->tracks[t].clip_playing      = 1;
                        inst->tracks[t].will_relaunch     = 0;
                        inst->tracks[t].pending_page_stop = 0;
                    }
                }
                inst->playing = 1;
            }
        } else if (!strcmp(val, "stop")) {
            if (inst->playing) {
                int t;
                for (t = 0; t < NUM_TRACKS; t++) {
                    play_fx_t *fx = &inst->tracks[t].pfx;
                    silence_track_notes_v2(inst, &inst->tracks[t]);
                    if (fx->route == ROUTE_MOVE) {
                        /* Reschedule queued note-offs to fire immediately in render_block.
                         * pfx_send from set_param context doesn't release Move synth voices;
                         * only inject from render_block (pfx_q_fire) does. */
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
                inst->playing        = 0;
                inst->count_in_ticks = 0;
                send_panic(inst);
                seq8_ilog(inst, "SEQ8 transport: stop");
            }
        } else if (!strcmp(val, "restart")) {
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
            for (t = 0; t < NUM_TRACKS; t++) {
                inst->tracks[t].current_step      = 0;
                inst->tracks[t].tick_in_step      = 0;
                inst->tracks[t].note_active        = 0;
                inst->tracks[t].pfx.sample_counter = 0;
                memset(inst->tracks[t].drum_current_step, 0, sizeof(inst->tracks[t].drum_current_step));
                memset(inst->tracks[t].drum_tick_in_step,  0, sizeof(inst->tracks[t].drum_tick_in_step));
                if (inst->tracks[t].will_relaunch) {
                    inst->tracks[t].clip_playing      = 1;
                    inst->tracks[t].will_relaunch     = 0;
                    inst->tracks[t].pending_page_stop = 0;
                }
            }
            inst->playing = 1;
            seq8_ilog(inst, "SEQ8 transport: restart");
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
            inst->playing        = 0;
            inst->count_in_ticks = 0;
            send_panic(inst);
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
        return;
    }
    if (!strcmp(key, "record_count_in_cancel")) {
        inst->count_in_ticks = 0;
        return;
    }

    /* --- Metronome --- */
    if (!strcmp(key, "metro_on")) {
        inst->metro_on = (uint8_t)clamp_i(my_atoi(val), 0, 3);
        return;
    }
    if (!strcmp(key, "metro_vol")) {
        inst->metro_vol = (uint8_t)clamp_i(my_atoi(val), 0, 100);
        return;
    }

    /* --- Active track --- */
    if (!strcmp(key, "active_track")) {
        inst->active_track = (uint8_t)clamp_i(my_atoi(val), 0, NUM_TRACKS - 1);
        return;
    }

    if (!strcmp(key, "bpm")) {
        double bpm = (double)my_atoi(val);
        if (bpm < 40.0 || bpm > 250.0) return;
        inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
        int tb;
        for (tb = 0; tb < NUM_TRACKS; tb++)
            inst->tracks[tb].pfx.cached_bpm = bpm;
        return;
    }

    /* --- Global pad tonality --- */
    if (!strcmp(key, "key")) {
        inst->pad_key = (uint8_t)clamp_i(my_atoi(val), 0, 11);
        return;
    }
    if (!strcmp(key, "scale")) {
        inst->pad_scale = (uint8_t)clamp_i(my_atoi(val), 0, 13);
        return;
    }
    if (!strcmp(key, "scale_aware")) {
        inst->scale_aware = my_atoi(val) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "inp_quant")) {
        inst->inp_quant = my_atoi(val) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "midi_in_channel")) {
        inst->midi_in_channel = (uint8_t)clamp_i(my_atoi(val), 0, 16);
        seq8_save_state(inst);
        return;
    }
    if (!strcmp(key, "input_vel")) {
        inst->input_vel = (uint8_t)clamp_i(my_atoi(val), 0, 127);
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
                    uint16_t newlen = tr2->clips[tr2->queued_clip].length;
                    tr2->current_step     = tr2->clip_playing
                                           ? (uint16_t)(tr2->current_step % newlen)
                                           : (uint16_t)(inst->global_tick % newlen);
                    tr2->active_clip      = (uint8_t)tr2->queued_clip;
                    pfx_sync_from_clip(tr2);
                    tr2->clip_playing     = 1;
                    tr2->queued_clip      = -1;
                    tr2->pending_page_stop = 0;
                }
            }
        }
        return;
    }
    if (!strcmp(key, "debug_log")) {
        seq8_ilog(inst, val);
        return;
    }

    if (!strcmp(key, "save")) {
        seq8_save_state(inst);
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
                for (c2 = 0; c2 < NUM_CLIPS; c2++)
                    clip_init(&tr2->clips[c2]);
                drum_track_init(tr2);
            }
        }
        seq8_load_state(inst);
        return;
    }

    /* --- Scene launch (global): all tracks to clip M --- */
    if (!strcmp(key, "launch_scene")) {
        int cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
        int t;
        if (inst->launch_quant == 0 && inst->playing) {
            /* Now + transport running: fire per-track immediately */
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr2 = &inst->tracks[t];
                uint16_t newlen = tr2->clips[cidx].length;
                tr2->current_step     = tr2->clip_playing
                                       ? (uint16_t)(tr2->current_step % newlen)
                                       : (uint16_t)(inst->global_tick % newlen);
                tr2->active_clip      = (uint8_t)cidx;
                pfx_sync_from_clip(tr2);
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
            dst->ticks_per_step = src->ticks_per_step;
            dst->pfx_params    = src->pfx_params;
            memcpy(dst->steps,           src->steps,           SEQ_STEPS);
            memcpy(dst->step_notes,      src->step_notes,      SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->step_vel,        src->step_vel,        SEQ_STEPS);
            memcpy(dst->step_gate,       src->step_gate,       SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            dst->active = src->active;
            clip_migrate_to_notes(dst);
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
            dst->ticks_per_step = src->ticks_per_step;
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,           src->steps,           SEQ_STEPS);
            memcpy(dst->step_notes,      src->step_notes,      SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->step_vel,        src->step_vel,        SEQ_STEPS);
            memcpy(dst->step_gate,       src->step_gate,       SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            if ((int)inst->tracks[t].active_clip == dstRow)
                pfx_sync_from_clip(&inst->tracks[t]);
        }
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
            dst->ticks_per_step = src->ticks_per_step;
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,            src->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            if ((int)dstTr->active_clip == dstC) pfx_sync_from_clip(dstTr);
            silence_track_notes_v2(inst, srcTr);
            clip_init(src);
            if ((int)srcTr->active_clip == srcC) pfx_sync_from_clip(srcTr);
            srcTr->rec_pending_count = 0;
            srcTr->recording = 0;
            if (srcTr->queued_clip == srcC) srcTr->queued_clip = -1;
            seq8_save_state(inst);
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
            dst->ticks_per_step = src->ticks_per_step;
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,            src->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            if ((int)tr->active_clip == dstRow) pfx_sync_from_clip(tr);
            silence_track_notes_v2(inst, tr);
            clip_init(src);
            if ((int)tr->active_clip == srcRow) pfx_sync_from_clip(tr);
            tr->rec_pending_count = 0;
            tr->recording = 0;
            if (tr->queued_clip == srcRow) tr->queued_clip = -1;
        }
        seq8_save_state(inst);
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
            drum_clip_t *src = &inst->tracks[srcT].drum_clips[srcC];
            drum_clip_t *dst = &inst->tracks[dstT].drum_clips[dstC];
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
                dc->length        = sc->length;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->active        = sc->active;
                dst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
            }
            seq8_save_state(inst);
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
            drum_clip_t *src = &srcTr->drum_clips[srcC];
            drum_clip_t *dst = &dstTr->drum_clips[dstC];
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
                dc->length        = sc->length;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->active        = sc->active;
                dst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
                pfx_note_off_imm(inst, srcTr, src_midi_note);
                clip_init(sc);
                src->lanes[l].midi_note = src_midi_note;
            }
            seq8_save_state(inst);
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
        seq8_save_state(inst);
        return;
    }

    if (!strcmp(key, "undo_restore")) {
        int i;
        if (inst->drum_undo_valid) {
            /* Drum recording undo */
            int t = (int)inst->drum_undo_track, c = (int)inst->drum_undo_clip;
            drum_clip_t *dc = &inst->tracks[t].drum_clips[c];
            /* Capture redo */
            for (i = 0; i < DRUM_LANES; i++) {
                const clip_t *src = &dc->lanes[i].clip;
                drum_rec_snap_lane_t *dst = &inst->drum_redo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                dst->length = src->length;
                dst->active = src->active;
            }
            inst->drum_redo_track = (uint8_t)t;
            inst->drum_redo_clip  = (uint8_t)c;
            inst->drum_redo_valid = 1;
            /* Restore */
            for (i = 0; i < DRUM_LANES; i++) {
                clip_t *dst = &dc->lanes[i].clip;
                const drum_rec_snap_lane_t *src = &inst->drum_undo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                dst->length = src->length;
                dst->active = src->active;
                clip_migrate_to_notes(dst);
            }
            inst->drum_undo_valid = 0;
            seq8_save_state(inst);
            return;
        }
        if (!inst->undo_valid) return;
        inst->redo_clip_count = inst->undo_clip_count;
        memcpy(inst->redo_clip_tracks,  inst->undo_clip_tracks,  inst->undo_clip_count);
        memcpy(inst->redo_clip_indices, inst->undo_clip_indices, inst->undo_clip_count);
        for (i = 0; i < (int)inst->undo_clip_count; i++) {
            int t = (int)inst->undo_clip_tracks[i], c = (int)inst->undo_clip_indices[i];
            memcpy(&inst->redo_clips[i], &inst->tracks[t].clips[c], sizeof(clip_t));
        }
        inst->redo_valid = 1;
        apply_clip_restore(inst, inst->undo_clips,
                           inst->undo_clip_tracks, inst->undo_clip_indices,
                           inst->undo_clip_count);
        inst->undo_valid = 0;
        seq8_save_state(inst);
        return;
    }

    if (!strcmp(key, "redo_restore")) {
        int i;
        if (inst->drum_redo_valid) {
            /* Drum recording redo */
            int t = (int)inst->drum_redo_track, c = (int)inst->drum_redo_clip;
            drum_clip_t *dc = &inst->tracks[t].drum_clips[c];
            /* Capture new undo */
            for (i = 0; i < DRUM_LANES; i++) {
                const clip_t *src = &dc->lanes[i].clip;
                drum_rec_snap_lane_t *dst = &inst->drum_undo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                dst->length = src->length;
                dst->active = src->active;
            }
            inst->drum_undo_track = (uint8_t)t;
            inst->drum_undo_clip  = (uint8_t)c;
            inst->drum_undo_valid = 1;
            /* Restore redo */
            for (i = 0; i < DRUM_LANES; i++) {
                clip_t *dst = &dc->lanes[i].clip;
                const drum_rec_snap_lane_t *src = &inst->drum_redo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                dst->length = src->length;
                dst->active = src->active;
                clip_migrate_to_notes(dst);
            }
            inst->drum_redo_valid = 0;
            seq8_save_state(inst);
            return;
        }
        if (!inst->redo_valid) return;
        inst->undo_clip_count = inst->redo_clip_count;
        memcpy(inst->undo_clip_tracks,  inst->redo_clip_tracks,  inst->redo_clip_count);
        memcpy(inst->undo_clip_indices, inst->redo_clip_indices, inst->redo_clip_count);
        for (i = 0; i < (int)inst->redo_clip_count; i++) {
            int t = (int)inst->redo_clip_tracks[i], c = (int)inst->redo_clip_indices[i];
            memcpy(&inst->undo_clips[i], &inst->tracks[t].clips[c], sizeof(clip_t));
        }
        inst->undo_valid = 1;
        apply_clip_restore(inst, inst->redo_clips,
                           inst->redo_clip_tracks, inst->redo_clip_indices,
                           inst->redo_clip_count);
        inst->redo_valid = 0;
        seq8_save_state(inst);
        return;
    }

    /* --- Track-prefixed params: tN_<subkey> --- */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        /* tN_launch_clip: Now=immediate, quantized=queue at next boundary */
        if (!strcmp(sub, "launch_clip")) {
            int new_cidx = clamp_i(my_atoi(val), 0, NUM_CLIPS - 1);
            if (inst->launch_quant == 0 && (tr->clip_playing || inst->playing)) {
                /* Now + transport active: fire immediately */
                silence_track_notes_v2(inst, tr);
                uint16_t newlen = tr->clips[new_cidx].length;
                tr->current_step     = tr->clip_playing
                                       ? (uint16_t)(tr->current_step % newlen)
                                       : (uint16_t)(inst->global_tick % newlen);
                tr->active_clip      = (uint8_t)new_cidx;
                pfx_sync_from_clip(tr);
                if (tr->tick_in_step >= tr->clips[new_cidx].ticks_per_step)
                    tr->tick_in_step = 0;
                if (tr->pad_mode == PAD_MODE_DRUM) {
                    int dl;
                    for (dl = 0; dl < DRUM_LANES; dl++) {
                        drum_lane_t *dln = &tr->drum_clips[new_cidx].lanes[dl];
                        uint16_t dllen = dln->clip.length > 0 ? dln->clip.length : 1;
                        uint16_t dltps = dln->clip.ticks_per_step > 0 ? dln->clip.ticks_per_step : 24;
                        if (tr->drum_current_step[dl] >= dllen)
                            tr->drum_current_step[dl] = (uint16_t)(tr->drum_current_step[dl] % dllen);
                        if (tr->drum_tick_in_step[dl] >= (uint32_t)dltps)
                            tr->drum_tick_in_step[dl] = 0;
                    }
                }
                tr->clip_playing     = 1;
                tr->queued_clip      = -1;
                tr->pending_page_stop = 0;
                tr->will_relaunch    = 0;
            } else {
                /* Quantized or stopped: queue for next boundary */
                tr->queued_clip   = (int8_t)new_cidx;
                tr->will_relaunch = 0;
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

        /* tN_solo: set solo state; setting solo clears mute on same track */
        if (!strcmp(sub, "solo")) {
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
            if (!strcmp(val, "schwung"))
                tr->pfx.route = ROUTE_SCHWUNG;
            else if (!strcmp(val, "move"))
                tr->pfx.route = ROUTE_MOVE;
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

                if (*q == '\0') {
                    /* tN_cC_step_S — legacy on/off: reactivate/deactivate without touching notes.
                     * Safety: deny activation if step has no notes (prevents invariant violation). */
                    if (val[0] == '1') {
                        if (cl->step_note_count[sidx] > 0) cl->steps[sidx] = 1;
                    } else {
                        cl->steps[sidx] = 0;
                    }
                    {
                        int i, any = 0;
                        for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    return;
                }

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
                    if (!tr->recording) seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_gate")) {
                    if (cl->step_note_count[sidx] == 0) return;
                    { int gmax = SEQ_STEPS * cl->ticks_per_step; if (gmax > 65535) gmax = 65535;
                    cl->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, gmax); }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
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
                    if (!tr->recording) seq8_save_state(inst);
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
                        cl->steps[sidx]           = 0;
                    }
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)cl->length; k++) if (cl->steps[k]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
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
                    cl->steps[dstStep]           = cl->steps[sidx];
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)cl->length; k++) if (cl->steps[k]) { any = 1; break; }
                        cl->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(cl);
                    seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_pitch")) {
                    if (!cl->steps[sidx]) return;
                    int delta = my_atoi(val), n;
                    for (n = 0; n < (int)cl->step_note_count[sidx]; n++)
                        cl->step_notes[sidx][n] = (uint8_t)clamp_i(
                            (int)cl->step_notes[sidx][n] + delta, 0, 127);
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) seq8_save_state(inst);
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
                        if (!tr->recording) seq8_save_state(inst);
                    }
                    return;
                }
                return;
            }
            if (!strncmp(p, "_length", 7)) {
                cl->length = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS);
                clip_migrate_to_notes(cl);
                return;
            }
            if (!strncmp(p, "_clear", 6) && p[6] == '\0') {
                /* tN_cC_clear — atomically wipe all steps in clip */
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
                cl->active          = 0;
                cl->stretch_exp     = 0;
                cl->clock_shift_pos = 0;
                cl->nudge_pos       = 0;
                cl->ticks_per_step  = TICKS_PER_STEP;
                clip_pfx_params_init(&cl->pfx_params);
                cl->note_count = 0;
                memset(cl->notes, 0, sizeof(cl->notes));
                cl->occ_dirty = 1;
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
                seq8_save_state(inst);
                return;
            }
            if (!strncmp(p, "_clear_keep", 11) && p[11] == '\0') {
                /* tN_cC_clear_keep — wipe all steps, preserve playback state */
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
                cl->active          = 0;
                cl->stretch_exp     = 0;
                cl->clock_shift_pos = 0;
                cl->nudge_pos       = 0;
                cl->ticks_per_step  = TICKS_PER_STEP;
                clip_pfx_params_init(&cl->pfx_params);
                cl->note_count = 0;
                memset(cl->notes, 0, sizeof(cl->notes));
                cl->occ_dirty = 1;
                silence_track_notes_v2(inst, tr);
                pfx_sync_from_clip(tr);
                tr->rec_pending_count = 0;
                tr->recording = 0;
                if (tr->queued_clip == cidx) tr->queued_clip = -1;
                seq8_save_state(inst);
                return;
            }
            if (!strncmp(p, "_hard_reset", 11) && p[11] == '\0') {
                /* tN_cC_hard_reset — full factory reset: undo snapshot, silence, clip_init */
                undo_begin_single(inst, tidx, cidx);
                silence_track_notes_v2(inst, tr);
                clip_init(cl);
                if ((int)tr->active_clip == cidx)
                    pfx_sync_from_clip(tr);
                tr->rec_pending_count = 0;
                tr->recording = 0;
                if (tr->queued_clip == cidx) tr->queued_clip = -1;
                seq8_save_state(inst);
                return;
            }
            if (!strncmp(p, "_drum_clear", 11) && p[11] == '\0') {
                /* tN_cC_drum_clear val="0"=deactivate|"1"=keep transport
                 * Clears all lane step data in clip C; midi_note/length/tps/pfx preserved */
                int keep = my_atoi(val);
                int l, s;
                drum_clip_t *dc = &tr->drum_clips[cidx];
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
                seq8_save_state(inst);
                return;
            }
            if (!strncmp(p, "_drum_reset", 11) && p[11] == '\0') {
                /* tN_cC_drum_reset — factory reset all lanes in clip C
                 * clip_init on each lane's clip_t; midi_note preserved (sibling field in drum_lane_t) */
                int l;
                drum_clip_t *dc = &tr->drum_clips[cidx];
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
                seq8_save_state(inst);
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
            seq8_save_state(inst);
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
            if (tr->current_step >= cl->length) {
                tr->current_step = (uint16_t)(cl->length - 1);
                tr->tick_in_step = 0;
            }
            clip_build_steps_from_notes(cl);
            seq8_save_state(inst);
            return;
        }

        /* tN_pad_octave / tN_pad_mode */
        if (!strcmp(sub, "pad_octave")) {
            tr->pad_octave = (uint8_t)clamp_i(my_atoi(val), 0, 8);
            return;
        }
        if (!strcmp(sub, "pad_mode")) {
            tr->pad_mode = (uint8_t)clamp_i(my_atoi(val), 0, 1);
            return;
        }

        /* tN_lL_* — drum lane setters */
        if (sub[0] == 'l' && sub[1] >= '0' && sub[1] <= '9') {
            int lane_idx = 0;
            const char *p2 = sub + 1;
            while (*p2 >= '0' && *p2 <= '9') { lane_idx = lane_idx * 10 + (*p2 - '0'); p2++; }
            if (lane_idx < 0 || lane_idx >= DRUM_LANES) return;
            drum_lane_t *dlane = &tr->drum_clips[tr->active_clip].lanes[lane_idx];
            clip_t      *dlc   = &dlane->clip;

            if (!strcmp(p2, "_lane_note")) {
                dlane->midi_note = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                seq8_save_state(inst);
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
                seq8_save_state(inst);
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
                        uint8_t n2 = tr->drum_clips[tr->active_clip].lanes[ll].midi_note;
                        pfx_note_off(inst, tr, n2);
                    }
                } else {
                    tr->drum_lane_solo &= ~bit;
                }
                seq8_save_state(inst);
                return;
            }
            if (!strcmp(p2, "_clip_length")) {
                int newlen = clamp_i(my_atoi(val), 1, SEQ_STEPS);
                dlc->length = (uint16_t)newlen;
                if (tr->drum_current_step[lane_idx] >= (uint16_t)newlen)
                    tr->drum_current_step[lane_idx] = 0;
                seq8_save_state(inst);
                return;
            }
            if (!strcmp(p2, "_clear")) {
                /* tN_lL_clear — wipe all steps in this drum lane */
                int i;
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
                seq8_save_state(inst);
                return;
            }

            if (!strcmp(p2, "_hard_reset")) {
                /* tN_lL_hard_reset — full factory reset: clip_init; midi_note preserved */
                clip_init(dlc);
                tr->drum_current_step[lane_idx]   = 0;
                tr->drum_tick_in_step[lane_idx]   = 0;
                seq8_save_state(inst);
                return;
            }

            if (!strcmp(p2, "_loop_double_fill")) {
                int len = (int)dlc->length;
                int i;
                if (len * 2 > SEQ_STEPS) return;
                for (i = 0; i < len; i++) {
                    dlc->steps[len + i]           = dlc->steps[i];
                    memcpy(dlc->step_notes[len + i], dlc->step_notes[i], 8);
                    dlc->step_note_count[len + i] = dlc->step_note_count[i];
                    dlc->step_vel[len + i]        = dlc->step_vel[i];
                    dlc->step_gate[len + i]       = dlc->step_gate[i];
                    memcpy(dlc->note_tick_offset[len + i], dlc->note_tick_offset[i], 8 * sizeof(int16_t));
                }
                dlc->length = (uint16_t)(len * 2);
                if (tr->drum_current_step[lane_idx] >= dlc->length)
                    tr->drum_current_step[lane_idx] = (uint16_t)(dlc->length - 1);
                clip_migrate_to_notes(dlc);
                seq8_save_state(inst);
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
                seq8_save_state(inst);
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
                if (tr->drum_current_step[lane_idx] >= dlc->length)
                    tr->drum_current_step[lane_idx] = (uint16_t)(dlc->length - 1);
                any = 0;
                for (i = 0; i < (int)dlc->length; i++)
                    if (dlc->steps[i]) { any = 1; break; }
                dlc->active = (uint8_t)any;
                clip_migrate_to_notes(dlc);
                seq8_save_state(inst);
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
                seq8_save_state(inst);
                return;
            }

            if (!strcmp(p2, "_nudge")) {
                int dir = my_atoi(val);
                if (dir == 0) { dlc->nudge_pos = 0; seq8_save_state(inst); return; }
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
                        if (new_off > midpoint) {
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
                if (tr->drum_current_step[lane_idx] >= dlc->length) {
                    tr->drum_current_step[lane_idx] = (uint16_t)(dlc->length - 1);
                    tr->drum_tick_in_step[lane_idx] = 0;
                }
                clip_build_steps_from_notes(dlc);
                seq8_save_state(inst);
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
                pfx_set(inst, tr, &dlane->clip.pfx_params, pfx_key, sp);
                seq8_save_state(inst);
                return;
            }
            if (!strcmp(p2, "_pfx_reset")) {
                undo_begin_single(inst, tidx, (int)tr->active_clip);
                pfx_set(inst, tr, &dlane->clip.pfx_params, "pfx_reset", "1");
                seq8_save_state(inst);
                return;
            }

            /* tN_lL_copy_to "dstLane" — copy active clip's lane L to dstLane; preserve dst midi_note */
            if (!strcmp(p2, "_copy_to")) {
                int dstLane = clamp_i(my_atoi(val), 0, DRUM_LANES - 1);
                if (dstLane == lane_idx) return;
                {
                    drum_lane_t *dst = &tr->drum_clips[(int)tr->active_clip].lanes[dstLane];
                    uint8_t dst_midi_note = dst->midi_note;
                    undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                    memcpy(dst->clip.steps,            dlc->steps,            SEQ_STEPS);
                    memcpy(dst->clip.step_notes,       dlc->step_notes,       SEQ_STEPS * 8);
                    memcpy(dst->clip.step_note_count,  dlc->step_note_count,  SEQ_STEPS);
                    memcpy(dst->clip.step_vel,         dlc->step_vel,         SEQ_STEPS);
                    memcpy(dst->clip.step_gate,        dlc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                    memcpy(dst->clip.note_tick_offset, dlc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                    dst->clip.length        = dlc->length;
                    dst->clip.ticks_per_step = dlc->ticks_per_step;
                    dst->clip.active        = dlc->active;
                    dst->midi_note          = dst_midi_note;
                    clip_migrate_to_notes(&dst->clip);
                    seq8_save_state(inst);
                }
                return;
            }

            /* tN_lL_cut_to "dstLane" — copy then clear src; atomic undo */
            if (!strcmp(p2, "_cut_to")) {
                int dstLane = clamp_i(my_atoi(val), 0, DRUM_LANES - 1);
                if (dstLane == lane_idx) return;
                {
                    drum_lane_t *dst = &tr->drum_clips[(int)tr->active_clip].lanes[dstLane];
                    uint8_t dst_midi_note = dst->midi_note;
                    uint8_t src_midi_note = dlane->midi_note;
                    undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                    memcpy(dst->clip.steps,            dlc->steps,            SEQ_STEPS);
                    memcpy(dst->clip.step_notes,       dlc->step_notes,       SEQ_STEPS * 8);
                    memcpy(dst->clip.step_note_count,  dlc->step_note_count,  SEQ_STEPS);
                    memcpy(dst->clip.step_vel,         dlc->step_vel,         SEQ_STEPS);
                    memcpy(dst->clip.step_gate,        dlc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                    memcpy(dst->clip.note_tick_offset, dlc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                    dst->clip.length        = dlc->length;
                    dst->clip.ticks_per_step = dlc->ticks_per_step;
                    dst->clip.active        = dlc->active;
                    dst->midi_note          = dst_midi_note;
                    clip_migrate_to_notes(&dst->clip);
                    pfx_note_off_imm(inst, tr, src_midi_note);
                    clip_init(dlc);
                    dlane->midi_note = src_midi_note;
                    seq8_save_state(inst);
                }
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
                        if (was_on) pfx_note_off_imm(inst, tr, dlane->midi_note);
                    }
                    { int i, any = 0;
                      for (i = 0; i < SEQ_STEPS; i++) if (dlc->steps[i]) { any = 1; break; }
                      dlc->active = (uint8_t)any; }
                    clip_migrate_to_notes(dlc);
                    seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_clear")) {
                    dlc->steps[sidx]          = 0;
                    dlc->step_note_count[sidx] = 0;
                    dlc->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                    dlc->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                    memset(dlc->note_tick_offset[sidx], 0, sizeof(dlc->note_tick_offset[sidx]));
                    { int i, any = 0;
                      for (i = 0; i < SEQ_STEPS; i++) if (dlc->steps[i]) { any = 1; break; }
                      dlc->active = (uint8_t)any; }
                    clip_migrate_to_notes(dlc);
                    pfx_note_off_imm(inst, tr, dlane->midi_note);
                    seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_vel")) {
                    if (dlc->step_note_count[sidx] == 0) return;
                    dlc->step_vel[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                    clip_migrate_to_notes(dlc);
                    seq8_save_state(inst);
                    return;
                }
                if (!strcmp(q, "_gate")) {
                    if (dlc->step_note_count[sidx] == 0) return;
                    dlc->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, 65535);
                    clip_migrate_to_notes(dlc);
                    seq8_save_state(inst);
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
                    seq8_save_state(inst);
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
                        dlc->steps[sidx]           = 0;
                    }
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)dlc->length; k++) if (dlc->steps[k]) { any = 1; break; }
                        dlc->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(dlc);
                    seq8_save_state(inst);
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
                    dlc->steps[dstStep]           = dlc->steps[sidx];
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)dlc->length; k++) if (dlc->steps[k]) { any = 1; break; }
                        dlc->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(dlc);
                    seq8_save_state(inst);
                    return;
                }
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
                if (tr->clip_playing) {
                    tr->recording = 1;
                } else if (tr->queued_clip >= 0) {
                    tr->record_armed = 1;
                } else {
                    tr->recording = 1;
                }
            } else {
                finalize_pending_notes(&tr->clips[tr->active_clip], tr);
                clip_clear_suppress(&tr->clips[tr->active_clip]);
                tr->recording    = 0;
                tr->record_armed = 0;
            }
            return;
        }

        if (!strcmp(sub, "record_note_on")) {
            /* tN_record_note_on "p1 v1 [p2 v2 ...]"
             * JS batches all chord note-ons into one call to survive set_param coalescing.
             * DSP snapshots current_clip_tick once and inserts all notes at the same tick. */
            if (!tr->recording) return;
            clip_t *cl = &tr->clips[tr->active_clip];

            /* Snapshot tick once for the whole chord */
            uint32_t abs_tick = tr->current_clip_tick;
            uint16_t tps = cl->ticks_per_step;
            uint32_t clip_ticks = (uint32_t)cl->length * tps;
            if (clip_ticks == 0) return;
            abs_tick = abs_tick % clip_ticks;
            if (inst->inp_quant)
                abs_tick = (abs_tick / tps) * tps;

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
                if (inst->input_vel > 0) vel = (int)inst->input_vel;

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

                /* Mirror to step arrays */
                {
                    uint16_t sidx = (uint16_t)(abs_tick / tps);
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
                 * would race/coalesce with this record_note_on call. */
                if (tr->pfx.route == ROUTE_MOVE)
                    pfx_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
            }
            return;
        }

        if (!strcmp(sub, "record_note_off")) {
            /* tN_record_note_off "p1 [p2 ...]"
             * JS batches simultaneous chord releases into one call.
             * DSP snapshots off_tick once and updates gate for each pitch. */
            if (!tr->recording) return;
            clip_t *cl = &tr->clips[tr->active_clip];

            uint32_t off_tick = tr->current_clip_tick;
            uint16_t tps = cl->ticks_per_step;
            uint32_t clip_ticks = (uint32_t)cl->length * tps;
            if (clip_ticks == 0) return;
            off_tick = off_tick % clip_ticks;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);

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

                /* Mirror gate to step arrays */
                {
                    uint16_t sidx = (uint16_t)(on_tick / tps);
                    if (sidx < SEQ_STEPS && cl->steps[sidx])
                        cl->step_gate[sidx] = (uint16_t)gate_ticks;
                }

                /* Remove rec_pending slot */
                tr->rec_pending[ri] = tr->rec_pending[tr->rec_pending_count - 1];
                tr->rec_pending_count--;

                /* Live monitoring for ROUTE_MOVE */
                if (tr->pfx.route == ROUTE_MOVE)
                    pfx_note_off_imm(inst, tr, (uint8_t)pitch);
            }
            return;
        }

        if (!strcmp(sub, "drum_mute_all_clear")) {
            /* tN_drum_mute_all_clear: unmute and unsolo all drum lanes. */
            tr->drum_lane_mute = 0;
            tr->drum_lane_solo = 0;
            seq8_save_state(inst);
            return;
        }

        if (!strcmp(sub, "drum_lanes_qnt")) {
            /* tN_drum_lanes_qnt "value" — set NoteFX quantize on all 32 lanes of active drum clip. */
            int v = clamp_i(my_atoi(val), 0, 100);
            drum_clip_t *dc = &tr->drum_clips[tr->active_clip];
            int l;
            for (l = 0; l < DRUM_LANES; l++)
                dc->lanes[l].clip.pfx_params.quantize = (uint8_t)v;
            seq8_save_state(inst);
            return;
        }

        if (!strcmp(sub, "drum_record_note_on")) {
            /* tN_drum_record_note_on "pitch vel"
             * Routes to the drum lane whose midi_note matches pitch.
             * Inserts a step hit at the lane's current playback position.
             * Gate is GATE_TICKS (fixed); no note-off tracking needed for drums. */
            if (!tr->recording) return;
            {
                int ac = (int)tr->active_clip;
                drum_clip_t *dc = &tr->drum_clips[ac];
                const char *sp = val;
                while (*sp == ' ') sp++;
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
                if (inst->input_vel > 0) vel = (int)inst->input_vel;
                /* Find lane by matching midi_note */
                int lane = -1;
                { int l; for (l = 0; l < DRUM_LANES; l++) {
                    if (dc->lanes[l].midi_note == (uint8_t)pitch) { lane = l; break; }
                }}
                if (lane >= 0) {
                    clip_t   *dlc  = &dc->lanes[lane].clip;
                    uint16_t  step = tr->drum_current_step[lane];
                    if (step < dlc->length && dlc->step_note_count[step] == 0) {
                        dlc->step_notes[step][0]       = (uint8_t)pitch;
                        dlc->step_note_count[step]     = 1;
                        dlc->step_vel[step]            = (uint8_t)vel;
                        dlc->step_gate[step]           = (uint16_t)GATE_TICKS;
                        /* inp_quant OFF: capture sub-step timing (like melodic record_note_on).
                         * inp_quant ON:  snap to step boundary (offset=0). */
                        dlc->note_tick_offset[step][0] = inst->inp_quant
                            ? 0 : (int16_t)tr->drum_tick_in_step[lane];
                        dlc->steps[step]               = 1;
                        dlc->active                    = 1;
                        clip_migrate_to_notes(dlc);
                        /* Save deferred to recording=0 or next step operation */
                    }
                    if (tr->pfx.route == ROUTE_MOVE)
                        pfx_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
                }
            }
            return;
        }

        if (!strcmp(sub, "live_notes")) {
            /* tN_live_notes "off p off p on p v on p v ..."
             * Batched live note events; offs always precede ons in the JS flush.
             * Routes through pfx_note_on/pfx_note_off_imm so play effects apply. */
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
                    if (inst->input_vel > 0) vel = (int)inst->input_vel;
                    pfx_note_on(inst, tr, (uint8_t)pitch, (uint8_t)clamp_i(vel, 1, 127));
                } else {
                    pfx_note_off_imm(inst, tr, (uint8_t)pitch);
                }
            }
            return;
        }

        if (!strcmp(sub, "clip_length")) {
            clip_t *cl = &tr->clips[tr->active_clip];
            cl->length = (uint16_t)clamp_i(my_atoi(val), 1, SEQ_STEPS);
            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);
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

            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);

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
            int i;
            if (len * 2 > SEQ_STEPS) return;
            undo_begin_single(inst, tidx, (int)tr->active_clip);
            for (i = 0; i < len; i++) {
                cl->steps[len + i]           = cl->steps[i];
                memcpy(cl->step_notes[len + i], cl->step_notes[i], 8);
                cl->step_note_count[len + i] = cl->step_note_count[i];
                cl->step_vel[len + i]        = cl->step_vel[i];
                cl->step_gate[len + i]       = cl->step_gate[i];
                memcpy(cl->note_tick_offset[len + i], cl->note_tick_offset[i], 8 * sizeof(int16_t));
            }
            cl->length = (uint16_t)(len * 2);
            if (tr->current_step >= cl->length)
                tr->current_step = (uint16_t)(cl->length - 1);
            clip_migrate_to_notes(cl);
            seq8_save_state(inst);
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

