# Model Upgrade: Sonnet 4.6 → Sonnet 5.5 (+ Gemini preview cleanup)

**Date:** 2026-10-14
**Status:** Approved 2026-10-14

## Problem

1. **Claude Sonnet 4.6 is two generations old.** `src/services/bedrock.ts` calls `eu.anthropic.claude-sonnet-4-6` for reel scripts (`reel-stage2-script.ts`) and the political-figure name resolver (`reel-stage4-images.ts`). Claude Sonnet 5.5 launched on Bedrock on 2026-09-28. Anthropic's list price for it is **$2 / $10 per MTok**, against **$3 / $15** for Sonnet 4.6, so about 33% less per token. It is available in eu-west-1 through the `eu.anthropic.claude-sonnet-5-5` geo inference profile (same EU destination regions as today).
2. **`stage0-from-url.ts:140` uses `gemini-3-flash-preview`** for YouTube URL classification. It is a preview model, and Google's deprecations page names `gemini-3.6-flash` as its replacement.
3. **A stale model name in a comment.** `image-gen.ts:27` keeps a commented-out `gemini-3-pro-image-preview`, which was shut down on 2026-06-25. Uncommenting it would fail.

## Why a model-ID swap alone would break things

Sonnet 5.5 behaves differently from 4.6 in ways that hit `bedrock.ts` directly:

| Change on Sonnet 5.5 | Effect on current code |
|---|---|
| Adaptive thinking is **on by default** (effort default `high`) | The response can start with a `thinking` block. `bedrock.ts:37` reads `content[0]` and throws `Unexpected response type from Bedrock`. **Every script generation would fail.** |
| Thinking tokens count toward `max_tokens` and are billed as output | With `max_tokens: 8192`, high-effort thinking can crowd out the JSON, bringing back the truncation that `8126f8d` fixed. It would also cancel out the price cut. |
| `thinking: {type: "disabled"}` returns a 400 | Thinking can't simply be turned off. The documented options are a low `effort`, or `thinking: {type: "between_tools"}`. |
| New `stop_reason: "refusal"` safety classifiers (incl. `general_harms`) | News content can occasionally trigger one. Today the code would pass an empty or partial reply to JSON parsing. |

## Fix

### 1. `src/services/bedrock.ts`

- Model ID comes from env, with the new default:
  ```ts
  private readonly modelId = process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-sonnet-5-5";
  ```
  **Rollback** = set `BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-6` in `.env` → `pm2 restart pipeline`. No code change is needed. The request below works on both models: 4.6 accepts `output_config.effort` and simply doesn't think when `thinking` is omitted.
- Effort comes from env and defaults to `low`. Anthropic's migration guide recommends `low` for content generation, classification and extraction. At `low` the model skips thinking on most simple requests, which keeps output tokens close to today's.
  ```ts
  output_config: { effort: (process.env.BEDROCK_EFFORT ?? "low") as "low" | "medium" | "high" },
  ```
- `max_tokens: 8192` → `16000`, leaving room for any thinking on top of the JSON script. This is only a ceiling and costs nothing unless it's used.
- Read the reply by block type, not position:
  ```ts
  if (response.stop_reason === "refusal") {
    throw new Error(`Bedrock refused (${response.stop_details?.category ?? "unknown"}): ${response.stop_details?.explanation ?? ""}`);
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new Error(`Empty text response from Bedrock (stop_reason=${response.stop_reason})`);
  if (response.stop_reason === "max_tokens") console.warn("[bedrock] ⚠️ hit max_tokens — output may be truncated");
  ```
  What callers do on a throw stays the same. Stage 2 retries once, then fails the run. The stage 4 name resolver returns `null`, which anonymizes the person (the safe direction for that guard).
- Log `usage.input_tokens` / `usage.output_tokens` per call (`[bedrock] tokens in=… out=…`) so the cost comparison in Verification can be done from `pm2 logs`.
- The client stays `AnthropicBedrock` (bedrock-runtime), **not** the Mantle client. On the Sonnet 5.5 model card, Mantle has no EU geo profile, while bedrock-runtime has one.

### 2. `package.json`: bump `@anthropic-ai/bedrock-sdk` 0.26.4 → 0.34.4

The pinned version predates `output_config`, `stop_details` and the `refusal` stop reason, so the types are missing. If anything breaks after the bump, the fallback is to stay on 0.26.4 and pass these fields with a cast.

### 3. `src/config.ts`: validate the new env vars

In `validateEnv()`: if `BEDROCK_EFFORT` is set, it must be one of `low | medium | high`. Both vars are optional, so `.env` needs no change. Add both to `.env.example` with comments.

### 4. `src/stages/stage0-from-url.ts:140`

`gemini-3-flash-preview` → `gemini-3.6-flash`, the same model `gemini.ts` already uses. Replace `thinkingConfig: { thinkingBudget: 0 }` with `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: false }` to match `gemini.ts`. This is a low-volume call (YouTube URLs only), so the per-token price difference is negligible.

### 5. Comment fix

