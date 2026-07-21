/* ui_constants.mjs
 * Hardware constants, LED palette, reference data, and stateless utilities.
 * No mutable state. Imported by ui.js.
 * Platform colors imported here for TRACK_COLORS; ui.js imports them separately
 * for direct LED use — ES modules deduplicate across both imports.
 */

import {
    Red, Blue, Green, DarkBlue, Mustard, DeepGreen,
    BrightGreen, BrightPink, RoyalBlue, DarkOlive, DeepWine
} from '/data/UserData/schwung/shared/constants.mjs';

/* ------------------------------------------------------------------ */
/* Hardware CC / note constants                                         */
/* ------------------------------------------------------------------ */

/* CC 50 = Note/Session toggle (three-bar button left of track buttons). */
export const MoveNoteSession     = 50;
export const MoveUndo            = 56;  /* Undo button (CC); Shift+Undo = redo */
export const MoveLoop            = 58;
export const MoveCopy            = 60;  /* Copy modifier button (CC) */
export const MoveMainTouch       = 9;   /* jog wheel capacitive touch */
export const MoveRec             = 86;  /* Record button + LED (CC) */
export const MoveCapture         = 52;  /* Capture button (CC) */
export const MoveSample          = 118; /* Sample button (CC); same hardware CC as MoveRecord */
export const MoveMainButton      = 3;   /* jog wheel click (CC, fires as 0xB0 d1=3) */
export const MoveMainKnob        = 14;  /* jog wheel rotate (CC) */

export const LED_OFF             = 0;
export const LED_STEP_ACTIVE     = 36;
export const LED_STEP_CURSOR     = 127;
export const SCENE_BTN_FLASH_TICKS = 40;
export const LEDS_PER_FRAME      = 8;
export const NUM_TRACKS          = 8;
export const NUM_CLIPS           = 16;
export const DRUM_LANES          = 32;
export const DRUM_BASE_NOTE      = 36;
/* DSP state-format version — mirrors `v=36` in dsp/seq8.c. Bump BOTH together.
 * Snapshots store the version they were saved at; a mismatch marks them
 * incompatible (offered for wipe when the Load list opens). */
export const STATE_VERSION       = 36;

/* shim ui_flags bits that must be masked while SEQ8 owns the display. */
export const FLAG_JUMP_TO_OVERTAKE = 0x04;
export const FLAG_JUMP_TO_TOOLS    = 0x80;
export const SEQ8_NAV_FLAGS        = FLAG_JUMP_TO_OVERTAKE | FLAG_JUMP_TO_TOOLS;

export const NUM_STEPS           = 256;  /* steps per clip (DSP array size) */

/* Track colors: bright and dim pairs (Move uses fixed palette indices). */
export const TRACK_COLORS     = [Red,    Blue,      BrightGreen, Green,
                                 BrightPink, RoyalBlue, Mustard,     DeepGreen];
export const TRACK_DIM_COLORS = [66,     DarkBlue,  DarkOlive,   86,
                                 DeepWine, 96,        70,          86];
export const SCENE_LETTERS    = 'ABCDEFGHIJKLMNOP';

/* Move pad rows (bottom-to-top): 68-75 · 76-83 · 84-91 · 92-99 */
export const TRACK_PAD_BASE   = 68;
export const TOP_PAD_BASE     = 92;   /* top row — Shift+top-row = bank select */

/* Per-clip ticks-per-step values: 1/32 · 1/16 · 1/8 · 1/4 · 1/2 · 1bar */
export const TPS_VALUES = [12, 24, 48, 96, 192, 384];

/* ------------------------------------------------------------------ */
/* Parameter bank format helpers                                        */
/* ------------------------------------------------------------------ */

