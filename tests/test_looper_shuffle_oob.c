/* tests/test_looper_shuffle_oob.c — regression pin for the looper SHUFFLE
 * out-of-bounds crash.
 *
 * Bug: in looper_tick's cycle-start hook (LOOPING + looper_pos==0), the
 * SHUFFLE perf-modifier ran a Fisher-Yates loop `for (i = nc-1; i > 0; i--)`
 * with i as uint16_t. When a loop cycle held ZERO note-ons (nc==0), nc-1
 * underflowed to 65535 and pitches[65535] — a 1024-byte stack array — was
 * written out of bounds → SIGSEGV on the RT audio thread. The sibling
 * BACKWARDS branch was already guarded (`hi2 = nc > 0 ? nc-1 : 0`); SHUFFLE
 * was not.
 *
 * White-box: drive looper_tick(inst) directly with the looper in LOOPING at
 * pos 0, SHUFFLE armed, and an event buffer of only note-OFF events so the
 * note-on count nc collapses to 0. Pre-fix this crashes; post-fix it is a
 * clean no-op (perf_note_on_count==0, no permutation written).
 */
#include "harness.h"

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    seq8_instance_t *inst = (seq8_instance_t *)h->inst;   /* white-box */

    /* Put the looper into LOOPING at the cycle-start position with SHUFFLE
     * armed. capture_ticks must be nonzero (looper_tick early-returns if 0). */
    inst->looper_capture_ticks = 96;
    inst->looper_state         = LOOPER_STATE_LOOPING;
    inst->looper_pos           = 0;
    inst->looper_play_idx      = 0;
    inst->looper_cycle         = 1;
    inst->perf_mods_active     = PERF_MOD_SHUFFLE;

    /* An event buffer with only note-OFF events → the note-on collector
     * (status 0x90 && d2>0) matches nothing, so nc==0. This is the crash
     * trigger: nc-1 underflows in the unguarded Fisher-Yates loop. */
    inst->looper_event_count = 2;
    inst->looper_events[0].tick   = 0;
    inst->looper_events[0].status = 0x80;   /* note-off */
    inst->looper_events[0].d1     = 60;
    inst->looper_events[0].d2     = 0;
    inst->looper_events[0].track  = 0;
    inst->looper_events[1].tick   = 12;
    inst->looper_events[1].status = 0x80;   /* note-off */
    inst->looper_events[1].d1     = 64;
    inst->looper_events[1].d2     = 0;
    inst->looper_events[1].track  = 0;

    /* Pre-fix: SIGSEGV (OOB write to pitches[65535]) inside this call.
     * Post-fix: returns cleanly. */
    looper_tick(inst);

    /* With zero note-ons the cycle-start hook must record nc==0 and write no
     * permutation. */
    HX_ASSERT(inst->perf_note_on_count == 0,
              "expected perf_note_on_count==0 for a note-off-only cycle");

    hx_destroy(h);
    printf("PASS: looper_shuffle_oob (nc==0 shuffle no longer underflows)\n");
    return 0;
}
