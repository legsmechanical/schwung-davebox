/* ui_dsp_bridge.mjs
 * Single JS-side owner of the DSP↔JS contract: polling DSP state into the S
 * mirrors (pollDSP), the read/apply/refresh param-bank family, the clip/mute
 * sync family, sidecar restore, and tick-batched live-note dispatch. This
 * module localizes the three contract rules every DSP touch must respect:
 *   1. host_module_get_param returns null outside tick/render context —
 *      pollDSP (called from tick) is the only legal reader; MIDI handlers
 *      read the S mirrors instead (e.g. S.bpmMirror).
 *   2. Only the LAST host_module_set_param per audio buffer survives —
 *      writes that can share a buffer must be deferred via the pending
 *      queues (pendingLiveNotes here, S.pendingDefaultSetParams in tick).
 *   3. New global param keys are silently dropped by the host — new state
 *      must piggyback on existing tN_-prefixed per-track keys.
 * The queued targeted-sync/param-batching follow-up (full-sync freeze board
 * item) slots here once designed — syncClipsFromDsp is its surface.
 * Extracted from ui.js (Phase 6a of the modularity refactor, increment 1).
 */

import {
    setButtonLED
} from '/data/UserData/schwung/shared/input_filter.mjs';

import {
    NUM_TRACKS, NUM_CLIPS, NUM_STEPS, DRUM_LANES,
    TPS_VALUES, BANKS, PAD_MODE_DRUM,
    MoveRec, LED_OFF, parseActionRaw
} from './ui_constants.mjs';
import { Red } from '/data/UserData/schwung/shared/constants.mjs';

import { S, CC_ASSIGN_DEFAULTS } from './ui_state.mjs';
import { clipHasContent, _clipIsEmpty } from './ui_pure.mjs';
import { showActionPopup, writeSidecar, uuidToStatePath, uuidToUiStatePath,
    updateNameIndex } from './ui_persistence.mjs';
import { computePadNoteMap, setActiveDrumLane, syncDrumClipContent,
    syncDrumLaneSteps, syncDrumLanesMeta, syncDrumRepeatState } from './ui_drummodel.mjs';
import { effectiveClip, forceRedraw, invalidateLEDCache } from './ui_leds.mjs';
import { sessionHasAnyContent } from './ui_scene.mjs';
import { exitSchwungCoRun, exitMoveNativeCoRun,
    CORUN_TARGET_CHAIN_EDIT, CORUN_TARGET_MOVE_NATIVE } from './ui_corun.mjs';
/* Intentional ES-module cycle with ui_record.mjs (it imports liveSendNote +
 * the drum-rec arrays from here) — safe because both sides reference the
 * cycled bindings only inside function bodies, never at module-init time.
 * Keep it that way: no top-level use of anything from this import. */
import { disarmRecord } from './ui_record.mjs';

const pendingLiveNotes = Array.from({length: NUM_TRACKS}, () => []);  /* buffered live notes flushed each tick */
export const pendingDrumNoteOffs = Array.from({length: NUM_TRACKS}, () => []);  /* drum tap note-offs deferred 1 tick to avoid coalescing with note-on */
export const _drumRecNoteOns  = [];  /* { track, laneNote, vel, ext? } — queued drum recording note-ons (ext = external-MIDI origin) */
export const _drumRecNoteOffs = [];  /* { track, laneNote, ext? } — queued drum recording note-offs */

/* Per-clip banks: NOTE FX (2), HARMZ (3), SEQ ARP (4), MIDI DLY (5) */
const PER_CLIP_BANKS  = [1, 2, 3, 4];

/* ------------------------------------------------------------------ */
/* Refresh / read helpers (per-clip banks, drum lanes, tarp, repeat)    */
/* ------------------------------------------------------------------ */

/* Immediately refresh S.seqActiveNotes for the given step if it is the current
 * sequencer position on the active track — call after any step state change. */
export function refreshSeqNotesIfCurrent(t, ac, absIdx) {
    if (absIdx !== S.trackCurrentStep[t] || ac !== S.trackActiveClip[t]) return;
    S.seqActiveNotes.clear();
    S.seqLastStep = -1;
    S.seqNoteOnClipTick = -1;
    if (S.clipSteps[t][ac][absIdx] && typeof host_module_get_param === 'function') {
        const r = host_module_get_param('t' + t + '_c' + ac + '_step_' + absIdx + '_notes');
        if (r && r.trim().length > 0)
            r.trim().split(' ').forEach(function(sn) {
                const p = parseInt(sn, 10);
                if (p >= 0 && p <= 127) S.seqActiveNotes.add(p);
            });
    }
}

/* Read per-clip bank params from DSP into S.bankParams for track t.
 * Reads from clip[active_clip].pfx_params directly — immune to pfx_sync timing. */
export function refreshDrumLaneBankParams(t, lane) {
    if (typeof host_module_get_param !== 'function') return;
    const snap = host_module_get_param('t' + t + '_l' + lane + '_pfx_snapshot');
    if (snap) {
        const v = snap.split(' ');
        if (v.length >= 9) {
            /* NOTE FX bank (1): gate_time, vel_offset, quantize */
            S.bankParams[t][1][0] = parseInt(v[0], 10) | 0;  /* Gate */
            S.bankParams[t][1][1] = parseInt(v[1], 10) | 0;  /* Vel  */
            S.bankParams[t][1][2] = parseInt(v[2], 10) | 0;  /* Qnt  */
            S.drumLaneQnt[t]      = S.bankParams[t][1][2];
            /* MIDI DLY bank (3): delay_time_idx, delay_level, repeat_times,
               fb_velocity, fb_gate_time, fb_clock at v[3..8]; delay_retrig at v[9]
               (K6 of the drum delay bank layout). */
            for (let k = 0; k < 6; k++) S.bankParams[t][3][k] = parseInt(v[3 + k], 10) | 0;
            if (v.length >= 10) S.bankParams[t][3][6] = parseInt(v[9], 10) | 0;
            /* NOTE FX K5 Len mode (v[10]) — per-lane mirror. */
            if (v.length >= 11) S.drumLaneLenMode[t][lane] = parseInt(v[10], 10) | 0;
        }
    }
    /* DRUM LANE bank (0): Res (K1=idx0), Eucl (K5=idx4), Dir (K7=idx6),
     * SqFl (K8=idx7) per-lane meta. */
    const tpsIdx = TPS_VALUES.indexOf(S.drumLaneTPS[t]);
    S.bankParams[t][0][0] = tpsIdx >= 0 ? tpsIdx : 1;
    S.bankParams[t][0][4] = S.drumLaneEuclidN[t][lane] | 0;
    {
        const _pd = host_module_get_param('t' + t + '_l' + lane + '_playback_dir');
        const _pdv = parseInt(_pd, 10);
        const _pdvi = (isFinite(_pdv) && _pdv >= 0 && _pdv <= 3) ? _pdv : 0;
        S.drumLanePlaybackDir[t][lane] = _pdvi;
        S.bankParams[t][0][6] = _pdvi;
        const _par = host_module_get_param('t' + t + '_l' + lane + '_playback_audio_reverse');
        const _parv = parseInt(_par, 10);
        S.drumLanePlaybackAudioReverse[t][lane] = (isFinite(_parv) && _parv === 1) ? 1 : 0;
    }
    S.bankParams[t][0][7] = S.clipSeqFollow[t][S.trackActiveClip[t]] ? 1 : 0;
    /* Repeat Groove state for this lane */
    syncDrumRepeatState(t, lane);
    S.screenDirty = true;
}

/* Full drum-track resync after a track switch: lane metadata (MIDI notes,
 * mute/solo), the active lane's step pattern, clip non-empty dots, and bank
 * params. The two track-switch entry points (Shift+pad, Shift+jog) must both
 * call this so a drum track that changed while inactive (e.g. a clip launched
 * from Session View) doesn't show stale steps/notes/dots. */
export function resyncDrumTrack(t) {
    syncDrumLanesMeta(t);
    syncDrumLaneSteps(t, S.activeDrumLane[t]);
    syncDrumClipContent(t);
    refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
}

