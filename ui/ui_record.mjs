/* ui_record.mjs
 * Real-time recording arm/disarm/handoff, DSP-side note-event buffering
 * (recordNoteOn/Off, flushed by tick() as a single batched set_param so
 * chords aren't lost to coalescing), and Tap Tempo capture. Also owns the
 * external-MIDI held-note broadcast (extNoteOffAll) since it shares the
 * recording note-off path.
 * Extracted from ui.js (Phase 5b prep, increment 2 of the modularity refactor).
 */

import {
    MoveRec, LED_OFF, PAD_MODE_DRUM, TAP_TEMPO_RESET_MS
} from './ui_constants.mjs';
import { setButtonLED } from '/data/UserData/schwung/shared/input_filter.mjs';
import { S } from './ui_state.mjs';
import { computePadNoteMap } from './ui_drummodel.mjs';
import { invalidateLEDCache } from './ui_leds.mjs';
/* Intentional ES-module cycle with ui_dsp_bridge.mjs (it imports disarmRecord
 * from here) — safe because both sides reference the cycled bindings only
 * inside function bodies, never at module-init time. Keep it that way. */
import { liveSendNote, _drumRecNoteOns, _drumRecNoteOffs } from './ui_dsp_bridge.mjs';

/* DSP-side recording: buffer note events; tick() flushes as a single batched set_param so
 * chords (multiple pads hit in the same ~5ms JS tick) are not lost to coalescing. */
export const _recordingNoteTrack = new Map(); /* pitch → track index, for matching note-offs */
export const extHeldNotes = new Map(); /* pitch → {track, recording} — external MIDI held notes */

/* Disarm real-time recording: clear DSP flag (triggers deferred save), update LED. */
export function disarmRecord() {
    if (!S.recordArmed) return;
    const t = S.recordArmedTrack;
    const _wasCountingIn   = S.recordCountingIn;
    S.recordArmed          = false;
    S.recordPendingPage    = false;
    S.recordCountingIn     = false;
    S.recordArmedTrack     = -1;
    S.countInStartTick    = -1;
    S.countInQuarterTicks = 0;
    _recordingNoteTrack.clear();
    S._recNoteOns.length   = 0;
    S._recNoteOffs.length  = 0;
    _drumRecNoteOns.length  = 0;
    _drumRecNoteOffs.length = 0;
    S.pendingPrerollNote          = null;
    S.pendingPrerollNotes         = [];
    S.pendingPrerollToggleQueue   = [];
    S.pendingPrerollGate          = null;
    if (t >= 0) {
        const _dat = S.trackActiveClip[t];
        S.clipAdaptiveMode[t][_dat] = false;
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
            S.pendingDrumResync      = 2;
            S.pendingDrumResyncTrack = t;
        }
    }
    S.recordScheduledStop       = false;
    S.recordScheduledStopTarget = -1;
    S.pendingScheduledDisarm    = false;
    if (typeof host_module_set_param === 'function') {
        if (_wasCountingIn) {
            /* Count-in active: only cancel is needed; sending _recording 0 would coalesce it away */
            host_module_set_param('record_count_in_cancel', '1');
        } else {
            if (t >= 0) {
                host_module_set_param('t' + t + '_recording', '0');
                /* Re-send the disarm across the next few ticks (drained in tick()):
                 * a single set_param can be coalesced away by another set_param
                 * sharing the same audio buffer (e.g. a knob-release on the AUTO
                 * bank), which would strand recording=1 and flood the lane. */
                S.recOffTrack = t;
                S.recOffTicks = 5;
            }
        }
    }
    setButtonLED(MoveRec, LED_OFF);
}

/* Move recording to a different track while staying armed. No-op if not actively recording. */
export function handoffRecordingToTrack(newTrack) {
    if (!S.recordArmed || S.recordCountingIn || newTrack === S.recordArmedTrack) return;
    const old = S.recordArmedTrack;
    _recordingNoteTrack.clear();
    S.recordArmedTrack      = newTrack;
    if (typeof host_module_set_param === 'function') {
        if (old >= 0) host_module_set_param('t' + old + '_recording', '0');
        host_module_set_param('t' + newTrack + '_recording', '1');
    }
}

