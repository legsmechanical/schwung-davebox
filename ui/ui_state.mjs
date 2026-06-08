/* ui_state.mjs
 * All shared mutable state for SEQ8.
 * Import: import { S } from './ui_state.mjs';
 * Read: S.varName   Write: S.varName = v  or  S.arr[i] = v
 */


export const PERF_FACTORY_PRESETS = [
    /* bits: 0=Oct↑ 1=Oct↓ 2=Sc↑ 3=Sc↓ 4=5th 5=Triton 6=Drift 7=Storm
             8=Soft 9=Hard 10=Cresc 11=Pulse 12=Sdchn 13=Stac 14=Lgto 15=RmpG
             16=½time 17=3Skip 18=Phnm 19=Sprs 20=Gltch 21=Stggr 22=Shfl 23=Back */
    { name: 'Float',    mods: (1<<2)|(1<<14) },           /* Sc↑ + Lgto */
    { name: 'Sink',     mods: (1<<1)|(1<<8)|(1<<13) },    /* Oct↓ + Decrsc + Stac */
    { name: 'Heartbt',  mods: (1<<11)|(1<<16) },          /* Pulse + ½time */
    { name: 'F.Dust',   mods: (1<<7)|(1<<9)|(1<<19) },    /* Storm + Swell + Sprs */
    { name: 'Robot',    mods: (1<<5)|(1<<11)|(1<<17) },   /* Triton + Pulse + 3Skip */
    { name: 'Dissolve', mods: (1<<6)|(1<<8)|(1<<18) },    /* Drift + Decrsc + Phnm */
    { name: 'Chaos',    mods: (1<<7)|(1<<20)|(1<<23) },   /* Storm + Gltch + Back */
    { name: 'Lift',     mods: (1<<2)|(1<<10)|(1<<15) },   /* Sc↑ + Cresc + RmpG */
];

export const CC_ASSIGN_DEFAULTS = [7, 74, 71, 73, 72, 91, 93, 10];

