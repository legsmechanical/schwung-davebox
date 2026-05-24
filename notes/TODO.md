# dAVEBOx Upcoming Tasks

## Bugs to fix

3. **Scale-aware key/scale changes** — transpose all clip notes on Key/Scale change. Design TBD.
7. ~~**State snapshots / multi-save per session.**~~ **SHIPPED 2026-05-24** (main `9e41f6b`). Global Menu **Save state** + **Load state**; up to 16 timestamped snapshots per set; explicit and independent of auto-save; incompatible-version snapshots offered for wipe when the Load list opens. See `docs/superpowers/specs/2026-05-24-multi-snapshot-states-design.md`.
9. **MIDI clock sync**

## 1.0 fixes/tweaks — remaining (carried over from the May 2026 batch)

### Bugs

- **Power button doesn't work within dAVEBOx.** Native Move power gesture is swallowed; need to either pass through or implement.
- ~~**Volume knob (master) inconsistent speed + pauses sequencer.**~~ FIXED 2026-05-21 (main `7398983`). Root cause was *not* host acceleration — `claims_master_knob:true` forwards the full CC 79 detent stream to dAVEBOx, which spent cycles dispatching it against the sequencer/MIDI path. Fix: drop CC 79 + volume-touch note 8 at the top of `onMidiMessageInternal`; volume stays Move-native via `button_passthrough[79]`.
- **Shift+clip = focus-without-activate.** Companion to the focused-clip-active default (shipped 2026-05-19). Needs a JS-side "focused vs DSP-active" split so edits target the focused clip even when DSP is still playing the prior one. Deferred — requires deeper refactor.
- **Knob position alignment** of similar params across banks/track types. Example: InQ value should sit at the same knob angle across all places it appears (ALL LANES, CLIP K6 melodic, etc.).
- **Move-native knob (CC 71-78) stutters sequencer in co-run.** [FORK-SIDE FIX] Turning a device-edit knob during Move-native co-run stutters dAVEBOx's sequencer + pauses MIDI-out. **Diagnosed 2026-05-21:** root cause is SPI frame-budget overrun (~900µs after the ~2ms ioctl). dAVEBOx's `overtake_dsp_gen->render_block` runs every frame in *both* suspend and co-run (gated only on the instance existing, `schwung_shim.c:1718`), so dAVEBOx is not the variable — verified: suspend + sequencer playing + Move knobs = no hiccup. The variable is MoveOriginal's per-knob work: in co-run you're on the device-edit page, so each CC 71-78 detent does a synth-param write **+ knob-ring OLED redraw** on its FIFO-70 threads, spiking the frame past budget → late SPI transfer → stutter/MIDI jitter. In suspend the lighter Move screen makes the redraw cheaper. Ruled out as *non*-fixes (empirically): CC 71-78 never reach dAVEBOx JS in co-run (shim filters them, `schwung_shim.c:6897`); suppressing all dAVEBOx LED output in co-run changed nothing. The redraw is inside stock Move firmware (can't change). **Only viable lever (fork shim, co-run path):** coalesce rapid CC 71-78 detents per frame before they reach Move — accumulate the relative-encoder deltas and emit ≤1 combined CC per knob per frame (value carries the summed delta, so full knob travel is preserved, just fewer Move redraws). Verify on-device first that Move honors a >1 delta in a single CC. Companion to the volume-knob fix (main `7398983`), which dropped CC 79 JS-side because dAVEBOx (not Move) was processing it there.

### Features

- **Schwung: module favorites in picker.** Shift + jog in the picker favorites a module, which moves it to the top of the module list. (Schwung-side feature.)
- **Reclaim Back button** from Schwung suspend — currently Back triggers suspend; offer a different gesture for suspend so dAVEBOx can use Back.
- **Drum lane repeats respond to pad pressure** — pad pressure continuously sets velocity of incoming repeats.
- **Enable pad pressure broadly** beyond drum repeats — investigate which features should be pressure-aware.
- **Ableton Live set export** — MIDI data + clip structure. All clips with pfx baked down (4x loop bake for random pfx, wrap-around for delay). **Format feasibility CONFIRMED 2026-05-23** (`notes/ableton-export-bundle.md`): emit a Move-style `.ablbundle` (Song.abl at zip root + `Samples/`), which desktop Live opens (8×16 verified) and converts instruments natively → user saves as `.als`. Can carry over the mapped Move track presets/samples/colors/names. Every track MUST have an instrument (empty `devices` → "Document invariant violation"). Remaining: on-device zip, sample-ref mechanics, default instrument for unmapped tracks, MIDI/clip authoring + pfx bake.
- **Mono param on CLIP param bank.** New on/off param in the clip parameter bank. When ON, every note-on triggers a note-off on any previously-playing note(s) on that track — monophonic voicing (last-note priority). When OFF, polyphonic (current behavior). Per-clip.

### LED polish

- **Shift+pad track-select shortcuts should blink the dim/bright color of their corresponding track.** The Shift+pad track-select shortcut LEDs should blink between dim and bright of that track's color (instead of a static/generic color).
- **Co-run drum pad LED colors.** While in Move co-run on a drum track: an active pad = **dim** track color; an active pad that has data on its lane = **bright** track color.

### Schwung-side (fork) features

- **Two effect sends with returns** added to the chain menu. Each send hosts up to 3 Schwung effects in series.
- **Module favorites in picker** (mirrored from Features list above — Schwung-side).

## Open investigations

- **dAVEBOx co-run vs TB-3PO co-run** — characterize differences; identify anything TB-3PO does cleaner that we should adopt.

## Post-1.0 investigations

- **Song mode — linear arrangement recording and editing.** One long "song clip" per track (no pfx, independent of the 16-clip grid) that captures all tracks' output via an all-track live merge variant. Primary constraint is state persistence: the text-format `state_buf[65536]` can't hold long-form song data — needs a binary format or a separate song-state file. Memory is fine (~200 KB for 8 lean clips at 2K notes each). Step arrays should be dropped for song clips (note-centric model only). UI is the biggest scope item: a linear horizontal arrangement view is a new mode entirely.

- ~~**Move-native state readback via Sentry breadcrumbs.**~~ **INVESTIGATED 2026-05-23 → PARKED, do not build.** Live + narrated co-run captures showed the channel is readable (`strings`-parseable, ableton-readable, MoveOriginal stays alive during co-run) BUT the motivating use-case fails: **co-run exit emits zero breadcrumbs** (#1 auto-exit detection is a confirmed negative), and the only spec'd exit (Note button) is already handled by dAVEBOx's shim input. Ring rotation b1→b2 is real (would need both-half handling). Set-load sync (#4) has a cleaner non-Sentry channel — plain `/data/UserData/settings/Settings.json` `currentSongIndex` + per-set xattrs (per `szydek/move-over`). Full results + vocabulary in `notes/sentry-breadcrumb-state-readback.md`.

Source: `~/Downloads/local todo.txt` (user-maintained). When user adds new items there, they should be mirrored here.
