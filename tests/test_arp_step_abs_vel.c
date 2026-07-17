/* Arp step velocity is ABSOLUTE (2026-07-18 rework): step_vel stores a
 * velocity 0..127 (0 = step off) instead of a 5-state level. Pads write
 * canonical coarse values (32/64/96/127), knobs write fine values (5..127),
 * and legacy saved levels 0..4 migrate to the canonical values on load
 * (values <=4 are unreachable by the new UI, so the mapping is unambiguous).
 * Run from the repo root (tests/run.sh does) — fixture path resolves there. */
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
    seq8_track_t *tr = &inst->tracks[3];

    /* Fresh defaults: every step at Thru (255 = pass incoming velocity). */
    HX_ASSERT(tr->tarp.step_vel[0] == 255, "tarp default != Thru");
    HX_ASSERT(inst->tracks[0].clips[0].pfx_params.seq_arp_step_vel[0] == 255,
              "seq arp default != Thru");

    /* Handlers accept the full 0..127 velocity domain. */
    hx_set_param(h, "t3_tarp_step_vel", "1 115");
    HX_ASSERT(tr->tarp.step_vel[1] == 115, "tarp_step_vel: 115 not stored");
    hx_set_param(h, "t3_tarp_step_vel", "2 200");
    HX_ASSERT(tr->tarp.step_vel[2] == 255, "tarp_step_vel: >127 != Thru");
    hx_set_param(h, "t3_tarp_step_vel", "2 127");
    HX_ASSERT(tr->tarp.step_vel[2] == 127, "tarp_step_vel: 127 not stored");
    hx_set_param(h, "t3_tarp_step_vel", "3 0");
    HX_ASSERT(tr->tarp.step_vel[3] == 0, "tarp_step_vel: 0 (off) rejected");
    hx_set_param(h, "t3_seq_arp_step_vel", "0 87");
    HX_ASSERT(inst->tracks[3].clips[tr->active_clip].pfx_params.seq_arp_step_vel[0] == 87,
              "seq_arp_step_vel: 87 not stored");

    /* Legacy state migration: saved 5-state levels map to canonical
     * velocities (0->0, 1->32, 2->64, 3->96, 4->Thru); absent keys default
     * to Thru (255). (Sequential instances — the stub host is process-global.) */
    hx_destroy(h);
    h = NULL;
    hx_t *h2 = hx_create(NULL);
    HX_ASSERT(h2, "create 2 failed");
    seq8_instance_t *inst2 = (seq8_instance_t *)h2->inst;
    load_fixture(inst2, "tests/fixtures/state_v36_legacy_arp_vel.json");
    HX_ASSERT(inst2->tracks[0].tarp.step_vel[0] == 64,  "legacy tasv 2 != 64");
    HX_ASSERT(inst2->tracks[0].tarp.step_vel[1] == 0,   "legacy tasv 0 != 0");
    HX_ASSERT(inst2->tracks[0].tarp.step_vel[2] == 255, "absent tasv != Thru");
    HX_ASSERT(inst2->tracks[0].clips[0].pfx_params.seq_arp_step_vel[1] == 96,
              "legacy arsv 3 != 96");
    HX_ASSERT(inst2->tracks[0].clips[0].pfx_params.seq_arp_step_vel[2] == 32,
              "legacy arsv 1 != 32");
    /* the <=4 legacy-level keys in the fixture exercise the map itself */
    HX_ASSERT(inst2->tracks[0].tarp.step_vel[3] == 64, "legacy level 2 != 64");
    HX_ASSERT(inst2->tracks[0].tarp.step_vel[4] == 255, "legacy level 4 != Thru");
    HX_ASSERT(inst2->tracks[0].clips[0].pfx_params.seq_arp_step_vel[4] == 96,
              "legacy level 3 != 96");

    hx_destroy(h2);
    printf("PASS: arp_step_abs_vel\n");
    return 0;
}
