# Co-run View Addressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a co-running Schwung tool open a curated set of Schwung screens as a temporary overlay and return; first consumer is dAVEBOx's Note/Session button in Move co-run opening the FX bus picker.

**Architecture:** The tool module and `shadow_ui.js` share one QuickJS `globalThis`, so the addressing verbs (`shadow_corun_open`/`shadow_corun_close`/`shadow_corun_entries`) are JS functions defined on `globalThis` by `shadow_ui.js`, backed by a curated `CORUN_ENTRIES` registry of existing screen enter-functions. One new C helper (`shadow_corun_overlay`) does the SHM write (display owner + keep_mask) without touching `corun.target`, so the consumer tool never sees a target change and never tears down. Overlay nav is routed in shadow_ui's existing MIDI dispatcher; Back-to-close reuses the per-view Back cases. dAVEBOx keeps the jog group while the overlay is open so the picker receives navigation.

**Tech Stack:** C (QuickJS host bindings), JavaScript (QuickJS — NOT V8/Node for the device; Node only for the unit-test harness), two repos: `legsmechanical/schwung` (fork) and `schwung-davebox` (consumer).

**Cross-repo note:** Phase 1 + 3a land in `~/schwung repos/schwung` (branch off its `main`). Phase 2 + 3b land in `~/schwung repos/schwung-davebox` (branch `corun-view-addressing`, already created). Build/deploy the fork first, then dAVEBOx.

**QuickJS reminders (device JS):** member-expressions as object keys are a syntax error; `??`/spread/`for...of`/`Set`/`Map`/`globalThis` are supported. `Date.now()` is fine on-device (the restriction is only in workflow scripts). Run the bundler before deploying dAVEBOx JS.

---

## File Structure

**Fork (`~/schwung repos/schwung`):**
- `src/shadow/shadow_ui.js` — Modify: add `CORUN_ENTRIES` registry + `shadow_corun_open/close/entries` on `globalThis`; add overlay routing in the MIDI dispatcher (~16769); extend the `FX_BUS_PICKER` Back case (~13603).
- `src/shadow/shadow_ui.c` — Modify: add + register `js_shadow_corun_overlay` C binding (near `js_shadow_corun_begin` ~361 and the registration block ~3247).
- `tests/shadow/test_corun_view_registry.mjs` + `.sh` — Create: unit tests for entries/open/close using the repo's extract-and-sandbox harness.
- `docs/CORUN.md` — Modify: document the addressing mechanism (framework reference).

**Consumer (`~/schwung repos/schwung-davebox`):**
- `ui/ui.js` — Modify: add `CORUN_GRP_JOG` + `DAVEBOX_PICKER_KEEP_MASK` constants (~484); capability flag; replace the Note/Session swallow (~8015).
- `MANUAL.md`, `CHANGELOG.md`, `notes/tech-changelog.md`, `docs/SCHWUNG_PATCHES.md` — Modify: docs.

---

# Phase 1 — Fork: the addressing mechanism

Work in `~/schwung repos/schwung`. First create a branch.

### Task 0: Branch the fork

- [ ] **Step 1: Create the branch**

```bash
cd ~/"schwung repos/schwung" && git checkout main && git pull --ff-only 2>/dev/null; git checkout -b corun-view-addressing
```

- [ ] **Step 2: Confirm clean tree**

Run: `git status --short`
Expected: empty (or only untracked files unrelated to this work).

---

### Task 1: Registry + `shadow_corun_entries()` (TDD)

**Files:**
- Modify: `src/shadow/shadow_ui.js` (add registry block; pick a location just after the `VIEWS` definition block, ~line 317, so `VIEWS` is in scope)
- Create: `tests/shadow/test_corun_view_registry.mjs`
- Create: `tests/shadow/test_corun_view_registry.sh`

- [ ] **Step 1: Write the failing test**

