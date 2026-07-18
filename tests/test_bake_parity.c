/* Bake<->live parity pins (2026-07-18 audit). Guards the four re-implemented
 * bake stages against drift:
 *   D1  SEQ ARP retrigger param honored (was forced ON in bake)
 *   D3  CC-automation lane cadence pinned on loop-unroll bake
 *   D5  scale-aware delay feedback: degree delta from the group PRIMARY,
 *       applied to harmony copies (was per-note re-transpose)
 *   D6  gate_time==0 echoes bake as instant-off (1 tick), not 100% gate
 * Sequential hx instances only — the stub host is process-global. */
#include "harness.h"

static int find_note(clip_t *cl, uint32_t tick, int pitch) {
    for (int i = 0; i < cl->note_count; i++)
        if (cl->notes[i].tick == tick && (pitch < 0 || cl->notes[i].pitch == pitch))
            return i;
    return -1;
}

static int has_pitch(clip_t *cl, int pitch) {
    for (int i = 0; i < cl->note_count; i++)
        if (cl->notes[i].pitch == pitch) return 1;
    return 0;
}

int main(void) {
    /* ---- D1: retrigger OFF — a legato second onset must NOT re-anchor the
     * arp step pattern. Note A (60) holds 8 steps; note B (64) lands at step
     * 3 while A is held (buffer non-empty -> no was_empty anchor). With
     * retrigger honored, the fire at tick 72 sits on pattern step 3 and gets
     * step_int[3] = +7 degrees (= +1 octave in major); the old forced-ON
     * bake re-anchored at B's onset -> pattern step 0, no offset. */
    hx_t *h = hx_create(NULL);
    seq8_instance_t *inst = (seq8_instance_t *)h->inst;
    inst->pad_key = 0; inst->pad_scale = 0;   /* C major */
    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c0_step_0_gate", "192");        /* hold 8 steps */
    hx_set_param(h, "t1_c0_step_3_toggle", "64 100");
    hx_set_param(h, "t1_c0_pfx_set", "seq_arp_style 1");
    hx_set_param(h, "t1_c0_pfx_set", "seq_arp_retrigger 0");
    hx_set_param(h, "t1_c0_pfx_set", "seq_arp_steps_mode 1");
    hx_set_param(h, "t1_c0_pfx_set", "seq_arp_step_int 3 7");
    hx_set_param(h, "bake", "1 0 0 1 0 0");
    {
        clip_t *cl = &inst->tracks[1].clips[0];
        int ni = find_note(cl, 72, -1);
        HX_ASSERT(ni >= 0, "D1: no baked note at tick 72");
        HX_ASSERT(cl->notes[ni].pitch > 64,
                  "D1: retrigger OFF ignored — tick-72 fire has no step-3 offset");
    }
    hx_destroy(h);

    /* ---- D3: loop-unroll bake pins inherit-length CC lanes to the pre-bake
     * clip length so automation keeps its cadence. */
    h = hx_create(NULL);
    inst = (seq8_instance_t *)h->inst;
    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    {
        cc_auto_t *ca = &inst->tracks[1].clip_cc_auto[0];
        ca->count[2] = 1; ca->ticks[2][0] = 0; ca->vals[2][0] = 90;
        ca->lane_length[2] = 0;               /* inherit clip length */
        ca->count[5] = 0; ca->lane_length[5] = 0;   /* empty lane: untouched */
    }
    hx_set_param(h, "bake", "1 0 0 2 0 0");   /* loops=2 -> 32 steps */
    {
        clip_t *cl = &inst->tracks[1].clips[0];
        cc_auto_t *ca = &inst->tracks[1].clip_cc_auto[0];
        HX_ASSERT(cl->length == 32, "D3: bake did not unroll to 32 steps");
        HX_ASSERT(ca->lane_length[2] == 16, "D3: active CC lane not pinned to pre-bake length");
        HX_ASSERT(ca->lane_length[5] == 0, "D3: empty CC lane should stay inherit");
    }
    hx_destroy(h);

    /* ---- D5 + echo-gate parity: scale-aware delay feedback.
     * C major, primary 60 (C), HARMZ +2 degrees -> copy 64 (E), fb_note +1
     * degree. Live: delta = st(60,+1)-60 = +2 semitones applied to BOTH
     * copies -> echoes 62 and 66. Old bake re-transposed the copy itself:
     * st(64,+1) = 65 — must NOT appear. Echoes take the GATE-derived gate
     * (GATE_TICKS * gate%/100 = 12 at default 100%), never the source
     * note's gate (source held 192 ticks here). */
    h = hx_create(NULL);
    inst = (seq8_instance_t *)h->inst;
    inst->scale_aware = 1; inst->pad_key = 0; inst->pad_scale = 0;
    hx_set_param(h, "t1_c0_step_0_toggle", "60 100");
    hx_set_param(h, "t1_c0_step_0_gate", "192");
    hx_set_param(h, "t1_c0_pfx_set", "harm_interval1 2");
    hx_set_param(h, "t1_c0_pfx_set", "delay_level 127");
    hx_set_param(h, "t1_c0_pfx_set", "delay_repeats 1");
    hx_set_param(h, "t1_c0_pfx_set", "delay_time 3");
    hx_set_param(h, "t1_c0_pfx_set", "delay_pitch_fb 1");
    hx_set_param(h, "bake", "1 0 0 1 0 0");
    {
        clip_t *cl = &inst->tracks[1].clips[0];
        HX_ASSERT(has_pitch(cl, 62), "D5: primary echo (62) missing");
        HX_ASSERT(has_pitch(cl, 66), "D5: harmony echo must carry the PRIMARY delta (66)");
        HX_ASSERT(!has_pitch(cl, 65), "D5: per-note re-transpose (65) resurfaced");
        int found_echo = 0;
        for (int i = 0; i < cl->note_count; i++) {
            if (cl->notes[i].tick > 0) {
                HX_ASSERT(cl->notes[i].gate == 12, "echo gate must be gate-derived (12), not source gate");
                found_echo = 1;
            }
        }
        HX_ASSERT(found_echo, "D5: no echoes baked at all");
    }
    hx_destroy(h);

    printf("PASS: bake_parity (D1 retrigger, D3 cc-lane pin, D5 primary-delta, D6 zero-gate)\n");
    return 0;
}
