/* tests/test_remote_note_edit.c — note-centric edit ops for the remote piano roll.
 *
 * The piano roll edits notes[] directly (davebox's canonical playback model) via
 * new per-track keys, then re-derives steps[] so the on-device LED/step view stays
 * in sync. Track 0 defaults to DRUM, so melodic tests use track 1.
 *
 * Keys under test (selected clip = whatever; ops name track+clip explicitly):
 *   tN_cC_note_add    "tick pitch vel gate"
 *   tN_cC_note_del    "tick pitch"
 *   tN_cC_note_move   "oldtick oldpitch newtick newpitch"
 *   tN_cC_note_resize "tick pitch newgate"
 *   tN_cC_note_vel    "tick pitch newvel"
 *   tN_cC_notes_op    "<op> args; <op> args; ..."   (a/d/m/r/v)
 */
#include "harness.h"

/* select t1c0 and read the snapshot's rui_notes field into `out` (caller buf). */
static void snap_notes(hx_t *h, char *out, int out_len) {
    hx_set_param(h, "t1_c0_ruisel", "");
    char buf[8192];
    hx_get_param(h, "state", buf, (int)sizeof(buf));
    const char *k = strstr(buf, "\"rui_notes\":\"");
    out[0] = '\0';
    if (!k) return;
    k += strlen("\"rui_notes\":\"");
    const char *e = strchr(k, '"');
    if (!e) return;
    int n = (int)(e - k); if (n >= out_len) n = out_len - 1;
    memcpy(out, k, (size_t)n); out[n] = '\0';
}

static void test_add(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_note_add", "48 65 80 24");
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "48:65:80:24;") != NULL, "added note 48:65:80:24 missing");
    /* steps[] sync: tick 48 @ tps 24 = step 2 → t1_c0_steps[2]=='1' */
    char steps[300]; hx_get_param(h, "t1_c0_steps", steps, (int)sizeof(steps));
    HX_ASSERT(steps[2] == '1', "step 2 not set after note_add");
    hx_destroy(h);
}

static void test_del(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_note_add", "48 65 80 24");
    hx_set_param(h, "t1_c0_note_del", "48 65");
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "48:65:") == NULL, "note still present after note_del");
    char steps[300]; hx_get_param(h, "t1_c0_steps", steps, (int)sizeof(steps));
    HX_ASSERT(steps[2] == '0', "step 2 still set after note_del");
    hx_destroy(h);
}

static void test_move(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_note_add", "48 65 80 24");
    hx_set_param(h, "t1_c0_note_move", "48 65 72 67");
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "72:67:80:24;") != NULL, "moved note 72:67 missing");
    HX_ASSERT(strstr(notes, "48:65:") == NULL, "old note 48:65 still present after move");
    hx_destroy(h);
}

static void test_resize(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_note_add", "48 65 80 24");
    hx_set_param(h, "t1_c0_note_resize", "48 65 60");
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "48:65:80:60;") != NULL, "gate not resized to 60");
    hx_destroy(h);
}

static void test_vel(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_note_add", "48 65 80 24");
    hx_set_param(h, "t1_c0_note_vel", "48 65 120");
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "48:65:120:24;") != NULL, "velocity not set to 120");
    hx_destroy(h);
}

static void test_batch(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_notes_op", "a 0 60 100 24; a 24 64 90 24; a 48 67 110 24");
    hx_set_param(h, "t1_c0_notes_op", "d 24 64; m 0 60 0 62; v 48 67 70");
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "0:62:100:24;") != NULL, "batch move 0:60->0:62 failed");
    HX_ASSERT(strstr(notes, "24:64:") == NULL, "batch delete 24:64 failed");
    HX_ASSERT(strstr(notes, "48:67:70:110;") != NULL || strstr(notes, "48:67:70:") != NULL,
              "batch vel 48:67->70 failed");
    hx_destroy(h);
}

static void test_clamp_and_bounds(void) {
    hx_t *h = hx_create(NULL);
    /* out-of-range pitch/vel clamp; tick beyond clip wraps/clamps but stays valid */
    hx_set_param(h, "t1_c0_note_add", "0 200 200 0");   /* pitch>127, vel>127, gate<1 */
    char notes[4096]; snap_notes(h, notes, sizeof(notes));
    HX_ASSERT(strstr(notes, "0:127:127:1;") != NULL, "add did not clamp pitch/vel/gate");
    hx_destroy(h);
}

