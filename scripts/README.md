# scripts/

Helper scripts, run with `npx tsx scripts/<name>` from the repo root. Most need a filled-in `.env`; the ones that read the database use `PIPELINE_DB_PATH`.

## Operations

| Script | What it does |
|---|---|
| `batch-run.ts` | Runs several reels in a row (`npm run batch`) and records them as one batch. |
| `collect-metrics.ts` | Pulls insights for published reels (feeds the performance benchmarks). |
| `clear-stale-runs.ts` | Marks runs left in `running` after a crash as `failed`. |
| `clear-line-events.ts` | Empties the LINE webhook event log. |
| `exchange-meta-token.ts` | Exchanges a short-lived Meta user token for a long-lived page token with Instagram scopes. |
| `tiktok-auth.mjs` | Gets a TikTok access token through OAuth (run on a local machine with a browser). |
| `regen-c2pa-certs.sh` | Regenerates the C2PA signing CA and leaf certificate in `keys/`. |

## Benchmarks and checks

| Script | What it does |
|---|---|
| `benchmark-stage5-renderers.ts` | Times the ffmpeg and Hyperframes renderers on the same story (`npm run benchmark:stage5`). |
| `test-reel.ts` | Runs the reel stages one at a time against real APIs (`--step N` or `--all`). |
| `test-search.ts` | Runs a brand's discovery queries against Tavily and prints the results. |
| `test-stock.ts` | Searches the stock-image providers for a sample prompt. |
| `test-imagen-c2pa.ts` | Generates an image with Imagen and checks its C2PA manifest. |
| `test-c2pa-read.ts` | Checks that the C2PA manifest survives conversion of that image into a video. |
| `test-ds-instagram.ts` | Checks that a Meta page token can publish to the linked Instagram account. |
| `test-token-scopes.ts` | Prints the scopes granted to each brand's Meta page token. |

## StoryReel

| Script | What it does |
|---|---|
| `story-runner.ts` | Runs the StoryReel pipeline on local clips from the command line. |
| `storyreel-director-poc.ts` | Proof of concept: Gemini watches clips and writes a direction. |
| `storyreel-rough-cut-poc.ts` | Proof of concept: cuts a rough edit from a direction. |
| `storyreel-audio-rough-cut-poc.ts` | Proof of concept: rough cut with voiceover and music. |
