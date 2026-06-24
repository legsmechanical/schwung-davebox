/* tests/test_drum_cc_automation.c — CC automation must record + play back on a
 * DRUM track, identically to melodic. Automation is track-level (emits CC on the
 * track's channel/route), NOT drum-lane-aware. White-box harness (#includes
 * seq8.c, so the instance struct + cc_auto_t + statics are visible). */
#include "harness.h"

/* any recorded breakpoints for knob k in this clip's CC automation */
static int cc_lane_has_points(cc_auto_t *ca, int k) { return ca->count[k] > 0; }

/* any captured CC (status 0xBn, d1==num) on channel ch (scans all capture kinds) */
static int seen_cc(int ch, int num) {
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if ((e->bytes[1] & 0xF0) == 0xB0 && (e->bytes[1] & 0x0F) == ch
            && e->bytes[2] == (uint8_t)num)
            return 1;
    }
    return 0;
}

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[0];

    /* Make track 0 a drum track: first tN_lL_* lane write allocates drum clips
     * + sets pad_mode=DRUM (dsp/CLAUDE.md "Drum clip allocation"). */
    hx_set_param(h, "t0_l0_clip_length", "16");
    HX_ASSERT(tr->pad_mode == PAD_MODE_DRUM, "track 0 should be drum after lane write");
    HX_ASSERT(tr->drum_clips[tr->active_clip] != NULL, "drum clip should be allocated");

    /* Assign knob 0 -> CC 74 (type 0 = plain CC). */
    hx_set_param(h, "t0_cc_type_assign", "0 0 74");

    /* Start transport + clip + arm record (white-box: avoids count-in/launch-quant). */
    inst->playing    = 1;
    tr->clip_playing = 1;
    tr->recording    = 1;

    /* Knob 0 -> value 100 while recording: latches the lane for write-along-playhead. */
    hx_set_param(h, "t0_cc_send", "0 100");

    /* Advance the master clock so the latch-record writes points. */
    hx_render(h, 64);

    cc_auto_t *ca = &tr->clip_cc_auto[tr->active_clip];
    if (!cc_lane_has_points(ca, 0)) {
        fprintf(stderr, "--- DSP log ---\n%s\n", hx_stub_log_text());
        fprintf(stderr, "global_tick=%u count[0]=%u cc_latched=%u recording=%u\n",
                (unsigned)inst->global_tick, (unsigned)ca->count[0],
                (unsigned)tr->cc_latched, (unsigned)tr->recording);
    }
    HX_ASSERT(cc_lane_has_points(ca, 0),
              "knob-0 CC lane should record points on a drum track");

    /* Stop recording; recorded automation should play back the CC on the track channel. */
    tr->recording  = 0;
    tr->cc_latched = 0;
    for (int k = 0; k < 8; k++) tr->cc_auto_last_sent[k] = 0xFF;  /* force first emit */
    hx_clear_capture(h);
    hx_render(h, 64);
    HX_ASSERT(seen_cc(tr->channel & 0x0F, 74),
              "recorded CC 74 should play back on a drum track");

    hx_destroy(h);
    printf("PASS: drum CC automation records + plays back\n");
    return 0;
}
