/* tests/test_smoke.c — foundation smoke test. Exercises all four
 * observability surfaces of the native davebox DSP harness:
 *   1. param round-trip   (state_full serialize is byte-stable across reload)
 *   2. time advance       (hx_render)
 *   3. MIDI capture        (drive the live-pad path so the DSP emits MIDI)
 *   4. state serialize/restore (folded into #1; state_load -> re-serialize)
 */
#include "harness.h"
#include <unistd.h>

int main(void) {
    /* --- create --- */
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h != NULL, "hx_create returned NULL");

    /* --- param set (a long-grandfathered global key; see dsp/CLAUDE.md) ---
     * "bpm" sets inst->state_dirty=1 (seq8_set_param.c:854). The state_full
     * get_param ONLY returns a payload while state_dirty is set
     * (seq8.c:9366) — it returns "" for clean state so JS pollDSP won't
     * clobber the on-disk file with a stale snapshot. So every state_full
     * read in this test must be preceded by a dirty-marking set_param. */
    hx_set_param(h, "bpm", "120");

    /* --- param read-back of a serialization key --- */
    char buf[65536];
    int n = hx_get_param(h, "state_full", buf, (int)sizeof(buf));
    HX_ASSERT(n > 0, "get_param state_full returned no data");

    /* --- state round-trip: serialize -> restore -> re-serialize ---
     * NOTE on the restore mechanism: the "state_load" set_param does NOT
     * parse its value as state JSON. Its `val` is a UUID used to build a
     * file path (seq8_set_param.c:1009-1011), then it resets in-memory state
     * and calls seq8_load_state(inst), which fopen()s that path
     * (seq8.c:1782-1784). So a faithful off-device round-trip writes the
     * serialized blob to a real file and feeds it back through the genuine
     * seq8_load_state parser — exercising the actual restore code, not a
     * no-op. (Passing the blob directly as state_load's val just builds a
     * bogus path and silently resets to defaults — that was the original
     * baseline's incorrect assumption.) We use white-box access to point
     * inst->state_path at a temp file (the harness #includes seq8.c, so the
     * instance type and seq8_load_state are visible). */
    char saved[65536];
    HX_ASSERT((size_t)n < sizeof(saved), "state_full larger than buffer");
    memcpy(saved, buf, (size_t)n);
    saved[n] = '\0';

    char tmp_path[256];
    snprintf(tmp_path, sizeof(tmp_path), "/tmp/hx_smoke_state_%d.json", (int)getpid());
    FILE *wf = fopen(tmp_path, "w");
    HX_ASSERT(wf != NULL, "could not open temp state file for round-trip");
    HX_ASSERT(fwrite(saved, 1, (size_t)n, wf) == (size_t)n, "temp state write short");
    fclose(wf);

    seq8_instance_t *inst = (seq8_instance_t *)h->inst;   /* white-box */
    strncpy(inst->state_path, tmp_path, sizeof(inst->state_path) - 1);
    inst->state_path[sizeof(inst->state_path) - 1] = '\0';
    seq8_load_state(inst);                                 /* genuine restore */
    remove(tmp_path);

    /* seq8_load_state does not set state_dirty, and the state_full get_param
     * only emits a payload while state_dirty is set (seq8.c:9366) — it
     * returns "" for clean state so JS pollDSP won't clobber the on-disk file
     * with a stale snapshot. Re-mark dirty with an idempotent bpm write (same
     * value, no content change) before reading state_full again. */
    hx_set_param(h, "bpm", "120");
    char buf2[65536];
    int n2 = hx_get_param(h, "state_full", buf2, (int)sizeof(buf2));
    HX_ASSERT(n2 > 0, "second get_param state_full returned no data");
    HX_ASSERT(n2 == n && memcmp(buf, buf2, (size_t)n) == 0,
              "state_full not stable across save/load round-trip");

    /* --- MIDI in + time advance + capture ---
     * The DSP's on_midi (seq8.c:6947) is gated for live pad input:
     *   - source must be INTERNAL (0): EXTERNAL is rejected at seq8.c:7053;
     *   - the note number must be a pad note in [68,99] (seq8.c:7055);
     *   - inst->dsp_inbound_enabled must be 1 (seq8.c:7067), and the pad must
     *     map to a real pitch (!=0xFF) via pad_note_map.
     * The "tN_padmap" set_param (seq8_set_param.c:5673) is the single command
     * that arms all of this: it fills pad_note_map[t], sets active_track=t,
     * and flips dsp_inbound_enabled=1 (seq8.c:5706-5707). A bare external
     * note-on (the naive path) never emits — hence we drive the real live
     * path here. Track 0 defaults to melodic + ROUTE_MOVE (seq8.c:1061), so
     * pfx_note_on injects via midi_inject_to_move (seq8.c:2741-2744), which
     * the stub captures as HX_MIDI_INJECT. */
    hx_clear_capture(h);

    /* Map all 32 pads of track 0 to chromatic pitches 60..91 and arm the
     * live-input path. Pad index = note-68, so pad 0 (note 68) -> pitch 60. */
    hx_set_param(h, "t0_padmap",
                 "60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 "
                 "76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91");

    uint8_t note_on[3]  = { 0x90, 68, 100 };  /* internal pad note (padIdx 0) */
    uint8_t note_off[3] = { 0x80, 68, 0 };
    hx_send_midi(h, note_on,  3, MOVE_MIDI_SOURCE_INTERNAL);
    hx_render(h, 8);                            /* time-advance surface */
    hx_send_midi(h, note_off, 3, MOVE_MIDI_SOURCE_INTERNAL);
    hx_render(h, 4);

    int total = hx_stub_event_count();
    if (total == 0) {
        hx_dump_midi(h);
        fprintf(stderr, "--- DSP log ---\n%s\n", hx_stub_log_text());
    }
    HX_ASSERT(total > 0, "expected DSP to emit MIDI for a live pad note-on");
    /* The pad note resolves to pitch 60; track 0 routes to Move (inject). */
    HX_ASSERT(hx_count_midi(h, HX_MIDI_INJECT) > 0,
              "expected note emitted via midi_inject_to_move (ROUTE_MOVE)");
    HX_ASSERT(hx_seen_note_on(h, 0, 60),
              "expected a note-on for resolved pitch 60 on channel 0");

    hx_destroy(h);
    printf("PASS: smoke (create, param round-trip, state restore, MIDI capture)\n");
    return 0;
}
