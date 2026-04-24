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

/* CC 50 = Note/Session toggle (three-bar button left of track buttons). */
const MoveNoteSession = 50;
const MoveCopy        = 60;  /* Copy modifier button (CC) */
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

const LED_OFF              = 0;
const LED_STEP_ACTIVE      = 36;
const LED_STEP_CURSOR      = 127;
const SCENE_BTN_FLASH_TICKS = 40;
const LEDS_PER_FRAME  = 8;
const NUM_TRACKS      = 8;
const NUM_CLIPS       = 16;



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
const SCALE_NAMES = [
    'Major', 'Minor', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian',
    'Locrian', 'Harmonic Minor', 'Melodic Minor',
    'Pentatonic Major', 'Pentatonic Minor', 'Blues', 'Whole Tone', 'Diminished'
];
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
    /* 1 — TIMING (pad 93) — Beat Stretch, Clock Shift, Input Quantize */
    { name: 'TIMING', knobs: [
        p('Stch', 'Beat Stretch',    'beat_stretch', 'action', 0, 0,   0,   fmtStretch, 16, '_factor', true),
        p('Shft', 'Clock Shift',     'clock_shift',  'action', 0, 0,   0,   fmtPlain,   8),
        p('Qnt',  'Quantize',         'quantize',     'track',  0, 100, 0,   fmtPct),
        _X, _X, _X, _X, _X,
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
        p('Rep',  'Repeats',        'delay_repeats',      'track', 0,    16,  0, fmtPlain),
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

/* Launch quantization: 0=Now, 1=1/16, 2=1/8, 3=1/4, 4=1/2, 5=1-bar; default 0 */
let launchQuant = 0;
let scaleAware  = 0;

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
            options: [0,1,2,3,4,5,6,7,8,9,10,11,12,13],
            format: function(v) { return SCALE_NAMES[v] || 'Major'; }
        }),
        createToggle('Scale Aware', {
            get: function() { return scaleAware !== 0; },
            set: function(v) {
                scaleAware = v ? 1 : 0;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('scale_aware', scaleAware ? '1' : '0');
            },
            onLabel: 'On', offLabel: 'Off'
        }),
        createEnum('Launch', {
            get: function() { return launchQuant; },
            set: function(v) {
                launchQuant = v;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_quant', String(v));
            },
            options: [0, 1, 2, 3, 4, 5],
            format: function(v) {
                return ['Now','1/16','1/8','1/4','1/2','1-bar'][v] || '1-bar';
            }
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
            format: function(v) { return v === 0 ? 'Live' : String(v); }
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
    if (!scaleAware) return Math.max(0, Math.min(127, note + dir));
    const ivls = SCALE_INTERVALS[scale];
    let candidate = note + dir;
    while (candidate >= 0 && candidate <= 127) {
        const pc = ((candidate - key) % 12 + 12) % 12;
        if (ivls.indexOf(pc) >= 0) return candidate;
        candidate += dir;
    }
    return Math.max(0, Math.min(127, note + dir));
}

let padKey    = 9;
let padScale  = 1;   /* Minor */
let padOctave = new Array(NUM_TRACKS).fill(3);
let padNoteMap = new Array(32).fill(60);

/* Per-pad pitch sent at note-on — ensures matching note-off even if map changes mid-hold. */
const padPitch = new Array(32).fill(-1);

/* clipSteps[track][clip][step] — JS-authoritative mirror of DSP step data */
let clipSteps        = Array.from({length: NUM_TRACKS}, () =>
                           Array.from({length: NUM_CLIPS}, () => new Array(NUM_STEPS).fill(0)));
/* clipNonEmpty[track][clip] — cached result of clipHasContent; updated on every clipSteps write */
let clipNonEmpty     = Array.from({length: NUM_TRACKS}, () => new Array(NUM_CLIPS).fill(false));
let clipLength       = Array.from({length: NUM_TRACKS}, () => new Array(NUM_CLIPS).fill(16));
let trackCurrentStep = new Array(NUM_TRACKS).fill(-1);
let trackCurrentPage = new Array(NUM_TRACKS).fill(0);
let trackActiveClip  = new Array(NUM_TRACKS).fill(0);
let trackQueuedClip  = new Array(NUM_TRACKS).fill(-1);
let trackClipPlaying     = new Array(NUM_TRACKS).fill(false);
let trackWillRelaunch    = new Array(NUM_TRACKS).fill(false);
let trackPendingPageStop  = new Array(NUM_TRACKS).fill(false);
let sceneBtnFlashTick     = new Array(4).fill(-1); /* tickCount of last scene btn press; -1 = none */
let playing              = false;
let activeTrack      = 0;
let sessionView      = false;
let hasInitedOnce    = false;   /* false only on first init() call in this JS session */
let sceneRow         = 0;
let flashEighth          = false;
let flashSixteenth       = false;
let tickCount            = 0;
const POLL_INTERVAL  = 4;

/* Per-tick scene state cache — computed once at top of tick(), O(1) lookup in LED update fns */
let cachedSceneAllPlaying = new Array(16).fill(false);
let cachedSceneAllQueued  = new Array(16).fill(false);
let cachedSceneAnyPlaying = new Array(16).fill(false);

/* LED send cache — skip move_midi_internal_send when color unchanged */
const lastSentNoteLED     = new Array(128).fill(-1);
const lastSentButtonLED   = new Array(128).fill(-1);

/* ------------------------------------------------------------------ */
/* Parameter bank state                                                 */
/* ------------------------------------------------------------------ */

/* activeBank: index 0-7 (pad 92-99). Global — independent of track. TRACK bank (0) is default; never -1. */
let activeBank     = 0;

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
let screenDirty = true;   /* true = OLED must redraw this tick */
let lastBlinkOn = null;   /* tracks session overview blink state for dirty detection */

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
let stepWasEmpty  = false; /* true if step was empty when pressed; tap release should not deactivate */
let stepEditVel   = 100;  /* step edit overlay: current step velocity */
let stepEditGate  = 12;   /* step edit overlay: current step gate ticks */
let stepEditNudge = 0;    /* step edit overlay: current step tick offset */

const STEP_HOLD_TICKS  = 40;   /* ~200ms at 196Hz: below = tap, at/above = hold */
let stepBtnPressedTick = new Array(16).fill(-1); /* tickCount per button when press is pending; -1 = none */
let lastPlayedNote     = -1;   /* MIDI note of last live pad press; -1 = none yet */
let lastPadVelocity    = 100;  /* velocity of last live pad press, for step input */
let liveActiveNotes    = new Set(); /* pitches currently held via live pad input */
let seqActiveNotes     = new Set(); /* pitches currently playing from sequencer (active track) */
let seqLastStep        = -1;   /* last step index queried for seqActiveNotes */
let seqLastClip        = -1;   /* last clip index queried for seqActiveNotes */
let deleteHeld         = false; /* true while Delete (CC 119) is held */
let muteHeld           = false; /* true while Mute (CC 88) is held */
let copyHeld           = false; /* true while Copy (CC 60) is held */
let copySrc            = null;  /* {kind:'clip',track,clip} | {kind:'row',row} | null */
let lastSoloBlink      = null;  /* last blink state for solo dirty detection */

/* Per-track mute/solo state (JS mirrors DSP) */
let trackMuted         = new Array(NUM_TRACKS).fill(false);
let trackSoloed        = new Array(NUM_TRACKS).fill(false);
let snapshots          = new Array(16).fill(null); /* null=empty, else {mute:[8], solo:[8]} */

/* Global menu state (Phase 5q) */
let globalMenuOpen  = false;
let globalMenuItems = null;
let globalMenuState       = null;
let globalMenuStack       = null;
let bpmWasEditing         = false;
let lastSentMenuEditValue = null;  /* dedup: only send set_param when edit value changes */

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
let stepBoundaryTick = new Array(NUM_TRACKS).fill(-1); /* JS tickCount when step last changed (for tick offset calc) */
let noteOnTick       = new Map();  /* pitch → {tick, cs_r, ac_r, rt}: pending note-offs for gate capture */
let recordBpm        = 120;        /* BPM cached at record arm time */

let currentSetUuid   = '';        /* UUID of the active Move set; polled in tick() for change detection */
let lastDspInstanceId = '';       /* DSP instance_nonce from last poll; change = hot-reload detected */
let pendingSetLoad   = false;     /* true when set changed during init() but same DSP instance: save old, load new */
let pendingDspSync   = 0;         /* ticks remaining before deferred syncClipsFromDsp() after set change */

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

function midiNoteName(n) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[n % 12] + (Math.floor(n / 12) - 1);
}