Create `tests/shadow/test_corun_view_registry.mjs` (models the extract-and-sandbox pattern from `test_parked_overtake_shim_isolation.mjs`):

```js
// Unit tests for the co-run view-addressing registry + verbs. Extracts the
// CORUN_ENTRIES block and the shadow_corun_* function bodies from
// src/shadow/shadow_ui.js and runs them in a Node vm sandbox with minimal stubs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const source = readFileSync(path.join(repoRoot, 'src/shadow/shadow_ui.js'), 'utf8');

// Extract the marker-delimited registry+verbs block.
function extractBlock(startMarker, endMarker) {
    const s = source.indexOf(startMarker);
    if (s < 0) throw new Error(`start marker not found: ${startMarker}`);
    const e = source.indexOf(endMarker, s);
    if (e < 0) throw new Error(`end marker not found: ${endMarker}`);
    return source.slice(s, e + endMarker.length);
}

const block = extractBlock(
    '/* ==== CO-RUN VIEW ADDRESSING (begin) ==== */',
    '/* ==== CO-RUN VIEW ADDRESSING (end) ==== */'
);

function makeSandbox(overrides = {}) {
    const calls = { overlay: [], entered: [] };
    const sandbox = {
        VIEWS: { SLOTS: 'slots', FX_BUS_PICKER: 'fxbuspicker' },
        view: null,
        needsRedraw: false,
        globalThis: {},
        // stubbed enter-functions record their invocation
        enterChainEdit: (slot) => calls.entered.push(['chain_editor', slot]),
        enterMasterFxSettings: () => calls.entered.push(['master_fx']),
        enterGlobalSettings: () => calls.entered.push(['global_settings']),
        enterFxBusPicker: () => calls.entered.push(['fx_picker']),
        // stubbed C bindings
        shadow_corun_overlay: (active, mask) => calls.overlay.push([active, mask]),
        shadow_corun_state: () => ({ target: 2, id: 3, keep_mask: 0x040E }),
        ...overrides,
    };
    sandbox.globalThis = sandbox; // shared global object, like the device
    vm.createContext(sandbox);
    vm.runInContext(block, sandbox);
    return { sandbox, calls };
}

// Test 1: entries() lists upstream catalog + fork-only fx_picker (enterFxBusPicker present)
{
    const { sandbox } = makeSandbox();
    const ids = sandbox.shadow_corun_entries();
    assert.deepEqual(
        ids.sort(),
        ['chain_editor', 'fx_picker', 'global_settings', 'master_fx', 'slots'],
        'entries should list the four upstream screens + fork-only fx_picker'
    );
    console.log('ok - entries lists catalog incl fork-only fx_picker');
}

// Test 2: when enterFxBusPicker is absent (upstream build), fx_picker is NOT registered
{
    const { sandbox } = makeSandbox({ enterFxBusPicker: undefined });
    const ids = sandbox.shadow_corun_entries();
    assert.ok(!ids.includes('fx_picker'), 'fx_picker must not register without enterFxBusPicker');
    assert.ok(ids.includes('global_settings'), 'upstream screens still register');
    console.log('ok - fx_picker absent on builds lacking enterFxBusPicker');
}

console.log('PASS test_corun_view_registry');
```

Create `tests/shadow/test_corun_view_registry.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/test_corun_view_registry.mjs"
```

