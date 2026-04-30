# SEQ8

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

## Session workflow

- **Start of session**: run `~/schwung-docs/update.sh` and report the result. If unsure about a platform API, grep `~/schwung-docs/` rather than assuming.
- **Validate before acting** — read or grep actual code first. Never act on assumptions.
- **Commit after each logical change** — work directly on master, one commit per change.
- **Deploy and verify on device before reporting done** — always build+install and confirm on Move.
- **Reboot after every deploy** — Shift+Back does NOT reload JS from disk.
- **JS-only deploy**: `cp ui.js dist/seq8/ui.js && cp ui_constants.mjs dist/seq8/ && ./scripts/install.sh` then restart. `build.sh` required for DSP changes (also copies all JS).
- **Restart Move**: `ssh root@move.local "for name in MoveOriginal Move MoveLauncher MoveMessageDisplay shadow_ui schwung link-subscriber display-server schwung-manager; do pids=\$(pidof \$name 2>/dev/null || true); [ -n \"\$pids\" ] && kill -9 \$pids 2>/dev/null || true; done && /etc/init.d/move start >/dev/null 2>&1"`
- **CLAUDE.md**: update at session end or after a major phase — not after routine task work.
- **State version bump**: `find /data/UserData/schwung/set_state -name 'seq8-state.json' -exec rm {} \;` before deploying.
- **DSP calls / pfx code**: read `SEQ8_API.md` for parameter keys, structs, and algorithm details.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). `button_passthrough: [79]` — volume knob handled natively.

## What's Built

**Transport**: Play/Stop. Shift+Play=restart. Delete+Play: playing→`deactivate_all`; stopped→`panic`. **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one/callback; pollDSP restores stale state between calls. BPM owned by SEQ8; `set_param("bpm")` updates `tick_delta`+`cached_bpm`.

**Views**: Track View (16 steps, isomorphic pads). Session View (CC 50, 4×8 grid) — **any clip pad press sets `activeTrack`** (carries to Track View). Loop held→pages view; Loop+jog=±1 clip length; Shift+Loop=double-and-fill.

**Clip state model** (5 states): Empty·Inactive·Will-relaunch·Queued·Playing. Launch: playing→legato; stopped→Queued. Page-stop (`tN_stop_at_end`): next 16-step boundary. Quantized launch: `queued_clip>=0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant]==0` at tick_in_step=0. Transport stop→`will_relaunch=1`; play→fires immediately. Side buttons (CC 40–43, Track View): playing+active→stop-at-end; pending→cancel; will_relaunch→deactivate; queued===idx→deactivate; else→launch. Session side buttons always launch scene.

**Step entry**: Tap(<200ms)=toggle; hold=step edit. Empty step auto-assigns `lastPlayedNote`. Chord: held pads additive. Auto-assigned step+external MIDI→`_set_notes` replace; otherwise `_toggle` additive. CC 86: stopped→count-in→transport+record; playing→arm; again=disarm (`finalize_pending_notes`).

**Step edit** (melodic, held step): Oct·Pit·Dur·Vel·Ndg. Nudge crossing ±tps/2→adjacent step live; `_reassign` on hold-release. Hold+tap another step→span gate. K3 touch: LEDs show gate length overlay. **Drum**: Dur·Vel·Ndg. Nudge strictly `>tps/2` (not `>=`). Vel pad while step held→sends `_step_S_vel`.

**Copy** (CC 60 held): step→step; clip/lane/row; drum clip (32 lanes). `copySrc` kinds: `'clip'`·`'cut_clip'`·`'row'`·`'cut_row'`·`'step'`·`'drum_lane'`·`'cut_drum_lane'`·`'drum_clip'`·`'cut_drum_clip'`. **Cut** (Shift+Copy): source NOT cleared until paste via `tN_lL_cut_to`/`drum_clip_cut`/`clip_cut`/`row_cut`. Drum lane cut undo: snapshots full clip. Drum clip cut undo: snapshots dst only; src clear not undoable.

**Delete** (CC 119 held): step·clip·scene. Delete+jog=`tN_pfx_reset`; Shift+Delete+jog=full reset+SEQ ARP; Shift+Delete+clip=`tN_cC_hard_reset` (length=16,tps=24,all cleared). Delete+Play(playing)=`deactivate_all`; Delete+Play(stopped)=panic.

