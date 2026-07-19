/* seq8_convert.c — track-type conversion (melodic <-> drum <-> conduct),
 * preserving note content; includes the track_is_empty fast-path check.
 * #include'd verbatim into seq8.c's single translation unit at the original
 * block position. Not compiled standalone — relies on seq8.c's prior context. */
/* ------------------------------------------------------------------ */
/* Track-type conversion (melodic <-> drum) — preserves note content.   */
/* Whole-track: all NUM_CLIPS clips convert. pad_mode flips INSIDE so    */
/* the type change is atomic with the data move (single set_param).      */
/* ------------------------------------------------------------------ */

/* True if the track has no note data on either representation — used to skip the
 * per-clip rewrite on an empty conversion. note_count is a conservative proxy
 * (counts tombstoned slots too): only an all-zero track is treated as empty, so
 * a track with deleted-but-not-compacted notes still takes the full path. */
static int track_is_empty(seq8_track_t *tr) {
    int c, l;
    for (c = 0; c < NUM_CLIPS; c++)
        if (tr->clips[c].note_count > 0) return 0;
    for (c = 0; c < NUM_CLIPS; c++) {
        if (!tr->drum_clips[c]) continue;
        for (l = 0; l < DRUM_LANES; l++)
            if (tr->drum_clips[c]->lanes[l].clip.note_count > 0) return 0;
    }
    return 1;
}

/* Melodic -> Drum: per clip, map the clip's DISTINCT pitches to drum lanes,
 * sorted ascending (lowest pitch -> lane 0). Each used pitch becomes one lane
 * with midi_note = that pitch; all notes of that pitch route into the lane,
 * preserving tick/vel/gate. A chord (several pitches at one tick) becomes
 * several lanes firing together. >DRUM_LANES distinct pitches: keep the
 * MOST-USED (tie -> higher pitch dropped first) so the groove survives. The
 * source melodic clip is cleared afterward — the melodic note serialize block
 * is NOT pad_mode-gated, so stale data would otherwise re-serialize and
 * resurrect on a later flip. */
static void convert_track_melodic_to_drum(seq8_instance_t *inst, int t) {
    seq8_track_t *tr = &inst->tracks[t];
    int c, l, ni, p;

    /* Force-disarm recording so nothing writes into a clip mid-rewrite. */
    tr->recording = 0;
    tr->record_armed = 0;
    tr->recording_pending_page = 0;

    /* Allocate drum clips for this track (entering drum mode). */
    drum_clips_alloc(inst, tr);

    /* Empty track: skip the per-clip rewrite (nothing to translate or clear). */
    if (!track_is_empty(tr))
    for (c = 0; c < NUM_CLIPS; c++) {
        clip_t *src = &tr->clips[c];
        drum_clip_t *dc = tr->drum_clips[c];

        /* Clean slate for this clip's lanes. */
        for (l = 0; l < DRUM_LANES; l++) {
            clip_init(&dc->lanes[l].clip);
            drum_pfx_params_init(&dc->lanes[l].pfx_params);
            dc->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
        }

        if (src->note_count == 0) { clip_init(src); continue; }

        /* Tally active notes per pitch. */
        int pcount[128];
        for (p = 0; p < 128; p++) pcount[p] = 0;
        for (ni = 0; ni < (int)src->note_count; ni++)
            if (src->notes[ni].active) pcount[src->notes[ni].pitch & 0x7F]++;

        int distinct = 0;
        for (p = 0; p < 128; p++) if (pcount[p] > 0) distinct++;

        int lane_of[128];
        for (p = 0; p < 128; p++) lane_of[p] = -1;

        if (distinct <= DRUM_LANES) {
            int lane = 0;
            for (p = 0; p < 128; p++)
                if (pcount[p] > 0) lane_of[p] = lane++;
        } else {
            /* Keep the DRUM_LANES most-used pitches; ascending p with strict
             * '>' keeps the lower pitch on a tie, so a higher pitch is dropped
             * first. Then assign survivors to lanes in ascending pitch order. */
            uint8_t keep[128];
            for (p = 0; p < 128; p++) keep[p] = 0;
            int kept = 0;
            while (kept < DRUM_LANES) {
                int best = -1, bestcnt = 0;
                for (p = 0; p < 128; p++)
                    if (pcount[p] > 0 && !keep[p] && pcount[p] > bestcnt) {
                        bestcnt = pcount[p]; best = p;
                    }
                if (best < 0) break;
                keep[best] = 1; kept++;
            }
            int lane = 0;
            for (p = 0; p < 128; p++)
                if (keep[p]) lane_of[p] = lane++;
            { char _cl[96]; snprintf(_cl, sizeof(_cl),
                "convert M->D t%d c%d: %d distinct, kept %d, dropped %d",
                t, c, distinct, kept, distinct - kept); seq8_ilog(inst, _cl); }
        }

        /* Lane metadata inherited from the source clip. */
        for (p = 0; p < 128; p++) {
            int lane = lane_of[p];
            if (lane < 0) continue;
            drum_lane_t *dl = &dc->lanes[lane];
            dl->clip.length         = src->length;
            dl->clip.ticks_per_step = src->ticks_per_step;
            dl->clip.loop_start     = src->loop_start;
            dl->midi_note           = (uint8_t)p;
        }

        /* Route every active note into its pitch's lane. */
        for (ni = 0; ni < (int)src->note_count; ni++) {
            note_t *n = &src->notes[ni];
            if (!n->active) continue;
            int lane = lane_of[n->pitch & 0x7F];
            if (lane < 0) continue;
            clip_insert_note(&dc->lanes[lane].clip, n->tick, n->gate, n->pitch, n->vel);
        }

        for (l = 0; l < DRUM_LANES; l++)
            if (dc->lanes[l].clip.note_count > 0)
                clip_build_steps_from_notes(&dc->lanes[l].clip);

        clip_init(src);   /* clear source (melodic serialize is not pad_mode-gated) */
    }

    tr->pad_mode = PAD_MODE_DRUM;

    /* Reset playheads for the now-drum track. */
    tr->current_step = 0;
    tr->tick_in_step = 0;
    for (l = 0; l < DRUM_LANES; l++) {
        clip_t *_dlc = &tr->drum_clips[tr->active_clip]->lanes[l].clip;
        tr->drum_current_step[l] = initial_clip_step(_dlc->loop_start, _dlc->length, _dlc->playback_dir);
        _dlc->pp_dir_state = initial_pp_dir(_dlc->playback_dir);
        tr->drum_tick_in_step[l] = 0;
    }

    silence_track_notes_v2(inst, tr);
    pfx_sync_from_clip(tr);   /* drum branch: reapply per-lane pfx */
    inst->state_dirty = 1;
}

