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
    DeepRed,
    DarkBlue,
    Mustard,
    DeepGreen,
    DarkGrey,
    LightGrey,
    HotMagenta,
    DeepMagenta,
    Cyan,
    PurpleBlue,
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
    createInfo, createValue, createEnum, createToggle, createAction, createDivider, formatItemValue
} from '/data/UserData/schwung/shared/menu_items.mjs';

import {
    createMenuState, handleMenuInput
} from '/data/UserData/schwung/shared/menu_nav.mjs';

import {
    createMenuStack
} from '/data/UserData/schwung/shared/menu_stack.mjs';

import {
    drawMenuHeader, drawMenuList, menuLayoutDefaults
} from '/data/UserData/schwung/shared/menu_layout.mjs';

import {
    MoveNoteSession, MoveUndo, MoveLoop, MoveCopy, MoveMainTouch, MoveRec,
    MoveCapture, MoveSample, MoveMainButton, MoveMainKnob,
    LED_OFF, LED_STEP_ACTIVE, LED_STEP_CURSOR, SCENE_BTN_FLASH_TICKS,
    LEDS_PER_FRAME, NUM_TRACKS, NUM_CLIPS, DRUM_LANES, DRUM_BASE_NOTE,
    FLAG_JUMP_TO_OVERTAKE, FLAG_JUMP_TO_TOOLS, SEQ8_NAV_FLAGS, NUM_STEPS,
    TRACK_COLORS, TRACK_DIM_COLORS, SCENE_LETTERS, TRACK_PAD_BASE, TOP_PAD_BASE,
    TPS_VALUES, NOTE_KEYS, SCALE_NAMES, SCALE_DISPLAY, DELAY_LABELS,
    fmtSign, fmtStretch, fmtLen, fmtRes, fmtPct, fmtNote, fmtPages, fmtUnis,
    fmtDly, fmtBool, fmtRoute, fmtPlain, fmtNA,
    fmtArpStyle, fmtArpRate, fmtArpSteps, fmtArpOct, fmtVelOverride,
    col4, parseActionRaw, MCUFONT, pixelPrint, pixelPrintC,
    BANKS, ACTION_POPUP_TICKS, PAD_MODE_DRUM,
    POLL_INTERVAL, CC_SCRATCH_PALETTE_BASE, TAP_TEMPO_FLASH_TICKS, TAP_TEMPO_RESET_MS,
    PARAM_LED_BANKS
} from '/data/UserData/schwung/modules/tools/seq8/ui_constants.mjs';

import { S, CC_ASSIGN_DEFAULTS, PERF_FACTORY_PRESETS } from '/data/UserData/schwung/modules/tools/seq8/ui_state.mjs';
import { saveState, doClearSession, showActionPopup, uuidToStatePath, uuidToUiStatePath } from '/data/UserData/schwung/modules/tools/seq8/ui_persistence.mjs';
import { drawGlobalMenu } from '/data/UserData/schwung/modules/tools/seq8/ui_dialogs.mjs';
import { trackClipHasContent, sceneAllQueued, updateSceneMapLEDs } from '/data/UserData/schwung/modules/tools/seq8/ui_scene.mjs';
import { effectiveClip, updateStepLEDs, updateSessionLEDs, updateTrackLEDs, flashAtRate, drawPositionBar, invalidateLEDCache } from '/data/UserData/schwung/modules/tools/seq8/ui_leds.mjs';

/* ------------------------------------------------------------------ */
/* Parameter bank definitions                                           */
/* ------------------------------------------------------------------ */

function bankHeader(bankIdx) {
    return '[ ' + BANKS[bankIdx].name + ' ]';
}

/* ------------------------------------------------------------------ */
/* Global menu items                                                    */
/* ------------------------------------------------------------------ */

/* Stub state for not-yet-wired global menu params */

/* Launch quantization: 0=Now, 1=1/16, 2=1/8, 3=1/4, 4=1/2, 5=1-bar; default 0 */

function buildGlobalMenuItems() {
    return [
        createValue('Channel', {
            get: function() { return S.trackChannel[S.activeTrack]; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'channel', v); },
            min: 1, max: 16, step: 1,
            format: function(v) { return String(v); }
        }),
        createEnum('Route', {
            get: function() { return S.trackRoute[S.activeTrack]; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'route', v); },
            options: [0, 1, 2],
            format: function(v) { return fmtRoute(v); }
        }),
        createEnum('Mode', {
            get: function() { return S.trackPadMode[S.activeTrack]; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'pad_mode', v); },
            options: [0, 1],
            format: function(v) { return v ? 'Drums' : 'Keys'; }
        }),
        createValue('VelIn', {
            get: function() { return S.trackVelOverride[S.activeTrack]; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'track_vel_override', v); },
            min: 0, max: 127, step: 1,
            format: function(v) { return fmtVelOverride(v); }
        }),
        createToggle('Looper', {
            get: function() { return S.trackLooper[S.activeTrack] !== 0; },
            set: function(v) { applyTrackConfig(S.activeTrack, 'track_looper', v ? 1 : 0); },
            onLabel: 'On', offLabel: 'Off'
        }),
        createDivider('Global'),
        createValue('BPM', {
            get: function() {
                const v = parseFloat(host_module_get_param('bpm'));
                return (v > 0 && isFinite(v)) ? Math.round(v) : 120;
            },
            set: function(v) { host_module_set_param('bpm', String(Math.round(v))); },
            min: 40, max: 250, step: 1,
            format: function(v) { return String(Math.round(v)); }
        }),
        createAction('Tap Tempo', function() {
            openTapTempo();
        }),
        createEnum('Key', {
            get: function() { return S.padKey; },
            set: function(v) {
                S.padKey = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('key', String(v));
                computePadNoteMap();
            },
            options: [0,1,2,3,4,5,6,7,8,9,10,11],
            format: function(v) { return NOTE_KEYS[((v | 0) % 12 + 12) % 12]; }
        }),
        createEnum('Scale', {
            get: function() { return S.padScale; },
            set: function(v) {
                S.padScale = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('scale', String(v));
                computePadNoteMap();
            },
            options: [0,1,2,3,4,5,6,7,8,9,10,11,12,13],
            format: function(v) { return SCALE_NAMES[v] || 'Major'; }
        }),
        createToggle('Scale Aware', {
            get: function() { return S.scaleAware !== 0; },
            set: function(v) {
                S.scaleAware = v ? 1 : 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('scale_aware', S.scaleAware ? '1' : '0');
            },
            onLabel: 'On', offLabel: 'Off'
        }),
        createEnum('Launch', {
            get: function() { return S.launchQuant; },
            set: function(v) {
                S.launchQuant = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_quant', String(v));
            },
            options: [0, 1, 2, 3, 4, 5],
            format: function(v) {
                return ['Now','1/16','1/8','1/4','1/2','1-bar'][v] || '1-bar';
            }
        }),
        createValue('Swing Amt', {
            get: function() { return S.swingAmt; },
            set: function(v) { S.swingAmt = v; host_module_set_param('swing_amt', String(v)); },
            min: 0, max: 100,
            format: function(v) { return Math.round(50 + v * 0.25) + '%'; }
        }),
        createEnum('Swing Res', {
            get: function() { return S.swingRes; },
            set: function(v) { S.swingRes = v; host_module_set_param('swing_res', String(v)); },
            options: [0, 1],
            format: function(v) { return ['1/16','1/8'][v] || '1/16'; }
        }),
        createToggle('Inp Quant', {
            get: function() { return S.inpQuant; },
            set: function(v) { S.inpQuant = v; host_module_set_param('inp_quant', v ? '1' : '0'); },
            onLabel: 'On', offLabel: 'Off'
        }),
        createEnum('MIDI In', {
            get: function() { return S.midiInChannel; },
            set: function(v) {
                S.midiInChannel = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('midi_in_channel', String(v));
            },
            options: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
            format: function(v) { return v === 0 ? 'All' : String(v); }
        }),
        createEnum('Metro', {
            get: function() { return S.metronomeOn; },
            set: function(v) {
                S.metronomeOn = v | 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('metro_on', String(S.metronomeOn));
            },
            options: [0, 1, 2, 3],
            format: function(v) {
                return ['Off', 'Count', 'On', 'Rec+Ply'][v | 0];
            }
        }),
        createValue('Metro Vol', {
            get: function() { return S.metronomeVol; },
            set: function(v) {
                S.metronomeVol = v | 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('metro_vol', String(S.metronomeVol));
            },
            min: 0, max: 100, step: 1,
            format: function(v) { return String(v | 0) + '%'; }
        }),
        createToggle('Beat Marks', {
            get: function() { return S.beatMarkersEnabled; },
            set: function(v) { S.beatMarkersEnabled = v; forceRedraw(); },
            onLabel: 'On', offLabel: 'Off'
        }),
        createAction('Save', function() {
            saveState();
            showActionPopup(['STATE', 'SAVED'], -1);
        }),
        createAction('Quit', function() {
            saveState();
            removeFlagsWrap();
            S.ledInitComplete = false;
            invalidateLEDCache();
            clearAllLEDs();
            for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
            if (typeof host_exit_module === 'function') host_exit_module();
        }),
        createAction('Clear Sess', function() {
            S.confirmClearSession = true;
            S.confirmClearSel     = 1;
            S.screenDirty         = true;
        }),
    ];
}


/* ------------------------------------------------------------------ */
/* UI state                                                             */
/* ------------------------------------------------------------------ */

/* Performance Mode state. Session View + Loop held → pad grid shows Perf Mode.
 * S.perfStack: currently-held R0 length pads (same stack semantics as old looper
 * step stack; rate captured at press time). Top = active rate.
 * S.perfModsToggled: latched modifier bitmask (Latch-toggle presses).
 * S.perfModsHeld: momentary bitmask (held mod pads, not Latch-pressed).
 * DSP receives (S.perfModsToggled | S.perfModsHeld) as perf_mods each change. */
const LOOPER_RATES_STRAIGHT = [12, 24, 48, 96, 192];   /* 1/32, 1/16, 1/8, 1/4, 1/2 */
const PERF_LATCH_LONG_PRESS = 100;     /* ~510ms → clear all toggled mods + exit Latch mode */
/* Pad → modifier bit index. R1=bits 0-7 (pitch), R2=bits 8-15 (vel/gate), R3=bits 16-23 (wild). */
const PERF_MOD_PAD_MAP = Object.freeze({
    76: 0,  /* Oct↑    */ 77: 1,  /* Oct↓    */ 78: 2,  /* Sc↑     */ 79: 3,  /* Sc↓     */
    80: 4,  /* 5th     */ 81: 5,  /* Triton  */ 82: 6,  /* Drift   */ 83: 7,  /* Storm   */
    84: 8,  /* Soft    */ 85: 9,  /* Hard    */ 86: 10, /* Cresc   */ 87: 11, /* Pulse   */
    88: 12, /* Sdchn   */ 89: 13, /* Stac    */ 90: 14, /* Lgto    */ 91: 15, /* RmpG    */
    92: 16, /* ½time   */ 93: 17, /* 3Skip   */ 94: 18, /* Phnm    */ 95: 19, /* Sprs    */
    96: 20, /* Gltch   */ 97: 21, /* Stggr   */ 98: 22, /* Shfl    */ 99: 23, /* Back    */
});
const PERF_MOD_NAMES = [
    'Oct↑','Oct↓','Sc↑','Sc↓','5th','Triton','Drift','Storm',
    'Decrsc','Swell','Cresc','Pulse','Sdchn','Stac','Lgto','RmpG',
    '½time','3Skip','Phnm','Sprs','Gltch','Stggr','Shfl','Back',
];
const PERF_MOD_FULL_NAMES = [
    'Octave Up','Octave Down','Scale Up','Scale Down','Fifth','Tritone','Drift','Storm',
    'Decrescendo','Swell','Crescendo','Pulse','Sidechain','Staccato','Legato','Ramp Gate',
    'Half Time','3 Skip','Phantom','Sparse','Glitch','Stagger','Shuffle','Backwards',
];

/* Preset S.snapshots: 16 slots (step buttons 1-16).
 * S.perfRecalledSlot: which slot is active (-1 = none).
 * S.perfRecalledMods: bitmask from the recalled slot (ORed into sendPerfMods).
 * Factory presets populate slots 0-7 (steps 1-8) at init. */
const PERF_MOD_POPUP_TICKS = 80; /* ~500ms at ~160 ticks/s */

/* View lock: double-tap Loop keeps Perf Mode alive after Loop is released.
 * Single tap while locked → unlock + stop loop. */
const LOOP_TAP_TICKS  = 40;
const LOOP_DBLTAP_GAP = 80;

/* Live pad note input — isomorphic 4ths diatonic layout. */
const SCALE_INTERVALS = [
    [0, 2, 4, 5, 7, 9, 11],        /*  0 Major           */
    [0, 2, 3, 5, 7, 8, 10],        /*  1 Minor           */
    [0, 2, 3, 5, 7, 9, 10],        /*  2 Dorian          */
    [0, 1, 3, 5, 7, 8, 10],        /*  3 Phrygian        */
    [0, 2, 4, 6, 7, 9, 11],        /*  4 Lydian          */
    [0, 2, 4, 5, 7, 9, 10],        /*  5 Mixolydian      */
    [0, 1, 3, 5, 6, 8, 10],        /*  6 Locrian         */
    [0, 2, 3, 5, 7, 8, 11],        /*  7 Harmonic Minor  */
    [0, 2, 3, 5, 7, 9, 11],        /*  8 Melodic Minor   */
    [0, 2, 4, 7, 9],               /*  9 Pentatonic Major*/
    [0, 3, 5, 7, 10],              /* 10 Pentatonic Minor*/
    [0, 3, 5, 6, 7, 10],           /* 11 Blues           */
    [0, 2, 4, 6, 8, 10],           /* 12 Whole Tone      */
    [0, 2, 3, 5, 6, 8, 9, 11],     /* 13 Diminished      */
];

/* Step-edit pitch nudge: move note up/down to next in-scale pitch.
 * When scale-aware is off, shifts by exactly 1 semitone per dir. */
function scaleNudgeNote(note, dir, key, scale) {
    if (!S.scaleAware) return Math.max(0, Math.min(127, note + dir));
    const ivls = SCALE_INTERVALS[scale];
    let candidate = note + dir;
    while (candidate >= 0 && candidate <= 127) {
        const pc = ((candidate - key) % 12 + 12) % 12;
        if (ivls.indexOf(pc) >= 0) return candidate;
        candidate += dir;
    }
    return Math.max(0, Math.min(127, note + dir));
}


/* Per-pad pitch sent at note-on — ensures matching note-off even if map changes mid-hold. */
const padPitch = new Array(32).fill(-1);

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

/* S.bankSelectTick: S.tickCount at last bank select, used for 2-second State 3 timeout.
 * -1 = timeout not active. */
const BANK_DISPLAY_TICKS = 392;  /* ~2000ms at 196Hz tick rate */
const STRETCH_BLOCKED_TICKS = 294;  /* ~1500ms at 196Hz */
const NO_NOTE_FLASH_TICKS = 118;     /* ~600ms at 196Hz */
const KNOB_TURN_HIGHLIGHT_TICKS = 120;            /* ~600ms at 196Hz — highlight after turn without touch */

/* S.bankParams[track][bankIdx][knobIdx] = integer value (JS-authoritative).
 * Initialized from BANKS defaults; refreshed from DSP on bank select. */

/* CC PARAM bank (bank 6) — per-track state, JS-authoritative */

/* Scratch palette indices for CC bank live value display (51-58, all undefined in palette).
 * Updated dynamically via SysEx each tick — one entry per knob. */

/* Pack a SysEx byte array into 4-byte USB-MIDI SysEx packets for move_midi_internal_send. */
function _sysexPkts(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i += 3) {
        const rem = bytes.length - i;
        const cin = rem >= 3 ? (rem === 3 ? 0x07 : 0x04) : (rem === 2 ? 0x06 : 0x05);
        out.push(cin, bytes[i], rem > 1 ? bytes[i + 1] : 0, rem > 2 ? bytes[i + 2] : 0);
    }
    return out;
}

/* Pre-packed reapply SysEx: [F0 00 21 1D 01 01 05 F7] */
const _CC_REAPPLY_PKT = _sysexPkts([0xF0, 0x00, 0x21, 0x1D, 0x01, 0x01, 0x05, 0xF7]);

/* Set palette entry idx to RGB (0-255 each), then call reapplyPalette to push to LEDs. */
function setPaletteEntryRGB(idx, r, g, b) {
    move_midi_internal_send(_sysexPkts([
        0xF0, 0x00, 0x21, 0x1D, 0x01, 0x01, 0x03,
        idx & 0x7F,
        r & 0x7F, r >> 7,
        g & 0x7F, g >> 7,
        b & 0x7F, b >> 7,
        0, 0,   /* white channel = 0 */
        0xF7
    ]));
}

function reapplyPalette() { move_midi_internal_send(_CC_REAPPLY_PKT); }

/* Format CC number as a 4-char display label: CC7→"CC7 ", CC74→"CC74", C100→"C100" */
function fmtCCLabel(cc) {
    const n = (cc | 0);
    return n >= 100 ? 'C' + n : 'CC' + n;
}

/* ------------------------------------------------------------------ */
/* Step entry state                                                     */
/* ------------------------------------------------------------------ */

/* S.heldStepBtn: physical button index 0-15 that is currently held (-1 = none).
 * Stored separately from S.heldStep so a second button press doesn't cause the
 * first button's release to exit step edit prematurely. */

const STEP_HOLD_TICKS  = 40;   /* ~200ms at 196Hz: below = tap, at/above = hold */

/* Metronome */

/* Undo/redo availability (mirrors DSP undo_valid/redo_valid; set on every undoable action) */

/* Per-track mute/solo state (JS mirrors DSP) */

/* Suspend detection (suspend_keeps_js) */

/* Global menu state (Phase 5q) */

/* Tap Tempo screen state */

/* Session overview overlay (hold CC 50) */
const NOTE_SESSION_HOLD_TICKS = 40;  /* ~200ms at 196Hz */

/* Real-time recording state */

const pendingLiveNotes = Array.from({length: NUM_TRACKS}, () => []);  /* buffered live notes flushed each tick */


/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

function midiNoteName(n) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[n % 12] + (Math.floor(n / 12) - 1);
}

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

/* Immediately refresh S.seqActiveNotes for the given step if it is the current
 * sequencer position on the active track — call after any step state change. */
function refreshSeqNotesIfCurrent(t, ac, absIdx) {
    if (absIdx !== S.trackCurrentStep[t] || ac !== S.trackActiveClip[t]) return;
    S.seqActiveNotes.clear();
    S.seqLastStep = -1;
    S.seqNoteOnClipTick = -1;
    if (S.clipSteps[t][ac][absIdx] && typeof host_module_get_param === 'function') {
        const r = host_module_get_param('t' + t + '_c' + ac + '_step_' + absIdx + '_notes');
        if (r && r.trim().length > 0)
            r.trim().split(' ').forEach(function(sn) {
                const p = parseInt(sn, 10);
                if (p >= 0 && p <= 127) S.seqActiveNotes.add(p);
            });
    }
}

/* Clear all notes from a step and deactivate it (atomic DSP write). */
function clearStep(t, ac, absIdx) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    host_module_set_param('t' + t + '_c' + ac + '_step_' + absIdx + '_clear', '1');
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
    if (typeof host_preview_play === 'function') {
        host_preview_play('/data/UserData/schwung/modules/tools/seq8/click-seq8.wav');
    } else if (typeof shadow_send_midi_to_dsp === 'function') {
        const vel = Math.max(1, Math.round(S.metronomeVol * 127 / 100));
        shadow_send_midi_to_dsp([0x90, 76, vel]);
        S.metroNoteOffTick = S.tickCount + 2;
    }
}

/* Clear all steps in a clip (single atomic DSP write). */
function clearClip(t, ac, keepPlaying) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum clip clear: wipe all lane step data; keep transport if S.playing */
        const keep = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t]) ? '1' : '0';
        host_module_set_param('t' + t + '_c' + ac + '_drum_clear', keep);
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = '0';
            S.drumLaneHasNotes[t][l] = false;
        }
        S.drumClipNonEmpty[t][ac] = false;
        if (ac === S.trackActiveClip[t]) S.seqActiveNotes.clear();
        return;
    }
    const cmd = (keepPlaying && S.trackClipPlaying[t] && ac === S.trackActiveClip[t])
        ? 't' + t + '_c' + ac + '_clear_keep'
        : 't' + t + '_c' + ac + '_clear';
    host_module_set_param(cmd, '1');
    const len = S.clipLength[t][ac];
    for (let s = 0; s < len; s++) S.clipSteps[t][ac][s] = 0;
    S.clipNonEmpty[t][ac] = false;
    if (ac === S.trackActiveClip[t]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
        resetPerClipBankParamsToDefault(t);
    }
}

/* Full factory reset: clip_init on DSP + JS mirror cleared. Track View only. */
function hardResetClip(t, ac) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        /* Drum clip reset: clip_init all 32 lanes; midi_note preserved */
        host_module_set_param('t' + t + '_c' + ac + '_drum_reset', '1');
        for (let l = 0; l < DRUM_LANES; l++) {
            for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = '0';
            S.drumLaneHasNotes[t][l] = false;
        }
        S.drumClipNonEmpty[t][ac] = false;
        if (ac === S.trackActiveClip[t]) {
            S.drumLaneLength[t] = 16;
            S.drumLaneTPS[t]    = 24;
            S.drumStepPage[t]   = 0;
            S.seqActiveNotes.clear();
        }
        return;
    }
    host_module_set_param('t' + t + '_c' + ac + '_hard_reset', '1');
    const defaultLen = 16;
    for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[t][ac][s] = 0;
    S.clipLength[t][ac] = defaultLen;
    S.clipNonEmpty[t][ac] = false;
    S.clipTPS[t][ac] = 24;
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
    host_module_set_param('clip_copy', `${srcT} ${srcC} ${dstT} ${dstC}`);
    S.clipSteps[dstT][dstC] = S.clipSteps[srcT][srcC].slice();
    S.clipLength[dstT][dstC] = S.clipLength[srcT][srcC];
    S.clipNonEmpty[dstT][dstC] = S.clipNonEmpty[srcT][srcC];
    S.clipTPS[dstT][dstC] = S.clipTPS[srcT][srcC];
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
    host_module_set_param('clip_cut', `${srcT} ${srcC} ${dstT} ${dstC}`);
    S.clipSteps[dstT][dstC] = S.clipSteps[srcT][srcC].slice();
    S.clipLength[dstT][dstC] = S.clipLength[srcT][srcC];
    S.clipNonEmpty[dstT][dstC] = S.clipNonEmpty[srcT][srcC];
    S.clipTPS[dstT][dstC] = S.clipTPS[srcT][srcC];
    if (dstC === S.trackActiveClip[dstT]) {
        S.seqActiveNotes.clear(); S.seqLastStep = -1;
        refreshPerClipBankParams(dstT);
    }
    for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[srcT][srcC][s] = 0;
    S.clipLength[srcT][srcC] = 16;
    S.clipNonEmpty[srcT][srcC] = false;
    S.clipTPS[srcT][srcC] = 24;
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
    host_module_set_param('row_copy', `${srcRow} ${dstRow}`);
    for (let t = 0; t < NUM_TRACKS; t++) {
        S.clipSteps[t][dstRow] = S.clipSteps[t][srcRow].slice();
        S.clipLength[t][dstRow] = S.clipLength[t][srcRow];
        S.clipNonEmpty[t][dstRow] = S.clipNonEmpty[t][srcRow];
        S.clipTPS[t][dstRow] = S.clipTPS[t][srcRow];
        if (dstRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            refreshPerClipBankParams(t);
        }
    }
}

