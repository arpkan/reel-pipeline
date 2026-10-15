# Reel Manual Text Source Design

Date: 2026-04-26
Status: Approved (design)

## Objective

Add two new reel intake modes so operators can use source content that discovery cannot read:

- `!reel text`: operator-provided content is authoritative.
- `!reel hint`: operator-provided content guides discovery, but discovery output remains source-of-record.

This design must preserve existing `!reel` behavior for URL/theme/category/effect commands.

## Scope

In scope:

- Telegram/LINE command intake flow for `!reel text` and `!reel hint`
- Required source metadata collection (URL or free-text label)
- Content intake via single chat message or `.txt` upload
- Reel context metadata, review rendering, and caption source handling
- Validation, session expiry, cancellation, and tests

Out of scope:

- Multi-message content chunking
- Non-`.txt` document parsing (PDF, DOCX, etc.)
- Changes to legacy `!reel` start modes beyond compatibility updates

## Operator Experience

### Commands

- `!reel text`
- `!reel hint`

### Intake sequence (reply flow only)

1. Operator sends `!reel text` or `!reel hint`.
2. Bot asks for source (required): URL or any non-empty free-text label.
3. Operator sends source.
4. Bot asks for content input: single pasted message or `.txt` file upload.
5. Operator sends content.
6. Bot validates and creates reel run.
7. Pipeline pauses at existing confirmation gate (`!reel confirm <id>`).

### Source requirement behavior

- Source is mandatory.
- URL is optional; free-text source label is allowed.
- Free-text label can be any non-empty string.

### Content constraints

- Single-message paste must fit platform length constraints (Telegram practical limit: about 4096 chars).
- If too long, bot rejects with clear instruction to shorten or upload `.txt`.
- Only `.txt` attachments are accepted.

## Architecture

## 1) Intake Session State Machine

Introduce a small per-chat intake session used only by `!reel text` and `!reel hint`:

- Key: `brandId + chatId`
- Fields:
  - `mode`: `text | hint`
  - `step`: `awaiting_source | awaiting_content`
  - `sourceInput`: string (required once provided)
  - `expiresAt`: timestamp (TTL)

Why DB-backed session state:

- survives listener restarts
- avoids losing partially completed intake flow
- enables deterministic timeout/cancel behavior

Session lifecycle:

- create on start command
- update after source received
- clear on success, cancellation, timeout, or fatal validation error

## 2) Runner Source Routing

Add explicit source mode routing before stage execution:

- `manual_text` path (`!reel text`)
  - bypass discovery selection
  - synthesize story payload from required source + provided content
- `manual_hint` path (`!reel hint`)
  - run normal discovery
  - inject provided content as discovery guidance
  - keep discovered article as canonical source URL

Existing source modes remain unchanged:

- direct URL (`!reel <url>`)
- theme/category/effect/auto discovery modes

## 3) Data Model Additions

Persist normalized provenance metadata in reel context:

- `inputMode`: `manual_text | manual_hint | url | discovery`
- `manualSourceLabel`: optional string (when source is not URL)
- `manualTextProvided`: boolean
- `manualTextDigest`: short hash for trace/debug without full text logging
- `manualTextInputType`: `pasted | txt_upload`

Store manual text content where script/discovery stages can consume it. Full text is stored for processing, but logging must never print full payload.

## Data Flow

## `!reel text`

1. Intake session collects required source and content.
2. Runner creates `manual_text` reel context.
3. Stage 0 uses operator content as primary material.
4. Standard reel stages continue.
5. Status becomes `awaiting_script_confirmation`.

## `!reel hint`

1. Intake session collects required source and content.
2. Runner creates `manual_hint` reel context.
3. Discovery runs normally with hint guidance added to prompt.
4. Selected discovered story URL remains source-of-record.
5. Standard reel stages continue.
6. Status becomes `awaiting_script_confirmation`.

## Validation and Error Handling

Validation rules:

- reject start when another reel is actively running for brand
- reject missing/empty source
- reject unsupported attachment type
- reject oversized pasted content
- reject invalid/empty `.txt` payload

Error UX:

- explicit retry prompts per failed step
- expired session response instructs restart with `!reel text` or `!reel hint`
- `!reel cancel` clears active intake session and reports result

Observability:

- log only metadata: mode, source type, content length, digest
- do not log full pasted/uploaded text

## Review and Publishing Behavior

Review page updates:

- mode badge: `Manual text` or `Manual hint`
- source badge: `URL` or `Label`
- source display value
- content provenance summary (length + pasted/uploaded)

Caption source line:

- source is URL: keep existing link line
- source is free-text label: replace link line with `Source: <label>`

For `manual_hint`, discovered URL remains canonical source in publishing metadata.

## Compatibility Requirements

The following must remain behaviorally unchanged:

- `!reel` (auto discovery)
- `!reel <theme>`
- `!reel <category>`
- `!reel <category> <effect>`
- `!reel <effect>`
- `!reel <url>`
- `!reel confirm <id>`

## Testing Strategy

Unit tests:

- parser coverage for `!reel text` and `!reel hint`
- intake validator coverage (source required, `.txt` only, size checks)
- caption rendering for URL vs free-text source

Integration tests:

- full `manual_text` intake flow to `awaiting_script_confirmation`
- full `manual_hint` intake flow to `awaiting_script_confirmation`
- timeout and cancel session cleanup
- running-reel conflict handling
- regression checks for existing reel command forms

## Risks and Mitigations

- Long pasted content near platform limits can fail unexpectedly.
  - Mitigation: deterministic length validation + `.txt` fallback message.
- Intake state can become stale if users abandon flow.
  - Mitigation: TTL + explicit cleanup on cancel/timeouts/errors.
- Command listener complexity may grow.
  - Mitigation: isolate intake state transitions in a focused helper module.

## Success Criteria

- Operators can run `!reel text` and `!reel hint` end-to-end via reply flow.
- Source is always present (URL or label).
- `.txt` uploads work; non-`.txt` files are rejected with clear guidance.
- Both modes land at the existing `!reel confirm <id>` gate.
- Existing reel command variants continue to behave unchanged.
