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
 * characterized as a FOURTH white-box block (all white-box blocks run after
 * the table, in file order). It runs entirely on track 3 — melodic until the block's first lane write flips it to
 * DRUM (the platform-critical allocation trigger: the Schwung host drops
 * tN_pad_mode / tN_convert_to_drum, so the first tN_lL_* key IS drum-mode entry
 * + drum_clips_alloc). t3 is never asserted after this block, so converting it
 * is collision-safe. Pins are direct struct inspection of
 * inst->tracks[3].drum_clips[0]->lanes[L] rather than serialized tokens: drum
 * lane tokens are doubly sparse (emitted only for a DRUM-mode track's lane that
 * has an active note), so struct reads pin the semantics far more robustly. One
 * distinct lane per concern so nothing collides. Serialized-token coverage for
 * this group already lives in the table: t6_l0_step_0_toggle (lane-note token),
 * t6_l2_mute (t6dlm), t6_l3_repeat_gate_set (t6l3rg).
 *
 * Phase 4B group 4 prep: the tN_cC_* per-clip block (the single
 * `if (sub[0]=='c' && digit)` clip block in sp_track_clip.c) is characterized
 * as a FIFTH white-box block (blocks run after the table, in file order). It
 * runs on a dedicated MELODIC track (t4 — route/looper touched earlier but never given clip note
 * data, and it stays melodic) plus t3 (already DRUM from the group-3 block, its
 * drum_clips allocated) for the two drum-clip variants (_drum_clear /
 * _drum_reset). Neither track is asserted after this block, so the magic
 * clip/step/knob indices here are collision-safe. Pins are direct struct
 * inspection (notes[]/steps[]/step arrays, clip_cc_auto[] lane fields, cond_
 * fields, pfx_params, rui_sel_ / rui_cc_focus) rather than serialized tokens: per-clip
 * note/step content is far more robustly pinned by reading the clip_t than by
 * the sparse serialization. One distinct clip per concern. Serialized-token
 * coverage for this group already lives in the table (t5_c0_step_0_toggle/_gate/
 * _set_notes, t7_c3_length, t7_c1_loop_set); the _length rui_rev freeze-fix
 * (`if (!tr->recording) rui_touch(inst);`) is pinned separately in
 * test_rui_rev.c and is NOT duplicated here.
 *
 * Phase 4B group 5 prep: the sp_track_config2 group (clip_resolution[_zoom],
 * pad_octave, pad_mode, convert_to_drum/_melodic, the full tarp_* run, and
 * track_vel_override) is characterized as a SIXTH white-box block (blocks run
 * after the table, in file order). It runs on a DEDICATED track (t2): track 0 is the harness's default
 * DRUM track, so t2 is used as a melodic track whose prior touches
 * (channel/tvo/cc-auto/launch) don't intersect this group's keys and whose tarp
 * state is pristine at block entry. The block forces t2's active_clip back to 0
 * (an earlier immediate-launch left it at 5) so the active-clip resolution keys
 * hit a clean clip. The block is self-contained: resolution/tarp/pad_octave pins
 * run first (t2 stays melodic), then the TYPE-CONVERSION pins (pad_mode /
 * convert_to_drum / convert_to_melodic, which flip t2's type + alloc/free
 * drum_clips) run LAST so a type flip can't corrupt an earlier melodic pin.
 * Nothing asserts t2 after this block, so the flips are collision-safe. Pins are
 * a mix of direct struct reads (runtime-only fields: pad_octave,
 * tarp_latch/reset/clear_latched runtime bits, drum_clips alloc state) and
 * serialized-token asserts via state_full (the sparse tarp tokens
 * t2_tast/tart/taoc/tagt/tasm/tasv3/tasi2/tasll/tasy/targ). Already-covered keys
 * are NOT duplicated: tarp_on (t1_taon table row), track_vel_override (t2_tvo
 * table row), convert_to_conduct's happy path (track-config block's Conductor-
 * solo inertness). This block DOES add a distinct convert_to_conduct facet —
 * the "another track already Conductor" early-return no-op — which REQUIRES the
 * track-config block to have latched conductor_track to t5 first (chaining
 * constraint: this block must run after that one). tarp_reset's retrigger quirk
 * is pinned: arp_init_defaults sets retrigger=1 and tarp_reset does NOT re-clear
 * it, so a post-reset tarp.retrigger reads 1 (NOT 0).
 *
 * Phase 4B group 6 prep: the sp_track_record group (recording arm/disarm,
 * record_note_on, record_note_off) is characterized as a SEVENTH white-box
 * block (currently the last; all white-box blocks run after the table, in file
 * order). It runs on a DEDICATED track (t1): t1 is
 * melodic and never given clip note data (earlier rows touched only its
 * config — channel/looper/mute/solo/tarp/launch_clip), and nothing asserts
 * t1 after this block, so its clip mutations are collision-safe. The block
 * first RESETS t1's recording-relevant leftovers (tarp_on=1 from the table,
 * queued_clip/active_clip=7 from the launch_clip preview) to a clean
 * non-playing melodic baseline, then drives each arm branch by setting
 * clip_playing/queued_clip directly. TICK-SOURCE: this suite never arms
 * dsp_inbound via a tN_padmap push, so inst->dsp_inbound_enabled==0 and both
 * record_note_on/off take the STOCK path (capture tick = tr->current_clip_tick,
 * set white-box) — the on_midi press/release-slot path and the rv==2 adaptive
 * defer (recording_pending_page/adaptive_arm, gated on transport+clip playing)
 * are RT-only and pinned as out-of-scope. Pins are direct struct reads (flag
 * transitions, notes[]/steps[] capture, note_t gate) — recording writes are
 * sparse and RT-driven, so struct inspection pins the semantics far more
 * robustly than the serialized token. */
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

    /* ---- CC-auto group white-box pins (Phase 4B group 2 prep). Runs after the table:
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

    /* ---- Drum-lane white-box pins (Phase 4B group 3 prep). Runs after the table:
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

    /* ---- Per-clip white-box pins (Phase 4B group 4 prep). Runs after the table:
     * self-contained on a dedicated MELODIC track (t4) + the group-3 DRUM track
     * (t3) for the drum-clip variants. Characterizes the whole tN_cC_* block —
     * ruisel/cc_focus, remote-UI note ops, the nested _step_S_* parser, per-clip
     * resolution/dir/loop_set/length clamps, the _kN_cc_* lane loop sub-block,
     * pfx_set, conductor fields, and the three clears + at/drum clears. One
     * distinct clip per concern so nothing collides. ---- */
    {
        seq8_track_t *mt = &inst->tracks[4];
        HX_ASSERT(mt->pad_mode != PAD_MODE_DRUM, "precondition: t4 is melodic");

        /* _ruisel "[lane]": select this clip as the remote-UI snapshot target;
         * optional arg = drum lane (-1/absent = melodic). */
        hx_set_param(h, "t4_c9_ruisel", "5");
        HX_ASSERT(inst->rui_sel_track == 4 && inst->rui_sel_clip == 9 &&
                  inst->rui_sel_lane == 5, "_ruisel: track/clip/lane stored");
        hx_set_param(h, "t4_c9_ruisel", "-1");
        HX_ASSERT(inst->rui_sel_lane == -1, "_ruisel: '-' arg => lane -1 (melodic)");

        /* _cc_focus "<k>": gate rui_cc to knob k (-1 = none); k>=8 => -1. Bumps rev. */
        {
            uint32_t rev0 = inst->rui_rev;
            hx_set_param(h, "t4_c9_cc_focus", "3");
            HX_ASSERT(inst->rui_cc_focus == 3, "_cc_focus: knob 3 gated");
            HX_ASSERT(inst->rui_rev == rev0 + 1, "_cc_focus: bumps rui_rev");
            hx_set_param(h, "t4_c9_cc_focus", "99");
            HX_ASSERT(inst->rui_cc_focus == -1, "_cc_focus: k>=8 => -1 (none)");
        }

        /* Remote-UI melodic note ops: notes[] keyed on (tick, pitch). */
        {
            clip_t *c1 = &mt->clips[1];
            hx_set_param(h, "t4_c1_note_add", "0 60 77 20");
            HX_ASSERT(c1->note_count == 1 && c1->notes[0].active, "_note_add: 1 note present");
            HX_ASSERT(c1->notes[0].tick == 0 && c1->notes[0].pitch == 60 &&
                      c1->notes[0].vel == 77 && c1->notes[0].gate == 20,
                      "_note_add: tick0 pitch60 vel77 gate20");
            hx_set_param(h, "t4_c1_note_vel", "0 60 99");
            HX_ASSERT(c1->notes[0].vel == 99, "_note_vel: vel->99");
            hx_set_param(h, "t4_c1_note_resize", "0 60 30");
            HX_ASSERT(c1->notes[0].gate == 30, "_note_resize: gate->30");
            hx_set_param(h, "t4_c1_note_move", "0 60 24 62");
            HX_ASSERT(c1->notes[0].tick == 24 && c1->notes[0].pitch == 62,
                      "_note_move: (tick0,pitch60)->(tick24,pitch62)");
            hx_set_param(h, "t4_c1_note_del", "24 62");
            HX_ASSERT(c1->note_count == 0, "_note_del: note removed (compacted)");
        }

        /* _notes_op batch: multi-op, one finalize for the lot. */
        {
            clip_t *c2 = &mt->clips[2];
            hx_set_param(h, "t4_c2_notes_op", "a 0 60 100 24; a 12 64 90 24");
            HX_ASSERT(c2->note_count == 2, "_notes_op: batch added 2 notes atomically");
            {
                int qi, f0 = 0, f12 = 0;
                for (qi = 0; qi < (int)c2->note_count; qi++) {
                    if (c2->notes[qi].tick == 0  && c2->notes[qi].pitch == 60) f0 = 1;
                    if (c2->notes[qi].tick == 12 && c2->notes[qi].pitch == 64) f12 = 1;
                }
                HX_ASSERT(f0 && f12, "_notes_op: both notes present");
            }
        }

        /* _resolution: TPS change rescales notes proportionally; NO-OP while the
         * track is recording (guard `if (tr->recording) return;`). */
        {
            clip_t *c3 = &mt->clips[3];
            hx_set_param(h, "t4_c3_note_add", "24 60 100 24");
            HX_ASSERT(c3->ticks_per_step == 24 && c3->notes[0].tick == 24,
                      "_resolution setup: default tps 24, note at tick 24");
            mt->recording = 1;
            hx_set_param(h, "t4_c3_resolution", "3");   /* TPS_VALUES[3]=96 */
            HX_ASSERT(c3->ticks_per_step == 24 && c3->notes[0].tick == 24,
                      "_resolution: no-op while recording");
            mt->recording = 0;
            hx_set_param(h, "t4_c3_resolution", "2");   /* TPS_VALUES[2]=48 */
            HX_ASSERT(c3->ticks_per_step == 48, "_resolution: tps 24->48");
            HX_ASSERT(c3->notes[0].tick == 48, "_resolution: note tick 24->48 rescaled");
            HX_ASSERT(c3->notes[0].gate == 48, "_resolution: note gate 24->48 rescaled");
        }

        /* Nested _step_S_* parser (melodic clip variant): toggle/vel/gate/nudge/
         * iter/rand/ratch/pitch/add/copy_to/reassign/clear. (_set_notes is
         * table-covered on t5_c0_step_0_set_notes.) */
        {
            clip_t *c8 = &mt->clips[8];
            hx_set_param(h, "t4_c8_step_3_toggle", "60 90");   /* "pitch [vel]" */
            HX_ASSERT(c8->steps[3] == 1 && c8->step_note_count[3] == 1, "_step_toggle: step3 on");
            HX_ASSERT(c8->step_notes[3][0] == 60 && c8->step_vel[3] == 90, "_step_toggle: pitch60 vel90");
            HX_ASSERT(c8->active == 1, "_step_toggle: clip marked active");
            hx_set_param(h, "t4_c8_step_3_vel", "55");
            HX_ASSERT(c8->step_vel[3] == 55, "_step_vel: step3 vel->55");
            hx_set_param(h, "t4_c8_step_3_gate", "40");
            HX_ASSERT(c8->step_gate[3] == 40, "_step_gate: step3 gate->40");
            hx_set_param(h, "t4_c8_step_3_nudge", "5");
            HX_ASSERT(c8->note_tick_offset[3][0] == 5, "_step_nudge: offset->5");
            hx_set_param(h, "t4_c8_step_3_iter", "33");   /* 0x21: len2 idx1 -> valid */
            HX_ASSERT(c8->step_iter[3] == 33, "_step_iter: raw 33 stored");
            hx_set_param(h, "t4_c8_step_3_rand", "50");
            HX_ASSERT(c8->step_random[3] == 50, "_step_rand: 50");
            hx_set_param(h, "t4_c8_step_3_ratch", "3");
            HX_ASSERT(c8->step_ratchet[3] == 3, "_step_ratch: 3");
            hx_set_param(h, "t4_c8_step_3_pitch", "5");
            HX_ASSERT(c8->step_notes[3][0] == 65, "_step_pitch: +5 => 60->65");
            hx_set_param(h, "t4_c8_step_5_add", "67 0 80");   /* "p offset vel" */
            HX_ASSERT(c8->steps[5] == 1 && c8->step_note_count[5] == 1 &&
                      c8->step_notes[5][0] == 67 && c8->step_vel[5] == 80, "_step_add: step5 note67 vel80");
            hx_set_param(h, "t4_c8_step_3_copy_to", "7");
            HX_ASSERT(c8->steps[7] == 1 && c8->step_note_count[7] == 1, "_step_copy_to: step7 populated");
            HX_ASSERT(c8->step_notes[7][0] == 65 && c8->step_vel[7] == 55 &&
                      c8->step_gate[7] == 40, "_step_copy_to: copies notes/vel/gate");
            HX_ASSERT(c8->step_iter[7] == 33 && c8->step_ratchet[7] == 3, "_step_copy_to: copies trig conds");
            HX_ASSERT(c8->step_note_count[3] == 1, "_step_copy_to: SRC step3 unchanged");
            hx_set_param(h, "t4_c8_step_7_reassign", "11");
            HX_ASSERT(c8->step_note_count[11] == 1 && c8->steps[11] == 1, "_step_reassign: moved to step11");
            HX_ASSERT(c8->step_note_count[7] == 0 && c8->steps[7] == 0, "_step_reassign: SRC step7 cleared");
            hx_set_param(h, "t4_c8_step_3_clear", "0");
            HX_ASSERT(c8->steps[3] == 0 && c8->step_note_count[3] == 0, "_step_clear: step3 emptied");
            HX_ASSERT(c8->step_iter[3] == 0 && c8->step_ratchet[3] == 0, "_step_clear: trig conds reset");
        }

        /* _dir: per-clip playback direction + pp_dir_state; on the ACTIVE clip
         * (c0 == active_clip) also silences the track (side effect not
         * separately observable in-harness — exercised, not asserted). */
        {
            clip_t *c0 = &mt->clips[0];
            HX_ASSERT((int)mt->active_clip == 0, "precondition: t4 active_clip == 0");
            hx_set_param(h, "t4_c0_dir", "3");   /* 3 = Pingpong-Backward */
            HX_ASSERT(c0->playback_dir == 3, "_dir: playback_dir->3");
            HX_ASSERT(c0->pp_dir_state == -1, "_dir: pp_dir_state initial -1 for dir 3");
        }

        /* _loop_set (melodic) packed decode + clamp; _length max-len clamp.
         * (Serialized tokens are table-covered on t7; here pin the decode/clamp
         * facets. The rui_rev freeze-fix is pinned in test_rui_rev.c.) */
        {
            clip_t *c15 = &mt->clips[15];
            /* packed = loop_start<<16 | length = 3*65536 + 8 = 196616 */
            hx_set_param(h, "t4_c15_loop_set", "196616");
            HX_ASSERT(c15->loop_start == 3 && c15->length == 8, "_loop_set: packed decode ls=3 len=8");
            /* ls+len > SEQ_STEPS clamps len to SEQ_STEPS-ls. ls=1, len=999 -> 255 */
            hx_set_param(h, "t4_c15_loop_set", "66535");   /* (1<<16)|999 */
            HX_ASSERT(c15->loop_start == 1 && c15->length == SEQ_STEPS - 1,
                      "_loop_set: ls+len>SEQ_STEPS clamps len to SEQ_STEPS-ls");
            /* _length clamps to max_len = SEQ_STEPS - loop_start (=255 here). */
            hx_set_param(h, "t4_c15_length", "500");
            HX_ASSERT(c15->length == SEQ_STEPS - 1, "_length: clamps to SEQ_STEPS - loop_start");
        }

        /* _kN_cc_* per-clip CC-lane loop sub-block: writes clip_cc_auto[cidx]'s
         * lane_loop_start/lane_length/lane_tps/lane_res_tps (knob k). */
        {
            cc_auto_t *ca = &mt->clip_cc_auto[10];
            hx_set_param(h, "t4_c10_k2_cc_loop_set", "196616");   /* ls=3 len=8 */
            HX_ASSERT(ca->lane_loop_start[2] == 3 && ca->lane_length[2] == 8,
                      "_k2_cc_loop_set: lane ls=3 len=8");
            hx_set_param(h, "t4_c10_k2_cc_lane_length", "5");
            HX_ASSERT(ca->lane_length[2] == 5, "_k2_cc_lane_length: ->5");
            hx_set_param(h, "t4_c10_k2_cc_lane_tps", "48");       /* valid TPS */
            HX_ASSERT(ca->lane_tps[2] == 48, "_k2_cc_lane_tps: 48 accepted");
            hx_set_param(h, "t4_c10_k2_cc_lane_tps", "50");       /* invalid TPS -> 0 */
            HX_ASSERT(ca->lane_tps[2] == 0, "_k2_cc_lane_tps: non-TPS value => 0");
            hx_set_param(h, "t4_c10_k2_cc_lane_res_tps", "96");
            HX_ASSERT(ca->lane_res_tps[2] == 96, "_k2_cc_lane_res_tps: 96");
            hx_set_param(h, "t4_c10_k2_cc_lane_double_fill", "1"); /* len 5->10 (no points) */
            HX_ASSERT(ca->lane_length[2] == 10, "_k2_cc_lane_double_fill: length 5->10");
            hx_set_param(h, "t4_c10_k2_cc_lane_reset", "1");
            HX_ASSERT(ca->lane_loop_start[2] == 0 && ca->lane_length[2] == 0 &&
                      ca->lane_tps[2] == 0 && ca->lane_res_tps[2] == 0,
                      "_k2_cc_lane_reset: all four lane fields zeroed");
        }

        /* _pfx_set: routes a pfx key to this clip's pfx_params (any clip). */
        {
            clip_t *c5 = &mt->clips[5];
            HX_ASSERT(c5->pfx_params.gate_time == 100, "_pfx_set precondition: default gate_time 100");
            hx_set_param(h, "t4_c5_pfx_set", "noteFX_gate 50");
            HX_ASSERT(c5->pfx_params.gate_time == 50, "_pfx_set: gate_time->50 on named clip");
        }

        /* Conductor per-clip storage fields ("Phase 2: storage only"). Payload
         * "<trackIdx> <value>" for the per-track banks; _cond_lock is a bare flag. */
        {
            clip_t *c6 = &mt->clips[6];
            HX_ASSERT(c6->cond_resp[3] == 1, "_cond_resp precondition: default responder ON");
            hx_set_param(h, "t4_c6_cond_resp", "3 0");
            HX_ASSERT(c6->cond_resp[3] == 0, "_cond_resp: track3 responder OFF");
            hx_set_param(h, "t4_c6_cond_lock", "1");
            HX_ASSERT(c6->cond_lock == 1, "_cond_lock: ->1");
            hx_set_param(h, "t4_c6_cond_oct", "2 3");
            HX_ASSERT(c6->cond_oct[2] == 3, "_cond_oct: track2 octave +3");
            hx_set_param(h, "t4_c6_cond_oct", "2 99");   /* clamp -4..4 */
            HX_ASSERT(c6->cond_oct[2] == 4, "_cond_oct: clamps to +4");
            hx_set_param(h, "t4_c6_cond_when", "5 1");
            HX_ASSERT(c6->cond_when[5] == 1, "_cond_when: track5 Now(1)");
        }

        /* _clear vs _clear_keep vs _hard_reset: what each preserves/wipes. */
        {
            clip_t *c11 = &mt->clips[11];
            hx_set_param(h, "t4_c11_step_2_toggle", "60 80");
            hx_set_param(h, "t4_c11_loop_set", "196616");   /* ls=3 len=8 */
            HX_ASSERT(c11->steps[2] == 1 && c11->length == 8 && c11->loop_start == 3,
                      "_clear setup: note + loop window");
            hx_set_param(h, "t4_c11_clear", "1");
            HX_ASSERT(c11->steps[2] == 0 && c11->step_note_count[2] == 0 && c11->active == 0,
                      "_clear: step data wiped");
            HX_ASSERT(c11->note_count == 0, "_clear: notes[] wiped");
            HX_ASSERT(c11->length == 8 && c11->loop_start == 3,
                      "_clear: PRESERVES length + loop_start (vs hard_reset)");

            clip_t *c12 = &mt->clips[12];
            hx_set_param(h, "t4_c12_step_1_toggle", "62 70");
            hx_set_param(h, "t4_c12_loop_set", "196616");
            hx_set_param(h, "t4_c12_clear_keep", "1");
            HX_ASSERT(c12->steps[1] == 0 && c12->note_count == 0, "_clear_keep: step/note data wiped");
            HX_ASSERT(c12->length == 8 && c12->loop_start == 3, "_clear_keep: PRESERVES geometry");

            clip_t *c13 = &mt->clips[13];
            hx_set_param(h, "t4_c13_step_1_toggle", "64 70");
            hx_set_param(h, "t4_c13_loop_set", "196616");   /* ls=3 len=8 */
            HX_ASSERT(c13->length == 8 && c13->loop_start == 3, "_hard_reset setup: geometry set");
            hx_set_param(h, "t4_c13_hard_reset", "1");
            HX_ASSERT(c13->steps[1] == 0 && c13->active == 0, "_hard_reset: steps wiped");
            HX_ASSERT(c13->length == SEQ_STEPS_DEFAULT && c13->loop_start == 0,
                      "_hard_reset: factory-resets geometry (vs _clear)");
            HX_ASSERT(c13->ticks_per_step == TICKS_PER_STEP, "_hard_reset: tps back to default");
        }

        /* _at_clear: wipes this clip's aftertouch automation (count + lane pitch). */
        {
            at_auto_t *at = &mt->clip_at_auto[14];
            at->count[0] = 5; at->pitch[0] = 60;
            hx_set_param(h, "t4_c14_at_clear", "1");
            HX_ASSERT(at->count[0] == 0, "_at_clear: count zeroed");
            HX_ASSERT(at->pitch[0] == AT_LANE_FREE, "_at_clear: lane pitch -> AT_LANE_FREE");
        }

        /* Drum-clip variants (_drum_clear / _drum_reset) — need a DRUM track with
         * allocated drum_clips. Reuse t3 (DRUM from the group-3 block); set up a
         * lane step directly via struct on non-active clips 7/8, then invoke. */
        {
            seq8_track_t *dt = &inst->tracks[3];
            HX_ASSERT(dt->pad_mode == PAD_MODE_DRUM, "precondition: t3 is DRUM");
            HX_ASSERT(dt->drum_clips[7] && dt->drum_clips[8], "precondition: t3 drum_clips[7,8] allocated");

            /* _drum_clear "1"(keep): wipes all lane step data in clip C;
             * midi_note / length / tps preserved. */
            {
                clip_t *lc = &dt->drum_clips[7]->lanes[3].clip;
                uint8_t mn = dt->drum_clips[7]->lanes[3].midi_note;
                lc->steps[2] = 1; lc->step_note_count[2] = 1; lc->step_notes[2][0] = mn;
                lc->active = 1; lc->length = 9;
                hx_set_param(h, "t3_c7_drum_clear", "1");
                HX_ASSERT(lc->steps[2] == 0 && lc->step_note_count[2] == 0, "_drum_clear: lane steps wiped");
                HX_ASSERT(lc->active == 0, "_drum_clear: lane deactivated");
                HX_ASSERT(lc->length == 9, "_drum_clear: PRESERVES length");
                HX_ASSERT(dt->drum_clips[7]->lanes[3].midi_note == mn, "_drum_clear: preserves midi_note");
            }

            /* _drum_reset: clip_init on each lane's clip_t (factory reset);
             * midi_note preserved (sibling field). */
            {
                clip_t *lc = &dt->drum_clips[8]->lanes[3].clip;
                dt->drum_clips[8]->lanes[3].midi_note = 99;
                lc->steps[0] = 1; lc->active = 1; lc->length = 9;
                hx_set_param(h, "t3_c8_drum_reset", "1");
                HX_ASSERT(lc->steps[0] == 0 && lc->active == 0, "_drum_reset: lane steps wiped");
                HX_ASSERT(lc->length == SEQ_STEPS_DEFAULT, "_drum_reset: length reset (clip_init)");
                HX_ASSERT(dt->drum_clips[8]->lanes[3].midi_note == 99, "_drum_reset: preserves midi_note");
            }
        }
    }

    /* ---- Track-config2 white-box pins (Phase 4B group 5 prep). Runs after the table:
     * dedicated track t2 (melodic, active_clip 0, tarp at defaults). Melodic/tarp
     * pins first; the type-conversion pins (which flip t2's type) run at the very
     * end so nothing corrupts an earlier melodic pin. Requires the track-config
     * block to have latched conductor_track to t5 (for the convert_to_conduct
     * early-return no-op facet). ---- */
    {
        seq8_track_t *ct = &inst->tracks[2];
        char b[65536]; int nn;

        /* t2's prior touches (channel/tvo/cc-auto/launch) don't intersect this
         * group's keys; its tarp state is pristine (untouched). Force active_clip
         * to 0 (an earlier immediate-launch left it at 5) so the active-clip
         * resolution keys operate on the clean clip 0. */
        ct->active_clip = 0;
        HX_ASSERT(ct->pad_mode == PAD_MODE_MELODIC_SCALE, "precondition: t2 melodic");
        HX_ASSERT(ct->tarp_on == 0 && ct->tarp.style == 0 && ct->tarp.gate_pct == 100,
                  "precondition: t2 tarp at defaults");
        HX_ASSERT(ct->clips[0].ticks_per_step == 24, "precondition: t2 c0 default tps 24");
        HX_ASSERT(inst->conductor_track == 5, "precondition: t5 is the latched Conductor");

        /* clip_resolution (track-level, operates on active_clip): TPS change +
         * proportional note rescale. Note at tick 48 gate 24 @tps24; idx2=tps48
         * (factor x2) -> tick 96, gate 48. Guarded no-op while recording. */
        hx_set_param(h, "t2_c0_note_add", "48 55 100 24");
        HX_ASSERT(ct->clips[0].notes[0].tick == 48 && ct->clips[0].notes[0].gate == 24,
                  "clip_resolution setup: note tick48 gate24 @tps24");
        ct->recording = 1;
        hx_set_param(h, "t2_clip_resolution", "3");   /* TPS_VALUES[3]=96 */
        HX_ASSERT(ct->clips[0].ticks_per_step == 24 && ct->clips[0].notes[0].tick == 48,
                  "clip_resolution: no-op while recording");
        ct->recording = 0;
        hx_set_param(h, "t2_clip_resolution", "2");   /* TPS_VALUES[2]=48 */
        HX_ASSERT(ct->clips[0].ticks_per_step == 48, "clip_resolution: idx2 -> tps 48");
        HX_ASSERT(ct->clips[0].notes[0].tick == 96, "clip_resolution: note tick 48->96 rescaled");
        HX_ASSERT(ct->clips[0].notes[0].gate == 48, "clip_resolution: note gate 24->48 rescaled");

        /* clip_resolution_zoom: preserves absolute time, recomputes length.
         * length 8 @tps48 (=384t) -> ceil(384/96)=4 @tps96. */
        hx_set_param(h, "t2_c0_length", "8");
        HX_ASSERT(ct->clips[0].length == 8, "clip_resolution_zoom setup: length 8");
        hx_set_param(h, "t2_clip_resolution_zoom", "3");   /* TPS_VALUES[3]=96 */
        HX_ASSERT(ct->clips[0].ticks_per_step == 96, "clip_resolution_zoom: tps->96");
        HX_ASSERT(ct->clips[0].length == 4, "clip_resolution_zoom: length 8@48 -> 4@96");

        /* pad_octave: stored track field (NOT serialized), clamped 0..8. */
        HX_ASSERT(ct->pad_octave == 3, "pad_octave precondition: default 3");
        hx_set_param(h, "t2_pad_octave", "5");
        HX_ASSERT(ct->pad_octave == 5, "pad_octave: ->5");
        hx_set_param(h, "t2_pad_octave", "99");
        HX_ASSERT(ct->pad_octave == 8, "pad_octave: high clamp to 8");

        /* tarp_* run. Set scalar params, then verify sparse serialized tokens in
         * one state_full read. tarp_style!=0 also drives tarp_on=1. */
        hx_set_param(h, "t2_tarp_style", "5");
        HX_ASSERT(ct->tarp.style == 5, "tarp_style: style->5");
        HX_ASSERT(ct->tarp_on == 1, "tarp_style: non-zero style arms tarp_on");
        hx_set_param(h, "t2_tarp_rate", "4");
        HX_ASSERT(ct->tarp.rate_idx == 4, "tarp_rate: rate_idx->4");
        hx_set_param(h, "t2_tarp_octaves", "-2");
        HX_ASSERT(ct->tarp.octaves == -2, "tarp_octaves: ->-2");
        hx_set_param(h, "t2_tarp_gate", "150");
        HX_ASSERT(ct->tarp.gate_pct == 150, "tarp_gate: gate_pct->150");
        hx_set_param(h, "t2_tarp_steps_mode", "2");
        HX_ASSERT(ct->tarp.steps_mode == 2, "tarp_steps_mode: ->2");
        hx_set_param(h, "t2_tarp_step_vel", "3 2");     /* "S L": step3 level2 */
        HX_ASSERT(ct->tarp.step_vel[3] == 2, "tarp_step_vel: step3 level->2");
        hx_set_param(h, "t2_tarp_step_int", "2 -5");    /* "S I": step2 interval -5 */
        HX_ASSERT(ct->tarp.step_int[2] == -5, "tarp_step_int: step2 interval->-5");
        hx_set_param(h, "t2_tarp_step_loop_len", "5");
        HX_ASSERT(ct->tarp.step_loop_len == 5, "tarp_step_loop_len: ->5");
        hx_set_param(h, "t2_tarp_sync", "0");
        HX_ASSERT(ct->tarp_sync == 0, "tarp_sync: ->0");
        hx_set_param(h, "t2_tarp_retrigger", "1");
        HX_ASSERT(ct->tarp.retrigger == 1, "tarp_retrigger: ->1");
        hx_set_param(h, "bpm", "141");
        nn = hx_get_param(h, "state_full", b, (int)sizeof(b)); b[nn] = '\0';
        HX_ASSERT(strstr(b, "\"t2_tast\":5"),  "tarp_style serialized token t2_tast:5");
        HX_ASSERT(strstr(b, "\"t2_tart\":4"),  "tarp_rate serialized token t2_tart:4");
        HX_ASSERT(strstr(b, "\"t2_taoc\":-2"), "tarp_octaves serialized token t2_taoc:-2");
        HX_ASSERT(strstr(b, "\"t2_tagt\":150"),"tarp_gate serialized token t2_tagt:150");
        HX_ASSERT(strstr(b, "\"t2_tasm\":2"),  "tarp_steps_mode serialized token t2_tasm:2");
        HX_ASSERT(strstr(b, "\"t2_tasv3\":2"), "tarp_step_vel serialized token t2_tasv3:2");
        HX_ASSERT(strstr(b, "\"t2_tasi2\":-5"),"tarp_step_int serialized token t2_tasi2:-5");
        HX_ASSERT(strstr(b, "\"t2_tasll\":5"), "tarp_step_loop_len serialized token t2_tasll:5");
        HX_ASSERT(strstr(b, "\"t2_tasy\":0"),  "tarp_sync serialized token t2_tasy:0");
        HX_ASSERT(strstr(b, "\"t2_targ\":1"),  "tarp_retrigger serialized token t2_targ:1");

        /* tarp_latch: track field; latch ON->OFF drops latched entries (RT held
         * buffer, out of harness scope) — pin the observable flag both ways. */
        hx_set_param(h, "t2_tarp_latch", "1");
        HX_ASSERT(ct->tarp_latch == 1, "tarp_latch: ->1");
        /* tarp_clear_latched: functionally latch-off compaction WITHOUT toggling
         * the flag; RT held-buffer op, so the only observable is tarp_latch stays 1. */
        hx_set_param(h, "t2_tarp_clear_latched", "1");
        HX_ASSERT(ct->tarp_latch == 1, "tarp_clear_latched: leaves tarp_latch=1 (no toggle)");
        hx_set_param(h, "t2_tarp_latch", "0");
        HX_ASSERT(ct->tarp_latch == 0, "tarp_latch: ->0");

        /* tarp_reset: full reset to defaults. Quirk: arp_init_defaults sets
         * retrigger=1 and tarp_reset does NOT re-clear it, so retrigger reads 1
         * (NOT 0). */
        hx_set_param(h, "t2_tarp_reset", "1");
        HX_ASSERT(ct->tarp.style == 0 && ct->tarp.rate_idx == 1 && ct->tarp.octaves == 0,
                  "tarp_reset: style/rate/octaves -> defaults");
        HX_ASSERT(ct->tarp.gate_pct == 100 && ct->tarp.steps_mode == 1,
                  "tarp_reset: gate/steps_mode -> defaults");
        HX_ASSERT(ct->tarp.step_vel[3] == 4 && ct->tarp.step_int[2] == 0 &&
                  ct->tarp.step_loop_len == 8, "tarp_reset: step arrays -> defaults");
        HX_ASSERT(ct->tarp_on == 0 && ct->tarp_latch == 0 && ct->tarp_sync == 1,
                  "tarp_reset: tarp_on/latch->0, sync->1");
        HX_ASSERT(ct->tarp.retrigger == 1, "tarp_reset: retrigger reads 1 (arp_init default, NOT re-cleared)");

        /* ---- Type-conversion pins (LAST — they flip t2's type). ---- */

        /* convert_to_conduct with ANOTHER track (t5) already the Conductor:
         * early-return no-op (JS reads back conductor_track for the OLED msg). */
        hx_set_param(h, "t2_convert_to_conduct", "1");
        HX_ASSERT(ct->pad_mode == PAD_MODE_MELODIC_SCALE,
                  "convert_to_conduct: no-op when another track already Conductor");
        HX_ASSERT(inst->conductor_track == 5, "convert_to_conduct: conductor_track unchanged (still t5)");

        /* pad_mode: 1=DRUM allocates drum_clips; 0=melodic frees them. */
        hx_set_param(h, "t2_pad_mode", "1");
        HX_ASSERT(ct->pad_mode == PAD_MODE_DRUM, "pad_mode: 1 -> DRUM");
        HX_ASSERT(ct->drum_clips[0] != NULL && ct->drum_clips[NUM_CLIPS-1] != NULL,
                  "pad_mode: DRUM allocates all drum_clips");
        hx_set_param(h, "t2_pad_mode", "0");
        HX_ASSERT(ct->pad_mode == PAD_MODE_MELODIC_SCALE, "pad_mode: 0 -> melodic");
        HX_ASSERT(ct->drum_clips[0] == NULL, "pad_mode: melodic frees drum_clips");

        /* convert_to_drum / convert_to_melodic: type flip + note translation
         * (observable = pad_mode + drum_clips alloc state). */
        hx_set_param(h, "t2_convert_to_drum", "1");
        HX_ASSERT(ct->pad_mode == PAD_MODE_DRUM, "convert_to_drum: -> DRUM");
        HX_ASSERT(ct->drum_clips[0] != NULL, "convert_to_drum: allocates drum_clips");
        hx_set_param(h, "t2_convert_to_melodic", "1");
        HX_ASSERT(ct->pad_mode == PAD_MODE_MELODIC_SCALE, "convert_to_melodic: -> melodic");
        HX_ASSERT(ct->drum_clips[0] == NULL, "convert_to_melodic: frees drum_clips");
    }

    /* ---- Recording white-box pins (Phase 4B group 6 prep). Runs after the table:
     * dedicated track t1 (melodic; only its config was touched earlier, no clip
     * note data), reset to a clean non-playing baseline. STOCK tick path
     * (dsp_inbound_enabled==0): record_note_on/off capture at current_clip_tick.
     * All magic numbers distinct from every prior row/block. ---- */
    {
        seq8_track_t *rt = &inst->tracks[1];
        const int TIDX = 1;
        HX_ASSERT(inst->playing == 0, "recording block precondition: transport stopped");
        HX_ASSERT(inst->dsp_inbound_enabled == 0,
                  "recording block precondition: stock tick path (no padmap-armed inbound)");
        HX_ASSERT(rt->pad_mode != PAD_MODE_DRUM, "recording block precondition: t1 melodic");
        /* t1 carries leftovers: tarp_on=1 (table row), queued_clip/active_clip=7
         * (launch_clip preview). Reset to a clean melodic non-recording baseline;
         * this block owns t1 for the rest of the test. */
        rt->recording = 0; rt->record_armed = 0;
        rt->recording_pending_page = 0; rt->recording_adaptive_arm = 0;
        rt->tarp_on = 0;
        rt->drum_inp_quant = 0;
        rt->queued_clip = -1;
        rt->clip_playing = 0;
        rt->active_clip = 0;
        rt->rec_pending_count = 0;

        /* --- recording arm: rv=1, clip NOT playing + no queued clip -> the
         * final `else` branch: recording=1. The arm also (regardless of branch)
         * clears the fresh-session masks: live_recorded_steps, the inbound
         * press slots, and resets drum_last_rec_step to 0xFF. (undo_begin
         * snapshot is taken on arm — not separately observable in-harness.) */
        rt->live_recorded_steps[0] = 0xFF;
        inst->on_midi_press_active[TIDX][40] = 1;
        rt->drum_last_rec_step[0] = 0;
        hx_set_param(h, "t1_recording", "1");
        HX_ASSERT(rt->recording == 1, "recording=1: stopped clip + unqueued -> recording");
        HX_ASSERT(rt->record_armed == 0, "recording=1: record_armed stays 0 in immediate branch");
        HX_ASSERT(rt->live_recorded_steps[0] == 0, "recording arm: clears live_recorded_steps");
        HX_ASSERT(inst->on_midi_press_active[TIDX][40] == 0, "recording arm: clears inbound press slots");
        /* memset(..., 0xFF, ...) fills all bytes -> int16_t reads -1 (0xFFFF). */
        HX_ASSERT(rt->drum_last_rec_step[0] == -1,
                  "recording arm: resets drum_last_rec_step to 0xFF (all-bytes -> -1)");

        /* --- recording arm: rv=1, queued_clip>=0 -> record_armed (NOT recording). */
        rt->recording = 0; rt->record_armed = 0; rt->clip_playing = 0; rt->queued_clip = 3;
        hx_set_param(h, "t1_recording", "1");
        HX_ASSERT(rt->record_armed == 1, "recording=1: queued clip -> record_armed");
        HX_ASSERT(rt->recording == 0, "recording=1: queued-arm leaves recording 0");

        /* --- recording arm: rv=1, clip_playing (transport stopped) -> recording=1. */
        rt->recording = 0; rt->record_armed = 0; rt->clip_playing = 1; rt->queued_clip = -1;
        hx_set_param(h, "t1_recording", "1");
        HX_ASSERT(rt->recording == 1, "recording=1: clip_playing (transport stopped) -> recording");

        /* --- recording arm: rv=2 (adaptive). The defer-with-reset path is gated
         * on (clip_playing && inst->playing && rv==2); transport is stopped here,
         * so rv=2 falls through to the clip_playing immediate-arm branch. The
         * recording_pending_page/recording_adaptive_arm defer is RT-only (needs a
         * running transport) — OUT OF HARNESS SCOPE. */
        rt->recording = 0; rt->clip_playing = 1; rt->queued_clip = -1;
        rt->recording_pending_page = 0; rt->recording_adaptive_arm = 0;
        hx_set_param(h, "t1_recording", "2");
        HX_ASSERT(rt->recording == 1, "recording=2: transport stopped -> immediate arm (defer is RT-gated)");
        HX_ASSERT(rt->recording_pending_page == 0 && rt->recording_adaptive_arm == 0,
                  "recording=2: no adaptive defer while transport stopped");

        /* --- recording disarm: rv=0 clears all arm flags AND cancels a pending
         * count-in scheduled for THIS track (the "keeps recording after disarm"
         * fix: count_in_ticks=0 when count_in_track==tidx). */
        rt->recording = 1; rt->record_armed = 1;
        rt->recording_pending_page = 1; rt->recording_adaptive_arm = 1;
        inst->count_in_track = (uint8_t)TIDX; inst->count_in_ticks = 50;
        hx_set_param(h, "t1_recording", "0");
        HX_ASSERT(rt->recording == 0, "recording=0: disarm clears recording");
        HX_ASSERT(rt->record_armed == 0, "recording=0: clears record_armed");
        HX_ASSERT(rt->recording_pending_page == 0 && rt->recording_adaptive_arm == 0,
                  "recording=0: clears adaptive-arm flags");
        HX_ASSERT(inst->count_in_ticks == 0, "recording=0: cancels pending count-in for this track");

        /* --- record_note_on guard: `if (!tr->recording) return;` -> dropped. */
        {
            clip_t *rc = &rt->clips[0];
            uint16_t nc0 = rc->note_count;
            rt->recording = 0;
            rt->current_clip_tick = 48;
            hx_set_param(h, "t1_record_note_on", "77 90");
            HX_ASSERT(rc->note_count == nc0, "record_note_on: no-op when not recording (guard)");
        }

        /* --- record_note_on capture (stock path). Arm, set current_clip_tick,
         * fire. Note lands in notes[] at that tick with vel + gate=GATE_TICKS,
         * mirrored to steps[]. tick 48 @tps24 -> note_step=(48+12)/24=2. vel 101
         * (deliberately != SEQ_VEL default 100 so a default-vel bug is caught). */
        {
            clip_t *rc = &rt->clips[0];
            int qi, found = -1;
            rt->recording = 1; rt->tarp_on = 0; rt->drum_inp_quant = 0;
            rt->rec_pending_count = 0;
            rt->current_clip_tick = 48;
            hx_set_param(h, "t1_record_note_on", "72 101");
            for (qi = 0; qi < (int)rc->note_count; qi++)
                if (rc->notes[qi].active && rc->notes[qi].pitch == 72) found = qi;
            HX_ASSERT(found >= 0, "record_note_on: note pitch72 inserted");
            HX_ASSERT(rc->notes[found].tick == 48, "record_note_on: tick = current_clip_tick (48)");
            HX_ASSERT(rc->notes[found].vel == 101, "record_note_on: vel = parsed 101");
            HX_ASSERT(rc->notes[found].gate == GATE_TICKS, "record_note_on: gate = GATE_TICKS default");
            /* step mirror at sidx 2 */
            HX_ASSERT(rc->steps[2] == 1 && rc->step_note_count[2] == 1,
                      "record_note_on: mirrored to steps[2]");
            HX_ASSERT(rc->step_notes[2][0] == 72 && rc->step_vel[2] == 101,
                      "record_note_on: step notes/vel mirrored");
        }

        /* --- record_note_off guard: `if (!tr->recording) return;`. */
        {
            clip_t *rc = &rt->clips[0];
            rt->recording = 1; rt->rec_pending_count = 0;
            rt->current_clip_tick = 24;
            hx_set_param(h, "t1_record_note_on", "80 90");   /* on at tick 24 (sidx 1) */
            {
                int qi, f = -1;
                for (qi = 0; qi < (int)rc->note_count; qi++)
                    if (rc->notes[qi].active && rc->notes[qi].pitch == 80) f = qi;
                HX_ASSERT(f >= 0 && rc->notes[f].gate == GATE_TICKS,
                          "record_note_off setup: pitch80 on at gate=GATE_TICKS");
                /* guard: disarm then off -> gate unchanged */
                rt->recording = 0;
                rt->current_clip_tick = 72;
                hx_set_param(h, "t1_record_note_off", "80");
                HX_ASSERT(rc->notes[f].gate == GATE_TICKS,
                          "record_note_off: no-op when not recording (guard)");
                /* --- record_note_off capture: gate = off_tick - on_tick = 72-24 = 48. */
                rt->recording = 1;
                hx_set_param(h, "t1_record_note_off", "80");
                HX_ASSERT(rc->notes[f].gate == 48, "record_note_off: gate = off(72) - on(24) = 48");
                /* step_gate mirror at note_step(24)=1 */
                HX_ASSERT(rc->step_gate[1] == 48, "record_note_off: step_gate mirrored to 48");
                HX_ASSERT(rt->rec_pending_count == 0, "record_note_off: rec_pending entry consumed");
            }
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
    printf("PASS: per-clip white-box pins "
           "(ruisel/cc_focus, note-ops, step-parser, resolution/dir, "
           "loop_set/length clamps, cc-lane sub-block, pfx_set, conductor fields, "
           "clear/clear_keep/hard_reset, at_clear, drum_clear/drum_reset)\n");
    printf("PASS: track-config2 white-box pins "
           "(clip_resolution/_zoom + recording guard, pad_octave clamp, tarp_* "
           "full run + serialized tokens + reset retrigger quirk, "
           "pad_mode/convert_to_drum/convert_to_melodic type flips, "
           "convert_to_conduct another-Conductor no-op)\n");
    printf("PASS: recording white-box pins "
           "(arm rv=1 immediate/queued/clip-playing + rv=2 stopped-immediate, "
           "arm session-mask clears, disarm flag clears + count-in cancel, "
           "record_note_on capture + step mirror, record_note_off gate + "
           "step_gate mirror, both !recording guards)\n");
    return 0;
}