function effectiveMute(t) {
    const anySolo = trackSoloed.some(function(s) { return s; });
    return trackMuted[t] || (anySolo && !trackSoloed[t]);
}

function setTrackMute(t, on) {
    trackMuted[t] = on;
    if (on && trackSoloed[t]) {
        trackSoloed[t] = false;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_solo', '0');
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_mute', on ? '1' : '0');
    screenDirty = true;
}

function setTrackSolo(t, on) {
    trackSoloed[t] = on;
    if (on && trackMuted[t]) {
        trackMuted[t] = false;
        if (typeof host_module_set_param === 'function')
            host_module_set_param('t' + t + '_mute', '0');
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('t' + t + '_solo', on ? '1' : '0');
    screenDirty = true;
}

function clearAllMuteSolo() {
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        trackMuted[_t]  = false;
        trackSoloed[_t] = false;
    }
    if (typeof host_module_set_param === 'function')
        host_module_set_param('mute_all_clear', '1');
    screenDirty = true;
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
    if (clipNonEmpty[t][ac]) clipNonEmpty[t][ac] = clipHasContent(t, ac);
    refreshSeqNotesIfCurrent(t, ac, absIdx);
}

/* Clear all steps in a clip (single atomic DSP write). */
function clearClip(t, ac) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('t' + t + '_c' + ac + '_clear', '1');
    const len = clipLength[t][ac];
    for (let s = 0; s < len; s++) clipSteps[t][ac][s] = 0;
    clipNonEmpty[t][ac] = false;
    if (ac === trackActiveClip[t]) { seqActiveNotes.clear(); seqLastStep = -1; }
}

/* Copy clip src→dst (single atomic DSP write, JS mirror update). */
function copyClip(srcT, srcC, dstT, dstC) {
    if (srcT === dstT && srcC === dstC) return;
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('clip_copy', `${srcT} ${srcC} ${dstT} ${dstC}`);
    clipSteps[dstT][dstC] = clipSteps[srcT][srcC].slice();
    clipLength[dstT][dstC] = clipLength[srcT][srcC];
    clipNonEmpty[dstT][dstC] = clipNonEmpty[srcT][srcC];
    if (dstC === trackActiveClip[dstT]) { seqActiveNotes.clear(); seqLastStep = -1; }
}

/* Copy all 8 tracks for a scene row (single atomic DSP write, JS mirror update). */
function copyRow(srcRow, dstRow) {
    if (srcRow === dstRow) return;
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('row_copy', `${srcRow} ${dstRow}`);
    for (let t = 0; t < NUM_TRACKS; t++) {
        clipSteps[t][dstRow] = clipSteps[t][srcRow].slice();
        clipLength[t][dstRow] = clipLength[t][srcRow];
        clipNonEmpty[t][dstRow] = clipNonEmpty[t][srcRow];
        if (dstRow === trackActiveClip[t]) { seqActiveNotes.clear(); seqLastStep = -1; }
    }
}

/* Clear all 8 tracks for a scene row (single atomic DSP write, JS mirror update). */
function clearRow(rowIdx) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('row_clear', String(rowIdx));
    for (let t = 0; t < NUM_TRACKS; t++) {
        const len = clipLength[t][rowIdx];
        for (let s = 0; s < len; s++) clipSteps[t][rowIdx][s] = 0;
        clipNonEmpty[t][rowIdx] = false;
        if (rowIdx === trackActiveClip[t]) { seqActiveNotes.clear(); seqLastStep = -1; }
    }
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
    noteOnTick.clear();
    if (typeof host_module_set_param === 'function') {
        host_module_set_param('record_count_in_cancel', '1');
        if (t >= 0) host_module_set_param('t' + t + '_recording', '0');
    }
    setButtonLED(MoveRec, LED_OFF);
}

/* Move recording to a different track while staying armed. No-op if not actively recording. */
function handoffRecordingToTrack(newTrack) {
    if (!recordArmed || recordCountingIn || newTrack === recordArmedTrack) return;
    const old = recordArmedTrack;
    recordCaptureStep    = -1;
    recordCaptureClip    = -1;
    recordCaptureEndTick = -1;
    noteOnTick.clear();
    recordArmedTrack     = newTrack;
    if (typeof host_module_set_param === 'function') {
        if (old >= 0) host_module_set_param('t' + old + '_recording', '0');
        host_module_set_param('t' + newTrack + '_recording', '1');
    }
}

/* Returns the velocity to use for a pad hit: stubInputVel=0 → live, else fixed. */
function effectiveVelocity(rawVel) {
    return stubInputVel > 0 ? stubInputVel : rawVel;
}

/* Capture a note-on during overdub: computes tick_offset, sends _add "pitch offset vel". */
function recordNoteOn(pitch, velocity, rt) {
    if (typeof host_module_set_param !== 'function') return;
    const ac_r = trackActiveClip[rt];
    let cs_r;
    if (recordCaptureStep >= 0 && recordCaptureClip === ac_r) {
        cs_r = recordCaptureStep;
    } else {
        cs_r = trackCurrentStep[rt];
        if (cs_r < 0) return;
        recordCaptureStep    = cs_r;
        recordCaptureClip    = ac_r;
        recordCaptureEndTick = tickCount + RECORD_CAPTURE_TICKS;
    }

    /* Compute tick offset relative to step boundary */
    const boundary = stepBoundaryTick[rt];
    let offset = 0;
    if (boundary >= 0 && recordBpm > 0) {
        offset = Math.round((tickCount - boundary) * recordBpm / 122.5);
        /* Nearest-grid: if note is closer to the NEXT step, assign there with negative offset */
        const clipLen = clipLength[rt][ac_r];
        if (offset > 12 && clipLen > 0) {
            offset -= 24;
            cs_r = (cs_r + 1) % clipLen;
            recordCaptureStep = cs_r; /* update pin to actual step */
        }
        offset = Math.max(-23, Math.min(23, offset));
    }
    if (stubInpQuant) offset = 0;

    host_module_set_param(
        't' + rt + '_c' + ac_r + '_step_' + cs_r + '_add',
        pitch + ' ' + offset + ' ' + velocity);
    clipSteps[rt][ac_r][cs_r] = 1;
    clipNonEmpty[rt][ac_r] = true;
    noteOnTick.set(pitch, { tick: tickCount, cs_r: cs_r, ac_r: ac_r, rt: rt });
}

/* Capture a note-off during overdub: computes gate duration, sends _gate. */
function recordNoteOff(pitch) {
    const entry = noteOnTick.get(pitch);
    if (!entry) return;
    noteOnTick.delete(pitch);
    const { rt, ac_r, cs_r, tick } = entry;
    if (!clipSteps[rt][ac_r][cs_r]) return;
    if (typeof host_module_set_param !== 'function') return;
    const jsTicks = tickCount - tick;
    const gateDsp = Math.max(1, Math.min(6144, Math.round(jsTicks * recordBpm / 122.5)));
    host_module_set_param('t' + rt + '_c' + ac_r + '_step_' + cs_r + '_gate', String(gateDsp));
}

