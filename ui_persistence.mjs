import { S, CC_ASSIGN_DEFAULTS } from '/data/UserData/schwung/modules/tools/seq8/ui_state.mjs';
import { NUM_TRACKS, NUM_CLIPS, DRUM_LANES, BANKS, ACTION_POPUP_TICKS } from '/data/UserData/schwung/modules/tools/seq8/ui_constants.mjs';

export function uuidToStatePath(uuid) {
    return uuid
        ? '/data/UserData/schwung/set_state/' + uuid + '/seq8-state.json'
        : '/data/UserData/schwung/seq8-state.json';
}

export function uuidToUiStatePath(uuid) {
    return uuid
        ? '/data/UserData/schwung/set_state/' + uuid + '/seq8-ui-state.json'
        : '/data/UserData/schwung/seq8-ui-state.json';
}

export function showActionPopup(...lines) {
    S.actionPopupHighlight = -1;
    S.actionPopupLines   = lines;
    S.actionPopupEndTick = S.tickCount + ACTION_POPUP_TICKS;
    S.screenDirty = true;
}

export function saveState() {
    if (typeof host_module_set_param === 'function') host_module_set_param('save', '1');
    if (typeof host_write_file === 'function')
        host_write_file(uuidToUiStatePath(S.currentSetUuid), JSON.stringify({
            v: 3, at: S.activeTrack, ac: S.trackActiveClip.slice(), sv: S.sessionView ? 1 : 0,
            dl: S.activeDrumLane.slice(),
            pm: S.perfModsToggled, lm: S.perfLatchMode ? 1 : 0,
            rs: S.perfRecalledSlot, us: S.perfSnapshots.slice(8),
            bm: S.beatMarkersEnabled ? 1 : 0
        }));
}

export function doClearSession() {
    const sp = uuidToStatePath(S.currentSetUuid);
    if (typeof host_write_file === 'function') host_write_file(sp, '{"v":0}');
    if (typeof host_write_file === 'function') host_write_file(uuidToUiStatePath(S.currentSetUuid), '{"v":0}');
    /* Reset JS-only state not covered by S.pendingSetLoad */
    S.activeBank = 0;
    S.undoSeqArpSnapshot = null;
    S.redoSeqArpSnapshot = null;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        for (let _c = 0; _c < NUM_CLIPS; _c++) S.clipSeqFollow[_t][_c] = true;
        S.trackChannel[_t] = 1; S.trackRoute[_t] = 0; S.trackPadMode[_t] = 0;
        S.trackVelOverride[_t] = 0; S.trackLooper[_t] = 1;
        S.trackCCAssign[_t] = CC_ASSIGN_DEFAULTS.slice();
        S.trackCCVal[_t]    = new Array(8).fill(0);
        S.trackCCAutoBits[_t] = new Array(NUM_CLIPS).fill(0);
        S.trackCCLiveVal[_t] = new Array(8).fill(-1);
        for (let _b = 3; _b <= 4; _b++) {
            for (let _k = 0; _k < 8; _k++) {
                const _pm = BANKS[_b].knobs[_k];
                S.bankParams[_t][_b][_k] = _pm ? _pm.def : 0;
            }
        }
        S.drumPerformMode[_t]   = 0;
        S.drumRepeatHeldPad[_t] = -1;
        S.drumRepeatLatched[_t] = false;
        S.drumRepeat2HeldLanes[_t].clear();
        S.drumRepeat2LatchedLanes[_t].clear();
        for (let _l = 0; _l < DRUM_LANES; _l++) S.drumRepeat2RatePerLane[_t][_l] = 0;
        for (let _l = 0; _l < DRUM_LANES; _l++) {
            S.drumRepeatGate[_t][_l] = 0xFF;
            for (let _s = 0; _s < 8; _s++) {
                S.drumRepeatVelScale[_t][_l][_s] = 100;
                S.drumRepeatNudge[_t][_l][_s]    = 0;
            }
        }
    }
    S.ccPaletteCache.fill(-1);
    S.pendingSetLoad  = true;
    S.globalMenuOpen  = false;
    S.confirmClearSession = false;
    showActionPopup('SESSION', 'CLEARED');
}
