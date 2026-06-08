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

/* Write the sidecar synchronously. Split out of saveState so bank-change
 * sites can persist immediately without scheduling a DSP save. */
export function writeSidecar() {
    /* Always sync the live activeBank into per-track storage before serializing. */
    S.trackActiveBank[S.activeTrack] = S.activeBank;
    if (typeof host_write_file === 'function')
        host_write_file(uuidToUiStatePath(S.currentSetUuid), JSON.stringify({
            v: 9, at: S.activeTrack, ac: S.trackActiveClip.slice(), sv: S.sessionView ? 1 : 0,
            dl: S.activeDrumLane.slice(),
            pm: S.perfModsToggled, lm: S.perfLatchMode ? 1 : 0,
            rs: S.perfRecalledSlot, us: S.perfSnapshots.slice(8),
            bm: S.beatMarkersEnabled ? 1 : 0,
            dva: S.drumVelZoneArmed.slice(),
            dleu: S.drumLaneEuclidN.map(function(lane) { return lane.slice(); }),
            to: S.trackOctave.slice(),
            tab: S.trackActiveBank.slice(),
            am: S.trackAtMode.slice(),
            pchr: S.padLayoutChromatic.map(function(b) { return b ? 1 : 0; })
        }));
}

export function saveState() {
    S.altMode = false;   /* transient; never persisted across suspend/resume */
    /* Route the DSP save through the end-of-tick pendingSuspendSave drain so it
     * cannot be coalesced by other set_params fired in the same audio buffer
     * (Quit / Shift+Back / Save menu / co-run handoff all call this from
     * MIDI-handler context). Sidecar write stays synchronous via writeSidecar(). */
    S.pendingSuspendSave = true;
    writeSidecar();
}

/* ------------------------------------------------------------------ */
/* Snapshots — explicit, user-named-by-timestamp save/load states.    */
/* Stored as flat files alongside the live state in the set's UUID     */
/* folder (set_state/<uuid>/). Manifest (seq8-snap-index.json) is the  */
/* authoritative list — there is no host_list_dir, and host_remove_dir */
/* is not permitted under set_state, so we never enumerate or delete    */
/* folders. Overwrite rewrites a file in place; wipe drops manifest     */
/* entries and best-effort stubs the orphaned files (cannot unlink).    */
/* ------------------------------------------------------------------ */

export const SNAPSHOT_CAP = 16;
const SNAP_MANIFEST_VER = 1;

function snapBaseDir(uuid) {
    return uuid ? SET_STATE_DIR + '/' + uuid : '/data/UserData/schwung';
}
function snapManifestPath(uuid) { return snapBaseDir(uuid) + '/seq8-snap-index.json'; }
function snapStatePath(uuid, id) { return snapBaseDir(uuid) + '/seq8-snap-' + id + '-state.json'; }
function snapUiStatePath(uuid, id) { return snapBaseDir(uuid) + '/seq8-snap-' + id + '-ui-state.json'; }

