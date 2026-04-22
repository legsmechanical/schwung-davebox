import {
    MoveShift,
    MoveBack,
    MovePlay,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown
} from '/data/UserData/schwung/shared/constants.mjs';

/* CC 50 = Note/Session toggle (three-bar button left of track buttons). */
const MoveNoteSession = 50;
const MoveLoop        = 58;
const MoveMainTouch   = 9;   /* jog wheel capacitive touch — swallowed, no behavior */
const MoveRec         = 86;  /* Record button + LED (CC) */
const MoveMainButton  = 3;   /* jog wheel click (CC, not note — fires as 0xB0 d1=3) */
const MoveMainKnob    = 14;  /* jog wheel rotate (CC) */

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
    HotMagenta,
    DeepMagenta,
    Cyan,
    PurpleBlue,
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
    createInfo, createValue, createEnum, createToggle, formatItemValue
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

const LED_OFF         = 0;
const LED_STEP_ACTIVE = 36;
const LED_STEP_CURSOR = 127;
const LEDS_PER_FRAME  = 8;
const NUM_TRACKS      = 8;
const NUM_CLIPS       = 16;
const PULSE_PERIOD    = 12;   /* ticks per dim→bright→dim cycle (halved for 8-track LED load) */

/* shim ui_flags bits that must be masked while SEQ8 owns the display.
 * JUMP_TO_TOOLS (0x80) and JUMP_TO_OVERTAKE (0x04) both bypass our normal
 * exit path (no clearAllLEDs, no host_hide_module), leaving hardware LEDs
 * in a dirty state that corrupts the native Move UI. We wrap
 * shadow_get_ui_flags() to intercept these flags, fire clearAllLEDs()
 * immediately, and swallow them so shadow_ui.js never opens either menu. */
const FLAG_JUMP_TO_OVERTAKE = 0x04;
const FLAG_JUMP_TO_TOOLS    = 0x80;
const SEQ8_NAV_FLAGS        = FLAG_JUMP_TO_OVERTAKE | FLAG_JUMP_TO_TOOLS;

const NUM_STEPS       = 256;  /* steps per clip (DSP array size) */

/* Track colors: bright and dim pairs (Move uses fixed palette indices, not brightness). */
const TRACK_COLORS     = [Red,    Blue,     VividYellow, Green,
                           HotMagenta, Cyan,      Bright,   SkyBlue];
const TRACK_DIM_COLORS = [DeepRed, DarkBlue, Mustard,    DeepGreen,
                           DeepMagenta, PurpleBlue, BurntOrange, DeepBlue];
const SCENE_LETTERS = 'ABCDEFGHIJKLMNOP';

/* Move pad rows (confirmed on hardware, bottom-to-top):
 *   Bottom row (nearest player):  notes 68-75
 *   Row 2:                        notes 76-83
 *   Row 3:                        notes 84-91
 *   Top row (nearest display):    notes 92-99 */
const TRACK_PAD_BASE = 68;
const TOP_PAD_BASE   = 92;   /* top row — Shift+top-row = bank select */

/* ------------------------------------------------------------------ */
/* Parameter bank format helpers                                        */
/* ------------------------------------------------------------------ */

const NOTE_KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALE_NAMES = ['Minor', 'Major'];
const DELAY_LABELS = ['---','1/64','1/32','16T','1/16','8T','1/8','4T','1/4','1/2','1/1'];

function fmtSign(v)    { return (v >= 0 ? '+' : '') + v; }
function fmtStretch(exp) {
    if (exp === 0) return '1x';
    if (exp > 0)   return 'x' + (1 << exp);
    return '/' + (1 << (-exp));
}
function fmtLen(v) { return v + 'st'; }
function fmtPct(v)   { return v + '%'; }
function fmtNote(v)  { return NOTE_KEYS[((v | 0) % 12 + 12) % 12]; }
function fmtPages(v) { return v + 'pg'; }
function fmtUnis(v)  { return ['OFF','x2','x3'][v] || 'OFF'; }
function fmtDly(v)   { return DELAY_LABELS[v] || '---'; }
function fmtBool(v)  { return v ? 'ON' : 'OFF'; }
function fmtRoute(v) { return v ? 'Move' : 'Swng'; }
function fmtPlain(v) { return String(v); }
function fmtNA()     { return '-'; }

/* Fixed 4-char left-aligned column for overview display */
function col4(s) {
    if (s === null || s === undefined) s = '-';
    s = String(s);
    return s.length >= 4 ? s.slice(0, 4) : s + ' '.repeat(4 - s.length);
}

function bankHeader(bankIdx) {
    const n = BANKS[bankIdx].name;
    return '[' + (n + '          ').slice(0, 10) + ']';
}

function parseActionRaw(raw, def) {
    if (!raw || raw === '1x') return 0;
    const pow2 = [1, 2, 4, 8, 16, 32, 64, 128];
    if (raw[0] === 'x') {
        const n = parseInt(raw.slice(1), 10);
        const idx = pow2.indexOf(n);
        return idx >= 0 ? idx : (def || 0);
    }
    if (raw[0] === '/') {
        const n = parseInt(raw.slice(1), 10);
        const idx = pow2.indexOf(n);
        return idx >= 0 ? -idx : (def || 0);
    }
    return parseInt(raw, 10) | 0;
}

/* ------------------------------------------------------------------ */
/* Parameter bank definitions                                           */
/* ------------------------------------------------------------------ */

/* p(abbrev, fullName, dspKey, scope, min, max, defaultVal, fmtFn, sens, actionSuffix, lock)
 * scope: 'global' = key sent as-is; 'track' = prefixed tN_;
 *        'clip' = JS clipLength state; 'stub' = JS-only, no DSP call;
 *        'action' = one-shot DSP trigger, no bounded value
 * sens: raw encoder ticks required per unit change (default 1).
 * actionSuffix: get_param suffix for reading back state (default '_pos').
 * lock: if true, knob fires once then locks until touch release (default false). */
function p(abbrev, full, dspKey, scope, min, max, def, fmt, sens, actionSuffix, lock) {
    return { abbrev, full, dspKey, scope, min, max, def, fmt,
             sens: sens || 1,
             actionSuffix: actionSuffix || '_pos',
             lock: lock || false };
}
const _X = p(null, null, null, 'stub', 0, 0, 0, fmtNA);

const BANKS = [
    /* 0 — TRACK (pad 92) */
    { name: 'TRACK', knobs: [
        p('Ch',   'MIDI Channel', 'channel',  'track', 1, 16, 1, fmtPlain),
        p('Rte',  'Route',        'route',    'track', 0, 1,  0, fmtRoute),
        p('Mode', 'Track Mode',   'pad_mode', 'track', 0, 1,  0, fmtPlain),
        p('Res',  'Resolution',   null,       'stub',  0, 0,  0, fmtNA   ), /* NOT IN DSP */
        p('Len',  'Clip Length',  'clip_length', 'track', 1, 256, 16, fmtLen, 4),
        _X, _X, _X,
    ]},
    /* 1 — TIMING (pad 93) — Beat Stretch and Clock Shift wired */
    { name: 'TIMING', knobs: [
        p('Stch', 'Beat Stretch', 'beat_stretch', 'action', 0, 0, 0, fmtStretch, 16, '_factor', true),
        p('Shft', 'Clock Shift',  'clock_shift',  'action', 0, 0, 0, fmtPlain,   8),
        _X, _X, _X, _X, _X, _X,
    ]},
    /* 2 — NOTE FX (pad 94) — fully wired; Oct/Ofs slowed */
    { name: 'NOTE FX', knobs: [
        p('Oct',  'Octave Shift',    'noteFX_octave',   'track', -4,   4,   0,   fmtSign, 6),
        p('Ofs',  'Note Offset',     'noteFX_offset',   'track', -24,  24,  0,   fmtSign, 4),
        p('Gate', 'Gate Time',       'noteFX_gate',     'track',  0,   400, 100, fmtPct,  2 ),
        p('Vel',  'Velocity Offset', 'noteFX_velocity', 'track', -127, 127, 0,   fmtSign    ),
        _X, _X, _X, _X,
    ]},
    /* 3 — HARMZ (pad 95) — fully wired; all params slowed */
    { name: 'HARMZ', knobs: [
        p('Unis', 'Unison',     'harm_unison',    'track', 0,   2,  0, fmtUnis, 4),
        p('Oct',  'Octaver',    'harm_octaver',   'track', -4,  4,  0, fmtSign, 4),
        p('Hrm1', 'Harmony 1',  'harm_interval1', 'track', -24, 24, 0, fmtSign, 4),
        p('Hrm2', 'Harmony 2',  'harm_interval2', 'track', -24, 24, 0, fmtSign, 4),
        _X, _X, _X, _X,
    ]},
    /* 4 — SEQ ARP (pad 96) — stub: arpeggiator not in DSP */
    { name: 'SEQ ARP', knobs: [
        p('On',   'Arp On/Off',   null, 'stub', 0, 0, 0, fmtNA),
        p('Type', 'Arp Type',     null, 'stub', 0, 0, 0, fmtNA),
        p('Sort', 'Note Sort',    null, 'stub', 0, 0, 0, fmtNA),
        p('Hold', 'Hold',         null, 'stub', 0, 0, 0, fmtNA),
        p('OctR', 'Octave Range', null, 'stub', 0, 0, 0, fmtNA),
        p('Spd',  'Speed',        null, 'stub', 0, 0, 0, fmtNA),
        _X, _X,
    ]},
    /* 5 — MIDI DLY (pad 97) — fully wired */
    { name: 'MIDI DLY', knobs: [
        p('Dly',  'Delay Time',     'delay_time',         'track', 0,    10,  0, fmtDly  ),
        p('Lvl',  'Delay Level',    'delay_level',        'track', 0,    127, 0, fmtPlain),
        p('Rep',  'Repeats',        'delay_repeats',      'track', 0,    64,  0, fmtPlain),
        p('Vfb',  'Vel Feedback',   'delay_vel_fb',       'track', -127, 127, 0, fmtSign ),
        p('Pfb',  'Pitch Feedback', 'delay_pitch_fb',     'track', -24,  24,  0, fmtSign ),
        p('Gfb',  'Gate Feedback',  'delay_gate_fb',      'track', -100, 100, 0, fmtSign ),
        p('Clk',  'Clock Feedback', 'delay_clock_fb',     'track', -100, 100, 0, fmtSign ),
        p('Rnd',  'Pitch Random',   'delay_pitch_random', 'track', 0,    1,   0, fmtBool ),
    ]},
    /* 6 — LIVE ARP (pad 98) — stub: live arpeggiator not in DSP */
    { name: 'LIVE ARP', knobs: [
        p('On',   'Arp On/Off',   null, 'stub', 0, 0, 0, fmtNA),
        p('Type', 'Arp Type',     null, 'stub', 0, 0, 0, fmtNA),
        p('Sort', 'Note Sort',    null, 'stub', 0, 0, 0, fmtNA),
        p('Hold', 'Hold',         null, 'stub', 0, 0, 0, fmtNA),
        p('OctR', 'Octave Range', null, 'stub', 0, 0, 0, fmtNA),
        p('Spd',  'Speed',        null, 'stub', 0, 0, 0, fmtNA),
        _X, _X,
    ]},
    /* 7 — Reserved (pad 99) — ignore pad press */
    { name: 'RESERVED', knobs: [_X, _X, _X, _X, _X, _X, _X, _X] },
];

