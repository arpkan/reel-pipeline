# StoryReel Director POC Design

## Goal

Test whether Gemini can act as a video director for raw user-shot clips before integrating the idea into the production reel pipeline.

The first POC is director-only. It should answer one question: can Gemini inspect local video clips and return useful structured edit direction, including selected moments, clip order, hook, Thai or English voiceover, captions, CTA, hashtags, and director notes?

## Scope

Build an isolated TypeScript script in this repository. It will not touch the database, Telegram/LINE workflows, scheduling, approval commands, publishing, or existing reel stages.

The script will accept local clip paths and metadata, upload the clips to Gemini, request a strict JSON director response, validate the response, and save reviewable artifacts under `work/storyreel-poc/<runId>/`.

## Command

```bash
tsx scripts/storyreel-director-poc.ts \
  --clips work/storyreel-poc/input/clip1.mp4 work/storyreel-poc/input/clip2.mp4 \
  --product "Testing story" \
  --note "short creative guidance" \
  --language thai
```

## Input Files

Use `work/storyreel-poc/input/` for local test clips. This keeps test media out of source directories and aligns with existing generated-work conventions.

For the first test, place the two clips here:

```text
work/storyreel-poc/input/clip1.mp4
work/storyreel-poc/input/clip2.mp4
```

The script should support `mp4`, `mov`, `m4v`, and common phone-video formats if Gemini accepts them. It should fail clearly if a path is missing or unsupported.

## Output Artifacts

For each run, create `work/storyreel-poc/<runId>/` containing:

- `direction.json`: parsed Gemini director response.
- `prompt.txt`: exact prompt sent to Gemini.
- `summary.txt`: human-readable summary of selected moments, hook, captions, CTA, script, and director notes.

The console output should mirror the important parts of `summary.txt` so the user can quickly decide whether the result is worth rendering in POC B.

## Director Response Shape

Gemini should return only valid JSON with this high-level structure:

```json
{
  "hook_clip": {
    "clip_index": 0,
    "start_sec": 0,
    "end_sec": 3,
    "reason": "why this works as the hook"
  },
  "clips": [
    {
      "clip_index": 0,
      "start_sec": 0,
      "end_sec": 8,
      "order": 1,
      "role": "hook"
    }
  ],
  "voiceover_script": {
    "full_text": "complete script",
    "segments": [
      {
        "order": 1,
        "text": "script for this segment",
        "duration_sec": 8
      }
    ]
  },
  "hook_text_overlay": "short hook text",
  "caption_lines": ["caption 1", "caption 2"],
  "cta_text": "follow CTA",
  "facebook_caption": "2-3 sentence post caption",
  "hashtags": ["#tag1", "#tag2"],
  "total_duration_sec": 45,
  "director_notes": "creative reasoning"
}
```

## Validation

The POC should validate enough to catch unusable output:

- Required top-level fields are present.
- Clip indices refer to provided clips.
- Timestamps are numeric and `end_sec > start_sec`.
- Clip order values are numeric.
- Script text is non-empty.
- Total duration is numeric when provided.

This validation is intentionally lightweight. The POC should not overfit production rules before we know whether the director concept works.

## Success Criteria

POC A passes if the saved direction is manually useful:

- Gemini returns valid structured JSON.
- Selected timestamps point to plausible moments in the raw clips.
- The first selected moment can work as a hook.
- Clip order creates a coherent story.
- Thai script sounds natural when `--language thai` is used.
- Captions and CTA are short enough for vertical video.

## Later POC B

If POC A passes, add a rough renderer that consumes `direction.json`:

- Trim selected clip segments with FFmpeg.
- Concatenate segments in the chosen order.
- Add simple hook and CTA overlays.
- Optionally add voiceover after the visual edit is proven.

POC B should still remain isolated until we decide how this maps into the existing reel stage architecture.

## Non-Goals

- No Telegram upload handling.
- No database schema changes.
- No approval workflow changes.
- No Meta publishing.
- No production stage replacement.
- No Python implementation.