/* Cut row: copy all tracks src→dst then hard-reset src (single atomic DSP write, JS mirror update). */
function cutRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    host_module_set_param('row_cut', `${srcRow} ${dstRow}`);
    for (let t = 0; t < NUM_TRACKS; t++) {
        S.clipSteps[t][dstRow] = S.clipSteps[t][srcRow].slice();
        S.clipLength[t][dstRow] = S.clipLength[t][srcRow];
        S.clipNonEmpty[t][dstRow] = S.clipNonEmpty[t][srcRow];
        S.clipTPS[t][dstRow] = S.clipTPS[t][srcRow];
        if (dstRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            refreshPerClipBankParams(t);
        }
        for (let s = 0; s < NUM_STEPS; s++) S.clipSteps[t][srcRow][s] = 0;
        S.clipLength[t][srcRow] = 16;
        S.clipNonEmpty[t][srcRow] = false;
        S.clipTPS[t][srcRow] = 24;
        if (srcRow === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqNoteOnClipTick = -1;
            resetPerClipBankParamsToDefault(t);
        }
    }
}

/* Copy step src→dst within same clip (single atomic DSP write, JS mirror update). */
function copyStep(t, ac, srcAbs, dstAbs) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        host_module_set_param('t' + t + '_l' + lane + '_step_' + srcAbs + '_copy_to', String(dstAbs));
        S.drumLaneSteps[t][lane][dstAbs] = S.drumLaneSteps[t][lane][srcAbs];
        if (S.drumLaneSteps[t][lane][srcAbs] !== '0') S.drumLaneHasNotes[t][lane] = true;
        S.pendingDrumLaneResync      = 2;
        S.pendingDrumLaneResyncTrack = t;
        S.pendingDrumLaneResyncLane  = lane;
    } else {
        host_module_set_param('t' + t + '_c' + ac + '_step_' + srcAbs + '_copy_to', String(dstAbs));
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
    host_module_set_param('t' + t + '_l' + srcLane + '_copy_to', String(dstLane));
    const steps = S.drumLaneSteps[t];
    for (let s = 0; s < 256; s++) steps[dstLane][s] = steps[srcLane][s];
    S.drumLaneHasNotes[t][dstLane] = S.drumLaneHasNotes[t][srcLane];
    if (S.drumLaneHasNotes[t][srcLane]) S.drumClipNonEmpty[t][S.trackActiveClip[t]] = true;
    /* Copy repeat groove JS state */
    S.drumRepeatGate[t][dstLane] = S.drumRepeatGate[t][srcLane];
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
    host_module_set_param('t' + t + '_l' + srcLane + '_cut_to', String(dstLane));
    const steps = S.drumLaneSteps[t];
    for (let s = 0; s < 256; s++) { steps[dstLane][s] = steps[srcLane][s]; steps[srcLane][s] = '0'; }
    S.drumLaneHasNotes[t][dstLane] = S.drumLaneHasNotes[t][srcLane];
    S.drumLaneHasNotes[t][srcLane] = false;
    let anyHits = false;
    for (let l = 0; l < DRUM_LANES; l++) if (S.drumLaneHasNotes[t][l]) { anyHits = true; break; }
    S.drumClipNonEmpty[t][S.trackActiveClip[t]] = anyHits;
    /* Move repeat groove JS state */
    S.drumRepeatGate[t][dstLane] = S.drumRepeatGate[t][srcLane];
    for (let s = 0; s < 8; s++) {
        S.drumRepeatVelScale[t][dstLane][s] = S.drumRepeatVelScale[t][srcLane][s];
        S.drumRepeatNudge[t][dstLane][s]    = S.drumRepeatNudge[t][srcLane][s];
    }
    S.drumRepeatGate[t][srcLane] = 0xFF;
    for (let s = 0; s < 8; s++) { S.drumRepeatVelScale[t][srcLane][s] = 100; S.drumRepeatNudge[t][srcLane][s] = 0; }
    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = dstLane;
}

/* Copy all 32 lanes of drum_clips[srcC] on srcT to drum_clips[dstC] on dstT; preserve dst midi_notes. */
function copyDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    host_module_set_param('drum_clip_copy', `${srcT} ${srcC} ${dstT} ${dstC}`);
    S.drumClipNonEmpty[dstT][dstC] = S.drumClipNonEmpty[srcT][srcC];
    if (dstC === S.trackActiveClip[dstT]) { S.pendingDrumResync = 2; S.pendingDrumResyncTrack = dstT; }
}

/* Cut all 32 lanes of drum_clips[srcC] on srcT into drum_clips[dstC] on dstT; undo dst only. */
function cutDrumClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
    host_module_set_param('drum_clip_cut', `${srcT} ${srcC} ${dstT} ${dstC}`);
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
    host_module_set_param('row_clear', String(rowIdx));
    for (let t = 0; t < NUM_TRACKS; t++) {
        const len = S.clipLength[t][rowIdx];
        for (let s = 0; s < len; s++) S.clipSteps[t][rowIdx][s] = 0;
        S.clipNonEmpty[t][rowIdx] = false;
        if (rowIdx === S.trackActiveClip[t]) {
            S.seqActiveNotes.clear(); S.seqLastStep = -1;
            resetPerClipBankParamsToDefault(t);
        }
    }
}

/* Disarm real-time recording: clear DSP flag (triggers deferred save), update LED. */
function disarmRecord() {
    if (!S.recordArmed) return;
    const t = S.recordArmedTrack;
    S.recordArmed          = false;
    S.recordCountingIn     = false;
    S.recordArmedTrack     = -1;
    S.countInStartTick    = -1;
    S.countInQuarterTicks = 0;
    _recordingNoteTrack.clear();
    S._recNoteOns.length  = 0;
    S._recNoteOffs.length = 0;
    if (typeof host_module_set_param === 'function') {
        host_module_set_param('record_count_in_cancel', '1');
        if (t >= 0) host_module_set_param('t' + t + '_recording', '0');
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
    invalidateLEDCache();
    S.screenDirty = true;
}

function closeTapTempo() {
    S.tapTempoOpen = false;
    if (typeof host_module_set_param === 'function')
        host_module_set_param('bpm', String(S.tapTempoBpm));
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
        if (avgInterval > 0)
            S.tapTempoBpm = Math.max(40, Math.min(250, Math.round(60000 / avgInterval)));
    }
    S.tapTempoFlashTick = S.tickCount;
    S.tapTempoFlashPad  = padNote;
    S.screenDirty = true;
}


function openGlobalMenu() {
    S.globalMenuItems       = buildGlobalMenuItems();
    S.globalMenuState       = createMenuState();
    S.globalMenuStack       = createMenuStack();
    S.globalMenuOpen        = true;
    S.lastSentMenuEditValue = null;
    S.screenDirty           = true;
    S.jogTouched            = false;
}



function drawBakeConfirm() {
    clear_screen();
    function _btn(x, y, w, h, sel, label, labelOff) {
        if (sel) {
            fill_rect(x, y, w, h, 1);
            print(x + labelOff, y + 3, label, 0);
        } else {
            fill_rect(x, y, w, 1, 1);
            fill_rect(x, y + h - 1, w, 1, 1);
            fill_rect(x, y, 1, h, 1);
            fill_rect(x + w - 1, y, 1, h, 1);
            print(x + labelOff, y + 3, label, 1);
        }
    }
    if (!S.confirmBakeIsDrum) {
        drawMenuHeader('BAKE FX?');
        print(4, 16, 'Apply effects chain', 1);
        print(4, 25, 'to clip notes and', 1);
        print(4, 34, 'clear the settings.', 1);
        _btn(6,  46, 46, 13, S.confirmBakeSel === 1, 'No',  17);
        _btn(74, 46, 46, 13, S.confirmBakeSel === 0, 'Yes', 14);
    } else {
        drawMenuHeader('BAKE DRUMS?');
        print(4, 16, 'Bake effects chain', 1);
        print(4, 25, 'to drum lanes.', 1);
        if (S.confirmBakeSel === 1) {
            print(4, 36, 'No Pitch / HARMZ FX', 1);
        }
        /* 3 buttons: CLIP(0) | LANE(1) | CANCEL(2, default) */
        const bW = 38, bH = 13, bY = 50;
        _btn(4,  bY, bW, bH, S.confirmBakeSel === 0, 'CLIP',   7);
        _btn(45, bY, bW, bH, S.confirmBakeSel === 1, 'LANE',   7);
        _btn(86, bY, bW, bH, S.confirmBakeSel === 2, 'CANCEL', 1);
    }
}


function clipHasContent(t, c) {
    const s = S.clipSteps[t][c];
    for (let i = 0; i < NUM_STEPS; i++) if (s[i]) return true;
    return false;
}


function computePadNoteMap() {
    const intervals = SCALE_INTERVALS[S.padScale] || SCALE_INTERVALS[0];
    const n = intervals.length;
    const root = S.padOctave[S.activeTrack] * 12 + S.padKey;
    for (let i = 0; i < 32; i++) {
        const col = i % 8;
        const row = Math.floor(i / 8);
        const deg = col + row * 3;
        const oct = Math.floor(deg / n);
        const semitone = oct * 12 + intervals[deg % n];
        S.padNoteMap[i] = Math.max(0, Math.min(127, root + semitone));
    }
}

/* Drum helpers --------------------------------------------------------------- */

/** Sync one drum lane's step data and length from DSP. */
function syncDrumLaneSteps(t, l) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_l' + l + '_steps');
    if (raw) {
        for (let s = 0; s < 256; s++) S.drumLaneSteps[t][l][s] = raw[s] || '0';
        S.drumLaneHasNotes[t][l] = raw.indexOf('1') >= 0;
    }
    if (l === S.activeDrumLane[t]) {
        const lenRaw = host_module_get_param('t' + t + '_l' + l + '_length');
        if (lenRaw !== null) S.drumLaneLength[t] = parseInt(lenRaw, 10) || 16;
        const maxPage = Math.max(0, Math.ceil(S.drumLaneLength[t] / 16) - 1);
        if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
        const tpsRaw = host_module_get_param('t' + t + '_l' + l + '_tps');
        if (tpsRaw !== null) S.drumLaneTPS[t] = parseInt(tpsRaw, 10) || 24;
    }
}

/** Sync lane notes and hit-presence for all lanes of track t (active clip). */
function syncDrumLanesMeta(t) {
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


/** Convert a padIdx (0-31) to drum lane index for the current lane page, or -1 if right half. */
function drumPadToLane(padIdx) {
    const col = padIdx % 8;
    if (col >= 4) return -1;
    const row = Math.floor(padIdx / 8);
    return S.drumLanePage[S.activeTrack] * 16 + row * 4 + col;
}

/** Convert a padIdx (0-31) to velocity zone 0-15, or -1 if left half. */
function drumPadToVelZone(padIdx) {
    const col = padIdx % 8;
    if (col < 4) return -1;
    const row = Math.floor(padIdx / 8);
    return row * 4 + (col - 4);
}

/** Map velocity zone 0-15 to a MIDI velocity (8…127). */
function drumVelZoneToVelocity(zone) {
    return Math.round((zone + 1) * 127 / 16);
}

/** Sync S.drumClipNonEmpty[t] for all clips — called on track switch and state load. */
function syncDrumClipContent(t) {
    if (typeof host_module_get_param !== 'function') return;
    for (let c = 0; c < NUM_CLIPS; c++) {
        const raw = host_module_get_param('t' + t + '_c' + c + '_drum_has_content');
        S.drumClipNonEmpty[t][c] = raw === '1';
    }
}

/** MIDI note number → display string e.g. "C3 / 60" */
function drumNoteLabel(midiNote) {
    const oct  = Math.floor(midiNote / 12) - 2;
    const name = NOTE_KEYS[midiNote % 12];
    return name + oct + '/' + midiNote;
}

/* --------------------------------------------------------------------------- */

/* Root note in pad layout closest to octave 4 — guaranteed in-scale and on a pad. */
function defaultStepNote() {
    const target = S.padKey + 60;  /* root pitch class in MIDI octave 4 */
    let best = -1, bestDist = 999;
    for (let i = 0; i < 32; i++) {
        const p = S.padNoteMap[i] + S.trackOctave[S.activeTrack] * 12;
        if (p < 0 || p > 127) continue;
        if (S.padNoteMap[i] % 12 !== S.padKey) continue;  /* root notes only */
        const d = Math.abs(p - target);
        if (d < bestDist) { bestDist = d; best = p; }
    }
    return best >= 0 ? best : Math.max(0, Math.min(127, S.padNoteMap[0] + S.trackOctave[S.activeTrack] * 12));
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
    if (S.ledInitIndex >= S.ledInitQueue.length) S.ledInitComplete = true;
}

/* Per-clip banks: NOTE FX (2), HARMZ (3), SEQ ARP (4), MIDI DLY (5) */
const PER_CLIP_BANKS  = [1, 2, 3, 4];

/* Read per-clip bank params from DSP into S.bankParams for track t.
 * Reads from clip[active_clip].pfx_params directly — immune to pfx_sync timing. */
function refreshDrumLaneBankParams(t, lane) {
    if (typeof host_module_get_param !== 'function') return;
    const snap = host_module_get_param('t' + t + '_l' + lane + '_pfx_snapshot');
    if (snap) {
        const v = snap.split(' ');
        if (v.length >= 17) {
            for (let k = 0; k < 5; k++) S.bankParams[t][1][k] = parseInt(v[k], 10) | 0;
            for (let k = 0; k < 4; k++) S.bankParams[t][2][k] = parseInt(v[5 + k], 10) | 0;
            for (let k = 0; k < 8; k++) S.bankParams[t][3][k] = parseInt(v[9 + k], 10) | 0;
        }
    }
    /* DRUM LANE bank (0): Res (K3), Len (K4) from active-lane meta; SqFl (K7) per-clip */
    const tpsIdx = TPS_VALUES.indexOf(S.drumLaneTPS[t]);
    S.bankParams[t][0][3] = tpsIdx >= 0 ? tpsIdx : 1;
    S.bankParams[t][0][4] = S.drumLaneLength[t] || 16;
    S.bankParams[t][0][7] = S.clipSeqFollow[t][S.trackActiveClip[t]] ? 1 : 0;
    /* Repeat Groove state for this lane */
    syncDrumRepeatState(t, lane);
    S.screenDirty = true;
}

function syncDrumRepeatState(t, lane) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_l' + lane + '_repeat_state');
    if (!raw) return;
    const v = raw.split(' ');
    if (v.length < 18) return;
    S.drumRepeatGate[t][lane] = parseInt(v[0], 10) & 0xFF;
    for (let s = 0; s < 8; s++) S.drumRepeatVelScale[t][lane][s] = parseInt(v[1 + s], 10) | 0;
    for (let s = 0; s < 8; s++) S.drumRepeatNudge[t][lane][s]    = parseInt(v[9 + s], 10) | 0;
}

function refreshPerClipBankParams(t) {
    if (typeof host_module_get_param !== 'function') return;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        return;
    }
    const ac   = S.trackActiveClip[t];
    const snap = host_module_get_param('t' + t + '_c' + ac + '_pfx_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 17) return;
    /* NOTE FX bank (1): K0=oct K1=ofs K2=gate K3=vel K4=qnt */
    for (let k = 0; k < 5; k++) S.bankParams[t][1][k] = parseInt(v[k], 10) | 0;
    /* HARMZ bank (2): K0=unis K1=oct K2=hrm1 K3=hrm2 */
    for (let k = 0; k < 4; k++) S.bankParams[t][2][k] = parseInt(v[5 + k], 10) | 0;
    /* MIDI DLY bank (3): K0=dly K1=lvl K2=rep K3=vfb K4=pfb K5=gfb K6=clk K7=rnd */
    for (let k = 0; k < 8; k++) S.bankParams[t][3][k] = parseInt(v[9 + k], 10) | 0;
    /* SEQ ARP bank (4): K0=style K1=rate K2=oct K3=gate K4=steps K5=retrigger (length-aware) */
    if (v.length >= 23) {
        for (let k = 0; k < 6; k++) S.bankParams[t][4][k] = parseInt(v[17 + k], 10) | 0;
    }
    /* step_vel[0..7] when present (length-aware) */
    if (v.length >= 31) {
        for (let s = 0; s < 8; s++) S.seqArpStepVel[t][ac][s] = parseInt(v[23 + s], 10) | 0;
    }
    /* CLIP bank (0): Res (K3), Len (K4), SqFl (K7) — all per-clip */
    const tps    = S.clipTPS[t][ac] || 24;
    const tpsIdx = TPS_VALUES.indexOf(tps);
    S.bankParams[t][0][3] = tpsIdx >= 0 ? tpsIdx : 1;
    S.bankParams[t][0][4] = S.clipLength[t][ac] || 16;
    S.bankParams[t][0][7] = S.clipSeqFollow[t][ac] ? 1 : 0;
    S.screenDirty = true;
}

/* Read TRACK ARP step_vel[8] from DSP for track t. Called on init and track switch. */
function readTarpStepVel(t) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_tarp_sv');
    if (!raw) return;
    const v = raw.split(' ');
    for (let s = 0; s < 8; s++)
        S.tarpStepVel[t][s] = parseInt(v[s], 10) | 0;
}

/* Reset per-clip S.bankParams to defaults for track t (no DSP call needed —
 * DSP already reset them; this just keeps JS mirrors in sync). */
function resetPerClipBankParamsToDefault(t) {
    for (let bi = 0; bi < PER_CLIP_BANKS.length; bi++) {
        const b = PER_CLIP_BANKS[bi];
        for (let k = 0; k < 8; k++) {
            const pm = BANKS[b].knobs[k];
            if (pm) S.bankParams[t][b][k] = pm.def;
        }
    }
    S.screenDirty = true;
}

