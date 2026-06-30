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

    /* track 0 defaults to DRUM, so use track 1 (melodic) for the melodic path */
    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c0_ruisel", "");

    char buf[8192];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "get_param state returned no data");
    /* flat string fields (manager-explosion-safe) */
    HX_ASSERT(strstr(buf, "\"rui_sel\":\"1:0:-1\"") != NULL, "sel target not t1c0 melodic");
    HX_ASSERT(strstr(buf, "\"rui_index\":\"") != NULL, "missing tracks index");
    HX_ASSERT(strstr(buf, "\"rui_notes\":\"") != NULL, "missing clip notes field");
    HX_ASSERT(strstr(buf, ":60:100:") != NULL, "pitch 60 vel 100 not in notes");
    HX_ASSERT(strstr(buf, "\"rui_play\":\"") != NULL, "missing play field");
    HX_ASSERT(strstr(buf, "\"rui_clip\":\"") != NULL, "missing clip params field");
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
    HX_ASSERT(strstr(buf, "\"rui_sel\":\"2:3:-1\"") != NULL, "sel target not t2c3 melodic");
    HX_ASSERT(strstr(buf, ":72:90:") != NULL, "pitch 72 vel 90 not in selected clip");
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
    HX_ASSERT(strstr(buf, "\"rui_index\":\"") != NULL, "expected a tracks index");
    HX_ASSERT(strstr(buf, "\"rui_notes\":\"\"") != NULL, "empty selected clip should have empty notes");
    hx_destroy(h);
}

/* The schwung-manager discovers an active overtake tool by probing
 * "overtake_dsp:module_id" (forwarded to the DSP's get_param("module_id")).
 * davebox must answer "davebox" so the manager can locate web_ui.html and
 * route the remote UI. */
static void test_module_id_probe(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    char buf[64];
    int len = hx_get_param(h, "module_id", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "get_param module_id returned no data");
    HX_ASSERT(strcmp(buf, "davebox") == 0, "module_id probe must return \"davebox\"");
    hx_destroy(h);
}

static void test_snapshot_ccmeta_present(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    /* track 1 melodic; assign knob 0 -> CC 11, write breakpoints, select clip 0 */
    hx_set_param(h, "t1_cc_type_assign", "0 0 11");      /* knob0 type CC, cc#11 */
    hx_set_param(h, "t1_cc_auto_set", "0 0 0 64");       /* clip0 knob0 tick0 val64 */
    hx_set_param(h, "t1_cc_auto_set", "0 0 48 100");     /* clip0 knob0 tick48 val100 */
    hx_set_param(h, "t1_c0_ruisel", "");
    char buf[16384];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "no state");
    HX_ASSERT(strstr(buf, "\"rui_ccmeta\":\"") != NULL, "missing rui_ccmeta");
    HX_ASSERT(strstr(buf, "\"rui_ccmeta\":\"11,0,1,") != NULL, "knob0 meta wrong");
    HX_ASSERT(strstr(buf, "\"rui_cc\":\"\"") != NULL, "rui_cc should be empty when unfocused");
    hx_destroy(h);
}

static void test_snapshot_cc_focus_emits_breakpoints(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    hx_set_param(h, "t1_cc_auto_set", "0 0 0 64");
    hx_set_param(h, "t1_cc_auto_set", "0 0 48 100");
    hx_set_param(h, "t1_c0_ruisel", "");
    hx_set_param(h, "t1_c0_cc_focus", "0");             /* focus knob 0 */
    char buf[16384];
    hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(strstr(buf, "\"rui_cc\":\"0|0:64,48:100\"") != NULL, "focused breakpoints wrong");
    hx_set_param(h, "t1_c0_cc_focus", "-1");
    hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(strstr(buf, "\"rui_cc\":\"\"") != NULL, "rui_cc should clear on focus -1");
    hx_destroy(h);
}

int main(void) {
    test_snapshot_has_selected_clip_notes();
    test_snapshot_selection_switches_clip();
    test_snapshot_empty_clip_has_index();
    test_module_id_probe();
    test_snapshot_ccmeta_present();
    test_snapshot_cc_focus_emits_breakpoints();
    printf("PASS: remote snapshot (notes round-trip, selection switch, empty index, module_id probe, ccmeta, cc_focus)\n");
    return 0;
}
