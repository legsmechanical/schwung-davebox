/* transport restart while a ROUTE_MOVE track has queued note-offs in its
 * pfx event queue (MIDI DLY echo offs, swing-deferred offs) must still
 * deliver them (audit dsp-midi-out-1). The restart branches re-pegged queued
 * events to the PRE-reset sample_counter, then zeroed the counter — so
 * pfx_q_fire saw fire_at >> now and the off never fired (send_panic
 * deliberately skips the ROUTE_MOVE sweep), leaving a stuck Move voice.
 * The count-in exit path (seq8.c ~11138) re-pegs fire_at=0 for exactly this
 * hazard; restart/restart_at must do the same. */
#include "harness.h"

/* Inject-kind only: ROUTE_MOVE delivers via midi_inject_to_move, and the
 * panic sweep (which skips ROUTE_MOVE) emits offs on the other channels —
 * kind-filtering keeps those from masking a stranded queued off. */
static int seen_note_off(int ch, int note) {
    for (int i = 0; i < hx_stub_event_count(); i++) {
        const hx_midi_event *e = hx_stub_event(i);
        if (e->kind != HX_MIDI_INJECT) continue;
        uint8_t st = e->bytes[1];
        if ((st & 0x0F) != ch) continue;
        if (e->bytes[2] != (uint8_t)note) continue;
        if ((st & 0xF0) == 0x80) return 1;
        if ((st & 0xF0) == 0x90 && e->bytes[3] == 0) return 1;
    }
    return 0;
}

static void queued_off_survives(hx_t *h, seq8_instance_t *inst,
                                const char *transport_val) {
    play_fx_t *fx = &inst->tracks[0].pfx;

    hx_render(h, 24);   /* advance pfx sample_counter well past zero */
    HX_ASSERT(fx->sample_counter > 0, "sample_counter did not advance");

    /* Pending queued note-off, as a MIDI DLY echo off would be: scheduled
     * for the (now unreachable) far future relative to the old counter. */
    pfx_q_insert(fx, fx->sample_counter + 1000000, 0x80, 60, 0, 0);

    hx_clear_capture(h);
    hx_set_param(h, "transport", transport_val);
    hx_render(h, 8);    /* post-reset: re-pegged offs must fire promptly */

    if (!seen_note_off(0, 60)) {
        hx_dump_midi(h);
        fprintf(stderr, "FAIL: queued note-off stranded after transport '%s'\n",
                transport_val);
        exit(1);
    }
    HX_ASSERT(fx->event_count == 0, "event queue not drained after restart");
}

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;

    /* Track 0 defaults to melodic + ROUTE_MOVE — the route whose queued
     * offs restart must preserve (other routes drop their whole queue). */
    HX_ASSERT(inst->tracks[0].pfx.route == ROUTE_MOVE, "t0 not ROUTE_MOVE");

    queued_off_survives(h, inst, "restart");
    queued_off_survives(h, inst, "restart_at:0:0:-1");

    hx_destroy(h);
    printf("PASS: restart/restart_at deliver queued ROUTE_MOVE note-offs\n");
    return 0;
}
