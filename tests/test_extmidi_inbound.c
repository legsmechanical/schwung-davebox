/* tests/test_extmidi_inbound.c — external cable-2 MIDI inbound under the
 * Phase-1 handshake (dsp_inbound_enabled). Drives on_midi(source==
 * MOVE_MIDI_SOURCE_EXTERNAL) directly, mirroring the Schwung shim's ROUTE_MOVE
 * cable-2 echo delivery (schwung_shim.c:1305-1307, which passes
 * MOVE_MIDI_SOURCE_EXTERNAL = 2 per host/plugin_api_v1.h — verified in the
 * host source; an earlier map claim of "source==1" was wrong, taken from a
 * stale davebox scaffold comment).
 *
 * Ext semantics under test: any NON-INTERNAL 3-byte note event is treated as
 * external (robust to source-constant drift between host versions); internal
 * (source==0) keeps the pad path.
 *
 * STAGED RED: the repo's characterization suite passes by definition and must
 * stay green every commit (tests/run.sh gate). This file's cases are gated
 * behind EXT_INC (highest implemented increment). The in-file default is
 * bumped as each increment lands GREEN, so the committed suite is always
 * green; RED evidence for an increment is captured by compiling with a higher
 * -DEXT_INC before the implementation exists (see the increment's commit msg).
 *
 *   EXT_INC 0  case 10 only (stock fallback; passes on baseline)      — always
 *   EXT_INC 1  cases 2-9 + unexpected-source (Path A on_midi ext branch
 *              incl. seq-echo gate)
 *   EXT_INC 2  cases 11-14 (Path B ext-origin tokens: eon/eoff live +
 *              e-marked record; pad single-fire + stamped-timing pins)
 */
#include "harness.h"

#ifndef EXT_INC
#define EXT_INC 0   /* highest implemented increment; bumped per increment */
#endif

/* Per-note ext marker on record payloads: introduced with the Path B
 * origin-tag increment (EXT_INC 2), when JS starts tagging ext-origin pushes.
 * At the Path A stage JS still sends plain payloads (slot-consume identical). */
#if EXT_INC >= 2
#define EXTM "e"
#else
#define EXTM ""
#endif

/* External cable-2 note helpers (the shim's ext echo source constant). */
static void ext_on(hx_t *h, int ch, int pitch, int vel) {
    uint8_t m[3] = { (uint8_t)(0x90 | (ch & 0x0F)), (uint8_t)pitch, (uint8_t)vel };
    hx_send_midi(h, m, 3, MOVE_MIDI_SOURCE_EXTERNAL);
}
static void ext_off(hx_t *h, int ch, int pitch) {
    uint8_t m[3] = { (uint8_t)(0x80 | (ch & 0x0F)), (uint8_t)pitch, 0 };
    hx_send_midi(h, m, 3, MOVE_MIDI_SOURCE_EXTERNAL);
}
/* Internal pad note (pad index p → note 68+p), the Move-pads path. */
static void pad_on(hx_t *h, int padIdx, int vel) {
    uint8_t m[3] = { 0x90, (uint8_t)(68 + padIdx), (uint8_t)vel };
    hx_send_midi(h, m, 3, MOVE_MIDI_SOURCE_INTERNAL);
}

/* 32-entry chromatic padmap; arms active_track + dsp_inbound_enabled for track t.
 * (Ext notes use d1 directly, not the map — the map only carries the handshake.) */
#define MAP32 \
    "60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 " \
    "76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91"

/* Find an active note of the given pitch in a melodic clip; NULL if none. */
static note_t *find_note(clip_t *cl, uint8_t pitch) {
    for (uint16_t i = 0; i < cl->note_count; i++)
        if (cl->notes[i].active && cl->notes[i].pitch == pitch) return &cl->notes[i];
    return NULL;
}

/* Count captured note-ons for a pitch across all kinds. */
static int count_note_ons(int pitch) {
    int n = 0;
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if ((e->bytes[1] & 0xF0) == 0x90 && e->bytes[2] == (uint8_t)pitch && e->bytes[3] > 0)
            n++;
    }
    return n;
}

