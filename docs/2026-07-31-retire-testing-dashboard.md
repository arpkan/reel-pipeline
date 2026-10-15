# Retire the `/testing` dashboard

## Why

The `/testing` web dashboard is confirmed unused. It's ~1,850 lines of route +
HTML code, plus a test suite, that add surface area for no active benefit.
Retiring it simplifies `bin/server.ts` and removes a live, secret-token-gated
HTTP surface that nobody exercises.

## Scope — what gets removed

1. **`api/routes/testing.ts`** (410 lines) — the Hono router: seed/run/diff/
   snapshot-update endpoints for stage tests and reel-stage tests, plus static
   file serving for `test/work/reels/*` and brand logos under `/testing/*`.
2. **`api/routes/testing-html.ts`** (1,437 lines) — the HTML dashboard UI
   served at `GET /testing`.
3. **`bin/server.ts`** — remove the `testingRouter` import (line 28) and
   `app.route("/", testingRouter)` mount (line 45).
4. **`tests/testing-routes.test.ts`** (76 lines) — the vitest suite covering
   these routes.
5. **Doc references** — trim the now-dead endpoint docs:
   - `ref-docs/architecture.md:177` (one-line bullet about `testing.ts`)
   - `ref-docs/onboarding.md:85` (`TESTING_SECRET=` env var line)
   - `ref-docs/api-reference.md` (`## Testing UI` section, 3 endpoints)
6. **`.env` / `.env.example`** — remove `TESTING_SECRET` (only used to guard
   these routes).

## Explicitly out of scope

`test/runner.ts`, `test/seed.ts`, `test/compare.ts`, `test/fixtures/`,
`test/snapshots/`, and the `npm run test:seed` / `test:stage0..4b` / `test:all`
CLI scripts in `package.json` are **left untouched**. The HTTP routes are a
thin wrapper that dynamically imports these modules, but the modules
themselves are also invoked directly from the command line as a separate
stage-snapshot-testing workflow. Deleting the web dashboard doesn't require
touching this CLI harness.

**If you'd rather I remove the CLI harness too**, say so and I'll fold that
into this doc before implementing — right now the plan only kills the web UI
and its unique dependencies (nothing else imports `test/*` besides
`testing.ts`, so this is a safe, additive-scope decision either way).

## Not touched

- `work/reels/` (production job dirs) — unrelated, and `test/work/reels/` is
  a separate sandbox path anyway.
- Historical planning docs (`docs/superpowers/plans/2026-04-21-pipeline-
  testing-environment.md` and its spec) — left as historical record, not
  live documentation.

## Deploy

`./deploy.sh "2026-07-31-retire-testing-dashboard"`