export const S = {
    swingAmt: 0,
    swingRes: 0,
    inpQuant: false,
    midiInChannel: 0,
    beatMarkersEnabled: true,
    launchQuant: 0,
    scaleAware: 1,
    ledInitQueue: [],
    ledInitIndex: 0,
    ledInitComplete: false,
    shiftHeld: false,
    altMode: false,        /* sticky alt-param mode, toggled by jog-click; transient */
    _altPrevBank: -1,      /* diff-guard mirror for clearing altMode on bank change */
    _altPrevTrack: -1,     /* diff-guard mirror for clearing altMode on track change */
    _altBlinkPhase: -1,    /* tick-driven phase (0/1) for the alt-mode arrow flash */
    shiftTrackLEDActive: false,
    loopHeld: false,
    perfSync: true,
    perfStack: [],
    perfStickyLengths: new Set(),
    perfHoldPadHeld: false,
    perfModsToggled: 0,
    perfModsHeld: 0,
    perfLatchMode: true,
    perfLatchPressedTick: -1,
    perfSnapshots: PERF_FACTORY_PRESETS.map(function(p) { return p.mods; })
                           .concat(new Array(8).fill(0)),  /* slots 8-15 empty */
    perfRecalledSlot: -1,
    perfModPopupName: '',
    perfModPopupEndTick: -1,
    perfViewLocked: false,
    loopJogActive: false,    /* true while jog is turned with loop held (step view vs pages view) */
    loopPressTick: -1,
    loopLastTapEndTick: -999,
    /* Loop+step range gesture: held start page → tap end page → atomic loop_set.
     * Press of step A defers; tap of step B before release fires the new range
     * (and any further taps re-set end without release). Release of A with no
     * second tap falls back to the existing length-set behavior. Cleared on
     * Loop button release too so a partial gesture doesn't leak. */
    loopGestureStart: -1,
    loopGestureFired: false,
    /* Tap-loop-alone unlatch (drum tracks): snapshot taken at Loop press time
     * of "active drum track with no pads/lanes held + no notes live". On tap
     * release, unlatch all Rpt1/Rpt2 latched on that track. -1 = ineligible. */
    loopTapUnlatchTrack: -1,
    loopGestureCtx:   0,   /* 0 = melodic, 1 = drum lane, 2 = ALL LANES */
    loopGestureTrack: -1,
    loopGestureClip:  -1,
    loopGestureLane:  -1,
    padKey: 9,
    padScale: 1,
    padOctave: new Array(8).fill(3),
    padNoteMap: new Array(32).fill(60),
    padScaleSet: new Set(),      /* semitones 0-11 in current key+scale; updated by computePadNoteMap */
    clipSteps: Array.from({length: 8}, () =>
                           Array.from({length: 16}, () => new Array(256).fill(0))),
    clipNonEmpty: Array.from({length: 8}, () => new Array(16).fill(false)),
    clipLength: Array.from({length: 8}, () => new Array(16).fill(16)),
    clipLoopStart: Array.from({length: 8}, () => new Array(16).fill(0)),
    clipTPS: Array.from({length: 8}, () => new Array(16).fill(24)),
    /* Per-clip playback direction: 0=Fwd, 1=Bwd, 2=PPFwd, 3=PPBwd.
     * Mirrors DSP clip.playback_dir; refreshed on clip switch / sidecar load. */
    clipPlaybackDir: Array.from({length: 8}, () => new Array(16).fill(0)),
    /* Per-track-per-lane playback direction for drum (active clip's lane).
     * Mirrors DSP drum lane clip.playback_dir; refreshed on lane / clip switch. */
    drumLanePlaybackDir: Array.from({length: 8}, () => new Array(32).fill(0)),
    /* Per-clip playback style: 0=Step, 1=Audio (note-on at note's end in
     * reverse motion). Mirrors DSP clip.playback_audio_reverse. */
    clipPlaybackAudioReverse: Array.from({length: 8}, () => new Array(16).fill(0)),
    /* Per-track-per-lane playback style for drum. */
    drumLanePlaybackAudioReverse: Array.from({length: 8}, () => new Array(32).fill(0)),
    /* "REC Unavailable / Set Dir to Fwd or Bake" confirm dialog. Set when
     * Record is pressed on a non-Forward / Audio clip. Sel: 0=OK (default,
     * dismiss), 1=BAKE NOW (opens standard bake confirm). Jog turn flips
     * selection; jog click commits. */
    recordBlockedDialog: false,
    recordBlockedDialogSel: 0,
    clipSeqFollow: Array.from({length: 8}, () => new Array(16).fill(true)),
    trackCurrentStep: new Array(8).fill(-1),
    trackCurrentPage: new Array(8).fill(0),
    activeDrumLane: new Array(8).fill(0),
    drumLanePage: new Array(8).fill(0),
    drumLaneSteps: Array.from({length: 8}, () =>
    Array.from({length: 32}, () => new Array(256).fill('0'))),
    drumLaneHasNotes: Array.from({length: 8}, () => new Array(32).fill(false)),
    drumLaneNote: Array.from({length: 8}, () =>
    Array.from({length: 32}, (_, l) => 36 + l)),
    drumLastVelZone: new Array(8).fill(12),
    drumVelZoneArmed: new Array(8).fill(false),  /* per-track: has a vel-pad been pressed? gates sticky zone for step entry */
    drumLaneLength: new Array(8).fill(16),
    drumLaneLoopStart: new Array(8).fill(0),
    drumLaneTPS: new Array(8).fill(24),
    drumLaneEuclidN: Array.from({length: 8}, () => new Array(32).fill(0)),
    drumStepPage: new Array(8).fill(0),
    drumCurrentStep: new Array(8).fill(-1),
    drumLaneFlashTick: Array.from({length: 8}, () => new Array(32).fill(-999)),
    drumLaneMute: new Array(8).fill(0),
    drumLaneSolo: new Array(8).fill(0),
    drumLaneQnt: new Array(8).fill(0),
    /* NOTE FX K5 Len: per-track[8] × per-lane[32], 0..8 (0=`--`, 1..8 = fixed). */
    drumLaneLenMode: Array.from({length: 8}, () => new Array(32).fill(0)),
    /* CLIP K8 / DRUM LANE K8 "Lgto" destructive confirm dialog. Set when the
     * user right-turns the Lgto knob. Sel: 0=OK (default, apply), 1=CANCEL.
     * Jog turn flips selection; jog click commits. */
    confirmLgto: false,
    confirmLgtoSel: 0,
    confirmLgtoIsDrum: false,
    allLanesQntResetTick: -1,   /* tick at which to reset bankParams[t][7][3] to -1 after knob release */
    allLanesQntResetTrack: -1,
    allLanesResResetTick: -1,
    allLanesResResetTrack: -1,
    allLanesDirResetTick: -1,
    allLanesDirResetTrack: -1,
    drumPerformMode: new Array(8).fill(0),
    drumRepeatHeldPad: new Array(8).fill(-1),
    drumRepeatHeldPadVel: new Array(8).fill(100),
    drumRepeatHeldPadsStack: Array.from({length: 8}, () => []),
    drumRepeatLatched: new Array(8).fill(false),
    pendingRepeatLane: -1,
    pendingRepeatLaneTrack: 0,
    drumRepeat2HeldLanes: Array.from({length: 8}, () => new Set()),
    drumRepeat2LatchedLanes: Array.from({length: 8}, () => new Set()),
    drumRepeat2RatePerLane: Array.from({length: 8}, () => new Array(32).fill(2)),
    rpt2LoopPadUsed: false,
    drumRepeatGate: Array.from({length: 8}, () => new Array(32).fill(0xFF)),
    drumRepeatGateLen: Array.from({length: 8}, () => new Array(32).fill(8)),
    drumRepeatVelScale: Array.from({length: 8}, () =>
    Array.from({length: 32}, () => new Array(8).fill(100))),
    drumRepeatNudge: Array.from({length: 8}, () =>
    Array.from({length: 32}, () => new Array(8).fill(0))),
    seqArpStepVel: Array.from({length: 8}, () =>
    Array.from({length: 16}, () => new Array(8).fill(4))),
    tarpStepVel: Array.from({length: 8}, () => new Array(8).fill(4)),
    /* Per-step scale-degree offset (-14..+14) for SEQ ARP (per-clip) and TARP (per-track).
     * Edited via the Arp Steps interval-mode overlay (jog click on bank 4 or 5). */
    seqArpStepInt: Array.from({length: 8}, () =>
    Array.from({length: 16}, () => new Array(8).fill(0))),
    tarpStepInt: Array.from({length: 8}, () => new Array(8).fill(0)),
    /* Per-pattern step-loop length (1..8, default 8). Governs both step_vel and
     * step_int playback indexing — pattern wraps at this length. */
    seqArpStepLoopLen: Array.from({length: 8}, () => new Array(16).fill(8)),
    tarpStepLoopLen:   new Array(8).fill(8),
    /* Arp Steps interval-mode overlay flag — true while the user has clicked
     * jog on bank 4 (SEQ ARP) or 5 (TARP). Auto-clears on next jog turn. */
    stepIntervalMode: false,
    /* TARP held-buffer mirror: pitches in DSP tarp.held_pitch[] for each track.
     * Polled from t{n}_tarp_held when tarp_latch is on; used to light source
     * pads in melodic Track View while the chord is latched. */
    tarpHeldNotes: Array.from({length: 8}, () => new Set()),
    noteFXRandomMode: new Array(8).fill(2),
    midiDlyRandomMode: new Array(8).fill(2),
    allLanesConfirmed: false,
    drumClipNonEmpty: Array.from({length: 8}, () => new Array(16).fill(false)),
    trackActiveClip: new Array(8).fill(0),
    lastDspActiveClip: new Array(8).fill(0),
    trackQueuedClip: new Array(8).fill(-1),
    trackChannel: new Array(8).fill(1),
    trackRoute: new Array(8).fill(0),
    schwungCoRunSlot: -1,                     /* -1 = off; 0-3 = Schwung chain editor is co-running on this slot (dAVEBOx skips OLED + suppresses track-button LEDs) */
    _coRunChanSlots: 0,                       /* Schwung co-run: bitmask (bits 0-3) of slots whose receive channel matches the active track; blinked on the side buttons. 0 = none. Refreshed on poll cadence. */
    pendingSchwungCoRunTrack: -1,             /* -1 = none; t = track queued to enter Schwung co-run; slot resolved in tick (schSlotsForTrack) so shadow_get_slots runs in tick context */
    pendingSchwungCoRunDelay: 0,             /* >0 = ticks remaining before entering co-run after a no-match "NO SLOT" popup (lets the message show before the editor takes the OLED) */
    moveCoRunTrack: -1,                       /* -1 = off; 0-3 = Move firmware is co-running on this track (dAVEBOx skips OLED; shim filters nav CCs + touch 0-9 from tool, lets them reach Move) */
    moveCoRunDrumHeld: -1,                    /* d1 note of drum lane pad held in co-run (Shift still active); -1 = none. note-off + Shift-off sent on physical release */
    trackPadMode: new Array(8).fill(0),
    trackVelOverride: new Array(8).fill(0),
    trackLooper: new Array(8).fill(1),
    /* Per-track pad-pressure (aftertouch) send mode: 0=Off, 1=Poly (0xA0), 2=Channel (0xD0).
     * Move route supports 0/1 only; Schwung/External support 0/1/2. Persisted in UI sidecar (am). */
    trackAtMode: new Array(8).fill(0),
    /* Per-pad last-sent aftertouch value (dedupe live send); -1 = none sent. Transient. */
    atLastSent: new Array(32).fill(-1),
    trackClipPlaying: new Array(8).fill(false),
    trackWillRelaunch: new Array(8).fill(false),
    trackPendingPageStop: new Array(8).fill(false),
    sceneBtnFlashTick: new Array(4).fill(-1),
    playing: false,
    activeTrack: 0,
    sessionView: false,
    hasInitedOnce: false,
    sceneRow: 0,
    flashEighth: false,
    flashSixteenth: false,
    masterPos: 0,
    dspLooperState: 0,
    dspMergeState: 0,
    dspMergeDstClip: 0,
    dspMergeTrack: -1,
    pendingMergeArm: false,
    pendingBankRefresh: -1,
    tickCount: 0,
    cachedSceneAllPlaying: new Array(16).fill(false),
    cachedSceneAllQueued: new Array(16).fill(false),
    cachedSceneAnyPlaying: new Array(16).fill(false),
    activeBank: 0,
    /* Per-track snapshot of activeBank. Saved at every track switch, restored
     * on track switch and on sidecar load. activeBank remains the live mirror
     * for the currently-active track; this array is the storage that survives
     * track changes and session reload. Sidecar v=8. */
    trackActiveBank: new Array(8).fill(0),
    /* Latches: track-button LED reclaim after Move-native co-run exit (Move
     * firmware writes CC 40-43 colors during co-run; dAVEBOx must blank them
     * once on exit). Schwung co-run has a parallel _coRunTrackLedsLit latch. */
    _moveCoRunTrackLedsActive: false,
    knobTouched: -1,
    knobAccum: new Array(8).fill(0),
    knobLastDir: new Array(8).fill(0),
    knobLocked: new Array(8).fill(false),
    knobTurnedTick: new Array(8).fill(-1),
    bankSelectTick: -1,
    jogTouched: false,
    stretchBlockedEndTick: -1,
    noNoteFlashEndTick: -1,
    trackOctave: new Array(8).fill(0),
    actionPopupEndTick: -1,
    actionPopupLines: [],
    actionPopupHighlight: -1,
    clockShiftTouchDelta: 0,
    screenDirty: true,
    lastBlinkOn: null,
    bankParams: null,  /* set in ui.js after BANKS is defined */
    trackCCAssign: Array.from({length: 8}, () => CC_ASSIGN_DEFAULTS.slice()),
    /* Per-knob continuous-modulation type: 0 = CC, 1 = Channel Pressure (aftertouch), 2 = Sch (chain knob). Per-track. */
    trackCCType: Array.from({length: 8}, () => new Array(8).fill(0)),
    /* Sch label cache: per-track per-lane param name string, null = not fetched. */
    schLabel: Array.from({length: 8}, () => new Array(8).fill(null)),
    /* Sch label fetch cursor: -1 = idle, 0-7 = fetching lane N next tick. */
    schLabelFetchLane: -1,
    /* Per-clip resting value ("clip CC") per knob; -1 = "—" (unset, send nothing). */
    clipCCVal: Array.from({length: 8}, () => Array.from({length: 16}, () => new Array(8).fill(-1))),
    trackCCAutoBits: Array.from({length: 8}, () => new Array(16).fill(0)),
    /* Per-clip "has recorded aftertouch automation" (AUTOMATION-bank indicator). */
    clipAtHas: Array.from({length: 8}, () => new Array(16).fill(false)),
    trackCCLiveVal: Array.from({length: 8}, () => new Array(8).fill(-1)),
    /* Active CC lane (last-touched knob) per track — persistent, drives the
     * step-LED gradient and the always-highlighted overview cell. */
    ccActiveLane: new Array(8).fill(0),
    ccLaneLoopStart: Array.from({length: 8}, function() {
        return Array.from({length: 16}, function() { return new Array(8).fill(0); });
    }),
    ccLaneLength: Array.from({length: 8}, function() {
        return Array.from({length: 16}, function() { return new Array(8).fill(0); });
    }),
    ccLaneTps: Array.from({length: 8}, function() {
        return Array.from({length: 16}, function() { return new Array(8).fill(0); });
    }),
    ccLaneResTps: Array.from({length: 8}, function() {
        return Array.from({length: 16}, function() { return new Array(8).fill(0); });
    }),
    /* CC-knob acceleration (fractional accumulator + run-based gain): per knob,
     * last turn time, direction, consecutive-detent run, and the sub-unit
     * accumulator. */
    knobAccelLast: new Array(8).fill(0),
    knobAccelDir:  new Array(8).fill(0),
    knobAccelRun:  new Array(8).fill(0),
    knobAccelAcc:  new Array(8).fill(0),
    /* Clip index needing a CC auto-bits/rest re-read on next tick (-1 = none).
     * Set from MIDI handlers where get_param returns null (e.g. Delete+step). */
    pendingCCBitsRefresh: -1,
    heldStepBtn: -1,
    heldStep: -1,
    heldStepNotes: [],
    stepWasEmpty: false,
    stepWasHeld: false,
    stepEditVel: 100,
    stepEditGate: 12,
    stepEditNudge: 0,
    /* Per-step trig conditions (v=34). All zero = defaults (always play, 100%, no ratchet).
     * stepEditIter:  raw byte 0 or (cycle_len<<4) | cycle_idx
     * stepEditRand:  0 = 100%, 1..100 = probability percent
     * stepEditRatch: 0|1 = no ratchet, 2..4 = sub-hit count */
    stepEditIter: 0,
    stepEditRand: 0,
    stepEditRatch: 0,
    ccStepEditVal: new Array(8).fill(0),
    /* Per-knob: does the held step have a recorded point? (drives "—" vs value) */
    ccStepEditSet: new Array(8).fill(false),
    /* Per-knob: computed output value at the held step (-1 = "—"); what plays there. */
    ccStepEditComputed: new Array(8).fill(-1),
    ccStepEditActive: false,
    /* CC-bank step-LED gradient: cached active-lane output values for the page
     * (255 = "—"), the cache key (track/clip/lane/page), and which track's 6
     * gradient palette entries are currently loaded. */
    ccGradVals: new Array(16).fill(255),
    ccGradHasBP: new Array(16).fill(false),
    ccGradKey: '',
    ccGraphOvData: [],
    ccGraphOvKey: '',
    ccGradPaletteTrack: -1,
    stepBtnPressedTick: new Array(16).fill(-1),
    lastPlayedNote: -1,
    lastPadVelocity: 100,
    liveActiveNotes: new Set(),
    seqActiveNotes: new Set(),
    seqLastStep: -1,
    seqLastClip: -1,
    seqNoteOnClipTick: -1,
    seqNoteGateTicks: 0,
    deleteHeld: false,
    muteHeld: false,
    muteUsedAsModifier: false,
    captureHeld: false,
    captureUsedAsModifier: false,    /* set true when a Capture-held gesture consumes the press (scene capture, drum lane select, etc.) — bare-tap clip/scene bake suppresses on release */
    pendingSceneBakePicker: false,   /* Session-View Capture tap → wait for next row/step press to pick scene → opens scene-bake confirm */
    pendingMergePlacement: false,    /* multi-track live merge stopped → wait for row/step press to pick destination scene row */
    metronomeOn: 1,
    metronomeOnLast: 1,
    metronomeVol: 100,
    metroPrevBeat: 0,
    metroNoteOffTick: -1,
    copyHeld: false,
    copySrc: null,
    lastSoloBlink: null,
    undoAvailable: false,
    redoAvailable: false,
    undoSeqArpSnapshot: null,
    redoSeqArpSnapshot: null,
    trackMuted: new Array(8).fill(false),
    trackSoloed: new Array(8).fill(false),
    snapshots: new Array(16).fill(null),
    _origClearScreen: null,
    _wasSuspended: false,
    globalMenuOpen: false,
    globalMenuItems: null,
    globalMenuState: null,
    globalMenuStack: null,
    globalMenuBuiltForTrack: -1,
    bpmWasEditing: false,
    lastSentMenuEditValue: null,
    confirmClearSession: false,
    confirmSaveState: false,       /* Save state Yes/No confirm dialog open */
    /* State version mismatch confirm dialog — shown when DSP detects an
     * old-format state file. Yes = wipe + clean start; No = exit module. */
    confirmStateWipe: false,
    confirmStateWipeSel: 1,   /* 0=Yes, 1=No (default) */
    /* Keys->Drums track conversion confirm dialog (transient, not persisted). */
    confirmConvertToDrum: false,
    confirmConvertToDrumSel: 1,   /* 0=Yes, 1=No (default) */
    confirmConvertTrack: 0,
    /* Keys->Conductor track conversion confirm dialog (transient, not persisted). */
    confirmConvertToConduct: false,
    confirmConvertToConductSel: 1,   /* 0=Yes, 1=No (default) */
    /* Generic menu INFO dialog: array of text lines (empty = closed). Single OK
     * button; any click/Back dismisses. Set via showMenuInfo(). */
    menuInfoLines: [],
    /* Deferred track-type conversion request: {t, toDrum} or null. Drained in
     * tick() so syncClipsFromDsp's get_param round-trips run in tick context. */
    pendingTrackConvert: null,
    /* Deferred Keys/Drums->Conductor convert request: track index or null.
     * Drained in tick() so convertTrackToConduct's get_param runs in context. */
    pendingConductConvert: null,
    /* Post-convert Conductor role readback: {t, prevMode} or null. Drained in
     * tick()/poll (get_param-safe) to detect a one-Conductor refusal. */
    pendingConductReadback: null,
    /* Current Conductor track index mirror (-1 = none). */
    conductorTrack: -1,
    /* Per-Conductor-clip mirrors of the three Conductor banks, indexed
     * [clip][track]. Populated from DSP get_params on sync (Task 2.3); written
     * by the knob handlers (Task 2.4). 16 clips x 8 tracks. */
    condResp: Array.from({length: 16}, function() { return new Array(8).fill(1); }),  /* responder on/off, default ON */
    condOct:  Array.from({length: 16}, function() { return new Array(8).fill(0); }),  /* octave offset -4..+4 */
    condWhen: Array.from({length: 16}, function() { return new Array(8).fill(0); }),  /* 0=Next, 1=Now */
    /* CdLk (Conductor Lock) per-clip, indexed [clip]. 0=Off (gate-hold,
     * transposition snaps to zero in note gaps), 1=Lock (sample-and-hold,
     * transposition persists through gaps; only changes on next conductor
     * note). Lives on the Conduct bank (CLIP bank 0) at K6. */
    condLock: new Array(16).fill(0),
    /* Mirror of the Conductor track's active clip index (which clip's bank
     * values the OLED grid renders). */
    condActiveClip: 0,
    confirmBake: false,
    confirmBakeSel: 1,
    confirmBakeIsDrum: false,
    confirmBakeTrack: 0,
    confirmBakeClip: 0,
    confirmBakeDrumLoopOpen: false,
    confirmBakeDrumLoopSel: 0,
    confirmBakeDrumMode: 0,
    confirmBakeScene: false,
    confirmBakeSceneSel: 0,
    confirmBakeSceneClip: 0,
    confirmBakeSceneWrapPhase: false,   /* mirrors clip-bake wrap phase: after loop count selected, ask wrap yes/no */
    confirmBakeSceneWrapSel: 1,         /* 0=YES, 1=NO (default), 2=CANCEL */
    confirmBakeSceneLoops: 1,           /* held loop count while in wrap phase */
    confirmBakeSceneWrap: 0,            /* held wrap flag while in conductor phase */
    confirmBakeSceneCondPhase: false,   /* after wrap: ask "Apply Conductor?" when a conductor + responders exist */
    confirmBakeSceneCondSel: 0,         /* 0=YES, 1=NO (default highlighted via index), 2=CANCEL */
    /* Transpose-on-key/scale-change: live preview override + commit confirm.
     * xposePrevKey/Scale are null unless a preview is armed (browsing Key/Scale
     * with a candidate ≠ committed); committed key/scale stay in padKey/padScale. */
    xposePrevKey: null,
    xposePrevScale: null,
    confirmXpose: false,
    confirmXposeSel: 0,                 /* 0=YES, 1=NO */
    confirmXposeKey: 0,                 /* candidate key/scale captured at the commit click */
    confirmXposeScale: 0,
    sampleHeld: false,
    sampleUsedAsModifier: false,
    pendingSceneBakeResync: 0,
    pendingSceneBakeClip: 0,
    tapTempoOpen: false,
    tapTempoTapTimes: [],
    tapTempoBpm: 120,
    tapTempoFlashTick: -1,
    tapTempoFlashPad: -1,
    confirmClearSel: 1,
    confirmSaveSel: 1,             /* Save state confirm: 0 = Yes, 1 = No (default) */
    confirmSaveCount: 0,           /* snapshot count captured when Save confirm opens */
    confirmExport: false,          /* Ableton export Yes/No dialog open */
    confirmExportSel: 1,           /* 0 = Yes, 1 = No (default) */
    confirmExportCondPhase: false, /* export "Apply Conductor?" stage (after the export Yes) */
    confirmExportCondSel: 1,       /* 0 = YES, 1 = NO (default), 2 = CANCEL */
    exportApplyConductor: false,   /* fold the Conductor into responder clips at export time (non-destructive) */
    exportDoneDialog: false,       /* persistent "Exported to <path>" dialog (OK to dismiss) */
    exportDonePath: '',            /* full device path shown in the export-done dialog */
    exportDoneMissing: 0,          /* count of samples that couldn't be bundled */
    noteSessionPressedTick: -1,
    sessionOverlayHeld: false,
    overviewCache: null,
    recordArmed: false,
    /* True between Record-press during playback and the next page boundary
     * where DSP actually flips tr->recording=1. Drives the record-button blink
     * so the user sees the deferred start. */
    recordPendingPage: false,
    recordCountingIn: false,
    recordArmedTrack: -1,
    countInStartTick: -1,
    countInBeatStartTick: -1,
    countInQuarterTicks: 0,
    countInDspPrev: false,
    playingPrev: false,
    transportStartTick: 0,
    _recNoteOns: [],
    _recNoteOffs: [],
    recordBpm: 120,
    currentSetUuid: '',
    currentSetName: '',
    lastDspInstanceId: '',
    stepOpTick: -99,
    pendingSetLoad: false,
    pendingDspSync: 0,
    stateLoading: false,
    /* Boot splash: shown for ~2s on every fresh JS load (Move reboot or
     * full module re-launch via Shift+Back). Back-suspend → resume keeps the
     * existing module process and JS state, so the counter stays at 0 and
     * the splash does NOT re-show on resume. Decremented in tick(). */
    bootSplashTicks: 188,
    currentSplashIdx: 0,    /* index into SPLASH_FRAMES — rerolled on each splash entry edge */
    splashWasVisible: false,/* previous-tick flag for splash entry-edge detection */
    pendingSuspendSave: false,
    pendingExitAfterSave: false,   /* drained one tick after pendingSuspendSave fires; calls host_exit_module */
    pendingHideAfterSave: false,   /* drained one tick after pendingSuspendSave fires; calls host_hide_module */
    pendingExport: false,          /* Ableton .ablbundle export — set by menu action, drained in tick() (get_param-safe) */
    pendingExportRun: false,       /* phase 2 of export: armed after EXPORTING popup renders, does the blocking work */
    pendingPruneOrphans: false,
    nameIndexCache: null,    /* { name: uuid } map, lazy-loaded on first save */
    pendingInheritPicker: null,  /* { dstUuid, dstName, candidates: [{uuid,name}], selectedIndex } when picker is open */
    /* Snapshot picker (Save state / Load state). Self-contained modal like the
     * inherit picker. { mode:'load'|'overwrite', snaps:[{id,ts,label,sv}], sel,
     * confirm } where confirm is null or { kind:'load'|'overwrite'|'wipe',
     * sel:1(=No default), targetId, wipeIds }. */
    snapshotPicker: null,
    /* CLEAR AUTOMATION modal (Delete-tap on the AUTO bank). null = closed; else
     * { sel, at, cc } — sel 0..3 (AT/PB/CC/CLEAR), at/cc = checked-to-clear. */
    clearAutoMenu: null,
    /* Armed on Delete-press in the AUTO bank; any other input disarms it. A clean
     * Delete tap (still armed at release) opens the CLEAR AUTOMATION menu. */
    deleteTapArmed: false,
    /* Set one tick after a snapshot Save fires the DSP 'save'; the live state
     * file is on disk by then, so the copy-into-snapshot runs in tick().
     * { id, label } (id reused = overwrite). */
    pendingSnapshotCopy: null,
    pendingEditEntryTrack: -1,  /* Shift+Step3: deferred co-run entry. -1 = none; track idx = fire on Shift release so Shift state doesn't leak into Move/Schwung */
    pendingUndoSync: 0,
    pendingDefaultSetParams: [],
    clearDrainHold: 0,       /* clearClip sets this so the next pendingDefaultSetParams drain skips one tick — keeps the queued _clear out of the same buffer as the sync set_param fan-out from clearClip's call site */
    pendingStepsReread: 0,
    pendingStepsRereadTrack: 0,
    pendingStepsRereadClip: 0,
    pendingChordToStep: null,   /* pitches[] captured at step-press when pads already held */
    pendingChordPhase2: null,   /* {t,ac,step,pitches} — set_notes after _toggle activates step */
    pendingAllLanesStretchCheck: -1,   /* track index, -1 = none pending */
    pendingDrumResync: 0,
    pendingDrumResyncTrack: 0,
    pendingDrumLaneResync: 0,
    pendingDrumLaneResyncTrack: 0,
    pendingDrumLaneResyncLane: 0,
    extMidiRemapActive: false,
    lastTarpStyle: new Array(8).fill(1),
    padLayoutChromatic: new Array(8).fill(false),
    drumInpQuant: new Array(8).fill(0),   /* per-track drum input quantize index 0-8 */
    delayClockFb: new Array(8).fill(0),   /* per-track delay clock feedback -100..100, accessed via Shift+K1 on DELAY bank (K7 now hosts delay_retrig) */
    delayRetrig:  new Array(8).fill(0),   /* per-track delay retrig 0/1; K7 on DELAY bank */
    clipAdaptiveMode: Array.from({length: 8}, () => new Array(16).fill(false)),
    clipLengthManuallySet: Array.from({length: 8}, () => new Array(16).fill(false)),
    drumLaneLengthManuallySet: new Array(8).fill(false),
    recordScheduledStop: false,
    recordScheduledStopTarget: -1,
    pendingScheduledDisarm: false,
    pendingPrerollNote: null,       /* drum only: { track, lane, laneNote, vel, pressedAtTick, countInStart } */
    pendingPrerollNotes: [],        /* melodic chord: [{track, clip, pitch, vel, pressedAtTick, countInStart, releasedAtTick?}] */
    pendingPrerollToggleQueue: [],  /* remaining chord notes queued for step_0_toggle, one per tick */
    pendingPrerollGate: null,       /* { isDrum, track, lane/clip, gate } — sent the tick after last _step_0_toggle */
    pendingClearLengthTrack: -1, /* deferred length-reset after clip clear (avoids coalescing with clear cmd) */
    pendingClearLengthClip: -1,
    sessionViewMomentary: false, /* true while NoteSession is held and switched view temporarily */
    sessionStepHeld: -1,       /* step button (0-15) held in session view awaiting tap/hold decision */
    sessionStepHeldCtx: 0,     /* 1=perf preset, 2=mute snapshot */
    stepSaveFlashStartTick: -1, /* tick when hold-save flash began */
    stepSaveFlashEndTick: -1,  /* step button LEDs double-blink through this tick after save */

};
