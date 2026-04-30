/*
 * SEQ8 — RS7000-inspired 8-track MIDI sequencer for Ableton Move.
 * Phase 5: 8 tracks, 256 steps per clip. Tracks 0-3 route to native Move tracks
 *          via ROUTE_MOVE (fallback: SCHWUNG). Tracks 4-7 route to Schwung chains.
 *
 * Param namespace:
 *   tN_cM_step_S     — track N, clip M, step S on/off (S: 0..255)
 *   tN_cM_steps      — bulk get: 256-char '0'/'1' string for all steps
 *   tN_cM_length     — clip length (1..256)
 *   tN_launch_clip   — queue clip M on track N
 *   launch_scene     — queue clip M on all tracks
 *   tN_route         — "schwung" or "move"
 *   tN_<pfx_key>     — play effects (same as Phase 3)
 *
 * GLIBC SAFE: no C23 calls, no complex static initializers,
 * inline my_atoi() in place of atoi().
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <time.h>
#include <sys/stat.h>

#include "host/plugin_api_v1.h"

/* ------------------------------------------------------------------ */
/* Build constants                                                      */
/* ------------------------------------------------------------------ */

#define SEQ8_LOG_PATH           "/data/UserData/schwung/seq8.log"
#define SEQ8_STATE_PATH_FALLBACK "/data/UserData/schwung/seq8-state.json"

#define NUM_TRACKS          8
#define NUM_CLIPS           16

/* MIDI routing: where track output is delivered */
#define ROUTE_SCHWUNG  0   /* host->midi_send_internal → Schwung active chain */
#define ROUTE_MOVE     1   /* host->midi_inject_to_move → Move native tracks */

/* External MIDI queue: DSP buffers ROUTE_MOVE events; JS drains via get_param("ext_queue") */
#define EXT_QUEUE_SIZE 64
typedef struct { uint8_t s; uint8_t d1; uint8_t d2; } ext_msg_t;

/* Pad input modes */
#define PAD_MODE_MELODIC_SCALE  0   /* isomorphic 4ths diatonic layout */
#define PAD_MODE_DRUM           1   /* 32-lane drum sequencer */

/* Drum mode */
#define DRUM_LANES          32
/* Baseline MIDI note for lane 0 — standard Ableton Drum Rack layout.
 * Lane L plays note (DRUM_BASE_NOTE + L). Verify against live device before shipping. */
#define DRUM_BASE_NOTE      36

/* Scale-aware play effects: interval tables matching JS SCALE_INTERVALS order */
static const uint8_t SCALE_IVLS[14][8] = {
    {0, 2, 4, 5, 7, 9,11, 0},  /* 0  Major           */
    {0, 2, 3, 5, 7, 8,10, 0},  /* 1  Minor           */
    {0, 2, 3, 5, 7, 9,10, 0},  /* 2  Dorian          */
    {0, 1, 3, 5, 7, 8,10, 0},  /* 3  Phrygian        */
    {0, 2, 4, 6, 7, 9,11, 0},  /* 4  Lydian          */
    {0, 2, 4, 5, 7, 9,10, 0},  /* 5  Mixolydian      */
    {0, 1, 3, 5, 6, 8,10, 0},  /* 6  Locrian         */
    {0, 2, 3, 5, 7, 8,11, 0},  /* 7  Harmonic Minor  */
    {0, 2, 3, 5, 7, 9,11, 0},  /* 8  Melodic Minor   */
    {0, 2, 4, 7, 9, 0, 0, 0},  /* 9  Pent Major      */
    {0, 3, 5, 7,10, 0, 0, 0},  /* 10 Pent Minor      */
    {0, 3, 5, 6, 7,10, 0, 0},  /* 11 Blues           */
    {0, 2, 4, 6, 8,10, 0, 0},  /* 12 Whole Tone      */
    {0, 2, 3, 5, 6, 8, 9,11},  /* 13 Diminished      */
};
static const uint8_t SCALE_SIZES[14] = {7,7,7,7,7,7,7,7,7,5,5,6,6,8};

/* Sequencer engine */
#define BPM_DEFAULT         140
#define PPQN                96
#define TICKS_PER_STEP      24
#define GATE_TICKS          12
static const uint16_t TPS_VALUES[6] = {12, 24, 48, 96, 192, 384};
#define SEQ_STEPS           256   /* max steps per clip (array size) */
#define SEQ_STEPS_DEFAULT   16    /* default clip length on init     */
#define SEQ_NOTE            60
#define SEQ_VEL             100

/* Play effects (ported from NoteTwist) */
#define MAX_PFX_EVENTS      256
#define MAX_GEN_NOTES       6
#define MAX_REPEATS         16
#define UNISON_STAGGER      220          /* ~5 ms at 44100 Hz */
#define NUM_CLOCK_VALUES    11
#define MAX_DELAY_SAMPLES   (30ULL * 44100)

/* 1 SEQ8 tick = 480/96 = 5 clocks at 480 PPQN (NoteTwist's resolution) */
#define TICKS_TO_480PPQN    5

/* CLOCK_VALUES: delay intervals in 480 PPQN clocks (from NoteTwist) */
static const int CLOCK_VALUES[NUM_CLOCK_VALUES] = {
    0, 30, 60, 80, 120, 160, 240, 320, 480, 960, 1920
};

/* QUANT_STEPS: launch quantization in steps. 0=Now(1), 1=1/16(1), 2=1/8(2), 3=1/4(4), 4=1/2(8), 5=1-bar(16) */
static const uint32_t QUANT_STEPS[6] = {1, 1, 2, 4, 8, 16};


/* ------------------------------------------------------------------ */
/* Play effects structs (direct port from NoteTwist)                   */
/* ------------------------------------------------------------------ */

typedef struct {
    uint64_t fire_at;
    uint8_t  msg[3];
    uint8_t  len;
} pfx_event_t;

typedef struct {
    uint8_t  active;
    uint8_t  channel;
    uint64_t on_time;
    uint8_t  orig_velocity;
    uint8_t  gen_notes[MAX_GEN_NOTES];
    int      gen_count;
    int      stored_unison;
    double   spc;
    int      stored_repeat_count;
    struct {
        uint64_t cumul_delay;
        int8_t   pitch_offset;
        uint8_t  velocity;
        double   gate_factor;
    } reps[MAX_REPEATS];
} pfx_active_t;

/* SEQ ARP runtime engine state (per-track). Sits between NOTE FX and HARMZ in
 * the chain: when on=1, pfx_note_on funnels orig_note into held_pitch[] and the
 * render-tick-driven arp emits one note at a time, which is then passed through
 * NOTE FX + HARMZ + DELAY just like a normal sequenced note.
 *
 * Sole emit path while on=1: arp owns active_notes[primary] keying. */
#define ARP_MAX_HELD     16
#define ARP_MAX_OCTAVES  4
#define ARP_MAX_CYCLE    (ARP_MAX_HELD * ARP_MAX_OCTAVES) /* 64 */
#define ARP_RATE_DEFAULT 1                                /* 1/16 */

/* SEQ ARP rate index → master 96-PPQN ticks per arp step.
 * 0=1/32, 1=1/16, 2=1/16t, 3=1/8, 4=1/8t, 5=1/4, 6=1/4t, 7=1/2, 8=1/2t, 9=1-bar. */
static const uint16_t ARP_RATE_TICKS[10] = { 12, 24, 16, 48, 32, 96, 64, 192, 128, 384 };

typedef struct {
    /* Live params mirrored from clip_pfx_params_t via pfx_apply_params */
    uint8_t  style;        /* 0=Off (bypass), 1..9=Up/Dn/U-D/D-U/Cnv/Div/Ord/Rnd/RnO */
    uint8_t  rate_idx;     /* 0..9 (index into ARP_RATE_TICKS) */
    int8_t   octaves;      /* -4..-1 or +1..+4 (signed; 0 skipped). Negative = descend by 12 per oct. */
    uint16_t gate_pct;     /* 1..200 percent of rate */
    uint8_t  steps_mode;   /* 0=Off, 1=Mute, 2=Skip */
    uint8_t  retrigger;    /* 0/1 — reset cycle/step on new note + clip wrap */
    uint8_t  step_vel[8];  /* level 0..4 (0=off, 1..4=row 0..3) */
    uint32_t master_anchor; /* arp_master_tick at last retrigger; step_pos = ((master-anchor)/rate) & 7 */

    /* Held input notes (insertion-ordered; index 0..held_count-1 valid) */
    uint8_t  held_pitch[ARP_MAX_HELD];
    uint8_t  held_vel[ARP_MAX_HELD];
    uint8_t  held_order[ARP_MAX_HELD];
    uint8_t  held_count;
    uint8_t  next_order;

    /* Cycle iteration */
    int16_t  cyc_pos;            /* index into ordered/expanded sequence */
    int8_t   ud_dir;             /* +1 / -1 for up_down / down_up */
    uint16_t cycle_step_count;   /* for vel_decay */
    uint64_t random_used;        /* bitmask of cycle indices used this round (Random Other) */

    /* Step pattern position */
    uint8_t  step_pos;           /* 0..7 */

    /* Clock — units: master 96-PPQN ticks */
    int32_t  ticks_until_next;
    uint8_t  pending_first_note;
    uint8_t  pending_retrigger;       /* set by arp_add_note + clip-wrap; consumed by arp_tick */

    /* Currently sounding emitted note */
    uint8_t  sounding_active;
    uint8_t  sounding_pitch;     /* primary pitch sent into NOTE FX */
    uint32_t gate_remaining;     /* in master ticks */
} arp_engine_t;

typedef struct {
    /* Note FX (stages 1+3 from NoteTwist: octave + note page) */
    int octave_shift;       /* -4..+4 */
    int note_offset;        /* -24..+24 */
    int gate_time;          /* 0..400 percent */
    int velocity_offset;    /* -127..+127 */
    /* Input quantize: 100=fully quantized (tick_offset ignored), 0=raw */
    int quantize;           /* 0..100 */
    /* Harmonize (stage 2 from NoteTwist) */
    int unison;             /* 0=off, 1=x2, 2=x3 */
    int octaver;            /* -4..+4, 0=off */
    int harmonize_1;        /* -24..+24, 0=off */
    int harmonize_2;        /* -24..+24, 0=off */
    /* MIDI Delay (stage 5 from NoteTwist) */
    int delay_time_idx;     /* 0..10, index into CLOCK_VALUES */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..16 */
    int fb_velocity;        /* -127..+127 */
    int fb_note;            /* -24..+24 */
    int fb_note_random;     /* 0 or 1 */
    int fb_gate_time;       /* -100..+100 */
    int fb_clock;           /* -100..+100 */
    /* SEQ ARP — last stage of the chain. NOTE FX → HARMZ → MIDI DLY emit
     * via pfx_send; when arp.on && !arp_emitting, pfx_send routes note-on/off
     * to the arp's held buffer instead of out. arp_fire_step emits raw via
     * pfx_send with arp_emitting=1 (no further chain processing). */
    arp_engine_t arp;
    uint8_t      arp_emitting;
    /* Runtime */
    uint64_t    sample_counter;
    double      cached_bpm;
    uint32_t    rng;
    pfx_event_t  events[MAX_PFX_EVENTS];
    int          event_count;
    pfx_active_t active_notes[128];
    /* Routing */
    uint8_t      route;     /* ROUTE_SCHWUNG or ROUTE_MOVE */
    /* Global MIDI Looper: 1 = this track's post-fx output is captured by the
     * looper and silenced during playback; 0 = bypass entirely. Default 1. */
    uint8_t      looper_on;
    uint8_t      track_idx;  /* 0..NUM_TRACKS-1; back-pointer for looper events */
} play_fx_t;

/* ------------------------------------------------------------------ */
/* Note-centric model (v10+)                                           */
/* ------------------------------------------------------------------ */

#define MAX_NOTES_PER_CLIP  512

typedef struct {
    uint32_t tick;               /* absolute clip tick 0..clip_len*TPS-1 */
    uint16_t gate;               /* gate duration in ticks */
    uint8_t  pitch;              /* MIDI note 0..127 */
    uint8_t  vel;                /* velocity 0..127 */
    uint8_t  active;             /* 1=in use, 0=tombstoned */
    uint8_t  suppress_until_wrap; /* 1=skip playback until clip wraps (recording suppressor) */
    uint8_t  step_muted;         /* 1=from an inactive step; present in notes[] but suppressed from MIDI */
    uint8_t  pad[1];
} note_t; /* 12 bytes */

/* ------------------------------------------------------------------ */
/* Per-clip play-effect params (17 fields, ~68 bytes)                  */
/* Runtime state (events, active_notes, sample_counter, cached_bpm,   */
/* rng, route) stays in play_fx_t inside seq8_track_t.                */
/* ------------------------------------------------------------------ */

typedef struct {
    int octave_shift;       /* -4..+4  */
    int note_offset;        /* -24..+24 */
    int gate_time;          /* 0..400 percent; default 100 */
    int velocity_offset;    /* -127..+127 */
    int quantize;           /* 0..100 */
    int unison;             /* 0=off, 1=x2, 2=x3 */
    int octaver;            /* -4..+4 */
    int harmonize_1;        /* -24..+24 */
    int harmonize_2;        /* -24..+24 */
    int delay_time_idx;     /* 0..10 */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..16 */
    int fb_velocity;        /* -127..+127 */
    int fb_note;            /* -24..+24 */
    int fb_note_random;     /* 0 or 1 */
    int fb_gate_time;       /* -100..+100 */
    int fb_clock;           /* -100..+100 */
    /* SEQ ARP per-clip params */
    int seq_arp_style;         /* 0=Off (bypass), 1..9=Up/Dn/U-D/D-U/Cnv/Div/Ord/Rnd/RnO */
    int seq_arp_rate;          /* 0..9 (index into ARP_RATE_TICKS) */
    int seq_arp_octaves;       /* -4..-1 or +1..+4 (skip 0; default +1) */
    int seq_arp_gate;          /* 1..200 percent */
    int seq_arp_steps_mode;    /* 0..2 (Off/Mute/Skip) */
    int seq_arp_retrigger;     /* 0/1; default 1 */
    uint8_t seq_arp_step_vel[8]; /* level 0..4 (0=off, 1..4=row 0..3); default 4 */
} clip_pfx_params_t;

/* ------------------------------------------------------------------ */
/* Clip and track structs                                               */
/* ------------------------------------------------------------------ */

typedef struct {
    uint8_t  steps[SEQ_STEPS];            /* 0=off, 1=on */
    uint8_t  step_notes[SEQ_STEPS][8];    /* up to 8 notes per step (chord); [0] = primary */
    uint8_t  step_note_count[SEQ_STEPS];  /* 0..8; 0 = step deactivated */
    uint8_t  step_vel[SEQ_STEPS];         /* default SEQ_VEL */
    uint16_t step_gate[SEQ_STEPS];        /* gate ticks 1..clip_len*TICKS_PER_STEP; raw, scaled at render */
    int16_t  note_tick_offset[SEQ_STEPS][8]; /* per-note ±23 within-step offset; 0=quantized */
    uint16_t length;                      /* 1..256, default 16 */
    uint8_t  active;                      /* 1 if any step is on */
    /* Per-clip: cumulative rotation offset for display. Destructive — step
     * data is actually rotated; this counter tracks how far from "origin".
     * Range 0..length-1. Reset to 0 on transport stop (active clip only). */
    uint16_t clock_shift_pos;
    /* Stretch exponent: 0=1x, +1=x2, +2=x4, -1=/2, -2=/4. Not persisted. */
    int8_t   stretch_exp;
    /* Cumulative nudge ticks since last clear — display only, not persisted. */
    int16_t  nudge_pos;
    /* Per-clip tick resolution; TPS_VALUES[0..5] = 12/24/48/96/192/384; default 24 (1/16). */
    uint16_t ticks_per_step;
    /* Per-clip play-effect params: NOTE FX, HARMZ, MIDI DLY. */
    clip_pfx_params_t pfx_params;
    /* Note-centric model (Stage B+): note list derived from step arrays at init */
    note_t   notes[MAX_NOTES_PER_CLIP];
    uint16_t note_count;         /* slots used (active+tombstoned); updated by set_param, not render */
    uint8_t  occ_cache[32];      /* 256-bit occupancy: bit S=1 if any active note in step S */
    uint8_t  occ_dirty;          /* 1 = occ_cache needs recomputation */
} clip_t;

/* ------------------------------------------------------------------ */
/* Drum mode data model                                                */
/* ------------------------------------------------------------------ */

/* One drum lane: a full monophonic melodic clip (all clip machinery reused) plus a
 * fixed base pitch. All params (length, tps, pfx, gate, vel, nudge) live here — there
 * are no container-wide params. pfx applies at render time so harmonize/delay can
 * sound other pitches beyond midi_note. */
typedef struct {
    clip_t  clip;       /* full clip_t — notes[], step arrays, length, tps, pfx_params */
    uint8_t midi_note;  /* base pitch written into every note at step-entry/record time */
    uint8_t _pad[3];
} drum_lane_t;          /* sizeof(clip_t) + 4 ≈ 13.7 KB */

/* A drum clip is a container of 32 independent monophonic lanes. It appears and
 * behaves like a melodic clip for launch, cut/copy/paste, session view, and undo,
 * but has no container-wide params — everything is per-lane. */
typedef struct {
    drum_lane_t lanes[DRUM_LANES];
} drum_clip_t;          /* DRUM_LANES × ~13.7 KB ≈ 438 KB */

/* Step-data-only snapshot of one drum lane — used for live recording undo/redo.
 * No notes[] array; clip_migrate_to_notes() rebuilds it from step arrays on restore. */
typedef struct {
    uint8_t  steps[SEQ_STEPS];
    uint8_t  step_notes[SEQ_STEPS][8];
    uint8_t  step_note_count[SEQ_STEPS];
    uint8_t  step_vel[SEQ_STEPS];
    uint16_t step_gate[SEQ_STEPS];
    int16_t  note_tick_offset[SEQ_STEPS][8];
    uint16_t length;
    uint8_t  active;
} drum_rec_snap_lane_t;  /* ~7.4 KB/lane × 32 = ~237 KB/slot */

typedef struct {
    uint8_t   channel;              /* MIDI channel 0-3 */
    clip_t    clips[NUM_CLIPS];
    uint8_t   active_clip;          /* clip currently active */
    int8_t    queued_clip;          /* next clip to launch at bar boundary (-1 = none) */
    uint16_t  current_step;
    uint8_t   note_active;
    /* Per-note deferred dispatch: notes with positive tick_offset fired mid-step */
    uint8_t   step_dispatch_mask;       /* bit N set = note index N not yet fired this step */
    uint8_t   step_dispatch_tick[8];    /* tick_in_step to fire each pending note */
    /* Lookahead: notes of the NEXT step already fired early (negative offset) */
    uint8_t   next_early_mask;          /* bit N set = note N of next step fired early */
    uint16_t  pending_gate;             /* effective gate stored at note-on */
    uint16_t  gate_ticks_remaining;     /* countdown to note-off; decrements every tick */
    uint8_t   pending_notes[8];         /* notes fired at note-on; matched at note-off */
    uint8_t   pending_note_count;       /* how many entries in pending_notes are valid */
    play_fx_t pfx;
    uint8_t   pad_octave;           /* live pad root octave (0-8, default 3) */
    uint8_t   pad_mode;             /* PAD_MODE_MELODIC_SCALE = 0 */
    uint8_t   stretch_blocked;      /* 1 if last compress was blocked by collision */
    uint8_t   recording;            /* 1 = actively recording (overdub) into active clip */
    uint8_t   clip_playing;         /* 1 = clip is actively running */
    uint8_t   will_relaunch;        /* 1 = was playing; restarts when transport plays */
    uint8_t   pending_page_stop;    /* 1 = stop at next main clock bar boundary (global_tick%16==0) */
    uint8_t   record_armed;         /* 1 = set recording=1 atomically when queued clip launches */
    /* Steps recorded in the current recording pass; cleared on clip wrap so they play
     * back starting from the next loop (not the pass they were recorded on). */
    uint8_t   live_recorded_steps[32]; /* 256-bit mask: 1 bit per step */
    /* Note-centric recording: in-flight note-ons awaiting note-off for gate capture */
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    uint8_t  rec_pending_count;
    /* Note-centric playback: per-note gate countdown (render state, not persisted) */
    struct { uint8_t pitch; uint16_t ticks_remaining; } play_pending[32];
    uint8_t  play_pending_count;
    /* Per-track tick position within current step; wraps at cl->ticks_per_step */
    uint32_t tick_in_step;
    /* Atomic render-state snapshot for set_param timing reads */
    uint32_t current_clip_tick;     /* current_step * TPS + tick_in_step; written each render tick */

    /* Drum mode: 16 clips, each containing 32 monophonic lanes.
     * Active when pad_mode == PAD_MODE_DRUM. active_clip/queued_clip/clip_playing
     * apply to drum_clips[] exactly as they do to clips[] in melodic mode. */
    drum_clip_t drum_clips[NUM_CLIPS];
    /* Per-lane render-state tick counters (not persisted; reset on transport play/clip launch). */
    uint16_t drum_current_step[DRUM_LANES];
    uint32_t drum_tick_in_step[DRUM_LANES];
    /* Per-lane mute/solo bitmasks (persisted). bit l = lane l. */
    uint32_t drum_lane_mute;
    uint32_t drum_lane_solo;
} seq8_track_t;
#define LRS_SET(tr, s)  ((tr)->live_recorded_steps[(s)>>3] |=  (uint8_t)(1u<<((s)&7)))
#define LRS_TEST(tr, s) ((tr)->live_recorded_steps[(s)>>3] &   (1u<<((s)&7)))

