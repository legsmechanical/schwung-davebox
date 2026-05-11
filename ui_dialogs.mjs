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

export function drawGlobalMenu() {
    if (S.tapTempoOpen)        { drawTapTempoScreen();       return; }
    if (S.confirmClearSession) { drawClearSessionConfirm();  return; }
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
