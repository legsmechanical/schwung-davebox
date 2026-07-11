/* FILE-SCOPE HANDLER for set_param()'s tN_ recording keys -- part of the
 * seq8.c single translation unit; #included at FILE scope by seq8_set_param.c
 * (immediately before set_param), NOT a standalone TU; never compile or lint
 * this file on its own. Sixth Stage B handler (phase 4B group 6): the former
 * mid-function segment is now a real static int sp_track_record(sp_ctx_t *).
 * Covers tN_ track keys: recording, record_note_on, record_note_off.
 * Returns 1 when it handled the key (caller returns), 0 to fall through to
 * the sibling tN_ handlers. The tN_ guard and the tidx/sub/tr locals live in
 * the parent dispatcher now (seq8_set_param.c). */
static int sp_track_record(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    /* Body below kept at its Stage-A segment indentation (8 spaces) so it
     * byte-diffs against the pre-conversion segment; reindent only in a
     * dedicated cleanup pass after the group is device-blessed. */

        if (!strcmp(sub, "recording")) {
            int rv = my_atoi(val);
            if (rv) {
                int snap_clip = (tr->queued_clip >= 0) ? (int)tr->queued_clip : (int)tr->active_clip;
                if (tr->pad_mode == PAD_MODE_DRUM)
                    undo_begin_drum_clip(inst, tidx, snap_clip);
                else
                    undo_begin_single(inst, tidx, snap_clip);
                /* Fresh recording session: clear pass mask so existing notes play back */
                memset(tr->live_recorded_steps, 0, 32);
                memset(tr->cc_auto_touch_frame, 0, sizeof(tr->cc_auto_touch_frame));
                /* PHASE-1: clear inbound press/release slots so a stale active=1
                 * from a prior recording session can't leak into this pass. */
                memset(inst->on_midi_press_active[tidx], 0, sizeof(inst->on_midi_press_active[tidx]));
                memset(inst->on_midi_release_active[tidx], 0, sizeof(inst->on_midi_release_active[tidx]));
                memset(inst->on_midi_drum_press_active[tidx], 0, sizeof(inst->on_midi_drum_press_active[tidx]));
                memset(inst->on_midi_drum_release_active[tidx], 0, sizeof(inst->on_midi_drum_release_active[tidx]));
                /* Reset drum-repeat per-pass accumulation detector so this pass's
                 * first fire on each lane-step is treated as new (preserves the
                 * write-once-across-passes semantic for Rpt1/Rpt2 recording). */
                memset(tr->drum_last_rec_step, 0xFF, sizeof(tr->drum_last_rec_step));
                /* Clear any tarp notes held before recording started — their note-offs
                 * can't reach live_note_off once activelyRecording=true in JS.
                 * Skip when transport is already running: TARP is already firing
                 * in steady state, and silencing it resets master_anchor=0,
                 * which jumps the step index and audibly drifts the latched
                 * chord (fix g, 1.0-tweaks). */
                if (!inst->playing) tarp_silence(inst, tr);
                /* JS sends rv=2 for adaptive-mode arms (defer to next bar +
                 * reset playhead at fire time) and rv=1 for fixed-mode arms or
                 * any non-playing start (immediate). The defer-with-reset only
                 * activates for rv==2 with transport+clip playing. */
                if (tr->clip_playing && inst->playing && rv == 2) {
                    /* Adaptive arm only makes sense in Forward playback
                     * (the "grow when near the end" heuristic is forward-biased
                     * and the playhead doesn't approach the end in Bwd/PPb at
                     * all). Force fixed-mode arm when active clip is non-Fwd. */
                    uint8_t _pd = (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip])
                        ? tr->drum_clips[tr->active_clip]->lanes[tr->active_drum_lane].clip.playback_dir
                        : tr->clips[tr->active_clip].playback_dir;
                    if (_pd != 0) {
                        tr->recording_pending_page = 1;
                        tr->recording_adaptive_arm = 0;
                    } else {
                        tr->recording_pending_page = 1;
                        tr->recording_adaptive_arm = 1;
                    }
                } else if (tr->clip_playing) {
                    /* Fixed-mode arm during playback (rv==1), or clip-playing
                     * with transport stopped: begin recording immediately. */
                    tr->recording = 1;
                } else if (tr->queued_clip >= 0) {
                    tr->record_armed = 1;
                } else {
                    tr->recording = 1;
                }
            } else {
                finalize_pending_notes(&tr->clips[tr->active_clip], tr);
                clip_clear_suppress(&tr->clips[tr->active_clip]);
                tr->recording              = 0;
                tr->record_armed           = 0;
                tr->recording_pending_page = 0;
                tr->recording_adaptive_arm = 0;
                /* Cancel any pending count-in for this track. Arming from stopped
                 * schedules a 1-bar count-in that fires recording from the render
                 * thread when it completes (seq8.c). A disarm that lands while the
                 * count-in is still counting must cancel it too — otherwise the
                 * count-in completes and re-arms recording AFTER the user disarmed
                 * (the "keeps recording after disarm" bug). */
                if ((int)inst->count_in_track == tidx) inst->count_in_ticks = 0;
            }
            return 1;
        }

        if (!strcmp(sub, "record_note_on")) {
            /* tN_record_note_on "p1 v1 [p2 v2 ...]"
             * JS batches all chord note-ons into one call to survive set_param coalescing.
             * PHASE-1: per-pitch tick comes from on_midi_press_tick slots (audio-thread
             * single-buffer precision); fallback is current_clip_tick at handler arrival
             * (stock-Schwung path, no slot snapshot). */
            if (!tr->recording) return 1;
            clip_t *cl = &tr->clips[tr->active_clip];

            uint16_t tps = cl->ticks_per_step;
            uint32_t clip_ticks = (uint32_t)cl->length * tps;
            if (clip_ticks == 0) return 1;
            /* current_clip_tick is already window-anchored in
             * [loop_start*tps, (loop_start+length)*tps); modulo by
             * clip_ticks would collapse it to [0, clip_ticks) and
             * drop the loop_start offset. */
            uint32_t fallback_tick = tr->current_clip_tick;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                /* Per-note ext-origin marker: "e<pitch>" = external cable-2
                 * MIDI (JS _onMidiExternalImpl push); bare "<pitch>" = pad.
                 * Batches can MIX pad+ext notes, hence per-note not per-batch. */
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
                    vel = clamp_i(vel, 0, 127);
                }
                vel = effective_vel(tr, vel);

                /* PHASE-1: prefer the actual hardware-press tick captured by
                 * on_midi over the late current_clip_tick. Consume the slot.
                 * Uniform rule under inbound:
                 *   slot active → use + consume it (pads on any route; ext on
                 *     ROUTE_MOVE, whose Move echo reaches on_midi);
                 *   slot inactive + PAD → drop: the press was filtered by
                 *     on_midi (e.g., early-count-in window outside the last
                 *     1/8 note) and the drop preserves that filter;
                 *   slot inactive + EXT (any route) → fallback tick: external
                 *     notes have no on_midi note slot. Non-ROUTE_MOVE ext never
                 *     reaches on_midi (shim BLOCK); and on ROUTE_MOVE, Move
                 *     plays the note natively but does NOT echo note-on/off to
                 *     MIDI_OUT (only continuous controllers pass through — device
                 *     diagnosis 2026-07-11), so no note echo ever stamps a slot
                 *     there either. Both take the JS-path flush tick (Path B /
                 *     Option A). Count-in last-1/8 filtering for ext lives in JS
                 *     (extCountInCapture) — early warm-up presses are never
                 *     pushed. A note slot only appears via a future host
                 *     MIDI_IN→on_midi note delivery (Option B), and then wins.
                 * Stock Schwung (inbound off) falls back to current_clip_tick
                 * (no slots written). */
                uint32_t abs_tick;
                if (inst->dsp_inbound_enabled) {
                    if (inst->on_midi_press_active[tidx][pitch]) {
                        abs_tick = inst->on_midi_press_tick[tidx][pitch];
                        inst->on_midi_press_active[tidx][pitch] = 0;
                    } else if (ext) {
                        abs_tick = fallback_tick;
                    } else {
                        continue;   /* pad with no slot: on_midi filtered it */
                    }
                } else {
                    abs_tick = fallback_tick;
                }
                /* Per-track InQ: 9 values (0=Off..8=1/4T) via DRUM_INQ_TICKS.
                 * Shared per-track field with drum tracks (drum_inp_quant is
                 * historical name; field is per-track-type-agnostic). Global
                 * inp_quant removed in favor of per-track granularity. */
                if (tr->drum_inp_quant > 0) {
                    uint32_t qt = (uint32_t)DRUM_INQ_TICKS[tr->drum_inp_quant];
                    abs_tick = ((abs_tick + qt / 2) / qt) * qt;
                }

                /* Audio-reverse recording: in audio mode + reverse motion the
                 * snapshot tick is the audible press position. On the next
                 * playback pass, audio-reverse fires note-on at clip_tick +
                 * gate, so to play back at the press position we need to
                 * store clip_tick = press - GATE_TICKS. (GATE_TICKS is the
                 * default recording gate; if the actual release-derived gate
                 * differs the audible position shifts by that delta — a small
                 * approximation acceptable for v1.) Clamp to loop_start. */
                if (cl->playback_audio_reverse && clip_in_reverse_motion(cl)) {
                    uint32_t _ws = (uint32_t)cl->loop_start * (uint32_t)tps;
                    if (abs_tick >= _ws + (uint32_t)GATE_TICKS)
                        abs_tick -= (uint32_t)GATE_TICKS;
                    else
                        abs_tick = _ws;
                }

                /* TRACK ARP active: arp output will be recorded in tarp_fire_step.
                 * Feed raw input only into the arp held buffer. PHASE-1: on
                 * patched Schwung on_midi already called live_note_on (which
                 * feeds the arp held buffer), so skip to avoid double-feed. */
                if (tr->tarp_on && tr->pad_mode != PAD_MODE_DRUM) {
                    if (!inst->dsp_inbound_enabled)
                        live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
                    continue;
                }

                int ni = clip_insert_note(cl, abs_tick, (uint16_t)GATE_TICKS,
                                          (uint8_t)pitch, (uint8_t)vel);
                if (ni >= 0) {
                    cl->notes[ni].suppress_until_wrap = 1;
                    if (tr->rec_pending_count < 10) {
                        int ri = (int)tr->rec_pending_count;
                        tr->rec_pending[ri].pitch      = (uint8_t)pitch;
                        tr->rec_pending[ri].tick_at_on = abs_tick;
                        tr->rec_pending_count++;
                    }
                }

                /* Mirror to step arrays. Use note_step() (rounded) so sidx
                 * matches the _steps get_param reader and clip_build_steps_from_notes;
                 * truncation here previously caused step LED / hold-read divergence
                 * for notes recorded in the upper half of a step with InQ Off. */
                {
                    uint16_t sidx = note_step(abs_tick, cl->length, tps);
                    int16_t  off  = (int16_t)((int32_t)abs_tick
                                              - (int32_t)sidx * tps);
                    if (sidx < SEQ_STEPS) {
                        if (!cl->steps[sidx] && cl->step_note_count[sidx] > 0) {
                            int si;
                            for (si = 0; si < 8; si++) {
                                cl->step_notes[sidx][si] = 0;
                                cl->note_tick_offset[sidx][si] = 0;
                            }
                            cl->step_note_count[sidx] = 0;
                            cl->step_vel[sidx]  = (uint8_t)SEQ_VEL;
                            cl->step_gate[sidx] = (uint16_t)GATE_TICKS;
                        }
                        if (cl->step_note_count[sidx] < 8) {
                            int ni2 = (int)cl->step_note_count[sidx];
                            if (ni2 == 0) {
                                cl->step_vel[sidx]  = (uint8_t)vel;
                                cl->step_gate[sidx] = (uint16_t)GATE_TICKS;
                            }
                            cl->step_notes[sidx][ni2]          = (uint8_t)pitch;
                            cl->note_tick_offset[sidx][ni2]    = off;
                            cl->step_note_count[sidx]++;
                            cl->steps[sidx] = 1;
                            cl->active      = 1;
                            LRS_SET(tr, sidx);
                        }
                    }
                }
                /* Live monitoring for ROUTE_MOVE: play note immediately so the
                 * performer hears it without a separate live_notes set_param that
                 * would race/coalesce with this record_note_on call. PHASE-1:
                 * on patched Schwung on_midi already fired live_note_on on the
                 * audio thread (faster), so skip to avoid double monitor. */
                if (tr->pfx.route == ROUTE_MOVE && !inst->dsp_inbound_enabled)
                    live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)vel);
            }
            return 1;
        }

        if (!strcmp(sub, "record_note_off")) {
            /* tN_record_note_off "p1 [p2 ...]"
             * JS batches simultaneous chord releases into one call.
             * PHASE-1: per-pitch off_tick comes from on_midi_release_tick slot
             * (audio-thread); fallback is current_clip_tick. */
            if (!tr->recording) return 1;
            clip_t *cl = &tr->clips[tr->active_clip];

            uint16_t tps = cl->ticks_per_step;
            uint32_t clip_ticks = (uint32_t)cl->length * tps;
            if (clip_ticks == 0) return 1;
            /* Window-anchored: see record_note_on. */
            uint32_t fallback_off_tick = tr->current_clip_tick;

            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;

                /* Per-note ext-origin marker ("e<pitch>", see record_note_on).
                 * The off path is already slot-if-active-else-fallback for
                 * every origin, so the marker only needs to be consumed. */
                if (*sp == 'e') sp++;

                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);

                /* PHASE-1: prefer the actual hardware-release tick. Consume. */
                uint32_t off_tick;
                if (inst->dsp_inbound_enabled && inst->on_midi_release_active[tidx][pitch]) {
                    off_tick = inst->on_midi_release_tick[tidx][pitch];
                    inst->on_midi_release_active[tidx][pitch] = 0;
                } else {
                    off_tick = fallback_off_tick;
                }

                /* TRACK ARP active: note was never written to rec_pending; update
                 * arp held buffer and let tarp_fire_step own clip recording.
                 * PHASE-1: on patched Schwung on_midi already fired live_note_off
                 * (which updates the arp held buffer), so skip. */
                if (tr->tarp_on && tr->pad_mode != PAD_MODE_DRUM) {
                    if (!inst->dsp_inbound_enabled)
                        live_note_off(inst, tr, (uint8_t)pitch);
                    continue;
                }

                /* Find matching rec_pending entry */
                int ri;
                for (ri = 0; ri < (int)tr->rec_pending_count; ri++) {
                    if (tr->rec_pending[ri].pitch == (uint8_t)pitch) break;
                }
                if (ri >= (int)tr->rec_pending_count) continue;

                uint32_t on_tick = tr->rec_pending[ri].tick_at_on;

                uint32_t gate_ticks;
                if (off_tick >= on_tick)
                    gate_ticks = off_tick - on_tick;
                else
                    gate_ticks = clip_ticks - on_tick + off_tick;
                if (gate_ticks < 1) gate_ticks = 1;
                { uint32_t gmax = (uint32_t)SEQ_STEPS * tps; if (gmax > 65535) gmax = 65535;
                  if (gate_ticks > gmax) gate_ticks = gmax; }

                /* Update matching note_t gate (scan from newest) */
                {
                    uint16_t ni2;
                    for (ni2 = (uint16_t)(cl->note_count > 0 ? cl->note_count - 1 : 0);
                         ni2 < cl->note_count; ni2--) {
                        note_t *n = &cl->notes[ni2];
                        if (n->active && n->pitch == (uint8_t)pitch
                                && n->tick == on_tick) {
                            n->gate = (uint16_t)gate_ticks;
                            break;
                        }
                        if (ni2 == 0) break;
                    }
                }

                /* Mirror gate to step arrays. Use note_step() (rounded) to match the
                 * sidx used by the record_note_on mirror (line ~3045) and the
                 * _steps get_param reader. Previously this used truncation
                 * (`on_tick / tps`), which for notes pressed in the upper half of
                 * a step caused the off mirror to update the wrong step's gate
                 * — and since the guard `cl->steps[sidx]` fails on the empty
                 * truncated step, the rounded step kept its default GATE_TICKS
                 * (~0.5 step), making the note play back too short. */
                {
                    uint16_t sidx = note_step(on_tick, cl->length, tps);
                    if (sidx < SEQ_STEPS && cl->steps[sidx])
                        cl->step_gate[sidx] = (uint16_t)gate_ticks;
                }

                /* Remove rec_pending slot */
                tr->rec_pending[ri] = tr->rec_pending[tr->rec_pending_count - 1];
                tr->rec_pending_count--;

                /* Live monitoring for ROUTE_MOVE. PHASE-1: on patched Schwung
                 * on_midi already fired live_note_off on the audio thread. */
                if (tr->pfx.route == ROUTE_MOVE && !inst->dsp_inbound_enabled)
                    live_note_off(inst, tr, (uint8_t)pitch);
            }
            return 1;
        }

    return 0;
}
