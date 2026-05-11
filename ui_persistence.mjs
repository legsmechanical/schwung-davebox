import { S, CC_ASSIGN_DEFAULTS } from '/data/UserData/schwung/modules/tools/davebox/ui_state.mjs';
import { NUM_TRACKS, NUM_CLIPS, DRUM_LANES, BANKS, ACTION_POPUP_TICKS } from '/data/UserData/schwung/modules/tools/davebox/ui_constants.mjs';

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

const NAME_INDEX_PATH = '/data/UserData/schwung/seq8_name_index.json';
const SET_STATE_DIR   = '/data/UserData/schwung/set_state';
const ACTIVE_SET_PATH = '/data/UserData/schwung/active_set.txt';

/* Read /data/UserData/schwung/active_set.txt: line 1 = UUID, line 2 = name. */
export function readActiveSet() {
    if (typeof host_read_file !== 'function') return { uuid: '', name: '' };
    try {
        const raw = host_read_file(ACTIVE_SET_PATH);
        if (!raw) return { uuid: '', name: '' };
        const lines = raw.split('\n');
        return {
            uuid: (lines[0] || '').trim(),
            name: (lines[1] || '').trim()
        };
    } catch (e) {
        return { uuid: '', name: '' };
    }
}

/* Move's Copy/Paste appends " Copy" (first) or " Copy N" (subsequent) to the
 * inner set folder name. Strip one level; returns null if no suffix matched. */
export function stripCopySuffix(name) {
    const m = (name || '').match(/^(.*?)\s+Copy(?:\s+\d+)?\s*$/);
    return m ? m[1].trimEnd() : null;
}

/* Lazy-loaded name -> uuid map; survives across saves via S.nameIndexCache. */
export function loadNameIndex() {
    if (typeof host_read_file !== 'function') return {};
    if (typeof host_file_exists === 'function' && !host_file_exists(NAME_INDEX_PATH))
        return {};
    try {
        const raw = host_read_file(NAME_INDEX_PATH);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
        return {};
    }
}

export function saveNameIndex(idx) {
    if (typeof host_write_file !== 'function') return false;
    return host_write_file(NAME_INDEX_PATH, JSON.stringify(idx));
}

/* Copy seq8-state.json + seq8-ui-state.json from one UUID folder to another.
 * Used on first launch in a freshly-pasted Move set so the duplicate inherits
 * the source's SEQ8 state. Returns true if the state file was copied. */
export function copyStateFiles(srcUuid, dstUuid) {
    if (!srcUuid || !dstUuid) return false;
    if (typeof host_read_file !== 'function' || typeof host_write_file !== 'function')
        return false;
    if (typeof host_file_exists !== 'function') return false;
    const srcSt = uuidToStatePath(srcUuid);
    if (!host_file_exists(srcSt)) return false;
    if (typeof host_ensure_dir === 'function')
        host_ensure_dir(SET_STATE_DIR + '/' + dstUuid);
    const stContents = host_read_file(srcSt);
    if (!stContents) return false;
    host_write_file(uuidToStatePath(dstUuid), stContents);
    const srcUi = uuidToUiStatePath(srcUuid);
    if (host_file_exists(srcUi)) {
        const uiContents = host_read_file(srcUi);
        if (uiContents) host_write_file(uuidToUiStatePath(dstUuid), uiContents);
    }
    return true;
}

function escapeForRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SETS_BASE_DIR = '/data/UserData/UserLibrary/Sets';

/* All known family members whose state file AND backing Move set still
 * exist, for the inherit picker. Family = the suffix-stripped base name
 * OR base + " Copy [N]". Sorted: base name first, then by length, then
 * alpha. Excludes the currently-active set itself so the picker never
 * offers a no-op. Skipping deleted Move sets keeps the picker honest —
 * the state file may linger on disk if the orphan prune hasn't run yet. */
export function findInheritCandidates(currentName, idx) {
    const base = stripCopySuffix(currentName);
    if (!base) return [];
    if (typeof host_file_exists !== 'function') return [];
    const famRe = new RegExp('^' + escapeForRegex(base) + '(?:\\s+Copy(?:\\s+\\d+)?)?$');
    const out = [];
    for (const name in idx) {
        if (name === currentName) continue;
        if (!famRe.test(name)) continue;
        const uuid = idx[name];
        if (!uuid) continue;
        if (!host_file_exists(uuidToStatePath(uuid))) continue;
        if (!host_file_exists(SETS_BASE_DIR + '/' + uuid)) continue;
        out.push({ uuid: uuid, name: name });
    }
    out.sort(function(a, b) {
        if (a.name === base) return -1;
        if (b.name === base) return 1;
        if (a.name.length !== b.name.length) return a.name.length - b.name.length;
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return out;
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
