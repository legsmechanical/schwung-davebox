# SEQ8

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
- **State version bump**: Any time DSP struct layout changes or state format changes, delete ALL state files on device before deploying: `ssh root@move.local "find /data/UserData/schwung/set_state -name 'seq8-state.json' -exec rm {} \; && find /data/UserData/schwung/set_state -name 'seq8-ui-state.json' -exec rm {} \;"`. This is a dev build — backward compatibility is not important; always prefer a clean slate over migration.
- **DSP calls / pfx code**: read `docs/SEQ8_API.md` for parameter keys, structs, and algorithm details.
- **DSP work**: read `dsp/CLAUDE.md` for logging, build, state format keys, and deferred save details.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). `button_passthrough: [79]` — volume knob handled natively.

## What's Built

**Transport**: Play/Stop. Shift+Play=restart. Delete+Play: playing→`deactivate_all`; stopped→`panic`. **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one/callback; pollDSP restores stale state between calls. BPM owned by SEQ8; `set_param("bpm")` updates `tick_delta`+`cached_bpm`.

**Views**: Track View (16 steps, isomorphic pads). Session View (CC 50, 4×8 grid) — **any clip pad press sets `activeTrack`** (carries to Track View). Loop held→pages view; Loop+jog=±1 clip length; Shift+Loop=double-and-fill.

**Clip state model** (5 states): Empty·Inactive·Will-relaunch·Queued·Playing. Launch: playing→legato; stopped→Queued. Page-stop (`tN_stop_at_end`): next 16-step boundary. Quantized launch: `queued_clip>=0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant]==0` at tick_in_step=0. Transport stop→`will_relaunch=1`; play→fires immediately. Side buttons (CC 40–43, Track View): playing+active→stop-at-end; pending→cancel; will_relaunch→deactivate; queued===idx→deactivate; else→launch. Session side buttons always launch scene.

**Step entry**: Tap(<200ms)=toggle; hold=step edit. Empty step auto-assigns `lastPlayedNote`. Chord: held pads additive. Auto-assigned step+external MIDI→`_set_notes` replace; otherwise `_toggle` additive. CC 86: stopped→count-in→transport+record; playing→arm; again=disarm (`finalize_pending_notes`).

**Step edit** (melodic, held step): Oct·Pit·Dur·Vel·Ndg. Nudge crossing ±tps/2→adjacent step live; `_reassign` on hold-release. Hold+tap another step→span gate. K3 touch: LEDs show gate length overlay. **Drum**: Dur·Vel·Ndg. Nudge strictly `>tps/2` (not `>=`). Vel pad while step held→sends `_step_S_vel`.

**Copy** (CC 60 held): step→step; clip/lane/row; drum clip (32 lanes). `copySrc` kinds: `'clip'`·`'cut_clip'`·`'row'`·`'cut_row'`·`'step'`·`'drum_lane'`·`'cut_drum_lane'`·`'drum_clip'`·`'cut_drum_clip'`. **Cut** (Shift+Copy): source NOT cleared until paste via `tN_lL_cut_to`/`drum_clip_cut`/`clip_cut`/`row_cut`. Drum lane cut undo: snapshots full clip. Drum clip cut undo: snapshots dst only; src clear not undoable.

**Delete** (CC 119 held): step·clip·scene. Delete+jog=`tN_pfx_reset`; Shift+Delete+jog=full reset+SEQ ARP; Shift+Delete+clip=`tN_cC_hard_reset` (length=16,tps=24,all cleared). Delete+Play(playing)=`deactivate_all`; Delete+Play(stopped)=panic.

**Active bank**: Shift+top-row pad (92–97), 7 banks: CLIP(0)·NOTE FX(1)·HARMZ(2)·MIDI DLY(3)·SEQ ARP(4)·TRACK ARP(5)·CC PARAM(6). Jog cycles 0–6. **Drum tracks: banks 2 (HARMZ) and 4 (SEQ ARP) are hidden** — jog skips them, Shift+pad 3/5 blocked, bank falls back to 0 on track/mode switch. OLED priority: count-in→COMPRESS LIMIT→pop-ups(~500ms)→step edit→bank overview→header. Conditional overlays: DRUM LANE replaces CLIP(0) on drum tracks; NOTE/NOTEFX replaces NOTE FX(1) on drum tracks; RPT GROOVE replaces TRACK ARP(5) in repeat mode.