export function refreshPerClipBankParams(t) {
    if (typeof host_module_get_param !== 'function') return;
    if (S.trackPadMode[t] === PAD_MODE_DRUM) {
        refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        return;
    }
    const ac   = S.trackActiveClip[t];
    const snap = host_module_get_param('t' + t + '_c' + ac + '_pfx_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 17) return;
    /* NOTE FX bank (1): K1=Oct K2=Ofs K3=Vel K4=Qnt K5=Len K6=Gate K7=blocked K8=Rnd
     * (DSP snapshot still emits v[] in original order oct/ofs/gate/vel/qnt + rnd at v[31].) */
    S.bankParams[t][1][0] = parseInt(v[0], 10) | 0;  /* K1 = Oct */
    S.bankParams[t][1][1] = parseInt(v[1], 10) | 0;  /* K2 = Ofs */
    S.bankParams[t][1][2] = parseInt(v[3], 10) | 0;  /* K3 = Vel */
    S.bankParams[t][1][3] = parseInt(v[4], 10) | 0;  /* K4 = Qnt */
    /* K5 = Len mode at v[43] (appended after seq_arp_step_loop_len at v[42]) */
    S.bankParams[t][1][4] = v.length >= 44 ? (parseInt(v[43], 10) | 0) : 0;
    S.bankParams[t][1][5] = parseInt(v[2], 10) | 0;  /* K6 = Gate */
    /* K7 (idx 6) = blocked — leave at 0 */
    /* NOTE FX random + modes packed at v[31..33] (right after step_vel[0..7] = v[23..30]) */
    S.bankParams[t][1][7] = v.length >= 32 ? (parseInt(v[31], 10) | 0) : 0; /* K8 = Rnd */
    S.noteFXRandomMode[t]  = v.length >= 33 ? (parseInt(v[32], 10) | 0) : 2;
    S.midiDlyRandomMode[t] = v.length >= 34 ? (parseInt(v[33], 10) | 0) : 2;
    /* HARMZ bank (2): K0=oct K1=hrm1 K2=hrm2 K3=hrm3 (Unis retired in state v=33) */
    for (let k = 0; k < 4; k++) S.bankParams[t][2][k] = parseInt(v[5 + k], 10) | 0;
    /* MIDI DLY bank (3): K0=dly K1=lvl K2=rep K3=vfb K4=pfb K5=gfb K6=retrg K7=rnd
     * (delay_clock_fb moved to Shift+K1 alt — read separately via tN_delay_clock_fb). */
    for (let k = 0; k < 8; k++) S.bankParams[t][3][k] = parseInt(v[9 + k], 10) | 0;
    /* SEQ ARP bank (4): K0=style K1=rate K2=oct K3=gate K4=steps K5=retrigger (length-aware) */
    if (v.length >= 23) {
        for (let k = 0; k < 6; k++) S.bankParams[t][4][k] = parseInt(v[17 + k], 10) | 0;
    }
    /* step_vel[0..7] when present (length-aware) */
    if (v.length >= 31) {
        for (let s = 0; s < 8; s++) S.seqArpStepVel[t][ac][s] = parseInt(v[23 + s], 10) | 0;
    }
    /* step_int[0..7] at v[34..41] (scale-degree offsets for Arp Steps interval mode) */
    if (v.length >= 42) {
        for (let s = 0; s < 8; s++) S.seqArpStepInt[t][ac][s] = parseInt(v[34 + s], 10) | 0;
    }
    /* step_loop_len at v[42] (1..8) */
    if (v.length >= 43) {
        const _ll = parseInt(v[42], 10) | 0;
        S.seqArpStepLoopLen[t][ac] = (_ll >= 1 && _ll <= 8) ? _ll : 8;
    }
    /* CLIP bank (0): Res (K1=idx0), Dir (K7=idx6), SqFl (K8=idx7) — all per-clip. */
    const tps    = S.clipTPS[t][ac] || 24;
    const tpsIdx = TPS_VALUES.indexOf(tps);
    S.bankParams[t][0][0] = tpsIdx >= 0 ? tpsIdx : 1;
    {
        const _pd = host_module_get_param('t' + t + '_clip_playback_dir');
        const _pdv = parseInt(_pd, 10);
        const _pdvi = (isFinite(_pdv) && _pdv >= 0 && _pdv <= 3) ? _pdv : 0;
        S.clipPlaybackDir[t][ac] = _pdvi;
        S.bankParams[t][0][6] = _pdvi;
        const _par = host_module_get_param('t' + t + '_clip_playback_audio_reverse');
        const _parv = parseInt(_par, 10);
        S.clipPlaybackAudioReverse[t][ac] = (isFinite(_parv) && _parv === 1) ? 1 : 0;
    }
    S.bankParams[t][0][7] = S.clipSeqFollow[t][ac] ? 1 : 0;
    S.screenDirty = true;
}

/* Read TRACK ARP step_vel[8] from DSP for track t. Called on init and track switch. */
function readTarpStepVel(t) {
    if (typeof host_module_get_param !== 'function') return;
    const raw = host_module_get_param('t' + t + '_tarp_sv');
    if (!raw) return;
    const v = raw.split(' ');
    for (let s = 0; s < 8; s++)
        S.tarpStepVel[t][s] = parseInt(v[s], 10) | 0;
    /* Also pull step_int[8] (Arp Steps interval mode). */
    const rawI = host_module_get_param('t' + t + '_tarp_si');
    if (rawI) {
        const vi = rawI.split(' ');
        for (let s = 0; s < 8; s++)
            S.tarpStepInt[t][s] = parseInt(vi[s], 10) | 0;
    }
    /* Step pattern loop length (1..8). */
    const rawL = host_module_get_param('t' + t + '_tarp_sll');
    if (rawL !== null && rawL !== undefined) {
        const _ll = parseInt(rawL, 10) | 0;
        S.tarpStepLoopLen[t] = (_ll >= 1 && _ll <= 8) ? _ll : 8;
    }
}

/* Read Rpt2 per-lane rate idx[32] from DSP for track t. Called after state
 * load so the rate-pad LED highlight matches the persisted DSP state.
 * (Rpt1's per-track last-rate lives only in DSP — JS has no mirror for it.) */
function readDrumRepeatRates(t) {
    if (typeof host_module_get_param !== 'function') return;
    const r2 = host_module_get_param('t' + t + '_drum_r2rt');
    if (r2) {
        const v = r2.split(' ');
        for (let l = 0; l < 32 && l < v.length; l++)
            S.drumRepeat2RatePerLane[t][l] = parseInt(v[l], 10) | 0;
    }
}

/* Reset per-clip S.bankParams to defaults for track t (no DSP call needed —
 * DSP already reset them; this just keeps JS mirrors in sync). */
export function resetPerClipBankParamsToDefault(t) {
    for (let bi = 0; bi < PER_CLIP_BANKS.length; bi++) {
        const b = PER_CLIP_BANKS[bi];
        for (let k = 0; k < 8; k++) {
            const pm = BANKS[b].knobs[k];
            if (pm) S.bankParams[t][b][k] = pm.def;
        }
    }
    /* DSP self-resets pfx params to 0 on clip clear; defer non-zero JS defaults
     * onto the pendingDefaultSetParams queue so they land on a later tick and
     * don't coalesce with the clear set_param fired by the caller. */
    const _ac = S.trackActiveClip[t];
    S.pendingDefaultSetParams.push({
        key: 't' + t + '_c' + _ac + '_pfx_set',
        val: 'delay_level 127'
    });
    S.screenDirty = true;
}

/* ------------------------------------------------------------------ */
/* pollDSP — the one legal get_param reader (runs from tick)           */
/* ------------------------------------------------------------------ */

export function pollDSP() {
    /* bpm mirror — MIDI handlers can't get_param (silently null there), so
     * anything transport-side that needs tempo reads S.bpmMirror instead
     * (audit js-input-3: count-in cadence fell back to 120 BPM). */
    if (typeof host_module_get_param === 'function') {
        const _bv = parseFloat(host_module_get_param('bpm'));
        if (_bv > 0 && isFinite(_bv)) S.bpmMirror = _bv;
    }
    /* Reconcile co-run state with SHM. The shim auto-clears co-run on user
     * Back press (framework exit gesture), so dAVEBOx may discover target=NONE
     * here without having driven the exit itself. Use the existing exit
     * helpers for cleanup — they're idempotent on the second SHM write and
     * carry the palette/LED-cache/modifier-clear work we need either way. */
    if (typeof shadow_corun_state === 'function') {
        const _st = shadow_corun_state();
        const _slot  = (_st && _st.target === CORUN_TARGET_CHAIN_EDIT)  ? _st.id : -1;
        const _track = (_st && _st.target === CORUN_TARGET_MOVE_NATIVE) ? _st.id : -1;
        if (_slot < 0 && S.schwungCoRunSlot >= 0) {
            exitSchwungCoRun();
            /* Framework exit also closes any global menu we opened to launch it. */
            S.globalMenuOpen = false;
            S.lastSentMenuEditValue = null;
        }
        if (_track < 0 && S.moveCoRunTrack >= 0) {
            exitMoveNativeCoRun();
        }
        if (S.coRunOverlayScreen === undefined) {
            /* Which Schwung screen Note/Session opens as an overlay in Move co-run.
             * Prefer this fork's FX-bus picker; fall back to an upstream-registered
             * FX screen (master_fx) so the overlay also works on STOCK Schwung that
             * has the co-run view-addressing API (shadow_corun_*) but not the fork's
             * fork-only fx_picker entry. null = no addressable screen available. */
            let _scr = null;
            if (typeof shadow_corun_entries === 'function') {
                const _ents = shadow_corun_entries();
                if (_ents.indexOf('fx_picker') >= 0) _scr = 'fx_picker';
                else if (_ents.indexOf('master_fx') >= 0) _scr = 'master_fx';
            }
            S.coRunOverlayScreen = _scr;
        }
    }
    if (typeof host_module_get_param !== 'function') return;
    /* Remote-UI edit sync: the browser piano-roll edits notes[]/clips directly in
     * the DSP (they play immediately) but the on-device JS keeps its own clip
     * grid + step mirror, which would otherwise only refresh on a local action.
     * The DSP bumps rui_rev on every remote content edit (not on selection); when
     * it changes, re-read the changed clips from DSP so new clips + notes appear
     * on-device. Throttled to the pollDSP cadence; zero cost while idle.
     *
     * TARGETED re-sync: on a rev change, read rui_dirty (a read-and-clear digest
     * of WHICH clips changed) and re-read only those via syncClipsTargeted — a
     * single-clip edit costs ~5 get_params instead of the full ~1,540 of
     * syncClipsFromDsp (one per SPI frame ≈ 4.3 s frozen tick). "FULL"/null/
     * unparseable (overflow, mixed drum+melodic, or a poll/edit race) falls back
     * to a full sync inside syncClipsTargeted. */
    {
        const _rr = host_module_get_param('rui_rev');
        if (_rr !== null && _rr !== undefined) {
            const _rev = parseInt(_rr, 10) | 0;
            if (S.lastRemoteRev === undefined) {
                S.lastRemoteRev = _rev;
            } else if (_rev !== S.lastRemoteRev) {
                S.lastRemoteRev = _rev;
                syncClipsTargeted(host_module_get_param('rui_dirty'));
                S.screenDirty = true;
            }
        }
    }
    /* Keep the AUTOMATION-bank AT indicator live (it appears as you record). */
    if (S.activeBank === 6) {
        const _at = S.activeTrack, _ac = effectiveClip(_at);
        const _ah = host_module_get_param('t' + _at + '_c' + _ac + '_at_has');
        if (_ah !== null) S.clipAtHas[_at][_ac] = (parseInt(_ah, 10) === 1);
    }
    /* Clock-follow: keep the UI's view of follow mode + Move's transport live so
     * BPM shows EXT and Tap Tempo is gated. Cheap single get_param per poll. */
    {
        const _cs = host_module_get_param('clock_follow_on');
        if (_cs !== null) S.clockFollowOn = (_cs === '1');
        /* Clock Out: stored preference; sync UI from DSP (reflects saved _cs on
         * state load). Emission itself is gated DSP-side on free-running. */
        const _co = host_module_get_param('clock_send_on');
        if (_co !== null) S.clockSendOn = (_co === '1');
        /* Clock-Follow start fell back to the solo clock (Move never started after
         * the Link-sync wait) — DSP raises a one-shot; warn the user briefly. */
        if (host_module_get_param('clock_follow_fallback') === '1')
            showActionPopup('CLOCK FOLLOW', "Move didn't start", 'Last-known tempo');
    }
    /* Retrospective capture: mirror the buffered-input count (lights the
     * Capture LED via the tick LED pass; gates tap = capture-vs-bake). */
    {
        const _cp = host_module_get_param('capture_pending');
        if (_cp !== null) {
            const _n = parseInt(_cp, 10) | 0;
            if ((_n > 0) !== (S.capturePending > 0)) S.screenDirty = true;
            S.capturePending = _n;
        }
        /* "Armed" = a Capture tap would actually commit: playing (overdub) or
         * stopped in an empty session (first-take). Stopped + non-empty is a
         * no-op (hint only), so the LED must not blink there. */
        S.captureArmed = S.capturePending > 0 &&
            (S.playing || !sessionHasAnyContent());
        /* Watch capture_info for a commit and mirror the tempo-selector state.
         * Format: "seq stopped bpm0 bpm1 bpm2 len select_active select_idx". */
        const _ci = host_module_get_param('capture_info');
        if (_ci) {
            const _p    = _ci.split(' ');
            const _seq  = parseInt(_p[0], 10) | 0;
            const _sel  = _p.length > 6 ? (_p[6] === '1') : false;
            const _sidx = _p.length > 7 ? (parseInt(_p[7], 10) | 0) : 0;
            /* Commit edge: seq bumped since we last handled it. */
            if (S.captureCommitAwait > 0 && _seq > 0 && _seq !== S.captureInfoSeq) {
                S.captureInfoSeq     = _seq;
                S.captureCommitAwait = 0;
                if (_sel) {
                    /* Stopped capture with a real tempo estimate → open the
                     * on-device tempo chooser (wheel to audition, click to keep). */
                    S.tempoSelectActive = true;
                    S.tempoSelectIdx    = _sidx;
                    S.tempoSelectBpms   = [parseFloat(_p[2]), parseFloat(_p[3]), parseFloat(_p[4])];
                    S.tempoSelectTrack  = S.activeTrack;
                    S.tempoSelectClip   = S.trackActiveClip[S.activeTrack];
                    S.screenDirty = true;
                } else if (_p[1] === '1') {
                    showActionPopup('CAPTURED',
                                    Math.round(parseFloat(_p[2 + _sidx])) + ' BPM',
                                    _p[5] + ' steps');
                } else {
                    showActionPopup('CAPTURED', 'Added to clip');
                }
            } else if (S.captureCommitAwait > 0) {
                S.captureCommitAwait--;
            }
            /* Keep the live selector view in sync; close it if the DSP did
             * (e.g. transport stopped out from under it). */
            if (S.tempoSelectActive) {
                if (!_sel) {
                    S.tempoSelectActive = false;
                    S.screenDirty = true;
                } else {
                    S.tempoSelectIdx  = _sidx;
                    S.tempoSelectBpms = [parseFloat(_p[2]), parseFloat(_p[3]), parseFloat(_p[4])];
                }
            }
        }
    }
    const snap = host_module_get_param('state_snapshot');
    if (!snap) return;
    const v = snap.split(' ');
    if (v.length < 53) return;
    S.playing = (v[0] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const newStep = parseInt(v[1 + t], 10) | 0;
        S.trackCurrentStep[t] = newStep;
        if (S.playing) {
            const newClip = parseInt(v[9 + t], 10) | 0;
            S.trackActiveClip[t] = newClip;
            if (newClip !== S.lastDspActiveClip[t]) {
                S.lastDspActiveClip[t] = newClip;
                refreshPerClipBankParams(t);
                if (S.trackPadMode[t] === PAD_MODE_DRUM) {
                    /* Batched lane meta (1 get_param, covers has-notes dots for
                     * all lanes). The 256-step pattern read is only needed to
                     * draw the ACTIVE track's lane, so skip it for the others —
                     * on a scene switch this avoids ~5 RT-thread get_params per
                     * off-screen track. */
                    syncDrumLanesMeta(t);
                    if (t === S.activeTrack)
                        syncDrumLaneSteps(t, S.activeDrumLane[t]);
                }
            }
        }
        const _newQ = parseInt(v[17 + t], 10) | 0;
        if (_newQ !== S.trackQueuedClip[t]) S.screenDirty = true;
        S.trackQueuedClip[t]  = _newQ;
    }
    const countInDspActive = (v[25] === '1');
    for (let t = 0; t < NUM_TRACKS; t++) {
        const _newPlaying  = (v[26 + t] === '1');
        const _newWR       = (v[34 + t] === '1');
        if (_newPlaying !== S.trackClipPlaying[t] || _newWR !== S.trackWillRelaunch[t]) {
            S.screenDirty = true;
        }
        S.trackClipPlaying[t]     = _newPlaying;
        S.trackWillRelaunch[t]    = _newWR;
        S.trackPendingPageStop[t] = (v[42 + t] === '1');
    }
    S.flashEighth    = (v[50] === '1');
    S.flashSixteenth = (v[51] === '1');
    if (v.length >= 54) S.masterPos      = (parseInt(v[53], 10) | 0) >>> 0;
    if (v.length >= 55) S.dspLooperState  = parseInt(v[54], 10) | 0;
    const _prevMergeState = S.dspMergeState;
    if (v.length >= 56) S.dspMergeState   = parseInt(v[55], 10) | 0;
    /* DSP's authoritative solo-track (0xFF/255 = scene mode). Read it rather
     * than trusting the JS mirror to survive — the single-track flow places
     * DSP-side on merge_stop, so this mostly backs the transport-stop edge. */
    const _dspSolo = (v.length >= 57) ? (parseInt(v[56], 10) | 0) : 255;
    const _soloTrack = _dspSolo !== 255 ? _dspSolo
                     : (S.mergeSingleTrack >= 0 ? S.mergeSingleTrack : -1);
    /* Arm confirmation: no longer fails on "no empty slot" — placement is
     * deferred until the user picks a row, so arm always succeeds. */
    if (S.pendingMergeArm) S.pendingMergeArm = false;
    /* Capture-done transition: DSP went into CAPTURED (4). Single-clip (Track
     * View) merge → pick-a-destination mode: switch to Session View and blink
     * the merge track's empty clips so the user taps where to save it. Scene
     * merge → the all-tracks placement dialog (pick a row). */
    if (_prevMergeState !== 4 && S.dspMergeState === 4) {
        if (_soloTrack >= 0) {
            S.mergeSoloPlacement = _soloTrack;
            if (!S.sessionView) {
                /* Minimal view switch (importing _switchViewCleanup would cross
                 * an existing module cycle). Clear the Track-View step-hold
                 * state that shouldn't leak into Session View. */
                S.sessionView     = true;
                S.heldStep        = -1; S.heldStepBtn = -1;
                S.heldStepNotes   = []; S.stepWasEmpty = false;
                S.stepWasHeld     = false;
                S.sessionStepHeld = -1; S.sessionStepHeldCtx = 0;
                invalidateLEDCache();
            }
        } else {
            S.pendingMergePlacement = true;
        }
        S.screenDirty = true;
    }
    /* Placement complete: DSP transitioned CAPTURED→IDLE (merge_place_row
     * fired and committed clips). Re-read ALL clips from DSP — any of the 8
     * tracks may have just received fresh notes at the placement row. The
     * full re-read also rebuilds clipSteps/clipNonEmpty mirrors so the
     * Session-View overview lights the newly-populated clip pads. */
    if (_prevMergeState !== 0 && S.dspMergeState === 0) {
        /* Merge state lives on the Rec LED now (Shift+Rec); drop it back to
         * the record-arm state immediately (tick pass would catch up anyway). */
        setButtonLED(MoveRec, S.recordArmed ? Red : LED_OFF);
        /* Solo (single-track) merge places DSP-side on merge_stop, so JS sees
         * CAPTURING/STOPPING → IDLE directly; the mirror is the reliable tell
         * at this point (DSP already reset its solo field to 255). */
        const _wasSolo = S.mergeSingleTrack >= 0 || S.mergeSoloPlacement >= 0;
        S.mergeSingleTrack   = -1;
        S.mergeSoloPlacement = -1;
        if (_wasSolo)
            showActionPopup('LIVE MERGE', 'Printed to clip');
        else if (_prevMergeState === 2)
            showActionPopup('MAX LENGTH', 'REACHED');
        syncClipsFromDsp();
        S.screenDirty = true;
    }

    /* Deferred bank refresh after bake */
    if (S.pendingBankRefresh >= 0) {
        refreshPerClipBankParams(S.pendingBankRefresh);
        S.pendingBankRefresh = -1;
        S.screenDirty = true;
    }

    /* Drum playhead: poll active lane's current step for active drum track */
    if (S.trackPadMode[S.activeTrack] === PAD_MODE_DRUM) {
        const _dl = S.activeDrumLane[S.activeTrack];
        const _dcRaw = host_module_get_param('t' + S.activeTrack + '_l' + _dl + '_current_step');
        if (_dcRaw !== null) {
            const _newDcs = parseInt(_dcRaw, 10) | 0;
            if (_newDcs !== S.drumCurrentStep[S.activeTrack]) {
                S.drumCurrentStep[S.activeTrack] = _newDcs;
                S.screenDirty = true;
            }
        }
        /* Drum SeqFollow: auto-page to follow playhead */
        if (S.playing && S.trackClipPlaying[S.activeTrack] && S.clipSeqFollow[S.activeTrack][effectiveClip(S.activeTrack)]) {
            const _dcs = S.drumCurrentStep[S.activeTrack];
            if (_dcs >= 0) {
                const _newPage = Math.floor(_dcs / 16);
                if (_newPage !== S.drumStepPage[S.activeTrack]) {
                    S.drumStepPage[S.activeTrack] = _newPage;
                    S.screenDirty = true;
                }
            }
        }
        /* M blink: keep screen dirty while any lane is muted so blink animates */
        if (S.drumLaneMute[S.activeTrack]) S.screenDirty = true;
        /* Drum pad flash + S.seqActiveNotes: poll which lanes are hitting (single bitmask call) */
        if (S.playing && S.trackClipPlaying[S.activeTrack]) {
            const _maskRaw = host_module_get_param('t' + S.activeTrack + '_drum_active_lanes');
            if (_maskRaw !== null) {
                const _mask = parseInt(_maskRaw, 10) | 0;
                S.seqActiveNotes.clear(); /* refresh per poll; stale entries block external recording */
                for (let _fl = 0; _fl < DRUM_LANES; _fl++) {
                    if (_mask & (1 << _fl)) {
                        S.drumLaneFlashTick[S.activeTrack][_fl] = S.tickCount;
                        S.seqActiveNotes.add(S.drumLaneNote[S.activeTrack][_fl]);
                        S.screenDirty = true;
                    }
                }
            }
        }
    } else {
        /* TARP held-buffer mirror: poll DSP buffer for active melodic track when
         * latch + style are both on so source pads light up. Cleared when either
         * is off (style=0 silences the engine — pad lighting follows suit). Drives
         * only pad LEDs (updateTrackLEDs reads .has() each tick) — no OLED
         * dependency so no screenDirty needed here. */
        const _tat = S.activeTrack;
        const _tLatch = (S.bankParams[_tat][5][7] | 0) !== 0 &&
                        (S.bankParams[_tat][5][0] | 0) !== 0;
        if (_tLatch) {
            const _hRaw = host_module_get_param('t' + _tat + '_tarp_held');
            const _set = S.tarpHeldNotes[_tat];
            _set.clear();
            if (_hRaw) {
                const _parts = _hRaw.split(' ');
                for (let _i = 0; _i < _parts.length; _i++) {
                    const _p = parseInt(_parts[_i], 10);
                    if (_p >= 0 && _p <= 127) _set.add(_p);
                }
            }
        } else if (S.tarpHeldNotes[_tat].size > 0) {
            S.tarpHeldNotes[_tat].clear();
        }
    }

    /* SeqFollow: auto-page S.activeTrack to follow playhead */
    if (S.playing) {
        const _sft = S.activeTrack;
        const _sfac = effectiveClip(_sft);
        if (S.clipSeqFollow[_sft][_sfac] && S.trackClipPlaying[_sft]) {
            var newPage;
            if (S.activeBank === 6) {
                var _ccLsf = S.ccActiveLane[_sft];
                var _dispTpsSf = S.ccLaneTps[_sft][_sfac][_ccLsf] || (S.clipTPS[_sft][_sfac] || 24);
                var _lTpsSf = S.ccLaneResTps[_sft][_sfac][_ccLsf] || _dispTpsSf;
                var _effLenSf = S.ccLaneLength[_sft][_sfac][_ccLsf] || S.clipLength[_sft][_sfac];
                var _lLenTicksSf = _effLenSf * _lTpsSf;
                var _progressSf = (S.masterPos % _lLenTicksSf) / _lLenTicksSf;
                var _laneStep = Math.floor(_progressSf * _effLenSf);
                newPage = Math.floor(_laneStep / 16);
            } else {
                var _cs = S.trackCurrentStep[_sft];
                if (_cs >= 0) newPage = Math.floor(_cs / 16);
            }
            if (newPage !== undefined && newPage !== S.trackCurrentPage[_sft]) {
                S.trackCurrentPage[_sft] = newPage;
                S.screenDirty = true;
            }
        }
    }

    /* Record-arm pending page boundary: DSP defers recording=1 to next bar.
     * Clear S.recordPendingPage once DSP has fired (recording_pending_page=0). */
    if (S.recordPendingPage && S.recordArmedTrack >= 0 && typeof host_module_get_param === 'function') {
        const _rpp = host_module_get_param('t' + S.recordArmedTrack + '_recording_pending_page');
        if (_rpp === '0') S.recordPendingPage = false;
    }

    /* Count-in end: DSP fired transport+recording — sync JS state */
    if (S.countInDspPrev && !countInDspActive && S.playing) {
        S.recordCountingIn    = false;
        S.countInStartTick    = -1;
        S.countInQuarterTicks = 0;
    }
    S.countInDspPrev = countInDspActive;

    /* Transport transitions */
    if (!S.playingPrev && S.playing) {
        S.transportStartTick = S.tickCount;
        /* Focused-clip-by-default on transport start: only the clip the user
         * is currently *viewing* in Track View auto-launches. Session View
         * launches whatever is already queued — explicit launch by the user.
         * The "focused" concept is single-clip: the one open for editing on
         * the active track in Track View; other tracks aren't focused and
         * shouldn't auto-launch (otherwise Session-View Delete+Play to
         * deactivate everything would be undone by the next transport start). */
        if (!S.sessionView) {
            const _at = S.activeTrack;
            if (!S.trackClipPlaying[_at]
                    && !S.trackWillRelaunch[_at]
                    && S.trackQueuedClip[_at] === -1
                    && _focusedClipIsEmpty(_at)) {
                const _tac = S.trackActiveClip[_at];
                S.pendingDefaultSetParams.push({ key: 't' + _at + '_launch_clip', val: String(_tac) });
                S.trackQueuedClip[_at] = _tac;
            }
        }
        /* Auto-launch focused clip if record is armed and clip is inactive */
        if (S.recordArmed) {
            const _rT  = S.recordArmedTrack >= 0 ? S.recordArmedTrack : S.activeTrack;
            const _rAc = S.trackActiveClip[_rT];
            if (S.clipNonEmpty[_rT][_rAc] &&
                    !S.trackClipPlaying[_rT] &&
                    !S.trackWillRelaunch[_rT] &&
                    S.trackQueuedClip[_rT] !== _rAc) {
                if (typeof host_module_set_param === 'function')
                    host_module_set_param('t' + _rT + '_launch_clip', String(_rAc));
                S.trackQueuedClip[_rT] = _rAc;
            }
            /* Adaptive mode for count-in path: enter if clip was empty with no manual length */
            if (!S.clipAdaptiveMode[_rT][_rAc]) {
                const _isDrumAdapt = S.trackPadMode[_rT] === PAD_MODE_DRUM;
                if (_isDrumAdapt ? (!S.drumClipNonEmpty[_rT][_rAc] && !S.drumLaneLengthManuallySet[_rT])
                                 : (!S.clipNonEmpty[_rT][_rAc] && !S.clipLengthManuallySet[_rT][_rAc]))
                    S.clipAdaptiveMode[_rT][_rAc] = true;
            }
        }
    }
    if (S.playingPrev  && !S.playing) {
        disarmRecord();
        /* Transport stop unlatches TARP + Rpt1 + Rpt2 on every track so
         * latched chords/lanes don't drone with transport dead. Shared
         * helper queues the per-track set_params one-per-tick via
         * pendingDefaultSetParams to avoid same-buffer coalescing. */
        unlatchAllTracks();
    }
    S.playingPrev = S.playing;

    /* Refresh step LEDs while recording or holding a step (nudge may move note across boundary) */
    if ((S.recordArmed && S.playing) || S.heldStep >= 0) {
        const rt = S.activeTrack;
        const rac = effectiveClip(rt);
        const bulk = host_module_get_param('t' + rt + '_c' + rac + '_steps');
        if (bulk && bulk.length >= NUM_STEPS) {
            for (let rs = 0; rs < NUM_STEPS; rs++)
                S.clipSteps[rt][rac][rs] = bulk[rs] === '1' ? 1 : (bulk[rs] === '2' ? 2 : 0);
            S.clipNonEmpty[rt][rac] = clipHasContent(rt, rac);
            S.screenDirty = true;
        }
    }

    /* Track sequencer notes for active track pad highlighting */
    const t  = S.activeTrack;
    const ac = S.trackActiveClip[t];
    const cs = S.trackCurrentStep[t];
    if (!S.playing) {
        S.seqActiveNotes.clear();
        S.seqLastStep = -1;
        S.seqLastClip = -1;
        S.seqNoteOnClipTick = -1;
        S.seqNoteGateTicks  = 0;
    } else if (cs !== S.seqLastStep || ac !== S.seqLastClip) {
        const newHasNote = cs >= 0 && S.clipSteps[t][ac][cs] === 1;
        /* Check whether the previous note's gate is still sounding before clearing */
        let prevStillSounding = false;
        if (!newHasNote && S.seqActiveNotes.size > 0 &&
                S.seqNoteOnClipTick >= 0 && S.seqNoteGateTicks > 0 && ac === S.seqLastClip) {
            const ctChk = host_module_get_param('t' + t + '_current_clip_tick');
            if (ctChk !== null && ctChk !== undefined) {
                const ctv      = parseInt(ctChk, 10) | 0;
                const clipTks  = S.clipLength[t][ac] * (S.clipTPS[t][ac] || 24);
                const elapsed  = ctv >= S.seqNoteOnClipTick
                    ? ctv - S.seqNoteOnClipTick
                    : clipTks - S.seqNoteOnClipTick + ctv;
                prevStillSounding = elapsed < S.seqNoteGateTicks;
            }
        }
        S.seqLastStep = cs;
        S.seqLastClip = ac;
        if (newHasNote) {
            /* New step has a note — show it, replacing any sustaining previous note */
            S.seqActiveNotes.clear();
            S.seqNoteOnClipTick = -1;
            S.seqNoteGateTicks  = 0;
            const raw = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_notes');
            if (raw && raw.trim().length > 0) {
                raw.trim().split(' ').forEach(function(sn) {
                    const pitch = parseInt(sn, 10);
                    if (pitch >= 0 && pitch <= 127) S.seqActiveNotes.add(pitch);
                });
            }
            const ctStr = host_module_get_param('t' + t + '_current_clip_tick');
            const gStr  = host_module_get_param('t' + t + '_c' + ac + '_step_' + cs + '_gate');
            if (ctStr !== null && ctStr !== undefined) S.seqNoteOnClipTick = parseInt(ctStr, 10) | 0;
            if (gStr  !== null && gStr  !== undefined) S.seqNoteGateTicks  = parseInt(gStr,  10) | 0;
        } else if (!prevStillSounding) {
            /* New step empty, previous note expired — clear */
            S.seqActiveNotes.clear();
            S.seqNoteOnClipTick = -1;
            S.seqNoteGateTicks  = 0;
        }
        /* else: prevStillSounding — keep old notes + gate tracking across empty step */
    } else if (S.seqActiveNotes.size > 0 && S.seqNoteOnClipTick >= 0 && S.seqNoteGateTicks > 0) {
        const ctStr = host_module_get_param('t' + t + '_current_clip_tick');
        if (ctStr !== null && ctStr !== undefined) {
            const ct = parseInt(ctStr, 10) | 0;
            const clipTicks = S.clipLength[t][ac] * (S.clipTPS[t][ac] || 24);
            const elapsed = ct >= S.seqNoteOnClipTick
                ? ct - S.seqNoteOnClipTick
                : clipTicks - S.seqNoteOnClipTick + ct;
            if (elapsed >= S.seqNoteGateTicks) {
                S.seqActiveNotes.clear();
                S.seqNoteOnClipTick = -1;
                S.seqNoteGateTicks  = 0;
            }
        }
    }

    /* Deferred DSP state save: fetch state_full (DSP serializes only when dirty) */
    if (typeof host_write_file === 'function' && S.currentSetUuid) {
        const _st = host_module_get_param('state_full');
        if (_st && _st.length > 2) {
            host_write_file(uuidToStatePath(S.currentSetUuid), _st);
            updateNameIndex();
        }
    }

}

/* ------------------------------------------------------------------ */
/* Parameter bank: read from DSP and write to DSP                      */
/* ------------------------------------------------------------------ */

/* Read all wired params for bankIdx on track t from DSP into S.bankParams. */
export function readBankParams(t, bankIdx) {
    if (typeof host_module_get_param !== 'function') return;
    /* Drum pfx banks (0, 1, 3): read via per-lane snapshot, not melodic keys */
    if (S.trackPadMode[t] === PAD_MODE_DRUM && (bankIdx === 0 || bankIdx === 1 || bankIdx === 3)) {
        refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        return;
    }
    /* ARP OUT bank: seq_arp_* are set-only; read via per-clip pfx_snapshot */
    if (bankIdx === 4) {
        const ac   = S.trackActiveClip[t];
        const snap = host_module_get_param('t' + t + '_c' + ac + '_pfx_snapshot');
        if (snap) {
            const v = snap.split(' ');
            if (v.length >= 24) {
                for (let k = 0; k < 7; k++) S.bankParams[t][4][k] = parseInt(v[17 + k], 10) | 0;
            }
        }
        return;
    }
    /* CC PARAM bank: read all 8 CC assignments + per-knob type from DSP */
    if (bankIdx === 6) {
        const raw = host_module_get_param('t' + t + '_cc_assigns');
        if (raw) {
            const parts = raw.split(' ');
            for (let k = 0; k < 8; k++)
                S.trackCCAssign[t][k] = parseInt(parts[k], 10) || CC_ASSIGN_DEFAULTS[k];
        }
        const typs = host_module_get_param('t' + t + '_cc_types');
        if (typs) {
            const tp = typs.split(' ');
            for (let k = 0; k < 8; k++) S.trackCCType[t][k] = parseInt(tp[k], 10) || 0;
        }
        /* Default Schwung-routed tracks to Sch1-8 when all lanes are at factory CC defaults.
         * Deferred one-per-tick via pendingDefaultSetParams to avoid coalescing. */
        if (S.trackRoute[t] === 0 && typeof shadow_set_param === 'function' &&
                S.trackCCType[t].every(function(tp) { return tp === 0; })) {
            for (let k = 0; k < 8; k++) {
                S.trackCCType[t][k] = 2;
                S.trackCCAssign[t][k] = k + 1;
                S.schLabel[t][k] = null;
                S.pendingDefaultSetParams.push({ key: 't' + t + '_cc_type_assign', val: k + ' 2 ' + (k + 1) });
            }
        }
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bits = host_module_get_param('t' + t + '_c' + c + '_cc_auto_bits');
            S.trackCCAutoBits[t][c] = bits !== null ? (parseInt(bits, 10) || 0) : 0;
            /* Per-clip resting values ("—"=255 → -1). */
            const rest = host_module_get_param('t' + t + '_c' + c + '_cc_rest');
            if (rest) {
                const rp = rest.split(' ');
                for (let k = 0; k < 8; k++) {
                    const rv = parseInt(rp[k], 10);
                    S.clipCCVal[t][c][k] = (rv >= 0 && rv <= 127) ? rv : -1;
                }
            }
            /* Aftertouch automation presence (for the AUTOMATION-bank indicator). */
            const ath = host_module_get_param('t' + t + '_c' + c + '_at_has');
            S.clipAtHas[t][c] = (ath !== null && parseInt(ath, 10) === 1);
        }
        return;
    }
    const knobs = BANKS[bankIdx].knobs;
    for (let k = 0; k < 8; k++) {
        const pm = knobs[k];
        if (!pm || !pm.abbrev || pm.scope === 'stub') {
            S.bankParams[t][bankIdx][k] = pm ? pm.def : 0;
            continue;
        }
        if (pm.scope === 'seqfollow') {
            S.bankParams[t][bankIdx][k] = S.clipSeqFollow[t][S.trackActiveClip[t]] ? 1 : 0;
            continue;
        }
        if (pm.scope === 'clip') {
            const ac = S.trackActiveClip[t];
            if (pm.dspKey === 'clip_resolution') {
                const tps = S.clipTPS[t][ac] || 24;
                const idx = TPS_VALUES.indexOf(tps);
                S.bankParams[t][bankIdx][k] = idx >= 0 ? idx : 1;
            } else if (pm.dspKey === 'clip_playback_dir') {
                /* Mirror kept in sync by refreshPerClipBankParams +
                 * applyBankParam. Without this, every bank-jog onto CLIP
                 * resets the displayed Dir to Fwd until the next pollDSP. */
                S.bankParams[t][bankIdx][k] = S.clipPlaybackDir[t][ac] | 0;
            } else {
                S.bankParams[t][bankIdx][k] = pm.def;
            }
            continue;
        }
        if (pm.scope === 'action') {
            /* beat_stretch and clock_shift display per-touch labels (0 at rest) rather than absolute position */
            if (pm.dspKey === 'beat_stretch' || pm.dspKey === 'clock_shift') { S.bankParams[t][bankIdx][k] = 0; continue; }
            const stateKey = 't' + t + '_' + pm.dspKey + pm.actionSuffix;
            const raw = host_module_get_param(stateKey);
            S.bankParams[t][bankIdx][k] = parseActionRaw(raw, pm.def);
            continue;
        }
        const key = pm.scope === 'global' ? pm.dspKey : 't' + t + '_' + pm.dspKey;
        const raw = host_module_get_param(key);
        if (raw === null || raw === undefined) {
            S.bankParams[t][bankIdx][k] = pm.def;
            continue;
        }
        if (pm.dspKey === 'route') {
            S.bankParams[t][bankIdx][k] = raw === 'external' ? 2 : raw === 'move' ? 1 : 0;
        } else {
            S.bankParams[t][bankIdx][k] = parseInt(raw, 10) || 0;
        }
    }
    /* Drum NOTE/NOTEFX bank: quantize slot is managed via drumLaneQnt mirror, not get_param */
    if (bankIdx === 1 && S.trackPadMode[t] === PAD_MODE_DRUM)
        S.bankParams[t][1][2] = S.drumLaneQnt[t];
    /* DELAY bank (melodic): K7 is delay_retrig in the bank def now, so the
     * standard loop already reads it into bankParams[t][3][6]. delay_clock_fb
     * is no longer in the bank def — it lives on Shift+K1 with its own mirror
     * S.delayClockFb[t]. Read it explicitly here so the OLED value cell shows
     * the live value when Shift+K1 is touched. */
    if (bankIdx === 3 && S.trackPadMode[t] !== PAD_MODE_DRUM) {
        const _cf = host_module_get_param('t' + t + '_delay_clock_fb');
        if (_cf !== null && _cf !== undefined)
            S.delayClockFb[t] = Math.max(-100, Math.min(100, parseInt(_cf, 10) | 0));
    }
}