typedef struct {
    float        sample_rate;
    uint32_t     block_count;
    FILE        *log_fp;

    seq8_track_t tracks[NUM_TRACKS];
    uint8_t      active_track;

    /* Shared transport — all tracks run on the same timing grid */
    uint8_t  playing;
    uint32_t tick_accum;
    uint32_t tick_threshold;        /* sample_rate * 60 */
    uint32_t tick_delta;            /* MOVE_FRAMES_PER_BLOCK * BPM * PPQN */
    uint32_t master_tick_in_step;     /* drives global_tick and launch-quant at master 1/16 boundary */
    uint32_t global_tick;             /* steps elapsed since transport play; bar boundary = global_tick % 16 == 0 */
    uint32_t arp_master_tick;         /* free-running master tick for SEQ ARP; advances even while stopped, resets on transport play / count-in fire */

    /* DSP-side count-in: counts down in DSP ticks; fires transport+recording when done */
    int32_t  count_in_ticks;        /* remaining ticks; 0 = inactive */
    uint8_t  count_in_track;        /* track to arm for recording on fire */

    /* Metronome: clicks on quarter notes while recording/count-in is active */
    uint8_t  metro_on;              /* 0=off,1=count-in only,2=count+rec,3=always */
    uint8_t  metro_vol;             /* 0-100, default 80 */
    uint16_t metro_beat_count;      /* monotonic counter; incremented on each quarter-note beat */

    /* Print mode: bake chain output into step data */
    uint8_t  printing;

    /* Live pad input: global key/scale stored for state persistence */
    uint8_t  pad_key;               /* root key 0-11, default 9 (A) */
    uint8_t  pad_scale;             /* 0=Major (matches JS SCALE_NAMES index) */
    uint8_t  launch_quant;          /* 0=Now,1=1/16,2=1/8,3=1/4,4=1/2,5=1-bar; default 5 */

    /* External MIDI queue: ROUTE_MOVE note events buffered here; JS drains each tick */
    ext_msg_t ext_queue[EXT_QUEUE_SIZE];
    int       ext_head;             /* next write index */
    int       ext_tail;             /* next read index */

    /* State file path — set by JS via set_param("state_path") before first load/save */
    char state_path[256];

    /* Monotonic nonce: unique per create_instance call; JS polls to detect DSP hot-reload */
    uint32_t instance_nonce;

    /* Mute/solo per track: 0=off, 1=on */
    uint8_t mute[NUM_TRACKS];
    uint8_t solo[NUM_TRACKS];

    /* Mute/solo snapshots: 16 slots */
    uint8_t snap_mute[16][NUM_TRACKS];
    uint8_t snap_solo[16][NUM_TRACKS];
    uint8_t snap_valid[16];

    /* Scale-aware play effects: interpret Ofs/Hrm/delay-pitch in scale degrees */
    uint8_t scale_aware;
    /* Input velocity: 0=live (pass-through), 1-127=fixed */
    uint8_t input_vel;
    /* Input quantize: 1=snap live recording to step grid (zero offset), 0=unquantized */
    uint8_t inp_quant;
    /* External MIDI channel filter: 0=All, 1-16=specific channel */
    uint8_t midi_in_channel;

    /* 1-level undo/redo: up to UNDO_MAX_CLIPS clip snapshots per operation.
     * Row cut+paste needs 8 src + 8 dst = 16 slots. */
#define UNDO_MAX_CLIPS (NUM_TRACKS * 2)
    clip_t  undo_clips[UNDO_MAX_CLIPS];
    uint8_t undo_clip_tracks[UNDO_MAX_CLIPS];
    uint8_t undo_clip_indices[UNDO_MAX_CLIPS];
    uint8_t undo_clip_count;
    uint8_t undo_valid;
    clip_t  redo_clips[UNDO_MAX_CLIPS];
    uint8_t redo_clip_tracks[UNDO_MAX_CLIPS];
    uint8_t redo_clip_indices[UNDO_MAX_CLIPS];
    uint8_t redo_clip_count;
    uint8_t redo_valid;

    /* Drum-clip recording undo/redo — mutually exclusive with melodic undo_valid. */
    uint8_t  drum_undo_valid;
    uint8_t  drum_undo_track;
    uint8_t  drum_undo_clip;
    uint8_t  drum_redo_valid;
    uint8_t  drum_redo_track;
    uint8_t  drum_redo_clip;

    /* Drum effective-mute bitmask per snapshot slot per track (bit L = lane L muted). */
    uint32_t snap_drum_eff_mute[16][NUM_TRACKS];

    drum_rec_snap_lane_t drum_undo_lanes[DRUM_LANES];
    drum_rec_snap_lane_t drum_redo_lanes[DRUM_LANES];

    /* Global MIDI Looper.
     * State machine: IDLE -> ARMED (waiting for boundary) -> CAPTURING ->
     * LOOPING. Stop drops back to IDLE.
     * Capture/loop window length is in master 96-PPQN ticks. While CAPTURING
     * or LOOPING, looper_pos counts 0..capture_ticks-1.
     * pfx_send hooks: in CAPTURING, mirror note-on/off into looper_events[];
     * in LOOPING, suppress emit from looper_on tracks (the playback path
     * sets looper_emitting=1 to bypass the suppress). */
#define LOOPER_STATE_IDLE      0
#define LOOPER_STATE_ARMED     1
#define LOOPER_STATE_CAPTURING 2
#define LOOPER_STATE_LOOPING   3
#define LOOPER_MAX_EVENTS      1024
/* Performance modifier bitmask: each bit enables one effect on the looping stream. */
#define PERF_MOD_OCT_UP     (1u << 0)  /* PITCH:     +12 semitones */
#define PERF_MOD_SCALE_DOWN (1u << 1)  /* PITCH:     -1 scale degree (scale-aware) */
#define PERF_MOD_CRESC      (1u << 2)  /* VEL:       +13 per cycle, saturates at 127 */
#define PERF_MOD_SOFT_DECAY (1u << 3)  /* VEL:       ×0.5 */
#define PERF_MOD_STACCATO   (1u << 4)  /* GATE:      cap/8, via staccato_pending */
#define PERF_MOD_HALFTIME   (1u << 5)  /* WILD:      suppress every odd cycle */
#define PERF_MOD_GLITCH     (1u << 6)  /* WILD:      random pitch ±5 semitones */
#define PERF_MOD_SPARSE     (1u << 7)  /* WILD:      ~50% random event suppression */
    uint8_t  looper_state;
    uint8_t  looper_emitting;       /* set during playback emit; pfx_send skips capture/suppress */
    uint16_t looper_capture_ticks;  /* total length of the loop window in master ticks */
    uint32_t looper_pos;            /* 0..capture_ticks-1; advances each master tick while CAPTURING/LOOPING */
    uint16_t looper_play_idx;       /* next event index during LOOPING playback */
    uint16_t looper_event_count;
    /* Queued rate change: while LOOPING, looper_arm with a different rate sets
     * this; at the next loop boundary we transition LOOPING → ARMED with the
     * new rate so the switch lands cleanly on the beat. 0 = no pending. */
    uint16_t looper_pending_rate_ticks;
    struct {
        uint16_t tick;              /* 0..capture_ticks-1 */
        uint8_t  status;
        uint8_t  d1;
        uint8_t  d2;
        uint8_t  track;
        uint8_t  pad[2];
    } looper_events[LOOPER_MAX_EVENTS];
    /* Performance Mode state.
     * perf_emitted_pitch[t][raw] = emitted pitch (0xFF = not sounding).
     * Replaces the old 128-byte bitmap; carries pitch translation for cross-cycle
     * note-off correctness and staccato pending cleanup. */
    uint32_t perf_mods_active;
    uint32_t looper_cycle;
    uint8_t  looper_sync;               /* 1=wait for clock boundary (default), 0=start immediately */
    uint8_t  perf_emitted_pitch[NUM_TRACKS][128];
    struct {
        uint8_t  raw_pitch, emitted_pitch, track;
        uint8_t  _pad;
        uint16_t fire_at;
    } perf_staccato_notes[16];
    uint8_t  perf_staccato_count;
} seq8_instance_t;

static const host_api_v1_t *g_host = NULL;
static seq8_instance_t     *g_inst = NULL;


/* ------------------------------------------------------------------ */
/* Mute/solo                                                            */
/* ------------------------------------------------------------------ */

static int effective_mute(seq8_instance_t *inst, int t) {
    int i, any_solo = 0;
    for (i = 0; i < NUM_TRACKS; i++)
        if (inst->solo[i]) { any_solo = 1; break; }
    return inst->mute[t] || (any_solo && !inst->solo[t]);
}

static int effective_drum_mute(seq8_track_t *tr, int l) {
    uint32_t bit = 1u << (uint32_t)l;
    if (tr->drum_lane_mute & bit) return 1;
    if (tr->drum_lane_solo && !(tr->drum_lane_solo & bit)) return 1;
    return 0;
}

/* silence_muted_tracks defined after pfx_note_off below */

/* Forward declarations for note-centric helpers (defined after clip_init) */
static int  clip_insert_note(clip_t *cl, uint32_t tick, uint16_t gate, uint8_t pitch, uint8_t vel);
static void clip_migrate_to_notes(clip_t *cl);
static void clip_build_steps_from_notes(clip_t *cl);
static void silence_track_notes_v2(seq8_instance_t *inst, seq8_track_t *tr);
static void clip_pfx_params_init(clip_pfx_params_t *p);
static void pfx_sync_from_clip(seq8_track_t *tr);

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

static int my_atoi(const char *s) {
    int sign = 1, v = 0;
    if (!s) return 0;
    while (*s == ' ' || *s == '\t') s++;
    if      (*s == '-') { sign = -1; s++; }
    else if (*s == '+') { s++; }
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s++ - '0'); }
    return v * sign;
}

static int clamp_i(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

static int pfx_rand(play_fx_t *fx, int lo, int hi) {
    uint32_t x = fx->rng;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    fx->rng = x;
    return lo + (int)(x % (uint32_t)(hi - lo + 1));
}

static void seq8_ilog(seq8_instance_t *inst, const char *msg) {
    if (!inst || !inst->log_fp) return;
    fprintf(inst->log_fp, "%s\n", msg);
    fflush(inst->log_fp);
}

/* --- State persistence (Option C: cold-boot recovery) ------------------- */

static int json_get_int(const char *buf, const char *key, int def) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(buf, search);
    if (!p) return def;
    p += strlen(search);
    while (*p == ' ') p++;
    return my_atoi(p);
}

static uint32_t json_get_uint(const char *buf, const char *key, uint32_t def) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(buf, search);
    if (!p) return def;
    p += strlen(search);
    while (*p == ' ') p++;
    uint32_t v = 0;
    while (*p >= '0' && *p <= '9') { v = v * 10u + (uint32_t)(*p++ - '0'); }
    return v;
}

static void json_get_steps(const char *buf, const char *key,
                            uint8_t *steps, int n) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":\"", key);
    const char *p = strstr(buf, search);
    if (!p) return;
    p += strlen(search);
    int i;
    for (i = 0; i < n && *p && *p != '"'; i++, p++)
        steps[i] = (*p == '1') ? 1 : 0;
}

/* Parse "key":"S:V;S2:V2;..." (V may be signed) into int[count].
 * Entries not present in the sparse string are left unchanged. */
static void json_get_sparse_int(const char *buf, const char *key,
                                int *out, int count) {
    char search[64];
    snprintf(search, sizeof(search), "\"%s\":\"", key);
    const char *p = strstr(buf, search);
    if (!p) return;
    p += strlen(search);
    while (*p && *p != '"') {
        int sidx = 0;
        while (*p >= '0' && *p <= '9') sidx = sidx * 10 + (*p++ - '0');
        if (*p != ':') break;
        p++;
        int sign = 1;
        if (*p == '-') { sign = -1; p++; }
        int val = 0;
        while (*p >= '0' && *p <= '9') val = val * 10 + (*p++ - '0');
        if (sidx >= 0 && sidx < count) out[sidx] = val * sign;
        if (*p == ';') p++;
    }
}

static void ensure_parent_dir(const char *path) {
    char tmp[256];
    char *p;
    snprintf(tmp, sizeof(tmp), "%s", path);
    for (p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0755);
            *p = '/';
        }
    }
}

static void seq8_save_state(seq8_instance_t *inst) {
    ensure_parent_dir(inst->state_path);
    FILE *fp = fopen(inst->state_path, "w");
    if (!fp) return;
    int t, c;
    fprintf(fp, "{\"v\":15,\"playing\":%d", inst->playing);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ac\":%d", t, inst->tracks[t].active_clip);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_wr\":%d", t, inst->tracks[t].will_relaunch);
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_ch\":%d,\"t%d_rt\":%d",
                t, (int)inst->tracks[t].channel,
                t, (int)inst->tracks[t].pfx.route);
    for (t = 0; t < NUM_TRACKS; t++)
        if (inst->tracks[t].pfx.looper_on != 1)
            fprintf(fp, ",\"t%d_lp\":%d", t, (int)inst->tracks[t].pfx.looper_on);
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];
            fprintf(fp, ",\"t%dc%d_len\":%d", t, c, (int)cl->length);
            if (cl->stretch_exp != 0)
                fprintf(fp, ",\"t%dc%d_se\":%d", t, c, (int)cl->stretch_exp);
            if (cl->clock_shift_pos != 0)
                fprintf(fp, ",\"t%dc%d_cs\":%d", t, c, (int)cl->clock_shift_pos);
            if (cl->ticks_per_step != TICKS_PER_STEP)
                fprintf(fp, ",\"t%dc%d_tps\":%d", t, c, (int)cl->ticks_per_step);
            /* Per-clip play-effect params (sparse — only non-default) */
            {
                const clip_pfx_params_t *p2 = &cl->pfx_params;
                if (p2->octave_shift    != 0)   fprintf(fp, ",\"t%dc%d_nfo\":%d",  t, c, p2->octave_shift);
                if (p2->note_offset     != 0)   fprintf(fp, ",\"t%dc%d_nfof\":%d", t, c, p2->note_offset);
                if (p2->gate_time       != 100) fprintf(fp, ",\"t%dc%d_nfg\":%d",  t, c, p2->gate_time);
                if (p2->velocity_offset != 0)   fprintf(fp, ",\"t%dc%d_nfv\":%d",  t, c, p2->velocity_offset);
                if (p2->quantize        != 0)   fprintf(fp, ",\"t%dc%d_qnt\":%d",  t, c, p2->quantize);
                if (p2->unison          != 0)   fprintf(fp, ",\"t%dc%d_hu\":%d",   t, c, p2->unison);
                if (p2->octaver         != 0)   fprintf(fp, ",\"t%dc%d_ho\":%d",   t, c, p2->octaver);
                if (p2->harmonize_1     != 0)   fprintf(fp, ",\"t%dc%d_h1\":%d",   t, c, p2->harmonize_1);
                if (p2->harmonize_2     != 0)   fprintf(fp, ",\"t%dc%d_h2\":%d",   t, c, p2->harmonize_2);
                if (p2->delay_time_idx  != 0)   fprintf(fp, ",\"t%dc%d_dt\":%d",   t, c, p2->delay_time_idx);
                if (p2->delay_level     != 0)   fprintf(fp, ",\"t%dc%d_dl\":%d",   t, c, p2->delay_level);
                if (p2->repeat_times    != 0)   fprintf(fp, ",\"t%dc%d_dr\":%d",   t, c, p2->repeat_times);
                if (p2->fb_velocity     != 0)   fprintf(fp, ",\"t%dc%d_dvf\":%d",  t, c, p2->fb_velocity);
                if (p2->fb_note         != 0)   fprintf(fp, ",\"t%dc%d_dpf\":%d",  t, c, p2->fb_note);
                if (p2->fb_note_random  != 0)   fprintf(fp, ",\"t%dc%d_dpr\":%d",  t, c, p2->fb_note_random);
                if (p2->fb_gate_time    != 0)   fprintf(fp, ",\"t%dc%d_dgf\":%d",  t, c, p2->fb_gate_time);
                if (p2->fb_clock        != 0)   fprintf(fp, ",\"t%dc%d_dcf\":%d",  t, c, p2->fb_clock);
                /* SEQ ARP — sparse, only emit if non-default */
                if (p2->seq_arp_style     != 0)             fprintf(fp, ",\"t%dc%d_arst\":%d", t, c, p2->seq_arp_style);
                if (p2->seq_arp_rate      != ARP_RATE_DEFAULT) fprintf(fp, ",\"t%dc%d_arrt\":%d", t, c, p2->seq_arp_rate);
                if (p2->seq_arp_octaves   != 1)             fprintf(fp, ",\"t%dc%d_aroc\":%d", t, c, p2->seq_arp_octaves);
                if (p2->seq_arp_gate      != 50)            fprintf(fp, ",\"t%dc%d_argt\":%d", t, c, p2->seq_arp_gate);
                if (p2->seq_arp_steps_mode != 0)            fprintf(fp, ",\"t%dc%d_arsm\":%d", t, c, p2->seq_arp_steps_mode);
                if (p2->seq_arp_retrigger != 1)             fprintf(fp, ",\"t%dc%d_artg\":%d", t, c, p2->seq_arp_retrigger);
                {
                    int _i;
                    for (_i = 0; _i < 8; _i++) {
                        if (p2->seq_arp_step_vel[_i] != 4)
                            fprintf(fp, ",\"t%dc%d_arsv%d\":%d", t, c, _i, (int)p2->seq_arp_step_vel[_i]);
                    }
                }
            }
            /* note list: "tick:pitch:vel:gate;" for each active note */
            if (cl->note_count > 0) {
                uint16_t ni;
                int wrote = 0;
                for (ni = 0; ni < cl->note_count; ni++) {
                    note_t *n = &cl->notes[ni];
                    if (!n->active) continue;
                    if (!wrote) {
                        fprintf(fp, ",\"t%dc%d_n\":\"", t, c);
                        wrote = 1;
                    }
                    fprintf(fp, "%u:%d:%d:%d:%d;",
                            (unsigned)n->tick, (int)n->pitch,
                            (int)n->vel, (int)n->gate,
                            (int)n->step_muted);
                }
                if (wrote) fputc('"', fp);
            }
        }
    }
    /* Drum lane data (sparse — only drum-mode tracks, only lanes with notes) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            int l;
            for (l = 0; l < DRUM_LANES; l++) {
                drum_lane_t *dl = &inst->tracks[t].drum_clips[c].lanes[l];
                clip_t *dlc = &dl->clip;
                uint16_t ni;
                int has_active = 0;
                for (ni = 0; ni < dlc->note_count; ni++)
                    if (dlc->notes[ni].active) { has_active = 1; break; }
                if (!has_active) continue;
                if (dl->midi_note != (uint8_t)(DRUM_BASE_NOTE + l))
                    fprintf(fp, ",\"t%dc%dl%d_mn\":%d", t, c, l, (int)dl->midi_note);
                if (dlc->length != SEQ_STEPS_DEFAULT)
                    fprintf(fp, ",\"t%dc%dl%d_len\":%d", t, c, l, (int)dlc->length);
                if (dlc->ticks_per_step != TICKS_PER_STEP)
                    fprintf(fp, ",\"t%dc%dl%d_tps\":%d", t, c, l, (int)dlc->ticks_per_step);
                int wrote = 0;
                for (ni = 0; ni < dlc->note_count; ni++) {
                    note_t *n = &dlc->notes[ni];
                    if (!n->active) continue;
                    if (!wrote) { fprintf(fp, ",\"t%dc%dl%d_n\":\"", t, c, l); wrote = 1; }
                    fprintf(fp, "%u:%d:%d:%d:%d;",
                            (unsigned)n->tick, (int)n->pitch,
                            (int)n->vel, (int)n->gate, (int)n->step_muted);
                }
                if (wrote) fputc('"', fp);
            }
        }
    }
    /* Mute/solo state */
    fprintf(fp, ",\"mute\":\"");
    for (t = 0; t < NUM_TRACKS; t++) fputc(inst->mute[t] ? '1' : '0', fp);
    fputc('"', fp);
    fprintf(fp, ",\"solo\":\"");
    for (t = 0; t < NUM_TRACKS; t++) fputc(inst->solo[t] ? '1' : '0', fp);
    fputc('"', fp);
    /* Snapshots — only emit occupied slots */
    {
        int n;
        for (n = 0; n < 16; n++) {
            if (!inst->snap_valid[n]) continue;
            fprintf(fp, ",\"sn%d_m\":\"", n);
            for (t = 0; t < NUM_TRACKS; t++) fputc(inst->snap_mute[n][t] ? '1' : '0', fp);
            fputc('"', fp);
            fprintf(fp, ",\"sn%d_s\":\"", n);
            for (t = 0; t < NUM_TRACKS; t++) fputc(inst->snap_solo[n][t] ? '1' : '0', fp);
            fputc('"', fp);
            for (t = 0; t < NUM_TRACKS; t++) {
                if (inst->snap_drum_eff_mute[n][t])
                    fprintf(fp, ",\"sn%dde%d\":%u", n, t, inst->snap_drum_eff_mute[n][t]);
            }
        }
    }
    /* Per-track: pad_mode (route saved above with channel) */
    for (t = 0; t < NUM_TRACKS; t++)
        fprintf(fp, ",\"t%d_pm\":%d", t, (int)inst->tracks[t].pad_mode);
    /* Per-track: drum lane mute/solo bitmasks (sparse; omit if zero) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].drum_lane_mute)
            fprintf(fp, ",\"t%ddlm\":%u", t, inst->tracks[t].drum_lane_mute);
        if (inst->tracks[t].drum_lane_solo)
            fprintf(fp, ",\"t%ddls\":%u", t, inst->tracks[t].drum_lane_solo);
    }
    /* Global settings */
    fprintf(fp, ",\"key\":%d,\"scale\":%d,\"lq\":%d",
            (int)inst->pad_key, (int)inst->pad_scale, (int)inst->launch_quant);
    fprintf(fp, ",\"bpm\":%.0f", inst->tracks[0].pfx.cached_bpm > 0
            ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT);
    fprintf(fp, ",\"saw\":%d", (int)inst->scale_aware);
    fprintf(fp, ",\"iv\":%d",  (int)inst->input_vel);
    fprintf(fp, ",\"iq\":%d",  (int)inst->inp_quant);
    fprintf(fp, ",\"mic\":%d", (int)inst->midi_in_channel);
    if (inst->metro_on != 1)   fprintf(fp, ",\"metro_on\":%d", (int)inst->metro_on);
    if (inst->metro_vol != 80) fprintf(fp, ",\"metro_vol\":%d", (int)inst->metro_vol);
    fprintf(fp, "}");
    fclose(fp);
}

