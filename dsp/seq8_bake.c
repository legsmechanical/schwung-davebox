/* seq8_bake.c — Print/Bake: offline pfx-chain apply (NOTEFX+HARMZ, MIDI_DLY,
 * ARP_OUT stages), conductor bake offset, melodic/drum-lane/drum-clip bakes.
 * #include'd verbatim into seq8.c's single translation unit at the original
 * block position. Not compiled standalone — relies on seq8.c's prior context. */
/* ------------------------------------------------------------------ */
/* Print/Bake: offline apply pfx chain (NOTEFX+HARMZ → MIDI_DLY →    */
/* ARP_OUT) to a clip's notes and clear the pfx params.               */
/* Stage order is defined by BAKE_STAGES[]; swap the two entries to   */
/* reorder MIDI_DLY and ARP_OUT when chain-position switching arrives. */
/* ------------------------------------------------------------------ */

#define BAKE_STAGE_MIDI_DLY  0
#define BAKE_STAGE_ARP_OUT   1
static const int BAKE_STAGES[2] = { BAKE_STAGE_MIDI_DLY, BAKE_STAGE_ARP_OUT };

typedef struct {
    uint32_t tick; uint16_t gate; uint8_t pitch; uint8_t vel;
} bake_note_t;

#define BAKE_BUF  MAX_NOTES_PER_CLIP

static int bake_stage_midi_dly(seq8_instance_t *inst, int scale_aware,
                                play_fx_t *fx, uint32_t clip_ticks,
                                uint32_t max_echo_tick,
                                const bake_note_t *in, int in_count,
                                bake_note_t *out, int out_max) {
    int oc = 0, ni;
    for (ni = 0; ni < in_count && oc < out_max; ni++)
        out[oc++] = in[ni];
    if (fx->repeat_times <= 0 || fx->delay_level <= 0)
        return oc;
    int dclk_master = CLOCK_VALUES[fx->delay_time_idx] / 5; /* 480→96 PPQN */
    if (dclk_master <= 0) return oc;
    for (ni = 0; ni < in_count && oc < out_max; ni++) {
        int rep_vel     = (int)in[ni].vel * fx->delay_level / 127;
        int cumul_pitch = 0, cumul_deg = 0, fb_walk = 0;
        double cur_delay = (double)dclk_master, cumul = 0.0;
        int rep;
        /* delay_retrig (default ON): a new note-on drops in-flight echoes live,
         * so truncate this note's echo train at the next note onset. The next
         * onset wraps to the first note + clip_ticks, matching the steady-state
         * loop. (delay_retrig=0 = legacy overlapping tails, no truncation.) */
        uint32_t echo_limit = max_echo_tick;
        if (fx->delay_retrig) {
            uint32_t src = in[ni].tick, nextOn = UINT32_MAX, firstOn = UINT32_MAX;
            int j;
            for (j = 0; j < in_count; j++) {
                uint32_t tj = in[j].tick;
                if (tj < firstOn) firstOn = tj;
                if (tj > src && tj < nextOn) nextOn = tj;
            }
            if (nextOn == UINT32_MAX && firstOn != UINT32_MAX) nextOn = firstOn + clip_ticks;
            if (nextOn < echo_limit) echo_limit = nextOn;
        }
        for (rep = 0; rep < fx->repeat_times && oc < out_max; rep++) {
            cumul += cur_delay;
            uint32_t echo_tick = in[ni].tick + (uint32_t)(cumul + 0.5);
            if (echo_tick >= echo_limit) break;
            if (fx->fb_note_random > 0) {
                int rng = fx->fb_note_random;
                int lim = rng;
                if (scale_aware) {
                    int sc = (int)SCALE_SIZES[inst->pad_scale < 14 ? inst->pad_scale : 0];
                    if (lim > sc) lim = sc;
                }
                switch (fx->fb_note_random_mode) {
                default:
                case 0: /* Uniform */
                    if (scale_aware) cumul_deg   = pfx_rand(fx, -lim, lim);
                    else             cumul_pitch = pfx_rand(fx, -rng, rng);
                    break;
                case 1: /* Gaussian */
                    {
                        int s = pfx_rand(fx, -lim, lim) + pfx_rand(fx, -lim, lim) + pfx_rand(fx, -lim, lim);
                        int g = (s < 0 ? s - 1 : s + 1) / 3;
                        if (scale_aware) cumul_deg   = g;
                        else             cumul_pitch = g;
                    }
                    break;
                case 2: /* Walk */
                    fb_walk = clamp_i(fb_walk + pfx_rand(fx, -2, 2), -lim, lim);
                    if (scale_aware) cumul_deg   = fb_walk;
                    else             cumul_pitch = fb_walk;
                    break;
                }
            } else {
                if (scale_aware) cumul_deg   += fx->fb_note;
                else             cumul_pitch += fx->fb_note;
            }
            int echo_pitch = scale_aware
                ? scale_transpose(inst, (int)in[ni].pitch, cumul_deg)
                : clamp_i((int)in[ni].pitch + cumul_pitch, 0, 127);
            if (rep > 0) rep_vel += fx->fb_velocity;
            rep_vel = clamp_i(rep_vel, 1, 127);
            /* Echo gate: fb_gate_time>0 → fixed gate; else the live default echo
             * gate (pfx_gate_smp = GATE_TICKS * gate_time%), NOT the source note's
             * gate. Live delay-offs use gate_smp, so source-gate echoes baked far
             * too long — sustained instead of the staccato you hear (only exposed
             * once same-pitch legalization can't mask it, e.g. random-pitch delay). */
            uint32_t eg = fx->fb_gate_time > 0
                ? (uint32_t)GATE_FIXED_TICKS[fx->fb_gate_time - 1]
                : (uint32_t)((GATE_TICKS * (fx->gate_time > 0 ? fx->gate_time : 100)) / 100);
            if (eg < 1) eg = 1; if (eg > 65535u) eg = 65535u;
            out[oc++] = (bake_note_t){ echo_tick, (uint16_t)eg,
                                       (uint8_t)echo_pitch, (uint8_t)rep_vel };
            cur_delay *= (1.0 + fx->fb_clock / 100.0);
            if (cur_delay < 1.0) cur_delay = 1.0;
        }
    }
    return oc;
}

