/* FILE-SCOPE HANDLER for set_param()'s tN_lL_* drum-lane keys -- part of the
 * seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (immediately before set_param), NOT a standalone TU;
 * never compile or lint this file on its own. Third Stage B handler
 * (phase 4B group 3): the former mid-function segment is now a real
 * static int sp_track_drum(sp_ctx_t *).
 * Covers the single sub[0]=='l' drum-lane block: lane setters, the nested
 * step parser, and the repeat-groove setters. Load-bearing preamble runs
 * for every lane key: parses lane_idx from sub, and (because the Schwung
 * host drops tN_pad_mode) allocates the drum clip on first lane write as
 * the reliable drum-mode entry point.
 * See also sp_track_drum2.c (drum config, all-lanes transforms, drum
 * perform/repeat/repeat2, drum record -- the non-lane drum keys).
 * Returns 1 when the key was a lane key (sub[0]=='l' + digit) -- the lane
 * block CONSUMES it even if the sub-op is unknown, so unmatched tN_lL_*
 * keys never leak to the pfx catch-all in sp_track_misc. Returns 0 only
 * when sub is not a lane key, to fall through to the sibling tN_ handlers.
 * The tN_ guard and the tidx/sub/tr locals live in the parent dispatcher
 * now (seq8_set_param.c). */