function readTrackConfig(t) {
    if (typeof host_module_get_param !== 'function') return;
    const ch = host_module_get_param('t' + t + '_channel');
    if (ch !== null && ch !== undefined) S.trackChannel[t] = parseInt(ch, 10) || 1;
    const rt = host_module_get_param('t' + t + '_route');
    if (rt !== null && rt !== undefined) S.trackRoute[t] = rt === 'external' ? 2 : rt === 'move' ? 1 : 0;
    const pm = host_module_get_param('t' + t + '_pad_mode');
    if (pm !== null && pm !== undefined) S.trackPadMode[t] = parseInt(pm, 10) | 0;
    const tvo = host_module_get_param('t' + t + '_track_vel_override');
    if (tvo !== null && tvo !== undefined) S.trackVelOverride[t] = parseInt(tvo, 10) | 0;
    const lpr = host_module_get_param('t' + t + '_track_looper');
    if (lpr !== null && lpr !== undefined) S.trackLooper[t] = parseInt(lpr, 10) | 0;
    const diq = host_module_get_param('t' + t + '_diq');
    if (diq !== null && diq !== undefined) {
        S.drumInpQuant[t] = Math.max(0, Math.min(8, parseInt(diq, 10) | 0));
        S.bankParams[t][7][5] = S.drumInpQuant[t];
    }
}

