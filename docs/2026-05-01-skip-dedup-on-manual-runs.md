# Skip Dedup Check on Manual Runs

## Change

In `reel-runner.ts`, the hard server-side URL dedup check now skips when the run is manual:

- `!reel text` — `manualSourceMode` is set
- `!reel <url>` — `sourceUrls` is provided

Only automated discover runs (scheduled or `!reel` with no input) remain subject to the dedup check.

## File

`src/pipeline/reel-runner.ts`
