# Co-run Overlay Refactor — align move-overlay with the proven chain-edit mechanism

**Date:** 2026-06-10
**Status:** Approved (user) — ready to implement
**Repo:** `legsmechanical/schwung` (almost entirely `src/shadow/shadow_ui.js`); plus retiring two dAVEBOx patches.
**Supersedes the symptom patches:** davebox `78a4fa6` (Back-mask) and fork `34585fb9` (view-restore) — both become unnecessary once `view` never leaves `OVERTAKE_MODULE`.

## Root cause (confirmed)

The FX-picker overlay over move-native set `view = FX_BUS_PICKER` directly (via `shadow_corun_open → entry.enter() → enterFxBusPicker()`). That takes the unified co-run dispatch (`shadow_ui.js:16967`, gated `view === OVERTAKE_MODULE`) offline, which is what delegates pads/steps/transport to the tool. The result: Step 3 can't reach dAVEBOx to exit, and dAVEBOx can't keep painting its Step-3 LED. Chain-edit (Schwung) co-run avoids this by keeping `view = OVERTAKE_MODULE` and tracking the editor screen in a separate `coRunView`, bridged by `runCoRunChainEdit(fn)`:

```js
function runCoRunChainEdit(fn) {
    const _saved = view; view = coRunView;
    try { fn(); } finally { coRunView = view; view = _saved; }
}
```

## Model

Define one predicate for "shadow_ui is drawing a co-run screen over the running tool":
- `coRunChainEditSlot >= 0` → chain-edit co-run (underlay = Schwung chain, display already SCHWUNG_UI).
- `corunOverlayId != null` → overlay co-run (underlay = move-native, display flipped to SCHWUNG_UI by `shadow_corun_overlay`, returns to Move on close).

Both keep `view = OVERTAKE_MODULE`, draw via `coRunView`, and route input through the `16967` block. The only differences are three input cases (Back-at-top, CC 50, track buttons) and the entry/exit display handling.

Helper to add near the `coRunView` declaration (~line 229):
```js
/* True while shadow_ui is drawing a co-run screen over the running tool —
 * either the chain editor (chain-edit co-run) or an addressed view overlay
 * (overlay co-run over move-native). In both, view stays OVERTAKE_MODULE and
 * coRunView holds the drawn screen. */
function coRunUiActive() { return coRunChainEditSlot >= 0 || corunOverlayId != null; }
```

## Touchpoints (all in `src/shadow/shadow_ui.js` unless noted)

