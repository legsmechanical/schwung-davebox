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
const MoveMainTouch   = 9;   /* jog wheel capacitive touch — note, no LED */

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
    isNoiseMessage
} from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    installConsoleOverride
} from '/data/UserData/schwung/shared/logger.mjs';

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
const DELAY_LABELS = ['---','1/64','1/32','16T','1/16','8T','1/8','4T','1/4','1/2','1/1'];

function fmtSign(v)  { return (v >= 0 ? '+' : '') + v; }
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

/* ------------------------------------------------------------------ */
/* Parameter bank definitions                                           */
/* ------------------------------------------------------------------ */

/* p(abbrev, fullName, dspKey, scope, min, max, defaultVal, fmtFn)
 * scope: 'global' = key sent as-is; 'track' = prefixed tN_;
 *        'clip' = JS clipLength state; 'stub' = JS-only, no DSP call */
function p(abbrev, full, dspKey, scope, min, max, def, fmt) {
    return { abbrev, full, dspKey, scope, min, max, def, fmt };
}
const _X = p(null, null, null, 'stub', 0, 0, 0, fmtNA);

const BANKS = [
    /* 0 — NOTE (pad 92) */
    { name: 'NOTE', knobs: [
        p('Root', 'Root Note',       'key',             'global', 0,    11,  9,   fmtNote ),
        p('Oct',  'Octave',          'pad_octave',       'track',  0,    8,   3,   fmtPlain),
        p('Gate', 'Gate Time',       'noteFX_gate',      'track',  0,    200, 100, fmtPct  ),
        p('Vel',  'Velocity Offset', 'noteFX_velocity',  'track',  -127, 127, 0,   fmtSign ),
        p('Res',  'Resolution',       null,              'stub',   0,    0,   0,   fmtNA   ), /* NOT IN DSP */
        p('Len',  'Clip Length',      null,              'clip',   1,    16,  1,   fmtPages),
        _X, _X,
    ]},
    /* 1 — TIMING (pad 93) — stub: Beat Stretch, Clock Shift, Swing not in DSP */
    { name: 'TIMING', knobs: [
        p('Stch', 'Beat Stretch',  null, 'stub', 0, 0, 0, fmtNA),
        p('Shft', 'Clock Shift',   null, 'stub', 0, 0, 0, fmtNA),
        p('SwAm', 'Swing Amount',  null, 'stub', 0, 0, 0, fmtNA),
        p('SwRs', 'Swing Res',     null, 'stub', 0, 0, 0, fmtNA),
        _X, _X, _X, _X,
    ]},
    /* 2 — NOTE FX (pad 94) — fully wired */
    { name: 'NOTE FX', knobs: [
        p('Oct',  'Octave Shift',    'noteFX_octave',   'track', -4,   4,   0,   fmtSign),
        p('Ofs',  'Note Offset',     'noteFX_offset',   'track', -24,  24,  0,   fmtSign),
        p('Gate', 'Gate Time',       'noteFX_gate',     'track',  0,   200, 100, fmtPct ),
        p('Vel',  'Velocity Offset', 'noteFX_velocity', 'track', -127, 127, 0,   fmtSign),
        _X, _X, _X, _X,
    ]},
    /* 3 — HARMZ (pad 95) — fully wired */
    { name: 'HARMZ', knobs: [
        p('Unis', 'Unison',     'harm_unison',    'track', 0,   2,  0, fmtUnis),
        p('Oct',  'Octaver',    'harm_octaver',   'track', -4,  4,  0, fmtSign),
        p('Hrm1', 'Harmony 1',  'harm_interval1', 'track', -24, 24, 0, fmtSign),
        p('Hrm2', 'Harmony 2',  'harm_interval2', 'track', -24, 24, 0, fmtSign),
        _X, _X, _X, _X,
    ]},
    /* 4 — SEQ ARP (pad 96) — stub: arpeggiator not in DSP */
    { name: 'SEQ ARP', knobs: [
        p('On',   'Arp On/Off',  null, 'stub', 0, 0, 0, fmtNA),
        p('Type', 'Arp Type',    null, 'stub', 0, 0, 0, fmtNA),
        p('Sort', 'Note Sort',   null, 'stub', 0, 0, 0, fmtNA),
        p('Hold', 'Hold',        null, 'stub', 0, 0, 0, fmtNA),
        p('OctR', 'Octave Range',null, 'stub', 0, 0, 0, fmtNA),
        p('Spd',  'Speed',       null, 'stub', 0, 0, 0, fmtNA),
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
    /* 6 — MIDI (pad 98) */
    { name: 'MIDI', knobs: [
        p('Ch',   'MIDI Channel', null,        'stub',  1, 16, 1, fmtPlain), /* tN_channel NOT IN DSP — stub */
        p('Rte',  'Route',        'route',     'track', 0, 1,  0, fmtRoute),
        p('Mode', 'Track Mode',   'pad_mode',  'track', 0, 0,  0, fmtPlain),
        _X, _X, _X, _X, _X,
    ]},
    /* 7 — LIVE ARP (pad 99) — stub: live arpeggiator not in DSP */
    { name: 'LIVE ARP', knobs: [
        p('On',   'Arp On/Off',  null, 'stub', 0, 0, 0, fmtNA),
        p('Type', 'Arp Type',    null, 'stub', 0, 0, 0, fmtNA),
        p('Sort', 'Note Sort',   null, 'stub', 0, 0, 0, fmtNA),
        p('Hold', 'Hold',        null, 'stub', 0, 0, 0, fmtNA),
        p('OctR', 'Octave Range',null, 'stub', 0, 0, 0, fmtNA),
        p('Spd',  'Speed',       null, 'stub', 0, 0, 0, fmtNA),
        _X, _X,
    ]},
];

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

/* activeBank[track]: index 0-7 (pad 92-99), or -1 = none selected.
 * Each track remembers its own bank independently. */
let activeBank     = new Array(NUM_TRACKS).fill(-1);

/* knobTouched: 0-7 (MoveKnob1Touch-8Touch note numbers), or -1 = none */
let knobTouched    = -1;
let jogTouched     = false;

/* bankSelectTick: tickCount at last bank select, used for 2-second State 3 timeout.
 * -1 = timeout not active. */
let bankSelectTick = -1;
const BANK_DISPLAY_TICKS = 392;  /* ~2000ms at 196Hz tick rate */

/* bankParams[track][bankIdx][knobIdx] = integer value (JS-authoritative).
 * Initialized from BANKS defaults; refreshed from DSP on bank select. */
let bankParams = Array.from({length: NUM_TRACKS}, () =>
    BANKS.map(bank => bank.knobs.map(k => k.def)));

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

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
    if (v.length < 25) return;
    playing = (v[0] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        trackCurrentStep[t] = parseInt(v[1 + t], 10) | 0;
        trackActiveClip[t]  = parseInt(v[9 + t], 10) | 0;
        trackQueuedClip[t]  = parseInt(v[17 + t], 10) | 0;
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
    } else if (pm.scope === 'clip') {
        const ac    = trackActiveClip[t];
        const steps = val * 16;
        clipLength[t][ac] = steps;
        host_module_set_param('t' + t + '_c' + ac + '_length', String(steps));
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
    for (let i = 0; i < 16; i++) {
        const absStep = base + i;
        let color;
        if (playing && absStep === cs) {
            color = LED_STEP_CURSOR;
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
            const isActive   = trackActiveClip[t] === sceneIdx;
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
            setLED(TRACK_PAD_BASE + i,
                   padNoteMap[i] % 12 === padKey ? rootColor : DarkGrey);
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
            const isActive   = trackActiveClip[t] === sceneIdx;
            const isPlaying  = isActive && playing && hasContent;
            const isQueued   = hasContent && trackQueuedClip[t] === sceneIdx;
            if (isPlaying || isQueued) {
                color = pulseUseBright ? TRACK_COLORS[t] : TRACK_DIM_COLORS[t];
            } else if (isActive && hasContent) {
                color = TRACK_COLORS[t];
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

function drawUI() {
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
    const inTimeout = bankSelectTick >= 0;

    if (bank >= 0 && knobTouched >= 0) {
        /* State 1: knob touched — single parameter */
        const pm  = BANKS[bank].knobs[knobTouched];
        const val = bankParams[activeTrack][bank][knobTouched];
        print(4, 10, bankHeader(bank), 1);
        print(4, 22, pm.full || '-', 1);
        print(4, 34, pm.fmt(val), 1);
        /* line 4 blank */

    } else if (bank >= 0 && (jogTouched || inTimeout)) {
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
    }

    computePadNoteMap();

    ledInitComplete = false;
    ledInitQueue    = buildLedInitQueue();
    ledInitIndex    = 0;

    installFlagsWrap();
};

globalThis.tick = function () {
    tickCount++;

    pulseStep = (pulseStep + 1) % PULSE_PERIOD;
    const phase = Math.floor(pulseStep * 4 / PULSE_PERIOD);
    pulseUseBright = (phase === 1 || phase === 2);

    if (!ledInitComplete) {
        drainLedInit();
    } else {
        /* Bank select display timeout: State 3 → State 4 after ~2000ms */
        if (bankSelectTick >= 0 && (tickCount - bankSelectTick) >= BANK_DISPLAY_TICKS)
            bankSelectTick = -1;

        if ((tickCount % POLL_INTERVAL) === 0) pollDSP();
        if (sessionView) {
            updateSessionLEDs();
            updateSceneMapLEDs();
        } else {
            updateStepLEDs();
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

    /* Knob touch (notes 0-7) and jog wheel touch (note 9).
     * MoveKnob1-8Touch = notes 0-7; MoveMainTouch = note 9.
     * Hardware: d2=127 = touch on; d2 in 0-63 (via 0x90 or 0x80) = touch off. */
    if (d1 >= 0 && d1 <= 9) {
        if ((status & 0xF0) === 0x90) {
            if (d2 === 127) {
                if (d1 <= 7 && activeBank[activeTrack] >= 0) knobTouched = d1;
                if (d1 === MoveMainTouch && activeBank[activeTrack] >= 0) jogTouched = true;
            } else if (d2 < 64) {
                if (d1 <= 7) knobTouched = -1;
                if (d1 === MoveMainTouch) jogTouched = false;
            }
            return;
        }
        if ((status & 0xF0) === 0x80) {
            if (d1 <= 7) knobTouched = -1;
            if (d1 === MoveMainTouch) jogTouched = false;
            return;
        }
    }

    if (status === 0xB0) {
        if (d1 === MoveShift) {
            shiftHeld = d2 === 127;
        }

        /* Note/Session view toggle */
        if (d1 === MoveNoteSession && d2 === 127) {
            sessionView = !sessionView;
            if (sessionView) {
                for (let i = 0; i < 16; i++) setLED(16 + i, LED_OFF);
                for (let t = 0; t < 8; t++) setLED(TRACK_PAD_BASE + t, LED_OFF);
            } else {
                for (let row = 0; row < 4; row++)
                    for (let t = 0; t < 8; t++) setLED(92 - row * 8 + t, LED_OFF);
            }
            forceRedraw();
        }

        /* Loop button (CC 58): hold + step buttons sets clip length */
        if (d1 === MoveLoop && !sessionView) {
            loopHeld = d2 === 127;
            forceRedraw();
        }

        /* Shift+Back = hide */
        if (d1 === MoveBack && d2 === 127 && shiftHeld) {
            removeFlagsWrap();
            ledInitComplete = false;
            clearAllLEDs();
            for (let _i = 0; _i < 4; _i++) setButtonLED(40 + _i, LED_OFF);
            if (typeof host_hide_module === 'function') host_hide_module();
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

        /* Left/Right: page nav in Track View */
        if ((d1 === MoveLeft || d1 === MoveRight) && d2 === 127 && !sessionView) {
            const ac         = trackActiveClip[activeTrack];
            const totalPages = Math.max(1, Math.ceil(clipLength[activeTrack][ac] / 16));
            if (d1 === MoveLeft)
                trackCurrentPage[activeTrack] = Math.max(0, trackCurrentPage[activeTrack] - 1);
            else
                trackCurrentPage[activeTrack] = Math.min(totalPages - 1, trackCurrentPage[activeTrack] + 1);
        }

        /* Up/Down: scene group nav in Session View */
        if (d1 === MoveDown && d2 === 127 && sessionView && sceneGroup < 3) { sceneGroup++; forceRedraw(); }
        if (d1 === MoveUp   && d2 === 127 && sessionView && sceneGroup > 0) { sceneGroup--; forceRedraw(); }

        /* Track buttons CC40-43 */
        if (d1 >= 40 && d1 <= 43 && d2 === 127) {
            const idx = d1 - 40;
            if (sessionView) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(sceneGroup * 4 + (3 - idx)));
            } else {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + activeTrack + '_launch_clip',
                                          String(sceneGroup * 4 + (3 - idx)));
            }
        }

        /* Knob CCs 71-78: apply delta to active bank parameter.
         * Relative encoder: d2 1-63 = CW (+1), d2 64-127 = CCW (-1).
         * TODO: add acceleration for wide-range params (e.g. gate_time 0-200). */
        if (d1 >= 71 && d1 <= 78) {
            const knobIdx = d1 - 71;
            const bank    = activeBank[activeTrack];
            if (bank >= 0) {
                const pm = BANKS[bank].knobs[knobIdx];
                if (pm && pm.abbrev && pm.scope !== 'stub') {
                    const delta = (d2 >= 1 && d2 <= 63) ? 1 : -1;
                    const cur   = bankParams[activeTrack][bank][knobIdx];
                    const nv    = Math.max(pm.min, Math.min(pm.max, cur + delta));
                    if (nv !== cur) {
                        bankParams[activeTrack][bank][knobIdx] = nv;
                        applyBankParam(activeTrack, bank, knobIdx, nv);
                    }
                }
            }
        }
    }

    /* Step buttons: notes 16-31, note-on only */
    if ((status & 0xF0) === 0x90 && d1 >= 16 && d1 <= 31 && d2 > 0) {
        const idx = d1 - 16;
        if (sessionView) {
            const targetGroup = Math.floor(idx / 4);
            if (shiftHeld) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('launch_scene', String(idx));
            } else {
                sceneGroup = targetGroup;
            }
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
        } else {
            const ac     = trackActiveClip[activeTrack];
            const absIdx = trackCurrentPage[activeTrack] * 16 + idx;
            clipSteps[activeTrack][ac][absIdx] ^= 1;
            if (typeof host_module_set_param === 'function')
                host_module_set_param(
                    't' + activeTrack + '_c' + ac + '_step_' + absIdx,
                    clipSteps[activeTrack][ac][absIdx] ? '1' : '0'
                );
        }
    }

    /* Pad presses: note-on */
    if ((status & 0xF0) === 0x90 && d2 > 0) {
        if (sessionView) {
            for (let row = 0; row < 4; row++) {
                const rowBase = 92 - row * 8;
                if (d1 >= rowBase && d1 < rowBase + NUM_TRACKS) {
                    const t = d1 - rowBase;
                    activeTrack = t;
                    if (typeof host_module_set_param === 'function')
                        host_module_set_param('t' + t + '_launch_clip',
                                              String(sceneGroup * 4 + row));
                    break;
                }
            }
        } else {
            if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
                const padIdx = d1 - TRACK_PAD_BASE;

                if (shiftHeld && padIdx >= 24 && padIdx <= 31) {
                    /* Shift + top-row pad (notes 92-99): select parameter bank */
                    const bankIdx = padIdx - 24;  /* 0-7 maps to BANKS[0..7] */
                    if (activeBank[activeTrack] === bankIdx) {
                        /* Same bank pressed again: deselect */
                        activeBank[activeTrack] = -1;
                        bankSelectTick = -1;
                    } else {
                        activeBank[activeTrack] = bankIdx;
                        readBankParams(activeTrack, bankIdx);
                        bankSelectTick = tickCount;  /* trigger State 3 timeout */
                    }
                } else if (shiftHeld && padIdx < NUM_TRACKS) {
                    /* Shift + bottom-row pad: select active track */
                    activeTrack = padIdx;
                    computePadNoteMap();
                } else if (!shiftHeld) {
                    /* Live note */
                    const pitch = padNoteMap[padIdx];
                    padPitch[padIdx] = pitch;
                    if (typeof shadow_send_midi_to_dsp === 'function')
                        shadow_send_midi_to_dsp([0x90 | activeTrack, pitch, Math.max(80, d2)]);
                }
            }
        }
    }

    /* Pad releases: note-off */
    if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
        if (d1 >= TRACK_PAD_BASE && d1 < TRACK_PAD_BASE + 32) {
            const padIdx = d1 - TRACK_PAD_BASE;
            const pitch = padPitch[padIdx] >= 0 ? padPitch[padIdx] : padNoteMap[padIdx];
            padPitch[padIdx] = -1;
            if (!sessionView && typeof shadow_send_midi_to_dsp === 'function')
                shadow_send_midi_to_dsp([0x80 | activeTrack, pitch, 0]);
        }
    }
};

globalThis.onMidiMessageExternal = function (data) {
    const status = data[0] | 0;
    const d1     = (data[1] ?? 0) | 0;
    const d2     = (data[2] ?? 0) | 0;
    console.log("MIDI EXT: status=0x" + fmtHex(status) + " data1=" + fmtHex(d1) + " data2=" + fmtHex(d2));
};
