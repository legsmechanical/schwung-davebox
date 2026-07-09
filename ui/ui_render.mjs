/* ui_render.mjs
 * All OLED drawing: bank-header chrome, step-edit formatters, session
 * overview grid, Performance Mode screen, and the top-level drawUI dispatch
 * (the main per-tick render entry, including the drum position bar). Pure
 * S-state -> pixel-API translation; no input handling.
 * Extracted from ui.js (Phase 5 of the modularity refactor, module 5, final).
 */

import { S, PERF_FACTORY_PRESETS } from './ui_state.mjs';
import {
    BANKS, BANK_RESPONDER, BANK_OCTAVE, BANK_WHEN,
    NOTE_KEYS, NUM_CLIPS, NUM_TRACKS, PAD_MODE_CONDUCT, PAD_MODE_DRUM,
    POLL_INTERVAL, SCALE_DISPLAY, SCENE_LETTERS, TPS_VALUES,
    col4, col5, pixelPrint,
    fmtSign, fmtStretch, fmtLen, fmtRes, fmtPct, fmtBool, fmtGateMod,
    fmtArpRate, fmtVelOverride, fmtPlayDir, fmtRevStyle
} from './ui_constants.mjs';
import {
    drawGlobalMenu, drawStateWipeConfirm, drawRecordBlockedDialog, drawBpmMoveInfo,
    drawLgtoConfirm, drawBakeConfirm, drawInheritPicker, drawSnapshotPicker,
    drawClearAutoMenu, drawBakeSceneConfirm, drawXposeConfirm
} from './ui_dialogs.mjs';
import { ensureGlobalMenuFresh } from './ui_menu.mjs';
import { bankCyclePos } from './ui_pure.mjs';
import { syncDrumRepeatState } from './ui_drummodel.mjs';
import {
    effectiveClip, drawPositionBar, paintCoRunSideButtons,
    bankHasAltParams, altIndicatorActive
} from './ui_leds.mjs';
import { SPLASH_FRAMES, SPLASH_COUNT, SPLASH_W, SPLASH_H, pickSplashIdx } from './ui_splash.mjs';

/* ------------------------------------------------------------------ */
/* Parameter bank definitions                                           */
/* ------------------------------------------------------------------ */

/* Compact "you are here in the bank chain" strip, right-aligned on the header
 * bar (replaces the old ad-hoc '>>' name hints). Each bank = a 3px tick; the
 * active bank = a tall filled block. Returns the strip's left x so the caller
 * can tuck the alt-arrow to its left. hdrBgWhite picks ink (black on white bar). */
function drawBankStrip(rightX, hdrBgWhite) {
    const fg = hdrBgWhite ? 0 : 1;
    const pos = bankCyclePos();
    const segW = 3, pitch = 4;
    const startX = rightX - (pos.count * pitch - 1);
    for (let i = 0; i < pos.count; i++) {
        const x = startX + i * pitch;
        if (i === pos.idx) fill_rect(x, 1, segW, 6, fg);   /* active: full 6px block */
        else               fill_rect(x, 5, segW, 2, fg);   /* others: 2px stub, baseline-aligned */
    }
    return startX;
}

/* Right side of the bank header: the bank-position strip on every screen —
 * resting overview AND deeper param banks — with the alt-arrow tucked to its
 * left. The strip replaces the old per-bank Tr[n] indicator. showTrack is now
 * vestigial here (kept for caller-signature stability). */
function drawBankHeaderRight(showTrack, hdrBgWhite) {
    if (S.sessionView) return;
    const sx = drawBankStrip(124, hdrBgWhite);
    if (bankHasAltParams(S.activeTrack, S.activeBank)) {
        drawAltArrow(sx - 8, hdrBgWhite, altIndicatorActive(S.activeTrack, S.activeBank));
    }
}

function drawBankHeading(name, showTrack) {
    fill_rect(0, 0, 128, 9, 1);
    /* Conductor banks: blink ONLY the "C-" prefix (phase driven in the tick loop,
     * like the alt-arrow flash); the bank name stays steady. */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT &&
            name.charAt(0) === 'C' && name.charAt(1) === '-') {
        if (S._altBlinkPhase !== 1) print(4, 1, 'C-', 0);   /* prefix blinks */
        print(16, 1, name.slice(2), 0);                     /* bank name steady (after "C-") */
    } else {
        print(4, 1, name, 0);
    }
    drawBankHeaderRight(showTrack, true);
}

function drawBankHeadingInverted(name, showTrack) {
    fill_rect(0, 0, 128, 9, 0);
    fill_rect(0, 0, 128, 1, 1);
    fill_rect(0, 8, 128, 1, 1);
    print(4, 1, name, 1);
    drawBankHeaderRight(showTrack, false);
}

/* Conductor bank render: standard white bank header + a 2x4 (2 rows x 4 cols)
 * grid of per-track cells labeled Tr1..Tr8, value rendered under each label.
 * Column/row metrics + col4() fixed-width cells + touched-knob highlight match
 * the standard 8-knob bank overview (colX = 4 + (i%4)*30, rowY = 12 | 36, value
 * at rowY+12; cell i is filled and rendered inverted when S.knobTouched === i —
 * same idiom as the drum-lane / ALL-LANES overviews). valFn(trackIdx) -> short
 * string. The Conductor's own track cell shows inertLabel instead of a value. */
function drawConductTrackGrid(header, valFn, inertLabel) {
    drawBankHeading(header, false);
    for (let i = 0; i < 8; i++) {
        const colX = 4 + (i % 4) * 30;
        const rowY = i < 4 ? 12 : 36;
        const hi   = (S.knobTouched === i);
        if (hi) fill_rect(colX, rowY, 24, 24, 1);
        /* activeTrack is the Conductor whenever these banks render */
        const isCond = (i === S.activeTrack);
        print(colX, rowY,      col4(isCond ? '-' : 'Tr' + (i + 1)),  hi ? 0 : 1);
        print(colX, rowY + 12, col4(isCond ? inertLabel : valFn(i)), hi ? 0 : 1);
    }
}

/* Down-arrow affordance for banks that expose alt params. Always drawn in the
 * header text color (steady) when alt mode is off; flashes on/off ~2x/sec when
 * alt mode is on. `hdrBgWhite` true = header background is white (so arrow draws
 * black); false = header background is black (so arrow draws white). The blink
 * phase is set in the tick loop (S._altBlinkPhase) which also marks the screen
 * dirty so the animation runs while idle. */
function drawAltArrow(x, hdrBgWhite, on) {
    if (on && S._altBlinkPhase === 1) return;   /* off-phase of the flash */
    const fg = hdrBgWhite ? 0 : 1;
    fill_rect(x,     2, 5, 1, fg);
    fill_rect(x + 1, 3, 3, 1, fg);
    fill_rect(x + 2, 4, 1, 1, fg);
}

function drawStepEditHeader() {
    pixelPrint(37, 1, 'STEP EDIT', 1);
    fill_rect(0, 9, 128, 1, 1);
}

/* Per-step trig-condition formatters (v=34).
 *   formatStepIter(raw):  0 -> "—"; else "{idx}/{len}" with raw=(len<<4)|idx
 *   formatStepRand(raw):  0 -> "—" (100%); else "{n}%"
 *   formatStepRatch(raw): 0|1 -> "—"; else "x{n}" */
function formatStepIter(raw) {
    if (!raw) return '--';
    return (raw & 0xF) + '/' + ((raw >> 4) & 0xF);
}
function formatStepRand(raw) {
    if (!raw) return '--';
    return raw + '%';
}
function formatStepRatch(raw) {
    if (raw < 2) return '--';
    return 'x' + raw;
}

function drawMetroIndicator() {
    /* Match the Global Menu / Shift+Step6 popup wording exactly (one source of
     * truth): Off / Cnt-In / Play / Always. */
    const METRO_LABELS = [null, 'Cnt-In', 'Play', 'Always'];
    const label = METRO_LABELS[S.metronomeOn];
    if (label) {
        const tx = 8;
        const tw = label.length * 6;
        fill_rect(4, 22, 2, 2, 1);           /* left dot */
        pixelPrint(tx, 21, label, 1);
        fill_rect(tx + tw + 2, 22, 2, 2, 1); /* right dot */
    }
    /* Velocity / Fixed/Adaptive indicators (track view only, y=21) */
    if (!S.sessionView) {
        const t  = S.activeTrack;
        const ac = (!S.playing && S.trackQueuedClip[t] >= 0) ? S.trackQueuedClip[t] : S.trackActiveClip[t];
        const _isDrum7   = S.trackPadMode[t] === PAD_MODE_DRUM;
        const _isEmpty7  = _isDrum7 ? !S.drumClipNonEmpty[t][ac] : !S.clipNonEmpty[t][ac];
        const _manualL7  = _isDrum7 ? S.drumLaneLengthManuallySet[t] : S.clipLengthManuallySet[t][ac];
        /* Velocity input indicator (between metro and fixed/adap) */
        pixelPrint(67, 21, fmtVelOverride(S.trackVelOverride[t]), 1);
        if (_isEmpty7 && !_manualL7) {
            pixelPrint(103, 21, 'Adap', 1);
        } else {
            pixelPrint(109, 21, 'Fix', 1);
        }
    }
}

const PERF_MOD_NAMES = [
    'Oct↑','Oct↓','Sc↑','Sc↓','5th','Triton','Drift','Storm',
    'Decrsc','Swell','Cresc','Pulse','Sdchn','Stac','Lgto','RmpG',
    '½time','3Skip','Phnm','Sprs','Gltch','Stggr','Shfl','Back',
];

/* Format CC number as a 4-char display label: CC7→"CC7 ", CC74→"CC74", C100→"C100" */
function fmtCCLabel(cc) {
    const n = (cc | 0);
    return n >= 100 ? 'C' + n : 'CC' + n;
}

function midiNoteName(n) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[n % 12] + (Math.floor(n / 12) - 1);
}