function pollDSP() {
    if (typeof host_module_get_param !== 'function') return;
    const snap = host_module_get_param('state_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 53) return;
    S.playing = (v[0] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const newStep = parseInt(v[1 + t], 10) | 0;
        S.trackCurrentStep[t] = newStep;
        if (S.playing) {
            const newClip = parseInt(v[9 + t], 10) | 0;
            S.trackActiveClip[t] = newClip;
            if (newClip !== S.lastDspActiveClip[t]) {
                S.lastDspActiveClip[t] = newClip;
                refreshPerClipBankParams(t);
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    syncDrumLanesMeta(t);
                    syncDrumLaneSteps(t, S.activeDrumLane[t]);
                }
            }
        }
        S.trackQueuedClip[t]  = parseInt(v[17 + t], 10) | 0;
    }
    const countInDspActive = (v[25] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        S.trackClipPlaying[t]     = (v[26 + t] === '1');
        S.trackWillRelaunch[t]    = (v[34 + t] === '1');
        S.trackPendingPageStop[t] = (v[42 + t] === '1');
    }
    S.flashEighth    = (v[50] === '1');
    S.flashSixteenth = (v[51] === '1');
    const _beatCount = parseInt(v[52], 10) | 0;
    if (_beatCount !== S.metroPrevBeat) {
        S.metroPrevBeat = _beatCount;
        playMetronomeClick();
        if (S.recordCountingIn) S.countInBeatStartTick = S.tickCount;
    }
    if (v.length >= 54) S.masterPos      = (parseInt(v[53], 10) | 0) >>> 0;
    if (v.length >= 55) S.dspLooperState  = parseInt(v[54], 10) | 0;
    const _prevMergeState = S.dspMergeState;
    if (v.length >= 56) S.dspMergeState   = parseInt(v[55], 10) | 0;
    if (v.length >= 57) S.dspMergeDstClip = parseInt(v[56], 10) | 0;
    /* Arm confirmation: if DSP stayed idle after merge_arm, no empty slot was available */
    if (S.pendingMergeArm) {
        S.pendingMergeArm = false;
        if (S.dspMergeState === 0) {
            setButtonLED(MoveSample, LED_OFF);
            showActionPopup('NO EMPTY', 'CLIP SLOT');
        }
    }
    /* Merge just finished — re-read destination clip so LEDs + session view update */
    if (_prevMergeState !== 0 && S.dspMergeState === 0 && S.dspMergeTrack >= 0) {
        /* Auto-finalize: DSP jumped directly from CAPTURING (2) to IDLE — max length hit */
        if (_prevMergeState === 2) showActionPopup('MAX LENGTH', 'REACHED');
        if (S.trackPadMode[S.dspMergeTrack] === PAD_MODE_DRUM) {
            syncDrumClipContent(S.dspMergeTrack);
            S.screenDirty = true;
        } else {
            S.pendingStepsReread      = 2;
            S.pendingStepsRereadTrack = S.dspMergeTrack;
            S.pendingStepsRereadClip  = S.dspMergeDstClip;
        }
    }

    /* Deferred bank refresh after bake */
    if (S.pendingBankRefresh >= 0) {
        refreshPerClipBankParams(S.pendingBankRefresh);
        S.pendingBankRefresh = -1;
        S.screenDirty = true;
    }

    /* Drum playhead: poll active lane's current step for active drum track */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const _dl = S.activeDrumLane[S.activeTrack];
        const _dcRaw = host_module_get_param('t' + S.activeTrack + '_l' + _dl + '_current_step');
        if (_dcRaw !== null) {
            const _newDcs = parseInt(_dcRaw, 10) | 0;
            if (_newDcs !== S.drumCurrentStep[S.activeTrack]) {
                S.drumCurrentStep[S.activeTrack] = _newDcs;
                S.screenDirty = true;
            }
        }
        /* Drum SeqFollow: auto-page to follow playhead */
        if (S.playing && S.trackClipPlaying[S.activeTrack] && S.clipSeqFollow[S.activeTrack][effectiveClip(S.activeTrack)]) {
            const _dcs = S.drumCurrentStep[S.activeTrack];
            if (_dcs >= 0) {
                const _newPage = Math.floor(_dcs / 16);
                if (_newPage !== S.drumStepPage[S.activeTrack]) {
                    S.drumStepPage[S.activeTrack] = _newPage;
                    S.screenDirty = true;
                }
            }
        }
        /* M blink: keep screen dirty while any lane is muted so blink animates */
        if (S.drumLaneMute[S.activeTrack]) S.screenDirty = true;
        /* Drum pad flash + S.seqActiveNotes: poll which lanes are hitting (single bitmask call) */
        if (S.playing && S.trackClipPlaying[S.activeTrack]) {
            const _maskRaw = host_module_get_param('t' + S.activeTrack + '_drum_active_lanes');
            if (_maskRaw !== null) {
                const _mask = parseInt(_maskRaw, 10) | 0;
                S.seqActiveNotes.clear(); /* refresh per poll; stale entries block external recording */
                for (let _fl = 0; _fl < DRUM_LANES; _fl++) {
                    if (_mask & (1 << _fl)) {
                        S.drumLaneFlashTick[S.activeTrack][_fl] = S.tickCount;
                        S.seqActiveNotes.add(S.drumLaneNote[S.activeTrack][_fl]);
                        S.screenDirty = true;
                    }
                }
            }
        }
    }

    /* SeqFollow: auto-page S.activeTrack to follow playhead */
    if (S.playing) {
        const _sft = S.activeTrack;
        const _sfac = effectiveClip(_sft);
        if (S.clipSeqFollow[_sft][_sfac] && S.trackClipPlaying[_sft]) {
            const _cs = S.trackCurrentStep[_sft];
            if (_cs >= 0) {
                const newPage = Math.floor(_cs / 16);
                if (newPage !== S.trackCurrentPage[_sft]) {
                    S.trackCurrentPage[_sft] = newPage;
                    S.screenDirty = true;
                }
            }
        }
    }

    /* Count-in end: DSP fired transport+recording — sync JS state */
    if (S.countInDspPrev && !countInDspActive && S.playing) {
        S.recordCountingIn    = false;
        S.countInStartTick    = -1;
        S.countInQuarterTicks = 0;
    }
    S.countInDspPrev = countInDspActive;

    /* Stop transition: transport just stopped — clear recording state */
    if (S.playingPrev && !S.playing) {
        disarmRecord();
    }
    S.playingPrev = S.playing;

    /* Refresh step LEDs while recording or holding a step (nudge may move note across boundary) */
    if ((S.recordArmed && S.playing) || S.heldStep >= 0) {
        const rt = S.activeTrack;
        const rac = effectiveClip(rt);
        const bulk = host_module_get_param('t' + rt + '_c' + rac + '_steps');
        if (bulk && bulk.length >= NUM_STEPS) {
            for (let rs = 0; rs < NUM_STEPS; rs++)
                S.clipSteps[rt][rac][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
            S.clipNonEmpty[rt][rac] = clipHasContent(rt, rac);
            S.screenDirty = true;
        }
    }

    /* Track sequencer notes for active track pad highlighting */
    const t  = S.activeTrack;
    const ac = S.trackActiveClip[t];
    const cs = S.trackCurrentStep[t];
    if (!S.playing) {
        S.seqActiveNotes.clear();
        S.seqLastStep = -1;
        S.seqLastClip = -1;
        S.seqNoteOnClipTick = -1;
        S.seqNoteGateTicks  = 0;
    } else if (cs !== S.seqLastStep || ac !== S.seqLastClip) {
        S.seqLastStep = cs;
        S.seqLastClip = ac;
        S.seqActiveNotes.clear();
        S.seqNoteOnClipTick = -1;
        S.seqNoteGateTicks  = 0;
        if (cs >= 0 && S.clipSteps[t][ac][cs] === 1) {
            const raw = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_notes');
            if (raw && raw.trim().length > 0) {
                raw.trim().split(' ').forEach(function(sn) {
                    const pitch = parseInt(sn, 10);
                    if (pitch >= 0 && pitch <= 127) S.seqActiveNotes.add(pitch);
                });
            }
            const ctStr = host_module_get_param('t' + t + '_current_clip_tick');
            const gStr  = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_gate');
            if (ctStr !== null && ctStr !== undefined) S.seqNoteOnClipTick = parseInt(ctStr, 10) | 0;
            if (gStr  !== null && gStr  !== undefined) S.seqNoteGateTicks  = parseInt(gStr,  10) | 0;
        }
    } else if (S.seqActiveNotes.size > 0 && S.seqNoteOnClipTick >= 0 && S.seqNoteGateTicks > 0) {
        const ctStr = host_module_get_param('t' + t + '_current_clip_tick');
        if (ctStr !== null && ctStr !== undefined) {
            const ct = parseInt(ctStr, 10) | 0;
            const clipTicks = S.clipLength[t][ac] * (S.clipTPS[t][ac] || 24);
            const elapsed = ct >= S.seqNoteOnClipTick
                ? ct - S.seqNoteOnClipTick
                : clipTicks - S.seqNoteOnClipTick + ct;
            if (elapsed >= S.seqNoteGateTicks) S.seqActiveNotes.clear();
        }
    }

    /* Deferred DSP state save: fetch state_full (DSP serializes only when dirty) */
    if (typeof host_write_file === 'function' && S.currentSetUuid) {
        const _st = host_module_get_param('state_full');
        if (_st && _st.length > 2)
            host_write_file(uuidToStatePath(S.currentSetUuid), _st);
    }

}

/* Reset NOTE FX, HARMZ, and MIDI DLY banks to DSP defaults for track t.
 * Sends a single tN_pfx_reset command (Schwung only delivers the last
 * set_param per tick — individual per-param sends would be coalesced). */
function resetFxBanks(t) {
    if (typeof host_module_set_param !== 'function') return;
    S.undoAvailable = true; S.redoAvailable = false;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        host_module_set_param('t' + t + '_l' + lane + '_pfx_reset', '1');
    } else {
        host_module_set_param('t' + t + '_pfx_reset', '1');
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

function resetSingleFxBank(t, bankIdx) {
    if (typeof host_module_set_param !== 'function') return;
    const dspCmd = { 1: 'pfx_noteFx_reset', 2: 'pfx_harm_reset', 3: 'pfx_delay_reset' }[bankIdx];
    if (!dspCmd) return;
    S.undoAvailable = true; S.redoAvailable = false;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        const lane = S.activeDrumLane[t];
        host_module_set_param('t' + t + '_l' + lane + '_pfx_set', dspCmd + ' 1');
    } else {
        host_module_set_param('t' + t + '_' + dspCmd, '1');
    }
    for (let k = 0; k < 8; k++) {
        const pm = BANKS[bankIdx].knobs[k];
        if (!pm) continue;
        S.bankParams[t][bankIdx][k] = pm.def;
    }
    S.screenDirty = true;
}

/* ------------------------------------------------------------------ */
/* Parameter bank: read from DSP and write to DSP                      */
/* ------------------------------------------------------------------ */

/* Read all wired params for bankIdx on track t from DSP into S.bankParams. */
function readBankParams(t, bankIdx) {
    if (typeof host_module_get_param !== 'function') return;
    /* ARP OUT bank: seq_arp_* are set-only; read via per-clip pfx_snapshot */
    if (bankIdx === 4) {
        const ac   = S.trackActiveClip[t];
        const snap = host_module_get_param('t' + t + '_c' + ac + '_pfx_snapshot');
        if (snap) {
            const v = snap.split(' ');
            if (v.length >= 24) {
                for (let k = 0; k < 7; k++) S.bankParams[t][4][k] = parseInt(v[17 + k], 10) | 0;
            }
        }
        return;
    }
    /* CC PARAM bank: read all 8 CC assignments from DSP */
    if (bankIdx === 6) {
        const raw = host_module_get_param('t' + t + '_cc_assigns');
        if (raw) {
            const parts = raw.split(' ');
            for (let k = 0; k < 8; k++)
                S.trackCCAssign[t][k] = parseInt(parts[k], 10) || CC_ASSIGN_DEFAULTS[k];
        }
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bits = host_module_get_param('t' + t + '_c' + c + '_cc_auto_bits');
            S.trackCCAutoBits[t][c] = bits !== null ? (parseInt(bits, 10) || 0) : 0;
        }
        return;
    }
    const knobs = BANKS[bankIdx].knobs;
    for (let k = 0; k < 8; k++) {
        const pm = knobs[k];
        if (!pm || !pm.abbrev || pm.scope === 'stub') {
            S.bankParams[t][bankIdx][k] = pm ? pm.def : 0;
            continue;
        }
        if (pm.scope === 'seqfollow') {
            S.bankParams[t][bankIdx][k] = S.clipSeqFollow[t][S.trackActiveClip[t]] ? 1 : 0;
            continue;
        }
        if (pm.scope === 'clip') {
            const ac = S.trackActiveClip[t];
            if (pm.dspKey === 'clip_resolution') {
                const tps = S.clipTPS[t][ac] || 24;
                const idx = TPS_VALUES.indexOf(tps);
                S.bankParams[t][bankIdx][k] = idx >= 0 ? idx : 1;
            } else {
                S.bankParams[t][bankIdx][k] = pm.def;
            }
            continue;
        }
        if (pm.scope === 'action') {
            /* beat_stretch and clock_shift display per-touch labels (0 at rest) rather than absolute position */
            if (pm.dspKey === 'beat_stretch' || pm.dspKey === 'clock_shift') { S.bankParams[t][bankIdx][k] = 0; continue; }
            const stateKey = 't' + t + '_' + pm.dspKey + pm.actionSuffix;
            const raw = host_module_get_param(stateKey);
            S.bankParams[t][bankIdx][k] = parseActionRaw(raw, pm.def);
            continue;
        }
        const key = pm.scope === 'global' ? pm.dspKey : 't' + t + '_' + pm.dspKey;
        const raw = host_module_get_param(key);
        if (raw === null || raw === undefined) {
            S.bankParams[t][bankIdx][k] = pm.def;
            continue;
        }
        if (pm.dspKey === 'harm_unison') {
            S.bankParams[t][bankIdx][k] = raw === 'x2' ? 1 : raw === 'x3' ? 2 : 0;
        } else if (pm.dspKey === 'route') {
            S.bankParams[t][bankIdx][k] = raw === 'external' ? 2 : raw === 'move' ? 1 : 0;
        } else {
            S.bankParams[t][bankIdx][k] = parseInt(raw, 10) || 0;
        }
    }
}

function readTrackConfig(t) {
    if (typeof host_module_get_param !== 'function') return;
    const ch = host_module_get_param('t' + t + '_channel');
    if (ch !== null && ch !== undefined) S.trackChannel[t] = parseInt(ch, 10) || 1;
    const rt = host_module_get_param('t' + t + '_route');
    if (rt !== null && rt !== undefined) S.trackRoute[t] = rt === 'external' ? 2 : rt === 'move' ? 1 : 0;
    const pm = host_module_get_param('t' + t + '_pad_mode');
    if (pm !== null && pm !== undefined) S.trackPadMode[t] = parseInt(pm, 10) | 0;
    const tvo = host_module_get_param('t' + t + '_track_vel_override');
    if (tvo !== null && tvo !== undefined) S.trackVelOverride[t] = parseInt(tvo, 10) | 0;
    const lpr = host_module_get_param('t' + t + '_track_looper');
    if (lpr !== null && lpr !== undefined) S.trackLooper[t] = parseInt(lpr, 10) | 0;
}

function applyTrackConfig(t, key, val) {
    if (typeof host_module_set_param !== 'function') return;
    let strVal;
    if (key === 'route') strVal = val === 2 ? 'external' : val === 1 ? 'move' : 'schwung';
    else strVal = String(val);
    host_module_set_param('t' + t + '_' + key, strVal);
    if (key === 'channel')              S.trackChannel[t] = val;
    else if (key === 'route')           S.trackRoute[t] = val;
    else if (key === 'pad_mode') {
        S.trackPadMode[t] = val;
        if (val === PAD_MODE_DRUM) {
            if (t === S.activeTrack && (S.activeBank === 2 || S.activeBank === 4)) S.activeBank = 0;
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            syncDrumClipContent(t);
        }
    }
    else if (key === 'track_vel_override') S.trackVelOverride[t] = val;
    else if (key === 'track_looper')    S.trackLooper[t] = val;
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
        if (S.extMidiRemapActive) {
            host_ext_midi_remap_clear();
            host_ext_midi_remap_enable(0);
            S.extMidiRemapActive = false;
        }
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

/* Send a single param change to DSP and apply any JS-side side-effects. */
function applyBankParam(t, bankIdx, knobIdx, val) {
    const pm = BANKS[bankIdx].knobs[knobIdx];
    if (!pm || pm.scope === 'stub') return;
    if (pm.scope === 'seqfollow') {
        S.clipSeqFollow[t][S.trackActiveClip[t]] = val !== 0;
        return;
    }
    if (!pm.dspKey) return;
    if (typeof host_module_set_param !== 'function') return;

    if (pm.scope === 'global') {
        host_module_set_param(pm.dspKey, String(val));
        if (pm.dspKey === 'key') { S.padKey = val; computePadNoteMap(); }
    } else if (pm.scope === 'track') {
        let strVal;
        if      (pm.dspKey === 'harm_unison')       strVal = ['OFF','x2','x3'][val] || 'OFF';
        else if (pm.dspKey === 'route')              strVal = val === 2 ? 'external' : val === 1 ? 'move' : 'schwung';
        else                                         strVal = String(val);
        if ([1, 2, 3].indexOf(bankIdx) >= 0 && S.trackPadMode[t] === PAD_MODE_DRUM) {
            const lane = S.activeDrumLane[t];
            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', pm.dspKey + ' ' + strVal);
            return;
        }
        host_module_set_param('t' + t + '_' + pm.dspKey, strVal);
        if (pm.dspKey === 'clip_length') {
            const ac = S.trackActiveClip[t];
            S.clipLength[t][ac] = val;
            const maxPage = Math.max(0, Math.ceil(val / 16) - 1);
            if (S.trackCurrentPage[t] > maxPage) S.trackCurrentPage[t] = maxPage;
        }
    } else if (pm.scope === 'clip') {
        const ac = S.trackActiveClip[t];
        if (pm.dspKey === 'clip_resolution') {
            if (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t) return;
            const idx = Math.max(0, Math.min(5, val));
            S.clipTPS[t][ac] = TPS_VALUES[idx];
            host_module_set_param('t' + t + '_clip_resolution', String(idx));
        }
    }
}


function liveSendNote(t, type, pitch, vel) {
    const ch    = (S.trackChannel[t] - 1) & 0x0F;
    const route = S.trackRoute[t];
    const status = type | ch;
    if (type === 0x90 && vel > 0 && route !== 1) {
        const tvo = S.trackVelOverride[t];
        if (tvo > 0) vel = tvo;
    }
    if (route === 2) {
        const cin = (status >> 4) & 0x0F;
        if (typeof move_midi_external_send === 'function')
            move_midi_external_send([cin, status, pitch, vel]);
    } else if (route === 1) {
        /* When recording is active, record_note_on/off DSP handlers do live monitoring
         * inline — skip buffering here to avoid coalescing with those set_params. */
        const activelyRecording = S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t;
        if (!activelyRecording) {
            const isOff = (type === 0x80) || (type === 0x90 && vel === 0);
            pendingLiveNotes[t].push(isOff ? { isOff: true, pitch } : { isOff: false, pitch, vel });
        }
    } else {
        if (typeof shadow_send_midi_to_dsp === 'function') shadow_send_midi_to_dsp([status, pitch, vel]);
    }
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
        host_module_set_param('perf_mods', String(S.perfModsToggled | S.perfModsHeld | S.perfRecalledMods));
}

/* Draw the full 4-row pad grid for Performance Mode.
 * R0 (68-75): rate pads 1-6 (pulse at capture rate), triplet toggle, latch.
 * R1 (76-83): PITCH modifier pads (HotMagenta family).
 * R2 (84-91): VEL/GATE modifier pads (VividYellow family).
 * R3 (92-99): WILD modifier pads (Cyan family).
 * Also clears step buttons (16-31) — not used in Perf Mode. */
function updatePerfModeLEDs() {
    if (!S.ledInitComplete) return;
    const activeMods = S.perfModsToggled | S.perfModsHeld | S.perfRecalledMods;
    /* Step buttons: preset slots. */
    for (let i = 0; i < 16; i++) {
        if (i === S.perfRecalledSlot)         setLED(16 + i, White);
        else if (S.perfSnapshots[i] !== 0)    setLED(16 + i, PurpleBlue);
        else                                setLED(16 + i, LightGrey);
    }

    /* R0 (68-75): rate pads 0-4 (1/32..1/2), hold (5), sync (6), latch (7) */
    for (let i = 0; i < 5; i++)
        setLED(68 + i, flashAtRate(LOOPER_RATES_STRAIGHT[i]) ? White : LightGrey);
    /* Hold pad (73): White when held, Red otherwise */
    setLED(73, S.perfHoldPadHeld ? White : Red);
    /* Sync (pad 74): blink dim/bright green at 1/4 when sync=on; solid Green when sync=off */
    setLED(74, S.perfSync ? (flashAtRate(96) ? Green : DeepGreen) : Green);
    /* Latch (pad 75): Yellow when latch mode is on (mods sticky); Purple when off */
    setLED(75, S.perfLatchMode ? VividYellow : PurpleBlue);

    /* R1 (76-83): PITCH mods — active = White, inactive = dim Magenta */
    for (let i = 0; i < 8; i++) {
        const note = 76 + i;
        const modIdx = PERF_MOD_PAD_MAP[note];
        if (modIdx !== undefined)
            setLED(note, (activeMods >> modIdx) & 1 ? White : DeepMagenta);
        else
            setLED(note, LED_OFF);
    }

    /* R2 (84-91): VEL/GATE mods — active = White, inactive = dim Yellow */
    for (let i = 0; i < 8; i++) {
        const note = 84 + i;
        const modIdx = PERF_MOD_PAD_MAP[note];
        if (modIdx !== undefined)
            setLED(note, (activeMods >> modIdx) & 1 ? White : Mustard);
        else
            setLED(note, LED_OFF);
    }

    /* R3 (92-99): WILD mods — active = White, inactive = dim Blue */
    for (let i = 0; i < 8; i++) {
        const note = 92 + i;
        const modIdx = PERF_MOD_PAD_MAP[note];
        if (modIdx !== undefined)
            setLED(note, (activeMods >> modIdx) & 1 ? White : DarkBlue);
        else
            setLED(note, LED_OFF);
    }
}

function forceRedraw() {
    S.screenDirty = true;
    if (!S.ledInitComplete) return;
    if (S.sessionView) {
        updateSessionLEDs();
        if (S.loopHeld || S.perfViewLocked) updatePerfModeLEDs();
        else { updateSceneMapLEDs(); for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF); }
    } else {
        updateStepLEDs();
    }
    updateTrackLEDs();
}

/* ------------------------------------------------------------------ */
/* Display                                                              */
/* ------------------------------------------------------------------ */

/* Pure graphical 8×16 grid (128×64 OLED). 8 columns = tracks, 16 rows = scenes.
 * Each cell is 16×4 px. Cell states:
 *   active clip on active track → blink (solid ↔ center bar)
 *   active clip on other track  → solid fill (16×4)
 *   has content, not active     → center bar (14×2 at x+1,y+1)
 *   empty                       → nothing */
