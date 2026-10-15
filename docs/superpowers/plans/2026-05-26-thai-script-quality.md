# Thai Script Quality Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single line of Thai guidance in the reel script prompt with full Thai-language category examples, engagement hooks, rhythm rules, CTA phrasing, and TTS-specific formatting — so DS scripts read like native Thai social media news, not translated English.

**Architecture:** Add a parallel `THAI_CATEGORY_RULES` map alongside the existing English `CATEGORY_RULES` in `reel-stage2-script.ts`. Make `buildCategoryPrompt()` language-aware. Expand the system prompt with four new conditional sections (hooks, rhythm, CTA, output rules). Extract prompt assembly into a testable `buildSystemPrompt()` function. All changes are in `src/stages/reel-stage2-script.ts`.

**Tech Stack:** TypeScript, Vitest, ESM (`import` with `.js` extensions)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/stages/reel-stage2-script.ts` | Script generation stage — category rules, prompt builder, stage runner |
| `tests/reel-stage2-script.test.ts` | Unit tests for prompt assembly (new file) |

No other files need modification. The `ReelStage2Script.run()` method signature is unchanged — it reads `ctx.brand.language` and passes it into the prompt builder.

---

### Task 1: Extract `buildSystemPrompt` and add Thai category rules map

**Files:**
- Modify: `src/stages/reel-stage2-script.ts:1-178`
- Create: `tests/reel-stage2-script.test.ts`

This task extracts the inline system prompt string into a standalone exported function `buildSystemPrompt()` so we can unit-test prompt content without mocking Bedrock. It also adds the Thai category rules map.

- [ ] **Step 1: Write the failing test for `buildSystemPrompt`**

Create `tests/reel-stage2-script.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/stages/reel-stage2-script.js";

const dsContext = {
  brand: { language: "th" },
  category: undefined,
  sceneCount: 4,
} as any;

const nsContext = {
  brand: { language: "en" },
  category: undefined,
  sceneCount: 4,
} as any;

