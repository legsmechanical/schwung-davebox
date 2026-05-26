# Bank alt-param mode via jog-click — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "hold Shift to reveal alt params" interaction on track banks with a sticky `S.altMode` toggled by the jog-wheel click, indicated by a down-arrow header icon; the AUTO/CC bank gets a CC-assign ("Assign") mode.

**Architecture:** Pure JS/UI change in `ui/ui.js`, `ui/ui_state.mjs`, `ui/ui_persistence.mjs` (bundled by `scripts/bundle_ui.py`). A single transient flag `S.altMode` replaces `S.shiftHeld` at the 14 alt-param sites (and only those). Jog-click toggles it; a diff-guard in `drawUI()` clears it on bank/track/session change. No DSP, no state-format, no sidecar version change.

**Tech Stack:** QuickJS (NOT V8 — `node --check` is a coarse gate only), deployed to Ableton Move. Verification is on-device per `CLAUDE.md` (bundle → install → full reboot → hands-on check). No unit-test harness exists; "test" steps are device checks.

**Spec:** `docs/superpowers/specs/2026-05-25-bank-altmode-jog-click-design.md`

**Commit discipline:** Per repo convention, commit each task as one logical change AFTER the user authorizes (the repo rule is "never commit without explicit ask"). Device verification is batched into the final task (the "1.0-tweaks batch-verify" convention). If executing autonomously with prior commit authorization, commit per task as written.

**Reference — complete site inventory (all `S.shiftHeld` → `S.altMode`):**

Knob-handler write sites (`_onCC_knobs`):
- Drum DRUM LANE K2 nudge: `ui.js:7593`, `7595`
- Drum DRUM LANE K3 zoom: `ui.js:7619`
- Drum ALL LANES K2 nudge: `ui.js:7751`, `7753`
- Drum REPEAT GROOVE K1–K8 nudge: `ui.js:7885`
- Melodic DELAY K1 ClkF: `ui.js:8011`
- Melodic clock_shift effSens: `ui.js:8061`
- Melodic clock_shift nudge: `ui.js:8110`
- Melodic clip_resolution zoom: `ui.js:8141`
- AUTO/CC type ladder: `ui.js:7920`

Render sites (`drawUI`):
- Drum DRUM LANE labels/value: `ui.js:3576`, `3579`
- Drum ALL LANES label/value: `ui.js:3616`, `3619`
- Drum REPEAT GROOVE header/value: `ui.js:3663`, `3683`
- Melodic DELAY ClkF label/value: `ui.js:3778`, `3788`
- Melodic generic labels: `ui.js:3779-3782`
- Overview gate: `ui.js:3560-3563`

**Leave on `S.shiftHeld` (do NOT touch):** Rnd dialog `7991`/`3688`, pad bank/track select `8658`/`8683`, step-edit block `8629`, session quant `6276`/`7280`, Shift+step shortcuts `9308-9331`, Shift+Delete+jog reset `5988`, Delete+jog reset `6017`.

---

### Task 1: Add `altMode` state + `bankHasAltParams()` helper

**Files:**
- Modify: `ui/ui_state.mjs` (S object, near `shiftHeld: false` at line 35)
- Modify: `ui/ui.js` (add helper near other small predicates, e.g. just above `function applyBankParam` at line 2747)

- [ ] **Step 1: Add the state fields**

In `ui/ui_state.mjs`, find:
```javascript
    shiftHeld: false,
```
Add immediately after it:
```javascript
    altMode: false,        /* sticky alt-param mode, toggled by jog-click; transient */
    _altPrevBank: -1,      /* diff-guard mirror for clearing altMode on bank change */
    _altPrevTrack: -1,     /* diff-guard mirror for clearing altMode on track change */
```

- [ ] **Step 2: Add the helper**

In `ui/ui.js`, immediately above `function applyBankParam(t, bankIdx, knobIdx, val) {` (line 2747), insert:
```javascript
/* True when (track-type, bank) exposes alt params reachable via S.altMode.
 * Melodic: CLIP(0), DELAY(3), AUTO/CC(6 — CC-assign). Drum: DRUM LANE(0),
 * REPEAT GROOVE(5), ALL LANES(7). The CC bank is melodic-only (its knob handler
 * returns early for drum), so bank 6 is NOT an alt bank on drum tracks. Keep in
 * sync with the shiftHeld→altMode migration sites. */
function bankHasAltParams(t, bank) {
    if (S.trackPadMode[t] === PAD_MODE_DRUM) return bank === 0 || bank === 5 || bank === 7;
    return bank === 0 || bank === 3 || bank === 6;
}
```

