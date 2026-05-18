# Delete+Play universal unlatch — stopped-branch parity

**Date:** 2026-05-18
**Status:** Approved (pending written-spec review)
**Parked item:** `delete-play-universal-unlatch`

## Problem

`Delete + Play` is the user's "kill all the drones" performance escape hatch — it should clear every latched state across every track in one gesture: Rpt1 latch, Rpt2 latched lanes, TARP latch chip.

The handler already exists at `ui/ui.js:5573` inside `_onCC_transport`, but it only does the full sweep when transport is **playing**. When transport is **stopped**, it fires `transport=panic` and stops there — leaving JS-side state mirrors (`S.drumRepeatLatched[]`, `S.drumRepeatHeldPad[]`, `S.drumRepeatHeldPadsStack[]`, `S.drumRepeat2LatchedLanes[]`, `S.bankParams[t][5][7]`) reading "still latched" while audio is dead. UI lies, LEDs lie.

## Goal

After Delete+Play, regardless of transport state, every track is in a clean unlatched baseline — no latched repeats, no TARP chip ON, no stale JS mirrors, no stale LEDs.

## Non-goals

- New button combos. Gesture stays `Delete+Play`.
- Changes to transport semantics. `panic` stays on stopped, `deactivate_all` stays on playing.
- Changes to the no-modifier Play handler at `ui/ui.js:4978–4990`, which separately fires `drum_repeat_stop` / `drum_repeat2_stop` on plain Play. Different gesture.
- DSP changes. Existing `tarp_latch=0` already calls `tarp_drop_latched()` → `tarp_silence()`, which clears `held_physical[]` / `tarp_drop_latched` runtime and silences sounding notes. No new DSP handler needed.
- State version bumps or sidecar changes.

## Architecture

Extract the per-track unlatch sweep from the playing branch into a JS helper, then call it from both transport-state branches.

### New helper (ui.js)

```js
function unlatchAllTracks() {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.drumRepeatLatched[t]) {
            S.drumRepeatLatched[t] = false;
            S.drumRepeatHeldPad[t] = -1;
            S.drumRepeatHeldPadsStack[t].length = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_repeat_stop', val: '1' });
        }
        if (S.drumRepeat2LatchedLanes[t].size > 0) {
            S.drumRepeat2LatchedLanes[t].forEach(function(lane) {
                S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_repeat2_lane_off', val: String(lane) });
            });
            S.drumRepeat2LatchedLanes[t].clear();
        }
        if (S.bankParams[t] && S.bankParams[t][5] && S.bankParams[t][5][7]) {
            S.bankParams[t][5][7] = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_tarp_latch', val: '0' });
        }
    }
}
```

Three independent unlatch operations, gated on "is there anything to unlatch" so we don't spam set_params when state is already clean. set_params go through `pendingDefaultSetParams` — same delivery channel the existing playing-branch sweep already uses, so coalescing behavior is preserved (one push per tick across the queue).

### Call sites

Both branches of `_onCC_transport`'s Delete+Play handler at `ui.js:5573–5605`:

- **Playing branch:** keep `transport=deactivate_all`, replace the inline loop with `unlatchAllTracks()`.
- **Stopped branch:** keep `transport=panic` + the `will_relaunch` / `queuedClip` reset (those are clip-launch state, separate from latches), and **add** `unlatchAllTracks()`.

### DSP flow (informational, no change needed)

When `tN_tarp_latch=0` drains:

1. `seq8_set_param.c:2198` — handler sees the 1→0 transition.
2. Calls `tarp_drop_latched()` at `seq8.c:3743`.
3. `tarp_drop_latched()` walks `a->held_*[]`, keeps only physical entries, zeroes the latched-only entries.
4. If `held_count == 0` afterwards, falls through to `tarp_silence()` — sends `pfx_note_off_imm` for any sounding note, calls `arp_clear_runtime()`, zeroes `tr->tarp_physical`.

This runs the same way whether transport is playing or stopped — TARP state is independent of transport tick.

