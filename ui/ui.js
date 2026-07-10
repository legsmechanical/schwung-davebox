import {
    MoveShift,
    MoveBack,
    MovePlay,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown,
    MoveMute,
    MoveDelete
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    Red,
    Blue,
    VividYellow,
    Green,
    DarkGrey,
    HotMagenta,
    Cyan,
    Purple,
    DarkPurple,
    Bright,
    BurntOrange,
    White,
    SkyBlue,
    DeepBlue
} from '/data/UserData/schwung/shared/constants.mjs';

import {
    setLED,
    setButtonLED,
    isNoiseMessage,
    decodeDelta
} from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    installConsoleOverride
} from '/data/UserData/schwung/shared/logger.mjs';

import {
    createInfo, formatItemValue
} from '/data/UserData/schwung/shared/menu_items.mjs';

import {
    handleMenuInput
} from '/data/UserData/schwung/shared/menu_nav.mjs';

import {
    drawMenuHeader, drawMenuList, menuLayoutDefaults
} from '/data/UserData/schwung/shared/menu_layout.mjs';

import {
    MoveNoteSession, MoveUndo, MoveLoop, MoveCopy, MoveMainTouch, MoveRec,
    MoveCapture, MoveSample, MoveMainButton, MoveMainKnob,
    LED_OFF, LED_STEP_ACTIVE, LED_STEP_CURSOR, SCENE_BTN_FLASH_TICKS,
    LEDS_PER_FRAME, NUM_TRACKS, NUM_CLIPS, DRUM_LANES,
    FLAG_JUMP_TO_OVERTAKE, FLAG_JUMP_TO_TOOLS, SEQ8_NAV_FLAGS, NUM_STEPS,
    TRACK_COLORS, TRACK_DIM_COLORS, TRACK_PAD_BASE, TOP_PAD_BASE,
    TPS_VALUES, DELAY_LABELS,
    fmtLgto, fmtNote, fmtPages,
    fmtDly, fmtPlain,
    fmtArpStyle, fmtArpSteps, fmtArpOct,
    MCUFONT, pixelPrintC,
    BANKS, ACTION_POPUP_TICKS, PAD_MODE_DRUM, PAD_MODE_MELODIC_SCALE, PAD_MODE_CONDUCT,
    BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN,
    POLL_INTERVAL, TICK_HZ, NO_NOTE_FLASH_TICKS, TAP_TEMPO_FLASH_TICKS, TAP_TEMPO_RESET_MS,
    PARAM_LED_BANKS,
    CC_GRADIENT_BASE, CC_GRADIENT_LEVELS, CC_GRADIENT_SCALARS,
    STEP_ITER_LIST
} from './ui_constants.mjs';

import { S, conductorTrackIdx } from './ui_state.mjs';
import { drumPadToLane, drumPadToVelZone, drumVelZoneToVelocity, _clipIsEmpty, clipHasContent,
    scaleNudgeNote } from './ui_pure.mjs';
import { saveState, writeSidecar, doClearSession, showActionPopup, uuidToStatePath, readActiveSet, loadNameIndex, saveNameIndex, copyStateFiles, findInheritCandidates,
    commitSnapshot, updateNameIndex } from './ui_persistence.mjs';
import {
    openSaveSnapshot, closeSnapshotPicker,
    snapshotPickerRotate, snapshotPickerClick, openClearAutoMenu, closeClearAutoMenu,
    clearAutoMenuRotate, clearAutoMenuClick
} from './ui_dialogs.mjs';
import { trackClipHasContent, sceneAllQueued, updateSceneMapLEDs } from './ui_scene.mjs';
import { _padDispatchMutedNow, computePadNoteMap, syncDrumLaneSteps, syncDrumLanesMeta,
    setActiveDrumLane, setDrumPerformMode, setDrumLanePage,
    syncDrumClipContent } from './ui_drummodel.mjs';
import { effectiveClip, updateStepLEDs, updateSessionLEDs, updateTrackLEDs, flashAtRate, invalidateLEDCache, trackColor, trackDimColor, setPaletteEntryRGB, reapplyPalette, forceRedraw, updatePerfModeLEDs, PERF_MOD_PAD_MAP, bankHasAltParams, altIndicatorActive } from './ui_leds.mjs';
import { schSlotForTrack, schSlotsForTrack, openSchwungSlotEditor, enterSchwungCoRun, exitSchwungCoRun,
    enterMoveNativeCoRun, exitMoveNativeCoRun, assertOvertakeSysexSuppress,
    DAVEBOX_CORUN_KEEP_MASK,
    CORUN_GRP_JOG, CORUN_GRP_KNOBS, CORUN_GRP_SHIFT, CORUN_GRP_BACK, CORUN_GRP_TOUCH } from './ui_corun.mjs';
import { confirmExportStart, confirmExportCondClick, pollPendingExport } from './ui_export.mjs';
import { openGlobalMenu, ensureGlobalMenuFresh } from './ui_menu.mjs';
import { R } from './ui_seams.mjs';
import { drawUI } from './ui_render.mjs';
import { pollDSP, applyTrackConfig, readBankParams, applyBankParam,
    refreshPerClipBankParams, refreshDrumLaneBankParams, refreshSeqNotesIfCurrent,
    resyncDrumTrack, resetPerClipBankParamsToDefault,
    syncClipsFromDsp, syncClipsTargeted, syncMuteSoloFromDsp, restoreUiSidecar,
    liveSendNote, queueLiveNoteOff, _drainLiveNotes,
    unlatchAllTracks, _focusedClipIsEmpty,
    pendingDrumNoteOffs, _drumRecNoteOns, _drumRecNoteOffs } from './ui_dsp_bridge.mjs';

/* ------------------------------------------------------------------ */
/* UI state                                                             */
/* ------------------------------------------------------------------ */

/* Performance Mode state. Session View + Loop held → pad grid shows Perf Mode.
 * S.perfStack: currently-held R0 length pads (same stack semantics as old looper
 * step stack; rate captured at press time). Top = active rate.
 * S.perfModsToggled: latched modifier bitmask (Latch-toggle presses).
 * S.perfModsHeld: momentary bitmask (held mod pads, not Latch-pressed).
 * DSP receives (S.perfModsToggled | S.perfModsHeld) as perf_mods each change. */
/* Mask while the FX-picker overlay is open: the normal Move-co-run mask PLUS the
 * UI elements the overlay should own — jog (turn/click), the Back *routing* group,
 * the param knobs (turn → FX value), knob touch (param pop-up), and Shift (CC 49).
 * Keeping a group routes it to shadow_ui's intercept instead of ceding it to Move
 * firmware; shadow_ui's uniform coRunWants() rule then handles exactly what we keep.
 * Shift specifically: the overlay/chain editor's Shift-modified nav (FX-bus zoom,
 * fx_picker entry) is gated on coRunWants(CORUN_GRP_SHIFT) in shadow_ui — so unless
 * we KEEP Shift here, CC 49 cedes to Move firmware and isShiftHeld() never updates,
 * making Shift dead in every fx-picker-accessed chain. NOTE: the normal mask keeps
 * only CORUN_KEEP_BACK (1<<15, the framework-exit opt-out), NOT CORUN_GRP_BACK (the
 * routing group) — so the Back/jog/knob/shift groups must be added explicitly here
 * or those elements never reach shadow_ui. */
const DAVEBOX_PICKER_KEEP_MASK =
    DAVEBOX_CORUN_KEEP_MASK | CORUN_GRP_JOG | CORUN_GRP_BACK | CORUN_GRP_KNOBS | CORUN_GRP_TOUCH | CORUN_GRP_SHIFT;

const LOOPER_RATES_STRAIGHT = [12, 24, 48, 96, 192];   /* 1/32, 1/16, 1/8, 1/4, 1/2 */
const PERF_LATCH_LONG_PRESS = 100;     /* ~510ms → clear all toggled mods + exit Latch mode */
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

/* View lock: double-tap Loop keeps Perf Mode alive after Loop is released.
 * Single tap while locked → unlock + stop loop. */
const LOOP_TAP_TICKS  = 40;
const LOOP_DBLTAP_GAP = 80;

/* Per-pad pitch sent at note-on — ensures matching note-off even if map changes mid-hold. */
const padPitch = new Array(32).fill(-1);
const padPressTick = new Array(32).fill(-1);  /* tick when each pad was pressed, for drum tap-vs-hold detection */
const DRUM_TAP_TICKS = 10;  /* ~30ms — taps shorter than this suppress the release note-off */

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
const DRUM_FLASH_TICKS = 8; /* ~130ms pad flash duration after a drum hit */
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
const BANK_DISPLAY_TICKS = 94;  /* ~1000ms at 94Hz device tick rate (was 392 = ~4.2s; constant was miscalibrated for 196Hz) */
const STRETCH_BLOCKED_TICKS = 141;  /* ~1500ms at 94Hz (was 294, calibrated for the mistaken 196Hz) */
const KNOB_TURN_HIGHLIGHT_TICKS = 56;             /* ~600ms at 94Hz — highlight after turn without touch (was 120 @196Hz) */

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

const STEP_HOLD_TICKS      = 19;   /* ~200ms at ~94Hz (device actual): below = tap, at/above = hold */
const STEP_SAVE_HOLD_TICKS = 70;   /* ~750ms at 94Hz */
const STEP_SAVE_FLASH_TICKS = 40;  /* ~200ms double-blink on step button LEDs after save */

/* Metronome */

/* Undo/redo availability (mirrors DSP undo_valid/redo_valid; set on every undoable action) */

/* Per-track mute/solo state (JS mirrors DSP) */

/* Suspend detection (suspend_keeps_js) */

/* Global menu state (Phase 5q) */

/* Tap Tempo screen state */

/* Session overview overlay (hold CC 50) */
const NOTE_SESSION_HOLD_TICKS = 19;  /* ~200ms at 94Hz, matching STEP_HOLD_TICKS (was 40 @196Hz — a ~300ms hold misread as tap, latching momentary views) */

/* Real-time recording state */

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

function effectiveMute(t) {
    const anySolo = S.trackSoloed.some(function(s) { return s; });
    return S.trackMuted[t] || (anySolo && !S.trackSoloed[t]);
}

function setTrackMute(t, on) {
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

function setTrackSolo(t, on) {
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

function clearAllMuteSolo() {
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        S.trackMuted[_t]  = false;
        S.trackSoloed[_t] = false;
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('mute_all_clear', '1');
    S.screenDirty = true;
}

/* Clear all notes from a step and deactivate it (atomic DSP write). */
function clearStep(t, ac, absIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + ac + '_step_' + absIdx + '_clear', val: '1' });
    S.clipSteps[t][ac][absIdx] = 0;
    if (S.clipNonEmpty[t][ac]) S.clipNonEmpty[t][ac] = clipHasContent(t, ac);
    refreshSeqNotesIfCurrent(t, ac, absIdx);
}

function showModePopup(title, items, activeIdx) {
    S.actionPopupLines     = [title, ...items];
    S.actionPopupHighlight = activeIdx + 1;
    S.actionPopupEndTick   = S.tickCount + ACTION_POPUP_TICKS;
    S.screenDirty = true;
}

function playMetronomeClick() {
    /* DSP handles click audio via render_block; nothing to do here */
}

/* Clear all steps in a clip. clearClip runs in on_midi context and schedules
 * its tN_cC_clear via pendingDefaultSetParams. The drain at tick() bottom
 * fires on the SAME audio buffer as the synchronous set_param fan-out from
 * resetPerClipBankParamsToDefault below — and the host coalesces all of them
 * down to a single survivor, eating the queued _clear. clearDrainHold defers
 * the drain by one tick so _clear lands in a clean buffer. */
function clearClip(t, ac, keepPlaying) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    /* Clip CLEAR semantics (matches drum lane Clear, Group I): wipe step
     * note data only. Preserve length, loop window, ticks_per_step, the
     * destructive CLIP-bank params (stretch_exp / clock_shift_pos /
     * nudge_pos), and per-clip pfx (NOTE FX / HARMONY / DELAY / SEQUENCE
     * ARP). Hard Reset (Shift+Delete) is the gesture that wipes structure. */
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const keep = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t]) ? '1' : '0';
        S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_drum_clear', val: keep });
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
    S.pendingDefaultSetParams.unshift({ key: cmd, val: '1' });
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
function hardResetClip(t, ac) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum clip reset: clip_init all 32 lanes; midi_note preserved */
        S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_drum_reset', val: '1' });
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
    S.pendingDefaultSetParams.unshift({ key: 't' + t + '_c' + ac + '_hard_reset', val: '1' });
    S.clearDrainHold = 1;
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
function copyClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'clip_copy', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
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
function cutClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'clip_cut', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
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
function copyRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_copy', val: `${srcRow} ${dstRow}` });
    for (let t = 0; t < NUM_TRACKS; t++) {
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
function cutRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_cut', val: `${srcRow} ${dstRow}` });
    for (let t = 0; t < NUM_TRACKS; t++) {
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
function copyStep(t, ac, srcAbs, dstAbs) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + lane + '_step_' + srcAbs + '_copy_to', val: String(dstAbs) });
        S.drumLaneSteps[t][lane][dstAbs] = S.drumLaneSteps[t][lane][srcAbs];
        if (S.drumLaneSteps[t][lane][srcAbs] !== '0') S.drumLaneHasNotes[t][lane] = true;
        S.pendingDrumLaneResync      = 2;
        S.pendingDrumLaneResyncTrack = t;
        S.pendingDrumLaneResyncLane  = lane;
    } else {
        S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + ac + '_step_' + srcAbs + '_copy_to', val: String(dstAbs) });
        S.clipSteps[t][ac][dstAbs] = S.clipSteps[t][ac][srcAbs];
        if (S.clipSteps[t][ac][srcAbs] !== 0) S.clipNonEmpty[t][ac] = true;
        S.pendingStepsReread      = 2;
        S.pendingStepsRereadTrack = t;
        S.pendingStepsRereadClip  = ac;
    }
}

