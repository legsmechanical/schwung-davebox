# Phase 1 Doc Cross-Check: Inbound MIDI Refactor

Cross-reference of audit-davebox-arch.md Phase 1 scope against existing documentation.
Date: 2026-05-14. Scope: audit-davebox-arch.md lines 1–272 (Audit-1) + lines 716–778 (Audit-3 follow-up §3.2).

---

## 1. Confirmations

**Audit claim: audio-thread `on_midi` hook exists, just empty**
- Schwung API.md (L42): `on_midi` callback signature confirmed (`void (*on_midi)(void *instance, const uint8_t *msg, int len, int source)`).
- SCHWUNG_PATCHES.md (L91–95): overtake co-run architecture describes `shadow_set_corun_chain_edit` as a JS binding that survives by gating on `typeof shadow_xxx === 'function'` — same pattern Phase 1 uses for capability-gating on patched-Schwung delivery.

**Audit claim: JS tick rate ~94 Hz on device**
- CLAUDE.md (L82): Explicitly documented: "JS tick rate: ~94 Hz on device (512-sample buffers at 48kHz)." Baseline confirmed.

**Audit claim: set_param coalescing defeats multi-note batching**
- CLAUDE.md (L52–53): "only the LAST `set_param` per audio buffer reaches DSP… Multi-field operations require a single atomic DSP command." Matches audit's layer-3 analysis.

**Audit claim: preroll capture has two-tick deferred pattern**
- FEATURE_REFERENCE.md (L88–90): Count-in preroll described: "fires when `!liveActiveNotes.has(pitch) && elapsed >= tps`... Gate sent next tick via `pendingPrerollGate` to avoid coalescing." Confirms toggle + gate separation.

---

## 2. New Constraints / Context the Audit Missed

### §2.1: Overtake `on_midi` delivery is smaller than rethink memory claimed

**Doc says:** SCHWUNG_PATCHES.md (L90–95) describes overtake co-run as existing feature. Patch layout stable. Audit says inbound pad MIDI requires a shim patch on `legsmechanical/schwung`.

