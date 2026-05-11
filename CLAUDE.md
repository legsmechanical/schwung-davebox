# dAVEBOx

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

## Session workflow

- **Start of session**: run `~/schwung-docs/update.sh` and report the result. Then read `graphify-out/GRAPH_REPORT.md` to orient on god nodes and community structure. If unsure about a platform API, grep `~/schwung-docs/` rather than assuming.
- **Validate before acting** — read or grep actual code first. Never act on assumptions.
- **Commit after each logical change** — work directly on master, one commit per change.
- **Deploy and verify on device before reporting done** — always build+install and confirm on Move.
- **Reboot after every deploy** — Back suspends (JS stays in memory); Shift+Back fully exits but does NOT reload JS from disk. Full reboot required for JS changes.
- **JS-only deploy**: `python3 scripts/bundle_ui.py && ./scripts/install.sh` then restart. `build.sh` required for DSP changes (also copies all JS).
- **Restart Move**: `ssh root@move.local "for name in MoveOriginal Move MoveLauncher MoveMessageDisplay shadow_ui schwung link-subscriber display-server schwung-manager; do pids=\$(pidof \$name 2>/dev/null || true); [ -n \"\$pids\" ] && kill -9 \$pids 2>/dev/null || true; done && /etc/init.d/move start >/dev/null 2>&1"`
- **CLAUDE.md**: update at session end or after a major phase — not after routine task work.
- **README.md is maintained on GitHub directly** — do not edit or commit it locally. If asked to update README, refuse and point the user to edit on GitHub. A pre-commit hook blocks accidental commits.
- **State version bump**: Any time DSP struct layout changes or state format changes, delete ALL state files on device before deploying: `ssh root@move.local "find /data/UserData/schwung/set_state -name 'seq8-state.json' -exec rm {} \; && find /data/UserData/schwung/set_state -name 'seq8-ui-state.json' -exec rm {} \;"`. Dev build — always prefer a clean slate over migration.
- **DSP calls / pfx code**: read `docs/DAVEBOX_API.md` for parameter keys, structs, and algorithm details.
- **DSP work**: read `dsp/CLAUDE.md` for logging, build, state format keys, and deferred save details.
- **Feature reference**: before touching any feature area (bank, transport, copy/paste, bake, perf, etc.), read the relevant section in `docs/FEATURE_REFERENCE.md`.
- **Schwung patches**: see `docs/SCHWUNG_PATCHES.md`. After any Schwung upgrade: `cd ~/schwung && git apply patches/seq8-local.patch`. Deploy shim to `/data/UserData/schwung/schwung-shim.so` (not `/usr/lib/` symlink).

dAVEBOx is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). `button_passthrough: [79]` + `claims_master_knob: true` — Move firmware handles CC 79 natively; `claims_master_knob` prevents Schwung host from running its own acceleration, which caused inconsistent knob speed and MIDI output pauses.

## Upcoming tasks — see [TODO.md](TODO.md)

## Build / deploy / debug

