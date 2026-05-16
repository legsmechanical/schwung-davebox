# Phase 1 Bundle 1 — Session Checkpoint

**Saved:** 2026-05-15 → updated 2026-05-16.
**Status:** **✓ FEASIBILITY CONFIRMED.** Pad presses on Move reach overtake DSP's `on_midi` on the audio thread with full velocity, source = `MOVE_MIDI_SOURCE_INTERNAL`. Phase 1 architecture is proven viable. Bundle 1 implementation can proceed.

> ✓ **Both branches now have durable commits.** `schwung-davebox:phase-1-bundle-1` at `61f3086` (rebased onto v0.4.0). `legsmechanical/schwung:phase-1-inbound` at `8a853010`. Branch-swap-clobber risk eliminated.

> ✓ **Builds done locally.**
> - Shim: `~/schwung/build/schwung-shim.so` — has the corrected insertion in `shadow_inprocess_process_midi`.
> - dAVEBOx: `dist/davebox/dsp.so` + `dist/davebox-module.tar.gz` — has the `on_midi` log body via `seq8_ilog`.

> ⏸ **Deploy + test deferred** — Move was offline at multiple deploy attempts in this session, and the user is now away from the device.

---

## ✓ Feasibility-confirmed evidence (2026-05-16)

After resolving the deploy-path bug (see Lesson 6 below), with the patched shim actually loaded into `MoveOriginal`:

```
[probe] on_midi src=0 len=3 90 57 28   ← pad note 0x57 (87) on, vel 0x28 (40)
[probe] on_midi src=0 len=3 80 57 00   ← pad note 0x57 off
[probe] on_midi src=0 len=3 90 5a 21   ← pad note 0x5a (90) on, vel 0x21 (33)
... (36 pad events total during a few presses)
```

