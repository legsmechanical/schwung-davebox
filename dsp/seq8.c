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
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/mman.h>
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
#define ROUTE_EXTERNAL 2   /* USB-A out: host->midi_send_external → shim audio-thread SPSC ring */

/* Pad input modes */
#define PAD_MODE_MELODIC_SCALE  0   /* isomorphic 4ths diatonic layout */
#define PAD_MODE_DRUM           1   /* 32-lane drum sequencer */
#define PAD_MODE_CONDUCT        2   /* Conductor: drives transposition, emits no MIDI */

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

/* ---- Clock-follow sync (Tier-1) constants ----------------------------------
 * Sample-domain thresholds assume Move's 44100 Hz / 128-frame blocks. */
#define MOVE_PLAY_CC              85      /* Move's Play button (CC), toggles transport */
#define CLKFOLLOW_STALE_SAMPLES   33075   /* 750 ms — mirrors host CLOCK_TICK_STALE_MS */
#define MOVE_PLAY_RELEASE_SAMPLES 2205   /* ~50 ms press→release gap (matches song-mode inject) */
#define FOLLOW_START_TIMEOUT_SAMPLES 66150 /* 1.5 s wait for Move's clock after a start inject */
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
#define NUM_CLOCK_VALUES       17
#define DEFAULT_DELAY_TIME_IDX      10   /* 1/8D = 360 clocks at 480 PPQN */
#define DEFAULT_DRUM_DELAY_TIME_IDX  5   /* 1/16 */
#define MAX_DELAY_SAMPLES   (30ULL * 44100)

/* 1 SEQ8 tick = 480/96 = 5 clocks at 480 PPQN (NoteTwist's resolution) */
#define TICKS_TO_480PPQN    5

/* CLOCK_VALUES: delay intervals in 480 PPQN clocks.
 * Indices: 0=1/64 1=1/64D 2=1/32 3=1/16T 4=1/32D 5=1/16 6=1/8T 7=1/16D
 *          8=1/8  9=1/4T 10=1/8D 11=1/4 12=1/4D 13=1/2 14=1/2D 15=1/1 16=1/1D */
static const int CLOCK_VALUES[NUM_CLOCK_VALUES] = {
    30, 45, 60, 80, 90, 120, 160, 180, 240, 320, 360, 480, 720, 960, 1440, 1920, 2880
};

/* GATE_FIXED_TICKS: fixed gate durations in 96 PPQN ticks.
 * Index = fb_gate_time - 1 (value 1..10): 0=1/64 1=1/32 2=1/16T 3=1/16 4=1/8T
 *         5=1/8 6=1/4T 7=1/4 8=1/2 9=1bar */
#define NUM_GATE_FIXED 10
static const int GATE_FIXED_TICKS[NUM_GATE_FIXED] = {
    6, 12, 16, 24, 32, 48, 64, 96, 192, 384
};

/* QUANT_STEPS: launch quantization in steps. 0=Now(1), 1=1/16(1), 2=1/8(2), 3=1/4(4), 4=1/2(8), 5=1-bar(16) */
static const uint32_t QUANT_STEPS[6] = {1, 1, 2, 4, 8, 16};


/* ------------------------------------------------------------------ */
/* Play effects structs (direct port from NoteTwist)                   */
/* ------------------------------------------------------------------ */

#define PFX_EV_BYPASS_SWING 0x01  /* event already swing-deferred; route directly, skip pfx_send */

typedef struct {
    uint64_t fire_at;
    uint8_t  msg[3];
    uint8_t  flags;
} pfx_event_t;

typedef struct {
    uint8_t  active;
    uint8_t  channel;
    uint64_t on_time;
    uint64_t gate_override_smp; /* sequenced note: Len-aware gate in samples; 0 = use pfx_gate_smp() */
    uint8_t  orig_velocity;
    uint8_t  gen_notes[MAX_GEN_NOTES];
    int      gen_count;
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

/* Drum Repeat rate pad index → ticks per repeat step (96 PPQN).
 * Pad 0-3 (bottom row): 1/32 1/16 1/8 1/4
 * Pad 4-7 (row 2):      1/32T 1/16T 1/8T 1/4T */
static const uint16_t DRUM_REPEAT_RATE_TICKS[8] = { 12, 24, 48, 96, 8, 16, 32, 64 };

/* Per-track drum input quantize snap intervals (96 PPQN).
 * Index 0=Off, 1=1/64, 2=1/32, 3=1/16, 4=1/16T, 5=1/8, 6=1/8T, 7=1/4, 8=1/4T */
static const uint8_t DRUM_INQ_TICKS[9] = { 0, 6, 12, 24, 16, 48, 32, 96, 64 };

/* Default CC assignments for CC PARAM bank knobs K1-K8 */
static const uint8_t CC_ASSIGN_DEFAULT[8] = { 7, 74, 71, 73, 72, 91, 93, 10 };

#define CC_AUTO_MAX_POINTS 1024
#define CC_TOUCH_GRACE_BLOCKS 8  /* blocks (~46ms) to suppress automation after a live knob turn */

/* Per-clip CC automation: up to CC_AUTO_MAX_POINTS sorted {tick, val} points per knob.
 * Playback interpolates linearly between adjacent points (see cc_auto_eval).
 * rest_val[k] = per-clip resting value (0..127), or 0xFF = unset ("—", send nothing). */
typedef struct {
    uint16_t count[8];   /* points per knob; uint16 so the 1024 cap fits (was uint8 → silent overflow) */
    uint16_t ticks[8][CC_AUTO_MAX_POINTS];
    uint8_t  vals[8][CC_AUTO_MAX_POINTS];
    uint8_t  rest_val[8];
    uint16_t lane_loop_start[8]; /* per-lane loop start in steps; 0 = default */
    uint16_t lane_length[8];     /* per-lane loop length in steps; 0 = inherit clip */
    uint16_t lane_tps[8];        /* per-lane zoom ticks_per_step (display grid); 0 = inherit clip tps */
    uint16_t lane_res_tps[8];    /* per-lane playback speed tps; 0 = inherit lane_tps/clip tps */
} cc_auto_t;

/* Per-clip pad-pressure (aftertouch) automation. Interpolated breakpoints like
 * cc_auto, but lanes are keyed by pitch (poly) rather than fixed knobs:
 * pitch[lane] = 0..127 poly note, 255 = channel-wide, 254 = free slot.
 * 1/32-snapped on record, linear-interpolated + hold on playback. */
#define AT_MAX_LANES   12     /* max distinct AT pitches per clip (poly) */
#define AT_MAX_POINTS  512    /* breakpoints per lane (1/32-snapped → 16 bars) */
#define AT_LANE_FREE   254
#define AT_LANE_CHAN   255
typedef struct {
    uint8_t  pitch[AT_MAX_LANES];
    uint16_t count[AT_MAX_LANES];
    uint16_t ticks[AT_MAX_LANES][AT_MAX_POINTS];
    uint8_t  vals [AT_MAX_LANES][AT_MAX_POINTS];
} at_auto_t;
/* Forward decl: at_auto_reset is used in create_instance + seq8_load_state, both
 * defined above the helper bodies. */
static void at_auto_reset(at_auto_t *a);

typedef struct {
    /* Live params mirrored from clip_pfx_params_t via pfx_apply_params */
    uint8_t  style;        /* 0=Off (bypass), 1..9=Up/Dn/U-D/D-U/Cnv/Div/Ord/Rnd/RnO */
    uint8_t  rate_idx;     /* 0..9 (index into ARP_RATE_TICKS) */
    int8_t   octaves;      /* -4..-1 or +1..+4 (signed; 0 skipped). Negative = descend by 12 per oct. */
    uint16_t gate_pct;     /* 1..200 percent of rate */
    uint8_t  steps_mode;   /* 0=Off, 1=Mute, 2=Skip */
    uint8_t  retrigger;    /* 0/1 — reset cycle/step on new note + clip wrap */
    uint8_t  step_vel[8];  /* level 0..4 (0=off, 1..4=row 0..3) */
    int8_t   step_int[8];  /* per-step scale-degree offset -24..+24; default 0 */
    uint8_t  step_loop_len; /* 1..8, default 8 — step pattern loop length */
    uint32_t master_anchor; /* arp_master_tick at last retrigger; step_pos = ((master-anchor)/rate) % step_loop_len */

    /* Held input notes (insertion-ordered; index 0..held_count-1 valid) */
    uint8_t  held_pitch[ARP_MAX_HELD];
    uint8_t  held_vel[ARP_MAX_HELD];
    uint8_t  held_order[ARP_MAX_HELD];
    /* TARP only: 1 = pad still physically held; 0 = latched (pad released, kept
     * in buffer because latch is on). Used by the tarp_latch off handler to drop
     * latched entries while preserving still-held ones. Unused by SEQ ARP. */
    uint8_t  held_physical[ARP_MAX_HELD];
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

    /* Monotonic counter of step-fire events. Incremented at the end of each
     * arp_fire_step / tarp_fire_step. JS polls per-track via tN_tarp_fc to
     * derive a blink phase synced to the arp's pulse (Loop button indicator
     * while TARP is latched). Wraps freely — only parity is consumed. */
    uint16_t fire_count;
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
    int octaver;            /* -4..+4, 0=off */
    int harmonize_1;        /* -24..+24, 0=off */
    int harmonize_2;        /* -24..+24, 0=off */
    int harmonize_3;        /* -24..+24, 0=off */
    /* MIDI Delay (stage 5 from NoteTwist) */
    int delay_time_idx;     /* 0..16, index into CLOCK_VALUES */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..16 */
    int fb_velocity;        /* -127..+127 */
    int fb_note;            /* -24..+24 */
    int fb_note_random;      /* 0..24, random pitch range in semitones */
    int fb_note_random_mode; /* 0=Uniform, 1=Gaussian, 2=Walk */
    int fb_gate_time;        /* 0..10: 0=Off, 1..10=fixed gate (1/64..1bar) */
    int fb_clock;            /* -100..+100 */
    int delay_retrig;        /* 0=tails overlap (legacy), 1=new note drops in-flight delay echoes */
    int note_random;         /* 0..24, random semitone offset applied after oct+offset */
    int note_random_mode;    /* 0=Uniform, 1=Gaussian, 2=Walk */
    int note_random_walk;    /* runtime walk accumulator (reset on clip switch) */
    /* SEQ ARP — last stage of the chain. NOTE FX → HARMZ → MIDI DLY emit
     * via pfx_send; when arp.on && !arp_emitting, pfx_send routes note-on/off
     * to the arp's held buffer instead of out. arp_fire_step emits raw via
     * pfx_send with arp_emitting=1 (no further chain processing). */
    arp_engine_t arp;
    uint8_t      arp_emitting;
    uint8_t      seq_arp_sync;   /* 0=free, 1=sync to global rate boundary */
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
    /* Output-pitch refcount: counts how many distinct chain sources (input pads
     * × HARMZ copies + delay echoes + arp emits) are currently sounding each
     * MIDI pitch on this track. pfx_emit gates wire-level note-on/off by this
     * so two pads producing overlapping output pitches via HARMZ don't envelope-
     * retrigger the synth, and a note-off from one pad doesn't silence a pitch
     * another still-held pad is legitimately sourcing. Runtime only — not
     * persisted; zeroed by pfx_reset and at the top of send_panic. */
    uint8_t      pitch_refcount[128];
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
    uint8_t  pad[2];
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
    int octaver;            /* -4..+4 */
    int harmonize_1;        /* -24..+24 */
    int harmonize_2;        /* -24..+24 */
    int harmonize_3;        /* -24..+24 */
    int delay_time_idx;     /* 0..16, index into CLOCK_VALUES */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..16 */
    int fb_velocity;        /* -127..+127 */
    int fb_note;            /* -24..+24 */
    int fb_note_random;      /* 0..24, random pitch range in semitones */
    int fb_note_random_mode; /* 0=Uniform, 1=Gaussian, 2=Walk */
    int fb_gate_time;        /* 0..10: 0=Off, 1..10=fixed gate (1/64..1bar) */
    int fb_clock;            /* -100..+100 */
    int delay_retrig;        /* 0/1: when 1, new note drops in-flight delay echoes */
    int note_random;         /* 0..24, random semitone offset applied after oct+offset */
    int note_random_mode;    /* 0=Uniform, 1=Gaussian, 2=Walk */
    /* SEQ ARP per-clip params */
    int seq_arp_style;         /* 0=Off (bypass), 1..9=Up/Dn/U-D/D-U/Cnv/Div/Ord/Rnd/RnO */
    int seq_arp_rate;          /* 0..9 (index into ARP_RATE_TICKS) */
    int seq_arp_octaves;       /* -4..-1 or +1..+4 (skip 0; default +1) */
    int seq_arp_gate;          /* 1..200 percent */
    int seq_arp_steps_mode;    /* 0..2 (Off/Mute/Skip) */
    int seq_arp_retrigger;     /* 0/1; default 1 */
    int seq_arp_sync;          /* 0=free, 1=sync to global rate boundary */
    uint8_t seq_arp_step_vel[8]; /* ABSOLUTE step velocity 0..127 (0=off); default 100 (name kept for state compat; legacy 5-state levels migrate on load) */
    int8_t  seq_arp_step_int[8]; /* per-step scale-degree offset -24..+24; default 0 */
    uint8_t seq_arp_step_loop_len; /* 1..8, default 8 — step pattern loop length */
    /* NOTE FX K5 "Len": non-destructive fixed pre-gate note length.
     * 0=`--` passthrough, 1..8 = fixed multiples of tps (.25/.5/.75/1/2/4/8/16).
     * Destructive legato lives on CLIP K8 as a one-shot action — see the
     * lgto_apply handler. State v=36. */
    uint8_t note_length_mode;
} clip_pfx_params_t;

/* ------------------------------------------------------------------ */
/* Per-lane drum play-effect params (9 fields, ~36 bytes)              */
/* No harmony, pitch shifts, or SEQ ARP — drum lanes are monophonic.  */
/* ------------------------------------------------------------------ */

typedef struct {
    int gate_time;          /* 0..400 percent; default 100 */
    int velocity_offset;    /* -127..+127 */
    int quantize;           /* 0..100 */
    int delay_time_idx;     /* 0..16, index into CLOCK_VALUES */
    int delay_level;        /* 0..127 */
    int repeat_times;       /* 0..16 */
    int fb_velocity;        /* -127..+127 */
    int fb_gate_time;       /* 0..10: 0=Off, 1..10=fixed gate (1/64..1bar) */
    int fb_clock;           /* -100..+100 */
    int delay_retrig;       /* 0/1: when 1, new note drops in-flight delay echoes */
    /* NOTE FX K5 "Len" — see clip_pfx_params_t.note_length_mode. */
    uint8_t note_length_mode;
} drum_pfx_params_t;

#define DRUM_PFX_MAX_EVENTS 64

/* Per-lane drum pfx runtime state: slimmed play_fx_t for monophonic lanes.
 * One instance per drum lane; 32 per track in seq8_track_t.drum_lane_pfx[]. */
typedef struct {
    int gate_time;          /* mirrored from drum_pfx_params_t via drum_pfx_apply_params */
    int velocity_offset;
    int quantize;
    int delay_time_idx;
    int delay_level;
    int repeat_times;
    int fb_velocity;
    int fb_gate_time;
    int fb_clock;
    int delay_retrig;       /* 0/1: when 1, new note drops in-flight delay echoes */
    uint64_t     sample_counter;
    double       cached_bpm;
    uint32_t     rng;
    pfx_event_t  events[DRUM_PFX_MAX_EVENTS];
    int          event_count;
    pfx_active_t active_note;  /* single active note — monophonic per lane */
    uint8_t      route;
    uint8_t      looper_on;
    uint8_t      track_idx;
    uint8_t      lane_idx;
} drum_pfx_t;

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
    /* Per-step trig conditions (v=34): 0 = default in all three.
     *  step_iter:    0 = always play; else (cycle_len<<4) | cycle_idx with
     *                cycle_len in 1..8 and cycle_idx in 1..cycle_len.
     *  step_random:  0 = 100% (always); else 1..100 = probability percent.
     *                RNG roll is per-emitted-note (chord notes roll independently).
     *  step_ratchet: 0 or 1 = no ratchet; 2..4 = sub-hit count within step gate. */
    uint8_t  step_iter[SEQ_STEPS];
    uint8_t  step_random[SEQ_STEPS];
    uint8_t  step_ratchet[SEQ_STEPS];
    /* Conductor per-clip control banks (meaningful only on the Conductor
     * track's clips; storage exists on every clip). One entry per dAVEBOx
     * track. Phase 3 reads these; stored + persisted here in Phase 2. */
    uint8_t  cond_resp[NUM_TRACKS];   /* Conductor: responder on/off per track; default 1 */
    int8_t   cond_oct [NUM_TRACKS];   /* Conductor: octave offset per track -4..+4; default 0 */
    uint8_t  cond_when[NUM_TRACKS];   /* Conductor: 0=Next, 1=Now; default 0 */
    uint8_t  cond_lock;               /* Conductor CdLk: 0=Off (gate-hold), 1=Lock (sample-and-hold); default 0 */
    /* Loop-cycle counter for Iter trig. Increments on each loop wrap during
     * playback. Reset to 0 on transport-start edge (not on un-pause). Not
     * persisted — always starts at 0 after load. */
    uint16_t loop_cycle;
    uint16_t length;                      /* 1..256, default 16 — size of the loop window in steps */
    /* Loop window anchor in steps. Playback wraps inside [loop_start, loop_start+length).
     * Default 0 (anchored at step 0). Pattern data outside the window is preserved but silent.
     * Bake resets this to 0 (window is re-anchored at step 0 by the bake re-write). */
    uint16_t loop_start;
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
    /* Playback direction: 0=Forward, 1=Backward, 2=Pingpong-Forward (start at
     * loop_start, ascend), 3=Pingpong-Backward (start at last step, descend).
     * Persisted with the clip. */
    uint8_t  playback_dir;
    /* Playback style: 0=Step (default; current behavior — note-on at note's
     * recorded start in any direction), 1=Audio (in reverse motion, note-on
     * fires at the note's END position so the note plays "in reverse" — the
     * note's start position becomes its note-off). In PP this also switches
     * the cycle to endpoint-plays-twice (cycle = 2L) so each note gets one
     * forward and one audio-reverse playthrough per cycle (fugue-machine
     * semantics). Persisted with the clip. */
    uint8_t  playback_audio_reverse;
    /* Pingpong runtime direction: +1 ascending, -1 descending. Initialized on
     * clip launch / transport start from playback_dir. Not persisted. */
    int8_t   pp_dir_state;
} clip_t;

/* ------------------------------------------------------------------ */
/* Drum mode data model                                                */
/* ------------------------------------------------------------------ */

/* One drum lane: a full monophonic melodic clip (all clip machinery reused) plus a
 * fixed base pitch. All params (length, tps, pfx, gate, vel, nudge) live here — there
 * are no container-wide params. pfx applies at render time so harmonize/delay can
 * sound other pitches beyond midi_note. */
typedef struct {
    clip_t  clip;             /* full clip_t — notes[], step arrays, length, tps */
    drum_pfx_params_t pfx_params; /* per-lane drum pfx storage (replaces clip.pfx_params for drum) */
    uint8_t midi_note;        /* base pitch written into every note at step-entry/record time */
    uint8_t _pad[3];
} drum_lane_t;

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
    uint8_t  step_iter[SEQ_STEPS];
    uint8_t  step_random[SEQ_STEPS];
    uint8_t  step_ratchet[SEQ_STEPS];
    uint16_t length;
    uint16_t loop_start;
    uint8_t  active;
    /* Per-lane playback direction + reverse style snapshot so drum-clip
     * bake/undo restores K5 Dir and AltMode RvSt back to pre-bake values. */
    uint8_t  playback_dir;
    uint8_t  playback_audio_reverse;
    drum_pfx_params_t pfx_params;
} drum_rec_snap_lane_t;

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
    uint8_t   recording_pending_page; /* 1 = set recording=1 at next bar boundary (global_tick%16==0) */
    uint8_t   recording_adaptive_arm; /* 1 = at recording_pending_page fire, reset playhead to loop_start
                                       *     (adaptive-mode arms only — fixed-mode records mid-page) */
    /* Steps recorded in the current recording pass; cleared on clip wrap so they play
     * back starting from the next loop (not the pass they were recorded on). */
    uint8_t   live_recorded_steps[32]; /* 256-bit mask: 1 bit per step */
    /* Note-centric recording: in-flight note-ons awaiting note-off for gate capture */
    struct { uint8_t pitch; uint32_t tick_at_on; } rec_pending[10];
    uint8_t  rec_pending_count;
    /* Note-centric playback: per-note gate countdown (render state, not persisted) */
    struct { uint8_t pitch; uint16_t ticks_remaining; uint8_t lane_idx; uint8_t src_pitch; } play_pending[32];
    uint8_t  play_pending_count;
    /* v=34 Ratchet: deferred note-on schedule for step_ratchet sub-hits 1..r-1.
     * Each tick, ticks_until_fire decrements; at 0 the sub-hit fires (note-on +
     * push to play_pending for its own gate countdown) and the slot is dropped.
     * lane_idx = 0xFF means melodic track (calls pfx_note_on); else drum lane. */
    struct {
        uint8_t  pitch;
        uint8_t  vel;
        uint16_t ticks_until_fire;
        uint16_t gate;
        uint8_t  lane_idx;
    } ratchet_pending[24];
    uint8_t  ratchet_pending_count;
    /* Per-track tick position within current step; wraps at cl->ticks_per_step */
    uint32_t tick_in_step;
    /* Atomic render-state snapshot for set_param timing reads */
    uint32_t current_clip_tick;     /* current_step * TPS + tick_in_step; written each render tick */

    /* Drum mode: 16 clips, each containing 32 monophonic lanes.
     * Active when pad_mode == PAD_MODE_DRUM. active_clip/queued_clip/clip_playing
     * apply to drum_clips[] exactly as they do to clips[] in melodic mode. */
    drum_clip_t *drum_clips[NUM_CLIPS];
    /* Per-lane pfx runtime state (monophonic delay chains, not persisted as live runtime). */
    drum_pfx_t drum_lane_pfx[DRUM_LANES];
    /* Per-lane render-state tick counters (not persisted; reset on transport play/clip launch). */
    uint16_t drum_current_step[DRUM_LANES];
    uint32_t drum_tick_in_step[DRUM_LANES];
    /* Per-pass accumulation detector for Rpt1/Rpt2 recording: tracks the last
     * clip-step rs we wrote in this recording pass. -1 = none. On the first
     * fire of a new lane-step in a pass we obey the existing write-once gate;
     * on subsequent fires of the same lane-step (sub-step repeats) we
     * accumulate notes into the step with their sub-step offsets (InQ Off only). */
    int16_t  drum_last_rec_step[DRUM_LANES];
    /* Per-lane recording pending state (runtime only, not persisted). */
    uint32_t drum_rec_pending_tick[DRUM_LANES];
    uint16_t drum_rec_pending_step[DRUM_LANES];
    uint8_t  drum_rec_pending_active[DRUM_LANES];
    /* Per-lane mute/solo bitmasks (persisted). bit l = lane l. */
    uint32_t drum_lane_mute;
    uint32_t drum_lane_solo;
    /* TRACK ARP — per-track live arpeggiator, first stage of pfx chain.
     * Intercepts live pad + external MIDI note-on/off only; sequenced notes
     * bypass tarp and enter pfx_note_on directly. Bypassed on drum tracks. */
    arp_engine_t tarp;
    uint8_t      tarp_on;       /* K1: 0=bypassed, 1=enabled */
    uint8_t      tarp_latch;    /* K8: 0=release clears held, 1=latch keeps running */
    uint8_t      tarp_sync;     /* 0=free (fires immediately), 1=sync to next rate boundary */
    uint8_t      tarp_physical; /* runtime: physical keys currently held (not persisted) */
    /* Phase 1 / Bundle 2A: mirror of JS S.activeDrumLane[t]. JS pushes via
     * tN_active_drum_lane on every assignment site (8 in ui.js + init + sidecar
     * restore). on_midi reads it in drum_pad_event to fire the active lane's
     * note for vel-pad preview. Runtime, not persisted — JS sidecar owns
     * persistence for activeDrumLane. */
    uint8_t      active_drum_lane;
    /* Phase 1 / Bundle 2C-Rpt2: mirror of JS S.drumLanePage[t]. JS pushes
     * via tN_drum_lane_page on every page change (Up/Down arrow on drum
     * track + init + sidecar restore). on_midi reads it in drum_pad_event
     * to translate a left-half padIdx → absolute drum lane index (mirror
     * of JS drumPadToLane formula: page*16 + row*4 + col). Runtime, not
     * persisted. */
    uint8_t      drum_lane_page;
    /* Phase 1 / Bundle 2A: mirror of JS S.drumPerformMode[t] (0=NORMAL,
     * 1=Rpt1, 2=Rpt2). JS pushes via tN_drum_perform_mode whenever it
     * cycles (2 sites in ui.js). drum_pad_event reads this to decide
     * whether to fire vel-pad preview — Rpt modes use JS-side rate/lane
     * pad classification today (Bundle 2C will replace). Gating on this
     * mirror instead of drum_repeat_active fixes the first-hit double
     * trigger: drum_repeat_active flips AFTER the rate-pad set_param
     * processes, but mode is set BEFORE the user can press any rate pad,
     * so on_midi sees the right state. */
    uint8_t      drum_perform_mode;
    uint8_t      track_vel_override; /* TRACK K5: 0=Global, 1-127=absolute, 128=Live */
    /* Drum Repeat: gate mask, vel scale, nudge (per-lane, persisted) */
    uint8_t drum_repeat_gate[DRUM_LANES];         /* 8-step bitmask; bit s=step s; default 0xFF */
    uint8_t drum_repeat_gate_len[DRUM_LANES];     /* gate cycle length 1-8; default 8 */
    uint8_t drum_repeat_vel_scale[DRUM_LANES][8]; /* step vel: 1..127 absolute, 0 unused, 255 = Thru (default; pass held-pad vel). Name kept for state compat */
    int8_t  drum_repeat_nudge[DRUM_LANES][8];     /* -50..50 pct, default 0 */
    /* Repeat engine (runtime, not persisted) */
    uint8_t  drum_repeat_active;
    uint8_t  drum_repeat_lane;
    uint8_t  drum_repeat_rate_idx;
    uint8_t  drum_repeat_vel;
    uint8_t  drum_repeat_step;
    uint32_t drum_repeat_phase;
    /* Phase 1 / Bundle 2C: latched-flag mirror for audio-thread unlatch detection.
     * JS owns the latch decision (engages on Loop-held press) and pushes
     * `tN_drum_repeat_latched 1` as a one-shot edge after start; the helper
     * `drum_repeat_start_internal` defensively clears this to 0 on every
     * start so JS only ever needs to push the 1-edge. drum_pad_event reads
     * this on rate-pad re-press to detect "unlatch tap" synchronously on
     * the audio thread, eliminating the JS-tick race that could otherwise
     * fire one extra repeat at fast rates. Stock Schwung: harmless flag
     * that nothing reads (drum_pad_event never reached). */
    uint8_t  drum_repeat_latched;
    /* Repeat 2 engine: multi-lane simultaneous repeat (runtime, not persisted) */
    uint32_t drum_repeat2_active;          /* bitmask: bit l = lane l held in Rpt 2 */
    uint8_t  drum_repeat2_rate_idx[DRUM_LANES]; /* per-lane rate index 0-7 */
    uint8_t  drum_repeat2_step[DRUM_LANES];     /* per-lane gate mask step 0-7 */
    uint32_t drum_repeat2_phase[DRUM_LANES];    /* per-lane phase within step */
    uint8_t  drum_repeat2_vel[DRUM_LANES];      /* per-lane velocity in Rpt 2 */
    /* Phase 1 / Bundle 2C-Rpt2: per-lane latched-flag bitmask. JS pushes
     * the 1-edge via tN_drum_repeat2_lane_latched <lane> 1 immediately
     * after a Loop-held lane-pad press; _lane_on_internal defensively
     * clears the lane's bit at entry so JS never needs to push the
     * 0-edge. drum_pad_event reads the bit to detect re-tap-to-unlatch
     * synchronously on the audio thread. */
    uint32_t drum_repeat2_latched_lanes;
    /* Per-track drum input quantize (persisted) */
    uint8_t  drum_inp_quant;    /* 0=Off, 1-8 = index into DRUM_INQ_TICKS */
    uint8_t  drum_repeat_sync;  /* 1=first fire snaps to rate grid via arp_master_tick; 0=instant. Per-track. */
    /* Pending sync flags (runtime, not persisted): repeat waits for InQ boundary */
    uint8_t  drum_repeat_pending;
    uint32_t drum_repeat2_pending;  /* bitmask: bit l = lane l pending InQ sync */
    /* CC PARAM bank (bank 6): per-track CC assignments for 8 knobs (persisted) */
    uint8_t  cc_assign[8];
    /* Per-knob continuous-modulation type: 0 = CC, 1 = Channel Pressure (aftertouch).
     * Per-track (persisted). cc_assign[k] is only used for type CC. */
    uint8_t  cc_type[8];
    /* Per-clip CC automation (melodic clips; persisted) */
    cc_auto_t clip_cc_auto[NUM_CLIPS];
    /* Per-clip pad-pressure aftertouch automation (melodic clips; persisted) */
    at_auto_t clip_at_auto[NUM_CLIPS];
    /* Last AT value sent per lane slot during playback; 0xFF = force resend.
     * Indexed by lane slot of the currently-playing clip; reset on play + clip change. */
    uint8_t   at_last_sent[AT_MAX_LANES];
    uint8_t   at_last_clip;   /* active_clip the at_last_sent[] cache reflects */
    /* Last CC value sent per knob during automation playback; 0xFF = force resend */
    uint8_t   cc_auto_last_sent[8];
    /* Defined output value at the playhead per knob (for the realtime display);
     * 0xFF = "—" (nothing defined here). Updated every tick in the playback path. */
    uint8_t   cc_auto_cur_val[8];
    /* block_count when each knob was last live-turned during recording (0 = never) */
    uint32_t  cc_auto_touch_frame[8];
    /* Live CC value per knob — set on knob turn while record-armed; the latch
     * writes this along the playhead (see cc_latched below). */
    uint8_t   cc_live_val[8];
    /* CC latch recording: a knob latches on first turn while record-armed and
     * thereafter overwrites the lane along the playhead with cc_live_val (one
     * point per 1/32) until recording stops. cc_latched = bitmask of latched
     * knobs; cc_latch_last_snap = last 1/32 tick written per knob; cc_prev_ct =
     * previous clip tick (loop-wrap detect for decimation); cc_was_recording =
     * previous-block recording flag (recording 1->0 edge → finalize+decimate). */
    uint8_t   cc_latched;
    uint8_t   cc_was_recording;
    uint32_t  cc_prev_ct;
    uint32_t  cc_latch_last_snap[8];
    /* Last poly-AT pressure value received via tN_live_at. Replayed on every
     * arp/TARP step so new voices spawn with the pressure currently being
     * applied (without this, holding pressure steady means no AT stream and
     * each new arp voice starts at 0). 0 = no replay (after release or fresh
     * track). Channel-pressure mode doesn't need this — the synth's channel
     * AT register holds the value. */
    uint8_t   last_poly_at_press;
} seq8_track_t;
#define LRS_SET(tr, s)  ((tr)->live_recorded_steps[(s)>>3] |=  (uint8_t)(1u<<((s)&7)))
#define LRS_TEST(tr, s) ((tr)->live_recorded_steps[(s)>>3] &   (1u<<((s)&7)))