/* Copy active clip's lane srcLane to dstLane (same track, preserves dst midi_note). */
function copyDrumLane(t, srcLane, dstLane) {
    if (srcLane === dstLane) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + srcLane + '_copy_to', val: String(dstLane) });
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
function cutDrumLane(t, srcLane, dstLane) {
    if (srcLane === dstLane) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 't' + t + '_l' + srcLane + '_cut_to', val: String(dstLane) });
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
function copyDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'drum_clip_copy', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
    S.drumClipNonEmpty[dstT][dstC] = S.drumClipNonEmpty[srcT][srcC];
    if (dstC === S.trackActiveClip[dstT]) { S.pendingDrumResync = 2; S.pendingDrumResyncTrack = dstT; }
}

/* Cut all 32 lanes of drum_clips[srcC] on srcT into drum_clips[dstC] on dstT; undo dst only. */
function cutDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'drum_clip_cut', val: `${srcT} ${srcC} ${dstT} ${dstC}` });
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
function clearRow(rowIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    S.pendingDefaultSetParams.push({ key: 'row_clear', val: String(rowIdx) });
    for (let t = 0; t < NUM_TRACKS; t++) {
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

/* Disarm real-time recording: clear DSP flag (triggers deferred save), update LED. */
function disarmRecord() {
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
function handoffRecordingToTrack(newTrack) {
    if (!S.recordArmed || S.recordCountingIn || newTrack === S.recordArmedTrack) return;
    const old = S.recordArmedTrack;
    _recordingNoteTrack.clear();
    S.recordArmedTrack      = newTrack;
    if (typeof host_module_set_param === 'function') {
        if (old >= 0) host_module_set_param('t' + old + '_recording', '0');
        host_module_set_param('t' + newTrack + '_recording', '1');
    }
}

function effectiveVelocity(rawVel) { return rawVel; }

/* Step-entry velocity. Single source of truth used by every step-write site.
 *
 * Drum context (allowZone=true, used at drum step-tap sites and the drum
 * vel-pad-while-step-held site): drum vel zones ALWAYS win over VelIn.
 *   active vel-pad press now (liveVel >= 0)  →  zone velocity
 *   sticky vel-zone armed                    →  sticky zone velocity
 *   VelIn engaged                            →  VelIn value
 *   otherwise                                →  100
 *
 * Melodic context (allowZone=false): VelIn wins over pad press.
 *   VelIn engaged                            →  VelIn value
 *   live pad press now (liveVel >= 0)        →  pad press velocity
 *   otherwise                                →  100
 */
function stepEntryVelocity(t, liveVel, allowZone) {
    if (allowZone) {
        if (liveVel >= 0) return liveVel;
        if (S.drumVelZoneArmed && S.drumVelZoneArmed[t])
            return drumVelZoneToVelocity(S.drumLastVelZone[t]);
        const tvo = S.trackVelOverride[t];
        if (tvo > 0) return tvo;
        return 100;
    }
    const tvo = S.trackVelOverride[t];
    if (tvo > 0) return tvo;
    if (liveVel >= 0) return liveVel;
    return 100;
}

function flushChordBatch() {}

/* DSP-side recording: buffer note events; tick() flushes as a single batched set_param so
 * chords (multiple pads hit in the same ~5ms JS tick) are not lost to coalescing. */
const _recordingNoteTrack = new Map(); /* pitch → track index, for matching note-offs */
const extHeldNotes = new Map(); /* pitch → {track, recording} — external MIDI held notes */

function recordNoteOn(pitch, velocity, rt) {
    _recordingNoteTrack.set(pitch, rt);
    S._recNoteOns.push({pitch, vel: velocity, rt});
}

function recordNoteOff(pitch) {
    const rt = _recordingNoteTrack.get(pitch);
    if (rt === undefined) return;
    _recordingNoteTrack.delete(pitch);
    S._recNoteOffs.push({pitch, rt});
}


function openTapTempo() {
    S.tapTempoOpen      = true;
    S.tapTempoTapTimes  = [];
    S.tapTempoBpm       = Math.max(40, Math.min(250, Math.round(parseFloat(host_module_get_param('bpm')) || 120)));
    S.tapTempoFlashTick = -1;
    S.tapTempoFlashPad  = -1;
    computePadNoteMap();
    invalidateLEDCache();
    S.screenDirty = true;
}

function closeTapTempo() {
    S.tapTempoOpen = false;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('bpm', String(S.tapTempoBpm));
    computePadNoteMap();
    invalidateLEDCache();
    S.screenDirty = true;
}

function registerTapTempo(padNote) {
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

/* Save the current S.activeBank into the outgoing track's per-track slot,
 * switch to newT, then restore the new track's stored bank into S.activeBank.
 * Existing post-switch validity checks (e.g. drum-track hidden banks → 0)
 * still apply to the loaded value. Use at every site that assigns S.activeTrack. */
function _switchActiveTrack(newT) {
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
function allLanesGate() {
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed) {
        S.screenDirty = true;
        forceRedraw();
        return true;
    }
    return false;
}

function doDoubleFill() {
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

function doLaneDoubleFill() {
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

/* True when scene-baking at clipIdx should offer "Apply Conductor?":
 * a Conductor exists and its clip at clipIdx has at least one responder On for a
 * non-conductor melodic track (something there is to fold). */
/* conductorTrackIdx moved to ui_state.mjs so ui_export.mjs can import it
 * without an import cycle (it was an unbound global there — audit
 * js-modules-1). Imported at the top of this file. */

function sceneBakeHasConductor(clipIdx) {
    const ct = conductorTrackIdx();
    if (ct < 0) return false;
    const mask = S.condResp[clipIdx | 0];
    if (!mask) return false;
    let t;
    for (t = 0; t < 8; t++) {
        if (t === ct) continue;
        if (S.trackPadMode[t] !== PAD_MODE_MELODIC_SCALE) continue;
        if (mask[t]) return true;
    }
    return false;
}

/* Push the scene-bake set_param and arm post-bake resync. apply=1 folds the
 * Conductor (4th token A) and the DSP auto-disables the conductor clip's
 * responder flags for the baked tracks. */
function commitSceneBake(clipIdx, loops, wrap, apply) {
    S.pendingDefaultSetParams.push({
        key: 'bake_scene',
        val: clipIdx + ' ' + loops + ' ' + (wrap ? 1 : 0) + ' ' + (apply ? 1 : 0)
    });
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    showActionPopup('SCENE', 'BAKED');
    S.pendingSceneBakeResync = 2;
    S.pendingSceneBakeClip   = clipIdx;
    /* DSP cleared the conductor clip's responder flags for the baked tracks.
     * Mirror that locally so the Responder bank UI reflects the auto-disable
     * without waiting for the next full per-clip re-read. */
    const ct = conductorTrackIdx();
    if (apply && ct >= 0) {
        const mask = S.condResp[clipIdx | 0];
        if (mask) {
            for (let t = 0; t < 8; t++) {
                if (t === ct) continue;
                if (S.trackPadMode[t] !== PAD_MODE_MELODIC_SCALE) continue;
                mask[t] = 0;
            }
        }
    }
}

/* ---- Transpose all melodic clips on global Key/Scale change ----------
 * Browsing the Key/Scale menu item arms a live preview (pads relayout +
 * DSP plays clips transposed); the knob-click commits behind a confirm.
 * Committed key/scale stay in S.padKey/S.padScale until commit; the
 * candidate lives in S.xposePrev* while previewing. */

/* Any melodic (non-drum) clip on any track with notes? */
function anyMelodicClipHasContent() {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.trackPadMode[t] === PAD_MODE_DRUM) continue;
        for (let c = 0; c < NUM_CLIPS; c++) if (S.clipNonEmpty[t][c]) return true;
    }
    return false;
}

/* Arm/refresh preview for candidate (candK,candS). Candidate == committed
 * cancels instead (no-op change). Runs from the menu-edit tick driver. */
function xposePreviewSet(candK, candS) {
    if (candK === S.padKey && candS === S.padScale) { xposeCancelPreview(); return; }
    S.xposePrevKey = candK; S.xposePrevScale = candS;
    computePadNoteMap();   /* relayout pads to candidate (also pushes padmap) */
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t0_xpose_prev',
            S.padKey + ' ' + S.padScale + ' ' + candK + ' ' + candS);
    S.screenDirty = true;
}

/* Drop the preview: DSP returns playback to true pitch; pads back to committed.
 * The apply(flag=0) is queued (drained from tick) — set_param fired directly from
 * the onMidi confirm-click path is unreliable/coalesced. */
function xposeCancelPreview() {
    if (S.xposePrevKey === null && S.xposePrevScale === null) return;
    S.xposePrevKey = null; S.xposePrevScale = null;
    S.pendingDefaultSetParams.push({ key: 't0_xpose_apply',
        val: S.padKey + ' ' + S.padScale + ' ' + S.padKey + ' ' + S.padScale + ' 0' });
    computePadNoteMap();
    S.screenDirty = true;
}

/* Commit: bake the transpose into all melodic clips, adopt the new key/scale.
 * The apply(flag=1) is queued (drained from tick — set_param from the onMidi
 * confirm path is unreliable). The DSP bake skips empty clips; on the JS side a
 * transpose changes only note PITCH — step occupancy, lengths, loops and config
 * are unchanged and the pad layout is rebuilt here — so no clip resync is needed
 * (held-step note pitches refresh on the next press). */
function xposeCommit(candK, candS) {
    S.pendingDefaultSetParams.push({ key: 't0_xpose_apply',
        val: S.padKey + ' ' + S.padScale + ' ' + candK + ' ' + candS + ' 1' });
    S.padKey = candK; S.padScale = candS;
    S.xposePrevKey = null; S.xposePrevScale = null;
    computePadNoteMap();
    forceRedraw();
    S.screenDirty = true;
}

/* --------------------------------------------------------------------------- */

/* Root note in pad layout closest to octave 4 — guaranteed in-scale and on a pad. */
function defaultStepNote() {
    const target = S.padKey + 60;  /* root pitch class in MIDI octave 4 */
    let best = -1, bestDist = 999;
    for (let i = 0; i < 32; i++) {
        if (S.padNoteMap[i] === 0xFF) continue;  /* OOB pad — no melodic note */
        const p = S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12;
        if (p < 0 || p > 127) continue;
        if (S.padNoteMap[i] % 12 !== S.padKey) continue;  /* root notes only */
        const d = Math.abs(p - target);
        if (d < bestDist) { bestDist = d; best = p; }
    }
    if (best >= 0) return best;
    /* Fallback: first valid (non-0xFF) entry; if every pad is OOB (shouldn't
     * happen at any sane octave), return middle C. */
    for (let i = 0; i < 32; i++) {
        if (S.padNoteMap[i] === 0xFF) continue;
        return Math.max(0, Math.min(127, S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12));
    }
    return 60;
}


/* Synchronously zero every LED that SEQ8 owns — call before host_hide_module(). */
function clearAllLEDs() {
    let n, c;
    for (n = 68; n <= 99; n++) setLED(n, LED_OFF);
    for (n = 16; n <= 31; n++) setLED(n, LED_OFF);
    for (c = 16; c <= 31; c++) setButtonLED(c, LED_OFF);
    for (c = 40; c <= 43; c++) setButtonLED(c, LED_OFF);
    for (const cc of [49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63])
        setButtonLED(cc, LED_OFF);
    for (c = 71; c <= 78; c++) setButtonLED(c, LED_OFF);
    for (const cc of [85, 86, 88, 118, 119]) setButtonLED(cc, LED_OFF);
}

function installFlagsWrap() {
    if (typeof shadow_get_ui_flags !== 'function') return;
    if (globalThis.shadow_get_ui_flags._seq8) {
        globalThis.shadow_get_ui_flags._active = true;
        return;
    }
    const orig = globalThis.shadow_get_ui_flags;
    const wrap = function () {
        const f = orig();
        const hit = f & SEQ8_NAV_FLAGS;
        if (hit && wrap._active) {
            S.ledInitComplete = false;
            invalidateLEDCache();
            clearAllLEDs();
            if (typeof shadow_clear_ui_flags === 'function') shadow_clear_ui_flags(hit);
            return f & ~SEQ8_NAV_FLAGS;
        }
        return f;
    };
    wrap._seq8   = true;
    wrap._orig   = orig;
    wrap._active = true;
    globalThis.shadow_get_ui_flags = wrap;
}

function removeFlagsWrap() {
    const cur = globalThis.shadow_get_ui_flags;
    if (typeof cur === 'function' && cur._seq8) {
        cur._active = false;
        globalThis.shadow_get_ui_flags = cur._orig;
    }
}

function buildLedInitQueue() {
    const q = [];
    for (let n = 68; n <= 99; n++) q.push({ kind: 'note', id: n });
    for (let n = 16; n <= 31; n++) q.push({ kind: 'note', id: n });
    for (let c = 16; c <= 31; c++) q.push({ kind: 'cc', id: c });
    for (let c = 40; c <= 43; c++) q.push({ kind: 'cc', id: c });
    for (const c of [49, 50, 51, 52, 54, 55, 56, 58, 60, 62, 63])
        q.push({ kind: 'cc', id: c });
    for (let c = 71; c <= 78; c++) q.push({ kind: 'cc', id: c });
    for (const c of [85, 86, 88, 118, 119]) q.push({ kind: 'cc', id: c });
    return q;
}

function drainLedInit() {
    const end = Math.min(S.ledInitIndex + LEDS_PER_FRAME, S.ledInitQueue.length);
    for (let i = S.ledInitIndex; i < end; i++) {
        const led = S.ledInitQueue[i];
        if (led.kind === 'cc') setButtonLED(led.id, LED_OFF);
        else setLED(led.id, LED_OFF);
    }
    S.ledInitIndex = end;
    if (S.ledInitIndex >= S.ledInitQueue.length) {
        S.ledInitComplete = true;
        /* Custom scratch palette entry for the Loop button's ambient LED —
         * Loop's LED renders palette colors brighter than peers (Delete/Copy
         * idx 16 = dim grey; same idx 16 is invisible on Loop, and 124/DarkGrey
         * on Loop reads as fully bright). Push a low-RGB entry before
         * reapplyPalette so the LED hardware picks up index 60 on the refresh. */
        setPaletteEntryRGB(60, 32, 32, 32);
        reapplyPalette();
    }
}

/* Reset NOTE FX, HARMZ, and MIDI DLY banks to DSP defaults for track t.
 * The pfx_reset push itself is deferred via pendingDefaultSetParams — when
 * called from a MIDI handler (jog click), a synchronous push competes with
 * the same-buffer MIDI delivery and is silently coalesced away, leaving DSP
 * with no reset despite the OLED reporting success. The delay_level=127
 * override is queued after the reset so it lands on a later tick (DSP zeros
 * delay_level during the reset). */
function resetFxBanks(t) {
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
function resetTarp(t) {
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

function resetSingleFxBank(t, bankIdx) {
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

/* Convert a track between melodic and drum, translating note content so the
 * music follows the track. The DSP handler (tN_convert_to_drum/_to_melodic)
 * does the data move AND flips pad_mode atomically in a single set_param, so
 * there is no coalescing drop. We then resync JS from DSP — syncClipsFromDsp()'s
 * get_param round-trips double as the audio-thread sync barrier. */
function trackHasAnyData(t) {
    for (let c = 0; c < NUM_CLIPS; c++)
        if (S.clipNonEmpty[t][c] || S.drumClipNonEmpty[t][c]) return true;
    return false;
}

function convertTrackType(t, toDrum) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('t' + t + (toDrum ? '_convert_to_drum' : '_convert_to_melodic'), '1');
    S.trackPadMode[t] = toDrum ? PAD_MODE_DRUM : PAD_MODE_MELODIC_SCALE;
    /* Resync inline (this runs in tick(), so get_param works): the first get
     * in syncClipsFromDsp flushes the queued convert, then reads post-convert
     * state — it also runs the drum-side syncs when the result is a drum track.
     * Empty tracks skip the heavy all-track resync but still need a get_param
     * barrier so the convert set_param drains before computePadNoteMap pushes
     * tN_padmap (without the barrier, same-buffer coalescing drops the convert). */
    if (trackHasAnyData(t)) syncClipsFromDsp();
    else host_module_get_param('t' + t + '_pad_mode');
    if (toDrum) {
        if (t === S.activeTrack && (S.activeBank === 2 || S.activeBank === 4)) S.activeBank = 0;
    } else {
        if (t === S.activeTrack && S.activeBank === 7) S.activeBank = 0;
        /* DSP zeroed active_drum_lane/drum_perform_mode inside the convert
         * handler; only JS-side mirror state needs clearing here. */
        S.drumVelZoneArmed[t] = false;
        S.drumLastVelZone[t]  = 0;
    }
    computePadNoteMap();   /* get_param-free — rebuild pad LEDs immediately */
    invalidateLEDCache();
    forceRedraw();
}

/* Route a track to Conductor. The DSP enforces one-Conductor: if another track
 * already holds the role, the convert handler returns without changing anything.
 * We optimistically flip the local mode, then verify the role next tick via
 * pendingConductReadback to detect (and revert) a refusal. */
function convertTrackToConduct(t) {
    if (typeof host_module_set_param !== 'function') return;
    const prevMode = S.trackPadMode[t];
    host_module_set_param('t' + t + '_convert_to_conduct', '1');
    S.trackPadMode[t] = PAD_MODE_CONDUCT;
    S.pendingConductReadback = { t: t, prevMode: prevMode };
    /* Mirror convertTrackType's drain barrier: the convert set_param must drain
     * before computePadNoteMap pushes tN_padmap, or same-buffer tN_* coalescing
     * drops the convert (DSP never sets the role → false refusal). The first
     * get_param in syncClipsFromDsp flushes the queued convert; empty tracks use
     * a bare get_param barrier. The refusal readback runs in tick() (get_param
     * valid there). */
    if (trackHasAnyData(t)) syncClipsFromDsp();
    else host_module_get_param('t' + t + '_pad_mode');
    computePadNoteMap();
    invalidateLEDCache();
    forceRedraw();
}

/* Open the generic menu INFO dialog with the given text lines (each argument is
 * one line, up to ~4 shown). Empty = closed. */
function showMenuInfo() {
    S.menuInfoLines = Array.prototype.slice.call(arguments);
    S.screenDirty = true;
}

/* Tear down the Keys->Drums confirm dialog and the menu's edit state so a
 * lingering enum edit doesn't replay. Call on Yes, No, and Back-cancel. */
function closeConvertConfirm() {
    S.confirmConvertToDrum = false;
    S.confirmConvertToConduct = false;
    S.menuInfoLines = [];
    if (S.globalMenuState) S.globalMenuState.editing = false;
    if (S.globalMenuState) S.globalMenuState.editValue = null;
    S.lastSentMenuEditValue = null;
    S.bpmWasEditing = false;
}

/* Rewrite the cable-2 channel remap table for the active track.
 * When the active track is ROUTE_MOVE, incoming external MIDI is remapped to the
 * track's channel so Move's firmware routes it to the correct track instrument.
 * Called from tick() on any change to activeTrack/route/channel/midiInChannel,
 * and directly from init() on first load / resume after full exit. */
function applyExtMidiRemap() {
    const t = S.activeTrack;
    const isMove = S.trackRoute[t] === 1;
    const hasRemap = typeof host_ext_midi_remap_enable === 'function';
    if (!hasRemap) return;
    if (!isMove) {
        host_ext_midi_remap_clear();
        for (var _i = 0; _i < 16; _i++) {
            host_ext_midi_remap_set(_i, 254);  /* EXT_MIDI_REMAP_BLOCK */
        }
        host_ext_midi_remap_enable(1);
        S.extMidiRemapActive = false;
        return;
    }
    const outCh = S.trackChannel[t] - 1;  /* 0-indexed */
    host_ext_midi_remap_clear();
    if (S.midiInChannel === 0) {
        for (var _i = 0; _i < 16; _i++) {
            if (_i !== outCh) host_ext_midi_remap_set(_i, outCh);
        }
    } else {
        const inCh = S.midiInChannel - 1;  /* 0-indexed */
        if (inCh !== outCh) host_ext_midi_remap_set(inCh, outCh);
    }
    host_ext_midi_remap_enable(1);
    S.extMidiRemapActive = true;
}

/* Conductor bank knob: knob k edits dAVEBOx track k's per-Conductor-clip value.
 * The Conductor's own track cell is inert. `delta` is signed knob detents.
 * RESPONDER/WHEN are single-fire toggles (any nonzero turn flips the value once);
 * OCTAVE increments/decrements by 1 per detent, clamped -4..+4. The JS mirror is
 * authoritative; we push the absolute new value per-Conductor-clip (tN_* key,
 * reaches DSP reliably; last-wins-per-buffer is correct since we push the final
 * value the mirror tracks). */
function applyConductGridKnob(bank, k, delta) {
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

function extNoteOffAll() {
    if (extHeldNotes.size === 0) return;
    for (const [pitch, info] of extHeldNotes) {
        liveSendNote(info.track, 0x80, pitch, 0);
        if (info.recording) recordNoteOff(pitch);
    }
    extHeldNotes.clear();
}



function sceneAllPlaying(sceneIdx) {
    let hasAny = false;
    if (S.playing) {
        for (let t = 0; t < NUM_TRACKS; t++) {
            if (!S.trackClipPlaying[t]) continue;
            if (S.trackActiveClip[t] !== sceneIdx) return false;
            hasAny = true;
        }
    } else {
        for (let t = 0; t < NUM_TRACKS; t++) {
            if (!S.trackWillRelaunch[t] && S.trackQueuedClip[t] < 0) continue;
            if (effectiveClip(t) !== sceneIdx) return false;
            hasAny = true;
        }
    }
    return hasAny;
}

function sceneAnyPlaying(sceneIdx) {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.trackClipPlaying[t] && S.trackActiveClip[t] === sceneIdx) return true;
    }
    return false;
}






/* Send current combined modifier bitmask to DSP. */
function sendPerfMods() {
    if (typeof host_module_set_param === 'function')
        host_module_set_param('perf_mods', String(S.perfModsToggled | S.perfModsHeld));
}

function fmtHex(b) {
    return (b & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

/* Inherit-picker entry. On first launch in a freshly-pasted Move duplicate
 * (Copy-suffixed name + no canonical state file), check the name index for
 * family members and either auto-inherit (one candidate) or show a picker
 * dialog (two or more). Returns one of:
 *   'auto'   — silently inherited from the single candidate
 *   'picker' — dialog opened, S.pendingInheritPicker set
 *   'blank'  — nothing to inherit; let normal flow proceed */
function maybeShowInheritPicker(uuid, name) {
    if (!uuid || !name) return 'blank';
    if (typeof host_file_exists !== 'function') return 'blank';
    if (host_file_exists(uuidToStatePath(uuid))) return 'blank';
    const idx = S.nameIndexCache || (S.nameIndexCache = loadNameIndex());
    const candidates = findInheritCandidates(name, idx);
    if (candidates.length === 0) return 'blank';
    if (candidates.length === 1) {
        copyStateFiles(candidates[0].uuid, uuid);
        return 'auto';
    }
    S.pendingInheritPicker = {
        dstUuid: uuid,
        dstName: name,
        candidates: candidates,
        selectedIndex: 0
    };
    S.screenDirty = true;
    return 'picker';
}

/* Resolve the inherit picker: action is either the candidates index to
 * inherit from, or -1 for "Start blank". Always trigger pendingSetLoad
 * so DSP runs its state_load handler — which both resets the internal
 * state (clip_init, drum_track_init, etc.) and reads the canonical file.
 * For "Start blank" the file is missing on purpose; the reset alone gives
 * a clean slate. For inherit, we copy the source's state files first so
 * the load reads the seeded content. */
function resolveInheritPicker(action) {
    const p = S.pendingInheritPicker;
    if (!p) return;
    if (action >= 0 && action < p.candidates.length) {
        copyStateFiles(p.candidates[action].uuid, p.dstUuid);
    }
    S.pendingSetLoad = true;
    S.pendingInheritPicker = null;
    S.screenDirty = true;
}

/* Seam registry population — resident helpers still needed by extracted
 * modules (see ui_seams.mjs). IOUs: xposePreviewSet, openTapTempo,
 * disarmRecord → Phase-5b/record module (disarmRecord is called by the
 * bridge's pollDSP on the transport-stop edge). */
R.xposePreviewSet = xposePreviewSet;
R.openTapTempo = openTapTempo;
R.disarmRecord = disarmRecord;

/* --- DIAGNOSTIC (2026-05-23 crash investigation) ---------------------------
 * QuickJS swallows unhandled exceptions thrown inside entry-point callbacks:
 * the module silently stops (presents as a hang/freeze; orphaned audio thread
 * then spins → RT throttle). Wrap the top-level entry points so the NEXT
 * failure writes its error to a file we can pull over ssh instead of vanishing.
 * Deduped by (where|message) → a persistent error writes once (no I/O storm).
 * Errors are swallowed so the module survives. REMOVE once the crash is pinned. */
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
    _lastRemapTrack = -1;
    applyExtMidiRemap();

    S.ledInitComplete = false;
    invalidateLEDCache();
    S.ledInitQueue    = buildLedInitQueue();
    S.ledInitIndex    = 0;

    installFlagsWrap();

    S._origClearScreen = clear_screen;
    S._wasSuspended    = false;
};

var _lastRemapTrack = -1, _lastRemapRoute = -1, _lastRemapChannel = -1, _lastRemapMidiIn = -2;
var _lastSessionView = false;

globalThis.tick = function () { try { _tickImpl(); } catch (e) { captureError('tick', e); } };
function _tickImpl() {
    S.tickCount++;
    if (S.bootSplashTicks > 0) S.bootSplashTicks--;

    /* Lifecycle edge: at suspend/teardown (and transient co-run slot switches)
     * the host can momentarily unbind its param API while an already-queued tick
     * still fires. Every meaningful tick action reads or writes DSP, so there is
     * nothing useful to do without the API — bail rather than throw
     * 'host_module_get_param is not defined' into seq8-jserr.log. */
    if (typeof host_module_get_param !== 'function' ||
        typeof host_module_set_param !== 'function') return;

    /* Ableton .ablbundle export runs here (tick context) so get_param('bpm')
     * resolves — it returns null on the on_midi path where the menu action
     * fires. host_system_cmd blocks for the python packager; transport is
     * stopped (guarded in exportSession) so the brief tick stall is benign. */
    pollPendingExport();

    /* Deferred padmap recompute for leaving-DRUM (see applyTrackConfig
     * else branch). Fire ONLY when the pendingDefaultSetParams queue is
     * empty — otherwise the tN_padmap push would land in the same tick
     * as a queue-drained tN_* push for the same track, and the empirically-
     * observed same-track set_param interference drops the padmap push.
     * (See the val=1 case: it works because syncDrum* get_params between
     * the pad_mode and padmap pushes flush the buffer.) */
    /* Track-type conversion runs here (tick context) so the get_param
     * round-trips inside convertTrackType -> syncClipsFromDsp work — they
     * return null on the on_midi path where the triggers fire. */
    if (S.pendingTrackConvert) {
        const _pc = S.pendingTrackConvert;
        S.pendingTrackConvert = null;
        convertTrackType(_pc.t, _pc.toDrum);
    }

    if (S.pendingConductConvert !== null) {
        const _cct = S.pendingConductConvert;
        S.pendingConductConvert = null;
        convertTrackToConduct(_cct);
    }

    /* Verify the Conductor role landed (or detect a one-Conductor refusal).
     * Runs in tick() so get_param is valid. */
    if (S.pendingConductReadback !== null && typeof host_module_get_param === 'function') {
        const _rb  = S.pendingConductReadback;
        S.pendingConductReadback = null;
        const _raw = host_module_get_param('conductor_track');
        const _ct  = parseInt(_raw, 10);
        const _val = isNaN(_ct) ? -1 : _ct;
        if (_val === _rb.t) {
            /* SUCCESS — the role landed on the requested track. */
            S.conductorTrack = _val;
        } else if (_val >= 0) {
            /* Refused — a different track already holds the role. Revert. */
            S.conductorTrack = _val;
            S.trackPadMode[_rb.t] = _rb.prevMode;
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
            /* Action popups are invisible while the global menu is open (drawUI
             * early-returns into drawGlobalMenu). Use the menu-visible info
             * dialog instead. */
            showMenuInfo('Conductor exists', 'on T' + (_val + 1) + '.', 'Route it back first.');
            S.screenDirty = true;
        } else {
            /* Unexpected — DSP reports no conductor right after convert.
             * Revert the optimistic mode but do NOT show the misleading
             * "exists" popup. */
            S.conductorTrack = _val;
            S.trackPadMode[_rb.t] = _rb.prevMode;
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
    }

    if (S.pendingPadNoteMapRecompute && S.pendingDefaultSetParams.length === 0
            && S.clearDrainHold === 0) {
        S.pendingPadNoteMapRecompute = false;
        computePadNoteMap();
    }

    /* PHASE-1: edge-detect modal pad-dispatch mute changes that aren't
     * caught by explicit hooks (dialogs, ARP-step-edit, knob-touch state).
     * Cheap check — boolean compare. Tick is ~10.6 ms, more than fast
     * enough for non-button-CC modal transitions (dialog open / knob touch). */
    if (S.dspInboundEnabled) {
        const _muted = _padDispatchMutedNow();
        if (_muted !== S.lastPushedMuted) computePadNoteMap();
        /* Self-heal: every 5 ticks (~50ms), read back DSP's pad_dispatch_muted
         * via get_param and re-push the padmap if it diverged from JS truth.
         * Necessary because tN_padmap pushes can be dropped when set_param
         * loses to shadow_send_midi_to_dsp in the same audio buffer (see
         * feedback_set_param_coalescing). Without this, an un-mute push lost
         * to MIDI contention leaves DSP stuck with pad_dispatch_muted=1 and
         * all pads silent until the user happens to gesture a modifier
         * (which retriggers computePadNoteMap). Worst-case stuck pad
         * duration is now ~50ms instead of indefinite. */
        if ((S.tickCount % 5) === 0 && typeof host_module_get_param === 'function') {
            const _dspM = host_module_get_param('pad_dispatch_muted');
            if (_dspM !== null && _dspM !== undefined) {
                const _dspMi = parseInt(_dspM, 10);
                const _jsM = _muted ? 1 : 0;
                if (_dspMi !== _jsM) computePadNoteMap();
            }
            const _dspMap0 = host_module_get_param('pad_note_map_0');
            if (_dspMap0 !== null && _dspMap0 !== undefined) {
                const _dspMap0i = parseInt(_dspMap0, 10);
                const _jsMap0 = _muted && S.sessionView ? 0xFF
                    : Math.max(0, Math.min(127, (S.padNoteMap[0] | 0) +
                        (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM ? 0 : (S.trackOctave[S.activeTrack] | 0) * 12)));
                const _expect = S.padNoteMap[0] === 0xFF ? 255 : _jsMap0;
                if (_dspMap0i !== _expect) computePadNoteMap();
            }
        }
    }

    /* Drain live-note events queued by onMidiMessage handlers since the last
     * tick. One set_param per track per tick — survives same-buffer
     * coalescing of multiple pad presses in one audio buffer. */
    _drainLiveNotes();

    /* Reapply cable-2 channel remap if anything affecting it changed. */
    {
        const _rt = S.activeTrack;
        const _rr = S.trackRoute[_rt];
        const _rc = S.trackChannel[_rt];
        const _rm = S.midiInChannel;
        if (_rt !== _lastRemapTrack || _rr !== _lastRemapRoute ||
                _rc !== _lastRemapChannel || _rm !== _lastRemapMidiIn) {
            /* TARP latch is per-track musical intent — preserved across track/
             * route/channel/MIDI-in changes. Only Stop transport and Delete+Play
             * clear it deliberately. */
            applyExtMidiRemap();
            _lastRemapTrack = _rt; _lastRemapRoute = _rr;
            _lastRemapChannel = _rc; _lastRemapMidiIn = _rm;
        }
    }

    /* Reset TARP latch when entering session view */
    if (S.sessionView && !_lastSessionView) {
        const _t = S.activeTrack;
        if (S.bankParams[_t][5][7] | 0) {
            S.bankParams[_t][5][7] = 0;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + _t + '_tarp_latch', '0');
        }
    }
    /* PHASE-1: session-view edge re-pushes padmap so DSP on_midi gates pad
     * dispatch (session pads launch clips, not notes). Remove with the rest
     * of the PHASE-1 gates when patches upstreamed. */
    if (S.sessionView !== _lastSessionView) {
        computePadNoteMap();
    }
    _lastSessionView = S.sessionView;

    /* Suspend detection: host swaps clear_screen to a no-op while we're parked.
     * Save state on the transition edge; let tick run normally (display is no-oped by host). */
    const isSuspended = S._origClearScreen && (clear_screen !== S._origClearScreen);
    if (isSuspended && !S._wasSuspended) {
        /* saveState() writes the sidecar synchronously and sets
         * pendingSuspendSave — drained at end of this tick (block below).
         * Keeps schema unified with the explicit save paths. */
        saveState();
        removeFlagsWrap();
        if (typeof host_ext_midi_remap_enable === 'function') host_ext_midi_remap_enable(0);
    }
    if (!isSuspended && S._wasSuspended) {
        installFlagsWrap();
        applyExtMidiRemap();
        /* Clear any held-modifier state that may have got stuck on suspend
         * (key-up events fire after overtake exits, so onMidiMessage never sees them). */
        S.shiftHeld = false; S.deleteHeld = false; S.muteHeld = false;
        S.copyHeld  = false; S.loopHeld  = false; S.loopJogActive = false;
        S.captureHeld = false; S.shiftTrackLEDActive = false;
        S.heldStep  = -1;    S.heldStepBtn = -1; S.heldStepNotes = [];
        S.stepWasEmpty = false; S.stepWasHeld = false;
        /* Resuming to full overtake: re-assert sysex suppression (the host clears
         * it in suspendOvertakeMode while we're parked) so Move's clip/grid LEDs
         * don't leak back over ours. */
        assertOvertakeSysexSuppress();
        /* Check if the active set changed while we were parked. */
        const _as = readActiveSet();
        const _dspUuid = (typeof host_module_get_param === 'function')
            ? (host_module_get_param('state_uuid') || '') : '';
        if (_as.uuid && _dspUuid !== _as.uuid) {
            S.currentSetUuid = _as.uuid;
            S.currentSetName = _as.name;
            /* If multiple family candidates, picker opens and state_load is
             * deferred. Otherwise pendingSetLoad is fine to set immediately
             * since the auto-inherit branch (or blank branch) is already done. */
            const _r = maybeShowInheritPicker(_as.uuid, _as.name);
            if (_r !== 'picker') S.pendingSetLoad = true;
        }
        S.ledInitComplete = false;
        invalidateLEDCache();
        S.ledInitQueue = buildLedInitQueue();
        S.ledInitIndex = 0;
        forceRedraw();
    }
    S._wasSuspended = isSuspended;

    /* Metro note-off */
    if (S.metroNoteOffTick >= 0 && S.tickCount >= S.metroNoteOffTick) {
        S.metroNoteOffTick = -1;
        if (typeof move_midi_inject_to_move === 'function')
            move_midi_inject_to_move([0x09, 0x80, 108, 0]);
    }

    /* Drain deferred drum tap note-offs */
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        if (pendingDrumNoteOffs[_t].length === 0) continue;
        const offs = pendingDrumNoteOffs[_t].splice(0);
        for (const pitch of offs) liveSendNote(_t, 0x80, pitch, 0);
    }

    /* Clear CC step-edit active flag once the step is released */
    if (S.ccStepEditActive && S.heldStep < 0)
        S.ccStepEditActive = false;

    /* Deferred CC auto-bits/rest re-read (set from MIDI handlers where get_param
     * is null, e.g. Delete+step whole-step clear). */
    if (S.pendingCCBitsRefresh >= 0 && typeof host_module_get_param === 'function') {
        const _rt = S.activeTrack, _rc = S.pendingCCBitsRefresh;
        S.pendingCCBitsRefresh = -1;
        const _bits = host_module_get_param('t' + _rt + '_c' + _rc + '_cc_auto_bits');
        if (_bits !== null) S.trackCCAutoBits[_rt][_rc] = parseInt(_bits, 10) || 0;
        const _rest = host_module_get_param('t' + _rt + '_c' + _rc + '_cc_rest');
        if (_rest) {
            const _rp = _rest.split(' ');
            for (let _k = 0; _k < 8; _k++) {
                const _rv = parseInt(_rp[_k], 10);
                S.clipCCVal[_rt][_rc][_k] = (_rv >= 0 && _rv <= 127) ? _rv : -1;
            }
        }
        invalidateLEDCache();
    }

    /* Poll the defined output value at the playhead per knob (255 = "—") for the
     * realtime display + knob-LED feedback while the CC bank is visible & playing. */
    if (S.activeBank === 6 && S.playing && !S.sessionView && !S.ccStepEditActive) {
        const _lv = host_module_get_param('t' + S.activeTrack + '_cc_cur_vals');
        if (_lv) {
            const _lp = _lv.split(' ');
            for (let _k = 0; _k < 8 && _k < _lp.length; _k++) {
                const _v = parseInt(_lp[_k], 10);
                S.trackCCLiveVal[S.activeTrack][_k] = (_v >= 0 && _v <= 127) ? _v : -1;
            }
        }
    }

    /* Sch (chain knob) automation routing: poll cc_auto_cur_val for every
     * playing track that has Sch lanes, and push values to chain slots via
     * shadow_set_param. Runs regardless of active bank. */
    /* Sch label fetch: one shadow_get_param per tick to avoid blocking.
     * Triggered on bank-6 entry; fetches param name for each Sch lane. */
    if (S.schLabelFetchLane >= 0 && S.schLabelFetchLane < 8 &&
            typeof shadow_get_param === 'function') {
        const _ft = S.activeTrack;
        const _fk = S.schLabelFetchLane;
        S.schLabelFetchLane++;
        if (S.trackCCType[_ft][_fk] === 2) {
            const _slot = schSlotForTrack(_ft);
            if (_slot >= 0) {
                const _name = shadow_get_param(_slot, 'knob_' + S.trackCCAssign[_ft][_fk] + '_param');
                S.schLabel[_ft][_fk] = _name || null;
            }
        }
        if (S.schLabelFetchLane >= 8) S.schLabelFetchLane = -1;
        S.screenDirty = true;
    }

    /* CC-bank step-LED gradient palette: 6 white brightness levels (the playhead
     * uses the track color instead). Written on bank-6 entry / track switch
     * (not per frame); the step LEDs themselves are driven in updateStepLEDs. */
    if (S.activeBank === 6 && !S.sessionView &&
            S.ccGradPaletteTrack !== S.activeTrack) {
        S.ccGradPaletteTrack = S.activeTrack;
        for (let _l = 0; _l < CC_GRADIENT_LEVELS; _l++) {
            const _w = Math.round(255 * CC_GRADIENT_SCALARS[_l]);
            setPaletteEntryRGB(CC_GRADIENT_BASE + _l, _w, _w, _w);
        }
        reapplyPalette();
        setButtonLED(MovePlay,   S.playing ? Green : LED_OFF, true);
        setButtonLED(MoveRec,    (S.recordArmed || S.recordScheduledStop) ? Red : LED_OFF, true);
        setButtonLED(MoveSample, S.dspMergeState >= 2 ? Green : S.dspMergeState === 1 ? Red : LED_OFF, true);
        /* reapplyPalette reset the buttonCache — force-resend the 8 knob LEDs
         * next render (their stopped-state named colors would otherwise be
         * silently dropped) and the step LEDs. */
        S._forceKnobReemit = true;
        invalidateLEDCache();
    }

    /* Phase 1 / Bundle 2C-Rpt1: pendingRepeatLane queue removed. Lane swap
     * while holding a rate pad is now fired immediately on press from the
     * lane-pad branch in _onPadPress (different set_param key from the
     * other lane-pad pushes — no coalescing). */


    /* Set change detected in init(): send UUID so DSP constructs path and loads.
     * Suppressed while the inherit picker is open — state_load fires only
     * after the user picks a source (or "Start blank"). */
    if (S.pendingSetLoad && !S.pendingInheritPicker && typeof host_module_set_param === 'function') {
        S.pendingSetLoad = false;
        S.stateLoading = true;
        disarmRecord();
        S.heldStep = -1; S.heldStepBtn = -1; S.heldStepNotes = []; S.stepWasEmpty = false; S.stepWasHeld = false;
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqLastClip = -1;
        S.pendingDspSync = 5;
        host_module_set_param('state_load', S.currentSetUuid || '');
    }

    /* Drain first-run default set_params one per tick, after state is fully settled.
     * clearDrainHold defers the drain past the on_midi-context buffer where
     * a clearClip caller fired synchronous set_params (see clearClip comment). */
    if (S.clearDrainHold > 0) S.clearDrainHold--;
    else if (S.pendingDefaultSetParams.length > 0 && !S.pendingSetLoad && S.pendingDspSync === 0
            && typeof host_module_set_param === 'function') {
        const _dp = S.pendingDefaultSetParams.shift();
        host_module_set_param(_dp.key, _dp.val);
    }

    /* Poll every 100 ticks (~0.5s): detect DSP hot-reload via instance nonce. */
    if ((S.tickCount % 100) === 0 && typeof host_module_get_param === 'function' &&
            typeof host_module_set_param === 'function') {
        const newInstanceId = host_module_get_param('instance_id');
        if (newInstanceId && S.lastDspInstanceId !== '' && newInstanceId !== S.lastDspInstanceId) {
            pollDSP();
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.trackCurrentPage[_t] = Math.max(0, Math.floor(S.trackCurrentStep[_t] / 16));
            syncClipsFromDsp();
            syncMuteSoloFromDsp();
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
        if (newInstanceId) S.lastDspInstanceId = newInstanceId;
    }

    /* Deferred resync after set change: wait ~5 ticks for state_load to land on audio thread. */
    if (S.pendingDspSync > 0) {
        S.pendingDspSync--;
        if (S.pendingDspSync === 0) {
            pollDSP();
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.trackCurrentPage[_t] = Math.max(0, Math.floor(S.trackCurrentStep[_t] / 16));
            syncClipsFromDsp();
            syncMuteSoloFromDsp();
            /* Restore the Conductor role from DSP. syncClipsFromDsp ->
             * readTrackConfig already reads t<idx>_pad_mode (PAD_MODE_CONDUCT=2
             * preserved, not clamped), but S.conductorTrack is not derived from
             * any per-track read — pull it from the conductor_track get_param so
             * a reloaded set isn't desynced (white color, inert Channel/Route).
             * Runs here (tick context) where get_param is valid. */
            if (typeof host_module_get_param === 'function') {
                const _ct = parseInt(host_module_get_param('conductor_track'), 10);
                if (!isNaN(_ct) && _ct >= 0 && _ct < NUM_TRACKS) {
                    S.conductorTrack = _ct;
                    S.trackPadMode[_ct] = PAD_MODE_CONDUCT;
                    /* Pull the Conductor's per-clip bank values back from DSP.
                     * get_param is valid here (tick/sync context) but NOT in
                     * onMidiMessage. Read all 16 clips once on load/resume so the
                     * full per-clip mirror (condResp/condWhen/condOct) is hot —
                     * later clip switches just re-point S.condActiveClip and need
                     * no DSP reads at all. Mirror the active clip into
                     * S.condActiveClip (the clip whose values the OLED grid
                     * renders). GET shapes (Task 2.1): _cond_resp / _cond_when =
                     * 8-char '0'/'1' strings; _cond_oct = 8 space-separated
                     * signed ints. */
                    S.condActiveClip = S.trackActiveClip[_ct] | 0;
                    for (let _c = 0; _c < NUM_CLIPS; _c++) {
                        const _resp = host_module_get_param('t' + _ct + '_c' + _c + '_cond_resp');
                        const _when = host_module_get_param('t' + _ct + '_c' + _c + '_cond_when');
                        const _oct  = host_module_get_param('t' + _ct + '_c' + _c + '_cond_oct');
                        if (typeof _resp === 'string' && _resp.length >= NUM_TRACKS) {
                            for (let _k = 0; _k < NUM_TRACKS; _k++)
                                S.condResp[_c][_k] = (_resp.charAt(_k) === '1') ? 1 : 0;
                        }
                        if (typeof _when === 'string' && _when.length >= NUM_TRACKS) {
                            for (let _k = 0; _k < NUM_TRACKS; _k++)
                                S.condWhen[_c][_k] = (_when.charAt(_k) === '1') ? 1 : 0;
                        }
                        if (typeof _oct === 'string' && _oct.length > 0) {
                            const _op = _oct.split(' ');
                            for (let _k = 0; _k < NUM_TRACKS && _k < _op.length; _k++) {
                                const _ov = parseInt(_op[_k], 10);
                                if (!isNaN(_ov)) S.condOct[_c][_k] = _ov;
                            }
                        }
                        /* CdLk: single 0/1 per clip. */
                        const _clk = host_module_get_param('t' + _ct + '_c' + _c + '_cond_lock');
                        S.condLock[_c] = (_clk === '1' || _clk === 1) ? 1 : 0;
                    }
                } else {
                    S.conductorTrack = -1;
                }
            }
            restoreUiSidecar(true);
            computePadNoteMap();
            S.stateLoading = false;
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Deferred Move co-run entry inject — see enterMoveNativeCoRun(). Fire the
     * track-button press now that the shim's co-run path is active, so Move's
     * track + knob LED repaint passes through to hardware instead of being stripped. */
    if (S.pendingMoveCoRunInject > 0) {
        S.pendingMoveCoRunInject--;
        if (S.pendingMoveCoRunInject === 0 && S.moveCoRunTrack >= 0) {
            const ch = S.trackChannel[S.moveCoRunTrack] | 0;
            if (ch >= 1 && ch <= 4) {
                const coCC = 44 - ch;  /* ch 1 -> CC 43 (Track 1) ... ch 4 -> CC 40 (Track 4) */
                /* Reliable landing: alternate a neighbor track-button with the
                 * co-run track, ending on the co-run track (twice), so Move
                 * definitively selects + shows the routed track. Each neighbor->co-run
                 * transition forces a fresh selection; the doubled co-run tail covers
                 * a missed/coalesced final press. Well-spaced (gap below) so Move
                 * processes each as a distinct press. */
                const nb = (coCC === 43) ? 42 : 43;  /* any track button != co-run */
                S.moveCoRunPressQueue = [nb, coCC, nb, coCC];
                S.moveCoRunPressGap = 0;
            }
        }
    }
    /* Drain the co-run track-button press sequence (Option B full-row repaint):
     * one injected press every few ticks until the queue empties. Prefix each
     * press with a defensive Shift-off (CC 49=0) — Move firmware's internal
     * Shift state can be ambiguous when a tool entered co-run via Shift+Step
     * (the physical Shift release was zeroed shim-side in non-co-run mode, so
     * Move never saw it), and a plain track-button press with Shift "held"
     * lands on Move's track-routing menu instead of the preset editor. */
    if (S.moveCoRunPressQueue && S.moveCoRunPressQueue.length > 0 &&
            typeof move_midi_inject_to_move === 'function') {
        if (S.moveCoRunPressGap > 0) {
            S.moveCoRunPressGap--;
        } else {
            const cc = S.moveCoRunPressQueue.shift();
            move_midi_inject_to_move([0x0B, 0xB0, 49, 0]);    /* Shift off (defensive) */
            move_midi_inject_to_move([0x0B, 0xB0, cc, 127]);
            move_midi_inject_to_move([0x0B, 0xB0, cc, 0]);
            S.moveCoRunPressGap = 5;
        }
    }

    /* Deferred targeted re-sync after undo/redo: re-read only the affected clip(s). */
    if (S.pendingUndoSync > 0) {
        S.pendingUndoSync--;
        if (S.pendingUndoSync === 0) {
            const _info = host_module_get_param('last_restore');
            syncClipsTargeted(_info);
            /* apply_clip_restore clears tr->recording on the DSP side; re-establish it.
             * Also flush stale JS note buffers since DSP called finalize_pending_notes. */
            if (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack >= 0) {
                _recordingNoteTrack.clear();
                S._recNoteOns.length   = 0;
                S._recNoteOffs.length  = 0;
                _drumRecNoteOns.length  = 0;
                _drumRecNoteOffs.length = 0;
                host_module_set_param('t' + S.recordArmedTrack + '_recording', '1');
            }
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Deferred _steps re-read after _reassign: confirm DSP move in JS mirror */
    if (S.pendingAllLanesStretchCheck >= 0) {
        const _sat = S.pendingAllLanesStretchCheck;
        S.pendingAllLanesStretchCheck = -1;
        const _res = host_module_get_param('t' + _sat + '_all_lanes_stretch_result');
        if (_res !== null && parseInt(_res, 10) === -1) {
            showActionPopup('NO ROOM');
            S.bankParams[_sat][7][1] -= (S.knobLastDir[1] || 1);
        }
    }
    if (S.allLanesQntResetTick >= 0 && S.tickCount >= S.allLanesQntResetTick) {
        S.bankParams[S.allLanesQntResetTrack][7][3] = -1;
        S.allLanesQntResetTick  = -1;
        S.allLanesQntResetTrack = -1;
        S.screenDirty = true;
    }
    if (S.allLanesResResetTick >= 0 && S.tickCount >= S.allLanesResResetTick) {
        S.bankParams[S.allLanesResResetTrack][7][0] = -1;
        S.allLanesResResetTick  = -1;
        S.allLanesResResetTrack = -1;
        S.screenDirty = true;
    }
    if (S.allLanesDirResetTick >= 0 && S.tickCount >= S.allLanesDirResetTick) {
        S.bankParams[S.allLanesDirResetTrack][7][6] = -1;
        S.allLanesDirResetTick  = -1;
        S.allLanesDirResetTrack = -1;
        S.screenDirty = true;
    }
    if (S.pendingDrumResync > 0) {
        S.pendingDrumResync--;
        if (S.pendingDrumResync === 0) {
            syncDrumClipContent(S.pendingDrumResyncTrack);
            syncDrumLanesMeta(S.pendingDrumResyncTrack);
            syncDrumLaneSteps(S.pendingDrumResyncTrack, S.activeDrumLane[S.pendingDrumResyncTrack]);
            forceRedraw();
        }
    }
    /* Drain the record-off resend (see disarmRecord): re-asserts recording=0 for
     * a few ticks so a disarm coalesced in one audio buffer can't strand
     * recording=1 (which floods the automation lane). Idempotent DSP-side. The
     * re-arm guard stops the resend if recording is armed again in the window. */
    if (S.recOffTicks > 0 && S.recOffTrack >= 0) {
        if (S.recordArmed) {
            S.recOffTicks = 0; S.recOffTrack = -1;
        } else {
            S.recOffTicks--;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + S.recOffTrack + '_recording', '0');
            if (S.recOffTicks <= 0) S.recOffTrack = -1;
        }
    }
    if (S.pendingDrumLaneResync > 0) {
        S.pendingDrumLaneResync--;
        if (S.pendingDrumLaneResync === 0) {
            const _drT = S.pendingDrumLaneResyncTrack;
            const _drL = S.pendingDrumLaneResyncLane;
            syncDrumLaneSteps(_drT, _drL);
            /* Also refresh per-lane bank params (NOTE FX, DELAY, Repeat Groove)
             * so post-reset and post-mutation pfx values reflect DSP. Without
             * this, Lane Reset would leave NOTE FX/DELAY mirrors showing the
             * pre-reset values until the next track switch. */
            refreshDrumLaneBankParams(_drT, _drL);
            forceRedraw();
        }
    }
    if (S.pendingStepsReread > 0) {
        S.pendingStepsReread--;
        if (S.pendingStepsReread === 0) {
            const prt  = S.pendingStepsRereadTrack;
            const prac = S.pendingStepsRereadClip;
            const bulk = host_module_get_param('t' + prt + '_c' + prac + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let rs = 0; rs < NUM_STEPS; rs++)
                    S.clipSteps[prt][prac][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
                S.clipNonEmpty[prt][prac] = clipHasContent(prt, prac);
            }
            const _plen = host_module_get_param('t' + prt + '_c' + prac + '_length');
            if (_plen !== null && _plen !== undefined) S.clipLength[prt][prac] = parseInt(_plen, 10) || 16;
            const _ptps = host_module_get_param('t' + prt + '_c' + prac + '_tps');
            if (_ptps !== null && _ptps !== undefined) {
                const _tv = parseInt(_ptps, 10);
                S.clipTPS[prt][prac] = TPS_VALUES.indexOf(_tv) >= 0 ? _tv : 24;
            }
            if (prac === S.trackActiveClip[prt]) refreshPerClipBankParams(prt);
            forceRedraw();
        }
    }
    if (S.pendingSceneBakeResync > 0) {
        S.pendingSceneBakeResync--;
        if (S.pendingSceneBakeResync === 0) {
            const sc = S.pendingSceneBakeClip;
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                    if (S.trackActiveClip[_t] === sc) {
                        syncDrumClipContent(_t);
                        syncDrumLanesMeta(_t);
                        syncDrumLaneSteps(_t, S.activeDrumLane[_t]);
                    }
                } else {
                    const bulk = host_module_get_param('t' + _t + '_c' + sc + '_steps');
                    if (bulk && bulk.length >= NUM_STEPS) {
                        for (let rs = 0; rs < NUM_STEPS; rs++)
                            S.clipSteps[_t][sc][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
                        S.clipNonEmpty[_t][sc] = clipHasContent(_t, sc);
                    }
                    const _plen = host_module_get_param('t' + _t + '_c' + sc + '_length');
                    if (_plen !== null && _plen !== undefined) S.clipLength[_t][sc] = parseInt(_plen, 10) || 16;
                    const _ptps = host_module_get_param('t' + _t + '_c' + sc + '_tps');
                    if (_ptps !== null && _ptps !== undefined) {
                        const _tv = parseInt(_ptps, 10);
                        S.clipTPS[_t][sc] = TPS_VALUES.indexOf(_tv) >= 0 ? _tv : 24;
                    }
                    if (sc === S.trackActiveClip[_t]) refreshPerClipBankParams(_t);
                }
            }
            forceRedraw();
        }
    }

    /* pendingClearLength drain removed (Group B): Clip Clear now preserves
     * length and loop window so the deferred length=16 reset is no longer
     * needed. The pendingClearLengthTrack/Clip fields are kept in ui_state
     * defaults (-1) but no setter remains. */

    /* Refresh step LEDs while drum repeat is recording into the active lane */
    if (S.recordArmed && S.playing && !S.sessionView &&
            S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM &&
            (S.drumRepeatHeldPad[S.activeTrack] >= 0 || S.drumRepeat2HeldLanes[S.activeTrack].size > 0 || S.drumRepeat2LatchedLanes[S.activeTrack].size > 0)) {
        syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
        forceRedraw();
    }

    /* Real-time preview while editing any global menu parameter.
     * Only send set_param when the edit value actually changes — avoids flooding
     * the DSP param queue (which would starve tN_launch_clip / transport commands). */
    if (S.globalMenuOpen && S.globalMenuState && S.globalMenuItems) {
        const item = S.globalMenuItems[S.globalMenuState.selectedIndex];
        if (item && S.globalMenuState.editing && S.globalMenuState.editValue !== null) {
            if (item.set && S.globalMenuState.editValue !== S.lastSentMenuEditValue) {
                item.set(S.globalMenuState.editValue);
                S.lastSentMenuEditValue = S.globalMenuState.editValue;
                S.screenDirty = true;
            }
            S.bpmWasEditing = true;
        } else if (S.bpmWasEditing && !S.globalMenuState.editing) {
            if (item && item.set && item.get) item.set(item.get());
            S.bpmWasEditing = false;
            S.lastSentMenuEditValue = null;
        }
    }

    /* Transpose preview self-heal: cancel a stranded preview/dialog if we've left
     * the Key/Scale edit by any path the edit-exit hook above doesn't cover (whole
     * menu closed, navigated away). */
    if (S.xposePrevKey !== null || S.confirmXpose) {
        const _it = (S.globalMenuOpen && S.globalMenuState && S.globalMenuItems)
                    ? S.globalMenuItems[S.globalMenuState.selectedIndex] : null;
        const _onKeyScale = !!(_it && S.globalMenuState.editing &&
                               (_it.label === 'Key' || _it.label === 'Scale'));
        if (S.confirmXpose) {
            /* dialog stranded by Back / menu close (Back isn't a jog-click) → cancel */
            if (!_onKeyScale) { S.confirmXpose = false; xposeCancelPreview(); }
        } else if (!_onKeyScale) {
            xposeCancelPreview();
        }
    }


    if (!S.ledInitComplete) {
        drainLedInit();
    } else {
        /* Bank select display timeout: State 3 → State 4 after ~2000ms */
        if (S.bankSelectTick >= 0 && (S.tickCount - S.bankSelectTick) >= BANK_DISPLAY_TICKS) {
            S.bankSelectTick = -1;
            S.screenDirty = true;
        }
        /* Overlay expiry: clear timer here so drawUI() can gate on flag alone */
        if (S.stretchBlockedEndTick >= 0 && S.tickCount >= S.stretchBlockedEndTick) {
            S.stretchBlockedEndTick = -1;
            S.screenDirty = true;
        }
        if (S.actionPopupEndTick >= 0 && S.tickCount >= S.actionPopupEndTick) {
            S.actionPopupEndTick = -1;
            S.screenDirty = true;
        }
        if (S.knobTouched >= 0 && S.knobTurnedTick[S.knobTouched] >= 0 &&
                (S.tickCount - S.knobTurnedTick[S.knobTouched]) >= KNOB_TURN_HIGHLIGHT_TICKS) {
            S.knobTouched = -1;
            S.screenDirty = true;
        }
        if (S.noNoteFlashEndTick >= 0 && S.tickCount >= S.noNoteFlashEndTick) {
            S.noNoteFlashEndTick = -1;
            S.screenDirty = true;
        }
        if (S.stepSaveFlashEndTick >= 0 && S.tickCount >= S.stepSaveFlashEndTick) {
            S.stepSaveFlashEndTick   = -1;
            S.stepSaveFlashStartTick = -1;
        }
        /* Session view hold-to-save: fire exactly when threshold reached, not on release */
        if (S.sessionStepHeld >= 0) {
            const _ssh = S.sessionStepHeld;
            if (S.tickCount - S.stepBtnPressedTick[_ssh] >= STEP_SAVE_HOLD_TICKS) {
                const _ctx = S.sessionStepHeldCtx;
                S.sessionStepHeld    = -1;
                S.sessionStepHeldCtx = 0;
                S.stepBtnPressedTick[_ssh] = -1;
                if (_ctx === 1) {
                    S.perfSnapshots[_ssh] = S.perfModsToggled | S.perfModsHeld;
                    showActionPopup('PERF PRESET', 'SAVED');
                } else {
                    const drumEffMutes = [];
                    for (let _t = 0; _t < NUM_TRACKS; _t++) {
                        const mMask = S.drumLaneMute[_t];
                        const sMask = S.drumLaneSolo[_t];
                        let effMask = mMask;
                        if (sMask) {
                            let notSoloed = 0;
                            for (let _l = 0; _l < DRUM_LANES; _l++) {
                                if (!(sMask & (1 << _l))) notSoloed |= (1 << _l);
                            }
                            effMask = (mMask | notSoloed) >>> 0;
                        }
                        drumEffMutes.push(effMask >>> 0);
                    }
                    S.snapshots[_ssh] = { mute: S.trackMuted.slice(), solo: S.trackSoloed.slice(), drumEffMute: drumEffMutes };
                    const mStr = S.trackMuted.map(function(m) { return m ? '1' : '0'; }).join(' ');
                    const sStr = S.trackSoloed.map(function(s) { return s ? '1' : '0'; }).join(' ');
                    const dStr = drumEffMutes.join(' ');
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('snap_save', _ssh + ' ' + mStr + ' ' + sStr + ' ' + dStr);
                    showActionPopup('MUTE STATE', 'SAVED');
                }
                S.stepSaveFlashStartTick = S.tickCount;
                S.stepSaveFlashEndTick   = S.tickCount + STEP_SAVE_FLASH_TICKS;
                forceRedraw();
            }
        }

        if ((S.tickCount % POLL_INTERVAL) === 0) { pollDSP(); S.screenDirty = true; }

        /* Schwung co-run: refresh the channel-matched slot bitmask for the
         * side-button blink (shadow_get_slots is a cheap shared-memory read;
         * gate to the poll cadence to match the LED force cadence). */
        if (S.schwungCoRunSlot >= 0 && (S.tickCount % POLL_INTERVAL) === 0) {
            S._coRunChanSlots = schSlotsForTrack(S.activeTrack);
        }

        /* Deferred Schwung co-run entry (queued by openSchwungSlotEditor). Resolve
         * the slot(s) the track plays through and open the first (lowest-index)
         * match. No match → show a "NO SLOT" popup, wait ~1s so it's readable
         * before the chain editor takes the OLED, then fall back to slot 1. */
        if (S.pendingSchwungCoRunTrack >= 0) {
            const _t = S.pendingSchwungCoRunTrack;
            if (S.schwungCoRunSlot >= 0 || _t !== S.activeTrack) {
                /* Already in co-run, or the user navigated to another track while a
                 * no-match entry was waiting out its popup — drop the queued entry
                 * rather than hijacking the OLED for a track they left. (Both entry
                 * paths queue S.activeTrack, so _t != activeTrack means a switch.) */
                S.pendingSchwungCoRunTrack = -1;
                S.pendingSchwungCoRunDelay = 0;
            } else if (S.pendingSchwungCoRunDelay > 0) {
                if (--S.pendingSchwungCoRunDelay === 0) {
                    S.pendingSchwungCoRunTrack = -1;
                    enterSchwungCoRun(_t, 0);  /* slot 1 fallback after the NO SLOT popup */
                }
            } else {
                const _msk = schSlotsForTrack(_t);
                if (_msk === 0) {
                    showActionPopup('NO SLOT', 'CH ' + (S.trackChannel[_t] | 0));
                    /* Enter right as the popup expires so there's no gap where the
                     * normal UI flashes before the editor takes the OLED. */
                    S.pendingSchwungCoRunDelay = ACTION_POPUP_TICKS;
                } else {
                    S.pendingSchwungCoRunTrack = -1;
                    S._coRunChanSlots = _msk;  /* seed the blink mask so it's right on frame 1 */
                    let _slot = 0;
                    while (_slot < 4 && !(_msk & (1 << _slot))) _slot++;
                    enterSchwungCoRun(_t, _slot);
                }
            }
        }

        /* Metro beat detection: checked every tick via dedicated get_param for minimal jitter */
        if (S.metronomeOn > 0) {
            const _mbcRaw = host_module_get_param('metro_beat_count');
            if (_mbcRaw !== null && _mbcRaw !== undefined) {
                const _mbc = parseInt(_mbcRaw, 10) | 0;
                if (_mbc !== S.metroPrevBeat) {
                    S.metroPrevBeat = _mbc;
                    playMetronomeClick();
                    if (S.recordCountingIn) S.countInBeatStartTick = S.tickCount;
                }
            }
        }

        /* Step hold threshold: once elapsed, close the tap window so release won't toggle.
         * Also auto-assign empty step now so knobs work immediately in step edit. */
        if (S.heldStep >= 0 && S.heldStepBtn >= 0 && S.stepBtnPressedTick[S.heldStepBtn] >= 0 &&
                (S.tickCount - S.stepBtnPressedTick[S.heldStepBtn]) >= STEP_HOLD_TICKS) {
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            if (S.activeBank === 6) {
                /* CC step-edit: seed from the recorded point at this step (or "—"),
                 * plus the computed output value the lane produces there. The first
                 * knob-turn writes from the recorded point if set; otherwise it starts
                 * from the step's interpolated value (what the lane already outputs
                 * there), so inserting a new breakpoint continues the existing curve
                 * instead of jumping to 0. Falls back to clip resting value, else 0. */
                const _t6 = S.activeTrack, _c6 = effectiveClip(_t6);
                const _info = (typeof host_module_get_param === 'function')
                    ? host_module_get_param('t' + _t6 + '_c' + _c6 + '_ccstepinfo_' + S.heldStep) : null;
                const _ip = _info ? _info.split(' ') : [];
                for (let _ck = 0; _ck < 8; _ck++) {
                    const _pv = _ip.length > _ck     ? parseInt(_ip[_ck], 10)     : -1;
                    const _cv = _ip.length > _ck + 8 ? parseInt(_ip[_ck + 8], 10) : -1;
                    S.ccStepEditSet[_ck]      = _pv >= 0;
                    S.ccStepEditComputed[_ck] = (_cv >= 0 && _cv <= 127) ? _cv : -1;
                    const _rest = S.clipCCVal[_t6][_c6][_ck];
                    S.ccStepEditVal[_ck] = _pv >= 0 ? _pv
                        : (_cv >= 0 && _cv <= 127 ? _cv
                           : (_rest >= 0 ? _rest : 0));
                }
                S.screenDirty = true;
            } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Drum: auto-assign empty step so knobs work immediately */
                if (S.stepWasEmpty && S.heldStepNotes.length === 0 && typeof host_module_set_param === 'function') {
                    const t    = S.activeTrack;
                    const lane = S.activeDrumLane[t];
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_toggle', String(S.stepEditVel));
                    S.drumLaneSteps[t][lane][S.heldStep] = '1';
                    S.drumLaneHasNotes[t][lane] = true;
                    S.heldStepNotes = [S.drumLaneNote[t][lane]];
                    if (typeof host_module_get_param === 'function') {
                        const rv = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel');
                        const rg = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate');
                        const rn = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge');
                        const ri = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_iter');
                        const rr = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_rand');
                        const rx = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_ratch');
                        S.stepEditVel   = rv !== null ? parseInt(rv, 10) : S.stepEditVel;
                        S.stepEditGate  = rg !== null ? parseInt(rg, 10) : (S.drumLaneTPS[t] || 24);
                        S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                        S.stepEditIter  = ri !== null ? parseInt(ri, 10) : 0;
                        S.stepEditRand  = rr !== null ? parseInt(rr, 10) : 0;
                        S.stepEditRatch = rx !== null ? parseInt(rx, 10) : 0;
                    }
                } else if (S.drumHeldReadPending && typeof host_module_get_param === 'function') {
                    /* Occupied drum step: the press handler couldn't read the
                     * step's real vel/gate/nudge/iter/rand/ratch (get_param
                     * null in MIDI context) — read them now from tick context
                     * so inspect-only holds don't clobber velocity with the
                     * placeholder 100 at release (audit js-input-2). */
                    const t    = S.activeTrack;
                    const lane = S.activeDrumLane[t];
                    const rv = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel');
                    const rg = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate');
                    const rn = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge');
                    const ri = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_iter');
                    const rr = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_rand');
                    const rx = host_module_get_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_ratch');
                    S.stepEditVel   = rv !== null ? parseInt(rv, 10) : S.stepEditVel;
                    S.stepEditGate  = rg !== null ? parseInt(rg, 10) : S.stepEditGate;
                    S.stepEditNudge = rn !== null ? parseInt(rn, 10) : S.stepEditNudge;
                    S.stepEditIter  = ri !== null ? parseInt(ri, 10) : S.stepEditIter;
                    S.stepEditRand  = rr !== null ? parseInt(rr, 10) : S.stepEditRand;
                    S.stepEditRatch = rx !== null ? parseInt(rx, 10) : S.stepEditRatch;
                    S.drumHeldReadPending = false;
                }
                S.screenDirty = true;
            } else if (!S.stepWasEmpty && S.heldStepNotes.length === 0) {
                /* Non-empty step — notes not yet read (get_param null at press time).
                 * Read now from tick context where get_param works. */
                const ac_h2 = effectiveClip(S.activeTrack);
                const raw_h2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_notes') : null;
                S.heldStepNotes = (raw_h2 && raw_h2.trim().length > 0)
                    ? raw_h2.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                    : [];
                const rv2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_vel') : null;
                const rg2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_gate') : null;
                const rn2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_nudge') : null;
                const ri2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_iter') : null;
                const rr2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_rand') : null;
                const rx2 = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h2 + '_step_' + S.heldStep + '_ratch') : null;
                S.stepEditVel   = rv2 !== null ? parseInt(rv2, 10) : 100;
                S.stepEditGate  = rg2 !== null ? parseInt(rg2, 10) : 12;
                S.stepEditNudge = rn2 !== null ? parseInt(rn2, 10) : 0;
                S.stepEditIter  = ri2 !== null ? parseInt(ri2, 10) : 0;
                S.stepEditRand  = rr2 !== null ? parseInt(rr2, 10) : 0;
                S.stepEditRatch = rx2 !== null ? parseInt(rx2, 10) : 0;
                S.screenDirty = true;
            } else if (S.stepWasEmpty && S.heldStepNotes.length === 0) {
                /* Empty melodic step held past threshold: auto-activate with
                 * lastPlayedNote so step edit knobs work in one gesture (mirrors
                 * the drum-mode auto-assign above and the tap-empty path at
                 * ~L8589). If no lastPlayedNote, fall back to no-note flash. */
                if (S.activeBank === 6) {
                    /* CC bank: no note auto-assign */
                } else if (S.lastPlayedNote >= 0 && typeof host_module_set_param === 'function') {
                    const ac_he       = effectiveClip(S.activeTrack);
                    const assignNote  = S.lastPlayedNote;
                    const assignVel   = stepEntryVelocity(S.activeTrack, -1, false);
                    host_module_set_param('t' + S.activeTrack + '_c' + ac_he + '_step_' + S.heldStep + '_toggle',
                                          assignNote + ' ' + assignVel);
                    S.clipSteps[S.activeTrack][ac_he][S.heldStep] = 1;
                    S.clipNonEmpty[S.activeTrack][ac_he] = true;
                    S.heldStepNotes = [assignNote];
                    S.stepEditVel   = assignVel;
                    S.stepWasEmpty  = false;
                    refreshSeqNotesIfCurrent(S.activeTrack, ac_he, S.heldStep);
                } else {
                    S.noNoteFlashEndTick = S.tickCount + NO_NOTE_FLASH_TICKS;
                }
                S.screenDirty = true;
            }
        }

        /* Chord-first phase 2: replace notes with full chord — fires the tick AFTER phase 1.
         * Must come before phase 1 so both can't fire in the same tick and coalesce. */
        if (S.pendingChordPhase2 !== null) {
            const _cp2 = S.pendingChordPhase2;
            if (_cp2.pitches.length > 1 && typeof host_module_set_param === 'function') {
                host_module_set_param('t' + _cp2.t + '_c' + _cp2.ac + '_step_' + _cp2.step + '_set_notes',
                    _cp2.pitches.join(' '));
            }
            S.heldStepNotes = _cp2.pitches.slice();
            refreshSeqNotesIfCurrent(_cp2.t, _cp2.ac, _cp2.step);
            S.screenDirty = true;
            S.pendingChordPhase2 = null;
        }

        /* Chord-first phase 1: activate empty step with first chord pitch so _set_notes works next tick.
         * _set_notes is a no-op on empty steps, so _toggle must fire first to activate.
         * Context is self-contained — does not depend on heldStep (may fire after quick release).
         * Sets pendingChordPhase2 for the NEXT tick; phase 2 check above ensures they never coalesce. */
        if (S.pendingChordToStep !== null && S.activeBank !== 6) {
            const _cp1 = S.pendingChordToStep;
            if (_cp1.wasEmpty) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _cp1.t + '_c' + _cp1.ac + '_step_' + _cp1.step + '_toggle',
                        _cp1.pitches[0] + ' ' + _cp1.vel);
                S.clipSteps[_cp1.t][_cp1.ac][_cp1.step] = 1;
                S.clipNonEmpty[_cp1.t][_cp1.ac] = true;
            }
            S.pendingChordPhase2 = _cp1;
            S.pendingChordToStep = null;
        }

        /* Refresh scene state cache for O(1) lookups in LED update functions */
        for (let _i = 0; _i < 16; _i++) {
            S.cachedSceneAllPlaying[_i] = sceneAllPlaying(_i);
            S.cachedSceneAllQueued[_i]  = sceneAllQueued(_i);
            S.cachedSceneAnyPlaying[_i] = sceneAnyPlaying(_i);
        }

        /* Transport LEDs */
        setButtonLED(MovePlay, S.playing ? Green : LED_OFF);
        if (S.schwungCoRunSlot >= 0 || S.moveCoRunTrack >= 0) {
            /* Co-run: keep Rec dark — you can't record while a co-run target owns
             * input, and in Move co-run Move firmware lights its own Record button
             * (passes through under skip_led_clear). Force OFF every POLL_INTERVAL
             * so our blanking re-asserts over that layer instead of being eaten. */
            setButtonLED(MoveRec, LED_OFF, (S.tickCount % POLL_INTERVAL) === 0);
        } else if (S.recordScheduledStop || S.recordPendingPage) {
            /* recordScheduledStop = waiting for end-of-page to stop; recordPendingPage =
             * waiting for next page boundary for DSP to flip recording=1. Both blink. */
            setButtonLED(MoveRec, Math.floor(S.tickCount / 8) % 2 === 0 ? Red : LED_OFF);
        } else {
            setButtonLED(MoveRec, S.recordArmed ? Red : LED_OFF);
        }
        setButtonLED(MoveSample, S.dspMergeState >= 2 ? Green : S.dspMergeState === 1 ? Red : DarkGrey);
        /* Loop LED: flash White at 1/8 rate while Perf Mode view is locked (Session
         * View only) or drum repeat latched; VividYellow for latch mode; dim available
         * indicator (16) otherwise (always functional in both views). */
        {
            let loopColor = LED_OFF;
            const _lt = S.activeTrack;
            const _rptLatched = S.drumRepeatLatched[_lt] || S.drumRepeat2LatchedLanes[_lt].size > 0;
            /* TARP-latched indicator: when the active track has ARP IN on +
             * latched with notes in the buffer, blink the Loop button at the
             * arp's step-fire rate in the track color. fire_count is a DSP
             * monotonic counter — parity drives a 50% duty cycle synced to
             * each fired note. Gated to melodic tracks (TARP doesn't run on
             * drum) and yields to perfViewLocked / drum-rpt latch above. */
            let _tarpBlinkActive = false;
            let _tarpBlinkOn = false;
            if (!(S.sessionView && S.perfViewLocked) && !_rptLatched) {
                const _tarpOn = parseInt(host_module_get_param('t' + _lt + '_tarp_on'), 10) === 1;
                const _tarpLatch = parseInt(host_module_get_param('t' + _lt + '_tarp_latch'), 10) === 1;
                if (_tarpOn && _tarpLatch) {
                    const _fc = parseInt(host_module_get_param('t' + _lt + '_tarp_fc'), 10) || 0;
                    _tarpBlinkActive = true;
                    _tarpBlinkOn = (_fc % 2) === 0;
                }
            }
            if (S.sessionView && S.perfViewLocked) {
                loopColor = flashAtRate(48) ? White : LED_OFF;
            } else if (_rptLatched) {
                loopColor = flashAtRate(48) ? White : LED_OFF;
            } else if (_tarpBlinkActive) {
                loopColor = _tarpBlinkOn ? trackColor(_lt) : LED_OFF;
            } else if (S.sessionView && S.perfLatchMode) {
                loopColor = VividYellow;
            } else {
                /* Loop's LED renders palette colors brighter than Delete/Copy;
                 * scratch index 60 is a custom-RGB dim grey set in drainLedInit
                 * so Loop's ambient visually matches Delete/Copy at idx 16. */
                loopColor = 60;
            }
            setButtonLED(MoveLoop, loopColor);
        }
        setButtonLED(MoveCapture, DarkGrey);
        {
            const _muted      = S.trackMuted[S.activeTrack];
            const _soloed     = S.trackSoloed[S.activeTrack];
            const _muteBlink  = Math.floor(S.tickCount / 24) % 2;
            setButtonLED(MoveMute, _muted ? 124 : (_soloed ? (_muteBlink ? 124 : 0) : 16));
        }
        /* Contextual button LEDs: dim available indicator (16) on actionable buttons. */
        setButtonLED(MoveShift,       16);
        setButtonLED(MoveNoteSession, 16);
        /* Session/Track view button. In Schwung co-run the CC 50 press AND its
         * LED are owned by the Schwung chain editor (Menu opens master/send FX,
         * editor paints it white via its LED queue) — NOT a dAVEBOx exit. We
         * can't win that LED (the editor's queue flush lands after us each
         * frame), so just paint White to agree rather than fight. In Move co-run
         * the button is disabled + dark; force OFF to override Move firmware.
         * Global Menu / Tap Tempo keep the blink (no competing LED layer). */
        if (S.schwungCoRunSlot >= 0) {
            setButtonLED(MoveNoteSession, White, (S.tickCount % POLL_INTERVAL) === 0);
        } else if (S.moveCoRunTrack >= 0) {
            /* Move co-run: the Menu button is disabled (Step 3 / Back are the
             * exits), so keep its LED dark. Force OFF every POLL_INTERVAL to
             * override Move firmware's pass-through writes. */
            setButtonLED(MoveNoteSession, LED_OFF, (S.tickCount % POLL_INTERVAL) === 0);
        } else if (S.globalMenuOpen || S.tapTempoOpen) {
            const _exitBlink = (Math.floor(S.tickCount / 24) % 2) ? 16 : LED_OFF;
            setButtonLED(MoveNoteSession, _exitBlink);
        }
        setButtonLED(MoveUndo,        16);
        setButtonLED(MoveDelete,      16);
        setButtonLED(MoveCopy,        16);
        setButtonLED(MoveUp,          16);
        setButtonLED(MoveDown,        16);
        setButtonLED(MoveLeft,  S.sessionView ? LED_OFF : 16);
        setButtonLED(MoveRight, S.sessionView ? LED_OFF : 16);
        /* Shift-flash: buttons with a Shift-modified function blink 16/OFF while Shift is held.
         * Sample uses DarkGrey/OFF since index 16 (RoyalBlue) shows wrong on that button. */
        if (S.shiftHeld) {
            const _sf  = (Math.floor(S.tickCount / 24) % 2) ? 16 : LED_OFF;
            const _sfs = (Math.floor(S.tickCount / 24) % 2) ? DarkGrey : LED_OFF;
            setButtonLED(MoveNoteSession, _sf);
            setButtonLED(MoveSample,      _sfs);
            setButtonLED(MoveUndo,        _sf);
            setButtonLED(MoveCopy,        _sf);
            if (S.sessionView)  setButtonLED(MoveLoop, _sf);
            if (!S.sessionView) setButtonLED(MoveMute, _sf);
        }

        if (S.sessionView) {
            updateSessionLEDs();
            if (S.loopHeld || S.perfViewLocked) updatePerfModeLEDs();
            else updateSceneMapLEDs();
        } else {
            updateStepLEDs();
            /* Count-in flash: blink all step buttons white at quarter-note rate */
            if (S.recordArmed && S.recordCountingIn && S.countInQuarterTicks > 0) {
                const elapsed  = S.tickCount - S.countInBeatStartTick;
                const flashOn  = (elapsed % S.countInQuarterTicks) < (S.countInQuarterTicks >> 3);
                const flashClr = flashOn ? White : LED_OFF;
                for (let _i = 0; _i < 16; _i++) setLED(16 + _i, flashClr);
            }
        }
        updateTrackLEDs();

        /* Session overview blink: mark dirty when animation state toggles */
        if (S.sessionOverlayHeld) {
            const blinkOn = S.flashEighth;
            if (blinkOn !== S.lastBlinkOn) { S.lastBlinkOn = blinkOn; S.screenDirty = true; }
        } else {
            S.lastBlinkOn = null;
        }

        /* Solo blink: mark dirty when blink toggles and any track is soloed */
        if (S.trackSoloed.some(function(s) { return s; })) {
            const _sb = Math.floor(S.tickCount / 24) % 2;
            if (_sb !== S.lastSoloBlink) { S.lastSoloBlink = _sb; S.screenDirty = true; }
        } else {
            S.lastSoloBlink = null;
        }

        /* Loop jog OOB view: revert to pages view after ~500ms of inactivity */
        if (S.loopJogActive && S.loopHeld && S.loopJogLastTick !== undefined) {
            if ((S.tickCount - S.loopJogLastTick) > 70) {
                S.loopJogActive = false;
                S.screenDirty = true;
            }
        }

        /* ALL LANES blink: mark dirty when "ALL" blink toggles (bank header + loop-held overlay) */
        if (S.activeBank === 7 && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            const _ab = Math.floor(S.tickCount / 24) % 2;
            if (_ab !== S.lastAllLanesBlink) { S.lastAllLanesBlink = _ab; S.screenDirty = true; }
        } else {
            S.lastAllLanesBlink = null;
        }
    }
    /* Flush buffered recording events — one batched set_param per tick to survive coalescing.
     * Note-ons take priority; note-offs wait until the next tick if both are pending. */
    if (S.recordArmed && !S.recordCountingIn && typeof host_module_set_param === 'function') {
        if (S._recNoteOns.length > 0) {
            const rt   = S._recNoteOns[0].rt;
            const pairs = S._recNoteOns.map(function(n) { return n.pitch + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_on', pairs);
            S._recNoteOns.length = 0;
        } else if (_drumRecNoteOns.length > 0) {
            /* Batch all queued drum note-ons (same recordArmedTrack) into one
             * payload so a chord-press lands in DSP in a single audio buffer
             * rather than trickling out one-per-tick. */
            const rt = _drumRecNoteOns[0].track;
            const pairs = _drumRecNoteOns.map(function(n) { return n.laneNote + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_drum_record_note_on', pairs);
            _drumRecNoteOns.length = 0;
        } else if (S._recNoteOffs.length > 0) {
            const rt     = S._recNoteOffs[0].rt;
            const pitches = S._recNoteOffs.map(function(n) { return n.pitch; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_off', pitches);
            S._recNoteOffs.length = 0;
        } else if (_drumRecNoteOffs.length > 0) {
            const rt = _drumRecNoteOffs[0].track;
            const pitches = _drumRecNoteOffs.map(function(n) { return String(n.laneNote); }).join(' ');
            host_module_set_param('t' + rt + '_drum_record_note_off', pitches);
            _drumRecNoteOffs.length = 0;
        } else if (S.pendingPrerollGate !== null) {
            const pg = S.pendingPrerollGate;
            S.pendingPrerollGate = null;
            /* Write to the first step of the loop window — playback starts at loop_start,
             * not at absolute step 0. */
            if (pg.isDrum) {
                const _ls = S.drumLaneLoopStart[pg.track] | 0;
                host_module_set_param('t' + pg.track + '_l' + pg.lane + '_step_' + _ls + '_gate', String(pg.gate));
            } else {
                const _ls = S.clipLoopStart[pg.track][pg.clip] | 0;
                host_module_set_param('t' + pg.track + '_c' + pg.clip + '_step_' + _ls + '_gate', String(pg.gate));
            }
        } else if (S.pendingPrerollToggleQueue.length > 0) {
            const _ptq = S.pendingPrerollToggleQueue.shift();
            const _ls = S.clipLoopStart[_ptq.track][_ptq.clip] | 0;
            host_module_set_param('t' + _ptq.track + '_c' + _ptq.clip + '_step_' + _ls + '_toggle', _ptq.pitch + ' ' + _ptq.vel);
            if (_ptq.last)
                S.pendingPrerollGate = { isDrum: false, track: _ptq.track, clip: _ptq.clip, gate: _ptq.gate };
        } else if (S.pendingPrerollNote !== null && S.playing) {
            const pr = S.pendingPrerollNote;
            const _prLive = S.liveActiveNotes.has(pr.laneNote);
            if (pr.isDrum) {
                const tps = S.drumLaneTPS[pr.track] || 24;
                const elapsed = S.tickCount - S.transportStartTick;
                /* Wait for note released AND one step elapsed (skip first loop pass to avoid double-trigger) */
                if (!_prLive && elapsed >= tps) {
                    S.pendingPrerollNote = null;
                    const _ls = S.drumLaneLoopStart[pr.track] | 0;
                    if (S.drumLaneSteps[pr.track][pr.lane][_ls] === '0') {
                        const countInDur = S.transportStartTick - pr.countInStart;
                        const dspPerJs = countInDur > 0 ? 384 / countInDur : 4;
                        const pressedDur = (pr.releasedAtTick || S.tickCount) - pr.pressedAtTick;
                        const gate = Math.max(1, Math.min(tps * 16, Math.round(pressedDur * dspPerJs)));
                        host_module_set_param('t' + pr.track + '_l' + pr.lane + '_step_' + _ls + '_toggle', String(pr.vel));
                        S.pendingPrerollGate = { isDrum: true, track: pr.track, lane: pr.lane, gate };
                        S.drumLaneSteps[pr.track][pr.lane][_ls] = '1';
                        S.drumLaneHasNotes[pr.track][pr.lane] = true;
                        invalidateLEDCache();
                        forceRedraw();
                    }
                }
            }
        } else if (S.pendingPrerollNotes.length > 0 && S.playing) {
            const pns = S.pendingPrerollNotes;
            const pr  = pns[0];
            /* TARP-on: DSP tarp_fire_step records arp output to clip directly. Skip
             * JS preroll capture so a held chord becomes an arpeggiated sequence
             * across steps instead of a chord stamped on step 0. */
            const _tarpOn = parseInt(host_module_get_param('t' + pr.track + '_tarp_on'), 10) === 1;
            if (_tarpOn) {
                S.pendingPrerollNotes       = [];
                S.pendingPrerollToggleQueue = [];
                S.pendingPrerollGate        = null;
            } else {
            const _prLive = pns.some(function(n) { return S.liveActiveNotes.has(n.pitch); });
            const tps = (S.clipTPS[pr.track] && S.clipTPS[pr.track][pr.clip]) || 24;
            const elapsed = S.tickCount - S.transportStartTick;
            /* Wait for all chord notes released AND one step elapsed */
            if (!_prLive && elapsed >= tps) {
                S.pendingPrerollNotes = [];
                const _ls = S.clipLoopStart[pr.track][pr.clip] | 0;
                if (S.clipSteps[pr.track][pr.clip][_ls] === 0) {
                    const countInDur = S.transportStartTick - pr.countInStart;
                    const dspPerJs   = countInDur > 0 ? 384 / countInDur : 4;
                    const lastRel    = pns.reduce(function(m, n) { return Math.max(m, n.releasedAtTick || S.tickCount); }, 0);
                    const pressedDur = lastRel - pr.pressedAtTick;
                    const gate       = Math.max(1, Math.min(tps * 16, Math.round(pressedDur * dspPerJs)));
                    host_module_set_param('t' + pr.track + '_c' + pr.clip + '_step_' + _ls + '_toggle', pr.pitch + ' ' + pr.vel);
                    if (pns.length === 1) {
                        S.pendingPrerollGate = { isDrum: false, track: pr.track, clip: pr.clip, gate };
                    } else {
                        for (let _qi = 1; _qi < pns.length; _qi++) {
                            S.pendingPrerollToggleQueue.push({
                                track: pns[_qi].track, clip: pns[_qi].clip,
                                pitch: pns[_qi].pitch,  vel: pns[_qi].vel,
                                gate, last: _qi === pns.length - 1
                            });
                        }
                    }
                    S.clipSteps[pr.track][pr.clip][_ls] = 1;
                    S.clipNonEmpty[pr.track][pr.clip] = true;
                    invalidateLEDCache();
                    forceRedraw();
                }
            }
            }
        } else {
            /* No note event this tick — safe to send a length set_param without coalescing. */
            const _art = S.recordArmedTrack >= 0 ? S.recordArmedTrack : S.activeTrack;
            const _arac = S.trackActiveClip[_art];
            const _arDrum = S.trackPadMode[_art] === PAD_MODE_DRUM;
            if (S.pendingScheduledDisarm) {
                /* Tick 2: send tN_recording=0 alone (length was locked last tick) */
                S.pendingScheduledDisarm = false;
                disarmRecord();
            } else if (S.recordScheduledStop) {
                /* Tick 1: lock clip length at page boundary; disarm deferred to next tick */
                const _sStp = _arDrum ? S.drumCurrentStep[_art] : S.trackCurrentStep[_art];
                if (_sStp >= 0 && _sStp >= S.recordScheduledStopTarget - 1) {
                    const _lockLen = S.recordScheduledStopTarget;
                    if (_arDrum) {
                        S.drumLaneLength[_art] = _lockLen;
                        host_module_set_param('t' + _art + '_all_lanes_length', String(_lockLen));
                    } else {
                        S.clipLength[_art][_arac] = _lockLen;
                        host_module_set_param('t' + _art + '_c' + _arac + '_length', String(_lockLen));
                    }
                    S.clipAdaptiveMode[_art][_arac] = false;
                    S.recordScheduledStop           = false;
                    S.recordScheduledStopTarget     = -1;
                    S.pendingScheduledDisarm        = true;
                }
            } else if (S.clipAdaptiveMode[_art][_arac]) {
                /* Adaptive extend: grow clip by one page when approaching boundary */
                if (_arDrum) {
                    const _adCur = S.drumLaneLength[_art];
                    const _adStp = S.drumCurrentStep[_art];
                    if (_adStp >= 0 && _adCur > 0 && _adCur < 256 && _adStp >= _adCur - 4) {
                        const _adNew = _adCur + 16;
                        S.drumLaneLength[_art] = _adNew;
                        host_module_set_param('t' + _art + '_all_lanes_length', String(_adNew));
                    }
                } else {
                    const _adCur = S.clipLength[_art][_arac];
                    const _adStp = S.trackCurrentStep[_art];
                    if (_adStp >= 0 && _adCur > 0 && _adCur < 256 && _adStp >= _adCur - 4) {
                        const _adNew = _adCur + 16;
                        S.clipLength[_art][_arac] = _adNew;
                        host_module_set_param('t' + _art + '_c' + _arac + '_length', String(_adNew));
                    }
                }
            }
        }
    }

    /* Suspend save: fires last so no subsequent set_param can overwrite it.
     * Quit/Shift+Back use the else-if branches below so the exit/hide call
     * only runs on a tick AFTER the save set_param has reached DSP — same-tick
     * exit would tear the module down before the buffer processes the save. */
    if (S.pendingSuspendSave && typeof host_module_set_param === 'function') {
        S.pendingSuspendSave = false;
        updateNameIndex();
        host_module_set_param('save', '1');
    } else if (S.pendingExitAfterSave) {
        S.pendingExitAfterSave = false;
        removeFlagsWrap();
        S.ledInitComplete = false;
        invalidateLEDCache();
        clearAllLEDs();
        for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
        if (typeof host_exit_module === 'function') host_exit_module();
    } else if (S.pendingHideAfterSave) {
        S.pendingHideAfterSave = false;
        removeFlagsWrap();
        S.ledInitComplete = false;
        invalidateLEDCache();
        clearAllLEDs();
        for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
        if (typeof host_hide_module === 'function') host_hide_module();
    } else if (S.pendingSnapshotCopy) {
        /* One tick after the 'save' above flushed live state to disk
         * synchronously — copy it into the snapshot + update manifest. */
        const _sc = S.pendingSnapshotCopy;
        S.pendingSnapshotCopy = null;
        commitSnapshot(S.currentSetUuid, _sc.id, _sc.label);
    }

    /* Orphan prune: clean up set_state/<uuid>/seq8-*.json for sets that no
     * longer exist on disk. Defer until any state_load + initial sync settles
     * so the prune set_param doesn't collide with state_load coalescing. */
    if (S.pendingPruneOrphans && !S.pendingSetLoad && S.pendingDspSync === 0 &&
            typeof host_module_set_param === 'function') {
        S.pendingPruneOrphans = false;
        host_module_set_param('prune_orphan_states', '1');
        /* Drop stale entries from the in-memory index so subsequent inheritance
         * lookups don't find UUIDs whose state file is about to be removed. */
        if (!S.nameIndexCache) S.nameIndexCache = loadNameIndex();
        let _dropped = false;
        for (const _nm in S.nameIndexCache) {
            const _u = S.nameIndexCache[_nm];
            if (_u && typeof host_file_exists === 'function'
                    && !host_file_exists(uuidToStatePath(_u))) {
                delete S.nameIndexCache[_nm];
                _dropped = true;
            }
        }
        if (_dropped) saveNameIndex(S.nameIndexCache);
    }

    /* Drive the alt-mode arrow flash: repaint on each blink-phase edge so the
     * down-arrow animates even when the UI is otherwise idle. Covers both altMode
     * (most alt banks) and stepIntervalMode (Arp Steps overlay on melodic 4/5). */
    if (altIndicatorActive(S.activeTrack, S.activeBank) ||
            (!S.sessionView && S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT)) {
        const _ph = Math.floor(S.tickCount / 24) % 2;
        if (_ph !== S._altBlinkPhase) { S._altBlinkPhase = _ph; S.screenDirty = true; }
    }
    if (S.screenDirty && !isSuspended) { S.screenDirty = false; drawUI(); }

};

/* ------------------------------------------------------------------ */
/* MIDI input                                                           */
/* ------------------------------------------------------------------ */

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

function _onCCMsg(d1, d2) {
    _onCC_jog(d1, d2);
    _onCC_buttons(d1, d2);
    _onCC_transport(d1, d2);
    _onCC_side(d1, d2);
    _onCC_stepedit(d1, d2);
    _onCC_knobs(d1, d2);
}


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
        /* Capture + drum pad: silently select lane without playing a note */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.captureHeld && !S.muteHeld && !S.copyHeld && !S.deleteHeld) {
            const _sl_lane = drumPadToLane(padIdx);
            if (_sl_lane >= 0 && _sl_lane < DRUM_LANES) {
                const t = S.activeTrack;
                S.captureUsedAsModifier = true;
                padPitch[padIdx] = 0xFF;
                setActiveDrumLane(t, _sl_lane);
                syncDrumLaneSteps(t, _sl_lane);
                refreshDrumLaneBankParams(t, _sl_lane);
                forceRedraw();
                return;
            }
        }
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
                   CONDUCT(0)/NOTE FX(1)/RESPONDER/OCTAVE/WHEN; pads 5-7 are no-ops. */
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

function _onPadPress(status, d1, d2) {
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
            S.moveCoRunDrumHeld = d1;
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
            const row = Math.floor(idx / 8);
            const cur = S.seqArpStepVel[t][ac][col] | 0;
            const newLvl = (row === 0 && cur === 1) ? 0 : (row + 1);
            if (newLvl !== cur) {
                S.seqArpStepVel[t][ac][col] = newLvl;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_seq_arp_step_vel', col + ' ' + newLvl);
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
            const row = Math.floor(idx / 8);
            const cur = S.tarpStepVel[t][col] | 0;
            const newLvl = (row === 0 && cur === 1) ? 0 : (row + 1);
            if (newLvl !== cur) {
                S.tarpStepVel[t][col] = newLvl;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_tarp_step_vel', col + ' ' + newLvl);
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
function _resolveLoopGesture(fireFallback) {
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

function _onStepButtons(d1, d2) {
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
    S.stepOpTick = S.tickCount;
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

function _onPadRelease(status, d1, d2) {
    if (S.tapTempoOpen && d1 >= 68 && d1 <= 99) return;
    /* Co-run drum hold release: if the hold-threshold inject fired, send note-off
     * to close the held note in Move firmware. Always clear hold state on any
     * release of the tracked pad, even if the threshold hadn't fired yet. */
    if (S.moveCoRunTrack >= 0 && S.moveCoRunDrumHeld === d1 &&
            typeof move_midi_inject_to_move === 'function') {
        move_midi_inject_to_move([0x08, 0x80, d1, 0]);    /* plain pad off (no Shift was sent) */
        S.moveCoRunDrumHeld = -1;
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
        S.stepOpTick = S.tickCount;
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

/* Pad pressure (poly aftertouch). On drum tracks: routes continuous pressure to
 * the held drum-repeat pad's velocity (Rpt1) or the held repeat lanes (Rpt2). On
 * melodic tracks: forwards pad pressure as aftertouch to the track output per the
 * track's AftTch mode (Off/Poly/Channel). Called from the top of
 * _onMidiInternalImpl, before isNoiseMessage would drop the 0xA0. */
function _onPadAftertouch(d1, d2) {
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
            if (!routeIsMove) liveSendNote(t, 0x90, d1, vel);
            const isSeqEcho = routeIsMove && S.seqActiveNotes.has(d1);
            const isRec = !isSeqEcho && S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack;
            if (isRec) {
                _drumRecNoteOns.push({ track: t, laneNote: d1, vel: vel });
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
            if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0);
            if (info && info.recording && S.recordArmed && !S.recordCountingIn)
                _drumRecNoteOffs.push({ track: noteTrack, laneNote: d1 });
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
        if (!routeIsMove) liveSendNote(t, 0x90, d1, vel);
        /* ROUTE_MOVE: sequencer inject echoes come back here on cable-2. Skip recording
         * for pitches the sequencer is already S.playing — those are echoes, not keyboard input.
         * Preserve any existing recording-active entry so the keyboard gate isn't overwritten. */
        const isSeqEcho = routeIsMove && S.seqActiveNotes.has(d1);
        const isRec = !isSeqEcho && S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack;
        if (isRec) recordNoteOn(d1, vel, t);
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
        if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0);
        if (info && info.recording) recordNoteOff(d1);
        extHeldNotes.delete(d1);
    } else if (msgType === 0xB0 || msgType === 0xD0 || msgType === 0xA0 || msgType === 0xE0) {
        if (!routeIsMove) liveSendNote(t, msgType, d1, d2);
    }
};
