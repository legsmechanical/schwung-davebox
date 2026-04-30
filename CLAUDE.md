# SEQ8

**Working rule:** Before acting on any assumed or suggested cause/fix, read the relevant code and verify the assumption is correct first.

## Session workflow

- **Start of session**: run `~/schwung-docs/update.sh` and report the result.  If unsure about a specific platform API or behavior, grep `~/schwung-docs/` rather than assuming.
- **Validate before acting** — read or grep the actual code first. Never act on assumptions.
- **Commit after each logical change** — work directly on master, one commit per change.
- **Deploy and verify on device before reporting done** — always build+install and confirm on Move.
- **Reboot after every deploy** — Shift+Back does NOT reload JS from disk.
- **JS-only deploy**: `cp ui.js dist/seq8/ui.js && cp ui_constants.mjs dist/seq8/ && ./scripts/install.sh` then restart. `build.sh` required for DSP changes (also copies all JS).
- **Restart Move** (required after every deploy): `ssh root@move.local "for name in MoveOriginal Move MoveLauncher MoveMessageDisplay shadow_ui schwung link-subscriber display-server schwung-manager; do pids=\$(pidof \$name 2>/dev/null || true); [ -n \"\$pids\" ] && kill -9 \$pids 2>/dev/null || true; done && /etc/init.d/move start >/dev/null 2>&1"` — kills all Move/Schwung processes and lets init restart them.
- **CLAUDE.md**: update at session end or after a major phase — not after routine task work.
- **State version bump**: wipe all SEQ8 states on device before deploying (`find /data/UserData/schwung/set_state -name 'seq8-state.json' -exec rm {} \;`) so testing starts from clean state.

SEQ8 is a Schwung **tool module** (`component_type: "tool"`) for Ableton Move — standalone 8-track MIDI sequencer. No audio. C (DSP) + JavaScript (UI). Background running via tool reconnect. `button_passthrough: [79]` — volume knob (CC 79) handled natively by Move; SEQ8 does not intercept it.


## What's Built

**Transport**: Play/Stop. Shift+Play = restart (playing: atomic DSP `transport=restart` resets all positions to step 0 + replays; stopped: `play`). Delete+Play: playing → `deactivate_all`; stopped → `panic` (clears all will_relaunch + queued). **Do not use per-track `tN_deactivate` for bulk clearing** — DSP processes one per audio callback; pollDSP restores stale state between calls. BPM owned by SEQ8 after init; `set_param("bpm")` updates `tick_delta` + `cached_bpm`.

