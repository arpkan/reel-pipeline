# Reel Manual Text Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `!reel text` and `!reel hint` reply-flow intake so operators can provide manual text sources (pasted or `.txt`) with required source metadata while preserving existing reel behavior.

**Architecture:** Add a DB-backed intake session state machine keyed by brand/chat, route new commands through that state machine in `command-listener`, and extend reel runner source handling with `manual_text` and `manual_hint` modes. Keep existing reel modes unchanged, and expose provenance in review/caption output. Treat file uploads as Telegram-only in V1 while keeping text intake for both Telegram/LINE.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM + better-sqlite3, Telegram Bot API, existing pipeline stages.

---

## File Structure (planned changes)

- Create: `src/pipeline/reel-intake.ts`
  - Intake session domain types and validation helpers.
- Create: `src/pipeline/reel-intake-session-store.ts`
  - CRUD for DB-backed per-chat intake sessions.
- Create: `tests/reel-intake-session-store.test.ts`
  - Session lifecycle/TTL tests.
- Create: `tests/reel-manual-source-flow.test.ts`
  - End-to-end command flow tests for `!reel text` / `!reel hint`.
- Modify: `src/db/schema.ts`
  - Add `reel_intake_sessions` table.
- Modify: `src/db/client.ts`
  - Add table bootstrap + migration guard for intake sessions.
- Modify: `src/db/queries.ts`
  - Add session store query functions.
- Modify: `src/services/telegram.ts`
  - Expand inbound message shape to include optional `.txt` document payload + downloader helper.
- Modify: `src/pipeline/command-listener.ts`
  - Add new commands, reply-flow state machine, and help text updates.
- Modify: `src/types.ts`
  - Extend `ReelRunOptions`/`ReelContext` with manual source fields.
- Modify: `src/pipeline/reel-runner.ts`
  - Add `manual_text` / `manual_hint` execution paths.
- Modify: `src/stages/stage1-discover.ts`
  - Accept optional hint block in prompt construction.
- Modify: `src/review/reel-html-builder.ts`
  - Render manual mode/source badges and provenance.
- Modify: `tests/reel-command-parser.test.ts`
  - Add parser expectations for new start commands.
- Modify: `tests/reel-review-metadata-fidelity.test.ts`
  - Assert manual source metadata appears correctly.

### Task 1: Add DB-backed intake session storage

**Files:**
- Create: `src/pipeline/reel-intake.ts`
- Create: `src/pipeline/reel-intake-session-store.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/client.ts`
- Modify: `src/db/queries.ts`
- Test: `tests/reel-intake-session-store.test.ts`

- [ ] **Step 1: Write failing session store tests**

```ts
// tests/reel-intake-session-store.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearReelIntakeSession, getReelIntakeSession, upsertReelIntakeSession } from "../src/db/queries.js";

describe("reel intake session store", () => {
  beforeEach(() => {
    clearReelIntakeSession("ds", "chat-1");
  });

  it("creates and reads session by brand/chat", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "text",
      step: "awaiting_source",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const row = getReelIntakeSession("ds", "chat-1");
    expect(row?.mode).toBe("text");
    expect(row?.step).toBe("awaiting_source");
  });

  it("returns null for expired session", () => {
    upsertReelIntakeSession({
      brand: "ds",
      chatId: "chat-1",
      mode: "hint",
      step: "awaiting_content",
      sourceInput: "source: memo",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(getReelIntakeSession("ds", "chat-1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-intake-session-store.test.ts`
Expected: FAIL with missing query functions/table definitions.

- [ ] **Step 3: Add schema + query implementation**

```ts
// src/db/schema.ts
export const reelIntakeSessions = sqliteTable("reel_intake_sessions", {
  brand: text("brand").notNull(),
  chatId: text("chat_id").notNull(),
  mode: text("mode").notNull(), // text | hint
  step: text("step").notNull(), // awaiting_source | awaiting_content
  sourceInput: text("source_input"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.brand, t.chatId] }),
}));
```

```ts
// src/db/queries.ts
export function upsertReelIntakeSession(params: {
  brand: BrandId;
  chatId: string;
  mode: "text" | "hint";
  step: "awaiting_source" | "awaiting_content";
  sourceInput?: string;
  expiresAt: string;
}): void {
  const ts = now();
  db.insert(reelIntakeSessions)
    .values({ ...params, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({
      target: [reelIntakeSessions.brand, reelIntakeSessions.chatId],
      set: { ...params, updatedAt: ts },
    })
    .run();
}
```