- [ ] **Step 3: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: bundler prints success; `node --check` exits 0 (no syntax error). (QuickJS-specific issues are caught only on device.)

- [ ] **Step 4: Commit**
```bash
git add ui/ui_state.mjs ui/ui.js
git commit -m "feat(ui): add altMode state + bankHasAltParams helper"
```

---

### Task 2: Jog-click toggles altMode; remove drum perform-mode cycle

**Files:**
- Modify: `ui/ui.js:6080-6109` (in `_onCC_jog`)

- [ ] **Step 1: Replace the drum perform-mode block with the alt-toggle**

Find this block (lines 6089-6109 — the entire `/* Plain jog click on drum track: toggle Velocity / Repeat pad mode */` handler):
```javascript
    /* Plain jog click on drum track: toggle Velocity / Repeat pad mode */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const t = S.activeTrack;
        if (S.drumPerformMode[t] === 1) {
            host_module_set_param('t' + t + '_drum_repeat_stop', '1');
            S.drumRepeatHeldPad[t] = -1;
            S.drumRepeatHeldPadsStack[t].length = 0;
        }
        if (S.drumPerformMode[t] === 2) {
            S.drumRepeat2HeldLanes[t].clear();
            S.drumRepeat2LatchedLanes[t].clear();
            host_module_set_param('t' + t + '_drum_repeat2_stop', '1');
        }
        S.drumRepeatLatched[t]  = false;
        setDrumPerformMode(t, (S.drumPerformMode[t] + 1) % 3);
        showModePopup('PERFORMANCE PADS',
            ['Velocity', 'Repeat Play (Rpt1)', 'Repeat Set (Rpt2)'],
            S.drumPerformMode[t]);
        return;
    }
```
Replace the WHOLE block with:
```javascript
    /* Plain jog click on an alt-param bank: toggle sticky alt-param mode.
     * Perform-mode switching now lives only on Shift+step-8 (see _onStepButtons).
     * Banks 4/5 melodic (Arp Steps overlay) are handled by the block above and
     * have no alt params, so there is no collision. */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && bankHasAltParams(S.activeTrack, S.activeBank)) {
        S.altMode = !S.altMode;
        S.screenDirty = true;
        forceRedraw();
        return;
    }
```

- [ ] **Step 2: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: success, exit 0.

- [ ] **Step 3: Commit**
```bash
git add ui/ui.js
git commit -m "feat(ui): jog-click toggles altMode; drop drum perform-mode cycle"
```

---

### Task 3: Clear altMode on bank/track/session change + on suspend

**Files:**
- Modify: `ui/ui.js` (top of `drawUI()`, after the two co-run early-return blocks; the `if (S.moveCoRunTrack >= 0) { ... }` block ends shortly after line 3247)
- Modify: `ui/ui_persistence.mjs` (inside `saveState()` at line 150)

- [ ] **Step 1: Add the diff-guard in drawUI**

In `ui/ui.js`, inside `function drawUI()` (line 3228), AFTER the `if (S.moveCoRunTrack >= 0) { ... }` co-run block and BEFORE any bank-render logic, insert:
```javascript
    /* Alt-param mode is transient: any bank change, track change, or entering
     * Session View drops back to primary params. Diff-guard catches every
     * S.activeBank / S.activeTrack reassignment regardless of source. */
    if (S.altMode && (S.sessionView ||
            S.activeBank !== S._altPrevBank ||
            S.activeTrack !== S._altPrevTrack)) {
        S.altMode = false;
    }
    S._altPrevBank  = S.activeBank;
    S._altPrevTrack = S.activeTrack;
```

- [ ] **Step 2: Clear altMode on suspend**

In `ui/ui_persistence.mjs`, inside `export function saveState()` (line 150), add as the first statement of the function body:
```javascript
    S.altMode = false;   /* transient; never persisted across suspend/resume */
```

- [ ] **Step 3: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: success, exit 0.

- [ ] **Step 4: Commit**
```bash
git add ui/ui.js ui/ui_persistence.mjs
git commit -m "feat(ui): clear altMode on bank/track/session change + suspend"
```

---

### Task 4: Migrate render-side alt-param sites (shiftHeld → altMode)

**Files:**
- Modify: `ui/ui.js` render sites listed below

- [ ] **Step 1: Overview-render gate (3560-3563)**

