/* ui_input_pads.mjs
 * Pad + step-button input family: track-view/session pad press, plain pad
 * press/release, aftertouch/pressure routing, step-button edit-grid input,
 * and the Loop+step gesture helpers (window-set fire + resolve) shared by
 * both. ui_input_cc (the larger sibling family) extracts next and imports
 * _resolveLoopGesture from here.
 * Extracted from ui.js (Phase 5b, increment 6 of the modularity refactor).
 */

import {
    NUM_TRACKS, TRACK_PAD_BASE, DRUM_LANES,
    PAD_MODE_DRUM, PAD_MODE_CONDUCT, BANKS,
    BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN,
    NO_NOTE_FLASH_TICKS
} from './ui_constants.mjs';
import { S } from './ui_state.mjs';
import { drumPadToLane, drumPadToVelZone, drumVelZoneToVelocity, _clipIsEmpty,
    clipHasContent, effectiveVelocity, stepEntryVelocity,
    ARP_VEL_CANON, arpVelLevel, VEL_THRU } from './ui_pure.mjs';
import { showActionPopup, writeSidecar } from './ui_persistence.mjs';
import { computePadNoteMap, syncDrumLaneSteps, setActiveDrumLane,
    setDrumPerformMode } from './ui_drummodel.mjs';
import { effectiveClip, invalidateLEDCache, forceRedraw, sendPerfMods,
    PERF_MOD_PAD_MAP } from './ui_leds.mjs';
import { exitSchwungCoRun, exitMoveNativeCoRun } from './ui_corun.mjs';
import { openGlobalMenu } from './ui_menu.mjs';
import { applyBankParam, applyTrackConfig, readBankParams,
    refreshPerClipBankParams, refreshDrumLaneBankParams, refreshSeqNotesIfCurrent,
    resyncDrumTrack, liveSendNote,
    pendingDrumNoteOffs, _drumRecNoteOns, _drumRecNoteOffs } from './ui_dsp_bridge.mjs';
import { handoffRecordingToTrack, recordNoteOn, recordNoteOff,
    openTapTempo, registerTapTempo, extNoteOffAll } from './ui_record.mjs';
import { setTrackMute, setTrackSolo, clearClip, hardResetClip, copyClip, cutClip,
    copyDrumLane, cutDrumLane, copyDrumClip, cutDrumClip, copyStep, clearStep,
    showModePopup, allLanesGate, doDoubleFill, doLaneDoubleFill,
    _switchActiveTrack } from './ui_editops.mjs';

/* Performance Mode state. Session View + Loop held → pad grid shows Perf Mode.
 * S.perfStack: currently-held R0 length pads (same stack semantics as old looper
 * step stack; rate captured at press time). Top = active rate.
 * S.perfModsToggled: latched modifier bitmask (Latch-toggle presses).
 * S.perfModsHeld: momentary bitmask (held mod pads, not Latch-pressed).
 * DSP receives (S.perfModsToggled | S.perfModsHeld) as perf_mods each change. */
const LOOPER_RATES_STRAIGHT = [12, 24, 48, 96, 192];   /* 1/32, 1/16, 1/8, 1/4, 1/2 */
const PERF_MOD_FULL_NAMES = [
    'Octave Up','Octave Down','Scale Up','Scale Down','Fifth','Tritone','Drift','Storm',
    'Decrescendo','Swell','Crescendo','Pulse','Sidechain','Staccato','Legato','Ramp Gate',
    'Half Time','3 Skip','Phantom','Sparse','Glitch','Stagger','Shuffle','Backwards',
];

/* Preset S.snapshots: 16 slots (step buttons 1-16).
 * S.perfRecalledSlot: which slot is active (-1 = none); preset bits are
 * copied into S.perfModsToggled on recall so mod pads can toggle them off.
 * Factory presets populate slots 0-7 (steps 1-8) at init. */
const PERF_MOD_POPUP_TICKS = 47; /* ~500ms at 94Hz (was 80, assuming ~160 ticks/s) */

/* Per-pad pitch sent at note-on — ensures matching note-off even if map changes mid-hold. */
const padPitch = new Array(32).fill(-1);
const padPressTick = new Array(32).fill(-1);  /* tick when each pad was pressed, for drum tap-vs-hold detection */
const DRUM_TAP_TICKS = 10;  /* ~30ms — taps shorter than this suppress the release note-off */

