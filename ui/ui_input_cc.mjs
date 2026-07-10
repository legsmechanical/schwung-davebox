/* ui_input_cc.mjs
 * CC input family: jog wheel, top-row buttons, transport, side (track) buttons,
 * step-edit CC handling, knob-bank CC input, plus the shared knob-acceleration
 * helper and view-switch cleanup. Imports _resolveLoopGesture from
 * ui_input_pads (its sibling family, extracted first) — hence last.
 * Extracted from ui.js (Phase 5b, increment 7 of the modularity refactor).
 */

import {
    MoveShift, MoveBack, MovePlay, MoveLeft, MoveRight, MoveUp, MoveDown,
    MoveMute, MoveDelete, Red
} from '/data/UserData/schwung/shared/constants.mjs';
import {
    setLED, setButtonLED, decodeDelta
} from '/data/UserData/schwung/shared/input_filter.mjs';
import {
    handleMenuInput
} from '/data/UserData/schwung/shared/menu_nav.mjs';
import {
    MoveNoteSession, MoveUndo, MoveLoop, MoveCopy, MoveRec,
    MoveCapture, MoveSample, MoveMainKnob,
    LED_OFF, NUM_TRACKS, NUM_CLIPS,
    TRACK_PAD_BASE, TPS_VALUES,
    BANKS, PAD_MODE_DRUM, PAD_MODE_CONDUCT,
    BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN,
    TICK_HZ, STEP_ITER_LIST
} from './ui_constants.mjs';
import { S, conductorTrackIdx } from './ui_state.mjs';
import { scaleNudgeNote, stepEntryVelocity } from './ui_pure.mjs';
import { saveState, writeSidecar, doClearSession, showActionPopup } from './ui_persistence.mjs';
import {
    openSaveSnapshot, closeSnapshotPicker,
    snapshotPickerRotate, snapshotPickerClick, openClearAutoMenu,
    clearAutoMenuRotate, clearAutoMenuClick, showMenuInfo, closeConvertConfirm, resolveInheritPicker
} from './ui_dialogs.mjs';
import { trackClipHasContent } from './ui_scene.mjs';
import { computePadNoteMap, syncDrumLaneSteps, syncDrumLanesMeta,
    setDrumLanePage } from './ui_drummodel.mjs';
import { effectiveClip, forceRedraw, invalidateLEDCache,
    bankHasAltParams, clearAllLEDs, removeFlagsWrap, sendPerfMods } from './ui_leds.mjs';
import { openSchwungSlotEditor, exitSchwungCoRun,
    enterMoveNativeCoRun, DAVEBOX_PICKER_KEEP_MASK } from './ui_corun.mjs';
import { confirmExportStart, confirmExportCondClick } from './ui_export.mjs';
import { openGlobalMenu, ensureGlobalMenuFresh } from './ui_menu.mjs';
import { applyTrackConfig, readBankParams, applyBankParam,
    refreshPerClipBankParams, resyncDrumTrack,
    unlatchAllTracks, queueLiveNoteOff } from './ui_dsp_bridge.mjs';
import { disarmRecord, handoffRecordingToTrack,
    closeTapTempo, extNoteOffAll } from './ui_record.mjs';
import { sceneBakeHasConductor, commitSceneBake, anyMelodicClipHasContent,
    xposeCancelPreview, xposeCommit } from './ui_xpose.mjs';
import { setTrackMute, setTrackSolo, clearAllMuteSolo,
    clearClip, hardResetClip, copyClip, cutClip, copyRow, cutRow,
    copyDrumClip, cutDrumClip, clearRow,
    _switchActiveTrack, allLanesGate,
    resetFxBanks, resetTarp, resetSingleFxBank, applyConductGridKnob } from './ui_editops.mjs';
import { _resolveLoopGesture } from './ui_input_pads.mjs';

/* View lock: double-tap Loop keeps Perf Mode alive after Loop is released.
 * Single tap while locked → unlock + stop loop. */
const LOOP_TAP_TICKS  = 40;

const STRETCH_BLOCKED_TICKS = 141;  /* ~1500ms at 94Hz (was 294, calibrated for the mistaken 196Hz) */

/* Session overview overlay (hold CC 50) */
const NOTE_SESSION_HOLD_TICKS = 19;  /* ~200ms at 94Hz, matching STEP_HOLD_TICKS (was 40 @196Hz — a ~300ms hold misread as tap, latching momentary views) */