**Why it matters for Phase 1:** The audit initially claimed no shim patch needed (finding #1 was wrong, corrected in Audit-3 follow-up §3.2 lines 716–778). **Phase 1 Bundle 1 effort revised from S (2–3 days) to M (3–4 days).** Audit-3 follow-up now the canonical source; plan doc requires updating to cite the reverification.

**Impact on plan:** Phase 1-plan.md (L57–62) says Bundle 1 requires Schwung patch; Audit-1 punch list (mid-document) contradicted this. **Audit-3 follow-up supersedes Audit-1 punch list #1.** Plan doc already correct; no action needed.

### §2.2: TARP-on bail-out is mission-critical for Bundle 3

**Doc says:** FEATURE_REFERENCE.md mentions TARP in context of count-in (L88); CLAUDE.md (L74) mentions "pendingPrerollGate" deferred pattern.

**Why it matters for Phase 1:** Audit explicitly flags (lines 160, 167) that preroll's "TARP-on tracks record arp output, not input chord" decision must be preserved byte-for-byte. If Phase 1's preroll port changes this semantics, TARP-armed users lose input chord recording entirely. Bundle 3 critical path item: verify TARP-on escape hatch is ported, not deleted.

**Impact on plan:** Plan doc (L71) says "Preserves the TARP-on bail-out exactly" — phrasing is vague. Recommend: explicit test scenario in Bundle 3 checklist: "TARP-on track, count-in, 3-note chord → confirm chord NOT recorded, arp output IS recorded."

### §2.3: JS tick constants assume 94 Hz; Phase 1 obsoletes them

**Doc says:** CLAUDE.md (L82) documents `STEP_HOLD_TICKS=19` calibrated for ~94 Hz; older constants use 196 Hz assumptions and "run at ~half speed on device."

**Why it matters for Phase 1:** Once `on_midi` fires on the audio thread, JS-tick calibrated constants (`NO_NOTE_FLASH_TICKS=118`, `STEP_SAVE_HOLD_TICKS=150`, etc.) become dead code or need rebalancing. These affect LED hold-time visual feedback and step-edit debounce. Audit doesn't mention them; they're outside Phase 1 scope but Phase 1's audio-thread timing will make them obviously wrong.

**Impact on plan:** Plan doc cleanup task (L75–76) says "Delete `pendingLiveNotes`, `_drainLiveNotes`…" Should add: "Review and delete/rebalance JS-tick-calibrated timeout constants; they become inaccurate post-Phase-1."

### §2.4: Capability-gate pattern is documented; use it

**Doc says:** SCHWUNG_PATCHES.md (L12–25) documents the capability-gate pattern explicitly. Example: `typeof shadow_set_corun_chain_edit === 'function'` checks at entry point.

**Why it matters for Phase 1:** Plan doc (L44–48) describes the capability gate but doesn't cite the established pattern. Makes it look novel when it's already the standard dAVEBOx practice for patched-Schwung features.

**Impact on plan:** No code impact. Recommendation: update plan doc to cite SCHWUNG_PATCHES.md as the reference pattern, not a novel invention for Phase 1.

---

## 3. Doc Inaccuracies (Audit Supersedes)

### §3.1: Audit-1 punch list finding #1 is incorrect (Audit-3 corrects it)

**Doc currently says** (Audit-1 punch list, L212–214):
> "`dsp/seq8.c::on_midi` is already wired by Schwung — just empty. The 'shim patch on `legsmechanical/schwung`' is not needed."

**What audit established** (Audit-3 follow-up §3.2, L716–777):
> Only **two** delivery sites to overtake `on_midi` exist in the shim: cable-0 realtime clock (L728) and cable-2 external USB (L729). **Pad presses do NOT reach overtake `on_midi` today** (L733–735). A Schwung patch IS needed. Audit-1 finding #1 **is wrong**.

**Action:** Mark Audit-1 punch list finding #1 as **superseded by Audit-3 follow-up §3.2** throughout the codebase. Plan doc already correct (cites the patch as required); Audit-1 section should have a warning banner: *"This section's finding #1 was corrected in Audit-3 follow-up. See §3.2 for the verified dispatch table."*

### §3.2: Audit-1 §3.2 is half-right on MPE

**Doc currently says** (Audit-1, L192–193):
> "Phase 1 bonus: implementing `on_midi` unlocks MPE-style expression … This is a *new capability*."

**What audit corrected** (Audit-3 follow-up §3.2, L754–760):
> External USB MIDI (cable-2) unlocked: yes. But JS-routed `shadow_send_midi_to_dsp` CC/AT/PB is NOT automatically unlocked — requires a second shim patch at `shadow_drain_ui_midi_dsp`. Full MPE unlocks in two steps: (1) external USB MIDI (automatic), (2) JS-routed MIDI (optional, separate patch).

**Action:** Audit-1 §3.2 should be reframed: "Phase 1 unlocks external-USB MPE as a side-effect (cable-2 musical at shim:1245 now handled). Full MPE (including JS-routed CC/AT/PB) requires an optional second shim patch at `shadow_drain_ui_midi_dsp`; deferred to Bundle 1.5 or Phase 2."

---

## 4. Critical Constraints Cross-Check

CLAUDE.md "Critical constraints" (L51–63) against Phase 1 design:

| Constraint | Phase 1 Impact | Resolution |
|---|---|---|
| **Coalescing**: last set_param per buffer wins | OBSOLETED | `on_midi` path fires atomically per event, no coalescing channel. Bundle 1 removes `pendingLiveNotes` queue and `tN_live_notes` set_param entirely. |
| **get_param from onMidiMessage returns null** | IRRELEVANT | Phase 1's `on_midi` runs on DSP audio thread; DSP can read its own state directly (no host IPC). Constraint applies only to JS context. |
| **No MIDI panic before state_load** | PRESERVED | Phase 1 doesn't touch state_load path. Constraint survives unchanged. |
| **Shift+Back does not reload JS** | PRESERVED | Phase 1 is JS-optional (shim patch + DSP `on_midi` = live notes reach DSP without JS enqueue). JS can reload; live note path works either way (if gate is up). |
| **`reapplyPalette` resets CC LED hardware states** | PRESERVED | Phase 1 audio-thread path doesn't touch LEDs. JS LED pipeline unchanged. Constraint survives. |
| **Palette SysEx rate-limit** | PRESERVED | Phase 1 doesn't touch palette pipeline. Constraint survives. |
| **Multi-step toggle coalescing** | MITIGATED | Held-step writes move to `on_midi` path in Phase 1 Bundle 1 (audit 3.3, L195–200). Direct clip_insert_note on audio thread eliminates per-buffer-per-key coalescing. |
| **ROUTE_MOVE external MIDI bypasses pfx chain** | CLARIFIED | Audit-1 §3.2 / Audit-3 corrects earlier claim: external MIDI does reach DSP `on_midi` (cable-2, line 1245). DSP can now choose to route to pfx chain or bypass per-flag. Phase 1 enables the capability; JS decides policy. |
| **pfx_send from set_param context does NOT release Move synth voices** | PRESERVED | Phase 1 audio-thread path calls `live_note_on` directly, not `pfx_send`. Constraint applies to a different code path. |

**Summary:** Phase 1 eliminates or mitigates **4 constraints** (coalescing, multi-step toggle, ROUTE_MOVE pfx routing, get_param-in-JS context). Preserves or clarifies **5 constraints**. No Phase 1 design violations.

---

## 5. Checked, nothing relevant

- **DAVEBOX_API.md**: Comprehensive DSP struct + parameter reference. No inbound MIDI / `on_midi` / audio-thread context documented (correct scope; it's for DSP writers, not architecture). Nothing to cross-check.
- **RECORDING_LATENCY_EXPERIMENT.md**: Press-time tick stamping research (experimental, unmerged). Orthogonal to Phase 1 scope. No inbound path changes, only recording timestamp accuracy. Survives Phase 1 unchanged.
- **SPI_PROTOCOL.md**, **ADDRESSING_MOVE_SYNTHS.md**: Move firmware ↔ Schwung protocol. No `on_midi` / audio-thread references. Orthogonal to Phase 1 (which rewires DSP inbound, not firmware↔shim protocol).

---

## Summary

**No blocking inaccuracies found.** Audit-3 follow-up (§3.2) corrects Audit-1 punch list finding #1; Phase 1 plan doc already reflects the corrected version. Capability-gate pattern is documented and standard. All critical constraints either preserved, mitigated, or irrelevant to Phase 1 design.

**Recommendations:**
1. Update Audit-1 mid-document punch list to cite Audit-3 follow-up §3.2 as the canonical corrected source.
2. Plan doc: add explicit test scenario for Bundle 3 TARP-on bail-out verification.
3. Plan doc cleanup task: add review/rebalancing of JS-tick-calibrated timeout constants.
