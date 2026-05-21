# dAVEBOx Upcoming Tasks

## Bugs to fix

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
7. **State snapshots / multi-save per session.** Global Menu items "Save snapshot" + "Recall state". Current auto-save behavior unchanged; snapshots are explicit and independent. On state-version bump, dAVEBOx load shows confirm dialog before wiping incompatible snapshots: "dAVEBOx updated — Incompatible session snapshots will be deleted. Proceed? [Yes/No]" (No is default).
9. **MIDI clock sync**
10. **Track conversion** (`tN_convert_to_drum`/`tN_convert_to_melodic`): Global Menu Mode item or dedicated dialog.

## 1.0 fixes/tweaks — remaining (carried over from the May 2026 batch)

### Bugs

- **Power button doesn't work within dAVEBOx.** Native Move power gesture is swallowed; need to either pass through or implement.
- **Volume knob (master) inconsistent speed + pauses sequencer.** Turning the master vol knob causes MIDI output to drop momentarily. Suspect Schwung host running master-knob acceleration despite `claims_master_knob: true`. Diagnose shim/host interaction.
- **Shift+clip = focus-without-activate.** Companion to the focused-clip-active default (shipped 2026-05-19). Needs a JS-side "focused vs DSP-active" split so edits target the focused clip even when DSP is still playing the prior one. Deferred — requires deeper refactor.
- **Co-run step-button shortcut should only fire in Track View.** Shift+Step3 (Edit Slot / Edit Synth co-run entry) currently fires in Session View too. Restrict to Track View — Session View Shift+step should pass through to the existing menu shortcuts only.
- **Live merge entry needs a brief OLED popup** describing the operation (decently long duration). Right now arming a multi-track merge has no explanatory feedback; new users won't know what's happening.
- **Knob position alignment** of similar params across banks/track types. Example: InQ value should sit at the same knob angle across all places it appears (ALL LANES, CLIP K6 melodic, etc.).
- **Native Move knob hang.** Turning a Move-native knob from within dAVEBOx (or in native co-run when controlling Move-native) hangs the dAVEBOx sequencer MIDI output. Suspect shared SPI path. Diagnose.

### Features

- **Schwung: module favorites in picker.** Shift + jog in the picker favorites a module, which moves it to the top of the module list. (Schwung-side feature.)
- **Reclaim Back button** from Schwung suspend — currently Back triggers suspend; offer a different gesture for suspend so dAVEBOx can use Back.
- **Drum lane repeats respond to pad pressure** — pad pressure continuously sets velocity of incoming repeats.
- **Enable pad pressure broadly** beyond drum repeats — investigate which features should be pressure-aware.
- **Ableton Live set export** — MIDI data + clip structure. All clips with pfx baked down (4x loop bake for random pfx, wrap-around for delay).
- **All-track clip merge.**
- **Live merge post-stop placement dialog.** When live merge stops, OLED shows "Tap pad to place merged clip" with a Cancel option. Tapping a clip pad replaces that clip with the merged clip. Live merge no longer auto-populates a destination.
- **Move bake to Capture button; live merge to Sample (no Shift).** Check for gesture conflicts.
- **Arp interval/step bank** (new feature). Knob bank where each knob controls the relative pitch of the corresponding arp step (±7 semitones/intervals, scale-aware). Access: press jog while on SEQ ARP or TARP bank in track view. Display persistent until jog turn/click. Visual similar to repeat groove; step-mode-muted steps (K5) hidden, mirroring repeat-groove + gate-mask. Step pad mode is displayed persistently while on this bank; the current K5-touch-into-step-pad-mode gesture on SEQ ARP/TARP is removed.

### Schwung-side (fork) features

- **Two effect sends with returns** added to the chain menu. Each send hosts up to 3 Schwung effects in series.
- **Module favorites in picker** (mirrored from Features list above — Schwung-side).

## Open investigations

- **dAVEBOx co-run vs TB-3PO co-run** — characterize differences; identify anything TB-3PO does cleaner that we should adopt.

## Post-1.0 investigations

- **Song mode — linear arrangement recording and editing.** One long "song clip" per track (no pfx, independent of the 16-clip grid) that captures all tracks' output via an all-track live merge variant. Primary constraint is state persistence: the text-format `state_buf[65536]` can't hold long-form song data — needs a binary format or a separate song-state file. Memory is fine (~200 KB for 8 lean clips at 2K notes each). Step arrays should be dropped for song clips (note-centric model only). UI is the biggest scope item: a linear horizontal arrangement view is a new mode entirely.

- **Move-native state readback via Sentry breadcrumbs.** Sentry SDK writes per-process breadcrumb files under `/data/UserData/Sentry/<uuid>.run/__sentry-breadcrumb{1,2}` (MessagePack ring buffer). MoveOriginal emits `Set MainMode (new state: note|session|songOverview)`, `Set ShiftMode`, `Push/Pop MomentaryMode`, `Song opened (UUID ...)` — a real read-only side channel into Move-native firmware state. Would let co-run auto-detect exit, mirror Shift state, and sync set loads. Investigation parked with full vocabulary + caveats in `notes/sentry-breadcrumb-state-readback.md`. Next step: live capture during a co-run handoff while exercising Note/Session/device-edit/preset-browser, then prototype a msgpack parser.

Source: `~/Downloads/local todo.txt` (user-maintained). When user adds new items there, they should be mirrored here.
