/* tests/test_engine_goldens.c — Phase 0: drive scripted clips through
 * render_block and freeze the ordered MIDI capture as goldens. The Phase 3
 * engine split (pfx/arp/drum/looper out of render_block) must reproduce every
 * byte of these captures.
 *
 * Regenerate intentionally with UPDATE_GOLDENS=1 (diff before commit!).
 * Never hand-edit a golden — the compare is exact including newlines.
 * Line format: "kind cable|CIN status d1 d2" (all hex except kind).
 * Scenarios avoid rand/iter/ratchet/trig-cond steps — deterministic by design
 * (arp styles are Up=1, never Rnd 8/9).
 *
 * Harness realities baked into these scenarios (all verified against
 * dsp/seq8.c, not assumed):
 *
 *  - TRACK 0 IS DRUM BY DEFAULT. create_instance forces track 0 to
 *    PAD_MODE_DRUM when no track loaded as drum (seq8.c:6843, mirrors the JS
 *    first-run default). So melodic scenarios drive track 1 (tracks 1..7
 *    default to PAD_MODE_MELODIC_SCALE); the drum scenario drives track 0.
 *
 *  - PLAY TRIGGER. A fresh track has will_relaunch=0, so a bare
 *    transport=play leaves clip_playing=0 and nothing fires. We use the real
 *    "play_focus:T:0" set_param (seq8_set_param.c:448): it arms track T's clip
 *    (active_clip=0 + will_relaunch=1) then falls through the normal play path,
 *    so clip_playing flips to 1 in the same buffer. A genuine, deterministic
 *    launch — no white-box poke.
 *
 *  - CAPTURE EXCLUDES TRANSPORT-STOP TEARDOWN. check_golden() runs after the
 *    render, BEFORE transport=stop. Rationale: ext_transport_stop() calls
 *    send_panic(), which emits 2048 uniform all-notes-off (128 notes x 16
 *    channels) — transport teardown that lives in set_param, not render_block,
 *    and would bury the engine emission these goldens exist to freeze. stop is
 *    still issued afterward for clean teardown; it just isn't in the snapshot.
 *
 *  - ARPS END ON AN UNPAIRED NOTE-ON. SEQ ARP / TRACK ARP hold their input and
 *    keep re-triggering; at any render cutoff the currently-sounding note has
 *    no note-off yet. That trailing note-on is expected and deterministic.
 *
 *  - SWING IS A SAMPLE-DOMAIN DELAY, INVISIBLE TO A BYTE-ONLY CAPTURE. The
 *    capture records packet bytes + order, not sample offsets, and swing does
 *    not reorder single notes — so swing_offbeat is byte-identical to a
 *    straight grid. The golden still locks the ordered emission (a Phase 3
 *    split that dropped/reordered a note would fail); it just cannot show the
 *    timing shift. Kept per the task's scenario list, documented here. */
#include "harness.h"
#include <stdlib.h>

/* Track 0's route is ROUTE_MOVE -> emissions are HX_MIDI_INJECT (kind 2);
 * so are tracks 1..7 by default. Every musical note below is inject-kind. */

static void dump_capture(FILE *f) {
    int i;
    for (i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        /* bytes[0] (USB cable|CIN) included so a Phase 3 split that re-emits
         * on a different cable fails, not just payload changes. */
        fprintf(f, "%d %02X %02X %02X %02X\n", (int)e->kind,
                e->bytes[0], e->bytes[1], e->bytes[2], e->bytes[3]);
    }
}

static void check_golden(const char *name) {
    char path[256];
    snprintf(path, sizeof(path), "tests/goldens/%s.txt", name);
    if (getenv("UPDATE_GOLDENS")) {
        FILE *f = fopen(path, "w");
        HX_ASSERT(f, "cannot write golden");
        dump_capture(f); fclose(f);
        fprintf(stderr, "  [updated golden %s]\n", path);
        return;
    }
    FILE *f = fopen(path, "r");
    if (!f) { fprintf(stderr, "FAIL: missing golden %s (run UPDATE_GOLDENS=1 once)\n", path); exit(1); }
    char want[64]; int i = 0;
    while (fgets(want, sizeof(want), f)) {
        const hx_midi_event *e = hx_stub_event(i);
        char got[64];
        if (!e) { fprintf(stderr, "FAIL: %s: capture shorter than golden (line %d)\n", name, i + 1); exit(1); }
        snprintf(got, sizeof(got), "%d %02X %02X %02X %02X\n", (int)e->kind,
                 e->bytes[0], e->bytes[1], e->bytes[2], e->bytes[3]);
        if (strcmp(want, got)) {
            fprintf(stderr, "FAIL: %s line %d: want %s got %s\n", name, i + 1, want, got);
            exit(1);
        }
        i++;
    }
    fclose(f);
    if (i != hx_stub_event_count()) {
        fprintf(stderr, "FAIL: %s: capture longer than golden (%d vs %d)\n",
                name, hx_stub_event_count(), i);
        exit(1);
    }
}

