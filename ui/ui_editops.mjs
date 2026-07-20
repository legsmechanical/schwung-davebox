/* ui_editops.mjs
 * Clip/row/step/drum-lane copy·cut·clear + fills, plus the handler-invoked
 * track/mute/reset grab-bag: track mute/solo, active-track switch, FX/TARP
 * bank resets, and the Conductor grid knob. All handler-called mutators that
 * route through DSP writes + JS mirror updates; no shared module-scope state.
 * Extracted from ui.js (Phase 5b prep, increment 4 of the modularity refactor).
 */

import {
    NUM_TRACKS, NUM_STEPS, DRUM_LANES,
    PAD_MODE_DRUM, PAD_MODE_CONDUCT, BANKS, ACTION_POPUP_TICKS,
    BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN
} from './ui_constants.mjs';
import { S } from './ui_state.mjs';
import { clipHasContent } from './ui_pure.mjs';
import { showActionPopup } from './ui_persistence.mjs';
import { effectiveClip, invalidateLEDCache, forceRedraw } from './ui_leds.mjs';
import { refreshPerClipBankParams, resetPerClipBankParamsToDefault,
    refreshSeqNotesIfCurrent, _focusedClipIsEmpty } from './ui_dsp_bridge.mjs';

/* Record a MELODIC clip whose automation mirror (trackCCAutoBits / clipCCVal /
 * clipAtHas) the editop cannot fill purely in JS — pollDSP's local-rev path
 * re-reads exactly these clips (automation fields only) once the DSP applies the
 * edit. Drum clips are skipped: their content is re-synced via pendingDrumResync.
 * This, together with the `_local: true` flag on the queued command, replaces the
 * old reliance on pollDSP's full syncClipsFromDsp() self-resync (the ~4.3s freeze). */
function _markLocalTouch(t, c) {
    if (S.trackPadMode[t] === PAD_MODE_DRUM) return;
    S.localEditTouched.push({ t, c });
}

export function setTrackMute(t, on) {
    S.trackMuted[t] = on;
    if (on && S.trackSoloed[t]) {
        S.trackSoloed[t] = false;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_solo', '0');
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_mute', on ? '1' : '0');
    S.screenDirty = true;
}

export function setTrackSolo(t, on) {
    /* Solo is disabled on the Conductor track — the control is inert. (It emits
     * no MIDI, and soloing it would wrongly silence every other track.) Mute
     * stays functional via setTrackMute. */
    if (S.trackPadMode[t] === PAD_MODE_CONDUCT) return;
    S.trackSoloed[t] = on;
    if (on && S.trackMuted[t]) {
        S.trackMuted[t] = false;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_mute', '0');
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_solo', on ? '1' : '0');
    S.screenDirty = true;
}

export function clearAllMuteSolo() {
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        S.trackMuted[_t]  = false;
        S.trackSoloed[_t] = false;
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('mute_all_clear', '1');
    S.screenDirty = true;
}

/* Clear all notes from a step and deactivate it (atomic DSP write). */
export function clearStep(t, ac, absIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + ac + '_step_' + absIdx + '_clear', val: '1', _local: true });
    S.clipSteps[t][ac][absIdx] = 0;
    if (S.clipNonEmpty[t][ac]) S.clipNonEmpty[t][ac] = clipHasContent(t, ac);
    refreshSeqNotesIfCurrent(t, ac, absIdx);
}

export function showModePopup(title, items, activeIdx) {
    S.actionPopupLines     = [title, ...items];
    S.actionPopupHighlight = activeIdx + 1;
    S.actionPopupEndTick   = S.tickCount + ACTION_POPUP_TICKS;
    S.screenDirty = true;
}

/* Clear all steps in a clip. clearClip runs in on_midi context and schedules
 * its tN_cC_clear via pendingDefaultSetParams. The drain at tick() bottom
 * fires on the SAME audio buffer as the synchronous set_param fan-out from
 * resetPerClipBankParamsToDefault below — and the host coalesces all of them
 * down to a single survivor, eating the queued _clear. clearDrainHold defers
 * the drain by one tick so _clear lands in a clean buffer. */
