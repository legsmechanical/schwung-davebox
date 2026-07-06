/* seq8_drum.c — drum per-lane play-effects engine (monophonic; no harmony/arp).
 * Contents: drum_pfx_emit, drum_pfx_q_insert, drum_pfx_send, drum_pfx_q_fire,
 * drum_pfx_spc, drum_pfx_gate_smp, drum_pfx_sched_delay_ons/offs,
 * drum_pfx_note_on/off/off_imm, drum_lane_note_off_imm. #include'd into
 * seq8.c's single TU at the original position; never compiled standalone.
 * NOTE: drum_pad_event is NOT here — it lives near on_midi in core; relocating
 * it would reorder the TU (it depends on later definitions). */
/* ------------------------------------------------------------------ */
/* Drum per-lane play effects (monophonic, no harmony/arp)             */
/* ------------------------------------------------------------------ */

static void drum_pfx_emit(drum_pfx_t *px, uint8_t status, uint8_t d1, uint8_t d2) {
    if (!g_host) return;
    /* Conductor track emits NO MIDI. The drum playback path (drum_pfx_send →
     * swing-defer queue → drum_pfx_q_fire → drum_pfx_send → here) bypasses
     * pfx_emit and calls the host MIDI routes directly, so the Conductor guard
     * must be mirrored here. Drop at emit only — drum step-advance/playhead in
     * the render path is untouched, exactly like the melodic pfx_emit guard. */
    if (g_inst && px->track_idx < NUM_TRACKS &&
            g_inst->tracks[px->track_idx].pad_mode == PAD_MODE_CONDUCT)
        return;
    if (px->route == ROUTE_MOVE) {
        if (!g_host->midi_inject_to_move) return;
        uint8_t pkt[4] = { (uint8_t)(0x20 | (status >> 4)), status, d1, d2 };
        g_host->midi_inject_to_move(pkt, 4);
        return;
    }
    if (px->route == ROUTE_EXTERNAL) {
        /* See pfx_emit ROUTE_EXTERNAL branch. Cable-2 nibble for USB-A out. */
        if (g_host->midi_send_external) {
            const uint8_t pkt[4] = { (uint8_t)(0x20 | ((status >> 4) & 0x0F)), status, d1, d2 };
            g_host->midi_send_external(pkt, 4);
        }
        return;
    }
    const uint8_t msg[4] = { (uint8_t)(status >> 4), status, d1, d2 };
    if (g_host->midi_send_internal) g_host->midi_send_internal(msg, 4);
}

static void drum_pfx_q_insert(drum_pfx_t *px, uint64_t fire_at,
                              uint8_t s, uint8_t d1, uint8_t d2, uint8_t flags) {
    if (px->event_count >= DRUM_PFX_MAX_EVENTS) return;
    int lo = 0, hi = px->event_count;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (px->events[mid].fire_at <= fire_at) lo = mid + 1;
        else hi = mid;
    }
    if (lo < px->event_count)
        memmove(&px->events[lo + 1], &px->events[lo],
                (size_t)(px->event_count - lo) * sizeof(pfx_event_t));
    px->events[lo].fire_at = fire_at;
    px->events[lo].msg[0]  = s;
    px->events[lo].msg[1]  = d1;
    px->events[lo].msg[2]  = d2;
    px->events[lo].flags   = flags;
    px->event_count++;
}