/* ------------------------------------------------------------------ */
/* Global menu items                                                    */
/* ------------------------------------------------------------------ */

/* Stub state for not-yet-wired global menu params */
let stubSwingAmt = 0;
let stubSwingRes = 0;
let stubInputVel = 0;
let stubInpQuant = false;

function buildGlobalMenuItems() {
    return [
        createValue('BPM', {
            get: function() {
                const v = parseFloat(host_module_get_param('bpm'));
                return (v > 0 && isFinite(v)) ? Math.round(v) : 120;
            },
            set: function(v) { host_module_set_param('bpm', String(Math.round(v))); },
            min: 40, max: 250, step: 1,
            format: function(v) { return String(Math.round(v)); }
        }),
        createEnum('Key', {
            get: function() { return padKey; },
            set: function(v) {
                padKey = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('key', String(v));
                computePadNoteMap();
            },
            options: [0,1,2,3,4,5,6,7,8,9,10,11],
            format: function(v) { return NOTE_KEYS[((v | 0) % 12 + 12) % 12]; }
        }),
        createEnum('Scale', {
            get: function() { return padScale; },
            set: function(v) {
                padScale = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('scale', String(v));
                computePadNoteMap();
            },
            options: [0, 1],
            format: function(v) { return SCALE_NAMES[v] || 'Minor'; }
        }),
        createValue('Swing Amt', {
            get: function() { return stubSwingAmt; },
            set: function(v) { stubSwingAmt = v; },
            min: 0, max: 100,
            format: function(v) { return v + '%'; }
        }),
        createEnum('Swing Res', {
            get: function() { return stubSwingRes; },
            set: function(v) { stubSwingRes = v; },
            options: [0, 1],
            format: function(v) { return ['1/16','1/8'][v] || '1/16'; }
        }),
        createValue('Input Vel', {
            get: function() { return stubInputVel; },
            set: function(v) { stubInputVel = v; },
            min: 0, max: 127,
            format: function(v) { return v === 0 ? 'Off' : String(v); }
        }),
        createToggle('Inp Quant', {
            get: function() { return stubInpQuant; },
            set: function(v) { stubInpQuant = v; },
            onLabel: 'On', offLabel: 'Off'
        }),
    ];
}

/* ------------------------------------------------------------------ */
/* UI state                                                             */
/* ------------------------------------------------------------------ */

let ledInitQueue    = [];
let ledInitIndex    = 0;
let ledInitComplete = false;  /* false until init queue fully flushed; tick() blocks normal render */
let shiftHeld       = false;
let loopHeld        = false;

/* Live pad note input — isomorphic 4ths diatonic layout. */
const SCALE_INTERVALS = [
    [0, 2, 3, 5, 7, 8, 10],   /* 0 = natural minor */
    [0, 2, 4, 5, 7, 9, 11],   /* 1 = major          */
];
let padKey    = 9;
let padScale  = 0;
let padOctave = new Array(NUM_TRACKS).fill(3);
let padNoteMap = new Array(32).fill(60);

/* Per-pad pitch sent at note-on — ensures matching note-off even if map changes mid-hold. */
const padPitch = new Array(32).fill(-1);

/* clipSteps[track][clip][step] — JS-authoritative mirror of DSP step data */
let clipSteps        = Array.from({length: NUM_TRACKS}, () =>
                           Array.from({length: NUM_CLIPS}, () => new Array(NUM_STEPS).fill(0)));
let clipLength       = Array.from({length: NUM_TRACKS}, () => new Array(NUM_CLIPS).fill(16));
let trackCurrentStep = new Array(NUM_TRACKS).fill(-1);
let trackCurrentPage = new Array(NUM_TRACKS).fill(0);
let trackActiveClip  = new Array(NUM_TRACKS).fill(0);
let trackQueuedClip  = new Array(NUM_TRACKS).fill(-1);
let trackPendingStop = new Array(NUM_TRACKS).fill(false);
let trackClipStopped = new Array(NUM_TRACKS).fill(false);
let playing          = false;
let activeTrack      = 0;
let sessionView      = false;
let sceneGroup       = 0;
let pulseStep        = 0;
let pulseUseBright   = false;
let tickCount        = 0;
const POLL_INTERVAL  = 4;

/* ------------------------------------------------------------------ */
/* Parameter bank state                                                 */
/* ------------------------------------------------------------------ */

/* activeBank[track]: index 0-7 (pad 92-99). TRACK bank (0) is default; never -1. */
let activeBank     = new Array(NUM_TRACKS).fill(0);

/* knobTouched: 0-7 (MoveKnob1Touch-8Touch note numbers), or -1 = none */
let knobTouched    = -1;
let masterVolDelta = 0;              /* accumulated CC 79 ticks; drained in tick() */

/* Per-physical-knob sensitivity accumulators.
 * knobAccum[k] counts raw encoder ticks; fires delta when >= pm.sens.
 * knobLastDir[k] tracks last direction for reversal detection.
 * knobLocked[k] blocks further firing until touch release (used by lock=true params). */
let knobAccum   = new Array(8).fill(0);
let knobLastDir = new Array(8).fill(0);
let knobLocked  = new Array(8).fill(false);

/* bankSelectTick: tickCount at last bank select, used for 2-second State 3 timeout.
 * -1 = timeout not active. */
let bankSelectTick = -1;
let jogTouched     = false;       /* true while jog wheel is physically held */
const BANK_DISPLAY_TICKS = 392;  /* ~2000ms at 196Hz tick rate */
let stretchBlockedEndTick = -1;  /* tickCount deadline for COMPRESS LIMIT display; -1 = inactive */
const STRETCH_BLOCKED_TICKS = 294;  /* ~1500ms at 196Hz */
let trackOctave = new Array(NUM_TRACKS).fill(0);  /* per-track live pad octave shift, -4..+4 */
let octaveOverlayEndTick = -1;                    /* tickCount deadline for octave overlay; -1 = inactive */
const OCTAVE_OVERLAY_TICKS = 196;                 /* ~1000ms at 196Hz */

/* bankParams[track][bankIdx][knobIdx] = integer value (JS-authoritative).
 * Initialized from BANKS defaults; refreshed from DSP on bank select. */
let bankParams = Array.from({length: NUM_TRACKS}, () =>
    BANKS.map(bank => bank.knobs.map(k => k.def)));

/* ------------------------------------------------------------------ */
/* Step entry state                                                     */
/* ------------------------------------------------------------------ */

/* heldStepBtn: physical button index 0-15 that is currently held (-1 = none).
 * Stored separately from heldStep so a second button press doesn't cause the
 * first button's release to exit step edit prematurely. */
let heldStepBtn   = -1;
let heldStep      = -1;   /* absolute step index (page*16 + btn) of the held step */
let heldStepNotes = [];   /* MIDI note numbers currently assigned to heldStep (up to 4) */

const STEP_HOLD_TICKS  = 40;   /* ~200ms at 196Hz: below = tap, at/above = hold */
let stepBtnPressedTick = new Array(16).fill(-1); /* tickCount per button when press is pending; -1 = none */
let lastPlayedNote     = 60;   /* MIDI note of last live pad press; fallback for empty step activation */
let liveActiveNotes    = new Set(); /* pitches currently held via live pad input */
let seqActiveNotes     = new Set(); /* pitches currently playing from sequencer (active track) */
let seqLastStep        = -1;   /* last step index queried for seqActiveNotes */
let seqLastClip        = -1;   /* last clip index queried for seqActiveNotes */
let deleteHeld         = false; /* true while Delete (CC 119) is held */

