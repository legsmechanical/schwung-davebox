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

    /* --- Disarm via the REAL set_param path: the latch must finalize + STOP.
     * (Regression guard for "keeps recording after disarm" — the latch flooding
     * the whole loop because recording never cleared.) --- */
    hx_set_param(h, "t0_recording", "0");
    hx_render(h, 2);                       /* the recording 1->0 finalize edge runs */
    HX_ASSERT(tr->recording == 0, "DSP recording flag should clear on t0_recording=0");
    HX_ASSERT(tr->cc_latched == 0, "CC latch should finalize/clear after disarm");
    uint16_t _after_disarm = ca->count[0];
    hx_render(h, 96);                      /* a full extra loop with record off */
    HX_ASSERT(ca->count[0] == _after_disarm,
              "no automation may be written after disarm (latch must stop)");

    /* Recorded automation should still play back on the track channel. */
    for (int k = 0; k < 8; k++) tr->cc_auto_last_sent[k] = 0xFF;  /* force first emit */
    hx_clear_capture(h);
    hx_render(h, 64);
    HX_ASSERT(seen_cc(tr->channel & 0x0F, 74),
              "recorded CC 74 should play back on a drum track");

    hx_destroy(h);

    /* === Scenario 2: disarm must cancel a PENDING count-in. ===
     * Arming from stopped schedules a 1-bar count-in (count_in_ticks); the render
     * thread fires recording=1 on the count_in_track when it completes
     * (seq8.c:10749). A plain `tN_recording 0` disarm that arrives while the
     * count-in is still pending must ALSO cancel it — otherwise the count-in
     * completes and re-arms recording AFTER the user disarmed (the "keeps
     * recording after disarm" bug; reproduced with a brief arm→disarm). */
    {
        hx_t *h2 = hx_create(NULL);
        HX_ASSERT(h2 != NULL, "hx_create (scenario 2) returned NULL");
        seq8_instance_t *in2 = (seq8_instance_t *)h2->inst;
        seq8_track_t *tr2 = &in2->tracks[0];

        hx_set_param(h2, "t0_l0_clip_length", "16");   /* track 0 -> drum */
        hx_set_param(h2, "bpm", "120");
        /* Arm from stopped: schedules the count-in that will fire recording. */
        hx_set_param(h2, "record_count_in", "0");
        HX_ASSERT(in2->count_in_ticks > 0, "count-in should be pending after record_count_in");

        /* Disarm before the count-in completes. */
        hx_set_param(h2, "t0_recording", "0");
        HX_ASSERT(in2->count_in_ticks == 0,
                  "disarm must cancel the pending count-in (else recording re-fires)");

        /* Render well past where the count-in would have completed; recording must stay off. */
        hx_render(h2, 800);
        HX_ASSERT(tr2->recording == 0,
                  "recording must stay off after disarm — count-in must not re-fire it");
        hx_destroy(h2);
    }

    printf("PASS: drum CC automation records + plays back; disarm cancels pending count-in\n");
    return 0;
}
