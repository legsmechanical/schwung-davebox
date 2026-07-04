/* tests/test_state_roundtrip.c — Phase 0 golden: a heavily-populated
 * instance must serialize -> seq8_load_state -> re-serialize byte-
 * identically. Protects the frozen v36 format across the Phase 2
 * seq8_state.c split. Population touches: global params, swing, melodic
 * steps + chords + per-step vel/gate/nudge, drum lanes (allocates
 * drum_clips), clip length/loop, mute/solo, routes.
 *
 * Device-faithful load: the blob is loaded into a SECOND, FRESH instance.
 * On device, seq8_load_state never runs against a still-populated
 * instance: the "state_load" set_param handler resets in-memory state
 * first (seq8_set_param.c ~1024-1064: transport/merge/per-track playback,
 * recording, clip and pad_mode reset) before calling seq8_load_state, and
 * init-time loads run on a fresh instance. Calling seq8_load_state
 * in-place on populated note lanes double-appends step notes (the parser
 * appends by design), which is not a serializer bug — so this test
 * destroys instance A after serializing and loads into a clean
 * hx_create'd instance B. (hx_create holds a single static hx_t, so
 * instances are recreated sequentially, never held concurrently.) */
#include "harness.h"
#include <unistd.h>

int main(void) {
    /* --- instance A: populate heavily and serialize --- */
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* Each param below must round-trip through seq8_do_serialize — a field
     * that isn't persisted won't be caught by the byte-compare, so verify
     * new additions actually appear in the blob. */
    hx_set_param(h, "bpm", "137");
    hx_set_param(h, "key", "3");
    hx_set_param(h, "scale_aware", "1");
    hx_set_param(h, "metro_vol", "80");
    hx_set_param(h, "swing_amt", "42");
    hx_set_param(h, "swing_res", "1");
    hx_set_param(h, "t1_c2_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c2_step_0_set_notes", "60 64 67");
    hx_set_param(h, "t1_c2_step_4_toggle", "72 90");
    hx_set_param(h, "t1_c2_step_4_vel", "45");
    hx_set_param(h, "t1_c2_step_4_gate", "48");
    hx_set_param(h, "t1_c2_length", "12");
    hx_set_param(h, "t0_l0_step_0_toggle", "110");
    hx_set_param(h, "t0_l3_step_7_toggle", "64");
    HX_ASSERT(inst->tracks[0].drum_clips[inst->tracks[0].active_clip],
              "drum clips not allocated by lane write");
    hx_set_param(h, "t2_mute", "1");
    hx_set_param(h, "t3_solo", "1");
    hx_set_param(h, "t4_route", "external");

    hx_set_param(h, "bpm", "137");   /* idempotent re-dirty */
    static char buf1[65536];
    int n1 = hx_get_param(h, "state_full", buf1, (int)sizeof(buf1));
    HX_ASSERT(n1 > 0, "first state_full empty");
    /* Truncation must be a hard failure: at the cap both serializations
     * would truncate identically and the compare would pass on a prefix. */
    HX_ASSERT((size_t)n1 < sizeof(buf1) - 1, "state_full at buffer cap");

    char tmp[256];
    snprintf(tmp, sizeof(tmp), "/tmp/hx_rt_state_%d.json", (int)getpid());
    FILE *wf = fopen(tmp, "w");
    HX_ASSERT(wf && fwrite(buf1, 1, (size_t)n1, wf) == (size_t)n1, "tmp write failed");
    fclose(wf);

    /* --- instance B: fresh instance, device-faithful load --- */
    hx_destroy(h);
    h = hx_create(NULL);
    HX_ASSERT(h, "second create failed");
    inst = (seq8_instance_t *)h->inst;

    strncpy(inst->state_path, tmp, sizeof(inst->state_path) - 1);
    inst->state_path[sizeof(inst->state_path) - 1] = '\0';
    seq8_load_state(inst);
    remove(tmp);

    hx_set_param(h, "bpm", "137");
    static char buf2[65536];
    int n2 = hx_get_param(h, "state_full", buf2, (int)sizeof(buf2));
    HX_ASSERT(n2 > 0, "second state_full empty");
    if (n1 != n2 || memcmp(buf1, buf2, (size_t)n1) != 0) {
        fprintf(stderr, "FAIL: round-trip not byte-identical (%d vs %d bytes)\n", n1, n2);
        FILE *a = fopen("/tmp/hx_rt_a.json", "w"); fwrite(buf1, 1, (size_t)n1, a); fclose(a);
        FILE *b = fopen("/tmp/hx_rt_b.json", "w"); fwrite(buf2, 1, (size_t)n2, b); fclose(b);
        fprintf(stderr, "  dumped /tmp/hx_rt_a.json vs /tmp/hx_rt_b.json\n");
        exit(1);
    }

    hx_destroy(h);
    printf("PASS: populated state round-trip byte-identical (%d bytes)\n", n1);
    return 0;
}