- [ ] **Step 4: Add migration bootstrap in DB client**

```sql
CREATE TABLE IF NOT EXISTS reel_intake_sessions (
  brand TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  step TEXT NOT NULL,
  source_input TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (brand, chat_id)
);
```

- [ ] **Step 5: Re-run test and commit**

Run: `npm test -- tests/reel-intake-session-store.test.ts`
Expected: PASS.

```bash
git add src/db/schema.ts src/db/client.ts src/db/queries.ts src/pipeline/reel-intake.ts src/pipeline/reel-intake-session-store.ts tests/reel-intake-session-store.test.ts
git commit -m "feat: add db-backed reel intake session storage"
```

### Task 2: Extend Telegram inbound messages for `.txt` intake

**Files:**
- Modify: `src/services/telegram.ts`
- Test: `tests/reel-manual-source-flow.test.ts`

- [ ] **Step 1: Write failing Telegram message-shape test**

```ts
// tests/reel-manual-source-flow.test.ts
it("maps telegram txt document payload to inbound message", async () => {
  const msg = {
    text: "",
    document: { file_name: "input.txt", file_id: "abc123", mime_type: "text/plain" },
  };
  // parseTelegramMessage is extracted helper in telegram.ts
  const parsed = parseTelegramMessage(99, 1, msg as any);
  expect(parsed.document?.fileName).toBe("input.txt");
  expect(parsed.document?.fileId).toBe("abc123");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/reel-manual-source-flow.test.ts -t "maps telegram txt document payload"`
Expected: FAIL because parser/helper does not exist.

- [ ] **Step 3: Implement Telegram document support (minimal)**

```ts
// src/services/telegram.ts
export interface TelegramDocument {
  fileId: string;
  fileName?: string;
  mimeType?: string;
}

export interface TelegramMessage {
  updateId: number;
  messageId: number;
  text: string;
  date: number;
  document?: TelegramDocument;
}

// include update.message.document mapping in poll loop
```

- [ ] **Step 4: Add `.txt` download helper in Telegram service**

```ts
async downloadTextFile(fileId: string): Promise<string> {
  const fileRes = await fetch(`${this.baseUrl}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileData = await fileRes.json() as { result?: { file_path?: string } };
  const path = fileData.result?.file_path;
  if (!path) throw new Error("Telegram file_path missing");
  const contentRes = await fetch(`https://api.telegram.org/file/bot${this.token}/${path}`);
  if (!contentRes.ok) throw new Error(`Telegram file download failed: ${contentRes.status}`);
  return await contentRes.text();
}
```

- [ ] **Step 5: Re-run targeted test and commit**

Run: `npm test -- tests/reel-manual-source-flow.test.ts -t "maps telegram txt document payload"`
Expected: PASS.

```bash
git add src/services/telegram.ts tests/reel-manual-source-flow.test.ts
git commit -m "feat: support telegram txt document intake for reel commands"
```

### Task 3: Implement command intake state machine for `!reel text` and `!reel hint`

**Files:**
- Modify: `src/pipeline/command-listener.ts`
- Modify: `src/db/queries.ts`
- Modify: `tests/reel-command-parser.test.ts`
- Test: `tests/reel-manual-source-flow.test.ts`

- [ ] **Step 1: Write failing command-flow tests**

```ts
it("starts text mode and prompts for source", async () => {
  await handleCommand("ds", "chat-1", "!reel text", sender);
  expect(sender.sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("Send source"));
});