static void drum_pfx_send(drum_pfx_t *px, uint8_t status, uint8_t d1, uint8_t d2) {
    /* Global MIDI Looper hook */
    if (g_inst && px->looper_on && !g_inst->looper_emitting) {
        uint8_t st = status & 0xF0;
        if (g_inst->looper_state == LOOPER_STATE_CAPTURING &&
                (st == 0x90 || st == 0x80) &&
                g_inst->looper_event_count < LOOPER_MAX_EVENTS) {
            int ei = (int)g_inst->looper_event_count++;
            g_inst->looper_events[ei].tick   = (uint16_t)g_inst->looper_pos;
            g_inst->looper_events[ei].status = status;
            g_inst->looper_events[ei].d1     = d1;
            g_inst->looper_events[ei].d2     = d2;
            g_inst->looper_events[ei].track  = px->track_idx;
            /* Apply perf mods to live emit so mods kick in immediately during
             * the first capture cycle. perf_apply skips pitch transforms for
             * drum tracks (gated on tr_idx pad_mode==DRUM); vel/gate/cycle
             * suppression mods still apply. Captured event stays raw. */
            if (g_inst->perf_mods_active && px->track_idx < NUM_TRACKS) {
                uint8_t raw_d1 = d1;
                g_inst->perf_current_event_idx = (uint16_t)ei;
                if (!perf_apply(g_inst, px->track_idx, status, &d1, &d2)) {
                    if (raw_d1 < 128)
                        g_inst->perf_emitted_pitch[px->track_idx][raw_d1] = 0xFF;
                    return; /* suppressed (sparse/halftime/staccato/legato/ramp) */
                }
                if (st == 0x90 && d2 > 0) {
                    looper_mark_active(g_inst, px->track_idx, raw_d1, d1);
                    /* Phantom: ghost note at pitch-12, vel/4, gate=cap/8.
                     * Match LOOPING playback path — emit via track's melodic pfx. */
                    if ((g_inst->perf_mods_active & PERF_MOD_PHANTOM) &&
                            g_inst->perf_staccato_count < 32) {
                        int gp = (int)d1 - 12;
                        if (gp >= 0) {
                            uint8_t gpb = (uint8_t)gp;
                            uint8_t gv  = d2 / 4 < 1 ? 1 : d2 / 4;
                            uint16_t cap = g_inst->looper_capture_ticks;
                            uint16_t gap = cap / 8 < 2 ? 2 : cap / 8;
                            uint16_t gfire = (uint16_t)((g_inst->looper_pos + gap) % cap);
                            play_fx_t *track_fx = &g_inst->tracks[px->track_idx].pfx;
                            g_inst->looper_emitting = 1;
                            pfx_send(track_fx, status, gpb, gv);
                            g_inst->looper_emitting = 0;
                            int si = (int)g_inst->perf_staccato_count++;
                            g_inst->perf_staccato_notes[si].raw_pitch     = 0xFF;
                            g_inst->perf_staccato_notes[si].emitted_pitch = gpb;
                            g_inst->perf_staccato_notes[si].track         = px->track_idx;
                            g_inst->perf_staccato_notes[si].fire_at       = gfire;
                        }
                    }
                } else {
                    looper_mark_active(g_inst, px->track_idx, raw_d1, 0xFF);
                }
            }
            /* fall through and emit normally */
        } else if (g_inst->looper_state == LOOPER_STATE_LOOPING) {
            return;
        }
    }
    /* Live Merge hook (drum-lane pfx): same per-track capture as melodic.
     * Capture continues during STOPPING — see melodic comment. */
    if (g_inst && (g_inst->merge_state == MERGE_STATE_CAPTURING ||
                   g_inst->merge_state == MERGE_STATE_STOPPING)) {
        uint8_t st  = status & 0xF0;
        uint8_t tri = px->track_idx;
        if (tri < NUM_TRACKS && (st == 0x90 || st == 0x80)) {
            uint32_t abs_now = g_inst->global_tick * TICKS_PER_STEP
                               + g_inst->master_tick_in_step;
            uint32_t rel = abs_now > g_inst->merge_start_abs
                           ? abs_now - g_inst->merge_start_abs : 0;
            if (rel >= 256u * g_inst->merge_tps) {
                merge_finalize(g_inst);
            } else if (st == 0x90 && d2 > 0) {
                if (g_inst->merge_pending_count[tri] < 512) {
                    int _pi = (int)g_inst->merge_pending_count[tri]++;
                    g_inst->merge_pending[tri][_pi].pitch      = d1;
                    g_inst->merge_pending[tri][_pi].tick_at_on = rel;
                    g_inst->merge_pending[tri][_pi].vel        = d2;
                    g_inst->merge_pending[tri][_pi].gate       = 0;
                }
            } else {
                int _pi;
                for (_pi = (int)g_inst->merge_pending_count[tri] - 1; _pi >= 0; _pi--) {
                    if (g_inst->merge_pending[tri][_pi].pitch == d1 &&
                        g_inst->merge_pending[tri][_pi].gate == 0) {
                        uint32_t gate = rel > g_inst->merge_pending[tri][_pi].tick_at_on
                                        ? rel - g_inst->merge_pending[tri][_pi].tick_at_on : 1;
                        if (gate == 0)     gate = 1;
                        if (gate > 65535u) gate = 65535u;
                        g_inst->merge_pending[tri][_pi].gate = (uint16_t)gate;
                        break;
                    }
                }
            }
        }
    }
    /* Swing deferral. Mirrors pfx_send: applies in both transport states so
     * Rpt1/Rpt2 swing while stopped; live drum taps bypass via emit_bypass_swing.
     * Events re-entering from the drum drain skip swing — schedule-time swing
     * already baked their fire_at, so re-queueing would scramble pair order. */
    if (g_inst && g_inst->swing_step_delay > 0
            && !g_inst->emit_bypass_swing
            && !g_inst->in_queue_drain) {
        uint8_t st = status & 0xF0;
        if (st == 0x90 || st == 0x80) {
            drum_pfx_q_insert(px, px->sample_counter + g_inst->swing_step_delay,
                              status, d1, d2, PFX_EV_BYPASS_SWING);
            return;
        }
    }
    drum_pfx_emit(px, status, d1, d2);
}