/* ext (4th param): true when the note came from external cable-2 MIDI
 * (_onMidiExternalImpl). The tick flush prefixes ext entries with the
 * per-note 'e' marker in the tN_record_note_on/off payload; the DSP handler
 * then applies slot-if-active-else-fallback for ext notes (non-Move ext never
 * reaches on_midi, so it has no press slot to require — Path B), while plain
 * pad notes keep the slot requirement. Batches can mix pad + ext entries. */
export function recordNoteOn(pitch, velocity, rt, ext) {
    _recordingNoteTrack.set(pitch, rt);
    S._recNoteOns.push({pitch, vel: velocity, rt, ext: !!ext});
}

export function recordNoteOff(pitch, ext) {
    const rt = _recordingNoteTrack.get(pitch);
    if (rt === undefined) return;
    _recordingNoteTrack.delete(pitch);
    S._recNoteOffs.push({pitch, rt, ext: !!ext});
}


export function openTapTempo() {
    S.tapTempoOpen      = true;
    S.tapTempoTapTimes  = [];
    S.tapTempoBpm       = Math.max(40, Math.min(250, Math.round(parseFloat(host_module_get_param('bpm')) || 120)));
    S.tapTempoFlashTick = -1;
    S.tapTempoFlashPad  = -1;
    computePadNoteMap();
    invalidateLEDCache();
    S.screenDirty = true;
}

export function closeTapTempo() {
    S.tapTempoOpen = false;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('bpm', String(S.tapTempoBpm));
    computePadNoteMap();
    invalidateLEDCache();
    S.screenDirty = true;
}

export function registerTapTempo(padNote) {
    const nowMs  = Date.now();
    const taps   = S.tapTempoTapTimes;
    const last   = taps.length > 0 ? taps[taps.length - 1] : -1;
    const intvl  = last >= 0 ? nowMs - last : -1;

    /* Inactivity reset: gap exceeds 2s */
    if (intvl > TAP_TEMPO_RESET_MS) {
        S.tapTempoTapTimes = [nowMs];
    } else if (intvl > 0 && taps.length >= 2) {
        /* Deviation reset: new interval differs from previous by >~1.8x */
        const prevIntvl = taps[taps.length - 1] - taps[taps.length - 2];
        const ratio     = intvl / prevIntvl;
        if (ratio > 1.8 || ratio < 0.55) {
            /* Tempo change: keep last tap as anchor for new session */
            S.tapTempoTapTimes = [last, nowMs];
        } else {
            taps.push(nowMs);
            /* Sliding window: cap at last 9 taps (8 intervals) */
            if (taps.length > 9) S.tapTempoTapTimes = taps.slice(-9);
        }
    } else {
        taps.push(nowMs);
    }

    if (S.tapTempoTapTimes.length >= 2) {
        const t = S.tapTempoTapTimes;
        const n = t.length;
        const avgInterval = (t[n - 1] - t[0]) / (n - 1);
        if (avgInterval > 0) {
            S.tapTempoBpm = Math.max(40, Math.min(250, Math.round(60000 / avgInterval)));
            host_module_set_param('bpm', String(S.tapTempoBpm));
        }
    }
    S.tapTempoFlashTick = S.tickCount;
    S.tapTempoFlashPad  = padNote;
    S.screenDirty = true;
}

export function extNoteOffAll() {
    if (extHeldNotes.size === 0) return;
    for (const [pitch, info] of extHeldNotes) {
        /* Ext-origin tag for non-Move routes only (mirrors the
         * _onMidiExternalImpl guards): ROUTE_MOVE ext is played natively by
         * Move and must not generate ext live tokens. */
        liveSendNote(info.track, 0x80, pitch, 0, false, S.trackRoute[info.track] !== 1);
        if (info.recording) recordNoteOff(pitch, true);
    }
    extHeldNotes.clear();
}