function _onPadPressTrackView(status, d1, d2) {

    if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
        const padIdx = d1 - TRACK_PAD_BASE;


        /* Drum lane RESET: Shift+Delete+lane pad — full factory reset (length,
         * loop, pfx, Rpt groove all wiped). midi_note is preserved (lane
         * identity). */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.shiftHeld && S.deleteHeld) {
            const t    = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES) {
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_hard_reset', '1');
                setActiveDrumLane(t, lane);
                S.drumLaneLength[t]     = 16;
                for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                S.drumLaneHasNotes[t][lane] = false;
                /* Per-lane Rpt1 + Rpt2 groove reset to fresh-session defaults
                 * (matches drum_repeat_init_defaults + doClearSession). */
                S.drumRepeatGate[t][lane] = 0xFF;
                for (let _s = 0; _s < 8; _s++) {
                    S.drumRepeatVelScale[t][lane][_s] = 100;
                    S.drumRepeatNudge[t][lane][_s]    = 0;
                }
                S.drumRepeat2RatePerLane[t][lane] = 0;
                const ac = S.trackActiveClip[t];
                S.drumClipNonEmpty[t][ac] = false;
                for (let ol = 0; ol < DRUM_LANES; ol++) {
                    if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                }
                /* Defer refreshDrumLaneBankParams via pendingDrumLaneResync so it
                 * runs AFTER DSP _hard_reset has drained (2 ticks). Synchronous
                 * refresh was reading pre-reset DSP values, leaving NOTE FX /
                 * DELAY mirrors un-defaulted. */
                S.pendingDrumLaneResync      = 2;
                S.pendingDrumLaneResyncTrack = t;
                S.pendingDrumLaneResyncLane  = lane;
                showActionPopup('LANE', 'RESET');
                forceRedraw();
            }
            return;
        }

        /* Drum lane CLEAR: Delete+lane pad (no shift) — notes-only clear,
         * preserves length, loop window, pfx params, midi_note. Undoable. */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && !S.shiftHeld && S.deleteHeld) {
            const t    = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES) {
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_clear', '1');
                setActiveDrumLane(t, lane);
                for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                S.drumLaneHasNotes[t][lane] = false;
                const ac = S.trackActiveClip[t];
                S.drumClipNonEmpty[t][ac] = false;
                for (let ol = 0; ol < DRUM_LANES; ol++) {
                    if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                }
                showActionPopup('LANE', 'CLEARED');
                forceRedraw();
            }
            return;
        }
        /* Drum Repeat mode pad handling (intercepts left 4 cols when S.drumPerformMode===1) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.drumPerformMode[S.activeTrack] === 1 &&
                !S.shiftHeld && !S.copyHeld && !S.muteHeld) {
            const t   = S.activeTrack;
            const col = padIdx % 8;
            const row = Math.floor(padIdx / 8);
            if (col >= 4 && row < 2) {
                /* Rate pad (right side, bottom 2 rows): start/retrigger repeat */
                const rateIdx = row * 4 + (col - 4);
                const lane    = S.activeDrumLane[t];
                const vel     = d2;
                if (S.drumRepeatLatched[t] && S.drumRepeatHeldPad[t] === padIdx) {
                    /* Same latched pad pressed again: unlatch and stop.
                     * Phase 1 / Bundle 2C-Rpt1: on patched Schwung, DSP
                     * drum_pad_event detects the same gesture synchronously
                     * on the audio thread (reads tr->drum_repeat_latched
                     * mirror) and calls drum_repeat_stop_internal — closes
                     * the JS-tick race that would otherwise fire one extra
                     * repeat at fast rates. The set_param below stays as
                     * idempotent backstop + stock-Schwung path. */
                    S.drumRepeatLatched[t]  = false;
                    S.drumRepeatHeldPad[t]  = -1;
                    S.drumRepeatHeldPadsStack[t].length = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                } else {
                    /* New rate or held: push previous held pad so release can resume it */
                    if (S.drumRepeatHeldPad[t] >= 0 && !S.drumRepeatLatched[t]) {
                        const _pp = S.drumRepeatHeldPad[t];
                        const _pr = Math.floor(_pp / 8) * 4 + (_pp % 8) - 4;
                        S.drumRepeatHeldPadsStack[t].push({ padIdx: _pp, rateIdx: _pr, vel: S.drumRepeatHeldPadVel[t] });
                    }
                    S.drumRepeatHeldPad[t]    = padIdx;
                    S.drumRepeatHeldPadVel[t] = vel;
                    S.drumRepeatLatched[t]    = S.loopHeld;
                    if (typeof host_module_set_param === 'function') {
                        /* Phase 1 / Bundle 2C-Rpt1: on patched Schwung the
                         * audio-thread drum_pad_event has already called
                         * drum_repeat_start_internal for this press. Firing
                         * the set_param here too would re-prime phase=0
                         * after the first hit has already played, producing
                         * an audible double-trigger. Gate to stock-only.
                         * The release-side stack-resume drum_repeat_start
                         * push (elsewhere in this file) is NOT gated — DSP
                         * doesn't classify release events, so JS owns that
                         * path on both stock and patched. */
                        if (!S.dspInboundEnabled)
                            host_module_set_param('t' + t + '_drum_repeat_start', lane + ' ' + rateIdx + ' ' + vel);
                        /* Latched flag — JS is authoritative DSP-side after
                         * the 2C-Rpt2 fix removed the defensive clear in
                         * drum_repeat_start_internal. Push BOTH 0 and 1 so
                         * a rate-switch-while-latched-without-Loop (JS sets
                         * drumRepeatLatched=false) correctly clears the bit.
                         * Lets drum_pad_event detect re-tap-to-unlatch on
                         * the audio thread with zero JS-tick race. */
                        host_module_set_param('t' + t + '_drum_repeat_latched', S.loopHeld ? '1' : '0');
                    }
                }
                S.screenDirty = true;
                return;
            } else if (col >= 4 && row >= 2) {
                /* Gate mask pad (right side, top 2 rows) */
                const lane = S.activeDrumLane[t];
                const step = (row - 2) * 4 + (col - 4);
                if (S.deleteHeld) {
                    /* Delete + gate pad: reset vel_scale and nudge for this step */
                    S.drumRepeatVelScale[t][lane][step] = 100;
                    S.drumRepeatNudge[t][lane][step]    = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_defaults', String(step));
                } else if (S.loopHeld) {
                    /* Loop + gate pad: set gate cycle length and fill mask to steps 0..step */
                    const gLen = step + 1;
                    const fillMask = (1 << gLen) - 1;
                    S.drumRepeatGate[t][lane] = fillMask;
                    S.drumRepeatGateLen[t][lane] = gLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_and_len', fillMask + ' ' + gLen);
                } else {
                    /* Tap: toggle gate bit */
                    S.drumRepeatGate[t][lane] = (S.drumRepeatGate[t][lane] ^ (1 << step)) & 0xFF;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_toggle', String(step));
                }
                forceRedraw();
                return;
            }
        }
        /* Drum Repeat 2 mode pad handling (multi-lane simultaneous repeat) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.drumPerformMode[S.activeTrack] === 2 &&
                !S.shiftHeld && !S.copyHeld && !S.muteHeld) {
            const t   = S.activeTrack;
            const col = padIdx % 8;
            const row = Math.floor(padIdx / 8);
            if (col >= 4 && row < 2) {
                /* Rate pad: assign rate to active lane.
                 * Phase 1 / Bundle 2C-Rpt2: on patched Schwung drum_pad_event
                 * already called drum_repeat2_rate_internal on the audio
                 * thread; firing the set_param here would be redundant. */
                const rateIdx = row * 4 + (col - 4);
                const lane = S.activeDrumLane[t];
                S.drumRepeat2RatePerLane[t][lane] = rateIdx;
                if (typeof host_module_set_param === 'function' && !S.dspInboundEnabled)
                    host_module_set_param('t' + t + '_drum_repeat2_rate', lane + ' ' + rateIdx);
                S.screenDirty = true;
                return;
            } else if (col >= 4 && row >= 2) {
                /* Gate mask: same as Rpt mode */
                const lane = S.activeDrumLane[t];
                const step = (row - 2) * 4 + (col - 4);
                if (S.deleteHeld) {
                    S.drumRepeatVelScale[t][lane][step] = 100;
                    S.drumRepeatNudge[t][lane][step]    = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_defaults', String(step));
                } else if (S.loopHeld) {
                    /* Loop + gate pad: set gate cycle length and fill mask to steps 0..step */
                    const gLen = step + 1;
                    const fillMask = (1 << gLen) - 1;
                    S.drumRepeatGate[t][lane] = fillMask;
                    S.drumRepeatGateLen[t][lane] = gLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_and_len', fillMask + ' ' + gLen);
                } else {
                    S.drumRepeatGate[t][lane] = (S.drumRepeatGate[t][lane] ^ (1 << step)) & 0xFF;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_toggle', String(step));
                }
                forceRedraw();
                return;
            } else if (col < 4 && !S.deleteHeld) {
                /* Lane pad: add/unlatch multi-lane repeat.
                 * Phase 1 / Bundle 2C-Rpt2: on patched Schwung drum_pad_event
                 * already toggled the lane via drum_repeat2_lane_on/off_internal
                 * on the audio thread. The set_params here stay as the stock
                 * Schwung path. JS-side bookkeeping (HeldLanes/LatchedLanes
                 * Sets) is parallel state for OLED display — stays correct
                 * because JS and DSP run the same toggle logic. */
                const lane = drumPadToLane(padIdx);
                if (lane >= 0 && lane < DRUM_LANES) {
                    setActiveDrumLane(t, lane);
                    syncDrumLaneSteps(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    if (S.drumRepeat2LatchedLanes[t].has(lane)) {
                        S.drumRepeat2LatchedLanes[t].delete(lane);
                        if (typeof host_module_set_param === 'function' && !S.dspInboundEnabled)
                            host_module_set_param('t' + t + '_drum_repeat2_lane_off', String(lane));
                        if (S.loopHeld) S.rpt2LoopPadUsed = true;
                    } else {
                        S.drumRepeat2HeldLanes[t].add(lane);
                        if (S.loopHeld) { S.drumRepeat2LatchedLanes[t].add(lane); S.rpt2LoopPadUsed = true; }
                        padPitch[padIdx] = -1;
                        if (typeof host_module_set_param === 'function') {
                            if (!S.dspInboundEnabled)
                                host_module_set_param('t' + t + '_drum_repeat2_lane_on', lane + ' ' + d2);
                            /* Phase 1 / Bundle 2C-Rpt2: Loop-held latch via
                             * the atomic latch_held set_param (handler ORs
                             * active|pending into latched). Avoids the
                             * coalescing trap of per-lane edge pushes: when
                             * multiple lanes are pressed simultaneously with
                             * Loop held, each press would push the same
                             * set_param key with a different lane payload
                             * → only the last lane would land. Non-Loop
                             * engagement needs no push (latched bit is 0
                             * by invariant: previously-latched lanes go
                             * through the unlatch path, not the engage path). */
                            if (S.loopHeld)
                                host_module_set_param('t' + t + '_drum_repeat2_latch_held', '1');
                        }
                    }
                    forceRedraw();
                }
                return;
            }
        }
        /* (Capture + drum pad silent lane select removed 2026-07-18 — Capture
         * is capture-only now. The gesture is PARKED pending a new home.) */
        /* Drum mode pad handling */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && (!S.shiftHeld || S.muteHeld || S.copyHeld)) {
            const t = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            const velZone = drumPadToVelZone(padIdx);
            if (velZone >= 0) {
                /* Velocity pad: which pad determines the zone; zone determines velocity.
                 * Pad pressure is ignored — zone vel used for monitoring, step-edit, recording. */
                S.drumLastVelZone[t] = velZone;
                S.drumVelZoneArmed[t] = true;
                const zoneVel  = drumVelZoneToVelocity(velZone);
                const lane_vp  = S.activeDrumLane[t];
                const laneNote = S.drumLaneNote[t][lane_vp];
                liveSendNote(t, 0x90, laneNote, zoneVel, true);
                padPitch[padIdx] = laneNote;
                padPressTick[padIdx] = S.tickCount;
                S.liveActiveNotes.add(laneNote);
                if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
                    /* Active vel-pad press while step held → zone wins (beats VelIn) */
                    const _heldWriteVel = stepEntryVelocity(t, zoneVel, true);
                    S.stepEditVel = _heldWriteVel;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane_vp + '_step_' + S.heldStep + '_vel', String(_heldWriteVel));
                    S.stepBtnPressedTick[S.heldStepBtn] = -1;
                }
                /* Record hit at zone velocity if armed */
                if (S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack) {
                    _drumRecNoteOns.push({ track: t, laneNote: laneNote, vel: zoneVel });
                    /* Monitor: DSP drum_record_note_on inline-fires live_note_on for
                     * ROUTE_MOVE, so a separate live_notes set_param here would just
                     * coalesce with the record payload. Mirrors melodic recording. */
                    S.pendingDrumLaneResync      = 3;
                    S.pendingDrumLaneResyncTrack = t;
                    S.pendingDrumLaneResyncLane  = lane_vp;
                }
                S.screenDirty = true;
            } else if (lane >= 0 && lane < DRUM_LANES && S.copyHeld && !S.muteHeld) {
                /* Copy+lane pad: drum lane copy/cut gesture (same track, active clip) */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_drum_lane', track: t, lane: lane }
                        : { kind: 'drum_lane',     track: t, lane: lane };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'drum_lane' && S.copySrc.track === t) {
                    copyDrumLane(t, S.copySrc.lane, lane);
                    setActiveDrumLane(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_drum_lane' && S.copySrc.track === t) {
                    cutDrumLane(t, S.copySrc.lane, lane);
                    S.copySrc = { kind: 'drum_lane', track: t, lane: lane };
                    setActiveDrumLane(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* Other S.copySrc kinds or cross-track: swallow */
            } else if (lane >= 0 && lane < DRUM_LANES && S.muteHeld) {
                /* Mute+pad: toggle lane mute; Shift+Mute+pad: toggle lane solo */
                S.muteUsedAsModifier = true;
                const bit = 1 << lane;
                if (S.shiftHeld) {
                    const wasOn = !!(S.drumLaneSolo[t] & bit);
                    if (wasOn) { S.drumLaneSolo[t] &= ~bit; }
                    else {
                        S.drumLaneSolo[t] |= bit;
                        if (S.drumLaneMute[t] & bit) {
                            S.drumLaneMute[t] &= ~bit;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_mute', '0');
                        }
                    }
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_solo', wasOn ? '0' : '1');
                } else {
                    const wasOn = !!(S.drumLaneMute[t] & bit);
                    if (wasOn) { S.drumLaneMute[t] &= ~bit; }
                    else {
                        S.drumLaneMute[t] |= bit;
                        if (S.drumLaneSolo[t] & bit) {
                            S.drumLaneSolo[t] &= ~bit;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_solo', '0');
                        }
                    }
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_mute', wasOn ? '0' : '1');
                }
                forceRedraw();
            } else if (lane >= 0 && lane < DRUM_LANES) {
                if (S.deleteHeld) {
                    /* Delete + lane pad: clear all steps in this lane */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_clear', '1');
                    setActiveDrumLane(t, lane);
                    for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                    S.drumLaneHasNotes[t][lane] = false;
                    const ac = S.trackActiveClip[t];
                    S.drumClipNonEmpty[t][ac] = false;
                    for (let ol = 0; ol < DRUM_LANES; ol++) {
                        if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                    }
                    refreshDrumLaneBankParams(t, lane);
                    showActionPopup('LANE CLEARED');
                    forceRedraw();
                } else {
                    /* Lane pad: select lane, sync its steps and bank params.
                     * On the AUTO bank (6) the pads are play-only (gray, parity with
                     * melodic) — skip lane-selection so a pad press auditions the drum
                     * sound without changing which lane the editor is on. */
                    if (S.activeBank !== 6) {
                        setActiveDrumLane(t, lane);
                        syncDrumLaneSteps(t, lane);
                        refreshDrumLaneBankParams(t, lane);
                    }
                    if (S.moveCoRunTrack >= 0) {
                        /* Move co-run: the plain pad-on injected to Move (in _onPadPress)
                         * both sounds and selects this drum cell for editing. Suppress
                         * dAVEBOx's own monitor note + record so the tap is one Move-native
                         * hit, not a double. padPitch=0xFF makes _onPadRelease skip the
                         * dAVEBOx note-off too (same sentinel the Capture+pad select uses).
                         * Lane selection/sync above still runs so dAVEBOx state stays in
                         * sync; the held pad-off to Move is sent from _onPadRelease. */
                        padPitch[padIdx] = 0xFF;
                        forceRedraw();
                    } else {
                    /* Preview lane note at actual pad velocity */
                    const vel = effectiveVelocity(d2);
                    const laneNote = S.drumLaneNote[t][lane];
                    liveSendNote(t, 0x90, laneNote, vel);
                    padPitch[padIdx] = laneNote;
                    padPressTick[padIdx] = S.tickCount;
                    S.liveActiveNotes.add(laneNote);
                    /* Record step hit if armed */
                    if (S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack) {
                        const tvo = S.trackVelOverride[t];
                        const recVel = tvo > 0 ? tvo : vel;
                        _drumRecNoteOns.push({ track: t, laneNote: laneNote, vel: recVel });
                        /* Monitor: DSP drum_record_note_on inline-fires live_note_on for
                         * ROUTE_MOVE; explicit queueLiveNoteOn here would coalesce. */
                        S.pendingDrumLaneResync      = 3;
                        S.pendingDrumLaneResyncTrack = t;
                        S.pendingDrumLaneResyncLane  = lane;
                    }
                    /* Pre-roll capture: any press during count-in → deferred to step 0 after transport starts */
                    if (S.recordArmed && S.recordCountingIn && t === S.recordArmedTrack) {
                        const tvo = S.trackVelOverride[t];
                        const recVel = tvo > 0 ? tvo : vel;
                        S.pendingPrerollNote = { track: t, lane: lane, laneNote: laneNote,
                                                 vel: recVel, isDrum: true,
                                                 pressedAtTick: S.tickCount, countInStart: S.countInStartTick };
                    }
                    /* Phase 1 / Bundle 2C-Rpt1+Rpt2: lane-swap-while-holding-a-rate-pad.
                     * On patched Schwung drum_pad_event has called
                     * drum_repeat_lane_internal on the audio thread (folded
                     * into Bundle 2C-Rpt2 once drum_lane_page mirror was
                     * available). Set_param push kept as the stock fallback. */
                    if (S.drumPerformMode[t] === 1 && (S.drumRepeatHeldPad[t] >= 0 || S.drumRepeatLatched[t])) {
                        if (typeof host_module_set_param === 'function' && !S.dspInboundEnabled)
                            host_module_set_param('t' + t + '_drum_repeat_lane', String(lane));
                    }
                    forceRedraw();
                    }
                }
            }
        } else if (S.heldStep >= 0 && !S.shiftHeld) {
            /* Step edit: tap pad to toggle note assignment for held step */
            if (S.padNoteMap[padIdx] === 0xFF) return; /* OOB pad — no note to toggle */
            const ac    = effectiveClip(S.activeTrack);
            const _pitchRaw = S.padNoteMap[padIdx] + S.trackOctave[S.activeTrack] * 12;
            if (_pitchRaw < 0 || _pitchRaw > 127) return; /* OOB after track-octave shift */
            const pitch = _pitchRaw;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + S.activeTrack + '_c' + ac + '_step_' + S.heldStep + '_toggle', pitch + ' ' + stepEntryVelocity(S.activeTrack, effectiveVelocity(d2), false));
            /* Read back authoritative note list */
            const raw = typeof host_module_get_param === 'function'
                ? host_module_get_param('t' + S.activeTrack + '_c' + ac + '_step_' + S.heldStep + '_notes')
                : null;
            S.heldStepNotes = (raw && raw.trim().length > 0)
                ? raw.trim().split(' ').map(Number).filter(n => n >= 0 && n <= 127)
                : [];
            /* Mirror step active state in JS */
            S.clipSteps[S.activeTrack][ac][S.heldStep] = S.heldStepNotes.length > 0 ? 1 : 0;
            if (S.heldStepNotes.length > 0) {
                S.clipNonEmpty[S.activeTrack][ac] = true;
            } else if (S.clipNonEmpty[S.activeTrack][ac]) {
                S.clipNonEmpty[S.activeTrack][ac] = clipHasContent(S.activeTrack, ac);
            }
            refreshSeqNotesIfCurrent(S.activeTrack, ac, S.heldStep);
            /* Preview note */
            padPitch[padIdx] = pitch;
            S.liveActiveNotes.add(pitch);
            liveSendNote(S.activeTrack, 0x90, pitch, effectiveVelocity(d2));
            forceRedraw();
        } else if (S.shiftHeld && padIdx >= 24 && padIdx <= 31) {
            const _padOff = padIdx - 24;
            const _isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
            const _isConduct = S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT;
            let bankIdx;
            if (_isDrum) {
                /* Drum pad map: 92=ALL LANES(7) 93=DRUM LANE(0) 94=NOTE FX(1)
                                 95=MIDI DLY(3) 96=RPT GROOVE(5) 97=hidden
                                 98=CC PARAM(6) 99=hidden */
                const DRUM_PAD_MAP = [7, 0, 1, 3, 5, -1, 6, -1];
                bankIdx = DRUM_PAD_MAP[_padOff];
            } else if (_isConduct) {
                /* Conductor reaches only its five banks: pads 0-4 select
                   CONDUCT(0)/NOTE FX(1)/RESPONDER/OCTAVE/WHEN; pads 5-7 are no-ops.
                   First five entries must stay in lockstep with ui_pure's
                   CONDUCT_BANK_CYCLE (kept a parallel literal, like DRUM_PAD_MAP). */
                const CONDUCT_PAD_MAP = [0, 1, BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN, -1, -1, -1];
                bankIdx = CONDUCT_PAD_MAP[_padOff];
            } else {
                bankIdx = _padOff;
            }
            /* 8-10 reachable only via CONDUCT_PAD_MAP; drum/melodic cap at 7 */
            if (bankIdx >= 0 && bankIdx < BANKS.length && BANKS[bankIdx]) {
                if (S.activeBank === bankIdx) {
                    S.bankSelectTick = -1;
                } else {
                    S.activeBank = bankIdx;
                    S.trackActiveBank[S.activeTrack] = bankIdx;
                    if (bankIdx === 7) S.allLanesConfirmed = false;
                    if (bankIdx === 6) S.schLabelFetchLane = 0;
                    readBankParams(S.activeTrack, bankIdx);
                    S.bankSelectTick = S.tickCount;
                    writeSidecar();
                }
                S.screenDirty = true;
            }
        } else if (S.shiftHeld && padIdx < NUM_TRACKS) {
            /* Shift + bottom-row pad: select active track */
            extNoteOffAll();
            handoffRecordingToTrack(padIdx);
            _switchActiveTrack(padIdx);
            refreshPerClipBankParams(padIdx);
            computePadNoteMap();
            S.seqActiveNotes.clear();
            S.seqLastStep = -1;
            S.seqLastClip = -1;
            /* Sync drum lane metadata for the new track */
            if (S.trackPadMode[padIdx] === PAD_MODE_DRUM) {
                /* Fall back from banks hidden on drum tracks */
                if (S.activeBank === 2 || S.activeBank === 4) S.activeBank = 0;
                resyncDrumTrack(padIdx);
            } else {
                if (S.activeBank === 7) S.activeBank = 0;
            }
            S.screenDirty = true;
        } else if (!S.shiftHeld) {
            /* Live note — apply per-track octave shift; skip OOB to avoid ghost
             * dispatches of clamped note 0 (or 127) when multiple pads' shifted
             * pitches land outside [0,127]. */
            const basePitch = S.padNoteMap[padIdx];
            if (basePitch === 0xFF) return; /* OOB base */
            const _pitchRaw = basePitch + S.trackOctave[S.activeTrack] * 12;
            if (_pitchRaw < 0 || _pitchRaw > 127) return; /* OOB after track-octave shift */
            const pitch = _pitchRaw;
            padPitch[padIdx] = pitch;
            S.atLastSent[padIdx] = -1;   /* fresh press → next aftertouch always sends */
            S.lastPlayedNote  = pitch;
            S.lastPadVelocity = effectiveVelocity(d2);
            S.liveActiveNotes.add(pitch);
            liveSendNote(S.activeTrack, 0x90, pitch, effectiveVelocity(d2));
            /* Record capture: queue into _recNoteOns regardless of count-in
             * state. Flush is gated on !S.recordCountingIn so events accumulate
             * during count-in and drain at the count-in→recording transition.
             * DSP authoritatively filters: on patched Schwung, presses without
             * an active on_midi slot are dropped (early count-in window etc.),
             * so JS doesn't need its own (rate-mismatched) timing filter. */
            if (S.recordArmed && S.activeTrack === S.recordArmedTrack)
                recordNoteOn(pitch, effectiveVelocity(d2), S.recordArmedTrack);
        }
    }
}

