# SEQ8 Feature Reference

Read the relevant section before working on a feature area. Use `offset`/`limit` with the Read tool to load only the section you need.

## Table of Contents

- [Transport](#transport)
- [Views](#views)
- [Clip state model](#clip-state-model)
- [Step entry](#step-entry)
- [Step edit](#step-edit)
- [Copy / Cut](#copy--cut)
- [Delete](#delete)
- [Bank system](#bank-system)
- [CLIP bank (0)](#clip-bank-0)
- [NOTE FX bank (1)](#note-fx-bank-1)
- [MIDI DLY bank (3)](#midi-dly-bank-3)
- [SEQ ARP bank (4)](#seq-arp-bank-4)
- [TRACK ARP bank (5)](#track-arp-bank-5)
- [CC PARAM bank (6)](#cc-param-bank-6)
- [ALL LANES bank (7, drum only)](#all-lanes-bank-7-drum-only)
- [Shift+step shortcuts](#shiftstep-shortcuts)
- [Track config (Global Menu)](#track-config-global-menu)
- [Global menu](#global-menu)
- [External MIDI](#external-midi)
- [Play effects chain](#play-effects-chain)
- [Note Repeat](#note-repeat)
- [Swing](#swing)
- [Mute / Solo](#mute--solo)
- [Bake](#bake)
- [Live Merge](#live-merge)
- [Suspend / Resume](#suspend--resume)
- [Set state inheritance & cleanup](#set-state-inheritance--cleanup)
- [Perf Mode](#perf-mode)
- [Global MIDI Looper](#global-midi-looper)
- [Hardware reference](#hardware-reference)
- [MIDI routing (JS)](#midi-routing-js)
- [Known limitations](#known-limitations)

---

## Transport

Play/Stop. Shift+Play=restart. Delete+Play: playing→`deactivate_all`; stopped→`panic`. **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one/callback; pollDSP restores stale state between calls. BPM owned by SEQ8; `set_param("bpm")` updates `tick_delta`+`cached_bpm`.

---

## Views

**Track View**: 16 steps, isomorphic pads.

**Session View** (CC 50, 4×8 grid): any clip pad press sets `activeTrack` (carries to Track View). Loop held→pages view (`loopJogActive=false`); Loop+jog=±1 clip length + switches to step view (`loopJogActive=true`, showing OOB steps at `DarkGrey` idx 124); `loopJogActive` cleared on every loop release.

**NoteSession (CC 50) view switch**: tap=permanent toggle; hold=momentary (switches immediately on press, returns on release).

Shift+Step15=double-and-fill (undoable on drum tracks; shows "LOOP DOUBLED" popup on all paths).

**Step button LED palette**: beat-marker steps use `TRACK_DIM_COLORS[t]`; OOB steps use `DarkGrey` (124); gate-span overlay uses raw index 56. No scratch palette entries 49/50 — `drainLedInit` only calls `reapplyPalette()` (needed for CC knob palette). **setPaletteEntryRGB limitation**: scratch indices 51-58 reserved for CC PARAM knob LEDs. Indices outside ~49-58 range use hardware defaults for note LEDs regardless of `setPaletteEntryRGB` writes.

**Contextual modifier button LEDs** (set in `tick()` Transport LEDs block, `ui.js`): Shift, Menu, Undo, Delete, Copy, Up, Down, Mute, Loop, Sample, Left, Right show an ambient "available" indicator — raw index 16 for most; `DarkGrey` (124) for Sample (index 16 = RoyalBlue on that button); Mute retains its existing 124/blink logic. Left/Right are OFF in Session View.

**Shift-flash**: while Shift held, buttons with Shift-modified functions blink 16/OFF (DarkGrey/OFF for Sample): Menu+Sample+Undo+Copy always; Loop in Session View only; Mute in Track View only. Step icon LEDs (CCs 16–31) use `LightGrey` instead of `White` while Shift held.

**Shift-flash knobs** (`ui_leds.mjs`): Bank 0 K4 (zoom); Bank 1 K3 melodic (Rnd algo); Bank 3 K8 melodic (Rnd algo); Bank 5 K1–8 drum (nudge); Bank 6 K1–8 (CC assign) — blink 16/OFF when Shift held in Track View.

---

## Clip state model

5 states: Empty·Inactive·Will-relaunch·Queued·Playing.

Launch: playing→legato; stopped→Queued. Page-stop (`tN_stop_at_end`): next 16-step boundary. Quantized launch: `queued_clip>=0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant]==0` at tick_in_step=0. Transport stop→`will_relaunch=1`; play→fires immediately.

Side buttons (CC 40–43, Track View): playing+active→stop-at-end; pending→cancel; will_relaunch→deactivate; queued===idx→deactivate; else→launch. Session side buttons always launch scene.

---

## Step entry

Tap(<200ms) on empty step=assign `lastPlayedNote` and activate; tap on active step=clear (notes deleted). Hold=step edit. Steps are binary — on with data, or off/empty; no inactive-with-data state.

**Step edit during count-in**: holding a step while record is counting in shows the step edit overlay (heldStep takes priority over count-in OLED).

**Capture+drum pad** (CC 52, all 32 pads): silently selects that drum lane for editing without playing a note. While Shift held on a drum track, bottom row (padIdx 0–7) shows `TRACK_COLORS` as a track-switch hint; upper pads go dark.

**Chord-first**: if pads are held before the step is pressed, all held notes are captured at press time (`pendingChordToStep`) and assigned via two-tick deferred write — see JS internals in CLAUDE.md. Chord: held pads additive. Auto-assigned step+external MIDI→`_set_notes` replace; otherwise `_toggle` additive.

**CC 86**: stopped→count-in→transport+record; playing→arm; again=disarm (`finalize_pending_notes`).

**Count-in pre-roll** (melodic + drum): any note pressed during count-in is captured on step 0. Deferred in `pendingPrerollNote = { track, clip/lane, pitch/laneNote, vel, pressedAtTick, countInStart }` — fires when `!liveActiveNotes.has(pitch) && elapsed >= tps` (waits for release + skips first loop pass). Gate sent next tick via `pendingPrerollGate` to avoid coalescing; computed as `holdDuration_js × (384 / countInDur_js)` — count-in is always 384 DSP ticks (4 beats), ratio is BPM- and tps-independent.

---

## Step edit

**Melodic (held step)**: Oct·Pit·Dur·Vel·Ndg. Nudge crossing ±tps/2→adjacent step live; `_reassign` on hold-release. Hold+tap another step→span gate. K3 touch: LEDs show gate length overlay.

**Drum**: Dur·Vel·Ndg. Nudge strictly `>tps/2` (not `>=`). Vel pad while step held→sends `_step_S_vel`.

**Dur knob step size** (melodic K3, drum K1): variable — 1 tick when gate ≤½ step, ¼ step when ≤2 steps, ½ step when ≤8 steps, 1 full step above that; scales with TPS.

---

## Copy / Cut

Copy (CC 60 held): step→step; clip/lane/row; drum clip (32 lanes). `copySrc` kinds: `'clip'`·`'cut_clip'`·`'row'`·`'cut_row'`·`'step'`·`'drum_lane'`·`'cut_drum_lane'`·`'drum_clip'`·`'cut_drum_clip'`.

**Cut** (Shift+Copy): source NOT cleared until paste via `tN_lL_cut_to`/`drum_clip_cut`/`clip_cut`/`row_cut`. Drum lane cut undo: snapshots full clip. Drum clip cut undo: snapshots dst only; src clear not undoable.

---

## Delete

CC 119 held: step·clip·scene. Delete+jog=`tN_pfx_reset`; Shift+Delete+jog=full reset+SEQ ARP; Shift+Delete+clip=`tN_cC_hard_reset` (length=16, tps=24, all cleared). Delete+Play(playing)=`deactivate_all`; Delete+Play(stopped)=panic.

---

## Bank system

Shift+top-row pad (92–97), 7 banks: CLIP(0)·NOTE FX(1)·HARMZ(2)·MIDI DLY(3)·SEQ ARP(4)·TRACK ARP(5)·CC PARAM(6). Jog cycles 0–6.

**Drum tracks: banks 2 (HARMZ) and 4 (SEQ ARP) are hidden** — jog skips them, Shift+pad 3/5 blocked, bank falls back to 0 on track/mode switch. Melodic tracks fall back bank 7→0 on track switch.

**Bank headings**: "DRUM LANE >>" for DRUM LANE overlay; ">> BANKNAME" for per-lane banks (NOTE/NOTEFX, HARMZ, MIDI DLY, RPT GROOVE, CC PARAM) on drum tracks; "ALL LANES" unchanged. Same prefix logic in track overview bar.

**OLED priority**: count-in→COMPRESS LIMIT→SESSION LOADING→pop-ups(~500ms)→step edit→bank overview→header.

**Header Fix/Adap indicator**: right-aligned on metro line (y=21) — "Fix" (x=109) when clip has content or length is manually set; "Adap" (x=103) when clip is empty and length not set. Uses `clipNonEmpty`/`drumClipNonEmpty` + `clipLengthManuallySet`/`drumLaneLengthManuallySet`.

**Conditional overlays**: DRUM LANE replaces CLIP(0) on drum tracks; NOTE/NOTEFX replaces NOTE FX(1) on drum tracks; RPT GROOVE replaces TRACK ARP(5) in repeat mode.

---

## CLIP bank (0)

Stretch(K1, lock), Clock Shift(K2), Nudge(K3, crosses ±tps/2), Resolution(K4, proportional; Shift+K4=zoom, blocked>256→"NOTES OUT OF RANGE"), Length(K5), Seq Follow(K8, JS-only, default ON, not persisted).

---

## NOTE FX bank (1)

Rnd(K3, 0=Off/1-24=±semitone range, scale-aware). Quantize(K6, melodic): `effective_tick_offset = raw*(100-q)/100`; applied during bake.

**Pitch random algorithms** (NOTE FX K3 and MIDI DLY K8): Shift+turn Rnd=cycle algorithm (Uniform/Gaussian/Walk); dialog shows while Shift held, commits on release. Walk: `note_random_walk` accumulator steps ±1 per note, clamps at ±range. State key `t%dc%d_nfra` / `t%dc%d_nfrm` (range/mode). Default algorithm: Walk (mode=2). `pfx_noteFx_reset` resets `note_random`, `note_random_mode` (Walk), and `note_random_walk` accumulator.

**Drum tracks (NOTE/NOTEFX overlay)**: K3=Qnt (maps to `drum_lanes_qnt`, same setting as ALL LANES K4); writes to `lane->pfx_params.quantize` (`drum_pfx_params_t`) — NOT `lane->clip.pfx_params` (`clip_pfx_params_t`); value mirrored in `S.drumLaneQnt[t]` to survive `readBankParams` null-return from MIDI handler context.

---

## MIDI DLY bank (3)

Rate(K1, 17 values: 1/64..1/1D including dotted, default 1/8D=idx 10), Lvl(K2), Rep(K3), Vfb(K4), Pfb(K5, ±24 semitones), Gate(K6, 0=Off/1-10=1/64..1bar fixed absolute gate in 96-PPQN ticks × 5 → samples), Clk(K7), Rnd(K8, 0=Off/1-24=±semitone range; algorithm shared with NOTE FX — see above). `pfx_delay_reset` resets `fb_note_random_mode`.

Gate sign in `reps[i].gate_factor`: negative=fixed (−ticks×TICKS_TO_480PPQN×sp), non-negative=relative (1.0=original). Bake uses GATE_FIXED_TICKS directly. Skip condition: `repeat_times<=0 || delay_level<=0` (time index 0 no longer skips — index 0 is now 1/64 not null).

---

## SEQ ARP bank (4)

"ARP OUT". Styl(K1, 0=Off), Rate(K2), Oct(K3), Gate(K4), Stps(K5), Rtrg(K6, default ON), Sync(K7, default ON).

Sync=ON: first step waits for next `arp_master_tick % rate == 0` boundary (global grid); Sync=OFF: fires at next boundary relative to anchor. Per-clip state key `t%dc%d_arsy` (sparse, default=ON i.e. emitted when 0). pfx_snapshot fields 17-23 = style/rate/oct/gate/stps/rtrg/sync; step_vel at 24-31.

---

## TRACK ARP bank (5)

"ARP IN". Styl(K1, 0=Off/1-9=style, drives tarp_on — no separate On knob), Rate(K2), Oct(K3), Gate(K4), Stps(K5), Rtrg(K6, default OFF), Sync(K7, default ON), Ltch(K8). tarp_on derived from tarp_style on load: `style!=0 → tarp_on=1`. State saves tarp_style only when `!=0`; tarp_retrigger saves when 1.

**Latch**: not persisted, resets to off on track switch and session view entry; transport/record start don't affect latch or held notes. **Latch shortcut** (Track View): Loop press while holding ≥1 pad with TARP active toggles `tarp_latch`; if latch ON, Loop turns it off regardless of pads; if latch OFF, Loop turns it on only if TARP style is set. Delete+Loop also unlatches. Mirrors to `bankParams[t][5][7]`.

**`tarp_silence`**: on latch=ON, only resets playback fields (sounding_pitch, gate_remaining, etc.) — preserves held buffer so TARP resumes on next transport start. On latch=OFF, calls `arp_clear_runtime` and clears `tarp_physical`.

TRACK ARP bypassed on drum tracks. `lastTarpStyle[8]` tracks last non-zero style per track for toggle (Shift+Step11).

---

## CC PARAM bank (6)

Per-track, per-clip CC automation on melodic tracks. 8 knob slots (K1-K8); Shift+K=assign CC number (turn jog).

`cc_send` set_param records point into `clip_cc_auto[clip]` snapped to nearest 1/32 when `recording`.

**Touch-record**: while recording, holding a knob (note 0-7 press) sets `cc_touch_held` bit, writes the current CC value (`cc_live_val[k]`) to the automation lane at every 1/32 boundary in the DSP render path, and suppresses automation playback for that knob indefinitely. `cc_touch` set_param format: "K 1 V" (touch-on with initial value) / "K 0 0" (touch-off).

**Step-edit**: hold step in bank 6 → OLED shows "CC S1-S16" with 4×2 knob grid; knobs write staircase hold via `cc_auto_set2` set_param ("C K T1 T2 V"), which atomically inserts two points at step start tick and `start + tps - 1`. No-note dialog suppressed in bank 6.

**Delete**: Delete+jog=clear all CC automation for active clip (`cc_auto_clear`); Delete+knob turn OR Delete+knob touch=per-knob clear (`cc_auto_clear_k`). Both reset `trackCCLiveVal` and `cc_auto_last_sent[k]=0xFF`.

**LED brightness**: scratch palette indices 51-58, updated at `POLL_INTERVAL` cadence via `ccPaletteCache` — only sends `setPaletteEntryRGB` SysEx when value changes. Armed=red, playback=green. After every `reapplyPalette`, force-resend `MovePlay` and `MoveRec` with `force=true` to bypass `input_filter.mjs` `buttonCache`. Static: VividYellow=has-automation, White=assigned-no-auto, Off=unassigned.

`send_panic` fix: ROUTE_EXTERNAL uses CC120+CC123 instead of 128 note-offs (ext_queue is only 64 slots).

---

## ALL LANES bank (7, drum only)

Stretch(K1, atomic — no-op with "NO ROOM" popup if any lane is blocked), Clock Shift(K2), Nudge(K3), Qnt(K4, `drum_lanes_qnt` 0-100 playback quantize), VelIn(K5 via `applyTrackConfig`), InQ(K6, `_diq` 0-8=Off..1/4T recording input quantize).

Melodic tracks fall back bank 7→0 on track switch (pad-press, applyTrackConfig, and Shift+jog paths).

---

## Shift+step shortcuts

Track View, no modifier held. Step icon LEDs (CCs 16–31) light while Shift held to indicate active shortcuts. Step13 reserved (framework resume).

| Step | Action |
|------|--------|
| 2 | BPM menu |
| 5 | Tap tempo |
| 6 | Metro toggle (Cnt-In→Play→Always→Off) |
| 7 | Swing menu |
| 8 | Drum: perform mode cycle / Melodic: chromatic layout toggle |
| 9 | Key menu |
| 10 | VelIn toggle (Live↔Fixed 127, both drum and melodic) |
| 11 | TARP on/off (melodic only) |
| 15 | Double-and-fill |
| 16 | Quantize 100% |

Metro labels: Cnt-In(count-in only)·Play(always on)·Always(rec+play).

**Chromatic pad layout** (melodic, Shift+Step8): root at bottom-left, col=+1 semitone, row=+8 semitones. `computePadNoteMap` switched via `S.chromaticLayout[t]`.

---

## Track config (Global Menu)

Ch·Route(0=Swng/1=Move/2=Ext)·Mode·VelIn·Looper. Per-track, stored in dedicated JS arrays (`trackChannel[]`, `trackRoute[]`, `trackPadMode[]`, `trackVelOverride[]`, `trackLooper[]`). `readTrackConfig(t)` syncs from DSP; `applyTrackConfig(t, key, val)` writes to DSP with side-effects.

**VelIn** (per-track, `t%d_tvo`): 0=Live (raw velocity, default), 1–127=absolute fixed. Applies to left-pad input (lane hits, melodic pads, ext MIDI, recording). Right-pad paths bypass VelIn (velocity zones, velocity-pad recording). Rpt1/Rpt2 repeat playback respects VelIn via DSP `effective_vel(tr, raw)`.

Implementation: VelIn applied in JS `liveSendNote` for live input (all routes); `rawVel=true` flag on velocity-pad calls bypasses it. Left-pad drum recording applies VelIn in JS before `drum_record_note_on` set_param.

**Drum live note-off**: taps (held <`DRUM_TAP_TICKS`=10 ticks/~30ms) send note-off deferred 1 tick via `pendingDrumNoteOffs` (prevents note-off/note-on collision on rapid hits); holds ≥30ms send note-off on physical release.

---

## Global menu

Shift+CC 50. **Track Config section** (Ch·Route·Mode·VelIn·Looper — per-`activeTrack`, live-updates on track switch; header shows "Track N") then `── Global ──` divider, then BPM·Tap Tempo·Key·Scale·Scale Aware·Launch·Swing Amt/Res·Inp Quant·MIDI In·Metro(Off/Cnt-In/Play/Always; Mute+Play shortcut)·Metro Vol(0–150%, default 80; DSP-side click via render_block, WAV normalized+resampled to 48kHz at build time)·Beat Marks(On/Off, persisted in UI sidecar)·Save (closes menu, shows "STATE SAVED" popup)·Quit·Clear Sess (writes `{"v":0}`, wipes UI sidecar, triggers DSP fresh-init).

Close: Shift+CC50 toggles; NoteSession (CC50 tap) closes menu/tap-tempo/confirm dialogs. Shift+jog passes through to normal track-switch while menu is open.

---

## External MIDI

Routes to `activeTrack`.

**ROUTE_SCHWUNG**: note events route through `pendingLiveNotes` → `live_note_on()` → full pfx chain (TARP, NOTE FX, HARMZ, MIDI DLY); non-note events (CC, AT, PB) pass through `shadow_send_midi_to_dsp` directly.

**ROUTE_MOVE**: `liveSendNote` NOT called — injecting causes echo cascade→crash (Move echoes cable-2 back to `onMidiMessageExternal` → infinite loop). Pads unaffected (cable-0). Recording echo filter: `seqActiveNotes.has(d1)` guards ROUTE_MOVE `recordNoteOn`. External MIDI rechannelized to active track's channel via `host_ext_midi_remap_*`. `applyExtMidiRemap()` called from `tick()` (change-detect) and from `init()`. `onMidiMessageExternal` filters by `trackChannel[t]` when `S.extMidiRemapActive` is set. Shim auto-resets remap on overtake exit.

**Suspend** (Back): JS calls `host_ext_midi_remap_enable(0)` to clear BLOCK so external MIDI reaches other instruments while SEQ8 is parked; **resume**: `applyExtMidiRemap()` re-applies.

**ROUTE_EXTERNAL** (Route=Ext): sequenced notes go DSP `pfx_send`→`ext_queue` ring buffer→JS tick() drains via `get_param('ext_queue')`→`move_midi_external_send` (USB-A). Live pad/MIDI input sent directly from JS via `move_midi_external_send`. VelIn override applies. See `docs/EXTERNAL_MIDI_USER_GUIDE.md`.

---

## Play effects chain

TRACK ARP→NOTE FX→HARMZ→MIDI DLY→SEQ ARP.

TRACK ARP intercepts live input (pads + external MIDI note events) only; sequenced notes enter at NOTE FX. ROUTE_SCHWUNG live input routes through full pfx chain. ROUTE_MOVE live external MIDI bypasses pfx chain (echo cascade constraint). Per-clip params (`clip_pfx_params_t`); clip switch→`pfx_sync_from_clip`. See `docs/SEQ8_API.md` for arp algorithm details.

---

## Note Repeat

Drum tracks only. Jog click or DRUM LANE K7 to cycle modes. Rpt1=single-lane hold-to-repeat; Rpt2=multi-lane simultaneous.

Right pads: bottom 2 rows=rate pads (1/32,1/16,1/8,1/4 straight+triplet; DarkGrey when idle, White when active/latched), top 2 rows=8-step gate mask.

**Gate cycle length** (`drum_repeat_gate_len[lane]`, 1-8, default 8, persisted as `t%dl%drgl`): Loop+gate pad N sets cycle length to N+1 and fills gate mask to steps 0..N via `_repeat_gate_and_len "mask len"` (atomic to avoid coalescing). DSP step counter wraps at `% gate_len`. Gate pads beyond cycle length shown DarkGrey.

**Latch**: Loop+rate pad latches Rpt1; Loop+lane latches Rpt2. Loop alone does NOT unlatch. Pressing the active rate pad or Delete+Loop unlatches.

**RPT GROOVE** (bank 5 overlay): K1-K8 = vel scale (0-200%, unshifted) or nudge (-50..+50%, Shift) per step; knob accumulator threshold=2 ticks (3 units/tick for vel scale, 1 unit/tick for nudge). OOB steps (beyond gate cycle length) not shown in OLED. Delete+jog=groove reset (resets gate mask to 0xFF, gate_len to 8, vel_scale to 100, nudge to 0). Aftertouch updates velocity live. State keys in `dsp/CLAUDE.md`. JS sync via render-path `syncDrumRepeatState` (get_param fails from onMidiMessage).

**Pitch random algorithms** default to Walk (mode=2) for both NOTE FX Rnd and MIDI DLY Rnd.

---

## Swing

Global Menu: Swing Amt 0–100, Swing Res 1/16 or 1/8. MPC2000-style groove — delays even-indexed steps (Amt 0=50%, 100=75% of pair length). Applied as the final stage of `pfx_send` via sample-queue deferral (`PFX_EV_BYPASS_SWING` flag in `pfx_q`), so bake/merge naturally bypass it. MIDI Delay echoes automatically land on their swung step positions. State keys: `_swa` / `_swr` (sparse, default 0).

CC automation not swung (intentional). Live-recorded notes with inp_quant=off will have swing applied twice (once on input, once on playback). Long notes (gate > 1 step) get a slightly shorter effective gate since note-off fires at the unswung position.

---

## Mute / Solo

`effective_mute(t)=mute[t]||(any_solo&&!solo[t])`. Mutually exclusive — setting one clears the other (recall paths bypass). Snapshots: Shift+Mute+step=save; Mute+step=recall; stores `snap_drum_eff_mute[16][NUM_TRACKS]`. Per-lane: `drum_lane_mute`/`drum_lane_solo` bitmasks; Delete+Mute clears all. Persisted as `t%ddlm`/`t%ddls`. **OLED indicators** (`drawTrackRow`): muted=blinking number; soloed=filled/inverted box with dark number; normal=white number with border when active.

---

## Bake

Sample button. Opens confirm dialog.

**Melodic**: loop count 1×/2×/4×/CANCEL on one row (default CANCEL); jog rotates, jog click advances to **WRAP TAILS?** dialog (YES/NO/CANCEL). Bake applies pfx chain offline (NOTE FX+HARMZ→MIDI DLY→SEQ ARP output) for each loop, writes results back, calls `clip_build_steps_from_notes` (critical — step arrays must be rebuilt or subsequent `_toggle`→`clip_migrate_to_notes` will wipe baked notes), clears pfx_params via `clip_init`, restores tps/length, calls `pfx_sync_from_clip`. Multi-loop: delay echoes bleed into subsequent loops (max_echo_tick = remaining loops × clip_ticks); `fx.note_random_walk` resets to 0 at top of each loop. Wrap: last loop uses UINT32_MAX as max_echo_tick; echoes with tick ≥ total_ticks are wrapped via `% total_ticks` before insert. Set_param format: `"T C M N L W"` (T=track, C=clip, M=mode 0/1/2, N=loops, L=lane for mode 1, W=1 wrap).

**Drum**: dialog step 1 — "Bake FX to clip (all lanes) or lane?" → CLIP/LANE/CANCEL; step 2 — loop count; step 3 — WRAP TAILS?

**CLIP mode** (`bm=2`, `bake_drum_clip`): full pfx chain per lane including HARMZ; output notes routed across lanes by `midi_note` pitch match; pool cap `DRUM_BAKE_POOL=2048`.

**LANE mode** (`bm=1`, `bake_drum_lane`): vel/gate/MIDI DLY/ARP on active lane only, no pitch/HARMZ.

Both drum modes reset `pfx_params` for baked lanes after bake and call `pfx_sync_from_clip` if baking active clip. Both use `undo_begin_drum_clip`; notes/steps restored on undo (pfx_params not yet snapshotted — pending fix, see TODO.md).

**Live drum input** routes through per-lane pfx chain (`drum_pfx_note_on`/`drum_lane_note_off_imm`). **Drum pfx isolation**: each lane's `drum_pfx_params_t` is independent per-clip; copied with clip/lane copy+cut operations; `pfx_sync_from_clip` syncs all 32 lane runtimes on clip switch.

Sample or NoteSession cancels any bake dialog.

---

## Live Merge

Shift+Sample, melodic + drum tracks. Captures live playback from the pfx chain into a new empty clip slot.

Shift+Sample=arm (LED Red); transport start→LED Green (CAPTURING). Sample=schedule stop at next 16-step page boundary (STOPPING state). DSP states: IDLE(0)→ARMED(1)→CAPTURING(2)→STOPPING(3)→IDLE(0).

**Melodic**: notes captured into `clips[dst]` via `pfx_send` hook; on finalize JS triggers `pendingStepsReread`.

**Drum**: notes routed to `drum_clips[dst].lanes[l].clip` by matching captured pitch to `lane->midi_note`; all 32 lanes init'd at arm; `clip_build_steps_from_notes` called per non-empty lane on finalize; JS triggers `syncDrumClipContent`.

Auto-finalize at 256 steps (max length). Popups: "NO EMPTY / CLIP SLOT" when arm fails (detected via `pendingMergeArm` flag + next-poll check); "MAX LENGTH / REACHED" when DSP jumps CAPTURING→IDLE directly (state 2→0).

---

## Suspend / Resume

Back=suspend (sequencer keeps playing in background); Shift+Step13=resume (double-tap/long-press=direct, single-tap=Tools menu); Shift+Back=full exit. State auto-saved on suspend. `saveState()` helper used by suspend, Quit, and Shift+Back paths.

**OLED**: `drawUI()` gated on `!isSuspended` — suppressed while suspended so MCU font calls don't corrupt native Move UI.

**Suspend save coalescing fix**: UI sidecar written immediately via `host_write_file`; `set_param('save')` deferred to end of `tick()` via `S.pendingSuspendSave` flag.

**Set change while suspended**: on resume edge (`!isSuspended && S._wasSuspended`), `active_set.txt` UUID compared against DSP `state_uuid`; mismatch triggers `S.pendingSetLoad`. After `pendingDspSync` resync completes, `restoreUiSidecar(true)` re-applies the new set's sidecar. **SESSION LOADING...** OLED overlay shown while `S.stateLoading` is true.

`installFlagsWrap` must be removed on suspend so `JUMP_TO_TOOLS` flag reaches shadow_ui for resume.

---

## Set state inheritance & cleanup

**Storage layout.** SEQ8 state lives entirely under `/data/UserData/schwung/`; never under Move's `UserLibrary/Sets/`. Two files per set at `set_state/<uuid>/seq8-state.json` (DSP) and `set_state/<uuid>/seq8-ui-state.json` (UI sidecar). A name-index file `seq8_name_index.json` (top-level under `schwung/`) maps `{ <set name>: <uuid> }` and is refreshed in `updateNameIndex()` after every deferred-save and suspend-save tail. **No writes happen inside Move's set folders** — duplication is detected via name suffix, not piggybacked on Move's file copy. This decoupling means Move firmware changes to the Sets-folder layout cannot break SEQ8 state inheritance.

**Duplicate detection (init / resume).** `maybeShowInheritPicker(uuid, name)` runs from `init()` and from the resume-edge path after a set switch. Trigger conditions: name has trailing ` Copy` or ` Copy N` (regex in `stripCopySuffix`), AND no canonical state file at the current UUID. Returns `'auto' | 'picker' | 'blank'`:
- `'auto'` — exactly one family candidate; silently copy its state files via `copyStateFiles`, force `S.pendingSetLoad = true` so DSP reloads (`create_instance` had already called `seq8_load_state` with the then-empty path).
- `'picker'` — two-plus candidates; `S.pendingInheritPicker = { dstUuid, dstName, candidates, selectedIndex }` opens the dialog. `pendingSetLoad` is **gated** on `!pendingInheritPicker` so `state_load` is deferred until the user resolves.
- `'blank'` — no candidates; fall through to normal flow.

**Family regex.** `^<escapedBase>(?:\s+Copy(?:\s+\d+)?)?$` — matches `<base>`, `<base> Copy`, `<base> Copy N`. Excludes the active duplicate itself. Candidates also filtered by `host_file_exists(/data/UserData/UserLibrary/Sets/<uuid>)` so deleted Move sets never appear. Sort: base name first, then by length, then alpha.

**Picker dialog.** `drawInheritPicker()` in `ui.js` (dispatched first in `drawUI()`, before `confirmBakeScene`). Two-stage header — `Copied Move set / detected` preamble + `Inherit dAVEBOx / state from?` title — above a scrollable 3-row list (`listTopY=39`, `lineH=9`). Items: each candidate's display name + a `Start blank` sentinel. Selected line inverts; `^` and `v` indicate off-screen items. Jog wheel rotates `selectedIndex` (mod total); jog click invokes `resolveInheritPicker(action)`. Sample button cancels = action `-1` (blank).

**Resolution always fires `pendingSetLoad`** — including for `Start blank`. The DSP `state_load` handler resets internal arrays (`clip_init`, `drum_track_init`, etc.) *before* attempting to read the file; with no file, the reset alone produces a clean slate. Without firing state_load, DSP would retain the previously-active set's data (this was the original "Start blank doesn't start blank" bug, fixed in `da7675e`).

**Orphan cleanup.** DSP handler `prune_orphan_states` (`seq8_set_param.c`) opens `/data/UserData/schwung/set_state/`, validates UUID-shaped dir names, and for each whose `/data/UserData/UserLibrary/Sets/<uuid>/` is missing, `unlink`s `seq8-state.json` + `seq8-ui-state.json` and tries `rmdir` (silently fails when Schwung-core files remain — those are not our concern). Triggered from JS via `S.pendingPruneOrphans = true` (set in `init()`) → fires once after `state_load` settles (`pendingDspSync === 0`). Log line: `SEQ8 prune: scanned=N removed=N`.

**Commits.** `fa44865` (root-only auto-inherit + name index + DSP prune handler) and `da7675e` (picker dialog + dead-Move-set filter + `Start blank` reset fix).

---

## Perf Mode

Session View (loop running). tap Loop=lock (`perfViewLocked`); hold Loop=temporary (pads active while held); Shift+Loop=toggle latch mode (`perfLatchMode`); Loop+length pad=start. 4 rows × 8 pads = 32 mods (see `docs/SEQ8_API.md`).

**Step buttons=16 preset/snapshot slots**: tap=recall; hold ~0.75s (`STEP_SAVE_HOLD_TICKS=150`)=save (perf preset when Loop held/locked, mute state when Mute held); Delete+step=clear; step LEDs double-blink on save (`stepSaveFlashStartTick`/`stepSaveFlashEndTick`). `perf_mods`=OR(toggled+held+recalled) sent on every change.

Persistence: `perfModsToggled`/`perfLatchMode`/`perfRecalledSlot`/user snapshots(8–15) via UI sidecar v=3; re-sent via `pendingDefaultSetParams` on restore. DSP: `perf_apply()` in `pfx_send`; drum tracks bypass pitch mods. DSP snapshot set_params: `snap_save N`, `snap_load N`, `snap_delete N`.

---

## Global MIDI Looper

Session View. Loop+step arms. Steps 1–6=length(1/32..1bar; triplets with step 16 held). DSP: IDLE→ARMED→CAPTURING→LOOPING. Hook runs after SEQ ARP gate. Mid-loop rate applied at next boundary.

---

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99

**Encoders**: `MoveMainKnob=14` (CC) · `MoveMainButton=3` (CC, jog click) · `MoveMainTouch=9` (note)

**Step buttons**: notes 16–31, `0x90` (d2>0=press, d2=0=release)

**Button CCs**: CC 40–43=side buttons (Track View) · CC 50=NoteSession/Session · CC 52=Capture · CC 60=Copy · CC 79=Volume (passthrough) · CC 86=Record · CC 119=Delete

**LED palette**: Fixed 128-entry. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32).

**Dynamic palette**: entries can be overwritten at runtime via SysEx `F0 00 21 1D 01 01 03 [idx rL rH gL gH bL bH wL wH] F7` then reapplied with `F0 00 21 1D 01 01 05 F7`. Color components are 14-bit split into 7-bit pairs (low, high); 0-255 maps as `rL=r&0x7F, rH=r>>7`. Scratch indices 51-58 reserved for CC knob LEDs.

---

## MIDI routing (JS)

- `shadow_send_midi_to_dsp` → Schwung chain
- `move_midi_internal_send` → LEDs
- `move_midi_inject_to_move` → pads (68–99 only)
- `move_midi_external_send` → USB-A (deferred)
- `host_preview_play(path)` → WAV via speakers

DSP routing + deadlock constraint: see `dsp/CLAUDE.md`.

---

## Known limitations

- Transport stop saves will_relaunch; panic does not.
- All 8 tracks route to the same Schwung chain.
- State file v=25 (only v=25 accepted) — wrong/missing version → deleted, clean start.
- **Swing**: CC automation lanes are not swung (intentional). Live-recorded notes with inp_quant=off will have swing applied twice. Long notes get slightly shorter effective gate.
- `pfx_send` from set_param context does NOT release Move synth voices.
- **Drum bake undo**: `undo_begin_drum_clip` snapshots notes/steps but not `pfx_params` — undo doesn't restore per-lane FX settings (pending fix).
- See `docs/SCHWUNG_SEQ8_LIMITATIONS.md` for framework interaction patterns.