static int bake_stage_arp_out(seq8_instance_t *inst, play_fx_t *fx, uint32_t clip_ticks,
                               const bake_note_t *in, int in_count,
                               bake_note_t *out, int out_max) {
    int n, i;
    if (fx->arp.style == 0) {
        n = in_count < out_max ? in_count : out_max;
        for (i = 0; i < n; i++) out[i] = in[i];
        return n;
    }
    /* Tick-by-tick ARP simulation. Retrigger always ON for bake. */
    arp_engine_t a;
    memset(&a, 0, sizeof(a));
    a.style      = fx->arp.style;
    a.rate_idx   = fx->arp.rate_idx;
    a.octaves    = fx->arp.octaves;
    a.gate_pct   = fx->arp.gate_pct;
    a.steps_mode = fx->arp.steps_mode;
    a.retrigger  = 1;
    memcpy(a.step_vel, fx->arp.step_vel, sizeof(a.step_vel));
    memcpy(a.step_int, fx->arp.step_int, sizeof(a.step_int));   /* Arp Steps interval offsets */
    a.step_loop_len = fx->arp.step_loop_len ? fx->arp.step_loop_len : 8;
    if (a.step_loop_len > 8) a.step_loop_len = 8;

    uint16_t rate = ARP_RATE_TICKS[a.rate_idx];
    if (rate == 0) rate = 24;

    int oc = 0;
    uint32_t master_tick = 0, tick;
    for (tick = 0; tick < clip_ticks; tick++, master_tick++) {
        /* Note-ons */
        int ni;
        for (ni = 0; ni < in_count; ni++) {
            if (in[ni].tick != tick) continue;
            int was_empty = (a.held_count == 0);
            arp_add_note(&a, in[ni].pitch, in[ni].vel);
            if (was_empty || a.retrigger)
                arp_retrigger(&a, master_tick);
        }
        /* Note-offs */
        for (ni = 0; ni < in_count; ni++) {
            if ((uint32_t)(in[ni].tick + in[ni].gate) == tick)
                arp_remove_note(&a, in[ni].pitch);
        }
        if (a.held_count == 0) continue;

        if (a.pending_first_note) {
            uint32_t total = master_tick - a.master_anchor;
            if ((total % rate) != 0) continue;
            a.pending_first_note = 0;
            /* fall through to fire */
        } else {
            a.ticks_until_next--;
            if (a.ticks_until_next > 0) continue;
        }

        /* Compute step_pos from master position */
        uint32_t mp = master_tick - a.master_anchor;
        a.step_pos  = (uint8_t)((mp / rate) % a.step_loop_len);
        uint8_t slevel = a.step_vel[a.step_pos];
        if (a.steps_mode == 0) slevel = 255;   /* Off mode: treat as Thru */
        int step_off   = (a.steps_mode != 0) && (slevel == 0);

        if (step_off && a.steps_mode == 2) {
            a.ticks_until_next = (int32_t)rate;
            continue;
        }
        uint8_t pitch, vel;
        if (!step_off && arp_compute_step(&a, fx, &pitch, &vel)) {
            /* ABSOLUTE step velocity, Thru (255) = incoming — mirrors arp_fire_step. */
            int v = (int)vel;
            if (a.steps_mode != 0 && slevel >= 1 && slevel <= 127)
                v = (int)slevel;
            if (v < 1) v = 1; if (v > 127) v = 127;
            /* Arp Steps per-step interval offset (scale-degree), as in arp_fire_step. */
            if (a.step_int[a.step_pos])
                pitch = (uint8_t)scale_transpose(inst, (int)pitch, (int)a.step_int[a.step_pos]);
            uint32_t gate = ((uint32_t)rate * a.gate_pct) / 100u;
            if (gate < 1) gate = 1;
            if (gate >= rate) gate = rate - 1;
            if (oc < out_max)
                out[oc++] = (bake_note_t){ tick, (uint16_t)gate, pitch, (uint8_t)v };
        } else if (step_off) {
            /* Mute mode: advance cycle */
            uint8_t dp, dv;
            arp_compute_step(&a, fx, &dp, &dv);
        }
        a.cycle_step_count++;
        a.ticks_until_next = (int32_t)rate;
    }
    return oc;
}

/* Apply NOTE FX quantize to a raw clip tick, mirroring the effective_note_tick playback formula. */
static uint32_t bake_apply_quantize(uint32_t tick, uint16_t tps, uint16_t length, int quantize) {
    if (quantize <= 0) return tick;
    uint32_t clip_ticks = (uint32_t)length * tps;
    uint32_t sn = (tick + (uint32_t)(tps / 2)) / (uint32_t)tps % (uint32_t)length;
    int32_t step_grid = (int32_t)(sn * (uint32_t)tps);
    int32_t delta = (int32_t)tick - step_grid;
    if (delta > (int32_t)clip_ticks / 2) delta -= (int32_t)clip_ticks;
    else if (delta < -((int32_t)clip_ticks / 2)) delta += (int32_t)clip_ticks;
    if (delta == 0) return tick;
    int32_t eff_delta = (quantize >= 100) ? 0 : delta * (100 - quantize) / 100;
    int32_t eff = step_grid + eff_delta;
    if (eff < 0) eff += (int32_t)clip_ticks;
    if (eff >= (int32_t)clip_ticks) eff -= (int32_t)clip_ticks;
    return (uint32_t)eff;
}

/* Scratch file for the Ableton-export note transfer. The host get_param buffer
 * is 16KB, too small for big clips (drum LCM merges, multi-cycle bakes); the
 * render writes notes here and get_param returns only the small header, JS reads
 * this file (host_read_file handles up to 4MB; a single clip is well under). */
#define EXPORT_RENDER_PATH "/data/UserData/schwung/davebox-exports/staging/render.txt"

/* Non-destructive melodic clip render for Ableton export. MIRROR of the
 * bake_clip compute (lines ~6160-6250) — KEEP IN SYNC if the bake math changes.
 * Runs the same pfx pipeline (NOTE FX / HARMZ / SEQ ARP / MIDI DLY) and writes
 * the resulting "what you hear" notes into `out` (caller buffer, out_cap
 * entries), returning the count. Does NOT mutate the clip / undo / state.
 * `out_total_ticks` (nullable) receives the rendered span (new_length * tps). */
/* `loops` = number of cycles (each clip-length L); `wrap_from` = first cycle
 * index that wraps (Phase 4b loop-brace layout). Cycles [0,wrap_from) are "open"
 * (clean first pass — delay tails cut at L); cycles [wrap_from,loops) are
 * "wrapped" (steady-state — echoes folded modulo L). The RNG persists across
 * cycles (so randomized clips give a DISTINCT pass per cycle) while the per-pass
 * walk resets. *out_total_ticks = loops*L (content extent), *out_cycle_ticks = L
 * (one cycle — the default loop brace). */
static uint32_t u32_gcd(uint32_t a, uint32_t b); /* fwd decl; defined below */
static int conductor_bake_offset(seq8_instance_t *inst, clip_t *cc,
                                 play_fx_t *cond_fx, uint32_t abs_tick,
                                 uint32_t *cond_rng, int *deg, int *semi); /* fwd decl */