/* ---- Case 10: stock-Schwung fallback unchanged (always on) --------------- */
static void case10_stock_fallback(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "c10 create");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    /* dsp_inbound_enabled defaults 0 (no padmap pushed). */
    HX_ASSERT(inst->dsp_inbound_enabled == 0, "c10 inbound should default off");

    /* Ext note with inbound OFF is a no-op in on_midi: no slot, no emit. */
    hx_clear_capture(h);
    ext_on(h, 1, 64, 100);
    HX_ASSERT(inst->on_midi_press_active[1][64] == 0, "c10 ext must not stamp when inbound off");
    HX_ASSERT(hx_stub_event_count() == 0, "c10 ext must not emit when inbound off");

    /* The JS fallback path (tN_live_notes) still works when inbound is off. */
    hx_clear_capture(h);
    hx_set_param(h, "t1_live_notes", "on 64 100");
    HX_ASSERT(hx_seen_note_on(h, 1, 64), "c10 JS live_notes fallback must emit when inbound off");

    hx_destroy(h);
    printf("PASS: extmidi case10 (stock fallback unchanged)\n");
}

#if EXT_INC >= 1
/* Arm a melodic ROUTE_MOVE track t (defaults: t1..t3 melodic ch=t route=MOVE). */
static seq8_track_t *arm_melodic(hx_t *h, int t) {
    char key[16]; snprintf(key, sizeof(key), "t%d_padmap", t);
    hx_set_param(h, key, MAP32);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    HX_ASSERT(inst->active_track == t, "arm: active_track");
    HX_ASSERT(inst->dsp_inbound_enabled == 1, "arm: inbound enabled");
    seq8_track_t *tr = &inst->tracks[t];
    HX_ASSERT(tr->pfx.route == ROUTE_MOVE, "arm: expected ROUTE_MOVE default");
    HX_ASSERT(tr->pad_mode != PAD_MODE_DRUM, "arm: expected melodic");
    return tr;
}

/* Case 2: channel filter IN → press slot stamped at current_clip_tick. */
static void case2_channel_in(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = arm_melodic(h, 1);    /* channel 1 */
    tr->recording = 1;
    tr->current_clip_tick = 96;
    ext_on(h, 1, 64, 100);                    /* ch1 == tr->channel */
    HX_ASSERT(inst->on_midi_press_active[1][64] == 1, "c2 press slot not stamped");
    HX_ASSERT(inst->on_midi_press_tick[1][64] == 96, "c2 press tick wrong");
    hx_destroy(h);
    printf("PASS: extmidi case2 (channel filter IN)\n");
}

/* Case 3: channel filter OUT → no slot. */
static void case3_channel_out(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = arm_melodic(h, 1);    /* channel 1 */
    tr->recording = 1;
    tr->current_clip_tick = 96;
    ext_on(h, 2, 65, 100);                    /* ch2 != tr->channel(1) */
    HX_ASSERT(inst->on_midi_press_active[1][65] == 0, "c3 foreign-channel note must not stamp");
    hx_destroy(h);
    printf("PASS: extmidi case3 (channel filter OUT)\n");
}

/* Case 4: record with audio-thread timing — note lands at the STAMPED press
 * tick (not the late handler current_clip_tick), gate from the stamped release.
 * The JS push for an ext note carries the per-note ext marker ("e64 100"). */
static void case4_record_timing(void) {
    hx_t *h = hx_create(NULL);
    seq8_track_t *tr = arm_melodic(h, 1);
    tr->recording = 1;

    tr->current_clip_tick = 96;
    ext_on(h, 1, 64, 100);                    /* press slot = 96 */
    tr->current_clip_tick = 200;              /* simulate late handler arrival */
    hx_set_param(h, "t1_record_note_on", EXTM "64 100");

    note_t *n = find_note(&tr->clips[tr->active_clip], 64);
    HX_ASSERT(n != NULL, "c4 note not recorded");
    HX_ASSERT(n->tick == 96, "c4 note landed at late tick, not stamped press tick");

    tr->current_clip_tick = 120;
    ext_off(h, 1, 64);                        /* release slot = 120 */
    tr->current_clip_tick = 300;              /* late */
    hx_set_param(h, "t1_record_note_off", EXTM "64");
    n = find_note(&tr->clips[tr->active_clip], 64);
    HX_ASSERT(n != NULL, "c4 note vanished after off");
    HX_ASSERT(n->gate == 24, "c4 gate not from stamped ticks (120-96)");
    hx_destroy(h);
    printf("PASS: extmidi case4 (record timing)\n");
}