typedef struct {
    float        sample_rate;
    uint32_t     block_count;
    FILE        *log_fp;

    seq8_track_t tracks[NUM_TRACKS];
    uint8_t      active_track;

    /* Remote-UI (piano-roll) selection + change revision. The browser sets the
     * snapshot target via tN_cC_ruisel; rui_rev bumps on any clip/param edit so
     * the browser can cheaply detect device-side changes. lane = -1 for melodic. */
    uint8_t  rui_sel_track;   /* 0..NUM_TRACKS-1 */
    uint8_t  rui_sel_clip;    /* 0..NUM_CLIPS-1 */
    int16_t  rui_sel_lane;    /* -1 melodic, 0..DRUM_LANES-1 drum */
    int8_t   rui_cc_focus;   /* knob 0..7 whose CC breakpoints emit in rui_cc; -1 = none */
    uint32_t rui_rev;         /* monotonic edit counter */

    /* Targeted re-sync accumulator: which clips changed since the on-device JS
     * last read `rui_dirty`. A bumped rui_rev tells JS "something changed"; the
     * dirty list tells it WHICH (t,c) to re-read, so a single-clip edit costs a
     * few get_params instead of a full 128-clip syncClipsFromDsp() (~1,540
     * round-trips ≈ 4.3 s frozen tick). `full` = scope unknown / overflow /
     * mixed drum+melodic → JS falls back to a full sync. Read-and-cleared by the
     * `rui_dirty` get_param. rui_mark() records a clip; rui_touch() sets full. */
#define RUI_DIRTY_MAX 8
    uint8_t  rui_dirty_full;                 /* 1 = JS must do a full re-sync */
    uint8_t  rui_dirty_n;                    /* # entries in the (t,c) list */
    uint8_t  rui_dirty_t[RUI_DIRTY_MAX];     /* touched track per entry */
    uint8_t  rui_dirty_c[RUI_DIRTY_MAX];     /* touched clip  per entry */

    /* Phase 1 / Bundle 2C-Rpt2: global Delete-held flag. JS pushes the
     * edge via a single `t0_delete_held` set_param on every Delete CC
     * edge (per-track-shaped key, but read here at instance level —
     * Delete is a global modifier). drum_pad_event returns 1 at top
     * when set, so on_midi does NOT classify the pad press; mirrors
     * JS's "bail on Delete-held" branches in the drum-mode pad handlers.
     *
     * Why one push, not 8: a tight for-loop fan-out of 8 tN_* writes
     * within one onMidiMessage callback was empirically observed to
     * coalesce (only the last N landed) — likely a host queue depth
     * limit on rapid same-shape pushes. Single push is reliable.
     *
     * Scope today is Delete only. Shift / Copy / Mute / Capture also
     * gate JS-side pad handlers and would need similar mirrors when
     * porting more pad logic into on_midi; see parked memory
     * project-modal-pad-interception-regression. Generalizing to a
     * `modal_pad_block` bitmask at that point is straightforward. */
    uint8_t      delete_held;

    /* Shared transport — all tracks run on the same timing grid */
    uint8_t  playing;
    uint32_t tick_accum;
    uint32_t tick_threshold;        /* sample_rate * 60 */
    uint32_t tick_delta;            /* MOVE_FRAMES_PER_BLOCK * BPM * PPQN */
    uint32_t master_tick_in_step;     /* drives global_tick and launch-quant at master 1/16 boundary */
    uint32_t global_tick;             /* steps elapsed since transport play; bar boundary = global_tick % 16 == 0 */
    uint32_t arp_master_tick;         /* free-running master tick for SEQ ARP; advances even while stopped, resets on transport play / count-in fire */
    int      emit_bypass_swing;       /* set to 1 around live-tap emissions; pfx_send/drum_pfx_send skip swing when nonzero */
    int      in_queue_drain;          /* set inside pfx_q_fire/drum_pfx_q_fire so re-entered pfx_send/drum_pfx_send skip the swing block (preserving arp/looper/merge hooks but preventing re-queue) */
    uint64_t swing_step_delay_offbeat;/* offbeat-step swing offset in samples; kept current independent of which step we're on so schedule-time swing helper doesn't recompute */

    /* ---- Clock-follow sync (Tier-1) ----------------------------------------
     * When clock_follow_on, the playhead advances from Move's incoming MIDI
     * clock (0xF8, 24 PPQN → +PPQN/24 master ticks each) instead of the
     * internal sample-counted accumulator. Transport follows Move's
     * 0xFA/FB/FC plus clock-staleness (hybrid detection, mirroring the host's
     * chain_get_clock_status). Default 0 = unchanged internal free-run.
     *
     * The clock_follow_on bool is deliberately the ONLY mode discriminator the
     * two seam helpers (seq8_clock_advance / seq8_tick_due) consult, so a later
     * 3-way Internal/Sync/Auto enum drops in by widening this field without
     * touching the call sites. */
    uint8_t  clock_follow_on;          /* 0 = internal free-run (default), 1 = follow Move's MIDI clock */
    int32_t  ext_tick_pending;        /* queued 96-PPQN master ticks from incoming 0xF8 (each clock = +PPQN/24) */
    uint8_t  ext_transport_running;   /* davebox's view of Move's transport (0xFA/FB set, 0xFC / staleness clear) */
    uint32_t ext_sample_clock;        /* monotonic sample counter advanced each render_block (staleness time base) */
    uint32_t ext_clock_last_sample;   /* ext_sample_clock value at the most recent 0xF8 (for staleness check) */
    uint8_t  ext_clock_seen;          /* 1 once any 0xF8 has been observed since follow-mode armed (gates staleness) */
    /* Tempo capture: EMA of the inter-0xF8 sample period while following, used to
     * track Move's tempo into db's internal tick_delta + cached_bpm so the
     * stopped-state fallback runs at Move's tempo and the BPM readout stays
     * honest without manual matching. 0 = no estimate yet. */
    float    ext_clock_period_ema;    /* smoothed samples per Move 0xF8 (24 PPQN) */
    double   clock_follow_bpm_applied; /* last BPM pushed to tick_delta/cached_bpm from the estimate (change-gate) */
    /* Clock OUT: db emits realtime (0xF8/FA/FC) to external gear (cable 2 / USB-A)
     * when free-running (db is master). Suppressed while clock_follow_on (Move's
     * own MIDI Clock Out owns external sync — db relaying would double the clock
     * on the shared port). Toggle persists as "_cs"; default off. */
    uint8_t  clock_send_on;           /* 0 = no clock out (default), 1 = emit when free-running */
    uint8_t  clock_send_phase;        /* 0xF8 divider: emit every 4th 96-PPQN master tick (24 PPQN) */
    uint8_t  clock_send_was_playing;  /* db transport edge tracker for 0xFA/0xFC emission */
    uint8_t  clock_send_was_active;   /* clock-out enabled edge tracker (handles enable/disable mid-play) */
    /* MovePlay (CC 85) inject state machine — fired from render_block (NOT
     * set_param: a set_param-context inject is unreliable). follow_play_request
     * is the desired Move transport; the drain compares it against
     * ext_transport_running (Move's assumed state) and toggles only on a
     * genuine edge, so Mute+Play / Delete+Play never poke Move. */
    uint8_t  follow_play_request;      /* desired Move transport: 1 = want running, 0 = want stopped */
    uint8_t  move_play_inject_phase;  /* 0 = idle, 1 = send press(127), 2 = send release(0) */
    int32_t  move_play_inject_wait;   /* samples to wait between press and release */
    int32_t  follow_start_timeout;     /* samples remaining to wait for Move's clock after a start inject; <=0 = inactive */
    uint8_t  follow_start_kind;        /* what to do on timeout: 0 = none, 1 = plain play, 2 = count-in */
    /* Solo-clock fallback: if Move never starts (Link sync didn't land in the
     * window), run THIS take on a scratch internal clock at the last-known tempo.
     * Ephemeral — db's real tempo state (tick_delta/cached_bpm) is never written,
     * only read to size solo_tick_delta. Cleared on stop / real Move start.
     * Compares against the shared constant tick_threshold (= sample_rate*60). */
    uint8_t  follow_solo;             /* 1 = take is running on the scratch solo clock (clock-follow only) */
    uint32_t solo_tick_accum;         /* scratch accumulator (mirrors tick_accum) */
    uint32_t solo_tick_delta;         /* scratch per-block delta from last-known tempo */
    uint8_t  solo_fallback_pending;   /* one-shot for the JS popup; cleared on get_param("clock_follow_fallback") */
    /* Confirm-build instrumentation (Tier-1 bring-up; harmless to keep). */
    uint32_t dbg_f8_count;            /* total 0xF8 observed */
    uint16_t dbg_fa_count, dbg_fb_count, dbg_fc_count; /* transport msg counts */
    uint8_t  dbg_last_rt;             /* last realtime status byte seen */

    /* DSP-side count-in: counts down in DSP ticks; fires transport+recording when done */
    int32_t  count_in_ticks;        /* remaining ticks; 0 = inactive */
    uint8_t  count_in_track;        /* track to arm for recording on fire */

    /* Metronome: clicks on quarter notes while recording/count-in is active */
    uint8_t  metro_on;              /* 0=off,1=count-in only,2=count+rec,3=always */
    uint8_t  metro_vol;             /* 0-150, default 80 */
    uint16_t metro_beat_count;      /* monotonic counter; incremented on each quarter-note beat */

    /* Metro click: DSP-side WAV playback */
    int      metro_wav_fd;
    void    *metro_wav_map;
    size_t   metro_wav_map_size;
    const int16_t *metro_wav_data;  /* points into mmap; NULL = not loaded */
    uint32_t metro_wav_frames;
    uint32_t metro_click_pos;       /* UINT32_MAX = not playing */

    /* Print mode: bake chain output into step data */
    uint8_t  printing;

    /* Live Merge: multi-track real-time capture of all 8 tracks' pfx-chain
     * output into a deferred-placement buffer. User chooses the destination
     * scene row post-stop via merge_place_row. Per-track pending arrays so
     * each track's captured notes can be written to its own column at the
     * chosen row; tracks with zero captured notes are skipped at placement
     * (existing clips on those tracks at the destination row are preserved). */
#define MERGE_STATE_IDLE      0
#define MERGE_STATE_ARMED     1
#define MERGE_STATE_CAPTURING 2
#define MERGE_STATE_STOPPING  3  /* stop requested; finalize at next 16-step page boundary */
#define MERGE_STATE_CAPTURED  4  /* capture complete, waiting for placement (merge_place_row) */
    uint8_t  merge_state;
    uint32_t merge_start_abs;    /* abs master tick (global_tick*TPS + master_tick_in_step) */
    uint32_t merge_tps;          /* TPS used for captured timing (TICKS_PER_STEP for all tracks) */
    uint32_t merge_end_abs;      /* abs tick at finalize — used to size destination clips */
    /* gate=0 while the note is still held (closed at merge_stop with the
     * elapsed tick); non-zero once the matching note-off arrived during
     * CAPTURING. Both forms are written into clips at merge_place_row time.
     * Slot count must be high enough to cover a long multi-track merge —
     * 32 was insufficient (drum-heavy passes capped after one bar). 512
     * matches MAX_NOTES_PER_CLIP. */
    struct { uint8_t pitch; uint32_t tick_at_on; uint8_t vel; uint16_t gate; } merge_pending[NUM_TRACKS][512];
    uint16_t merge_pending_count[NUM_TRACKS];

    /* Live pad input: global key/scale stored for state persistence */
    uint8_t  pad_key;               /* root key 0-11, default 9 (A) */
    uint8_t  pad_scale;             /* 0=Major (matches JS SCALE_NAMES index) */

    /* Transpose-on-key/scale-change — live preview + commit. Transient: NOT
     * serialized. preview_active gates both the note-emit LUT and the
     * scale-aware tonality reads (eff_pad_key/eff_pad_scale) so harmonies/arps
     * track the candidate while browsing. Cleared defensively on load + suspend. */
    uint8_t  xpose_preview_active;  /* 1=apply xpose_lut at emit + use candidate tonality */
    uint8_t  xpose_preview_key;     /* candidate root 0-11 during preview */
    uint8_t  xpose_preview_scale;   /* candidate scale 0-13 during preview */
    uint8_t  xpose_lut[128];        /* per-pitch remap, rebuilt from the 4-val descriptor */
    uint8_t  launch_quant;          /* 0=Now,1=1/16,2=1/8,3=1/4,4=1/2,5=1-bar; default 5 */
    uint8_t  swing_amt;             /* 0-100 UI; maps to 50%-75% of pair (0=straight, 100=75%) */
    uint8_t  swing_res;             /* 0=1/16 pairs, 1=1/8 pairs */
    uint64_t swing_step_delay;      /* samples to defer notes in current even step; 0=no defer */

    /* Conductor live transposition offset — transient: NOT serialized. Set from
     * the Conductor's currently-played note relative to reference pitch R, applied
     * at responder emit. Phase 3. */
    uint8_t  conductor_sounding;    /* 1 while a Conductor note is held this step (transient) */
    int16_t  conductor_off_deg;     /* scale-degree offset (scale-aware path) (transient) */
    int16_t  conductor_off_semi;    /* semitone offset (chromatic path) (transient) */
    int      conductor_held;        /* count of held Conductor notes (legato/sequenced) (transient) */
    int16_t  conductor_off_deg_prev;   /* prev-tick offset for Now-retrigger change detection (transient) */
    int16_t  conductor_off_semi_prev;  /* prev-tick offset for Now-retrigger change detection (transient) */
    uint8_t  conductor_sounding_prev;  /* prev-tick sounding for Now-retrigger change detection (transient) */


    /* State file path — set by JS via set_param("state_path") before first load/save */
    char state_path[256];

    /* Monotonic nonce: unique per create_instance call; JS polls to detect DSP hot-reload */
    uint32_t instance_nonce;

    /* Set by seq8_load_state when a genuine version mismatch is found (sv>0 && sv!=36).
     * JS reads via get_param, shows confirm dialog. On "Yes" JS sends state_load which
     * re-enters seq8_load_state — flag being set means "delete and start clean". */
    uint8_t state_version_mismatch;

    /* Mute/solo per track: 0=off, 1=on */
    uint8_t mute[NUM_TRACKS];
    uint8_t solo[NUM_TRACKS];

    /* Conductor role: track index that is the Conductor, or -1 = none */
    int8_t   conductor_track;

    /* Mute/solo snapshots: 16 slots */
    uint8_t snap_mute[16][NUM_TRACKS];
    uint8_t snap_solo[16][NUM_TRACKS];
    uint8_t snap_valid[16];

    /* Scale-aware play effects: interpret Ofs/Hrm/delay-pitch in scale degrees */
    uint8_t scale_aware;
    /* Input quantize: 1=snap live recording to step grid (zero offset), 0=unquantized */
    uint8_t inp_quant;
    /* External MIDI channel filter: 0=All, 1-16=specific channel */
    uint8_t midi_in_channel;

    /* 1-level undo/redo: up to UNDO_MAX_CLIPS clip snapshots per operation.
     * Row cut+paste needs 8 src + 8 dst = 16 slots. */
#define UNDO_MAX_CLIPS (NUM_TRACKS * 2)
    clip_t  undo_clips[UNDO_MAX_CLIPS];
    cc_auto_t undo_auto_cc[UNDO_MAX_CLIPS];
    at_auto_t undo_auto_at[UNDO_MAX_CLIPS];
    uint8_t undo_clip_tracks[UNDO_MAX_CLIPS];
    uint8_t undo_clip_indices[UNDO_MAX_CLIPS];
    uint8_t undo_clip_count;
    uint8_t undo_valid;
    clip_t  redo_clips[UNDO_MAX_CLIPS];
    cc_auto_t redo_auto_cc[UNDO_MAX_CLIPS];
    at_auto_t redo_auto_at[UNDO_MAX_CLIPS];
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
    char     last_restore_info[64]; /* "d t c" or "m t0 c0 t1 c1 ..." — set by undo/redo restore */

    /* Drum effective-mute bitmask per snapshot slot per track (bit L = lane L muted). */
    uint32_t snap_drum_eff_mute[16][NUM_TRACKS];

    drum_rec_snap_lane_t drum_undo_lanes[DRUM_LANES];
    drum_rec_snap_lane_t drum_redo_lanes[DRUM_LANES];

    /* Drum row undo/redo — active alongside undo_valid for row_copy/cut/clear.
     * valid=1: one row (copy/clear); valid=2: two rows (cut, [0]=dst [1]=src). */
    uint8_t drum_row_undo_valid;
    uint8_t drum_row_redo_valid;
    uint8_t drum_row_undo_clips[2];
    uint8_t drum_row_redo_clips[2];
    uint8_t undo_locked; /* set during scene bake to block individual undo_begin calls */
    drum_rec_snap_lane_t drum_row_undo_lanes[2][NUM_TRACKS][DRUM_LANES];
    drum_rec_snap_lane_t drum_row_redo_lanes[2][NUM_TRACKS][DRUM_LANES];

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
/* Performance modifier bitmask — 24 mods across 3 rows (bits 0-7=R1 Pitch, 8-15=R2 Vel/Gate, 16-23=R3 Wild). */
#define PERF_MOD_OCT_UP       (1u <<  0)  /* R1: +12 semitones */
#define PERF_MOD_OCT_DOWN     (1u <<  1)  /* R1: -12 semitones */
#define PERF_MOD_SCALE_UP     (1u <<  2)  /* R1: +1 scale degree (scale-aware) */
#define PERF_MOD_SCALE_DOWN   (1u <<  3)  /* R1: -1 scale degree (scale-aware) */
#define PERF_MOD_FIFTH        (1u <<  4)  /* R1: +7 semitones */
#define PERF_MOD_TRITONE      (1u <<  5)  /* R1: +6 semitones */
#define PERF_MOD_DRIFT        (1u <<  6)  /* R1: random walk ±6st, updates each cycle */
#define PERF_MOD_STORM        (1u <<  7)  /* R1: random ±12st per event */
#define PERF_MOD_DECRSC       (1u <<  8)  /* R2: vel ×(1-0.15*cycle), floor 10% — decrescendo */
#define PERF_MOD_SWELL        (1u <<  9)  /* R2: vel follows 16-cycle triangle (loud→quiet→loud) */
#define PERF_MOD_CRESC        (1u << 10)  /* R2: vel ×(1+0.15*cycle), ceil 127 — crescendo */
#define PERF_MOD_PULSE        (1u << 11)  /* R2: even cycles full vel, odd cycles ×0.2 */
#define PERF_MOD_SIDECHAIN    (1u << 12)  /* R2: vel ×(1-0.15*note_idx), floor 10% per cycle */
#define PERF_MOD_STACCATO     (1u << 13)  /* R2: gate = cap/8, via staccato queue */
#define PERF_MOD_LEGATO       (1u << 14)  /* R2: gate = cap-1, via staccato queue */
#define PERF_MOD_RAMP_GATE    (1u << 15)  /* R2: gate ramps up across note-ons in cycle */
#define PERF_MOD_HALFTIME     (1u << 16)  /* R3: suppress every odd cycle */
#define PERF_MOD_TRIPLET_SKIP (1u << 17)  /* R3: suppress every 3rd cycle */
#define PERF_MOD_PHANTOM      (1u << 18)  /* R3: ghost note at pitch-12, vel/4, short gate */
#define PERF_MOD_SPARSE       (1u << 19)  /* R3: ~50% random suppression */
#define PERF_MOD_GLITCH       (1u << 20)  /* R3: random ±5st per event */
#define PERF_MOD_STAGGER      (1u << 21)  /* R3: note N gets +N semitones chromatic */
#define PERF_MOD_SHUFFLE      (1u << 22)  /* R3: randomise pitch order each cycle (drums: hit order) */
#define PERF_MOD_BACKWARDS    (1u << 23)  /* R3: reverse pitch order each cycle */
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
    uint8_t  looper_pending_silence;    /* 1=call looper_silence_active at next render_block tick (ROUTE_MOVE safe) */
    uint8_t  perf_emitted_pitch[NUM_TRACKS][128];
    struct {
        uint8_t  raw_pitch, emitted_pitch, track;
        uint8_t  _pad;
        uint16_t fire_at;
    } perf_staccato_notes[32];           /* staccato, legato, ramp-gate, phantom note-offs */
    uint8_t  perf_staccato_count;
    int8_t   perf_drift_offset;          /* current Drift pitch offset, ±6 semitones */
    uint16_t perf_cycle_note_idx;        /* note-on count for current cycle (sidechain/ramp/stagger) */
    uint16_t perf_note_on_count;         /* total note-ons in loop (for ramp gate divisor) */
    uint16_t perf_current_event_idx;     /* set before each perf_apply() call (shuffle lookup) */
    uint8_t  perf_shuffle_pitches[LOOPER_MAX_EVENTS]; /* pitch permutation built at cycle start */
    /* Deferred save: JS polls state_full get_param; audio thread only sets state_dirty */
    char    state_buf[131072];
    uint8_t state_dirty;

    /* Result of last all_lanes_beat_stretch: 0=none, 1=ok, -1=blocked */
    int all_lanes_stretch_result;

    /* Phase 1: inbound pad MIDI on the audio thread.
     * dsp_inbound_enabled is flipped by JS during the capability handshake
     * once it's confirmed the patched Schwung shim delivers pad presses to
     * on_midi. While 0, on_midi only logs — JS-side pendingLiveNotes still
     * owns the dispatch (stock-Schwung-compatible path).
     * pad_note_map[t][padIdx] holds the resolved MIDI pitch (post key /
     * scale / scale-aware / layout / octave) for each pad on track t. JS
     * pushes the table via tN_padmap whenever its computePadNoteMap output
     * changes. 0xFF = unmapped (skip dispatch). */
    uint8_t  dsp_inbound_enabled;
    uint8_t  pad_note_map[NUM_TRACKS][32];
    /* Pitch actually emitted at each pad's last note-on, so the note-off uses the
     * same pitch even if pad_note_map was repushed mid-hold (e.g. a Key/Scale
     * preview re-layout). 0xFF = no note held on that pad. */
    uint8_t  pad_live_pitch[NUM_TRACKS][32];

    /* JS-driven modal pad-dispatch mute. Set via the 33rd tN_padmap token
     * whenever JS's _padDispatchMutedNow() is true (Shift/Delete/Loop/Mute/
     * Copy/Capture/TapTempo holds, session view, etc.). When set, on_midi
     * skips drum_pad_event so modal gestures don't trigger Rpt1/Rpt2 on
     * the prior active track. */
    uint8_t  pad_dispatch_muted;

    /* JS-driven co-run left-pad-silence flag. Set via the 35th tN_padmap
     * token whenever computePadNoteMap intentionally maps the left-column
     * drum lane pads to 0xFF for Move-native co-run (so DSP on_midi doesn't
     * double-hit Move's injected pad). Distinct from the real pad-drop bug:
     * a 0xFF here is deliberate, so the DROP diagnostic skips it. */
    uint8_t  corun_left_silent;

    /* Phase 1 / Bundle 2: pad-source intent scratch. Set by on_midi just
     * before calling live_note_on / drum_record_note_on / etc., reset at
     * end of dispatch. Holds a pad_source_t value (declared above on_midi).
     * Consumers (Bundle 2A vel-zone bypass, 2B VelIn application, 2C Rpt
     * classifier) read it to decide whether to apply VelIn or skip it.
     * Per-track because on_midi processes one event at a time on the audio
     * thread and the consumer runs synchronously within the same call. */
    uint8_t  pad_source_scratch[NUM_TRACKS];

    /* Phase 1 / Bundle 2A: drum vel-zone mirror. on_midi arms these in
     * drum_pad_event when a right-half pad is pressed on a drum track in
     * NORMAL perform mode (i.e. Rpt1/Rpt2 not running). Volatile session
     * state — JS S.drumVelZoneArmed owns sidecar persistence; this DSP
     * mirror exists for Bundle 2C consumers and to make the JS↔DSP
     * separation explicit. The two mirrors update in parallel on the same
     * hardware event (JS via _onPadPress, DSP via on_midi). */
    uint8_t  drum_vel_zone_armed[NUM_TRACKS];
    uint8_t  drum_last_vel_zone[NUM_TRACKS];  /* 0..15 */

    /* Phase 1: per-(track,pitch) press/release tick snapshots. on_midi writes
     * these at the actual audio buffer the pad event arrives in (audio-thread,
     * single-buffer precision). record_note_on / record_note_off read them
     * back instead of reading tr->current_clip_tick at handler-arrival time,
     * which is 1-2 audio buffers late (JS → tick → set_param hop). Fixes the
     * "press+release in same buffer → gate=1 tick" bug for short staccato.
     * active flag is set on write, cleared on consume. */
    uint32_t on_midi_press_tick[NUM_TRACKS][128];
    uint32_t on_midi_release_tick[NUM_TRACKS][128];
    uint8_t  on_midi_press_active[NUM_TRACKS][128];
    uint8_t  on_midi_release_active[NUM_TRACKS][128];

    /* Drum equivalent: per-(track,lane) step + tick_in_step at press/release.
     * on_midi looks up lane by matching pitch to lane->midi_note (same as
     * drum_record_note_on). Smaller than per-pitch since DRUM_LANES < 128. */
    uint16_t on_midi_drum_press_step[NUM_TRACKS][DRUM_LANES];
    int16_t  on_midi_drum_press_off[NUM_TRACKS][DRUM_LANES];
    uint8_t  on_midi_drum_press_active[NUM_TRACKS][DRUM_LANES];
    uint16_t on_midi_drum_release_step[NUM_TRACKS][DRUM_LANES];
    int16_t  on_midi_drum_release_off[NUM_TRACKS][DRUM_LANES];
    uint8_t  on_midi_drum_release_active[NUM_TRACKS][DRUM_LANES];

    /* Ext-MIDI (cable-2 echo) press-track snapshot, keyed by pitch — the DSP
     * analog of JS extHeldNotes[d1].track. on_midi records which track an
     * external note was pressed on so a cross-track note-off (active track
     * changed mid-hold) releases/records on the ORIGINAL press track, not the
     * current active track. 0xFF = no tracked press. */
    uint8_t  ext_press_track[128];
} seq8_instance_t;

static const host_api_v1_t *g_host = NULL;
static seq8_instance_t     *g_inst = NULL;

/* ------------------------------------------------------------------ */
/* Drum clip lazy allocation helpers                                    */
/* ------------------------------------------------------------------ */

static void seq8_ilog(seq8_instance_t *inst, const char *msg);
/* Clock-follow transport edges — defined with the transport set_param handler
 * (seq8_set_param.c, #included below) but called from on_midi (above the
 * include), so forward-declare them here. */
static void ext_transport_start(seq8_instance_t *inst);
static void ext_transport_stop(seq8_instance_t *inst);
static void clip_init(clip_t *cl);
static void drum_pfx_params_init(drum_pfx_params_t *p);

static void drum_clips_alloc(seq8_instance_t *inst, seq8_track_t *tr) {
    int c, l;
    for (c = 0; c < NUM_CLIPS; c++) {
        if (tr->drum_clips[c]) continue;
        tr->drum_clips[c] = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
        if (!tr->drum_clips[c]) {
            seq8_ilog(inst, "drum_clips_alloc: calloc failed");
            continue;
        }
        for (l = 0; l < DRUM_LANES; l++) {
            clip_init(&tr->drum_clips[c]->lanes[l].clip);
            drum_pfx_params_init(&tr->drum_clips[c]->lanes[l].pfx_params);
            tr->drum_clips[c]->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
        }
    }
}

static void drum_clips_free(seq8_track_t *tr) {
    int c;
    for (c = 0; c < NUM_CLIPS; c++) {
        free(tr->drum_clips[c]);
        tr->drum_clips[c] = NULL;
    }
}

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
/* v=34 trig conditions — defined after effective_note_tick */
static int  step_trig_pass(clip_t *cl, uint16_t sidx, uint32_t cycle, uint32_t *rng);
static void pfx_sync_from_clip(seq8_track_t *tr);
static void drum_pfx_apply_params(drum_pfx_t *px, const drum_pfx_params_t *p);
static uint32_t effective_note_tick(const note_t *n, const clip_t *cl, int quantize);
static uint16_t note_step(uint32_t tick, uint16_t clip_len, uint16_t tps);

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

/* Debug probes call seq8_ilog (synchronous fprintf + fflush). On hot paths
 * (per-note inserts, per-block playhead checks, per-tick repeat invariants) the
 * forced writes can starve the audio thread → RT throttling → device freeze.
 * They MUST NOT ship enabled. Guard every hot-path probe with
 * `#if SEQ8_DEBUG_PROBES`; default OFF strips them entirely from release builds.
 * Flip to 1 and rebuild to re-enable for debugging. */
#ifndef SEQ8_DEBUG_PROBES
#define SEQ8_DEBUG_PROBES 0
#endif

#include "seq8_state.c"

/* ------------------------------------------------------------------ */
/* MIDI output helpers                                                  */
/* ------------------------------------------------------------------ */

/* Send 3-byte MIDI message. Routes on fx->route:
 *   ROUTE_SCHWUNG  → midi_send_internal (Schwung chain, immediate)
 *   ROUTE_MOVE     → midi_inject_to_move (cable 2, CIN from status; NULL-safe)
 *   ROUTE_EXTERNAL → host->midi_send_external (shim audio-thread SPSC ring) */
/* Forward decls — arp engine and scale_transpose defined further down. */
static void arp_add_note     (arp_engine_t *a, uint8_t pitch, uint8_t vel);
static void arp_remove_note  (arp_engine_t *a, uint8_t pitch);
static void arp_silence      (seq8_instance_t *inst, seq8_track_t *tr);
static int  scale_transpose  (seq8_instance_t *inst, int note, int deg_offset);
static int  note_abs_degree  (seq8_instance_t *inst, int note);
static inline int eff_pad_scale(seq8_instance_t *inst);
static void conductor_set_offset_from_note(seq8_instance_t *inst, int played);
static void conductor_clear_offset(seq8_instance_t *inst);

/* Forward decls used by merge_place (defined later in the file). */
static void clip_init(clip_t *cl);
static void clip_build_steps_from_notes(clip_t *cl);
/* clip_insert_note already forward-declared at L942. */

/* Finalize an in-progress Live Merge: close any open note-ons at the current
 * tick (recording their gate), record the capture endpoint, and transition
 * to CAPTURED. The actual write to destination clips happens in merge_place
 * once the user picks a scene row via merge_place_row. Safe to call from
 * ARMED, CAPTURING, or STOPPING; no-op when IDLE/CAPTURED. */
static void merge_finalize(seq8_instance_t *inst) {
    if (!inst || inst->merge_state == MERGE_STATE_IDLE) return;
    if (inst->merge_state == MERGE_STATE_CAPTURED) return;
    if (inst->merge_state == MERGE_STATE_ARMED) {
        int t;
        for (t = 0; t < NUM_TRACKS; t++) inst->merge_pending_count[t] = 0;
        inst->merge_state = MERGE_STATE_IDLE;
        return;
    }
    /* CAPTURING / STOPPING: close any still-open pending notes at current pos. */
    uint32_t abs_now = inst->global_tick * TICKS_PER_STEP + inst->master_tick_in_step;
    uint32_t rel = abs_now > inst->merge_start_abs ? abs_now - inst->merge_start_abs : 0;
    inst->merge_end_abs = rel;
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        int pi;
        for (pi = 0; pi < inst->merge_pending_count[t]; pi++) {
            if (inst->merge_pending[t][pi].gate != 0) continue;
            uint32_t g = rel > inst->merge_pending[t][pi].tick_at_on
                       ? rel - inst->merge_pending[t][pi].tick_at_on : 1;
            if (g == 0)        g = 1;
            if (g > 65535u)    g = 65535u;
            inst->merge_pending[t][pi].gate = (uint16_t)g;
        }
    }
    inst->merge_state = MERGE_STATE_CAPTURED;
    /* state_dirty deferred until merge_place actually writes — there's
     * nothing on disk to update until then. */
}

/* Commit captured notes to the user-selected scene row. Per-track skip when
 * merge_pending_count[t] == 0 — existing clips on those tracks at the row
 * stay intact. Tracks with pending notes overwrite the existing clip at row. */
static void merge_place(seq8_instance_t *inst, int row) {
    if (!inst) return;
    if (row < 0 || row >= NUM_CLIPS) return;
    if (inst->merge_state != MERGE_STATE_CAPTURED) return;
    uint32_t steps = inst->merge_tps
                   ? (inst->merge_end_abs + inst->merge_tps - 1) / inst->merge_tps : 16;
    if (steps < 1)   steps = 1;
    if (steps > 256) steps = 256;
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->merge_pending_count[t] == 0) continue;
        seq8_track_t *tr = &inst->tracks[t];
        int is_drum = tr->pad_mode == PAD_MODE_DRUM;
        if (is_drum) {
            /* Empty slot — nullable (clip-copy of an empty source / state
             * load leave it NULL); allocate before touching lanes. */
            if (!tr->drum_clips[row]) drum_clips_alloc(inst, tr);
            if (!tr->drum_clips[row]) { inst->merge_pending_count[t] = 0; continue; }
            /* Wipe lanes for this row, then size + fill from pending pitches. */
            int l;
            for (l = 0; l < DRUM_LANES; l++) {
                clip_init(&tr->drum_clips[row]->lanes[l].clip);
                tr->drum_clips[row]->lanes[l].clip.length         = (uint16_t)steps;
                tr->drum_clips[row]->lanes[l].clip.ticks_per_step = (uint16_t)inst->merge_tps;
            }
            int pi;
            for (pi = 0; pi < inst->merge_pending_count[t]; pi++) {
                uint8_t pitch = inst->merge_pending[t][pi].pitch;
                for (l = 0; l < DRUM_LANES; l++) {
                    if (tr->drum_clips[row]->lanes[l].midi_note == pitch) {
                        clip_insert_note(
                            &tr->drum_clips[row]->lanes[l].clip,
                            inst->merge_pending[t][pi].tick_at_on,
                            inst->merge_pending[t][pi].gate,
                            pitch, inst->merge_pending[t][pi].vel);
                        break;
                    }
                }
            }
            for (l = 0; l < DRUM_LANES; l++) {
                clip_t *lc = &tr->drum_clips[row]->lanes[l].clip;
                if (lc->note_count > 0) clip_build_steps_from_notes(lc);
            }
        } else {
            clip_t *dc = &tr->clips[row];
            clip_init(dc);
            dc->length         = (uint16_t)steps;
            dc->ticks_per_step = (uint16_t)inst->merge_tps;
            int pi;
            for (pi = 0; pi < inst->merge_pending_count[t]; pi++) {
                clip_insert_note(dc,
                    inst->merge_pending[t][pi].tick_at_on,
                    inst->merge_pending[t][pi].gate,
                    inst->merge_pending[t][pi].pitch,
                    inst->merge_pending[t][pi].vel);
            }
            /* Rebuild step arrays — sequencer playback reads step_notes /
             * step_vel / step_gate, not notes[]. Without this, the clip's
             * notes are stored but silent and invisible in Session View. */
            if (dc->note_count > 0) clip_build_steps_from_notes(dc);
        }
        inst->merge_pending_count[t] = 0;
    }
    inst->state_dirty = 1;
    inst->merge_state = MERGE_STATE_IDLE;
}

static void pfx_emit(play_fx_t *fx, uint8_t status, uint8_t d1, uint8_t d2);
static void pfx_q_insert(play_fx_t *fx, uint64_t fire_at, uint8_t s, uint8_t d1, uint8_t d2, uint8_t flags);
static inline void looper_mark_active(seq8_instance_t *inst, uint8_t track,
                                       uint8_t raw_pitch, uint8_t emitted_pitch);
static int perf_apply(seq8_instance_t *inst, uint8_t tr_idx,
                      uint8_t status, uint8_t *d1, uint8_t *d2);

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
            /* Apply perf mods to live emit so mods kick in immediately during
             * the first capture cycle. Captured event (above) stays raw —
             * LOOPING playback re-applies perf_apply on the clean events. */
            if (g_inst->perf_mods_active) {
                uint8_t raw_d1 = d1;
                g_inst->perf_current_event_idx = (uint16_t)ei;
                if (!perf_apply(g_inst, fx->track_idx, status, &d1, &d2)) {
                    if (raw_d1 < 128)
                        g_inst->perf_emitted_pitch[fx->track_idx][raw_d1] = 0xFF;
                    return; /* suppressed (sparse/halftime/staccato/legato/ramp) */
                }
                if (st == 0x90 && d2 > 0) {
                    looper_mark_active(g_inst, fx->track_idx, raw_d1, d1);
                    /* Phantom: ghost note at pitch-12, vel/4, gate=cap/8. */
                    if ((g_inst->perf_mods_active & PERF_MOD_PHANTOM) &&
                            g_inst->perf_staccato_count < 32) {
                        int gp = (int)d1 - 12;
                        if (gp >= 0) {
                            uint8_t gpb = (uint8_t)gp;
                            uint8_t gv  = d2 / 4 < 1 ? 1 : d2 / 4;
                            uint16_t cap = g_inst->looper_capture_ticks;
                            uint16_t gap = cap / 8 < 2 ? 2 : cap / 8;
                            uint16_t gfire = (uint16_t)((g_inst->looper_pos + gap) % cap);
                            g_inst->looper_emitting = 1;
                            pfx_send(fx, status, gpb, gv);
                            g_inst->looper_emitting = 0;
                            int si = (int)g_inst->perf_staccato_count++;
                            g_inst->perf_staccato_notes[si].raw_pitch     = 0xFF;
                            g_inst->perf_staccato_notes[si].emitted_pitch = gpb;
                            g_inst->perf_staccato_notes[si].track         = fx->track_idx;
                            g_inst->perf_staccato_notes[si].fire_at       = gfire;
                        }
                    }
                } else {
                    looper_mark_active(g_inst, fx->track_idx, raw_d1, 0xFF);
                }
            }
            /* fall through and emit normally so capture is parallel */
        } else if (g_inst->looper_state == LOOPER_STATE_LOOPING) {
            return; /* silenced track during loop playback */
        }
    }

    /* Live Merge hook: multi-track capture. Append note-ons to the
     * per-track pending array and close gate when the matching note-off
     * fires. Destination scene row is chosen post-stop via merge_place_row.
     * Falls through so the note is also emitted normally (parallel capture).
     * Capture continues during STOPPING (user has tapped merge_stop but the
     * bar boundary hasn't landed yet) so trailing notes in the final partial
     * page still make it in. */
    if (g_inst && (g_inst->merge_state == MERGE_STATE_CAPTURING ||
                   g_inst->merge_state == MERGE_STATE_STOPPING)) {
        uint8_t st  = status & 0xF0;
        uint8_t tri = fx->track_idx;
        if (tri < NUM_TRACKS && (st == 0x90 || st == 0x80)) {
            uint32_t abs_now = g_inst->global_tick * TICKS_PER_STEP
                               + g_inst->master_tick_in_step;
            uint32_t rel = abs_now > g_inst->merge_start_abs
                           ? abs_now - g_inst->merge_start_abs : 0;
            if (rel >= 256u * g_inst->merge_tps) {
                /* Max length reached — finalize the whole multi-track capture. */
                merge_finalize(g_inst);
            } else if (st == 0x90 && d2 > 0) {
                if (g_inst->merge_pending_count[tri] < 512) {
                    int _pi = (int)g_inst->merge_pending_count[tri]++;
                    g_inst->merge_pending[tri][_pi].pitch      = d1;
                    g_inst->merge_pending[tri][_pi].tick_at_on = rel;
                    g_inst->merge_pending[tri][_pi].vel        = d2;
                    g_inst->merge_pending[tri][_pi].gate       = 0; /* open */
                }
            } else {
                /* note-off: close the most recent matching open pending entry. */
                int _pi;
                for (_pi = (int)g_inst->merge_pending_count[tri] - 1; _pi >= 0; _pi--) {
                    if (g_inst->merge_pending[tri][_pi].pitch == d1 &&
                        g_inst->merge_pending[tri][_pi].gate == 0) {
                        uint32_t gate = rel > g_inst->merge_pending[tri][_pi].tick_at_on
                                        ? rel - g_inst->merge_pending[tri][_pi].tick_at_on : 1;
                        if (gate == 0)     gate = 1;
                        if (gate > 65535u) gate = 65535u;
                        g_inst->merge_pending[tri][_pi].gate = (uint16_t)gate;
                        break;
                    }
                }
            }
        }
    }

    /* Swing deferral: note-on and note-off on even steps are queued and routed
     * directly (bypass_swing) so they don't re-enter pfx_send on fire.
     * Applies whether transport is playing or stopped (so ARP IN, SEQ ARP, and
     * drum repeats still swing with transport off). Live one-shot pad taps
     * bypass via emit_bypass_swing so they never feel laggy. Events re-entering
     * from a queue drain (in_queue_drain) skip swing here — schedule-time swing
     * already baked their fire_at, so re-queueing would scramble pair order. */
    if (g_inst && g_inst->swing_step_delay > 0
            && !g_inst->emit_bypass_swing
            && !g_inst->in_queue_drain) {
        uint8_t st = status & 0xF0;
        if (st == 0x90 || st == 0x80) {
            pfx_q_insert(fx, fx->sample_counter + g_inst->swing_step_delay,
                         status, d1, d2, PFX_EV_BYPASS_SWING);
            return;
        }
    }
    pfx_emit(fx, status, d1, d2);
}

/* Route a MIDI message directly to the track's output bus, bypassing all
 * pfx_send hooks (ARP, looper, merge, swing). Used for already-deferred events. */
static void pfx_emit(play_fx_t *fx, uint8_t status, uint8_t d1, uint8_t d2) {
    if (!g_host) return;
    /* Conductor track emits NO MIDI. This is the single hardware-send choke
     * point (all three routes flow through here, reached both from pfx_send and
     * from the deferred-queue drain), so dropping here guarantees no note/CC/AT
     * from a Conductor track ever leaves. The Conductor's sequencer still
     * advances steps/playhead in the render path — only the output is silenced;
     * a later phase reads its currently-playing note to drive transposition. */
    if (g_inst && fx->track_idx < NUM_TRACKS &&
            g_inst->tracks[fx->track_idx].pad_mode == PAD_MODE_CONDUCT)
        return;
    /* Conductor responder transposition is now applied at note-record level in
     * pfx_note_on (stored into an->gen_notes), so every emitted on AND its
     * matching off carry the same transposed pitch — no emit-time latch needed.
     * Output-pitch refcount gate. See play_fx_t.pitch_refcount comment.
     * Note-on (0x90 with vel>0): increment; drop if was already sounding.
     * Note-off (0x80, or 0x90 with vel=0): decrement (clamp at 0); drop if
     * still sounding from another source. When refcount is already 0 we let
     * the off through unchanged — panic sweeps, stray offs, and the safety
     * silence-all paths must still reach the synth. CC/AT/PB pass through. */
    {
        uint8_t st = status & 0xF0;
        if (st == 0x90 && d2 > 0) {
            if (d1 < 128 && fx->pitch_refcount[d1]++ != 0) return;
        } else if (st == 0x80 || (st == 0x90 && d2 == 0)) {
            if (d1 < 128 && fx->pitch_refcount[d1] > 0) {
                if (--fx->pitch_refcount[d1] != 0) return;
            }
        }
    }
    if (fx->route == ROUTE_MOVE) {
        if (!g_host->midi_inject_to_move) return;
        uint8_t pkt[4] = { (uint8_t)(0x20 | (status >> 4)), status, d1, d2 };
        g_host->midi_inject_to_move(pkt, 4);
        return;
    }
    if (fx->route == ROUTE_EXTERNAL) {
        /* Push directly to the host's audio-thread-safe SPSC ring (the shim
         * drains it into the MIDI_OUT mailbox on its own per-block SPI
         * cadence). Packet byte 0 is the USB-MIDI header: cable<<4 | CIN.
         * USB-A out lives on cable-2 (per SPI_PROTOCOL.md), so the cable
         * nibble is 0x20. Requires Schwung 0.9.16+. */
        if (g_host->midi_send_external) {
            const uint8_t pkt[4] = { (uint8_t)(0x20 | ((status >> 4) & 0x0F)), status, d1, d2 };
            g_host->midi_send_external(pkt, 4);
        }
        return;
    }
    const uint8_t msg[4] = { (uint8_t)(status >> 4), status, d1, d2 };
    if (g_host->midi_send_internal) g_host->midi_send_internal(msg, 4);
}

/* LOAD-BEARING SPACING: the blank lines flanking this cold-path include are
 * part of the phase-3 re-runnable gate — the split is proven by the
 * preprocessed TU being byte-identical pre/post (`clang -E -P`). Do not tidy. */
#include "seq8_looper.c"

/* For every route with at least one track assigned, broadcast a panic on
 * all 16 MIDI channels (not just the channels our tracks happen to use).
 * Each route gets exactly one sweep — one representative pfx per route. */