export function applyTrackConfig(t, key, val) {
    if (typeof host_module_set_param !== 'function') return;
    let strVal;
    if (key === 'route') strVal = val === 2 ? 'external' : val === 1 ? 'move' : 'schwung';
    else strVal = String(val);
    host_module_set_param('t' + t + '_' + key, strVal);
    if (key === 'channel')              S.trackChannel[t] = val;
    else if (key === 'route') {
        S.trackRoute[t] = val;
        /* Move route offers only Off/Poly aftertouch — normalize a lingering
         * Channel selection so the AftTch menu + send stay in sync. */
        if (val === 1 && S.trackAtMode[t] === 2) { S.trackAtMode[t] = 1; writeSidecar(); }
    }
    else if (key === 'pad_mode') {
        S.trackPadMode[t] = val;
        if (val === PAD_MODE_DRUM) {
            if (t === S.activeTrack && (S.activeBank === 2 || S.activeBank === 4)) S.activeBank = 0;
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            syncDrumClipContent(t);
        } else {
            if (t === S.activeTrack && S.activeBank === 7) S.activeBank = 0;
            /* Leaving DRUM mode: clear JS drum vel-zone state and defer all
             * downstream DSP pushes. When tN_pad_mode='0' is followed
             * synchronously by another tN_* push from the same JS callback,
             * the pad_mode push is silently dropped — verified empirically.
             * The entering-DRUM branch escapes this by running sync*
             * get_params between pad_mode and the tN_padmap push (the
             * get_param round-trips act as a sync barrier on the audio
             * thread). For leaving-DRUM we defer instead: adl/dpm via
             * the queue (one per tick), and computePadNoteMap via a
             * pending flag handled at the top of next tick. */
            S.drumVelZoneArmed[t] = false;
            S.drumLastVelZone[t]  = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_active_drum_lane',  val: '0' });
            S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_perform_mode', val: '0' });
            if (t === S.activeTrack) { S.pendingPadNoteMapRecompute = true; forceRedraw(); }
        }
        if (t === S.activeTrack && val === PAD_MODE_DRUM) { computePadNoteMap(); forceRedraw(); }
    }
    else if (key === 'track_vel_override') S.trackVelOverride[t] = val;
    else if (key === 'track_looper')    S.trackLooper[t] = val;
}