**Active bank**: Shift+top-row pad (92–98); same→TRACK(0). OLED priority: count-in→COMPRESS LIMIT→pop-ups(~500ms)→step edit→bank overview→header.

**CLIP bank**: Stretch(K1,lock), Clock Shift(K2), Nudge(K3,crosses ±tps/2), Resolution(K4,proportional; Shift+K4=zoom,blocked>256→"NOTES OUT OF RANGE"), Length(K5), Seq Follow(K8,JS-only,default ON,not persisted). NOTE FX K5 Quantize: `effective_tick_offset = raw*(100-q)/100`.

**Global menu** (Shift+CC 50): BPM·Tap Tempo·Key·Scale·Scale Aware·Launch·Swing Amt/Res·Input Vel·Inp Quant·MIDI In·Metro(Off/Count/On/Rec+Ply; Mute+Play shortcut)·Quit·Clear Sess (writes `{"v":0}`, wipes UI sidecar, triggers DSP fresh-init).

**External MIDI**: →`activeTrack`. **ROUTE_MOVE**: `liveSendNote` NOT called — injecting causes echo cascade→crash. External MIDI plays on Move track matching keyboard's MIDI channel, ignoring SEQ8's Ch knob. Pads unaffected (cable-0). Recording echo filter: `seqActiveNotes.has(d1)` guards ROUTE_MOVE `recordNoteOn`. Fix: `/schwung-ext-midi-remap` shim (spec in `SCHWUNG_SEQ8_LIMITATIONS.md §13`).

**Global MIDI Looper** (Session View): Loop+step arms. Steps 1–6=length(1/32..1bar; triplets with step 16 held). DSP: IDLE→ARMED→CAPTURING→LOOPING. Hook runs after SEQ ARP gate. Mid-loop rate: `looper_pending_rate_ticks` consumed at next boundary. JS: `looperStack {idx,ticks}`, `loopHeld`, `looperTriplet`, `dspLooperState`.

**Perf Mode** (Session View, loop running): double-tap Loop=lock; Loop+length pad=start. R0=length+Hold(73)+Latch(75); R1=8 pitch mods; R2=8 vel/gate mods; R3=8 wild mods (see `SEQ8_API.md` for full mod list). Step buttons=16 preset slots (1–8 factory). `perf_mods`=OR(toggled+held+recalled) sent on every change. Persistence: `perfModsToggled`/`perfLatchMode`/`perfRecalledSlot`/user snapshots(8–15) via UI sidecar v=2; re-sent via `pendingDefaultSetParams` on restore. DSP: `perf_apply()` in `pfx_send`; drum tracks bypass pitch mods.

**Play effects chain**: NOTE FX→HARMZ→MIDI DLY→SEQ ARP. Per-clip params (`clip_pfx_params_t`); clip switch→`pfx_sync_from_clip`. See `SEQ8_API.md` for SEQ ARP algorithm.

**Mute/Solo**: `effective_mute(t)=mute[t]||(any_solo&&!solo[t])`. **Mutually exclusive** — setting one clears the other (recall paths bypass). Snapshots: Shift+Mute+step=save; Mute+step=recall; stores `snap_drum_eff_mute[16][NUM_TRACKS]`. Per-lane: `drum_lane_mute`/`drum_lane_solo` bitmasks; Delete+Mute clears all. Persisted as `t%ddlm`/`t%ddls`.

**Scale**: 14 scales, `SCALE_IVLS[14][8]`. `scale_transpose(inst,note,deg_offset)` for scale-aware play effects.

**State persistence**: v=15. Format: `tick:pitch:vel:gate:sm;`. SEQ ARP keys: `_arst/_arrt/_aroc/_argt/_arsm/_artg`. Drum lane data sparse. v<15 rejected+deleted. `state_load` calls `drum_track_init` first.