static int render_melodic_clip(seq8_instance_t *inst, int t, int c, int loops,
                               int wrap_from, bake_note_t *out, int out_cap,
                               uint32_t *out_total_ticks, uint32_t *out_cycle_ticks,
                               int apply_conductor) {
    seq8_track_t *tr = &inst->tracks[t];
    clip_t *cl;
    int ni, si, ri;
    if (out_total_ticks) *out_total_ticks = 0;
    if (out_cycle_ticks) *out_cycle_ticks = 0;
    if (tr->pad_mode == PAD_MODE_DRUM) return 0;
    cl = &tr->clips[c];
    if (cl->note_count == 0) return 0;
    if (loops < 1) loops = 1;
    if (loops > 8) loops = 8;

    play_fx_t fx;
    pfx_init_defaults(&fx);
    pfx_apply_params(&fx, &cl->pfx_params);
    fx.track_idx = (uint8_t)t;
    fx.route     = ROUTE_SCHWUNG;
    fx.rng       = 0xDEADBEEFu;

    int scale_aware = (int)inst->scale_aware;
    uint16_t tps    = cl->ticks_per_step ? cl->ticks_per_step : (uint16_t)TICKS_PER_STEP;
    uint16_t length = cl->length;
    uint32_t clip_ticks     = (uint32_t)length * tps;
    uint32_t win_start_tick = (uint32_t)cl->loop_start * tps;

    /* Direction- and style-aware cycle for export. */
    uint8_t pdir = cl->playback_dir;
    uint8_t paud = cl->playback_audio_reverse;
    uint16_t cycle_steps = playback_cycle_steps(pdir, paud, length);
    uint32_t cycle_ticks = (uint32_t)cycle_steps * tps;
    if (out_cycle_ticks) *out_cycle_ticks = cycle_ticks;
    if (cycle_ticks == 0) return 0;

    /* Apply-Conductor on export (non-destructive): fold the Conductor's
     * transposition into this responder clip against the Conductor's clip at
     * the SAME scene index. Mirrors bake_clip's SCENE-bake conductor path, but
     * writes only the scratch out[] buffer (the session clip is never touched).
     * Gated on: requested, a Conductor exists, this isn't the Conductor track,
     * this track responds in the Conductor's clip C, and that conductor clip is
     * non-empty. cond_fx built once (NOTE FX random re-rolls per occurrence). */
    int do_cond = 0;
    clip_t *cond_cl = NULL;
    play_fx_t cond_fx;
    uint32_t cond_rng = 0xC04D1234u;
    if (apply_conductor && inst->conductor_track >= 0 &&
        t != inst->conductor_track) {
        cond_cl = &inst->tracks[inst->conductor_track].clips[c];
        if (cond_cl->note_count > 0 && cond_cl->cond_resp[t]) {
            pfx_init_defaults(&cond_fx);
            pfx_apply_params(&cond_fx, &cond_cl->pfx_params);
            cond_fx.track_idx = (uint8_t)inst->conductor_track;
            cond_fx.route     = ROUTE_SCHWUNG;
            cond_fx.rng       = 0xC04DBEEFu;
            do_cond = 1;
        }
    }

    /* Polymeter LCM extension (matches bake_clip): a short responder under a
     * longer conductor must be extended to LCM(respWin, condWin) so every
     * conductor page is captured. Only when do_cond; otherwise loops unchanged. */
    int effectiveLoops = loops;
    if (do_cond && cond_cl) {
        uint32_t respWinTicks = cycle_ticks;
        uint16_t cond_tps = cond_cl->ticks_per_step ? cond_cl->ticks_per_step
                                                     : (uint16_t)TICKS_PER_STEP;
        uint32_t condWinTicks = (uint32_t)cond_cl->length * cond_tps;
        if (respWinTicks > 0 && condWinTicks > respWinTicks) {
            uint32_t g = u32_gcd(respWinTicks, condWinTicks);
            uint32_t repeats = g ? (condWinTicks / g) : 1; /* lcm/respWin */
            if (repeats < 1) repeats = 1;
            effectiveLoops = loops * (int)repeats;
        }
    }
    if (out_total_ticks) *out_total_ticks = cycle_ticks * (uint32_t)effectiveLoops;

    static bake_note_t rmc_a[BAKE_BUF];
    static bake_note_t rmc_b[BAKE_BUF];
    int total_out = 0;

    int loop;
    for (loop = 0; loop < effectiveLoops; loop++) {
        int wrapped = (loop >= wrap_from);
        uint32_t loop_offset = (uint32_t)loop * cycle_ticks;
        int a_count = 0;
        fx.note_random_walk = 0;   /* fresh walk; fx.rng persists → distinct pass per cycle */
        for (ni = 0; ni < cl->note_count && a_count < BAKE_BUF; ni++) {
            note_t *nn = &cl->notes[ni];
            if (nn->suppress_until_wrap) continue;
            if (nn->tick < win_start_tick || nn->tick >= win_start_tick + clip_ticks)
                continue;
            /* v=34 trig conditions: iter gates by bake cycle index, random rolls per-note */
            uint16_t _sidx = note_step(nn->tick, length, tps);
            if (!step_trig_pass(cl, _sidx, (uint32_t)loop, &fx.rng)) continue;
            uint32_t rel_tick = nn->tick - win_start_tick;
            uint32_t gate = compute_effective_gate_ticks(
                tps, nn->gate, cl->pfx_params.note_length_mode, fx.gate_time);
            int vel = (int)nn->vel + fx.velocity_offset;
            if (vel < 1) vel = 1; if (vel > 127) vel = 127;
            uint8_t gen[MAX_GEN_NOTES];
            int gc = pfx_build_gen_notes(inst, scale_aware, &fx, (int)nn->pitch, gen);

            /* Apply Conductor (export, Next-style): each rendered responder note
             * takes the conductor offset at its OWN onset (abs tick across the
             * effective loops). Mirrors bake_clip's SCENE-bake fold. Scratch
             * buffer only — never mutates the session clip. */
            if (do_cond) {
                int cdeg = 0, csemi = 0;
                uint32_t resp_abs = loop_offset + rel_tick;
                if (conductor_bake_offset(inst, cond_cl, &cond_fx, resp_abs,
                                          &cond_rng, &cdeg, &csemi)) {
                    int coct = cond_cl->cond_oct[t];
                    int gj;
                    for (gj = 0; gj < gc; gj++) {
                        if (inst->scale_aware) {
                            int sn = (int)SCALE_SIZES[eff_pad_scale(inst)];
                            gen[gj] = (uint8_t)scale_transpose(inst, gen[gj],
                                          cdeg + coct * sn);
                        } else {
                            gen[gj] = (uint8_t)clamp_i((int)gen[gj] +
                                          csemi + coct * 12, 0, 127);
                        }
                    }
                }
            }

            uint32_t emit_ticks[2];
            int emit_count = compute_bake_emit_positions(pdir, paud, length, tps,
                                                          rel_tick, gate, emit_ticks);

            /* v=34 Ratchet bake: r evenly-spaced sub-hits at TPS/r within one
             * step; sub-hit gate = sub-interval. ratchet<2 => single emit. */
            uint8_t  _ratch = cl->step_ratchet[_sidx];
            if (_ratch < 2) _ratch = 1;
            uint16_t _sub_interval = (_ratch > 1) ? (uint16_t)(tps / _ratch) : 0;
            uint16_t _final_gate   = (_ratch > 1) ? (_sub_interval ? _sub_interval : 1)
                                                  : (uint16_t)gate;
            int ei, _k, gi;
            for (ei = 0; ei < emit_count && a_count < BAKE_BUF; ei++) {
                uint32_t eff_tick = bake_apply_quantize(emit_ticks[ei], tps, cycle_steps, fx.quantize);
                for (_k = 0; _k < _ratch && a_count < BAKE_BUF; _k++) {
                    uint32_t _sub_tick = eff_tick + (uint32_t)_k * _sub_interval;
                    if (_sub_tick >= cycle_ticks) break;
                    for (gi = 0; gi < gc && a_count < BAKE_BUF; gi++)
                        rmc_a[a_count++] = (bake_note_t){ _sub_tick, _final_gate,
                                                          gen[gi], (uint8_t)vel };
                }
            }
        }

        bake_note_t *in_buf = rmc_a, *out_buf = rmc_b;
        int in_count = a_count;
        for (si = 0; si < 2; si++) {
            int out_count;
            if (BAKE_STAGES[si] == BAKE_STAGE_MIDI_DLY)
                /* Wrapped cycle: generate all echoes (UINT32_MAX), fold mod cycle
                 * below → steady-state. Open cycle: stop echoes at cycle_ticks → clean
                 * first pass (tail cut by the loop brace anyway). */
                out_count = bake_stage_midi_dly(inst, scale_aware, &fx, cycle_ticks,
                                                wrapped ? UINT32_MAX : cycle_ticks,
                                                in_buf, in_count, out_buf, BAKE_BUF);
            else
                out_count = bake_stage_arp_out(inst, &fx, cycle_ticks,
                                               in_buf, in_count, out_buf, BAKE_BUF);
            bake_note_t *tmp = in_buf; in_buf = out_buf; out_buf = tmp;
            in_count = out_count;
        }

        for (ri = 0; ri < in_count && total_out < out_cap; ri++) {
            uint32_t tick = in_buf[ri].tick;
            if (wrapped) tick %= cycle_ticks;          /* fold within this cycle */
            else if (tick >= cycle_ticks) continue;    /* open: drop tail past cycle */
            out[total_out].tick  = tick + loop_offset;
            out[total_out].gate  = in_buf[ri].gate;
            out[total_out].pitch = in_buf[ri].pitch;
            out[total_out].vel   = in_buf[ri].vel;
            total_out++;
        }
    }
    return total_out;
}

/* Offline conductor-offset reconstruction for SCENE bake "Apply Conductor?".
 * Replicates the live transpose chain (conductor note -> NOTE FX gen[0] ->
 * degree/semitone offset relative to R) for a responder note whose absolute
 * tick across the N baked loops is `abs_tick`. Returns 1 and sets *deg/*semi
 * when a conductor note governs that tick (per gate-hold vs CdLk Lock + the
 * conductor clip's iteration/probability trig conditions), else 0 (snap to
 * zero -> no transpose).
 *
 * `cc`      = the conductor's clip at the scene index.
 * `cond_fx` = a play_fx_t built once from cc->pfx_params (conductor NOTE FX).
 * Polymeter: the conductor wraps at ITS OWN window length, independent of the
 *   responder. We compute the conductor-relative tick `rel = abs_tick %
 *   condWindowTicks` and the conductor trig cycle `condCycle = abs_tick /
 *   condWindowTicks`, so iteration trig advances per conductor wrap.
 * NoteFX random / step probability re-roll per call (per responder occurrence);
 *   acceptable freeze behavior — a flattened clip can't reproduce live S&H of
 *   a single RNG draw across all responders. */
