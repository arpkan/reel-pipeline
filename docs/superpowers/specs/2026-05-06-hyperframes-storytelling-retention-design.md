# Hyperframes Storytelling + Retention Design

Date: 2026-05-06
Status: Approved for planning
Scope: Hyperframes renderer only (no FFmpeg changes)

## 1) Problem Statement

The current reel experience delays narration too long at the start and relies heavily on prompt quality for storytelling consistency. In the current Hyperframes template, voice starts after a fixed intro window, which can reduce early attention. We need a structured storytelling system that improves hook strength, scene flow, emotional arc, and retention metrics without destabilizing the existing pipeline.

## 2) Goals and Non-Goals

### Goals

- Improve first-seconds attention by reducing default voice lead-in from long fixed intro to a short lead-in.
- Improve narrative flow and emotional progression across scenes with explicit structure.
- Improve measurable retention outcomes using controlled A/B rollout.
- Keep backward compatibility so existing scripts still render safely.

### Non-Goals

- No FFmpeg path updates.
- No voice provider model/provider changes.
- No broad unrelated refactors outside Stage 2 contract + Hyperframes behavior.

## 3) Success Metrics

Promotion gate for making the new profile default:

- Completion rate: at least +5%
- 3-second hold rate: at least +8%
- Average watch time: at least +6%

All thresholds are measured versus baseline in A/B cohorts.

## 4) Proposed Approach (Chosen)

Chosen approach: **Structured storytelling contract + Hyperframes pacing profile**.

Why this approach:

- More deterministic than prompt-only tuning.
- Lower complexity and risk than a full adaptive story engine.
- Directly aligns with measured rollout and future FFmpeg retirement.

## 5) Architecture

### 5.1 Storytelling Profile

Introduce a profile switch for Hyperframes runs:

- `storytellingProfile: "baseline" | "retention_v1"`

`baseline` preserves current behavior. `retention_v1` enables new pacing and story-aware rendering rules.

### 5.2 Stage 2 Structured Story Contract

Extend each generated scene with optional structured fields (while keeping existing required scene fields):

- `storyBeat`: `"hook" | "context" | "turn" | "payoff"`
- `energy`: `"low" | "medium" | "high"`
- `emphasisWords`: string[] (1 to 3 words expected)
- `transitionIntent`: `"escalate" | "contrast" | "resolve"`

Existing fields (caption, voiceover, timings, scene order) remain supported. If structured fields are missing, runtime falls back to baseline-safe behavior.

### 5.3 Hyperframes Behavior Layer

Hyperframes template consumes storytelling metadata to drive:

- Start pacing (voice lead-in and hook overlap)
- Subtitle emphasis priority
- Transition feel between scenes

No renderer swap or pipeline topology change is required.

## 6) Data Flow

1. Stage 2 generates scene content + structured storytelling metadata.
2. Contract validator parses scene metadata and normalizes or drops invalid optional fields.
3. Stage 3 voice generation remains unchanged; existing outputs continue.
4. Stage 5 Hyperframes template reads `storytellingProfile` and scene storytelling metadata.
5. Rendering applies profile rules; missing metadata falls back per scene to baseline behavior.
6. Metrics tagging records profile/variant details for retention analysis.

## 7) Behavior Spec (Hyperframes, retention_v1)

### 7.1 Voice Start Timing

- New default voice lead-in target: ~0.5s.
- Replace fixed long intro behavior with profile-driven short lead-in.
- Optional micro-adjustments by `storyBeat` are allowed but bounded (small deltas only) to avoid unpredictable pacing.

### 7.2 Hook + Narration Coupling

- Hook visual should overlap with early narration instead of fully preceding it.
- This removes the perceived dead zone at reel start.

### 7.3 Subtitle Emphasis

- Continue word-level sync as the timing source of truth.
- If `emphasisWords` exists, prioritize styling for matching words when timed spans appear.
- If no matches occur, continue normal timing-based highlight behavior.

### 7.4 Transition Intent Mapping

- `escalate`: slightly faster visual progression/energy continuity.
- `contrast`: clearer transition distinction between scenes.
- `resolve`: smoother easing and calmer handoff feel.

Transitions remain lightweight and compatible with existing motion presets.

## 8) Error Handling and Fallbacks

- Invalid structured storytelling fields must not fail the run.
- Validation issues are logged with run and scene identifiers.
- Fallback hierarchy:
  1. Scene-level fallback to baseline rules when metadata is invalid/missing.
  2. Run-level fallback to `baseline` when profile config is invalid.
- Assembly should proceed unless existing fatal conditions are hit (as today).

## 9) Experimentation and Rollout

### 9.1 Rollout Strategy

- Flagged A/B rollout by profile.
- Start with small cohort, then expand gradually after KPI review windows.

### 9.2 Observability

Record variant context in run/metrics data to compare cohorts:

- `storytellingProfile`
- Scene metadata presence/validity indicators
- Timing profile version identifier

### 9.3 Promotion Rule

Promote `retention_v1` to default only if all agreed KPI thresholds are met versus baseline.

## 10) Testing Strategy

### 10.1 Contract Tests (Stage 2)

- Parse/validate structured fields.
- Confirm invalid optional fields are safely dropped/normalized.
- Confirm baseline compatibility when structured fields are absent.

### 10.2 Hyperframes Template Tests

- Verify computed audio start offset under `baseline` and `retention_v1`.
- Verify `emphasisWords` mapping does not break timing-based highlights.
- Verify transition intent selection maps to expected style behaviors.

### 10.3 Integration Tests

- End-to-end reel assembly succeeds with valid structured metadata.
- End-to-end reel assembly succeeds with malformed structured metadata (fallback path).
- Variant tag propagation is present for downstream metrics analysis.

## 11) Compatibility and Migration

- Existing reels/scripts continue to work with `baseline` profile.
- New structured fields are additive and optional at first.
- No schema-breaking changes required for initial release if metadata is kept in existing context payload.

## 12) Risks and Mitigations

- Risk: Prompt outputs inconsistent structured fields.
  - Mitigation: strict validator + scene-level fallback.
- Risk: Early voice onset feels abrupt for some content.
  - Mitigation: bounded beat-based micro-adjustment and A/B review.
- Risk: Overfitting to one metric.
  - Mitigation: enforce all three agreed retention metrics for promotion.

## 13) Implementation Boundaries

In scope:

- Stage 2 output contract extension and validation logic.
- Hyperframes template pacing/emphasis/transition behavior keyed by profile + scene metadata.
- Variant tagging and test coverage for the new behavior.

Out of scope:

- FFmpeg updates.
- New voice provider integrations.
- Unrelated renderer or pipeline refactors.

## 14) Open Decisions Resolved in This Design

- Renderer target: Hyperframes only.
- Rollout mode: flagged A/B first.
- Primary business metrics: completion rate, 3-second hold, average watch time.
- Promotion threshold: balanced uplift gate (+5%, +8%, +6%).
