/* tests/test_setparam_domains.c — Phase 0: one representative key per
 * set_param domain; observable = the serialized state token (state_full).
 * Gates the Phase 4 set_param split — the future dispatcher must route
 * every domain identically. expect_substr values are FROZEN from a
 * verified first run: they document current serialization, they are not
 * aspirational.
 *
 * All cases share ONE instance, so values are chosen with distinct magic
 * numbers per case to avoid cross-token collisions. A few cases chain by
 * design on the same clip/step (melodic toggle -> step gate -> chord),
 * and MUST stay in that table order: each row asserts on the blob right
 * after its own set_param, before a later row mutates the same step.
 * The three consecutive t4_route rows also chain: the invalid-value row
 * asserts the route STAYS at the value the preceding "move" row set (no-op).
 *
 * Phase 4B prep: the sp_track_config group's 10 keys are characterized here
 * ahead of the Stage B handler conversion. Serialized-token keys (route,
 * channel, track_looper) are pinned as table rows; runtime-only / setup-heavy
 * keys (xpose_prev, xpose_apply, launch_clip, stop_at_end, deactivate, route
 * drum-lane fan-out, channel clamp, looper fan-out, mute<->solo exclusion,
 * Conductor-solo inertness) are pinned as white-box asserts in the block AFTER
 * the table loop. That ordering is deliberate: xpose_apply commits a GLOBAL
 * key/scale change and transposes every melodic clip, so it must run after all
 * per-clip note tokens in the table have already been asserted.
 *
 * Phase 4B group 2 prep: the sp_track_ccauto group's 11 keys are characterized
 * the same way. Serialized-token keys (cc_assign, cc_type, cc_auto_set point)
 * are table rows; the rest — cc_send (emitted CC + recording latch),
 * cc_type_assign, cc_rest (V=255 unset / V<128 emit / active-clip reset),
 * cc_auto_set2 flat-hold, and the four clears (clear_k / clear_range /
 * clear_step / clear) plus range guards — are white-box asserts in a SECOND
 * block after the track-config one. That block clears/inspects the MIDI
 * capture buffer and so must run after every table row that asserts on
 * captured MIDI. It works entirely on track 7 (melodic, ROUTE_SCHWUNG ->
 * internal MIDI capture; default channel == track index == 7; default
 * cc_type 0 / cc_assign = CC_ASSIGN_DEFAULT; active_clip 0), with distinct
 * clip/knob magic numbers per key so nothing collides.
 *
 * Phase 4B group 3 prep: the tN_lL_* drum-lane group (35 lane sub-keys + the
 * nested _step_S_* parser + the drum-alloc-on-first-lane-write trigger) is
 * characterized as a FOURTH white-box block, LAST before hx_destroy. It runs
 * entirely on track 3 — melodic until the block's first lane write flips it to
 * DRUM (the platform-critical allocation trigger: the Schwung host drops
 * tN_pad_mode / tN_convert_to_drum, so the first tN_lL_* key IS drum-mode entry
 * + drum_clips_alloc). t3 is never asserted after this block, so converting it
 * is collision-safe. Pins are direct struct inspection of
 * inst->tracks[3].drum_clips[0]->lanes[L] rather than serialized tokens: drum
 * lane tokens are doubly sparse (emitted only for a DRUM-mode track's lane that
 * has an active note), so struct reads pin the semantics far more robustly. One
 * distinct lane per concern so nothing collides. Serialized-token coverage for
 * this group already lives in the table: t6_l0_step_0_toggle (lane-note token),
 * t6_l2_mute (t6dlm), t6_l3_repeat_gate_set (t6l3rg). */
#include "harness.h"