Find:
```javascript
    if (bank >= 0 && (S.knobTouched >= 0 || inTimeout ||
            (S.shiftHeld && bank === 5 && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) ||
            (bank === 6 && !S.sessionView && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) ||
            (S.shiftHeld && (bank === 1 || bank === 3) && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM))) {
```
Replace with (keeps bank-1 melodic on Shift for the Rnd dialog; alt banks now driven by altMode):
```javascript
    if (bank >= 0 && (S.knobTouched >= 0 || inTimeout ||
            (S.altMode && bankHasAltParams(S.activeTrack, bank)) ||
            (bank === 6 && !S.sessionView && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) ||
            (S.shiftHeld && bank === 1 && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM))) {
```

- [ ] **Step 2: Drum DRUM LANE labels + value (3576, 3579)**

Find:
```javascript
            const drumLaneLabels = ['Stch', S.shiftHeld ? 'Nudg' : 'Shft', S.shiftHeld ? 'Zoom' : 'Res', 'Eucl', 'Len', 'SqFl', null, null];
```
Replace with:
```javascript
            const drumLaneLabels = ['Stch', S.altMode ? 'Nudg' : 'Shft', S.altMode ? 'Zoom' : 'Res', 'Eucl', 'Len', 'SqFl', null, null];
```
Then find (line 3579, inside `drumLaneVals`):
```javascript
                fmtSign(S.bankParams[t][0][1]),
```
This line renders the K2 value (clock_shift delta or nudge). It does not branch on shift today (the stored mirror already holds whichever was last written), so leave it unchanged — the label swap above is sufficient. (No edit needed at 3579.)

- [ ] **Step 3: Drum ALL LANES label (3616)**

Find:
```javascript
            const allLabels = ['Stch', S.shiftHeld ? 'Nudg' : 'Shft', 'Qnt', 'VelIn', 'InQ', 'SyncRpt', null, null];
```
Replace with:
```javascript
            const allLabels = ['Stch', S.altMode ? 'Nudg' : 'Shft', 'Qnt', 'VelIn', 'InQ', 'SyncRpt', null, null];
```
(Line 3619 `fmtSign(S.bankParams[t][7][1])` renders the stored mirror; no shift branch there → no edit.)

- [ ] **Step 4: Drum REPEAT GROOVE header + per-step value (3663, 3683-3685)**

Find:
```javascript
        pixelPrint(S.shiftHeld ? 94 : 106, 2, S.shiftHeld ? 'NUDGE' : 'VEL', 0);
```
Replace with:
```javascript
        pixelPrint(S.altMode ? 94 : 106, 2, S.altMode ? 'NUDGE' : 'VEL', 0);
```
Then find:
```javascript
            const disp = S.shiftHeld
                ? (ndg === 0 ? ' 0%' : (ndg > 0 ? '+' : '') + ndg + '%')
                : vs + '%';
```
Replace with:
```javascript
            const disp = S.altMode
                ? (ndg === 0 ? ' 0%' : (ndg > 0 ? '+' : '') + ndg + '%')
                : vs + '%';
```

- [ ] **Step 5: Melodic DELAY ClkF label + value (3778, 3788-3790)**

Find:
```javascript
            const _delayShiftClkF = S.shiftHeld && !_isDrum && bank === 3 && k === 0;
```
Replace with:
```javascript
            const _delayShiftClkF = S.altMode && !_isDrum && bank === 3 && k === 0;
```

- [ ] **Step 6: Melodic generic label flips (3779-3782)**

Find:
```javascript
            if (S.shiftHeld) {
                if      (knobs[k].dspKey === 'clock_shift')    _lbl = 'Nudg';
                else if (knobs[k].dspKey === 'clip_resolution') _lbl = 'Zoom';
                else if (_delayShiftClkF)                       _lbl = 'ClkF';
            }
```
Replace with:
```javascript
            if (S.altMode) {
                if      (knobs[k].dspKey === 'clock_shift')    _lbl = 'Nudg';
                else if (knobs[k].dspKey === 'clip_resolution') _lbl = 'Zoom';
                else if (_delayShiftClkF)                       _lbl = 'ClkF';
            }
```

- [ ] **Step 7: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: success, exit 0.

- [ ] **Step 8: Commit**
```bash
git add ui/ui.js
git commit -m "feat(ui): render alt-param labels from altMode (was shiftHeld)"
```

---

### Task 5: Migrate knob-handler alt-param write sites (shiftHeld → altMode)

