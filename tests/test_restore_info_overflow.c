/* last_restore_info[64] overflow on row-op undo/redo (audit dsp-memory-1).
 * row_cut snapshots 16 clips (undo_begin_row_pair) + 2 drum rows; the
 * undo_restore/redo_restore info-string builders accumulated raw snprintf
 * return values ("m" + 16x" t 14/15" + 2x" DR n" -> ~93 intended chars), so
 * once _off passed 64 the size argument underflowed and the writes landed in
 * the adjacent instance fields (snap_drum_eff_mute). Detect with a sentinel. */
#include "harness.h"

static void fill_sentinel(seq8_instance_t *inst) {
    memset(inst->snap_drum_eff_mute, 0xAB, sizeof(inst->snap_drum_eff_mute));
}

static void check_sentinel(seq8_instance_t *inst, const char *ctx) {
    const uint8_t *p = (const uint8_t *)inst->snap_drum_eff_mute;
    size_t i;
    for (i = 0; i < sizeof(inst->snap_drum_eff_mute); i++)
        if (p[i] != 0xAB) {
            fprintf(stderr, "FAIL: %s corrupted snap_drum_eff_mute at +%zu\n", ctx, i);
            exit(1);
        }
    HX_ASSERT(memchr(inst->last_restore_info, 0,
                     sizeof(inst->last_restore_info)) != NULL,
              "last_restore_info not NUL-terminated in bounds");
}

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* Two-digit rows maximize the entry length (" 7 15" = 5 chars). */
    hx_set_param(h, "row_cut", "14 15");

    fill_sentinel(inst);
    hx_set_param(h, "undo_restore", "1");
    check_sentinel(inst, "undo_restore");

    fill_sentinel(inst);
    hx_set_param(h, "redo_restore", "1");
    check_sentinel(inst, "redo_restore");

    /* And back again — undo after redo re-runs the undo-side builder. */
    fill_sentinel(inst);
    hx_set_param(h, "undo_restore", "1");
    check_sentinel(inst, "undo_restore (2nd)");

    hx_destroy(h);
    printf("PASS: row-op undo/redo restore-info stays in bounds\n");
    return 0;
}
