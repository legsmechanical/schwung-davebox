/* ui_drummodel.mjs
 * Drum-lane / pad-map data model: pad-note-map computation (both drum and
 * melodic layouts), the pad-dispatch mute gate, and drum-lane state sync
 * (steps, per-lane metadata, active lane/perform-mode/page setters, clip
 * content flags, Repeat Groove state). S stays shared via ui_state.mjs.
 * Extracted from ui.js (Phase 5 of the modularity refactor, module 2).
 */

import { S } from './ui_state.mjs';
import { PAD_MODE_DRUM, DRUM_LANES, DRUM_BASE_NOTE, NUM_CLIPS } from './ui_constants.mjs';
import { SCALE_INTERVALS } from './ui_pure.mjs';

/* PHASE-1: helper for the pad-dispatch mute condition. Modal sources:
 * - sessionView                 — pads launch clips
 * - button-helds (Shift/Delete/Copy/Mute/Capture/Loop) — pads are shortcuts
 * - tapTempoOpen                — pads are tap input
 * - ARP step-edit pad mode      — K5 held in SEQ ARP (bank 4) or TRACK ARP
 *                                  (bank 5) with steps mode != Off; pads edit
 *                                  step velocity, not play notes
 * globalMenuOpen is NOT in this list — pads should still play notes in
 * track view while the menu is open (user confirmed 2026-05-17). */
export function _padDispatchMutedNow() {
    if (S.sessionView) return true;
    /* captureHeld no longer mutes pads: the Capture+pad lane-select gesture
     * was removed (Capture is capture-only); Capture+scene is Session View,
     * where the sessionView check above already mutes. */
    if (S.shiftHeld || S.deleteHeld || S.muteHeld || S.copyHeld
        || S.loopHeld || S.tapTempoOpen) return true;
    if ((S.activeBank === 4 || S.activeBank === 5)
        && S.knobTouched === 4
        && S.bankParams[S.activeTrack]
        && ((S.bankParams[S.activeTrack][S.activeBank] || [])[4] | 0) !== 0) return true;
    /* Arp Steps overlay: pads are the persistent vel-level editor, not playable. */
    if (S.stepIntervalMode && (S.activeBank === 4 || S.activeBank === 5)) return true;
    return false;
}