static int conductor_bake_offset(seq8_instance_t *inst, clip_t *cc,
                                 play_fx_t *cond_fx, uint32_t abs_tick,
                                 uint32_t *cond_rng, int *deg, int *semi) {
    uint16_t ctps = cc->ticks_per_step ? cc->ticks_per_step
                                       : (uint16_t)TICKS_PER_STEP;
    uint32_t cond_win = (uint32_t)cc->length * ctps;
    if (cond_win == 0) return 0;
    /* Conductor wraps at its own window (polymeter). The conductor window is
     * anchored at loop_start, mirroring melodic playback. */
    uint32_t cwin_start = (uint32_t)cc->loop_start * ctps;
    uint32_t condCycle  = abs_tick / cond_win;
    uint32_t rel        = (abs_tick % cond_win) + cwin_start;

    note_t *chosen = NULL;
    if (cc->cond_lock) {
        /* Lock (sample-and-hold): most-recent conductor note onset <= rel that
         * passes trig; hold its offset. None at/before rel -> no transpose. */
        uint32_t best_tick = 0; int have = 0;
        uint16_t ni;
        for (ni = 0; ni < cc->note_count; ni++) {
            note_t *nn = &cc->notes[ni];
            if (!nn->active || nn->suppress_until_wrap) continue;
            if (nn->tick < cwin_start || nn->tick >= cwin_start + cond_win) continue;
            if (nn->tick > rel) continue;
            if (!have || nn->tick > best_tick) {
                uint16_t sidx = note_step(nn->tick, cc->length, ctps);
                if (step_trig_pass(cc, sidx, condCycle, cond_rng)) {
                    best_tick = nn->tick; chosen = nn; have = 1;
                }
            }
        }
    } else {
        /* gate-hold: a conductor note active over [tick, tick+gate) covering rel
         * whose trig passes. */
        uint16_t ni;
        for (ni = 0; ni < cc->note_count; ni++) {
            note_t *nn = &cc->notes[ni];
            if (!nn->active || nn->suppress_until_wrap) continue;
            if (nn->tick < cwin_start || nn->tick >= cwin_start + cond_win) continue;
            if (!(nn->tick <= rel && rel < (uint32_t)nn->tick + nn->gate)) continue;
            uint16_t sidx = note_step(nn->tick, cc->length, ctps);
            if (step_trig_pass(cc, sidx, condCycle, cond_rng)) { chosen = nn; break; }
        }
    }
    int R = eff_pad_key(inst) + 60;
    int gen0 = 0, _ap = chosen ? 1 : 0;
    if (chosen) {
        /* Conductor effective note = post-NOTE-FX gen[0]. Conductor is scale-aware
         * (offset math uses scale degrees) when global Scale-Aware is on. */
        int sa = (int)inst->scale_aware;
        uint8_t tmp[MAX_GEN_NOTES];
        int gc = pfx_build_gen_notes(inst, sa, cond_fx, (int)chosen->pitch, tmp);
        if (gc < 1) { _ap = 0; }
        else {
            gen0  = (int)tmp[0];
            *semi = gen0 - R;
            *deg  = note_abs_degree(inst, gen0) - note_abs_degree(inst, R);
        }
    }
    return _ap;
}

static uint32_t u32_gcd(uint32_t a, uint32_t b); /* fwd decl; defined below */