function _onCC_jog(d1, d2) {
    if (S.shiftTrackLEDActive) { S.shiftTrackLEDActive = false; S.screenDirty = true; }
    /* Inherit picker: jog click confirms selection (-1 = Start blank). */
    if (d1 === 3 && d2 === 127 && S.pendingInheritPicker) {
        const p = S.pendingInheritPicker;
        const action = (p.selectedIndex === p.candidates.length) ? -1 : p.selectedIndex;
        resolveInheritPicker(action);
        return;
    }
    /* Snapshot picker: jog click resolves a confirm or arms one. */
    if (d1 === 3 && d2 === 127 && S.snapshotPicker) {
        snapshotPickerClick();
        return;
    }
    /* CLEAR AUTOMATION modal: jog click toggles a row / executes CLEAR. */
    if (d1 === 3 && d2 === 127 && S.clearAutoMenu) {
        clearAutoMenuClick();
        return;
    }
    /* Scene bake confirm: two-phase jog flow — loop count, then wrap yes/no. */
    if (d1 === 3 && d2 === 127 && S.confirmBakeScene) {
        if (S.confirmBakeSceneCondPhase) {
            /* Apply-Conductor dialog: 0=YES, 1=NO, 2=CANCEL */
            if (S.confirmBakeSceneCondSel === 2) {
                /* Cancel: abort the whole scene bake. */
                S.confirmBakeSceneCondPhase = false;
                S.confirmBakeScene          = false;
                S.screenDirty               = true;
                return;
            }
            const _apply = S.confirmBakeSceneCondSel === 0 ? 1 : 0;
            commitSceneBake(S.confirmBakeSceneClip, S.confirmBakeSceneLoops,
                            S.confirmBakeSceneWrap, _apply);
            S.confirmBakeSceneCondPhase = false;
            S.confirmBakeScene          = false;
            S.screenDirty               = true;
            return;
        }
        if (S.confirmBakeSceneWrapPhase) {
            /* Wrap dialog: 0=YES, 1=NO, 2=CANCEL */
            if (S.confirmBakeSceneWrapSel < 2) {
                const _wrap = S.confirmBakeSceneWrapSel === 0 ? 1 : 0;
                if (sceneBakeHasConductor(S.confirmBakeSceneClip)) {
                    /* Advance to the Apply-Conductor phase; hold loop+wrap. */
                    S.confirmBakeSceneWrap      = _wrap;
                    S.confirmBakeSceneWrapPhase = false;
                    S.confirmBakeSceneCondPhase = true;
                    S.confirmBakeSceneCondSel   = 1; /* default: NO */
                    S.screenDirty               = true;
                    return;
                }
                /* No conductor / no responders: commit immediately (A=0). */
                commitSceneBake(S.confirmBakeSceneClip, S.confirmBakeSceneLoops, _wrap, 0);
            }
            S.confirmBakeSceneWrapPhase = false;
            S.confirmBakeScene          = false;
            S.screenDirty               = true;
            return;
        }
        if (S.confirmBakeSceneSel > 0) {
            /* Advance to wrap phase, hold loop count for the commit step. */
            S.confirmBakeSceneLoops     = [1, 2, 4][S.confirmBakeSceneSel - 1];
            S.confirmBakeSceneWrapPhase = true;
            S.confirmBakeSceneWrapSel   = 1; /* default: NO */
            S.screenDirty               = true;
            return;
        }
        S.confirmBakeScene = false;
        S.screenDirty      = true;
        return;
    }

    /* Lgto confirm: jog click commits (OK applies, CANCEL aborts). */
    if (d1 === 3 && d2 === 127 && S.confirmLgto) {
        const _sel = S.confirmLgtoSel | 0;
        S.confirmLgto = false;
        if (_sel === 0 && typeof host_module_set_param === 'function') {
            const _t = S.activeTrack;
            if (S.confirmLgtoIsDrum) {
                const _l = S.activeDrumLane[_t];
                host_module_set_param('t' + _t + '_l' + _l + '_lgto_apply', '1');
                S.pendingDrumResync      = 2;
                S.pendingDrumResyncTrack = _t;
            } else {
                host_module_set_param('t' + _t + '_lgto_apply', '1');
                S.pendingStepsReread      = 2;
                S.pendingStepsRereadTrack = _t;
                S.pendingStepsRereadClip  = S.trackActiveClip[_t];
            }
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            showActionPopup('LGTO', 'APPLIED');
        }
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    /* State version mismatch dialog: Yes = wipe + clean start; No = exit module. */
    if (d1 === 3 && d2 === 127 && S.confirmStateWipe) {
        S.confirmStateWipe = false;
        if (S.confirmStateWipeSel === 0) {
            S.pendingSetLoad = true;
        } else {
            removeFlagsWrap();
            clearAllLEDs();
            if (typeof host_exit_module === 'function') host_exit_module();
        }
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    /* BPM-controlled-by-Move info: jog click = OK (dismiss). */
    if (d1 === 3 && d2 === 127 && S.bpmMoveInfo) {
        S.bpmMoveInfo = false;
        forceRedraw();
        return;
    }

    /* REC Unavailable dialog: jog click commits selection (OK = dismiss,
     * BAKE NOW = open standard bake confirm pre-targeted at active clip). */
    if (d1 === 3 && d2 === 127 && S.recordBlockedDialog) {
        const _sel = S.recordBlockedDialogSel | 0;
        S.recordBlockedDialog = false;
        if (_sel === 1) {
            /* Open bake confirm at active clip — same path as Capture-bare-tap. */
            const _bt = S.activeTrack, _bc = S.trackActiveClip[_bt];
            const _isDrum = S.trackPadMode[_bt] === PAD_MODE_DRUM;
            S.confirmBake             = true;
            S.confirmBakeIsDrum       = _isDrum;
            S.confirmBakeIsMultiLoop  = !_isDrum;
            S.confirmBakeSel          = _isDrum ? 2 : 1;
            S.confirmBakeTrack        = _bt;
            S.confirmBakeClip         = _bc;
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBakeWrapPhase    = false;
        }
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    /* Bake confirm: jog click confirms/cancels when dialog is open */
    if (d1 === 3 && d2 === 127 && S.confirmBake) {
        if (S.confirmBakeWrapPhase) {
            /* Wrap dialog: 0=YES, 1=NO, 2=CANCEL */
            if (S.confirmBakeWrapSel < 2) {
                const _wrap = S.confirmBakeWrapSel === 0 ? 1 : 0;
                const _loops = S.confirmBakeLoops;
                if (S.confirmBakeIsDrum) {
                    const _laneArg = S.confirmBakeDrumMode === 1 ? ' ' + S.activeDrumLane[S.confirmBakeTrack] : ' 0';
                    S.pendingDefaultSetParams.push({
                        key: 'bake',
                        val: S.confirmBakeTrack + ' ' + S.confirmBakeClip + ' ' + S.confirmBakeDrumMode + ' ' + _loops + _laneArg + ' ' + _wrap
                    });
                    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                    showActionPopup('BAKED', _loops + 'x');
                    S.pendingBankRefresh = S.confirmBakeTrack;
                    if (S.confirmBakeClip === S.trackActiveClip[S.confirmBakeTrack]) {
                        S.pendingDrumResync      = 2;
                        S.pendingDrumResyncTrack = S.confirmBakeTrack;
                    }
                } else {
                    S.pendingDefaultSetParams.push({
                        key: 'bake',
                        val: S.confirmBakeTrack + ' ' + S.confirmBakeClip + ' 0 ' + _loops + ' 0 ' + _wrap
                    });
                    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                    showActionPopup('BAKED', _loops + 'x');
                    S.pendingBankRefresh      = S.confirmBakeTrack;
                    S.pendingStepsReread      = 2;
                    S.pendingStepsRereadTrack = S.confirmBakeTrack;
                    S.pendingStepsRereadClip  = S.confirmBakeClip;
                }
            }
            S.confirmBakeWrapPhase    = false;
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBake  = false;
            S.screenDirty  = true;
            return;
        }
        if (S.confirmBakeIsMultiLoop) {
            if (S.confirmBakeSel > 0) {
                /* advance to wrap dialog */
                S.confirmBakeLoops     = [1, 2, 4][S.confirmBakeSel - 1];
                S.confirmBakeWrapPhase = true;
                S.confirmBakeWrapSel   = 1; /* default: NO */
                S.screenDirty = true;
                return;
            }
        } else if (!S.confirmBakeIsDrum) {
            if (S.confirmBakeSel === 0) {
                host_module_set_param('bake', S.confirmBakeTrack + ' ' + S.confirmBakeClip);
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                showActionPopup('BAKED');
                S.pendingBankRefresh = S.confirmBakeTrack;
                S.pendingStepsReread      = 2;
                S.pendingStepsRereadTrack = S.confirmBakeTrack;
                S.pendingStepsRereadClip  = S.confirmBakeClip;
            }
        } else if (S.confirmBakeDrumLoopOpen) {
            /* drum step 2: loop count — 0=CANCEL, 1-3 = 1x/2x/4x → wrap dialog */
            if (S.confirmBakeDrumLoopSel > 0) {
                S.confirmBakeLoops     = [1, 2, 4][S.confirmBakeDrumLoopSel - 1];
                S.confirmBakeWrapPhase = true;
                S.confirmBakeWrapSel   = 1; /* default: NO */
                S.screenDirty = true;
                return;
            }
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBake = false;
            S.screenDirty = true;
            return;
        } else {
            /* drum step 1: 0=CLIP, 1=LANE, 2=CANCEL */
            if (S.confirmBakeSel < 2) {
                S.confirmBakeDrumMode     = S.confirmBakeSel === 0 ? 2 : 1;
                S.confirmBakeDrumLoopOpen = true;
                S.confirmBakeDrumLoopSel  = 1;
                S.screenDirty = true;
                return;
            }
        }
        S.confirmBake = false;
        S.screenDirty = true;
        return;
    }

    /* CC 3 = jog wheel physical click */
    if (d1 === 3 && d2 === 127 && S.tapTempoOpen) {
        closeTapTempo();
        S.screenDirty = true;
        return;
    }
    if (d1 === 3 && d2 === 127 && S.globalMenuOpen) {
        if (S.exportDoneDialog) {            /* OK dismiss */
            S.exportDoneDialog = false;
            S.globalMenuOpen   = false;
            S.screenDirty = true;
            return;
        }
        if (S.confirmClearSession) {
            if (S.confirmClearSel === 0) doClearSession();
            else { S.confirmClearSession = false; }
            S.screenDirty = true;
            return;
        }
        if (S.confirmSaveState) {
            const yes = S.confirmSaveSel === 0;
            S.confirmSaveState = false;
            if (yes) openSaveSnapshot();
            S.screenDirty = true;
            return;
        }
        if (S.confirmConvertToDrum) {
            const _ct = S.confirmConvertTrack;
            const _yes = S.confirmConvertToDrumSel === 0;
            closeConvertConfirm();
            /* Defer to tick() — this runs in the on_midi path where get_param
             * (inside convertTrackType -> syncClipsFromDsp) returns null. */
            if (_yes) S.pendingTrackConvert = { t: _ct, toDrum: true };
            S.screenDirty = true;
            return;
        }
        if (S.confirmConvertToConduct) {
            const _ct  = S.confirmConvertTrack;
            const _yes = S.confirmConvertToConductSel === 0;
            closeConvertConfirm();
            /* Defer to tick() — convertTrackToConduct's role readback uses
             * get_param, which returns null in the on_midi path. */
            if (_yes) S.pendingConductConvert = _ct;
            S.screenDirty = true;
            return;
        }
        if (S.menuInfoLines.length > 0) {
            /* Single-button INFO dialog — any click dismisses. */
            S.menuInfoLines = [];
            S.screenDirty = true;
            return;
        }
        if (S.confirmExportCondPhase) {
            confirmExportCondClick();   /* 0=YES,1=NO commit; 2=CANCEL aborts export */
            S.screenDirty = true;
            return;
        }
        if (S.confirmExport) {
            if (S.confirmExportSel === 0) confirmExportStart();   /* Yes → cond stage or arm export */
            else S.confirmExport = false;
            S.screenDirty = true;
            return;
        }
        if (S.confirmXpose) {                 /* "Transpose all clips?" Yes/No */
            if (S.confirmXposeSel === 0) xposeCommit(S.confirmXposeKey, S.confirmXposeScale);
            else                         xposeCancelPreview();
            S.confirmXpose = false;
            if (S.globalMenuState) { S.globalMenuState.editing = false; S.globalMenuState.editValue = null; }
            S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
            S.screenDirty = true;
            return;
        }
        /* Key/Scale: intercept the click that would finalize the enum edit.
         * No change → exit. Has melodic notes → confirm. Empty → commit silently. */
        {
            const _it = (S.globalMenuState && S.globalMenuItems)
                        ? S.globalMenuItems[S.globalMenuState.selectedIndex] : null;
            if (_it && S.globalMenuState.editing && (_it.label === 'Key' || _it.label === 'Scale')) {
                const ev    = S.globalMenuState.editValue !== null ? S.globalMenuState.editValue : _it.get();
                const candK = _it.label === 'Key'   ? ev : S.padKey;
                const candS = _it.label === 'Scale' ? ev : S.padScale;
                if (candK === S.padKey && candS === S.padScale) {
                    xposeCancelPreview();
                    S.globalMenuState.editing = false; S.globalMenuState.editValue = null;
                    S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
                } else if (anyMelodicClipHasContent()) {
                    S.confirmXpose = true; S.confirmXposeSel = 0;
                    S.confirmXposeKey = candK; S.confirmXposeScale = candS;
                    /* keep editing + preview armed under the dialog */
                } else {
                    xposeCommit(candK, candS);
                    S.globalMenuState.editing = false; S.globalMenuState.editValue = null;
                    S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
                }
                S.screenDirty = true;
                return;
            }
        }
        /* Mode (track type): DEFERRED COMMIT. The click that finalizes the Mode
         * edit triggers the conversion confirm; scrolling never does (Mode set()
         * is a no-op). No change → exit. Mirrors the Key/Scale interceptor. */
        {
            const _mi = (S.globalMenuState && S.globalMenuItems)
                        ? S.globalMenuItems[S.globalMenuState.selectedIndex] : null;
            if (_mi && S.globalMenuState.editing && _mi.label === 'Mode') {
                const t      = S.activeTrack;
                const target = S.globalMenuState.editValue !== null ? S.globalMenuState.editValue : _mi.get();
                const cur    = S.trackPadMode[t];
                S.globalMenuState.editing = false; S.globalMenuState.editValue = null;
                S.lastSentMenuEditValue = null; S.bpmWasEditing = false;
                if (target !== cur) {
                    if (S.playing) {
                        showMenuInfo('Stop playback', 'to change the', 'track type.');
                        S.screenDirty = true;
                        return;
                    }
                    if (target === PAD_MODE_DRUM) {
                        /* Keys/Cond -> Drums: confirm only if notes would be lost. */
                        let hasData = false;
                        for (let c = 0; c < NUM_CLIPS; c++)
                            if (S.clipNonEmpty[t][c]) { hasData = true; break; }
                        if (hasData) {
                            S.confirmConvertToDrum = true; S.confirmConvertToDrumSel = 1;
                            S.confirmConvertTrack = t;
                        } else {
                            S.pendingTrackConvert = { t: t, toDrum: true };
                        }
                    } else if (target === PAD_MODE_CONDUCT) {
                        /* Pre-empt the common case: a Conductor already exists on
                         * a DIFFERENT track. DSP would refuse, and the action
                         * popup is invisible while the menu is open. Show the
                         * menu-visible info dialog instead of confirming/sending. */
                        const existingCond = conductorTrackIdx();
                        if (existingCond >= 0 && existingCond !== t) {
                            showMenuInfo('Conductor exists', 'on T' + (existingCond + 1) + '.', 'Route it back first.');
                        } else {
                            /* Keys/Drums -> Conductor: always confirm (keeps notes,
                             * clears FX/ARP/Auto; DSP enforces one Conductor). */
                            S.confirmConvertToConduct = true; S.confirmConvertToConductSel = 1;
                            S.confirmConvertTrack = t;
                        }
                    } else {
                        /* Drums/Conductor -> Keys: no prompt; defer to tick(). */
                        if (S.conductorTrack === t) S.conductorTrack = -1;
                        S.pendingTrackConvert = { t: t, toDrum: false };
                    }
                }
                S.screenDirty = true;
                return;
            }
        }
        handleMenuInput({
            cc: 3, value: d2,
            items: S.globalMenuItems, state: S.globalMenuState, stack: S.globalMenuStack,
            onBack: function() { S.globalMenuOpen = false; },
            shiftHeld: S.shiftHeld
        });
        S.screenDirty = true;
        return;
    }

    if (d1 === 3 && d2 === 127 && S.shiftHeld && S.deleteHeld && !S.sessionView) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum: Shift+Delete+jog = reset all real-time FX banks + Dir/RvSt/SqFl */
            const _dt = S.activeTrack, _dl = S.activeDrumLane[_dt], _dac = effectiveClip(_dt);
            resetFxBanks(_dt);
            S.drumLanePlaybackDir[_dt][_dl] = 0;
            S.drumLanePlaybackAudioReverse[_dt][_dl] = 0;
            S.bankParams[_dt][0][6] = 0;
            S.clipSeqFollow[_dt][_dac] = true;
            S.bankParams[_dt][0][7] = 1;
            S.pendingDefaultSetParams.push({ key: 't' + _dt + '_l' + _dl + '_playback_dir', val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + _dt + '_l' + _dl + '_playback_audio_reverse', val: '0' });
            showActionPopup('LANE PARAMS', 'RESET');
        } else {
            /* Melodic: full reset — NOTE FX, HARMZ, MIDI DLY, + SEQ ARP */
            const _arpTrack = S.activeTrack;
            const _arpParams = Array.from({length: 8}, function(_, k) {
                const pm = BANKS[4].knobs[k]; return pm ? S.bankParams[_arpTrack][4][k] : 0;
            });
            resetFxBanks(_arpTrack);
            for (let k = 0; k < 8; k++) {
                const pm = BANKS[4].knobs[k];
                if (pm) S.bankParams[_arpTrack][4][k] = pm.def;
            }
            /* Bank reset also clears ALL automation (CC + AT, + PB later) for the clip. */
            const _ac2 = effectiveClip(_arpTrack);
            S.trackCCAutoBits[_arpTrack][_ac2] = 0;
            S.trackCCLiveVal[_arpTrack] = new Array(8).fill(-1);
            S.clipCCVal[_arpTrack][_ac2] = new Array(8).fill(-1);
            S.clipAtHas[_arpTrack][_ac2] = false;
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_cc_auto_clear', val: String(_ac2) });
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_c' + _ac2 + '_at_clear', val: '1' });
            S.undoSeqArpSnapshot = { track: _arpTrack, params: _arpParams };
            const _mac = effectiveClip(_arpTrack);
            S.clipPlaybackDir[_arpTrack][_mac] = 0;
            S.clipPlaybackAudioReverse[_arpTrack][_mac] = 0;
            S.bankParams[_arpTrack][0][6] = 0;
            S.clipSeqFollow[_arpTrack][_mac] = true;
            S.bankParams[_arpTrack][0][7] = 1;
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_clip_playback_dir', val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + _arpTrack + '_clip_playback_audio_reverse', val: '0' });
            showActionPopup('CLIP PARAMS', 'RESET');
        }
        return;
    }
    if (d1 === 3 && d2 === 127 && S.deleteHeld && !S.sessionView) {
        /* CC PARAM bank (bank 6): Delete+jog clears all CC automation for the
         * active clip. This branch must run regardless of pad mode or drum
         * perform mode — previously it was nested inside the melodic branch,
         * so on a drum track in Rpt mode it was silently shadowed by the
         * repeat-groove reset path. */
        if (S.activeBank === 6) {
            /* AUTOMATION bank: Delete+jog clears ALL automation types for the
             * active clip (CC + AT, and PB once implemented). */
            const _t = S.activeTrack, _c = effectiveClip(_t);
            S.trackCCAutoBits[_t][_c] = 0;
            S.trackCCLiveVal[_t] = new Array(8).fill(-1);
            /* Reset the resting values too → "—" (cc_auto_clear clears both
             * automation and rest_val DSP-side). */
            S.clipCCVal[_t][_c] = new Array(8).fill(-1);
            S.clipAtHas[_t][_c] = false;
            /* Defer clear pushes — synchronous from jog handler coalesces. */
            S.pendingDefaultSetParams.push({ key: 't' + _t + '_cc_auto_clear', val: String(_c) });
            S.pendingDefaultSetParams.push({ key: 't' + _t + '_c' + _c + '_at_clear', val: '1' });
            showActionPopup('AUTOMATION', 'CLEAR');
            invalidateLEDCache();
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            if (S.drumPerformMode[S.activeTrack] > 0) {
                /* Rpt/Rpt2 mode: Delete+jog = reset current lane groove params */
                const _rt = S.activeTrack;
                const _rl = S.activeDrumLane[_rt];
                S.drumRepeatGate[_rt][_rl]    = 0xFF;
                S.drumRepeatGateLen[_rt][_rl] = 8;
                for (let _s = 0; _s < 8; _s++) {
                    S.drumRepeatVelScale[_rt][_rl][_s] = 100;
                    S.drumRepeatNudge[_rt][_rl][_s]    = 0;
                }
                /* Defer reset push — synchronous from jog handler coalesces. */
                S.pendingDefaultSetParams.push({ key: 't' + _rt + '_l' + _rl + '_repeat_groove_reset', val: '1' });
                showActionPopup('RPT GROOVE', 'RESET');
            } else {
                /* Drum: Delete+jog = reset only the active real-time FX bank + Dir/RvSt/SqFl */
                const REAL_TIME_BANKS = [1, 2, 3];
                if (REAL_TIME_BANKS.indexOf(S.activeBank) >= 0) {
                    resetSingleFxBank(S.activeTrack, S.activeBank);
                }
                const _bt = S.activeTrack, _bl = S.activeDrumLane[_bt], _bac = effectiveClip(_bt);
                S.drumLanePlaybackDir[_bt][_bl] = 0;
                S.drumLanePlaybackAudioReverse[_bt][_bl] = 0;
                S.bankParams[_bt][0][6] = 0;
                S.clipSeqFollow[_bt][_bac] = true;
                S.bankParams[_bt][0][7] = 1;
                S.pendingDefaultSetParams.push({ key: 't' + _bt + '_l' + _bl + '_playback_dir', val: '0' });
                S.pendingDefaultSetParams.push({ key: 't' + _bt + '_l' + _bl + '_playback_audio_reverse', val: '0' });
                showActionPopup('BANK RESET');
            }
        } else if (S.activeBank === 5) {
            /* ARP IN bank: dedicated reset that clears every TARP param
             * (style/rate/oct/gate/steps_mode/retrigger/latch/sync + step arrays
             * + loop length). Shift+Delete+jog (above) intentionally leaves
             * ARP IN alone. */
            resetTarp(S.activeTrack);
            showActionPopup('ARP IN', 'RESET');
        } else {
            const _mt = S.activeTrack, _mac2 = effectiveClip(_mt);
            resetFxBanks(_mt);
            S.undoSeqArpSnapshot = null;
            S.clipPlaybackDir[_mt][_mac2] = 0;
            S.clipPlaybackAudioReverse[_mt][_mac2] = 0;
            S.bankParams[_mt][0][6] = 0;
            S.clipSeqFollow[_mt][_mac2] = true;
            S.bankParams[_mt][0][7] = 1;
            S.pendingDefaultSetParams.push({ key: 't' + _mt + '_clip_playback_dir', val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + _mt + '_clip_playback_audio_reverse', val: '0' });
            showActionPopup('BANK RESET');
        }
        return;
    }
    /* Plain jog click on SEQ ARP (bank 4) or TARP (bank 5) in Track View toggles
     * the Arp Steps interval-edit overlay: knobs K1-K8 become per-step scale-degree
     * offsets (±24), pad grid is the persistent step-vel level editor. Auto-clears
     * on next jog turn (handled in the main-knob delta branch below). */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
            (S.activeBank === 4 || S.activeBank === 5)) {
        S.stepIntervalMode = !S.stepIntervalMode;
        /* Repush padmap so pads stop dispatching notes while the overlay is on. */
        computePadNoteMap();
        S.screenDirty = true;
        forceRedraw();
        return;
    }
    /* Plain jog click on an alt-param bank: toggle sticky alt-param mode.
     * Perform-mode switching now lives only on Shift+step-8 (see _onStepButtons).
     * The Arp-Steps block above is gated melodic-only, so on drum tracks bank 5
     * (REPEAT GROOVE) correctly falls through here to toggle VEL/NUDGE. */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && bankHasAltParams(S.activeTrack, S.activeBank)) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed) {
            S.allLanesConfirmed = true;
            S.screenDirty = true;
            forceRedraw();
            return;
        }
        S.altMode = !S.altMode;
        S.screenDirty = true;
        forceRedraw();
        return;
    }

    if (d1 === MoveMainKnob) {

        /* Arp Steps interval mode: jog turn exits the overlay and swallows
         * the turn so the underlying bank knob param isn't nudged on exit. */
        if (S.stepIntervalMode) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.stepIntervalMode = false;
                computePadNoteMap();
                S.screenDirty = true;
                forceRedraw();
            }
            return;
        }

        if (S.pendingInheritPicker) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                const p = S.pendingInheritPicker;
                const total = p.candidates.length + 1;
                p.selectedIndex = (p.selectedIndex + (delta > 0 ? 1 : total - 1)) % total;
                S.screenDirty = true;
            }
            return;
        }
        if (S.snapshotPicker) {
            snapshotPickerRotate(decodeDelta(d2));
            return;
        }
        if (S.clearAutoMenu) {
            clearAutoMenuRotate(decodeDelta(d2));
            return;
        }
        if (S.confirmBakeScene) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.confirmBakeSceneCondPhase)
                    S.confirmBakeSceneCondSel = (S.confirmBakeSceneCondSel + (delta > 0 ? 1 : 2)) % 3;
                else if (S.confirmBakeSceneWrapPhase)
                    S.confirmBakeSceneWrapSel = (S.confirmBakeSceneWrapSel + (delta > 0 ? 1 : 2)) % 3;
                else
                    S.confirmBakeSceneSel = (S.confirmBakeSceneSel + (delta > 0 ? 1 : 3)) % 4;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmStateWipe) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmStateWipeSel = S.confirmStateWipeSel === 0 ? 1 : 0;
                S.screenDirty = true;
            }
            return;
        }
        if (S.recordBlockedDialog) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.recordBlockedDialogSel = S.recordBlockedDialogSel === 0 ? 1 : 0;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmLgto) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmLgtoSel = S.confirmLgtoSel === 0 ? 1 : 0;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmBake && S.confirmBakeWrapPhase) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmBakeWrapSel = (S.confirmBakeWrapSel + (delta > 0 ? 1 : 2)) % 3;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmBake && S.confirmBakeIsDrum && S.confirmBakeDrumLoopOpen) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.confirmBakeDrumLoopSel = (S.confirmBakeDrumLoopSel + (delta > 0 ? 1 : 3)) % 4;
                S.screenDirty = true;
            }
            return;
        }
        if (S.confirmBake) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.confirmBakeIsDrum) {
                    S.confirmBakeSel = (S.confirmBakeSel + (delta > 0 ? 1 : 2)) % 3;
                } else if (S.confirmBakeIsMultiLoop) {
                    S.confirmBakeSel = (S.confirmBakeSel + (delta > 0 ? 1 : 3)) % 4;
                } else {
                    S.confirmBakeSel = S.confirmBakeSel === 0 ? 1 : 0;
                }
                S.screenDirty = true;
            }
            return;
        }
        if (S.tapTempoOpen && !S.shiftHeld) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                S.tapTempoBpm = Math.max(40, Math.min(250, S.tapTempoBpm + delta));
                host_module_set_param('bpm', String(S.tapTempoBpm));
                S.screenDirty = true;
            }
            return;
        }
        if (S.globalMenuOpen && !S.shiftHeld) {
            ensureGlobalMenuFresh();
            if (S.exportDoneDialog) {
                /* single OK button — jog does nothing */
            } else if (S.confirmClearSession) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmClearSel = S.confirmClearSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmSaveState) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmSaveSel = S.confirmSaveSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmConvertToDrum) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmConvertToDrumSel = S.confirmConvertToDrumSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmConvertToConduct) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmConvertToConductSel = S.confirmConvertToConductSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.menuInfoLines.length > 0) {
                /* Single-button INFO dialog — no selection to toggle; swallow jog turns. */
            } else if (S.confirmExportCondPhase) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmExportCondSel = (S.confirmExportCondSel + (delta > 0 ? 1 : 2)) % 3; S.screenDirty = true; }
            } else if (S.confirmExport) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmExportSel = S.confirmExportSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.confirmXpose) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmXposeSel = S.confirmXposeSel === 0 ? 1 : 0; S.screenDirty = true; }
            } else if (S.globalMenuState.editing) {
                const delta = decodeDelta(d2);
                if (delta !== 0) {
                    const item = S.globalMenuItems[S.globalMenuState.selectedIndex];
                    if (item && item.type === 'value') {
                        const cur = S.globalMenuState.editValue !== null ? S.globalMenuState.editValue : item.get();
                        S.globalMenuState.editValue = Math.min(item.max, Math.max(item.min, cur + delta));
                    } else if (item && item.type === 'enum') {
                        const opts = item.options || [];
                        const idx  = opts.indexOf(S.globalMenuState.editValue);
                        const sign = delta > 0 ? 1 : -1;
                        S.globalMenuState.editValue = opts[((idx + sign) % opts.length + opts.length) % opts.length];
                    }
                    S.screenDirty = true;
                }
            } else {
                handleMenuInput({
                    cc: MoveMainKnob, value: d2,
                    items: S.globalMenuItems, state: S.globalMenuState, stack: S.globalMenuStack,
                    onBack: function() { S.globalMenuOpen = false; },
                    shiftHeld: false
                });
                S.screenDirty = true;
            }
        } else {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.shiftHeld) {
                    /* Shift + jog (any view): step active track 0–7, clamp at ends */
                    const next = Math.min(NUM_TRACKS - 1, Math.max(0, S.activeTrack + delta));
                    if (next !== S.activeTrack) {
                        extNoteOffAll();
                        handoffRecordingToTrack(next);
                        _switchActiveTrack(next);
                        if (S.trackPadMode[next] === PAD_MODE_DRUM) {
                            if (S.activeBank === 2 || S.activeBank === 4) S.activeBank = 0;
                            resyncDrumTrack(next);
                        } else {
                            if (S.activeBank === 7) S.activeBank = 0;
                            refreshPerClipBankParams(next);
                        }
                        computePadNoteMap();
                        S.seqActiveNotes.clear();
                        S.seqLastStep = -1;
                        S.seqLastClip = -1;
                        forceRedraw();
                    }
                } else if (S.sessionView) {
                    S.sceneRow = Math.min(NUM_CLIPS - 4, Math.max(0, S.sceneRow + delta));
                    forceRedraw();
                } else if (S.loopHeld) {
                    /* Track View + Loop held: adjust length ±1 step */
                    const _t  = S.activeTrack;
                    if (S.recordArmed && !S.recordCountingIn) {
                        /* Block length changes during active recording */
                    } else if (S.trackPadMode[_t] === PAD_MODE_DRUM && S.activeBank !== 6) {
                        if (allLanesGate()) return;
                        /* Drum: adjust length. In ALL LANES bank, length applies to all 32
                         * lanes atomically; in per-lane DRUM bank, just the active lane.
                         * (AUTO bank falls through to the CC-lane-length branch below — each
                         * automation param lane has its own loop length, like melodic.) */
                        const _lane = S.activeDrumLane[_t];
                        const _cur  = S.drumLaneLength[_t];
                        const _nv   = Math.max(1, Math.min(256, _cur + delta));
                        if (_nv !== _cur) {
                            S.drumLaneLength[_t] = _nv;
                            S.drumLaneLengthManuallySet[_t] = true;
                            /* Boundary page is window-aware: last absolute step is
                             * loop_start + length - 1, so the page containing it is
                             * floor((loop_start + length - 1) / 16). */
                            const _ls = S.drumLaneLoopStart[_t] | 0;
                            const _maxPage = Math.max(0, Math.floor((_ls + _nv - 1) / 16));
                            /* Show OOB step view in both modes — navigate to boundary page
                             * so the step-level OOB greying renders. */
                            S.loopJogActive = true;
                            S.loopJogLastTick = S.tickCount;
                            S.drumStepPage[_t] = _maxPage;
                            if (typeof host_module_set_param === 'function') {
                                if (S.activeBank === 7) {
                                    host_module_set_param('t' + _t + '_all_lanes_length', String(_nv));
                                } else {
                                    host_module_set_param('t' + _t + '_l' + _lane + '_clip_length', String(_nv));
                                }
                            }
                            forceRedraw();
                        }
                    } else if (S.activeBank === 6) {
                        var _ac = effectiveClip(_t);
                        var _ccL = S.ccActiveLane[_t];
                        var _cur = S.ccLaneLength[_t][_ac][_ccL];
                        if (_cur === 0) {
                            var _cTps = S.clipTPS[_t][_ac] || 24;
                            var _lTps = S.ccLaneTps[_t][_ac][_ccL] || _cTps;
                            _cur = Math.max(1, Math.round(S.clipLength[_t][_ac] * _cTps / _lTps));
                        }
                        var _nv  = Math.max(1, Math.min(256, _cur + delta));
                        if (_nv !== _cur) {
                            S.ccLaneLength[_t][_ac][_ccL] = _nv;
                            S.loopJogActive = true;
                            S.loopJogLastTick = S.tickCount;
                            var _ls = S.ccLaneLoopStart[_t][_ac][_ccL] | 0;
                            S.trackCurrentPage[_t] = Math.max(0, Math.floor((_ls + _nv - 1) / 16));
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + _t + '_c' + _ac + '_k' + _ccL + '_cc_lane_length', String(_nv));
                            forceRedraw();
                        }
                    } else {
                    const _ac = effectiveClip(_t);
                    const _cur = S.clipLength[_t][_ac];
                    const _nv  = Math.max(1, Math.min(256, _cur + delta));
                    if (_nv !== _cur) {
                        S.clipLength[_t][_ac] = _nv;
                        S.clipLengthManuallySet[_t][_ac] = true;
                        /* Show OOB step view: navigate to boundary page (window-aware) */
                        S.loopJogActive = true;
                        S.loopJogLastTick = S.tickCount;
                        const _ls = S.clipLoopStart[_t][_ac] | 0;
                        S.trackCurrentPage[_t] = Math.max(0, Math.floor((_ls + _nv - 1) / 16));
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _t + '_clip_length', String(_nv));
                        forceRedraw();
                    }
                    }
                } else {
                    const cur = S.activeBank;
                    const isDrumJog = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
                    const isConductJog = S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT;
                    let next;
                    if (isConductJog) {
                        /* Conductor cycles 5 banks: Conduct(0=CLIP) → NOTE FX(1) → Responder → Octave → When */
                        const CONDUCT_BANK_ORDER = [0, 1, BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN];
                        const ci = CONDUCT_BANK_ORDER.indexOf(cur);
                        const ni = Math.max(0, Math.min(CONDUCT_BANK_ORDER.length - 1, (ci >= 0 ? ci : 0) + delta));
                        next = CONDUCT_BANK_ORDER[ni];
                    } else if (isDrumJog) {
                        /* Drum bank order: ALL LANES(7) → DRUM LANE(0) → NOTE FX(1) → MIDI DLY(3) → RPT GROOVE(5) → CC PARAM(6) */
                        const DRUM_BANK_ORDER = [7, 0, 1, 3, 5, 6];
                        const ci = DRUM_BANK_ORDER.indexOf(cur);
                        const ni = Math.max(0, Math.min(DRUM_BANK_ORDER.length - 1, (ci >= 0 ? ci : 0) + delta));
                        next = DRUM_BANK_ORDER[ni];
                    } else {
                        next = Math.min(6, Math.max(0, cur + delta));
                    }
                    if (next !== cur) {
                        S.activeBank = next;
                        S.trackActiveBank[S.activeTrack] = next;
                        if (next === 7) S.allLanesConfirmed = false;
                        if (next === 6) S.schLabelFetchLane = 0;
                        readBankParams(S.activeTrack, next);
                        S.bankSelectTick = S.tickCount;
                        writeSidecar();
                        forceRedraw();
                    }
                }
            }
        }
        return;
    }

}

