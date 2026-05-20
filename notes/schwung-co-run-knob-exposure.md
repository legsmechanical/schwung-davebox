# SUPERSEDED — see header note

**Target: post-1.0 release.** Not in scope for 1.0.


**This document's diagnosis is wrong.** Kept for trail; do not act on it.

The "pads silent after co-run" symptom was **NOT** caused by the
knob-touch carve-out or stuck `S.knobTouched`. The probe data that
identified K5/ARP captured one incidental stuck state, not the root cause
of the user-reported intermittence.

**Actual root cause** (post-mortem in session memory
`project_padmap_set_param_drop_fix`): commit `7ab2477` on `1.0-tweaks`
surfaced `_padDispatchMutedNow()` to DSP via the `tN_padmap` `set_param`
push as a 34th token. That `set_param` channel coalesces same-key writes
per audio buffer and competes with `shadow_send_midi_to_dsp` for the
delivery channel. Un-mute pushes dropped intermittently → DSP stuck at
`pad_dispatch_muted=1` → all pads silent on every track until the next
modifier CC retriggered `computePadNoteMap`. Independent of co-run.

**Fix shipped on 1.0-tweaks** (commit at session close): new DSP
`get_param("pad_dispatch_muted")` reader + JS tick-time check every 5
ticks. If DSP value diverges from JS truth, re-push padmap. Worst-case
stuck duration: ~50ms.

**What's parked for next session** — the original ask "expose knobs in
schwung split" is unbuilt. See `project_chain_edit_corun_knob_regression`
memory for the four shadow_ui / shim edits attempted and reverted in this
session. Re-attempt on a clean branch.

---

(Original document below — preserved for diagnostic trail. Treat as
historical, not prescriptive.)

# Schwung chain-edit co-run — knob exposure regression

**Status (end of session 2026-05-18):** Knob TURN exposure works. Knob TOUCH
exposure introduced a regression that mutes dAVEBOx pads. An exit-time
`S.knobTouched = -1` defensive clear was shipped but the user reports it
doesn't fully resolve the issue. Session paused for design rethink.

## Original ask

"Expose the knobs in schwung split" — while a dAVEBOx track is co-running
with Schwung's chain editor (`Edit Slot...`), the user wants the knob row
(K1-K8) to drive the focused chain component's parameters, not dAVEBOx's
own bank-param row, *and* knob touch should show the editor's value overlay
the same way it does in normal (non-co-run) chain-edit mode.

User reference: "knob touch should be exposed too — just like knobs in
move co-run." (Move-native co-run already passes CC 71-78 + touch notes
0-9 to Move firmware via the shim's sh_midi filter.)

## What we shipped to the schwung fork (legsmechanical/schwung main)

Four edits. All reverted at session close.

### `src/shadow/shadow_ui.js` — chain-edit co-run intercept block (~L15995)

1. **Shift CC (49) press-only eat** (~L16038). Was unconditional eat of
   both edges; changed to eat press only so release falls through to the
   tool. Reverted at session close.

2. **CC 71-78 turn routing to editor** (~L16051, new block). Wraps in
   `runCoRunChainEdit(...)` and calls `adjustKnobAndShow(idx, delta)` with
   `handleKnobTurn(idx, delta)` fallback. Worked on device. Reverted at
   session close (for bisect).

3. **Notes 0-7 (knob touch) routing to editor** (~L16070, new block).
   Routed both edges to editor. Suspected to be the regression — caused
   `S.knobTouched` to stick on dAVEBOx side. Reverted; reverting did not
   resolve user's "pads silent" symptom, which proved the actual root cause
   was elsewhere (see SUPERSEDED note at top).

### `src/schwung_shim.c` — Move-native co-run tool-side MIDI filter (~L6891)

4. **Shift CC press-only eat in the tool-side suppress list.** Reverted at
   session close.

## How we got to the (wrong) K5/ARP diagnosis

Probes added: `[mutewhy]` queue-drained with rotating `debug_log_N` keys.
Caught one stuck-state instance with `sh=0 bk=4 kt=4 bp=1 co=-1/-1` —
genuinely stuck S.knobTouched on a TRACK ARP bank, but this was an
incidental simultaneous condition, not the cause of the user-reported
intermittence. Exit-clear fix for S.knobTouched was shipped, then reverted
when user reported bug persisted.

The K5/ARP probe hit was a real but unrelated stuck state. Likely the user
genuinely had K5 touched during the test session at some point, but the
silent pads weren't from that.

## Lessons (carried into memory)

- **Don't conflate "probe captured stuck state X" with "X is the root
  cause of the user's symptom."** The probe found one consistent stuck
  state; the user's symptom had a different mechanism. Bisect (full
  revert) was the empirical test that distinguished them.
- **`host_module_set_param(...)` from JS is unreliable** in the audio-
  thread-bound delivery pipeline. Same-key per-buffer coalesce + channel
  contention with `shadow_send_midi_to_dsp` can silently drop pushes.
  Self-healing readback is the pattern.
- **The Shift release-passthrough fixes targeted a non-existent bug.**
  Probe data showed Shift+Step 3's deferred dispatch already clears
  `S.shiftHeld` before co-run starts. The fix shape was sound, the bug
  shape was assumed not verified. Reverted.

## Connected memory

- `[[project_padmap_set_param_drop_fix]]` — actual fix shipped this
  session.
- `[[project_chain_edit_corun_knob_regression]]` — knob-exposure feature
  parked, four reverted edits documented, ready for re-attempt next
  session.
- `[[feedback_set_param_coalescing]]` and
  `[[feedback_set_param_per_buffer_per_key]]` — the underlying reliability
  problem.