/* Send a single param change to DSP and apply any JS-side side-effects. */
export function applyBankParam(t, bankIdx, knobIdx, val) {
    const pm = BANKS[bankIdx].knobs[knobIdx];
    if (!pm || pm.scope === 'stub') return;
    if (pm.scope === 'seqfollow') {
        S.clipSeqFollow[t][S.trackActiveClip[t]] = val !== 0;
        return;
    }
    if (!pm.dspKey) return;
    if (typeof host_module_set_param !== 'function') return;

    if (pm.scope === 'global') {
        host_module_set_param(pm.dspKey, String(val));
        if (pm.dspKey === 'key') { S.padKey = val; computePadNoteMap(); }
    } else if (pm.scope === 'track') {
        let strVal;
        if      (pm.dspKey === 'route')              strVal = val === 2 ? 'external' : val === 1 ? 'move' : 'schwung';
        else                                         strVal = String(val);
        if ([1, 2, 3].indexOf(bankIdx) >= 0 && S.trackPadMode[t] === PAD_MODE_DRUM) {
            const lane = S.activeDrumLane[t];
            let dKey = pm.dspKey;
            if (bankIdx === 3) {
                /* Drum MIDI DLY: remap K5→delay_gate_fb, K6→delay_clock_fb. K7
                 * now hosts delay_retrig (was blocked) — pass through. K8
                 * (delay_pitch_random) stays blocked for drum. */
                if (knobIdx === 4) dKey = 'delay_gate_fb';
                else if (knobIdx === 5) dKey = 'delay_clock_fb';
                else if (knobIdx === 7) return;
            }
            host_module_set_param('t' + t + '_l' + lane + '_pfx_set', dKey + ' ' + strVal);
            return;
        }
        if (pm.dspKey === 'seq_arp_steps_mode' || pm.dspKey === 'tarp_steps_mode'
                || pm.dspKey === 'delay_retrig') {
            /* Defer via pendingDefaultSetParams: same-track sync tN_* set_params
             * fired in the same audio block can coalesce and silently drop the
             * first one (see set-param-per-buffer-per-key memory). delay_retrig
             * + a clip pad press (launch_clip) in quick succession was losing
             * the retrig write. One-per-tick drain guarantees it lands alone. */
            S.pendingDefaultSetParams.push({ key: 't' + t + '_' + pm.dspKey, val: strVal });
            return;
        }
        host_module_set_param('t' + t + '_' + pm.dspKey, strVal);
    } else if (pm.scope === 'clip') {
        const ac = S.trackActiveClip[t];
        if (pm.dspKey === 'clip_resolution') {
            if (S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t) return;
            const idx = Math.max(0, Math.min(5, val));
            S.clipTPS[t][ac] = TPS_VALUES[idx];
            host_module_set_param('t' + t + '_clip_resolution', String(idx));
        } else if (pm.dspKey === 'clip_playback_dir') {
            const dv = Math.max(0, Math.min(3, val | 0));
            S.clipPlaybackDir[t][ac] = dv;
            host_module_set_param('t' + t + '_clip_playback_dir', String(dv));
        }
    }
}