`tN_drum_repeat_stop` and `tN_drum_repeat2_lane_off` are likewise transport-state-agnostic on the DSP side. All three set_params are safe to fire while stopped.

## Risk

- **Coalescing pile-up:** in the worst case (8 tracks × all three latches active = 24 pushes onto `pendingDefaultSetParams`). The queue drains one-per-tick by design, so the unlatch completes over ~24 ticks (~250 ms at 94 Hz). This matches the existing playing branch — no regression.
- **State desync edge case:** if the JS mirror disagreed with DSP truth before the press (e.g. a previous bug left `S.bankParams[t][5][7]=1` but DSP `tr->tarp_latch=0`), the helper fires `tN_tarp_latch=0` redundantly. Handler is idempotent — early-returns on no-op transition. Safe.
- **Pending state from a held Delete:** Delete is a physical modifier. The user could be mid-press on another Delete-based gesture (e.g. step delete) when they tap Play. Existing handler is already gated on `if (d1 === MovePlay && d2 === 127)` inside `_onCC_transport` — the Delete+Play sweep only fires on Play press, no risk of crossing wires.

## Testing matrix (verify on Move)

| # | Setup | Action | Expected |
|---|-------|--------|----------|
| 1 | Latch Rpt1 on track 1 while playing, then Stop | Delete+Play | Rpt1 LED indicator clears; pressing Play resumes with no Rpt1 |
| 2 | Latch one Rpt2 lane on a drum track, then Stop | Delete+Play | Latched-lane LED clears; pressing Play resumes with no Rpt2 |
| 3 | Turn TARP latch chip ON on a melodic track, then Stop | Delete+Play | Chip LED flips OFF; held-key indicator clears |
| 4 | Latch all three (Rpt1 on t0, Rpt2 lanes on t1, TARP on t2), then Stop | Delete+Play | All three clear in one gesture |
| 5 | Regression — repeat 1–4 while playing | Delete+Play | Same outcome; `deactivate_all` still fires (clips stop relaunching) |

## Implementation steps

1. Create branch `feat-delete-play-unlatch-stopped-branch` off `main`.
2. Add `unlatchAllTracks()` helper near the other transport-related utilities in `ui/ui.js`.
3. Replace the inline loop in the playing branch (lines 5586–5603) with `unlatchAllTracks()`.
4. Add `unlatchAllTracks()` call to the stopped branch after the `will_relaunch` / `queuedClip` reset.
5. Bundle JS: `python3 scripts/bundle_ui.py`.
6. Deploy + reboot Move per CLAUDE.md.
7. Run the 5-row testing matrix on device.
8. Add CHANGELOG entry under `[Unreleased] → ### Fixes` (one-liner: "Delete+Play now clears Rpt1, Rpt2, and TARP latches across all tracks when transport is stopped — previously only the playing branch did the full sweep").
9. Update `docs/MANUAL.md` in the same commit. MANUAL currently documents Delete+Play at four points, and all of them under-describe shipped behavior (the playing branch already unlatches, but the table rows only say "Deactivate all clips"). Edit:
   - **L1288**: append a sentence — "Delete+Play also clears Rpt1, Rpt2, and TARP latches across all tracks, whether transport is playing or stopped."
   - **L1622–1623** (Transport table): change "Deactivate all clips" → "Deactivate all clips + unlatch Rpt1/Rpt2/TARP on every track"; change "MIDI panic" → "MIDI panic + unlatch Rpt1/Rpt2/TARP on every track".
   - **L1703** (second appearance of the same row in the appendix table): same edit as L1622, plus add a matching `Delete + Play (stopped)` row if missing.
10. Commit as a single change on the branch, FF-merge to main, push.

## Out of scope (parked, separate items)

- Drum repeats during count-in (`drum-repeats-during-countin`)
- Drum repeat InQ behavior (`drum-repeat-inq-behavior`)
- Modal pad-interception regression remaining cases (`modal-pad-interception-regression`)
- Per-track octave UX (`per-track-octave-ux`)