**Files:**
- Modify: `ui/ui.js` knob-handler sites listed below

- [ ] **Step 1: Drum DRUM LANE K2 nudge (7593, 7595)**

Find:
```javascript
                if (S.knobAccum[knobIdx] >= (S.shiftHeld ? 4 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.shiftHeld) {
                        /* Shift+Shft = Nudge */
```
Replace with:
```javascript
                if (S.knobAccum[knobIdx] >= (S.altMode ? 4 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        /* alt = Nudge */
```

- [ ] **Step 2: Drum DRUM LANE K3 zoom (7619)**

Find (the line inside the `knobIdx === 2` block):
```javascript
                        if (S.shiftHeld) {
                            /* Zoom: absolute note positions fixed, step grid shifts, length adjusts */
```
Replace with:
```javascript
                        if (S.altMode) {
                            /* Zoom: absolute note positions fixed, step grid shifts, length adjusts */
```

- [ ] **Step 3: Drum ALL LANES K2 nudge (7751, 7753)**

Find:
```javascript
                if (S.knobAccum[knobIdx] >= (S.shiftHeld ? 1 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.shiftHeld) {
                        S.bankParams[t][7][1] += dir;
```
Replace with:
```javascript
                if (S.knobAccum[knobIdx] >= (S.altMode ? 1 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        S.bankParams[t][7][1] += dir;
```

- [ ] **Step 4: Drum REPEAT GROOVE nudge (7885)**

Find:
```javascript
                const step = knobIdx;
                if (S.shiftHeld) {
                    const nv = Math.max(-50, Math.min(50, (S.drumRepeatNudge[t][lane][step] | 0) + dir));
```
Replace with:
```javascript
                const step = knobIdx;
                if (S.altMode) {
                    const nv = Math.max(-50, Math.min(50, (S.drumRepeatNudge[t][lane][step] | 0) + dir));
```

- [ ] **Step 5: Melodic DELAY ClkF write (8011)**

Find:
```javascript
        if (S.shiftHeld && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
                bank === 3 && knobIdx === 0) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 1) {
                S.knobAccum[knobIdx] = 0;
                const nv = Math.max(-100, Math.min(100, (S.delayClockFb[t] | 0) + dir));
```
Replace the first line only:
```javascript
        if (S.altMode && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
                bank === 3 && knobIdx === 0) {
```
(leave the rest of that block unchanged.)

- [ ] **Step 6: Melodic clock_shift effSens (8061)**

Find:
```javascript
            const _effSens = (pm.dspKey === 'clock_shift' && S.shiftHeld) ? Math.max(1, (pm.sens >> 1)) : pm.sens;
```
Replace with:
```javascript
            const _effSens = (pm.dspKey === 'clock_shift' && S.altMode) ? Math.max(1, (pm.sens >> 1)) : pm.sens;
```

- [ ] **Step 7: Melodic clock_shift nudge branch (8110)**

Find:
```javascript
                    } else if (pm.dspKey === 'clock_shift') {
                        if (S.shiftHeld) {
                            /* Shift+Shft = Nudge — fire DSP, mirror counter for display, schedule re-read */
```
Replace with:
```javascript
                    } else if (pm.dspKey === 'clock_shift') {
                        if (S.altMode) {
                            /* alt = Nudge — fire DSP, mirror counter for display, schedule re-read */
```

- [ ] **Step 8: Melodic clip_resolution zoom branch (8141)**

Find:
```javascript
                        if (S.shiftHeld && pm.dspKey === 'clip_resolution') {
```
Replace with:
```javascript
                        if (S.altMode && pm.dspKey === 'clip_resolution') {
```

- [ ] **Step 9: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: success, exit 0.

- [ ] **Step 10: Commit**
```bash
git add ui/ui.js
git commit -m "feat(ui): route bank alt-param knob writes via altMode (was shiftHeld)"
```

---

### Task 6: AUTO/CC bank — CC-assign ("Assign") mode

**Files:**
- Modify: `ui/ui.js:7920` (knob handler), `ui.js:3713` and `3734` (render)

- [ ] **Step 1: Knob handler — route the type ladder via altMode (7920)**

Find:
```javascript
            /* Shift+turn: type/number ladder — AT (type 1) ↔ CC0 ↔ CC1 … CC127. sens=4 */
            if (S.shiftHeld) {
```
Replace with:
```javascript
            /* alt mode: type/number ladder — AT (type 1) ↔ CC0 ↔ CC1 … CC127. sens=4 */
            if (S.altMode) {
```

