/* FILE-SCOPE GLOBALS HANDLER for set_param()'s clip/row edit + undo/redo keys --
 * part of the seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (before set_param), NOT a standalone TU; never compile or
 * lint this file on its own. Globals handler (phase 4B group 12): dispatched
 * BEFORE the tN_ block, so it uses only inst/key/val (never tidx/tr/sub --
 * they aren't in scope at the globals dispatch point).
 * Covers GLOBAL-key branches: clip_copy, row_copy, clip_cut, row_cut,
 * drum_clip_copy, drum_clip_cut, row_clear, undo_restore, redo_restore. Each
 * is a top-level `strcmp(key,...)` branch. Returns 1 when it handled the key
 * (caller returns from set_param), 0 to fall through to the remaining globals
 * segment (transport) / the tN_ block. undo_restore/redo_restore build
 * inst->last_restore_info (char[64], read by JS); that string-build -- incl.
 * the deliberate `_off < _cap` snprintf-underflow clamp -- moves verbatim. */
static int sp_globals_edit(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *key = cx->key;
    const char *val = cx->val;

    if (!strcmp(key, "clip_copy")) {
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            clip_t *src = &inst->tracks[srcT].clips[srcC];
            clip_t *dst = &inst->tracks[dstT].clips[dstC];
            if (srcT == dstT && srcC == dstC) return 1;
            undo_begin_single(inst, dstT, dstC);
            dst->length        = src->length;
            dst->loop_start    = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->playback_dir   = src->playback_dir;
            dst->playback_audio_reverse = src->playback_audio_reverse;
            dst->pp_dir_state   = initial_pp_dir(dst->playback_dir);
            dst->pfx_params    = src->pfx_params;
            memcpy(dst->steps,           src->steps,           SEQ_STEPS);
            memcpy(dst->step_notes,      src->step_notes,      SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->step_vel,        src->step_vel,        SEQ_STEPS);
            memcpy(dst->step_gate,       src->step_gate,       SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            inst->tracks[dstT].clip_cc_auto[dstC] = inst->tracks[srcT].clip_cc_auto[srcC];
            inst->tracks[dstT].clip_at_auto[dstC] = inst->tracks[srcT].clip_at_auto[srcC];
            if ((int)inst->tracks[dstT].active_clip == dstC)
                pfx_sync_from_clip(&inst->tracks[dstT]);
        }
        return 1;
    }

    if (!strcmp(key, "row_copy")) {
        const char *p = val;
        int srcRow = 0, dstRow = 0, t;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') srcRow = srcRow*10 + (*p++ - '0');
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') dstRow = dstRow*10 + (*p++ - '0');
        srcRow = clamp_i(srcRow, 0, NUM_CLIPS-1);
        dstRow = clamp_i(dstRow, 0, NUM_CLIPS-1);
        if (srcRow == dstRow) return 1;
        undo_begin_row(inst, dstRow);
        for (t = 0; t < NUM_TRACKS; t++) {
            clip_t *src = &inst->tracks[t].clips[srcRow];
            clip_t *dst = &inst->tracks[t].clips[dstRow];
            dst->length         = src->length;
            dst->loop_start     = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->playback_dir   = src->playback_dir;
            dst->playback_audio_reverse = src->playback_audio_reverse;
            dst->pp_dir_state   = initial_pp_dir(dst->playback_dir);
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,           src->steps,           SEQ_STEPS);
            memcpy(dst->step_notes,      src->step_notes,      SEQ_STEPS * 8);
            memcpy(dst->step_note_count, src->step_note_count, SEQ_STEPS);
            memcpy(dst->step_vel,        src->step_vel,        SEQ_STEPS);
            memcpy(dst->step_gate,       src->step_gate,       SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            inst->tracks[t].clip_cc_auto[dstRow] = inst->tracks[t].clip_cc_auto[srcRow];
            inst->tracks[t].clip_at_auto[dstRow] = inst->tracks[t].clip_at_auto[srcRow];
            if ((int)inst->tracks[t].active_clip == dstRow)
                pfx_sync_from_clip(&inst->tracks[t]);
        }
        /* Copy drum clips for all tracks */
        for (t = 0; t < NUM_TRACKS; t++) {
            drum_clip_t *dsrc = inst->tracks[t].drum_clips[srcRow];
            drum_clip_t *ddst = inst->tracks[t].drum_clips[dstRow];
            int l;
            if (!dsrc) { /* nothing to copy; free dst if allocated */
                if (ddst) { free(ddst); inst->tracks[t].drum_clips[dstRow] = NULL; }
                continue;
            }
            if (!ddst) { /* allocate dst */
                ddst = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!ddst) continue;
                inst->tracks[t].drum_clips[dstRow] = ddst;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_init(&ddst->lanes[l].clip);
                    drum_pfx_params_init(&ddst->lanes[l].pfx_params);
                    ddst->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
                }
            }
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = ddst->lanes[l].midi_note;
                clip_t *sc = &dsrc->lanes[l].clip;
                clip_t *dc = &ddst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length         = sc->length;
                dc->loop_start     = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->playback_dir   = sc->playback_dir;
                dc->playback_audio_reverse = sc->playback_audio_reverse;
                dc->pp_dir_state   = initial_pp_dir(dc->playback_dir);
                dc->active         = sc->active;
                ddst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
            }
        }
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(key, "clip_cut")) {
        /* clip_cut "srcT srcC dstT dstC" — copy src→dst then hard-reset src; atomic undo */
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            if (srcT == dstT && srcC == dstC) return 1;
            seq8_track_t *srcTr = &inst->tracks[srcT];
            seq8_track_t *dstTr = &inst->tracks[dstT];
            clip_t *src = &srcTr->clips[srcC];
            clip_t *dst = &dstTr->clips[dstC];
            undo_begin_clip_pair(inst, srcT, srcC, dstT, dstC);
            dst->length         = src->length;
            dst->loop_start     = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->playback_dir   = src->playback_dir;
            dst->playback_audio_reverse = src->playback_audio_reverse;
            dst->pp_dir_state   = initial_pp_dir(dst->playback_dir);
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,            src->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            dstTr->clip_cc_auto[dstC] = srcTr->clip_cc_auto[srcC];
            dstTr->clip_at_auto[dstC] = srcTr->clip_at_auto[srcC];
            if ((int)dstTr->active_clip == dstC) pfx_sync_from_clip(dstTr);
            silence_track_notes_v2(inst, srcTr);
            clip_init(src);
            cc_auto_reset(&srcTr->clip_cc_auto[srcC]);
            at_auto_reset(&srcTr->clip_at_auto[srcC]);
            if ((int)srcTr->active_clip == srcC) pfx_sync_from_clip(srcTr);
            srcTr->rec_pending_count = 0;
            srcTr->recording = 0;
            if (srcTr->queued_clip == srcC) srcTr->queued_clip = -1;
            inst->state_dirty = 1;
        }
        return 1;
    }

    if (!strcmp(key, "row_cut")) {
        /* row_cut "srcRow dstRow" — copy all tracks src→dst then hard-reset src; atomic undo */
        const char *p = val;
        int srcRow = 0, dstRow = 0, t;
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') srcRow = srcRow*10 + (*p++ - '0');
        while (*p == ' ') p++;
        while (*p >= '0' && *p <= '9') dstRow = dstRow*10 + (*p++ - '0');
        srcRow = clamp_i(srcRow, 0, NUM_CLIPS-1);
        dstRow = clamp_i(dstRow, 0, NUM_CLIPS-1);
        if (srcRow == dstRow) return 1;
        undo_begin_row_pair(inst, srcRow, dstRow);
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *src = &tr->clips[srcRow];
            clip_t *dst = &tr->clips[dstRow];
            dst->length         = src->length;
            dst->loop_start     = src->loop_start;
            dst->ticks_per_step = src->ticks_per_step;
            dst->pfx_params     = src->pfx_params;
            memcpy(dst->steps,            src->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
            dst->active = src->active;
            clip_migrate_to_notes(dst);
            clip_copy_cond_fields(dst, src);
            tr->clip_cc_auto[dstRow] = tr->clip_cc_auto[srcRow];
            tr->clip_at_auto[dstRow] = tr->clip_at_auto[srcRow];
            if ((int)tr->active_clip == dstRow) pfx_sync_from_clip(tr);
            silence_track_notes_v2(inst, tr);
            clip_init(src);
            cc_auto_reset(&tr->clip_cc_auto[srcRow]);
            at_auto_reset(&tr->clip_at_auto[srcRow]);
            if ((int)tr->active_clip == srcRow) pfx_sync_from_clip(tr);
            tr->rec_pending_count = 0;
            tr->recording = 0;
            if (tr->queued_clip == srcRow) tr->queued_clip = -1;
        }
        /* Copy drum clips src→dst then clear src for all tracks */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            drum_clip_t *dsrc = tr->drum_clips[srcRow];
            drum_clip_t *ddst = tr->drum_clips[dstRow];
            int l;
            if (!dsrc && !ddst) continue;
            if (!dsrc) {
                /* Nothing to copy; re-init dst lanes (still drum mode) */
                for (l = 0; l < DRUM_LANES; l++) {
                    pfx_note_off_imm(inst, tr, ddst->lanes[l].midi_note);
                    clip_init(&ddst->lanes[l].clip);
                }
                continue;
            }
            if (!ddst) {
                ddst = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!ddst) continue;
                tr->drum_clips[dstRow] = ddst;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_init(&ddst->lanes[l].clip);
                    drum_pfx_params_init(&ddst->lanes[l].pfx_params);
                    ddst->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
                }
            }
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = ddst->lanes[l].midi_note;
                uint8_t src_midi_note = dsrc->lanes[l].midi_note;
                clip_t *sc = &dsrc->lanes[l].clip;
                clip_t *dc = &ddst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length         = sc->length;
                dc->loop_start     = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->active         = sc->active;
                ddst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
                pfx_note_off_imm(inst, tr, src_midi_note);
                clip_init(sc);
                dsrc->lanes[l].midi_note = src_midi_note;
            }
        }
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(key, "drum_clip_copy")) {
        /* drum_clip_copy "srcT srcC dstT dstC" — copy all 32 lanes; preserve dst midi_notes */
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            if (srcT == dstT && srcC == dstC) return 1;
            drum_clip_t *src = inst->tracks[srcT].drum_clips[srcC];
            drum_clip_t *dst = inst->tracks[dstT].drum_clips[dstC];
            if (!src || !dst) return 1;
            int l;
            undo_begin_drum_clip(inst, dstT, dstC);
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = dst->lanes[l].midi_note;
                clip_t *sc = &src->lanes[l].clip;
                clip_t *dc = &dst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length        = sc->length;
                dc->loop_start    = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->playback_dir  = sc->playback_dir;
                dc->playback_audio_reverse = sc->playback_audio_reverse;
                dc->pp_dir_state  = initial_pp_dir(dc->playback_dir);
                dc->active        = sc->active;
                dst->lanes[l].pfx_params = src->lanes[l].pfx_params;
                dst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
            }
            if (dstC == (int)inst->tracks[dstT].active_clip)
                pfx_sync_from_clip(&inst->tracks[dstT]);
            inst->state_dirty = 1;
        }
        return 1;
    }

    if (!strcmp(key, "drum_clip_cut")) {
        /* drum_clip_cut "srcT srcC dstT dstC" — copy all 32 lanes then clear src; undo dst only */
        const char *p = val;
        int nums[4], i;
        for (i = 0; i < 4; i++) {
            while (*p == ' ') p++;
            nums[i] = 0;
            while (*p >= '0' && *p <= '9') nums[i] = nums[i]*10 + (*p++ - '0');
        }
        {
            int srcT = clamp_i(nums[0], 0, NUM_TRACKS-1);
            int srcC = clamp_i(nums[1], 0, NUM_CLIPS-1);
            int dstT = clamp_i(nums[2], 0, NUM_TRACKS-1);
            int dstC = clamp_i(nums[3], 0, NUM_CLIPS-1);
            if (srcT == dstT && srcC == dstC) return 1;
            seq8_track_t *srcTr = &inst->tracks[srcT];
            seq8_track_t *dstTr = &inst->tracks[dstT];
            drum_clip_t *src = srcTr->drum_clips[srcC];
            drum_clip_t *dst = dstTr->drum_clips[dstC];
            if (!src || !dst) return 1;
            int l;
            undo_begin_drum_clip(inst, dstT, dstC);
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t dst_midi_note = dst->lanes[l].midi_note;
                uint8_t src_midi_note = src->lanes[l].midi_note;
                clip_t *sc = &src->lanes[l].clip;
                clip_t *dc = &dst->lanes[l].clip;
                memcpy(dc->steps,            sc->steps,            SEQ_STEPS);
                memcpy(dc->step_notes,       sc->step_notes,       SEQ_STEPS * 8);
                memcpy(dc->step_note_count,  sc->step_note_count,  SEQ_STEPS);
                memcpy(dc->step_vel,         sc->step_vel,         SEQ_STEPS);
                memcpy(dc->step_gate,        sc->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dc->note_tick_offset, sc->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dc->step_iter,    sc->step_iter,    SEQ_STEPS);
                memcpy(dc->step_random,  sc->step_random,  SEQ_STEPS);
                memcpy(dc->step_ratchet, sc->step_ratchet, SEQ_STEPS);
                dc->length        = sc->length;
                dc->loop_start    = sc->loop_start;
                dc->ticks_per_step = sc->ticks_per_step;
                dc->playback_dir  = sc->playback_dir;
                dc->playback_audio_reverse = sc->playback_audio_reverse;
                dc->pp_dir_state  = initial_pp_dir(dc->playback_dir);
                dc->active        = sc->active;
                dst->lanes[l].pfx_params = src->lanes[l].pfx_params;
                dst->lanes[l].midi_note = dst_midi_note;
                clip_migrate_to_notes(dc);
                pfx_note_off_imm(inst, srcTr, src_midi_note);
                clip_init(sc);
                drum_pfx_params_init(&src->lanes[l].pfx_params);
                src->lanes[l].midi_note = src_midi_note;
            }
            if (dstC == (int)dstTr->active_clip)
                pfx_sync_from_clip(dstTr);
            if (srcC == (int)srcTr->active_clip)
                pfx_sync_from_clip(srcTr);
            inst->state_dirty = 1;
        }
        return 1;
    }

    if (!strcmp(key, "row_clear")) {
        int rowIdx = clamp_i(my_atoi(val), 0, NUM_CLIPS-1);
        int t, i;
        undo_begin_row(inst, rowIdx);
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *cl = &tr->clips[rowIdx];
            for (i = 0; i < SEQ_STEPS; i++) {
                cl->steps[i] = 0;
                memset(cl->step_notes[i], 0, 8);
                cl->step_note_count[i] = 0;
                cl->step_vel[i]  = (uint8_t)SEQ_VEL;
                cl->step_gate[i] = (uint16_t)GATE_TICKS;
                memset(cl->note_tick_offset[i], 0, 8 * sizeof(int16_t));
            }
            cl->active          = 0;
            cl->stretch_exp     = 0;
            cl->clock_shift_pos = 0;
            cl->nudge_pos       = 0;
            cl->ticks_per_step  = TICKS_PER_STEP;
            cl->loop_start      = 0;
            clip_pfx_params_init(&cl->pfx_params);
            cl->note_count = 0;
            memset(cl->notes, 0, sizeof(cl->notes));
            cl->occ_dirty  = 1;
            if ((int)tr->active_clip == rowIdx) {
                silence_track_notes_v2(inst, tr);
                pfx_sync_from_clip(tr);
                tr->clip_playing      = 0;
                tr->will_relaunch     = 0;
                tr->queued_clip       = -1;
                tr->pending_page_stop = 0;
                tr->record_armed      = 0;
                tr->recording         = 0;
            } else if (tr->queued_clip == rowIdx) {
                tr->queued_clip = -1;
            }
        }
        /* Clear drum clips at rowIdx for all tracks */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            drum_clip_t *dc = tr->drum_clips[rowIdx];
            int l;
            if (!dc) continue;
            for (l = 0; l < DRUM_LANES; l++) {
                uint8_t midi_note = dc->lanes[l].midi_note;
                pfx_note_off_imm(inst, tr, midi_note);
                clip_init(&dc->lanes[l].clip);
                dc->lanes[l].midi_note = midi_note;
            }
        }
        inst->state_dirty = 1;
        return 1;
    }

    if (!strcmp(key, "undo_restore")) {
        int i;
        if (inst->drum_undo_valid) {
            /* Drum recording undo */
            int t = (int)inst->drum_undo_track, c = (int)inst->drum_undo_clip;
            drum_clip_t *dc = inst->tracks[t].drum_clips[c];
            if (!dc) {
                dc = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!dc) return 1;
                inst->tracks[t].drum_clips[c] = dc;
                int _li;
                for (_li = 0; _li < DRUM_LANES; _li++) {
                    clip_init(&dc->lanes[_li].clip);
                    drum_pfx_params_init(&dc->lanes[_li].pfx_params);
                    dc->lanes[_li].midi_note = (uint8_t)(DRUM_BASE_NOTE + _li);
                }
            }
            /* Capture redo */
            for (i = 0; i < DRUM_LANES; i++) {
                const drum_lane_t *lane = &dc->lanes[i];
                const clip_t *src = &lane->clip;
                drum_rec_snap_lane_t *dst = &inst->drum_redo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length     = src->length;
                dst->loop_start = src->loop_start;
                dst->active     = src->active;
                dst->playback_dir = src->playback_dir;
                dst->playback_audio_reverse = src->playback_audio_reverse;
                dst->pfx_params = lane->pfx_params;
            }
            inst->drum_redo_track = (uint8_t)t;
            inst->drum_redo_clip  = (uint8_t)c;
            inst->drum_redo_valid = 1;
            /* Restore */
            for (i = 0; i < DRUM_LANES; i++) {
                drum_lane_t *lane = &dc->lanes[i];
                clip_t *dst = &lane->clip;
                const drum_rec_snap_lane_t *src = &inst->drum_undo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length        = src->length;
                dst->loop_start    = src->loop_start;
                dst->active        = src->active;
                dst->playback_dir  = src->playback_dir;
                dst->playback_audio_reverse = src->playback_audio_reverse;
                dst->pp_dir_state  = initial_pp_dir(dst->playback_dir);
                lane->pfx_params   = src->pfx_params;
                clip_migrate_to_notes(dst);
            }
            if ((int)inst->tracks[t].active_clip == c)
                pfx_sync_from_clip(&inst->tracks[t]);
            inst->drum_undo_valid = 0;
            snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "d %d %d", t, c);
            return 1;
        }
        if (!inst->undo_valid) return 1;
        inst->redo_clip_count = inst->undo_clip_count;
        memcpy(inst->redo_clip_tracks,  inst->undo_clip_tracks,  inst->undo_clip_count);
        memcpy(inst->redo_clip_indices, inst->undo_clip_indices, inst->undo_clip_count);
        for (i = 0; i < (int)inst->undo_clip_count; i++) {
            int t = (int)inst->undo_clip_tracks[i], c = (int)inst->undo_clip_indices[i];
            memcpy(&inst->redo_clips[i], &inst->tracks[t].clips[c], sizeof(clip_t));
            memcpy(&inst->redo_auto_cc[i], &inst->tracks[t].clip_cc_auto[c], sizeof(cc_auto_t));
            memcpy(&inst->redo_auto_at[i], &inst->tracks[t].clip_at_auto[c], sizeof(at_auto_t));
        }
        inst->redo_valid = 1;
        apply_clip_restore(inst, inst->undo_clips,
                           inst->undo_clip_tracks, inst->undo_clip_indices,
                           inst->undo_clip_count);
        for (i = 0; i < (int)inst->undo_clip_count; i++) {
            int t = (int)inst->undo_clip_tracks[i], c = (int)inst->undo_clip_indices[i];
            memcpy(&inst->tracks[t].clip_cc_auto[c], &inst->undo_auto_cc[i], sizeof(cc_auto_t));
            memcpy(&inst->tracks[t].clip_at_auto[c], &inst->undo_auto_at[i], sizeof(at_auto_t));
            if ((int)inst->tracks[t].active_clip == c) {
                memset(inst->tracks[t].cc_auto_last_sent, 0xFF, 8);
                memset(inst->tracks[t].at_last_sent, 0xFF, AT_MAX_LANES);
            }
        }
        inst->undo_valid = 0;
        /* Also restore drum rows if snapshotted alongside melodic row undo */
        if (inst->drum_row_undo_valid) {
            int _s;
            /* Capture redo */
            for (_s = 0; _s < (int)inst->drum_row_undo_valid; _s++)
                drum_row_snap(inst, (int)inst->drum_row_undo_clips[_s], inst->drum_row_redo_lanes[_s]);
            memcpy(inst->drum_row_redo_clips, inst->drum_row_undo_clips, inst->drum_row_undo_valid);
            inst->drum_row_redo_valid = inst->drum_row_undo_valid;
            /* Restore */
            for (_s = 0; _s < (int)inst->drum_row_undo_valid; _s++)
                drum_row_restore(inst, (int)inst->drum_row_undo_clips[_s], inst->drum_row_undo_lanes[_s]);
            inst->drum_row_undo_valid = 0;
        }
        {
            /* snprintf returns the INTENDED length — clamp _off or the size
             * argument underflows once the buffer fills (16-clip row ops). */
            const int _cap = (int)sizeof(inst->last_restore_info) - 1;
            int _i, _off = snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "m");
            for (_i = 0; _i < (int)inst->redo_clip_count && _off < _cap; _i++)
                _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                 " %d %d", (int)inst->redo_clip_tracks[_i], (int)inst->redo_clip_indices[_i]);
            if (inst->drum_row_redo_valid) {
                int _s;
                for (_s = 0; _s < (int)inst->drum_row_redo_valid && _off < _cap; _s++)
                    _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                     " DR %d", (int)inst->drum_row_redo_clips[_s]);
            }
        }
        return 1;
    }

    if (!strcmp(key, "redo_restore")) {
        int i;
        if (inst->drum_redo_valid) {
            /* Drum recording redo */
            int t = (int)inst->drum_redo_track, c = (int)inst->drum_redo_clip;
            drum_clip_t *dc = inst->tracks[t].drum_clips[c];
            if (!dc) {
                dc = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
                if (!dc) return 1;
                inst->tracks[t].drum_clips[c] = dc;
                int _li;
                for (_li = 0; _li < DRUM_LANES; _li++) {
                    clip_init(&dc->lanes[_li].clip);
                    drum_pfx_params_init(&dc->lanes[_li].pfx_params);
                    dc->lanes[_li].midi_note = (uint8_t)(DRUM_BASE_NOTE + _li);
                }
            }
            /* Capture new undo */
            for (i = 0; i < DRUM_LANES; i++) {
                const drum_lane_t *lane = &dc->lanes[i];
                const clip_t *src = &lane->clip;
                drum_rec_snap_lane_t *dst = &inst->drum_undo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length     = src->length;
                dst->loop_start = src->loop_start;
                dst->active     = src->active;
                dst->playback_dir = src->playback_dir;
                dst->playback_audio_reverse = src->playback_audio_reverse;
                dst->pfx_params = lane->pfx_params;
            }
            inst->drum_undo_track = (uint8_t)t;
            inst->drum_undo_clip  = (uint8_t)c;
            inst->drum_undo_valid = 1;
            /* Restore redo */
            for (i = 0; i < DRUM_LANES; i++) {
                drum_lane_t *lane = &dc->lanes[i];
                clip_t *dst = &lane->clip;
                const drum_rec_snap_lane_t *src = &inst->drum_redo_lanes[i];
                memcpy(dst->steps,            src->steps,            SEQ_STEPS);
                memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
                memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
                memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
                memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
                memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
                memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
                memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
                memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
                dst->length       = src->length;
                dst->loop_start   = src->loop_start;
                dst->active       = src->active;
                lane->pfx_params  = src->pfx_params;
                clip_migrate_to_notes(dst);
            }
            if ((int)inst->tracks[t].active_clip == c)
                pfx_sync_from_clip(&inst->tracks[t]);
            inst->drum_redo_valid = 0;
            snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "d %d %d", t, c);
            return 1;
        }
        if (!inst->redo_valid) return 1;
        inst->undo_clip_count = inst->redo_clip_count;
        memcpy(inst->undo_clip_tracks,  inst->redo_clip_tracks,  inst->redo_clip_count);
        memcpy(inst->undo_clip_indices, inst->redo_clip_indices, inst->redo_clip_count);
        for (i = 0; i < (int)inst->redo_clip_count; i++) {
            int t = (int)inst->redo_clip_tracks[i], c = (int)inst->redo_clip_indices[i];
            memcpy(&inst->undo_clips[i], &inst->tracks[t].clips[c], sizeof(clip_t));
            memcpy(&inst->undo_auto_cc[i], &inst->tracks[t].clip_cc_auto[c], sizeof(cc_auto_t));
            memcpy(&inst->undo_auto_at[i], &inst->tracks[t].clip_at_auto[c], sizeof(at_auto_t));
        }
        inst->undo_valid = 1;
        apply_clip_restore(inst, inst->redo_clips,
                           inst->redo_clip_tracks, inst->redo_clip_indices,
                           inst->redo_clip_count);
        for (i = 0; i < (int)inst->redo_clip_count; i++) {
            int t = (int)inst->redo_clip_tracks[i], c = (int)inst->redo_clip_indices[i];
            memcpy(&inst->tracks[t].clip_cc_auto[c], &inst->redo_auto_cc[i], sizeof(cc_auto_t));
            memcpy(&inst->tracks[t].clip_at_auto[c], &inst->redo_auto_at[i], sizeof(at_auto_t));
            if ((int)inst->tracks[t].active_clip == c) {
                memset(inst->tracks[t].cc_auto_last_sent, 0xFF, 8);
                memset(inst->tracks[t].at_last_sent, 0xFF, AT_MAX_LANES);
            }
        }
        inst->redo_valid = 0;
        /* Also restore drum rows if snapshotted alongside melodic row redo */
        if (inst->drum_row_redo_valid) {
            int _s;
            /* Capture new undo */
            for (_s = 0; _s < (int)inst->drum_row_redo_valid; _s++)
                drum_row_snap(inst, (int)inst->drum_row_redo_clips[_s], inst->drum_row_undo_lanes[_s]);
            memcpy(inst->drum_row_undo_clips, inst->drum_row_redo_clips, inst->drum_row_redo_valid);
            inst->drum_row_undo_valid = inst->drum_row_redo_valid;
            /* Restore */
            for (_s = 0; _s < (int)inst->drum_row_redo_valid; _s++)
                drum_row_restore(inst, (int)inst->drum_row_redo_clips[_s], inst->drum_row_redo_lanes[_s]);
            inst->drum_row_redo_valid = 0;
        }
        {
            /* snprintf returns the INTENDED length — clamp _off or the size
             * argument underflows once the buffer fills (16-clip row ops). */
            const int _cap = (int)sizeof(inst->last_restore_info) - 1;
            int _i, _off = snprintf(inst->last_restore_info, sizeof(inst->last_restore_info), "m");
            for (_i = 0; _i < (int)inst->undo_clip_count && _off < _cap; _i++)
                _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                 " %d %d", (int)inst->undo_clip_tracks[_i], (int)inst->undo_clip_indices[_i]);
            if (inst->drum_row_undo_valid) {
                int _s;
                for (_s = 0; _s < (int)inst->drum_row_undo_valid && _off < _cap; _s++)
                    _off += snprintf(inst->last_restore_info + _off, sizeof(inst->last_restore_info) - (size_t)_off,
                                     " DR %d", (int)inst->drum_row_undo_clips[_s]);
            }
        }
        return 1;
    }

    return 0;
}
