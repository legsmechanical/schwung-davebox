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
        /* Format: "S V" — step index 0..7; V = 0 (step off), 1..127 (absolute
         * velocity), >127 = Thru (255: pass incoming velocity through). */
        const char *p = val;
        int s = 0, lv = 0;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') { lv = lv * 10 + (*p - '0'); p++; }
        if (s < 0 || s > 7) return;
        lv = lv > 127 ? 255 : clamp_i(lv, 0, 127);
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
        for (_i = 0; _i < 8; _i++) cp->seq_arp_step_vel[_i] = 255;   /* Thru */
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
    capture_clear(inst);   /* Move parity: transport edge drops capture input */
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
    capture_clear(inst);   /* Move parity: transport edge drops capture input */
    inst->cap_select_active = 0;   /* stopping transport closes the tempo selector */
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

/* ------------------------------------------------------------------ */
/* Retrospective Capture commit (Move-style Capture MIDI)               */
/* ------------------------------------------------------------------ */

/* Manual |x| (no math.h in this TU). */
static double cap_fabs(double x) { return x < 0.0 ? -x : x; }

/* Estimate tempo candidates for the frozen take (cap_take[] note onsets):
 * fill inst->cap_bpm_est[] (ascending) + cap_bpm_count, and return the default
 * candidate index (best fit), or -1 when there isn't enough rhythm.
 *
 * Method (closer to native than the old median-IOI guess): score every integer
 * BPM in [CAP_BPM_MIN, CAP_BPM_MAX] by how well the onsets fit a 1/16 grid,
 * measured in BEAT units so faster tempos aren't unfairly favored, plus a bonus
 * for the take spanning near-integer bars (so the loop lands cleanly) and a mild
 * pull toward a comfortable tempo to break octave ties. The distinct local
 * minima of that score become the candidates the user can wheel through. */
/* Candidate-tempo search range. Kept aligned with the manual BPM control's
 * accepted range (the "bpm" set_param handler = 40..250) so Capture can suggest
 * any tempo you could also dial by hand. (The internal clock/apply clamp is
 * wider, 20..400.) */
#define CAP_BPM_MIN 40
#define CAP_BPM_MAX 250
static int capture_estimate_tempos(seq8_instance_t *inst) {
    static double onset[512];
    int n = 0, i, j;
    double span = 1.0;
    for (i = 0; i < (int)inst->cap_take_count; i++) {
        double rel = (double)(inst->cap_take[i].frame - inst->cap_take_first);
        if (rel > span) span = rel;   /* full take duration incl. note-offs */
        if (inst->cap_take[i].type == CAP_EV_NOTE_ON && n < 512) onset[n++] = rel;
    }
    if (n < 3) { inst->cap_bpm_count = 0; return -1; }

    double sr = (double)inst->sample_rate;
    static double score[CAP_BPM_MAX - CAP_BPM_MIN + 1];
    int b;
    for (b = CAP_BPM_MIN; b <= CAP_BPM_MAX; b++) {
        double fpb  = sr * 60.0 / (double)b;         /* frames per quarter */
        double gerr = 0.0;
        for (i = 0; i < n; i++) {
            double bp = onset[i] / fpb;              /* position in beats */
            double q  = (double)((int)(bp * 4.0 + 0.5)) / 4.0;  /* nearest 1/16 */
            gerr += cap_fabs(bp - q);
        }
        gerr /= (double)n;                           /* avg 1/16 error (beats) */
        /* Grid fit dominates. Evenly-spaced input fits many tempos on a 1/16
         * grid (120-quarters == 150-at-5/16 == 90-dotted-8ths…), so a comfort
         * pull toward ~120 breaks those octave/ratio ties; a small bar-fit term
         * nudges toward a clean loop length without overriding grid alignment. */
        double bars  = (span / fpb) / 4.0;           /* take span in 4/4 bars */
        double berr  = cap_fabs(bars - (double)((int)(bars + 0.5)));
        double comf  = cap_fabs((double)b - 120.0) / 120.0;
        score[b - CAP_BPM_MIN] = gerr + 0.01 * berr + 0.03 * comf;
    }

    /* Distinct local minima → candidates (keep the best CAP_MAX_CAND). */
    double cand[CAP_MAX_CAND], csc[CAP_MAX_CAND];
    int nc = 0;
    for (b = CAP_BPM_MIN; b <= CAP_BPM_MAX; b++) {
        int idx = b - CAP_BPM_MIN;
        double s = score[idx];
        int lo = (idx == 0)         || score[idx - 1] >= s;
        int hi = (b == CAP_BPM_MAX) || score[idx + 1] >  s;
        if (!(lo && hi)) continue;
        int dup = 0, k;
        for (k = 0; k < nc; k++) {
            double r = cand[k] > (double)b ? cand[k] / (double)b : (double)b / cand[k];
            if (r < 1.03) { dup = 1; break; }        /* within 3% — same tempo */
        }
        if (dup) continue;
        if (nc < CAP_MAX_CAND) { cand[nc] = (double)b; csc[nc] = s; nc++; }
        else {
            int worst = 0;
            for (k = 1; k < nc; k++) if (csc[k] > csc[worst]) worst = k;
            if (s < csc[worst]) { cand[worst] = (double)b; csc[worst] = s; }
        }
    }
    if (nc == 0) { inst->cap_bpm_count = 0; return -1; }

    /* Guarantee the double/half-time equivalents of the best fit are offered
     * (when in range) — they're the expected alternatives to a best guess. If a
     * grid-fit candidate already sits near an octave (e.g. 174 vs 2x87), snap it
     * to the exact octave so the user gets the tempo they expect. */
    int best0 = 0, k;
    for (i = 1; i < nc; i++) if (csc[i] < csc[best0]) best0 = i;
    double best_bpm = cand[best0];
    double octs[2] = { (double)((int)(best_bpm * 0.5 + 0.5)), best_bpm * 2.0 };
    for (i = 0; i < 2; i++) {
        double v = octs[i];
        if (v < (double)CAP_BPM_MIN || v > (double)CAP_BPM_MAX) continue;
        int hit = -1;
        for (k = 0; k < nc; k++) {
            double r = cand[k] > v ? cand[k] / v : v / cand[k];
            if (r < 1.03) { hit = k; break; }
        }
        if (hit >= 0) {
            if (hit != best0) cand[hit] = v;           /* snap neighbor to the exact octave */
        } else if (nc < CAP_MAX_CAND) {
            cand[nc] = v; csc[nc] = csc[best0] + 1.0; nc++;
        } else {
            int worst = -1; double wsc = -1.0;
            for (k = 0; k < nc; k++) {
                if (k == best0) continue;
                if (csc[k] > wsc) { wsc = csc[k]; worst = k; }
            }
            if (worst >= 0) { cand[worst] = v; csc[worst] = csc[best0] + 1.0; }
        }
    }

    for (i = 0; i < nc; i++) for (j = i + 1; j < nc; j++)
        if (cand[j] < cand[i]) {
            double t = cand[i]; cand[i] = cand[j]; cand[j] = t;
            t = csc[i]; csc[i] = csc[j]; csc[j] = t;
        }
    int best = 0;
    for (i = 0; i < nc; i++) if (cand[i] == best_bpm) best = i;

    for (i = 0; i < nc; i++) inst->cap_bpm_est[i] = cand[i];
    inst->cap_bpm_count = (uint8_t)nc;
    return best;
}