**CLIP bank**: Stretch(K1,lock), Clock Shift(K2), Nudge(K3,crosses ±tps/2), Resolution(K4,proportional; Shift+K4=zoom,blocked>256→"NOTES OUT OF RANGE"), Length(K5), Seq Follow(K8,JS-only,default ON,not persisted). NOTE FX K5 Quantize: `effective_tick_offset = raw*(100-q)/100`.

**CC PARAM bank (bank 6)**: Per-track, per-clip CC automation on melodic tracks. 8 knob slots (K1-K8); Shift+K=assign CC number (turn jog). `cc_send` set_param records point into `clip_cc_auto[clip]` snapped to nearest 1/32 when `recording`. **Touch-record**: while recording, holding a knob (note 0-7 press) sets `cc_touch_held` bit, writes the current CC value (`cc_live_val[k]`) to the automation lane at every 1/32 boundary in the DSP render path, and suppresses automation playback for that knob indefinitely (not just `CC_TOUCH_GRACE_BLOCKS`). `cc_touch` set_param format: "K 1 V" (touch-on with initial value) / "K 0 0" (touch-off). **Step-edit**: hold step in bank 6 → OLED shows "CC S1-S16" with 4×2 knob grid; knobs write staircase hold via `cc_auto_set2` set_param ("C K T1 T2 V"), which atomically inserts two points at step start tick and `start + tps - 1`. No-note dialog suppressed in bank 6. **Delete**: Delete+jog=clear all CC automation for active clip (`cc_auto_clear`); Delete+knob turn OR Delete+knob touch=per-knob clear (`cc_auto_clear_k`). Both reset `trackCCLiveVal` and `cc_auto_last_sent[k]=0xFF`. **LED brightness**: scratch palette indices 51-58, updated at `POLL_INTERVAL` cadence (not every tick) via `ccPaletteCache` — only sends `setPaletteEntryRGB` SysEx when value changes. Armed=red, playback=green. After every `reapplyPalette`, force-resend `MovePlay` and `MoveRec` with `force=true` to bypass `input_filter.mjs` `buttonCache` (see Critical constraints). Static: VividYellow=has-automation, White=assigned-no-auto, Off=unassigned. `send_panic` fix: ROUTE_EXTERNAL uses CC120+CC123 instead of 128 note-offs (ext_queue is only 64 slots).

**Suspend/Resume**: Back=suspend (sequencer keeps playing in background); Shift+Step13=resume (double-tap/long-press=direct, single-tap=Tools menu); Shift+Back=full exit. State auto-saved on suspend. `saveState()` helper used by suspend, Quit, and Shift+Back paths.

**Global menu** (Shift+CC 50): **Track Config section** (Ch·Route·Mode·VelIn·Looper — per-`activeTrack`, live-updates on track switch; header shows "Track N") then `── Global ──` divider, then BPM·Tap Tempo·Key·Scale·Scale Aware·Launch·Swing Amt/Res·Inp Quant·MIDI In·Metro(Off/Count/On/Rec+Ply; Mute+Play shortcut)·Beat Marks(On/Off, persisted in UI sidecar)·Quit·Clear Sess (writes `{"v":0}`, wipes UI sidecar, triggers DSP fresh-init). Close: Shift+CC50 toggles; NoteSession (CC50 tap) closes menu/tap-tempo/confirm dialogs (Back no longer reaches module). Shift+jog passes through to normal track-switch while menu is open.

**External MIDI**: →`activeTrack`. **ROUTE_MOVE**: `liveSendNote` NOT called — injecting causes echo cascade→crash. Pads unaffected (cable-0). Recording echo filter: `seqActiveNotes.has(d1)` guards ROUTE_MOVE `recordNoteOn`. External MIDI is rechannelized to the active track's channel via `host_ext_midi_remap_*` when ROUTE_MOVE is active. `applyExtMidiRemap()` is called from `tick()` (change-detect on activeTrack/route/channel/midiInChannel) and from `init()`. `onMidiMessageExternal` filters by `trackChannel[t]` when `S.extMidiRemapActive` is set. Shim auto-resets remap on overtake exit. **ROUTE_EXTERNAL** (Route=Ext in Global Menu): sequenced notes go DSP `pfx_send`→`ext_queue` ring buffer→JS tick() drains via `get_param('ext_queue')`→`move_midi_external_send` (USB-A). Live pad/MIDI input sent directly from JS via `move_midi_external_send` (no DSP round-trip). VelIn override applies. Verified on device. See `docs/EXTERNAL_MIDI_USER_GUIDE.md`.

