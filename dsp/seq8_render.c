/* seq8_render.c — render_block (the audio-callback driver) + master-clock seam.
 * Contents: seq8_clock_advance, seq8_tick_due, seq8_stopped_advance,
 * seq8_stopped_tick_due, clock_send_raw, clock_send_f8_tick,
 * seq8_clock_follow_tick, render_block. #include'd into seq8.c's single TU at
 * the original position (just before the API table that references
 * render_block); never compiled standalone. */
/* ------------------------------------------------------------------ */
/* render_block                                                         */
/* ------------------------------------------------------------------ */

/* ---- Master-clock seam --------------------------------------------------
 * The two halves of the "tick_accum += tick_delta; while (accum >= threshold)"
 * idiom, abstracted so the three render_block tick sites (count-in, stopped/
 * ARP, playing) and all per-tick body code stay byte-identical regardless of
 * clock source. Internal mode advances the sample accumulator; follow mode
 * consumes ticks queued from Move's 0xF8 by on_midi. clock_follow_on is the only
 * mode discriminator here — a future 3-way Internal/Sync/Auto enum drops in by
 * widening it without touching the call sites. */
static inline void seq8_clock_advance(seq8_instance_t *inst) {
    if (inst->follow_solo)                 /* clock-follow + Move never started: scratch internal clock */
        inst->solo_tick_accum += inst->solo_tick_delta;
    else if (!inst->clock_follow_on)
        inst->tick_accum += inst->tick_delta;
    /* follow mode (non-solo): ticks were queued into ext_tick_pending by on_midi */
}

/* Returns 1 and consumes one master tick when one is due, else 0. */
static inline int seq8_tick_due(seq8_instance_t *inst) {
    if (inst->follow_solo) {               /* scratch solo clock — never touches db's tempo fields */
        if (inst->solo_tick_accum >= inst->tick_threshold) {
            inst->solo_tick_accum -= inst->tick_threshold;
            return 1;
        }
        return 0;
    }
    if (inst->clock_follow_on) {
        if (inst->ext_tick_pending > 0) { inst->ext_tick_pending--; return 1; }
        return 0;
    }
    if (inst->tick_accum >= inst->tick_threshold) {
        inst->tick_accum -= inst->tick_threshold;
        return 1;
    }
    return 0;
}

/* Stopped-state clock for the free-running arp/delay/repeat tick site (live
 * input arpeggiates / echoes while db transport is stopped). Distinct from the
 * main sequencer seam above: in follow mode while Move is STOPPED (no incoming
 * clock), this falls back to db's internal tick_delta so live noodling keeps a
 * tempo (Move's captured tempo, via the tempo-capture estimate) instead of
 * freezing. When Move IS running, it locks to Move's queued ext ticks. In
 * internal mode it always free-runs. The main transport (playing path) never
 * uses this — it stays a hard follow (Move stops → db stops). */
static inline void seq8_stopped_advance(seq8_instance_t *inst) {
    if (!inst->clock_follow_on || !inst->ext_transport_running)
        inst->tick_accum += inst->tick_delta;   /* internal free-run / follow-fallback */
    /* else: follow + Move running → ticks arrive via ext_tick_pending (no-op here) */
}
static inline int seq8_stopped_tick_due(seq8_instance_t *inst) {
    if (inst->clock_follow_on && inst->ext_transport_running) {
        if (inst->ext_tick_pending > 0) { inst->ext_tick_pending--; return 1; }
        return 0;
    }
    if (inst->tick_accum >= inst->tick_threshold) {
        inst->tick_accum -= inst->tick_threshold;
        return 1;
    }
    return 0;
}

/* Clock OUT: emit a single realtime status byte (0xF8/0xFA/0xFB/0xFC) to
 * external gear on cable 2 (USB-A) via the shim's audio-thread SPSC ring. MUST
 * be called only from the render/audio thread (single producer for the ring).
 * Byte 0 = USB-MIDI header (cable<<4 | CIN); for single-byte realtime, CIN =
 * 0x0F, so 0x20 | (rt>>4) = 0x2F. Requires Schwung 0.9.16+ (the audio-thread-safe
 * midi_send_external SPSC ring). */
static void clock_send_raw(seq8_instance_t *inst, uint8_t rt) {
    (void)inst;
    if (g_host && g_host->midi_send_external) {
        const uint8_t pkt[4] = { (uint8_t)(0x20 | ((rt >> 4) & 0x0F)), rt, 0, 0 };
        g_host->midi_send_external(pkt, 4);
    }
}
/* Per-master-tick 0xF8 emit: 96 PPQN / 4 = 24 PPQN. Self-gates: only emits when
 * clock-out is on and db is free-running (Move owns external sync when following). */
static inline void clock_send_f8_tick(seq8_instance_t *inst) {
    if (!inst->clock_send_on || inst->clock_follow_on) return;
    if (++inst->clock_send_phase >= 4) {
        inst->clock_send_phase = 0;
        clock_send_raw(inst, 0xF8);
    }
}

/* Clock-follow housekeeping run once per block from render_block: advance the
 * staleness time base, drain the MovePlay inject toward the desired Move
 * transport, and apply the start-timeout fallback. RT-safe (no alloc / IO). */
