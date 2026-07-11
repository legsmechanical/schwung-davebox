/* FILE-SCOPE HANDLER for set_param()'s tN_ CC-automation keys -- part of the
 * seq8.c single translation unit; #included at FILE scope by
 * seq8_set_param.c (immediately before set_param), NOT a standalone TU;
 * never compile or lint this file on its own. Second Stage B handler
 * (phase 4B group 2): the former mid-function segment is now a real
 * static int sp_track_ccauto(sp_ctx_t *).
 * Covers tN_ track keys: cc_assign, cc_type_assign, cc_type, cc_send
 * (emits MIDI + recording latch), cc_rest, cc_auto_set, cc_auto_set2,
 * cc_auto_clear_k, cc_auto_clear_range, cc_auto_clear_step, cc_auto_clear.
 * Returns 1 when it handled the key (caller returns), 0 to fall through to
 * the sibling tN_ handlers. The tN_ guard and the tidx/sub/tr locals live in
 * the parent dispatcher now (seq8_set_param.c). */
static int sp_track_ccauto(sp_ctx_t *cx) {
    seq8_instance_t *inst = cx->inst;
    const char *val = cx->val;
    int tidx = cx->tidx;
    seq8_track_t *tr = cx->tr;
    const char *sub = cx->sub;

    if (!strcmp(sub, "cc_assign")) {
        /* Format: "K CC" — knob index 0-7, CC number 0-127 */
        const char *_p = val;
        int _k = 0, _cc = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _cc = _cc * 10 + (*_p - '0'); _p++; }
        if (_k < 0 || _k > 7) return 1;
        tr->cc_assign[_k] = (uint8_t)clamp_i(_cc, 0, 127);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_type_assign")) {
        /* Format: "K T A" — knob index 0-7, type 0-2, assign 0-127. Atomic. */
        const char *_p = val;
        int _k = 0, _tp = 0, _cc = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _tp = _tp * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _cc = _cc * 10 + (*_p - '0'); _p++; }
        if (_k < 0 || _k > 7) return 1;
        tr->cc_type[_k] = (uint8_t)clamp_i(_tp, 0, 2);
        tr->cc_assign[_k] = (uint8_t)clamp_i(_cc, 0, 127);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_type")) {
        /* Format: "K T" — knob index 0-7, type 0=CC, 1=Channel Pressure, 2=Chain knob (Sch). */
        const char *_p = val;
        int _k = 0, _tp = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _tp = _tp * 10 + (*_p - '0'); _p++; }
        if (_k < 0 || _k > 7) return 1;
        tr->cc_type[_k] = (uint8_t)clamp_i(_tp, 0, 2);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_send")) {
        /* Format: "K V" — knob index 0-7, CC value 0-127. Transmits immediately. */
        const char *_p = val;
        int _k = 0, _v = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _v = _v * 10 + (*_p - '0'); _p++; }
        if (_k < 0 || _k > 7) return 1;
        _v = clamp_i(_v, 0, 127);
        cc_emit(tr, _k, (uint8_t)_v);
        tr->cc_live_val[_k] = (uint8_t)_v;
        /* Latch this knob into overwrite recording on the first turn while
         * record-armed. The render path then writes the lane along the
         * playhead from cc_live_val (no point written here). Track-level —
         * works on drum and melodic alike (automation is not lane-aware).
         * Reset the latch snap on the 0->1 edge so the first 1/32 cell writes. */
        if (tr->recording) {
            if (!((tr->cc_latched >> _k) & 1)) {
                if (tr->cc_latched == 0)
                    undo_begin_single(inst, tidx, (int)tr->active_clip);
                tr->cc_latched |= (uint8_t)(1u << _k);
                tr->cc_latch_last_snap[_k] = 0xFFFFFFFFu;
            }
        }
        return 1;
    }
    if (!strcmp(sub, "cc_rest")) {
        /* Format: "C K V" — set clip C's resting value for knob K.
         * V 0..127 = set (and transmit live); V=255 = unset ("—", send
         * nothing). Used when stopped or playing on an un-automated lane.
         * Clip is explicit (JS focused clip may differ from active_clip). */
        const char *_p = val;
        int _c = 0, _k = 0, _v = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _v = _v * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return 1;
        cc_auto_t *_ca = &tr->clip_cc_auto[_c];
        if (_v >= 128) {
            _ca->rest_val[_k] = 0xFF;     /* "—" */
        } else {
            _v = clamp_i(_v, 0, 127);
            _ca->rest_val[_k]  = (uint8_t)_v;
            tr->cc_live_val[_k] = (uint8_t)_v;
            cc_emit(tr, _k, (uint8_t)_v); /* audible while turning */
        }
        if (_c == (int)tr->active_clip)
            tr->cc_auto_last_sent[_k] = 0xFF; /* re-assert on next play */
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_auto_set")) {
        /* Format: "C K T V" — clip, knob, tick, value. Writes step-edit automation. */
        const char *_p = val;
        int _c = 0, _k = 0, _tv = 0, _vv = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _tv = _tv * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _vv = _vv * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return 1;
        cc_auto_set_point(&tr->clip_cc_auto[_c], _k,
                          (uint16_t)clamp_i(_tv, 0, 65535),
                          (uint8_t)clamp_i(_vv, 0, 127));
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_auto_set2")) {
        /* Format: "C K T1 T2 V" — writes V at both T1 and T2; used for step-hold automation. */
        const char *_p = val;
        int _c = 0, _k = 0, _t1 = 0, _t2 = 0, _vv = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _t1 = _t1 * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _t2 = _t2 * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _vv = _vv * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return 1;
        _vv = clamp_i(_vv, 0, 127);
        _t1 = clamp_i(_t1, 0, 65535);
        _t2 = clamp_i(_t2, 0, 65535);
        /* Flat hold: drop any interior points in [t1,t2] first so a step
         * edit is a clean flat value with no stray recorded points. */
        cc_auto_clear_range(&tr->clip_cc_auto[_c], _k,
                            (uint16_t)_t1, (uint16_t)_t2);
        cc_auto_set_point(&tr->clip_cc_auto[_c], _k, (uint16_t)_t1, (uint8_t)_vv);
        if (_t2 != _t1)
            cc_auto_set_point(&tr->clip_cc_auto[_c], _k, (uint16_t)_t2, (uint8_t)_vv);
        if (_c == (int)tr->active_clip)
            tr->cc_auto_last_sent[_k] = 0xFF;
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_auto_clear_k")) {
        /* Format: "C K" — clear all automation points for knob K in clip C. */
        {   const char *_pc = val; int _cc = 0;
            while (*_pc == ' ') _pc++;
            while (*_pc >= '0' && *_pc <= '9') { _cc = _cc * 10 + (*_pc - '0'); _pc++; }
            if (_cc >= 0 && _cc < NUM_CLIPS) undo_begin_single(inst, tidx, _cc);
        }
        const char *_p = val;
        int _c = 0, _k = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return 1;
        tr->clip_cc_auto[_c].count[_k] = 0;
        memset(tr->clip_cc_auto[_c].ticks[_k], 0,
               CC_AUTO_MAX_POINTS * sizeof(uint16_t));
        memset(tr->clip_cc_auto[_c].vals[_k], 0, CC_AUTO_MAX_POINTS);
        tr->clip_cc_auto[_c].rest_val[_k] = 0xFF;   /* reset → "—" */
        if (_c == (int)tr->active_clip)
            tr->cc_auto_last_sent[_k] = 0xFF;
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_auto_clear_range")) {
        /* Format: "C K T1 T2" — drop knob K's points in [T1,T2] for clip C
         * (single-step clear / turn-to-"—"). Keeps the resting value. */
        const char *_p = val;
        int _c = 0, _k = 0, _t1 = 0, _t2 = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _k = _k * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _t1 = _t1 * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _t2 = _t2 * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS || _k < 0 || _k > 7) return 1;
        cc_auto_clear_range(&tr->clip_cc_auto[_c], _k,
                            (uint16_t)clamp_i(_t1, 0, 65535),
                            (uint16_t)clamp_i(_t2, 0, 65535));
        if (_c == (int)tr->active_clip)
            tr->cc_auto_last_sent[_k] = 0xFF;
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_auto_clear_step")) {
        /* Format: "C T1 T2" — drop ALL knobs' points in [T1,T2] for clip C
         * (whole-step wipe). Atomic so the 8 lanes don't coalesce. */
        {   const char *_pc = val; int _cc = 0;
            while (*_pc == ' ') _pc++;
            while (*_pc >= '0' && *_pc <= '9') { _cc = _cc * 10 + (*_pc - '0'); _pc++; }
            if (_cc >= 0 && _cc < NUM_CLIPS) undo_begin_single(inst, tidx, _cc);
        }
        const char *_p = val;
        int _c = 0, _t1 = 0, _t2 = 0, _k;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _t1 = _t1 * 10 + (*_p - '0'); _p++; }
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _t2 = _t2 * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS) return 1;
        for (_k = 0; _k < 8; _k++)
            cc_auto_clear_range(&tr->clip_cc_auto[_c], _k,
                                (uint16_t)clamp_i(_t1, 0, 65535),
                                (uint16_t)clamp_i(_t2, 0, 65535));
        if (_c == (int)tr->active_clip)
            memset(tr->cc_auto_last_sent, 0xFF, 8);
        inst->state_dirty = 1;
        return 1;
    }
    if (!strcmp(sub, "cc_auto_clear")) {
        /* Format: "C" — clear all CC automation + resting values for clip C. */
        const char *_p = val;
        int _c = 0;
        while (*_p == ' ') _p++;
        while (*_p >= '0' && *_p <= '9') { _c = _c * 10 + (*_p - '0'); _p++; }
        if (_c < 0 || _c >= NUM_CLIPS) return 1;
        undo_begin_single(inst, tidx, _c);
        cc_auto_reset(&tr->clip_cc_auto[_c]);       /* points + rest → "—" */
        if (_c == (int)tr->active_clip)
            memset(tr->cc_auto_last_sent, 0xFF, 8);
        inst->state_dirty = 1;
        return 1;
    }

    return 0;
}
