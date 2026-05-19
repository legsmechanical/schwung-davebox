# Parked: drum→melodic Mode flip + Clear Session pad_mode drift

**Status:** PARKED 2026-05-19. Hang half shipped on `1.0-tweaks`; mode-flip drop + Clear Session drift remain unfixed.

## What the user sees

1. **Ghost vel-zone after Mode flip.** Track in Drums mode, press a left-half lane pad (sets `active_drum_lane=N`), Global Menu → Mode → Keys. LEDs change to the melodic layout (Keys colors). But pressing pads in the right 4x4 still fires drum lane N's note at vel-zone velocities, as if the track were still in Drums mode.

2. **Clear Session leaves drum-mode tracks in drum mode.** From the user: "when i clear a session in the global menu, it's supposed to start the set from scratch — all default values, as if the session never existed prior. but i've noticed that when i do that tracks that were set to drum mode REMAIN in drum mode after the reset. only track 1 should ever start a new session in drum mode."

Both symptoms share the same shape: **JS state shows melodic, DSP state still says drum.** The visual layer is JS-driven (so it switches correctly), the audio-thread `drum_pad_event` classifier reads `tr->pad_mode == PAD_MODE_DRUM` (so the wrong code path runs).

## What was actually fixed this session

The vel-zone pad release was a no-op in `drum_pad_event` (commit comment said "synth ringout"). On destinations that expect note-off (ROUTE_SCHWUNG, USB external) those notes hung forever. Fixed in `dsp/seq8.c` `drum_pad_event` release path — now fires `live_note_off` symmetric to the press's `live_note_on`. Verified on device 2026-05-19.

That fix is **independent** of the mode-flip drop below. They were initially conflated (the user's "right pads ghost a drum note" phrasing fit either bug).

## What is still broken

The Mode-menu Keys-direction set_param push (`host_module_set_param('tN_pad_mode', '0')`) does not reach the DSP `pad_mode` handler. The forward direction (`'1'`) does. This is reproducible — multiple log captures, never a single `pad_mode <- 0` ilog entry.

The Clear Session bug is almost certainly the same root, just exercised through the `doClearSession` path instead of the menu setter. `ui_persistence.mjs:155` zeroes `S.trackPadMode[_t]` in JS for all tracks, but the `pendingSetLoad` reload presumably doesn't re-init DSP `tr->pad_mode` for non-t0 tracks (only t0 has a pendingDefaultSetParam entry on first-run, and the post-clear reload path may not re-publish a default for the others). Worth verifying.

## What we ruled out this session

- **DSP set_param handler is unreachable.** No — the `pad_mode` handler ilogs every time it fires for value 1. For value 0 it would also ilog, but the call never reaches DSP.
- **Mode menu setter doesn't fire.** Unclear — we instrumented it but the sentinel push (`host_module_set_param('tN_pad_octave', String(90 + v))`) never reached DSP either. Either the setter doesn't fire, OR `tN_pad_octave` is dropped at the host. We didn't disambiguate before parking.
- **Same-buffer same-key coalescing.** Not relevant here — the bug is a directional drop, not a multi-write coalesce.
- **JS-side state mirror going stale.** Grep shows `S.trackPadMode[t]` is only mutated by `applyTrackConfig` + clearSession init + first-run default. No silent reset path identified.

## What we did NOT try (next-session ideas)

1. **Different sentinel key.** `tN_pad_octave` was a bad choice — nothing else writes it in normal use, so we couldn't tell if "no probe fires" meant "JS push didn't fire" or "DSP handler unreachable" or "host dropped the key by name". Use `tN_track_vel_override` (known reliable, written by VelIn menu setter) or add a brand-new dedicated `tN_pmprobe` set_param key to DSP. A new DSP key gives a clean per-track channel with no semantic side effect.

2. **Probe inside `host_module_set_param` itself.** Wrap the global host function with a JS-side trace ring buffer that captures the last N (key, val) pairs. Read the buffer via a global menu action that dumps to log. Tells us exactly what JS attempted, independent of host filtering.

3. **`doClearSession` push audit.** Read end-to-end. Does it push `tN_pad_mode=0` for non-t0 tracks? Per advisor's note: line 155 zeroes JS state, line 186 sets `pendingSetLoad=true`. The state file is written as `{"v":0}` which should cause DSP to fall back to defaults (`pad_mode = PAD_MODE_MELODIC_SCALE`) on the next state_load. Verify the state_load actually fires after the clear, and verify the default-reset path in `create_instance` / `seq8_load_state` reaches all 8 tracks. If yes, both bugs need separate fixes. If no (i.e., DSP retains the old `pad_mode` because state_load doesn't re-init it), Clear Session bug is the easier of the two and may be a one-line fix in DSP state_load.

4. **`menu_nav.mjs handleMenuInput` deeper read.** We read the immediate-jog `applyValueChange` path (line 257-258) and the editValue commit path (line 158). Confirm what gesture path the user is actually using to flip the enum — there may be a third path or a gating condition we missed.

5. **Capture the `S.activeTrack` value at set time.** A theory we never tested: maybe `S.activeTrack` is undefined or non-numeric at the moment the Mode setter fires for value 0 (but not value 1). That would silently push to a malformed key and DSP would never see it.

## Files touched this session (only hang fix remains)

```
dsp/seq8.c — drum_pad_event release branch + 1 new live_note_off call (hang fix only, kept)
```

All debug probes reverted before commit. Sentinel ranges used during investigation: `_pad_octave` 70/71 (applyTrackConfig), 90/91 (Mode menu setter). DSP probe gate started at >= 80 (filtered out the lower sentinel — wasted a cycle), then >= 50 (both should have passed but neither did — confirming the host-drop or unreachable-handler hypothesis).

## Connected memory

- `[[project_drum_to_melodic_vel_zone_ghost]]` — original parked entry. Update with this session's findings: hang half fixed, JS-reset attempt from prior session (`applyTrackConfig` `pad_mode==0` else-branch pushing `tN_active_drum_lane=0` + `tN_drum_perform_mode=0`) is harmless but doesn't fix the bug because the upstream `tN_pad_mode=0` push itself never reaches DSP. The else-branch additions can be deleted in a future cleanup.
- `[[feedback_schwung_drops_global_set_param]]` — adjacent failure mode for globals. Reach for this if you suspect the host has a per-key allowlist.
- `[[feedback_set_param_coalescing]]` — not the cause here (different mechanism), but listed because the bug profile is similar.
