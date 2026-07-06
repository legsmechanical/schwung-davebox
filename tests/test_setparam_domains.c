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
 * per-clip note tokens in the table have already been asserted. */
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
        HX_ASSERT(strstr(b, ":55:111:"), "setup: t0 note :55:111: not serialized");
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

    hx_destroy(h);
    printf("PASS: set_param domain snapshot (%d domains + transport)\n", i);
    printf("PASS: track-config white-box pins "
           "(xpose/launch/stop/deactivate/route/channel/looper/mute-solo/conduct)\n");
    return 0;
}