**JS internals** (key gotchas):
- `pendingDrumResync` deferred 2 ticks after drum clip switch — `tN_lL_steps` reads active_clip implicitly; must wait for `tN_launch_clip` to process first. Melodic `tN_cC_steps` is clip-indexed, no defer needed.
- `pendingStepsReread` 2 ticks after `_reassign`/`_copy_to`.
- `pollDSP` overwrites `trackActiveClip[t]` when playing; change triggers `refreshPerClipBankParams(t)` + drum resync.
- `clipTPS[t][c]`: JS mirror of per-clip tps; synced via `t{n}_c{c}_tps` get_param.
- `bankParams[t][b][k]`: refreshed via `tN_cC_pfx_snapshot` on clip/track switch.
- `pendingDefaultSetParams`: first-run defaults (`scale_aware=1`, `metro_vol=100`, `input_vel=0`).
- UI sidecar (`seq8-ui-state.json`): restores `activeTrack`, `trackActiveClip[]`, `sessionView`; written Shift+Back; wiped on Clear Session.

## Upcoming tasks

1. **Drum step-to-step copy** — `copyStep()` uses melodic `tN_cC_step_S_copy_to`; needs drum lane branch `tN_lL_step_S_copy_to`.
2. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
3. **Step/note editing fixes** — see pending fixes in planning doc.
4. MIDI Delay Rnd refinement · 5. Full instance reset · 6. State snapshots (16 slots) · 7. **LIVE ARP** (per-track; first pfx stage, picks flow into NOTE FX→HARMZ→MIDI DLY→SEQ ARP) · 8. Swing · 9. MIDI clock sync
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): TRACK bank K3 dialog; design in SESSION_2026-04-28.md.

## Per-set state

File: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`.

JS `init()` reads UUID, compares with `state_uuid` get_param. Mismatch → `state_load=UUID` next tick → `pendingDspSync=5` → `syncClipsFromDsp()`.

**Critical constraints**:
- **Coalescing**: only the LAST `set_param` per JS tick reaches DSP. Multi-field operations require a single atomic DSP command.
- **No MIDI panic before state_load** — floods MIDI buffer, drops the load param.
- **Shift+Back does not reload JS** — `init()` re-runs in same runtime. Full reboot required for JS changes.

## Known limitations

- Transport stop saves will_relaunch; panic does not.
- Do not load SEQ8 from within SEQ8 — LED corruption (Shift+Back first).
- All 8 tracks route to the same Schwung chain.
- State file v=15 — wrong/missing version → deleted, clean start.
- `g_host->get_clock_status` is NULL; `get_bpm` doesn't track BPM changes while stopped.
- **ROUTE_MOVE + external MIDI**: no channel remapping (fix: `/schwung-ext-midi-remap` shim, spec in `SCHWUNG_SEQ8_LIMITATIONS.md §13`).
- `pfx_send` from set_param context does NOT release Move synth voices.
- See `SCHWUNG_SEQ8_LIMITATIONS.md` for framework interaction patterns.

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99
**Encoders**: `MoveMainKnob=14` (CC) · `MoveMainButton=3` (CC, jog click) · `MoveMainTouch=9` (note)
**Step buttons**: notes 16–31, `0x90` (d2>0=press, d2=0=release).
**LED palette**: Fixed 128-entry. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32).

## MIDI routing

**DSP**: `midi_send_internal`→chain. `midi_send_external`→USB-A — **never from render path** (deadlock).
**JS**: `shadow_send_midi_to_dsp`→chain · `move_midi_internal_send`→LEDs · `move_midi_inject_to_move`→pads (68–99 only) · `move_midi_external_send`→USB-A (deferred) · `host_preview_play(path)`→WAV via speakers.

## Build / deploy / debug

```sh
./scripts/build.sh && ./scripts/install.sh      # DSP change (also copies all JS)
cp ui.js dist/seq8/ui.js && cp ui_constants.mjs dist/seq8/ && ./scripts/install.sh  # JS-only
nm -D dist/seq8/dsp.so | grep GLIBC             # verify ≤ 2.35
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

**JS**: `ui.js` (~5500 lines) + `ui_constants.mjs` (206 lines). Both must deploy together.
**DSP**: `dsp/seq8.c` (~3624 lines) `#include`s `dsp/seq8_set_param.c` (~2892 lines). Single translation unit — no extern declarations.
Schwung core: v0.9.7. GLIBC ≤ 2.35. `~/schwung-notetwist` — NoteTwist reference. `SEQ8_SPEC_CC.md` — full design spec.
