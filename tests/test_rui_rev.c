/* tests/test_rui_rev.c — rui_rev bump semantics + the targeted-resync
 * (rui_dirty) accumulator.
 *
 * rui_rev tells the on-device JS that a REMOTE (browser piano-roll) edit
 * changed session content. A change used to trigger a full syncClipsFromDsp()
 * (~1,540 sequential get_params ≈ 4.3 s of frozen UI at one param per SPI
 * frame). Now rui_mark() records WHICH clip(s) changed and the JS reads the
 * read-and-clear `rui_dirty` digest to re-sync just those. The adaptive
 * live-record path reuses tN_cC_length to grow/lock the clip, so every
 * page-growth and the stop-lock froze the unit for ~4.3 s (2026-07-06
 * record-disarm hang). Local recording writes must NOT bump rui_rev; genuine
 * remote edits still must.
 */
#include "harness.h"
#include <string.h>

static unsigned rev(hx_t *h) {
    return (unsigned)((seq8_instance_t *)h->inst)->rui_rev;
}

int main(void) {
    hx_t *h = hx_create(NULL);
    HX_ASSERT(h, "create failed");
    seq8_instance_t *inst_ = (seq8_instance_t *)h->inst;   /* white-box, for undo-flag checks */

    /* Pin: remote note edit bumps the rev (existing remote-UI contract). */
    unsigned r0 = rev(h);
    hx_set_param(h, "t7_c0_note_add", "0 60 100 24");
    HX_ASSERT(rev(h) == r0 + 1, "remote note_add must bump rui_rev");

    /* Pin: _length while NOT recording (a genuine remote edit) bumps. */
    unsigned r1 = rev(h);
    hx_set_param(h, "t7_c0_length", "32");
    HX_ASSERT(rev(h) == r1 + 1, "remote _length (not recording) must bump rui_rev");

    /* THE FIX: _length while the track is live-recording (the adaptive
     * grow/lock writes) must NOT bump — it triggered a ~4.3 s full-resync
     * freeze per write on device. */
    hx_set_param(h, "t7_recording", "1");
    unsigned r2 = rev(h);
    hx_set_param(h, "t7_c0_length", "48");
    HX_ASSERT(rev(h) == r2, "_length during recording must NOT bump rui_rev");

    /* Length write still took effect (only the rev bump is suppressed). */
    char buf[32];
    int n = hx_get_param(h, "t7_c0_length", buf, (int)sizeof(buf));
    HX_ASSERT(n > 0 && atoi(buf) == 48, "_length during recording still applies");

    /* Disarm; a later remote _length bumps again. */
    hx_set_param(h, "t7_recording", "0");
    unsigned r3 = rev(h);
    hx_set_param(h, "t7_c0_length", "64");
    HX_ASSERT(rev(h) == r3 + 1, "remote _length after disarm bumps again");

    /* ---- targeted re-sync accumulator: rui_dirty read-and-clear digest ---- */
    char dbuf[128];
    /* Clear whatever the edits above accumulated so sub-tests are isolated. */
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));

    /* Single melodic edit → "m t c". */
    hx_set_param(h, "t2_c1_note_add", "0 60 100 24");
    int dn = hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(dn > 0 && !strcmp(dbuf, "m 2 1"), "single melodic edit → 'm 2 1'");

    /* Read-and-clear: an empty accumulator reads FULL (safe full-sync fallback). */
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "FULL"), "empty accumulator reads FULL");

    /* Dedup: two edits on the same clip collapse to one entry. */
    hx_set_param(h, "t2_c1_note_add", "24 62 100 24");
    hx_set_param(h, "t2_c1_note_del", "0 60");
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "m 2 1"), "two edits, same clip → one dirty entry");

    /* Drum edit → "d t c" (tN_lL_* auto-allocates drum mode; active_clip 0). */
    hx_set_param(h, "t4_l0_note_add", "0 100 24");
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "d 4 0"), "drum lane edit → 'd 4 0'");

    /* Mixed melodic + drum in one window → FULL (single prefix can't express it). */
    hx_set_param(h, "t2_c1_note_add", "48 64 100 24");   /* melodic track */
    hx_set_param(h, "t4_l0_note_add", "24 100 24");       /* drum track    */
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "FULL"), "mixed drum+melodic → FULL");

    /* Overflow: more than RUI_DIRTY_MAX (8) distinct clips → FULL. */
    for (int c = 0; c < 9; c++) {
        char k[32]; snprintf(k, sizeof(k), "t0_c%d_note_add", c);
        hx_set_param(h, k, "0 60 100 24");
    }
    hx_get_param(h, "rui_dirty", dbuf, (int)sizeof(dbuf));
    HX_ASSERT(!strcmp(dbuf, "FULL"), ">8 distinct clips → FULL");

    /* Persistence gap fix: a remote _length edit sets state_dirty (was missing). */
    ((seq8_instance_t *)h->inst)->state_dirty = 0;
    hx_set_param(h, "t5_c0_length", "32");
    HX_ASSERT(((seq8_instance_t *)h->inst)->state_dirty == 1,
              "remote _length edit sets state_dirty (persists)");

    /* ================================================================
     * Rev-gate audit fixes: every handler below mutates content the
     * remote-UI snapshot shows but historically never bumped rui_rev,
     * leaving the browser (and a 2nd tab / on-device) stale for up to
     * 30s (the manager backstop). Each assertion pins the bump.
     * ================================================================ */

    /* ---- sp_track_ccauto.c: track-level knob assign/type (t6) ---- */
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_assign", "0 10");
        HX_ASSERT(rev(h) == r + 1, "cc_assign must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_type_assign", "1 0 20");
        HX_ASSERT(rev(h) == r + 1, "cc_type_assign must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_type", "2 1");
        HX_ASSERT(rev(h) == r + 1, "cc_type must bump rui_rev");
    }
    /* cc_send is a live transmit, not stored automation -- must NOT bump. */
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_send", "0 64");
        HX_ASSERT(rev(h) == r, "cc_send must NOT bump rui_rev (live transmit only)");
    }

    /* ---- sp_track_ccauto.c: clip-scoped automation edits (t6, clip 3) ---- */
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_rest", "3 4 50");
        HX_ASSERT(rev(h) == r + 1, "cc_rest must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_auto_set", "3 4 100 60");
        HX_ASSERT(rev(h) == r + 1, "cc_auto_set must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_auto_set2", "3 4 0 50 70");
        HX_ASSERT(rev(h) == r + 1, "cc_auto_set2 must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_auto_clear_k", "3 4");
        HX_ASSERT(rev(h) == r + 1, "cc_auto_clear_k must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_auto_clear_range", "3 4 0 50");
        HX_ASSERT(rev(h) == r + 1, "cc_auto_clear_range must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_auto_clear_step", "3 0 50");
        HX_ASSERT(rev(h) == r + 1, "cc_auto_clear_step must bump rui_rev");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "t6_cc_auto_clear", "3");
        HX_ASSERT(rev(h) == r + 1, "cc_auto_clear must bump rui_rev");
    }

    /* ---- sp_globals_edit.c: clip_copy/drum_clip_copy/drum_clip_cut mark the
     * DESTINATION clip (drum_clip_cut also marks SRC, since it clears it --
     * two rui_mark calls => +2). row_clear spans all tracks at one clip
     * index => rui_touch (full). undo_restore/redo_restore are wholesale
     * (scope unknown to the handler) => rui_touch. ---- */
    {
        unsigned r = rev(h);
        hx_set_param(h, "clip_copy", "0 0 1 2");
        HX_ASSERT(rev(h) == r + 1, "clip_copy must bump rui_rev (dest clip)");
    }
    {
        hx_set_param(h, "t5_l0_note_add", "0 100 24");   /* -> t5 drum mode, all 16 clips allocated */
        unsigned r = rev(h);
        hx_set_param(h, "drum_clip_copy", "5 4 5 5");
        HX_ASSERT(rev(h) == r + 1, "drum_clip_copy must bump rui_rev (dest clip)");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "drum_clip_cut", "5 5 5 6");
        HX_ASSERT(rev(h) == r + 2, "drum_clip_cut must bump rui_rev for BOTH dest and src (cleared)");
    }
    {
        unsigned r = rev(h);
        hx_set_param(h, "row_clear", "1");
        HX_ASSERT(rev(h) == r + 1, "row_clear must bump rui_rev (rui_touch: spans all tracks)");
    }
    {
        hx_set_param(h, "t0_c6_note_add", "0 60 100 24");
        hx_set_param(h, "clip_cut", "0 6 0 7");   /* arms a melodic undo snapshot */
        HX_ASSERT(inst_->undo_valid == 1, "setup: clip_cut armed undo");
        unsigned r = rev(h);
        hx_set_param(h, "undo_restore", "1");
        HX_ASSERT(rev(h) == r + 1, "undo_restore must bump rui_rev (rui_touch: scope unknown)");
        r = rev(h);
        hx_set_param(h, "redo_restore", "1");
        HX_ASSERT(rev(h) == r + 1, "redo_restore must bump rui_rev (rui_touch: scope unknown)");
    }

    /* ---- sp_track_clip.c: tN_cC_* melodic clip keys (t2, clip 5) ---- */
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "t2_c5_step_0_toggle", "60");
        HX_ASSERT(rev(h) == r + 1, "_step_toggle must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_vel", "80");
        HX_ASSERT(rev(h) == r + 1, "_step_vel must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_gate", "40");
        HX_ASSERT(rev(h) == r + 1, "_step_gate must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_nudge", "3");
        HX_ASSERT(rev(h) == r + 1, "_step_nudge must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_iter", "33");
        HX_ASSERT(rev(h) == r + 1, "_step_iter must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_rand", "50");
        HX_ASSERT(rev(h) == r + 1, "_step_rand must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_ratch", "2");
        HX_ASSERT(rev(h) == r + 1, "_step_ratch must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_0_reassign", "2");
        HX_ASSERT(rev(h) == r + 1, "_step_reassign must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_2_copy_to", "4");
        HX_ASSERT(rev(h) == r + 1, "_step_copy_to must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_4_pitch", "5");
        HX_ASSERT(rev(h) == r + 1, "_step_pitch must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_4_set_notes", "60 64");
        HX_ASSERT(rev(h) == r + 1, "_step_set_notes must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_6_add", "70 0 90");
        HX_ASSERT(rev(h) == r + 1, "_step_add must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_step_6_clear", "0");
        HX_ASSERT(rev(h) == r + 1, "_step_clear must bump rui_rev");
    }
    {
        /* _ruisel changes the snapshot's content selector (rui_sel_*), so it
         * MUST bump — without it the manager's rev gate never re-reads and the
         * browser shows the previously selected clip until an unrelated edit. */
        unsigned r = rev(h);
        hx_set_param(h, "t1_c3_ruisel", "");
        HX_ASSERT(rev(h) == r + 1, "_ruisel must bump rui_rev");
        r = rev(h);
        hx_set_param(h, "t2_c5_ruisel", "-1");
        HX_ASSERT(rev(h) == r + 1, "_ruisel (back) must bump rui_rev");
    }
    {
        /* _loop_set mirrors the _length freeze-fix guard: no bump while
         * this track is live-recording (adaptive record path). */
        hx_set_param(h, "t2_recording", "1");
        unsigned r = rev(h);
        hx_set_param(h, "t2_c5_loop_set", "4");
        HX_ASSERT(rev(h) == r, "_loop_set during recording must NOT bump rui_rev");
        hx_set_param(h, "t2_recording", "0");
        r = rev(h);
        hx_set_param(h, "t2_c5_loop_set", "8");
        HX_ASSERT(rev(h) == r + 1, "_loop_set (not recording) must bump rui_rev");
    }
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "t2_c5_k2_cc_loop_set", "4");
        HX_ASSERT(rev(h) == r + 1, "_k2_cc_loop_set must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_k2_cc_lane_length", "5");
        HX_ASSERT(rev(h) == r + 1, "_cc_lane_length must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_k2_cc_lane_tps", "48");
        HX_ASSERT(rev(h) == r + 1, "_cc_lane_tps must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_k2_cc_lane_res_tps", "48");
        HX_ASSERT(rev(h) == r + 1, "_cc_lane_res_tps must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_k2_cc_lane_reset", "1");
        HX_ASSERT(rev(h) == r + 1, "_cc_lane_reset must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_k2_cc_lane_double_fill", "1");
        HX_ASSERT(rev(h) == r + 1, "_cc_lane_double_fill must bump rui_rev");
    }
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "t2_c5_cond_resp", "1 1");
        HX_ASSERT(rev(h) == r + 1, "_cond_resp must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_cond_lock", "1");
        HX_ASSERT(rev(h) == r + 1, "_cond_lock must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_cond_oct", "1 2");
        HX_ASSERT(rev(h) == r + 1, "_cond_oct must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_cond_when", "1 1");
        HX_ASSERT(rev(h) == r + 1, "_cond_when must bump rui_rev");
    }
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "t2_c5_clear", "1");
        HX_ASSERT(rev(h) == r + 1, "_clear must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_clear_keep", "1");
        HX_ASSERT(rev(h) == r + 1, "_clear_keep must bump rui_rev");
        r = rev(h); hx_set_param(h, "t2_c5_hard_reset", "1");
        HX_ASSERT(rev(h) == r + 1, "_hard_reset must bump rui_rev");
    }
    {
        /* _drum_clear/_drum_reset key off tr->drum_clips[cidx] on a drum
         * track (t5 already switched to drum mode above); use a fresh
         * clip index (3) not touched by the drum_clip_copy/cut tests. */
        unsigned r;
        r = rev(h); hx_set_param(h, "t5_c3_drum_clear", "0");
        HX_ASSERT(rev(h) == r + 1, "_drum_clear must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_c3_drum_reset", "0");
        HX_ASSERT(rev(h) == r + 1, "_drum_reset must bump rui_rev");
    }

    /* ---- sp_track_drum.c: tN_lL_* drum-lane keys (t3, lane 5) ---- */
    {
        hx_set_param(h, "t3_l5_note_add", "0 100 24");   /* -> t3 drum mode + lane 5 content */
        unsigned r;
        r = rev(h); hx_set_param(h, "t3_l5_lane_note", "50");
        HX_ASSERT(rev(h) == r + 1, "_lane_note must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_loop_set", "4");
        HX_ASSERT(rev(h) == r + 1, "lane _loop_set must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_loop_double_fill", "1");
        HX_ASSERT(rev(h) == r + 1, "_loop_double_fill must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_copy_to", "6");
        HX_ASSERT(rev(h) == r + 1, "lane _copy_to must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_cut_to", "7");
        HX_ASSERT(rev(h) == r + 1, "lane _cut_to must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_euclid_stamp", "0 4 100");
        HX_ASSERT(rev(h) == r + 1, "_euclid_stamp must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_lgto_apply", "1");
        HX_ASSERT(rev(h) == r + 1, "_lgto_apply must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_pfx_set", "gate_time 150");
        HX_ASSERT(rev(h) == r + 1, "lane _pfx_set must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_clear", "1");
        HX_ASSERT(rev(h) == r + 1, "lane _clear must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_hard_reset", "1");
        HX_ASSERT(rev(h) == r + 1, "lane _hard_reset must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_toggle", "90");
        HX_ASSERT(rev(h) == r + 1, "drum _step_toggle must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_vel", "50");
        HX_ASSERT(rev(h) == r + 1, "drum _step_vel must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_gate", "30");
        HX_ASSERT(rev(h) == r + 1, "drum _step_gate must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_nudge", "2");
        HX_ASSERT(rev(h) == r + 1, "drum _step_nudge must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_iter", "33");
        HX_ASSERT(rev(h) == r + 1, "drum _step_iter must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_rand", "50");
        HX_ASSERT(rev(h) == r + 1, "drum _step_rand must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_ratch", "2");
        HX_ASSERT(rev(h) == r + 1, "drum _step_ratch must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_2_reassign", "3");
        HX_ASSERT(rev(h) == r + 1, "drum _step_reassign must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_l5_step_3_copy_to", "4");
        HX_ASSERT(rev(h) == r + 1, "drum _step_copy_to must bump rui_rev");
    }

    /* ---- sp_track_drum2.c: tN_all_lanes_* keys (t3, active_clip 0) ---- */
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "t3_all_lanes_length", "4");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_length must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_all_lanes_loop_set", "4");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_loop_set must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_all_lanes_double_fill", "1");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_double_fill must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_all_lanes_clip_resolution", "2");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_clip_resolution must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_all_lanes_playback_dir", "1");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_playback_dir must bump rui_rev");
        /* playback_audio_reverse is NOT emitted by the snapshot (matches the
         * single-lane handler skipped in f3ceff1) — it must NOT bump rui_rev. */
        r = rev(h); hx_set_param(h, "t3_all_lanes_playback_audio_reverse", "1");
        HX_ASSERT(rev(h) == r, "all_lanes_playback_audio_reverse must NOT bump rui_rev (not snapshot-visible)");
        r = rev(h); hx_set_param(h, "t3_all_lanes_beat_stretch", "1");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_beat_stretch must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_all_lanes_clock_shift", "1");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_clock_shift must bump rui_rev");
        r = rev(h); hx_set_param(h, "t3_all_lanes_nudge", "1");
        HX_ASSERT(rev(h) == r + 1, "all_lanes_nudge must bump rui_rev");
    }

    /* ---- handler-tail sweep (2026-07-18): same-class rev-bump gaps left by the
     * initial Theme-1 sweep — drum lane-config ops (browser-visible via rui_dlanes
     * / rui_lane / rui_pfx) + globals clip_cut / row_copy / row_cut. ---- */
    {
        unsigned r;
        /* t5 → drum via a lane write; give lane 0 a workable length + content */
        hx_set_param(h, "t5_l0_note_add", "0 100 24");
        hx_set_param(h, "t5_l0_clip_length", "8");
        hx_set_param(h, "t5_l0_step_2_toggle", "100");
        hx_set_param(h, "t5_l0_step_4_toggle", "100");

        r = rev(h); hx_set_param(h, "t5_l0_mute", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _mute must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_solo", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _solo must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_clip_length", "6");
        HX_ASSERT(rev(h) == r + 1, "drum _clip_length must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_playback_dir", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _playback_dir must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_pfx_reset", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _pfx_reset must bump rui_rev");
        /* clip_resolution: two distinct indices so new_tps != old_tps (else early return) */
        hx_set_param(h, "t5_l0_clip_resolution", "0");
        r = rev(h); hx_set_param(h, "t5_l0_clip_resolution", "3");
        HX_ASSERT(rev(h) == r + 1, "drum _clip_resolution must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_beat_stretch", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _beat_stretch must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_clock_shift", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _clock_shift must bump rui_rev");
        r = rev(h); hx_set_param(h, "t5_l0_nudge", "1");
        HX_ASSERT(rev(h) == r + 1, "drum _nudge must bump rui_rev");
        /* _nudge main path also now persists (was missing state_dirty) */
        ((seq8_instance_t *)h->inst)->state_dirty = 0;
        hx_set_param(h, "t5_l0_nudge", "1");
        HX_ASSERT(((seq8_instance_t *)h->inst)->state_dirty == 1, "drum _nudge sets state_dirty (persists)");

        /* globals copy/cut — clip_cut marks dest+src (+2); row_copy/row_cut full rui_touch (+1) */
        r = rev(h); hx_set_param(h, "clip_cut", "1 0 1 1");
        HX_ASSERT(rev(h) >= r + 1, "clip_cut must bump rui_rev");
        r = rev(h); hx_set_param(h, "row_copy", "0 1");
        HX_ASSERT(rev(h) == r + 1, "row_copy must bump rui_rev");
        r = rev(h); hx_set_param(h, "row_cut", "0 2");
        HX_ASSERT(rev(h) == r + 1, "row_cut must bump rui_rev");
    }

    /* ================================================================
     * Rev-gate sweep #2 (audit2): three more files mutate snapshot-
     * visible state with no rui_ call. Pin each family.
     * ================================================================ */

    /* ---- sp_globals_transport.c: globals surfaced in rui_glob (key/scale also
     * drive rui_scale). All wholesale rui_touch. ---- */
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "key", "5");
        HX_ASSERT(rev(h) == r + 1, "key must bump rui_rev (rui_glob + rui_scale)");
        r = rev(h); hx_set_param(h, "scale", "3");
        HX_ASSERT(rev(h) == r + 1, "scale must bump rui_rev (rui_glob + rui_scale)");
        r = rev(h); hx_set_param(h, "scale_aware", "1");
        HX_ASSERT(rev(h) == r + 1, "scale_aware must bump rui_rev (rui_glob)");
        r = rev(h); hx_set_param(h, "swing_amt", "50");
        HX_ASSERT(rev(h) == r + 1, "swing_amt must bump rui_rev (rui_glob)");
        r = rev(h); hx_set_param(h, "swing_res", "1");
        HX_ASSERT(rev(h) == r + 1, "swing_res must bump rui_rev (rui_glob)");
        r = rev(h); hx_set_param(h, "launch_quant", "2");
        HX_ASSERT(rev(h) == r + 1, "launch_quant must bump rui_rev (rui_glob)");
    }

    /* ---- sp_track_config.c: rui_index fields (mute/solo/channel/route) +
     * clip launch (active/queued clip). t1 melodic, transport stopped. ---- */
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "t1_mute", "1");
        HX_ASSERT(rev(h) == r + 1, "tN_mute must bump rui_rev (rui_index)");
        r = rev(h); hx_set_param(h, "t1_solo", "1");
        HX_ASSERT(rev(h) == r + 1, "tN_solo must bump rui_rev (rui_index)");
        r = rev(h); hx_set_param(h, "t1_channel", "3");
        HX_ASSERT(rev(h) == r + 1, "tN_channel must bump rui_rev (rui_index)");
        r = rev(h); hx_set_param(h, "t1_route", "move");
        HX_ASSERT(rev(h) == r + 1, "tN_route must bump rui_rev (rui_index)");
        r = rev(h); hx_set_param(h, "t1_launch_clip", "2");
        HX_ASSERT(rev(h) == r + 1, "tN_launch_clip must bump rui_rev (rui_index ac/qc)");
    }

    /* ---- sp_globals_misc.c: mute_all_clear + snapshot recall rewrite
     * inst->mute[]/solo[] (rui_index). Both wholesale rui_touch. snap_save
     * only STORES (not snapshot-visible) so it must NOT bump. ---- */
    {
        unsigned r;
        r = rev(h); hx_set_param(h, "mute_all_clear", "1");
        HX_ASSERT(rev(h) == r + 1, "mute_all_clear must bump rui_rev (rui_index)");
        /* Store a snapshot into slot 0 (N m0..m7 s0..s7 dm0..dm7 = 25 tokens). */
        r = rev(h); hx_set_param(h, "snap_save", "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0");
        HX_ASSERT(rev(h) == r, "snap_save must NOT bump rui_rev (store only, not shown)");
        r = rev(h); hx_set_param(h, "snap_load", "0");
        HX_ASSERT(rev(h) == r + 1, "snap_load must bump rui_rev (rui_index recall)");
    }

    hx_destroy(h);
    printf("PASS: rui_rev bump semantics + rui_dirty targeted-resync accumulator\n");
    return 0;
}
