/* tests/test_rui_budget.c — pin the remote-UI snapshot (get_param "state") under
 * a realistic-dense session at the 64 KB budget (SHADOW_PARAM_VALUE_LEN), well
 * ahead of the 64 KB ceiling.
 *
 * Background (audit finding remote-ui-3, PARKED): a pathological drum clip
 * (~9 lanes at maximum density) CAN overflow the 64 KB snapshot buffer and
 * truncate the JSON silently — seq8_remote_snapshot()'s APP() macro guards each
 * append with `if (n < out_len)`, but once truncation starts the buffer is
 * force-null-terminated mid-field (see dsp/seq8.c around line 9741), producing
 * a snapshot the browser's JSON.parse will reject. That overflow case is NOT
 * fixed yet and is deliberately NOT exercised/asserted here — this test only
 * pins today's REALISTIC-dense case (4 drum lanes fully populated + a melodic
 * chord clip) as comfortably under budget and well-formed, so a future
 * refactor near seq8_remote.c can't silently regress the margin. The overflow
 * fix (when it lands) should EXTEND this test with the pathological ~9-lane
 * case and assert non-truncation there too. */
#include "harness.h"

static void test_rui_budget_realistic_dense(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    /* 4 drum lanes x 16 hits on t0 (t0 defaults to DRUM). Each tN_lL_* write is
     * the documented drum-clip allocation trigger. */
    for (int l = 0; l < 4; l++) {
        for (int s = 0; s < 16; s++) {
            char key[64];
            snprintf(key, sizeof(key), "t0_l%d_step_%d_toggle", l, s);
            hx_set_param(h, key, "100");
        }
    }

    /* melodic t1 c0: every other step toggled, then upgraded to a 3-note chord. */
    for (int s = 0; s < 16; s += 2) {
        char key[64];
        snprintf(key, sizeof(key), "t1_c0_step_%d_toggle", s);
        hx_set_param(h, key, "60 100");
        snprintf(key, sizeof(key), "t1_c0_step_%d_set_notes", s);
        hx_set_param(h, key, "60 64 67");
    }

    /* select t0's clip for the snapshot (idiom from test_remote_snapshot.c) */
    hx_set_param(h, "t0_c0_ruisel", "");

    static char buf[65536];
    int n = hx_get_param(h, "state", buf, (int)sizeof(buf));

    HX_ASSERT(n > 0, "get_param state returned no data");
    HX_ASSERT(n < 65536, "snapshot hit the 64KB buffer cap (n >= 65536)");
    /* Size CANARY, not a contract: today's snapshot for this fixed scenario is
     * ~2 KB; 8192 is ~4x slack. If a feature legitimately grows the snapshot,
     * bump this number DELIBERATELY in the same commit — the point is that
     * snapshot growth must be noticed, never silent (remote-ui-3 ceiling). */
    HX_ASSERT(n < 8192, "snapshot canary: size grew past 4x baseline — bump deliberately if intended");
    /* Density FLOOR: this scenario must serialize real content. If the drum
     * allocation trigger or note serialization silently broke, the snapshot
     * would go sparse and the strstr presence checks below would pass on
     * empty fields — the floor makes density loss a failure. */
    HX_ASSERT(n > 1000, "snapshot suspiciously small — realistic-dense content missing");

    HX_ASSERT(buf[n - 1] == '}', "snapshot not terminated by '}' — truncation is the failure mode being pinned");

    HX_ASSERT(strstr(buf, "\"rui_dnotes\":\"") != NULL, "missing rui_dnotes (drum hits)");
    HX_ASSERT(strstr(buf, "\"rui_index\":\"") != NULL, "missing rui_index (tracks index)");

    printf("PASS: rui budget realistic-dense snapshot size = %d bytes (cap 65536)\n", n);

    hx_destroy(h);
}

int main(void) {
    test_rui_budget_realistic_dense();
    printf("PASS: rui budget (realistic-dense snapshot under 64KB, well-formed)\n");
    return 0;
}