static void send_panic(seq8_instance_t *inst) {
    play_fx_t *route_pfx[3] = { NULL, NULL, NULL };
    int t, ch, n;
    /* Zero every track's output-pitch refcount so the panic sweep's note-offs
     * (which decrement) don't go negative and so the next note-ons fire fresh. */
    for (t = 0; t < NUM_TRACKS; t++) {
        memset(inst->tracks[t].pfx.pitch_refcount, 0,
               sizeof(inst->tracks[t].pfx.pitch_refcount));
    }
    /* A panic ends all sounding notes — drop the conductor offset/held count so
     * stale state can't transpose the next note-ons. */
    conductor_clear_offset(inst);
    inst->conductor_held = 0;
    /* Reset Now-retrigger prev-offset so a stale prev can't suppress a needed
     * retrigger after panic / clear-session. */
    inst->conductor_off_deg_prev  = 0;
    inst->conductor_off_semi_prev = 0;
    inst->conductor_sounding_prev = 0;
    for (t = 0; t < NUM_TRACKS; t++) {
        play_fx_t *fx = &inst->tracks[t].pfx;
        if (fx->route >= 0 && fx->route < 3 && !route_pfx[fx->route])
            route_pfx[fx->route] = fx;
    }
    if (route_pfx[ROUTE_SCHWUNG]) {
        play_fx_t *fx = route_pfx[ROUTE_SCHWUNG];
        for (ch = 0; ch < 16; ch++)
            for (n = 0; n < 128; n++)
                pfx_send(fx, (uint8_t)(0x80 | ch), (uint8_t)n, 0);
    }
    if (route_pfx[ROUTE_EXTERNAL]) {
        /* 128 note-offs/channel would overflow the shim's 64-packet send ring;
         * CC 120 + 123 per channel silences everything in 32 messages. */
        play_fx_t *fx = route_pfx[ROUTE_EXTERNAL];
        for (ch = 0; ch < 16; ch++) {
            pfx_send(fx, (uint8_t)(0xB0 | ch), 120, 0); /* All Sound Off */
            pfx_send(fx, (uint8_t)(0xB0 | ch), 123, 0); /* All Notes Off */
        }
    }
    /* ROUTE_MOVE: skip CC 123 sweep. Move's voice allocator corrupts when
     * CC 123 (all-notes-off) is followed by explicit note-offs for pitches
     * already killed by the CC. silence_track_notes_v2 already sent
     * per-note note-offs for every sounding voice, so the sweep is
     * redundant here. */
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

/* Convert a Len/gate-aware sequencer-tick duration (96 PPQN) to samples for the
 * pfx event queue. Used by sequenced playback so the emitted note-off honors the
 * full per-note gate (NOTE FX Len + gate_time) rather than pfx_gate_smp's fixed
 * GATE_TICKS floor — which otherwise clamped short Len values (e.g. .25) up. */
static inline uint64_t pfx_ticks_to_smp(seq8_instance_t *inst, seq8_track_t *tr,
                                        uint32_t ticks) {
    double sp = pfx_spc(inst, tr);
    double s  = (double)ticks * (double)TICKS_TO_480PPQN * sp;
    if (s < 1.0 && ticks > 0) s = 1.0;
    return (uint64_t)(s + 0.5);
}

/* ------------------------------------------------------------------ */
/* Event queue (direct port from NoteTwist)                            */
/* ------------------------------------------------------------------ */

static void pfx_q_insert(play_fx_t *fx, uint64_t fire_at,
                         uint8_t s, uint8_t d1, uint8_t d2, uint8_t flags) {
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
    fx->events[lo].flags    = flags;
    fx->event_count++;
}

/* Schedule-time swing: returns the swing offset (samples) to add to fire_at if
 * its target step is offbeat. Used at MIDI DLY echo and deferred note-off
 * schedule sites so each event individually evaluates its
 * own swing based on where its fire_at lands — instead of being auto-shifted
 * at fire time (which could reorder on/off pairs and produce hanging notes). */
static uint64_t swing_offset_for_fire_at(seq8_instance_t *inst,
                                         uint64_t fx_sample_counter,
                                         uint64_t fire_at) {
    if (!inst) return 0;
    if (inst->swing_amt == 0) return 0;
    if (inst->swing_step_delay_offbeat == 0) return 0;
    if (inst->tick_delta == 0) return 0;
    double spt = (double)MOVE_FRAMES_PER_BLOCK
                 * (double)inst->tick_threshold / (double)inst->tick_delta;
    if (spt <= 0.0) return 0;
    int64_t delta_samples = (int64_t)fire_at - (int64_t)fx_sample_counter;
    int64_t target_tick   = (int64_t)inst->arp_master_tick
                            + (int64_t)((double)delta_samples / spt);
    if (target_tick < 0) return 0;
    uint64_t target_step = (uint64_t)target_tick / (uint64_t)TICKS_PER_STEP;
    int offbeat = (inst->swing_res == 0)
        ? (int)(target_step % 2 == 1)
        : (int)((target_step / 2) % 2 == 1);
    return offbeat ? inst->swing_step_delay_offbeat : (uint64_t)0;
}

static void pfx_q_fire(play_fx_t *fx, uint64_t now) {
    if (g_inst) g_inst->in_queue_drain = 1;
    int f = 0;
    while (f < fx->event_count && fx->events[f].fire_at <= now) {
        if (fx->events[f].flags & PFX_EV_BYPASS_SWING)
            pfx_emit(fx, fx->events[f].msg[0], fx->events[f].msg[1], fx->events[f].msg[2]);
        else
            pfx_send(fx, fx->events[f].msg[0], fx->events[f].msg[1], fx->events[f].msg[2]);
        f++;
    }
    if (f > 0) {
        fx->event_count -= f;
        if (fx->event_count > 0)
            memmove(&fx->events[0], &fx->events[f],
                    (size_t)fx->event_count * sizeof(pfx_event_t));
    }
    if (g_inst) g_inst->in_queue_drain = 0;
}

#include "seq8_tonality.c"

/* Reference R = root pitch-class at MIDI octave 4 (eff key + 60). Set the live
 * conductor transposition offset from the Conductor's currently-played note. */
static void conductor_set_offset_from_note(seq8_instance_t *inst, int played) {
    int R = eff_pad_key(inst) + 60;
    inst->conductor_off_semi = (int16_t)(played - R);
    inst->conductor_off_deg  = (int16_t)(note_abs_degree(inst, played) - note_abs_degree(inst, R));
    inst->conductor_sounding = 1;
}
static void conductor_clear_offset(seq8_instance_t *inst) {
    inst->conductor_sounding = 0;
    inst->conductor_off_deg = 0;
    inst->conductor_off_semi = 0;
}

/* LOAD-BEARING SPACING: the blank lines flanking this include are part of the
 * phase-3 re-runnable gate — the split is proven by the preprocessed TU being
 * byte-identical pre/post (`clang -E -P`). Do not tidy. The playback-geometry
 * cluster (note_audio_reverse_cmp_tick etc.) deliberately stays below in core. */
#include "seq8_pfx.c"

/* Compare-tick a note should match against `cct` for note-on to fire. In Step
 * style (or Forward / ascending PP), this is the note's quantized start
 * position. In Audio style during reverse motion, it's the note's quantized
 * end position (start + gate), clamped to the loop-window end so a sustained
 * note never points outside its clip. */
static inline uint32_t note_audio_reverse_cmp_tick(const note_t *n, const clip_t *cl, int quantize) {
    uint32_t base = effective_note_tick(n, cl, quantize);
    if (!cl->playback_audio_reverse) return base;
    if (!clip_in_reverse_motion(cl))  return base;
    uint32_t end_tick = base + (uint32_t)n->gate;
    uint32_t win_end_ticks = (uint32_t)(cl->loop_start + cl->length) * (uint32_t)cl->ticks_per_step;
    if (win_end_ticks > 0 && end_tick >= win_end_ticks) end_tick = win_end_ticks - 1u;
    return end_tick;
}

/* Playback cycle length in steps for a given direction + style. Forward and
 * Backward = L. Pingpong Step = 2L-2 (endpoint plays once). Pingpong Audio =
 * 2L (endpoint plays twice, fugue-machine cycle). Returns L for degenerate
 * length < 2. */
static inline uint16_t playback_cycle_steps(uint8_t pdir, uint8_t audio_reverse, uint16_t length) {
    if (pdir == 2 || pdir == 3) {
        if (length < 2) return length;
        return audio_reverse ? (uint16_t)(2u * length) : (uint16_t)(2u * length - 2u);
    }
    return length;
}

/* Compute the output-cycle position(s) where a source note at `rel_tick`
 * (relative to the clip window) with `gate` ticks should audibly fire during
 * one playback cycle. Used by bake / Ableton export to lay out forward-baked
 * notes that mirror what live playback sounded like.
 *
 * Returns 0..2; fills positions_out[] with output ticks each in [0, cycle_ticks).
 * Forward / Backward: one position per note. Pingpong: 1-2 positions per note
 * (endpoints emit once; middle steps emit twice — one per half-cycle).
 *
 * Audio reverse style fires note-on at the note's END position with reversed
 * within-step micro-timing, so a note's audible "head" in reverse motion
 * lands at (note_end_step + reversed_micro_offset). */
static int compute_bake_emit_positions(uint8_t pdir, uint8_t audio_reverse,
                                       uint16_t length, uint16_t tps,
                                       uint32_t rel_tick, uint32_t gate,
                                       uint32_t positions_out[2]) {
    if (length == 0 || tps == 0) return 0;
    /* Step index uses note_step-style rounding so a note recorded just below
     * a step boundary (e.g. tick 335 with tps=24, intended for step 14) maps
     * to its quantized step rather than the floor below. Without rounding the
     * descending-position math (2L-2-S, etc.) collides with the next-lower
     * step and the baked output ends up with two notes piled on the wrong
     * cycle slot. micro can be negative when the source tick rounded up. */
    uint16_t S      = note_step(rel_tick, length, tps);
    int32_t  micro  = (int32_t)rel_tick - (int32_t)S * (int32_t)tps;
    uint32_t end_tick = rel_tick + gate;
    uint32_t win_end  = (uint32_t)length * tps;
    if (end_tick >= win_end) end_tick = win_end - 1u;
    uint16_t S_end   = note_step(end_tick, length, tps);
    int32_t  micro_e = (int32_t)end_tick - (int32_t)S_end * (int32_t)tps;

    int count = 0;
    /* Helper macro: compute a position from a position-in-cycle (P) plus a
     * forward sub-step offset; clamp to >= 0 (signed-safe). */
    #define _POS_FWD(P, M) ((uint32_t)((int32_t)(P) * (int32_t)tps + (int32_t)(M) >= 0 \
                              ? (int32_t)(P) * (int32_t)tps + (int32_t)(M) : 0))
    /* Audio-reverse sub-step offset = (tps - 1 - micro_e). When micro_e < 0
     * (source rounded up), that becomes tps - 1 - (negative) > tps - 1 — we
     * fold it back into the next step's beginning. */
    #define _POS_REV(P, ME) ((uint32_t)((int32_t)(P) * (int32_t)tps + (int32_t)tps - 1 - (int32_t)(ME) >= 0 \
                              ? (int32_t)(P) * (int32_t)tps + (int32_t)tps - 1 - (int32_t)(ME) : 0))

    switch (pdir) {
    case 1: /* Backward */
        if (audio_reverse)
            positions_out[count++] = _POS_REV((int32_t)(length - 1u) - (int32_t)S_end, micro_e);
        else
            positions_out[count++] = _POS_FWD((int32_t)(length - 1u) - (int32_t)S, micro);
        break;
    case 2: /* Pingpong Forward */
        /* Ascending half — forward note-on at start (always). */
        positions_out[count++] = _POS_FWD((int32_t)S, micro);
        if (audio_reverse) {
            /* Cycle = 2L, endpoint repeats. Descending half: position = 2L-1-S_end. */
            positions_out[count++] = _POS_REV((int32_t)(2u * length - 1u) - (int32_t)S_end, micro_e);
        } else if (S > 0 && S < (uint16_t)(length - 1) && length >= 2) {
            /* Cycle = 2L-2, endpoint plays once. Only middle steps emit twice. */
            positions_out[count++] = _POS_FWD((int32_t)(2u * length - 2u) - (int32_t)S, micro);
        }
        break;
    case 3: /* Pingpong Backward */
        if (audio_reverse) {
            /* Descending first (0..L-1), ascending second (L..2L-1). */
            positions_out[count++] = _POS_REV((int32_t)(length - 1u) - (int32_t)S_end, micro_e);
            positions_out[count++] = _POS_FWD((int32_t)length + (int32_t)S, micro);
        } else {
            positions_out[count++] = _POS_FWD((int32_t)(length - 1u) - (int32_t)S, micro);
            if (S > 0 && S < (uint16_t)(length - 1) && length >= 2)
                positions_out[count++] = _POS_FWD((int32_t)(length - 1u) + (int32_t)S, micro);
        }
        break;
    case 0:
    default: /* Forward */
        positions_out[count++] = rel_tick;
        break;
    }
    #undef _POS_FWD
    #undef _POS_REV
    return count;
}

/* ------------------------------------------------------------------ */
/* NOTE FX "Len" — pre-gate fixed note length                          */
/* ------------------------------------------------------------------ */
/* Len mode 0..8: 0=`--` passthrough, 1..8 = fixed multiples of tps.
 * Multipliers: .25, .50, .75, 1, 2, 4, 8, 16. Destructive Lgto is a
 * separate one-shot action (see apply_legato_to_clip). */
static const uint8_t LEN_TICK_NUM[9] = { 0, 1, 1, 3, 1, 2, 4, 8, 16 };
static const uint8_t LEN_TICK_DEN[9] = { 1, 4, 2, 4, 1, 1, 1, 1,  1 };

/* Resolve effective per-note gate (ticks) for step-playback paths
 * (live render + bake + Ableton export). Honors NOTE FX K5 Len +
 * K6 gate_time. No cycle awareness needed — Len is a position-
 * independent fixed multiplier. */
static inline uint32_t compute_effective_gate_ticks(
    uint16_t tps,
    uint16_t source_gate,
    uint8_t  len_mode,
    int      gate_time_pct)
{
    uint32_t base;
    if (len_mode == 0u || len_mode > 8u || tps == 0u) {
        base = (uint32_t)source_gate;
    } else {
        uint32_t num = (uint32_t)LEN_TICK_NUM[len_mode];
        uint32_t den = (uint32_t)LEN_TICK_DEN[len_mode];
        base = (num * (uint32_t)tps + den / 2u) / den;
    }
    if (base < 1u) base = 1u;
    uint32_t eff = (base * (uint32_t)gate_time_pct + 50u) / 100u;
    if (eff < 1u) eff = 1u;
    if (eff > 65535u) eff = 65535u;
    return eff;
}

/* Destructive legato: for each note in `cl`, set its gate to the distance
 * between this note's tick and the next note's tick anywhere in the clip
 * (clip end for the last note). Same-tick chord notes share one gate. */
static void apply_legato_to_clip(clip_t *cl) {
    if (cl->note_count == 0) return;
    uint16_t tps = cl->ticks_per_step ? cl->ticks_per_step : (uint16_t)TICKS_PER_STEP;
    uint32_t clip_end_tick = (uint32_t)cl->length * tps;
    uint16_t i, j;
    for (i = 0; i < cl->note_count; i++) {
        note_t *n = &cl->notes[i];
        if (!n->active) continue;
        uint32_t next_tick = clip_end_tick;
        for (j = 0; j < cl->note_count; j++) {
            if (j == i) continue;
            note_t *m = &cl->notes[j];
            if (!m->active) continue;
            if (m->tick <= n->tick) continue;          /* skip same-tick chords + earlier notes */
            if (m->tick < next_tick) next_tick = m->tick;
        }
        if (next_tick <= n->tick) continue;            /* defensive */
        uint32_t new_gate = next_tick - n->tick;
        if (new_gate < 1u) new_gate = 1u;
        if (new_gate > 65535u) new_gate = 65535u;
        n->gate = (uint16_t)new_gate;
    }
    /* Rebuild step_gate[] mirror so step-edit displays + step-write paths
     * see the new gates. occ_dirty also flips for the occupancy bitmap. */
    clip_build_steps_from_notes(cl);
}

/* Audible cct: where the playhead is currently sounding in clip-tick space.
 *   Step style, or Forward / PP ascending half: tick_in_step counts forward
 *   within each step → cct = current_step*tps + tick_in_step.
 *   Audio style + reverse motion (Bwd always, PP descending half only):
 *   tick_in_step counts backward within each step → cct = current_step*tps
 *   + (tps - 1 - tick_in_step). This descends monotonically as time
 *   advances so when transport starts in Bwd-Audio the playhead lands at
 *   the clip's last tick (where the last step's note's END position is)
 *   and the first audible note fires immediately. */
static inline uint32_t playback_audible_cct(const clip_t *cl,
                                            uint16_t current_step,
                                            uint16_t tick_in_step) {
    uint16_t tps = cl->ticks_per_step;
    if (tps == 0) return (uint32_t)current_step;
    if (cl->playback_audio_reverse && clip_in_reverse_motion(cl))
        return (uint32_t)current_step * tps + (uint32_t)(tps - 1u - tick_in_step);
    return (uint32_t)current_step * tps + (uint32_t)tick_in_step;
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

/* Reset cycle position only — NOT timing. Called when retrigger=1 sees a new
 * note enter the buffer or the active clip wraps. Resets which note plays next
 * (cyc_pos / ud_dir / cycle_step_count / random_used) but leaves the rate-grid
 * countdown (ticks_until_next / pending_first_note / master_anchor) intact, so
 * the next fire lands on the same beat it was already scheduled for. Without
 * this, every new pitch under retrigger=on zeroed the countdown and re-armed
 * a first-note wait — up to one rate-interval of silence per added pitch,
 * audible as stutters/pauses during rapid live chord changes. sync handles
 * absolute-grid alignment on the existing fire boundaries either way.
 *
 * master_tick arg retained for API stability (callers unchanged); intentionally
 * unused now. */
static void arp_retrigger(arp_engine_t *a, uint32_t master_tick) {
    (void)master_tick;
    a->cyc_pos          = 0;
    a->ud_dir           = 1;
    a->cycle_step_count = 0;
    a->random_used      = 0;
}

static void arp_init_defaults(arp_engine_t *a) {
    a->style     = 0;
    a->rate_idx  = ARP_RATE_DEFAULT;
    a->octaves   = 0;
    a->gate_pct  = 100;
    a->steps_mode = 1;
    a->retrigger = 1;
    int i;
    /* step_vel level: 0=off, 1=row0(min), 4=row3(full incoming). Default 4. */
    for (i = 0; i < 8; i++) a->step_vel[i] = 255;   /* Thru */
    /* step_int: per-step scale-degree offset -24..+24. Default 0. */
    for (i = 0; i < 8; i++) a->step_int[i] = 0;
    a->step_loop_len = 8;
    arp_clear_runtime(a);
}

/* Set all play effects parameters to neutral / passthrough. */
static void pfx_reset(play_fx_t *fx) {
    fx->octave_shift    = 0;
    fx->note_offset     = 0;
    fx->gate_time       = 100;
    fx->velocity_offset = 0;
    fx->octaver         = 0;
    fx->harmonize_1     = 0;
    fx->harmonize_2     = 0;
    fx->harmonize_3     = 0;
    fx->delay_time_idx  = DEFAULT_DELAY_TIME_IDX;
    fx->delay_level     = 0;
    fx->repeat_times    = 0;
    fx->fb_velocity     = 0;
    fx->fb_note         = 0;
    fx->fb_note_random      = 0;
    fx->fb_note_random_mode = 0;
    fx->fb_gate_time    = 0;
    fx->fb_clock        = 0;
    fx->delay_retrig    = 1;
    fx->quantize        = 0;
    arp_init_defaults(&fx->arp);
    memset(fx->pitch_refcount, 0, sizeof(fx->pitch_refcount));
}

/* Process a note-on through the chain. Sends immediate output via
 * pfx_send; queues delay repeats.
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
    int t_idx = (int)(tr - inst->tracks);

    /* Conductor drives the live transpose offset from its OWN played note —
     * but from the POST-NOTE-FX pitch (gen[0]), not the raw orig_note, so the
     * Conductor's slimmed NOTE FX bank (Octave/Offset/Random) shapes the note
     * BEFORE the responder offset is derived. The offset SET is deferred until
     * after pfx_build_gen_notes fills gen[] (below). Held count is bumped here
     * so on/off counting is unaffected; it handles legato overlap (monophonic
     * conductor → 0/1). Covers BOTH sequenced (sequencer → pfx_note_on) and
     * live-pad (live_note_on → pfx_note_on) input, since both flow here. The
     * conductor's own gen/emit still runs but is suppressed at pfx_emit. */
    int _is_conductor = (t_idx == inst->conductor_track &&
                         tr->pad_mode == PAD_MODE_CONDUCT);
    if (_is_conductor) inst->conductor_held++;

    int v = clamp_i((int)vel + fx->velocity_offset, 1, 127);

    /* Conductor is scale-aware (NOTE FX Offset/Random apply as scale degrees
     * when global Scale-Aware is on); melodic-scale tracks likewise. Octave is
     * ×12 inside pfx_build_gen_notes regardless. */
    int is_scale_aware = inst->scale_aware &&
        (tr->pad_mode == PAD_MODE_MELODIC_SCALE || tr->pad_mode == PAD_MODE_CONDUCT);
    uint8_t gen[MAX_GEN_NOTES];
    int gc = pfx_build_gen_notes(inst, is_scale_aware, fx, (int)orig_note, gen);

    /* Conductor offset from the post-NOTE-FX primary pitch. gen[1+] harmonies
     * are irrelevant for the conductor (its own emit is suppressed). */
    if (_is_conductor)
        conductor_set_offset_from_note(inst, (int)gen[0]);

    /* Conductor responder transpose ("Next"): apply the conductor offset to
     * each gen[] note (primary + harmonies) HERE — before the record is stored
     * and before any on/off is emitted — so the on, every future off (read from
     * an->gen_notes), and the retrigger-guard release all use the SAME pitch.
     * Captured at note-on; the note keeps this pitch for its whole life even if
     * the conductor offset changes later (off matches on → no stuck notes).
     * Non-destructive: clip note data untouched; only transient gen[] shifts.
     * SEQ ARP and the global looper follow the conductor automatically and
     * correctly: this transpose runs BEFORE the gen[] notes are handed to
     * pfx_send, which is exactly where SEQ ARP captures into held_pitch[] and
     * where the looper records (post-arp emit). So both see already-transposed
     * pitches. The shift is sampled ONCE here, at the moment the note enters
     * the chain, and frozen for that note's life — a held arp note or a looped
     * recording does NOT dynamically re-pitch as the conductor moves later.
     * That freeze is intentional (matches on/off pairing; a loop is a frozen
     * recording), not a gap. */
    conductor_transpose_gen(inst, t_idx, gen, gc);

    /* Retrigger guard: if this note is already active, clean up first. */
    if (an->active) {
        uint8_t off_s = (uint8_t)(0x80 | an->channel);
        int i;
        for (i = 0; i < an->gen_count; i++)
            pfx_send(fx, off_s, an->gen_notes[i], 0);
    }

    /* Delay retrig: when enabled, a new note-on drops in-flight delay echoes.
     * Send note-off for every queued event referencing a sounding pitch and
     * drain the event ring so the prior tail doesn't pile on top of the new
     * note's repeats. Synths drop unmatched offs, so duplicate offs from
     * still-pending note-off events are harmless. Drain runs BEFORE the new
     * note's immediate emission below so we don't silence what we're about
     * to play. */
    if (fx->delay_retrig && fx->event_count > 0) {
        int qi;
        for (qi = 0; qi < fx->event_count; qi++) {
            pfx_event_t *ev = &fx->events[qi];
            uint8_t st = ev->msg[0] & 0xF0;
            if (st == 0x90 || st == 0x80) {
                uint8_t off = (uint8_t)(0x80 | (ev->msg[0] & 0x0F));
                pfx_send(fx, off, ev->msg[1], 0);
            }
        }
        fx->event_count = 0;
    }

    /* Store active-note record. */
    memset(an, 0, sizeof(pfx_active_t));
    an->active        = 1;
    an->channel       = ch;
    an->on_time       = now;
    an->orig_velocity = (uint8_t)v;
    an->gen_count     = gc;
    memcpy(an->gen_notes, gen, (size_t)gc);

    double sp    = pfx_spc(inst, tr);
    uint8_t on_s = (uint8_t)(0x90 | ch);

    /* Immediate note-ons. */
    int i;
    for (i = 0; i < gc; i++)
        pfx_send(fx, on_s, gen[i], (uint8_t)v);

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

/* When the conductor offset changes, retrigger sounding notes on responder
 * tracks set to "Now" (cond_when==1) at the new pitch, preserving remaining
 * gate. "Next" tracks (cond_when==0) are left untouched. Call once per tick
 * AFTER the conductor offset for this tick is settled.
 *
 * Notes: pfx_build_gen_notes is deterministic given fx params EXCEPT for NOTE
 * FX Random, which RE-ROLLS on rebuild — acceptable for a retrigger. Delay
 * echoes already in flight are not re-pitched (edge). Non-destructive: only
 * transient active-note records + MIDI; clip data untouched. */
static void conductor_apply_now_retrigger(seq8_instance_t *inst) {
    if (inst->conductor_off_deg  == inst->conductor_off_deg_prev &&
        inst->conductor_off_semi == inst->conductor_off_semi_prev &&
        inst->conductor_sounding == inst->conductor_sounding_prev) return;
    inst->conductor_off_deg_prev  = inst->conductor_off_deg;
    inst->conductor_off_semi_prev = inst->conductor_off_semi;
    inst->conductor_sounding_prev = inst->conductor_sounding;
    if (inst->conductor_track < 0) return;
    seq8_track_t *cnd = &inst->tracks[inst->conductor_track];
    clip_t *cc = &cnd->clips[cnd->active_clip];
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        if (t == inst->conductor_track) continue;
        seq8_track_t *tr = &inst->tracks[t];
        if (tr->pad_mode != PAD_MODE_MELODIC_SCALE) continue;
        if (cc->cond_when[t] != 1) continue;        /* Now only */
        play_fx_t *fx = &tr->pfx;
        int p;
        for (p = 0; p < 128; p++) {
            pfx_active_t *an = &fx->active_notes[p];
            if (!an->active) continue;
            uint8_t off_s = (uint8_t)(0x80 | an->channel);
            uint8_t on_s  = (uint8_t)(0x90 | an->channel);
            int i;
            /* off the OLD (currently-sounding) transposed gen */
            for (i = 0; i < an->gen_count; i++)
                pfx_send(fx, off_s, an->gen_notes[i], 0);
            /* rebuild this note's gen from its orig pitch p (NOTE FX) +
             * new conductor offset */
            int is_sa = inst->scale_aware &&
                        (tr->pad_mode == PAD_MODE_MELODIC_SCALE);
            uint8_t gen[MAX_GEN_NOTES];
            int gc = pfx_build_gen_notes(inst, is_sa, fx, p, gen);
            conductor_transpose_gen(inst, t, gen, gc);
            /* on the NEW transposed gen at the note's original velocity */
            for (i = 0; i < gc; i++)
                pfx_send(fx, on_s, gen[i], an->orig_velocity);
            /* update the record so the eventual gate-off matches the new pitch */
            an->gen_count = gc;
            memcpy(an->gen_notes, gen, (size_t)gc);
        }
    }
}

/* Process a note-off. Sends/queues note-offs for harmony copies and all
 * delay repeat echoes. Echoes never re-enter the chain. SEQ ARP captures
 * each emitted note-off via pfx_send, mirroring the note-on flow. */
static void pfx_note_off(seq8_instance_t *inst, seq8_track_t *tr,
                         uint8_t orig_note) {
    play_fx_t   *fx  = &tr->pfx;
    pfx_active_t *an = &fx->active_notes[orig_note];

    /* Conductor release: drop the live offset when the last held note ends. */
    if ((int)(tr - inst->tracks) == inst->conductor_track &&
            tr->pad_mode == PAD_MODE_CONDUCT) {
        if (inst->conductor_held > 0) inst->conductor_held--;
        /* CdLk Lock (sample-and-hold): keep the offset held through the gap;
         * only the next conductor note-on overwrites it. Off = gate-hold:
         * clear at held==0 (original behavior). Mute still snaps to zero
         * unconditionally (per-tick safety in render_block). */
        if (inst->conductor_held == 0 &&
                !tr->clips[tr->active_clip].cond_lock)
            conductor_clear_offset(inst);
    }

    if (!an->active) return;

    uint64_t now      = fx->sample_counter;
    uint64_t gate_smp = an->gate_override_smp ? an->gate_override_smp
                                              : pfx_gate_smp(inst, tr);
    uint64_t off_time = an->on_time + gate_smp;
    uint8_t  off_s    = (uint8_t)(0x80 | an->channel);

    int i;
    for (i = 0; i < an->gen_count; i++) {
        if (off_time <= now) {
            pfx_send(fx, off_s, an->gen_notes[i], 0);
        } else {
            uint64_t ft = off_time + swing_offset_for_fire_at(g_inst, now, off_time);
            pfx_q_insert(fx, ft, off_s, an->gen_notes[i], 0, 0);
        }
    }

    pfx_sched_delay_offs(fx, an, an->on_time, gate_smp);
    an->active = 0;
}

/* Immediate note-off for live pad releases — bypasses gate_smp minimum.
 * gate_smp is a sequencer concept (note rings for its step duration); pads
 * should stop the moment the finger lifts regardless of how long gate_time is. */
static void pfx_note_off_imm(seq8_instance_t *inst, seq8_track_t *tr,
                              uint8_t orig_note) {
    play_fx_t   *fx  = &tr->pfx;
    pfx_active_t *an = &fx->active_notes[orig_note];

    /* Conductor release: drop the live offset when the last held note ends. */
    if ((int)(tr - inst->tracks) == inst->conductor_track &&
            tr->pad_mode == PAD_MODE_CONDUCT) {
        if (inst->conductor_held > 0) inst->conductor_held--;
        /* CdLk Lock (sample-and-hold): keep the offset held through the gap;
         * only the next conductor note-on overwrites it. Off = gate-hold:
         * clear at held==0 (original behavior). Mute still snaps to zero
         * unconditionally (per-tick safety in render_block). */
        if (inst->conductor_held == 0 &&
                !tr->clips[tr->active_clip].cond_lock)
            conductor_clear_offset(inst);
    }

    if (!an->active) return;

    uint64_t now     = fx->sample_counter;
    uint8_t  off_s   = (uint8_t)(0x80 | an->channel);

    int i;
    for (i = 0; i < an->gen_count; i++)
        pfx_send(fx, off_s, an->gen_notes[i], 0);

    pfx_sched_delay_offs(fx, an, an->on_time, pfx_gate_smp(inst, tr));
    an->active = 0;
    (void)now;
}

/* LOAD-BEARING SPACING: the spacing around these cold-path includes is part of
 * the phase-3 re-runnable gate — the split is proven by the preprocessed TU
 * being byte-identical pre/post (`clang -E -P`). The two includes are back-to-
 * back (NO blank between them, like the phase-2 bake/convert pair); adding one
 * shifts the -E -P output. Do not tidy. */
#include "seq8_drum.c"
#include "seq8_arp.c"

/* ------------------------------------------------------------------ */
/* TRACK ARP engine (per-track, live-input first stage)               */
/* ------------------------------------------------------------------ */

static void tarp_init_defaults(seq8_track_t *tr) {
    tr->tarp_on    = 0;
    tr->tarp_latch = 0;
    tr->tarp_sync  = 1;
    arp_init_defaults(&tr->tarp);
    tr->tarp.style     = 0; /* 0=Off; style drives tarp_on */
    tr->tarp.retrigger = 0; /* TARP default off; arp_init_defaults sets 1 */
}

static void drum_repeat_init_defaults(seq8_track_t *tr) {
    int l, s;
    for (l = 0; l < DRUM_LANES; l++) {
        tr->drum_repeat_gate[l]      = 0xFF;
        tr->drum_repeat_gate_len[l]  = 8;
        tr->drum_repeat2_rate_idx[l] = 2; /* 1/8 default */
        for (s = 0; s < 8; s++) {
            tr->drum_repeat_vel_scale[l][s] = 255;   /* Thru */
            tr->drum_repeat_nudge[l][s]     = 0;
        }
    }
}

/* Silence TRACK ARP sounding note (via immediate note-off through the chain)
 * and reset runtime state. */
static void tarp_silence(seq8_instance_t *inst, seq8_track_t *tr) {
    arp_engine_t *a = &tr->tarp;
    if (a->sounding_active) {
        pfx_note_off_imm(inst, tr, a->sounding_pitch);
        a->sounding_active = 0;
    }
    if (tr->tarp_latch) {
        /* Preserve held buffer so TARP resumes on next transport start */
        a->sounding_pitch     = 0;
        a->gate_remaining     = 0;
        a->ticks_until_next   = 0;
        a->pending_first_note = 0;
        a->pending_retrigger  = 0;
        a->master_anchor      = 0;
    } else {
        arp_clear_runtime(a);
        tr->tarp_physical = 0;
    }
}

/* Drop latched (non-physical) entries from TARP held buffer. If nothing is
 * physically held afterward, fall through to full silence. Used by both
 * tarp_latch=0 and the explicit tarp_clear_latched user shortcut. */
static void tarp_drop_latched(seq8_instance_t *inst, seq8_track_t *tr) {
    arp_engine_t *a = &tr->tarp;
    int w = 0, r;
    for (r = 0; r < a->held_count; r++) {
        if (a->held_physical[r]) {
            if (w != r) {
                a->held_pitch[w]    = a->held_pitch[r];
                a->held_vel[w]      = a->held_vel[r];
                a->held_order[w]    = a->held_order[r];
                a->held_physical[w] = a->held_physical[r];
            }
            w++;
        }
    }
    for (r = w; r < a->held_count; r++) {
        a->held_pitch[r]    = 0;
        a->held_vel[r]      = 0;
        a->held_order[r]    = 0;
        a->held_physical[r] = 0;
    }
    a->held_count = (uint8_t)w;

    if (a->held_count == 0) {
        /* No physical pads → full silence via tarp_silence; with latch=1 the
         * tarp_silence branch resets runtime but keeps the (now empty) buffer
         * so the engine sits idle until the user plays a new chord. */
        tarp_silence(inst, tr);
    } else {
        /* Physical pads remain → silence current sounding note;
         * tarp_tick re-fires from the compacted buffer next tick. */
        if (a->sounding_active) {
            pfx_note_off_imm(inst, tr, a->sounding_pitch);
            a->sounding_active = 0;
        }
        a->sounding_pitch     = 0;
        a->gate_remaining     = 0;
        a->ticks_until_next   = 0;
        a->pending_first_note = 1;
        a->pending_retrigger  = 0;
        a->master_anchor      = 0;
        a->cyc_pos            = 0;
        a->cycle_step_count   = 0;
        a->random_used        = 0;
    }
}

/* Resolve effective input velocity for a track.
 * 0=Live (pass raw), 1-127=fixed absolute. */
static int effective_vel(seq8_track_t *tr, int raw_vel) {
    if (tr->track_vel_override > 0) return (int)tr->track_vel_override;
    return raw_vel;
}

/* Phase 1 / Bundle 2C: Rpt1 engine entry points, extracted from the
 * tN_drum_repeat_{start,stop,lane} set_param handlers so on_midi's
 * drum_pad_event can drive the engine directly on the audio thread.
 * Both paths (set_param + on_midi) share these so behavior stays in
 * one place. Stock Schwung reaches them via the set_param handlers
 * (JS still pushes those keys on stock); patched Schwung reaches them
 * via on_midi (JS pushes are PHASE-1-gated dead).
 *
 * `drum_repeat_latched` bit lifecycle (read by drum_pad_event for
 * unlatch-tap detection):
 *   SET    by JS edge push tN_drum_repeat_latched 1 on Loop-held start
 *   CLEAR  by drum_repeat_stop_internal (engine off → bit must drop)
 *   NEVER  touched inside drum_repeat_start_internal — host drains
 *          set_params before on_midi, so the latched=1 from THIS press
 *          would already be in tr->drum_repeat_latched at entry; a
 *          defensive clear would stomp it. JS is authoritative: pushes
 *          0 OR 1 on every rate-pad press (`if (loopHeld) push 1 else push 0`).
 * drum_repeat_tick contains an invariant check that warns if
 * latched=1 with active=0 && pending=0 (phantom latch). */
static void drum_repeat_start_internal(seq8_instance_t *inst, seq8_track_t *tr,
                                       int lane, int rate_idx, int vel) {
    lane     = clamp_i(lane,     0, DRUM_LANES - 1);
    rate_idx = clamp_i(rate_idx, 0, 7);
    vel      = clamp_i(vel,      1, 127);
    tr->drum_repeat_lane     = (uint8_t)lane;
    tr->drum_repeat_rate_idx = (uint8_t)rate_idx;
    tr->drum_repeat_vel      = (uint8_t)vel;
    tr->drum_repeat_step     = 0;
    tr->drum_repeat_phase    = 0;
    /* Latched bit: do NOT touch here — see header comment on this
     * function for the full lifecycle contract. */
    tr->drum_repeat_active   = 1;
    /* Repeat Sync: when on, first fire snaps to the next rate-grid boundary
     * on arp_master_tick. arp_master_tick free-runs across playing/stopped/
     * count-in (resets at transport play and count-in fire), so the snap
     * works in every transport state. Strict-next, not round-to-nearest:
     * a press at tick T where T % rate_ticks != 0 ALWAYS waits for the next
     * T' where T' % rate_ticks == 0. */
    {
        if (tr->drum_repeat_sync) {
            uint16_t rate_ticks = DRUM_REPEAT_RATE_TICKS[rate_idx];
            if (inst->arp_master_tick % (uint32_t)rate_ticks == 0) {
                tr->drum_repeat_pending = 0;  /* on boundary — fire on next tick */
            } else {
                tr->drum_repeat_pending = 1;  /* off boundary — wait */
            }
        } else {
            tr->drum_repeat_pending = 0;
        }
    }
}

static void drum_repeat_stop_internal(seq8_track_t *tr) {
    tr->drum_repeat_active  = 0;
    tr->drum_repeat_pending = 0;
    tr->drum_repeat_latched = 0;
}

static void drum_repeat_lane_internal(seq8_track_t *tr, int lane) {
    tr->drum_repeat_lane = (uint8_t)clamp_i(lane, 0, DRUM_LANES - 1);
}

/* Phase 1 / Bundle 2C-Rpt2: Rpt2 engine entry points + pad-to-lane helper.
 * Same extract-from-set_param-handler pattern as Rpt1.
 *
 * `drum_repeat2_latched_lanes` bit lifecycle (read by drum_pad_event
 * for unlatch-tap detection per-lane):
 *   SET    by JS edge push, one of:
 *            - tN_drum_repeat2_lane_latched <lane> 1  (single lane edge)
 *            - tN_drum_repeat2_latch_held             (atomic, ORs
 *              active|pending into latched in one set_param)
 *          Use the atomic form when multiple lanes may engage in one
 *          buffer (Loop-pressed → multi-pad press, or Loop-tap while
 *          multiple pads held); the per-lane edge form coalesces (same
 *          key, different args → last write wins).
 *   CLEAR  by drum_repeat2_lane_off_internal (per-lane) or
 *          tN_drum_repeat2_stop handler (all lanes on engine stop).
 *   NEVER  touched inside drum_repeat2_lane_on_internal — same reason
 *          as Rpt1: host drains set_params before on_midi, so JS's edge
 *          push has already landed at entry; a clear would stomp it.
 *          JS is authoritative.
 * drum_repeat2_tick contains an invariant check that warns if
 * latched_lanes has bits not in (active | pending). */
static inline int drum_pad_to_lane(int padIdx, uint8_t drum_lane_page) {
    int col = padIdx % 8;
    if (col >= 4) return -1;
    int row = padIdx / 8;
    return (int)drum_lane_page * 16 + row * 4 + col;
}

