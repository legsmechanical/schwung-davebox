/* FILE-SCOPE HANDLER for set_param()'s tN_cC_* per-clip keys -- part of the
 * seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (immediately before set_param), NOT a standalone TU;
 * never compile or lint this file on its own. Fourth Stage B handler
 * (phase 4B group 4): the former mid-function segment is now a real
 * static int sp_track_clip(sp_ctx_t *).
 * Covers the single sub[0]=='c' clip block: remote-UI note ops, the nested
 * _step_ parser, per-clip resolution, playback dir, loop window, CC-lane
 * (_k0.._k7) setters, _pfx_set, conductor fields, and the clears/resets.
 * This block declares and uses its own local `cidx` -- fully self-contained.
 * See also sp_track_misc.c (active-clip-level keys: clip_length, playback
 * dir, nudge, stretch, plus the pfx_set catch-all tail).
 * Returns 1 when the key was a clip key (sub[0]=='c' + digit) -- the clip
 * block CONSUMES it even if the sub-op is unknown, so unmatched tN_cC_*
 * keys never leak to the pfx catch-all in sp_track_misc. Returns 0 only
 * when sub is not a clip key, to fall through to the sibling tN_ handlers.
 * Carries the _length rui_rev freeze-fix verbatim (the
 * `if (!tr->recording) rui_touch(inst);` guard, pinned by test_rui_rev).
 * The tN_ guard and the tidx/sub/tr locals live in the parent dispatcher
 * now (seq8_set_param.c). */
