# Phase 1 — Bundle 2 plan (VelIn + drum vel zones + Rpt1/Rpt2)

**Drafted:** 2026-05-16. Vibe-coder-readable. Walk through together before cutting `phase-1-bundle-2` off `main`.

**Inherits from:** Bundle 1 + 1.5 + 1.6 (on `phase-1-bundle-1`). Audio-thread `on_midi` + `pad_note_map` + `dsp_inbound_enabled` capability gate already in place. Bundle 2 builds on top of that scaffolding — no new shim work (so `legsmechanical/schwung:phase-1-inbound` is untouched by Bundle 2).

---

## Framing — restorative, not a fresh port

Bundle 1 silently broke two live-output features on patched Schwung:

- **VelIn** — was applied in `liveSendNote` at `ui.js:2317–2320`. Bundle 1's `liveSendNote` note-event gate skips this for patched Schwung → pad pressed at vel 80 with `VelIn=100` emits 80 to the synth, not 100.
- **Drum vel zones (live monitor)** — right-half pad press fired with `rawVel=true` through `liveSendNote`. Bundle 1's gate skips it; vel-zone press goes silent on patched Schwung.

Recording still works (the JS path that calls `tN_record_note_on` is unchanged), so these are **live-output-only regressions**. Bundle 2 closes them by moving VelIn / vel-zone application into `on_midi` (audio thread), exactly where Bundle 1 intercepts pad input.

For Rpt1/Rpt2 — the engines already run DSP-side (`drum_repeat_tick` / `drum_repeat2_tick`). What's still JS today is the **pad-press classifier** (rate pad vs lane pad vs vel pad). Moving that classifier to `on_midi` removes the JS-tick wobble between pad press and Rpt activation.

User-visible wins after Bundle 2:
- VelIn behaves correctly on patched Schwung again (live monitor, recording, *and* TARP arp output — see "Incidental fix" below).
- Drum vel zones audible again on live monitor.
- Rpt1/Rpt2 patterns trigger with the same audio-thread tightness as ordinary pad presses.

---

## Sub-bundle order (locked by gating dependency)

Per the audit (`notes/audit-davebox-arch.md` §2.3/2.5/2.6 + master plan §246), VelIn application has to know the pad source (NORMAL vs VEL_ZONE vs RPT_*) to decide whether to apply. So the scaffolding lands before everything else:

1. **2.0 — Pad-source intent flag scaffolding** (~0.5d)
2. **2A — Drum vel zones** (~1–1.5d)
3. **2B — VelIn in on_midi** (~0.5–1d)
4. **2C — Rpt1/Rpt2 classifier** (~2–3d)

**Total: ~4–6 days** (same envelope as audit estimate; Rpt2 is the long pole).

---

## Sub-bundle 2.0 — Pad-source intent flag

**Why first:** 2A/2B/2C all need to tell `live_note_on` *why* this note exists (so VelIn knows whether to apply, and recording velocity comes out right). Without this scaffold, 2A ships a vel-zone-only branch that 2C has to retrofit.

**Add to `dsp/seq8.h`:**
```c
typedef enum {
    PAD_SRC_NORMAL   = 0,  // ordinary left-half pad press
    PAD_SRC_VEL_ZONE = 1,  // right-half pad, vel-zone substitute
    PAD_SRC_RPT_RATE = 2,  // right-half pad, Rpt1 rate select
    PAD_SRC_RPT_LANE = 3,  // right-half pad, Rpt2 lane toggle
    PAD_SRC_RPT_VEL  = 4,  // right-half pad, Rpt repeat-vel zone
} pad_source_t;
```

**Add to `seq8_inst_t`:** per-track scratch slot `pad_source_t pad_source_scratch[NUM_TRACKS]` set by `on_midi` just before calling `live_note_on` / `drum_record_note_on`. Cleared back to `PAD_SRC_NORMAL` at end of dispatch.

**Touched files:** `dsp/seq8.h`, `dsp/seq8.c` (`on_midi` only). No JS, no shim.

**Device test:** None for 2.0 alone — scaffold is invisible until consumed. Verified by 2A's tests.

**Risk:** None. ~30 lines of C.

---

## Sub-bundle 2A — Drum vel zones into DSP