/* Case 5: live monitor on ROUTE_MOVE — the ext branch must NOT emit (Move plays
 * natively); guards against the double-play regression. */
static void case5_no_double_play(void) {
    hx_t *h = hx_create(NULL);
    seq8_track_t *tr = arm_melodic(h, 1);
    tr->recording = 1;
    hx_clear_capture(h);
    ext_on(h, 1, 64, 100);
    hx_render(h, 4);
    HX_ASSERT(hx_stub_event_count() == 0, "c5 ext branch must not emit on ROUTE_MOVE (double-play)");
    ext_off(h, 1, 64);
    hx_render(h, 4);
    HX_ASSERT(hx_stub_event_count() == 0, "c5 ext branch must not emit note-off on ROUTE_MOVE");
    hx_destroy(h);
    printf("PASS: extmidi case5 (no double-play)\n");
}

/* Case 6: drum lane press slot + record. Uses t0 (drum, ch0, ROUTE_MOVE). */
static void case6_drum_lane(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[0];
    HX_ASSERT(tr->pad_mode == PAD_MODE_DRUM, "c6 t0 expected drum");
    HX_ASSERT(tr->drum_clips[tr->active_clip], "c6 drum clips allocated");
    hx_set_param(h, "t0_padmap", MAP32);      /* arm active=0, inbound */
    HX_ASSERT(tr->pfx.route == ROUTE_MOVE, "c6 t0 route MOVE");

    int lane = 0;
    uint8_t dn = tr->drum_clips[tr->active_clip]->lanes[lane].midi_note;
    HX_ASSERT(dn != 0xFF, "c6 lane 0 note unmapped");
    tr->recording = 1;
    tr->drum_current_step[lane]  = 3;
    tr->drum_tick_in_step[lane]  = 0;

    ext_on(h, 0, dn, 110);
    HX_ASSERT(inst->on_midi_drum_press_active[0][lane] == 1, "c6 drum press slot not stamped");
    HX_ASSERT(inst->on_midi_drum_press_step[0][lane] == 3, "c6 drum press step wrong");

    /* The JS drum record push (ext-marked) consumes the stamped slot → step 3. */
    char dn_s[12]; snprintf(dn_s, sizeof(dn_s), EXTM "%d 110", (int)dn);
    hx_set_param(h, "t0_drum_record_note_on", dn_s);
    drum_clip_t *dc = tr->drum_clips[tr->active_clip];
    HX_ASSERT(dc->lanes[lane].clip.step_note_count[3] > 0, "c6 drum hit not recorded at stamped step");
    hx_destroy(h);
    printf("PASS: extmidi case6 (drum lane press slot + record)\n");
}

/* Case 7: preroll/count-in window. Outside the last-1/8 → no stamp; inside →
 * stamp at loop_start tick. */
static void case7_preroll(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = arm_melodic(h, 1);
    tr->recording = 0;
    inst->count_in_track = 1;

    /* Outside window: > PPQN/2 remaining → warm-up, not recorded. */
    inst->count_in_ticks = PPQN;              /* 96 > 48 */
    ext_on(h, 1, 64, 100);
    HX_ASSERT(inst->on_midi_press_active[1][64] == 0, "c7 press outside window must not stamp");
    ext_off(h, 1, 64);

    /* Inside window: <= PPQN/2 → stamp at loop_start*tps (=0). */
    inst->count_in_ticks = PPQN / 2;          /* 48 <= 48 */
    ext_on(h, 1, 65, 100);
    HX_ASSERT(inst->on_midi_press_active[1][65] == 1, "c7 press inside window must stamp");
    HX_ASSERT(inst->on_midi_press_tick[1][65] == 0, "c7 preroll tick must be loop_start");
    hx_destroy(h);
    printf("PASS: extmidi case7 (preroll window)\n");
}