static void seq8_load_state(seq8_instance_t *inst) {
    FILE *fp = fopen(inst->state_path, "r");
    if (!fp) return;
    fseek(fp, 0, SEEK_END);
    long fsz = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (fsz <= 0) { fclose(fp); remove(inst->state_path); return; }
    char *buf = (char *)malloc((size_t)fsz + 1);
    if (!buf) { fclose(fp); return; }
    size_t n = fread(buf, 1, (size_t)fsz, fp);
    fclose(fp);
    if (!n) { free(buf); remove(inst->state_path); return; }
    buf[n] = '\0';

    /* Version gate: v=15 only (SEQ ARP schema change: style 0=Off, signed
     * octaves, retrigger replaces vel_decay; no longer compatible with v=14). */
    {
        int sv = json_get_int(buf, "v", -1);
        if (sv != 15) {
            free(buf);
            remove(inst->state_path);
            seq8_ilog(inst, "SEQ8 state: wrong version, deleted");
            return;
        }
    }

    int t, c;
    char key[32];
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%d_ac", t);
        inst->tracks[t].active_clip = (uint8_t)clamp_i(
            json_get_int(buf, key, 0), 0, NUM_CLIPS - 1);

        snprintf(key, sizeof(key), "t%d_wr", t);
        inst->tracks[t].will_relaunch = (uint8_t)clamp_i(
            json_get_int(buf, key, 0), 0, 1);

        snprintf(key, sizeof(key), "t%d_ch", t);
        inst->tracks[t].channel = (uint8_t)clamp_i(
            json_get_int(buf, key, t), 0, 15);

        snprintf(key, sizeof(key), "t%d_rt", t);
        inst->tracks[t].pfx.route = (uint8_t)clamp_i(
            json_get_int(buf, key, ROUTE_SCHWUNG), ROUTE_SCHWUNG, ROUTE_MOVE);

        snprintf(key, sizeof(key), "t%d_lp", t);
        inst->tracks[t].pfx.looper_on = (uint8_t)(json_get_int(buf, key, 1) ? 1 : 0);

        for (c = 0; c < NUM_CLIPS; c++) {
            clip_t *cl = &inst->tracks[t].clips[c];

            snprintf(key, sizeof(key), "t%dc%d_len", t, c);
            cl->length = (uint16_t)clamp_i(
                json_get_int(buf, key, SEQ_STEPS_DEFAULT), 1, SEQ_STEPS);

            snprintf(key, sizeof(key), "t%dc%d_se", t, c);
            cl->stretch_exp = (int8_t)clamp_i(json_get_int(buf, key, 0), -8, 8);

            snprintf(key, sizeof(key), "t%dc%d_cs", t, c);
            cl->clock_shift_pos = (uint16_t)clamp_i(
                json_get_int(buf, key, 0), 0, (int)cl->length - 1);

            snprintf(key, sizeof(key), "t%dc%d_tps", t, c);
            {
                int raw_tps = json_get_int(buf, key, (int)TICKS_PER_STEP);
                /* Validate: must be one of the six allowed values */
                int vi, valid = 0;
                for (vi = 0; vi < 6; vi++)
                    if (raw_tps == (int)TPS_VALUES[vi]) { valid = 1; break; }
                cl->ticks_per_step = valid ? (uint16_t)raw_tps : TICKS_PER_STEP;
            }

            /* note list: "tick:pitch:vel:gate;" */
            {
                char search[40];
                snprintf(search, sizeof(search), "\"t%dc%d_n\":\"", t, c);
                const char *p = strstr(buf, search);
                if (p) {
                    p += strlen(search);
                    uint32_t max_tick = (uint32_t)cl->length * cl->ticks_per_step;
                    while (*p && *p != '"') {
                        unsigned long tick_val = 0;
                        while (*p >= '0' && *p <= '9')
                            tick_val = tick_val * 10 + (unsigned long)(*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int pitch_val = 0;
                        while (*p >= '0' && *p <= '9') pitch_val = pitch_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int vel_val = 0;
                        while (*p >= '0' && *p <= '9') vel_val = vel_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int gate_val = 0;
                        while (*p >= '0' && *p <= '9') gate_val = gate_val*10 + (*p++ - '0');
                        int sm_val = 0;
                        if (*p == ':') {
                            p++;
                            while (*p >= '0' && *p <= '9') sm_val = sm_val*10 + (*p++ - '0');
                        }
                        if (*p == ';') p++;
                        if ((uint32_t)tick_val < max_tick) {
                            int gmax_ld = SEQ_STEPS * cl->ticks_per_step; if (gmax_ld > 65535) gmax_ld = 65535;
                            int ni_idx = clip_insert_note(cl, (uint32_t)tick_val,
                                             (uint16_t)clamp_i(gate_val, 1, gmax_ld),
                                             (uint8_t)clamp_i(pitch_val, 0, 127),
                                             (uint8_t)clamp_i(vel_val, 0, 127));
                            if (ni_idx >= 0 && sm_val)
                                cl->notes[ni_idx].step_muted = 1;
                        }
                    }
                }
            }
        }
    }
    /* Mute/solo state */
    json_get_steps(buf, "mute", inst->mute, NUM_TRACKS);
    json_get_steps(buf, "solo", inst->solo, NUM_TRACKS);
    /* Snapshots */
    {
        int n;
        char search[32], skey[12];
        for (n = 0; n < 16; n++) {
            snprintf(search, sizeof(search), "\"sn%d_m\":\"", n);
            if (!strstr(buf, search)) continue;
            snprintf(skey, sizeof(skey), "sn%d_m", n);
            json_get_steps(buf, skey, inst->snap_mute[n], NUM_TRACKS);
            snprintf(skey, sizeof(skey), "sn%d_s", n);
            json_get_steps(buf, skey, inst->snap_solo[n], NUM_TRACKS);
            for (t = 0; t < NUM_TRACKS; t++) {
                snprintf(key, sizeof(key), "sn%dde%d", n, t);
                inst->snap_drum_eff_mute[n][t] = json_get_uint(buf, key, 0);
            }
            inst->snap_valid[n] = 1;
        }
    }
    /* Per-track: pad_mode (route/channel already loaded above) */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%d_pm", t);
        inst->tracks[t].pad_mode = (uint8_t)clamp_i(json_get_int(buf, key, 0), 0, 1);
    }
    /* Per-track: drum lane mute/solo bitmasks */
    for (t = 0; t < NUM_TRACKS; t++) {
        snprintf(key, sizeof(key), "t%ddlm", t);
        inst->tracks[t].drum_lane_mute = json_get_uint(buf, key, 0);
        snprintf(key, sizeof(key), "t%ddls", t);
        inst->tracks[t].drum_lane_solo = json_get_uint(buf, key, 0);
    }
    /* Per-clip play-effect params (sparse — missing keys default to neutral) */
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            clip_pfx_params_t *p2 = &inst->tracks[t].clips[c].pfx_params;
            snprintf(key, sizeof(key), "t%dc%d_nfo",  t, c);
            p2->octave_shift    = clamp_i(json_get_int(buf, key,   0),    -4,  4);
            snprintf(key, sizeof(key), "t%dc%d_nfof", t, c);
            p2->note_offset     = clamp_i(json_get_int(buf, key,   0),   -24, 24);
            snprintf(key, sizeof(key), "t%dc%d_nfg",  t, c);
            p2->gate_time       = clamp_i(json_get_int(buf, key, 100),     0, 400);
            snprintf(key, sizeof(key), "t%dc%d_nfv",  t, c);
            p2->velocity_offset = clamp_i(json_get_int(buf, key,   0),  -127, 127);
            snprintf(key, sizeof(key), "t%dc%d_qnt",  t, c);
            p2->quantize        = clamp_i(json_get_int(buf, key,   0),     0, 100);
            snprintf(key, sizeof(key), "t%dc%d_hu",   t, c);
            p2->unison          = clamp_i(json_get_int(buf, key,   0),     0,   2);
            snprintf(key, sizeof(key), "t%dc%d_ho",   t, c);
            p2->octaver         = clamp_i(json_get_int(buf, key,   0),    -4,   4);
            snprintf(key, sizeof(key), "t%dc%d_h1",   t, c);
            p2->harmonize_1     = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_h2",   t, c);
            p2->harmonize_2     = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_dt",   t, c);
            p2->delay_time_idx  = clamp_i(json_get_int(buf, key,   0),     0, NUM_CLOCK_VALUES - 1);
            snprintf(key, sizeof(key), "t%dc%d_dl",   t, c);
            p2->delay_level     = clamp_i(json_get_int(buf, key,   0),     0, 127);
            snprintf(key, sizeof(key), "t%dc%d_dr",   t, c);
            p2->repeat_times    = clamp_i(json_get_int(buf, key,   0),     0, MAX_REPEATS);
            snprintf(key, sizeof(key), "t%dc%d_dvf",  t, c);
            p2->fb_velocity     = clamp_i(json_get_int(buf, key,   0),  -127, 127);
            snprintf(key, sizeof(key), "t%dc%d_dpf",  t, c);
            p2->fb_note         = clamp_i(json_get_int(buf, key,   0),   -24,  24);
            snprintf(key, sizeof(key), "t%dc%d_dpr",  t, c);
            p2->fb_note_random  = json_get_int(buf, key, 0) ? 1 : 0;
            snprintf(key, sizeof(key), "t%dc%d_dgf",  t, c);
            p2->fb_gate_time    = clamp_i(json_get_int(buf, key,   0),  -100, 100);
            snprintf(key, sizeof(key), "t%dc%d_dcf",  t, c);
            p2->fb_clock        = clamp_i(json_get_int(buf, key,   0),  -100, 100);
            /* SEQ ARP */
            snprintf(key, sizeof(key), "t%dc%d_arst", t, c);
            p2->seq_arp_style     = clamp_i(json_get_int(buf, key, 0), 0, 9);
            snprintf(key, sizeof(key), "t%dc%d_arrt", t, c);
            p2->seq_arp_rate      = clamp_i(json_get_int(buf, key, ARP_RATE_DEFAULT), 0, 9);
            snprintf(key, sizeof(key), "t%dc%d_aroc", t, c);
            {
                int _oc = clamp_i(json_get_int(buf, key, 1), -ARP_MAX_OCTAVES, ARP_MAX_OCTAVES);
                if (_oc == 0) _oc = 1;
                p2->seq_arp_octaves = _oc;
            }
            snprintf(key, sizeof(key), "t%dc%d_argt", t, c);
            p2->seq_arp_gate      = clamp_i(json_get_int(buf, key, 50), 1, 200);
            snprintf(key, sizeof(key), "t%dc%d_arsm", t, c);
            p2->seq_arp_steps_mode = clamp_i(json_get_int(buf, key, 0), 0, 2);
            snprintf(key, sizeof(key), "t%dc%d_artg", t, c);
            p2->seq_arp_retrigger = json_get_int(buf, key, 1) ? 1 : 0;
            {
                int _i;
                for (_i = 0; _i < 8; _i++) {
                    snprintf(key, sizeof(key), "t%dc%d_arsv%d", t, c, _i);
                    p2->seq_arp_step_vel[_i] = (uint8_t)clamp_i(json_get_int(buf, key, 4), 0, 4);
                }
            }
        }
    }
    /* Drum lane data (v=14 only; v=13 files have no drum keys, loops are no-ops) */
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            int l;
            for (l = 0; l < DRUM_LANES; l++) {
                drum_lane_t *dl = &inst->tracks[t].drum_clips[c].lanes[l];
                clip_t *dlc = &dl->clip;
                char search[48];
                snprintf(search, sizeof(search), "\"t%dc%dl%d_n\":\"", t, c, l);
                if (!strstr(buf, search)) continue;
                snprintf(key, sizeof(key), "t%dc%dl%d_mn", t, c, l);
                dl->midi_note = (uint8_t)clamp_i(
                    json_get_int(buf, key, DRUM_BASE_NOTE + l), 0, 127);
                snprintf(key, sizeof(key), "t%dc%dl%d_len", t, c, l);
                dlc->length = (uint16_t)clamp_i(
                    json_get_int(buf, key, SEQ_STEPS_DEFAULT), 1, SEQ_STEPS);
                snprintf(key, sizeof(key), "t%dc%dl%d_tps", t, c, l);
                {
                    int raw_tps = json_get_int(buf, key, (int)TICKS_PER_STEP);
                    int vi, valid = 0;
                    for (vi = 0; vi < 6; vi++)
                        if (raw_tps == (int)TPS_VALUES[vi]) { valid = 1; break; }
                    dlc->ticks_per_step = valid ? (uint16_t)raw_tps : TICKS_PER_STEP;
                }
                {
                    const char *p = strstr(buf, search);
                    p += strlen(search);
                    uint32_t max_tick = (uint32_t)dlc->length * dlc->ticks_per_step;
                    while (*p && *p != '"') {
                        unsigned long tick_val = 0;
                        while (*p >= '0' && *p <= '9')
                            tick_val = tick_val * 10 + (unsigned long)(*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int pitch_val = 0;
                        while (*p >= '0' && *p <= '9') pitch_val = pitch_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int vel_val = 0;
                        while (*p >= '0' && *p <= '9') vel_val = vel_val*10 + (*p++ - '0');
                        if (*p != ':') { while (*p && *p != ';' && *p != '"') p++; if (*p==';') p++; continue; }
                        p++;
                        int gate_val = 0;
                        while (*p >= '0' && *p <= '9') gate_val = gate_val*10 + (*p++ - '0');
                        int sm_val = 0;
                        if (*p == ':') {
                            p++;
                            while (*p >= '0' && *p <= '9') sm_val = sm_val*10 + (*p++ - '0');
                        }
                        if (*p == ';') p++;
                        if ((uint32_t)tick_val < max_tick) {
                            int gmax_ld = SEQ_STEPS * dlc->ticks_per_step;
                            if (gmax_ld > 65535) gmax_ld = 65535;
                            int ni_idx = clip_insert_note(dlc, (uint32_t)tick_val,
                                             (uint16_t)clamp_i(gate_val, 1, gmax_ld),
                                             (uint8_t)clamp_i(pitch_val, 0, 127),
                                             (uint8_t)clamp_i(vel_val, 0, 127));
                            if (ni_idx >= 0 && sm_val)
                                dlc->notes[ni_idx].step_muted = 1;
                        }
                    }
                }
            }
        }
    }
    /* Global settings */
    inst->pad_key      = (uint8_t)clamp_i(json_get_int(buf, "key",   9), 0, 11);
    inst->pad_scale    = (uint8_t)clamp_i(json_get_int(buf, "scale", 1), 0, 13);
    inst->launch_quant = (uint8_t)clamp_i(json_get_int(buf, "lq",    0), 0,  5);
    {
        int saved_bpm = json_get_int(buf, "bpm", BPM_DEFAULT);
        if (saved_bpm >= 40 && saved_bpm <= 250) {
            double bpm = (double)saved_bpm;
            inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * bpm * (double)PPQN);
            for (t = 0; t < NUM_TRACKS; t++)
                inst->tracks[t].pfx.cached_bpm = bpm;
        }
    }
    inst->scale_aware = (uint8_t)(json_get_int(buf, "saw", 0) != 0);
    inst->input_vel      = (uint8_t)clamp_i(json_get_int(buf, "iv",  0), 0, 127);
    inst->inp_quant      = (uint8_t)(json_get_int(buf, "iq", 0) != 0);
    inst->midi_in_channel = (uint8_t)clamp_i(json_get_int(buf, "mic", 0), 0, 16);
    inst->metro_on  = (uint8_t)clamp_i(json_get_int(buf, "metro_on", 1), 0, 3);
    inst->metro_vol = (uint8_t)clamp_i(json_get_int(buf, "metro_vol", 80), 0, 100);
    free(buf);
    /* Build step arrays from loaded notes[] for display/edit compat */
    for (t = 0; t < NUM_TRACKS; t++)
        for (c = 0; c < NUM_CLIPS; c++)
            clip_build_steps_from_notes(&inst->tracks[t].clips[c]);
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) continue;
        for (c = 0; c < NUM_CLIPS; c++) {
            int l;
            for (l = 0; l < DRUM_LANES; l++)
                clip_build_steps_from_notes(
                    &inst->tracks[t].drum_clips[c].lanes[l].clip);
        }
    }
    /* Sync each track's tr->pfx params from its active clip's pfx_params */
    for (t = 0; t < NUM_TRACKS; t++)
        pfx_sync_from_clip(&inst->tracks[t]);
    seq8_ilog(inst, "SEQ8 state restored from file");
}

/* ------------------------------------------------------------------ */
/* MIDI output helpers                                                  */
/* ------------------------------------------------------------------ */

/* Send 3-byte MIDI message. Routes on fx->route:
 *   ROUTE_SCHWUNG → midi_send_internal (Schwung chain, immediate)
 *   ROUTE_MOVE    → midi_inject_to_move (cable 2, CIN from status; NULL-safe) */
/* Forward decls — arp engine and scale_transpose defined further down. */
static void arp_add_note     (arp_engine_t *a, uint8_t pitch, uint8_t vel);
static void arp_remove_note  (arp_engine_t *a, uint8_t pitch);
static void arp_silence      (seq8_instance_t *inst, seq8_track_t *tr);
static int  scale_transpose  (seq8_instance_t *inst, int note, int deg_offset);

static void pfx_send(play_fx_t *fx, uint8_t status, uint8_t d1, uint8_t d2) {
    /* SEQ ARP is the last chain stage. Any note-on/off coming out of the
     * upstream stages (NOTE FX → HARMZ → MIDI DLY immediate emit and queued
     * delay echoes) gets captured into the arp's held buffer instead of out.
     * arp_emitting=1 marks arp's own raw output so it bypasses the gate. */
    if (fx->arp.style != 0 && !fx->arp_emitting) {
        uint8_t st = status & 0xF0;
        if (st == 0x90 && d2 > 0) {
            arp_add_note(&fx->arp, d1, d2);
            return;
        }
        if (st == 0x80 || (st == 0x90 && d2 == 0)) {
            arp_remove_note(&fx->arp, d1);
            return;
        }
        /* CC and other messages pass through. */
    }
    /* Global MIDI Looper hook (post-arp emit). Capture into ring during
     * CAPTURING; suppress emission during LOOPING. Looper-emitted playback
     * sets g_inst->looper_emitting=1 to bypass both branches and pass through. */
    if (g_inst && fx->looper_on && !g_inst->looper_emitting) {
        uint8_t st = status & 0xF0;
        if (g_inst->looper_state == LOOPER_STATE_CAPTURING &&
                (st == 0x90 || st == 0x80) &&
                g_inst->looper_event_count < LOOPER_MAX_EVENTS) {
            int ei = (int)g_inst->looper_event_count++;
            g_inst->looper_events[ei].tick   = (uint16_t)g_inst->looper_pos;
            g_inst->looper_events[ei].status = status;
            g_inst->looper_events[ei].d1     = d1;
            g_inst->looper_events[ei].d2     = d2;
            g_inst->looper_events[ei].track  = fx->track_idx;
            /* fall through and emit normally so capture is parallel */
        } else if (g_inst->looper_state == LOOPER_STATE_LOOPING) {
            return; /* silenced track during loop playback */
        }
    }

    if (!g_host) return;
    if (fx->route == ROUTE_MOVE) {
        if (!g_host->midi_inject_to_move) return;
        uint8_t pkt[4] = { (uint8_t)(0x20 | (status >> 4)), status, d1, d2 };
        g_host->midi_inject_to_move(pkt, 4);
        return;
    }
    const uint8_t msg[4] = { (uint8_t)(status >> 4), status, d1, d2 };
    if (g_host->midi_send_internal) g_host->midi_send_internal(msg, 4);
}