/* True when (track-type, bank) exposes alt params reachable via S.altMode.
 * Melodic: CLIP(0), DELAY(3), AUTO/CC(6 — CC-assign). Drum: DRUM LANE(0),
 * REPEAT GROOVE(5), AUTO(6), ALL LANES(7). Keep in sync with the
 * shiftHeld→altMode migration sites. */
/* Bank header label. Identical to BANKS[bank].name except a Conductor track
 * relabels bank 0 (CLIP) to "CONDUCT" — the CLIP bank is reused as the Conduct
 * bank. Does NOT rename BANKS[0] globally (other track types keep "CLIP"). */
function bankHeaderName(t, bank) {
    /* Conductor banks: "C-" prefix on the bank name (bank 0/CLIP shown as CONDUCT). */
    if (S.trackPadMode[t] === PAD_MODE_CONDUCT)
        return 'C-' + (bank === 0 ? 'CONDUCT' : BANKS[bank].name);
    return BANKS[bank].name;
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
    const blinkOn = S.flashEighth;
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

/* Convert a PERF_MOD_NAMES entry to mcufont-safe ASCII (no arrows / fractions). */
function _modAscii(name) {
    return name.replace('↑', '+').replace('↓', '-').replace('½', 'Hf');
}

/* Footer indicator chip: filled-rect when active, outline when inactive.
 * Returns the chip's width so the caller can advance x. */
function _perfChip(x, y, label, active) {
    const w = label.length * 6 + 3;
    if (active) {
        fill_rect(x, y, w, 9, 1);
        pixelPrint(x + 2, y + 2, label, 0);
    } else {
        /* hollow outline */
        fill_rect(x,         y,     w, 1, 1);
        fill_rect(x,         y + 8, w, 1, 1);
        fill_rect(x,         y,     1, 9, 1);
        fill_rect(x + w - 1, y,     1, 9, 1);
        pixelPrint(x + 2, y + 2, label, 1);
    }
    return w;
}

function drawPerfModeOled() {
    clear_screen();
    const activeMods = S.perfModsToggled | S.perfModsHeld;

    /* ── Header bar (y 0-11): preset name or "PERFORMANCE" ── */
    fill_rect(0, 0, 128, 12, 1);
    let title;
    if (S.perfRecalledSlot >= 0) {
        const fp = PERF_FACTORY_PRESETS[S.perfRecalledSlot];
        title = fp ? fp.name : ('SLOT ' + (S.perfRecalledSlot + 1));
    } else {
        title = 'PERFORMANCE';
    }
    print(4, 3, title, 0);

    /* ── Body (y 14-49): action popup → mod popup → mods list ── */
    if (S.actionPopupEndTick >= 0 && S.tickCount <= S.actionPopupEndTick && S.actionPopupLines.length > 0) {
        const _n = S.actionPopupLines.length;
        if (_n >= 4) {
            print(4, 14, S.actionPopupLines[0], 1);
            print(4, 25, S.actionPopupLines[1], 1);
            print(4, 36, S.actionPopupLines[2], 1);
            print(4, 47, S.actionPopupLines[3], 1);
        } else if (_n === 3) {
            print(4, 17, S.actionPopupLines[0], 1);
            print(4, 29, S.actionPopupLines[1], 1);
            print(4, 41, S.actionPopupLines[2], 1);
        } else if (_n === 2) {
            print(4, 20, S.actionPopupLines[0], 1);
            print(4, 32, S.actionPopupLines[1], 1);
        } else {
            print(4, 26, S.actionPopupLines[0], 1);
        }
    } else if (S.perfModPopupEndTick >= 0 && S.tickCount <= S.perfModPopupEndTick && S.perfModPopupName) {
        const px = Math.floor((128 - S.perfModPopupName.length * 6) / 2);
        print(px < 0 ? 0 : px, 26, S.perfModPopupName, 1);
    } else {
        S.perfModPopupEndTick = -1;
        const activeNames = [];
        for (let i = 0; i < PERF_MOD_NAMES.length; i++)
            if ((activeMods >> i) & 1) activeNames.push(_modAscii(PERF_MOD_NAMES[i]));
        if (activeNames.length === 0) {
            pixelPrint(4, 24, 'no mods active', 1);
            pixelPrint(4, 34, 'tap pad to engage', 1);
        } else {
            /* Wrap into up to 4 lines, ~20 chars per line at 6px each. */
            const MAX_CHARS = 20;
            const MAX_LINES = 4;
            const lines = [];
            let cur = '';
            for (let i = 0; i < activeNames.length; i++) {
                const sep  = cur ? '  ' : '';
                const next = cur + sep + activeNames[i];
                if (next.length > MAX_CHARS && cur) {
                    lines.push(cur);
                    if (lines.length >= MAX_LINES) { cur = ''; break; }
                    cur = activeNames[i];
                } else {
                    cur = next;
                }
            }
            if (cur && lines.length < MAX_LINES) lines.push(cur);
            for (let li = 0; li < lines.length; li++) {
                pixelPrint(4, 16 + li * 8, lines[li], 1);
            }
        }
    }

    /* ── Footer (y 53-61): mode chips + rate ── */
    const fy = 53;
    let fx = 2;
    fx += _perfChip(fx, fy, 'Hold',  S.perfHoldPadHeld || S.perfStickyLengths.size > 0) + 3;
    fx += _perfChip(fx, fy, 'Sync',  S.perfSync) + 3;
    fx += _perfChip(fx, fy, 'Latch', S.perfLatchMode) + 3;

    /* Rate (right-aligned, only when a loop length is active) */
    if (S.perfStack.length > 0) {
        const RATE_LABELS = ['1/32','1/16','1/8','1/4','1/2'];
        const top = S.perfStack[S.perfStack.length - 1];
        const lab = RATE_LABELS[top.idx];
        const w   = lab.length * 6 + 3;
        const rx  = 128 - w - 2;
        fill_rect(rx, fy, w, 9, 1);
        pixelPrint(rx + 2, fy + 2, lab, 0);
    }
}

export function drawUI() {
    /* CO-RUN: shadow_ui's chain editor owns the OLED while this is active.
     * Skip every dAVEBOx draw path so it doesn't fight the chain editor's
     * frame. shadow_ui still calls clear_screen + redraw each tick. */
    if (S.schwungCoRunSlot >= 0) return;
    /* Move-native co-run: Move firmware owns the OLED (preset browser /
     * device-edit pages). The shim's display_mode bypass keeps Move's
     * framebuffer visible while the MIDI filter stays active; we just
     * stay out of the way. Pad/step LEDs freeze at entry-time state —
     * verified harmless in real use (nothing the user does during co-run
     * depends on live LED feedback). */
    if (S.moveCoRunTrack >= 0) {
        /* Side clip buttons: the button paired to the Move track this dAVEBOx
         * track routes to blinks; the rest stay dark grey. Move's track numbering
         * is reversed (Track 1 = CC 43 = top .. Track 4 = CC 40 = bottom), so a
         * channel ch (1-4) maps to top-to-bottom bit (ch-1). Forced every
         * POLL_INTERVAL to re-assert over Move firmware's pass-through writes. */
        const _coRunCh = (S.trackChannel[S.moveCoRunTrack] | 0);
        const _litMask = (_coRunCh >= 1 && _coRunCh <= 4) ? (1 << (_coRunCh - 1)) : 0;
        paintCoRunSideButtons(_litMask, (S.tickCount % POLL_INTERVAL) === 0);
        return;
    }
    /* Alt-param mode is transient: any bank change, track change, or entering
     * Session View drops back to primary params. Diff-guard catches every
     * S.activeBank / S.activeTrack reassignment regardless of source. */
    if (S.altMode && (S.sessionView ||              /* session view can be entered via a button after altMode was set */
            S.activeBank !== S._altPrevBank ||
            S.activeTrack !== S._altPrevTrack)) {
        S.altMode = false;
    }
    S._altPrevBank  = S.activeBank;
    S._altPrevTrack = S.activeTrack;
    if (S.sessionOverlayHeld) { drawSessionOverview(); return; }
    if (S.pendingInheritPicker) { drawInheritPicker(); return; }
    if (S.snapshotPicker) { drawSnapshotPicker(); return; }
    if (S.clearAutoMenu) { drawClearAutoMenu(); return; }
    if (S.pendingSceneBakePicker) {
        clear_screen();
        print(4, 8,  'BAKE SCENE',         1);
        print(4, 22, 'Tap row or scene step', 1);
        print(4, 34, 'to pick the scene',    1);
        print(4, 50, 'Any other btn cancels', 1);
        return;
    }
    if (S.pendingMergePlacement) {
        clear_screen();
        print(4, 8,  'PLACE MERGED CLIPS',  1);
        print(4, 22, 'Tap row or scene step', 1);
        print(4, 34, 'to pick destination',  1);
        print(4, 50, 'Capture cancels',      1);
        return;
    }
    if (S.confirmStateWipe) { drawStateWipeConfirm(); return; }
    if (S.bpmMoveInfo) { drawBpmMoveInfo(); return; }
    if (S.recordBlockedDialog) { drawRecordBlockedDialog(); return; }
    if (S.confirmLgto)         { drawLgtoConfirm();         return; }
    if (S.confirmXpose) { drawXposeConfirm(); return; }
    if (S.confirmBakeScene) { drawBakeSceneConfirm(); return; }
    if (S.confirmBake) { drawBakeConfirm(); return; }
    if (S.globalMenuOpen || S.tapTempoOpen) { ensureGlobalMenuFresh(); drawGlobalMenu(); return; }
    /* Perf Mode OLED takeover (Session View + Loop held or locked) */
    if (S.sessionView && (S.loopHeld || S.perfViewLocked)) { drawPerfModeOled(); return; }
    if (S.stateLoading || S.bootSplashTicks > 0) {
        /* Reroll the splash on entry edge — picks one of SPLASH_FRAMES at
         * random per splash session (boot, set load, etc.). Stays stable
         * across the splash duration thanks to splashWasVisible. */
        if (!S.splashWasVisible) {
            S.currentSplashIdx = pickSplashIdx();
            S.splashWasVisible = true;
        }
        clear_screen();
        /* 128x64 splash bitmap, MSB-first packed bytes (1024 bytes total).
         * Render via fill_rect runs of lit pixels per row — fewer host calls
         * than per-pixel set_pixel and the screen is only redrawn briefly. */
        const _frame  = SPLASH_FRAMES[S.currentSplashIdx % SPLASH_COUNT];
        const rowBytes = SPLASH_W >> 3;
        for (let y = 0; y < SPLASH_H; y++) {
            let runStart = -1;
            const rowOff = y * rowBytes;
            for (let x = 0; x < SPLASH_W; x++) {
                const bit = (_frame[rowOff + (x >> 3)] >> (7 - (x & 7))) & 1;
                if (bit) {
                    if (runStart < 0) runStart = x;
                } else if (runStart >= 0) {
                    fill_rect(runStart, y, x - runStart, 1, 1);
                    runStart = -1;
                }
            }
            if (runStart >= 0) fill_rect(runStart, y, SPLASH_W - runStart, 1, 1);
        }
        return;
    }
    /* Not in splash mode — clear the entry-edge flag so the next splash rerolls. */
    if (S.splashWasVisible) S.splashWasVisible = false;

    clear_screen();
    if (S.sessionView) {
        if (S.actionPopupEndTick >= 0) {
            const _n = S.actionPopupLines.length;
            if (_n >= 4) {
                print(4, 14, S.actionPopupLines[0], 1);
                print(4, 25, S.actionPopupLines[1], 1);
                print(4, 36, S.actionPopupLines[2], 1);
                print(4, 47, S.actionPopupLines[3], 1);
            } else if (_n === 3) {
                print(4, 17, S.actionPopupLines[0], 1);
                print(4, 29, S.actionPopupLines[1], 1);
                print(4, 41, S.actionPopupLines[2], 1);
            } else if (_n === 2) {
                print(4, 22, S.actionPopupLines[0], 1);
                print(4, 34, S.actionPopupLines[1], 1);
            } else {
                print(4, 28, S.actionPopupLines[0], 1);
            }
            return;
        }
        /* DAVEBOX banner — white bar, letters animated when transport running */
        fill_rect(0, 0, 128, 12, 1);
        let dA, dE, dO;
        if (S.playing) {
            dA = (Math.floor(S.masterPos /  96) % 2 === 0) ? 'A' : '@';
            dE = (Math.floor(S.masterPos /  48) % 2 === 0) ? '3' : 'E';
            dO = (Math.floor(S.masterPos / 192) % 2 === 0) ? 'O' : 'o';
        } else {
            dA = 'A'; dE = 'E'; dO = 'O';
        }
        const banner = 'd' + dA + 'V' + dE + 'B' + dO + 'x';
        print(43, 2, banner, 0);
        drawMetroIndicator();
        drawTrackRow(34);
        for (let t = 0; t < NUM_TRACKS; t++) {
            const cx = t * 16 + 5;
            const ac = S.trackActiveClip[t];
            const hasData = S.trackPadMode[t] === PAD_MODE_DRUM
                ? S.drumClipNonEmpty[t][ac]
                : S.clipNonEmpty[t][ac];
            const isActive = (S.trackClipPlaying[t] || S.trackWillRelaunch[t] || (S.trackQueuedClip[t] >= 0)) && hasData;
            if (isActive) {
                fill_rect(cx - 1, 45, 9, 7, 1);
                pixelPrint(cx, 46, SCENE_LETTERS[ac], 0);
            } else {
                pixelPrint(cx, 46, SCENE_LETTERS[ac], 1);
            }
        }
        return;
    }

    /* Track View — priority display state machine */
    const bank      = S.activeBank;
    const inTimeout = S.bankSelectTick >= 0 || S.jogTouched;

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
        if (S.activeBank === 6) {
            /* CC bank step-hold: compact graph + knob values */
            var _t6s = S.activeTrack, _ac6s = effectiveClip(_t6s);
            var _gLane6 = S.ccActiveLane[_t6s];
            var _gEffLen6 = S.ccLaneLength[_t6s][_ac6s][_gLane6] || S.clipLength[_t6s][_ac6s];
            var _gLTps6 = S.ccLaneTps[_t6s][_ac6s][_gLane6] || (S.clipTPS[_t6s][_ac6s] || 24);
            /* Compact graph (12px) just above progress bar */
            var _sgBarY = 60, _sgBarH = 3;
            var _sgH = 12, _sgY = _sgBarY - _sgH - 2;
            var _sgPages = Math.ceil(_gEffLen6 / 16);
            var _sgKey = 'sg_' + _t6s + '_' + _ac6s + '_' + _gLane6 + '_' + _gEffLen6;
            if (_sgKey !== S.ccGraphOvKey || (S.tickCount % POLL_INTERVAL) === 0) {
                S.ccGraphOvData = [];
                for (var _sgp = 0; _sgp < _sgPages; _sgp++) {
                    var _sgRaw = (typeof host_module_get_param === 'function')
                        ? host_module_get_param('t' + _t6s + '_c' + _ac6s + '_ccsv_' + _gLane6 + '_' + _sgp) : null;
                    if (_sgRaw) {
                        var _sgParts = _sgRaw.split(' ');
                        for (var _sgs = 0; _sgs < 16 && _sgp * 16 + _sgs < _gEffLen6; _sgs++)
                            S.ccGraphOvData.push(_sgs < _sgParts.length ? parseInt(_sgParts[_sgs], 10) : 255);
                    }
                }
                S.ccGraphOvKey = _sgKey;
            }
            fill_rect(0, _sgY, 128, 1, 1);
            fill_rect(0, _sgY + _sgH - 1, 128, 1, 1);
            fill_rect(0, _sgY, 1, _sgH, 1);
            fill_rect(127, _sgY, 1, _sgH, 1);
            var _sgDLen = S.ccGraphOvData.length || 1;
            var _sgDrawY = _sgY + 2, _sgDrawH = _sgH - 4;
            var _sgPrevPy = -1;
            for (var _sgc = 1; _sgc < 127; _sgc++) {
                var _sgIdx = Math.floor(_sgc * _sgDLen / 128);
                var _sgv = _sgIdx < S.ccGraphOvData.length ? S.ccGraphOvData[_sgIdx] : -1;
                if (_sgv >= 0 && _sgv <= 127) {
                    var _sgpy = _sgDrawY + _sgDrawH - 1 - Math.round(_sgv * (_sgDrawH - 1) / 127);
                    if (_sgPrevPy >= 0 && _sgPrevPy !== _sgpy) {
                        var _sgyMin = Math.min(_sgPrevPy, _sgpy);
                        var _sgyMax = Math.max(_sgPrevPy, _sgpy);
                        fill_rect(_sgc, _sgyMin, 1, _sgyMax - _sgyMin + 1, 1);
                    } else {
                        fill_rect(_sgc, _sgpy, 1, 1, 1);
                    }
                    _sgPrevPy = _sgpy;
                } else {
                    _sgPrevPy = -1;
                }
            }
            /* Step position indicator on graph — white vertical line */
            var _sgSx = Math.min(126, Math.max(1, Math.floor(S.heldStep * 126 / _sgDLen) + 1));
            fill_rect(_sgSx, _sgY + 1, 1, _sgH - 2, 1);
            /* Step header: MCU font, white on black, separator line */
            pixelPrint(1, 1, 'Step ' + (S.heldStep + 1), 1);
            var _pnLbl = '';
            var _pnK = S.knobTouched >= 0 ? S.knobTouched : _gLane6;
            if (S.trackCCType[_t6s][_pnK] === 2)
                _pnLbl = S.schLabel[_t6s][_pnK] || ('Sch' + S.trackCCAssign[_t6s][_pnK]);
            if (_pnLbl) pixelPrint(128 - _pnLbl.length * 6 - 1, 1, _pnLbl, 1);
            fill_rect(0, 7, 128, 1, 1);
            /* 8 knobs in 2 rows of 4 (standard font) */
            for (var _k6 = 0; _k6 < 8; _k6++) {
                var _col6 = _k6 % 4, _row6 = Math.floor(_k6 / 4);
                var _x6 = 4 + _col6 * 31, _y6 = 11 + _row6 * 18;
                var _hi6 = (S.knobTouched === _k6) || (S.ccActiveLane[_t6s] === _k6);
                if (_hi6) fill_rect(_x6 - 1, _y6 - 1, 29, 18, 1);
                var _lbl6 = S.trackCCType[_t6s][_k6] === 2 ? ('Sch' + S.trackCCAssign[_t6s][_k6])
                          : S.trackCCType[_t6s][_k6] === 1 ? 'AT'
                          : (S.trackCCAssign[_t6s][_k6] > 0 ? 'C' + S.trackCCAssign[_t6s][_k6] : '--');
                var _vs6;
                if (S.ccStepEditSet[_k6]) {
                    _vs6 = String(S.ccStepEditVal[_k6]);
                } else {
                    var _cv6 = S.ccStepEditComputed[_k6];
                    _vs6 = (_cv6 >= 0 && _cv6 <= 127) ? '(' + _cv6 + ')' : '--';
                }
                print(_x6, _y6, col4(_lbl6), _hi6 ? 0 : 1);
                print(_x6, _y6 + 9, col5(_vs6), _hi6 ? 0 : 1);
            }
            /* Progress bar */
            var _sgWP = Math.max(1, Math.ceil(_gEffLen6 / 16));
            var _sgVP = Math.max(0, Math.min(S.trackCurrentPage[_t6s], _sgWP - 1));
            var _sgSG = 1, _sgSW = Math.max(2, Math.floor((120 - (_sgWP - 1) * _sgSG) / _sgWP));
            var _sgPP = -1;
            if (S.playing) {
                var _sgProg = (S.masterPos % (_gEffLen6 * _gLTps6)) / (_gEffLen6 * _gLTps6);
                _sgPP = Math.floor(_sgProg * _sgWP);
            }
            for (var _sgPg = 0; _sgPg < _sgWP; _sgPg++) {
                var _sgx = 4 + _sgPg * (_sgSW + _sgSG);
                if (_sgPg === _sgVP) fill_rect(_sgx, _sgBarY, _sgSW, _sgBarH, 1);
                else if (_sgPg === _sgPP) {
                    fill_rect(_sgx, _sgBarY, _sgSW, 1, 1);
                    fill_rect(_sgx, _sgBarY + _sgBarH - 1, _sgSW, 1, 1);
                    fill_rect(_sgx, _sgBarY, 1, _sgBarH, 1);
                    fill_rect(_sgx + _sgSW - 1, _sgBarY, 1, _sgBarH, 1);
                } else fill_rect(_sgx, _sgBarY + _sgBarH - 1, _sgSW, 1, 1);
            }
            if (S.playing) {
                var _sgBW = _sgWP * (_sgSW + _sgSG) - _sgSG;
                var _sgDX = 4 + Math.floor(_sgProg * _sgBW);
                var _sgVS = 4 + _sgVP * (_sgSW + _sgSG);
                fill_rect(_sgDX, _sgBarY, 1, _sgBarH, (_sgDX >= _sgVS && _sgDX < _sgVS + _sgSW) ? 0 : 1);
            }
            return;
        } else {
        drawStepEditHeader();
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
            /* Drum step edit: 2-row 4-col grid matching melodic layout width.
             * Row 1: K1 Leng, K2 Vel, K3 Nudg, K4 —.
             * Row 2: K5 Iter, K6 Prob, K7 Ratch, K8 —. */
            const t    = S.activeTrack;
            const lane = S.activeDrumLane[t];
            if (S.heldStepNotes.length > 0) {
                const tps   = S.drumLaneTPS[t] || 24;
                const _gateSteps = S.stepEditGate / tps;
                const LABELS = ['Leng', 'Vel', 'Nudg', '--', 'Iter', 'Prob', 'Ratch', '--'];
                const VALS   = [
                    _gateSteps % 1 === 0 ? _gateSteps.toFixed(0) : _gateSteps.toFixed(2),
                    String(S.stepEditVel),
                    (S.stepEditNudge >= 0 ? '+' : '') + String(S.stepEditNudge),
                    '',
                    formatStepIter(S.stepEditIter),
                    formatStepRand(S.stepEditRand),
                    formatStepRatch(S.stepEditRatch),
                    ''
                ];
                const COL_X = [0, 32, 64, 96];
                const ROW_Y = [13, 35];
                const CELL_W = 31, CELL_H = 22;
                for (let i = 0; i < 8; i++) {
                    if (i === 3 || i === 7) continue;
                    const col = i % 4, row = (i / 4) | 0;
                    const x = COL_X[col], y = ROW_Y[row];
                    const hi = (S.knobTouched === i);
                    if (hi) fill_rect(x, y - 3, CELL_W, CELL_H, 1);
                    print(x + 1, y, LABELS[i], hi ? 0 : 1);
                    print(x + 1, y + 10, VALS[i], hi ? 0 : 1);
                }
            } else {
                print(4, 30, '(empty)', 1);
            }
            return;
        }
        const ac        = effectiveClip(S.activeTrack);
        if (S.heldStepNotes.length > 0) {
            /* Melodic step edit: 2-row 4-col grid. Row 1: K1 Oct, K2 Note, K3 Leng, K4 Vel.
             * Row 2: K5 Nudg, K6 Iter, K7 Prob, K8 Ratch. */
            const root = S.heldStepNotes[0];
            const noteLabel = S.heldStepNotes.length > 1
                ? midiNoteName(root) + '+' + (S.heldStepNotes.length - 1)
                : midiNoteName(root);
            const tps = S.clipTPS[S.activeTrack][ac] || 24;
            const _gateSteps = S.stepEditGate / tps;
            const LABELS = ['Oct', 'Note', 'Leng', 'Vel', 'Nudg', 'Iter', 'Prob', 'Ratch'];
            const VALS   = [
                noteLabel,
                noteLabel,
                _gateSteps % 1 === 0 ? _gateSteps.toFixed(0) : _gateSteps.toFixed(2),
                String(S.stepEditVel),
                (S.stepEditNudge >= 0 ? '+' : '') + String(S.stepEditNudge),
                formatStepIter(S.stepEditIter),
                formatStepRand(S.stepEditRand),
                formatStepRatch(S.stepEditRatch)
            ];
            const COL_X = [0, 32, 64, 96];
            const ROW_Y = [13, 35];
            const CELL_W = 31, CELL_H = 22;
            /* Oct + Pit are merged: both knobs edit the same root note, so
             * one centered note value sits under both labels with a divider line. */
            {
                const hiOP = (S.knobTouched === 0 || S.knobTouched === 1);
                const opX  = COL_X[0];
                const opW  = COL_X[1] + CELL_W - COL_X[0];
                if (hiOP) fill_rect(opX, ROW_Y[0] - 3, opW, CELL_H, 1);
                print(COL_X[0] + 1, ROW_Y[0], 'Oct',  hiOP ? 0 : 1);
                print(COL_X[1] + 1, ROW_Y[0], 'Note', hiOP ? 0 : 1);
                fill_rect(opX, ROW_Y[0] + 7, opW, 1, hiOP ? 0 : 1);
                const _nlx = opX + ((opW - noteLabel.length * 6) >> 1);
                print(_nlx, ROW_Y[0] + 10, noteLabel, hiOP ? 0 : 1);
            }
            for (let i = 2; i < 8; i++) {
                const col = i % 4, row = (i / 4) | 0;
                const x = COL_X[col], y = ROW_Y[row];
                const hi = (S.knobTouched === i);
                if (hi) fill_rect(x, y - 3, CELL_W, CELL_H, 1);
                print(x + 1, y, LABELS[i], hi ? 0 : 1);
                print(x + 1, y + 10, VALS[i], hi ? 0 : 1);
            }
            return;
        } else if (S.stepWasEmpty) {
            print(4, 30, '(empty)', 1);
            return;
        }
        /* non-empty step, notes still loading at hold threshold — fall through to bank/header */
    } /* end else (non-bank-6 step edit) */
    }

    /* Loop view: own priority state so screen is fully cleared first. Suppressed
     * on the unconfirmed drum ALL LANES bank so holding Loop surfaces the confirm
     * screen (below) instead of the clip-length view for a gated gesture. */
    if (S.loopHeld && !(S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank === 7 && !S.allLanesConfirmed)) {
        const _loopL2 = 'STEP BTN=by page';
        const _loopL3 = 'JOG TURN=by step';
        const _loopX2 = Math.floor((128 - _loopL2.length * 6) / 2);
        const _loopX3 = Math.floor((128 - _loopL3.length * 6) / 2);
        function _drawLoopSteps(steps) {
            const _l4  = 'Steps: ' + steps + '/256';
            const _l4x = Math.floor((128 - _l4.length * 6) / 2);
            const _nvX = _l4x + 7 * 6;
            const _nvW = (_l4.length - 7) * 6;
            fill_rect(_nvX - 1, 50, _nvW + 2, 14, 1);
            print(_l4x, 52, 'Steps: ', 1);
            print(_nvX, 52, steps + '/256', 0);
        }
        if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && S.activeBank !== 6) {
            const t   = S.activeTrack;
            const len = S.drumLaneLength[t];
            if (S.activeBank === 7) {
                const _allBlink = Math.floor(S.tickCount / 24) % 2 === 0;
                const _l1 = 'Clip length-' + (_allBlink ? 'ALL' : '   ') + ' lanes';
                print(Math.floor((128 - 21 * 6) / 2), 4, _l1, 1);
            } else {
                print(Math.floor((128 - 11 * 6) / 2), 4, 'Lane length', 1);
            }
            fill_rect(0, 15, 128, 1, 1);
            print(_loopX2, 22, _loopL2, 1);
            print(_loopX3, 34, _loopL3, 1);
            _drawLoopSteps(len);
        } else if (S.activeBank === 6) {
            var _t_l = S.activeTrack;
            var _ac_l = effectiveClip(_t_l);
            var _ccL_l = S.ccActiveLane[_t_l];
            var _llen_l = S.ccLaneLength[_t_l][_ac_l][_ccL_l];
            var _ltps_l = S.ccLaneResTps[_t_l][_ac_l][_ccL_l] || S.ccLaneTps[_t_l][_ac_l][_ccL_l];
            var _lbl_l = S.trackCCType[_t_l][_ccL_l] === 2
                       ? ('Sch' + S.trackCCAssign[_t_l][_ccL_l])
                       : fmtCCLabel(S.trackCCAssign[_t_l][_ccL_l]);
            var _resN = _ltps_l === 12 ? '1/32' : _ltps_l === 48 ? '1/8'
                      : _ltps_l === 96 ? '1/4' : _ltps_l === 384 ? '1bar' : '1/16';
            var _lcHdr = 'Lane config: K' + (_ccL_l + 1) + '-' + _lbl_l;
            pixelPrint(Math.floor((128 - _lcHdr.length * 6) / 2), 4, _lcHdr, 1);
            fill_rect(0, 15, 128, 1, 1);
            pixelPrint(1, 18, 'STEP BTN=Leng by page', 1);
            pixelPrint(1, 25, 'JOG TURN=Leng by step', 1);
            var _zoomTps_l = S.ccLaneTps[_t_l][_ac_l][_ccL_l] || (S.clipTPS[_t_l][_ac_l] || 24);
            var _zoomN = _zoomTps_l === 12 ? '1/32' : _zoomTps_l === 48 ? '1/8'
                       : _zoomTps_l === 96 ? '1/4' : _zoomTps_l === 384 ? '1bar' : '1/16';
            var _resLabel = 'Resolution: <';
            var _resValX = 1 + _resLabel.length * 6;
            var _resValW = _resN.length * 6 + 2;
            pixelPrint(1, 34, _resLabel, 1);
            fill_rect(_resValX - 1, 33, _resValW, 7, 1);
            pixelPrint(_resValX, 34, _resN, 0);
            pixelPrint(_resValX + _resValW, 34, '>', 1);
            var _zoomLabel = 'Zoom: +';
            var _zoomValX = 1 + _zoomLabel.length * 6;
            var _zoomValW = _zoomN.length * 6 + 2;
            pixelPrint(1, 41, _zoomLabel, 1);
            fill_rect(_zoomValX - 1, 40, _zoomValW, 7, 1);
            pixelPrint(_zoomValX, 41, _zoomN, 0);
            pixelPrint(_zoomValX + _zoomValW, 41, '-', 1);
            _drawLoopSteps(_llen_l > 0 ? _llen_l : S.clipLength[_t_l][_ac_l]);
        } else {
            const ac_l    = effectiveClip(S.activeTrack);
            const steps_l = S.clipLength[S.activeTrack][ac_l];
            print(Math.floor((128 - 11 * 6) / 2), 4, 'Clip Length', 1);
            fill_rect(0, 15, 128, 1, 1);
            print(_loopX2, 22, _loopL2, 1);
            print(_loopX3, 34, _loopL3, 1);
            _drawLoopSteps(steps_l);
        }
        return;
    }

    /* Arp Steps interval overlay: persistent bank overview while jog-clicked into
     * step-interval mode on SEQ ARP (4) or TARP (5). K1-K8 = per-step scale-degree
     * offsets (±24); pad grid is the persistent step-vel level editor handled in
     * updateTrackLEDs. Renders REGARDLESS of knob-touch / inTimeout (persistent). */
    if (bank >= 0 && S.stepIntervalMode && !S.sessionView && (bank === 4 || bank === 5)) {
        const t      = S.activeTrack;
        const isSeq  = (bank === 4);
        const arr    = isSeq ? S.seqArpStepInt[t][effectiveClip(t)] : S.tarpStepInt[t];
        drawBankHeading(isSeq ? 'SEQ ARP Steps' : 'ARP IN Steps');
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            const lbl = 'S' + (k + 1);
            const v   = arr[k] | 0;
            const val = (v === 0) ? ' 0' : (v > 0 ? '+' + v : String(v));
            print(colX, rowY,      col4(lbl), hi ? 0 : 1);
            print(colX, rowY + 12, col4(val), hi ? 0 : 1);
        }
        return;
    }

    /* Auto bank idle display: lane info + automation graph + progress bar */
    if (bank === 6 && !S.loopHeld && S.knobTouched < 0 && !inTimeout) {
        var _gt = S.activeTrack;
        var _gac = effectiveClip(_gt);
        var _gLane = S.ccActiveLane[_gt];
        var _gLbl = S.trackCCType[_gt][_gLane] === 2
                  ? ('Sch' + S.trackCCAssign[_gt][_gLane])
                  : fmtCCLabel(S.trackCCAssign[_gt][_gLane]);
        var _gParam = S.trackCCType[_gt][_gLane] === 2
                    ? (S.schLabel[_gt][_gLane] || '') : '';
        var _gEffLen = S.ccLaneLength[_gt][_gac][_gLane] || S.clipLength[_gt][_gac];
        var _gDispTps = S.ccLaneTps[_gt][_gac][_gLane] || (S.clipTPS[_gt][_gac] || 24);
        var _gLTps = S.ccLaneResTps[_gt][_gac][_gLane] || _gDispTps;
        var _gResN = _gLTps === 12 ? '1/32' : _gLTps === 48 ? '1/8'
                   : _gLTps === 96 ? '1/4' : _gLTps === 384 ? '1bar' : '1/16';
        drawBankHeadingInverted(BANKS[6].name);
        {
            var _ccHas = (S.trackCCAutoBits[_gt][_gac] !== 0) ||
                         S.clipCCVal[_gt][_gac].some(function(v) { return v >= 0; });
            var _atHas = !!S.clipAtHas[_gt][_gac];
            var _schHas = S.trackCCType[_gt].some(function(tp, k) {
                return tp === 2 && (((S.trackCCAutoBits[_gt][_gac] >> k) & 1) || S.clipCCVal[_gt][_gac][k] >= 0);
            });
            var _bx = 60;
            var _badge = function(txt) {
                var w = txt.length * 6 + 3;
                fill_rect(_bx, 1, w, 7, 1);
                print(_bx + 1, 1, txt, 0);
                _bx += w + 2;
            };
            if (_schHas) _badge('Sch');
            if (_atHas) _badge('AT');
            if (_ccHas) _badge('CC');
        }
        /* Lane info rows */
        var _gVal = S.playing ? S.trackCCLiveVal[_gt][_gLane] : S.clipCCVal[_gt][_gac][_gLane];
        var _gValStr = (_gVal >= 0 && _gVal <= 127) ? String(_gVal) : '--';
        var _gLine1L = 'K' + (_gLane + 1) + ' ' + _gLbl + ':';
        print(4, 10, _gLine1L, 1);
        var _gValX = 4 + _gLine1L.length * 6;
        print(_gValX, 10, _gValStr, 1);
        fill_rect(_gValX, 19, _gValStr.length * 6, 1, 1);
        if (_gParam) {
            var _gPTrunc = _gParam.length > 12 ? _gParam.substring(0, 12) : _gParam;
            print(128 - _gPTrunc.length * 6 - 1, 10, _gPTrunc, 1);
        }
        var _gZoomTps = S.ccLaneTps[_gt][_gac][_gLane] || (S.clipTPS[_gt][_gac] || 24);
        var _gZoomN = _gZoomTps === 12 ? '1/32' : _gZoomTps === 48 ? '1/8'
                    : _gZoomTps === 96 ? '1/4' : _gZoomTps === 384 ? '1bar' : '1/16';
        var _gResStr = 'Res: ' + _gResN;
        var _gZoomStr = 'Zoom: ' + _gZoomN;
        print(4, 21, _gResStr, 1);
        print(128 - _gZoomStr.length * 6 - 4, 21, _gZoomStr, 1);
        /* Automation graph: 128px wide, just above progress bar */
        var _gBarY = 60, _gBarH = 3;
        var _gH = 24, _gY = _gBarY - _gH - 3;
        var _gPages = Math.ceil(_gEffLen / 16);
        var _gCTps = S.clipTPS[_gt][_gac] || 24;
        var _gTotalSteps = _gEffLen;
        var _gKey = 'g_' + _gt + '_' + _gac + '_' + _gLane + '_' + _gEffLen;
        if (_gKey !== S.ccGraphOvKey || (S.tickCount % POLL_INTERVAL) === 0) {
            S.ccGraphOvData = [];
            for (var _gp = 0; _gp < _gPages; _gp++) {
                var _gRaw = (typeof host_module_get_param === 'function')
                    ? host_module_get_param('t' + _gt + '_c' + _gac + '_ccsv_' + _gLane + '_' + _gp) : null;
                if (_gRaw) {
                    var _gParts = _gRaw.split(' ');
                    for (var _gs = 0; _gs < 16 && _gp * 16 + _gs < _gTotalSteps; _gs++)
                        S.ccGraphOvData.push(_gs < _gParts.length ? parseInt(_gParts[_gs], 10) : 255);
                }
            }
            S.ccGraphOvKey = _gKey;
        }
        /* Render graph: black background, 1px white border, white line */
        fill_rect(0, _gY, 128, 1, 1);
        fill_rect(0, _gY + _gH - 1, 128, 1, 1);
        fill_rect(0, _gY, 1, _gH, 1);
        fill_rect(127, _gY, 1, _gH, 1);
        var _gDataLen = S.ccGraphOvData.length || 1;
        var _gDrawY = _gY + 2, _gDrawH = _gH - 4;
        var _gPrevPy = -1;
        for (var _gc = 1; _gc < 127; _gc++) {
            var _gIdx = Math.floor(_gc * _gDataLen / 128);
            var _gv = _gIdx < S.ccGraphOvData.length ? S.ccGraphOvData[_gIdx] : -1;
            if (_gv >= 0 && _gv <= 127) {
                var _gpy = _gDrawY + _gDrawH - 1 - Math.round(_gv * (_gDrawH - 1) / 127);
                if (_gPrevPy >= 0 && _gPrevPy !== _gpy) {
                    var _gyMin = Math.min(_gPrevPy, _gpy);
                    var _gyMax = Math.max(_gPrevPy, _gpy);
                    fill_rect(_gc, _gyMin, 1, _gyMax - _gyMin + 1, 1);
                } else {
                    fill_rect(_gc, _gpy, 1, 1, 1);
                }
                _gPrevPy = _gpy;
            } else {
                _gPrevPy = -1;
            }
        }
        /* Live playhead — white vertical line at the current loop position (melodic + drum) */
        if (S.playing) {
            var _gPhDen = _gEffLen * _gLTps;
            var _gPhFrac = _gPhDen > 0 ? (S.masterPos % _gPhDen) / _gPhDen : 0;
            var _gPhX = Math.max(1, Math.min(126, Math.round(_gPhFrac * 128)));
            fill_rect(_gPhX, _gY + 1, 1, _gH - 2, 1);
        }
        /* Step-hold position indicator — black vertical line on graph */
        if (S.heldStep >= 0) {
            var _gSx = Math.floor(S.heldStep * 128 / _gDataLen);
            if (_gSx > 127) _gSx = 127;
            fill_rect(_gSx, _gY, 1, _gH, 0);
        }
        /* Progress bar — lane-aware */
        var _gWinPages = Math.max(1, Math.ceil(_gEffLen / 16));
        var _gViewPage = Math.max(0, Math.min(S.trackCurrentPage[_gt], _gWinPages - 1));
        var _gSegGap = 1;
        var _gSegW = Math.max(2, Math.floor((120 - (_gWinPages - 1) * _gSegGap) / _gWinPages));
        var _gPlayPage = -1;
        if (S.playing) {
            var _gProg2 = (S.masterPos % (_gEffLen * _gLTps)) / (_gEffLen * _gLTps);
            _gPlayPage = Math.floor(_gProg2 * _gWinPages);
        }
        for (var _gPg = 0; _gPg < _gWinPages; _gPg++) {
            var _gx = 4 + _gPg * (_gSegW + _gSegGap);
            if (_gPg === _gViewPage) {
                fill_rect(_gx, _gBarY, _gSegW, _gBarH, 1);
            } else if (_gPg === _gPlayPage) {
                fill_rect(_gx, _gBarY, _gSegW, 1, 1);
                fill_rect(_gx, _gBarY + _gBarH - 1, _gSegW, 1, 1);
                fill_rect(_gx, _gBarY, 1, _gBarH, 1);
                fill_rect(_gx + _gSegW - 1, _gBarY, 1, _gBarH, 1);
            } else {
                fill_rect(_gx, _gBarY + _gBarH - 1, _gSegW, 1, 1);
            }
        }
        /* Playhead dot on progress bar */
        if (S.playing) {
            var _gBarW = _gWinPages * (_gSegW + _gSegGap) - _gSegGap;
            var _gDotX = 4 + Math.floor(_gProg2 * _gBarW);
            var _gViewStart = 4 + _gViewPage * (_gSegW + _gSegGap);
            var _gOnSolid = _gDotX >= _gViewStart && _gDotX < _gViewStart + _gSegW;
            fill_rect(_gDotX, _gBarY, 1, _gBarH, _gOnSolid ? 0 : 1);
        }
        return;
    }

    /* Conductor banks (Responder/Octave/When): per-track 2x4 grid, shown on knob
     * touch / bank-select timeout; idle falls through to the resting overview like
     * the Conduct bank. Gated on PAD_MODE_CONDUCT so it never affects melodic/drum. */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT &&
            (bank === BANK_RESPONDER || bank === BANK_OCTAVE || bank === BANK_WHEN) &&
            (S.knobTouched >= 0 || inTimeout)) {
        const _ch = bankHeaderName(S.activeTrack, bank);
        if (bank === BANK_RESPONDER) {
            drawConductTrackGrid(_ch, function(k){ return S.trackPadMode[k] === PAD_MODE_DRUM ? '--' : (S.condResp[S.trackActiveClip[S.activeTrack] | 0][k] ? 'ON' : 'off'); }, 'Cndct');
        } else if (bank === BANK_OCTAVE) {
            drawConductTrackGrid(_ch, function(k){ if (S.trackPadMode[k] === PAD_MODE_DRUM) return '--'; const o = S.condOct[S.trackActiveClip[S.activeTrack] | 0][k]; return o === 0 ? '--' : (o > 0 ? '+' + o : '' + o); }, 'Cndct');
        } else { /* BANK_WHEN */
            drawConductTrackGrid(_ch, function(k){ return S.trackPadMode[k] === PAD_MODE_DRUM ? '--' : (S.condWhen[S.trackActiveClip[S.activeTrack] | 0][k] ? 'Now' : 'Next'); }, 'Cndct');
        }
        return;
    }

    if (bank >= 0 && (S.knobTouched >= 0 || inTimeout ||
            (S.altMode && bankHasAltParams(S.activeTrack, bank)) ||
            (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7 && !S.allLanesConfirmed))) {
        const isDrumLaneBank = (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 0);
        if (isDrumLaneBank) {
            /* DRUM LANE bank overview: mirrors CLIP bank at lane level */
            const t    = S.activeTrack;
            const ac   = effectiveClip(t);
            const lane = S.activeDrumLane[t];
            const len  = S.drumLaneLength[t];
            const tpsIdx = Math.max(0, TPS_VALUES.indexOf(S.drumLaneTPS[t]));
            const sqfl   = S.clipSeqFollow[t][ac] ? 1 : 0;
            const eucN = Math.min(S.drumLaneEuclidN[t][lane] | 0, len);
            const drumLaneLabels = [S.altMode ? 'Zoom' : 'Res', 'Stch', S.altMode ? 'Nudg' : 'Shft', 'Lgto', 'Eucl', '-', S.altMode ? 'Rvrs' : 'Dir', 'SqFl'];
            const drumLaneVals  = [
                fmtRes(tpsIdx),
                fmtStretch(S.bankParams[t][0][1]),
                fmtSign(S.bankParams[t][0][2]),
                '->',
                String(eucN),
                '-',
                S.altMode ? fmtRevStyle(S.drumLanePlaybackAudioReverse[t][lane] | 0)
                          : fmtPlayDir(S.drumLanePlaybackDir[t][lane] | 0),
                fmtBool(sqfl),
            ];
            drawBankHeading('DRUM LANE');
            for (let k = 0; k < 8; k++) {
                if (!drumLaneLabels[k]) continue;
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                if (hi) fill_rect(colX, rowY, 24, 24, 1);
                print(colX, rowY,      col4(drumLaneLabels[k]), hi ? 0 : 1);
                print(colX, rowY + 12, col4(drumLaneVals[k]),   hi ? 0 : 1);
            }
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7 && !S.allLanesConfirmed) {
            /* ALL LANES confirmation screen */
            fill_rect(0, 0, 128, 9, 1);
            print(4, 1, (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES', 0);
            drawBankStrip(124, true);
            print(10, 18, 'Edits will affect', 1);
            print(10, 28, 'all lanes. Proceed?', 1);
            fill_rect(40, 44, 48, 16, 1);
            print(52, 48, 'OK', 0);
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 7) {
            /* ALL LANES bank overview */
            const t = S.activeTrack;
            const rv = S.bankParams[t][7][0];
            const qv = S.bankParams[t][7][3];
            const dv = S.bankParams[t][7][6];
            const DIQ_LABELS = ['Off','1/64','1/32','1/16','1/16T','1/8','1/8T','1/4','1/4T'];
            const allLabels = ['Res', 'Stch', S.altMode ? 'Nudg' : 'Shft', 'Qnt', 'VelIn', 'InQ', S.altMode ? 'Rvrs' : 'Dir', 'SyncRpt'];
            const allVals = [
                rv < 0 ? '--' : fmtRes(rv),
                fmtStretch(S.bankParams[t][7][1]),
                fmtSign(S.bankParams[t][7][2]),
                qv <= 0 ? '--' : fmtPct(qv),
                fmtVelOverride(S.trackVelOverride[t]),
                DIQ_LABELS[S.drumInpQuant[t]] || 'Off',
                dv < 0 ? '--' : (S.altMode ? fmtRevStyle(dv) : fmtPlayDir(dv)),
                fmtBool(S.bankParams[t][7][7]),
            ];
            fill_rect(0, 0, 128, 9, 1);
            print(4, 1, (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES', 0);
            const _alSx = drawBankStrip(124, true);
            drawAltArrow(_alSx - 8, true, altIndicatorActive(S.activeTrack, S.activeBank));
            for (let k = 0; k < 8; k++) {
                if (!allLabels[k]) continue;
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                if (hi) fill_rect(colX, rowY, 24, 24, 1);
                const _lbl = allLabels[k];
                print(colX, rowY,      _lbl.length > 4 ? _lbl : col4(_lbl), hi ? 0 : 1);
                print(colX, rowY + 12, col4(allVals[k]),   hi ? 0 : 1);
            }
        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 1) {
        /* Drum NOTE/NOTEFX bank: K1=Gate K2=Vel K3=Qnt */
        /* Drum NOTE FX: K1+K2=Oct/Note (merged), K3=Vel, K4=Qnt, K5=Len(placeholder), K6=Gate */
        const t    = S.activeTrack;
        const vals = S.bankParams[t][1];
        drawBankHeading('NOTE FX');
        /* K1+K2: merged Oct/Note box (per-lane MIDI note editor) */
        {
            const lane     = S.activeDrumLane[t];
            const _dlNote  = S.drumLaneNote[t][lane];
            const _noteStr = midiNoteName(_dlNote) + ' ' + _dlNote;
            const hiLane   = (S.knobTouched === 0 || S.knobTouched === 1);
            const LX = 4, LY = 12, LW = 54, LH = 24;
            if (hiLane) {
                fill_rect(LX, LY, LW, LH, 1);
            } else {
                /* single horizontal line under the Oct/Note labels */
                fill_rect(LX, LY + 9, LW, 1, 1);
            }
            const _lc = hiLane ? 0 : 1;
            print(LX + Math.floor((LW/2 - 18) / 2),                         LY + 1,  'Oct',  _lc);
            print(LX + Math.floor(LW/2) + Math.floor((LW/2 - 24) / 2),      LY + 1,  'Note', _lc);
            print(LX + Math.floor((LW - _noteStr.length * 6) / 2), LY + 13, _noteStr, _lc);
        }
        /* K3=Vel, K4=Qnt (row 1 right half); K5=Len, K6=Gate (row 2 left half) */
        {
            const _lane = S.activeDrumLane[t];
            const nfxLabels = [null, null, 'Vel', 'Qnt', 'Len>', '>Gate', null, null];
            const nfxVals   = [null, null, fmtSign(vals[1]), fmtPct(vals[2]),
                               fmtLen(S.drumLaneLenMode[t][_lane] | 0), fmtPct(vals[0]),
                               null, null];
            for (let k = 2; k < 6; k++) {
                const colX = 4 + (k % 4) * 30;
                const rowY = k < 4 ? 12 : 36;
                const hi   = (S.knobTouched === k);
                /* K6 label ">Gate" is 5 chars (30px) — widen the cell so the label
                 * and its highlight rect aren't clipped. K7/K8 are blocked on this
                 * bank, so the extra column is free. */
                const cellW = (k === 5) ? 30 : 24;
                if (hi) fill_rect(colX, rowY, cellW, 24, 1);
                const _lbl = nfxLabels[k];
                print(colX, rowY,      _lbl.length > 4 ? _lbl : col4(_lbl), hi ? 0 : 1);
                print(colX, rowY + 12, col4(nfxVals[k]),                    hi ? 0 : 1);
            }
        }

        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 5) {
        /* Drum RPT GROOVE bank overview — 8 steps, vel scale (unshifted) or nudge (Shift) */
        const t    = S.activeTrack;
        const lane = S.activeDrumLane[t];
        syncDrumRepeatState(t, lane);
        /* Custom header: drop Tr# to clear the right side; arrow flash + per-step
         * value format (vel% vs signed nudge%) signal the alt-mode state. */
        fill_rect(0, 0, 128, 9, 0);
        fill_rect(0, 0, 128, 1, 1);
        fill_rect(0, 8, 128, 1, 1);
        print(4, 1, 'REPEAT GROOVE', 1);
        if (!S.sessionView) {
            const _rgSx = drawBankStrip(124, false);
            if (bankHasAltParams(S.activeTrack, S.activeBank)) {
                drawAltArrow(_rgSx - 8, false, altIndicatorActive(S.activeTrack, S.activeBank));
            }
        }
        const _gLen = S.drumRepeatGateLen[t][lane];
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            if (k >= _gLen) continue;
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
            const disp = S.altMode
                ? (ndg === 0 ? ' 0%' : (ndg > 0 ? '+' : '') + ndg + '%')
                : vs + '%';
            print(colX, rowY + 12, col4(disp), hi ? 0 : 1);
        }
        } else if (bank === 6) {
        /* CC PARAM bank overview: label = CC# or "AT" (aftertouch); value =
         * stopped → clip resting value or "—"; playing → defined value at the
         * playhead or "—". Active lane cell is always highlighted. */
        const t  = S.activeTrack;
        const ac = effectiveClip(t);
        drawBankHeadingInverted(S.altMode ? 'ASSIGN' : BANKS[6].name);
        /* Automation-type indicators: inverted badge (white bg, black text) per
         * type that has data in the focused clip; nothing if the type is empty. */
        {
            const ccHas = (S.trackCCAutoBits[t][ac] !== 0) ||
                          S.clipCCVal[t][ac].some(function(v) { return v >= 0; });
            const atHas = !!S.clipAtHas[t][ac];
            const schHas = S.trackCCType[t].some(function(tp, k) {
                return tp === 2 && (((S.trackCCAutoBits[t][ac] >> k) & 1) || S.clipCCVal[t][ac][k] >= 0);
            });
            let bx = 60;
            const _badge = function(txt) {
                const w = txt.length * 6 + 3;
                fill_rect(bx, 1, w, 7, 1);
                print(bx + 1, 1, txt, 0);
                bx += w + 2;
            };
            if (schHas) _badge('Sch');
            if (atHas) _badge('AT');
            if (ccHas) _badge('CC');
        }
        /* Active lane = touched knob, else the persistent active lane — drives the graph. */
        const _ovLane = S.knobTouched >= 0 ? S.knobTouched : S.ccActiveLane[t];
        /* Compact knobs: 2 rows of 4 (geometry mirrors the step-hold view) to free
         * the lower third for the automation graph. */
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 31;
            const rowY = 11 + (k < 4 ? 0 : 18);
            const touchedHi = (S.knobTouched === k) || (S.ccActiveLane[t] === k);
            const lbl = S.trackCCType[t][k] === 2 ? ('Sch' + S.trackCCAssign[t][k])
                      : S.trackCCType[t][k] === 1 ? 'AT' : fmtCCLabel(S.trackCCAssign[t][k]);
            const rawV = S.playing ? S.trackCCLiveVal[t][k] : S.clipCCVal[t][ac][k];
            const val  = (rawV >= 0 && rawV <= 127) ? String(rawV) : '--';
            if (S.altMode) {
                /* ASSIGN: label half always highlighted (turning retargets CC/AT);
                 * value half highlighted only when touched. */
                fill_rect(colX - 1, rowY - 1, 29, 9, 1);
                if (touchedHi) fill_rect(colX - 1, rowY + 8, 29, 9, 1);
                print(colX, rowY,     col4(lbl), 0);
                print(colX, rowY + 9, col4(val), touchedHi ? 0 : 1);
            } else {
                if (touchedHi) fill_rect(colX - 1, rowY - 1, 29, 18, 1);
                print(colX, rowY,     col4(lbl), touchedHi ? 0 : 1);
                print(colX, rowY + 9, col4(val), touchedHi ? 0 : 1);
            }
        }
        /* Touch-activated automation graph of the active lane (12px, ported from
         * the step-hold view) — follows the touched/active knob's lane. */
        {
            const _gEffLen = S.ccLaneLength[t][ac][_ovLane] || S.clipLength[t][ac];
            const _gY = 46, _gH = 12;
            const _gPages = Math.ceil(_gEffLen / 16);
            const _gKey = 'sg_' + t + '_' + ac + '_' + _ovLane + '_' + _gEffLen;
            if (_gKey !== S.ccGraphOvKey || (S.tickCount % POLL_INTERVAL) === 0) {
                S.ccGraphOvData = [];
                for (let _gp = 0; _gp < _gPages; _gp++) {
                    const _gRaw = (typeof host_module_get_param === 'function')
                        ? host_module_get_param('t' + t + '_c' + ac + '_ccsv_' + _ovLane + '_' + _gp) : null;
                    if (_gRaw) {
                        const _gParts = _gRaw.split(' ');
                        for (let _gs = 0; _gs < 16 && _gp * 16 + _gs < _gEffLen; _gs++)
                            S.ccGraphOvData.push(_gs < _gParts.length ? parseInt(_gParts[_gs], 10) : 255);
                    }
                }
                S.ccGraphOvKey = _gKey;
            }
            fill_rect(0, _gY, 128, 1, 1);
            fill_rect(0, _gY + _gH - 1, 128, 1, 1);
            fill_rect(0, _gY, 1, _gH, 1);
            fill_rect(127, _gY, 1, _gH, 1);
            const _dLen = S.ccGraphOvData.length || 1;
            const _dY = _gY + 2, _dH = _gH - 4;
            let _prevPy = -1;
            for (let _gc = 1; _gc < 127; _gc++) {
                const _idx = Math.floor(_gc * _dLen / 128);
                const _gv = _idx < S.ccGraphOvData.length ? S.ccGraphOvData[_idx] : -1;
                if (_gv >= 0 && _gv <= 127) {
                    const _py = _dY + _dH - 1 - Math.round(_gv * (_dH - 1) / 127);
                    if (_prevPy >= 0 && _prevPy !== _py)
                        fill_rect(_gc, Math.min(_prevPy, _py), 1, Math.abs(_py - _prevPy) + 1, 1);
                    else
                        fill_rect(_gc, _py, 1, 1, 1);
                    _prevPy = _py;
                } else {
                    _prevPy = -1;
                }
            }
            /* Live playhead — white vertical line at the current loop position (melodic + drum) */
            if (S.playing) {
                const _pvSpeed = S.ccLaneResTps[t][ac][_ovLane] || S.ccLaneTps[t][ac][_ovLane] || (S.clipTPS[t][ac] || 24);
                const _pvDen = _gEffLen * _pvSpeed;
                const _pvFrac = _pvDen > 0 ? (S.masterPos % _pvDen) / _pvDen : 0;
                const _pvX = Math.max(1, Math.min(126, Math.round(_pvFrac * 128)));
                fill_rect(_pvX, _gY + 1, 1, _gH - 2, 1);
            }
        }
        } else if (S.trackPadMode[S.activeTrack] !== PAD_MODE_DRUM && bank === 1) {
        /* Melodic NOTE FX: K1=Oct, K2=Ofs, K3=Vel, K4=Qnt, K5=Len, K6=>Gate
         * (widened cell for 5-char label), K7=blocked, K8=Rnd. */
        const t     = S.activeTrack;
        const knobs = BANKS[1].knobs;
        const vals  = S.bankParams[t][1];
        const RND_ALG_NAMES_NFX = ['Pure', 'Gaus', 'Walk'];
        /* Conductor reuses melodic NOTE FX but only Oct(K1)/Ofs(K2)/Rnd(K8) +
         * alt-K8 random-mode apply — they shape the conductor note before its
         * offset is derived. K3-K6 (Vel/Qnt/Len/Gate) are inert/greyed. */
        const _conductNfx = S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT;
        drawBankHeading(BANKS[1].name);
        drawAltArrow(98, true, altIndicatorActive(S.activeTrack, S.activeBank));
        for (let k = 0; k < 8; k++) {
            if (k === 6) continue;  /* K7 blocked, no render */
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            const widen = (k === 5);
            const cellW = widen ? 30 : 24;
            const _inert = _conductNfx && (k === 2 || k === 3 || k === 4 || k === 5);
            if (_inert) {
                /* greyed-out inert cell: label/value '-' (no highlight) */
                print(colX, rowY,      col4('-'), 1);
                print(colX, rowY + 12, col4('-'), 1);
                continue;
            }
            if (hi) fill_rect(colX, rowY, cellW, 24, 1);
            const _nfxAlt = S.altMode && k === 7;
            if (widen) {
                print(colX, rowY,      '>Gate',                       hi ? 0 : 1);
                print(colX, rowY + 12, col4(knobs[k].fmt(vals[k])),   hi ? 0 : 1);
            } else if (_nfxAlt) {
                print(colX, rowY,      col4('Algo'),                   hi ? 0 : 1);
                print(colX, rowY + 12, col4(RND_ALG_NAMES_NFX[S.noteFXRandomMode[t] || 0]), hi ? 0 : 1);
            } else {
                print(colX, rowY,      col4(knobs[k].abbrev),         hi ? 0 : 1);
                print(colX, rowY + 12, col4(knobs[k].fmt(vals[k])),   hi ? 0 : 1);
            }
        }

        } else if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM && bank === 3) {
        /* Drum MIDI DLY: K1-K4 same as melodic, K5=Gate, K6=Clk, K7=Retrg, K8 empty.
         * Drum has no Pfb (no per-lane pitch) and no Rnd (no random pitch fb),
         * so K5/K6 borrow those physical slots for Gate/Clk via the per-track
         * remap in applyBankParam, and K7 hosts delay_retrig directly. */
        const t    = S.activeTrack;
        const vals = S.bankParams[t][3];
        const knobs = BANKS[3].knobs;
        const drumDlyLabels = [knobs[0].abbrev, knobs[1].abbrev, knobs[2].abbrev, knobs[3].abbrev, 'Gate', 'Clk', 'Retrg', null];
        const drumDlyFmt    = [knobs[0].fmt, knobs[1].fmt, knobs[2].fmt, knobs[3].fmt, fmtGateMod, fmtSign, fmtBool, null];
        drawBankHeading(BANKS[3].name);
        for (let k = 0; k < 8; k++) {
            if (!drumDlyLabels[k]) continue;
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            print(colX, rowY,      col4(drumDlyLabels[k]), hi ? 0 : 1);
            print(colX, rowY + 12, col4(drumDlyFmt[k](vals[k])), hi ? 0 : 1);
        }

        } else {
        /* Bank overview — 5 rows; touched knob column inverted */
        const knobs = BANKS[bank].knobs;
        const vals  = S.bankParams[S.activeTrack][bank];
        const _isDrum = S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM;
        (bank === 5 ? drawBankHeadingInverted : drawBankHeading)(bankHeaderName(S.activeTrack, bank));
        for (let k = 0; k < 8; k++) {
            const colX = 4 + (k % 4) * 30;
            const rowY = k < 4 ? 12 : 36;
            const hi   = (S.knobTouched === k);
            if (hi) fill_rect(colX, rowY, 24, 24, 1);
            /* Conduct bank (CLIP bank 0 on a Conductor) K6 = CdLk lock toggle.
             * Melodic/drum CLIP K6 stays the generic '-' stub (unchanged). */
            if (bank === 0 && k === 5 &&
                    S.trackPadMode[S.activeTrack] === PAD_MODE_CONDUCT) {
                const _cdc = S.trackActiveClip[S.activeTrack] | 0;
                print(colX, rowY,      col4('CdLk'), hi ? 0 : 1);
                print(colX, rowY + 12, col4(S.condLock[_cdc] ? 'Lock' : 'Off'), hi ? 0 : 1);
                continue;
            }
            let _lbl = knobs[k].abbrev || '-';
            /* Shift+K1 on DELAY bank (melodic): label + value flip to
             * delay_clock_fb. Drum: K6 already holds clock_fb directly via
             * remap; no flip needed. */
            const _delayShiftClkF = S.altMode && !_isDrum && bank === 3 && k === 0;
            const _clipDirAlt    = S.altMode && !_isDrum && knobs[k].dspKey === 'clip_playback_dir';
            const _rndAltAlgo    = S.altMode && !_isDrum && (bank === 1 || bank === 3) && k === 7;
            const RND_ALG_NAMES  = ['Pure', 'Gaus', 'Walk'];
            if (S.altMode) {
                if      (knobs[k].dspKey === 'clock_shift')    _lbl = 'Nudg';
                else if (knobs[k].dspKey === 'clip_resolution') _lbl = 'Zoom';
                else if (knobs[k].dspKey === 'clip_playback_dir') _lbl = 'Rvrs';
                else if (_delayShiftClkF)                       _lbl = 'ClkF';
                else if (_rndAltAlgo)                           _lbl = 'Algo';
            }
            print(colX, rowY,      _lbl, hi ? 0 : 1);
            /* Arp Rate (Rate knob in SEQ ARP / ARP IN) uses 5-char labels for
             * triplets ('1/16t','1/32t'). Skip the 4-char padding so the 't'
             * isn't truncated — the cell has ~24px and the raw string fits. */
            const _rawVal = _rndAltAlgo   ? RND_ALG_NAMES[bank === 3 ? (S.midiDlyRandomMode[S.activeTrack] || 0) : (S.noteFXRandomMode[S.activeTrack] || 0)]
                          : _delayShiftClkF ? fmtSign(S.delayClockFb[S.activeTrack])
                          : _clipDirAlt     ? fmtRevStyle(S.clipPlaybackAudioReverse[S.activeTrack][effectiveClip(S.activeTrack)] | 0)
                          : (knobs[k].abbrev ? knobs[k].fmt(vals[k]) : null);
            const _txt    = (knobs[k].fmt === fmtArpRate && !_delayShiftClkF) ? (_rawVal || '-') : col4(_rawVal);
            print(colX, rowY + 12, _txt, hi ? 0 : 1);
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
        const bankGroup = pg === 0 ? 'Bank:A' : 'Bank:B';
        const bankName  = S.activeBank === 0 ? 'DRUM LANE' : S.activeBank === 1 ? 'NOTE FX' : S.activeBank === 5 ? 'REPEAT GROOVE' : S.activeBank === 6 ? BANKS[6].name : S.activeBank === 7 ? (Math.floor(S.tickCount / 24) % 2 === 0 ? 'ALL' : '   ') + ' LANES' : BANKS[S.activeBank] ? BANKS[S.activeBank].name : '?';
        (S.activeBank === 5 || S.activeBank === 6 ? drawBankHeadingInverted : drawBankHeading)(bankName, false);
        pixelPrint(4, 10, bankGroup + '  Pad:' + name + oct + ' (' + note + ')', 1);
        const laneBit = 1 << lane;
        if (S.drumLaneSolo[t] & laneBit) {
            pixelPrint(128 - 4 - 6 * 6, 21, 'SOLOED', 1);
        } else if (S.drumLaneMute[t] & laneBit) {
            if (Math.floor(S.tickCount / 50) % 2 === 0)
                pixelPrint(128 - 4 - 5 * 6, 21, 'MUTED', 1);
        }
        drawMetroIndicator();
        drawTrackRow(34);
        for (let _t = 0; _t < NUM_TRACKS; _t++) {
            const _cx = _t * 16 + 5;
            const _ac = S.trackActiveClip[_t];
            const _hasData = S.trackPadMode[_t] === PAD_MODE_DRUM
                ? S.drumClipNonEmpty[_t][_ac]
                : S.clipNonEmpty[_t][_ac];
            const _isActive = (S.trackClipPlaying[_t] || S.trackWillRelaunch[_t] || (S.trackQueuedClip[_t] >= 0)) && _hasData;
            if (_isActive) {
                fill_rect(_cx - 1, 45, 9, 7, 1);
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 0);
            } else {
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 1);
            }
        }
        drawDrumPositionBar(t);
    } else {
        /* State 4: normal Track View */
        const recTag  = (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === S.activeTrack)
            ? ' REC' : '';
        const oct     = S.trackOctave[S.activeTrack];
        const octStr  = 'Oct:' + (oct >= 0 ? '+' : '') + oct;
        const keyScl  = NOTE_KEYS[S.padKey] + ' ' + (SCALE_DISPLAY[S.padScale] || '?');
        const CHAR_W  = 6;
        const keySclX = 128 - 4 - keyScl.length * CHAR_W;
        (S.activeBank === 5 || S.activeBank === 6 ? drawBankHeadingInverted : drawBankHeading)(bankHeaderName(S.activeTrack, S.activeBank) + recTag, false);
        pixelPrint(4, 10, octStr, 1);
        if (S.bankParams[S.activeTrack][5][0]) {
            if (S.bankParams[S.activeTrack][5][7]) {
                /* Latch on: invert 'Arp' (black on white chip) — pixelPrint
                 * uses a 5x5 glyph with 6px step; 'Arp' spans x=52..68, y=10..14.
                 * Chip pads 1px around: x=51..69 (w=19), y=9..15 (h=7). */
                fill_rect(51, 9, 19, 7, 1);
                pixelPrint(52, 10, 'Arp', 0);
            } else {
                pixelPrint(52, 10, 'Arp', 1);
            }
        }
        pixelPrint(keySclX, 10, keyScl, 1);
        if (S.scaleAware) fill_rect(keySclX, 15, keyScl.length * CHAR_W, 1, 1);
        drawMetroIndicator();
        drawTrackRow(34);
        for (let t = 0; t < NUM_TRACKS; t++) {
            const _cx = t * 16 + 5;
            const _ac = S.trackActiveClip[t];
            const _hasData = S.trackPadMode[t] === PAD_MODE_DRUM
                ? S.drumClipNonEmpty[t][_ac]
                : S.clipNonEmpty[t][_ac];
            const _isActive = (S.trackClipPlaying[t] || S.trackWillRelaunch[t] || (S.trackQueuedClip[t] >= 0)) && _hasData;
            if (_isActive) {
                fill_rect(_cx - 1, 45, 9, 7, 1);
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 0);
            } else {
                pixelPrint(_cx, 46, SCENE_LETTERS[_ac], 1);
            }
        }
        drawPositionBar(S.activeTrack);
    }
}