static void bake_clip(seq8_instance_t *inst, int t, int c, int loops, int wrap,
                      int apply_conductor) {
    seq8_track_t *tr = &inst->tracks[t];
    clip_t *cl;
    int ni, si, ri;
    if (tr->pad_mode == PAD_MODE_DRUM) return;
    if (tr->pad_mode == PAD_MODE_CONDUCT) return; /* Conductor has no bake output */
    cl = &tr->clips[c];
    if (cl->note_count == 0) return;
    if (loops < 1) loops = 1;
    if (loops > 4) loops = 4;

    undo_begin_single(inst, t, c);

    /* SCENE-bake "Apply Conductor?": fold the Conductor's transposition into
     * this responder clip against the Conductor's clip at the same scene index.
     * Only when requested, a Conductor exists, this isn't the Conductor track,
     * and this track responds in the Conductor's clip C. cond_fx is built once
     * (NOTE FX random re-rolls per responder occurrence — freeze behavior). */
    int do_cond = 0;
    clip_t *cond_cl = NULL;
    play_fx_t cond_fx;
    uint32_t cond_rng = 0xC04D1234u;
    if (apply_conductor && inst->conductor_track >= 0 &&
        t != inst->conductor_track) {
        cond_cl = &inst->tracks[inst->conductor_track].clips[c];
        if (cond_cl->cond_resp[t]) {
            pfx_init_defaults(&cond_fx);
            pfx_apply_params(&cond_fx, &cond_cl->pfx_params);
            cond_fx.track_idx = (uint8_t)inst->conductor_track;
            cond_fx.route     = ROUTE_SCHWUNG;
            cond_fx.rng       = 0xC04DBEEFu;
            do_cond = 1;
        }
    }
    play_fx_t fx;
    pfx_init_defaults(&fx);
    pfx_apply_params(&fx, &cl->pfx_params);
    fx.track_idx = (uint8_t)t;
    fx.route     = ROUTE_SCHWUNG;
    fx.rng       = 0xDEADBEEFu;

    int scale_aware = (int)inst->scale_aware;
    uint16_t tps    = cl->ticks_per_step ? cl->ticks_per_step : (uint16_t)TICKS_PER_STEP;
    uint16_t length = cl->length;
    uint32_t clip_ticks  = (uint32_t)length * tps;
    /* Window-only bake: notes outside [loop_start, loop_start+length) are
     * not played and therefore not baked. Tick math below operates in
     * window-relative space so the baked output anchors at step 0. */
    uint32_t win_start_tick = (uint32_t)cl->loop_start * tps;

    /* Direction- and style-aware bake. cycle_steps:
     *   Forward / Backward         = length
     *   PPf / PPb step style       = 2L-2 (endpoint plays once)
     *   PPf / PPb audio style      = 2L   (endpoint plays twice; fugue cycle)
     * Per source note we emit 1 or 2 directional positions inside one cycle;
     * the BAKE_STAGES operate on cycle_ticks (not clip_ticks) so MIDI DLY /
     * SEQ ARP wrap semantics match what live playback would do. */
    uint8_t pdir = cl->playback_dir;
    uint8_t paud = cl->playback_audio_reverse;
    uint16_t cycle_steps = playback_cycle_steps(pdir, paud, length);
    uint32_t cycle_ticks = (uint32_t)cycle_steps * tps;

    /* Polymeter LCM extension for Apply-Conductor scene bakes:
     * In live playback a short responder loops repeatedly under a longer
     * conductor (e.g. 1-page responder, 4-page conductor), each pass
     * transposed by the conductor offset at that absolute tick. A single
     * bake pass (cycle_ticks long) only overlaps the conductor's first
     * stretch, so the later conductor pages never get captured. To freeze
     * the full polymeter we must extend the baked responder to the LCM of
     * the two window lengths (in ticks). respWin = the responder's per-loop
     * window (cycle_ticks); condWin = the conductor clip's window. The
     * conductor offset path (conductor_bake_offset) already wraps each note
     * by abs_tick % condWin, so a baked span of LCM length sweeps every
     * conductor page across the extra repetitions.
     * Only applies when do_cond (apply_conductor + responder + conductor
     * present); otherwise effectiveLoops == loops and behavior is unchanged. */
    int effectiveLoops = loops;
    if (do_cond && cond_cl) {
        uint32_t respWinTicks = cycle_ticks;
        uint16_t cond_tps = cond_cl->ticks_per_step ? cond_cl->ticks_per_step
                                                     : (uint16_t)TICKS_PER_STEP;
        uint32_t condWinTicks = (uint32_t)cond_cl->length * cond_tps;
        if (respWinTicks > 0 && condWinTicks > respWinTicks) {
            uint32_t g = u32_gcd(respWinTicks, condWinTicks);
            uint32_t repeats = g ? (condWinTicks / g) : 1; /* lcm/respWin */
            if (repeats < 1) repeats = 1;
            effectiveLoops = loops * (int)repeats;
        }
    }

    uint16_t new_length  = (uint16_t)clamp_i((int)cycle_steps * effectiveLoops, 1, 256);
    uint32_t total_ticks = (uint32_t)new_length * tps;

    static bake_note_t bake_a[BAKE_BUF];
    static bake_note_t bake_b[BAKE_BUF];
    static bake_note_t bake_out[BAKE_BUF * 4]; /* accumulates all cycles */
    int total_out = 0;
    int out_cap   = BAKE_BUF * 4; /* bake_out capacity; effectiveLoops may exceed `loops` */
    int _bake_capped = 0;

    int loop;
    for (loop = 0; loop < effectiveLoops; loop++) {
        uint32_t loop_offset = (uint32_t)loop * cycle_ticks;
        int a_count = 0;
        fx.note_random_walk = 0; /* fresh walk each cycle so loops produce independent pitch sequences */

        /* Stage 0: NOTEFX + HARMZ — reads cl->notes (unmodified until clip_init below).
         * For each source note we compute the directional position(s) inside
         * this cycle and emit there. PP yields up to 2 positions per source
         * note (ascending + descending), endpoints only emit once. */
        for (ni = 0; ni < cl->note_count && a_count < BAKE_BUF; ni++) {
            note_t *nn = &cl->notes[ni];
            if (nn->suppress_until_wrap) continue;
            if (nn->tick < win_start_tick || nn->tick >= win_start_tick + clip_ticks)
                continue;
            /* v=34 trig conditions: iter gates by bake cycle index, random rolls per-note */
            uint16_t _sidx = note_step(nn->tick, length, tps);
            if (!step_trig_pass(cl, _sidx, (uint32_t)loop, &fx.rng)) continue;
            uint32_t rel_tick = nn->tick - win_start_tick;

            uint32_t gate = compute_effective_gate_ticks(
                tps, nn->gate, cl->pfx_params.note_length_mode, fx.gate_time);
            int vel = (int)nn->vel + fx.velocity_offset;
            if (vel < 1) vel = 1; if (vel > 127) vel = 127;
            uint8_t gen[MAX_GEN_NOTES];
            int gc = pfx_build_gen_notes(inst, scale_aware, &fx, (int)nn->pitch, gen);

            /* Apply Conductor (SCENE bake, Next-style): each baked responder
             * note takes the conductor offset at its OWN onset (loop_offset +
             * rel_tick = abs tick across the N baked loops). Mirrors
             * conductor_transpose_gen: scale-aware degree / chromatic semitone +
             * per-track Octave (cond_oct). */
            if (do_cond) {
                int cdeg = 0, csemi = 0;
                uint32_t resp_abs = loop_offset + rel_tick;
                if (conductor_bake_offset(inst, cond_cl, &cond_fx, resp_abs,
                                          &cond_rng, &cdeg, &csemi)) {
                    int coct = cond_cl->cond_oct[t];
                    int gj;
                    for (gj = 0; gj < gc; gj++) {
                        if (inst->scale_aware) {
                            int sn = (int)SCALE_SIZES[eff_pad_scale(inst)];
                            gen[gj] = (uint8_t)scale_transpose(inst, gen[gj],
                                          cdeg + coct * sn);
                        } else {
                            gen[gj] = (uint8_t)clamp_i((int)gen[gj] +
                                          csemi + coct * 12, 0, 127);
                        }
                    }
                }
            }

            uint32_t emit_ticks[2];
            int emit_count = compute_bake_emit_positions(pdir, paud, length, tps,
                                                          rel_tick, gate, emit_ticks);

            /* v=34 Ratchet bake: r sub-hits tiling one step, gate=sub-interval. */
            uint8_t  _ratch = cl->step_ratchet[_sidx];
            if (_ratch < 2) _ratch = 1;
            uint16_t _sub_interval = (_ratch > 1) ? (uint16_t)(tps / _ratch) : 0;
            uint16_t _final_gate   = (_ratch > 1) ? (_sub_interval ? _sub_interval : 1)
                                                  : (uint16_t)gate;

            int ei, _k, gi;
            for (ei = 0; ei < emit_count && a_count < BAKE_BUF; ei++) {
                uint32_t eff_tick = bake_apply_quantize(emit_ticks[ei], tps, cycle_steps, fx.quantize);
                for (_k = 0; _k < _ratch && a_count < BAKE_BUF; _k++) {
                    uint32_t _sub_tick = eff_tick + (uint32_t)_k * _sub_interval;
                    if (_sub_tick >= cycle_ticks) break;
                    for (gi = 0; gi < gc && a_count < BAKE_BUF; gi++)
                        bake_a[a_count++] = (bake_note_t){ _sub_tick, _final_gate,
                                                           gen[gi], (uint8_t)vel };
                }
            }
        }

        /* Process BAKE_STAGES — clip_ticks param = cycle_ticks for PP (so
         * delay echo wrap math matches live playback's cycle). */
        bake_note_t *in_buf = bake_a, *out_buf = bake_b;
        int in_count = a_count;
        for (si = 0; si < 2; si++) {
            int out_count;
            if (BAKE_STAGES[si] == BAKE_STAGE_MIDI_DLY)
                out_count = bake_stage_midi_dly(inst, scale_aware, &fx, cycle_ticks,
                                                (wrap && loop == effectiveLoops - 1) ? UINT32_MAX
                                                    : (uint32_t)(effectiveLoops - loop) * cycle_ticks,
                                                in_buf, in_count, out_buf, BAKE_BUF);
            else
                out_count = bake_stage_arp_out(inst, &fx, cycle_ticks,
                                               in_buf, in_count, out_buf, BAKE_BUF);
            bake_note_t *tmp = in_buf; in_buf = out_buf; out_buf = tmp;
            in_count = out_count;
        }

        /* Accumulate this cycle with loop_offset; wrap overflow back to start if requested */
        if (in_count > 0 && total_out >= out_cap) _bake_capped = 1;
        for (ri = 0; ri < in_count && total_out < out_cap; ri++) {
            if (total_out + 1 >= out_cap) _bake_capped = 1;
            uint32_t tick = in_buf[ri].tick + loop_offset;
            if (tick >= total_ticks) {
                if (!wrap) continue;
                tick %= total_ticks;
            }
            bake_out[total_out].tick  = tick;
            bake_out[total_out].gate  = in_buf[ri].gate;
            bake_out[total_out].pitch = in_buf[ri].pitch;
            bake_out[total_out].vel   = in_buf[ri].vel;
            total_out++;
        }
    }

    /* Write results back; clip_init also clears pfx_params + resets playback_dir
     * to Forward (direction is now "frozen" into the note positions). */
    clip_init(cl);
    cl->ticks_per_step = tps;
    cl->length         = new_length;
    for (ri = 0; ri < total_out; ri++) {
        bake_note_t *bn = &bake_out[ri];
        if (bn->tick < total_ticks)
            clip_insert_note(cl, bn->tick, bn->gate, bn->pitch, bn->vel);
    }
    clip_build_steps_from_notes(cl);
    if (c == tr->active_clip)
        pfx_sync_from_clip(tr);
    inst->state_dirty = 1;
    /* Conductor-LCM extension may push the baked span past the bake_out
     * buffer cap (or the 256-step clip length clamp). The existing guards
     * truncate safely; surface it so the silent cap is visible. */
    if (do_cond && (_bake_capped ||
            (int)cycle_steps * effectiveLoops > new_length)) {
        char _bcap[120];
        snprintf(_bcap, sizeof(_bcap),
            "  bakeclip t=%d CAPPED effLoops=%d (loops=%d) newLen=%d out=%d/%d",
            t, effectiveLoops, loops, (int)new_length, total_out, out_cap);
        seq8_ilog(inst, _bcap);
    }
}

/* Per-lane drum bake: applies vel/gate/timing/arp effects per lane.
 * HARMZ and pitch transforms are discarded — drum lanes play at their
 * fixed midi_note regardless of stored pitch.
 * Undo restores notes/steps; pfx_params are not saved in drum undo snapshots. */
