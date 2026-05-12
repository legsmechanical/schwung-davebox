# Schwung Patches

Local patches applied to `~/schwung/` that must be re-applied after any Schwung upgrade.

Current base: **v0.9.11** (`62529d77`), branch `main` on the `legsmechanical/schwung` fork. (Chain-edit co-run work landed via `feat/ui-split` and was merged to fork `main` on 2026-05-12.)

## Why this is split into two repos

dAVEBOx ships from `legsmechanical/schwung-davebox` `main` to anyone running stock Schwung — public releases need to install cleanly on `charlesvestal/schwung` without expecting patches. But some dAVEBOx features (currently: chain-edit co-run via `Edit Slot...`) require Schwung-side surgery that isn't a candidate for upstream as-is.

**Pattern:** keep all dAVEBOx code on `main`, capability-gate any feature that needs patched-Schwung APIs at the entry point (typically the menu item that triggers it). On stock Schwung the gate resolves false → entry doesn't render → the feature is invisible and all downstream code stays dormant. On a Move running the patched `legsmechanical/schwung` shim, the gate resolves true and the feature lights up automatically.

Concrete example (from `buildGlobalMenuItems()` in `ui/ui.js`):

```js
...(typeof shadow_set_corun_chain_edit === 'function' ? [
    createAction('Edit Slot...', function() {
        openSchwungSlotEditor(S.activeTrack);
    })
] : []),
```

All downstream calls (`shadow_set_corun_chain_edit`, `shadow_get_corun_chain_edit`) are defensively guarded with `typeof ... === 'function'` checks, and runtime state like `S.schwungCoRunSlot` defaults to `-1` so the LED-suppression / drawUI-early-return / Back-exit hooks all stay false-y on stock Schwung.

**Result:** one repo, one main branch, one release flow. Co-run lives in the codebase as a feature that simply doesn't surface unless the host supports it.

## Maintenance workflow

Day-to-day dAVEBOx development is normal — work on `main`, commit, release via `scripts/cut_release.sh`. The patched-Schwung side has its own cadence:

1. **When upstream Schwung tags a new release** (e.g. `v0.9.12`):
   - Fetch and check out the new tag in `~/schwung`.
   - Cherry-pick the local commits from the previous fork-`main` onto the new tag (or rebase). Resolve any conflicts.
   - Regenerate the patch:
     ```sh
     cd ~/schwung
     git diff <new-tag>..main -- src/ > patches/davebox-local.patch
     git add patches/davebox-local.patch && git commit -m "chore: regenerate patch against <new-tag>"
     git push fork main
     ```
   - Update the "Current base" line in this file and `patches/README.md` in the fork.
   - Build the new shim (`./scripts/build.sh`), deploy to Move, smoke-test.

2. **When a new local Schwung change is needed** (e.g. extending co-run, adding another capability-gated API):
   - Work on a feature branch in `~/schwung` off `main`.
   - When ready, fast-forward `main` and regenerate the patch (`git diff v<base>..main -- src/ > patches/davebox-local.patch`).
   - Push fork.
   - In `~/schwung-davebox`, add the corresponding feature gated on `typeof shadow_xxx === 'function'`.

3. **When cutting a dAVEBOx release**:
   - Normal `scripts/cut_release.sh <version>` flow. No special handling — capability-gated features go along for the ride, invisible to stock-Schwung users.

## Re-applying after a Schwung upgrade

```sh
cd ~/schwung && git apply patches/davebox-local.patch
```