typedef struct { const char *key, *val, *expect_substr, *domain; } sp_case_t;

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* transport: not serialized (write-only 'playing') — white-box pin */
    hx_set_param(h, "transport", "play");
    HX_ASSERT(inst->playing == 1, "transport play did not set playing");
    hx_set_param(h, "transport", "stop");
    HX_ASSERT(inst->playing == 0, "transport stop did not clear playing");

    static const sp_case_t cases[] = {
        /* key                       val          expect_substr             domain */
        { "bpm",                     "141",       "\"bpm\":141",            "tempo" },
        { "swing_amt",               "37",        "\"_swa\":37",            "swing" },
        { "key",                     "5",         "\"key\":5",              "tonality" },
        { "metro_vol",               "66",        "\"metro_vol\":66",       "metronome" },
        /* melodic step edit -> step gate -> chord: chained on t5 c0 step0.
         * step_vel=70 (from toggle), gate=33 (from _gate) both persist
         * through _set_notes via clip_migrate_to_notes. Keep this order. */
        { "t5_c0_step_0_toggle",     "88 70",     ":88:70:",                "clip/step melodic toggle" },
        { "t5_c0_step_0_gate",       "33",        ":88:70:33",              "clip/step gate" },
        /* pitch 69 = the chord's TOP note, chosen as representative because
         * it never appears in the blob before this write (62 could). */
        { "t5_c0_step_0_set_notes",  "62 65 69",  ":69:70:33",              "chord (_set_notes)" },
        /* drum lane note (t6 -> drum mode via lane write); pitch = DRUM_BASE_NOTE+lane = 36 */
        { "t6_l0_step_0_toggle",     "105",       "\"t6c0l0_n\":\"0:36:105:", "drum lane" },
        { "t6_l2_mute",              "1",         "\"t6dlm\":4",            "drum lane mute" },
        { "t6_l3_repeat_gate_set",   "42",        "\"t6l3rg\":42",          "drum repeat gate" },
        { "t6_drum_repeat_sync",     "0",         "\"t6dsy\":0",            "drum repeat sync" },
        { "t7_c3_length",            "13",        "\"t7c3_len\":13",        "clip length" },
        /* loop window: packed = loop_start<<16 | length = 3*65536 + 8 = 196616 */
        { "t7_c1_loop_set",          "196616",    "\"t7c1_ls\":3",          "loop window (_loop_set)" },
        { "t4_route",                "external",  "\"t4_rt\":2",            "track config (route)" },
        { "t4_route",                "schwung",   "\"t4_rt\":0",            "track config (route schwung)" },
        { "t4_route",                "move",      "\"t4_rt\":1",            "track config (route move)" },
        /* invalid route value = no-op: t4 stays at move (rt=1) from the row above */
        { "t4_route",                "bogus",     "\"t4_rt\":1",            "track config (route invalid no-op)" },
        /* channel: 1-indexed in -> 0-indexed stored (10 -> 9) */
        { "t1_channel",              "10",        "\"t1_ch\":9",            "track config (channel)" },
        /* track_looper: default 1 is sparse (unwritten); =0 is serialized */
        { "t1_track_looper",         "0",         "\"t1_lp\":0",            "track config (track_looper)" },
        { "t2_mute",                 "1",         "\"mute\":\"00100000\"",  "mute" },
        { "t3_solo",                 "1",         "\"solo\":\"00010000\"",  "solo" },
        { "t1_tarp_on",              "1",         "\"t1_taon\":1",          "tarp (TRACK ARP)" },
        { "t2_track_vel_override",   "123",       "\"t2_tvo\":123",         "velocity override" },
        { "t3_cc_rest",              "1 2 55",    "\"t3c1cr2\":55",         "cc-automation (rest val)" },
        /* cc-auto group serialized tokens (Phase 4B group 2 prep). Distinct
         * track/knob/clip from every other row so they never collide.
         * cc_assign knob3 default (CC_ASSIGN_DEFAULT[3]) is 73; 45 differs so
         * it serializes. cc_type knob5 default 0; 1 serializes. */
        { "t2_cc_assign",            "3 45",      "\"t2cca3\":45",          "cc-auto (cc_assign token)" },
        { "t2_cc_type",              "5 1",       "\"t2cct5\":1",           "cc-auto (cc_type token)" },
        /* cc_auto_set point: token = "t<trk>c<clip>ck<knob>":"tick:val;" */
        { "t2_cc_auto_set",          "2 4 300 88","\"t2c2ck4\":\"300:88;\"", "cc-auto (auto point token)" },
    };
    char blob[65536];
    int i, n;
    for (i = 0; i < (int)(sizeof(cases)/sizeof(cases[0])); i++) {
        hx_set_param(h, cases[i].key, cases[i].val);
        /* Re-dirty for state_full (it gates on state_dirty and clears it on
         * read). Scope limit: because bpm re-dirties unconditionally, this
         * test does NOT verify each handler sets state_dirty itself — the
         * Phase 4 split must preserve those flags by inspection/diff. */
        hx_set_param(h, "bpm", "141");
        n = hx_get_param(h, "state_full", blob, (int)sizeof(blob));
        HX_ASSERT(n > 0, "state_full empty");
        HX_ASSERT((size_t)n < sizeof(blob) - 1, "state_full at cap");
        blob[n] = '\0';
        if (!strstr(blob, cases[i].expect_substr)) {
            fprintf(stderr, "FAIL: domain %s: '%s' not in state after %s=%s\n",
                    cases[i].domain, cases[i].expect_substr, cases[i].key, cases[i].val);
            fprintf(stderr, "--- blob ---\n%s\n", blob);
            exit(1);
        }
    }
    /* ---- Track-config white-box pins (Phase 4B prep). Run AFTER the table
     * loop: xpose_apply commits a GLOBAL key/scale + transposes every melodic
     * clip, which would invalidate the table's per-clip note tokens. ---- */
    {
        char b[65536]; int nn;

        /* xpose_prev: arms the live preview (key/scale/active); leaves the
         * committed pad_key/pad_scale untouched. "<oldK> <oldS> <newK> <newS>". */
        uint8_t pk0 = inst->pad_key, ps0 = inst->pad_scale;
        hx_set_param(h, "t0_xpose_prev", "0 1 4 2");
        HX_ASSERT(inst->xpose_preview_active == 1, "xpose_prev must arm preview");
        HX_ASSERT(inst->xpose_preview_key == 4,   "xpose_prev key stored");
        HX_ASSERT(inst->xpose_preview_scale == 2, "xpose_prev scale stored");
        HX_ASSERT(inst->pad_key == pk0 && inst->pad_scale == ps0,
                  "xpose_prev must NOT commit pad_key/pad_scale");
        /* clamp: newK>11 -> 11, newS>13 -> 13 */
        hx_set_param(h, "t0_xpose_prev", "0 1 99 99");
        HX_ASSERT(inst->xpose_preview_key == 11 && inst->xpose_preview_scale == 13,
                  "xpose_prev clamp");

        /* xpose_apply flag=0: cancels preview, does NOT move pad_key/pad_scale. */
        pk0 = inst->pad_key; ps0 = inst->pad_scale;
        hx_set_param(h, "t0_xpose_apply", "0 1 7 3 0");
        HX_ASSERT(inst->xpose_preview_active == 0, "xpose_apply flag=0 clears preview");
        HX_ASSERT(inst->pad_key == pk0 && inst->pad_scale == ps0,
                  "xpose_apply flag=0 must NOT change pad_key/pad_scale");

        /* xpose_apply flag=1: commits key/scale (serialized "key"/"scale") AND
         * transposes existing melodic notes. Setup: an in-scale note on t7 c0
         * (t0 defaults to DRUM mode, which xpose_commit skips — use a melodic
         * track). Pitch 55 vel 111; commit 0-Minor -> 2-Minor (same scale, +2
         * root) remaps the in-scale pitch 55 -> 57. */
        hx_set_param(h, "t7_c0_step_0_toggle", "55 111");
        hx_set_param(h, "bpm", "141");
        nn = hx_get_param(h, "state_full", b, (int)sizeof(b)); b[nn] = '\0';
        HX_ASSERT(strstr(b, ":55:111:"), "setup: t7 note :55:111: not serialized");
        hx_set_param(h, "t0_xpose_apply", "0 1 2 1 1");
        HX_ASSERT(inst->xpose_preview_active == 0, "xpose_apply flag=1 clears preview");
        HX_ASSERT(inst->pad_key == 2 && inst->pad_scale == 1,
                  "xpose_apply flag=1 commits pad_key=2/pad_scale=1");
        hx_set_param(h, "bpm", "141");
        nn = hx_get_param(h, "state_full", b, (int)sizeof(b)); b[nn] = '\0';
        HX_ASSERT(strstr(b, "\"key\":2,"),   "xpose_apply flag=1 key token");
        HX_ASSERT(strstr(b, "\"scale\":1,"), "xpose_apply flag=1 scale token");
        HX_ASSERT(strstr(b, ":57:111:"),     "xpose_apply flag=1 must transpose 55->57");
    }

    /* launch_clip, stopped path: transport stopped + launch_quant=0 (Now) ->
     * queues the clip, arms will_relaunch, previews active_clip. */
    HX_ASSERT(inst->playing == 0, "precondition: transport stopped");
    HX_ASSERT(inst->launch_quant == 0, "precondition: launch_quant=Now(0)");
    hx_set_param(h, "t1_launch_clip", "7");
    HX_ASSERT(inst->tracks[1].queued_clip == 7,   "stopped launch: queued_clip");
    HX_ASSERT(inst->tracks[1].will_relaunch == 1, "stopped launch: will_relaunch");
    HX_ASSERT(inst->tracks[1].active_clip == 7,   "stopped launch: active_clip preview");

    /* launch_clip, immediate path: transport playing + launch_quant=0 -> fire now. */
    hx_set_param(h, "transport", "play");
    hx_set_param(h, "t2_launch_clip", "5");
    HX_ASSERT(inst->tracks[2].active_clip == 5,   "immediate launch: active_clip");
    HX_ASSERT(inst->tracks[2].clip_playing == 1,  "immediate launch: clip_playing");
    HX_ASSERT(inst->tracks[2].queued_clip == -1,  "immediate launch: queued_clip cleared");
    hx_set_param(h, "transport", "stop");   /* restore stopped state for later rows */

    /* stop_at_end: arms pending_page_stop (value ignored). */
    hx_set_param(h, "t3_stop_at_end", "1");
    HX_ASSERT(inst->tracks[3].pending_page_stop == 1, "stop_at_end: pending_page_stop");

    /* deactivate: cancels ALL pending/playing state. Arm a mix first
     * (stop_at_end above + a queued launch + the flags/masks with no setter). */
    hx_set_param(h, "t3_launch_clip", "4");
    HX_ASSERT(inst->tracks[3].queued_clip == 4, "deactivate setup: queued");
    inst->tracks[3].clip_playing       = 1;
    inst->tracks[3].record_armed       = 1;
    inst->tracks[3].step_dispatch_mask = 0xFF;
    inst->tracks[3].next_early_mask    = 0xFF;
    hx_set_param(h, "t3_deactivate", "1");
    HX_ASSERT(inst->tracks[3].clip_playing == 0,       "deactivate: clip_playing");
    HX_ASSERT(inst->tracks[3].will_relaunch == 0,      "deactivate: will_relaunch");
    HX_ASSERT(inst->tracks[3].queued_clip == -1,       "deactivate: queued_clip");
    HX_ASSERT(inst->tracks[3].pending_page_stop == 0,  "deactivate: pending_page_stop");
    HX_ASSERT(inst->tracks[3].record_armed == 0,       "deactivate: record_armed");
    HX_ASSERT(inst->tracks[3].step_dispatch_mask == 0, "deactivate: step_dispatch_mask");
    HX_ASSERT(inst->tracks[3].next_early_mask == 0,    "deactivate: next_early_mask");

    /* route: table pinned the schwung/move/external tokens + invalid no-op;
     * here white-box the drum_lane_pfx[] fan-out (all 32 lanes mirror pfx.route)
     * and re-confirm the invalid-value no-op at the runtime level. */
    hx_set_param(h, "t4_route", "external");
    HX_ASSERT(inst->tracks[4].pfx.route == ROUTE_EXTERNAL, "route: pfx.route");
    HX_ASSERT(inst->tracks[4].drum_lane_pfx[0].route == ROUTE_EXTERNAL, "route: lane0 fanout");
    HX_ASSERT(inst->tracks[4].drum_lane_pfx[DRUM_LANES-1].route == ROUTE_EXTERNAL, "route: lane31 fanout");
    hx_set_param(h, "t4_route", "zzz");   /* invalid: no-op */
    HX_ASSERT(inst->tracks[4].pfx.route == ROUTE_EXTERNAL, "route: invalid value is a no-op");

    /* channel: 1-indexed in -> 0-indexed stored, clamped 0..15. */
    hx_set_param(h, "t2_channel", "10");
    HX_ASSERT(inst->tracks[2].channel == 9,  "channel: 10 -> 9 (1-indexed)");
    hx_set_param(h, "t2_channel", "0");    /* 0-1 = -1 -> clamp 0 */
    HX_ASSERT(inst->tracks[2].channel == 0,  "channel: low clamp");
    hx_set_param(h, "t2_channel", "99");   /* 99-1 = 98 -> clamp 15 */
    HX_ASSERT(inst->tracks[2].channel == 15, "channel: high clamp");

    /* track_looper: pfx.looper_on + drum_lane_pfx[] fan-out, both polarities. */
    hx_set_param(h, "t4_track_looper", "0");
    HX_ASSERT(inst->tracks[4].pfx.looper_on == 0, "track_looper: pfx.looper_on=0");
    HX_ASSERT(inst->tracks[4].drum_lane_pfx[0].looper_on == 0, "track_looper: lane0 fanout 0");
    HX_ASSERT(inst->tracks[4].drum_lane_pfx[DRUM_LANES-1].looper_on == 0, "track_looper: lane31 fanout 0");
    hx_set_param(h, "t4_track_looper", "1");
    HX_ASSERT(inst->tracks[4].pfx.looper_on == 1, "track_looper: pfx.looper_on=1");
    HX_ASSERT(inst->tracks[4].drum_lane_pfx[DRUM_LANES-1].looper_on == 1, "track_looper: lane31 fanout 1");

    /* mute<->solo mutual exclusion on one track (existing table rows use t2/t3;
     * use t1 to avoid clobbering their bitstring assertions). */
    hx_set_param(h, "t1_solo", "1");
    HX_ASSERT(inst->solo[1] == 1 && inst->mute[1] == 0, "solo set");
    hx_set_param(h, "t1_mute", "1");
    HX_ASSERT(inst->mute[1] == 1 && inst->solo[1] == 0, "mute set clears solo");
    hx_set_param(h, "t1_solo", "1");
    HX_ASSERT(inst->solo[1] == 1 && inst->mute[1] == 0, "solo set clears mute");

    /* solo is inert on a Conductor track (handler early-returns). Convert t5 to
     * Conductor — reachable in-harness (the Schwung host-drop of convert_to_*
     * only bites on-device; the stub host delivers it). */
    hx_set_param(h, "t5_convert_to_conduct", "1");
    HX_ASSERT(inst->tracks[5].pad_mode == PAD_MODE_CONDUCT, "t5 must be CONDUCT");
    HX_ASSERT(inst->solo[5] == 0, "precondition: t5 solo clear");
    hx_set_param(h, "t5_solo", "1");
    HX_ASSERT(inst->solo[5] == 0, "solo must be inert on a Conductor track");

    /* ---- CC-auto group white-box pins (Phase 4B group 2 prep). Run LAST:
     * these are self-contained (own track/clip/knob magic numbers) and some
     * emit MIDI, so they clear/inspect the capture buffer and must not run
     * before rows that assert on captured MIDI. Track 7 is melodic + default
     * ROUTE_SCHWUNG (emits via midi_send_internal -> HX_MIDI_INTERNAL) with
     * default channel 7 (tr->channel == track index) and default cc_type=0 /
     * cc_assign = CC_ASSIGN_DEFAULT. active_clip is 0. ---- */
    {
        seq8_track_t *ct = &inst->tracks[7];

        /* cc_send "K V": emits the knob's CC live + latches into recording.
         * knob0: cc_type 0, cc_assign 7 -> CC 0xB7 07 100 on the internal bus. */
        ct->recording = 0; ct->cc_latched = 0;
        hx_clear_capture(h);
        hx_set_param(h, "t7_cc_send", "0 100");
        HX_ASSERT(ct->cc_live_val[0] == 100, "cc_send: cc_live_val[0]=100");
        {
            int found = 0, j;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == 0xB7 &&
                    e->bytes[2] == 7 && e->bytes[3] == 100) found = 1;
            }
            HX_ASSERT(found, "cc_send: emitted CC 0xB7 07 100 on internal route");
        }
        /* recording latch: first turn while record-armed sets the knob's
         * cc_latched bit + resets its cc_latch_last_snap to 0xFFFFFFFF. */
        ct->recording = 1; ct->cc_latched = 0;
        hx_set_param(h, "t7_cc_send", "1 90");
        HX_ASSERT((ct->cc_latched >> 1) & 1, "cc_send latch: knob1 bit set while recording");
        HX_ASSERT(ct->cc_latch_last_snap[1] == 0xFFFFFFFFu, "cc_send latch: snap reset to 0xFFFFFFFF");
        ct->recording = 0; ct->cc_latched = 0;   /* disarm for the rest */

        /* cc_rest "C K V": V>=128 => unset (0xFF, no MIDI); V<128 => set +
         * cc_live + emit, and on the active clip resets cc_auto_last_sent. */
        hx_set_param(h, "t7_cc_rest", "0 2 60");
        HX_ASSERT(ct->clip_cc_auto[0].rest_val[2] == 60, "cc_rest: set rest_val=60");
        hx_clear_capture(h);
        hx_set_param(h, "t7_cc_rest", "0 2 255");
        HX_ASSERT(ct->clip_cc_auto[0].rest_val[2] == 0xFF, "cc_rest: V=255 -> 0xFF (unset)");
        HX_ASSERT(hx_stub_event_count() == 0, "cc_rest: V=255 emits no MIDI");
        ct->cc_auto_last_sent[2] = 50;
        hx_clear_capture(h);
        hx_set_param(h, "t7_cc_rest", "0 2 44");
        HX_ASSERT(ct->clip_cc_auto[0].rest_val[2] == 44, "cc_rest: V<128 rest_val=44");
        HX_ASSERT(ct->cc_live_val[2] == 44, "cc_rest: V<128 cc_live_val=44");
        HX_ASSERT(ct->cc_auto_last_sent[2] == 0xFF, "cc_rest: active clip resets cc_auto_last_sent");
        {
            int found = 0, j;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                /* cc_assign[2] default = 71 */
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == 0xB7 &&
                    e->bytes[2] == 71 && e->bytes[3] == 44) found = 1;
            }
            HX_ASSERT(found, "cc_rest: V<128 emits CC 0xB7 71 44");
        }

        /* cc_type_assign "K T A": atomic type + assign write. */
        hx_set_param(h, "t7_cc_type_assign", "6 2 99");
        HX_ASSERT(ct->cc_type[6] == 2,  "cc_type_assign: cc_type[6]=2");
        HX_ASSERT(ct->cc_assign[6] == 99, "cc_type_assign: cc_assign[6]=99");

        /* cc_auto_set "C K T V": one interpolation point. */
        hx_set_param(h, "t7_cc_auto_set", "3 5 400 66");
        HX_ASSERT(ct->clip_cc_auto[3].count[5] == 1, "cc_auto_set: count=1");
        HX_ASSERT(ct->clip_cc_auto[3].ticks[5][0] == 400, "cc_auto_set: tick=400");
        HX_ASSERT(ct->clip_cc_auto[3].vals[5][0] == 66, "cc_auto_set: val=66");

        /* cc_auto_set2 "C K T1 T2 V": clear-range-then-two-endpoints (flat hold).
         * An interior point inside (T1,T2) is dropped; endpoints written at V. */
        hx_set_param(h, "t7_cc_auto_set", "4 6 50 30");   /* interior point */
        HX_ASSERT(ct->clip_cc_auto[4].count[6] == 1, "cc_auto_set2 setup: interior point");
        hx_set_param(h, "t7_cc_auto_set2", "4 6 0 100 77");
        HX_ASSERT(ct->clip_cc_auto[4].count[6] == 2, "cc_auto_set2: interior dropped, 2 endpoints");
        HX_ASSERT(ct->clip_cc_auto[4].ticks[6][0] == 0 &&
                  ct->clip_cc_auto[4].ticks[6][1] == 100, "cc_auto_set2: endpoint ticks 0,100");
        HX_ASSERT(ct->clip_cc_auto[4].vals[6][0] == 77 &&
                  ct->clip_cc_auto[4].vals[6][1] == 77, "cc_auto_set2: both endpoints = 77");
        /* T1==T2 writes a single point (only one set_point call). */
        hx_set_param(h, "t7_cc_auto_set2", "4 6 200 200 88");
        HX_ASSERT(ct->clip_cc_auto[4].count[6] == 3, "cc_auto_set2: T1==T2 adds one point");
        HX_ASSERT(ct->clip_cc_auto[4].ticks[6][2] == 200 &&
                  ct->clip_cc_auto[4].vals[6][2] == 88, "cc_auto_set2: T1==T2 point=200:88");

        /* cc_auto_clear_k "C K": zeroes count + resets rest to 0xFF; on the
         * active clip also resets cc_auto_last_sent. */
        hx_set_param(h, "t7_cc_auto_set", "0 3 120 55");
        hx_set_param(h, "t7_cc_rest", "0 3 40");
        HX_ASSERT(ct->clip_cc_auto[0].count[3] == 1, "cc_auto_clear_k setup: point present");
        ct->cc_auto_last_sent[3] = 20;
        hx_set_param(h, "t7_cc_auto_clear_k", "0 3");
        HX_ASSERT(ct->clip_cc_auto[0].count[3] == 0, "cc_auto_clear_k: count zeroed");
        HX_ASSERT(ct->clip_cc_auto[0].rest_val[3] == 0xFF, "cc_auto_clear_k: rest -> 0xFF");
        HX_ASSERT(ct->cc_auto_last_sent[3] == 0xFF, "cc_auto_clear_k: active clip last_sent reset");

        /* cc_auto_clear_range "C K T1 T2": drops only in-range points, keeps
         * out-of-range points and the resting value. */
        hx_set_param(h, "t7_cc_auto_set", "5 7 10 11");
        hx_set_param(h, "t7_cc_auto_set", "5 7 50 22");
        hx_set_param(h, "t7_cc_auto_set", "5 7 90 33");
        hx_set_param(h, "t7_cc_rest", "5 7 60");
        HX_ASSERT(ct->clip_cc_auto[5].count[7] == 3, "cc_auto_clear_range setup: 3 points");
        hx_set_param(h, "t7_cc_auto_clear_range", "5 7 40 60");
        HX_ASSERT(ct->clip_cc_auto[5].count[7] == 2, "cc_auto_clear_range: in-range point dropped");
        HX_ASSERT(ct->clip_cc_auto[5].ticks[7][0] == 10 &&
                  ct->clip_cc_auto[5].ticks[7][1] == 90, "cc_auto_clear_range: keeps out-of-range 10,90");
        HX_ASSERT(ct->clip_cc_auto[5].rest_val[7] == 60, "cc_auto_clear_range: keeps rest value");

        /* cc_auto_clear_step "C T1 T2": drops in-range points across ALL 8 knobs. */
        hx_set_param(h, "t7_cc_auto_set", "6 0 30 15");
        hx_set_param(h, "t7_cc_auto_set", "6 1 30 25");
        HX_ASSERT(ct->clip_cc_auto[6].count[0] == 1 &&
                  ct->clip_cc_auto[6].count[1] == 1, "cc_auto_clear_step setup: 2 knobs armed");
        hx_set_param(h, "t7_cc_auto_clear_step", "6 20 40");
        HX_ASSERT(ct->clip_cc_auto[6].count[0] == 0 &&
                  ct->clip_cc_auto[6].count[1] == 0, "cc_auto_clear_step: all knobs cleared in range");

        /* cc_auto_clear "C": full reset of clip C (points + rest -> "—"); on the
         * active clip also memsets cc_auto_last_sent to 0xFF. */
        hx_set_param(h, "t7_cc_auto_set", "6 2 44 55");
        hx_set_param(h, "t7_cc_rest", "6 2 70");
        HX_ASSERT(ct->clip_cc_auto[6].count[2] == 1 &&
                  ct->clip_cc_auto[6].rest_val[2] == 70, "cc_auto_clear setup: point + rest");
        hx_set_param(h, "t7_cc_auto_clear", "6");
        HX_ASSERT(ct->clip_cc_auto[6].count[2] == 0, "cc_auto_clear: points zeroed");
        HX_ASSERT(ct->clip_cc_auto[6].rest_val[2] == 0xFF, "cc_auto_clear: rest -> 0xFF");
        memset(ct->cc_auto_last_sent, 10, 8);
        hx_set_param(h, "t7_cc_auto_clear", "0");   /* clip 0 is active */
        HX_ASSERT(ct->cc_auto_last_sent[0] == 0xFF &&
                  ct->cc_auto_last_sent[7] == 0xFF, "cc_auto_clear: active clip memsets last_sent");

        /* Range guards: out-of-range knob (k=8) and clip index are no-ops. */
        {
            uint8_t a0 = ct->cc_assign[0];
            hx_set_param(h, "t7_cc_assign", "8 20");     /* k>7 -> return before write */
            HX_ASSERT(ct->cc_assign[0] == a0, "cc_assign: knob 8 is a no-op (no clobber)");
        }
        {
            uint16_t c00 = ct->clip_cc_auto[0].count[0];
            hx_set_param(h, "t7_cc_auto_set", "99 0 10 50"); /* clip>=NUM_CLIPS -> return */
            HX_ASSERT(ct->clip_cc_auto[0].count[0] == c00, "cc_auto_set: clip index OOB is a no-op");
        }
    }

    /* ---- Drum-lane white-box pins (Phase 4B group 3 prep). Run LAST:
     * self-contained on a dedicated drum track (t3, melodic until this block's
     * first lane write flips it), so nothing else asserts on it afterward.
     * Characterizes the whole tN_lL_* lane group — head lane-parse +
     * drum-alloc-on-first-lane-write, every lane sub-key, the nested _step_S_*
     * parser, and the repeat-groove setters — via direct struct inspection.
     * One distinct lane per concern so nothing collides. ---- */
    {
        seq8_track_t *dt = &inst->tracks[3];
        /* Lane writes land in drum_clips[active_clip]; t3's active_clip was
         * left non-zero by the track-config block's launch_clip preview, so
         * read it rather than assuming 0. */
        const int AC = dt->active_clip;

        /* HEAD + drum-alloc trigger: t3 is melodic here; the first tN_lL_* key
         * flips pad_mode to DRUM and allocates all 16 drum clips (each lane's
         * midi_note defaulting to DRUM_BASE_NOTE+lane). Platform-critical:
         * the only reliable drum-mode entry point on device. */
        HX_ASSERT(dt->pad_mode != PAD_MODE_DRUM, "precondition: t3 melodic before first lane write");
        HX_ASSERT(dt->drum_clips[AC] == NULL, "precondition: t3 drum_clips unallocated");
        hx_set_param(h, "t3_l4_lane_note", "50");
        HX_ASSERT(dt->pad_mode == PAD_MODE_DRUM, "first lane write flips t3 to DRUM mode");
        HX_ASSERT(dt->drum_clips[AC] != NULL, "first lane write allocates drum_clips[active]");
        HX_ASSERT(dt->drum_clips[NUM_CLIPS-1] != NULL, "alloc covers all 16 drum clips");
        /* _lane_note: this lane's base pitch, clamped 0..127. */
        HX_ASSERT(dt->drum_clips[AC]->lanes[4].midi_note == 50, "_lane_note: lane4 midi_note=50");
        HX_ASSERT(dt->drum_clips[AC]->lanes[5].midi_note == (uint8_t)(DRUM_BASE_NOTE + 5),
                  "_lane_note: untouched lane keeps default midi_note");

        /* Remote-UI note ops (monophonic lane; pitch forced to lane_note). */
        {
            clip_t *c4 = &dt->drum_clips[AC]->lanes[4].clip;
            uint16_t qi; int found;
            hx_set_param(h, "t3_l4_note_add", "0 77 12");
            HX_ASSERT(c4->note_count >= 1 && c4->notes[0].active, "_note_add: note present");
            HX_ASSERT(c4->notes[0].tick == 0 && c4->notes[0].pitch == 50 && c4->notes[0].vel == 77,
                      "_note_add: tick0, pitch=lane_note, vel=77");
            hx_set_param(h, "t3_l4_note_vel", "0 99");
            HX_ASSERT(c4->notes[0].vel == 99, "_note_vel: tick0 vel->99");
            hx_set_param(h, "t3_l4_note_resize", "0 30");
            HX_ASSERT(c4->notes[0].gate == 30, "_note_resize: tick0 gate->30");
            hx_set_param(h, "t3_l4_note_move", "0 24");
            HX_ASSERT(c4->notes[0].tick == 24, "_note_move: tick 0->24");
            hx_set_param(h, "t3_l4_note_del", "24");
            found = 0; for (qi = 0; qi < c4->note_count; qi++) if (c4->notes[qi].active) found = 1;
            HX_ASSERT(!found, "_note_del: lane emptied");
            hx_set_param(h, "t3_l4_note_toggle", "48");
            found = 0; for (qi = 0; qi < c4->note_count; qi++) if (c4->notes[qi].active && c4->notes[qi].tick == 48) found = 1;
            HX_ASSERT(found, "_note_toggle: adds hit at tick48 when absent");
            hx_set_param(h, "t3_l4_note_toggle", "48");
            found = 0; for (qi = 0; qi < c4->note_count; qi++) if (c4->notes[qi].active && c4->notes[qi].tick == 48) found = 1;
            HX_ASSERT(!found, "_note_toggle: second toggle removes the hit");
        }

        /* Nested _step_S_* parser: toggle/clear/vel/gate/nudge/iter/rand/ratch/
         * copy_to/reassign. Mirror to steps[]/step_notes[]/trig arrays. */
        {
            clip_t *c8 = &dt->drum_clips[AC]->lanes[8].clip;
            uint8_t ln8 = dt->drum_clips[AC]->lanes[8].midi_note;
            hx_set_param(h, "t3_l8_step_3_toggle", "90");
            HX_ASSERT(c8->steps[3] == 1 && c8->step_note_count[3] == 1, "_step_toggle: step3 activated");
            HX_ASSERT(c8->step_notes[3][0] == ln8 && c8->step_vel[3] == 90, "_step_toggle: lane note + vel90");
            HX_ASSERT(c8->active == 1, "_step_toggle: clip marked active");
            hx_set_param(h, "t3_l8_step_3_vel", "55");
            HX_ASSERT(c8->step_vel[3] == 55, "_step_vel: step3 vel->55");
            hx_set_param(h, "t3_l8_step_3_gate", "40");
            HX_ASSERT(c8->step_gate[3] == 40, "_step_gate: step3 gate->40");
            hx_set_param(h, "t3_l8_step_3_nudge", "5");
            HX_ASSERT(c8->note_tick_offset[3][0] == 5, "_step_nudge: offset->5");
            hx_set_param(h, "t3_l8_step_3_iter", "33");   /* len2 idx1 -> valid */
            HX_ASSERT(c8->step_iter[3] == 33, "_step_iter: raw 33 stored");
            hx_set_param(h, "t3_l8_step_3_rand", "50");
            HX_ASSERT(c8->step_random[3] == 50, "_step_rand: 50");
            hx_set_param(h, "t3_l8_step_3_ratch", "3");
            HX_ASSERT(c8->step_ratchet[3] == 3, "_step_ratch: 3");
            hx_set_param(h, "t3_l8_step_3_copy_to", "7");
            HX_ASSERT(c8->steps[7] == 1 && c8->step_note_count[7] == 1, "_step_copy_to: step7 populated");
            HX_ASSERT(c8->step_notes[7][0] == ln8 && c8->step_vel[7] == 55 && c8->step_gate[7] == 40,
                      "_step_copy_to: copies notes/vel/gate");
            HX_ASSERT(c8->step_iter[7] == 33 && c8->step_ratchet[7] == 3, "_step_copy_to: copies trig conditions");
            HX_ASSERT(c8->step_note_count[3] == 1, "_step_copy_to: SRC step3 unchanged");
            hx_set_param(h, "t3_l8_step_7_reassign", "11");
            HX_ASSERT(c8->step_note_count[11] == 1 && c8->steps[11] == 1, "_step_reassign: moved to step11");
            HX_ASSERT(c8->step_note_count[7] == 0 && c8->steps[7] == 0, "_step_reassign: SRC step7 cleared");
            hx_set_param(h, "t3_l8_step_3_clear", "0");
            HX_ASSERT(c8->steps[3] == 0 && c8->step_note_count[3] == 0, "_step_clear: step3 emptied");
            HX_ASSERT(c8->step_iter[3] == 0 && c8->step_ratchet[3] == 0, "_step_clear: trig conditions reset");
        }

        /* Lane-clip config setters (length / loop window / direction / resolution). */
        {
            clip_t *c12 = &dt->drum_clips[AC]->lanes[12].clip;
            hx_set_param(h, "t3_l12_clip_length", "13");
            HX_ASSERT(c12->length == 13, "_clip_length: length->13");
            /* loop_set packed = loop_start<<16 | length = 3*65536 + 8 = 196616 */
            hx_set_param(h, "t3_l12_loop_set", "196616");
            HX_ASSERT(c12->loop_start == 3 && c12->length == 8, "_loop_set: packed decode ls=3 len=8");
            /* _playback_dir 3 = Pingpong-Backward -> initial pp_dir_state -1.
             * (Mid-play playhead anchoring is transport/RT — out of harness scope.) */
            hx_set_param(h, "t3_l12_playback_dir", "3");
            HX_ASSERT(c12->playback_dir == 3, "_playback_dir: dir->3");
            HX_ASSERT(c12->pp_dir_state == -1, "_playback_dir: pp_dir_state initial -1 for dir 3");
            hx_set_param(h, "t3_l12_playback_audio_reverse", "1");
            HX_ASSERT(c12->playback_audio_reverse == 1, "_playback_audio_reverse: ->1");
            hx_set_param(h, "t3_l12_clip_resolution", "2");   /* TPS_VALUES[2]=48 */
            HX_ASSERT(c12->ticks_per_step == 48, "_clip_resolution: idx2 -> tps 48");
            /* _clip_resolution_zoom preserves absolute time: 8@48 (=384t) -> ceil(384/96)=4@96 */
            hx_set_param(h, "t3_l12_clip_resolution_zoom", "3");   /* TPS_VALUES[3]=96 */
            HX_ASSERT(c12->ticks_per_step == 96, "_clip_resolution_zoom: tps->96");
            HX_ASSERT(c12->length == 4, "_clip_resolution_zoom: length recomputed 8@48 -> 4@96");
        }

        /* _clear vs _hard_reset: clear PRESERVES clip geometry + groove; hard_reset
         * factory-resets clip (clip_init) AND the per-lane repeat groove. Both keep midi_note. */
        {
            clip_t *c14 = &dt->drum_clips[AC]->lanes[14].clip;
            hx_set_param(h, "t3_l14_step_2_toggle", "80");
            hx_set_param(h, "t3_l14_clip_length", "9");
            HX_ASSERT(c14->steps[2] == 1 && c14->length == 9, "_clear setup: note + length 9");
            hx_set_param(h, "t3_l14_clear", "1");
            HX_ASSERT(c14->steps[2] == 0 && c14->step_note_count[2] == 0 && c14->active == 0, "_clear: steps wiped");
            HX_ASSERT(c14->note_count == 0, "_clear: note_count zeroed");
            HX_ASSERT(c14->length == 9, "_clear: PRESERVES length (vs hard_reset)");
            HX_ASSERT(dt->drum_clips[AC]->lanes[14].midi_note == (uint8_t)(DRUM_BASE_NOTE + 14),
                      "_clear: preserves midi_note");

            clip_t *c16 = &dt->drum_clips[AC]->lanes[16].clip;
            hx_set_param(h, "t3_l16_step_1_toggle", "70");
            hx_set_param(h, "t3_l16_clip_length", "11");
            hx_set_param(h, "t3_l16_repeat_gate_set", "42");
            HX_ASSERT(c16->length == 11 && dt->drum_repeat_gate[16] == 42, "_hard_reset setup: length + gate");
            hx_set_param(h, "t3_l16_hard_reset", "1");
            HX_ASSERT(c16->length == SEQ_STEPS_DEFAULT, "_hard_reset: length reset to default (vs _clear)");
            HX_ASSERT(c16->steps[1] == 0, "_hard_reset: steps wiped");
            HX_ASSERT(dt->drum_repeat_gate[16] == 0xFF && dt->drum_repeat_gate_len[16] == 8,
                      "_hard_reset: repeat groove -> defaults");
            HX_ASSERT(dt->drum_clips[AC]->lanes[16].midi_note == (uint8_t)(DRUM_BASE_NOTE + 16),
                      "_hard_reset: preserves midi_note");
        }

        /* _loop_double_fill / _beat_stretch / _clock_shift / _nudge transforms. */
        {
            clip_t *c18 = &dt->drum_clips[AC]->lanes[18].clip;
            hx_set_param(h, "t3_l18_clip_length", "4");
            hx_set_param(h, "t3_l18_step_0_toggle", "100");
            hx_set_param(h, "t3_l18_step_1_toggle", "100");
            hx_set_param(h, "t3_l18_loop_double_fill", "1");
            HX_ASSERT(c18->length == 8, "_loop_double_fill: length 4->8");
            HX_ASSERT(c18->steps[4] == 1 && c18->steps[5] == 1, "_loop_double_fill: copies src into 2nd half");

            clip_t *c20 = &dt->drum_clips[AC]->lanes[20].clip;
            hx_set_param(h, "t3_l20_clip_length", "4");
            hx_set_param(h, "t3_l20_step_0_toggle", "100");
            int se0 = c20->stretch_exp;
            hx_set_param(h, "t3_l20_beat_stretch", "1");
            HX_ASSERT(c20->length == 8, "_beat_stretch: dir=1 length 4->8");
            HX_ASSERT(c20->stretch_exp == se0 + 1, "_beat_stretch: stretch_exp++");
            HX_ASSERT(c20->steps[0] == 1, "_beat_stretch: step0 kept at index 0");
            hx_set_param(h, "t3_l20_beat_stretch", "-1");
            HX_ASSERT(c20->length == 4, "_beat_stretch: dir=-1 length 8->4");
            HX_ASSERT(c20->stretch_exp == se0, "_beat_stretch: stretch_exp-- back");

            clip_t *c22 = &dt->drum_clips[AC]->lanes[22].clip;
            hx_set_param(h, "t3_l22_clip_length", "4");
            hx_set_param(h, "t3_l22_step_0_toggle", "100");
            hx_set_param(h, "t3_l22_clock_shift", "1");
            HX_ASSERT(c22->steps[1] == 1 && c22->steps[0] == 0, "_clock_shift: dir=1 rotates step0->step1");
            HX_ASSERT(c22->clock_shift_pos == 1, "_clock_shift: pos->1");

            clip_t *c24 = &dt->drum_clips[AC]->lanes[24].clip;
            hx_set_param(h, "t3_l24_step_0_toggle", "100");
            hx_set_param(h, "t3_l24_nudge", "1");
            HX_ASSERT(c24->note_tick_offset[0][0] == 1, "_nudge: dir=1 offset+1");
            HX_ASSERT(c24->nudge_pos == 1, "_nudge: pos+1");
            hx_set_param(h, "t3_l24_nudge", "0");
            HX_ASSERT(c24->nudge_pos == 0, "_nudge: dir=0 resets pos");
        }

        /* _pfx_set / _pfx_reset (per-lane drum pfx params). _lgto_apply legato. */
        {
            drum_pfx_params_t *pf26 = &dt->drum_clips[AC]->lanes[26].pfx_params;
            HX_ASSERT(pf26->gate_time == 100, "_pfx_set precondition: default gate_time 100");
            hx_set_param(h, "t3_l26_pfx_set", "gate_time 50");
            HX_ASSERT(pf26->gate_time == 50, "_pfx_set: gate_time->50");
            hx_set_param(h, "t3_l26_pfx_reset", "1");
            HX_ASSERT(pf26->gate_time == 100, "_pfx_reset: gate_time back to 100");

            /* _lgto_apply: note gate becomes gap to next note. Notes at tick0 &
             * tick48 (steps 0/2 @ tps24) -> tick0 gate = 48. */
            clip_t *c28 = &dt->drum_clips[AC]->lanes[28].clip;
            hx_set_param(h, "t3_l28_step_0_toggle", "100");
            hx_set_param(h, "t3_l28_step_2_toggle", "100");
            hx_set_param(h, "t3_l28_lgto_apply", "1");
            HX_ASSERT(c28->step_gate[0] == 48, "_lgto_apply: step0 gate = gap to next note (48)");
        }

        /* _copy_to: whole-lane copy, preserves DST midi_note, copies repeat groove,
         * leaves SRC intact. _cut_to: same then clears SRC (clip_init) + resets SRC
         * groove; SRC midi_note preserved. */
        {
            clip_t *csrc = &dt->drum_clips[AC]->lanes[2].clip;
            hx_set_param(h, "t3_l2_step_5_toggle", "111");
            hx_set_param(h, "t3_l2_repeat_gate_set", "7");
            hx_set_param(h, "t3_l30_lane_note", "99");   /* DST distinctive midi_note */
            hx_set_param(h, "t3_l2_copy_to", "30");
            clip_t *cdst = &dt->drum_clips[AC]->lanes[30].clip;
            HX_ASSERT(cdst->steps[5] == 1 && cdst->step_vel[5] == 111, "_copy_to: DST gets SRC step data");
            HX_ASSERT(dt->drum_clips[AC]->lanes[30].midi_note == 99, "_copy_to: preserves DST midi_note");
            HX_ASSERT(dt->drum_repeat_gate[30] == 7, "_copy_to: copies repeat-groove gate");
            HX_ASSERT(csrc->steps[5] == 1, "_copy_to: SRC unchanged");

            clip_t *ccutsrc = &dt->drum_clips[AC]->lanes[1].clip;
            hx_set_param(h, "t3_l1_lane_note", "60");
            hx_set_param(h, "t3_l1_step_6_toggle", "120");
            hx_set_param(h, "t3_l1_repeat_gate_set", "9");
            hx_set_param(h, "t3_l1_cut_to", "31");
            clip_t *ccutdst = &dt->drum_clips[AC]->lanes[31].clip;
            HX_ASSERT(ccutdst->steps[6] == 1 && ccutdst->step_vel[6] == 120, "_cut_to: DST gets SRC content");
            HX_ASSERT(dt->drum_repeat_gate[31] == 9, "_cut_to: moves repeat groove to DST");
            HX_ASSERT(ccutsrc->steps[6] == 0 && ccutsrc->active == 0, "_cut_to: SRC clip emptied");
            HX_ASSERT(dt->drum_clips[AC]->lanes[1].midi_note == 60, "_cut_to: SRC midi_note preserved");
            HX_ASSERT(dt->drum_repeat_gate[1] == 0xFF, "_cut_to: SRC repeat groove reset");
        }

        /* _euclid_stamp: E(k,n) diff. len8, prevN0 newN4 -> positions {0,2,4,6}. */
        {
            clip_t *ceu = &dt->drum_clips[AC]->lanes[10].clip;
            uint8_t ln10 = dt->drum_clips[AC]->lanes[10].midi_note;
            hx_set_param(h, "t3_l10_clip_length", "8");
            hx_set_param(h, "t3_l10_euclid_stamp", "0 4 100");
            HX_ASSERT(ceu->steps[0] && ceu->steps[2] && ceu->steps[4] && ceu->steps[6],
                      "_euclid_stamp: E(4,8) stamps 0,2,4,6");
            HX_ASSERT(!ceu->steps[1] && !ceu->steps[3], "_euclid_stamp: off-positions stay clear");
            HX_ASSERT(ceu->step_notes[0][0] == ln10, "_euclid_stamp: stamps lane note");
            HX_ASSERT(ceu->step_vel[0] == 100, "_euclid_stamp: uses given velocity");
            hx_set_param(h, "t3_l10_euclid_stamp", "4 0 100");
            HX_ASSERT(!ceu->steps[0] && !ceu->steps[2] && !ceu->steps[4] && !ceu->steps[6],
                      "_euclid_stamp: newN=0 unstamps all");
        }

        /* _mute / _solo: independent per-lane bitmasks (NOT mutually exclusive,
         * unlike track-level mute/solo). */
        hx_set_param(h, "t3_l5_mute", "1");
        HX_ASSERT((dt->drum_lane_mute >> 5) & 1, "_mute: lane5 bit set");
        hx_set_param(h, "t3_l5_solo", "1");
        HX_ASSERT((dt->drum_lane_solo >> 5) & 1, "_solo: lane5 bit set");
        HX_ASSERT((dt->drum_lane_mute >> 5) & 1, "_solo does NOT clear _mute (independent masks)");
        hx_set_param(h, "t3_l5_mute", "0");
        HX_ASSERT(!((dt->drum_lane_mute >> 5) & 1), "_mute 0: lane5 bit cleared");
        hx_set_param(h, "t3_l5_solo", "0");
        HX_ASSERT(!((dt->drum_lane_solo >> 5) & 1), "_solo 0: lane5 bit cleared");

        /* Repeat-groove setters (repeat_gate_set token pinned in table on t6l3). */
        hx_set_param(h, "t3_l7_repeat_gate_set", "0");
        hx_set_param(h, "t3_l7_repeat_gate_toggle", "3");
        HX_ASSERT(dt->drum_repeat_gate[7] == (1u << 3), "_repeat_gate_toggle: sets bit3 from 0");
        hx_set_param(h, "t3_l7_repeat_gate_toggle", "3");
        HX_ASSERT(dt->drum_repeat_gate[7] == 0, "_repeat_gate_toggle: toggles bit3 back off");
        hx_set_param(h, "t3_l7_repeat_gate_len", "5");
        HX_ASSERT(dt->drum_repeat_gate_len[7] == 5, "_repeat_gate_len: ->5");
        hx_set_param(h, "t3_l7_repeat_gate_and_len", "170 6");
        HX_ASSERT(dt->drum_repeat_gate[7] == 170 && dt->drum_repeat_gate_len[7] == 6,
                  "_repeat_gate_and_len: atomic mask+len");
        hx_set_param(h, "t3_l7_repeat_vel_scale", "2 150");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][2] == 150, "_repeat_vel_scale: step2 ->150");
        hx_set_param(h, "t3_l7_repeat_nudge", "2 -20");
        HX_ASSERT(dt->drum_repeat_nudge[7][2] == -20, "_repeat_nudge: step2 ->-20");
        hx_set_param(h, "t3_l7_repeat_defaults", "2");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][2] == 100 && dt->drum_repeat_nudge[7][2] == 0,
                  "_repeat_defaults: step2 vel/nudge reset");
        HX_ASSERT(dt->drum_repeat_gate[7] == 170, "_repeat_defaults: does NOT touch gate mask");
        hx_set_param(h, "t3_l7_repeat_groove_reset", "1");
        HX_ASSERT(dt->drum_repeat_gate[7] == 0xFF && dt->drum_repeat_gate_len[7] == 8,
                  "_repeat_groove_reset: gate/len -> defaults");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][0] == 100 && dt->drum_repeat_nudge[7][0] == 0,
                  "_repeat_groove_reset: vel/nudge -> defaults");

        /* Lane-index guard: lane >= DRUM_LANES returns before any write. */
        {
            uint32_t m0 = dt->drum_lane_mute;
            hx_set_param(h, "t3_l99_mute", "1");   /* lane 99 >= 32 -> no-op */
            HX_ASSERT(dt->drum_lane_mute == m0, "lane index >= DRUM_LANES is a no-op");
        }
    }

    hx_destroy(h);
    printf("PASS: set_param domain snapshot (%d domains + transport)\n", i);
    printf("PASS: track-config white-box pins "
           "(xpose/launch/stop/deactivate/route/channel/looper/mute-solo/conduct)\n");
    printf("PASS: cc-auto white-box pins "
           "(cc_send/latch, cc_rest, cc_type_assign, cc_auto_set/set2/clear_k/"
           "clear_range/clear_step/clear, range guards)\n");
    printf("PASS: drum-lane white-box pins "
           "(alloc-trigger/lane_note, note-ops, step-parser, clip config, "
           "clear/hard_reset, double_fill/beat_stretch/clock_shift/nudge, "
           "pfx/lgto, copy_to/cut_to, euclid, mute/solo, repeat-groove, lane guard)\n");
    return 0;
}
