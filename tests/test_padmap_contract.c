/* tests/test_padmap_contract.c — Phase 0: the tN_padmap piggyback contract.
 * The Schwung host silently drops NEW global set_param keys, so JS rides
 * active_track + dsp_inbound_enabled on the per-track padmap push, and two
 * of the trailing tokens (pad_dispatch_muted, delete_held) plus a fifth
 * (corun_left_silent) ride along after the 32 pitch tokens. Payload layout
 * read from the handler (dsp/seq8_set_param.c:5797-5861), mirrored from the
 * JS sender (ui/ui.js computePadNoteMap(), ~lines 2172-2203).
 *
 * Verified against source (not assumed from docs):
 *   - 32 space-separated pad-pitch tokens (dsp/seq8_set_param.c:5805 `for (i = 0; i < 32; i++)`),
 *     stored into inst->pad_note_map[tidx][i] (a PER-TRACK array,
 *     dsp/seq8.c:1084 `uint8_t pad_note_map[NUM_TRACKS][32]`). Sentinel for
 *     "no pitch" is 0xFF (255) — parse clamps any out-of-range/negative
 *     value to 0xFF (seq8_set_param.c:5810-5811), and JS's own 0xFF sentinel
 *     comment agrees (seq8_set_param.c:5801, ui.js:2099/2105/2126/2137).
 *   - Immediately after the 32 pitches: inst->active_track = tidx and
 *     inst->dsp_inbound_enabled = 1 are set unconditionally
 *     (seq8_set_param.c:5830-5831) — this is the "piggyback": JS only ever
 *     pushes tN_padmap for S.activeTrack, so the push itself signals which
 *     track is active.
 *   - 33rd token = pad_dispatch_muted (seq8_set_param.c:5832-5840).
 *   - 34th token = delete_held (seq8_set_param.c:5842-5850).
 *   - 35th token = corun_left_silent (seq8_set_param.c:5851-5859).
 *   NOTE vs. brief: the repo docs describe corun_left_silent as "the 36th
 *   token." Source + JS sender agree it is the 35th token (32 pitches + 3
 *   trailing flags = 35 total), not preceded by any other token. This is a
 *   docs/off-by-one discrepancy, not a structural contradiction — the same
 *   three piggyback fields (active_track, dsp_inbound_enabled,
 *   corun_left_silent) exist and are set exactly as the brief describes, so
 *   the test proceeds using the verified real position (35th, i.e. the 3rd
 *   trailing token after the 32 pitches).
 *
 * JS sender (ui/ui.js computePadNoteMap()) confirms the same shape: it
 * builds a payload of 32 space-separated pitch tokens (0-127 or 0xFF)
 * followed by ' ' + padDispatchMuted(0/1) + ' ' + deleteHeld(0/1) + ' ' +
 * corunLeftSilent(0/1), then calls
 * host_module_set_param('t' + t + '_padmap', payload) — exactly 35 tokens,
 * matching the handler's parse loop + 3 trailing reads. */
#include "harness.h"

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* --- Case 1: full realistic payload on track 3 --- */
    /* 32 pitches 60..91; trailing tokens pinned pdm=1 dh=0 corun=1 (opposite
     * polarities from case 2) so a bridge that dropped or reordered tokens
     * 33-35 cannot pass by matching calloc defaults. */
    const char *payload1 =
        "60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 "
        "76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 "
        "1 0 1";  /* pdm dh corun */

    hx_set_param(h, "t3_padmap", payload1);

    HX_ASSERT(inst->active_track == 3, "padmap did not set active_track");
    HX_ASSERT(inst->dsp_inbound_enabled == 1, "padmap did not enable inbound");
    HX_ASSERT(inst->pad_note_map[3][0]  == 60, "first pad pitch mismatch");
    HX_ASSERT(inst->pad_note_map[3][31] == 91, "last (32nd) pad pitch mismatch");
    HX_ASSERT(inst->pad_dispatch_muted == 1, "pad_dispatch_muted not set by token 33");
    HX_ASSERT(inst->delete_held == 0, "delete_held should be clear (token 34 = 0)");
    HX_ASSERT(inst->corun_left_silent == 1, "corun_left_silent not set by trailing token");

    /* --- Case 2: mostly-0xFF payload, opposite trailing polarities --- */
    /* All 32 pads unmapped (0xFF/255); pdm=0, dh=1, corun=0 flips every
     * trailing token relative to case 1, pinning all three positions. */
    const char *payload2 =
        "255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 "
        "255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 255 "
        "0 1 0";  /* pdm dh corun */

    hx_set_param(h, "t3_padmap", payload2);

    HX_ASSERT(inst->active_track == 3, "padmap (2nd push) did not keep active_track");
    HX_ASSERT(inst->dsp_inbound_enabled == 1, "padmap (2nd push) did not keep inbound enabled");
    HX_ASSERT(inst->pad_note_map[3][0]  == 0xFF, "first pad should be unmapped sentinel (0xFF)");
    HX_ASSERT(inst->pad_note_map[3][31] == 0xFF, "last pad should be unmapped sentinel (0xFF)");
    HX_ASSERT(inst->pad_dispatch_muted == 0, "pad_dispatch_muted not cleared by token 33 = 0");
    HX_ASSERT(inst->delete_held == 1, "delete_held not set by token 34");
    HX_ASSERT(inst->corun_left_silent == 0, "corun_left_silent not cleared by trailing token 0");

    hx_destroy(h);
    printf("PASS: tN_padmap piggyback + corun token contract\n");
    return 0;
}
