# Changelog

All notable changes to dAVEBOx are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com). Add entries to
`[Unreleased]` as user-facing changes land; `scripts/cut_release.sh` finalizes
the section into a versioned heading at release time.

## [Unreleased]
### Performance / UX
- Additional movy-inspired UI improvements.

## [1.0-beta.7] — 2026-07-20
### Features
- **Big pop-up read-outs when you turn a parameter knob.** Turning any knob — on the track pages or in the step editor — opens a large, centred view of just that parameter: a zoomed arc/value, or a scrolling picker for choice params, so you can read what you're changing at a glance. It appears on turn (a bare touch still just highlights the name) and holds until you release.
- **Redesigned track-view parameter pages.** Graphical widgets per knob (arc and centre-tick knobs, toggle bars, option/value squares) under a chunky pixel-font header — an on-screen canvas UI whose look and font are adapted from [movy](https://github.com/DimaDake/schwung-movy) by DimaDake. The step editors match.
- **Capture — retrospective recording, like Move's own Capture button.** dAVEBOx always listens; tap Capture to keep what you just played. From a stopped empty session it estimates the tempo, sizes the clip to whole bars and plays it back; with the transport running it overdubs into the focused clip. Melodic and drum.
- **Live Merge now confirms before it starts, with a 1-bar count-in.** Shift + Record raises a notice first (so an accidental press can't wipe a take), then counts in and captures a clean take — single-track in Track View, all 8 in Session View.
- **Clearer button roles.** Capture captures, Sample bakes, Shift + Record runs Live Merge.
- **The Back button now navigates instead of just leaving.** A tap backs out one level at a time; hold Back (or the menu item) to suspend. (Needs a current Schwung host; on older hosts a tap suspends as before.)
- **One consistent feel for every knob.** Three response classes — continuous (±1 always dialable), option-pickers, and deliberate (toggles/actions) — replacing ~20 hand-tuned speeds.
- **Absolute step velocities in the arp and Repeat Groove step editors,** with a "Thru" default that passes your playing dynamics through and a Shift fine-adjust page.
- **Widget cues and bank renames.** Action knobs show "turn-either-way" chevrons, Playback Direction shows real arrows, stepped ranges show a position dot-strip; ARP IN → LIVE ARP and AUTO → AUTOMATION, with consistent headers.

### Fixes
Lots of stability and correctness work, including: crash fixes around drum-clip copy/cut/undo, perf-mods over an empty loop, and placing a Live Merge onto an empty drum clip; stuck-note fixes (track switch, count-in, transport restart, two-pad co-run); external-MIDI recording restored on Move/Schwung/External routes plus count-in capture; Ableton (.ablbundle) export repaired; a bake-vs-live-playback parity audit; a consistency pass over every dialog and pop-up (button order, casing, "Back cancels"); NOTE FX pitch-random mode now persists; live-recording into an empty clip no longer freezes; saved performance presets survive reloads; and many smaller refinements. Full detail in the repo changelog and the technical changelog.

## [1.0-beta.6] — 2026-06-25
### Features
- **The AUTO bank is now fully functional on drum tracks.** Step LEDs show the automation gradient and a moving playhead, the per-knob automation graph rescales as you change loop lengths, and the pads stay playable while you edit — gray, with the active lane in your track colour and any lane that's sounding lit dimly, while the right 4×4 block stays dark (the pads play their drum sounds and no longer select lanes on this bank). Per-lane loop length (hold Loop + step buttons **or** the jog wheel), Shift + Step 15 double-and-fill, and the rest of the per-lane loop tools all target the automation lane, exactly like melodic tracks.
- **Inserting an automation point starts from the value already at that step.** Hold a step that has no point of its own and turn a knob to add one: it now starts from the line's current (interpolated) value instead of jumping to 0, and you can turn up **or** down on that first move to place the point above or below — so new points land on the existing curve and the automation stays smooth. Works on melodic and drum tracks.
- **Automation graph shows a live playhead.** The automation graph on the AUTO bank — both the resting overview and the knob-touched param view — now draws a moving cursor showing where playback is within the lane's loop, so you can see the curve and the playhead together. Melodic and drum.

## [1.0-beta.5] — 2026-06-24
### Features
- **Mute is handed to Move/Schwung during co-run.** While co-running Move's native instruments and drum pads (Shift+Step 3 / Track Config), pressing **Mute** now mutes the *Move* instrument or drum pad you're working with, instead of being captured by dAVEBOx. While editing a Schwung chain, **Mute is the chain's bypass modifier** — Mute + jog-click bypasses the focused slot component — so dAVEBOx no longer steals it for its own track mute/solo there (in the FX picker it cedes to Move, like normal co-run). Outside co-run, Mute keeps its dAVEBOx track mute/solo behavior. (Requires Schwung with the Mute co-run group; older Schwung simply leaves Mute with dAVEBOx as before.)
- **Bank position strip in the Track View header.** The header now shows a compact "you are here in the bank chain" strip on the right — the active bank is a tall block, the others short stubs — so you can see how many banks exist and where you are as you turn the jog (like Move's Device View). It appears on both the resting track overview and every parameter-bank overview, where it replaces the old `Tr#` track-number indicator, and supersedes the old inconsistent `>>` hints. Ported from [Overture](https://github.com/m-dwyer/overture).
- **CC automation on drum tracks.** The AUTO bank is now fully active on drum tracks — record, play back, step-edit, and set resting values for CC and aftertouch lanes the same way you would on a melodic track. Per-lane loops and the automation graph work identically.
- **Clock Out — make dAVEBOx the clock master for external gear.** New **Settings → Clock Out** toggle (default **Off**). Turn it **On** while free-running and dAVEBOx sends MIDI clock and start/stop out the USB-A port, so external synths and drum machines lock to dAVEBOx's tempo and transport. When **Clock Follow = Move**, Clock Out is automatically suppressed (Move's own MIDI Clock Out handles external sync) and the row shows **—**, while your On/Off preference is remembered.
- **Live arp & delay keep their groove while following Move.** With **Clock Follow = Move**, holding pads to arpeggiate or using tempo-synced delay while the transport is stopped now keeps running at Move's tempo instead of freezing — and dAVEBOx now reads its tempo from Move's clock automatically, so the BPM display matches Move without setting it by hand. (Pressing stop still stops dAVEBOx's sequencer, as before.)
- **Clock Follow — lock dAVEBOx to Move's transport.** New **Settings → Clock Follow** toggle (default **Off** = unchanged free-running behavior). Set it to **Move** and dAVEBOx follows Move's MIDI clock and tempo instead of its own — BPM shows **Move** and Tap Tempo is disabled — so the two stay phase-locked. dAVEBOx's **Play** now starts/stops *Move's* transport (and dAVEBOx follows it), so a single Play press launches both from the same downbeat; arming **Record** while stopped starts Move and counts a one-bar lead-in on its clock before recording. If Move's clock stops, dAVEBOx stops with it.
- **Save state asks first.** Choosing Save state from the Global Menu now shows a confirmation (with your current snapshot count) before it saves, so an accidental click can't overwrite your work.

### Fixes
- **Fixed a crash when clearing a clip with a drum track in the set.** With a drum track present, clearing a clip (or making almost any edit afterward) could crash the Move. Empty drum clip slots are now skipped when saving the set's state instead of being read as if they held data.
- **ALL LANES edits all wait for the confirmation now.** The ALL LANES drum bank asks you to confirm before it changes all 32 lanes — but only the knobs used to wait for that; the Loop button (loop length and loop window), double-and-fill (Shift+Step 15), and quantize (Shift+Step 16) could edit every lane before you'd confirmed. Now all of them wait, the "Edits will affect all lanes. Proceed?" screen appears the moment you open the bank, the gated Shift+Step shortcut buttons stay unlit until you confirm, and holding Loop no longer slips into the length view — so nothing implies an edit took effect early.
- **Track mode menu shows Conduct, not Cond.** The abbreviated label in Track Config → Mode has been expanded to the full word.
- **Switching tracks with Shift + jog stays on the track overview.** Holding Shift and turning the jog to change tracks no longer flips the screen to the active parameter bank — the OLED keeps showing the track overview as you move. (Holding Shift on the NOTE FX bank also no longer pops a preview; that was a leftover from a removed feature.)
- **Clips you've left off stay off.** A clip that has notes but isn't playing no longer springs to life on its own — scrolling between tracks, or pressing Play, only auto-starts a track's focused clip if that clip is empty. And Shift + clip pad in Session View now *opens* a notes-clip in Track View for editing without turning it on (while stopped); empty clips, or any clip while the transport is running, still launch. To turn a clip on, tap its clip pad in Session View or its clip side button in Track View.
- **Metronome mode reads the same everywhere.** The Track-View status indicator now shows the same names as the menu and the Shift+Step 6 popup — Cnt-In / Play / Always — instead of the older Count / Rec / Rec/Ply.
- **Knob lights no longer flash a dead Shift gesture.** Holding Shift in Track View used to blink certain knob lights, implying a Shift+turn function — but those moved to jog-click long ago, so the flash promised something that did nothing. Removed. (Alt-params are still reachable via jog-click, shown by the down-arrow in the header.)
- **Automation now records after a count-in.** Arming Record from a stopped transport (which plays a 1-bar count-in first) and then turning an automation knob now captures the move. Previously the first knob turn right after the count-in was dropped on lanes that had no automation yet.
- **Drum tracks show the right pattern after switching with Shift + jog.** Switching to a drum track by holding Shift and turning the jog wheel now refreshes that track's lane steps, drum note names, and clip dots — matching Shift + bottom-row-pad. Previously they could show stale data if the track had changed while it wasn't selected.
- **Chromatic pad layout is remembered.** A track set to Chromatic (Shift + Step 8) now stays Chromatic after you suspend, exit, or reload the set — it was silently reverting to In-Key before.
- **Copying a drum lane carries its repeat cycle length.** Copy or cut a drum lane and its Note Repeat gate cycle length now comes along (and a cut source resets to the default 8) — previously the destination kept its own old cycle length against the copied gate pattern.
- **Drum pads play once in Move co-run.** While editing Move's drum sounds in co-run, tapping a drum pad now plays a single hit at the velocity you played — it was double-triggering and ignoring velocity before — and still selects that drum on Move for editing.

### Documentation
- **Manual: co-run gets its own chapter (§15).** Sound Sources & Co-Run Editing is now a dedicated chapter covering entry (Shift+Step 3 / Track Config), controls, exit (Step 3 blinks as the affordance), and Edit Synth/Slot specifics. Previously this was scattered across Track Config footnotes. "Forthcoming" labels removed — co-run works on Schwung 0.9.18+. "Patched Schwung" language updated to version-specific where known (Sch lanes → 0.9.17+).
- **Manual: Clock Follow and Clock Out documented (§16.6).** Clock Follow explains the Move-native integration in detail — the "dAVEBOx is the sequencer, Move provides clock/tempo/voices" model, practical setup steps, and the clear-Move-clips requirement. Clock Out is covered as its own subsection (dAVEBOx as clock master to external gear). Both require Schwung 0.9.16 or later for the audio-rate clock path.
- **New Quick Start guide + reorganized manual.** Added a separate `QUICKSTART.md` that walks new users from setup to a looping pattern with effects, scenes, and Performance Mode in six short lessons. The manual is reorganized into six clearly-signposted parts (Foundations · The Two Views · Building Patterns · Parameter Banks · Performance & Output · Reference) so each topic lives in one place — Conductor tracks now have their own chapter, and all the parameter banks are grouped together. Also corrected against the device: Track Config's Type is Keys/Drums/Cond (with a Layout entry), the Global Menu is listed in on-device order, and the obsolete "Save" menu action is replaced with the actual auto-save / Quit / Save-state behavior.
- **Manual corrections.** Fixed several spots where the manual didn't match the device: Performance-Mode capture length is set with the R0 pads (1/32–1/2 bar; there is no 1-bar or triplet capture), drum lane bank A/B switches with Up/Down (modes cycle with Shift+Step 8), the AUTO playhead step shows white, Shift+jog switches tracks in both views, and the step-edit K2 label reads "Note".

## [1.0b4] — 2026-06-07
### Features
- **Key/Scale changes transpose your clips.** Editing the global Key or Scale now moves all melodic clips with it, with a live preview as you turn the knob and a "Transpose clips?" confirm before it commits. Drum tracks are untouched.
- **Co-run surface polish.** Cleaner pad and step-button visuals in both co-run modes, with Step 3 as a consistent blinking exit and the routed slot/track highlighted on the side buttons.
- **Co-run auto-opens the instrument the track plays.** Entering Schwung co-run jumps straight to the chain slot that receives the track's channel — no more "which slot?" picker.
- **Per-lane automation loops.** Each automation lane can have its own loop length, playback speed, and step granularity, cycling independently from the clip. Set it up with Hold Loop on the AUTO bank.
- **Auto bank visual mode.** The AUTO bank now has a distinct look — a warm step-LED gradient, grayscale pads, and an OLED automation graph with a moving playhead.
- **Transport stop returns to resting values.** Stopping playback sends each automation lane's resting value so parameters don't get stuck.
- **Conductor tracks — real-time, non-destructive transposition.** A new track type (Track Config → Type → Cond) that transposes every playing melodic clip in real time from the note the Conductor plays — sequence a progression and all responding tracks follow it in key. Your written notes never change; the shift is live and reversible. One Conductor per session, with per-track responder, octave, and timing controls.
- **Scene bake can apply the Conductor.** Baking a scene with an active Conductor adds an "Apply Conductor?" step that can fold the live transposition permanently into each responding clip.
- **Ableton export can apply the Conductor.** Exporting with an active Conductor adds an "Apply Conductor?" step that folds the transposition into the exported clips, without touching your live session.

## [1.0b3] — 2026-05-30
### Features
- **Schwung chain knob automation (Sch lanes).** AUTO bank lanes can now target Schwung chain knob assignments (CC 102-109 absolute knob control). In ASSIGN mode, scroll left past AT to reach Sch1–Sch8 — each maps to a chain slot knob mapping. Recording, playback, resting values, step-edit, and delete all work identically to CC lanes. Routed via DSP `pfx_send` on the internal MIDI path — same-buffer delivery, no JS overhead. Requires Schwung 0.9.17.

### Fixes
- **Pads silent on Schwung v0.9.16.** The DSP inbound pad capability sentinel (merged upstream in v0.9.16) caused dAVEBOx to disable the JS live-note path, but the DSP on_midi path could fail to produce sound on stock Schwung. Fixed by moving the dispatch gate from JS to DSP — the JS path now always queues live notes as a fallback, and the DSP suppresses duplicates only when confirmed active.

## [1.0b2] — 2026-05-30
### Performance / UX
- **Lazy drum clip allocation.** Drum clips are now allocated per-track on drum mode entry instead of inline in every track. Default (1 drum track): ~7.5MB vs 60MB previously. No cap, no behavioral change.

### Fixes
- **Empty drum→melodic track conversion now reliably flips pad mode.** Previously, converting an empty drum track to melodic left DSP in drum mode (pads showed melodic layout but right half acted as velocity zones). Fixed by adding a get_param flush barrier for the empty-track path.
- **`delete_held` flag now shares padmap self-heal.** Moved from a separate `t0_delete_held` set_param (vulnerable to onMidiMessage coalescing) into the padmap payload's 35th token, giving it the same tick-based reconciliation as `pad_dispatch_muted`.
- **Incompatible state files prompt before erasing.** When loading a set saved by an older dAVEBOx version, a confirm dialog asks before wiping. "No" exits the module with the file preserved.

## [1.0b] — 2026-05-29
### Features
- **Per-clip / per-lane playback direction (Dir knob on CLIP and DRUM LANE banks).** Four modes: Forward, Backward, Pingpong-forward, Pingpong-backward. Mix directions across drum lanes freely. Bake and Ableton export honor direction — output is a forward-playing clip with notes rearranged to match directional playback.
- **Audio-reverse playback style (alt-mode on Dir knob).** Flip between Step (default) and Audio — in Audio mode, notes play "tape-reversed" during reverse motion. Pingpong + Audio gives fugue-machine-style one-forward + one-reversed cycle per note.
- **NOTE FX Len knob (K5) — non-destructive fixed length.** Per-clip (melodic) or per-lane (drum) fixed pre-gate length. Values: -- (passthrough), .25, .50, .75, 1, 2, 4, 8, 16 steps. Applied at playback, bake, and export.
- **Lgto (Legato) one-shot action on CLIP K8 / DRUM LANE K8.** Destructive rewrite: each note's gate extends to the next note's start. Undoable.
- **HARMONY bank: Hrm3 added, Unison removed.** Three harmony intervals (Hrm1/Hrm2/Hrm3) at ±24 semitones each. Scale-aware when Scale Aware is on.
- **Per-step trig conditions: Iter, Prob (was "Random"), and Ratchet.** Hold a step for the overlay. Iter gates steps on loop-cycle predicates (1/2 through 8/8). Prob rolls per-note at fire time (0–100%). Ratchet retriggers x2–x4 within one step. Applied across live playback, bake, and export.
- **Bank alt-params toggle with jog-click instead of Shift.** Sticky toggle with a flashing arrow icon. Works on CLIP, DELAY, AUTOMATION, DRUM LANE, REPEAT GROOVE, ALL LANES. AUTOMATION alt = ASSIGN mode.
- **CC automation latch overwrite recording.** Turn a knob to engage — continuously overwrites the lane along the playhead. Keeps writing even after you stop turning. Per-loop decimation keeps lanes clean.
- **Melodic pad pressure → aftertouch (Track Config → AftTch).** Off / Poly / Channel modes. Recorded into clips and plays back as interpolated automation.
- **AUTOMATION bank (renamed from CC PARAM).** Per-clip resting values with opt-in "—" floor, 1024-point cap, AT/CC type per knob, step LED gradient, knob-ring status colors, knob acceleration.
- **Clear Automation is undoable.** Undo also restores automation lost during clip clear/copy/cut/bake/row operations.
- **Save states (snapshots).** Up to 16 timestamped snapshots per set via Global Menu. Save, load (with confirm), and overwrite at cap.
- **Export to Ableton Live (.ablbundle).** Full 8-track × 16-scene export with baked clip notes, drum polymeter flatten, route-aware instruments, self-contained samples, multi-cycle bake for randomized/delayed clips, and progress display.
- **Track type conversion carries notes (Track Config → Mode).** Drums↔Keys translates sequenced notes. Empty tracks convert instantly.
- **Co-run improvements.** Edit Slot knobs drive chain params. Edit Synth reliable track landing + clean LED handoff. Co-run exit is Menu; Back navigates within the editor. Drum pad hold works for Move's per-drum editor. Side clip buttons lit solid white in Edit Synth.
- **Move-native knob spin stutters less in Edit Synth.** Shim coalesces CC detents per audio frame.
- **ARP IN bank reset (Delete+jog on ARP IN bank).** Resets all TARP params in one gesture.
- **Arp Steps overlay.** Jog-click on SEQ ARP or ARP IN for persistent step-interval editing (±24 scale degrees per step) + step-vel level editor. Loop+pad sets pattern loop length (1–8). Note/Session exits overlay. Pads suppressed during overlay.
- **Sub-bar launch quant preserves playhead phase.** 1/16, 1/8, 1/4, 1/2 phase-align into the new clip instead of resetting to step 0.
- **CLIP, DRUM LANE, and ALL LANES knob banks rearranged.** Consistent layout across banks. ALL LANES gains K1=Res (all 32 lanes) and K7=Dir (all lanes).
- **Melodic and drum NOTE FX banks rearranged.** Drum NOTE FX now hosts the per-lane MIDI-note editor (K1+K2).
- **Recording blocked in non-Forward direction.** Shows popup; bake first to freeze direction, then record.
- **Copy/cut carries Dir and RvSt to destination.**
- **Loop button blinks at ARP IN rate while track is latched.**
- **Delay Retrig knob (DELAY K7).** New note-on drains in-flight echoes (default ON). Clock Feedback moves to Shift+K1.
- **Shift+side row in Session View queues bar-quantized scene launch.**
- **Hold empty melodic step → auto-activates with lastPlayedNote and opens step edit.**
- **Tap Loop alone (drum track) unlatches all repeats on that track.**

### Fixes
- **Clear Session fully resets all state.** Global settings, mute/solo, snapshots, CC assigns, VelIn, JS state, TARP, channel, pad octave, route, looper all reset to factory defaults.
- **Global params persist on change.** Key, scale, BPM, metronome, etc. save immediately instead of only on suspend.
- **Pad drop self-heal.** Periodic readback detects and corrects stale pad_note_map entries within ~50ms.
- **No stuck notes when changing playback direction during playback.**
- **Fixed Move synth voice corruption after stopping legato playback.** No longer sends CC 123 for ROUTE_MOVE.
- **Bank param resets also reset Dir, RvSt, SqFl.**
- **Session view playing clips blink in sync with pad LEDs.**
- **Step length adjust: pressing end-of-span step now shrinks the note.**
- **OLED param display dismisses immediately on jog release.**
- **NOTE FX Len=.25 no longer plays at double length.**
- **First cycle after clip clear is no longer silent.**
- **Recording-suppressor flags cleared on every clip launch.**
- **REC arm no longer blocked by RvSt=Audio when Dir=Fwd.**
- **Dir display no longer flickers on bank jog onto CLIP.**
- **Capture+drum pad no longer cuts the playing note.**
- **PP/Bwd bake uses rounded step indexing matching live playback.**
- **SEQ ARP / ARP IN Retrig=On no longer stutters on rapid chord changes.**
- **Arp Steps Off removed; Skip renamed Step.**
- **Poly aftertouch works expressively under SEQ ARP and ARP IN.** DSP replays pressure onto every arp voice; fans AT across all sounding pitches.
- **Bank reset also resets SEQ ARP step params in JS mirror.**
- **HARMZ no longer drops notes during chords.** Output pitches are reference-counted per track.
- **Arp Steps overlay no longer fires on drum tracks.**
- **Drum step edit overlay uses 4-column layout matching melodic.**
- **SEQ ARP / ARP IN Arp Gate defaults to 100% (was 50%).**
- **Random mode selector moved to jog-click alt param (K8).**
- **All Lanes bank requires jog-click confirmation on entry.**
- **Step edit length knob refined with breakpoints and grid-snap.**
- **Zombie clips after clear are fixed.** Two independent bugs (stale state_full cache + set_param coalescing) resolved.
- **Pads no longer go silent after modifier toggle.** Self-heal reads back pad_dispatch_muted every 5 ticks.
- **Drum vel-zone pad release sends note-off.**
- **Lowest pad octave no longer ghost-lights three pads.**
- **Perf Mode loop pads no longer leave hanging notes.**
- **Clear Session no longer leaves track 1's pads stale.**
- **Clip/drum-lane copy and cut preserve loop_start.**
- **Selecting a clip with loop_start>0 lands on the correct page.**
- **Clip Clear preserves clip structure (only wipes notes).** Drum clear likewise.
- **Drum lane Reset also resets per-lane Rpt groove.**
- **Focused clip plays by default on transport start.** Also on track switch and after clip clear.
- **Press-Record during playback arms at next bar boundary (adaptive clips).**
- **Per-track active param bank persists across track switches and reload.**
- **Length and loop-window changes re-anchor playhead phase.**
- **Loop Double works on clips with loop_start>0.**
- **Drum lane Delete+pad does notes-only clear (preserves structure).**
- **Drum repeats fire through track mute when pad is held.**
- **Shift+pad no longer triggers Rpt1/Rpt2 latch on prior track.**
- **Record-arming during play no longer drifts TARP timing.**
- **Rpt1+Rpt2 rates persist across reload.**
- **Input Quantize is per-track and snaps to actual rate value.** Melodic tracks gain per-track InQ on CLIP K6.
- **Transport Stop unlatches TARP and Rpt1/Rpt2 across all tracks.**
- **TARP latch survives track/route/channel changes.**
- **Modal pad-interception fixed.** Pads no longer leak into synth during dialogs and modifiers on patched Schwung.
- **VelIn applies to live pad monitoring on patched Schwung.** TARP output also respects VelIn.
- **Velocity zone presses audible again on patched Schwung.**
- **Recording into clips with non-zero loop start lands inside the window.**
- **ARP IN first note after count-in records on step 0.**
- **Delete+Play clears every latch across all tracks regardless of transport state.**
- **Per-track octave shift persists per-set.**
- **Stuck live notes when touching Arp Steps knob mid-hold fixed.**
- **SEQ ARP Steps Mode takes effect on first turn.**
- **Clear Session resets drum tracks back to Keys (except track 1).**
- **Drum→Keys Mode flip actually takes effect on DSP.**
- **Mute silences TARP/Rpt1/Rpt2 emission while keeping latch alive.**
- **Co-run exit reclaims LEDs and clears modifiers.**
- **Bank reset / param reset actually reaches DSP.** All reset sites routed through deferred drain.
- **Coalescing remediation across copy/cut/clear/snapshot/scene/merge gestures.**
- **Various display fixes:** active drum lane shows empty correctly, triplet ARP rate labels visible, CC PARAM OLED values clear after automation clear, bank reset routing fixed for drum CC PARAM, note-duration step LEDs match played length, track overview header drops Tr# indicator, AUTOMATION bank auto-dismisses, Shift hint overlay drops on compound modifier, drum-lane step copy flashes source.
- **Hot-path debug probes gated behind compile flag.** Prevents RT thread throttle from forced file writes.
- **Volume knob (CC 79) no longer stutters playback.** Dropped at top of MIDI handler.
- **Shift+Step3 co-run shortcut is Track View only.**
- **Side clip button focuses clip on press, not at legato boundary.**
- **Save/Quit/Shift+Back no longer drops DSP save under coalescing.**
- **Drum lane Cut gesture (Copy+Shift+lane+lane) now works.**
- **Hanging notes during fast or polyphonic live play fixed.** Same-tick off+on pairs drain in arrival order.
- **No more stuck notes when changing octave while holding a note.**

### Performance / UX
- **Pad input rewired to audio thread on patched Schwung.** Better chord cohesion and lower input latency.
- **ROUTE_EXTERNAL latency jitter ~7.6× tighter on patched Schwung.** Stddev 10.25ms → 1.35ms.
- **Count-in capture window tightened to last 1/8 note.**
- **ARP IN plays through count-in.** ARP IN with Sync=Off captures during count-in pre-roll.
- **Drum repeats during count-in + Repeat Sync toggle + true sub-step recording.**
- **Co-run drum pads invert into track colors.** Selected lane = track color, others = white.
- **Shift+bottom-row pads: active track is solid bright, others blink dim.**
- **New splash art pool.** 7 new frames added, 2 dropped.
- **Nudge knob folded onto Shift+K2 (Shft).**
- **Loop and Capture buttons have visible dim grey ambient.**
- **Shift+jog in Session View steps the active track.**
- **Various knob speed improvements:** NoteFX Gate 4×, Quantize 2×, melodic step-edit pitch, CC bank acceleration.
- **Step-entry velocity rule unified** across drum and melodic tracks.
- **Track-bank OLED returns to overview faster (~1s instead of ~4s).**
- **Recording CC automation no longer fights the knob.**
- **Drum repeats respond to pad pressure.**
- **Held CC step shows recorded value, not live knob value.**
- **Drum Shift+Delete+Jog popup reads "LANE PARAMS RESET".**
- **Alt-mode label "RvSt" renamed to "Rvrs".**
- **Perf View knob LEDs show looper state.** Touch toggles looper.
- **Sample tap in Session View is no-op (was incorrectly opening bake dialog).**

### Documentation
- **Full revision and reorganization of MANUAL.md.** Six parts, consolidated chapters, standardized terminology, verified all claims against source.

## [0.4.0] — 2026-05-15
### Fixes
- **Input Quantize / Step Grid Misalignment:** Drum recording now uses midpoint-rounding step windows; Input Quantize correctly rounds to the nearest step boundary across all live recording paths.

## [0.3.7] — 2026-05-14
### Fixes
- **Chord-press monitoring now plays every note.** Simultaneous pad presses no longer drop notes due to set_param coalescing. Live notes batch into a single payload per tick.
- **Drum chord recording lands in one DSP buffer.** Batched into single payload per tick instead of one entry per tick.
- **Drum recording inline-monitors via DSP.** Eliminates duplicate set_param collision on armed-track chord recordings.

## [0.3.6] — 2026-05-14
### Documentation
- **MANUAL.md crash disclaimers softened for Schwung v0.9.13.** External MIDI routing no longer crashes on current Schwung.

### Fixes
- **Drum clip switches keep polyrhythmic lanes in phase.** All launch sites anchor each lane's playhead to its expected position based on elapsed time.

### Features
- **Loop window set via Loop+step range gesture.** Hold Loop + hold a page step + tap another to set loop window. Non-destructive — notes outside window preserved.

### Performance / UX
- **ARP IN latch visual feedback.** Latched pad LEDs stay lit white; Arp chip inverts on OLED.
- **Loop clears latched ARP IN notes without dropping Ltch.**
- **Re-press a latched note to drop it (accumulate mode).**

## [0.3.5] — 2026-05-13
### Features
- **Shift+Step 3 — Edit Synth / Edit Slot shortcut.** One-press co-run entry for the active track's route type.
- **Swing applies to ARP IN, SEQ ARP, and drum repeats with transport stopped.** Live one-shot taps always bypass swing.

### Performance / UX
- **Note/Session button LED blinks during co-run** to advertise exit gesture.

### Fixes
- **Drum step + pad LEDs refresh when switching clips from Session View while stopped.**
- **Drum Rpt1/Rpt2 recording captures sub-step fires.** Multiple hits per step with InQ Off now recorded.
- **Hanging notes during ARP IN chord-changing with swing resolved.** Echoes and deferred offs get per-event swing scheduling.

## [0.3.0] — 2026-05-12
### Features
- **Euclidean rhythm knob (DRUM LANE K4).** Per-lane Bjorklund hit-count placer that diffs against existing hits.
- **Capture + scene-row button** snapshots current performance into a scene row.
- **Edit Slot... co-run** — hands OLED + jog to Schwung's chain editor (capability-gated to patched Schwung).
- **Edit Synth... co-run** — hands OLED + jog to Move's native device editor (capability-gated to patched Schwung).

### Performance / UX
- **Perf View knob LEDs show looper state; touch toggles looper.**
- **Unified step-entry velocity rule** across drum and melodic tracks.
- **Nudge knob folded onto Shift+K2.** Frees a knob slot on CLIP/DRUM LANE/ALL LANES.
- **Loop and Capture buttons have visible ambient lighting.**
- **Shift+jog in Session View steps active track.**
- **Various knob speed improvements** (Gate 4×, Quantize 2×, step-edit pitch).

### Fixes
- **Shift hint overlay drops on compound modifier press.**
- **Drum-lane step copy flashes source step.**
- **Hanging notes during fast polyphonic live play fixed.**
- **Step-entry velocity consistency** — tapping a step writes fixed vel 100 instead of inheriting stale pad velocity.
- **Shift+Step menu shortcuts target by label** instead of hardcoded indices.
- **MIDI DLY Lvl defaults to 127 on all drum lanes** (was 0 on tracks 1–7).
- **Panic sweeps all 16 MIDI channels on every active route.**

### Persistence
- UI sidecar v=4→v=6: adds per-track Euclidean counts, drumVelZoneArmed, and Schwung-slot assignment.

## [0.2.0] — 2026-05-11
### Features
- Loop+Play restarts playback from the visible page
- Perf Mode preset mods are individually toggleable; Latch is purely a mode switch
- Perf Mode OLED redesigned with active mod list and footer chips
- Top-row Perf pad LEDs are static (no flashing)

### Fixes
- Removed rec-arm count-in OLED takeover
- Melodic live-recording note-off step-array mirror uses correct rounding

### Performance / UX
- Action popup duration halved (~520ms)
- Step hold-to-save duration shortened (~750ms)

### Documentation
- MANUAL.md rewritten as comprehensive user guide
- Performance Mode appendix updated

## [0.1.0] — 2026-05-11

Initial public release.

### Features
- 8 tracks (melodic + drum), 16 clips per track, up to 256 steps per clip
- Per-clip effects chain: TARP, NOTE FX, HARMZ, MIDI DLY, SEQ ARP
- Bake — render the effects chain back into note data (multi-loop, wrap mode)
- Live recording with count-in pre-roll
- 32-lane drum tracks with per-lane loop length, effects, and note repeat
- Scale-aware everything: pitch random, harmonizer, delay, manual transposition
- Performance Mode: 24 mods × 16 snapshot slots, hold/lock/latch interaction
- 8 CC automation lanes per track, per-clip at 1/32 resolution
- Mute/solo with 16 snapshot slots
- Copy/paste for notes, steps, clips, and scenes
- Per-track MIDI channel and routing (Move · Schwung · External)
- Suspend/resume — background playback while browsing Move's native UI
- Set state inheritance — duplicate a Move set, inherit dAVEBOx state by name

### Known limitations
- External MIDI input into Move-routed tracks crashes Move
- Suspending while a Move-routed drum track is playing can crash Move
- Volume knob briefly interrupts MIDI output
- Powering Move off from within dAVEBOx causes a brief hang
