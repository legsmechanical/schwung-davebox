/* FILE-SCOPE HANDLER for set_param()'s tN_ live-monitoring keys -- part of
 * the seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (immediately before set_param), NOT a standalone TU; never
 * compile or lint this file on its own. Seventh Stage B handler (phase 4B
 * group 7): the former mid-function segment is now a real static int
 * sp_track_live(sp_ctx_t *).
 * Covers tN_ track keys: live_notes, live_at, padmap.
 * Returns 1 when it handled the key (caller returns), 0 to fall through to
 * the sibling tN_ handlers. The tN_ guard and the tidx/sub/tr locals live in
 * the parent dispatcher now (seq8_set_param.c). */
static int sp_track_live(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    /* Body below kept at its Stage-A segment indentation (8 spaces) so it
     * byte-diffs against the pre-conversion segment; reindent only in a
     * dedicated cleanup pass after the group is device-blessed. */

        if (!strcmp(sub, "live_notes")) {
            /* tN_live_notes "off p ... on p v ... eon p v ... eoff p ..."
             * Batched live note events processed left-to-right. JS queues all
             * note events from one JS turn into pendingLiveNotes and drains
             * them into a single tN_live_notes payload via a microtask at
             * end-of-turn, so chord-press survives the host's same-buffer
             * set_param coalescing (which is per-buffer last-wins regardless
             * of key — distinct keys do NOT defeat it).
             * Routes through pfx_note_on/pfx_note_off_imm so play effects apply.
             *
             * Two token origins, distinguished by the 'e' prefix:
             *   on/off   — PAD-origin fallback. When dsp_inbound_enabled is
             *     set, on_midi already dispatched the pad event on the audio
             *     thread — skip these to avoid double-triggering (and
             *     corrupting tarp_physical). JS always queues them as a
             *     fallback for when the padmap push didn't reach DSP (the
             *     sentinel exists but on_midi can't dispatch without a valid
             *     pad_note_map).
             *   eon/eoff — EXT-origin (external cable-2 MIDI). The shim
             *     BLOCKS non-ROUTE_MOVE cable-2 input, so those notes never
             *     reach on_midi — this JS push is the ONLY live path for
             *     them. Always processed, even under inbound. JS only tags
             *     ext for non-ROUTE_MOVE tracks (ROUTE_MOVE ext is played
             *     natively by Move; the !routeIsMove guards never queue it). */
            const char *sp = val;
            while (*sp) {
                while (*sp == ' ') sp++;
                if (!*sp) break;
                int ext = 0;
                if (sp[0] == 'e') { ext = 1; sp++; }
                int is_on = -1;
                if (sp[0]=='o' && sp[1]=='n' && (sp[2]==' '||!sp[2]))
                    { is_on = 1; sp += 2; }
                else if (sp[0]=='o' && sp[1]=='f' && sp[2]=='f' && (sp[3]==' '||!sp[3]))
                    { is_on = 0; sp += 3; }
                else break;
                while (*sp == ' ') sp++;
                int pitch = 0;
                while (*sp >= '0' && *sp <= '9') { pitch = pitch * 10 + (*sp++ - '0'); }
                pitch = clamp_i(pitch, 0, 127);
                int process = ext || !inst->dsp_inbound_enabled;
                if (is_on) {
                    while (*sp == ' ') sp++;
                    int vel = SEQ_VEL;
                    if (*sp >= '0' && *sp <= '9') {
                        vel = 0;
                        while (*sp >= '0' && *sp <= '9') { vel = vel * 10 + (*sp++ - '0'); }
                    }
                    if (process)
                        live_note_on(inst, tr, (uint8_t)pitch, (uint8_t)clamp_i(vel, 1, 127));
                } else {
                    if (process)
                        live_note_off(inst, tr, (uint8_t)pitch);
                }
            }
            return 1;
        }

        if (!strcmp(sub, "live_at")) {
            /* tN_live_at "<pitch> <pressure> <mode>" — live pad-pressure
             * aftertouch. mode: 1 = poly (0xA0, pitch carries the sounded note),
             * 2 = channel (0xD0, track-wide, pitch ignored). Routed via pfx_send
             * so it reaches the track's output the same as notes (ROUTE_MOVE
             * inject / ROUTE_EXTERNAL USB / ROUTE_SCHWUNG internal). Stateless —
             * no recording/playback here (Phase 2). */
            int pitch = 0, press = 0, mode = 1;
            sscanf(val, "%d %d %d", &pitch, &press, &mode);
            uint8_t ch = tr->channel & 0x0F;
            uint8_t pv = (uint8_t)clamp_i(press, 0, 127);
            if (mode == 2) {
                pfx_send(&tr->pfx, (uint8_t)(0xD0 | ch), pv, 0);
                tr->last_poly_at_press = 0;  /* channel mode: no replay needed */
            } else {
                /* Store latest pressure so arp_fire_step / tarp_fire_step can
                 * replay it onto each newly-spawned voice. Without replay the
                 * stream stalls between knuckle motions and new arp voices
                 * are born at AT=0. */
                tr->last_poly_at_press = pv;
                if (tr->pfx.arp.style != 0 || tr->tarp.style != 0) {
                    /* Arp active: fan out across every currently-sounding
                     * output pitch (HARMZ copies, delay echoes, the sounding
                     * arp pitch). Falls back to the pad pitch when nothing
                     * is sounding mid-step. */
                    int any = 0, p;
                    for (p = 0; p < 128; p++) {
                        if (tr->pfx.pitch_refcount[p] > 0) {
                            pfx_send(&tr->pfx, (uint8_t)(0xA0 | ch),
                                     (uint8_t)p, pv);
                            any = 1;
                        }
                    }
                    if (!any) {
                        pfx_send(&tr->pfx, (uint8_t)(0xA0 | ch),
                                 (uint8_t)clamp_i(pitch, 0, 127), pv);
                    }
                } else {
                    pfx_send(&tr->pfx, (uint8_t)(0xA0 | ch),
                             (uint8_t)clamp_i(pitch, 0, 127), pv);
                }
            }
            /* Record into the active clip when armed+recording on a melodic track.
             * The live send above runs regardless, so AT is monitored during the
             * count-in (recording=0 then); capture starts at recording proper.
             * Snap to 1/32 (matches CC); lane keyed by pitch (poly) / 255 (chan). */
            if (tr->recording) {
                uint8_t  key  = (mode == 2) ? AT_LANE_CHAN : (uint8_t)clamp_i(pitch, 0, 127);
                /* Drum tracks freeze tr->current_clip_tick (only per-lane playheads
                 * advance), so derive the record tick from the master clock wrapped
                 * to the clip window — AT automation is track-level, not lane-aware. */
                uint32_t _at_rec = tr->current_clip_tick;
                if (tr->pad_mode == PAD_MODE_DRUM) {
                    clip_t *_atacl = &tr->clips[tr->active_clip];
                    uint32_t _atwl = (uint32_t)_atacl->length * _atacl->ticks_per_step;
                    uint32_t _atabs = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                                    + (uint32_t)inst->master_tick_in_step;
                    _at_rec = (uint32_t)_atacl->loop_start * _atacl->ticks_per_step
                            + (_atwl ? (_atabs % _atwl) : 0);
                }
                uint32_t snap = (_at_rec / 12) * 12;
                int lane = at_auto_alloc_lane(&tr->clip_at_auto[tr->active_clip], key);
                if (lane >= 0) {
                    at_auto_set_point(&tr->clip_at_auto[tr->active_clip], lane,
                                      (uint16_t)(snap <= 65534 ? snap : 65534),
                                      (uint8_t)clamp_i(press, 0, 127));
                    inst->state_dirty = 1;
                }
            }
            return 1;
        }

        if (!strcmp(sub, "padmap")) {
            /* tN_padmap "p0 p1 p2 ... p31" — 32 space-separated resolved
             * MIDI pitches for the 32 pads on track t. Pushed by JS whenever
             * computePadNoteMap recomputes (key / scale / scale-aware /
             * pad octave / layout / pad mode change). 0xFF = unmapped.
             * Consumed on the audio thread by on_midi. */
            const char *sp = val;
            int i;
            for (i = 0; i < 32; i++) {
                while (*sp == ' ') sp++;
                if (!*sp) break;
                int p = 0;
                while (*sp >= '0' && *sp <= '9') { p = p * 10 + (*sp++ - '0'); }
                if (p < 0)   p = 0xFF;
                if (p > 255) p = 0xFF;
                inst->pad_note_map[tidx][i] = (uint8_t)p;
            }
            /* Anything we didn't read stays at its previous value. JS is
             * expected to always send the full 32-entry payload.
             *
             * JS only ever pushes tN_padmap for the *currently active* track
             * (computePadNoteMap uses S.activeTrack), so the act of pushing
             * signals "this is now the active track." We piggyback active-
             * track sync here because the Schwung host drops module-defined
             * global set_param keys (only per-track-prefixed keys reach DSP
             * reliably).
             *
             * The push also serves as the capability signal for Phase 1:
             * JS only pushes tN_padmap when shadow_inbound_pad_midi_active
             * is present (patched Schwung). Pushing it survives DSP instance
             * recreate (state_load destroy/recreate path) because JS pushes
             * on every computePadNoteMap recompute, not just at init.
             * PHASE-1: remove the enable line when patches upstreamed. */
            inst->active_track = (uint8_t)tidx;
            /* This is the flag the live_notes branch above early-returns on:
             * once padmap enables inbound, on_midi owns live dispatch and a
             * following live_notes push is a no-op. Keep the two in sync. */
            inst->dsp_inbound_enabled = 1;
            /* 33rd token = pad_dispatch_muted. When set, on_midi skips
             * drum_pad_event so modal gestures (Shift+bottom-row track
             * shortcut, Delete/Loop/Mute/Copy/Capture holds, etc.) don't
             * trigger Rpt1/Rpt2 latch on the prior active track. */
            while (*sp == ' ') sp++;
            if (*sp) {
                int pdm = 0;
                while (*sp >= '0' && *sp <= '9') { pdm = pdm * 10 + (*sp++ - '0'); }
                inst->pad_dispatch_muted = (pdm != 0) ? 1 : 0;
            }
            /* 34th token = delete_held. Moved here from the separate
             * t0_delete_held set_param to share the padmap's tick-based
             * self-heal and avoid onMidiMessage coalescing. */
            while (*sp == ' ') sp++;
            if (*sp) {
                int dh = 0;
                while (*sp >= '0' && *sp <= '9') { dh = dh * 10 + (*sp++ - '0'); }
                inst->delete_held = (dh != 0) ? 1 : 0;
            }
            /* 35th token = corun_left_silent. Set when computePadNoteMap
             * intentionally maps the left-column drum pads to 0xFF for
             * Move-native co-run (double-hit suppression). on_midi uses it to
             * exclude these benign 0xFF presses from the pad-drop diagnostic. */
            while (*sp == ' ') sp++;
            if (*sp) {
                int cls = 0;
                while (*sp >= '0' && *sp <= '9') { cls = cls * 10 + (*sp++ - '0'); }
                inst->corun_left_silent = (cls != 0) ? 1 : 0;
            }
            return 1;
        }

    return 0;
}