- [ ] **Step 2: Render — header reads "Assign" in alt mode (3713)**

Find:
```javascript
        drawBankHeadingInverted(BANKS[6].name);
```
Replace with:
```javascript
        drawBankHeadingInverted(S.altMode ? 'Assign' : BANKS[6].name);
```

- [ ] **Step 3: Render — highlight all 8 labels in alt mode (3734)**

Find:
```javascript
            const hi   = (S.knobTouched === k) || (S.ccActiveLane[t] === k);
```
Replace with:
```javascript
            const hi   = S.altMode || (S.knobTouched === k) || (S.ccActiveLane[t] === k);
```

- [ ] **Step 4: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: success, exit 0.

- [ ] **Step 5: Commit**
```bash
git add ui/ui.js
git commit -m "feat(ui): AUTO/CC CC-assign mode via altMode (Assign header, all labels lit)"
```

---

### Task 7: Down-arrow header icon for alt-param banks

**Files:**
- Modify: `ui/ui.js` — add `drawAltArrow()` helper near `drawBankHeadingInverted` (line 107); call it from `drawBankHeading`/`drawBankHeadingInverted` and the custom ALL LANES header (3626-3628)

- [ ] **Step 1: Add the icon helper**

In `ui/ui.js`, immediately after `function drawBankHeadingInverted(name) { ... }` ends (line ~107+), insert:
```javascript
/* Down-arrow affordance for banks that expose alt params (S.altMode).
 * 5px-wide downward triangle in the top-right of the header bar.
 * hdrInverted: header background is white (drawBankHeadingInverted / ALL LANES).
 * on: alt mode active → draw highlighted (filled box, arrow knocked out). */
function drawAltArrow(x, hdrInverted, on) {
    const bg = hdrInverted ? 1 : 0;   /* header background */
    const fg = hdrInverted ? 0 : 1;   /* header text */
    if (on) {
        fill_rect(x - 1, 1, 7, 7, fg);
        fill_rect(x,     2, 5, 1, bg);
        fill_rect(x + 1, 3, 3, 1, bg);
        fill_rect(x + 2, 4, 1, 1, bg);
    } else {
        fill_rect(x,     2, 5, 1, fg);
        fill_rect(x + 1, 3, 3, 1, fg);
        fill_rect(x + 2, 4, 1, 1, fg);
    }
}
```

- [ ] **Step 2: Draw the arrow from the shared header helpers**

In `function drawBankHeading(name)` and `function drawBankHeadingInverted(name)`, add as the LAST statement of each function body (before its closing `}`):
```javascript
    if (!S.sessionView && bankHasAltParams(S.activeTrack, S.activeBank)) {
        drawAltArrow(120, /*hdrInverted=*/false, S.altMode);
    }
```
For `drawBankHeadingInverted`, pass `true` for `hdrInverted`:
```javascript
    if (!S.sessionView && bankHasAltParams(S.activeTrack, S.activeBank)) {
        drawAltArrow(120, /*hdrInverted=*/true, S.altMode);
    }
```

- [ ] **Step 3: Draw the arrow on the custom ALL LANES header (3626-3628)**

Find:
```javascript
            fill_rect(0, 0, 128, 9, 1);
            print(4, 1, (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES', 0);
            print(106, 1, 'Tr' + (S.activeTrack + 1), 0);
```
Replace with (ALL LANES has alt params and a white header; place the arrow left of the `Tr` label so it does not overlap):
```javascript
            fill_rect(0, 0, 128, 9, 1);
            print(4, 1, (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES', 0);
            print(106, 1, 'Tr' + (S.activeTrack + 1), 0);
            drawAltArrow(96, /*hdrInverted=*/true, S.altMode);
```

- [ ] **Step 4: Bundle + coarse syntax gate**

Run: `python3 scripts/bundle_ui.py && node --check dist/davebox/ui.js`
Expected: success, exit 0.

- [ ] **Step 5: Commit**
```bash
git add ui/ui.js
git commit -m "feat(ui): down-arrow header icon for alt-param banks"
```

---

### Task 8: Deploy, device-verify, docs

