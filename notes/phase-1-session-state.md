# Phase 1 Bundle 1 — Session Checkpoint

**Saved:** 2026-05-15. Pause point before usage-limit reset.
**Status:** Feasibility probe in progress. Uncommitted changes on two branches. Latest correction NOT yet built or deployed.

> ⚠️ **MAIN MOVED:** Between this session's start and pause, `main` got two new commits (drum-step quantization fix + `v0.4.0` release). `phase-1-bundle-1` is based on the older commit `0972aa1`. **Consider rebasing onto current main** before continuing. The user did this work in another session; if it conflicts with anything Phase 1 needs, raise it before resuming.

> ⚠️ **DSP edit was lost once and re-applied.** During the v0.3.6 checkout / main pull cycle that produced v0.4.0, the working-tree `on_midi` body got overwritten because it was never committed. Re-applied 2026-05-15. **Strongly recommend committing the WIP to `phase-1-bundle-1` before any further branch swap.** Suggested message: `wip(phase-1-bundle-1): probe — on_midi log body`. Same applies to the fork's `phase-1-inbound` branch.

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

1. **In `~/schwung` on `phase-1-inbound` branch:**
   ```sh
   ./scripts/build.sh
   ```
2. **Deploy + restart:**
   ```sh
   scp ~/schwung/build/schwung-shim.so root@move.local:/data/UserData/schwung/schwung-shim.so
   ssh root@move.local "for name in MoveOriginal Move MoveLauncher MoveMessageDisplay shadow_ui schwung link-subscriber display-server schwung-manager; do pids=\$(pidof \$name 2>/dev/null || true); [ -n \"\$pids\" ] && kill -9 \$pids 2>/dev/null || true; done && /etc/init.d/move start >/dev/null 2>&1"
   ```
3. Wait ~15s for Move. Launch dAVEBOx. Press a few pads.
4. **Check:**
   ```sh
   ssh root@move.local "grep '\[probe\] on_midi src=1' /data/UserData/schwung/seq8.log | tail -20"
   ```
   - `src=1` = `MOVE_MIDI_SOURCE_INTERNAL`. If lines appear with status `0x90 XX YY` where XX is in 68–99 (pad note range), **feasibility CONFIRMED**.
   - If only `src=2` (external) lines appear → internal pads still aren't visible from `shadow_inprocess_process_midi`. Diagnosis: shadow_ui process might read MIDI_IN before the shim gets a chance, or the buffer is cleared by an earlier shim site. Next move: call advisor with these findings.

5. **If confirmed:** mark task #8 + #12 complete. Start full Bundle 1 implementation per `notes/phase-1-plan.md` (skeleton + scale-aware port + capability gate + JS cleanup).

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

- The audit cited file-line ranges for `shadow_filter_move_input`. The label exists in comments; the function doesn't. **Always verify a function name with grep before basing an insertion on it.**
- mkdir-to-`/tmp` for debug markers fails silently on Move. **Use seq8_ilog or fopen-to-`/data/UserData/schwung/probe.txt`.**
- The advisor saved at least one full iteration by pointing out: deploy-symlink-conflict check + JS-pads-actually-working check + per-block-cadence check before another speculative shim variant. **Settle observable facts before pivoting code.**
- The actual diagnostic loop here was: probe → 0 events → narrower probe → still 0 → confirm signal reliability → call advisor → reframe → find right function. About 6 iterations. Could have been 2-3 if we'd grepped for `shadow_filter_move_input` (function vs label) at the start, before writing any code.
- **Uncommitted probe code is fragile.** Multi-session probe work on a branch should be committed at every save point (`wip:` is fine), not left in the working tree. Lost a DSP edit during a v0.3.6 → v0.4.0 release cycle because the file change was sitting uncommitted on `phase-1-bundle-1`. The release work touched main but the branch swap clobbered the working tree.