export function clearClip(t, ac, keepPlaying) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    /* Clip CLEAR semantics (matches drum lane Clear, Group I): wipe step
     * note data only. Preserve length, loop window, ticks_per_step, the
     * destructive CLIP-bank params (stretch_exp / clock_shift_pos /
     * nudge_pos), and per-clip pfx (NOTE FX / HARMONY / DELAY / SEQUENCE
     * ARP). Hard Reset (Shift+Delete) is the gesture that wipes structure. */
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const keep = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t]) ? '1' : '0';
        S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_drum_clear', val: keep, _local: true });
        S.clearDrainHold = 1;
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = '0';
            S.drumLaneHasNotes[t][l] = false;
        }
        S.drumClipNonEmpty[t][ac] = false;
        if (ac === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear();
        }
        return;
    }
    const cmd = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t])
        ? 't' + t + '_c' + ac + '_clear_keep'
        : 't' + t + '_c' + ac + '_clear';
    S.pendingDefaultSetParams.unshift({ key: cmd, val: '1', _local: true });
    /* Defer drain 1 tick to keep _clear out of the same audio buffer as any
     * sync set_param fan-out that might still be in flight. */
    S.clearDrainHold = 1;
    const len = S.clipLength[t][ac];
    for (let s = 0; s < len; s++) S.clipSteps[t][ac][s] = 0;
    S.clipNonEmpty[t][ac] = false;
    /* Clip clear now also wipes all automation DSP-side — mirror it so the
     * AUTOMATION-bank indicators + CC values reflect the clear immediately. */
    S.trackCCAutoBits[t][ac] = 0;
    S.clipCCVal[t][ac] = new Array(8).fill(-1);
    S.clipAtHas[t][ac] = false;
    invalidateLEDCache();
    /* Re-read steps from DSP 2 ticks later so step LEDs catch up after _clear
     * has drained. Belt-and-suspenders against any state that still reads from
     * DSP after the synchronous JS mirror wipe. */
    S.pendingStepsReread      = 2;
    S.pendingStepsRereadTrack = t;
    S.pendingStepsRereadClip  = ac;
    if (ac === S.trackActiveClip[t]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        /* Focused-clip-by-default: after clearing the focused clip, ensure it
         * stays playing so the track doesn't go silent. If trackClipPlaying
         * was true we used _clear_keep (DSP preserves playback). If it was
         * false (e.g. clip hadn't auto-launched yet), re-launch now while
         * transport is playing so the cleared clip ticks through empty steps. */
        if (S.playing && !S.trackClipPlaying[t]
                && !S.trackWillRelaunch[t]
                && S.trackQueuedClip[t] === -1) {
            S.pendingDefaultSetParams.push({ key: 't' + t + '_launch_clip', val: String(ac) });
            S.trackQueuedClip[t] = ac;
        }
    }
}

/* Full factory reset: clip_init on DSP + JS mirror cleared. Track View only. */
export function hardResetClip(t, ac) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum clip reset: clip_init all 32 lanes; midi_note preserved */
        S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_drum_reset', val: '1', _local: true });
        S.clearDrainHold = 1;
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = '0';
            S.drumLaneHasNotes[t][l] = false;
        }
        S.drumClipNonEmpty[t][ac] = false;
        S.clipLengthManuallySet[t][ac] = false;
        S.drumLaneLengthManuallySet[t]  = false;
        if (ac === S.trackActiveClip[t]) {
            S.drumLaneLength[t] = 16;
            S.drumLaneLoopStart[t] = 0;
            S.drumLaneTPS[t]    = 24;
            S.drumStepPage[t]   = 0;
            S.trackCurrentPage[t] = 0;
            S.seqActiveNotes.clear();
        }
        return;
    }
    S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_hard_reset', val: '1', _local: true });
    S.clearDrainHold = 1;
    _markLocalTouch(t, ac);   /* automation wiped DSP-side; re-read to mirror */
    const defaultLen = 16;
    for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[t][ac][s] = 0;
    S.clipLength[t][ac] = defaultLen;
    S.clipLoopStart[t][ac] = 0;
    S.clipNonEmpty[t][ac] = false;
    S.clipTPS[t][ac] = 24;
    S.clipLengthManuallySet[t][ac] = false;
    for (var _k = 0; _k < 8; _k++) {
        S.ccLaneLoopStart[t][ac][_k] = 0;
        S.ccLaneLength[t][ac][_k]    = 0;
        S.ccLaneTps[t][ac][_k]       = 0;
    }
    if (ac === S.trackActiveClip[t]) {
        S.trackCurrentPage[t] = 0;
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        resetPerClipBankParamsToDefault(t);
    }
}

