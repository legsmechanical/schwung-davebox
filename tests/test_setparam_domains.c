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
 * robustly than the serialized token.
 *
 * Phase 4B group 7 prep: the sp_track_live group (live_notes, live_at, padmap)
 * is characterized as an EIGHTH white-box block (all white-box blocks run after
 * the table, in file order; this is currently the last). It runs on a DEDICATED
 * track (t7): melodic, default ROUTE_SCHWUNG -> HX_MIDI_INTERNAL capture, channel
 * 7 (tr->channel == track index) -- the same known-emitting track the cc-auto
 * block used, and nothing asserts t7 after this block, so its live sends are
 * collision-safe. ORDER inside the block is load-bearing: live_notes/live_at run
 * FIRST while inst->dsp_inbound_enabled==0, because the padmap push sets
 * dsp_inbound_enabled=1 and live_notes early-returns whenever that flag is set
 * (the on_midi audio-thread path already dispatched) -- that guard is itself
 * pinned. padmap (the platform global-carrier: the Schwung host drops NEW global
 * keys, so active_track + dsp_inbound_enabled ride the per-track push) runs LAST,
 * and dsp_inbound_enabled is restored to 0 at block end for cleanliness (no later
 * blocks depend on it, but this keeps the file honest). Pins are a mix of MIDI
 * capture-buffer scans (live_notes note-on/off + default-vel + batch emit,
 * live_at poly/channel AT emit) and direct struct reads (last_poly_at_press,
 * active_track/dsp_inbound_enabled/pad_note_map + trailing pad_dispatch_muted/
 * delete_held/corun_left_silent). OUT OF SCOPE: live_at recording-into-clip
 * (recording=0 here) and the arp/tarp AT fan-out (arp/tarp style 0) are RT/config
 * paths -- the immediate live send is the off-device observable; the padmap
 * carrier's full two-polarity contract also lives in test_padmap_contract.c.
 *
 * Phase 4B group 13 prep (THE FINAL group): sp_globals_transport's 17 keys.
 * GLOBALS shape — every branch is a top-level strcmp(key,...) with NO track
 * index/sub-op, each returns, and the handler falls through (returns 0) on
 * no-match. Split two ways: the clean serialized-token scalars (scale,
 * scale_aware, inp_quant, midi_in_channel, metro_on, swing_res) are TABLE rows
 * next to the existing bpm/swing_amt/key/metro_vol globals; the runtime /
 * state-machine keys are a white-box block placed LAST-but-one, immediately
 * BEFORE the globals-STATE block (same reason globals-misc/-edit sit there:
 * this block mutates inst->playing + all-track playback, and only the
 * globals-STATE state_load reset runs after it, so nothing downstream is
 * corrupted). That block pins: transport "play_focus:T:C" (arms the focus
 * track then falls through to play — the val="play" LOCAL rewrite), transport
 * "restart" (atomic stop+play, global positions reset, playing=1),
 * record_count_in / record_count_in_cancel (1-bar count-in schedule/clear),
 * active_track (runtime field, NOT serialized), clock_follow_on (flag +
 * follow-bookkeeping reset + same-value no-op early return) / clock_send_on,
 * and launch_quant (clamp + "lq" token + switch-to-Now-while-playing fires
 * queued clips). transport play/stop is already the white-box pin at the top
 * of main(); it is not duplicated. OUT OF SCOPE: the clock-follow branches of
 * every transport op (follow_request_start/stop instead of ext_transport_*)
 * and the mid-transport flush inside clock_follow_on are RT/host-sync paths —
 * only the observable playing/flag transitions are pinned, with clock_follow_on
 * forced to 0 so the ext_transport path (the off-device observable) runs. */
#include "harness.h"

typedef struct { const char *key, *val, *expect_substr, *domain; } sp_case_t;

/* Phase 4B group 12 helper: factory-reset a clip then seed it with one
 * distinctive step note (+ rebuilt notes[]), so the globals-edit ops
 * (copy/cut/clear/undo/redo) have observable content to move around. */
