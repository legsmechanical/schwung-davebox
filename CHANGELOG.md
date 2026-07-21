# Changelog

All notable changes to dAVEBOx are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com). Add entries to
`[Unreleased]` as user-facing changes land; `scripts/cut_release.sh` finalizes
the section into a versioned heading at release time.

## [Unreleased]

## [1.0-beta.7] — 2026-07-20
### Features
- **Turning a parameter knob now pops up a big, easy-to-read view of it.** On the track-view parameter pages and in the step editor, turning any knob opens a large centred read-out of just that parameter — a zoomed copy of its own widget (a big arc knob, or the value) — so you can read what you're changing at a glance. Parameters that pick from a set of values (Delay Rate, Arp Style, Resolution, Note Offset, the harmonies, Ratchet, and the like) instead show a scrolling list of the choices with the current one highlighted and a scrollbar when they don't all fit. The pop-up appears only once you actually turn the knob (a bare touch still just highlights the name) and stays up until you release, and the step editor's Octave/Note knobs show the resulting note name big. Everything uses the same box and the header typeface for a consistent look. (The step editor's Note and Octave knobs also swapped positions — K1 is Note, K2 is Octave.)
- **The Back button now navigates instead of just leaving.** dAVEBOx now handles Back itself: a tap backs out one level at a time — it cancels an open dialog or picker, closes the menu, exits a locked Performance Mode, and in Track View drops out of a bank's alt-view and then steps back to the track's default bank (Clip / Drum Lane / Conduct). A Back tap **never suspends** — at the home screens (Session overview, or Track View's default bank) it simply does nothing. To suspend dAVEBOx (leave it running in the background), **hold Back** for about half a second, or pick **Suspend session** from the menu (just above Quit). The Back button's LED lights whenever a tap will back out of something, and stays dark where a tap does nothing, so you can see at a glance when it's live. The menu button now stays steady-lit while the menu is open (it no longer blinks, since Back exits the menu too). Shift + Back still fully exits to Schwung. (Requires a current Schwung host build; on older hosts Back simply suspends as before.)
- **Live Merge now confirms before it starts, has a count-in, and starts from a stopped transport.** Shift + Record no longer begins a Live Merge immediately — it raises a **notice** ("Rec to start, Back to cancel"), so an accidental Shift + Record can't wipe out a take. The notice is modal (every control but Record and Back is ignored while it's up) and the **Record button flashes** to show it's waiting. Press **Record** to begin (Back cancels), and only when the transport is stopped (it's ignored while playing). Starting gives you a **1-bar count-in** (metronome + flashing step buttons), then plays and captures a clean take from the top of the pattern — the single-track (Track View) and all-8-tracks (Session View) modes both work this way. Press **Record** during the count-in to abort, or during capture to stop (its dialog says "Rec to stop"). Once a take is captured, **Back** cancels the placement step (Record no longer does), and picking a destination now shows a brief "Placing merged…" message while dAVEBOx writes the clips, instead of appearing to hang on the normal screen.
- **Capture — retrospective recording, like Move's own Capture button.** dAVEBOx now always listens: pads you play (and FX-knob moves) while not recording are silently buffered, and the Capture button's LED lights up when something is waiting. Tap Capture to keep it: with the transport running, the buffered notes and automation overdub into the focused clip exactly as played (no quantizing); with the transport stopped in a fresh empty session, your first note becomes the start of a new take — dAVEBOx estimates the tempo from your playing, opens a **tempo chooser** (wheel to audition the candidate tempos while it plays, click to keep; a note strip with a moving playhead shows the alignment), sizes the clip to whole bars, and plays it back immediately. Once the session has clips, capture-from-stop steps aside and you overdub during playback instead. Works on melodic and drum tracks. Shift + Capture discards the buffered input. The stopped-capture **tempo chooser** now detects tempo by fitting your playing to a musical grid (much more reliable than before), offers up to eight candidate tempos to wheel through, and shows a bar view with a moving playhead so you can see where the bar lines and loop point fall. The Tap Tempo screen shares the same tempo display for consistency. You can also capture into a session that already has clips: instead of changing the set's tempo, your take is stretched or squeezed to fit a chosen number of bars at the existing tempo (the adjustment screen's wheel picks the bar length). It lands in the focused clip if it's empty, otherwise you pick an empty clip to drop it on.
- **Clearer button roles: Capture captures, Sample bakes, Shift + Record runs Live Merge.** The Capture button is now dedicated to retrospective capture. Bake (clip bake in Track View, scene-bake picker in Session View) moved to the Sample button — its old bare-tap slot; Sample + scene launcher still goes directly to scene bake. Live Merge moved from Sample to **Shift + Record** and now works from either view; its armed/capturing state shows on the Record button LED (red = armed, green = capturing), and the Record LED blinks while Shift is held to hint at it. In Track View, Shift + Record runs a **single-track merge**: only the active track's output is captured, and when you stop, dAVEBOx switches to Session View and blinks the merge track's empty clips so you can tap where to save the take — a quick way to resample one track's performance into a new clip. Session View keeps the classic all-8-tracks-to-a-scene-row flow, whose placement dialog is cancelled with **Back**. The scene-bake picker's "any other button cancels" now actually works, and the silent drum-lane select gesture (formerly Capture + lane pad) has been retired for now while it finds a new home.
- **Browser clips now launch like hardware pads.** Clicking a clip in the browser session grid launches it (respecting launch quantize) and the editor follows it — the same gesture as tapping a session pad on the device. Alt/Shift-click selects a clip for viewing without launching it. (Double-click-to-launch is gone.)
- **Per-clip menu in the browser session grid.** Hovering a clip shows a ≡ menu with Duplicate (into the track's next empty slot), Copy, Cut (marks the clip; pasting moves it), Paste (between same-type tracks), and Delete.
- **Drag drum hits between lanes.** In the browser drum roll, dragging a hit vertically moves it to another lane, keeping its velocity, gate, and timing.
- **Resizable velocity and automation lanes with value readouts.** Drag a lane's top edge to resize it (remembered between sessions); each lane now has a value axis on the left with reference lines, and hovering shows the exact value under the cursor (or the nearest note/point's value).
- **The browser grid follows the Snap setting.** The piano-roll's fine grid lines now draw at the toolbar Snap spacing, so the grid always shows where notes will land; grid lines are also much more distinct (three-tier step/beat/bar contrast), and click-to-add places the note in the cell under the pointer instead of sometimes the next one.
- **Steadier browser playhead.** The playhead now runs on a local clock synchronized to the device's own timestamps, so it stays smooth and on-tempo even over a congested WiFi link, stops promptly when transport stops, and no longer jumps or rubber-bands. The drum view's playhead follows the displayed lane's actual position.
- **Snappier browser sync while editing.** Turning FX knobs or making rapid edits in the browser no longer floods the connection (which could stall clip switching and transport for many seconds); clip selection and transport stay responsive during heavy editing and during playback.
- **Browser edits no longer get lost, and edits sync between device and browser much faster.** Destructive clip operations from the browser (beat stretch, clock shift, legato, nudge, note deletes) could silently vanish under load — they now travel a lossless path and apply reliably. Content changes made on the device or in the browser show up on the other side promptly (including during playback), and none of it can make the sequencer's audio timing hitch (paired with a Schwung host update; requires the matching host build).
- **Step editors join the new look.** Holding a step (drum or melodic) now shows the same graphical language as the parameter pages: a `STEP N` header that swaps to the parameter name while turning, arc knobs for Velocity/Probability, a center-tick knob for Nudge, option squares for Iteration and Ratchet (with the scrolling option list while turning — all 36 iteration cycles browsable), and the melodic Oct/Note pair merged into one note box.
- **Unified knob response across every parameter.** Knobs now follow one of three consistent feels instead of ~20 hand-tuned speeds: **continuous** values (velocities, percentages, offsets, CC values, nudges, step pitch…) always move ±1 when turned slowly — exact values are dialable everywhere, including params that previously skipped odd numbers — and accelerate smoothly when turned fast; **option pickers** (resolutions, rates, styles, octaves, note length…) step at one fixed, predictable pace with no acceleration; and **deliberate** controls (toggles, Beat Stretch, Legato…) keep a heavier throw so an accidental brush can't flip or fire them.
- **Untouched velocity steps pass playing dynamics through ("Thru").** In both the Repeat Groove and the arp step editors, every step now defaults to **Thru**: it fires at the incoming velocity (your pad hit / played note), exactly like before velocity steps existed. Dialing a step to a number **locks** it at that absolute velocity — so you can mix locked accent steps with dynamic ones in the same pattern. Thru sits one click past 127 on the knobs and draws as a full-height dithered bar; locked steps draw solid. Delete + pad resets an arp step to Thru. Old saved patterns map cleanly (an arp step at full level, or a groove step at 100%, was already "play the incoming velocity" — that's Thru).
- **Arp step velocities are now absolute — with a fine-adjust Shift page in the step editors.** SEQ ARP and LIVE ARP step patterns now store an exact velocity per step (0–127; 0 = step off) instead of a 4-level scale of the incoming note: in Mute/Step modes an accent pattern sounds the same however hard you play (Steps Off still passes live dynamics through). The pad grid keeps working as the coarse editor — its four rows now write velocities 32/64/96/127 — and holding **Shift** in the step editor turns the knobs into fine per-step velocity control (5–127), shown as a bar row ("Step Vel", `Velocity: N` while turning). Pad LEDs always display the nearest coarse level for the true value, so pads and knobs stay in sync. Old saved patterns migrate automatically. Both step-editor pages also now gray out steps beyond the pattern loop length.
- **Widgets now reflect what each parameter actually does.** One-shot action knobs (Beat Stretch, Clock Shift/Nudge) draw chevrons on their squares' borders to signal "turn either way to act"; the destructive Legato action shows a single filled arrow; Playback Direction shows real arrows (forward, backward, and paired arrows for the two ping-pong modes); and small stepped ranges (Resolution, Input Quantize, Note Length, octaves, Arp Steps…) show a selection dot-strip so you can see where you are in the range at a glance. Also fixed on the drum NOTE FX page: the note-selector box no longer draws over the Note Length option list, and the redundant note readout under the box is gone. The automation overview now uses the same pixel font as the rest of the UI.
- **Bank renames and header consistency.** The ARP IN bank is now **LIVE ARP** and the AUTO bank is now **AUTOMATION**, better describing what they do. All bank headers now share the same filled black-on-white style (LIVE ARP, AUTOMATION, and REPEAT GROOVE previously drew inverted), and the automation header's Sch/AT/CC data badges were removed.
- **Repeat Groove steps now use absolute velocity.** Each groove step's knob sets the exact velocity (1–127) the repeat fires at, instead of scaling the held pad's velocity by a percentage — so a groove sounds the same however hard you hit the pad. Existing saved grooves carry over (old percentage values are clamped into the new range; the default is unchanged). The bank's display is also reworked: all 8 steps show as a single row of velocity bars (filled = gate on, outlined = gated off) with the step number under each bar; the jog-click page shows the same row as ± timing-nudge bars around a center line.
- **Redesigned track-view parameter pages.** The knob bank pages now use the Schwung canvaskit look shared with the OB-Xd and Palette editors: graphical widgets per knob (arc knobs, center-tick knobs for ± values, toggle bars, framed option/value squares), and a chunky pixel-font header with a page-indicator line beneath it (one segment per bank, the active one gently flashing). Turning a knob inverts the header to show the parameter's full name while the label under the widget shows its live value; turning a multi-option knob (like Delay Rate or Arp Style) pops up a scrolling list of all its options. Applies to all melodic, drum, and Conductor bank pages.

### Fixes
- **Multi-line pop-ups no longer cut off their last lines.** Info pop-ups with three or four lines (e.g. the Live Merge count-in notice, or the "clock didn't start" message) were silently dropping everything past the second line, so instructions like "Rec to stop" never appeared. They now show in full.
- **Dialogs and pop-ups look and behave consistently.** A pass over every confirm dialog, notice, and chooser: Yes/No buttons are always in the same place (No left, Yes right — Transpose and the version-mismatch prompt were reversed), headers and button labels use consistent capitalization, every "wizard" screen (Bake Scene, Live Merge, Capture placement, etc.) now has the same title bar as the rest, and they all cancel with **Back** (a couple previously said "Rec cancels" / "any other button cancels"). Long snapshot names no longer overflow the Load/Overwrite prompts, and several messages were reworded to be clearer and to point you at the quickest fix (e.g. the "not Schwung-routed" notice now tells you to set the track route).
- **Touching a knob to orient no longer springs a picker open over the other parameters.** On the track-view bank pages you can rest a finger on a knob to see what it controls — the header highlights that parameter's name — so you can tap across the knobs to map them to the on-screen layout. But for multi-choice knobs (Random Algo, Gate, Delay Rate…) the scrolling option-list picker popped open on the lightest touch, covering the neighbouring params and defeating the whole point. The picker now appears only once you actually **turn** the knob, and then stays up until you **lift your finger** (it no longer fades while you're still holding).
- **NOTE FX and MIDI Delay pitch-random mode (Pure/Gaus/Walk) now sticks.** Changing the pitch-random algorithm (Alt + K8 on the NOTE FX or DELAY bank) didn't persist — it snapped back to the default as soon as you switched clips or reloaded the set, because the change never reached the sequencer engine. It now saves and restores with the clip like every other NOTE FX / DELAY setting. (The *amount* knob was unaffected; only the algorithm selector had the bug.)
- **dAVEBOx always opens in Session View on a fresh start.** Loading dAVEBOx cold (not returning from the background) now always lands on the Session View overview, regardless of which view the set was last left in. Coming back from a suspend still keeps you exactly where you were.
- **Clearing a clip now frees it up to record adaptively again.** Clearing a clip's notes (Delete + side clip button) now also resets the clip's length and loop window, so your next recording grows the clip to fit what you play instead of being locked to the old length. The clip's resolution and its NOTE FX / HARMONY / DELAY / ARP settings are kept (a Hard Reset still wipes those too). Applies to melodic and drum clips.
- **You can now cut a step, not just copy it.** Holding **Shift + Copy** and tapping a source step then a destination step *moves* the step (pastes it and clears the source), matching how Cut already worked for clips, rows, and drum lanes. Plain Copy + step still copies. Works on melodic and drum-lane steps.
- **Beat Stretch no longer knocks a clip out of sync during playback.** Stretching or compressing a clip while the transport was running left its playhead where it was, so the resized clip's loop drifted out of phase with the beat and the other tracks. The playhead is now re-anchored to the master clock on every stretch, keeping the clip locked to the bar. Applies to melodic clips and drum lanes (single lane and all-lanes).
- **Capture's tempo chooser now suggests the full 40–250 BPM range.** The stopped-capture tempo detector was capped at 60–200 BPM, so a fast take couldn't be offered at its true tempo (it folded to half-time) and slow takes stopped at 60. The suggestion range now matches the manual BPM control (40–250), so Capture can propose any tempo you could also set by hand.
- **NOTE FX Octave, Note Offset, and other semitone params now show their exact value on the widget.** The NOTE FX Octave knob showed its shift only while you were turning it; it now sits in a value box that always displays the current octave. Note Offset gets the same value box (mirroring Octave), and — for consistency — so do the other small discrete semitone params that used to hide their value in an arc knob: the three HARMONY intervals, DELAY Pitch Feedback, and both Pitch Random knobs (which read `OFF` at 0). Wide continuous knobs (velocities, levels) keep their arc.
- **The Conductor RESPONDER page now shows each track's responder state as a toggle bar.** Instead of an `ON`/`off` value box, each track's cell is a filled/empty toggle bar (the same widget the DELAY Retrig control uses), so you can read at a glance which tracks respond to the Conductor. Drum tracks (which never respond) and the Conductor's own cell stay blank.
- **Copying or clearing a scene row no longer freezes the device for several seconds.** On-device copy/cut/clear of a whole scene row (and, more subtly, single-clip and drum-clip copy/clear) could lock up dAVEBOx for ~4 seconds while it needlessly re-read the entire set back from the sequencer — an edit it had already applied. These edits now update instantly; the browser editor still sees them just as promptly as before.
- **Step-edit strip now selects the step you clicked — off-grid notes too.** In the browser, clicking a step to edit its per-step settings (iteration, ratchet, nudge) worked on some steps but not others: a note recorded off the grid (Input Quantize off), nudged, or landing between steps was filed one step earlier than the device files it, so the step the note *appeared* in wouldn't select while its neighbour would. The browser now maps notes to their nearest step exactly like the hardware, so what you see, the highlight, and what selects all line up. (Empty steps remain non-selectable, as before.)
- **Browser multi-note edits no longer silently revert.** Adjusting several selected notes at once (shift velocity, nudge, move, or delete the whole selection) could apply to only one note on the hardware — the rest snapped back on the next refresh. A multi-selection now changes together in a single atomic edit.
- **On-device and second-screen edits now show up in the browser promptly.** A large set of edits — CC automation, step trig conditions, loop points, conductor responders, clip/lane clears, drum lane mute/solo/length/direction/resolution/stretch/shift/nudge, undo/redo, clip and row copy/cut, plus key/scale/swing/launch-quantize, track mute/solo/channel/route, clip launch, Clear All Mutes, and snapshot recall — weren't flagging the browser that anything changed, so it could show stale data for up to ~30 s (or until an unrelated edit refreshed it). They now update the browser right away.
- **Very dense clips no longer blank the browser editor — and now say so.** A drum clip packed with enough hits, or a heavily-automated CC lane, could overflow the editor's data snapshot and produce data the browser silently rejected — leaving the editor stuck/blank for that clip until it was thinned on the device. The snapshot now always stays valid (showing as many notes as fit), so the editor keeps working, and a small "clip too dense — some notes hidden" badge appears in the editor header when this happens so you know some content isn't shown.
- **Browser edits no longer flicker back for a frame.** An edit could briefly revert when a device refresh that was already in flight landed just after it — the on-screen change is now protected until the device has caught up.
- **Dragging a clip in the browser session grid is smoother.** A refresh landing mid-drag could rebuild the grid under your cursor and drop the drag; refreshes now hold off until the drag finishes.
- **Drum lane nudge now persists.** Nudging a drum lane's notes wasn't marked to be saved, so it could be lost on reload. It now persists.
- **Bake now matches live playback more faithfully (parity audit).** A systematic audit of the Bake process against live playback found and fixed five divergences: SEQ ARP's Retrigger setting is now honored when baking (it was always treated as on, restarting the pattern at every note); knob automation keeps its cadence when baking with 2 or 4 loops (lanes that inherited the clip length would have stretched across the longer baked clip); scale-aware delay pitch-feedback now transposes harmony echoes by the same interval as the main note, as live playback does; a re-tuned drum lane's notes are no longer dropped by a whole-kit bake; and two smaller edge cases (zero gate-time echoes, transposing while baking). Remaining known limits: baking freezes one particular pass of any random effects, and aftertouch automation holds its last value across the extended portion of a multi-loop bake.
- **Switching tracks while holding an external MIDI note no longer leaves the note stuck on Move.** Holding a key on a Move-routed track and switching the active track stranded the sounding Move voice — its release could no longer reach the right channel, so the note rang until stop/panic. The held note is now released at the moment you switch away from its track (a predictable cut, matching how held co-run drum pads behave).
- **External MIDI played during the record count-in now lands on the one.** Notes played on an external keyboard during the count-in were dropped entirely — playing "into" the downbeat recorded nothing. They now behave like the pads: presses in the last eighth-note of the count-in are captured and placed exactly at the loop start; earlier warm-up presses are still ignored.
- **External MIDI now records again — on Move-routed, Schwung-routed, and External-routed tracks.** Playing an external MIDI keyboard while armed had stopped recording into clips: on a Move-routed track the notes were heard (Move played them) but never captured, and on a Schwung-routed track they were neither monitored nor recorded. Both are fixed. Recorded notes land at the UI update rate rather than sample-accurate timing (a future update will tighten Move-routed timing), and the sequencer's own notes echoing back are not mistaken for keyboard input. Notes held while you switch the active track still release and record on the track they were played on.
- **A Conductor track's header bank strip now shows the right number of positions.** The position strip above the pads (used to jog between banks) showed 7 dots for a Conductor track, but a Conductor only actually has 5 banks (Conduct, Note FX, Responder, Octave, When) — so the strip's highlighted position could drift out of sync with what jogging actually selected. It now always shows and tracks the correct 5.
- **Fixed a stuck note when holding two Move-native drum pads at once during co-run.** In Move-native co-run on a drum track, holding a second drum pad while the first was still held could leave the first pad's note stuck sounding on Move — releasing either pad no longer stopped the right one. Each held pad is now tracked and released independently.
- **Fixed a crash when copying or launching a drum clip that hadn't been set up yet.** Copying a drum clip into an uninitialized slot, or launching one, could crash the unit if the target drum clip's contents had never been created. The affected step now safely does nothing instead.
- **Fixed crashes and display glitches around copying, cutting, and undoing drum clips.** Copying an empty scene row over a drum clip, or undoing a drum-clip edit back to an empty state, could quietly discard that clip's storage — after which pressing a pad on it could crash the unit, and copying into it would silently do nothing while the grid still showed it as full. Drum clips now stay in place (emptied rather than discarded), so the pad grid always matches the actual content and the crash is gone. A pad press on a drum clip that isn't ready yet is also now ignored safely as a backstop.
- **Fixed a crash when a performance modifier was toggled on over an empty loop.** With the MIDI looper running over a loop cycle that held no note-ons (an empty capture, or only note-offs), toggling a pitch-reordering performance modifier like Shuffle could crash the unit. The modifier now safely does nothing when there are no notes to reorder.
- **Live-recording into an empty melodic clip no longer freezes the unit.** While recording an adaptive take (empty clip growing as you play), the OLED, LEDs, and all inputs could freeze for ~4 seconds at every page-growth and again when disarming record — playback kept running. The clip-grow bookkeeping was misread as a remote-browser edit, triggering a very expensive full re-read of the whole session. Recording now stays fully responsive; browser piano-roll edits still refresh the device as before.
- **Editing in the browser no longer freezes the hardware for ~4 seconds.** Every browser piano-roll edit — and some on-device tweaks like play-effect knobs from the automation bank — used to freeze the OLED, LEDs, and inputs for ~4 seconds while the device re-read the entire session from scratch. The device now re-reads only the clip you actually changed, so edits refresh near-instantly and the hardware stays responsive throughout.
- **Remote clip-length edits now persist.** Changing a clip's length from the browser wasn't marked as a change to save, so the new length could be lost on the next reload unless another edit happened to save first. It now persists reliably.
- **Releasing a held pad during a modal gesture (Shift shortcuts, session view, knob touch) no longer leaves the note hanging.** If you were holding a pad and then started a modal gesture, letting go of the pad could leave its note sounding until the next stop or panic. Held notes now always release on pad-up.
- **Replacing a step's notes no longer inherits the old note's off-grid timing.** Editing a step's notes (chord entry, remote-UI edits) could leave the new notes carrying the replaced note's sub-step timing offset, making them sound slightly early or late. New notes now land exactly on the grid.
- **Internal hardening.** Malformed clip-index parameters from the remote-UI write path are now rejected instead of corrupting memory; a few internal queues are cleared more defensively at the record count-in downbeat and at first-run setup; the performance-mod popup duration was recalibrated like the other timings.
- **Knob LEDs refresh correctly when leaving the Schwung chain editor.** After exiting a Schwung chain-edit co-run, the knob ring LEDs kept the editor's colors until you turned a knob; they now repaint immediately on exit.
- **Hold gestures and timed flashes recalibrated to the device's real speed.** Several UI timings were tuned to a mistaken internal clock rate and ran about twice as long as intended: holding Note/Session needed ~425 ms instead of ~200 ms (so momentary session peeks often latched instead of reverting), the count-in beat flash blinked at half rate with the metronome off, and a few notices/highlights lingered ~2× too long. The record count-in flash also assumed 120 BPM regardless of the set tempo; it now follows the actual tempo.
- **Saved performance presets no longer vanish on reload.** Custom perf presets (slots 9–16) were silently lost when the module reloaded unless a preset slot happened to be active at save time. They now always survive reloads and set switches.
- **Holding a drum step to inspect it no longer resets its velocity to 100.** Holding an occupied drum step to look at its Leng/Vel values and releasing without turning a knob silently rewrote the step's velocity to the default 100. The step's real values are now read correctly during the hold and are preserved on release.
- **Fixed Ableton export (.ablbundle) — it was broken end-to-end.** Confirming an export threw an internal error before anything was written, and the "Apply Conductor?" YES/NO dialog could not be committed. Both were module-wiring bugs introduced with the split into JS modules; export works again.
- **Removed a debug logger that could cause audio glitches during fast co-run drumming.** An internal pad diagnostic wrote to a log file from the real-time audio thread on every unmapped pad hit; under heavy drumming in Move co-run this risked audible dropouts. The investigation it supported is closed (no genuine pad drops were ever found), so it has been removed.
- **Fixed stuck Move voices after a transport restart.** Restarting playback (or Loop+Play page restart) while a Move-routed track had pending scheduled note-offs — MIDI Delay echoes, swing-deferred notes — could leave those notes hanging on the Move synth until the next stop or panic. Queued note-offs now fire immediately on restart.
- **Fixed memory corruption when undoing or redoing a row cut.** Undo/redo after a scene-row cut could write past an internal buffer and corrupt the sequencer's state in memory. The bookkeeping string is now safely bounded.
- **Fixed a crash when placing a Live Merge onto a scene row with an empty drum clip.** Committing a Live Merge capture (choosing the destination scene row) on a drum track could crash the whole device if that row's drum clip slot was empty (e.g. after copying an empty clip there). The empty slot is now allocated on the spot and the merge lands normally.