/* Copy clip src→dst (single atomic DSP write, JS mirror update). */
export function copyClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'clip_copy', val: `${srcT} ${srcC} ${dstT} ${dstC}`, _local: true });
    _markLocalTouch(dstT, dstC);   /* dst automation copied DSP-side; re-read to mirror */
    S.clipSteps[dstT][dstC] = S.clipSteps[srcT][srcC].slice();
    S.clipLength[dstT][dstC] = S.clipLength[srcT][srcC];
    S.clipLoopStart[dstT][dstC] = S.clipLoopStart[srcT][srcC];
    S.clipNonEmpty[dstT][dstC] = S.clipNonEmpty[srcT][srcC];
    S.clipTPS[dstT][dstC] = S.clipTPS[srcT][srcC];
    for (var _k = 0; _k < 8; _k++) {
        S.ccLaneLoopStart[dstT][dstC][_k] = S.ccLaneLoopStart[srcT][srcC][_k];
        S.ccLaneLength[dstT][dstC][_k]    = S.ccLaneLength[srcT][srcC][_k];
        S.ccLaneTps[dstT][dstC][_k]       = S.ccLaneTps[srcT][srcC][_k];
    }
    if (dstC === S.trackActiveClip[dstT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1;
        refreshPerClipBankParams(dstT);
    }
}