function drawSessionOverview() {
    /* White background everywhere; current scene group band stays black. */
    fill_rect(0, 0, 128, 64, 1);
    const bandY = Math.floor(S.sceneRow / 4) * 16;
    fill_rect(0, bandY, 128, 16, 0);

    /* Horizontal grid lines: white inside band, black outside. */
    for (let s = 0; s < NUM_CLIPS; s++) {
        const ly = s * 4;
        fill_rect(0, ly, 128, 1, (ly >= bandY && ly < bandY + 16) ? 1 : 0);
    }

    /* Vertical grid lines: three segments per column — black/white/black. */
    for (let t = 0; t < NUM_TRACKS; t++) {
        const lx = t * 16;
        if (bandY > 0)        fill_rect(lx, 0,          1, bandY,             0);
                              fill_rect(lx, bandY,      1, 16,                1);
        if (bandY + 16 < 64) fill_rect(lx, bandY + 16, 1, 64 - bandY - 16,  0);
    }

    /* Cell content: white (1) inside band, black (0) outside. */
    const blinkOn = Math.floor(S.tickCount / 96) % 2 === 0;
    for (let t = 0; t < NUM_TRACKS; t++) {
        const x  = t * 16 + 1;
        const ac = S.trackActiveClip[t];
        for (let s = 0; s < NUM_CLIPS; s++) {
            const y      = s * 4 + 1;
            const color  = (s >= S.sceneRow && s < S.sceneRow + 4) ? 1 : 0;
            const hasData    = S.clipNonEmpty[t][s];
            const isActive   = (s === ac);
            const isPlaying  = (isActive && S.trackClipPlaying[t]);
            if (isPlaying && hasData) {
                if (blinkOn) fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (isActive && hasData) {
                fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (S.overviewCache[t][s]) {
                fill_rect(x + 6, y + 1, 2, 1, color);
            }
        }
    }
}

/* Track-number row: active track has a box (1px border + 1px pad around number).
 * Muted = inverted. Soloed = blink. */
function drawTrackRow(y) {
    const soloBlinkOn = Math.floor(S.tickCount / 24) % 2 === 0;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        const cx = _t * 16 + 5;
        const bx = _t * 16 + 3;
        const by = y - 2;
        const bw = 10, bh = 12;
        const isActive = (_t === S.activeTrack);
        if (S.trackMuted[_t]) {
            if (soloBlinkOn) print(cx, y, String(_t + 1), 1);
            if (isActive) {
                fill_rect(bx, by,      bw, 1,  1);
                fill_rect(bx, by+bh-1, bw, 1,  1);
                fill_rect(bx, by,      1,  bh, 1);
                fill_rect(bx+bw-1, by, 1,  bh, 1);
            }
        } else if (S.trackSoloed[_t]) {
            fill_rect(bx, by, bw, bh, 1);
            print(cx, y, String(_t + 1), 0);
        } else {
            print(cx, y, String(_t + 1), 1);
            if (isActive) {
                fill_rect(bx, by,      bw, 1,  1);
                fill_rect(bx, by+bh-1, bw, 1,  1);
                fill_rect(bx, by,      1,  bh, 1);
                fill_rect(bx+bw-1, by, 1,  bh, 1);
            }
        }
    }
}

function drawPerfModeOled() {
    clear_screen();
    const activeMods = S.perfModsToggled | S.perfModsHeld | S.perfRecalledMods;
    /* Header: show preset name if a slot is recalled */
    let headerRight = '';
    if (S.perfRecalledSlot >= 0) {
        const fp = PERF_FACTORY_PRESETS[S.perfRecalledSlot];
        headerRight = fp ? fp.name : ('P' + (S.perfRecalledSlot + 1));
    } else if (S.perfLatchMode || S.perfModsToggled) {
        headerRight = S.perfLatchMode ? 'LATCH' : 'LATCHED';
    }
    let header = 'PERF';
    if (S.perfHoldPadHeld || S.perfStickyLengths.size > 0) header += ' \xb7 HOLD';
    print(4, 4, header, 1);
    if (headerRight) print(128 - headerRight.length * 6 - 4, 4, headerRight, 1);
    /* Horizontal rule */
    fill_rect(0, 13, 128, 1, 1);
    /* Brief full-name popup on mod activate */
    if (S.perfModPopupEndTick >= 0 && S.tickCount <= S.perfModPopupEndTick && S.perfModPopupName) {
        const px = Math.floor((128 - S.perfModPopupName.length * 6) / 2);
        print(px < 0 ? 0 : px, 28, S.perfModPopupName, 1);
    } else {
        S.perfModPopupEndTick = -1;
        /* Active modifier names — up to 3 per line, +N overflow */
        const activeNames = [];
        for (let i = 0; i < PERF_MOD_NAMES.length; i++)
            if ((activeMods >> i) & 1) activeNames.push(PERF_MOD_NAMES[i]);
        if (activeNames.length === 0) {
            print(4, 24, 'No mods active', 1);
            print(4, 36, 'Hold pad to engage', 1);
        } else {
            const extra = activeNames.length > 6 ? '+' + (activeNames.length - 5) : '';
            const show  = extra ? activeNames.slice(0, 5) : activeNames;
            const line1 = show.slice(0, 3).join('  ');
            const line2 = show.slice(3).join('  ') + (extra ? '  ' + extra : '');
            print(4, 24, line1, 1);
            if (line2) print(4, 36, line2, 1);
        }
    }
    /* Rate + slot indicator */
    if (S.perfStack.length > 0) {
        const RATE_LABELS = ['1/32','1/16','1/8','1/4','1/2'];
        const top = S.perfStack[S.perfStack.length - 1];
        const label = RATE_LABELS[top.idx];
        const slotStr = S.perfRecalledSlot >= 0 ? '  S' + (S.perfRecalledSlot + 1) : '';
        print(4, 52, '\xbb ' + label + slotStr, 1);
    }
}

function drawUI() {
    if (S.sessionOverlayHeld) { drawSessionOverview(); return; }
    if (S.confirmBake) { drawBakeConfirm(); return; }
    if (S.globalMenuOpen) { drawGlobalMenu(); return; }
    /* Perf Mode OLED takeover (Session View + Loop held or locked) */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked)) { drawPerfModeOled(); return; }
    clear_screen();
    if (S.sessionView) {
        if (S.actionPopupEndTick >= 0) {
            if (S.actionPopupLines.length >= 2) {
                print(4, 22, S.actionPopupLines[0], 1);
                print(4, 34, S.actionPopupLines[1], 1);
            } else {
                print(4, 28, S.actionPopupLines[0], 1);
            }
            return;
        }
        const base = S.sceneRow;
        print(4, 10, 'SESSION  GRP ' + (Math.floor(S.sceneRow / 4) + 1), 1);
        print(4, 22, SCENE_LETTERS[base] + '-' + SCENE_LETTERS[base + 3], 1);
        drawTrackRow(34);
        for (let t = 0; t < NUM_TRACKS; t++)
            print(t * 16 + 5, 46, SCENE_LETTERS[S.trackActiveClip[t]], 1);
        return;
    }

    /* Track View — priority display state machine */
    const bank      = S.activeBank;
    const inTimeout = S.bankSelectTick >= 0 || S.jogTouched;

    /* Count-in overlay: highest priority while waiting for bar to elapse */
    if (S.recordArmed && S.recordCountingIn && !S.sessionView) {
        const ac_r       = S.trackActiveClip[S.recordArmedTrack];
        const totalPages = Math.max(1, Math.ceil(S.clipLength[S.recordArmedTrack][ac_r] / 16));
        print(4, 10, 'TR' + (S.recordArmedTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac_r] +
                     '  PG 1/' + totalPages, 1);
        print(4, 22, 'COUNT-IN', 1);
        print(4, 34, 'REC ARMED', 1);
        drawTrackRow(46);
        return;
    }

    /* Compress-limit override: highest priority for ~1500ms after a blocked compress */
    if (S.stretchBlockedEndTick >= 0) {
        print(4, 10, '[CLIP       ]', 1);
        print(4, 22, 'Beat Stretch', 1);
        print(4, 34, 'COMPRESS LIMIT', 1);
        return;
    }

    /* Action confirmation pop-up: ~500ms; defers to step edit and active-knob bank overview */
    if (S.actionPopupEndTick >= 0 && S.heldStep < 0 && S.knobTouched < 0) {
        if (S.actionPopupHighlight >= 0 && S.actionPopupLines.length >= 3) {
            const _title = S.actionPopupLines[0];
            const _tw = _title.length * 6;
            const _tx = Math.floor((128 - _tw) / 2);
            print(_tx, 4, _title, 1);
            fill_rect(_tx, 13, _tw, 1, 1);
            for (let _li = 1; _li < S.actionPopupLines.length; _li++) {
                const _ly = 12 + _li * 14;
                const _lw = S.actionPopupLines[_li].length * 6;
                const _lx = Math.floor((128 - _lw) / 2);
                if (_li === S.actionPopupHighlight) {
                    fill_rect(0, _ly - 1, 128, 13, 1);
                    print(_lx, _ly, S.actionPopupLines[_li], 0);
                } else {
                    print(_lx, _ly, S.actionPopupLines[_li], 1);
                }
            }
        } else if (S.actionPopupLines.length >= 2) {
            print(4, 22, S.actionPopupLines[0], 1);
            print(4, 34, S.actionPopupLines[1], 1);
        } else {
            print(4, 28, S.actionPopupLines[0], 1);
        }
        return;
    }

    /* No-note flash: ~600ms after pressing an empty step with no prior pad */
    if (S.noNoteFlashEndTick >= 0 && S.activeBank !== 6) {
        print(4, 22, 'NO NOTE', 1);
        print(4, 34, 'Play a pad first', 1);
        return;
    }

    /* Step edit: show assigned notes and step identity */
    if (S.heldStep >= 0) {
        if (S.activeBank === 6 && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
            /* CC step-edit: 8 knobs set CC values at this step's tick */
            const _t6s = S.activeTrack;
            print(4, 10, 'CC  S' + (S.heldStep + 1), 1);
            for (let _k = 0; _k < 8; _k++) {
                const _col = _k % 4, _row = Math.floor(_k / 4);
                const _x = 4 + _col * 31, _y = 24 + _row * 20;
                const _hi = (S.knobTouched === _k);
                if (_hi) fill_rect(_x - 1, _y - 1, 29, 18, 1);
                const _cc = S.trackCCAssign[_t6s][_k];
                print(_x, _y,     col4(_cc > 0 ? 'C' + _cc : '--'), _hi ? 0 : 1);
                print(_x, _y + 9, col4(String(S.ccStepEditVal[_k])),   _hi ? 0 : 1);
            }
            return;
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum step edit: 3-column Dur/Vel/Ndg; lane note in top bar */
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const note = S.drumLaneNote[t][lane];
            print(4, 10, midiNoteName(note) + '  ' + note, 1);
            if (S.heldStepNotes.length > 0) {
                const tps   = S.drumLaneTPS[t] || 24;
                const LABELS = ['Dur', 'Vel', 'Ndg'];
                const VALS   = [
                    (S.stepEditGate / tps).toFixed(2),
                    String(S.stepEditVel),
                    (S.stepEditNudge >= 0 ? '+' : '') + String(S.stepEditNudge)
                ];
                const COL_X = [13, 51, 89];
                for (let i = 0; i < 3; i++) {
                    const hi = (S.knobTouched === i);
                    if (hi) fill_rect(COL_X[i], 21, 25, 30, 1);
                    print(COL_X[i], 27, LABELS[i], hi ? 0 : 1);
                    print(COL_X[i], 40, VALS[i], hi ? 0 : 1);
                }
            } else {
                print(4, 22, 'STEP EDIT', 1);
                print(4, 34, '(empty)', 1);
            }
            return;
        }
        const ac        = effectiveClip(S.activeTrack);
        if (S.heldStepNotes.length > 0) {
            /* Oct+Pit share a merged block; one note value centered under both labels */
            const root = S.heldStepNotes[0];
            const hiP  = (S.knobTouched === 0 || S.knobTouched === 1);
            if (hiP) fill_rect(2, 20, 46, 24, 1);
            print(2,  23, 'Oct', hiP ? 0 : 1);
            print(27, 23, 'Pit', hiP ? 0 : 1);
            const noteLabel = S.heldStepNotes.length > 1
                ? midiNoteName(root) + ' +' + (S.heldStepNotes.length - 1)
                : midiNoteName(root);
            pixelPrintC(25, 36, noteLabel, hiP ? 0 : 1);
            /* Dur / Vel / Ndg */
            const RHS_LABELS = ['Dur', 'Vel', 'Ndg'];
            const RHS_VALS   = [
                (S.stepEditGate / (S.clipTPS[S.activeTrack][ac] || 24)).toFixed(2),
                String(S.stepEditVel),
                (S.stepEditNudge >= 0 ? '+' : '') + String(S.stepEditNudge)
            ];
            const RHS_X = [52, 77, 102];
            for (let i = 0; i < 3; i++) {
                const hi = (S.knobTouched === i + 2);
                if (hi) fill_rect(RHS_X[i], 20, 23, 24, 1);
                print(RHS_X[i], 23, RHS_LABELS[i], hi ? 0 : 1);
                pixelPrintC(RHS_X[i] + 11, 36, RHS_VALS[i], hi ? 0 : 1);
            }
        } else {
            print(4, 22, 'STEP EDIT', 1);
            print(4, 34, '(empty)', 1);
        }
        return;
    }

    /* Loop view: own priority state so screen is fully cleared first */
    if (S.loopHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const len  = S.drumLaneLength[t];
            print(4, 10, 'TR' + (t + 1) + ' \xb7 LN ' + (lane + 1) + '  DRUM', 1);
            print(4, 22, 'LEN: ' + len + ' STEPS', 1);
            print(4, 34, 'Jog=\xb11  Btn=set page', 1);
            drawTrackRow(46);
        } else {
            const ac_l    = effectiveClip(S.activeTrack);
            const steps_l = S.clipLength[S.activeTrack][ac_l];
            const pages_l = Math.max(1, Math.ceil(steps_l / 16));
            print(4, 10, 'TR' + (S.activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac_l] + '  LOOP', 1);
            print(4, 22, 'LEN: ' + steps_l + ' STEPS', 1);
            print(4, 34, pages_l + ' OF 16 PAGES', 1);
            drawTrackRow(46);
        }
        return;
    }

    if (bank >= 0 && (S.knobTouched >= 0 || inTimeout ||
            (S.shiftHeld && bank === 5 && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) ||
            (S.shiftHeld && bank === 6 && !S.sessionView))) {
        const isDrumLaneBank = (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 0);
        if (isDrumLaneBank) {
            /* DRUM LANE bank overview: mirrors CLIP bank at lane level */
            const t    = S.activeTrack;
            const ac   = effectiveClip(t);
            const lane = S.activeDrumLane[t];
            const len  = S.drumLaneLength[t];
            const tpsIdx = Math.max(0, TPS_VALUES.indexOf(S.drumLaneTPS[t]));
            const sqfl   = S.clipSeqFollow[t][ac] ? 1 : 0;
            const drumLaneLabels = ['Stch', 'Shft', 'Ndg', 'Res', 'Len', 'Qnt', 'Perf', 'SqFl'];
            const drumLaneVals  = [
                fmtStretch(S.bankParams[t][0][0]),
                fmtSign(S.bankParams[t][0][1]),
                fmtSign(S.bankParams[t][0][2]),
                fmtRes(tpsIdx),
                fmtLen(len),
                fmtPct(S.drumLaneQnt[t]),
                S.drumPerformMode[t] === 2 ? 'Rpt2' : S.drumPerformMode[t] === 1 ? 'Rpt1' : 'Vel',
                fmtBool(sqfl),
            ];
            print(4, 0, '[ DRUM LANE ]', 1);
            for (let k = 0; k < 8; k++) {
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                if (hi) fill_rect(colX, rowY, 24, 24, 1);
                print(colX, rowY,      col4(drumLaneLabels[k]), hi ? 0 : 1);
                print(colX, rowY + 12, col4(drumLaneVals[k]),   hi ? 0 : 1);
            }
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 1) {
        /* Drum NOTE FX bank overview */
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        const note    = S.drumLaneNote[t][lane];
        const noteStr = midiNoteName(note) + ' ' + note;
        const knobs   = BANKS[bank].knobs;
        const vals    = S.bankParams[t][bank];
        const hiLane  = (S.knobTouched === 6 || S.knobTouched === 7);

        print(4, 0, '[ NOTE/NOTEFX ]', 1);

        /* K1-K6 (k=0..5): normal grid render */
        for (let k = 0; k < 6; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            print(colX, rowY,      knobs[k].abbrev || '-', hi ? 0 : 1);
            print(colX, rowY + 12, col4(knobs[k].abbrev ? knobs[k].fmt(vals[k]) : null), hi ? 0 : 1);
        }

        /* K7+K8 (k=6,7): merged lane-note block in bottom-right corner.
         * Oct and Smt set the lane's MIDI note (not a real-time processor) —
         * boxed to distinguish them from the effect params above. */
        const LX = 64, LY = 36, LW = 54, LH = 24;
        if (hiLane) {
            fill_rect(LX, LY, LW, LH, 1);
        } else {
            fill_rect(LX,        LY,        LW, 1,  1);  /* top    */
            fill_rect(LX,        LY+LH-1,   LW, 1,  1);  /* bottom */
            fill_rect(LX,        LY,        1,  LH, 1);  /* left   */
            fill_rect(LX+LW-1,   LY,        1,  LH, 1);  /* right  */
        }
        const lc = hiLane ? 0 : 1;
        print(LX + Math.floor((LW/2 - 18) / 2),              LY + 1, 'Oct', lc);
        print(LX + Math.floor(LW/2) + Math.floor((LW/2 - 24) / 2), LY + 1, 'Note', lc);
        const noteX = LX + Math.floor((LW - noteStr.length * 6) / 2);
        print(noteX, LY + 13, noteStr, lc);

        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 5) {
        /* Drum RPT GROOVE bank overview — 8 steps, vel scale (unshifted) or nudge (Shift) */
        const t    = S.activeTrack;
        const lane = S.activeDrumLane[t];
        syncDrumRepeatState(t, lane);
        print(4, 0, '[ RPT GROOVE ]', 1);
        print(S.shiftHeld ? 94 : 106, 0, S.shiftHeld ? 'Nudge' : 'Vel', 1);
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            const gateOn = !!(S.drumRepeatGate[t][lane] & (1 << k));
            if (gateOn) {
                fill_rect(colX, rowY + 1, 24, 4, hi ? 0 : 1);
            } else {
                const bc = hi ? 0 : 1;
                fill_rect(colX, rowY + 1, 24, 1, bc);
                fill_rect(colX, rowY + 4, 24, 1, bc);
                fill_rect(colX, rowY + 1, 1, 4, bc);
                fill_rect(colX + 23, rowY + 1, 1, 4, bc);
            }
            const vs   = S.drumRepeatVelScale[t][lane][k];
            const ndg  = S.drumRepeatNudge[t][lane][k];
            const disp = S.shiftHeld
                ? (ndg === 0 ? ' 0%' : (ndg > 0 ? '+' : '') + ndg + '%')
                : (vs === 100 ? 'Live' : vs + '%');
            print(colX, rowY + 12, col4(disp), hi ? 0 : 1);
        }
        } else if (bank === 6) {
        /* CC PARAM bank overview: label = assigned CC, value = current value */
        const t = S.activeTrack;
        print(4, 0, bankHeader(6), 1);
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            print(colX, rowY,      col4(fmtCCLabel(S.trackCCAssign[t][k])), hi ? 0 : 1);
            print(colX, rowY + 12, col4(String(S.trackCCVal[t][k])),        hi ? 0 : 1);
        }
        } else {
        /* Bank overview — 5 rows; touched knob column inverted */
        const knobs = BANKS[bank].knobs;
        const vals  = S.bankParams[S.activeTrack][bank];
        print(4, 0, bankHeader(bank), 1);
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            print(colX, rowY,      knobs[k].abbrev || '-', hi ? 0 : 1);
            print(colX, rowY + 12, col4(knobs[k].abbrev ? knobs[k].fmt(vals[k]) : null), hi ? 0 : 1);
        }
        }

    } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        /* Drum Track View — idle state */
        const t         = S.activeTrack;
        const lane      = S.activeDrumLane[t];
        const pg        = S.drumLanePage[t];
        const note      = S.drumLaneNote[t][lane];
        const oct       = Math.floor(note / 12) - 2;
        const name      = NOTE_KEYS[note % 12];
        const bankGroup = pg === 0 ? 'Bank: A' : 'Bank: B';
        const bankName  = S.activeBank === 0 ? 'DRUM LANE' : S.activeBank === 1 ? 'NOTE/NOTEFX' : S.activeBank === 5 ? 'RPT GROOVE' : BANKS[S.activeBank] ? BANKS[S.activeBank].name : '?';
        print(4, 0,  'Knob: [ ' + bankName + ' ]', 1);
        print(4, 10, bankGroup + '  Pad: ' + name + oct + ' (' + note + ')', 1);
        const laneBit = 1 << lane;
        if (S.drumLaneSolo[t] & laneBit) {
            const sw = 6 * 6, sx = (128 - sw) >> 1;
            fill_rect(sx, 20, sw, 10, 1);
            print(sx, 21, 'SOLOED', 0);
        } else if (S.drumLaneMute[t] & laneBit) {
            if (Math.floor(S.tickCount / 50) % 2 === 0) {
                const mw = 5 * 6, mx = (128 - mw) >> 1;
                print(mx, 21, 'MUTED', 1);
            }
        }
        drawTrackRow(34);
        for (let _t = 0; _t < NUM_TRACKS; _t++)
            print(_t * 16 + 5, 46, SCENE_LETTERS[S.trackActiveClip[_t]], 1);
        drawDrumPositionBar(t);
    } else {
        /* State 4: normal Track View */
        const recTag  = (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === S.activeTrack)
            ? ' REC' : '';
        const oct     = S.trackOctave[S.activeTrack];
        const octStr  = 'Oct: ' + (oct >= 0 ? '+' : '') + oct;
        const keyScl  = NOTE_KEYS[S.padKey] + ' ' + (SCALE_DISPLAY[S.padScale] || '?');
        const CHAR_W  = 6;
        const keySclX = 128 - 4 - keyScl.length * CHAR_W;
        print(4, 0,  'Knob: [ ' + BANKS[S.activeBank].name + ' ]' + recTag, 1);
        print(4, 10, octStr, 1);
        print(keySclX, 10, keyScl, 1);
        if (S.scaleAware) fill_rect(keySclX, 18, keyScl.length * CHAR_W, 1, 1);
        drawTrackRow(34);
        for (let t = 0; t < NUM_TRACKS; t++)
            print(t * 16 + 5, 46, SCENE_LETTERS[S.trackActiveClip[t]], 1);
        drawPositionBar(S.activeTrack);
    }
}


function drawDrumPositionBar(t) {
    const len        = S.drumLaneLength[t];
    const totalPages = Math.max(1, Math.ceil(len / 16));
    const viewPage   = Math.min(S.drumStepPage[t], totalPages - 1);
    const cs         = S.drumCurrentStep[t];
    const playPage   = (S.playing && S.trackClipPlaying[t] && cs >= 0)
                     ? Math.min(Math.floor(cs / 16), totalPages - 1) : -1;
    const barY = 57, barH = 5, segGap = 1;
    const segW   = Math.max(2, Math.floor((120 - (totalPages - 1) * segGap) / totalPages));
    const startX = 4;
    for (let pg = 0; pg < totalPages; pg++) {
        const x = startX + pg * (segW + segGap);
        if (pg === viewPage) {
            fill_rect(x, barY, segW, barH, 1);
        } else if (pg === playPage) {
            fill_rect(x, barY, segW, 1, 1);
            fill_rect(x, barY + barH - 1, segW, 1, 1);
            fill_rect(x, barY, 1, barH, 1);
            fill_rect(x + segW - 1, barY, 1, barH, 1);
        } else {
            fill_rect(x, barY + barH - 1, segW, 1, 1);
        }
    }
    if (S.playing && S.trackClipPlaying[t] && cs >= 0) {
        const dotX = Math.floor(cs * 128 / Math.max(1, len));
        const viewSegStart = startX + viewPage * (segW + segGap);
        const onSolid = dotX >= viewSegStart && dotX < viewSegStart + segW;
        fill_rect(dotX, barY, 1, barH, onSolid ? 0 : 1);
    }
}

