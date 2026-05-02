# SEQ8 Suspend & Resume

SEQ8 now supports background operation — you can leave SEQ8 while it keeps playing, browse Move's native UI, and jump back in instantly.

## How It Works

| Action | What Happens |
|--------|-------------|
| **Back** | Suspends SEQ8. Sequencer keeps playing in the background. Move's native UI returns. |
| **Shift + Step 13** (single tap) | Opens the Tools menu. Select SEQ8 to resume. |
| **Shift + Step 13** (double tap or long press) | Resumes SEQ8 directly — no menu. |
| **Shift + Back** | Fully exits SEQ8 (stops playback, unloads module). |

## What Happens During Suspend

- **Playback continues** — all 8 tracks keep sequencing and sending MIDI to your instruments.
- **State is saved** — your session (active track, clip focus, view, perf mods) is saved automatically when you suspend.
- **LEDs restore instantly** — when you resume, all pad and button LEDs return to their correct state.

## Menu Close Gesture

Because Back is now used for suspend, the global menu (Shift + Note/Session) closes with a tap of the **Note/Session** button instead of Back. The same button opens and closes the menu and its sub-dialogs (Tap Tempo, Clear Session confirm).

## Tips

- Use suspend to quickly check another instrument's sound or tweak a Schwung chain slot without interrupting your sequence.
- Your sequencer state survives any number of suspend/resume cycles — no data loss.
- Quit (in the global menu) also saves state before exiting.