/* Find the matching note-off for the note-on at ring offset i (same track,
 * same pitch, first unconsumed off after i). Returns ring offset or -1. */
static int cap_find_off(seq8_instance_t *inst, int tidx, int i, uint8_t pitch,
                        uint8_t *off_used) {
    int j;
    for (j = i + 1; j < (int)inst->cap_count; j++) {
        const cap_ev_t *ev = &inst->cap_ring[(inst->cap_head + j) % CAP_MAX_EVENTS];
        if (ev->track == (uint8_t)tidx && ev->type == CAP_EV_NOTE_OFF &&
            ev->a == pitch && !off_used[j]) {
            off_used[j] = 1;
            return j;
        }
    }
    return -1;
}

/* True when no clip anywhere in the session holds note data — the condition
 * under which a stopped-transport capture is allowed to set the tempo and
 * start a fresh take (Move parity: tempo detection only happens in a blank
 * Set). Scans all melodic clips + allocated drum lanes. */
static int capture_session_empty(seq8_instance_t *inst) {
    int t, c, l;
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr = &inst->tracks[t];
        for (c = 0; c < NUM_CLIPS; c++)
            if (tr->clips[c].note_count > 0) return 0;
        for (c = 0; c < NUM_CLIPS; c++) {
            if (!tr->drum_clips[c]) continue;
            for (l = 0; l < DRUM_LANES; l++)
                if (tr->drum_clips[c]->lanes[l].clip.note_count > 0) return 0;
        }
    }
    return 1;
}

/* Apply a BPM to davebox's internal clock (mirrors the "bpm" set_param body).
 * Read-only under clock-follow (Move owns tempo there). */
static void capture_apply_bpm(seq8_instance_t *inst, double bpm) {
    if (inst->clock_follow_on) return;
    if (bpm < 20.0) bpm = 20.0;
    if (bpm > 400.0) bpm = 400.0;
    inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
    int tb, tbl;
    for (tb = 0; tb < NUM_TRACKS; tb++) {
        inst->tracks[tb].pfx.cached_bpm = bpm;
        for (tbl = 0; tbl < DRUM_LANES; tbl++)
            inst->tracks[tb].drum_lane_pfx[tbl].cached_bpm = bpm;
    }
}

/* Find the matching note-off for the take note-on at index i (first unconsumed
 * off with the same pitch after i). Returns take index or -1. */
static int cap_take_find_off(seq8_instance_t *inst, int i, uint8_t pitch,
                             uint8_t *off_used) {
    int j;
    for (j = i + 1; j < (int)inst->cap_take_count; j++) {
        const cap_take_ev_t *ev = &inst->cap_take[j];
        if (ev->type == CAP_EV_NOTE_OFF && ev->a == pitch && !off_used[j]) {
            off_used[j] = 1;
            return j;
        }
    }
    return -1;
}

/* (Re-)derive the frozen stopped-capture take (cap_take[]) into clip `clip`.
 * Two modes:
 *   target_len_steps == 0  — TEMPO mode: frames→ticks at `bpm`, bar-rounded
 *     length, and `bpm` applied to the transport. Real-time timing preserved
 *     at every BPM; only the grid / loop length changes.
 *   target_len_steps  > 0  — WARP mode: the take is linearly stretched/squeezed
 *     to fill exactly that many steps at the EXISTING tempo (bpm unchanged) —
 *     compress if played longer, expand if shorter. No grid snapping.
 * Returns 1 if anything wrote. */
