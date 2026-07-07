/* FILE-SCOPE HANDLER for set_param()'s tN_ clip-resolution / track-type /
 * track-arp keys -- part of the seq8.c single translation unit; #included at
 * FILE scope by seq8_set_param.c (immediately before set_param), NOT a
 * standalone TU; never compile or lint this file on its own. Fifth Stage B
 * handler (phase 4B group 5): the former mid-function segment is now a real
 * static int sp_track_config2(sp_ctx_t *).
 * Covers tN_ track keys: clip_resolution, clip_resolution_zoom, pad_octave,
 * pad_mode, convert_to_drum, convert_to_melodic, convert_to_conduct, tarp_on,
 * tarp_style, tarp_rate, tarp_octaves, tarp_gate, tarp_steps_mode,
 * track_vel_override, tarp_step_vel, tarp_step_int, tarp_step_loop_len,
 * tarp_reset, tarp_latch, tarp_clear_latched, tarp_sync, tarp_retrigger.
 * See also sp_track_config.c (xpose/launch_clip/stop_at_end/deactivate/mute/
 * solo/channel/route/track_looper -- the other config-flavored keys).
 * Returns 1 when it handled the key (caller returns), 0 to fall through to
 * the sibling tN_ handlers. The tN_ guard and the tidx/sub/tr locals live in
 * the parent dispatcher now (seq8_set_param.c). */