**Views**: Track View — 16 step buttons = active clip page; pads = isomorphic 4ths diatonic; Shift+bottom-row = track select; OOB steps = White; playback head = White. Loop (CC 58) held → pages view (both melodic and drum mode): pages with notes pulse (track color ↔ off at 12-tick rate), empty pages within clip = solid track color, out-of-clip = DarkGrey; **Loop held + jog = adjust active clip length ±1 step**; **Shift+Loop = double-and-fill** (doubles length, copies first half into second; "CLIP FULL" pop-up if already at max). Session View (CC 50) — 4×8 pad grid; jog/Up(54)/Down(55) scroll; Shift+step or side buttons (CC 40–43) = launch scene; **any clip pad press sets that track as `activeTrack`** (focus carries to Track View). **OLED track row**: `drawTrackRow(y)` draws track numbers 1–8; active track has a 1px underline at y+8 (brackets don't fit in 12px spacing). **Knob LEDs (CC 71-78)**: Session View = active-track indicator (White); Track View + bank 2/3/4/5 = dirty-param indicators (White when param ≠ default). **Clip buttons (CC 40–43, Track View)**: playing = flash dim↔bright (eighth note); will-relaunch (stopped) = slow pulse dim↔bright; focused inactive = solid bright; non-focused inactive-only = DarkGrey; with active notes = dim track color; empty = off.

**Clip state model** (5 states): Empty · Inactive · Will-relaunch · Queued · Playing.
- Launch: playing → legato; stopped → Queued.
- Page-stop (`tN_stop_at_end`): stops at next 16-step boundary; queued clip can launch simultaneously.
- Quantized launch: `queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0` at tick_in_step=0.
- Transport stop → `will_relaunch=1`; transport play → will_relaunch fires immediately.
- `tN_deactivate`: clears clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed.

**Clip deactivation** (side buttons CC 40–43, Track View): playing+active → stop-at-end; playing+pending_page_stop → cancel; will_relaunch → deactivate; queued===clipIdx → deactivate; else → launch. Session View side buttons always launch scene.

**Step entry / recording**: Tap (<200ms) = toggle. Hold = step edit. Active steps = track colour; inactive-with-notes = dark gray; empty = off. Pads toggle notes; Up/Down shifts octave. Empty step auto-assigns `lastPlayedNote` or `defaultStepNote()`. Chord: held pads assigned additively. External MIDI + pads interchangeable: held step + external note toggles pitch (auto-assigned step → `_set_notes` replace; otherwise `_toggle` additive). CC 86 stopped → count-in → transport+record; playing → arm immediately; CC 86 again = disarm (`finalize_pending_notes`).

**Step edit overlay** (held step, melodic): 5-column OLED: Oct · Pit · Dur · Vel · Ndg. K1 Oct (sens=12) · K2 Pitch scale-aware · K3 Dur ±6 ticks/detent · K4 Vel ±1 · K5 Nudge ±1 tick. Multi-note: lowest note + "+N". Nudge moves all notes as unit; crossing ±(tps/2) moves display to adjacent step live; `_reassign` commits on hold-release. Occupied dst merges (dst pitch wins; active src activates inactive dst). Delete+step clears to defaults. K3 (Dur) touch: step LEDs show gate length (White = full steps, DarkGrey = partial remainder); wraps at clip end. Active column inverted on touch or turn; labels large font, values `pixelPrintC` small font. **Hold step + tap another step** (no shift, step must have notes): sets gate to span the distance between them; step button LEDs from start through gate end lit dim track color as overlay.

**Drum step edit overlay** (held step, drum track): 3-column OLED: Dur · Vel · Ndg; top bar shows lane note name + MIDI number (e.g. `C3  36`). K1=Dur, K2=Vel, K3=Ndg (K4/K5 no-ops). K1 touch: step LEDs show gate overlay. Nudge crossing ±tps/2 moves to adjacent step live; `_reassign` commits on hold-release (strictly `> tps/2`, not `>=`). Hold empty step → shows `(empty)` until auto-assign threshold. **Vel pad tap while step held**: updates Vel display and sends `_step_S_vel` DSP call; value persists on re-hold. **Hold step + tap second step**: span gate gesture (same as melodic). Delete+step clears to defaults.

**Copy combos** (CC 60 held): Copy+step (Track View) = step-to-step copy within active clip — src blinks white, press dest to copy notes/vel/gate/tick offsets; release Copy to cancel · Copy+track button (Track View, melodic) or Copy+clip pad (Session View, melodic) = melodic clip-to-clip copy · Copy+track button (Track View, drum) = drum clip copy (all 32 lanes, active clip → dest clip, same track) · Copy+clip pad (Session View, drum→drum only) = drum clip copy cross-track · **Copy+lane pad (Track View, drum mode)** = lane-to-lane copy within active clip, same track only; src blinks white · Copy+scene row button (Session View) = row copy. Mixed kinds (melodic↔drum) swallowed. `copySrc` kinds: `'clip'` · `'cut_clip'` · `'row'` · `'cut_row'` · `'step'` · `'drum_lane'` · `'cut_drum_lane'` · `'drum_clip'` · `'cut_drum_clip'`.

**Cut combos** (Shift+Copy held, then press source): **Shift+Copy+clip button** (Track View, melodic) or **Shift+Copy+clip pad** (Session View, melodic) = cut source select (`kind: 'cut_clip'`) · **Shift+Copy+clip button** (Track View, drum) = drum clip cut source select (`kind: 'cut_drum_clip'`) · **Shift+Copy+clip pad** (Session View, drum) = same · **Shift+Copy+lane pad** (Track View, drum mode) = drum lane cut source select (`kind: 'cut_drum_lane'`) · **Shift+Copy+scene row** (Session View) = cut source select (`kind: 'cut_row'`). Source blinks white (same as copy). Source NOT cleared immediately — cleared only on paste. **Paste** = same gesture as copy paste: fires `tN_lL_cut_to` (lane) / `drum_clip_cut` (drum clip) / `clip_cut` / `row_cut` DSP command — atomically copies src→dst and clears src in one call. After drum lane/clip cut paste, `copySrc` converts to non-cut pointing at dest (sticky clipboard for multi-paste). "CUT" popup on source select; "PASTED" on paste. **Drum lane cut undo**: `undo_begin_drum_clip` snapshots entire active clip (src+dst in one clip); undo restores both. **Drum clip cut undo**: `undo_begin_drum_clip` snapshots dst only; src clear is not undoable. Cancel = press Copy again before pasting.

**Delete combos**: CC 119 held. Delete+step = clear step · Delete+track button = clear clip (Track View: keeps playing if clip was active via `_clear_keep`; Session View: deactivates) · Delete+clip pad (Session View) = clear clip + deactivate · Delete+Mute = clear all mute/solo · Delete+jog click (Track View) = `tN_pfx_reset` (NOTE FX + HARMZ + MIDI DLY) · **Shift+Delete+jog click** (Track View) = full reset: NOTE FX + HARMZ + MIDI DLY + SEQ ARP · **Shift+Delete+clip button** (Track View) = hard reset via `tN_cC_hard_reset`: undo snapshot, silence, `clip_init` (length=16, tps=24, all cleared); clip stays in transport; "CLIP CLEARED" pop-up · **Shift+Delete+clip pad** (Session View) = same hard reset for that one clip · **Shift+Delete+scene button** (Session View) = hard reset all 8 clips in that row; "CLIPS CLEARED" pop-up · Delete+Play (playing) = `deactivate_all`; Delete+Play (stopped) = panic + clear will_relaunch.

**Active bank**: Single global `activeBank`. Shift + top-row pad (92–98); same bank → TRACK (0). OLED display priority: count-in → COMPRESS LIMIT → action pop-ups (~500ms; defers to step edit / bank overview while knob touched) → no-note flash → undo/redo flash → step edit → bank overview (knob touched or bank-select timeout; K1–K8 abbrevs+values; touched column inverted) → header (+` REC`). **Knob highlight**: `knobTouched` on capacitive touch (note 0-7) and CC turn (71-78); touch-release clears immediately; turn-only clears after ~600ms via `knobTurnedTick[]`.

**Action pop-ups** (~500ms OLED): COPIED (copy clip/row src selected) · CUT (cut clip/row src selected) · PASTED (copy or cut dst confirmed) · SEQUENCE CLEARED (Delete+clip) · SEQUENCES CLEARED (Delete+scene row) · BANK RESET (Delete+jog click) · CLIP PARAMS RESET (Shift+Delete+jog click) · CLIP CLEARED (Shift+Delete+clip, any view) · CLIPS CLEARED (Shift+Delete+scene row) · CLIP FULL (Shift+Loop when clip already at 256 steps) · NOTES OUT / OF RANGE (Shift+K4 zoom would exceed 256 steps) · SESSION CLEARED (Clear Sess confirmed). Step copy/clear: no pop-up.

**CLIP bank**: Beat Stretch (K1, sens=16, lock): CW doubles, CCW halves; compress blocked on collision → "COMPRESS LIMIT"; per-touch display label. Clock Shift (K2, sens=8): rotates steps; per-touch signed delta display. Clip Nudge (K3, sens=8): shifts all note_tick_offsets ±1; crosses ±(tps/2) to adjacent step; cumulative display. Clip Resolution (K4, sens=16): normal = proportional rescale (notes+gates scaled, blocked while recording); **Shift+K4 = zoom mode** (absolute note positions fixed, step grid shifts, length adjusts to keep total duration; blocked if new step count > 256 → "NOTES OUT OF RANGE" pop-up). Clip Length (K5, sens=4): steps 1–256. **Seq Follow** (K8, JS-only): per-clip toggle (default ON). When ON, step display auto-pages to follow playhead while playing. When OFF, view stays on user-navigated page. Resets to ON on reboot (not persisted). **Quantize** (NOTE FX K5): render-time `effective_tick_offset = raw * (100-q) / 100`.

**Global menu** (Shift + CC 50): jog navigate, jog click edit, Back exit. Items: BPM (40–250) · **Tap Tempo** (sub-screen: all 32 pads dim white, any tap flashes all pads Blue ~100ms; sliding-window avg of last 8 intervals + deviation reset on >1.8× ratio change + 2s inactivity reset; jog ±1 BPM without resetting tap session; jog-click or Back applies BPM and exits; clamps 40–250) · Key · Scale · Scale Aware · Launch (Now/1/16/1/8/1/4/1/2/1-bar) · Swing Amt · Swing Res · Input Vel (0=Live, 1–127=fixed) · Inp Quant (ON=snap recording) · MIDI In (All/1–16, channel filter for external USB-A MIDI) · **Metro** (Off/Count/On/Rec+Ply; `createEnum`; Mute+Play hardware shortcut) · Quit (saves state + calls `host_exit_module`) · **Clear Sess** (confirmation dialog: jog toggles No↔Yes, jog click confirms, Back cancels; writes `{"v":0}` to DSP state file + wipes UI sidecar + triggers DSP fresh-init; shows "SESSION CLEARED" pop-up).

**External MIDI routing**: `onMidiMessageExternal` → `activeTrack` (always last Track View focus). Channel filter from MIDI In (0=All). Note-on: `effectiveVelocity`; updates `lastPlayedNote`/`lastPadVelocity`; if armed → `recordNoteOn`. Note-off: via `extHeldNotes` map. Track switch: `extNoteOffAll` before changing track. Step integration: same as pads (replace vs additive based on auto-assign state). **ROUTE_MOVE caveat**: `liveSendNote` is NOT called for ROUTE_MOVE tracks in `onMidiMessageExternal` (any msg type). Move handles cable-2 natively in overtake mode; injecting causes echo cascade → crash (see SCHWUNG_SEQ8_LIMITATIONS.md §12). Consequence: external MIDI on ROUTE_MOVE plays on the Move track matching the keyboard's own MIDI channel, not SEQ8's Ch knob. Pads still inject correctly (cable-0, not affected). **Recording echo filter**: `seqActiveNotes.has(d1)` guards `recordNoteOn` in `onMidiMessageExternal` for ROUTE_MOVE — prevents sequencer playback echoes from being re-recorded at loop end (would accumulate and freeze). **Shim fix available**: the Schwung shim could expose `/schwung-ext-midi-remap` (16-byte channel remap table) to let modules remap cable-2 MIDI_IN channel before Move processes it — full spec in SCHWUNG_SEQ8_LIMITATIONS.md §13. Once implemented, re-enable `liveSendNote` for ROUTE_MOVE is not even needed (remap alone is sufficient); SEQ8 just writes `remap[0] = activeTrack_channel` on track/Ch changes.

**Global MIDI Looper** (Session View only): Loop+step gesture in Session View arms a global captures-all-tracks looper. Steps 1–6 set the capture length (1/32, 1/16, 1/8, 1/4, 1/2, 1bar; triplet variants for 1–5 when step 16 is toggled). DSP state machine: IDLE → ARMED (waits for next master-tick boundary aligned to capture length, derived from free-running `arp_master_tick`) → CAPTURING (mirrors every note-on/off out of `pfx_send` from `looper_on` tracks into `looper_events[]` with `tick = looper_pos`) → LOOPING (tracks with `looper_on=1` are silenced via `pfx_send` early-return; captured events are re-emitted via `pfx_send` with `looper_emitting=1` to bypass the suppress). Release Loop or all held step buttons → `looper_stop` set_param drops back to IDLE, sends note-offs for any sounding looper-emitted notes (tracked via `looper_active_notes[NUM_TRACKS][16]` bitmap), discards events. Per-track include/exclude via TRACK bank K8 (`tN_track_looper`, default 1, persisted as `t%d_lp` only when 0). The looper hook in `pfx_send` runs after the SEQ ARP gate so the captured stream is the post-arp output. Step button LED preview while Loop is held in Session View: each of buttons 1–6 pulses White↔PurpleBlue at its own capture rate using `flashAtRate(masterPos, rateTicks)` driven by `arp_master_tick` polled into JS via state_snapshot. **Mid-loop rate switch**: pressing a different length button while LOOPING sets `looper_pending_rate_ticks` instead of restarting; `looper_tick` consumes it at the next loop boundary by silencing active notes and transitioning back to ARMED with the new rate. Pressing in IDLE/ARMED/CAPTURING re-arms immediately (drops in-flight state). Releasing the most recent step pops back to the prior held step's rate (also queued); releasing all stops. JS tracks held steps as `looperStack` of `{idx, ticks}` (rate captured at press time so toggling triplet mid-hold doesn't affect already-held steps). Other JS state: `loopHeld`, `looperTriplet`, `dspLooperState` (mirror of DSP `looper_state` for diagnostics).