function fmtHex(b) {
    return (b & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

function readActiveSetUuid() {
    try {
        const raw = (typeof host_read_file === 'function')
            ? host_read_file('/data/UserData/schwung/active_set.txt') : null;
        if (!raw) return '';
        return raw.split('\n')[0].trim();
    } catch (e) {
        return '';
    }
}


function syncClipsFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    for (let t = 0; t < NUM_TRACKS; t++) {
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    S.clipSteps[t][c][s] = bulk[s] === '1' ? 1 : (bulk[s] === '2' ? 2 : 0);
                S.clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined)
                S.clipLength[t][c] = parseInt(len, 10) || 16;
            const tpsRaw = host_module_get_param('t' + t + '_c' + c + '_tps');
            if (tpsRaw !== null && tpsRaw !== undefined) {
                const tpsVal = parseInt(tpsRaw, 10);
                S.clipTPS[t][c] = TPS_VALUES.indexOf(tpsVal) >= 0 ? tpsVal : 24;
            }
        }
        const ac2 = host_module_get_param('t' + t + '_active_clip');
        if (ac2 !== null && ac2 !== undefined) {
            S.trackActiveClip[t] = parseInt(ac2, 10) | 0;
            S.lastDspActiveClip[t] = S.trackActiveClip[t];
        }
        const po = host_module_get_param('t' + t + '_pad_octave');
        if (po !== null && po !== undefined) S.padOctave[t] = parseInt(po, 10) | 0;
        readTrackConfig(t);
        for (let b = 0; b < 7; b++) readBankParams(t, b);
        readTarpStepVel(t);
        /* Drum track: sync clip content flags and active lane data */
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
            syncDrumClipContent(t);
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        }
    }
    const kp = host_module_get_param('key');
    if (kp !== null && kp !== undefined) S.padKey   = parseInt(kp, 10) | 0;
    const sp = host_module_get_param('scale');
    if (sp !== null && sp !== undefined) S.padScale = parseInt(sp, 10) | 0;
    const lqp = host_module_get_param('launch_quant');
    if (lqp !== null && lqp !== undefined) S.launchQuant = parseInt(lqp, 10) | 0;
    const iqp = host_module_get_param('inp_quant');
    if (iqp !== null && iqp !== undefined) S.inpQuant = iqp === '1';
    const micp = host_module_get_param('midi_in_channel');
    if (micp !== null && micp !== undefined) S.midiInChannel = parseInt(micp, 10) | 0;
    const monRaw = host_module_get_param('metro_on');
    if (monRaw !== null && monRaw !== undefined) {
        S.metronomeOn = parseInt(monRaw, 10) | 0;
        if (S.metronomeOn !== 0) S.metronomeOnLast = S.metronomeOn;
    }
    const mvolRaw = host_module_get_param('metro_vol');
    if (mvolRaw !== null && mvolRaw !== undefined) S.metronomeVol = parseInt(mvolRaw, 10) | 0;
    const swaRaw = host_module_get_param('swing_amt');
    if (swaRaw !== null && swaRaw !== undefined) S.swingAmt = parseInt(swaRaw, 10) | 0;
    const swrRaw = host_module_get_param('swing_res');
    if (swrRaw !== null && swrRaw !== undefined) S.swingRes = parseInt(swrRaw, 10) | 0;
}

/* Targeted re-sync after undo/redo: re-read only the affected clips rather than all 64.
 * infoStr format: "d t c" (drum) or "m t0 c0 t1 c1 ..." (melodic, 1-16 pairs).
 * Falls back to full syncClipsFromDsp() if infoStr is missing or unparseable. */
function syncClipsTargeted(infoStr) {
    if (!infoStr || typeof host_module_get_param !== 'function') { syncClipsFromDsp(); return; }
    const parts = infoStr.split(' ');
    if (parts.length < 3) { syncClipsFromDsp(); return; }
    const isDrum = parts[0] === 'd';
    for (let i = 1; i + 1 < parts.length; i += 2) {
        const t = parseInt(parts[i], 10), c = parseInt(parts[i + 1], 10);
        if (t < 0 || t >= NUM_TRACKS || c < 0 || c >= NUM_CLIPS) continue;
        if (isDrum) {
            syncDrumClipContent(t);
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        } else {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    S.clipSteps[t][c][s] = bulk[s] === '1' ? 1 : (bulk[s] === '2' ? 2 : 0);
                S.clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined) S.clipLength[t][c] = parseInt(len, 10) || 16;
            const tpsRaw = host_module_get_param('t' + t + '_c' + c + '_tps');
            if (tpsRaw !== null && tpsRaw !== undefined) {
                const tpsVal = parseInt(tpsRaw, 10);
                S.clipTPS[t][c] = TPS_VALUES.indexOf(tpsVal) >= 0 ? tpsVal : 24;
            }
            if (c === S.trackActiveClip[t]) refreshPerClipBankParams(t);
        }
    }
    S.screenDirty = true;
}

function syncMuteSoloFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    const muteStr = host_module_get_param('mute_state');
    const soloStr = host_module_get_param('solo_state');
    if (muteStr) for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackMuted[_t]  = muteStr[_t]  === '1';
    if (soloStr) for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackSoloed[_t] = soloStr[_t] === '1';
    for (let _n = 0; _n < 16; _n++) {
        const snap = host_module_get_param('snap_' + _n);
        if (snap && snap.length >= 17) {
            S.snapshots[_n] = {
                mute: Array.from(snap.substring(0, 8)).map(function(c) { return c === '1'; }),
                solo: Array.from(snap.substring(9, 17)).map(function(c) { return c === '1'; })
            };
        } else {
            S.snapshots[_n] = null;
        }
    }
    const saRaw = host_module_get_param('scale_aware');
    if (saRaw !== null && saRaw !== undefined) S.scaleAware = saRaw === '1' ? 1 : 0;
    S.screenDirty = true;
}

globalThis.init = function () {
    installConsoleOverride('SEQ8');
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
    S.currentSetUuid = readActiveSetUuid();
    const currentDspNonce = (typeof host_module_get_param === 'function')
        ? host_module_get_param('instance_id') : null;
    const dspUuid = (typeof host_module_get_param === 'function')
        ? (host_module_get_param('state_uuid') || '') : '';
    if (currentDspNonce) S.lastDspInstanceId = currentDspNonce;
    if (S.currentSetUuid && dspUuid !== S.currentSetUuid) {
        S.pendingSetLoad = true;
    } else if (S.currentSetUuid && typeof host_file_exists === 'function') {
        const sp = '/data/UserData/schwung/set_state/' + S.currentSetUuid + '/seq8-state.json';
        if (!host_file_exists(sp)) S.pendingSetLoad = true;
    }

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
     * Runs after DSP sync so sidecar overrides stale sync values.
     * Also applies first-run defaults for S.scaleAware / S.metronomeVol when no sidecar exists. */
    (function () {
        const uiSp = uuidToUiStatePath(S.currentSetUuid);
        let us = null;
        if (typeof host_read_file === 'function' && typeof host_file_exists === 'function'
                && host_file_exists(uiSp)) {
            try { us = JSON.parse(host_read_file(uiSp)); } catch (e) {}
        }
        if (us && us.v >= 1) {
            if (typeof us.at === 'number' && us.at >= 0 && us.at < NUM_TRACKS)
                S.activeTrack = us.at;
            if (Array.isArray(us.ac)) {
                for (let _t = 0; _t < NUM_TRACKS; _t++) {
                    const _c = us.ac[_t];
                    if (typeof _c === 'number' && _c >= 0 && _c < NUM_CLIPS)
                        S.trackActiveClip[_t] = _c;
                }
            }
            S.sessionView = us.sv === 1;
            if (Array.isArray(us.dl)) {
                for (let _t = 0; _t < NUM_TRACKS; _t++) {
                    const _l = us.dl[_t];
                    if (typeof _l === 'number' && _l >= 0 && _l < DRUM_LANES)
                        S.activeDrumLane[_t] = _l;
                }
            }
            if (typeof us.bm === 'number') S.beatMarkersEnabled = us.bm !== 0;
            /* Perf mod state (v=2+) */
            if (us.v >= 2) {
                if (typeof us.pm === 'number') S.perfModsToggled = us.pm & 0xFFFFFF;
                S.perfLatchMode = us.lm === 1;
                if (typeof us.rs === 'number' && us.rs >= 0 && us.rs < 16) {
                    S.perfRecalledSlot = us.rs;
                    if (Array.isArray(us.us)) {
                        for (let _i = 0; _i < 8; _i++) {
                            if (typeof us.us[_i] === 'number')
                                S.perfSnapshots[8 + _i] = us.us[_i];
                        }
                    }
                    S.perfRecalledMods = S.perfSnapshots[S.perfRecalledSlot] || 0;
                }
                const _pm = S.perfModsToggled | S.perfRecalledMods;
                if (_pm) S.pendingDefaultSetParams.push({ key: 'perf_mods', val: String(_pm) });
            }
        } else {
            /* No sidecar: apply first-run defaults. */
            S.scaleAware   = 1;
            S.metronomeVol = 100;
            if (S.pendingSetLoad) {
                S.uiDefaultsApplyAfterSync = true; /* re-apply after state_load re-sync */
            } else {
                S.pendingDefaultSetParams = [
                    { key: 'scale_aware', val: '1' },
                    { key: 'metro_vol',   val: '100' }
                ];
            }
        }
    })();

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

globalThis.tick = function () {
    S.tickCount++;

    /* Reapply cable-2 channel remap if anything affecting it changed. */
    {
        const _rt = S.activeTrack;
        const _rr = S.trackRoute[_rt];
        const _rc = S.trackChannel[_rt];
        const _rm = S.midiInChannel;
        if (_rt !== _lastRemapTrack || _rr !== _lastRemapRoute ||
                _rc !== _lastRemapChannel || _rm !== _lastRemapMidiIn) {
            applyExtMidiRemap();
            _lastRemapTrack = _rt; _lastRemapRoute = _rr;
            _lastRemapChannel = _rc; _lastRemapMidiIn = _rm;
        }
    }

    /* Suspend detection: host swaps clear_screen to a no-op while we're parked.
     * Save state on the transition edge; let tick run normally (display is no-oped by host). */
    const isSuspended = S._origClearScreen && (clear_screen !== S._origClearScreen);
    if (isSuspended && !S._wasSuspended) { saveState(); removeFlagsWrap(); }
    if (!isSuspended && S._wasSuspended) {
        installFlagsWrap();
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

    /* Flush live note batches: offs first, then ons; one set_param per track so no coalescing.
     * Defer for 1 tick after any step button event so the step set_param clears its audio
     * block before live_notes fires — otherwise live_notes can overwrite step toggles. */
    if (S.tickCount > S.stepOpTick + 1) {
        for (let _t = 0; _t < NUM_TRACKS; _t++) {
            if (pendingLiveNotes[_t].length === 0) continue;
            const evts = pendingLiveNotes[_t];
            pendingLiveNotes[_t] = [];
            const parts = [];
            for (const e of evts) if (e.isOff)  parts.push('off ' + e.pitch);
            for (const e of evts) if (!e.isOff) parts.push('on '  + e.pitch + ' ' + e.vel);
            host_module_set_param('t' + _t + '_live_notes', parts.join(' '));
        }
    }

    /* Drain ROUTE_EXTERNAL queue: DSP enqueues sequenced notes; JS sends via USB-A */
    if (typeof host_module_get_param === 'function') {
        const eq = host_module_get_param('ext_queue');
        if (eq && eq.length > 0) {
            const msgs = eq.split(';');
            for (let mi = 0; mi < msgs.length; mi++) {
                const p = msgs[mi].split(' ');
                if (p.length < 3) continue;
                const s = parseInt(p[0], 10), d1 = parseInt(p[1], 10), d2 = parseInt(p[2], 10);
                const cin = (s >> 4) & 0x0F;
                if (typeof move_midi_external_send === 'function')
                    move_midi_external_send([cin, s, d1, d2]);
            }
        }
    }

    /* Clear CC step-edit active flag once the step is released */
    if (S.ccStepEditActive && S.heldStep < 0)
        S.ccStepEditActive = false;

    /* Poll live CC automation values for LED feedback when CC bank is visible and S.playing */
    if (S.activeBank === 6 && S.playing && !S.sessionView && !S.ccStepEditActive) {
        const _lv = host_module_get_param('t' + S.activeTrack + '_cc_live_vals');
        if (_lv) {
            const _lp = _lv.split(' ');
            for (let _k = 0; _k < 8 && _k < _lp.length; _k++) {
                const _v = parseInt(_lp[_k], 10);
                S.trackCCLiveVal[S.activeTrack][_k] = (_v >= 0 && _v <= 127) ? _v : -1;
            }
        }
    }

    /* Update scratch palette entries for CC bank LED brightness (cached: only send SysEx on change) */
    if (S.activeBank === 6 && !S.sessionView && !S.ccStepEditActive && (S.recordArmed || S.playing) &&
            (S.tickCount % POLL_INTERVAL) === 0) {
        if (S.recordArmed !== S.ccPaletteCacheArmed || S.activeTrack !== S.ccPaletteCacheTrack) {
            S.ccPaletteCache.fill(-1);
            S.ccPaletteCacheArmed = S.recordArmed;
            S.ccPaletteCacheTrack = S.activeTrack;
        }
        let _paletteChanged = false;
        for (let _k = 0; _k < 8; _k++) {
            let _newVal;
            if (S.recordArmed) {
                _newVal = Math.round(S.trackCCVal[S.activeTrack][_k] / 127 * 255);
            } else {
                const _lv2 = S.trackCCLiveVal[S.activeTrack][_k];
                _newVal = _lv2 >= 0 ? Math.round(_lv2 / 127 * 255) : -1;
            }
            if (_newVal !== S.ccPaletteCache[_k]) {
                S.ccPaletteCache[_k] = _newVal;
                if (_newVal >= 0) {
                    if (S.recordArmed)
                        setPaletteEntryRGB(CC_SCRATCH_PALETTE_BASE + _k, _newVal, 0, 0);
                    else
                        setPaletteEntryRGB(CC_SCRATCH_PALETTE_BASE + _k, 0, _newVal, 0);
                    _paletteChanged = true;
                }
            }
        }
        if (_paletteChanged) {
            reapplyPalette();
            /* reapplyPalette resets CC LED hardware states; force-resend transport LEDs
             * so input_filter.mjs buttonCache doesn't silently suppress them. */
            setButtonLED(MovePlay,   S.playing ? Green : LED_OFF, true);
            setButtonLED(MoveRec,    S.recordArmed ? Red : LED_OFF, true);
            setButtonLED(MoveSample, S.dspMergeState >= 2 ? Green : S.dspMergeState === 1 ? Red : LED_OFF, true);
        }
    }

    /* Deferred Rpt1 lane switch (coalescing workaround: must be sole set_param in its tick) */
    if (S.pendingRepeatLane >= 0) {
        host_module_set_param('t' + S.pendingRepeatLaneTrack + '_drum_repeat_lane', String(S.pendingRepeatLane));
        S.pendingRepeatLane = -1;
    }

    /* Set change detected in init(): send UUID so DSP constructs path and loads. */
    if (S.pendingSetLoad && typeof host_module_set_param === 'function') {
        S.pendingSetLoad = false;
        disarmRecord();
        S.heldStep = -1; S.heldStepBtn = -1; S.heldStepNotes = []; S.stepWasEmpty = false; S.stepWasHeld = false;
        S.seqActiveNotes.clear(); S.seqLastStep = -1; S.seqLastClip = -1;
        S.pendingDspSync = 5;
        host_module_set_param('state_load', S.currentSetUuid || '');
    }

    /* Drain first-run default set_params one per tick, after state is fully settled. */
    if (S.pendingDefaultSetParams.length > 0 && !S.pendingSetLoad && S.pendingDspSync === 0
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
            if (S.uiDefaultsApplyAfterSync) {
                S.uiDefaultsApplyAfterSync = false;
                S.scaleAware   = 1;
                S.metronomeVol = 100;
                S.pendingDefaultSetParams = [
                    { key: 'scale_aware', val: '1' },
                    { key: 'metro_vol',   val: '100' }
                ];
            }
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Deferred targeted re-sync after undo/redo: re-read only the affected clip(s). */
    if (S.pendingUndoSync > 0) {
        S.pendingUndoSync--;
        if (S.pendingUndoSync === 0) {
            const _info = host_module_get_param('last_restore');
            syncClipsTargeted(_info);
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Deferred _steps re-read after _reassign: confirm DSP move in JS mirror */
    if (S.pendingDrumResync > 0) {
        S.pendingDrumResync--;
        if (S.pendingDrumResync === 0) {
            syncDrumLanesMeta(S.pendingDrumResyncTrack);
            syncDrumLaneSteps(S.pendingDrumResyncTrack, S.activeDrumLane[S.pendingDrumResyncTrack]);
            forceRedraw();
        }
    }
    if (S.pendingDrumLaneResync > 0) {
        S.pendingDrumLaneResync--;
        if (S.pendingDrumLaneResync === 0) {
            syncDrumLaneSteps(S.pendingDrumLaneResyncTrack, S.pendingDrumLaneResyncLane);
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
                forceRedraw();
            }
        }
    }

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

        if ((S.tickCount % POLL_INTERVAL) === 0) { pollDSP(); S.screenDirty = true; }

        /* Step hold threshold: once elapsed, close the tap window so release won't toggle.
         * Also auto-assign empty step now so knobs work immediately in step edit. */
        if (S.heldStep >= 0 && S.heldStepBtn >= 0 && S.stepBtnPressedTick[S.heldStepBtn] >= 0 &&
                (S.tickCount - S.stepBtnPressedTick[S.heldStepBtn]) >= STEP_HOLD_TICKS) {
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            if (S.activeBank === 6 && S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                /* CC step-edit: init edit values from current live CC values */
                for (let _ck = 0; _ck < 8; _ck++)
                    S.ccStepEditVal[_ck] = S.trackCCVal[S.activeTrack][_ck];
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
                        S.stepEditVel   = rv !== null ? parseInt(rv, 10) : S.stepEditVel;
                        S.stepEditGate  = rg !== null ? parseInt(rg, 10) : (S.drumLaneTPS[t] || 24);
                        S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                    }
                }
                S.screenDirty = true;
            } else if (S.stepWasEmpty && S.heldStepNotes.length === 0 && typeof host_module_set_param === 'function') {
                const ac_h = effectiveClip(S.activeTrack);
                const assignNote = S.lastPlayedNote >= 0 ? S.lastPlayedNote : defaultStepNote();
                const assignVel  = effectiveVelocity(S.lastPadVelocity);
                host_module_set_param('t' + S.activeTrack + '_c' + ac_h + '_step_' + S.heldStep + '_toggle', assignNote + ' ' + assignVel);
                const raw_h = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + S.activeTrack + '_c' + ac_h + '_step_' + S.heldStep + '_notes') : null;
                S.heldStepNotes = (raw_h && raw_h.trim().length > 0)
                    ? raw_h.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                    : [];
                S.clipSteps[S.activeTrack][ac_h][S.heldStep] = S.heldStepNotes.length > 0 ? 1 : 0;
                if (S.heldStepNotes.length > 0) S.clipNonEmpty[S.activeTrack][ac_h] = true;
                const rv = host_module_get_param('t' + S.activeTrack + '_c' + ac_h + '_step_' + S.heldStep + '_vel');
                const rg = host_module_get_param('t' + S.activeTrack + '_c' + ac_h + '_step_' + S.heldStep + '_gate');
                const rn = host_module_get_param('t' + S.activeTrack + '_c' + ac_h + '_step_' + S.heldStep + '_nudge');
                S.stepEditVel   = rv !== null ? parseInt(rv, 10) : 100;
                S.stepEditGate  = rg !== null ? parseInt(rg, 10) : 12;
                S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                S.screenDirty = true;
            }
        }

        /* CC 50 hold detection: crossing threshold enters session overview */
        if (S.noteSessionPressedTick >= 0 && !S.sessionOverlayHeld &&
                (S.tickCount - S.noteSessionPressedTick) >= NOTE_SESSION_HOLD_TICKS) {
            S.noteSessionPressedTick = -1;
            S.sessionOverlayHeld = true;
            invalidateLEDCache();
            S.screenDirty = true;
            S.overviewCache = Array.from({length: NUM_TRACKS}, function(_, t) {
                return Array.from({length: NUM_CLIPS}, function(_, c) {
                    return clipHasContent(t, c);
                });
            });
        }

        /* Refresh scene state cache for O(1) lookups in LED update functions */
        for (let _i = 0; _i < 16; _i++) {
            S.cachedSceneAllPlaying[_i] = sceneAllPlaying(_i);
            S.cachedSceneAllQueued[_i]  = sceneAllQueued(_i);
            S.cachedSceneAnyPlaying[_i] = sceneAnyPlaying(_i);
        }

        /* Transport LEDs */
        setButtonLED(MovePlay, S.playing ? Green : LED_OFF);
        setButtonLED(MoveRec,  S.recordArmed ? Red : LED_OFF);
        setButtonLED(MoveSample, S.dspMergeState >= 2 ? Green : S.dspMergeState === 1 ? Red : LED_OFF);
        /* Loop LED: flash White at 1/8 rate while Perf Mode view is locked (Session
         * View only) or drum repeat latched; dim DarkGrey while Loop is held; off otherwise. */
        {
            let loopColor = LED_OFF;
            const _lt = S.activeTrack;
            const _rptLatched = S.drumRepeatLatched[_lt] || S.drumRepeat2LatchedLanes[_lt].size > 0;
            if (S.sessionView && S.perfViewLocked) {
                loopColor = flashAtRate(48) ? White : LED_OFF;
            } else if (_rptLatched) {
                loopColor = flashAtRate(48) ? White : LED_OFF;
            } else if (S.sessionView && S.loopHeld) {
                loopColor = DarkGrey;
            }
            setButtonLED(MoveLoop, loopColor);
        }
        {
            const _muted      = S.trackMuted[S.activeTrack];
            const _soloed     = S.trackSoloed[S.activeTrack];
            const _muteBlink  = Math.floor(S.tickCount / 24) % 2;
            setButtonLED(MoveMute, _muted ? 124 : (_soloed ? (_muteBlink ? 124 : 0) : 16));
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
            const blinkOn = Math.floor(S.tickCount / 96) % 2 === 0;
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
    }
    /* Flush buffered recording events — one batched set_param per tick to survive coalescing.
     * Note-ons take priority; note-offs wait until the next tick if both are pending. */
    if (S.recordArmed && !S.recordCountingIn && typeof host_module_set_param === 'function') {
        if (S._recNoteOns.length > 0) {
            const rt   = S._recNoteOns[0].rt;
            const pairs = S._recNoteOns.map(function(n) { return n.pitch + ' ' + n.vel; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_on', pairs);
            S._recNoteOns.length = 0;
        } else if (S._recNoteOffs.length > 0) {
            const rt     = S._recNoteOffs[0].rt;
            const pitches = S._recNoteOffs.map(function(n) { return n.pitch; }).join(' ');
            host_module_set_param('t' + rt + '_record_note_off', pitches);
            S._recNoteOffs.length = 0;
        }
    }

    if (S.screenDirty) { S.screenDirty = false; drawUI(); }

};

/* ------------------------------------------------------------------ */
/* MIDI input                                                           */
/* ------------------------------------------------------------------ */

function _onCC_jog(d1, d2) {
    /* Bake confirm: jog click confirms/cancels when dialog is open */
    if (d1 === 3 && d2 === 127 && S.confirmBake) {
        if (!S.confirmBakeIsDrum) {
            if (S.confirmBakeSel === 0) {
                host_module_set_param('bake', S.confirmBakeTrack + ' ' + S.confirmBakeClip);
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                showActionPopup('BAKED');
                S.pendingBankRefresh = S.confirmBakeTrack;
                S.pendingStepsReread      = 2;
                S.pendingStepsRereadTrack = S.confirmBakeTrack;
                S.pendingStepsRereadClip  = S.confirmBakeClip;
            }
        } else {
            /* drum: 0=CLIP, 1=LANE, 2=CANCEL */
            if (S.confirmBakeSel < 2) {
                const bakeMode = S.confirmBakeSel === 0 ? 2 : 1;
                host_module_set_param('bake',
                    S.confirmBakeTrack + ' ' + S.confirmBakeClip + ' ' + bakeMode);
                S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
                showActionPopup('BAKED');
                S.pendingBankRefresh = S.confirmBakeTrack;
                if (S.confirmBakeClip === S.trackActiveClip[S.confirmBakeTrack]) {
                    S.pendingDrumResync      = 2;
                    S.pendingDrumResyncTrack = S.confirmBakeTrack;
                }
            }
        }
        S.confirmBake = false;
        S.screenDirty = true;
        return;
    }

    /* CC 3 = jog wheel physical click */
    if (d1 === 3 && d2 === 127 && S.globalMenuOpen) {
        if (S.tapTempoOpen) {
            closeTapTempo();
            S.screenDirty = true;
            return;
        }
        if (S.confirmClearSession) {
            if (S.confirmClearSel === 0) doClearSession();
            else { S.confirmClearSession = false; }
            S.screenDirty = true;
            return;
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
            /* Drum: Shift+Delete+jog = reset all real-time FX banks */
            resetFxBanks(S.activeTrack);
            showActionPopup('CLIP PARAMS', 'RESET');
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
            S.undoSeqArpSnapshot = { track: _arpTrack, params: _arpParams };
            showActionPopup('CLIP PARAMS', 'RESET');
        }
        return;
    }
    if (d1 === 3 && d2 === 127 && S.deleteHeld && !S.sessionView) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            if (S.drumPerformMode[S.activeTrack] > 0) {
                /* Rpt/Rpt2 mode: Delete+jog = reset current lane groove params */
                const _rt = S.activeTrack;
                const _rl = S.activeDrumLane[_rt];
                S.drumRepeatGate[_rt][_rl] = 0xFF;
                for (let _s = 0; _s < 8; _s++) {
                    S.drumRepeatVelScale[_rt][_rl][_s] = 100;
                    S.drumRepeatNudge[_rt][_rl][_s]    = 0;
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _rt + '_l' + _rl + '_repeat_groove_reset', '1');
                showActionPopup('RPT GROOVE', 'RESET');
            } else {
                /* Drum: Delete+jog = reset only the active real-time FX bank */
                const REAL_TIME_BANKS = [1, 2, 3];
                if (REAL_TIME_BANKS.indexOf(S.activeBank) >= 0) {
                    resetSingleFxBank(S.activeTrack, S.activeBank);
                    showActionPopup('BANK RESET');
                }
            }
        } else {
            /* CC PARAM bank: Delete+jog clears all CC automation for active clip */
            if (S.activeBank === 6) {
                const _t = S.activeTrack, _c = S.trackActiveClip[_t];
                S.trackCCAutoBits[_t][_c] = 0;
                S.trackCCLiveVal[_t] = new Array(8).fill(-1);
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _t + '_cc_auto_clear', String(_c));
                showActionPopup('CC AUTO', 'CLEAR');
                invalidateLEDCache();
                return;
            }
            resetFxBanks(S.activeTrack);
            S.undoSeqArpSnapshot = null;
            showActionPopup('BANK RESET');
        }
        return;
    }
    /* Plain jog click on drum track: toggle Velocity / Repeat pad mode */
    if (d1 === 3 && d2 === 127 && !S.shiftHeld && !S.deleteHeld && !S.copyHeld && !S.muteHeld &&
            !S.sessionView && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const t = S.activeTrack;
        if (S.drumPerformMode[t] === 1) {
            host_module_set_param('t' + t + '_drum_repeat_stop', '1');
            S.drumRepeatHeldPad[t] = -1;
        }
        if (S.drumPerformMode[t] === 2) {
            S.drumRepeat2HeldLanes[t].clear();
            S.drumRepeat2LatchedLanes[t].clear();
            host_module_set_param('t' + t + '_drum_repeat2_stop', '1');
        }
        S.drumRepeatLatched[t]  = false;
        S.drumPerformMode[t]    = (S.drumPerformMode[t] + 1) % 3;
        showModePopup('PERFORMANCE PADS',
            ['Velocity', 'Repeat Play (Rpt1)', 'Repeat Set (Rpt2)'],
            S.drumPerformMode[t]);
        return;
    }

    if (d1 === MoveMainKnob) {
        if (S.confirmBake) {
            const delta = decodeDelta(d2);
            if (delta !== 0) {
                if (S.confirmBakeIsDrum) {
                    S.confirmBakeSel = (S.confirmBakeSel + (delta > 0 ? 1 : 2)) % 3;
                } else {
                    S.confirmBakeSel = S.confirmBakeSel === 0 ? 1 : 0;
                }
                S.screenDirty = true;
            }
            return;
        }
        if (S.globalMenuOpen && !S.shiftHeld) {
            if (S.tapTempoOpen) {
                const delta = decodeDelta(d2);
                if (delta !== 0) {
                    S.tapTempoBpm = Math.max(40, Math.min(250, S.tapTempoBpm + delta));
                    S.screenDirty = true;
                }
            } else if (S.confirmClearSession) {
                const delta = decodeDelta(d2);
                if (delta !== 0) { S.confirmClearSel = S.confirmClearSel === 0 ? 1 : 0; S.screenDirty = true; }
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
                if (S.sessionView) {
                    if (!S.shiftHeld) {
                        S.sceneRow = Math.min(NUM_CLIPS - 4, Math.max(0, S.sceneRow + delta));
                        forceRedraw();
                    }
                    /* Shift + jog in Session View: no-op */
                } else if (S.shiftHeld) {
                    /* Track View + Shift: step active track 0–7, clamp at ends */
                    const next = Math.min(NUM_TRACKS - 1, Math.max(0, S.activeTrack + delta));
                    if (next !== S.activeTrack) {
                        extNoteOffAll();
                        handoffRecordingToTrack(next);
                        S.activeTrack = next;
                        refreshPerClipBankParams(next);
                        computePadNoteMap();
                        S.seqActiveNotes.clear();
                        S.seqLastStep = -1;
                        S.seqLastClip = -1;
                        forceRedraw();
                    }
                } else if (S.loopHeld) {
                    /* Track View + Loop held: adjust length ±1 step */
                    const _t  = S.activeTrack;
                    if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                        /* Drum: adjust active lane length */
                        const _lane = S.activeDrumLane[_t];
                        const _cur  = S.drumLaneLength[_t];
                        const _nv   = Math.max(1, Math.min(256, _cur + delta));
                        if (_nv !== _cur) {
                            S.drumLaneLength[_t] = _nv;
                            const _maxPage = Math.max(0, Math.ceil(_nv / 16) - 1);
                            if (S.drumStepPage[_t] > _maxPage) S.drumStepPage[_t] = _maxPage;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + _t + '_l' + _lane + '_clip_length', String(_nv));
                            forceRedraw();
                        }
                    } else {
                    const _ac = effectiveClip(_t);
                    const _cur = S.clipLength[_t][_ac];
                    const _nv  = Math.max(1, Math.min(256, _cur + delta));
                    if (_nv !== _cur) {
                        S.clipLength[_t][_ac] = _nv;
                        const _maxPage = Math.max(0, Math.ceil(_nv / 16) - 1);
                        if (S.trackCurrentPage[_t] > _maxPage) S.trackCurrentPage[_t] = _maxPage;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _t + '_clip_length', String(_nv));
                        forceRedraw();
                    }
                    }
                } else {
                    const cur = S.activeBank;
                    let next  = Math.min(6, Math.max(0, cur + delta));
                    /* HARMZ (2) and ARP OUT (4) hidden on drum tracks */
                    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                        if (next === 2) next = delta > 0 ? 3 : 1;
                        else if (next === 4) next = delta > 0 ? 5 : 3;
                    }
                    if (next !== cur) {
                        S.activeBank = next;
                        readBankParams(S.activeTrack, next);
                        S.bankSelectTick = S.tickCount;
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
        if (!S.shiftHeld && S.jogTouched) { S.jogTouched = false; forceRedraw(); }
    }

    if (d1 === MoveDelete) {
        S.deleteHeld = d2 === 127;
    }

    if (d1 === MoveCopy) {
        S.copyHeld = d2 === 127;
        if (!S.copyHeld) {
            S.copySrc = null;
            invalidateLEDCache();
        }
    }

    if (d1 === MoveMute) {
        S.muteHeld = d2 === 127;
        if (d2 === 127) S.muteUsedAsModifier = false;
        if (S.sessionView) invalidateLEDCache();
    }

    /* Note/Session view toggle: Shift+press = open global menu (Track View only);
     * tap = switch view; hold = session overview */
    if (d1 === MoveNoteSession) {
        if (d2 === 127) {
            if (S.shiftHeld) {
                if (S.globalMenuOpen) { S.globalMenuOpen = false; forceRedraw(); }
                else { openGlobalMenu(); }
            } else if (S.globalMenuOpen && S.tapTempoOpen) {
                closeTapTempo();
                forceRedraw();
            } else if (S.confirmBake) {
                S.confirmBake = false;
                forceRedraw();
            } else if (S.globalMenuOpen && S.confirmClearSession) {
                S.confirmClearSession = false;
                forceRedraw();
            } else if (S.globalMenuOpen) {
                S.globalMenuOpen = false;
                S.lastSentMenuEditValue = null;
                forceRedraw();
            } else {
                S.noteSessionPressedTick = S.tickCount;
            }
        } else if (d2 === 0) {
            if (S.sessionOverlayHeld) {
                S.sessionOverlayHeld = false;
                S.overviewCache = null;
                invalidateLEDCache();
                forceRedraw();
            } else if (S.noteSessionPressedTick >= 0) {
                /* Tap: toggle view */
                S.sessionView = !S.sessionView;
                invalidateLEDCache();
                S.heldStepBtn        = -1;
                S.heldStep           = -1;
                S.heldStepNotes      = [];
                S.stepWasEmpty       = false;
                S.stepWasHeld        = false;
                S.stepBtnPressedTick.fill(-1);
                /* Leaving Session View stops any active loop; mods/latch persist. */
                if (!S.sessionView && (S.perfViewLocked || S.perfStack.length > 0)) {
                    const _hadLoop = S.perfStack.length > 0;
                    S.perfStack         = [];
                    S.perfStickyLengths = new Set();
                    S.perfHoldPadHeld   = false;
                    S.perfViewLocked    = false;
                    S.loopHeld         = false;
                    S.perfModsHeld     = 0;
                    sendPerfMods();
                    /* looper_stop last so set_param coalescing can't eat it */
                    if (_hadLoop && typeof host_module_set_param === 'function')
                        host_module_set_param('looper_stop', '1');
                    invalidateLEDCache();
                }
                if (S.sessionView) {
                    for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF);
                    for (let t = 0; t < 8; t++) setLED(TRACK_PAD_BASE + t, LED_OFF);
                } else {
                    for (let row = 0; row < 4; row++)
                        for (let t = 0; t < 8; t++) setLED(92 - row * 8 + t, LED_OFF);
                }
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
            S.loopPressTick = S.tickCount;
            S.loopHeld      = true;
            forceRedraw();
            return;
        }
        const heldDuration = S.tickCount - S.loopPressTick;
        const wasTap       = heldDuration < LOOP_TAP_TICKS;

        if (S.perfViewLocked) {
            /* Locked + tap → unlock + stop. Long press keeps lock. */
            if (wasTap) {
                S.perfViewLocked     = false;
                S.loopHeld           = false;
                S.loopLastTapEndTick = -999;
                S.perfStack         = [];
                S.perfStickyLengths = new Set();
                S.perfHoldPadHeld   = false;
                S.perfModsHeld     = 0;
                sendPerfMods();
                /* looper_stop last so set_param coalescing can't eat it */
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('looper_stop', '1');
                invalidateLEDCache();
                forceRedraw();
            }
            return;
        }

        if (wasTap && (S.tickCount - S.loopLastTapEndTick) < LOOP_DBLTAP_GAP) {
            /* Second tap → lock Perf Mode; preserve running loop + mods. */
            S.perfViewLocked     = true;
            S.loopHeld           = true;
            S.loopLastTapEndTick = -999;
            forceRedraw();
            return;
        }

        if (wasTap) S.loopLastTapEndTick = S.tickCount;

        /* Normal release: if sticky lengths or hold pad keep loops alive, lock perf mode.
         * Otherwise exit Perf Mode, stop loop, clear all mods. */
        S.loopHeld     = false;
        S.perfModsHeld = 0;
        if (S.perfStickyLengths.size > 0 || S.perfHoldPadHeld) {
            S.perfViewLocked = true;
            /* Keep all stack entries when hold pad is engaged; otherwise filter to sticky */
            if (!S.perfHoldPadHeld)
                S.perfStack = S.perfStack.filter(function(e) { return S.perfStickyLengths.has(e.idx); });
            if (S.perfStack.length > 0 && typeof host_module_set_param === 'function')
                host_module_set_param('looper_arm', String(S.perfStack[S.perfStack.length - 1].ticks));
        } else {
            if (S.perfStack.length > 0 &&
                    typeof host_module_set_param === 'function')
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
        if (d2 === 127 && S.shiftHeld) {
            /* Shift+Loop: double-and-fill active clip or drum lane */
            const _t = S.activeTrack;
            if (S.trackPadMode[_t] === PAD_MODE_DRUM) {
                const _l   = S.activeDrumLane[_t];
                const _len = S.drumLaneLength[_t];
                if (_len * 2 > 256) {
                    showActionPopup('CLIP FULL');
                } else {
                    host_module_set_param('t' + _t + '_l' + _l + '_loop_double_fill', '1');
                    S.drumLaneLength[_t] = _len * 2;
                    S.pendingDrumResync      = 2;
                    S.pendingDrumResyncTrack = _t;
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
                    forceRedraw();
                }
            }
            return;
        }
        S.loopHeld = d2 === 127;
        if (S.loopHeld) {
            /* Latch or clear drum repeat on the active track */
            const _lrt = S.activeTrack;
            if (S.drumPerformMode[_lrt] === 2) {
                S.rpt2LoopPadUsed = false;
                if (S.drumRepeat2HeldLanes[_lrt].size > 0) {
                    for (const _ll of S.drumRepeat2HeldLanes[_lrt]) {
                        S.drumRepeat2LatchedLanes[_lrt].add(_ll);
                    }
                    S.rpt2LoopPadUsed = true;
                }
            } else if (S.drumRepeatLatched[_lrt]) {
                S.drumRepeatLatched[_lrt]  = false;
                S.drumRepeatHeldPad[_lrt]  = -1;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _lrt + '_drum_repeat_stop', '1');
            } else if (S.drumRepeatHeldPad[_lrt] >= 0) {
                S.drumRepeatLatched[_lrt] = true;
            }
            S.heldStepBtn        = -1;
            S.heldStep           = -1;
            S.heldStepNotes      = [];
            S.stepWasEmpty       = false;
            S.stepWasHeld        = false;
            S.stepBtnPressedTick.fill(-1);
        } else {
            /* Loop released — Rpt2: unlatch all if no pad was touched during hold */
            const _lrt = S.activeTrack;
            if (S.drumPerformMode[_lrt] === 2 && !S.rpt2LoopPadUsed &&
                    S.drumRepeat2LatchedLanes[_lrt].size > 0) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _lrt + '_drum_repeat2_stop', '1');
                S.drumRepeat2LatchedLanes[_lrt].clear();
            }
        }
        forceRedraw();
    }

}

