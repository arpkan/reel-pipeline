# Conventions

Coding standards observed throughout the codebase.

---

## Language & Runtime

- **TypeScript** with strict ESM (`"type": "module"` in `package.json`)
- Node `>=22` required
- All imports use `.js` extensions even for `.ts` source files (required by Node ESM)
- No `require()` — all imports are `import`/`export`

---

## File & Module Structure

```
bin/          Entry points (server, CLI runner, EC2 worker)
api/routes/   Hono route handlers — one file per domain
src/
  brands/     Brand configuration objects (ds.ts, ns.ts, index.ts, voice-pool.ts)
  db/         Database: schema.ts, queries.ts, client.ts
  effects/    Visual effects: camera-effects.ts, hyperframes-presets.ts
  pipeline/   Orchestration: runner.ts, reel-runner.ts, reel-intake.ts, progress.ts, command-listener.ts
  review/     HTML builder utilities (posts, reels, dashboard)
  services/   One file per external service
  stages/     One file per pipeline stage
  types.ts    All shared types
  config.ts   Env validation + feature flags (isReelAssemblyOffloadEnabled, etc.)
  workers/    Reel assembly worker runner
```

Pipeline stages are named with a numeric prefix matching their execution order: `stage0-pillar-balance.ts`, `stage1-discover.ts`, etc.

Reel stages are prefixed `reel-stage` and numbered 0, 2–5. Stage 0 is discovery; stages 2–5 map to script, voice, images, and assembly respectively. There is no `reel-stage1` — the numbering aligns with the post pipeline's stage 1 (discover) slot.

---

## Types

All shared types are in `src/types.ts`. There are no inline type definitions scattered across files for domain objects.

Key patterns:
- `RunContext` is the immutable-ish state bag passed between pipeline stages
- Each stage returns `Partial<RunContext>` which is merged via `mergeStageOutput()`
- `ReelContext` is the equivalent bag for the reel pipeline
- `Services` is a plain object holding all initialized service clients, passed to each stage
- Brand config (`BrandConfig`) contains no logic — pure data objects
- `VoiceEntry` (in `src/services/voice-provider.ts`) tags each voice with its provider name so the correct TTS client is dispatched at runtime

---

## Stage Interface

Every pipeline stage implements:
```ts
interface Stage {
  name: string;
  run(ctx: RunContext, services: Services): Promise<Partial<RunContext>>;
}

interface ReelStage {
  name: string;
  run(ctx: ReelContext): Promise<Partial<ReelContext>>;
}
```

Stages are lazy-loaded (`await import(...)`) inside the runner to avoid circular dependencies at module initialization.

---

## Naming Conventions

- **Classes**: PascalCase — `PipelineRunner`, `ReelRunner`, `HyperframesStage5Renderer`
- **Functions / methods**: camelCase — `createRunContext`, `mergeStageOutput`
- **Constants**: UPPER_SNAKE_CASE for module-level constants — `REEL_LEAD_MINS`, `STAGE_TIMEOUTS_MS`
- **Files**: kebab-case — `reel-stage2-script.ts`, `hyperframes-presets.ts`
- **DB table columns**: snake_case (Drizzle ORM convention)
- **TypeScript types/interfaces**: PascalCase — `BrandConfig`, `RunContext`, `ApprovalDecision`
- **Type unions**: string literals in kebab-case — `"awaiting_approval"`, `"human_interest"`, `"cinematic_drift"`

---

## Service Factories

Services are created via factory functions, not class constructors called directly:
```ts
const telegram = createTelegramService();
const gcs = createGcsService();
```
Each factory reads `process.env` at call time, making them testable and restartable.

Exception: some newer services (`AzureImageGenService`, `BotnoiService`, `UVoiceService`, `C2paSigner`) are class-based and instantiated with `new`. They still read env vars in their constructor.

---

## Voice Provider Abstraction

All TTS providers implement `VoiceProvider` from `src/services/voice-provider.ts`:
```ts
interface VoiceProvider {
  textToSpeechWithTimestamps(text: string, voiceId: string, language: string): Promise<{ audio: Buffer; wordTimings: WordTiming[] }>;
}
```