static int sp_track_clip(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    if (sub[0] == 'c' && sub[1] >= '0' && sub[1] <= '9') {
        int cidx = 0;
        const char *p = sub + 1;
        /* Cap while accumulating: a >=10-digit index would overflow int
         * (negative -> clips[] OOB); keep consuming digits so p still
         * lands on the subkey, the bound check below rejects it. */
        while (*p >= '0' && *p <= '9') {
            if (cidx < NUM_CLIPS) cidx = cidx * 10 + (*p - '0');
            p++;
        }
        if (cidx >= NUM_CLIPS) return 1;
        clip_t *cl = &tr->clips[cidx];

        /* tN_cC_ruisel "[lane]": select this clip as the remote-UI snapshot
         * target. Optional arg = drum lane index (-1/absent = melodic). */
        if (!strcmp(p, "_ruisel")) {
            inst->rui_sel_track = (uint8_t)tidx;
            inst->rui_sel_clip  = (uint8_t)cidx;
            inst->rui_sel_lane  = (val && val[0] && val[0] != '-') ?
                                      (int16_t)clamp_i(my_atoi(val), 0, DRUM_LANES - 1) : -1;
            return 1;
        }

        /* tN_cC_cc_focus "<k>" — gate rui_cc to knob k (-1 = none); bump rev to force re-read. */
        if (!strcmp(p, "_cc_focus")) {
            int k = val ? my_atoi(val) : -1;
            inst->rui_cc_focus = (k >= 0 && k < 8) ? (int8_t)k : -1;
            rui_touch(inst);
            return 1;
        }

        /* Remote-UI piano-roll note edits (melodic clip). Each writes notes[]
         * directly then re-derives steps[] via clip_note_finalize. */
        if (!strcmp(p, "_note_add"))    { if (clip_note_apply_op(cl, 'a', val)) clip_note_finalize(inst, cl); return 1; }
        if (!strcmp(p, "_note_del"))    { if (clip_note_apply_op(cl, 'd', val)) clip_note_finalize(inst, cl); return 1; }
        if (!strcmp(p, "_note_move"))   { if (clip_note_apply_op(cl, 'm', val)) clip_note_finalize(inst, cl); return 1; }
        if (!strcmp(p, "_note_resize")) { if (clip_note_apply_op(cl, 'r', val)) clip_note_finalize(inst, cl); return 1; }
        if (!strcmp(p, "_note_vel"))    { if (clip_note_apply_op(cl, 'v', val)) clip_note_finalize(inst, cl); return 1; }
        if (!strcmp(p, "_notes_op")) {
            /* batch: "<op> args; <op> args; ..." — one finalize for the lot */
            const char *s = val; int changed = 0;
            while (*s) {
                while (*s == ' ' || *s == ';') s++;
                if (!*s) break;
                char op = *s++;
                while (*s == ' ') s++;
                changed |= clip_note_apply_op(cl, op, s);
                while (*s && *s != ';') s++;   /* advance to next ';' */
            }
            if (changed) clip_note_finalize(inst, cl);
            return 1;
        }

        /* tN_cC_resolution "idx" (0-5): change THIS clip's ticks_per_step and
         * rescale its notes proportionally — remote-UI per-clip variant of
         * clip_resolution (which only targets the active clip). */
        if (!strcmp(p, "_resolution")) {
            if (tr->recording) return 1;
            int ridx = clamp_i(my_atoi(val), 0, 5);
            uint16_t new_tps = TPS_VALUES[ridx];
            uint16_t old_tps = cl->ticks_per_step;
            if (new_tps == old_tps || old_tps == 0) return 1;
            uint32_t gmax_res = (uint32_t)SEQ_STEPS * new_tps;
            if (gmax_res > 65535) gmax_res = 65535;
            for (uint16_t ni = 0; ni < cl->note_count; ni++) {
                note_t *n = &cl->notes[ni];
                n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                uint32_t ng = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                if (ng < 1) ng = 1;
                if (ng > gmax_res) ng = gmax_res;
                n->gate = (uint16_t)ng;
            }
            cl->ticks_per_step = new_tps;
            if (cidx == tr->active_clip && old_tps > 0) {
                tr->tick_in_step = (uint32_t)((uint64_t)tr->tick_in_step * new_tps / old_tps);
                if (tr->tick_in_step >= new_tps) tr->tick_in_step = 0;
            }
            clip_build_steps_from_notes(cl);
            rui_touch(inst);
            inst->state_dirty = 1;
            return 1;
        }

        if (!strncmp(p, "_step_", 6)) {
            const char *q = p + 6;
            int sidx = 0;
            while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
            if (sidx < 0 || sidx >= SEQ_STEPS) return 1;

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
                return 1;
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
                return 1;
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
                cl->step_iter[sidx]       = 0;
                cl->step_random[sidx]     = 0;
                cl->step_ratchet[sidx]    = 0;
                {
                    int i, any = 0;
                    for (i = 0; i < SEQ_STEPS; i++) if (cl->steps[i]) { any = 1; break; }
                    cl->active = (uint8_t)any;
                }
                clip_migrate_to_notes(cl);
                return 1;
            }
            if (!strcmp(q, "_vel")) {
                if (cl->step_note_count[sidx] == 0) return 1;
                cl->step_vel[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                clip_migrate_to_notes(cl);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_gate")) {
                if (cl->step_note_count[sidx] == 0) return 1;
                { int gmax = SEQ_STEPS * cl->ticks_per_step; if (gmax > 65535) gmax = 65535;
                cl->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, gmax); }
                clip_migrate_to_notes(cl);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_nudge")) {
                if (cl->step_note_count[sidx] == 0) return 1;
                { int tps_m1 = cl->ticks_per_step - 1;
                int new_val = clamp_i(my_atoi(val), -tps_m1, tps_m1);
                int delta = new_val - (int)cl->note_tick_offset[sidx][0];
                int ni;
                for (ni = 0; ni < (int)cl->step_note_count[sidx]; ni++) {
                    int o = (int)cl->note_tick_offset[sidx][ni] + delta;
                    cl->note_tick_offset[sidx][ni] = (int16_t)clamp_i(o, -tps_m1, tps_m1);
                } }
                clip_migrate_to_notes(cl);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_iter")) {
                /* val: 0 = default, else (cycle_len<<4) | cycle_idx */
                int raw = clamp_i(my_atoi(val), 0, 255);
                if (raw != 0) {
                    int len = (raw >> 4) & 0xF, idx = raw & 0xF;
                    if (len < 1 || len > 8 || idx < 1 || idx > len) raw = 0;
                }
                cl->step_iter[sidx] = (uint8_t)raw;
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_rand")) {
                cl->step_random[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 100);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_ratch")) {
                cl->step_ratchet[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 4);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_reassign")) {
                /* Move notes from step sidx to dstStep, adjusting offsets.
                 * If dstStep is empty: simple move. If occupied: merge; dst notes
                 * take precedence (duplicate pitches from src are dropped). */
                int dstStep = clamp_i(my_atoi(val), 0, (int)cl->length - 1);
                if (dstStep == sidx) return 1;
                if (cl->step_note_count[sidx] == 0) return 1;
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
                        cl->step_iter[dstStep]       = cl->step_iter[sidx];
                        cl->step_random[dstStep]     = cl->step_random[sidx];
                        cl->step_ratchet[dstStep]    = cl->step_ratchet[sidx];
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
                    cl->step_iter[sidx]       = 0;
                    cl->step_random[sidx]     = 0;
                    cl->step_ratchet[sidx]    = 0;
                    cl->steps[sidx]           = 0;
                }
                {
                    int any = 0, k;
                    for (k = 0; k < (int)cl->length; k++) if (cl->steps[k]) { any = 1; break; }
                    cl->active = (uint8_t)any;
                }
                clip_migrate_to_notes(cl);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_copy_to")) {
                /* tN_cC_step_S_copy_to — copy all step data to dstStep (overwrite); src unchanged */
                int dstStep = clamp_i(my_atoi(val), 0, (int)cl->length - 1);
                if (dstStep == sidx) return 1;
                if (cl->step_note_count[sidx] == 0) return 1;
                undo_begin_single(inst, tidx, cidx);
                memcpy(cl->step_notes[dstStep], cl->step_notes[sidx], 8);
                memcpy(cl->note_tick_offset[dstStep], cl->note_tick_offset[sidx], 8 * sizeof(int16_t));
                cl->step_note_count[dstStep] = cl->step_note_count[sidx];
                cl->step_vel[dstStep]        = cl->step_vel[sidx];
                cl->step_gate[dstStep]       = cl->step_gate[sidx];
                cl->step_iter[dstStep]       = cl->step_iter[sidx];
                cl->step_random[dstStep]     = cl->step_random[sidx];
                cl->step_ratchet[dstStep]    = cl->step_ratchet[sidx];
                cl->steps[dstStep]           = cl->steps[sidx];
                {
                    int any = 0, k;
                    for (k = 0; k < (int)cl->length; k++) if (cl->steps[k]) { any = 1; break; }
                    cl->active = (uint8_t)any;
                }
                clip_migrate_to_notes(cl);
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_pitch")) {
                if (!cl->steps[sidx]) return 1;
                int delta = my_atoi(val), n;
                for (n = 0; n < (int)cl->step_note_count[sidx]; n++)
                    cl->step_notes[sidx][n] = (uint8_t)clamp_i(
                        (int)cl->step_notes[sidx][n] + delta, 0, 127);
                clip_migrate_to_notes(cl);
                if (!tr->recording) inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(q, "_set_notes")) {
                if (!cl->steps[sidx]) return 1;
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
                    for (i = 0; i < cnt; i++) {
                        cl->step_notes[sidx][i] = (uint8_t)notes[i];
                        /* Reset sub-step offset too — a replaced note must
                         * not inherit the previous note's InQ-Off timing. */
                        cl->note_tick_offset[sidx][i] = 0;
                    }
                    for (i = cnt; i < 8; i++) {
                        cl->step_notes[sidx][i] = 0;
                        cl->note_tick_offset[sidx][i] = 0;
                    }
                    clip_migrate_to_notes(cl);
                    if (!tr->recording) inst->state_dirty = 1;
                }
                return 1;
            }
            return 1;
        }
        /* tN_cC_dir "0..3": per-clip playback direction (remote UI). Unlike the
         * active-clip tN_clip_playback_dir sub, this targets the named clip. */
        if (!strcmp(p, "_dir")) {
            cl->playback_dir = (uint8_t)clamp_i(my_atoi(val), 0, 3);
            cl->pp_dir_state = initial_pp_dir(cl->playback_dir);
            if (cidx == (int)tr->active_clip) silence_track_from_set_param(inst, tr);
            rui_touch(inst);
            inst->state_dirty = 1;
            return 1;
        }

        if (!strncmp(p, "_length", 7) && p[7] == '\0') {
            int max_len = SEQ_STEPS - (int)cl->loop_start;
            if (max_len < 1) max_len = 1;
            cl->length = (uint16_t)clamp_i(my_atoi(val), 1, max_len);
            if (cidx == (int)tr->active_clip) {
                uint16_t le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= le)
                    tr->current_step = cl->loop_start;
                /* Anchor playhead to global tick during playback so phase
                 * stays consistent when length changes mid-playback (same
                 * idea as drum_lane_anchor_playhead). */
                if (inst->playing) {
                    uint16_t mtps  = cl->ticks_per_step > 0 ? cl->ticks_per_step
                                                             : (uint16_t)TICKS_PER_STEP;
                    uint32_t elapsed = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                       + (uint32_t)inst->master_tick_in_step;
                    uint32_t steps = elapsed / mtps;
                    tr->current_step = (uint16_t)(cl->loop_start + (steps % cl->length));
                    tr->tick_in_step = (uint16_t)(elapsed % mtps);
                }
            }
            clip_migrate_to_notes(cl);
            /* No rui bump while this track is live-recording: the adaptive
             * record path grows/locks the clip through this key, and each
             * rev bump makes the on-device JS run a full syncClipsFromDsp
             * (~1,540 sequential get_params at one per SPI frame ≈ 4.3 s of
             * frozen UI — the 2026-07-06 record-disarm hang). A remote
             * length edit on a track that is actively recording loses its
             * rev bump too; accepted (recorded notes never bumped rev
             * either, so live takes are already rev-invisible until the
             * next edit). */
            if (!tr->recording) rui_touch(inst);
            return 1;
        }
        if (!strncmp(p, "_loop_set", 9) && p[9] == '\0') {
            /* tN_cC_loop_set "packed" — atomic loop window write.
             * packed = loop_start * 65536 + length (both 1..256, sum <= SEQ_STEPS).
             * Single set_param to avoid the per-buffer coalescing hazard
             * that two separate keys would hit. */
            long packed = 0;
            const char *vp = val;
            while (*vp == ' ') vp++;
            while (*vp >= '0' && *vp <= '9') packed = packed * 10 + (*vp++ - '0');
            int ls  = (int)((packed >> 16) & 0xFFFF);
            int len = (int)(packed & 0xFFFF);
            if (len < 1) len = 1;
            if (ls  < 0) ls  = 0;
            if (ls > SEQ_STEPS - 1) ls = SEQ_STEPS - 1;
            if (ls + len > SEQ_STEPS) len = SEQ_STEPS - ls;
            cl->loop_start = (uint16_t)ls;
            cl->length     = (uint16_t)len;
            if (cidx == (int)tr->active_clip) {
                uint16_t le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= le)
                    tr->current_step = cl->loop_start;
                if (inst->playing) {
                    uint16_t mtps  = cl->ticks_per_step > 0 ? cl->ticks_per_step
                                                             : (uint16_t)TICKS_PER_STEP;
                    uint32_t elapsed = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                       + (uint32_t)inst->master_tick_in_step;
                    uint32_t steps = elapsed / mtps;
                    tr->current_step = (uint16_t)(cl->loop_start + (steps % cl->length));
                    tr->tick_in_step = (uint16_t)(elapsed % mtps);
                }
            }
            clip_migrate_to_notes(cl);
            inst->state_dirty = 1;
            return 1;
        }
        if (p[0] == '_' && p[1] == 'k' && p[2] >= '0' && p[2] <= '7') {
            int _kidx = p[2] - '0';
            cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
            if (!strcmp(p + 3, "_cc_loop_set")) {
                long packed = 0;
                const char *vp = val;
                while (*vp == ' ') vp++;
                while (*vp >= '0' && *vp <= '9') packed = packed * 10 + (*vp++ - '0');
                int ls  = (int)((packed >> 16) & 0xFFFF);
                int len = (int)(packed & 0xFFFF);
                if (len < 0) len = 0;
                if (ls < 0) ls = 0;
                if (ls > SEQ_STEPS - 1) ls = SEQ_STEPS - 1;
                if (len > 0 && ls + len > SEQ_STEPS) len = SEQ_STEPS - ls;
                _ca->lane_loop_start[_kidx] = (uint16_t)ls;
                _ca->lane_length[_kidx] = (uint16_t)len;
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p + 3, "_cc_lane_length")) {
                int len = (int)strtol(val, NULL, 10);
                if (len < 0) len = 0;
                uint16_t ls = _ca->lane_loop_start[_kidx];
                if (len > 0 && (int)ls + len > SEQ_STEPS) len = SEQ_STEPS - (int)ls;
                _ca->lane_length[_kidx] = (uint16_t)len;
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p + 3, "_cc_lane_tps")) {
                int tps_val = (int)strtol(val, NULL, 10);
                if (tps_val == 0) {
                    _ca->lane_tps[_kidx] = 0;
                } else {
                    int vi, valid = 0;
                    for (vi = 0; vi < 6; vi++)
                        if (tps_val == (int)TPS_VALUES[vi]) { valid = 1; break; }
                    _ca->lane_tps[_kidx] = valid ? (uint16_t)tps_val : 0;
                }
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p + 3, "_cc_lane_res_tps")) {
                int tps_val = (int)strtol(val, NULL, 10);
                if (tps_val == 0) {
                    _ca->lane_res_tps[_kidx] = 0;
                } else {
                    int vi, valid = 0;
                    for (vi = 0; vi < 6; vi++)
                        if (tps_val == (int)TPS_VALUES[vi]) { valid = 1; break; }
                    _ca->lane_res_tps[_kidx] = valid ? (uint16_t)tps_val : 0;
                }
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p + 3, "_cc_lane_reset")) {
                undo_begin_single(inst, tidx, cidx);
                _ca->lane_loop_start[_kidx] = 0;
                _ca->lane_length[_kidx] = 0;
                _ca->lane_tps[_kidx] = 0;
                _ca->lane_res_tps[_kidx] = 0;
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p + 3, "_cc_lane_double_fill")) {
                undo_begin_single(inst, tidx, cidx);
                uint16_t _old_len = _ca->lane_length[_kidx];
                if (_old_len == 0) _old_len = cl->length;
                uint16_t _ltps = _ca->lane_tps[_kidx] > 0
                               ? _ca->lane_tps[_kidx] : cl->ticks_per_step;
                uint32_t _half_ticks = (uint32_t)_old_len * _ltps;
                uint16_t _new_len = (uint16_t)(_old_len * 2);
                if (_new_len > SEQ_STEPS) return 1;
                int _n = (int)_ca->count[_kidx];
                /* Add seam point at the boundary: evaluate what the loop
                 * would produce at the last tick of the first half, so the
                 * wrap-back transition is captured as an explicit point. */
                if (_n > 0 && _n < CC_AUTO_MAX_POINTS) {
                    uint32_t _seam_t = _half_ticks > 0 ? _half_ticks - 1 : 0;
                    int _has_seam = 0, _si;
                    for (_si = 0; _si < _n; _si++)
                        if (_ca->ticks[_kidx][_si] == (uint16_t)_seam_t) { _has_seam = 1; break; }
                    if (!_has_seam) {
                        int _def;
                        int _sv = cc_auto_eval(_ca, _kidx, _seam_t, 0, _half_ticks, &_def);
                        if (_def && _sv >= 0 && _sv <= 127) {
                            cc_auto_set_point(_ca, _kidx, (uint16_t)_seam_t, (uint8_t)_sv);
                            _n = (int)_ca->count[_kidx];
                        }
                    }
                }
                int _added = 0;
                int _orig_n = _n;
                for (int _i = 0; _i < _orig_n && _n + _added < CC_AUTO_MAX_POINTS; _i++) {
                    uint16_t _ot = _ca->ticks[_kidx][_i];
                    if (_ot >= _half_ticks) continue;
                    uint32_t _nt = (uint32_t)_ot + _half_ticks;
                    if (_nt > 65535) continue;
                    _ca->ticks[_kidx][_n + _added] = (uint16_t)_nt;
                    _ca->vals[_kidx][_n + _added]  = _ca->vals[_kidx][_i];
                    _added++;
                }
                _ca->count[_kidx] = (uint16_t)(_n + _added);
                /* Sort the combined array (insertion sort — small N) */
                { int _total = (int)_ca->count[_kidx];
                  int _j;
                  for (_j = 1; _j < _total; _j++) {
                      uint16_t _kt = _ca->ticks[_kidx][_j];
                      uint8_t  _kv = _ca->vals[_kidx][_j];
                      int _jj = _j - 1;
                      while (_jj >= 0 && _ca->ticks[_kidx][_jj] > _kt) {
                          _ca->ticks[_kidx][_jj + 1] = _ca->ticks[_kidx][_jj];
                          _ca->vals[_kidx][_jj + 1]  = _ca->vals[_kidx][_jj];
                          _jj--;
                      }
                      _ca->ticks[_kidx][_jj + 1] = _kt;
                      _ca->vals[_kidx][_jj + 1]  = _kv;
                  }
                }
                _ca->lane_length[_kidx] = _new_len;
                inst->state_dirty = 1;
                return 1;
            }
        }
        if (!strncmp(p, "_pfx_set", 8) && p[8] == '\0') {
            /* tN_cC_pfx_set "key value" — apply pfx param to this clip's
             * pfx_params (any clip, not just active). Mirrors drum-lane
             * pfx_set but targets melodic per-clip pfx_params. */
            const char *sp = val;
            char pfx_key[64]; int ki = 0;
            while (*sp && *sp != ' ' && ki < 63) pfx_key[ki++] = *sp++;
            pfx_key[ki] = '\0';
            while (*sp == ' ') sp++;
            pfx_set(inst, tr, &cl->pfx_params, pfx_key, sp);
            if ((int)tr->active_clip == cidx)
                pfx_sync_from_clip(tr);
            rui_touch(inst);
            inst->state_dirty = 1;
            return 1;
        }
        /* Conductor per-clip control banks. Payload "<trackIdx> <value>".
         * Phase 2: storage only — no transposition behavior yet. */
        if (!strcmp(p, "_cond_resp")) {
            int ti = my_atoi(val);
            const char *vp = val;
            while (*vp && *vp != ' ') vp++;
            int vv = (*vp == ' ') ? my_atoi(vp + 1) : 0;
            if (ti >= 0 && ti < NUM_TRACKS)
                cl->cond_resp[ti] = (uint8_t)(vv ? 1 : 0);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(p, "_cond_lock")) {
            cl->cond_lock = (uint8_t)(my_atoi(val) ? 1 : 0);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(p, "_cond_oct")) {
            int ti = my_atoi(val);
            const char *vp = val;
            while (*vp && *vp != ' ') vp++;
            int vv = (*vp == ' ') ? my_atoi(vp + 1) : 0;
            if (ti >= 0 && ti < NUM_TRACKS)
                cl->cond_oct[ti] = (int8_t)clamp_i(vv, -4, 4);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(p, "_cond_when")) {
            int ti = my_atoi(val);
            const char *vp = val;
            while (*vp && *vp != ' ') vp++;
            int vv = (*vp == ' ') ? my_atoi(vp + 1) : 0;
            if (ti >= 0 && ti < NUM_TRACKS)
                cl->cond_when[ti] = (uint8_t)(vv ? 1 : 0);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strncmp(p, "_clear", 6) && p[6] == '\0') {
            /* tN_cC_clear — wipe step data in clip.
             * Preserves: length, loop_start, ticks_per_step, stretch_exp,
             * clock_shift_pos, nudge_pos, and pfx_params. Only step note
             * data is wiped. Hard Reset (_hard_reset) is the gesture that
             * wipes structure too. */
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
            cl->active     = 0;
            cl->note_count = 0;
            memset(cl->notes, 0, sizeof(cl->notes));
            cl->occ_dirty = 1;
            /* Clip clear also removes all automation (CC + AT, + PB later). */
            cc_auto_reset(&tr->clip_cc_auto[cidx]);
            at_auto_reset(&tr->clip_at_auto[cidx]);
            memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
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
            inst->state_dirty = 1;
            return 1;
        }
        if (!strncmp(p, "_clear_keep", 11) && p[11] == '\0') {
            /* tN_cC_clear_keep — wipe step data, preserve playback state.
             * Same preserve list as _clear (length, loop_start, tps, stretch,
             * clock_shift, nudge, pfx) — only step note data is wiped. The
             * difference vs _clear is that clip_playing / queued / armed
             * state stay put so the focused clip keeps ticking through. */
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
            cl->active     = 0;
            cl->note_count = 0;
            memset(cl->notes, 0, sizeof(cl->notes));
            cl->occ_dirty = 1;
            /* Clip clear also removes all automation (CC + AT, + PB later). */
            cc_auto_reset(&tr->clip_cc_auto[cidx]);
            at_auto_reset(&tr->clip_at_auto[cidx]);
            memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
            silence_track_notes_v2(inst, tr);
            pfx_sync_from_clip(tr);
            tr->rec_pending_count = 0;
            tr->recording = 0;
            if (tr->queued_clip == cidx) tr->queued_clip = -1;
            inst->state_dirty = 1;
            { char _zb[160]; snprintf(_zb, sizeof(_zb),
                "Z3 _clear_keep DONE t%d c%d nc_after=%u rec=%d",
                tidx, cidx, (unsigned)cl->note_count, (int)tr->recording);
              seq8_ilog(inst, _zb); }
            return 1;
        }
        if (!strncmp(p, "_hard_reset", 11) && p[11] == '\0') {
            /* tN_cC_hard_reset — full factory reset: undo snapshot, silence, clip_init */
            undo_begin_single(inst, tidx, cidx);
            silence_track_notes_v2(inst, tr);
            clip_init(cl);
            cc_auto_reset(&tr->clip_cc_auto[cidx]);
            at_auto_reset(&tr->clip_at_auto[cidx]);
            if ((int)tr->active_clip == cidx)
                pfx_sync_from_clip(tr);
            tr->rec_pending_count = 0;
            tr->recording = 0;
            if (tr->queued_clip == cidx) tr->queued_clip = -1;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strncmp(p, "_at_clear", 9) && p[9] == '\0') {
            /* tN_cC_at_clear — wipe this clip's pad-pressure aftertouch automation. */
            undo_begin_single(inst, tidx, cidx);
            at_auto_reset(&tr->clip_at_auto[cidx]);
            memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strncmp(p, "_drum_clear", 11) && p[11] == '\0') {
            /* tN_cC_drum_clear val="0"=deactivate|"1"=keep transport
             * Clears all lane step data in clip C; midi_note/length/tps/pfx preserved */
            int keep = my_atoi(val);
            int l, s;
            drum_clip_t *dc = tr->drum_clips[cidx];
            if (!dc) return 1;
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
            inst->state_dirty = 1;
            return 1;
        }
        if (!strncmp(p, "_drum_reset", 11) && p[11] == '\0') {
            /* tN_cC_drum_reset — factory reset all lanes in clip C
             * clip_init on each lane's clip_t; midi_note preserved (sibling field in drum_lane_t) */
            int l;
            drum_clip_t *dc = tr->drum_clips[cidx];
            if (!dc) return 1;
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
            inst->state_dirty = 1;
            return 1;
        }
        return 1;  /* clip key, unknown sub-op: CONSUME (never leak to pfx catch-all) */
    }

    return 0;  /* not a clip key: fall through to sibling tN_ handlers */
}