function _onCC_buttons(d1, d2) {
    if (d1 === MoveShift) {
        S.shiftHeld = d2 === 127;
        S.shiftTrackLEDActive = d2 === 127;
        /* PHASE-1: re-push padmap on Shift transitions so DSP on_midi sees
         * all-0xFF while Shift is held (suppress pad-shortcut notes) and
         * the real map again on release. See computePadNoteMap mute logic. */
        computePadNoteMap();
        /* Shift in Track View is a track-switch modifier (Shift+jog / Shift+pad),
         * not a param gesture. Cancel any transient param-bank display on BOTH
         * Shift edges so the OLED stays on the track overview while switching —
         * the usual gesture touches the jog (jogTouched→bank view) before pressing
         * Shift, and Shift-press never cleared it before. Mirrors the jog-release
         * clear in the MoveMainTouch handler. */
        if (!S.sessionView) { S.jogTouched = false; S.bankSelectTick = -1; }
        /* Deferred Shift+Step3 dispatch: fire on Shift release so the Shift
         * held state doesn't leak into Move firmware / Schwung chain editor. */
        if (!S.shiftHeld && S.pendingEditEntryTrack >= 0) {
            const _t = S.pendingEditEntryTrack;
            S.pendingEditEntryTrack = -1;
            if (S.trackRoute[_t] === 1 &&
                typeof shadow_corun_begin === 'function' &&
                typeof move_midi_inject_to_move === 'function') {
                enterMoveNativeCoRun(_t);
            } else if (S.trackRoute[_t] === 0 &&
                typeof shadow_corun_begin === 'function') {
                openSchwungSlotEditor(_t);
            }
        }
        if (!S.sessionView) forceRedraw();
    }

    /* Any non-Shift CC button press while Shift overlay is active clears the overlay */
    if (d1 !== MoveShift && d2 === 127 && S.shiftTrackLEDActive) {
        S.shiftTrackLEDActive = false;
    }

    if (d1 === MoveDelete) {
        S.deleteHeld = d2 === 127;
        /* Loop+Delete on auto bank: reset active lane's loop params */
        if (d2 === 127 && S.loopHeld && S.activeBank === 6 && !S.sessionView) {
            var _rdt = S.activeTrack, _rdac = effectiveClip(_rdt), _rdl = S.ccActiveLane[_rdt];
            S.ccLaneLoopStart[_rdt][_rdac][_rdl] = 0;
            S.ccLaneLength[_rdt][_rdac][_rdl] = 0;
            S.ccLaneTps[_rdt][_rdac][_rdl] = 0;
            S.ccLaneResTps[_rdt][_rdac][_rdl] = 0;
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            S.pendingDefaultSetParams.push({ key: 't' + _rdt + '_c' + _rdac + '_k' + _rdl + '_cc_lane_reset', val: '1' });
            showActionPopup('LANE LOOP', 'RESET');
            forceRedraw();
            computePadNoteMap();
            return;
        }
        /* AUTO-bank Delete-tap → CLEAR AUTOMATION menu. Arm on press (melodic
         * AUTO bank only); a clean release (nothing happened while held, see the
         * disqualify check at the top of this handler) opens the menu. */
        if (d2 === 127) {
            S.deleteTapArmed = (S.activeBank === 6 && !S.sessionView &&
                                !S.clearAutoMenu);
        } else if (S.deleteTapArmed) {
            S.deleteTapArmed = false;
            openClearAutoMenu();
        }
        /* delete_held now rides as the 34th token in the tN_padmap payload
         * (computePadNoteMap), so it shares the tick-based self-heal and
         * avoids the onMidiMessage coalescing risk the old separate
         * t0_delete_held push had. */
        computePadNoteMap();
    }

    if (d1 === MoveCopy) {
        S.copyHeld = d2 === 127;
        if (!S.copyHeld) {
            S.copySrc = null;
            invalidateLEDCache();
        }
        computePadNoteMap();
    }

    if (d1 === MoveMute) {
        /* Schwung chain-edit co-run: Mute is the host-side slot-bypass modifier
         * (Mute + jog-click bypasses the focused chain component, handled in
         * shadow_ui). Cede it entirely — dAVEBOx ignores Mute as its own
         * track-mute modifier while chain-edit co-running, so it never holds a
         * muteHeld state that would re-fire its own mute gestures. */
        if (S.schwungCoRunSlot >= 0) {
            S.muteHeld = false;
        } else {
            S.muteHeld = d2 === 127;
            if (d2 === 127) S.muteUsedAsModifier = false;
            if (S.sessionView) invalidateLEDCache();
            computePadNoteMap();
        }
    }

    if (d1 === MoveCapture) {
        if (d2 === 127) {
            S.captureHeld           = true;
            S.captureUsedAsModifier = false;
            /* Press also cancels in-flight dialogs/pickers/merge — symmetric
             * with Sample's press behavior. */
            if (S.pendingSceneBakePicker) { S.pendingSceneBakePicker = false; S.captureUsedAsModifier = true; }
            if (S.pendingMergePlacement)  {
                S.pendingMergePlacement = false;
                S.captureUsedAsModifier = true;
                S.pendingDefaultSetParams.push({ key: 'merge_cancel', val: '1' });
            }
            if (S.confirmBake)            { S.confirmBake            = false; S.captureUsedAsModifier = true;
                                            S.confirmBakeDrumLoopOpen = false; S.confirmBakeWrapPhase = false; }
            if (S.confirmBakeScene)       { S.confirmBakeScene       = false; S.captureUsedAsModifier = true; }
            computePadNoteMap();
            forceRedraw();
        } else {
            S.captureHeld = false;
            /* Bare-tap release: open clip-bake (Track View) or scene-bake picker
             * (Session View). Suppressed when Capture was used as a modifier
             * (scene capture via Capture+row, drum-lane select via Capture+pad). */
            if (!S.captureUsedAsModifier) {
                if (S.sessionView) {
                    S.pendingSceneBakePicker = true;
                    S.screenDirty = true;
                } else {
                    const _bt = S.activeTrack, _bc = S.trackActiveClip[_bt];
                    const _isDrum = S.trackPadMode[_bt] === PAD_MODE_DRUM;
                    S.confirmBake             = true;
                    S.confirmBakeIsDrum       = _isDrum;
                    S.confirmBakeIsMultiLoop  = !_isDrum;
                    S.confirmBakeSel          = _isDrum ? 2 : 1;
                    S.confirmBakeTrack        = _bt;
                    S.confirmBakeClip         = _bc;
                    S.confirmBakeDrumLoopOpen = false;
                    S.confirmBakeWrapPhase    = false;
                    S.screenDirty             = true;
                }
            }
            computePadNoteMap();
            forceRedraw();
        }
        return;
    }

    /* Move's Menu button (CC 50) is in CORUN_KEEP_DEFAULT so the shim routes
     * it to us during co-run. Charles's framework reserves Back as the
     * canonical exit, but Menu-as-second-exit is a dAVEBOx convenience for
     * existing muscle memory — outside co-run dAVEBOx ignores Menu (no other
     * handler exists), so this branch is dormant unless a session is active. */
    if (d1 === 50 && d2 === 127) {
        /* Schwung co-run exits on Menu. Move co-run disables Menu entirely —
         * swallowed by the guard in the MoveNoteSession block below. */
        if (S.schwungCoRunSlot >= 0) {
            exitSchwungCoRun();
            forceRedraw();
            return;
        }
    }

    /* Note/Session view toggle: Shift+press = open global menu (Track View only);
     * tap = switch view; hold = session overview */
    if (d1 === MoveNoteSession) {
        /* Move co-run: Menu button is disabled — swallow press and release so it
         * neither exits co-run nor toggles the view. Step 3 / Back are the exits. */
        if (S.moveCoRunTrack >= 0) {
            /* Move co-run: Note/Session opens an FX screen as an overlay over the
             * Move synth — this fork's fx_picker where available, else the stock
             * master_fx (see the coRunOverlayScreen probe in pollDSP). corun target
             * stays MOVE_NATIVE, so pollDSP does NOT tear down — Back returns to the
             * synth. No addressable screen (older Schwung): swallow as before. */
            if (d2 === 127 && S.coRunOverlayScreen && typeof shadow_corun_open === 'function') {
                shadow_corun_open(S.coRunOverlayScreen, DAVEBOX_PICKER_KEEP_MASK);
            }
            return;
        }
        if (d2 === 127) {
            /* Co-run exit is the framework's job now — the shim catches Back
             * during corun_active() and calls shadow_corun_end() itself, and
             * pollDSP picks up target=NONE on the next frame and runs
             * exitMoveNativeCoRun()/exitSchwungCoRun() for the JS cleanup.
             * No Menu intercept needed here. */
            if (S.snapshotPicker) {
                /* Back out of a confirm to the list, else close the picker. */
                if (S.snapshotPicker.confirm) S.snapshotPicker.confirm = null;
                else closeSnapshotPicker();
                forceRedraw();
                return;
            }
            if (S.shiftHeld) {
                if (S.globalMenuOpen) { S.globalMenuOpen = false; forceRedraw(); }
                else { openGlobalMenu(); }
            } else if (S.tapTempoOpen) {
                closeTapTempo();
                forceRedraw();
            } else if (S.confirmStateWipe) {
                S.confirmStateWipe = false;
                removeFlagsWrap();
                clearAllLEDs();
                if (typeof host_exit_module === 'function') host_exit_module();
                forceRedraw();
            } else if (S.bpmMoveInfo) {
                S.bpmMoveInfo = false;
                forceRedraw();
            } else if (S.recordBlockedDialog) {
                S.recordBlockedDialog = false;
                forceRedraw();
            } else if (S.confirmLgto) {
                S.confirmLgto = false;
                forceRedraw();
            } else if (S.confirmBake) {
                S.confirmBake          = false;
                S.confirmBakeWrapPhase = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmClearSession) {
                S.confirmClearSession = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmSaveState) {
                S.confirmSaveState = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmConvertToDrum) {
                closeConvertConfirm();
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmConvertToConduct) {
                closeConvertConfirm();
                forceRedraw();
            } else if (S.globalMenuOpen && S.menuInfoLines.length > 0) {
                S.menuInfoLines = [];
                forceRedraw();
            } else if (S.globalMenuOpen && S.exportDoneDialog) {
                S.exportDoneDialog = false;
                S.globalMenuOpen   = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmExportCondPhase) {
                S.confirmExportCondPhase = false;   /* Back from cond stage aborts export */
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmExport) {
                S.confirmExport = false;
                forceRedraw();
            } else if (S.globalMenuOpen) {
                S.globalMenuOpen = false;
                S.lastSentMenuEditValue = null;
                forceRedraw();
            } else if (S.stepIntervalMode && !S.sessionView) {
                /* Arp Steps overlay: Note/Session exits the overlay without switching view. */
                S.stepIntervalMode = false;
                computePadNoteMap();
                forceRedraw();
            } else {
                /* Switch immediately (like Loop entering perf); tap vs hold resolved on release */
                S.noteSessionPressedTick = S.tickCount;
                S.sessionViewMomentary   = true;
                S.sessionView            = !S.sessionView;
                _switchViewCleanup();
                invalidateLEDCache();
                S.screenDirty = true;
            }
        } else if (d2 === 0) {
            if (S.noteSessionPressedTick >= 0 &&
                    (S.tickCount - S.noteSessionPressedTick) < NOTE_SESSION_HOLD_TICKS) {
                /* Tap release: make permanent (don't switch back) */
                S.sessionViewMomentary = false;
            } else if (S.sessionViewMomentary) {
                /* Hold release: switch back to original view */
                S.sessionViewMomentary = false;
                S.sessionView          = !S.sessionView;
                _switchViewCleanup();
                invalidateLEDCache();
                forceRedraw();
            }
            S.noteSessionPressedTick = -1;
        }
    }

    /* Loop button (CC 58, Session View): enter/exit Performance Mode.
     * Pad presses in Perf Mode drive rate capture + modifier engage.
     * Double-tap locks the view after Loop is released. */
    if (d1 === MoveLoop && S.sessionView) {
        if (d2 === 127) {
            if (S.shiftHeld) {
                /* Shift+Loop: toggle perf latch mode (mod pads momentary vs sticky). */
                S.perfLatchMode = !S.perfLatchMode;
                forceRedraw();
                return;
            }
            S.loopPressTick = S.tickCount;
            S.loopHeld      = true;
            forceRedraw();
            return;
        }
        const heldDuration = S.tickCount - S.loopPressTick;
        const wasTap       = heldDuration < LOOP_TAP_TICKS;

        if (S.perfViewLocked) {
            /* Locked + tap → unlock + stop. */
            if (wasTap) {
                S.perfViewLocked    = false;
                S.loopHeld          = false;
                S.loopJogActive     = false;
                S.perfStack         = [];
                S.perfStickyLengths = new Set();
                S.perfHoldPadHeld   = false;
                S.perfModsHeld      = 0;
                sendPerfMods();
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('looper_stop', '1');
                invalidateLEDCache();
                forceRedraw();
            }
            return;
        }

        if (wasTap) {
            /* Tap → lock Perf Mode; preserve running loop + mods. */
            S.perfViewLocked = true;
            S.loopHeld       = true;
            forceRedraw();
            return;
        }

        /* Hold release: exit Perf Mode. Sticky lengths/hold pad auto-lock if still active. */
        S.loopHeld      = false;
        S.loopJogActive = false;
        S.perfModsHeld = 0;
        if (S.perfStickyLengths.size > 0 || S.perfHoldPadHeld) {
            S.perfViewLocked = true;
            if (!S.perfHoldPadHeld)
                S.perfStack = S.perfStack.filter(function(e) { return S.perfStickyLengths.has(e.idx); });
            if (S.perfStack.length > 0 && typeof host_module_set_param === 'function')
                host_module_set_param('looper_arm', String(S.perfStack[S.perfStack.length - 1].ticks));
        } else {
            if (S.perfStack.length > 0 && typeof host_module_set_param === 'function')
                host_module_set_param('looper_stop', '1');
            S.perfStack = [];
        }
        sendPerfMods();
        invalidateLEDCache();
        forceRedraw();
        return;
    }

    /* Loop button (CC 58, Track View): hold + step buttons sets clip length */
    if (d1 === MoveLoop && !S.sessionView) {
        S.loopHeld = d2 === 127;
        computePadNoteMap();
        /* Arp Steps overlay: Loop is repurposed as a modifier for the pad-column
         * loop-length gesture. Skip every other Loop side-effect (TARP unlatch,
         * drum repeat latch, loop-window gesture) while the overlay is active. */
        if (S.stepIntervalMode) {
            if (!S.loopHeld && S.loopGestureStart >= 0) S.loopGestureStart = -1;
            forceRedraw();
            return;
        }
        if (S.loopHeld) {
            /* Latch or clear drum repeat on the active track */
            const _lrt = S.activeTrack;
            S.loopPressTick = S.tickCount;
            /* Tap-loop-alone unlatch eligibility (drum tracks only). Snapshot
             * "no fresh physical pad press" at press time so the release path
             * can distinguish a true alone-tap from a tap-while-latching
             * gesture. For Rpt1, drumRepeatHeldPad doubles as the latched-pad
             * reference once latched, so we must allow that case (latched +
             * no fresh press = the unlatch gesture we want). Rpt2 uses two
             * separate sets (held vs latched) so its check is simpler. */
            S.loopTapUnlatchTrack = -1;
            const _rpt1FreshHold = S.drumRepeatHeldPad[_lrt] >= 0 && !S.drumRepeatLatched[_lrt];
            const _rpt2FreshHold = S.drumRepeat2HeldLanes[_lrt].size > 0;
            if (S.trackPadMode[_lrt] === PAD_MODE_DRUM &&
                !_rpt1FreshHold && !_rpt2FreshHold &&
                S.liveActiveNotes.size === 0) {
                S.loopTapUnlatchTrack = _lrt;
            }
            /* Delete+Loop on auto bank: reset active lane's loop/res/zoom to clip defaults */
            if (S.deleteHeld && S.activeBank === 6) {
                var _rac = effectiveClip(_lrt);
                var _rl = S.ccActiveLane[_lrt];
                S.ccLaneLoopStart[_lrt][_rac][_rl] = 0;
                S.ccLaneLength[_lrt][_rac][_rl] = 0;
                S.ccLaneTps[_lrt][_rac][_rl] = 0;
                S.ccLaneResTps[_lrt][_rac][_rl] = 0;
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_c' + _rac + '_k' + _rl + '_cc_lane_reset', val: '1' });
                showActionPopup('LANE LOOP', 'RESET');
                forceRedraw();
                return;
            }
            /* Delete+Loop: unconditionally stop active drum repeat latch */
            if (S.deleteHeld && S.trackPadMode[_lrt] === PAD_MODE_DRUM) {
                if (S.drumPerformMode[_lrt] === 1 && S.drumRepeatLatched[_lrt]) {
                    S.drumRepeatLatched[_lrt] = false;
                    S.drumRepeatHeldPad[_lrt] = -1;
                    S.drumRepeatHeldPadsStack[_lrt].length = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + _lrt + '_drum_repeat_stop', '1');
                } else if (S.drumPerformMode[_lrt] === 2 && S.drumRepeat2LatchedLanes[_lrt].size > 0) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + _lrt + '_drum_repeat2_stop', '1');
                    S.drumRepeat2LatchedLanes[_lrt].clear();
                }
                forceRedraw();
                return;
            }
            /* TARP latch shortcut: Loop press while holding a pad on a melodic track */
            if (S.trackPadMode[_lrt] !== PAD_MODE_DRUM && S.liveActiveNotes.size > 0) {
                const _latchNow = (S.bankParams[_lrt][5][7] | 0) !== 0;
                if (_latchNow) {
                    /* Latch ON: holding any pad + loop turns it off */
                    S.bankParams[_lrt][5][7] = 0;
                    if (typeof host_module_set_param === 'function')
                        S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_tarp_latch', val: '0' });
                } else if ((S.bankParams[_lrt][5][0] | 0) !== 0) {
                    /* Latch OFF: turn it on (only when TARP style is set) */
                    S.bankParams[_lrt][5][7] = 1;
                    if (typeof host_module_set_param === 'function')
                        S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_tarp_latch', val: '1' });
                }
            } else if (S.trackPadMode[_lrt] !== PAD_MODE_DRUM &&
                       (S.bankParams[_lrt][5][7] | 0) !== 0 &&
                       S.tarpHeldNotes[_lrt].size > 0) {
                /* Loop press with no pads held + latch on + notes in buffer:
                 * clear the latched buffer without changing tarp_latch. */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _lrt + '_tarp_clear_latched', '1');
                S.tarpHeldNotes[_lrt].clear();
            }
            if (S.drumPerformMode[_lrt] === 2) {
                S.rpt2LoopPadUsed = false;
                if (S.drumRepeat2HeldLanes[_lrt].size > 0) {
                    for (const _ll of S.drumRepeat2HeldLanes[_lrt]) {
                        S.drumRepeat2LatchedLanes[_lrt].add(_ll);
                    }
                    /* Phase 1 / Bundle 2C-Rpt2: one atomic DSP push for all
                     * currently-held lanes. A per-lane loop here would coalesce
                     * (same set_param key, different values) — only the last
                     * lane would land. The DSP handler ORs active|pending into
                     * the latched bitmask. */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + _lrt + '_drum_repeat2_latch_held', '1');
                    S.rpt2LoopPadUsed = true;
                }
            } else if (S.drumRepeatHeldPad[_lrt] >= 0) {
                S.drumRepeatLatched[_lrt] = true;
                /* Phase 1 / Bundle 2C-Rpt1: also push DSP-side latched bit
                 * for parity (used by audio-thread unlatch-tap detection in
                 * drum_pad_event). Rpt1's release handler is still JS-driven
                 * so this isn't strictly required, but keeps DSP in sync. */
                if (typeof host_module_set_param === 'function')
                    S.pendingDefaultSetParams.push({ key: 't' + _lrt + '_drum_repeat_latched', val: '1' });
            }
            S.heldStepBtn        = -1;
            S.heldStep           = -1;
            S.heldStepNotes      = [];
            S.stepWasEmpty       = false;
            S.stepWasHeld        = false;
            S.stepBtnPressedTick.fill(-1);
            S.sessionStepHeld    = -1;
            S.sessionStepHeldCtx = 0;
        } else {
            S.loopJogActive = false;
            /* Loop released before the held start step — treat as aborted
             * gesture and fire the length-only fallback (single-tap semantics). */
            if (S.loopGestureStart >= 0) {
                _resolveLoopGesture(true);
                S.loopTapUnlatchTrack = -1;
            }
            /* Tap-loop-alone: unlatch all latched repeats on active drum track.
             * Eligibility was snapshotted at press (no pads/lanes held + drum
             * track). A long hold disqualifies (treated like a gesture timeout). */
            if (S.loopTapUnlatchTrack >= 0 &&
                (S.tickCount - S.loopPressTick) < LOOP_TAP_TICKS) {
                const _ut = S.loopTapUnlatchTrack;
                if (S.drumRepeatLatched[_ut]) {
                    S.drumRepeatLatched[_ut] = false;
                    S.drumRepeatHeldPad[_ut] = -1;
                    S.drumRepeatHeldPadsStack[_ut].length = 0;
                    S.pendingDefaultSetParams.push({ key: 't' + _ut + '_drum_repeat_stop', val: '1' });
                }
                if (S.drumRepeat2LatchedLanes[_ut].size > 0) {
                    S.drumRepeat2LatchedLanes[_ut].clear();
                    S.pendingDefaultSetParams.push({ key: 't' + _ut + '_drum_repeat2_stop', val: '1' });
                }
            }
            S.loopTapUnlatchTrack = -1;
        }
        forceRedraw();
    }

}

