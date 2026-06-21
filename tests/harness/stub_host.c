/* tests/harness/stub_host.c */
#include "stub_host.h"
#include <string.h>

#define HX_CAP_MAX  8192
#define HX_LOG_MAX  65536

static hx_midi_event g_events[HX_CAP_MAX];
static int           g_event_count;
static char          g_log[HX_LOG_MAX];
static size_t        g_log_len;
static float         g_bpm = 120.0f;

static void push_event(hx_midi_kind kind, const uint8_t *msg, int len) {
    if (g_event_count >= HX_CAP_MAX) return;
    hx_midi_event *e = &g_events[g_event_count++];
    e->kind = kind;
    e->len = (len > 4) ? 4 : len;
    memset(e->bytes, 0, sizeof(e->bytes));
    memcpy(e->bytes, msg, (size_t)e->len);
}

static void  stub_log(const char *m) {
    if (!m) return;
    size_t n = strlen(m);
    if (g_log_len + n + 1 >= HX_LOG_MAX) return;
    memcpy(g_log + g_log_len, m, n);
    g_log_len += n;
    g_log[g_log_len++] = '\n';
    g_log[g_log_len] = '\0';
}
static int   stub_internal(const uint8_t *m, int n) { push_event(HX_MIDI_INTERNAL, m, n); return n; }
static int   stub_external(const uint8_t *m, int n) { push_event(HX_MIDI_EXTERNAL, m, n); return n; }
static int   stub_inject(const uint8_t *m, int n)   { push_event(HX_MIDI_INJECT,   m, n); return n; }
static float stub_get_bpm(void) { return g_bpm; }

host_api_v1_t *hx_stub_host(void) {
    static host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    host.api_version        = MOVE_PLUGIN_API_VERSION_2;
    host.sample_rate        = MOVE_SAMPLE_RATE;
    host.frames_per_block   = MOVE_FRAMES_PER_BLOCK;
    host.log                = stub_log;
    host.midi_send_internal = stub_internal;
    host.midi_send_external = stub_external;
    host.midi_inject_to_move = stub_inject;
    host.get_bpm            = stub_get_bpm;
    return &host;
}

void                 hx_stub_reset_capture(void) { g_event_count = 0; g_log_len = 0; g_log[0] = '\0'; }
int                  hx_stub_event_count(void)   { return g_event_count; }
const hx_midi_event *hx_stub_event(int i)        { return (i >= 0 && i < g_event_count) ? &g_events[i] : NULL; }
int                  hx_stub_count_kind(hx_midi_kind k) {
    int c = 0; for (int i = 0; i < g_event_count; i++) if (g_events[i].kind == k) c++; return c;
}
void                 hx_stub_set_bpm(float bpm)  { g_bpm = bpm; }
const char          *hx_stub_log_text(void)      { return g_log; }