**Files:**
- Modify: `notes/CHANGELOG.md` ([Unreleased] → ### Features)
- Modify: `MANUAL.md` (jog-click / bank alt-param behavior)

- [ ] **Step 1: Deploy (JS-only) + reboot**

Run:
```bash
python3 scripts/bundle_ui.py && ./scripts/install.sh
ssh root@move.local "for name in MoveOriginal Move MoveLauncher MoveMessageDisplay shadow_ui schwung link-subscriber display-server schwung-manager; do pids=\$(pidof \$name 2>/dev/null || true); [ -n \"\$pids\" ] && kill -9 \$pids 2>/dev/null || true; done && /etc/init.d/move start >/dev/null 2>&1"
```
Expected: install completes; Move reboots and dAVEBOx loads (no "failed to load tool").

- [ ] **Step 2: Device verification (hands-on, from the spec test plan)**

Verify each on the device:
  1. **CLIP (melodic):** jog-click → down-arrow highlights; K2/K3 read **Nudg/Zoom**; turning them changes nudge/zoom. Jog-click again → back to **Shft/Res**, arrow dims. Holding Shift no longer flips them.
  2. **DELAY (melodic):** jog-click → K1 reads **ClkF**, turning changes clock feedback; off → **Rate**.
  3. **DRUM LANE (drum):** jog-click → **Nudg/Zoom** labels; turning changes them.
  4. **ALL LANES (drum):** jog-click → K2 reads **Nudg**; arrow visible left of `Tr#` and highlights.
  5. **REPEAT GROOVE (drum):** jog-click → header flips **VEL→NUDGE**, per-step values switch.
  6. **AUTO/CC:** jog-click → header reads **"Assign"**, ALL labels highlighted; turning a knob retargets its CC/AT (AT↔CC0..127). Jog-click off → edits values again. Holding Shift no longer does the ladder.
  7. **Perform mode:** Shift+step-8 still cycles Velocity→Rpt1→Rpt2 and lands on REPEAT GROOVE; jog-click alone no longer cycles perform mode.
  8. **Reverts:** turn alt mode on, then change bank / change track / enter Session View → alt mode is OFF on return. Suspend (Back) + resume → OFF.
  9. **Banks 4/5 melodic:** jog-click still toggles the Arp Steps overlay (unchanged).
  10. **No stray arrows:** banks WITHOUT alt params (HARMZ, SEQ ARP, ARP IN melodic, NOTE FX melodic) show NO down-arrow; Session View shows none.

If any pixel collision is observed (esp. the ALL LANES arrow vs `Tr#`, or the x=120 arrow vs a long bank name), adjust the `x` argument(s) to `drawAltArrow` and re-deploy.

- [ ] **Step 3: Update CHANGELOG**

In `notes/CHANGELOG.md`, under `[Unreleased]` → `### Features`, add:
```markdown
- Bank alt-params (Nudge/Zoom/ClkF, REPEAT GROOVE nudge, AUTO/CC assign) are now toggled by a sticky **jog-click** instead of holding Shift; a down-arrow header icon shows when alt-params are active. Drum perform-mode switching is now solely on Shift+step-8.
```

- [ ] **Step 4: Update MANUAL**

In `MANUAL.md`, update the bank/knob section to describe: jog-click toggles alt-params on CLIP/DELAY (melodic) and DRUM LANE/REPEAT GROOVE/ALL LANES (drum); AUTO/CC jog-click enters "Assign" mode (retarget CCs); the down-arrow indicator; alt mode reverts on bank/track/session change; perform-mode is Shift+step-8. Remove any "hold Shift for alt params" wording.

- [ ] **Step 5: Commit**
```bash
git add notes/CHANGELOG.md MANUAL.md
git commit -m "docs: jog-click alt-param mode (CHANGELOG + MANUAL)"
```

---

## Self-review notes

- **Spec coverage:** state flag (T1) · jog-click toggle + perform-mode removal (T2) · clear conditions incl. suspend (T3) · render migration + gate (T4) · knob-write migration incl. all 9 sites (T5) · AUTO/CC Assign mode (T6) · down-arrow icon (T7) · deploy/verify/docs (T8). All spec sections mapped.
- **Stay-on-Shift list preserved:** Rnd dialog, pad bank/track select, step-edit block, session quant, Shift+step shortcuts, Shift+Delete+jog and Delete+jog resets are untouched (verified not in any migration step).
- **Naming consistency:** `S.altMode`, `S._altPrevBank`, `S._altPrevTrack`, `bankHasAltParams(t, bank)`, `drawAltArrow(x, hdrInverted, on)` used identically across tasks.
- **Known device-tune item:** down-arrow `x` coordinate (120 default, 96 for ALL LANES) — Step T8.2 includes an adjust-and-redeploy fallback.