/* Drum -> Melodic: merge all lanes' notes per clip into the melodic clip.
 * Each note keeps its own pitch (== lane midi_note unless retuned), tick, vel,
 * gate; lanes firing at the same tick naturally become a chord. Clip meta
 * (length/tps/loop_start) is inherited from the first non-empty lane. >512
 * notes/clip: capped, later notes dropped (logged). Drum lane data is cleared
 * afterward (keeps a future re-flip clean). Drum-only config (mute/solo,
 * repeat, euclid, per-lane pfx) has no melodic equivalent and is discarded. */
static void convert_track_drum_to_melodic(seq8_instance_t *inst, int t) {
    seq8_track_t *tr = &inst->tracks[t];
    int c, l, ni;

    tr->recording = 0;
    tr->record_armed = 0;
    tr->recording_pending_page = 0;

    /* Empty track: skip the per-clip rewrite (nothing to translate or clear). */
    if (!track_is_empty(tr))
    for (c = 0; c < NUM_CLIPS; c++) {
        drum_clip_t *dc = tr->drum_clips[c];
        clip_t *dst = &tr->clips[c];

        /* Meta from the first non-empty lane. */
        uint16_t m_len = (uint16_t)SEQ_STEPS_DEFAULT;
        uint16_t m_tps = (uint16_t)TICKS_PER_STEP;
        uint16_t m_ls  = 0;
        for (l = 0; l < DRUM_LANES; l++) {
            if (dc->lanes[l].clip.note_count > 0) {
                m_len = dc->lanes[l].clip.length;
                m_tps = dc->lanes[l].clip.ticks_per_step;
                m_ls  = dc->lanes[l].clip.loop_start;
                break;
            }
        }

        clip_init(dst);
        dst->length         = m_len;
        dst->ticks_per_step = m_tps;
        dst->loop_start     = m_ls;

        /* Merge lane notes (ascending lane, stored order -> deterministic drop). */
        int full = 0;
        for (l = 0; l < DRUM_LANES && !full; l++) {
            clip_t *lc = &dc->lanes[l].clip;
            for (ni = 0; ni < (int)lc->note_count; ni++) {
                note_t *n = &lc->notes[ni];
                if (!n->active) continue;
                if (clip_insert_note(dst, n->tick, n->gate, n->pitch, n->vel) < 0) {
                    seq8_ilog(inst, "convert D->M: clip full (512), notes dropped");
                    full = 1; break;
                }
            }
        }

        if (dst->note_count > 0) clip_build_steps_from_notes(dst);

        /* Clear drum lanes for a clean future re-flip. */
        for (l = 0; l < DRUM_LANES; l++) {
            clip_init(&dc->lanes[l].clip);
            drum_pfx_params_init(&dc->lanes[l].pfx_params);
            dc->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
        }
    }

    tr->pad_mode = PAD_MODE_MELODIC_SCALE;

    /* Clear drum clips (leaving drum mode). Clear-and-keep, NOT free: the
     * remote-UI snapshot may be reading them concurrently on a host worker
     * thread (monotonic allocation — see drum_clips_free in seq8.c). */
    drum_clips_reset(tr);

    /* Reset drum-only track state (no melodic equivalent). */
    tr->drum_lane_mute = 0;
    tr->drum_lane_solo = 0;
    tr->active_drum_lane = 0;
    tr->drum_perform_mode = 0;

    {
        clip_t *_cl = &tr->clips[tr->active_clip];
        tr->current_step = initial_clip_step(_cl->loop_start, _cl->length, _cl->playback_dir);
        _cl->pp_dir_state = initial_pp_dir(_cl->playback_dir);
    }
    tr->tick_in_step = 0;

    silence_track_notes_v2(inst, tr);
    pfx_sync_from_clip(tr);   /* melodic branch */
    inst->state_dirty = 1;
}