function openGlobalMenu() {
    globalMenuItems       = buildGlobalMenuItems();
    globalMenuState       = createMenuState();
    globalMenuStack       = createMenuStack();
    globalMenuOpen        = true;
    lastSentMenuEditValue = null;
    screenDirty           = true;
    jogTouched            = false;
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

/* When stopped with a clip queued, Track View should operate on the queued clip. */
function effectiveClip(t) {
    const qc = trackQueuedClip[t];
    return (!playing && qc >= 0) ? qc : trackActiveClip[t];
}

function computePadNoteMap() {
    const intervals = SCALE_INTERVALS[padScale] || SCALE_INTERVALS[0];
    const n = intervals.length;
    const root = padOctave[activeTrack] * 12 + padKey;
    for (let i = 0; i < 32; i++) {
        const col = i % 8;
        const row = Math.floor(i / 8);
        const deg = col + row * 3;
        const oct = Math.floor(deg / n);
        const semitone = oct * 12 + intervals[deg % n];
        padNoteMap[i] = Math.max(0, Math.min(127, root + semitone));
    }
}

/* Root note in pad layout closest to octave 4 — guaranteed in-scale and on a pad. */
function defaultStepNote() {
    const target = padKey + 60;  /* root pitch class in MIDI octave 4 */
    let best = -1, bestDist = 999;
    for (let i = 0; i < 32; i++) {
        const p = padNoteMap[i] + trackOctave[activeTrack] * 12;
        if (p < 0 || p > 127) continue;
        if (padNoteMap[i] % 12 !== padKey) continue;  /* root notes only */
        const d = Math.abs(p - target);
        if (d < bestDist) { bestDist = d; best = p; }
    }
    return best >= 0 ? best : Math.max(0, Math.min(127, padNoteMap[0] + trackOctave[activeTrack] * 12));
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
    if (v.length < 52) return;
    playing = (v[0] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const newStep = parseInt(v[1 + t], 10) | 0;
        if (newStep !== trackCurrentStep[t] && newStep >= 0)
            stepBoundaryTick[t] = tickCount - 2; /* bias-correct for poll lag */
        trackCurrentStep[t]      = newStep;
        trackActiveClip[t]       = parseInt(v[9 + t], 10) | 0;
        trackQueuedClip[t]       = parseInt(v[17 + t], 10) | 0;
    }
    const countInDspActive = (v[25] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        trackClipPlaying[t]     = (v[26 + t] === '1');
        trackWillRelaunch[t]    = (v[34 + t] === '1');
        trackPendingPageStop[t] = (v[42 + t] === '1');
    }
    flashEighth    = (v[50] === '1');
    flashSixteenth = (v[51] === '1');

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
    }
    playingPrev = playing;

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

/* Reset NOTE FX, HARMZ, and MIDI DLY banks to DSP defaults for track t.
 * Sends a single tN_pfx_reset command (Schwung only delivers the last
 * set_param per tick — individual per-param sends would be coalesced). */
function resetFxBanks(t) {
    if (typeof host_module_set_param !== 'function') return;
    host_module_set_param('t' + t + '_pfx_reset', '1');
    const targets = [2, 3, 5]; /* NOTE FX, HARMZ, MIDI DLY */
    for (let bi = 0; bi < targets.length; bi++) {
        const b = targets[bi];
        for (let k = 0; k < 8; k++) {
            const pm = BANKS[b].knobs[k];
            if (!pm) continue;
            bankParams[t][b][k] = pm.def;
        }
    }
    screenDirty = true;
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
    const ac = effectiveClip(activeTrack);

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
            if (clipNonEmpty[t][sceneIdx]) return true;
    }
    return false;
}

function sceneNonEmpty(sceneIdx) {
    for (let t = 0; t < NUM_TRACKS; t++)
        if (clipNonEmpty[t][sceneIdx]) return true;
    return false;
}

function sceneAllPlaying(sceneIdx) {
    let hasAny = false;
    if (playing) {
        for (let t = 0; t < NUM_TRACKS; t++) {
            if (!trackClipPlaying[t]) continue;
            if (trackActiveClip[t] !== sceneIdx) return false;
            hasAny = true;
        }
    } else {
        for (let t = 0; t < NUM_TRACKS; t++) {
            if (!trackWillRelaunch[t] && trackQueuedClip[t] < 0) continue;
            if (effectiveClip(t) !== sceneIdx) return false;
            hasAny = true;
        }
    }
    return hasAny;
}

function sceneAnyPlaying(sceneIdx) {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (trackClipPlaying[t] && trackActiveClip[t] === sceneIdx) return true;
    }
    return false;
}

function sceneAllQueued(sceneIdx) {
    let hasAny = false;
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (!clipNonEmpty[t][sceneIdx]) continue;
        hasAny = true;
        const isQueued = (trackQueuedClip[t] === sceneIdx) ||
                         (trackPendingPageStop[t] && trackActiveClip[t] === sceneIdx);
        if (!isQueued) return false;
    }
    return hasAny;
}

function cachedSetLED(note, color) {
    if (lastSentNoteLED[note] === color) return;
    lastSentNoteLED[note] = color;
    setLED(note, color);
}

function cachedSetButtonLED(cc, color) {
    if (lastSentButtonLED[cc] === color) return;
    lastSentButtonLED[cc] = color;
    setButtonLED(cc, color);
}

function invalidateLEDCache() {
    lastSentNoteLED.fill(-1);
    lastSentButtonLED.fill(-1);
}

function updateSceneMapLEDs() {
    if (!ledInitComplete) return;
    for (let i = 0; i < 16; i++) {
        let color;
        if (muteHeld && sessionView) {
            color = snapshots[i] !== null ? VividYellow : DarkGrey;
        } else {
            const inView     = i >= sceneRow && i < sceneRow + 4;
            const anyPlaying = cachedSceneAnyPlaying[i];
            if (inView && anyPlaying) {
                color = flashEighth ? LED_STEP_CURSOR : LED_OFF;
            } else if (inView) {
                color = LED_STEP_CURSOR;
            } else if (anyPlaying) {
                color = flashEighth ? White : LED_OFF;
            } else if (sceneNonEmpty(i)) {
                color = White;
            } else {
                color = LED_OFF;
            }
        }
        setLED(16 + i, color);
    }
}

function updateSessionLEDs() {
    if (!ledInitComplete) return;
    for (let row = 0; row < 4; row++) {
        const sceneIdx = sceneRow + row;
        for (let t = 0; t < 8; t++) {
            const note = 92 - row * 8 + t;
            if (t >= NUM_TRACKS) { setLED(note, LED_OFF); continue; }
            const hasContent    = clipNonEmpty[t][sceneIdx];
            const isActiveClip  = trackActiveClip[t] === sceneIdx;
            const isPlaying     = trackClipPlaying[t] && isActiveClip;
            const isPendingStop = trackPendingPageStop[t] && isActiveClip;
            const isQueued      = trackQueuedClip[t] === sceneIdx;
            const isWillRelaunch = trackWillRelaunch[t] && isActiveClip;
            let color;
            if (!hasContent) {
                color = DarkGrey;
            } else if (isPlaying && isPendingStop) {
                color = (!playing || flashSixteenth) ? TRACK_DIM_COLORS[t] : LED_OFF;
            } else if (isPlaying) {
                color = flashEighth ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isQueued) {
                color = (!playing || flashSixteenth) ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isWillRelaunch) {
                color = TRACK_COLORS[t];
            } else {
                color = TRACK_DIM_COLORS[t];
            }
            /* Copy source blink: JS-side timer (transport-independent) */
            if (copySrc) {
                const isSrcClip = copySrc.kind === 'clip' && copySrc.track === t && copySrc.clip === sceneIdx;
                const isSrcRow  = copySrc.kind === 'row'  && copySrc.row === sceneIdx;
                if (isSrcClip || isSrcRow) color = (Math.floor(tickCount / 24) % 2) ? White : LED_OFF;
            }
            cachedSetLED(note, color);
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
            cachedSetLED(TRACK_PAD_BASE + i, color);
        }
    }

    for (let idx = 0; idx < 4; idx++) {
        const row      = 3 - idx;
        const sceneIdx = sceneRow + row;
        let color;
        if (sessionView) {
            const sincePress = sceneBtnFlashTick[idx] >= 0 ? (tickCount - sceneBtnFlashTick[idx]) : 999;
            color = sincePress < SCENE_BTN_FLASH_TICKS ? White : LED_OFF;
        } else {
            const t         = activeTrack;
            const focused   = effectiveClip(t);
            const isFocused = sceneIdx === focused;
            const isPlaying = trackClipPlaying[t] && trackActiveClip[t] === sceneIdx;
            if (isFocused && isPlaying) {
                color = flashEighth ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isFocused) {
                color = TRACK_COLORS[t];
            } else if (clipNonEmpty[t][sceneIdx]) {
                color = TRACK_DIM_COLORS[t];
            } else {
                color = LED_OFF;
            }
        }
        /* Copy source blink: JS-side timer (transport-independent) */
        if (copySrc) {
            const isSrcRow  = copySrc.kind === 'row'  && copySrc.row === sceneIdx;
            const isSrcClip = copySrc.kind === 'clip' && copySrc.track === activeTrack && copySrc.clip === sceneIdx;
            if (isSrcRow || isSrcClip) color = (Math.floor(tickCount / 24) % 2) ? White : LED_OFF;
        }
        cachedSetButtonLED(40 + idx, color);
    }
}

function forceRedraw() {
    screenDirty = true;
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
    const bandY = Math.floor(sceneRow / 4) * 16;
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
            const color  = (s >= sceneRow && s < sceneRow + 4) ? 1 : 0;
            const hasData    = clipNonEmpty[t][s];
            const isActive   = (s === ac);
            const isPlaying  = (isActive && trackClipPlaying[t]);
            if (isPlaying && hasData) {
                if (blinkOn) fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (isActive && hasData) {
                fill_rect(x + 1, y + 1, 13, 1, color);
            } else if (overviewCache[t][s]) {
                fill_rect(x + 6, y + 1, 2, 1, color);
            }
        }
    }
}

