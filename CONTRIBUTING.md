# Contributing

The [README](README.md) covers what the pipeline does and how it is laid out. This page covers how to work on it.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Server with cron and Telegram/LINE listeners, reloads on change (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run the Vitest suite once |
| `npm run cli -- <ds\|ns\|ts> --reel [--url <url>] [--dry-run] [--resume <runId>]` | Run one reel from the command line |

Brand IDs: `ds` (ThaiDaily, Thai), `ns` (WorldBrief, English), `ts` (TagesBrief, German).

## Workflow

Every change starts as a short design doc in [`docs/`](docs/) (`YYYY-MM-DD-<topic>.md`): the problem, the fix, how it will be verified, and the risks. The doc is reviewed before any code is written, and implementation notes are added to it afterwards.

## Code conventions

- **ESM.** The package is `"type": "module"`, so local imports use the `.js` extension: `import { db } from "./client.js"`.
- **Database.** Drizzle ORM over `better-sqlite3`. Schema in `src/db/schema.ts`, queries in `src/db/queries.ts`. Schema changes are inline `ALTER TABLE` / `CREATE TABLE` statements wrapped in `try/catch` in `src/db/client.ts`, not drizzle-kit migrations.
- **Configuration.** New environment variables go in `.env.example` and, if required, in `validateEnv()` in `src/config.ts`. `tests/env-example-coverage.test.ts` fails if the code reads a variable that `.env.example` doesn't list.
- **Paths.** Build file paths from `PROJECT_ROOT` / `assetPath()` in `src/paths.ts`, never from absolute paths.
- **Image provenance.** Every image records whether it came from a stock provider or an AI model (stored in the reel's `context`). AI images are labelled on screen and signed with C2PA.

## Tests

- **No real network calls.** Mock external services with `nock`, `vi.stubGlobal("fetch", …)` or `vi.mock`.
- **Never touch the real database.** ESM hoists static imports, so set `PIPELINE_DB_PATH` first and import database modules dynamically:

  ```ts
  process.env.PIPELINE_DB_PATH = `/tmp/test-pipeline-${process.pid}-${Date.now()}.db`;
  const { createReel, getReelById } = await import("../src/db/queries.js");
  ```