static void drum_repeat2_lane_on_internal(seq8_instance_t *inst, seq8_track_t *tr,
                                          int lane, int vel) {
    lane = clamp_i(lane, 0, DRUM_LANES - 1);
    vel  = clamp_i(vel,  1, 127);
    tr->drum_repeat2_vel[lane]   = (uint8_t)vel;
    tr->drum_repeat2_phase[lane] = 0;
    tr->drum_repeat2_step[lane]  = 0;
    /* Latched bit: do NOT touch here — see header comment on
     * drum_pad_to_lane for the full lifecycle contract. */
    /* Repeat Sync: strict-next snap on per-lane rate. See drum_repeat_start_internal. */
    {
        if (tr->drum_repeat_sync) {
            uint16_t rate_ticks = DRUM_REPEAT_RATE_TICKS[tr->drum_repeat2_rate_idx[lane]];
            if (inst->arp_master_tick % (uint32_t)rate_ticks == 0) {
                tr->drum_repeat2_pending &= ~(1u << (unsigned)lane);
                tr->drum_repeat2_active  |=  (1u << (unsigned)lane);
            } else {
                tr->drum_repeat2_pending |=  (1u << (unsigned)lane);
                tr->drum_repeat2_active  &= ~(1u << (unsigned)lane);
            }
        } else {
            tr->drum_repeat2_pending &= ~(1u << (unsigned)lane);
            tr->drum_repeat2_active  |=  (1u << (unsigned)lane);
        }
    }
}

static void drum_repeat2_lane_off_internal(seq8_track_t *tr, int lane) {
    lane = clamp_i(lane, 0, DRUM_LANES - 1);
    /* Clear from both bitmasks — pending too, or an InQ-pending lane
     * unlatched before fire would ghost-fire at next boundary crossing. */
    tr->drum_repeat2_active        &= ~(1u << (unsigned)lane);
    tr->drum_repeat2_pending       &= ~(1u << (unsigned)lane);
    tr->drum_repeat2_latched_lanes &= ~(1u << (unsigned)lane);
}

static void drum_repeat2_rate_internal(seq8_track_t *tr, int lane, int rate_idx) {
    lane     = clamp_i(lane,     0, DRUM_LANES - 1);
    rate_idx = clamp_i(rate_idx, 0, 7);
    tr->drum_repeat2_rate_idx[lane] = (uint8_t)rate_idx;
    if (tr->drum_repeat2_active & (1u << (unsigned)lane)) {
        uint16_t new_rate = DRUM_REPEAT_RATE_TICKS[rate_idx];
        if (tr->drum_repeat2_phase[lane] >= (uint32_t)new_rate)
            tr->drum_repeat2_phase[lane] = 0;
    }
}

/* Fire the drum repeat note for the current step if conditions are met.
 * Called each render tick for drum tracks with repeat active.
 * Check-then-advance order: fires at phase==fire_at, then phase wraps to 0 and
 * step increments, so the first fire happens immediately on the tick after activation. */
static void drum_repeat_tick(seq8_instance_t *inst, seq8_track_t *tr) {
    /* Phase 1 / Bundle 2C invariant: latched implies (active || pending).
     * A phantom latch (latched=1 without an engine running) would make
     * drum_pad_event's unlatch-tap branch fire stop() against a stopped
     * engine — harmless but signals a JS/DSP lifecycle bug. Logged once
     * per ~200-block burst across all tracks to avoid log spam. */
#if SEQ8_DEBUG_PROBES
    if (tr->drum_repeat_latched && !tr->drum_repeat_active && !tr->drum_repeat_pending) {
        static uint32_t s_last_warn_block = 0;
        if (inst->block_count - s_last_warn_block > 200) {
            char dbg[96];
            snprintf(dbg, sizeof(dbg),
                "[repeat-invariant] Rpt1 latched=1 active=0 pending=0 (block=%u)",
                (unsigned)inst->block_count);
            seq8_ilog(inst, dbg);
            s_last_warn_block = inst->block_count;
        }
    }
#endif
    if (!tr->drum_repeat_active || tr->pad_mode != PAD_MODE_DRUM) return;
    /* Mute gate: skip emission for *latched* (no current pad hold) repeats.
     * Currently-held pad repeats bypass mute to match live-monitor semantics
     * (a held pad is monitoring through the chain, mute or not). Bypassed
     * during count-in so live input is always audible. */
    if (inst->count_in_ticks == 0 && tr->drum_repeat_latched
            && effective_mute(inst, (int)(tr - inst->tracks))) return;
    /* Repeat Sync pending: wait for next rate-grid boundary on arp_master_tick. */
    if (tr->drum_repeat_pending) {
        uint16_t rate_ticks = DRUM_REPEAT_RATE_TICKS[tr->drum_repeat_rate_idx];
        if (inst->arp_master_tick % (uint32_t)rate_ticks != 0) return;
        tr->drum_repeat_pending = 0;
        tr->drum_repeat_step    = 0;
        tr->drum_repeat_phase   = 0;
    }
    uint8_t  lane = tr->drum_repeat_lane;
    uint8_t  step = tr->drum_repeat_step;
    uint16_t rate = DRUM_REPEAT_RATE_TICKS[tr->drum_repeat_rate_idx];

    /* Determine fire time within this step (nudge shifts ±50% from step start) */
    int nudge_ticks = (int)(int8_t)tr->drum_repeat_nudge[lane][step] * (int)rate / 100;
    int fire_at = nudge_ticks >= 0 ? nudge_ticks : (int)rate + nudge_ticks;

    if ((int)tr->drum_repeat_phase == fire_at) {
        if (tr->drum_repeat_gate[lane] & (uint8_t)(1u << step)) {
            /* Absolute per-step velocity; Thru (255, the default) passes the
             * held-pad velocity (incl. VelIn) through. */
            int vel = (int)tr->drum_repeat_vel_scale[lane][step];
            if (vel > 127) vel = effective_vel(tr, (int)tr->drum_repeat_vel);
            if (vel < 1) vel = 1;
            if (vel > 127) vel = 127;

            drum_lane_t *dlane = &tr->drum_clips[tr->active_clip]->lanes[lane];
            uint8_t pitch = dlane->midi_note;

            /* Cancel pending note-off for this pitch if still open */
            { int pp;
              for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                  if (tr->play_pending[pp].pitch == pitch) {
                      drum_pfx_note_off(inst, tr, &tr->drum_lane_pfx[lane], pitch);
                      tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                      tr->play_pending_count--;
                      break;
                  }
              }
            }
            drum_pfx_note_on(inst, tr, &tr->drum_lane_pfx[lane], pitch, (uint8_t)vel);
            /* Record into sequencer if armed.
             * First fire on a new lane-step this pass: write-once-across-passes
             * (existing semantic). Subsequent fires on the same lane-step
             * (sub-step repeats, rate finer than lane TPS) accumulate notes
             * with their own sub-step offsets — InQ Off only, since InQ On
             * snaps every fire to offset 0 and stacking duplicates is
             * degenerate. */
            if (tr->recording) {
                int ac = (int)tr->active_clip;
                clip_t *rlc = &tr->drum_clips[ac]->lanes[lane].clip;
                uint16_t rs = tr->drum_current_step[lane];
                if (rs < rlc->length) {
                    int16_t off = (int16_t)tr->drum_tick_in_step[lane];
                    if (off >= (int16_t)(TICKS_PER_STEP / 2)) {
                        rs = (rs + 1) % rlc->length;
                        off -= (int16_t)TICKS_PER_STEP;
                    }
                    /* Sub-feature 3: preserve actual sub-step offset; stack regardless of InQ.
                     * Reader (note_step, clip_build_steps_from_notes) handles sub-step notes
                     * via midpoint rounding — symmetric write/read invariant per dsp/CLAUDE.md. */
                    int new_step_this_pass = (tr->drum_last_rec_step[lane] != (int16_t)rs);
                    int can_write = 0;
                    if (new_step_this_pass) {
                        can_write = (rlc->step_note_count[rs] == 0);
                        tr->drum_last_rec_step[lane] = (int16_t)rs;
                    } else {
                        can_write = (rlc->step_note_count[rs] < 8);
                    }
                    if (can_write) {
                        int slot = (int)rlc->step_note_count[rs];
                        rlc->step_notes[rs][slot]       = pitch;
                        rlc->note_tick_offset[rs][slot] = off;
                        if (slot == 0) {
                            rlc->step_vel[rs]  = (uint8_t)vel;
                            rlc->step_gate[rs] = (uint16_t)GATE_TICKS;
                        }
                        rlc->step_note_count[rs]++;
                        rlc->steps[rs] = 1;
                        rlc->active   = 1;
                        clip_migrate_to_notes(rlc);
                    }
                }
            }
            /* Schedule note-off: half the step interval */
            uint16_t gate = rate / 2;
            if (gate < 1) gate = 1;
            if (tr->play_pending_count < 32) {
                tr->play_pending[tr->play_pending_count].pitch            = pitch;
                tr->play_pending[tr->play_pending_count].src_pitch        = pitch;
                tr->play_pending[tr->play_pending_count].ticks_remaining  = gate;
                tr->play_pending[tr->play_pending_count].lane_idx         = lane;
                tr->play_pending_count++;
                tr->note_active = 1;
            }
        }
    }

    /* Advance phase; wrap and advance step at end of period */
    tr->drum_repeat_phase++;
    if (tr->drum_repeat_phase >= (uint32_t)rate) {
        tr->drum_repeat_phase = 0;
        tr->drum_repeat_step  = (tr->drum_repeat_step + 1) % tr->drum_repeat_gate_len[lane];
    }
}

/* Rpt 2 repeat tick — fires all held lanes at independent per-lane rates.
 * Each lane has its own rate_idx, phase, step, nudge, gate, vel_scale. */
static void drum_repeat2_tick(seq8_instance_t *inst, seq8_track_t *tr) {
    /* Phase 1 / Bundle 2C-Rpt2 invariant: every bit in latched_lanes
     * must also be in (active | pending). Phantom latches signal a
     * JS/DSP lifecycle bug. Rate-limited to one warn per ~200 blocks. */
#if SEQ8_DEBUG_PROBES
    {
        uint32_t phantom = tr->drum_repeat2_latched_lanes &
                          ~(tr->drum_repeat2_active | tr->drum_repeat2_pending);
        if (phantom) {
            static uint32_t s_last_warn_block = 0;
            if (inst->block_count - s_last_warn_block > 200) {
                char dbg[128];
                snprintf(dbg, sizeof(dbg),
                    "[repeat-invariant] Rpt2 phantom latched=0x%x latched=0x%x active=0x%x pending=0x%x",
                    (unsigned)phantom, (unsigned)tr->drum_repeat2_latched_lanes,
                    (unsigned)tr->drum_repeat2_active, (unsigned)tr->drum_repeat2_pending);
                seq8_ilog(inst, dbg);
                s_last_warn_block = inst->block_count;
            }
        }
    }
#endif
    if (!(tr->drum_repeat2_active | tr->drum_repeat2_pending) || tr->pad_mode != PAD_MODE_DRUM) return;
    /* Mute gate is now per-lane below: latched lanes respect mute, currently-held
     * lanes (active without the latched bit) bypass mute to match live-monitor
     * semantics. Bypassed during count-in so live input is always audible. */
    int _track_muted = (inst->count_in_ticks == 0)
                       && effective_mute(inst, (int)(tr - inst->tracks));
    /* Resolve any lanes pending repeat-rate boundary. Each lane has its own
     * rate; activate per-lane when its rate divides arp_master_tick. */
    if (tr->drum_repeat2_pending) {
        int pl; for (pl = 0; pl < DRUM_LANES; pl++) {
            if (!(tr->drum_repeat2_pending & (1u << (unsigned)pl))) continue;
            uint16_t rate_ticks = DRUM_REPEAT_RATE_TICKS[tr->drum_repeat2_rate_idx[pl]];
            if (inst->arp_master_tick % (uint32_t)rate_ticks == 0) {
                tr->drum_repeat2_phase[pl] = 0;
                tr->drum_repeat2_step[pl]  = 0;
                tr->drum_repeat2_active   |= (1u << (unsigned)pl);
                tr->drum_repeat2_pending  &= ~(1u << (unsigned)pl);
            }
        }
    }
    if (!tr->drum_repeat2_active) return;
    int l;
    for (l = 0; l < DRUM_LANES; l++) {
        if (!(tr->drum_repeat2_active & (1u << (unsigned)l))) continue;
        /* Per-lane mute gate: latched lanes go silent under mute; currently-
         * held lanes fire through. A "latched" lane has its bit set in
         * drum_repeat2_latched_lanes; without the latched bit the lane is
         * actively being held by the player. */
        if (_track_muted && (tr->drum_repeat2_latched_lanes & (1u << (unsigned)l)))
            goto advance_l;
        uint8_t  step = tr->drum_repeat2_step[l];
        uint16_t rate = DRUM_REPEAT_RATE_TICKS[tr->drum_repeat2_rate_idx[l]];
        int nudge_ticks = (int)(int8_t)tr->drum_repeat_nudge[l][step] * (int)rate / 100;
        int fire_at     = nudge_ticks >= 0 ? nudge_ticks : (int)rate + nudge_ticks;
        if ((int)tr->drum_repeat2_phase[l] != fire_at) goto advance_l;
        if (!(tr->drum_repeat_gate[l] & (uint8_t)(1u << step))) goto advance_l;
        {
            /* Absolute per-step velocity, Thru = held-pad vel — same rule as Rpt1. */
            int vel = (int)tr->drum_repeat_vel_scale[l][step];
            if (vel > 127) vel = effective_vel(tr, (int)tr->drum_repeat2_vel[l]);
            if (vel < 1) vel = 1;
            if (vel > 127) vel = 127;
            drum_lane_t *dlane = &tr->drum_clips[tr->active_clip]->lanes[l];
            uint8_t pitch = dlane->midi_note;
            { int pp;
              for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
                  if (tr->play_pending[pp].pitch == pitch) {
                      drum_pfx_note_off(inst, tr, &tr->drum_lane_pfx[l], pitch);
                      tr->play_pending[pp] = tr->play_pending[tr->play_pending_count - 1];
                      tr->play_pending_count--;
                      break;
                  }
              }
            }
            drum_pfx_note_on(inst, tr, &tr->drum_lane_pfx[l], pitch, (uint8_t)vel);
            if (tr->recording) {
                int ac = (int)tr->active_clip;
                clip_t *rlc = &tr->drum_clips[ac]->lanes[l].clip;
                uint16_t rs = tr->drum_current_step[l];
                if (rs < rlc->length) {
                    int16_t off = (int16_t)tr->drum_tick_in_step[l];
                    if (off >= (int16_t)(TICKS_PER_STEP / 2)) {
                        rs = (rs + 1) % rlc->length;
                        off -= (int16_t)TICKS_PER_STEP;
                    }
                    /* Sub-feature 3: preserve actual sub-step offset; stack regardless of InQ. */
                    int new_step_this_pass = (tr->drum_last_rec_step[l] != (int16_t)rs);
                    int can_write = 0;
                    if (new_step_this_pass) {
                        can_write = (rlc->step_note_count[rs] == 0);
                        tr->drum_last_rec_step[l] = (int16_t)rs;
                    } else {
                        can_write = (rlc->step_note_count[rs] < 8);
                    }
                    if (can_write) {
                        int slot = (int)rlc->step_note_count[rs];
                        rlc->step_notes[rs][slot]       = pitch;
                        rlc->note_tick_offset[rs][slot] = off;
                        if (slot == 0) {
                            rlc->step_vel[rs]  = (uint8_t)vel;
                            rlc->step_gate[rs] = (uint16_t)GATE_TICKS;
                        }
                        rlc->step_note_count[rs]++;
                        rlc->steps[rs] = 1;
                        rlc->active   = 1;
                        clip_migrate_to_notes(rlc);
                    }
                }
            }
            uint16_t gate = rate / 2;
            if (gate < 1) gate = 1;
            if (tr->play_pending_count < 32) {
                tr->play_pending[tr->play_pending_count].pitch           = pitch;
                tr->play_pending[tr->play_pending_count].src_pitch       = pitch;
                tr->play_pending[tr->play_pending_count].ticks_remaining = gate;
                tr->play_pending[tr->play_pending_count].lane_idx        = (uint8_t)l;
                tr->play_pending_count++;
                tr->note_active = 1;
            }
        }
advance_l:
        tr->drum_repeat2_phase[l]++;
        if (tr->drum_repeat2_phase[l] >= (uint32_t)rate) {
            tr->drum_repeat2_phase[l] = 0;
            tr->drum_repeat2_step[l]  = (tr->drum_repeat2_step[l] + 1) % tr->drum_repeat_gate_len[l];
        }
    }
}

/* Intercept wrapper for live note-on. Routes through TRACK ARP when enabled;
 * bypasses TRACK ARP (→ pfx_note_on directly) for drum tracks or when off. */
static void live_note_on(seq8_instance_t *inst, seq8_track_t *tr,
                         uint8_t pitch, uint8_t vel) {
    if (tr->pad_mode == PAD_MODE_DRUM) {
        /* Defense-in-depth: the active drum clip can transiently be NULL (the
         * documented window between pad_mode being set and drum_clips being
         * allocated; see dsp/CLAUDE.md render_block guard). Drop the pad hit
         * rather than deref NULL. The alloc invariant is also enforced at the
         * copy/cut/restore sources so this should not fire in practice. */
        drum_clip_t *dc = tr->drum_clips[tr->active_clip];
        if (!dc) return;
        for (int l = 0; l < DRUM_LANES; l++) {
            if (dc->lanes[l].midi_note == pitch) {
                inst->emit_bypass_swing = 1;
                drum_pfx_note_on(inst, tr, &tr->drum_lane_pfx[l], pitch, vel);
                inst->emit_bypass_swing = 0;
                return;
            }
        }
        return; /* no matching lane — drop silently */
    }
    if (!tr->tarp_on) {
        inst->emit_bypass_swing = 1;
        pfx_note_on(inst, tr, pitch, vel);
        inst->emit_bypass_swing = 0;
        return;
    }
    if (tr->tarp_latch && tr->tarp_physical == 0) {
        /* New chord gesture (first pad press after all pads released, latch on).
         * With retrigger on, replace the latched buffer entirely; with retrigger
         * off, silence the sounding note but keep the buffer (chord stacking). */
        arp_engine_t *a = &tr->tarp;
        if (a->retrigger) {
            uint8_t saved = tr->tarp_latch;
            tr->tarp_latch = 0;
            tarp_silence(inst, tr); /* arp_clear_runtime branch — buffer dropped */
            tr->tarp_latch = saved;
        } else {
            tarp_silence(inst, tr); /* preserve branch — buffer kept */
        }
    }
    /* Accumulate + latch: re-press of a latched-only note toggles it off
     * instead of the default duplicate no-op. Lets the user pluck individual
     * notes out of a latched chord without dropping the whole buffer. Gated
     * on retrigger=0 (with retrigger=1 the gesture block above already
     * replaced the buffer, so there's nothing meaningful to toggle) and
     * held_physical==0 (don't drop notes the user is actively holding). */
    if (tr->tarp_latch && !tr->tarp.retrigger) {
        arp_engine_t *a = &tr->tarp;
        int _i;
        for (_i = 0; _i < a->held_count; _i++) {
            if (a->held_pitch[_i] == pitch && !a->held_physical[_i]) {
                arp_remove_note(a, pitch);
                if (a->held_count == 0) tarp_silence(inst, tr);
                return;
            }
        }
    }
    arp_add_note(&tr->tarp, pitch, vel);
    /* Mark this pitch's slot as physically held so a later latch-off can
     * distinguish it from latched (released) entries. arp_add_note either
     * inserted a new slot at index held_count-1 or updated an existing slot
     * with this pitch — scan for the matching pitch to cover both. */
    {
        arp_engine_t *a = &tr->tarp;
        for (int i = 0; i < a->held_count; i++)
            if (a->held_pitch[i] == pitch) { a->held_physical[i] = 1; break; }
    }
    tr->tarp_physical++;
}

/* Intercept wrapper for live note-off. Removes from TRACK ARP held buffer;
 * when latch=0 and buffer empties, silences arp output. */
static void live_note_off(seq8_instance_t *inst, seq8_track_t *tr,
                          uint8_t pitch) {
    if (tr->pad_mode == PAD_MODE_DRUM) {
        inst->emit_bypass_swing = 1;
        drum_lane_note_off_imm(inst, tr, pitch);
        inst->emit_bypass_swing = 0;
        return;
    }
    if (!tr->tarp_on) {
        inst->emit_bypass_swing = 1;
        pfx_note_off_imm(inst, tr, pitch);
        inst->emit_bypass_swing = 0;
        return;
    }
    if (tr->tarp_physical > 0) tr->tarp_physical--;
    if (!tr->tarp_latch) {
        arp_remove_note(&tr->tarp, pitch);
        if (tr->tarp.held_count == 0)
            tarp_silence(inst, tr);
    } else {
        /* Latch on: pad released but buffer keeps the pitch. Mark non-physical
         * so a later latch-off knows to drop this entry. */
        arp_engine_t *a = &tr->tarp;
        for (int i = 0; i < a->held_count; i++)
            if (a->held_pitch[i] == pitch) { a->held_physical[i] = 0; break; }
    }
    /* Safety belt: if pfx chain has this pitch active (e.g., tarp toggled on
     * while pad was held), release it now. No-op if already inactive. */
    inst->emit_bypass_swing = 1;
    pfx_note_off_imm(inst, tr, pitch);
    inst->emit_bypass_swing = 0;
}

/* Fire one TRACK ARP step: silence prior sounding, emit next picked note
 * through pfx_note_on so it enters the full pfx chain (NOTE FX → HARMZ →
 * MIDI DLY → SEQ ARP). Mirror of arp_fire_step but emits via pfx chain. */
static void tarp_fire_step(seq8_instance_t *inst, seq8_track_t *tr) {
    arp_engine_t *a = &tr->tarp;
    play_fx_t   *fx = &tr->pfx;
    if (a->held_count == 0) return;
    /* Mute gate: silence latched/held TARP output without disturbing the
     * held buffer. silence_muted_tracks kills any sustaining note via
     * tarp_silence (latch-preserving). Unmute resumes mid-phrase.
     * Bypassed during count-in so live input is always audible. */
    if (inst->count_in_ticks == 0 && effective_mute(inst, (int)(tr - inst->tracks))) return;

    uint16_t rate = ARP_RATE_TICKS[a->rate_idx];
    if (rate == 0) rate = 24;

    uint32_t master_pos = inst->arp_master_tick - a->master_anchor;
    uint8_t loop_len = a->step_loop_len ? a->step_loop_len : 8;
    if (loop_len > 8) loop_len = 8;
    int step_idx = (int)((master_pos / rate) % loop_len);
    a->step_pos = (uint8_t)step_idx;

    uint8_t level = a->step_vel[step_idx];
    if (a->steps_mode == 0) level = 255;   /* Off mode: treat as Thru */
    int step_off = (a->steps_mode != 0) && (level == 0);

    if (step_off && a->steps_mode == 2) {
        a->ticks_until_next = (int32_t)rate;
        return;
    }

    if (a->sounding_active) {
        pfx_note_off_imm(inst, tr, a->sounding_pitch);
        a->sounding_active = 0;
    }

    if (step_off) {
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

    /* Per-step scale-degree offset (Arp Steps interval bank). */
    if (a->step_int[step_idx])
        pitch = (uint8_t)scale_transpose(inst, (int)pitch, (int)a->step_int[step_idx]);

    /* ABSOLUTE step velocity, Thru (255) = incoming — mirrors arp_fire_step. */
    int v = (int)base_vel;
    if (a->steps_mode != 0 && level >= 1 && level <= 127)
        v = (int)level;
    if (v < 1)   v = 1;
    if (v > 127) v = 127;

    /* Emit through pfx chain (NOTE FX → HARMZ → MIDI DLY → SEQ ARP). */
    pfx_note_on(inst, tr, pitch, (uint8_t)v);

    /* Replay the last poly-AT pressure onto the new voice (see arp_fire_step
     * comment). Only when SEQ ARP isn't downstream — when it is, SEQ ARP
     * captures this note into its held buffer and emits its own voice
     * separately, which arp_fire_step replays AT onto itself. */
    if (fx->arp.style == 0 && tr->last_poly_at_press > 0) {
        pfx_send(fx, (uint8_t)(0xA0 | tr->channel),
                 pitch, tr->last_poly_at_press);
    }

    a->sounding_pitch  = pitch;
    a->sounding_active = 1;

    a->ticks_until_next = (int32_t)rate;
    uint32_t gate = ((uint32_t)rate * (uint32_t)a->gate_pct) / 100U;
    if (gate < 1)     gate = 1;
    if (gate >= rate) gate = (uint32_t)rate - 1;
    a->gate_remaining = gate;

    /* Record arp output into clip when recording. Also capture during the
     * last 1/8 note of count-in for sync=off tracks: arp fires immediately
     * on press in free mode, so late-window fires represent the chord the
     * user wants to record on step 0. sync=on doesn't need this — it aligns
     * to the rate grid and the first post-fire fire lands cleanly on step 0
     * via the current_clip_tick prime in the count-in fire branch. */
    int _is_preroll = (!tr->recording && inst->count_in_ticks > 0 &&
                       inst->count_in_ticks <= (int32_t)(PPQN / 2) &&
                       (int)inst->count_in_track == (int)(tr - inst->tracks) &&
                       !tr->tarp_sync);
    if (tr->recording || _is_preroll) {
        clip_t  *cl         = &tr->clips[tr->active_clip];
        uint16_t tps        = cl->ticks_per_step;
        uint32_t clip_ticks = (uint32_t)cl->length * tps;
        if (clip_ticks > 0) {
            /* Window-anchored — see record_note_on in seq8_set_param.c.
             * Preroll: synthetic tick at loop window start. */
            uint32_t abs_tick = _is_preroll
                ? (uint32_t)cl->loop_start * tps
                : tr->current_clip_tick;
            if (inst->inp_quant)
                abs_tick = ((abs_tick + tps / 2) / tps) * tps;
            uint16_t gticks = (uint16_t)(gate > 65535u ? 65535u : gate);
            int rni = clip_insert_note(cl, abs_tick, gticks, pitch, (uint8_t)v);
            if (rni >= 0) {
                cl->notes[rni].suppress_until_wrap = 1;
                /* Round sidx via note_step() so the mirror agrees with the
                 * _steps reader (which also rounds). Truncation here would
                 * put sub-step notes on a different step than the LED shows. */
                uint16_t sidx = note_step(abs_tick, cl->length, tps);
                int16_t  off  = (int16_t)((int32_t)abs_tick - (int32_t)sidx * tps);
                if (sidx < SEQ_STEPS) {
                    if (!cl->steps[sidx] && cl->step_note_count[sidx] > 0) {
                        int si;
                        for (si = 0; si < 8; si++) {
                            cl->step_notes[sidx][si]        = 0;
                            cl->note_tick_offset[sidx][si]  = 0;
                        }
                        cl->step_note_count[sidx] = 0;
                        cl->step_vel[sidx]  = (uint8_t)SEQ_VEL;
                        cl->step_gate[sidx] = gticks;
                    }
                    if (cl->step_note_count[sidx] < 8) {
                        int ni2 = (int)cl->step_note_count[sidx];
                        if (ni2 == 0) {
                            cl->step_vel[sidx]  = (uint8_t)v;
                            cl->step_gate[sidx] = gticks;
                        }
                        cl->step_notes[sidx][ni2]       = pitch;
                        cl->note_tick_offset[sidx][ni2] = off;
                        cl->step_note_count[sidx]++;
                        cl->steps[sidx] = 1;
                        cl->active      = 1;
                        LRS_SET(tr, sidx);
                    }
                }
            }
        }
    }

    a->cycle_step_count++;
    a->fire_count++;
}

/* Per master tick — called alongside arp_tick from render_block. */
static void tarp_tick(seq8_instance_t *inst, seq8_track_t *tr) {
    arp_engine_t *a = &tr->tarp;
    if (!tr->tarp_on || a->style == 0) return;
    if (tr->pad_mode == PAD_MODE_DRUM) return;

    if (a->pending_retrigger) {
        a->pending_retrigger = 0;
        arp_retrigger(a, inst->arp_master_tick);
    }

    if (a->sounding_active && a->gate_remaining > 0) {
        a->gate_remaining--;
        if (a->gate_remaining == 0) {
            pfx_note_off_imm(inst, tr, a->sounding_pitch);
            a->sounding_active = 0;
        }
    }

    if (a->held_count == 0) return;

    if (a->pending_first_note) {
        uint16_t rate = ARP_RATE_TICKS[a->rate_idx];
        if (rate == 0) rate = 24;
        if (tr->tarp_sync) {
            if ((inst->arp_master_tick % rate) == 0) {
                a->master_anchor      = inst->arp_master_tick;
                a->pending_first_note = 0;
                tarp_fire_step(inst, tr);
            }
        } else {
            uint32_t total = inst->arp_master_tick - a->master_anchor;
            if ((total % rate) == 0) {
                a->pending_first_note = 0;
                tarp_fire_step(inst, tr);
            }
        }
        return;
    }

    if (a->ticks_until_next > 0) a->ticks_until_next--;
    if (a->ticks_until_next <= 0) tarp_fire_step(inst, tr);
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
    p->octaver         = 0;
    p->harmonize_1     = 0;
    p->harmonize_2     = 0;
    p->harmonize_3     = 0;
    p->delay_time_idx  = DEFAULT_DELAY_TIME_IDX;
    p->delay_level     = 127;
    p->repeat_times    = 0;
    p->fb_velocity     = 0;
    p->fb_note         = 0;
    p->fb_note_random      = 0;
    p->fb_note_random_mode = 2;  /* default Walk */
    p->fb_gate_time    = 0;
    p->fb_clock        = 0;
    p->delay_retrig    = 1;
    p->note_random      = 0;
    p->note_random_mode = 2;     /* default Walk */
    p->seq_arp_style     = 0;
    p->seq_arp_rate      = ARP_RATE_DEFAULT;
    p->seq_arp_octaves   = 0;
    p->seq_arp_gate      = 100;
    p->seq_arp_steps_mode = 1;
    p->seq_arp_retrigger = 1;
    p->seq_arp_sync      = 1;
    int i;
    for (i = 0; i < 8; i++) p->seq_arp_step_vel[i] = 255;   /* Thru */
    for (i = 0; i < 8; i++) p->seq_arp_step_int[i] = 0;
    p->seq_arp_step_loop_len = 8;
    p->note_length_mode = 0;  /* `--` passthrough */
}

static void drum_pfx_params_init(drum_pfx_params_t *p) {
    p->gate_time       = 100;
    p->velocity_offset = 0;
    p->quantize        = 0;
    p->delay_time_idx  = DEFAULT_DRUM_DELAY_TIME_IDX;
    p->delay_level     = 127;
    p->repeat_times    = 0;
    p->fb_velocity     = 0;
    p->fb_gate_time    = 0;
    p->fb_clock        = 0;
    p->delay_retrig    = 1;
    p->note_length_mode = 0;  /* `--` passthrough */
}

static void drum_pfx_init_defaults(drum_pfx_t *px, uint8_t t_idx, uint8_t l_idx) {
    memset(px, 0, sizeof(*px));
    px->gate_time   = 100;
    px->delay_time_idx = DEFAULT_DRUM_DELAY_TIME_IDX;
    px->cached_bpm  = (double)BPM_DEFAULT;
    px->rng         = 12345;
    px->route       = ROUTE_SCHWUNG;
    px->looper_on   = 1;
    px->track_idx   = t_idx;
    px->lane_idx    = l_idx;
}

/* Copy per-lane drum pfx params into the lane's runtime drum_pfx_t surface.
 * Call this whenever the active clip changes (analogous to pfx_apply_params). */
static void drum_pfx_apply_params(drum_pfx_t *px, const drum_pfx_params_t *p) {
    px->gate_time       = p->gate_time;
    px->velocity_offset = p->velocity_offset;
    px->quantize        = p->quantize;
    px->delay_time_idx  = p->delay_time_idx;
    px->delay_level     = p->delay_level;
    px->repeat_times    = p->repeat_times;
    px->fb_velocity     = p->fb_velocity;
    px->fb_gate_time    = p->fb_gate_time;
    px->fb_clock        = p->fb_clock;
    px->delay_retrig    = p->delay_retrig;
}

/* Apply a single named param to a drum lane's pfx_params + runtime drum_pfx_t.
 * Handles the drum subset: gate_time, velocity_offset, quantize, delay_*, fb_*,
 * and the reset verbs pfx_reset / pfx_noteFx_reset / pfx_delay_reset. */
static void drum_pfx_set(seq8_instance_t *inst, seq8_track_t *tr,
                          drum_pfx_params_t *p, drum_pfx_t *px,
                          const char *key, const char *val) {
    (void)inst;
    if (!strcmp(key, "pfx_reset") || !strcmp(key, "pfx_noteFx_reset")) {
        p->gate_time         = 100;
        p->velocity_offset   = 0;
        p->quantize          = 0;
        p->note_length_mode  = 0;
    }
    if (!strcmp(key, "pfx_reset") || !strcmp(key, "pfx_delay_reset")) {
        p->delay_time_idx = DEFAULT_DRUM_DELAY_TIME_IDX;
        p->delay_level    = 0;
        p->repeat_times   = 0;
        p->fb_velocity    = 0;
        p->fb_gate_time   = 0;
        p->fb_clock       = 0;
    }
    /* Accept canonical names and melodic key aliases from applyBankParam dispatch */
    if (!strcmp(key, "gate_time")     || !strcmp(key, "noteFX_gate"))
        p->gate_time       = clamp_i(my_atoi(val), 0, 400);
    if (!strcmp(key, "velocity_offset") || !strcmp(key, "noteFX_velocity"))
        p->velocity_offset = clamp_i(my_atoi(val), -127, 127);
    if (!strcmp(key, "quantize"))
        p->quantize        = clamp_i(my_atoi(val), 0, 100);
    if (!strcmp(key, "delay_time_idx") || !strcmp(key, "delay_time"))
        p->delay_time_idx  = clamp_i(my_atoi(val), 0, 16);
    if (!strcmp(key, "delay_level"))
        p->delay_level     = clamp_i(my_atoi(val), 0, 127);
    if (!strcmp(key, "repeat_times")   || !strcmp(key, "delay_repeats"))
        p->repeat_times    = clamp_i(my_atoi(val), 0, 16);
    if (!strcmp(key, "fb_velocity")    || !strcmp(key, "delay_vel_fb"))
        p->fb_velocity     = clamp_i(my_atoi(val), -127, 127);
    if (!strcmp(key, "fb_gate_time")   || !strcmp(key, "delay_gate_fb"))
        p->fb_gate_time    = clamp_i(my_atoi(val), 0, 10);
    if (!strcmp(key, "fb_clock")       || !strcmp(key, "delay_clock_fb"))
        p->fb_clock        = clamp_i(my_atoi(val), -100, 100);
    if (!strcmp(key, "delay_retrig"))
        p->delay_retrig    = clamp_i(my_atoi(val), 0, 1);
    if (!strcmp(key, "note_length_mode") || !strcmp(key, "noteFX_length_mode"))
        p->note_length_mode = (uint8_t)clamp_i(my_atoi(val), 0, 8);
    /* Silence and sync note-offs when delay is cleared */
    if (!strcmp(key, "pfx_delay_reset") || !strcmp(key, "pfx_reset") ||
            !strcmp(key, "delay_level") || !strcmp(key, "repeat_times")) {
        if (p->delay_level == 0 || p->repeat_times == 0)
            drum_pfx_note_off_imm(inst, tr, px, 0);
    }
    drum_pfx_apply_params(px, p);
    (void)tr;
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
    fx->octaver         = p->octaver;
    fx->harmonize_1     = p->harmonize_1;
    fx->harmonize_2     = p->harmonize_2;
    fx->harmonize_3     = p->harmonize_3;
    fx->delay_time_idx  = p->delay_time_idx;
    fx->delay_level     = p->delay_level;
    fx->repeat_times    = p->repeat_times;
    fx->fb_velocity     = p->fb_velocity;
    fx->fb_note         = p->fb_note;
    fx->fb_note_random      = p->fb_note_random;
    fx->fb_note_random_mode = p->fb_note_random_mode;
    fx->fb_gate_time    = p->fb_gate_time;
    fx->fb_clock        = p->fb_clock;
    fx->delay_retrig    = p->delay_retrig;
    fx->note_random      = p->note_random;
    fx->note_random_mode = p->note_random_mode;
    fx->note_random_walk = 0;   /* reset walk accumulator on clip switch */
    /* SEQ ARP — copy params without disturbing runtime state */
    fx->arp.style      = (uint8_t)clamp_i(p->seq_arp_style,    0, 9);
    fx->arp.rate_idx   = (uint8_t)clamp_i(p->seq_arp_rate,     0, 9);
    fx->arp.octaves = (int8_t)clamp_i(p->seq_arp_octaves, -ARP_MAX_OCTAVES, ARP_MAX_OCTAVES);
    fx->arp.gate_pct   = (uint16_t)clamp_i(p->seq_arp_gate,    1, 200);
    fx->arp.steps_mode = (uint8_t)clamp_i(p->seq_arp_steps_mode, 0, 2);
    fx->arp.retrigger  = (uint8_t)(p->seq_arp_retrigger != 0);
    fx->seq_arp_sync   = (uint8_t)(p->seq_arp_sync != 0);
    int i;
    for (i = 0; i < 8; i++) fx->arp.step_vel[i] = p->seq_arp_step_vel[i];
    for (i = 0; i < 8; i++) fx->arp.step_int[i] = p->seq_arp_step_int[i];
    fx->arp.step_loop_len = (uint8_t)clamp_i((int)p->seq_arp_step_loop_len, 1, 8);
}

static void pfx_sync_from_clip(seq8_track_t *tr) {
    if (tr->pad_mode == PAD_MODE_DRUM) {
        /* Drum clips are allocated lazily per-clip, so active_clip can point at
         * an unallocated (NULL) slot; guard the deref, per dsp/CLAUDE.md's rule
         * that every PAD_MODE_DRUM path also check tr->drum_clips[active_clip]. */
        drum_clip_t *dc = tr->drum_clips[tr->active_clip];
        if (dc) {
            int l;
            for (l = 0; l < DRUM_LANES; l++)
                drum_pfx_apply_params(&tr->drum_lane_pfx[l],
                                      &dc->lanes[l].pfx_params);
        }
        return;
    }
    pfx_apply_params(&tr->pfx, &tr->clips[tr->active_clip].pfx_params);
}

/* Anchor a drum lane's playhead to where it would be if the new clip's lane
 * params had been driving it since transport start. Keeps polyrhythmic lanes
 * (length<16, non-aligned cycles) in phase across clip switches mid-playback. */
static inline void drum_lane_anchor_playhead(seq8_instance_t *inst,
                                             seq8_track_t *tr, int dl,
                                             clip_t *ncl) {
    uint16_t dlls  = ncl->loop_start;
    uint16_t dllen = ncl->length > 0 ? ncl->length : 1;
    uint16_t dltps = ncl->ticks_per_step > 0 ? ncl->ticks_per_step
                                             : (uint16_t)TICKS_PER_STEP;
    uint32_t elapsed = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                       + (uint32_t)inst->master_tick_in_step;
    uint32_t steps   = elapsed / dltps;
    {
        /* Phase-align the playhead to where it would be if this lane had been
         * driving in its current direction since transport start — preserves
         * polyrhythmic phase across mid-play clip switches in all 4 modes. */
        uint16_t target;
        int8_t   target_pp = +1;
        switch (ncl->playback_dir) {
        case 1: /* Backward */
            target = (uint16_t)(dlls + (dllen - 1u - (steps % dllen)));
            break;
        case 2: { /* Pingpong Forward — Step style cycle=2L-2, Audio style cycle=2L */
            if (dllen <= 1) { target = dlls; break; }
            if (ncl->playback_audio_reverse) {
                /* Audio cycle = 2L. Endpoints play twice. Sequence 0,1,..,L-1,L-1,..,1,0,0,1,.. */
                uint32_t cyc = steps % (2u * (uint32_t)dllen);
                if (cyc < dllen)  { target = (uint16_t)(dlls + cyc);                       target_pp = +1; }
                else              { target = (uint16_t)(dlls + (2u * dllen - 1u - cyc));   target_pp = -1; }
            } else {
                uint32_t cyc = steps % (2u * (uint32_t)dllen - 2u);
                if (cyc <= (uint32_t)(dllen - 1)) { target = (uint16_t)(dlls + cyc);                       target_pp = +1; }
                else                              { target = (uint16_t)(dlls + (2u * dllen - 2u - cyc));   target_pp = -1; }
            }
            break;
        }
        case 3: { /* Pingpong Backward — Step style cycle=2L-2, Audio style cycle=2L */
            if (dllen <= 1) { target = dlls; break; }
            if (ncl->playback_audio_reverse) {
                uint32_t cyc = steps % (2u * (uint32_t)dllen);
                if (cyc < dllen)  { target = (uint16_t)(dlls + (dllen - 1u - cyc));       target_pp = -1; }
                else              { target = (uint16_t)(dlls + (cyc - dllen));            target_pp = +1; }
            } else {
                uint32_t cyc = steps % (2u * (uint32_t)dllen - 2u);
                if (cyc <= (uint32_t)(dllen - 1)) { target = (uint16_t)(dlls + (dllen - 1u - cyc));        target_pp = -1; }
                else                              { target = (uint16_t)(dlls + (cyc - (dllen - 1u)));     target_pp = +1; }
            }
            break;
        }
        case 0:
        default:
            target = (uint16_t)(dlls + (steps % dllen));
            break;
        }
        tr->drum_current_step[dl] = target;
        ncl->pp_dir_state = target_pp;
    }
    tr->drum_tick_in_step[dl] = elapsed % dltps;
    uint16_t ni;
    for (ni = 0; ni < ncl->note_count; ni++)
        ncl->notes[ni].suppress_until_wrap = 0;
}

/* Anchor a melodic track's playhead to where it would be if the new clip had
 * been playing since transport start. Mirrors drum_lane_anchor_playhead but
 * for the single melodic playhead. */
static inline void melodic_anchor_playhead(seq8_instance_t *inst,
                                           seq8_track_t *tr, clip_t *ncl) {
    uint16_t ls  = ncl->loop_start;
    uint16_t len = ncl->length > 0 ? ncl->length : 1;
    uint16_t tps = ncl->ticks_per_step > 0 ? ncl->ticks_per_step
                                            : (uint16_t)TICKS_PER_STEP;
    uint32_t elapsed = (uint32_t)inst->global_tick * (uint32_t)TICKS_PER_STEP
                       + (uint32_t)inst->master_tick_in_step;
    uint32_t steps   = elapsed / tps;
    uint16_t target;
    int8_t   target_pp = +1;
    switch (ncl->playback_dir) {
    case 1: /* Backward */
        target = (uint16_t)(ls + (len - 1u - (steps % len)));
        break;
    case 2: { /* Pingpong Forward */
        if (len <= 1) { target = ls; break; }
        if (ncl->playback_audio_reverse) {
            uint32_t cyc = steps % (2u * (uint32_t)len);
            if (cyc < len)  { target = (uint16_t)(ls + cyc);                     target_pp = +1; }
            else            { target = (uint16_t)(ls + (2u * len - 1u - cyc));   target_pp = -1; }
        } else {
            uint32_t cyc = steps % (2u * (uint32_t)len - 2u);
            if (cyc <= (uint32_t)(len - 1)) { target = (uint16_t)(ls + cyc);                     target_pp = +1; }
            else                            { target = (uint16_t)(ls + (2u * len - 2u - cyc));   target_pp = -1; }
        }
        break;
    }
    case 3: { /* Pingpong Backward */
        if (len <= 1) { target = ls; break; }
        if (ncl->playback_audio_reverse) {
            uint32_t cyc = steps % (2u * (uint32_t)len);
            if (cyc < len)  { target = (uint16_t)(ls + (len - 1u - cyc));       target_pp = -1; }
            else            { target = (uint16_t)(ls + (cyc - len));            target_pp = +1; }
        } else {
            uint32_t cyc = steps % (2u * (uint32_t)len - 2u);
            if (cyc <= (uint32_t)(len - 1)) { target = (uint16_t)(ls + (len - 1u - cyc));       target_pp = -1; }
            else                            { target = (uint16_t)(ls + (cyc - (len - 1u)));     target_pp = +1; }
        }
        break;
    }
    case 0:
    default:
        target = (uint16_t)(ls + (steps % len));
        break;
    }
    tr->current_step  = target;
    ncl->pp_dir_state = target_pp;
    tr->tick_in_step  = elapsed % tps;
}

static void clip_init(clip_t *cl) {
    int s;
    cl->length         = SEQ_STEPS_DEFAULT;
    cl->loop_start     = 0;
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
        cl->step_iter[s]       = 0;
        cl->step_random[s]     = 0;
        cl->step_ratchet[s]    = 0;
    }
    {
        int ti;
        for (ti = 0; ti < NUM_TRACKS; ti++) {
            cl->cond_resp[ti] = 1;   /* responder ON by default */
            cl->cond_oct[ti]  = 0;   /* no octave offset */
            cl->cond_when[ti] = 0;   /* 0 = Next */
        }
        cl->cond_lock = 0;           /* CdLk Off (gate-hold) by default */
    }
    cl->loop_cycle = 0;
    cl->note_count = 0;
    memset(cl->notes, 0, sizeof(cl->notes));
    memset(cl->occ_cache, 0, sizeof(cl->occ_cache));
    cl->occ_dirty = 0;
    cl->playback_dir = 0;       /* Forward */
    cl->playback_audio_reverse = 0; /* Step style */
    cl->pp_dir_state = +1;
}