export function _onPadPress(status, d1, d2) {
        /* Move-native co-run + drum-mode active track: inject a PLAIN pad-on
         * (cable-0, no Shift) so Move firmware both plays the drum AND focuses
         * that cell for editing — a plain tap selects on Move. dAVEBOx then
         * SUPPRESSES its own monitor note for this pad (see the moveCoRunTrack
         * branch in _onPadPressTrackView), so the tap is a single Move-native
         * hit, not a double. No Shift injection anywhere → nothing for Move to
         * latch (an earlier Shift-based scheme double-tap-latched Move's Shift).
         * Mask: left 4 columns of each pad row, where notes 68-99 are laid out
         * bottom-to-top as 68-75 / 76-83 / 84-91 / 92-99 — left-4x4 is
         * (d1 - 68) % 8 < 4. Note-on (status 0x9_) with d2 > 0 only. Pass the
         * actual pad velocity (d2) through so Move plays at the hit velocity,
         * just like a real physical pad press. The pad stays open until physical
         * release (_onPadRelease sends the matching pad-off). */
        if (S.moveCoRunTrack >= 0 &&
                S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM &&
                d1 >= 68 && d1 <= 99 && ((d1 - 68) % 8) < 4 &&
                (status & 0xF0) === 0x90 && d2 > 0 &&
                typeof move_midi_inject_to_move === 'function') {
            move_midi_inject_to_move([0x09, 0x90, d1, d2 & 0x7F]);  /* plain pad on at hit velocity — held until release */
            S.moveCoRunDrumHeld.add(d1);
        }
        if (S.tapTempoOpen && d1 >= 68 && d1 <= 99) {
            registerTapTempo(d1);
            return;
        }
        /* Arp Steps interval mode (jog-clicked into bank 4): pad press = step vel level edit.
         * Column = step (0..7); row sets level (1=bottom..4=top). Bottom-row
         * press when already at level 1 → level 0 (step off). Persistent (no Steps Mode gate).
         * Loop-held: pad column sets step pattern loop length (1..8). */
        if (!S.sessionView && S.stepIntervalMode && S.activeBank === 4 &&
                d1 >= 68 && d1 <= 99) {
            const idx = d1 - 68;
            const col = idx % 8;
            const t   = S.activeTrack;
            const ac  = effectiveClip(t);
            if (S.loopHeld) {
                const newLen = col + 1;
                if (S.seqArpStepLoopLen[t][ac] !== newLen) {
                    S.seqArpStepLoopLen[t][ac] = newLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_seq_arp_step_loop_len', String(newLen));
                    forceRedraw();
                }
                return;
            }
            /* Pads write the coarse canonical velocities; knobs (Shift page)
             * write fine values that display as the nearest pad level. */
            const row = Math.floor(idx / 8);
            const cur = S.seqArpStepVel[t][ac][col] | 0;
            const curLvl = arpVelLevel(cur);
            const newVel = S.deleteHeld ? VEL_THRU
                : (row === 0 && curLvl === 1) ? 0 : ARP_VEL_CANON[row + 1];
            if (newVel !== cur) {
                S.seqArpStepVel[t][ac][col] = newVel;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_seq_arp_step_vel', col + ' ' + newVel);
                forceRedraw();
            }
            return;
        }
        /* Arp Steps interval mode (jog-clicked into bank 5 = TARP): pad press = step vel level edit.
         * Loop-held: pad column sets step pattern loop length (1..8). */
        if (!S.sessionView && S.stepIntervalMode && S.activeBank === 5 &&
                d1 >= 68 && d1 <= 99) {
            const idx = d1 - 68;
            const col = idx % 8;
            const t   = S.activeTrack;
            if (S.loopHeld) {
                const newLen = col + 1;
                if (S.tarpStepLoopLen[t] !== newLen) {
                    S.tarpStepLoopLen[t] = newLen;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_tarp_step_loop_len', String(newLen));
                    forceRedraw();
                }
                return;
            }
            /* Coarse canonical velocities (see the SEQ ARP branch above). */
            const row = Math.floor(idx / 8);
            const cur = S.tarpStepVel[t][col] | 0;
            const curLvl = arpVelLevel(cur);
            const newVel = S.deleteHeld ? VEL_THRU
                : (row === 0 && curLvl === 1) ? 0 : ARP_VEL_CANON[row + 1];
            if (newVel !== cur) {
                S.tarpStepVel[t][col] = newVel;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_tarp_step_vel', col + ' ' + newVel);
                forceRedraw();
            }
            return;
        }
        /* Performance Mode pad intercept: absorb all pad presses when Perf Mode is active. */
        if (S.sessionView && (S.loopHeld || S.perfViewLocked) && d1 >= 68 && d1 <= 99) {
            if (d1 >= 68 && d1 <= 75) {
                /* R0: rate pads 0-4 (arm/stack), hold (5), sync (6), latch (7) */
                const subIdx = d1 - 68;
                if (subIdx === 7) {
                    S.perfLatchPressedTick = S.tickCount;
                } else if (subIdx === 6) {
                    S.perfSync = !S.perfSync;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('looper_sync', S.perfSync ? '1' : '0');
                } else if (subIdx === 5) {
                    /* Hold pad: in sticky mode → cancel sticky + stop loop.
                     * Otherwise → momentary hold (length releases don't pop while held). */
                    if (S.perfStickyLengths.size > 0) {
                        S.perfStickyLengths = new Set();
                        S.perfStack         = [];
                        if (!S.loopHeld) S.perfViewLocked = false;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('looper_stop', '1');
                    } else {
                        S.perfHoldPadHeld = true;
                    }
                } else {
                    const ticks = LOOPER_RATES_STRAIGHT[subIdx];
                    if (S.shiftHeld) {
                        /* Shift+length toggles sticky hold for that length */
                        if (S.perfStickyLengths.has(subIdx)) {
                            /* Remove sticky + pop from stack */
                            S.perfStickyLengths.delete(subIdx);
                            const sIdx = S.perfStack.findIndex(function(e) { return e.idx === subIdx; });
                            if (sIdx >= 0) S.perfStack.splice(sIdx, 1);
                            if (typeof host_module_set_param === 'function') {
                                if (S.perfStack.length === 0) host_module_set_param('looper_stop', '1');
                                else host_module_set_param('looper_arm', String(S.perfStack[S.perfStack.length - 1].ticks));
                            }
                            if (S.perfStickyLengths.size === 0 && !S.loopHeld) S.perfViewLocked = false;
                        } else {
                            /* Add sticky + ensure on stack + lock view */
                            S.perfStickyLengths.add(subIdx);
                            if (S.perfStack.findIndex(function(e) { return e.idx === subIdx; }) < 0) {
                                S.perfStack.push({ idx: subIdx, ticks: ticks });
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('looper_arm', String(ticks));
                            }
                            S.perfViewLocked = true;
                        }
                    } else {
                        const inStack = S.perfStack.findIndex(function(e) { return e.idx === subIdx; }) >= 0;
                        const inHeld  = S.perfStickyLengths.has(subIdx) || S.perfHoldPadHeld;
                        if (!inStack) {
                            S.perfStack.push({ idx: subIdx, ticks: ticks });
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_arm', String(ticks));
                        } else if (inHeld) {
                            /* Re-trigger capture for a held loop: atomic stop + arm */
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_retrigger', String(ticks));
                        }
                    }
                }
            } else {
                const modIdx = PERF_MOD_PAD_MAP[d1];
                if (modIdx !== undefined) {
                    const bit = (1 << modIdx);
                    if (S.perfLatchMode) {
                        S.perfModsToggled ^= bit;
                    } else if (S.perfModsToggled & bit) {
                        /* Non-latch press on an already-on bit (e.g. from preset recall):
                         * clear it instead of stacking a momentary held bit on top. */
                        S.perfModsToggled &= ~bit;
                    } else {
                        S.perfModsHeld |= bit;
                    }
                    S.perfModPopupName    = PERF_MOD_FULL_NAMES[modIdx] || '';
                    S.perfModPopupEndTick = S.tickCount + PERF_MOD_POPUP_TICKS;
                    sendPerfMods();
                }
            }
            forceRedraw();
            return;
        }
        if (S.sessionView) {
            for (let row = 0; row < 4; row++) {
                const rowBase = 92 - row * 8;
                if (d1 >= rowBase && d1 < rowBase + NUM_TRACKS) {
                    const t = d1 - rowBase;
                    /* Single-clip merge placement: pick a destination clip on
                     * the merge track. Only an empty clip on that track commits;
                     * any other clip-pad press is swallowed (Record cancels). */
                    if (S.mergeSoloPlacement >= 0) {
                        const clipIdx = S.sceneRow + row;
                        if (t === S.mergeSoloPlacement && !clipHasContent(t, clipIdx)) {
                            S.pendingDefaultSetParams.push(
                                { key: 'merge_place_row', val: String(clipIdx) });
                            /* mode + LEDs cleared when DSP → IDLE (pollDSP). */
                        }
                        forceRedraw();
                        return;
                    }
                    /* Capture placement: pick an empty destination clip on the
                     * capture track for a stopped warp/tempo commit. */
                    if (S.capturePlaceTrack >= 0) {
                        const clipIdx = S.sceneRow + row;
                        if (t === S.capturePlaceTrack && !clipHasContent(t, clipIdx)) {
                            S.pendingDefaultSetParams.push(
                                { key: 't' + t + '_capture_commit', val: String(clipIdx) });
                            S.captureCommitAwait = 40;
                            S.capturePending     = 0;
                            S.capturePlaceTrack  = -1;
                        }
                        forceRedraw();
                        return;
                    }
                    if (S.muteHeld) {
                        /* Mute-held + pad: toggle mute/solo on that track's column */
                        if (S.shiftHeld) setTrackSolo(t, !S.trackSoloed[t]);
                        else           setTrackMute(t, !S.trackMuted[t]);
                    } else if (S.copyHeld) {
                        /* Copy + clip pad (Session View): clip-to-clip copy */
                        const clipIdx = S.sceneRow + row;
                        const isDrumT = S.trackPadMode[t] === PAD_MODE_DRUM;
                        if (S.copySrc && S.copySrc.kind === 'step') {
                            /* step copy in progress: swallow */
                        } else if (!S.copySrc) {
                            if (isDrumT) {
                                S.copySrc = S.shiftHeld
                                    ? { kind: 'cut_drum_clip', track: t, clip: clipIdx }
                                    : { kind: 'drum_clip',     track: t, clip: clipIdx };
                            } else {
                                S.copySrc = S.shiftHeld
                                    ? { kind: 'cut_clip', track: t, clip: clipIdx }
                                    : { kind: 'clip',     track: t, clip: clipIdx };
                            }
                            invalidateLEDCache();
                            showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                        } else if (S.copySrc.kind === 'clip') {
                            copyClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        } else if (S.copySrc.kind === 'cut_clip') {
                            cutClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            S.copySrc = { kind: 'clip', track: t, clip: clipIdx };
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        } else if (S.copySrc.kind === 'drum_clip' && isDrumT) {
                            copyDrumClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        } else if (S.copySrc.kind === 'cut_drum_clip' && isDrumT) {
                            cutDrumClip(S.copySrc.track, S.copySrc.clip, t, clipIdx);
                            S.copySrc = { kind: 'drum_clip', track: t, clip: clipIdx };
                            invalidateLEDCache();
                            forceRedraw();
                            showActionPopup('PASTED');
                        }
                        /* row/cut_row kinds, drum→melodic or melodic→drum mismatch: swallow */
                    } else if (S.shiftHeld && S.deleteHeld) {
                        /* Shift+Delete + clip pad (Session View): hard reset that clip */
                        const clipIdx = S.sceneRow + row;
                        hardResetClip(t, clipIdx);
                        forceRedraw();
                        showActionPopup('CLIP', 'CLEARED');
                    } else if (S.deleteHeld) {
                        /* Delete + clip pad (Session View): clear that clip, keep transport */
                        const clipIdx = S.sceneRow + row;
                        clearClip(t, clipIdx, true);
                        forceRedraw();
                        showActionPopup('SEQUENCE', 'CLEARED');
                    } else {
                        const clipIdx      = S.sceneRow + row;
                        const isActiveClip = S.trackActiveClip[t] === clipIdx;
                        if (S.shiftHeld) {
                            /* Shift+pad: open clip for editing (focus + jump to
                             * Track View). It must NOT turn on a stopped clip
                             * that has notes — "off until I turn it on". So the
                             * actual launch fires only when playing (the engine
                             * can only show/edit the DSP's active clip while
                             * running — pollDSP re-syncs trackActiveClip each
                             * tick) or when the clip is empty (harmless). */
                            const isPlaying = S.trackClipPlaying[t] && isActiveClip;
                            const isWR      = S.trackWillRelaunch[t] && isActiveClip;
                            const isQueued  = S.trackQueuedClip[t] === clipIdx;
                            if (!isPlaying && !isWR && !isQueued) {
                                if (!S.playing) {
                                    const prevClip = S.trackActiveClip[t];
                                    S.trackActiveClip[t]  = clipIdx;
                                    /* Snap to page containing loop_start so
                                     * non-zero-start clips don't show OOB
                                     * region on initial select. */
                                    S.trackCurrentPage[t] = S.trackPadMode[t] === PAD_MODE_DRUM
                                        ? 0
                                        : Math.floor((S.clipLoopStart[t][clipIdx] | 0) / 16);
                                    refreshPerClipBankParams(t);
                                    if (S.trackPadMode[t] === PAD_MODE_DRUM && prevClip !== clipIdx) {
                                        S.pendingDrumResync      = 2;
                                        S.pendingDrumResyncTrack = t;
                                    }
                                }
                                if ((S.playing || _clipIsEmpty(t, clipIdx))
                                        && typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            }
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            S.sessionView = false;
                            S.shiftTrackLEDActive = false;
                            invalidateLEDCache();
                            forceRedraw();
                        } else if (S.trackClipPlaying[t] && isActiveClip) {
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            if (S.trackPendingPageStop[t]) {
                                /* Pending stop → cancel by re-launching */
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            } else {
                                /* Playing → arm stop at next page boundary */
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_stop_at_end', '1');
                            }
                        } else if (S.trackWillRelaunch[t] && isActiveClip) {
                            /* Transport stopped, clip primed to restart → cancel */
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else if (S.trackQueuedClip[t] === clipIdx) {
                            /* Queued to launch → cancel */
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else {
                            /* Launch clip for this track */
                            handoffRecordingToTrack(t);
                            _switchActiveTrack(t);
                            if (!S.playing) {
                                const prevClip = S.trackActiveClip[t];
                                S.trackActiveClip[t]  = clipIdx;
                                S.trackCurrentPage[t] = 0;
                                if (S.trackPadMode[t] === PAD_MODE_DRUM && prevClip !== clipIdx) {
                                    S.pendingDrumResync      = 2;
                                    S.pendingDrumResyncTrack = t;
                                }
                            }
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                        }
                    }
                    break;
                }
            }
        } else {
            _onPadPressTrackView(status, d1, d2);
        }
}

function _jumpToMenuLabel(label) {
    openGlobalMenu();
    if (!S.globalMenuItems || !S.globalMenuState) return;
    for (let i = 0; i < S.globalMenuItems.length; i++) {
        const it = S.globalMenuItems[i];
        if (it && it.label === label) {
            S.globalMenuState.selectedIndex = i;
            return;
        }
    }
}

function _doShiftStepCommon(idx) {
    if      (idx === 1) _jumpToMenuLabel('Global');
    else if (idx === 2 && !S.sessionView) {
        /* Track View only — Session View Shift+Step3 is reserved for the
         * existing menu-shortcut set. Defer co-run entry until Shift releases
         * — otherwise the held Shift CC leaks into Move firmware / Schwung
         * chain editor (the shim starts forwarding Shift on co-run entry).
         * Dispatch happens in _onCC_buttons Shift-release branch. */
        S.pendingEditEntryTrack = S.activeTrack;
    }
    else if (idx === 4) {
        if (S.clockFollowOn) { S.bpmMoveInfo = true; forceRedraw(); }
        else openTapTempo();
    }
    else if (idx === 5) {
        S.metronomeOn = (S.metronomeOn === 1) ? 3 : 1;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('metro_on', String(S.metronomeOn));
        showActionPopup(['Off', 'Cnt-In', 'Play', 'Always'][S.metronomeOn]);
    }
    else if (idx === 6) _jumpToMenuLabel('Swing Amt');
    else if (idx === 8) _jumpToMenuLabel('Scale');
}

/* Loop+step gesture fire helpers — both the deferred fallback (length-only,
 * loop_start=0) and the active range gesture (loop_start=a*16, length=(b-a+1)*16)
 * route through the new atomic `*_loop_set` DSP keys so there is exactly one
 * DSP write path. Packed encoding mirrors seq8_set_param.c: ls<<16 | length. */
function _fireLoopWindowSet(track, ctx, startStep, lenSteps) {
    if (typeof host_module_set_param !== 'function') return;
    if (ctx === 3) { _fireLoopWindowSetCC(track, startStep, lenSteps); return; }
    const packed = (startStep << 16) | (lenSteps & 0xFFFF);
    if (ctx === 0) {
        /* Melodic per-active-clip */
        const ac = effectiveClip(track);
        S.clipLength[track][ac]     = lenSteps;
        S.clipLoopStart[track][ac]  = startStep;
        S.clipLengthManuallySet[track][ac] = true;
        const startPage = startStep >> 4;
        const lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
        if (S.trackCurrentPage[track] < startPage) S.trackCurrentPage[track] = startPage;
        else if (S.trackCurrentPage[track] > lastPage) S.trackCurrentPage[track] = lastPage;
        host_module_set_param('t' + track + '_c' + ac + '_loop_set', String(packed));
    } else if (ctx === 1) {
        /* Drum lane (active lane on this track) */
        const lane = S.activeDrumLane[track];
        S.drumLaneLength[track]    = lenSteps;
        S.drumLaneLoopStart[track] = startStep;
        S.drumLaneLengthManuallySet[track] = true;
        const startPage = startStep >> 4;
        const lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
        if (S.drumStepPage[track] < startPage) S.drumStepPage[track] = startPage;
        else if (S.drumStepPage[track] > lastPage) S.drumStepPage[track] = lastPage;
        host_module_set_param('t' + track + '_l' + lane + '_loop_set', String(packed));
    } else {
        if (allLanesGate()) return;
        /* ALL LANES: all 32 drum lanes of the active drum clip get the same window */
        S.drumLaneLength[track]    = lenSteps;
        S.drumLaneLoopStart[track] = startStep;
        S.drumLaneLengthManuallySet[track] = true;
        const startPage = startStep >> 4;
        const lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
        if (S.drumStepPage[track] < startPage) S.drumStepPage[track] = startPage;
        else if (S.drumStepPage[track] > lastPage) S.drumStepPage[track] = lastPage;
        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = track;
        host_module_set_param('t' + track + '_all_lanes_loop_set', String(packed));
    }
}

function _fireLoopWindowSetCC(track, startStep, lenSteps) {
    if (typeof host_module_set_param !== 'function') return;
    var ac = effectiveClip(track);
    var lane = S.ccActiveLane[track];
    S.ccLaneLoopStart[track][ac][lane] = startStep;
    S.ccLaneLength[track][ac][lane] = lenSteps;
    var packed = (startStep << 16) | (lenSteps & 0xFFFF);
    host_module_set_param('t' + track + '_c' + ac + '_k' + lane + '_cc_loop_set', String(packed));
    var startPage = startStep >> 4;
    var lastPage  = startPage + ((lenSteps + 15) >> 4) - 1;
    if (S.trackCurrentPage[track] < startPage) S.trackCurrentPage[track] = startPage;
    else if (S.trackCurrentPage[track] > lastPage) S.trackCurrentPage[track] = lastPage;
}

/* Snapshot the gesture context at press-time so a later release fires in the
 * same context the user started in (immune to track/lane/bank flips). */
function _loopGestureCtxFor(track) {
    /* AUTO bank (6) edits per-CC-lane loop windows on BOTH melodic and drum
     * tracks — each automation param lane has its own independent loop length,
     * so the Loop+step gesture targets the active CC lane, not the drum lane. */
    if (S.activeBank === 6) return 3;
    if (S.trackPadMode[track] !== PAD_MODE_DRUM) return 0;
    return S.activeBank === 7 ? 2 : 1;
}

/* Drop any partial Loop+step gesture, optionally firing the length-only
 * fallback if a B-tap never landed. Called on step release of the held
 * start page AND on Loop button release.
 *
 * Fallback semantics:
 *   loop_start == 0 → length = (a+1)*16, loop_start stays 0 (the original
 *                     pre-window single-tap behavior, preserved).
 *   loop_start > 0  → if a >= startPage: length = (a - startPage + 1)*16,
 *                     loop_start unchanged ("set END at page a, keep start").
 *                     if a < startPage: tap is below the window — re-anchor
 *                     by resetting to loop_start=0, length=(a+1)*16. */
export function _resolveLoopGesture(fireFallback) {
    const a = S.loopGestureStart;
    if (a < 0) return;
    const ctx   = S.loopGestureCtx;
    const trk   = S.loopGestureTrack;
    const clip  = S.loopGestureClip;
    const fired = S.loopGestureFired;
    S.loopGestureStart = -1;
    S.loopGestureFired = false;
    S.loopGestureTrack = -1;
    S.loopGestureClip  = -1;
    S.loopGestureLane  = -1;
    if (fired) { forceRedraw(); return; }
    if (fireFallback) {
        var currentLs, currentLen;
        if (ctx === 3) {
            var _ccLane = S.ccActiveLane[trk];
            currentLs  = S.ccLaneLoopStart[trk][clip][_ccLane] | 0;
            currentLen = S.ccLaneLength[trk][clip][_ccLane] | 0;
            if (currentLen === 0) {
                var _cTps = S.clipTPS[trk][clip] || 24;
                var _lTps = S.ccLaneTps[trk][clip][_ccLane] || _cTps;
                currentLs  = Math.round((S.clipLoopStart[trk][clip] | 0) * _cTps / _lTps);
                currentLen = Math.max(1, Math.round(S.clipLength[trk][clip] * _cTps / _lTps));
            }
        } else if (ctx === 0) {
            currentLs  = S.clipLoopStart[trk][clip] | 0;
            currentLen = S.clipLength[trk][clip] | 0;
        } else {
            currentLs  = S.drumLaneLoopStart[trk] | 0;
            currentLen = S.drumLaneLength[trk] | 0;
        }
        const startPage = currentLs >> 4;
        let newLs, newLen;
        if (currentLs === 0 || a < startPage) {
            newLs  = 0;
            newLen = (a + 1) * 16;
        } else {
            newLs  = currentLs;
            newLen = (a - startPage + 1) * 16;
        }
        if (newLen === currentLen && currentLen === 32) {
            newLen = 16;
        }
        _fireLoopWindowSet(trk, ctx, newLs, newLen);
    }
    forceRedraw();
}

export function _onStepButtons(d1, d2) {
    /* Co-run (Schwung chain-edit or Move-native): the step grid is blanked down
     * to a single exit affordance (the blinking Step 3 button + lit icon).
     * Step 3 (idx 2) exits co-run; every other step press is swallowed so it
     * can't edit the clip hidden underneath. Mirrors the Menu (CC 50) exit. */
    if (S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0) {
        if (d1 - 16 === 2) {
            if (S.moveCoRunTrack >= 0) exitMoveNativeCoRun();
            else { exitSchwungCoRun(); forceRedraw(); }
        }
        return;
    }
    if (S.tapTempoOpen) return;
    if (d2 > 0 && S.shiftTrackLEDActive) { S.shiftTrackLEDActive = false; S.screenDirty = true; }
    const idx = d1 - 16;
    /* Delete+step in session view: clear perf preset or mute snapshot slot immediately. */
    if (S.sessionView && S.deleteHeld) {
        if (S.loopHeld || S.perfViewLocked) {
            S.perfSnapshots[idx] = 0;
            if (S.perfRecalledSlot === idx) { S.perfRecalledSlot = -1; S.perfModsToggled = 0; sendPerfMods(); }
            showActionPopup('PERF PRESET', 'CLEARED');
        } else if (S.muteHeld) {
            S.snapshots[idx] = null;
            S.pendingDefaultSetParams.push({ key: 'snap_delete', val: String(idx) });
            showActionPopup('MUTE STATE', 'CLEARED');
        }
        forceRedraw();
        return;
    }
    /* Perf Mode: step buttons are preset snapshot slots — defer to release for tap/hold decision. */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked)) {
        S.stepBtnPressedTick[idx] = S.tickCount;
        S.sessionStepHeld         = idx;
        S.sessionStepHeldCtx      = 1;  /* perf */
        return;
    }
    if (S.sessionView) {
        /* Scene-bake picker active (set by Session-View Capture tap): step
         * press selects scene → straight to scene-bake confirm. */
        if (S.pendingSceneBakePicker) {
            S.pendingSceneBakePicker = false;
            S.confirmBakeScene          = true;
            S.confirmBakeSceneWrapPhase = false;
            S.confirmBakeSceneCondPhase = false;
            S.confirmBakeSceneSel    = 1;
            S.confirmBakeSceneClip   = idx;
            S.screenDirty            = true;
            return;
        }
        /* Multi-track live merge placement: step press picks destination row. */
        if (S.pendingMergePlacement) {
            S.pendingMergePlacement = false;
            S.pendingDefaultSetParams.push({ key: 'merge_place_row', val: String(idx) });
            S.screenDirty = true;
            return;
        }
        if (S.muteHeld) {
            /* All 16 step buttons are snapshot slots — defer to release for tap/hold decision. */
            S.stepBtnPressedTick[idx] = S.tickCount;
            S.sessionStepHeld         = idx;
            S.sessionStepHeldCtx      = 2;  /* mute */
            return;
        } else if (S.shiftHeld) {
            _doShiftStepCommon(idx);
            forceRedraw();
        } else if (!S.deleteHeld) {
            S.pendingDefaultSetParams.push({ key: 'launch_scene', val: String(idx) });
        }
        /* S.deleteHeld (non-mute/shift) in Session View: swallow */
    } else if (S.loopHeld) {
        if (S.recordArmed && !S.recordCountingIn) {
            /* Block length changes during active recording */
        } else if (S.loopGestureStart < 0) {
            /* First press: arm the gesture. Defer the actual DSP write to
             * either a B-tap (range) or this step's release (length-only
             * fallback) so a single tap retains its existing semantics. */
            const t = S.activeTrack;
            S.loopGestureStart = idx;
            S.loopGestureFired = false;
            S.loopGestureCtx   = _loopGestureCtxFor(t);
            S.loopGestureTrack = t;
            S.loopGestureClip  = (S.loopGestureCtx === 0 || S.loopGestureCtx === 3) ? effectiveClip(t) : -1;
            S.loopGestureLane  = (S.loopGestureCtx === 1) ? S.activeDrumLane[t] : -1;
            forceRedraw();
        } else if (idx !== S.loopGestureStart) {
            /* Second tap while holding start — fire the range. B<A swaps so
             * the window is always [min, max]. Multiple B taps re-fire (last
             * tap wins, allowing scrub without releasing the start page). */
            const a = Math.min(S.loopGestureStart, idx);
            const b = Math.max(S.loopGestureStart, idx);
            const startStep = a * 16;
            const lenSteps  = (b - a + 1) * 16;
            _fireLoopWindowSet(S.loopGestureTrack, S.loopGestureCtx, startStep, lenSteps);
            S.loopGestureFired = true;
            forceRedraw();
        }
        /* idx === loopGestureStart while held: ignore (same-page tap is a no-op) */
    } else if (S.copyHeld) {
        /* Copy + step button (Track View): step-to-step copy within active clip */
        const ac     = effectiveClip(S.activeTrack);
        const absIdx = S.trackCurrentPage[S.activeTrack] * 16 + idx;
        if (!S.copySrc) {
            S.copySrc = { kind: 'step', absStep: absIdx };
            invalidateLEDCache();
        } else if (S.copySrc.kind === 'step') {
            if (S.copySrc.absStep !== absIdx) copyStep(S.activeTrack, ac, S.copySrc.absStep, absIdx);
            invalidateLEDCache();
            forceRedraw();
        }
        /* S.copySrc.kind !== 'step': swallow — don't mix copy types */
    } else if (S.deleteHeld) {
        /* Delete + step button (Track View): clear all notes from that step.
         * On the CC bank (melodic), instead clear all knobs' points in the step. */
        if (S.activeBank === 6) {
            var t = S.activeTrack, ac = effectiveClip(t);
            var absIdx = S.trackCurrentPage[t] * 16 + idx;
            var _ccL_d = S.ccActiveLane[t];
            var _ltps_d = S.ccLaneTps[t][ac][_ccL_d];
            var tps = (_ltps_d > 0) ? _ltps_d : (S.clipTPS[t][ac] || 24);
            var t1 = absIdx * tps, t2 = Math.min(65535, t1 + tps - 1);
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_cc_auto_clear_step', ac + ' ' + t1 + ' ' + t2);
            /* DSP may have emptied some lanes — refresh auto bits / rest on next tick
             * (get_param is null from this MIDI handler). */
            S.pendingCCBitsRefresh = ac;
            showActionPopup('CC STEP', 'CLEAR');
            invalidateLEDCache();
            forceRedraw();
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum mode: clear step in active lane */
            const t       = S.activeTrack;
            const lane    = S.activeDrumLane[t];
            const absStep = S.drumStepPage[t] * 16 + idx;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + absStep + '_clear', '1');
            S.drumLaneSteps[t][lane][absStep] = '0';
            S.drumLaneHasNotes[t][lane] = S.drumLaneSteps[t][lane].some(c => c !== '0');
            forceRedraw();
        } else {
        const ac     = effectiveClip(S.activeTrack);
        const absIdx = S.trackCurrentPage[S.activeTrack] * 16 + idx;
        clearStep(S.activeTrack, ac, absIdx);
        forceRedraw();
        }
    } else if (S.shiftHeld) {
        /* Shift+step shortcuts */
        _doShiftStepCommon(idx);
        const t      = S.activeTrack;
        const isDrum = S.trackPadMode[t] === PAD_MODE_DRUM;
        if (idx === 7) {
            /* Step 8 (Track View only): drum=cycle perform mode; melodic=toggle chromatic */
            if (isDrum) {
                if (S.drumPerformMode[t] === 1) {
                    host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                    S.drumRepeatHeldPad[t] = -1;
                    S.drumRepeatHeldPadsStack[t].length = 0;
                }
                if (S.drumPerformMode[t] === 2) {
                    S.drumRepeat2HeldLanes[t].clear();
                    S.drumRepeat2LatchedLanes[t].clear();
                    host_module_set_param('t' + t + '_drum_repeat2_stop', '1');
                }
                S.drumRepeatLatched[t] = false;
                setDrumPerformMode(t, (S.drumPerformMode[t] + 1) % 3);
                if (S.drumPerformMode[t] > 0) S.activeBank = 5;
                showModePopup('PERFORMANCE PADS',
                    ['Velocity', 'Repeat Play (Rpt1)', 'Repeat Set (Rpt2)'],
                    S.drumPerformMode[t]);
            } else {
                S.padLayoutChromatic[t] = !S.padLayoutChromatic[t];
                computePadNoteMap();
                showActionPopup(S.padLayoutChromatic[t] ? 'CHROMATIC' : 'IN-SCALE');
            }
        } else if (idx === 9) {
            /* Step 10: toggle VelIn between Live and 100 */
            const curVel = S.trackVelOverride[t];
            const nextVel = curVel === 0 ? 100 : 0;
            applyTrackConfig(t, 'track_vel_override', nextVel);
        } else if (idx === 10 && !isDrum) {
            /* Step 11: toggle TRACK ARP style on/off (melodic only) */
            const curStyle = S.bankParams[t][5][0] | 0;
            const nextStyle = curStyle !== 0 ? 0 : S.lastTarpStyle[t];
            S.bankParams[t][5][0] = nextStyle;
            applyBankParam(t, 5, 0, nextStyle);
        } else if (idx === 14) {
            /* Step 15: double-and-fill. On the AUTO bank (6) this doubles the active
             * CC param lane's loop + fills (per-lane, track-type-agnostic) on BOTH
             * melodic and drum; elsewhere it doubles the clip/drum-lane window. */
            if (S.activeBank === 6) {
                doLaneDoubleFill();
            } else {
                doDoubleFill();
            }
        } else if (idx === 15 && S.activeBank !== 6) {
            /* Step 16: set quantize to 100% (not on auto bank) */
            if (isDrum) {
                if (S.activeBank === 7) {
                    /* ALL LANES: quantize all drum lanes */
                    if (allLanesGate()) return;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_lanes_qnt', '100');
                    S.bankParams[t][7][3] = 100;
                    S.drumLaneQnt[t] = 100;
                    S.bankParams[t][1][2] = 100;
                } else {
                    const lane = S.activeDrumLane[t];
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'quantize 100');
                    S.drumLaneQnt[t] = 100;
                    S.bankParams[t][1][2] = 100;
                }
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_quantize', '100');
            }
            if (!isDrum) S.bankParams[t][1][3] = 100;  /* K4 = Qnt (melodic NOTE FX) */
            showActionPopup('QUANT 100%');
        }
        forceRedraw();
    } else if (!S.shiftHeld && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank !== 6) {
        /* Drum mode: tap toggles hit; hold enters step edit (Leng/Vel).
         * Press records time and state; toggle/clear deferred to release. */
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        const absStep = S.drumStepPage[t] * 16 + idx;
        S.stepBtnPressedTick[idx] = S.tickCount;
        if (S.heldStep < 0) {
            S.heldStepBtn = idx;
            S.heldStep    = absStep;
            const cur   = S.drumLaneSteps[t][lane][absStep];
            if (cur !== '0') {
                S.stepWasEmpty  = false;
                S.heldStepNotes = [S.drumLaneNote[t][lane]];
                /* Press runs in MIDI context where get_param returns null —
                 * reading vel/gate/etc. here silently yielded the defaults
                 * (vel=100) and the confirm-at-release write then clobbered
                 * the step's real velocity (audit js-input-2). Defer the real
                 * read to the tick hold-threshold block (mirrors melodic);
                 * these are placeholders until it runs. */
                S.drumHeldReadPending = true;
                S.stepEditVel   = 100;
                S.stepEditGate  = S.drumLaneTPS[t] || 24;
                S.stepEditNudge = 0;
                S.stepEditIter  = 0;
                S.stepEditRand  = 0;
                S.stepEditRatch = 0;
            } else {
                S.stepWasEmpty  = true;
                S.drumHeldReadPending = false;
                S.heldStepNotes = [];
                S.stepEditVel   = stepEntryVelocity(t, -1, true);
                S.stepEditGate  = S.drumLaneTPS[t] || 24;
                S.stepEditNudge = 0;
                S.stepEditIter  = 0;
                S.stepEditRand  = 0;
                S.stepEditRatch = 0;
            }
            forceRedraw();
        } else if (S.stepBtnPressedTick[S.heldStepBtn] >= 0) {
            /* Primary still in tap window: multi-toggle this step immediately */
            const absStep2 = S.drumStepPage[t] * 16 + idx;
            const cur2     = S.drumLaneSteps[t][lane][absStep2];
            if (typeof host_module_set_param === 'function') {
                if (cur2 !== '1') {
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + absStep2 + '_toggle', String(stepEntryVelocity(t, -1, true)));
                    S.drumLaneSteps[t][lane][absStep2] = '1';
                    S.drumLaneHasNotes[t][lane] = true;
                } else {
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + absStep2 + '_clear', '1');
                    S.drumLaneSteps[t][lane][absStep2] = '0';
                    S.drumLaneHasNotes[t][lane] = S.drumLaneSteps[t][lane].some(c => c !== '0');
                }
            }
            S.stepBtnPressedTick[idx] = -1;
            forceRedraw();
        } else if (S.heldStepNotes.length > 0) {
            /* Primary in step edit (past tap threshold): tap sets gate span */
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            const tappedStep = S.drumStepPage[t] * 16 + idx;
            if (tappedStep !== S.heldStep) {
                const len     = S.drumLaneLength[t];
                const tps     = S.drumLaneTPS[t] || 24;
                /* Extend THROUGH the tapped step: gate spans up to the start
                 * of (tappedStep + 1), not just up to tappedStep. */
                const dist    = tappedStep > S.heldStep
                    ? tappedStep - S.heldStep + 1
                    : len - S.heldStep + tappedStep + 1;
                const newGate = Math.max(1, Math.min(dist * tps, 65535));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate', String(newGate));
                S.stepEditGate = newGate;
                forceRedraw();
            }
        }
    } else if (!S.shiftHeld) {
        /* Record press time for tap detection on release.
         * Enter step edit immediately — tap vs hold decided on release. */
        S.stepBtnPressedTick[idx] = S.tickCount;
        if (S.heldStep < 0) {
            const ac_p   = effectiveClip(S.activeTrack);
            const absP   = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            S.heldStepBtn  = idx;
            S.heldStep     = absP;
            const pref_p = 't' + S.activeTrack + '_c' + ac_p + '_step_' + absP;
            /* get_param returns null in MIDI context — use clipSteps mirror to detect
             * truly empty (0) vs has-data (1=active, 2=inactive). Notes/vel/gate
             * are deferred to hold threshold where get_param works. */
            const _stepState = S.clipSteps[S.activeTrack][ac_p][absP];
            if (_stepState === 0) {
                S.stepWasEmpty  = true;
                S.heldStepNotes = [];
                if (S.activeBank === 6) {
                    S.ccStepEditActive = true;
                } else {
                    S.stepEditVel   = 100;
                    S.stepEditGate  = 12;
                    S.stepEditNudge = 0;
                    S.stepEditIter  = 0;
                    S.stepEditRand  = 0;
                    S.stepEditRatch = 0;
                }
            } else {
                S.stepWasEmpty  = false;
                S.heldStepNotes = [];   /* populated at hold threshold from tick context */
                if (S.activeBank === 6) {
                    S.ccStepEditActive = true;
                } else {
                    S.stepEditVel   = 100;
                    S.stepEditGate  = 12;
                    S.stepEditNudge = 0;
                    S.stepEditIter  = 0;
                    S.stepEditRand  = 0;
                    S.stepEditRatch = 0;
                }
            }
            /* Chord-first: pads were held before this step was pressed.
             * Store full context now — tick() may run after heldStep is cleared on quick release. */
            if (S.liveActiveNotes.size > 0 && S.activeBank !== 6 &&
                    S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                S.pendingChordToStep  = {
                    t:       S.activeTrack,
                    ac:      ac_p,
                    step:    absP,
                    wasEmpty: _stepState === 0,
                    pitches: [...S.liveActiveNotes].sort(function(a, b) { return a - b; }),
                    vel:     stepEntryVelocity(S.activeTrack, effectiveVelocity(S.lastPadVelocity), false)
                };
                S.stepBtnPressedTick[idx] = -1;   /* bypass tap-toggle on release */
                S.stepWasHeld = true;
            }
            forceRedraw();
        } else if (S.stepBtnPressedTick[S.heldStepBtn] >= 0 && S.activeBank !== 6) {
            /* Primary still in tap window: multi-toggle this step immediately.
             * Use S.clipSteps for state — get_param is unreliable from onMidiMessage context. */
            const ac_mp    = effectiveClip(S.activeTrack);
            const absStep2 = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            const pref_mp  = 't' + S.activeTrack + '_c' + ac_mp + '_step_' + absStep2;
            const state_mp = S.clipSteps[S.activeTrack][ac_mp][absStep2]; // 0=empty, 1=active, 2=inactive-with-notes
            if (state_mp === 0) {
                const assignNote3 = S.lastPlayedNote >= 0 ? S.lastPlayedNote : -1;
                if (assignNote3 >= 0 && typeof host_module_set_param === 'function') {
                    host_module_set_param(pref_mp + '_toggle', assignNote3 + ' ' + stepEntryVelocity(S.activeTrack, -1, false));
                    S.clipSteps[S.activeTrack][ac_mp][absStep2] = 1;
                    S.clipNonEmpty[S.activeTrack][ac_mp] = true;
                    refreshSeqNotesIfCurrent(S.activeTrack, ac_mp, absStep2);
                }
            } else if (state_mp === 1) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pref_mp, '0');
                S.clipSteps[S.activeTrack][ac_mp][absStep2] = 2;
                if (S.clipNonEmpty[S.activeTrack][ac_mp]) S.clipNonEmpty[S.activeTrack][ac_mp] = clipHasContent(S.activeTrack, ac_mp);
                refreshSeqNotesIfCurrent(S.activeTrack, ac_mp, absStep2);
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pref_mp, '1');
                S.clipSteps[S.activeTrack][ac_mp][absStep2] = 1;
                S.clipNonEmpty[S.activeTrack][ac_mp] = true;
                refreshSeqNotesIfCurrent(S.activeTrack, ac_mp, absStep2);
            }
            S.stepBtnPressedTick[idx] = -1;
            forceRedraw();
        } else if (S.heldStepNotes.length > 0 && S.activeBank !== 6) {
            /* Primary in step edit (past tap threshold): tap sets gate span.
             * Clear S.heldStepBtn press-tick so the first step's release doesn't also tap-toggle. */
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            const ac_tap     = effectiveClip(S.activeTrack);
            const tappedStep = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            if (tappedStep !== S.heldStep) {
                const len     = S.clipLength[S.activeTrack][ac_tap];
                const tps     = S.clipTPS[S.activeTrack][ac_tap] || 24;
                /* Extend THROUGH the tapped step; shrink if already at that span. */
                const dist    = tappedStep > S.heldStep
                    ? tappedStep - S.heldStep + 1
                    : len - S.heldStep + tappedStep + 1;
                const spanGate = dist * tps;
                const newGate = Math.max(1, Math.min(
                    S.stepEditGate >= spanGate ? (dist - 1) * tps : spanGate, 65535));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + S.activeTrack + '_c' + ac_tap + '_step_' + S.heldStep + '_gate', String(newGate));
                S.stepEditGate = newGate;
                forceRedraw();
            }
        }
    }
}