/* Track-number row: muted=inverted, soloed=blink, normal=white.
 * Each track number is 1 char (6px) at x = 4 + t*12. */
function drawTrackRow(y) {
    const soloBlinkOn = Math.floor(tickCount / 24) % 2 === 0;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        const x = 4 + _t * 12;
        if (trackMuted[_t]) {
            fill_rect(x, y - 1, 6, 9, 1);
            print(x, y, String(_t + 1), 0);
        } else if (trackSoloed[_t]) {
            if (soloBlinkOn) print(x, y, String(_t + 1), 1);
        } else {
            print(x, y, String(_t + 1), 1);
        }
    }
}

function drawUI() {
    if (sessionOverlayHeld) { drawSessionOverview(); return; }
    if (globalMenuOpen) { drawGlobalMenu(); return; }
    clear_screen();
    if (sessionView) {
        const base = sceneRow;
        print(4, 10, 'SESSION  GRP ' + (Math.floor(sceneRow / 4) + 1), 1);
        print(4, 22, SCENE_LETTERS[base] + '-' + SCENE_LETTERS[base + 3], 1);
        drawTrackRow(34);
        let line4 = '';
        for (let t = 0; t < NUM_TRACKS; t++) {
            line4 += SCENE_LETTERS[trackActiveClip[t]];
            if (t < NUM_TRACKS - 1) line4 += ' ';
        }
        print(4, 46, line4, 1);
        return;
    }

    /* Track View — priority display state machine */
    const bank      = activeBank;
    const inTimeout = bankSelectTick >= 0 || jogTouched;

    /* Count-in overlay: highest priority while waiting for bar to elapse */
    if (recordArmed && recordCountingIn && !sessionView) {
        const ac_r       = trackActiveClip[recordArmedTrack];
        const totalPages = Math.max(1, Math.ceil(clipLength[recordArmedTrack][ac_r] / 16));
        print(4, 10, 'TR' + (recordArmedTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac_r] +
                     '  PG 1/' + totalPages, 1);
        print(4, 22, 'COUNT-IN', 1);
        print(4, 34, 'REC ARMED', 1);
        drawTrackRow(46);
        return;
    }

    /* Compress-limit override: highest priority for ~1500ms after a blocked compress */
    if (stretchBlockedEndTick >= 0) {
        print(4, 10, '[TIMING     ]', 1);
        print(4, 22, 'Beat Stretch', 1);
        print(4, 34, 'COMPRESS LIMIT', 1);
        return;
    }

    /* Octave overlay: ~1000ms after Up/Down octave shift */
    if (octaveOverlayEndTick >= 0) {
        const ac         = effectiveClip(activeTrack);
        const page       = trackCurrentPage[activeTrack];
        const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
        const oct        = trackOctave[activeTrack];
        print(4, 10, 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] +
                     '  PG ' + (page + 1) + '/' + totalPages, 1);
        print(4, 22, 'KNOB: [' + BANKS[activeBank].name + ']', 1);
        print(4, 34, 'Octave: ' + (oct > 0 ? '+' + oct : String(oct)), 1);
        drawTrackRow(46);
        return;
    }

    /* Step edit: show assigned notes and step identity */
    if (heldStep >= 0) {
        const ac        = effectiveClip(activeTrack);
        const stepLabel = 'S' + (heldStep + 1);
        const header    = 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] + '  ' + stepLabel;
        print(4, 10, header, 1);
        if (heldStepNotes.length > 0) {
            /* Oct+Pit share a merged block; one note value centered under both labels */
            const root = heldStepNotes[0];
            const hiP  = (knobTouched === 0 || knobTouched === 1);
            if (hiP) fill_rect(2, 20, 46, 24, 1);
            print(2,  22, 'Oct', hiP ? 0 : 1);
            print(27, 22, 'Pit', hiP ? 0 : 1);
            const noteLabel = heldStepNotes.length > 1
                ? midiNoteName(root) + ' +' + (heldStepNotes.length - 1)
                : midiNoteName(root);
            print(16, 34, noteLabel, hiP ? 0 : 1);
            /* Dur / Vel / Ndg */
            const RHS_LABELS = ['Dur', 'Vel', 'Ndg'];
            const RHS_VALS   = [
                (stepEditGate / 24).toFixed(2),
                String(stepEditVel),
                (stepEditNudge >= 0 ? '+' : '') + String(stepEditNudge)
            ];
            const RHS_X = [52, 77, 102];
            for (let i = 0; i < 3; i++) {
                const hi = (knobTouched === i + 2);
                if (hi) fill_rect(RHS_X[i], 20, 23, 24, 1);
                print(RHS_X[i], 22, RHS_LABELS[i], hi ? 0 : 1);
                print(RHS_X[i], 34, RHS_VALS[i],   hi ? 0 : 1);
            }
        } else {
            print(4, 22, 'STEP EDIT', 1);
            print(4, 34, '(empty)', 1);
        }
        drawTrackRow(46);
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
        const ac         = effectiveClip(activeTrack);
        const page       = trackCurrentPage[activeTrack];
        const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
        /* \xb7 = middle dot · */
        print(4, 10, 'TR' + (activeTrack + 1) + ' \xb7 ' + SCENE_LETTERS[ac] +
                     '  PG ' + (page + 1) + '/' + totalPages, 1);
        const recTag = (recordArmed && !recordCountingIn && recordArmedTrack === activeTrack)
            ? ' REC' : '';
        print(4, 22, 'KNOB: [' + BANKS[activeBank].name + ']' + recTag, 1);
        if (loopHeld) {
            const steps = clipLength[activeTrack][ac];
            const pages = Math.max(1, Math.ceil(steps / 16));
            print(4, 22, 'LOOP LEN: ' + steps + ' STEPS', 1);
            print(4, 34, pages + ' OF 16 PAGES', 1);
        } else {
            drawTrackRow(34);
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

function uuidToStatePath(uuid) {
    return uuid
        ? '/data/UserData/schwung/set_state/' + uuid + '/seq8-state.json'
        : '/data/UserData/schwung/seq8-state.json';
}

function syncClipsFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    for (let t = 0; t < NUM_TRACKS; t++) {
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined)
                clipLength[t][c] = parseInt(len, 10) || 16;
        }
        const po = host_module_get_param('t' + t + '_pad_octave');
        if (po !== null && po !== undefined) padOctave[t] = parseInt(po, 10) | 0;
        for (let b = 0; b < 8; b++) readBankParams(t, b);
    }
    const kp = host_module_get_param('key');
    if (kp !== null && kp !== undefined) padKey   = parseInt(kp, 10) | 0;
    const sp = host_module_get_param('scale');
    if (sp !== null && sp !== undefined) padScale = parseInt(sp, 10) | 0;
    const lqp = host_module_get_param('launch_quant');
    if (lqp !== null && lqp !== undefined) launchQuant = parseInt(lqp, 10) | 0;
}

function syncMuteSoloFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    const muteStr = host_module_get_param('mute_state');
    const soloStr = host_module_get_param('solo_state');
    if (muteStr) for (let _t = 0; _t < NUM_TRACKS; _t++) trackMuted[_t]  = muteStr[_t]  === '1';
    if (soloStr) for (let _t = 0; _t < NUM_TRACKS; _t++) trackSoloed[_t] = soloStr[_t] === '1';
    for (let _n = 0; _n < 16; _n++) {
        const snap = host_module_get_param('snap_' + _n);
        if (snap && snap.length >= 17) {
            snapshots[_n] = {
                mute: Array.from(snap.substring(0, 8)).map(function(c) { return c === '1'; }),
                solo: Array.from(snap.substring(9, 17)).map(function(c) { return c === '1'; })
            };
        } else {
            snapshots[_n] = null;
        }
    }
    const saRaw = host_module_get_param('scale_aware');
    if (saRaw !== null && saRaw !== undefined) scaleAware = saRaw === '1' ? 1 : 0;
    screenDirty = true;
}

