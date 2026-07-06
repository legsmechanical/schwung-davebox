/* A pad held while unmuted must still release when pad_dispatch_muted is set
 * mid-hold (audit dsp-midi-out-2). JS sets pad_dispatch_muted for modal
 * gestures (Shift+bottom-row track shortcut, session view, knob touch, etc.)
 * to suppress NEW pad dispatch. But on_midi's note-off branch early-returned
 * on the flag BEFORE calling live_note_off, so releasing a pad that was
 * pressed before the flag was set stranded the sounding voice — a hung note
 * until panic/stop. The flag's intent is to gate new dispatch, not to strand
 * already-sounding voices (mirrors the deliberate held-pitch recovery earlier
 * in the branch, "so a now-unmapped pad still releases").
 *
 * Faithful flag drive: JS only sets pad_dispatch_muted via the tN_padmap
 * trailing token (33rd token; the Schwung host drops standalone module-defined
 * globals, so it piggybacks on the padmap push). We mirror that exactly —
 * re-push the SAME map with a trailing " 1". Re-pushing rewrites pad_note_map
 * to identical values and leaves pad_live_pitch untouched, matching what
 * computePadNoteMap does during a modal gesture.
 *
 * Covers both dispatch paths that share on_midi's note-off branch:
 *   - t1 melodic  (live_note_off -> pfx_note_off_imm)
 *   - t0 drum, left-half lane pad (live_note_off -> drum_lane_note_off_imm)
 * Right-half drum vel-zone pads use drum_pad_event's own dispatch, which the
 * flag skips entirely on both press and release (pre-existing, intentional);
 * they are not the stranding path this fix addresses.
 */
#include "harness.h"

/* Inject-kind only: live pad dispatch on ROUTE_MOVE tracks delivers via
 * midi_inject_to_move (HX_MIDI_INJECT). Match by note number regardless of
 * channel — nothing else in these scenarios touches these pitches. */
static int seen_inject_note_off(int note) {
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if (e->kind != HX_MIDI_INJECT) continue;
        uint8_t st = e->bytes[1];
        if (e->bytes[2] != (uint8_t)note) continue;
        if ((st & 0xF0) == 0x80) return 1;
        if ((st & 0xF0) == 0x90 && e->bytes[3] == 0) return 1;
    }
    return 0;
}

static int seen_inject_note_on(int note) {
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if (e->kind != HX_MIDI_INJECT) continue;
        uint8_t st = e->bytes[1];
        if ((st & 0xF0) == 0x90 && e->bytes[2] == (uint8_t)note && e->bytes[3] > 0)
            return 1;
    }
    return 0;
}

/* Internal pad event helpers. Pad index p -> note 68+p. */
static void pad_on(hx_t *h, int padIdx, int vel) {
    uint8_t m[3] = { 0x90, (uint8_t)(68 + padIdx), (uint8_t)vel };
    hx_send_midi(h, m, 3, MOVE_MIDI_SOURCE_INTERNAL);
}
static void pad_off(hx_t *h, int padIdx) {
    uint8_t m[3] = { 0x80, (uint8_t)(68 + padIdx), 0 };
    hx_send_midi(h, m, 3, MOVE_MIDI_SOURCE_INTERNAL);
}

/* t1 chromatic map (pad p -> pitch 60+p). Trailing token variants set the
 * pad_dispatch_muted flag exactly as JS's computePadNoteMap push does. */
#define MEL_MAP \
    "60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 " \
    "76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91"

/* t0 drum map: pad p -> pitch 36+p, so pad 0 -> lane 0 note (36), pad 1 ->
 * lane 1 note (37). Pads 0/1 are left-half (col 0/1) -> drum_pad_event returns
 * 0 and they fall through to on_midi's shared note-off branch. */
#define DRUM_MAP \
    "36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 " \
    "52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67"

static void scn_melodic(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "melodic create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    HX_ASSERT(inst->tracks[1].pad_mode != PAD_MODE_DRUM, "t1 expected melodic");

    /* Arm live input on t1 (unmuted). */
    hx_set_param(h, "t1_padmap", MEL_MAP);

    /* Press+hold pad 0 -> pitch 60. Voice sounds. */
    pad_on(h, 0, 100);
    hx_render(h, 8);
    HX_ASSERT(seen_inject_note_on(60), "melodic: held note-on 60 not emitted");

    /* JS sets pad_dispatch_muted mid-hold via a padmap re-push (same map). */
    hx_set_param(h, "t1_padmap", MEL_MAP " 1");
    HX_ASSERT(inst->pad_dispatch_muted, "melodic: pad_dispatch_muted not set");

    /* Release the held pad. The voice MUST be released even under the flag. */
    hx_clear_capture(h);
    pad_off(h, 0);
    hx_render(h, 8);
    if (!seen_inject_note_off(60)) {
        hx_dump_midi(h);
        fprintf(stderr, "FAIL: melodic held-pad release stranded under "
                        "pad_dispatch_muted (audit dsp-midi-out-2)\n");
        exit(1);
    }

    /* Suppression still holds: a NEW press under the flag must not dispatch. */
    hx_clear_capture(h);
    pad_on(h, 1, 100);          /* pad 1 -> pitch 61 */
    hx_render(h, 8);
    HX_ASSERT(!seen_inject_note_on(61),
              "melodic: new note-on 61 must be suppressed while flag set");

    hx_destroy(h);
    printf("PASS: padmute_release melodic\n");
}

static void scn_drum(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "drum create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    /* t0 defaults to drum mode with clips allocated (create_instance). */
    HX_ASSERT(inst->tracks[0].pad_mode == PAD_MODE_DRUM, "t0 expected drum");
    HX_ASSERT(inst->tracks[0].drum_clips[inst->tracks[0].active_clip],
              "t0 drum clips not allocated");

    hx_set_param(h, "t0_padmap", DRUM_MAP);

    /* Hold left-half lane pad 0 -> lane 0 note (36). Voice sounds. */
    pad_on(h, 0, 100);
    hx_render(h, 8);
    HX_ASSERT(seen_inject_note_on(36), "drum: held lane note-on 36 not emitted");

    hx_set_param(h, "t0_padmap", DRUM_MAP " 1");
    HX_ASSERT(inst->pad_dispatch_muted, "drum: pad_dispatch_muted not set");

    hx_clear_capture(h);
    pad_off(h, 0);
    hx_render(h, 8);
    if (!seen_inject_note_off(36)) {
        hx_dump_midi(h);
        fprintf(stderr, "FAIL: drum held-lane-pad release stranded under "
                        "pad_dispatch_muted (audit dsp-midi-out-2)\n");
        exit(1);
    }

    /* Suppression: new lane pad 1 -> note 37 must not dispatch under flag. */
    hx_clear_capture(h);
    pad_on(h, 1, 100);
    hx_render(h, 8);
    HX_ASSERT(!seen_inject_note_on(37),
              "drum: new lane note-on 37 must be suppressed while flag set");

    hx_destroy(h);
    printf("PASS: padmute_release drum\n");
}

int main(void) {
    scn_melodic();
    scn_drum();
    printf("PASS: padmute_release (held voices release under pad_dispatch_muted)\n");
    return 0;
}
