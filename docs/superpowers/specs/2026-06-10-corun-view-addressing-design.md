# Co-run view addressing — design

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — ready for implementation plan
**Repos:** `legsmechanical/schwung` (fork; the mechanism + catalog) and `schwung-davebox` (the first consumer)

---

## Summary

Today a Schwung co-run session can point at exactly **two hardcoded destinations**: the
chain editor (`CORUN_TARGET_CHAIN_EDIT`) or Move's native synth screen
(`CORUN_TARGET_MOVE_NATIVE`). A co-running tool cannot ask Schwung to show any of its
*other* screens (FX picker, Global Settings, Slots list, …) and return.

This design adds a small, general **view-addressing mechanism** on top of the PR-94
co-run framework: a curated registry of addressable Schwung screens plus three verbs a
tool can call — `shadow_corun_open(id, keep_mask, args)`, `shadow_corun_close()`, and a
discovery call `shadow_corun_entries()`. The mechanism is **view-agnostic and
upstreamable**; the *catalog* of registered screens varies per build.

The first concrete consumer: in dAVEBOx, the **Note/Session button (CC 50) in Move
co-run** — currently swallowed because it had no use — opens the fork's **FX bus picker**
(Master FX · Send A · Send B · Move-track insert slots 1–4). Back returns you to the
Move synth screen you came from.

---

## Background — verified current state

### Schwung fork (`legsmechanical/schwung`)

- **Existing co-run API** (`src/shadow/shadow_ui.c`): `shadow_corun_begin(target, id,
  keep_mask)`, `shadow_corun_end()`, `shadow_corun_state()` — exported C globals
  (~216 lines for the three). `begin(CHAIN_EDIT)` sets `shadow_display_owner =
  DISPLAY_OWNER_SCHWUNG_UI`; `begin(MOVE_NATIVE)` **hardcodes**
  `DISPLAY_OWNER_MOVE_FIRMWARE` (`shadow_ui.c:384`). `end()` restores SCHWUNG_UI.
- **Keep-mask group constants** already exported (`CORUN_GRP_JOG/BACK/MENU/…`,
  `shadow_ui.c:3255-3268`) — this is how a tool already "picks what to cede."
- **Input routing** (`src/schwung_shim.c:7289-7308`): during `MOVE_NATIVE`, events the
  tool *cedes* (owner PEER/NONE) are suppressed from the tool process and sent to Move
  via the pre-ioctl filter; Back with owner NONE ends co-run. During `CHAIN_EDIT` the
  peer **is** shadow_ui (same process), so events publish through and shadow_ui's
  `onMidi` intercepts them via `coRunCedes()` gating.
- **Display visibility** (`src/schwung_shim.c:5258`): Move's native frame is shown when
  `shadow_display_owner == DISPLAY_OWNER_MOVE_FIRMWARE`.
- **FX bus picker** exists today (`enterFxBusPicker`, `shadow_ui.js:15022`; view
  `VIEWS.FX_BUS_PICKER`). It is opened **only** from the chain-edit menu-button path
  (`shadow_ui.js:17013-17019`, gated `coRunChainEditSlot >= 0`). It is **not** an
  exported global — a tool cannot open it.
- **VIEWS enum** (`shadow_ui.js:275-316`): ~40 entries. The majority are *internal
  sub-views* requiring preloaded context (`COMPONENT_PARAMS`, `PATCH_DETAIL`, the
  `STORE_PICKER_*` and `TOOL_*` wizards). These are **not** addressable destinations.
- **Spare SHM space**: `shadow_control` has `reserved[1]` (`shadow_constants.h:171`).

### dAVEBOx (`schwung-davebox`)

- **Note/Session swallow** (`ui/ui.js:8015`): `if (S.moveCoRunTrack >= 0) return;` —
  the button is dropped outright in Move co-run.
- **Co-run reconcile** (`ui/ui.js:2497-2509`): `pollDSP` reads `shadow_corun_state()`.
  If `target != MOVE_NATIVE` it treats Move co-run as ended and runs
  `exitMoveNativeCoRun()`. **Consequence:** any change of `corun.target` away from
  `MOVE_NATIVE` tears down dAVEBOx's Move co-run — so the FX picker must open *without*
  changing the target.
- **Keep mask**: dAVEBOx passes `DAVEBOX_CORUN_KEEP_MASK` into
  `shadow_corun_begin` (`ui.js:5132`, `5180`).
- **Capability gating** pattern already in use: features gate on
  `typeof shadow_xxx === 'function'`.

---

## Design

### Two layers, cleanly separated