function drawDrumPositionBar(t) {
    const lsBase = S.drumLaneLoopStart[t] | 0;
    const len    = S.drumLaneLength[t];
    const startPage = lsBase >> 4;
    const winPages  = Math.max(1, Math.ceil(len / 16));
    const viewPage  = Math.max(0, Math.min(S.drumStepPage[t] - startPage, winPages - 1));
    const cs        = S.drumCurrentStep[t];
    const playPage  = (S.playing && S.trackClipPlaying[t] && cs >= lsBase && cs < lsBase + len)
                    ? Math.floor((cs - lsBase) / 16) : -1;
    const barY = 57, barH = 5, segGap = 1;
    const segW   = Math.max(2, Math.floor((120 - (winPages - 1) * segGap) / winPages));
    const startX = 4;
    for (let pg = 0; pg < winPages; pg++) {
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
    if (S.playing && S.trackClipPlaying[t] && cs >= lsBase && cs < lsBase + len) {
        const winPxW = winPages * (segW + segGap) - segGap;
        const dotX = startX + Math.floor((cs - lsBase) * winPxW / Math.max(1, len));
        const viewSegStart = startX + viewPage * (segW + segGap);
        const onSolid = dotX >= viewSegStart && dotX < viewSegStart + segW;
        fill_rect(dotX, barY, 1, barH, onSolid ? 0 : 1);
    }
    /* Extent markers from the active lane's step mirror. */
    const lane  = S.activeDrumLane[t];
    const steps = S.drumLaneSteps[t][lane];
    let hasLeft = false, hasRight = false;
    for (let s = 0; s < lsBase; s++) if (steps[s] !== '0') { hasLeft = true; break; }
    for (let s = lsBase + len; s < 256; s++) if (steps[s] !== '0') { hasRight = true; break; }
    if (hasLeft)  fill_rect(startX - 2, barY + 1, 1, barH - 2, 1);
    if (hasRight) {
        const xRight = startX + winPages * (segW + segGap) - segGap + 1;
        fill_rect(xRight, barY + 1, 1, barH - 2, 1);
    }
}
