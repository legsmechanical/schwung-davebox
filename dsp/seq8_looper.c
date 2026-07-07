/* seq8_looper.c — Global MIDI Looper engine (perf-mode capture/playback).
 * Contents: looper_mark_active, looper_silence_active, perf_apply,
 * looper_tick, looper_stop. #include'd into seq8.c's single TU at the
 * original position; never compiled standalone. merge_finalize/merge_place
 * (live-merge) stay in core — they are separated from this block by
 * pfx_send/pfx_emit and are not contiguous with the looper. */
/* ------------------------------------------------------------------ */
/* Global MIDI Looper                                                   */
/* ------------------------------------------------------------------ */

/* Record or clear the emitted pitch for a sounding looper note.
 * raw = captured pitch; emitted = translated output pitch (0xFF = clear/inactive). */
static inline void looper_mark_active(seq8_instance_t *inst, uint8_t track,
                                       uint8_t raw_pitch, uint8_t emitted_pitch) {
    if (track >= NUM_TRACKS || raw_pitch >= 128) return;
    inst->perf_emitted_pitch[track][raw_pitch] = emitted_pitch;
}

/* Send note-offs for every sounding looper note and drain pending queues.
 * Handles both tracked notes (perf_emitted_pitch) and phantom notes
 * (staccato queue, raw_pitch=0xFF sentinel = not in emitted table).
 * Safe to call from any looper state. */
static void looper_silence_active(seq8_instance_t *inst) {
    int t, p, si;
    uint16_t ei;
    inst->looper_emitting = 1;
    for (t = 0; t < NUM_TRACKS; t++) {
        play_fx_t *fx = &inst->tracks[t].pfx;
        for (p = 0; p < 128; p++) {
            uint8_t ep = inst->perf_emitted_pitch[t][p];
            if (ep != 0xFF) {
                pfx_send(fx, (uint8_t)(0x80 | inst->tracks[t].channel), ep, 0);
                inst->perf_emitted_pitch[t][p] = 0xFF;
            }
        }
    }
    /* Drain pending queue for phantom notes (raw_pitch=0xFF → not in emitted table). */
    for (si = 0; si < (int)inst->perf_staccato_count; si++) {
        if (inst->perf_staccato_notes[si].raw_pitch == 0xFF) {
            uint8_t tr = inst->perf_staccato_notes[si].track;
            uint8_t ep = inst->perf_staccato_notes[si].emitted_pitch;
            if (tr < NUM_TRACKS)
                pfx_send(&inst->tracks[tr].pfx,
                         (uint8_t)(0x80 | inst->tracks[tr].channel), ep, 0);
        }
    }
    inst->perf_staccato_count = 0;
    /* Safety net: any note-on captured into looper_events whose pass-through
     * emit was NOT tracked in perf_emitted_pitch (happens during CAPTURING
     * without perf_mods_active — see pfx_send line ~1886) won't be reached
     * by the table sweep above. Send note-offs for every captured note-on
     * directly. Duplicate offs are harmless: the table sweep already cleared
     * the 0xFF sentinel for entries it found, and synths drop unmatched offs. */
    for (ei = 0; ei < inst->looper_event_count; ei++) {
        uint8_t st = inst->looper_events[ei].status & 0xF0;
        uint8_t d2 = inst->looper_events[ei].d2;
        if (st == 0x90 && d2 > 0) {
            uint8_t tr = inst->looper_events[ei].track;
            uint8_t d1 = inst->looper_events[ei].d1;
            if (tr < NUM_TRACKS)
                pfx_send(&inst->tracks[tr].pfx,
                         (uint8_t)(0x80 | inst->tracks[tr].channel), d1, 0);
        }
    }
    inst->looper_emitting = 0;
}

/* Apply active Performance Mode modifiers to one looper event.
 * Transforms pitch/velocity in-place; returns 0 to suppress, 1 to emit.
 * inst->perf_current_event_idx must be set to the event index before each call.
 * Gate-override mods (Staccato/Legato/Ramp Gate) enqueue note-offs in the staccato queue;
 * captured note-offs are suppressed in the is_off path.
 * Phantom ghost notes are emitted directly from looper_tick after this call. */
