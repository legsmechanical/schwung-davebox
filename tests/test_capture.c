/* test_capture.c — retrospective Capture (Move-style Capture MIDI).
 *
 * NOTE: track 0 defaults to DRUM mode in a fresh instance — melodic
 * scenarios use track 1.
 *
 * Covers:
 *  1. Stopped capture (melodic): 4 quarter notes played on a stopped
 *     transport → commit estimates ~120 BPM, writes a 16-step clip with 4
 *     notes at ~quarter spacing, arms the clip and starts the transport.
 *  2. Playing overdub: notes played while the transport runs land in the
 *     focused clip at their heard positions; clip length unchanged.
 *  3. Transport edges clear the ring (Move parity).
 *  4. CC-bank knob turns are captured and committed as cc_auto points.
 *  5. Armed input is NOT captured (record path owns it).
 *  6. Stopped capture (drum): pad hits land in the matching drum lane.
 */
#include "harness.h"

static seq8_instance_t *I(hx_t *h) { return (seq8_instance_t *)h->inst; }

/* Play pitch for hold_blocks, with gap_blocks of silence after release. */
static void tap(hx_t *h, int track, int pitch, int vel,
                int hold_blocks, int gap_blocks) {
    seq8_instance_t *inst = I(h);
    live_note_on(inst, &inst->tracks[track], (uint8_t)pitch, (uint8_t)vel);
    hx_render(h, hold_blocks);
    live_note_off(inst, &inst->tracks[track], (uint8_t)pitch);
    hx_render(h, gap_blocks);
}

