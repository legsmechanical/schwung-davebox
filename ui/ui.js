/* ui.js — dAVEBOx host entry point.
 * Owns only: the globalThis entry bindings the host calls by name
 * (init / tick / onMidiMessageInternal / onMidiMessageExternal), the MIDI
 * dispatch impls behind them, and the captureError entry-point safety wrap.
 * ALL other logic lives in the ui_*.mjs modules, which import each other
 * freely but NEVER this file. (Modularity refactor, Phases 5-6, 2026-07.) */

import {
    MoveUp,
    MoveDown,
    MoveDelete
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    Blue,
    HotMagenta,
    Cyan,
    Purple,
    DarkPurple,
    Bright,
    BurntOrange,
    SkyBlue,
    DeepBlue
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    setButtonLED,
    isNoiseMessage
} from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    installConsoleOverride
} from '/data/UserData/schwung/shared/logger.mjs';

import {
    createInfo, formatItemValue
} from '/data/UserData/schwung/shared/menu_items.mjs';

import {
    drawMenuHeader, drawMenuList, menuLayoutDefaults
} from '/data/UserData/schwung/shared/menu_layout.mjs';

import {
    MoveNoteSession, MoveMainTouch,
    MoveMainButton, MoveMainKnob,
    LED_OFF, LED_STEP_ACTIVE, LED_STEP_CURSOR, SCENE_BTN_FLASH_TICKS,
    NUM_TRACKS,
    FLAG_JUMP_TO_OVERTAKE, FLAG_JUMP_TO_TOOLS,
    TRACK_COLORS, TRACK_DIM_COLORS, TRACK_PAD_BASE, TOP_PAD_BASE,
    DELAY_LABELS,
    fmtLgto, fmtNote, fmtPages,
    fmtDly, fmtPlain,
    fmtArpStyle, fmtArpSteps, fmtArpOct,
    MCUFONT, pixelPrintC,
    BANKS, PAD_MODE_DRUM,
    TAP_TEMPO_FLASH_TICKS,
    PARAM_LED_BANKS
} from './ui_constants.mjs';

import { S } from './ui_state.mjs';
import { drumPadToLane, drumPadToVelZone, drumVelZoneToVelocity, _clipIsEmpty, clipHasContent,
    effectiveVelocity } from './ui_pure.mjs';
import { showActionPopup, readActiveSet, maybeShowInheritPicker } from './ui_persistence.mjs';
import {
    closeClearAutoMenu
} from './ui_dialogs.mjs';
import { computePadNoteMap,
    setActiveDrumLane, setDrumPerformMode } from './ui_drummodel.mjs';
import { effectiveClip, invalidateLEDCache, trackColor, trackDimColor, forceRedraw, PERF_MOD_PAD_MAP, installFlagsWrap, buildLedInitQueue } from './ui_leds.mjs';
import { exitMoveNativeCoRun, assertOvertakeSysexSuppress } from './ui_corun.mjs';
import { applyTrackConfig,
    refreshSeqNotesIfCurrent,
    syncClipsFromDsp, syncMuteSoloFromDsp, restoreUiSidecar,
    liveSendNote,
    _drumRecNoteOns, _drumRecNoteOffs } from './ui_dsp_bridge.mjs';
import { recordNoteOn, recordNoteOff,
    openTapTempo, registerTapTempo,
    extHeldNotes } from './ui_record.mjs';
import { clearStep, showModePopup,
    copyStep, copyDrumLane, cutDrumLane,
    doDoubleFill, doLaneDoubleFill } from './ui_editops.mjs';
import { _onPadPress, _onPadRelease, _onPadAftertouch, _onStepButtons } from './ui_input_pads.mjs';
import { _onCCMsg } from './ui_input_cc.mjs';
import { _tickImpl, applyExtMidiRemap } from './ui_tick.mjs';

/* ------------------------------------------------------------------ */
/* UI state                                                             */
/* ------------------------------------------------------------------ */