static int capture_write_take(seq8_instance_t *inst, int tidx, int clip,
                              double bpm, int target_len_steps) {
    if (!inst || tidx < 0 || tidx >= NUM_TRACKS) return 0;
    if (clip < 0 || clip >= NUM_CLIPS) return 0;
    seq8_track_t *tr = &inst->tracks[tidx];
    int is_drum = inst->cap_take_is_drum;
    clip_t *mcl = &tr->clips[clip];
    uint16_t tps = mcl->ticks_per_step ? mcl->ticks_per_step : TICKS_PER_STEP;
    int warp = (target_len_steps > 0);
    uint32_t loop_ticks = (uint32_t)target_len_steps * tps;   /* warp: fixed loop */
    double fpt;
    if (warp) {
        /* Stretch the take's whole span onto cap_warp_ticks ticks (fine), or the
         * loop's full length when the fine offset is unset. A warp span longer
         * than the loop pushes the tail past the last bar (dropped below). */
        double span = (double)inst->cap_take_span;
        if (span < 1.0) span = 1.0;
        double wt = (inst->cap_warp_ticks > 0)
            ? (double)inst->cap_warp_ticks : (double)loop_ticks;
        if (wt < 1.0) wt = 1.0;
        fpt = span / wt;
    } else {
        fpt = (double)inst->sample_rate * 60.0 / (bpm * (double)tps * 4.0);
    }
    if (fpt <= 0.0) fpt = 1.0;

    /* Wipe the target so re-tempo is a clean rewrite. */
    if (!is_drum) {
        clip_init(mcl);
        mcl->ticks_per_step = tps;
    } else if (tr->drum_clips[clip]) {
        int l;
        for (l = 0; l < DRUM_LANES; l++) {
            clip_init(&tr->drum_clips[clip]->lanes[l].clip);
            tr->drum_clips[clip]->lanes[l].clip.ticks_per_step = tps;
        }
    }
    cc_auto_reset(&tr->clip_cc_auto[clip]);

    static uint8_t off_used[CAP_MAX_EVENTS];
    memset(off_used, 0, (size_t)inst->cap_take_count);
    uint8_t  cc_touched = 0;
    uint32_t span_end   = 1;
    int      wrote = 0, i;
    for (i = 0; i < (int)inst->cap_take_count; i++) {
        const cap_take_ev_t *ev = &inst->cap_take[i];
        uint32_t ct = (uint32_t)((double)(ev->frame - inst->cap_take_first) / fpt + 0.5);
        /* Warp fine: drop events scaled past the end of the last bar. */
        if (warp && ct >= loop_ticks) continue;
        if (ev->type == CAP_EV_CC) {
            cc_auto_set_point(&tr->clip_cc_auto[clip], ev->a,
                              (uint16_t)(ct <= 65534 ? ct : 65534), ev->b);
            cc_touched |= (uint8_t)(1u << (ev->a & 7));
            if (ct + 1 > span_end) span_end = ct + 1;
            wrote = 1;
        } else if (ev->type == CAP_EV_NOTE_ON) {
            int j = cap_take_find_off(inst, i, ev->a, off_used);
            uint32_t gate = (j >= 0)
                ? (uint32_t)((double)(inst->cap_take[j].frame - ev->frame) / fpt + 0.5)
                : (uint32_t)tps;
            if (gate < 1)      gate = 1;
            if (gate > 65535u) gate = 65535u;
            if (!is_drum) {
                clip_insert_note(mcl, ct, (uint16_t)gate, ev->a, ev->b);
                wrote = 1;
            } else if (tr->drum_clips[clip]) {
                int l;
                for (l = 0; l < DRUM_LANES; l++) {
                    drum_lane_t *ln = &tr->drum_clips[clip]->lanes[l];
                    if (ln->midi_note != ev->a) continue;
                    clip_insert_note(&ln->clip, ct, (uint16_t)gate, ev->a, ev->b);
                    wrote = 1;
                    break;
                }
            }
            if (ct + gate > span_end) span_end = ct + gate;
        }
    }

    /* Length: warp mode is exactly the target; tempo mode bar-rounds the span. */
    uint32_t len_steps;
    if (warp) {
        len_steps = (uint32_t)target_len_steps;
    } else {
        uint32_t bar = (uint32_t)tps * 16u;
        len_steps = ((span_end + bar - 1) / bar) * 16u;
    }
    if (len_steps < 16)  len_steps = 16;
    if (len_steps > 256) len_steps = 256;
    inst->cap_last_len_steps = (uint16_t)len_steps;
    if (!is_drum) {
        mcl->length = (uint16_t)len_steps;
    } else if (tr->drum_clips[clip]) {
        int l;
        for (l = 0; l < DRUM_LANES; l++)
            tr->drum_clips[clip]->lanes[l].clip.length = (uint16_t)len_steps;
    }

    if (!is_drum && mcl->note_count > 0) clip_build_steps_from_notes(mcl);
    if (is_drum && tr->drum_clips[clip]) {
        int l;
        for (l = 0; l < DRUM_LANES; l++) {
            clip_t *lc = &tr->drum_clips[clip]->lanes[l].clip;
            if (lc->note_count > 0) clip_build_steps_from_notes(lc);
        }
    }
    if (cc_touched) {
        int k;
        for (k = 0; k < 8; k++) {
            if (!(cc_touched & (1u << k))) continue;
            cc_auto_decimate(&tr->clip_cc_auto[clip], k);
            tr->cc_auto_last_sent[k] = 0xFF;
        }
    }
    if (!warp) capture_apply_bpm(inst, bpm);   /* warp keeps the session tempo */
    inst->state_dirty = 1;
    rui_mark(inst, tidx, clip);
    return wrote;
}