/* ------------------------------------------------------------------ */
/* Global MIDI Looper                                                   */
/* ------------------------------------------------------------------ */

/* Record or clear the emitted pitch for a sounding looper note.
 * raw = captured pitch; emitted = translated output pitch (0xFF = clear/inactive). */
static inline void looper_mark_active(seq8_instance_t *inst, uint8_t track,
                                       uint8_t raw_pitch, uint8_t emitted_pitch) {
    if (track >= NUM_TRACKS || raw_pitch >= 128) return;
    inst->perf_emitted_pitch[track][raw_pitch] = emitted_pitch;
}

/* Send note-offs for every sounding looper note and drain staccato pending.
 * Safe to call from any looper state. */
static void looper_silence_active(seq8_instance_t *inst) {
    int t, p;
    inst->looper_emitting = 1;
    for (t = 0; t < NUM_TRACKS; t++) {
        play_fx_t *fx = &inst->tracks[t].pfx;
        for (p = 0; p < 128; p++) {
            uint8_t ep = inst->perf_emitted_pitch[t][p];
            if (ep != 0xFF) {
                pfx_send(fx, (uint8_t)(0x80 | inst->tracks[t].channel), ep, 0);
                inst->perf_emitted_pitch[t][p] = 0xFF;
            }
        }
    }
    inst->perf_staccato_count = 0;
    inst->looper_emitting = 0;
}

/* Apply active Performance Mode modifiers to one looper event.
 * Transforms pitch/velocity in-place; returns 0 to suppress (skip emit), 1 to emit.
 * For note-on with STACCATO active, also enqueues a short note-off in staccato_notes[].
 * For note-off, looks up the emitted pitch from the xlate table so cross-cycle gates
 * land the note-off on the correct translated pitch. */
static int perf_apply(seq8_instance_t *inst, uint8_t tr_idx,
                      uint8_t status, uint8_t *d1, uint8_t *d2) {
    uint32_t mods = inst->perf_mods_active;

    uint8_t hi    = status & 0xF0;
    int     is_on  = (hi == 0x90 && *d2 > 0);
    int     is_off = (hi == 0x80 || (hi == 0x90 && *d2 == 0));

    /* Note-off: always look up xlate table so pitch matches what was emitted,
     * even if mods changed since the note-on was fired. */
    if (is_off) {
        if (tr_idx >= NUM_TRACKS || *d1 >= 128) return 0;
        uint8_t ep = inst->perf_emitted_pitch[tr_idx][*d1];
        if (ep == 0xFF) return 0;  /* not currently sounding — suppress */
        *d1 = ep;
        /* Staccato owns note-off timing via staccato_pending; suppress captured one */
        if (mods & PERF_MOD_STACCATO) return 0;
        return 1;
    }

    if (!mods) return 1;  /* no active mods: pass note-on/CC through unchanged */

    /* Halftime: suppress every odd cycle entirely */
    if ((mods & PERF_MOD_HALFTIME) && (inst->looper_cycle & 1u)) return 0;

    if (!is_on) return 1;  /* pass non-note events through unchanged */

    uint8_t raw_d1 = *d1;
    int pitch = (int)*d1;
    int vel   = (int)*d2;

    /* Sparse: ~50% suppression, deterministic per (pitch, pos, cycle) */
    if (mods & PERF_MOD_SPARSE) {
        unsigned s = (unsigned)pitch * 31337u + (unsigned)inst->looper_pos * 127u
                   + (unsigned)inst->looper_cycle * 53u;
        if ((s >> 7) & 1u) return 0;
    }

    /* Pitch transforms: drum tracks bypass all pitch modifications. */
    int is_drum = tr_idx < NUM_TRACKS
                  && inst->tracks[tr_idx].pad_mode == PAD_MODE_DRUM;
    if (!is_drum) {
        /* Oct↑: climbs one octave per cycle (dynamic) */
        if (mods & PERF_MOD_OCT_UP) {
            int shift = 12 * (int)(inst->looper_cycle + 1);
            pitch = pitch + shift > 127 ? 127 : pitch + shift;
        }
        /* Scale↓: descends one more scale degree per cycle (dynamic) */
        if (mods & PERF_MOD_SCALE_DOWN)
            pitch = scale_transpose(inst, pitch, -(int)(inst->looper_cycle + 1));
        /* Glitch: random chromatic ±5 semitones (intentionally not scale-aware) */
        if (mods & PERF_MOD_GLITCH) {
            unsigned s = (unsigned)pitch * 31337u + (unsigned)inst->looper_pos * 7919u
                       + (unsigned)inst->looper_cycle * 6271u;
            int delta = (int)(s % 11u) - 5;
            pitch = pitch + delta < 0 ? 0 : (pitch + delta > 127 ? 127 : pitch + delta);
        }
    }

    /* Velocity transforms: apply to all tracks including drum. */
    if (mods & PERF_MOD_CRESC) {
        int boost = (int)inst->looper_cycle * 13;
        vel = vel + boost > 127 ? 127 : vel + boost;
    }
    /* Soft Decay: mirrors Cresc — vel decreases 13 per cycle, floor 1 */
    if (mods & PERF_MOD_SOFT_DECAY) {
        int cut = (int)inst->looper_cycle * 13;
        vel = vel - cut < 1 ? 1 : vel - cut;
    }

    *d1 = (uint8_t)(pitch < 0 ? 0 : pitch > 127 ? 127 : pitch);
    *d2 = (uint8_t)(vel   < 1 ? 1 : vel   > 127 ? 127 : vel);

    /* Staccato: enqueue a short note-off at looper_pos + cap/8 */
    if ((mods & PERF_MOD_STACCATO) && inst->perf_staccato_count < 16) {
        uint16_t cap = inst->looper_capture_ticks;
        uint16_t gap = cap / 8 < 2 ? 2 : cap / 8;
        uint16_t fire = (uint16_t)((inst->looper_pos + (uint32_t)gap) % cap);
        int si = (int)inst->perf_staccato_count++;
        inst->perf_staccato_notes[si].raw_pitch     = raw_d1;
        inst->perf_staccato_notes[si].emitted_pitch = *d1;
        inst->perf_staccato_notes[si].track         = tr_idx;
        inst->perf_staccato_notes[si].fire_at        = fire;
    }
    return 1;
}

/* Per master tick. Drives ARMED→CAPTURING boundary detection, capture window
 * advance, capture→loop transition, and event playback during LOOPING. */
static void looper_tick(seq8_instance_t *inst) {
    uint16_t cap = inst->looper_capture_ticks;
    if (cap == 0) return;

    if (inst->looper_state == LOOPER_STATE_ARMED) {
        /* Wait for next master-tick boundary (sync=1) or start immediately (sync=0). */
        uint32_t total = inst->arp_master_tick;
        if (!inst->looper_sync || (total % cap) == 0) {
            inst->looper_state       = LOOPER_STATE_CAPTURING;
            inst->looper_pos         = 0;
            inst->looper_event_count = 0;
            inst->looper_play_idx    = 0;
        }
        return;
    }

    if (inst->looper_state == LOOPER_STATE_CAPTURING) {
        inst->looper_pos++;
        if (inst->looper_pos >= cap) {
            inst->looper_state    = LOOPER_STATE_LOOPING;
            inst->looper_pos      = 0;
            inst->looper_play_idx = 0;
        }
        return;
    }

    if (inst->looper_state == LOOPER_STATE_LOOPING) {
        /* Fire staccato pending note-offs due at this position. */
        {
            int _si;
            for (_si = 0; _si < (int)inst->perf_staccato_count; ) {
                if (inst->perf_staccato_notes[_si].fire_at == (uint16_t)inst->looper_pos) {
                    uint8_t _tr = inst->perf_staccato_notes[_si].track;
                    uint8_t _ep = inst->perf_staccato_notes[_si].emitted_pitch;
                    uint8_t _rp = inst->perf_staccato_notes[_si].raw_pitch;
                    if (_tr < NUM_TRACKS) {
                        inst->looper_emitting = 1;
                        pfx_send(&inst->tracks[_tr].pfx,
                                 (uint8_t)(0x80 | inst->tracks[_tr].channel), _ep, 0);
                        inst->looper_emitting = 0;
                    }
                    if (_rp < 128) inst->perf_emitted_pitch[_tr][_rp] = 0xFF;
                    inst->perf_staccato_notes[_si] =
                        inst->perf_staccato_notes[--inst->perf_staccato_count];
                } else { _si++; }
            }
        }
        /* Emit captured events at this tick, applying perf modifiers. */
        while (inst->looper_play_idx < inst->looper_event_count &&
               inst->looper_events[inst->looper_play_idx].tick == (uint16_t)inst->looper_pos) {
            int ei = inst->looper_play_idx++;
            uint8_t tr_idx  = inst->looper_events[ei].track;
            if (tr_idx >= NUM_TRACKS) continue;
            play_fx_t *fx   = &inst->tracks[tr_idx].pfx;
            uint8_t st      = inst->looper_events[ei].status;
            uint8_t raw_d1  = inst->looper_events[ei].d1;
            uint8_t d1      = raw_d1;
            uint8_t d2      = inst->looper_events[ei].d2;
            if (!perf_apply(inst, tr_idx, st, &d1, &d2)) continue;
            inst->looper_emitting = 1;
            pfx_send(fx, st, d1, d2);
            inst->looper_emitting = 0;
            uint8_t hi = st & 0xF0;
            if (hi == 0x90 && d2 > 0)            looper_mark_active(inst, tr_idx, raw_d1, d1);
            else if (hi == 0x80 || (hi == 0x90)) looper_mark_active(inst, tr_idx, raw_d1, 0xFF);
        }
        inst->looper_pos++;
        if (inst->looper_pos >= cap) {
            /* Loop boundary: process queued rate change or increment cycle counter. */
            if (inst->looper_pending_rate_ticks != 0 &&
                    inst->looper_pending_rate_ticks != inst->looper_capture_ticks) {
                looper_silence_active(inst);
                inst->looper_capture_ticks      = inst->looper_pending_rate_ticks;
                inst->looper_pending_rate_ticks = 0;
                inst->looper_state = inst->looper_sync
                                     ? LOOPER_STATE_ARMED
                                     : LOOPER_STATE_CAPTURING;
                inst->looper_pos                = 0;
                inst->looper_event_count        = 0;
                inst->looper_play_idx           = 0;
                return;
            }
            inst->looper_pending_rate_ticks = 0;
            inst->looper_cycle++;
            inst->looper_pos      = 0;
            inst->looper_play_idx = 0;
        }
    }
}

/* Cleanup: silence active notes, clear state, return to IDLE. Safe to call
 * from any state. */
static void looper_stop(seq8_instance_t *inst) {
    if (inst->looper_state == LOOPER_STATE_LOOPING)
        looper_silence_active(inst);
    inst->looper_state              = LOOPER_STATE_IDLE;
    inst->looper_pos                = 0;
    inst->looper_play_idx           = 0;
    inst->looper_event_count        = 0;
    inst->looper_capture_ticks      = 0;
    inst->looper_pending_rate_ticks = 0;
    inst->looper_cycle              = 0;
    inst->perf_staccato_count       = 0;
    memset(inst->perf_emitted_pitch, 0xFF, sizeof(inst->perf_emitted_pitch));
}

/* Brute-force note-off for all 128 notes on all active channels.
 * Routes through pfx_send so ROUTE_MOVE tracks panic on the correct bus. */
static void send_panic(seq8_instance_t *inst) {
    int t, n;
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pfx.route == ROUTE_MOVE) continue; /* deferred via pfx_q_fire */
        for (n = 0; n < 128; n++)
            pfx_send(&inst->tracks[t].pfx,
                     (uint8_t)(0x80 | inst->tracks[t].channel), (uint8_t)n, 0);
    }
}

/* ------------------------------------------------------------------ */
/* BPM and timing                                                       */
/* ------------------------------------------------------------------ */

/* Samples per clock at 480 PPQN — used for MIDI delay time values. */
static double pfx_spc(seq8_instance_t *inst, seq8_track_t *tr) {
    double bpm = tr->pfx.cached_bpm > 0 ? tr->pfx.cached_bpm : (double)BPM_DEFAULT;
    return ((double)inst->sample_rate * 60.0) / (bpm * 480.0);
}

/* Gate duration in samples for the current step, scaled by gate_time%. */
static uint64_t pfx_gate_smp(seq8_instance_t *inst, seq8_track_t *tr) {
    double sp  = pfx_spc(inst, tr);
    double raw = (double)(GATE_TICKS * TICKS_TO_480PPQN) * sp;
    double g   = raw * (double)tr->pfx.gate_time / 100.0;
    if (g < 1.0 && tr->pfx.gate_time > 0) g = 1.0;
    return (uint64_t)(g + 0.5);
}

/* ------------------------------------------------------------------ */
/* Event queue (direct port from NoteTwist)                            */
/* ------------------------------------------------------------------ */

static void pfx_q_insert(play_fx_t *fx, uint64_t fire_at,
                         uint8_t s, uint8_t d1, uint8_t d2) {
    if (fx->event_count >= MAX_PFX_EVENTS) return;
    int lo = 0, hi = fx->event_count;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (fx->events[mid].fire_at <= fire_at) lo = mid + 1;
        else hi = mid;
    }
    if (lo < fx->event_count)
        memmove(&fx->events[lo + 1], &fx->events[lo],
                (size_t)(fx->event_count - lo) * sizeof(pfx_event_t));
    fx->events[lo].fire_at  = fire_at;
    fx->events[lo].msg[0]   = s;
    fx->events[lo].msg[1]   = d1;
    fx->events[lo].msg[2]   = d2;
    fx->events[lo].len      = 3;
    fx->event_count++;
}

static void pfx_q_fire(play_fx_t *fx, uint64_t now) {
    int f = 0;
    while (f < fx->event_count && fx->events[f].fire_at <= now) {
        pfx_send(fx, fx->events[f].msg[0], fx->events[f].msg[1], fx->events[f].msg[2]);
        f++;
    }
    if (f > 0) {
        fx->event_count -= f;
        if (fx->event_count > 0)
            memmove(&fx->events[0], &fx->events[f],
                    (size_t)fx->event_count * sizeof(pfx_event_t));
    }
}

/* ------------------------------------------------------------------ */
/* Scale-degree to semitone conversion                                  */
/* ------------------------------------------------------------------ */

static int deg_to_semitones(seq8_instance_t *inst, int deg) {
    int s = (int)inst->pad_scale;
    if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int quot = deg / n;
    int rem  = deg % n;
    if (rem < 0) { rem += n; quot--; }
    return quot * 12 + (int)ivals[rem];
}

/* Transpose note by deg_offset scale degrees, anchored to note's own scale position.
 * Finds the note's nearest scale degree, adds the offset, returns the result.
 * Correct for any starting note — not just the tonic. */
static int scale_transpose(seq8_instance_t *inst, int note, int deg_offset) {
    if (deg_offset == 0) return clamp_i(note, 0, 127);
    int s = (int)inst->pad_scale;
    if (s < 0 || s >= 14) s = 0;
    int n = (int)SCALE_SIZES[s];
    const uint8_t *ivals = SCALE_IVLS[s];
    int key = (int)inst->pad_key;
    /* note's octave and pitch class relative to key */
    int rel = note - key;
    int oct = rel / 12;
    int pc  = rel % 12;
    if (pc < 0) { pc += 12; oct--; }
    /* nearest scale degree for this pitch class */
    int deg = 0, d, best_dist = 13;
    for (d = 0; d < n; d++) {
        int dist = (int)ivals[d] - pc;
        if (dist < 0) dist = -dist;
        if (dist < best_dist) { best_dist = dist; deg = d; }
    }
    /* apply offset in degree space and convert back */
    int abs_deg = oct * n + deg + deg_offset;
    int t_oct   = abs_deg / n;
    int t_rem   = abs_deg % n;
    if (t_rem < 0) { t_rem += n; t_oct--; }
    return clamp_i(key + t_oct * 12 + (int)ivals[t_rem], 0, 127);
}

/* ------------------------------------------------------------------ */
/* Generated-note list (direct port from NoteTwist)                    */
/* ------------------------------------------------------------------ */

/* Pure NOTE FX pitch transform: octave_shift + note_offset, with scale awareness.
 * Returns the post-NOTE-FX primary pitch (clamped 0..127). */
static int pfx_apply_notefx(seq8_instance_t *inst, int scale_aware,
                             play_fx_t *fx, int orig_note) {
    int base = orig_note + fx->octave_shift * 12;
    int n = scale_aware ? scale_transpose(inst, clamp_i(base, 0, 127), fx->note_offset)
                        : clamp_i(base + fx->note_offset, 0, 127);
    return n;
}

/* Build harmonize copies (octaver + h1 + h2) of a primary note already past NOTE FX.
 * out[0] = primary; subsequent slots are octaver/h1/h2 if set. Returns count. */