/* Clear capture, launch track `focus`'s active clip, run the transport for
 * n_blocks, snapshot the golden, then stop (teardown, not captured). */
static void play_render_check(hx_t *h, int focus, int n_blocks, const char *name) {
    char pf[24];
    snprintf(pf, sizeof(pf), "play_focus:%d:0", focus);
    hx_clear_capture(h);
    hx_set_param(h, "transport", pf);
    hx_render(h, n_blocks);
    check_golden(name);
    hx_set_param(h, "transport", "stop");
}

/* The 32-pad chromatic map used to arm a melodic track's live-input path:
 * pad index p (note 68+p) -> pitch 60+p. */
#define PADMAP_CHROMATIC \
    "60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 " \
    "76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91"

/* Scenario 1: melodic_basic — track 1 (melodic), c0 steps 0/4/8/12 cycling
 * pitches 60/64/67/60. 640 blocks = one full 16-step bar -> 4 on/off pairs. */
static void scn_melodic_basic(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "melodic_basic create failed");
    hx_set_param(h, "t1_c0_step_0_toggle",  "60 100");
    hx_set_param(h, "t1_c0_step_4_toggle",  "64 90");
    hx_set_param(h, "t1_c0_step_8_toggle",  "67 80");
    hx_set_param(h, "t1_c0_step_12_toggle", "60 100");
    play_render_check(h, 1, 640, "melodic_basic");
    hx_destroy(h);
}

/* Scenario 2: drum_basic — track 0 (drum by default), lane 0 @ step 0 and
 * lane 1 @ step 4. Pitches DRUM_BASE_NOTE(36)+lane. 400 blocks -> 2 pairs. */
static void scn_drum_basic(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "drum_basic create failed");
    hx_set_param(h, "t0_l0_step_0_toggle", "110");
    hx_set_param(h, "t0_l1_step_4_toggle", "70");
    play_render_check(h, 0, 400, "drum_basic");
    hx_destroy(h);
}

/* Scenario 3: swing_offbeat — track 1, swing 60%, steps 0 (onbeat) and 1
 * (offbeat, swung). Swing is a sample delay invisible to byte-capture; the
 * golden freezes the ordered emission. */
static void scn_swing_offbeat(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "swing_offbeat create failed");
    hx_set_param(h, "swing_amt", "60");
    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c0_step_1_toggle", "62 100");
    /* 250 blocks: only steps 0-1 carry notes; ample margin past both,
     * well short of the bar wrap re-triggering step 0. */
    play_render_check(h, 1, 250, "swing_offbeat");
    hx_destroy(h);
}

/* Scenario 4: seq_arp — SEQ ARP (per-clip pfx, key seq_arp_style via
 * tN_cC_pfx_set). A 3-note chord (60/64/67) held one bar (gate 384) feeds the
 * arp buffer; style 1 = Up arpeggiates 60,64,67,60,64,67... 400 blocks. */
static void scn_seq_arp(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "seq_arp create failed");
    hx_set_param(h, "t1_c0_step_0_add",  "60 0 100 64 0 100 67 0 100");
    hx_set_param(h, "t1_c0_step_0_gate", "384");            /* hold the chord */
    hx_set_param(h, "t1_c0_pfx_set",     "seq_arp_style 1"); /* Up */
    play_render_check(h, 1, 400, "seq_arp");
    hx_destroy(h);
}

/* Scenario 5: track_arp (tarp) — TRACK ARP over LIVE held notes (key
 * tN_tarp_style; serializes as t1_tast). Arm the live-input path with a
 * padmap, hold 3 internal pad notes (pitches 60/64/67), style 1 = Up. TARP
 * runs even with transport stopped (free-running arp clock), so no play
 * needed — render directly. */