static void drum_pfx_q_fire(drum_pfx_t *px, uint64_t now) {
    if (g_inst) g_inst->in_queue_drain = 1;
    int f = 0;
    while (f < px->event_count && px->events[f].fire_at <= now) {
        if (px->events[f].flags & PFX_EV_BYPASS_SWING)
            drum_pfx_emit(px, px->events[f].msg[0], px->events[f].msg[1], px->events[f].msg[2]);
        else
            drum_pfx_send(px, px->events[f].msg[0], px->events[f].msg[1], px->events[f].msg[2]);
        f++;
    }
    if (f > 0) {
        px->event_count -= f;
        if (px->event_count > 0)
            memmove(&px->events[0], &px->events[f],
                    (size_t)px->event_count * sizeof(pfx_event_t));
    }
    if (g_inst) g_inst->in_queue_drain = 0;
}

static double drum_pfx_spc(seq8_instance_t *inst, drum_pfx_t *px) {
    double bpm = px->cached_bpm > 0 ? px->cached_bpm : (double)BPM_DEFAULT;
    return ((double)inst->sample_rate * 60.0) / (bpm * 480.0);
}

static uint64_t drum_pfx_gate_smp(seq8_instance_t *inst, drum_pfx_t *px) {
    double sp  = drum_pfx_spc(inst, px);
    double raw = (double)(GATE_TICKS * TICKS_TO_480PPQN) * sp;
    double g   = raw * (double)px->gate_time / 100.0;
    if (g < 1.0 && px->gate_time > 0) g = 1.0;
    return (uint64_t)(g + 0.5);
}

/* Schedule delay repeat note-ons. No pitch feedback — drums always replay the same pitch. */
static void drum_pfx_sched_delay_ons(drum_pfx_t *px, pfx_active_t *an,
                                     uint64_t base_time, double sp) {
    if (px->repeat_times == 0 || px->delay_level == 0) return;
    int dclk = CLOCK_VALUES[px->delay_time_idx];
    if (dclk == 0) return;

    int reps = clamp_i(px->repeat_times, 0, MAX_REPEATS);
    an->stored_repeat_count = reps;
    an->spc = sp;

    double cumul     = 0.0;
    double cur_delay = (double)dclk * sp;
    int    rep_vel   = (int)an->orig_velocity * px->delay_level / 127;

    uint8_t on_s = (uint8_t)(0x90 | an->channel);
    uint8_t note = an->gen_notes[0];

    int i;
    for (i = 0; i < reps; i++) {
        cumul += cur_delay;
        if ((uint64_t)(cumul + 0.5) > MAX_DELAY_SAMPLES) {
            an->stored_repeat_count = i;
            break;
        }
        if (i > 0) rep_vel += px->fb_velocity;
        rep_vel = clamp_i(rep_vel, 1, 127);
        an->reps[i].pitch_offset = 0;
        an->reps[i].velocity     = (uint8_t)rep_vel;
        if (px->fb_gate_time > 0)
            an->reps[i].gate_factor = -(double)GATE_FIXED_TICKS[px->fb_gate_time - 1]
                                      * (double)TICKS_TO_480PPQN * sp;
        else
            an->reps[i].gate_factor = 1.0;
        an->reps[i].cumul_delay = (uint64_t)(cumul + 0.5);
        {
            uint64_t ft = base_time + an->reps[i].cumul_delay;
            ft += swing_offset_for_fire_at(g_inst, px->sample_counter, ft);
            drum_pfx_q_insert(px, ft, on_s, note, (uint8_t)rep_vel, 0);
        }
        cur_delay *= (1.0 + px->fb_clock / 100.0);
        if (cur_delay < 1.0) cur_delay = 1.0;
    }
}

