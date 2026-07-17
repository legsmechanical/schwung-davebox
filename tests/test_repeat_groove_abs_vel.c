/* Repeat groove step velocity is ABSOLUTE (2026-07-18 rework): a gated
 * groove step fires at its stored per-step velocity (1..127, default 100)
 * directly — the held pad's velocity and the old 0-200% scaling no longer
 * enter into it. Also pins the setparam clamp (1..127). */
#include "harness.h"

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[3];

    /* First tN_lL_* write flips track 3 to drum mode + allocates clips. */
    hx_set_param(h, "t3_l0_repeat_vel_scale", "0 55");
    HX_ASSERT(tr->pad_mode == PAD_MODE_DRUM, "t3 not drum after lane write");
    HX_ASSERT(tr->drum_repeat_vel_scale[0][0] == 55, "step0 vel not stored");

    /* Clamp: absolute velocity domain is 1..127. */
    hx_set_param(h, "t3_l0_repeat_vel_scale", "1 200");
    HX_ASSERT(tr->drum_repeat_vel_scale[0][1] == 127, "clamp high != 127");
    hx_set_param(h, "t3_l0_repeat_vel_scale", "2 0");
    HX_ASSERT(tr->drum_repeat_vel_scale[0][2] == 1, "clamp low != 1");

    /* Sync off so the repeat fires immediately; start Rpt1 on lane 0 with a
     * held-pad velocity of 120 — which must NOT affect the emitted velocity. */
    hx_set_param(h, "t3_drum_repeat_sync", "0");
    hx_set_param(h, "t3_drum_repeat_start", "0 2 120");
    HX_ASSERT(tr->drum_repeat_active == 1, "repeat not active");

    hx_render(h, 8);

    /* Step 0 fired: velocity must be the step's absolute 55 (old scaling
     * behavior would emit 120*55/100 = 66). */
    int found = 0;
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if ((e->bytes[1] & 0xF0) == 0x90 && e->bytes[3] > 0) {
            HX_ASSERT(e->bytes[3] == 55, "note-on velocity not absolute (want 55)");
            found = 1;
            break;
        }
    }
    HX_ASSERT(found, "no repeat note-on emitted");

    hx_destroy(h);
    printf("PASS: repeat_groove_abs_vel\n");
    return 0;
}
