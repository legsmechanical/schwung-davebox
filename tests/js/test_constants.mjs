/* tests/js/test_constants.mjs — behavior pins for the pure helpers in
 * ui_constants.mjs, ahead of the Phase 1 ui_pure.mjs move. */
import { parseActionRaw, col4, col5, fmtNote, fmtArpOct, fmtRoute,
         fmtRes, fmtPct, fmtBool, fmtGateMod, fmtDiq, fmtStretch, fmtLen,
         NOTE_KEYS } from '../../ui/ui_constants.mjs';

let failed = 0;
function eq(got, want, label) {
    if (got !== want) { console.error(`FAIL: ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); failed = 1; }
}

/* parseActionRaw: '1x'/empty -> 0; 'xN' -> pow2 index; '/N' -> negative index */
eq(parseActionRaw('1x', 0), 0, 'parseActionRaw 1x');
eq(parseActionRaw('', 0), 0, 'parseActionRaw empty');
eq(parseActionRaw('x4', 0), 2, 'parseActionRaw x4');
eq(parseActionRaw('/8', 0), -3, 'parseActionRaw /8');
eq(parseActionRaw('x3', 7), 7, 'parseActionRaw non-pow2 falls to def');

/* col4/col5: pad/truncate, null -> "-" */
eq(col4('ab'), 'ab  ', 'col4 pad');
eq(col4('abcdef'), 'abcd', 'col4 truncate');
eq(col4(null), '-   ', 'col4 null');
eq(col5('abc'), 'abc  ', 'col5 pad');

/* fmtNote: wraps mod 12, negative-safe */
eq(fmtNote(13), NOTE_KEYS[1], 'fmtNote 13');
eq(fmtNote(-1), NOTE_KEYS[11], 'fmtNote -1');

/* fmtArpOct sign display; fmtRoute enum */
eq(fmtArpOct(0), 'Off', 'fmtArpOct 0');
eq(fmtArpOct(2), '+2', 'fmtArpOct +');
eq(fmtRoute(1), 'Move', 'fmtRoute move');

/* fmtRes: ['1/32','1/16','1/8','1/4','1/2','1bar'][v] || '1/16' (ui_constants.mjs:95) */
eq(fmtRes(0), '1/32', 'fmtRes 0');
eq(fmtRes(5), '1bar', 'fmtRes 5');
eq(fmtRes(9), '1/16', 'fmtRes out-of-range falls to 1/16');

/* fmtPct: v + '%' (ui_constants.mjs:96) */
eq(fmtPct(50), '50%', 'fmtPct 50');

/* fmtBool: v ? 'ON' : 'OFF' (ui_constants.mjs:100) */
eq(fmtBool(1), 'ON', 'fmtBool 1');
eq(fmtBool(0), 'OFF', 'fmtBool 0');

/* fmtGateMod: GATE_LABELS[v] || 'Off' (ui_constants.mjs:102-103) */
eq(fmtGateMod(0), 'Off', 'fmtGateMod 0');
eq(fmtGateMod(10), '1bar', 'fmtGateMod 10');
eq(fmtGateMod(99), 'Off', 'fmtGateMod out-of-range falls to Off');

/* fmtDiq: fixed label array, index-or-fallback (ui_constants.mjs:112) */
eq(fmtDiq(8), '1/4T', 'fmtDiq 8');
eq(fmtDiq(99), 'Off', 'fmtDiq out-of-range falls to Off');

/* fmtStretch: 0 -> '1x'; >0 -> 'x'+2^exp; <0 -> '/'+2^-exp (ui_constants.mjs:82-86) */
eq(fmtStretch(0), '1x', 'fmtStretch 0');
eq(fmtStretch(3), 'x8', 'fmtStretch +3');
eq(fmtStretch(-2), '/4', 'fmtStretch -2');

/* fmtLen: LEN_LABELS[v|0] || '--' (ui_constants.mjs:90-91) */
eq(fmtLen(5), '2', 'fmtLen 5');
eq(fmtLen(20), '--', 'fmtLen out-of-range falls to --');

if (failed) process.exit(1);
console.log('PASS: ui_constants pure helpers');