static void seq8_clock_follow_tick(seq8_instance_t *inst, int frames) {
    if (!inst->clock_follow_on) return;
    inst->ext_sample_clock += (uint32_t)frames;

    /* Hybrid stop detection: Move was running but its clock went stale. */
    if (inst->ext_transport_running && inst->ext_clock_seen) {
        uint32_t since = inst->ext_sample_clock - inst->ext_clock_last_sample;
        if (since > (uint32_t)CLKFOLLOW_STALE_SAMPLES) {
            inst->ext_transport_running = 0;
            inst->ext_tick_pending      = 0;
            if (inst->playing || inst->count_in_ticks > 0) ext_transport_stop(inst);
        }
    }

    /* Tempo capture: track Move's tempo (measured from the inter-0xF8 sample
     * period EMA, accumulated in on_midi) into db's internal tick_delta +
     * per-pfx cached_bpm. Keeps the stopped-state fallback running at Move's
     * tempo and the BPM readout (get_param "bpm" reads cached_bpm) honest with
     * no manual matching. The estimate persists when Move stops (last value
     * holds), so the fallback inherits Move's last tempo. Change-gated to avoid
     * per-block churn across all tracks/lanes. */
    if (inst->ext_clock_period_ema > 0.0f) {
        double bpm = (double)inst->sample_rate * 60.0
                     / ((double)inst->ext_clock_period_ema * 24.0);
        if (bpm >= 30.0 && bpm <= 300.0
                && (inst->clock_follow_bpm_applied <= 0.0
                    || bpm > inst->clock_follow_bpm_applied + 0.1
                    || bpm < inst->clock_follow_bpm_applied - 0.1)) {
            inst->clock_follow_bpm_applied = bpm;
            inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
            int tb, tbl;
            for (tb = 0; tb < NUM_TRACKS; tb++) {
                inst->tracks[tb].pfx.cached_bpm = bpm;
                for (tbl = 0; tbl < DRUM_LANES; tbl++)
                    inst->tracks[tb].drum_lane_pfx[tbl].cached_bpm = bpm;
            }
        }
    }

    /* Drain the MovePlay (CC 85) toggle: press one block, release after a gap.
     * Fired from here (render_block) — a set_param-context inject is unreliable. */
    if (inst->move_play_inject_phase == 1) {
        if (g_host && g_host->midi_inject_to_move) {
            uint8_t pkt[4] = { 0x0B, 0xB0, MOVE_PLAY_CC, 127 };
            g_host->midi_inject_to_move(pkt, 4);
        }
        inst->move_play_inject_phase = 2;
        inst->move_play_inject_wait  = MOVE_PLAY_RELEASE_SAMPLES;
    } else if (inst->move_play_inject_phase == 2) {
        inst->move_play_inject_wait -= frames;
        if (inst->move_play_inject_wait <= 0) {
            if (g_host && g_host->midi_inject_to_move) {
                uint8_t pkt[4] = { 0x0B, 0xB0, MOVE_PLAY_CC, 0 };
                g_host->midi_inject_to_move(pkt, 4);
            }
            inst->move_play_inject_phase = 0;
        }
    }

    /* Start-timeout fallback: we injected a start but Move's clock never came in
     * time (the window is sized to cover Move's Link transport-sync, ~1 bar). If
     * Move genuinely never starts, DON'T drop the count-in — run this take on a
     * scratch internal clock at the last-known tempo (follow_solo) so the user
     * still gets their count-in. db's real tempo state is NOT written (we only
     * read cached_bpm to size solo_tick_delta); follow_solo is cleared on stop /
     * real Move start, so it evaporates after this take. A one-shot flag raises a
     * JS popup. RT-safe: no logging, no get_bpm (cached_bpm only). */
    if (inst->follow_start_timeout > 0) {
        inst->follow_start_timeout -= frames;
        if (inst->follow_start_timeout <= 0) {
            uint8_t kind = inst->follow_start_kind;
            inst->follow_start_timeout = 0;
            inst->follow_start_kind    = 0;
            if (!inst->ext_transport_running) {
                double _bpm = (double)inst->tracks[0].pfx.cached_bpm;
                if (_bpm < 20.0 || _bpm > 400.0) _bpm = 120.0;
                inst->solo_tick_delta       = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * _bpm * (double)PPQN);
                inst->solo_tick_accum       = 0;
                inst->follow_solo           = 1;
                inst->solo_fallback_pending = 1;   /* JS popup one-shot */
                /* kind==2: keep count_in_ticks — the count-in now drains on the
                 * solo clock, then fires transport+recording as normal. kind==1
                 * (plain play): start immediately on the solo clock. */
                if (kind != 2 && !inst->playing) ext_transport_start(inst);
            }
        }
    }
}