`image-gen.ts:27`: change the comment to `gemini-3-pro-image` (the GA replacement).

## Out of scope (reviewed, no change now)

| Model | Why not now |
|---|---|
| `gemini-3.6-flash` (main text) | Current, with no shutdown date. `gemini-3.8-flash` is newer, but its long-term pricing is unverified. Worth an A/B test later. |
| `gemini-3.1-flash-lite-image` | Current and the cheapest image tier. Keep. |
| `eleven_v3` → `eleven_v4` | v4 drops SSML and the Style and Speed settings. Thai support, `with-timestamps` alignment and pricing are unconfirmed. Test separately with `TEST_ELEVENLABS_MODEL=eleven_v4`. |
| `gemini-2.5-flash` (StoryReel) | StoryReel is disabled. Move to `gemini-3.5-flash-lite` before re-enabling it. |
| Azure `gpt-5.5` / `gpt-image-2` | The GPT-5.5 provider is opt-in only. Successor naming and pricing were inconsistent across sources. |
| `scripts/test-imagen-c2pa.ts` (`gemini-3.1-flash-image-preview`, shut down) | Test script only. Fix when it's next used. |

## Verification

1. `npm test`: existing suites pass. Add `tests/bedrock-service.test.ts` with the Anthropic client mocked (no network). It checks:
   - a response of `[thinking, text]` returns the text
   - a `refusal` stop reason throws with the category
   - an empty text throws
   - the request carries `model = BEDROCK_MODEL_ID ?? eu.anthropic.claude-sonnet-5-5`, `output_config.effort = "low"` and `max_tokens = 16000`
2. `npm run build` is clean.
3. Dry runs on both brands, checking the script JSON parses and the Thai/English quality looks right:
   - `npm run cli ds -- --reel --dry-run --stage 2`
   - `npm run cli ns -- --reel --dry-run --stage 2`
4. One YouTube URL dry run through stage 0 (`--url <youtube>`).
5. Deploy: `./deploy.sh "2026-10-14-model-upgrade-sonnet-5-5"`, then `pm2 logs pipeline`.
6. **Cost check after ~1 day:** compare the `[bedrock] tokens` log lines against the same day's runs on 4.6 (approximate from script length). If output tokens per call more than roughly 1.5× the old level, the per-token saving is gone. Fall back to `thinking: {type: "between_tools"}` (thinking off) in a follow-up, or roll back by env.

## Risks

- **Script tone or format changes.** A newer model may write a different style. Mitigation: dry runs in step 3, plus the env rollback.
- **EU pricing unconfirmed.** Bedrock bills Sonnet 5.5 through AWS Marketplace. Check the EU geo rate on the Bedrock pricing page before deploying.
- **Thinking blocks are tied to the account and model.** This doesn't matter here, because every call is a single-turn request with no history replay.

## Implementation notes (2026-10-14)

- `npm test`: 78 files / 625 tests pass, including the new `tests/bedrock-service.test.ts`. Its cases failed against the old `bedrock.ts`, which confirms they catch the `content[0]` bug. `npm run build` is clean.
- The CLI dry runs in Verification step 3 don't work as written. For reels, `--dry-run` stops after the story fetch and `--stage` is ignored, so stage 2 never runs. Instead, a scratch script ran the real `ReelStage2Script` (ds and ns) and `resolveNamedPersonFromVoiceover` against Bedrock, with a temp DB.
- **Blocker:** `eu.anthropic.claude-sonnet-5-5` returns `403 anthropic.claude-sonnet-5-5 is not available for this account`. Model access must be enabled for the AWS account (eu-west-1) before the default can go live.
- With `BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-6` (the rollback path), the new code works end to end:
  - ds: 4 scenes, in=4552 / out=923 tokens
  - ns: 4 scenes, in=1891 / out=622 tokens
  - resolver: returns `Anutin Charnvirakul` for a named politician, and `null` for a crowd
- **Access fix:** the Bedrock Marketplace agreement for `anthropic.claude-sonnet-5-5` was `NOT_AVAILABLE`. It was accepted in eu-west-1 at 12:25 UTC. Invocation kept returning 403 for a while afterwards (as reported on AWS re:Post), and access was enabled later the same day.
- **Sonnet 5.5 live check** (same scratch script, effort `low`):
  - ds: 4 scenes, in=4994 / out=1168 tokens (7.9s)
  - ns: 4 scenes, in=2698 / out=839 tokens (6.3s)
  - resolver: same results as 4.6
  - Both scripts' Thai and English quality looked right.
- **Cost:** the EU geo price is **$2.20 / $11 per MTok**, not the $2 / $10 list price. Output runs 1.27–1.35× of 4.6, under the 1.5× threshold. Estimated cost per call: ds −13% ($0.0275 → $0.0238), ns about the same ($0.0150 → $0.0152).
- **Went live 2026-10-14:** removed the `BEDROCK_MODEL_ID` pin from `.env` and restarted `pipeline`. The cost check (Verification step 6) is still to do.