/* ------------------------------------------------------------------ */
/* Live-note dispatch (tick-batched queue)                              */
/* ------------------------------------------------------------------ */

/* Tick-batched live-note dispatch. Multiple set_param calls within a single
 * audio buffer coalesce to the last write — regardless of key — so a 3-pad
 * chord that fires 3 separate tN_live_notes microtasks within one buffer
 * loses two of them. We previously batched via a Promise microtask which
 * runs once per JS turn, but the host dispatches each onMidiMessage as its
 * own turn — so multiple pad CCs in one buffer still produced multiple
 * coalescing set_params. Drain on tick instead: events queue synchronously
 * from any number of onMidiMessage calls; tick() drains once per audio
 * buffer into one set_param per track. Cost: up to ~10 ms (one tick) of
 * live-monitor latency. Benefit: chord-press survives intact. */
export function _drainLiveNotes() {
    if (typeof host_module_set_param !== 'function') return;
    for (let _t = 0; _t < NUM_TRACKS; _t++) {
        if (pendingLiveNotes[_t].length === 0) continue;
        const evts = pendingLiveNotes[_t];
        pendingLiveNotes[_t] = [];
        const parts = [];
        for (const e of evts) {
            /* Ext-origin tokens carry an 'e' prefix ("eon p v"/"eoff p"): the
             * DSP tN_live_notes handler always processes them (non-Move ext
             * never reaches on_midi — the shim blocks non-ROUTE_MOVE cable-2),
             * while plain pad-origin tokens are skipped under dspInboundEnabled
             * (on_midi already dispatched them on the audio thread). */
            if (e.isOff) parts.push((e.ext ? 'eoff ' : 'off ') + e.pitch);
            else parts.push((e.ext ? 'eon ' : 'on ') + e.pitch + ' ' + e.vel);
        }
        host_module_set_param('t' + _t + '_live_notes', parts.join(' '));
    }
}
function queueLiveNoteOn(t, pitch, vel, ext) {
    pendingLiveNotes[t].push({ isOff: false, pitch, vel, ext: !!ext });
}
export function queueLiveNoteOff(t, pitch, ext) {
    pendingLiveNotes[t].push({ isOff: true, pitch, ext: !!ext });
}

/* ext (6th param): true when the note originated from external cable-2 MIDI
 * (_onMidiExternalImpl / extNoteOffAll). Ext-origin note events are queued
 * with the 'e' token prefix so the DSP processes them even under
 * dspInboundEnabled — for non-Move routes the shim blocks ext input from ever
 * reaching on_midi, making this JS push the ONLY live path. Callers only tag
 * ext for non-ROUTE_MOVE tracks (Move plays its own ext natively). */