**Global MIDI Looper** (Session View): Loop+step arms. Steps 1–6=length(1/32..1bar; triplets with step 16 held). DSP: IDLE→ARMED→CAPTURING→LOOPING. Hook runs after SEQ ARP gate. Mid-loop rate applied at next boundary.

**Perf Mode** (Session View, loop running): double-tap Loop=lock; Loop+length pad=start. 4 rows × 8 pads = 32 mods (see `docs/SEQ8_API.md`). Step buttons=16 preset slots. `perf_mods`=OR(toggled+held+recalled) sent on every change. Persistence: `perfModsToggled`/`perfLatchMode`/`perfRecalledSlot`/user snapshots(8–15) via UI sidecar v=3; re-sent via `pendingDefaultSetParams` on restore. DSP: `perf_apply()` in `pfx_send`; drum tracks bypass pitch mods.

**Play effects chain**: TRACK ARP→NOTE FX→HARMZ→MIDI DLY→SEQ ARP. TRACK ARP intercepts live input (pads + external MIDI) only; sequenced notes enter at NOTE FX. Per-clip params (`clip_pfx_params_t`); clip switch→`pfx_sync_from_clip`. See `docs/SEQ8_API.md` for arp algorithm details. TRACK ARP bypassed on drum tracks.

**MIDI DLY bank** (bank 3): Rate(K1, 17 values: 1/64..1/1D including dotted, default 1/8D=idx 10), Lvl(K2), Rep(K3), Vfb(K4), Pfb(K5, ±24 semitones), Gate(K6, 0=Off/1-10=1/64..1bar fixed absolute gate in 96-PPQN ticks × 5 → samples), Clk(K7), Rnd(K8, 0=Off/1-24=±semitone range). Gate sign in `reps[i].gate_factor`: negative=fixed (−ticks×TICKS_TO_480PPQN×sp), non-negative=relative (1.0=original). Bake uses GATE_FIXED_TICKS directly. Skip condition: `repeat_times<=0 || delay_level<=0` (time index 0 no longer skips since index 0 is now 1/64 not null).

**SEQ ARP bank** (bank 4, "ARP OUT"): Styl(K1, 0=Off), Rate(K2), Oct(K3), Gate(K4), Stps(K5), Rtrg(K6, default ON), Sync(K7, default ON). Sync=ON: first step waits for next `arp_master_tick % rate == 0` boundary (global grid); Sync=OFF: fires at next boundary relative to anchor. Per-clip state key `t%dc%d_arsy` (sparse, default=ON i.e. emitted when 0). pfx_snapshot fields 17-23 = style/rate/oct/gate/stps/rtrg/sync; step_vel at 24-31.

**TRACK ARP bank** (bank 5, "ARP IN"): Styl(K1, 0=Off/1-9=style, drives tarp_on — no separate On knob), Rate(K2), Oct(K3), Gate(K4), Stps(K5), _(K6 empty), Sync(K7), Ltch(K8). tarp_on derived from tarp_style on load: `style!=0 → tarp_on=1`. State saves tarp_style only when `!=0`.

**Track config** (in Global Menu, not a bank): Ch·Route(0=Swng/1=Move/2=Ext)·Mode·VelIn·Looper. Per-track, stored in dedicated JS arrays (`trackChannel[]`, `trackRoute[]`, `trackPadMode[]`, `trackVelOverride[]`, `trackLooper[]`). `readTrackConfig(t)` syncs from DSP; `applyTrackConfig(t, key, val)` writes to DSP with side-effects. **VelIn** (per-track, `t%d_tvo`): 0=Live (raw velocity, default), 1–127=absolute fixed. Applies pre-pfx-chain to all note input (pads, ext MIDI, recording). DSP `effective_vel(tr, raw)` replaces old global `input_vel`. Global Input Velocity removed.

