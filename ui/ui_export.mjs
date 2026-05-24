/* dAVEBOx → Ableton (.ablbundle) export — orchestration (Phase 1 skeleton).
 *
 * Architecture (see notes/ableton-export-plan.md, Phase 0 RESULT):
 *  - JS builds Song.abl (text JSON — host_write_file is safe for text) + a small
 *    args manifest, then fires a one-shot on-device packager.
 *  - export/pack.py (shipped in the module dir) does the binary work: copy sample
 *    files + build the store-mode .ablbundle ZIP. Invoked via host_system_cmd
 *    (stock Schwung) running /usr/bin/python3 (stock on Move). Fully offline.
 *
 * Phase 1 scope: menu entry + transport guard + a minimal valid 8x16 bundle
 * (every track gets a Dummy Drift instrument — Live rejects a track with no
 * device; 16 empty scenes; tempo from dAVEBOx). No instrument mapping / no baked
 * MIDI / no samples yet (Phases 2-5).
 *
 * The menu action runs in MIDI-handler context where get_param returns null, so
 * exportSession() only sets a pending flag; pollPendingExport() does the work
 * from tick() (get_param-safe), matching the codebase's defer-to-tick idiom.
 */

import { S } from '/data/UserData/schwung/modules/tools/davebox/ui_state.mjs';
import { showActionPopup } from '/data/UserData/schwung/modules/tools/davebox/ui_persistence.mjs';
import { NUM_TRACKS, NUM_CLIPS, ACTION_POPUP_TICKS } from '/data/UserData/schwung/modules/tools/davebox/ui_constants.mjs';

const EXPORT_MODULE_DIR = '/data/UserData/schwung/modules/tools/davebox';
const EXPORT_OUT_DIR    = '/data/UserData/schwung/davebox-exports';
/* Scratch workspace nested under the exports dir (keeps the schwung folder
 * uncluttered); created per export and removed afterward. */
const EXPORT_STAGING    = EXPORT_OUT_DIR + '/staging';
const EXPORT_SCENES     = NUM_CLIPS;   /* dAVEBOx clip N -> scene N */
/* DSP writes per-clip rendered notes here; JS reads them (must match
 * EXPORT_RENDER_PATH in dsp/seq8.c). Inside staging → cleaned with it.
 * Sidesteps the 16KB get_param cap. */
const EXPORT_RENDER_PATH = EXPORT_STAGING + '/render.txt';

/* Source-side reads for route-aware instrument mapping (Phase 2). */
const EXPORT_SETS_BASE_DIR    = '/data/UserData/UserLibrary/Sets';
const CHAIN_CONFIG_PATH = '/data/UserData/schwung/shadow_chain_config.json';

/* Track route values (see fmtRoute in ui_constants). */
const ROUTE_SCHWUNG = 0;
const ROUTE_MOVE    = 1;
const ROUTE_EXT     = 2;

/* dAVEBOx per-track colors → Ableton clip-color palette index, picked by the
 * user (2026-05-24) to match the device track colors. Applied to EVERY exported
 * track by index (Move/Schwung/Ext alike) so the grid always matches the device. */
const DB_TRACK_COLORS = [1, 17, 7, 10, 25, 15, 6, 12];

/* ---- asset loading ------------------------------------------------------- */

