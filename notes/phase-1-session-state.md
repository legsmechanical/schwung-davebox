# Phase 1 Bundle 1 — Session Checkpoint

**Saved:** 2026-05-15 → updated 2026-05-16 (mid-session).
**Status:** **✓ BUNDLE 1 + recording-tick slot fix VERIFIED on `phase-1-bundle-1`.** All 6 verification scenarios pass (5 explicit, 1 incidental). Monitoring + recording feel tight. Outstanding before merge: (a) vanilla-Schwung fallback test (build ready at `/tmp/schwung-vanilla/schwung.tar.gz`, not yet deployed), (b) Bundle 1.5 (count-in preroll path) per user direction — won't merge until that's done too.

---

## Commits on phase-1-bundle-1 (off main)

- `78f9275` piece 1 — DSP scaffold: `dsp_inbound_enabled` flag, `pad_note_map[8][32]` storage, `on_midi` parse+filter+log, `tN_padmap` set_param handler.
- `000e30e` piece 2 — JS `computePadNoteMap` pushes `tN_padmap` to DSP on every recompute. Padmap handler also piggybacks `active_track` sync.
- `ac3c3c2` piece 3 — capability gate (`shadow_inbound_pad_midi_active`), `on_midi` dispatch via `live_note_on/off`, JS suppression in `liveSendNote` for ROUTE_MOVE + ROUTE_SCHWUNG. Padmap handler also sets `dsp_inbound_enabled = 1` (capability signal piggybacked).
- `73295f0` drum mode — `computePadNoteMap` branches: drum tracks push lane `midi_notes`; right-half pads emit 0xFF (vel zones aren't note dispatch).
- `d3fb587` trackOctave — bake runtime octave shift into DSP padmap push; resync on Up/Down arrows (also handles `drumLanePage` change).

**Uncommitted on tree (verified working, awaiting Bundle 1.5 + vanilla test before commit):**
- Session-view padmap gate — pads in session view emit 0xFF so DSP `on_midi` skips dispatch.
- Drum lane note assign re-pushes padmap so on_midi reflects the new lane note.
- on_midi → live_note_on/off unconditionally (no skip when armed); record-path inline-monitor gated on `!inst->dsp_inbound_enabled` so monitor stays single-buffer regardless of armed state.
- **Recording-tick slot mechanism** — `on_midi` snapshots actual hardware press/release tick (audio thread); `record_note_on/off` + `drum_record_note_on/off` read from per-(track,pitch) and per-(track,lane) slots instead of `current_clip_tick` at handler arrival. Fixes the "press+release in same audio buffer → gate=1 tick" collapse. Slots cleared on recording-arm transition.

## Commits on `legsmechanical/schwung:phase-1-inbound` (off main, v0.9.13 base)

- `a58f557f` shim pad-delivery insertion (existed pre-session).
- `7aa0a0e9` capability sentinel `shadow_inbound_pad_midi_active()` exposed via shadow_ui.

Builds: dist/davebox-module.tar.gz current. `~/schwung/build/shadow/shadow_ui` deployed to `/data/UserData/schwung/shadow/` on Move.

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

## What's NOT done yet

1. **Bundle 1.5: count-in preroll fix** — see "Bundle 1.5 plan" below. User said: "i'm not interested in shipping anything until we're totally done. fine deferring count-in to 1.5 if that makes sense." So 1.5 lands before merge.
2. ~~**Vanilla Schwung fallback test**~~ — **PASSED 2026-05-16.** Deployed v0.9.13 binaries from `/tmp/schwung-vanilla/schwung.tar.gz`. dAVEBOx detected `shadow_inbound_pad_midi_active` absent → `S.dspInboundEnabled=false` → pre-Phase-1 path. User confirmed: pad presses, recording, session-view clip-launch all work as before. Patched binaries restored after test (backups at `*.patched.bak` on Move; can re-test stock by running the restore loop in reverse).
3. **Commit the uncommitted slot-fix + session-view-gate + drum-lane-assign work.** User hasn't asked for commit yet (per workflow rule). Commit shape: probably 3-4 logical commits — (a) session-view padmap + drum lane assign, (b) record-path inline-monitor gate, (c) recording-tick slot mechanism.
4. **Merge & release.** Per plan: cut a release between bundles. Will need to merge both `legsmechanical/schwung:phase-1-inbound` → `main` (shim sentinel) and `phase-1-bundle-1` → `main` (dAVEBOx). Regenerate `patches/davebox-local.patch`. Probable version: `0.5.0`.

---

## Bundle 1.5 plan — count-in preroll path

**Problem:** Pad presses during the recording count-in go through `pendingPrerollNotes` (ui.js L6952) → JS-computed gate via `dspPerJs = 384 / countInDur` heuristic → `step_<loop_start>_toggle` + `step_<loop_start>_gate` set_params. The JS tick math is approximate and durations come out ~20-30% short. The slot mechanism doesn't help because (a) JS doesn't call `recordNoteOn` during count-in (gated on `!recordCountingIn`), and (b) `tr->recording` is 0 in DSP during count-in so on_midi skips slot writes.

**Verified during this session:** user pressed during count-in → gate = 11.2/12.5 steps when 16 steps were held. Verified by reading log: `on_midi PRESS` never fired (recording=0 in DSP at press time); `rec_on` never fired (JS preroll path took it instead). On a separate test the user waited for count-in to end and got a perfect 15.5-step gate via slot path.

**Fix shape (proposed):**
- JS: change L6956 to push to `_recNoteOns` regardless of `recordCountingIn`. Drop the `pendingPrerollNotes` melodic-non-TARP branch — `_recNoteOns` flush is already gated on `!recordCountingIn` so the batch flushes precisely when DSP becomes ready. Keep `pendingPrerollNotes` for the TARP and drum branches for now (separate fix).
- DSP: extend `on_midi` slot-write to fire when `tr->record_armed || tr->recording`. Issue: during count-in `current_clip_tick` may be at the end of the previous loop. Need to special-case: if `record_armed && !recording`, write slot tick = 0 (synthetic "step 0 of upcoming pass"). Release captured normally once recording starts.
- Edge case: chord during count-in — slots are per-pitch so chord-cohesion preserved.
- Edge case: TARP+count-in — TARP branch in `recordNoteOn` is already pendingPrerollNotes-skipped, leave alone.
- Edge case: drum+count-in — leave on `pendingPrerollNotes` for this bundle.

**Verification protocol:** repeat the long-hold-from-step-0 test BUT press during count-in. Gate should come out within hardware press precision of expected (e.g., 15-16 steps for a 16-step hold).

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
On branch phase-1-bundle-1 (5 commits ahead of main + uncommitted slot fix on tree)
Modified (uncommitted):
  dsp/seq8.c           — slot storage in seq8_instance_t, on_midi snapshots
  dsp/seq8_set_param.c — slot reset on recording=1, record handlers read slots
  ui/ui.js             — session-view padmap gate, drum lane assign repush
Untracked:
  notes/DISCORD_INTRO_POST.md
  notes/RECORDING_LATENCY_EXPERIMENT.md
  notes/audit-davebox-arch.md
```

Original 5 Bundle 1 commits remain. The slot/gate/drum-assign work is verified but uncommitted — awaiting Bundle 1.5 + vanilla test before commit (per user direction: ship-when-totally-done).

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