```sh
./scripts/build.sh && ./scripts/install.sh      # DSP change (also copies all JS)
python3 scripts/bundle_ui.py && ./scripts/install.sh  # JS-only
nm -D dist/davebox/dsp.so | grep GLIBC             # verify ≤ 2.35
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

**JS modules** (`ui.js`, `ui_constants.mjs`, `ui_state.mjs`, `ui_persistence.mjs`, `ui_dialogs.mjs`, `ui_scene.mjs`, `ui_leds.mjs`) — bundled into `dist/davebox/ui.js` by `scripts/bundle_ui.py`. Always run the bundler before deploying JS changes. **DSP**: see `dsp/CLAUDE.md`.

## State persistence

DSP state v=26 (only v=26 accepted); v≠26 → deleted + clean start. Full key list in `dsp/CLAUDE.md`.

JS `init()` reads UUID, compares with `state_uuid` get_param. Mismatch → `state_load=UUID` next tick → `pendingDspSync=5` → `syncClipsFromDsp()` → `restoreUiSidecar(true)`. Same path fires on resume when set changed while suspended (UUID mismatch on resume edge). `restoreUiSidecar(applyDefaultsNow)` — shared helper called from init() and pendingDspSync=0 completion; applies activeTrack/trackActiveClip/sessionView/activeDrumLane/perf/beatMarkers; handles no-sidecar first-run defaults.

UI sidecar (`seq8-ui-state.json`): v=3; written on suspend/Quit/Shift+Back; wiped on Clear Session. Deferred save: handlers set `inst->state_dirty = 1`; JS `pollDSP()` writes via `host_write_file` when dirty. Suspend: sidecar written immediately, `set_param('save')` deferred to end of tick() via `S.pendingSuspendSave`.

Set-duplicate inheritance: when init detects a Copy-suffixed name + missing state file, `maybeShowInheritPicker` looks up family candidates in `seq8_name_index.json` and either auto-inherits (1 candidate), opens the dialog (2+), or starts blank (0). Details in `docs/FEATURE_REFERENCE.md` → *Set state inheritance & cleanup*. DSP-side `prune_orphan_states` handler cleans up `seq8-*.json` files for deleted Move sets on every launch.

## Critical constraints

- **Coalescing**: only the LAST `set_param` per audio buffer reaches DSP. `shadow_send_midi_to_dsp` shares the same delivery channel and also coalesces. In `onMidiMessage`, if both fire, the set_param is lost. Defer set_params to tick() via a pending variable (see `pendingRepeatLane` pattern). Multi-field operations require a single atomic DSP command.
- **get_param from onMidiMessage**: silently returns null. Only works from tick/render callbacks. Sync JS state from DSP in tick/render path instead.
- **No MIDI panic before state_load** — floods MIDI buffer, drops the load param.
- **Shift+Back does not reload JS** — `init()` re-runs in same runtime. Full reboot required for JS changes.
- **`reapplyPalette` resets CC LED hardware states**: `input_filter.mjs` `buttonCache` holds stale color → subsequent `setButtonLED` calls silently dropped. Call `setButtonLED(cc, color, true)` (force=true) after every `reapplyPalette` for persistent button LEDs.
- **Palette SysEx rate-limit**: gate updates to `POLL_INTERVAL` cadence + `ccPaletteCache` to skip SysEx when unchanged. Rapid knob turns otherwise fill the MIDI queue.
- **Multi-step toggle coalescing**: 3–4 simultaneous step presses → only the last set_param survives. Fix if observed: `pendingMultiToggle` array drained in tick().
- **ROUTE_MOVE external MIDI bypasses pfx chain**: injecting causes echo cascade (Move echoes cable-2 back → re-injection → crash). Use ROUTE_SCHWUNG if pfx processing on live external MIDI is needed.
- **pfx_send from set_param context does NOT release Move synth voices.**
- **`get_clock_status` is NULL**; `get_bpm` doesn't track BPM changes while stopped.
- **Do not load dAVEBOx from within dAVEBOx** — LED corruption. Shift+Back first.

## QuickJS compatibility

shadow_ui runs QuickJS, not V8. Node.js `--check` is NOT a reliable validator.
- **Member expressions as object keys are a syntax error**: `{ S.shiftHeld: val }` → use plain identifiers `{ shiftHeld: val }`. Caused a multi-hour debug session.
- **Confirmed supported**: `??`, `...` spread/rest, `for...of`, `Array.from`, `globalThis`, `Set`, `Map`.

## JS internals

- **Two-tick deferred pattern** (`_toggle` / `_set_notes`): `_toggle` tick N activates step; `_set_notes` tick N+1 writes chord/notes. Phase-2 check must precede phase-1 in tick() to prevent same-tick coalescing. `_set_notes` is a no-op on empty steps — activate first.
- **Count-in preroll chord capture**: `pendingPrerollNotes[]` (ui_state.mjs) accumulates all chord notes pressed during count-in on melodic tracks. At flush (all notes released + 1 step elapsed after transport start): first note fires `step_0_toggle`; remaining notes drain via `pendingPrerollToggleQueue` — one `step_0_toggle` per tick, last entry sets `pendingPrerollGate`. Drum preroll uses separate `pendingPrerollNote` (single object, unchanged).
- `pendingDrumResync` deferred 2 ticks after drum clip switch — `tN_lL_steps` reads active_clip implicitly; must wait for `tN_launch_clip` to process.
- `pendingStepsReread` 2 ticks after `_reassign`/`_copy_to`.
- `pollDSP` overwrites `trackActiveClip[t]` when playing; change triggers `refreshPerClipBankParams(t)` + drum resync.
- `bankParams[t][b][k]`: 7 banks (0=CLIP..6=CC PARAM), refreshed via `tN_cC_pfx_snapshot` on clip/track switch. Track config (Ch/Route/Mode/VelIn/Looper) uses dedicated arrays + `readTrackConfig`/`applyTrackConfig` — NOT in bankParams.
- `clipTPS[t][c]`: JS mirror of per-clip tps, synced via `t{n}_c{c}_tps` get_param.
- `tarpStepVel[t][s]`: per-track TARP step vel mirror, read via `tN_tarp_sv` batch get on init/track switch.
- `pendingDefaultSetParams`: first-run defaults (`scale_aware=1`, `metro_vol=100`, `t0_pad_mode=PAD_MODE_DRUM`).
- **JS tick rate**: ~94 Hz on device (512-sample buffers at 48kHz). `STEP_HOLD_TICKS=19` calibrated for ~94 Hz. Older constants (`NO_NOTE_FLASH_TICKS=118`, `STEP_SAVE_HOLD_TICKS=150`, `STEP_SAVE_FLASH_TICKS=40`) use 196 Hz assumptions — run at ~half speed on device.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- **Session start**: read `graphify-out/GRAPH_REPORT.md` immediately after the docs update — required, not optional.
- **Before any grep or file search — mandatory gate**: classify the question first. If it is a navigation question (where is X defined?), a relationship question (what calls Y? what does Z depend on?), or a call-chain question (what does changing W cascade into?) — you MUST use graphify before grep. No exceptions. The PreToolUse hook reminder is a hard stop, not a suggestion.
- **Grep is only permitted** when: (a) graphify has already been consulted and could not answer, or (b) you already know the exact file and line and are confirming a specific string, or (c) the target is outside this codebase (e.g. Schwung source, schwung-docs).
- **Code navigation**: `graphify query "<question>"` (BFS, broad context) · `graphify path "<A>" "<B>"` (shortest path) · `graphify explain "<concept>"` (node definition + connections). Use BEFORE reaching for grep or raw file reads.
- **Impact analysis**: `graphify query "<question>" --dfs` for dependency chains — use DFS when you need to know what a change cascades into (e.g. touching a god node like `set_param`).
- **Architecture questions**: always consult the graph first. God nodes (`set_param`, `drawUI`, `pfx_send`, `render_block`) are cross-community bridges — tracing them via graph beats manual grep.
- **Wiki**: if `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- **After code changes**: graph auto-updates via git post-commit hook. Run `graphify update .` manually only if you need the graph current mid-session before committing.