int main(void) {
    /* ---- 1. Stopped capture with tempo estimate (melodic, track 1) ---- */
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = I(h);
    HX_ASSERT(!inst->playing, "expected stopped transport");
    HX_ASSERT(inst->tracks[1].pad_mode != PAD_MODE_DRUM, "track 1 melodic");

    /* 4 quarter notes at ~120 BPM: onset every 172 blocks (22016 frames). */
    hx_render(h, 4); /* settle */
    tap(h, 1, 60, 100, 40, 132);
    tap(h, 1, 62, 100, 40, 132);
    tap(h, 1, 64, 100, 40, 132);
    tap(h, 1, 65, 100, 40, 132);

    HX_ASSERT(capture_pending_for_track(inst, 1) == 4, "4 pending note-ons");
    hx_set_param(h, "t1_capture_commit", "0");

    clip_t *cl = &inst->tracks[1].clips[0];
    HX_ASSERT(cl->note_count == 4, "4 notes committed");
    HX_ASSERT(cl->length == 16, "1-bar clip length");
    HX_ASSERT(inst->playing == 1, "transport started after stopped commit");
    HX_ASSERT(inst->tracks[1].clip_playing == 1, "committed clip armed+playing");
    HX_ASSERT(inst->cap_last_was_stopped == 1, "stopped path taken");
    {
        double bpm = inst->cap_bpm_est[0];
        HX_ASSERT(bpm > 117.0 && bpm < 123.0, "BPM estimate near 120");
        HX_ASSERT(inst->tracks[1].pfx.cached_bpm == bpm, "tempo applied");
    }
    /* First note at clip start; later onsets near 96-tick (quarter) spacing. */
    HX_ASSERT(cl->notes[0].tick <= 2, "first note aligns to clip start");
    {
        int i, prev = -96;
        for (i = 0; i < 4; i++) {
            int d = (int)cl->notes[i].tick - prev;
            HX_ASSERT(d > 90 && d < 102, "quarter-note spacing preserved");
            prev = (int)cl->notes[i].tick;
        }
    }
    HX_ASSERT(inst->cap_count == 0, "ring consumed by commit");
    /* Commit consumed everything — a second commit is a no-op. */
    {
        uint32_t seq = inst->cap_commit_seq;
        hx_set_param(h, "t1_capture_commit", "0");
        HX_ASSERT(inst->cap_commit_seq == seq, "empty ring: commit no-op");
    }
    hx_destroy(h);

    /* ---- 2. Playing overdub at heard position, length unchanged ---- */
    h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    inst = I(h);
    hx_set_param(h, "transport", "play");
    HX_ASSERT(inst->playing == 1, "transport running");
    hx_render(h, 100);
    /* Track 1's clip isn't launched (clip_playing=0), so commit maps the
     * note via abs-master-tick mod the clip window — the transport-aligned
     * position the user heard. */
    uint32_t abs_at_press = inst->global_tick * TICKS_PER_STEP
                          + inst->master_tick_in_step;
    uint32_t tick_at_play = abs_at_press
        % ((uint32_t)inst->tracks[1].clips[0].length
           * inst->tracks[1].clips[0].ticks_per_step);
    live_note_on(inst, &inst->tracks[1], 61, 90);
    hx_render(h, 10);
    live_note_off(inst, &inst->tracks[1], 61);
    HX_ASSERT(capture_pending_for_track(inst, 1) == 1, "1 pending while playing");
    uint16_t len_before = inst->tracks[1].clips[0].length;
    hx_set_param(h, "t1_capture_commit", "0");
    cl = &inst->tracks[1].clips[0];
    HX_ASSERT(cl->note_count == 1, "overdub wrote 1 note");
    HX_ASSERT(cl->length == len_before, "overdub keeps clip length");
    {
        int d = (int)cl->notes[0].tick - (int)tick_at_play;
        if (d < 0) d = -d;
        HX_ASSERT(d < 24, "note lands near the tick it was played at");
    }
    HX_ASSERT(inst->playing == 1, "playing commit leaves transport running");

    /* ---- 3. Transport edges clear the ring ---- */
    live_note_on(inst, &inst->tracks[1], 63, 90);
    live_note_off(inst, &inst->tracks[1], 63);
    HX_ASSERT(capture_pending_for_track(inst, 1) == 1, "buffered");
    hx_set_param(h, "transport", "stop");
    HX_ASSERT(inst->cap_count == 0, "stop cleared capture ring");
    hx_destroy(h);

    /* ---- 4. CC knob capture (stopped) ---- */
    h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    inst = I(h);
    hx_render(h, 4);
    tap(h, 1, 60, 100, 40, 132);   /* a note so the take has a start + span */
    hx_set_param(h, "t1_cc_send", "2 30");
    hx_render(h, 86);
    hx_set_param(h, "t1_cc_send", "2 90");
    hx_render(h, 86);
    tap(h, 1, 64, 100, 40, 132);
    hx_set_param(h, "t1_capture_commit", "0");
    HX_ASSERT(inst->tracks[1].clip_cc_auto[0].count[2] == 2,
              "2 automation points on knob 2");
    HX_ASSERT(inst->tracks[1].clip_cc_auto[0].vals[2][0] == 30 &&
              inst->tracks[1].clip_cc_auto[0].vals[2][1] == 90,
              "automation values preserved in order");
    hx_destroy(h);

    /* ---- 5. Armed input is not captured ---- */
    h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    inst = I(h);
    inst->tracks[1].recording = 1;
    live_note_on(inst, &inst->tracks[1], 60, 100);
    live_note_off(inst, &inst->tracks[1], 60);
    HX_ASSERT(inst->cap_count == 0, "armed input skipped");
    inst->tracks[1].recording = 0;

    /* ---- 6. Stopped capture into a drum track (track 0 default) ---- */
    HX_ASSERT(inst->tracks[0].pad_mode == PAD_MODE_DRUM, "track 0 drum");
    hx_render(h, 4);
    tap(h, 0, 60, 100, 40, 132);
    tap(h, 0, 60, 100, 40, 132);
    tap(h, 0, 60, 100, 40, 132);
    HX_ASSERT(capture_pending_for_track(inst, 0) == 3, "3 drum hits pending");
    hx_set_param(h, "t0_capture_commit", "0");
    HX_ASSERT(inst->tracks[0].drum_clips[0] != NULL, "drum clips allocated");
    {
        int l, found = -1;
        for (l = 0; l < DRUM_LANES; l++)
            if (inst->tracks[0].drum_clips[0]->lanes[l].midi_note == 60) { found = l; break; }
        HX_ASSERT(found >= 0, "lane for pitch 60 exists");
        HX_ASSERT(inst->tracks[0].drum_clips[0]->lanes[found].clip.note_count == 3,
                  "3 notes in drum lane");
    }
    HX_ASSERT(inst->playing == 1, "transport started after drum commit");
    hx_destroy(h);

    printf("PASS: capture\n");
    return 0;
}