static int sp_track_drum(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    /* Body below kept at its Stage-A segment indentation (8 spaces) so it
     * byte-diffs against the pre-conversion segment; reindent only in a
     * dedicated cleanup pass after the group is device-blessed. */

        if (sub[0] == 'l' && sub[1] >= '0' && sub[1] <= '9') {
            int lane_idx = 0;
            const char *p2 = sub + 1;
            while (*p2 >= '0' && *p2 <= '9') { lane_idx = lane_idx * 10 + (*p2 - '0'); p2++; }
            if (lane_idx < 0 || lane_idx >= DRUM_LANES) return 1;
            /* Schwung host drops tN_pad_mode and tN_convert_to_drum, so
             * pad_mode may not be set on the DSP side when JS sends lane
             * writes. tN_lL_* keys are drum-only by construction (JS never
             * sends them for melodic tracks), so allocate here on first
             * lane write as the reliable drum-mode entry point. */
            if (tr->pad_mode != PAD_MODE_DRUM) {
                tr->pad_mode = PAD_MODE_DRUM;
                drum_clips_alloc(inst, tr);
            }
            drum_clip_t *_dlc_guard = tr->drum_clips[tr->active_clip];
            if (!_dlc_guard) { drum_clips_alloc(inst, tr); _dlc_guard = tr->drum_clips[tr->active_clip]; }
            if (!_dlc_guard) return 1;
            drum_lane_t *dlane = &_dlc_guard->lanes[lane_idx];
            clip_t      *dlc   = &dlane->clip;

            if (!strcmp(p2, "_lane_note")) {
                dlane->midi_note = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                inst->state_dirty = 1;
                return 1;
            }

            /* Remote-UI drum-grid edits (monophonic lane; pitch = lane note). */
            if (!strcmp(p2, "_note_toggle")) { if (lane_note_apply_op(dlc, dlane->midi_note, 't', val)) clip_note_finalize(inst, dlc); return 1; }
            if (!strcmp(p2, "_note_add"))    { if (lane_note_apply_op(dlc, dlane->midi_note, 'a', val)) clip_note_finalize(inst, dlc); return 1; }
            if (!strcmp(p2, "_note_del"))    { if (lane_note_apply_op(dlc, dlane->midi_note, 'd', val)) clip_note_finalize(inst, dlc); return 1; }
            if (!strcmp(p2, "_note_vel"))    { if (lane_note_apply_op(dlc, dlane->midi_note, 'v', val)) clip_note_finalize(inst, dlc); return 1; }
            if (!strcmp(p2, "_note_resize")) { if (lane_note_apply_op(dlc, dlane->midi_note, 'r', val)) clip_note_finalize(inst, dlc); return 1; }
            if (!strcmp(p2, "_note_move"))   { if (lane_note_apply_op(dlc, dlane->midi_note, 'm', val)) clip_note_finalize(inst, dlc); return 1; }
            if (!strcmp(p2, "_mute")) {
                uint32_t bit = 1u << (uint32_t)lane_idx;
                if (my_atoi(val)) {
                    tr->drum_lane_mute |= bit;
                    pfx_note_off(inst, tr, dlane->midi_note);
                } else {
                    tr->drum_lane_mute &= ~bit;
                }
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p2, "_solo")) {
                uint32_t bit = 1u << (uint32_t)lane_idx;
                if (my_atoi(val)) {
                    tr->drum_lane_solo |= bit;
                    /* Silence all lanes that just became effectively muted */
                    int ll;
                    for (ll = 0; ll < DRUM_LANES; ll++) {
                        if (ll == lane_idx) continue;
                        uint8_t n2 = tr->drum_clips[tr->active_clip]->lanes[ll].midi_note;
                        pfx_note_off(inst, tr, n2);
                    }
                } else {
                    tr->drum_lane_solo &= ~bit;
                }
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p2, "_clip_length")) {
                int max_len = SEQ_STEPS - (int)dlc->loop_start;
                if (max_len < 1) max_len = 1;
                int newlen = clamp_i(my_atoi(val), 1, max_len);
                dlc->length = (uint16_t)newlen;
                {
                    uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                /* Re-anchor lane playhead to global tick so cross-lane phase
                 * stays consistent when length changes mid-playback. Stopped
                 * transport: anchor pins to loop_start (same as the clamp). */
                if (inst->playing)
                    drum_lane_anchor_playhead(inst, tr, lane_idx, dlc);
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }
            /* Playback direction for one drum lane's clip (v=35).
             * Mid-flight change keeps current playhead; pp_dir_state resets. */
            if (!strcmp(p2, "_playback_dir")) {
                dlc->playback_dir = (uint8_t)clamp_i(my_atoi(val), 0, 3);
                dlc->pp_dir_state = initial_pp_dir(dlc->playback_dir);
                silence_track_from_set_param(inst, tr);
                inst->state_dirty = 1;
                return 1;
            }
            /* Playback style for one drum lane: 0=Step, 1=Audio. */
            if (!strcmp(p2, "_playback_audio_reverse")) {
                dlc->playback_audio_reverse = (uint8_t)clamp_i(my_atoi(val), 0, 1);
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p2, "_loop_set")) {
                /* tN_lL_loop_set "packed" — atomic loop window write for one drum lane. */
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
                dlc->loop_start = (uint16_t)ls;
                dlc->length     = (uint16_t)len;
                {
                    uint16_t le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                if (inst->playing)
                    drum_lane_anchor_playhead(inst, tr, lane_idx, dlc);
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p2, "_clear")) {
                /* tN_lL_clear — wipe all steps in this drum lane.
                 * Preserves length, loop_start, ticks_per_step, pfx_params,
                 * and midi_note (per-lane sibling). Snapshots the drum clip
                 * for global Undo (same granularity as _hard_reset). */
                int i;
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                for (i = 0; i < SEQ_STEPS; i++) {
                    dlc->steps[i] = 0;
                    memset(dlc->step_notes[i], 0, 8);
                    dlc->step_note_count[i] = 0;
                    dlc->step_vel[i]  = (uint8_t)SEQ_VEL;
                    dlc->step_gate[i] = (uint16_t)GATE_TICKS;
                    memset(dlc->note_tick_offset[i], 0, 8 * sizeof(int16_t));
                }
                dlc->active    = 0;
                dlc->note_count = 0;
                memset(dlc->notes, 0, sizeof(dlc->notes));
                dlc->occ_dirty = 1;
                inst->state_dirty = 1;
                return 1;
            }

            if (!strcmp(p2, "_hard_reset")) {
                /* tN_lL_hard_reset — full factory reset for one drum lane.
                 * Wipes clip data via clip_init AND the per-lane drum-repeat
                 * groove fields (gate, gate_len, vel_scale, nudge, Rpt2 rate)
                 * back to drum_repeat_init_defaults values. midi_note is
                 * preserved (lane identity — a kick lane stays a kick lane).
                 * Snapshot covers per-clip (all 16 lanes); Rpt groove fields
                 * are NOT undoable. */
                int _rs;
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                clip_init(dlc);
                tr->drum_current_step[lane_idx]   = 0;
                tr->drum_tick_in_step[lane_idx]   = 0;
                tr->drum_repeat_gate[lane_idx]      = 0xFF;
                tr->drum_repeat_gate_len[lane_idx]  = 8;
                tr->drum_repeat2_rate_idx[lane_idx] = 2; /* 1/8 default */
                for (_rs = 0; _rs < 8; _rs++) {
                    tr->drum_repeat_vel_scale[lane_idx][_rs] = 100;
                    tr->drum_repeat_nudge[lane_idx][_rs]     = 0;
                }
                inst->state_dirty = 1;
                return 1;
            }

            if (!strcmp(p2, "_loop_double_fill")) {
                int len = (int)dlc->length;
                int ls  = (int)dlc->loop_start;
                int i;
                /* See melodic loop_double_fill: bounds check + copy source
                 * indices must respect loop_start>0. */
                if (ls + len * 2 > SEQ_STEPS) return 1;
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                for (i = 0; i < len; i++) {
                    int src = ls + i;
                    int dst = ls + len + i;
                    dlc->steps[dst]           = dlc->steps[src];
                    memcpy(dlc->step_notes[dst], dlc->step_notes[src], 8);
                    dlc->step_note_count[dst] = dlc->step_note_count[src];
                    dlc->step_vel[dst]        = dlc->step_vel[src];
                    dlc->step_gate[dst]       = dlc->step_gate[src];
                    memcpy(dlc->note_tick_offset[dst], dlc->note_tick_offset[src], 8 * sizeof(int16_t));
                }
                dlc->length = (uint16_t)(len * 2);
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= _le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }

            if (!strcmp(p2, "_clip_resolution")) {
                int idx = clamp_i(my_atoi(val), 0, 5);
                uint16_t new_tps = TPS_VALUES[idx];
                uint16_t old_tps = dlc->ticks_per_step;
                if (new_tps == old_tps) return 1;
                { uint32_t gmax_dr = (uint32_t)SEQ_STEPS * new_tps;
                  if (gmax_dr > 65535) gmax_dr = 65535;
                  uint16_t ni;
                  for (ni = 0; ni < dlc->note_count; ni++) {
                      note_t *n = &dlc->notes[ni];
                      n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                      uint32_t ng = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                      if (ng < 1) ng = 1;
                      if (ng > gmax_dr) ng = gmax_dr;
                      n->gate = (uint16_t)ng;
                  }
                }
                dlc->ticks_per_step = new_tps;
                if (old_tps > 0)
                    tr->drum_tick_in_step[lane_idx] =
                        (uint32_t)((uint64_t)tr->drum_tick_in_step[lane_idx] * new_tps / old_tps);
                if (tr->drum_tick_in_step[lane_idx] >= new_tps)
                    tr->drum_tick_in_step[lane_idx] = 0;
                clip_build_steps_from_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }

            if (!strcmp(p2, "_beat_stretch")) {
                int dir = my_atoi(val);
                int len = (int)dlc->length;
                int i, ni2, new_len, any;
                uint8_t  tmp_steps[SEQ_STEPS];
                uint8_t  tmp_notes[SEQ_STEPS][8];
                uint8_t  tmp_nc[SEQ_STEPS];
                uint8_t  tmp_vel[SEQ_STEPS];
                uint16_t tmp_gate[SEQ_STEPS];
                int16_t  tmp_tick_offset[SEQ_STEPS][8];
                { int gmax_bs = SEQ_STEPS * dlc->ticks_per_step; if (gmax_bs > 65535) gmax_bs = 65535;
                  int off_clamp = dlc->ticks_per_step - 1;
                  if (dir == 1) {
                      if (len * 2 > SEQ_STEPS) return 1;
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
                      tr->stretch_blocked = 0;
                  } else {
                      if (len < 2) return 1;
                      { uint8_t seen[SEQ_STEPS];
                        memset(seen, 0, sizeof(seen));
                        for (i = 0; i < len; i++) {
                            if (dlc->steps[i]) {
                                int dst = i / 2;
                                if (seen[dst]) { tr->stretch_blocked = 1; return 1; }
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
                } /* end gmax_bs/off_clamp block */
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= _le)
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                }
                any = 0;
                for (i = 0; i < (int)dlc->length; i++)
                    if (dlc->steps[i]) { any = 1; break; }
                dlc->active = (uint8_t)any;
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }

            if (!strcmp(p2, "_clock_shift")) {
                int dir = my_atoi(val);
                int len = (int)dlc->length;
                if (len < 2) return 1;
                uint8_t tmp_s, tmp_nc, tmp_ns[8], tmp_v;
                uint16_t tmp_g;
                int16_t tmp_toff[8];
                if (dir == 1) {
                    tmp_s  = dlc->steps[len-1];
                    memcpy(tmp_ns, dlc->step_notes[len-1], 8);
                    tmp_nc = dlc->step_note_count[len-1];
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
                    dlc->step_note_count[0] = tmp_nc;
                    dlc->step_vel[0] = tmp_v;
                    dlc->step_gate[0] = tmp_g;
                    memcpy(dlc->note_tick_offset[0], tmp_toff, 8 * sizeof(int16_t));
                    dlc->clock_shift_pos = (uint16_t)((dlc->clock_shift_pos + 1) % (uint16_t)len);
                } else {
                    tmp_s  = dlc->steps[0];
                    memcpy(tmp_ns, dlc->step_notes[0], 8);
                    tmp_nc = dlc->step_note_count[0];
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
                    dlc->step_note_count[len-1] = tmp_nc;
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
                inst->state_dirty = 1;
                return 1;
            }

            if (!strcmp(p2, "_nudge")) {
                int dir = my_atoi(val);
                if (dir == 0) { dlc->nudge_pos = 0; inst->state_dirty = 1; return 1; }
                if (dir != 1 && dir != -1) return 1;
                int len = (int)dlc->length;
                if (len < 1) return 1;
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
                return 1;
            }

            if (!strcmp(p2, "_clip_resolution_zoom")) {
                if (tr->recording) return 1;
                int idx = clamp_i(my_atoi(val), 0, 5);
                uint16_t new_tps = TPS_VALUES[idx];
                uint16_t old_tps = dlc->ticks_per_step;
                if (new_tps == old_tps) return 1;
                uint32_t old_ticks = (uint32_t)dlc->length * (uint32_t)old_tps;
                uint32_t new_len32 = (old_ticks + (uint32_t)new_tps - 1) / (uint32_t)new_tps;
                if (new_len32 > SEQ_STEPS) return 1;
                uint32_t abs_tick = (uint32_t)tr->drum_current_step[lane_idx] * (uint32_t)old_tps
                                  + tr->drum_tick_in_step[lane_idx];
                dlc->ticks_per_step = new_tps;
                dlc->length = (uint16_t)new_len32;
                tr->drum_current_step[lane_idx] = (uint16_t)(abs_tick / (uint32_t)new_tps);
                tr->drum_tick_in_step[lane_idx] = abs_tick % (uint32_t)new_tps;
                {
                    uint16_t _le = (uint16_t)(dlc->loop_start + dlc->length);
                    if (tr->drum_current_step[lane_idx] < dlc->loop_start
                            || tr->drum_current_step[lane_idx] >= _le) {
                        tr->drum_current_step[lane_idx] = dlc->loop_start;
                        tr->drum_tick_in_step[lane_idx] = 0;
                    }
                }
                clip_build_steps_from_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }

            /* tN_lL_step_S_toggle  val="vel"
             * Empty step: add lane note, activate. Active: deactivate. Inactive-with-note: reactivate. */
            if (!strcmp(p2, "_pfx_set")) {
                /* val = "pfx_key value" — apply pfx param to this lane's pfx_params */
                const char *sp = val;
                char pfx_key[64]; int ki = 0;
                while (*sp && *sp != ' ' && ki < 63) pfx_key[ki++] = *sp++;
                pfx_key[ki] = '\0';
                while (*sp == ' ') sp++;
                if (!strcmp(pfx_key, "pfx_reset") || !strcmp(pfx_key, "pfx_noteFx_reset") ||
                    !strcmp(pfx_key, "pfx_harm_reset") || !strcmp(pfx_key, "pfx_delay_reset"))
                    undo_begin_single(inst, tidx, (int)tr->active_clip);
                drum_pfx_set(inst, tr, &dlane->pfx_params, &tr->drum_lane_pfx[lane_idx], pfx_key, sp);
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_lgto_apply: destructive legato on this drum lane's clip.
             * Each note's gate becomes (next-active-tick − this-tick); last-
             * active note's gate fills to clip_end. Undoable. */
            if (!strcmp(p2, "_lgto_apply")) {
                undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                apply_legato_to_clip(&dlane->clip);
                inst->state_dirty = 1;
                return 1;
            }
            if (!strcmp(p2, "_pfx_reset")) {
                undo_begin_single(inst, tidx, (int)tr->active_clip);
                drum_pfx_set(inst, tr, &dlane->pfx_params, &tr->drum_lane_pfx[lane_idx], "pfx_reset", "1");
                inst->state_dirty = 1;
                return 1;
            }

            /* tN_lL_copy_to "dstLane" — copy active clip's lane L to dstLane; preserve dst midi_note */
            if (!strcmp(p2, "_copy_to")) {
                int dstLane = clamp_i(my_atoi(val), 0, DRUM_LANES - 1);
                if (dstLane == lane_idx) return 1;
                {
                    drum_lane_t *dst = &tr->drum_clips[(int)tr->active_clip]->lanes[dstLane];
                    uint8_t dst_midi_note = dst->midi_note;
                    undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                    memcpy(dst->clip.steps,            dlc->steps,            SEQ_STEPS);
                    memcpy(dst->clip.step_notes,       dlc->step_notes,       SEQ_STEPS * 8);
                    memcpy(dst->clip.step_note_count,  dlc->step_note_count,  SEQ_STEPS);
                    memcpy(dst->clip.step_vel,         dlc->step_vel,         SEQ_STEPS);
                    memcpy(dst->clip.step_gate,        dlc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                    memcpy(dst->clip.note_tick_offset, dlc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                    memcpy(dst->clip.step_iter,    dlc->step_iter,    SEQ_STEPS);
                    memcpy(dst->clip.step_random,  dlc->step_random,  SEQ_STEPS);
                    memcpy(dst->clip.step_ratchet, dlc->step_ratchet, SEQ_STEPS);
                    dst->clip.length        = dlc->length;
                    dst->clip.loop_start    = dlc->loop_start;
                    dst->clip.ticks_per_step = dlc->ticks_per_step;
                    dst->clip.playback_dir   = dlc->playback_dir;
                    dst->clip.playback_audio_reverse = dlc->playback_audio_reverse;
                    dst->clip.pp_dir_state   = initial_pp_dir(dst->clip.playback_dir);
                    dst->clip.active        = dlc->active;
                    dst->midi_note          = dst_midi_note;
                    dst->pfx_params         = dlane->pfx_params;
                    clip_migrate_to_notes(&dst->clip);
                    drum_pfx_apply_params(&tr->drum_lane_pfx[dstLane], &dst->pfx_params);
                    /* Copy repeat groove params */
                    tr->drum_repeat_gate[dstLane]     = tr->drum_repeat_gate[lane_idx];
                    tr->drum_repeat_gate_len[dstLane] = tr->drum_repeat_gate_len[lane_idx];
                    memcpy(tr->drum_repeat_vel_scale[dstLane], tr->drum_repeat_vel_scale[lane_idx], 8);
                    memcpy(tr->drum_repeat_nudge[dstLane],     tr->drum_repeat_nudge[lane_idx],     8);
                    inst->state_dirty = 1;
                }
                return 1;
            }

            /* tN_lL_cut_to "dstLane" — copy then clear src; atomic undo */
            if (!strcmp(p2, "_cut_to")) {
                int dstLane = clamp_i(my_atoi(val), 0, DRUM_LANES - 1);
                if (dstLane == lane_idx) return 1;
                {
                    drum_lane_t *dst = &tr->drum_clips[(int)tr->active_clip]->lanes[dstLane];
                    uint8_t dst_midi_note = dst->midi_note;
                    uint8_t src_midi_note = dlane->midi_note;
                    undo_begin_drum_clip(inst, tidx, (int)tr->active_clip);
                    memcpy(dst->clip.steps,            dlc->steps,            SEQ_STEPS);
                    memcpy(dst->clip.step_notes,       dlc->step_notes,       SEQ_STEPS * 8);
                    memcpy(dst->clip.step_note_count,  dlc->step_note_count,  SEQ_STEPS);
                    memcpy(dst->clip.step_vel,         dlc->step_vel,         SEQ_STEPS);
                    memcpy(dst->clip.step_gate,        dlc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                    memcpy(dst->clip.note_tick_offset, dlc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                    memcpy(dst->clip.step_iter,    dlc->step_iter,    SEQ_STEPS);
                    memcpy(dst->clip.step_random,  dlc->step_random,  SEQ_STEPS);
                    memcpy(dst->clip.step_ratchet, dlc->step_ratchet, SEQ_STEPS);
                    dst->clip.length        = dlc->length;
                    dst->clip.loop_start    = dlc->loop_start;
                    dst->clip.ticks_per_step = dlc->ticks_per_step;
                    dst->clip.playback_dir   = dlc->playback_dir;
                    dst->clip.playback_audio_reverse = dlc->playback_audio_reverse;
                    dst->clip.pp_dir_state   = initial_pp_dir(dst->clip.playback_dir);
                    dst->clip.active        = dlc->active;
                    dst->midi_note          = dst_midi_note;
                    clip_migrate_to_notes(&dst->clip);
                    /* Move repeat groove params */
                    tr->drum_repeat_gate[dstLane]     = tr->drum_repeat_gate[lane_idx];
                    tr->drum_repeat_gate_len[dstLane] = tr->drum_repeat_gate_len[lane_idx];
                    memcpy(tr->drum_repeat_vel_scale[dstLane], tr->drum_repeat_vel_scale[lane_idx], 8);
                    memcpy(tr->drum_repeat_nudge[dstLane],     tr->drum_repeat_nudge[lane_idx],     8);
                    tr->drum_repeat_gate[lane_idx]     = 0xFF;
                    tr->drum_repeat_gate_len[lane_idx] = 8;
                    memset(tr->drum_repeat_vel_scale[lane_idx], 100, 8);
                    memset(tr->drum_repeat_nudge[lane_idx],     0,   8);
                    drum_lane_note_off_imm(inst, tr, src_midi_note);
                    clip_init(dlc);
                    dlane->midi_note = src_midi_note;
                    inst->state_dirty = 1;
                }
                return 1;
            }

            /* tN_lL_euclid_stamp  val="prevN newN vel"
             * Atomic Euclid diff: unstamp positions in (prev \ new), stamp positions in (new \ prev).
             * Hand-edits at non-Euclid positions are preserved. */
            if (!strcmp(p2, "_euclid_stamp")) {
                int prevN = 0, newN = 0, vel = SEQ_VEL;
                {
                    const char *sp = val;
                    prevN = my_atoi(sp);
                    while (*sp && *sp != ' ') sp++;
                    while (*sp == ' ') sp++;
                    newN = my_atoi(sp);
                    while (*sp && *sp != ' ') sp++;
                    while (*sp == ' ') sp++;
                    if (*sp) vel = my_atoi(sp);
                }
                vel = clamp_i(vel, 1, 127);
                int len = (int)dlc->length;
                if (len <= 0) return 1;
                if (prevN < 0) prevN = 0; if (prevN > len) prevN = len;
                if (newN  < 0) newN  = 0; if (newN  > len) newN  = len;
                if (prevN == newN) return 1;
                int old_pos[SEQ_STEPS], new_pos[SEQ_STEPS];
                int no = bjorklund_positions(prevN, len, old_pos);
                int nn = bjorklund_positions(newN,  len, new_pos);
                /* Both arrays are ascending. Merge-walk to compute symmetric difference. */
                int io = 0, in_ = 0;
                while (io < no || in_ < nn) {
                    int op = (io < no) ? old_pos[io] : SEQ_STEPS;
                    int np = (in_ < nn) ? new_pos[in_] : SEQ_STEPS;
                    if (op == np) { io++; in_++; continue; }
                    if (op < np) {
                        /* old-only: unstamp (clear step) */
                        int s = op;
                        if (dlc->steps[s] || dlc->step_note_count[s]) {
                            dlc->steps[s]           = 0;
                            dlc->step_note_count[s]  = 0;
                            dlc->step_vel[s]         = (uint8_t)SEQ_VEL;
                            dlc->step_gate[s]        = (uint16_t)GATE_TICKS;
                            memset(dlc->note_tick_offset[s], 0, sizeof(dlc->note_tick_offset[s]));
                            memset(dlc->step_notes[s], 0, 8);
                            dlc->step_iter[s]        = 0;
                            dlc->step_random[s]      = 0;
                            dlc->step_ratchet[s]     = 0;
                            drum_lane_note_off_imm(inst, tr, dlane->midi_note);
                        }
                        io++;
                    } else {
                        /* new-only: stamp (activate step with lane note) */
                        int s = np;
                        if (dlc->step_note_count[s] == 0) {
                            dlc->step_notes[s][0]      = dlane->midi_note;
                            dlc->step_note_count[s]     = 1;
                            dlc->step_vel[s]            = (uint8_t)vel;
                            dlc->step_gate[s]           = (uint16_t)GATE_TICKS;
                            dlc->note_tick_offset[s][0] = 0;
                            dlc->steps[s]               = 1;
                        } else {
                            /* Has notes (possibly hand-placed): just ensure active */
                            dlc->steps[s] = 1;
                        }
                        in_++;
                    }
                }
                { int i, any = 0;
                  for (i = 0; i < (int)dlc->length; i++) if (dlc->steps[i]) { any = 1; break; }
                  dlc->active = (uint8_t)any; }
                clip_migrate_to_notes(dlc);
                inst->state_dirty = 1;
                return 1;
            }

            if (!strncmp(p2, "_step_", 6)) {
                const char *q = p2 + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return 1;

                if (!strcmp(q, "_toggle")) {
                    int vel = clamp_i(my_atoi(val), 1, 127);
                    if (vel == 0) vel = SEQ_VEL;
                    if (dlc->step_note_count[sidx] == 0) {
                        /* Empty: add lane note and activate */
                        dlc->step_notes[sidx][0]       = dlane->midi_note;
                        dlc->step_note_count[sidx]      = 1;
                        dlc->step_vel[sidx]             = (uint8_t)vel;
                        dlc->step_gate[sidx]            = (uint16_t)GATE_TICKS;
                        dlc->note_tick_offset[sidx][0]  = 0;
                        dlc->steps[sidx]                = 1;
                    } else {
                        /* Has note: toggle active/inactive */
                        int was_on = dlc->steps[sidx];
                        dlc->steps[sidx] = was_on ? 0 : 1;
                        if (was_on) drum_lane_note_off_imm(inst, tr, dlane->midi_note);
                    }
                    { int i, any = 0;
                      for (i = 0; i < SEQ_STEPS; i++) if (dlc->steps[i]) { any = 1; break; }
                      dlc->active = (uint8_t)any; }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_clear")) {
                    dlc->steps[sidx]          = 0;
                    dlc->step_note_count[sidx] = 0;
                    dlc->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                    dlc->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                    memset(dlc->note_tick_offset[sidx], 0, sizeof(dlc->note_tick_offset[sidx]));
                    dlc->step_iter[sidx]       = 0;
                    dlc->step_random[sidx]     = 0;
                    dlc->step_ratchet[sidx]    = 0;
                    { int i, any = 0;
                      for (i = 0; i < SEQ_STEPS; i++) if (dlc->steps[i]) { any = 1; break; }
                      dlc->active = (uint8_t)any; }
                    clip_migrate_to_notes(dlc);
                    pfx_note_off_imm(inst, tr, dlane->midi_note);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_vel")) {
                    if (dlc->step_note_count[sidx] == 0) return 1;
                    dlc->step_vel[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 127);
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_gate")) {
                    if (dlc->step_note_count[sidx] == 0) return 1;
                    dlc->step_gate[sidx] = (uint16_t)clamp_i(my_atoi(val), 1, 65535);
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_nudge")) {
                    if (dlc->step_note_count[sidx] == 0) return 1;
                    { int tps_m1 = dlc->ticks_per_step - 1;
                    int new_val = clamp_i(my_atoi(val), -tps_m1, tps_m1);
                    int delta = new_val - (int)dlc->note_tick_offset[sidx][0];
                    int ni;
                    for (ni = 0; ni < (int)dlc->step_note_count[sidx]; ni++) {
                        int o = (int)dlc->note_tick_offset[sidx][ni] + delta;
                        dlc->note_tick_offset[sidx][ni] = (int16_t)clamp_i(o, -tps_m1, tps_m1);
                    } }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_iter")) {
                    int raw = clamp_i(my_atoi(val), 0, 255);
                    if (raw != 0) {
                        int len = (raw >> 4) & 0xF, idx = raw & 0xF;
                        if (len < 1 || len > 8 || idx < 1 || idx > len) raw = 0;
                    }
                    dlc->step_iter[sidx] = (uint8_t)raw;
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_rand")) {
                    dlc->step_random[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 100);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_ratch")) {
                    dlc->step_ratchet[sidx] = (uint8_t)clamp_i(my_atoi(val), 0, 4);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_reassign")) {
                    int dstStep = clamp_i(my_atoi(val), 0, (int)dlc->length - 1);
                    if (dstStep == sidx) return 1;
                    if (dlc->step_note_count[sidx] == 0) return 1;
                    {
                        int tps_m1 = dlc->ticks_per_step - 1;
                        int offset_adjust = ((int)sidx - dstStep) * dlc->ticks_per_step;
                        int ni;
                        if (dlc->step_note_count[dstStep] == 0) {
                            for (ni = 0; ni < (int)dlc->step_note_count[sidx]; ni++) {
                                dlc->step_notes[dstStep][ni] = dlc->step_notes[sidx][ni];
                                int new_off = (int)dlc->note_tick_offset[sidx][ni] + offset_adjust;
                                dlc->note_tick_offset[dstStep][ni] =
                                    (int16_t)clamp_i(new_off, -tps_m1, tps_m1);
                            }
                            dlc->step_note_count[dstStep] = dlc->step_note_count[sidx];
                            dlc->step_vel[dstStep]        = dlc->step_vel[sidx];
                            dlc->step_gate[dstStep]       = dlc->step_gate[sidx];
                            dlc->step_iter[dstStep]       = dlc->step_iter[sidx];
                            dlc->step_random[dstStep]     = dlc->step_random[sidx];
                            dlc->step_ratchet[dstStep]    = dlc->step_ratchet[sidx];
                            dlc->steps[dstStep]           = dlc->steps[sidx];
                        } else {
                            for (ni = 0; ni < (int)dlc->step_note_count[sidx]; ni++) {
                                uint8_t pitch = dlc->step_notes[sidx][ni];
                                int nj, dup = 0;
                                for (nj = 0; nj < (int)dlc->step_note_count[dstStep]; nj++) {
                                    if (dlc->step_notes[dstStep][nj] == pitch) { dup = 1; break; }
                                }
                                if (dup || dlc->step_note_count[dstStep] >= 8) continue;
                                int slot = (int)dlc->step_note_count[dstStep];
                                dlc->step_notes[dstStep][slot] = pitch;
                                int new_off = (int)dlc->note_tick_offset[sidx][ni] + offset_adjust;
                                dlc->note_tick_offset[dstStep][slot] =
                                    (int16_t)clamp_i(new_off, -tps_m1, tps_m1);
                                dlc->step_note_count[dstStep]++;
                            }
                            if (dlc->steps[sidx]) dlc->steps[dstStep] = 1;
                        }
                        memset(dlc->step_notes[sidx], 0, 8);
                        memset(dlc->note_tick_offset[sidx], 0, 8 * sizeof(int16_t));
                        dlc->step_note_count[sidx] = 0;
                        dlc->step_vel[sidx]        = (uint8_t)SEQ_VEL;
                        dlc->step_gate[sidx]       = (uint16_t)GATE_TICKS;
                        dlc->step_iter[sidx]       = 0;
                        dlc->step_random[sidx]     = 0;
                        dlc->step_ratchet[sidx]    = 0;
                        dlc->steps[sidx]           = 0;
                    }
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)dlc->length; k++) if (dlc->steps[k]) { any = 1; break; }
                        dlc->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return 1;
                }
                if (!strcmp(q, "_copy_to")) {
                    /* tN_lL_step_S_copy_to — copy step data to dstStep; src unchanged */
                    int dstStep = clamp_i(my_atoi(val), 0, (int)dlc->length - 1);
                    if (dstStep == sidx) return 1;
                    if (dlc->step_note_count[sidx] == 0) return 1;
                    memcpy(dlc->step_notes[dstStep], dlc->step_notes[sidx], 8);
                    memcpy(dlc->note_tick_offset[dstStep], dlc->note_tick_offset[sidx], 8 * sizeof(int16_t));
                    dlc->step_note_count[dstStep] = dlc->step_note_count[sidx];
                    dlc->step_vel[dstStep]        = dlc->step_vel[sidx];
                    dlc->step_gate[dstStep]       = dlc->step_gate[sidx];
                    dlc->step_iter[dstStep]       = dlc->step_iter[sidx];
                    dlc->step_random[dstStep]     = dlc->step_random[sidx];
                    dlc->step_ratchet[dstStep]    = dlc->step_ratchet[sidx];
                    dlc->steps[dstStep]           = dlc->steps[sidx];
                    {
                        int any = 0, k;
                        for (k = 0; k < (int)dlc->length; k++) if (dlc->steps[k]) { any = 1; break; }
                        dlc->active = (uint8_t)any;
                    }
                    clip_migrate_to_notes(dlc);
                    inst->state_dirty = 1;
                    return 1;
                }
            }

            /* tN_lL_repeat_gate_toggle "step" — toggle gate bit for step 0-7 */
            if (!strcmp(p2, "_repeat_gate_toggle")) {
                int step_r = clamp_i(my_atoi(val), 0, 7);
                tr->drum_repeat_gate[lane_idx] ^= (uint8_t)(1u << step_r);
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_gate_set "mask" — directly set gate bitmask 0-255 */
            if (!strcmp(p2, "_repeat_gate_set")) {
                tr->drum_repeat_gate[lane_idx] = (uint8_t)clamp_i(my_atoi(val), 0, 255);
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_gate_len "len" — set gate cycle length 1-8 */
            if (!strcmp(p2, "_repeat_gate_len")) {
                tr->drum_repeat_gate_len[lane_idx] = (uint8_t)clamp_i(my_atoi(val), 1, 8);
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_gate_and_len "mask len" — atomically set gate bitmask and cycle length */
            if (!strcmp(p2, "_repeat_gate_and_len")) {
                const char *sp_gl = strchr(val, ' ');
                tr->drum_repeat_gate[lane_idx]     = (uint8_t)clamp_i(my_atoi(val), 0, 255);
                tr->drum_repeat_gate_len[lane_idx] = (uint8_t)clamp_i(sp_gl ? my_atoi(sp_gl + 1) : 8, 1, 8);
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_vel_scale "step pct" — set velocity scaling 0-200 for step */
            if (!strcmp(p2, "_repeat_vel_scale")) {
                const char *sp_r = val;
                while (*sp_r == ' ') sp_r++;
                int step_r = 0;
                while (*sp_r >= '0' && *sp_r <= '9') { step_r = step_r * 10 + (*sp_r++ - '0'); }
                step_r = clamp_i(step_r, 0, 7);
                while (*sp_r == ' ') sp_r++;
                int pct_r = clamp_i(my_atoi(sp_r), 0, 200);
                tr->drum_repeat_vel_scale[lane_idx][step_r] = (uint8_t)pct_r;
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_nudge "step pct" — set nudge -50..50 for step */
            if (!strcmp(p2, "_repeat_nudge")) {
                const char *sp_r = val;
                while (*sp_r == ' ') sp_r++;
                int step_r = 0;
                while (*sp_r >= '0' && *sp_r <= '9') { step_r = step_r * 10 + (*sp_r++ - '0'); }
                step_r = clamp_i(step_r, 0, 7);
                while (*sp_r == ' ') sp_r++;
                int pct_r = clamp_i(my_atoi(sp_r), -50, 50);
                tr->drum_repeat_nudge[lane_idx][step_r] = (int8_t)pct_r;
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_defaults "step" — reset vel_scale and nudge to defaults (not gate) */
            if (!strcmp(p2, "_repeat_defaults")) {
                int step_r = clamp_i(my_atoi(val), 0, 7);
                tr->drum_repeat_vel_scale[lane_idx][step_r] = 100;
                tr->drum_repeat_nudge[lane_idx][step_r]     = 0;
                inst->state_dirty = 1;
                return 1;
            }
            /* tN_lL_repeat_groove_reset — reset all groove params for this lane */
            if (!strcmp(p2, "_repeat_groove_reset")) {
                tr->drum_repeat_gate[lane_idx]     = 0xFF;
                tr->drum_repeat_gate_len[lane_idx] = 8;
                { int s; for (s = 0; s < 8; s++) {
                    tr->drum_repeat_vel_scale[lane_idx][s] = 100;
                    tr->drum_repeat_nudge[lane_idx][s]     = 0;
                }}
                inst->state_dirty = 1;
                return 1;
            }
            return 1;  /* lane key, unknown sub-op: CONSUME (never leak to pfx catch-all) */
        }

    return 0;  /* not a lane key: fall through to sibling tN_ handlers */
}