/* S.clipSteps[track][clip][step] — JS-authoritative mirror of DSP step data */
/* S.clipNonEmpty[track][clip] — cached result of clipHasContent; updated on every S.clipSteps write */

/* Drum mode state */
/* S.drumLaneSteps[t][l] — '0'/'1'/'2' per step (up to 256), cached from DSP for the active clip */
/* S.drumLaneHasNotes[t][l] — true if lane l has any programmed hits */
/* S.drumLaneNote[t][l] — current MIDI note for lane l (JS mirror of lane->midi_note) */
/* S.drumLaneFlashTick[t][l] — S.tickCount when this lane last fired a hit (for pad flash) */
/* Per-track drum lane mute/solo bitmasks (uint32 mirrors of DSP drum_lane_mute/drum_lane_solo) */
/* Drum Repeat state */
/* Rpt2 state */
/* Per-track per-lane repeat groove state mirrors */
/* SEQ ARP per-clip step_vel[8] mirror. Stored as level 0..4:
 *   0 = step off (no note)
 *   1 = bottom row (vel 10)
 *   4 = top row (vel = incoming) — default. */
/* TRACK ARP per-track step_vel[8] mirror (per-track, not per-clip). */
/* S.drumClipNonEmpty[t][c] — true if any lane in drum clip c of track t has content */
/* Per-track config (formerly TRACK bank 0 params) */

/* Per-tick scene state cache — computed once at top of tick(), O(1) lookup in LED update fns */


/* ------------------------------------------------------------------ */
/* Parameter bank state                                                 */
/* ------------------------------------------------------------------ */

/* S.activeBank: index 0-6 (pad 92-98). CLIP bank (0) is default. */

/* S.knobTouched: 0-7 (MoveKnob1Touch-8Touch note numbers), or -1 = none */

/* Per-physical-knob sensitivity accumulators.
 * S.knobAccum[k] counts raw encoder ticks; fires delta when >= pm.sens.
 * S.knobLastDir[k] tracks last direction for reversal detection.
 * S.knobLocked[k] blocks further firing until touch release (used by lock=true params). */

/* S.bankSelectTick: S.tickCount at last bank select, used for the State 3 timeout.
 * -1 = timeout not active. */

/* S.bankParams[track][bankIdx][knobIdx] = integer value (JS-authoritative).
 * Initialized from BANKS defaults; refreshed from DSP on bank select. */

/* CC PARAM bank (bank 6) — per-track state, JS-authoritative */

/* Scratch palette indices for CC bank live value display (51-58, all undefined in palette).
 * Updated dynamically via SysEx each tick — one entry per knob. */

/* ------------------------------------------------------------------ */
/* Step entry state                                                     */
/* ------------------------------------------------------------------ */

/* S.heldStepBtn: physical button index 0-15 that is currently held (-1 = none).
 * Stored separately from S.heldStep so a second button press doesn't cause the
 * first button's release to exit step edit prematurely. */

/* Metronome */

/* Undo/redo availability (mirrors DSP undo_valid/redo_valid; set on every undoable action) */

/* Per-track mute/solo state (JS mirrors DSP) */

/* Suspend detection (suspend_keeps_js) */

/* Global menu state (Phase 5q) */

/* Tap Tempo screen state */

/* Real-time recording state */

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

/* --- DIAGNOSTIC (2026-05-23 crash investigation) ---------------------------
 * QuickJS swallows unhandled exceptions thrown inside entry-point callbacks:
 * the module silently stops (presents as a hang/freeze; orphaned audio thread
 * then spins → RT throttle). Wrap the top-level entry points so the NEXT
 * failure writes its error to a file we can pull over ssh instead of vanishing.
 * Deduped by (where|message) → a persistent error writes once (no I/O storm).
 * Errors are swallowed so the module survives. Originally a 2026-05-23 crash
 * diagnostic; kept PERMANENT as entry-point safety (decision at Phase-6b close). */