it("after source prompt, accepts source then asks for content", async () => {
  await handleCommand("ds", "chat-1", "!reel text", sender);
  await handleCommand("ds", "chat-1", "internal memo", sender);
  expect(sender.sendMessage).toHaveBeenCalledWith("chat-1", expect.stringContaining("send content"));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/reel-manual-source-flow.test.ts -t "starts text mode"`
Expected: FAIL, `!reel text` not recognized.

- [ ] **Step 3: Add intake transition logic in `handleCommand`**

```ts
if (t === "reel text" || t === "reel hint") {
  const mode = t.endsWith("hint") ? "hint" : "text";
  upsertReelIntakeSession({ brand: brandId, chatId, mode, step: "awaiting_source", expiresAt: in15Min() });
  await telegram.sendMessage(chatId, "Send source (URL or label).");
  return;
}

const session = getReelIntakeSession(brandId, chatId);
if (session?.step === "awaiting_source") {
  const source = rawTrimmed;
  if (!source) { await telegram.sendMessage(chatId, "Source is required."); return; }
  upsertReelIntakeSession({ ...session, step: "awaiting_content", sourceInput: source, expiresAt: in15Min() });
  await telegram.sendMessage(chatId, "Now send content in one message or upload .txt");
  return;
}
```

- [ ] **Step 4: Add validation branch for content intake**

```ts
if (session?.step === "awaiting_content") {
  const content = await readManualContentFromMessage(rawTrimmed, inboundMsg, telegram);
  if (!content.ok) {
    await telegram.sendMessage(chatId, content.errorMessage);
    return;
  }
  clearReelIntakeSession(brandId, chatId);
  ReelRunner.run(brandId, {
    manualSourceMode: session.mode,
    manualSourceInput: session.sourceInput,
    manualSourceText: content.text,
    manualSourceTextInputType: content.inputType,
    categorySource: "manual",
  }).catch((err) => telegram.sendMessage(chatId, `❌ Failed: ${err.message}`));
  return;
}
```

- [ ] **Step 5: Re-run tests and commit**

Run: `npm test -- tests/reel-manual-source-flow.test.ts tests/reel-command-parser.test.ts`
Expected: PASS for new command flow tests and existing parser tests.

```bash
git add src/pipeline/command-listener.ts src/db/queries.ts tests/reel-manual-source-flow.test.ts tests/reel-command-parser.test.ts
git commit -m "feat: add reel text and hint reply-flow intake"
```

### Task 4: Add reel runner/manual discovery routing

**Files:**
- Modify: `src/types.ts`
- Modify: `src/pipeline/reel-runner.ts`
- Modify: `src/stages/stage1-discover.ts`
- Test: `tests/reel-runner-context.test.ts`

- [ ] **Step 1: Write failing runner context tests**

```ts
it("manual_text bypasses discovery and marks manual mode context", async () => {
  await ReelRunner.run("ds", {
    manualSourceMode: "text",
    manualSourceInput: "internal memo",
    manualSourceText: "Long body...",
  });
  const reel = queries.getRecentReels("ds", 1)[0];
  const ctx = JSON.parse(reel.context ?? "{}");
  expect(ctx.inputMode).toBe("manual_text");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/reel-runner-context.test.ts -t "manual_text bypasses discovery"`
Expected: FAIL due to missing options/context fields.

- [ ] **Step 3: Extend `ReelRunOptions` and `ReelContext` types**

```ts
// src/types.ts
manualSourceMode?: "text" | "hint";
manualSourceInput?: string;
manualSourceText?: string;
manualSourceTextInputType?: "pasted" | "txt_upload";
```

- [ ] **Step 4: Implement runner branching + discovery hint injection**

```ts
// src/pipeline/reel-runner.ts
if (options.manualSourceMode === "text") {
  return {
    story: {
      index: 0,
      headline: deriveManualHeadline(options.manualSourceText),
      source: extractSourceHostOrLabel(options.manualSourceInput),
      sourceUrl: normalizeSourceUrlOrLabel(options.manualSourceInput),
      snippet: options.manualSourceText.slice(0, 2000),
      pillar: "Manual",
      selectionReason: "Manual operator-provided source",
      compositeScore: 0,
      verified: false,
    },
    themeSource: "manual",
  };
}
```

```ts
// src/stages/stage1-discover.ts
const manualHintBlock = ctx.manualSourceHintText
  ? `OPERATOR HINT (guidance only, do not treat as source-of-record):\n${ctx.manualSourceHintText}\n`
  : "";
// include manualHintBlock in prompt
```

- [ ] **Step 5: Re-run tests and commit**

Run: `npm test -- tests/reel-runner-context.test.ts`
Expected: PASS including new manual mode assertions.

```bash
git add src/types.ts src/pipeline/reel-runner.ts src/stages/stage1-discover.ts tests/reel-runner-context.test.ts
git commit -m "feat: route reel runner for manual text and hint source modes"
```

### Task 5: Update review metadata and caption source rendering

**Files:**
- Modify: `src/review/reel-html-builder.ts`
- Modify: `src/pipeline/command-listener.ts`
- Test: `tests/reel-review-metadata-fidelity.test.ts`

- [ ] **Step 1: Write failing metadata/caption tests**

```ts
it("renders source label for manual text source without URL", async () => {
  const html = buildReelReviewHtml(...);
  expect(html).toContain("Manual text");
  expect(html).toContain("Source: internal memo");
});
```

```ts
it("uses Source: label in publish caption when source is non-url label", async () => {
  const caption = buildReelCaption({ headline: "A", sourceUrl: "internal memo", hashtags: ["#x"] });
  expect(caption).toContain("Source: internal memo");
  expect(caption).not.toContain("🔗");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/reel-review-metadata-fidelity.test.ts`
Expected: FAIL because manual mode/source label is not rendered.

- [ ] **Step 3: Implement review badge and provenance rendering**

```ts
// src/review/reel-html-builder.ts
const inputModeLabel = context.inputMode === "manual_text"
  ? "👤 Manual text"
  : context.inputMode === "manual_hint"
    ? "🧭 Manual hint"
    : "🤖 Auto";
```

- [ ] **Step 4: Implement caption fallback for non-URL source**

```ts
const isUrl = /^https?:\/\//i.test(latestReel.sourceUrl);
const sourceLine = isUrl ? `🔗 ${latestReel.sourceUrl}` : `Source: ${latestReel.sourceUrl}`;
const caption = `${latestReel.headline}\n\n${hashtags}\n${sourceLine}`.trim().slice(0, 2200);
```

- [ ] **Step 5: Re-run tests and commit**

Run: `npm test -- tests/reel-review-metadata-fidelity.test.ts`
Expected: PASS.

```bash
git add src/review/reel-html-builder.ts src/pipeline/command-listener.ts tests/reel-review-metadata-fidelity.test.ts
git commit -m "feat: show manual reel source provenance in review and captions"
```

### Task 6: Update help text, regression tests, and full verification

**Files:**
- Modify: `src/pipeline/command-listener.ts`
- Modify: `tests/reel-command-parser.test.ts`
- Modify: `tests/reel-manual-source-flow.test.ts`

- [ ] **Step 1: Add failing help text assertions**

```ts
it("includes new reel text and hint commands in help output", async () => {
  await handleCommand("ds", "chat-1", "!help", sender);
  const msg = String((sender.sendMessage as any).mock.calls[0][1]);
  expect(msg).toContain("!reel text");
  expect(msg).toContain("!reel hint");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/reel-manual-source-flow.test.ts -t "includes new reel text and hint"`
Expected: FAIL before help text is updated.

- [ ] **Step 3: Update help text and edge-case behavior**

```ts
// src/pipeline/command-listener.ts help block additions
// • !reel text — start manual authoritative text intake (source required)
// • !reel hint — start hint intake for discovery guidance (source required)
```

```ts
// ensure !reel cancel clears intake session even if no active reel process
if (subCmd === "cancel") {
  clearReelIntakeSession(brandId, chatId);
  requestCancelReel(brandId);
  await telegram.sendMessage(chatId, "🛑 Cancel requested (active intake cleared)");
  return;
}
```

- [ ] **Step 4: Run full targeted suite**

Run: `npm test -- tests/reel-command-parser.test.ts tests/reel-intake-session-store.test.ts tests/reel-manual-source-flow.test.ts tests/reel-runner-context.test.ts tests/reel-review-metadata-fidelity.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit final integration pass**

Run: `npm run build`
Expected: TypeScript build succeeds without errors.

```bash
git add src/pipeline/command-listener.ts tests/reel-command-parser.test.ts tests/reel-manual-source-flow.test.ts
git commit -m "test: cover manual reel source flows and help text"
```

## Final Verification Checklist

- Run: `npm test -- tests/reel-command-parser.test.ts tests/reel-intake-session-store.test.ts tests/reel-manual-source-flow.test.ts tests/reel-runner-context.test.ts tests/reel-review-metadata-fidelity.test.ts`
- Run: `npm run build`
- Manual dry-run commands in staging chat:
  - `!reel text` -> source -> pasted text -> `!reel confirm <id>`
  - `!reel hint` -> source -> `.txt` upload -> `!reel confirm <id>`
  - `!reel text` with oversized paste -> clear validation error shown
  - `!reel cancel` during intake -> session cleared

## Self-Review (plan vs spec)

- Spec coverage check:
  - `!reel text` + `!reel hint` reply flow: covered in Tasks 3 and 6.
  - Source required (URL or free text): covered in Task 3 validation.
  - `.txt` only attachment path: covered in Task 2 + Task 3 validation.
  - Keep confirmation gate: covered in Task 4 (runner path to existing gate).
  - Review/caption provenance behavior: covered in Task 5.
  - Compatibility with existing reel commands: regression coverage in Task 6.
- Placeholder scan: no TODO/TBD placeholders remain.
- Type consistency: `manualSourceMode`, `manualSourceInput`, `manualSourceText`, and `manualSourceTextInputType` are used consistently across Tasks 3-5.