function _onCC_transport(d1, d2) {
    /* Back: close global menu if open; otherwise (with Shift) hide module */
    if (d1 === MoveBack && d2 === 127) {
        if (S.globalMenuOpen && S.tapTempoOpen) {
            closeTapTempo();
            forceRedraw();
        } else if (S.confirmBake) {
            S.confirmBake = false;
            forceRedraw();
        } else if (S.globalMenuOpen && S.confirmClearSession) {
            S.confirmClearSession = false;
            forceRedraw();
        } else if (S.globalMenuOpen) {
            S.globalMenuOpen = false;
            S.lastSentMenuEditValue = null;
            forceRedraw();
        } else if (S.shiftHeld) {
            saveState();
            removeFlagsWrap();
            S.ledInitComplete = false;
            invalidateLEDCache();
            clearAllLEDs();
            for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
            if (typeof host_hide_module === 'function') host_hide_module();
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
                } else {
                    host_module_set_param('transport', 'deactivate_all');
                }
            }
        } else if (S.muteHeld) {
            S.muteUsedAsModifier = true;
            if (S.metronomeOn !== 0) S.metronomeOnLast = S.metronomeOn;
            S.metronomeOn = S.metronomeOn === 0 ? S.metronomeOnLast : 0;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('metro_on', String(S.metronomeOn));
            showActionPopup('METRO ' + (S.metronomeOn === 0 ? 'OFF' : 'ON'));
        } else if (S.shiftHeld) {
            /* Restart: atomic DSP-side stop+play. Single set_param avoids
             * coalescing flakiness when stop+play land in same audio block. */
            if (typeof host_module_set_param === 'function') {
                host_module_set_param('transport', S.playing ? 'restart' : 'play');
            }
        } else {
            if (typeof host_module_set_param === 'function')
                host_module_set_param('transport', S.playing ? 'stop' : 'play');
        }
    }

    /* Record button (CC 86): toggle arm/disarm */
    if (d1 === MoveRec && d2 === 127) {
        if (S.recordArmed) {
            disarmRecord();
        } else if (!S.playing) {
            /* Stopped → DSP-side 1-bar count-in; transport+recording fire from render thread */
            const rawBpm = typeof host_module_get_param === 'function'
                ? parseFloat(host_module_get_param('bpm')) : 120;
            const bpm = (rawBpm > 0 && isFinite(rawBpm)) ? rawBpm : 120;
            S.recordArmed         = true;
            S.recordCountingIn    = true;
            S.recordArmedTrack    = S.activeTrack;
            S.recordBpm           = bpm;
            S.countInStartTick    = S.tickCount;
            S.countInBeatStartTick = S.tickCount;
            S.countInQuarterTicks = Math.round(196 * 60 / bpm);
            if (typeof host_module_set_param === 'function')
                host_module_set_param('record_count_in', String(S.activeTrack));
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
            setButtonLED(MoveRec, Red);
        } else {
            /* Playing → arm immediately with no count-in */
            const rawBpmLive = typeof host_module_get_param === 'function'
                ? parseFloat(host_module_get_param('bpm')) : 120;
            S.recordArmed      = true;
            S.recordCountingIn = false;
            S.recordArmedTrack = S.activeTrack;
            S.recordBpm        = (rawBpmLive > 0 && isFinite(rawBpmLive)) ? rawBpmLive : 120;
            setButtonLED(MoveRec, Red);
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + S.activeTrack + '_recording', '1');
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        }
    }

    /* Sample (CC 118, no modifier): cancel bake dialog, stop merge, or open Bake confirm */
    if (d1 === MoveSample && d2 === 127 && !S.shiftHeld) {
        if (S.confirmBake) {
            S.confirmBake = false;
            forceRedraw();
        } else if (S.dspMergeState !== 0) {
            host_module_set_param('merge_stop', '1');
            /* LED stays green until DSP finalizes at page boundary */
        } else {
            S.confirmBake      = true;
            S.confirmBakeIsDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
            S.confirmBakeSel   = S.confirmBakeIsDrum ? 2 : 1;
            S.confirmBakeTrack = S.activeTrack;
            S.confirmBakeClip  = S.trackActiveClip[S.activeTrack];
            S.screenDirty      = true;
        }
    }

    /* Shift+Sample (CC 118): arm / disarm Live Merge for S.activeTrack */
    if (d1 === MoveSample && d2 === 127 && S.shiftHeld) {
        if (S.dspMergeState !== 0) {
            host_module_set_param('merge_stop', '1');
            /* LED stays green until DSP finalizes at page boundary */
        } else {
            host_module_set_param('merge_arm', String(S.activeTrack));
            S.dspMergeTrack    = S.activeTrack;
            S.pendingMergeArm  = true;
            setButtonLED(MoveSample, Red);
        }
    }

    /* Mute button: Delete+Mute = clear all (both views); toggle mute/solo on active track (Track View only).
     * Press: handle Delete+Mute immediately. Release: toggle mute/solo, but only if Mute was not used as
     * a modifier key (e.g. Mute+Play = metro toggle). */
    if (d1 === MoveMute && d2 === 127) {
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
    if (d1 === MoveMute && d2 === 0) {
        if (!S.muteUsedAsModifier && !S.deleteHeld && !S.sessionView) {
            if (S.shiftHeld) setTrackSolo(S.activeTrack, !S.trackSoloed[S.activeTrack]);
            else           setTrackMute(S.activeTrack, !S.trackMuted[S.activeTrack]);
        }
    }

    /* Left/Right: page nav in Track View */
    if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !S.sessionView) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            const totalPages = Math.max(1, Math.ceil(S.drumLaneLength[S.activeTrack] / 16));
            if (d1 === MoveLeft)
                S.drumStepPage[S.activeTrack] = Math.max(0, S.drumStepPage[S.activeTrack] - 1);
            else
                S.drumStepPage[S.activeTrack] = Math.min(totalPages - 1, S.drumStepPage[S.activeTrack] + 1);
        } else {
            const ac         = effectiveClip(S.activeTrack);
            const totalPages = Math.max(1, Math.ceil(S.clipLength[S.activeTrack][ac] / 16));
            if (d1 === MoveLeft)
                S.trackCurrentPage[S.activeTrack] = Math.max(0, S.trackCurrentPage[S.activeTrack] - 1);
            else
                S.trackCurrentPage[S.activeTrack] = Math.min(totalPages - 1, S.trackCurrentPage[S.activeTrack] + 1);
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
    if (d1 === MoveUp   && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            S.drumLanePage[S.activeTrack] = 1;
            syncDrumLanesMeta(S.activeTrack);
            syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
            forceRedraw();
        } else {
        S.trackOctave[S.activeTrack] = Math.min(4, S.trackOctave[S.activeTrack] + 1);
        S.screenDirty = true;
        if (S.heldStep >= 0) forceRedraw();
        }
    }
    if (d1 === MoveDown && d2 > 0 && !S.sessionView && !S.sessionOverlayHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            S.drumLanePage[S.activeTrack] = 0;
            syncDrumLanesMeta(S.activeTrack);
            syncDrumLaneSteps(S.activeTrack, S.activeDrumLane[S.activeTrack]);
            forceRedraw();
        } else {
        S.trackOctave[S.activeTrack] = Math.max(-4, S.trackOctave[S.activeTrack] - 1);
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
        } else if (S.sessionView) {
            S.sceneBtnFlashTick[idx] = S.tickCount;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('launch_scene', String(clipIdx));
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
                /* Launch: legato if S.playing, queued if not */
                if (!S.playing) {
                    S.trackActiveClip[t]  = clipIdx;
                    S.trackCurrentPage[t] = 0;
                    refreshPerClipBankParams(t);
                    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                        S.pendingDrumResync      = 2;
                        S.pendingDrumResyncTrack = t;
                    }
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
            }
        }
    }

}

