/* tests/test_rui_rev.c — rui_rev bump semantics + the targeted-resync
 * (rui_dirty) accumulator.
 *
 * rui_rev tells the on-device JS that a REMOTE (browser piano-roll) edit
 * changed session content. A change used to trigger a full syncClipsFromDsp()
 * (~1,540 sequential get_params ≈ 4.3 s of frozen UI at one param per SPI
 * frame). Now rui_mark() records WHICH clip(s) changed and the JS reads the
 * read-and-clear `rui_dirty` digest to re-sync just those. The adaptive
 * live-record path reuses tN_cC_length to grow/lock the clip, so every
 * page-growth and the stop-lock froze the unit for ~4.3 s (2026-07-06
 * record-disarm hang). Local recording writes must NOT bump rui_rev; genuine
 * remote edits still must.
 */
#include "harness.h"
#include <string.h>

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

    /* ---- targeted re-sync accumulator: rui_dirty read-and-clear digest ---- */
    char dbuf[128];
    /* Clear whatever the edits above accumulated so sub-tests are isolated. */
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));

    /* Single melodic edit → "m t c". */
    hx_set_param(h, "t2_c1_note_add", "0 60 100 24");
    int dn = hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(dn > 0 && !strcmp(dbuf, "m 2 1"), "single melodic edit → 'm 2 1'");

    /* Read-and-clear: an empty accumulator reads FULL (safe full-sync fallback). */
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "FULL"), "empty accumulator reads FULL");

    /* Dedup: two edits on the same clip collapse to one entry. */
    hx_set_param(h, "t2_c1_note_add", "24 62 100 24");
    hx_set_param(h, "t2_c1_note_del", "0 60");
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "m 2 1"), "two edits, same clip → one dirty entry");

    /* Drum edit → "d t c" (tN_lL_* auto-allocates drum mode; active_clip 0). */
    hx_set_param(h, "t4_l0_note_add", "0 100 24");
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "d 4 0"), "drum lane edit → 'd 4 0'");

    /* Mixed melodic + drum in one window → FULL (single prefix can't express it). */
    hx_set_param(h, "t2_c1_note_add", "48 64 100 24");   /* melodic track */
    hx_set_param(h, "t4_l0_note_add", "24 100 24");       /* drum track    */
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "FULL"), "mixed drum+melodic → FULL");

    /* Overflow: more than RUI_DIRTY_MAX (8) distinct clips → FULL. */
    for (int c = 0; c < 9; c++) {
        char k[32]; snprintf(k, sizeof(k), "t0_c%d_note_add", c);
        hx_set_param(h, k, "0 60 100 24");
    }
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "FULL"), ">8 distinct clips → FULL");

    /* Persistence gap fix: a remote _length edit sets state_dirty (was missing). */
    ((seq8_instance_t *)h->inst)->state_dirty = 0;
    hx_set_param(h, "t5_c0_length", "32");
    HX_ASSERT(((seq8_instance_t *)h->inst)->state_dirty == 1,
              "remote _length edit sets state_dirty (persists)");

    hx_destroy(h);
    printf("PASS: rui_rev bump semantics + rui_dirty targeted-resync accumulator\n");
    return 0;
}
