# Bug: SIGABRT in shim when sequencer inject and live external MIDI arrive concurrently on cable-2

## Repro

The crash requires **two simultaneous cable-2 streams**:

1. A ROUTE_MOVE track playing a sequence — notes flow through `midi_send_internal` → Schwung chain → inject queue → cable-2 SPI MIDI_IN buffer (one MIDI channel)
2. A live external USB-A device being monitored on a **different** MIDI channel

Either stream alone is stable indefinitely. Both together crash within a few seconds of the sequencer running. Crash is not observed when transport is stopped.

## Assessment

`shim_post_transfer` walks the cable-2 MIDI_IN buffer to process incoming packets (and, in the `cable2-channel-remap` branch, to rewrite channel bytes). The inject drain — which writes sequencer output back into that same buffer so Move's firmware sees it — appears to run concurrently with or interleaved inside that walk.

When only one source is active, the buffer stays within a predictable size and the walk finishes cleanly. When both are active, packets from the inject drain land in the buffer mid-iteration. The most likely failure modes are:

- The byte count or packet count is read at the start of the walk, but the drain appends to the buffer during the loop, causing reads past the valid region
- The inject drain and the SPI receive path share a buffer with no mutual exclusion, so a partial packet from one source can be interleaved with a partial packet from the other, producing a malformed packet that trips an assertion or a length check

The crash not appearing when transport is stopped confirms it's inject-driven: with transport stopped the inject queue is idle, leaving the buffer as a single-writer system.

## Suggested fix

The cleanest approach is to make the buffer walk see a stable snapshot:

1. At the very top of `shim_post_transfer`, snapshot the current valid byte count (or packet count) of the cable-2 receive buffer before touching the inject queue
2. Drain the inject queue into the buffer (or process it separately)
3. Walk only up to the snapshotted count — new bytes from the drain are left for the next SPI cycle

This separates "packets that arrived from hardware this transfer" from "packets we are injecting this cycle" without requiring locks or a second buffer. The inject packets get picked up on the following transfer, which adds at most one SPI cycle of latency (~1ms) — imperceptible for MIDI.

An alternative is to drain inject packets into a separate staging buffer and append them to the hardware receive buffer only after the walk completes, so the iteration is never over a moving target.

## Affected versions

Confirmed on schwung `main` (post-0.9.7). Also present in `cable2-channel-remap` branch. The remap branch adds a channel-rewrite pass over the same buffer, which makes the window slightly wider but is not the root cause.
