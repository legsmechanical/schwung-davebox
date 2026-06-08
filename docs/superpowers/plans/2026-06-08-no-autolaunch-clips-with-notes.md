# No Auto-Launch For Focused Clips With Note Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Track View, stop implicitly auto-launching a track's focused clip when that clip has note data; only auto-launch empty focused clips.

**Architecture:** Add one shared helper `_focusedClipIsEmpty(t)` reading the existing note-content caches (`S.clipNonEmpty` / `S.drumClipNonEmpty`), then add `&& _focusedClipIsEmpty(...)` to the two implicit-launch guards: the running-transport track-switch block in `_switchActiveTrack`, and the focused-clip-by-default block at transport start.

**Tech Stack:** JavaScript (QuickJS on Move), bundled via `scripts/bundle_ui.py`. No JS unit-test runner — verification is build + deploy + on-device hands-on.

**Testing note:** ui.js runs only on the device under QuickJS; there is no Node/pytest harness. "Tests" here are an on-device test matrix (Task 4). Per project CLAUDE.md, do not claim done until verified on Move.

---

### Task 1: Add the `_focusedClipIsEmpty` helper

**Files:**
- Modify: `ui/ui.js` (insert immediately above `function _switchActiveTrack` at ~line 1337)

- [ ] **Step 1: Insert the helper**

Insert this function directly above the `/* Save the current S.activeBank ... */`
comment block that precedes `function _switchActiveTrack(newT)`:

```js
/* True when the track's currently-focused clip has NO note/hit data.
 * Note data only — CC-lane automation does not count (a CC-only clip is
 * "empty" here). Used to gate implicit focused-clip auto-launch so a clip the
 * user intentionally left off is not re-activated by scrolling / transport
 * start. */
function _focusedClipIsEmpty(t) {
    const c = S.trackActiveClip[t];
    return (S.trackPadMode[t] === PAD_MODE_DRUM)
        ? !S.drumClipNonEmpty[t][c]
        : !S.clipNonEmpty[t][c];
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/ui.js
git commit -m "feat(trackview): add _focusedClipIsEmpty note-data helper"
```

---

### Task 2: Gate the running-transport track-switch auto-launch

**Files:**
- Modify: `ui/ui.js:1347-1350` (the `if` condition inside `_switchActiveTrack`)

- [ ] **Step 1: Add the guard**

Change this condition:

```js
    if (S.playing && !S.sessionView
            && !S.trackClipPlaying[S.activeTrack]
            && !S.trackWillRelaunch[S.activeTrack]
            && S.trackQueuedClip[S.activeTrack] === -1) {
```

to add the empty-clip guard as the final term:

```js
    if (S.playing && !S.sessionView
            && !S.trackClipPlaying[S.activeTrack]
            && !S.trackWillRelaunch[S.activeTrack]
            && S.trackQueuedClip[S.activeTrack] === -1
            && _focusedClipIsEmpty(S.activeTrack)) {
```

- [ ] **Step 2: Update the block comment**

In the comment block directly above (lines ~1342-1346), change the final
sentence `Skip if already live or in Session View.` to:

```
     * Skip if already live, in Session View, or if the focused clip has note
     * data (a clip intentionally left off must not be re-launched by scroll). */
```

- [ ] **Step 3: Commit**

```bash
git add ui/ui.js
git commit -m "fix(trackview): don't auto-launch focused clip with notes on track scroll"
```

---

### Task 3: Gate the transport-start focused-clip auto-launch

**Files:**
- Modify: `ui/ui.js:2686-2694` (the focused-clip-by-default block in the
  `!S.playingPrev && S.playing` transport-start path)

- [ ] **Step 1: Add the guard**

Change this block:

```js
        if (!S.sessionView) {
            const _at = S.activeTrack;
            if (!S.trackClipPlaying[_at]
                    && !S.trackWillRelaunch[_at]
                    && S.trackQueuedClip[_at] === -1) {
                const _tac = S.trackActiveClip[_at];
                S.pendingDefaultSetParams.push({ key: 't' + _at + '_launch_clip', val: String(_tac) });
                S.trackQueuedClip[_at] = _tac;
            }
        }
```

to add the empty-clip guard:

```js
        if (!S.sessionView) {
            const _at = S.activeTrack;
            if (!S.trackClipPlaying[_at]
                    && !S.trackWillRelaunch[_at]
                    && S.trackQueuedClip[_at] === -1
                    && _focusedClipIsEmpty(_at)) {
                const _tac = S.trackActiveClip[_at];
                S.pendingDefaultSetParams.push({ key: 't' + _at + '_launch_clip', val: String(_tac) });
                S.trackQueuedClip[_at] = _tac;
            }
        }
```