**Performance Effect Mode** (Session View only, requires loop running): double-tap Loop to lock Perf Mode, or hold Loop + press a length pad to start. Pad grid switches to mod layout — R0 (68–75): length pads 1–5 (1/32..1/2) + Hold pad (73) + Latch (75); R1 (76–83): 8 pitch mods; R2 (84–91): 8 vel/gate mods; R3 (92–99): 8 wild mods. **24 mods** — **R1 pitch**: Oct↑ (0, alternates ±12st per cycle), Oct↓ (1), Sc↑ (2, ascending scale degrees over 4 cycles), Sc↓ (3), 5th (4, ascending 5th/10th/15th), Tritone (5), Drift (6, ±1 scale deg/cycle accumulates), Storm (7, random ±6 scale deg per event). **R2 vel/gate**: Decrsc (8, vel×(1−0.15×cycle)), Swell (9, 16-cycle triangle), Cresc (10, vel×(1+0.15×cycle)), Pulse (11, even cycles full/odd quiet), Sidechain (12, each note 15% quieter), Staccato (13, gate=cap/8), Legato (14, gate=cap−1), Ramp Gate (15, gate ramps across notes). **R3 wild**: ½time (16, suppress odd cycles), 3Skip (17, suppress every 3rd cycle), Phantom (18, ghost note −12st), Sparse (19, ~50% suppress), Glitch (20, ±2 scale deg random), Stagger (21, note N+N scale deg), Shuffle (22, randomise pitch order per cycle), Backwards (23, reverse pitch order). Pads momentary by default; hold = active (magenta/yellow/cyan per row). **Hold pad** (note 73): enters persistent hold mode while held — length-pad releases don't pop; tap to cancel sticky. **Latch** (note 75): tap → toggle mode; tap same selected pad toggles off; long-press clears all. **Step buttons = 16 preset snapshot slots**: slots 1–8 pre-loaded with factory presets (Float·Sink·Heartbt·F.Dust·Robot·Dissolve·Chaos·Lift); tap → recall, tap same → clear; Shift+tap → save. Recalled + held + toggled mods compose by OR. **Persistence**: `perfModsToggled`, `perfLatchMode`, `perfRecalledSlot`, user snapshots (slots 8–15) persist across view switches and reboots via UI sidecar v=2; `perf_mods` re-sent to DSP via `pendingDefaultSetParams` on restore. **Lock**: double-tap Loop → `perfViewLocked=true`; Loop LED blinks White at 1/8 rate; loops + mods persist after Loop release; single-tap Loop while locked → unlock + stop loop. Track View switch stops loop but preserves mod state. **DSP**: `perf_apply()` runs in `pfx_send` for every looper-emitted event; note-offs always look up `perf_emitted_pitch[tr][raw]`; `looper_cycle` increments each loop wrap (drives cycle-based pitch animation); drum tracks bypass all pitch mods. Staccato/Legato/RampGate use `perf_staccato_notes[16]` queue. OLED: "PERF" header + brief full-name popup (~500ms) on mod press, then abbreviated active-mod list (3 per line, +N if >6); rate indicator bottom-left. JS state: `perfModsToggled | perfModsHeld | perfRecalledMods` → `perf_mods` on every change.