**JS path today:**
- `_onPadPress` at `ui.js:6626` detects right-half pad press on drum track → sets `S.drumVelZoneArmed[t] = true`, `S.drumLastVelZone[t] = zoneIdx`.
- `liveSendNote(..., rawVel=true)` fires the zone's velocity for live monitor (broken on patched Schwung after Bundle 1).
- `stepEntryVelocity` consumes the armed zone for step writes (unaffected — step writes don't go through Bundle 1's gate).

**DSP port (audio thread):**
- Extend `on_midi` (`dsp/seq8.c:4753`): when a right-half pad on a drum track is pressed, classify via a new `drum_pad_event(track, padIdx, vel, isOn)` helper that:
  1. Maps `padIdx` to vel-zone index (mirror of `drumPadToVelZone()` at `ui.js:1390`).
  2. Writes `inst->drum_vel_zone_armed[t] = 1`, `inst->drum_last_vel_zone[t] = zone`.
  3. Computes vel-zone velocity (mirror of `drumVelZoneToVelocity()` at `ui.js:1398`).
  4. Sets `pad_source_scratch[t] = PAD_SRC_VEL_ZONE`.
  5. Routes the note through `live_note_on` (or `drum_record_note_on` if armed) with the substituted velocity.
- Vel-pad release: noop (JS `_onPadRelease` has zero drum-vel-zone branches — synth voice rings out via envelope; DSP mirrors). Left-half pad presses use raw pad velocity, NOT cached zone velocity (correcting an earlier assumption in this doc — armed-zone state is consumed only by `stepEntryVelocity` for step-writes and by the vel-pad press itself's preview).

**Design note (advisor #3):** `drum_pad_event` is the same helper 2C extends with rate/lane/vel-pad branches. Worth declaring the full prototype now and stubbing the Rpt branches so 2C only fills bodies.

**JS sites neutralized on patched Schwung:** `liveSendNote(..., rawVel=true)` right-pad branch becomes a no-op for note events (already neutralized by Bundle 1's existing gate — just a comment update marking the dependency).

**JS sites that STAY (recording path):** `stepEntryVelocity` + step-write callers + JS-side vel-zone bookkeeping for sidecar persistence stay JS-only per advisor #4. DSP's `drum_vel_zone_armed[]` mirror is for live-output decisions only; the source of truth for *recording* velocity remains JS (it pre-applies via `stepEntryVelocity` before firing `_step_N_vel` set_params).

**Capability gates:** existing `dsp_inbound_enabled` check already at top of `on_midi`. No new gate sites — `drum_pad_event` is reached only when `dsp_inbound_enabled` is true.

**State:** `inst->drum_vel_zone_armed[NUM_TRACKS]`, `inst->drum_last_vel_zone[NUM_TRACKS]` in `seq8_inst_t`. NOT persisted (matches JS sidecar v=5 `drumVelZoneArmed` which is volatile session state). State version unchanged.

**Plus `tr->active_drum_lane` mirror** (per-track) — needed because vel-pad preview fires the active lane's note, and DSP has no equivalent of `S.activeDrumLane[t]` today. Added in 2A; pushed by JS via new `tN_active_drum_lane` set_param at every mutation site (track switch, drum lane page change, lane-pad press, init/sidecar restore). Per memory `feedback_schwung_drops_global_set_param.md` the key must be per-track-prefixed.

**Rpt-mode collision gating:** `drum_pad_event` checks `tr->drum_repeat_active || tr->drum_repeat2_active != 0` and returns 1 (handled, don't dispatch) if either is set — JS Rpt1/Rpt2 set_params still own activation in those modes (2C will replace). This means no `drum_perform_mode` mirror is needed.

**Device test matrix (corrected — original #3 was wrong):**
1. Drum track, no VelIn → right-half pad press at zone 4 → confirm correct zone velocity audible.
2. Drum track, VelIn=100 → right-half zone press → confirm zone velocity wins (NOT 100). *(This passes for 2A in isolation because VelIn isn't yet applied in `on_midi` — Bundle 2B adds that.)*
3. Recording armed, right-half press → confirm clip step records at zone velocity (recording path is JS-driven and unchanged; sanity test only).
4. Vel-pad press in Rpt1 mode → confirm Rpt1 still fires (drum_pad_event returns 1 without dispatching; JS set_params own activation).
5. Vel-pad press in Rpt2 mode → confirm Rpt2 still fires.
6. Switch active drum lane → press vel pad → confirm preview note is the NEW lane's note (validates `active_drum_lane` mirror push).
7. **Stock Schwung fallback** — same scenarios; confirm pre-Phase-1 behavior identical.

**Risk:** Low. Pure additive logic; recording path untouched.

---

## Sub-bundle 2B — VelIn in on_midi

**JS path today:** `liveSendNote` at `ui.js:2313` applies `S.trackVelOverride[t]` for plain note-ons (skipped if `rawVel` is set). After Bundle 1's gate, this never runs for note events on patched Schwung.

**DSP state already exists (audit §2.3(b)):** `track_vel_override[]` is loaded from sparse `t%d_tvo` set_param at `seq8.c:1365–1367`. Today consumed by `effective_vel()` (`seq8.c:3651`) which Rpt1/Rpt2 playback uses. We don't need to move state — we just need to hook it into `on_midi`.

**DSP port (audio thread):**
- In `on_midi`, after `pad_source_scratch[t]` is set and before calling `live_note_on`:
  - If `pad_source_scratch[t] == PAD_SRC_NORMAL` AND velocity > 0 AND `track_vel_override[t] > 0`: substitute `vel = track_vel_override[t]`.
  - All other sources (VEL_ZONE, RPT_*) pass through unchanged.
- Mirrors the JS `liveSendNote` rule (`!rawVel` && note-on && vel > 0 → tvo wins).

**Incidental TARP fix (advisor #5):** `tarp_fire_step` (`seq8.c:3970`) does NOT call `effective_vel` today — TARP fires held-pad velocity raw. But TARP reads held-pad velocity from state populated by `live_note_on`. Once 2B applies VelIn before calling `live_note_on`, TARP automatically inherits VelIn-scaled velocity. **No code change in `tarp_fire_step`.** Document as a known incidental fix; add to the device test matrix.

**JS sites neutralized on patched Schwung:** `liveSendNote` lines 2317–2320 (already dead under Bundle 1's gate; mark with PHASE-1 comment).

**JS sites that STAY (recording path):** Per advisor #4 — `tN_record_note_on` continues to receive JS-pre-scaled velocity (JS computes via `stepEntryVelocity`/`liveSendNote` semantics, sends pre-applied). No change to recording velocity source-of-truth in Bundle 2.

**Capability gates:** `dsp_inbound_enabled` (already in place). No new sites.

**State:** None added — `track_vel_override[]` already DSP-visible.

**Device test matrix:**
1. Plain pad press, VelIn=0 (Live) → raw velocity heard.
2. Plain pad press, VelIn=80 → 80 heard regardless of how hard pressed.
3. Drum right-half zone press, VelIn=80 → zone velocity heard (not 80; PAD_SRC_VEL_ZONE bypass).
4. TARP-on track, hold chord at vel 60, VelIn=110 → arp output at 110, NOT 60. (Incidental fix verification.)
5. Recording armed, VelIn=90, pad press at vel 40 → clip step records at 90.
6. **Stock Schwung fallback** — all scenarios match pre-Phase-1.

**Risk:** Low. State already there; one branch in `on_midi`. Main risk is double-application — bug if both JS `liveSendNote` AND DSP `on_midi` apply VelIn. Confirmed safe: Bundle 1's gate skips JS application for note events on patched Schwung.

---

## Sub-bundle 2C — Rpt1 / Rpt2 classifier

**JS path today (audit §2.5):**
- `_onPadPress` (`ui.js:6547–6600` for Rpt2, similar for Rpt1) classifies right-half pad presses on drum tracks by `S.drumPerformMode[t]` (0=normal, 1=Rpt1, 2=Rpt2).
- Fires `tN_drum_repeat_start/stop/lane/vel` (Rpt1) or `tN_drum_repeat2_lane_on/off/rate/vel` (Rpt2) set_params.
- `pendingRepeatLane` / `pendingRepeatLaneTrack` coalescing band-aid (`ui.js:6761–6765` → tick drain `:3854–3857`) defers `tN_drum_repeat_lane` by 1 tick to avoid colliding with `drum_repeat_start` in the same buffer.
- DSP engines (`drum_repeat_tick` `seq8.c:3660`, `drum_repeat2_tick` `:~3796`) already own the rate-driven fire loop, InQ quantization, recording into clip.

**DSP port (audio thread):**
- `on_midi` calls `drum_pad_event(track, padIdx, vel, isOn)` for every drum-track pad event.
- `drum_pad_event` switches on `inst->drum_perform_mode[t]`:
  - `DRUM_PERFORM_NORMAL` → 2A's vel-zone branch (already implemented).
  - `DRUM_PERFORM_RPT1` → classify right-half pad as rate / lane / vel pad; call internal `drum_repeat_start/stop/lane/vel` helpers (mirror existing set_param handlers but called directly).
  - `DRUM_PERFORM_RPT2` → similar for Rpt2.
- Set `pad_source_scratch[t]` to `PAD_SRC_RPT_RATE` / `PAD_SRC_RPT_LANE` / `PAD_SRC_RPT_VEL` so any note emit during the classifier (rare — usually engines fire on later ticks) skips VelIn.

**Lane-switch deferral (audit §3.5):** `pendingRepeatLane` band-aid SURVIVES as a per-track DSP-internal queue. Two pad events (rate-pad + lane-pad) in the same audio buffer still need ordered delivery. New field `int pending_repeat_lane[NUM_TRACKS]` (-1 = none), drained at top of next `drum_repeat_tick`. Simpler than today's JS path because it's purely DSP-internal — no set_param coupling.

**State migrated from JS to DSP:** `drum_perform_mode[NUM_TRACKS]` (already DSP-side via existing set_params), `drum_repeat_held_pad[NUM_TRACKS]`, `drum_repeat_held_pad_vel[NUM_TRACKS]`, `drum_repeat_latched[NUM_TRACKS]`, `drum_repeat2_held_lanes[NUM_TRACKS]` bitmask, `drum_repeat2_latched_lanes[NUM_TRACKS]`. Some of these are already DSP-side; audit when porting. **JS keeps mirrors** for OLED display (read via `tN_lN_repeat_state` get_param polling).

**JS sites neutralized:** `_onPadPress` Rpt1/Rpt2 branches (`ui.js:6547–6600` etc.) become PHASE-1-gated no-ops for note dispatch. Mode-LED + OLED update logic stays.

**Capability gates:** `dsp_inbound_enabled` (existing).

**Rpt2 stability (audit risk + master-plan risk):** Rpt2 is the less-mature engine. Port Rpt1 first inside this sub-bundle; commit; verify on device; then Rpt2. Two commits inside 2C (`2C-Rpt1` and `2C-Rpt2`) so we can bisect cleanly if Rpt2 regresses.

**Device test matrix:**
1. Rpt1 → press rate pad → confirm rate set + fire loop starts at correct rate.
2. Rpt1 → rate pad held → switch lane pad mid-fire → confirm lane swap on next fire (lane-switch deferral works).
3. Rpt1 → rate pad + lane pad pressed in same audio buffer (use Move's chord-pad gesture) → confirm both register, lane wins (deferral).
4. Rpt1 → recording armed → press rate pad → confirm clip records repeats at correct velocity (recording write-once detector `drum_last_rec_step` still works per memory `feedback_drum_repeat_recording_write_once.md`).
5. Rpt2 → press lane pad → confirm lane toggles on/off; rate-per-lane respected.
6. Rpt2 → multi-lane stack → confirm InQ sync (memory: `project_inq_repeat_stack.md`).
7. Rpt2 → recording → confirm write-once-across-passes still holds.
8. Aftertouch poke on held repeat pad → confirm vel updates mid-fire.
9. **Stock Schwung fallback** — all scenarios match pre-Phase-1.

**Risk:** Medium-high (Rpt2 specifically). Mitigations: split commit, devote a full session to Rpt2 verification with the memory `project_inq_repeat_stack.md` matrix as the regression checklist.

---

## JS sites neutralized — comment audit (end of Bundle 2)

Mark all with `PHASE-1: remove when patches upstreamed`:

- `liveSendNote` VelIn block (`ui.js:2317–2320`) — neutralized by Bundle 1 gate; VelIn now in `on_midi`.
- `liveSendNote` right-pad rawVel callsites — note dispatch neutralized by Bundle 1 gate; vel-zone resolution now in `on_midi`.
- `_onPadPress` drum vel-zone arming branch (`ui.js:~6626`) — DSP mirrors via `drum_pad_event`.
- `_onPadPress` Rpt1/Rpt2 classifier branches (`ui.js:~6547–6600`).
- `pendingRepeatLane` / `pendingRepeatLaneTrack` (`ui.js:6761–6765`) + tick drain (`:3854–3857`) — moved to DSP internal queue.

**Do NOT remove yet** — leave dead-but-marked so the final-bundle cleanup pass can sweep them all together once stock Schwung absorbs the shim patches. Matches Bundle 1 discipline (session-state §"JS-side gate sites").

---

## What stays JS-only (out of scope for Bundle 2)

- Step-write velocity (`stepEntryVelocity` + callers).
- `tN_record_note_on` velocity source-of-truth (JS pre-applies VelIn/zone before firing the set_param).
- OLED state mirrors (`drumPerformMode`, `drumRepeatHeldPad*`, etc.).
- Sidecar persistence of `drumVelZoneArmed` (sidecar v=5 unchanged).
- Aftertouch poke (thin set_param, can stay).
- Effects: `effectiveVelocity()` no-op at `ui.js:987` is dead code — flag for final cleanup pass.

---

## Branch + commit discipline

- New branch `phase-1-bundle-2` off `phase-1-bundle-1`. Bundle 2 needs Bundle 1's `on_midi` infrastructure to exist; the "no main merges" rule applies to merges *into* main, not to bundle-on-bundle branching. Per `feedback_phase_1_no_main_until_done.md`, the whole Phase 1 stack lands as one coordinated drop at the end.
- Commits planned (per sub-bundle, in order):
  1. `phase-1(bundle-2.0): pad source intent flag scaffolding`
  2. `phase-1(bundle-2A): drum vel zones in on_midi + drum_pad_event helper`
  3. `phase-1(bundle-2B): VelIn in on_midi for plain pad presses (incidental TARP fix)`
  4. `phase-1(bundle-2C-Rpt1): Rpt1 classifier moves to drum_pad_event + DSP-internal lane deferral`
  5. `phase-1(bundle-2C-Rpt2): Rpt2 classifier moves to drum_pad_event`
  6. `docs(phase-1): session-state checkpoint — Bundle 2 complete`
- Each commit deployed + verified on device before the next.
- CHANGELOG `[Unreleased]` updated as we go; MANUAL untouched (Bundle 2 is internal refactor — no user-visible behavior change beyond bug-fix-by-restoration).

---

## Risks summary

1. **Rpt2 stability** — pre-existing flag; split commit + dedicated verification session.
2. **VelIn double-application** — bug if JS still applies AND DSP also applies. Confirmed safe by Bundle 1 gate but add a `seq8_ilog` probe in `on_midi` for one device-verify pass to confirm.
3. **Recording velocity divergence** — if JS pre-application drifts from DSP live-monitor application, recorded velocity won't match what was heard. Mitigation: keep JS and DSP rules byte-identical; add to device test matrix items #4/#5/#7.
4. **TARP incidental fix surprises users** — if anyone was relying on TARP NOT applying VelIn (unlikely, more bug than feature), they'll notice. Worth a CHANGELOG note.
5. **drum_pad_event surface** — designing for vel-zone first then extending for Rpt could leak vel-zone assumptions into Rpt branches. Mitigate via 2.0 stub (full prototype + empty Rpt branches) so 2A's vel-zone code can't quietly couple to other branches.

---

## Decisions ratified (2026-05-16, walk-through)

1. **Branch base:** `phase-1-bundle-2` off `phase-1-bundle-1`. Audio-thread infrastructure stacks; one coordinated drop to main at end of Phase 1.
2. **2C split:** two commits — `phase-1(bundle-2C-Rpt1)` then `phase-1(bundle-2C-Rpt2)`. Cleaner bisect if Rpt2 regresses.
3. **TARP+VelIn:** ship the incidental fix. CHANGELOG `[Unreleased]` notes "TARP arp output now respects VelIn (previously bypassed)."
4. **`effectiveVelocity()` dead code:** defer to end-of-Phase-1 cleanup pass per master plan §Cleanup. NOT in Bundle 2.
5. **Verify cadence:** per sub-bundle, matching Bundle 1.5/1.6 — I build+install+restart, you run the device test matrix for that sub-bundle, we move forward on green / debug-and-amend on red.

---

## Timeline (recap)

| Sub-bundle | Effort | Risk |
|---|---|---|
| 2.0 — pad source enum scaffolding | 0.5d | None |
| 2A — drum vel zones | 1–1.5d | Low |
| 2B — VelIn + incidental TARP fix | 0.5–1d | Low |
| 2C-Rpt1 — Rpt1 classifier | 1–1.5d | Medium |
| 2C-Rpt2 — Rpt2 classifier | 1–1.5d | Medium-High |
| Verify + checkpoint commit | 0.5d | — |
| **Total** | **4.5–6.5 days** | — |

Same envelope as audit estimate (4–6d) with explicit scaffold + Rpt2 split.