**Note Repeat** (drum tracks, jog click or DRUM LANE K7 to cycle modes): Rpt1=single-lane hold-to-repeat; Rpt2=multi-lane simultaneous. Right pads: bottom 2 rows=rate (1/32,1/16,1/8,1/4 straight+triplet), top 2 rows=8-step gate mask. RPT GROOVE (bank 5 overlay): K1-K8 = vel scale (0-200%, unshifted) or nudge (-50..+50%, Shift) per step. Latch: Loop+rate(Rpt1) or Loop+lane(Rpt2). Aftertouch updates velocity live. Delete+jog=groove reset. State keys in `dsp/CLAUDE.md`. JS sync via render-path `syncDrumRepeatState` (get_param fails from onMidiMessage).

**Swing** (Global Menu: Swing Amt 0–100, Swing Res 1/16 or 1/8): MPC2000-style groove — delays even-indexed steps (Amt 0=50%, 100=75% of pair length). Applied as the final stage of `pfx_send` via sample-queue deferral (`PFX_EV_BYPASS_SWING` flag in `pfx_q`), so bake/merge naturally bypass it. MIDI Delay echoes automatically land on their swung step positions. State keys: `_swa` / `_swr` (sparse, default 0). CC automation not swung (intentional).

**Mute/Solo**: `effective_mute(t)=mute[t]||(any_solo&&!solo[t])`. **Mutually exclusive** — setting one clears the other (recall paths bypass). Snapshots: Shift+Mute+step=save; Mute+step=recall; stores `snap_drum_eff_mute[16][NUM_TRACKS]`. Per-lane: `drum_lane_mute`/`drum_lane_solo` bitmasks; Delete+Mute clears all. Persisted as `t%ddlm`/`t%ddls`. **OLED indicators** (`drawTrackRow`): muted=blinking number; soloed=filled/inverted box with dark number; normal=white number with border when active.

**Bake** (Sample button): Opens confirm dialog. **Melodic**: default No/Yes; jog rotates, jog click confirms. Bake applies pfx chain offline (NOTE FX+HARMZ→MIDI DLY→SEQ ARP output), writes results back, calls `clip_build_steps_from_notes` (critical — step arrays must be rebuilt or subsequent `_toggle`→`clip_migrate_to_notes` will wipe baked notes), clears pfx_params via `clip_init`, restores tps/length, calls `pfx_sync_from_clip`. **Drum**: 3-button BAKE DRUMS? dialog (CLIP/LANE/CANCEL, default CANCEL). **CLIP mode** (`bm=2`, `bake_drum_clip`): full pfx chain per lane including HARMZ; output notes routed across lanes by `midi_note` pitch match; pool cap `DRUM_BAKE_POOL=2048`; all lanes cleared then pool routed. **LANE mode** (`bm=1`, `bake_drum_lane`): vel/gate/MIDI DLY/ARP per lane, no pitch/HARMZ expansion; "No Pitch / HARMZ FX" notice shown in dialog. Both drum modes use `undo_begin_drum_clip`; notes/steps and pfx_params fully restored on undo/redo. Sample or NoteSession cancels any bake dialog.

**Live Merge** (Shift+Sample, melodic + drum tracks): captures live playback from the pfx chain into a new empty clip slot. Shift+Sample=arm (LED Red); transport start→LED Green (CAPTURING). Sample=schedule stop at next 16-step page boundary (STOPPING state, LED stays Green until DSP finalizes). DSP states: IDLE(0)→ARMED(1)→CAPTURING(2)→STOPPING(3)→IDLE(0). **Melodic**: notes captured into `clips[dst]` via `pfx_send` hook; on finalize JS triggers `pendingStepsReread`. **Drum**: notes routed to `drum_clips[dst].lanes[l].clip` by matching captured pitch to `lane->midi_note`; all 32 lanes init'd at arm; `clip_build_steps_from_notes` called per non-empty lane on finalize; JS triggers `syncDrumClipContent`. Auto-finalize at 256 steps (max length). Popups: "NO EMPTY / CLIP SLOT" when arm fails (detected via `pendingMergeArm` flag + next-poll check); "MAX LENGTH / REACHED" when DSP jumps CAPTURING→IDLE directly (state 2→0, not via STOPPING).

