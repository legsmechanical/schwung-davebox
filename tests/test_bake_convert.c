/* tests/test_bake_convert.c — Phase 0 characterization for the two destructive
 * clip-rewrite paths that the refactor splits out:
 *
 *   BAKE    (bake_scene -> bake_clip, dsp/seq8.c ~8339) gates Phase 2's
 *           seq8_bake.c split. Freezes: loop-unroll (loops=2 doubles the notes
 *           + doubles clip length), pfx fold-in (noteFX_velocity offset baked
 *           into each emitted note's velocity), and pfx_params reset.
 *
 *   CONVERT (convert_track_melodic_to_drum / _drum_to_melodic, ~9103/9221)
 *           gates Phase 2's seq8_convert.c split. Freezes: pad_mode flip,
 *           drum_clips alloc/free, per-pitch->lane routing (distinct pitches to
 *           ascending lanes, lane midi_note re-tuned to the pitch), source-clip
 *           clear, and the melodic round-trip back.
 *
 * White-box: reads clip_t / note_t fields directly (harness #includes seq8.c).
 * All expected values are FROZEN from a verified first run (no RNG in either
 * path with these inputs) — they pin CURRENT behavior, they are not derived.
 *
 * Both convert set_param keys (tN_convert_to_drum / _to_melodic) reach the DSP
 * handler directly here; the on-device "Schwung host drops these keys" caveat
 * (dsp/CLAUDE.md) is a host-transport quirk, irrelevant to this stub. */
#include "harness.h"

/* ---- assertion helpers ---------------------------------------------------- */
static void expect_note(const char *tag, note_t *n, uint32_t tick,
                        int pitch, int vel, int gate) {
    if (!n->active)
        { fprintf(stderr, "FAIL: %s: note tombstoned\n", tag); exit(1); }
    if (n->tick != tick || n->pitch != pitch || n->vel != vel || n->gate != gate) {
        fprintf(stderr, "FAIL: %s: want tick=%u pitch=%d vel=%d gate=%d, "
                "got tick=%u pitch=%d vel=%d gate=%d\n",
                tag, tick, pitch, vel, gate, n->tick, n->pitch, n->vel, n->gate);
        exit(1);
    }
}
#define EXPECT(cond, msg) HX_ASSERT((cond), (msg))

/* ---- BAKE ----------------------------------------------------------------- */
/* One melodic note on t1 c0 (pitch 60, vel 100, gate 12) + a +10 velocity pfx.
 * bake_scene "clip=0 loops=2 wrap=0 apply=0" unrolls the clip twice and folds
 * the pfx: note_count 1->2, length 16->32, each copy vel 100->110, second copy
 * repositioned one cycle later (tick 0 -> 384 = 16 steps * 24 tps). */
static void test_bake(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "bake create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    clip_t *cl = &inst->tracks[1].clips[0];

    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c0_pfx_set", "noteFX_velocity 10");

    /* precondition (frozen): one note, default 16-step length, gate 12. */
    EXPECT(cl->note_count == 1, "bake precondition: expected 1 note");
    EXPECT(cl->length == 16,    "bake precondition: expected length 16");
    expect_note("bake pre", &cl->notes[0], 0, 60, 100, 12);
    EXPECT(cl->pfx_params.velocity_offset == 10, "bake precondition: pfx vel offset not set");

    hx_set_param(h, "bake_scene", "0 2 0 0");   /* clip 0, 2 loops, no wrap, no conductor */

    /* postcondition (frozen): doubled + velocity folded + pfx cleared. */
    EXPECT(cl->note_count == 2, "bake: expected 2 notes after loops=2");
    EXPECT(cl->length == 32,    "bake: expected length 32 after loops=2");
    expect_note("bake out[0]", &cl->notes[0],   0, 60, 110, 12);
    expect_note("bake out[1]", &cl->notes[1], 384, 60, 110, 12);
    EXPECT(cl->pfx_params.velocity_offset == 0, "bake: pfx_params not reset by clip_init");

    hx_destroy(h);
}

/* ---- CONVERT -------------------------------------------------------------- */
/* Two distinct melodic pitches on t2 c0 (60@tick0, 64@tick96 = step 4 x 24 tps) round-trip
 * through drum and back. M->D routes each pitch to an ascending lane (retuning
 * lane midi_note to the pitch) and clears the source; D->M merges lanes back. */
static void test_convert(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "convert create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[2];

    hx_set_param(h, "t2_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t2_c0_step_4_toggle", "64 90");

    /* precondition (frozen): melodic, 2 notes. */
    EXPECT(tr->pad_mode == PAD_MODE_MELODIC_SCALE, "convert precondition: t2 not melodic");
    EXPECT(tr->clips[0].note_count == 2, "convert precondition: expected 2 melodic notes");
    EXPECT(tr->drum_clips[0] == NULL,    "convert precondition: drum_clips already allocated");

    /* --- melodic -> drum --- */
    hx_set_param(h, "t2_convert_to_drum", "1");
    EXPECT(tr->pad_mode == PAD_MODE_DRUM, "M->D: pad_mode did not flip to DRUM");
    EXPECT(tr->drum_clips[0] != NULL,     "M->D: drum_clips[0] not allocated");
    /* distinct pitches -> ascending lanes; lane midi_note retuned to the pitch. */
    {
        drum_lane_t *l0 = &tr->drum_clips[0]->lanes[0];
        drum_lane_t *l1 = &tr->drum_clips[0]->lanes[1];
        EXPECT(l0->midi_note == 60, "M->D: lane 0 midi_note not retuned to 60");
        EXPECT(l0->clip.note_count == 1, "M->D: lane 0 expected 1 note");
        expect_note("M->D lane0", &l0->clip.notes[0], 0, 60, 100, 12);
        EXPECT(l1->midi_note == 64, "M->D: lane 1 midi_note not retuned to 64");
        EXPECT(l1->clip.note_count == 1, "M->D: lane 1 expected 1 note");
        expect_note("M->D lane1", &l1->clip.notes[0], 96, 64, 90, 12);
    }
    /* source melodic clip cleared (notes moved, not copied). */
    EXPECT(tr->clips[0].note_count == 0, "M->D: source melodic clip not cleared");

    /* --- drum -> melodic (reverse path) --- */
    hx_set_param(h, "t2_convert_to_melodic", "1");
    EXPECT(tr->pad_mode == PAD_MODE_MELODIC_SCALE, "D->M: pad_mode did not flip to MELODIC");
    EXPECT(tr->drum_clips[0] == NULL, "D->M: drum_clips[0] not freed");
    /* lane notes merged back into the melodic clip, pitch/tick/vel/gate intact. */
    EXPECT(tr->clips[0].note_count == 2, "D->M: expected 2 merged melodic notes");
    expect_note("D->M note0", &tr->clips[0].notes[0], 0, 60, 100, 12);
    expect_note("D->M note1", &tr->clips[0].notes[1], 96, 64, 90, 12);

    hx_destroy(h);
}

int main(void) {
    test_bake();
    test_convert();
    printf("PASS: bake + convert characterization (loop-unroll/vel-fold; M<->D round-trip)\n");
    return 0;
}