export function computePadNoteMap() {
    const t = S.activeTrack;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum mode: left half (cols 0-3) maps to drum lanes via drumPadToLane;
         * right half (cols 4-7) is velocity zones (no note dispatch).
         * For each pad we store the corresponding lane's midi_note, or 0xFF
         * for velocity-zone slots so DSP on_midi skips dispatch (JS still
         * handles vel-zone arming as state, independent of note routing). */
        const page = S.drumLanePage[t] | 0;
        /* Move co-run: the left-column lane pads are sounded + cell-selected by the
         * plain pad-on injected to Move (in _onPadPress). Map them to 0xFF too so the
         * DSP on_midi handler skips its own sound — otherwise we'd get a double hit
         * (DSP-routed Move drum + the injected pad). Right-column vel-zone pads stay
         * 0xFF as always (JS handles them; no inject, so no double). */
        const coRunSilentLeft = (S.moveCoRunTrack >= 0);
        for (let i = 0; i < 32; i++) {
            const col = i % 8;
            if (col >= 4) { S.padNoteMap[i] = 0xFF; continue; }
            if (coRunSilentLeft) { S.padNoteMap[i] = 0xFF; continue; }
            const row = Math.floor(i / 8);
            const lane = page * 16 + row * 4 + col;
            const note = (lane >= 0 && lane < DRUM_LANES)
                ? ((S.drumLaneNote[t][lane] | 0) || (DRUM_BASE_NOTE + lane))
                : 0xFF;
            S.padNoteMap[i] = note & 0xFF;
        }
    } else {
        /* While a transpose preview is armed, lay the pads out for the CANDIDATE
         * key/scale (committed padKey/padScale stay put until commit). */
        const effKey   = S.xposePrevKey   !== null ? S.xposePrevKey   : S.padKey;
        const effScale = S.xposePrevScale !== null ? S.xposePrevScale : S.padScale;
        const root = S.padOctave[t] * 12 + effKey;
        const intervals = SCALE_INTERVALS[effScale] || SCALE_INTERVALS[0];
        S.padScaleSet.clear();
        for (let i = 0; i < intervals.length; i++) S.padScaleSet.add(intervals[i]);
        if (S.padLayoutChromatic[t]) {
            for (let i = 0; i < 32; i++) {
                const col = i % 8;
                const row = Math.floor(i / 8);
                /* OOB pads (computed pitch < 0 or > 127) get the 0xFF sentinel
                 * to match drum vel-zone slots. Previously clamped to 0/127,
                 * which made multiple OOB pads share the same MIDI note → all
                 * lit when any one was pressed (LED cache keyed on note). */
                const p = root + col + row * 8;
                S.padNoteMap[i] = (p < 0 || p > 127) ? 0xFF : p;
            }
        } else {
            const n = intervals.length;
            for (let i = 0; i < 32; i++) {
                const col = i % 8;
                const row = Math.floor(i / 8);
                const deg = col + row * 3;
                const oct = Math.floor(deg / n);
                const semitone = oct * 12 + intervals[deg % n];
                const p = root + semitone;
                S.padNoteMap[i] = (p < 0 || p > 127) ? 0xFF : p;
            }
        }
    }
    /* Phase 1: push the resolved active-track map to DSP for audio-thread
     * inbound. DSP only ever indexes pad_note_map[inst->active_track], so
     * pushing the one active track's map on every recompute is sufficient.
     * Dormant until the capability gate flips dsp_inbound_enabled in
     * piece 3. */
    /* PHASE-1: only push on patched Schwung. The DSP padmap handler doubles
     * as the capability signal — its presence sets inst->dsp_inbound_enabled,
     * gating on_midi dispatch. On stock Schwung S.dspInboundEnabled stays
     * false, the push is skipped, on_midi (which isn't called on stock anyway)
     * stays dormant, and the JS pendingLiveNotes path keeps working unchanged.
     * Remove this gate when patches upstreamed. */
    if (S.dspInboundEnabled && typeof host_module_set_param === 'function') {
        /* JS dispatch today adds S.trackOctave * 12 at the pad-press site
         * (lines ~6838, ~6909). Phase 1's on_midi reads pad_note_map as-is,
         * so we bake the runtime octave offset into the pushed payload while
         * leaving S.padNoteMap itself unshifted (the stock-Schwung fallback
         * path still adds the offset at dispatch). Drum tracks ignore the
         * offset (lane midi_notes are fixed). Session View: pads launch
         * clips — emit all-0xFF so DSP on_midi skips dispatch. Track-view
         * re-entry triggers another computePadNoteMap() in tick(). */
        /* PHASE-1: pad dispatch is muted while a modal gesture owns the pad
         * surface. DSP on_midi skips 0xFF entries, so pushing all-0xFF
         * suppresses note dispatch without changing on_midi code. State
         * sources: button-held modifiers (covered by explicit hooks in
         * _onCC_buttons for zero-latency), dialogs (covered by the
         * tick()-time muted-edge detector below). Remove the modal-flag
         * checks when patches upstreamed. See [[project-modal-pad-
         * interception-regression]]. */
        const padDispatchMuted = _padDispatchMutedNow();
        const isDrum = S.trackPadMode[t] === PAD_MODE_DRUM;
        const octShift = isDrum ? 0 : ((S.trackOctave[t] | 0) * 12);
        let payload = '';
        for (let i = 0; i < 32; i++) {
            let out;
            if (padDispatchMuted && S.sessionView) {
                out = 0xFF;
            } else if (padDispatchMuted) {
                const p = S.padNoteMap[i];
                out = (p === 0xFF) ? 0xFF : Math.max(0, Math.min(127, p + octShift));
            } else {
                const p = S.padNoteMap[i];
                out = (p === 0xFF) ? 0xFF : Math.max(0, Math.min(127, p + octShift));
            }
            payload += (i ? ' ' : '') + out;
        }
        /* The tN_padmap key encodes the active track index — DSP's
         * tN_padmap handler updates inst->active_track + dsp_inbound_enabled
         * from it. (Schwung host silently drops module-defined global keys,
         * so we piggyback signals onto the per-track padmap push.)
         *
        /* 33rd token = pad-dispatch-muted flag. While set, DSP on_midi skips
         * drum_pad_event (Rpt1/Rpt2 rate-pad + vel-zone handling) on top of
         * the existing pad_note_map=0xFF mute. Fixes Shift+bottom-row track
         * shortcut leaking into Rpt1/Rpt2 latch on the prior active track. */
        payload += ' ' + (padDispatchMuted ? 1 : 0);
        payload += ' ' + (S.deleteHeld ? 1 : 0);
        /* 35th token = corun_left_silent. When this (drum) track's left-column
         * lane pads are intentionally mapped to 0xFF for Move-native co-run
         * (so DSP on_midi skips them — Move plays the injected pad), tell DSP
         * so it excludes these benign 0xFF presses from the pad-drop
         * diagnostic. Mirrors coRunSilentLeft in computePadNoteMap. */
        payload += ' ' + ((isDrum && S.moveCoRunTrack >= 0) ? 1 : 0);
        host_module_set_param('t' + t + '_padmap', payload);
        S.lastPushedMuted = padDispatchMuted;
    }
}

/* Drum helpers --------------------------------------------------------------- */