All events: cable 0 internal, status 0x80/0x90, d1 in pad range 0x44–0x5F (68–95), velocities 0x01–0x37. Clean on/off pairs. `MOVE_MIDI_SOURCE_INTERNAL == 0` (not 1 as I'd assumed). The audio-thread MIDI hook works exactly as Phase 1 needs.

**Working insertion location:** `~/schwung/src/schwung_shim.c` inside `shim_post_transfer`'s overtake branch (just before `shadow_ui_midi_publish` at ~line 6674). Reads from `src = hardware_mmap_addr + MIDI_IN_OFFSET`. Filter: `overtake_mode == 2 && cable == 0 && (type == 0x90 || type == 0x80) && d1 >= 10`. Commit `a58f557f` on `legsmechanical/schwung:phase-1-inbound`.

---

## Where to resume

1. Read `notes/phase-1-plan.md` (the plan) and this file (the live state).
2. Build + deploy the latest fork branch (see "Next step" below).
3. Press pads on Move, check `seq8.log` for `[probe] on_midi` lines.
4. If they fire on internal pad presses (src=1 = `MOVE_MIDI_SOURCE_INTERNAL`) → feasibility confirmed; start full Bundle 1 implementation.
5. If still 0 events → call advisor with the per-block / function-cadence question.

---

## Active branches (uncommitted)

- **`schwung-davebox:phase-1-bundle-1`** (off main)
  - `dsp/seq8.c` line ~4753: `on_midi()` body populated. Logs `[probe] on_midi src=N len=M XX YY ZZ` via `seq8_ilog`. Includes a `mkdir("/tmp/onmidi_called", 0755)` discriminator — KEEP for now but note that `/tmp` markers proved unreliable on this device (DSP process appears to have isolated `/tmp` namespace). **`seq8_ilog` to `seq8.log` is the only reliable signal.** mkdir line is safe to remove eventually but no rush.

- **`legsmechanical/schwung:phase-1-inbound`** (off main, v0.9.13 base)
  - `src/schwung_shim.c`: **NEW pad-MIDI delivery inserted at end of `shadow_inprocess_process_midi()` (~line 1255)**. Scans `global_mmap_addr + MIDI_IN_OFFSET` for cable-0 note events with `d1 >= 10`, delivers to `overtake_dsp_gen->on_midi(MOVE_MIDI_SOURCE_INTERNAL)` (with `overtake_dsp_fx` fallback). Mirrors the cable-2 external delivery pattern at line 1245.
  - Previous (wrong) insertion at `shim_post_transfer` around line 6643 has been **reverted**. Mkdir markers A/B/C also removed.

---

## Critical findings from this session

### F1: `shim_post_transfer` is the WRONG function
The audit (Audit-3 §3.2) referenced `shadow_filter_move_input` — that's a **descriptive label**, not a real function name. The agent's earlier insertion plan landed inside `shim_post_transfer`'s MIDI_IN scan loop. That scan does run, but **internal pad presses don't traverse it** in overtake mode 2. Marker A at the top of `if (overtake_mode && shadow_ui_midi_shm)` (line 6608) never fired, yet JS pad input works fine — proof that pads reach JS via a different route.

### F2: `shadow_inprocess_process_midi` IS the right function
- Called per-audio-block from line 4530 (surrounded by `TIME_SECTION_START/END` profiling).
- Already houses the two existing overtake `on_midi` delivery sites (lines 1157 and 1245 — cable-0 realtime, cable-2 musical external).
- Already reads `MIDI_IN` at line 1216 for echo detection. So `MIDI_IN` is accessible from here.
- Explicit comment at lines 1118-1121 says "MIDI_IN (internal controls) is NOT routed to DSP here" — **Phase 1's job is to change that**.

### F3: `on_midi` consumption works on this platform
Proven by the existing cable-2 path firing for "All Notes Off" panic events on dAVEBOx init:
```
[probe] on_midi src=2 len=3 b0 7b 00
[probe] on_midi src=2 len=3 b1 7b 00
... (16 channels)
```
This means `overtake_dsp_gen` is non-null when dAVEBOx is loaded, `on_midi` is callable, and `seq8_ilog` from the audio thread reaches `seq8.log`. **The DSP-side feasibility question is already answered: YES.** The only remaining question is whether internal pad MIDI is visible from inside `shadow_inprocess_process_midi`.

### F4: `mkdir` for discriminators is unreliable on Move
mkdir at the top of `on_midi` did not create `/tmp/onmidi_called` — but `seq8_ilog` lines emitted by the same function call DID appear. Conclusion: DSP process has an isolated `/tmp` (filesystem namespace, container, or similar). **Use `seq8_ilog` only.** Same caution applies if we ever want to instrument the shim side — write to a file via `fopen` to a known data-partition path, not mkdir to `/tmp`.

### F5: Audit-1 finding #1 + Audit-3 §3.2 dispatch table — both need an update
- Audit-1 finding #1 was already marked superseded (warning banner added).
- Audit-3 §3.2's "internal pad presses handled by `shadow_filter_move_input` (~6687–6741)" is **also imprecise** — that function name doesn't exist; the section described is `shim_post_transfer`'s MIDI_IN scan loop, which doesn't see pad presses in overtake mode 2. The actual answer for "where pad presses reach JS today" remains open — but it doesn't matter for Phase 1 design, because we're adding a NEW delivery path that bypasses JS entirely. Leave as an audit-housekeeping TODO for later.

---

## Next step — exactly what to do

**Probe is complete; feasibility confirmed.** The fork has commit `a58f557f` with the working pad-delivery. Start Bundle 1 implementation per `notes/phase-1-plan.md`:

1. **Replace the DSP-side probe** at `dsp/seq8.c::on_midi` (currently just `seq8_ilog` logging) with real pad-handling logic:
   - Extract source (INTERNAL vs EXTERNAL), pitch, velocity from `msg[]`.
   - For pad-note range (68–99) and `source == MOVE_MIDI_SOURCE_INTERNAL`, derive `padIdx = note - 68` and look up `pad_note_map[track][padIdx]` for the resolved pitch.
   - Route to `live_note_on`/`live_note_off` (melodic) or drum equivalent.

2. **Port `computePadNoteMap`** from JS to C. Rebake the per-track cache on `key` / `scale` / `scale_aware` / `pad_octave` / `pad_layout_chromatic` set_param.

3. **Add the capability gate in JS**: on init, dAVEBOx queries whether the patched shim's audio-thread pad-delivery is active (e.g. via a one-shot `get_param("dsp_inbound_audio_thread")`). If yes, JS skips `pendingLiveNotes` enqueue for pad notes. If no, falls back to today's JS path.

4. **Deploy + verify on device** at every step (use the dual-path deploy: `cp` to both `/data/UserData/schwung/` AND `/usr/lib/`).

5. **Cleanup pass at the end of Bundle 1**: delete `pendingLiveNotes`, `_drainLiveNotes`, `queueLiveNoteOn/Off`, and the `tN_live_notes` payload parser per `notes/phase-1-plan.md`'s cleanup section.

---

## Open task list (live)

- #8 [in_progress] Test probe + decide Bundle 1 go/no-go
- #12 [in_progress] Relocate insertion to shadow_inprocess_process_midi (code done, NOT yet built/deployed)

All earlier tasks completed.

---

## Files modified this session (uncommitted)

| Repo | Branch | File | Status |
|---|---|---|---|
| schwung-davebox | phase-1-bundle-1 | `dsp/seq8.c` | `on_midi` body added (lines ~4753-4767) |
| schwung-davebox | phase-1-bundle-1 | `notes/phase-1-plan.md` | full Phase 1 plan (durable) |
| schwung-davebox | phase-1-bundle-1 | `notes/phase-1-doc-cross-check.md` | doc cross-check (durable) |
| schwung-davebox | phase-1-bundle-1 | `notes/phase-1-shim-insertion-plan.md` | insertion plan (stale — see "Stale notes" below) |
| schwung-davebox | phase-1-bundle-1 | `notes/phase-1-session-state.md` | this file |
| `~/schwung` | phase-1-inbound | `src/schwung_shim.c` | new MIDI_IN scan inserted at end of `shadow_inprocess_process_midi` |

### Stale notes
`notes/phase-1-shim-insertion-plan.md` was written before this session discovered the function was wrong. It points to `shim_post_transfer` line 6740. **Do not follow that plan as-is.** The corrected location is `shadow_inprocess_process_midi` end-of-function (~line 1255 in the unpatched source). When stable, either update that file or delete it in favor of this checkpoint.

---

## Deployed state on Move right now

- `/data/UserData/schwung/schwung-shim.so` (md5: 5204407c6f95e8bac9ca75d240bb5f56, May 15 02:11) — has the **old broken insertion** at `shim_post_transfer` line 6643 + markers. Useless but harmless.
- `/data/UserData/schwung/modules/tools/davebox/` — has the `on_midi` body with mkdir + seq8_ilog.
- `/usr/lib/schwung-shim.so` — stock v0.9.13 (May 12).

After "Next step" deploy, the device shim will match the new local code.

---

## Lessons / patterns to remember

1. **`shadow_filter_move_input` is a label, not a function.** The audit cited line ranges referencing it; the actual function name is `shim_post_transfer`. Always grep for a function name before basing an insertion on it.
2. **mkdir-to-`/tmp` for debug markers fails silently** on Move (the DSP process has an isolated `/tmp` namespace). Use `seq8_ilog` via `on_midi` sentinels — that's the only reliable signal across the audio thread.
3. **Settle observable facts before pivoting code.** The advisor saved at least one full iteration by pointing out: deploy-binary-check + JS-pads-actually-working check + per-block-cadence check before another speculative shim variant.
4. **Uncommitted probe code is fragile.** Multi-session probe work on a branch should be committed at every save point (`wip:` is fine). Lost a DSP edit during a v0.3.6 → v0.4.0 release cycle because the file change was sitting uncommitted on `phase-1-bundle-1`.
5. **`shadow_inprocess_process_midi` and `shim_post_transfer` read DIFFERENT MIDI_IN buffers.** The former reads `global_mmap_addr + MIDI_IN_OFFSET` (stale); the latter reads `hardware_mmap_addr + MIDI_IN_OFFSET` (fresh, post-ioctl). For pad-press delivery, only `shim_post_transfer`'s buffer has the events. The existing cable-2 site at line 1245 in `shadow_inprocess_process_midi` works because it reads `global_mmap_addr + MIDI_**OUT**_OFFSET` (a third buffer entirely — Move's own output).
6. **`/usr/lib/schwung-shim.so` is the path MoveOriginal actually loads — NOT `/data/UserData/schwung/schwung-shim.so` as memory previously claimed.** In v0.9.13, the schwung-heal symlink-restoration behavior doesn't apply (verified empirically via `/proc/<pid>/maps`). Always deploy to BOTH paths and verify with `cat /proc/$(pidof MoveOriginal)/maps | grep schwung-shim`. Memory `[[schwung-shim-deploy-path]]` updated 2026-05-16.
7. **`MOVE_MIDI_SOURCE_INTERNAL == 0`**, not 1. Internal pad-source events log as `src=0`.
8. **The diagnostic discriminator pattern is invaluable:** when "didn't fire" could mean either "function not reached" or "filter conditions don't match," add a counter-gated sentinel `on_midi` call at the function entry with a distinguishable byte pattern (e.g. `0xFE 0xA1 0xA1`). The reliable signal that emerges tells you which half of the search space to keep investigating.