/* Melodic/Drum -> Conductor: PRESERVES each clip's melodic note/step data
 * (notes[], steps[], step_iter, step_random — note + duration + iteration +
 * probability) but CLEARS pfx, TARP (track arp / ARP IN), and CC/AT automation,
 * resetting them to the same defaults a fresh track gets. A drum track is first
 * converted to melodic so its note data survives as melodic notes. The role flag
 * (inst->conductor_track) is set by the set_param handler, NOT here. */
static void convert_track_to_conduct(seq8_instance_t *inst, int t) {
    seq8_track_t *tr = &inst->tracks[t];
    int c;

    /* Force-disarm recording so nothing writes into a clip mid-rewrite. */
    tr->recording = 0;
    tr->record_armed = 0;
    tr->recording_pending_page = 0;

    /* Drum -> melodic first so the note data becomes melodic notes (preserves
     * the music). This also frees drum clips and resets drum-only config. */
    if (tr->pad_mode == PAD_MODE_DRUM)
        convert_track_drum_to_melodic(inst, t);

    /* Clear per-clip pfx + automation to fresh-track defaults. Note/step data
     * (notes[], steps[], step_iter, step_random) is left untouched. */
    for (c = 0; c < NUM_CLIPS; c++) {
        clip_pfx_params_init(&tr->clips[c].pfx_params);
        cc_auto_reset(&tr->clip_cc_auto[c]);
        at_auto_reset(&tr->clip_at_auto[c]);
    }
    memset(tr->cc_auto_last_sent, 0xFF, 8);
    memset(tr->cc_auto_cur_val, 0xFF, 8);
    /* Reset CC latch-recording state (mirrors create_instance seq8.c:6246-6249).
     * If converted mid-recording, a stale cc_was_recording=1 would make the next
     * tick run cc_finalize_latch against the just-cleared automation. */
    tr->cc_latched       = 0;
    tr->cc_was_recording = 0;
    tr->cc_prev_ct       = 0;
    memset(tr->cc_latch_last_snap, 0xFF, sizeof(tr->cc_latch_last_snap));
    memset(tr->at_last_sent, 0xFF, AT_MAX_LANES);
    tr->at_last_clip = 0xFF;

    /* Clear TARP (track arp / ARP IN). Silence any sounding TARP note first,
     * then reset to defaults. (Track routing — channel/route/looper_on — is
     * track config, not pfx, and is intentionally preserved.) */
    tarp_silence(inst, tr);
    tarp_init_defaults(tr);

    tr->pad_mode = PAD_MODE_CONDUCT;

    /* Solo is disabled on the Conductor: clear any pre-existing solo on this
     * track so it can never sit in the soloed set (which would wrongly silence
     * every other track). Mute is intentionally preserved — it stays functional
     * on the Conductor. */
    inst->solo[t] = 0;

    silence_track_notes_v2(inst, tr);
    /* Flush any pending per-lane drum pfx swing-defer queues. silence_track_notes_v2
     * clears play_pending but NOT the drum_lane_pfx[].events[] swing queue, which the
     * unconditional per-track drain (drum_pfx_q_fire) would otherwise still fire as
     * MIDI mid-drain. The drum_pfx_emit guard already blocks the actual send, but
     * zeroing event_count here leaves nothing stranded in the queue. */
    {
        int _fl;
        for (_fl = 0; _fl < DRUM_LANES; _fl++)
            tr->drum_lane_pfx[_fl].event_count = 0;
    }
    /* Playhead/step state (current_step/tick_in_step) is intentionally left as-is:
     * the Conductor emits no MIDI, so there is nothing to re-anchor. (The sibling
     * convert_track_*_to_* functions reset these; this one deliberately does not.) */
    /* Re-pull the now-cleared per-clip pfx into the live track pfx stages
     * (matches the convert_track_*_to_* tails; preserves route/looper_on). */
    pfx_sync_from_clip(tr);
    inst->state_dirty = 1;
}
