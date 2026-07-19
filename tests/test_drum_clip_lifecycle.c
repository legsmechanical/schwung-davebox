/* tests/test_drum_clip_lifecycle.c — drum-clip NULL-active invariant.
 *
 * A drum track keeps its whole drum_clips[] allocated (drum_clips_alloc fills
 * all 16 on entry to drum mode / state load). The ONLY places that free an
 * individual drum clip to NULL are the copy/restore paths — and if the freed
 * slot is the track's active_clip, later drum consumers (live_note_on, render,
 * pfx_sync) deref NULL → SIGSEGV (si_addr = a lane offset into the null clip).
 *
 * Three fixes are pinned here:
 *   1. live_note_on guards the active-drum-clip deref (defense-in-depth).
 *   2. row_copy with an empty source RE-INITS the dst drum lanes instead of
 *      freeing the clip to NULL (mirrors row_cut) — keeps the invariant.
 *   3. drum_row_restore (undo/redo) with an empty snapshot keeps a drum track's
 *      clip allocated (clears lanes) instead of freeing to NULL; only a
 *      non-drum track reclaims the memory.
 *
 * PRE-FIX each of these SIGSEGVs or leaves a NULL active drum clip; run.sh runs
 * each test as its own binary, so a crash shows as this test FAILing.
 */
#include "harness.h"
#include <stdlib.h>
#include <string.h>

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;   /* white-box */

    /* ---- 1. live_note_on: NULL active drum clip must not crash ---- */
    {
        seq8_track_t *tr = &inst->tracks[1];
        drum_clips_free(tr);            /* force the documented crash window */
        tr->pad_mode   = PAD_MODE_DRUM;
        tr->active_clip = 1;
        HX_ASSERT(tr->drum_clips[1] == NULL,
                  "precondition: active drum clip must be NULL to arm the crash");
        live_note_on(inst, tr, 60, 100);   /* pre-fix: deref NULL->lanes → SIGSEGV */
        HX_ASSERT(tr->drum_clips[1] == NULL,
                  "live_note_on must be a no-op on a NULL active drum clip");
    }

    /* ---- 2. row_copy with an empty source must NOT free a drum dst to NULL ---- */
    {
        seq8_track_t *tr0 = &inst->tracks[0];
        hx_set_param(h, "t0_l0_note_add", "0 100 24");  /* -> drum mode, alloc all 16 */
        HX_ASSERT(tr0->pad_mode == PAD_MODE_DRUM, "t0 should be drum mode");
        HX_ASSERT(tr0->drum_clips[5] != NULL, "dst clip 5 should be allocated");
        /* Simulate the partial-NULL that a prior restore/copy can create: free
         * the SOURCE row's drum clip so row_copy hits the empty-source branch. */
        free(tr0->drum_clips[2]);
        tr0->drum_clips[2] = NULL;
        hx_set_param(h, "row_copy", "2 5");   /* empty src 2 -> dst 5 */
        HX_ASSERT(tr0->drum_clips[5] != NULL,
                  "row_copy empty-source must re-init dst, not free it to NULL");
    }

    /* ---- 3. drum_row_restore(empty snapshot) keeps a drum track's clip alloc'd ---- */
    {
        seq8_track_t *tr2 = &inst->tracks[2];
        hx_set_param(h, "t2_l0_note_add", "0 100 24");  /* -> drum mode, alloc all 16 */
        int row = 3;
        HX_ASSERT(tr2->drum_clips[row] != NULL, "clip should be allocated pre-restore");
        /* Zeroed snapshot = every lane inactive (has_data == 0 for all tracks). */
        static drum_rec_snap_lane_t snap[NUM_TRACKS][DRUM_LANES];
        memset(snap, 0, sizeof(snap));
        drum_row_restore(inst, row, snap);   /* pre-fix: frees tr2->drum_clips[row] */
        HX_ASSERT(tr2->drum_clips[row] != NULL,
                  "drum_row_restore(empty) must keep a drum track's clip allocated");
        /* A non-drum track still reclaims: track 6 is melodic, its drum clips
         * are NULL and stay NULL (nothing to free, no crash). */
        HX_ASSERT(inst->tracks[6].drum_clips[row] == NULL,
                  "non-drum track keeps its drum clip NULL (reclaimed / never alloc'd)");
    }

    /* ---- 4. Batched tN_drum_meta get_param matches the per-lane values ---- */
    {
        seq8_track_t *tr3 = &inst->tracks[3];
        hx_set_param(h, "t3_l0_note_add", "0 100 24");  /* drum mode, alloc, lane 0 has a note */
        tr3->drum_lane_mute = 0x2A;
        tr3->drum_lane_solo = 0x15;
        char buf[1024];
        int n = hx_get_param(h, "t3_drum_meta", buf, sizeof(buf));
        HX_ASSERT(n > 0, "drum_meta returns data");
        /* Parse "note0 nc0 ... note31 nc31 mute solo" and cross-check. */
        int vals[DRUM_LANES * 2 + 2], cnt = 0;
        const char *p = buf;
        while (*p && cnt < DRUM_LANES * 2 + 2) {
            vals[cnt++] = atoi(p);
            while (*p && *p != ' ') p++;
            while (*p == ' ') p++;
        }
        HX_ASSERT(cnt == DRUM_LANES * 2 + 2, "drum_meta has 66 fields");
        HX_ASSERT(vals[0] == DRUM_BASE_NOTE, "lane0 note = base");
        HX_ASSERT(vals[1] == 1, "lane0 has notes");
        HX_ASSERT(vals[3] == 0, "lane1 has no notes");
        HX_ASSERT((uint32_t)vals[DRUM_LANES * 2] == 0x2Au, "mute field matches");
        HX_ASSERT((uint32_t)vals[DRUM_LANES * 2 + 1] == 0x15u, "solo field matches");
    }

    hx_destroy(h);
    printf("PASS: drum-clip NULL-active invariant + batched drum_meta getter\n");
    return 0;
}