/* "MM-DD HH:MM" label from a Date (defaults to now). */
export function snapshotLabel(d) {
    d = d || new Date();
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
           p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/* Read top-level "v" (state version) out of a serialized state blob. */
function parseStateVersion(raw) {
    try { const o = JSON.parse(raw); return (o && typeof o.v === 'number') ? o.v : 0; }
    catch (e) { return 0; }
}

/* Returns the snapshot list (newest-first) for a set, or []. */
export function loadSnapshotManifest(uuid) {
    if (typeof host_read_file !== 'function') return [];
    const p = snapManifestPath(uuid);
    if (typeof host_file_exists === 'function' && !host_file_exists(p)) return [];
    try {
        const obj = JSON.parse(host_read_file(p) || '');
        const arr = (obj && Array.isArray(obj.snaps)) ? obj.snaps : [];
        arr.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
        return arr;
    } catch (e) { return []; }
}

function writeSnapshotManifest(uuid, snaps) {
    if (typeof host_write_file !== 'function') return false;
    return host_write_file(snapManifestPath(uuid),
        JSON.stringify({ v: SNAP_MANIFEST_VER, snaps: snaps }));
}

/* Copy the (just-saved) live state files into a snapshot identified by id,
 * and update the manifest. Reusing an existing id overwrites in place.
 * Call AFTER the DSP 'save' has flushed live state to disk. */
export function commitSnapshot(uuid, id, label) {
    if (typeof host_read_file !== 'function' || typeof host_write_file !== 'function')
        return false;
    const srcSt = uuidToStatePath(uuid);
    if (typeof host_file_exists === 'function' && !host_file_exists(srcSt)) return false;
    const stContents = host_read_file(srcSt);
    if (!stContents) return false;
    host_write_file(snapStatePath(uuid, id), stContents);
    const srcUi = uuidToUiStatePath(uuid);
    if (typeof host_file_exists === 'function' && host_file_exists(srcUi)) {
        const uiContents = host_read_file(srcUi);
        if (uiContents) host_write_file(snapUiStatePath(uuid, id), uiContents);
    }
    let snaps = loadSnapshotManifest(uuid).filter(function(s) { return s.id !== id; });
    /* ts = save time (now), NOT the id: on overwrite the id is reused (old
     * timestamp) but the snapshot should sort/display as freshly saved. */
    snaps.unshift({
        id: id,
        ts: Date.now(),
        label: label,
        sv: parseStateVersion(stContents)
    });
    writeSnapshotManifest(uuid, snaps);
    return true;
}

/* Copy a snapshot's files over the live state files, so the normal
 * state_load reload path (pendingSetLoad) restores them. */
export function applySnapshotToLive(uuid, id) {
    if (typeof host_read_file !== 'function' || typeof host_write_file !== 'function')
        return false;
    const snSt = snapStatePath(uuid, id);
    if (typeof host_file_exists === 'function' && !host_file_exists(snSt)) return false;
    const stContents = host_read_file(snSt);
    if (!stContents) return false;
    host_write_file(uuidToStatePath(uuid), stContents);
    const snUi = snapUiStatePath(uuid, id);
    if (typeof host_file_exists === 'function' && host_file_exists(snUi)) {
        const uiContents = host_read_file(snUi);
        if (uiContents) host_write_file(uuidToUiStatePath(uuid), uiContents);
    }
    return true;
}

/* Drop the given snapshot ids from the manifest. Files can't be unlinked
 * from JS (no host API; host_remove_dir is disallowed under set_state), so
 * we best-effort stub the orphaned files to reclaim space. Returns the
 * surviving snapshot list. */
export function dropSnapshots(uuid, ids) {
    const idset = {};
    for (let i = 0; i < ids.length; i++) idset[ids[i]] = true;
    if (typeof host_write_file === 'function') {
        for (let i = 0; i < ids.length; i++) {
            host_write_file(snapStatePath(uuid, ids[i]), '{}');
            host_write_file(snapUiStatePath(uuid, ids[i]), '{}');
        }
    }
    const snaps = loadSnapshotManifest(uuid).filter(function(s) { return !idset[s.id]; });
    writeSnapshotManifest(uuid, snaps);
    return snaps;
}

export function doClearSession() {
    const sp = uuidToStatePath(S.currentSetUuid);
    if (typeof host_write_file === 'function') host_write_file(sp, '{"v":0}');
    if (typeof host_write_file === 'function') host_write_file(uuidToUiStatePath(S.currentSetUuid), '{"v":0}');
    /* Reset JS-only state not covered by S.pendingSetLoad */
    S.activeBank = 0;
    for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackActiveBank[_t] = 0;
    S.undoSeqArpSnapshot = null;
    S.redoSeqArpSnapshot = null;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        for (let _c = 0; _c < NUM_CLIPS; _c++) S.clipSeqFollow[_t][_c] = true;
        S.trackChannel[_t] = 1; S.trackRoute[_t] = 0; S.trackPadMode[_t] = 0;
        S.trackVelOverride[_t] = 0; S.trackLooper[_t] = 1;
        S.trackOctave[_t] = 0;
        S.drumVelZoneArmed[_t] = false;
        S.trackCCAssign[_t] = CC_ASSIGN_DEFAULTS.slice();
        S.trackCCType[_t]   = new Array(8).fill(0);
        S.clipCCVal[_t]     = Array.from({length: NUM_CLIPS}, () => new Array(8).fill(-1));
        S.trackCCAutoBits[_t] = new Array(NUM_CLIPS).fill(0);
        S.trackCCLiveVal[_t] = new Array(8).fill(-1);
        S.ccActiveLane[_t]  = 0;
        for (var _c2 = 0; _c2 < NUM_CLIPS; _c2++)
            for (var _k = 0; _k < 8; _k++) {
                S.ccLaneLoopStart[_t][_c2][_k] = 0;
                S.ccLaneLength[_t][_c2][_k]    = 0;
                S.ccLaneTps[_t][_c2][_k]       = 0;
            }
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
        for (let _l = 0; _l < DRUM_LANES; _l++) S.drumLaneEuclidN[_t][_l] = 0;
        for (let _l = 0; _l < DRUM_LANES; _l++) {
            S.drumRepeatGate[_t][_l] = 0xFF;
            for (let _s = 0; _s < 8; _s++) {
                S.drumRepeatVelScale[_t][_l][_s] = 100;
                S.drumRepeatNudge[_t][_l][_s]    = 0;
            }
        }
        S.trackAtMode[_t]              = 0;
        S.trackMuted[_t]               = false;
        S.trackSoloed[_t]              = false;
        S.drumLaneMute[_t]             = 0;
        S.drumLaneSolo[_t]             = 0;
        S.noteFXRandomMode[_t]         = 2;
        S.midiDlyRandomMode[_t]        = 2;
        S.lastTarpStyle[_t]            = 1;
        S.clipAdaptiveMode[_t]         = new Array(NUM_CLIPS).fill(false);
        S.clipLengthManuallySet[_t]    = new Array(NUM_CLIPS).fill(false);
        S.drumLaneLengthManuallySet[_t] = false;
    }
    S.sessionView          = false;
    S.beatMarkersEnabled   = true;
    S.perfModsToggled      = 0;
    S.perfLatchMode        = true;
    S.perfRecalledSlot     = -1;
    for (let _i = 8; _i < 16; _i++) S.perfSnapshots[_i] = 0;
    S.swingAmt             = 0;
    S.swingRes             = 0;
    S.launchQuant          = 0;
    S.midiInChannel        = 0;
    S.metronomeOn          = 1;
    S.inpQuant             = false;
    S.pendingSetLoad  = true;
    S.globalMenuOpen  = false;
    S.confirmClearSession = false;
    showActionPopup('SESSION', 'CLEARED');
}