globalThis.init = function () {
    installConsoleOverride('SEQ8');

    const p = (typeof host_module_get_param === 'function')
        ? host_module_get_param('playing') : null;
    const dspSurvived = (p !== null && p !== undefined);

    console.log('SEQ8 init: ' + (p === '1' ? 'RESUMED playing' : 'FRESH/stopped'));

    /* Detect set mismatch: compare active_set.txt UUID with what the DSP currently has loaded.
     * Works regardless of JS context lifetime — no cross-init state needed.
     * If they differ, DSP has old set's data: save it, then load the active set. */
    currentSetUuid = readActiveSetUuid();
    const currentDspNonce = (typeof host_module_get_param === 'function')
        ? host_module_get_param('instance_id') : null;
    const dspUuid = (typeof host_module_get_param === 'function')
        ? (host_module_get_param('state_uuid') || '') : '';
    if (currentDspNonce) lastDspInstanceId = currentDspNonce;
    if (currentSetUuid && dspUuid !== currentSetUuid) {
        pendingSetLoad = true;
    } else if (currentSetUuid && typeof host_file_exists === 'function') {
        const sp = '/data/UserData/schwung/set_state/' + currentSetUuid + '/seq8-state.json';
        if (!host_file_exists(sp)) pendingSetLoad = true;
    }

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
        }

        syncClipsFromDsp();
        syncMuteSoloFromDsp();
    }

    if (!hasInitedOnce) { sessionView = true; hasInitedOnce = true; }

    computePadNoteMap();

    ledInitComplete = false;
    invalidateLEDCache();
    ledInitQueue    = buildLedInitQueue();
    ledInitIndex    = 0;

    installFlagsWrap();
};