static int perf_apply(seq8_instance_t *inst, uint8_t tr_idx,
                      uint8_t status, uint8_t *d1, uint8_t *d2) {
    uint32_t mods = inst->perf_mods_active;
    uint8_t  hi   = status & 0xF0;
    int is_on  = (hi == 0x90 && *d2 > 0);
    int is_off = (hi == 0x80 || (hi == 0x90 && *d2 == 0));

    /* Note-off: always use xlate table so pitch matches what was emitted. */
    if (is_off) {
        if (tr_idx >= NUM_TRACKS || *d1 >= 128) return 0;
        uint8_t ep = inst->perf_emitted_pitch[tr_idx][*d1];
        if (ep == 0xFF) return 0;
        *d1 = ep;
        if (mods & (PERF_MOD_STACCATO | PERF_MOD_LEGATO | PERF_MOD_RAMP_GATE)) return 0;
        return 1;
    }

    if (!mods) return 1;

    /* Cycle-level suppression. */
    if ((mods & PERF_MOD_HALFTIME)     && (inst->looper_cycle & 1u))        return 0;
    if ((mods & PERF_MOD_TRIPLET_SKIP) && (inst->looper_cycle % 3u) == 2u) return 0;

    if (!is_on) return 1;

    uint8_t raw_d1 = *d1;
    int pitch = (int)*d1;
    int vel   = (int)*d2;

    /* Sparse: ~50% per (pitch, pos, cycle). */
    if (mods & PERF_MOD_SPARSE) {
        unsigned s = (unsigned)pitch * 31337u + (unsigned)inst->looper_pos * 127u
                   + (unsigned)inst->looper_cycle * 53u;
        if ((s >> 7) & 1u) return 0;
    }

    /* Shuffle / Backwards: replace pitch with permuted value (drums: swaps hits).
     * Table built at cycle start; note-offs still use xlate table for correctness. */
    if (mods & (PERF_MOD_SHUFFLE | PERF_MOD_BACKWARDS)) {
        uint16_t ei = inst->perf_current_event_idx;
        if (ei < LOOPER_MAX_EVENTS)
            pitch = (int)inst->perf_shuffle_pitches[ei];
    }

    /* Pitch transforms: drum tracks bypass semitone-based mods.
     * All interval mods use scale_transpose (scale-degree offsets) so results
     * stay in-key. Oct↑/Oct↓ use chromatic ±12 — octave shift is scale-neutral. */
    int is_drum = tr_idx < NUM_TRACKS
                  && inst->tracks[tr_idx].pad_mode == PAD_MODE_DRUM;
    if (!is_drum) {
        /* Cycle-based pitch mods. looper_cycle increments at each loop wrap;
         * the mods animate over cycles instead of being static offsets.
         * 76/77 alternate octave/original each cycle.
         * 78-81 ascend (or descend) by their interval each cycle, then reset
         * to the original on the 4th cycle (3 iterations + reset). */
        const uint32_t cyc       = inst->looper_cycle;
        const int      cyc_alt   = (int)(cyc & 1u);          /* 0,1,0,1,... */
        const int      cyc_phase = (int)(cyc & 3u);          /* 0,1,2,3,...repeat */
        if (mods & PERF_MOD_OCT_UP) {
            if (cyc_alt == 0) pitch = pitch + 12 > 127 ? 127 : pitch + 12;
        }
        if (mods & PERF_MOD_OCT_DOWN) {
            if (cyc_alt == 0) pitch = pitch - 12 < 0 ? 0 : pitch - 12;
        }
        if (mods & PERF_MOD_SCALE_UP) {
            if (cyc_phase < 3)
                pitch = scale_transpose(inst, pitch, cyc_phase + 1);
        }
        if (mods & PERF_MOD_SCALE_DOWN) {
            if (cyc_phase < 3)
                pitch = scale_transpose(inst, pitch, -(cyc_phase + 1));
        }
        /* 5th: +4 scale degrees per cycle (5th, octave+2nd, octave+5th, reset). */
        if (mods & PERF_MOD_FIFTH) {
            if (cyc_phase < 3)
                pitch = scale_transpose(inst, pitch, 4 * (cyc_phase + 1));
        }
        /* Tritone: +3 scale degrees per cycle (4th, 6th, octave+2nd, reset). */
        if (mods & PERF_MOD_TRITONE) {
            if (cyc_phase < 3)
                pitch = scale_transpose(inst, pitch, 3 * (cyc_phase + 1));
        }
        /* Drift: accumulated scale-degree walk (±1 deg/cycle, clamped ±6). */
        if (mods & PERF_MOD_DRIFT)
            pitch = scale_transpose(inst, pitch, (int)inst->perf_drift_offset);
        /* Storm: random ±6 scale degrees. */
        if (mods & PERF_MOD_STORM) {
            unsigned s = (unsigned)raw_d1 * 31337u + (unsigned)inst->looper_pos * 7919u
                       + (unsigned)inst->looper_cycle * 6271u + 89u;
            pitch = scale_transpose(inst, pitch, (int)(s % 13u) - 6);
        }
        /* Glitch: random ±2 scale degrees. */
        if (mods & PERF_MOD_GLITCH) {
            unsigned s = (unsigned)raw_d1 * 31337u + (unsigned)inst->looper_pos * 7919u
                       + (unsigned)inst->looper_cycle * 6271u;
            pitch = scale_transpose(inst, pitch, (int)(s % 5u) - 2);
        }
        /* Stagger: note N in cycle gets +N scale degrees (resets each cycle). */
        if (mods & PERF_MOD_STAGGER)
            pitch = scale_transpose(inst, pitch, (int)(inst->perf_cycle_note_idx % 7u));
    }

    /* Velocity transforms: all multiplicative so effect scales with incoming vel. */
    if (mods & PERF_MOD_DECRSC) {
        int f = 100 - (int)inst->looper_cycle * 15;
        vel = vel * (f < 10 ? 10 : f) / 100;
        if (vel < 1) vel = 1;
    }
    if (mods & PERF_MOD_SWELL) {
        int phase = (int)(inst->looper_cycle % 16u);
        int sw    = 8 - (phase < 8 ? phase : 16 - phase);  /* 8→0→8 over 16 cycles */
        vel = vel * (sw + 2) / 10;
        if (vel < 1) vel = 1;
    }
    if (mods & PERF_MOD_CRESC) {
        vel = vel * (100 + (int)inst->looper_cycle * 15) / 100;
        if (vel > 127) vel = 127;
    }
    if ((mods & PERF_MOD_PULSE) && (inst->looper_cycle & 1u))
        vel = vel / 5 < 1 ? 1 : vel / 5;
    if (mods & PERF_MOD_SIDECHAIN) {
        int f = 100 - (int)inst->perf_cycle_note_idx * 15;
        vel = vel * (f < 10 ? 10 : f) / 100;
        if (vel < 1) vel = 1;
    }

    *d1 = (uint8_t)(pitch < 0 ? 0 : pitch > 127 ? 127 : pitch);
    *d2 = (uint8_t)(vel   < 1 ? 1 : vel   > 127 ? 127 : vel);

    /* Gate-override mods: enqueue note-off; priority Legato > Staccato > Ramp Gate. */
    if (inst->perf_staccato_count < 32) {
        uint16_t cap  = inst->looper_capture_ticks;
        uint16_t fire = 0;
        int       enq = 0;
        if (mods & PERF_MOD_LEGATO) {
            fire = (uint16_t)((inst->looper_pos + cap - 1) % cap);
            enq  = 1;
        } else if (mods & PERF_MOD_STACCATO) {
            uint16_t gap = cap / 8 < 2 ? 2 : cap / 8;
            fire = (uint16_t)((inst->looper_pos + gap) % cap);
            enq  = 1;
        } else if (mods & PERF_MOD_RAMP_GATE) {
            uint16_t nc = inst->perf_note_on_count > 0 ? inst->perf_note_on_count : 1;
            uint32_t g  = (uint32_t)cap * (inst->perf_cycle_note_idx + 1) / nc;
            if (g < 2) g = 2;
            if (g >= cap) g = cap - 1;
            fire = (uint16_t)((inst->looper_pos + g) % cap);
            enq  = 1;
        }
        if (enq) {
            int si = (int)inst->perf_staccato_count++;
            inst->perf_staccato_notes[si].raw_pitch     = raw_d1;
            inst->perf_staccato_notes[si].emitted_pitch = *d1;
            inst->perf_staccato_notes[si].track         = tr_idx;
            inst->perf_staccato_notes[si].fire_at       = fire;
        }
    }

    inst->perf_cycle_note_idx++;
    return 1;
}

