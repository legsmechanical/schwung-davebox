/* tests/test_state_migration.c — Phase 0 golden: the v36 state version gate.
 *
 * Two behaviours are pinned:
 *   (a) A minimal {"v":36} blob loads cleanly and every absent field falls
 *       back to its create-time default (seq8_load_state re-reads each sparse
 *       key with json_get_int's default arg, which mirrors the drum_track_init
 *       / drum_repeat_init_defaults values from create_instance).
 *   (b) A stale {"v":1,...} blob trips the version gate. seq8_load_state's
 *       gate reads "v" with json_get_int, and for sv>0 && sv!=36 on
 *       first encounter it sets inst->state_version_mismatch=1, then
 *       `free(buf); return;` — BEFORE any field of the instance is touched.
 *       That flag is the JS confirm-dialog signal ("Incompatible State").
 *       Because the gate returns ahead of every mutation, section (b) loads
 *       the reject blob IN PLACE on the already-populated section-(a) instance:
 *       that is the strongest possible assertion of "nothing was applied" —
 *       pre-existing pattern data and bpm must survive untouched and the v1
 *       file's bpm:99 must NOT reach cached_bpm.
 *
 * run.sh cd's to the repo root before running each binary, so the relative
 * fixture paths below resolve from there.
 */
#include "harness.h"

static void load_fixture(seq8_instance_t *inst, const char *path) {
    strncpy(inst->state_path, path, sizeof(inst->state_path) - 1);
    inst->state_path[sizeof(inst->state_path) - 1] = '\0';
    seq8_load_state(inst);
}

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* --- (a) minimal v36 blob → sane create-time defaults --- */
    /* Read-guard: seq8_load_state is a silent no-op when state_path can't be
     * opened (fopen fails → return), and most of the asserts below would
     * still pass on create-time defaults — a typo'd fixture path would go
     * vacuously green. So poison one sparse-defaulted field to a non-default
     * sentinel first; only an actual parse of the v36 blob resets it (the
     * "t%dl%drg" key is absent, so json_get_int's default 255 is applied). */
    inst->tracks[0].drum_repeat_gate[0] = 7;

    load_fixture(inst, "tests/fixtures/state_v36_minimal.json");

    HX_ASSERT(!inst->state_version_mismatch,
              "v36 must not raise version-mismatch");
    HX_ASSERT(inst->tracks[0].drum_repeat_gate[0] == 0xFF,
              "read-guard: sentinel not reset -> fixture was never parsed");
    /* clip length: json_get_int default SEQ_STEPS_DEFAULT (16), clamped >=1 */
    HX_ASSERT(inst->tracks[0].clips[0].length >= 1,
              "t0 c0 length should default >= 1");
    /* per-clip resolution: default TICKS_PER_STEP (24) */
    HX_ASSERT(inst->tracks[1].clips[0].ticks_per_step > 0,
              "t1 c0 ticks_per_step should default > 0");
    /* drum-repeat sparse default (mirrors drum_repeat_init_defaults) */
    HX_ASSERT(inst->tracks[0].drum_repeat2_rate_idx[0] == 2,
              "drum_repeat2_rate_idx default should be 2 (1/8)");
    /* pad_mode: this assert's teeth are NOT the create_instance default —
     * create_instance flips track 0 to PAD_MODE_DRUM *after* seq8_load_state
     * returns without loading any drum track (the "default track 0 to drum
     * mode" block matching JS first-run). A successful v36 parse resets it to
     * MELODIC via the "t%d_pm" key's json_get_int default 0. So MELODIC here
     * means the load path's per-track pad_mode loop actually ran — do not
     * drop this as "redundant with the init default". */
    HX_ASSERT(inst->tracks[0].pad_mode == PAD_MODE_MELODIC_SCALE,
              "pad_mode should be MELODIC after a real v36 parse");

    /* --- (b) stale v1 blob → gate fires, nothing applied --- */
    /* Populate distinguishing state first: a live step on t1 c0, and a bpm
     * different from both the default and the reject file's bpm:99. */
    hx_set_param(h, "bpm", "137");
    char bpmbuf[32];
    HX_ASSERT(hx_get_param(h, "bpm", bpmbuf, (int)sizeof(bpmbuf)) > 0
              && atoi(bpmbuf) == 137, "bpm set precondition failed");

    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    uint8_t step0_before = inst->tracks[1].clips[0].steps[0];
    HX_ASSERT(step0_before != 0, "toggle precondition: step 0 should be on");

    load_fixture(inst, "tests/fixtures/state_v1_reject.json");

    /* The JS confirm-dialog signal is raised. */
    HX_ASSERT(inst->state_version_mismatch == 1,
              "v1 blob must raise state_version_mismatch");
    /* bpm:99 from the file was NOT applied (cached_bpm untouched at 137). */
    HX_ASSERT(hx_get_param(h, "bpm", bpmbuf, (int)sizeof(bpmbuf)) > 0
              && atoi(bpmbuf) == 137,
              "v1 bpm:99 must NOT overwrite bpm (should still be 137)");
    HX_ASSERT(inst->tracks[0].pfx.cached_bpm != 99.0,
              "cached_bpm must not be the reject file's 99");
    /* Pre-existing pattern data survived the rejected load. */
    HX_ASSERT(inst->tracks[1].clips[0].steps[0] == step0_before,
              "t1 c0 step 0 must survive a rejected v1 load");

    hx_destroy(h);
    printf("PASS: state migration — v36 minimal defaults + v1 version gate\n");
    return 0;
}