**Layer 1 — the addressing mechanism (upstreamable).** View-agnostic. Lives in the
fork's host (`shadow_ui.c` bindings + `shadow_ui.js` logic), extends PR-94.

**Layer 2 — the catalog (per build).** A registry table mapping stable string ids to
existing screen enter-functions. Upstream registers the screens it has; the fork adds
its FX screens. Same mechanism; the list differs by one-or-a-few entries.

### The registry

A JS table in `shadow_ui.js`:

```js
// id -> { enter: fn(args), keepDefault: <mask>, overlay: bool }
const CORUN_ENTRIES = {
  slots:           { enter: () => { view = VIEWS.SLOTS; }, ... }, // chain UI home (root list)
  chain_editor:    { enter: (a) => enterChainEdit(a.slot), ... }, // tool supplies the slot
  master_fx:       { enter: () => enterMasterFxSettings(), ... },
  global_settings: { enter: () => enterGlobalSettings(), ... },
  // fork-only (registered in a fork-guarded block):
  fx_picker:       { enter: () => enterFxBusPicker(), overlay: true, ... },
};
```

The enter-functions **already exist** (verified: `enterChainEdit` `shadow_ui.js:7061`,
`enterMasterFxSettings` `:15006`, `enterGlobalSettings` `:6117`, `enterFxBusPicker`
`:15022`; the `slots` root is the default `view`, set directly). Registration is wiring,
not new UI. Entries are curated and added deliberately — the registry is **never**
auto-derived from `VIEWS`. Each enter-function establishes its own prerequisite state.

**Deliberately excluded** (available but not registered): `tools` / `overtake_menu` are
*launchers* (audio-utility jobs and module switching), not config/browse screens —
awkward to overlay mid-session; `store` likewise. All other `VIEWS` entries are
context-dependent sub-views or wizard steps that require preloaded state.

### The three verbs (new exported globals)

1. **`shadow_corun_entries()` → array of ids** — discovery. A tool calls this to learn
   which screens this Schwung build can open, then capability-gates per-entry. This is
   what makes build divergence a non-issue.

2. **`shadow_corun_open(id, keep_mask, args)` → bool** — open a registered screen as an
   **overlay** over the current co-run target:
   - Validate `id` against the registry; return `false` if unknown (graceful no-op).
   - Remember the underlying co-run target/id (to restore on close).
   - Flip `shadow_display_owner` → `DISPLAY_OWNER_SCHWUNG_UI` (so shadow_ui renders),
     **without** changing `corun.target` — the tool's `corun_state()` view is
     unchanged, so dAVEBOx does not tear down.
   - Apply `keep_mask` so the inputs the overlay needs (jog/click/Back/Menu) stay at the
     tool process, where shadow_ui's `onMidi` gets first crack.
   - Call the entry's `enter(args)`.

3. **`shadow_corun_close()` → void** — dismiss the overlay: restore the remembered
   target's display owner (e.g. `MOVE_FIRMWARE` for a Move-native underlay) and
   keep_mask, hand input/OLED back to the underlay.

### Overlay semantics (the key idea)

An overlay presents a Schwung view **on top of** the active co-run target and returns
**without changing that target**. This is what lets the FX picker open over a
`MOVE_NATIVE` session and return to the same synth screen. It generalizes to "any
registered view, over any co-run target."

Mechanically, while an overlay is open:
- OLED owner = `SCHWUNG_UI` (shadow_ui draws the view).
- The declared `keep_mask` keeps the overlay's nav inputs at the tool process; shadow_ui
  `onMidi` routes them into the view (extends the existing chain-edit intercept, which
  is gated `coRunChainEditSlot >= 0`, with an overlay-aware branch).
- `corun.target` is untouched → the consumer tool's state machine is undisturbed.
- Back at the overlay's top level calls `shadow_corun_close()` semantics (restore the
  underlay). Back gating must prevent the shim's framework-exit-on-Back
  (`schwung_shim.c:7291`) from ending the whole co-run while an overlay is up — handled
  by the overlay keeping Back at the tool/shadow_ui (via keep_mask) plus, if needed, a
  single "overlay active" flag in `reserved[1]` the shim checks.

### dAVEBOx integration (first consumer)

- At init/`pollDSP`, record whether `shadow_corun_entries?.()` includes `'fx_picker'`
  (capability gate). Only then is the button live.
- Replace the unconditional swallow at `ui.js:8015`. In Move co-run, on Note/Session
  press: if `fx_picker` is available, call
  `shadow_corun_open('fx_picker', PICKER_KEEP_MASK)` where `PICKER_KEEP_MASK` keeps
  jog/click/Back/Menu at the tool. Otherwise keep current behavior (swallow).
