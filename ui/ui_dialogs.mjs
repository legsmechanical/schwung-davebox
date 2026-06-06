import { S } from '/data/UserData/schwung/modules/tools/davebox/ui_state.mjs';
import { MCUFONT } from '/data/UserData/schwung/modules/tools/davebox/ui_constants.mjs';
import {
    drawMenuHeader, drawMenuList, menuLayoutDefaults
} from '/data/UserData/schwung/shared/menu_layout.mjs';
import { formatItemValue } from '/data/UserData/schwung/shared/menu_items.mjs';

function pixelPrintMcu(x, y, text, scale, color) {
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

function drawTapTempoScreen() {
    clear_screen();
    drawMenuHeader('TAP TEMPO');
    pixelPrintLargeC(64, 22, String(S.tapTempoBpm), 3, 1);
    print(4, 50, 'Tap any pad. Jog=BPM', 1);
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
    if (S.confirmConvertToDrum){ drawConvertToDrumConfirm(); return; }
    if (S.confirmConvertToConduct){ drawConvertToConductConfirm(); return; }
    if (S.menuInfoLines.length > 0){ drawMenuInfo(); return; }
    if (S.confirmExport)       { drawExportConfirm();        return; }
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
