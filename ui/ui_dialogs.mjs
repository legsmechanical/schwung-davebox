import { S } from './ui_state.mjs';
import { MCUFONT, STATE_VERSION, NOTE_KEYS, SCALE_DISPLAY, pixelPrintC } from './ui_constants.mjs';
import {
    drawMenuHeader, drawMenuList, menuLayoutDefaults
} from '/data/UserData/schwung/shared/menu_layout.mjs';
import { formatItemValue } from '/data/UserData/schwung/shared/menu_items.mjs';
import {
    SNAPSHOT_CAP, snapshotLabel, saveState, loadSnapshotManifest, showActionPopup,
    dropSnapshots, applySnapshotToLive, copyStateFiles
} from './ui_persistence.mjs';
import { effectiveClip, invalidateLEDCache } from './ui_leds.mjs';

export function pixelPrintMcu(x, y, text, scale, color) {
    const charW = 5 * scale + scale;
    for (let ci = 0; ci < text.length; ci++) {
        const g = MCUFONT[text[ci]];
        if (!g) continue;
        for (let row = 0; row < 5; row++) {
            const bits = g[row];
            for (let col = 0; col < 5; col++) {
                if (bits & (1 << (4 - col)))
                    fill_rect(x + ci * charW + col * scale, y + row * scale, scale, scale, color);
            }
        }
    }
}

function pixelPrintLargeC(cx, y, text, scale, color) {
    const charW  = 5 * scale + scale;
    const totalW = text.length * charW - scale;
    const startX = cx - Math.floor(totalW / 2);
    for (let ci = 0; ci < text.length; ci++) {
        const g = MCUFONT[text[ci]];
        if (!g) continue;
        for (let row = 0; row < 5; row++) {
            const bits = g[row];
            for (let col = 0; col < 5; col++) {
                if (bits & (1 << (4 - col)))
                    fill_rect(startX + ci * charW + col * scale, y + row * scale, scale, scale, color);
            }
        }
    }
}

/* Left/right filled triangle "arrows" (the wheel-changeable "< >" indicator). */
function triLeft(x, y, w, h) {
    const mid = (h - 1) / 2;
    for (let r = 0; r < h; r++) {
        const c0 = Math.round((Math.abs(r - mid) / mid) * (w - 1));
        for (let c = c0; c < w; c++) set_pixel(x + c, y + r, 1);
    }
}
function triRight(x, y, w, h) {
    const mid = (h - 1) / 2;
    for (let r = 0; r < h; r++) {
        const c1 = Math.round((1 - Math.abs(r - mid) / mid) * (w - 1));
        for (let c = 0; c <= c1; c++) set_pixel(x + c, y + r, 1);
    }
}

/* Shared "< NNN unit >" value line — number in MCUFONT ×2, smaller unit label,
 * chevrons flanking (jog-changeable), the group centered at cx. Used by the
 * tap-tempo screen (unit 'bpm') and the post-capture chooser ('bpm' or 'bars'). */
export function drawBpmLine(cx, topY, value, unit) {
    const num = String(Math.round(value || 0));
    const u   = unit || 'bpm';
    const nS = 2, uS = 1;
    const nCW = 5 * nS + nS, uCW = 5 * uS + uS;
    const nW  = num.length * nCW - nS;
    const uW  = u.length * uCW - uS;
    const aW = 5, aH = 9, aGap = 5, uGap = 3;
    const total = aW + aGap + nW + uGap + uW + aGap + aW;
    let x = cx - Math.round(total / 2);
    if (x < 1) x = 1;
    const nH = 5 * nS;
    triLeft(x, topY + Math.round((nH - aH) / 2), aW, aH); x += aW + aGap;
    pixelPrintMcu(x, topY, num, nS, 1); x += nW + uGap;
    pixelPrintMcu(x, topY + (nH - 5 * uS), u, uS, 1); x += uW + aGap;
    triRight(x, topY + Math.round((nH - aH) / 2), aW, aH);
}

function drawTapTempoScreen() {
    clear_screen();
    drawMenuHeader('TAP TEMPO');
    drawBpmLine(64, 24, S.tapTempoBpm);
    pixelPrintC(64, 50, 'Tap any pad', 1);
}