export function _onPadRelease(status, d1, d2) {
    if (S.tapTempoOpen && d1 >= 68 && d1 <= 99) return;
    /* Co-run drum hold release: if the hold-threshold inject fired, send note-off
     * to close the held note in Move firmware. Always clear hold state on any
     * release of the tracked pad, even if the threshold hadn't fired yet.
     * Per-pad Set (not a scalar) so releasing one held drum pad doesn't clobber
     * or drop the note-off for a second, still-held pad (js-input-1). */
    if (S.moveCoRunTrack >= 0 && S.moveCoRunDrumHeld.has(d1) &&
            typeof move_midi_inject_to_move === 'function') {
        move_midi_inject_to_move([0x08, 0x80, d1, 0]);    /* plain pad off (no Shift was sent) */
        S.moveCoRunDrumHeld.delete(d1);
    }
    /* Step buttons (notes 16-31): if a Loop+step gesture is in flight and
     * the released step is the held start, resolve the gesture — fire the
     * length-only fallback when no B-tap landed, or just clear state when
     * the range already fired on the B-tap. */
    if (d1 >= 16 && d1 <= 31 && S.loopGestureStart >= 0) {
        const idx = d1 - 16;
        if (idx === S.loopGestureStart) _resolveLoopGesture(true);
        return;
    }
    /* Swallow pad releases while SEQ ARP step-level editor is open. */
    if (!S.sessionView && S.activeBank === 4 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][4][4] | 0) !== 0 &&
            d1 >= 68 && d1 <= 99) {
        const _pi = d1 - TRACK_PAD_BASE;
        if (_pi >= 0 && _pi < 32 && padPitch[_pi] >= 0) {
            liveSendNote(S.activeTrack, 0x80, padPitch[_pi], 0);
            S.liveActiveNotes.delete(padPitch[_pi]);
            padPitch[_pi] = -1;
        }
        return;
    }
    /* Swallow pad releases while TRACK ARP step-level editor is open. */
    if (!S.sessionView && S.activeBank === 5 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][5][4] | 0) !== 0 &&
            d1 >= 68 && d1 <= 99) {
        const _pi = d1 - TRACK_PAD_BASE;
        if (_pi >= 0 && _pi < 32 && padPitch[_pi] >= 0) {
            liveSendNote(S.activeTrack, 0x80, padPitch[_pi], 0);
            S.liveActiveNotes.delete(padPitch[_pi]);
            padPitch[_pi] = -1;
        }
        return;
    }
    /* Perf Mode pad release: handle R0 rate pad pop + mod pad release. */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked) && d1 >= 68 && d1 <= 99) {
        if (d1 >= 68 && d1 <= 75) {
            const subIdx = d1 - 68;
            if (subIdx === 7) {
                /* Latch release: toggle latch mode (mod pads momentary vs sticky). */
                S.perfLatchMode = !S.perfLatchMode;
            } else if (subIdx === 5) {
                /* Hold pad release: drop momentary state + stop all loops it was holding */
                if (S.perfHoldPadHeld) {
                    S.perfHoldPadHeld = false;
                    if (S.perfStack.length > 0) {
                        S.perfStack = [];
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('looper_stop', '1');
                    }
                }
            } else if (subIdx < 5) {
                /* Rate pad release: pop from stack — unless sticky-held or hold-pad held */
                if (!S.perfStickyLengths.has(subIdx) && !S.perfHoldPadHeld) {
                    const sIdx = S.perfStack.findIndex(function(e) { return e.idx === subIdx; });
                    if (sIdx >= 0) {
                        S.perfStack.splice(sIdx, 1);
                        if (S.perfStack.length === 0) {
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_stop', '1');
                        } else {
                            const top = S.perfStack[S.perfStack.length - 1];
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('looper_arm', String(top.ticks));
                        }
                    }
                }
            }
        } else {
            /* Modifier pad release: clear momentary held bit */
            const modIdx = PERF_MOD_PAD_MAP[d1];
            if (modIdx !== undefined) {
                S.perfModsHeld &= ~(1 << modIdx);
                sendPerfMods();
            }
        }
        forceRedraw();
        return;
    }
    /* Step button release: tap-toggle if within threshold, always exit step edit */
    if (d1 >= 16 && d1 <= 31) {
        const btn = d1 - 16;
        /* Session view hold-to-save: if still pending (tick hasn't fired save yet) → tap recall */
        if (S.sessionStepHeld === btn) {
            const ctx = S.sessionStepHeldCtx;
            S.sessionStepHeld    = -1;
            S.sessionStepHeldCtx = 0;
            S.stepBtnPressedTick[btn] = -1;
            if (ctx === 1) {
                /* Perf recall */
                if (S.perfRecalledSlot === btn) {
                    S.perfRecalledSlot = -1;
                    S.perfModsToggled  = 0;
                } else {
                    S.perfRecalledSlot = btn;
                    S.perfModsToggled  = S.perfSnapshots[btn];
                }
                sendPerfMods();
            } else {
                /* Mute recall */
                if (S.snapshots[btn] !== null) {
                    const snap = S.snapshots[btn];
                    for (let _t = 0; _t < NUM_TRACKS; _t++) {
                        S.trackMuted[_t]  = snap.mute[_t];
                        S.trackSoloed[_t] = snap.solo[_t];
                        if (snap.drumEffMute) {
                            S.drumLaneMute[_t] = snap.drumEffMute[_t];
                            S.drumLaneSolo[_t] = 0;
                        }
                    }
                    S.pendingDefaultSetParams.push({ key: 'snap_load', val: String(btn) });
                }
            }
            forceRedraw();
            return;
        }
        if (btn === S.heldStepBtn) {
            if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank !== 6) {
                /* Drum step release: tap toggles, hold-release exits + vel confirm */
                const t    = S.activeTrack;
                const lane = S.activeDrumLane[t];
                let drumStepCleared = false;
                if (S.stepBtnPressedTick[btn] >= 0) {
                    S.stepBtnPressedTick[btn] = -1;
                    if (S.stepWasEmpty) {
                        /* Empty step tapped: assign now with current velocity */
                        const _writeVel = stepEntryVelocity(t, -1, true);
                        S.stepEditVel = _writeVel;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_toggle', String(_writeVel));
                        S.drumLaneSteps[t][lane][S.heldStep] = '1';
                        S.drumLaneHasNotes[t][lane] = true;
                    } else {
                        /* Occupied step tapped: clear it */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_clear', '1');
                        S.drumLaneSteps[t][lane][S.heldStep] = '0';
                        S.drumLaneHasNotes[t][lane] = S.drumLaneSteps[t][lane].some(c => c !== '0');
                        drumStepCleared = true;
                    }
                    if (typeof host_module_get_param === 'function') {
                        const ac = S.trackActiveClip[t];
                        const hcRaw = host_module_get_param('t' + t + '_c' + ac + '_drum_has_content');
                        S.drumClipNonEmpty[t][ac] = hcRaw === '1';
                    }
                }
                /* Hold release: reassign to adjacent step if nudge crossed midpoint */
                let drumDidReassign = false;
                if (S.stepWasHeld && S.heldStepNotes.length > 0) {
                    const _tpsMid = Math.floor((S.drumLaneTPS[t] || 24) / 2);
                    let dstStep = -1;
                    if (S.stepEditNudge >= _tpsMid)
                        dstStep = (S.heldStep + 1) % S.drumLaneLength[t];
                    else if (S.stepEditNudge < -_tpsMid)
                        dstStep = (S.heldStep - 1 + S.drumLaneLength[t]) % S.drumLaneLength[t];
                    if (dstStep >= 0) {
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_reassign', String(dstStep));
                        S.drumLaneSteps[t][lane][S.heldStep] = '0';
                        S.pendingDrumLaneResync      = 3;
                        S.pendingDrumLaneResyncTrack = t;
                        S.pendingDrumLaneResyncLane  = lane;
                        drumDidReassign = true;
                    }
                }
                /* Confirm vel at release — ensures it sticks even if mid-hold send was
                 * coalesced. Skipped while drumHeldReadPending: the real velocity was
                 * never read (released before the tick hold-threshold block ran), so
                 * S.stepEditVel is still the placeholder — writing it would clobber
                 * the step's stored velocity (audit js-input-2). */
                if (!drumStepCleared && !drumDidReassign && S.heldStepNotes.length > 0 &&
                        !S.drumHeldReadPending) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel', String(S.stepEditVel));
                }
                S.drumHeldReadPending = false;
            } else {
            if (S.stepBtnPressedTick[btn] >= 0 && S.activeBank !== 6) {
                /* Quick release within threshold — commit as tap toggle */
                const ac_t   = effectiveClip(S.activeTrack);
                const absIdx = S.heldStep;
                S.stepBtnPressedTick[btn] = -1;
                if (S.stepWasEmpty) {
                    /* Tap on empty step: assign lastPlayedNote now */
                    if (S.lastPlayedNote >= 0) {
                        const assignNote_t = S.lastPlayedNote;
                        const assignVel_t  = stepEntryVelocity(S.activeTrack, -1, false);
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + S.activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', assignNote_t + ' ' + assignVel_t);
                        S.clipSteps[S.activeTrack][ac_t][absIdx] = 1;
                        S.clipNonEmpty[S.activeTrack][ac_t] = true;
                        refreshSeqNotesIfCurrent(S.activeTrack, ac_t, absIdx);
                    } else {
                        S.noNoteFlashEndTick = S.tickCount + NO_NOTE_FLASH_TICKS;
                        S.screenDirty = true;
                    }
                } else {
                    /* Step had data — tap clears it entirely */
                    clearStep(S.activeTrack, ac_t, absIdx);
                    refreshSeqNotesIfCurrent(S.activeTrack, ac_t, absIdx);
                }
            }
            /* On long-hold release: if nudge moved notes past the step midpoint,
             * reassign them to the adjacent step slot so it's editable from there. */
            if (S.stepWasHeld && S.heldStep >= 0 && S.heldStepNotes.length > 0 && S.activeBank !== 6) {
                const ac_ra = effectiveClip(S.activeTrack);
                const lenRa = S.clipLength[S.activeTrack][ac_ra];
                let dstStep = -1;
                if (S.stepEditNudge >= 12)
                    dstStep = (S.heldStep + 1) % lenRa;
                else if (S.stepEditNudge <= -13)
                    dstStep = (S.heldStep - 1 + lenRa) % lenRa;
                if (dstStep >= 0) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + S.activeTrack + '_c' + ac_ra + '_step_' + S.heldStep + '_reassign', String(dstStep));
                    S.clipSteps[S.activeTrack][ac_ra][S.heldStep] = 0;
                }
                /* Always re-read after hold release: poll may have set a neighbor lit */
                S.pendingStepsReread = 2;
                S.pendingStepsRereadTrack = S.activeTrack;
                S.pendingStepsRereadClip  = ac_ra;
            }
            } /* end melodic branch */
            /* Always exit step edit on release of the held button */
            S.heldStepBtn   = -1;
            S.heldStep      = -1;
            S.heldStepNotes = [];
            S.stepWasEmpty  = false;
            S.stepWasHeld   = false;
            forceRedraw();
        }
    }
    if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
        const padIdx = d1 - TRACK_PAD_BASE;
        const t = S.activeTrack;
        /* Repeat mode: swallow all right-grid (col 4-7) releases; stop or resume prior rate */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 1 &&
                (padIdx % 8) >= 4) {
            if (S.drumRepeatHeldPad[t] === padIdx && !S.drumRepeatLatched[t]) {
                const _prev = S.drumRepeatHeldPadsStack[t].length > 0
                    ? S.drumRepeatHeldPadsStack[t].pop() : null;
                if (_prev) {
                    /* Resume the previously held rate pad */
                    S.drumRepeatHeldPad[t] = _prev.padIdx;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_start',
                            S.activeDrumLane[t] + ' ' + _prev.rateIdx + ' ' + _prev.vel);
                } else {
                    S.drumRepeatHeldPad[t] = -1;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                }
            } else if (S.drumRepeatHeldPad[t] !== padIdx) {
                /* A queued-but-not-yet-active pad released — remove from stack */
                const _si = S.drumRepeatHeldPadsStack[t].findIndex(e => e.padIdx === padIdx);
                if (_si >= 0) S.drumRepeatHeldPadsStack[t].splice(_si, 1);
            }
            S.screenDirty = true;
            return;
        }
        /* Rpt2 mode: lane pad release — stop only if not latched */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 2 &&
                (padIdx % 8) < 4) {
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES && S.drumRepeat2HeldLanes[t].has(lane)) {
                S.drumRepeat2HeldLanes[t].delete(lane);
                if (!S.drumRepeat2LatchedLanes[t].has(lane)) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat2_lane_off', String(lane));
                }
                S.screenDirty = true;
            }
            return;
        }
        /* Rpt2 mode: swallow all right-grid releases */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 2 &&
                (padIdx % 8) >= 4) {
            S.screenDirty = true;
            return;
        }
        const pitch = padPitch[padIdx] >= 0 ? padPitch[padIdx] : S.padNoteMap[padIdx];
        if (pitch === 0xFF) return; /* OOB pad — press was skipped, nothing to release */
        S.liveActiveNotes.delete(pitch);
        if (S.pendingPrerollNote !== null) {
            const _prRelPitch = S.pendingPrerollNote.laneNote;
            if (_prRelPitch === pitch)
                S.pendingPrerollNote.releasedAtTick = S.tickCount;
        }
        for (let _pri = 0; _pri < S.pendingPrerollNotes.length; _pri++) {
            if (S.pendingPrerollNotes[_pri].pitch === pitch) {
                S.pendingPrerollNotes[_pri].releasedAtTick = S.tickCount;
                break;
            }
        }
        padPitch[padIdx] = -1;
        if (!S.sessionView) {
            const t = S.activeTrack;
            if (S.trackPadMode[t] === PAD_MODE_DRUM &&
                    (S.tickCount - padPressTick[padIdx]) < DRUM_TAP_TICKS)
                pendingDrumNoteOffs[t].push(pitch);
            else
                liveSendNote(t, 0x80, pitch, 0);
        }
        padPressTick[padIdx] = -1;
        if (S.recordArmed) {
            const _t = S.activeTrack;
            if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                if (_t === S.recordArmedTrack)
                    _drumRecNoteOffs.push({ track: _t, laneNote: pitch });
            } else {
                recordNoteOff(pitch);
            }
        }
    }
}

