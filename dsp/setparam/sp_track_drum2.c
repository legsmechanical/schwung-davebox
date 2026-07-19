/* FILE-SCOPE HANDLER for set_param()'s tN_ drum keys -- part of the seq8.c
 * single translation unit; #included at FILE scope by seq8_set_param.c
 * (immediately before set_param), NOT a standalone TU; never compile or lint
 * this file on its own. Eighth Stage B handler (phase 4B group 8): the former
 * mid-function segment is now a real static int sp_track_drum2(sp_ctx_t *).
 * Covers tN_ track keys: drum config, all-lanes transforms, drum
 * perform/repeat/repeat2, drum record (drum_mute_all_clear ...
 * drum_record_note_off). See also sp_track_drum.c (the tN_lL_* per-lane
 * setters, incl. the nested lane step parser).
 * Returns 1 when it handled the key (caller returns), 0 to fall through to
 * the sibling tN_ handlers. The tN_ guard and the tidx/sub/tr locals live in
 * the parent dispatcher now (seq8_set_param.c). */
static int sp_track_drum2(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    if (!strcmp(sub, "drum_mute_all_clear")) {
        /* tN_drum_mute_all_clear: unmute and unsolo all drum lanes. */
        tr->drum_lane_mute = 0;
        tr->drum_lane_solo = 0;
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "diq")) {
        /* tN_diq "value" — per-track drum input quantize: 0=Off, 1-8 = index into DRUM_INQ_TICKS */
        tr->drum_inp_quant = (uint8_t)clamp_i(my_atoi(val), 0, 8);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "drum_repeat_sync")) {
        /* tN_drum_repeat_sync "value" — per-track drum repeat sync: 0=Off, 1=On */
        tr->drum_repeat_sync = (uint8_t)clamp_i(my_atoi(val), 0, 1);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "drum_lanes_qnt")) {
        /* tN_drum_lanes_qnt "value" — set NoteFX quantize on all 32 lanes of active drum clip. */
        int v = clamp_i(my_atoi(val), 0, 100);
        drum_clip_t *dc = tr->drum_clips[tr->active_clip];
        if (!dc) return 1;
        int l;
        for (l = 0; l < DRUM_LANES; l++) {
            dc->lanes[l].pfx_params.quantize = v;
            drum_pfx_apply_params(&tr->drum_lane_pfx[l], &dc->lanes[l].pfx_params);
        }
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_clip_resolution")) {
        /* tN_all_lanes_clip_resolution "idx" — set resolution on all 32 drum lanes. */
        int idx = clamp_i(my_atoi(val), 0, 5);
        uint16_t new_tps = TPS_VALUES[idx];
        drum_clip_t *dc_ar = tr->drum_clips[tr->active_clip];
        if (!dc_ar) return 1;
        int l_ar;
        for (l_ar = 0; l_ar < DRUM_LANES; l_ar++) {
            clip_t *dlc = &dc_ar->lanes[l_ar].clip;
            uint16_t old_tps = dlc->ticks_per_step;
            if (new_tps == old_tps) continue;
            { uint32_t gmax = (uint32_t)SEQ_STEPS * new_tps;
              if (gmax > 65535) gmax = 65535;
              uint16_t ni;
              for (ni = 0; ni < dlc->note_count; ni++) {
                  note_t *n = &dlc->notes[ni];
                  n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                  uint32_t ng = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                  if (ng < 1) ng = 1;
                  if (ng > gmax) ng = gmax;
                  n->gate = (uint16_t)ng;
              }
            }
            dlc->ticks_per_step = new_tps;
            if (old_tps > 0)
                tr->drum_tick_in_step[l_ar] =
                    (uint32_t)((uint64_t)tr->drum_tick_in_step[l_ar] * new_tps / old_tps);
            if (tr->drum_tick_in_step[l_ar] >= new_tps)
                tr->drum_tick_in_step[l_ar] = 0;
            clip_build_steps_from_notes(dlc);
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_playback_dir")) {
        /* tN_all_lanes_playback_dir "value" — set playback direction on all 32 drum lanes. */
        int v = clamp_i(my_atoi(val), 0, 3);
        drum_clip_t *dc_ad = tr->drum_clips[tr->active_clip];
        if (!dc_ad) return 1;
        int l_ad;
        for (l_ad = 0; l_ad < DRUM_LANES; l_ad++) {
            dc_ad->lanes[l_ad].clip.playback_dir = (uint8_t)v;
            dc_ad->lanes[l_ad].clip.pp_dir_state = initial_pp_dir((uint8_t)v);
        }
        silence_track_from_set_param(inst, tr);
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_playback_audio_reverse")) {
        /* tN_all_lanes_playback_audio_reverse "value" — set audio reverse on all 32 drum lanes. */
        int v = clamp_i(my_atoi(val), 0, 1);
        drum_clip_t *dc_av = tr->drum_clips[tr->active_clip];
        if (!dc_av) return 1;
        int l_av;
        for (l_av = 0; l_av < DRUM_LANES; l_av++) {
            dc_av->lanes[l_av].clip.playback_audio_reverse = (uint8_t)v;
        }
        /* No rui_mark: playback_audio_reverse is not emitted by the snapshot
         * (matches the single-lane _playback_audio_reverse handler, skipped in
         * the f3ceff1 sweep). Bumping rev here forces a spurious re-read. */
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_beat_stretch")) {
        /* tN_all_lanes_beat_stretch "dir" — stretch/shrink all 32 drum lanes.
         * Pre-flight: if ANY lane is blocked, no-op entirely and set result=-1. */
        int dir = my_atoi(val);
        drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
        if (!dc_al) return 1;
        int l_al;
        /* Pre-flight: check all lanes before modifying any */
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc_pf = &dc_al->lanes[l_al].clip;
            int len_pf = (int)dlc_pf->length;
            if (dir == 1) {
                if (len_pf * 2 > SEQ_STEPS) { inst->all_lanes_stretch_result = -1; return 1; }
            } else {
                if (len_pf < 2) { inst->all_lanes_stretch_result = -1; return 1; }
                /* Check note collision: two active steps would map to same compressed slot */
                int i_pf;
                uint8_t seen_pf[SEQ_STEPS];
                memset(seen_pf, 0, sizeof(seen_pf));
                for (i_pf = 0; i_pf < len_pf; i_pf++) {
                    if (dlc_pf->steps[i_pf]) {
                        int dst_pf = i_pf / 2;
                        if (seen_pf[dst_pf]) { inst->all_lanes_stretch_result = -1; return 1; }
                        seen_pf[dst_pf] = 1;
                    }
                }
            }
        }
        inst->all_lanes_stretch_result = 1;
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc = &dc_al->lanes[l_al].clip;
            int len = (int)dlc->length;
            int i, ni2, new_len, any;
            uint8_t  tmp_steps[SEQ_STEPS];
            uint8_t  tmp_notes[SEQ_STEPS][8];
            uint8_t  tmp_nc[SEQ_STEPS];
            uint8_t  tmp_vel[SEQ_STEPS];
            uint16_t tmp_gate[SEQ_STEPS];
            int16_t  tmp_tick_offset[SEQ_STEPS][8];
            int gmax_bs = SEQ_STEPS * dlc->ticks_per_step; if (gmax_bs > 65535) gmax_bs = 65535;
            int off_clamp = dlc->ticks_per_step - 1;
            if (dir == 1) {
                if (len * 2 > SEQ_STEPS) continue;
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
            } else {
                if (len < 2) continue;
                { uint8_t seen[SEQ_STEPS];
                  memset(seen, 0, sizeof(seen));
                  int blocked = 0;
                  for (i = 0; i < len; i++) {
                      if (dlc->steps[i]) {
                          int dst = i / 2;
                          if (seen[dst]) { blocked = 1; break; }
                          seen[dst] = 1;
                      }
                  }
                  if (blocked) continue;
                }
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
            {
                uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                if (tr->drum_current_step[l_al] < dlc->loop_start
                        || tr->drum_current_step[l_al] >= _le)
                    tr->drum_current_step[l_al] = dlc->loop_start;
            }
            any = 0;
            for (i = 0; i < (int)dlc->length; i++)
                if (dlc->steps[i]) { any = 1; break; }
            dlc->active = (uint8_t)any;
            clip_migrate_to_notes(dlc);
            /* Suppress notes already passed this loop pass so they don't double-fire
             * (stretch moves notes to later ticks; without this they fire twice). */
            if (tr->clip_playing) {
                uint32_t cct = (uint32_t)tr->drum_current_step[l_al]
                               * (uint32_t)dlc->ticks_per_step
                               + tr->drum_tick_in_step[l_al];
                int qnt = dc_al->lanes[l_al].pfx_params.quantize;
                uint16_t ni2;
                for (ni2 = 0; ni2 < dlc->note_count; ni2++) {
                    note_t *n = &dlc->notes[ni2];
                    if (effective_note_tick(n, dlc, qnt) < cct)
                        n->suppress_until_wrap = 1;
                }
            }
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_clock_shift")) {
        /* tN_all_lanes_clock_shift "dir" — rotate all 32 drum lanes by one step. */
        int dir = my_atoi(val);
        drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
        if (!dc_al) return 1;
        int l_al;
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc = &dc_al->lanes[l_al].clip;
            int len = (int)dlc->length;
            if (len < 2) continue;
            uint8_t tmp_s, tmp_nc2, tmp_ns[8], tmp_v;
            uint16_t tmp_g;
            int16_t tmp_toff[8];
            if (dir == 1) {
                tmp_s  = dlc->steps[len-1];
                memcpy(tmp_ns, dlc->step_notes[len-1], 8);
                tmp_nc2 = dlc->step_note_count[len-1];
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
                dlc->step_note_count[0] = tmp_nc2;
                dlc->step_vel[0] = tmp_v;
                dlc->step_gate[0] = tmp_g;
                memcpy(dlc->note_tick_offset[0], tmp_toff, 8 * sizeof(int16_t));
                dlc->clock_shift_pos = (uint16_t)((dlc->clock_shift_pos + 1) % (uint16_t)len);
            } else {
                tmp_s  = dlc->steps[0];
                memcpy(tmp_ns, dlc->step_notes[0], 8);
                tmp_nc2 = dlc->step_note_count[0];
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
                dlc->step_note_count[len-1] = tmp_nc2;
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
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_nudge")) {
        /* tN_all_lanes_nudge "dir" — nudge all 32 drum lanes; dir=0 resets nudge_pos. */
        int dir = my_atoi(val);
        drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
        if (!dc_al) return 1;
        int l_al;
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc = &dc_al->lanes[l_al].clip;
            if (dir == 0) { dlc->nudge_pos = 0; continue; }
            if (dir != 1 && dir != -1) continue;
            int len = (int)dlc->length;
            if (len < 1) continue;
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
                    if (new_off >= midpoint) {
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
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_length")) {
        /* tN_all_lanes_length "steps" — set clip length on all 32 drum lanes.
         * Per-lane clamp respects each lane's own loop_start; re-anchor to
         * global tick during playback so cross-lane phase stays in sync. */
        int reqlen = my_atoi(val);
        drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
        if (!dc_al) return 1;
        int l_al;
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc = &dc_al->lanes[l_al].clip;
            int max_len = SEQ_STEPS - (int)dlc->loop_start;
            if (max_len < 1) max_len = 1;
            int newlen = clamp_i(reqlen, 1, max_len);
            dlc->length = (uint16_t)newlen;
            uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
            if (tr->drum_current_step[l_al] < dlc->loop_start
                    || tr->drum_current_step[l_al] >= le)
                tr->drum_current_step[l_al] = dlc->loop_start;
            if (inst->playing)
                drum_lane_anchor_playhead(inst, tr, l_al, dlc);
            clip_migrate_to_notes(dlc);
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_loop_set")) {
        /* tN_all_lanes_loop_set "packed" — atomic loop window write across all
         * 32 drum lanes of the active drum clip. Mirrors tN_lL_loop_set
         * semantics on every lane. */
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
        drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
        if (!dc_al) return 1;
        int l_al;
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc = &dc_al->lanes[l_al].clip;
            dlc->loop_start = (uint16_t)ls;
            dlc->length     = (uint16_t)len;
            uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
            if (tr->drum_current_step[l_al] < dlc->loop_start
                    || tr->drum_current_step[l_al] >= le)
                tr->drum_current_step[l_al] = dlc->loop_start;
            if (inst->playing)
                drum_lane_anchor_playhead(inst, tr, l_al, dlc);
            clip_migrate_to_notes(dlc);
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "all_lanes_double_fill")) {
        /* tN_all_lanes_double_fill — double-and-fill all 32 drum lanes. */
        drum_clip_t *dc_al = tr->drum_clips[tr->active_clip];
        if (!dc_al) return 1;
        int l_al, i;
        undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
        for (l_al = 0; l_al < DRUM_LANES; l_al++) {
            clip_t *dlc = &dc_al->lanes[l_al].clip;
            int len = (int)dlc->length;
            if (len * 2 > SEQ_STEPS) continue;
            for (i = 0; i < len; i++) {
                dlc->steps[len + i]           = dlc->steps[i];
                memcpy(dlc->step_notes[len + i], dlc->step_notes[i], 8);
                dlc->step_note_count[len + i] = dlc->step_note_count[i];
                dlc->step_vel[len + i]        = dlc->step_vel[i];
                dlc->step_gate[len + i]       = dlc->step_gate[i];
                memcpy(dlc->note_tick_offset[len + i], dlc->note_tick_offset[i], 8 * sizeof(int16_t));
            }
            dlc->length = (uint16_t)(len * 2);
            {
                uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                if (tr->drum_current_step[l_al] < dlc->loop_start
                        || tr->drum_current_step[l_al] >= _le)
                    tr->drum_current_step[l_al] = dlc->loop_start;
            }
            clip_migrate_to_notes(dlc);
        }
        rui_mark(inst, tidx, (int)tr->active_clip);
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(sub, "active_drum_lane")) {
        /* Bundle 2A: JS mirror of S.activeDrumLane[t]. Pushed at every
         * mutation site in ui.js (8 sites) + init + sidecar restore.
         * Read by on_midi.drum_pad_event for vel-pad preview. */
        int lane_adl = atoi(val);
        tr->active_drum_lane = (uint8_t)clamp_i(lane_adl, 0, DRUM_LANES - 1);
        return 1;
    }

    if (!strcmp(sub, "delete_held")) {
        /* Phase 1 / Bundle 2C-Rpt2: Delete-held edge push. JS sends
         * a SINGLE push (carrier key shape is tN_delete_held — any
         * tN works) on every Delete CC edge. Writes to the GLOBAL
         * inst->delete_held since Delete is a global modifier, not
         * per-track. Earlier fan-out of 8 calls (one per track)
         * coalesced — only the last N reached DSP. drum_pad_event
         * reads inst->delete_held to bail before classifying;
         * mirrors JS's "bail on Delete-held" pad-handler branches. */
        inst->delete_held = (uint8_t)(my_atoi(val) ? 1 : 0);
        return 1;
    }

    if (!strcmp(sub, "drum_lane_page")) {
        /* Phase 1 / Bundle 2C-Rpt2: JS mirror of S.drumLanePage[t].
         * Used by drum_pad_event to translate left-half padIdx →
         * absolute drum lane index for Rpt2 lane-pad classification
         * and for Rpt1 lane-swap-while-holding. Pushed by JS on every
         * page change (Up/Down arrow on drum track + init + sidecar
         * restore). */
        int page_dlp = atoi(val);
        tr->drum_lane_page = (uint8_t)clamp_i(page_dlp, 0, (DRUM_LANES + 15) / 16 - 1);
        return 1;
    }

    if (!strcmp(sub, "drum_perform_mode")) {
        /* Bundle 2A: JS mirror of S.drumPerformMode[t] (0=NORMAL,
         * 1=Rpt1, 2=Rpt2). Pushed via setDrumPerformMode helper
         * (2 mutation sites in ui.js). on_midi.drum_pad_event gates
         * the vel-zone preview branch on this — Rpt modes leave the
         * right-pad classifier to JS (Bundle 2C will move it). */
        int mode_dpm = atoi(val);
        tr->drum_perform_mode = (uint8_t)clamp_i(mode_dpm, 0, 2);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat_start")) {
        /* tN_drum_repeat_start "lane rate_idx vel" — activate repeat for a drum lane.
         * Phase 1 / Bundle 2C: delegates to drum_repeat_start_internal so the
         * on_midi path (drum_pad_event) and set_param path share one body. */
        const char *sp = val;
        while (*sp == ' ') sp++;
        int lane_r = 0;
        while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
        while (*sp == ' ') sp++;
        int rate_r = 0;
        while (*sp >= '0' && *sp <= '9') { rate_r = rate_r * 10 + (*sp++ - '0'); }
        while (*sp == ' ') sp++;
        int vel_r = 100;
        if (*sp >= '0' && *sp <= '9') {
            vel_r = 0;
            while (*sp >= '0' && *sp <= '9') { vel_r = vel_r * 10 + (*sp++ - '0'); }
        }
        drum_repeat_start_internal(inst, tr, lane_r, rate_r, vel_r);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat_vel")) {
        /* tN_drum_repeat_vel "vel" — update repeat velocity from pad pressure */
        tr->drum_repeat_vel = (uint8_t)clamp_i(my_atoi(val), 1, 127);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat_stop")) {
        /* tN_drum_repeat_stop — deactivate repeat; also clears latch mirror */
        drum_repeat_stop_internal(tr);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat_lane")) {
        /* tN_drum_repeat_lane "lane" — switch active lane without resetting phase/step */
        drum_repeat_lane_internal(tr, my_atoi(val));
        return 1;
    }

    if (!strcmp(sub, "drum_repeat_latched")) {
        /* Phase 1 / Bundle 2C: JS one-shot edge push. Set to 1 immediately
         * after firing tN_drum_repeat_start when Loop is held at press time.
         * drum_repeat_start_internal clears this back to 0 on every start,
         * so JS never needs to push the 0-edge — set_param ordering across
         * latched/unlatched transitions is self-cleaning. drum_pad_event
         * reads this to detect "re-tap of latched pad = stop NOW" on the
         * audio thread, avoiding the JS-tick race that would otherwise
         * fire one extra repeat at fast rates. */
        tr->drum_repeat_latched = (uint8_t)(my_atoi(val) ? 1 : 0);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_lane_on")) {
        /* tN_drum_repeat2_lane_on "lane vel" — add lane; uses lane's stored rate.
         * Phase 1 / Bundle 2C-Rpt2: delegates to drum_repeat2_lane_on_internal
         * so the on_midi path (drum_pad_event) and set_param path share one body. */
        const char *sp = val;
        while (*sp == ' ') sp++;
        int lane_r = 0;
        while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
        while (*sp == ' ') sp++;
        int vel_r = 100;
        if (*sp >= '0' && *sp <= '9') {
            vel_r = 0;
            while (*sp >= '0' && *sp <= '9') { vel_r = vel_r * 10 + (*sp++ - '0'); }
        }
        drum_repeat2_lane_on_internal(inst, tr, lane_r, vel_r);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_lane_off")) {
        /* tN_drum_repeat2_lane_off "lane" — remove lane from active+pending+latched bitmasks */
        drum_repeat2_lane_off_internal(tr, my_atoi(val));
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_rate")) {
        /* tN_drum_repeat2_rate "lane rate_idx" — set per-lane rate */
        const char *sp = val;
        while (*sp == ' ') sp++;
        int lane_r = 0;
        while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
        while (*sp == ' ') sp++;
        int rate_r = 0;
        while (*sp >= '0' && *sp <= '9') { rate_r = rate_r * 10 + (*sp++ - '0'); }
        drum_repeat2_rate_internal(tr, lane_r, rate_r);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_latch_held")) {
        /* Phase 1 / Bundle 2C-Rpt2: atomic "latch every currently
         * held/pending lane." JS fires this when Loop is tapped while
         * lanes are held (replaces a per-lane push loop that was
         * coalescing on its shared key). DSP-side OR of active+pending
         * into latched bitmask captures every engaged lane regardless
         * of InQ boundary state. */
        tr->drum_repeat2_latched_lanes |= tr->drum_repeat2_active;
        tr->drum_repeat2_latched_lanes |= tr->drum_repeat2_pending;
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_lane_latched")) {
        /* Phase 1 / Bundle 2C-Rpt2: JS one-shot per-lane edge push,
         * "<lane> <0|1>". JS fires the 1-edge immediately after a
         * Loop-held lane-pad press. drum_repeat2_lane_on_internal
         * clears the lane's bit on every lane-on so JS doesn't push
         * 0-edges. drum_pad_event reads this bitmask on lane-pad
         * press to detect "re-tap of latched lane = lane_off NOW"
         * synchronously on the audio thread, closing the JS-tick
         * race that could otherwise fire extra repeats at fast rates. */
        const char *sp = val;
        while (*sp == ' ') sp++;
        int lane_r = 0;
        while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
        lane_r = clamp_i(lane_r, 0, DRUM_LANES - 1);
        while (*sp == ' ') sp++;
        int on = (*sp >= '0' && *sp <= '9') ? my_atoi(sp) : 0;
        if (on)
            tr->drum_repeat2_latched_lanes |=  (1u << (unsigned)lane_r);
        else
            tr->drum_repeat2_latched_lanes &= ~(1u << (unsigned)lane_r);
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_stop")) {
        /* tN_drum_repeat2_stop — clear all active Rpt2 lanes (and any pending).
         * Bundle 2C-Rpt2: also clears the latched-lanes bitmask. */
        tr->drum_repeat2_active        = 0;
        tr->drum_repeat2_pending       = 0;
        tr->drum_repeat2_latched_lanes = 0;
        return 1;
    }

    if (!strcmp(sub, "drum_repeat2_vel")) {
        /* tN_drum_repeat2_vel "lane vel" — update per-lane velocity (aftertouch) */
        const char *sp = val;
        while (*sp == ' ') sp++;
        int lane_r = 0;
        while (*sp >= '0' && *sp <= '9') { lane_r = lane_r * 10 + (*sp++ - '0'); }
        lane_r = clamp_i(lane_r, 0, DRUM_LANES - 1);
        while (*sp == ' ') sp++;
        int vel_r = 100;
        if (*sp >= '0' && *sp <= '9') {
            vel_r = 0;
            while (*sp >= '0' && *sp <= '9') { vel_r = vel_r * 10 + (*sp++ - '0'); }
        }
        tr->drum_repeat2_vel[lane_r] = (uint8_t)clamp_i(vel_r, 1, 127);
        return 1;
    }

    if (!strcmp(sub, "drum_record_note_on")) {
        /* tN_drum_record_note_on "p1 v1 [p2 v2 ...]"
         * JS batches all queued drum note-ons for the recordArmedTrack into
         * one call so a chord-press lands in DSP within a single audio
         * buffer (previously trickled one-per-tick via .shift()).
         * Each pitch routes to the drum lane whose midi_note matches and
         * inserts a step hit at that lane's current playback position.
         * Gate initially GATE_TICKS; updated to actual hold time on
         * drum_record_note_off. */
        if (!tr->recording) return 1;
        {
            int ac = (int)tr->active_clip;
            drum_clip_t *dc = tr->drum_clips[ac];
            if (!dc) return 1;
            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;
                /* Per-note ext-origin marker: "e<pitch>" = external
                 * cable-2 MIDI; bare "<pitch>" = pad. Batches can MIX
                 * pad+ext hits, hence per-note not per-batch. */
                int ext = 0;
                if (*sp == 'e') { ext = 1; sp++; }
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
                /* Find lane by matching midi_note */
                int lane = -1;
                { int l; for (l = 0; l < DRUM_LANES; l++) {
                    if (dc->lanes[l].midi_note == (uint8_t)pitch) { lane = l; break; }
                }}
                if (lane >= 0) {
                clip_t   *dlc  = &dc->lanes[lane].clip;
                /* PHASE-1: prefer the audio-thread press snapshot for this
                 * lane's (step, tick_in_step). Uniform rule under inbound
                 * (mirrors record_note_on):
                 *   slot active → use + consume (pads any route; ROUTE_MOVE
                 *     ext, whose Move echo reaches on_midi);
                 *   slot inactive + PAD → drop (press was filtered by
                 *     on_midi, e.g. outside the preroll capture window);
                 *   slot inactive + EXT (any route) → live playhead
                 *     fallback: external notes have no on_midi note slot.
                 *     Non-ROUTE_MOVE ext never reaches on_midi (shim BLOCK);
                 *     ROUTE_MOVE ext is played natively by Move but its
                 *     note-on/off is NOT echoed to MIDI_OUT (only continuous
                 *     controllers — device diagnosis 2026-07-11), so no note
                 *     echo stamps a slot there either. Count-in filtering
                 *     for ext lives in JS. A slot only appears via a future
                 *     host MIDI_IN→on_midi note delivery (Option B).
                 * Stock Schwung uses the live drum playhead. */
                uint16_t base_step;
                int16_t  base_off;
                if (inst->dsp_inbound_enabled) {
                    if (inst->on_midi_drum_press_active[tidx][lane]) {
                        base_step = inst->on_midi_drum_press_step[tidx][lane];
                        base_off  = inst->on_midi_drum_press_off[tidx][lane];
                        inst->on_midi_drum_press_active[tidx][lane] = 0;
                    } else if (ext) {
                        base_step = tr->drum_current_step[lane];
                        base_off  = (int16_t)tr->drum_tick_in_step[lane];
                    } else {
                        continue;  /* pad with no slot: on_midi filtered it */
                    }
                } else {
                    base_step = tr->drum_current_step[lane];
                    base_off  = (int16_t)tr->drum_tick_in_step[lane];
                }
                uint16_t step = base_step;
                int16_t  off  = base_off;
                uint8_t  diq  = tr->drum_inp_quant;
                /* Window-aware wrap: base_step lives in
                 * [loop_start, loop_start+length); wrapping past the
                 * window end must return to loop_start, not 0. */
                uint16_t _we = (uint16_t)(dlc->loop_start + dlc->length);
                if (off >= (int16_t)(TICKS_PER_STEP / 2)) {
                    uint16_t ns = (uint16_t)(step + 1);
                    if (ns >= _we) ns = dlc->loop_start;
                    step = ns;
                    off -= (int16_t)TICKS_PER_STEP;
                }

                if (diq > 0) {
                    /* Quantize global tick position so InQ values coarser
                     * than 1/16 (qt > TICKS_PER_STEP) snap to multi-step
                     * boundaries instead of collapsing to the current step
                     * (the prior per-step-only math always produced sn=0
                     * for qt > TICKS_PER_STEP). */
                    int qt = (int)DRUM_INQ_TICKS[diq];
                    int abs_tick = (int)base_step * (int)TICKS_PER_STEP + (int)base_off;
                    int sn_abs = ((abs_tick + qt / 2) / qt) * qt;
                    int sn_step = sn_abs / (int)TICKS_PER_STEP;
                    int sn_off  = sn_abs - sn_step * (int)TICKS_PER_STEP;
                    /* Window wrap: if quantize lands outside the loop
                     * window, fall back to loop_start step boundary. */
                    if (sn_step < (int)dlc->loop_start || sn_step >= (int)_we) {
                        sn_step = (int)dlc->loop_start;
                        sn_off  = 0;
                    }
                    step = (uint16_t)sn_step;
                    off  = (int16_t)sn_off;
                }
                if (step < _we && dlc->step_note_count[step] == 0) {
                    dlc->step_notes[step][0]       = (uint8_t)pitch;
                    dlc->step_note_count[step]     = 1;
                    dlc->step_vel[step]            = (uint8_t)vel;
                    dlc->step_gate[step]           = (uint16_t)GATE_TICKS;
                    /* Timing snap: per-track InQ takes priority over global inp_quant.
                     * InQ: nearest quant boundary within step (rounds to nearest multiple).
                     * global inp_quant ON: snap to step boundary (offset=0).
                     * Both Off: capture raw sub-step timing. */
                    dlc->note_tick_offset[step][0] = off;
                    dlc->steps[step]               = 1;
                    dlc->active                    = 1;
                    clip_migrate_to_notes(dlc);
                    /* Suppress sequencer replay of freshly recorded note until clip wraps — prevents double-trigger */
                    { uint16_t ni3;
                      uint32_t rec_tick = (uint32_t)step * dlc->ticks_per_step
                                          + (uint32_t)dlc->note_tick_offset[step][0];
                      for (ni3 = 0; ni3 < dlc->note_count; ni3++) {
                          if (dlc->notes[ni3].tick == rec_tick)
                              dlc->notes[ni3].suppress_until_wrap = 1;
                      }
                    }
                    /* Store pending state so drum_record_note_off can close the gate.
                     * PHASE-1: use the snapshot (base_step, base_off) so the gate
                     * compares like-for-like against the release snapshot. */
                    tr->drum_rec_pending_tick[lane]   = (uint32_t)base_step * TICKS_PER_STEP
                                                        + (uint32_t)base_off;
                    tr->drum_rec_pending_step[lane]   = step;
                    tr->drum_rec_pending_active[lane] = 1;
                }
                /* Live monitoring for ROUTE_MOVE: play note immediately so the
                 * performer hears it without a separate live_notes set_param that
                 * would race/coalesce with this drum_record_note_on call. Mirrors
                 * the melodic record_note_on pattern. PHASE-1: on patched
                 * Schwung on_midi already fired live_note_on on the audio
                 * thread (faster), so skip to avoid double monitor. */
                if (tr->pfx.route == ROUTE_MOVE && !inst->dsp_inbound_enabled)
                    live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
                }
            }
        }
        /* Recorded drum hits are browser-visible content (rui_dnotes).
         * CONTENT-ONLY bump: device JS records these itself, no mid-record
         * resync (2026-07-06 record-disarm hang class). */
        rui_content(inst);
        return 1;
    }

    if (!strcmp(sub, "drum_record_note_off")) {
        /* tN_drum_record_note_off "p1 [p2 ...]"
         * JS batches all queued drum note-offs for the recordArmedTrack into
         * one call. Each pitch closes the gate for the last
         * drum_record_note_on on the matching lane, computing actual hold
         * duration from elapsed render ticks. */
        if (!tr->recording) return 1;
        {
            int ac2    = (int)tr->active_clip;
            drum_clip_t *dc2 = tr->drum_clips[ac2];
            if (!dc2) return 1;
            const char *sp2 = val;
            while (*sp2) {
                while (*sp2 == ' ') sp2++;
                if (!*sp2) break;
                /* Per-note ext-origin marker ("e<pitch>"); the off path is
                 * already slot-if-active-else-fallback — just consume it. */
                if (*sp2 == 'e') sp2++;
                int pitch2 = 0;
                while (*sp2 >= '0' && *sp2 <= '9') { pitch2 = pitch2 * 10 + (*sp2++ - '0'); }
                pitch2 = clamp_i(pitch2, 0, 127);
                int lane2  = -1;
                { int l2; for (l2 = 0; l2 < DRUM_LANES; l2++) {
                    if (dc2->lanes[l2].midi_note == (uint8_t)pitch2) { lane2 = l2; break; }
                }}
                if (lane2 >= 0 && tr->drum_rec_pending_active[lane2]) {
                    clip_t   *dlc2     = &dc2->lanes[lane2].clip;
                    uint16_t  step2    = tr->drum_rec_pending_step[lane2];
                    uint32_t  tps2     = TICKS_PER_STEP;
                    uint32_t  on_tick  = tr->drum_rec_pending_tick[lane2];
                    /* PHASE-1: prefer the audio-thread release snapshot. Consume. */
                    uint32_t  off_tick;
                    if (inst->dsp_inbound_enabled && inst->on_midi_drum_release_active[tidx][lane2]) {
                        off_tick = (uint32_t)inst->on_midi_drum_release_step[tidx][lane2] * tps2
                                   + (uint32_t)inst->on_midi_drum_release_off[tidx][lane2];
                        inst->on_midi_drum_release_active[tidx][lane2] = 0;
                    } else {
                        off_tick = (uint32_t)tr->drum_current_step[lane2] * tps2
                                   + tr->drum_tick_in_step[lane2];
                    }
                    uint32_t  clip_ticks = (uint32_t)dlc2->length * tps2;
                    uint32_t  gate;
                    if (off_tick >= on_tick) gate = off_tick - on_tick;
                    else                     gate = clip_ticks - on_tick + off_tick;
                    if (gate < 1)          gate = 1;
                    if (gate > clip_ticks) gate = clip_ticks;
                    if (step2 < (uint16_t)(dlc2->loop_start + dlc2->length)) {
                        dlc2->step_gate[step2] = (uint16_t)gate;
                        clip_migrate_to_notes(dlc2);
                    }
                    tr->drum_rec_pending_active[lane2] = 0;
                }
            }
        }
        rui_content(inst);   /* recorded gates changed (content-only, see note_on) */
        return 1;
    }
    return 0;
}
