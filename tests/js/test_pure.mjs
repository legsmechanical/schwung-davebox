/* tests/js/test_pure.mjs — behavior pins for the pure(-read) helpers moved into
 * ui/ui_pure.mjs in Phase 1. Expected values were hand-derived by tracing the
 * pre-move ui.js source (line refs in each block's comment); a transcription
 * error during the move fails a pin.
 *
 * S-reading helpers: the real imported `S` (from ui_state.mjs) is mutated
 * before each call to set up the read surface. ui_state.mjs imports only
 * ui_constants.mjs, so it loads cleanly under node via the tests/js harness. */
import { S } from '../../ui/ui_state.mjs';
import { drumPadToLane, drumPadToVelZone, drumVelZoneToVelocity,
         _clipIsEmpty, clipHasContent } from '../../ui/ui_pure.mjs';
import { PAD_MODE_DRUM } from '../../ui/ui_constants.mjs';

let failed = 0;
function eq(got, want, label) {
    if (got !== want) { console.error(`FAIL: ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); failed = 1; }
}

/* -- drumVelZoneToVelocity(zone) = Math.round((zone+1)*127/16) (ui.js:2309-2311) --
 *   zone 0  -> round(1*127/16=7.9375) = 8   (bottom zone, min vel)
 *   zone 3  -> round(4*127/16=31.75)  = 32
 *   zone 7  -> round(8*127/16=63.5)   = 64  (round-half-up edge)
 *   zone 15 -> round(16*127/16=127)   = 127 (top zone, full vel) */
eq(drumVelZoneToVelocity(0), 8, 'drumVelZoneToVelocity 0');
eq(drumVelZoneToVelocity(3), 32, 'drumVelZoneToVelocity 3');
eq(drumVelZoneToVelocity(7), 64, 'drumVelZoneToVelocity 7 half-up');
eq(drumVelZoneToVelocity(15), 127, 'drumVelZoneToVelocity 15');

/* -- drumPadToVelZone(padIdx): col=pad%8; col<4 -> -1; else row*4+(col-4) (ui.js:2301-2306) --
 *   pad 0  -> col 0 (<4)          = -1 (left half, no vel zone)
 *   pad 4  -> col 4,row 0 -> 0*4+0 = 0
 *   pad 7  -> col 7,row 0 -> 0*4+3 = 3
 *   pad 12 -> col 4,row 1 -> 1*4+0 = 4
 *   pad 31 -> col 7,row 3 -> 3*4+3 = 15 */
eq(drumPadToVelZone(0), -1, 'drumPadToVelZone 0 left');
eq(drumPadToVelZone(4), 0, 'drumPadToVelZone 4');
eq(drumPadToVelZone(7), 3, 'drumPadToVelZone 7');
eq(drumPadToVelZone(12), 4, 'drumPadToVelZone 12');
eq(drumPadToVelZone(31), 15, 'drumPadToVelZone 31');

/* -- drumPadToLane(padIdx): col=pad%8; col>=4 -> -1; else
 *    S.drumLanePage[S.activeTrack]*16 + row*4 + col (ui.js:2249-2254) --
 * Set the S read surface first. */
S.activeTrack = 0;
S.drumLanePage[0] = 0;
/*   pad 4  -> col 4 (>=4)               = -1 (right half, vel zone not lane)
 *   pad 0  -> col 0,row 0 -> 0+0+0       = 0
 *   pad 3  -> col 3,row 0 -> 0+0+3       = 3
 *   pad 8  -> col 0,row 1 -> 0+4+0       = 4
 *   pad 10 -> col 2,row 1 -> 0+4+2       = 6 */
eq(drumPadToLane(4), -1, 'drumPadToLane 4 right');
eq(drumPadToLane(0), 0, 'drumPadToLane 0 page0');
eq(drumPadToLane(3), 3, 'drumPadToLane 3 page0');
eq(drumPadToLane(8), 4, 'drumPadToLane 8 page0 row1');
eq(drumPadToLane(10), 6, 'drumPadToLane 10 page0');
/*   page 1: pad 0 -> 1*16 + 0 + 0 = 16 ; pad 8 -> 16 + 4 = 20 */
S.drumLanePage[0] = 1;
eq(drumPadToLane(0), 16, 'drumPadToLane 0 page1');
eq(drumPadToLane(8), 20, 'drumPadToLane 8 page1 row1');
/*   activeTrack routes the page lookup: track 1 page 0 -> back to base */
S.activeTrack = 1;
S.drumLanePage[1] = 0;
eq(drumPadToLane(0), 0, 'drumPadToLane 0 track1 page0');

/* -- clipHasContent(t,c): true iff any of S.clipSteps[t][c][0..NUM_STEPS-1] is
 *    truthy (ui.js:1998-2002). NUM_STEPS=256, arrays init all-0 -> false. --
 *   all-zero clip           -> false
 *   step 5 set to 1         -> true (found before end)
 *   step 255 (last) set     -> true (loop reaches the final index) */
eq(clipHasContent(0, 0), false, 'clipHasContent all-zero');
S.clipSteps[0][0][5] = 1;
eq(clipHasContent(0, 0), true, 'clipHasContent mid step');
S.clipSteps[2][3][255] = 1;
eq(clipHasContent(2, 3), true, 'clipHasContent last step');

/* -- _clipIsEmpty(t,c) (ui.js:1453-1457): melodic track -> !S.clipNonEmpty[t][c];
 *    drum track (trackPadMode==PAD_MODE_DRUM) -> !S.drumClipNonEmpty[t][c]. --
 * Melodic branch (trackPadMode default 0): */
S.trackPadMode[0] = 0;
S.clipNonEmpty[0][0] = false;
eq(_clipIsEmpty(0, 0), true, '_clipIsEmpty melodic empty');
S.clipNonEmpty[0][0] = true;
eq(_clipIsEmpty(0, 0), false, '_clipIsEmpty melodic non-empty');
/* Drum branch selects the OTHER array (drumClipNonEmpty), ignoring clipNonEmpty: */
S.trackPadMode[1] = PAD_MODE_DRUM;
S.drumClipNonEmpty[1][2] = false;
S.clipNonEmpty[1][2] = true;               /* proves the drum branch ignores this */
eq(_clipIsEmpty(1, 2), true, '_clipIsEmpty drum empty (ignores clipNonEmpty)');
S.drumClipNonEmpty[1][2] = true;
eq(_clipIsEmpty(1, 2), false, '_clipIsEmpty drum non-empty');

if (failed) process.exit(1);
console.log('PASS: ui_pure drum + clip helpers');