function _onCC_stepedit(d1, d2) {
    /* CC step-edit: bank 6 + held step — all 8 knobs write CC automation at step's tick */
    if (S.heldStep >= 0 && S.activeBank === 6 &&
            S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM && d1 >= 71 && d1 <= 78) {
        const _kIdx = d1 - 71;
        const _dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
        const _t    = S.activeTrack;
        const _ac   = effectiveClip(_t);
        S.knobTouched          = _kIdx;
        S.knobTurnedTick[_kIdx] = S.tickCount;
        S.screenDirty  = true;
        S.ccStepEditVal[_kIdx] = Math.max(0, Math.min(127, S.ccStepEditVal[_kIdx] + _dir));
        const _tps   = S.clipTPS[_t][_ac] || 24;
        const _tick  = S.heldStep * _tps;
        const _hold  = Math.min(65535, _tick + _tps - 1);
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + _t + '_cc_auto_set2',
                _ac + ' ' + _kIdx + ' ' + _tick + ' ' + _hold + ' ' + S.ccStepEditVal[_kIdx]);
        S.trackCCAutoBits[_t][_ac] |= (1 << _kIdx);
        return;
    }

    /* Drum step edit: K1 (Dur) + K2 (Vel) + K3 (Ndg); K4/K5 swallowed */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0 && d1 >= 71 && d1 <= 75 &&
            S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const knobIdx = d1 - 71;
        const dir     = (d2 >= 1 && d2 <= 63) ? 1 : -1;
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty = true;
        if (knobIdx === 0) {
            const _gmaxD = Math.min(65535, 256 * (S.drumLaneTPS[t] || 24));
            S.stepEditGate = Math.max(1, Math.min(_gmaxD, S.stepEditGate + dir * 6));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_gate', String(S.stepEditGate));
        } else if (knobIdx === 1) {
            S.stepEditVel = Math.max(0, Math.min(127, S.stepEditVel + dir));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel', String(S.stepEditVel));
        } else if (knobIdx === 2) {
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                const _tpsN1 = (S.drumLaneTPS[t] || 24) - 1;
                S.stepEditNudge = Math.max(-_tpsN1, Math.min(_tpsN1, S.stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_nudge', String(S.stepEditNudge));
            }
        }
        return;
    }
    /* Step edit overlay: K1-K5 intercept per-step params while a step is held and active */
    if (S.heldStep >= 0 && S.heldStepNotes.length > 0 && d1 >= 71 && d1 <= 75) {
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
            /* K2 Pitch: shift each note ±1 scale degree (or ±1 semitone if scale-aware off), sens=16 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                S.heldStepNotes = S.heldStepNotes.map(function(n) {
                    return scaleNudgeNote(n, dir, S.padKey, S.padScale);
                });
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_set_notes', S.heldStepNotes.join(' '));
            }
        } else if (knobIdx === 2) {
            /* K3 Dur: gate in 6-tick steps (±25% of a step per detent) */
            { const _acD = effectiveClip(S.activeTrack);
              const _gmaxD = Math.min(65535, 256 * (S.clipTPS[S.activeTrack][_acD] || 24));
              S.stepEditGate = Math.max(1, Math.min(_gmaxD, S.stepEditGate + dir * 6)); }
            if (typeof host_module_set_param === 'function')
                host_module_set_param(pfx + '_gate', String(S.stepEditGate));
        } else if (knobIdx === 3) {
            /* K4 Vel: velocity 0-127 */
            S.stepEditVel = Math.max(0, Math.min(127, S.stepEditVel + dir));
            if (typeof host_module_set_param === 'function')
                host_module_set_param(pfx + '_vel', String(S.stepEditVel));
        } else {
            /* K5 Nudge: tick offset ±(TPS-1), sens=16 */
            S.knobAccum[knobIdx] = (dir === S.knobLastDir[knobIdx]) ? S.knobAccum[knobIdx] + 1 : 1;
            S.knobLastDir[knobIdx] = dir;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                const _acN = effectiveClip(S.activeTrack);
                const _tpsN1 = (S.clipTPS[S.activeTrack][_acN] || 24) - 1;
                S.stepEditNudge = Math.max(-_tpsN1, Math.min(_tpsN1, S.stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_nudge', String(S.stepEditNudge));
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
        const knobIdx = d1 - 71;
        S.knobTouched          = knobIdx;
        S.knobTurnedTick[knobIdx] = S.tickCount;
        S.screenDirty = true;
        const bank    = S.activeBank;
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 0) {
            const t    = S.activeTrack;
            const ac   = effectiveClip(t);
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }

            if (knobIdx === 0) {
                /* K1 = Stch (beat stretch, lock, sens=16) */
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
                        S.bankParams[t][0][0] = dir;
                        S.pendingDrumResync = 2; S.pendingDrumResyncTrack = t;
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 1) {
                /* K2 = Shft (clock shift, sens=8) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    S.clockShiftTouchDelta += dir;
                    S.bankParams[t][0][knobIdx] = S.clockShiftTouchDelta;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_clock_shift', String(dir));
                    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 2) {
                /* K3 = Ndg (nudge, sens=8) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    S.bankParams[t][0][knobIdx] += dir;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_nudge', String(dir));
                    S.pendingDrumLaneResync = 2; S.pendingDrumLaneResyncTrack = t; S.pendingDrumLaneResyncLane = lane;
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 3) {
                /* K4 = Res (normal=proportional rescale; Shift=zoom, sens=16) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const curIdx = Math.max(0, TPS_VALUES.indexOf(S.drumLaneTPS[t]));
                    const nv = Math.max(0, Math.min(5, curIdx + dir));
                    if (nv !== curIdx) {
                        if (S.shiftHeld) {
                            /* Zoom: absolute note positions fixed, step grid shifts, length adjusts */
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
            if (knobIdx === 4) {
                /* K5 = Len (lane length, sens=8) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 8) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(1, Math.min(256, S.drumLaneLength[t] + dir));
                    if (nv !== S.drumLaneLength[t]) {
                        S.drumLaneLength[t] = nv;
                        const maxPage = Math.max(0, Math.ceil(nv / 16) - 1);
                        if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_clip_length', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 5) {
                /* K6 = Qnt (drum lanes quantize macro, sens=4) */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 4) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(100, S.drumLaneQnt[t] + dir));
                    if (nv !== S.drumLaneQnt[t]) {
                        S.drumLaneQnt[t] = nv;
                        S.bankParams[t][1][4] = nv; /* mirror to NOTE FX K5 for active lane display */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_drum_lanes_qnt', String(nv));
                    }
                    S.screenDirty = true;
                }
                return;
            }
            if (knobIdx === 6) {
                /* K7 = Perf (perform mode: Vel → Rpt → Rpt2), sens=16 */
                S.knobAccum[knobIdx]++;
                if (S.knobAccum[knobIdx] >= 16) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(2, S.drumPerformMode[t] + (dir > 0 ? 1 : -1)));
                    if (nv !== S.drumPerformMode[t]) {
                        if (S.drumPerformMode[t] === 1) {
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                            S.drumRepeatHeldPad[t] = -1;
                        }
                        if (S.drumPerformMode[t] === 2) {
                            S.drumRepeat2HeldLanes[t].clear();
                            S.drumRepeat2LatchedLanes[t].clear();
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_drum_repeat2_stop', '1');
                        }
                        S.drumRepeatLatched[t] = false;
                        S.drumPerformMode[t] = nv;
                    }
                    showModePopup('PERFORMANCE PADS',
                        ['Velocity', 'Repeat Play (Rpt1)', 'Repeat Set (Rpt2)'],
                        S.drumPerformMode[t]);
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
        /* Drum NOTE FX bank: K7 (lane oct, coarse ±12) and K8 (lane note, fine ±1) */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 1 &&
                (knobIdx === 6 || knobIdx === 7)) {
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const dir  = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.knobAccum[knobIdx] >= 16) {
                S.knobAccum[knobIdx] = 0;
                const delta = knobIdx === 6 ? dir * 12 : dir;
                const nv = Math.max(0, Math.min(127, S.drumLaneNote[t][lane] + delta));
                if (nv !== S.drumLaneNote[t][lane]) {
                    S.drumLaneNote[t][lane] = nv;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_lane_note', String(nv));
                    S.screenDirty = true;
                }
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
            if (S.knobAccum[knobIdx] >= 4) {
                S.knobAccum[knobIdx] = 0;
                const step = knobIdx;
                if (S.shiftHeld) {
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
        /* CC PARAM bank (bank 6): normal turn = transmit CC, Shift+turn = reassign CC number */
        if (bank === 6) {
            const t = S.activeTrack;
            /* Delete+turn: clear this knob's automation for the active clip */
            if (S.deleteHeld && !S.shiftHeld) {
                const ac = S.trackActiveClip[t];
                S.trackCCAutoBits[t][ac] &= ~(1 << knobIdx);
                S.trackCCLiveVal[t][knobIdx] = -1;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_cc_auto_clear_k', ac + ' ' + knobIdx);
                showActionPopup('CC AUTO', 'CLEAR');
                invalidateLEDCache();
                return;
            }
            const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            if (dir !== S.knobLastDir[knobIdx]) { S.knobAccum[knobIdx] = 0; S.knobLastDir[knobIdx] = dir; }
            S.knobAccum[knobIdx]++;
            if (S.shiftHeld) {
                /* Shift+turn: reassign CC number 0-127, sens=4 */
                if (S.knobAccum[knobIdx] >= 4) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(127, S.trackCCAssign[t][knobIdx] + dir));
                    if (nv !== S.trackCCAssign[t][knobIdx]) {
                        S.trackCCAssign[t][knobIdx] = nv;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_cc_assign', knobIdx + ' ' + nv);
                        S.screenDirty = true;
                    }
                }
            } else {
                /* Normal turn: send CC value 0-127, sens=2 */
                if (S.knobAccum[knobIdx] >= 2) {
                    S.knobAccum[knobIdx] = 0;
                    const nv = Math.max(0, Math.min(127, S.trackCCVal[t][knobIdx] + dir));
                    if (nv !== S.trackCCVal[t][knobIdx]) {
                        S.trackCCVal[t][knobIdx] = nv;
                        if (typeof host_module_set_param === 'function') {
                            host_module_set_param('t' + t + '_cc_send', knobIdx + ' ' + nv);
                            const ac = S.trackActiveClip[t];
                            /* Step edit: write automation point at held step's tick */
                            if (S.heldStep >= 0 && S.trackPadMode[t] !== PAD_MODE_DRUM) {
                                const stepTick = S.heldStep * (S.clipTPS[t][ac] || 24);
                                host_module_set_param('t' + t + '_cc_auto_set',
                                    ac + ' ' + knobIdx + ' ' + stepTick + ' ' + nv);
                                S.trackCCAutoBits[t][ac] |= (1 << knobIdx);
                            }
                            /* Live record: mark automation bit so LED updates immediately */
                            if (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t) {
                                S.trackCCAutoBits[t][ac] |= (1 << knobIdx);
                            }
                        }
                        S.screenDirty = true;
                    }
                }
            }
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
            if (S.knobAccum[knobIdx] >= pm.sens) {
                S.knobAccum[knobIdx] = 0;
                S.screenDirty = true;
                if (pm.scope === 'action') {
                    const t   = S.activeTrack;
                    const ac  = S.trackActiveClip[t];
                    const len = S.clipLength[t][ac];
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
                        /* Clock Shift: continuous rotation, no lock */
                        if (len >= 2 && typeof host_module_set_param === 'function') {
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
                    } else {
                        /* Nudge: fire DSP, mirror counter locally for display, schedule steps re-read */
                        if (typeof host_module_set_param === 'function') {
                            host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                            S.bankParams[t][bank][knobIdx] += dir;
                            S.pendingStepsReread      = 2;
                            S.pendingStepsRereadTrack = t;
                            S.pendingStepsRereadClip  = ac;
                        }
                    }
                } else {
                    const cur = S.bankParams[S.activeTrack][bank][knobIdx];
                    let nv  = Math.max(pm.min, Math.min(pm.max, cur + dir));
                    if (nv !== cur) {
                        if (S.shiftHeld && pm.dspKey === 'clip_resolution') {
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
                        }
                    }
                }
            }
        }
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

        /* Drum Pad Clear: Shift+Delete+lane pad — full factory reset of drum lane */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.shiftHeld && S.deleteHeld) {
            const t    = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            if (lane >= 0 && lane < DRUM_LANES) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_l' + lane + '_hard_reset', '1');
                S.activeDrumLane[t] = lane;
                S.drumLaneLength[t]     = 16;
                for (let s = 0; s < 256; s++) S.drumLaneSteps[t][lane][s] = '0';
                S.drumLaneHasNotes[t][lane] = false;
                const ac = S.trackActiveClip[t];
                S.drumClipNonEmpty[t][ac] = false;
                for (let ol = 0; ol < DRUM_LANES; ol++) {
                    if (S.drumLaneHasNotes[t][ol]) { S.drumClipNonEmpty[t][ac] = true; break; }
                }
                refreshDrumLaneBankParams(t, lane);
                showActionPopup('PAD CLEARED');
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
                    /* Same latched pad pressed again: unlatch and stop */
                    S.drumRepeatLatched[t]  = false;
                    S.drumRepeatHeldPad[t]  = -1;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_stop', '1');
                } else {
                    /* New rate or held: start (latches if Loop is held) */
                    S.drumRepeatHeldPad[t]  = padIdx;
                    S.drumRepeatLatched[t]  = S.loopHeld;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_repeat_start', lane + ' ' + rateIdx + ' ' + vel);
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
                /* Rate pad: assign rate to active lane */
                const rateIdx = row * 4 + (col - 4);
                const lane = S.activeDrumLane[t];
                S.drumRepeat2RatePerLane[t][lane] = rateIdx;
                if (typeof host_module_set_param === 'function')
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
                } else {
                    S.drumRepeatGate[t][lane] = (S.drumRepeatGate[t][lane] ^ (1 << step)) & 0xFF;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_repeat_gate_toggle', String(step));
                }
                forceRedraw();
                return;
            } else if (col < 4 && !S.deleteHeld) {
                /* Lane pad: add/unlatch multi-lane repeat */
                const lane = drumPadToLane(padIdx);
                if (lane >= 0 && lane < DRUM_LANES) {
                    S.activeDrumLane[t] = lane;
                    syncDrumLaneSteps(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    if (S.drumRepeat2LatchedLanes[t].has(lane)) {
                        S.drumRepeat2LatchedLanes[t].delete(lane);
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_drum_repeat2_lane_off', String(lane));
                        if (S.loopHeld) S.rpt2LoopPadUsed = true;
                    } else {
                        S.drumRepeat2HeldLanes[t].add(lane);
                        if (S.loopHeld) { S.drumRepeat2LatchedLanes[t].add(lane); S.rpt2LoopPadUsed = true; }
                        padPitch[padIdx] = -1;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_drum_repeat2_lane_on', lane + ' ' + d2);
                    }
                    forceRedraw();
                }
                return;
            }
        }
        /* Drum mode pad handling */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && (!S.shiftHeld || S.muteHeld)) {
            const t = S.activeTrack;
            const lane = drumPadToLane(padIdx);
            const velZone = drumPadToVelZone(padIdx);
            if (velZone >= 0) {
                /* Velocity pad: which pad determines the zone; zone determines velocity.
                 * Pad pressure is ignored — zone vel used for monitoring, step-edit, recording. */
                S.drumLastVelZone[t] = velZone;
                const zoneVel  = drumVelZoneToVelocity(velZone);
                S.lastPadVelocity = zoneVel;
                const lane_vp  = S.activeDrumLane[t];
                const laneNote = S.drumLaneNote[t][lane_vp];
                liveSendNote(t, 0x90, laneNote, zoneVel);
                padPitch[padIdx] = laneNote;
                S.liveActiveNotes.add(laneNote);
                if (S.heldStep >= 0 && S.heldStepNotes.length > 0) {
                    S.stepEditVel = zoneVel;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane_vp + '_step_' + S.heldStep + '_vel', String(zoneVel));
                    S.stepBtnPressedTick[S.heldStepBtn] = -1;
                }
                /* Record hit at zone velocity if armed */
                if (S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_drum_record_note_on', laneNote + ' ' + zoneVel);
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
                    S.activeDrumLane[t] = lane;
                    refreshDrumLaneBankParams(t, lane);
                    invalidateLEDCache();
                    forceRedraw();
                    showActionPopup('PASTED');
                } else if (S.copySrc.kind === 'cut_drum_lane' && S.copySrc.track === t) {
                    cutDrumLane(t, S.copySrc.lane, lane);
                    S.copySrc = { kind: 'drum_lane', track: t, lane: lane };
                    S.activeDrumLane[t] = lane;
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
                    S.activeDrumLane[t] = lane;
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
                    /* Lane pad: select lane, sync its steps and bank params */
                    S.activeDrumLane[t] = lane;
                    syncDrumLaneSteps(t, lane);
                    refreshDrumLaneBankParams(t, lane);
                    /* Preview lane note at actual pad velocity */
                    const vel = effectiveVelocity(d2);
                    const laneNote = S.drumLaneNote[t][lane];
                    liveSendNote(t, 0x90, laneNote, vel);
                    padPitch[padIdx] = laneNote;
                    S.liveActiveNotes.add(laneNote);
                    /* Record step hit if armed */
                    if (S.recordArmed && !S.recordCountingIn && t === S.recordArmedTrack) {
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_drum_record_note_on', laneNote + ' ' + vel);
                        S.pendingDrumLaneResync      = 3;
                        S.pendingDrumLaneResyncTrack = t;
                        S.pendingDrumLaneResyncLane  = lane;
                    }
                    /* Rpt1: defer lane switch to tick (onMidiMessage set_params coalesce) */
                    if (S.drumPerformMode[t] === 1 && (S.drumRepeatHeldPad[t] >= 0 || S.drumRepeatLatched[t])) {
                        S.pendingRepeatLane = lane;
                        S.pendingRepeatLaneTrack = t;
                    }
                    forceRedraw();
                }
            }
        } else if (S.heldStep >= 0 && !S.shiftHeld) {
            /* Step edit: tap pad to toggle note assignment for held step */
            const ac    = effectiveClip(S.activeTrack);
            const pitch = Math.max(0, Math.min(127, S.padNoteMap[padIdx] + S.trackOctave[S.activeTrack] * 12));
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + S.activeTrack + '_c' + ac + '_step_' + S.heldStep + '_toggle', pitch + ' ' + effectiveVelocity(d2));
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
            const bankIdx = padIdx - 24;
            if (bankIdx <= 6) {
                /* HARMZ (2) and ARP OUT (4) hidden on drum tracks */
                const drumHidden = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && (bankIdx === 2 || bankIdx === 4);
                if (!drumHidden) {
                    if (S.activeBank === bankIdx) {
                        S.bankSelectTick = -1;
                    } else {
                        S.activeBank = bankIdx;
                        readBankParams(S.activeTrack, bankIdx);
                        S.bankSelectTick = S.tickCount;
                    }
                    S.screenDirty = true;
                }
            }
        } else if (S.shiftHeld && padIdx < NUM_TRACKS) {
            /* Shift + bottom-row pad: select active track */
            extNoteOffAll();
            handoffRecordingToTrack(padIdx);
            S.activeTrack = padIdx;
            refreshPerClipBankParams(padIdx);
            computePadNoteMap();
            S.seqActiveNotes.clear();
            S.seqLastStep = -1;
            S.seqLastClip = -1;
            /* Sync drum lane metadata for the new track */
            if (S.trackPadMode[padIdx] === PAD_MODE_DRUM) {
                /* Fall back from banks hidden on drum tracks */
                if (S.activeBank === 2 || S.activeBank === 4) S.activeBank = 0;
                syncDrumLanesMeta(padIdx);
                syncDrumLaneSteps(padIdx, S.activeDrumLane[padIdx]);
                syncDrumClipContent(padIdx);
                refreshDrumLaneBankParams(padIdx, S.activeDrumLane[padIdx]);
            }
            S.screenDirty = true;
        } else if (!S.shiftHeld) {
            /* Live note — apply per-track octave shift, clamp 0-127 */
            const basePitch = S.padNoteMap[padIdx];
            const pitch = Math.max(0, Math.min(127, basePitch + S.trackOctave[S.activeTrack] * 12));
            padPitch[padIdx] = pitch;
            S.lastPlayedNote  = pitch;
            S.lastPadVelocity = effectiveVelocity(d2);
            S.liveActiveNotes.add(pitch);
            liveSendNote(S.activeTrack, 0x90, pitch, effectiveVelocity(d2));
            /* Pre-roll capture: note in last 1/16th of count-in → step 0 */
            if (S.recordArmed && S.recordCountingIn &&
                    S.activeTrack === S.recordArmedTrack &&
                    S.countInQuarterTicks > 0 &&
                    (S.tickCount - S.countInStartTick) >= Math.round(S.countInQuarterTicks * 7 / 2) &&
                    typeof host_module_set_param === 'function') {
                const rt   = S.recordArmedTrack;
                const ac_r = S.trackActiveClip[rt];
                host_module_set_param('t' + rt + '_c' + ac_r + '_step_0_add', pitch + ' 0 ' + effectiveVelocity(d2));
                S.clipSteps[rt][ac_r][0] = 1;
                S.clipNonEmpty[rt][ac_r] = true;
            }
            /* Overdub capture: add to current step of armed track with tick offset + velocity */
            if (S.recordArmed && !S.recordCountingIn && S.activeTrack === S.recordArmedTrack)
                recordNoteOn(pitch, effectiveVelocity(d2), S.recordArmedTrack);
        }
    }
}

