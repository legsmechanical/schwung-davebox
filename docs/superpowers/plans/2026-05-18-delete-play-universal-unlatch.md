# Delete+Play Universal Unlatch — Stopped-Branch Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When transport is stopped, Delete+Play should clear Rpt1, Rpt2, and TARP latches across all 8 tracks (mirroring the existing playing-branch behavior). Eliminates UI-vs-audio desync after the panic.

**Architecture:** Extract the per-track unlatch sweep that already exists inside the playing branch of `_onCC_transport` into a new JS helper `unlatchAllTracks()`. Call it from both transport-state branches. No DSP changes — existing `tN_tarp_latch=0` set_param already triggers `tarp_drop_latched()` → `tarp_silence()` on the DSP side.

**Tech Stack:** QuickJS (UI runtime on Move device), C (DSP, untouched), bash deploy scripts.

**Spec reference:** `docs/superpowers/specs/2026-05-18-delete-play-universal-unlatch-design.md`

**Notes for the engineer:**
- This codebase has **no JS unit test framework** — UI runs in QuickJS on a hardware device. Verification is **on-device manual testing** per the testing matrix at the end of this plan, not automated unit tests.
- **Do NOT run `git commit` without explicit user authorization** (per the user's project convention: "go ahead and implement" authorizes code+deploy, NOT commit; wait for "commit" before staging).
- Reboot after every deploy — Shift+Back does NOT reload JS from disk; full Move reboot is required.

---

## Task 1: Create branch and verify clean tree

**Files:** none modified — git state only.

- [ ] **Step 1: Verify clean working tree**

Run: `git -C /Users/josh/schwung-davebox status`
Expected: no uncommitted changes to source files. Untracked items in `notes/` and `.claude/` are fine.

- [ ] **Step 2: Confirm on `main` and up-to-date**

Run: `git -C /Users/josh/schwung-davebox branch --show-current && git -C /Users/josh/schwung-davebox fetch origin && git -C /Users/josh/schwung-davebox status -b`
Expected: branch is `main`, status shows "Your branch is up to date with 'origin/main'".

- [ ] **Step 3: Create and switch to feature branch**

Run: `git -C /Users/josh/schwung-davebox checkout -b feat-delete-play-unlatch-stopped-branch`
Expected: "Switched to a new branch 'feat-delete-play-unlatch-stopped-branch'".

---

## Task 2: Add `unlatchAllTracks()` helper to ui.js

**Files:**
- Modify: `ui/ui.js` — add new helper function

**Where to put it:** insert directly above `_onCC_transport` (currently at `ui.js:5482`). The helper is conceptually a transport-time utility called only from the Delete+Play sweep, so co-locating it with the consumer keeps the read-flow tight. Verify the exact insertion line by finding `function _onCC_transport(` first.

- [ ] **Step 1: Read the existing playing-branch sweep (sanity check)**

Run: `sed -n '5572,5605p' /Users/josh/schwung-davebox/ui/ui.js`
Expected: see the `/* Play: toggle transport... */` comment, the `if (S.deleteHeld)` block, and the inner per-track loop at lines 5586–5603 that this plan extracts.

- [ ] **Step 2: Add the helper above `_onCC_transport`**

Use the Edit tool. `old_string` is the function declaration line; `new_string` prepends the helper + a blank line.

```js
/* Universal unlatch sweep — clears Rpt1, Rpt2 latched lanes, and TARP latch
 * chip on every track. Called from both branches of the Delete+Play
 * handler so the gesture leaves UI mirrors and audio in agreement
 * regardless of transport state. DSP-side, tN_tarp_latch=0 invokes
 * tarp_drop_latched()→tarp_silence() to clear held-buffer entries and
 * cancel any sounding TARP note. */
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

function _onCC_transport(d1, d2) {
```

The `old_string` argument to Edit:
```
function _onCC_transport(d1, d2) {
```
The `new_string` argument is the full helper above (ending with the function declaration on its own line so the existing function body is unchanged).

---

## Task 3: Replace playing-branch inline loop with `unlatchAllTracks()`

**Files:**
- Modify: `ui/ui.js:5586–5603` — replace inline loop with helper call

- [ ] **Step 1: Edit the playing branch**

Use the Edit tool. `old_string` is the entire `else` (playing) branch's inner loop; `new_string` is the same with the loop replaced by `unlatchAllTracks();`.

`old_string`:
```js
                } else {
                    host_module_set_param('transport', 'deactivate_all');
                    /* Unlatch all latched play states — queued one-per-tick to avoid coalescing */
                    for (let _ut = 0; _ut < NUM_TRACKS; _ut++) {
                        if (S.drumRepeatLatched[_ut]) {
                            S.drumRepeatLatched[_ut] = false;
                            S.drumRepeatHeldPad[_ut] = -1;
                            S.drumRepeatHeldPadsStack[_ut].length = 0;
                            S.pendingDefaultSetParams.push({ key: 't' + _ut + '_drum_repeat_stop', val: '1' });
                        }
                        if (S.drumRepeat2LatchedLanes[_ut].size > 0) {
                            S.drumRepeat2LatchedLanes[_ut].forEach(function(lane) {
                                S.pendingDefaultSetParams.push({ key: 't' + _ut + '_drum_repeat2_lane_off', val: String(lane) });
                            });
                            S.drumRepeat2LatchedLanes[_ut].clear();
                        }
                        if (S.bankParams[_ut] && S.bankParams[_ut][5] && S.bankParams[_ut][5][7]) {
                            S.bankParams[_ut][5][7] = 0;
                            S.pendingDefaultSetParams.push({ key: 't' + _ut + '_tarp_latch', val: '0' });
                        }
                    }
                }
```

`new_string`:
```js
                } else {
                    host_module_set_param('transport', 'deactivate_all');
                    /* Unlatch Rpt1/Rpt2/TARP across all tracks — queued one-per-tick via pendingDefaultSetParams to avoid coalescing */
                    unlatchAllTracks();
                }
```

- [ ] **Step 2: Verify the edit took**

Run: `sed -n '5572,5595p' /Users/josh/schwung-davebox/ui/ui.js`
Expected: the `if (S.deleteHeld)` block now has both the `if (!S.playing)` panic branch and the `else` branch calling `unlatchAllTracks()` instead of the inline loop.

---

## Task 4: Add `unlatchAllTracks()` to the stopped branch

**Files:**
- Modify: `ui/ui.js` — inside the `if (!S.playing)` stopped branch of Delete+Play

The stopped branch currently fires `transport=panic` and clears `S.trackWillRelaunch[t]` / `S.trackQueuedClip[t]` per track in the same loop. Those are clip-launch state mirrors, separate from latch state — keep them. Add `unlatchAllTracks()` **after** that loop so all set_params get queued together.

- [ ] **Step 1: Edit the stopped branch**

Use the Edit tool.

`old_string`:
```js
                if (!S.playing) {
                    /* Stopped: panic clears will_relaunch + all clip state atomically for all tracks. */
                    host_module_set_param('transport', 'panic');
                    for (let t = 0; t < NUM_TRACKS; t++) {
                        S.trackWillRelaunch[t] = false;
                        S.trackQueuedClip[t]   = -1;
                    }
                } else {
```

`new_string`:
```js
                if (!S.playing) {
                    /* Stopped: panic clears will_relaunch + all clip state atomically for all tracks. */
                    host_module_set_param('transport', 'panic');
                    for (let t = 0; t < NUM_TRACKS; t++) {
                        S.trackWillRelaunch[t] = false;
                        S.trackQueuedClip[t]   = -1;
                    }
                    /* Mirror the playing-branch sweep so LEDs/UI stay in sync with audio panic. */
                    unlatchAllTracks();
                } else {
```

- [ ] **Step 2: Verify the edit took**

Run: `sed -n '5572,5600p' /Users/josh/schwung-davebox/ui/ui.js`
Expected: stopped branch ends with `unlatchAllTracks();` before the `} else {`.

---

## Task 5: Bundle UI

**Files:**
- Modify: `dist/davebox/ui.js` — auto-generated, do not edit by hand

- [ ] **Step 1: Run the bundler**

Run: `cd /Users/josh/schwung-davebox && python3 scripts/bundle_ui.py`
Expected: bundler output ending in something like "Wrote dist/davebox/ui.js (NNN.NN KB)". No errors.

- [ ] **Step 2: Confirm the helper made it into the bundle**

Run: `grep -c "unlatchAllTracks" /Users/josh/schwung-davebox/dist/davebox/ui.js`
Expected: `3` (one definition + two call sites).

---

## Task 6: Deploy to Move and reboot

**Files:** none modified locally — deploy step only.

- [ ] **Step 1: Verify Move is reachable**

Run: `ssh -o ConnectTimeout=3 ableton@move.local "echo ok"`
Expected: `ok`. If timeout, prompt the user — they need to power on Move and confirm it's on the network.

- [ ] **Step 2: Install the bundle**

Run: `cd /Users/josh/schwung-davebox && ./scripts/install.sh`
Expected: scp transfers complete, no errors.

- [ ] **Step 3: Reboot Move**

Run the restart command from root CLAUDE.md (single line):
```sh
ssh root@move.local "for name in MoveOriginal Move MoveLauncher MoveMessageDisplay shadow_ui schwung link-subscriber display-server schwung-manager; do pids=\$(pidof \$name 2>/dev/null || true); [ -n \"\$pids\" ] && kill -9 \$pids 2>/dev/null || true; done && /etc/init.d/move start >/dev/null 2>&1"
```
Expected: command completes silently. Move's display goes black, then boots back up. Wait ~15s for re-init.

---

## Task 7: On-device verification matrix

**Files:** none — manual testing.

**Important:** at each step, read the on-screen state out loud (or write it down). LEDs and chip indicators are the source of truth — if they don't match expected, the change has a bug.

- [ ] **Step 1: Test row 1 — Rpt1 latched + stopped**

Setup:
1. Load any set with at least one drum track. Make track 1 active (drum mode).
2. Press Play. Latch a Rpt1 pad on track 1 (Shift+pad on the Rpt1 lane — see MANUAL if unclear).
3. Press Stop.
4. Observe: the Rpt1 indicator (rate knob LED, per `feedback_perf_looper_knobs` pattern) should still show LATCHED.

Action: hold Delete, tap Play.

Expected: Rpt1 indicator clears immediately on the Move screen and LED. Pressing Play again resumes transport with NO Rpt1 firing.

- [ ] **Step 2: Test row 2 — Rpt2 lanes latched + stopped**

Setup:
1. On the same drum track, latch one or two Rpt2 lanes while playing.
2. Press Stop.
3. Observe: latched-lane LEDs still show latched.

Action: hold Delete, tap Play.

Expected: latched-lane LEDs clear. Pressing Play resumes with NO Rpt2 firing.

- [ ] **Step 3: Test row 3 — TARP latch chip ON + stopped**

Setup:
1. Switch to a melodic track. Open the TARP bank (bank 5).
2. Toggle the **Latch chip** (knob 7 / `bankParams[t][5][7]`) ON.
3. Play and hold a chord, then release.
4. Press Stop.
5. Observe: TARP latch chip indicator still shows ON in the bank LED.

Action: hold Delete, tap Play.

Expected: TARP latch chip flips OFF. Bank LED reflects this. If any TARP-driven notes were still sounding, they cease (rare with transport already stopped, but verify).

- [ ] **Step 4: Test row 4 — All three latched + stopped**

Setup:
1. Latch Rpt1 on track 1 (drum), Rpt2 lane(s) on track 2 (drum), TARP latch chip on track 3 (melodic).
2. Press Stop.

Action: hold Delete, tap Play.

Expected: ALL three clear in the single gesture. No partial state.

- [ ] **Step 5: Regression — repeat 1–4 while playing**

Setup: same as rows 1–4 but **leave transport playing** when pressing Delete+Play.

Expected: same outcomes (all latches clear), AND clips deactivate (`transport=deactivate_all`) — i.e., the playing-branch's existing behavior is unchanged.

- [ ] **Step 6: Report results**

If any step fails, STOP and report which step + what was observed vs expected. Do not proceed to docs/CHANGELOG. If all pass, continue.

---

## Task 8: Update MANUAL.md

**Files:**
- Modify: `docs/MANUAL.md` at lines 1288, 1622–1623, and 1703 (line numbers from the spec; re-locate by grep if shifted).

- [ ] **Step 1: Update L1288 (the inline paragraph)**

Use the Edit tool.

`old_string`:
```
Transport stop sends note-offs for sounding notes. Delete + Play (stopped) sends a full panic on all channels.
```

`new_string`:
```
Transport stop sends note-offs for sounding notes. Delete + Play (stopped) sends a full panic on all channels and clears Rpt1, Rpt2, and TARP latches across all tracks. Delete + Play (running) deactivates all clips and clears the same latches.
```

- [ ] **Step 2: Update the first appendix table (around L1622–1623)**

Use the Edit tool. Re-locate by reading the section around those line numbers first.

`old_string`:
```
| Delete + Play (running) | Deactivate all clips |
| Delete + Play (stopped) | MIDI panic |
```

`new_string`:
```
| Delete + Play (running) | Deactivate all clips + unlatch Rpt1/Rpt2/TARP on every track |
| Delete + Play (stopped) | MIDI panic + unlatch Rpt1/Rpt2/TARP on every track |
```

- [ ] **Step 3: Update the second appendix table (around L1703)**

Read the section first to confirm the exact context — there may be only a `running` row at L1703 with no matching `stopped` row.

If a single row exists, use Edit:

`old_string`:
```
| Delete + Play (running) | Deactivate all clips |
```

`new_string`:
```
| Delete + Play (running) | Deactivate all clips + unlatch Rpt1/Rpt2/TARP on every track |
| Delete + Play (stopped) | MIDI panic + unlatch Rpt1/Rpt2/TARP on every track |
```

If both rows already exist together (mirroring the L1622 table), apply the same edit as Step 2.

- [ ] **Step 4: Sanity-grep MANUAL for any other Delete+Play mentions**

Run: `grep -n -i "delete.*play\|delete + play" /Users/josh/schwung-davebox/docs/MANUAL.md`
Expected output: rows at L309, L516 (Shift + Delete + jog click — unrelated), L608 (Delete + Loop — unrelated), L881 (Delete + scene row — unrelated), L1288 (updated), L1202 (Shift + Delete — unrelated), L1616 (Shift + Delete — unrelated), L1622–L1623 (updated), L1703 (updated). If any unexpected new `Delete + Play` mentions exist, update them similarly.

---

## Task 9: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md` — add one line under `[Unreleased] → ### Fixes`

- [ ] **Step 1: Read the current `[Unreleased]` section**

Run: `sed -n '1,40p' /Users/josh/schwung-davebox/CHANGELOG.md`
Expected: see the `## [Unreleased]` heading followed by subsections (`### Features`, `### Fixes`, `### Performance / UX`, `### Documentation` as relevant; subsections appear only when they have content).

- [ ] **Step 2: Add the fix entry under `### Fixes`**

Use the Edit tool. The exact `old_string` depends on what's already in `### Fixes`. If `### Fixes` already has entries, append the new line at the bottom. If `### Fixes` doesn't exist, add it in the correct order (between `### Features` and `### Performance / UX` per existing convention).

Add this line:

```
- Delete + Play with transport stopped now clears Rpt1, Rpt2, and TARP latches across all 8 tracks. Previously only the playing-transport branch did the full sweep, leaving the LED / OLED state out of sync with the panic.
```

- [ ] **Step 3: Sanity-check the edit**

Run: `sed -n '1,40p' /Users/josh/schwung-davebox/CHANGELOG.md`
Expected: the new line appears in `### Fixes`.

---

## Task 10: Stage, await commit authorization, push

**Files:** none modified — git state only.

**STOP — do not run `git commit` until the user explicitly says "commit". Per project convention, "go ahead and implement" authorizes code+deploy, NOT commit.**

- [ ] **Step 1: Show the user the diff for review**

Run: `git -C /Users/josh/schwung-davebox status && echo "---" && git -C /Users/josh/schwung-davebox diff --stat`
Expected: lists `ui/ui.js`, `dist/davebox/ui.js`, `docs/MANUAL.md`, `CHANGELOG.md`, and the new spec/plan files in `docs/superpowers/`.

- [ ] **Step 2: Ask the user**

Wait for explicit "commit" or "go ahead and commit". Do NOT proceed otherwise.

- [ ] **Step 3 (after user authorizes): Stage and commit**

Run:
```sh
git -C /Users/josh/schwung-davebox add ui/ui.js dist/davebox/ui.js docs/MANUAL.md CHANGELOG.md docs/superpowers/specs/2026-05-18-delete-play-universal-unlatch-design.md docs/superpowers/plans/2026-05-18-delete-play-universal-unlatch.md
git -C /Users/josh/schwung-davebox commit -m "$(cat <<'EOF'
fix: Delete+Play stopped branch now unlatches Rpt1/Rpt2/TARP across all tracks

Mirrors the existing playing-branch sweep so the UI state mirrors stay in
sync with audio panic regardless of transport state. Pulls the per-track
unlatch loop out into a shared unlatchAllTracks() helper; both branches
of the Delete+Play handler call it. No DSP changes — existing tN_tarp_latch=0
already invokes tarp_drop_latched()→tarp_silence().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: clean commit. Pre-commit hooks pass.

- [ ] **Step 4: Fast-forward merge to main**

Per the `feedback_branching` memory: "Merge to main with fast-forward when the work is verified and approved."

Run:
```sh
git -C /Users/josh/schwung-davebox checkout main
git -C /Users/josh/schwung-davebox merge --ff-only feat-delete-play-unlatch-stopped-branch
```

Expected: fast-forward merge succeeds.

- [ ] **Step 5: Push main**

Run: `git -C /Users/josh/schwung-davebox push origin main`
Expected: push succeeds.

- [ ] **Step 6: Delete the feature branch**

Run: `git -C /Users/josh/schwung-davebox branch -d feat-delete-play-unlatch-stopped-branch`
Expected: branch deleted (was merged).

---

## Task 11: Update memory

**Files:** new memory entry, update MEMORY.md index.

- [ ] **Step 1: Mark the parked item shipped in `project_delete_play_universal_unlatch.md`**

The existing memory file at `/Users/josh/.claude/projects/-Users-josh-schwung-davebox/memory/project_delete_play_universal_unlatch.md` describes this as "parked." After the FF-merge, edit it to add a "## Shipped" section noting the commit SHA and date, OR delete the memory file entirely and remove its line from `MEMORY.md`. Pick whichever fits the user's preference at the time.

- [ ] **Step 2: Update the parked-items index**

Edit `/Users/josh/.claude/projects/-Users-josh-schwung-davebox/memory/project_next_session_parked_items.md` to remove item #4 (Delete+Play universal unlatch) from the list, since it's now shipped.

- [ ] **Step 3: Done**

End-of-task summary to user: "Delete+Play universal unlatch shipped. One parked item down, four to go: modal pad-interception remaining cases, drum repeats during count-in, drum repeat InQ behavior, per-track octave UX."