let _jsErrSeen = {};
let _jsErrBuf = '';
function captureError(where, e) {
    try {
        const msg = (e && e.message) ? e.message : String(e);
        const key = where + '|' + msg;
        if (_jsErrSeen[key]) return;
        _jsErrSeen[key] = 1;
        const stack = (e && e.stack) ? ('\n' + e.stack) : '';
        _jsErrBuf += '[tick=' + (S.tickCount | 0)
                   + ' sv=' + (S.sessionView ? 1 : 0)
                   + ' loop=' + (S.loopHeld ? 1 : 0)
                   + ' lock=' + (S.perfViewLocked ? 1 : 0)
                   + ' susp=' + (S.pendingSuspendSave ? 1 : 0)
                   + '] ' + where + ': ' + msg + stack + '\n\n';
        if (typeof host_write_file === 'function')
            host_write_file('/data/UserData/schwung/seq8-jserr.log', _jsErrBuf);
    } catch (_e) { /* the logger must never throw */ }
}

globalThis.init = function () {
    installConsoleOverride('SEQ8');
    /* Clear any lingering co-run flag from a prior session — shim's SHM
     * may still hold target/id if we were warm-restarted (Shift+Back +
     * relaunch does not reset shadow_control). */
    S.schwungCoRunSlot = -1;
    S.moveCoRunTrack = -1;
    if (typeof shadow_corun_end === 'function') shadow_corun_end();
    assertOvertakeSysexSuppress();
    if (S.bankParams === null)
        S.bankParams = Array.from({length: NUM_TRACKS}, function() {
            return BANKS.map(function(bank) { return bank.knobs.map(function(k) { return k.def; }); });
        });

    const p = (typeof host_module_get_param === 'function')
        ? host_module_get_param('playing') : null;
    const dspSurvived = (p !== null && p !== undefined);

    console.log('SEQ8 init: ' + (p === '1' ? 'RESUMED playing' : 'FRESH/stopped'));

    /* Detect set mismatch: compare active_set.txt UUID with what the DSP currently has loaded.
     * Works regardless of JS context lifetime — no cross-init state needed.
     * If they differ, DSP has old set's data: save it, then load the active set. */
    {
        const _as = readActiveSet();
        S.currentSetUuid = _as.uuid;
        S.currentSetName = _as.name;
    }
    /* Inherit-picker decision tree for a freshly-pasted Move duplicate.
     * 'auto'   — single family candidate, silently inherited; force pendingSetLoad.
     * 'picker' — multiple candidates; dialog open, state_load is deferred.
     * 'blank'  — no candidates; fall through to normal mismatch/exists checks.
     * Force pendingSetLoad on success: create_instance already called
     * seq8_load_state with the (then-empty) duplicate path; DSP needs to
     * reload from the now-seeded file. */
    const inheritResult = maybeShowInheritPicker(S.currentSetUuid, S.currentSetName);
    const currentDspNonce = (typeof host_module_get_param === 'function')
        ? host_module_get_param('instance_id') : null;
    const dspUuid = (typeof host_module_get_param === 'function')
        ? (host_module_get_param('state_uuid') || '') : '';
    if (currentDspNonce) S.lastDspInstanceId = currentDspNonce;
    /* Check if DSP flagged a state version mismatch during create_instance.
     * If so, show the confirm dialog and suppress any pendingSetLoad — the
     * dialog's "Yes" handler will trigger state_load after the user confirms. */
    const _svMismatch = (typeof host_module_get_param === 'function')
        ? host_module_get_param('state_version_mismatch') : null;
    if (_svMismatch && parseInt(_svMismatch, 10) === 1) {
        S.confirmStateWipe = true;
        S.confirmStateWipeSel = 1;
        S.pendingSetLoad = false;
        S.screenDirty = true;
    } else if (inheritResult === 'auto') {
        S.pendingSetLoad = true;
    } else if (inheritResult === 'picker') {
        /* state_load deferred until resolveInheritPicker fires */
    } else if (S.currentSetUuid && dspUuid !== S.currentSetUuid) {
        S.pendingSetLoad = true;
    } else if (S.currentSetUuid && typeof host_file_exists === 'function') {
        const sp = '/data/UserData/schwung/set_state/' + S.currentSetUuid + '/seq8-state.json';
        if (!host_file_exists(sp)) S.pendingSetLoad = true;
    }
    /* Schedule orphan prune for the next quiet tick (after state_load settles). */
    S.pendingPruneOrphans = true;

    if (typeof host_module_get_param === 'function') {
        S.playing = dspSurvived;

        for (let t = 0; t < NUM_TRACKS; t++) {
            const ac = host_module_get_param('t' + t + '_active_clip');
            if (ac !== null && ac !== undefined) S.trackActiveClip[t] = parseInt(ac, 10) | 0;
            const cs = host_module_get_param('t' + t + '_current_step');
            const csVal = (cs !== null && cs !== undefined) ? (parseInt(cs, 10) | 0) : -1;
            S.trackCurrentStep[t] = csVal;
            S.trackCurrentPage[t] = csVal >= 0 ? Math.floor(csVal / 16) : 0;
            const qc = host_module_get_param('t' + t + '_queued_clip');
            S.trackQueuedClip[t] = (qc !== null && qc !== undefined) ? (parseInt(qc, 10) | 0) : -1;
        }

        syncClipsFromDsp();
        syncMuteSoloFromDsp();
    }

    extHeldNotes.clear();

    if (!S.hasInitedOnce) { S.sessionView = true; S.hasInitedOnce = true; }

    /* Restore UI state (active track, clip focus, view) from sidecar.
     * Deferred if pendingSetLoad: DSP hasn't loaded the new set yet, restoreUiSidecar
     * will be called again from the pendingDspSync completion path after the full resync. */
    restoreUiSidecar(!S.pendingSetLoad);

    /* PHASE-1: capability gate for DSP-owned input. On patched Schwung the
     * shim delivers pad MIDI to overtake DSP's on_midi on the audio thread,
     * removing the slow-brain JS hop. We detect via shadow_inbound_pad_midi_active
     * (added in legsmechanical/schwung phase-1-inbound). When active, we suppress
     * queueLiveNoteOn/Off in liveSendNote AND push tN_padmap to DSP — which
     * doubles as the DSP-side capability signal (its padmap handler sets
     * inst->dsp_inbound_enabled). The push happens on every computePadNoteMap
     * recompute, so it survives DSP instance recreate (state_load path).
     * Stock Schwung: function undefined, flag stays false, padmap never pushed,
     * existing JS path keeps working. Remove the gate when patches upstreamed. */
    S.dspInboundEnabled = (typeof shadow_inbound_pad_midi_active === 'function');

    computePadNoteMap();

    /* Apply cable-2 channel remap for the current active track immediately
     * (tick() change-detect also covers this, but fires one tick later). */
    S.lastRemapTrack = -1;
    applyExtMidiRemap();

    S.ledInitComplete = false;
    invalidateLEDCache();
    S.ledInitQueue    = buildLedInitQueue();
    S.ledInitIndex    = 0;

    installFlagsWrap();

    S._origClearScreen = clear_screen;
    S._wasSuspended    = false;
};