/* Cut clip: copy src→dst then hard-reset src (single atomic DSP write, JS mirror update). */
export function cutClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'clip_cut', val: `${srcT} ${srcC} ${dstT} ${dstC}`, _local: true });
    _markLocalTouch(dstT, dstC);   /* dst gets src's automation, src cleared — re-read both */
    _markLocalTouch(srcT, srcC);
    S.clipSteps[dstT][dstC] = S.clipSteps[srcT][srcC].slice();
    S.clipLength[dstT][dstC] = S.clipLength[srcT][srcC];
    S.clipLoopStart[dstT][dstC] = S.clipLoopStart[srcT][srcC];
    S.clipNonEmpty[dstT][dstC] = S.clipNonEmpty[srcT][srcC];
    S.clipTPS[dstT][dstC] = S.clipTPS[srcT][srcC];
    for (var _k = 0; _k < 8; _k++) {
        S.ccLaneLoopStart[dstT][dstC][_k] = S.ccLaneLoopStart[srcT][srcC][_k];
        S.ccLaneLength[dstT][dstC][_k]    = S.ccLaneLength[srcT][srcC][_k];
        S.ccLaneTps[dstT][dstC][_k]       = S.ccLaneTps[srcT][srcC][_k];
    }
    if (dstC === S.trackActiveClip[dstT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1;
        refreshPerClipBankParams(dstT);
    }
    for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[srcT][srcC][s] = 0;
    S.clipLength[srcT][srcC] = 16;
    S.clipLoopStart[srcT][srcC] = 0;
    S.clipNonEmpty[srcT][srcC] = false;
    S.clipTPS[srcT][srcC] = 24;
    for (var _k2 = 0; _k2 < 8; _k2++) {
        S.ccLaneLoopStart[srcT][srcC][_k2] = 0;
        S.ccLaneLength[srcT][srcC][_k2]    = 0;
        S.ccLaneTps[srcT][srcC][_k2]       = 0;
    }
    if (srcC === S.trackActiveClip[srcT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        resetPerClipBankParamsToDefault(srcT);
    }
}

/* Copy all 8 tracks for a scene row (single atomic DSP write, JS mirror update). */
export function copyRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_copy', val: `${srcRow} ${dstRow}`, _local: true });
    for (let t = 0; t < NUM_TRACKS; t++) {
        _markLocalTouch(t, dstRow);   /* dst automation copied DSP-side; re-read to mirror */
        S.clipSteps[t][dstRow] = S.clipSteps[t][srcRow].slice();
        S.clipLength[t][dstRow] = S.clipLength[t][srcRow];
        S.clipLoopStart[t][dstRow] = S.clipLoopStart[t][srcRow];
        S.clipNonEmpty[t][dstRow] = S.clipNonEmpty[t][srcRow];
        S.clipTPS[t][dstRow] = S.clipTPS[t][srcRow];
        S.drumClipNonEmpty[t][dstRow] = S.drumClipNonEmpty[t][srcRow];
        for (var _k = 0; _k < 8; _k++) {
            S.ccLaneLoopStart[t][dstRow][_k] = S.ccLaneLoopStart[t][srcRow][_k];
            S.ccLaneLength[t][dstRow][_k]    = S.ccLaneLength[t][srcRow][_k];
            S.ccLaneTps[t][dstRow][_k]       = S.ccLaneTps[t][srcRow][_k];
        }
        if (dstRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            refreshPerClipBankParams(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
    }
}

/* Cut row: copy all tracks src→dst then hard-reset src (single atomic DSP write, JS mirror update). */
export function cutRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_cut', val: `${srcRow} ${dstRow}`, _local: true });
    for (let t = 0; t < NUM_TRACKS; t++) {
        _markLocalTouch(t, dstRow);   /* dst gets src's automation, src cleared — re-read both */
        _markLocalTouch(t, srcRow);
        S.clipSteps[t][dstRow] = S.clipSteps[t][srcRow].slice();
        S.clipLength[t][dstRow] = S.clipLength[t][srcRow];
        S.clipLoopStart[t][dstRow] = S.clipLoopStart[t][srcRow];
        S.clipNonEmpty[t][dstRow] = S.clipNonEmpty[t][srcRow];
        S.clipTPS[t][dstRow] = S.clipTPS[t][srcRow];
        S.drumClipNonEmpty[t][dstRow] = S.drumClipNonEmpty[t][srcRow];
        for (var _k = 0; _k < 8; _k++) {
            S.ccLaneLoopStart[t][dstRow][_k] = S.ccLaneLoopStart[t][srcRow][_k];
            S.ccLaneLength[t][dstRow][_k]    = S.ccLaneLength[t][srcRow][_k];
            S.ccLaneTps[t][dstRow][_k]       = S.ccLaneTps[t][srcRow][_k];
        }
        if (dstRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            refreshPerClipBankParams(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
        for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[t][srcRow][s] = 0;
        S.clipLength[t][srcRow] = 16;
        S.clipLoopStart[t][srcRow] = 0;
        S.clipNonEmpty[t][srcRow] = false;
        S.clipTPS[t][srcRow] = 24;
        S.drumClipNonEmpty[t][srcRow] = false;
        for (var _k2 = 0; _k2 < 8; _k2++) {
            S.ccLaneLoopStart[t][srcRow][_k2] = 0;
            S.ccLaneLength[t][srcRow][_k2]    = 0;
            S.ccLaneTps[t][srcRow][_k2]       = 0;
        }
        if (srcRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
            resetPerClipBankParamsToDefault(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
    }
}

/* Copy step src→dst within same clip (single atomic DSP write, JS mirror update). */
export function copyStep(t, ac, srcAbs, dstAbs) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_step_' + srcAbs + '_copy_to', val: String(dstAbs), _local: true });
        S.drumLaneSteps[t][lane][dstAbs] = S.drumLaneSteps[t][lane][srcAbs];
        if (S.drumLaneSteps[t][lane][srcAbs] !== '0') S.drumLaneHasNotes[t][lane] = true;
        S.pendingDrumLaneResync      = 2;
        S.pendingDrumLaneResyncTrack = t;
        S.pendingDrumLaneResyncLane  = lane;
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + ac + '_step_' + srcAbs + '_copy_to', val: String(dstAbs), _local: true });
        S.clipSteps[t][ac][dstAbs] = S.clipSteps[t][ac][srcAbs];
        if (S.clipSteps[t][ac][srcAbs] !== 0) S.clipNonEmpty[t][ac] = true;
        S.pendingStepsReread      = 2;
        S.pendingStepsRereadTrack = t;
        S.pendingStepsRereadClip  = ac;
    }
}

/* Copy active clip's lane srcLane to dstLane (same track, preserves dst midi_note). */
export function copyDrumLane(t, srcLane, dstLane) {
    if (srcLane === dstLane) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + srcLane + '_copy_to', val: String(dstLane), _local: true });
    const steps = S.drumLaneSteps[t];
    for (let s = 0; s < 256; s++) steps[dstLane][s] = steps[srcLane][s];
    S.drumLaneHasNotes[t][dstLane] = S.drumLaneHasNotes[t][srcLane];
    if (S.drumLaneHasNotes[t][srcLane]) S.drumClipNonEmpty[t][S.trackActiveClip[t]] = true;
    /* Copy repeat groove JS state */
    S.drumRepeatGate[t][dstLane]    = S.drumRepeatGate[t][srcLane];
    S.drumRepeatGateLen[t][dstLane] = S.drumRepeatGateLen[t][srcLane];
    for (let s = 0; s < 8; s++) {
        S.drumRepeatVelScale[t][dstLane][s] = S.drumRepeatVelScale[t][srcLane][s];
        S.drumRepeatNudge[t][dstLane][s]    = S.drumRepeatNudge[t][srcLane][s];
    }
    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = dstLane;
}