function _onCC_transport(d1, d2) {
    /* Back: close global menu if open; otherwise (with Shift) hide module.
     * Back during co-run never reaches us because dAVEBOx opts out of the
     * framework Back-as-exit (CORUN_KEEP_BACK in keep_mask) and cedes Back
     * to the peer (chain editor sub-view pop / Move firmware navigation).
     * Menu is the dAVEBOx exit during co-run, handled in _onCC_buttons. */
    if (d1 === MoveBack && d2 === 127) {
        if (S.tapTempoOpen) {
            closeTapTempo();
            forceRedraw();
        } else if (S.confirmBake) {
            S.confirmBake          = false;
            S.confirmBakeWrapPhase = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmClearSession) {
            S.confirmClearSession = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmSaveState) {
            S.confirmSaveState = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmConvertToDrum) {
            closeConvertConfirm();
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmConvertToConduct) {
            closeConvertConfirm();
            forceRedraw();
        } else if (S.globalMenuOpen && S.menuInfoLines.length > 0) {
            S.menuInfoLines = [];
            forceRedraw();
        } else if (S.globalMenuOpen && S.exportDoneDialog) {
            S.exportDoneDialog = false;
            S.globalMenuOpen   = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmExportCondPhase) {
            S.confirmExportCondPhase = false;   /* Back from cond stage aborts export */
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmExport) {
            S.confirmExport = false;
            forceRedraw();
        } else if (S.globalMenuOpen) {
            S.globalMenuOpen = false;
            S.lastSentMenuEditValue = null;
            forceRedraw();
        } else if (S.shiftHeld) {
            if (S.schwungCoRunSlot >= 0) exitSchwungCoRun();
            saveState();                       /* sets pendingSuspendSave */
            S.pendingHideAfterSave = true;     /* drained one tick after save fires */
        }
    }

    /* Undo button: press = undo; Shift+Undo = redo */
    if (d1 === MoveUndo && d2 === 127) {
        if (S.shiftHeld) {
            if (S.redoAvailable) {
                if (S.redoSeqArpSnapshot) {
                    const _t = S.redoSeqArpSnapshot.track;
                    S.undoSeqArpSnapshot = { track: _t, params: S.bankParams[_t][4].slice() };
                } else {
                    S.undoSeqArpSnapshot = null;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('redo_restore', '1');
                if (S.redoSeqArpSnapshot) {
                    const { track, params } = S.redoSeqArpSnapshot;
                    for (let k = 0; k < 8; k++) {
                        const pm = BANKS[4].knobs[k];
                        if (pm) S.bankParams[track][4][k] = params[k];
                    }
                }
                S.undoAvailable = true;
                S.redoAvailable = false;
                S.pendingUndoSync = 5;
                showActionPopup('REDO');
            } else {
                showActionPopup('NOTHING TO', 'REDO');
            }
        } else {
            if (S.undoAvailable) {
                if (S.undoSeqArpSnapshot) {
                    const _t = S.undoSeqArpSnapshot.track;
                    S.redoSeqArpSnapshot = { track: _t, params: S.bankParams[_t][4].slice() };
                } else {
                    S.redoSeqArpSnapshot = null;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('undo_restore', '1');
                if (S.undoSeqArpSnapshot) {
                    const { track, params } = S.undoSeqArpSnapshot;
                    for (let k = 0; k < 8; k++) {
                        const pm = BANKS[4].knobs[k];
                        if (pm) S.bankParams[track][4][k] = params[k];
                    }
                }
                S.redoAvailable = true;
                S.undoAvailable = false;
                S.pendingUndoSync = 5;
                showActionPopup('UNDO');
            } else {
                showActionPopup('NOTHING TO', 'UNDO');
            }
        }
        S.screenDirty = true;
    }

    /* Play: toggle transport; Shift+Play = restart transport; Delete+Play = deactivate_all; Mute+Play = toggle metro */
    if (d1 === MovePlay && d2 === 127) {
        if (S.deleteHeld) {
            if (typeof host_module_set_param === 'function') {
                if (!S.playing) {
                    /* Stopped: panic clears will_relaunch + all clip state atomically for all tracks. */
                    host_module_set_param('transport', 'panic');
                    for (let t = 0; t < NUM_TRACKS; t++) {
                        S.trackWillRelaunch[t] = false;
                        S.trackQueuedClip[t]   = -1;
                    }
                    /* Mirror the playing-branch sweep so LEDs/UI stay in sync with audio panic. */
                    unlatchAllTracks();
                } else {
                    host_module_set_param('transport', 'deactivate_all');
                    /* Unlatch Rpt1/Rpt2/TARP across all tracks — queued one-per-tick via pendingDefaultSetParams to avoid coalescing */
                    unlatchAllTracks();
                }
            }
        } else if (S.muteHeld) {
            S.muteUsedAsModifier = true;
            if (S.metronomeOn !== 0) S.metronomeOnLast = S.metronomeOn;
            S.metronomeOn = S.metronomeOn === 0 ? S.metronomeOnLast : 0;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('metro_on', String(S.metronomeOn));
            showActionPopup('METRO ' + (S.metronomeOn === 0 ? 'OFF' : 'ON'));
        } else if (S.loopHeld && !S.sessionView) {
            /* Loop+Play (Track View only): restart with active clip starting at
             * the first step of the visible page; other tracks land at the
             * musically-equivalent offset. Atomic single set_param. */
            const _lpAt   = S.activeTrack;
            const _lpIsDr = S.trackPadMode[_lpAt] === PAD_MODE_DRUM;
            const _lpPage = _lpIsDr ? (S.drumStepPage[_lpAt] | 0) : (S.trackCurrentPage[_lpAt] | 0);
            const _lpLane = _lpIsDr ? (S.activeDrumLane[_lpAt] | 0) : -1;
            if (typeof host_module_set_param === 'function') {
                host_module_set_param('transport', 'restart_at:' + _lpAt + ':' + _lpPage + ':' + _lpLane);
            }
        } else if (S.shiftHeld) {
            /* Restart: atomic DSP-side stop+play. Single set_param avoids
             * coalescing flakiness when stop+play land in same audio block. */
            if (typeof host_module_set_param === 'function') {
                host_module_set_param('transport', S.playing ? 'restart' : 'play');
            }
        } else {
            if (S.recordCountingIn) {
                disarmRecord();
            } else if (typeof host_module_set_param === 'function') {
                /* Use the combined `transport=play_focus:T:C` set_param so the
                 * DSP arms the focused track's clip + sets playing=1 in a
                 * single buffer. Sending launch_clip + transport=play as two
                 * separate set_params coalesces (same buffer same channel),
                 * leaving clip_playing=0 on the first cycle after a clip
                 * clear (since clear leaves will_relaunch=0). */
                if (!S.playing && !S.sessionView
                        && !S.trackClipPlaying[S.activeTrack]
                        && !S.trackWillRelaunch[S.activeTrack]) {
                    const _at = S.activeTrack;
                    const _ac = S.trackActiveClip[_at];
                    host_module_set_param('transport', 'play_focus:' + _at + ':' + _ac);
                    S.trackQueuedClip[_at] = _ac;
                } else {
                    host_module_set_param('transport', S.playing ? 'stop' : 'play');
                }
            }
        }
    }

    /* Record button (CC 86): toggle arm/disarm */
    if (d1 === MoveRec && d2 === 127) {
        if (S.recordArmed) {
            if (S.recordCountingIn) {
                /* Record pressed during count-in → cancel queued transport+record */
                disarmRecord();
            } else {
            const _recT  = S.recordArmedTrack >= 0 ? S.recordArmedTrack : S.activeTrack;
            const _recAc = S.trackActiveClip[_recT];
            if (S.clipAdaptiveMode[_recT][_recAc] && !S.recordScheduledStop && S.playing) {
                /* Schedule stop at end of current page */
                const _recDrum = S.trackPadMode[_recT] === PAD_MODE_DRUM;
                const _recStp  = _recDrum ? S.drumCurrentStep[_recT] : S.trackCurrentStep[_recT];
                S.recordScheduledStop       = true;
                S.recordScheduledStopTarget = (Math.floor(_recStp / 16) + 1) * 16;
            } else {
                disarmRecord();
            }
            } /* end else (not counting in) */
        } else {
            /* Arming path. First gate: refuse if the active clip / lane is
             * playing in any non-Forward direction. Recording into Bwd / PPf /
             * PPb is confusing because the visual playhead is captured but
             * next-loop semantics fire the note at a shifted position. RvSt
             * (Step/Audio) is only meaningful during reverse motion, so it's
             * a no-op when Dir=Fwd and doesn't need to gate recording. */
            const _at = S.activeTrack;
            const _aac = S.trackActiveClip[_at];
            const _aIsDrum = S.trackPadMode[_at] === PAD_MODE_DRUM;
            const _apd = _aIsDrum
                ? (S.drumLanePlaybackDir[_at][S.activeDrumLane[_at]] | 0)
                : (S.clipPlaybackDir[_at][_aac] | 0);
            if (_apd !== 0) {
                S.recordBlockedDialog    = true;
                S.recordBlockedDialogSel = 0;  /* default OK */
                forceRedraw();
            } else if (!S.playing) {
            /* Stopped → DSP-side 1-bar count-in; transport+recording fire from render thread */
            /* MIDI-handler context: get_param is null here — use the tick-
             * maintained mirror (audit js-input-3). */
            const bpm = (S.bpmMirror > 0 && isFinite(S.bpmMirror)) ? S.bpmMirror : 120;
            S.recordArmed         = true;
            S.recordCountingIn    = true;
            S.recordArmedTrack    = S.activeTrack;
            S.countInStartTick    = S.tickCount;
            S.countInBeatStartTick = S.tickCount;
            S.countInQuarterTicks = Math.round(TICK_HZ * 60 / bpm);
            S.pendingPrerollNotes       = [];
            S.pendingPrerollToggleQueue = [];
            if (typeof host_module_set_param === 'function')
                host_module_set_param('record_count_in', String(S.activeTrack));
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            setButtonLED(MoveRec, Red);
            /* Adaptive mode: entered when count-in finishes (transport start edge in tick) */
        } else {
            /* Playing → arm with no count-in. Two paths by mode:
             *   Adaptive (empty clip + length not manually set): defer DSP
             *     recording=1 to next bar boundary AND reset playhead to
             *     loop_start at fire time (next page becomes new step 0,
             *     avoiding an empty leading page). Record LED blinks until
             *     DSP fires. JS sends recording=2.
             *   Fixed (clip exists / length locked): record immediately at
             *     the current step — the existing clip grid is the meaningful
             *     frame. JS sends recording=1 (legacy). No blink. */
            const _at = S.activeTrack, _ac = S.trackActiveClip[_at];
            const _isDrum = S.trackPadMode[_at] === PAD_MODE_DRUM;
            const _adaptive = _isDrum
                ? (!S.drumClipNonEmpty[_at][_ac] && !S.drumLaneLengthManuallySet[_at])
                : (!S.clipNonEmpty[_at][_ac] && !S.clipLengthManuallySet[_at][_ac]);
            S.recordArmed       = true;
            S.recordCountingIn  = false;
            S.recordArmedTrack  = _at;
            S.recordPendingPage = _adaptive;
            if (_adaptive) S.clipAdaptiveMode[_at][_ac] = true;
            setButtonLED(MoveRec, Red);
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _at + '_recording', _adaptive ? '2' : '1');
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        }
        } /* end arming else (direction-gated) */
    }

    /* Sample press (no modifier): track held state; cancel dialogs/merge immediately on press */
    if (d1 === MoveSample && d2 === 127 && !S.shiftHeld) {
        S.sampleHeld           = true;
        S.sampleUsedAsModifier = false;
        if (S.pendingInheritPicker) {
            resolveInheritPicker(-1);  /* Cancel = Start blank */
            S.sampleUsedAsModifier = true;
        } else if (S.confirmBakeScene) {
            S.confirmBakeScene     = false;
            S.sampleUsedAsModifier = true;
            forceRedraw();
        } else if (S.confirmBake) {
            S.confirmBake             = false;
            S.confirmBakeDrumLoopOpen = false;
            S.confirmBakeWrapPhase    = false;
            S.sampleUsedAsModifier    = true;
            forceRedraw();
        } else if (S.dspMergeState !== 0) {
            S.pendingDefaultSetParams.push({ key: 'merge_stop', val: '1' });
            S.sampleUsedAsModifier = true;
            /* LED stays green until DSP finalizes at page boundary */
        }
    }
    /* Sample release (no modifier): in Session View arm/stop multi-track live
     * merge; in Track View bare tap is a no-op (clip bake moved off Sample
     * onto Capture). Sample-held + scene row still opens scene bake directly
     * (Sample is also a modifier — flagged via sampleUsedAsModifier). */
    if (d1 === MoveSample && d2 === 0 && !S.shiftHeld) {
        S.sampleHeld = false;
        if (!S.sampleUsedAsModifier && S.sessionView) {
            if (S.dspMergeState !== 0) {
                S.pendingDefaultSetParams.push({ key: 'merge_stop', val: '1' });
                /* LED stays Red until DSP finalizes at page boundary, then
                 * placement dialog opens via dspMergeState→IDLE detection. */
            } else {
                S.pendingDefaultSetParams.push({ key: 'merge_arm', val: '1' });
                S.pendingMergeArm = true;
                setButtonLED(MoveSample, Red);
                /* Explain what's happening — multi-track merge is non-obvious
                 * and the user needs time to read. Override the standard popup
                 * window to ~3 seconds. */
                showActionPopup('LIVE MERGE', 'Capturing all 8', 'tracks. Tap Sample', 'again to stop.');
                S.actionPopupEndTick = S.tickCount + 280;
            }
        }
    }

    /* Mute button: Delete+Mute = clear all (both views); toggle mute/solo on active track (Track View only).
     * Press: handle Delete+Mute immediately. Release: toggle mute/solo, but only if Mute was not used as
     * a modifier key (e.g. Mute+Play = metro toggle).
     * Skipped entirely during Schwung chain-edit co-run — Mute is ceded to the host as the slot-bypass
     * modifier there (see the MoveMute press tracker above). */
    if (d1 === MoveMute && d2 === 127 && S.schwungCoRunSlot < 0) {
        if (S.deleteHeld) {
            if (!S.sessionView && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Delete+Mute in drum track view: clear all drum lane mute/solo */
                S.drumLaneMute[S.activeTrack] = 0;
                S.drumLaneSolo[S.activeTrack] = 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + S.activeTrack + '_drum_mute_all_clear', '1');
                S.muteUsedAsModifier = true;
                forceRedraw();
            } else {
                clearAllMuteSolo();
            }
        }
    }
    if (d1 === MoveMute && d2 === 0 && S.schwungCoRunSlot < 0) {
        if (!S.muteUsedAsModifier && !S.deleteHeld && !S.sessionView) {
            if (S.shiftHeld) setTrackSolo(S.activeTrack, !S.trackSoloed[S.activeTrack]);
            else           setTrackMute(S.activeTrack, !S.trackMuted[S.activeTrack]);
        }
    }

    /* Left/Right: page nav in Track View — clamp to the loop window so
     * step-edit nav never lands on a page that won't play. */
    if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !S.sessionView) {
        var _t_lr = S.activeTrack;
        if (S.loopHeld && S.activeBank === 6) {
            var RES_TPS = [12, 24, 48, 96, 384];
            var _ac_lr = effectiveClip(_t_lr);
            var _ccL_lr = S.ccActiveLane[_t_lr];
            var _dispTpsLr = S.ccLaneTps[_t_lr][_ac_lr][_ccL_lr] || (S.clipTPS[_t_lr][_ac_lr] || 24);
            var _curTps = S.ccLaneResTps[_t_lr][_ac_lr][_ccL_lr] || _dispTpsLr;
            var _ci = RES_TPS.indexOf(_curTps);
            if (_ci < 0) _ci = 1;
            if (d1 === MoveLeft && _ci > 0) _ci--;
            else if (d1 === MoveRight && _ci < RES_TPS.length - 1) _ci++;
            S.ccLaneResTps[_t_lr][_ac_lr][_ccL_lr] = RES_TPS[_ci];
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _t_lr + '_c' + _ac_lr + '_k' + _ccL_lr + '_cc_lane_res_tps',
                                      String(RES_TPS[_ci]));
            forceRedraw();
            return;
        }
        if (S.trackPadMode[_t_lr] === PAD_MODE_DRUM && S.activeBank !== 6) {
            var lsBase = S.drumLaneLoopStart[_t_lr] | 0;
            var startPage = lsBase >> 4;
            var lastPage  = startPage + Math.max(1, Math.ceil(S.drumLaneLength[_t_lr] / 16)) - 1;
            if (d1 === MoveLeft)
                S.drumStepPage[_t_lr] = Math.max(startPage, S.drumStepPage[_t_lr] - 1);
            else
                S.drumStepPage[_t_lr] = Math.min(lastPage, S.drumStepPage[_t_lr] + 1);
        } else {
            var ac = effectiveClip(_t_lr);
            var lsBase, startPage, lastPage;
            if (S.activeBank === 6) {
                var _ccL2 = S.ccActiveLane[_t_lr];
                var _llen = S.ccLaneLength[_t_lr][ac][_ccL2];
                if (_llen > 0) {
                    lsBase = S.ccLaneLoopStart[_t_lr][ac][_ccL2] | 0;
                    startPage = lsBase >> 4;
                    lastPage = startPage + Math.max(1, Math.ceil(_llen / 16)) - 1;
                }
            }
            if (lastPage === undefined) {
                lsBase = S.clipLoopStart[_t_lr][ac] | 0;
                startPage = lsBase >> 4;
                lastPage = startPage + Math.max(1, Math.ceil(S.clipLength[_t_lr][ac] / 16)) - 1;
            }
            if (d1 === MoveLeft)
                S.trackCurrentPage[_t_lr] = Math.max(startPage, S.trackCurrentPage[_t_lr] - 1);
            else
                S.trackCurrentPage[_t_lr] = Math.min(lastPage, S.trackCurrentPage[_t_lr] + 1);
        }
        /* Manual navigation disables SeqFollow so the view stays where the user navigated */
        const _sfAc = effectiveClip(S.activeTrack);
        if (S.clipSeqFollow[S.activeTrack][_sfAc]) {
            S.clipSeqFollow[S.activeTrack][_sfAc] = false;
            S.bankParams[S.activeTrack][0][7] = 0;
        }
        S.screenDirty = true;
    }

    /* Up/Down: scene group nav in Session View or while overview held; octave shift in Track View */
    if (d1 === MoveDown && d2 === 127 && (S.sessionView || S.sessionOverlayHeld) && S.sceneRow < NUM_CLIPS - 4) { S.sceneRow = Math.min(NUM_CLIPS - 4, S.sceneRow + 4); forceRedraw(); }
    if (d1 === MoveUp   && d2 === 127 && (S.sessionView || S.sessionOverlayHeld) && S.sceneRow > 0)              { S.sceneRow = Math.max(0, S.sceneRow - 4);              forceRedraw(); }
    if ((d1 === MoveUp || d1 === MoveDown) && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld &&
            S.loopHeld && S.activeBank === 6) {
        var RES_TPS = [12, 24, 48, 96, 384];
        var _zt = S.activeTrack, _zac = effectiveClip(_zt), _zL = S.ccActiveLane[_zt];
        var _zOldTps = S.ccLaneTps[_zt][_zac][_zL] || (S.clipTPS[_zt][_zac] || 24);
        var _zci = RES_TPS.indexOf(_zOldTps);
        if (_zci < 0) _zci = 1;
        if (d1 === MoveDown && _zci > 0) _zci--;
        else if (d1 === MoveUp && _zci < RES_TPS.length - 1) _zci++;
        var _zNewTps = RES_TPS[_zci];
        if (_zNewTps !== _zOldTps) {
            var _zOldLen = S.ccLaneLength[_zt][_zac][_zL] || S.clipLength[_zt][_zac];
            var _zOldTicks = _zOldLen * _zOldTps;
            var _zNewLen = Math.ceil(_zOldTicks / _zNewTps);
            if (_zNewLen <= 256) {
                S.ccLaneTps[_zt][_zac][_zL] = _zNewTps;
                S.ccLaneLength[_zt][_zac][_zL] = _zNewLen;
                var _zOldRes = S.ccLaneResTps[_zt][_zac][_zL];
                if (_zOldRes > 0) {
                    var _zNewRes = Math.round(_zOldRes * _zNewTps / _zOldTps);
                    var _zResValid = RES_TPS.indexOf(_zNewRes) >= 0;
                    S.ccLaneResTps[_zt][_zac][_zL] = _zResValid ? _zNewRes : 0;
                }
                var _zPre = 't' + _zt + '_c' + _zac + '_k' + _zL;
                S.pendingDefaultSetParams.push({ key: _zPre + '_cc_lane_tps', val: String(_zNewTps) });
                S.pendingDefaultSetParams.push({ key: _zPre + '_cc_loop_set',
                    val: String(((S.ccLaneLoopStart[_zt][_zac][_zL] | 0) << 16) | (_zNewLen & 0xFFFF)) });
                if (_zOldRes > 0)
                    S.pendingDefaultSetParams.push({ key: _zPre + '_cc_lane_res_tps',
                        val: String(S.ccLaneResTps[_zt][_zac][_zL]) });
                var _zMaxPage = Math.max(0, Math.ceil(_zNewLen / 16) - 1);
                if (S.trackCurrentPage[_zt] > _zMaxPage) S.trackCurrentPage[_zt] = _zMaxPage;
                forceRedraw();
            }
        }
        return;
    }
    if (d1 === MoveUp   && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            setDrumLanePage(S.activeTrack, 1);
            syncDrumLanesMeta(S.activeTrack);
            syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
            computePadNoteMap();  /* PHASE-1: drum page change shifts lane mapping; re-push */
            forceRedraw();
        } else {
        for (const p of S.liveActiveNotes) queueLiveNoteOff(S.activeTrack, p);
        S.liveActiveNotes.clear();
        S.trackOctave[S.activeTrack] = Math.min(4, S.trackOctave[S.activeTrack] + 1);
        computePadNoteMap();  /* PHASE-1: re-bake octave offset into DSP padmap */
        S.screenDirty = true;
        if (S.heldStep >= 0) forceRedraw();
        }
    }
    if (d1 === MoveDown && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            setDrumLanePage(S.activeTrack, 0);
            syncDrumLanesMeta(S.activeTrack);
            syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
            computePadNoteMap();  /* PHASE-1: drum page change shifts lane mapping; re-push */
            forceRedraw();
        } else {
        for (const p of S.liveActiveNotes) queueLiveNoteOff(S.activeTrack, p);
        S.liveActiveNotes.clear();
        S.trackOctave[S.activeTrack] = Math.max(-4, S.trackOctave[S.activeTrack] - 1);
        computePadNoteMap();  /* PHASE-1: re-bake octave offset into DSP padmap */
        S.screenDirty = true;
        if (S.heldStep >= 0) forceRedraw();
        }
    }

}

