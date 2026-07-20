/* FILE-SCOPE HANDLER for set_param()'s tN_ misc keys -- part of the seq8.c
 * single translation unit; #included at FILE scope by seq8_set_param.c
 * (immediately before set_param), NOT a standalone TU; never compile or lint
 * this file on its own. Ninth (final tN_) Stage B handler (phase 4B group 9):
 * the former mid-function segment is now a real static int
 * sp_track_misc(sp_ctx_t *).
 * Covers the melodic-clip transforms tN_ clip_length ... lgto_apply plus the
 * pfx_set catch-all tail. See also sp_track_clip.c (the per-clip tN_cC_* data
 * block incl. the nested step parser).
 * TERMINAL tN_ handler: the unconditional pfx_set catch-all at the tail
 * consumes EVERY tN_ key that reaches this far, so this handler ALWAYS
 * returns 1 -- there is no fall-through path and no `return 0`. The two
 * closing braces that used to live at this segment's tail (the tN_ block's
 * `}` and set_param's `}`) now live in the parent dispatcher
 * (seq8_set_param.c) at the dispatch site. */
static int sp_track_misc(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

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
        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
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
        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
    }
    /* Playback style for active melodic clip: 0=Step, 1=Audio (note-on at
     * note's end when playhead is in reverse motion). */
    if (!strcmp(sub, "clip_playback_audio_reverse")) {
        clip_t *cl = &tr->clips[tr->active_clip];
        cl->playback_audio_reverse = (uint8_t)clamp_i(my_atoi(val), 0, 1);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "clock_shift")) {
        int dir = my_atoi(val);
        clip_t *cl = &tr->clips[tr->active_clip];
        int len = (int)cl->length;
        if (len < 2) return 1;
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
        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
    }

    if (!strcmp(sub, "nudge")) {
        int dir = my_atoi(val);
        if (dir == 0) { tr->clips[tr->active_clip].nudge_pos = 0; return 1; }
        if (dir != 1 && dir != -1) return 1;
        clip_t *cl = &tr->clips[tr->active_clip];
        int len = (int)cl->length;
        if (len < 1) return 1;
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
        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
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
            if (len * 2 > SEQ_STEPS) { return 1; }
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
            if (len < 2) return 1;
            {
                uint8_t seen[SEQ_STEPS];
                memset(seen, 0, sizeof(seen));
                for (i = 0; i < len; i++) {
                    if (cl->steps[i]) {
                        int dst = i / 2;
                        if (seen[dst]) {
                            tr->stretch_blocked = 1;
                            return 1;
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

        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
    }

    if (!strcmp(sub, "loop_double_fill")) {
        clip_t *cl = &tr->clips[tr->active_clip];
        int len = (int)cl->length;
        int ls  = (int)cl->loop_start;
        int i;
        /* Doubling the loop window must fit inside storage from loop_start.
         * Old check `len*2 > SEQ_STEPS` ignored loop_start; with ls>0 it
         * would accept doublings that overflow the storage extent. */
        if (ls + len * 2 > SEQ_STEPS) return 1;
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
        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
    }

    /* tN_lgto_apply: destructive legato on the active clip. Each note's
     * gate becomes (next-active-tick − this-tick); last-active note's
     * gate fills to clip_end. Undoable. */
    if (!strcmp(sub, "lgto_apply")) {
        undo_begin_single(inst, tidx, (int)tr->active_clip);
        apply_legato_to_clip(&tr->clips[tr->active_clip]);
        pfx_sync_from_clip(tr);
        inst->state_dirty = 1;
        rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
        return 1;
    }

    /* Snapshot before pfx reset commands */
    if (!strcmp(sub, "pfx_reset") || !strcmp(sub, "pfx_noteFx_reset") ||
        !strcmp(sub, "pfx_harm_reset") || !strcmp(sub, "pfx_delay_reset"))
        undo_begin_single(inst, tidx, (int)tr->active_clip);
    /* All play effects params */
    pfx_set(inst, tr, &tr->clips[tr->active_clip].pfx_params, sub, val);
    /* pfx values are snapshot-visible (rui_pfx) — every catch-all edit must
     * notify the remote UI (this whole handler previously never bumped:
     * clip_length/dir/clock_shift/nudge/beat_stretch/legato/pfx edits were
     * invisible to the browser until an unrelated rev bump — the 2026-07-19
     * "remote UI lags far behind the device" root cause). */
    rui_mark_rec(inst, tr, tidx, (int)tr->active_clip);
    return 1;
}