/* Global menu state (Phase 5q) */
let globalMenuOpen  = false;
let globalMenuItems = null;
let globalMenuState = null;
let globalMenuStack = null;
let bpmWasEditing   = false;

/* Session overview overlay (hold CC 50) */
let noteSessionPressedTick  = -1;    /* tickCount when CC 50 pressed; -1 = not pending */
let sessionOverlayHeld      = false; /* true while CC 50 held for graphical overview */
const NOTE_SESSION_HOLD_TICKS = 40;  /* ~200ms at 196Hz */
let overviewCache           = null;  /* null or Array[NUM_TRACKS][NUM_CLIPS] of booleans */

/* Real-time recording state */
let recordArmed         = false; /* true = Record pressed (count-in or recording active) */
let recordCountingIn    = false; /* true = JS-side count-in phase (transport not yet started) */
let recordArmedTrack    = -1;    /* track index that was active when Record was pressed */
let countInStartTick    = -1;    /* tickCount when count-in began; -1 = inactive */
let countInQuarterTicks = 0;     /* JS ticks per quarter note at BPM read on arm (visual only) */
let countInDspPrev      = false; /* previous DSP count_in_active value, for end-detection */
let playingPrev         = false; /* previous value of `playing`, for stop-transition detection */
let recordCaptureStep   = -1;    /* step index pinned for chord capture; -1 = no active window */
let recordCaptureClip   = -1;    /* clip index pinned for chord capture */
let recordCaptureEndTick = -1;   /* tickCount when capture window expires */
const RECORD_CAPTURE_TICKS = 8;  /* ~40ms at 196Hz: chord notes within this window land on same step */

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

function midiNoteName(n) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[n % 12] + (Math.floor(n / 12) - 1);
}

/* Immediately refresh seqActiveNotes for the given step if it is the current
 * sequencer position on the active track — call after any step state change. */
function refreshSeqNotesIfCurrent(t, ac, absIdx) {
    if (absIdx !== trackCurrentStep[t] || ac !== trackActiveClip[t]) return;
    seqActiveNotes.clear();
    seqLastStep = -1;
    if (clipSteps[t][ac][absIdx] && typeof host_module_get_param === 'function') {
        const r = host_module_get_param('t' + t + '_c' + ac + '_step_' + absIdx + '_notes');
        if (r && r.trim().length > 0)
            r.trim().split(' ').forEach(function(sn) {
                const p = parseInt(sn, 10);
                if (p >= 0 && p <= 127) seqActiveNotes.add(p);
            });
    }
}

/* Clear all notes from a step and deactivate it (atomic DSP write). */
function clearStep(t, ac, absIdx) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('t' + t + '_c' + ac + '_step_' + absIdx + '_clear', '1');
    clipSteps[t][ac][absIdx] = 0;
    refreshSeqNotesIfCurrent(t, ac, absIdx);
}

/* Clear all steps in a clip (single atomic DSP write). */
function clearClip(t, ac) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('t' + t + '_c' + ac + '_clear', '1');
    const len = clipLength[t][ac];
    for (let s = 0; s < len; s++) clipSteps[t][ac][s] = 0;
    if (ac === trackActiveClip[t]) { seqActiveNotes.clear(); seqLastStep = -1; }
}

/* Disarm real-time recording: clear DSP flag (triggers deferred save), update LED. */
function disarmRecord() {
    if (!recordArmed) return;
    const t = recordArmedTrack;
    recordArmed          = false;
    recordCountingIn     = false;
    recordArmedTrack     = -1;
    countInStartTick    = -1;
    countInQuarterTicks = 0;
    recordCaptureStep   = -1;
    recordCaptureClip    = -1;
    recordCaptureEndTick = -1;
    if (typeof host_module_set_param === 'function') {
        host_module_set_param('record_count_in_cancel', '1');
        if (t >= 0) host_module_set_param('t' + t + '_recording', '0');
    }
    setButtonLED(MoveRec, LED_OFF);
}

function openGlobalMenu() {
    globalMenuItems = buildGlobalMenuItems();
    globalMenuState = createMenuState();
    globalMenuStack = createMenuStack();
    globalMenuOpen  = true;
    jogTouched      = false;
}


function drawGlobalMenu() {
    clear_screen();
    drawMenuHeader('GLOBAL');
    drawMenuList({
        items: globalMenuItems,
        selectedIndex: globalMenuState.selectedIndex,
        listArea: { topY: menuLayoutDefaults.listTopY, bottomY: menuLayoutDefaults.listBottomNoFooter },
        valueAlignRight: true,
        prioritizeSelectedValue: true,
        selectedMinLabelChars: 9,
        getLabel: function(item) { return item ? (item.label || '') : ''; },
        getValue: function(item, index) {
            if (!item) return '';
            const isEditing = globalMenuState.editing && index === globalMenuState.selectedIndex;
            return formatItemValue(item, isEditing, globalMenuState.editValue);
        }
    });
}

function clipHasContent(t, c) {
    const s = clipSteps[t][c];
    for (let i = 0; i < NUM_STEPS; i++) if (s[i]) return true;
    return false;
}

function computePadNoteMap() {
    const intervals = SCALE_INTERVALS[padScale] || SCALE_INTERVALS[0];
    const root = padOctave[activeTrack] * 12 + padKey;
    for (let i = 0; i < 32; i++) {
        const col = i % 8;
        const row = Math.floor(i / 8);
        const deg = col + row * 3;
        const oct = Math.floor(deg / 7);
        const semitone = oct * 12 + intervals[deg % 7];
        padNoteMap[i] = Math.max(0, Math.min(127, root + semitone));
    }
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
            ledInitComplete = false;
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
    const end = Math.min(ledInitIndex + LEDS_PER_FRAME, ledInitQueue.length);
    for (let i = ledInitIndex; i < end; i++) {
        const led = ledInitQueue[i];
        if (led.kind === 'cc') setButtonLED(led.id, LED_OFF);
        else setLED(led.id, LED_OFF);
    }
    ledInitIndex = end;
    if (ledInitIndex >= ledInitQueue.length) ledInitComplete = true;
}

