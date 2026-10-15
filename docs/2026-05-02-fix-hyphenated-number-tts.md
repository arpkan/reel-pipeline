# Fix: Hyphenated number compounds read as digits by TTS

## Problem

ElevenLabs reads `12-meter` as "one-two meter" instead of "twelve meter".

This happens because `normalizeVoiceoverForTts` only handles two specific patterns — dollar amounts and `N-year-old` — but does nothing for the general case of a number before a hyphen-word compound like `12-meter`, `5-day`, `30-minute`, etc.

**Affected run:** c7096c5d — "A 12-meter humpback whale was trapped..."

## Fix

Add a general rule in `normalizeVoiceoverForTts` (after the existing specific rules) that converts any `\bN-word\b` compound — where N is 0–99 — to its spelled-out form:

- `12-meter` → `twelve-meter`
- `5-day` → `five-day`
- `30-minute` → `thirty-minute`

Numbers ≥ 100 are left unchanged (TTS handles those correctly without the hyphen trigger).

The new rule runs **after** the existing `-year-old` rule so there's no double-processing.

## File changed

`src/stages/reel-stage3-voice.ts` — `normalizeVoiceoverForTts`
