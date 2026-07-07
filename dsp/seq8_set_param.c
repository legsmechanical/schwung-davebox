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

/* Stage B handlers: track-config + cc-automation + drum-lane + per-clip tN_
 * keys + clip-resolution/track-type/track-arp keys. Included at FILE scope
 * here (not mid-function) so each can be a real static fn; placed just before
 * set_param so the file-scope helpers they call (build_xpose_lut,
 * silence_muted_tracks, pfx_sync_from_clip; cc_emit, cc_auto_set_point,
 * cc_auto_clear_range, cc_auto_reset, undo_begin_single; drum_clips_alloc,
 * drum_pfx_set, drum_lane_note_off_imm, apply_legato_to_clip,
 * bjorklund_positions; clip_note_apply_op, clip_note_finalize,
 * clip_build_steps_from_notes, clip_migrate_to_notes, cc_auto_eval,
 * at_auto_reset; convert_track_melodic_to_drum, convert_track_drum_to_melodic,
 * convert_track_to_conduct, drum_clips_free, tarp_silence, tarp_drop_latched,
 * arp_silence, arp_init_defaults, ...) are already visible. All are
 * dispatched from the tN_ block inside set_param. */
#include "setparam/sp_track_config.c"
#include "setparam/sp_track_ccauto.c"
#include "setparam/sp_track_drum.c"
#include "setparam/sp_track_clip.c"
#include "setparam/sp_track_config2.c"

/* ------------------------------------------------------------------ */
/* set_param                                                            */
/* ------------------------------------------------------------------ */

static void set_param(void *instance, const char *key, const char *val) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst || !key || !val) return;


    /* --- Transport (global) --- */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_globals_transport.c"
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_globals_state.c"

    /* --- Scene launch (global): all tracks to clip M --- */
    /* Global MIDI Looper: arm with capture length in master 96-PPQN ticks.
     * Behavior depends on current state:
     *   IDLE / ARMED / CAPTURING — drop in-flight state and re-arm fresh.
     *   LOOPING — queue the new rate; transition fires at the next loop
     *     boundary (in looper_tick) so the switch lands cleanly on the beat.
     *   LOOPING with rate already equal to current — clear any pending queue
     *     (this is the path used to "cancel" a queued switch when the user
     *     releases a newer step button while still holding an older one). */
/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_globals_misc.c"

/* LOAD-BEARING SPACING: function-body segment include (phase 4A). The
 * blank-line layout around this include is part of the byte-identity
 * gate (`clang -E -P` preprocessed TU identical pre/post split); do not
 * tidy. The segment file opens with `#line 1` to disarm clang's
 * start-of-line indentation collapse at the include entry. */
#include "setparam/sp_globals_edit.c"

    /* --- Track-prefixed params: tN_<subkey> --- */
    /* This parent code OPENS the tN_ track block and declares the block-locals
     * tidx/sub/tr consumed by every sp_track_* include below; sp_track_misc.c
     * still CLOSES the block (and set_param) at the tail. Handlers already
     * converted to real static fns (phase 4B, included at file scope above,
     * dispatched below): sp_track_config (group 1), sp_track_ccauto (group 2),
     * sp_track_drum (group 3), sp_track_clip (group 4),
     * sp_track_config2 (group 5). The OTHER sp_track_*
     * files are still mid-function segments. */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        sp_ctx_t cx = { .inst = inst, .key = key, .val = val,
                        .tidx = tidx, .tr = tr, .sub = sub };
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
 * (`clang -E -P`). Do not tidy.
 * NOTE: this segment CLOSES the tN_ track block AND set_param itself --
 * the final two closing braces live inside the segment file, and its
 * pfx_set catch-all tail must remain the last tN_ handler. */
#include "setparam/sp_track_misc.c"