function readJsonAsset(name) {
    if (typeof host_read_file !== 'function') return null;
    const raw = host_read_file(EXPORT_MODULE_DIR + '/' + name);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/* Remove the staging workspace. NOT host_remove_dir — that host API rejects any
 * path outside the modules dir (schwung_host.c validate), and staging lives under
 * davebox-exports/. host_system_cmd's `rm ` prefix is allowlisted; the path is a
 * fixed constant (no spaces / no user input). rm -rf is a no-op if absent. */
function removeStagingDir() {
    if (typeof host_system_cmd === 'function')
        host_system_cmd("rm -rf '" + EXPORT_STAGING + "'");
}

/* ---- source-side reads (loaded Move set + Schwung chain config) ----------- */

/* The loaded Move set's Song.abl. The inner folder name equals the active set
 * name (active_set.txt line 2 == S.currentSetName, verified on device). Returns
 * the parsed object, or null if absent/unreadable/too large (4MB host cap;
 * largest real Song.abl observed ~217KB, so plain host_read_file is safe). */
function loadMoveSong() {
    if (typeof host_read_file !== 'function' || !S.currentSetUuid || !S.currentSetName)
        return null;
    const path = EXPORT_SETS_BASE_DIR + '/' + S.currentSetUuid + '/' + S.currentSetName + '/Song.abl';
    if (typeof host_file_exists === 'function' && !host_file_exists(path)) return null;
    const raw = host_read_file(path);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function loadChainConfig() {
    if (typeof host_read_file !== 'function') return null;
    if (typeof host_file_exists === 'function' && !host_file_exists(CHAIN_CONFIG_PATH)) return null;
    const raw = host_read_file(CHAIN_CONFIG_PATH);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

/* Map 0-based MIDI listen-channel -> Move track, from each track's
 * midiInputMode. Move sets store [N]; Note sets store "auto" (skipped). */
function buildMoveChannelMap(moveSong) {
    const map = {};
    if (!moveSong || !Array.isArray(moveSong.tracks)) return map;
    for (const mt of moveSong.tracks) {
        const mim = mt && mt.midiInputMode;
        if (Array.isArray(mim) && mim.length >= 1 && typeof mim[0] === 'number')
            map[mim[0]] = mt;
    }
    return map;
}

/* ---- sample resolution (Phase 5: portable bundling) ---------------------- */

/* Resolve a Move instrument `sampleUri` to its on-disk file, or null if it
 * isn't a bundle-able local pack/user-library reference (presetUri/spriteUri
 * and device-resource URIs are Live-resolved — not passed here, this only sees
 * sampleUri values). URL-decode (%20→space etc.). */
function resolveSampleUri(uri) {
    const CORE = 'ableton:/packs/abl-core-library/';
    const USER = 'ableton:/user-library/';
    let root, rest;
    if (uri.indexOf(CORE) === 0)      { root = '/data/CoreLibrary/';            rest = uri.slice(CORE.length); }
    else if (uri.indexOf(USER) === 0) { root = '/data/UserData/UserLibrary/';   rest = uri.slice(USER.length); }
    else return null;
    let dec;
    try { dec = decodeURIComponent(rest); } catch (e) { dec = rest; }
    return root + dec;
}

/* Assign the bundle-relative dest basename for a source file, deduping so two
 * different sources never collide on one name (and the same source reused
 * across tracks shares one copy). Records {src,dest} in ctx.samples once. */
function assignSampleDest(ctx, src) {
    if (ctx.sampleBySrc[src]) return ctx.sampleBySrc[src];
    const base = src.split('/').pop();
    let dest = base;
    if (ctx.usedDest[dest]) {
        const dot  = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext  = dot > 0 ? base.slice(dot) : '';
        let i = 2;
        while (ctx.usedDest[stem + ' ' + i + ext]) i++;
        dest = stem + ' ' + i + ext;
    }
    ctx.usedDest[dest] = true;
    ctx.sampleBySrc[src] = dest;
    ctx.samples.push({ src: src, dest: dest });
    return dest;
}

/* Walk a (cloned) Move device subtree; for every resolvable `sampleUri`, copy
 * the file into the bundle (via the manifest) and rewrite the ref to the
 * bundle-relative, URL-encoded `Samples/<name>`. Zip entry = decoded name;
 * Live URL-decodes the ref to find it (verified against a real Note bundle).
 * Every reference site is rewritten, even when the source dedupes. */
function collectSamples(node, ctx) {
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) collectSamples(node[i], ctx);
        return;
    }
    if (node && typeof node === 'object') {
        for (const k in node) {
            const v = node[k];
            if (k === 'sampleUri' && typeof v === 'string') {
                /* Resolve every bundle-able ref and rewrite optimistically. We do
                 * NOT host_file_exists() it: the host sandboxes paths to BASE_DIR
                 * (validate_path), so /data/CoreLibrary + /data/UserData/UserLibrary
                 * always read as "missing" from JS. pack.py (unsandboxed python) is
                 * authoritative — it copies what exists and reports the rest in
                 * status.missing. */
                const abs = resolveSampleUri(v);
                if (abs) node[k] = 'Samples/' + encodeURIComponent(assignSampleDest(ctx, abs));
            } else {
                collectSamples(v, ctx);
            }
        }
    }
}

/* ---- per-track instrument + name + color resolution ---------------------- */

/* Resolve a dAVEBOx track to an export instrument subtree, display name, color,
 * and mixer, by its route + channel. Falls back to the Dummy Drift (name
 * "dB N") whenever no concrete source is found. trackChannel is 1-based; Move
 * tracks listen on the 0-based channel (channel-1). */
function resolveTrack(t, ctx) {
    const route = (S.trackRoute && S.trackRoute[t] !== undefined) ? S.trackRoute[t] : ROUTE_SCHWUNG;
    const ch    = (S.trackChannel && S.trackChannel[t]) ? S.trackChannel[t] : (t + 1);  /* 1-based */
    const dbName       = 'dB ' + (t + 1);
    const defaultColor = DB_TRACK_COLORS[t % DB_TRACK_COLORS.length];

    function dummy(name, color) {
        const dev = deepClone(ctx.drift);
        dev.name = name;
        return {
            devices: [dev],
            name: name,
            color: (typeof color === 'number') ? color : defaultColor,
            mixer: null   /* use default track mixer */
        };
    }

    if (route === ROUTE_MOVE) {
        const mt = ctx.moveMap[ch - 1];
        if (mt && Array.isArray(mt.devices) && mt.devices.length >= 1 && mt.devices[0] && mt.devices[0].kind) {
            const preset = mt.devices[0].name || dbName;
            let mixer = null;
            if (mt.mixer) { mixer = deepClone(mt.mixer); mixer.sends = []; }  /* returnTracks is [] */
            const movDevices = deepClone(mt.devices);
            collectSamples(movDevices, ctx);   /* bundle + rewrite sampleUris (Move instruments only) */
            return {
                devices: movDevices,
                name: preset,
                color: defaultColor,   /* dB track color (not the Move track's own color) */
                mixer: mixer
            };
        }
        return dummy(dbName, defaultColor);   /* Move-routed but no matching Move track */
    }

    if (route === ROUTE_SCHWUNG) {
        let name = dbName;
        if (ctx.chainCfg && Array.isArray(ctx.chainCfg.patches)) {
            for (const p of ctx.chainCfg.patches) {
                if (p && p.channel === ch) { name = 'SCH-' + (p.name || ''); break; }
            }
        }
        return dummy(name, defaultColor);
    }

    if (route === ROUTE_EXT) {
        return dummy('Ext ch ' + ch, defaultColor);
    }

    return dummy(dbName, defaultColor);
}

/* Stop-transport notice — held for 2x the normal popup duration so it's easy to
 * read (it's the one popup users hit by accident mid-jam). */
function showStopTransportNotice() {
    showActionPopup('STOP TRANSPORT', 'FOR EXPORT');
    S.actionPopupEndTick = S.tickCount + ACTION_POPUP_TICKS * 2;
}

/* ---- Song.abl authoring -------------------------------------------------- */

function defaultMixer() {
    return { pan: 0.0, 'solo-cue': false, speakerOn: true, volume: 0.6137250661849976, sends: [] };
}

/* Ableton clips forbid two same-pitch notes overlapping (or starting at the
 * same time) — illegal there, though fine as live MIDI. The baked "what you
 * hear" routinely produces these (long gates re-triggered, delay echoes, arp).
 * Legalize: dedupe same-pitch notes at the same start, then clamp each note's
 * duration so it ends just before the next same-pitch onset. Re-attacks (the
 * actual rhythm) are preserved; only the held tail is shortened. */
function legalizeNotes(notes) {
    const EPS = 1e-4;
    const byPitch = {};
    for (let i = 0; i < notes.length; i++) {
        const p = notes[i].noteNumber;
        (byPitch[p] || (byPitch[p] = [])).push(notes[i]);
    }
    const out = [];
    for (const p in byPitch) {
        const ns = byPitch[p].sort(function(a, b) { return a.startTime - b.startTime; });
        for (let i = 0; i < ns.length; i++) {
            const cur = ns[i];
            if (i > 0 && Math.abs(ns[i - 1].startTime - cur.startTime) < EPS) continue;  /* dup onset */
            let nextStart = Infinity;
            for (let j = i + 1; j < ns.length; j++) {
                if (ns[j].startTime > cur.startTime + EPS) { nextStart = ns[j].startTime; break; }
            }
            if (cur.startTime + cur.duration > nextStart - EPS)
                cur.duration = nextStart - cur.startTime - EPS;
            if (cur.duration > 0) out.push(cur);
        }
    }
    out.sort(function(a, b) { return a.startTime - b.startTime; });
    return out;
}

/* Baked notes for one melodic clip via the DSP non-destructive render
 * (tN_cC_export). The DSP writes notes to EXPORT_RENDER_PATH and returns the
 * "<total_ticks> <note_count>" header (no 16KB get_param cap); JS reads the
 * file for the notes. Returns an Ableton clip object, or null for an
 * empty/drum clip (caller makes it an empty slot) or a render/read error. DSP
 * is authoritative — empty clips return count 0. Ticks→beats = ÷96 (1 bar =
 * 384 ticks, 4 beats/bar). Header is "<total_ticks> <count> <cycle_ticks>":
 * total = content extent (region.end), cycle = default loop brace (region.loop.end)
 * — Phase 4b bakes several cycles (random/delay) and parks the brace on cycle 1
 * so the extra content is revealed by dragging the brace open in Live. */
function buildClip(t, c, isDrum) {
    if (typeof host_module_get_param !== 'function' || typeof host_read_file !== 'function')
        return null;
    const key = 't' + t + '_c' + c + (isDrum ? '_export_drum' : '_export');
    const hdr = host_module_get_param(key);
    if (!hdr) return null;
    const parts = hdr.split(' ');
    const span  = parseInt(parts[0], 10) || 0;
    const count = parseInt(parts[1], 10);
    let   cycle = parseInt(parts[2], 10);
    if (!isFinite(cycle) || cycle <= 0) cycle = span;   /* fallback: brace = whole clip */
    if (!isFinite(count) || count <= 0) return null;    /* 0 = empty, -1 = render error */

    const body = host_read_file(EXPORT_RENDER_PATH);
    if (!body) return null;

    const notes = [];
    const toks = body.split(';');
    for (let i = 0; i < toks.length; i++) {
        if (!toks[i]) continue;
        const f = toks[i].split(':');
        if (f.length < 4) continue;
        const tick = parseInt(f[0], 10), pitch = parseInt(f[1], 10),
              vel  = parseInt(f[2], 10), gate  = parseInt(f[3], 10);
        if (!isFinite(tick) || !isFinite(pitch)) continue;
        notes.push({
            noteNumber: pitch,
            startTime: tick / 96,
            duration: Math.max(1, isFinite(gate) ? gate : 1) / 96,
            velocity: isFinite(vel) ? vel : 100,
            offVelocity: 0
        });
    }
    if (notes.length < count)
        showActionPopup('EXPORT WARN', 'CLIP TRUNCATED');   /* should not happen via file */

    const legal = legalizeNotes(notes);   /* remove illegal same-pitch overlaps */
    if (legal.length === 0) return null;

    const endBeats  = (span > 0 ? span : 96) / 96;     /* content extent (N cycles) */
    const loopBeats = (cycle > 0 ? cycle : span) / 96; /* default brace = one cycle */
    return {
        isPlaying: false,
        name: '',
        color: null,
        isEnabled: true,
        timeSignature: { upper: 4, lower: 4 },
        region: { start: 0.0, end: endBeats, loop: { start: 0.0, end: loopBeats, isEnabled: true } },
        grooveId: null,
        stepEditorScrollPosition: 0,
        notes: legal,
        envelopes: []
    };
}

function buildTrack(t, ctx) {
    const r = resolveTrack(t, ctx);
    /* Melodic tracks bake clip notes via _export; drum tracks flatten their
     * polymetric lanes via _export_drum. DSP is authoritative — empty clips
     * return count 0 → empty slot. */
    const isDrum = !!(S.trackPadMode && S.trackPadMode[t] !== 0);
    const clipSlots = [];
    for (let i = 0; i < EXPORT_SCENES; i++) {
        const clip = buildClip(t, i, isDrum);
        clipSlots.push({ hasStop: true, clip: clip });
    }
    return {
        kind: 'midi',
        name: r.name,
        color: r.color,
        isSelected: t === 0,
        clipSlots: clipSlots,
        isNoteRepeatOn: false,
        noteRepeatRate: '1/16',
        noteRepeatArpeggio: { style: 'chordRepeat' },
        uiOctaveIndex: 4,
        midiInputMode: 'auto',
        midiOutputEndpoint: null,
        devices: r.devices,
        mixer: r.mixer || defaultMixer()
    };
}

function buildSong(bpm, ctx) {
    const tracks = [];
    for (let t = 0; t < NUM_TRACKS; t++) tracks.push(buildTrack(t, ctx));
    const scenes = [];
    for (let i = 0; i < EXPORT_SCENES; i++) scenes.push({ name: '', color: null });
    return {
        '$schema': 'http://tech.ableton.com/schema/song/1.8.2/song.json',
        stepEditorResolution: '1/16',
        tempo: bpm,
        globalGrooveAmount: 0.0,
        rootNote: (S.padKey | 0),
        scale: 'Major',           /* TODO Phase 3: map S.padScale -> Ableton scale-name vocab */
        melodicLayout: 'inKey',
        tracks: tracks,
        returnTracks: [],
        masterTrack: ctx.master,
        scenes: scenes,
        grooves: [],
        metadata: { usedFeatures: [] }
    };
}

/* ---- filename helpers ---------------------------------------------------- */

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function dateStamp() {
    const d = new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

/* Filesystem-safe set name; spaces collapsed, exotic chars dropped. */
function sanitizeName(name) {
    const s = (name || '').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim();
    return s || 'davebox';
}

/* <set>-YYYYMMDD.ablbundle, appending -2/-3/... on same-day collisions. */
function uniqueOutPath(base) {
    let p = EXPORT_OUT_DIR + '/' + base + '.ablbundle';
    if (typeof host_file_exists !== 'function' || !host_file_exists(p)) return p;
    for (let i = 2; i < 1000; i++) {
        p = EXPORT_OUT_DIR + '/' + base + '-' + i + '.ablbundle';
        if (!host_file_exists(p)) return p;
    }
    return p;
}

/* ---- public: menu action + confirm + tick drain -------------------------- */

/* Menu action (MIDI-handler context). If transport is running, show the
 * stop-transport notice and bail; otherwise open the Yes/No confirm dialog
 * (rendered inside the open global menu, like Clear Session). */
function requestExport() {
    if (S.playing) {
        S.globalMenuOpen = false;
        showStopTransportNotice();
        return;
    }
    S.confirmExport    = true;
    S.confirmExportSel = 1;     /* default No */
    S.screenDirty      = true;
}

/* Confirm-dialog "Yes" commit (MIDI-handler context). Re-checks transport in
 * case it started while the dialog was open, then arms the deferred export. */
function confirmExportStart() {
    S.confirmExport = false;
    if (S.playing) {
        S.globalMenuOpen = false;
        showStopTransportNotice();
        return;
    }
    S.pendingExport  = true;
    S.globalMenuOpen = false;
    showActionPopup('EXPORTING', '...');
}

/* tick() drain. Two-phase so the "EXPORTING…" popup renders BEFORE the blocking
 * packager call (host_system_cmd waitpid's the python run): phase 1 just shows
 * the popup and arms phase 2 for the next tick; the render between ticks paints
 * EXPORTING; phase 2 does the (blocking) build + pack + report. */
function pollPendingExport() {
    if (S.pendingExport) {
        S.pendingExport    = false;
        S.pendingExportRun = true;
        showActionPopup('EXPORTING', '...');
        S.screenDirty = true;
        return;
    }
    if (!S.pendingExportRun) return;
    S.pendingExportRun = false;
    /* Push the EXPORTING frame to the screen before we block on the packager. */
    if (typeof host_flush_display === 'function') host_flush_display();

    if (typeof host_write_file !== 'function' ||
        typeof host_system_cmd !== 'function' ||
        typeof host_ensure_dir !== 'function') {
        showActionPopup('EXPORT FAIL', 'NO HOST API');
        return;
    }

    /* Tempo: get_param is valid here (tick context). */
    let bpm = 120.0;
    if (typeof host_module_get_param === 'function') {
        const v = parseFloat(host_module_get_param('bpm'));
        if (v > 0 && isFinite(v)) bpm = v;
    }

    const drift  = readJsonAsset('drift-dummy.json');
    const master = readJsonAsset('ableton-master.json');
    if (!drift || !master) {
        showActionPopup('EXPORT FAIL', 'NO TEMPLATE');
        return;
    }

    /* Route-aware instrument/name/color sources (Phase 2). Missing sources
     * degrade gracefully — every track still gets the Dummy Drift + dB N. */
    const ctx = {
        drift: drift,
        master: master,
        moveMap: buildMoveChannelMap(loadMoveSong()),
        chainCfg: loadChainConfig(),
        samples: [],          /* {src,dest} manifest → pack.py copies into Samples/ */
        sampleBySrc: {},      /* src → dest (dedupe shared samples) */
        usedDest: {}          /* dest names taken (avoid basename collisions) */
    };

    /* Fresh staging dir FIRST — buildSong's render writes EXPORT_RENDER_PATH
     * (inside staging) via the DSP, so the dir must exist before the render. */
    host_ensure_dir(EXPORT_OUT_DIR);
    removeStagingDir();
    host_ensure_dir(EXPORT_STAGING);

    let songJson;
    try {
        songJson = JSON.stringify(buildSong(bpm, ctx));
    } catch (e) {
        showActionPopup('EXPORT FAIL', 'BUILD');
        return;
    }

    if (!host_write_file(EXPORT_STAGING + '/Song.abl', songJson)) {
        showActionPopup('EXPORT FAIL', 'WRITE SONG');
        return;
    }

    const base    = sanitizeName(S.currentSetName) + '-' + dateStamp();
    const outPath = uniqueOutPath(base);
    const statusP = EXPORT_STAGING + '/pack-status.json';

    const args = {
        staging: EXPORT_STAGING,
        out: outPath,
        samples: ctx.samples,   /* {src,dest} resolved from Move instrument sampleUris */
        status: statusP
    };
    host_write_file(EXPORT_STAGING + '/pack-args.json', JSON.stringify(args));

    /* Only fixed, space-free paths appear on the shell command line; the set
     * name (which may contain spaces) lives inside pack-args.json. */
    const cmd = "sh -c '/usr/bin/python3 " + EXPORT_MODULE_DIR +
                "/pack.py " + EXPORT_STAGING + "/pack-args.json'";
    const rc = host_system_cmd(cmd);

    let okStatus = null, errMsg = null;
    const st = host_read_file(statusP);
    if (st) {
        try {
            const s = JSON.parse(st);
            if (s && s.ok) okStatus = s;
            else errMsg = (s && s.error) ? String(s.error) : 'PACK ERR';
        } catch (e) { errMsg = 'BAD STATUS'; }
    } else {
        errMsg = 'NO STATUS rc=' + rc;
    }

    /* Clean up the scratch workspace (Song.abl + manifest + copied Samples/) —
     * the finished bundle lives in EXPORT_OUT_DIR; staging is no longer needed. */
    removeStagingDir();

    if (okStatus) {
        /* Persistent "Exported to <path>" dialog — stays up until the user OKs it
         * (reuses the global-menu dialog machinery: re-open the menu in dialog mode). */
        S.exportDonePath    = String(okStatus.out || outPath);
        S.exportDoneMissing = (okStatus.missing && okStatus.missing.length) ? okStatus.missing.length : 0;
        S.exportDoneDialog  = true;
        S.globalMenuOpen    = true;
        S.screenDirty       = true;
    } else {
        showActionPopup('EXPORT FAIL', String(errMsg).slice(0, 18));
    }
}

export { requestExport, confirmExportStart, pollPendingExport };