function _onCC_side(d1, d2) {
    /* Track buttons CC40-43 */
    if (d1 >= 40 && d1 <= 43 && d2 === 127) {
        const idx     = d1 - 40;
        const clipIdx = S.sceneRow + (3 - idx);
        /* Scene-bake picker (set by Session-View Capture tap): row press selects
         * the scene to bake and goes straight to the scene-bake confirm dialog.
         * Picker is consumed before any other gesture so it doesn't double-fire. */
        if (S.pendingSceneBakePicker) {
            S.pendingSceneBakePicker    = false;
            S.confirmBakeScene          = true;
            S.confirmBakeSceneWrapPhase = false;
            S.confirmBakeSceneCondPhase = false;
            S.confirmBakeSceneSel       = 1;
            S.confirmBakeSceneClip      = clipIdx;
            S.screenDirty               = true;
            return;
        }
        /* Multi-track live merge placement: post-stop, row press picks
         * destination row and commits captured clips (per-track skip when
         * no notes captured — preserves existing clips on those tracks). */
        if (S.pendingMergePlacement) {
            S.pendingMergePlacement = false;
            S.pendingDefaultSetParams.push({ key: 'merge_place_row', val: String(clipIdx) });
            S.screenDirty = true;
            return;
        }
        if (S.copyHeld) {
            if (S.copySrc && S.copySrc.kind === 'step') {
                /* step copy in progress: swallow track/scene buttons — don't mix copy types */
            } else if (S.sessionView) {
                /* Copy/Cut: row-to-row gesture */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_row', row: clipIdx }
                        : { kind: 'row', row: clipIdx };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'row') {
                    copyRow(S.copySrc.row, clipIdx);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_row') {
                    cutRow(S.copySrc.row, clipIdx);
                    S.copySrc = { kind: 'row', row: clipIdx };
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* clip/cut_clip kinds: swallow — don't mix copy types */
            } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Track View drum clip copy/cut via track button */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_drum_clip', track: S.activeTrack, clip: clipIdx }
                        : { kind: 'drum_clip',     track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'drum_clip') {
                    copyDrumClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_drum_clip') {
                    cutDrumClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    S.copySrc = { kind: 'drum_clip', track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* Other kinds: swallow — don't mix copy types */
            } else {
                /* Track View melodic clip copy/cut via track button */
                if (!S.copySrc) {
                    S.copySrc = S.shiftHeld
                        ? { kind: 'cut_clip', track: S.activeTrack, clip: clipIdx }
                        : { kind: 'clip', track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    showActionPopup(S.shiftHeld ? 'CUT' : 'COPIED');
                } else if (S.copySrc.kind === 'clip') {
                    copyClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_clip') {
                    cutClip(S.copySrc.track, S.copySrc.clip, S.activeTrack, clipIdx);
                    S.copySrc = { kind: 'clip', track: S.activeTrack, clip: clipIdx };
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                }
                /* row/cut_row kinds: swallow — don't mix copy types */
            }
        } else if (S.shiftHeld && S.deleteHeld) {
            if (S.sessionView) {
                /* Shift+Delete+scene row (Session View): hard reset all 8 clips in row */
                for (let t = 0; t < NUM_TRACKS; t++) hardResetClip(t, clipIdx);
                forceRedraw();
                showActionPopup('CLIPS', 'CLEARED');
            } else {
                /* Shift+Delete+clip (Track View): full factory reset */
                hardResetClip(S.activeTrack, clipIdx);
                forceRedraw();
                showActionPopup('CLIP', 'CLEARED');
            }
        } else if (S.deleteHeld) {
            if (S.sessionView) {
                /* Delete + scene row button (Session View): clear all 8 clips in that row */
                clearRow(clipIdx);
                forceRedraw();
                showActionPopup('SEQUENCES', 'CLEARED');
            } else {
                /* Delete + track button (Track View): clear the clip; keep S.playing if it's currently active */
                clearClip(S.activeTrack, clipIdx, true);
                forceRedraw();
                showActionPopup('SEQUENCE', 'CLEARED');
            }
        } else if (S.captureHeld) {
            /* Capture + scene row: copy each track's currently *playing* or
             * *queued* clip into this row. Inactive/focused-but-not-playing
             * clips are skipped — only what's actually live participates in
             * the capture. Mark Capture as consumed so the upcoming release
             * doesn't open the
             * scene-bake picker. */
            S.captureUsedAsModifier = true;
            let scooped = 0;
            for (let t = 0; t < NUM_TRACKS; t++) {
                /* Only tracks whose active clip is *playing* (sequencer running)
                 * OR is currently queued contribute to the scene capture.
                 * Inactive/focused-but-silent tracks don't paint into the row. */
                const isLive = (S.trackClipPlaying[t] && S.trackActiveClip[t] !== clipIdx)
                            || (S.trackQueuedClip[t] >= 0 && S.trackQueuedClip[t] !== clipIdx);
                if (!isLive) continue;
                const srcC = S.trackQueuedClip[t] >= 0 ? S.trackQueuedClip[t] : S.trackActiveClip[t];
                if (srcC === clipIdx) continue;
                if (!trackClipHasContent(t, srcC)) continue;
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    copyDrumClip(t, srcC, t, clipIdx);
                } else {
                    copyClip(t, srcC, t, clipIdx);
                }
                scooped++;
            }
            invalidateLEDCache();
            forceRedraw();
            if (scooped > 0) showActionPopup('CAPTURED', 'TO ROW ' + (clipIdx + 1));
            else             showActionPopup('NOTHING', 'TO CAPTURE');
        } else if (S.sessionView) {
            S.sceneBtnFlashTick[idx] = S.tickCount;
            /* Shift+side-button forces next-bar boundary launch regardless of
             * global launch_quant. Plain press honors launch_quant as before. */
            const _scKey = S.shiftHeld ? 'launch_scene_quant' : 'launch_scene';
            S.pendingDefaultSetParams.push({ key: _scKey, val: String(clipIdx) });
        } else {
            const t            = S.activeTrack;
            const isActiveClip = S.trackActiveClip[t] === clipIdx;
            if (S.trackClipPlaying[t] && isActiveClip) {
                if (S.trackPendingPageStop[t]) {
                    /* Pending stop → cancel by re-launching legato */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                } else {
                    /* Playing → arm stop at next page boundary */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_stop_at_end', '1');
                }
            } else if (S.trackWillRelaunch[t] && isActiveClip) {
                /* Transport stopped, clip primed to restart → cancel */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_deactivate', '1');
            } else if (S.trackQueuedClip[t] === clipIdx) {
                /* Queued to launch → cancel */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_deactivate', '1');
            } else {
                /* Focus immediately so pads/OLED show the selected clip even
                 * while the prior clip is still playing toward its legato
                 * switch boundary. pollDSP will keep trackActiveClip in sync
                 * when DSP actually crosses the boundary.
                 * Page snaps to the page containing the clip's loop_start so
                 * a clip with a non-zero loop window doesn't briefly render
                 * its OOB region on select. Drum tracks: leave at 0 (drum
                 * loop_start is per-lane and refreshed by pendingDrumResync). */
                S.trackActiveClip[t]  = clipIdx;
                S.trackCurrentPage[t] = S.trackPadMode[t] === PAD_MODE_DRUM
                    ? 0
                    : Math.floor((S.clipLoopStart[t][clipIdx] | 0) / 16);
                refreshPerClipBankParams(t);
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    S.pendingDrumResync      = 2;
                    S.pendingDrumResyncTrack = t;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
            }
        }
    }

}

/* CC-knob acceleration. The Move knobs fire ~2-4 ±1 detent messages per
 * physical click at ~8-35ms apart, so timing can't tell slow from fast. We use
 * a fractional accumulator: each message adds `gain` (1 at the start) to an
 * accumulator and emits whole units of BASE. BASE=3 makes the slow/fine rate
 * ~1 value per 3 messages; `gain` grows only
 * after sustained continuous turning, so big sweeps accelerate. A direction
 * change or a pause (>180ms) resets. Returns a signed integer step (0 if the
 * accumulator hasn't reached a whole unit yet). */
function ccKnobDelta(d2, k) {
    const sign = (d2 >= 1 && d2 <= 63) ? 1 : (d2 >= 65 && d2 <= 127) ? -1 : 0;
    if (!sign) return 0;
    const now = Date.now();
    const gap = now - (S.knobAccelLast[k] || 0);
    S.knobAccelLast[k] = now;
    if (sign !== S.knobAccelDir[k] || gap > 180) { S.knobAccelRun[k] = 0; S.knobAccelAcc[k] = 0; }
    S.knobAccelDir[k] = sign;
    S.knobAccelRun[k]++;
    const run  = S.knobAccelRun[k];
    const gain = run <= 12 ? 1 : run <= 24 ? 2 : run <= 36 ? 4 : 6;
    const BASE = 3;
    S.knobAccelAcc[k] += gain;
    const units = Math.floor(S.knobAccelAcc[k] / BASE);
    if (units === 0) return 0;
    S.knobAccelAcc[k] -= units * BASE;
    return sign * units;
}

function _onCC_stepedit(d1, d2) {
    /* CC step-edit: bank 6 + held step — all 8 knobs write CC automation at step's tick */
    if (S.heldStep >= 0 && S.activeBank === 6 && d1 >= 71 && d1 <= 78) {
        const _kIdx = d1 - 71;
        const _acc  = ccKnobDelta(d2, _kIdx);  /* run-length acceleration */
        if (_acc === 0) return;
        const _t    = S.activeTrack;
        const _ac   = effectiveClip(_t);
        S.knobTouched          = _kIdx;
        S.knobTurnedTick[_kIdx] = S.tickCount;
        S.ccActiveLane[_t]      = _kIdx;
        S.screenDirty  = true;
        var _laneTps = S.ccLaneTps[_t][_ac][_kIdx];
        const _tps   = (_laneTps > 0) ? _laneTps : (S.clipTPS[_t][_ac] || 24);
        const _tick  = S.heldStep * _tps;
        const _hold  = Math.min(65535, _tick + _tps - 1);
        /* New point at an unset step: the value is seeded at the interpolated value
         * (computed at step-hold time), and this turn's delta is applied immediately,
         * so EITHER direction creates the point and sets it above OR below the
         * interpolated value on the first turn. From a set step, down past 0 clears
         * it back to "—" (and Delete+step clears a step outright). */
        if (!S.ccStepEditSet[_kIdx]) {
            S.ccStepEditSet[_kIdx] = true;
            const _nv0 = S.ccStepEditVal[_kIdx] + _acc;
            S.ccStepEditVal[_kIdx] = Math.max(0, Math.min(127, _nv0));
        } else {
            const _nv = S.ccStepEditVal[_kIdx] + _acc;
            if (_nv < 0) {
                /* down past 0 → "—": drop this knob's point(s) in the step window */
                S.ccStepEditSet[_kIdx] = false;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _t + '_cc_auto_clear_range',
                        _ac + ' ' + _kIdx + ' ' + _tick + ' ' + _hold);
                /* refresh the auto bit (knob may still have points elsewhere) */
                return;
            }
            S.ccStepEditVal[_kIdx] = Math.min(127, _nv);
        }
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + _t + '_cc_auto_set2',
                _ac + ' ' + _kIdx + ' ' + _tick + ' ' + _hold + ' ' + S.ccStepEditVal[_kIdx]);
        S.trackCCAutoBits[_t][_ac] |= (1 << _kIdx);
        return;
    }

    /* Drum step edit: K1 Leng, K2 Vel, K3 Nudg, K4 —, K5 Iter, K6 Prob, K7 Ratch, K8 —.
     * Bank-gated off the AUTO bank (6): there the held-step + knob edits CC
     * automation (the CC step editor above), mirroring the melodic NOTE editor. */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0 && d1 >= 71 && d1 <= 78 &&
            S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank !== 6) {
        const knobIdx = d1 - 71;
        const dir     = (d2 >= 1 && d2 <= 63) ? 1 : -1;
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty = true;
        if (knobIdx === 3 || knobIdx === 7) return;
        if (knobIdx === 0) {
            const _tpsD = S.drumLaneTPS[t] || 24;
            const _gmaxD = Math.min(65535, 256 * _tpsD);
            const _acc = ccKnobDelta(d2, knobIdx);
            if (_acc === 0) return;
            const _steps = S.stepEditGate / _tpsD;
            const _inc = _steps <= 16 ? Math.round(_tpsD / 4)
                       : _steps <= 64 ? _tpsD
                       :                 _tpsD * 8;
            let _nv = S.stepEditGate + _acc * _inc;
            if (_inc > 1) _nv = Math.round(_nv / _inc) * _inc;
            S.stepEditGate = Math.max(1, Math.min(_gmaxD, _nv));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate', String(S.stepEditGate));
        } else if (knobIdx === 1) {
            S.stepEditVel = Math.max(0, Math.min(127, S.stepEditVel + dir));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel', String(S.stepEditVel));
        } else if (knobIdx === 2) {
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                const _tpsN1 = (S.drumLaneTPS[t] || 24) - 1;
                S.stepEditNudge = Math.max(-_tpsN1, Math.min(_tpsN1, S.stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge', String(S.stepEditNudge));
            }
        } else if (knobIdx === 4) {
            /* K5 Iter: one entry per detent (no accel — 36-entry list, ~1 turn end-to-end) */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 3) {
                S.knobAccum[knobIdx] = 0;
                let idx = STEP_ITER_LIST.indexOf(S.stepEditIter);
                if (idx < 0) idx = 0;
                idx = Math.max(0, Math.min(STEP_ITER_LIST.length - 1, idx + dir));
                S.stepEditIter = STEP_ITER_LIST[idx];
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_iter', String(S.stepEditIter));
            }
        } else if (knobIdx === 5) {
            /* K6 Prob: 0..100 with accel */
            const acc = ccKnobDelta(d2, knobIdx);
            if (acc !== 0) {
                S.stepEditRand = Math.max(0, Math.min(100, S.stepEditRand + acc));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_rand', String(S.stepEditRand));
            }
        } else if (knobIdx === 6) {
            /* K7 Ratch: 0..4, sens=8 (10 detents per step at low gain) */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                S.stepEditRatch = Math.max(0, Math.min(4, S.stepEditRatch + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_ratch', String(S.stepEditRatch));
            }
        }
        return;
    }
    /* Melodic step edit: K1 Oct, K2 Note, K3 Leng, K4 Vel, K5 Nudg, K6 Iter, K7 Prob, K8 Ratch */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0 && d1 >= 71 && d1 <= 78 && S.activeBank !== 6) {
        const knobIdx = d1 - 71;
        const dir     = (d2 >= 1 && d2 <= 63) ? 1 : -1;
        const t       = S.activeTrack;
        const ac      = effectiveClip(t);
        const pfx     = 't' + t + '_c' + ac + '_step_' + S.heldStep;
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty   = true;
        if (knobIdx === 0) {
            /* K1 Oct: shift all notes ±12 semitones, sens=12 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 12) {
                S.knobAccum[knobIdx] = 0;
                S.heldStepNotes = S.heldStepNotes.map(function(n) {
                    return Math.max(0, Math.min(127, n + dir * 12));
                });
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_set_notes', S.heldStepNotes.join(' '));
            }
        } else if (knobIdx === 1) {
            /* K2 Pitch: shift each note ±1 scale degree (or ±1 semitone if scale-aware off), sens=10 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 10) {
                S.knobAccum[knobIdx] = 0;
                S.heldStepNotes = S.heldStepNotes.map(function(n) {
                    return scaleNudgeNote(n, dir, S.padKey, S.padScale);
                });
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_set_notes', S.heldStepNotes.join(' '));
            }
        } else if (knobIdx === 2) {
            /* K3 Dur: accelerated with breakpoints at 16/64 steps */
            { const _acD = effectiveClip(S.activeTrack);
              const _tpsD = S.clipTPS[S.activeTrack][_acD] || 24;
              const _gmaxD = Math.min(65535, 256 * _tpsD);
              const _acc = ccKnobDelta(d2, knobIdx);
              if (_acc === 0) return;
              const _steps = S.stepEditGate / _tpsD;
              const _inc = _steps <= 16 ? Math.round(_tpsD / 4)
                         : _steps <= 64 ? _tpsD
                         :                 _tpsD * 8;
              let _nv = S.stepEditGate + _acc * _inc;
              if (_inc > 1) _nv = Math.round(_nv / _inc) * _inc;
              S.stepEditGate = Math.max(1, Math.min(_gmaxD, _nv)); }
            if (typeof host_module_set_param === 'function')
                host_module_set_param(pfx + '_gate', String(S.stepEditGate));
        } else if (knobIdx === 3) {
            /* K4 Vel: velocity 0-127 */
            S.stepEditVel = Math.max(0, Math.min(127, S.stepEditVel + dir));
            if (typeof host_module_set_param === 'function')
                host_module_set_param(pfx + '_vel', String(S.stepEditVel));
        } else if (knobIdx === 4) {
            /* K5 Nudge: tick offset ±(TPS-1), sens=8 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                const _acN = effectiveClip(S.activeTrack);
                const _tpsN1 = (S.clipTPS[S.activeTrack][_acN] || 24) - 1;
                S.stepEditNudge = Math.max(-_tpsN1, Math.min(_tpsN1, S.stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_nudge', String(S.stepEditNudge));
            }
        } else if (knobIdx === 5) {
            /* K6 Iter: discrete step, sens=3 (no accel) */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 3) {
                S.knobAccum[knobIdx] = 0;
                let idx = STEP_ITER_LIST.indexOf(S.stepEditIter);
                if (idx < 0) idx = 0;
                idx = Math.max(0, Math.min(STEP_ITER_LIST.length - 1, idx + dir));
                S.stepEditIter = STEP_ITER_LIST[idx];
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_iter', String(S.stepEditIter));
            }
        } else if (knobIdx === 6) {
            /* K7 Rand: 0..100 with accel */
            const acc = ccKnobDelta(d2, knobIdx);
            if (acc !== 0) {
                S.stepEditRand = Math.max(0, Math.min(100, S.stepEditRand + acc));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_rand', String(S.stepEditRand));
            }
        } else if (knobIdx === 7) {
            /* K8 Ratch: 0..4, sens=8 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                S.stepEditRatch = Math.max(0, Math.min(4, S.stepEditRatch + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_ratch', String(S.stepEditRatch));
            }
        }
        return;
    }

}

function _onCC_knobs(d1, d2) {
    /* Knob CCs 71-78: apply delta to active bank parameter.
     * Relative encoder: d2 1-63 = CW (+1), d2 64-127 = CCW (-1).
     * pm.sens > 1 = accumulate that many ticks before firing one unit change.
     * pm.lock = true: fire once then block until touch release (S.knobLocked). */
    if (d1 >= 71 && d1 <= 78) {
        /* Exclusive overlays — knob turns have no visible effect and should be swallowed. */
        if (S.heldStep >= 0) return;
        if (S.globalMenuOpen || S.tapTempoOpen || S.confirmBake || S.confirmClearSession || S.confirmConvertToDrum || S.confirmConvertToConduct || S.menuInfoLines.length > 0 || S.confirmExport || S.exportDoneDialog || S.recordBlockedDialog || S.confirmStateWipe || S.bpmMoveInfo) return;
        const knobIdx = d1 - 71;
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty = true;
        const bank    = S.activeBank;
        /* Arp Steps interval-mode overlay: K1-K8 set per-step scale-degree
         * offset (±24) for SEQ ARP (bank 4, per-clip) or TARP (bank 5, per-track).
         * Sens=2: ~ half-turn covers the full range. */
        if (S.stepIntervalMode && (bank === 4 || bank === 5)) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 2) {
                S.knobAccum[knobIdx] = 0;
                if (bank === 4) {
                    const ac = effectiveClip(t);
                    const cur = S.seqArpStepInt[t][ac][knobIdx] | 0;
                    const nxt = Math.max(-24, Math.min(24, cur + dir));
                    if (nxt !== cur) {
                        S.seqArpStepInt[t][ac][knobIdx] = nxt;
                        /* Writes to active-clip pfx_params via pfx_set; matches the
                         * tN_seq_arp_step_vel routing. */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_seq_arp_step_int', knobIdx + ' ' + nxt);
                    }
                } else {
                    const cur = S.tarpStepInt[t][knobIdx] | 0;
                    const nxt = Math.max(-24, Math.min(24, cur + dir));
                    if (nxt !== cur) {
                        S.tarpStepInt[t][knobIdx] = nxt;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_tarp_step_int', knobIdx + ' ' + nxt);
                    }
                }
            }
            return;
        }
        /* Conductor Responder/Octave/When banks: knob k edits track k's per-clip
         * value. Gated strictly on the active track being a Conductor AND one of
         * the three banks, so normal bank editing is untouched. The Move emits
         * MULTIPLE CC msgs per physical detent, so we route through the SAME
         * accumulation siblings use → ONE detent = ONE action:
         *   - Octave: knobAccum threshold (sens=16, matches drum LaneOct/LaneNote
         *     at ~9424) → one ±1 step per detent.
         *   - Responder/When: knobLocked one-action-per-gesture (matches K2 Stch
         *     ~9150 / K4 Lgto ~9196) → one toggle flip per physical turn,
         *     regardless of msg count; lock clears on knob touch-release. */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT &&
                (bank === BANK_RESPONDER || bank === BANK_OCTAVE || bank === BANK_WHEN)) {
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            if (bank === BANK_OCTAVE) {
                /* sens=16 — matches drum NOTE FX LaneOct/LaneNote ±1 stepping */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    applyConductGridKnob(BANK_OCTAVE, knobIdx, dir);
                }
            } else {
                /* Responder / When: single-fire toggle, locked per gesture */
                if (S.knobLocked[knobIdx]) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    S.knobLocked[knobIdx] = true;
                    applyConductGridKnob(bank, knobIdx, dir);
                }
            }
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 0) {
            const t    = S.activeTrack;
            const ac   = effectiveClip(t);
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }

            if (knobIdx === 0) {
                /* K1 = Res (normal=proportional rescale; alt=zoom, sens=16) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const curIdx = Math.max(0, TPS_VALUES.indexOf(S.drumLaneTPS[t]));
                    const nv = Math.max(0, Math.min(5, curIdx + dir));
                    if (nv !== curIdx) {
                        if (S.altMode) {
                            const newTps = TPS_VALUES[nv];
                            const newLen = Math.ceil(S.drumLaneLength[t] * S.drumLaneTPS[t] / newTps);
                            if (newLen > 256) {
                                showActionPopup('NOTES OUT', 'OF RANGE');
                                forceRedraw();
                            } else if (S.heldStep >= 0) {
                                /* blocked during step edit */
                            } else {
                                S.drumLaneTPS[t]    = newTps;
                                S.drumLaneLength[t] = newLen;
                                S.bankParams[t][0][knobIdx] = nv;
                                const maxPage = Math.max(0, Math.ceil(newLen / 16) - 1);
                                if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_l' + lane + '_clip_resolution_zoom', String(nv));
                                S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                                forceRedraw();
                            }
                        } else {
                            S.drumLaneTPS[t] = TPS_VALUES[nv];
                            S.bankParams[t][0][knobIdx] = nv;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_clip_resolution', String(nv));
                            S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                        }
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 1) {
                /* K2 = Stch (beat stretch, lock, sens=16) */
                if (S.knobLocked[knobIdx]) return;
                const len = S.drumLaneLength[t];
                const canFire = dir === 1 ? (len * 2 <= 256) : (len >= 2);
                if (!canFire) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_beat_stretch', String(dir));
                    S.knobLocked[knobIdx] = true;
                    const blocked = host_module_get_param('t' + t + '_beat_stretch_blocked') === '1';
                    if (dir === -1 && blocked) {
                        S.stretchBlockedEndTick = S.tickCount + STRETCH_BLOCKED_TICKS;
                    } else {
                        S.drumLaneLength[t] = dir === 1 ? len * 2 : Math.floor(len / 2);
                        const maxPage = Math.max(0, Math.ceil(S.drumLaneLength[t] / 16) - 1);
                        if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
                        S.bankParams[t][0][1] = dir;
                        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Shft (clock shift, sens=8). Alt = Nudge (sens=4, faster). */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= (S.altMode ? 4 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        S.bankParams[t][0][knobIdx] += dir;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_nudge', String(dir));
                    } else {
                        S.clockShiftTouchDelta += dir;
                        S.bankParams[t][0][knobIdx] = S.clockShiftTouchDelta;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_clock_shift', String(dir));
                    }
                    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Lgto: destructive one-shot. Right-turn opens confirm dialog. */
                if (S.knobLocked[knobIdx]) return;
                if (dir !== 1) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    S.confirmLgto       = true;
                    S.confirmLgtoSel    = 0;
                    S.confirmLgtoIsDrum = true;
                    S.knobLocked[knobIdx] = true;
                    forceRedraw();
                }
                return;
            }
            if (knobIdx === 4) {
                /* K5 = Eucl (Bjorklund hit count, sens=8) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const len  = S.drumLaneLength[t];
                    const prev = Math.min(S.drumLaneEuclidN[t][lane] | 0, len);
                    const nv   = Math.max(0, Math.min(len, prev + dir));
                    if (nv !== prev) {
                        const vel = stepEntryVelocity(t, -1, true);
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_euclid_stamp',
                                                  prev + ' ' + nv + ' ' + vel);
                        S.drumLaneEuclidN[t][lane] = nv;
                        S.bankParams[t][0][4] = nv;
                        S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 6) {
                /* K7 = Dir (per-lane playback direction, sens=16).
                 * AltMode flips this to Step / Audio playback style (sens=4). */
                S.knobAccum[knobIdx]++;
                const _k7Sens = S.altMode ? 4 : 16;
                if (S.knobAccum[knobIdx] >= _k7Sens) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        const _cur = S.drumLanePlaybackAudioReverse[t][lane] | 0;
                        const _nv  = Math.max(0, Math.min(1, _cur + dir));
                        if (_nv !== _cur) {
                            S.drumLanePlaybackAudioReverse[t][lane] = _nv;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_playback_audio_reverse', String(_nv));
                        }
                    } else {
                        const _cur = S.drumLanePlaybackDir[t][lane] | 0;
                        const _nv  = Math.max(0, Math.min(3, _cur + dir));
                        if (_nv !== _cur) {
                            S.drumLanePlaybackDir[t][lane] = _nv;
                            S.bankParams[t][0][6] = _nv;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_l' + lane + '_playback_dir', String(_nv));
                        }
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 7) {
                /* K8 = SqFl: sens=16 — matches melodic */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const _cur = S.clipSeqFollow[t][ac] ? 1 : 0;
                    const _nv  = Math.max(0, Math.min(1, _cur + dir));
                    if (_nv !== _cur) {
                        S.clipSeqFollow[t][ac] = _nv !== 0;
                        S.bankParams[t][0][7]  = _nv;
                        S.screenDirty = true;
                    }
                }
                return;
            }
        }
        /* ALL LANES bank (drum, bank 7): K1=Res K2=Stch K3=Shft K4=Qnt K5=VelIn K6=InQ K7=Dir K8=SyncRpt */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7 && !S.allLanesConfirmed) {
            S.screenDirty = true;
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            if (knobIdx === 0) {
                /* K1 = Res: set resolution on all 32 lanes (absolute), sens=16 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const curIdx = S.bankParams[t][7][0] < 0 ? -1 : S.bankParams[t][7][0];
                    const nv = Math.max(0, Math.min(5, curIdx + dir));
                    if (nv !== curIdx) {
                        S.bankParams[t][7][0] = nv;
                        S.drumLaneTPS[t] = TPS_VALUES[nv];
                        host_module_set_param('t' + t + '_all_lanes_clip_resolution', String(nv));
                        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 1) {
                /* K2 = Stch: beat stretch all lanes, lock, sens=16 */
                if (S.knobLocked[knobIdx]) return;
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    host_module_set_param('t' + t + '_all_lanes_beat_stretch', String(dir));
                    S.knobLocked[knobIdx] = true;
                    S.bankParams[t][7][1] += dir;
                    S.pendingAllLanesStretchCheck = t;
                    S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Shft: clock shift all lanes, sens=8. Alt = Nudge (sens=1). */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= (S.altMode ? 1 : 8)) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        S.bankParams[t][7][2] += dir;
                        host_module_set_param('t' + t + '_all_lanes_nudge', String(dir));
                    } else {
                        S.clockShiftTouchDelta += dir;
                        S.bankParams[t][7][2] = S.clockShiftTouchDelta;
                        host_module_set_param('t' + t + '_all_lanes_clock_shift', String(dir));
                    }
                    S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Qnt: quantize all lanes 0-100, sens=1 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 1) {
                    S.knobAccum[knobIdx] = 0;
                    const cur7q = S.bankParams[t][7][3] < 0 ? 0 : S.bankParams[t][7][3];
                    const nv = Math.max(0, Math.min(100, cur7q + dir));
                    if (nv !== cur7q) {
                        S.bankParams[t][7][3] = nv;
                        S.drumLaneQnt[t] = nv;
                        S.bankParams[t][1][2] = nv;
                        host_module_set_param('t' + t + '_drum_lanes_qnt', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 4) {
                /* K5 = VelIn: track velocity override, sens=1 */
                const cur7v = S.trackVelOverride[t];
                const nv = Math.max(0, Math.min(127, cur7v + dir));
                if (nv !== cur7v) applyTrackConfig(t, 'track_vel_override', nv);
                S.screenDirty = true;
                return;
            }
            if (knobIdx === 5) {
                /* K6 = InQ: per-track drum input quantize, 9 values (0=Off..8=1/4T), sens=8 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(8, S.drumInpQuant[t] + dir));
                    if (nv !== S.drumInpQuant[t]) {
                        S.drumInpQuant[t] = nv;
                        S.bankParams[t][7][5] = nv;
                        host_module_set_param('t' + t + '_diq', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 6) {
                /* K7 = Dir: set playback direction on all 32 lanes, sens=16.
                 * Alt = RvSt (audio reverse on all lanes), sens=4. */
                S.knobAccum[knobIdx]++;
                const _k7Sens = S.altMode ? 4 : 16;
                if (S.knobAccum[knobIdx] >= _k7Sens) {
                    S.knobAccum[knobIdx] = 0;
                    if (S.altMode) {
                        const curRv = S.bankParams[t][7][6] < 0 ? -1 : S.bankParams[t][7][6];
                        const nvRv = Math.max(0, Math.min(1, curRv + dir));
                        if (nvRv !== curRv) {
                            S.bankParams[t][7][6] = nvRv;
                            host_module_set_param('t' + t + '_all_lanes_playback_audio_reverse', String(nvRv));
                        }
                    } else {
                        const curDir = S.bankParams[t][7][6] < 0 ? -1 : S.bankParams[t][7][6];
                        const nvDir = Math.max(0, Math.min(3, curDir + dir));
                        if (nvDir !== curDir) {
                            S.bankParams[t][7][6] = nvDir;
                            host_module_set_param('t' + t + '_all_lanes_playback_dir', String(nvDir));
                        }
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 7) {
                /* K8 = SyncRpt: per-track drum repeat sync toggle, bool, sens=8 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const cur7s = S.bankParams[t][7][7] | 0;
                    const nv = Math.max(0, Math.min(1, cur7s + dir));
                    if (nv !== cur7s) {
                        S.bankParams[t][7][7] = nv;
                        host_module_set_param('t' + t + '_drum_repeat_sync', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            return;
        }
        /* Drum NOTE FX bank (bank 1): K1=LaneOct K2=LaneNote K3=Vel K4=Qnt K5=Len(placeholder) K6=Gate; K7/K8 blocked */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 1) {
            if (knobIdx >= 6) return;
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            if (knobIdx === 0 || knobIdx === 1) {
                /* K1 = LaneOct (±12 semitones), K2 = LaneNote (±1 semitone), sens=16 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const delta = knobIdx === 0 ? dir * 12 : dir;
                    const nv = Math.max(0, Math.min(127, S.drumLaneNote[t][lane] + delta));
                    if (nv !== S.drumLaneNote[t][lane]) {
                        S.drumLaneNote[t][lane] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_lane_note', String(nv));
                        /* PHASE-1: DSP padmap caches the resolved lane notes; re-push
                         * so on_midi dispatches the new note for this lane's pads. */
                        if (t === S.activeTrack) computePadNoteMap();
                        S.screenDirty = true;
                    }
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Vel: -127..127, sens=1 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 1) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(-127, Math.min(127, (S.bankParams[t][1][1] | 0) + dir));
                    if (nv !== S.bankParams[t][1][1]) {
                        S.bankParams[t][1][1] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'velocity_offset ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Qnt — per-lane quantize, sens=1 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 1) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(100, S.drumLaneQnt[t] + dir));
                    if (nv !== S.drumLaneQnt[t]) {
                        S.drumLaneQnt[t] = nv;
                        S.bankParams[t][1][2] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'quantize ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 4) {
                /* K5 = Len: 0..8 (--/.25/.5/.75/1/2/4/8/16), sens=8 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const cur = S.drumLaneLenMode[t][lane] | 0;
                    const nv  = Math.max(0, Math.min(8, cur + dir));
                    if (nv !== cur) {
                        S.drumLaneLenMode[t][lane] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'note_length_mode ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 5) {
                /* K6 = Gate: 0-400, sens=2 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 2) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(400, (S.bankParams[t][1][0] | 0) + dir));
                    if (nv !== S.bankParams[t][1][0]) {
                        S.bankParams[t][1][0] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', 'gate_time ' + nv);
                    }
                    S.screenDirty = true;
                }
                return;
            }
            return;
        }
        /* Repeat Groove bank (bank 6 on drum tracks): vel scale (unshifted) or nudge (Shift) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 5) {
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 2) {
                S.knobAccum[knobIdx] = 0;
                const step = knobIdx;
                if (S.altMode) {
                    const nv = Math.max(-50, Math.min(50, (S.drumRepeatNudge[t][lane][step] | 0) + dir));
                    if (nv !== S.drumRepeatNudge[t][lane][step]) {
                        S.drumRepeatNudge[t][lane][step] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_repeat_nudge', step + ' ' + nv);
                    }
                } else {
                    const nv = Math.max(0, Math.min(200, (S.drumRepeatVelScale[t][lane][step] | 0) + dir * 3));
                    if (nv !== S.drumRepeatVelScale[t][lane][step]) {
                        S.drumRepeatVelScale[t][lane][step] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_repeat_vel_scale', step + ' ' + nv);
                    }
                }
                S.screenDirty = true;
            }
            return;
        }
        /* CC PARAM bank (bank 6): see notes/cc-automation-redesign.md §5/§8.
         * Shift+turn = pick type (AT) / CC number; normal turn = set the clip's
         * resting value, record automation (armed), or audition (automated+playing);
         * Delete+turn = clear the knob's automation + resting value → "—". */
        if (bank === 6) {
            const t  = S.activeTrack;
            const ac = effectiveClip(t);
            const _setp = (k, v) => { if (typeof host_module_set_param === "function") host_module_set_param("t" + t + "_" + k, v); };
            /* Active lane = last-touched knob; persistent (no timeout). */
            S.ccActiveLane[t] = knobIdx;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;

            /* alt mode: type/number ladder — Sch1..Sch8 (type 2) ↔ AT (type 1) ↔ CC0..CC127 (type 0).
             * Sch (chain knob) only available when patched Schwung is present.
             * Unified position: CC0..127 = 0..127, AT = -1, Sch1 = -2, Sch2 = -3, ..., Sch8 = -9.
             * When type=2, trackCCAssign holds the chain knob number (1-8). */
            if (S.altMode) {
                if (S.knobAccum[knobIdx] >= 4) {
                    S.knobAccum[knobIdx] = 0;
                    const hasSch = typeof shadow_set_param === 'function';
                    const cur = (S.trackCCType[t][knobIdx] === 2) ? -(S.trackCCAssign[t][knobIdx] + 1)
                              : (S.trackCCType[t][knobIdx] === 1) ? -1
                              : S.trackCCAssign[t][knobIdx];
                    const minVal = hasSch ? -9 : -1;
                    const nx  = Math.max(minVal, Math.min(127, cur + dir));
                    if (nx <= -2) {
                        const schKnob = -(nx + 1);
                        S.trackCCType[t][knobIdx] = 2;
                        S.trackCCAssign[t][knobIdx] = schKnob;
                        S.schLabel[t][knobIdx] = null;
                        _setp('cc_type_assign', knobIdx + ' 2 ' + schKnob);
                    } else if (nx === -1) {
                        S.trackCCType[t][knobIdx] = 1;
                        _setp('cc_type_assign', knobIdx + ' 1 ' + S.trackCCAssign[t][knobIdx]);
                    } else {
                        S.trackCCType[t][knobIdx] = 0;
                        S.trackCCAssign[t][knobIdx] = nx;
                        _setp('cc_type_assign', knobIdx + ' 0 ' + nx);
                    }
                    S.screenDirty = true;
                }
                return;
            }

            /* Held step: the step editor (_onCC_stepedit) is the sole writer. */
            if (S.heldStep >= 0) return;  /* held step → CC step editor owns it (drum + melodic) */

            /* Delete+turn: clear this knob's automation AND resting value → "—". */
            if (S.deleteHeld) {
                S.trackCCAutoBits[t][ac] &= ~(1 << knobIdx);
                S.trackCCLiveVal[t][knobIdx] = -1;
                S.clipCCVal[t][ac][knobIdx]  = -1;
                _setp('cc_auto_clear_k', ac + ' ' + knobIdx);
                showActionPopup('CC', 'CLEAR');
                invalidateLEDCache();
                return;
            }

            /* Normal turn: run-length acceleration (first few clicks ±1, sustained turning ramps up). */
            const accel = ccKnobDelta(d2, knobIdx);
            if (accel === 0) return;
            /* Gate the record path on S.playing rather than !S.recordCountingIn:
             * recordCountingIn only clears when pollDSP catches the count-in 1->0
             * edge (~every POLL_INTERVAL), so for up to ~43ms after the count-in
             * downbeat a knob turn would be misrouted to cc_rest and never engage
             * the DSP latch. S.playing is 0 for the whole count-in and flips to 1
             * atomically with tr->recording at fire, so it tracks the real arm. */
            const armed   = S.recordArmed && S.recordArmedTrack === t && S.playing;
            const hasAuto = (S.trackCCAutoBits[t][ac] >> knobIdx) & 1;

            if (armed) {
                /* Record automation. */
                const base = (S.trackCCLiveVal[t][knobIdx] >= 0) ? S.trackCCLiveVal[t][knobIdx]
                           : (S.clipCCVal[t][ac][knobIdx] >= 0 ? S.clipCCVal[t][ac][knobIdx] : 0);
                const nv = Math.max(0, Math.min(127, base + accel));
                S.trackCCLiveVal[t][knobIdx] = nv;
                _setp('cc_send', knobIdx + ' ' + nv);
                S.trackCCAutoBits[t][ac] |= (1 << knobIdx);
                S.screenDirty = true;
                return;
            }
            if (S.playing && hasAuto) {
                /* Automated lane, playing, not armed: transient live audition only. */
                const base = (S.trackCCLiveVal[t][knobIdx] >= 0) ? S.trackCCLiveVal[t][knobIdx] : 0;
                const nv = Math.max(0, Math.min(127, base + accel));
                S.trackCCLiveVal[t][knobIdx] = nv;
                _setp('cc_send', knobIdx + ' ' + nv);
                S.screenDirty = true;
                return;
            }
            /* Stopped, or playing on an un-automated lane: set the clip resting value.
             * "—" floor: crossing below 0 → "—"; from "—" the first up-step lands on 0. */
            const cur = S.clipCCVal[t][ac][knobIdx];
            let nv;
            if (cur < 0) nv = (accel > 0) ? (accel - 1) : -1;
            else        { nv = cur + accel; if (nv < 0) nv = -1; }
            nv = Math.max(-1, Math.min(127, nv));
            if (nv === cur) return;
            S.clipCCVal[t][ac][knobIdx]  = nv;
            S.trackCCLiveVal[t][knobIdx] = nv;
            _setp('cc_rest', ac + ' ' + knobIdx + ' ' + (nv < 0 ? 255 : nv));
            S.screenDirty = true;
            return;
        }
        /* Alt+K8 on NOTE FX (bank 1) or DELAY (bank 3), melodic: cycle random algorithm (Pure/Gaus/Walk) */
        if (S.altMode && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
                ((bank === 1 && knobIdx === 7) || (bank === 3 && knobIdx === 7))) {
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                const t = S.activeTrack;
                const isMidi = bank === 3;
                const cur = isMidi ? (S.midiDlyRandomMode[t] || 0) : (S.noteFXRandomMode[t] || 0);
                const nv = ((cur + dir) % 3 + 3) % 3;
                if (isMidi) { S.midiDlyRandomMode[t] = nv; }
                else        { S.noteFXRandomMode[t]  = nv; }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(isMidi ? 'delay_pitch_random_mode' : 'noteFX_random_mode', String(nv));
                S.screenDirty = true;
            }
            return;
        }
        /* Shift+K1 on DELAY bank (melodic): clock feedback. K7 now hosts
         * delay_retrig (replaces the prior standalone Clk knob); clock_fb
         * folds onto the unused Shift modifier on K1 with a label flip
         * "Rate"↔"ClkF" in the OLED render. Mirror stored in S.delayClockFb
         * since bankParams[t][3][6] now stores retrig. */
        if (S.altMode && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM &&
                bank === 3 && knobIdx === 0) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 1) {
                S.knobAccum[knobIdx] = 0;
                const nv = Math.max(-100, Math.min(100, (S.delayClockFb[t] | 0) + dir));
                if (nv !== S.delayClockFb[t]) {
                    S.delayClockFb[t] = nv;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_delay_clock_fb', String(nv));
                }
                S.screenDirty = true;
            }
            return;
        }
        /* Melodic CLIP K6 = InQ — per-track input quantize, mirrors drum
         * ALL LANES K5. Custom path keeps S.drumInpQuant (the shared JS
         * mirror used by both bank-overview render paths) in sync with
         * bankParams[t][0][4]. The DSP field is `tr->drum_inp_quant` —
         * historical name; now per-track-type-agnostic. */
        if (S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM && bank === 0 && knobIdx === 4) {
            const t   = S.activeTrack;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 8) {
                S.knobAccum[knobIdx] = 0;
                const nv = Math.max(0, Math.min(8, S.drumInpQuant[t] + dir));
                if (nv !== S.drumInpQuant[t]) {
                    S.drumInpQuant[t] = nv;
                    S.bankParams[t][0][4] = nv;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_diq', String(nv));
                }
                S.screenDirty = true;
            }
            return;
        }
        /* Conduct bank (CLIP bank 0 on a Conductor) K6 = CdLk lock toggle.
         * Single-fire per gesture (knobLocked), matching Responder/When.
         * Off=gate-hold, Lock=sample-and-hold. Pushes per-clip cond_lock to
         * DSP (N=conductor track, C=active conductor clip). Melodic/drum CLIP
         * K6 is unassigned and falls through to the generic stub (no-op). */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT && bank === 0 && knobIdx === 5) {
            if (S.knobLocked[knobIdx]) return;
            const t   = S.activeTrack;
            const ac  = S.trackActiveClip[t] | 0;
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                S.knobLocked[knobIdx] = true;
                S.condLock[ac] = S.condLock[ac] ? 0 : 1;   /* single-fire toggle */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_c' + ac + '_cond_lock', String(S.condLock[ac]));
                S.screenDirty = true;
            }
            return;
        }
        /* Conductor NOTE FX (bank 1) is slimmed: only K1(Oct)/K2(Ofs)/K8(Rnd)
         * + alt-K8 random-mode (handled above) apply. K3-K6 (Vel/Qnt/Len/Gate)
         * are inert — swallow the detent so nothing writes. K1/K2/K8 fall
         * through to the generic param handler (writes per-clip pfx via the
         * tN_noteFX_* → active-clip pfx_set path). */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT && bank === 1 &&
                (knobIdx === 2 || knobIdx === 3 || knobIdx === 4 || knobIdx === 5)) {
            return;
        }
        const pm      = BANKS[bank].knobs[knobIdx];
        if (pm && pm.abbrev && pm.scope !== 'stub' && !S.knobLocked[knobIdx]) {
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) {
                S.knobAccum[knobIdx]   = 0;
                S.knobLastDir[knobIdx] = dir;
            }
            S.knobAccum[knobIdx]++;
            /* Shift+Shft (Nudge mode) fires twice as fast as plain Clock Shift. */
            const _effSens = (pm.dspKey === 'clock_shift' && S.altMode) ? Math.max(1, (pm.sens >> 1))
                           : (pm.dspKey === 'clip_playback_dir' && S.altMode) ? 4
                           : pm.sens;
            if (S.knobAccum[knobIdx] >= _effSens) {
                S.knobAccum[knobIdx] = 0;
                S.screenDirty = true;
                if (pm.scope === 'action') {
                    const t   = S.activeTrack;
                    const ac  = S.trackActiveClip[t];
                    const len = S.clipLength[t][ac];
                    /* Lgto knob (CLIP K8): right-turn opens the destructive
                     * confirm dialog. Left-turn is a no-op (one-way action). */
                    if (pm.dspKey === 'lgto_apply') {
                        if (dir !== 1) return;
                        S.confirmLgto       = true;
                        S.confirmLgtoSel    = 0;  /* default OK */
                        S.confirmLgtoIsDrum = false;
                        S.knobLocked[knobIdx] = true;
                        forceRedraw();
                        return;
                    }
                    if (pm.lock) {
                        /* Beat Stretch: one-shot, then lock until touch release */
                        const canFire = dir === 1 ? (len * 2 <= 256) : (len >= 2);
                        if (canFire && typeof host_module_set_param === 'function') {
                            host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                            S.knobLocked[knobIdx] = true;
                            /* For compress: check if DSP blocked due to step collision */
                            if (dir === -1 && host_module_get_param('t' + t + '_beat_stretch_blocked') === '1') {
                                S.stretchBlockedEndTick = S.tickCount + STRETCH_BLOCKED_TICKS;
                            } else {
                                /* Mirror DSP step rewrite in JS S.clipSteps */
                                const steps = S.clipSteps[t][ac];
                                if (dir === 1) {
                                    for (let si = len - 1; si >= 1; si--) {
                                        steps[si * 2] = steps[si];
                                        steps[si] = 0;
                                    }
                                    for (let si = 1; si < len * 2; si += 2) steps[si] = 0;
                                    S.clipLength[t][ac] = len * 2;
                                } else {
                                    const halfLen = len >> 1;
                                    const tmp = new Array(halfLen).fill(0);
                                    for (let si = 0; si < len; si++) {
                                        if (steps[si] === 1 && !tmp[si >> 1]) tmp[si >> 1] = 1;
                                    }
                                    for (let si = 0; si < len; si++) {
                                        if (steps[si] === 2 && !tmp[si >> 1]) tmp[si >> 1] = 2;
                                    }
                                    for (let si = 0; si < len; si++) steps[si] = 0;
                                    for (let si = 0; si < halfLen; si++) steps[si] = tmp[si];
                                    S.clipLength[t][ac] = halfLen;
                                }
                                /* Clamp page index to new length */
                                const newPages = Math.max(1, Math.ceil(S.clipLength[t][ac] / 16));
                                if (S.trackCurrentPage[t] >= newPages)
                                    S.trackCurrentPage[t] = newPages - 1;
                                /* Per-touch label: dir +1 → fmtStretch shows 'x2', -1 → '/2' */
                                S.bankParams[t][bank][knobIdx] = dir;
                            }
                        }
                    } else if (pm.dspKey === 'clock_shift') {
                        if (S.altMode) {
                            /* alt = Nudge — fire DSP, mirror counter for display, schedule re-read */
                            if (typeof host_module_set_param === 'function') {
                                host_module_set_param('t' + t + '_nudge', String(dir));
                                S.bankParams[t][bank][knobIdx] += dir;
                                S.pendingStepsReread      = 2;
                                S.pendingStepsRereadTrack = t;
                                S.pendingStepsRereadClip  = ac;
                            }
                        } else if (len >= 2 && typeof host_module_set_param === 'function') {
                            /* Clock Shift: continuous rotation, no lock */
                            host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                            const steps = S.clipSteps[t][ac];
                            if (dir === 1) {
                                const last = steps[len - 1];
                                for (let si = len - 1; si > 0; si--) steps[si] = steps[si - 1];
                                steps[0] = last;
                            } else {
                                const first = steps[0];
                                for (let si = 0; si < len - 1; si++) steps[si] = steps[si + 1];
                                steps[len - 1] = first;
                            }
                            S.clockShiftTouchDelta += dir;
                            S.bankParams[t][bank][knobIdx] = S.clockShiftTouchDelta;
                        }
                    }
                } else if (S.altMode && pm && pm.dspKey === 'clip_playback_dir' &&
                           S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                    /* AltMode CLIP K5: toggle Step / Audio playback style on
                     * the active melodic clip. Values 0..1, clamped. */
                    const _t  = S.activeTrack;
                    const _ac = effectiveClip(_t);
                    const _cur = S.clipPlaybackAudioReverse[_t][_ac] | 0;
                    const _nv  = Math.max(0, Math.min(1, _cur + dir));
                    if (_nv !== _cur) {
                        S.clipPlaybackAudioReverse[_t][_ac] = _nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _t + '_clip_playback_audio_reverse', String(_nv));
                    }
                } else {
                    const cur  = S.bankParams[S.activeTrack][bank][knobIdx];
                    const step = pm.step || 1;
                    let nv  = Math.max(pm.min, Math.min(pm.max, cur + dir * step));
                    if (nv !== cur) {
                        if (S.altMode && pm.dspKey === 'clip_resolution') {
                            const _t   = S.activeTrack;
                            const _ac  = effectiveClip(_t);
                            const _old_tps = S.clipTPS[_t][_ac];
                            const _new_tps = TPS_VALUES[nv];
                            const _old_ticks = S.clipLength[_t][_ac] * _old_tps;
                            const _new_len = Math.ceil(_old_ticks / _new_tps);
                            if (_new_len > 256) {
                                showActionPopup('NOTES OUT', 'OF RANGE');
                                forceRedraw();
                            } else if (S.heldStep >= 0 || (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === _t)) {
                                /* blocked — do nothing */
                            } else {
                                S.bankParams[S.activeTrack][bank][knobIdx] = nv;
                                S.clipTPS[_t][_ac]    = _new_tps;
                                S.clipLength[_t][_ac] = _new_len;
                                const _maxPage = Math.max(0, Math.ceil(_new_len / 16) - 1);
                                if (S.trackCurrentPage[_t] > _maxPage) S.trackCurrentPage[_t] = _maxPage;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + _t + '_clip_resolution_zoom', String(nv));
                                S.pendingStepsReread      = 2;
                                S.pendingStepsRereadTrack = _t;
                                S.pendingStepsRereadClip  = _ac;
                                refreshPerClipBankParams(_t);
                                forceRedraw();
                            }
                        } else {
                            S.bankParams[S.activeTrack][bank][knobIdx] = nv;
                            applyBankParam(S.activeTrack, bank, knobIdx, nv);
                            if (bank === 5 && knobIdx === 0 && nv !== 0)
                                S.lastTarpStyle[S.activeTrack] = nv;
                        }
                    }
                }
            }
        }
    }
}

