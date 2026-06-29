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

int main(void) {
    test_add();
    test_del();
    test_move();
    test_resize();
    test_vel();
    test_batch();
    test_clamp_and_bounds();
    printf("PASS: remote note edit (add/del/move/resize/vel/batch/clamp)\n");
    return 0;
}