- [ ] **Step 2: Commit**

```bash
git add ui/ui.js
git commit -m "fix(transport): don't auto-launch focused clip with notes on play"
```

---

### Task 4: Build, deploy, and verify on device

**Files:** none (build/deploy/test only)

- [ ] **Step 1: Bundle and install**

```bash
python3 scripts/bundle_ui.py && ./scripts/install.sh
```

Expected: bundler reports success; install.sh deploys and restarts the Move stack.

- [ ] **Step 2: Reboot/restart Move so JS reloads from disk**

`install.sh` restarts the stack automatically. Confirm the OLED comes back (not
blank). JS-only change → service restart is sufficient (no full OS reboot).

- [ ] **Step 3: On-device test matrix**

Do these by hand on the Move. For each, "scroll" means turn the jogwheel or
Shift+pad to change the active track in Track View.

1. **Clip with notes, currently stopped, transport running → scroll into it.**
   - Program notes into track 2's focused clip, then stop that clip (so the
     track is silent). Start transport. Scroll away to track 1, then scroll
     back to track 2.
   - Expect: track 2 stays SILENT. The stopped clip does NOT start.

2. **Empty focused clip, transport running → scroll into it.**
   - On a track whose focused clip has no notes, scroll into it while playing.
   - Expect: clip auto-launches as before (silent, but shown live) — unchanged.

3. **Clip with notes → press play from stopped.**
   - Stop transport. Focus a track whose focused clip has notes but is not the
     playing clip. Press Play.
   - Expect: that focused clip does NOT auto-start. Only clips you explicitly
     launched (or that were already playing) play.

4. **Empty focused clip → press play.**
   - Focus a track whose focused clip is empty. Press Play.
   - Expect: focused clip auto-launches as before — unchanged.

5. **Session View Shift+Clip still launches (regression check).**
   - In Session View, Shift+Clip a clip with notes.
   - Expect: it activates/launches exactly as today — unchanged.

6. **Track View clip-pad tap still launches (regression check).**
   - In Track View, tap a clip/scene pad for a clip with notes.
   - Expect: explicit launch works — unchanged.

7. **Drum track parity.**
   - Repeat cases 1 and 3 on a drum track (focused drum clip with hits, stopped).
   - Expect: same as melodic — stopped drum clip with hits is not re-launched by
     scroll or by play.

- [ ] **Step 4: Update changelogs**

Add entries under `[Unreleased]` → `### Fixes` in BOTH files:

`CHANGELOG.md` (user-facing, plain language):

```
- Scrolling between tracks (or pressing play) no longer restarts a clip you
  intentionally left stopped — only empty focused clips still go live
  automatically.
```

`notes/tech-changelog.md` (technical):

```
- Track View focused-clip auto-launch now gated on `_focusedClipIsEmpty(t)`
  (note-data only: `clipNonEmpty` / `drumClipNonEmpty`). Applied to both the
  running-transport block in `_switchActiveTrack` and the transport-start
  focused-clip-by-default block. A focused clip with notes is no longer
  re-launched implicitly; empty focused clips still auto-launch. CC-only clips
  count as empty by design.
```

- [ ] **Step 5: Update MANUAL.md if it documents this behavior**

Grep `MANUAL.md` for focused-clip / auto-launch wording
(`grep -in "focus\|auto-launch\|scroll" MANUAL.md`). If it states the focused
clip always goes live on scroll/play, update that sentence to note the
empty-only behavior. If MANUAL.md does not mention it, skip (no change needed).

- [ ] **Step 6: Commit docs**

```bash
git add CHANGELOG.md MANUAL.md
git commit -m "docs: note focused-clip auto-launch now empty-only"
```

(Do not `git add notes/` — it's gitignored and local-only.)

---

## Self-Review

**Spec coverage:**
- Rule (auto-launch only when empty) → Tasks 2 & 3.
- Both paths (scroll + transport start) → Task 2 (scroll), Task 3 (transport).
- Emptiness = note data only → Task 1 helper uses `clipNonEmpty`/`drumClipNonEmpty`.
- Unchanged: Session Shift+Clip, Track View pad tap, record-armed path → not
  touched; covered by regression cases 5 & 6.
- Net behavior verified by Task 4 matrix.

**Placeholder scan:** none — all code shown verbatim; doc steps conditional but
explicit.

**Type consistency:** `_focusedClipIsEmpty(t)` defined in Task 1, called with the
same signature in Tasks 2 (`S.activeTrack`) and 3 (`_at`). `PAD_MODE_DRUM`,
`S.trackActiveClip`, `S.clipNonEmpty`, `S.drumClipNonEmpty`, `S.trackPadMode` are
all existing globals in ui.js.
