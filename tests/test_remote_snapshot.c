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

/* A DRUM track with notes must light its clip's has-bit in rui_index, so the
 * session grid doesn't show populated drum clips as empty. Before the fix the
 * has-bits scanned only trk->clips[] (melodic), so drum tracks emitted all 0s. */
static void test_snapshot_drum_clip_has_bit(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    /* track 0 -> drum: first tN_lL_* write allocates drum clips + sets pad_mode */
    hx_set_param(h, "t0_l0_clip_length", "16");
    HX_ASSERT(inst->tracks[0].pad_mode == PAD_MODE_DRUM, "track 0 should be drum");
    /* add a hit at tick 0 in lane 0 of the active drum clip (clip 0) */
    hx_set_param(h, "t0_l0_note_add", "0 100");
    hx_set_param(h, "t0_c0_ruisel", "");
    char buf[16384];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "no state");
    /* rui_index track-0 record = "pm:ac:qc:pl:<16 has-bits>:route:chan". Skip the
     * 4 leading colon-separated fields; the first has-bit (clip 0) must be '1'. */
    const char *p = strstr(buf, "\"rui_index\":\"");
    HX_ASSERT(p != NULL, "missing rui_index");
    p += strlen("\"rui_index\":\"");
    int colons = 0;
    while (*p && colons < 4) { if (*p == ':') colons++; p++; }
    HX_ASSERT(*p == '1', "drum clip 0 with a note must set its rui_index has-bit");
    hx_destroy(h);
}

/* CC automation must surface in the snapshot on DRUM tracks too — the engine
 * already evaluates clip_cc_auto for drums (indexed by active_clip). Before the
 * fix rui_ccmeta + rui_cc were gated !drum, hiding all drum CC automation. */
static void test_snapshot_drum_cc_automation(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    seq8_track_t *tr = &inst->tracks[0];
    hx_set_param(h, "t0_l0_clip_length", "16");           /* track 0 -> drum */
    HX_ASSERT(tr->pad_mode == PAD_MODE_DRUM, "track 0 should be drum");
    /* knob 0 -> CC 74; write breakpoints into the active clip's automation (clip 0) */
    hx_set_param(h, "t0_cc_type_assign", "0 0 74");        /* knob0 type CC, cc#74 */
    hx_set_param(h, "t0_cc_auto_set", "0 0 0 64");         /* clip0 knob0 tick0 val64 */
    hx_set_param(h, "t0_cc_auto_set", "0 0 48 100");       /* clip0 knob0 tick48 val100 */
    hx_set_param(h, "t0_c0_ruisel", "");
    hx_set_param(h, "t0_c0_cc_focus", "0");                /* focus knob 0 */
    char buf[16384];
    int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "no state");
    HX_ASSERT(strstr(buf, "\"rui_ccmeta\":\"74,0,1,") != NULL,
              "drum track knob0 ccmeta should expose cc#74 type0 hasdata1");
    HX_ASSERT(strstr(buf, "\"rui_cc\":\"0|0:64,48:100\"") != NULL,
              "drum track focused breakpoints should emit");
    hx_destroy(h);
}

static void test_snapshot_cond_present(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    /* make track 2 the conductor, set responder fields on its active clip (clip 0) */
    hx_set_param(h, "t2_convert_to_conduct", "");
    hx_set_param(h, "t2_c0_cond_resp", "3 0");     /* track 3 not responding */
    hx_set_param(h, "t2_c0_cond_oct",  "4 1");     /* track 4 +1 oct */
    hx_set_param(h, "t2_c0_cond_lock", "1");
    hx_set_param(h, "t1_c0_ruisel", "");           /* select any track */
    char buf[16384];
    hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(strstr(buf, "\"rui_cond\":\"2:0:1;") != NULL, "condTrk/clip/lock header wrong");
    /* within-group delimiter must be commas: "resp,oct,when". */
    HX_ASSERT(strstr(buf, ";1,0,0") != NULL, "track-0 default group (resp,oct,when) wrong");
    HX_ASSERT(strstr(buf, ";0,0,0") != NULL, "track-3 resp-off group wrong");
    HX_ASSERT(strstr(buf, ";1,1,0") != NULL, "track-4 oct+1 group wrong");
    hx_destroy(h);
}

static void test_snapshot_cond_none(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");
    hx_set_param(h, "t1_c0_ruisel", "");
    char buf[16384];
    hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(strstr(buf, "\"rui_cond\":\"-1:") != NULL, "no-conductor short form wrong");
    hx_destroy(h);
}

int main(void) {
    test_snapshot_has_selected_clip_notes();
    test_snapshot_selection_switches_clip();
    test_snapshot_empty_clip_has_index();
    test_module_id_probe();
    test_snapshot_ccmeta_present();
    test_snapshot_cc_focus_emits_breakpoints();
    test_snapshot_drum_clip_has_bit();
    test_snapshot_drum_cc_automation();
    test_snapshot_cond_present();
    test_snapshot_cond_none();
    printf("PASS: remote snapshot (notes round-trip, selection switch, empty index, module_id probe, ccmeta, cc_focus, rui_cond)\n");
    return 0;
}