static int pfx_build_harmz_copies(seq8_instance_t *inst, int scale_aware,
                                   play_fx_t *fx, int primary, uint8_t *out) {
    int cnt = 0;
    out[cnt++] = (uint8_t)primary;

    if (fx->octaver != 0) {
        int o = primary + fx->octaver * 12;
        if (o >= 0 && o <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)o;
    }
    if (fx->harmonize_1 != 0) {
        int h = scale_aware ? scale_transpose(inst, primary, fx->harmonize_1)
                            : primary + fx->harmonize_1;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    if (fx->harmonize_2 != 0) {
        int h = scale_aware ? scale_transpose(inst, primary, fx->harmonize_2)
                            : primary + fx->harmonize_2;
        if (h >= 0 && h <= 127 && cnt < MAX_GEN_NOTES) out[cnt++] = (uint8_t)h;
    }
    return cnt;
}

static int pfx_build_gen_notes(seq8_instance_t *inst, int scale_aware,
                               play_fx_t *fx, int orig_note, uint8_t *out) {
    int primary = pfx_apply_notefx(inst, scale_aware, fx, orig_note);
    return pfx_build_harmz_copies(inst, scale_aware, fx, primary, out);
}

/* ------------------------------------------------------------------ */
/* Delay repeat scheduling (direct port from NoteTwist)                */
/* ------------------------------------------------------------------ */

static void pfx_sched_delay_ons(seq8_instance_t *inst, int scale_aware,
                                play_fx_t *fx, pfx_active_t *an,
                                uint64_t base_time, double sp) {
    if (fx->repeat_times == 0 || fx->delay_level == 0) return;
    int dclk = CLOCK_VALUES[fx->delay_time_idx];
    if (dclk == 0) return;

    an->spc = sp;
    int reps = clamp_i(fx->repeat_times, 0, MAX_REPEATS);
    an->stored_repeat_count = reps;

    double cumul     = 0.0;
    double cur_delay = (double)dclk * sp;
    int    cumul_pitch = 0;
    int    cumul_deg   = 0;
    int    rep_vel   = (int)an->orig_velocity * fx->delay_level / 127;

    int i;
    for (i = 0; i < reps; i++) {
        cumul += cur_delay;
        if ((uint64_t)(cumul + 0.5) > MAX_DELAY_SAMPLES) {
            an->stored_repeat_count = i;
            break;
        }

        {
            if (fx->fb_note_random) {
                if (scale_aware) {
                    int lim = (int)SCALE_SIZES[inst->pad_scale < 14 ? inst->pad_scale : 0];
                    cumul_deg = pfx_rand(fx, -lim, lim);
                } else {
                    cumul_pitch = pfx_rand(fx, -12, 12);
                }
            } else {
                if (scale_aware) cumul_deg   += fx->fb_note;
                else             cumul_pitch += fx->fb_note;
            }
        }
        {
            int pitch = (scale_aware && an->gen_count > 0)
                ? scale_transpose(inst, (int)an->gen_notes[0], cumul_deg) - (int)an->gen_notes[0]
                : cumul_pitch;
            an->reps[i].pitch_offset = (int8_t)clamp_i(pitch, -127, 127);
        }

        if (i > 0) rep_vel += fx->fb_velocity;
        rep_vel = clamp_i(rep_vel, 1, 127);
        an->reps[i].velocity = (uint8_t)rep_vel;

        double gf = 1.0;
        int k;
        for (k = 0; k <= i; k++)
            gf *= (1.0 + fx->fb_gate_time / 100.0);
        an->reps[i].gate_factor = gf;

        an->reps[i].cumul_delay = (uint64_t)(cumul + 0.5);

        uint64_t ft   = base_time + an->reps[i].cumul_delay;
        uint8_t  on_s = (uint8_t)(0x90 | an->channel);
        int j;
        for (j = 0; j < an->gen_count; j++) {
            int note = (int)an->gen_notes[j] + an->reps[i].pitch_offset;
            note = clamp_i(note, 0, 127);
            pfx_q_insert(fx, ft, on_s, (uint8_t)note, an->reps[i].velocity);
        }

        cur_delay *= (1.0 + fx->fb_clock / 100.0);
        if (cur_delay < 1.0) cur_delay = 1.0;
    }
}

/* Schedule note-offs for all delay repeats. Called when original note-off
 * arrives. base_time is the note-on time plus unison extension. */
static void pfx_sched_delay_offs(play_fx_t *fx, pfx_active_t *an,
                                 uint64_t base_time, uint64_t gate_smp) {
    uint8_t off_s = (uint8_t)(0x80 | an->channel);
    int i;
    for (i = 0; i < an->stored_repeat_count; i++) {
        double rg = (double)gate_smp * an->reps[i].gate_factor;
        if (rg < 1.0) rg = 1.0;
        uint64_t off = base_time + an->reps[i].cumul_delay + (uint64_t)(rg + 0.5);
        int j;
        for (j = 0; j < an->gen_count; j++) {
            int note = (int)an->gen_notes[j] + an->reps[i].pitch_offset;
            note = clamp_i(note, 0, 127);
            pfx_q_insert(fx, off, off_s, (uint8_t)note, 0);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Core play effects processing                                         */
/* ------------------------------------------------------------------ */

static void arp_clear_runtime(arp_engine_t *a) {
    a->held_count          = 0;
    a->next_order          = 0;
    a->cyc_pos             = 0;
    a->ud_dir              = 1;
    a->cycle_step_count    = 0;
    a->random_used         = 0;
    a->step_pos            = 0;
    a->ticks_until_next    = 0;
    a->pending_first_note  = 0;
    a->pending_retrigger   = 0;
    a->sounding_active     = 0;
    a->sounding_pitch      = 0;
    a->gate_remaining      = 0;
    a->master_anchor       = 0;
}

/* Reset cycle/step pattern position to start. Called when retrigger=1 sees a
 * new note enter the buffer or the active clip wraps. Leaves held buffer +
 * sounding note alone — only resets pattern progression. master_tick lets
 * step_pos snap to column 0 on the next tick. */
static void arp_retrigger(arp_engine_t *a, uint32_t master_tick) {
    a->cyc_pos          = 0;
    a->ud_dir           = 1;
    a->cycle_step_count = 0;
    a->random_used      = 0;
    a->step_pos         = 0;
    a->ticks_until_next = 0;
    a->pending_first_note = 1;
    a->master_anchor    = master_tick;
}

static void arp_init_defaults(arp_engine_t *a) {
    a->style     = 0;
    a->rate_idx  = ARP_RATE_DEFAULT;
    a->octaves   = 1;
    a->gate_pct  = 50;
    a->steps_mode = 0;
    a->retrigger = 1;
    int i;
    /* step_vel level: 0=off, 1=row0(min), 4=row3(full incoming). Default 4. */
    for (i = 0; i < 8; i++) a->step_vel[i] = 4;
    arp_clear_runtime(a);
}

/* Set all play effects parameters to neutral / passthrough. */
static void pfx_reset(play_fx_t *fx) {
    fx->octave_shift    = 0;
    fx->note_offset     = 0;
    fx->gate_time       = 100;
    fx->velocity_offset = 0;
    fx->unison          = 0;
    fx->octaver         = 0;
    fx->harmonize_1     = 0;
    fx->harmonize_2     = 0;
    fx->delay_time_idx  = 0;
    fx->delay_level     = 0;
    fx->repeat_times    = 0;
    fx->fb_velocity     = 0;
    fx->fb_note         = 0;
    fx->fb_note_random  = 0;
    fx->fb_gate_time    = 0;
    fx->fb_clock        = 0;
    fx->quantize        = 0;
    arp_init_defaults(&fx->arp);
}

/* Process a note-on through the chain. Sends immediate output via
 * pfx_send; queues unison stagger copies and delay repeats.
 *
 * SEQ ARP intercepts at pfx_send (last stage). All callers (sequencer,
 * live pad, external MIDI) flow through this function the same way; if
 * arp.on, the chain's emissions get captured into the arp's held buffer
 * and the arp re-emits the picked note via pfx_send with arp_emitting=1. */
static void pfx_note_on(seq8_instance_t *inst, seq8_track_t *tr,
                        uint8_t orig_note, uint8_t vel) {
    play_fx_t   *fx  = &tr->pfx;
    uint8_t      ch  = tr->channel;
    uint64_t     now = fx->sample_counter;
    pfx_active_t *an = &fx->active_notes[orig_note];

    int v = clamp_i((int)vel + fx->velocity_offset, 1, 127);

    int is_scale_aware = inst->scale_aware && (tr->pad_mode == PAD_MODE_MELODIC_SCALE);
    uint8_t gen[MAX_GEN_NOTES];
    int gc = pfx_build_gen_notes(inst, is_scale_aware, fx, (int)orig_note, gen);

    /* Retrigger guard: if this note is already active, clean up first. */
    if (an->active) {
        uint8_t off_s = (uint8_t)(0x80 | an->channel);
        int i;
        for (i = 0; i < an->gen_count; i++)
            pfx_send(fx, off_s, an->gen_notes[i], 0);
    }

    /* Store active-note record. */
    memset(an, 0, sizeof(pfx_active_t));
    an->active        = 1;
    an->channel       = ch;
    an->on_time       = now;
    an->orig_velocity = (uint8_t)v;
    an->gen_count     = gc;
    memcpy(an->gen_notes, gen, (size_t)gc);
    an->stored_unison = fx->unison;

    double sp    = pfx_spc(inst, tr);
    uint8_t on_s = (uint8_t)(0x90 | ch);

    /* Immediate note-ons. */
    int i;
    for (i = 0; i < gc; i++)
        pfx_send(fx, on_s, gen[i], (uint8_t)v);

    /* Unison stagger copies (queued). */
    int c;
    for (c = 0; c < fx->unison; c++) {
        uint64_t stagger = now + (uint64_t)(UNISON_STAGGER * (c + 1));
        for (i = 0; i < gc; i++)
            pfx_q_insert(fx, stagger, on_s, gen[i], (uint8_t)v);
    }

    /* Delay repeats (note-ons only; note-offs scheduled at note-off time). */
    pfx_sched_delay_ons(inst, is_scale_aware, fx, an, now, sp);

    /* Print mode: capture primary output note and velocity into active clip. */
    if (inst->printing) {
        clip_t *cl = &tr->clips[tr->active_clip];
        cl->step_notes[tr->current_step][0] = gen[0];
        cl->step_note_count[tr->current_step] = 1;
        cl->step_vel[tr->current_step]  = (uint8_t)v;
    }
}

/* Process a note-off. Sends/queues note-offs for harmony copies and all
 * delay repeat echoes. Echoes never re-enter the chain. SEQ ARP captures
 * each emitted note-off via pfx_send, mirroring the note-on flow. */
static void pfx_note_off(seq8_instance_t *inst, seq8_track_t *tr,
                         uint8_t orig_note) {
    play_fx_t   *fx  = &tr->pfx;
    pfx_active_t *an = &fx->active_notes[orig_note];
    if (!an->active) return;

    uint64_t now      = fx->sample_counter;
    uint64_t gate_smp = pfx_gate_smp(inst, tr);
    uint64_t uni_ext  = (uint64_t)(UNISON_STAGGER * an->stored_unison);
    uint64_t off_time = an->on_time + gate_smp + uni_ext;
    uint8_t  off_s    = (uint8_t)(0x80 | an->channel);

    int i;
    for (i = 0; i < an->gen_count; i++) {
        if (off_time <= now)
            pfx_send(fx, off_s, an->gen_notes[i], 0);
        else
            pfx_q_insert(fx, off_time, off_s, an->gen_notes[i], 0);
    }

    pfx_sched_delay_offs(fx, an, an->on_time + uni_ext, gate_smp);
    an->active = 0;
}

/* Immediate note-off for live pad releases — bypasses gate_smp minimum.
 * gate_smp is a sequencer concept (note rings for its step duration); pads
 * should stop the moment the finger lifts regardless of how long gate_time is. */
static void pfx_note_off_imm(seq8_instance_t *inst, seq8_track_t *tr,
                              uint8_t orig_note) {
    play_fx_t   *fx  = &tr->pfx;
    pfx_active_t *an = &fx->active_notes[orig_note];
    if (!an->active) return;

    uint64_t now     = fx->sample_counter;
    uint64_t uni_ext = (uint64_t)(UNISON_STAGGER * an->stored_unison);
    uint8_t  off_s   = (uint8_t)(0x80 | an->channel);

    int i;
    for (i = 0; i < an->gen_count; i++)
        pfx_send(fx, off_s, an->gen_notes[i], 0);

    pfx_sched_delay_offs(fx, an, an->on_time + uni_ext, pfx_gate_smp(inst, tr));
    an->active = 0;
    (void)now;
}

/* ------------------------------------------------------------------ */
/* SEQ ARP engine                                                       */
/* ------------------------------------------------------------------ */

static void arp_add_note(arp_engine_t *a, uint8_t pitch, uint8_t vel) {
    int i;
    for (i = 0; i < a->held_count; i++)
        if (a->held_pitch[i] == pitch) { a->held_vel[i] = vel; return; }
    if (a->held_count >= ARP_MAX_HELD) return;
    int was_empty = (a->held_count == 0);
    a->held_pitch[a->held_count] = pitch;
    a->held_vel[a->held_count]   = vel;
    a->held_order[a->held_count] = a->next_order++;
    a->held_count++;
    if (was_empty) {
        /* Buffer 0→1: arm a fire on next rate boundary. cyc_pos / step_pos
         * persist across step boundaries so consecutive sequenced steps
         * progress through the cycle (only arp_silence fully resets). */
        a->pending_first_note = 1;
        a->ticks_until_next   = 0;
    }
    /* Retrigger=1: any new note (not just first) restarts the pattern.
     * Deferred to arp_tick so we can use the current arp_master_tick as anchor. */
    if (a->retrigger) a->pending_retrigger = 1;
}

static void arp_remove_note(arp_engine_t *a, uint8_t pitch) {
    int i, found = -1;
    for (i = 0; i < a->held_count; i++)
        if (a->held_pitch[i] == pitch) { found = i; break; }
    if (found < 0) return;
    for (i = found; i + 1 < a->held_count; i++) {
        a->held_pitch[i] = a->held_pitch[i + 1];
        a->held_vel[i]   = a->held_vel[i + 1];
        a->held_order[i] = a->held_order[i + 1];
    }
    a->held_count--;
    if (a->held_count == 0) {
        /* Buffer empty — let the sounding note play out its own gate via
         * arp_tick countdown. Don't reset cycle position; consecutive
         * sequenced steps continue the pattern across the empty gap. */
        a->pending_first_note = 0;
        a->next_order         = 0;
    }
}

/* Drop all held notes, silence sounding, and reset cycle state.
 * Sounding silence is emitted raw (arp_emitting=1) so it bypasses the
 * arp gate in pfx_send. */
static void arp_silence(seq8_instance_t *inst, seq8_track_t *tr) {
    (void)inst;
    play_fx_t *fx = &tr->pfx;
    arp_engine_t *a = &fx->arp;
    if (a->sounding_active) {
        fx->arp_emitting = 1;
        pfx_send(fx, (uint8_t)(0x80 | tr->channel), a->sounding_pitch, 0);
        fx->arp_emitting = 0;
    }
    arp_clear_runtime(a);
}

/* Build the style-ordered list of held-buffer indices. ordered[i] is the held
 * buffer index playing at cycle position i within one octave. Length = held_count. */
static int arp_build_ordered(const arp_engine_t *a, uint8_t *ordered) {
    int N = a->held_count;
    if (N == 0) return 0;
    int i, j;
    /* Pitch-sorted ascending: parallel arrays of (pitch, held-index). */
    uint8_t pitch_asc[ARP_MAX_HELD];
    uint8_t idx_asc[ARP_MAX_HELD];
    for (i = 0; i < N; i++) { pitch_asc[i] = a->held_pitch[i]; idx_asc[i] = (uint8_t)i; }
    for (i = 1; i < N; i++) {
        uint8_t pv = pitch_asc[i], iv = idx_asc[i];
        for (j = i; j > 0 && pitch_asc[j - 1] > pv; j--) {
            pitch_asc[j] = pitch_asc[j - 1]; idx_asc[j] = idx_asc[j - 1];
        }
        pitch_asc[j] = pv; idx_asc[j] = iv;
    }
    /* Insertion-order sorted: by held_order. */
    uint8_t order_val[ARP_MAX_HELD];
    uint8_t order_idx[ARP_MAX_HELD];
    for (i = 0; i < N; i++) { order_val[i] = a->held_order[i]; order_idx[i] = (uint8_t)i; }
    for (i = 1; i < N; i++) {
        uint8_t ov = order_val[i], oi = order_idx[i];
        for (j = i; j > 0 && order_val[j - 1] > ov; j--) {
            order_val[j] = order_val[j - 1]; order_idx[j] = order_idx[j - 1];
        }
        order_val[j] = ov; order_idx[j] = oi;
    }

    /* Style values: 0=Off (callers gate before reaching here), 1=Up, 2=Dn,
     * 3=U/D, 4=D/U, 5=Cnv, 6=Div, 7=Ord, 8=Rnd, 9=RnO. */
    switch (a->style) {
    case 1: case 3: /* Up; UpDown derives from Up */
        for (i = 0; i < N; i++) ordered[i] = idx_asc[i];
        break;
    case 2: case 4: /* Down; DownUp derives from Down */
        for (i = 0; i < N; i++) ordered[i] = idx_asc[N - 1 - i];
        break;
    case 5: /* Converge: high, low, 2nd-high, 2nd-low, ... */
        for (i = 0; i < N; i++) {
            int rank = (i % 2 == 0) ? (N - 1 - i / 2) : (i / 2);
            if (rank < 0) rank = 0; if (rank >= N) rank = N - 1;
            ordered[i] = idx_asc[rank];
        }
        break;
    case 6: /* Diverge: opposite of Converge */
        for (i = 0; i < N; i++) {
            int rev = N - 1 - i;
            int rank = (rev % 2 == 0) ? (N - 1 - rev / 2) : (rev / 2);
            if (rank < 0) rank = 0; if (rank >= N) rank = N - 1;
            ordered[i] = idx_asc[rank];
        }
        break;
    case 7: /* Play Order */
        for (i = 0; i < N; i++) ordered[i] = order_idx[i];
        break;
    case 8: case 9: /* Random / Random Other — base order, randomness applied later */
        for (i = 0; i < N; i++) ordered[i] = idx_asc[i];
        break;
    default:
        for (i = 0; i < N; i++) ordered[i] = idx_asc[i];
        break;
    }
    return N;
}

/* Pick the next logical position 0..(span-1) and update random_used / ud_dir / cyc_pos.
 * Returns the chosen logical position; returns -1 if span==0. */
static int arp_pick_next_pos(arp_engine_t *a, play_fx_t *fx, int span) {
    if (span <= 0) return -1;
    int chosen = 0;
    if (a->style == 8) {
        /* Random — uniform pick */
        chosen = pfx_rand(fx, 0, span - 1);
    } else if (a->style == 9) {
        /* Random Other — pick uniformly from indices not yet used. */
        uint64_t mask = a->random_used;
        int max_span = span > 64 ? 64 : span;
        uint64_t all = (max_span >= 64) ? ~(uint64_t)0
                                        : (((uint64_t)1 << max_span) - 1);
        if ((mask & all) == all) { mask = 0; a->random_used = 0; }
        int remaining = 0, k;
        for (k = 0; k < max_span; k++)
            if (!(mask & ((uint64_t)1 << k))) remaining++;
        if (remaining <= 0) { chosen = 0; }
        else {
            int pick = pfx_rand(fx, 0, remaining - 1);
            for (k = 0; k < max_span; k++) {
                if (mask & ((uint64_t)1 << k)) continue;
                if (pick == 0) { chosen = k; break; }
                pick--;
            }
        }
        a->random_used |= ((uint64_t)1 << (chosen < 64 ? chosen : 0));
    } else if (a->style == 3 || a->style == 4) {
        /* UpDown / DownUp — bidirectional triangle */
        int p = ((a->cyc_pos % span) + span) % span;
        chosen = p;
        if (span > 1) {
            int next = p + a->ud_dir;
            if (next >= span)      { next = span - 2; a->ud_dir = -1; }
            else if (next < 0)     { next = 1;        a->ud_dir =  1; }
            a->cyc_pos = next;
        }
        /* For DownUp, start position is span-1; mapped via ordered[] which already encodes Down. */
    } else {
        /* Up / Down / Converge / Diverge / Play Order — linear cycle */
        chosen = ((a->cyc_pos % span) + span) % span;
        a->cyc_pos = (a->cyc_pos + 1) % span;
        if (a->cyc_pos == 0) {
            a->cycle_step_count = 0;
            a->random_used = 0;
        }
    }
    return chosen;
}

/* Compute pitch+vel for cycle position. Returns 0 if no notes available. */
static int arp_compute_step(arp_engine_t *a, play_fx_t *fx,
                             uint8_t *out_pitch, uint8_t *out_vel) {
    if (a->held_count == 0) return 0;
    uint8_t ordered[ARP_MAX_HELD];
    int N = arp_build_ordered(a, ordered);
    if (N == 0) return 0;
    int oct_signed = (int)a->octaves;
    if (oct_signed == 0) oct_signed = 1;
    int abs_oct = oct_signed < 0 ? -oct_signed : oct_signed;
    if (abs_oct < 1) abs_oct = 1;
    int span = N * abs_oct;
    if (span > ARP_MAX_CYCLE) span = ARP_MAX_CYCLE;

    int pos = arp_pick_next_pos(a, fx, span);
    if (pos < 0) return 0;
    int oct_step = pos / N;
    /* Negative octaves descend: oct_step shifts pitch by -12 per step. */
    int oct_off  = oct_signed < 0 ? -oct_step : oct_step;
    int idx      = pos % N;
    int held     = ordered[idx];
    int pitch    = (int)a->held_pitch[held] + 12 * oct_off;
    if (pitch < 0) pitch = 0; if (pitch > 127) pitch = 127;
    *out_pitch = (uint8_t)pitch;
    *out_vel   = a->held_vel[held];
    return 1;
}

/* Fire one arp step: silence prior, emit next note (with step pattern + decay).
 *
 * Steps modes:
 *   0 = Off   — step_vel array ignored, every step fires at incoming vel.
 *   1 = Mute  — level 0 step rests (no note); cycle advances underneath so
 *               the next active step plays what would have played anyway.
 *   2 = Step  — level 0 step skips entirely (no note, no cycle advance).
 *
 * step_vel[i] is a 5-state level: 0 = step off, 1..4 = row 0..3 of the editor.
 * Active levels lerp between vel=10 (level 1) and incoming vel (level 4).
 *
 * Column = beat division of the arp rate (rate=1/16 → cols are 1/16 notes,
 * rate=1/4 → cols are 1/4 notes). step_pos is derived from absolute master
 * tick position so the editor pattern is musically anchored. */
static void arp_fire_step(seq8_instance_t *inst, seq8_track_t *tr) {
    play_fx_t    *fx = &tr->pfx;
    arp_engine_t *a  = &fx->arp;
    if (a->held_count == 0) return;

    uint16_t rate = ARP_RATE_TICKS[a->rate_idx];
    if (rate == 0) rate = 24;

    /* Editor column from absolute master clock — matches musical divisions.
     * arp_master_tick free-runs (advances when stopped too) so live input
     * arpeggiates even when transport is off. master_anchor is the tick at
     * which retrigger was last fired (0 by default); column 0 sits at anchor. */
    uint32_t master_pos = inst->arp_master_tick - a->master_anchor;
    int step_idx = (int)((master_pos / rate) & 7);
    a->step_pos = (uint8_t)step_idx;

    uint8_t level = a->step_vel[step_idx];
    int step_off = (a->steps_mode != 0) && (level == 0);

    /* Step mode + step off: skip — no fire, no cycle advance, leave sounding alone.
     * Reset interval so we land on the next rate boundary, not the next render tick. */
    if (step_off && a->steps_mode == 2) {
        a->ticks_until_next = (int32_t)rate;
        return;
    }

    /* Silence prior sounding note before firing next (or before resting in Mute).
     * Raw emit (arp_emitting=1) so it bypasses the pfx_send arp gate. */
    if (a->sounding_active) {
        fx->arp_emitting = 1;
        pfx_send(fx, (uint8_t)(0x80 | tr->channel), a->sounding_pitch, 0);
        fx->arp_emitting = 0;
        a->sounding_active = 0;
    }

    if (step_off) {
        /* Mute mode + step off: rest this slot but advance cycle so the next
         * active step plays the note that would have played anyway. */
        uint8_t pitch_unused, vel_unused;
        (void)arp_compute_step(a, fx, &pitch_unused, &vel_unused);
        a->cycle_step_count++;
        a->ticks_until_next = (int32_t)rate;
        return;
    }

    uint8_t pitch, base_vel;
    if (!arp_compute_step(a, fx, &pitch, &base_vel)) {
        a->ticks_until_next = (int32_t)rate;
        return;
    }

    /* Velocity: in Off mode, use incoming directly; in Mute/Step modes, scale
     * via the level: level 1 → vel 10, level 4 → vel = base_vel, levels 2/3
     * proportionally between. */
    int v = (int)base_vel;
    if (a->steps_mode != 0 && level >= 1 && level <= 4) {
        if (level == 4) {
            v = (int)base_vel;
        } else {
            /* lerp(10, base_vel, (level-1)/3) */
            int span = (int)base_vel - 10;
            v = 10 + (span * (level - 1)) / 3;
        }
    }
    if (v < 1)   v = 1;
    if (v > 127) v = 127;

    /* Emit raw — arp is the LAST chain stage. The pitch already came out of
     * NOTE FX → HARMZ → MIDI DLY upstream, so no further processing here.
     * arp_emitting=1 bypasses the pfx_send arp gate. */
    fx->arp_emitting = 1;
    pfx_send(fx, (uint8_t)(0x90 | tr->channel), pitch, (uint8_t)v);
    fx->arp_emitting = 0;

    a->sounding_pitch  = pitch;
    a->sounding_active = 1;

    /* Set next-step interval and gate countdown. */
    a->ticks_until_next = (int32_t)rate;
    uint32_t gate = ((uint32_t)rate * (uint32_t)a->gate_pct) / 100U;
    if (gate < 1)        gate = 1;
    if (gate >= rate)    gate = (uint32_t)rate - 1; /* note-off before next on */
    a->gate_remaining = gate;

    a->cycle_step_count++;
}

/* Per master tick — called once per render-tick per track from render_block. */
static void arp_tick(seq8_instance_t *inst, seq8_track_t *tr) {
    play_fx_t    *fx = &tr->pfx;
    arp_engine_t *a  = &fx->arp;
    if (a->style == 0) return;

    /* Drain deferred retrigger (set by arp_add_note when retrigger=1, or by
     * render_block on active-clip wrap). Anchors step_pos to current tick. */
    if (a->pending_retrigger) {
        a->pending_retrigger = 0;
        arp_retrigger(a, inst->arp_master_tick);
    }

    /* Gate countdown for sounding note (raw emit, bypasses arp gate). */
    if (a->sounding_active && a->gate_remaining > 0) {
        a->gate_remaining--;
        if (a->gate_remaining == 0) {
            fx->arp_emitting = 1;
            pfx_send(fx, (uint8_t)(0x80 | tr->channel), a->sounding_pitch, 0);
            fx->arp_emitting = 0;
            a->sounding_active = 0;
        }
    }

    if (a->held_count == 0) return;

    if (a->pending_first_note) {
        /* Wait for next master-tick boundary aligned with rate from anchor. */
        uint16_t rate = ARP_RATE_TICKS[a->rate_idx];
        if (rate == 0) rate = 24;
        uint32_t total = inst->arp_master_tick - a->master_anchor;
        if ((total % rate) == 0) {
            a->pending_first_note = 0;
            arp_fire_step(inst, tr);
        }
        return;
    }

    if (a->ticks_until_next > 0) a->ticks_until_next--;
    if (a->ticks_until_next <= 0) arp_fire_step(inst, tr);
}

static void silence_muted_tracks(seq8_instance_t *inst) {
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr = &inst->tracks[t];
        if (effective_mute(inst, t)) {
            silence_track_notes_v2(inst, tr);
            tr->step_dispatch_mask = 0;
        }
    }
}

/* ------------------------------------------------------------------ */
/* Plugin lifecycle                                                     */
/* ------------------------------------------------------------------ */

static void pfx_init_defaults(play_fx_t *fx) {
    pfx_reset(fx);                     /* explicit zero of all stages */
    fx->cached_bpm = (double)BPM_DEFAULT;
    fx->rng        = 12345;
    fx->route      = ROUTE_SCHWUNG;    /* default: Schwung chains */
}

static void clip_pfx_params_init(clip_pfx_params_t *p) {
    p->octave_shift    = 0;
    p->note_offset     = 0;
    p->gate_time       = 100;
    p->velocity_offset = 0;
    p->quantize        = 0;
    p->unison          = 0;
    p->octaver         = 0;
    p->harmonize_1     = 0;
    p->harmonize_2     = 0;
    p->delay_time_idx  = 0;
    p->delay_level     = 0;
    p->repeat_times    = 0;
    p->fb_velocity     = 0;
    p->fb_note         = 0;
    p->fb_note_random  = 0;
    p->fb_gate_time    = 0;
    p->fb_clock        = 0;
    p->seq_arp_style     = 0;
    p->seq_arp_rate      = ARP_RATE_DEFAULT;
    p->seq_arp_octaves   = 1;
    p->seq_arp_gate      = 50;
    p->seq_arp_steps_mode = 0;
    p->seq_arp_retrigger = 1;
    int i;
    for (i = 0; i < 8; i++) p->seq_arp_step_vel[i] = 4;
}

/* Copy per-clip pfx params from active clip into tr->pfx (the render surface).
 * Call this whenever active_clip changes so the render path always sees the
 * correct clip's params via tr->pfx. */
static void pfx_apply_params(play_fx_t *fx, const clip_pfx_params_t *p) {
    fx->octave_shift    = p->octave_shift;
    fx->note_offset     = p->note_offset;
    fx->gate_time       = p->gate_time;
    fx->velocity_offset = p->velocity_offset;
    fx->quantize        = p->quantize;
    fx->unison          = p->unison;
    fx->octaver         = p->octaver;
    fx->harmonize_1     = p->harmonize_1;
    fx->harmonize_2     = p->harmonize_2;
    fx->delay_time_idx  = p->delay_time_idx;
    fx->delay_level     = p->delay_level;
    fx->repeat_times    = p->repeat_times;
    fx->fb_velocity     = p->fb_velocity;
    fx->fb_note         = p->fb_note;
    fx->fb_note_random  = p->fb_note_random;
    fx->fb_gate_time    = p->fb_gate_time;
    fx->fb_clock        = p->fb_clock;
    /* SEQ ARP — copy params without disturbing runtime state */
    fx->arp.style      = (uint8_t)clamp_i(p->seq_arp_style,    0, 9);
    fx->arp.rate_idx   = (uint8_t)clamp_i(p->seq_arp_rate,     0, 9);
    {
        int _oc = clamp_i(p->seq_arp_octaves, -ARP_MAX_OCTAVES, ARP_MAX_OCTAVES);
        if (_oc == 0) _oc = 1;
        fx->arp.octaves = (int8_t)_oc;
    }
    fx->arp.gate_pct   = (uint16_t)clamp_i(p->seq_arp_gate,    1, 200);
    fx->arp.steps_mode = (uint8_t)clamp_i(p->seq_arp_steps_mode, 0, 2);
    fx->arp.retrigger  = (uint8_t)(p->seq_arp_retrigger != 0);
    int i;
    for (i = 0; i < 8; i++) fx->arp.step_vel[i] = p->seq_arp_step_vel[i];
}

static void pfx_sync_from_clip(seq8_track_t *tr) {
    pfx_apply_params(&tr->pfx, &tr->clips[tr->active_clip].pfx_params);
}

static void clip_init(clip_t *cl) {
    int s;
    cl->length         = SEQ_STEPS_DEFAULT;
    cl->active         = 0;
    cl->clock_shift_pos = 0;
    cl->stretch_exp     = 0;
    cl->nudge_pos       = 0;
    cl->ticks_per_step  = TICKS_PER_STEP;
    clip_pfx_params_init(&cl->pfx_params);
    for (s = 0; s < SEQ_STEPS; s++) {
        cl->steps[s]           = 0;
        memset(cl->step_notes[s], 0, 8);
        cl->step_note_count[s] = 0;
        cl->step_vel[s]        = SEQ_VEL;
        cl->step_gate[s]       = GATE_TICKS;
        memset(cl->note_tick_offset[s], 0, 8 * sizeof(int16_t));
    }
    cl->note_count = 0;
    memset(cl->notes, 0, sizeof(cl->notes));
    memset(cl->occ_cache, 0, sizeof(cl->occ_cache));
    cl->occ_dirty = 0;
}

static void drum_track_init(seq8_track_t *tr) {
    int c, l;
    for (c = 0; c < NUM_CLIPS; c++) {
        for (l = 0; l < DRUM_LANES; l++) {
            drum_lane_t *lane = &tr->drum_clips[c].lanes[l];
            clip_init(&lane->clip);
            lane->midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Note-centric helpers (Stage B+)                                     */
/* ------------------------------------------------------------------ */

/* Logical step for an absolute clip tick using midpoint assignment. */
static uint16_t note_step(uint32_t tick, uint16_t clip_len, uint16_t tps) {
    uint32_t shifted = tick + (uint32_t)(tps / 2);
    return (uint16_t)((shifted / (uint32_t)tps) % (uint32_t)clip_len);
}

/* Find all active note indices in step S; returns count. */
static int notes_in_step(clip_t *cl, uint16_t s, uint16_t *idxs, int max_out) {
    int count = 0;
    uint16_t i;
    for (i = 0; i < cl->note_count && count < max_out; i++) {
        if (!cl->notes[i].active) continue;
        if (note_step(cl->notes[i].tick, cl->length, cl->ticks_per_step) == s)
            idxs[count++] = i;
    }
    return count;
}

/* Rebuild the 256-bit occupancy cache from notes[]. */
static void clip_occ_update(clip_t *cl) {
    memset(cl->occ_cache, 0, sizeof(cl->occ_cache));
    uint16_t i;
    for (i = 0; i < cl->note_count; i++) {
        if (!cl->notes[i].active || cl->notes[i].step_muted) continue;
        uint16_t s = note_step(cl->notes[i].tick, cl->length, cl->ticks_per_step);
        cl->occ_cache[s >> 3] |= (uint8_t)(1u << (s & 7));
    }
    cl->occ_dirty = 0;
}

static void clip_clear_suppress(clip_t *cl) {
    uint16_t i;
    for (i = 0; i < cl->note_count; i++)
        cl->notes[i].suppress_until_wrap = 0;
}

/* Finalize gates for notes still held in rec_pending at disarm time.
 * Must be called BEFORE clip_clear_suppress so suppress_until_wrap is still set. */
static void finalize_pending_notes(clip_t *cl, seq8_track_t *tr) {
    uint16_t tps = cl->ticks_per_step;
    uint32_t clip_ticks = (uint32_t)cl->length * tps;
    if (clip_ticks == 0) { tr->rec_pending_count = 0; return; }
    uint32_t off_tick = tr->current_clip_tick % clip_ticks;
    uint32_t gmax = (uint32_t)SEQ_STEPS * tps;
    if (gmax > 65535) gmax = 65535;
    int ri;
    for (ri = 0; ri < (int)tr->rec_pending_count; ri++) {
        uint32_t on_tick = tr->rec_pending[ri].tick_at_on;
        uint32_t gate_ticks = (off_tick >= on_tick) ? off_tick - on_tick
                                                     : clip_ticks - on_tick + off_tick;
        if (gate_ticks < 1) gate_ticks = 1;
        if (gate_ticks > gmax) gate_ticks = gmax;
        /* Update matching note in notes[] — scan newest first */
        uint16_t ni;
        for (ni = (cl->note_count > 0 ? cl->note_count - 1 : 0);
             ni < cl->note_count; ni--) {
            note_t *n = &cl->notes[ni];
            if (n->active
                    && n->pitch == tr->rec_pending[ri].pitch
                    && n->tick  == on_tick) {
                n->gate = (uint16_t)gate_ticks;
                uint16_t sidx = (uint16_t)(on_tick / tps);
                if (sidx < SEQ_STEPS && cl->steps[sidx])
                    cl->step_gate[sidx] = (uint16_t)gate_ticks;
                break;
            }
            if (ni == 0) break;
        }
    }
    tr->rec_pending_count = 0;
}

/* Insert a note; write all fields before incrementing note_count (render-thread safe). */
static int clip_insert_note(clip_t *cl, uint32_t tick, uint16_t gate,
                             uint8_t pitch, uint8_t vel) {
    if (cl->note_count >= MAX_NOTES_PER_CLIP) return -1;
    int idx = (int)cl->note_count;
    cl->notes[idx].tick              = tick;
    cl->notes[idx].gate              = gate;
    cl->notes[idx].pitch             = pitch;
    cl->notes[idx].vel               = vel;
    cl->notes[idx].suppress_until_wrap = 0;
    cl->notes[idx].step_muted        = 0;
    cl->notes[idx].pad[0]            = 0;
    cl->notes[idx].active            = 1;   /* activate last */
    cl->note_count++;
    cl->occ_dirty = 1;
    return idx;
}

/* Rebuild step arrays from notes[] — used after v=11 state load. */
static void clip_build_steps_from_notes(clip_t *cl) {
    int s;
    for (s = 0; s < SEQ_STEPS; s++) {
        cl->steps[s] = 0;
        memset(cl->step_notes[s], 0, 8);
        cl->step_note_count[s] = 0;
        cl->step_vel[s]  = (uint8_t)SEQ_VEL;
        cl->step_gate[s] = (uint16_t)GATE_TICKS;
        memset(cl->note_tick_offset[s], 0, 8 * sizeof(int16_t));
    }
    cl->active = 0;
    cl->occ_dirty = 1;
    uint16_t ni;
    for (ni = 0; ni < cl->note_count; ni++) {
        note_t *n = &cl->notes[ni];
        if (!n->active) continue;
        uint16_t sidx = note_step(n->tick, cl->length, cl->ticks_per_step);
        if (sidx >= SEQ_STEPS || cl->step_note_count[sidx] >= 8) continue;
        int idx = (int)cl->step_note_count[sidx];
        if (idx == 0) {
            cl->step_vel[sidx]  = n->vel;
            cl->step_gate[sidx] = n->gate;
        }
        cl->step_notes[sidx][idx] = n->pitch;
        cl->note_tick_offset[sidx][idx] =
            (int16_t)((int32_t)n->tick - (int32_t)sidx * cl->ticks_per_step);
        cl->step_note_count[sidx]++;
        if (!n->step_muted) {
            cl->steps[sidx] = 1;
            cl->active = 1;
        }
    }
}

/* Derive notes[] from step arrays. Called after state load so both representations exist. */
static void clip_migrate_to_notes(clip_t *cl) {
    int s, ni;
    cl->note_count = 0;
    memset(cl->notes, 0, sizeof(cl->notes));
    cl->occ_dirty = 1;
    int tps = (int)cl->ticks_per_step;
    int clip_ticks = (int)cl->length * tps;
    for (s = 0; s < (int)cl->length; s++) {
        if (cl->step_note_count[s] == 0) continue;
        uint8_t muted = cl->steps[s] ? 0 : 1;
        for (ni = 0; ni < (int)cl->step_note_count[s]; ni++) {
            int32_t abs_tick = (int32_t)s * tps
                               + (int32_t)cl->note_tick_offset[s][ni];
            if (abs_tick < 0) abs_tick += clip_ticks;
            if (abs_tick >= clip_ticks) abs_tick = clip_ticks - 1;
            int idx = clip_insert_note(cl, (uint32_t)abs_tick, cl->step_gate[s],
                                       cl->step_notes[s][ni], cl->step_vel[s]);
            if (idx >= 0) cl->notes[idx].step_muted = muted;
            if (cl->note_count >= MAX_NOTES_PER_CLIP) return;
        }
    }
}

static void seq8_clear_state(seq8_instance_t *inst) {
    int t, c;
    send_panic(inst);
    inst->playing        = 0;
    inst->count_in_ticks = 0;
    for (t = 0; t < NUM_TRACKS; t++) {
        seq8_track_t *tr = &inst->tracks[t];
        tr->note_active         = 0;
        tr->pending_note_count  = 0;
        tr->play_pending_count  = 0;
        tr->rec_pending_count   = 0;
        tr->pfx.event_count     = 0;
        memset(tr->pfx.active_notes, 0, sizeof(tr->pfx.active_notes));
        tr->clip_playing        = 0;
        tr->will_relaunch       = 0;
        tr->pending_page_stop   = 0;
        tr->record_armed        = 0;
        tr->recording           = 0;
        tr->queued_clip         = -1;
        tr->active_clip         = 0;
        tr->current_step        = 0;
        tr->tick_in_step        = 0;
        tr->step_dispatch_mask  = 0;
        tr->next_early_mask     = 0;
        tr->current_clip_tick   = 0;
        for (c = 0; c < NUM_CLIPS; c++)
            clip_init(&tr->clips[c]);
    }
    inst->master_tick_in_step = 0;
    inst->arp_master_tick     = 0;
}

static void *create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir; (void)json_defaults;

    seq8_instance_t *inst = (seq8_instance_t *)calloc(1, sizeof(seq8_instance_t));
    if (!inst) return NULL;
    g_inst = inst;

    inst->sample_rate    = (g_host && g_host->sample_rate > 0)
                           ? (float)g_host->sample_rate : 44100.0f;
    inst->log_fp         = fopen(SEQ8_LOG_PATH, "a");

    inst->pad_key      = 9;   /* A */
    inst->pad_scale    = 1;   /* Minor */
    inst->launch_quant = 0;   /* Now */
    inst->metro_on     = 1;    /* default: Count (count-in only) */
    inst->metro_vol    = 80;
    inst->looper_sync  = 1;
    memset(inst->perf_emitted_pitch, 0xFF, sizeof(inst->perf_emitted_pitch));
    strncpy(inst->state_path, SEQ8_STATE_PATH_FALLBACK, sizeof(inst->state_path) - 1);

    /* Resolve per-set state path from active_set.txt */
    {
        char uuid[128] = {0};
        FILE *uf = fopen("/data/UserData/schwung/active_set.txt", "r");
        if (uf) {
            if (fgets(uuid, sizeof(uuid), uf)) {
                int i = (int)strlen(uuid) - 1;
                while (i >= 0 && (uuid[i] == '\n' || uuid[i] == '\r' || uuid[i] == ' '))
                    uuid[i--] = '\0';
            }
            fclose(uf);
        }
        if (uuid[0])
            snprintf(inst->state_path, sizeof(inst->state_path),
                     "/data/UserData/schwung/set_state/%s/seq8-state.json", uuid);
    }

    /* Unique nonce: JS polls this to detect DSP hot-reload */
    inst->instance_nonce = (uint32_t)time(NULL) ^ (uint32_t)((uintptr_t)inst >> 3);

    int t, c;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->tracks[t].channel     = (uint8_t)t;
        inst->tracks[t].queued_clip = -1;
        inst->tracks[t].pad_octave  = 3;
        inst->tracks[t].pad_mode    = PAD_MODE_MELODIC_SCALE;
        for (c = 0; c < NUM_CLIPS; c++)
            clip_init(&inst->tracks[t].clips[c]);
        drum_track_init(&inst->tracks[t]);
        pfx_init_defaults(&inst->tracks[t].pfx);
        inst->tracks[t].pfx.looper_on = 1;
        inst->tracks[t].pfx.track_idx = (uint8_t)t;
        /* Default routing: tracks 1-4 → Move (ch 1-4), tracks 5-8 → Schwung (ch 5-8) */
        if (t < 4) inst->tracks[t].pfx.route = ROUTE_MOVE;
    }

    inst->tick_threshold = (uint32_t)(inst->sample_rate * 60.0f);
    {
        double init_bpm = (g_host && g_host->get_bpm)
            ? (double)g_host->get_bpm() : (double)BPM_DEFAULT;
        if (init_bpm < 20.0 || init_bpm > 300.0) init_bpm = (double)BPM_DEFAULT;
        for (t = 0; t < NUM_TRACKS; t++)
            inst->tracks[t].pfx.cached_bpm = init_bpm;
        inst->tick_delta = (uint32_t)((double)MOVE_FRAMES_PER_BLOCK * init_bpm * (double)PPQN);
    }

    seq8_load_state(inst);

    {
        char szlog[128];
        snprintf(szlog, sizeof(szlog),
                 "SEQ8 drum-mode init: sizeof_inst=%zu sizeof_drum_clip=%zu get_bpm=%s bpm=%.1f",
                 sizeof(seq8_instance_t),
                 sizeof(drum_clip_t),
                 (g_host && g_host->get_bpm) ? "ok" : "null",
                 inst->tracks[0].pfx.cached_bpm);
        seq8_ilog(inst, szlog);
    }
    return inst;
}

static void destroy_instance(void *instance) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst) return;
    seq8_save_state(inst);  /* Option C: persist state before teardown */
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->tracks[t].pfx.event_count = 0;
        memset(inst->tracks[t].pfx.active_notes, 0,
               sizeof(inst->tracks[t].pfx.active_notes));
    }
    send_panic(inst);
    g_inst = NULL;
    seq8_ilog(inst, "SEQ8 instance destroyed");
    if (inst->log_fp) fclose(inst->log_fp);
    free(inst);
}

/* ------------------------------------------------------------------ */
/* on_midi                                                              */
/* ------------------------------------------------------------------ */

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)instance; (void)msg; (void)len; (void)source;
}