static void render_block(void *instance, int16_t *out_lr, int frames) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst) return;

    if (out_lr && frames > 0)
        memset(out_lr, 0, (size_t)frames * 2 * sizeof(int16_t));

    inst->block_count++;
    if (frames > 0) inst->rui_frames += (uint64_t)frames;  /* device clock (remote UI) */

    /* CC latch: on the recording 1->0 edge (any stop path — transport stop,
     * disarm, restart) finalize the latch (decimate latched lanes + clear).
     * Runs every block BEFORE the early returns below, since on transport-stop
     * the sequencer loop never runs. */
    { int _ft;
      for (_ft = 0; _ft < NUM_TRACKS; _ft++) {
          seq8_track_t *_ftr = &inst->tracks[_ft];
          if (_ftr->cc_was_recording && !_ftr->recording) cc_finalize_latch(_ftr);
          _ftr->cc_was_recording = _ftr->recording;
      }
    }

    /* Advance sample counters and fire queued events for all tracks. */
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        int _l;
        inst->tracks[t].pfx.sample_counter += (uint64_t)frames;
        for (_l = 0; _l < DRUM_LANES; _l++)
            inst->tracks[t].drum_lane_pfx[_l].sample_counter += (uint64_t)frames;
    }

    for (t = 0; t < NUM_TRACKS; t++) {
        int _l;
        pfx_q_fire(&inst->tracks[t].pfx, inst->tracks[t].pfx.sample_counter);
        for (_l = 0; _l < DRUM_LANES; _l++)
            drum_pfx_q_fire(&inst->tracks[t].drum_lane_pfx[_l], inst->tracks[t].drum_lane_pfx[_l].sample_counter);
    }

    /* Clock-follow housekeeping: staleness, MovePlay inject drain, start timeout. */
    seq8_clock_follow_tick(inst, frames);

    /* Clock OUT transport edges (0xFA/0xFC). Emitted once per block from the
     * audio thread (single producer for the shim ext ring) on the db transport
     * edge — and on enable/disable of clock-out mid-play so external gear starts
     * /stops cleanly. Active only when free-running (clock_send_on && !follow);
     * while following, Move's own MIDI Clock Out owns external sync. The 0xF8
     * stream itself is emitted per-tick inside the loops below. */
    if (inst->clock_send_on && !inst->clock_follow_on) {
        uint8_t pl = inst->playing ? 1 : 0;
        if (!inst->clock_send_was_active) {
            if (pl) { clock_send_raw(inst, 0xFA); inst->clock_send_phase = 0; }
            inst->clock_send_was_playing = pl;
            inst->clock_send_was_active  = 1;
        } else if (pl != inst->clock_send_was_playing) {
            clock_send_raw(inst, pl ? 0xFA : 0xFC);
            if (pl) inst->clock_send_phase = 0;  /* align 0xF8 phase to the downbeat */
            inst->clock_send_was_playing = pl;
        }
    } else if (inst->clock_send_was_active) {
        /* Clock-out just disabled (or follow turned on): stop external gear. */
        if (inst->clock_send_was_playing) clock_send_raw(inst, 0xFC);
        inst->clock_send_was_active  = 0;
        inst->clock_send_was_playing = 0;
    }

    /* DSP-side count-in: tick down using same accumulator; fire transport+rec when done */
    if (inst->count_in_ticks > 0) {
        if (inst->tick_threshold > 0 || inst->clock_follow_on) {
            seq8_clock_advance(inst);
            /* count_in_ticks checked first so the guard short-circuits before
             * seq8_tick_due consumes a tick (matters in follow mode: a consumed
             * ext tick at the count-in→play edge would shift bar-1 phase). */
            while (inst->count_in_ticks > 0 && seq8_tick_due(inst)) {
                if (inst->metro_on >= 1) {
                    int old_q = (int)(inst->count_in_ticks / PPQN);
                    inst->count_in_ticks--;
                    if (inst->count_in_ticks > 0) {
                        int new_q = (int)(inst->count_in_ticks / PPQN);
                        if (new_q != old_q) { inst->metro_beat_count++; inst->metro_click_pos = 0; }
                    }
                } else {
                    inst->count_in_ticks--;
                }
                /* TARP + drum repeats: input-side engines tick during count-in
                 * so live presses are audible through the click. Looper and
                 * SEQ ARP stay dormant (playback-side; no clip playback during
                 * count-in). */
                { int _tt;
                  for (_tt = 0; _tt < NUM_TRACKS; _tt++) {
                      tarp_tick(inst, &inst->tracks[_tt]);
                      drum_repeat_tick(inst, &inst->tracks[_tt]);
                      drum_repeat2_tick(inst, &inst->tracks[_tt]);
                  }
                }
                inst->arp_master_tick++;
                clock_send_f8_tick(inst);  /* keep external clock running through the count-in */
            }
            if (inst->count_in_ticks == 0) {
                inst->tick_accum          = 0;
                inst->master_tick_in_step = 0;
                inst->global_tick         = 0;
                inst->arp_master_tick     = 0;
                reset_all_loop_cycles(inst);
                for (t = 0; t < NUM_TRACKS; t++) {
                    seq8_track_t *_tr = &inst->tracks[t];
                    /* Start each track inside its window: melodic at the active
                     * clip's loop_start, drum per-lane at each lane's loop_start.
                     * Backward / PPBwd directions start at the last step instead. */
                    {
                        clip_t *_mcl = &_tr->clips[_tr->active_clip];
                        _tr->current_step = initial_clip_step(_mcl->loop_start, _mcl->length, _mcl->playback_dir);
                        _mcl->pp_dir_state = initial_pp_dir(_mcl->playback_dir);
                        /* Per-lane drum init too (this loop runs for all tracks,
                         * not just the active-pad-mode one). */
                        if (_tr->drum_clips[_tr->active_clip]) {
                        int _li;
                        for (_li = 0; _li < DRUM_LANES; _li++) {
                            clip_t *_dlc = &_tr->drum_clips[_tr->active_clip]->lanes[_li].clip;
                            _tr->drum_current_step[_li] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
                            _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
                            _tr->drum_tick_in_step[_li] = 0;
                        }
                        }
                    }
                    _tr->tick_in_step       = 0;
                    _tr->note_active        = 0;
                    _tr->pfx.sample_counter = 0;
                    /* Prime current_clip_tick to match the direction-aware
                     * current_step set above — so the first post-fire
                     * tarp_fire_step (which reads current_clip_tick *before*
                     * the per-track tick advance recomputes it) sees a value
                     * consistent with the visual playhead position. For
                     * Backward / PPBwd this is (loop_start + length - 1) * tps
                     * rather than loop_start * tps. */
                    _tr->current_clip_tick  = (uint32_t)_tr->current_step
                                              * _tr->clips[_tr->active_clip].ticks_per_step;
                    /* Reschedule any pfx events the count-in TARP queued to fire
                     * immediately on next pfx_q_fire. Their original fire_at was
                     * pegged to count-in's high sample_counter, which we just
                     * zeroed — without this they'd never fire (or fire seconds
                     * later when sample_counter catches up), stranding the
                     * queued note-offs and leaving stuck voices on Move/Schwung. */
                    {
                        play_fx_t *_fx = &_tr->pfx;
                        int _ei;
                        for (_ei = 0; _ei < _fx->event_count; _ei++)
                            _fx->events[_ei].fire_at = 0;
                    }
                    /* TARP runtime reset: re-anchor pattern position to step 0 of
                     * the new arp_master_tick. master_anchor was set during the
                     * count-in TARP ticks and would underflow `master_pos =
                     * arp_master_tick - master_anchor` after the reset above. */
                    if (_tr->tarp_on) {
                        arp_engine_t *_a = &_tr->tarp;
                        _a->sounding_active     = 0;
                        _a->sounding_pitch      = 0;
                        _a->gate_remaining      = 0;
                        _a->ticks_until_next    = 0;
                        _a->master_anchor       = 0;
                        _a->pending_first_note  = (_a->held_count > 0) ? 1 : 0;
                    }
                    /* Drum repeat fire reset — re-anchor phase to the new
                     * arp_master_tick=0. Pending bits clear because Repeat
                     * Sync will re-evaluate (arp_master_tick=0 is always on
                     * the rate grid). Drain play_pending[] entries queued
                     * by count-in repeats so note-offs land on the first
                     * audio buffer post-fire instead of being stranded. */
                    if (_tr->drum_repeat_active) {
                        _tr->drum_repeat_phase   = 0;
                        _tr->drum_repeat_step    = 0;
                        _tr->drum_repeat_pending = 0;
                    }
                    if (_tr->drum_repeat2_active | _tr->drum_repeat2_pending) {
                        int _l2;
                        for (_l2 = 0; _l2 < DRUM_LANES; _l2++) {
                            uint32_t _bit = 1u << (unsigned)_l2;
                            if (_tr->drum_repeat2_pending & _bit) {
                                _tr->drum_repeat2_active |= _bit;
                                _tr->drum_repeat2_pending &= ~_bit;
                            }
                            if (_tr->drum_repeat2_active & _bit) {
                                _tr->drum_repeat2_phase[_l2] = 0;
                                _tr->drum_repeat2_step[_l2]  = 0;
                            }
                        }
                    }
                    /* Drain play_pending[] note-offs so they fire on the first
                     * post-count-in tick rather than waiting for their original
                     * gate countdown (those tick at count-in's high sample_counter,
                     * which has been zeroed by the reset above). */
                    {
                        int _pp;
                        for (_pp = 0; _pp < (int)_tr->play_pending_count; _pp++)
                            _tr->play_pending[_pp].ticks_remaining = 0;
                    }
                    /* Drop stale ratchet sub-hits alongside the other queued-
                     * engine drains — matches silence_track_notes_v2, which
                     * clears them for the same "don't ghost-fire after a
                     * position reset" reason (audit dsp-clock-1, defensive). */
                    _tr->ratchet_pending_count = 0;
                    if (_tr->drum_clips[_tr->active_clip]) {
                        int _dl;
                        for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                            clip_t *_dlc = &_tr->drum_clips[_tr->active_clip]->lanes[_dl].clip;
                            _tr->drum_current_step[_dl] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
                            _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
                        }
                    }
                    memset(_tr->drum_tick_in_step, 0, sizeof(_tr->drum_tick_in_step));
                    if (inst->tracks[t].will_relaunch) {
                        inst->tracks[t].clip_playing      = 1;
                        inst->tracks[t].will_relaunch     = 0;
                        inst->tracks[t].pending_page_stop = 0;
                    }
                }
                inst->playing = 1;
                inst->tracks[inst->count_in_track].recording   = 1;
                memset(inst->tracks[inst->count_in_track].drum_last_rec_step, 0xFF,
                       sizeof(inst->tracks[inst->count_in_track].drum_last_rec_step));
                inst->tracks[inst->count_in_track].clip_playing = 1;
            }
        }
        goto mix_click; /* skip main sequencer but still mix any pending click audio */
    }

    if (inst->tick_threshold == 0 && !inst->clock_follow_on) return;

    /* When stopped: free-running clock for SEQ ARP only, so live input
     * arpeggiates even with transport off. arp_master_tick advances; no
     * sequencer work runs. Uses the stopped-state seam: in follow mode it locks
     * to Move's queued ext ticks while Move is running, but falls back to db's
     * internal tick_delta (Move's captured tempo) when Move is stopped, so live
     * arp/delay/repeat keep running instead of freezing. */
    if (!inst->playing) {
        seq8_stopped_advance(inst);
        while (seq8_stopped_tick_due(inst)) {
            /* Free-running swing parity: derive step parity from arp_master_tick
             * so ARP IN, SEQ ARP, and drum Rpt1/Rpt2 pick up swing even with
             * transport off. Mirrors the playing-block computation below. */
            if ((inst->arp_master_tick % (uint32_t)TICKS_PER_STEP) == 0) {
                if (inst->swing_amt > 0) {
                    uint32_t step_counter = inst->arp_master_tick / (uint32_t)TICKS_PER_STEP;
                    int sw_even = (inst->swing_res == 0)
                        ? (int)(step_counter % 2 == 1)
                        : (int)((step_counter / 2) % 2 == 1);
                    uint32_t pair_ticks = (inst->swing_res == 0)
                        ? (uint32_t)TICKS_PER_STEP * 2 : (uint32_t)TICKS_PER_STEP * 4;
                    uint32_t off_ticks = (uint32_t)inst->swing_amt * pair_ticks / 400;
                    double spt = (double)MOVE_FRAMES_PER_BLOCK
                                 * (double)inst->tick_threshold / (double)inst->tick_delta;
                    inst->swing_step_delay_offbeat = (uint64_t)(off_ticks * spt + 0.5);
                    inst->swing_step_delay = sw_even ? inst->swing_step_delay_offbeat : (uint64_t)0;
                } else {
                    inst->swing_step_delay         = 0;
                    inst->swing_step_delay_offbeat = 0;
                }
            }
            looper_tick(inst);
            for (t = 0; t < NUM_TRACKS; t++) {
                seq8_track_t *tr_s = &inst->tracks[t];
                /* Gate countdown: needed for repeat note-offs while stopped */
                { int pp;
                  for (pp = 0; pp < (int)tr_s->play_pending_count; ) {
                      if (tr_s->play_pending[pp].ticks_remaining > 0)
                          tr_s->play_pending[pp].ticks_remaining--;
                      if (tr_s->play_pending[pp].ticks_remaining == 0) {
                          if (tr_s->pad_mode == PAD_MODE_DRUM && tr_s->play_pending[pp].lane_idx != 0xFF)
                              drum_pfx_note_off(inst, tr_s, &tr_s->drum_lane_pfx[tr_s->play_pending[pp].lane_idx], tr_s->play_pending[pp].pitch);
                          else
                              pfx_note_off(inst, tr_s, tr_s->play_pending[pp].pitch);
                          tr_s->play_pending[pp] = tr_s->play_pending[tr_s->play_pending_count - 1];
                          tr_s->play_pending_count--;
                      } else pp++;
                  }
                }
                drum_repeat_tick(inst, tr_s);
                drum_repeat2_tick(inst, tr_s);
                tarp_tick(inst, tr_s);
                arp_tick(inst, tr_s);
            }
            inst->arp_master_tick++;
            clock_send_f8_tick(inst);  /* continuous 24-PPQN clock out while stopped (free-run master) */
        }
        return;
    }

    seq8_clock_advance(inst);
    while (seq8_tick_due(inst)) {

        /* Looper: tick state machine + emit captured events for current pos.
         * Runs before track logic so arp_emit captures land at the same
         * pos that looper_tick just established. */
        looper_tick(inst);

        /* Swing: recompute step delay at each 1/16 boundary. Even steps get a
         * sample-domain delay applied in pfx_send; odd steps get no delay. */
        if (inst->master_tick_in_step == 0 && inst->tick_delta > 0) {
            if (inst->swing_amt > 0) {
                int sw_even = (inst->swing_res == 0)
                    ? (int)(inst->global_tick % 2 == 1)
                    : (int)((inst->global_tick / 2) % 2 == 1);
                uint32_t pair_ticks = (inst->swing_res == 0)
                    ? (uint32_t)TICKS_PER_STEP * 2 : (uint32_t)TICKS_PER_STEP * 4;
                uint32_t off_ticks = (uint32_t)inst->swing_amt * pair_ticks / 400;
                double spt = (double)MOVE_FRAMES_PER_BLOCK
                             * (double)inst->tick_threshold / (double)inst->tick_delta;
                inst->swing_step_delay_offbeat = (uint64_t)(off_ticks * spt + 0.5);
                inst->swing_step_delay = sw_even ? inst->swing_step_delay_offbeat : (uint64_t)0;
            } else {
                inst->swing_step_delay         = 0;
                inst->swing_step_delay_offbeat = 0;
            }
        }

        /* Merge: ARMED → CAPTURING at first step boundary; STOPPING → finalize at
         * next 16-step page boundary so the captured clip is an exact page length. */
        if (inst->merge_state == MERGE_STATE_ARMED && inst->master_tick_in_step == 0) {
            int _mt;
            inst->merge_state     = MERGE_STATE_CAPTURING;
            inst->merge_start_abs = inst->global_tick * TICKS_PER_STEP;
            for (_mt = 0; _mt < NUM_TRACKS; _mt++) inst->merge_pending_count[_mt] = 0;
        }
        if (inst->merge_state == MERGE_STATE_STOPPING && inst->master_tick_in_step == 0
                && inst->global_tick % 16 == 0) {
            merge_finalize(inst);
        }

        /* Metro beat: mode 2 (On) = while recording; mode 3 (Rec+Ply) = always */
        if (inst->metro_on >= 2 && inst->master_tick_in_step == 0 && inst->global_tick % 4 == 0) {
            if (inst->metro_on == 3) {
                inst->metro_beat_count++;
                inst->metro_click_pos = 0;
            } else {
                int _tt;
                for (_tt = 0; _tt < NUM_TRACKS; _tt++)
                    if (inst->tracks[_tt].recording) {
                        inst->metro_beat_count++;
                        inst->metro_click_pos = 0;
                        break;
                    }
            }
        }

        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *cl = &tr->clips[tr->active_clip];

            /* Safety net: snap playhead into window before emission. Catches
             * any OOB write that slips past per-handler clamps so out-of-window
             * notes can never fire. Logs once per snap event as a breadcrumb. */
            if (tr->clip_playing) {
                if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
                    int _dl;
                    for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                        clip_t *_dlc = &tr->drum_clips[tr->active_clip]->lanes[_dl].clip;
                        uint16_t _dle = (uint16_t)(_dlc->loop_start + _dlc->length);
                        if (tr->drum_current_step[_dl] < _dlc->loop_start
                                || tr->drum_current_step[_dl] >= _dle) {
#if SEQ8_DEBUG_PROBES
                            char _msg[160];
                            snprintf(_msg, sizeof(_msg),
                                "WINDOW SNAP: t%d lane%d playhead %u -> %u (window [%u,%u))",
                                t, _dl, (unsigned)tr->drum_current_step[_dl],
                                (unsigned)_dlc->loop_start,
                                (unsigned)_dlc->loop_start, (unsigned)_dle);
                            seq8_ilog(inst, _msg);
#endif
                            tr->drum_current_step[_dl] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
                            _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
                        }
                    }
                } else {
                    uint16_t _le = (uint16_t)(cl->loop_start + cl->length);
                    if (tr->current_step < cl->loop_start || tr->current_step >= _le) {
#if SEQ8_DEBUG_PROBES
                        char _msg[160];
                        snprintf(_msg, sizeof(_msg),
                            "WINDOW SNAP: t%d melodic playhead %u -> %u (window [%u,%u))",
                            t, (unsigned)tr->current_step,
                            (unsigned)cl->loop_start,
                            (unsigned)cl->loop_start, (unsigned)_le);
                        seq8_ilog(inst, _msg);
#endif
                        tr->current_step = initial_clip_step(cl->loop_start, cl->length, cl->playback_dir);
                        cl->pp_dir_state = initial_pp_dir(cl->playback_dir);
                    }
                }
            }

            /* Gate countdown: decrement each play_pending slot; fire note-off at 0.
             * Runs before note-on so a gate expiring at step boundary doesn't double-fire. */
            {
                int pp;
                for (pp = 0; pp < (int)tr->play_pending_count; ) {
                    if (tr->play_pending[pp].ticks_remaining > 0)
                        tr->play_pending[pp].ticks_remaining--;
                    if (tr->play_pending[pp].ticks_remaining == 0) {
                        if (tr->pad_mode == PAD_MODE_DRUM && tr->play_pending[pp].lane_idx != 0xFF)
                            drum_pfx_note_off(inst, tr, &tr->drum_lane_pfx[tr->play_pending[pp].lane_idx], tr->play_pending[pp].pitch);
                        else
                            pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
                        tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                        tr->play_pending_count--;
                    } else {
                        pp++;
                    }
                }
                tr->note_active = (tr->play_pending_count > 0) ? 1 : 0;
            }

            /* v=34 Ratchet sub-hit fire: any ratchet_pending slot whose
             * ticks_until_fire reaches 0 fires its note-on now and is moved
             * into play_pending for its own gate countdown. Same-pitch
             * play_pending entries are silenced first to avoid stuck voices
             * when the previous sub-hit's gate hasn't elapsed yet. Runs
             * after the gate countdown above so a clean note-off at the
             * sub-hit boundary fires before the next sub-hit's note-on. */
            {
                int rp;
                for (rp = 0; rp < (int)tr->ratchet_pending_count; ) {
                    if (tr->ratchet_pending[rp].ticks_until_fire > 0)
                        tr->ratchet_pending[rp].ticks_until_fire--;
                    if (tr->ratchet_pending[rp].ticks_until_fire == 0) {
                        uint8_t  _rp_pitch = tr->ratchet_pending[rp].pitch;
                        uint8_t  _rp_vel   = tr->ratchet_pending[rp].vel;
                        uint16_t _rp_gate  = tr->ratchet_pending[rp].gate;
                        uint8_t  _rp_lane  = tr->ratchet_pending[rp].lane_idx;
                        /* Silence any same-pitch play_pending entry first */
                        int _pp2;
                        for (_pp2 = 0; _pp2 < (int)tr->play_pending_count; _pp2++) {
                            if (tr->play_pending[_pp2].pitch == _rp_pitch) {
                                if (_rp_lane != 0xFF)
                                    drum_pfx_note_off(inst, tr, &tr->drum_lane_pfx[_rp_lane], _rp_pitch);
                                else
                                    pfx_note_off(inst, tr, _rp_pitch);
                                tr->play_pending[_pp2] = tr->play_pending[tr->play_pending_count - 1];
                                tr->play_pending_count--;
                                break;
                            }
                        }
                        /* Fire note-on (melodic/drum split by lane_idx) */
                        if (_rp_lane != 0xFF)
                            drum_pfx_note_on(inst, tr, &tr->drum_lane_pfx[_rp_lane], _rp_pitch, _rp_vel);
                        else {
                            pfx_note_on(inst, tr, _rp_pitch, _rp_vel);
                            tr->pfx.active_notes[_rp_pitch].gate_override_smp =
                                pfx_ticks_to_smp(inst, tr, (uint32_t)_rp_gate);
                        }
                        /* Push to play_pending for the sub-hit's own gate countdown */
                        if (tr->play_pending_count < 32) {
                            int _pi = (int)tr->play_pending_count;
                            tr->play_pending[_pi].pitch           = _rp_pitch;
                            tr->play_pending[_pi].src_pitch       = _rp_pitch;
                            tr->play_pending[_pi].ticks_remaining = _rp_gate;
                            tr->play_pending[_pi].lane_idx        = _rp_lane;
                            tr->play_pending_count++;
                            tr->note_active = 1;
                        }
                        /* Drop slot via swap-and-pop */
                        tr->ratchet_pending[rp] = tr->ratchet_pending[tr->ratchet_pending_count - 1];
                        tr->ratchet_pending_count--;
                    } else {
                        rp++;
                    }
                }
            }

            if (inst->master_tick_in_step == 0) {
                /* Quantized boundary: launch queued clip (only if not waiting for page stop) */
                if (tr->queued_clip >= 0 && !tr->pending_page_stop &&
                    inst->global_tick % QUANT_STEPS[inst->launch_quant] == 0) {
                    silence_track_notes_v2(inst, tr);
                    /* Finalize CC latch on the OLD clip before switching, so a
                     * clip change doesn't carry overwrite into the new clip. */
                    cc_finalize_latch(tr);
                    tr->active_clip  = (uint8_t)tr->queued_clip;
                    tr->queued_clip  = -1;
                    tr->clip_playing = 1;
                    /* Clear any lingering recording-suppressor flags on the
                     * newly-active clip. Without this, notes recorded in a
                     * prior session that never saw a loop wrap (because the
                     * user switched clips before the cycle completed) stay
                     * suppressed and miss their first cycle on re-launch. */
                    if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
                        int _dl;
                        for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                            clip_t *_nc = &tr->drum_clips[tr->active_clip]->lanes[_dl].clip;
                            clip_clear_suppress(_nc);
                            drum_lane_anchor_playhead(inst, tr, _dl, _nc);
                        }
                    } else if (tr->pad_mode != PAD_MODE_DRUM) {
                        pfx_sync_from_clip(tr);
                        cl = &tr->clips[tr->active_clip];
                        clip_clear_suppress(cl);
                        if (inst->launch_quant < 5) {
                            melodic_anchor_playhead(inst, tr, cl);
                        } else {
                            tr->current_step = initial_clip_step(cl->loop_start, cl->length, cl->playback_dir);
                            cl->pp_dir_state = initial_pp_dir(cl->playback_dir);
                            tr->tick_in_step = 0;
                        }
                    }
                    if (tr->record_armed) {
                        memset(tr->cc_auto_touch_frame, 0, sizeof(tr->cc_auto_touch_frame));
                        memset(tr->drum_last_rec_step, 0xFF, sizeof(tr->drum_last_rec_step));
                        tr->recording    = 1;
                        tr->record_armed = 0;
                    }
                }

                /* Press-Record during playback: arm at next bar boundary so
                 * recording starts at the top of the next 16-step page rather
                 * than mid-page. Adaptive arms additionally reset the clip's
                 * playhead to loop_start so the boundary becomes the new step 0
                 * (avoids the "empty leading page" in adaptive mode). Fixed-mode
                 * arms never enter this path — JS sends recording=1 directly
                 * for them since the existing clip grid is the meaningful frame. */
                if (tr->recording_pending_page && inst->global_tick % 16 == 0) {
                    tr->recording_pending_page = 0;
                    tr->recording              = 1;
                    if (tr->recording_adaptive_arm) {
                        tr->recording_adaptive_arm = 0;
                        if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
                            int _dl;
                            for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                                clip_t *_dlc = &tr->drum_clips[tr->active_clip]->lanes[_dl].clip;
                                tr->drum_current_step[_dl] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
                                _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
                                tr->drum_tick_in_step[_dl] = 0;
                            }
                        } else if (tr->pad_mode != PAD_MODE_DRUM) {
                            clip_t *_mcl = &tr->clips[tr->active_clip];
                            tr->current_step = initial_clip_step(_mcl->loop_start, _mcl->length, _mcl->playback_dir);
                            _mcl->pp_dir_state = initial_pp_dir(_mcl->playback_dir);
                            tr->tick_in_step = 0;
                        }
                    }
                }

                /* Page stop: silence at next main clock bar boundary (global_tick % 16). */
                if (tr->pending_page_stop && inst->global_tick % 16 == 0) {
                    tr->pending_page_stop = 0;
                    tr->clip_playing      = 0;
                    silence_track_notes_v2(inst, tr);
                    if (tr->queued_clip >= 0) {
                        cc_finalize_latch(tr);  /* finalize latch on old clip before switch */
                        tr->active_clip  = (uint8_t)tr->queued_clip;
                        tr->queued_clip  = -1;
                        tr->clip_playing = 1;
                        /* Clear lingering recording-suppressor flags on the
                         * newly-launched clip — see queued-launch path above. */
                        if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
                            int _dl;
                            for (_dl = 0; _dl < DRUM_LANES; _dl++) {
                                clip_t *_nc = &tr->drum_clips[tr->active_clip]->lanes[_dl].clip;
                                clip_clear_suppress(_nc);
                                drum_lane_anchor_playhead(inst, tr, _dl, _nc);
                            }
                        } else if (tr->pad_mode != PAD_MODE_DRUM) {
                            pfx_sync_from_clip(tr);
                            cl = &tr->clips[tr->active_clip];
                            clip_clear_suppress(cl);
                            if (inst->launch_quant < 5) {
                                melodic_anchor_playhead(inst, tr, cl);
                            } else {
                                tr->current_step = initial_clip_step(cl->loop_start, cl->length, cl->playback_dir);
                                cl->pp_dir_state = initial_pp_dir(cl->playback_dir);
                                tr->tick_in_step = 0;
                            }
                        }
                        if (tr->record_armed) {
                            memset(tr->cc_auto_touch_frame, 0, sizeof(tr->cc_auto_touch_frame));
                            memset(tr->drum_last_rec_step, 0xFF, sizeof(tr->drum_last_rec_step));
                            tr->recording    = 1;
                            tr->record_armed = 0;
                        }
                    }
                }
            }

            /* Note-on: drum and melodic paths share the same note-firing logic but
             * drum iterates all 32 lanes, applying each lane's pfx params before scanning. */
            if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
                if (tr->clip_playing && !effective_mute(inst, t)) {
                    int l;
                    for (l = 0; l < DRUM_LANES; l++) {
                        drum_lane_t *lane = &tr->drum_clips[tr->active_clip]->lanes[l];
                        clip_t      *dlc  = &lane->clip;
                        drum_pfx_t  *dpx  = &tr->drum_lane_pfx[l];
                        if (dlc->note_count == 0) continue;
                        if (effective_drum_mute(tr, l)) continue;
                        uint32_t cct = playback_audible_cct(dlc, tr->drum_current_step[l], tr->drum_tick_in_step[l]);
                        uint8_t  lane_note = lane->midi_note;
                        uint16_t ni2;
                        for (ni2 = 0; ni2 < dlc->note_count; ni2++) {
                            note_t *n = &dlc->notes[ni2];
                            if (!n->active || n->suppress_until_wrap) continue;
                            if (note_audio_reverse_cmp_tick(n, dlc, lane->pfx_params.quantize) != cct) continue;
                            /* v=34 trig conditions (Iter + Random) — per-note */
                            uint16_t _sidx = note_step(n->tick, dlc->length, dlc->ticks_per_step);
                            if (!step_trig_pass(dlc, _sidx, (uint32_t)dlc->loop_cycle, &dpx->rng)) continue;
                            { int pp; for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                                if (tr->play_pending[pp].pitch == lane_note) {
                                    drum_pfx_note_off(inst, tr, dpx, lane_note);
                                    tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                                    tr->play_pending_count--;
                                    break;
                                }
                            }}
                            int eff_gate = (int)compute_effective_gate_ticks(
                                dlc->ticks_per_step, n->gate,
                                lane->pfx_params.note_length_mode,
                                lane->pfx_params.gate_time);
                            if (eff_gate < 1) eff_gate = 1;
                            /* v=34 Ratchet: r evenly-spaced sub-hits tiling exactly one
                             * step (Elektron-style). Sub-interval = TPS / r, regardless
                             * of the step's Leng. Sub-hit 0 fires now (below); 1..r-1
                             * are scheduled. ratchet < 2 = no ratchet (single emit). */
                            uint8_t  _ratch    = dlc->step_ratchet[_sidx];
                            if (_ratch < 2) _ratch = 1;
                            uint16_t _sub_gate = (_ratch > 1)
                                ? (uint16_t)(dlc->ticks_per_step / _ratch)
                                : (uint16_t)eff_gate;
                            if (_sub_gate < 1) _sub_gate = 1;
                            if (tr->play_pending_count < 32) {
                                tr->play_pending[tr->play_pending_count].pitch           = lane_note;
                                tr->play_pending[tr->play_pending_count].src_pitch       = lane_note;
                                tr->play_pending[tr->play_pending_count].ticks_remaining = _sub_gate;
                                tr->play_pending[tr->play_pending_count].lane_idx        = (uint8_t)l;
                                tr->play_pending_count++;
                                tr->note_active = 1;
                            }
                            drum_pfx_note_on(inst, tr, dpx, lane_note, n->vel);
                            if (_ratch > 1) {
                                int _k;
                                for (_k = 1; _k < _ratch; _k++) {
                                    if (tr->ratchet_pending_count >= 24) break;
                                    int _ri = (int)tr->ratchet_pending_count++;
                                    tr->ratchet_pending[_ri].pitch            = lane_note;
                                    tr->ratchet_pending[_ri].vel              = n->vel;
                                    tr->ratchet_pending[_ri].ticks_until_fire = (uint16_t)(_k * _sub_gate);
                                    tr->ratchet_pending[_ri].gate             = _sub_gate;
                                    tr->ratchet_pending[_ri].lane_idx         = (uint8_t)l;
                                }
                            }
                        }
                    }
                }
            } else {
                /* Melodic note-centric note-on: scan active clip's notes[]. */
                if (tr->clip_playing && !effective_mute(inst, t)) {
                    uint32_t cct = playback_audible_cct(cl, tr->current_step, tr->tick_in_step);
                    uint16_t ni2;
                    for (ni2 = 0; ni2 < cl->note_count; ni2++) {
                        note_t *n = &cl->notes[ni2];
                        if (!n->active || n->suppress_until_wrap) continue;
                        if (note_audio_reverse_cmp_tick(n, cl, tr->pfx.quantize) != cct) continue;
                        /* v=34 trig conditions (Iter + Random) — per-note */
                        uint16_t _sidx = note_step(n->tick, cl->length, cl->ticks_per_step);
                        if (!step_trig_pass(cl, _sidx, (uint32_t)cl->loop_cycle, &tr->pfx.rng)) continue;
                        /* Transpose preview: emit the remapped pitch, but key the
                         * "kill the previous instance of this note" check on the RAW
                         * source pitch (stable across LUT changes) and turn off the
                         * note at its STORED emitted pitch. If we matched on emit_pitch
                         * instead, a LUT change mid-sweep would orphan the old pending
                         * (its mapped pitch no longer matches), accumulating un-killed
                         * pendings until play_pending overflows → stuck notes. With raw
                         * matching, each clip note kills its own prior instance on
                         * re-fire; held notes ring at their old pitch until they
                         * naturally re-trigger. When preview is off emit_pitch == raw,
                         * so normal playback is unchanged. */
                        uint8_t emit_pitch = inst->xpose_preview_active ? inst->xpose_lut[n->pitch] : n->pitch;
                        { int pp; for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                            if (tr->play_pending[pp].src_pitch == n->pitch) {
                                pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
                                tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                                tr->play_pending_count--;
                                break;
                            }
                        }}
                        int eff_gate = (int)compute_effective_gate_ticks(
                            cl->ticks_per_step, n->gate,
                            cl->pfx_params.note_length_mode,
                            tr->pfx.gate_time);
                        if (eff_gate < 1) eff_gate = 1;
                        /* v=34 Ratchet: r evenly-spaced sub-hits tiling exactly one
                         * step (Elektron-style). Sub-interval = TPS / r, regardless
                         * of the step's Leng. Sub-hit 0 fires now (below); 1..r-1
                         * scheduled. ratchet < 2 = no ratchet (single emit). */
                        uint8_t  _ratch    = cl->step_ratchet[_sidx];
                        if (_ratch < 2) _ratch = 1;
                        uint16_t _sub_gate = (_ratch > 1)
                            ? (uint16_t)(cl->ticks_per_step / _ratch)
                            : (uint16_t)eff_gate;
                        if (_sub_gate < 1) _sub_gate = 1;
                        if (tr->play_pending_count < 32) {
                            int pp_idx = (int)tr->play_pending_count;
                            tr->play_pending[pp_idx].pitch          = emit_pitch;
                            tr->play_pending[pp_idx].src_pitch       = n->pitch;
                            tr->play_pending[pp_idx].ticks_remaining = _sub_gate;
                            tr->play_pending[pp_idx].lane_idx        = 0xFF;
                            tr->play_pending_count++;
                            tr->note_active = 1;
                        }
                        pfx_note_on(inst, tr, emit_pitch, n->vel);
                        tr->pfx.active_notes[emit_pitch].gate_override_smp =
                            pfx_ticks_to_smp(inst, tr, (uint32_t)_sub_gate);
                        if (_ratch > 1) {
                            int _k;
                            for (_k = 1; _k < _ratch; _k++) {
                                if (tr->ratchet_pending_count >= 24) break;
                                int _ri = (int)tr->ratchet_pending_count++;
                                tr->ratchet_pending[_ri].pitch            = emit_pitch;
                                tr->ratchet_pending[_ri].vel              = n->vel;
                                tr->ratchet_pending[_ri].ticks_until_fire = (uint16_t)(_k * _sub_gate);
                                tr->ratchet_pending[_ri].gate             = _sub_gate;
                                tr->ratchet_pending[_ri].lane_idx         = 0xFF;
                            }
                        }
                    }
                }
            }

            /* Conductor offset is now driven from the Conductor's own
             * pfx_note_on / pfx_note_off (covers sequenced + live pad). This
             * per-tick safety only handles MUTE: a muted Conductor snaps to
             * zero immediately, even mid-gate (no note-off fires when muted). */
            if (t == inst->conductor_track && tr->pad_mode == PAD_MODE_CONDUCT &&
                    effective_mute(inst, t)) {
                conductor_clear_offset(inst);
                inst->conductor_held = 0;
            }

            /* Drum Repeat: fire held-rate-pad retriggers independent of sequencer. */
            drum_repeat_tick(inst, tr);
            drum_repeat2_tick(inst, tr);
            /* TRACK ARP + SEQ ARP: tarp fires first (live arp → pfx chain →
             * SEQ ARP held buffer), then SEQ ARP fires from combined buffer. */
            tarp_tick(inst, tr);
            arp_tick(inst, tr);

            /* CC automation playback + latch recording (melodic clips only). A
             * knob latched (turned during recording) overwrites its lane along
             * the playhead; untouched knobs keep playing their automation. */
            if (tr->clip_playing &&
                (tr->pad_mode != PAD_MODE_DRUM || tr->drum_clips[tr->active_clip])) {
                clip_t    *_acl = &tr->clips[tr->active_clip];
                cc_auto_t *_ca  = &tr->clip_cc_auto[tr->active_clip];
                uint32_t   _tps = _acl->ticks_per_step;
                uint32_t   _abs_tick = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                   + (uint32_t)inst->master_tick_in_step;
                /* Playhead: melodic uses the track step counter; on drum that is
                 * frozen (only per-lane counters advance), so derive it from the
                 * master clock wrapped to the clip window — CC/AT automation is one
                 * shared track-level timeline, not drum-lane-aware. */
                uint32_t   _winlen = (uint32_t)_acl->length * _tps;
                uint32_t   _ct  = (tr->pad_mode == PAD_MODE_DRUM)
                                  ? ((uint32_t)_acl->loop_start * _tps
                                     + (_winlen ? (_abs_tick % _winlen) : 0))
                                  : ((uint32_t)tr->current_step * _tps + tr->tick_in_step);
                uint32_t   _ws  = (uint32_t)_acl->loop_start * _tps;
                uint32_t   _we  = (uint32_t)(_acl->loop_start + _acl->length) * _tps;
                int _kp;
                for (_kp = 0; _kp < 8; _kp++) {
                    int _def;
                    uint32_t _lws = _ws, _lwe = _we, _lct = _ct;
                    if (_ca->lane_length[_kp] > 0 || _ca->lane_tps[_kp] > 0
                        || _ca->lane_res_tps[_kp] > 0) {
                        uint32_t _disp_tps = _ca->lane_tps[_kp] > 0
                                           ? _ca->lane_tps[_kp] : _tps;
                        uint32_t _speed_tps = _ca->lane_res_tps[_kp] > 0
                                            ? _ca->lane_res_tps[_kp] : _disp_tps;
                        uint32_t _elen = _ca->lane_length[_kp] > 0
                                       ? _ca->lane_length[_kp] : _acl->length;
                        uint32_t _cycle = (uint32_t)_elen * _speed_tps;
                        uint32_t _data_len = (uint32_t)_elen * _disp_tps;
                        _lws = (uint32_t)_ca->lane_loop_start[_kp] * _disp_tps;
                        _lwe = _lws + _data_len;
                        uint32_t _prog = _abs_tick % _cycle;
                        _lct = _lws + (uint32_t)((uint64_t)_prog * _data_len / _cycle);
                    }
                    int _ov = cc_auto_eval(_ca, _kp, _lct, _lws, _lwe, &_def);
                    /* A latched knob is actively being recorded: report the live
                     * value being written (not the playhead eval, which trails
                     * the just-written point) so the JS cc_cur_vals poll keeps
                     * the right accumulator base, and suppress the playback emit
                     * — cc_send already sounds the turn live. */
                    if (tr->recording && ((tr->cc_latched >> _kp) & 1)) {
                        tr->cc_auto_cur_val[_kp] = tr->cc_live_val[_kp];
                        continue;
                    }
                    /* Capture the defined output value for the display. 0xFF = "—". */
                    tr->cc_auto_cur_val[_kp] = _def ? (uint8_t)_ov : 0xFF;
                    /* "—" (nothing defined here): send nothing — receiver holds
                     * its last value, so the loop carries over (opt-out of reset). */
                    if (!_def) continue;
                    uint8_t _sv = (uint8_t)_ov;
                    if (_sv != tr->cc_auto_last_sent[_kp]) {
                        tr->cc_auto_last_sent[_kp] = _sv;
                        cc_emit(tr, _kp, _sv);
                    }
                }
                /* Latch recording: overwrite each latched lane along the playhead
                 * with the current live value (one point per 1/32 cell, clearing
                 * whatever was there). Continues even when the knob isn't moving,
                 * until recording stops (finalized at the 1->0 edge above). */
                if (tr->recording && tr->cc_latched) {
                    int _kt;
                    for (_kt = 0; _kt < 8; _kt++) {
                        if (!((tr->cc_latched >> _kt) & 1)) continue;
                        uint32_t _rec_tick;
                        if (_ca->lane_length[_kt] > 0) {
                            uint32_t _ltps = _ca->lane_tps[_kt] > 0
                                           ? _ca->lane_tps[_kt] : _tps;
                            uint32_t _llen = (uint32_t)_ca->lane_length[_kt] * _ltps;
                            _rec_tick = _abs_tick % _llen;
                        } else {
                            _rec_tick = _ct;
                        }
                        uint32_t _snap = (_rec_tick / 12) * 12;
                        if (_snap == tr->cc_latch_last_snap[_kt]) continue;
                        /* Loop-wrap → decimate (collapse collinear points) */
                        if (_rec_tick < tr->cc_latch_last_snap[_kt])
                            cc_auto_decimate(_ca, _kt);
                        tr->cc_latch_last_snap[_kt] = _snap;
                        uint16_t _s = (uint16_t)(_snap <= 65534 ? _snap : 65534);
                        cc_auto_clear_range(_ca, _kt, _s, (uint16_t)(_s + 11));
                        cc_auto_set_point(_ca, _kt, _s, tr->cc_live_val[_kt]);
                    }
                    inst->state_dirty = 1;
                }
                /* Pad-pressure aftertouch automation playback (interpolated;
                 * independent of the live AftTch toggle — recorded AT always
                 * plays). Per-lane emit-on-change; cache reset on clip change. */
                {
                    at_auto_t *_at = &tr->clip_at_auto[tr->active_clip];
                    if (tr->at_last_clip != tr->active_clip) {
                        tr->at_last_clip = tr->active_clip;
                        memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
                    }
                    uint8_t _ach = tr->channel & 0x0F;
                    int _al;
                    for (_al = 0; _al < AT_MAX_LANES; _al++) {
                        uint8_t _ak = _at->pitch[_al];
                        if (_ak == AT_LANE_FREE) continue;
                        int _adef;
                        int _av = at_auto_eval(_at, _al, _ct, &_adef);
                        if (!_adef) continue;
                        if ((uint8_t)_av == tr->at_last_sent[_al]) continue;
                        tr->at_last_sent[_al] = (uint8_t)_av;
                        if (_ak == AT_LANE_CHAN)
                            pfx_send(&tr->pfx, (uint8_t)(0xD0 | _ach), (uint8_t)_av, 0);
                        else
                            pfx_send(&tr->pfx, (uint8_t)(0xA0 | _ach), _ak, (uint8_t)_av);
                    }
                }
            }
        }

        /* Conductor "Now": retrigger sounding responder notes at the new pitch
         * when the offset changed. Runs once here, AFTER the note-processing
         * loop above has settled the conductor offset for this tick (the
         * conductor's pfx_note_on sets it, pfx_note_off / per-tick mute-clear
         * clear it). ~1-tick lag is fine. */
        conductor_apply_now_retrigger(inst);

        /* Per-track tick advance and step advance */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
                /* Drum: advance per-lane tick counters independently. */
                int l;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_t *dlc = &tr->drum_clips[tr->active_clip]->lanes[l].clip;
                    tr->drum_tick_in_step[l]++;
                    if (tr->drum_tick_in_step[l] >= dlc->ticks_per_step) {
                        tr->drum_tick_in_step[l] = 0;
                        if (tr->clip_playing) {
                            uint16_t ns2; int8_t pp_new; uint8_t wrapped;
                            advance_clip_step(tr->drum_current_step[l],
                                              dlc->loop_start, dlc->length,
                                              dlc->playback_dir, dlc->playback_audio_reverse,
                                              dlc->pp_dir_state,
                                              &ns2, &pp_new, &wrapped);
                            dlc->pp_dir_state = pp_new;
                            if (wrapped) {
                                uint16_t ni2;
                                for (ni2 = 0; ni2 < dlc->note_count; ni2++)
                                    dlc->notes[ni2].suppress_until_wrap = 0;
                                dlc->loop_cycle++;   /* v=34 Iter counter */
                            }
                            tr->drum_current_step[l] = ns2;
                        }
                    }
                }
            } else {
                clip_t *cl = &tr->clips[tr->active_clip];
                tr->tick_in_step++;
                if (tr->tick_in_step >= cl->ticks_per_step) {
                    tr->tick_in_step = 0;
                    if (tr->clip_playing) {
                        uint16_t ns2; int8_t pp_new; uint8_t wrapped;
                        advance_clip_step(tr->current_step,
                                          cl->loop_start, cl->length,
                                          cl->playback_dir, cl->playback_audio_reverse,
                                          cl->pp_dir_state,
                                          &ns2, &pp_new, &wrapped);
                        cl->pp_dir_state = pp_new;
                        if (wrapped) {
                            uint16_t ni2;
                            for (ni2 = 0; ni2 < cl->note_count; ni2++)
                                cl->notes[ni2].suppress_until_wrap = 0;
                            memset(tr->live_recorded_steps, 0, 32);
                            /* SEQ ARP retrigger=1: restart pattern on clip wrap. */
                            if (tr->pfx.arp.style != 0 && tr->pfx.arp.retrigger)
                                tr->pfx.arp.pending_retrigger = 1;
                            cl->loop_cycle++;   /* v=34 Iter counter */
                        }
                        tr->current_step = ns2;
                    }
                }
                tr->current_clip_tick = playback_audible_cct(cl, tr->current_step, tr->tick_in_step);
            }
        }
        /* Master tick advance: drives global_tick and launch-quant boundary */
        inst->master_tick_in_step++;
        if (inst->master_tick_in_step >= TICKS_PER_STEP) {
            inst->master_tick_in_step = 0;
            inst->global_tick++;
        }
        inst->arp_master_tick++;
        clock_send_f8_tick(inst);  /* continuous 24-PPQN clock out while playing (free-run master) */
    }

mix_click:
    /* Mix metro click into output */
    if (out_lr && frames > 0 && inst->metro_wav_data
            && inst->metro_click_pos != UINT32_MAX && inst->metro_vol > 0) {
        float gain = inst->metro_vol / 100.0f;
        int _ci;
        for (_ci = 0; _ci < frames && inst->metro_click_pos < inst->metro_wav_frames; _ci++) {
            float s = (float)inst->metro_wav_data[inst->metro_click_pos] / 32768.0f * gain;
            int32_t v = (int32_t)(s * 32767.0f);
            if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
            out_lr[_ci * 2]     += (int16_t)v;
            out_lr[_ci * 2 + 1] += (int16_t)v;
            inst->metro_click_pos++;
        }
        if (inst->metro_click_pos >= inst->metro_wav_frames)
            inst->metro_click_pos = UINT32_MAX;
    }
}