/* Case 8: seq-echo suppression. A sequencer-emitted pitch (in play_pending)
 * fed back via the cable-2 echo must NOT be recorded; a non-echo pitch must. */
static void case8_seq_echo(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = arm_melodic(h, 1);
    tr->recording = 1;
    tr->current_clip_tick = 96;

    /* Simulate the sequencer currently sounding pitch 64 (its own Move echo). */
    tr->play_pending[0].pitch = 64;
    tr->play_pending[0].lane_idx = 0xFF;
    tr->play_pending_count = 1;
    ext_on(h, 1, 64, 100);
    HX_ASSERT(inst->on_midi_press_active[1][64] == 0, "c8 seq echo must not stamp record slot");

    /* A pitch the sequencer is NOT emitting is a real keyboard note → record. */
    ext_on(h, 1, 67, 100);
    HX_ASSERT(inst->on_midi_press_active[1][67] == 1, "c8 non-echo note must stamp");
    hx_destroy(h);
    printf("PASS: extmidi case8 (seq-echo suppression)\n");
}

/* Case 9: cross-track note-off. Press on track A; switch active to B; the
 * note-off (arriving on B's channel per the remap) must release on A's slot. */
static void case9_cross_track(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *ta = arm_melodic(h, 1);     /* A = track1, ch1 */
    ta->recording = 1;
    ta->current_clip_tick = 96;
    ext_on(h, 1, 64, 100);
    HX_ASSERT(inst->on_midi_press_active[1][64] == 1, "c9 press slot on A");

    /* Switch active track to B = track2 (ch2). */
    hx_set_param(h, "t2_padmap", MAP32);
    HX_ASSERT(inst->active_track == 2, "c9 active now B");
    seq8_track_t *tb = &inst->tracks[2];
    tb->recording = 1;
    tb->current_clip_tick = 200;

    /* Note-off arrives remapped to B's channel (2), but resolves to press track A. */
    ext_off(h, 2, 64);
    HX_ASSERT(inst->on_midi_release_active[1][64] == 1, "c9 release must land on press track A");
    HX_ASSERT(inst->on_midi_release_active[2][64] == 0, "c9 release must NOT land on active track B");
    hx_destroy(h);
    printf("PASS: extmidi case9 (cross-track note-off)\n");
}

/* Unexpected-source case: a 3-byte note with a source value we don't gate on
 * explicitly (e.g. MOVE_MIDI_SOURCE_HOST = 3, or a future constant) is treated
 * as EXTERNAL — the ext branch keys on "not internal", so behavior is robust
 * to source-constant drift between host versions. Documented semantics: any
 * non-internal 3-byte note event = ext. (Safe: the inbound/route/channel
 * filters still apply, and the ext branch never emits on its own.) */
static void case_src_unexpected(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = arm_melodic(h, 1);
    tr->recording = 1;
    tr->current_clip_tick = 96;
    uint8_t m[3] = { 0x90 | 1, 66, 100 };
    hx_send_midi(h, m, 3, MOVE_MIDI_SOURCE_HOST);   /* 3: not internal, not the ext constant */
    HX_ASSERT(inst->on_midi_press_active[1][66] == 1,
              "srcX unexpected non-internal source must be treated as ext (stamp)");
    hx_destroy(h);
    printf("PASS: extmidi case srcX (unexpected source treated as ext)\n");
}
#endif /* EXT_INC >= 1 */

#if EXT_INC >= 2
/* Case 11: Path B (non-ROUTE_MOVE) via ext-origin tokens. Non-Move ext notes
 * never reach on_midi (shim BLOCK); JS is the only handler and tags its
 * payloads: tN_live_notes "eon p v"/"eoff p", record payloads "e<p> [v]".
 * Plain (pad-origin) tokens stay suppressed under inbound. */
