/* tests/test_remote_snapshot.c — verify the remote-UI snapshot (get_param "state")
 * reflects clip note content + the tN_cC_ruisel selection target.
 *
 * White-box harness (#includes seq8.c). The snapshot is the read path the
 * schwung-manager pulls on subscribe (comp+":state") to seed the browser piano
 * roll; davebox's own persistence stays on the separate state_full path. */
#include "harness.h"

static void test_snapshot_has_selected_clip_notes(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    /* add a melodic note to track 0, clip 0 via the existing step path */
    hx_set_param(h, "t0_c0_step_0_toggle", "60 100");
    /* select t0c0 as the remote snapshot target */
    hx_set_param(h, "t0_c0_ruisel", "");

    char buf[8192];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "get_param state returned no data");
    HX_ASSERT(strstr(buf, "\"sel\":{\"t\":0,\"c\":0") != NULL, "sel target not t0c0");
    HX_ASSERT(strstr(buf, "\"tracks\":[") != NULL, "missing tracks index");
    HX_ASSERT(strstr(buf, "\"notes\":\"") != NULL, "missing clip notes field");
    HX_ASSERT(strstr(buf, ":60:100:") != NULL, "pitch 60 vel 100 not in notes");
    HX_ASSERT(strstr(buf, "\"play\":{\"on\":") != NULL, "missing play block");
    hx_destroy(h);
}

static void test_snapshot_selection_switches_clip(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    hx_set_param(h, "t2_c3_step_0_toggle", "72 90");
    hx_set_param(h, "t2_c3_ruisel", "");

    char buf[8192];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "get_param state returned no data");
    HX_ASSERT(strstr(buf, "\"sel\":{\"t\":2,\"c\":3") != NULL, "sel target not t2c3");
    HX_ASSERT(strstr(buf, ":72:90:") != NULL, "pitch 72 vel 90 not in selected clip");
    HX_ASSERT(strstr(buf, "\"lane\":-1") != NULL, "melodic selection should be lane -1");
    hx_destroy(h);
}

static void test_snapshot_empty_clip_has_index(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    /* no notes anywhere: snapshot still valid, has=0 throughout, notes empty */
    hx_set_param(h, "t0_c0_ruisel", "");
    char buf[8192];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "get_param state returned no data for empty session");
    HX_ASSERT(strstr(buf, "\"has\":0") != NULL, "expected at least one empty clip flagged has:0");
    HX_ASSERT(strstr(buf, "\"notes\":\"\"") != NULL, "empty selected clip should have empty notes");
    hx_destroy(h);
}

int main(void) {
    test_snapshot_has_selected_clip_notes();
    test_snapshot_selection_switches_clip();
    test_snapshot_empty_clip_has_index();
    printf("PASS: remote snapshot (notes round-trip, selection switch, empty index)\n");
    return 0;
}