function _switchViewCleanup() {
    S.heldStepBtn        = -1;
    S.heldStep           = -1;
    S.heldStepNotes      = [];
    S.stepWasEmpty       = false;
    S.stepWasHeld        = false;
    S.stepBtnPressedTick.fill(-1);
    S.sessionStepHeld    = -1;
    S.sessionStepHeldCtx = 0;
    /* Leaving Session View stops any active loop; mods/latch persist. */
    if (!S.sessionView && (S.perfViewLocked || S.perfStack.length > 0)) {
        const _hadLoop = S.perfStack.length > 0;
        S.perfStack         = [];
        S.perfStickyLengths = new Set();
        S.perfHoldPadHeld   = false;
        S.perfViewLocked    = false;
        S.loopHeld          = false;
        S.loopJogActive     = false;
        S.perfModsHeld      = 0;
        sendPerfMods();
        if (_hadLoop && typeof host_module_set_param === 'function')
            host_module_set_param('looper_stop', '1');
    }
    if (S.sessionView) {
        for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF);
        for (let t = 0; t < 8; t++) setLED(TRACK_PAD_BASE + t, LED_OFF);
    } else {
        for (let row = 0; row < 4; row++)
            for (let t = 0; t < 8; t++) setLED(92 - row * 8 + t, LED_OFF);
    }
}

export function _onCCMsg(d1, d2) {
    _onCC_jog(d1, d2);
    _onCC_buttons(d1, d2);
    _onCC_transport(d1, d2);
    _onCC_side(d1, d2);
    _onCC_stepedit(d1, d2);
    _onCC_knobs(d1, d2);
}