/* clip params surfaced in the snapshot reflect length + direction edits */
static void test_clip_params(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_ruisel", "");
    hx_set_param(h, "t1_c0_length", "8");
    hx_set_param(h, "t1_c0_dir", "2");
    char buf[8192]; hx_get_param(h, "state", buf, (int)sizeof(buf));
    /* rui_clip = "len:tps:ls:dir" */
    HX_ASSERT(strstr(buf, "\"rui_clip\":\"8:") != NULL, "length 8 not in snapshot");
    const char *k = strstr(buf, "\"rui_clip\":\""); HX_ASSERT(k != NULL, "no rui_clip");
    /* 4th field is dir; cheaply check ":2\"" tail of the clip field */
    HX_ASSERT(strstr(k, ":2\"") != NULL, "direction 2 not in snapshot");
    hx_destroy(h);
}

/* drum-lane grid ops + drum snapshot. A tN_lL_* write converts the track to drum
 * and allocates its drum clips (the documented auto-allocation trigger). */
static void test_drum_lane_ops(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t3_l5_note_toggle", "48 100 24");   /* add hit: lane 5, tick 48 */
    hx_set_param(h, "t3_c0_ruisel", "5");                /* select t3 (now drum), lane 5 */
    char buf[8192]; int len = hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(len > 0, "no snapshot");
    HX_ASSERT(strstr(buf, "\"rui_dlanes\":\"") != NULL, "missing rui_dlanes (drum)");
    HX_ASSERT(strstr(buf, "\"rui_dnotes\":\"") != NULL, "missing rui_dnotes (drum)");
    HX_ASSERT(strstr(buf, "5|48:100:") != NULL, "lane-5 hit not in rui_dnotes");
    HX_ASSERT(strstr(buf, "\"rui_notes\":\"\"") != NULL, "drum melodic-notes field should be empty");
    /* toggle the same cell off */
    hx_set_param(h, "t3_l5_note_toggle", "48");
    hx_get_param(h, "state", buf, (int)sizeof(buf));
    HX_ASSERT(strstr(buf, "5|48:") == NULL, "lane-5 hit not removed by toggle-off");
    hx_destroy(h);
}

/* per-clip FX params reach the selected clip's pfx and surface in rui_pfx */
static void test_clip_fx(void) {
    hx_t *h = hx_create(NULL);
    hx_set_param(h, "t1_c0_ruisel", "");
    /* tN_cC_pfx_set "key value" — set a few across the four banks */
    hx_set_param(h, "t1_c0_pfx_set", "noteFX_octave 2");
    hx_set_param(h, "t1_c0_pfx_set", "harm_interval1 7");
    hx_set_param(h, "t1_c0_pfx_set", "delay_level 90");
    hx_set_param(h, "t1_c0_pfx_set", "seq_arp_style 3");
    char buf[8192]; hx_get_param(h, "state", buf, (int)sizeof(buf));
    const char *k = strstr(buf, "\"rui_pfx\":\"");
    HX_ASSERT(k != NULL, "missing rui_pfx");
    k += strlen("\"rui_pfx\":\"");
    /* fixed order: [0]=octave [9]=harm1 [13]=delay_level [22]=arp_style */
    int v[29]; int got = 0; const char *p = k;
    for (got = 0; got < 29 && *p && *p != '"'; got++) { v[got] = atoi(p);
        while (*p && *p != ':' && *p != '"') p++; if (*p == ':') p++; }
    HX_ASSERT(got == 29, "rui_pfx did not have 29 values");
    HX_ASSERT(v[0] == 2,  "noteFX_octave (idx0) not 2");
    HX_ASSERT(v[9] == 7,  "harm_interval1 (idx9) not 7");
    HX_ASSERT(v[13] == 90, "delay_level (idx13) not 90");
    HX_ASSERT(v[22] == 3, "seq_arp_style (idx22) not 3");
    hx_destroy(h);
}

int main(void) {
    test_add();
    test_clip_params();
    test_clip_fx();
    test_drum_lane_ops();
    test_del();
    test_move();
    test_resize();
    test_vel();
    test_batch();
    test_clamp_and_bounds();
    printf("PASS: remote note edit (add/del/move/resize/vel/batch/clamp)\n");
    return 0;
}