static int sp_track_config2(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    /* Body below kept at its Stage-A segment indentation (8 spaces) so it
     * byte-diffs against the pre-conversion segment; reindent only in a
     * dedicated cleanup pass after the group is device-blessed. */

        if (!strcmp(sub, "clip_resolution")) {
            if (tr->recording) return 1;
            int idx = clamp_i(my_atoi(val), 0, 5);
            uint16_t new_tps = TPS_VALUES[idx];
            clip_t *cl = &tr->clips[tr->active_clip];
            uint16_t old_tps = cl->ticks_per_step;
            if (new_tps == old_tps) return 1;
            /* Rescale all notes proportionally */
            { uint32_t gmax_res = (uint32_t)SEQ_STEPS * new_tps;
              if (gmax_res > 65535) gmax_res = 65535;
              uint16_t ni;
              for (ni = 0; ni < cl->note_count; ni++) {
                  note_t *n = &cl->notes[ni];
                  n->tick = (uint32_t)((uint64_t)n->tick * new_tps / old_tps);
                  uint32_t new_gate = (uint32_t)((uint64_t)n->gate * new_tps / old_tps);
                  if (new_gate < 1) new_gate = 1;
                  if (new_gate > gmax_res) new_gate = gmax_res;
                  n->gate = (uint16_t)new_gate;
              }
            }
            cl->ticks_per_step = new_tps;
            /* Rescale current playback position */
            if (old_tps > 0)
                tr->tick_in_step = (uint32_t)((uint64_t)tr->tick_in_step * new_tps / old_tps);
            if (tr->tick_in_step >= new_tps) tr->tick_in_step = 0;
            /* Rebuild step arrays from rescaled notes */
            clip_build_steps_from_notes(cl);
            inst->state_dirty = 1;
            return 1;
        }

        if (!strcmp(sub, "clip_resolution_zoom")) {
            if (tr->recording) return 1;
            int idx = clamp_i(my_atoi(val), 0, 5);
            uint16_t new_tps = TPS_VALUES[idx];
            clip_t *cl = &tr->clips[tr->active_clip];
            uint16_t old_tps = cl->ticks_per_step;
            if (new_tps == old_tps) return 1;
            uint32_t old_ticks = (uint32_t)cl->length * (uint32_t)old_tps;
            uint32_t new_len32 = (old_ticks + (uint32_t)new_tps - 1) / (uint32_t)new_tps;
            if (new_len32 > SEQ_STEPS) return 1;
            uint32_t abs_clip_tick = (uint32_t)tr->current_step * (uint32_t)old_tps + tr->tick_in_step;
            cl->ticks_per_step = new_tps;
            cl->length = (uint16_t)new_len32;
            tr->current_step = (uint16_t)(abs_clip_tick / (uint32_t)new_tps);
            tr->tick_in_step  = abs_clip_tick % (uint32_t)new_tps;
            {
                uint16_t _le = (uint16_t)(cl->loop_start + cl->length);
                if (tr->current_step < cl->loop_start || tr->current_step >= _le) {
                    tr->current_step = cl->loop_start;
                    tr->tick_in_step = 0;
                }
            }
            clip_build_steps_from_notes(cl);
            inst->state_dirty = 1;
            return 1;
        }

        /* tN_pad_octave / tN_pad_mode */
        if (!strcmp(sub, "pad_octave")) {
            tr->pad_octave = (uint8_t)clamp_i(my_atoi(val), 0, 8);
            return 1;
        }
        if (!strcmp(sub, "pad_mode")) {
            uint8_t new_mode = (uint8_t)clamp_i(my_atoi(val), 0, 1);
            if (new_mode == PAD_MODE_DRUM && tr->pad_mode != PAD_MODE_DRUM)
                drum_clips_alloc(inst, tr);
            else if (new_mode != PAD_MODE_DRUM && tr->pad_mode == PAD_MODE_DRUM)
                drum_clips_free(tr);
            tr->pad_mode = new_mode;
            tarp_silence(inst, tr);
            return 1;
        }
        /* Track-type conversion: translate note content AND flip pad_mode
         * atomically (single set_param, no coalescing drop). Idempotent guards
         * make a redundant push a no-op. */
        if (!strcmp(sub, "convert_to_drum")) {
            if (tr->pad_mode != PAD_MODE_DRUM)
                convert_track_melodic_to_drum(inst, tidx);
            return 1;
        }
        if (!strcmp(sub, "convert_to_melodic")) {
            if (tr->pad_mode == PAD_MODE_DRUM)
                convert_track_drum_to_melodic(inst, tidx);
            else if (tr->pad_mode == PAD_MODE_CONDUCT)
                tr->pad_mode = PAD_MODE_MELODIC_SCALE;  /* note data already melodic */
            /* Leaving the Conductor role: clear the one-Conductor latch. */
            if (inst->conductor_track == tidx) {
                inst->conductor_track = -1;
                inst->state_dirty = 1;
            }
            return 1;
        }
        if (!strcmp(sub, "convert_to_conduct")) {
            if (inst->conductor_track >= 0 && inst->conductor_track != tidx) {
                return 1; /* JS reads back conductor_track and shows the OLED message */
            }
            if (tr->pad_mode == PAD_MODE_CONDUCT)
                return 1; /* idempotent: already the Conductor, redundant push is a no-op */
            convert_track_to_conduct(inst, tidx);
            inst->conductor_track = (int8_t)tidx;
            inst->state_dirty = 1;
            return 1;
        }

        /* TRACK ARP set_param handlers */
        if (!strcmp(sub, "tarp_on")) {
            int _v = my_atoi(val) ? 1 : 0;
            if (tr->tarp_on && !_v) tarp_silence(inst, tr);
            tr->tarp_on = (uint8_t)_v;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_style")) {
            int _v = clamp_i(my_atoi(val), 0, 9);
            if (_v == 0) {
                if (tr->tarp_on) tarp_silence(inst, tr);
                tr->tarp_on = 0;
            } else {
                tr->tarp_on = 1;
            }
            tr->tarp.style = (uint8_t)_v;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_rate")) {
            int _v = clamp_i(my_atoi(val), 0, 9);
            tr->tarp.rate_idx = (uint8_t)_v;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_octaves")) {
            int _v = clamp_i(my_atoi(val), -4, 4);
            tr->tarp.octaves = (int8_t)_v;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_gate")) {
            int _v = clamp_i(my_atoi(val), 1, 200);
            tr->tarp.gate_pct = (uint16_t)_v;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_steps_mode")) {
            int _v = clamp_i(my_atoi(val), 0, 2);
            tr->tarp.steps_mode = (uint8_t)_v;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "track_vel_override")) {
            tr->track_vel_override = (uint8_t)clamp_i(my_atoi(val), 0, 127);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_step_vel")) {
            /* Format: "S L" — step index 0..7, level 0..4 */
            const char *p = val;
            int s = 0, lv = 0;
            while (*p == ' ') p++;
            while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
            while (*p == ' ') p++;
            while (*p >= '0' && *p <= '9') { lv = lv * 10 + (*p - '0'); p++; }
            if (s < 0 || s > 7) return 1;
            lv = clamp_i(lv, 0, 4);
            tr->tarp.step_vel[s] = (uint8_t)lv;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_step_int")) {
            /* Format: "S I" — step index 0..7, signed interval -24..+24 (scale degrees). */
            const char *p = val;
            int s = 0, iv = 0, sign = 1;
            while (*p == ' ') p++;
            while (*p >= '0' && *p <= '9') { s = s * 10 + (*p - '0'); p++; }
            while (*p == ' ') p++;
            if (*p == '-') { sign = -1; p++; }
            else if (*p == '+') { p++; }
            while (*p >= '0' && *p <= '9') { iv = iv * 10 + (*p - '0'); p++; }
            if (s < 0 || s > 7) return 1;
            iv = clamp_i(iv * sign, -24, 24);
            tr->tarp.step_int[s] = (int8_t)iv;
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_step_loop_len")) {
            tr->tarp.step_loop_len = (uint8_t)clamp_i(my_atoi(val), 1, 8);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_reset")) {
            (void)val;
            arp_silence(inst, tr);
            tarp_drop_latched(inst, tr);
            arp_init_defaults(&tr->tarp);
            tr->tarp.held_count = 0;
            tr->tarp_on        = 0;
            tr->tarp_latch     = 0;
            tr->tarp_sync      = 1;
            tr->tarp_physical  = 0;
            inst->state_dirty  = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_latch")) {
            int _v = my_atoi(val) ? 1 : 0;
            uint8_t prev = tr->tarp_latch;
            tr->tarp_latch = (uint8_t)_v;
            if (prev && !_v) {
                /* Latch ON → OFF: drop latched (non-physical) entries from the
                 * held buffer, keep pads still physically held. If nothing is
                 * physically held, fall through to full silence. */
                tarp_drop_latched(inst, tr);
            }
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_clear_latched")) {
            /* User shortcut: drop latched (non-physical) entries from the held
             * buffer but keep tarp_latch=1. Functionally identical to the
             * latch-off compaction above, minus toggling tarp_latch. */
            tarp_drop_latched(inst, tr);
            return 1;
        }
        if (!strcmp(sub, "tarp_sync")) {
            tr->tarp_sync = (uint8_t)(my_atoi(val) ? 1 : 0);
            inst->state_dirty = 1;
            return 1;
        }
        if (!strcmp(sub, "tarp_retrigger")) {
            tr->tarp.retrigger = (uint8_t)(my_atoi(val) ? 1 : 0);
            inst->state_dirty = 1;
            return 1;
        }

    return 0;
}