| # | Site | Current | Change |
|---|------|---------|--------|
| 1 | `shadow_corun_open` (~346) | `entry.enter()` sets `view` directly; captures `corunOverlayPrevView` | Keep `view = OVERTAKE_MODULE`; run the enter through the `runCoRunChainEdit` capture so the entry's view change lands in `coRunView`, not `view`. Init `coRunView` first. Drop the `corunOverlayPrevView` capture (view never changes). |
| 2 | `shadow_corun_close` (~360) | restores `view`, mask, display | Drop `view` restore (unchanged). Keep mask+display restore; reset `coRunView = VIEWS.OVERTAKE_MODULE`. |
| 3 | Task-4 overlay block (the `corunOverlayId != null` jog/click/back/cc50 block, ~17016) | hand-rolled router | **Remove entirely** — superseded by the generalized `16967` block. |
| 4 | suspend-Back guard (~17003) | `...&& coRunChainEditSlot < 0 && corunOverlayId == null` | Simplify to `&& !coRunUiActive()`. |
| 5 | draw wrap (~16796) | `if (coRunChainEditSlot >= 0) runCoRunChainEdit(dispatchCoRunDraw)` | `if (coRunUiActive()) ...`. (`dispatchCoRunDraw` already handles `FX_BUS_PICKER`/`MASTER_FX`.) |
| 6 | hier-knob wrap (~16444) | `if (coRunChainEditSlot >= 0) runCoRunChainEdit(...)` | `if (coRunUiActive()) ...`. |
| 7 | input intercept gate (~17051) | `if (coRunChainEditSlot >= 0 && status&0xF0===0xB0)` | `if (coRunUiActive() && ...)`. Jog/click/knobs/shift unchanged (navigate `coRunView`). **Branch three cases on overlay:** |
| 7a | Back (~17085) | chain-edit: pop, or `shadow_corun_end()` at CHAIN_EDIT top | Overlay: `runCoRunChainEdit(handleBack)` to pop; when `coRunView` is the overlay's root (e.g. `FX_BUS_PICKER`) call `shadow_corun_close()` (return to synth) instead of `shadow_corun_end`. |
| 7b | CC 50 (~17107) | opens FX picker | Overlay: `shadow_corun_close()` (Menu also closes). |
| 7c | track buttons (~17114) | switches chain slot | Overlay: skip (no chain slot) — let it fall through to the tool. |
| 8 | note intercept (~17174) | `if (coRunChainEditSlot >= 0 && status&0xF0===NoteOn ...)` | Inspect: confirm it only eats chain-editor notes and lets steps/pads fall through to the tool. Generalize to `coRunUiActive()` only if the overlay needs the same note handling; otherwise leave chain-edit-only so overlay steps reach the tool (Step 3 exit). **This is the critical one for the Step-3 ask — verify steps fall through in the overlay case.** |
| 9 | `enterFxBusPicker` `coRunView` set (~15088) | `if (coRunChainEditSlot >= 0) coRunView = FX_BUS_PICKER` | With #1's wrapper, the capture handles `coRunView`; leave as-is (harmless when wrapped) or guard on `coRunUiActive()`. Verify no double-set. |
| 10 | dAVEBOx `ui/ui.js` | `DAVEBOX_PICKER_KEEP_MASK` + capability + handler | Keep `DAVEBOX_PICKER_KEEP_MASK` (jog+back kept is still correct/needed). Revert nothing else; the handler still calls `shadow_corun_open('fx_picker', mask)`. The two patches (#1 design) are superseded but the davebox mask change stays. |

## Critical invariant to verify (the Step-3 ask)

After the refactor, with the overlay open: a **Step 3 press (a note, not a nav CC)** must fall through the `16967` co-run intercept to the tool delegate → dAVEBOx's `_onStepButtons` → `exitMoveNativeCoRun()` path; and dAVEBOx's `paintCoRunSideButtons` keeps paimting the Step-3 LED because dAVEBOx keeps ticking with `view === OVERTAKE_MODULE`. Both come "for free" once steps are delegated — exactly as they already do in chain-edit co-run.

## Regression guard (must stay green)

Schwung (chain-edit) co-run is the reference and MUST be unchanged:
1. Enter chain-edit co-run → chain editor draws; jog/click navigate; **Step 3 exits co-run**; Step-3 LED blinks + icon lit.
2. Menu (CC 50) opens the FX picker; Back navigates up; Back at CHAIN_EDIT top ends co-run.
3. Track buttons switch slots.

## Verification (device)

- **Move co-run overlay:** Note/Session → picker; jog/click navigate; into a deep FX slot; **Step 3 exits co-run from anywhere** (deep slot, editor, picker); **Step-3 LED stays lit (blink + icon) throughout**; Back pops levels → synth; Note/Session reopens; repeat.
- **Regression:** the Schwung co-run checklist above, unchanged.
- **Logs:** no JS exceptions (`seq8-jserr.log`); no stuck overlay after exit.

## Notes

- Deploy: fork `shadow_ui.js` is copied verbatim to `/data/UserData/schwung/shadow/shadow_ui.js` (md5-verified), so `scp` + stack restart is the fast iteration path; do a clean `build.sh`+`install.sh` for the final landing.
- Update `notes/tech-changelog.md` and `docs/CORUN.md` after it's verified (the addressing mechanism now reuses the chain-edit co-run dispatch; document the `coRunUiActive()` unification).
