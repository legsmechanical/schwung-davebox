/* tests/harness/stub_host.h — stub host + capture API. */
#ifndef HX_STUB_HOST_H
#define HX_STUB_HOST_H

#include <stdint.h>
#include "host/plugin_api_v1.h"

typedef enum {
    HX_MIDI_INTERNAL = 0,
    HX_MIDI_EXTERNAL = 1,
    HX_MIDI_INJECT   = 2
} hx_midi_kind;

typedef struct {
    hx_midi_kind kind;
    uint8_t bytes[4];   /* USB-MIDI packet [cable|CIN, status, d1, d2] */
    int len;
} hx_midi_event;

/* Returns a configured, process-global host (sample_rate, log, all MIDI
 * sends, get_bpm wired to capture/config). */
host_api_v1_t *hx_stub_host(void);

/* Capture control + queries (ordered across all three MIDI channels). */
void                  hx_stub_reset_capture(void);
int                   hx_stub_event_count(void);
const hx_midi_event  *hx_stub_event(int i);      /* NULL if out of range */
int                   hx_stub_count_kind(hx_midi_kind k);

/* Config + introspection. */
void        hx_stub_set_bpm(float bpm);
const char *hx_stub_log_text(void);              /* accumulated seq8_ilog output */

#endif /* HX_STUB_HOST_H */