### Features
- **Browser remote UI — edit your set from a phone, tablet, or laptop.** dAVEBOx now serves a full clip editor in a web browser (through the Schwung manager's Tool tab) over your network — no cables. It mirrors the loaded set and writes changes straight back to the hardware, so the two stay in sync.
- **Piano-roll editor (melodic + drum).** Session grid (tracks × scenes) with clip launch/copy/clear/duplicate; a unified, touch-first roll with Draw/Select/Erase tools, marquee multi-select, per-note velocity/gate/nudge, off-grid editing, a musical bars/beats ruler, a draggable loop brace, and a resolution/zoom-aware layout.
- **CC automation editor (melodic + drum).** A collapsible automation lane under the roll: pick one of the 8 CC lanes, draw/drag/erase breakpoints, set the resting value, assign CC# and type (CC / Schwung knob / Aftertouch), and set per-lane loop length.
- **Conductor track support.** The conductor track is badged in the session grid with responder dots on the tracks that follow it, plus a per-clip responder panel (on/off, octave, Now/Next, Lock) when the conductor track is selected.
- **Transport + live playhead.** Start/stop the transport from the browser; a smooth playhead glides in time with the hardware.
- **Per-track controls on the header.** A ☰ menu on each track header opens Route (Schwung / Move / External) + MIDI channel; click a header to mute, right-click to solo (with live mute/solo badges).
- **Edge zoom bars** on the roll — drag the top bar to zoom horizontally, the left bar to zoom vertically (the on-screen H/V buttons still work too).

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