**State persistence**: DSP state v=23 (v=23 only accepted); v<23 → deleted + clean start. Full key list and format in `dsp/CLAUDE.md`.

**JS internals** (key gotchas):
- `pendingDrumResync` deferred 2 ticks after drum clip switch — `tN_lL_steps` reads active_clip implicitly; must wait for `tN_launch_clip` to process first. Melodic `tN_cC_steps` is clip-indexed, no defer needed.
- `pendingStepsReread` 2 ticks after `_reassign`/`_copy_to`.
- `pollDSP` overwrites `trackActiveClip[t]` when playing; change triggers `refreshPerClipBankParams(t)` + drum resync.
- `clipTPS[t][c]`: JS mirror of per-clip tps; synced via `t{n}_c{c}_tps` get_param.
- `bankParams[t][b][k]`: 7 banks (0=CLIP..6=reserved), refreshed via `tN_cC_pfx_snapshot` on clip/track switch. Track config (Ch/Route/Mode/VelIn/Looper) is NOT in bankParams — uses dedicated arrays + `readTrackConfig`/`applyTrackConfig`.
- `tarpStepVel[t][s]`: per-track TRACK ARP step vel mirror; read via `tN_tarp_sv` batch get on init/track switch.
- `pendingDefaultSetParams`: first-run defaults (`scale_aware=1`, `metro_vol=100`).
- UI sidecar (`seq8-ui-state.json`): v=3; restores `activeTrack`, `trackActiveClip[]`, `sessionView`, `activeDrumLane[]`, perf state, `beatMarkersEnabled`; written on suspend/Quit/Shift+Back; wiped on Clear Session.

## Upcoming tasks

1. ~~**Undo LED freeze**~~ **done** — DSP populates `last_restore_info` on undo/redo; JS reads it 5 ticks later and re-syncs only the affected clip(s) (~5-15 get_param calls vs ~300).
2. ~~**Drum step-to-step copy**~~ **done** — `copyStep()` has drum lane branch using `tN_lL_step_S_copy_to`.
3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
4. **Step/note editing fixes** — see pending fixes in planning doc.
5. ~~**MIDI Delay overhaul**~~ **done** — 17 timing values (dotted included), default 1/8D; Pitch Random 0..24 semitone range; Gate 0=Off/1-10=absolute fixed; ARP IN On knob removed (Style 0=Off), Ltch now K8; tap tempo uses Date.now() ms. SEQ ARP Sync knob added (K7, default ON). Mute/solo OLED indicators swapped.
6. Full instance reset · 7. State snapshots (16 slots) · 9. MIDI clock sync
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.
11. ~~**VelIn**~~ **done** (Global Menu Track Config, per-track input velocity override).
12. ~~**Note Repeat**~~ **done** (Rpt1/Rpt2, RPT GROOVE, gate/vel_scale/nudge per lane).
13. ~~**ROUTE_EXTERNAL**~~ **done** (Global Menu Route=Ext, USB-A output, verified on device).
14. ~~**Bank reindex**~~ **done** — TRACK bank removed; config moved to Global Menu Track Config section. Banks: CLIP(0)·NOTE FX(1)·HARMZ(2)·MIDI DLY(3)·SEQ ARP(4)·TRACK ARP(5).
15. ~~**CC automation**~~ **done** — CC PARAM bank (6), per-clip recording/playback, step-edit, touch-record (overwrite while held), staircase hold, delete (all/per-knob), full-res SysEx palette LED brightness (rate-limited), ROUTE_EXTERNAL panic fix.
16. ~~**Bake**~~ **done (melodic + drum)** — melodic: offline pfx chain, confirm dialog, pfx params reset, step arrays rebuilt. Drum: CLIP mode (full chain, HARMZ routes hits across lanes by pitch) + LANE mode (vel/gate/timing only, no pitch/HARMZ); 3-button dialog with "No Pitch / HARMZ FX" notice.
17. ~~**Live Merge**~~ **done (melodic + drum)** — Shift+Sample arm/stop; page-quantized stop (STOPPING state); drum routes notes to lanes by midi_note pitch match; popups for no-slot and max-length.
18. ~~**JS module split**~~ **done** — `ui_constants.mjs`, `ui_state.mjs`, `ui_persistence.mjs`, `ui_dialogs.mjs`, `ui_scene.mjs`, `ui_leds.mjs` all extracted; `scripts/bundle_ui.py` concatenates into `dist/seq8/ui.js` for deployment. See memory `project_module_split.md`.
19. ~~**ROUTE_MOVE external MIDI monitoring**~~ **done** — rechannelized via `host_ext_midi_remap_*`; `applyExtMidiRemap()` driven from `tick()` change-detect + `init()`. Requires Schwung shim fix (cable-2 inject defer, commit 5275ec10).