globalThis.tick = function () { try { _tickImpl(); } catch (e) { captureError('tick', e); } };

/* ------------------------------------------------------------------ */
/* MIDI input                                                           */
/* ------------------------------------------------------------------ */

globalThis.onMidiMessageInternal = function (data) { try { _onMidiInternalImpl(data); } catch (e) { captureError('onMidiInternal', e); } };
function _onMidiInternalImpl(data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;

    /* Pad pressure arrives as poly aftertouch (0xA0) with the pad note in d1.
     * isNoiseMessage() classifies all 0xA0/0xD0 as noise, so handle pressure
     * here BEFORE that filter would drop it, then return. */
    if ((status & 0xF0) === 0xA0) {
        if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) _onPadAftertouch(d1, d2);
        return;
    }
    if (isNoiseMessage(data)) return;

    /* Master volume knob (CC 79) + its capacitive touch (note 8) are owned by
     * Move firmware (button_passthrough[79] + the shim's overtake-mode volume
     * passthrough). dAVEBOx does nothing with them, but the host still forwards
     * the full detent stream to us in overtake mode — processing every one
     * competes with sequencer/MIDI output and stutters playback. Drop them
     * immediately so volume adjustment stays entirely Move-native. */
    if ((status & 0xF0) === 0xB0 && d1 === 79) return;
    if (((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) && d1 === 8) return;

    /* AUTO-bank Delete-tap detection: any input other than the Delete button
     * itself while Delete is armed disqualifies the tap, so Delete+jog /
     * Delete+knob / Delete+step keep their combos and don't also open the
     * CLEAR AUTOMATION menu on release. */
    if (S.deleteTapArmed && (status & 0x80) &&
            !((status & 0xF0) === 0xB0 && d1 === MoveDelete))
        S.deleteTapArmed = false;   /* (status & 0x80) ignores the Move's null/heartbeat (0x00) messages */

    /* Snapshot picker is a mid-session modal: swallow all input except the jog
     * (CC 3 click + CC 14 rotate, → _onCC_jog) and Note/Session (CC 50, closes
     * it), so pads/steps/transport/knobs can't edit the underlying clip while
     * the picker is on screen. */
    if (S.snapshotPicker) {
        const _ccPick = (status & 0xF0) === 0xB0 &&
            (d1 === 3 || d1 === MoveMainKnob || d1 === MoveNoteSession);
        if (!_ccPick) return;
    }

    /* CLEAR AUTOMATION modal: swallow all input except the jog (CC 3 click +
     * CC 14 rotate, → _onCC_jog / MoveMainKnob). Exits without changing anything:
     * Note/Session (the menu button), or tapping Delete again. */
    if (S.clearAutoMenu) {
        if ((status & 0xF0) === 0xB0 && d2 === 127 &&
                (d1 === MoveNoteSession || d1 === MoveDelete)) {
            closeClearAutoMenu();
            return;
        }
        const _ccMenu = (status & 0xF0) === 0xB0 && (d1 === 3 || d1 === MoveMainKnob);
        if (!_ccMenu) return;
    }

    /* While session overview is held, swallow everything except CC 50 release and Up/Down scroll. */
    if (S.sessionOverlayHeld) {
        const isRelease = (status === 0xB0 && d1 === MoveNoteSession && d2 === 0);
        const isScroll  = (status === 0xB0 && (d1 === MoveUp || d1 === MoveDown) && d2 === 127);
        if (!isRelease && !isScroll) return;
    }


    /* Knob touch (notes 0-7). MoveKnob1-8Touch = notes 0-7.
     * Hardware: d2=127 = touch on; d2 in 0-63 (via 0x90 or 0x80) = touch off.
     * Note 9 (jog touch): shows bank overview while held, locked out in global menu. */
    if (d1 >= 0 && d1 <= 9) {
        if ((status & 0xF0) === 0x90) {
            if (d2 === 127) {
                if (d1 <= 7 && S.activeBank >= 0) {
                    S.knobTouched = d1; S.knobTurnedTick[d1] = -1; S.screenDirty = true;
                    /* CC bank: touching a knob makes it the active lane (persistent
                     * — drives the step-LED gradient and highlighted overview cell). */
                    if (S.activeBank === 6) {
                        S.ccActiveLane[S.activeTrack] = d1;
                        invalidateLEDCache();
                    }
                    /* Perf view: touch knob k toggles looper for track k */
                    if (S.perfViewLocked) {
                        const _lt = d1;
                        const _newLooper = S.trackLooper[_lt] !== 0 ? 0 : 1;
                        S.trackLooper[_lt] = _newLooper;
                        applyTrackConfig(_lt, 'track_looper', _newLooper);
                        showActionPopup('LOOPER ' + (_newLooper ? 'ON' : 'OFF'), 'TRACK ' + (_lt + 1));
                        setButtonLED(71 + _lt, _newLooper ? trackColor(_lt) : LED_OFF, true);
                    }
                    /* CC bank: Delete+touch clears this knob's automation + resting value → "—" */
                    if (S.activeBank === 6 && S.deleteHeld && !S.shiftHeld) {
                        const _dt = S.activeTrack, _dac = effectiveClip(_dt);
                        S.trackCCAutoBits[_dt][_dac] &= ~(1 << d1);
                        S.trackCCLiveVal[_dt][d1] = -1;
                        S.clipCCVal[_dt][_dac][d1] = -1;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _dt + '_cc_auto_clear_k', _dac + ' ' + d1);
                        showActionPopup('CC', 'CLEAR');
                        invalidateLEDCache();
                    }
                    /* SEQ ARP K5 / TRACK ARP K5 touch: switch pads to vel-slider editor immediately. */
                    if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 4)) forceRedraw();
                }
                if (d1 === MoveMainTouch && !S.globalMenuOpen && !S.shiftHeld) { S.jogTouched = true; forceRedraw(); }
            } else if (d2 < 64) {
                if (d1 <= 7) {
                    if (S.activeBank >= 0 && BANKS[S.activeBank].knobs[d1]) {
                        const relPm = BANKS[S.activeBank].knobs[d1];
                        if (relPm.dspKey === 'nudge') {
                            S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                            if (typeof host_module_set_param === 'function') {
                                const _isAllLanesNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7;
                                const _isDrumNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                                if (_isAllLanesNdg)
                                    host_module_set_param('t' + S.activeTrack + '_all_lanes_nudge', '0');
                                else if (_isDrumNdg)
                                    host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                                else
                                    host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                            }
                        } else if (relPm.dspKey === 'clock_shift' || relPm.dspKey === 'beat_stretch') {
                            S.clockShiftTouchDelta = 0;
                            S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                            /* Shft knob doubles as Nudge under Shift held — reset DSP nudge
                             * accumulator on release in case the user finished a Shift+turn. */
                            if (relPm.dspKey === 'clock_shift' &&
                                    typeof host_module_set_param === 'function') {
                                const _isAllLanes = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7;
                                const _isDrum     = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                                if (_isAllLanes)
                                    host_module_set_param('t' + S.activeTrack + '_all_lanes_nudge', '0');
                                else if (_isDrum)
                                    host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                                else
                                    host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                            }
                        }
                        /* ALL LANES: schedule display reset to '--' after ~500ms on touch release */
                        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7) {
                            if (d1 === 0) { S.allLanesResResetTick = S.tickCount + 47; S.allLanesResResetTrack = S.activeTrack; }
                            if (d1 === 3) { S.allLanesQntResetTick = S.tickCount + 47; S.allLanesQntResetTrack = S.activeTrack; }
                            if (d1 === 6) { S.allLanesDirResetTick = S.tickCount + 47; S.allLanesDirResetTrack = S.activeTrack; }
                        }
                    }
                    /* SEQ ARP K5 / TRACK ARP K5 release: refresh pads (vel-slider editor → normal pads). */
                    if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 4)) forceRedraw();
                    S.knobTouched = -1;
                    S.knobLocked[d1] = false;
                    S.knobAccum[d1]  = 0;
                    S.screenDirty = true;
                }
                if (d1 === MoveMainTouch && S.jogTouched) { S.jogTouched = false; S.bankSelectTick = -1; forceRedraw(); }
            }
            return;
        }
        if ((status & 0xF0) === 0x80) {
            if (d1 <= 7) {
                if (S.activeBank >= 0 && BANKS[S.activeBank].knobs[d1]) {
                    const relPm = BANKS[S.activeBank].knobs[d1];
                    if (relPm.dspKey === 'nudge') {
                        S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                        if (typeof host_module_set_param === 'function') {
                            const _isAllLanesNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7;
                            const _isDrumNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                            if (_isAllLanesNdg)
                                host_module_set_param('t' + S.activeTrack + '_all_lanes_nudge', '0');
                            else if (_isDrumNdg)
                                host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                            else
                                host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                        }
                    } else if (relPm.dspKey === 'clock_shift' || relPm.dspKey === 'beat_stretch') {
                        S.clockShiftTouchDelta = 0;
                        S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                    }
                    /* ALL LANES K4 (Qnt): schedule display reset to '--' after ~500ms */
                    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && d1 === 3) {
                        S.allLanesQntResetTick  = S.tickCount + 47;
                        S.allLanesQntResetTrack = S.activeTrack;
                    }
                }
                if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 4)) forceRedraw();
                S.knobTouched = -1;
                S.knobLocked[d1] = false;
                S.knobAccum[d1]  = 0;
                S.screenDirty = true;
            }
            if (d1 === MoveMainTouch && S.jogTouched) { S.jogTouched = false; S.bankSelectTick = -1; forceRedraw(); }
            return;
        }
    }

    if (status === 0xB0) { _onCCMsg(d1, d2); return; }

    /* Step buttons: notes 16-31, note-on only */
    if ((status & 0xF0) === 0x90 && d1 >= 16 && d1 <= 31 && d2 > 0) { _onStepButtons(d1, d2); return; }

    /* Pad presses: note-on */
    if ((status & 0xF0) === 0x90 && d2 > 0) { _onPadPress(status, d1, d2); return; }

    /* Pad releases: note-off */
    if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) { _onPadRelease(status, d1, d2); return; }

};


