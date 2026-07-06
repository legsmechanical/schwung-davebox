/* tests/test_rui_rev.c — rui_rev bump semantics for the per-clip _length key.
 *
 * rui_rev tells the on-device JS that a REMOTE (browser piano-roll) edit
 * changed session content; any change triggers a full syncClipsFromDsp()
 * (~1,540 sequential get_params ≈ 4.3 s of frozen UI at one param per SPI
 * frame). The adaptive live-record path reuses tN_cC_length to grow/lock
 * the clip, so every page-growth and the stop-lock froze the unit for
 * ~4.3 s (2026-07-06 record-disarm hang). Local recording writes must NOT
 * bump rui_rev; genuine remote edits still must.
 */
#include "harness.h"

static unsigned rev(hx_t *h) {
    return (unsigned)((seq8_instance_t *)h->inst)->rui_rev;
}

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");

    /* Pin: remote note edit bumps the rev (existing remote-UI contract). */
    unsigned r0 = rev(h);
    hx_set_param(h, "t7_c0_note_add", "0 60 100 24");
    HX_ASSERT(rev(h) == r0 + 1, "remote note_add must bump rui_rev");

    /* Pin: _length while NOT recording (a genuine remote edit) bumps. */
    unsigned r1 = rev(h);
    hx_set_param(h, "t7_c0_length", "32");
    HX_ASSERT(rev(h) == r1 + 1, "remote _length (not recording) must bump rui_rev");

    /* THE FIX: _length while the track is live-recording (the adaptive
     * grow/lock writes) must NOT bump — it triggered a ~4.3 s full-resync
     * freeze per write on device. */
    hx_set_param(h, "t7_recording", "1");
    unsigned r2 = rev(h);
    hx_set_param(h, "t7_c0_length", "48");
    HX_ASSERT(rev(h) == r2, "_length during recording must NOT bump rui_rev");

    /* Length write still took effect (only the rev bump is suppressed). */
    char buf[32];
    int n = hx_get_param(h, "t7_c0_length", buf, (int)sizeof(buf));
    HX_ASSERT(n > 0 && atoi(buf) == 48, "_length during recording still applies");

    /* Disarm; a later remote _length bumps again. */
    hx_set_param(h, "t7_recording", "0");
    unsigned r3 = rev(h);
    hx_set_param(h, "t7_c0_length", "64");
    HX_ASSERT(rev(h) == r3 + 1, "remote _length after disarm bumps again");

    hx_destroy(h);
    printf("PASS: rui_rev bump semantics (remote edits bump, recording-driven _length does not)\n");
    return 0;
}