static void scn_track_arp(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "track_arp create failed");
    hx_set_param(h, "t1_padmap", PADMAP_CHROMATIC);   /* arms dsp_inbound + active_track */
    hx_set_param(h, "t1_tarp_style", "1");            /* Up; flips tarp_on=1 */
    uint8_t n0[3] = { 0x90, 68, 100 };  /* pad 0  -> pitch 60 */
    uint8_t n1[3] = { 0x90, 72, 100 };  /* pad 4  -> pitch 64 */
    uint8_t n2[3] = { 0x90, 75, 100 };  /* pad 7  -> pitch 67 */
    hx_send_midi(h, n0, 3, MOVE_MIDI_SOURCE_INTERNAL);
    hx_send_midi(h, n1, 3, MOVE_MIDI_SOURCE_INTERNAL);
    hx_send_midi(h, n2, 3, MOVE_MIDI_SOURCE_INTERNAL);
    hx_clear_capture(h);
    hx_render(h, 400);
    check_golden("track_arp");
    hx_destroy(h);
}

/* Scenario 6: midi_delay — MIDI DLY (per-clip pfx). Single note 60 @ step 0;
 * delay_level 100 + delay_repeats 3 + delay_time 3 -> the note plus 3 echoes
 * (each at reduced velocity). 400 blocks. */
static void scn_midi_delay(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "midi_delay create failed");
    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c0_pfx_set", "delay_level 100");
    hx_set_param(h, "t1_c0_pfx_set", "delay_repeats 3");
    hx_set_param(h, "t1_c0_pfx_set", "delay_time 3");
    play_render_check(h, 1, 400, "midi_delay");
    hx_destroy(h);
}

/* Scenario 7: looper — the global MIDI looper (dsp/seq8.c ~2769-3295), which
 * the Phase 3 seq8_looper.c split must reproduce byte-for-byte. Track 1 is
 * enrolled in the looper (t1_track_looper); looper_sync=0 makes looper_arm
 * enter CAPTURING immediately (default sync=1 would wait for a bar boundary).
 * A live pad note (pitch 60) is captured at loop pos 0, released a few ticks
 * later, then the window wraps to LOOPING and replays the captured on/off every
 * cycle. Capture emissions (live pass-through) and replay emissions are both
 * ROUTE_MOVE inject (kind 2). Transport stays STOPPED: looper_tick runs on the
 * free-running clock (seq8_stopped_*), same as track_arp — no play needed.
 *
 * RNG-free / deterministic: no perf_mods_active (perf_apply is a pure
 * pass-through), live notes injected at fixed points between fixed render
 * counts, integer free-run clock (tick_delta/tick_threshold). The 8-tick
 * window fills after ~15 blocks (0.557 ticks/block at 120 BPM); 48 total blocks
 * cover the capture cycle plus ~2 replay cycles.
 *
 * GOLDEN LINE 2 IS A GENUINE SPURIOUS NOTE-OFF, not a test bug: looper_arm's
 * handler internally calls looper_stop() (seq8_set_param.c ~1158), which sets
 * looper_pending_silence; that deferred flag drains on the first looper_tick
 * AFTER the live note-on is already captured/sounding (seq8.c ~3004), so the
 * safety-net sweep emits an extra off for pitch 60 right after line 1's on.
 * Real, deterministic DSP behavior — a Phase 3 split must reproduce it too. */
static void scn_looper(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "looper create failed");
    hx_set_param(h, "t1_padmap", PADMAP_CHROMATIC); /* arm live input on track 1 */
    hx_set_param(h, "t1_track_looper", "1");         /* enroll track 1 in the looper */
    hx_set_param(h, "looper_sync", "0");             /* arm -> CAPTURING immediately */
    hx_set_param(h, "looper_arm", "8");              /* 8-master-tick capture window */
    uint8_t on[3]  = { 0x90, 68, 100 };  /* pad 0 -> pitch 60 */
    uint8_t off[3] = { 0x80, 68, 0 };
    hx_clear_capture(h);
    hx_send_midi(h, on, 3, MOVE_MIDI_SOURCE_INTERNAL);  /* captured at pos 0 (+ live emit) */
    hx_render(h, 4);                                     /* advance a few ticks */
    hx_send_midi(h, off, 3, MOVE_MIDI_SOURCE_INTERNAL); /* captured mid-window (+ live emit) */
    hx_render(h, 44);                                    /* wrap to LOOPING + replay cycles */
    check_golden("looper");
    hx_destroy(h);
}

int main(void) {
    scn_melodic_basic();
    scn_drum_basic();
    scn_swing_offbeat();
    scn_seq_arp();
    scn_track_arp();
    scn_midi_delay();
    scn_looper();
    printf("PASS: engine emission goldens (melodic/drum/swing + seq_arp/track_arp/midi_delay/looper)\n");
    return 0;
}