## Per-set state

File: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`.

JS `init()` reads UUID, compares with `state_uuid` get_param. Mismatch → `state_load=UUID` next tick → `pendingDspSync=5` → `syncClipsFromDsp()`.

**Deferred save**: handlers set `inst->state_dirty = 1`; JS `pollDSP()` writes via `host_write_file` when dirty. Suspend path saves synchronously. Full details in `dsp/CLAUDE.md`.

**QuickJS compatibility** (shadow_ui runs QuickJS, not V8 — Node.js `--check` is NOT a reliable validator):
- **Member expressions as object keys are a syntax error**: `{ S.shiftHeld: val }` is rejected by QuickJS at compile time but silently accepted by Node. Always use plain identifiers: `{ shiftHeld: val }`. This caused a multi-hour debug session during the Phase 2 module split.
- **Confirmed supported**: `??` nullish coalescing, `...` spread/rest, `for...of`, `Array.from`, `globalThis`, `Set`, `Map`.

**Critical constraints**:
- **Coalescing**: only the LAST `set_param` per audio buffer reaches DSP. `shadow_send_midi_to_dsp` shares the same delivery channel and also coalesces with `set_param`. In `onMidiMessage`, if both a `set_param` and `shadow_send_midi_to_dsp` fire, the set_param is lost. Workaround: defer set_params to the tick function via a pending variable (see `pendingRepeatLane` pattern). Multi-field operations require a single atomic DSP command.
- **get_param from onMidiMessage**: `host_module_get_param` silently returns null when called from `onMidiMessage` context. Only works from tick/render callbacks. Sync functions called from pad handlers (e.g., `refreshDrumLaneBankParams` on lane switch) cannot rely on get_param. Workaround: sync JS state from DSP in the render/tick path instead.
- **No MIDI panic before state_load** — floods MIDI buffer, drops the load param.
- **Shift+Back does not reload JS** — `init()` re-runs in same runtime. Full reboot required for JS changes.
- **Suspend/resume** (`suspend_keeps_js`): Back=suspend (JS+DSP keep running in background), Shift+Step13=resume (double-tap or long-press for direct resume, single-tap for Tools menu). Shift+Back=full exit. State saved on suspend transition; LEDs re-initialized on resume. `installFlagsWrap` must be removed on suspend so `JUMP_TO_TOOLS` flag reaches shadow_ui for resume.
- **`reapplyPalette` resets CC LED hardware states**: `input_filter.mjs` `setButtonLED` has its own `buttonCache` — it skips `move_midi_internal_send` if the color hasn't changed. When `reapplyPalette` fires, the Move hardware resets all CC-based button LEDs (Play, Rec, etc.) to off, but the JS-side `buttonCache` still holds the old color, so subsequent `setButtonLED` calls are silently dropped. Fix: call `setButtonLED(cc, color, true)` (force=true) immediately after `reapplyPalette` for any button LEDs that must stay on.
- **Palette SysEx rate-limit**: rapid knob turns can trigger `setPaletteEntryRGB` + `reapplyPalette` every tick, filling `move_midi_internal_send` queue and delaying button LED CC updates. Rate-limit palette updates to `POLL_INTERVAL` cadence. Also use `ccPaletteCache` to skip SysEx when values haven't changed.

## Known limitations

- Transport stop saves will_relaunch; panic does not.
- Do not load SEQ8 from within SEQ8 — LED corruption (Shift+Back first).
- All 8 tracks route to the same Schwung chain.
- State file v=23 (only v=23 accepted) — wrong/missing version → deleted, clean start.
- `g_host->get_clock_status` is NULL; `get_bpm` doesn't track BPM changes while stopped.
- **ROUTE_MOVE + external MIDI monitoring**: rechannelized monitoring implemented — `applyExtMidiRemap()` rewrites incoming cable-2 channel to `trackChannel[t]` via `host_ext_midi_remap_*`. The shim crash (cable-2 inject race) is fixed in Schwung (commit 5275ec10).
- **TRACK ARP + ROUTE_SCHWUNG**: live notes injected via `shadow_send_midi_to_dsp` bypass `live_note_on`/`live_note_off` — TRACK ARP intercepts pad/external-MIDI notes on ROUTE_SCHWUNG tracks only via `live_notes` set_param (not the schwung chain path).
- `pfx_send` from set_param context does NOT release Move synth voices.
- **Swing**: CC automation lanes are not swung (intentional). Live-recorded notes with inp_quant=off will have swing applied twice (once on input, once on playback). Long notes (gate > 1 step) get a slightly shorter effective gate since note-off fires at the unswung position.
- See `docs/SCHWUNG_SEQ8_LIMITATIONS.md` for framework interaction patterns.

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99
**Encoders**: `MoveMainKnob=14` (CC) · `MoveMainButton=3` (CC, jog click) · `MoveMainTouch=9` (note)
**Step buttons**: notes 16–31, `0x90` (d2>0=press, d2=0=release).
**LED palette**: Fixed 128-entry. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32). **Dynamic palette**: entries can be overwritten at runtime via SysEx `F0 00 21 1D 01 01 03 [idx rL rH gL gH bL bH wL wH] F7` then reapplied with `F0 00 21 1D 01 01 05 F7`. Color components are 14-bit split into 7-bit pairs (low, high); 0-255 maps as `rL=r&0x7F, rH=r>>7`. Scratch indices 51-58 reserved for CC knob LEDs.

## MIDI routing

**JS**: `shadow_send_midi_to_dsp`→chain · `move_midi_internal_send`→LEDs · `move_midi_inject_to_move`→pads (68–99 only) · `move_midi_external_send`→USB-A (deferred) · `host_preview_play(path)`→WAV via speakers.
**DSP routing + deadlock constraint**: see `dsp/CLAUDE.md`.

## Build / deploy / debug

```sh
./scripts/build.sh && ./scripts/install.sh      # DSP change (also copies all JS)
python3 scripts/bundle_ui.py && ./scripts/install.sh  # JS-only
nm -D dist/seq8/dsp.so | grep GLIBC             # verify ≤ 2.35
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