/* ------------------------------------------------------------------ */
/* Undo/redo helpers                                                    */
/* ------------------------------------------------------------------ */

static void undo_begin_single(seq8_instance_t *inst, int t, int c) {
    inst->undo_clip_count    = 1;
    inst->undo_clip_tracks[0]  = (uint8_t)t;
    inst->undo_clip_indices[0] = (uint8_t)c;
    memcpy(&inst->undo_clips[0], &inst->tracks[t].clips[c], sizeof(clip_t));
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
}

static void undo_begin_row(seq8_instance_t *inst, int row_c) {
    int t;
    inst->undo_clip_count = NUM_TRACKS;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->undo_clip_tracks[t]  = (uint8_t)t;
        inst->undo_clip_indices[t] = (uint8_t)row_c;
        memcpy(&inst->undo_clips[t], &inst->tracks[t].clips[row_c], sizeof(clip_t));
    }
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
}

/* Snapshot two clips (src + dst) for cut operations — restores both on undo. */
static void undo_begin_clip_pair(seq8_instance_t *inst, int srcT, int srcC, int dstT, int dstC) {
    inst->undo_clip_count      = 2;
    inst->undo_clip_tracks[0]  = (uint8_t)srcT;
    inst->undo_clip_indices[0] = (uint8_t)srcC;
    memcpy(&inst->undo_clips[0], &inst->tracks[srcT].clips[srcC], sizeof(clip_t));
    inst->undo_clip_tracks[1]  = (uint8_t)dstT;
    inst->undo_clip_indices[1] = (uint8_t)dstC;
    memcpy(&inst->undo_clips[1], &inst->tracks[dstT].clips[dstC], sizeof(clip_t));
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
}