static void bake_drum_lane(seq8_instance_t *inst, int t, int c, int lane, int loops, int wrap) {
    seq8_track_t *tr = &inst->tracks[t];
    int ni;
    if (tr->drum_clips[c]->lanes[lane].clip.note_count == 0) return;
    if (loops < 1) loops = 1;
    if (loops > 4) loops = 4;

    undo_begin_drum_clip(inst, t, c);

    int scale_aware = (int)inst->scale_aware;
    static bake_note_t dl_a[BAKE_BUF];
    static bake_note_t dl_b[BAKE_BUF];
    static bake_note_t dl_out[BAKE_BUF * 4];

    {
        drum_lane_t *dl = &tr->drum_clips[c]->lanes[lane];
        clip_t *cl = &dl->clip;

        play_fx_t fx;
        pfx_init_defaults(&fx);
        { drum_pfx_params_t *_dp = &dl->pfx_params;
          fx.gate_time       = _dp->gate_time;
          fx.velocity_offset = _dp->velocity_offset;
          fx.quantize        = _dp->quantize;
          fx.delay_time_idx  = _dp->delay_time_idx;
          fx.delay_level     = _dp->delay_level;
          fx.repeat_times    = _dp->repeat_times;
          fx.fb_velocity     = _dp->fb_velocity;
          fx.fb_gate_time    = _dp->fb_gate_time;
          fx.fb_clock        = _dp->fb_clock;
          fx.delay_retrig    = _dp->delay_retrig; }
        fx.track_idx = (uint8_t)t;
        fx.route     = ROUTE_SCHWUNG;
        fx.rng       = 0xDEADBEEFu;

        uint16_t tps    = cl->ticks_per_step ? cl->ticks_per_step : (uint16_t)TICKS_PER_STEP;
        uint16_t length = cl->length;
        uint32_t clip_ticks  = (uint32_t)length * tps;
        uint32_t win_start_tick = (uint32_t)cl->loop_start * tps;

        /* Direction- and style-aware bake — see bake_clip above for full design. */
        uint8_t pdir = cl->playback_dir;
        uint8_t paud = cl->playback_audio_reverse;
        uint16_t cycle_steps = playback_cycle_steps(pdir, paud, length);
        uint32_t cycle_ticks = (uint32_t)cycle_steps * tps;

        uint16_t new_length  = (uint16_t)clamp_i((int)cycle_steps * loops, 1, 256);
        uint32_t total_ticks = (uint32_t)new_length * tps;
        int total_out = 0;
        int out_cap   = BAKE_BUF * loops;
        int loop, si, ri;

        for (loop = 0; loop < loops; loop++) {
            uint32_t loop_offset = (uint32_t)loop * cycle_ticks;
            fx.note_random_walk = 0;
            int a_count = 0;

            /* Stage 0: vel/gate from NOTE FX — no pitch/HARMZ expansion.
             * Window-only: skip notes outside [loop_start, loop_start+length).
             * Each source note yields 1 or 2 directional positions inside the
             * cycle (PP middle steps emit twice; endpoints once). */
            for (ni = 0; ni < cl->note_count && a_count < BAKE_BUF; ni++) {
                note_t *nn = &cl->notes[ni];
                if (nn->suppress_until_wrap) continue;
                if (nn->tick < win_start_tick || nn->tick >= win_start_tick + clip_ticks)
                    continue;
                /* v=34 trig conditions: iter gates by bake cycle index, random rolls per-note */
                uint16_t _sidx = note_step(nn->tick, length, tps);
                if (!step_trig_pass(cl, _sidx, (uint32_t)loop, &fx.rng)) continue;
                uint32_t rel_tick = nn->tick - win_start_tick;
                uint32_t gate = compute_effective_gate_ticks(
                    tps, nn->gate, dl->pfx_params.note_length_mode, fx.gate_time);
                int vel = (int)nn->vel + fx.velocity_offset;
                if (vel < 1) vel = 1; if (vel > 127) vel = 127;

                uint32_t emit_ticks[2];
                int emit_count = compute_bake_emit_positions(pdir, paud, length, tps,
                                                              rel_tick, gate, emit_ticks);

                /* v=34 Ratchet bake: r sub-hits tiling one step, gate=sub-interval. */
                uint8_t  _ratch = cl->step_ratchet[_sidx];
                if (_ratch < 2) _ratch = 1;
                uint16_t _sub_interval = (_ratch > 1) ? (uint16_t)(tps / _ratch) : 0;
                uint16_t _final_gate   = (_ratch > 1) ? (_sub_interval ? _sub_interval : 1)
                                                      : (uint16_t)gate;
                int ei, _k;
                for (ei = 0; ei < emit_count && a_count < BAKE_BUF; ei++) {
                    uint32_t eff_tick = bake_apply_quantize(emit_ticks[ei], tps, cycle_steps, fx.quantize);
                    for (_k = 0; _k < _ratch && a_count < BAKE_BUF; _k++) {
                        uint32_t _sub_tick = eff_tick + (uint32_t)_k * _sub_interval;
                        if (_sub_tick >= cycle_ticks) break;
                        dl_a[a_count++] = (bake_note_t){ _sub_tick, _final_gate,
                                                         dl->midi_note, (uint8_t)vel };
                    }
                }
            }

            bake_note_t *in_buf = dl_a, *out_buf = dl_b;
            int in_count = a_count;
            for (si = 0; si < 2; si++) {
                int out_count;
                if (BAKE_STAGES[si] == BAKE_STAGE_MIDI_DLY)
                    out_count = bake_stage_midi_dly(inst, scale_aware, &fx, cycle_ticks,
                                                    (wrap && loop == loops - 1) ? UINT32_MAX
                                                        : (uint32_t)(loops - loop) * cycle_ticks,
                                                    in_buf, in_count, out_buf, BAKE_BUF);
                else
                    out_count = bake_stage_arp_out(inst, &fx, cycle_ticks,
                                                   in_buf, in_count, out_buf, BAKE_BUF);
                bake_note_t *tmp = in_buf; in_buf = out_buf; out_buf = tmp;
                in_count = out_count;
            }

            for (ri = 0; ri < in_count && total_out < out_cap; ri++) {
                uint32_t tick = in_buf[ri].tick + loop_offset;
                if (tick >= total_ticks) {
                    if (!wrap) continue;
                    tick %= total_ticks;
                }
                dl_out[total_out].tick  = tick;
                dl_out[total_out].gate  = in_buf[ri].gate;
                dl_out[total_out].pitch = dl->midi_note;
                dl_out[total_out].vel   = in_buf[ri].vel;
                total_out++;
            }
        }

        clip_init(cl);  /* also resets playback_dir to Forward */
        cl->ticks_per_step = tps;
        cl->length = new_length;
        for (ri = 0; ri < total_out; ri++) {
            bake_note_t *bn = &dl_out[ri];
            if (bn->tick < total_ticks)
                clip_insert_note(cl, bn->tick, bn->gate, dl->midi_note, bn->vel);
        }
        clip_build_steps_from_notes(cl);
        drum_pfx_params_init(&dl->pfx_params);
    }
    if (c == (int)tr->active_clip)
        drum_pfx_apply_params(&tr->drum_lane_pfx[lane],
                              &tr->drum_clips[c]->lanes[lane].pfx_params);
    inst->state_dirty = 1;
}

/* Cap for the exported drum-clip span (LCM of lane loop-lengths). Coprime lane
 * lengths blow the LCM up; cap at 64 bars and snap to a clean multiple of the
 * longest lane so that lane still loops seamlessly (rare degenerate case). */
#define EXPORT_DRUM_MAX_TICKS 24576u   /* 64 bars * 384 ticks/bar */

static uint32_t u32_gcd(uint32_t a, uint32_t b) {
    while (b) { uint32_t t = a % b; a = b; b = t; }
    return a;
}

/* Non-destructive single-cycle drum-lane render for Ableton export. MIRROR of
 * the bake_drum_lane compute — KEEP IN SYNC. Emits notes at dl->midi_note (no
 * pitch/HARMZ), one cycle, into `out`; returns count. *out_lane_ticks = the
 * lane's loop span (length*tps) for LCM tiling. No clip mutation / undo / state. */
/* `loops` = number of lane cycles to render (>= 1). Output ticks span
 * [0, loops*clip_ticks). v=34 trig conditions (Iter/Random/Ratchet) apply
 * per-cycle inside the loop. `*out_lane_ticks` = loops * clip_ticks. */
