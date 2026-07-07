/* tests/test_pfx_sync_drum_null.c — regression pin for the pfx_sync_from_clip
 * NULL active-drum-clip crash.
 *
 * Root cause: pfx_sync_from_clip's PAD_MODE_DRUM branch dereferenced
 * tr->drum_clips[tr->active_clip] with no NULL check. Drum clips are allocated
 * lazily per-clip (drum_clips_alloc), so a drum track whose active_clip points
 * at an unallocated slot has drum_clips[active_clip] == NULL. When a clip
 * launch (or drum_clip_copy) triggered the sync, &NULL->lanes[l].pfx_params
 * dereferenced NULL+offset → SIGSEGV on device (si_addr small offset).
 *
 * Driver: the stopped-transport path of tN_launch_clip
 * (dsp/setparam/sp_track_config.c) sets tr->active_clip = new_cidx and calls
 * pfx_sync_from_clip(tr) directly — the minimal public set_param that routes
 * to the static pfx_sync_from_clip on a track we can force into the crash
 * precondition (pad_mode==DRUM, active_clip slot NULL).
 *
 * PRE-FIX: hx_set_param below SIGSEGVs (run.sh runs each test as its own
 * binary, so this shows as this test FAILing, not the suite dying).
 * POST-FIX: the guarded deref makes the sync a no-op and we reach the asserts.
 */
#include "harness.h"

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    seq8_instance_t *inst = (seq8_instance_t *)h->inst;   /* white-box */
    seq8_track_t *tr = &inst->tracks[1];

    /* Construct the documented crash precondition deterministically: a
     * drum-mode track whose active clip slot has NOT been allocated. Drum
     * clips are allocated lazily per-clip (drum_clips_alloc), so this window
     * is real on device. We build it explicitly here (rather than relying on
     * ambient post-create state) by freeing/NULLing all drum_clips on the
     * track, then flipping it to drum mode without allocating. */
    drum_clips_free(tr);
    tr->pad_mode = PAD_MODE_DRUM;
    HX_ASSERT(tr->drum_clips[1] == NULL,
              "precondition: drum_clips[1] must be unallocated (NULL) to arm the crash");

    /* Launch clip 1 while transport is stopped. This routes through the
     * else-branch of tN_launch_clip, which sets active_clip=1 and calls
     * pfx_sync_from_clip(tr) — the exact call that crashed pre-fix
     * (&drum_clips[1]->lanes[l].pfx_params dereferences NULL). */
    hx_set_param(h, "t1_launch_clip", "1");

    /* Reached only if the guard held (pre-fix: SIGSEGV above). */
    HX_ASSERT(tr->active_clip == 1, "launch should have set active_clip=1");
    HX_ASSERT(tr->drum_clips[1] == NULL,
              "sync must not have allocated the clip (no-op on NULL slot)");

    hx_destroy(h);
    printf("PASS: pfx_sync_drum_null (launch on unallocated active drum clip is a no-op)\n");
    return 0;
}