/* Cut active clip's lane srcLane into dstLane (copy then clear src). */
export function cutDrumLane(t, srcLane, dstLane) {
    if (srcLane === dstLane) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + srcLane + '_cut_to', val: String(dstLane), _local: true });
    const steps = S.drumLaneSteps[t];
    for (let s = 0; s < 256; s++) { steps[dstLane][s] = steps[srcLane][s]; steps[srcLane][s] = '0'; }
    S.drumLaneHasNotes[t][dstLane] = S.drumLaneHasNotes[t][srcLane];
    S.drumLaneHasNotes[t][srcLane] = false;
    let anyHits = false;
    for (let l = 0; l < DRUM_LANES; l++) if (S.drumLaneHasNotes[t][l]) { anyHits = true; break; }
    S.drumClipNonEmpty[t][S.trackActiveClip[t]] = anyHits;
    /* Move repeat groove JS state */
    S.drumRepeatGate[t][dstLane]    = S.drumRepeatGate[t][srcLane];
    S.drumRepeatGateLen[t][dstLane] = S.drumRepeatGateLen[t][srcLane];
    for (let s = 0; s < 8; s++) {
        S.drumRepeatVelScale[t][dstLane][s] = S.drumRepeatVelScale[t][srcLane][s];
        S.drumRepeatNudge[t][dstLane][s]    = S.drumRepeatNudge[t][srcLane][s];
    }
    S.drumRepeatGate[t][srcLane]    = 0xFF;
    S.drumRepeatGateLen[t][srcLane] = 8;
    for (let s = 0; s < 8; s++) { S.drumRepeatVelScale[t][srcLane][s] = 100; S.drumRepeatNudge[t][srcLane][s] = 0; }
    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = dstLane;
}

/* Copy all 32 lanes of drum_clips[srcC] on srcT to drum_clips[dstC] on dstT; preserve dst midi_notes. */
export function copyDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'drum_clip_copy', val: `${srcT} ${srcC} ${dstT} ${dstC}`, _local: true });
    S.drumClipNonEmpty[dstT][dstC] = S.drumClipNonEmpty[srcT][srcC];
    if (dstC === S.trackActiveClip[dstT]) { S.pendingDrumResync = 2; S.pendingDrumResyncTrack = dstT; }
}

