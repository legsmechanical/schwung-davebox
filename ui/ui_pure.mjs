/* ui_pure.mjs
 * Pure(-read) helpers extracted from ui.js (Phase 1 of the modularity refactor).
 *
 * PURITY CONTRACT (enforced by review + tests/js/test_pure.mjs):
 *   - These helpers may READ shared state `S` and module constants, but must
 *     NEVER write `S` (no `S.x = ...`, no mutation of S-owned arrays/sets) and
 *     NEVER call host APIs (`host_*`, `setLED`, `move_midi_*`, `shadow_*`).
 *   - Because they touch nothing host-side, the node-based tests/js harness can
 *     import this module directly (via ui_state.mjs, which imports only
 *     ui_constants.mjs).
 * Helpers that write S or call host APIs stay in ui.js until later phases.
 */

import { S } from './ui_state.mjs';
import { PAD_MODE_DRUM, NUM_STEPS } from './ui_constants.mjs';

/* Live pad note input — isomorphic 4ths diatonic layout. */
export const SCALE_INTERVALS = [
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

const BANK_CYCLE_DRUM = [7, 0, 1, 3, 5, 6];

/* Bank position in the jog-cycle order, for the header position strip. Melodic
 * banks cycle 0..6 linearly; drum banks cycle in BANK_CYCLE_DRUM order. Returns
 * {idx, count} for the active track's chain — mirrors the jog nav in _onCC_jog. */
export function bankCyclePos() {
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const i = BANK_CYCLE_DRUM.indexOf(S.activeBank);
        return { idx: i < 0 ? 0 : i, count: BANK_CYCLE_DRUM.length };
    }
    return { idx: Math.max(0, Math.min(6, S.activeBank)), count: 7 };
}

/* Step-edit pitch nudge: move note up/down to next in-scale pitch.
 * When scale-aware is off, shifts by exactly 1 semitone per dir. */
export function scaleNudgeNote(note, dir, key, scale) {
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

export function _clipIsEmpty(t, c) {
    return (S.trackPadMode[t] === PAD_MODE_DRUM)
        ? !S.drumClipNonEmpty[t][c]
        : !S.clipNonEmpty[t][c];
}

export function clipHasContent(t, c) {
    const s = S.clipSteps[t][c];
    for (let i = 0; i < NUM_STEPS; i++) if (s[i]) return true;
    return false;
}

/** Convert a padIdx (0-31) to drum lane index for the current lane page, or -1 if right half. */
export function drumPadToLane(padIdx) {
    const col = padIdx % 8;
    if (col >= 4) return -1;
    const row = Math.floor(padIdx / 8);
    return S.drumLanePage[S.activeTrack] * 16 + row * 4 + col;
}

/** Convert a padIdx (0-31) to velocity zone 0-15, or -1 if left half. */
export function drumPadToVelZone(padIdx) {
    const col = padIdx % 8;
    if (col < 4) return -1;
    const row = Math.floor(padIdx / 8);
    return row * 4 + (col - 4);
}

/** Map velocity zone 0-15 to a MIDI velocity (8…127). */
export function drumVelZoneToVelocity(zone) {
    return Math.round((zone + 1) * 127 / 16);
}