function pollDSP() {
    if (typeof host_module_get_param !== 'function') return;
    const snap = host_module_get_param('state_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 26) return;
    playing = (v[0] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        trackCurrentStep[t] = parseInt(v[1 + t], 10) | 0;
        trackActiveClip[t]  = parseInt(v[9 + t], 10) | 0;
        trackQueuedClip[t]  = parseInt(v[17 + t], 10) | 0;
    }
    const countInDspActive = (v[25] === '1');

    /* Count-in end: DSP fired transport+recording — sync JS state */
    if (countInDspPrev && !countInDspActive && playing) {
        recordCountingIn    = false;
        countInStartTick    = -1;
        countInQuarterTicks = 0;
    }
    countInDspPrev = countInDspActive;

    /* Stop transition: transport just stopped — clear recording state */
    if (playingPrev && !playing) {
        disarmRecord();
        trackPendingStop.fill(false);
        trackClipStopped.fill(false);
    }
    playingPrev = playing;

    /* Detect when a pending stop has fired in the DSP */
    if (playing) {
        for (let _t = 0; _t < NUM_TRACKS; _t++) {
            if (trackPendingStop[_t]) {
                const cs = host_module_get_param('t' + _t + '_clip_stopped');
                if (cs === '1') {
                    trackClipStopped[_t] = true;
                    trackPendingStop[_t] = false;
                    forceRedraw();
                }
            }
        }
    }

    /* Track sequencer notes for active track pad highlighting */
    const t  = activeTrack;
    const ac = trackActiveClip[t];
    const cs = trackCurrentStep[t];
    if (!playing) {
        seqActiveNotes.clear();
        seqLastStep = -1;
        seqLastClip = -1;
    } else if (cs !== seqLastStep || ac !== seqLastClip) {
        seqLastStep = cs;
        seqLastClip = ac;
        seqActiveNotes.clear();
        if (cs >= 0 && clipSteps[t][ac][cs]) {
            const raw = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_notes');
            if (raw && raw.trim().length > 0) {
                raw.trim().split(' ').forEach(function(sn) {
                    const pitch = parseInt(sn, 10);
                    if (pitch >= 0 && pitch <= 127) seqActiveNotes.add(pitch);
                });
            }
        }
    }

}

/* ------------------------------------------------------------------ */
/* Parameter bank: read from DSP and write to DSP                      */
/* ------------------------------------------------------------------ */

/* Read all wired params for bankIdx on track t from DSP into bankParams. */
function readBankParams(t, bankIdx) {
    if (typeof host_module_get_param !== 'function') return;
    const knobs = BANKS[bankIdx].knobs;
    for (let k = 0; k < 8; k++) {
        const pm = knobs[k];
        if (!pm || !pm.abbrev || pm.scope === 'stub') {
            bankParams[t][bankIdx][k] = pm ? pm.def : 0;
            continue;
        }
        if (pm.scope === 'clip') {
            const ac = trackActiveClip[t];
            bankParams[t][bankIdx][k] = Math.max(1, Math.round(clipLength[t][ac] / 16));
            continue;
        }
        if (pm.scope === 'action') {
            const stateKey = 't' + t + '_' + pm.dspKey + pm.actionSuffix;
            const raw = host_module_get_param(stateKey);
            bankParams[t][bankIdx][k] = parseActionRaw(raw, pm.def);
            continue;
        }
        const key = pm.scope === 'global' ? pm.dspKey : 't' + t + '_' + pm.dspKey;
        const raw = host_module_get_param(key);
        if (raw === null || raw === undefined) {
            bankParams[t][bankIdx][k] = pm.def;
            continue;
        }
        if (pm.dspKey === 'harm_unison') {
            bankParams[t][bankIdx][k] = raw === 'x2' ? 1 : raw === 'x3' ? 2 : 0;
        } else if (pm.dspKey === 'route') {
            bankParams[t][bankIdx][k] = raw === 'move' ? 1 : 0;
        } else if (pm.dspKey === 'delay_pitch_random') {
            bankParams[t][bankIdx][k] = (raw === 'on' || raw === '1') ? 1 : 0;
        } else {
            bankParams[t][bankIdx][k] = parseInt(raw, 10) || 0;
        }
    }
}

/* Send a single param change to DSP and apply any JS-side side-effects. */
function applyBankParam(t, bankIdx, knobIdx, val) {
    const pm = BANKS[bankIdx].knobs[knobIdx];
    if (!pm || pm.scope === 'stub' || !pm.dspKey) return;
    if (typeof host_module_set_param !== 'function') return;

    if (pm.scope === 'global') {
        host_module_set_param(pm.dspKey, String(val));
        if (pm.dspKey === 'key') { padKey = val; computePadNoteMap(); }
    } else if (pm.scope === 'track') {
        let strVal;
        if      (pm.dspKey === 'harm_unison')       strVal = ['OFF','x2','x3'][val] || 'OFF';
        else if (pm.dspKey === 'route')              strVal = val ? 'move' : 'schwung';
        else if (pm.dspKey === 'delay_pitch_random') strVal = val ? 'on' : 'off';
        else                                         strVal = String(val);
        host_module_set_param('t' + t + '_' + pm.dspKey, strVal);
        if (pm.dspKey === 'clip_length') {
            const ac = trackActiveClip[t];
            clipLength[t][ac] = val;
            const maxPage = Math.max(0, Math.ceil(val / 16) - 1);
            if (trackCurrentPage[t] > maxPage) trackCurrentPage[t] = maxPage;
        }
    } else if (pm.scope === 'clip') {
        const ac    = trackActiveClip[t];
        const steps = val * 16;
        clipLength[t][ac] = steps;
        host_module_set_param('t' + t + '_c' + ac + '_length', String(steps));
    }
}

/* Send a live note (note-on or note-off) for track t, applying per-track
 * channel and route from the TRACK bank params (bank 0, knobs 0 and 1). */
function liveSendNote(t, type, pitch, vel) {
    const ch    = (bankParams[t][0][0] - 1) & 0x0F;  /* Ch knob: 1-indexed → 0-indexed */
    const route = bankParams[t][0][1];                /* Rte knob: 0=Schwung, 1=Move */
    const status = type | ch;
    if (route === 1) {
        if (typeof move_midi_external_send === 'function') move_midi_external_send([status, pitch, vel]);
    } else {
        if (typeof shadow_send_midi_to_dsp === 'function') shadow_send_midi_to_dsp([status, pitch, vel]);
    }
}

/* ------------------------------------------------------------------ */
/* LED update functions                                                 */
/* ------------------------------------------------------------------ */

function updateStepLEDs() {
    if (!ledInitComplete) return;
    const ac = trackActiveClip[activeTrack];

    if (loopHeld) {
        const pagesInUse = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
        for (let i = 0; i < 16; i++)
            setLED(16 + i, i < pagesInUse ? TRACK_COLORS[activeTrack] : DarkGrey);
        return;
    }

    const steps  = clipSteps[activeTrack][ac];
    const cs     = trackCurrentStep[activeTrack];
    const page   = trackCurrentPage[activeTrack];
    const base   = page * 16;
    const len    = clipLength[activeTrack][ac];
    for (let i = 0; i < 16; i++) {
        const absStep = base + i;
        let color;
        if (absStep >= len) {
            color = White;
        } else if (playing && absStep === cs) {
            color = White;
        } else if (steps[absStep]) {
            color = TRACK_COLORS[activeTrack];
        } else {
            color = LED_OFF;
        }
        setLED(16 + i, color);
    }
}

function groupHasContent(group) {
    for (let row = 0; row < 4; row++) {
        const sceneIdx = group * 4 + row;
        for (let t = 0; t < NUM_TRACKS; t++)
            if (clipHasContent(t, sceneIdx)) return true;
    }
    return false;
}

function sceneAllPlaying(sceneIdx) {
    if (!playing) return false;
    for (let t = 0; t < NUM_TRACKS; t++)
        if (trackActiveClip[t] !== sceneIdx) return false;
    return true;
}

function updateSceneMapLEDs() {
    if (!ledInitComplete) return;
    for (let i = 0; i < 16; i++) {
        let color;
        if (sceneAllPlaying(i)) {
            color = pulseUseBright ? White : LED_OFF;
        } else {
            const group = Math.floor(i / 4);
            color = (group === sceneGroup) ? LED_STEP_CURSOR
                  : groupHasContent(group) ? LED_STEP_ACTIVE
                  : LED_OFF;
        }
        setLED(16 + i, color);
    }
}

function updateSessionLEDs() {
    if (!ledInitComplete) return;
    for (let row = 0; row < 4; row++) {
        const sceneIdx = sceneGroup * 4 + row;
        for (let t = 0; t < 8; t++) {
            const note = 92 - row * 8 + t;
            if (t >= NUM_TRACKS) { setLED(note, LED_OFF); continue; }
            const hasContent = clipHasContent(t, sceneIdx);
            const isActive   = trackActiveClip[t] === sceneIdx && !trackClipStopped[t];
            const isPlaying  = isActive && playing && hasContent;
            const isQueued   = hasContent && trackQueuedClip[t] === sceneIdx;
            let color;
            if (isPlaying || isQueued) {
                color = pulseUseBright ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isActive && hasContent) {
                color = TRACK_COLORS[t];
            } else if (hasContent) {
                color = TRACK_DIM_COLORS[t];
            } else {
                color = DarkGrey;
            }
            setLED(note, color);
        }
    }
}

function updateTrackLEDs() {
    if (!ledInitComplete) return;

    if (!sessionView) {
        const rootColor = TRACK_COLORS[activeTrack];
        for (let i = 0; i < 32; i++) {
            let color;
            const pitch    = Math.max(0, Math.min(127, padNoteMap[i] + trackOctave[activeTrack] * 12));
            const sounding = liveActiveNotes.has(pitch) || seqActiveNotes.has(pitch);
            const inHeld   = heldStep >= 0 && heldStepNotes.indexOf(pitch) >= 0;
            color = (sounding || inHeld) ? White
                  : (padNoteMap[i] % 12 === padKey ? rootColor : DarkGrey);
            setLED(TRACK_PAD_BASE + i, color);
        }
    }

    for (let idx = 0; idx < 4; idx++) {
        const row      = 3 - idx;
        const sceneIdx = sceneGroup * 4 + row;
        let color;
        if (sessionView) {
            color = sceneAllPlaying(sceneIdx) ? White : LED_OFF;
        } else {
            const t          = activeTrack;
            const hasContent = clipHasContent(t, sceneIdx);
            const isActive   = trackActiveClip[t] === sceneIdx && !trackClipStopped[t];
            const isPlaying  = isActive && playing && hasContent;
            const isQueued   = hasContent && trackQueuedClip[t] === sceneIdx;
            if (isActive) {
                color = TRACK_COLORS[t];
            } else if (isPlaying || isQueued) {
                color = pulseUseBright ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (hasContent) {
                color = TRACK_DIM_COLORS[t];
            } else {
                color = DarkGrey;
            }
        }
        setButtonLED(40 + idx, color);
    }
}

function forceRedraw() {
    if (!ledInitComplete) return;
    if (sessionView) {
        updateSessionLEDs();
        updateSceneMapLEDs();
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
    const bandY = sceneGroup * 16;
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
    const blinkOn = Math.floor(tickCount / 96) % 2 === 0;
    for (let t = 0; t < NUM_TRACKS; t++) {
        const x  = t * 16 + 1;
        const ac = trackActiveClip[t];
        for (let s = 0; s < NUM_CLIPS; s++) {
            const y      = s * 4 + 1;
            const color  = (s >= sceneGroup * 4 && s < (sceneGroup + 1) * 4) ? 1 : 0;
            const isActive         = (s === ac);
            const isActiveOnActive = (isActive && t === activeTrack);
            if (isActiveOnActive) {
                if (blinkOn) fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (isActive) {
                fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (overviewCache[t][s]) {
                fill_rect(x + 6, y + 1, 2, 1, color);
            }
        }
    }
}

function drawUI() {
    if (sessionOverlayHeld) { drawSessionOverview(); return; }
    if (globalMenuOpen) { drawGlobalMenu(); return; }
    clear_screen();
    if (sessionView) {
        const base = sceneGroup * 4;
        print(4, 10, 'SESSION  GRP ' + (sceneGroup + 1), 1);
        print(4, 22, SCENE_LETTERS[base] + '-' + SCENE_LETTERS[base + 3] + '  ROWS 1-4', 1);
        print(4, 34, '1 2 3 4 5 6 7 8', 1);
        let line4 = '';
        for (let t = 0; t < NUM_TRACKS; t++) {
            line4 += SCENE_LETTERS[trackActiveClip[t]];
            if (t < NUM_TRACKS - 1) line4 += ' ';
        }
        print(4, 46, line4, 1);
        return;
    }

    /* Track View — priority display state machine */
    const bank      = activeBank[activeTrack];
    const inTimeout = bankSelectTick >= 0 || jogTouched;

    /* Count-in overlay: highest priority while waiting for bar to elapse */
    if (recordArmed && recordCountingIn && !sessionView) {
        const ac_r       = trackActiveClip[recordArmedTrack];
        const totalPages = Math.max(1, Math.ceil(clipLength[recordArmedTrack][ac_r] / 16));
        print(4, 10, 'TR' + (recordArmedTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac_r] +
                     '  PG 1/' + totalPages, 1);
        print(4, 22, 'COUNT-IN', 1);
        print(4, 34, 'REC ARMED', 1);
        print(4, 46, '1 2 3 4 5 6 7 8', 1);
        return;
    }

    /* Compress-limit override: highest priority for ~1500ms after a blocked compress */
    if (stretchBlockedEndTick >= 0) {
        if (tickCount >= stretchBlockedEndTick) {
            stretchBlockedEndTick = -1;
        } else {
            print(4, 10, '[TIMING     ]', 1);
            print(4, 22, 'Beat Stretch', 1);
            print(4, 34, 'COMPRESS LIMIT', 1);
            return;
        }
    }

    /* Octave overlay: ~1000ms after Up/Down octave shift */
    if (octaveOverlayEndTick >= 0) {
        if (tickCount >= octaveOverlayEndTick) {
            octaveOverlayEndTick = -1;
        } else {
            const ac         = trackActiveClip[activeTrack];
            const page       = trackCurrentPage[activeTrack];
            const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
            const oct        = trackOctave[activeTrack];
            print(4, 10, 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] +
                         '  PG ' + (page + 1) + '/' + totalPages, 1);
            print(4, 22, 'KNOB: [' + BANKS[activeBank[activeTrack]].name + ']', 1);
            print(4, 34, 'Octave: ' + (oct > 0 ? '+' + oct : String(oct)), 1);
            print(4, 46, '1 2 3 4 5 6 7 8', 1);
            return;
        }
    }

    /* Step edit: show assigned notes and step identity */
    if (heldStep >= 0) {
        const ac       = trackActiveClip[activeTrack];
        const stepLabel = 'S' + (heldStep + 1);
        const noteStr  = heldStepNotes.length === 0
            ? '(empty)'
            : heldStepNotes.map(midiNoteName).join(' ');
        print(4, 10, 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] +
                     '  ' + stepLabel, 1);
        print(4, 22, 'STEP EDIT', 1);
        print(4, 34, noteStr, 1);
        print(4, 46, '1 2 3 4 5 6 7 8', 1);
        return;
    }

    if (bank >= 0 && knobTouched >= 0) {
        /* State 1: knob touched — single parameter */
        const pm  = BANKS[bank].knobs[knobTouched];
        const val = bankParams[activeTrack][bank][knobTouched];
        print(4, 10, bankHeader(bank), 1);
        print(4, 22, pm.full || '-', 1);
        print(4, 34, pm.fmt(val), 1);
        /* line 4 blank */

    } else if (bank >= 0 && inTimeout) {
        /* States 2/3: bank overview */
        const knobs = BANKS[bank].knobs;
        const vals  = bankParams[activeTrack][bank];
        const line2 = col4(knobs[0].abbrev) + ' ' + col4(knobs[1].abbrev) + ' ' +
                      col4(knobs[2].abbrev) + ' ' + col4(knobs[3].abbrev);
        const line3 = col4(knobs[0].abbrev ? knobs[0].fmt(vals[0]) : null) + ' ' +
                      col4(knobs[1].abbrev ? knobs[1].fmt(vals[1]) : null) + ' ' +
                      col4(knobs[2].abbrev ? knobs[2].fmt(vals[2]) : null) + ' ' +
                      col4(knobs[3].abbrev ? knobs[3].fmt(vals[3]) : null);
        const line4 = col4(knobs[4].abbrev) + ' ' + col4(knobs[5].abbrev) + ' ' +
                      col4(knobs[6].abbrev) + ' ' + col4(knobs[7].abbrev);
        print(4, 10, bankHeader(bank), 1);
        print(4, 22, line2, 1);
        print(4, 34, line3, 1);
        print(4, 46, line4, 1);

    } else {
        /* State 4: normal Track View */
        const ac         = trackActiveClip[activeTrack];
        const page       = trackCurrentPage[activeTrack];
        const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
        /* \xb7 = middle dot · */
        print(4, 10, 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] +
                     '  PG ' + (page + 1) + '/' + totalPages, 1);
        const recTag = (recordArmed && !recordCountingIn && recordArmedTrack === activeTrack)
            ? ' REC' : '';
        print(4, 22, 'KNOB: [' + BANKS[activeBank[activeTrack]].name + ']' + recTag, 1);
        if (loopHeld) {
            const steps = clipLength[activeTrack][ac];
            const pages = Math.max(1, Math.ceil(steps / 16));
            print(4, 22, 'LOOP LEN: ' + steps + ' STEPS', 1);
            print(4, 34, pages + ' OF 16 PAGES', 1);
        } else {
            print(4, 34, '1 2 3 4 5 6 7 8', 1);
        }
        let line4 = '';
        for (let t = 0; t < NUM_TRACKS; t++) {
            line4 += SCENE_LETTERS[trackActiveClip[t]];
            if (t < NUM_TRACKS - 1) line4 += ' ';
        }
        print(4, 46, line4, 1);
    }
}

function fmtHex(b) {
    return (b & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                            */
/* ------------------------------------------------------------------ */

globalThis.init = function () {
    installConsoleOverride('SEQ8');

    const p = (typeof host_module_get_param === 'function')
        ? host_module_get_param('playing') : null;
    const dspSurvived = (p !== null && p !== undefined);

    console.log('SEQ8 init: ' + (p === '1' ? 'RESUMED playing' : 'FRESH/stopped'));

    if (typeof host_module_get_param === 'function') {
        playing = dspSurvived;

        for (let t = 0; t < NUM_TRACKS; t++) {
            const ac = host_module_get_param('t' + t + '_active_clip');
            if (ac !== null && ac !== undefined) trackActiveClip[t] = parseInt(ac, 10) | 0;
            const cs = host_module_get_param('t' + t + '_current_step');
            const csVal = (cs !== null && cs !== undefined) ? (parseInt(cs, 10) | 0) : -1;
            trackCurrentStep[t] = csVal;
            trackCurrentPage[t] = csVal >= 0 ? Math.floor(csVal / 16) : 0;
            const qc = host_module_get_param('t' + t + '_queued_clip');
            trackQueuedClip[t] = (qc !== null && qc !== undefined) ? (parseInt(qc, 10) | 0) : -1;

            for (let c = 0; c < NUM_CLIPS; c++) {
                const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
                if (bulk && bulk.length >= NUM_STEPS) {
                    for (let s = 0; s < NUM_STEPS; s++)
                        clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                }
                const len = host_module_get_param('t' + t + '_c' + c + '_length');
                if (len !== null && len !== undefined)
                    clipLength[t][c] = parseInt(len, 10) || 16;
            }

            const po = host_module_get_param('t' + t + '_pad_octave');
            if (po !== null && po !== undefined) padOctave[t] = parseInt(po, 10) | 0;
        }

        const kp = host_module_get_param('key');
        if (kp !== null && kp !== undefined) padKey   = parseInt(kp, 10) | 0;
        const sp = host_module_get_param('scale');
        if (sp !== null && sp !== undefined) padScale = parseInt(sp, 10) | 0;

        /* Populate TRACK bank (index 0) params for all tracks — active by default. */
        for (let t = 0; t < NUM_TRACKS; t++) readBankParams(t, 0);
    }

    computePadNoteMap();

    ledInitComplete = false;
    ledInitQueue    = buildLedInitQueue();
    ledInitIndex    = 0;

    installFlagsWrap();
};

globalThis.tick = function () {
    tickCount++;

    /* Real-time preview while editing any global menu parameter */
    if (globalMenuOpen && globalMenuState && globalMenuItems) {
        const item = globalMenuItems[globalMenuState.selectedIndex];
        if (item && globalMenuState.editing && globalMenuState.editValue !== null) {
            if (item.set) item.set(globalMenuState.editValue);
            bpmWasEditing = true;
        } else if (bpmWasEditing && !globalMenuState.editing) {
            if (item && item.set && item.get) item.set(item.get());
            bpmWasEditing = false;
        }
    }

    /* Drain DSP ext_queue: ROUTE_MOVE sequencer notes → external MIDI */
    if (typeof host_module_get_param === 'function' && typeof move_midi_external_send === 'function') {
        const eq = host_module_get_param('ext_queue');
        if (eq && eq.length > 0) {
            for (const ev of eq.split(';')) {
                const p = ev.split(' ');
                if (p.length === 3) {
                    const s = parseInt(p[0], 10), d1 = parseInt(p[1], 10), d2 = parseInt(p[2], 10);
                    if (!isNaN(s) && !isNaN(d1) && !isNaN(d2)) move_midi_external_send([s, d1, d2]);
                }
            }
        }
    }

    pulseStep = (pulseStep + 1) % PULSE_PERIOD;
    const phase = Math.floor(pulseStep * 4 / PULSE_PERIOD);
    pulseUseBright = (phase === 1 || phase === 2);

    if (!ledInitComplete) {
        drainLedInit();
    } else {
        /* Bank select display timeout: State 3 → State 4 after ~2000ms */
        if (bankSelectTick >= 0 && (tickCount - bankSelectTick) >= BANK_DISPLAY_TICKS)
            bankSelectTick = -1;

        if (masterVolDelta !== 0 && typeof host_get_volume === 'function' && typeof host_set_volume === 'function') {
            host_set_volume(Math.max(0, Math.min(100, host_get_volume() + masterVolDelta)));
            masterVolDelta = 0;
        }

        if ((tickCount % POLL_INTERVAL) === 0) pollDSP();

        /* Step hold detection: any pending press crossing threshold → enter step edit (one at a time) */
        if (heldStep < 0) {
            for (let _btn = 0; _btn < 16; _btn++) {
                if (stepBtnPressedTick[_btn] >= 0 &&
                        (tickCount - stepBtnPressedTick[_btn]) >= STEP_HOLD_TICKS) {
                    const ac_h   = trackActiveClip[activeTrack];
                    const absIdx = trackCurrentPage[activeTrack] * 16 + _btn;
                    heldStepBtn              = _btn;
                    heldStep                 = absIdx;
                    stepBtnPressedTick[_btn] = -1;
                    const raw_h = typeof host_module_get_param === 'function'
                        ? host_module_get_param('t' + activeTrack + '_c' + ac_h + '_step_' + absIdx + '_notes')
                        : null;
                    heldStepNotes = (raw_h && raw_h.trim().length > 0)
                        ? raw_h.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                        : [];
                    forceRedraw();
                    break;
                }
            }
        }

        /* CC 50 hold detection: crossing threshold enters session overview */
        if (noteSessionPressedTick >= 0 && !sessionOverlayHeld &&
                (tickCount - noteSessionPressedTick) >= NOTE_SESSION_HOLD_TICKS) {
            noteSessionPressedTick = -1;
            sessionOverlayHeld = true;
            overviewCache = Array.from({length: NUM_TRACKS}, function(_, t) {
                return Array.from({length: NUM_CLIPS}, function(_, c) {
                    return clipHasContent(t, c);
                });
            });
        }

        /* Chord capture window expiry */
        if (recordCaptureStep >= 0 && tickCount >= recordCaptureEndTick) {
            recordCaptureStep    = -1;
            recordCaptureClip    = -1;
            recordCaptureEndTick = -1;
        }

        /* Transport LEDs */
        setButtonLED(MovePlay, playing ? Green : LED_OFF);
        setButtonLED(MoveRec,  recordArmed ? Red : LED_OFF);

        if (sessionView) {
            updateSessionLEDs();
            updateSceneMapLEDs();
        } else {
            updateStepLEDs();
            /* Count-in flash: blink all step buttons white at quarter-note rate */
            if (recordArmed && recordCountingIn && countInQuarterTicks > 0) {
                const elapsed  = tickCount - countInStartTick;
                const flashOn  = (elapsed % countInQuarterTicks) < (countInQuarterTicks >> 1);
                const flashClr = flashOn ? White : LED_OFF;
                for (let _i = 0; _i < 16; _i++) setLED(16 + _i, flashClr);
            }
        }
        updateTrackLEDs();
    }
    drawUI();
};

/* ------------------------------------------------------------------ */
/* MIDI input                                                           */
/* ------------------------------------------------------------------ */

globalThis.onMidiMessageInternal = function (data) {
    if (isNoiseMessage(data)) return;
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;

    /* While session overview is held, swallow everything except CC 50 release and Up/Down scroll. */
    if (sessionOverlayHeld) {
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
                if (d1 <= 7 && activeBank[activeTrack] >= 0) knobTouched = d1;
                if (d1 === MoveMainTouch && !globalMenuOpen && !shiftHeld) { jogTouched = true; forceRedraw(); }
            } else if (d2 < 64) {
                if (d1 <= 7) {
                    knobTouched = -1;
                    knobLocked[d1] = false;
                    knobAccum[d1]  = 0;
                }
                if (d1 === MoveMainTouch && jogTouched) { jogTouched = false; forceRedraw(); }
            }
            return;
        }
        if ((status & 0xF0) === 0x80) {
            if (d1 <= 7) {
                knobTouched = -1;
                knobLocked[d1] = false;
                knobAccum[d1]  = 0;
            }
            if (d1 === MoveMainTouch && jogTouched) { jogTouched = false; forceRedraw(); }
            return;
        }
    }

    if (status === 0xB0) {
        /* Volume knob (CC 79) — accumulate delta with host acceleration curve; applied in tick(). */
        if (d1 === 79) {
            let vd;
            if (d2 >= 1 && d2 <= 63)        { vd = d2 > 10 ? 5 : d2 > 3 ? 2 : 1; }
            else if (d2 >= 65 && d2 <= 127) { const s = 128 - d2; vd = s > 10 ? -5 : s > 3 ? -2 : -1; }
            else                             { vd = 0; }
            masterVolDelta += vd;
            return;
        }

        /* CC 3 = jog wheel physical click */
        if (d1 === 3 && d2 === 127 && globalMenuOpen) {
            handleMenuInput({
                cc: 3, value: d2,
                items: globalMenuItems, state: globalMenuState, stack: globalMenuStack,
                onBack: function() { globalMenuOpen = false; },
                shiftHeld: shiftHeld
            });
            return;
        }

        if (d1 === MoveMainKnob) {
            if (globalMenuOpen) {
                if (globalMenuState.editing) {
                    /* Edit mode: linear jog for all item types, no acceleration. */
                    const delta = decodeDelta(d2);
                    if (delta !== 0) {
                        const item = globalMenuItems[globalMenuState.selectedIndex];
                        if (item && item.type === 'value') {
                            const cur = globalMenuState.editValue !== null ? globalMenuState.editValue : item.get();
                            globalMenuState.editValue = Math.min(item.max, Math.max(item.min, cur + delta));
                        } else if (item && item.type === 'enum') {
                            const opts = item.options || [];
                            const idx  = opts.indexOf(globalMenuState.editValue);
                            const sign = delta > 0 ? 1 : -1;
                            globalMenuState.editValue = opts[((idx + sign) % opts.length + opts.length) % opts.length];
                        }
                    }
                } else {
                    handleMenuInput({
                        cc: MoveMainKnob, value: d2,
                        items: globalMenuItems, state: globalMenuState, stack: globalMenuStack,
                        onBack: function() { globalMenuOpen = false; },
                        shiftHeld: shiftHeld
                    });
                }
            } else {
                const delta = decodeDelta(d2);
                if (delta !== 0) {
                    if (sessionView) {
                        if (!shiftHeld) {
                            sceneGroup = (sceneGroup + delta + 4) % 4;
                            forceRedraw();
                        }
                        /* Shift + jog in Session View: no-op */
                    } else if (shiftHeld) {
                        /* Track View + Shift: step active track 0–7, clamp at ends */
                        const next = Math.min(NUM_TRACKS - 1, Math.max(0, activeTrack + delta));
                        if (next !== activeTrack) {
                            activeTrack = next;
                            computePadNoteMap();
                            seqActiveNotes.clear();
                            seqLastStep = -1;
                            seqLastClip = -1;
                            forceRedraw();
                        }
                    } else {
                        /* Track View: step active bank 0–6, clamp at ends (bank 7 reserved) */
                        const cur  = activeBank[activeTrack];
                        const next = Math.min(6, Math.max(0, cur + delta));
                        if (next !== cur) {
                            activeBank[activeTrack] = next;
                            readBankParams(activeTrack, next);
                            bankSelectTick = tickCount;
                            forceRedraw();
                        }
                    }
                }
            }
            return;
        }

        if (d1 === MoveShift) {
            shiftHeld = d2 === 127;
            if (!shiftHeld && jogTouched) { jogTouched = false; forceRedraw(); }
        }

        if (d1 === 119) {
            deleteHeld = d2 === 127;
        }

        /* Note/Session view toggle: Shift+press = open global menu (Track View only);
         * tap = switch view; hold = session overview */
        if (d1 === MoveNoteSession) {
            if (d2 === 127) {
                if (shiftHeld && !sessionView) {
                    if (globalMenuOpen) { globalMenuOpen = false; forceRedraw(); }
                    else { openGlobalMenu(); }
                } else {
                    noteSessionPressedTick = tickCount;
                }
            } else if (d2 === 0) {
                if (sessionOverlayHeld) {
                    sessionOverlayHeld = false;
                    overviewCache = null;
                    forceRedraw();
                } else if (noteSessionPressedTick >= 0) {
                    /* Tap: toggle view */
                    sessionView = !sessionView;
                    heldStepBtn        = -1;
                    heldStep           = -1;
                    heldStepNotes      = [];
                    stepBtnPressedTick.fill(-1);
                    if (sessionView) {
                        for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF);
                        for (let t = 0; t < 8; t++) setLED(TRACK_PAD_BASE + t, LED_OFF);
                    } else {
                        for (let row = 0; row < 4; row++)
                            for (let t = 0; t < 8; t++) setLED(92 - row * 8 + t, LED_OFF);
                    }
                    forceRedraw();
                }
                noteSessionPressedTick = -1;
            }
        }

        /* Loop button (CC 58): hold + step buttons sets clip length */
        if (d1 === MoveLoop && !sessionView) {
            loopHeld = d2 === 127;
            if (loopHeld) {
                heldStepBtn        = -1;
                heldStep           = -1;
                heldStepNotes      = [];
                stepBtnPressedTick.fill(-1);
            }
            forceRedraw();
        }

        /* Back: close global menu if open; otherwise (with Shift) hide module */
        if (d1 === MoveBack && d2 === 127) {
            if (globalMenuOpen) {
                globalMenuOpen = false;
                forceRedraw();
            } else if (shiftHeld) {
                removeFlagsWrap();
                ledInitComplete = false;
                clearAllLEDs();
                for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
                if (typeof host_hide_module === 'function') host_hide_module();
            }
        }

        /* Play: toggle transport; Shift+Play = panic */
        if (d1 === MovePlay && d2 === 127) {
            if (shiftHeld) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('transport', 'panic');
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('transport', playing ? 'stop' : 'play');
            }
        }

        /* Record button (CC 86): toggle arm/disarm */
        if (d1 === MoveRec && d2 === 127) {
            if (recordArmed) {
                disarmRecord();
            } else if (!playing) {
                /* Stopped → DSP-side 1-bar count-in; transport+recording fire from render thread */
                const rawBpm = typeof host_module_get_param === 'function'
                    ? parseFloat(host_module_get_param('bpm')) : 120;
                const bpm = (rawBpm > 0 && isFinite(rawBpm)) ? rawBpm : 120;
                recordArmed         = true;
                recordCountingIn    = true;
                recordArmedTrack    = activeTrack;
                countInStartTick    = tickCount;
                countInQuarterTicks = Math.round(196 * 60 / bpm);
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('record_count_in', String(activeTrack));
                setButtonLED(MoveRec, Red);
            } else {
                /* Playing → arm immediately with no count-in */
                recordArmed      = true;
                recordCountingIn = false;
                recordArmedTrack = activeTrack;
                setButtonLED(MoveRec, Red);
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + activeTrack + '_recording', '1');
            }
        }

        /* Left/Right: page nav in Track View */
        if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !sessionView) {
            const ac         = trackActiveClip[activeTrack];
            const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
            if (d1 === MoveLeft)
                trackCurrentPage[activeTrack] = Math.max(0, trackCurrentPage[activeTrack] - 1);
            else
                trackCurrentPage[activeTrack] = Math.min(totalPages - 1, trackCurrentPage[activeTrack] + 1);
        }

        /* Up/Down: scene group nav in Session View or while overview held; octave shift in Track View */
        if (d1 === MoveDown && d2 === 127 && (sessionView || sessionOverlayHeld) && sceneGroup < 3) { sceneGroup++; forceRedraw(); }
        if (d1 === MoveUp   && d2 === 127 && (sessionView || sessionOverlayHeld) && sceneGroup > 0) { sceneGroup--; forceRedraw(); }
        if (d1 === MoveUp   && d2 > 0 && !sessionView && !sessionOverlayHeld) {
            trackOctave[activeTrack] = Math.min(4, trackOctave[activeTrack] + 1);
            octaveOverlayEndTick = tickCount + OCTAVE_OVERLAY_TICKS;
            if (heldStep >= 0) forceRedraw();
        }
        if (d1 === MoveDown && d2 > 0 && !sessionView && !sessionOverlayHeld) {
            trackOctave[activeTrack] = Math.max(-4, trackOctave[activeTrack] - 1);
            octaveOverlayEndTick = tickCount + OCTAVE_OVERLAY_TICKS;
            if (heldStep >= 0) forceRedraw();
        }

        /* Track buttons CC40-43 */
        if (d1 >= 40 && d1 <= 43 && d2 === 127) {
            const idx = d1 - 40;
            if (deleteHeld) {
                if (!sessionView) {
                    /* Delete + track button (Track View): clear the clip at this scene position on active track */
                    const clipIdx = sceneGroup * 4 + (3 - idx);
                    clearClip(activeTrack, clipIdx);
                    forceRedraw();
                }
                /* In Session View: swallow — no accidental scene launch */
            } else if (sessionView) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(sceneGroup * 4 + (3 - idx)));
            } else {
                const t       = activeTrack;
                const clipIdx = sceneGroup * 4 + (3 - idx);
                if (trackActiveClip[t] === clipIdx) {
                    if (trackClipStopped[t] || trackPendingStop[t]) {
                        trackClipStopped[t] = false;
                        trackPendingStop[t] = false;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                    } else if (playing) {
                        trackPendingStop[t] = true;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_stop_at_end', '1');
                    } else {
                        trackClipStopped[t] = true;
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_stop_at_end', '1');
                        forceRedraw();
                    }
                } else {
                    trackClipStopped[t] = false;
                    trackPendingStop[t] = false;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                }
            }
        }

        /* Knob CCs 71-78: apply delta to active bank parameter.
         * Relative encoder: d2 1-63 = CW (+1), d2 64-127 = CCW (-1).
         * pm.sens > 1 = accumulate that many ticks before firing one unit change.
         * pm.lock = true: fire once then block until touch release (knobLocked). */
        if (d1 >= 71 && d1 <= 78) {
            const knobIdx = d1 - 71;
            const bank    = activeBank[activeTrack];
            const pm      = BANKS[bank].knobs[knobIdx];
            if (pm && pm.abbrev && pm.scope !== 'stub' && !knobLocked[knobIdx]) {
                const dir = (d2 >= 1 && d2 <= 63) ? 1 : -1;
                if (dir !== knobLastDir[knobIdx]) {
                    knobAccum[knobIdx]   = 0;
                    knobLastDir[knobIdx] = dir;
                }
                knobAccum[knobIdx]++;
                if (knobAccum[knobIdx] >= pm.sens) {
                    knobAccum[knobIdx] = 0;
                    if (pm.scope === 'action') {
                        const t   = activeTrack;
                        const ac  = trackActiveClip[t];
                        const len = clipLength[t][ac];
                        if (pm.lock) {
                            /* Beat Stretch: one-shot, then lock until touch release */
                            const canFire = dir === 1 ? (len * 2 <= 256) : (len >= 2);
                            if (canFire && typeof host_module_set_param === 'function') {
                                host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                                knobLocked[knobIdx] = true;
                                /* For compress: check if DSP blocked due to step collision */
                                if (dir === -1 && host_module_get_param('t' + t + '_beat_stretch_blocked') === '1') {
                                    stretchBlockedEndTick = tickCount + STRETCH_BLOCKED_TICKS;
                                } else {
                                    /* Mirror DSP step rewrite in JS clipSteps */
                                    const steps = clipSteps[t][ac];
                                    if (dir === 1) {
                                        for (let si = len - 1; si >= 1; si--) {
                                            steps[si * 2] = steps[si];
                                            steps[si] = 0;
                                        }
                                        for (let si = 1; si < len * 2; si += 2) steps[si] = 0;
                                        clipLength[t][ac] = len * 2;
                                    } else {
                                        const halfLen = len >> 1;
                                        const tmp = new Array(halfLen).fill(0);
                                        for (let si = 0; si < len; si++) {
                                            if (steps[si] && !tmp[si >> 1]) tmp[si >> 1] = 1;
                                        }
                                        for (let si = 0; si < len; si++) steps[si] = 0;
                                        for (let si = 0; si < halfLen; si++) steps[si] = tmp[si];
                                        clipLength[t][ac] = halfLen;
                                    }
                                    /* Clamp page index to new length */
                                    const newPages = Math.max(1, Math.ceil(clipLength[t][ac] / 16));
                                    if (trackCurrentPage[t] >= newPages)
                                        trackCurrentPage[t] = newPages - 1;
                                    /* Read factor back from DSP — authoritative */
                                    const rawFactor = host_module_get_param('t' + t + '_beat_stretch_factor');
                                    bankParams[t][bank][knobIdx] = parseActionRaw(rawFactor, 0);
                                }
                            }
                        } else {
                            /* Clock Shift: continuous rotation, no lock */
                            if (len >= 2 && typeof host_module_set_param === 'function') {
                                host_module_set_param('t' + t + '_' + pm.dspKey, String(dir));
                                const steps = clipSteps[t][ac];
                                if (dir === 1) {
                                    const last = steps[len - 1];
                                    for (let si = len - 1; si > 0; si--) steps[si] = steps[si - 1];
                                    steps[0] = last;
                                } else {
                                    const first = steps[0];
                                    for (let si = 0; si < len - 1; si++) steps[si] = steps[si + 1];
                                    steps[len - 1] = first;
                                }
                                const cur = bankParams[t][bank][knobIdx];
                                bankParams[t][bank][knobIdx] = (cur + (dir === 1 ? 1 : len - 1)) % len;
                            }
                        }
                    } else {
                        const cur = bankParams[activeTrack][bank][knobIdx];
                        const nv  = Math.max(pm.min, Math.min(pm.max, cur + dir));
                        if (nv !== cur) {
                            bankParams[activeTrack][bank][knobIdx] = nv;
                            applyBankParam(activeTrack, bank, knobIdx, nv);
                        }
                    }
                }
            }
        }
    }

    /* Step buttons: notes 16-31, note-on only */
    if ((status & 0xF0) === 0x90 && d1 >= 16 && d1 <= 31 && d2 > 0) {
        const idx = d1 - 16;
        if (sessionView) {
            if (!deleteHeld) {
                const targetGroup = Math.floor(idx / 4);
                if (shiftHeld) {
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('launch_scene', String(idx));
                } else {
                    sceneGroup = targetGroup;
                }
            }
            /* deleteHeld in Session View: swallow step buttons */
        } else if (loopHeld) {
            const ac      = trackActiveClip[activeTrack];
            const newLen  = (idx + 1) * 16;
            clipLength[activeTrack][ac] = newLen;
            const maxPage = Math.max(0, Math.ceil(newLen / 16) - 1);
            if (trackCurrentPage[activeTrack] > maxPage)
                trackCurrentPage[activeTrack] = maxPage;
            if (typeof host_module_set_param === 'function')
                host_module_set_param('t' + activeTrack + '_c' + ac + '_length', String(newLen));
            forceRedraw();
        } else if (deleteHeld) {
            /* Delete + step button (Track View): clear all notes from that step */
            const ac     = trackActiveClip[activeTrack];
            const absIdx = trackCurrentPage[activeTrack] * 16 + idx;
            clearStep(activeTrack, ac, absIdx);
            forceRedraw();
        } else if (!shiftHeld) {
            /* Record press — tap vs hold decided in tick() or note-off */
            stepBtnPressedTick[idx] = tickCount;
        }
    }

    /* Pad presses: note-on */
    if ((status & 0xF0) === 0x90 && d2 > 0) {
        if (sessionView) {
            for (let row = 0; row < 4; row++) {
                const rowBase = 92 - row * 8;
                if (d1 >= rowBase && d1 < rowBase + NUM_TRACKS) {
                    const t = d1 - rowBase;
                    if (deleteHeld) {
                        /* Delete + clip pad (Session View): clear that clip */
                        const clipIdx = sceneGroup * 4 + row;
                        clearClip(t, clipIdx);
                        forceRedraw();
                    } else {
                        const clipIdx = sceneGroup * 4 + row;
                        if (trackActiveClip[t] === clipIdx) {
                            if (trackClipStopped[t] || trackPendingStop[t]) {
                                /* Re-launch: clip is stopped or pending stop — cancel and restart */
                                trackClipStopped[t] = false;
                                trackPendingStop[t] = false;
                                activeTrack = t;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            } else if (playing) {
                                /* Arm stop at end of current loop */
                                trackPendingStop[t] = true;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_stop_at_end', '1');
                            } else {
                                /* Transport stopped: deactivate immediately */
                                trackClipStopped[t] = true;
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_stop_at_end', '1');
                                forceRedraw();
                            }
                        } else {
                            trackClipStopped[t] = false;
                            trackPendingStop[t] = false;
                            activeTrack = t;
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                        }
                    }
                    break;
                }
            }
        } else {
            if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
                const padIdx = d1 - TRACK_PAD_BASE;

                if (heldStep >= 0 && !shiftHeld) {
                    /* Step edit: tap pad to toggle note assignment for held step */
                    const ac    = trackActiveClip[activeTrack];
                    const pitch = Math.max(0, Math.min(127, padNoteMap[padIdx] + trackOctave[activeTrack] * 12));
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + activeTrack + '_c' + ac + '_step_' + heldStep + '_toggle', String(pitch));
                    /* Read back authoritative note list */
                    const raw = typeof host_module_get_param === 'function'
                        ? host_module_get_param('t' + activeTrack + '_c' + ac + '_step_' + heldStep + '_notes')
                        : null;
                    heldStepNotes = (raw && raw.trim().length > 0)
                        ? raw.trim().split(' ').map(Number).filter(n => n >= 0 && n <= 127)
                        : [];
                    /* Mirror step active state in JS */
                    clipSteps[activeTrack][ac][heldStep] = heldStepNotes.length > 0 ? 1 : 0;
                    refreshSeqNotesIfCurrent(activeTrack, ac, heldStep);
                    /* Preview note */
                    padPitch[padIdx] = pitch;
                    liveActiveNotes.add(pitch);
                    liveSendNote(activeTrack, 0x90, pitch, Math.max(80, d2));
                    forceRedraw();
                } else if (shiftHeld && padIdx >= 24 && padIdx <= 31) {
                    /* Shift + top-row pad (notes 92-99): select bank.
                     * Pad 99 (bankIdx 7) = reserved — ignore. */
                    const bankIdx = padIdx - 24;
                    if (bankIdx < 7) {
                        if (activeBank[activeTrack] === bankIdx) {
                            /* Same bank pressed again: return to TRACK bank (0) */
                            activeBank[activeTrack] = 0;
                            bankSelectTick = -1;
                        } else {
                            activeBank[activeTrack] = bankIdx;
                            readBankParams(activeTrack, bankIdx);
                            bankSelectTick = tickCount;
                        }
                    }
                } else if (shiftHeld && padIdx < NUM_TRACKS) {
                    /* Shift + bottom-row pad: select active track */
                    activeTrack = padIdx;
                    computePadNoteMap();
                    seqActiveNotes.clear();
                    seqLastStep = -1;
                    seqLastClip = -1;
                } else if (!shiftHeld) {
                    /* Live note — apply per-track octave shift, clamp 0-127 */
                    const basePitch = padNoteMap[padIdx];
                    const pitch = Math.max(0, Math.min(127, basePitch + trackOctave[activeTrack] * 12));
                    padPitch[padIdx] = pitch;
                    lastPlayedNote = pitch;
                    liveActiveNotes.add(pitch);
                    liveSendNote(activeTrack, 0x90, pitch, Math.max(80, d2));
                    /* Pre-roll capture: note in last 1/16th of count-in → step 0 */
                    if (recordArmed && recordCountingIn &&
                            activeTrack === recordArmedTrack &&
                            countInQuarterTicks > 0 &&
                            (tickCount - countInStartTick) >= Math.round(countInQuarterTicks * 7 / 2) &&
                            typeof host_module_set_param === 'function') {
                        const rt   = recordArmedTrack;
                        const ac_r = trackActiveClip[rt];
                        host_module_set_param('t' + rt + '_c' + ac_r + '_step_0_add', String(pitch));
                        clipSteps[rt][ac_r][0] = 1;
                    }
                    /* Overdub capture: add to current step of armed track.
                     * Pin step index for RECORD_CAPTURE_TICKS so chord notes arriving
                     * across poll boundaries all land on the same step. */
                    if (recordArmed && !recordCountingIn &&
                            activeTrack === recordArmedTrack &&
                            typeof host_module_set_param === 'function') {
                        const rt   = recordArmedTrack;
                        const ac_r = trackActiveClip[rt];
                        let   cs_r;
                        if (recordCaptureStep >= 0 && recordCaptureClip === ac_r) {
                            /* Reuse pinned step for chord */
                            cs_r = recordCaptureStep;
                        } else {
                            /* First note of a new chord — pin current step */
                            cs_r = trackCurrentStep[rt];
                            if (cs_r >= 0) {
                                recordCaptureStep    = cs_r;
                                recordCaptureClip    = ac_r;
                                recordCaptureEndTick = tickCount + RECORD_CAPTURE_TICKS;
                            }
                        }
                        if (cs_r >= 0) {
                            host_module_set_param(
                                't' + rt + '_c' + ac_r + '_step_' + cs_r + '_add',
                                String(pitch));
                            clipSteps[rt][ac_r][cs_r] = 1;
                        }
                    }
                }
            }
        }
    }

    /* Pad releases: note-off */
    if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
        /* Step button release: exit edit or commit tap-toggle */
        if (d1 >= 16 && d1 <= 31) {
            const btn = d1 - 16;
            if (btn === heldStepBtn) {
                /* Exit step edit mode */
                heldStepBtn   = -1;
                heldStep      = -1;
                heldStepNotes = [];
                forceRedraw();
            } else if (stepBtnPressedTick[btn] >= 0) {
                /* Tap: released before hold threshold — toggle step on/off */
                const ac_t   = trackActiveClip[activeTrack];
                const absIdx = trackCurrentPage[activeTrack] * 16 + btn;
                const wasOn  = clipSteps[activeTrack][ac_t][absIdx] === 1;
                stepBtnPressedTick[btn] = -1;
                if (!wasOn) {
                    /* Activating: assign lastPlayedNote if step has default note */
                    const raw_t = typeof host_module_get_param === 'function'
                        ? host_module_get_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx + '_notes')
                        : null;
                    const norm = raw_t ? raw_t.trim() : '';
                    if (!norm) {
                        /* count=0: assign lastPlayedNote via toggle */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', String(lastPlayedNote));
                    } else if (norm === '60' && lastPlayedNote !== 60) {
                        /* Default C4 and player last played something else: swap */
                        if (typeof host_module_set_param === 'function') {
                            host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', '60');
                            host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', String(lastPlayedNote));
                        }
                    } else {
                        /* Has explicit notes or C4 is lastPlayedNote: reactivate as-is */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx, '1');
                    }
                    clipSteps[activeTrack][ac_t][absIdx] = 1;
                    refreshSeqNotesIfCurrent(activeTrack, ac_t, absIdx);
                } else {
                    /* Deactivating: preserve note data */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx, '0');
                    clipSteps[activeTrack][ac_t][absIdx] = 0;
                    refreshSeqNotesIfCurrent(activeTrack, ac_t, absIdx);
                }
                forceRedraw();
            }
        }
        if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
            const padIdx = d1 - TRACK_PAD_BASE;
            const pitch = padPitch[padIdx] >= 0 ? padPitch[padIdx] : padNoteMap[padIdx];
            liveActiveNotes.delete(pitch);
            padPitch[padIdx] = -1;
            if (!sessionView) liveSendNote(activeTrack, 0x80, pitch, 0);
        }
    }
};

globalThis.onMidiMessageExternal = function (data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;
    console.log("MIDI EXT: status=0x" + fmtHex(status) + " data1=" + fmtHex(d1) + " data2=" + fmtHex(d2));
};