static int render_drum_lane_nd(seq8_instance_t *inst, int t, int c, int lane,
                               int loops,
                               bake_note_t *out, int out_cap, uint32_t *out_lane_ticks) {
    seq8_track_t *tr = &inst->tracks[t];
    int ni, si, ri;
    if (out_lane_ticks) *out_lane_ticks = 0;
    drum_lane_t *dl = &tr->drum_clips[c]->lanes[lane];
    clip_t *cl = &dl->clip;
    if (cl->note_count == 0) return 0;
    if (loops < 1) loops = 1;

    play_fx_t fx;
    pfx_init_defaults(&fx);
    { drum_pfx_params_t *_dp = &dl->pfx_params;
      fx.gate_time       = _dp->gate_time;
      fx.velocity_offset = _dp->velocity_offset;
      fx.quantize        = _dp->quantize;
      fx.delay_time_idx  = _dp->delay_time_idx;
      fx.delay_level     = _dp->delay_level;
      fx.repeat_times    = _dp->repeat_times;
      fx.fb_velocity     = _dp->fb_velocity;
      fx.fb_gate_time    = _dp->fb_gate_time;
      fx.fb_clock        = _dp->fb_clock;
      fx.delay_retrig    = _dp->delay_retrig; }
    fx.track_idx = (uint8_t)t;
    fx.route     = ROUTE_SCHWUNG;
    fx.rng       = 0xDEADBEEFu;

    int scale_aware = (int)inst->scale_aware;
    uint16_t tps    = cl->ticks_per_step ? cl->ticks_per_step : (uint16_t)TICKS_PER_STEP;
    uint16_t length = cl->length;
    uint32_t clip_ticks     = (uint32_t)length * tps;
    uint32_t win_start_tick = (uint32_t)cl->loop_start * tps;

    /* Direction- and style-aware cycle for export — see bake_clip. */
    uint8_t pdir = cl->playback_dir;
    uint8_t paud = cl->playback_audio_reverse;
    uint16_t cycle_steps = playback_cycle_steps(pdir, paud, length);
    uint32_t cycle_ticks = (uint32_t)cycle_steps * tps;

    if (out_lane_ticks) *out_lane_ticks = cycle_ticks * (uint32_t)loops;
    if (clip_ticks == 0 || cycle_ticks == 0) return 0;

    int wrapped = (fx.delay_level > 0);
    static bake_note_t dnd_a[BAKE_BUF];
    static bake_note_t dnd_b[BAKE_BUF];
    int n = 0;
    int loop;
    for (loop = 0; loop < loops; loop++) {
        uint32_t loop_offset = (uint32_t)loop * cycle_ticks;
        fx.note_random_walk = 0;   /* fresh walk; fx.rng persists for distinct passes */
        int a_count = 0;
        for (ni = 0; ni < cl->note_count && a_count < BAKE_BUF; ni++) {
            note_t *nn = &cl->notes[ni];
            if (nn->suppress_until_wrap) continue;
            if (nn->tick < win_start_tick || nn->tick >= win_start_tick + clip_ticks)
                continue;
            /* v=34 trig conditions: iter gates by cycle index, random rolls per-note */
            uint16_t _sidx = note_step(nn->tick, length, tps);
            if (!step_trig_pass(cl, _sidx, (uint32_t)loop, &fx.rng)) continue;
            uint32_t rel_tick = nn->tick - win_start_tick;
            uint32_t gate = compute_effective_gate_ticks(
                tps, nn->gate, dl->pfx_params.note_length_mode, fx.gate_time);
            int vel = (int)nn->vel + fx.velocity_offset;
            if (vel < 1) vel = 1; if (vel > 127) vel = 127;

            uint32_t emit_ticks[2];
            int emit_count = compute_bake_emit_positions(pdir, paud, length, tps,
                                                          rel_tick, gate, emit_ticks);

            /* v=34 Ratchet: r sub-hits tiling one step, gate=sub-interval. */
            uint8_t  _ratch = cl->step_ratchet[_sidx];
            if (_ratch < 2) _ratch = 1;
            uint16_t _sub_interval = (_ratch > 1) ? (uint16_t)(tps / _ratch) : 0;
            uint16_t _final_gate   = (_ratch > 1) ? (_sub_interval ? _sub_interval : 1)
                                                  : (uint16_t)gate;
            int ei, _k;
            for (ei = 0; ei < emit_count && a_count < BAKE_BUF; ei++) {
                uint32_t eff_tick = bake_apply_quantize(emit_ticks[ei], tps, cycle_steps, fx.quantize);
                for (_k = 0; _k < _ratch && a_count < BAKE_BUF; _k++) {
                    uint32_t _sub_tick = eff_tick + (uint32_t)_k * _sub_interval;
                    if (_sub_tick >= cycle_ticks) break;
                    dnd_a[a_count++] = (bake_note_t){ _sub_tick, _final_gate,
                                                      dl->midi_note, (uint8_t)vel };
                }
            }
        }

        bake_note_t *in_buf = dnd_a, *out_buf = dnd_b;
        int in_count = a_count;
        for (si = 0; si < 2; si++) {
            int out_count;
            if (BAKE_STAGES[si] == BAKE_STAGE_MIDI_DLY)
                out_count = bake_stage_midi_dly(inst, scale_aware, &fx, cycle_ticks,
                                                wrapped ? UINT32_MAX : cycle_ticks,
                                                in_buf, in_count, out_buf, BAKE_BUF);
            else
                out_count = bake_stage_arp_out(inst, &fx, cycle_ticks,
                                               in_buf, in_count, out_buf, BAKE_BUF);
            bake_note_t *tmp = in_buf; in_buf = out_buf; out_buf = tmp;
            in_count = out_count;
        }

        for (ri = 0; ri < in_count && n < out_cap; ri++) {
            uint32_t tick = in_buf[ri].tick;
            if (wrapped) tick %= cycle_ticks;
            else if (tick >= cycle_ticks) continue;
            out[n].tick  = tick + loop_offset;
            out[n].gate  = in_buf[ri].gate;
            out[n].pitch = dl->midi_note;
            out[n].vel   = in_buf[ri].vel;
            n++;
        }
    }
    return n;
}

/* Per-clip drum bake: applies full effects chain per lane including HARMZ.
 * Output notes are routed to lanes by pitch — HARMZ can redistribute hits
 * across lanes. Notes with no matching lane are dropped.
 * Pool cap: DRUM_BAKE_POOL notes; overflowing notes are silently dropped.
 * Undo restores notes/steps; pfx_params are not saved in drum undo snapshots. */