globalThis.tick = function () {
    tickCount++;

    /* Set change detected in init(): send UUID so DSP constructs path and loads. */
    if (pendingSetLoad && typeof host_module_set_param === 'function') {
        pendingSetLoad = false;
        disarmRecord();
        heldStep = -1; heldStepBtn = -1; heldStepNotes = []; stepWasEmpty = false;
        seqActiveNotes.clear(); seqLastStep = -1; seqLastClip = -1;
        pendingDspSync = 5;
        host_module_set_param('state_load', currentSetUuid || '');
    }

    /* Poll every 100 ticks (~0.5s): detect DSP hot-reload via instance nonce. */
    if ((tickCount % 100) === 0 && typeof host_module_get_param === 'function' &&
            typeof host_module_set_param === 'function') {
        const newInstanceId = host_module_get_param('instance_id');
        if (newInstanceId && lastDspInstanceId !== '' && newInstanceId !== lastDspInstanceId) {
            pollDSP();
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                trackCurrentPage[_t] = Math.max(0, Math.floor(trackCurrentStep[_t] / 16));
            syncClipsFromDsp();
            syncMuteSoloFromDsp();
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
        if (newInstanceId) lastDspInstanceId = newInstanceId;
    }

    /* Deferred resync after set change: wait ~5 ticks for state_load to land on audio thread. */
    if (pendingDspSync > 0) {
        pendingDspSync--;
        if (pendingDspSync === 0) {
            pollDSP();
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                trackCurrentPage[_t] = Math.max(0, Math.floor(trackCurrentStep[_t] / 16));
            syncClipsFromDsp();
            syncMuteSoloFromDsp();
            computePadNoteMap();
            invalidateLEDCache();
            forceRedraw();
        }
    }

    /* Real-time preview while editing any global menu parameter.
     * Only send set_param when the edit value actually changes — avoids flooding
     * the DSP param queue (which would starve tN_launch_clip / transport commands). */
    if (globalMenuOpen && globalMenuState && globalMenuItems) {
        const item = globalMenuItems[globalMenuState.selectedIndex];
        if (item && globalMenuState.editing && globalMenuState.editValue !== null) {
            if (item.set && globalMenuState.editValue !== lastSentMenuEditValue) {
                item.set(globalMenuState.editValue);
                lastSentMenuEditValue = globalMenuState.editValue;
                screenDirty = true;
            }
            bpmWasEditing = true;
        } else if (bpmWasEditing && !globalMenuState.editing) {
            if (item && item.set && item.get) item.set(item.get());
            bpmWasEditing = false;
            lastSentMenuEditValue = null;
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

    if (!ledInitComplete) {
        drainLedInit();
    } else {
        /* Bank select display timeout: State 3 → State 4 after ~2000ms */
        if (bankSelectTick >= 0 && (tickCount - bankSelectTick) >= BANK_DISPLAY_TICKS) {
            bankSelectTick = -1;
            screenDirty = true;
        }
        /* Overlay expiry: clear timer here so drawUI() can gate on flag alone */
        if (stretchBlockedEndTick >= 0 && tickCount >= stretchBlockedEndTick) {
            stretchBlockedEndTick = -1;
            screenDirty = true;
        }
        if (octaveOverlayEndTick >= 0 && tickCount >= octaveOverlayEndTick) {
            octaveOverlayEndTick = -1;
            screenDirty = true;
        }

        if (masterVolDelta !== 0 && typeof host_get_volume === 'function' && typeof host_set_volume === 'function') {
            host_set_volume(Math.max(0, Math.min(100, host_get_volume() + masterVolDelta)));
            masterVolDelta = 0;
        }

        if ((tickCount % POLL_INTERVAL) === 0) { pollDSP(); screenDirty = true; }

        /* Step hold threshold: once elapsed, close the tap window so release won't toggle */
        if (heldStep >= 0 && heldStepBtn >= 0 && stepBtnPressedTick[heldStepBtn] >= 0 &&
                (tickCount - stepBtnPressedTick[heldStepBtn]) >= STEP_HOLD_TICKS) {
            stepBtnPressedTick[heldStepBtn] = -1;
        }

        /* CC 50 hold detection: crossing threshold enters session overview */
        if (noteSessionPressedTick >= 0 && !sessionOverlayHeld &&
                (tickCount - noteSessionPressedTick) >= NOTE_SESSION_HOLD_TICKS) {
            noteSessionPressedTick = -1;
            sessionOverlayHeld = true;
            invalidateLEDCache();
            screenDirty = true;
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

        /* Refresh scene state cache for O(1) lookups in LED update functions */
        for (let _i = 0; _i < 16; _i++) {
            cachedSceneAllPlaying[_i] = sceneAllPlaying(_i);
            cachedSceneAllQueued[_i]  = sceneAllQueued(_i);
            cachedSceneAnyPlaying[_i] = sceneAnyPlaying(_i);
        }

        /* Transport LEDs */
        setButtonLED(MovePlay, playing ? Green : LED_OFF);
        setButtonLED(MoveRec,  recordArmed ? Red : LED_OFF);
        {
            const _muted      = trackMuted[activeTrack];
            const _soloed     = trackSoloed[activeTrack];
            const _muteBlink  = Math.floor(tickCount / 24) % 2;
            setButtonLED(MoveMute, _muted ? 124 : (_soloed ? (_muteBlink ? 124 : 0) : 16));
        }

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

        /* Session overview blink: mark dirty when animation state toggles */
        if (sessionOverlayHeld) {
            const blinkOn = Math.floor(tickCount / 96) % 2 === 0;
            if (blinkOn !== lastBlinkOn) { lastBlinkOn = blinkOn; screenDirty = true; }
        } else {
            lastBlinkOn = null;
        }

        /* Solo blink: mark dirty when blink toggles and any track is soloed */
        if (trackSoloed.some(function(s) { return s; })) {
            const _sb = Math.floor(tickCount / 24) % 2;
            if (_sb !== lastSoloBlink) { lastSoloBlink = _sb; screenDirty = true; }
        } else {
            lastSoloBlink = null;
        }
    }
    if (screenDirty) { screenDirty = false; drawUI(); }
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
                if (d1 <= 7 && activeBank >= 0) { knobTouched = d1; screenDirty = true; }
                if (d1 === MoveMainTouch && !globalMenuOpen && !shiftHeld) { jogTouched = true; forceRedraw(); }
            } else if (d2 < 64) {
                if (d1 <= 7) {
                    knobTouched = -1;
                    knobLocked[d1] = false;
                    knobAccum[d1]  = 0;
                    screenDirty = true;
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
                screenDirty = true;
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
            screenDirty = true;
            return;
        }
        if (d1 === 3 && d2 === 127 && deleteHeld && !sessionView) {
            resetFxBanks(activeTrack);
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
                        screenDirty = true;
                    }
                } else {
                    handleMenuInput({
                        cc: MoveMainKnob, value: d2,
                        items: globalMenuItems, state: globalMenuState, stack: globalMenuStack,
                        onBack: function() { globalMenuOpen = false; },
                        shiftHeld: shiftHeld
                    });
                    screenDirty = true;
                }
            } else {
                const delta = decodeDelta(d2);
                if (delta !== 0) {
                    if (sessionView) {
                        if (!shiftHeld) {
                            sceneRow = Math.min(NUM_CLIPS - 4, Math.max(0, sceneRow + delta));
                            forceRedraw();
                        }
                        /* Shift + jog in Session View: no-op */
                    } else if (shiftHeld) {
                        /* Track View + Shift: step active track 0–7, clamp at ends */
                        const next = Math.min(NUM_TRACKS - 1, Math.max(0, activeTrack + delta));
                        if (next !== activeTrack) {
                            handoffRecordingToTrack(next);
                            activeTrack = next;
                            computePadNoteMap();
                            seqActiveNotes.clear();
                            seqLastStep = -1;
                            seqLastClip = -1;
                            forceRedraw();
                        }
                    } else {
                        /* Track View: step active bank 0–6, clamp at ends (bank 7 reserved) */
                        const cur  = activeBank;
                        const next = Math.min(6, Math.max(0, cur + delta));
                        if (next !== cur) {
                            activeBank = next;
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

        if (d1 === MoveDelete) {
            deleteHeld = d2 === 127;
        }

        if (d1 === MoveCopy) {
            copyHeld = d2 === 127;
            if (!copyHeld) {
                copySrc = null;
                invalidateLEDCache();
            }
        }

        if (d1 === MoveMute) {
            muteHeld = d2 === 127;
            if (sessionView) invalidateLEDCache();
        }

        /* Note/Session view toggle: Shift+press = open global menu (Track View only);
         * tap = switch view; hold = session overview */
        if (d1 === MoveNoteSession) {
            if (d2 === 127) {
                if (shiftHeld) {
                    if (globalMenuOpen) { globalMenuOpen = false; forceRedraw(); }
                    else { openGlobalMenu(); }
                } else {
                    noteSessionPressedTick = tickCount;
                }
            } else if (d2 === 0) {
                if (sessionOverlayHeld) {
                    sessionOverlayHeld = false;
                    overviewCache = null;
                    invalidateLEDCache();
                    forceRedraw();
                } else if (noteSessionPressedTick >= 0) {
                    /* Tap: toggle view */
                    sessionView = !sessionView;
                    invalidateLEDCache();
                    heldStepBtn        = -1;
                    heldStep           = -1;
                    heldStepNotes      = [];
                    stepWasEmpty       = false;
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
                stepWasEmpty       = false;
                stepBtnPressedTick.fill(-1);
            }
            forceRedraw();
        }

        /* Back: close global menu if open; otherwise (with Shift) hide module */
        if (d1 === MoveBack && d2 === 127) {
            if (globalMenuOpen) {
                globalMenuOpen = false;
                lastSentMenuEditValue = null;
                forceRedraw();
            } else if (shiftHeld) {
                removeFlagsWrap();
                ledInitComplete = false;
                invalidateLEDCache();
                clearAllLEDs();
                for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
                if (typeof host_module_set_param === 'function') host_module_set_param('save', '1');
                if (typeof host_hide_module === 'function') host_hide_module();
            }
        }

        /* Play: toggle transport; Shift+Play = deactivate_all; Delete+Play = panic */
        if (d1 === MovePlay && d2 === 127) {
            if (deleteHeld) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('transport', 'panic');
            } else if (shiftHeld) {
                if (typeof host_module_set_param === 'function') {
                    if (!playing) {
                        /* Stopped: panic clears will_relaunch + all clip state atomically for all tracks. */
                        host_module_set_param('transport', 'panic');
                        for (let t = 0; t < NUM_TRACKS; t++) {
                            trackWillRelaunch[t] = false;
                            trackQueuedClip[t]   = -1;
                        }
                    } else {
                        host_module_set_param('transport', 'deactivate_all');
                    }
                }
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
                recordBpm           = bpm;
                countInStartTick    = tickCount;
                countInQuarterTicks = Math.round(196 * 60 / bpm);
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('record_count_in', String(activeTrack));
                setButtonLED(MoveRec, Red);
            } else {
                /* Playing → arm immediately with no count-in */
                const rawBpmLive = typeof host_module_get_param === 'function'
                    ? parseFloat(host_module_get_param('bpm')) : 120;
                recordArmed      = true;
                recordCountingIn = false;
                recordArmedTrack = activeTrack;
                recordBpm        = (rawBpmLive > 0 && isFinite(rawBpmLive)) ? rawBpmLive : 120;
                setButtonLED(MoveRec, Red);
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + activeTrack + '_recording', '1');
            }
        }

        /* Mute button: Delete+Mute = clear all (both views); toggle mute/solo on active track (Track View only) */
        if (d1 === MoveMute && d2 === 127) {
            if (deleteHeld) {
                clearAllMuteSolo();
            } else if (!sessionView) {
                if (shiftHeld) setTrackSolo(activeTrack, !trackSoloed[activeTrack]);
                else           setTrackMute(activeTrack, !trackMuted[activeTrack]);
            }
        }

        /* Left/Right: page nav in Track View */
        if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !sessionView) {
            const ac         = effectiveClip(activeTrack);
            const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
            if (d1 === MoveLeft)
                trackCurrentPage[activeTrack] = Math.max(0, trackCurrentPage[activeTrack] - 1);
            else
                trackCurrentPage[activeTrack] = Math.min(totalPages - 1, trackCurrentPage[activeTrack] + 1);
            screenDirty = true;
        }

        /* Up/Down: scene group nav in Session View or while overview held; octave shift in Track View */
        if (d1 === MoveDown && d2 === 127 && (sessionView || sessionOverlayHeld) && sceneRow < NUM_CLIPS - 4) { sceneRow = Math.min(NUM_CLIPS - 4, sceneRow + 4); forceRedraw(); }
        if (d1 === MoveUp   && d2 === 127 && (sessionView || sessionOverlayHeld) && sceneRow > 0)              { sceneRow = Math.max(0, sceneRow - 4);              forceRedraw(); }
        if (d1 === MoveUp   && d2 > 0 && !sessionView && !sessionOverlayHeld) {
            trackOctave[activeTrack] = Math.min(4, trackOctave[activeTrack] + 1);
            octaveOverlayEndTick = tickCount + OCTAVE_OVERLAY_TICKS;
            screenDirty = true;
            if (heldStep >= 0) forceRedraw();
        }
        if (d1 === MoveDown && d2 > 0 && !sessionView && !sessionOverlayHeld) {
            trackOctave[activeTrack] = Math.max(-4, trackOctave[activeTrack] - 1);
            octaveOverlayEndTick = tickCount + OCTAVE_OVERLAY_TICKS;
            screenDirty = true;
            if (heldStep >= 0) forceRedraw();
        }

        /* Track buttons CC40-43 */
        if (d1 >= 40 && d1 <= 43 && d2 === 127) {
            const idx     = d1 - 40;
            const clipIdx = sceneRow + (3 - idx);
            if (copyHeld) {
                if (sessionView) {
                    /* Copy: row-to-row gesture */
                    if (!copySrc) {
                        copySrc = { kind: 'row', row: clipIdx };
                        invalidateLEDCache();
                    } else if (copySrc.kind === 'row') {
                        copyRow(copySrc.row, clipIdx);
                        copySrc = null;
                        invalidateLEDCache();
                        forceRedraw();
                    }
                    /* copySrc.kind === 'clip': swallow — don't mix copy types */
                } else {
                    /* Track View: clip-within-track gesture via track button */
                    if (!copySrc) {
                        copySrc = { kind: 'clip', track: activeTrack, clip: clipIdx };
                        invalidateLEDCache();
                    } else if (copySrc.kind === 'clip') {
                        copyClip(copySrc.track, copySrc.clip, activeTrack, clipIdx);
                        copySrc = null;
                        invalidateLEDCache();
                        forceRedraw();
                    }
                }
            } else if (deleteHeld) {
                if (sessionView) {
                    /* Delete + scene row button (Session View): clear all 8 clips in that row */
                    clearRow(clipIdx);
                    forceRedraw();
                } else {
                    /* Delete + track button (Track View): clear the clip at this scene position on active track */
                    clearClip(activeTrack, clipIdx);
                    forceRedraw();
                }
            } else if (sessionView) {
                sceneBtnFlashTick[idx] = tickCount;
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(clipIdx));
            } else {
                const t            = activeTrack;
                const isActiveClip = trackActiveClip[t] === clipIdx;
                if (trackClipPlaying[t] && isActiveClip) {
                    if (trackPendingPageStop[t]) {
                        /* Pending stop → cancel by re-launching legato */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                    } else {
                        /* Playing → arm stop at next page boundary */
                        if (typeof host_module_set_param === 'function')
                            host_module_set_param('t' + t + '_stop_at_end', '1');
                    }
                } else if (trackWillRelaunch[t] && isActiveClip) {
                    /* Transport stopped, clip primed to restart → cancel */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_deactivate', '1');
                } else if (trackQueuedClip[t] === clipIdx) {
                    /* Queued to launch → cancel */
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_deactivate', '1');
                } else {
                    /* Launch: legato if playing, queued if not */
                    if (!playing) {
                        trackActiveClip[t]  = clipIdx;
                        trackCurrentPage[t] = 0;
                    }
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                }
            }
        }

        /* Step edit overlay: K1-K5 intercept per-step params while a step is held and active */
        if (heldStep >= 0 && heldStepNotes.length > 0 && d1 >= 71 && d1 <= 75) {
            const knobIdx = d1 - 71;
            const dir     = (d2 >= 1 && d2 <= 63) ? 1 : -1;
            const t       = activeTrack;
            const ac      = effectiveClip(t);
            const pfx     = 't' + t + '_c' + ac + '_step_' + heldStep;
            screenDirty   = true;
            if (knobIdx === 0) {
                /* K1 Oct: shift all notes ±12 semitones, sens=12 */
                knobAccum[knobIdx] = (dir === knobLastDir[knobIdx]) ? knobAccum[knobIdx] + 1 : 1;
                knobLastDir[knobIdx] = dir;
                if (knobAccum[knobIdx] >= 12) {
                    knobAccum[knobIdx] = 0;
                    heldStepNotes = heldStepNotes.map(function(n) {
                        return Math.max(0, Math.min(127, n + dir * 12));
                    });
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param(pfx + '_set_notes', heldStepNotes.join(' '));
                }
            } else if (knobIdx === 1) {
                /* K2 Pitch: shift each note ±1 scale degree (or ±1 semitone if scale-aware off), sens=6 */
                knobAccum[knobIdx] = (dir === knobLastDir[knobIdx]) ? knobAccum[knobIdx] + 1 : 1;
                knobLastDir[knobIdx] = dir;
                if (knobAccum[knobIdx] >= 6) {
                    knobAccum[knobIdx] = 0;
                    heldStepNotes = heldStepNotes.map(function(n) {
                        return scaleNudgeNote(n, dir, padKey, padScale);
                    });
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param(pfx + '_set_notes', heldStepNotes.join(' '));
                }
            } else if (knobIdx === 2) {
                /* K3 Dur: gate in 6-tick steps (±25% of a step per detent) */
                stepEditGate = Math.max(1, Math.min(6144, stepEditGate + dir * 6));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_gate', String(stepEditGate));
            } else if (knobIdx === 3) {
                /* K4 Vel: velocity 0-127 */
                stepEditVel = Math.max(0, Math.min(127, stepEditVel + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_vel', String(stepEditVel));
            } else {
                /* K5 Nudge: tick offset -23..23 */
                stepEditNudge = Math.max(-23, Math.min(23, stepEditNudge + dir));
                if (typeof host_module_set_param === 'function')
                    host_module_set_param(pfx + '_nudge', String(stepEditNudge));
            }
            return;
        }

        /* Knob CCs 71-78: apply delta to active bank parameter.
         * Relative encoder: d2 1-63 = CW (+1), d2 64-127 = CCW (-1).
         * pm.sens > 1 = accumulate that many ticks before firing one unit change.
         * pm.lock = true: fire once then block until touch release (knobLocked). */
        if (d1 >= 71 && d1 <= 78) {
            const knobIdx = d1 - 71;
            const bank    = activeBank;
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
                    screenDirty = true;
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
            if (muteHeld) {
                /* All 16 step buttons are snapshot slots 0-15 */
                if (shiftHeld) {
                    /* Shift+tap: save/overwrite snapshot */
                    snapshots[idx] = { mute: trackMuted.slice(), solo: trackSoloed.slice() };
                    const mStr = trackMuted.map(function(m) { return m ? '1' : '0'; }).join(' ');
                    const sStr = trackSoloed.map(function(s) { return s ? '1' : '0'; }).join(' ');
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('snap_save', idx + ' ' + mStr + ' ' + sStr);
                } else if (snapshots[idx] !== null) {
                    /* Tap occupied: recall snapshot */
                    const snap = snapshots[idx];
                    for (let _t = 0; _t < NUM_TRACKS; _t++) {
                        trackMuted[_t]  = snap.mute[_t];
                        trackSoloed[_t] = snap.solo[_t];
                    }
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('snap_load', String(idx));
                    screenDirty = true;
                }
                /* Tap empty: no-op; muteHeld swallows all step buttons in Session View */
            } else if (!deleteHeld && !shiftHeld) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(idx));
            }
            /* deleteHeld/shiftHeld (non-muteHeld) in Session View: swallow step buttons */
        } else if (loopHeld) {
            const ac      = effectiveClip(activeTrack);
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
            const ac     = effectiveClip(activeTrack);
            const absIdx = trackCurrentPage[activeTrack] * 16 + idx;
            clearStep(activeTrack, ac, absIdx);
            forceRedraw();
        } else if (!shiftHeld) {
            /* Record press time for tap detection on release.
             * Enter step edit immediately — tap vs hold decided on release. */
            stepBtnPressedTick[idx] = tickCount;
            if (heldStep < 0) {
                const ac_p   = effectiveClip(activeTrack);
                const absP   = trackCurrentPage[activeTrack] * 16 + idx;
                heldStepBtn  = idx;
                heldStep     = absP;
                const pref_p = 't' + activeTrack + '_c' + ac_p + '_step_' + absP;
                const raw_p  = typeof host_module_get_param === 'function'
                    ? host_module_get_param(pref_p + '_notes') : null;
                heldStepNotes = (raw_p && raw_p.trim().length > 0)
                    ? raw_p.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                    : [];
                if (heldStepNotes.length === 0) {
                    /* Empty step: auto-assign on press so knobs work immediately */
                    stepWasEmpty = true;
                    const assignNote = lastPlayedNote >= 0 ? lastPlayedNote : defaultStepNote();
                    const assignVel  = effectiveVelocity(lastPadVelocity);
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + activeTrack + '_c' + ac_p + '_step_' + absP + '_toggle', assignNote + ' ' + assignVel);
                    const raw_aa = typeof host_module_get_param === 'function'
                        ? host_module_get_param(pref_p + '_notes') : null;
                    heldStepNotes = (raw_aa && raw_aa.trim().length > 0)
                        ? raw_aa.trim().split(' ').map(Number).filter(function(n) { return n >= 0 && n <= 127; })
                        : [];
                    clipSteps[activeTrack][ac_p][absP] = heldStepNotes.length > 0 ? 1 : 0;
                    if (heldStepNotes.length > 0) clipNonEmpty[activeTrack][ac_p] = true;
                    stepEditVel = assignVel; stepEditGate = 12; stepEditNudge = 0;
                } else {
                    stepWasEmpty = false;
                    const rv = typeof host_module_get_param === 'function' ? host_module_get_param(pref_p + '_vel') : null;
                    const rg = typeof host_module_get_param === 'function' ? host_module_get_param(pref_p + '_gate') : null;
                    const rn = typeof host_module_get_param === 'function' ? host_module_get_param(pref_p + '_nudge') : null;
                    stepEditVel   = rv !== null ? parseInt(rv, 10) : 100;
                    stepEditGate  = rg !== null ? parseInt(rg, 10) : 12;
                    stepEditNudge = rn !== null ? parseInt(rn, 10) : 0;
                }
                forceRedraw();
            }
        }
    }

    /* Pad presses: note-on */
    if ((status & 0xF0) === 0x90 && d2 > 0) {
        if (sessionView) {
            for (let row = 0; row < 4; row++) {
                const rowBase = 92 - row * 8;
                if (d1 >= rowBase && d1 < rowBase + NUM_TRACKS) {
                    const t = d1 - rowBase;
                    if (muteHeld) {
                        /* Mute-held + pad: toggle mute/solo on that track's column */
                        if (shiftHeld) setTrackSolo(t, !trackSoloed[t]);
                        else           setTrackMute(t, !trackMuted[t]);
                    } else if (copyHeld) {
                        /* Copy + clip pad (Session View): clip-to-clip copy */
                        const clipIdx = sceneRow + row;
                        if (!copySrc) {
                            copySrc = { kind: 'clip', track: t, clip: clipIdx };
                            invalidateLEDCache();
                        } else if (copySrc.kind === 'clip') {
                            copyClip(copySrc.track, copySrc.clip, t, clipIdx);
                            copySrc = null;
                            invalidateLEDCache();
                            forceRedraw();
                        }
                        /* copySrc.kind === 'row': swallow — don't mix copy types */
                    } else if (deleteHeld) {
                        /* Delete + clip pad (Session View): clear that clip */
                        const clipIdx = sceneRow + row;
                        clearClip(t, clipIdx);
                        forceRedraw();
                    } else {
                        const clipIdx      = sceneRow + row;
                        const isActiveClip = trackActiveClip[t] === clipIdx;
                        if (shiftHeld) {
                            /* Shift+pad: focus clip in Track View; launch only if not already active */
                            const isPlaying = trackClipPlaying[t] && isActiveClip;
                            const isWR      = trackWillRelaunch[t] && isActiveClip;
                            const isQueued  = trackQueuedClip[t] === clipIdx;
                            if (!isPlaying && !isWR && !isQueued) {
                                if (!playing) {
                                    trackActiveClip[t]  = clipIdx;
                                    trackCurrentPage[t] = 0;
                                }
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            }
                            handoffRecordingToTrack(t);
                            activeTrack = t;
                            sessionView = false;
                            invalidateLEDCache();
                            forceRedraw();
                        } else if (trackClipPlaying[t] && isActiveClip) {
                            if (trackPendingPageStop[t]) {
                                /* Pending stop → cancel by re-launching */
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_launch_clip', String(clipIdx));
                            } else {
                                /* Playing → arm stop at next page boundary */
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + t + '_stop_at_end', '1');
                            }
                        } else if (trackWillRelaunch[t] && isActiveClip) {
                            /* Transport stopped, clip primed to restart → cancel */
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else if (trackQueuedClip[t] === clipIdx) {
                            /* Queued to launch → cancel */
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + t + '_deactivate', '1');
                        } else {
                            /* Launch clip for this track */
                            handoffRecordingToTrack(t);
                            activeTrack = t;
                            if (!playing) {
                                trackActiveClip[t]  = clipIdx;
                                trackCurrentPage[t] = 0;
                            }
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
                    const ac    = effectiveClip(activeTrack);
                    const pitch = Math.max(0, Math.min(127, padNoteMap[padIdx] + trackOctave[activeTrack] * 12));
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + activeTrack + '_c' + ac + '_step_' + heldStep + '_toggle', pitch + ' ' + effectiveVelocity(d2));
                    /* Read back authoritative note list */
                    const raw = typeof host_module_get_param === 'function'
                        ? host_module_get_param('t' + activeTrack + '_c' + ac + '_step_' + heldStep + '_notes')
                        : null;
                    heldStepNotes = (raw && raw.trim().length > 0)
                        ? raw.trim().split(' ').map(Number).filter(n => n >= 0 && n <= 127)
                        : [];
                    /* Mirror step active state in JS */
                    clipSteps[activeTrack][ac][heldStep] = heldStepNotes.length > 0 ? 1 : 0;
                    if (heldStepNotes.length > 0) {
                        clipNonEmpty[activeTrack][ac] = true;
                    } else if (clipNonEmpty[activeTrack][ac]) {
                        clipNonEmpty[activeTrack][ac] = clipHasContent(activeTrack, ac);
                    }
                    refreshSeqNotesIfCurrent(activeTrack, ac, heldStep);
                    /* Preview note */
                    padPitch[padIdx] = pitch;
                    liveActiveNotes.add(pitch);
                    liveSendNote(activeTrack, 0x90, pitch, effectiveVelocity(d2));
                    forceRedraw();
                } else if (shiftHeld && padIdx >= 24 && padIdx <= 31) {
                    /* Shift + top-row pad (notes 92-99): select bank.
                     * Pad 99 (bankIdx 7) = reserved — ignore. */
                    const bankIdx = padIdx - 24;
                    if (bankIdx < 7) {
                        if (activeBank === bankIdx) {
                            /* Same bank pressed again: return to TRACK bank (0) */
                            activeBank = 0;
                            bankSelectTick = -1;
                        } else {
                            activeBank = bankIdx;
                            readBankParams(activeTrack, bankIdx);
                            bankSelectTick = tickCount;
                        }
                        screenDirty = true;
                    }
                } else if (shiftHeld && padIdx < NUM_TRACKS) {
                    /* Shift + bottom-row pad: select active track */
                    handoffRecordingToTrack(padIdx);
                    activeTrack = padIdx;
                    computePadNoteMap();
                    seqActiveNotes.clear();
                    seqLastStep = -1;
                    seqLastClip = -1;
                    screenDirty = true;
                } else if (!shiftHeld) {
                    /* Live note — apply per-track octave shift, clamp 0-127 */
                    const basePitch = padNoteMap[padIdx];
                    const pitch = Math.max(0, Math.min(127, basePitch + trackOctave[activeTrack] * 12));
                    padPitch[padIdx] = pitch;
                    lastPlayedNote  = pitch;
                    lastPadVelocity = effectiveVelocity(d2);
                    liveActiveNotes.add(pitch);
                    liveSendNote(activeTrack, 0x90, pitch, effectiveVelocity(d2));
                    /* Pre-roll capture: note in last 1/16th of count-in → step 0 */
                    if (recordArmed && recordCountingIn &&
                            activeTrack === recordArmedTrack &&
                            countInQuarterTicks > 0 &&
                            (tickCount - countInStartTick) >= Math.round(countInQuarterTicks * 7 / 2) &&
                            typeof host_module_set_param === 'function') {
                        const rt   = recordArmedTrack;
                        const ac_r = trackActiveClip[rt];
                        host_module_set_param('t' + rt + '_c' + ac_r + '_step_0_add', pitch + ' 0 ' + effectiveVelocity(d2));
                        clipSteps[rt][ac_r][0] = 1;
                        clipNonEmpty[rt][ac_r] = true;
                    }
                    /* Overdub capture: add to current step of armed track with tick offset + velocity */
                    if (recordArmed && !recordCountingIn && activeTrack === recordArmedTrack)
                        recordNoteOn(pitch, effectiveVelocity(d2), recordArmedTrack);
                }
            }
        }
    }

    /* Pad releases: note-off */
    if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
        /* Step button release: tap-toggle if within threshold, always exit step edit */
        if (d1 >= 16 && d1 <= 31) {
            const btn = d1 - 16;
            if (btn === heldStepBtn) {
                if (stepBtnPressedTick[btn] >= 0) {
                    /* Quick release within threshold — commit as tap toggle */
                    const ac_t   = effectiveClip(activeTrack);
                    const absIdx = heldStep;
                    stepBtnPressedTick[btn] = -1;
                    if (stepWasEmpty) {
                        /* Step was empty and auto-assigned on press: step is already on.
                         * Tap confirms the assignment — nothing more to do. */
                    } else {
                        const wasOn = clipSteps[activeTrack][ac_t][absIdx] === 1;
                        if (!wasOn) {
                            if (heldStepNotes.length === 0) {
                                const assignNote2 = lastPlayedNote >= 0 ? lastPlayedNote : defaultStepNote();
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx + '_toggle', assignNote2 + ' ' + effectiveVelocity(lastPadVelocity));
                            } else {
                                if (typeof host_module_set_param === 'function')
                                    host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx, '1');
                            }
                            clipSteps[activeTrack][ac_t][absIdx] = 1;
                            clipNonEmpty[activeTrack][ac_t] = true;
                            refreshSeqNotesIfCurrent(activeTrack, ac_t, absIdx);
                        } else {
                            /* Deactivating: preserve note data */
                            if (typeof host_module_set_param === 'function')
                                host_module_set_param('t' + activeTrack + '_c' + ac_t + '_step_' + absIdx, '0');
                            clipSteps[activeTrack][ac_t][absIdx] = 0;
                            if (clipNonEmpty[activeTrack][ac_t]) clipNonEmpty[activeTrack][ac_t] = clipHasContent(activeTrack, ac_t);
                            refreshSeqNotesIfCurrent(activeTrack, ac_t, absIdx);
                        }
                    }
                }
                /* Always exit step edit on release of the held button */
                heldStepBtn   = -1;
                heldStep      = -1;
                heldStepNotes = [];
                stepWasEmpty  = false;
                forceRedraw();
            }
        }
        if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
            const padIdx = d1 - TRACK_PAD_BASE;
            const pitch = padPitch[padIdx] >= 0 ? padPitch[padIdx] : padNoteMap[padIdx];
            liveActiveNotes.delete(pitch);
            padPitch[padIdx] = -1;
            if (!sessionView) liveSendNote(activeTrack, 0x80, pitch, 0);
            if (recordArmed && !recordCountingIn) recordNoteOff(pitch);
        }
    }
};

globalThis.onMidiMessageExternal = function (data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;
    console.log("MIDI EXT: status=0x" + fmtHex(status) + " data1=" + fmtHex(d1) + " data2=" + fmtHex(d2));
};