function _onPadPress(status, d1, d2) {
        if (S.tapTempoOpen && d1 >= 68 && d1 <= 99) {
            registerTapTempo(d1);
            return;
        }
        /* SEQ ARP K5 (Steps Mode) touched + Mute/Step mode: pad press = level edit.
         * Column = step (0..7); row sets level (1=bottom..4=top). Bottom-row
         * press when already at level 1 → level 0 (step off). Off mode: ignored. */
        if (!S.sessionView && S.activeBank === 4 && S.knobTouched === 4 &&
                (S.bankParams[S.activeTrack][4][4] | 0) !== 0 &&
                d1 >= 68 && d1 <= 99) {
            const idx = d1 - 68;
            const col = idx % 8;
            const row = Math.floor(idx / 8);
            const t   = S.activeTrack;
            const ac  = effectiveClip(t);
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
        /* TRACK ARP K5 (Steps Mode) touched + Mute/Step mode: pad press = level edit. */
        if (!S.sessionView && S.activeBank === 5 && S.knobTouched === 4 &&
                (S.bankParams[S.activeTrack][5][4] | 0) !== 0 &&
                d1 >= 68 && d1 <= 99) {
            const idx = d1 - 68;
            const col = idx % 8;
            const row = Math.floor(idx / 8);
            const t   = S.activeTrack;
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
                    if (S.perfLatchMode) {
                        S.perfModsToggled ^= (1 << modIdx);
                    } else {
                        S.perfModsHeld |= (1 << modIdx);
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
                            /* Shift+pad: focus clip in Track View; launch only if not already active */
                            const isPlaying = S.trackClipPlaying[t] && isActiveClip;
                            const isWR      = S.trackWillRelaunch[t] && isActiveClip;
                            const isQueued  = S.trackQueuedClip[t] === clipIdx;
                            if (!isPlaying && !isWR && !isQueued) {
                                if (!S.playing) {
                                    S.trackActiveClip[t]  = clipIdx;
                                    S.trackCurrentPage[t] = 0;
                                    refreshPerClipBankParams(t);
                                }
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            }
                            handoffRecordingToTrack(t);
                            S.activeTrack = t;
                            refreshPerClipBankParams(t);
                            S.sessionView = false;
                            invalidateLEDCache();
                            forceRedraw();
                        } else if (S.trackClipPlaying[t] && isActiveClip) {
                            handoffRecordingToTrack(t);
                            S.activeTrack = t;
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
                            S.activeTrack = t;
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else if (S.trackQueuedClip[t] === clipIdx) {
                            /* Queued to launch → cancel */
                            handoffRecordingToTrack(t);
                            S.activeTrack = t;
                            refreshPerClipBankParams(t);
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else {
                            /* Launch clip for this track */
                            handoffRecordingToTrack(t);
                            S.activeTrack = t;
                            if (!S.playing) {
                                S.trackActiveClip[t]  = clipIdx;
                                S.trackCurrentPage[t] = 0;
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

function _onStepButtons(d1, d2) {
    if (S.tapTempoOpen) return;
    S.stepOpTick = S.tickCount;
    const idx = d1 - 16;
    /* Perf Mode: step buttons are preset snapshot slots. */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked)) {
        if (S.shiftHeld) {
            /* Shift+step: save current active mods to this slot */
            S.perfSnapshots[idx] = S.perfModsToggled | S.perfModsHeld | S.perfRecalledMods;
            showActionPopup('SAVED');
        } else if (S.perfRecalledSlot === idx) {
            /* Tap active slot again: deactivate recall */
            S.perfRecalledSlot = -1;
            S.perfRecalledMods = 0;
            sendPerfMods();
        } else {
            /* Tap a slot: recall its mods */
            S.perfRecalledSlot = idx;
            S.perfRecalledMods = S.perfSnapshots[idx];
            sendPerfMods();
        }
        forceRedraw();
        return;
    }
    if (S.sessionView) {
        if (S.muteHeld) {
            /* All 16 step buttons are snapshot slots 0-15 */
            if (S.shiftHeld) {
                /* Shift+tap: save/overwrite snapshot */
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
                S.snapshots[idx] = { mute: S.trackMuted.slice(), solo: S.trackSoloed.slice(), drumEffMute: drumEffMutes };
                const mStr = S.trackMuted.map(function(m) { return m ? '1' : '0'; }).join(' ');
                const sStr = S.trackSoloed.map(function(s) { return s ? '1' : '0'; }).join(' ');
                const dStr = drumEffMutes.join(' ');
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('snap_save', idx + ' ' + mStr + ' ' + sStr + ' ' + dStr);
            } else if (S.snapshots[idx] !== null) {
                /* Tap occupied: recall snapshot */
                const snap = S.snapshots[idx];
                for (let _t = 0; _t < NUM_TRACKS; _t++) {
                    S.trackMuted[_t]  = snap.mute[_t];
                    S.trackSoloed[_t] = snap.solo[_t];
                    if (snap.drumEffMute) {
                        S.drumLaneMute[_t] = snap.drumEffMute[_t];
                        S.drumLaneSolo[_t] = 0;
                    }
                }
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('snap_load', String(idx));
                S.screenDirty = true;
            }
            /* Tap empty: no-op; S.muteHeld swallows all step buttons in Session View */
        } else if (!S.deleteHeld && !S.shiftHeld) {
            if (typeof host_module_set_param === 'function')
                host_module_set_param('launch_scene', String(idx));
        }
        /* S.deleteHeld/S.shiftHeld (non-S.muteHeld) in Session View: swallow step buttons */
    } else if (S.loopHeld) {
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum: set active lane clip length */
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            const newLen = (idx + 1) * 16;
            S.drumLaneLength[t] = newLen;
            const maxPage = Math.max(0, Math.ceil(newLen / 16) - 1);
            if (S.drumStepPage[t] > maxPage) S.drumStepPage[t] = maxPage;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + t + '_l' + lane + '_clip_length', String(newLen));
        } else {
        const ac      = effectiveClip(S.activeTrack);
        const newLen  = (idx + 1) * 16;
        S.clipLength[S.activeTrack][ac] = newLen;
        const maxPage = Math.max(0, Math.ceil(newLen / 16) - 1);
        if (S.trackCurrentPage[S.activeTrack] > maxPage)
            S.trackCurrentPage[S.activeTrack] = maxPage;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + S.activeTrack + '_c' + ac + '_length', String(newLen));
        }
        forceRedraw();
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
        /* Delete + step button (Track View): clear all notes from that step */
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
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
    } else if (!S.shiftHeld && S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        /* Drum mode: tap toggles hit; hold enters step edit (Dur/Vel).
         * Press records time and state; toggle/clear deferred to release. */
        const t       = S.activeTrack;
        const lane    = S.activeDrumLane[t];
        const absStep = S.drumStepPage[t] * 16 + idx;
        S.stepBtnPressedTick[idx] = S.tickCount;
        if (S.heldStep < 0) {
            S.heldStepBtn = idx;
            S.heldStep    = absStep;
            const cur   = S.drumLaneSteps[t][lane][absStep];
            if (cur === '1') {
                S.stepWasEmpty  = false;
                S.heldStepNotes = [S.drumLaneNote[t][lane]];
                const rv = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_vel') : null;
                const rg = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_gate') : null;
                const rn = typeof host_module_get_param === 'function'
                    ? host_module_get_param('t' + t + '_l' + lane + '_step_' + absStep + '_nudge') : null;
                S.stepEditVel   = rv !== null ? parseInt(rv, 10) : 100;
                S.stepEditGate  = rg !== null ? parseInt(rg, 10) : (S.drumLaneTPS[t] || 24);
                S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
            } else {
                S.stepWasEmpty  = true;
                S.heldStepNotes = [];
                S.stepEditVel   = drumVelZoneToVelocity(S.drumLastVelZone[t]);
                S.stepEditGate  = S.drumLaneTPS[t] || 24;
                S.stepEditNudge = 0;
            }
            forceRedraw();
        } else if (S.heldStepNotes.length > 0) {
            /* Second step tapped while first is held: set gate to span the distance */
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            const tappedStep = S.drumStepPage[t] * 16 + idx;
            if (tappedStep !== S.heldStep) {
                const len     = S.drumLaneLength[t];
                const tps     = S.drumLaneTPS[t] || 24;
                const dist    = tappedStep > S.heldStep
                    ? tappedStep - S.heldStep
                    : len - S.heldStep + tappedStep;
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
            const raw_p  = typeof host_module_get_param === 'function'
                ? host_module_get_param(pref_p + '_notes') : null;
            S.heldStepNotes = (raw_p && raw_p.trim().length > 0)
                ? raw_p.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                : [];
            if (S.heldStepNotes.length === 0) {
                S.stepWasEmpty = true;
                if (S.activeBank === 6) {
                    /* CC step-edit: no note required — enter edit immediately */
                    S.ccStepEditActive = true;
                } else if (S.lastPlayedNote >= 0) {
                    /* Known note: assign immediately so knobs work right away */
                    const assignNote = S.lastPlayedNote;
                    const assignVel  = effectiveVelocity(S.lastPadVelocity);
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + S.activeTrack + '_c' + ac_p + '_step_' + absP + '_toggle', assignNote + ' ' + assignVel);
                    const raw_aa = typeof host_module_get_param === 'function'
                        ? host_module_get_param(pref_p + '_notes') : null;
                    S.heldStepNotes = (raw_aa && raw_aa.trim().length > 0)
                        ? raw_aa.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                        : [];
                    S.clipSteps[S.activeTrack][ac_p][absP] = S.heldStepNotes.length > 0 ? 1 : 0;
                    if (S.heldStepNotes.length > 0) S.clipNonEmpty[S.activeTrack][ac_p] = true;
                    S.stepEditVel = assignVel; S.stepEditGate = 12; S.stepEditNudge = 0;
                } else {
                    /* No note played yet: flash message, don't enter step edit */
                    S.heldStep    = -1;
                    S.heldStepBtn = -1;
                    S.stepWasEmpty = false;
                    S.stepWasHeld  = false;
                    S.noNoteFlashEndTick = S.tickCount + NO_NOTE_FLASH_TICKS;
                    S.screenDirty = true;
                }
            } else {
                S.stepWasEmpty = false;
                if (S.activeBank === 6) {
                    S.ccStepEditActive = true;
                } else {
                    const rv = typeof host_module_get_param === 'function' ? host_module_get_param(pref_p + '_vel') : null;
                    const rg = typeof host_module_get_param === 'function' ? host_module_get_param(pref_p + '_gate') : null;
                    const rn = typeof host_module_get_param === 'function' ? host_module_get_param(pref_p + '_nudge') : null;
                    S.stepEditVel   = rv !== null ? parseInt(rv, 10) : 100;
                    S.stepEditGate  = rg !== null ? parseInt(rg, 10) : 12;
                    S.stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                }
            }
            forceRedraw();
        } else if (S.heldStepNotes.length > 0) {
            /* Second step tapped while first is held: set gate to span the distance.
             * Clear S.heldStepBtn press-tick so the first step's release doesn't also tap-toggle. */
            S.stepBtnPressedTick[S.heldStepBtn] = -1;
            S.stepWasHeld = true;
            const ac_tap     = effectiveClip(S.activeTrack);
            const tappedStep = S.trackCurrentPage[S.activeTrack] * 16 + idx;
            if (tappedStep !== S.heldStep) {
                const len     = S.clipLength[S.activeTrack][ac_tap];
                const tps     = S.clipTPS[S.activeTrack][ac_tap] || 24;
                const dist    = tappedStep > S.heldStep
                    ? tappedStep - S.heldStep
                    : len - S.heldStep + tappedStep;
                const newGate = Math.max(1, Math.min(dist * tps, 65535));
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
    /* Swallow pad releases while SEQ ARP step-level editor is open. */
    if (!S.sessionView && S.activeBank === 4 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][4][4] | 0) !== 0 &&
            d1 >= 68 && d1 <= 99) return;
    /* Swallow pad releases while TRACK ARP step-level editor is open. */
    if (!S.sessionView && S.activeBank === 5 && S.knobTouched === 4 &&
            (S.bankParams[S.activeTrack][5][4] | 0) !== 0 &&
            d1 >= 68 && d1 <= 99) return;
    /* Perf Mode pad release: handle R0 rate pad pop + mod pad release. */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked) && d1 >= 68 && d1 <= 99) {
        if (d1 >= 68 && d1 <= 75) {
            const subIdx = d1 - 68;
            if (subIdx === 7) {
                /* Latch release: tap = toggle latch mode; exiting clears all toggled mods. */
                if (!S.perfLatchMode) {
                    S.perfLatchMode = true;
                } else {
                    S.perfLatchMode   = false;
                    S.perfModsToggled = 0;
                    sendPerfMods();
                }
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
        if (btn === S.heldStepBtn) {
            if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
                /* Drum step release: tap toggles, hold-release exits + vel confirm */
                const t    = S.activeTrack;
                const lane = S.activeDrumLane[t];
                let drumStepCleared = false;
                if (S.stepBtnPressedTick[btn] >= 0) {
                    S.stepBtnPressedTick[btn] = -1;
                    if (S.stepWasEmpty) {
                        /* Empty step tapped: assign now with current velocity */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_toggle', String(S.stepEditVel));
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
                /* Confirm vel at release — ensures it sticks even if mid-hold send was coalesced */
                if (!drumStepCleared && !drumDidReassign && S.heldStepNotes.length > 0) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_l' + lane + '_step_' + S.heldStep + '_vel', String(S.stepEditVel));
                }
            } else {
            if (S.stepBtnPressedTick[btn] >= 0) {
                /* Quick release within threshold — commit as tap toggle */
                const ac_t   = effectiveClip(S.activeTrack);
                const absIdx = S.heldStep;
                S.stepBtnPressedTick[btn] = -1;
                if (S.stepWasEmpty) {
                    /* Note was assigned on press — tap confirms, nothing more to do */
                } else {
                    const wasOn = S.clipSteps[S.activeTrack][ac_t][absIdx] === 1;
                    if (!wasOn) {
                        if (S.heldStepNotes.length === 0) {
                            const assignNote2 = S.lastPlayedNote >= 0 ? S.lastPlayedNote : defaultStepNote();
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + S.activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', assignNote2 + ' ' + effectiveVelocity(S.lastPadVelocity));
                        } else {
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + S.activeTrack + '_c' + ac_t + '_step_' + absIdx, '1');
                        }
                        S.clipSteps[S.activeTrack][ac_t][absIdx] = 1;
                        S.clipNonEmpty[S.activeTrack][ac_t] = true;
                        refreshSeqNotesIfCurrent(S.activeTrack, ac_t, absIdx);
                    } else {
                        /* Deactivating: preserve note data */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + S.activeTrack + '_c' + ac_t + '_step_' + absIdx, '0');
                        S.clipSteps[S.activeTrack][ac_t][absIdx] = S.heldStepNotes.length > 0 ? 2 : 0;
                        if (S.clipNonEmpty[S.activeTrack][ac_t]) S.clipNonEmpty[S.activeTrack][ac_t] = clipHasContent(S.activeTrack, ac_t);
                        refreshSeqNotesIfCurrent(S.activeTrack, ac_t, absIdx);
                    }
                }
            }
            /* On long-hold release: if nudge moved notes past the step midpoint,
             * reassign them to the adjacent step slot so it's editable from there. */
            if (S.stepWasHeld && S.heldStep >= 0 && S.heldStepNotes.length > 0) {
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
        /* Repeat mode: swallow all right-grid (col 4-7) releases; stop repeat on unlatched rate pad release */
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 1 &&
                (padIdx % 8) >= 4) {
            if (S.drumRepeatHeldPad[t] === padIdx && !S.drumRepeatLatched[t]) {
                S.drumRepeatHeldPad[t] = -1;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + t + '_drum_repeat_stop', '1');
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
        S.liveActiveNotes.delete(pitch);
        padPitch[padIdx] = -1;
        if (!S.sessionView) liveSendNote(S.activeTrack, 0x80, pitch, 0);
        if (S.recordArmed && !S.recordCountingIn) recordNoteOff(pitch);
    }
}

globalThis.onMidiMessageInternal = function (data) {
    if (isNoiseMessage(data)) return;
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;

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
                    /* CC bank: Delete+touch clears this knob's automation immediately */
                    if (S.activeBank === 6 && S.deleteHeld && !S.shiftHeld &&
                            S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                        const _dt = S.activeTrack, _dac = S.trackActiveClip[_dt];
                        S.trackCCAutoBits[_dt][_dac] &= ~(1 << d1);
                        S.trackCCLiveVal[_dt][d1] = -1;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + _dt + '_cc_auto_clear_k', _dac + ' ' + d1);
                        showActionPopup('CC AUTO', 'CLEAR');
                        invalidateLEDCache();
                    }
                    /* CC bank: touch-record — start overwriting automation while held */
                    if (S.activeBank === 6 && !S.deleteHeld && !S.sessionView &&
                            S.recordArmed && !S.recordCountingIn &&
                            S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM) {
                        const _tv = S.trackCCVal[S.activeTrack][d1];
                        host_module_set_param('t' + S.activeTrack + '_cc_touch',
                            d1 + ' 1 ' + _tv);
                        S.trackCCAutoBits[S.activeTrack][S.trackActiveClip[S.activeTrack]] |= (1 << d1);
                    }
                    /* SEQ ARP K5 / TRACK ARP K6 touch: switch pads to vel-slider editor immediately. */
                    if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 5)) forceRedraw();
                }
                if (d1 === MoveMainTouch && !S.globalMenuOpen && !S.shiftHeld) { S.jogTouched = true; forceRedraw(); }
            } else if (d2 < 64) {
                if (d1 <= 7) {
                    if (S.activeBank >= 0 && BANKS[S.activeBank].knobs[d1]) {
                        const relPm = BANKS[S.activeBank].knobs[d1];
                        if (relPm.dspKey === 'nudge') {
                            S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                            if (typeof host_module_set_param === 'function') {
                                const _isDrumNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                                if (_isDrumNdg)
                                    host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                                else
                                    host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                            }
                        } else if (relPm.dspKey === 'clock_shift' || relPm.dspKey === 'beat_stretch') {
                            S.clockShiftTouchDelta = 0;
                            S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                        }
                    }
                    /* CC bank: touch-record — stop overwriting automation on release */
                    if (S.activeBank === 6 && S.recordArmed && !S.recordCountingIn &&
                            S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM)
                        host_module_set_param('t' + S.activeTrack + '_cc_touch', d1 + ' 0 0');
                    /* SEQ ARP K5 / TRACK ARP K6 release: refresh pads (vel-slider editor → normal pads). */
                    if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 5)) forceRedraw();
                    S.knobTouched = -1;
                    S.knobLocked[d1] = false;
                    S.knobAccum[d1]  = 0;
                    S.screenDirty = true;
                }
                if (d1 === MoveMainTouch && S.jogTouched) { S.jogTouched = false; forceRedraw(); }
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
                            const _isDrumNdg = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 0;
                            if (_isDrumNdg)
                                host_module_set_param('t' + S.activeTrack + '_l' + S.activeDrumLane[S.activeTrack] + '_nudge', '0');
                            else
                                host_module_set_param('t' + S.activeTrack + '_nudge', '0');
                        }
                    } else if (relPm.dspKey === 'clock_shift' || relPm.dspKey === 'beat_stretch') {
                        S.clockShiftTouchDelta = 0;
                        S.bankParams[S.activeTrack][S.activeBank][d1] = 0;
                    }
                }
                if ((S.activeBank === 4 && d1 === 4) || (S.activeBank === 5 && d1 === 5)) forceRedraw();
                S.knobTouched = -1;
                S.knobLocked[d1] = false;
                S.knobAccum[d1]  = 0;
                S.screenDirty = true;
            }
            if (d1 === MoveMainTouch && S.jogTouched) { S.jogTouched = false; forceRedraw(); }
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

    /* Poly aftertouch: update repeat velocity while rate pad is held */
    if ((status & 0xF0) === 0xA0 && d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
        const t      = S.activeTrack;
        const padIdx = d1 - TRACK_PAD_BASE;
        if (S.trackPadMode[t] === PAD_MODE_DRUM && S.drumPerformMode[t] === 1 &&
                S.drumRepeatHeldPad[t] === padIdx && d2 > 0) {
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
};

globalThis.onMidiMessageExternal = function (data) {
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
            if (isRec && typeof host_module_set_param === 'function') {
                host_module_set_param('t' + t + '_drum_record_note_on', d1 + ' ' + vel);
                const recLane = S.drumLaneNote[t].indexOf(d1);
                if (recLane >= 0) {
                    S.pendingDrumLaneResync      = 3;
                    S.pendingDrumLaneResyncTrack = t;
                    S.pendingDrumLaneResyncLane  = recLane;
                }
            }
            extHeldNotes.set(d1, { track: t, recording: false });
        } else if (msgType === 0x80 || (msgType === 0x90 && d2 === 0)) {
            const info = extHeldNotes.get(d1);
            const noteTrack = info ? info.track : t;
            if (S.trackRoute[noteTrack] !== 1) liveSendNote(noteTrack, 0x80, d1, 0);
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