/* Cut all 32 lanes of drum_clips[srcC] on srcT into drum_clips[dstC] on dstT; undo dst only. */
export function cutDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'drum_clip_cut', val: `${srcT} ${srcC} ${dstT} ${dstC}`, _local: true });
    S.drumClipNonEmpty[dstT][dstC] = S.drumClipNonEmpty[srcT][srcC];
    S.drumClipNonEmpty[srcT][srcC] = false;
    if (srcC === S.trackActiveClip[srcT]) {
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[srcT][l][s] = '0';
            S.drumLaneHasNotes[srcT][l] = false;
        }
        S.drumLaneLength[srcT] = 16;
        S.drumLaneTPS[srcT]    = 24;
    }
    if (dstC === S.trackActiveClip[dstT]) { S.pendingDrumResync = 2; S.pendingDrumResyncTrack = dstT; }
}

/* Clear all 8 tracks for a scene row (single atomic DSP write, JS mirror update). */
export function clearRow(rowIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_clear', val: String(rowIdx), _local: true });
    for (let t = 0; t < NUM_TRACKS; t++) {
        _markLocalTouch(t, rowIdx);   /* automation wiped DSP-side; re-read to mirror */
        const len = S.clipLength[t][rowIdx];
        for (let s = 0; s < len; s++) S.clipSteps[t][rowIdx][s] = 0;
        S.clipNonEmpty[t][rowIdx] = false;
        S.drumClipNonEmpty[t][rowIdx] = false;
        S.clipLoopStart[t][rowIdx] = 0;
        if (rowIdx === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            S.trackCurrentPage[t] = 0;
            if (S.trackPadMode[t] === PAD_MODE_DRUM) S.drumLaneLoopStart[t] = 0;
            resetPerClipBankParamsToDefault(t);
            if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
            }
        }
    }
}

/* Save the current S.activeBank into the outgoing track's per-track slot,
 * switch to newT, then restore the new track's stored bank into S.activeBank.
 * Existing post-switch validity checks (e.g. drum-track hidden banks → 0)
 * still apply to the loaded value. Use at every site that assigns S.activeTrack. */
export function _switchActiveTrack(newT) {
    S.trackActiveBank[S.activeTrack] = S.activeBank;
    S.activeTrack = newT | 0;
    S.activeBank = S.trackActiveBank[S.activeTrack] | 0;
    if (S.activeBank === 7) S.allLanesConfirmed = false;
    /* Focused-clip-by-default: ONLY while transport is running — entering a track
     * launches its focused clip so it's live. While stopped we do NOT arm (passive
     * track-scrolling must not queue clips for the next transport start); the
     * displayed clip is instead armed at transport start (see _onCC_transport).
     * Skip if already live, in Session View, or if the focused clip has note
     * data (a clip intentionally left off must not be re-launched by scroll). */
    if (S.playing && !S.sessionView
            && !S.trackClipPlaying[S.activeTrack]
            && !S.trackWillRelaunch[S.activeTrack]
            && S.trackQueuedClip[S.activeTrack] === -1
            && _focusedClipIsEmpty(S.activeTrack)) {
        const _ac = S.trackActiveClip[S.activeTrack];
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + S.activeTrack + '_launch_clip', String(_ac));
        S.trackQueuedClip[S.activeTrack] = _ac;
    }
}

/* ALL LANES safety gate. Every gesture that writes all 32 drum lanes at once
 * funnels through this: while the drum ALL LANES bank is unconfirmed it surfaces
 * the "Edits will affect all lanes" OK screen (jog-click confirms) and tells the
 * caller to abort. Returns false (proceed) on any other bank/track. */
export function allLanesGate() {
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed) {
        S.screenDirty = true;
        forceRedraw();
        return true;
    }
    return false;
}