globalThis.onMidiMessageExternal = function (data) { try { _onMidiExternalImpl(data); } catch (e) { captureError('onMidiExternal', e); } };
function _onMidiExternalImpl(data) {
    const status  = data[0] | 0;
    const d1      = (data[1] ?? 0) | 0;
    const d2      = (data[2] ?? 0) | 0;
    const msgType = status & 0xF0;
    const msgCh   = (status & 0x0F) + 1;  /* 1-indexed */

    /* Route to S.activeTrack in all views — S.activeTrack always reflects last Track View focus */
    const t = S.activeTrack;

    /* ROUTE_MOVE: Move receives external cable-2 MIDI natively in overtake mode.
     * Never inject — injecting causes an echo cascade (Move echoes cable-2 back
     * as cable-2, we re-inject, infinite loop → crash). */
    const routeIsMove = S.trackRoute[t] === 1;

    /* Channel filter. When the cable-2 remap is active for a ROUTE_MOVE track the
     * shim rewrites the channel byte before we see it — messages arrive on
     * trackChannel[t], not their original channel. Filter against the remapped
     * channel so we don't accidentally drop them. */
    if (S.extMidiRemapActive && routeIsMove) {
        if (msgCh !== S.trackChannel[t]) return;
    } else {
        if (S.midiInChannel !== 0 && msgCh !== S.midiInChannel) return;
    }

    /* Drum track: route by pitch to lanes; skip melodic step assignment */
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        if (msgType === 0x90 && d2 > 0) {
            const vel = effectiveVelocity(d2);
            S.lastPadVelocity = vel;
            if (!routeIsMove) liveSendNote(t, 0x90, d1, vel, false, true);
            const isSeqEcho = routeIsMove && S.seqActiveNotes.has(d1);
            /* Queue record events regardless of count-in state (pad precedent,
             * ui_input_pads.mjs): the tick flush is gated on !S.recordCountingIn
             * so entries accumulate during count-in and drain at the
             * count-in->recording transition; the DSP authoritatively filters
             * (ROUTE_MOVE ext without an on_midi slot -- early count-in
             * warm-up -- is dropped; in-window presses land at loop_start). */
            const isRec = !isSeqEcho && S.recordArmed && t === S.recordArmedTrack;
            if (isRec) {
                _drumRecNoteOns.push({ track: t, laneNote: d1, vel: vel, ext: true });
                const recLane = S.drumLaneNote[t].indexOf(d1);
                if (recLane >= 0) {
                    S.pendingDrumLaneResync      = 3;
                    S.pendingDrumLaneResyncTrack = t;
                    S.pendingDrumLaneResyncLane  = recLane;
                }
            }
            extHeldNotes.set(d1, { track: t, recording: isRec });
        } else if (msgType === 0x80 || (msgType === 0x90 && d2 === 0)) {
            const info = extHeldNotes.get(d1);
            const noteTrack = info ? info.track : t;
            if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0, false, true);
            if (info && info.recording && S.recordArmed)
                _drumRecNoteOffs.push({ track: noteTrack, laneNote: d1, ext: true });
            extHeldNotes.delete(d1);
        } else if (msgType === 0xB0 || msgType === 0xD0 || msgType === 0xA0 || msgType === 0xE0) {
            if (!routeIsMove) liveSendNote(t, msgType, d1, d2);
        }
        return;
    }

    if (msgType === 0x90 && d2 > 0) {
        const vel = effectiveVelocity(d2);
        S.lastPlayedNote  = d1;
        S.lastPadVelocity = vel;
        if (!routeIsMove) liveSendNote(t, 0x90, d1, vel, false, true);
        /* ROUTE_MOVE: sequencer inject echoes come back here on cable-2. Skip recording
         * for pitches the sequencer is already S.playing — those are echoes, not keyboard input.
         * Preserve any existing recording-active entry so the keyboard gate isn't overwritten. */
        const isSeqEcho = routeIsMove && S.seqActiveNotes.has(d1);
        /* Queue record events regardless of count-in state (pad precedent, see
         * the drum branch above / ui_input_pads.mjs): flush waits for the
         * count-in->recording transition; DSP slots authoritatively filter. */
        const isRec = !isSeqEcho && S.recordArmed && t === S.recordArmedTrack;
        if (isRec) recordNoteOn(d1, vel, t, true);
        const prevInfo = extHeldNotes.get(d1);
        if (!prevInfo || !prevInfo.recording || !isSeqEcho) {
            extHeldNotes.set(d1, { track: t, recording: isRec });
        }
        if (S.heldStep >= 0 && !S.shiftHeld && !S.sessionView) {
            const ac = effectiveClip(t);
            if (typeof host_module_set_param === 'function')
                /* Replace auto-assigned note if step was empty on hold; otherwise additive */
                if (S.stepWasEmpty && S.heldStepNotes.length > 0)
                    host_module_set_param('t' + t + '_c' + ac + '_step_' + S.heldStep + '_set_notes', String(d1));
                else
                    host_module_set_param('t' + t + '_c' + ac + '_step_' + S.heldStep + '_toggle', d1 + ' ' + vel);
            const raw = typeof host_module_get_param === 'function'
                ? host_module_get_param('t' + t + '_c' + ac + '_step_' + S.heldStep + '_notes') : null;
            S.heldStepNotes = (raw && raw.trim().length > 0)
                ? raw.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                : [];
            S.clipSteps[t][ac][S.heldStep] = S.heldStepNotes.length > 0 ? 1 : 0;
            if (S.heldStepNotes.length > 0) {
                S.clipNonEmpty[t][ac] = true;
            } else if (S.clipNonEmpty[t][ac]) {
                S.clipNonEmpty[t][ac] = clipHasContent(t, ac);
            }
            refreshSeqNotesIfCurrent(t, ac, S.heldStep);
            forceRedraw();
        }
    } else if (msgType === 0x80 || (msgType === 0x90 && d2 === 0)) {
        const info = extHeldNotes.get(d1);
        const noteTrack = info ? info.track : t;
        if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0, false, true);
        if (info && info.recording) recordNoteOff(d1, true);
        extHeldNotes.delete(d1);
    } else if (msgType === 0xB0 || msgType === 0xD0 || msgType === 0xA0 || msgType === 0xE0) {
        if (!routeIsMove) liveSendNote(t, msgType, d1, d2);
    }
};