export function liveSendNote(t, type, pitch, vel, rawVel, ext) {
    const ch    = (S.trackChannel[t] - 1) & 0x0F;
    const route = S.trackRoute[t];
    const status = type | ch;
    /* PHASE-1: dead on patched Schwung (Bundle 1 gate skips note dispatch
     * for liveSendNote; Bundle 2B applies VelIn in DSP on_midi via
     * effective_vel before live_note_on). Stock Schwung still needs this
     * — runs when dspInboundEnabled is false. Remove with the final
     * cleanup pass once shim patches land upstream. */
    if (!rawVel && type === 0x90 && vel > 0) {
        const tvo = S.trackVelOverride[t];
        if (tvo > 0) vel = tvo;
    }
    if (route === 2) {
        /* ROUTE_EXTERNAL. Note events queue through tN_live_notes so the pfx
         * chain applies (consistent with sequencer playback, which already
         * routes ROUTE_EXTERNAL through pfx_emit). DSP-side gate suppresses
         * when on_midi already handled it. CC/AT/PB pass through raw for the
         * external-MIDI-in forwarding path. */
        if (type === 0x90 || type === 0x80) {
            const isOff = (type === 0x80) || (type === 0x90 && vel === 0);
            if (isOff) {
                queueLiveNoteOff(t, pitch, ext);
            } else {
                queueLiveNoteOn(t, pitch, vel, ext);
            }
        } else {
            const cin = (status >> 4) & 0x0F;
            if (typeof move_midi_external_send === 'function')
                move_midi_external_send([cin, status, pitch, vel]);
        }
    } else if (route === 1) {
        /* ROUTE_MOVE. Queue note events for microtask-batched drain into one
         * tN_live_notes payload at end of the current JS turn. Recording
         * suppression: melodic record_note_on inline-monitors via DSP; drum
         * recording handled by press-handler direct-fire (also routes through
         * queueLiveNoteOn). Suppress here to avoid double-monitoring.
         *
         * Always queued regardless of dspInboundEnabled — the DSP-side
         * tN_live_notes handler gates on dsp_inbound_enabled instead, so
         * the JS path serves as a fallback when the padmap push didn't
         * reach DSP (stock Schwung v0.9.16 exposes the sentinel but
         * on_midi delivery may not produce sound). */
        if (type === 0x90 || type === 0x80) {
            const activelyRecording = S.recordArmed && !S.recordCountingIn && S.recordArmedTrack === t;
            const isOff = (type === 0x80) || (type === 0x90 && vel === 0);
            if (isOff) {
                queueLiveNoteOff(t, pitch, ext);
            } else if (!activelyRecording) {
                queueLiveNoteOn(t, pitch, vel, ext);
            }
        }
    } else {
        /* ROUTE_SCHWUNG: route note events through live_note_on so pfx chain
         * (TARP, NOTE FX, HARMZ, MIDI DLY) applies. No activelyRecording filter
         * — record_note_on DSP handler does not call live_note_on() inline for
         * ROUTE_SCHWUNG, so no double-monitoring risk. Non-note events (CC, AT,
         * PB) pass through raw — only note on/off go through the live-notes
         * payload parser.
         *
         * Always queued regardless of dspInboundEnabled — DSP-side gate. */
        if (type === 0x90 || type === 0x80) {
            const isOff = type === 0x80 || vel === 0;
            if (isOff) {
                queueLiveNoteOff(t, pitch, ext);
            } else {
                queueLiveNoteOn(t, pitch, vel, ext);
            }
        } else {
            if (typeof shadow_send_midi_to_dsp === 'function') shadow_send_midi_to_dsp([status, pitch, vel]);
        }
    }
}

/* ------------------------------------------------------------------ */
/* UI-sidecar restore                                                   */
/* ------------------------------------------------------------------ */

export function restoreUiSidecar(applyDefaultsNow) {
    const uiSp = uuidToUiStatePath(S.currentSetUuid);
    let us = null;
    if (typeof host_read_file === 'function' && typeof host_file_exists === 'function'
            && host_file_exists(uiSp)) {
        try { us = JSON.parse(host_read_file(uiSp)); } catch (e) {}
    }
    if (us && us.v >= 1) {
        if (typeof us.at === 'number' && us.at >= 0 && us.at < NUM_TRACKS)
            S.activeTrack = us.at;
        if (Array.isArray(us.ac)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _c = us.ac[_t];
                if (typeof _c === 'number' && _c >= 0 && _c < NUM_CLIPS)
                    S.trackActiveClip[_t] = _c;
            }
        }
        S.sessionView = us.sv === 1;
        if (Array.isArray(us.dl)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _l = us.dl[_t];
                if (typeof _l === 'number' && _l >= 0 && _l < DRUM_LANES)
                    setActiveDrumLane(_t, _l);
            }
        }
        /* Bundle 2C-Rpt2: re-push drum_lane_page mirror after DSP
         * create_instance reset. Not sidecar-persisted, but JS state may
         * be non-zero if the user paged off-zero before the set-switch
         * that triggered this restore. Unconditional push (the setter
         * would early-return on matching values, missing the post-reset
         * DSP=0 case). */
        if (typeof host_module_set_param === 'function') {
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                host_module_set_param('t' + _t + '_drum_lane_page', String(S.drumLanePage[_t]));
        }
        if (typeof us.bm === 'number') S.beatMarkersEnabled = us.bm !== 0;
        if (us.v >= 2) {
            if (typeof us.pm === 'number') S.perfModsToggled = us.pm & 0xFFFFFF;
            S.perfLatchMode = us.lm === 1;
            if (typeof us.rs === 'number' && us.rs >= 0 && us.rs < 16)
                S.perfRecalledSlot = us.rs;
            /* User perf presets restore INDEPENDENTLY of the recalled slot:
             * saving a preset never sets perfRecalledSlot (stays -1 unless
             * one was recalled), so nesting this under the us.rs guard
             * silently discarded slots 8-15 on reload — and the sidecar is
             * their only persistence (audit js-modules-3). */
            if (Array.isArray(us.us)) {
                for (let _i = 0; _i < 8; _i++) {
                    if (typeof us.us[_i] === 'number')
                        S.perfSnapshots[8 + _i] = us.us[_i];
                }
            }
            const _pm = S.perfModsToggled | S.perfModsHeld;
            if (_pm) S.pendingDefaultSetParams.push({ key: 'perf_mods', val: String(_pm) });
        }
        /* us.ss (per-track Schwung slot) is obsolete — the co-run slot is now
         * derived from each slot's receive channel at entry time, so old sidecars'
         * ss is ignored and no longer written. */
        if (us.v >= 5 && Array.isArray(us.dva)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.drumVelZoneArmed[_t] = us.dva[_t] === true;
        }
        if (us.v >= 6 && Array.isArray(us.dleu)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _row = us.dleu[_t];
                if (!Array.isArray(_row)) continue;
                for (let _l = 0; _l < DRUM_LANES; _l++) {
                    const _n = _row[_l];
                    S.drumLaneEuclidN[_t][_l] = (typeof _n === 'number' && _n >= 0) ? (_n | 0) : 0;
                }
            }
        }
        if (us.v >= 7 && Array.isArray(us.to)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _o = us.to[_t];
                if (typeof _o === 'number')
                    S.trackOctave[_t] = Math.max(-4, Math.min(4, _o | 0));
            }
        }
        if (us.v >= 8 && Array.isArray(us.tab)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _b = us.tab[_t];
                S.trackActiveBank[_t] = (typeof _b === 'number' && _b >= 0 && _b <= 7) ? (_b | 0) : 0;
            }
            /* Sync live mirror to the restored active track. Subsequent
             * post-restore validity checks (e.g. hide bank 7 on melodic) still
             * apply because activeBank is a regular live variable from here on. */
            S.activeBank = S.trackActiveBank[S.activeTrack] | 0;
            if (S.activeBank === 7) S.allLanesConfirmed = false;
        }
        if (us.v >= 9 && Array.isArray(us.am)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++) {
                const _m = us.am[_t];
                S.trackAtMode[_t] = (typeof _m === 'number' && _m >= 0 && _m <= 2) ? (_m | 0) : 0;
            }
        }
        /* Per-track Chromatic pad layout (Shift+Step 8). Additive field on v:9;
         * absent in older v:9 sidecars → defaults to In-Key (false). Restored
         * like to/tab — the post-restore computePadNoteMap picks it up. */
        if (Array.isArray(us.pchr)) {
            for (let _t = 0; _t < NUM_TRACKS; _t++)
                S.padLayoutChromatic[_t] = !!us.pchr[_t];
        }
    } else {
        S.scaleAware   = 1;
        S.metronomeVol = 100;
        S.trackPadMode[0] = PAD_MODE_DRUM;
        /* Sync t0's drum lane data + drumClipNonEmpty from the freshly-reset
         * DSP. syncClipsFromDsp already ran earlier in the post-DSP-sync
         * drain, but its drum-sync block was gated on JS trackPadMode==DRUM,
         * which was MELODIC at the time (doClearSession reset it). Without
         * this catch-up, S.drumClipNonEmpty[0] + drum lane meta retain pre-
         * Clear values and t1's session/drum pad LEDs render stale. */
        if (applyDefaultsNow && typeof host_module_get_param === 'function') {
            syncDrumClipContent(0);
            syncDrumLanesMeta(0);
            syncDrumLaneSteps(0, S.activeDrumLane[0] | 0);
        }
        if (applyDefaultsNow) {
            /* push, not reassign — a reassignment would discard set_params
             * already queued this init (audit js-tick-4). */
            S.pendingDefaultSetParams.push(
                { key: 'scale_aware', val: '1' },
                { key: 'metro_vol',   val: '100' },
                { key: 't0_pad_mode', val: String(PAD_MODE_DRUM) }
            );
        }
    }
}

/* ------------------------------------------------------------------ */
/* Clip / mute-solo sync from DSP (full + targeted)                     */
/* ------------------------------------------------------------------ */