**Play effects**: NOTE FX → HARMZ → MIDI DLY → SEQ ARP. Per-clip: each clip carries its own NOTE FX/HARMZ/MIDI DLY/SEQ ARP params (`clip_pfx_params_t`); switching clips loads that clip's params via `pfx_sync_from_clip`. `tN_pfx_reset` resets active clip's params atomically (including SEQ ARP). Scale-aware: noteFX_offset/harm_intervals/delay_pitch via `scale_transpose()` at render time; drum tracks bypass.

**SEQ ARP** (per-clip, last stage of pfx chain): captures every note-on/off emission from upstream stages (immediate output of NOTE FX → HARMZ + queued delay echoes) into the engine's held buffer (`arp_engine_t` in `play_fx_t`) and re-emits picks raw at its own rate. The intercept lives in `pfx_send`: when `arp.style != 0 && !arp_emitting`, status `0x90`/`0x80` route to `arp_add_note`/`arp_remove_note` instead of MIDI out (CC and other messages pass through). All input sources (sequencer, live pad, external MIDI) flow into the same chain — there is no source-aware bypass. The arp emits its picked pitch via `pfx_send` with `arp_emitting=1` so the pick goes raw to MIDI out, no further processing. `arp_tick` runs once per master 96-PPQN tick from `render_block` (and every tick on the free-running stopped-clock when transport is off). **Styles** (0–9): 0=Off (bypass) · 1=Up · 2=Down · 3=Up/Down · 4=Down/Up · 5=Converge · 6=Diverge · 7=Play Order · 8=Random · 9=Random Other. Off bypasses the arp entirely and clears any sounding emission via `arp_silence`. **Octaves** (-4..-1, +1..+4; 0 skipped): positive = ascend by 12 semitones per octave; negative = descend. **Retrigger** (default On): when on, the cycle position + step pattern column reset to 0 every time a new note enters the buffer (deferred via `pending_retrigger` + drained in `arp_tick` so it can read `arp_master_tick`) and at the start of each active-clip loop wrap (set inline at `ns2 == 0` in `render_block`). When off, `master_anchor` stays at 0 and the pattern free-runs anchored to the master clock. **First-note clock sync**: empty→non-empty buffer sets `pending_first_note=1`; first emission waits until `((arp_master_tick − master_anchor) % rate) == 0`. **Steps** (0=Off/1=Mute/2=Step): per-step level array (8 entries, levels 0..4; 0=step off, 1=row 0/vel 10, 4=row 3/incoming vel; intermediate levels lerp). Mute = rest at level-0 step but advance cycle; Step = skip (no fire, no cycle advance). Step pattern column = `((arp_master_tick − master_anchor) / rate) & 7`. **Gate** = `rate * gate_pct / 100`, clamped to `[1, rate-1]` so note-off fires before next note-on. `arp_silence(inst, tr)` drops held + silences sounding via raw `pfx_send`; called from `silence_track_notes_v2`, `seq_arp_style` Off-transition, `pfx_seq_arp_reset`, and `pfx_reset`.

**Mute/Solo**: `effective_mute(t)` = `mute[t] || (any_solo && !solo[t])`; gates render note-on. Mute LED (Track View, focused): blink=muted, solid=soloed. OLED track row: muted = filled box (all tracks); active+soloed = filled box blinks; inactive+soloed = number blinks. **Mute and solo are mutually exclusive**: `setTrackMute(t, true)` clears solo; `setTrackSolo(t, true)` clears mute. Same for lanes (see below). Recall paths set fields directly and bypass this logic — recalled states apply as-is. Snapshots (Session View, Mute held): 16 step buttons; Shift+Mute+step = save; Mute+step = recall. Track snapshots also store per-track drum effective-mute bitmask (`snap_drum_eff_mute[16][NUM_TRACKS]`); soloed lanes are treated as unmuted (effective = mute | (~solo & anysoloMask)); on recall: sets `drum_lane_mute` from bitmask, clears `drum_lane_solo`. Persisted as `sn{n}de{t}` in JSON (sparse, omit if 0). **Per-lane drum mute/solo** (drum track view): Mute+lane-pad toggles lane mute (`drum_lane_mute` bitmask); Shift+Mute+lane-pad toggles lane solo (`drum_lane_solo` bitmask); mutually exclusive (soloing a muted lane clears its mute bit and vice versa); Delete+Mute clears all. `effective_drum_mute(tr, l)` = muted-bit OR (any_solo AND !solo-bit). OLED drum idle: row 1 = bank name; row 2 = bank group + pad note; row 3 = "MUTED" (blinking) or "SOLOED" (inverted) for the **active lane only**. Both bitmasks persisted as `t%ddlm`/`t%ddls` in state.

**Scale**: 14 scales, `SCALE_IVLS[14][8]`. `computePadNoteMap` uses `intervals.length`. Scale-aware play effects: `scale_transpose(inst, note, deg_offset)` anchors to note's degree then shifts.

**State persistence**: v=15. Saved at Shift+Back and `destroy_instance`. Note format: `tick:pitch:vel:gate:sm;`. Per-clip stretch_exp/clock_shift_pos/ticks_per_step if nonzero/non-default. Per-clip pfx params sparse (`t%dc%d_nfo` etc.) if non-default. SEQ ARP keys: `_arst` (style), `_arrt` (rate), `_aroc` (signed octaves), `_argt` (gate%), `_arsm` (steps mode), `_artg` (retrigger; default 1, written if 0). `step_muted=1` preserves inactive-step notes through reload. Drum lane data sparse (`t{t}c{c}l{l}_mn/len/tps/n` keys) — only lanes with active notes written; only drum-mode tracks included. v=14 and earlier are rejected and deleted. `state_load` handler calls `drum_track_init` before loading to prevent stale drum data from prior session.

