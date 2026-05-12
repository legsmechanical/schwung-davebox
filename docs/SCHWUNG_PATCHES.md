# Schwung Patches

Local patches applied to `~/schwung/` that must be re-applied after any Schwung upgrade.

Current base: **v0.9.11** (`62529d77`), branch `main` on the `legsmechanical/schwung` fork. (Chain-edit co-run work landed via `feat/ui-split` and was merged to fork `main` on 2026-05-12.)

## Re-applying after a Schwung upgrade

```sh
cd ~/schwung && git apply patches/seq8-local.patch
```

Regenerate the patch after cherry-picking onto a new base:
```sh
git diff <new-base>..HEAD -- src/ > patches/seq8-local.patch
```

Verify each commit is present before deploying:
```sh
cd ~/schwung && git log --oneline | grep <sha>
```

Build and deploy shim:
```sh
cd ~/schwung && ./scripts/build.sh
scp ~/schwung/build/schwung-shim.so root@move.local:/data/UserData/schwung/schwung-shim.so
```
Then restart Move. Deploy to `/data/UserData/schwung/schwung-shim.so` (data partition), not `/usr/lib/schwung-shim.so` (symlink recreated on every boot by `schwung-heal`).

## Patch table

| PR | Commit (on fork/main) | File | Description |
|----|----------------------------|------|-------------|
| [#71](https://github.com/charlesvestal/schwung/pull/71) | `e70d7340` | `src/host/shadow_midi.c` | Defer cable-2 inject when cable-0 or cable-2 hardware is active — prevents SIGABRT in ROUTE_MOVE external MIDI monitoring |
| [#72](https://github.com/charlesvestal/schwung/pull/72) | `5b74e6cc` + `4a95b4d6` | `src/host/shadow_midi.c` | Hold inject drain for 2 frames (~6ms) after overtake exit — prevents SIGABRT when suspending (Back) with a ROUTE_MOVE drum pattern playing |
| (local) | `7c31d048` | `src/host/shadow_midi.c` | Defer on ANY MIDI_IN event (not just cable-0/2) — external controller + ROUTE_MOVE clip crash |
| (local) | `8f1a9d87` | `src/host/shadow_midi.c` | Bail inject if existing events must be skipped (`saw_existing`) — prevents write at non-zero offset |
| (local) | `3ae7e206` | `src/host/shadow_midi.c` | Strengthen any-cable guard — scan all MIDI_IN slots, not just slot 0 |
| (local) | `9ac557c5` + `b01a1e2e` | `src/schwung_shim.c`, `src/host/shadow_constants.h`, `src/shadow/shadow_ui.c` | EXT_MIDI_REMAP_BLOCK: suppress cable-2 note-ons from Move on non-ROUTE_MOVE tracks; patches sh_midi (not hardware) to avoid crash |
| (local) | `743bb18f` | `src/schwung_shim.c`, `src/host/shadow_midi.c`, `src/host/shadow_midi.h` | Cable-2 passthrough: inject cable-2 as cable-0 for Move native routing + dispatch to Schwung chain slots by channel when no tool active (overtake_mode==0 or suspend_overtake==1) |
| (local) | `456c0a9e` | `src/schwung_shim.c` | Remove THRU-slot gate from cable-2 remap: `any_thru_slot_active()` was silently blocking rechannelization whenever any THRU slot existed |
| (local) | `c31cf29c` → `9f0d2c8c` (5 commits) | `src/host/shadow_constants.h`, `src/schwung_shim.c`, `src/shadow/shadow_ui.c`, `src/shadow/shadow_ui.js` | **Chain-edit co-run mode.** Lets shadow_ui's chain editor (slot settings, hierarchy editor, preset browser) render and accept input while an overtake tool module (dAVEBOx) is still loaded and ticking. See [Co-run architecture](#co-run-architecture) below. |

PRs #71/#72 are upstream patches. Local commits fix inject races, add cable-2 BLOCK support for external MIDI isolation, and add the chain-edit co-run feature for dAVEBOx.

## Co-run architecture

Lets the user navigate Schwung's chain editor for a slot (add/remove modules, change presets, edit params via hierarchy editor) **without leaving dAVEBOx**. While co-run is active, OLED + jog + jog-click + track buttons + Shift drive the chain editor; pads, step buttons, knobs, transport, and Back stay with dAVEBOx. Entry: track menu → `Edit Slot...`. Exit: Menu button.

### What changed in Schwung

**`src/host/shadow_constants.h`** — `shadow_control_t` gains `int8_t corun_chain_edit_slot` (−1 = off, 0–3 = slot whose chain editor is co-running). Steals 1 byte from `reserved[6]` → `reserved[5]`. Layout-stable.

**`src/schwung_shim.c`** — initializes `corun_chain_edit_slot = -1` on boot.

**`src/shadow/shadow_ui.c`** — two new JS bindings:
- `shadow_set_corun_chain_edit(slot)` — enable co-run for `slot` (or `-1` to disable). Tool side calls this on Edit-Slot entry; chain editor's Menu intercept calls it with `-1` to exit.
- `shadow_get_corun_chain_edit()` — read current state. Tool side polls this to detect external clears (Menu).

**`src/shadow/shadow_ui.js`** — the load-bearing change. Five pieces:

1. **Top of `tick()`**: poll SHM for the co-run slot. On `-1 → N` transition, initialize chain-editor state for that slot (selectedSlot, selectedChainComponent, loadChainConfigFromSlot) without changing the outer `view` (which must stay `VIEWS.OVERTAKE_MODULE` so the tool keeps ticking).
2. **`runCoRunChainEdit(fn)` helper**: temporarily swap the outer `view` to `coRunView` so dispatch functions (`handleJog`, `handleSelect`, `handleBack`, draw fns) land on the chain-edit branch. Captures any view-changes back into `coRunView` so deeper navigation (PATCHES → COMPONENT_EDIT → KNOB_EDITOR etc.) sticks across frames.
3. **`dispatchCoRunDraw()` helper**: mirrors the main draw switch's chain-edit subtree (CHAIN_EDIT → drawChainEdit, PATCHES → drawPatches, COMPONENT_PARAMS, COMPONENT_SELECT, CHAIN_SETTINGS, COMPONENT_EDIT, HIERARCHY_EDITOR, KNOB_*, LFO_*, STORE_PICKER_*, FILEPATH_BROWSER). Called from the OVERTAKE_MODULE tick branch after the tool tick.
4. **Per-CC input split** in `onMidiMessageInternal`'s OVERTAKE_MODULE branch: CCs 3 (jog click), 14 (jog turn), 40–43 (track buttons), 49 (Shift), 50 (Menu), and 51 (Back) are intercepted before the tool sees them. Jog/click route to `handleJog`/`handleSelect` (with Shift+Click → `handleShiftSelect` mirrored from the non-overtake handler). Track buttons switch the editing slot. Shift updates `hostShiftHeld` and is swallowed. Menu clears the co-run flag. Back navigates up within the editor or is eaten at the CHAIN_EDIT top level.
5. **Param-shim swap (`runToolCallback`)**: when chain-editor entry calls `setupModuleParamShims` (either via `enterHierarchyEditor` or `loadModuleUi`), `globalThis.host_module_get_param` / `host_module_set_param` get overwritten to route at the slot DSP. This *would* silently misroute every active-tool IPC. Fix: cache the real host APIs on first shim install, and wrap every tool callback (tick, onMidiMessageInternal, knob/jog delta flushes) with a swap-and-restore so the tool always talks to its own DSP. The chain editor's own draws keep the shimmed APIs.

Two gates also short-circuit problematic native paths during co-run:
- **`loadModuleUi`** refuses (returns `false`) when `coRunChainEditSlot >= 0`. The fallback path in `enterComponentEditFallback` then takes the simple preset-browser branch instead of loading the module's UI JS (which would overwrite `globalThis.tick`/`onMidiMessageInternal` and silence the tool entirely).
- **The `suspend_keeps_js` Back handler** (line ~15316) gates on `coRunChainEditSlot < 0` so the co-run Back intercept runs first; otherwise Back would suspend the tool instead of navigating up within the chain editor.

### Tool-side contract (the dAVEBOx half)

A tool that opts into co-run is expected to:
- Call `shadow_set_corun_chain_edit(slot)` on entry, `shadow_set_corun_chain_edit(-1)` on exit.
- Skip its own OLED drawing while co-run is active (early-return in its draw path). Drawing primitives are shared with the chain editor; the chain editor calls `clear_screen()` at the start of each draw so anything the tool drew gets wiped, but skipping saves the wasted work and prevents visible flicker.
- Re-render normally when co-run clears (the tool polls `shadow_get_corun_chain_edit()` and reacts to external clears, e.g. from Menu).
- Accept that Shift, track buttons (CC 40–43), jog, jog-click, and Back are unavailable to the tool while co-run is active.

dAVEBOx implements this contract via `S.schwungCoRunSlot`, the `Edit Slot...` track-menu action, and a `pollDSP` reconciliation step.

### Why this isn't suitable for upstream

The feature is narrowly designed for the dAVEBOx use case. Two open questions for a generalized upstream version:
- The tool-side "skip my draw" contract is implicit; upstream might want a manifest flag or host-side gate.
- `dispatchCoRunDraw` mirrors the main draw switch; upstream additions to chain-edit-reachable views would need to be mirrored here too. A shared dispatch helper would be cleaner.

See `~/.claude/projects/-Users-josh-schwung-davebox/memory/project_schwung_chain_ui_access.md` for the original heavy design and the design conversation.
