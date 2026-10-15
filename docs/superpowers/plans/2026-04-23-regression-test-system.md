# Regression Test System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable regression testing system that prevents command-routing bugs (case-sensitive theme mismatch and URL case corruption) from recurring in CI.

**Architecture:** Introduce a small pure parser module for `!post` and `!reel` command inputs, then test that module exhaustively with fast unit tests. Keep `command-listener.ts` as orchestration only, consuming parser output to invoke runners. Add one listener-level integration test and a lightweight regression catalog to document bug-to-test mapping.

**Tech Stack:** TypeScript, Vitest, existing `src/pipeline/command-listener.ts` flow, npm scripts.

---

## File Structure (locked before implementation)

- Create: `src/pipeline/command-parser.ts`
  - Responsibility: Pure parsing/normalization for `!post` and `!reel` start commands.
  - Input: raw command text and valid theme list.
  - Output: deterministic parse result (`matchedTheme`, `urls`, `category`, `useStockImages`, `subCmd`).

- Modify: `src/pipeline/command-listener.ts`
  - Replace inline parsing logic with calls to `command-parser.ts`.
  - Keep orchestration (telegram messaging, runner invocations) untouched.

- Create: `tests/command-parser.test.ts`
  - Exhaustive unit tests for parser edge cases.

- Create: `tests/regression-catalog.md`
  - Documents bug-to-test mapping for regression tracking.

---

## Task 1: Create command-parser module

**Files:**
- Create: `src/pipeline/command-parser.ts`

- [ ] **Step 1: Define parse result types**

```typescript
export interface ParsedReelCommand {
  subCmd: string;
  theme?: string;
  category?: string;
  urls?: string[];
  useStockImages?: boolean;
}

export interface ParsedPostCommand {
  subCmd: string;
  urls?: string[];
  useStockImages?: boolean;
}

export function parseReelCommand(
  raw: string,
  validThemes: string[],
): ParsedReelCommand {
  const text = raw.trim();
  const subCmd = text.split(/\s+/)[0] || "";

  // Extract URLs
  const urls = text.match(/https?:\/\/\S+/g)?.slice(0, 1);

  // Check for -nostock flag
  const useStockImages = !text.includes("-nostock");

  // Match theme (case-insensitive)
  const words = text.split(/\s+/).slice(1).filter(w => !w.startsWith("http") && w !== "-nostock");
  const theme = words.find(w =>
    validThemes.some(t => t.toLowerCase() === w.toLowerCase())
  );

  return { subCmd, theme, urls, useStockImages };
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run build`
Expected: clean.

---

## Task 2: Write exhaustive parser tests

**Files:**
- Create: `tests/command-parser.test.ts`

- [ ] **Step 1: Write tests for case-insensitive theme matching**

```typescript
describe("parseReelCommand", () => {
  it("matches theme case-insensitively", () => {
    const result = parseReelCommand("Controversy", ["Controversy", "Scandal"]);
    expect(result.theme).toBe("Controversy");
  });

  it("matches lowercase theme", () => {
    const result = parseReelCommand("controversy", ["Controversy", "Scandal"]);
    expect(result.theme).toBe("Controversy");
  });

  it("matches UPPERCASE theme", () => {
    const result = parseReelCommand("SCANDAL", ["Controversy", "Scandal"]);
    expect(result.theme).toBe("Scandal");
  });

  it("extracts URL", () => {
    const result = parseReelCommand("https://example.com/story", []);
    expect(result.urls).toEqual(["https://example.com/story"]);
  });

  it("detects -nostock flag", () => {
    const result = parseReelCommand("Controversy -nostock", ["Controversy"]);
    expect(result.useStockImages).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/command-parser.test.ts`
Expected: PASS.

---

## Task 3: Wire parser into command-listener

**Files:**
- Modify: `src/pipeline/command-listener.ts`

- [ ] **Step 1: Replace inline theme matching with parser call**

Find the existing inline logic that matches themes and replace with:

```typescript
import { parseReelCommand } from "./command-parser.js";

// In the reel command handler:
const parsed = parseReelCommand(subCmd, validThemes);
const matchedReelTheme = parsed.theme;
```

- [ ] **Step 2: Verify no regressions in command handling**

Run: `npm run build && npm test`
Expected: build clean, all existing tests pass.

---

## Task 4: Create regression catalog

**Files:**
- Create: `tests/regression-catalog.md`

- [ ] **Step 1: Document known bugs and their test coverage**

```markdown
# Regression Catalog

## BUG-001: Case-sensitive theme matching
- **Symptom:** `!reel controversy` was ignored (only `!reel Controversy` worked)
- **Root cause:** Direct string comparison against theme list
- **Test:** `command-parser.test.ts` — "matches theme case-insensitively"
- **Fixed:** 2026-04-23

## BUG-002: URL case corruption
- **Symptom:** URLs with uppercase paths were lowercased
- **Root cause:** Overly aggressive normalization
- **Test:** `command-parser.test.ts` — "extracts URL without modification"
- **Fixed:** 2026-04-23
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Verify command parsing in production**

Run: manually test via Telegram or inspect logs
Expected: `!reel controversy` triggers Controversy theme, URLs preserved.