static void case11_path_b_ext_tokens(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    /* Track 4 defaults ROUTE_SCHWUNG, melodic, channel 4. */
    seq8_track_t *tr = &inst->tracks[4];
    hx_set_param(h, "t4_padmap", MAP32);       /* arms inbound + active=4 */
    HX_ASSERT(tr->pfx.route == ROUTE_SCHWUNG, "c11 t4 expected ROUTE_SCHWUNG");
    HX_ASSERT(inst->dsp_inbound_enabled == 1, "c11 inbound enabled");

    /* eon/eoff: always processed (any route), even under inbound. */
    hx_clear_capture(h);
    hx_set_param(h, "t4_live_notes", "eon 64 100");
    HX_ASSERT(hx_seen_note_on(h, 4, 64),
              "c11 eon must emit on ROUTE_SCHWUNG under inbound");
    hx_clear_capture(h);
    hx_set_param(h, "t4_live_notes", "eoff 64");
    HX_ASSERT(hx_count_midi(h, HX_MIDI_INTERNAL) > 0,
              "c11 eoff must emit note-off on ROUTE_SCHWUNG under inbound");

    /* Plain tokens (pad-origin JS fallback) stay suppressed under inbound. */
    hx_clear_capture(h);
    hx_set_param(h, "t4_live_notes", "on 80 90");
    HX_ASSERT(hx_stub_event_count() == 0,
              "c11 plain on must stay suppressed under inbound");

    /* eon on ROUTE_EXTERNAL: emits via midi_send_external. */
    hx_set_param(h, "t4_route", "external");
    hx_clear_capture(h);
    hx_set_param(h, "t4_live_notes", "eon 66 100");
    HX_ASSERT(hx_count_midi(h, HX_MIDI_EXTERNAL) > 0,
              "c11 eon must emit on ROUTE_EXTERNAL under inbound");
    hx_set_param(h, "t4_live_notes", "eoff 66");
    hx_set_param(h, "t4_route", "schwung");

    /* Record: ext-marked note with NO slot (never reached on_midi) uses the
     * fallback tick; the off closes the gate from the fallback too. */
    tr->recording = 1;
    tr->current_clip_tick = 48;
    hx_set_param(h, "t4_record_note_on", "e72 100");
    note_t *n = find_note(&tr->clips[tr->active_clip], 72);
    HX_ASSERT(n != NULL, "c11 ext record must land under inbound (no-slot fallback)");
    HX_ASSERT(n->tick == 48, "c11 ext record tick should be fallback current_clip_tick");
    tr->current_clip_tick = 90;
    hx_set_param(h, "t4_record_note_off", "e72");
    n = find_note(&tr->clips[tr->active_clip], 72);
    HX_ASSERT(n && n->gate == 42, "c11 ext record off must close gate from fallback (90-48)");
    hx_destroy(h);

    /* Drum Path B: ROUTE_SCHWUNG drum track records an ext-marked hit at the
     * live playhead (fallback — no slot). */
    hx_t *h2 = hx_create(NULL);
    seq8_instance_t *inst2 = (seq8_instance_t *)h2->inst;
    seq8_track_t *dt = &inst2->tracks[0];
    HX_ASSERT(dt->pad_mode == PAD_MODE_DRUM, "c11 t0 expected drum");
    hx_set_param(h2, "t0_route", "schwung");
    hx_set_param(h2, "t0_padmap", MAP32);       /* arms inbound */
    dt->recording = 1;
    dt->drum_current_step[0] = 2;
    dt->drum_tick_in_step[0] = 0;
    uint8_t dn = dt->drum_clips[dt->active_clip]->lanes[0].midi_note;
    char s[12]; snprintf(s, sizeof(s), "e%d 100", (int)dn);
    hx_set_param(h2, "t0_drum_record_note_on", s);
    HX_ASSERT(dt->drum_clips[dt->active_clip]->lanes[0].clip.step_note_count[2] > 0,
              "c11 ext drum record must land under inbound (no-slot fallback)");
    hx_destroy(h2);
    printf("PASS: extmidi case11 (Path B ext tokens: live SCHWUNG+EXTERNAL, record melodic+drum)\n");
}

/* Case 12: pad SINGLE-FIRE on a non-Move track under inbound (regression pin
 * against the discarded route-aware carve-out, which double-fired: on_midi
 * dispatched the pad AND the plain tN_live_notes fallback dispatched again,
 * also corrupting tarp_physical). Plain tokens must stay suppressed whenever
 * inbound is on, on EVERY route. */