```bash
chmod +x tests/shadow/test_corun_view_registry.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/shadow/test_corun_view_registry.sh`
Expected: FAIL with "start marker not found" (the registry block doesn't exist yet).

- [ ] **Step 3: Add the registry + entries (minimal)**

In `src/shadow/shadow_ui.js`, just after the `VIEWS = { ... };` block (~line 317), insert. (The `open`/`close` bodies come in Task 3; add the markers + entries + `entries()` now.)

```js
/* ==== CO-RUN VIEW ADDRESSING (begin) ==== */
/* A curated registry of addressable Schwung screens a co-running tool may open
 * as a temporary overlay over its co-run target, then return from. Tool + shadow_ui
 * share one QuickJS globalThis, so the verbs are plain globals the tool calls
 * directly. Display-owner / keep_mask SHM writes go through the C helper
 * shadow_corun_overlay(active, keep_mask), which leaves corun.target untouched.
 * Entries are curated and added deliberately — NEVER auto-derived from VIEWS. */
const CORUN_ENTRIES = {
    slots:           { enter: function() { view = VIEWS.SLOTS; } },
    chain_editor:    { enter: function(a) { enterChainEdit((a && a.slot) | 0); } },
    master_fx:       { enter: function() { enterMasterFxSettings(); } },
    global_settings: { enter: function() { enterGlobalSettings(); } },
};
/* Fork-only catalog additions. Guarded on the enter-function so an upstream
 * build that lacks the FX feature simply doesn't register the id, and tools
 * gate on shadow_corun_entries(). */
if (typeof enterFxBusPicker === 'function') {
    CORUN_ENTRIES.fx_picker = { enter: function() { enterFxBusPicker(); } };
}

let corunOverlayId = null;       /* active overlay entry id, or null */
let corunOverlayPrevMask = 0;    /* keep_mask to restore on close */

globalThis.shadow_corun_entries = function() {
    return Object.keys(CORUN_ENTRIES);
};
/* ==== CO-RUN VIEW ADDRESSING (end) ==== */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/shadow/test_corun_view_registry.sh`
Expected: `ok - entries lists catalog incl fork-only fx_picker`, `ok - fx_picker absent ...`, `PASS test_corun_view_registry`.

- [ ] **Step 5: Commit**

```bash
git add src/shadow/shadow_ui.js tests/shadow/test_corun_view_registry.mjs tests/shadow/test_corun_view_registry.sh
git commit -m "feat(corun): addressable-view registry + shadow_corun_entries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `shadow_corun_overlay` C helper

**Files:**
- Modify: `src/shadow/shadow_ui.c` (add `js_shadow_corun_overlay` after `js_shadow_corun_end` ~404; register near ~3249)

- [ ] **Step 1: Add the C function**

In `src/shadow/shadow_ui.c`, immediately after `js_shadow_corun_end` (ends ~line 404):

```c
/* shadow_corun_overlay(active, keep_mask) -> void
 * Present (active=1) or dismiss (active=0) a shadow_ui view as a temporary
 * overlay over the active co-run target. Sets keep_mask and flips OLED ownership
 * WITHOUT touching corun.target, so the consumer tool's corun_state() view and
 * its state machine stay put (no teardown). On dismiss the OLED returns to the
 * underlay: Move firmware for a move_native underlay, shadow_ui otherwise. */
static JSValue js_shadow_corun_overlay(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (!shadow_control || argc < 2) return JS_UNDEFINED;
    int active = 0, keep = 0;
    if (JS_ToInt32(ctx, &active, argv[0])) return JS_UNDEFINED;
    if (JS_ToInt32(ctx, &keep, argv[1])) return JS_UNDEFINED;
    if (keep < 0 || keep > 0xFFFF) return JS_UNDEFINED;
    shadow_control->corun.keep_mask = (uint16_t)keep;
    if (active) {
        shadow_control->shadow_display_owner = DISPLAY_OWNER_SCHWUNG_UI;
    } else {
        shadow_control->shadow_display_owner =
            (shadow_control->corun.target == CORUN_TARGET_MOVE_NATIVE)
                ? DISPLAY_OWNER_MOVE_FIRMWARE
                : DISPLAY_OWNER_SCHWUNG_UI;
    }
    return JS_UNDEFINED;
}
```

- [ ] **Step 2: Register it as a global**

In the registration block, immediately after the `shadow_corun_state` line (~3249):

```c
    JS_SetPropertyStr(ctx, global_obj, "shadow_corun_overlay", JS_NewCFunction(ctx, js_shadow_corun_overlay, "shadow_corun_overlay", 2));
```

- [ ] **Step 3: Build the host to verify it compiles**

Run: `cd ~/"schwung repos/schwung" && ./scripts/build.sh 2>&1 | tail -20`
Expected: build completes with no errors referencing `js_shadow_corun_overlay`.

- [ ] **Step 4: Commit**

```bash
git add src/shadow/shadow_ui.c
git commit -m "feat(corun): shadow_corun_overlay SHM helper (display owner + keep_mask, target untouched)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `shadow_corun_open` / `shadow_corun_close` (TDD)

**Files:**
- Modify: `src/shadow/shadow_ui.js` (inside the CO-RUN VIEW ADDRESSING block from Task 1)
- Modify: `tests/shadow/test_corun_view_registry.mjs` (add open/close tests)

- [ ] **Step 1: Add the failing tests**

Append to `tests/shadow/test_corun_view_registry.mjs` before the final `console.log('PASS ...')`:

```js
// Test 3: open() looks up the entry, remembers prev mask, flips overlay via C helper, runs enter
{
    const { sandbox, calls } = makeSandbox();
    const ok = sandbox.shadow_corun_open('fx_picker', 0x041E);
    assert.equal(ok, true, 'open known id returns true');
    assert.deepEqual(calls.overlay, [[1, 0x041E]], 'overlay(1, mask) called');
    assert.deepEqual(calls.entered, [['fx_picker']], 'enter-function invoked');
    console.log('ok - open flips overlay + runs enter');
}

// Test 4: open() of an unknown id is a graceful no-op
{
    const { sandbox, calls } = makeSandbox();
    const ok = sandbox.shadow_corun_open('nope', 0x041E);
    assert.equal(ok, false, 'open unknown id returns false');
    assert.equal(calls.overlay.length, 0, 'no overlay flip for unknown id');
    assert.equal(calls.entered.length, 0, 'no enter for unknown id');
    console.log('ok - open unknown id is a no-op');
}

// Test 5: close() restores the remembered prev mask via overlay(0, prevMask)
{
    const { sandbox, calls } = makeSandbox();
    sandbox.shadow_corun_open('fx_picker', 0x041E); // prev mask from state stub = 0x040E
    sandbox.shadow_corun_close();
    assert.deepEqual(calls.overlay[1], [0, 0x040E], 'close restores prev keep_mask');
    console.log('ok - close restores prev mask');
}

// Test 6: close() when no overlay is open is a no-op
{
    const { sandbox, calls } = makeSandbox();
    sandbox.shadow_corun_close();
    assert.equal(calls.overlay.length, 0, 'close with no overlay does nothing');
    console.log('ok - close with no overlay is a no-op');
}
```

- [ ] **Step 2: Run to verify failure**

Run: `bash tests/shadow/test_corun_view_registry.sh`
Expected: FAIL — `sandbox.shadow_corun_open is not a function`.

- [ ] **Step 3: Implement open/close**

In `src/shadow/shadow_ui.js`, inside the CO-RUN VIEW ADDRESSING block, after the `shadow_corun_entries` definition and before the `(end)` marker:

```js
globalThis.shadow_corun_open = function(id, keep_mask, args) {
    const entry = CORUN_ENTRIES[id];
    if (!entry) return false;
    const st = (typeof shadow_corun_state === 'function') ? shadow_corun_state() : null;
    corunOverlayPrevMask = st ? (st.keep_mask | 0) : 0;
    corunOverlayId = id;
    /* Flip OLED to shadow_ui + apply the overlay's keep_mask; corun.target stays
     * put so the consumer tool's state machine is undisturbed. */
    if (typeof shadow_corun_overlay === 'function') shadow_corun_overlay(1, keep_mask | 0);
    entry.enter(args);
    needsRedraw = true;
    return true;
};

globalThis.shadow_corun_close = function() {
    if (corunOverlayId == null) return;
    corunOverlayId = null;
    if (typeof shadow_corun_overlay === 'function') shadow_corun_overlay(0, corunOverlayPrevMask | 0);
    needsRedraw = true;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `bash tests/shadow/test_corun_view_registry.sh`
Expected: all six `ok - ...` lines, then `PASS test_corun_view_registry`.

- [ ] **Step 5: Commit**

```bash
git add src/shadow/shadow_ui.js tests/shadow/test_corun_view_registry.mjs
git commit -m "feat(corun): shadow_corun_open/close overlay verbs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Overlay nav routing + Back-to-close

These two edits are device-only behavior (MIDI dispatch); verified on device in Phase 2. Read the surrounding code before editing.

**Files:**
- Modify: `src/shadow/shadow_ui.js` — dispatcher (~16769, near the chain-edit intercept at ~16958) and the `FX_BUS_PICKER` Back case (~13603)

- [ ] **Step 1: Route overlay nav in the dispatcher**

In `globalThis.onMidiMessageInternal` (~16769), add this block **immediately before** the existing chain-edit intercept `if (coRunChainEditSlot >= 0 && (status & 0xF0) === 0xB0) {` (~16958). It mirrors that block's jog/click/Back handling but gates on `corunOverlayId`:

```js
        /* Co-run view overlay: while an overlay is open over the tool's co-run
         * target, shadow_ui owns the screen and the nav the tool ceded back to
         * us (jog turn/click, Back). Route those into the active view. Back is
         * dispatched through handleBack(), whose per-view top-level cases call
         * shadow_corun_close() to return to the underlay (see FX_BUS_PICKER). */
        if (corunOverlayId != null && (status & 0xF0) === 0xB0) {
            if (d1 === MoveMainKnob) {
                const delta = decodeDelta(d2);
                if (delta !== 0) handleJog(delta);
                needsRedraw = true;
                return;
            }
            if (d1 === MoveMainButton && d2 > 0) {
                if (hostShiftHeld) handleShiftSelect(); else handleSelect();
                needsRedraw = true;
                return;
            }
            if (d1 === MoveBack && d2 > 0) {
                handleBack();
                needsRedraw = true;
                return;
            }
            /* Note/Session (CC 50) while the overlay is open also closes it. */
            if (d1 === 50 && d2 > 0) {
                shadow_corun_close();
                needsRedraw = true;
                return;
            }
        }
```

- [ ] **Step 2: Make the FX_BUS_PICKER Back case close the overlay**

In the `FX_BUS_PICKER` case of the Back handler (~13603), change it to check `corunOverlayId` first:

```js
        case VIEWS.FX_BUS_PICKER:
            if (corunOverlayId != null) {
                /* Overlay over a co-run target → return to the underlay (e.g. the
                 * Move synth screen) without changing corun.target. */
                shadow_corun_close();
            } else if (coRunChainEditSlot >= 0) {
                view = VIEWS.CHAIN_EDIT;
                coRunView = VIEWS.CHAIN_EDIT;
            } else {
                if (typeof shadow_request_exit === "function") {
                    shadow_request_exit();
                }
            }
            break;
```

- [ ] **Step 3: Build to verify JS is well-formed**

Run: `cd ~/"schwung repos/schwung" && ./scripts/build.sh 2>&1 | tail -20`
Expected: build completes; no JS syntax errors reported by the build's QuickJS check.

- [ ] **Step 4: Re-run the unit tests (no regression)**

Run: `bash tests/shadow/test_corun_view_registry.sh`
Expected: `PASS test_corun_view_registry` (the routing block isn't extracted by the test, but the file must still parse for the test's read).

- [ ] **Step 5: Commit**

```bash
git add src/shadow/shadow_ui.js
git commit -m "feat(corun): route overlay nav in dispatcher + FX_BUS_PICKER Back closes overlay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Build, deploy fork, regression-check chain-edit path

**Files:** none (build/deploy/verify only)

- [ ] **Step 1: Build + install the fork**

Run: `cd ~/"schwung repos/schwung" && ./scripts/build.sh && ./scripts/install.sh local --skip-confirmation 2>&1 | tail -20`
Expected: build + install succeed; Move restarts.

- [ ] **Step 2: Regression — chain-edit menu button still opens FX picker**

On device, in **Schwung** co-run (chain-edit) on a Schwung synth slot, press Note/Session (CC 50).
Expected: the FX bus picker opens as before (Master FX / Send A / Send B / Move FX 1–4); Back returns to the chain editor. Unchanged from prior behavior.

- [ ] **Step 3: Commit (no-op marker if nothing changed)**

If Steps 1–2 surfaced a fix, commit it. Otherwise proceed — no commit needed.

---

# Phase 2 — dAVEBOx: the consumer

Work in `~/schwung repos/schwung-davebox` (branch `corun-view-addressing`).

### Task 6: Constants + capability flag + Note/Session handler

**Files:**
- Modify: `ui/ui.js` — constants (~484-489), capability flag (in `pollDSP` ~2497 or `init`), the Note/Session handler (~8015)

- [ ] **Step 1: Add the jog group + picker keep-mask constants**

In `ui/ui.js`, after `const DAVEBOX_CORUN_KEEP_MASK = ...` (~line 489), add:

```js
/* Jog group (turn + click) — bit 4, matching CORUN_GRP_JOG in Schwung's
 * shadow_constants.h (OLED=0, PADS=1, STEPS=2, TRANSPORT=3, JOG=4, ...). */
const CORUN_GRP_JOG = 1 << 4;
/* Mask used while the FX-picker overlay is open: the normal Move-co-run mask
 * PLUS jog, so the picker's jog turn/click reach shadow_ui's dispatcher instead
 * of being ceded to Move firmware. (MENU + BACK are already kept.) */
const DAVEBOX_PICKER_KEEP_MASK = DAVEBOX_CORUN_KEEP_MASK | CORUN_GRP_JOG;
```

- [ ] **Step 2: Add the capability flag**

In `pollDSP` (`ui/ui.js` ~2497), inside the `if (typeof shadow_corun_state === 'function') {` block, after the existing reconcile logic, add a one-time capability probe:

```js
        if (S.fxPickerAvailable === undefined) {
            S.fxPickerAvailable = (typeof shadow_corun_entries === 'function') &&
                shadow_corun_entries().indexOf('fx_picker') >= 0;
        }
```

(If `S` has a typed init object, also add `fxPickerAvailable: undefined` there for clarity — search `ui/ui_state.mjs` for the state shape; a bare `undefined` default works without it.)

- [ ] **Step 3: Replace the Note/Session swallow**

In `_onMidiInternalImpl` (`ui/ui.js` ~8012), replace the early-return at ~8015:

```js
        if (S.moveCoRunTrack >= 0) return;
```

with:

```js
        if (S.moveCoRunTrack >= 0) {
            /* Move co-run: Note/Session opens the FX bus picker (when this Schwung
             * build registered it) as an overlay over the Move synth screen. corun
             * target stays MOVE_NATIVE, so pollDSP does NOT tear down — Back from
             * the picker returns to the synth. Builds without fx_picker: swallow as
             * before (the button still has no other use here). */
            if (d2 === 127 && S.fxPickerAvailable && typeof shadow_corun_open === 'function') {
                shadow_corun_open('fx_picker', DAVEBOX_PICKER_KEEP_MASK);
            }
            return;
        }
```

- [ ] **Step 4: Bundle + sanity-check JS**

Run: `cd ~/"schwung repos/schwung-davebox" && python3 scripts/bundle_ui.py 2>&1 | tail -5`
Expected: bundler completes, writes `dist/davebox/ui.js`, no errors.

- [ ] **Step 5: Commit**

```bash
git add ui/ui.js
git commit -m "feat(corun): Note/Session opens FX bus picker in Move co-run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Deploy + on-device verification (the acceptance test)

**Files:** none (deploy/verify only). Requires the Task 5 fork build already on device.

- [ ] **Step 1: Deploy dAVEBOx JS**

Run: `cd ~/"schwung repos/schwung-davebox" && python3 scripts/bundle_ui.py && ./scripts/install.sh 2>&1 | tail -20`
Then reboot Move (JS-only deploy still needs a full restart to reload JS — `install.sh` restarts the service; confirm the OLED comes back).

- [ ] **Step 2: Happy path**

On device: enter Move co-run on a ROUTE_MOVE track (Edit Synth… / Step 3). Confirm Move's synth screen is showing. Tap **Note/Session**.
Expected: the FX bus picker appears over the synth screen. Jog scrolls Master FX / Send A / Send B / Move FX 1–4; click enters a bus editor; Back from an editor returns to the picker; Back from the picker top returns to the **Move synth screen** with its context intact. dAVEBOx pads/steps/transport stay live throughout.

- [ ] **Step 3: Teardown while open**

Re-open the picker, then exit co-run via the tool's exit gesture (Step 3 / Back-to-exit). Confirm clean exit: no stuck overlay, OLED returns to dAVEBOx, no LED corruption. Repeat, instead changing the Move set while the picker is open; confirm no freeze/desync.

- [ ] **Step 4: Discovery degradation (optional but recommended)**

Temporarily confirm the gate: if running against a Schwung build WITHOUT `fx_picker` registered, Note/Session in Move co-run is swallowed (no picker, no crash). (Can be checked by reading `S.fxPickerAvailable` via the log, or by reasoning from Task 1 Test 2.)

- [ ] **Step 5: Check the pad-drop + error logs**

Run: `ssh ableton@move.local "cat /data/UserData/schwung/seq8-pad-drop.log 2>/dev/null; tail -30 /data/UserData/schwung/seq8.log"`
Expected: no new pad-drop entries, no JS exceptions around the picker open/close.

- [ ] **Step 6: Commit (only if a fix was needed)**

If verification surfaced a fix, commit it with a `fix(corun): …` message. Otherwise proceed.

---

# Phase 3 — Documentation

### Task 8a: Fork docs (`docs/CORUN.md`)

**Files:**
- Modify: `~/schwung repos/schwung/docs/CORUN.md`

- [ ] **Step 1: Document the addressing mechanism**

Add a section to `docs/CORUN.md` describing: the `CORUN_ENTRIES` registry (curated, never auto-derived from `VIEWS`); `shadow_corun_entries()` / `shadow_corun_open(id, keep_mask, args)` / `shadow_corun_close()` defined on `globalThis`; the overlay model (display owner + keep_mask flip via `shadow_corun_overlay`, `corun.target` untouched, return to underlay on Back); and the upstream-vs-fork catalog split (upstream: `slots`, `chain_editor`, `master_fx`, `global_settings`; fork adds `fx_picker`). Note that a consumer keeps the jog group while an overlay is open.

- [ ] **Step 2: Commit (in the fork repo)**

```bash
cd ~/"schwung repos/schwung"
git add docs/CORUN.md
git commit -m "docs(corun): view-addressing mechanism (registry + open/close/entries)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 8b: dAVEBOx docs

**Files:**
- Modify: `MANUAL.md`, `CHANGELOG.md`, `notes/tech-changelog.md`, `docs/SCHWUNG_PATCHES.md` (all in `~/schwung repos/schwung-davebox`)

- [ ] **Step 1: MANUAL.md**

In the Move co-run section, document: in Move co-run, **Note/Session opens the FX bus picker** (Master FX, Send A/B, Move-track insert FX 1–4); navigate with jog/click; Back returns to the synth.

- [ ] **Step 2: CHANGELOG.md (`[Unreleased]` → `### Features`)**

```
- In Move co-run, the Note/Session button now opens the FX bus picker (Master FX, send buses, and per-track Move insert FX) over the synth; Back returns you to the synth.
```

- [ ] **Step 3: notes/tech-changelog.md (`[Unreleased]`)**

Record the technical detail: new generalized co-run view-addressing mechanism in the fork (`shadow_corun_open/close/entries` on `globalThis` + `CORUN_ENTRIES` registry + `shadow_corun_overlay` C helper, target untouched); dAVEBOx consumer keeps the jog group via `DAVEBOX_PICKER_KEEP_MASK` and gates on `shadow_corun_entries()` including `fx_picker`. Note the upstream/fork catalog split.

- [ ] **Step 4: docs/SCHWUNG_PATCHES.md**

Add the new mechanism to the co-run patch surface description (the addressing verbs + `shadow_corun_overlay` + the registry), alongside the existing chain-edit / move-native co-run entries.

- [ ] **Step 5: Commit (in dAVEBOx repo)**

```bash
cd ~/"schwung repos/schwung-davebox"
git add MANUAL.md CHANGELOG.md notes/tech-changelog.md docs/SCHWUNG_PATCHES.md
git commit -m "docs(corun): Note/Session FX picker in Move co-run + view-addressing mechanism

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Open risk / fallback

- **If Back doesn't close the picker on device** (i.e. the shim framework-exits co-run on Back despite `KEEP_BACK_BIT`, or Back doesn't reach the dispatcher): add the SHM overlay flag the spec described — claim `reserved[1]` in `shadow_constants.h` as `corun_fx_overlay`, set it in `shadow_corun_overlay`, and in `schwung_shim.c:7291` skip the framework-Back-exit while it's set. This is the spec's original Back-gating fallback; only needed if the `KEEP_BACK_BIT` path proves insufficient. Verify which by logging in the dispatcher's `MoveBack` overlay branch.
- **If jog/click don't reach the picker:** confirm `DAVEBOX_PICKER_KEEP_MASK` includes `CORUN_GRP_JOG` and that the bit (1<<4) matches the fork's `CORUN_GRP_JOG`. Cross-check `shadow_ui.c:3259` export value.

---

## Self-Review

**Spec coverage:**
- Mechanism (registry + `open`/`close`/`entries`) → Tasks 1, 3. ✓
- Overlay semantics (display+mask flip, target untouched) → Task 2 (C helper) + Task 3. ✓
- Discovery / graceful degradation → Task 1 Test 2, Task 6 Step 2, Task 7 Step 4. ✓
- Upstream catalog (`slots`/`chain_editor`/`master_fx`/`global_settings`) + fork-only `fx_picker` → Task 1 Step 3. ✓
- dAVEBOx consumer (un-swallow, keep jog, restore on close via mask) → Task 6. ✓
- Return-to-synth (no teardown) → guaranteed by target staying `MOVE_NATIVE` (Task 2 helper) + Task 6 handler; verified Task 7 Step 2. ✓
- Edge cases: teardown-while-open → Task 7 Step 3; per-set FX strip reset → covered by not changing target; LED → Task 7 Step 3/5. ✓
- Docs (MANUAL/SCHWUNG_PATCHES/CHANGELOG×2/CORUN.md) → Task 8a/8b. ✓
- Regression (chain-edit menu button) → Task 5 Step 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.

**Type/name consistency:** `corunOverlayId`, `corunOverlayPrevMask`, `CORUN_ENTRIES`, `shadow_corun_open/close/entries`, `shadow_corun_overlay`, `DAVEBOX_PICKER_KEEP_MASK`, `CORUN_GRP_JOG`, `S.fxPickerAvailable` used consistently across tasks. C helper arg order `(active, keep_mask)` matches JS call sites in Task 3.