/* Pad pressure (poly aftertouch). On drum tracks: routes continuous pressure to
 * the held drum-repeat pad's velocity (Rpt1) or the held repeat lanes (Rpt2). On
 * melodic tracks: forwards pad pressure as aftertouch to the track output per the
 * track's AftTch mode (Off/Poly/Channel). Called from the top of
 * _onMidiInternalImpl, before isNoiseMessage would drop the 0xA0. */
export function _onPadAftertouch(d1, d2) {
    const t      = S.activeTrack;
    const padIdx = d1 - TRACK_PAD_BASE;

    /* Melodic aftertouch send (Phase 1: live). DSP tN_live_at routes via pfx_send
     * for the track's route (Move inject / Schwung internal / External USB). Poly
     * carries the sounded pitch (padPitch[]); Channel is track-wide. Deduped per
     * pad so a steady press doesn't spam the set_param channel. */
    if (S.trackPadMode[t] !== PAD_MODE_DRUM) {
        let mode = S.trackAtMode[t] | 0;
        if (mode === 0) return;                       /* Off — send nothing */
        if (S.trackRoute[t] === 1 && mode === 2) mode = 1;  /* Move = poly only */
        if (padIdx < 0 || padIdx >= 32) return;
        const pitch = padPitch[padIdx];
        if (pitch < 0) return;                        /* no live note on this pad */
        if (S.atLastSent[padIdx] === d2) return;      /* unchanged — skip */
        S.atLastSent[padIdx] = d2;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_live_at', pitch + ' ' + d2 + ' ' + mode);
        return;
    }

    if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 1 &&
            S.drumRepeatHeldPad[t] === padIdx && d2 > 0) {
        S.drumRepeatHeldPadVel[t] = d2;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_drum_repeat_vel', String(d2));
    }
    if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 2 && d2 > 0) {
        const col2 = padIdx % 8;
        if (col2 < 4) {
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && S.drumRepeat2HeldLanes[t].has(lane)) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_drum_repeat2_vel', lane + ' ' + d2);
            }
        }
    }
}
