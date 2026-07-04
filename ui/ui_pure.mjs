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