describe("buildSystemPrompt", () => {
  it("includes Thai category examples for Thai brand", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("ข่าวด่วน");
    expect(prompt).toContain("รัฐบาลประกาศแช่แข็งราคาน้ำมัน");
    expect(prompt).toContain("เปิดด้วยข้อเท็จจริง");
  });

  it("includes English category examples for English brand", () => {
    const prompt = buildSystemPrompt(nsContext);
    expect(prompt).toContain("Breaking News");
    expect(prompt).toContain("fuel price freeze");
  });

  it("does not include English examples when Thai", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).not.toContain("You won't believe");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: FAIL — `buildSystemPrompt` is not exported

- [ ] **Step 3: Add `THAI_CATEGORY_RULES` and extract `buildSystemPrompt`**

In `src/stages/reel-stage2-script.ts`, add the Thai rules map right after the existing `CATEGORY_RULES` (after line 72), then extract the system prompt into a function. The full changes:

**Add after line 72** (after the closing `};` of `CATEGORY_RULES`):

```typescript
const THAI_CATEGORY_RULES: Record<ReelCategory, CategoryRule> = {
  breaking: {
    label: "ข่าวด่วน",
    discoveryBias: "Prefer stories that are time-sensitive, confirmed hard news, published within the last 24 hours — breaking politics, economy, disasters, or major events.",
    tone: "ด่วน เร็ว ตรงไปตรงมา",
    structure: "เปิดด้วยข้อเท็จจริงที่แน่ชัด → รายละเอียดสำคัญที่ยืนยันแล้ว → ผลกระทบต่อผู้ชม → CTA",
    voiceRules: "ใช้ประโยคบอกเล่าตรงๆ ไม่คาดเดา ไม่ใช้ภาษาฉาวโฉ่ ยึดข้อเท็จจริงที่ยืนยันแล้วเท่านั้น จบด้วย CTA ตามธรรมชาติ",
    sentencesPerScene: "1-3 ประโยคสั้น",
    maxWordsPerSentence: 20,
    pacing: "เร็ว — ประโยคสั้นกระแทก รักษาความเร่งด่วนตลอดทั้งคลิป",
    example: '"ข่าวด่วน รัฐบาลประกาศแช่แข็งราคาน้ำมันทั่วประเทศมีผลทันที\nนายกฯ ยืนยันมาตรการดังกล่าวจะคงอยู่อย่างน้อย 90 วัน\nราคาน้ำมันเบนซินจะไม่เปลี่ยนแปลงแม้ต้นทุนโลกจะขึ้น\nผู้เชี่ยวชาญชี้อาจส่งผลต่อรายได้รัฐหลายพันล้านบาท"',
  },
  trending: {
    label: "ไวรัล",
    discoveryBias: "Prefer stories that are widely shared on social media, have viral potential, are conversation-starting — trending topics, surprising revelations, counter-intuitive findings.",
    tone: "สนทนา กระตือรือร้น น่าสนใจ — ทำให้คนอยากแชร์",
    structure: "ตั้งคำถามหรือข้อความน่าแปลกใจ → เล่าเรื่องจากมุมอารมณ์/สังคม → CTA สร้างการมีส่วนร่วม",
    voiceRules: "ใช้สรรพนามบุรุษที่ 2 พูดกับผู้ชมโดยตรง ใช้คำถามกระตุ้นความอยากรู้ ภาษาพูดธรรมชาติ ไม่เป็นทางการเกินไป",
    sentencesPerScene: "2-4 ประโยค",
    maxWordsPerSentence: 25,
    pacing: "ปานกลาง — สร้างความอยากรู้ รักษาความสนใจไปจนจบ",
    example: '"ตอนนี้หลายคนกำลังพูดถึงเรื่องนี้กัน\nงานวิจัยล่าสุดพบว่าคนทำงานที่บ้านนอนหลับได้นานกว่าออฟฟิศเฉลี่ย 45 นาทีต่อคืน\nแต่รายงานระบุด้วยว่าขอบเขตระหว่างงานกับชีวิตส่วนตัวพร่าเลือนมากขึ้น\nคุณเป็นแบบนี้ด้วยไหม?"',
  },
  human_interest: {
    label: "เรื่องคน",
    discoveryBias: "Prefer stories centered on individuals or communities — personal journeys, acts of kindness, underdogs, people overcoming adversity, emotional transformations.",
    tone: "อบอุ่น เห็นอกเห็นใจ สร้างความผูกพันทางอารมณ์",
    structure: "แนะนำตัวละครหรือสถานการณ์ → เล่าเรื่องราวตามลำดับเหตุการณ์พร้อมรายละเอียดชีวิตจริง → บทสรุปหรือบทเรียน",
    voiceRules: "เล่าเรื่อง สรรพนามบุรุษที่ 3 ใช้ชื่อคนเมื่อทราบ รายละเอียดชีวิตจริง — อารมณ์ ความสัมพันธ์ ช่วงเวลาเฉพาะเจาะจง จังหวะช้ากว่า อบอุ่นกว่า ไม่ใช้ศัพท์เทคนิค",
    sentencesPerScene: "3-4 ประโยค",
    maxWordsPerSentence: 30,
    pacing: "ช้าและอบอุ่น — ให้เรื่องราวมีช่องว่างหายใจ สร้างความผูกพันทางอารมณ์",
    example: '"สมชายขายข้าวแกงข้างทางมา 20 ปีเพื่อเก็บเงินส่งลูกเรียน\nเช้าวันหนึ่งลูกสาวของเขาส่งรูปในชุดครุยมหาวิทยาลัยให้ดู\nสมชายบอกว่านั่นคือวันที่รู้สึกว่าตัวเองรวยที่สุดในชีวิต\nต่อมาภาพดังกล่าวถูกแชร์กว่าสองแสนครั้งในชั่วคืน"',
  },
  business: {
    label: "ธุรกิจ / เทคโนโลยี",
    discoveryBias: "Prefer stories about companies, markets, technology, economic data, industry shifts — earnings, product launches, mergers, economic indicators, tech breakthroughs.",
    tone: "มืออาชีพแต่เข้าใจง่าย — ให้ข้อมูลโดยไม่แห้งแล้ง",
    structure: "เปิดด้วยตัวเลขหรือการเปลี่ยนแปลงที่วัดได้ → อธิบายบริบทและเปรียบเทียบ → ผลกระทบต่ออุตสาหกรรมหรือคนธรรมดา",
    voiceRules: "เริ่มด้วยตัวเลข เปอร์เซ็นต์ การเปรียบเทียบ อธิบายความซับซ้อนอย่างเข้าใจง่าย — หลีกเลี่ยงศัพท์เทคนิคหรืออธิบายทันที น่าเชื่อถือตลอดทั้งเรื่อง",
    sentencesPerScene: "2-3 ประโยค",
    maxWordsPerSentence: 22,
    pacing: "ปานกลาง — ให้ความรู้ แต่ละฉากเพิ่มบริบททีละชั้น",
    example: '"ราคาไข่ไก่พุ่งขึ้น 18 เปอร์เซ็นต์เดือนเดียว\nผู้ผลิตอ้างต้นทุนอาหารสัตว์และค่าพลังงานที่เพิ่มขึ้น\nนักวิเคราะห์คาดราคาจะทรงตัวในระดับนี้ไปอีกอย่างน้อยหนึ่งไตรมาส\nสำหรับครัวเรือนที่กินไข่ทุกวัน นั่นหมายถึงค่าใช้จ่ายเพิ่มประมาณ 200 บาทต่อเดือน"',
  },
  open: {
    label: "ทั่วไป",
    discoveryBias: "",
    tone: "ธรรมชาติ น่าสนใจ — ปรับโทนให้เข้ากับเรื่อง",
    structure: "เปิดด้วยจุดดึงดูด → ข้อมูลสำคัญ → ข้อความจำหรือ CTA",
    voiceRules: "ภาษาพูดธรรมชาติ ปรับโทนและจังหวะให้เข้ากับเรื่อง สนทนาแต่ให้ข้อมูล",
    sentencesPerScene: "1-3 ประโยค",
    maxWordsPerSentence: 25,
    pacing: "ยืดหยุ่น — ปรับจังหวะให้เข้ากับพลังของเรื่อง",
    example: '"นักวิทยาศาสตร์เพิ่งค้นพบว่าปลาหมึกสามารถฝันได้\nและระหว่างนอนหลับผิวของมันจะเปลี่ยนสีเร็วมากเหมือนกำลังแสดงหนัง\nยังไม่มีใครรู้ว่ามันฝันถึงอะไร\nแต่นักวิจารณ์บอกว่านี่อาจเปลี่ยนความเข้าใจเรื่องจิตสำนึกของสัตว์ทั้งหมด"',
  },
};
```

**Modify `buildCategoryPrompt`** to accept a language parameter:

```typescript
function buildCategoryPrompt(forced: ReelCategory | undefined, lang: "Thai" | "English"): string {
  const rules = lang === "Thai" ? THAI_CATEGORY_RULES : CATEGORY_RULES;
  const categoriesList = (Object.entries(rules) as [ReelCategory, CategoryRule][])
    .map(([key, rule]) => `## ${key} — ${rule.label}
  Tone: ${rule.tone}
  Structure: ${rule.structure}
  Voice rules: ${rule.voiceRules}
  Sentences per scene: ${rule.sentencesPerScene} (max ${rule.maxWordsPerSentence} words/sentence)
  Pacing: ${rule.pacing}
  Example style: ${rule.example}`)
    .join("\n\n");

  if (forced) {
    return `CATEGORY: Use category "${forced}" — ${rules[forced].label}. Apply its rules strictly.

${categoriesList}`;
  }

  return `CATEGORY SELECTION: Analyse the story and select the single most appropriate category. Return it as the "category" field in your JSON. Use "open" only as a fallback if the story does not clearly fit any other category.

${categoriesList}`;
}
```

**Extract `buildSystemPrompt`** as an exported function. Replace the inline `systemPrompt` string in `run()` (lines 110-140) with a call to this new function:

```typescript
export function buildSystemPrompt(ctx: {
  brand: { language: string };
  category?: ReelCategory;
  sceneCount: number;
}): string {
  const lang = ctx.brand.language === "th" ? "Thai" as const : "English" as const;
  const sceneCount = ctx.sceneCount;
  const forcedCategory = ctx.category;

  return `You are a social media video scriptwriter. You write short, engaging ${lang} scripts for vertical video reels (Instagram/Facebook/TikTok style).

${lang === "Thai"
    ? "ภาษา: เขียนทั้งหมดเป็นภาษาไทยเท่านั้น ห้ามมีคำภาษาอังกฤษในสคริปต์ ยกเว้นชื่อเฉพาะที่ไม่มีคำแปลไทย (เช่น NASA, WHO, EU)"
    : `LANGUAGE: Write entirely in ${lang}.`}

GENERAL RULES:
- Captions are short punchy text (max 8 words) shown on screen
- Image prompts should be vivid, photorealistic, vertical 9:16 portrait composition
- Hook scene 1 immediately — first 3 seconds decide whether people keep watching
- End the FINAL scene with a clear follow call-to-action. ${lang === "Thai" ? 'ตัวอย่าง: "ติดตามเราไว้เพื่อรับข่าวทุกวัน" หรือ "กด Follow เพื่อไม่พลาดข่าวพรุ่งนี้"' : 'e.g. "Follow for daily updates" or "Hit follow so you don\'t miss tomorrow\'s story."'} Weave it naturally into the scene — do not make it sound like an ad.
- Total video should feel complete in ${sceneCount} scenes (~45-60 seconds)
- ${lang === "Thai"
    ? "สำคัญ: แต่ละฉากต้องมี 25-45 คำ ประโยคไม่เกิน 20 คำต่อประโยค ใส่รายละเอียดเฉพาะเจาะจง: ชื่อ ตัวเลข สถานที่ เวลา ข้อเท็จจริงจากแหล่งข่าว"
    : "CRITICAL: Each scene voiceover must be 20-35 words. Aim for at least 25 words per scene to ensure enough detail. Count carefully — going over 35 words makes the reel too long. Pack each scene with concrete details: names, numbers, locations, times, and specific facts from the source."}
- CRITICAL: Do NOT use honorary titles, royal titles, or formal positions unless you are certain they are current. Source articles often use outdated titles. NEVER use "Prince Andrew" or "the Duke of York" — he is no longer a working royal; just say "Andrew" and identify him by context (e.g. "Andrew, who lives at Royal Lodge"). Apply this principle to all public figures: when in doubt, drop the title and use the name only.

${buildCategoryPrompt(forcedCategory, lang)}

${lang === "Thai" ? `ข้อควรระวังสำหรับ TTS:
- ใช้เลขอารบิก (1, 2, 3) ไม่ใช่เลขไทย (๑, ๒, ๓)
- เปอร์เซ็นต์: เขียน "18 เปอร์เซ็นต์" ไม่ใช่ "18%" — TTS มักข้ามสัญลักษณ์ %
- สกุลเงิน: เขียน "200 บาท" ไม่ใช่ "฿200" — TTS ไม่ออกเสียงสัญลักษณ์บาท
- อย่าจบประโยคด้วย "..." (ellipsis) — TTS ออกเสียงจุดสามจุดแปลกๆ ใช้จุดเดียวหรือไม่ใส่เครื่องหมาย` : ""}

Respond ONLY with valid JSON matching this exact structure:
{
  "category": "breaking",
  "title": "short video title",
  "hashtags": ["#Hashtag1", "#Hashtag2", "#Hashtag3", "#Hashtag4", "#Hashtag5"],
  "scenes": [
    {
      "sceneNumber": 1,
      "voiceover": "spoken text for this scene",
      "caption": "on-screen text overlay",
      "imagePrompt": "detailed image generation prompt, vertical 9:16 framing, photorealistic"
    }
  ]
}

For hashtags: generate 4-5 relevant tags. Mix specific and broad. Write in ${lang}.`;
}
```

**Update `ReelStage2Script.run()`** to use the extracted function:

Replace lines 106-140 with:

```typescript
    const lang = ctx.brand.language === "th" ? "Thai" : "English";
    const sceneCount = ctx.brand.reels?.sceneCount ?? 4;
    const forcedCategory = ctx.category;

    const systemPrompt = buildSystemPrompt({ brand: ctx.brand, category: forcedCategory, sceneCount });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Run all existing tests to verify nothing broke**

Run: `npm run build && npx vitest run`
Expected: All existing tests pass (the reel-runner-context.test.ts mocks ReelStage2Script so it is unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage2-script.ts tests/reel-stage2-script.test.ts
git commit -m "feat: add Thai category rules and extract buildSystemPrompt for testability"
```

---

### Task 2: Add Thai engagement hooks and anti-patterns

**Files:**
- Modify: `src/stages/reel-stage2-script.ts` (in `buildSystemPrompt`)
- Modify: `tests/reel-stage2-script.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/reel-stage2-script.test.ts`:

```typescript
describe("Thai engagement hooks", () => {
  it("includes Thai-specific hooks and anti-patterns", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("รู้ไหมว่า");
    expect(prompt).toContain("สิ่งที่หลายคนไม่รู้คือ");
    expect(prompt).toContain("ห้ามใช้");
    expect(prompt).toContain("❌");
  });

  it("does not include Thai hooks for English brand", () => {
    const prompt = buildSystemPrompt(nsContext);
    expect(prompt).not.toContain("ห้ามใช้");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: FAIL — Thai hooks not present in prompt

- [ ] **Step 3: Add engagement hooks to `buildSystemPrompt`**

In `buildSystemPrompt` in `src/stages/reel-stage2-script.ts`, add the hooks block right after the `GENERAL RULES` section (after the "Hook scene 1 immediately" line) and before the word-count line. Insert between the `- Hook scene 1...` line and the `- End the FINAL scene...` line:

```typescript
${lang === "Thai" ? `ENGAGEMENT HOOKS — ใช้เปิดฉากแรก:
ประเภทที่ใช้ได้:
- ตั้งคำถามที่ผู้ชมยังไม่รู้คำตอบ: "รู้ไหมว่า...", "คุณเคยสงสัยไหมว่า...", "ทำไมถึงเป็นแบบนี้?"
- ชี้ว่ามีข้อมูลที่คนส่วนใหญ่ไม่รู้: "สิ่งที่หลายคนไม่รู้คือ...", "ข้อมูลนี้ไม่ค่อยมีใครพูดถึง..."
- บอกว่าเรื่องนี้กำลังเกิดขึ้นตอนนี้: "เพิ่งเกิดขึ้น...", "ข่าวด่วนจากเมื่อกี้...", "ตอนนี้กำลัง..."
- ดึงความอยากรู้ด้วยความขัดแย้งหรือความประหลาดใจ: "ฟังดูแปลก แต่...", "ผิดจากที่หลายคนคิดไว้..."
ห้ามใช้:
- ❌ "คุณจะไม่เชื่อว่า..." (แปลมาจาก "You won't believe" — ฟังดูไม่เป็นธรรมชาติในภาษาไทย)
- ❌ "ช็อกมาก!", "ไม่น่าเชื่อ!" — ฉาวโฉ่เกินไป ลดความน่าเชื่อถือ
- ❌ ประโยคขึ้นต้นด้วย "นี่คือเรื่องราวที่..." — บอกมากเกินไปก่อนเนื้อหา
- ❌ แปลตรงๆ จากภาษาอังกฤษ เช่น "ทุกคนกำลังพูดถึงเรื่องนี้" — ฟังดูเหมือนแปล` : ""}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stages/reel-stage2-script.ts tests/reel-stage2-script.test.ts
git commit -m "feat: add Thai engagement hooks with anti-patterns"
```

---

### Task 3: Add expanded Thai CTA guidance

**Files:**
- Modify: `src/stages/reel-stage2-script.ts` (in `buildSystemPrompt`)
- Modify: `tests/reel-stage2-script.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/reel-stage2-script.test.ts`:

```typescript
describe("Thai CTA guidance", () => {
  it("includes expanded Thai CTA formats and anti-patterns", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("ติดตาม ThaiDaily");
    expect(prompt).toContain("อยากรู้ว่าเรื่องนี้จะพัฒนาไปอย่างไร");
    expect(prompt).toContain("ข่าวพรุ่งนี้มาแน่");
    expect(prompt).toContain("อย่าลืมกดไลค์ กดแชร์ กดติดตาม");
  });

  it("includes expanded English CTA formats", () => {
    const prompt = buildSystemPrompt(nsContext);
    expect(prompt).toContain("Follow WorldBrief");
    expect(prompt).toContain("Follow to see how this develops");
    expect(prompt).toContain("Like, share, and subscribe");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: FAIL — expanded CTA guidance not present

- [ ] **Step 3: Replace the CTA line in `buildSystemPrompt`**

In `buildSystemPrompt`, replace the CTA line (the one that currently reads `- End the FINAL scene with a clear follow call-to-action...`) with:

```typescript
${lang === "Thai" ? `CTA — ใช้ในฉากสุดท้าย:
เป้าหมาย: ให้ผู้ชมกดติดตามเพราะเข้าใจว่าจะได้รับอะไร — ไม่ใช่แค่บอกให้ติดตาม
รูปแบบที่ใช้ได้:
- บอกคุณค่าที่ชัดเจน: "ติดตาม ThaiDaily เพื่อรับข่าวสำคัญทุกวันก่อนใคร"
- เชื่อมกับเนื้อหา: "อยากรู้ว่าเรื่องนี้จะพัฒนาไปอย่างไร — ติดตามเราไว้"
- สร้าง FOMO เบาๆ: "ข่าวพรุ่งนี้มาแน่ — ติดตามไว้ก่อนเลย"
ห้ามใช้:
- ❌ "อย่าลืมกดไลค์ กดแชร์ กดติดตาม" — ขอมากเกินไปในประโยคเดียว
- ❌ "ถ้าชอบคลิปนี้..." — conditional ทำให้ฟังดูขาดความมั่นใจ
- ❌ CTA ยาวเกิน 15 คำ` : `CTA — use in final scene:
Goal: viewer understands what they get by following — not just a generic ask.
Formats:
- Value-specific: "Follow WorldBrief — we cover European news in 60 seconds, daily."
- Story-continuation: "Follow to see how this develops."
- FOMO: "Tomorrow's story is already in motion — follow so you don't miss it."
Avoid:
- ❌ "Like, share, and subscribe" — asking too much at once
- ❌ "If you enjoyed this..." — conditional undermines confidence
- ❌ CTAs longer than 15 words`}
```

Note: This replaces both the CTA line AND the existing one-line Thai conditional. Remove the old `${lang === "Thai" ? 'Use natural Thai phrasing...' : 'e.g. "Follow...'}` conditional entirely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stages/reel-stage2-script.ts tests/reel-stage2-script.test.ts
git commit -m "feat: expand CTA guidance with Thai-specific formats and anti-patterns"
```

---

### Task 4: Add Thai rhythm rules and final integration test

**Files:**
- Modify: `src/stages/reel-stage2-script.ts` (in `buildSystemPrompt`)
- Modify: `tests/reel-stage2-script.test.ts`

- [ ] **Step 1: Write the failing test for Thai rhythm**

Add to `tests/reel-stage2-script.test.ts`:

```typescript
describe("Thai rhythm rules", () => {
  it("includes Thai word count and TTS-specific rhythm guidance", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("25-45 คำ");
    expect(prompt).toContain("ประโยคสั้นสลับกับประโยคยาว");
    expect(prompt).toContain("28-35 วินาที");
  });

  it("keeps English word count rule for English brand", () => {
    const prompt = buildSystemPrompt(nsContext);
    expect(prompt).toContain("20-35 words");
    expect(prompt).not.toContain("25-45 คำ");
  });
});

describe("Thai TTS formatting rules", () => {
  it("includes Thai number formatting guidance", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("18 เปอร์เซ็นต์");
    expect(prompt).toContain("200 บาท");
    expect(prompt).toContain("อย่าจบประโยคด้วย");
  });

  it("does not include TTS formatting for English brand", () => {
    const prompt = buildSystemPrompt(nsContext);
    expect(prompt).not.toContain("เปอร์เซ็นต์");
  });
});

describe("Thai prompt integration", () => {
  it("Thai prompt has no English engagement hooks", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).not.toContain("You won't believe");
    expect(prompt).not.toContain("nobody's talking about");
  });

  it("Thai prompt has explicit Thai-only output instruction", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("ห้ามมีคำภาษาอังกฤษในสคริปต์");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: FAIL — Thai rhythm and TTS rules not present

- [ ] **Step 3: Add Thai rhythm block to `buildSystemPrompt`**

In `buildSystemPrompt`, the word-count line (the one with `25-45 คำ` for Thai / `20-35 words` for English) already exists from Task 1. Now add the Thai rhythm detail block right after the word-count line and before the TTS formatting block. Find the Thai word-count line (`สำคัญ: แต่ละฉากต้องมี 25-45 คำ...`) and add after it:

```typescript
${lang === "Thai" ? `- ใช้ประโยคสั้นสลับกับประโยคยาวเพื่อสร้างจังหวะ
- เว้นวรรคตามธรรมชาติของภาษาไทย — อย่าใส่จุลภาคแบบอังกฤษ
- สคริปต์รวม ${sceneCount} ฉาก: ความยาวเสียงรวม 28–35 วินาที (TTS ความเร็วปกติ)` : `- Vary sentence length — short punchy sentences followed by longer context sentences`}
```

Note: If this is already covered by the word-count line from Task 1, merge them into a single Thai conditional block rather than having two separate ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reel-stage2-script.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite and build**

Run: `npm run build && npx vitest run`
Expected: All existing tests pass. The `reel-runner-context.test.ts` mocks `ReelStage2Script` and is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/stages/reel-stage2-script.ts tests/reel-stage2-script.test.ts
git commit -m "feat: add Thai rhythm rules, TTS formatting, and integration tests"
```

---

### Task 5: Build, deploy, and verify with a manual dry-run

**Files:**
- No new files

- [ ] **Step 1: Build and check for TypeScript errors**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass. Pre-existing failures in legacy tests (`createPosts`, `getPillarHistory`, `pillar`) are unrelated and expected.

- [ ] **Step 3: Run a DS dry-run to see the prompt output**

Run: `npx tsx src/bin/cli.ts ds --reel --dry-run 2>&1 | head -80`
Expected: The script stage output should show Thai-language prompts. Check for:
- Thai category examples (not English ones)
- Thai engagement hooks present
- No "You won't believe" or other English hooks
- Thai CTA guidance present

- [ ] **Step 4: Commit final state and deploy**

```bash
git add -A
git commit -m "feat: Thai script quality — full prompt parity with English"
npm run build && pm2 restart pipeline
```

- [ ] **Step 5: Verify production logs**

Run: `pm2 logs pipeline --lines 50 --nostream`
Expected: Next DS reel run should show Thai-language script generation with natural Thai phrasing in the scene voiceovers.

---

## Self-Review

**Spec coverage check:**
- Section 1 (Category examples): Task 1 ✅
- Section 2 (Engagement hooks): Task 2 ✅
- Section 3 (Rhythm/word count): Tasks 1 + 4 ✅
- Section 4 (CTA phrasing): Task 3 ✅
- Additional fix #1 (No ellipsis): Task 1 (in TTS block) ✅
- Additional fix #2 (Explicit Thai-only): Task 1 ✅
- Additional fix #3 (Number formatting): Task 1 (in TTS block) ✅

**Placeholder scan:** No TBD, TODO, or placeholder patterns found. Every step has complete code.

**Type consistency:** `buildSystemPrompt` accepts `{ brand: { language: string }, category?: ReelCategory, sceneCount: number }` — consistent across all tasks. `buildCategoryPrompt` accepts `(forced: ReelCategory | undefined, lang: "Thai" | "English")` — consistent across all calls.
