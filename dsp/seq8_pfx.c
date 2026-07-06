/* seq8_pfx.c — pfx-chain note generation + scheduling (direct port from
 * NoteTwist) + playback-direction helpers.
 * Contents: conductor_transpose_gen, pfx_apply_notefx, pfx_build_harmz_copies,
 * pfx_build_gen_notes, pfx_sched_delay_ons/offs (NOTE FX / HARMZ / MIDI-DLY),
 * advance_clip_step, initial_clip_step, initial_pp_dir, clip_in_reverse_motion.
 * #include'd into seq8.c's single TU at the original position; never compiled
 * standalone. LEFT IN CORE (not contiguous with this block): pfx_send/pfx_emit,
 * the pfx event queue (pfx_spc/gate_smp/ticks_to_smp/q_insert/swing_offset/
 * q_fire), pfx_reset, pfx_note_on/off/off_imm — all interleaved with the
 * looper / conductor-offset / arp / must-stay playback-geometry functions. */
/* Transpose gen[] in place by the conductor offset for responder track t.
 * No-op if t isn't a responding melodic track or the conductor isn't sounding.
 * Mirrors the inline transpose currently in pfx_note_on. */
static void conductor_transpose_gen(seq8_instance_t *inst, int t,
                                    uint8_t *gen, int gc) {
    if (inst->conductor_track < 0 || !inst->conductor_sounding) return;
    if (t == inst->conductor_track) return;
    if (inst->tracks[t].pad_mode != PAD_MODE_MELODIC_SCALE) return;
    seq8_track_t *cnd = &inst->tracks[inst->conductor_track];
    clip_t *cc = &cnd->clips[cnd->active_clip];
    if (!cc->cond_resp[t]) return;
    int oct = cc->cond_oct[t];
    int i;
    for (i = 0; i < gc; i++) {
        if (inst->scale_aware) {
            int n = (int)SCALE_SIZES[eff_pad_scale(inst)];
            gen[i] = (uint8_t)scale_transpose(inst, gen[i],
                          inst->conductor_off_deg + oct * n);
        } else {
            gen[i] = (uint8_t)clamp_i((int)gen[i] +
                          inst->conductor_off_semi + oct * 12, 0, 127);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Generated-note list (direct port from NoteTwist)                    */
/* ------------------------------------------------------------------ */

/* Pure NOTE FX pitch transform: octave_shift + note_offset, with scale awareness.
 * Returns the post-NOTE-FX primary pitch (clamped 0..127). */
static int pfx_apply_notefx(seq8_instance_t *inst, int scale_aware,
                             play_fx_t *fx, int orig_note) {
    int base = orig_note + fx->octave_shift * 12;
    int n = scale_aware ? scale_transpose(inst, clamp_i(base, 0, 127), fx->note_offset)
                        : clamp_i(base + fx->note_offset, 0, 127);
    if (fx->note_random > 0) {
        int rng = fx->note_random;
        int lim = rng;
        if (scale_aware) {
            int sc = (int)SCALE_SIZES[eff_pad_scale(inst)];
            if (lim > sc) lim = sc;
        }
        switch (fx->note_random_mode) {
        default:
        case 0: /* Uniform */
            if (scale_aware) n = scale_transpose(inst, n, pfx_rand(fx, -lim, lim));
            else             n = clamp_i(n + pfx_rand(fx, -rng, rng), 0, 127);
            break;
        case 1: /* Gaussian — average of 3 uniform draws, stays in range */
            {
                int s = pfx_rand(fx, -lim, lim) + pfx_rand(fx, -lim, lim) + pfx_rand(fx, -lim, lim);
                int g = (s < 0 ? s - 1 : s + 1) / 3;
                if (scale_aware) n = scale_transpose(inst, n, g);
                else             n = clamp_i(n + g, 0, 127);
            }
            break;
        case 2: /* Walk — bounded random walk ±2 per step, clamped to ±lim */
            {
                int step = pfx_rand(fx, -2, 2);
                fx->note_random_walk = clamp_i(fx->note_random_walk + step, -lim, lim);
                if (scale_aware) n = scale_transpose(inst, n, fx->note_random_walk);
                else             n = clamp_i(n + fx->note_random_walk, 0, 127);
            }
            break;
        }
    }
    return n;
}

/* Build harmonize copies (octaver + h1 + h2) of a primary note already past NOTE FX.
 * out[0] = primary; subsequent slots are octaver/h1/h2 if set. Returns count. */
static int pfx_build_harmz_copies(seq8_instance_t *inst, int scale_aware,
                                   play_fx_t *fx, int primary, uint8_t *out) {
    int cnt = 0;
    out[cnt++] = (uint8_t)primary;

    if (fx->octaver != 0) {
        int o = primary + fx->octaver * 12;
        if (o >= 0 && o <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)o;
    }
    if (fx->harmonize_1 != 0) {
        int h = scale_aware ? scale_transpose(inst, primary, fx->harmonize_1)
                            : primary + fx->harmonize_1;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    if (fx->harmonize_2 != 0) {
        int h = scale_aware ? scale_transpose(inst, primary, fx->harmonize_2)
                            : primary + fx->harmonize_2;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    if (fx->harmonize_3 != 0) {
        int h = scale_aware ? scale_transpose(inst, primary, fx->harmonize_3)
                            : primary + fx->harmonize_3;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    return cnt;
}

static int pfx_build_gen_notes(seq8_instance_t *inst, int scale_aware,
                               play_fx_t *fx, int orig_note, uint8_t *out) {
    int primary = pfx_apply_notefx(inst, scale_aware, fx, orig_note);
    return pfx_build_harmz_copies(inst, scale_aware, fx, primary, out);
}

/* ------------------------------------------------------------------ */
/* Delay repeat scheduling (direct port from NoteTwist)                */
/* ------------------------------------------------------------------ */

static void pfx_sched_delay_ons(seq8_instance_t *inst, int scale_aware,
                                play_fx_t *fx, pfx_active_t *an,
                                uint64_t base_time, double sp) {
    if (fx->repeat_times == 0 || fx->delay_level == 0) return;
    int dclk = CLOCK_VALUES[fx->delay_time_idx];
    if (dclk == 0) return;

    an->spc = sp;
    int reps = clamp_i(fx->repeat_times, 0, MAX_REPEATS);
    an->stored_repeat_count = reps;

    double cumul     = 0.0;
    double cur_delay = (double)dclk * sp;
    int    cumul_pitch = 0;
    int    cumul_deg   = 0;
    int    rep_vel   = (int)an->orig_velocity * fx->delay_level / 127;
    int    fb_walk   = 0;

    int i;
    for (i = 0; i < reps; i++) {
        cumul += cur_delay;
        if ((uint64_t)(cumul + 0.5) > MAX_DELAY_SAMPLES) {
            an->stored_repeat_count = i;
            break;
        }

        {
            if (fx->fb_note_random > 0) {
                int rng = fx->fb_note_random;
                int lim = rng;
                if (scale_aware) {
                    int sc = (int)SCALE_SIZES[eff_pad_scale(inst)];
                    if (lim > sc) lim = sc;
                }
                switch (fx->fb_note_random_mode) {
                default:
                case 0: /* Uniform */
                    if (scale_aware) cumul_deg   = pfx_rand(fx, -lim, lim);
                    else             cumul_pitch = pfx_rand(fx, -rng, rng);
                    break;
                case 1: /* Gaussian — average of 3 uniform draws */
                    {
                        int s = pfx_rand(fx, -lim, lim) + pfx_rand(fx, -lim, lim) + pfx_rand(fx, -lim, lim);
                        int g = (s < 0 ? s - 1 : s + 1) / 3;
                        if (scale_aware) cumul_deg   = g;
                        else             cumul_pitch = g;
                    }
                    break;
                case 2: /* Walk — drift ±2 per repeat, clamped to ±lim */
                    fb_walk = clamp_i(fb_walk + pfx_rand(fx, -2, 2), -lim, lim);
                    if (scale_aware) cumul_deg   = fb_walk;
                    else             cumul_pitch = fb_walk;
                    break;
                }
            } else {
                if (scale_aware) cumul_deg   += fx->fb_note;
                else             cumul_pitch += fx->fb_note;
            }
        }
        {
            int pitch = (scale_aware && an->gen_count > 0)
                ? scale_transpose(inst, (int)an->gen_notes[0], cumul_deg) - (int)an->gen_notes[0]
                : cumul_pitch;
            an->reps[i].pitch_offset = (int8_t)clamp_i(pitch, -127, 127);
        }

        if (i > 0) rep_vel += fx->fb_velocity;
        rep_vel = clamp_i(rep_vel, 1, 127);
        an->reps[i].velocity = (uint8_t)rep_vel;

        if (fx->fb_gate_time > 0)
            an->reps[i].gate_factor = -(double)GATE_FIXED_TICKS[fx->fb_gate_time - 1] * (double)TICKS_TO_480PPQN * sp;
        else
            an->reps[i].gate_factor = 1.0;

        an->reps[i].cumul_delay = (uint64_t)(cumul + 0.5);

        uint64_t ft   = base_time + an->reps[i].cumul_delay;
        ft += swing_offset_for_fire_at(g_inst, fx->sample_counter, ft);

        uint8_t  on_s = (uint8_t)(0x90 | an->channel);
        int j;
        for (j = 0; j < an->gen_count; j++) {
            int note = (int)an->gen_notes[j] + an->reps[i].pitch_offset;
            note = clamp_i(note, 0, 127);
            pfx_q_insert(fx, ft, on_s, (uint8_t)note, an->reps[i].velocity, 0);
        }

        cur_delay *= (1.0 + fx->fb_clock / 100.0);
        if (cur_delay < 1.0) cur_delay = 1.0;
    }
}

/* Schedule note-offs for all delay repeats. Called when original note-off
 * arrives. base_time is the note-on time. */
static void pfx_sched_delay_offs(play_fx_t *fx, pfx_active_t *an,
                                 uint64_t base_time, uint64_t gate_smp) {
    uint8_t off_s = (uint8_t)(0x80 | an->channel);
    int i;
    for (i = 0; i < an->stored_repeat_count; i++) {
        double rg = an->reps[i].gate_factor >= 0.0
            ? (double)gate_smp * an->reps[i].gate_factor
            : -an->reps[i].gate_factor;
        if (rg < 1.0) rg = 1.0;
        uint64_t off = base_time + an->reps[i].cumul_delay + (uint64_t)(rg + 0.5);
        off += swing_offset_for_fire_at(g_inst, fx->sample_counter, off);
        int j;
        for (j = 0; j < an->gen_count; j++) {
            int note = (int)an->gen_notes[j] + an->reps[i].pitch_offset;
            note = clamp_i(note, 0, 127);
            pfx_q_insert(fx, off, off_s, (uint8_t)note, 0, 0);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Clip playback direction                                              */
/* ------------------------------------------------------------------ */
/* Per-clip / per-lane playback_dir modes:
 *   0 = Forward                 — playhead ls → le-1 → ls → ...
 *   1 = Backward                — playhead le-1 → ls → le-1 → ...
 *   2 = Pingpong Forward        — ls → le-1, reverses (endpoint plays ONCE),
 *                                 ls+1 → ls, reverses, back up. Full cycle =
 *                                 2L-2 steps; every step gets equal time so
 *                                 a steady rhythm pattern stays steady.
 *   3 = Pingpong Backward       — mirror of 2 starting at le-1.
 *
 * pp_dir_state is +1 ascending, -1 descending; only meaningful in modes 2/3.
 * Reset on clip launch / transport start; not persisted.
 *
 * "Wrap" (out_wrapped=1) means the playhead has just completed one full cycle
 * and is back at its initial position — used to clear suppress_until_wrap
 * flags, reset live_recorded_steps, and increment loop_cycle for Iter trigs. */
static void advance_clip_step(uint16_t cur, uint16_t ls, uint16_t length,
                              uint8_t mode, uint8_t audio_reverse, int8_t pp_dir,
                              uint16_t *out_ns, int8_t *out_pp_dir,
                              uint8_t *out_wrapped) {
    uint16_t le = (uint16_t)(ls + length);
    *out_wrapped = 0;
    if (length <= 1) { *out_ns = ls; *out_pp_dir = pp_dir; *out_wrapped = 1; return; }

    int32_t next;
    switch (mode) {
    case 1: /* Backward */
        next = (int32_t)cur - 1;
        if (next < ls || next >= le) { next = le - 1; *out_wrapped = 1; }
        break;
    case 2: /* Pingpong Forward.
             *   Step:  endpoint plays ONCE per direction change (cycle = 2L-2).
             *   Audio: endpoint plays TWICE — repeats at the bounce (cycle = 2L)
             *          so each note gets one forward + one reverse playthrough. */
        if (pp_dir != +1 && pp_dir != -1) pp_dir = +1;
        next = (int32_t)cur + pp_dir;
        if (audio_reverse) {
            if (next >= le)      { next = le - 1; pp_dir = -1; }   /* endpoint repeats at top */
            else if (next < ls)  { next = ls;     pp_dir = +1; }   /* endpoint repeats at bottom */
            /* Wrap: landed at ls heading up (we've completed the full 2L cycle). */
            if ((uint16_t)next == ls && pp_dir == +1) *out_wrapped = 1;
        } else {
            if (next >= le)      { next = le - 2; pp_dir = -1; }   /* skip repeat at top */
            else if (next < ls)  { next = ls + 1; pp_dir = +1; }   /* skip repeat at bottom */
            if ((uint16_t)next == ls && pp_dir == -1) *out_wrapped = 1;
        }
        break;
    case 3: /* Pingpong Backward — mirror of case 2. */
        if (pp_dir != +1 && pp_dir != -1) pp_dir = -1;
        next = (int32_t)cur + pp_dir;
        if (audio_reverse) {
            if (next >= le)      { next = le - 1; pp_dir = -1; }
            else if (next < ls)  { next = ls;     pp_dir = +1; }
            /* Wrap: landed at le-1 heading down (full 2L cycle complete). */
            if ((uint16_t)next == (uint16_t)(le - 1) && pp_dir == -1) *out_wrapped = 1;
        } else {
            if (next >= le)      { next = le - 2; pp_dir = -1; }
            else if (next < ls)  { next = ls + 1; pp_dir = +1; }
            if ((uint16_t)next == (uint16_t)(le - 1) && pp_dir == +1) *out_wrapped = 1;
        }
        break;
    case 0:
    default: /* Forward */
        next = (int32_t)cur + 1;
        if (next >= le || next < ls) { next = ls; *out_wrapped = 1; }
        break;
    }
    *out_pp_dir = pp_dir;
    *out_ns = (uint16_t)next;
}

/* Initial playhead step for `dir` when launching a clip / starting transport.
 * Forward / PPFwd start at loop_start; Backward / PPBwd start at last step. */
static uint16_t initial_clip_step(uint16_t ls, uint16_t length, uint8_t dir) {
    if (length == 0) return ls;
    return (dir == 1 || dir == 3) ? (uint16_t)(ls + length - 1) : ls;
}

/* Initial pp_dir_state for `dir`. -1 for PPBwd; +1 for everything else. */
static int8_t initial_pp_dir(uint8_t dir) {
    return (dir == 3) ? (int8_t)-1 : (int8_t)+1;
}

/* True when the playhead is currently traversing the clip in reverse motion:
 *   - Backward direction: always.
 *   - Pingpong (either start): only while pp_dir_state == -1 (descending half).
 * Used by note firing to swap note-on / note-off positions when the clip's
 * playback_audio_reverse flag is set. */
static inline int clip_in_reverse_motion(const clip_t *cl) {
    if (cl->playback_dir == 1) return 1;
    if ((cl->playback_dir == 2 || cl->playback_dir == 3) && cl->pp_dir_state == -1) return 1;
    return 0;
}