export function doDoubleFill() {
    const _t = S.activeTrack;
    if (S.trackPadMode[_t] === PAD_MODE_DRUM && S.activeBank === 7) {
        if (allLanesGate()) return;
        S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        host_module_set_param('t' + _t + '_all_lanes_double_fill', '1');
        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = _t;
        showActionPopup('LOOP', 'DOUBLED');
        forceRedraw();
    } else if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
        const _l   = S.activeDrumLane[_t];
        const _len = S.drumLaneLength[_t];
        if (_len * 2 > 256) {
            showActionPopup('CLIP FULL');
        } else {
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            host_module_set_param('t' + _t + '_l' + _l + '_loop_double_fill', '1');
            S.drumLaneLength[_t] = _len * 2;
            S.pendingDrumResync      = 2;
            S.pendingDrumResyncTrack = _t;
            showActionPopup('LOOP', 'DOUBLED');
            forceRedraw();
        }
    } else {
        const _ac  = effectiveClip(_t);
        const _len = S.clipLength[_t][_ac];
        if (_len * 2 > 256) {
            showActionPopup('CLIP FULL');
        } else {
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _t + '_loop_double_fill', '1');
            S.clipLength[_t][_ac] = _len * 2;
            S.pendingStepsReread      = 2;
            S.pendingStepsRereadTrack = _t;
            S.pendingStepsRereadClip  = _ac;
            refreshPerClipBankParams(_t);
            showActionPopup('LOOP', 'DOUBLED');
            forceRedraw();
        }
    }
}

export function doLaneDoubleFill() {
    var _t = S.activeTrack, _ac = effectiveClip(_t), _l = S.ccActiveLane[_t];
    var _len = S.ccLaneLength[_t][_ac][_l] || S.clipLength[_t][_ac];
    if (_len * 2 > 256) {
        showActionPopup('LANE FULL');
        return;
    }
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.ccLaneLength[_t][_ac][_l] = _len * 2;
    var _pre = 't' + _t + '_c' + _ac + '_k' + _l;
    S.pendingDefaultSetParams.push({ key: _pre + '_cc_lane_double_fill', val: '1' });
    showActionPopup('LANE LOOP', 'DOUBLED');
    forceRedraw();
}

/* Reset NOTE FX, HARMZ, and MIDI DLY banks to DSP defaults for track t.
 * The pfx_reset push itself is deferred via pendingDefaultSetParams — when
 * called from a MIDI handler (jog click), a synchronous push competes with
 * the same-buffer MIDI delivery and is silently coalesced away, leaving DSP
 * with no reset despite the OLED reporting success. The delay_level=127
 * override is queued after the reset so it lands on a later tick (DSP zeros
 * delay_level during the reset). */
export function resetFxBanks(t) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_pfx_reset', val: '1' });
        S.pendingDefaultSetParams.push({
            key: 't' + t + '_l' + lane + '_pfx_set',
            val: 'delay_level 127'
        });
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_pfx_reset', val: '1' });
        const _ac = S.trackActiveClip[t];
        S.pendingDefaultSetParams.push({
            key: 't' + t + '_c' + _ac + '_pfx_set',
            val: 'delay_level 127'
        });
        /* Reset SEQ ARP step params (step vel levels, per-step intervals,
         * loop length) — DSP-side clip_pfx_params_init handles these on
         * pfx_reset; mirror in JS so the overlay reflects defaults. */
        for (let s = 0; s < 8; s++) {
            S.seqArpStepVel[t][_ac][s] = 4;
            S.seqArpStepInt[t][_ac][s] = 0;
        }
        S.seqArpStepLoopLen[t][_ac] = 8;
    }
    const targets = [1, 2, 3, 4];
    for (let bi = 0; bi < targets.length; bi++) {
        const b = targets[bi];
        for (let k = 0; k < 8; k++) {
            const pm = BANKS[b].knobs[k];
            if (!pm) continue;
            S.bankParams[t][b][k] = pm.def;
        }
    }
    S.screenDirty = true;
}

/* Reset ARP IN (TARP, bank 5) for a melodic track to DSP defaults.
 * Issues a single tN_tarp_reset which the DSP handler resolves via
 * arp_init_defaults + held-buffer clear + silence. JS mirrors are
 * zeroed in parallel so the bank overview reflects defaults immediately. */