/* Commit the capture ring's events for track tidx into clip `clip`.
 *
 * Transport running: overdub — notes land at the abs-master-tick position
 * mapped into the target clip's loop window (raw timing, no quantize; when
 * the target IS the track's active playing clip the snapshotted
 * current_clip_tick is used directly, which respects playback direction).
 * Clip length is never changed.
 *
 * Transport stopped: Move-style new-clip capture — the first played event
 * defines the clip start; when the target clip is empty and the tempo is
 * ours to set (not clock-follow), a BPM estimate is derived from the median
 * inter-onset interval (three octave candidates, the one nearest 120 in log
 * space is applied — playback speed matches the performance regardless of
 * choice), the clip length is the event span rounded up to a 16-step bar,
 * the clip is armed and the transport started so the take plays back
 * immediately. A non-empty target keeps its length + the current tempo.
 *
 * Returns 1 if anything was written (ring is then consumed). */
static int capture_commit(seq8_instance_t *inst, int tidx, int clip) {
    if (!inst || tidx < 0 || tidx >= NUM_TRACKS) return 0;
    if (clip < 0 || clip >= NUM_CLIPS) return 0;
    seq8_track_t *tr = &inst->tracks[tidx];
    int is_drum = (tr->pad_mode == PAD_MODE_DRUM);
    static uint8_t off_used[CAP_MAX_EVENTS];   /* set_param context is single-
                                                * threaded with render — static
                                                * scratch keeps the stack small */
    memset(off_used, 0, (size_t)inst->cap_count);

    if (capture_pending_for_track(inst, tidx) == 0) return 0;

    clip_t *mcl = &tr->clips[clip];   /* melodic clip; window host for CC too */
    uint16_t tps = mcl->ticks_per_step ? mcl->ticks_per_step : TICKS_PER_STEP;
    uint32_t ws  = (uint32_t)mcl->loop_start * tps;
    uint32_t wl  = (uint32_t)mcl->length * tps;
    uint8_t  cc_touched = 0;
    int      wrote = 0;
    int      i;

    if (inst->playing) {
        uint32_t now_abs = inst->global_tick * TICKS_PER_STEP
                         + inst->master_tick_in_step;
        if (!is_drum) undo_begin_single(inst, tidx, clip);
        if (is_drum && !tr->drum_clips[clip]) drum_clips_alloc(inst, tr);

        /* If the target clip is EMPTY, this is a first take: lay the phrase out
         * from the first played note to the last (sized to fit), rather than
         * wrapping into the clip's default 1-bar window. Non-empty = true
         * overdub: notes land at their heard position and the length is kept. */
        int mcl_empty;
        if (!is_drum) {
            mcl_empty = (mcl->note_count == 0);
        } else {
            mcl_empty = 1;
            if (tr->drum_clips[clip]) { int l;
                for (l = 0; l < DRUM_LANES; l++)
                    if (tr->drum_clips[clip]->lanes[l].clip.note_count > 0) { mcl_empty = 0; break; }
            }
        }
        /* First event's absolute tick + its clip-tick (where the phrase begins
         * in the loop). Empty-clip notes are laid out from there, unwrapped, so
         * a phrase longer than the clip extends it instead of wrapping. */
        uint32_t first_abs = 0, first_ct = 0; int have_first = 0;
        for (i = 0; i < (int)inst->cap_count; i++) {
            const cap_ev_t *ev = &inst->cap_ring[(inst->cap_head + i) % CAP_MAX_EVENTS];
            if (ev->track != (uint8_t)tidx) continue;
            if (ev->type == CAP_EV_NOTE_ON || ev->type == CAP_EV_CC) {
                first_abs = ev->abs_tick; first_ct = ev->ctick; have_first = 1; break;
            }
        }
        int fresh = mcl_empty && have_first;
        uint32_t span_end = 0;

        for (i = 0; i < (int)inst->cap_count; i++) {
            const cap_ev_t *ev = &inst->cap_ring[(inst->cap_head + i) % CAP_MAX_EVENTS];
            if (ev->track != (uint8_t)tidx) continue;
            if (ev->type == CAP_EV_CC) {
                uint32_t ct = fresh
                    ? first_ct + (ev->abs_tick - first_abs)
                    : ws + (wl ? (ev->abs_tick % wl) : 0);
                cc_auto_set_point(&tr->clip_cc_auto[clip], ev->a,
                                  (uint16_t)(ct <= 65534 ? ct : 65534), ev->b);
                cc_touched |= (uint8_t)(1u << (ev->a & 7));
                if (ct + 1 > span_end) span_end = ct + 1;
                wrote = 1;
            } else if (ev->type == CAP_EV_NOTE_ON) {
                int j = cap_find_off(inst, tidx, i, ev->a, off_used);
                uint32_t end_abs = (j >= 0)
                    ? inst->cap_ring[(inst->cap_head + j) % CAP_MAX_EVENTS].abs_tick
                    : now_abs;
                uint32_t gate = end_abs > ev->abs_tick ? end_abs - ev->abs_tick : 1;
                if (gate < 1)      gate = 1;
                if (gate > 65535u) gate = 65535u;
                if (!is_drum) {
                    uint32_t ct = fresh
                        ? first_ct + (ev->abs_tick - first_abs)
                        : (clip == (int)tr->active_clip && tr->clip_playing)
                            ? ev->ctick
                            : ws + (wl ? (ev->abs_tick % wl) : 0);
                    clip_insert_note(mcl, ct, (uint16_t)gate, ev->a, ev->b);
                    if (ct + gate > span_end) span_end = ct + gate;
                    wrote = 1;
                } else if (tr->drum_clips[clip]) {
                    int l;
                    for (l = 0; l < DRUM_LANES; l++) {
                        drum_lane_t *ln = &tr->drum_clips[clip]->lanes[l];
                        if (ln->midi_note != ev->a) continue;
                        uint16_t ltps = ln->clip.ticks_per_step
                                      ? ln->clip.ticks_per_step : TICKS_PER_STEP;
                        uint32_t lws  = (uint32_t)ln->clip.loop_start * ltps;
                        uint32_t lwl  = (uint32_t)ln->clip.length * ltps;
                        uint32_t ct = fresh
                            ? lws + (ev->abs_tick - first_abs)
                            : lws + (lwl ? (ev->abs_tick % lwl) : 0);
                        clip_insert_note(&ln->clip, ct, (uint16_t)gate, ev->a, ev->b);
                        if (ct + gate > span_end) span_end = ct + gate;
                        wrote = 1;
                        break;
                    }
                }
            }
        }
        /* Empty first-take: grow the clip to a whole number of bars spanning
         * the phrase (default 1-bar wrap otherwise). */
        if (fresh && wrote) {
            uint32_t bar = (uint32_t)tps * 16u;
            uint32_t span = span_end > 0 ? span_end : 1;
            uint32_t len_steps = ((span + bar - 1) / bar) * 16u;
            if (len_steps < 16)  len_steps = 16;
            if (len_steps > 256) len_steps = 256;
            if (!is_drum) {
                mcl->length = (uint16_t)len_steps;
            } else if (tr->drum_clips[clip]) {
                int l;
                for (l = 0; l < DRUM_LANES; l++)
                    tr->drum_clips[clip]->lanes[l].clip.length = (uint16_t)len_steps;
            }
        }
        inst->cap_last_was_stopped = 0;
        inst->cap_select_active    = 0;   /* overdub never opens the selector */
        inst->cap_bpm_est[0]       = (double)tr->pfx.cached_bpm;
        inst->cap_bpm_count        = 1;
        inst->cap_select_idx       = 0;
        inst->cap_last_len_steps   = mcl->length;

        if (!wrote) return 0;
        if (!is_drum && mcl->note_count > 0) clip_build_steps_from_notes(mcl);
        if (is_drum && tr->drum_clips[clip]) {
            int l;
            for (l = 0; l < DRUM_LANES; l++) {
                clip_t *lc = &tr->drum_clips[clip]->lanes[l].clip;
                if (lc->note_count > 0) clip_build_steps_from_notes(lc);
            }
        }
        if (cc_touched) {
            int k;
            for (k = 0; k < 8; k++) {
                if (!(cc_touched & (1u << k))) continue;
                cc_auto_decimate(&tr->clip_cc_auto[clip], k);
                if (clip == (int)tr->active_clip) tr->cc_auto_last_sent[k] = 0xFF;
            }
        }
        inst->cap_commit_seq++;
        inst->state_dirty = 1;
        rui_mark(inst, tidx, clip);
        capture_clear(inst);
        return 1;
    }

    /* ---- Transport stopped ----
     * Empty session (and not clock-follow) → detect + SET the tempo (candidates
     * = BPMs). Otherwise the tempo is already established, so WARP the take to
     * fit it (candidates = bar lengths; tempo never changed). The destination
     * clip is empty either way (JS commits to the focused clip when empty, else
     * has the user pick an empty one). */

    /* Snapshot the take into cap_take[] (frame-stamped) so the selector can
     * re-derive it at any tempo / bar length without cumulative rounding, and
     * record its span (frames) for warp mode. */
    uint64_t first_frame = 0, last_frame = 0;
    int      have_first  = 0;
    inst->cap_take_count = 0;
    for (i = 0; i < (int)inst->cap_count; i++) {
        const cap_ev_t *ev = &inst->cap_ring[(inst->cap_head + i) % CAP_MAX_EVENTS];
        if (ev->track != (uint8_t)tidx) continue;
        if (!have_first && (ev->type == CAP_EV_NOTE_ON || ev->type == CAP_EV_CC)) {
            first_frame = ev->frame; have_first = 1;
        }
        if (ev->frame > last_frame) last_frame = ev->frame;
        if (inst->cap_take_count < CAP_MAX_EVENTS) {
            cap_take_ev_t *te = &inst->cap_take[inst->cap_take_count++];
            te->frame = ev->frame;
            te->type  = ev->type;
            te->a     = ev->a;
            te->b     = ev->b;
        }
    }
    if (!have_first) return 0;
    inst->cap_take_first   = first_frame;
    inst->cap_take_span    = (last_frame > first_frame) ? (last_frame - first_frame) : 1;
    inst->cap_take_is_drum = (uint8_t)is_drum;

    if (!is_drum) undo_begin_single(inst, tidx, clip);
    if (is_drum && !tr->drum_clips[clip]) drum_clips_alloc(inst, tr);

    int tempo_mode = capture_session_empty(inst) && !inst->clock_follow_on;
    int have_selector = 0;
    if (tempo_mode) {
        inst->cap_select_warp = 0;
        int best = capture_estimate_tempos(inst);
        if (best >= 0 && inst->cap_bpm_count >= 1) {
            inst->cap_select_idx = (uint8_t)best;
            have_selector = (inst->cap_bpm_count >= 2);
        } else {
            double base = (double)tr->pfx.cached_bpm;
            if (base < 20.0 || base > 400.0) base = 120.0;
            inst->cap_bpm_est[0] = base;
            inst->cap_bpm_count  = 1;
            inst->cap_select_idx = 0;
        }
        wrote = capture_write_take(inst, tidx, clip,
                                   inst->cap_bpm_est[inst->cap_select_idx], 0);
    } else {
        /* WARP: candidate bar lengths bracketing the take's natural length at
         * the established tempo; default = the closest fit (least stretch). */
        inst->cap_select_warp = 1;
        double sbpm = (double)tr->pfx.cached_bpm;
        if (sbpm < 20.0 || sbpm > 400.0) sbpm = 120.0;
        double bar_frames = (double)inst->sample_rate * 60.0 / sbpm * 4.0;
        double natural = bar_frames > 0.0
            ? (double)inst->cap_take_span / bar_frames : 1.0;
        static const int BARSET[8] = { 1, 2, 3, 4, 6, 8, 12, 16 };
        int nb = 0, bi;
        for (bi = 0; bi < 8; bi++)
            if (BARSET[bi] * 16 <= 256)
                inst->cap_bar_cand[nb++] = (uint16_t)BARSET[bi];
        inst->cap_bpm_count = (uint8_t)nb;
        int bidx = 0; double bd = 1e9;
        for (bi = 0; bi < nb; bi++) {
            double d = cap_fabs((double)inst->cap_bar_cand[bi] - natural);
            if (d < bd) { bd = d; bidx = bi; }
        }
        inst->cap_select_idx = (uint8_t)bidx;
        inst->cap_warp_ticks = 0;   /* exact fill until fine-adjusted */
        wrote = capture_write_take(inst, tidx, clip, sbpm,
                                   (int)inst->cap_bar_cand[bidx] * 16);
        have_selector = (nb >= 2);
    }
    inst->cap_last_was_stopped = 1;
    if (!wrote) return 0;

    /* Arm the committed clip and roll the transport so the take plays back. */
    tr->active_clip   = (uint8_t)clip;
    tr->queued_clip   = -1;
    tr->will_relaunch = 1;
    pfx_sync_from_clip(tr);
    if (inst->clock_follow_on) follow_request_start(inst, 1);
    else                       ext_transport_start(inst);

    inst->cap_select_active = (uint8_t)(have_selector ? 1 : 0);
    inst->cap_select_track  = (uint8_t)tidx;
    inst->cap_select_clip   = (uint8_t)clip;

    inst->cap_commit_seq++;
    inst->state_dirty = 1;
    capture_clear(inst);   /* ring consumed; the take lives in cap_take[] */
    return 1;
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

/* Stage B dispatch context: one per set_param call, carries the parse
 * state shared by the sp_* handlers. Base fields inst/key/val are always
 * present; tidx/tr/sub are the tN_-block extension. Add further fields
 * only as a handler group actually needs them.
 *
 * Handler contract: return 1 if the key was consumed (the dispatcher then
 * returns from set_param), 0 to fall through to later branches. The ctx is
 * mutable via pointer: a handler may rewrite cx->val and re-dispatch before
 * returning (the transport group's val="play" fall-through pattern).
 * Build the ctx with DESIGNATED initializers only — fields will be added
 * per group, and positional init would silently misassign. */
typedef struct {
    seq8_instance_t *inst;
    const char      *key;
    const char      *val;
    int              tidx;   /* tN_ track index, valid inside the tN_ block */
    seq8_track_t    *tr;     /* &inst->tracks[tidx],  ditto */
    const char      *sub;    /* key + 3 (past "tN_"), ditto */
} sp_ctx_t;

/* Stage B tN_ handlers: track-config + cc-automation + drum-lane + per-clip tN_
 * keys + clip-resolution/track-type/track-arp keys + record keys + drum
 * config/all-lanes-transform/drum-repeat/drum-record keys + melodic-clip-
 * transform (length/dir/stretch/nudge/legato) and the pfx_set catch-all keys.
 * Included at FILE scope
 * here (not mid-function) so each can be a real static fn; placed just before
 * set_param so the file-scope helpers they call (build_xpose_lut,
 * silence_muted_tracks, pfx_sync_from_clip; cc_emit, cc_auto_set_point,
 * cc_auto_clear_range, cc_auto_reset, undo_begin_single; drum_clips_alloc,
 * drum_pfx_set, drum_lane_note_off_imm, apply_legato_to_clip,
 * bjorklund_positions; clip_note_apply_op, clip_note_finalize,
 * clip_build_steps_from_notes, clip_migrate_to_notes, cc_auto_eval,
 * at_auto_reset; convert_track_melodic_to_drum, convert_track_drum_to_melodic,
 * convert_track_to_conduct, drum_clips_free, tarp_silence, tarp_drop_latched,
 * arp_silence, arp_init_defaults; undo_begin_drum_clip, finalize_pending_notes,
 * clip_clear_suppress, clip_insert_note, effective_vel, note_step,
 * clip_in_reverse_motion, live_note_on, live_note_off, ...) are already
 * visible. All are dispatched from the tN_ block inside set_param. */
#include "setparam/sp_track_config.c"
#include "setparam/sp_track_ccauto.c"
#include "setparam/sp_track_drum.c"
#include "setparam/sp_track_clip.c"
#include "setparam/sp_track_config2.c"
#include "setparam/sp_track_record.c"
#include "setparam/sp_track_drum2.c"
#include "setparam/sp_track_live.c"
#include "setparam/sp_track_misc.c"

/* Globals handlers (phase 4B, dispatched ABOVE the tN_ block). Unlike the
 * tN_ handlers they use only inst/key/val (no tidx/tr/sub), matching top-level
 * global keys. Included at file scope like the tN_ handlers; order among the
 * file-scope includes is irrelevant (plain static fns):
 * sp_globals_state (group 10), sp_globals_misc (group 11),
 * sp_globals_edit (group 12), sp_globals_transport (group 13). */
#include "setparam/sp_globals_state.c"
#include "setparam/sp_globals_misc.c"
#include "setparam/sp_globals_edit.c"
#include "setparam/sp_globals_transport.c"

/* ------------------------------------------------------------------ */
/* set_param                                                            */
/* ------------------------------------------------------------------ */

static void set_param(void *instance, const char *key, const char *val) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst || !key || !val) return;

    /* One dispatch context for the whole call. Globals handlers (dispatched
     * before the tN_ block) read only inst/key/val; tidx/tr/sub are filled in
     * inside the tN_ block. Designated init leaves tidx=0, tr=NULL, sub=NULL. */
    sp_ctx_t cx = { .inst = inst, .key = key, .val = val };


    /* --- Transport / tempo / tonality / metro / clock / count-in (global) ---
     * now a file-scope GLOBALS handler (phase 4B group 13, THE FINAL group),
     * dispatched here reusing the call-wide cx. It reads only inst/key/val;
     * returns 1 on a matched key (we return), 0 to fall through. This is the
     * FIRST dispatch, so cx is fresh {inst,key,val}. The transport branch's
     * play_focus `val="play"` rewrite reassigns only the handler's unpacked
     * LOCAL val copy -- cx->val is never mutated -- so cx is still
     * {inst,key,val} entering the state dispatch below. */
    if (sp_globals_transport(&cx)) return;

    /* --- Global state keys (debug_log/save/prune_orphan_states/state_path/
     * state_load) --- now a file-scope GLOBALS handler (phase 4B group 10),
     * dispatched here reusing the call-wide cx. It reads only inst/key/val;
     * returns 1 on a matched key (we return), 0 to fall through. Dispatched
     * after the transport handler and before the misc handler, preserving the
     * original branch order (transport -> state -> misc -> edit -> tN_). The
     * transport handler above reassigns only its own local val copy (cx->val is
     * never mutated), so cx is still {inst,key,val} here. */
    if (sp_globals_state(&cx)) return;

    /* --- Looper / merge / bake / scene-launch / snapshots (global) --- now a
     * file-scope GLOBALS handler (phase 4B group 11), dispatched here reusing
     * the call-wide cx. Covers looper_arm/stop/retrigger/sync, merge_arm/stop/
     * place_row/cancel, bake, bake_scene, perf_mods, launch_scene[_quant],
     * mute_all_clear, snap_save/load/delete. It reads only inst/key/val;
     * returns 1 on a matched key (we return), 0 to fall through. Dispatched
     * after the state handler and before the edit handler, preserving the
     * original branch order (transport -> state -> misc -> edit -> tN_). The
     * state handler above returns 0 without mutating cx on fall-through, and the
     * transport handler before it reassigns only its own local val copy
     * (cx->val is never mutated), so cx is still {inst,key,val} here. */
    if (sp_globals_misc(&cx)) return;

    /* --- Clip/row copy/cut/clear + undo/redo (global) --- now a file-scope
     * GLOBALS handler (phase 4B group 12), dispatched here reusing the
     * call-wide cx. Covers clip_copy, row_copy, clip_cut, row_cut,
     * drum_clip_copy, drum_clip_cut, row_clear, undo_restore, redo_restore. It
     * reads only inst/key/val; returns 1 on a matched key (we return), 0 to
     * fall through. Dispatched after the misc handler and before the tN_ block,
     * preserving the original branch order (transport -> state -> misc -> edit
     * -> tN_). The transport + state + misc handlers above all return 0 without
     * mutating cx on fall-through (transport reassigns only its own local val
     * copy), so cx is still {inst,key,val} here. ALL 13 setparam files (9 tN_ +
     * 4 globals) are now file-scope sp_ctx_t handlers -- NONE remain a raw
     * function-body segment; set_param's body is just the ctx build + this
     * dispatch chain + the tN_ block prologue. Stage B complete. */
    if (sp_globals_edit(&cx)) return;

    /* --- Track-prefixed params: tN_<subkey> --- */
    /* This parent code OPENS the tN_ track block and declares the block-locals
     * tidx/sub/tr consumed by every sp_track_* handler dispatched below; the
     * parent also CLOSES the block (and set_param) at the tail -- the final two
     * braces live at the sp_track_misc dispatch site (they used to live inside
     * that segment). All nine sp_track_* files are now real static fns
     * (phase 4B, included at file scope above, dispatched below):
     * sp_track_config (group 1), sp_track_ccauto (group 2),
     * sp_track_drum (group 3), sp_track_clip (group 4),
     * sp_track_config2 (group 5), sp_track_record (group 6),
     * sp_track_live (group 7), sp_track_drum2 (group 8),
     * sp_track_misc (group 9, the terminal catch-all). */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        /* cx was built at the top of set_param with inst/key/val; fill in the
         * tN_-block extension fields (the globals handlers dispatched above
         * never read them). */
        cx.tidx = tidx;
        cx.tr   = tr;
        cx.sub  = sub;
        if (sp_track_config(&cx)) return;

        /* tN_cC_* per-clip keys (note ops, nested _step_ parser, resolution,
         * dir, loop window, CC-lane, _pfx_set, conductor fields, clears) --
         * now a file-scope handler (phase 4B group 4), dispatched here reusing
         * the existing cx. The handler self-guards sub[0]=='c' + digit and
         * CONSUMES the whole block (returns 1 even for an unknown sub-op, so a
         * tN_cC_ key never leaks to the pfx catch-all); returns 0 only when
         * sub is not a clip key. Nothing between the sp_track_config dispatch
         * above and here mutates cx (comments only), so cx is current. */
        if (sp_track_clip(&cx)) return;

        /* tN_clip_resolution / clip_resolution_zoom, pad_octave, pad_mode,
         * convert_to_*, tarp_*, track_vel_override -- now a file-scope handler
         * (phase 4B group 5), dispatched here reusing the existing cx.
         * Non-guarded run of strcmp branches like sp_track_config: returns 1 on
         * match, 0 to fall through to the sibling tN_ handlers. sp_track_clip is
         * a handler dispatched above (returns 0 without mutating cx on
         * fall-through); nothing between it and here mutates cx (comments only),
         * so cx is current. */
        if (sp_track_config2(&cx)) return;

        /* CC PARAM bank set_params -- now a file-scope handler (phase 4B
         * group 2), dispatched here reusing the existing cx. sp_track_clip and
         * sp_track_config2 are handlers dispatched above (both return 0 without
         * mutating cx on fall-through), so cx is current. */
        if (sp_track_ccauto(&cx)) return;

        /* tN_lL_* drum lane setters -- now a file-scope handler (phase 4B
         * group 3), dispatched here reusing the existing cx. The handler
         * self-checks sub[0]=='l' + digit and returns 0 when it isn't a lane
         * key; a lane key that matched but hit no sub-op is CONSUMED (returns
         * 1) so it never leaks to the pfx catch-all. sp_track_clip,
         * sp_track_config2, and sp_track_ccauto are all handlers dispatched
         * above that return 0 without mutating cx on fall-through, so cx is
         * current. */
        if (sp_track_drum(&cx)) return;

        /* tN_recording / record_note_on / record_note_off -- now a file-scope
         * handler (phase 4B group 6), dispatched here reusing the existing cx.
         * Non-guarded run of strcmp branches like sp_track_config: returns 1 on
         * match, 0 to fall through to the sibling tN_ handlers. sp_track_clip,
         * sp_track_config2, sp_track_ccauto, and sp_track_drum are all handlers
         * dispatched above that return 0 without mutating cx on fall-through,
         * so cx is current. */
        if (sp_track_record(&cx)) return;

        /* tN_ drum config / all-lanes transforms / drum-repeat+repeat2 /
         * drum-record keys -- now a file-scope handler (phase 4B group 8),
         * dispatched here reusing the existing cx. Non-guarded run of strcmp
         * branches like sp_track_record: returns 1 on match, 0 to fall through
         * to the sibling tN_ handlers. inst-global writes (all_lanes_stretch_result,
         * delete_held, state_dirty) and the drum_repeat*_internal delegations
         * move verbatim. sp_track_record above returns 0 without mutating cx on
         * fall-through, so cx is current. */
        if (sp_track_drum2(&cx)) return;

        /* tN_live_notes / live_at / padmap -- now a file-scope handler
         * (phase 4B group 7), dispatched here reusing the existing cx.
         * Non-guarded run of strcmp branches like sp_track_record: returns 1
         * on match, 0 to fall through to the sibling tN_ handlers. padmap's
         * global-carrier writes (active_track, dsp_inbound_enabled,
         * pad_note_map) move verbatim. sp_track_drum2 above is a handler
         * dispatched here that returns 0 without mutating cx on fall-through,
         * so cx is current. */
        if (sp_track_live(&cx)) return;

        /* tN_ melodic-clip transforms (clip_length, clip_playback_dir,
         * clock_shift, nudge, beat_stretch, loop_double_fill, lgto_apply) plus
         * the unconditional pfx_set catch-all -- now a file-scope handler
         * (phase 4B group 9), dispatched here reusing the existing cx.
         * TERMINAL handler: its pfx_set catch-all consumes EVERY tN_ key that
         * reaches this far, so it always returns 1 (never falls through).
         * sp_track_live above returns 0 without mutating cx on fall-through, so
         * cx is current. The two closing braces below (the tN_ block's `}` and
         * set_param's `}`) used to live at this segment's tail and now live
         * here in the parent. */
        if (sp_track_misc(&cx)) return;
    }
}
