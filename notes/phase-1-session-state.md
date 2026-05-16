# Phase 1 — Session Checkpoint (Bundles 1 + 1.5 complete)

**Saved:** 2026-05-15 → updated 2026-05-16 (end of session, Bundle 1.5 shipped).
**Status:** **✓ BUNDLE 1 + BUNDLE 1.5 VERIFIED + COMMITTED + PUSHED on `phase-1-bundle-1`.** All recording scenarios pass: loop_start=0 (count-in + normal, melodic + drum), loop_start>0 (count-in + normal, melodic + drum), window-wrap held notes, TARP overdub, ROUTE_MOVE + ROUTE_SCHWUNG. Vanilla-Schwung fallback also verified (deployed v0.9.13 binaries; user confirmed pre-Phase-1 behavior; patched restored after).

**Discipline locked-in for this refactor:** **NO main merges until the entire Phase 1 refactor is complete and verified end-to-end.** Bundle branches push to their own remote refs only; one coordinated mainline drop + patch regen + release at the very end. Stated 2026-05-16 — memory: `feedback_phase_1_no_main_until_done.md`.

---

## Commits on phase-1-bundle-1 (off main, pushed to `origin/phase-1-bundle-1`)

- `73295f0` drum mode — `computePadNoteMap` branches: drum tracks push lane `midi_notes`; right-half pads emit 0xFF (vel zones aren't note dispatch).
- `d3fb587` trackOctave — bake runtime octave shift into DSP padmap push; resync on Up/Down arrows + drumLanePage change.
- `f47c93e` session-view padmap gate + drum lane note repush.
- `2e540d9` single-buffer monitor when armed on patched Schwung — on_midi dispatches unconditionally; record-path inline-monitor gated on `!dsp_inbound_enabled`.
- `f822dfe` record-tick slot mechanism — `on_midi` snapshots actual hardware press/release tick on audio thread; record handlers read from per-(track,pitch) / per-(track,lane) slots.
- `b5c3fa7` docs: session-state checkpoint (mid-session).
- `a46bb3c` **Bundle 1.5** — count-in preroll capture (last 1/8 note window) + window-aware recording (drop `% clip_ticks` in record_note_on/off, drum_record_note_on/off, tarp_fire_step, finalize_pending_notes; widen drum bounds to `< loop_start + length`).

(Earlier Bundle 1 commits `78f9275`, `000e30e`, `ac3c3c2` are the scaffold/initial-dispatch trio that landed before the session-state file was first written; they sit underneath these on the branch.)

## Commits on `legsmechanical/schwung:phase-1-inbound` (off main, v0.9.13 base, pushed to `fork/phase-1-inbound`)

- `a58f557f` shim pad-delivery insertion (existed pre-session).
- `7aa0a0e9` capability sentinel `shadow_inbound_pad_midi_active()` exposed via shadow_ui.

Builds: dist/davebox-module.tar.gz current. `~/schwung/build/shadow/shadow_ui` deployed to `/data/UserData/schwung/shadow/` on Move (includes phase-1-inbound commits).

---

## Architecture summary

**On patched Schwung** (`shadow_inbound_pad_midi_active` exposed):
- Pad press → shim delivers MIDI to dAVEBOx DSP `on_midi` on the audio thread.
- `on_midi` looks up `inst->pad_note_map[active_track][padIdx]` and calls `live_note_on / live_note_off`.
- JS `S.dspInboundEnabled = true` → `liveSendNote` skips `queueLiveNoteOn/Off` for note events on ROUTE_MOVE and ROUTE_SCHWUNG.
- Recording: JS still sends `tN_record_note_on / tN_record_note_off`. `on_midi` skips note-on when armed on ROUTE_MOVE (record_note_on inline-monitors); dispatches normally when armed on ROUTE_SCHWUNG (record_note_on doesn't monitor there).
- Capability signal: `tN_padmap` handler sets `inst->dsp_inbound_enabled = 1`. Survives DSP instance destroy/recreate (state load) because JS re-pushes on every `computePadNoteMap` recompute.

**On stock Schwung** (`shadow_inbound_pad_midi_active` undefined):
- JS path unchanged. `S.dspInboundEnabled = false`, no padmap push, DSP gate stays 0, `on_midi` (not called by shim) is dormant.
- Identical behavior to pre-Phase-1 builds.

**JS-side gate sites** marked with `PHASE-1: remove when patches upstreamed` for the eventual cleanup pass when the shim patches land in official Schwung:
- `computePadNoteMap` push (entire block).
- `liveSendNote` ROUTE_MOVE branch (note-event skip).
- `liveSendNote` ROUTE_SCHWUNG branch (note-event skip).
- `init()` capability detection.

**DSP-side gate sites** marked similarly:
- `on_midi` early-return on `!dsp_inbound_enabled`.
- `tN_padmap` handler's `dsp_inbound_enabled = 1` line.

---

## What's NOT done yet (resume here next session)

### Open work

1. **Bundle 1.6 — TARP + count-in interaction.** Pre-existing bug surfaced during Bundle 1.5 device test; user verified happens at `loop_start=0` too. Two structural pieces:
   - **No TARP playback during count-in.** `tarp_fire_step` is driven by `tarp_tick`, which only runs during regular playback (`inst->playing=1`). During count-in `playing=0`, so the TARP engine is frozen. Count-in tick loop at `seq8.c:6383` only decrements `count_in_ticks` and runs the metronome — nothing else ticks. Fixing this means wiring TARP advancement into the count-in loop while keeping the playhead/clip side dormant.
   - **No TARP capture during count-in.** `tarp_fire_step`'s clip-write at `seq8.c:4078` is gated on `tr->recording=1`, which only flips on AT count-in end. Capture during preroll needs an analogous branch — slot snapshot during last 1/8 note, tracking arp-fired notes instead of pad presses.
   - **"Maybe missing step-0 capture"** — likely fallout from (1)/(2), not a third bug.
   - Scope: small sub-feature ("TARP-aware count-in"), not a one-liner. Read `tarp_tick` / `tarp_fire_step` and the count-in tick loop together before patching.

2. **Bundle 2 — VelIn + drum velocity zones + Note Repeat audio-thread path.** Per the original Phase 1 plan. Currently these features live in the JS path which Bundle 1 suppresses for note events on patched Schwung. See `notes/phase-1-plan.md` for the bundle breakdown.

3. **End-of-refactor coordinated drop** — when ALL phase-1 bundles are done:
   - Merge `legsmechanical/schwung:phase-1-inbound` → `legsmechanical/schwung:main`, push fork.
   - Merge `phase-1-bundle-1` (+ later bundle branches) → `legsmechanical/schwung-davebox:main`, push origin.
   - Regenerate `patches/davebox-local.patch` via `git -C ~/schwung diff v0.9.13..main -- src/` and commit on dAVEBOx main.
   - Cut release (probably `0.5.0`+).
   - Do NOT do any of this mid-refactor — see `feedback_phase_1_no_main_until_done.md`.

### Already done (confirmed)

- ~~**Vanilla Schwung fallback test**~~ — **PASSED 2026-05-16.** Deployed v0.9.13 binaries from `/tmp/schwung-vanilla/schwung.tar.gz`. dAVEBOx detected `shadow_inbound_pad_midi_active` absent → `S.dspInboundEnabled=false` → pre-Phase-1 path. User confirmed: pad presses, recording, session-view clip-launch all work as before. Patched binaries restored after test (backups at `*.patched.bak` on Move).
- ~~**Bundle 1.5 (count-in preroll + window-aware recording)**~~ — **VERIFIED + COMMITTED + PUSHED 2026-05-16.** Commit `a46bb3c`. See CHANGELOG `[Unreleased]` for user-facing summary.
- ~~**Commit the uncommitted slot-fix + session-view-gate + drum-lane-assign work**~~ — **DONE.** Five commits on the branch as listed above. All pushed to `origin/phase-1-bundle-1`.

---

## Bundle 1.5 — shipped (reference)

Bundle 1.5 (commit `a46bb3c`) folded two related fixes:

1. **Count-in preroll capture window.** Presses in the first 7/8 of count-in are monitored only; presses in the last 1/8 land at `loop_start * tps` when transport flips. Filter is in DSP `on_midi` (last 1/8 note = `count_in_ticks <= PPQN/2`). JS-side `recordCountingIn` gate dropped — DSP is authoritative on patched. `record_count_in` handler clears slot active flags so stale flags don't leak. Slot-mandatory rule on patched: record handlers `continue` if no active on_midi slot (drops filtered preroll presses).

2. **Window-aware recording.** Every recording path was collapsing window-anchored ticks with `% (length * tps)` before insertion, stripping `loop_start`. All sites — record_note_on/off, drum_record_note_on/off, tarp_fire_step, finalize_pending_notes — now treat `current_clip_tick` / slot snapshots as already window-anchored. Drum write/close-gate bounds widened from `step < length` to `step < (loop_start + length)`; drum wrap math returns to `loop_start` instead of 0 at window end. Unsigned-wraparound gate math for window-crossing held notes verified correct.

**Why folded into one commit:** the count-in preroll uses a synthetic tick = `loop_start * tps`; without the window-aware fix, that would be modulo'd by `length*tps` to 0 for `loop_start=length` clips. They're coupled.

---

## Device-test plan (run before merging)

Goal: ~1 hour of real-music playing on patched Schwung. Hit the things below. Anything weird that isn't on the "expected NOT to work" list is a real regression.

### Expected NOT to work (Bundle 2/3 territory — DO NOT flag as bugs)

These features still live in the JS path which Phase 1 suppresses for note events on patched Schwung. They'll be ported in later bundles.

| Feature | What's missing | Bundle |
|---|---|---|
| **VelIn (per-track velocity override)** | JS applies `trackVelOverride` in `liveSendNote` — now skipped for notes. `on_midi` dispatches with raw pad velocity. VelIn knob no-op for pad presses. | 2 |
| **Drum velocity zones** | Right-half pad presses still arm a zone in JS state, but the actual velocity hitting the lane is raw d2 from `on_midi`, not the zone-derived value. | 2 |
| **Note Repeat (Rpt1 / Rpt2)** | JS pad-press handler fires the repeat pattern. With JS note dispatch suppressed, repeats don't fire on pad input. (Repeats DURING sequencer playback still work — those run from DSP step-fire.) | 2 |
| **Count-in preroll chord capture** | JS captures notes during count-in via `pendingPrerollNotes`. With JS suppressed, preroll captures may not work correctly. | 3 |

### Expected TO work — verify these

- **Chord cohesion** — press 3-4 pads simultaneously; should sound tight (no late notes). This is the actual Bundle 1 win.
- **Single-note latency** — should feel snappier than pre-Phase-1.
- **TARP, NOTE FX, HARMZ, MIDI DLY on melodic** — `live_note_on` routes through the pfx chain so these effects apply to live pad input.
- **Melodic recording** when armed — records AND monitors, no doubles.
- **Drum recording** when armed — drum lane fires, records, no doubles.
- **Octave shift** (Up/Down arrows on melodic) — already verified, but re-confirm under real use.
- **Drum lane page paging** (Up/Down on drum) — already verified.
- **Track switching** — Shift+pad and Shift+jog both.
- **Step playback** — untouched DSP render path; should be unchanged.
- **External MIDI in via cable 2** (USB MIDI input) — separate `on_midi` path; should be untouched.
- **Looper capture** — `pfx_send` captures emitted notes; should work.
- **ROUTE_EXTERNAL output** — USB MIDI out; JS path preserved for that.

### Edge cases worth probing

- **State load / set switch.** Switch sets while dAVEBOx is open. DSP destroys & recreates the instance. The first pad press AFTER the switch may be silent — `pad_note_map` and `dsp_inbound_enabled` are reset, and nothing re-pushes `tN_padmap` until the user does something that triggers `computePadNoteMap` (octave shift, track switch, key change, etc.). If this happens, the fix is to add an explicit `computePadNoteMap()` call in the `pendingDspSync` completion path (after `restoreUiSidecar(true)`).
- **Schwung overtake exit + re-entry.** Does `S.dspInboundEnabled` survive a Shift+Back + re-enter cycle? Should, but worth checking.
- **Rapid chord stress test.** Tight succession of chord on/off events. Watch for stuck notes or dropped events.
- **Stock-Schwung fallback** (if a stock build is around). Confirm no regression on unpatched Schwung.

---

## Critical lessons learned this session

1. **Schwung host silently drops module-defined global set_param keys.** Only per-track-prefixed (`tN_*`) keys reliably reach DSP. Burned many cycles before discovering. Solution: piggyback signals onto an existing `tN_*` push (e.g. `tN_padmap` handler now also sets `active_track` and `dsp_inbound_enabled`). Memory saved at `feedback_schwung_drops_global_set_param.md`.
2. **DSP instance destroy/recreate (state load path) wipes runtime flags.** Initial JS pushes happen BEFORE the recreate, so any one-shot init push is lost. Solution: push on every relevant action so any recompute restores the flag. Memory: see `feedback_create_instance_loads_state` (existing).
3. **`host_module_set_param('debug_log', msg)` is unreliable in practice.** The DSP handler exists and `seq8_ilog` works internally, but JS-initiated calls were never observed reaching the log in this session. Don't trust this pattern. Memory updated.
4. **`shadow_*` JS functions ARE exposed to module JS context** despite being registered in shadow_ui's own JS context — confirmed by the corun pattern. Worth verifying if confused about scope.
5. **Recording double-monitor caveats are route-dependent.** ROUTE_MOVE: `record_note_on` inline-monitors (so on_midi must skip when armed). ROUTE_SCHWUNG: `record_note_on` does NOT monitor (so on_midi must dispatch even when armed). Different gates per route.
6. **JS dispatch path applies `trackOctave * 12` at dispatch time, not in `computePadNoteMap`.** Phase 1 must bake the offset into the DSP push to preserve the behavior. Leave `S.padNoteMap` itself unshifted so stock fallback still works correctly.

---

## File state at end of session

```
On branch phase-1-bundle-1 (in sync with origin/phase-1-bundle-1)
Working tree clean (no Bundle 1.5 leftovers)
Untracked (notes, intentionally not committed):
  notes/DISCORD_INTRO_POST.md
  notes/RECORDING_LATENCY_EXPERIMENT.md
  notes/audit-davebox-arch.md
```

All Bundle 1 + 1.5 work committed and pushed. Resume next session from this branch — do NOT merge to main per discipline rule above.

## Verification scenarios run this session

All against the latest tree, on patched Schwung, post-count-in:

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | 16-step hold | ✓ | gate=372 ticks ≈ 15.5 steps (sub-step hardware precision) |
| 2 | Staccato | ✓ | gates 10-15 ticks ≈ 0.4-0.6 step (user's hand precision) |
| 3 | Chord cohesion | ✓ | 3-note chord, all on_ticks within 1 tick of each other |
| 4 | Drum simultaneous | ✓ | user heard tight, by ear |
| 5 | TARP+armed | ✓ | arp fired, notes recorded |
| 6 | Cross-clip-wrap | ✓ (incidental) | chord test: one note released at clip_tick=2 (post-wrap), gate=388 = 768 - 382 + 2 (correct wrap branch) |
| -- | Count-in path | ✗ (known) | gate=12.5 steps when 16 held — see Bundle 1.5 plan |