**JS internals**: `effectiveClip(t)` → queued if stopped+queued else active. `pendingDspSync` (5-tick countdown after state_load). `pendingStepsReread` (2-tick countdown after `_reassign`/`_copy_to`; re-reads `_steps` bulk). `pendingDrumResync` / `pendingDrumResyncTrack` (2-tick countdown after drum clip switch while stopped; deferred because `tN_lL_steps` reads active_clip implicitly — must wait for `tN_launch_clip` to be processed before reading; melodic `tN_cC_steps` is clip-indexed so needs no defer). `pendingDrumLaneResync` / `pendingDrumLaneResyncTrack` / `pendingDrumLaneResyncLane` (lightweight variant: re-reads active lane steps only, 3 IPC calls; used by drum SEQ K2/K3 per detent). `SCALE_DISPLAY` (14-entry array in `ui_constants.mjs`): full scale names for OLED display, abbreviated only for Harmonic Minor→"H Minor", Melodic Minor→"M Minor", Pentatonic Major→"Pent Major", Pentatonic Minor→"Pent Minor". `stepWasHeld` set at hold threshold, cleared on release/press/cancel — `stepBtnPressedTick` is -1 for both paths at release time so can't be used. `seqNoteOnClipTick`/`seqNoteGateTicks`: clip-tick gate expiry for pad highlight; `seqActiveNotes` cleared when elapsed ≥ gate (wrap-safe). `pollDSP` unconditionally overwrites `trackActiveClip[t]` when playing; `lastDspActiveClip[t]` tracks last DSP-reported value — change triggers `refreshPerClipBankParams(t)` + drum resync (immediate when playing, deferred when stopped). `clipTPS[t][c]`: JS mirror of per-clip ticks_per_step; used for Dur display, gate LED viz, K3 gate max, K5 nudge range, clip-tick computation. Synced at state load via `t{n}_c{c}_tps` get_param. `bankParams[t][b][k]`: JS mirror of bank knob values; per-clip banks (1=CLIP K3/K4/K7, 2=NOTE FX, 3=HARMZ, 5=MIDI DLY) refreshed on clip/track switch via `refreshPerClipBankParams(t)` using `tN_cC_pfx_snapshot`. `clipSeqFollow[t][c]`: JS-only per-clip flag (default true); K8 in CLIP/DRUM SEQ bank reads/writes it; synced at `refreshPerClipBankParams` and at all `activeTrack` switch sites. `drumSeqQnt[t]`: JS-only per-track last-set K6 Qnt value (0–100); display-only, does not mirror per-lane pfx state; mirrors to `bankParams[t][2][4]` on set so NOTE FX K5 display stays consistent. **16-level vel pads**: which pad you press determines the zone; `drumVelZoneToVelocity(velZone)` = zone-fixed velocity used for all output (live preview, step-edit, recording); `drumLastVelZone[t]` = pressed pad's zone for LED display. `LightGrey` (palette 118, #595959) used for active-but-empty clip slots in Session View. Loop pages view blink uses `flashSixteenth` (music-synced) when playing, `Math.floor(tickCount/24)%2` when stopped. OLED `drawPositionBar(t)`: segmented bar at y=57–61 — solid=view page, outline=playhead page, bottom-edge=others; 1px playhead dot mapped 0–127px, inverted on solid block; always shown in normal Track View. `pendingDefaultSetParams` ([{key,val}]): drained one per tick when `pendingDspSync==0` and `!pendingSetLoad`; populated on first load when no UI sidecar exists (sends `scale_aware=1`, `metro_vol=100`, `input_vel=0`). `uiDefaultsApplyAfterSync`: re-applies first-run defaults after a `state_load` re-sync completes. UI sidecar (`uuidToUiStatePath`): `init()` reads `seq8-ui-state.json` to restore `activeTrack`, `trackActiveClip[]`, `sessionView`; Shift+Back writes it; Clear Session wipes it.



## Upcoming tasks

1. **Drum mode — remaining code**: Copy+step drum lane branch (`tN_lL_step_S_copy_to`) — step-to-step copy within a drum lane; `copyStep()` currently uses melodic `tN_cC_step_S_copy_to`. *(Done 2026-04-29)*: Drum lane/clip copy/cut/paste; undo/redo drum step resync; UI sidecar `activeDrumLane[]`
2. **Scale-aware key/scale changes** — global option: changing Key/Scale transposes all clip notes to fit new scale. Design TBD.
3. **Step/note editing fixes** — see pending fixes in planning doc.
4. MIDI Delay Rnd refinement · 5. Full instance reset · 6. State snapshots (16 slots) · 7. **LIVE ARP** (per-track; first stage of pfx chain — its picks then flow through NOTE FX → HARMZ → MIDI DLY → SEQ ARP) · 8. Swing (wire stub) · 9. MIDI clock sync
10. **Drum mode — track conversion** (`tN_convert_to_drum` / `tN_convert_to_melodic`): TRACK bank K3 confirmation dialog; design notes in SESSION_2026-04-28.md.

## Per-set state

File: `/data/UserData/schwung/set_state/<UUID>/seq8-state.json`.

JS `init()` reads UUID, compares with `state_uuid` get_param. Mismatch → `state_load=UUID` as sole set_param next tick → `pendingDspSync=5` → `syncClipsFromDsp()`.

**Critical constraints**:
- **Coalescing**: only the LAST `set_param` per JS tick reaches DSP. Multi-field operations require a single atomic DSP command.
- **No MIDI panic before state_load** — floods MIDI buffer, drops the load param.
- **Shift+Back does not reload JS** — `init()` re-runs in same runtime. Full reboot required for JS changes.

## Parameter Bank Reference

Banks via **Shift + top-row pad** (92–99). Same bank again → TRACK (0).

| Bank | Pad | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 |
|------|-----|----|----|----|----|----|----|----|----|
| 0 TRACK | 92 | Ch (stub) | Rte | Mode | — | — | — | — | Lpr (looper include/exclude) |
| 1 CLIP (melodic) | 93 | Stch (sens=16, lock) | Shft (sens=8) | Ndg (sens=8) | Res (sens=16) | Len (sens=4) | — | — | SqFl |
| 1 DRUM SEQ (drum) | 93 | Stch (sens=16, lock) | Shft (sens=8) | Ndg (sens=8) | Res (sens=16) | Len (sens=4) | Qnt (0–100, all lanes) | LnN (lane note) | SqFl |
| 2 NOTE FX | 94 | Oct (sens=6) | Ofs (sens=4) | Gate (sens=2) | Vel | Qnt (0–100) | — | — | — |
| 3 HARMZ | 95 | Unis (sens=4) | Oct (sens=4) | Hrm1 (sens=4) | Hrm2 (sens=4) | — | — | — | — |
| 4 MIDI DLY | 96 | Dly | Lvl | Rep (max=16) | Vfb | Pfb | Gfb | Clk | Rnd |
| 5 SEQ ARP | 97 | Styl (0=Off..9=RnO) | Rate | Oct (-4..+4 skip 0) | Gate | Stps | Rtrg | — | — |
| 6 LIVE ARP | 98 | On | Type | Sort | Hold | OctR | Spd | — | — |

All stubs JS-only. Beat Stretch lock = fires once per touch.

## DSP Parameter Key Reference

All `tN_` keys: N = 0..7.

| Key | Dir | Format | Notes |
|-----|-----|--------|-------|
| `tN_beat_stretch` | set | `"1"` or `"-1"` | Expand/compress active clip. |
| `tN_beat_stretch_factor` | get | `"1x"`, `"x2"`, `"/2"`, … | Current stretch exponent. |
| `tN_beat_stretch_blocked` | get | `"0"` or `"1"` | 1 if last compress blocked. |
| `tN_clock_shift` | set | `"1"` or `"-1"` | Rotate all steps right/left by one. |
| `tN_clock_shift_pos` | get | integer string | |
| `tN_clip_length` | set/get | `"1"`..`"256"` | Active clip length. Saves state. |
| `tN_clip_resolution` | set | `"0"`–`"5"` | Per-clip ticks_per_step index into TPS_VALUES. Rescales notes proportionally. No-op while recording. Saves state. |
| `tN_cC_tps` | get | integer string | Current ticks_per_step for clip C of track N. |
| `tN_stop_at_end` | set | any | Arm page-stop. |
| `tN_deactivate` | set | any | Clear clip_playing, will_relaunch, queued_clip, pending_page_stop, record_armed. |
| `tN_cC_step_S_notes` | get | space-sep MIDI notes or `""` | |
| `tN_cC_step_S_toggle` | set | `"note [vel]"` | Toggle note. Sets step_vel on first note. Saves state. |
| `tN_cC_step_S_clear` | set | any | Atomic zero + deactivate; resets vel/gate/nudge. Saves state. |
| `tN_cC_step_S_add` | set | `"pitch [offset [vel]]"` | Add-only overdub. Defers save while recording. |
| `tN_cC_step_S_vel` | set/get | `"0"`–`"127"` | No-op if step has no notes. Saves state. |
| `tN_cC_step_S_gate` | set/get | `"1"`–`"6144"` | No-op if step has no notes. Saves state. |
| `tN_cC_step_S_nudge` | set/get | `"-23"`–`"23"` | Moves all notes in step as unit. No-op if step has no notes. Saves state. |
| `tN_cC_step_S_reassign` | set | dest step index | Move/merge notes to dest. Empty dest: simple move. Occupied dest: merge (dst pitch wins; active src activates inactive dst). Always clears src. Saves state. |
| `tN_cC_step_S_copy_to` | set | dest step index | Copy all step data (notes, vel, gate, tick offsets) to dest; overwrites dest; src unchanged. Saves state. |
| `tN_cC_step_S_pitch` | set | signed delta | Shift all notes by N semitones. No-op if step has no notes. Saves state. |
| `tN_cC_step_S_set_notes` | set | space-sep MIDI notes | Replace all notes. No-op if step has no notes. Saves state. |
| `tN_cC_clear` | set | any | Atomic wipe all steps + deactivate track. Saves state. |
| `tN_cC_clear_keep` | set | any | Atomic wipe all steps; preserves clip_playing/will_relaunch. Silences in-flight notes. Saves state. |
| `tN_cC_hard_reset` | set | any | Full factory reset via `clip_init` (length=16, tps=24, all steps/notes/pfx cleared). Undo snapshot, silence, pfx_sync if active clip. Clip stays in transport. Saves state. |
| `tN_recording` | set/get | `"0"` or `"1"` | 1 = overdub (defers save). 0 = disarm + flush. |
| `tN_pfx_reset` | set | any | Atomically reset NOTE FX + HARMZ + MIDI DLY. |
| `tN_pfx_snapshot` | get | 31 space-sep integers | Batch read of active clip's pfx params: fields 0-16 are NOTE FX K0-K4, HARMZ K0-K3, MIDI DLY K0-K7 (legacy 17); fields 17-22 are SEQ ARP K1-K6 (style/rate/oct/gate/steps/retrigger); fields 23-30 are SEQ ARP `step_vel[0..7]`. JS parser is length-aware. |
| `tN_seq_arp_*` | set | varies | Per-clip SEQ ARP params: `seq_arp_style` (0=Off..9=RnO), `seq_arp_rate` (0..9 → 1/32..1-bar), `seq_arp_octaves` (-4..-1, +1..+4; skip 0), `seq_arp_gate` (1..200%), `seq_arp_steps_mode` (0=Off/1=Mute/2=Skip), `seq_arp_retrigger` (0/1; default 1). Style→0 (Off) silences sounding output and clears held buffer. |

Perf Mode keys: `perf_mods` (set, uint32 bitmask — 24 bits; see PERF_MOD_* constants in seq8.c and PERF_MOD_PAD_MAP in ui.js; JS ORs toggled+held+recalled and sends on every change). `looper_retrigger "ticks"` (atomic stop + arm at new rate, bypasses LOOPING fast-path; used for same-pad re-trigger while held).

Other keys: `clip_copy "srcT srcC dstT dstC"` · `row_copy "srcRow dstRow"` · `clip_cut "srcT srcC dstT dstC"` (copy src→dst + hard-reset src, `undo_begin_clip_pair` snapshot) · `row_cut "srcRow dstRow"` (all 8 tracks, `undo_begin_row_pair` snapshot) · `tN_active_clip`, `tN_current_step`, `tN_current_clip_tick` (get: `current_step*TPS+tick_in_step`), `tN_queued_clip`, `tN_cC_steps` (get: 256-char '0'/'1'/'2', midpoint-based position), `tN_cC_length`, `tN_cC_step_S` (set '0'/'1' = deactivate/activate without touching notes), `tN_launch_clip`, `launch_scene`, `transport` (set: `"play"`, `"stop"`, `"panic"`, `"deactivate_all"`), `playing`, `state_snapshot`, `tN_route`, `tN_pad_mode`, `tN_pad_octave`, `key`, `scale`, `scale_aware`, `bpm`, `launch_quant`, `input_vel`, `inp_quant`, `midi_in_channel` (0=All, 1–16), noteFX/harm/delay params.

**Drum lane keys** (all read from/write to active clip's lane L of track N): `tN_lL_lane_note` (get/set midi_note) · `tN_lL_clip_length` (set, saves) · `tN_lL_steps` (get: 256-char '0'/'1'/'2'; **step-centric** — reads `steps[s]`/`step_note_count[s]` directly, NOT note_step(); this ensures display index always matches the physical step that `_clear`/`_toggle` operate on; **active-clip-implicit** — must defer JS read 2 ticks after clip switch) · `tN_lL_note_count` (get) · `tN_lL_length` (get) · `tN_lL_current_step` (get) · `tN_lL_step_S_toggle "vel"` (set, saves) · `tN_lL_step_S_clear` (set, saves) · `tN_lL_step_S_vel` (set, saves) · `tN_lL_step_S_gate` (set, saves) · `tN_lL_step_S_nudge` (set, saves) · `tN_lL_step_S_reassign` (set: move/merge to dest step, saves) · `tN_lL_copy_to "dstLane"` (set: copy all step data from lane L to dstLane in active clip, same track; preserves dst midi_note; undo snapshots full drum clip; no-op if src==dst; saves) · `tN_lL_cut_to "dstLane"` (set: same as copy_to, then `clip_init` src + silence src midi_note; preserves both midi_notes; undo snapshots full drum clip; saves) · `tN_lL_mute "0|1"` (set, saves) · `tN_lL_solo "0|1"` (set, saves) · `tN_drum_mute_all_clear` (set: clears both drum_lane_mute and drum_lane_solo bitmasks, saves) · `tN_drum_lane_mute` (get: uint32 bitmask) · `tN_drum_lane_solo` (get: uint32 bitmask) · `tN_cC_drum_has_content` (get: '1' if any lane has note_count > 0) · `tN_drum_active_lanes` (get: uint32 bitmask, bit L set if lane L has a hit at its current step — used for playback pad flash) · `tN_drum_lanes_qnt "0–100"` (set: sets `pfx_params.quantize` on all 32 lanes of the active drum clip atomically; saves state). **Global drum clip keys**: `drum_clip_copy "srcT srcC dstT dstC"` (copies all 32 lanes from drum_clips[srcC] on track srcT to drum_clips[dstC] on track dstT; preserves dst midi_notes; undo snapshots dst clip only; saves) · `drum_clip_cut "srcT srcC dstT dstC"` (same as copy + silences each src lane note + `clip_init` each src lane clip + restores src midi_notes; saves). **Drum nudge reassign**: JS fires `_reassign` on hold-release when `|stepEditNudge| > tps/2` (strictly greater — `>= tpsMid+1` for negative to avoid creating offset=+tps/2 which `note_step()` maps to wrong step).

## DSP Struct Reference

```c
typedef struct {
    uint32_t tick;               /* absolute clip tick 0..clip_len*TPS-1 */
    uint16_t gate;
    uint8_t  pitch, vel, active;
    uint8_t  suppress_until_wrap; /* skip until clip wraps (recording suppressor) */
    uint8_t  step_muted;          /* from inactive step; suppressed from MIDI */
    uint8_t  pad[1];
} note_t;

typedef struct {
    uint8_t  steps[SEQ_STEPS];               /* 0=off/1=on; step may have notes even when 0 */
    uint8_t  step_notes[SEQ_STEPS][8];
    uint8_t  step_note_count[SEQ_STEPS];
    uint8_t  step_vel[SEQ_STEPS];
    uint16_t step_gate[SEQ_STEPS];
    int16_t  note_tick_offset[SEQ_STEPS][8]; /* per-note ±23 ticks */
    uint16_t length;
    uint8_t  active;
    uint16_t clock_shift_pos;   /* Persisted. */
    int8_t   stretch_exp;       /* 0=1x, ±1=×2/÷2. Persisted. */
    uint16_t ticks_per_step;    /* TPS_VALUES[0..5]={12,24,48,96,192,384}. Default 24. Persisted if non-default. */
    clip_pfx_params_t pfx_params; /* per-clip NOTE FX/HARMZ/SEQ ARP/MIDI DLY params (23 ints + 8B step_vel). */
    note_t   notes[512];        /* absolute-position list; rebuilt from step arrays at init/edit */
    uint16_t note_count;        /* active+tombstoned; not decremented on removal */
    uint8_t  occ_cache[32];     /* 256-bit occupancy bitmap */
    uint8_t  occ_dirty;
} clip_t;

typedef struct {
    clip_t  clip;       /* full clip_t — notes[], step arrays, length, tps, pfx_params */
    uint8_t midi_note;  /* base pitch; default DRUM_BASE_NOTE + lane_index */
    uint8_t _pad[3];
} drum_lane_t;

typedef struct {
    drum_lane_t lanes[DRUM_LANES]; /* 32 lanes */
} drum_clip_t;

typedef struct {
    clip_t    clips[NUM_CLIPS];
    uint8_t   active_clip;
    int8_t    queued_clip;
    uint16_t  current_step;
    uint32_t  tick_in_step;     /* per-track; uses cl->ticks_per_step */
    uint16_t  pending_gate, gate_ticks_remaining;
    uint8_t   pending_notes[8], pending_note_count;
    play_fx_t pfx;
    uint8_t   recording, clip_playing, will_relaunch, pending_page_stop, record_armed, stretch_blocked;
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    uint8_t   rec_pending_count;
    struct { uint8_t pitch; uint16_t ticks_remaining; } play_pending[32];
    uint8_t   play_pending_count;
    uint32_t  current_clip_tick;  /* current_step*ticks_per_step + tick_in_step */
    uint8_t   pad_mode;           /* 0=PAD_MODE_MELODIC_SCALE, 1=PAD_MODE_DRUM */
    drum_clip_t drum_clips[NUM_CLIPS];
    uint16_t  drum_current_step[DRUM_LANES];
    uint32_t  drum_tick_in_step[DRUM_LANES];
} seq8_track_t;

typedef struct {
    seq8_track_t tracks[NUM_TRACKS];
    uint8_t  playing;
    uint32_t global_tick;           /* bar boundary = % 16 == 0 */
    uint32_t master_tick_in_step;   /* always 24-tick master clock; drives global_tick + launch-quant */
    uint8_t  scale_aware, input_vel, inp_quant, midi_in_channel, pad_key, pad_scale, launch_quant;
    uint8_t  mute[NUM_TRACKS], solo[NUM_TRACKS];
    uint8_t  metro_on;       /* 0=Off,1=Count,2=On,3=Rec+Ply. Default 1. Persisted (omitted when=1). */
    uint8_t  metro_vol;      /* 0–100. Default 80. */
    uint32_t metro_beat_count; /* JS polls for change → playMetronomeClick() */
    /* Performance Effect Mode state: */
    uint32_t perf_mods_active;         /* bitmask from JS perf_mods set_param */
    uint32_t looper_cycle;             /* increments each LOOPING wrap */
    uint8_t  looper_sync;              /* 1=wait for clock boundary (default), 0=immediate */
    uint8_t  looper_pending_silence;   /* 1=call looper_silence_active next render_block (ROUTE_MOVE safe) */
    uint8_t  perf_emitted_pitch[NUM_TRACKS][128]; /* raw→emitted pitch xlate, 0xFF=not sounding */
    struct { uint8_t raw_pitch, emitted_pitch, track, _pad; uint16_t fire_at; } perf_staccato_notes[16];
    uint8_t  perf_staccato_count;
    /* + snapshots[16], instance_nonce, state_path, ext_queue */
    /* Drum undo/redo (mutually exclusive with melodic undo_valid): */
    uint8_t  drum_undo_valid, drum_undo_track, drum_undo_clip;
    uint8_t  drum_redo_valid, drum_redo_track, drum_redo_clip;
    uint32_t snap_drum_eff_mute[16][NUM_TRACKS]; /* per-snapshot per-track lane eff-mute bitmask */
    drum_rec_snap_lane_t drum_undo_lanes[DRUM_LANES]; /* step-data-only; ~237 KB/slot */
    drum_rec_snap_lane_t drum_redo_lanes[DRUM_LANES];
} seq8_instance_t;
```

**Render logic** (per tick):
1. At `tick_in_step==0`: bar-boundary launch (`queued_clip >= 0 && !pending_page_stop && global_tick % QUANT_STEPS[launch_quant] == 0`). Page-stop (`pending_page_stop && global_tick % 16 == 0`).
2. Gate countdown: decrement `play_pending[].ticks_remaining`; `pfx_note_off` at 0.
3. Note-on: if `clip_playing && !effective_mute`, scan `notes[]` for `effective_note_tick(n) == current_clip_tick`. Skip `step_muted` and `suppress_until_wrap`. Add to `play_pending[]`.

**Hybrid model**: Step arrays = edit surface; notes[] = playback surface. All set_param handlers write step arrays then call `clip_migrate_to_notes` (one-way rebuild; never modify notes[] directly). `clip_build_steps_from_notes` runs only at state load. `active`=tombstone flag; `step_muted`=MIDI suppression for inactive steps; `suppress_until_wrap`=recording only. See `SCHWUNG_SEQ8_LIMITATIONS.md`.

**state_snapshot** (52 values): `playing cs0..7 ac0..7 qc0..7 count_in cp0..7 wr0..7 ps0..7 flash_eighth flash_sixteenth`.

## Recording architecture (DSP-owns-timing)

JS sends pitch+vel via set_param on pad press; DSP reads `tick_in_step + current_step` at arrival → absolute tick, inserts note with placeholder gate (1 tick). Note-off: JS sends `tN_record_note_off "pitch"`; DSP computes gate with loop-wrap. 10-slot `rec_pending[]` map. Input Quantize ON snaps to step boundary. Disarm: `finalize_pending_notes` closes all pending note-ons. Accuracy ≤2.9ms (same render block). DSP-owns-timing is the only viable approach on v0.9.7 (on_midi → JS only; host_module_send_midi undefined). **Gate capture**: `record_note_off` and `finalize_pending_notes` scan notes[] by `pitch+tick+active` only — do NOT require `suppress_until_wrap`. `clip_migrate_to_notes` (called by any step edit set_param, including `_gate`) rebuilds all notes with `suppress_until_wrap=0`, so requiring that flag would cause gate to stay at the 1-tick placeholder whenever any step op ran mid-hold. **Drum live undo**: at arm time (count-in or `tN_recording "1"`), if `pad_mode==DRUM`, `undo_begin_drum_clip()` snapshots all 32 lanes' step data into `drum_undo_lanes[]` (step-data-only struct, no `notes[]`; `clip_migrate_to_notes()` rebuilds on restore). `drum_undo_valid` and `undo_valid` are mutually exclusive — each clears the other on arm. JS undo handler dispatches `undo_restore` / `redo_restore` regardless of mode; DSP checks `drum_undo_valid` first.

## Known limitations

- Transport stop saves will_relaunch; panic does not.
- Do not load SEQ8 from within SEQ8 — LED corruption. Workaround: Shift+Back first.
- Live pad latency floor: ~3–7ms structural.
- All 8 tracks route to the same Schwung chain.
- State file v=15 — wrong/missing version → deleted, clean start.
- `g_host->get_clock_status` is NULL — no background transport follow.
- `g_host->get_bpm` non-null but doesn't track BPM changes while stopped.
- **ROUTE_MOVE + external MIDI**: no channel remapping — external MIDI plays on the Move track matching the keyboard's own MIDI channel, ignoring SEQ8's Ch knob. Pads and sequencer are channelized correctly. Fix requires shim feature (`/schwung-ext-midi-remap`); spec in `SCHWUNG_SEQ8_LIMITATIONS.md` §13.
- `pfx_send` from set_param context does NOT release Move synth voices; only render_block-context inject does. `send_panic` skips ROUTE_MOVE (inject flood loses most packets).
- `stepOpTick = tickCount` on step press/release prevents live_notes flush from coalescing with toggle set_params in the same audio block.
- See `SCHWUNG_SEQ8_LIMITATIONS.md` for framework interaction patterns and gotchas.

## Hardware reference

**Pad rows** (bottom-to-top): 68–75 · 76–83 · 84–91 · 92–99

**Encoders**: `MoveMainKnob = 14` (CC) | `MoveMainButton = 3` (CC, jog click) | `MoveMainTouch = 9` (note)

**Step buttons**: notes 16–31, `0x90` (d2>0=press, d2=0=release).

**LED palette**: Fixed 128-entry. Dim pairs: Red(127)→DeepRed(65) · Blue(125)→DarkBlue(95) · VividYellow(7)→Mustard(29) · Green(126)→DeepGreen(32).

## MIDI routing

**DSP**: `midi_send_internal` → Schwung chain. `midi_send_external` → USB-A — **never from render path** (blocking, deadlock risk).

**JS**: `shadow_send_midi_to_dsp` → chain · `move_midi_internal_send` → LEDs/buttons · `move_midi_inject_to_move` → simulates pads (note range 68–99 only; type 0x09 = LED control, not audio) · `move_midi_external_send` → USB-A (deferred) · `host_preview_play(path)` → plays 16-bit PCM WAV through Move speakers (ignores declared sample rate in header; tool module context only).

## Build / deploy / debug

```sh
./scripts/build.sh && ./scripts/install.sh   # DSP change (also copies all JS files)
cp ui.js dist/seq8/ui.js && cp ui_constants.mjs dist/seq8/ && ./scripts/install.sh  # JS-only
nm -D dist/seq8/dsp.so | grep GLIBC         # verify GLIBC ≤ 2.35
ssh ableton@move.local "tail -f /data/UserData/schwung/seq8.log"
```

**JS file structure**: `ui.js` (main, ~5500 lines) + `ui_constants.mjs` (hardware constants, palette, fmt functions, MCUFONT, pixelPrint — 206 lines). Both must be deployed together. `build.sh` copies both automatically. JS-only deploy requires copying both (see above).

**DSP file structure**: `dsp/seq8.c` (~3624 lines) includes `dsp/seq8_set_param.c` (~2892 lines) via `#include`. Single translation unit — no extern declarations, no build changes. `seq8_set_param.c` covers all `set_param` handlers.

Schwung core: v0.9.7. GLIBC ≤ 2.35. No complex static initializers.

`~/schwung-notetwist` — NoteTwist reference. `SEQ8_SPEC_CC.md` — full design spec.
