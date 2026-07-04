/* Param-parser hardening (audit uncertains promoted after verification):
 *  - dsp-params-1: tN_cC_* clip-index parse accumulated digits into an int
 *    with only an upper-bound check; a >=10-digit index overflows negative
 *    and indexes tr->clips[] far out of bounds (reachable with arbitrary
 *    keys via the remote-UI write path).
 *  - dsp-params-4: _set_notes overwrote step_notes[0..cnt) without resetting
 *    note_tick_offset[] for those slots — a replaced note silently inherited
 *    the previous note's sub-step (InQ Off) timing offset. */
#include "harness.h"

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* --- dsp-params-1: overflowing clip index must be rejected, not used.
     * 19999999999 wraps (mod 2^32) to a value that is negative as int32 —
     * pre-fix this indexed tr->clips[negative] and crashed/corrupted. */
    uint16_t len_before = inst->tracks[0].clips[0].length;
    hx_set_param(h, "t0_c19999999999_length", "8");
    HX_ASSERT(inst->tracks[0].clips[0].length == len_before,
              "overflowed clip index leaked a write into clip 0");

    /* --- dsp-params-4: _set_notes must clear stale sub-step offsets on the
     * slots it overwrites. Activate a step, plant an off-grid offset (as an
     * InQ-Off recording would), replace the note, expect offset reset. */
    hx_set_param(h, "t0_c0_step_0_toggle", "60 100");
    clip_t *cl = &inst->tracks[0].clips[0];
    HX_ASSERT(cl->steps[0] == 1, "step 0 not activated");
    cl->note_tick_offset[0][0] = 5;              /* stale sub-step offset */
    hx_set_param(h, "t0_c0_step_0_set_notes", "72");
    HX_ASSERT(cl->step_notes[0][0] == 72, "set_notes did not write note");
    HX_ASSERT(cl->note_tick_offset[0][0] == 0,
              "replaced note inherited stale note_tick_offset");

    hx_destroy(h);
    printf("PASS: param hardening (overflowed clip index, set_notes offsets)\n");
    return 0;
}