function drawClearSessionConfirm() {
    clear_screen();
    drawMenuHeader('CLEAR SESSION');
    print(4, 16, 'This will clear the', 1);
    print(4, 25, 'entire project and', 1);
    print(4, 34, 'cannot be undone.', 1);
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    if (S.confirmClearSel === 1) {
        fill_rect(noX, btnY, btnW, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 0);
    } else {
        fill_rect(noX, btnY, btnW, 1, 1);
        fill_rect(noX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(noX, btnY, 1, btnH, 1);
        fill_rect(noX + btnW - 1, btnY, 1, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 1);
    }
    if (S.confirmClearSel === 0) {
        fill_rect(yesX, btnY, btnW, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 0);
    } else {
        fill_rect(yesX, btnY, btnW, 1, 1);
        fill_rect(yesX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(yesX, btnY, 1, btnH, 1);
        fill_rect(yesX + btnW - 1, btnY, 1, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 1);
    }
}

function drawSaveStateConfirm() {
    clear_screen();
    drawMenuHeader('SAVE STATE');
    print(4, 20, 'Save current session?', 1);
    print(4, 32, S.confirmSaveCount + ' of ' + SNAPSHOT_CAP + ' saved', 1);
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    if (S.confirmSaveSel === 1) {
        fill_rect(noX, btnY, btnW, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 0);
    } else {
        fill_rect(noX, btnY, btnW, 1, 1);
        fill_rect(noX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(noX, btnY, 1, btnH, 1);
        fill_rect(noX + btnW - 1, btnY, 1, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 1);
    }
    if (S.confirmSaveSel === 0) {
        fill_rect(yesX, btnY, btnW, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 0);
    } else {
        fill_rect(yesX, btnY, btnW, 1, 1);
        fill_rect(yesX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(yesX, btnY, 1, btnH, 1);
        fill_rect(yesX + btnW - 1, btnY, 1, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 1);
    }
}

function drawConvertToDrumConfirm() {
    clear_screen();
    drawMenuHeader('CONVERT');
    print(4, 16, 'Warning:', 1);
    print(4, 25, 'Existing notes may', 1);
    print(4, 34, 'be lost. Proceed?', 1);
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    if (S.confirmConvertToDrumSel === 1) {
        fill_rect(noX, btnY, btnW, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 0);
    } else {
        fill_rect(noX, btnY, btnW, 1, 1);
        fill_rect(noX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(noX, btnY, 1, btnH, 1);
        fill_rect(noX + btnW - 1, btnY, 1, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 1);
    }
    if (S.confirmConvertToDrumSel === 0) {
        fill_rect(yesX, btnY, btnW, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 0);
    } else {
        fill_rect(yesX, btnY, btnW, 1, 1);
        fill_rect(yesX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(yesX, btnY, 1, btnH, 1);
        fill_rect(yesX + btnW - 1, btnY, 1, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 1);
    }
}

function drawConvertToConductConfirm() {
    clear_screen();
    drawMenuHeader('CONVERT');
    print(4, 16, 'Make Conductor?', 1);
    print(4, 25, 'Clears FX/ARP/Auto.', 1);
    print(4, 34, 'Keeps notes.', 1);
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    if (S.confirmConvertToConductSel === 1) {
        fill_rect(noX, btnY, btnW, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 0);
    } else {
        fill_rect(noX, btnY, btnW, 1, 1);
        fill_rect(noX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(noX, btnY, 1, btnH, 1);
        fill_rect(noX + btnW - 1, btnY, 1, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 1);
    }
    if (S.confirmConvertToConductSel === 0) {
        fill_rect(yesX, btnY, btnW, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 0);
    } else {
        fill_rect(yesX, btnY, btnW, 1, 1);
        fill_rect(yesX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(yesX, btnY, 1, btnH, 1);
        fill_rect(yesX + btnW - 1, btnY, 1, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 1);
    }
}

/* Generic single-button INFO dialog. Renders up to 4 lines from S.menuInfoLines
 * (empty = closed). Mirrors drawConvertToConductConfirm's layout with one OK
 * button. Used for "Conductor exists", "Stop playback to change type", etc. */
function drawMenuInfo() {
    clear_screen();
    drawMenuHeader('INFO');
    const lines = S.menuInfoLines || [];
    let y = 16;
    for (let i = 0; i < lines.length && i < 4; i++) {
        print(4, y, lines[i], 1);
        y += 9;
    }
    const okX = 49, btnY = 46, btnW = 30, btnH = 13;
    fill_rect(okX, btnY, btnW, btnH, 1);
    print(okX + 10, btnY + 3, 'OK', 0);
}

function drawExportConfirm() {
    clear_screen();
    drawMenuHeader('EXPORT');
    if (S.confirmExportCondPhase) {
        function _ebtn(x, y, w, h, sel, label, labelOff) {
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
        print(4, 22, 'Apply Conductor?', 1);
        const bY = 47, bW = 36, mH = 11;
        _ebtn(4,  bY, bW, mH, S.confirmExportCondSel === 0, 'YES',    9);
        _ebtn(45, bY, bW, mH, S.confirmExportCondSel === 1, 'NO',    14);
        _ebtn(86, bY, bW, mH, S.confirmExportCondSel === 2, 'CANCEL', 1);
        return;
    }
    print(4, 16, 'Export this set as', 1);
    print(4, 25, 'an Ableton bundle?', 1);
    print(4, 34, '(transport stopped)', 1);
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    if (S.confirmExportSel === 1) {
        fill_rect(noX, btnY, btnW, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 0);
    } else {
        fill_rect(noX, btnY, btnW, 1, 1);
        fill_rect(noX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(noX, btnY, 1, btnH, 1);
        fill_rect(noX + btnW - 1, btnY, 1, btnH, 1);
        print(noX + 17, btnY + 3, 'No', 1);
    }
    if (S.confirmExportSel === 0) {
        fill_rect(yesX, btnY, btnW, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 0);
    } else {
        fill_rect(yesX, btnY, btnW, 1, 1);
        fill_rect(yesX, btnY + btnH - 1, btnW, 1, 1);
        fill_rect(yesX, btnY, 1, btnH, 1);
        fill_rect(yesX + btnW - 1, btnY, 1, btnH, 1);
        print(yesX + 14, btnY + 3, 'Yes', 1);
    }
}

/* Persistent post-export confirmation: shows the full device path, dismissed
 * with OK (jog-click or Back). Path is wrapped to fit the OLED. */
function drawExportDoneDialog() {
    clear_screen();
    drawMenuHeader(S.exportDoneMissing > 0 ? ('EXPORTED -' + S.exportDoneMissing) : 'EXPORTED TO');
    const path = S.exportDonePath || '';
    const W = 21;   /* chars per line at the small print font */
    let y = 14, lines = 0;
    for (let i = 0; i < path.length && lines < 4; i += W, lines++) {
        print(2, y, path.slice(i, i + W), 1);
        y += 9;
    }
    /* OK button (filled, bottom center) */
    const okX = 49, btnY = 52, btnW = 30, btnH = 11;
    fill_rect(okX, btnY, btnW, btnH, 1);
    print(okX + 10, btnY + 2, 'OK', 0);
}

export function drawGlobalMenu() {
    if (S.tapTempoOpen)        { drawTapTempoScreen();       return; }
    if (S.exportDoneDialog)    { drawExportDoneDialog();     return; }
    if (S.confirmClearSession) { drawClearSessionConfirm();  return; }
    if (S.confirmSaveState)    { drawSaveStateConfirm();     return; }
    if (S.confirmConvertToDrum){ drawConvertToDrumConfirm(); return; }
    if (S.confirmConvertToConduct){ drawConvertToConductConfirm(); return; }
    if (S.menuInfoLines.length > 0){ drawMenuInfo(); return; }
    if (S.confirmExport || S.confirmExportCondPhase) { drawExportConfirm(); return; }
    clear_screen();
    const _inTrackSection = S.globalMenuState.selectedIndex < 5;
    const _hTitle = _inTrackSection ? 'Track ' + (S.activeTrack + 1) : 'Global';
    fill_rect(0, 1, 128, 10, 1);
    pixelPrintMcu(2, 4, _hTitle, 1, 0);
    fill_rect(0, 12, 128, 1, 1);
    drawMenuList({
        items: S.globalMenuItems,
        selectedIndex: S.globalMenuState.selectedIndex,
        listArea: { topY: menuLayoutDefaults.listTopY, bottomY: menuLayoutDefaults.listBottomNoFooter },
        valueX: 76,
        valueAlignRight: true,
        prioritizeSelectedValue: true,
        selectedMinLabelChars: 5,
        getLabel: function(item) { return item ? (item.label || '') : ''; },
        getValue: function(item, index) {
            if (!item) return '';
            const isEditing = S.globalMenuState.editing && index === S.globalMenuState.selectedIndex;
            return formatItemValue(item, isEditing, S.globalMenuState.editValue);
        }
    });
}

/* "REC Unavailable" two-option dialog (OK | BAKE NOW). Opens when Record
 * is pressed on a clip / lane in any non-Forward direction or Audio reverse
 * style. OK dismisses; BAKE NOW opens the standard bake confirm dialog
 * pre-targeted at the active clip / drum lane. */
export function drawStateWipeConfirm() {
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
    drawMenuHeader('Incompatible State');
    print(4, 16, 'Session incompatible', 1);
    print(4, 25, 'with current dB ver.', 1);
    print(4, 34, 'Erase and proceed?', 1);
    _btn(6,  46, 46, 13, S.confirmStateWipeSel === 0, 'Yes', 14);
    _btn(74, 46, 46, 13, S.confirmStateWipeSel === 1, 'No',  17);
}

export function drawRecordBlockedDialog() {
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
    drawMenuHeader('REC Unavailable');
    print(4, 16, 'Set Dir to Fwd', 1);
    print(4, 25, 'or Bake', 1);
    _btn(6,  46, 46, 13, S.recordBlockedDialogSel === 0, 'OK',       19);
    _btn(58, 46, 64, 13, S.recordBlockedDialogSel === 1, 'BAKE NOW', 6);
}

/* Shown when Tap Tempo is invoked while Clock Follow = Move (tempo is Move's, so
 * there's nothing to tap). Single OK button; dismissed by jog click or Back. */
export function drawBpmMoveInfo() {
    clear_screen();
    drawMenuHeader('Tempo');
    print(4, 20, 'BPM controlled', 1);
    print(4, 30, 'by Move', 1);
    /* OK button (filled, bottom center) — matches the generic INFO dialog. */
    fill_rect(49, 52, 30, 11, 1);
    print(59, 54, 'OK', 0);
}

/* Destructive Lgto confirm dialog. Right-turn of CLIP K8 / DRUM LANE K8
 * opens this. OK applies; CANCEL aborts. Undoable. */
export function drawLgtoConfirm() {
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
    drawMenuHeader(S.confirmLgtoIsDrum ? 'Lgto (lane)' : 'Lgto (clip)');
    print(4, 16, 'Destructive', 1);
    print(4, 25, 'Proceed?', 1);
    _btn(6,  46, 46, 13, S.confirmLgtoSel === 0, 'OK',     19);
    _btn(58, 46, 64, 13, S.confirmLgtoSel === 1, 'CANCEL', 14);
}

export function drawBakeConfirm() {
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
    if (S.confirmBakeWrapPhase) {
        drawMenuHeader('WRAP TAILS?');
        print(4, 16, 'Wrap delay echoes', 1);
        print(4, 25, 'past clip end back', 1);
        print(4, 34, 'to the beginning?', 1);
        const bW = 38, bH = 13, bY = 50;
        _btn(4,  bY, bW, bH, S.confirmBakeWrapSel === 0, 'YES',    9);
        _btn(45, bY, bW, bH, S.confirmBakeWrapSel === 1, 'NO',    14);
        _btn(86, bY, bW, bH, S.confirmBakeWrapSel === 2, 'CANCEL', 1);
    } else if (S.confirmBakeIsMultiLoop) {
        drawMenuHeader('BAKE FX?');
        print(4, 14, 'Bake N loops of FX', 1);
        print(4, 23, 'chain to clip?', 1);
        const bH = 12, bY = 38;
        _btn(2,  bY, 27, bH, S.confirmBakeSel === 1, '1x',     9);
        _btn(31, bY, 27, bH, S.confirmBakeSel === 2, '2x',     9);
        _btn(60, bY, 27, bH, S.confirmBakeSel === 3, '4x',     9);
        _btn(89, bY, 37, bH, S.confirmBakeSel === 0, 'CANCEL', 3);
    } else if (!S.confirmBakeIsDrum) {
        drawMenuHeader('BAKE FX?');
        print(4, 16, 'Apply effects chain', 1);
        print(4, 25, 'to clip notes and', 1);
        print(4, 34, 'clear the settings.', 1);
        _btn(6,  46, 46, 13, S.confirmBakeSel === 1, 'No',  17);
        _btn(74, 46, 46, 13, S.confirmBakeSel === 0, 'Yes', 14);
    } else if (S.confirmBakeDrumLoopOpen) {
        /* Step 2: loop count selection */
        const modeLabel = S.confirmBakeDrumMode === 1 ? 'LANE' : 'CLIP';
        drawMenuHeader('BAKE DRUMS?');
        print(4, 13, modeLabel + ' — loop count:', 1);
        const mH = 11;
        _btn(14, 33, 100, mH, S.confirmBakeDrumLoopSel === 0, 'CANCEL', 31);
        _btn(4,  47, 36,  mH, S.confirmBakeDrumLoopSel === 1, '1x', 12);
        _btn(46, 47, 36,  mH, S.confirmBakeDrumLoopSel === 2, '2x', 12);
        _btn(88, 47, 36,  mH, S.confirmBakeDrumLoopSel === 3, '4x', 12);
    } else {
        drawMenuHeader('BAKE DRUMS?');
        print(4, 16, 'Bake FX to clip', 1);
        print(4, 25, '(all lanes) or lane?', 1);
        /* 3 buttons: CLIP(0) | LANE(1) | CANCEL(2, default) */
        const bW = 38, bH = 13, bY = 50;
        _btn(4,  bY, bW, bH, S.confirmBakeSel === 0, 'CLIP',   7);
        _btn(45, bY, bW, bH, S.confirmBakeSel === 1, 'LANE',   7);
        _btn(86, bY, bW, bH, S.confirmBakeSel === 2, 'CANCEL', 1);
    }
}

export function drawInheritPicker() {
    clear_screen();
    const p = S.pendingInheritPicker;
    if (!p) return;
    /* Header (two preamble lines + title wrapped to two lines; Move display
     * is 128px wide which only fits ~21 chars at the standard 6px/char font).
     * Tight 8-9px line stride to leave room for the list below. */
    print(2, 2,  'Copied Move set', 1);
    print(2, 10, 'detected',        1);
    fill_rect(0, 18, 128, 1, 1);
    print(2, 20, 'Inherit dAVEBOx', 1);
    print(2, 28, 'state from?',     1);
    fill_rect(0, 36, 128, 1, 1);

    /* List: candidates + 'Start blank' sentinel. Scroll window of 3 around
     * the selected index so 4+ entries still fit. Selection inverts the
     * line; arrows hint at off-screen items. */
    const total = p.candidates.length + 1;
    const visible = 3;
    const sel = p.selectedIndex;
    let top = Math.max(0, Math.min(sel - 1, total - visible));
    if (total <= visible) top = 0;
    const lineH = 9;
    const listTopY = 39;
    for (let i = 0; i < visible && (top + i) < total; i++) {
        const idx = top + i;
        const y = listTopY + i * lineH;
        const isBlank = (idx === p.candidates.length);
        const label = isBlank ? 'Start blank' : p.candidates[idx].name;
        const truncated = label.length > 20 ? label.substring(0, 19) + '…' : label;
        if (idx === sel) {
            fill_rect(2, y - 1, 124, lineH - 1, 1);
            print(5, y, truncated, 0);
        } else {
            print(5, y, truncated, 1);
        }
    }
    /* Scroll indicators */
    if (top > 0)               print(120, listTopY, '^', 1);
    if (top + visible < total) print(120, listTopY + (visible - 1) * lineH, 'v', 1);
}

function snapById(p, id) {
    for (let i = 0; i < p.snaps.length; i++) if (p.snaps[i].id === id) return p.snaps[i];
    return null;
}

/* Yes/No buttons matching the other confirm dialogs (No left, Yes right). */
function drawSnapYesNo(sel) {
    const noX = 6, yesX = 74, btnY = 46, btnW = 46, btnH = 13;
    function btn(x, on, label, off) {
        if (on) { fill_rect(x, btnY, btnW, btnH, 1); print(x + off, btnY + 3, label, 0); }
        else {
            fill_rect(x, btnY, btnW, 1, 1); fill_rect(x, btnY + btnH - 1, btnW, 1, 1);
            fill_rect(x, btnY, 1, btnH, 1); fill_rect(x + btnW - 1, btnY, 1, btnH, 1);
            print(x + off, btnY + 3, label, 1);
        }
    }
    btn(noX, sel === 1, 'No', 17);
    btn(yesX, sel === 0, 'Yes', 14);
}

export function drawSnapshotPicker() {
    clear_screen();
    const p = S.snapshotPicker;
    if (!p) return;

    if (p.confirm) {
        const c = p.confirm;
        if (c.kind === 'wipe') {
            drawMenuHeader('STATES UPDATED');
            print(4, 18, 'Delete ' + c.wipeIds.length + ' snapshot(s)', 1);
            print(4, 27, 'from an older', 1);
            print(4, 36, 'version?', 1);
        } else if (c.kind === 'load') {
            const s = snapById(p, c.targetId);
            drawMenuHeader('LOAD STATE');
            print(4, 18, 'Load ' + (s ? s.label : ''), 1);
            print(4, 27, 'Unsaved changes', 1);
            print(4, 36, 'will be lost.', 1);
        } else {
            const s = snapById(p, c.targetId);
            drawMenuHeader('OVERWRITE');
            print(4, 18, 'Replace', 1);
            print(4, 27, (s ? s.label : '') + '?', 1);
        }
        drawSnapYesNo(c.sel);
        return;
    }

    drawMenuHeader(p.mode === 'overwrite' ? 'OVERWRITE WHICH?' : 'LOAD STATE');
    const total = p.snaps.length;
    const visible = 4;
    const sel = p.sel;
    let top = Math.max(0, Math.min(sel - 1, total - visible));
    if (total <= visible) top = 0;
    const lineH = 9;
    const listTopY = 20;
    for (let i = 0; i < visible && (top + i) < total; i++) {
        const idx = top + i;
        const y = listTopY + i * lineH;
        const s = p.snaps[idx];
        let label = s.label || '';
        if (p.mode === 'load' && s.sv !== STATE_VERSION) label += ' (old)';
        const truncated = label.length > 20 ? label.substring(0, 19) + '…' : label;
        if (idx === sel) {
            fill_rect(2, y - 1, 124, lineH - 1, 1);
            print(5, y, truncated, 0);
        } else {
            print(5, y, truncated, 1);
        }
    }
    if (top > 0)               print(120, listTopY, '^', 1);
    if (top + visible < total) print(120, listTopY + (visible - 1) * lineH, 'v', 1);
}

/* CLEAR AUTOMATION modal — checkable AT / PB(disabled) / CC + a CLEAR action. */
export function drawClearAutoMenu() {
    clear_screen();
    const m = S.clearAutoMenu;
    if (!m) return;
    drawMenuHeader('CLEAR AUTOMATION');
    const rows = [
        { label: 'Aftertouch (AT)',     box: m.at ? '[x]' : '[ ]' },
        { label: 'Pitch bend (PB)',     box: '( )' },   /* placeholder, not selectable */
        { label: 'Control Change (CC)', box: m.cc ? '[x]' : '[ ]' },
        { label: 'CLEAR',  action: true },
        { label: 'Cancel', action: true }
    ];
    const lineH = 9, topY = 18;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const y = topY + i * lineH;
        const seld = (m.sel === i);
        if (seld) fill_rect(2, y - 1, 124, lineH - 1, 1);
        const txt = r.action ? r.label : (r.box + ' ' + r.label);
        print(5, y, txt, seld ? 0 : 1);
    }
}

export function drawBakeSceneConfirm() {
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
    drawMenuHeader('BAKE SCENE?');
    const mH = 11;
    if (S.confirmBakeSceneCondPhase) {
        print(4, 22, 'Apply Conductor?', 1);
        const bY = 47, bW = 36;
        _btn(4,  bY, bW, mH, S.confirmBakeSceneCondSel === 0, 'YES',    9);
        _btn(45, bY, bW, mH, S.confirmBakeSceneCondSel === 1, 'NO',    14);
        _btn(86, bY, bW, mH, S.confirmBakeSceneCondSel === 2, 'CANCEL', 1);
    } else if (S.confirmBakeSceneWrapPhase) {
        print(4, 22, 'Wrap tails?', 1);
        const bY = 47, bW = 36;
        _btn(4,  bY, bW, mH, S.confirmBakeSceneWrapSel === 0, 'YES',    9);
        _btn(45, bY, bW, mH, S.confirmBakeSceneWrapSel === 1, 'NO',    14);
        _btn(86, bY, bW, mH, S.confirmBakeSceneWrapSel === 2, 'CANCEL', 1);
    } else {
        print(4, 22, 'Loop count:', 1);
        _btn(14, 33, 100, mH, S.confirmBakeSceneSel === 0, 'CANCEL', 31);
        _btn(4,  47, 36,  mH, S.confirmBakeSceneSel === 1, '1x', 12);
        _btn(46, 47, 36,  mH, S.confirmBakeSceneSel === 2, '2x', 12);
        _btn(88, 47, 36,  mH, S.confirmBakeSceneSel === 3, '4x', 12);
    }
}

export function drawXposeConfirm() {
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
    drawMenuHeader('TRANSPOSE CLIPS?');
    const tgt = NOTE_KEYS[S.confirmXposeKey] + ' ' + (SCALE_DISPLAY[S.confirmXposeScale] || '?');
    print(4, 22, 'To ' + tgt, 1);
    print(4, 33, 'All melodic clips', 1);
    const mH = 11, bY = 50, bW = 50;
    _btn(4,  bY, bW, mH, S.confirmXposeSel === 0, 'YES', 17);
    _btn(74, bY, bW, mH, S.confirmXposeSel === 1, 'NO',  20);
}

/* ------------------------------------------------------------------ */
/* Snapshots — Save state / Load state                                 */
/* Self-contained modal (S.snapshotPicker), modeled on the inherit     */
/* picker. Confirm dialogs are folded into the picker object so the     */
/* only integration points are draw, jog-rotate, jog-click and close.  */
/* ------------------------------------------------------------------ */

/* Flush live state to disk (deferred 'save') then copy it into snapshot
 * `id` next tick — pendingSnapshotCopy is drained one tick after the save,
 * by which point seq8_save_state has written the file synchronously.
 * Reusing an existing id overwrites that snapshot in place. */
function beginSnapshotSave(id) {
    S.pendingSnapshotCopy = { id: id, label: snapshotLabel() };
    saveState();
}

/* Save state action. Under the cap → new timestamped snapshot. At the cap →
 * open the overwrite picker to choose which existing one to replace. */
export function openSaveSnapshot() {
    if (S.pendingSuspendSave || S.pendingSnapshotCopy) return;  /* save already in flight */
    const snaps = loadSnapshotManifest(S.currentSetUuid);
    if (snaps.length >= SNAPSHOT_CAP) {
        S.snapshotPicker = { mode: 'overwrite', snaps: snaps, sel: 0, confirm: null };
        S.globalMenuOpen = false;
        S.screenDirty = true;
        return;
    }
    beginSnapshotSave(String(Date.now()));
    S.globalMenuOpen = false;
    showActionPopup('STATE', 'SAVED');
}

/* Load state action. Empty → popup. If any snapshots predate the current
 * state version, offer to wipe them before showing the list. */
export function openLoadSnapshot() {
    const snaps = loadSnapshotManifest(S.currentSetUuid);
    if (snaps.length === 0) {
        S.globalMenuOpen = false;
        showActionPopup('NO', 'SNAPSHOTS');
        return;
    }
    const stale = [];
    for (let i = 0; i < snaps.length; i++)
        if (snaps[i].sv !== STATE_VERSION) stale.push(snaps[i].id);
    S.snapshotPicker = { mode: 'load', snaps: snaps, sel: 0, confirm: null };
    if (stale.length > 0)
        S.snapshotPicker.confirm = { kind: 'wipe', sel: 1, wipeIds: stale };
    S.globalMenuOpen = false;
    S.screenDirty = true;
}

export function closeSnapshotPicker() {
    S.snapshotPicker = null;
    S.screenDirty = true;
}

/* Jog rotation inside the picker: toggle a confirm's Yes/No, else move
 * the list selection. */
export function snapshotPickerRotate(delta) {
    const p = S.snapshotPicker;
    if (!p || delta === 0) return;
    if (p.confirm) {
        p.confirm.sel = p.confirm.sel === 0 ? 1 : 0;
    } else {
        const n = p.snaps.length;
        if (n > 0) p.sel = (p.sel + (delta > 0 ? 1 : n - 1)) % n;
    }
    S.screenDirty = true;
}

/* Jog click inside the picker: resolve a confirm, or arm one for the
 * selected entry. */
export function snapshotPickerClick() {
    const p = S.snapshotPicker;
    if (!p) return;
    if (p.confirm) {
        const yes = p.confirm.sel === 0;
        const kind = p.confirm.kind;
        if (kind === 'wipe') {
            if (yes) { p.snaps = dropSnapshots(S.currentSetUuid, p.confirm.wipeIds); p.sel = 0; }
            p.confirm = null;
            if (p.snaps.length === 0) closeSnapshotPicker();
            else S.screenDirty = true;
            return;
        }
        const id = p.confirm.targetId;
        closeSnapshotPicker();
        if (kind === 'load' && yes) {
            applySnapshotToLive(S.currentSetUuid, id);
            S.pendingSetLoad = true;          /* reuse the normal state_load reload path */
            showActionPopup('STATE', 'LOADED');
        } else if (kind === 'overwrite' && yes) {
            beginSnapshotSave(id);            /* reuse id → overwrite in place */
            showActionPopup('STATE', 'SAVED');
        }
        return;
    }
    const snap = p.snaps[p.sel];
    if (!snap) return;
    if (p.mode === 'load') {
        if (snap.sv !== STATE_VERSION) return;   /* incompatible: ignore press */
        p.confirm = { kind: 'load', sel: 1, targetId: snap.id };
    } else {
        p.confirm = { kind: 'overwrite', sel: 1, targetId: snap.id };
    }
    S.screenDirty = true;
}

/* ---- CLEAR AUTOMATION menu (Delete-tap on the AUTO bank) ---- */
export function openClearAutoMenu() {
    S.clearAutoMenu = { sel: 0, at: false, cc: false };
    S.screenDirty = true;
}

export function closeClearAutoMenu() {
    S.clearAutoMenu = null;
    S.screenDirty = true;
}

export function clearAutoMenuRotate(delta) {
    const m = S.clearAutoMenu;
    if (!m || delta === 0) return;
    m.sel = (m.sel + (delta > 0 ? 1 : 4)) % 5;   /* 0=AT 1=PB 2=CC 3=CLEAR 4=Cancel */
    S.screenDirty = true;
}

export function clearAutoMenuClick() {
    const m = S.clearAutoMenu;
    if (!m) return;
    if (m.sel === 0) { m.at = !m.at; }              /* Aftertouch (AT) */
    else if (m.sel === 1) { /* Pitch bend (PB) — placeholder, not selectable */ }
    else if (m.sel === 2) { m.cc = !m.cc; }         /* Control Change (CC) — all CC data */
    else if (m.sel === 4) { closeClearAutoMenu(); return; }   /* Cancel */
    else {                                           /* CLEAR — execute */
        const t = S.activeTrack, c = effectiveClip(t);
        if (m.cc) {
            S.trackCCAutoBits[t][c] = 0;
            S.trackCCLiveVal[t] = new Array(8).fill(-1);
            S.clipCCVal[t][c] = new Array(8).fill(-1);
            S.pendingDefaultSetParams.push({ key: 't' + t + '_cc_auto_clear', val: String(c) });
        }
        if (m.at) {
            S.clipAtHas[t][c] = false;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_c' + c + '_at_clear', val: '1' });
        }
        const done = [];
        if (m.at) done.push('AT');
        if (m.cc) done.push('CC');
        if (done.length) {
            S.undoAvailable = true; S.redoAvailable = false; S.undoSeqArpSnapshot = null;
        }
        closeClearAutoMenu();
        invalidateLEDCache();
        showActionPopup('CLEARED', done.length ? done.join(' ') : 'NOTHING');
        return;
    }
    S.screenDirty = true;
}

/* Open the generic menu INFO dialog with the given text lines (each argument is
 * one line, up to ~4 shown). Empty = closed. */
export function showMenuInfo() {
    S.menuInfoLines = Array.prototype.slice.call(arguments);
    S.screenDirty = true;
}

/* Tear down the Keys->Drums confirm dialog and the menu's edit state so a
 * lingering enum edit doesn't replay. Call on Yes, No, and Back-cancel. */
export function closeConvertConfirm() {
    S.confirmConvertToDrum = false;
    S.confirmConvertToConduct = false;
    S.menuInfoLines = [];
    if (S.globalMenuState) S.globalMenuState.editing = false;
    if (S.globalMenuState) S.globalMenuState.editValue = null;
    S.lastSentMenuEditValue = null;
    S.bpmWasEditing = false;
}

/* Resolve the inherit picker: action is either the candidates index to
 * inherit from, or -1 for "Start blank". Always trigger pendingSetLoad
 * so DSP runs its state_load handler — which both resets the internal
 * state (clip_init, drum_track_init, etc.) and reads the canonical file.
 * For "Start blank" the file is missing on purpose; the reset alone gives
 * a clean slate. For inherit, we copy the source's state files first so
 * the load reads the seeded content. */
export function resolveInheritPicker(action) {
    const p = S.pendingInheritPicker;
    if (!p) return;
    if (action >= 0 && action < p.candidates.length) {
        copyStateFiles(p.candidates[action].uuid, p.dstUuid);
    }
    S.pendingSetLoad = true;
    S.pendingInheritPicker = null;
    S.screenDirty = true;
}