/** Sync one drum lane's step data and length from DSP. */
export function syncDrumLaneSteps(t, l) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_l' + l + '_steps');
    if (raw) {
        for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = raw[s] || '0';
        S.drumLaneHasNotes[t][l] = raw.indexOf('1') >= 0;
    }
    if (l === S.activeDrumLane[t]) {
        const lenRaw = host_module_get_param('t' + t + '_l' + l + '_length');
        if (lenRaw !== null) S.drumLaneLength[t] = parseInt(lenRaw, 10) || 16;
        const lsRaw = host_module_get_param('t' + t + '_l' + l + '_loop_start');
        if (lsRaw !== null) S.drumLaneLoopStart[t] = parseInt(lsRaw, 10) | 0;
        const lsPage = Math.floor(S.drumLaneLoopStart[t] / 16);
        const winPages = Math.max(1, Math.ceil(S.drumLaneLength[t] / 16));
        if (S.drumStepPage[t] < lsPage) S.drumStepPage[t] = lsPage;
        else if (S.drumStepPage[t] > lsPage + winPages - 1) S.drumStepPage[t] = lsPage + winPages - 1;
        const tpsRaw = host_module_get_param('t' + t + '_l' + l + '_tps');
        if (tpsRaw !== null) S.drumLaneTPS[t] = parseInt(tpsRaw, 10) || 24;
    }
}

/** Sync lane notes and hit-presence for all lanes of track t (active clip). */
export function syncDrumLanesMeta(t) {
    if (typeof host_module_get_param !== 'function') return;
    for (let l = 0; l < DRUM_LANES; l++) {
        const noteRaw = host_module_get_param('t' + t + '_l' + l + '_lane_note');
        if (noteRaw !== null) S.drumLaneNote[t][l] = parseInt(noteRaw, 10) || (DRUM_BASE_NOTE + l);
        const ncRaw  = host_module_get_param('t' + t + '_l' + l + '_note_count');
        S.drumLaneHasNotes[t][l] = ncRaw !== null ? parseInt(ncRaw, 10) > 0 : false;
    }
    const muteRaw = host_module_get_param('t' + t + '_drum_lane_mute');
    if (muteRaw !== null) S.drumLaneMute[t] = parseInt(muteRaw, 10) >>> 0;
    const soloRaw = host_module_get_param('t' + t + '_drum_lane_solo');
    if (soloRaw !== null) S.drumLaneSolo[t] = parseInt(soloRaw, 10) >>> 0;
}


/* Bundle 2A: single setter for S.activeDrumLane that also pushes the
 * value to DSP via tN_active_drum_lane so on_midi.drum_pad_event can
 * fire vel-pad preview at the active lane's note. Replaces every direct
 * S.activeDrumLane[t] = X write site. PHASE-1: remove the set_param push
 * (and revert to direct writes) when patches are upstreamed and the JS
 * input path is deleted. */
export function setActiveDrumLane(t, lane) {
    if (S.activeDrumLane[t] === lane) return;
    /* NB: written via array-ref alias so a future `replace_all` on the
     * pattern `S.activeDrumLane[t] = lane;` can't accidentally turn this
     * line into a recursive call to setActiveDrumLane (which is what
     * happened on the first 2A deploy — stack overflow on init). */
    const arr = S.activeDrumLane;
    arr[t] = lane;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_active_drum_lane', String(lane));
}

/* Bundle 2A: single setter for S.drumPerformMode that also pushes the
 * value to DSP via tN_drum_perform_mode so on_midi.drum_pad_event can
 * gate the vel-zone preview branch correctly (Rpt modes skip the
 * preview; only NORMAL fires it). Same array-ref-alias pattern as
 * setActiveDrumLane to avoid replace_all self-recursion. */
export function setDrumPerformMode(t, mode) {
    if (S.drumPerformMode[t] === mode) return;
    const arrPm = S.drumPerformMode;
    arrPm[t] = mode;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_drum_perform_mode', String(mode));
}

/* Bundle 2C-Rpt2: single setter for S.drumLanePage that also pushes the
 * value to DSP via tN_drum_lane_page so on_midi.drum_pad_event can
 * translate left-half padIdx → absolute drum lane index (Rpt2 lane-pad
 * classification + Rpt1 lane-swap-while-holding). Same array-ref-alias
 * pattern as setActiveDrumLane to avoid replace_all self-recursion. */
export function setDrumLanePage(t, page) {
    if (S.drumLanePage[t] === page) return;
    const arrLp = S.drumLanePage;
    arrLp[t] = page;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_drum_lane_page', String(page));
}

/** Sync S.drumClipNonEmpty[t] for all clips — called on track switch and state load. */
export function syncDrumClipContent(t) {
    if (typeof host_module_get_param !== 'function') return;
    for (let c = 0; c < NUM_CLIPS; c++) {
        const raw = host_module_get_param('t' + t + '_c' + c + '_drum_has_content');
        S.drumClipNonEmpty[t][c] = raw === '1';
    }
}

export function syncDrumRepeatState(t, lane) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_l' + lane + '_repeat_state');
    if (!raw) return;
    const v = raw.split(' ');
    if (v.length < 18) return;
    S.drumRepeatGate[t][lane] = parseInt(v[0], 10) & 0xFF;
    for (let s = 0; s < 8; s++) S.drumRepeatVelScale[t][lane][s] = parseInt(v[1 + s], 10) | 0;
    for (let s = 0; s < 8; s++) S.drumRepeatNudge[t][lane][s]    = parseInt(v[9 + s], 10) | 0;
    if (v.length >= 19) S.drumRepeatGateLen[t][lane] = parseInt(v[18], 10) || 8;
}
