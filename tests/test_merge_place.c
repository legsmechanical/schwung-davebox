/* merge_place() committing a Live Merge capture onto a scene row whose drum
 * clip slot is NULL (legitimately empty — clip-copy of an empty source and
 * state load both leave empty drum slots NULL). Crashed with a NULL deref
 * before the guard (audit dsp-state-1). */
#include "harness.h"

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[0];

    /* Drum track with clips allocated, then row 3 emptied to NULL the same
     * way the clip-copy path does (seq8_set_param.c copy_to handler). */
    tr->pad_mode = PAD_MODE_DRUM;
    drum_clips_alloc(inst, tr);
    free(tr->drum_clips[3]);
    tr->drum_clips[3] = NULL;

    /* Captured Live Merge with one pending drum hit on track 0. */
    inst->merge_state = MERGE_STATE_CAPTURED;
    inst->merge_tps = 24;
    inst->merge_end_abs = 24 * 16;
    inst->merge_pending_count[0] = 1;
    inst->merge_pending[0][0].pitch = (uint8_t)DRUM_BASE_NOTE;
    inst->merge_pending[0][0].tick_at_on = 0;
    inst->merge_pending[0][0].vel = 100;
    inst->merge_pending[0][0].gate = 12;

    /* Commit to the empty row — NULL deref here before the fix. */
    hx_set_param(h, "merge_place_row", "3");

    HX_ASSERT(tr->drum_clips[3] != NULL, "row 3 drum clip not allocated");
    HX_ASSERT(tr->drum_clips[3]->lanes[0].clip.note_count == 1,
              "pending hit not placed in lane 0");
    HX_ASSERT(inst->merge_state == MERGE_STATE_IDLE, "merge state not reset");
    HX_ASSERT(inst->merge_pending_count[0] == 0, "pending count not cleared");

    hx_destroy(h);
    printf("PASS: merge_place onto empty (NULL) drum slot\n");
    return 0;
}