static void charz_seed_step(clip_t *cl, int step, int pitch, int vel, int len) {
    clip_init(cl);
    cl->length              = (uint16_t)len;
    cl->steps[step]         = 1;
    cl->step_note_count[step] = 1;
    cl->step_notes[step][0] = (uint8_t)pitch;
    cl->step_vel[step]      = (uint8_t)vel;
    cl->active              = 1;
    clip_migrate_to_notes(cl);
}

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
        /* Globals-transport serialized-token keys (Phase 4B group 13 prep).
         * All top-level strcmp(key) globals, order-independent, distinct
         * magic numbers. scale parallels the existing "key" row; the rest are
         * clean scalar->token maps. metro_on serializes only when != default 1
         * (=>2); swing_res only when != 0 (=>1). scale_aware/inp_quant/
         * midi_in_channel serialize unconditionally. The runtime/state-machine
         * transport keys (play_focus/restart, count-in, active_track, clock
         * follow/send, launch_quant) are pinned white-box below. */
        { "scale",                   "9",         "\"scale\":9",            "tonality (scale)" },
        { "scale_aware",             "1",         "\"saw\":1",              "tonality (scale_aware)" },
        { "inp_quant",               "1",         "\"iq\":1",               "input quantize" },
        { "midi_in_channel",         "9",         "\"mic\":9",              "midi in channel" },
        { "metro_on",                "2",         "\"metro_on\":2",         "metronome (metro_on)" },
        { "swing_res",               "1",         "\"_swr\":1",             "swing (swing_res)" },
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
        /* diq (per-track drum input quantize) serializes to t%ddiq (sparse,
         * omitted when 0); Phase 4B group 8 prep. On t6 (drum via the lane
         * write above) so it never collides with the group-8 t0 block. */
        { "t6_diq",                  "5",         "\"t6diq\":5",            "drum config (drum input quant)" },
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
        hx_set_param(h, "t3_l7_repeat_vel_scale", "2 90");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][2] == 90, "_repeat_vel_scale: step2 ->90 (absolute vel)");
        hx_set_param(h, "t3_l7_repeat_vel_scale", "2 150");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][2] == 255, "_repeat_vel_scale: >127 -> Thru");
        hx_set_param(h, "t3_l7_repeat_nudge", "2 -20");
        HX_ASSERT(dt->drum_repeat_nudge[7][2] == -20, "_repeat_nudge: step2 ->-20");
        hx_set_param(h, "t3_l7_repeat_defaults", "2");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][2] == 255 && dt->drum_repeat_nudge[7][2] == 0,
                  "_repeat_defaults: step2 vel/nudge reset (Thru)");
        HX_ASSERT(dt->drum_repeat_gate[7] == 170, "_repeat_defaults: does NOT touch gate mask");
        hx_set_param(h, "t3_l7_repeat_groove_reset", "1");
        HX_ASSERT(dt->drum_repeat_gate[7] == 0xFF && dt->drum_repeat_gate_len[7] == 8,
                  "_repeat_groove_reset: gate/len -> defaults");
        HX_ASSERT(dt->drum_repeat_vel_scale[7][0] == 255 && dt->drum_repeat_nudge[7][0] == 0,
                  "_repeat_groove_reset: vel/nudge -> defaults (Thru)");

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
        HX_ASSERT(ct->tarp.step_vel[3] == 255 && ct->tarp.step_int[2] == 0 &&
                  ct->tarp.step_loop_len == 8, "tarp_reset: step arrays -> defaults (Thru)");
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
        /* Monotonic allocation: kept + lanes cleared, never freed mid-life. */
        HX_ASSERT(ct->drum_clips[0] != NULL, "pad_mode: melodic keeps drum_clips");
        HX_ASSERT(ct->drum_clips[0]->lanes[0].clip.note_count == 0,
                  "pad_mode: melodic clears kept drum lanes");

        /* convert_to_drum / convert_to_melodic: type flip + note translation
         * (observable = pad_mode + drum_clips alloc state). */
        hx_set_param(h, "t2_convert_to_drum", "1");
        HX_ASSERT(ct->pad_mode == PAD_MODE_DRUM, "convert_to_drum: -> DRUM");
        HX_ASSERT(ct->drum_clips[0] != NULL, "convert_to_drum: allocates drum_clips");
        hx_set_param(h, "t2_convert_to_melodic", "1");
        HX_ASSERT(ct->pad_mode == PAD_MODE_MELODIC_SCALE, "convert_to_melodic: -> melodic");
        HX_ASSERT(ct->drum_clips[0] != NULL, "convert_to_melodic: keeps drum_clips");
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

    /* ---- Live-monitoring white-box pins (Phase 4B group 7 prep). Runs after the
     * table (currently the last white-box block). The sp_track_live group
     * (live_notes, live_at, padmap) on dedicated track t7 (melodic, default
     * ROUTE_SCHWUNG -> HX_MIDI_INTERNAL capture, channel 7). ORDER is load-bearing:
     * live_notes/live_at run FIRST (while dsp_inbound_enabled==0), because the
     * padmap push sets dsp_inbound_enabled=1 and live_notes early-returns whenever
     * that flag is set (guard pinned below); padmap runs LAST, then
     * dsp_inbound_enabled is restored to 0. ---- */
    {
        seq8_track_t *lt = &inst->tracks[7];
        const int TIDX = 7;
        HX_ASSERT(inst->dsp_inbound_enabled == 0,
                  "live block precondition: inbound disabled (live_notes reachable)");
        HX_ASSERT(lt->pad_mode == PAD_MODE_MELODIC_SCALE, "live block precondition: t7 melodic");
        HX_ASSERT(lt->tarp_on == 0 && lt->pfx.arp.style == 0,
                  "live block precondition: t7 no arp (single-note emit)");
        HX_ASSERT(lt->channel == 7, "live block precondition: t7 channel 7");
        lt->pfx.looper_on = 0;   /* deterministic pass-through emit (no looper capture) */

        /* live_notes "on <p> [v]": immediate note-on through pfx_note_on ->
         * INTERNAL 0x9<ch> p v. */
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_notes", "on 64 100");
        {
            int j, found = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0x90 | 7) &&
                    e->bytes[2] == 64 && e->bytes[3] == 100) found = 1;
            }
            HX_ASSERT(found, "live_notes on: emits note-on 0x97 64 100 on internal route");
        }

        /* live_notes "off <p>": note-off 0x8<ch> p 0. Chains on the on above
         * (pfx_note_off_imm no-ops on a note that was never sounding). */
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_notes", "off 64");
        {
            int j, found = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0x80 | 7) &&
                    e->bytes[2] == 64) found = 1;
            }
            HX_ASSERT(found, "live_notes off: emits note-off 0x87 64 (chains on prior on)");
        }

        /* live_notes default velocity: "on <p>" with no vel uses SEQ_VEL. */
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_notes", "on 62");
        {
            int j, found = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0x90 | 7) &&
                    e->bytes[2] == 62 && e->bytes[3] == SEQ_VEL) found = 1;
            }
            HX_ASSERT(found, "live_notes on (no vel): emits at SEQ_VEL default");
        }
        hx_set_param(h, "t7_live_notes", "off 62");   /* release (refcount clean) */

        /* live_notes batch: multiple events left-to-right in one payload. */
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_notes", "on 70 55 on 72 66");
        {
            int j, f70 = 0, f72 = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0x90 | 7)) {
                    if (e->bytes[2] == 70 && e->bytes[3] == 55) f70 = 1;
                    if (e->bytes[2] == 72 && e->bytes[3] == 66) f72 = 1;
                }
            }
            HX_ASSERT(f70 && f72, "live_notes batch: both note-ons emitted from one payload");
        }
        hx_set_param(h, "t7_live_notes", "off 70 off 72");   /* release */

        /* live_notes guard: dsp_inbound_enabled=1 -> PLAIN (pad-origin) tokens
         * are skipped (on_midi already dispatched on the audio thread), so NO
         * fallback emit — this is the padmap<->live_notes chaining constraint
         * the group-7 conversion must preserve, on EVERY route (a route-aware
         * carve-out here was tried and double-fired pads on non-Move tracks).
         * EXT-origin tokens ("eon p v"/"eoff p", fix/extmidi-inbound) are the
         * one exception: non-Move ext never reaches on_midi (shim BLOCK), so
         * they are always processed — pinned in test_extmidi_inbound.c, with
         * one representative emit here. */
        inst->dsp_inbound_enabled = 1;
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_notes", "on 80 90");
        HX_ASSERT(hx_stub_event_count() == 0, "live_notes: inbound-enabled -> plain tokens skipped, no emit");
        hx_set_param(h, "t7_live_notes", "eon 81 90");
        {
            int j, found = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0x90 | 7) &&
                    e->bytes[2] == 81 && e->bytes[3] == 90) found = 1;
            }
            HX_ASSERT(found, "live_notes: inbound-enabled -> ext token still emits");
        }
        hx_set_param(h, "t7_live_notes", "eoff 81");
        inst->dsp_inbound_enabled = 0;

        /* live_at poly (mode 1): pfx_send 0xA<ch> pitch press; stores
         * last_poly_at_press for arp replay. */
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_at", "64 90 1");
        {
            int j, found = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0xA0 | 7) &&
                    e->bytes[2] == 64 && e->bytes[3] == 90) found = 1;
            }
            HX_ASSERT(found, "live_at poly: emits poly AT 0xA7 64 90");
        }
        HX_ASSERT(lt->last_poly_at_press == 90, "live_at poly: stores last_poly_at_press=90");

        /* live_at channel (mode 2): pfx_send 0xD<ch> press 0; clears
         * last_poly_at_press (channel mode needs no arp replay). */
        hx_clear_capture(h);
        hx_set_param(h, "t7_live_at", "60 77 2");
        {
            int j, found = 0;
            for (j = 0; j < hx_stub_event_count(); j++) {
                const hx_midi_event *e = hx_stub_event(j);
                if (e->kind == HX_MIDI_INTERNAL && e->bytes[1] == (0xD0 | 7) &&
                    e->bytes[2] == 77 && e->bytes[3] == 0) found = 1;
            }
            HX_ASSERT(found, "live_at channel: emits channel AT 0xD7 77 0");
        }
        HX_ASSERT(lt->last_poly_at_press == 0, "live_at channel: clears last_poly_at_press");

        /* padmap: the platform global-carrier. 32 pad pitches -> pad_note_map[7][],
         * then active_track + dsp_inbound_enabled set unconditionally, then trailing
         * pad_dispatch_muted / delete_held / corun_left_silent. Pitches 40..71 +
         * trailing "1 0 1" (full two-polarity contract also in
         * test_padmap_contract.c; pinned here so the group-7 conversion is
         * behavior-gated by this suite). */
        hx_set_param(h, "t7_padmap",
            "40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 "
            "56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 "
            "1 0 1");
        HX_ASSERT(inst->active_track == 7, "padmap: sets active_track = tidx (7)");
        HX_ASSERT(inst->dsp_inbound_enabled == 1, "padmap: enables dsp_inbound (carrier)");
        HX_ASSERT(inst->pad_note_map[TIDX][0] == 40, "padmap: pad_note_map[7][0]=40");
        HX_ASSERT(inst->pad_note_map[TIDX][31] == 71, "padmap: pad_note_map[7][31]=71");
        HX_ASSERT(inst->pad_dispatch_muted == 1, "padmap: token 33 -> pad_dispatch_muted=1");
        HX_ASSERT(inst->delete_held == 0, "padmap: token 34 -> delete_held=0");
        HX_ASSERT(inst->corun_left_silent == 1, "padmap: token 35 -> corun_left_silent=1");

        /* second push, opposite trailing polarities + 0xFF sentinels: pins each
         * trailing token independently and the unmapped 0xFF sentinel. */
        hx_set_param(h, "t7_padmap",
            "255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 "
            "255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 "
            "0 1 0");
        HX_ASSERT(inst->pad_note_map[TIDX][0] == 0xFF, "padmap: 255 -> 0xFF sentinel");
        HX_ASSERT(inst->pad_note_map[TIDX][31] == 0xFF, "padmap: last pad 0xFF sentinel");
        HX_ASSERT(inst->pad_dispatch_muted == 0, "padmap: token 33 -> pad_dispatch_muted=0");
        HX_ASSERT(inst->delete_held == 1, "padmap: token 34 -> delete_held=1");
        HX_ASSERT(inst->corun_left_silent == 0, "padmap: token 35 -> corun_left_silent=0");

        inst->dsp_inbound_enabled = 0;   /* restore (padmap set it; no later blocks) */
    }

    /* ---- Drum-config / all-lanes / drum-repeat white-box pins (Phase 4B group 8
     * prep). Runs after the table (order-neutral; all white-box blocks run after
     * the table in file order). Characterizes the sp_track_drum2 group — drum
     * config scalars, the all_lanes_* fan-out transforms, the Rpt1/Rpt2 note-repeat
     * engine state, and drum-record capture — on t0, the harness's pristine default
     * DRUM track (create_instance forces track 0 to DRUM + allocates its 16 drum
     * clips when no track loads as drum; the only prior t0 touches are the table's
     * t0_xpose_*, and xpose_commit SKIPS drum tracks, so t0's active drum clip is
     * untouched here). Nothing asserts t0 after this block, so its mutations are
     * collision-safe. diq / drum_repeat_sync are serialized (t%ddiq / t%ddsy) and
     * covered by the t6 table rows. delete_held is a GLOBAL inst flag — pinned both
     * ways and RESTORED to 0 so it does not leak. Transport is stopped and
     * dsp_inbound_enabled==0 (the live block restored it), so all_lanes playhead
     * re-anchoring is inert and drum-record takes the STOCK capture path (base =
     * drum_current_step/drum_tick_in_step, set white-box). The Rpt1/Rpt2 *firing*
     * (drum_repeat_tick/drum_repeat2_tick) is RT/render-only and OUT OF SCOPE —
     * only the engine state each setter writes is pinned. The all_lanes_* ops chain
     * (each transforms the same 32 lanes of the active clip); per-lane transform
     * SEMANTICS are already pinned in the group-3 block, so here we pin the FAN-OUT
     * (a representative field on lane0 + lane31). ---- */
    {
        seq8_track_t *dt = &inst->tracks[0];
        HX_ASSERT(dt->pad_mode == PAD_MODE_DRUM, "group8 precondition: t0 is the default DRUM track");
        const int AC = dt->active_clip;
        HX_ASSERT(dt->drum_clips[AC] != NULL, "group8 precondition: t0 active drum clip allocated");
        drum_clip_t *dc = dt->drum_clips[AC];

        /* --- drum config scalars --- */

        /* drum_mute_all_clear: zeroes BOTH the lane mute and solo bitmasks. */
        dt->drum_lane_mute = 0x2A; dt->drum_lane_solo = 0x15;
        hx_set_param(h, "t0_drum_mute_all_clear", "1");
        HX_ASSERT(dt->drum_lane_mute == 0 && dt->drum_lane_solo == 0,
                  "drum_mute_all_clear: clears both lane mute + solo masks");

        /* drum_lanes_qnt: fans NoteFX quantize out to all 32 lanes' pfx_params. */
        hx_set_param(h, "t0_drum_lanes_qnt", "50");
        HX_ASSERT(dc->lanes[0].pfx_params.quantize == 50 &&
                  dc->lanes[DRUM_LANES-1].pfx_params.quantize == 50,
                  "drum_lanes_qnt: quantize=50 fanned to lane0 + lane31");

        /* active_drum_lane: stored track field, clamped 0..DRUM_LANES-1. */
        hx_set_param(h, "t0_active_drum_lane", "7");
        HX_ASSERT(dt->active_drum_lane == 7, "active_drum_lane: ->7");
        hx_set_param(h, "t0_active_drum_lane", "99");
        HX_ASSERT(dt->active_drum_lane == DRUM_LANES - 1, "active_drum_lane: high clamp to 31");

        /* drum_lane_page: clamped 0..(DRUM_LANES+15)/16-1 (=1 for 32 lanes). */
        hx_set_param(h, "t0_drum_lane_page", "1");
        HX_ASSERT(dt->drum_lane_page == 1, "drum_lane_page: ->1");
        hx_set_param(h, "t0_drum_lane_page", "99");
        HX_ASSERT(dt->drum_lane_page == 1, "drum_lane_page: high clamp to 1");

        /* drum_perform_mode: clamped 0..2 (0=NORMAL,1=Rpt1,2=Rpt2). */
        hx_set_param(h, "t0_drum_perform_mode", "2");
        HX_ASSERT(dt->drum_perform_mode == 2, "drum_perform_mode: ->2");
        hx_set_param(h, "t0_drum_perform_mode", "99");
        HX_ASSERT(dt->drum_perform_mode == 2, "drum_perform_mode: high clamp to 2");

        /* delete_held: GLOBAL inst flag (0/1). Restored to 0 below (no leak). */
        hx_set_param(h, "t0_delete_held", "1");
        HX_ASSERT(inst->delete_held == 1, "delete_held: global flag ->1");
        hx_set_param(h, "t0_delete_held", "0");
        HX_ASSERT(inst->delete_held == 0, "delete_held: global flag ->0 (restored)");

        /* --- all_lanes_* fan-out transforms (pin lane0 + lane31). --- */
        {
            clip_t *L0  = &dc->lanes[0].clip;
            clip_t *L31 = &dc->lanes[DRUM_LANES-1].clip;

            /* clip_resolution idx2 -> TPS_VALUES[2]=48 on all lanes. */
            hx_set_param(h, "t0_all_lanes_clip_resolution", "2");
            HX_ASSERT(L0->ticks_per_step == 48 && L31->ticks_per_step == 48,
                      "all_lanes_clip_resolution: tps 48 fanned to lane0 + lane31");

            /* playback_dir 3 (Pingpong-Backward) -> dir=3, pp_dir_state=-1 on all. */
            hx_set_param(h, "t0_all_lanes_playback_dir", "3");
            HX_ASSERT(L0->playback_dir == 3 && L31->playback_dir == 3,
                      "all_lanes_playback_dir: dir=3 fanned out");
            HX_ASSERT(L0->pp_dir_state == -1 && L31->pp_dir_state == -1,
                      "all_lanes_playback_dir: pp_dir_state=-1 fanned out");

            /* playback_audio_reverse 1 on all. */
            hx_set_param(h, "t0_all_lanes_playback_audio_reverse", "1");
            HX_ASSERT(L0->playback_audio_reverse == 1 && L31->playback_audio_reverse == 1,
                      "all_lanes_playback_audio_reverse: fanned out");

            /* length 16 on all (loop_start 0, max_len SEQ_STEPS). */
            hx_set_param(h, "t0_all_lanes_length", "16");
            HX_ASSERT(L0->length == 16 && L31->length == 16,
                      "all_lanes_length: length=16 fanned out");

            /* clock_shift dir=1 -> clock_shift_pos = (0+1)%16 = 1 on all. */
            hx_set_param(h, "t0_all_lanes_clock_shift", "1");
            HX_ASSERT(L0->clock_shift_pos == 1 && L31->clock_shift_pos == 1,
                      "all_lanes_clock_shift: clock_shift_pos=1 fanned out");

            /* nudge dir=1 -> nudge_pos+1; dir=0 -> resets nudge_pos. */
            hx_set_param(h, "t0_all_lanes_nudge", "1");
            HX_ASSERT(L0->nudge_pos == 1 && L31->nudge_pos == 1,
                      "all_lanes_nudge: nudge_pos+1 fanned out");
            hx_set_param(h, "t0_all_lanes_nudge", "0");
            HX_ASSERT(L0->nudge_pos == 0 && L31->nudge_pos == 0,
                      "all_lanes_nudge: dir=0 resets nudge_pos on all");

            /* beat_stretch dir=1 (pre-flight OK: 16*2<=SEQ_STEPS): length 16->32,
             * stretch_exp++, all_lanes_stretch_result=1. dir=-1: back to 16. */
            int se0 = L0->stretch_exp;
            hx_set_param(h, "t0_all_lanes_beat_stretch", "1");
            HX_ASSERT(inst->all_lanes_stretch_result == 1,
                      "all_lanes_beat_stretch: pre-flight passed (result=1)");
            HX_ASSERT(L0->length == 32 && L31->length == 32,
                      "all_lanes_beat_stretch: dir=1 length 16->32 fanned out");
            HX_ASSERT(L0->stretch_exp == se0 + 1 && L31->stretch_exp == se0 + 1,
                      "all_lanes_beat_stretch: stretch_exp++ fanned out");
            hx_set_param(h, "t0_all_lanes_beat_stretch", "-1");
            HX_ASSERT(L0->length == 16 && L31->length == 16,
                      "all_lanes_beat_stretch: dir=-1 length 32->16 fanned out");

            /* loop_set packed ls=2 len=4 = (2<<16)|4 = 131076 on all. */
            hx_set_param(h, "t0_all_lanes_loop_set", "131076");
            HX_ASSERT(L0->loop_start == 2 && L0->length == 4 &&
                      L31->loop_start == 2 && L31->length == 4,
                      "all_lanes_loop_set: ls=2 len=4 fanned out");

            /* double_fill: length 4->8 on all (4*2<=SEQ_STEPS). */
            hx_set_param(h, "t0_all_lanes_double_fill", "1");
            HX_ASSERT(L0->length == 8 && L31->length == 8,
                      "all_lanes_double_fill: length 4->8 fanned out");
        }

        /* --- Rpt1 note-repeat engine (drum_repeat_*). sync=0 first so the
         * first-fire boundary snap is deterministic (pending=0; default sync=1). --- */
        hx_set_param(h, "t0_drum_repeat_sync", "0");
        hx_set_param(h, "t0_drum_repeat_start", "5 3 90");
        HX_ASSERT(dt->drum_repeat_active == 1, "drum_repeat_start: active=1");
        HX_ASSERT(dt->drum_repeat_lane == 5 && dt->drum_repeat_rate_idx == 3 &&
                  dt->drum_repeat_vel == 90, "drum_repeat_start: lane/rate/vel latched");
        HX_ASSERT(dt->drum_repeat_step == 0 && dt->drum_repeat_phase == 0,
                  "drum_repeat_start: step/phase reset");
        HX_ASSERT(dt->drum_repeat_pending == 0, "drum_repeat_start: sync=0 -> pending 0 (instant)");

        hx_set_param(h, "t0_drum_repeat_vel", "77");
        HX_ASSERT(dt->drum_repeat_vel == 77, "drum_repeat_vel: ->77");

        hx_set_param(h, "t0_drum_repeat_lane", "8");
        HX_ASSERT(dt->drum_repeat_lane == 8, "drum_repeat_lane: ->8");
        HX_ASSERT(dt->drum_repeat_active == 1, "drum_repeat_lane: does not disturb active");

        hx_set_param(h, "t0_drum_repeat_latched", "1");
        HX_ASSERT(dt->drum_repeat_latched == 1, "drum_repeat_latched: ->1");

        hx_set_param(h, "t0_drum_repeat_stop", "1");
        HX_ASSERT(dt->drum_repeat_active == 0 && dt->drum_repeat_pending == 0 &&
                  dt->drum_repeat_latched == 0, "drum_repeat_stop: clears active/pending/latched");

        /* --- Rpt2 per-lane engine (drum_repeat2_*, bitmask over 32 lanes). --- */
        hx_set_param(h, "t0_drum_repeat2_rate", "6 4");
        HX_ASSERT(dt->drum_repeat2_rate_idx[6] == 4, "drum_repeat2_rate: lane6 rate_idx->4");

        hx_set_param(h, "t0_drum_repeat2_lane_on", "6 88");
        HX_ASSERT((dt->drum_repeat2_active >> 6) & 1, "drum_repeat2_lane_on: lane6 active bit set");
        HX_ASSERT(!((dt->drum_repeat2_pending >> 6) & 1), "drum_repeat2_lane_on: sync=0 -> not pending");
        HX_ASSERT(dt->drum_repeat2_vel[6] == 88, "drum_repeat2_lane_on: lane6 vel=88");
        HX_ASSERT(dt->drum_repeat2_phase[6] == 0 && dt->drum_repeat2_step[6] == 0,
                  "drum_repeat2_lane_on: lane6 phase/step reset");

        hx_set_param(h, "t0_drum_repeat2_vel", "6 55");
        HX_ASSERT(dt->drum_repeat2_vel[6] == 55, "drum_repeat2_vel: lane6 vel->55");

        hx_set_param(h, "t0_drum_repeat2_lane_latched", "6 1");
        HX_ASSERT((dt->drum_repeat2_latched_lanes >> 6) & 1, "drum_repeat2_lane_latched: 1-edge sets bit6");
        hx_set_param(h, "t0_drum_repeat2_lane_latched", "6 0");
        HX_ASSERT(!((dt->drum_repeat2_latched_lanes >> 6) & 1), "drum_repeat2_lane_latched: 0-edge clears bit6");

        /* latch_held: ORs active|pending into latched; lane6 is active -> latched. */
        hx_set_param(h, "t0_drum_repeat2_latch_held", "1");
        HX_ASSERT((dt->drum_repeat2_latched_lanes >> 6) & 1,
                  "drum_repeat2_latch_held: ORs active(lane6) into latched");

        hx_set_param(h, "t0_drum_repeat2_lane_off", "6");
        HX_ASSERT(!((dt->drum_repeat2_active >> 6) & 1) &&
                  !((dt->drum_repeat2_pending >> 6) & 1) &&
                  !((dt->drum_repeat2_latched_lanes >> 6) & 1),
                  "drum_repeat2_lane_off: clears active+pending+latched bit6");

        /* stop: clears ALL active/pending/latched. Re-arm lane7 first. */
        hx_set_param(h, "t0_drum_repeat2_lane_on", "7 100");
        hx_set_param(h, "t0_drum_repeat2_lane_latched", "7 1");
        HX_ASSERT(dt->drum_repeat2_active != 0, "drum_repeat2_stop setup: lane7 armed");
        hx_set_param(h, "t0_drum_repeat2_stop", "1");
        HX_ASSERT(dt->drum_repeat2_active == 0 && dt->drum_repeat2_pending == 0 &&
                  dt->drum_repeat2_latched_lanes == 0,
                  "drum_repeat2_stop: clears all active/pending/latched");

        /* --- drum_record_note_on / _off (stock path: dsp_inbound_enabled==0).
         * Records onto the active drum clip's lane whose midi_note matches the
         * pitch, at the lane's drum_current_step. Guarded on tr->recording. Uses
         * the current in-window step (loop_start=2 after all_lanes_loop_set/
         * double_fill; window [2,10)). Gate math is in TICKS_PER_STEP units,
         * independent of the clip's tps. --- */
        {
            const int lane = 4;
            clip_t *rc = &dc->lanes[lane].clip;
            uint8_t mn = dc->lanes[lane].midi_note;   /* DRUM_BASE_NOTE + 4 = 40 */
            uint16_t rstep = rc->loop_start;
            char von[32], voff[32];
            snprintf(von,  sizeof(von),  "%d 101", (int)mn);
            snprintf(voff, sizeof(voff), "%d",     (int)mn);

            /* _on guard: not recording -> dropped. */
            dt->recording = 0; dt->drum_inp_quant = 0;
            dt->drum_current_step[lane] = rstep; dt->drum_tick_in_step[lane] = 0;
            uint8_t sc0 = rc->step_note_count[rstep];
            hx_set_param(h, "t0_drum_record_note_on", von);
            HX_ASSERT(rc->step_note_count[rstep] == sc0,
                      "drum_record_note_on: no-op when not recording (guard)");

            /* _on capture (stock path): base_step=loop_start(2), off=0 -> step 2. */
            dt->recording = 1;
            dt->drum_current_step[lane] = rstep; dt->drum_tick_in_step[lane] = 0;
            hx_set_param(h, "t0_drum_record_note_on", von);
            HX_ASSERT(rc->steps[rstep] == 1 && rc->step_note_count[rstep] == 1,
                      "drum_record_note_on: step hit inserted at drum_current_step");
            HX_ASSERT(rc->step_notes[rstep][0] == mn && rc->step_vel[rstep] == 101,
                      "drum_record_note_on: lane note + vel captured");
            HX_ASSERT(rc->step_gate[rstep] == GATE_TICKS,
                      "drum_record_note_on: gate = GATE_TICKS pending close");
            HX_ASSERT(dt->drum_rec_pending_active[lane] == 1,
                      "drum_record_note_on: rec-pending armed for the lane");

            /* _off guard: not recording -> gate unchanged. */
            dt->recording = 0;
            dt->drum_current_step[lane] = (uint16_t)(rstep + 2); dt->drum_tick_in_step[lane] = 0;
            hx_set_param(h, "t0_drum_record_note_off", voff);
            HX_ASSERT(rc->step_gate[rstep] == GATE_TICKS,
                      "drum_record_note_off: no-op when not recording (guard)");

            /* _off capture: off_tick=(rstep+2)*TICKS_PER_STEP, on_tick=rstep*TICKS_PER_STEP
             * -> gate=2*TICKS_PER_STEP=48 (drum gate math is in TICKS_PER_STEP, not clip tps). */
            dt->recording = 1;
            hx_set_param(h, "t0_drum_record_note_off", voff);
            HX_ASSERT(rc->step_gate[rstep] == 2 * TICKS_PER_STEP,
                      "drum_record_note_off: gate = (off-on) = 2 steps = 48 ticks");
            HX_ASSERT(dt->drum_rec_pending_active[lane] == 0,
                      "drum_record_note_off: rec-pending consumed");

            dt->recording = 0;   /* leave t0 non-recording */
        }
    }

    /* ---- Melodic-clip-transform + pfx catch-all white-box pins (Phase 4B
     * group 9 prep). Runs after the table (order-neutral; all white-box blocks
     * run after the table in file order). The sp_track_misc group is the
     * TERMINAL set_param segment: 8 active-melodic-clip transform branches
     * (clip_length / clip_playback_dir / clip_playback_audio_reverse /
     * clock_shift / nudge / beat_stretch / loop_double_fill / lgto_apply) THEN
     * an UNCONDITIONAL pfx_set catch-all (any unmatched tN_ sub-key -> pfx_set
     * on the active clip's pfx_params; preceded by an undo snapshot for the
     * pfx_*_reset keys). These are BARE tN_ keys operating on
     * tr->clips[active_clip] (NO cC prefix -- DISTINCT from sp_track_clip's
     * tN_cC_* keys, which target an explicit clip). Runs on dedicated MELODIC
     * track t7: t7's prior touches were the group-2 cc-auto block (clip_cc_auto
     * lanes) and the group-7 live block (live/padmap paths) — never the clip_t
     * note/step arrays (except c0 via xpose), so clips 1..9 are pristine. active_clip is struct-set per concern to a
     * distinct clip, with distinct magic numbers, so nothing chains. Nothing
     * asserts t7 after this block. OUT OF SCOPE (RT/transport): current_step /
     * playhead re-anchoring after length/shift changes, and
     * clip_playback_dir's silence_track_from_set_param side effect (transport
     * stopped here -- exercised, not separately observable). ---- */
    {
        seq8_track_t *xt = &inst->tracks[7];
        HX_ASSERT(xt->pad_mode == PAD_MODE_MELODIC_SCALE, "group9 precondition: t7 melodic");
        /* t7 clips 0/1/3 are NOT pristine (table rows: c0 xpose note, c1
         * loop_set -> loop_start 3, c3 length). Use only clips 2 + 4..13. */

        /* clip_length: bare key (NO cC) operates on the ACTIVE clip; clamps to
         * max_len = SEQ_STEPS - loop_start. DISTINCT from sp_track_clip's
         * tN_cC_length (explicit clip + rui_touch): this one follows active_clip
         * and does NOT rui_touch. */
        {
            uint32_t rev0 = inst->rui_rev;
            xt->active_clip = 10;
            hx_set_param(h, "t7_clip_length", "37");
            HX_ASSERT(xt->clips[10].length == 37, "clip_length: active clip10 length->37");
            HX_ASSERT(xt->clips[12].length != 37, "clip_length: non-active clip12 untouched (follows active_clip)");
            /* 2026-07-19: clip_length is remote-visible content — it now
             * rui_marks (the old no-bump behavior left the browser stale). */
            HX_ASSERT(inst->rui_rev == rev0 + 1, "clip_length: rui_marks (remote-visible)");
            hx_set_param(h, "t7_clip_length", "999");
            HX_ASSERT(xt->clips[10].length == SEQ_STEPS, "clip_length: clamps to SEQ_STEPS - loop_start (loop_start 0)");
        }

        /* clip_playback_dir: dir 0..3 clamp + pp_dir_state = initial_pp_dir. */
        xt->active_clip = 4;
        hx_set_param(h, "t7_clip_playback_dir", "3");
        HX_ASSERT(xt->clips[4].playback_dir == 3, "clip_playback_dir: dir->3");
        HX_ASSERT(xt->clips[4].pp_dir_state == -1, "clip_playback_dir: pp_dir_state initial -1 for dir 3");
        hx_set_param(h, "t7_clip_playback_dir", "99");
        HX_ASSERT(xt->clips[4].playback_dir == 3, "clip_playback_dir: clamps 99->3");

        /* clip_playback_audio_reverse: 0..1 clamp. */
        xt->active_clip = 5;
        hx_set_param(h, "t7_clip_playback_audio_reverse", "1");
        HX_ASSERT(xt->clips[5].playback_audio_reverse == 1, "clip_playback_audio_reverse: ->1");
        hx_set_param(h, "t7_clip_playback_audio_reverse", "9");
        HX_ASSERT(xt->clips[5].playback_audio_reverse == 1, "clip_playback_audio_reverse: clamps 9->1");

        /* clock_shift: dir=1 rotates step0->step1 (mirrors the drum-lane
         * _clock_shift already pinned, but on the active melodic clip). */
        {
            clip_t *c6 = &xt->clips[6];
            xt->active_clip = 6;
            hx_set_param(h, "t7_c6_length", "4");
            hx_set_param(h, "t7_c6_step_0_toggle", "60 100");
            hx_set_param(h, "t7_clock_shift", "1");
            HX_ASSERT(c6->steps[1] == 1 && c6->steps[0] == 0, "clock_shift: dir=1 rotates step0->step1");
            HX_ASSERT(c6->clock_shift_pos == 1, "clock_shift: pos->1");
        }

        /* nudge: dir=1 offsets +1 (below midpoint tps/2=12, stays in-step);
         * dir=0 resets nudge_pos. */
        {
            clip_t *c7 = &xt->clips[7];
            xt->active_clip = 7;
            hx_set_param(h, "t7_c7_step_0_toggle", "60 100");
            hx_set_param(h, "t7_nudge", "1");
            HX_ASSERT(c7->note_tick_offset[0][0] == 1, "nudge: dir=1 offset+1");
            HX_ASSERT(c7->nudge_pos == 1, "nudge: pos+1");
            hx_set_param(h, "t7_nudge", "0");
            HX_ASSERT(c7->nudge_pos == 0, "nudge: dir=0 resets pos");
        }

        /* beat_stretch: dir=1 doubles length + stretch_exp++, dir=-1 back. */
        {
            clip_t *c8 = &xt->clips[8];
            xt->active_clip = 8;
            hx_set_param(h, "t7_c8_length", "4");
            hx_set_param(h, "t7_c8_step_0_toggle", "60 100");
            int se0 = c8->stretch_exp;
            hx_set_param(h, "t7_beat_stretch", "1");
            HX_ASSERT(c8->length == 8, "beat_stretch: dir=1 length 4->8");
            HX_ASSERT(c8->stretch_exp == se0 + 1, "beat_stretch: stretch_exp++");
            HX_ASSERT(c8->steps[0] == 1, "beat_stretch: step0 kept at index 0");
            hx_set_param(h, "t7_beat_stretch", "-1");
            HX_ASSERT(c8->length == 4, "beat_stretch: dir=-1 length 8->4");
            HX_ASSERT(c8->stretch_exp == se0, "beat_stretch: stretch_exp-- back");
        }

        /* loop_double_fill: doubles the loop window, copying content forward. */
        {
            clip_t *c9 = &xt->clips[9];
            xt->active_clip = 9;
            hx_set_param(h, "t7_c9_length", "4");
            hx_set_param(h, "t7_c9_step_0_toggle", "60 100");
            hx_set_param(h, "t7_c9_step_1_toggle", "62 100");
            hx_set_param(h, "t7_loop_double_fill", "1");
            HX_ASSERT(c9->length == 8, "loop_double_fill: length 4->8");
            HX_ASSERT(c9->steps[4] == 1 && c9->steps[5] == 1, "loop_double_fill: copies src into 2nd half");
        }

        /* lgto_apply: destructive legato — each note's gate becomes gap to next
         * active note. Notes at steps 0 & 2 @tps24 -> step0 gate = 48. */
        {
            clip_t *c2 = &xt->clips[2];
            xt->active_clip = 2;
            hx_set_param(h, "t7_c2_step_0_toggle", "60 100");
            hx_set_param(h, "t7_c2_step_2_toggle", "64 100");
            hx_set_param(h, "t7_lgto_apply", "1");
            HX_ASSERT(c2->step_gate[0] == 48, "lgto_apply: step0 gate = gap to next note (48 @tps24)");
        }

        /* pfx_set catch-all (CRITICAL for the group-9 conversion): the terminal
         * segment ends in an UNCONDITIONAL pfx_set on the ACTIVE clip's
         * pfx_params, so ANY unmatched tN_ sub-key is consumed there. Pin it
         * with plain pfx keys that ONLY the catch-all handles (noteFX_octave,
         * delay_level). The two pfx_*_reset keys hit the same catch-all after an
         * undo snapshot (the braceless guard preceding pfx_set). */
        {
            clip_t *c13 = &xt->clips[13];
            xt->active_clip = 13;
            HX_ASSERT(c13->pfx_params.octave_shift == 0, "pfx catch-all precondition: default octave_shift 0");
            hx_set_param(h, "t7_noteFX_octave", "3");
            HX_ASSERT(c13->pfx_params.octave_shift == 3,
                      "pfx_set catch-all: noteFX_octave routes to active clip pfx_params (->3)");
            hx_set_param(h, "t7_delay_level", "88");
            HX_ASSERT(c13->pfx_params.delay_level == 88,
                      "pfx_set catch-all: delay_level routes to active clip pfx_params (->88)");
            hx_set_param(h, "t7_pfx_noteFx_reset", "1");
            HX_ASSERT(c13->pfx_params.octave_shift == 0, "pfx_noteFx_reset: octave_shift back to 0 (catch-all + undo)");
            hx_set_param(h, "t7_pfx_delay_reset", "1");
            HX_ASSERT(c13->pfx_params.delay_level == 0, "pfx_delay_reset: delay_level back to 0 (catch-all + undo)");
        }
    }

    /* ---- Globals-MISC white-box pins (Phase 4B group 11 prep). Runs after the
     * table (order-neutral; all white-box blocks run after the table in file
     * order) but INTENTIONALLY BEFORE the globals-STATE block below: that block's
     * state_load pin RESETS the whole instance (transport/merge/per-track
     * playback), which would clobber the looper/merge/launch state this block
     * arms. Characterizes sp_globals_misc's 17 keys — three subsystems plus
     * standalone keys — all top-level strcmp(key,...) matches with NO track index,
     * so they collide with nothing above. These are state-machine transitions
     * (very pinnable) and clip mutations; the RT capture/playback (looper_tick)
     * and bake-firing (offline pfx-chain apply) paths are noted OUT-OF-SCOPE and
     * covered elsewhere (looper replay: test_engine_goldens.c "looper"; bake
     * loop-unroll/vel-fold: test_bake_convert.c). Distinct magic numbers per key.
     * mute_all_clear (the GLOBAL one) is pinned here; the per-track
     * t0_drum_mute_all_clear pinned in the group-8 block is a DIFFERENT key. ---- */
    {
        /* ---- LOOPER state machine (looper_arm/stop/retrigger/sync). The global
         * MIDI looper capture/replay (looper_tick, perf_apply) is RT/render-only
         * and OUT OF SCOPE — only the set_param state transitions are pinned. The
         * looper is pristine here (nothing touched it in this TU). ---- */

        /* looper_sync: truthy flag. Default is 1 (set in create_instance). */
        hx_set_param(h, "looper_sync", "0");
        HX_ASSERT(inst->looper_sync == 0, "looper_sync: 0 -> off");
        hx_set_param(h, "looper_sync", "5");
        HX_ASSERT(inst->looper_sync == 1, "looper_sync: nonzero -> on (truthy)");

        /* looper_arm from IDLE, sync=0 -> CAPTURING immediately; clamps ticks
         * 1..65535; zeroes the capture cursors. */
        hx_set_param(h, "looper_sync", "0");
        hx_set_param(h, "looper_arm", "8");
        HX_ASSERT(inst->looper_state == LOOPER_STATE_CAPTURING, "looper_arm sync=0: -> CAPTURING");
        HX_ASSERT(inst->looper_capture_ticks == 8, "looper_arm: capture_ticks=8");
        HX_ASSERT(inst->looper_pos == 0 && inst->looper_event_count == 0 &&
                  inst->looper_play_idx == 0, "looper_arm: cursors zeroed");
        /* clamp low: 0 -> 1 */
        hx_set_param(h, "looper_arm", "0");
        HX_ASSERT(inst->looper_capture_ticks == 1, "looper_arm: 0 clamps to 1 tick");

        /* looper_arm from IDLE, sync=1 -> ARMED (waits for clock boundary). */
        hx_set_param(h, "looper_stop", "1");
        HX_ASSERT(inst->looper_state == LOOPER_STATE_IDLE, "looper_stop: -> IDLE");
        HX_ASSERT(inst->looper_capture_ticks == 0, "looper_stop: capture_ticks cleared");
        hx_set_param(h, "looper_sync", "1");
        hx_set_param(h, "looper_arm", "16");
        HX_ASSERT(inst->looper_state == LOOPER_STATE_ARMED, "looper_arm sync=1: -> ARMED");
        HX_ASSERT(inst->looper_capture_ticks == 16, "looper_arm: capture_ticks=16");

        /* looper_arm while already LOOPING: does NOT re-arm; stages a pending
         * rate change instead. Same-length request -> pending=0 (cancel); a
         * different length -> pending=new. State stays LOOPING throughout. */
        inst->looper_state = LOOPER_STATE_LOOPING;
        inst->looper_capture_ticks = 16;
        inst->looper_pending_rate_ticks = 0;
        hx_set_param(h, "looper_arm", "16");   /* == current capture length */
        HX_ASSERT(inst->looper_state == LOOPER_STATE_LOOPING, "looper_arm LOOPING: state unchanged");
        HX_ASSERT(inst->looper_pending_rate_ticks == 0, "looper_arm LOOPING: same-length -> pending=0");
        hx_set_param(h, "looper_arm", "24");   /* != current capture length */
        HX_ASSERT(inst->looper_state == LOOPER_STATE_LOOPING, "looper_arm LOOPING: still LOOPING");
        HX_ASSERT(inst->looper_pending_rate_ticks == 24, "looper_arm LOOPING: new-length -> pending=24");

        /* looper_retrigger: atomic stop+arm, ALWAYS re-captures fresh regardless
         * of state (even from LOOPING). sync=0 here -> CAPTURING. */
        inst->looper_state = LOOPER_STATE_LOOPING;
        hx_set_param(h, "looper_sync", "0");
        hx_set_param(h, "looper_retrigger", "12");
        HX_ASSERT(inst->looper_state == LOOPER_STATE_CAPTURING, "looper_retrigger: re-arms from LOOPING -> CAPTURING");
        HX_ASSERT(inst->looper_capture_ticks == 12, "looper_retrigger: capture_ticks=12");
        HX_ASSERT(inst->looper_pos == 0 && inst->looper_event_count == 0,
                  "looper_retrigger: cursors zeroed");
        hx_set_param(h, "looper_stop", "1");   /* leave looper IDLE */

        /* ---- MERGE (live-merge) state machine (merge_arm/stop/place_row/cancel).
         * merge_arm captures all 8 tracks; the RT capture (looper_capture in
         * on_midi / merge_tick) is OUT OF SCOPE — only the set_param transitions
         * are pinned. Transport is stopped here, so merge_arm goes to ARMED (the
         * playing + master_tick_in_step==0 immediate-CAPTURING branch is RT). ---- */
        hx_set_param(h, "transport", "stop");
        HX_ASSERT(inst->playing == 0, "merge precondition: transport stopped");

        /* merge_arm: clears all pending counts, sets merge_tps=TICKS_PER_STEP,
         * stopped -> ARMED. */
        inst->merge_pending_count[0] = 7;   /* dirty it to prove the clear */
        hx_set_param(h, "merge_arm", "1");
        HX_ASSERT(inst->merge_state == MERGE_STATE_ARMED, "merge_arm (stopped): -> ARMED");
        HX_ASSERT(inst->merge_tps == (uint32_t)TICKS_PER_STEP, "merge_arm: merge_tps=TICKS_PER_STEP");
        HX_ASSERT(inst->merge_pending_count[0] == 0, "merge_arm: pending counts cleared");

        /* merge_cancel: discards pending, -> IDLE. */
        inst->merge_pending_count[2] = 4;
        hx_set_param(h, "merge_cancel", "1");
        HX_ASSERT(inst->merge_state == MERGE_STATE_IDLE, "merge_cancel: -> IDLE");
        HX_ASSERT(inst->merge_pending_count[2] == 0, "merge_cancel: pending discarded");

        /* merge_stop from ARMED -> merge_finalize -> IDLE (no capture to close). */
        hx_set_param(h, "merge_arm", "1");
        HX_ASSERT(inst->merge_state == MERGE_STATE_ARMED, "merge_stop setup: ARMED");
        hx_set_param(h, "merge_stop", "1");
        HX_ASSERT(inst->merge_state == MERGE_STATE_IDLE, "merge_stop from ARMED: finalize -> IDLE");

        /* merge_stop from CAPTURING -> STOPPING (defers finalize to a page
         * boundary in render; the transition itself is the observable). */
        inst->merge_state = MERGE_STATE_CAPTURING;
        hx_set_param(h, "merge_stop", "1");
        HX_ASSERT(inst->merge_state == MERGE_STATE_STOPPING, "merge_stop from CAPTURING: -> STOPPING");

        /* merge_place_row: commits captured pending notes to the chosen scene row,
         * then -> IDLE. Only acts in CAPTURED state (guarded). Set up a CAPTURED
         * merge with one pending note on melodic t4, place it into clip 12. */
        {
            const int MT = 4, MROW = 12;
            inst->merge_state = MERGE_STATE_CAPTURED;
            inst->merge_tps   = (uint32_t)TICKS_PER_STEP;
            inst->merge_end_abs = 4u * TICKS_PER_STEP;      /* -> steps=4 */
            inst->merge_pending_count[MT] = 1;
            inst->merge_pending[MT][0].pitch      = 65;
            inst->merge_pending[MT][0].tick_at_on = 0;
            inst->merge_pending[MT][0].vel        = 100;
            inst->merge_pending[MT][0].gate       = 12;
            HX_ASSERT(inst->tracks[MT].pad_mode != PAD_MODE_DRUM, "merge_place setup: t4 melodic");
            hx_set_param(h, "merge_place_row", "12");
            clip_t *mcl = &inst->tracks[MT].clips[MROW];
            HX_ASSERT(inst->merge_state == MERGE_STATE_IDLE, "merge_place_row: -> IDLE after commit");
            HX_ASSERT(inst->merge_pending_count[MT] == 0, "merge_place_row: pending count consumed");
            HX_ASSERT(mcl->note_count >= 1 && mcl->notes[0].active &&
                      mcl->notes[0].pitch == 65, "merge_place_row: pending note written to clip row");
            HX_ASSERT(mcl->length == 4, "merge_place_row: clip sized from merge_end_abs/tps");
        }

        /* ---- BAKE (offline Print). The pfx-chain apply + loop-unroll SEMANTICS
         * are covered by test_bake_convert.c (via bake_scene, which shares
         * bake_clip); here we pin only what sp_globals_misc's `bake` handler owns:
         * the arg parse + the T/C range guard, plus reachability of a valid call
         * (melodic, mode 0). One note on melodic t4 clip 13, 2 loops -> the shared
         * loop-unroll doubles note_count + length (same observable as
         * test_bake_convert). ---- */
        {
            const int BT = 4, BC = 13;
            clip_t *bcl = &inst->tracks[BT].clips[BC];
            hx_set_param(h, "t4_c13_step_0_toggle", "60 100");
            HX_ASSERT(bcl->note_count == 1 && bcl->length == 16, "bake setup: 1 note, len 16 on t4 c13");
            /* T/C range guard: out-of-range track index is a no-op. */
            hx_set_param(h, "bake", "99 13 0 2 0 0");
            HX_ASSERT(bcl->note_count == 1 && bcl->length == 16, "bake: OOB track index is a no-op");
            /* valid melodic bake, 2 loops: shared bake_clip unroll. */
            hx_set_param(h, "bake", "4 13 0 2 0 0");
            HX_ASSERT(bcl->note_count == 2, "bake: melodic 2-loop unroll doubles note_count");
            HX_ASSERT(bcl->length == 32, "bake: 2-loop unroll doubles clip length");
        }
        /* bake_scene: the full scene bake (undo snapshot + per-track fold +
         * Conductor auto-disable) is characterized in test_bake_convert.c; not
         * duplicated here. */

        /* perf_mods: stores the raw performance-modifier bitmask verbatim
         * (perf_apply that consumes it is RT/looper-tick -> out of scope). */
        hx_set_param(h, "perf_mods", "12345");
        HX_ASSERT(inst->perf_mods_active == 12345u, "perf_mods: stores bitmask verbatim");
        hx_set_param(h, "perf_mods", "0");
        HX_ASSERT(inst->perf_mods_active == 0u, "perf_mods: 0 clears");

        /* ---- launch_scene / launch_scene_quant: all-track clip launch. ---- */

        /* launch_scene, stopped: queues every track at clip M (queued_clip=M,
         * will_relaunch cleared). */
        hx_set_param(h, "transport", "stop");
        HX_ASSERT(inst->launch_quant == 0, "launch_scene precondition: launch_quant=Now(0)");
        hx_set_param(h, "launch_scene", "9");
        {
            int lt, ok_q = 1, ok_wr = 1;
            for (lt = 0; lt < NUM_TRACKS; lt++) {
                if (inst->tracks[lt].queued_clip != 9)   ok_q = 0;
                if (inst->tracks[lt].will_relaunch != 0) ok_wr = 0;
            }
            HX_ASSERT(ok_q,  "launch_scene stopped: all tracks queued_clip=9");
            HX_ASSERT(ok_wr, "launch_scene stopped: all tracks will_relaunch cleared");
        }

        /* launch_scene, immediate (playing + launch_quant=0): fires every track
         * now (active_clip=M, clip_playing=1, queued_clip cleared to -1). */
        hx_set_param(h, "transport", "play");
        hx_set_param(h, "launch_scene", "10");
        {
            int lt, ok_ac = 1, ok_pl = 1, ok_q = 1;
            for (lt = 0; lt < NUM_TRACKS; lt++) {
                if (inst->tracks[lt].active_clip != 10) ok_ac = 0;
                if (inst->tracks[lt].clip_playing != 1) ok_pl = 0;
                if (inst->tracks[lt].queued_clip != -1) ok_q = 0;
            }
            HX_ASSERT(ok_ac, "launch_scene immediate: all tracks active_clip=10");
            HX_ASSERT(ok_pl, "launch_scene immediate: all tracks clip_playing=1");
            HX_ASSERT(ok_q,  "launch_scene immediate: all tracks queued_clip=-1");
        }

        /* launch_scene_quant: ALWAYS queues at the next bar (regardless of
         * transport/launch_quant): pending_page_stop on playing tracks +
         * queued_clip=M. Tracks are playing from the immediate launch above. */
        hx_set_param(h, "launch_scene_quant", "3");
        {
            int lt, ok_q = 1, ok_pps = 1;
            for (lt = 0; lt < NUM_TRACKS; lt++) {
                if (inst->tracks[lt].queued_clip != 3)      ok_q = 0;
                if (inst->tracks[lt].pending_page_stop != 1) ok_pps = 0;
            }
            HX_ASSERT(ok_q,   "launch_scene_quant: all tracks queued_clip=3");
            HX_ASSERT(ok_pps, "launch_scene_quant: playing tracks pending_page_stop armed");
        }
        hx_set_param(h, "transport", "stop");   /* restore stopped */

        /* mute_all_clear (GLOBAL): zeroes every track's mute AND solo. */
        {
            int lt;
            for (lt = 0; lt < NUM_TRACKS; lt++) { inst->mute[lt] = 1; inst->solo[lt] = 0; }
            inst->solo[3] = 1;
            hx_set_param(h, "mute_all_clear", "1");
            int ok = 1;
            for (lt = 0; lt < NUM_TRACKS; lt++)
                if (inst->mute[lt] != 0 || inst->solo[lt] != 0) ok = 0;
            HX_ASSERT(ok, "mute_all_clear: clears all mute + solo");
        }

        /* ---- SNAPSHOTS (snap_save/load/delete): 16 slots. Round-trip: save a
         * mute/solo/drum-eff-mute pattern into a slot, mutate the live state,
         * load to restore, delete to invalidate. snap_save format:
         * "N m0..m7 s0..s7 dm0..dm7" (dm = uint32 drum eff-mute bitmask). ---- */
        {
            /* snap_save into slot 5: t0 muted, no solos, t0 drum-eff-mute = 7. */
            hx_set_param(h, "snap_save",
                         "5  1 0 0 0 0 0 0 0  0 0 0 0 0 0 0 0  7 0 0 0 0 0 0 0");
            HX_ASSERT(inst->snap_valid[5] == 1, "snap_save: slot 5 marked valid");
            HX_ASSERT(inst->snap_mute[5][0] == 1 && inst->snap_mute[5][1] == 0,
                      "snap_save: mute pattern stored");
            HX_ASSERT(inst->snap_drum_eff_mute[5][0] == 7u,
                      "snap_save: drum eff-mute bitmask stored");

            /* Mutate live state away from the snapshot. */
            {
                int lt;
                for (lt = 0; lt < NUM_TRACKS; lt++) { inst->mute[lt] = 1; inst->solo[lt] = 0; }
                inst->tracks[0].drum_lane_mute = 0xFFFFFFFFu;
                inst->tracks[0].drum_lane_solo = 9;
            }
            /* snap_load slot 5: restores mute/solo + drum_lane_mute, clears
             * drum_lane_solo. mute[1] going 1 -> 0 proves the restore. */
            hx_set_param(h, "snap_load", "5");
            HX_ASSERT(inst->mute[0] == 1, "snap_load: mute[0] restored to 1");
            HX_ASSERT(inst->mute[1] == 0, "snap_load: mute[1] restored to 0 (proves load)");
            HX_ASSERT(inst->solo[0] == 0, "snap_load: solo restored");
            HX_ASSERT(inst->tracks[0].drum_lane_mute == 7u, "snap_load: drum_lane_mute restored to 7");
            HX_ASSERT(inst->tracks[0].drum_lane_solo == 0, "snap_load: drum_lane_solo cleared");

            /* snap_delete: invalidates the slot. */
            hx_set_param(h, "snap_delete", "5");
            HX_ASSERT(inst->snap_valid[5] == 0, "snap_delete: slot 5 invalidated");

            /* snap_load on an invalid slot is a guarded no-op. */
            inst->mute[1] = 1;
            hx_set_param(h, "snap_load", "5");
            HX_ASSERT(inst->mute[1] == 1, "snap_load: invalid slot is a no-op (mute untouched)");

            /* Slot-index guard: N>=16 is a no-op (no OOB write / no crash). */
            hx_set_param(h, "snap_save",
                         "99  1 1 1 1 1 1 1 1  0 0 0 0 0 0 0 0  0 0 0 0 0 0 0 0");
            HX_ASSERT(inst->snap_valid[5] == 0, "snap_save: N>=16 is a no-op");
        }
    }

    /* ---- Globals-EDIT white-box pins (Phase 4B group 12 prep). Runs after the
     * table (order-neutral; all white-box blocks run after the table in file
     * order) but INTENTIONALLY BEFORE the globals-STATE block below, for the same
     * reason globals-misc does: that block's state_load pin RESETS the whole
     * instance (transport/merge/per-track playback), which would clobber the
     * undo/redo stack + clip content this block arms. Characterizes
     * sp_globals_edit's 9 keys — clip/row copy+cut, drum-clip copy+cut, row_clear,
     * and the undo/redo round-trips — all top-level strcmp(key,...) matches with
     * NO track index, so they collide with nothing above. Pins are direct struct
     * inspection of the clip_t step arrays (copy/cut MOVE content — memcpy'd step
     * arrays are the robust observable; the serialized tokens are doubly sparse)
     * plus the undo/redo valid-flag transitions + last_restore_info marker byte.
     * OUT OF SCOPE: the RT side effects the handlers also fire — silence_track_
     * notes_v2, pfx_note_off_imm, pfx_sync_from_clip, active-clip re-anchoring —
     * are transport/render-thread observables, not off-device pinnable.
     *
     * ISOLATION: copy/cut/clear mutate MULTIPLE clips (row ops touch all 8 tracks
     * at a column), so each concern uses a DEDICATED clip/row with distinct magic
     * numbers, seeded fresh via charz_seed_step (mode-independent — these handlers
     * operate on the tracks[t].clips[] melodic arrays regardless of pad_mode).
     * Melodic ops run on t1/t2 (both melodic; t1's only prior touch was the
     * recording block's clip 0, t2's the group-5 clip 0 — rows 4..15 pristine on
     * both). Drum ops run on t3 (DRUM since the group-3 block, all 16 drum_clips
     * allocated). Nothing asserts t1/t2/t3 clip content after this block. ---- */
    {
        /* ---- clip_copy "srcT srcC dstT dstC": dst gets src's step content +
         * geometry + rebuilt notes[]; src is left intact (copy, not cut). ---- */
        {
            clip_t *src = &inst->tracks[1].clips[14];
            clip_t *dst = &inst->tracks[1].clips[15];
            charz_seed_step(src, 3, 64, 100, 11);
            clip_init(dst);
            HX_ASSERT(dst->active == 0, "clip_copy setup: dst starts empty");
            hx_set_param(h, "clip_copy", "1 14 1 15");
            HX_ASSERT(dst->steps[3] == 1 && dst->step_note_count[3] == 1 &&
                      dst->step_notes[3][0] == 64 && dst->step_vel[3] == 100,
                      "clip_copy: dst gets src step note");
            HX_ASSERT(dst->length == 11 && dst->active == 1,
                      "clip_copy: dst gets src length + active");
            HX_ASSERT(dst->note_count >= 1, "clip_copy: dst notes[] rebuilt from steps");
            HX_ASSERT(src->steps[3] == 1 && src->active == 1,
                      "clip_copy: SRC unchanged (copy, not cut)");
            /* same-src==dst early-return no-op: content untouched, no crash. */
            hx_set_param(h, "clip_copy", "1 14 1 14");
            HX_ASSERT(src->steps[3] == 1 && src->active == 1,
                      "clip_copy: src==dst is an early-return no-op");
        }

        /* ---- clip_cut "srcT srcC dstT dstC": copy src->dst, then hard-reset
         * src (clip_init). ---- */
        {
            clip_t *src = &inst->tracks[1].clips[12];
            clip_t *dst = &inst->tracks[1].clips[13];
            charz_seed_step(src, 5, 67, 90, 9);
            clip_init(dst);
            hx_set_param(h, "clip_cut", "1 12 1 13");
            HX_ASSERT(dst->steps[5] == 1 && dst->step_notes[5][0] == 67 &&
                      dst->step_vel[5] == 90, "clip_cut: dst gets src content");
            HX_ASSERT(dst->length == 9 && dst->active == 1, "clip_cut: dst gets geometry");
            HX_ASSERT(src->steps[5] == 0 && src->step_note_count[5] == 0 &&
                      src->active == 0, "clip_cut: SRC emptied");
        }

        /* ---- row_copy "srcRow dstRow": copies every track's clip at srcRow to
         * dstRow. Pin two representative melodic tracks (t1, t2); src row intact. ---- */
        {
            charz_seed_step(&inst->tracks[1].clips[10], 2, 60, 100, 8);
            charz_seed_step(&inst->tracks[2].clips[10], 4, 62, 110, 8);
            clip_init(&inst->tracks[1].clips[11]);
            clip_init(&inst->tracks[2].clips[11]);
            hx_set_param(h, "row_copy", "10 11");
            HX_ASSERT(inst->tracks[1].clips[11].steps[2] == 1 &&
                      inst->tracks[1].clips[11].step_notes[2][0] == 60,
                      "row_copy: t1 dst-row clip got src content");
            HX_ASSERT(inst->tracks[2].clips[11].steps[4] == 1 &&
                      inst->tracks[2].clips[11].step_notes[4][0] == 62,
                      "row_copy: t2 dst-row clip got src content");
            HX_ASSERT(inst->tracks[1].clips[10].steps[2] == 1 &&
                      inst->tracks[2].clips[10].steps[4] == 1,
                      "row_copy: src row unchanged (copy)");
        }

        /* ---- row_cut "srcRow dstRow": copy row then hard-reset src row across
         * all tracks. Pin two melodic tracks: dst populated, src emptied. ---- */
        {
            charz_seed_step(&inst->tracks[1].clips[8], 1, 55, 88, 7);
            charz_seed_step(&inst->tracks[2].clips[8], 6, 57, 99, 7);
            clip_init(&inst->tracks[1].clips[9]);
            clip_init(&inst->tracks[2].clips[9]);
            hx_set_param(h, "row_cut", "8 9");
            HX_ASSERT(inst->tracks[1].clips[9].steps[1] == 1 &&
                      inst->tracks[1].clips[9].step_notes[1][0] == 55,
                      "row_cut: t1 dst-row got content");
            HX_ASSERT(inst->tracks[2].clips[9].steps[6] == 1,
                      "row_cut: t2 dst-row got content");
            HX_ASSERT(inst->tracks[1].clips[8].steps[1] == 0 &&
                      inst->tracks[1].clips[8].active == 0, "row_cut: t1 src-row emptied");
            HX_ASSERT(inst->tracks[2].clips[8].steps[6] == 0 &&
                      inst->tracks[2].clips[8].active == 0, "row_cut: t2 src-row emptied");
        }

        /* ---- row_clear "row": clears the scene row across all tracks. ---- */
        {
            charz_seed_step(&inst->tracks[1].clips[6], 0, 50, 100, 8);
            charz_seed_step(&inst->tracks[2].clips[6], 7, 52, 100, 8);
            hx_set_param(h, "row_clear", "6");
            HX_ASSERT(inst->tracks[1].clips[6].steps[0] == 0 &&
                      inst->tracks[1].clips[6].step_note_count[0] == 0 &&
                      inst->tracks[1].clips[6].active == 0, "row_clear: t1 clip emptied");
            HX_ASSERT(inst->tracks[1].clips[6].note_count == 0, "row_clear: t1 notes[] wiped");
            HX_ASSERT(inst->tracks[2].clips[6].steps[7] == 0 &&
                      inst->tracks[2].clips[6].active == 0, "row_clear: t2 clip emptied");
        }

        /* ---- drum_clip_copy "srcT srcC dstT dstC": copy all 32 lanes,
         * preserving dst lane midi_notes. Uses t3's allocated drum_clips. ---- */
        {
            drum_clip_t *ds = inst->tracks[3].drum_clips[14];
            drum_clip_t *dd = inst->tracks[3].drum_clips[15];
            HX_ASSERT(ds && dd, "drum_clip_copy precondition: t3 drum_clips[14,15] allocated");
            clip_t *dsl = &ds->lanes[6].clip;
            clip_init(dsl);
            dsl->steps[2] = 1; dsl->step_note_count[2] = 1;
            dsl->step_notes[2][0] = ds->lanes[6].midi_note; dsl->step_vel[2] = 100;
            dsl->active = 1; clip_migrate_to_notes(dsl);
            uint8_t dd_note6 = dd->lanes[6].midi_note;
            clip_init(&dd->lanes[6].clip);
            hx_set_param(h, "drum_clip_copy", "3 14 3 15");
            clip_t *ddl = &dd->lanes[6].clip;
            HX_ASSERT(ddl->steps[2] == 1 && ddl->step_vel[2] == 100,
                      "drum_clip_copy: dst lane6 gets src content");
            HX_ASSERT(dd->lanes[6].midi_note == dd_note6,
                      "drum_clip_copy: preserves dst lane midi_note");
            HX_ASSERT(dsl->steps[2] == 1, "drum_clip_copy: SRC unchanged (copy)");
        }

        /* ---- drum_clip_cut "srcT srcC dstT dstC": copy all lanes then clear src. ---- */
        {
            drum_clip_t *cs = inst->tracks[3].drum_clips[12];
            drum_clip_t *cd = inst->tracks[3].drum_clips[13];
            HX_ASSERT(cs && cd, "drum_clip_cut precondition: t3 drum_clips[12,13] allocated");
            clip_t *csl = &cs->lanes[8].clip;
            clip_init(csl);
            csl->steps[4] = 1; csl->step_note_count[4] = 1;
            csl->step_notes[4][0] = cs->lanes[8].midi_note; csl->step_vel[4] = 120;
            csl->active = 1; clip_migrate_to_notes(csl);
            clip_init(&cd->lanes[8].clip);
            hx_set_param(h, "drum_clip_cut", "3 12 3 13");
            clip_t *cdl = &cd->lanes[8].clip;
            HX_ASSERT(cdl->steps[4] == 1 && cdl->step_vel[4] == 120,
                      "drum_clip_cut: dst lane8 gets src content");
            HX_ASSERT(csl->steps[4] == 0 && csl->active == 0,
                      "drum_clip_cut: SRC lane8 emptied");
        }

        /* ---- undo_restore / redo_restore MELODIC round-trip. A clip_cut arms an
         * undo snapshot (undo_begin_clip_pair -> both src + dst captured PRE-cut).
         * undo_restore reverts (src content back, dst empty); redo_restore
         * re-applies the cut. Neither broadly resets the instance (unlike
         * state_load) — they touch only the snapshotted clips + last_restore_info.
         * The valid-flag ping-pong (undo<->redo) is pinned each direction. ---- */
        {
            clip_t *src = &inst->tracks[1].clips[4];
            clip_t *dst = &inst->tracks[1].clips[5];
            charz_seed_step(src, 2, 70, 100, 8);
            clip_init(dst);
            hx_set_param(h, "clip_cut", "1 4 1 5");
            HX_ASSERT(dst->steps[2] == 1 && src->steps[2] == 0,
                      "undo setup: post-cut dst has content, src empty");
            HX_ASSERT(inst->undo_valid == 1, "undo setup: clip_cut armed a melodic undo snapshot");

            hx_set_param(h, "undo_restore", "1");
            HX_ASSERT(src->steps[2] == 1 && src->active == 1,
                      "undo_restore: SRC content restored");
            HX_ASSERT(dst->steps[2] == 0 && dst->active == 0,
                      "undo_restore: DST reverted to empty");
            HX_ASSERT(inst->undo_valid == 0 && inst->redo_valid == 1,
                      "undo_restore: flips undo_valid->0, redo_valid->1");
            HX_ASSERT(inst->last_restore_info[0] == 'm',
                      "undo_restore: last_restore_info melodic 'm' marker (JS reads this)");

            hx_set_param(h, "redo_restore", "1");
            HX_ASSERT(dst->steps[2] == 1 && dst->active == 1,
                      "redo_restore: DST re-populated (cut re-applied)");
            HX_ASSERT(src->steps[2] == 0 && src->active == 0,
                      "redo_restore: SRC re-emptied");
            HX_ASSERT(inst->redo_valid == 0 && inst->undo_valid == 1,
                      "redo_restore: flips redo_valid->0, undo_valid->1");
        }

        /* ---- undo_restore / redo_restore DRUM round-trip. drum_clip_copy arms a
         * drum-clip undo snapshot (undo_begin_drum_clip -> DST lanes captured
         * PRE-copy; sets drum_undo_valid=1, undo_valid=0). undo_restore checks
         * drum_undo_valid FIRST, so it takes the drum branch: dst reverts to empty,
         * marker byte becomes 'd'. redo re-applies. (The drum undo covers the DST
         * clip only — the src-clear of a drum_clip_CUT is NOT in the snapshot; this
         * uses drum_clip_COPY so the round-trip is clean.) ---- */
        {
            drum_clip_t *us = inst->tracks[3].drum_clips[10];
            drum_clip_t *ud = inst->tracks[3].drum_clips[11];
            HX_ASSERT(us && ud, "drum undo precondition: t3 drum_clips[10,11] allocated");
            clip_t *usl = &us->lanes[3].clip;
            clip_init(usl);
            usl->steps[1] = 1; usl->step_note_count[1] = 1;
            usl->step_notes[1][0] = us->lanes[3].midi_note; usl->step_vel[1] = 100;
            usl->active = 1; clip_migrate_to_notes(usl);
            clip_init(&ud->lanes[3].clip);
            hx_set_param(h, "drum_clip_copy", "3 10 3 11");
            clip_t *udl = &ud->lanes[3].clip;
            HX_ASSERT(inst->drum_undo_valid == 1, "drum undo setup: drum_clip_copy armed drum undo");
            HX_ASSERT(udl->steps[1] == 1, "drum undo setup: post-copy dst has content");

            hx_set_param(h, "undo_restore", "1");
            HX_ASSERT(udl->steps[1] == 0 && udl->active == 0,
                      "undo_restore (drum): DST reverted to empty");
            HX_ASSERT(inst->drum_undo_valid == 0 && inst->drum_redo_valid == 1,
                      "undo_restore (drum): flips drum undo->redo");
            HX_ASSERT(inst->last_restore_info[0] == 'd',
                      "undo_restore (drum): last_restore_info 'd' marker");

            hx_set_param(h, "redo_restore", "1");
            HX_ASSERT(udl->steps[1] == 1, "redo_restore (drum): DST re-populated");
            HX_ASSERT(inst->drum_redo_valid == 0 && inst->drum_undo_valid == 1,
                      "redo_restore (drum): flips drum redo->undo");
        }

        /* ---- guard: undo_restore with NO valid undo is an early-return no-op.
         * Force both undo flags invalid, drop a sentinel, confirm it survives. ---- */
        {
            inst->undo_valid = 0;
            inst->drum_undo_valid = 0;
            inst->tracks[1].clips[4].steps[0] = 1;   /* sentinel */
            hx_set_param(h, "undo_restore", "1");
            HX_ASSERT(inst->tracks[1].clips[4].steps[0] == 1,
                      "undo_restore: no-op when neither undo valid (guard)");
        }
    }

    /* ---- Globals-TRANSPORT white-box pins (Phase 4B group 13 prep -- THE
     * FINAL group). Runs after the table but INTENTIONALLY BEFORE the
     * globals-STATE block below, for the same reason globals-misc/-edit sit
     * there: these keys mutate inst->playing + all-track playback (restart /
     * play_focus / launch_quant-to-Now), and only the globals-STATE state_load
     * reset runs after -- so nothing downstream is corrupted. Characterizes the
     * runtime / state-machine keys of sp_globals_transport that are NOT plain
     * serialized-token scalars (those are TABLE rows above): transport
     * "play_focus:T:C" + "restart", record_count_in / record_count_in_cancel,
     * active_track, clock_follow_on / clock_send_on, launch_quant. transport
     * "play"/"stop" is already the white-box pin at the top of main() -- not
     * duplicated here.
     *
     * ISOLATION: these mutate global transport + per-track playback, so the
     * block runs on the SHARED `h`/inst but is DELIBERATELY placed right before
     * globals-STATE -- whose state_load pin resets the whole instance -- so
     * these transport/playback mutations are wiped before anything else could
     * observe them (and globals-STATE seeds its own fields, depending on none of
     * these). NB: a fresh hx_create throwaway is NOT usable here -- hx_create
     * holds a single static hx_t (see test_state_roundtrip.c), so a second call
     * aliases the same struct and would strand `h` on a destroyed instance.
     * Distinct magic numbers throughout; pins are order-neutral within the block.
     *
     * clock_follow_on is forced to 0 wherever a transport op is exercised so the
     * ext_transport_* path (the off-device observable: it flips inst->playing +
     * per-track flags synchronously) runs, NOT the follow_request_* host-sync
     * path. OUT OF SCOPE: every op's clock-follow branch (follow_request_start/
     * stop instead of ext_transport_*), record_count_in's follow_request_start(2)
     * lead-in, and clock_follow_on's mid-transport ext flush -- all RT/host-sync
     * observables, not off-device pinnable. ---- */
    {
        inst->clock_follow_on = 0;   /* force the ext_transport (observable) path */

        /* transport "play_focus:T:C": while stopped, ARM the focus track's clip
         * (active_clip=C, queued_clip=-1, will_relaunch=1) then rewrite the LOCAL
         * val to "play" and fall through into the normal play path. The play path
         * (ext_transport_start) consumes will_relaunch -> clip_playing=1,
         * will_relaunch=0. So the end-state observables are: focus track's
         * active_clip==C, queued_clip==-1, clip_playing==1 (proves will_relaunch
         * was armed and consumed by the fall-through), and inst->playing==1
         * (proves the val="play" rewrite reached the play path). */
        {
            inst->playing = 0;                    /* the arm only runs while stopped */
            inst->tracks[3].will_relaunch = 0;
            inst->tracks[3].clip_playing  = 0;
            hx_set_param(h, "transport", "play_focus:3:5");
            HX_ASSERT(inst->tracks[3].active_clip == 5,
                      "play_focus: focus track active_clip armed to C");
            HX_ASSERT(inst->tracks[3].queued_clip == -1,
                      "play_focus: focus track queued_clip cleared");
            HX_ASSERT(inst->tracks[3].clip_playing == 1,
                      "play_focus: will_relaunch armed then consumed by play path (clip_playing=1)");
            HX_ASSERT(inst->playing == 1,
                      "play_focus: val=\"play\" rewrite fell through to play (playing=1)");
        }

        /* transport "restart": atomic stop+play. With clock_follow_on=0 it resets
         * the global playhead (global_tick / tick_accum / master_tick_in_step /
         * arp_master_tick / count_in_ticks all to 0) and sets playing=1. Arm
         * distinctive non-zero positions first, then confirm the reset. */
        {
            inst->global_tick         = 4242;
            inst->tick_accum          = 131;
            inst->master_tick_in_step = 17;
            inst->arp_master_tick     = 909;
            inst->count_in_ticks      = 77;
            hx_set_param(h, "transport", "restart");
            HX_ASSERT(inst->global_tick == 0,         "restart: global_tick reset");
            HX_ASSERT(inst->tick_accum == 0,          "restart: tick_accum reset");
            HX_ASSERT(inst->master_tick_in_step == 0, "restart: master_tick_in_step reset");
            HX_ASSERT(inst->arp_master_tick == 0,     "restart: arp_master_tick reset");
            HX_ASSERT(inst->count_in_ticks == 0,      "restart: count_in_ticks reset");
            HX_ASSERT(inst->playing == 1,             "restart: playing=1");
        }

        /* record_count_in "T": schedules a 1-bar count-in for track T --
         * count_in_track=T and count_in_ticks=4*PPQN (>0). (undo_begin_* +
         * inbound-slot clears also fire; the schedule is the observable.) */
        {
            hx_set_param(h, "record_count_in", "4");
            HX_ASSERT(inst->count_in_track == 4, "record_count_in: count_in_track=T");
            HX_ASSERT(inst->count_in_ticks == 4 * PPQN,
                      "record_count_in: schedules 1 bar (4*PPQN ticks)");
            /* record_count_in_cancel: clears the schedule (count_in_ticks=0). */
            hx_set_param(h, "record_count_in_cancel", "1");
            HX_ASSERT(inst->count_in_ticks == 0,
                      "record_count_in_cancel: count_in_ticks cleared");
        }

        /* active_track: runtime field (NOT serialized), clamped to [0,NUM_TRACKS-1]. */
        {
            hx_set_param(h, "active_track", "5");
            HX_ASSERT(inst->active_track == 5, "active_track: stored");
            hx_set_param(h, "active_track", "99");
            HX_ASSERT(inst->active_track == NUM_TRACKS - 1, "active_track: clamped high");
        }

        /* clock_follow_on: flag both polarities. The same-value write is an
         * early-return no-op (sets state_dirty but does NOT reset the follow
         * bookkeeping); a CHANGED value resets the bookkeeping (ext_tick_pending
         * et al). Pin both: seed ext_tick_pending, confirm a same-value write
         * leaves it intact, then a changed write clears it. */
        {
            inst->clock_follow_on = 1;
            inst->ext_tick_pending = 33;
            hx_set_param(h, "clock_follow_on", "1");   /* same value -> no-op early return */
            HX_ASSERT(inst->clock_follow_on == 1,
                      "clock_follow_on: same-value stays on");
            HX_ASSERT(inst->ext_tick_pending == 33,
                      "clock_follow_on: same-value no-op does NOT reset follow bookkeeping");
            hx_set_param(h, "clock_follow_on", "0");   /* changed -> reset bookkeeping */
            HX_ASSERT(inst->clock_follow_on == 0, "clock_follow_on: toggled off");
            HX_ASSERT(inst->ext_tick_pending == 0,
                      "clock_follow_on: changed value resets follow bookkeeping");
        }

        /* clock_send_on: clock-OUT flag, both polarities (my_atoi != 0). */
        {
            hx_set_param(h, "clock_send_on", "1");
            HX_ASSERT(inst->clock_send_on == 1, "clock_send_on: on");
            hx_set_param(h, "clock_send_on", "0");
            HX_ASSERT(inst->clock_send_on == 0, "clock_send_on: off");
        }

        /* launch_quant: clamped to [0,5]. Switching to Now (0) WHILE PLAYING
         * fires every track's queued clip immediately (active_clip<-queued_clip,
         * queued_clip=-1, clip_playing=1). Pin clamp first (stopped, no fire),
         * then the switch-to-Now fan-out. */
        {
            inst->playing = 0;
            hx_set_param(h, "launch_quant", "3");
            HX_ASSERT(inst->launch_quant == 3, "launch_quant: stored");
            hx_set_param(h, "launch_quant", "99");
            HX_ASSERT(inst->launch_quant == 5, "launch_quant: clamped high");
            /* switch-to-Now-while-playing: launch_quant is 5 (!=0) from the clamp
             * above; arm a queued clip on a melodic track + playing, then set 0. */
            inst->playing = 1;
            inst->tracks[2].queued_clip = 4;
            inst->tracks[2].clip_playing = 0;
            hx_set_param(h, "launch_quant", "0");
            HX_ASSERT(inst->launch_quant == 0, "launch_quant: switched to Now");
            HX_ASSERT(inst->tracks[2].active_clip == 4,
                      "launch_quant Now: queued clip promoted to active");
            HX_ASSERT(inst->tracks[2].queued_clip == -1,
                      "launch_quant Now: queued_clip cleared after fire");
            HX_ASSERT(inst->tracks[2].clip_playing == 1,
                      "launch_quant Now: fired clip is now playing");
        }
    }

    /* ---- Globals-STATE white-box pins (Phase 4B group 10 prep). Runs after
     * the table AND every other white-box block, in file order — it is
     * intentionally LAST because its state_load pin RESETS the whole instance
     * (playing/merge/per-track playback + recording + clips), which would
     * corrupt any assertion that ran afterward. Nothing asserts `inst` after
     * this block, so the reset is collision-safe. This group is I/O-heavy: the
     * 5 keys are debug_log, save, prune_orphan_states, state_path, state_load.
     * seq8_save_state / seq8_load_state use real libc fopen (NOT stubbed), so
     * `save`'s file write IS drivable via a temp path; the on-device /data/...
     * paths that state_load constructs and that prune_orphan_states scans do
     * not exist off-device, so those file operations no-op in-harness and are
     * noted OUT-OF-SCOPE-IN-STUB (the real load round-trip lives in
     * test_state_roundtrip.c). These keys are top-level strcmp(key,...) matches
     * with no track index, so they collide with nothing above. ---- */
    {
        const char *SAVE_TMP = "/tmp/davebox_charz_gstate_save_5731.json";

        /* debug_log: the logging outlier — its ONLY effect is seq8_ilog(inst,val).
         * OUT-OF-SCOPE-IN-STUB: seq8_ilog is a no-op off-device (inst->log_fp is
         * NULL because SEQ8_LOG_PATH's /data dir can't be opened; and it writes
         * to inst->log_fp, not host->log, so the stub capture never sees it).
         * Pin the observable contract: reachable, mutates NO instance state,
         * returns cleanly (reaching the next line proves no crash). */
        {
            uint8_t xp0 = inst->xpose_preview_active, pl0 = inst->playing;
            hx_set_param(h, "debug_log", "SEQ8_CHARZ_DBGLOG_9271");
            HX_ASSERT(inst->xpose_preview_active == xp0 && inst->playing == pl0,
                      "debug_log: pure no-op, mutates no instance state");
        }

        /* state_path: strncpy into inst->state_path[256], NUL-terminated. */
        hx_set_param(h, "state_path", "/tmp/charz_state_path_4471.json");
        HX_ASSERT(!strcmp(inst->state_path, "/tmp/charz_state_path_4471.json"),
                  "state_path: stored path verbatim");

        /* save: (1) ALWAYS clears xpose_preview_active (defensive, both branches);
         * (2) when NOT version-mismatched, seq8_save_state serializes to
         * inst->state_path via real fopen — observable by reading the file back;
         * (3) the version-mismatch guard skips the write but still clears the
         * preview flag. */
        remove(SAVE_TMP);
        strncpy(inst->state_path, SAVE_TMP, sizeof(inst->state_path) - 1);
        inst->state_path[sizeof(inst->state_path) - 1] = '\0';
        inst->state_version_mismatch = 0;
        inst->xpose_preview_active = 1;
        hx_set_param(h, "save", "1");
        HX_ASSERT(inst->xpose_preview_active == 0,
                  "save: always clears xpose_preview_active");
        {
            FILE *rf = fopen(SAVE_TMP, "r");
            HX_ASSERT(rf, "save: wrote state file to inst->state_path");
            char fbuf[4096]; size_t fn = rf ? fread(fbuf, 1, sizeof(fbuf) - 1, rf) : 0;
            if (rf) fclose(rf);
            fbuf[fn] = '\0';
            HX_ASSERT(fn > 0 && strstr(fbuf, "\"v\":36"),
                      "save: serialized v36 blob written to file");
        }
        /* version-mismatch guard: skips the write but still clears preview. */
        remove(SAVE_TMP);
        inst->state_version_mismatch = 1;
        inst->xpose_preview_active = 1;
        hx_set_param(h, "save", "1");
        HX_ASSERT(inst->xpose_preview_active == 0,
                  "save: clears preview even when version-mismatched");
        {
            FILE *rf = fopen(SAVE_TMP, "r");
            HX_ASSERT(!rf, "save: version-mismatch skips the file write");
            if (rf) fclose(rf);
        }
        inst->state_version_mismatch = 0;   /* restore for state_load below */

        /* prune_orphan_states: scans /data/UserData/schwung/set_state and unlinks
         * orphaned seq8-*.json. OUT-OF-SCOPE-IN-STUB: that device dir tree does
         * not exist off-device, so opendir fails and the handler takes its
         * clean early-return branch (opendir fails -> seq8_ilog + return). The
         * log line is not observable (seq8_ilog no-op, see debug_log above), so
         * pin the reachable contract: it mutates NO instance state and returns
         * without crashing (reaching the next line proves no crash). */
        {
            char sp0[256]; strncpy(sp0, inst->state_path, sizeof(sp0));
            hx_set_param(h, "prune_orphan_states", "1");
            HX_ASSERT(!strcmp(inst->state_path, sp0),
                      "prune_orphan_states: opendir-failed branch, returns cleanly + no instance mutation");
        }

        /* state_load: (1) builds inst->state_path from the UUID val (non-empty ->
         * per-set path; empty -> SEQ8_STATE_PATH_FALLBACK); (2) RESETS the whole
         * instance (transport/merge/per-track playback+recording) BEFORE calling
         * seq8_load_state. The conversion MUST preserve that reset. Arm
         * distinctive pre-reset state, then confirm it was cleared.
         * OUT-OF-SCOPE-IN-STUB: seq8_load_state itself no-ops here because the
         * constructed /data/... path does not exist off-device (fopen fails ->
         * silent return); the real load round-trip is pinned in
         * test_state_roundtrip.c. */
        inst->playing              = 1;
        inst->count_in_ticks       = 99;
        inst->merge_state          = 1;   /* any non-IDLE value */
        inst->tracks[0].recording  = 1;
        inst->tracks[0].current_step = 5;
        inst->tracks[0].queued_clip  = 3;
        hx_set_param(h, "state_load", "abcdef01-2345-6789-abcd-ef0123456789");
        HX_ASSERT(!strcmp(inst->state_path,
                  "/data/UserData/schwung/set_state/"
                  "abcdef01-2345-6789-abcd-ef0123456789/seq8-state.json"),
                  "state_load: builds per-set path from UUID val");
        HX_ASSERT(inst->playing == 0, "state_load: resets playing");
        HX_ASSERT(inst->count_in_ticks == 0, "state_load: resets count_in_ticks");
        HX_ASSERT(inst->merge_state == MERGE_STATE_IDLE, "state_load: resets merge_state");
        HX_ASSERT(inst->tracks[0].recording == 0, "state_load: resets per-track recording");
        HX_ASSERT(inst->tracks[0].current_step == 0, "state_load: resets per-track current_step");
        HX_ASSERT(inst->tracks[0].queued_clip == -1, "state_load: resets per-track queued_clip to -1");
        /* empty val -> fallback path. */
        hx_set_param(h, "state_load", "");
        HX_ASSERT(!strcmp(inst->state_path, SEQ8_STATE_PATH_FALLBACK),
                  "state_load: empty val -> SEQ8_STATE_PATH_FALLBACK");

        remove(SAVE_TMP);
    }

    /* Beat Stretch RE-ANCHORS the playhead to the master clock during playback
     * (fix: a mid-play stretch changed cl->length without re-deriving the
     * playhead, drifting the clip out of sync). Melodic t4 (t0 defaults DRUM).
     * After expand (fwd): current_step = loop_start + (elapsed/tps)%len,
     * tick_in_step = elapsed%tps, elapsed = global_tick*TPS + master_tick_in_step. */
    {
        seq8_track_t *bt = &inst->tracks[4];
        bt->active_clip = 0;
        clip_t *bcl = &bt->clips[0];
        bcl->length = 16; bcl->loop_start = 0; bcl->ticks_per_step = (uint16_t)TICKS_PER_STEP;
        bcl->steps[0] = 1; bcl->step_note_count[0] = 1; bcl->step_notes[0][0] = 60;
        inst->playing = 1; inst->global_tick = 10; inst->master_tick_in_step = 5;
        bt->current_step = 3;      /* bogus — the re-anchor must override this */
        bt->tick_in_step = 0;
        hx_set_param(h, "t4_beat_stretch", "1");            /* expand 16 -> 32 */
        HX_ASSERT(bcl->length == 32, "beat-stretch: expand length 16->32");
        {
            uint32_t elapsed = (uint32_t)10 * (uint32_t)TICKS_PER_STEP + 5;   /* 245 */
            uint16_t tps = bcl->ticks_per_step;
            HX_ASSERT(bt->current_step == (uint16_t)(bcl->loop_start + (elapsed / tps) % bcl->length),
                      "beat-stretch: re-anchors current_step to master clock");
            HX_ASSERT(bt->tick_in_step == (uint16_t)(elapsed % tps),
                      "beat-stretch: re-anchors tick_in_step to master clock");
        }
        inst->playing = 0;
    }

    hx_destroy(h);
    printf("PASS: beat_stretch re-anchors playhead to master clock during playback\n");
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
    printf("PASS: live-monitoring white-box pins "
           "(live_notes on/off/default-vel/batch emit + inbound-enabled guard, "
           "live_at poly/channel AT emit + last_poly_at_press, padmap carrier "
           "active_track/dsp_inbound/pad_note_map + trailing flags both polarities)\n");
    printf("PASS: drum-config/all-lanes/repeat white-box pins "
           "(mute_all_clear, lanes_qnt fan-out, active_drum_lane/lane_page/"
           "perform_mode/delete_held, all_lanes_* fan-out transforms "
           "(clip_resolution/playback_dir/audio_reverse/length/clock_shift/nudge/"
           "beat_stretch/loop_set/double_fill), Rpt1 start/vel/lane/latched/stop, "
           "Rpt2 rate/lane_on/vel/lane_latched/latch_held/lane_off/stop, "
           "drum_record_note_on/off capture + both !recording guards)\n");
    printf("PASS: melodic-clip-transform + pfx catch-all white-box pins "
           "(clip_length active-clip clamp + no-rui_touch, playback_dir/"
           "audio_reverse clamps, clock_shift, nudge, beat_stretch, "
           "loop_double_fill, lgto_apply, pfx_set catch-all routing + "
           "pfx_noteFx_reset/pfx_delay_reset)\n");
    printf("PASS: globals-misc white-box pins "
           "(looper arm/stop/retrigger/sync + LOOPING pending-rate, merge "
           "arm/cancel/stop/place_row state machine, bake guard + unroll, "
           "perf_mods, launch_scene/launch_scene_quant, mute_all_clear, "
           "snap save/load/delete round-trip + slot guards)\n");
    printf("PASS: globals-state white-box pins "
           "(debug_log no-op, state_path store, save preview-clear + file "
           "write + version-mismatch guard, prune opendir-failed no-op, "
           "state_load path-build + instance reset + fallback)\n");
    printf("PASS: globals-edit white-box pins "
           "(clip copy/cut, row copy/cut, row_clear, drum-clip copy/cut, "
           "undo/redo melodic + drum round-trips + last_restore_info marker, "
           "no-valid-undo guard)\n");
    printf("PASS: globals-transport white-box pins "
           "(play_focus arm+play-fallthrough, restart playhead reset, "
           "record_count_in schedule/cancel, active_track clamp, clock_follow_on "
           "both polarities + same-value no-op, clock_send_on, launch_quant clamp "
           "+ switch-to-Now queued-clip fire)\n");
    return 0;
}