export const NOTE_KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const SCALE_NAMES = [
    'Major', 'Minor', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian',
    'Locrian', 'Harmonic Minor', 'Melodic Minor',
    'Pentatonic Major', 'Pentatonic Minor', 'Blues', 'Whole Tone', 'Diminished'
];
export const SCALE_DISPLAY = [
    'Major', 'Minor', 'Dori.', 'Phryg', 'Lyd.',  'Mixo',
    'Locr.', 'HMin',  'MMin',  'PMaj',  'PMin',
    'Blues', 'Whole', 'Dim.'
];
export const DELAY_LABELS = ['1/64','1/64d','1/32','1/16t','1/32d','1/16','1/8t','1/16d','1/8','1/4t','1/8d','1/4','1/4d','1/2','1/2d','1/1','1/1d'];

export function fmtSign(v)    { return (v >= 0 ? '+' : '') + v; }
export function fmtStretch(exp) {
    if (exp === 0) return '1x';
    if (exp > 0)   return 'x' + (1 << exp);
    return '/' + (1 << (-exp));
}
/* NOTE FX K5 "Len" — 9-state pre-gate length param. Mode 0 is `--`
 * passthrough; 1..8 are fixed step multiples. Destructive legato lives
 * on CLIP K8 as a separate one-shot action knob (fmtLgto). */
export const LEN_LABELS = ['--', '.25', '.50', '.75', '1', '2', '4', '8', '16'];
export function fmtLen(v) { return LEN_LABELS[(v | 0)] || '--'; }
/* CLIP K8 / DRUM LANE K8 "Lgto" — destructive one-shot action. The value
 * cell shows "->" indicating right-turn opens the confirm dialog. */
export function fmtLgto() { return '->'; }
export function fmtRes(v)    { return ['1/32','1/16','1/8','1/4','1/2','1bar'][v] || '1/16'; }
export function fmtPct(v)    { return v + '%'; }
export function fmtNote(v)   { return NOTE_KEYS[((v | 0) % 12 + 12) % 12]; }
export function fmtPages(v)  { return v + 'pg'; }
export function fmtDly(v)      { return DELAY_LABELS[v] || '---'; }
export function fmtBool(v)     { return v ? 'ON' : 'OFF'; }
export function fmtPitchRnd(v) { return v === 0 ? 'OFF' : String(v); }
const GATE_LABELS = ['Off','1/64','1/32','1/16t','1/16','1/8t','1/8','1/4t','1/4','1/2','1bar'];
export function fmtGateMod(v) { return GATE_LABELS[v] || 'Off'; }
export function fmtRoute(v)  { return v === 2 ? 'Ext' : v === 1 ? 'Move' : 'Swng'; }
export function fmtPlain(v)  { return String(v); }
export function fmtNA()      { return '-'; }
export function fmtArpStyle(v) { return ['Off','Up','Dn','U/D','D/U','Cnv','Div','Ord','Rnd','RnO'][v] || 'Off'; }
export function fmtArpRate(v)  { return ['1/32','1/16','1/16t','1/8','1/8t','1/4','1/4t','1/2','1/2t','1bar'][v] || '1/16'; }
export function fmtArpSteps(v) { return ['Off','Mute','Step'][v] || 'Mute'; }
export function fmtArpOct(v)   { if (v === 0) return 'Off'; return (v > 0 ? '+' : '') + v; }
export function fmtVelOverride(v) { return v === 0 ? 'Live' : String(v); }
export function fmtDiq(v) { return ['Off','1/64','1/32','1/16','1/16t','1/8','1/8t','1/4','1/4t'][v|0] || 'Off'; }
/* Playback direction: 0=Forward, 1=Backward, 2=Pingpong-Forward, 3=Pingpong-Backward. */
export function fmtPlayDir(v) { return ['Fwd','Bwd','PPf','PPb'][v|0] || 'Fwd'; }
/* Reverse-style: 0=Step (current note-on-at-start semantics), 1=Audio
 * (note-on at note's end during reverse motion → "tape reversed" feel). */
export function fmtRevStyle(v) { return v ? 'Audio' : 'Step'; }