#define DRUM_BAKE_POOL 2048
static void bake_drum_clip(seq8_instance_t *inst, int t, int c, int loops, int wrap) {
    seq8_track_t *tr = &inst->tracks[t];
    int l, ni;
    int any = 0;
    for (l = 0; l < DRUM_LANES; l++) {
        if (tr->drum_clips[c]->lanes[l].clip.note_count > 0) { any = 1; break; }
    }
    if (!any) return;
    if (loops < 1) loops = 1;
    if (loops > 4) loops = 4;

    undo_begin_drum_clip(inst, t, c);

    int scale_aware = (int)inst->scale_aware;

    /* Use the LONGEST non-empty lane's *playback cycle* as the bake's unit so
     * a PP lane (cycle = 2L-2 steps) extends the output's total extent
     * accordingly. Shorter lanes (by cycle) loop more times to stay in phase
     * across the full extent — same way they play live with each lane
     * wrapping independently against its own cycle. */
    uint16_t ref_tps = (uint16_t)TICKS_PER_STEP;
    uint32_t ref_cycle_ticks = 0;
    {
        for (l = 0; l < DRUM_LANES; l++) {
            clip_t *cl = &tr->drum_clips[c]->lanes[l].clip;
            if (cl->note_count > 0 && cl->ticks_per_step > 0 && cl->length > 0) {
                uint16_t cs = playback_cycle_steps(cl->playback_dir,
                                                    cl->playback_audio_reverse,
                                                    cl->length);
                uint32_t ct = (uint32_t)cs * cl->ticks_per_step;
                if (ct > ref_cycle_ticks) {
                    ref_cycle_ticks = ct;
                    ref_tps = cl->ticks_per_step;
                }
            }
        }
        if (ref_cycle_ticks == 0)
            ref_cycle_ticks = (uint32_t)SEQ_STEPS_DEFAULT * ref_tps;
    }

    uint32_t new_ticks_raw = ref_cycle_ticks * (uint32_t)loops;
    uint16_t new_length  = (uint16_t)clamp_i((int)(new_ticks_raw / ref_tps), 1, 256);
    uint32_t new_ticks   = (uint32_t)new_length * ref_tps;

    static bake_note_t dc_pool[DRUM_BAKE_POOL];
    static bake_note_t dc_a[BAKE_BUF];
    static bake_note_t dc_b[BAKE_BUF];
    int pool_count = 0;

    /* Pass 1: bake each lane with N loops, collect into pool */
    for (l = 0; l < DRUM_LANES; l++) {
        drum_lane_t *dl = &tr->drum_clips[c]->lanes[l];
        clip_t *cl = &dl->clip;
        if (cl->note_count == 0) continue;

        play_fx_t fx;
        pfx_init_defaults(&fx);
        { drum_pfx_params_t *_dp = &dl->pfx_params;
          fx.gate_time       = _dp->gate_time;
          fx.velocity_offset = _dp->velocity_offset;
          fx.quantize        = _dp->quantize;
          fx.delay_time_idx  = _dp->delay_time_idx;
          fx.delay_level     = _dp->delay_level;
          fx.repeat_times    = _dp->repeat_times;
          fx.fb_velocity     = _dp->fb_velocity;
          fx.fb_gate_time    = _dp->fb_gate_time;
          fx.fb_clock        = _dp->fb_clock;
          fx.delay_retrig    = _dp->delay_retrig; }
        fx.track_idx = (uint8_t)t;
        fx.route     = ROUTE_SCHWUNG;
        fx.rng       = 0xDEADBEEFu;

        uint16_t tps    = cl->ticks_per_step ? cl->ticks_per_step : ref_tps;
        uint16_t length = cl->length ? cl->length : (uint16_t)SEQ_STEPS_DEFAULT;
        uint32_t clip_ticks = (uint32_t)length * tps;
        uint32_t win_start_tick = (uint32_t)cl->loop_start * tps;

        /* Direction- and style-aware per-lane bake. */
        uint8_t pdir = cl->playback_dir;
        uint8_t paud = cl->playback_audio_reverse;
        uint16_t cycle_steps = playback_cycle_steps(pdir, paud, length);
        uint32_t cycle_ticks = (uint32_t)cycle_steps * tps;
        int loop, si, ri;
        /* Cover the full output extent — ceil so partial trailing cycle still
         * emits content (truncated at new_ticks by the accumulate loop). */
        int lane_loops = (cycle_ticks > 0)
                         ? (int)((new_ticks + cycle_ticks - 1u) / cycle_ticks)
                         : loops;
        if (lane_loops < 1) lane_loops = 1;

        for (loop = 0; loop < lane_loops; loop++) {
            uint32_t loop_offset = (uint32_t)loop * cycle_ticks;
            fx.note_random_walk = 0;
            int a_count = 0;

            /* Window-only bake: each lane filters by its own loop_start.
             * Per source note: emit 1 or 2 directional positions in cycle. */
            for (ni = 0; ni < cl->note_count && a_count < BAKE_BUF; ni++) {
                note_t *nn = &cl->notes[ni];
                if (nn->suppress_until_wrap) continue;
                if (nn->tick < win_start_tick || nn->tick >= win_start_tick + clip_ticks)
                    continue;
                /* v=34 trig conditions: iter gates by bake cycle index, random rolls per-note */
                uint16_t _sidx = note_step(nn->tick, length, tps);
                if (!step_trig_pass(cl, _sidx, (uint32_t)loop, &fx.rng)) continue;
                uint32_t rel_tick = nn->tick - win_start_tick;
                uint32_t gate = compute_effective_gate_ticks(
                    tps, nn->gate, dl->pfx_params.note_length_mode, fx.gate_time);
                int vel = (int)nn->vel + fx.velocity_offset;
                if (vel < 1) vel = 1; if (vel > 127) vel = 127;
                uint8_t gen[MAX_GEN_NOTES];
                int gc = pfx_build_gen_notes(inst, scale_aware, &fx, (int)nn->pitch, gen);

                uint32_t emit_ticks[2];
                int emit_count = compute_bake_emit_positions(pdir, paud, length, tps,
                                                              rel_tick, gate, emit_ticks);

                /* v=34 Ratchet bake: r sub-hits tiling one step, gate=sub-interval. */
                uint8_t  _ratch = cl->step_ratchet[_sidx];
                if (_ratch < 2) _ratch = 1;
                uint16_t _sub_interval = (_ratch > 1) ? (uint16_t)(tps / _ratch) : 0;
                uint16_t _final_gate   = (_ratch > 1) ? (_sub_interval ? _sub_interval : 1)
                                                      : (uint16_t)gate;
                int ei, _k, gi;
                for (ei = 0; ei < emit_count && a_count < BAKE_BUF; ei++) {
                    uint32_t eff_tick = bake_apply_quantize(emit_ticks[ei], tps, cycle_steps, fx.quantize);
                    for (_k = 0; _k < _ratch && a_count < BAKE_BUF; _k++) {
                        uint32_t _sub_tick = eff_tick + (uint32_t)_k * _sub_interval;
                        if (_sub_tick >= cycle_ticks) break;
                        for (gi = 0; gi < gc && a_count < BAKE_BUF; gi++)
                            dc_a[a_count++] = (bake_note_t){ _sub_tick, _final_gate,
                                                             gen[gi], (uint8_t)vel };
                    }
                }
            }

            bake_note_t *in_buf = dc_a, *out_buf = dc_b;
            int in_count = a_count;
            for (si = 0; si < 2; si++) {
                int out_count;
                if (BAKE_STAGES[si] == BAKE_STAGE_MIDI_DLY)
                    out_count = bake_stage_midi_dly(inst, scale_aware, &fx, cycle_ticks,
                                                    (wrap && loop == lane_loops - 1) ? UINT32_MAX
                                                        : (uint32_t)(lane_loops - loop) * cycle_ticks,
                                                    in_buf, in_count, out_buf, BAKE_BUF);
                else
                    out_count = bake_stage_arp_out(inst, &fx, cycle_ticks,
                                                   in_buf, in_count, out_buf, BAKE_BUF);
                bake_note_t *tmp = in_buf; in_buf = out_buf; out_buf = tmp;
                in_count = out_count;
            }

            for (ri = 0; ri < in_count && pool_count < DRUM_BAKE_POOL; ri++) {
                bake_note_t *bn = &in_buf[ri];
                uint32_t tick = bn->tick + loop_offset;
                if (tick >= new_ticks) {
                    if (!wrap) continue;
                    tick %= new_ticks;
                }
                bake_note_t pooled = *bn;
                pooled.tick = tick;
                dc_pool[pool_count++] = pooled;
            }
            if (pool_count >= DRUM_BAKE_POOL) {
                seq8_ilog(inst, "bake_drum_clip: pool full, notes dropped");
                break;
            }
        }
    }

    { char _bl[64]; snprintf(_bl, sizeof(_bl), "bake_drum_clip pool=%d", pool_count); seq8_ilog(inst, _bl); }

    /* Pass 2: clear all lanes, reset pfx_params, set new length, route pool notes */
    for (l = 0; l < DRUM_LANES; l++) {
        drum_lane_t *dl2 = &tr->drum_clips[c]->lanes[l];
        clip_t *cl = &dl2->clip;
        clip_init(cl);
        cl->ticks_per_step = ref_tps;
        cl->length = new_length;
        drum_pfx_params_init(&dl2->pfx_params);
    }
    if (c == (int)tr->active_clip)
        pfx_sync_from_clip(tr);

    int pi;
    for (pi = 0; pi < pool_count; pi++) {
        bake_note_t *bn = &dc_pool[pi];
        if (bn->tick < new_ticks) {
            for (l = 0; l < DRUM_LANES; l++) {
                drum_lane_t *dl = &tr->drum_clips[c]->lanes[l];
                if (dl->midi_note == bn->pitch) {
                    clip_insert_note(&dl->clip, bn->tick, bn->gate, bn->pitch, bn->vel);
                    break;
                }
            }
        }
    }

    for (l = 0; l < DRUM_LANES; l++) {
        clip_t *cl = &tr->drum_clips[c]->lanes[l].clip;
        if (cl->note_count > 0)
            clip_build_steps_from_notes(cl);
    }
    inst->state_dirty = 1;
}