Word timings are used by the Hyperframes `enhanced-default` template for word-level subtitle sync. Providers that don't natively return word-level timestamps (Botnoi, UVoice, MiniMax) use Whisper to transcribe the generated audio and extract timings post-hoc.

---

## Error Handling

- Stage errors are caught in the runner loop, logged, written to `stage_logs`, and the run status is set to `"failed"` before rethrowing
- Fire-and-forget background tasks (cron triggers, command handlers) catch errors and broadcast them to Telegram/LINE
- URL hallucination errors (when Tavily can't verify a URL that Gemini invented) are detected by message substring and retried once before failing
- Service calls use `try/catch` with non-fatal logging where partial failure is acceptable (e.g., TikTok publish failing doesn't fail the whole Facebook publish)
- C2PA signing failures are non-fatal — the video is uploaded without provenance metadata but the reel still succeeds

---

## Database Access

All DB access goes through `src/db/queries.ts` — no raw Drizzle/SQL outside that file. Query functions are plain exports (no class), named imperatively: `createRun`, `updateRunStatus`, `getRecentRuns`, `getPostsByRun`.

The DB client (`src/db/client.ts`) is a module-level singleton that reads `PIPELINE_DB_PATH` from env.

---

## Environment Variables

`src/config.ts` validates all required env vars at startup using `validateEnv()`. Missing vars are collected and logged together before `process.exit(1)` — not thrown one at a time. Brand-specific vars follow the pattern `<BRAND_ID_UPPER>_<VAR_NAME>` (e.g., `DS_META_PAGE_TOKEN`, `NS_META_PAGE_ID`).

Feature flags are exported from `src/config.ts` as module-level constants (e.g., `isReelAssemblyOffloadEnabled()`). This keeps env reading centralised rather than scattered across services.

---

## Async Patterns

- Stages are `async` functions returning `Promise<Partial<Context>>`
- The approval poller uses `async function*` generator (`for await` loop) to yield decisions
- Long-polling loops use `while(true)` with `try/catch` and `setTimeout` back-off on error
- Parallel operations use `Promise.all()` with `.catch(() => {})` to prevent one failure from blocking others (e.g., broadcasting to multiple channels)
- Background tasks are fire-and-forget via `.catch(handler)` rather than top-level `await`

---

## Logging

All log lines are prefixed with context identifiers in square brackets:
```
[runId-prefix] message
[reel-cron:ds] message
[cmd-listener:ns] message
[assembly-lock] message
[metrics] ds: 12 candidates
```
No structured logging library — `console.log` / `console.error` / `console.warn` only.

---

## HTML / Review Pages

Review HTML is built by pure string-template functions in `src/review/` and uploaded to GCS as public HTML files. There is no frontend build system — the HTML includes inline `<style>` and `<script>` tags. The server does not serve these pages directly; it redirects to GCS URLs.

The `/dashboard` and `/review/reel/:reelId` routes serve their HTML inline from the server (no GCS upload needed).

Shared utilities live in `src/review/utils.ts`:
- `brandThemeCss(brandId)` — returns a `:root { ... }` CSS block with per-brand custom properties. Both dashboard and reel review pages call this at the top of their style tag so all accent colors are driven by CSS vars rather than hardcoded per-page.
- `brandLogoHtml(brandId, cls)` — returns an `<img>` tag with the brand logo base64-embedded from `assets/brands/`. Logos are read via `readFileSync(join(process.cwd(), "assets/brands", filename))` at module init so the path resolution works in both dev (tsx) and prod (compiled dist/).
- `escapeHtml()`, `statusBadgeHtml()`, `stageLogsHtml()` — shared formatting helpers.

Client-side JS embedded in HTML pages must escape user-controlled strings with a local `eh()` helper (not the server-side `escapeHtml` — that runs at render time, not at DOM-injection time).

---

## Comment Style

Comments use the `─── Section ─────` divider style for major sections within a file:
```ts
// ─── Approval + publish ─────────────────────────────────────────────────────
```

Only non-obvious logic is commented. Self-explanatory code is left without comments.

---

## Testing

Tests live in `tests/` and use Vitest. The test runner is `vitest run` for CI and `vitest` (watch mode) for development.