static void case12_pad_single_fire_nonmove(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[4];
    HX_ASSERT(tr->pad_mode != PAD_MODE_DRUM, "c12 t4 expected melodic");
    HX_ASSERT(tr->pfx.route == ROUTE_SCHWUNG, "c12 t4 expected ROUTE_SCHWUNG");
    hx_set_param(h, "t4_padmap", MAP32);

    hx_clear_capture(h);
    pad_on(h, 0, 100);                     /* on_midi dispatches pitch 60 */
    /* JS also queues the plain fallback for the same press; under inbound it
     * must be a no-op — exactly one sounding note-on. */
    hx_set_param(h, "t4_live_notes", "on 60 100");
    HX_ASSERT(count_note_ons(60) == 1,
              "c12 pad on non-Move under inbound must fire exactly once");
    hx_destroy(h);
    printf("PASS: extmidi case12 (pad single-fire on non-Move under inbound)\n");
}

/* Case 13: pad recording on a non-Move track keeps the audio-thread stamped
 * tick (regression pin: the discarded route-aware fallback DISCARDED the
 * on_midi stamp for non-Move pad recording). Uniform rule: plain note under
 * inbound requires + consumes the slot. */
static void case13_pad_record_stamp_nonmove(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[4];
    hx_set_param(h, "t4_padmap", MAP32);
    tr->recording = 1;
    tr->current_clip_tick = 96;
    pad_on(h, 0, 100);                     /* stamps press slot [4][60] @96 */
    HX_ASSERT(inst->on_midi_press_active[4][60] == 1, "c13 pad press slot stamped");
    tr->current_clip_tick = 200;           /* late handler arrival */
    hx_set_param(h, "t4_record_note_on", "60 100");
    note_t *n = find_note(&tr->clips[tr->active_clip], 60);
    HX_ASSERT(n != NULL, "c13 pad record must land");
    HX_ASSERT(n->tick == 96, "c13 pad record must use the STAMPED tick, not fallback");
    hx_destroy(h);
    printf("PASS: extmidi case13 (non-Move pad record keeps stamped timing)\n");
}

/* Case 14: mixed pad+ext record batch — per-note ext marker, not per-batch.
 * "60 100 e72 90": plain 60 consumes its stamped slot; ext 72 (no slot) uses
 * the fallback tick. Both land. */
static void case14_mixed_batch(void) {
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[4];
    hx_set_param(h, "t4_padmap", MAP32);
    tr->recording = 1;
    tr->current_clip_tick = 96;
    pad_on(h, 0, 100);                     /* stamps [4][60] @96 */
    tr->current_clip_tick = 200;
    hx_set_param(h, "t4_record_note_on", "60 100 e72 90");
    note_t *n60 = find_note(&tr->clips[tr->active_clip], 60);
    note_t *n72 = find_note(&tr->clips[tr->active_clip], 72);
    HX_ASSERT(n60 != NULL, "c14 pad note must land");
    HX_ASSERT(n60->tick == 96, "c14 pad note at stamped tick");
    HX_ASSERT(n72 != NULL, "c14 ext note must land");
    HX_ASSERT(n72->tick == 200, "c14 ext note at fallback tick");
    hx_destroy(h);
    printf("PASS: extmidi case14 (mixed pad+ext record batch)\n");
}
#endif /* EXT_INC >= 2 */

int main(void) {
    case10_stock_fallback();
#if EXT_INC >= 1
    case2_channel_in();
    case3_channel_out();
    case4_record_timing();
    case5_no_double_play();
    case6_drum_lane();
    case7_preroll();
    case8_seq_echo();
    case9_cross_track();
    case_src_unexpected();
#endif
#if EXT_INC >= 2
    case11_path_b_ext_tokens();
    case12_pad_single_fire_nonmove();
    case13_pad_record_stamp_nonmove();
    case14_mixed_batch();
#endif
    printf("PASS: test_extmidi_inbound (EXT_INC=%d)\n", EXT_INC);
    return 0;
}
