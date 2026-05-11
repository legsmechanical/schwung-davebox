# External MIDI Output — User Guide

dAVEBOx can send MIDI to external hardware synths and drum machines connected via Move's USB-A port. Each track can independently route to the Schwung chain, Move's native instruments, or an external device.

---

## Setting the Route

1. Select the track you want to route externally
2. Open the **TRACK bank** (Shift + pad 92, or tap pad 92 if already on TRACK)
3. Turn **K2 (Route)** to cycle through: `Swng` → `Move` → `Ext`
4. The OLED shows `Ext` when external routing is active

Each track has its own route setting — you can mix Schwung, Move, and External tracks freely.

---

## What Gets Sent

When a track is set to `Ext`, all MIDI output goes to USB-A:

- **Sequencer playback** — notes from clips play on the external device
- **Live pads** — pad presses send notes immediately
- **External MIDI input** — keyboard/controller input is echoed to USB-A
- **Play effects** — the full chain (NOTE FX → HARMZ → MIDI DLY → SEQ ARP) processes notes before they reach the external device
- **TRACK ARP** — arpeggiator output is sent externally
- **Performance Mode** — all perf mods apply to external output

---

## MIDI Channel

The external device receives notes on the track's **MIDI Channel** (TRACK bank K1). Channels are 1–16, matching standard MIDI convention. Different tracks can target different channels, allowing multi-timbral setups from a single USB-A connection.

---

## Input Velocity Override

**VelIn** (TRACK bank K5) works with External routing. Set it to a fixed value (1–127) to override all input velocity, or leave at `Live` (0) for dynamic velocity.

---

## Transport & Panic

- **Stop** sends note-offs for all sounding notes on the external device — no stuck notes
- **Delete + Play** (while stopped) sends a full panic (all-notes-off on all channels)

---

## Tips

- Connect your external synth via USB-A before loading dAVEBOx
- Use different MIDI channels per track to address multiple instruments on a single device
- The route setting persists across suspend/resume and save/load cycles
- Switching a track from `Ext` back to `Swng` or `Move` immediately redirects output — any held notes on the external device get note-offs via the transport panic

---

## Limitations

- External output uses USB-A only — USB-C MIDI out is not separately addressable
- Notes from the sequencer travel through a short buffer (DSP → JS → USB), adding minimal latency compared to the Schwung chain path. Live pad input bypasses this buffer and sends directly.
- The Global MIDI Looper captures notes before routing, so a loop recorded on an `Ext` track plays back to the external device as expected