/* Copy a clip's per-clip Conductor settings (responder mask / octave / when /
 * lock). These live on clip_t and must travel with clip/scene copy + cut. */
static void clip_copy_cond_fields(clip_t *dst, const clip_t *src) {
    memcpy(dst->cond_resp, src->cond_resp, sizeof(dst->cond_resp));
    memcpy(dst->cond_oct,  src->cond_oct,  sizeof(dst->cond_oct));
    memcpy(dst->cond_when, src->cond_when, sizeof(dst->cond_when));
    dst->cond_lock = src->cond_lock;
}

static void drum_track_init(seq8_track_t *tr, int track_idx) {
    int c, l;
    for (c = 0; c < NUM_CLIPS; c++)
        tr->drum_clips[c] = NULL;
    for (l = 0; l < DRUM_LANES; l++) {
        tr->drum_rec_pending_tick[l]   = 0;
        tr->drum_rec_pending_step[l]   = 0;
        tr->drum_rec_pending_active[l] = 0;
        tr->drum_last_rec_step[l]      = -1;
        drum_pfx_init_defaults(&tr->drum_lane_pfx[l], (uint8_t)track_idx, (uint8_t)l);
    }
    tr->active_drum_lane  = 0;  /* Bundle 2A: JS pushes via tN_active_drum_lane */
    tr->drum_perform_mode = 0;  /* Bundle 2A: JS pushes via tN_drum_perform_mode */
}

/* ------------------------------------------------------------------ */
/* Note-centric helpers (Stage B+)                                     */
/* ------------------------------------------------------------------ */

/* Logical step for an absolute clip tick using midpoint assignment.
 * Modulo is against SEQ_STEPS (storage capacity), not clip_len: with a
 * non-zero loop_start, clip_len is the window *size* and a note at an
 * absolute tick outside the window must still report its true step index
 * so the playhead (also absolute) can match it. The `clip_len` argument
 * is kept for source compatibility but ignored. */
static uint16_t note_step(uint32_t tick, uint16_t clip_len, uint16_t tps) {
    (void)clip_len;
    uint32_t shifted = tick + (uint32_t)(tps / 2);
    return (uint16_t)((shifted / (uint32_t)tps) % (uint32_t)SEQ_STEPS);
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
        if (!cl->notes[i].active) continue;
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
    /* Window-anchored — see record_note_on. */
    uint32_t off_tick = tr->current_clip_tick;
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
    cl->notes[idx].pad[0]            = 0;
    cl->notes[idx].pad[1]            = 0;
    cl->notes[idx].active            = 1;   /* activate last */
    cl->note_count++;
    cl->occ_dirty = 1;
#if SEQ8_DEBUG_PROBES
    /* Z4 probe: log every insertion into t1/c0 with caller-trace stub.
     * HOT PATH — fires on every clip note insert (e.g. step-edit rebuilds). */
    if (g_inst && cl == &g_inst->tracks[1].clips[0]) {
        char _zb[160]; snprintf(_zb, sizeof(_zb),
            "Z4 INSERT t1/c0 tick=%u pitch=%u vel=%u gate=%u nc_after=%u rec=%d cit=%d",
            (unsigned)tick, (unsigned)pitch, (unsigned)vel, (unsigned)gate,
            (unsigned)cl->note_count, (int)g_inst->tracks[1].recording,
            (int)g_inst->count_in_ticks);
        seq8_ilog(g_inst, _zb);
    }
#endif
    return idx;
}

/* ------------------------------------------------------------------ */
/* Remote-UI note-centric editing helpers (piano roll).                 */
/* These edit notes[] directly (the canonical playback model) and run   */
/* only from set_param context, which the host drains at audio-buffer   */
/* boundaries — never concurrent with render — so array rewrites are     */
/* safe (same contract clip_migrate_to_notes already relies on).        */
/* ------------------------------------------------------------------ */

/* Bump the remote-UI revision so the browser notices device/remote edits, and
 * mark for a FULL on-device re-sync (scope unknown). Use rui_mark() instead when
 * the touched clip is known — it lets the on-device JS re-read just that clip. */
static inline void rui_touch(seq8_instance_t *inst) {
    if (!inst) return;
    inst->rui_rev++;
    inst->rui_dirty_full = 1;
}

/* Bump the revision AND record clip (t,c) as dirty for a targeted on-device
 * re-sync. Dedups; on overflow or an already-full state, degrades to full. */
static inline void rui_mark(seq8_instance_t *inst, int t, int c) {
    if (!inst) return;
    inst->rui_rev++;
    if (inst->rui_dirty_full) return;
    if (t < 0 || t >= NUM_TRACKS || c < 0 || c >= NUM_CLIPS) { inst->rui_dirty_full = 1; return; }
    for (uint8_t i = 0; i < inst->rui_dirty_n; i++)
        if (inst->rui_dirty_t[i] == (uint8_t)t && inst->rui_dirty_c[i] == (uint8_t)c) return;
    if (inst->rui_dirty_n >= RUI_DIRTY_MAX) { inst->rui_dirty_full = 1; return; }
    inst->rui_dirty_t[inst->rui_dirty_n] = (uint8_t)t;
    inst->rui_dirty_c[inst->rui_dirty_n] = (uint8_t)c;
    inst->rui_dirty_n++;
}

/* Find an active note by exact tick+pitch. Returns index or -1. */
static int clip_find_note(clip_t *cl, uint32_t tick, uint8_t pitch) {
    uint16_t i;
    for (i = 0; i < cl->note_count; i++)
        if (cl->notes[i].active && cl->notes[i].tick == tick && cl->notes[i].pitch == pitch)
            return (int)i;
    return -1;
}

/* Drop tombstoned (active==0) notes, packing survivors down. Reclaims slots
 * so add/del/move churn from the piano roll never starves MAX_NOTES_PER_CLIP. */
static void clip_compact_notes(clip_t *cl) {
    uint16_t w = 0, r;
    for (r = 0; r < cl->note_count; r++) {
        if (!cl->notes[r].active) continue;
        if (w != r) cl->notes[w] = cl->notes[r];
        w++;
    }
    for (r = w; r < cl->note_count; r++) cl->notes[r].active = 0;
    cl->note_count = w;
    cl->occ_dirty = 1;
}

/* Apply one piano-roll note op to a melodic clip. op: a/d/m/r/v.
 *   a tick pitch [vel] [gate]      add (deduped on tick+pitch)
 *   d tick pitch                   delete (tombstone)
 *   m oldtick oldpitch newtick newpitch   move (in place)
 *   r tick pitch newgate           resize gate
 *   v tick pitch newvel            set velocity
 * Returns 1 if the clip changed. Clamps all inputs to the clip window. */
static int clip_note_apply_op(clip_t *cl, char op, const char *args) {
    uint32_t maxtick = (uint32_t)cl->length * cl->ticks_per_step;
    if (maxtick == 0) maxtick = 1;
    long a[4] = {0,0,0,0}; int na = 0; const char *p = args;
    while (na < 4) {
        while (*p == ' ') p++;
        if (!*p || *p == ';') break;
        a[na++] = my_atoi(p);
        while (*p && *p != ' ' && *p != ';') p++;
    }
    switch (op) {
    case 'a': {
        if (na < 2) return 0;
        uint32_t tick = (uint32_t)clamp_i((int)a[0], 0, (int)maxtick - 1);
        uint8_t  pitch = (uint8_t)clamp_i((int)a[1], 0, 127);
        uint8_t  vel   = (uint8_t)clamp_i(na > 2 ? (int)a[2] : SEQ_VEL, 1, 127);
        uint16_t gate  = (uint16_t)clamp_i(na > 3 ? (int)a[3] : GATE_TICKS, 1, 65535);
        if (clip_find_note(cl, tick, pitch) >= 0) return 0;   /* no duplicate */
        return clip_insert_note(cl, tick, gate, pitch, vel) >= 0 ? 1 : 0;
    }
    case 'd': {
        if (na < 2) return 0;
        int idx = clip_find_note(cl, (uint32_t)a[0], (uint8_t)clamp_i((int)a[1], 0, 127));
        if (idx < 0) return 0;
        cl->notes[idx].active = 0; cl->occ_dirty = 1; return 1;
    }
    case 'm': {
        if (na < 4) return 0;
        int idx = clip_find_note(cl, (uint32_t)a[0], (uint8_t)clamp_i((int)a[1], 0, 127));
        if (idx < 0) return 0;
        cl->notes[idx].tick  = (uint32_t)clamp_i((int)a[2], 0, (int)maxtick - 1);
        cl->notes[idx].pitch = (uint8_t)clamp_i((int)a[3], 0, 127);
        cl->occ_dirty = 1; return 1;
    }
    case 'r': {
        if (na < 3) return 0;
        int idx = clip_find_note(cl, (uint32_t)a[0], (uint8_t)clamp_i((int)a[1], 0, 127));
        if (idx < 0) return 0;
        cl->notes[idx].gate = (uint16_t)clamp_i((int)a[2], 1, 65535); return 1;
    }
    case 'v': {
        if (na < 3) return 0;
        int idx = clip_find_note(cl, (uint32_t)a[0], (uint8_t)clamp_i((int)a[1], 0, 127));
        if (idx < 0) return 0;
        cl->notes[idx].vel = (uint8_t)clamp_i((int)a[2], 1, 127); return 1;
    }
    }
    return 0;
}

/* Commit note edits: reclaim tombstones, re-derive the step/LED view, mark dirty.
 * (t,c) = the clip being finalized so the on-device JS re-syncs just it (drum
 * callers pass the active drum-clip index). */
static void clip_note_finalize(seq8_instance_t *inst, clip_t *cl, int t, int c) {
    clip_compact_notes(cl);
    clip_build_steps_from_notes(cl);
    rui_mark(inst, t, c);
    inst->state_dirty = 1;
}

/* Drum-lane note op for the remote piano roll. A lane is monophonic at a fixed
 * pitch (lane_note), so ops key off tick only; pitch is forced to lane_note.
 *   t tick [vel] [gate]   toggle a hit at tick (add if absent, else remove)
 *   a tick [vel] [gate]   add (no-op if a hit already exists at tick)
 *   d tick                delete the hit at tick
 *   v tick vel            set velocity
 *   r tick gate           set gate
 *   m oldtick newtick      move in time
 * Returns 1 if the lane changed. */
static int lane_note_apply_op(clip_t *cl, uint8_t lane_note, char op, const char *args) {
    uint32_t maxtick = (uint32_t)cl->length * cl->ticks_per_step;
    if (maxtick == 0) maxtick = 1;
    long a[3] = {0,0,0}; int na = 0; const char *p = args;
    while (na < 3) {
        while (*p == ' ') p++;
        if (!*p || *p == ';') break;
        a[na++] = my_atoi(p);
        while (*p && *p != ' ' && *p != ';') p++;
    }
    if (na < 1) return 0;
    uint32_t tick = (uint32_t)clamp_i((int)a[0], 0, (int)maxtick - 1);
    int idx = -1; uint16_t i;
    for (i = 0; i < cl->note_count; i++)
        if (cl->notes[i].active && cl->notes[i].tick == tick) { idx = (int)i; break; }
    switch (op) {
    case 't':
        if (idx >= 0) { cl->notes[idx].active = 0; cl->occ_dirty = 1; return 1; }
        /* fall through to add */
    case 'a': {
        if (idx >= 0) return 0;
        uint8_t  vel  = (uint8_t)clamp_i(na > 1 ? (int)a[1] : SEQ_VEL, 1, 127);
        uint16_t gate = (uint16_t)clamp_i(na > 2 ? (int)a[2] : GATE_TICKS, 1, 65535);
        return clip_insert_note(cl, tick, gate, lane_note, vel) >= 0 ? 1 : 0;
    }
    case 'd':
        if (idx < 0) return 0;
        cl->notes[idx].active = 0; cl->occ_dirty = 1; return 1;
    case 'v':
        if (idx < 0 || na < 2) return 0;
        cl->notes[idx].vel = (uint8_t)clamp_i((int)a[1], 1, 127); return 1;
    case 'r':
        if (idx < 0 || na < 2) return 0;
        cl->notes[idx].gate = (uint16_t)clamp_i((int)a[1], 1, 65535); return 1;
    case 'm':
        if (idx < 0 || na < 2) return 0;
        cl->notes[idx].tick = (uint32_t)clamp_i((int)a[1], 0, (int)maxtick - 1);
        cl->occ_dirty = 1; return 1;
    }
    return 0;
}

/* Distribute 'hits' evenly across 'len' steps; returns count placed (<= hits, <= len).
 * Positions written ascending to out[]. First hit always at step 0.
 * Integer Bresenham distribution (pos[i] = (i * len) / hits) — yields the same
 * 0-anchored even spacing as classic Bjorklund for musical use. */
static int bjorklund_positions(int hits, int len, int *out) {
    if (hits <= 0 || len <= 0) return 0;
    if (hits > len) hits = len;
    int i;
    for (i = 0; i < hits; i++) out[i] = (i * len) / hits;
    return hits;
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
        cl->steps[sidx] = 1;
        cl->active = 1;
    }
}

/* Derive notes[] from step arrays. Called after state load so both representations exist. */
static void clip_migrate_to_notes(clip_t *cl) {
    int s, ni;
    cl->note_count = 0;
    memset(cl->notes, 0, sizeof(cl->notes));
    cl->occ_dirty = 1;
    int tps = (int)cl->ticks_per_step;
    /* Iterate full storage extent, not just the loop window: with a non-zero
     * loop_start the window is a playback subset and step_notes[] outside it
     * must still rebuild into cl->notes[] to preserve out-of-window content. */
    int clip_ticks = SEQ_STEPS * tps;
    for (s = 0; s < SEQ_STEPS; s++) {
        if (cl->step_note_count[s] == 0) continue;
        for (ni = 0; ni < (int)cl->step_note_count[s]; ni++) {
            int32_t abs_tick = (int32_t)s * tps
                               + (int32_t)cl->note_tick_offset[s][ni];
            if (abs_tick < 0) abs_tick += clip_ticks;
            if (abs_tick >= clip_ticks) abs_tick = clip_ticks - 1;
            clip_insert_note(cl, (uint32_t)abs_tick, cl->step_gate[s],
                             cl->step_notes[s][ni], cl->step_vel[s]);
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
        tr->recording_pending_page = 0;
        tr->recording_adaptive_arm = 0;
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

static void metro_wav_open(seq8_instance_t *inst) {
    const char *path = "/data/UserData/schwung/modules/tools/davebox/click-seq8.wav";
    inst->metro_wav_fd = open(path, O_RDONLY);
    if (inst->metro_wav_fd < 0) return;

    struct stat st;
    if (fstat(inst->metro_wav_fd, &st) < 0 || st.st_size < 44) {
        close(inst->metro_wav_fd); inst->metro_wav_fd = -1; return;
    }
    inst->metro_wav_map_size = (size_t)st.st_size;
    inst->metro_wav_map = mmap(NULL, inst->metro_wav_map_size, PROT_READ, MAP_PRIVATE,
                               inst->metro_wav_fd, 0);
    if (inst->metro_wav_map == MAP_FAILED) {
        inst->metro_wav_map = NULL;
        close(inst->metro_wav_fd); inst->metro_wav_fd = -1; return;
    }

    const uint8_t *raw = (const uint8_t *)inst->metro_wav_map;
    if (memcmp(raw, "RIFF", 4) != 0 || memcmp(raw + 8, "WAVE", 4) != 0) goto fail;

    uint32_t offset = 12;
    uint16_t nch = 0, bps = 0, audio_fmt = 0;
    uint32_t data_off = 0, data_sz = 0;
    int found_fmt = 0, found_data = 0;
    while (offset + 8 <= inst->metro_wav_map_size) {
        const uint8_t *c = raw + offset;
        uint32_t csz = c[4] | ((uint32_t)c[5]<<8) | ((uint32_t)c[6]<<16) | ((uint32_t)c[7]<<24);
        if (memcmp(c, "fmt ", 4) == 0 && csz >= 16) {
            audio_fmt = (uint16_t)(c[8]  | (c[9] <<8));
            nch       = (uint16_t)(c[10] | (c[11]<<8));
            bps       = (uint16_t)(c[22] | (c[23]<<8));
            found_fmt = 1;
        } else if (memcmp(c, "data", 4) == 0) {
            data_off   = offset + 8;
            data_sz    = csz;
            found_data = 1;
            break;
        }
        offset += 8 + csz;
        if (csz & 1) offset++;
    }

    if (!found_fmt || !found_data || audio_fmt != 1 || bps != 16 || nch != 1) goto fail;
    if (data_off + data_sz > inst->metro_wav_map_size)
        data_sz = (uint32_t)(inst->metro_wav_map_size - data_off);

    inst->metro_wav_data   = (const int16_t *)(raw + data_off);
    inst->metro_wav_frames = data_sz / 2;
    return;

fail:
    munmap(inst->metro_wav_map, inst->metro_wav_map_size);
    inst->metro_wav_map  = NULL;
    close(inst->metro_wav_fd);
    inst->metro_wav_fd = -1;
}

static void *create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir; (void)json_defaults;

    seq8_instance_t *inst = (seq8_instance_t *)calloc(1, sizeof(seq8_instance_t));
    if (!inst) return NULL;
    g_inst = inst;

    inst->sample_rate    = (g_host && g_host->sample_rate > 0)
                           ? (float)g_host->sample_rate : 44100.0f;
    inst->log_fp         = fopen(SEQ8_LOG_PATH, "a");

    inst->rui_sel_lane  = -1;  /* remote-UI: melodic by default (calloc zeros the rest) */
    inst->rui_cc_focus  = -1;  /* no CC lane focused initially */

    inst->pad_key      = 9;   /* A */
    inst->pad_scale    = 1;   /* Minor */
    inst->launch_quant = 0;   /* Now */
    inst->metro_on     = 1;    /* default: Count (count-in only) */
    inst->metro_vol    = 80;
    inst->metro_wav_fd    = -1;
    inst->metro_wav_map   = NULL;
    inst->metro_wav_data  = NULL;
    inst->metro_wav_frames = 0;
    inst->metro_click_pos  = UINT32_MAX;
    metro_wav_open(inst);
    inst->looper_sync            = 1;
    inst->looper_pending_silence = 0;
    inst->conductor_track        = -1;  /* no Conductor by default */
    inst->conductor_sounding     = 0;   /* transient live transposition offset */
    inst->conductor_off_deg      = 0;
    inst->conductor_off_semi     = 0;
    inst->conductor_held         = 0;   /* transient held-note count */
    inst->conductor_off_deg_prev  = 0;  /* transient Now-retrigger change detect */
    inst->conductor_off_semi_prev = 0;
    inst->conductor_sounding_prev = 0;
    memset(inst->perf_emitted_pitch, 0xFF, sizeof(inst->perf_emitted_pitch));
    memset(inst->pad_note_map, 0xFF, sizeof(inst->pad_note_map));
    memset(inst->pad_live_pitch, 0xFF, sizeof(inst->pad_live_pitch));
    memset(inst->ext_press_track, 0xFF, sizeof(inst->ext_press_track));
    memset(inst->pad_source_scratch, 0, sizeof(inst->pad_source_scratch)); /* PAD_SRC_NORMAL */
    memset(inst->drum_vel_zone_armed, 0, sizeof(inst->drum_vel_zone_armed));
    memset(inst->drum_last_vel_zone, 0, sizeof(inst->drum_last_vel_zone));
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
        /* Default channels: track N → MIDI ch N (tracks 1-4 → ch 1-4 for Move,
         * tracks 5-8 → ch 5-8 for Schwung). */
        inst->tracks[t].channel     = (uint8_t)t;
        inst->tracks[t].queued_clip = -1;
        inst->tracks[t].pad_octave  = 3;
        inst->tracks[t].pad_mode    = PAD_MODE_MELODIC_SCALE;
        for (c = 0; c < NUM_CLIPS; c++)
            clip_init(&inst->tracks[t].clips[c]);
        drum_track_init(&inst->tracks[t], t);
        pfx_init_defaults(&inst->tracks[t].pfx);
        tarp_init_defaults(&inst->tracks[t]);
        drum_repeat_init_defaults(&inst->tracks[t]);
        inst->tracks[t].drum_repeat_sync = 1;
        { int _k; for (_k = 0; _k < 8; _k++) inst->tracks[t].cc_assign[_k] = CC_ASSIGN_DEFAULT[_k]; }
        memset(inst->tracks[t].cc_type, 0, 8);
        memset(inst->tracks[t].cc_auto_last_sent, 0xFF, 8);
        memset(inst->tracks[t].cc_auto_cur_val, 0xFF, 8);
        inst->tracks[t].cc_latched       = 0;
        inst->tracks[t].cc_was_recording = 0;
        inst->tracks[t].cc_prev_ct       = 0;
        memset(inst->tracks[t].cc_latch_last_snap, 0xFF, sizeof(inst->tracks[t].cc_latch_last_snap));
        for (c = 0; c < NUM_CLIPS; c++)
            memset(inst->tracks[t].clip_cc_auto[c].rest_val, 0xFF, 8);
        /* AT automation: free all lanes (pitch=254; a zeroed pitch would alias
         * note 0). at_last_clip=0xFF forces a playback cache reset on first tick. */
        for (c = 0; c < NUM_CLIPS; c++)
            at_auto_reset(&inst->tracks[t].clip_at_auto[c]);
        memset(inst->tracks[t].at_last_sent, 0xFF, AT_MAX_LANES);
        inst->tracks[t].at_last_clip = 0xFF;
        inst->tracks[t].pfx.looper_on = 1;
        inst->tracks[t].pfx.track_idx = (uint8_t)t;
        /* Default routing: tracks 1-4 → Move (ch 1-4), tracks 5-8 → Schwung (ch 1-4) */
        if (t < 4) {
            inst->tracks[t].pfx.route = ROUTE_MOVE;
            { int _rl; for (_rl = 0; _rl < DRUM_LANES; _rl++) inst->tracks[t].drum_lane_pfx[_rl].route = ROUTE_MOVE; }
        }
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

    /* Default track 0 to drum mode if no tracks loaded as drum.
     * Matches the JS first-run default (restoreUiSidecar else branch).
     * Schwung host drops tN_pad_mode, so JS's pendingDefaultSetParams
     * push never reaches DSP — set it here instead. */
    { int _any_drum = 0, _dt;
      for (_dt = 0; _dt < NUM_TRACKS; _dt++)
        if (inst->tracks[_dt].pad_mode == PAD_MODE_DRUM) { _any_drum = 1; break; }
      if (!_any_drum) {
        inst->tracks[0].pad_mode = PAD_MODE_DRUM;
        drum_clips_alloc(inst, &inst->tracks[0]);
      }
    }

    {
        int _dc_count = 0;
        { int _t, _c;
          for (_t = 0; _t < NUM_TRACKS; _t++)
            for (_c = 0; _c < NUM_CLIPS; _c++)
              if (inst->tracks[_t].drum_clips[_c]) _dc_count++;
        }
        char szlog[128];
        snprintf(szlog, sizeof(szlog),
                 "SEQ8 init: inst=%zu track=%zu drum_alloc=%d/%d bpm=%.1f",
                 sizeof(seq8_instance_t), sizeof(seq8_track_t),
                 _dc_count, NUM_TRACKS * NUM_CLIPS,
                 inst->tracks[0].pfx.cached_bpm);
        seq8_ilog(inst, szlog);
    }
    return inst;
}

static void destroy_instance(void *instance) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst) return;
    if (!inst->state_version_mismatch)
        seq8_save_state(inst);
    int t;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->tracks[t].pfx.event_count = 0;
        memset(inst->tracks[t].pfx.active_notes, 0,
               sizeof(inst->tracks[t].pfx.active_notes));
    }
    send_panic(inst);
    g_inst = NULL;
    { int _t; for (_t = 0; _t < NUM_TRACKS; _t++) drum_clips_free(&inst->tracks[_t]); }
    seq8_ilog(inst, "SEQ8 instance destroyed");
    if (inst->log_fp) fclose(inst->log_fp);
    free(inst);
}

/* ------------------------------------------------------------------ */
/* on_midi                                                              */
/* ------------------------------------------------------------------ */

/* Phase 1 / Bundle 2: pad source intent flag. on_midi sets a per-track
 * scratch slot (inst->pad_source_scratch[t]) before dispatching to
 * live_note_on / drum_record_note_on so downstream code knows whether
 * to apply VelIn (NORMAL = yes; all bypass sources = no). Sub-bundle
 * 2.0 wires the scaffold; 2A/B/C populate the non-NORMAL branches. */
typedef enum {
    PAD_SRC_NORMAL   = 0,  /* ordinary left-half pad press (apply VelIn) */
    PAD_SRC_VEL_ZONE = 1,  /* right-half drum pad, vel-zone substitute   */
    PAD_SRC_RPT_RATE = 2,  /* right-half drum pad, Rpt1 rate select      */
    PAD_SRC_RPT_LANE = 3,  /* right-half drum pad, Rpt2 lane toggle      */
    PAD_SRC_RPT_VEL  = 4,  /* right-half drum pad, Rpt repeat-vel zone   */
} pad_source_t;

/* Bundle 2A: mirrors of JS drumPadToVelZone (ui.js:1450) and
 * drumVelZoneToVelocity (ui.js:1458). Right-half pads (col 4..7) are
 * vel-zone control surface, not lane notes. zone 0..15 → vel 8..127. */
static inline int drum_pad_to_vel_zone(int padIdx) {
    int col = padIdx % 8;
    if (col < 4) return -1;
    int row = padIdx / 8;
    return row * 4 + (col - 4);
}

static inline uint8_t drum_vel_zone_to_velocity(int zone) {
    int v = ((zone + 1) * 127 + 8) / 16;  /* round((zone+1)*127/16) */
    if (v < 1) v = 1;
    if (v > 127) v = 127;
    return (uint8_t)v;
}

/* Bundle 2A/2C: classify right-half pad events on drum tracks.
 *
 * Returns 1 if the event was handled by drum_pad_event (caller MUST NOT
 * fall through to normal pad_note_map dispatch). Returns 0 if not
 * applicable (left-half pad, or right-half but no branch handles it) —
 * caller falls through to existing pitch-based dispatch.
 *
 * Rpt-mode collision gating: if tr->drum_repeat_active or any bit in
 * tr->drum_repeat2_active is set, JS Rpt1/Rpt2 set_params own
 * activation today (2C will replace). We return 1 (handled — don't
 * dispatch a lane note) without firing any preview. Bundle 2C fills
 * the Rpt branches in this slot.
 *
 * NORMAL mode (no Rpt running): arm the vel zone, fire the active
 * lane's note at zone velocity for audible preview. Release is a noop —
 * matches JS _onPadRelease which has no drum-vel-zone branches; synth
 * voice rings out via the natural envelope. */
static int drum_pad_event(seq8_instance_t *inst, seq8_track_t *tr,
                          int t, int padIdx, uint8_t vel, int is_on) {
    /* Phase 1 / Bundle 2C-Rpt2: Delete-held suppression. JS bails its
     * drum-mode pad handlers while Delete is held — mirror that here so
     * DSP doesn't fire vel-zone / Rpt classifier branches mid-gesture.
     * on_midi's pad_note_map dispatch is also suppressed because we
     * return 1 (handled, don't fall through). */
    if (inst->delete_held) return 1;
    int velZone = drum_pad_to_vel_zone(padIdx);

    /* Left-half pad (col 0-3). Different semantics per perform_mode. */
    if (velZone < 0) {
        if (tr->drum_perform_mode == 2) {
            /* Bundle 2C-Rpt2: Rpt2 lane-pad classifier on the audio thread.
             * Lane bit toggles in/out of the multi-lane repeat. On the
             * 1-edge of a Loop-held press JS pushes drum_repeat2_lane_latched
             * <lane> 1 separately.
             *
             * Release path: handle here so simultaneous multi-lane releases
             * don't collide on the JS-side tN_drum_repeat2_lane_off set_param
             * (same-key writes coalesce per buffer; only the last lane would
             * land). DSP-side release processes each lane synchronously. */
            int lane = drum_pad_to_lane(padIdx, tr->drum_lane_page);
            if (lane < 0 || lane >= DRUM_LANES) return 1;
            if (!is_on) {
                /* Pad released: if lane isn't latched, stop it now. Latched
                 * lanes keep firing (intentional). */
                if (!(tr->drum_repeat2_latched_lanes & (1u << (unsigned)lane)))
                    drum_repeat2_lane_off_internal(tr, lane);
                return 1;
            }
            /* Same-buffer race fix (advisor): write active_drum_lane synchronously
             * so a fast lane-then-rate-pad gesture in one buffer reads the new
             * lane in the rate-pad branch (which calls drum_repeat2_rate_internal
             * against tr->active_drum_lane). JS pushes the same value via
             * setActiveDrumLane one buffer later — no long-term divergence. */
            tr->active_drum_lane = (uint8_t)lane;
            inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_RPT_LANE;
            if (tr->drum_repeat2_latched_lanes & (1u << (unsigned)lane)) {
                /* Re-tap of latched lane: stop now on audio thread.
                 * JS will also push lane_off shortly; idempotent. */
                drum_repeat2_lane_off_internal(tr, lane);
            } else {
                drum_repeat2_lane_on_internal(inst, tr, lane, (int)vel);
            }
            inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
            return 1;
        }
        if (tr->drum_perform_mode == 1) {
            /* Bundle 2C-Rpt2 (folded into 2C-Rpt2 commit): Rpt1 lane-swap
             * into DSP. Now that drum_lane_page mirror exists, translate
             * padIdx → lane on the audio thread and call lane_internal
             * directly. Closes the one-buffer set_param-drain latency the
             * 2C-Rpt1 JS-immediate fire still incurred. Also suppress the
             * single-hit lane-note dispatch when repeat is running so the
             * user only hears repeats, not a tap. */
            if (is_on && tr->drum_repeat_active) {
                int lane = drum_pad_to_lane(padIdx, tr->drum_lane_page);
                if (lane >= 0 && lane < DRUM_LANES) {
                    tr->active_drum_lane = (uint8_t)lane;  /* same-buffer race fix */
                    drum_repeat_lane_internal(tr, lane);
                }
            }
            if (tr->drum_repeat_active) return 1;  /* suppress single-hit during active repeat */
        }
        return 0;  /* left half — caller handles as lane note */
    }

    /* Right-half pad: vel-zone control surface (NORMAL mode) or Rpt
     * rate/gate/vel-zone control surface (Rpt1/Rpt2 modes). */

    /* Bundle 2C-Rpt1: rate-pad classifier on the audio thread.
     * Rate pads are right-half rows 0-1; gate-mask pads are rows 2-3
     * (config edit, JS-owned — no audio-thread urgency). */
    if (tr->drum_perform_mode == 1) {
        if (!is_on) return 1;  /* release: JS owns drum_repeat_stop via set_param */
        int row = padIdx / 8;
        if (row >= 2) return 1;  /* gate-mask pad → JS owns */
        int col = padIdx % 8;
        int rate_idx = row * 4 + (col - 4);
        int lane     = (int)tr->active_drum_lane;
        if (lane < 0 || lane >= DRUM_LANES) return 1;
        /* Unlatch tap: re-press of currently-active latched same lane+rate
         * → stop now on the audio thread. JS will also fire its own stop
         * set_param shortly after; idempotent (already stopped). */
        if (tr->drum_repeat_active && tr->drum_repeat_latched &&
            tr->drum_repeat_lane == (uint8_t)lane &&
            tr->drum_repeat_rate_idx == (uint8_t)rate_idx) {
            drum_repeat_stop_internal(tr);
        } else {
            inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_RPT_RATE;
            drum_repeat_start_internal(inst, tr, lane, rate_idx, (int)vel);
            inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
        }
        return 1;
    }

    /* Bundle 2C-Rpt2: Rpt2 rate-pad classifier on the audio thread.
     * Rate pads are right-half rows 0-1; gate-mask pads are rows 2-3
     * (config edit, JS-owned). Rate-pad press assigns the rate to the
     * currently active drum lane (mirrors JS S.activeDrumLane semantics). */
    if (tr->drum_perform_mode == 2) {
        if (!is_on) return 1;
        int row = padIdx / 8;
        if (row >= 2) return 1;  /* gate-mask pad → JS owns */
        int col = padIdx % 8;
        int rate_idx = row * 4 + (col - 4);
        int lane     = (int)tr->active_drum_lane;
        if (lane < 0 || lane >= DRUM_LANES) return 1;
        inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_RPT_RATE;
        drum_repeat2_rate_internal(tr, lane, rate_idx);
        inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
        return 1;
    }

    /* NORMAL drum mode + right-half pad. Resolve the target lane note now;
     * needed for both audible preview AND for record-slot population. */
    int lane = (int)tr->active_drum_lane;
    if (lane < 0 || lane >= DRUM_LANES) return 1;
    drum_clip_t *dc = tr->drum_clips[tr->active_clip];
    uint8_t laneNote = dc->lanes[lane].midi_note;
    if (laneNote == 0xFF) return 1;

    /* Bundle 2A recording fix: populate the on_midi_drum_press slot for
     * the active lane. JS pushes tN_drum_record_note_on for vel-pad hits
     * (path is unchanged from pre-2A). That DSP handler now requires
     * on_midi_drum_press_active[t][lane]=1 on patched Schwung (Bundle 1.5
     * preroll filter at seq8_set_param.c:4090). Without this populate
     * step, vel-pad records get dropped. JS does not push a record-off
     * for vel pads, so we only populate the PRESS slot. */
    int _is_preroll = (!tr->recording && inst->count_in_ticks > 0 &&
                       inst->count_in_ticks <= (int32_t)(PPQN / 2) &&
                       (int)inst->count_in_track == (int)t);
    if (is_on && (tr->recording || _is_preroll)) {
        uint16_t snap_step = _is_preroll
            ? dc->lanes[lane].clip.loop_start
            : tr->drum_current_step[lane];
        int16_t  snap_off  = _is_preroll ? (int16_t)0
            : (int16_t)tr->drum_tick_in_step[lane];
        inst->on_midi_drum_press_step[t][lane]   = snap_step;
        inst->on_midi_drum_press_off[t][lane]    = snap_off;
        inst->on_midi_drum_press_active[t][lane] = 1;
    }

    if (is_on) {
        inst->drum_vel_zone_armed[t] = 1;
        inst->drum_last_vel_zone[t]  = (uint8_t)velZone;
        uint8_t zoneVel = drum_vel_zone_to_velocity(velZone);
        inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_VEL_ZONE;
        live_note_on(inst, tr, laneNote, zoneVel);
        inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
    } else {
        inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_VEL_ZONE;
        live_note_off(inst, tr, laneNote);
        inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
    }
    return 1;
}