/* Fixed 4-char left-aligned column for overview display */
export function col4(s) {
    if (s === null || s === undefined) s = '-';
    s = String(s);
    return s.length >= 4 ? s.slice(0, 4) : s + ' '.repeat(4 - s.length);
}

export function col5(s) {
    if (s === null || s === undefined) s = '-';
    s = String(s);
    return s.length >= 5 ? s.slice(0, 5) : s + ' '.repeat(5 - s.length);
}

export function parseActionRaw(raw, def) {
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
/* mcufont 5×5 pixel font (source: fonts/mcufont.h)                    */
/* Each glyph: 5 rows, bits 4-0 MSB-first. Rendered on 6×6 grid.      */
/* ------------------------------------------------------------------ */
export const MCUFONT = {
    'A':[0b01110,0b10001,0b11111,0b10001,0b10001],
    'B':[0b11110,0b10001,0b11110,0b10001,0b11110],
    'C':[0b01111,0b10000,0b10000,0b10000,0b01111],
    'D':[0b11110,0b10001,0b10001,0b10001,0b11110],
    'E':[0b11111,0b10000,0b11100,0b10000,0b11111],
    'F':[0b11111,0b10000,0b11100,0b10000,0b10000],
    'G':[0b01111,0b10000,0b10011,0b10001,0b01111],
    'H':[0b10001,0b10001,0b11111,0b10001,0b10001],
    'I':[0b11111,0b00100,0b00100,0b00100,0b11111],
    'J':[0b11111,0b00010,0b00010,0b10010,0b01100],
    'K':[0b10010,0b10100,0b11000,0b10100,0b10010],
    'L':[0b10000,0b10000,0b10000,0b10000,0b11111],
    'M':[0b11111,0b10101,0b10101,0b10001,0b10001],
    'N':[0b10001,0b11001,0b10101,0b10011,0b10001],
    'O':[0b01110,0b10001,0b10001,0b10001,0b01110],
    'P':[0b11110,0b10001,0b11110,0b10000,0b10000],
    'Q':[0b01110,0b10001,0b10001,0b10010,0b01101],
    'R':[0b11110,0b10001,0b11110,0b10010,0b10001],
    'S':[0b01111,0b10000,0b01110,0b00001,0b11110],
    'T':[0b11111,0b00100,0b00100,0b00100,0b00100],
    'U':[0b10001,0b10001,0b10001,0b10001,0b01110],
    'V':[0b10001,0b10001,0b01010,0b01010,0b00100],
    'W':[0b10001,0b10001,0b10101,0b10101,0b11011],
    'X':[0b10001,0b01010,0b00100,0b01010,0b10001],
    'Y':[0b10001,0b01010,0b00100,0b00100,0b00100],
    'Z':[0b11111,0b00010,0b00100,0b01000,0b11111],
    'a':[0b00000,0b01111,0b10001,0b10001,0b01111],
    'b':[0b10000,0b11110,0b10001,0b10001,0b11110],
    'c':[0b00000,0b01111,0b10000,0b10000,0b01111],
    'd':[0b00001,0b01111,0b10001,0b10001,0b01111],
    'e':[0b00000,0b01110,0b11111,0b10000,0b01111],
    'f':[0b00000,0b01111,0b10000,0b11110,0b10000],
    'g':[0b00000,0b01110,0b11111,0b00001,0b11110],
    'h':[0b10000,0b10000,0b11110,0b10001,0b10001],
    'i':[0b00100,0b00000,0b01100,0b00100,0b01110],
    'j':[0b00010,0b00000,0b00010,0b10010,0b01100],
    'k':[0b10000,0b10000,0b10110,0b11000,0b10110],
    'l':[0b00000,0b10000,0b10000,0b10000,0b01111],
    'm':[0b00000,0b11110,0b10101,0b10101,0b10001],
    'n':[0b00000,0b11110,0b10001,0b10001,0b10001],
    'o':[0b00000,0b01110,0b10001,0b10001,0b01110],
    'p':[0b00000,0b11110,0b10001,0b11110,0b10000],
    'q':[0b00000,0b01111,0b10001,0b01111,0b00001],
    'r':[0b00000,0b01110,0b10000,0b10000,0b10000],
    's':[0b00000,0b01110,0b11000,0b00110,0b11100],
    't':[0b00000,0b11111,0b00100,0b00100,0b00100],
    'u':[0b00000,0b10001,0b10001,0b10001,0b01110],
    'v':[0b00000,0b10001,0b10001,0b01010,0b00100],
    'w':[0b00000,0b10001,0b10101,0b10101,0b01110],
    'x':[0b00000,0b10010,0b01100,0b01100,0b10010],
    'y':[0b00000,0b10010,0b01110,0b00010,0b01100],
    'z':[0b00000,0b11110,0b00100,0b01000,0b11110],
    '0':[0b01110,0b10001,0b10101,0b10001,0b01110],
    '1':[0b01100,0b10100,0b00100,0b00100,0b11111],
    '2':[0b01110,0b10001,0b00110,0b01000,0b11111],
    '3':[0b11111,0b00001,0b01110,0b00001,0b11110],
    '4':[0b10010,0b10010,0b11111,0b00010,0b00010],
    '5':[0b11111,0b10000,0b01110,0b00001,0b11110],
    '6':[0b01110,0b10000,0b11110,0b10001,0b01110],
    '7':[0b11111,0b00010,0b00100,0b01000,0b01000],
    '8':[0b01110,0b10001,0b01110,0b10001,0b01110],
    '9':[0b11111,0b10001,0b11111,0b00001,0b00001],
    '-':[0b00000,0b00000,0b01110,0b00000,0b00000],
    '+':[0b00000,0b00100,0b01110,0b00100,0b00000],
    '.':[0b00000,0b00000,0b00000,0b00000,0b01000],
    ',':[0b00000,0b00000,0b00000,0b00100,0b01000],
    '?':[0b01110,0b10001,0b00110,0b00000,0b00100],
    '!':[0b00100,0b00100,0b00100,0b00000,0b00100],
    ':':[0b00000,0b01000,0b00000,0b01000,0b00000],
    '=':[0b00000,0b01110,0b00000,0b01110,0b00000],
    "'":[0b00100,0b00100,0b00000,0b00000,0b00000],
    '#':[0b01010,0b11111,0b01010,0b11111,0b01010],
    '/':[0b00001,0b00010,0b00100,0b01000,0b10000],
    '(':[0b00110,0b01000,0b01000,0b01000,0b00110],
    ')':[0b01100,0b00010,0b00010,0b00010,0b01100],
    '<':[0b00010,0b00100,0b01000,0b00100,0b00010],
    '>':[0b01000,0b00100,0b00010,0b00100,0b01000],
};

export function pixelPrint(x, y, text, color) {
    for (let ci = 0; ci < text.length; ci++) {
        const g = MCUFONT[text[ci]];
        if (g) {
            for (let row = 0; row < 5; row++) {
                const bits = g[row];
                for (let col = 0; col < 5; col++) {
                    if (bits & (1 << (4 - col)))
                        set_pixel(x + ci * 6 + col, y + row, color);
                }
            }
        }
    }
}

export function pixelPrintC(cx, y, text, color) {
    pixelPrint(cx - Math.floor((text.length * 6 - 1) / 2), y, text, color);
}

/* ------------------------------------------------------------------ */
/* Bank parameter factory & definitions                                 */
/* ------------------------------------------------------------------ */

function p(abbrev, full, dspKey, scope, min, max, def, fmt, sens, actionSuffix, lock, step) {
    return { abbrev, full, dspKey, scope, min, max, def, fmt,
             sens: sens || 1,
             actionSuffix: actionSuffix || '_pos',
             lock: lock || false,
             step: step || 1 };
}
const _X   = p(null, null, null, 'stub', 0,   0,  0, fmtNA);
const _XQ  = p(null, null, null, 'stub', 0, 100, -1, fmtNA);  /* bank 7 Qnt: def=-1 = unset */
const _XR  = p(null, null, null, 'stub', 0,   0, -1, fmtNA);  /* bank 7 Res/Dir: def=-1 = unset */

export const BANKS = [
    /* 0 — CLIP (pad 92) — K1=Res, K2=Stch (Beat Stretch), K3=Shft (Clock
     * Shift, Shift+turn=Nudge), K4=Lgto (destructive one-shot — opens
     * confirm dialog on right-turn), K5=InQ (custom handling, mirrors drum
     * ALL LANES K5), K6 unassigned, K7=Dir, K8=SqFl. */
    { name: 'CLIP', knobs: [
        p('Res',  'Resolution',      'clip_resolution', 'clip',   0, 5,   1,   fmtRes, 8),
        p('Strch', 'Beat Stretch',    'beat_stretch',    'action', 0, 0,   0,   fmtStretch, 16, '_factor', true),
        p('Shift', 'Clock Shift',     'clock_shift',     'action', 0, 0,   0,   fmtSign,    8),
        p('Lgto', 'Apply Legato',   'lgto_apply',       'action', 0, 0,   0,   fmtLgto,    16, '_factor', true),
        p('InQnt',  'Input Quantize', 'diq',              'track', 0, 8, 0,  fmtDiq, 5),
        _X,
        p('Dir',  'Playback Dir',   'clip_playback_dir', 'clip',  0, 3,   0,   fmtPlayDir, 8),
        p('SeqFl', 'Seq Follow',      null,              'seqfollow', 0, 1, 1,  fmtBool, 16),
    ]},
    /* 1 — NOTE FX (pad 93). Layout (melodic, K-cells 1..8):
     * K1=Oct, K2=Ofs, K3=Vel, K4=Qnt, K5=Len, K6=>Gate, K7=blocked, K8=Rnd.
     * Custom render branch widens K6 to fit ">Gate" (5 chars); K7 stub
     * blocks the generic handler and LED ring. Len is a fixed pre-gate
     * length multiplier (non-destructive). Destructive legato lives on
     * CLIP K8 / DRUM LANE K8. */
    { name: 'NOTE FX', knobs: [
        p('Oct',  'Octave Shift',    'noteFX_octave',      'track', -4,   4,   0,   fmtSign,     8),
        p('Offst',  'Note Offset',     'noteFX_offset',      'track', -24,  24,  0,   fmtSign,     8),
        p('Vel',  'Velocity Offset', 'noteFX_velocity',    'track', -127, 127, 0,   fmtSign        ),
        p('Quant',  'Quantize',        'quantize',           'track',  0,   100, 0,   fmtPct,      1, undefined, undefined, 2),
        p('Len>', 'Note Length',     'noteFX_length_mode', 'track',  0,   8,   0,   fmtLen,      5),
        p('Gate', 'Gate Time',       'noteFX_gate',        'track',  0,   400, 100, fmtPct,      1, undefined, undefined, 2),
        _X,
        p('Rand',  'Pitch Random',    'noteFX_random',      'track',  0,   24,  0,   fmtPitchRnd, 4),
    ]},
    /* 2 — HARMZ (pad 94) */
    { name: 'HARMONY', knobs: [
        p('Oct',  'Octaver',    'harm_octaver',   'track', -4,  4,  0, fmtSign, 8),
        p('Harm1', 'Harmony 1',  'harm_interval1', 'track', -24, 24, 0, fmtSign, 8),
        p('Harm2', 'Harmony 2',  'harm_interval2', 'track', -24, 24, 0, fmtSign, 8),
        p('Harm3', 'Harmony 3',  'harm_interval3', 'track', -24, 24, 0, fmtSign, 8),
        _X, _X, _X, _X,
    ]},
    /* 3 — MIDI DLY (pad 95). K7 = Retrg (delay_retrig); Clock Feedback folded
     * onto Shift+K1 with dynamic label flip "Rate"↔"ClkF". */
    { name: 'DELAY', knobs: [
        p('Rate', 'Delay Time',     'delay_time',         'track', 0,    16, 10, fmtDly,   6),
        p('Level',  'Delay Level',    'delay_level',        'track', 0,    127, 127, fmtPlain),
        p('Repts',  'Repeats',        'delay_repeats',      'track', 0,    16,  0, fmtPlain, 16),
        p('VelFb',  'Vel Feedback',   'delay_vel_fb',       'track', -127, 127, 0, fmtSign ),
        p('PitFb',  'Pitch Feedback', 'delay_pitch_fb',     'track', -24,  24,  0, fmtSign,  16),
        p('Gate', 'Gate',           'delay_gate_fb',      'track', 0,    10,   0, fmtGateMod, 2),
        p('Retrg', 'Retrig',         'delay_retrig',       'track', 0,    1,   1, fmtBool, 4),
        p('Rand',  'Pitch Random',   'delay_pitch_random', 'track', 0,   24,   0, fmtPitchRnd, 4),
    ]},
    /* 4 — ARP OUT (pad 96) */
    { name: 'SEQUENCE ARP', knobs: [
        p('Style', 'Arp Style',    'seq_arp_style',      'track', 0,    9,   0, fmtArpStyle, 8),
        p('Rate', 'Arp Rate',     'seq_arp_rate',       'track', 0,    9,   1, fmtArpRate,  8),
        p('Oct',  'Octave Range', 'seq_arp_octaves',    'track', -4,   4,   0, fmtArpOct,   8),
        p('Gate', 'Arp Gate',     'seq_arp_gate',       'track', 1,    200, 100, fmtPct,     4),
        p('Steps', 'Steps Mode',   'seq_arp_steps_mode', 'track', 1,    2,   1, fmtArpSteps, 8),
        p('Retrg', 'Retrigger',    'seq_arp_retrigger',  'track', 0,    1,   1, fmtBool,     16),
        p('Sync', 'Sync to Clock', 'seq_arp_sync',      'track', 0,    1,   1, fmtBool,     16),
        _X,
    ]},
    /* 5 — ARP IN (pad 97) */
    { name: 'LIVE ARP', knobs: [
        p('Style', 'Arp Style',     'tarp_style',      'track', 0,   9,   0,  fmtArpStyle, 8),
        p('Rate', 'Arp Rate',      'tarp_rate',       'track', 0,   9,   1,  fmtArpRate,  8),
        p('Oct',  'Octave Range',  'tarp_octaves',    'track', -4,  4,   0,  fmtArpOct,   8),
        p('Gate', 'Arp Gate',      'tarp_gate',       'track', 1,   200, 100, fmtPct,      4),
        p('Steps', 'Steps Mode',    'tarp_steps_mode', 'track', 1,   2,   1,  fmtArpSteps, 8),
        p('Retrg', 'Retrigger',    'tarp_retrigger',  'track', 0,   1,   0,  fmtBool,     16),
        p('Sync', 'Sync to Clock', 'tarp_sync',       'track', 0,   1,   1,  fmtBool,     16),
        p('Latch', 'Latch',         'tarp_latch',      'track', 0,   1,   0,  fmtBool,     16),
    ]},
    /* 6 — AUTO (pad 98) — per-clip CC + aftertouch (+ PB later) automation; custom handling, no DSP-wired knobs */
    { name: 'AUTOMATION', knobs: [_X, _X, _X, _X, _X, _X, _X, _X] },
    /* 7 — ALL LANES (drum pad 92) — macro controls across all 32 drum lanes.
     * K1=Res (all-lane resolution, custom), K2=Stch, K3=Shft (alt=Nudge),
     * K4=Qnt (custom), K5=VelIn (custom), K6=InQ (custom),
     * K7=Dir (all-lane playback dir, alt=RvSt, custom), K8=SyncRpt. */
    { name: 'ALL LANES', knobs: [
        _XR,  /* K1: Res — all-lane resolution, custom handling, def=-1 */
        p('Strch', 'Beat Stretch', 'beat_stretch', 'action', 0, 0,  0,  fmtStretch, 16, '_factor', true),
        p('Shift', 'Clock Shift',  'clock_shift',  'action', 0, 0,  0,  fmtSign,    8),
        _XQ,  /* K4: Qnt — quantize all lanes, custom handling, def=-1 */
        _X,   /* K5: VelIn — custom handling via trackVelOverride */
        _X,   /* K6: InQ — per-track drum input quantize, custom handling */
        _XR,  /* K7: Dir — all-lane playback dir, custom handling, def=-1 */
        p('RSync', 'Repeat Sync', 'drum_repeat_sync', 'track', 0, 1, 1, fmtBool, 16),
    ]},
    /* 8 — RESPONDER (conduct) — per-track on/off, custom render+handler (Task 2.3/2.4) */
    { name: 'RESPONDER', knobs: [_X,_X,_X,_X,_X,_X,_X,_X] },
    /* 9 — OCTAVE (conduct) — per-track octave -4..+4, custom render+handler */
    { name: 'OCTAVE',    knobs: [_X,_X,_X,_X,_X,_X,_X,_X] },
    /* 10 — WHEN (conduct) — per-track Next/Now, custom render+handler */
    { name: 'WHEN',      knobs: [_X,_X,_X,_X,_X,_X,_X,_X] },
];

/* Conductor bank indices. Bank 0 (CLIP) is reused as the "Conduct" bank. */
export const BANK_RESPONDER = 8, BANK_OCTAVE = 9, BANK_WHEN = 10;

/* JS tick rate on device (~94 Hz measured). Older constants were calibrated
 * against a mistaken 196 Hz assumption — derive new timings from this. */
export const TICK_HZ = 94;

export const ACTION_POPUP_TICKS = 49; /* ~520ms at 94Hz */
export const POLL_INTERVAL = 4;
export const CC_SCRATCH_PALETTE_BASE = 51;  /* 51-58: per-knob value brightness (knob LEDs) */
export const OOB_SCRATCH_PALETTE     = 50;  /* scratch index for 50%-white OOB step LEDs */
export const BEAT_MARKER_PALETTE     = 49;  /* scratch index for 10%-white beat marker LEDs */
export const CC_GRADIENT_BASE        = 59;  /* 59-61: active-lane step-LED gradient (3 levels) */
export const CC_GRADIENT_LEVELS      = 3;
/* Brightness scalars per gradient level (value 0 = dim floor, 127 = full).
 * The LEDs can't resolve many white brightness steps, so we use just 3
 * widely-separated levels: dim / mid / full. */
export const CC_GRADIENT_SCALARS     = [0.30, 0.60, 1.0];
export const NO_NOTE_FLASH_TICKS = 56;     /* ~600ms at 94Hz (was 118 @196Hz) */
export const TAP_TEMPO_FLASH_TICKS = 9;    /* ~96ms at 94Hz */
export const TAP_TEMPO_RESET_MS    = 2000; /* inactivity reset threshold */
export const PARAM_LED_BANKS = [1, 2, 3, 4, 5];

export const PAD_MODE_DRUM = 1;
export const PAD_MODE_MELODIC_SCALE = 0;
export const PAD_MODE_CONDUCT = 2;

/* Iter knob list: 36 entries, raw byte at each position. Index 0 = default (1/1).
 * Sorted by cycle_len then cycle_idx: 1/1, 1/2, 2/2, 1/3, 2/3, 3/3, ..., 8/8. */
export const STEP_ITER_LIST = (function() {
    const L = [0];
    for (let cl = 2; cl <= 8; cl++)
        for (let ci = 1; ci <= cl; ci++)
            L.push((cl << 4) | ci);
    return L;
})();