export function resetTarp(t) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_tarp_reset', val: '1' });
    for (let k = 0; k < 8; k++) {
        const pm = BANKS[5].knobs[k];
        if (pm) S.bankParams[t][5][k] = pm.def;
    }
    for (let s = 0; s < 8; s++) {
        S.tarpStepVel[t][s] = 4;
        S.tarpStepInt[t][s] = 0;
    }
    S.tarpStepLoopLen[t] = 8;
    S.tarpHeldNotes[t].clear();
    S.screenDirty = true;
}

export function resetSingleFxBank(t, bankIdx) {
    if (typeof host_module_set_param !== 'function') return;
    const dspCmd = { 1: 'pfx_noteFx_reset', 2: 'pfx_harm_reset', 3: 'pfx_delay_reset' }[bankIdx];
    if (!dspCmd) return;
    S.undoAvailable = true; S.redoAvailable = false;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        /* Defer the reset push (same coalescing concern as resetFxBanks). */
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_pfx_set', val: dspCmd + ' 1' });
        if (bankIdx === 3) {
            S.pendingDefaultSetParams.push({
                key: 't' + t + '_l' + lane + '_pfx_set',
                val: 'delay_level 127'
            });
        }
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_' + dspCmd, val: '1' });
        if (bankIdx === 3) {
            const _ac = S.trackActiveClip[t];
            S.pendingDefaultSetParams.push({
                key: 't' + t + '_c' + _ac + '_pfx_set',
                val: 'delay_level 127'
            });
        }
    }
    for (let k = 0; k < 8; k++) {
        const pm = BANKS[bankIdx].knobs[k];
        if (!pm) continue;
        S.bankParams[t][bankIdx][k] = pm.def;
    }
    S.screenDirty = true;
}

/* Conductor bank knob: knob k edits dAVEBOx track k's per-Conductor-clip value.
 * The Conductor's own track cell is inert. `delta` is signed knob detents.
 * RESPONDER/WHEN are single-fire toggles (any nonzero turn flips the value once);
 * OCTAVE increments/decrements by 1 per detent, clamped -4..+4. The JS mirror is
 * authoritative; we push the absolute new value per-Conductor-clip (tN_* key,
 * reaches DSP reliably; last-wins-per-buffer is correct since we push the final
 * value the mirror tracks). */
export function applyConductGridKnob(bank, k, delta) {
    if (delta === 0) return;
    /* While these banks are active, S.activeTrack IS the Conductor (the bank is
     * gated on trackPadMode[activeTrack]===CONDUCT). Use it + its live active
     * clip directly, rather than the S.conductorTrack / S.condActiveClip mirrors
     * which can be stale or -1 (e.g. a flaky single-tick load readback). */
    const N = S.activeTrack, c = S.trackActiveClip[N] | 0;
    if (N < 0 || S.trackPadMode[N] !== PAD_MODE_CONDUCT) return;
    if (k === N) return;                          /* own cell inert */
    /* Drum tracks never respond to the Conductor — all three per-track banks
     * (Responder/Octave/When) are non-editable ("--") for them. */
    if (S.trackPadMode[k] === PAD_MODE_DRUM) return;
    if (bank === BANK_RESPONDER) {
        S.condResp[c][k] = S.condResp[c][k] ? 0 : 1;     /* single-fire toggle */
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + N + '_c' + c + '_cond_resp', k + ' ' + S.condResp[c][k]);
    } else if (bank === BANK_OCTAVE) {
        const nv = Math.max(-4, Math.min(4, (S.condOct[c][k] | 0) + (delta > 0 ? 1 : -1)));
        S.condOct[c][k] = nv;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + N + '_c' + c + '_cond_oct', k + ' ' + nv);
    } else if (bank === BANK_WHEN) {
        S.condWhen[c][k] = S.condWhen[c][k] ? 0 : 1;     /* single-fire toggle */
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + N + '_c' + c + '_cond_when', k + ' ' + S.condWhen[c][k]);
    }
    S.screenDirty = true;
    forceRedraw();
}