/* Ext-MIDI record-slot stamp. Mirrors the pad press/release slot stamping in
 * on_midi (melodic + drum) for external cable-2 notes, keyed by an EXPLICIT
 * track index `t` (the press-track snapshot) so a cross-track release still
 * lands on the track the note was pressed on. Only stamps while that track is
 * recording or in the preroll capture window (caller passes is_preroll).
 * RT-safe: pure slot writes, no alloc / I/O / logging. */
static void ext_stamp_record_slot(seq8_instance_t *inst, seq8_track_t *tr,
                                  int t, uint8_t pitch, int is_on, int is_preroll) {
    if (!(tr->recording || is_preroll)) return;
    if (tr->pad_mode == PAD_MODE_DRUM) {
        int ac = (int)tr->active_clip;
        drum_clip_t *dc = tr->drum_clips[ac];
        if (!dc) return;
        int lane = -1;
        { int l; for (l = 0; l < DRUM_LANES; l++)
            if (dc->lanes[l].midi_note == pitch) { lane = l; break; } }
        if (lane < 0) return;
        uint16_t snap_step = is_preroll ? dc->lanes[lane].clip.loop_start
                                        : tr->drum_current_step[lane];
        int16_t  snap_off  = is_preroll ? (int16_t)0
                                        : (int16_t)tr->drum_tick_in_step[lane];
        if (is_on) {
            inst->on_midi_drum_press_step[t][lane]   = snap_step;
            inst->on_midi_drum_press_off[t][lane]    = snap_off;
            inst->on_midi_drum_press_active[t][lane] = 1;
        } else {
            inst->on_midi_drum_release_step[t][lane]   = snap_step;
            inst->on_midi_drum_release_off[t][lane]    = snap_off;
            inst->on_midi_drum_release_active[t][lane] = 1;
        }
    } else {
        uint32_t snap_tick;
        if (is_preroll) {
            clip_t *cl = &tr->clips[tr->active_clip];
            snap_tick = (uint32_t)cl->loop_start * cl->ticks_per_step;
        } else {
            snap_tick = tr->current_clip_tick;
        }
        if (is_on) {
            inst->on_midi_press_tick[t][pitch]   = snap_tick;
            inst->on_midi_press_active[t][pitch] = 1;
        } else {
            inst->on_midi_release_tick[t][pitch]   = snap_tick;
            inst->on_midi_release_active[t][pitch] = 1;
        }
    }
}

/* Ext seq-echo gate: is `pitch` currently a sequencer-sounding output on tr?
 * davebox's own ROUTE_MOVE sequencer notes are injected to Move, which echoes
 * them back on cable-2 into on_midi — indistinguishable by bytes from the
 * performer's keyboard. play_pending[] is the per-track registry of
 * sequencer-emitted notes (pushed at the render step-fire sites, drained at
 * note-off) — the DSP analog of JS S.seqActiveNotes, and (unlike
 * pfx.pitch_refcount) NOT conflated with live input, since live pads/ext never
 * push play_pending. Consulted before stamping a record slot so we don't
 * capture our own echoes (JS gates the same way: isSeqEcho → don't record).
 * RT-safe: read-only scan of a small fixed array. */
static int ext_is_seq_echo(seq8_track_t *tr, uint8_t pitch) {
    int i;
    for (i = 0; i < (int)tr->play_pending_count; i++)
        if (tr->play_pending[i].pitch == pitch) return 1;
    return 0;
}

/* Phase 1 inbound: audio-thread pad MIDI from the patched Schwung shim.
 *
 * source: 0 = MOVE_MIDI_SOURCE_INTERNAL (Move pads / hardware controls),
 *         2 = MOVE_MIDI_SOURCE_EXTERNAL (cable-2 USB / external MIDI echo,
 *             schwung_shim.c:1305-1307; also the 1-byte realtime stream),
 *         3 = MOVE_MIDI_SOURCE_HOST (host-generated, e.g. boot CC reset —
 *             goes to chain slots, not the overtake gen, in practice).
 * (An earlier revision of this comment claimed EXTERNAL == 1; that was wrong —
 * host/plugin_api_v1.h has always defined it as 2, and the shim passes the
 * constant. The ext branch below keys on "not internal" rather than the
 * literal, so it is robust to any future source-constant drift.)
 *
 * We currently filter for cable-0 internal pad note events in d1 range
 * 68..99 (the Move pad note block). The resolved pitch comes from
 * pad_note_map[active_track][padIdx] — populated by JS via tN_padmap.
 *
 * Dispatch (live_note_on / live_note_off) is gated on inst->dsp_inbound_enabled
 * AND on the pad_note_map entry being initialized (!= 0xFF). While dormant we
 * just log so we can confirm parse + filter behavior on device without
 * double-firing notes alongside the existing JS pendingLiveNotes path. */
static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!inst || !msg) return;

    /* ---- System realtime from Move's sequencer ----------------------------
     * The Schwung shim delivers Move's cable-0 realtime to the overtake DSP's
     * on_midi as a 1-byte message, source MOVE_MIDI_SOURCE_EXTERNAL
     * (schwung_shim.c:1211-1213). These
     * are otherwise dropped by the len<3 / source filters below. on_midi runs
     * on the RT SPI thread, so this branch stays allocation- and I/O-free: it
     * only bumps counters, queues ticks, and runs the (alloc/IO-free) transport
     * reset helpers on the rare transport edges. We always count clocks (lets
     * get_param("clock_dbg") confirm the clock is flowing) but only drive the
     * transport in clock-follow mode. */
    if (len == 1 && msg[0] >= 0xF8) {
        uint8_t rt = msg[0];
        inst->dbg_last_rt = rt;
        switch (rt) {
        case 0xF8: /* clock tick (24 PPQN) */
            inst->dbg_f8_count++;
            if (inst->clock_follow_on) {
                /* Tempo capture: EMA the inter-clock sample period so render's
                 * seq8_clock_follow_tick can track Move's tempo into tick_delta
                 * + cached_bpm. Only between consecutive clocks of a running
                 * transport; reject outliers (transport edges, dropped clocks)
                 * outside the 30..300 BPM band. ext_sample_clock is advanced on
                 * the audio thread — a one-block-stale read here is harmless. */
                if (inst->ext_clock_seen && inst->ext_transport_running) {
                    uint32_t dt = inst->ext_sample_clock - inst->ext_clock_last_sample;
                    double pmin = (double)inst->sample_rate * 60.0 / (300.0 * 24.0);
                    double pmax = (double)inst->sample_rate * 60.0 / (30.0 * 24.0);
                    if ((double)dt >= pmin && (double)dt <= pmax) {
                        if (inst->ext_clock_period_ema <= 0.0f)
                            inst->ext_clock_period_ema = (float)dt;
                        else
                            inst->ext_clock_period_ema +=
                                0.125f * ((float)dt - inst->ext_clock_period_ema);
                    }
                }
                inst->ext_clock_seen        = 1;
                inst->ext_clock_last_sample = inst->ext_sample_clock;
                /* Queue master ticks whenever Move's transport is running
                 * (covers playback AND the count-in lead-in bar, which runs
                 * while davebox itself is still "stopped"). Clamp so a stall
                 * can't let the backlog grow unbounded. */
                if (inst->ext_transport_running) {
                    inst->ext_tick_pending += (int32_t)(PPQN / 24);
                    if (inst->ext_tick_pending > (int32_t)(PPQN * 4))
                        inst->ext_tick_pending = (int32_t)(PPQN * 4);
                }
            }
            break;
        case 0xFA: /* start */
            inst->dbg_fa_count++;
            if (inst->clock_follow_on) {
                /* Move finally started — drop any solo-clock fallback and let the
                 * real clock drive (ext_transport_start below re-anchors). */
                inst->follow_solo     = 0;
                inst->solo_tick_accum = 0;
                inst->ext_transport_running = 1;
                inst->ext_clock_seen        = 1;
                inst->ext_clock_last_sample = inst->ext_sample_clock;
                inst->ext_tick_pending      = 0;
                inst->follow_start_timeout   = 0;   /* clock arrived; cancel fallback */
                inst->follow_start_kind      = 0;
                /* During a count-in lead-in, do NOT hard-start davebox: let the
                 * count_in_ticks countdown (clocked by the incoming 0xF8s) arm
                 * + launch at the downbeat. Otherwise re-anchor to bar 1. */
                if (inst->count_in_ticks <= 0)
                    ext_transport_start(inst);
            }
            break;
        case 0xFB: /* continue */
            inst->dbg_fb_count++;
            if (inst->clock_follow_on) {
                inst->ext_transport_running = 1;
                inst->ext_clock_seen        = 1;
                inst->ext_clock_last_sample = inst->ext_sample_clock;
                inst->follow_start_timeout   = 0;
                inst->follow_start_kind      = 0;
                if (inst->count_in_ticks <= 0 && !inst->playing)
                    ext_transport_start(inst);
            }
            break;
        case 0xFC: /* stop */
            inst->dbg_fc_count++;
            if (inst->clock_follow_on) {
                inst->ext_transport_running = 0;
                inst->ext_tick_pending      = 0;
                if (inst->playing || inst->count_in_ticks > 0)
                    ext_transport_stop(inst);
            }
            break;
        default:
            break;
        }
        return;
    }

    if (len < 3) return;

    uint8_t status = msg[0];
    uint8_t d1     = msg[1];
    uint8_t d2     = msg[2];
    uint8_t type   = status & 0xF0;

    /* ---- External cable-2 MIDI notes (non-internal source) ----------------
     * ⚠ DORMANT-FOR-NOTES on current hardware. This branch was built to stamp
     * record slots from the Move MIDI_OUT echo of a ROUTE_MOVE external note
     * (schwung_shim.c:1305-1307, source = MOVE_MIDI_SOURCE_EXTERNAL = 2). Device
     * diagnosis (2026-07-11) proved Move plays cable-2 notes natively but does
     * NOT echo note-on/off to MIDI_OUT — only continuous controllers (poly/chan
     * pressure, CC, bend) pass through, and those hit the `type != note` return
     * below. So NO note ever stamps a slot here in practice; ROUTE_MOVE ext
     * recording runs entirely through the JS push (recordNoteOn → the ext
     * no-slot FALLBACK in sp_track_record / sp_track_drum2), with count-in
     * last-1/8 filtering done JS-side (extCountInCapture). This branch is kept
     * as the audio-thread landing pad for a FUTURE host MIDI_IN→on_midi note
     * delivery (Option B, board): if real note events ever arrive here, the
     * slot path lights up and wins over the fallback (tighter timing). We gate
     * on "not internal" (robust to source-constant drift); the inbound/route/
     * channel filters bound it and it never emits (Move plays natively; a
     * live_note_on would double-play + risk the cable-2 echo cascade). ext
     * pitches are real MIDI notes (not pad indices 68-99), so this runs before
     * the pad-note filter below. */
    if (source != MOVE_MIDI_SOURCE_INTERNAL) {
        if (type != 0x90 && type != 0x80) return;   /* CC/AT/PB → JS owns */
        if (!inst->dsp_inbound_enabled)   return;    /* dormant: JS fallback owns */
        uint8_t at = inst->active_track;
        if (at >= NUM_TRACKS) return;
        seq8_track_t *atr = &inst->tracks[at];
        /* Only ROUTE_MOVE ext echoes reach on_midi; non-Move never delivered. */
        if (atr->pfx.route != ROUTE_MOVE) return;
        /* Channel filter: the shim's cable-2 remap rewrites the echo channel to
         * the active track's channel, so matching subsumes the JS midiInChannel
         * filter (map §1) — a foreign-channel echo simply won't match. */
        if ((status & 0x0F) != (atr->channel & 0x0F)) return;

        uint8_t pitch = d1;
        int is_on = (type == 0x90) && (d2 > 0);
        if (is_on) {
            /* Seq-echo gate: our own sequencer's ROUTE_MOVE output echoes back
             * here on cable-2. Don't record it (and don't tag a press-track, so
             * the matching echo note-off is skipped too). */
            if (ext_is_seq_echo(atr, pitch)) return;
            inst->ext_press_track[pitch] = at;
            int is_preroll = (!atr->recording && inst->count_in_ticks > 0 &&
                              inst->count_in_ticks <= (int32_t)(PPQN / 2) &&
                              (int)inst->count_in_track == (int)at);
            ext_stamp_record_slot(inst, atr, at, pitch, 1, is_preroll);
        } else {
            uint8_t rt = inst->ext_press_track[pitch];
            if (rt >= NUM_TRACKS) return;   /* untracked (echo / never pressed) */
            inst->ext_press_track[pitch] = 0xFF;
            seq8_track_t *rtr = &inst->tracks[rt];
            int is_preroll = (!rtr->recording && inst->count_in_ticks > 0 &&
                              inst->count_in_ticks <= (int32_t)(PPQN / 2) &&
                              (int)inst->count_in_track == (int)rt);
            ext_stamp_record_slot(inst, rtr, rt, pitch, 0, is_preroll);
        }
        return;
    }

    /* Filter to internal pad note events only. (Redundant post-ext-branch —
     * every non-internal path above returns — kept as a defensive guard.) */
    if (source != 0)                          return; /* not internal */
    if (type != 0x90 && type != 0x80)         return; /* not note on/off */
    if (d1 < 68 || d1 > 99)                   return; /* not a pad note */

    int     is_on   = (type == 0x90) && (d2 > 0);
    int     padIdx  = (int)d1 - 68;
    uint8_t t       = inst->active_track;
    if (t >= NUM_TRACKS) return;
    uint8_t pitch   = inst->pad_note_map[t][padIdx];

    /* Dormant unless JS has signalled capability via tN_padmap. Until then
     * on_midi is no-op (JS pendingLiveNotes owns dispatch). The tN_padmap
     * handler is what sets dsp_inbound_enabled; JS only pushes tN_padmap
     * when shadow_inbound_pad_midi_active is exposed (patched Schwung). */
    if (!inst->dsp_inbound_enabled) return;

    seq8_track_t *tr = &inst->tracks[t];

    /* Note-off: release the pitch captured at this pad's press, not whatever
     * pad_note_map currently says — a repush between press and release (e.g. a
     * Key/Scale preview re-layout) would otherwise strand the held note on the
     * old pitch. Done before the 0xFF check so a now-unmapped pad still releases. */
    if (!is_on) {
        uint8_t held = inst->pad_live_pitch[t][padIdx];
        if (held != 0xFF) pitch = held;
    }

    /* Bundle 2A: classify right-half drum pads (vel zones + Rpt). If
     * handled (returns 1), don't fall through to normal lane-note dispatch.
     * Left-half drum pads + all melodic pads → return 0, fall through.
     *
     * Modal mute: when JS signals pad_dispatch_muted (Shift+bottom-row
     * track shortcut, modal holds, etc.), skip the right-half drum
     * classification too — otherwise Rpt1/Rpt2 latches on the prior
     * active track when the user is just switching tracks. */
    if (tr->pad_mode == PAD_MODE_DRUM && !inst->pad_dispatch_muted) {
        if (drum_pad_event(inst, tr, t, padIdx, d2, is_on)) {
            return;
        }
    }

    if (pitch == 0xFF) {
        /* Unmapped pad: modal mutes (pad_dispatch_muted) and Move co-run
         * left-pad silence (corun_left_silent) both push 0xFF deliberately.
         * The pad-drop file-logging diagnostic that lived here was retired
         * 2026-07-03: two long captures were 100% benign DROP_CORUN, and
         * per-event fopen/fflush/fclose on the RT SPI thread violates the
         * RT-logging ban (audit dsp-rt-1). */
        return;
    }

    /* PHASE-1: snapshot the actual press/release moment so the record-path
     * handlers use this tick (audio-thread, single-buffer precision) instead
     * of their own current_clip_tick at set_param arrival (1-2 audio buffers
     * late due to the JS → tick → set_param hop). Two cases:
     *   - tr->recording: live recording. Snapshot tr->current_clip_tick.
     *   - count_in_ticks > 0 && count_in_track == t: preroll. Snapshot a
     *     synthetic tick at the clip's loop_start so the note lands at the
     *     start of the loop window when recording begins (clips with custom
     *     loop windows would otherwise record outside the window).
     * Both cases preserve real hold duration even when press+release land in
     * the same audio buffer of set_param processing. */
    /* Preroll capture is limited to the last 1/8 note of count-in (final half
     * of the 4th quarter). Earlier presses are warm-up — monitored but not
     * recorded. count_in_ticks counts DOWN from 4*PPQN, so "<= PPQN/2" means
     * "less than 1/8 note remaining". */
    int _is_preroll = (!tr->recording && inst->count_in_ticks > 0 &&
                       inst->count_in_ticks <= (int32_t)(PPQN / 2) &&
                       (int)inst->count_in_track == (int)t);
    if (tr->recording || _is_preroll) {
        if (tr->pad_mode == PAD_MODE_DRUM) {
            int ac = (int)tr->active_clip;
            drum_clip_t *dc = tr->drum_clips[ac];
            int lane = -1;
            { int l; for (l = 0; l < DRUM_LANES; l++) {
                if (dc->lanes[l].midi_note == pitch) { lane = l; break; }
            }}
            if (lane >= 0) {
                uint16_t snap_step = _is_preroll
                    ? dc->lanes[lane].clip.loop_start
                    : tr->drum_current_step[lane];
                int16_t  snap_off  = _is_preroll ? (int16_t)0
                    : (int16_t)tr->drum_tick_in_step[lane];
                if (is_on) {
                    inst->on_midi_drum_press_step[t][lane]   = snap_step;
                    inst->on_midi_drum_press_off[t][lane]    = snap_off;
                    inst->on_midi_drum_press_active[t][lane] = 1;
                } else {
                    inst->on_midi_drum_release_step[t][lane]   = snap_step;
                    inst->on_midi_drum_release_off[t][lane]    = snap_off;
                    inst->on_midi_drum_release_active[t][lane] = 1;
                }
            }
        } else {
            uint32_t snap_tick;
            if (_is_preroll) {
                clip_t *cl_p = &tr->clips[tr->active_clip];
                snap_tick = (uint32_t)cl_p->loop_start * cl_p->ticks_per_step;
            } else {
                snap_tick = tr->current_clip_tick;
            }
            if (is_on) {
                inst->on_midi_press_tick[t][pitch]   = snap_tick;
                inst->on_midi_press_active[t][pitch] = 1;
            } else {
                inst->on_midi_release_tick[t][pitch]   = snap_tick;
                inst->on_midi_release_active[t][pitch] = 1;
            }
        }
    }

    /* Audio-thread monitor: fire live_note_on/off regardless of recording
     * state. The record-path handlers (record_note_on / record_note_off /
     * drum_record_note_on) suppress their inline-monitor when
     * dsp_inbound_enabled so we don't double-fire — this gives armed input
     * the same single-buffer latency as unarmed. */
    /* Bundle 2.0: set pad source intent for downstream consumers. 2.0 only
     * publishes NORMAL; 2A adds VEL_ZONE before this point for right-half
     * drum pads, 2C adds the RPT_* variants. Reset after dispatch so a
     * stale value can't leak to the next call. */
    inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
    if (is_on) {
        if (inst->pad_dispatch_muted) { inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL; return; }
        inst->pad_live_pitch[t][padIdx] = pitch;   /* remember for the matching release */
        live_note_on(inst, tr, pitch, (uint8_t)effective_vel(tr, (int)d2));
    } else {
        /* pad_dispatch_muted gates NEW dispatch (the is_on branch above) and
         * the drum/vel-zone classification, but a voice that was already
         * started before the flag was set MUST still be released — else
         * setting the flag mid-hold (modal gestures: Shift shortcuts, session
         * view, knob touch) strands the note until panic/stop (audit
         * dsp-midi-out-2). pad_live_pitch != 0xFF means live_note_on actually
         * fired for this pad; if the press itself was suppressed by the flag,
         * it stays 0xFF and there is nothing to release. When unmuted, keep the
         * long-standing behavior of always releasing (idempotent for a pad
         * with no live voice). */
        if (!inst->pad_dispatch_muted || inst->pad_live_pitch[t][padIdx] != 0xFF) {
            live_note_off(inst, tr, pitch);
            inst->pad_live_pitch[t][padIdx] = 0xFF;    /* released */
        }
    }
    inst->pad_source_scratch[t] = (uint8_t)PAD_SRC_NORMAL;
}

/* ------------------------------------------------------------------ */
/* Undo/redo helpers                                                    */
/* ------------------------------------------------------------------ */

static void undo_begin_single(seq8_instance_t *inst, int t, int c) {
    if (inst->undo_locked) return;
    inst->undo_clip_count    = 1;
    inst->undo_clip_tracks[0]  = (uint8_t)t;
    inst->undo_clip_indices[0] = (uint8_t)c;
    memcpy(&inst->undo_clips[0], &inst->tracks[t].clips[c], sizeof(clip_t));
    memcpy(&inst->undo_auto_cc[0], &inst->tracks[t].clip_cc_auto[c], sizeof(cc_auto_t));
    memcpy(&inst->undo_auto_at[0], &inst->tracks[t].clip_at_auto[c], sizeof(at_auto_t));
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
}

static void drum_row_snap(seq8_instance_t *inst, int row,
                          drum_rec_snap_lane_t dst[NUM_TRACKS][DRUM_LANES]) {
    int t, l;
    for (t = 0; t < NUM_TRACKS; t++) {
        drum_clip_t *dc = inst->tracks[t].drum_clips[row];
        if (!dc) {
            memset(dst[t], 0, sizeof(drum_rec_snap_lane_t) * DRUM_LANES);
            continue;
        }
        for (l = 0; l < DRUM_LANES; l++) {
            const drum_lane_t *lane = &dc->lanes[l];
            const clip_t *src = &lane->clip;
            drum_rec_snap_lane_t *d = &dst[t][l];
            memcpy(d->steps,            src->steps,            SEQ_STEPS);
            memcpy(d->step_notes,       src->step_notes,       SEQ_STEPS * 8);
            memcpy(d->step_note_count,  src->step_note_count,  SEQ_STEPS);
            memcpy(d->step_vel,         src->step_vel,         SEQ_STEPS);
            memcpy(d->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(d->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(d->step_iter,    src->step_iter,    SEQ_STEPS);
            memcpy(d->step_random,  src->step_random,  SEQ_STEPS);
            memcpy(d->step_ratchet, src->step_ratchet, SEQ_STEPS);
            d->length     = src->length;
            d->loop_start = src->loop_start;
            d->active     = src->active;
            d->playback_dir = src->playback_dir;
            d->playback_audio_reverse = src->playback_audio_reverse;
            d->pfx_params = lane->pfx_params;
        }
    }
}

static void drum_row_restore(seq8_instance_t *inst, int row,
                             const drum_rec_snap_lane_t src[NUM_TRACKS][DRUM_LANES]) {
    int t, l;
    for (t = 0; t < NUM_TRACKS; t++) {
        drum_clip_t *dc = inst->tracks[t].drum_clips[row];
        /* Check if snapshot has any data for this track */
        int has_data = 0;
        for (l = 0; l < DRUM_LANES; l++)
            if (src[t][l].active) { has_data = 1; break; }
        if (!dc && !has_data) continue;
        if (!dc && has_data) {
            dc = (drum_clip_t *)calloc(1, sizeof(drum_clip_t));
            if (!dc) continue;
            inst->tracks[t].drum_clips[row] = dc;
            for (l = 0; l < DRUM_LANES; l++) {
                clip_init(&dc->lanes[l].clip);
                drum_pfx_params_init(&dc->lanes[l].pfx_params);
                dc->lanes[l].midi_note = (uint8_t)(DRUM_BASE_NOTE + l);
            }
        }
        if (dc && !has_data) {
            /* Empty snapshot: for a drum track keep the clip allocated (clear
             * its lanes) so active_clip never points at a freed slot — the
             * crash invariant the live/render drum paths rely on. Only a
             * non-drum track reclaims the memory (its drum_clips are unused). */
            if (inst->tracks[t].pad_mode == PAD_MODE_DRUM) {
                for (l = 0; l < DRUM_LANES; l++)
                    clip_init(&dc->lanes[l].clip);
            } else {
                free(dc);
                inst->tracks[t].drum_clips[row] = NULL;
            }
            continue;
        }
        for (l = 0; l < DRUM_LANES; l++) {
            drum_lane_t *lane = &dc->lanes[l];
            clip_t *dst = &lane->clip;
            const drum_rec_snap_lane_t *s = &src[t][l];
            memcpy(dst->steps,            s->steps,            SEQ_STEPS);
            memcpy(dst->step_notes,       s->step_notes,       SEQ_STEPS * 8);
            memcpy(dst->step_note_count,  s->step_note_count,  SEQ_STEPS);
            memcpy(dst->step_vel,         s->step_vel,         SEQ_STEPS);
            memcpy(dst->step_gate,        s->step_gate,        SEQ_STEPS * sizeof(uint16_t));
            memcpy(dst->note_tick_offset, s->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
            memcpy(dst->step_iter,    s->step_iter,    SEQ_STEPS);
            memcpy(dst->step_random,  s->step_random,  SEQ_STEPS);
            memcpy(dst->step_ratchet, s->step_ratchet, SEQ_STEPS);
            dst->length       = s->length;
            dst->loop_start   = s->loop_start;
            dst->active       = s->active;
            dst->playback_dir = s->playback_dir;
            dst->playback_audio_reverse = s->playback_audio_reverse;
            dst->pp_dir_state = initial_pp_dir(dst->playback_dir);
            lane->pfx_params  = s->pfx_params;
            clip_migrate_to_notes(dst);
        }
    }
}

static void undo_begin_row(seq8_instance_t *inst, int row_c) {
    int t;
    inst->undo_clip_count = NUM_TRACKS;
    for (t = 0; t < NUM_TRACKS; t++) {
        inst->undo_clip_tracks[t]  = (uint8_t)t;
        inst->undo_clip_indices[t] = (uint8_t)row_c;
        memcpy(&inst->undo_clips[t], &inst->tracks[t].clips[row_c], sizeof(clip_t));
        memcpy(&inst->undo_auto_cc[t], &inst->tracks[t].clip_cc_auto[row_c], sizeof(cc_auto_t));
        memcpy(&inst->undo_auto_at[t], &inst->tracks[t].clip_at_auto[row_c], sizeof(at_auto_t));
    }
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
    drum_row_snap(inst, row_c, inst->drum_row_undo_lanes[0]);
    inst->drum_row_undo_clips[0] = (uint8_t)row_c;
    inst->drum_row_undo_valid = 1;
    inst->drum_row_redo_valid = 0;
}

/* Snapshot two clips (src + dst) for cut operations — restores both on undo. */
static void undo_begin_clip_pair(seq8_instance_t *inst, int srcT, int srcC, int dstT, int dstC) {
    inst->undo_clip_count      = 2;
    inst->undo_clip_tracks[0]  = (uint8_t)srcT;
    inst->undo_clip_indices[0] = (uint8_t)srcC;
    memcpy(&inst->undo_clips[0], &inst->tracks[srcT].clips[srcC], sizeof(clip_t));
    memcpy(&inst->undo_auto_cc[0], &inst->tracks[srcT].clip_cc_auto[srcC], sizeof(cc_auto_t));
    memcpy(&inst->undo_auto_at[0], &inst->tracks[srcT].clip_at_auto[srcC], sizeof(at_auto_t));
    inst->undo_clip_tracks[1]  = (uint8_t)dstT;
    inst->undo_clip_indices[1] = (uint8_t)dstC;
    memcpy(&inst->undo_clips[1], &inst->tracks[dstT].clips[dstC], sizeof(clip_t));
    memcpy(&inst->undo_auto_cc[1], &inst->tracks[dstT].clip_cc_auto[dstC], sizeof(cc_auto_t));
    memcpy(&inst->undo_auto_at[1], &inst->tracks[dstT].clip_at_auto[dstC], sizeof(at_auto_t));
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
        memcpy(&inst->undo_auto_cc[t], &inst->tracks[t].clip_cc_auto[srcRow], sizeof(cc_auto_t));
        memcpy(&inst->undo_auto_at[t], &inst->tracks[t].clip_at_auto[srcRow], sizeof(at_auto_t));
        inst->undo_clip_tracks[t + NUM_TRACKS]  = (uint8_t)t;
        inst->undo_clip_indices[t + NUM_TRACKS] = (uint8_t)dstRow;
        memcpy(&inst->undo_clips[t + NUM_TRACKS], &inst->tracks[t].clips[dstRow], sizeof(clip_t));
        memcpy(&inst->undo_auto_cc[t + NUM_TRACKS], &inst->tracks[t].clip_cc_auto[dstRow], sizeof(cc_auto_t));
        memcpy(&inst->undo_auto_at[t + NUM_TRACKS], &inst->tracks[t].clip_at_auto[dstRow], sizeof(at_auto_t));
    }
    inst->undo_valid = 1;
    inst->redo_valid = 0;
    inst->drum_undo_valid = 0;
    drum_row_snap(inst, dstRow, inst->drum_row_undo_lanes[0]);
    inst->drum_row_undo_clips[0] = (uint8_t)dstRow;
    drum_row_snap(inst, srcRow, inst->drum_row_undo_lanes[1]);
    inst->drum_row_undo_clips[1] = (uint8_t)srcRow;
    inst->drum_row_undo_valid = 2;
    inst->drum_row_redo_valid = 0;
}

/* Snapshot all 8 tracks at a given clip for scene bake undo.
 * Melodic clips go into undo_clips[]; drum clips via drum_row_snap. */
static void undo_begin_scene_bake(seq8_instance_t *inst, int clip) {
    int t, mc = 0;
    for (t = 0; t < NUM_TRACKS; t++) {
        if (inst->tracks[t].pad_mode != PAD_MODE_DRUM) {
            inst->undo_clip_tracks[mc]  = (uint8_t)t;
            inst->undo_clip_indices[mc] = (uint8_t)clip;
            memcpy(&inst->undo_clips[mc], &inst->tracks[t].clips[clip], sizeof(clip_t));
            memcpy(&inst->undo_auto_cc[mc], &inst->tracks[t].clip_cc_auto[clip], sizeof(cc_auto_t));
            memcpy(&inst->undo_auto_at[mc], &inst->tracks[t].clip_at_auto[clip], sizeof(at_auto_t));
            mc++;
        }
    }
    inst->undo_clip_count    = (uint8_t)mc;
    inst->undo_valid         = 1;
    inst->redo_valid         = 0;
    inst->drum_undo_valid    = 0;
    drum_row_snap(inst, clip, inst->drum_row_undo_lanes[0]);
    inst->drum_row_undo_clips[0] = (uint8_t)clip;
    inst->drum_row_undo_valid    = 1;
    inst->drum_row_redo_valid    = 0;
}

static void undo_begin_drum_clip(seq8_instance_t *inst, int t, int c) {
    if (inst->undo_locked) return;
    int l;
    drum_clip_t *dc = inst->tracks[t].drum_clips[c];
    if (!dc) return;
    for (l = 0; l < DRUM_LANES; l++) {
        const drum_lane_t *lane = &dc->lanes[l];
        const clip_t *src = &lane->clip;
        drum_rec_snap_lane_t *dst = &inst->drum_undo_lanes[l];
        memcpy(dst->steps,            src->steps,            SEQ_STEPS);
        memcpy(dst->step_notes,       src->step_notes,       SEQ_STEPS * 8);
        memcpy(dst->step_note_count,  src->step_note_count,  SEQ_STEPS);
        memcpy(dst->step_vel,         src->step_vel,         SEQ_STEPS);
        memcpy(dst->step_gate,        src->step_gate,        SEQ_STEPS * sizeof(uint16_t));
        memcpy(dst->note_tick_offset, src->note_tick_offset, SEQ_STEPS * 8 * sizeof(int16_t));
        memcpy(dst->step_iter,    src->step_iter,    SEQ_STEPS);
        memcpy(dst->step_random,  src->step_random,  SEQ_STEPS);
        memcpy(dst->step_ratchet, src->step_ratchet, SEQ_STEPS);
        dst->length     = src->length;
        dst->loop_start = src->loop_start;
        dst->active     = src->active;
        dst->playback_dir = src->playback_dir;
        dst->playback_audio_reverse = src->playback_audio_reverse;
        dst->pfx_params = lane->pfx_params;
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

/* Full reset of a cc_auto_t: drops all points AND clears resting values to
 * "—" (0xFF). Use instead of memset(...,0,...) — a raw zero would leave
 * rest_val[]=0, which means "rest = 0", not "unset". */
static void cc_auto_reset(cc_auto_t *a) {
    memset(a, 0, sizeof(cc_auto_t));
    memset(a->rest_val, 0xFF, 8);
}

/* Drop all automation points for knob k in [t1,t2] (inclusive). Keeps points
 * outside the range and the resting value. Used by step-edit to make a clean
 * flat hold and by single-step clears. */
static void cc_auto_clear_range(cc_auto_t *a, int k, uint16_t t1, uint16_t t2) {
    int n = (int)a->count[k], r = 0, w = 0;
    for (r = 0; r < n; r++) {
        uint16_t tk = a->ticks[k][r];
        if (tk >= t1 && tk <= t2) continue;   /* drop */
        a->ticks[k][w] = a->ticks[k][r];
        a->vals[k][w]  = a->vals[k][r];
        w++;
    }
    a->count[k] = (uint16_t)w;
}

/* Lossless collinear decimation of lane k: drop any interior point whose value
 * equals what cc_auto_eval would interpolate between its kept neighbors at its
 * tick. Uses eval's exact two-step integer math so the value AT each surviving
 * breakpoint is provably unchanged. Flat runs collapse to their endpoints; a
 * straight ramp collapses to its endpoints; curved gestures keep their shape.
 * Endpoints (first/last) are always kept. O(n). */
static void cc_auto_decimate(cc_auto_t *a, int k) {
    int n = (int)a->count[k];
    if (n < 3) return;
    int w = 1;   /* keep point 0 */
    int i;
    for (i = 1; i < n - 1; i++) {
        int t0 = a->ticks[k][w - 1], v0 = a->vals[k][w - 1];
        int t2 = a->ticks[k][i + 1], v2 = a->vals[k][i + 1];
        int ti = a->ticks[k][i],     vi = a->vals[k][i];
        int sp = t2 - t0, interp;
        if (sp <= 0) interp = v2;
        else { int fr = (ti - t0) * 127 / sp; interp = clamp_i(v0 + (v2 - v0) * fr / 127, 0, 127); }
        if (vi == interp) continue;   /* redundant — drop point i */
        a->ticks[k][w] = a->ticks[k][i];
        a->vals[k][w]  = a->vals[k][i];
        w++;
    }
    a->ticks[k][w] = a->ticks[k][n - 1];   /* keep last */
    a->vals[k][w]  = a->vals[k][n - 1];
    w++;
    a->count[k] = (uint16_t)w;
}

/* Finalize a track's CC latch state: decimate every latched lane of the active
 * clip, then clear all latch tracking. Called on the recording 1->0 edge (any
 * stop path) and idempotent. */
static void cc_finalize_latch(seq8_track_t *tr) {
    if (tr->cc_latched) {
        cc_auto_t *a = &tr->clip_cc_auto[tr->active_clip];
        int k;
        for (k = 0; k < 8; k++)
            if ((tr->cc_latched >> k) & 1) cc_auto_decimate(a, k);
    }
    tr->cc_latched = 0;
    tr->cc_prev_ct = 0;
    memset(tr->cc_latch_last_snap, 0xFF, sizeof(tr->cc_latch_last_snap));
}

/* Insert or update a sorted automation point for knob k in cc_auto_t a.
 * If a point at this tick already exists its value is overwritten.
 * Drops silently when the array is full. */
static void cc_auto_set_point(cc_auto_t *a, int k, uint16_t tick, uint8_t val) {
    int i, n = (int)a->count[k];
    for (i = 0; i < n; i++) {
        if (a->ticks[k][i] == tick) { a->vals[k][i] = val; return; }
    }
    if (n >= CC_AUTO_MAX_POINTS) return;
    int ins = n;
    for (i = 0; i < n; i++) {
        if (a->ticks[k][i] > tick) { ins = i; break; }
    }
    for (i = n; i > ins; i--) {
        a->ticks[k][i] = a->ticks[k][i - 1];
        a->vals[k][i]  = a->vals[k][i - 1];
    }
    a->ticks[k][ins] = tick;
    a->vals[k][ins]  = val;
    a->count[k]++;
}

/* Evaluate the output value of lane k at clip tick t, given the loop window
 * [ws, we) in ticks. Implements the playback model:
 *   - inside a run (between/at recorded points): linear interpolation;
 *   - head (before first point) / tail (after last point) / empty lane:
 *       resting value set -> ramp to the loop-boundary anchor (closed curve
 *       that resets each cycle); unset ("—") -> undefined (send nothing).
 * The anchor at the loop boundary is the value of a real point at/before ws
 * if one exists, otherwise the resting value.
 * Returns 0..127, or -1 when nothing is defined here (sets *defined=0). */
/* Wrap a clip-absolute tick into a per-lane loop window. */
static inline uint32_t cc_lane_wrap_tick(uint32_t ct, uint32_t lws, uint32_t llen_ticks) {
    if (ct >= lws) return lws + ((ct - lws) % llen_ticks);
    uint32_t d = (lws - ct) % llen_ticks;
    return d == 0 ? lws : lws + llen_ticks - d;
}

static int cc_auto_eval(const cc_auto_t *a, int k, uint32_t t,
                        uint32_t ws, uint32_t we, int *defined) {
    int n = (int)a->count[k];
    uint8_t rest = a->rest_val[k];
    int rest_set = (rest != 0xFF);
    if (defined) *defined = 1;
    if (n == 0) {
        if (rest_set) return rest;
        if (defined) *defined = 0;
        return -1;
    }
    /* Window-aware scan: only consider points in [ws, we) for lo/hi */
    int lo = -1, hi = -1, fi = -1, i;
    for (i = 0; i < n; i++) {
        uint16_t tk = a->ticks[k][i];
        if (tk < (uint16_t)ws || tk >= (uint16_t)we) continue;
        if (fi == -1) fi = i;
        if (tk <= (uint16_t)t) lo = i;
        else if (hi == -1) { hi = i; }
    }
    /* Anchor: latest point at or before ws, else resting value */
    int anchor = rest_set ? (int)rest : -1;
    for (i = 0; i < n && a->ticks[k][i] <= (uint16_t)ws; i++)
        anchor = (int)a->vals[k][i];
    if (lo == -1) {
        /* HEAD: before the first in-window point */
        if (anchor < 0) { if (defined) *defined = 0; return -1; }
        if (fi == -1) return anchor;
        uint32_t fT = a->ticks[k][fi];
        if (fT <= ws || t <= ws) return (fT <= ws) ? (int)a->vals[k][fi] : anchor;
        int sp = (int)(fT - ws);
        int fr = (int)(t - ws) * 127 / sp;
        return clamp_i(anchor + ((int)a->vals[k][fi] - anchor) * fr / 127, 0, 127);
    } else if (hi == -1) {
        /* TAIL: after the last in-window point */
        if (anchor < 0) { if (defined) *defined = 0; return -1; }
        uint32_t lT = a->ticks[k][lo];
        if (lT >= we || t >= we) return (lT >= we) ? (int)a->vals[k][lo] : anchor;
        int sp = (int)(we - lT);
        int fr = (int)(t - lT) * 127 / sp;
        return clamp_i((int)a->vals[k][lo] + (anchor - (int)a->vals[k][lo]) * fr / 127, 0, 127);
    } else {
        /* INSIDE a run: interpolate lo..hi */
        int t0 = a->ticks[k][lo], t1 = a->ticks[k][hi];
        int v0 = a->vals[k][lo],  v1 = a->vals[k][hi];
        int sp = t1 - t0;
        if (sp <= 0) return v1;
        int fr = (int)(t - (uint32_t)t0) * 127 / sp;
        return clamp_i(v0 + (v1 - v0) * fr / 127, 0, 127);
    }
}

/* ---- Pad-pressure aftertouch automation (at_auto_t) ---- */

/* Reset: drop all lanes (free slots = AT_LANE_FREE, counts 0). */
static void at_auto_reset(at_auto_t *a) {
    memset(a, 0, sizeof(at_auto_t));
    memset(a->pitch, AT_LANE_FREE, AT_MAX_LANES);
}

/* True if the clip has any recorded AT data. */
static int at_auto_has_data(const at_auto_t *a) {
    int i;
    for (i = 0; i < AT_MAX_LANES; i++)
        if (a->pitch[i] != AT_LANE_FREE && a->count[i] > 0) return 1;
    return 0;
}

/* Find the lane for a pitch key (0-127 poly, 255 channel), or -1. */
static int at_auto_find_lane(const at_auto_t *a, uint8_t key) {
    int i;
    for (i = 0; i < AT_MAX_LANES; i++) if (a->pitch[i] == key) return i;
    return -1;
}

/* Find-or-allocate the lane for a pitch key; -1 if all lanes are in use. */
static int at_auto_alloc_lane(at_auto_t *a, uint8_t key) {
    int i = at_auto_find_lane(a, key);
    if (i >= 0) return i;
    for (i = 0; i < AT_MAX_LANES; i++)
        if (a->pitch[i] == AT_LANE_FREE) { a->pitch[i] = key; a->count[i] = 0; return i; }
    return -1;
}

/* Insert/update a sorted breakpoint in a lane. Drops silently when full. */
static void at_auto_set_point(at_auto_t *a, int lane, uint16_t tick, uint8_t val) {
    int i, n = (int)a->count[lane];
    for (i = 0; i < n; i++)
        if (a->ticks[lane][i] == tick) { a->vals[lane][i] = val; return; }
    if (n >= AT_MAX_POINTS) return;
    int ins = n;
    for (i = 0; i < n; i++) if (a->ticks[lane][i] > tick) { ins = i; break; }
    for (i = n; i > ins; i--) {
        a->ticks[lane][i] = a->ticks[lane][i - 1];
        a->vals[lane][i]  = a->vals[lane][i - 1];
    }
    a->ticks[lane][ins] = tick;
    a->vals[lane][ins]  = val;
    a->count[lane]++;
}

/* Evaluate lane output at clip tick t: linear interpolation inside the recorded
 * span, hold the last value after it, undefined before the first point (so no
 * pressure is asserted ahead of the gesture). *defined=0 → send nothing. */
static int at_auto_eval(const at_auto_t *a, int lane, uint32_t t, int *defined) {
    int n = (int)a->count[lane];
    if (defined) *defined = 1;
    if (n == 0 || (uint16_t)t < a->ticks[lane][0]) { if (defined) *defined = 0; return -1; }
    int lo = -1, hi = -1, i;
    for (i = 0; i < n; i++) {
        if (a->ticks[lane][i] <= (uint16_t)t) lo = i;
        else { hi = i; break; }
    }
    if (hi == -1) return (int)a->vals[lane][lo];   /* tail: hold last value */
    int t0 = a->ticks[lane][lo], t1 = a->ticks[lane][hi];
    int v0 = a->vals[lane][lo],  v1 = a->vals[lane][hi];
    int sp = t1 - t0;
    if (sp <= 0) return v1;
    int fr = (int)(t - (uint32_t)t0) * 127 / sp;
    return clamp_i(v0 + (v1 - v0) * fr / 127, 0, 127);
}

/* Emit a continuous-modulation value for knob k on track tr, branching on
 * the per-knob type: CC -> 0xB0 cc_assign[k] v; aftertouch -> 0xD0 v (2-byte,
 * pfx_emit's USB-MIDI CIN = status>>4 = 0xD already encodes the length). */
static void cc_emit(seq8_track_t *tr, int k, uint8_t v) {
    uint8_t ch = tr->channel & 0x0F;
    if (tr->cc_type[k] == 2)
        pfx_send(&tr->pfx, (uint8_t)(0xB0 | ch), (uint8_t)(101 + tr->cc_assign[k]), v);
    else if (tr->cc_type[k] == 1)
        pfx_send(&tr->pfx, (uint8_t)(0xD0 | ch), v, 0);
    else
        pfx_send(&tr->pfx, (uint8_t)(0xB0 | ch), tr->cc_assign[k], v);
}

/* LOAD-BEARING SPACING: the blank-line layout around these cold-path includes
 * is part of the phase-2 re-runnable gate — the split is proven correct by the
 * preprocessed TU being byte-identical pre/post split (`clang -E -P` per
 * dsp/CLAUDE.md). Adding/removing a blank line here (e.g. between the bake and
 * convert includes, or before the reset_all_loop_cycles decl) shifts that output
 * and silently breaks the gate. Do NOT "tidy" the spacing. */
#include "seq8_bake.c"
#include "seq8_convert.c"
static void reset_all_loop_cycles(seq8_instance_t *inst);

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
                        fx->route == ROUTE_EXTERNAL ? "external" :
                        fx->route == ROUTE_MOVE     ? "move"     : "schwung");

    if (!strcmp(key, "track_looper"))
        return snprintf(out, out_len, "%d", (int)fx->looper_on);

    /* Batch read: per-clip pfx params. Fields 0-16: NOTE FX K0-K4, HARMZ K0-K3,
     * MIDI DLY K0-K7 (legacy 17). Fields 17-23: SEQ ARP K1-K7 (style/rate/
     * octaves/gate/steps_mode/retrigger/sync). Fields 24-31: SEQ ARP step_vel[0..7]. */
    if (!strcmp(key, "pfx_snapshot"))
        return snprintf(out, out_len,
            "%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d "
            "%d %d %d %d %d %d %d %d %d %d %d",
            fx->octave_shift, fx->note_offset, fx->gate_time, fx->velocity_offset, fx->quantize,
            fx->octaver, fx->harmonize_1, fx->harmonize_2, fx->harmonize_3,
            fx->delay_time_idx, fx->delay_level, fx->repeat_times,
            fx->fb_velocity, fx->fb_note, fx->fb_gate_time, fx->fb_clock, fx->fb_note_random,
            (int)fx->arp.style, (int)fx->arp.rate_idx,
            (int)fx->arp.octaves, (int)fx->arp.gate_pct,
            (int)fx->arp.steps_mode, (int)fx->arp.retrigger, (int)fx->seq_arp_sync,
            (int)fx->arp.step_vel[0], (int)fx->arp.step_vel[1], (int)fx->arp.step_vel[2],
            (int)fx->arp.step_vel[3], (int)fx->arp.step_vel[4], (int)fx->arp.step_vel[5],
            (int)fx->arp.step_vel[6], (int)fx->arp.step_vel[7],
            fx->note_random, fx->note_random_mode, fx->fb_note_random_mode);

    if (!strcmp(key, "noteFX_octave"))    return snprintf(out, out_len, "%d", fx->octave_shift);
    if (!strcmp(key, "noteFX_offset"))    return snprintf(out, out_len, "%d", fx->note_offset);
    if (!strcmp(key, "noteFX_random"))      return snprintf(out, out_len, "%d", fx->note_random);
    if (!strcmp(key, "noteFX_random_mode")) return snprintf(out, out_len, "%d", fx->note_random_mode);
    /* Len mode lives only on clip_pfx_params (no play_fx_t mirror); read directly. */
    if (!strcmp(key, "noteFX_length_mode"))
        return snprintf(out, out_len, "%d",
                        (int)tr->clips[tr->active_clip].pfx_params.note_length_mode);
    if (!strcmp(key, "noteFX_gate"))      return snprintf(out, out_len, "%d", fx->gate_time);
    if (!strcmp(key, "noteFX_velocity"))  return snprintf(out, out_len, "%d", fx->velocity_offset);
    if (!strcmp(key, "quantize"))         return snprintf(out, out_len, "%d", fx->quantize);

    if (!strcmp(key, "harm_octaver"))     return snprintf(out, out_len, "%d", fx->octaver);
    if (!strcmp(key, "harm_interval1"))   return snprintf(out, out_len, "%d", fx->harmonize_1);
    if (!strcmp(key, "harm_interval2"))   return snprintf(out, out_len, "%d", fx->harmonize_2);
    if (!strcmp(key, "harm_interval3"))   return snprintf(out, out_len, "%d", fx->harmonize_3);

    if (!strcmp(key, "delay_time"))         return snprintf(out, out_len, "%d", fx->delay_time_idx);
    if (!strcmp(key, "delay_level"))        return snprintf(out, out_len, "%d", fx->delay_level);
    if (!strcmp(key, "delay_repeats"))      return snprintf(out, out_len, "%d", fx->repeat_times);
    if (!strcmp(key, "delay_vel_fb"))       return snprintf(out, out_len, "%d", fx->fb_velocity);
    if (!strcmp(key, "delay_pitch_fb"))     return snprintf(out, out_len, "%d", fx->fb_note);
    if (!strcmp(key, "delay_pitch_random"))      return snprintf(out, out_len, "%d", fx->fb_note_random);
    if (!strcmp(key, "delay_pitch_random_mode")) return snprintf(out, out_len, "%d", fx->fb_note_random_mode);
    if (!strcmp(key, "delay_gate_fb"))      return snprintf(out, out_len, "%d", fx->fb_gate_time);
    if (!strcmp(key, "delay_clock_fb"))     return snprintf(out, out_len, "%d", fx->fb_clock);
    if (!strcmp(key, "delay_retrig"))       return snprintf(out, out_len, "%d", fx->delay_retrig);

    /* TRACK ARP — per-track params read individually by readBankParams(t, 6) */
    if (!strcmp(key, "tarp_on"))         return snprintf(out, out_len, "%d", (int)tr->tarp_on);
    if (!strcmp(key, "tarp_style"))      return snprintf(out, out_len, "%d", (int)tr->tarp.style);
    if (!strcmp(key, "tarp_rate"))       return snprintf(out, out_len, "%d", (int)tr->tarp.rate_idx);
    if (!strcmp(key, "tarp_octaves"))    return snprintf(out, out_len, "%d", (int)tr->tarp.octaves);
    if (!strcmp(key, "tarp_gate"))       return snprintf(out, out_len, "%d", (int)tr->tarp.gate_pct);
    if (!strcmp(key, "tarp_steps_mode")) return snprintf(out, out_len, "%d", (int)tr->tarp.steps_mode);
    if (!strcmp(key, "tarp_latch"))         return snprintf(out, out_len, "%d", (int)tr->tarp_latch);
    if (!strcmp(key, "tarp_sync"))          return snprintf(out, out_len, "%d", (int)tr->tarp_sync);
    if (!strcmp(key, "tarp_retrigger"))     return snprintf(out, out_len, "%d", (int)tr->tarp.retrigger);
    if (!strcmp(key, "track_vel_override")) return snprintf(out, out_len, "%d", (int)tr->track_vel_override);
    /* Batch read: TRACK ARP step_vel[0..7] */
    if (!strcmp(key, "tarp_sv"))
        return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
            (int)tr->tarp.step_vel[0], (int)tr->tarp.step_vel[1],
            (int)tr->tarp.step_vel[2], (int)tr->tarp.step_vel[3],
            (int)tr->tarp.step_vel[4], (int)tr->tarp.step_vel[5],
            (int)tr->tarp.step_vel[6], (int)tr->tarp.step_vel[7]);
    /* Batch read: TRACK ARP step_int[0..7] (scale-degree offsets) */
    if (!strcmp(key, "tarp_si"))
        return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
            (int)tr->tarp.step_int[0], (int)tr->tarp.step_int[1],
            (int)tr->tarp.step_int[2], (int)tr->tarp.step_int[3],
            (int)tr->tarp.step_int[4], (int)tr->tarp.step_int[5],
            (int)tr->tarp.step_int[6], (int)tr->tarp.step_int[7]);
    /* Single read: TRACK ARP step_loop_len (1..8) */
    if (!strcmp(key, "tarp_sll"))
        return snprintf(out, out_len, "%d", (int)tr->tarp.step_loop_len);

    /* Rpt1 last-selected rate (single per-track) */
    if (!strcmp(key, "drrt"))
        return snprintf(out, out_len, "%d", (int)tr->drum_repeat_rate_idx);

    /* Batch read: Rpt2 per-lane rate idx[0..31] — JS init pulls this once
     * after state_load so S.drumRepeat2RatePerLane matches persisted DSP
     * state for LED highlight + onscreen rate display. */
    if (!strcmp(key, "drum_r2rt")) {
        int wpos = 0, l;
        for (l = 0; l < DRUM_LANES; l++) {
            int w = snprintf(out + wpos, out_len - wpos, l ? " %d" : "%d",
                             (int)tr->drum_repeat2_rate_idx[l]);
            if (w < 0 || wpos + w >= out_len) break;
            wpos += w;
        }
        return wpos;
    }

    return -1;
}