Regenerate the patch after cherry-picking onto a new base:
```sh
git diff <new-base>..HEAD -- src/ > patches/davebox-local.patch
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
| (local) | `9a32ccf6` + `1e27f983` (2 commits) | `src/host/shadow_constants.h`, `src/schwung_shim.c`, `src/shadow/shadow_ui.c` | **Move-native co-run mode.** Lets Move firmware's preset browser + device-edit pages render to the OLED and accept jog/track-button/knob/Shift/Back input while an overtake tool (dAVEBOx) keeps pads, step buttons, transport, and Menu. Pure shim-level split — no `shadow_ui.js` change because Move firmware is a separate process reading the shadow_mailbox MIDI_IN region directly. See [Move-native co-run architecture](#move-native-co-run-architecture) below. |

PRs #71/#72 are upstream patches. Local commits fix inject races, add cable-2 BLOCK support for external MIDI isolation, and add the chain-edit + Move-native co-run features for dAVEBOx.

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

## Move-native co-run architecture

Lets the user open Move firmware's native preset browser and device-edit pages for a track's synth **without leaving dAVEBOx**. While co-run is active, OLED + jog + jog-click + track buttons + Shift + Back + device-edit knobs (CC 71–78) + master knob (CC 79) + capacitive touch notes 0–9 drive Move firmware. dAVEBOx keeps pads, step buttons, transport, and Menu — pads still fire the sequencer audibly so the user can audition presets against the playing pattern. Entry: track menu → `Edit Synth...` (visible only on ROUTE_MOVE tracks). Exit: Menu button.

Architecturally a sibling of [chain-edit co-run](#co-run-architecture) with the receiving side swapped from `shadow_ui`'s chain editor (JS, same process) to Move firmware (separate process, reachable via the shadow_mailbox MIDI_IN buffer + display_mode-bypass framebuffer copy). The split is **entirely shim-side** because Move firmware reads `sh_midi` (the shim-filtered shadow_mailbox region) directly, not `shadow_ui_midi_shm` (the JS dispatch buffer). No `shadow_ui.js` change is needed; no `runToolCallback` host-API swap is needed (Move firmware can't clobber the tool's `globalThis` shims because it's a separate process).

### What changed in Schwung

**`src/host/shadow_constants.h`** — `shadow_control_t` gains `int8_t corun_move_native_track` (−1 = off, 0–7 = active dAVEBOx track). Steals 1 byte from `reserved[5]` → `reserved[4]`. Layout-stable. Bound is 0–7 (not 0–3) because dAVEBOx has 8 sequencer tracks; the shim only uses the value as a gate (`>= 0` = co-run active), so the actual identity is for the tool side to interpret.

**`src/schwung_shim.c`** — three additions:

1. **`shadow_swap_display()` early-return** when `corun_move_native_track >= 0`. Bypasses the shadow framebuffer copy without dropping `shadow_display_mode`, so Move firmware's framebuffer reaches the OLED while the MIDI filter at the `sh_midi` sync site (which is gated on `shadow_display_mode`) stays active. Without this bypass the only way to yield the OLED would be `display_mode = 0`, which would also disable the filter and leak pads + transport to Move firmware.
2. **`sh_midi` filter override** at the overtake-mode-2 branch (~line 5519). The existing filter zeros all cable-0 `status >= 0x80` events from what Move firmware reads. The override sets `filter = 0` for the navigation surface: CCs 3, 14, 40–43, 49, 51, 71–78, 79 and touch notes 0–9. Move firmware now sees the events it needs to drive its preset browser / device-edit pages.
3. **`shadow_ui_midi_shm` forward filter** at the overtake-2 forward (~line 6515). The existing forward sends every cable-0 event to the tool. The override `continue`s on the same nav-CC + touch-note set so dAVEBOx stops seeing them while co-run is on. Pads, step buttons, transport, and Menu (the tool's exit gesture) still flow.

The two filter lists are mirrors of each other — keep them in sync.

**`src/shadow/shadow_ui.c`** — two new JS bindings:
- `shadow_set_corun_move_native(track)` — enable co-run for `track` (or `-1` to disable). The dAVEBOx side calls this on `Edit Synth...` entry and on Menu exit.
- `shadow_get_corun_move_native()` — read current state. Tool polls this for external clears (currently dead code in Phase A — the dAVEBOx side handles its own Menu intercept — but kept for parity with chain-edit and so any future shim-side exit propagates).

### Tool-side contract (the dAVEBOx half)

A tool that opts into Move-native co-run is expected to:
- Call `shadow_set_corun_move_native(track)` on entry, `shadow_set_corun_move_native(-1)` on exit.
- Skip its own OLED drawing while co-run is active (Move firmware draws to the OLED; the tool's pixels would be invisible anyway because of the shim's `shadow_swap_display` bypass, but skipping saves the wasted work).
- Optionally fire a single synthesized track-button tap on entry via `move_midi_inject_to_move` (cable-0 CC 43–`(channel-1)` press + release) so Move firmware lands on the preset browser for the right track without the user needing to touch the front panel.
- Accept that jog, jog-click, track buttons (CC 40–43), Shift, Back, device-edit knobs (CC 71–78), master knob (CC 79), and capacitive touch notes 0–9 are unavailable to the tool while co-run is active.

dAVEBOx implements this contract via `S.moveCoRunTrack`, the `Edit Synth...` track-menu action (capability-gated on `S.trackRoute[t] === 1` + the two binding probes), the `drawUI` early-return, a `pollDSP` reconciliation step, and a Menu (CC 50) short-circuit in `_onCC_buttons`.

### Phasing — frozen LEDs in practice

The Phase A `drawUI` early-return freezes pad and step-button LEDs at their entry-time state during co-run. Static state (active-track color, clip color, drum-lane assignments, armed-step state) is preserved; animated state (playhead pulses, mute/solo flashes, beat-marker pulses) stops animating. The sequencer continues firing audibly.

The originally-planned "Phase B" refactor — splitting `drawUI` into "render OLED" vs "render pad/step-button LEDs" branches so LEDs stay live during co-run — was deferred after real-use testing on 2026-05-12 confirmed the freeze isn't a problem in practice. Nothing the user actually does during co-run depends on live LED feedback (drum cell-select is gesture-driven, preset audition is OLED+audio-driven). The refactor remains an option if a future Move firmware change or new co-run consumer makes the freeze visibly annoying, but isn't worth pursuing speculatively.

### LED-write filtering (Phase 1.5, deferred)

While dAVEBOx's `drawUI` skips, Move firmware may still issue LED writes for its own UI elements (e.g. pad-area display while in the device-edit grid). For Phase A those writes reach hardware and can clobber dAVEBOx's frozen pad LEDs. A shim-side filter that blocks Move firmware's pad / step-button / Menu / transport LED writes during co-run — while passing through knob-ring / master / track-button / Shift / Back writes — is the right cleanup. It's deferred until the on-device behavior is observed; the LED protocol per physical-element needs to be identified before a clean filter can be written.

### Why this isn't suitable for upstream

Same shape as chain-edit co-run's why-not-upstream: the tool-side "skip my draw" contract is implicit, and the nav-surface list is hand-curated for the dAVEBOx UX. A generalized version would want a manifest-driven let-through set.

See `/Users/josh/.claude/plans/6-spicy-waterfall.md` for the design conversation (approved 2026-05-12).