export function syncClipsFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    for (let t = 0; t < NUM_TRACKS; t++) {
        for (let c = 0; c < NUM_CLIPS; c++) {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    S.clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                S.clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined)
                S.clipLength[t][c] = parseInt(len, 10) || 16;
            const ls = host_module_get_param('t' + t + '_c' + c + '_loop_start');
            if (ls !== null && ls !== undefined)
                S.clipLoopStart[t][c] = parseInt(ls, 10) | 0;
            const tpsRaw = host_module_get_param('t' + t + '_c' + c + '_tps');
            if (tpsRaw !== null && tpsRaw !== undefined) {
                const tpsVal = parseInt(tpsRaw, 10);
                S.clipTPS[t][c] = TPS_VALUES.indexOf(tpsVal) >= 0 ? tpsVal : 24;
            }
            var ccll = host_module_get_param('t' + t + '_c' + c + '_cc_lane_loops');
            if (ccll) {
                var _vals = ccll.split(' ');
                for (var _k = 0; _k < 8 && _k * 4 + 3 < _vals.length; _k++) {
                    S.ccLaneLoopStart[t][c][_k] = parseInt(_vals[_k * 4], 10) | 0;
                    S.ccLaneLength[t][c][_k]    = parseInt(_vals[_k * 4 + 1], 10) | 0;
                    S.ccLaneTps[t][c][_k]       = parseInt(_vals[_k * 4 + 2], 10) | 0;
                    S.ccLaneResTps[t][c][_k]    = parseInt(_vals[_k * 4 + 3], 10) | 0;
                }
            }
        }
        const ac2 = host_module_get_param('t' + t + '_active_clip');
        if (ac2 !== null && ac2 !== undefined) {
            S.trackActiveClip[t] = parseInt(ac2, 10) | 0;
            S.lastDspActiveClip[t] = S.trackActiveClip[t];
        }
        const po = host_module_get_param('t' + t + '_pad_octave');
        if (po !== null && po !== undefined) S.padOctave[t] = parseInt(po, 10) | 0;
        readTrackConfig(t);
        for (let b = 0; b < 7; b++) readBankParams(t, b);
        readTarpStepVel(t);
        readDrumRepeatRates(t);
        /* Drum track: sync clip content flags and active lane data */
        if (S.trackPadMode[t] === PAD_MODE_DRUM) {
            syncDrumClipContent(t);
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        }
        /* Clamp the visible page into the (possibly non-zero) window so that
         * the step LEDs aren't stuck at absolute page 0 on session load when
         * the active clip has a loop_start > 0. */
        {
            const _ac = S.trackActiveClip[t];
            const _ls = (S.trackPadMode[t] === PAD_MODE_DRUM)
                ? (S.drumLaneLoopStart[t] | 0)
                : (S.clipLoopStart[t][_ac] | 0);
            const _ln = (S.trackPadMode[t] === PAD_MODE_DRUM)
                ? (S.drumLaneLength[t] | 0)
                : (S.clipLength[t][_ac] | 0);
            if (_ln > 0) {
                const _startPage = Math.floor(_ls / 16);
                const _lastPage  = Math.floor((_ls + _ln - 1) / 16);
                if (S.trackCurrentPage[t] < _startPage || S.trackCurrentPage[t] > _lastPage)
                    S.trackCurrentPage[t] = _startPage;
            }
        }
    }
    const kp = host_module_get_param('key');
    if (kp !== null && kp !== undefined) S.padKey   = parseInt(kp, 10) | 0;
    const sp = host_module_get_param('scale');
    if (sp !== null && sp !== undefined) S.padScale = parseInt(sp, 10) | 0;
    const lqp = host_module_get_param('launch_quant');
    if (lqp !== null && lqp !== undefined) S.launchQuant = parseInt(lqp, 10) | 0;
    const iqp = host_module_get_param('inp_quant');
    if (iqp !== null && iqp !== undefined) S.inpQuant = iqp === '1';
    const micp = host_module_get_param('midi_in_channel');
    if (micp !== null && micp !== undefined) S.midiInChannel = parseInt(micp, 10) | 0;
    const monRaw = host_module_get_param('metro_on');
    if (monRaw !== null && monRaw !== undefined) {
        S.metronomeOn = parseInt(monRaw, 10) | 0;
        if (S.metronomeOn !== 0) S.metronomeOnLast = S.metronomeOn;
    }
    const mvolRaw = host_module_get_param('metro_vol');
    if (mvolRaw !== null && mvolRaw !== undefined) S.metronomeVol = parseInt(mvolRaw, 10) | 0;
    const swaRaw = host_module_get_param('swing_amt');
    if (swaRaw !== null && swaRaw !== undefined) S.swingAmt = parseInt(swaRaw, 10) | 0;
    const swrRaw = host_module_get_param('swing_res');
    if (swrRaw !== null && swrRaw !== undefined) S.swingRes = parseInt(swrRaw, 10) | 0;
}

/* Targeted re-sync after undo/redo: re-read only the affected clips rather than all 64.
 * infoStr format: "d t c" (drum) or "m t0 c0 t1 c1 ..." (melodic, 1-16 pairs).
 * Falls back to full syncClipsFromDsp() if infoStr is missing or unparseable. */
export function syncClipsTargeted(infoStr) {
    if (!infoStr || typeof host_module_get_param !== 'function') { syncClipsFromDsp(); return; }
    const parts = infoStr.split(' ');
    if (parts.length < 3) { syncClipsFromDsp(); return; }
    const isDrum = parts[0] === 'd';
    let i = 1;
    /* Parse melodic/drum pairs, stopping at any 'DR' token */
    while (i + 1 < parts.length) {
        if (parts[i] === 'DR') break;
        const t = parseInt(parts[i], 10), c = parseInt(parts[i + 1], 10);
        i += 2;
        if (t < 0 || t >= NUM_TRACKS || c < 0 || c >= NUM_CLIPS) continue;
        if (isDrum) {
            syncDrumClipContent(t);
            syncDrumLanesMeta(t);
            syncDrumLaneSteps(t, S.activeDrumLane[t]);
            refreshDrumLaneBankParams(t, S.activeDrumLane[t]);
        } else {
            const bulk = host_module_get_param('t' + t + '_c' + c + '_steps');
            if (bulk && bulk.length >= NUM_STEPS) {
                for (let s = 0; s < NUM_STEPS; s++)
                    S.clipSteps[t][c][s] = bulk[s] === '1' ? 1 : 0;
                S.clipNonEmpty[t][c] = clipHasContent(t, c);
            }
            const len = host_module_get_param('t' + t + '_c' + c + '_length');
            if (len !== null && len !== undefined) S.clipLength[t][c] = parseInt(len, 10) || 16;
            const tpsRaw = host_module_get_param('t' + t + '_c' + c + '_tps');
            if (tpsRaw !== null && tpsRaw !== undefined) {
                const tpsVal = parseInt(tpsRaw, 10);
                S.clipTPS[t][c] = TPS_VALUES.indexOf(tpsVal) >= 0 ? tpsVal : 24;
            }
            if (c === S.trackActiveClip[t]) refreshPerClipBankParams(t);
        }
        const _abits = host_module_get_param('t' + t + '_c' + c + '_cc_auto_bits');
        S.trackCCAutoBits[t][c] = _abits !== null ? (parseInt(_abits, 10) || 0) : 0;
        const _arest = host_module_get_param('t' + t + '_c' + c + '_cc_rest');
        if (_arest) {
            const _arp = _arest.split(' ');
            for (let k = 0; k < 8; k++) {
                const rv = parseInt(_arp[k], 10);
                S.clipCCVal[t][c][k] = (rv >= 0 && rv <= 127) ? rv : -1;
            }
        }
        const _ath = host_module_get_param('t' + t + '_c' + c + '_at_has');
        S.clipAtHas[t][c] = (_ath !== null && parseInt(_ath, 10) === 1);
    }
    /* Parse 'DR rowN' tokens — resync drum clip content for all tracks at those rows */
    while (i + 1 < parts.length) {
        if (parts[i] !== 'DR') { i += 2; continue; }
        const rowIdx = parseInt(parts[i + 1], 10);
        i += 2;
        if (rowIdx < 0 || rowIdx >= NUM_CLIPS) continue;
        for (let t2 = 0; t2 < NUM_TRACKS; t2++) {
            syncDrumClipContent(t2);
            if (rowIdx === S.trackActiveClip[t2]) {
                syncDrumLanesMeta(t2);
                syncDrumLaneSteps(t2, S.activeDrumLane[t2]);
                refreshDrumLaneBankParams(t2, S.activeDrumLane[t2]);
            }
        }
    }
    S.screenDirty = true;
}

export function syncMuteSoloFromDsp() {
    if (typeof host_module_get_param !== 'function') return;
    const muteStr = host_module_get_param('mute_state');
    const soloStr = host_module_get_param('solo_state');
    if (muteStr) for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackMuted[_t]  = muteStr[_t]  === '1';
    if (soloStr) for (let _t = 0; _t < NUM_TRACKS; _t++) S.trackSoloed[_t] = soloStr[_t] === '1';
    for (let _n = 0; _n < 16; _n++) {
        const snap = host_module_get_param('snap_' + _n);
        if (snap && snap.length >= 17) {
            S.snapshots[_n] = {
                mute: Array.from(snap.substring(0, 8)).map(function(c) { return c === '1'; }),
                solo: Array.from(snap.substring(9, 17)).map(function(c) { return c === '1'; })
            };
        } else {
            S.snapshots[_n] = null;
        }
    }
    const saRaw = host_module_get_param('scale_aware');
    if (saRaw !== null && saRaw !== undefined) S.scaleAware = saRaw === '1' ? 1 : 0;
    S.screenDirty = true;
}

/* True when the track's currently-focused clip has NO note/hit data.
 * Note data only — CC-lane automation does not count (a CC-only clip is
 * "empty" here). Used to gate implicit focused-clip auto-launch so a clip the
 * user intentionally left off is not re-activated by scrolling / transport
 * start. */
export function _focusedClipIsEmpty(t) {
    return _clipIsEmpty(t, S.trackActiveClip[t]);
}

/* Universal unlatch sweep — clears Rpt1, Rpt2 latched lanes, and TARP latch
 * chip on every track. Called from both branches of the Delete+Play
 * handler so the gesture leaves UI mirrors and audio in agreement
 * regardless of transport state. DSP-side, tN_tarp_latch=0 invokes
 * tarp_drop_latched()→tarp_silence() to clear held-buffer entries and
 * cancel any sounding TARP note. */
export function unlatchAllTracks() {
    for (let t = 0; t < NUM_TRACKS; t++) {
        if (S.drumRepeatLatched[t]) {
            S.drumRepeatLatched[t] = false;
            S.drumRepeatHeldPad[t] = -1;
            S.drumRepeatHeldPadsStack[t].length = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_repeat_stop', val: '1' });
        }
        if (S.drumRepeat2LatchedLanes[t].size > 0) {
            S.drumRepeat2LatchedLanes[t].forEach(function(lane) {
                S.pendingDefaultSetParams.push({ key: 't' + t + '_drum_repeat2_lane_off', val: String(lane) });
            });
            S.drumRepeat2LatchedLanes[t].clear();
        }
        if (S.bankParams[t] && S.bankParams[t][5] && S.bankParams[t][5][7]) {
            S.bankParams[t][5][7] = 0;
            S.pendingDefaultSetParams.push({ key: 't' + t + '_tarp_latch', val: '0' });
        }
    }
}