/* ------------------------------------------------------------------ */
/* Remote-UI snapshot: a FLAT JSON object of string values for the      */
/* browser piano roll. It MUST be flat-with-string-values because the   */
/* schwung-manager explodes get_param("state") into top-level keys and  */
/* drops any array/object/null field (remote_ui.go fetchAllParams) — so  */
/* structured data is packed into delimited strings, not nested JSON.    */
/* Selected-clip-scoped to stay well under 64KB. Native ints only.       */
/* Read-only + side-effect free (does NOT touch state_dirty; davebox     */
/* persistence uses the separate state_full path).                       */
/*                                                                       */
/* Field schema (each value is a string; the browser parses on ':' / ';'):*/
/*   rui_rev   = "<rev>"                                                  */
/*   rui_play  = "on:tick:bpm"                                           */
/*   rui_sel   = "track:clip:lane"   (lane=-1 melodic)                   */
/*   rui_clip  = "len:tps:loop_start:dir"   (selected clip)             */
/*   rui_glob  = "key:scale:swing_amt:swing_res:launch_quant:scale_aware" */
/*   rui_scale = 12 pitch-class in-scale bits (pc0..11 absolute)          */
/*   rui_index = per-track "pm:ac:qc:pl:<16 has-bits>", joined by ';'     */
/*   rui_notes = "tick:pitch:vel:gate;" list for the selected clip       */
/* ------------------------------------------------------------------ */
/* Emit sparse per-step trig conditions for one clip: "s:iter:rand:ratch:nudge;"
 * for each step (within the loop length) that has any non-default value. nudge =
 * the step's primary-note within-step tick offset. Returns the new cursor. */
static int rui_emit_steps(char *out, int n, int out_len, clip_t *cl) {
    #define APP2(...) do { if (n < out_len) n += snprintf(out + n, out_len - n, __VA_ARGS__); } while (0)
    int L = cl->length; if (L > SEQ_STEPS) L = SEQ_STEPS;
    for (int s = 0; s < L; s++) {
        int it = cl->step_iter[s], rd = cl->step_random[s], rt = cl->step_ratchet[s];
        int nudge = (cl->step_note_count[s] > 0) ? (int)cl->note_tick_offset[s][0] : 0;
        if (it || rd || rt || nudge) APP2("%d:%d:%d:%d:%d;", s, it, rd, rt, nudge);
    }
    #undef APP2
    return n;
}

/* Track-level playhead tick for the remote UI (rui_poll digest + rui_play).
 * Melodic tracks refresh tr->current_clip_tick every render tick, but the DRUM
 * advance branch only steps the per-lane clocks and never writes it — so for a
 * drum track that field is frozen at a stale melodic value, and the browser
 * (which interpolates from the last anchor, then re-anchors on every push)
 * visibly snaps back to the same spot ~10×/s. Derive the drum tick from the
 * DISPLAYED lane's own clock instead (rui_sel_lane when set, else lane 0 —
 * matching the snapshot's lane-0 grid reference), audible-mapped like the
 * melodic path so playback direction is honored. Read-side only: render-state
 * consumers of current_clip_tick (recording snapshots etc.) are untouched. */
static uint32_t rui_playhead_tick(seq8_instance_t *inst) {
    int t = inst->rui_sel_track; if (t < 0 || t >= NUM_TRACKS) t = 0;
    seq8_track_t *tr = &inst->tracks[t];
    if (tr->pad_mode == PAD_MODE_DRUM && tr->drum_clips[tr->active_clip]) {
        int l = (inst->rui_sel_lane >= 0 && inst->rui_sel_lane < DRUM_LANES)
                ? (int)inst->rui_sel_lane : 0;
        clip_t *dlc = &tr->drum_clips[tr->active_clip]->lanes[l].clip;
        return playback_audible_cct(dlc, tr->drum_current_step[l],
                                    tr->drum_tick_in_step[l]);
    }
    return tr->current_clip_tick;
}

static int seq8_remote_snapshot(seq8_instance_t *inst, char *out, int out_len) {
    if (!inst || !out || out_len <= 0) return -1;
    int t = inst->rui_sel_track; if (t < 0 || t >= NUM_TRACKS) t = 0;
    int c = inst->rui_sel_clip;  if (c < 0 || c >= NUM_CLIPS)  c = 0;
    seq8_track_t *tr = &inst->tracks[t];
    int drum = (tr->pad_mode == PAD_MODE_DRUM);
    /* CC automation is track-level, keyed by clip slot: melodic edits the selected
     * clip (c); drum playback evaluates the active clip (active_clip). */
    int cc_clip = drum ? (int)tr->active_clip : c;
    if (cc_clip < 0 || cc_clip >= NUM_CLIPS) cc_clip = 0;
    drum_clip_t *dclip = (drum && tr->drum_clips[tr->active_clip])
                         ? tr->drum_clips[tr->active_clip] : NULL;
    /* grid-reference clip: drum -> active drum clip lane 0; melodic -> selected clip.
     * (Drum lane keys are active-clip-scoped, so the drum view shows the ACTIVE clip.) */
    clip_t *gcl = dclip ? &dclip->lanes[0].clip : &tr->clips[c];

    int n = 0;  /* cursor; snprintf returns intended length, so guard each append */
    #define APP(...) do { if (n < out_len) n += snprintf(out + n, out_len - n, __VA_ARGS__); } while (0)

    /* Tail headroom (bytes). The variable-length fields (rui_dnotes, rui_notes,
     * rui_cc) can in a pathological session exceed the 64 KB buffer; if they
     * truncate mid-token the closing quote+brace never get written, the JSON is
     * invalid, and the manager drops the whole snapshot silently — bricking the
     * remote editor for that clip until it is thinned on-device. Every unbounded
     * loop below stops once the cursor reaches out_len - RUI_TAIL_RESERVE, so the
     * remaining fixed field-wrappers and the closing "} always fit and the
     * snapshot is ALWAYS valid JSON (it degrades to fewer notes, never garbage). */
    const int RUI_TAIL_RESERVE = 96;
    int trunc = 0;  /* set when any reserve-guarded loop stops early on the budget */

    double bpm = (inst->tracks[0].pfx.cached_bpm > 0)
                 ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT;
    APP("{\"rui_rev\":\"%u\"", (unsigned)inst->rui_rev);
    APP(",\"rui_play\":\"%d:%u:%d\"",
        inst->playing ? 1 : 0, (unsigned)rui_playhead_tick(inst), (int)bpm);
    APP(",\"rui_sel\":\"%d:%d:%d\"", t, c, (int)inst->rui_sel_lane);
    APP(",\"rui_clip\":\"%d:%d:%d:%d\"",
        (int)gcl->length, (int)gcl->ticks_per_step, (int)gcl->loop_start,
        (int)gcl->playback_dir);
    /* global params: key:scale:swing_amt:swing_res:launch_quant:scale_aware (bpm in rui_play) */
    APP(",\"rui_glob\":\"%d:%d:%d:%d:%d:%d\"",
        (int)inst->pad_key, (int)inst->pad_scale, (int)inst->swing_amt,
        (int)inst->swing_res, (int)inst->launch_quant, (int)inst->scale_aware);
    /* rui_scale: 12 pitch-class bits (pc 0..11 absolute, key applied) — which
     * notes are in the current key+scale, so the piano roll can shade rows. */
    APP(",\"rui_scale\":\"");
    {
        int sc = inst->pad_scale; if (sc < 0 || sc >= 14) sc = 0;
        int kk = ((int)inst->pad_key) % 12; if (kk < 0) kk += 12;
        int smask[12] = {0};
        for (int d = 0; d < SCALE_SIZES[sc]; d++)
            smask[(kk + SCALE_IVLS[sc][d]) % 12] = 1;
        for (int pc = 0; pc < 12; pc++) APP("%d", smask[pc]);
    }
    APP("\"");

    /* per-clip FX (melodic only): 29 values in a fixed order the browser mirrors —
     * NOTE FX (8) | HARMZ (4) | MIDI DLY (10) | SEQ ARP (7). Edited via
     * tN_cC_pfx_set "key value". Drum lanes carry their own (smaller) pfx — later. */
    /* rui_pfx = 29 FX values. Melodic: the selected clip's pfx. Drum: the
     * SELECTED LANE's pfx (each drum lane has its own pfx chain), so the browser
     * can edit per-lane drum FX via tN_lL_pfx_set; empty if no lane selected. */
    clip_pfx_params_t *pf = NULL;
    if (!drum) pf = &gcl->pfx_params;
    else if (dclip && inst->rui_sel_lane >= 0 && inst->rui_sel_lane < DRUM_LANES)
        pf = &dclip->lanes[inst->rui_sel_lane].pfx_params;
    if (pf) {
        APP(",\"rui_pfx\":\"%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d\"",
            pf->octave_shift, pf->note_offset, pf->gate_time, pf->velocity_offset, pf->quantize,
            pf->note_random, pf->note_random_mode, (int)pf->note_length_mode,
            pf->octaver, pf->harmonize_1, pf->harmonize_2, pf->harmonize_3,
            pf->delay_time_idx, pf->delay_level, pf->repeat_times, pf->fb_velocity, pf->fb_note,
            pf->fb_note_random, pf->fb_note_random_mode, pf->fb_gate_time, pf->fb_clock, pf->delay_retrig,
            pf->seq_arp_style, pf->seq_arp_rate, pf->seq_arp_octaves, pf->seq_arp_gate,
            pf->seq_arp_steps_mode, pf->seq_arp_retrigger, pf->seq_arp_sync);
    } else {
        APP(",\"rui_pfx\":\"\"");
    }
    /* rui_lane = selected drum lane's "len:tps:loop_start:dir" (per-lane settings) */
    if (drum && dclip && inst->rui_sel_lane >= 0 && inst->rui_sel_lane < DRUM_LANES) {
        clip_t *lc = &dclip->lanes[inst->rui_sel_lane].clip;
        APP(",\"rui_lane\":\"%d:%d:%d:%d\"",
            (int)lc->length, (int)lc->ticks_per_step, (int)lc->loop_start, (int)lc->playback_dir);
    } else {
        APP(",\"rui_lane\":\"\"");
    }

    /* rui_ccmeta: per knob "assign,type,hasdata,rest,curval,ls,len,tps,restps" x8.
     * Emitted for melodic AND drum tracks (engine evaluates clip_cc_auto for both);
     * keyed by cc_clip (selected clip melodic, active clip drum). */
    APP(",\"rui_ccmeta\":\"");
    {
        cc_auto_t *ca = &tr->clip_cc_auto[cc_clip];
        for (int k = 0; k < 8; k++) {
            APP("%s%d,%d,%d,%d,%d,%d,%d,%d,%d", k ? ";" : "",
                (int)tr->cc_assign[k], (int)tr->cc_type[k],
                ca->count[k] > 0 ? 1 : 0, (int)ca->rest_val[k], (int)tr->cc_auto_cur_val[k],
                (int)ca->lane_loop_start[k], (int)ca->lane_length[k],
                (int)ca->lane_tps[k], (int)ca->lane_res_tps[k]);
        }
    }
    APP("\"");

    /* per-step trig conditions (sparse "s:iter:rand:ratch:nudge;") for the step
     * strip. rui_steps = selected MELODIC clip; rui_dsteps = selected drum LANE
     * (drum step params are per-lane). Both always present (one empty per mode). */
    APP(",\"rui_steps\":\"");
    if (!drum) n = rui_emit_steps(out, n, out_len, gcl);
    APP("\"");
    APP(",\"rui_dsteps\":\"");
    if (drum && dclip && inst->rui_sel_lane >= 0 && inst->rui_sel_lane < DRUM_LANES)
        n = rui_emit_steps(out, n, out_len, &dclip->lanes[inst->rui_sel_lane].clip);
    APP("\"");

    /* per-track index: "pm:ac:qc:pl:<16 has-bits>:route:chan:mute:solo", tracks joined by ';'
     * (pm=pad_mode, ac=active clip, qc=queued clip or -1, pl=clip playing,
     * route=0 Schwung/1 Move/2 External, chan=1-based MIDI channel,
     * mute/solo=0|1 live per-track state) — drives the session grid's
     * playing/queued indicators + routing labels + mute/solo in track headers. */
    APP(",\"rui_index\":\"");
    for (int ti = 0; ti < NUM_TRACKS; ti++) {
        seq8_track_t *trk = &inst->tracks[ti];
        APP("%s%d:%d:%d:%d:", ti ? ";" : "", (int)trk->pad_mode, (int)trk->active_clip,
            (int)trk->queued_clip, trk->clip_playing ? 1 : 0);
        for (int ci = 0; ci < NUM_CLIPS; ci++) {
            int has = 0;
            if (trk->pad_mode == PAD_MODE_DRUM) {
                /* drum: scan all lanes of the drum clip (NULL until first used) */
                drum_clip_t *dc = trk->drum_clips[ci];
                if (dc) {
                    for (int l = 0; l < DRUM_LANES && !has; l++) {
                        clip_t *lc = &dc->lanes[l].clip;
                        for (uint16_t k = 0; k < lc->note_count; k++)
                            if (lc->notes[k].active) { has = 1; break; }
                    }
                }
            } else {
                clip_t *cc = &trk->clips[ci];
                for (uint16_t k = 0; k < cc->note_count; k++)
                    if (cc->notes[k].active) { has = 1; break; }
            }
            APP("%d", has);
        }
        APP(":%d:%d:%d:%d", (int)trk->pfx.route, (int)trk->channel + 1,
            (int)inst->mute[ti], (int)inst->solo[ti]);
    }
    APP("\"");

    /* rui_cond: conductor state — "condTrk:clip:lock;resp0,oct0,when0;...;respN,octN,whenN"
     * Short form "-1:-1:0" when no conductor. Lets the remote badge responder
     * tracks and expose the per-track responder/oct/when editor. */
    APP(",\"rui_cond\":\"");
    {
        int ct = (int)inst->conductor_track;
        if (ct >= 0 && ct < NUM_TRACKS) {
            seq8_track_t *ctr = &inst->tracks[ct];
            int cc_idx = (int)ctr->active_clip;
            clip_t *ccl = &ctr->clips[cc_idx];
            APP("%d:%d:%d", ct, cc_idx, (int)ccl->cond_lock);
            for (int ti = 0; ti < NUM_TRACKS; ti++)
                APP(";%d,%d,%d", (int)ccl->cond_resp[ti], (int)ccl->cond_oct[ti], (int)ccl->cond_when[ti]);
        } else {
            APP("-1:-1:0");
        }
    }
    APP("\"");

    if (dclip) {
        /* drum: 32 lanes "note,has,mute,solo" for the active drum clip */
        APP(",\"rui_dlanes\":\"");
        for (int l = 0; l < DRUM_LANES; l++) {
            clip_t *lc = &dclip->lanes[l].clip;
            int has = 0;
            for (uint16_t k = 0; k < lc->note_count; k++)
                if (lc->notes[k].active) { has = 1; break; }
            int mu = (tr->drum_lane_mute >> l) & 1, so = (tr->drum_lane_solo >> l) & 1;
            /* note,has,mute,solo,length,loop_start,tps — the loop fields let the remote
             * UI draw each lane's [ls, ls+len) window for a per-lane overview. */
            APP("%s%d,%d,%d,%d,%d,%d,%d", l ? ";" : "", (int)dclip->lanes[l].midi_note, has, mu, so,
                (int)lc->length, (int)lc->loop_start,
                (int)(lc->ticks_per_step ? lc->ticks_per_step : TICKS_PER_STEP));
        }
        APP("\"");
        /* per-lane hits: "L|tick:vel:gate,tick:vel:gate;L|..." (non-empty lanes) */
        APP(",\"rui_dnotes\":\"");
        int firstlane = 1;
        for (int l = 0; l < DRUM_LANES; l++) {
            if (n >= out_len - RUI_TAIL_RESERVE) { trunc = 1; break; }   /* keep JSON closable */
            clip_t *lc = &dclip->lanes[l].clip;
            int wrote = 0;
            for (uint16_t k = 0; k < lc->note_count; k++) {
                note_t *nt = &lc->notes[k];
                if (!nt->active) continue;
                if (n >= out_len - RUI_TAIL_RESERVE) { trunc = 1; break; }
                if (!wrote) { APP("%s%d|%u:%d:%d", firstlane ? "" : ";", l,
                                  (unsigned)nt->tick, (int)nt->vel, (int)nt->gate);
                              firstlane = 0; wrote = 1; }
                else APP(",%u:%d:%d", (unsigned)nt->tick, (int)nt->vel, (int)nt->gate);
            }
        }
        APP("\"");
        APP(",\"rui_notes\":\"\"");
    } else {
        /* melodic: selected clip notes */
        APP(",\"rui_notes\":\"");
        for (uint16_t k = 0; k < gcl->note_count; k++) {
            note_t *nt = &gcl->notes[k];
            if (!nt->active) continue;
            if (n >= out_len - RUI_TAIL_RESERVE) { trunc = 1; break; }
            APP("%u:%d:%d:%d;", (unsigned)nt->tick, (int)nt->pitch, (int)nt->vel, (int)nt->gate);
        }
        APP("\"");
    }

    /* rui_cc: breakpoints "k|tick:val,tick:val" for the focused knob only.
     * Emitted LAST — after the structural fields (index/cond/dlanes) and the
     * note content — so an over-large focused CC lane (up to CC_AUTO_MAX_POINTS)
     * can only ever starve ITSELF, never the session grid or notes. The point
     * loop stops before the final closers so the JSON always closes cleanly. */
    APP(",\"rui_cc\":\"");
    if (inst->rui_cc_focus >= 0 && inst->rui_cc_focus < 8) {
        int k = inst->rui_cc_focus;
        cc_auto_t *ca = &tr->clip_cc_auto[cc_clip];
        APP("%d|", k);
        for (int i = 0; i < (int)ca->count[k]; i++) {
            /* Reserve the full tail headroom (not a bare few bytes): the max
             * point token here is ",65535:127" (10 B) and the closing "}
             * plus the optional ,"rui_trunc":1 (~14 B) must all still fit —
             * an unterminated snapshot is silently dropped by the manager. */
            if (n >= out_len - RUI_TAIL_RESERVE) { trunc = 1; break; }
            APP("%s%d:%d", i ? "," : "", (int)ca->ticks[k][i], (int)ca->vals[k][i]);
        }
    }
    APP("\"");

    /* Truncation indicator: 1 if ANY variable-length loop (rui_dnotes /
     * rui_notes / rui_cc) stopped early on its budget guard, so the browser can
     * badge "some notes hidden". Emitted UNCONDITIONALLY (0 when clean): the
     * browser merges snapshot fields into a sticky per-key cache, so an
     * absent-when-clean key would leave a stale 1 behind after the clip is
     * thinned. ~15 B — fits inside RUI_TAIL_RESERVE (96), and it sits before
     * the closing brace, after the last guarded loop, so it can never itself
     * be starved. */
    APP(",\"rui_trunc\":%d", trunc);

    APP("}");
    #undef APP
    if (n >= out_len) n = out_len - 1;
    out[n] = '\0';
    return n;
}

/* ------------------------------------------------------------------ */
/* get_param                                                            */
/* ------------------------------------------------------------------ */

