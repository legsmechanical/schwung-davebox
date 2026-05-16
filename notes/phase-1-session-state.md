# Phase 1 Bundle 1 — Session Checkpoint

**Saved:** 2026-05-15 → updated 2026-05-16.
**Status:** **✓ BUNDLE 1 COMPLETE on `phase-1-bundle-1`.** Architecture verified on device for melodic + drum tracks, ROUTE_MOVE + ROUTE_SCHWUNG, monitoring + recording. Stock-Schwung fallback preserved via capability gate. Not yet merged to `main`.

---

## Commits on phase-1-bundle-1 (off main)

- `78f9275` piece 1 — DSP scaffold: `dsp_inbound_enabled` flag, `pad_note_map[8][32]` storage, `on_midi` parse+filter+log, `tN_padmap` set_param handler.
- `000e30e` piece 2 — JS `computePadNoteMap` pushes `tN_padmap` to DSP on every recompute. Padmap handler also piggybacks `active_track` sync.
- `ac3c3c2` piece 3 — capability gate (`shadow_inbound_pad_midi_active`), `on_midi` dispatch via `live_note_on/off`, JS suppression in `liveSendNote` for ROUTE_MOVE + ROUTE_SCHWUNG. Padmap handler also sets `dsp_inbound_enabled = 1` (capability signal piggybacked).
- `73295f0` drum mode — `computePadNoteMap` branches: drum tracks push lane `midi_notes`; right-half pads emit 0xFF (vel zones aren't note dispatch).
- `d3fb587` trackOctave — bake runtime octave shift into DSP padmap push; resync on Up/Down arrows (also handles `drumLanePage` change).

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

1. **Device-test pass before merge.** This session was long and made several pivots; recommend an hour of real-music playing on patched Schwung in a fresh session before merging `phase-1-bundle-1` → `main`.
2. **Merge & release.** Per plan: cut a release between bundles. Will need to merge both `legsmechanical/schwung:phase-1-inbound` → `main` (shim sentinel) and `phase-1-bundle-1` → `main` (dAVEBOx). Regenerate `patches/davebox-local.patch`.
3. **Edge cases worth poking at:**
   - State load / set switch (DSP destroy/recreate path — does the first pad press after recreate work, or is there a gate-not-set window?).
   - Schwung overtake exit + re-entry (does S.dspInboundEnabled remain true; is the JS path resilient?).
   - Rapid chord stress test — many notes in tight succession.
   - Drum velocity zones in patched mode (right-half pad presses for vel-arm).
   - Recording on drum tracks (drum_record_note_on path).

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
On branch phase-1-bundle-1 (5 commits ahead of main)
Untracked:
  notes/DISCORD_INTRO_POST.md
  notes/RECORDING_LATENCY_EXPERIMENT.md
  notes/audit-davebox-arch.md
```

All Bundle 1 work is committed. The three untracked notes files are unrelated to Phase 1.