**JS**: source modules (`ui.js`, `ui_constants.mjs`, `ui_state.mjs`, `ui_persistence.mjs`, `ui_dialogs.mjs`, `ui_scene.mjs`, `ui_leds.mjs`) — bundled into `dist/seq8/ui.js` by `scripts/bundle_ui.py`. Always run the bundler before deploying JS changes.
**DSP**: see `dsp/CLAUDE.md` for file structure, logging, and GLIBC constraint.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- **Session start**: read `graphify-out/GRAPH_REPORT.md` immediately after the docs update — required, not optional.
- **Before any grep or file search**: stop and ask whether this is a navigation, relationship, or call-chain question. If yes, use graphify first — only fall back to grep if graphify cannot answer it or you already know the exact location.
- **Code navigation**: `graphify query "<question>"` (BFS, broad context) · `graphify path "<A>" "<B>"` (shortest path) · `graphify explain "<concept>"` (node definition + connections). Use BEFORE reaching for grep or raw file reads.
- **Impact analysis**: `graphify query "<question>" --dfs` for dependency chains — use DFS when you need to know what a change cascades into (e.g. touching a god node like `set_param`).
- **Architecture questions**: always consult the graph first. God nodes (`set_param`, `drawUI`, `pfx_send`, `render_block`) are cross-community bridges — tracing them via graph beats manual grep.
- **Wiki**: if `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- **After code changes**: graph auto-updates via git post-commit hook. Run `graphify update .` manually only if you need the graph current mid-session before committing.