static int get_param(void *instance, const char *key, char *out, int out_len) {
    seq8_instance_t *inst = (seq8_instance_t *)instance;
    if (!key || !out || out_len <= 0) return -1;

    /* One-shot: Clock-Follow start fell back to the solo clock (Move never
     * started). JS polls this and pops a brief warning; reading clears it. */
    if (!strcmp(key, "clock_follow_fallback")) {
        int v = inst->solo_fallback_pending ? 1 : 0;
        inst->solo_fallback_pending = 0;
        return snprintf(out, out_len, "%d", v);
    }

    if (!strcmp(key, "state")) {
        /* Remote-UI snapshot for the browser piano roll. This is the key the
         * schwung-manager reads on subscribe (comp+":state"); davebox's own
         * persistence uses state_full, so claiming "state" here is free. */
        return seq8_remote_snapshot(inst, out, out_len);
    }

    if (!strcmp(key, "rui_rev")) {
        /* Cheap monotonic edit counter, bumped by rui_mark()/rui_touch() on every
         * remote content edit (note/lane/length/dir/pfx) — NOT on mere clip
         * selection. The on-device JS polls this each pollDSP cycle and, when it
         * changes, reads rui_dirty (below) to re-sync only the changed clips. */
        return snprintf(out, out_len, "%u", (unsigned)inst->rui_rev);
    }

    if (!strcmp(key, "rui_dirty")) {
        /* Read-and-clear targeted-resync digest. Meaningful only when rui_rev
         * changed (the JS gates on that). Emits a syncClipsTargeted infoStr:
         * "m t c ..." (all-melodic), "d t c ..." (all-drum), or "FULL" (scope
         * unknown / overflow / mixed drum+melodic → JS does a full re-sync).
         * Clearing the accumulator makes each edit re-sync exactly once; a rare
         * poll/edit race that reads it empty degrades to a safe full sync. */
        int len;
        if (inst->rui_dirty_full || inst->rui_dirty_n == 0) {
            len = snprintf(out, out_len, "FULL");
        } else {
            int drum = 0, mel = 0;
            for (uint8_t i = 0; i < inst->rui_dirty_n; i++) {
                int dt = inst->rui_dirty_t[i];
                if (dt >= 0 && dt < NUM_TRACKS &&
                    inst->tracks[dt].pad_mode == PAD_MODE_DRUM) drum++;
                else mel++;
            }
            if (drum && mel) {
                len = snprintf(out, out_len, "FULL");
            } else {
                int n = snprintf(out, out_len, "%c", drum ? 'd' : 'm');
                for (uint8_t i = 0; i < inst->rui_dirty_n && n > 0 && n < (int)out_len; i++)
                    n += snprintf(out + n, (size_t)((int)out_len - n), " %u %u",
                                  (unsigned)inst->rui_dirty_t[i],
                                  (unsigned)inst->rui_dirty_c[i]);
                len = n;
            }
        }
        inst->rui_dirty_full = 0;
        inst->rui_dirty_n    = 0;
        return len;
    }

    if (!strcmp(key, "rui_poll")) {
        /* Cheap poll digest "rev:on:tick:bpm" — same values as the snapshot's
         * rui_rev + rui_play, but with NO note/step serialization. The manager
         * reads this every browser poll and only does the full get_param("state")
         * read when rev changes (content edit); while playing it pushes just the
         * playhead. Keeps idle/playing polls off the heavy snapshot path. */
        double pbpm = (inst->tracks[0].pfx.cached_bpm > 0)
                      ? inst->tracks[0].pfx.cached_bpm : (double)BPM_DEFAULT;
        return snprintf(out, out_len, "%u:%d:%u:%d",
                        (unsigned)inst->rui_rev, inst->playing ? 1 : 0,
                        (unsigned)rui_playhead_tick(inst), (int)pbpm);
    }

    if (!strcmp(key, "module_id")) {
        /* Remote-UI discovery probe. davebox runs as an overtake tool (no chain
         * slot), so the schwung-manager can't find it via the per-slot
         * "synth_module" key. Instead it probes "overtake_dsp:module_id" on the
         * active overtake DSP; answering here opts davebox in to having its
         * web_ui.html served. Any overtake tool that ships a web_ui.html and
         * answers this key gets a remote UI — generic, no host C change. */
        return snprintf(out, out_len, "davebox");
    }

    if (!strcmp(key, "state_full")) {
        /* Only return a payload when state is dirty. Returning the cached
         * state_buf when clean made JS pollDSP unconditionally overwrite the
         * on-disk file with stale state — defeating Clear Session and the
         * deferred clear path. */
        if (!inst->state_dirty || inst->state_version_mismatch) {
            out[0] = '\0';
            return 0;
        }
        FILE *_fp = fmemopen(inst->state_buf, sizeof(inst->state_buf) - 1, "w");
        if (_fp) {
            seq8_do_serialize(inst, _fp);
            long _pos = ftell(_fp);
            fclose(_fp);
            if (_pos >= 0 && _pos < (long)(sizeof(inst->state_buf) - 1)) {
                inst->state_buf[_pos] = '\0';
            } else {
                /* overflow — fall back to synchronous file write */
                seq8_ilog(inst, "state_full: overflow, falling back to file write");
                seq8_save_state(inst);
                inst->state_buf[0] = '\0';
            }
        }
        inst->state_dirty = 0;
        size_t _len = strlen(inst->state_buf);
        if (_len >= (size_t)out_len) _len = (size_t)(out_len - 1);
        memcpy(out, inst->state_buf, _len);
        out[_len] = '\0';
        return (int)_len;
    }
    if (!strcmp(key, "state_dirty"))
        return snprintf(out, out_len, "%d", (int)inst->state_dirty);
    if (!strcmp(key, "pad_dispatch_muted"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_dispatch_muted : 0);
    if (!strcmp(key, "pad_note_map_0"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_note_map[inst->active_track][0] : 255);
    if (!strcmp(key, "last_restore"))
        return snprintf(out, out_len, "%s", inst->last_restore_info);

    if (!strcmp(key, "clock_follow_on"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->clock_follow_on : 0);
    if (!strcmp(key, "clock_send_on"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->clock_send_on : 0);
    /* Following-and-running indicator for the UI (EXT vs idle). */
    if (!strcmp(key, "clock_follow_running"))
        return snprintf(out, out_len, "%d",
                        (inst && inst->clock_follow_on && inst->ext_transport_running) ? 1 : 0);
    /* Bring-up confirm: incoming realtime counters. "f8 fa fb fc last run pend". */
    if (!strcmp(key, "clock_dbg"))
        return snprintf(out, out_len, "%u %u %u %u %02X %d %d",
                        inst ? inst->dbg_f8_count : 0,
                        inst ? (unsigned)inst->dbg_fa_count : 0,
                        inst ? (unsigned)inst->dbg_fb_count : 0,
                        inst ? (unsigned)inst->dbg_fc_count : 0,
                        inst ? (unsigned)inst->dbg_last_rt : 0,
                        (inst && inst->ext_transport_running) ? 1 : 0,
                        inst ? (int)inst->ext_tick_pending : 0);

    if (!strcmp(key, "playing"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->playing : 0);
    if (!strcmp(key, "active_track"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->active_track : 0);
    if (!strcmp(key, "key"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_key : 9);
    if (!strcmp(key, "scale"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->pad_scale : 0);
    if (!strcmp(key, "conductor_track"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->conductor_track : -1);
    if (!strcmp(key, "scale_aware"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->scale_aware : 0);
    if (!strcmp(key, "inp_quant"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->inp_quant : 0);
    if (!strcmp(key, "midi_in_channel"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->midi_in_channel : 0);
    if (!strcmp(key, "metro_on"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->metro_on : 1);
    if (!strcmp(key, "metro_vol"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->metro_vol : 80);
    if (!strcmp(key, "metro_beat_count"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->metro_beat_count : 0);
    if (!strcmp(key, "launch_quant"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->launch_quant : 0);
    if (!strcmp(key, "swing_amt"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->swing_amt : 0);
    if (!strcmp(key, "swing_res"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->swing_res : 0);
    if (!strcmp(key, "version"))
        return snprintf(out, out_len, "6");
    if (!strcmp(key, "instance_id"))
        return snprintf(out, out_len, "%u", inst ? inst->instance_nonce : 0);
    if (!strcmp(key, "state_version_mismatch"))
        return snprintf(out, out_len, "%d", inst ? (int)inst->state_version_mismatch : 0);
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

    /* state_snapshot: single call returning all poll-loop values.
     * Format: "playing cs0..cs7 ac0..ac7 qc0..qc7 count_in cp0..cp7 wr0..wr7 ps0..ps7 flash_eighth flash_sixteenth metro_beat_count master_pos looper_state merge_state"
     * 57 values total. Replaces individual get_param calls in pollDSP(). */
    if (!strcmp(key, "state_snapshot")) {
        if (!inst) return snprintf(out, out_len,
            "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 -1 -1 -1 -1 -1 -1 -1 0"
            " 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0");
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
        pos += snprintf(out + pos, (size_t)(out_len - pos), " %d", (int)inst->merge_state);
        return pos;
    }

    if (!inst) return -1;

    /* Track-prefixed params: tN_<subkey> */
    if (key[0] == 't' && key[1] >= '0' && key[1] <= '7' && key[2] == '_') {
        int tidx = key[1] - '0';
        const char *sub = key + 3;
        seq8_track_t *tr = &inst->tracks[tidx];

        if (!strcmp(sub, "cc_assigns"))
            return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
                (int)tr->cc_assign[0], (int)tr->cc_assign[1],
                (int)tr->cc_assign[2], (int)tr->cc_assign[3],
                (int)tr->cc_assign[4], (int)tr->cc_assign[5],
                (int)tr->cc_assign[6], (int)tr->cc_assign[7]);
        if (!strcmp(sub, "cc_live_vals"))
            /* Returns cc_auto_last_sent[0..7]; 255 = automation hasn't fired yet */
            return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
                (int)tr->cc_auto_last_sent[0], (int)tr->cc_auto_last_sent[1],
                (int)tr->cc_auto_last_sent[2], (int)tr->cc_auto_last_sent[3],
                (int)tr->cc_auto_last_sent[4], (int)tr->cc_auto_last_sent[5],
                (int)tr->cc_auto_last_sent[6], (int)tr->cc_auto_last_sent[7]);
        if (!strcmp(sub, "cc_cur_vals"))
            /* Defined output value at the playhead per knob; 255 = "—". */
            return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
                (int)tr->cc_auto_cur_val[0], (int)tr->cc_auto_cur_val[1],
                (int)tr->cc_auto_cur_val[2], (int)tr->cc_auto_cur_val[3],
                (int)tr->cc_auto_cur_val[4], (int)tr->cc_auto_cur_val[5],
                (int)tr->cc_auto_cur_val[6], (int)tr->cc_auto_cur_val[7]);
        if (!strcmp(sub, "cc_types"))
            return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
                (int)tr->cc_type[0], (int)tr->cc_type[1],
                (int)tr->cc_type[2], (int)tr->cc_type[3],
                (int)tr->cc_type[4], (int)tr->cc_type[5],
                (int)tr->cc_type[6], (int)tr->cc_type[7]);
        if (!strcmp(sub, "current_step"))
            return snprintf(out, out_len, "%d", (int)tr->current_step);
        if (!strcmp(sub, "recording_pending_page"))
            return snprintf(out, out_len, "%d", (int)tr->recording_pending_page);
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
            if (!tr->drum_clips[tr->active_clip])
                return snprintf(out, out_len, "0");
            for (l = 0; l < DRUM_LANES; l++) {
                clip_t *dlc = &tr->drum_clips[tr->active_clip]->lanes[l].clip;
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
        if (!strcmp(sub, "diq"))
            return snprintf(out, out_len, "%d", (int)tr->drum_inp_quant);
        if (!strcmp(sub, "drum_repeat_sync"))
            return snprintf(out, out_len, "%u", (unsigned)tr->drum_repeat_sync);
        /* Playback direction for the active melodic clip (0=Fwd, 1=Bwd,
         * 2=PPFwd, 3=PPBwd). */
        if (!strcmp(sub, "clip_playback_dir"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].playback_dir);
        /* Playback style (0=Step, 1=Audio) for active melodic clip. */
        if (!strcmp(sub, "clip_playback_audio_reverse"))
            return snprintf(out, out_len, "%d",
                            (int)tr->clips[tr->active_clip].playback_audio_reverse);
        /* tarp_held: space-separated MIDI pitches currently in TARP input buffer
         * (held physical + latched). Empty when buffer is empty. Polled by JS to
         * light source pads while TARP is latched. */
        /* tarp_fc: monotonic count of TARP step-fire events. JS reads this
         * each tick to drive the Loop button's TARP-rate blink while latched.
         * Only parity is consumed; uint16 wrap is harmless. */
        if (!strcmp(sub, "tarp_fc"))
            return snprintf(out, out_len, "%u", (unsigned)tr->tarp.fire_count);
        if (!strcmp(sub, "tarp_held")) {
            int n = (int)tr->tarp.held_count;
            if (n <= 0) { out[0] = '\0'; return 0; }
            int pos = 0, i;
            for (i = 0; i < n; i++) {
                if (i > 0 && pos < out_len - 1) out[pos++] = ' ';
                pos += snprintf(out + pos, (size_t)(out_len - pos),
                                "%d", (int)tr->tarp.held_pitch[i]);
                if (pos >= out_len - 1) break;
            }
            return pos;
        }
        /* tN_lL_* — drum lane getters (lane_note, note_count, steps, step_S_*) */
        if (sub[0] == 'l' && sub[1] >= '0' && sub[1] <= '9') {
            int lidx = 0;
            const char *p2 = sub + 1;
            while (*p2 >= '0' && *p2 <= '9') { lidx = lidx * 10 + (*p2 - '0'); p2++; }
            if (lidx < 0 || lidx >= DRUM_LANES) return -1;
            if (!tr->drum_clips[tr->active_clip]) return snprintf(out, out_len, "0");
            drum_lane_t *dlane = &tr->drum_clips[tr->active_clip]->lanes[lidx];
            clip_t      *dlc   = &dlane->clip;
            if (!strcmp(p2, "_lane_note"))
                return snprintf(out, out_len, "%d", (int)dlane->midi_note);
            if (!strcmp(p2, "_note_count"))
                return snprintf(out, out_len, "%d", (int)dlc->note_count);
            if (!strcmp(p2, "_length"))
                return snprintf(out, out_len, "%d", (int)dlc->length);
            if (!strcmp(p2, "_playback_dir"))
                return snprintf(out, out_len, "%d", (int)dlc->playback_dir);
            if (!strcmp(p2, "_playback_audio_reverse"))
                return snprintf(out, out_len, "%d", (int)dlc->playback_audio_reverse);
            if (!strcmp(p2, "_loop_start"))
                return snprintf(out, out_len, "%d", (int)dlc->loop_start);
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
                if (!strcmp(q, "_iter"))
                    return snprintf(out, out_len, "%d", (int)dlc->step_iter[sidx]);
                if (!strcmp(q, "_rand"))
                    return snprintf(out, out_len, "%d", (int)dlc->step_random[sidx]);
                if (!strcmp(q, "_ratch"))
                    return snprintf(out, out_len, "%d", (int)dlc->step_ratchet[sidx]);
                return -1;
            }
            if (!strcmp(p2, "_pfx_snapshot")) {
                drum_pfx_params_t *dp = &dlane->pfx_params;
                /* Slot 9 (10th value) is delay_retrig — K6 in the drum bank
                 * layout after K7=Retrg was unblocked. JS reader at
                 * refreshDrumLaneBankParams maps slot 9 → bankParams[3][6].
                 * Slot 10 (11th value) = note_length_mode (NOTE FX K5 Len). */
                return snprintf(out, out_len,
                    "%d %d %d %d %d %d %d %d %d %d %d",
                    dp->gate_time, dp->velocity_offset, dp->quantize,
                    dp->delay_time_idx, dp->delay_level, dp->repeat_times,
                    dp->fb_velocity, dp->fb_gate_time, dp->fb_clock, dp->delay_retrig,
                    (int)dp->note_length_mode);
            }
            /* _repeat_state: gate vs0..vs7 n0..n7 (18 space-separated values) */
            if (!strcmp(p2, "_repeat_state")) {
                int s;
                int pos = snprintf(out, out_len, "%d", (int)tr->drum_repeat_gate[lidx]);
                for (s = 0; s < 8 && pos < out_len - 4; s++)
                    pos += snprintf(out + pos, out_len - pos, " %d", (int)tr->drum_repeat_vel_scale[lidx][s]);
                for (s = 0; s < 8 && pos < out_len - 4; s++)
                    pos += snprintf(out + pos, out_len - pos, " %d", (int)(int8_t)tr->drum_repeat_nudge[lidx][s]);
                if (pos < out_len - 4)
                    pos += snprintf(out + pos, out_len - pos, " %d", (int)tr->drum_repeat_gate_len[lidx]);
                return pos;
            }
            /* _repeat_debug: live engine state + nudge for all 8 steps */
            if (!strcmp(p2, "_repeat_debug")) {
                int s;
                uint8_t rl = tr->drum_repeat_lane;
                int pos = snprintf(out, out_len, "%d %d %d %d %d %d",
                    (int)tr->drum_repeat_active,
                    (int)rl,
                    (int)tr->drum_repeat_gate[rl],
                    (int)tr->drum_repeat_step,
                    (int)tr->drum_repeat_phase,
                    (int)tr->drum_repeat_rate_idx);
                for (s = 0; s < 8 && pos < out_len - 6; s++)
                    pos += snprintf(out + pos, out_len - pos, " %d",
                        (int)(int8_t)tr->drum_repeat_nudge[rl][s]);
                return pos;
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
                if (!strcmp(q, "_iter"))
                    return snprintf(out, out_len, "%d", (int)cl->step_iter[sidx]);
                if (!strcmp(q, "_rand"))
                    return snprintf(out, out_len, "%d", (int)cl->step_random[sidx]);
                if (!strcmp(q, "_ratch"))
                    return snprintf(out, out_len, "%d", (int)cl->step_ratchet[sidx]);
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
                    if (sn < SEQ_STEPS) out[sn] = '1';
                }
                out[SEQ_STEPS] = '\0';
                return SEQ_STEPS;
            }
            if (!strncmp(p, "_length", 7))
                return snprintf(out, out_len, "%d", (int)cl->length);
            if (!strncmp(p, "_loop_start", 11))
                return snprintf(out, out_len, "%d", (int)cl->loop_start);
            if (!strncmp(p, "_active", 7))
                return snprintf(out, out_len, "%d", (int)cl->active);
            if (!strncmp(p, "_drum_has_content", 17)) {
                int dl, any = 0;
                if (tr->drum_clips[cidx])
                    for (dl = 0; dl < DRUM_LANES && !any; dl++)
                        if (tr->drum_clips[cidx]->lanes[dl].clip.note_count > 0) any = 1;
                return snprintf(out, out_len, "%d", any);
            }
            if (!strncmp(p, "_tps", 4))
                return snprintf(out, out_len, "%d", (int)cl->ticks_per_step);
            /* Conductor per-clip control banks (8-wide). Phase 2 storage readback. */
            if (!strcmp(p, "_cond_resp")) {
                int ci;
                if (out_len < NUM_TRACKS + 1) return -1;
                for (ci = 0; ci < NUM_TRACKS; ci++) out[ci] = cl->cond_resp[ci] ? '1' : '0';
                out[NUM_TRACKS] = '\0';
                return NUM_TRACKS;
            }
            if (!strcmp(p, "_cond_when")) {
                int ci;
                if (out_len < NUM_TRACKS + 1) return -1;
                for (ci = 0; ci < NUM_TRACKS; ci++) out[ci] = cl->cond_when[ci] ? '1' : '0';
                out[NUM_TRACKS] = '\0';
                return NUM_TRACKS;
            }
            if (!strcmp(p, "_cond_lock")) {
                return snprintf(out, out_len, "%d", cl->cond_lock ? 1 : 0);
            }
            if (!strcmp(p, "_cond_oct")) {
                int ci, pos = 0;
                if (out_len < 1) return -1;
                out[0] = '\0';
                for (ci = 0; ci < NUM_TRACKS; ci++) {
                    int n = snprintf(out + pos, (size_t)(out_len - pos),
                                     "%s%d", (ci ? " " : ""), (int)cl->cond_oct[ci]);
                    if (n < 0 || pos + n >= out_len) break;
                    pos += n;
                }
                return pos;
            }
            if (!strcmp(p, "_export")) {
                /* Non-destructive melodic bake for Ableton export. Writes the
                 * notes ("<tick>:<pitch>:<vel>:<gate>;...") to EXPORT_RENDER_PATH
                 * and returns the header "<total_ticks> <note_count> <brace_ticks>"
                 * (always tiny — no 16KB get_param cap). Auto-detect from pfx:
                 *   randomness → bake 8 distinct cycles (clip = 8 cycles long)
                 *   delay/repeat → wrap EVERY cycle (echoes fold to steady-state)
                 * The loop brace = the whole exported clip (for a normal 1-cycle
                 * clip that equals the original length). Empty/drum → "0 0 0", no
                 * file. n=-1 on write fail. */
                int t_idx = (int)(tr - inst->tracks);
                clip_pfx_params_t *cp = &cl->pfx_params;
                int hasDelay  = (cp->delay_level > 0);
                /* Randomness that varies per bake pass → capture 8 distinct cycles:
                 * NOTE FX Pitch Random, a Rnd/RnO arp style, or (when delay is on)
                 * the DELAY bank's feedback Pitch Random, which randomizes echo pitches. */
                int hasRandom = (cp->note_random > 0)
                             || (cp->seq_arp_style == 8) || (cp->seq_arp_style == 9)
                             || (cp->fb_note_random > 0 && hasDelay);
                int loops     = hasRandom ? 8 : 1;        /* randomness → 8 distinct cycles */
                int wrap_from = hasDelay  ? 0 : loops;    /* delay → wrap every cycle; else none */

                static bake_note_t rmc_export[BAKE_BUF * 8];
                uint32_t span = 0, cyc = 0;
                int n = render_melodic_clip(inst, t_idx, cidx, loops, wrap_from,
                                            rmc_export, BAKE_BUF * 8, &span, &cyc, 0);
                (void)cyc;
                if (n > 0) {
                    FILE *ef = fopen(EXPORT_RENDER_PATH, "w");
                    if (ef) {
                        int k;
                        for (k = 0; k < n; k++)
                            fprintf(ef, "%u:%d:%d:%u;",
                                    (unsigned)rmc_export[k].tick,
                                    (int)rmc_export[k].pitch,
                                    (int)rmc_export[k].vel,
                                    (unsigned)rmc_export[k].gate);
                        fclose(ef);
                    } else {
                        n = -1;   /* JS treats <0 as no-clip */
                    }
                }
                return snprintf(out, out_len, "%u %d %u", (unsigned)span, n, (unsigned)span);
            }
            if (!strcmp(p, "_export_cond")) {
                /* Apply-Conductor export variant: identical to _export but folds
                 * the Conductor's transposition (non-destructively) against the
                 * Conductor's clip at the SAME scene index. render_melodic_clip
                 * gates the fold internally (no conductor / empty conductor clip /
                 * responder-off / conductor-track-itself → renders written pitch),
                 * so JS may call this for any responder clip safely. Same file +
                 * header format as _export. The conductor's LCM auto-extend may
                 * grow span (effectiveLoops) — captured in the returned header. */
                int t_idx = (int)(tr - inst->tracks);
                clip_pfx_params_t *cp = &cl->pfx_params;
                int hasDelay  = (cp->delay_level > 0);
                int hasRandom = (cp->note_random > 0)
                             || (cp->seq_arp_style == 8) || (cp->seq_arp_style == 9)
                             || (cp->fb_note_random > 0 && hasDelay);
                int loops     = hasRandom ? 8 : 1;
                int wrap_from = hasDelay  ? 0 : loops;

                static bake_note_t rmc_export_c[BAKE_BUF * 8];
                uint32_t span = 0, cyc = 0;
                int n = render_melodic_clip(inst, t_idx, cidx, loops, wrap_from,
                                            rmc_export_c, BAKE_BUF * 8, &span, &cyc, 1);
                (void)cyc;
                if (n > 0) {
                    FILE *ef = fopen(EXPORT_RENDER_PATH, "w");
                    if (ef) {
                        int k;
                        for (k = 0; k < n; k++)
                            fprintf(ef, "%u:%d:%d:%u;",
                                    (unsigned)rmc_export_c[k].tick,
                                    (int)rmc_export_c[k].pitch,
                                    (int)rmc_export_c[k].vel,
                                    (unsigned)rmc_export_c[k].gate);
                        fclose(ef);
                    } else {
                        n = -1;
                    }
                }
                return snprintf(out, out_len, "%u %d %u", (unsigned)span, n, (unsigned)span);
            }
            if (!strcmp(p, "_export_drum")) {
                /* Drum-clip export: render every active lane one cycle, flatten
                 * the polymeter onto a single clip of length LCM(lane loop-spans
                 * in TICKS), tiling each lane to fill it. Merged notes (each at
                 * its lane's midi_note) go to EXPORT_RENDER_PATH; header returns
                 * "<span_ticks> <note_count>". Same file/format as _export so JS
                 * reads it identically. Empty → "0 0". n=-1 on write failure.
                 * Cap: pool DRUM_BAKE_POOL; span clamped to EXPORT_DRUM_MAX_TICKS
                 * (snapped to a clean multiple of the longest lane). */
                if (!tr->drum_clips[cidx])
                    return snprintf(out, out_len, "0 0");
                int t_idx = (int)(tr - inst->tracks);
                static bake_note_t drm_tmp[BAKE_BUF];
                static bake_note_t drm_pool[DRUM_BAKE_POOL];
                uint64_t span64 = 0; uint32_t max_lt = 0;
                int lane, any = 0;
                for (lane = 0; lane < DRUM_LANES; lane++) {
                    clip_t *lc = &tr->drum_clips[cidx]->lanes[lane].clip;
                    if (lc->note_count == 0) continue;
                    uint16_t ltps = lc->ticks_per_step ? lc->ticks_per_step : (uint16_t)TICKS_PER_STEP;
                    uint32_t lt = (uint32_t)lc->length * ltps;
                    if (lt == 0) continue;
                    any = 1;
                    if (lt > max_lt) max_lt = lt;
                    if (span64 == 0) span64 = lt;
                    else {
                        uint32_t g = u32_gcd((uint32_t)span64, lt);
                        span64 = (span64 / g) * (uint64_t)lt;
                        if (span64 > EXPORT_DRUM_MAX_TICKS) span64 = EXPORT_DRUM_MAX_TICKS;
                    }
                }
                if (!any) return snprintf(out, out_len, "0 0 0");
                uint32_t span = (uint32_t)span64;
                if (span > EXPORT_DRUM_MAX_TICKS && max_lt > 0)
                    span = (EXPORT_DRUM_MAX_TICKS / max_lt) * max_lt;
                if (span < max_lt) span = max_lt;   /* at least one full longest cycle */

                int pcount = 0;
                for (lane = 0; lane < DRUM_LANES && pcount < DRUM_BAKE_POOL; lane++) {
                    clip_t *_lc = &tr->drum_clips[cidx]->lanes[lane].clip;
                    if (_lc->note_count == 0) continue;
                    uint16_t _ltps = _lc->ticks_per_step ? _lc->ticks_per_step : (uint16_t)TICKS_PER_STEP;
                    uint32_t _lct  = (uint32_t)_lc->length * _ltps;
                    if (_lct == 0) continue;
                    /* Fill the export span with this lane: request enough cycles so
                     * v=34 Iter trig conditions resolve across cycles (single-cycle
                     * render would silence iter-gated steps). Matches bake_drum_clip's
                     * lane_loops rule and the live-render per-lane wrap behavior. */
                    int lane_loops = (int)(span / _lct);
                    if (lane_loops < 1) lane_loops = 1;
                    uint32_t lt = 0;
                    int cnt = render_drum_lane_nd(inst, t_idx, cidx, lane, lane_loops,
                                                  drm_tmp, BAKE_BUF, &lt);
                    int i;
                    for (i = 0; i < cnt && pcount < DRUM_BAKE_POOL; i++) {
                        if (drm_tmp[i].tick >= span) continue;
                        drm_pool[pcount].tick  = drm_tmp[i].tick;
                        drm_pool[pcount].gate  = drm_tmp[i].gate;
                        drm_pool[pcount].pitch = drm_tmp[i].pitch;
                        drm_pool[pcount].vel   = drm_tmp[i].vel;
                        pcount++;
                    }
                }
                if (pcount > 0) {
                    FILE *ef = fopen(EXPORT_RENDER_PATH, "w");
                    if (ef) {
                        int k;
                        for (k = 0; k < pcount; k++)
                            fprintf(ef, "%u:%d:%d:%u;",
                                    (unsigned)drm_pool[k].tick, (int)drm_pool[k].pitch,
                                    (int)drm_pool[k].vel, (unsigned)drm_pool[k].gate);
                        fclose(ef);
                    } else {
                        pcount = -1;
                    }
                }
                /* Drums: one realign cycle = the whole LCM clip → brace = full span. */
                return snprintf(out, out_len, "%u %d %u", (unsigned)span, pcount, (unsigned)span);
            }
            if (!strncmp(p, "_cc_auto_bits", 13)) {
                int _bits = 0, _kb;
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                for (_kb = 0; _kb < 8; _kb++)
                    if (_ca->count[_kb] > 0) _bits |= (1 << _kb);
                return snprintf(out, out_len, "%d", _bits);
            }
            if (!strcmp(p, "_at_has")) {
                /* 1 if this clip has any recorded pad-pressure aftertouch, else 0. */
                return snprintf(out, out_len, "%d",
                    at_auto_has_data(&tr->clip_at_auto[cidx]) ? 1 : 0);
            }
            if (!strcmp(p, "_cc_rest")) {
                /* Resting value per knob (255 = "—"). */
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                return snprintf(out, out_len, "%d %d %d %d %d %d %d %d",
                    (int)_ca->rest_val[0], (int)_ca->rest_val[1],
                    (int)_ca->rest_val[2], (int)_ca->rest_val[3],
                    (int)_ca->rest_val[4], (int)_ca->rest_val[5],
                    (int)_ca->rest_val[6], (int)_ca->rest_val[7]);
            }
            if (!strcmp(p, "_cc_lane_loops")) {
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                int _pos = 0, _k2;
                for (_k2 = 0; _k2 < 8; _k2++)
                    _pos += snprintf(out + _pos, (size_t)(out_len - _pos),
                        _k2 ? " %d %d %d %d" : "%d %d %d %d",
                        (int)_ca->lane_loop_start[_k2],
                        (int)_ca->lane_length[_k2],
                        (int)_ca->lane_tps[_k2],
                        (int)_ca->lane_res_tps[_k2]);
                return _pos;
            }
            if (!strncmp(p, "_ccstepinfo_", 12)) {
                /* "_ccstepinfo_<sidx>" → 16 values for the held step:
                 *   [0..7]  recorded point value in the step window, -1 if none;
                 *   [8..15] computed output value at the step, -1 if "—". */
                const char *_q = p + 12;
                int _sidx = 0;
                while (*_q >= '0' && *_q <= '9') { _sidx = _sidx * 10 + (*_q++ - '0'); }
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                uint32_t _tps = cl->ticks_per_step;
                uint32_t _ws  = (uint32_t)cl->loop_start * _tps;
                uint32_t _we  = (uint32_t)(cl->loop_start + cl->length) * _tps;
                int _pos = 0, _k2;
                for (_k2 = 0; _k2 < 8; _k2++) {
                    uint32_t _ktps = (_ca->lane_tps[_k2] > 0)
                                   ? _ca->lane_tps[_k2] : _tps;
                    uint32_t _t1 = (uint32_t)_sidx * _ktps;
                    uint32_t _t2 = _t1 + (_ktps ? _ktps - 1 : 0);
                    int _pv = -1, _ip;
                    for (_ip = 0; _ip < (int)_ca->count[_k2]; _ip++) {
                        uint16_t _tk = _ca->ticks[_k2][_ip];
                        if (_tk >= (uint16_t)_t1 && _tk <= (uint16_t)_t2) { _pv = _ca->vals[_k2][_ip]; break; }
                    }
                    _pos += snprintf(out + _pos, (size_t)(out_len - _pos), _k2 ? " %d" : "%d", _pv);
                }
                for (_k2 = 0; _k2 < 8; _k2++) {
                    uint32_t _ktps2 = (_ca->lane_tps[_k2] > 0)
                                    ? _ca->lane_tps[_k2] : _tps;
                    uint32_t _et = (uint32_t)_sidx * _ktps2;
                    uint32_t _ews = _ws, _ewe = _we;
                    if (_ca->lane_length[_k2] > 0 || _ca->lane_tps[_k2] > 0) {
                        uint32_t _elen = _ca->lane_length[_k2] > 0
                                       ? _ca->lane_length[_k2] : cl->length;
                        _ews = (uint32_t)_ca->lane_loop_start[_k2] * _ktps2;
                        uint32_t _dlen = (uint32_t)_elen * _ktps2;
                        _ewe = _ews + _dlen;
                        if (_et >= _ewe) _et = _ews + ((_et - _ews) % _dlen);
                    }
                    int _def, _ov = cc_auto_eval(_ca, _k2, _et, _ews, _ewe, &_def);
                    _pos += snprintf(out + _pos, (size_t)(out_len - _pos), " %d", _def ? _ov : -1);
                }
                return _pos;
            }
            if (!strncmp(p, "_ccsv_", 6)) {
                /* "_ccsv_<k>_<page>" → 16 computed output values for knob k
                 * across the 16 steps of the page (255 = "—"). LED gradient. */
                const char *_q = p + 6;
                int _k2 = 0, _pg = 0;
                while (*_q >= '0' && *_q <= '9') { _k2 = _k2 * 10 + (*_q++ - '0'); }
                if (*_q == '_') _q++;
                while (*_q >= '0' && *_q <= '9') { _pg = _pg * 10 + (*_q++ - '0'); }
                if (_k2 < 0 || _k2 > 7) return -1;
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                uint32_t _tps = cl->ticks_per_step;
                uint32_t _ws  = (uint32_t)cl->loop_start * _tps;
                uint32_t _we  = (uint32_t)(cl->loop_start + cl->length) * _tps;
                uint32_t _ews = _ws, _ewe = _we;
                uint32_t _dlen = 0;
                uint32_t _step_tps = (_ca->lane_tps[_k2] > 0)
                                   ? _ca->lane_tps[_k2] : _tps;
                if (_ca->lane_length[_k2] > 0) {
                    _ews = (uint32_t)_ca->lane_loop_start[_k2] * _step_tps;
                    _dlen = (uint32_t)_ca->lane_length[_k2] * _step_tps;
                    _ewe = _ews + _dlen;
                }
                int _pos = 0, _s;
                for (_s = 0; _s < 16; _s++) {
                    uint32_t _t = (uint32_t)(_pg * 16 + _s) * _step_tps;
                    if (_dlen > 0) _t = cc_lane_wrap_tick(_t, _ews, _dlen);
                    int _def, _ov = cc_auto_eval(_ca, _k2, _t, _ews, _ewe, &_def);
                    _pos += snprintf(out + _pos, (size_t)(out_len - _pos),
                                     _s ? " %d" : "%d", _def ? _ov : 255);
                }
                return _pos;
            }
            if (!strncmp(p, "_ccbp_", 6)) {
                /* "_ccbp_<k>_<page>" → 16 flags: 1 if a real breakpoint exists
                 * in that step's tick window, 0 if interpolated/resting/empty. */
                const char *_q = p + 6;
                int _k2 = 0, _pg = 0;
                while (*_q >= '0' && *_q <= '9') { _k2 = _k2 * 10 + (*_q++ - '0'); }
                if (*_q == '_') _q++;
                while (*_q >= '0' && *_q <= '9') { _pg = _pg * 10 + (*_q++ - '0'); }
                if (_k2 < 0 || _k2 > 7) return -1;
                cc_auto_t *_ca = &tr->clip_cc_auto[cidx];
                uint32_t _ktps = (_ca->lane_tps[_k2] > 0)
                               ? _ca->lane_tps[_k2] : cl->ticks_per_step;
                int _pos = 0, _s;
                for (_s = 0; _s < 16; _s++) {
                    uint32_t _t1 = (uint32_t)(_pg * 16 + _s) * _ktps;
                    uint32_t _t2 = _t1 + (_ktps ? _ktps - 1 : 0);
                    int _has = 0, _ip;
                    for (_ip = 0; _ip < (int)_ca->count[_k2]; _ip++) {
                        uint16_t _tk = _ca->ticks[_k2][_ip];
                        if (_tk >= (uint16_t)_t1 && _tk <= (uint16_t)_t2) { _has = 1; break; }
                    }
                    _pos += snprintf(out + _pos, (size_t)(out_len - _pos),
                                     _s ? " %d" : "%d", _has);
                }
                return _pos;
            }
            if (!strncmp(p, "_pfx_snapshot", 13)) {
                clip_pfx_params_t *cp = &cl->pfx_params;
                /* MIDI DLY slot 15 is K6 in the JS bank layout. K6 was
                 * fb_clock pre-rebind; it is delay_retrig now (clock_fb
                 * folded onto Shift+K1, read via tN_delay_clock_fb).
                 * Slot layout (v[i]):
                 *   0..16  NOTE FX / HARMZ / DELAY base
                 *   17..22 SEQ ARP scalar params
                 *   23..30 SEQ ARP step_vel[0..7]
                 *   31..33 NOTE FX random + modes (filled in for JS parser)
                 *   34..41 SEQ ARP step_int[0..7] (Arp Steps interval mode)
                 *   42     SEQ ARP step_loop_len (1..8)
                 *   43     NOTE FX note_length_mode (Len knob 0..8) */
                return snprintf(out, out_len,
                    "%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d "
                    "%d %d %d %d %d %d %d %d "
                    "%d %d %d "
                    "%d %d %d %d %d %d %d %d "
                    "%d %d",
                    cp->octave_shift, cp->note_offset, cp->gate_time,
                    cp->velocity_offset, cp->quantize,
                    cp->octaver, cp->harmonize_1, cp->harmonize_2, cp->harmonize_3,
                    cp->delay_time_idx, cp->delay_level, cp->repeat_times,
                    cp->fb_velocity, cp->fb_note, cp->fb_gate_time,
                    cp->delay_retrig, cp->fb_note_random,
                    cp->seq_arp_style, cp->seq_arp_rate,
                    cp->seq_arp_octaves, cp->seq_arp_gate,
                    cp->seq_arp_steps_mode, cp->seq_arp_retrigger,
                    (int)cp->seq_arp_step_vel[0], (int)cp->seq_arp_step_vel[1],
                    (int)cp->seq_arp_step_vel[2], (int)cp->seq_arp_step_vel[3],
                    (int)cp->seq_arp_step_vel[4], (int)cp->seq_arp_step_vel[5],
                    (int)cp->seq_arp_step_vel[6], (int)cp->seq_arp_step_vel[7],
                    cp->note_random, cp->note_random_mode, cp->fb_note_random_mode,
                    (int)cp->seq_arp_step_int[0], (int)cp->seq_arp_step_int[1],
                    (int)cp->seq_arp_step_int[2], (int)cp->seq_arp_step_int[3],
                    (int)cp->seq_arp_step_int[4], (int)cp->seq_arp_step_int[5],
                    (int)cp->seq_arp_step_int[6], (int)cp->seq_arp_step_int[7],
                    (int)cp->seq_arp_step_loop_len,
                    (int)cp->note_length_mode);
            }
            return -1;
        }

        if (!strcmp(sub, "all_lanes_stretch_result")) {
            return snprintf(out, out_len, "%d", inst->all_lanes_stretch_result);
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

static uint32_t effective_note_tick(const note_t *n, const clip_t *cl, int quantize) {
    uint16_t sn = note_step(n->tick, cl->length, cl->ticks_per_step);
    int32_t step_grid = (int32_t)sn * cl->ticks_per_step;
    int32_t delta = (int32_t)n->tick - step_grid;
    int32_t eff_delta = (quantize >= 100) ? 0 : delta * (100 - quantize) / 100;
    int32_t eff_tick = step_grid + eff_delta;
    /* Wrap against storage extent, not window: n->tick is absolute within
     * [0, SEQ_STEPS*tps), and cct (the comparison value at fire time) is
     * also absolute. A length-bound wrap maps in-window notes at high
     * absolute ticks to low ticks that never match cct. */
    int32_t clip_ticks = (int32_t)SEQ_STEPS * cl->ticks_per_step;
    if (eff_tick < 0) eff_tick += clip_ticks;
    if (eff_tick >= clip_ticks) eff_tick -= clip_ticks;
    return (uint32_t)eff_tick;
}

/* Per-step trig-condition gate (v=34 Iter + Random). Returns 1 if the note
 * should fire, 0 to skip. Always advances *rng once so chord-mate notes get
 * independent rolls regardless of which one short-circuits first.
 *   cycle  loop-cycle counter (clip->loop_cycle for live render, the local
 *          bake loop index for bake/export render).
 *   Iter   gates the entire step on (cycle % cycle_len == cycle_idx-1).
 *   Random rolls per-note: skip if roll >= pct. */
static int step_trig_pass(clip_t *cl, uint16_t sidx, uint32_t cycle, uint32_t *rng) {
    /* Always advance the rng so per-note rolls don't sync */
    *rng = (*rng) * 1664525u + 1013904223u;
    uint8_t iter = cl->step_iter[sidx];
    if (iter) {
        int len = (iter >> 4) & 0xF, idx = iter & 0xF;
        if (len < 1 || idx < 1) return 1;   /* malformed -> treat as default */
        if ((cycle % (uint32_t)len) != (uint32_t)(idx - 1))
            return 0;
    }
    uint8_t rand = cl->step_random[sidx];
    if (rand && rand < 100) {
        unsigned roll = ((*rng) >> 8) % 100u;
        if (roll >= (unsigned)rand) return 0;
    }
    return 1;
}

/* Reset loop_cycle on every clip (melodic + drum lanes) — called on
 * transport-start edge so the Iter cycle counter starts from cycle 1. */
static void reset_all_loop_cycles(seq8_instance_t *inst) {
    int t, c, l;
    for (t = 0; t < NUM_TRACKS; t++) {
        for (c = 0; c < NUM_CLIPS; c++) {
            inst->tracks[t].clips[c].loop_cycle = 0;
            if (inst->tracks[t].drum_clips[c])
                for (l = 0; l < DRUM_LANES; l++)
                    inst->tracks[t].drum_clips[c]->lanes[l].clip.loop_cycle = 0;
        }
    }
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
    for (pp = 0; pp < (int)tr->play_pending_count; pp++) {
        if (tr->pad_mode == PAD_MODE_DRUM && tr->play_pending[pp].lane_idx != 0xFF)
            drum_pfx_note_off(inst, tr, &tr->drum_lane_pfx[tr->play_pending[pp].lane_idx], tr->play_pending[pp].pitch);
        else
            pfx_note_off(inst, tr, tr->play_pending[pp].pitch);
    }
    tr->play_pending_count = 0;
    /* v=34 Ratchet: drop any sub-hits scheduled for the future so they
     * don't ghost-fire after silence (transport stop, clip switch, etc.) */
    tr->ratchet_pending_count = 0;
    tr->note_active = 0;
    tr->pending_note_count = 0;
    /* TRACK ARP: drop held buffer + silence sounding. */
    tarp_silence(inst, tr);
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

/* LOAD-BEARING SPACING: the blank lines flanking this include are part of the
 * phase-3 re-runnable gate — the split is proven by the preprocessed TU being
 * byte-identical pre/post (`clang -E -P`). render_block must stay defined ahead
 * of the API table below (which takes its address). Do not tidy. */
#include "seq8_render.c"

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