/* Snapshot two full rows (src + dst, 16 clips) for row cut operations. */
static void undo_begin_row_pair(seq8_instance_t *inst, int srcRow, int dstRow) {
    int t;
    inst->undo_clip_count = NUM_TRACKS * 2;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->undo_clip_tracks[t]  = (uint8_t)t;
        inst->undo_clip_indices[t] = (uint8_t)srcRow;
        memcpy(&inst->undo_clips[t], &inst->tracks[t].clips[srcRow], sizeof(clip_t));
        inst->undo_clip_tracks[t + NUM_TRACKS]  = (uint8_t)t;
        inst->undo_clip_indices[t + NUM_TRACKS] = (uint8_t)dstRow;
        memcpy(&inst->undo_clips[t + NUM_TRACKS], &inst->tracks[t].clips[dstRow], sizeof(clip_t));
    }
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
}

static void undo_begin_drum_clip(seq8_instance_t *inst, int t, int c) {
    int l;
    drum_clip_t *dc = &inst->tracks[t].drum_clips[c];
    for (l = 0; l < DRUM_LANES; l++) {
        const clip_t *src = &dc->lanes[l].clip;
        drum_rec_snap_lane_t *dst = &inst->drum_undo_lanes[l];
        memcpy(dst->steps,            src->steps,            SEQ_STEPS);
        memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
        memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
        memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
        memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
        memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
        dst->length = src->length;
        dst->active = src->active;
    }
    inst->drum_undo_valid = 1;
    inst->drum_undo_track = (uint8_t)t;
    inst->drum_undo_clip  = (uint8_t)c;
    inst->drum_redo_valid = 0;
    inst->undo_valid = 0;
}

static void apply_clip_restore(seq8_instance_t *inst,
                                clip_t *clips,
                                uint8_t *tracks, uint8_t *indices, uint8_t count) {
    int i;
    for (i = 0; i < (int)count; i++) {
        int t = (int)tracks[i], c = (int)indices[i];
        seq8_track_t *tr = &inst->tracks[t];
        int is_active_clip = ((int)tr->active_clip == c);
        int is_queued_clip = (tr->queued_clip == (int8_t)c);
        if ((tr->recording || tr->record_armed) && (is_active_clip || is_queued_clip)) {
            finalize_pending_notes(&tr->clips[c], tr);
            silence_track_notes_v2(inst, tr);
            tr->recording         = 0;
            tr->record_armed      = 0;
            tr->rec_pending_count = 0;
        }
        if ((int)inst->count_in_track == t && inst->count_in_ticks > 0)
            inst->count_in_ticks = 0;
        memcpy(&tr->clips[c], &clips[i], sizeof(clip_t));
        clip_migrate_to_notes(&tr->clips[c]);
        if (is_active_clip)
            pfx_sync_from_clip(tr);
    }
}

#include "seq8_set_param.c"

/* ------------------------------------------------------------------ */
/* get_param helpers                                                    */
/* ------------------------------------------------------------------ */

static int pfx_get(seq8_track_t *tr, const char *key, char *out, int out_len) {
    play_fx_t *fx = &tr->pfx;

    if (!strcmp(key, "channel"))
        return snprintf(out, out_len, "%d", (int)tr->channel + 1);

    if (!strcmp(key, "route"))
        return snprintf(out, out_len, "%s",
                        fx->route == ROUTE_MOVE ? "move" : "schwung");

    if (!strcmp(key, "track_looper"))
        return snprintf(out, out_len, "%d", (int)fx->looper_on);

    /* Batch read: per-clip pfx params. Fields 0-16: NOTE FX K0-K4, HARMZ K0-K3,
     * MIDI DLY K0-K7 (legacy 17). Fields 17-22: SEQ ARP K1-K6 (style/rate/
     * octaves/gate/steps_mode/retrigger). Fields 23-30: SEQ ARP step_vel[0..7]. */
    if (!strcmp(key, "pfx_snapshot"))
        return snprintf(out, out_len,
            "%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d "
            "%d %d %d %d %d %d %d %d",
            fx->octave_shift, fx->note_offset, fx->gate_time, fx->velocity_offset, fx->quantize,
            fx->unison, fx->octaver, fx->harmonize_1, fx->harmonize_2,
            fx->delay_time_idx, fx->delay_level, fx->repeat_times,
            fx->fb_velocity, fx->fb_note, fx->fb_gate_time, fx->fb_clock, fx->fb_note_random,
            (int)fx->arp.style, (int)fx->arp.rate_idx,
            (int)fx->arp.octaves, (int)fx->arp.gate_pct,
            (int)fx->arp.steps_mode, (int)fx->arp.retrigger,
            (int)fx->arp.step_vel[0], (int)fx->arp.step_vel[1], (int)fx->arp.step_vel[2],
            (int)fx->arp.step_vel[3], (int)fx->arp.step_vel[4], (int)fx->arp.step_vel[5],
            (int)fx->arp.step_vel[6], (int)fx->arp.step_vel[7]);

    if (!strcmp(key, "noteFX_octave"))    return snprintf(out, out_len, "%d", fx->octave_shift);
    if (!strcmp(key, "noteFX_offset"))    return snprintf(out, out_len, "%d", fx->note_offset);
    if (!strcmp(key, "noteFX_gate"))      return snprintf(out, out_len, "%d", fx->gate_time);
    if (!strcmp(key, "noteFX_velocity"))  return snprintf(out, out_len, "%d", fx->velocity_offset);
    if (!strcmp(key, "quantize"))         return snprintf(out, out_len, "%d", fx->quantize);

    if (!strcmp(key, "harm_unison")) {
        static const char *ul[3] = { "OFF", "x2", "x3" };
        return snprintf(out, out_len, "%s", ul[fx->unison]);
    }
    if (!strcmp(key, "harm_octaver"))     return snprintf(out, out_len, "%d", fx->octaver);
    if (!strcmp(key, "harm_interval1"))   return snprintf(out, out_len, "%d", fx->harmonize_1);
    if (!strcmp(key, "harm_interval2"))   return snprintf(out, out_len, "%d", fx->harmonize_2);

    if (!strcmp(key, "delay_time"))         return snprintf(out, out_len, "%d", fx->delay_time_idx);
    if (!strcmp(key, "delay_level"))        return snprintf(out, out_len, "%d", fx->delay_level);
    if (!strcmp(key, "delay_repeats"))      return snprintf(out, out_len, "%d", fx->repeat_times);
    if (!strcmp(key, "delay_vel_fb"))       return snprintf(out, out_len, "%d", fx->fb_velocity);
    if (!strcmp(key, "delay_pitch_fb"))     return snprintf(out, out_len, "%d", fx->fb_note);
    if (!strcmp(key, "delay_pitch_random")) return snprintf(out, out_len, "%s",
                                                fx->fb_note_random ? "on" : "off");
    if (!strcmp(key, "delay_gate_fb"))      return snprintf(out, out_len, "%d", fx->fb_gate_time);
    if (!strcmp(key, "delay_clock_fb"))     return snprintf(out, out_len, "%d", fx->fb_clock);

    return -1;
}

/* ------------------------------------------------------------------ */
/* get_param                                                            */
/* ------------------------------------------------------------------ */

static int get_param(void *instance, const char *key, char *out, int out_len) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!key || !out || out_len <= 0) return -1;

    if (!strcmp(key, "playing"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->playing : 0);
    if (!strcmp(key, "active_track"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->active_track : 0);
    if (!strcmp(key, "key"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_key : 9);
    if (!strcmp(key, "scale"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_scale : 0);
    if (!strcmp(key, "scale_aware"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->scale_aware : 0);
    if (!strcmp(key, "inp_quant"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->inp_quant : 0);
    if (!strcmp(key, "input_vel"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->input_vel : 0);
    if (!strcmp(key, "midi_in_channel"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->midi_in_channel : 0);
    if (!strcmp(key, "metro_on"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->metro_on : 1);
    if (!strcmp(key, "metro_vol"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->metro_vol : 80);
    if (!strcmp(key, "launch_quant"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->launch_quant : 0);
    if (!strcmp(key, "version"))
        return snprintf(out, out_len, "6");
    if (!strcmp(key, "instance_id"))
        return snprintf(out, out_len, "%u", inst ? inst->instance_nonce : 0);
    if (!strcmp(key, "state_uuid")) {
        /* Extract UUID from state_path: .../set_state/<UUID>/seq8-state.json */
        if (!inst) return snprintf(out, out_len, "");
        const char *p = strstr(inst->state_path, "/set_state/");
        if (p) {
            p += 11; /* strlen("/set_state/") */
            const char *end = strchr(p, '/');
            if (end && (end - p) > 0 && (end - p) < out_len) {
                int len = (int)(end - p);
                memcpy(out, p, (size_t)len);
                out[len] = '\0';
                return len;
            }
        }
        return snprintf(out, out_len, "");
    }
    if (!strcmp(key, "bpm")) {
        double b = (inst && inst->tracks[0].pfx.cached_bpm > 0)
                   ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT;
        return snprintf(out, out_len, "%.0f", b);
    }

    /* ext_queue: drain ROUTE_MOVE events buffered by DSP render path.
     * Returns "S D1 D2;S D1 D2;..." or "" if empty. Clears queue on read. */
    if (!strcmp(key, "ext_queue")) {
        if (!inst || inst->ext_head == inst->ext_tail)
            return snprintf(out, out_len, "");
        int pos = 0;
        while (inst->ext_tail != inst->ext_head) {
            ext_msg_t *m = &inst->ext_queue[inst->ext_tail];
            if (pos > 0) {
                if (pos < out_len - 1) out[pos++] = ';';
                else break;
            }
            int n = snprintf(out + pos, (size_t)(out_len - pos),
                             "%d %d %d", (int)m->s, (int)m->d1, (int)m->d2);
            if (n < 0 || pos + n >= out_len) break;
            pos += n;
            inst->ext_tail = (inst->ext_tail + 1) % EXT_QUEUE_SIZE;
        }
        return pos;
    }

    /* state_snapshot: single call returning all poll-loop values.
     * Format: "playing cs0..cs7 ac0..ac7 qc0..qc7 count_in cp0..cp7 wr0..wr7 ps0..ps7 flash_eighth flash_sixteenth metro_beat_count master_pos looper_state"
     * 55 values total. Replaces individual get_param calls in pollDSP(). */
    if (!strcmp(key, "state_snapshot")) {
        if (!inst) return snprintf(out, out_len,
            "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 -1 -1 -1 -1 -1 -1 -1 0"
            " 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0");
        int t;
        int pos = 0;
        pos += snprintf(out + pos, (size_t)(out_len - pos), "%d", (int)inst->playing);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].current_step);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].active_clip);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].queued_clip);
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d",
                        (int)(inst->count_in_ticks > 0 ? 1 : 0));
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].clip_playing);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].will_relaunch);
        for (t = 0; t < NUM_TRACKS; t++)
            pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->tracks[t].pending_page_stop);
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)((inst->global_tick / 2) % 2));
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)(inst->global_tick % 2));
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->metro_beat_count);
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %u", (unsigned)inst->arp_master_tick);
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->looper_state);
        return pos;
    }

    if (!inst) return -1;

    /* Track-prefixed params: tN_<subkey> */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        if (!strcmp(sub, "current_step"))
            return snprintf(out, out_len, "%d", (int)tr->current_step);
        if (!strcmp(sub, "active_clip"))
            return snprintf(out, out_len, "%d", (int)tr->active_clip);
        if (!strcmp(sub, "queued_clip"))
            return snprintf(out, out_len, "%d", (int)tr->queued_clip);
        if (!strcmp(sub, "pad_octave"))
            return snprintf(out, out_len, "%d", (int)tr->pad_octave);
        if (!strcmp(sub, "pad_mode"))
            return snprintf(out, out_len, "%d", (int)tr->pad_mode);
        if (!strcmp(sub, "drum_active_lanes")) {
            /* Bitmask of lanes whose current step has an active hit (bit l = lane l). */
            uint32_t mask = 0;
            int l;
            for (l = 0; l < DRUM_LANES; l++) {
                clip_t *dlc = &tr->drum_clips[tr->active_clip].lanes[l].clip;
                uint16_t cs = tr->drum_current_step[l];
                if (dlc->note_count > 0 && cs < SEQ_STEPS && dlc->steps[cs])
                    mask |= (1u << l);
            }
            return snprintf(out, out_len, "%u", mask);
        }
        if (!strcmp(sub, "drum_lane_mute"))
            return snprintf(out, out_len, "%u", tr->drum_lane_mute);
        if (!strcmp(sub, "drum_lane_solo"))
            return snprintf(out, out_len, "%u", tr->drum_lane_solo);
        /* tN_lL_* — drum lane getters (lane_note, note_count, steps, step_S_*) */
        if (sub[0] == 'l' && sub[1] >= '0' && sub[1] <= '9') {
            int lidx = 0;
            const char *p2 = sub + 1;
            while (*p2 >= '0' && *p2 <= '9') { lidx = lidx * 10 + (*p2 - '0'); p2++; }
            if (lidx < 0 || lidx >= DRUM_LANES) return -1;
            drum_lane_t *dlane = &tr->drum_clips[tr->active_clip].lanes[lidx];
            clip_t      *dlc   = &dlane->clip;
            if (!strcmp(p2, "_lane_note"))
                return snprintf(out, out_len, "%d", (int)dlane->midi_note);
            if (!strcmp(p2, "_note_count"))
                return snprintf(out, out_len, "%d", (int)dlc->note_count);
            if (!strcmp(p2, "_length"))
                return snprintf(out, out_len, "%d", (int)dlc->length);
            if (!strcmp(p2, "_current_step"))
                return snprintf(out, out_len, "%d", (int)tr->drum_current_step[lidx]);
            if (!strcmp(p2, "_tps"))
                return snprintf(out, out_len, "%d", (int)dlc->ticks_per_step);
            if (!strcmp(p2, "_steps")) {
                if (out_len < SEQ_STEPS + 1) return -1;
                int s;
                for (s = 0; s < SEQ_STEPS; s++) {
                    if (dlc->step_note_count[s] == 0)
                        out[s] = '0';
                    else if (dlc->steps[s])
                        out[s] = '1';
                    else
                        out[s] = '2';
                }
                out[SEQ_STEPS] = '\0';
                return SEQ_STEPS;
            }
            if (!strncmp(p2, "_step_", 6)) {
                const char *q = p2 + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return -1;
                if (*q == '\0')
                    return snprintf(out, out_len, "%d", (int)dlc->steps[sidx]);
                if (!strcmp(q, "_notes")) {
                    int cnt = (int)dlc->step_note_count[sidx];
                    if (cnt == 0) { out[0] = '\0'; return 0; }
                    int pos = 0, n;
                    for (n = 0; n < cnt; n++) {
                        if (n > 0 && pos < out_len - 1) out[pos++] = ' ';
                        pos += snprintf(out + pos, (size_t)(out_len - pos),
                                        "%d", (int)dlc->step_notes[sidx][n]);
                    }
                    return pos;
                }
                if (!strcmp(q, "_vel"))
                    return snprintf(out, out_len, "%d", (int)dlc->step_vel[sidx]);
                if (!strcmp(q, "_gate"))
                    return snprintf(out, out_len, "%d", (int)dlc->step_gate[sidx]);
                if (!strcmp(q, "_nudge"))
                    return snprintf(out, out_len, "%d",
                        dlc->step_note_count[sidx] > 0 ? (int)dlc->note_tick_offset[sidx][0] : 0);
                return -1;
            }
            if (!strcmp(p2, "_pfx_snapshot")) {
                clip_pfx_params_t *cp = &dlane->clip.pfx_params;
                return snprintf(out, out_len,
                    "%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d "
                    "%d %d %d %d %d %d %d %d",
                    cp->octave_shift, cp->note_offset, cp->gate_time,
                    cp->velocity_offset, cp->quantize,
                    cp->unison, cp->octaver, cp->harmonize_1, cp->harmonize_2,
                    cp->delay_time_idx, cp->delay_level, cp->repeat_times,
                    cp->fb_velocity, cp->fb_note, cp->fb_gate_time,
                    cp->fb_clock, cp->fb_note_random,
                    cp->seq_arp_style, cp->seq_arp_rate,
                    cp->seq_arp_octaves, cp->seq_arp_gate,
                    cp->seq_arp_steps_mode, cp->seq_arp_retrigger,
                    (int)cp->seq_arp_step_vel[0], (int)cp->seq_arp_step_vel[1],
                    (int)cp->seq_arp_step_vel[2], (int)cp->seq_arp_step_vel[3],
                    (int)cp->seq_arp_step_vel[4], (int)cp->seq_arp_step_vel[5],
                    (int)cp->seq_arp_step_vel[6], (int)cp->seq_arp_step_vel[7]);
            }
            return -1;
        }
        if (!strcmp(sub, "clock_shift_pos"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].clock_shift_pos);
        if (!strcmp(sub, "nudge_pos"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].nudge_pos);
        if (!strcmp(sub, "beat_stretch_factor")) {
            int exp = (int)tr->clips[tr->active_clip].stretch_exp;
            if (exp == 0) return snprintf(out, out_len, "1x");
            if (exp > 0)  return snprintf(out, out_len, "x%d", 1 << exp);
            return snprintf(out, out_len, "/%d", 1 << (-exp));
        }
        if (!strcmp(sub, "beat_stretch_blocked"))
            return snprintf(out, out_len, "%d", (int)tr->stretch_blocked);
        if (!strcmp(sub, "recording"))
            return snprintf(out, out_len, "%d", (int)tr->recording);
        if (!strcmp(sub, "clip_length"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].length);
        if (!strcmp(sub, "note_count"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].note_count);
        if (!strcmp(sub, "current_clip_tick"))
            return snprintf(out, out_len, "%u", (unsigned)tr->current_clip_tick);

        /* tN_cM_step_S / tN_cM_length / tN_cM_active */
        if (sub[0] == 'c' && sub[1] >= '0' && sub[1] <= '9') {
            int cidx = 0;
            const char *p = sub + 1;
            while (*p >= '0' && *p <= '9') { cidx = cidx * 10 + (*p - '0'); p++; }
            if (cidx >= NUM_CLIPS) return -1;
            clip_t *cl = &tr->clips[cidx];

            if (!strncmp(p, "_step_", 6)) {
                const char *q = p + 6;
                int sidx = 0;
                while (*q >= '0' && *q <= '9') { sidx = sidx * 10 + (*q++ - '0'); }
                if (sidx < 0 || sidx >= SEQ_STEPS) return -1;

                if (*q == '\0')
                    return snprintf(out, out_len, "%d", (int)cl->steps[sidx]);

                if (!strcmp(q, "_notes")) {
                    /* tN_cC_step_S_notes — space-separated MIDI note numbers */
                    int cnt = (int)cl->step_note_count[sidx];
                    if (cnt == 0) { out[0] = '\0'; return 0; }
                    int pos = 0, n;
                    for (n = 0; n < cnt; n++) {
                        if (n > 0 && pos < out_len - 1) out[pos++] = ' ';
                        pos += snprintf(out + pos, (size_t)(out_len - pos),
                                        "%d", (int)cl->step_notes[sidx][n]);
                    }
                    return pos;
                }
                if (!strcmp(q, "_vel"))
                    return snprintf(out, out_len, "%d", (int)cl->step_vel[sidx]);
                if (!strcmp(q, "_gate"))
                    return snprintf(out, out_len, "%d", (int)cl->step_gate[sidx]);
                if (!strcmp(q, "_nudge"))
                    return snprintf(out, out_len, "%d",
                        cl->step_note_count[sidx] > 0 ? (int)cl->note_tick_offset[sidx][0] : 0);
                return -1;
            }
            if (!strncmp(p, "_steps", 6) && p[6] == '\0') {
                if (out_len < SEQ_STEPS + 1) return -1;
                int s;
                for (s = 0; s < SEQ_STEPS; s++) out[s] = '0';
                uint16_t ni3;
                for (ni3 = 0; ni3 < cl->note_count; ni3++) {
                    note_t *n = &cl->notes[ni3];
                    if (!n->active) continue;
                    uint16_t sn = note_step(n->tick, cl->length, cl->ticks_per_step);
                    if (sn >= SEQ_STEPS) continue;
                    if (!n->step_muted)
                        out[sn] = '1';
                    else if (out[sn] == '0')
                        out[sn] = '2';
                }
                out[SEQ_STEPS] = '\0';
                return SEQ_STEPS;
            }
            if (!strncmp(p, "_length", 7))
                return snprintf(out, out_len, "%d", (int)cl->length);
            if (!strncmp(p, "_active", 7))
                return snprintf(out, out_len, "%d", (int)cl->active);
            if (!strncmp(p, "_drum_has_content", 17)) {
                int dl, any = 0;
                for (dl = 0; dl < DRUM_LANES && !any; dl++)
                    if (tr->drum_clips[cidx].lanes[dl].clip.note_count > 0) any = 1;
                return snprintf(out, out_len, "%d", any);
            }
            if (!strncmp(p, "_tps", 4))
                return snprintf(out, out_len, "%d", (int)cl->ticks_per_step);
            if (!strncmp(p, "_pfx_snapshot", 13)) {
                clip_pfx_params_t *cp = &cl->pfx_params;
                return snprintf(out, out_len,
                    "%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d "
                    "%d %d %d %d %d %d %d %d",
                    cp->octave_shift, cp->note_offset, cp->gate_time,
                    cp->velocity_offset, cp->quantize,
                    cp->unison, cp->octaver, cp->harmonize_1, cp->harmonize_2,
                    cp->delay_time_idx, cp->delay_level, cp->repeat_times,
                    cp->fb_velocity, cp->fb_note, cp->fb_gate_time,
                    cp->fb_clock, cp->fb_note_random,
                    cp->seq_arp_style, cp->seq_arp_rate,
                    cp->seq_arp_octaves, cp->seq_arp_gate,
                    cp->seq_arp_steps_mode, cp->seq_arp_retrigger,
                    (int)cp->seq_arp_step_vel[0], (int)cp->seq_arp_step_vel[1],
                    (int)cp->seq_arp_step_vel[2], (int)cp->seq_arp_step_vel[3],
                    (int)cp->seq_arp_step_vel[4], (int)cp->seq_arp_step_vel[5],
                    (int)cp->seq_arp_step_vel[6], (int)cp->seq_arp_step_vel[7]);
            }
            return -1;
        }

        return pfx_get(tr, sub, out, out_len);
    }

    /* mute_state / solo_state: 8-char binary strings */
    if (!strcmp(key, "mute_state")) {
        int t;
        for (t = 0; t < NUM_TRACKS && t < out_len - 1; t++)
            out[t] = inst->mute[t] ? '1' : '0';
        out[NUM_TRACKS] = '\0';
        return NUM_TRACKS;
    }
    if (!strcmp(key, "solo_state")) {
        int t;
        for (t = 0; t < NUM_TRACKS && t < out_len - 1; t++)
            out[t] = inst->solo[t] ? '1' : '0';
        out[NUM_TRACKS] = '\0';
        return NUM_TRACKS;
    }
    /* snap_N: "m0..m7 s0..s7" (17 chars) if valid, else "" */
    if (!strncmp(key, "snap_", 5)) {
        int n = my_atoi(key + 5), t, pos = 0;
        if (n >= 0 && n < 16) {
            if (!inst->snap_valid[n]) { out[0] = '\0'; return 0; }
            for (t = 0; t < NUM_TRACKS && pos < out_len - 1; t++)
                out[pos++] = inst->snap_mute[n][t] ? '1' : '0';
            if (pos < out_len - 1) out[pos++] = ' ';
            for (t = 0; t < NUM_TRACKS && pos < out_len - 1; t++)
                out[pos++] = inst->snap_solo[n][t] ? '1' : '0';
            out[pos] = '\0';
            return pos;
        }
    }

    return -1;
}