- On overlay close (detected via a state read, mirroring how `pollDSP` already reconciles
  co-run), restore the normal Move-native keep_mask. `corun.target` never left
  `MOVE_NATIVE`, so no `exitMoveNativeCoRun()` fires.
- dAVEBOx keeps pads/steps/transport throughout (same as chain-edit co-run).

---

## Data flow

**Open:** Move co-run active (`target=MOVE_NATIVE`, Move owns OLED) → user taps
Note/Session → dAVEBOx calls `shadow_corun_open('fx_picker', mask)` → host flips OLED to
shadow_ui, applies mask, runs `enterFxBusPicker()` → shadow_ui draws the picker; dAVEBOx
still sees `MOVE_NATIVE`, stays put.

**Navigate:** jog/click reach shadow_ui's `onMidi` (kept at tool by mask) → picker →
FX bus editors (existing code, unchanged).

**Close:** Back at picker top → `shadow_corun_close()` → OLED back to
`MOVE_FIRMWARE`, mask restored → you're on the Move synth screen again.

---

## Layering / upstream boundary

| | Upstream Schwung | dAVEBOx fork |
|---|---|---|
| Mechanism (`open`/`close`/`entries`, overlay, registry table) | ✅ ships it | same code |
| Registered screens | `slots`, `chain_editor`, `master_fx`, `global_settings` | same **+ `fx_picker`** (+ send-bus / Move-FX screens) |
| Consumer | any co-run tool | dAVEBOx Note/Session button |

Tools discover the catalog at runtime, so a build lacking `fx_picker` simply doesn't show
the button. No breakage across the gap.

---

## Edge cases & risks

- **Overlay return path (primary risk).** Handing OLED + input back to the Move-native
  underlay cleanly is the fiddly part; co-run LED/teardown edges have historically been
  where surprises live (cf. fork commits on LED handoff and defensive corun clears).
  Treat as the main risk line item in the plan; verify on device.
- **Teardown while overlay open.** If the user exits co-run (Back/Step-3) or the set
  changes while the overlay is up, the overlay flag/state must be cleared defensively
  (mirror the existing "defensively clear corun state on all teardown paths" fork fix).
- **Per-set FX strip reset** must not be disturbed by opening/closing the overlay.
- **Coalescing (dAVEBOx side):** opening the picker is a single `shadow_corun_open` call,
  not a multi-field push, so no set_param coalescing concern. Confirm the call reaches the
  host (existing co-run calls do).
- **No new global module set_param keys** — this uses exported `shadow_*` globals, not
  module set_param keys, so the "host drops new global keys" hazard does not apply.

---

## Scope estimate

- **Upstream mechanism (fork):** ~150–250 lines, mostly JS (registry table + open/close
  logic reusing existing enter-functions), plus ~40–60 lines C for three thin bindings
  (mirroring `corun_begin`), optionally +1 SHM byte and ~10 shim lines for Back gating.
- **Fork-only catalog:** ~10–30 lines to register `fx_picker` (+ siblings).
- **dAVEBOx:** ~30–60 lines (`ui.js` button handling + capability gate) + docs
  (MANUAL, SCHWUNG_PATCHES, CHANGELOG ×2).

Small because PR-94 and the existing screen enter-functions do the heavy lifting; this
adds a lookup table and two verbs, not a co-run rewrite.

---

## Out of scope (YAGNI)

- Exposing arbitrary internal sub-views (`COMPONENT_PARAMS`, `STORE_PICKER_*`, `TOOL_*`).
  The registry is curated; entries are added one reviewed item at a time.
- Shift-gating the gesture — confirmed plain Note/Session.
- Re-architecting the existing chain-edit menu-button path. It may later be re-expressed
  in terms of the new mechanism, but that refactor is not required here.
- Multiple simultaneous overlays / overlay stacking.

---

## Testing plan

- **On device (required).** Enter Move co-run on a ROUTE_MOVE track → tap Note/Session →
  FX picker appears over the synth screen → navigate Master/Send A/Send B/Move FX 1–4 →
  edit a bus → Back returns to the picker → Back returns to the Move synth screen, with
  the synth context intact and dAVEBOx pads/steps/transport live throughout.
- **Discovery degradation.** Confirm dAVEBOx hides the button when
  `shadow_corun_entries()` lacks `fx_picker` (simulate by gating).
- **Teardown.** Exit co-run (Back/Step-3) while the picker is open; confirm clean state,
  no LED corruption, no stuck overlay flag. Set-change while open.
- **Regression.** Chain-edit co-run menu button still opens the FX picker unchanged.