/* Per master tick. Drives ARMED→CAPTURING boundary detection, capture window
 * advance, capture→loop transition, and event playback during LOOPING. */
static void looper_tick(seq8_instance_t *inst) {
    /* Drain deferred silence from looper_stop (render_block context → safe for ROUTE_MOVE). */
    if (inst->looper_pending_silence) {
        looper_silence_active(inst);
        inst->looper_pending_silence = 0;
    }
    uint16_t cap = inst->looper_capture_ticks;
    if (cap == 0) return;

    if (inst->looper_state == LOOPER_STATE_ARMED) {
        /* Wait for next master-tick boundary (sync=1) or start immediately (sync=0). */
        uint32_t total = inst->arp_master_tick;
        if (!inst->looper_sync || (total % cap) == 0) {
            inst->looper_state       = LOOPER_STATE_CAPTURING;
            inst->looper_pos         = 0;
            inst->looper_event_count = 0;
            inst->looper_play_idx    = 0;
            /* Reset perf state so mods applied during CAPTURING start fresh. */
            inst->perf_cycle_note_idx = 0;
            inst->perf_staccato_count = 0;
        }
        return;
    }

    if (inst->looper_state == LOOPER_STATE_CAPTURING) {
        /* Fire staccato/legato/phantom pending note-offs due at this position.
         * Mirrors the LOOPING-state drain so gate-override mods (Staccato, Legato,
         * Ramp Gate) and Phantom ghost notes work during the first capture cycle. */
        {
            int _si;
            for (_si = 0; _si < (int)inst->perf_staccato_count; ) {
                if (inst->perf_staccato_notes[_si].fire_at == (uint16_t)inst->looper_pos) {
                    uint8_t _tr = inst->perf_staccato_notes[_si].track;
                    uint8_t _ep = inst->perf_staccato_notes[_si].emitted_pitch;
                    uint8_t _rp = inst->perf_staccato_notes[_si].raw_pitch;
                    if (_tr < NUM_TRACKS) {
                        inst->looper_emitting = 1;
                        pfx_send(&inst->tracks[_tr].pfx,
                                 (uint8_t)(0x80 | inst->tracks[_tr].channel), _ep, 0);
                        inst->looper_emitting = 0;
                    }
                    if (_rp < 128) inst->perf_emitted_pitch[_tr][_rp] = 0xFF;
                    inst->perf_staccato_notes[_si] =
                        inst->perf_staccato_notes[--inst->perf_staccato_count];
                } else { _si++; }
            }
        }
        inst->looper_pos++;
        if (inst->looper_pos >= cap) {
            inst->looper_state    = LOOPER_STATE_LOOPING;
            inst->looper_pos      = 0;
            inst->looper_play_idx = 0;
            /* Silence any in-flight sequencer notes on looper_on tracks so the
             * LOOPING suppression doesn't orphan their note-offs. Set looper_emitting
             * to bypass our own suppression hook (state is now LOOPING). */
            {
                int _t;
                inst->looper_emitting = 1;
                for (_t = 0; _t < NUM_TRACKS; _t++) {
                    if (inst->tracks[_t].pfx.looper_on)
                        silence_track_notes_v2(inst, &inst->tracks[_t]);
                }
                inst->looper_emitting = 0;
            }
        }
        return;
    }

    if (inst->looper_state == LOOPER_STATE_LOOPING) {
        /* Cycle-start hook: runs once at looper_pos==0, before any events. */
        if (inst->looper_pos == 0) {
            uint32_t pmods = inst->perf_mods_active;
            uint16_t ec    = inst->looper_event_count;
            uint16_t i;

            inst->perf_cycle_note_idx = 0;

            /* Drift: random walk ±1 semitone per cycle, clamped ±6. */
            if (pmods & PERF_MOD_DRIFT) {
                uint32_t rng = inst->looper_cycle * 1664525u + 1013904223u;
                int delta = ((rng >> 16) & 1u) ? 1 : -1;
                int nd = (int)inst->perf_drift_offset + delta;
                inst->perf_drift_offset = (int8_t)(nd < -6 ? -6 : nd > 6 ? 6 : nd);
            }

            /* Shuffle / Backwards: build pitch permutation table indexed by event index.
             * Works on melodic and drum tracks alike (drum: swaps which hit plays when). */
            if (pmods & (PERF_MOD_SHUFFLE | PERF_MOD_BACKWARDS)) {
                uint8_t  pitches[LOOPER_MAX_EVENTS];
                uint16_t nc = 0;
                /* Collect note-on pitches in event order. */
                for (i = 0; i < ec; i++) {
                    uint8_t st = inst->looper_events[i].status;
                    if ((st & 0xF0) == 0x90 && inst->looper_events[i].d2 > 0)
                        pitches[nc++] = inst->looper_events[i].d1;
                }
                inst->perf_note_on_count = nc;
                if (pmods & PERF_MOD_BACKWARDS) {
                    /* Reverse: retrograde pitch order. */
                    uint16_t lo = 0, hi2 = nc > 0 ? nc - 1 : 0;
                    while (lo < hi2) {
                        uint8_t tmp = pitches[lo]; pitches[lo] = pitches[hi2]; pitches[hi2] = tmp;
                        lo++; hi2--;
                    }
                } else if (nc > 1) {
                    /* Fisher-Yates shuffle seeded by cycle counter.
                     * Guard nc > 1: with nc==0, `i = nc - 1` would underflow
                     * (uint16_t) to 65535 and write pitches[] out of bounds;
                     * nc<=1 is a no-op anyway. Mirrors the backwards branch's
                     * `nc > 0 ? nc - 1 : 0` guard above. */
                    uint32_t seed = inst->looper_cycle * 1664525u + 1013904223u;
                    uint16_t j;
                    for (i = nc - 1; i > 0; i--) {
                        seed = seed * 1664525u + 1013904223u;
                        j = (uint16_t)(seed >> 16) % (i + 1);
                        uint8_t tmp = pitches[i]; pitches[i] = pitches[j]; pitches[j] = tmp;
                    }
                }
                /* Write permuted pitches back, indexed by raw event index. */
                uint16_t ni = 0;
                for (i = 0; i < ec; i++) {
                    uint8_t st = inst->looper_events[i].status;
                    if ((st & 0xF0) == 0x90 && inst->looper_events[i].d2 > 0)
                        inst->perf_shuffle_pitches[i] = ni < nc ? pitches[ni++] : inst->looper_events[i].d1;
                    else
                        inst->perf_shuffle_pitches[i] = inst->looper_events[i].d1;
                }
            } else {
                /* Compute note-on count for Ramp Gate even without shuffle. */
                uint16_t nc = 0;
                for (i = 0; i < ec; i++) {
                    uint8_t st = inst->looper_events[i].status;
                    if ((st & 0xF0) == 0x90 && inst->looper_events[i].d2 > 0) nc++;
                }
                inst->perf_note_on_count = nc;
            }
        }

        /* Fire staccato/legato/phantom pending note-offs due at this position. */
        {
            int _si;
            for (_si = 0; _si < (int)inst->perf_staccato_count; ) {
                if (inst->perf_staccato_notes[_si].fire_at == (uint16_t)inst->looper_pos) {
                    uint8_t _tr = inst->perf_staccato_notes[_si].track;
                    uint8_t _ep = inst->perf_staccato_notes[_si].emitted_pitch;
                    uint8_t _rp = inst->perf_staccato_notes[_si].raw_pitch;
                    if (_tr < NUM_TRACKS) {
                        inst->looper_emitting = 1;
                        pfx_send(&inst->tracks[_tr].pfx,
                                 (uint8_t)(0x80 | inst->tracks[_tr].channel), _ep, 0);
                        inst->looper_emitting = 0;
                    }
                    /* raw_pitch==0xFF is the phantom sentinel — not in emitted table. */
                    if (_rp < 128) inst->perf_emitted_pitch[_tr][_rp] = 0xFF;
                    inst->perf_staccato_notes[_si] =
                        inst->perf_staccato_notes[--inst->perf_staccato_count];
                } else { _si++; }
            }
        }

        /* Emit captured events at this tick, applying perf modifiers. */
        while (inst->looper_play_idx < inst->looper_event_count &&
               inst->looper_events[inst->looper_play_idx].tick == (uint16_t)inst->looper_pos) {
            int ei = inst->looper_play_idx++;
            uint8_t tr_idx  = inst->looper_events[ei].track;
            if (tr_idx >= NUM_TRACKS) continue;
            play_fx_t *fx   = &inst->tracks[tr_idx].pfx;
            uint8_t st      = inst->looper_events[ei].status;
            uint8_t raw_d1  = inst->looper_events[ei].d1;
            uint8_t d1      = raw_d1;
            uint8_t d2      = inst->looper_events[ei].d2;
            inst->perf_current_event_idx = (uint16_t)ei;
            if (!perf_apply(inst, tr_idx, st, &d1, &d2)) continue;
            inst->looper_emitting = 1;
            pfx_send(fx, st, d1, d2);
            inst->looper_emitting = 0;
            uint8_t hi = st & 0xF0;
            if (hi == 0x90 && d2 > 0) {
                looper_mark_active(inst, tr_idx, raw_d1, d1);
                /* Phantom: ghost note at pitch-12, vel/4, gate=cap/8.
                 * raw_pitch=0xFF in queue is sentinel (not in emitted table). */
                if ((inst->perf_mods_active & PERF_MOD_PHANTOM) &&
                        inst->perf_staccato_count < 32) {
                    int gp = (int)d1 - 12;
                    if (gp >= 0) {
                        uint8_t gpb = (uint8_t)gp;
                        uint8_t gv  = d2 / 4 < 1 ? 1 : d2 / 4;
                        uint16_t gap = cap / 8 < 2 ? 2 : cap / 8;
                        uint16_t gfire = (uint16_t)((inst->looper_pos + gap) % cap);
                        inst->looper_emitting = 1;
                        pfx_send(fx, st, gpb, gv);
                        inst->looper_emitting = 0;
                        int si = (int)inst->perf_staccato_count++;
                        inst->perf_staccato_notes[si].raw_pitch     = 0xFF;
                        inst->perf_staccato_notes[si].emitted_pitch = gpb;
                        inst->perf_staccato_notes[si].track         = tr_idx;
                        inst->perf_staccato_notes[si].fire_at       = gfire;
                    }
                }
            } else if (hi == 0x80 || (hi == 0x90)) {
                looper_mark_active(inst, tr_idx, raw_d1, 0xFF);
            }
        }
        inst->looper_pos++;
        if (inst->looper_pos >= cap) {
            /* Loop boundary: process queued rate change or increment cycle counter. */
            if (inst->looper_pending_rate_ticks != 0 &&
                    inst->looper_pending_rate_ticks != inst->looper_capture_ticks) {
                looper_silence_active(inst);
                inst->looper_capture_ticks      = inst->looper_pending_rate_ticks;
                inst->looper_pending_rate_ticks = 0;
                /* Rate change from a known loop boundary — already aligned, skip ARMED wait
                 * so the gap between old loop end and new capture start doesn't let notes
                 * play through uncaptured. */
                inst->looper_state = LOOPER_STATE_CAPTURING;
                inst->looper_pos                = 0;
                inst->looper_event_count        = 0;
                inst->looper_play_idx           = 0;
                return;
            }
            inst->looper_pending_rate_ticks = 0;
            inst->looper_cycle++;
            inst->looper_pos      = 0;
            inst->looper_play_idx = 0;
        }
    }
}

/* Cleanup: silence active notes, clear state, return to IDLE. Safe to call
 * from any state. */
static void looper_stop(seq8_instance_t *inst) {
    /* Defer note-offs to next render_block tick so midi_inject_to_move works
     * (pfx_send from set_param context doesn't release Move synth voices).
     * Set unconditionally: a release during CAPTURING (first cycle, before
     * the loop boundary) still needs to flush any live-played notes the user
     * was holding when they let go of the loop pad. looper_silence_active is
     * idempotent (0xFF sentinel + harmless duplicate offs from the
     * looper_events sweep). */
    inst->looper_pending_silence = 1;
    /* perf_emitted_pitch left intact; looper_silence_active clears it when it fires. */
    inst->looper_state              = LOOPER_STATE_IDLE;
    inst->looper_pos                = 0;
    inst->looper_play_idx           = 0;
    inst->looper_event_count        = 0;
    inst->looper_capture_ticks      = 0;
    inst->looper_pending_rate_ticks = 0;
    inst->looper_cycle              = 0;
    inst->perf_staccato_count       = 0;
    inst->perf_drift_offset         = 0;
    inst->perf_cycle_note_idx       = 0;
}