/* ------------------------------------------------------------------ */
/* get_error                                                            */
/* ------------------------------------------------------------------ */

static int get_error(void *instance, char *out, int out_len) {
    (void)instance; (void)out; (void)out_len;
    return 0;
}

/* ------------------------------------------------------------------ */
/* render_block helpers                                                 */
/* ------------------------------------------------------------------ */

/* Apply per-track quantize to a per-note raw tick_offset.
 * quantize=100 → always 0 (fully snapped); quantize=0 → raw offset unchanged. */
static int effective_note_offset(clip_t *cl, seq8_track_t *tr, uint16_t s, int ni) {
    int raw = (int)cl->note_tick_offset[s][ni];
    if (raw == 0 || tr->pfx.quantize >= 100) return 0;
    if (tr->pfx.quantize <= 0) return raw;
    return raw * (100 - tr->pfx.quantize) / 100;
}

/* Compute effective fire tick for a note_t in the note-centric model.
 * Quantize pulls tick toward step grid: q=100 → step grid, q=0 → raw tick. */
static uint32_t effective_note_tick(const note_t *n, const clip_t *cl, int quantize) {
    uint16_t sn = note_step(n->tick, cl->length, cl->ticks_per_step);
    int32_t step_grid = (int32_t)sn * cl->ticks_per_step;
    int32_t delta = (int32_t)n->tick - step_grid;
    int32_t eff_delta = (quantize >= 100) ? 0 : delta * (100 - quantize) / 100;
    int32_t eff_tick = step_grid + eff_delta;
    int32_t clip_ticks = (int32_t)cl->length * cl->ticks_per_step;
    if (eff_tick < 0) eff_tick += clip_ticks;
    if (eff_tick >= clip_ticks) eff_tick -= clip_ticks;
    return (uint32_t)eff_tick;
}

/* Cut off all sounding notes and reset note state (legacy step-based path). */
static void silence_track_notes(seq8_instance_t *inst, seq8_track_t *tr) {
    if (tr->note_active) {
        int n;
        for (n = 0; n < (int)tr->pending_note_count; n++)
            pfx_note_off(inst, tr, tr->pending_notes[n]);
        tr->note_active        = 0;
        tr->pending_note_count = 0;
    }
}

/* Cut off all sounding notes via note-centric play_pending. */
static void silence_track_notes_v2(seq8_instance_t *inst, seq8_track_t *tr) {
    int pp;
    for (pp = 0; pp < (int)tr->play_pending_count; pp++)
        pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
    tr->play_pending_count = 0;
    tr->note_active = 0;
    tr->pending_note_count = 0;
    /* SEQ ARP: drop held buffer + silence any sounding emitted note. */
    arp_silence(inst, tr);
}

/* Start gate for step s and fire a single note ni immediately.
 * Assumes previous notes already silenced if needed.
 * Gate starts from when the FIRST note of the step fires (early-fired notes
 * carry their gate forward; later notes in the same step share the running gate).
 * This means early-fired notes sound from their fire tick through the full gate
 * duration, while positive-offset notes are slightly shorter. */
static void begin_step_note(seq8_instance_t *inst, seq8_track_t *tr,
                            clip_t *cl, uint16_t s, int ni) {
    if (!tr->note_active) {
        int eff = (int)cl->step_gate[s] * tr->pfx.gate_time / 100;
        if (eff < 1) eff = 1;
        tr->pending_gate         = (uint16_t)eff;
        tr->gate_ticks_remaining = tr->pending_gate;
        tr->note_active          = 1;
    }
    if (tr->pending_note_count < 8) {
        int pi = (int)tr->pending_note_count;
        tr->pending_notes[pi] = cl->step_notes[s][ni];
        tr->pending_note_count++;
        pfx_note_on(inst, tr, tr->pending_notes[pi], cl->step_vel[s]);
    }
}

/* ------------------------------------------------------------------ */
/* render_block                                                         */
/* ------------------------------------------------------------------ */

static void render_block(void *instance, int16_t *out_lr, int frames) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst) return;

    if (out_lr && frames > 0)
        memset(out_lr, 0, (size_t)frames * 2 * sizeof(int16_t));

    inst->block_count++;

    /* Advance sample counters and fire queued events for all tracks. */
    int t;
    for (t = 0; t < NUM_TRACKS; t++)
        inst->tracks[t].pfx.sample_counter += (uint64_t)frames;


    for (t = 0; t < NUM_TRACKS; t++)
        pfx_q_fire(&inst->tracks[t].pfx, inst->tracks[t].pfx.sample_counter);

    /* DSP-side count-in: tick down using same accumulator; fire transport+rec when done */
    if (inst->count_in_ticks > 0) {
        if (inst->tick_threshold > 0) {
            inst->tick_accum += inst->tick_delta;
            while (inst->tick_accum >= inst->tick_threshold && inst->count_in_ticks > 0) {
                inst->tick_accum -= inst->tick_threshold;
                if (inst->metro_on >= 1) {
                    int old_q = (int)((inst->count_in_ticks - 1) / PPQN);
                    inst->count_in_ticks--;
                    if (inst->count_in_ticks > 0) {
                        int new_q = (int)((inst->count_in_ticks - 1) / PPQN);
                        if (new_q != old_q) inst->metro_beat_count++;
                    }
                } else {
                    inst->count_in_ticks--;
                }
            }
            if (inst->count_in_ticks == 0) {
                inst->tick_accum          = 0;
                inst->master_tick_in_step = 0;
                inst->global_tick         = 0;
                inst->arp_master_tick     = 0;
                for (t = 0; t < NUM_TRACKS; t++) {
                    inst->tracks[t].current_step      = 0;
                    inst->tracks[t].tick_in_step      = 0;
                    inst->tracks[t].note_active        = 0;
                    inst->tracks[t].pfx.sample_counter = 0;
                    memset(inst->tracks[t].drum_current_step, 0, sizeof(inst->tracks[t].drum_current_step));
                    memset(inst->tracks[t].drum_tick_in_step,  0, sizeof(inst->tracks[t].drum_tick_in_step));
                    if (inst->tracks[t].will_relaunch) {
                        inst->tracks[t].clip_playing      = 1;
                        inst->tracks[t].will_relaunch     = 0;
                        inst->tracks[t].pending_page_stop = 0;
                    }
                }
                inst->playing = 1;
                inst->tracks[inst->count_in_track].recording   = 1;
                inst->tracks[inst->count_in_track].clip_playing = 1;
            }
        }
        return; /* skip main sequencer while counting in (or this block after fire) */
    }

    if (inst->tick_threshold == 0) return;

    /* When stopped: free-running clock for SEQ ARP only, so live input
     * arpeggiates even with transport off. arp_master_tick advances; no
     * sequencer work runs. */
    if (!inst->playing) {
        inst->tick_accum += inst->tick_delta;
        while (inst->tick_accum >= inst->tick_threshold) {
            inst->tick_accum -= inst->tick_threshold;
            looper_tick(inst);
            for (t = 0; t < NUM_TRACKS; t++) arp_tick(inst, &inst->tracks[t]);
            inst->arp_master_tick++;
        }
        return;
    }

    inst->tick_accum += inst->tick_delta;
    while (inst->tick_accum >= inst->tick_threshold) {
        inst->tick_accum -= inst->tick_threshold;

        /* Looper: tick state machine + emit captured events for current pos.
         * Runs before track logic so arp_emit captures land at the same
         * pos that looper_tick just established. */
        looper_tick(inst);

        /* Metro beat: mode 2 (On) = while recording; mode 3 (Rec+Ply) = always */
        if (inst->metro_on >= 2 && inst->master_tick_in_step == 0 && inst->global_tick % 4 == 0) {
            if (inst->metro_on == 3) {
                inst->metro_beat_count++;
            } else {
                int _tt;
                for (_tt = 0; _tt < NUM_TRACKS; _tt++)
                    if (inst->tracks[_tt].recording) { inst->metro_beat_count++; break; }
            }
        }

        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            clip_t *cl = &tr->clips[tr->active_clip];

            /* Gate countdown: decrement each play_pending slot; fire note-off at 0.
             * Runs before note-on so a gate expiring at step boundary doesn't double-fire. */
            {
                int pp;
                for (pp = 0; pp < (int)tr->play_pending_count; ) {
                    if (tr->play_pending[pp].ticks_remaining > 0)
                        tr->play_pending[pp].ticks_remaining--;
                    if (tr->play_pending[pp].ticks_remaining == 0) {
                        pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
                        tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                        tr->play_pending_count--;
                    } else {
                        pp++;
                    }
                }
                tr->note_active = (tr->play_pending_count > 0) ? 1 : 0;
            }

            if (inst->master_tick_in_step == 0) {
                /* Quantized boundary: launch queued clip (only if not waiting for page stop) */
                if (tr->queued_clip >= 0 && !tr->pending_page_stop &&
                    inst->global_tick % QUANT_STEPS[inst->launch_quant] == 0) {
                    silence_track_notes_v2(inst, tr);
                    tr->active_clip  = (uint8_t)tr->queued_clip;
                    tr->queued_clip  = -1;
                    tr->clip_playing = 1;
                    if (tr->pad_mode == PAD_MODE_DRUM) {
                        memset(tr->drum_current_step, 0, sizeof(tr->drum_current_step));
                        memset(tr->drum_tick_in_step,  0, sizeof(tr->drum_tick_in_step));
                    } else {
                        pfx_sync_from_clip(tr);
                        tr->current_step = 0;
                        tr->tick_in_step = 0;
                        cl = &tr->clips[tr->active_clip];
                    }
                    if (tr->record_armed) {
                        tr->recording    = 1;
                        tr->record_armed = 0;
                    }
                }

                /* Page stop: silence at next main clock bar boundary (global_tick % 16). */
                if (tr->pending_page_stop && inst->global_tick % 16 == 0) {
                    tr->pending_page_stop = 0;
                    tr->clip_playing      = 0;
                    silence_track_notes_v2(inst, tr);
                    if (tr->queued_clip >= 0) {
                        tr->active_clip  = (uint8_t)tr->queued_clip;
                        tr->queued_clip  = -1;
                        tr->clip_playing = 1;
                        if (tr->pad_mode == PAD_MODE_DRUM) {
                            memset(tr->drum_current_step, 0, sizeof(tr->drum_current_step));
                            memset(tr->drum_tick_in_step,  0, sizeof(tr->drum_tick_in_step));
                        } else {
                            pfx_sync_from_clip(tr);
                            tr->current_step = 0;
                            tr->tick_in_step = 0;
                            cl = &tr->clips[tr->active_clip];
                        }
                        if (tr->record_armed) {
                            tr->recording    = 1;
                            tr->record_armed = 0;
                        }
                    }
                }
            }

            /* Note-on: drum and melodic paths share the same note-firing logic but
             * drum iterates all 32 lanes, applying each lane's pfx params before scanning. */
            if (tr->pad_mode == PAD_MODE_DRUM) {
                if (tr->clip_playing && !effective_mute(inst, t)) {
                    int l;
                    for (l = 0; l < DRUM_LANES; l++) {
                        drum_lane_t *lane = &tr->drum_clips[tr->active_clip].lanes[l];
                        clip_t      *dlc  = &lane->clip;
                        if (dlc->note_count == 0) continue;
                        if (effective_drum_mute(tr, l)) continue;
                        pfx_apply_params(&tr->pfx, &dlc->pfx_params);
                        uint32_t cct = (uint32_t)tr->drum_current_step[l] * dlc->ticks_per_step
                                       + tr->drum_tick_in_step[l];
                        uint8_t  lane_note = lane->midi_note;
                        uint16_t ni2;
                        for (ni2 = 0; ni2 < dlc->note_count; ni2++) {
                            note_t *n = &dlc->notes[ni2];
                            if (!n->active || n->suppress_until_wrap || n->step_muted) continue;
                            if (effective_note_tick(n, dlc, tr->pfx.quantize) != cct) continue;
                            { int pp; for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                                if (tr->play_pending[pp].pitch == lane_note) {
                                    pfx_note_off(inst, tr, lane_note);
                                    tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                                    tr->play_pending_count--;
                                    break;
                                }
                            }}
                            int eff_gate = (int)n->gate * tr->pfx.gate_time / 100;
                            if (eff_gate < 1) eff_gate = 1;
                            if (tr->play_pending_count < 32) {
                                tr->play_pending[tr->play_pending_count].pitch           = lane_note;
                                tr->play_pending[tr->play_pending_count].ticks_remaining = (uint16_t)eff_gate;
                                tr->play_pending_count++;
                                tr->note_active = 1;
                            }
                            pfx_note_on(inst, tr, lane_note, n->vel);
                        }
                    }
                }
            } else {
                /* Melodic note-centric note-on: scan active clip's notes[]. */
                if (tr->clip_playing && !effective_mute(inst, t)) {
                    uint32_t cct = (uint32_t)tr->current_step * cl->ticks_per_step + tr->tick_in_step;
                    uint16_t ni2;
                    for (ni2 = 0; ni2 < cl->note_count; ni2++) {
                        note_t *n = &cl->notes[ni2];
                        if (!n->active || n->suppress_until_wrap || n->step_muted) continue;
                        if (effective_note_tick(n, cl, tr->pfx.quantize) != cct) continue;
                        { int pp; for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                            if (tr->play_pending[pp].pitch == n->pitch) {
                                pfx_note_off(inst, tr, n->pitch);
                                tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                                tr->play_pending_count--;
                                break;
                            }
                        }}
                        int eff_gate = (int)n->gate * tr->pfx.gate_time / 100;
                        if (eff_gate < 1) eff_gate = 1;
                        if (tr->play_pending_count < 32) {
                            int pp_idx = (int)tr->play_pending_count;
                            tr->play_pending[pp_idx].pitch          = n->pitch;
                            tr->play_pending[pp_idx].ticks_remaining = (uint16_t)eff_gate;
                            tr->play_pending_count++;
                            tr->note_active = 1;
                        }
                        pfx_note_on(inst, tr, n->pitch, n->vel);
                    }
                }
            }

            /* SEQ ARP: tick AFTER note-on scan so this tick's chord (just
             * added to the held buffer) can fire immediately when
             * pending_first_note=1 lands on a rate boundary. */
            arp_tick(inst, tr);
        }

        /* Per-track tick advance and step advance */
        for (t = 0; t < NUM_TRACKS; t++) {
            seq8_track_t *tr = &inst->tracks[t];
            if (tr->pad_mode == PAD_MODE_DRUM) {
                /* Drum: advance per-lane tick counters independently. */
                int l;
                for (l = 0; l < DRUM_LANES; l++) {
                    clip_t *dlc = &tr->drum_clips[tr->active_clip].lanes[l].clip;
                    tr->drum_tick_in_step[l]++;
                    if (tr->drum_tick_in_step[l] >= dlc->ticks_per_step) {
                        tr->drum_tick_in_step[l] = 0;
                        if (tr->clip_playing) {
                            uint16_t ns2 = (uint16_t)((tr->drum_current_step[l] + 1) % dlc->length);
                            if (ns2 == 0) {
                                uint16_t ni2;
                                for (ni2 = 0; ni2 < dlc->note_count; ni2++)
                                    dlc->notes[ni2].suppress_until_wrap = 0;
                            }
                            tr->drum_current_step[l] = ns2;
                        }
                    }
                }
            } else {
                clip_t *cl = &tr->clips[tr->active_clip];
                tr->tick_in_step++;
                if (tr->tick_in_step >= cl->ticks_per_step) {
                    tr->tick_in_step = 0;
                    if (tr->clip_playing) {
                        uint16_t ns2 = (uint16_t)((tr->current_step + 1) % cl->length);
                        if (ns2 == 0) {
                            uint16_t ni2;
                            for (ni2 = 0; ni2 < cl->note_count; ni2++)
                                cl->notes[ni2].suppress_until_wrap = 0;
                            memset(tr->live_recorded_steps, 0, 32);
                            /* SEQ ARP retrigger=1: restart pattern on clip loop start. */
                            if (tr->pfx.arp.style != 0 && tr->pfx.arp.retrigger)
                                tr->pfx.arp.pending_retrigger = 1;
                        }
                        tr->current_step = ns2;
                    }
                }
                tr->current_clip_tick = (uint32_t)tr->current_step * cl->ticks_per_step
                                        + tr->tick_in_step;
            }
        }
        /* Master tick advance: drives global_tick and launch-quant boundary */
        inst->master_tick_in_step++;
        if (inst->master_tick_in_step >= TICKS_PER_STEP) {
            inst->master_tick_in_step = 0;
            inst->global_tick++;
        }
        inst->arp_master_tick++;
    }
}

/* ------------------------------------------------------------------ */
/* API table                                                            */
/* ------------------------------------------------------------------ */

static plugin_api_v2_t g_api = {
    .api_version      = MOVE_PLUGIN_API_VERSION_2,
    .create_instance  = create_instance,
    .destroy_instance = destroy_instance,
    .on_midi          = on_midi,
    .set_param        = set_param,
    .get_param        = get_param,
    .get_error        = get_error,
    .render_block     = render_block,
};

plugin_api_v2_t *move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    return &g_api;
}