static void drum_pfx_sched_delay_offs(drum_pfx_t *px, pfx_active_t *an,
                                      uint64_t base_time, uint64_t gate_smp) {
    uint8_t off_s = (uint8_t)(0x80 | an->channel);
    uint8_t note  = an->gen_notes[0];
    int i;
    for (i = 0; i < an->stored_repeat_count; i++) {
        double rg = an->reps[i].gate_factor >= 0.0
            ? (double)gate_smp * an->reps[i].gate_factor
            : -an->reps[i].gate_factor;
        if (rg < 1.0) rg = 1.0;
        uint64_t off = base_time + an->reps[i].cumul_delay + (uint64_t)(rg + 0.5);
        off += swing_offset_for_fire_at(g_inst, px->sample_counter, off);
        drum_pfx_q_insert(px, off, off_s, note, 0, 0);
    }
}

static void drum_pfx_note_on(seq8_instance_t *inst, seq8_track_t *tr,
                             drum_pfx_t *px, uint8_t pitch, uint8_t vel) {
    uint8_t       ch  = tr->channel;
    uint64_t      now = px->sample_counter;
    pfx_active_t *an  = &px->active_note;

    int v = clamp_i((int)vel + px->velocity_offset, 1, 127);

    if (an->active)
        drum_pfx_send(px, (uint8_t)(0x80 | an->channel), an->gen_notes[0], 0);

    /* Delay retrig (drum): drop in-flight echoes from prior hit, mirroring the
     * melodic path in pfx_note_on. */
    if (px->delay_retrig && px->event_count > 0) {
        int qi;
        for (qi = 0; qi < px->event_count; qi++) {
            pfx_event_t *ev = &px->events[qi];
            uint8_t st = ev->msg[0] & 0xF0;
            if (st == 0x90 || st == 0x80) {
                uint8_t off = (uint8_t)(0x80 | (ev->msg[0] & 0x0F));
                drum_pfx_send(px, off, ev->msg[1], 0);
            }
        }
        px->event_count = 0;
    }

    memset(an, 0, sizeof(pfx_active_t));
    an->active        = 1;
    an->channel       = ch;
    an->on_time       = now;
    an->orig_velocity = (uint8_t)v;
    an->gen_count     = 1;
    an->gen_notes[0]  = pitch;

    double sp = drum_pfx_spc(inst, px);
    drum_pfx_send(px, (uint8_t)(0x90 | ch), pitch, (uint8_t)v);
    drum_pfx_sched_delay_ons(px, an, now, sp);
}

static void drum_pfx_note_off(seq8_instance_t *inst, seq8_track_t *tr,
                              drum_pfx_t *px, uint8_t pitch) {
    pfx_active_t *an = &px->active_note;
    if (!an->active) return;
    (void)pitch;

    uint64_t now      = px->sample_counter;
    uint64_t gate_smp = drum_pfx_gate_smp(inst, px);
    uint64_t off_time = an->on_time + gate_smp;
    uint8_t  off_s    = (uint8_t)(0x80 | an->channel);

    if (off_time <= now)
        drum_pfx_send(px, off_s, an->gen_notes[0], 0);
    else
        drum_pfx_q_insert(px, off_time, off_s, an->gen_notes[0], 0, 0);

    drum_pfx_sched_delay_offs(px, an, an->on_time, gate_smp);
    an->active = 0;
}

/* Immediate note-off — bypasses gate_smp minimum (for live pad releases). */
static void drum_pfx_note_off_imm(seq8_instance_t *inst, seq8_track_t *tr,
                                   drum_pfx_t *px, uint8_t pitch) {
    pfx_active_t *an = &px->active_note;
    if (!an->active) return;
    (void)pitch;

    drum_pfx_send(px, (uint8_t)(0x80 | an->channel), an->gen_notes[0], 0);
    drum_pfx_sched_delay_offs(px, an, an->on_time, drum_pfx_gate_smp(inst, px));
    an->active = 0;
}

/* Find drum lane by midi_note pitch and call drum_pfx_note_off_imm on its per-lane pfx. */
static void drum_lane_note_off_imm(seq8_instance_t *inst, seq8_track_t *tr, uint8_t pitch) {
    int l;
    for (l = 0; l < DRUM_LANES; l++) {
        if (tr->drum_clips[tr->active_clip]->lanes[l].midi_note == pitch) {
            drum_pfx_note_off_imm(inst, tr, &tr->drum_lane_pfx[l], pitch);
            return;
        }
    }
}
