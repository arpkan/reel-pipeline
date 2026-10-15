# TagesBrief (`ts`) German Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third brand `ts` (TagesBrief, German-language, DACH+EU focus) to the content pipeline with full localization parity to `ds` (Thai).

**Architecture:** Replace ad-hoc `isThai` ternaries with two lookup modules (`src/i18n/reel-strings.ts`, `src/i18n/ui-strings.ts`). Thai/English strings move verbatim — zero behaviour change for `ds`/`ns`. German (`de`) is added as a new column. Then register the `ts` brand config and wire up dashboard, review UI, and renderer assets.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, Drizzle ORM over better-sqlite3, ElevenLabs TTS, Gemini/Bedrock LLM, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-07-13-tagesbrief-german-brand-design.md`

---

## File Structure

**New files:**
- `src/i18n/reel-strings.ts` — script/CTA/TTS strings keyed by language
- `src/i18n/ui-strings.ts` — review-page + Telegram UI strings keyed by language
- `src/brands/ts.ts` — TagesBrief brand config
- `tests/i18n/reel-strings.test.ts`
- `tests/i18n/ui-strings.test.ts`
- `tests/brands/ts.test.ts`

**Modified files (consumers):**
- `src/types.ts` — widen `BrandId` and `language` unions
- `src/brands/index.ts` — register `ts`
- `src/config.ts` — add `ts` to `ALL_BRANDS`
- `src/stages/reel-stage2-script.ts` — consume `REEL_STRINGS`
- `src/stages/stage1-discover.ts` — language label + DACH geo rule
- `src/stages/stage0-from-url.ts` — language label
- `src/stages/reel-stage3-voice.ts` — language code map
- `src/review/utils.ts` — logo, theme, status labels via lookup
- `src/review/reel-html-builder.ts` — UI labels via lookup
- `src/review/dashboard-html-builder.ts` — brand label + nav
- `src/pipeline/command-listener.ts` — Telegram messages via lookup
- `src/pipeline/reel-intake.ts` — `BrandId` type
- `src/workers/reel-assembly-worker.ts` — `BrandId` type
- `src/stages/reel-stage5-hyperframes-renderer.ts` — logo asset map
- `src/db/schema.ts` — comment

---

## Task 1: Create reel-strings i18n table

**Files:**
- Create: `src/i18n/reel-strings.ts`
- Test: `tests/i18n/reel-strings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/i18n/reel-strings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { REEL_STRINGS, type ReelLang } from "../../src/i18n/reel-strings.js";

describe("REEL_STRINGS", () => {
  const requiredKeys: (keyof typeof REEL_STRINGS.th)[] = [
    "langLabel", "languageLine", "hooksBlock", "ctaBlock",
    "wordCountBlock", "ttsBlock", "ctaSignals", "ctaAppends",
  ];

  (["th", "en", "de"] as ReelLang[]).forEach((lang) => {
    describe(`${lang}`, () => {
      requiredKeys.forEach((key) => {
        it(`has ${key}`, () => {
          expect(REEL_STRINGS[lang][key]).toBeDefined();
        });
      });

      it("has at least one CTA signal regex", () => {
        expect(REEL_STRINGS[lang].ctaSignals.length).toBeGreaterThan(0);
        REEL_STRINGS[lang].ctaSignals.forEach((re) => {
          expect(re).toBeInstanceOf(RegExp);
        });
      });

      it("has at least one CTA append string", () => {
        expect(REEL_STRINGS[lang].ctaAppends.length).toBeGreaterThan(0);
      });
    });
  });

  it("Thai languageLine is preserved verbatim (ds regression guard)", () => {
    expect(REEL_STRINGS.th.languageLine).toContain("ภาษา: เขียนทั้งหมดเป็นภาษาไทยเท่านั้น");
  });

  it("English langLabel is 'English' (ns regression guard)", () => {
    expect(REEL_STRINGS.en.langLabel).toBe("English");
  });

  it("German langLabel is 'German'", () => {
    expect(REEL_STRINGS.de.langLabel).toBe("German");
  });

  it("German CTA appends mention TagesBrief brand", () => {
    expect(REEL_STRINGS.de.ctaAppends.some((s) => s.includes("TagesBrief"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n/reel-strings.test.ts`
Expected: FAIL with "Cannot find module '../../src/i18n/reel-strings.js'"

- [ ] **Step 3: Create the i18n module**

Create `src/i18n/reel-strings.ts`. Thai and English values are moved **verbatim** from `src/stages/reel-stage2-script.ts` (lines 162-294). German values are newly written.

```typescript
export type ReelLang = "th" | "en" | "de";

export interface ReelStringSet {
  langLabel: string;
  languageLine: string;
  hooksBlock: string;
  ctaBlock: string;
  wordCountBlock: string;
  ttsBlock: string;
  ctaSignals: RegExp[];
  ctaAppends: string[];
}

export const REEL_STRINGS: Record<ReelLang, ReelStringSet> = {
  th: {
    langLabel: "Thai",
    languageLine: "ภาษา: เขียนทั้งหมดเป็นภาษาไทยเท่านั้น ห้ามมีคำภาษาอังกฤษในสคริปต์ ยกเว้นชื่อเฉพาะที่ไม่มีคำแปลไทย (เช่น NASA, WHO, EU)",
    hooksBlock: `
Engagement hooks ที่ใช้ได้:
- "รู้ไหมว่า..."
- "สิ่งที่หลายคนไม่รู้คือ..."
- "เพิ่งเกิดขึ้น..."
- "ฟังดูแปลก แต่..."
ห้ามใช้ clickbait หรือจังหวะยั่วยุ:
❌ "คุณจะไม่เชื่อว่า..."
❌ "ช็อกมาก!"
❌ "นี่คือเรื่องราวที่..."
❌ "ทุกคนกำลังพูดถึงเรื่องนี้"
`,
    ctaBlock: `CTA (Call-to-Action): จบฉากสุดท้ายด้วย CTA แบบใดแบบหนึ่ง:
- ค่านิยม (value-specific): "ติดตาม ThaiDaily เพื่อรับข่าวสำคัญทุกวันก่อนใคร" หรือ "กดติดตามเพื่อไม่พลาดข่าวที่สำคัญที่สุดของวัน"
- ต่อเนื่อง (story-continuation): "อยากรู้ว่าเรื่องนี้จะพัฒนาไปอย่างไร ติดตามเราไว้"
- FOMO: "ข่าวพรุ่งนี้มาแน่ กดติดตามเลย"
ห้ามใช้:
❌ "อย่าลืมกดไลค์ กดแชร์ กดติดตาม"
❌ "ถ้าชอบคลิปนี้..."
`,
    wordCountBlock: `สำคัญ: แต่ละฉากต้องมี 25-45 คำ ประโยคไม่เกิน 20 คำต่อประโยค ใส่รายละเอียดเฉพาะเจาะจง: ชื่อ ตัวเลข สถานที่ เวลา ข้อเท็จจริงจากแหล่งข่าว
ใช้ประโยคสั้นสลับกับประโยคยาวเพื่อสร้างจังหวะ
ความยาวเสียงรวม 28–35 วินาที (TTS ความเร็วปกติ)`,
    ttsBlock: `
ข้อควรระวังสำหรับ TTS:
- ใช้เลขอารบิก (1, 2, 3) ไม่ใช่เลขไทย (๑, ๒, ๓)
- เปอร์เซ็นต์: เขียน "18 เปอร์เซ็นต์" ไม่ใช่ "18%" — TTS มักข้ามสัญลักษณ์ %
- สกุลเงิน: เขียน "200 บาท" ไม่ใช่ "฿200" — TTS ไม่ออกเสียงสัญลักษณ์บาท
- อย่าจบประโยคด้วย "..." (ellipsis) — TTS ออกเสียงจุดสามจุดแปลกๆ ใช้จุดเดียวหรือไม่ใส่เครื่องหมาย
`,
    ctaSignals: [
      /ติดตาม/,
      /กดติดตาม/,
      /ต่อไป/,
      /พรุ่งนี้/,
      /ไม่พลาด/,
      /อย่าพลาด/,
      /เพื่อรับข่าว/,
      /เพื่อไม่พลาด/,
    ],
    ctaAppends: [
      " กดติดตามเพื่อไม่พลาดข่าวสำคัญ",
      " ติดตามเราเพื่อรับข่าวอัปเดตทุกวัน",
      " ติดตามเพื่อดูว่าเรื่องนี้จะจบอย่างไร",
    ],
  },

  en: {
    langLabel: "English",
    languageLine: "LANGUAGE: Write entirely in English.",
    hooksBlock: "",
    ctaBlock: `CTA (Call-to-Action): End the FINAL scene with a clear follow call-to-action:
- Value-specific: "Follow WorldBrief for daily updates" or "Hit follow so you don't miss tomorrow's story."
- Story-continuation: "Follow to see how this develops"
- FOMO: "Follow now — tomorrow's story is even bigger"
Avoid:
❌ "Like, share, and subscribe"
❌ "If you enjoyed this video..."
Weave it naturally into the scene — do not make it sound like an ad.`,
    wordCountBlock: `CRITICAL: Each scene voiceover must be 20-35 words. Aim for at least 25 words per scene to ensure enough detail. Count carefully — going over 35 words makes the reel too long. Pack each scene with concrete details: names, numbers, locations, times, and specific facts from the source.`,
    ttsBlock: "",
    ctaSignals: [
      /\bfollow\b/i,
      /\bstay tuned\b/i,
      /\bsubscribe\b/i,
      /\bdon't miss\b/i,
      /\bwon't want to miss\b/i,
      /\bhit follow\b/i,
      /\bkeep watching\b/i,
      /\bsee how this\b/i,
      /\bfor more\b/i,
      /\bfor updates\b/i,
      /\bfor daily\b/i,
      /\btomorrow'?s\b/i,
      /\bnext time\b/i,
    ],
    ctaAppends: [
      " Follow for updates.",
      " Follow so you don't miss what happens next.",
      " Hit follow for daily updates.",
      " Stay tuned — this story is far from over.",
    ],
  },

  de: {
    langLabel: "German",
    languageLine: "SPRACHE: Schreibe vollständig auf Deutsch. Keine englischen Wörter im Skript, außer Eigennamen ohne deutsche Übersetzung (z. B. NASA, WHO, EU).",
    hooksBlock: `
Engagement-Hooks, die funktionieren:
- "Wusstest du, dass..."
- "Was viele nicht wissen..."
- "Gerade erst passiert..."
- "Klingt verrückt, aber..."
Keine Klickköder, keine reißerischen Phrasen:
❌ "Du wirst nicht glauben, was..."
❌ "Schockierend!"
❌ "Das ist die Geschichte, die..."
❌ "Alle reden über..."
`,
    ctaBlock: `CTA (Call-to-Action): Beende die LETZTE Szene mit einem klaren Follow-CTA:
- Wertbezogen: "Folge TagesBrief für die wichtigsten Nachrichten jeden Tag" oder "Folge uns, um die Geschichte des Tages nicht zu verpassen."
- Fortsetzung: "Folge uns, um zu sehen, wie sich das entwickelt."
- FOMO: "Jetzt folgen — die Geschichte von morgen wird noch größer."
Vermeide:
❌ "Liken, teilen und abonnieren"
❌ "Wenn dir dieses Video gefallen hat..."
Baue es natürlich in die Szene ein — es darf nicht wie Werbung klingen.`,
    wordCountBlock: `WICHTIG: Jede Szene muss 20-35 Wörter haben. Strebe mindestens 25 Wörter pro Szene an, damit genug Details enthalten sind. Zähle sorgfältig — über 35 Wörter wird das Reel zu lang. Packe konkrete Details in jede Szene: Namen, Zahlen, Orte, Zeiten und Fakten aus der Quelle.`,
    ttsBlock: `
TTS-Hinweise:
- Verwende arabische Ziffern (1, 2, 3), nicht ausgeschriebene Zahlen.
- Prozent: Schreibe "18 Prozent", nicht "18 %" — TTS überspringt oft das %-Symbol.
- Währung: Schreibe "200 Euro", nicht "200 €" — TTS spricht das €-Symbol nicht zuverlässig.
- Keine Auslassungspunkte ("...") am Satzende — TTS spricht drei Punkte seltsam aus. Verwende einen einzelnen Punkt oder kein Zeichen.
`,
    ctaSignals: [
      /\bfolge\b/i,
      /\bfolgenden?\b/i,
      /\babonniere\b/i,
      /\bnicht verpassen\b/i,
      /\bverpasst nicht\b/i,
      /\bmorgen\b/i,
      /\bupdates\b/i,
      /\btages\b/i,
    ],
    ctaAppends: [
      " Folge TagesBrief für tägliche Updates.",
      " Folge uns, um nicht zu verpassen, was als Nächstes passiert.",
      " Jetzt folgen für die wichtigsten Nachrichten jeden Tag.",
      " Bleib dran — diese Geschichte ist noch nicht zu Ende.",
    ],
  },
};
```

**Note on Thai `wordCountBlock`:** the original used a template literal interpolating `${sceneCount}`. Because the i18n table is static, the scene-count mention was removed from this string (the scene count is already stated in the main prompt template: `Total video should feel complete in ${sceneCount} scenes`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/i18n/reel-strings.test.ts`
Expected: PASS (all 30+ assertions)

- [ ] **Step 5: Verify build still compiles**

Run: `npm run build`
Expected: PASS (the new module is not yet imported anywhere)

- [ ] **Step 6: Commit**

```bash
git add src/i18n/reel-strings.ts tests/i18n/reel-strings.test.ts
git commit -m "2026-07-13-i18n-reel-strings-table"
```

---

## Task 2: Create ui-strings i18n table

**Files:**
- Create: `src/i18n/ui-strings.ts`
- Test: `tests/i18n/ui-strings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/i18n/ui-strings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { UI_STRINGS, type UiLang } from "../../src/i18n/ui-strings.js";

describe("UI_STRINGS", () => {
  (["th", "en", "de"] as UiLang[]).forEach((lang) => {
    describe(`${lang}`, () => {
      it("has all status labels", () => {
        const statuses = ["awaiting_approval", "approved", "published", "rejected", "failed", "running"];
        statuses.forEach((s) => {
          expect(UI_STRINGS[lang].statusLabels[s as keyof typeof UI_STRINGS[typeof lang].statusLabels]).toBeDefined();
        });
      });

      it("has stageLogsLabel", () => {
        expect(UI_STRINGS[lang].stageLogsLabel.length).toBeGreaterThan(0);
      });

      it("has category label", () => {
        expect(UI_STRINGS[lang].category.length).toBeGreaterThan(0);
      });
    });
  });

  it("Thai stageLogsLabel is preserved verbatim (ds regression guard)", () => {
    expect(UI_STRINGS.th.stageLogsLabel).toBe("บันทึกขั้นตอน");
  });

  it("English category label is 'Category' (ns regression guard)", () => {
    expect(UI_STRINGS.en.category).toBe("Category");
  });

  it("German category label is 'Kategorie'", () => {
    expect(UI_STRINGS.de.category).toBe("Kategorie");
  });

  it("German statusLabels.awaiting_approval is uppercase German", () => {
    expect(UI_STRINGS.de.statusLabels.awaiting_approval).toBe("AUF FREIGABE WARTEND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n/ui-strings.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create the i18n module**

Create `src/i18n/ui-strings.ts`. Thai values are moved verbatim from `src/review/utils.ts` lines 38-97 and `src/review/reel-html-builder.ts` isThai branches. English values from the fallback branches. German values newly written.

```typescript
export type UiLang = "th" | "en" | "de";

export type RunStatus = "running" | "awaiting_approval" | "approved" | "published" | "rejected" | "failed";

export interface UiStringSet {
  statusLabels: Record<RunStatus, string>;
  statusFooterText: Record<RunStatus, string>;
  stageLogsLabel: string;
  reelReviewLink: string;
  latestReel: string;
  statusHeading: string;
  category: string;
  voice: string;
  voiceSpeed: string;
  scenes: string;
  musicVolume: string;
  music: string;
  noneLabel: string;
  language: string;
  cameraEffect: string;
  hookCaption: string;
  voiceover: string;
  subtitleBlocks: string;
  scene: string;
  noTimings: string;
  postCaption: string;
  willPostAsFirstComment: string;
  discoveryBias: string;
  selectionReason: string;
  topicsAvoided: string;
  categoryDiscovery: string;
  reelScript: string;
  apiSources: string;
  apiSourceCaptions: string;
  apiSourceImages: string;
  sourceProvenanceHeading: string;
  helpCommandBody: string;
}

export const UI_STRINGS: Record<UiLang, UiStringSet> = {
  th: {
    statusLabels: {
      awaiting_approval: "รอการอนุมัติ",
      approved:          "อนุมัติแล้ว",
      published:         "เผยแพร่แล้ว",
      rejected:          "ปฏิเสธแล้ว",
      failed:            "ล้มเหลว",
      running:           "กำลังทำงาน",
    },
    statusFooterText: {
      awaiting_approval: "⏳ รอการอนุมัติ — ตอบกลับใน Telegram เพื่ออนุมัติ แก้ไข หรือปฏิเสธ",
      approved:          "✅ อนุมัติแล้ว — รอการเผยแพร่",
      published:         "🚀 เผยแพร่แล้ว",
      rejected:          "🚫 ปฏิเสธแล้ว",
      failed:            "❌ เกิดข้อผิดพลาด",
      running:           "⏳ กำลังดำเนินการ...",
    },
    stageLogsLabel: "บันทึกขั้นตอน",
    reelReviewLink: "ดูรีวิว",
    latestReel: "Reel ล่าสุด",
    statusHeading: "สถานะ",
    category: "หมวดหมู่",
    voice: "เสียง",
    voiceSpeed: "ความเร็วเสียง",
    scenes: "จำนวนฉาก",
    musicVolume: "ระดับเพลง",
    music: "เพลง",
    noneLabel: "ไม่มี",
    language: "ภาษา",
    cameraEffect: "เอฟเฟกต์กล้อง",
    hookCaption: "Hook caption",
    voiceover: "เสียงบรรยาย",
    subtitleBlocks: "บล็อก subtitle",
    scene: "ฉาก",
    noTimings: "ไม่มีข้อมูล word timing",
    postCaption: "คำบรรยายโพสต์",
    willPostAsFirstComment: "จะโพสต์เป็นคอมเมนต์แรก",
    discoveryBias: "Discovery bias",
    selectionReason: "เหตุผลที่เลือก",
    topicsAvoided: "หัวข้อที่หลีกเลี่ยง",
    categoryDiscovery: "Category Discovery",
    reelScript: "สคริปต์รีล",
    apiSources: "แหล่ง API",
    apiSourceCaptions: "คำบรรยาย",
    apiSourceImages: "รูปภาพ",
    sourceProvenanceHeading: "ข้อมูลแหล่งที่มา",
    helpCommandBody: `📋 <b>คำสั่งทั้งหมด — __BRAND_NAME__</b>

<b>Status</b>
• !status — ดูสถานะทั้งหมด

<b>Reels</b>
• !reel [-stock] — สร้าง reel (auto discovery + auto category)
• !reel &lt;url&gt; [-stock] — สร้าง reel จาก URL
• !reel &lt;category&gt; [-stock] — สร้าง reel ด้วย category: breaking, trending, human_interest, business, open
• !reel list — ดู reel ล่าสุด 5 รายการ
• !reel approve [HH:MM] [tmr] — อนุมัติและเผยแพร่/ตั้งเวลา
• !reel cancel — ยกเลิก reel ที่กำลังทำงาน
• !reel reject [id] — ยกเลิก reel
• !reel status — ดูสถานะ reel ล่าสุด + ลิงก์รีวิว
• !reel confirm &lt;id&gt; — ยืนยัน headline
• !reel resume &lt;id&gt; — ต่อจาก stage ที่ค้างอยู่
• !reel rebuild [id] — สร้างเสียง+รูป+วิดีโอใหม่
• !reel rescript [id] — สร้าง script ใหม่

<b>Batch</b>
• !batch N — เตรียม N reels แบบข้ามคืน
• !batch status — ดูสถานะ batch runs
`,
  },

  en: {
    statusLabels: {
      awaiting_approval: "AWAITING APPROVAL",
      approved:          "APPROVED",
      published:         "PUBLISHED",
      rejected:          "REJECTED",
      failed:            "FAILED",
      running:           "RUNNING",
    },
    statusFooterText: {
      awaiting_approval: "⏳ Awaiting approval — reply in Telegram to approve, edit, or reject",
      approved:          "✅ Approved — scheduled for publishing",
      published:         "🚀 Published",
      rejected:          "🚫 Rejected",
      failed:            "❌ Pipeline failed",
      running:           "⏳ Running...",
    },
    stageLogsLabel: "Stage Logs",
    reelReviewLink: "Review page",
    latestReel: "Latest reel",
    statusHeading: "Status",
    category: "Category",
    voice: "Voice",
    voiceSpeed: "Voice speed",
    scenes: "Scenes",
    musicVolume: "Music volume",
    music: "Music",
    noneLabel: "None",
    language: "Language",
    cameraEffect: "Camera effect",
    hookCaption: "Hook caption",
    voiceover: "Voiceover",
    subtitleBlocks: "Subtitle blocks",
    scene: "Scene",
    noTimings: "No word timings",
    postCaption: "Post Caption",
    willPostAsFirstComment: "Will post as first comment",
    discoveryBias: "Discovery bias",
    selectionReason: "Selection reason",
    topicsAvoided: "Topics avoided",
    categoryDiscovery: "Category Discovery",
    reelScript: "Reel Script",
    apiSources: "API Sources",
    apiSourceCaptions: "Captions",
    apiSourceImages: "Images",
    sourceProvenanceHeading: "Source provenance",
    helpCommandBody: `📋 <b>Commands — __BRAND_NAME__</b>

<b>Status</b>
• !status — show combined status

<b>Reels</b>
• !reel [-stock] — generate reel (auto discovery + auto category)
• !reel &lt;url&gt; [-stock] — generate reel from URL
• !reel &lt;category&gt; [-stock] — generate reel with category: breaking, trending, human_interest, business, open
• !reel list — show last 5 reels
• !reel approve [HH:MM] [tmr] — approve & publish/schedule
• !reel cancel — cancel the currently running reel
• !reel reject [id] — reject reel
• !reel status — show latest reel status + review link
• !reel confirm &lt;id&gt; — confirm headline and continue
• !reel resume &lt;id&gt; — resume from last completed stage
• !reel rebuild [id] — force re-run voice + images + video
• !reel rescript [id] — regenerate script + video

<b>Batch</b>
• !batch N — prep N reels overnight
• !batch status — show batch run history
`,
  },

  de: {
    statusLabels: {
      awaiting_approval: "AUF FREIGABE WARTEND",
      approved:          "GENEHMIGT",
      published:         "VERÖFFENTLICHT",
      rejected:          "ABGELEHNT",
      failed:            "FEHLGESCHLAGEN",
      running:           "LÄUFT",
    },
    statusFooterText: {
      awaiting_approval: "⏳ Wartet auf Freigabe — antworte in Telegram zum Genehmigen, Bearbeiten oder Ablehnen",
      approved:          "✅ Genehmigt — zur Veröffentlichung eingeplant",
      published:         "🚀 Veröffentlicht",
      rejected:          "🚫 Abgelehnt",
      failed:            "❌ Pipeline fehlgeschlagen",
      running:           "⏳ Läuft...",
    },
    stageLogsLabel: "Ablaufprotokoll",
    reelReviewLink: "Review-Seite",
    latestReel: "Neuestes Reel",
    statusHeading: "Status",
    category: "Kategorie",
    voice: "Stimme",
    voiceSpeed: "Sprechgeschwindigkeit",
    scenes: "Szenen",
    musicVolume: "Musiklautstärke",
    music: "Musik",
    noneLabel: "Keine",
    language: "Sprache",
    cameraEffect: "Kameraeffekt",
    hookCaption: "Hook-Beschriftung",
    voiceover: "Voiceover",
    subtitleBlocks: "Untertitel-Blöcke",
    scene: "Szene",
    noTimings: "Keine Word-Timings",
    postCaption: "Beitragsbeschriftung",
    willPostAsFirstComment: "Wird als erster Kommentar gepostet",
    discoveryBias: "Discovery-Bias",
    selectionReason: "Auswahlgrund",
    topicsAvoided: "Vermiedene Themen",
    categoryDiscovery: "Kategorie-Discovery",
    reelScript: "Reel-Skript",
    apiSources: "API-Quellen",
    apiSourceCaptions: "Beschriftungen",
    apiSourceImages: "Bilder",
    sourceProvenanceHeading: "Quellen-Nachweis",
    helpCommandBody: `📋 <b>Befehle — __BRAND_NAME__</b>

<b>Status</b>
• !status — kombinierten Status anzeigen

<b>Reels</b>
• !reel [-stock] — Reel generieren (auto discovery + auto category)
• !reel &lt;url&gt; [-stock] — Reel aus URL generieren
• !reel &lt;category&gt; [-stock] — Reel mit Kategorie: breaking, trending, human_interest, business, open
• !reel list — letzte 5 Reels anzeigen
• !reel approve [HH:MM] [tmr] — genehmigen & veröffentlichen/einplanen
• !reel cancel — laufendes Reel abbrechen
• !reel reject [id] — Reel ablehnen
• !reel status — neuesten Reel-Status + Review-Link anzeigen
• !reel confirm &lt;id&gt; — Schlagzeile bestätigen und fortfahren
• !reel resume &lt;id&gt; — ab letzter abgeschlossener Stage fortsetzen
• !reel rebuild [id] — Voice + Bilder + Video neu generieren
• !reel rescript [id] — Skript + Video neu generieren

<b>Batch</b>
• !batch N — N Reels über Nacht vorbereiten
• !batch status — Batch-Lauf-Historie anzeigen
`,
  },
};

export function getUiStrings(lang: UiLang): UiStringSet {
  const s = UI_STRINGS[lang];
  if (!s) throw new Error(`Unknown UI language: ${lang}`);
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/i18n/ui-strings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/i18n/ui-strings.ts tests/i18n/ui-strings.test.ts
git commit -m "2026-07-13-i18n-ui-strings-table"
```

---

## Task 3: Refactor reel-stage2-script.ts to consume REEL_STRINGS

**Files:**
- Modify: `src/stages/reel-stage2-script.ts` (lines 157-310)

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `npm test`
Expected: PASS (baseline before refactor)

- [ ] **Step 2: Refactor `buildSystemPrompt` (L157-254)**

In `src/stages/reel-stage2-script.ts`, replace the inline `isThai` ternaries with a lookup. Import at top of file:

```typescript
import { REEL_STRINGS, type ReelLang } from "../i18n/reel-strings.js";
```

Replace the body of `buildSystemPrompt` (the section from `const isThai = ctx.brand.language === "th";` through the closing of the template literal at L253) with:

```typescript
export function buildSystemPrompt(ctx: {
  brand: { language: string };
  category?: ReelCategory;
  sceneCount: number;
}): string {
  const lang = (ctx.brand.language as ReelLang) in REEL_STRINGS
    ? (ctx.brand.language as ReelLang)
    : "en";
  const S = REEL_STRINGS[lang];
  const langLabel = S.langLabel;
  const sceneCount = ctx.sceneCount;

  return `You are a social media video scriptwriter. You write short, engaging ${langLabel} scripts for vertical video reels (Instagram/Facebook/TikTok style).

${S.languageLine}

GENERAL RULES:
- Captions are short punchy text (max 8 words) shown on screen
- Image prompts should be vivid, photorealistic, vertical 9:16 portrait composition
- Hook scene 1 immediately — first 3 seconds decide whether people keep watching
${S.hooksBlock}
- ${S.ctaBlock}
- Total video should feel complete in ${sceneCount} scenes (~45-60 seconds)
- ${S.wordCountBlock}
- CRITICAL: Do NOT use honorary titles, royal titles, or formal positions unless you are certain they are current. Source articles often use outdated titles. NEVER use "Prince Andrew" or "the Duke of York" — he is no longer a working royal; just say "Andrew" and identify him by context (e.g. "Andrew, who lives at Royal Lodge"). Apply this principle to all public figures: when in doubt, drop the title and use the name only.
- CRITICAL: Do NOT state a specific calendar date (e.g. "on July 10th") for when an event happened unless the source material explicitly narrates that as the event date. A date attached to a photo caption or byline is not necessarily the event date. If it's unclear or the story is still developing, use relative time framing ("overnight", "this week", "in the past 24 hours") instead of asserting a specific date.
- CRITICAL: You are writing values inside a JSON string. If a voiceover or caption needs to quote a nickname, alias, or short phrase, use curly quotes "..." — never a straight double-quote ("...") — since a straight quote inside a JSON string breaks the JSON. Do not use the " character anywhere inside a voiceover, caption, or title value.

${buildCategoryPrompt(ctx.category, langLabel)}
${S.ttsBlock}
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

For hashtags: generate 4-5 relevant tags. Mix specific (e.g. #SpainAirspace) and broad (e.g. #BreakingNews). Write in ${langLabel}.`;
}
```

- [ ] **Step 3: Refactor `ensureCTA` (L296-310) and remove the four now-unused const arrays**

Delete these four const declarations (L256-294): `CTA_SIGNALS_EN`, `CTA_SIGNALS_TH`, `CTA_APPENDS_EN`, `CTA_APPENDS_TH`.

Replace `ensureCTA` with:

```typescript
function ensureCTA(script: ReelScript, language: string): void {
  if (!script.scenes.length) return;
  const lastScene = script.scenes[script.scenes.length - 1];
  const voiceover = lastScene.voiceover;
  const lang = (language as ReelLang) in REEL_STRINGS ? (language as ReelLang) : "en";
  const S = REEL_STRINGS[lang];

  const hasCTA = S.ctaSignals.some((re) => re.test(voiceover));
  if (hasCTA) return;

  const append = S.ctaAppends[Math.floor(Math.random() * S.ctaAppends.length)];
  lastScene.voiceover = voiceover.replace(/\.?\s*$/, append);
  console.log(`  [CTA fix] Appended missing CTA to scene ${lastScene.sceneNumber}`);
}
```

- [ ] **Step 4: Remove `THAI_CATEGORY_RULES` import if now unused**

Search the file for any remaining references to the deleted const arrays. If none, the refactor is complete.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS (no behaviour change — Thai and English strings are identical, just relocated)

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/stages/reel-stage2-script.ts
git commit -m "2026-07-13-refactor-reel-stage2-to-i18n-table"
```

---

## Task 4: Refactor review/utils.ts to consume UI_STRINGS

**Files:**
- Modify: `src/review/utils.ts` (entire file)

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Update imports and logo loading**

At the top of `src/review/utils.ts`, add the import and logo constant:

```typescript
import { UI_STRINGS, getUiStrings, type UiLang, type RunStatus as UiRunStatus } from "../i18n/ui-strings.js";
```

Replace L12-13 (the two logo consts) with three:

```typescript
const NS_LOGO_B64 = loadLogoBase64("worldbrief_logo.png");
const DS_LOGO_B64 = loadLogoBase64("thaidaily_logo.png");
const TS_LOGO_B64 = loadLogoBase64("tagesbrief_logo.png");

const LOGOS: Record<string, string> = {
  ds: DS_LOGO_B64,
  ns: NS_LOGO_B64,
  ts: TS_LOGO_B64,
};
```

- [ ] **Step 3: Update `brandLogoHtml` (L15-19)**

Replace the function body:

```typescript
export function brandLogoHtml(brandId: string, cls = "brand-logo"): string {
  const b64 = LOGOS[brandId] ?? "";
  if (!b64) return "";
  return `<img src="data:image/png;base64,${b64}" class="${cls}" alt="">`;
}
```

- [ ] **Step 4: Update `brandThemeCss` (L21-26)**

Add a `ts` branch with a distinct green accent:

```typescript
export function brandThemeCss(brandId: string): string {
  if (brandId === "ns") {
    return `:root{--c-accent:#B21526;--c-accent-bright:#D42030;--c-accent-dim:#2A0609;--c-accent-text:#E87880;--c-accent2:#E8A020;--c-bar:#7A1020;--c-bg:#080B12;--c-card:#111420;--c-inner:#0C0F18;--c-border:#1C2030;}`;
  }
  if (brandId === "ts") {
    return `:root{--c-accent:#0E7C3A;--c-accent-bright:#16A34A;--c-accent-dim:#042814;--c-accent-text:#7ADBA0;--c-accent2:#E8A020;--c-bar:#0A5A2A;--c-bg:#080B12;--c-card:#111420;--c-inner:#0C0F18;--c-border:#1C2030;}`;
  }
  // ds (default)
  return `:root{--c-accent:#1550C4;--c-accent-bright:#2060D4;--c-accent-dim:#091440;--c-accent-text:#7AABD8;--c-accent2:#FF5A00;--c-bar:#1040A0;--c-bg:#080B12;--c-card:#111420;--c-inner:#0C0F18;--c-border:#1C2030;}`;
}
```

- [ ] **Step 5: Update `statusBadgeHtml`, `statusFooterText`, `stageLogsHtml`**

Change their signatures from `isThai: boolean` to `language: UiLang`. Replace the bodies to read from `UI_STRINGS[language]`:

```typescript
export function statusBadgeHtml(status: RunStatus | string, language: UiLang): string {
  const bgMap: Record<string, { bg: string; color: string }> = {
    awaiting_approval: { bg: "#e53935", color: "#fff" },
    approved:          { bg: "#2e7d32", color: "#fff" },
    published:         { bg: "#1565c0", color: "#fff" },
    rejected:          { bg: "#555",    color: "#fff" },
    failed:            { bg: "#b71c1c", color: "#fff" },
    running:           { bg: "#f57c00", color: "#fff" },
  };
  const S = getUiStrings(language);
  const label = S.statusLabels[status as UiRunStatus] ?? status.toUpperCase();
  const { bg, color } = bgMap[status] ?? { bg: "#888", color: "#fff" };
  return `<span class="status-badge" style="background:${bg};color:${color}">${label}</span>`;
}

export function statusFooterText(status: RunStatus | string, language: UiLang): string {
  const S = getUiStrings(language);
  return S.statusFooterText[status as UiRunStatus] ?? S.statusFooterText.running;
}

export function stageLogsHtml(stageLogs: StageLog[], language: UiLang): string {
  if (!stageLogs?.length) return "";
  const S = getUiStrings(language);
  const rows = stageLogs.map((s) => {
    const icon  = s.status === "ok" ? "✅" : s.status === "error" ? "❌" : "⏭️";
    const dur   = s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(1)}s` : `${s.durationMs}ms`;
    const error = s.error ? `<div class="stage-error">${escapeHtml(s.error.slice(0, 200))}</div>` : "";
    return `<div class="stage-row">
      <span class="stage-icon">${icon}</span>
      <span class="stage-name">${escapeHtml(s.stage)}</span>
      <span class="stage-dur">${dur}</span>
      ${error}
    </div>`;
  }).join("");
  return `<details class="stage-logs-details">
  <summary>${S.stageLogsLabel}</summary>
  <div class="stage-logs-body">${rows}</div>
</details>`;
}
```

Keep the local `StageLog` interface and `escapeHtml` unchanged. Note: the old `statusBadgeHtml` used separate `label`/`labelTh` fields; the new version reads from `UI_STRINGS[language].statusLabels`.

- [ ] **Step 6: Find and update all call sites**

Run: `grep -rn "statusBadgeHtml\|statusFooterText\|stageLogsHtml" src/`

Each call site that passes `isThai` must now pass `brand.language` (or `ctx.brand.language`) instead. The signature change from `boolean` to `UiLang` will surface every call site as a TypeScript compile error — fix each one.

- [ ] **Step 7: Run build to find call sites**

Run: `npm run build`
Expected: Compile errors at every call site. Fix each by replacing the `isThai` argument with the brand's `language` value.

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/review/utils.ts
git commit -m "2026-07-13-refactor-review-utils-to-i18n"
```

---

## Task 5: Refactor reel-html-builder.ts and command-listener.ts to consume UI_STRINGS

**Files:**
- Modify: `src/review/reel-html-builder.ts`
- Modify: `src/pipeline/command-listener.ts` (lines 941-1132)

- [ ] **Step 1: Refactor `reel-html-builder.ts`**

In `src/review/reel-html-builder.ts`, replace the `const isThai = ctx.brand.language === "th";` pattern with a UI strings lookup:

```typescript
import { getUiStrings, type UiLang } from "../i18n/ui-strings.js";
```

At the top of `buildReelReviewHtml`:

```typescript
const language = ctx.brand.language as UiLang;
const S = getUiStrings(language);
```

Then replace every `isThai ? "Thai text" : "English text"` with the corresponding `S.<field>`. The mapping is direct — each ternary's Thai branch corresponds to a field name in `UiStringSet`. Examples:

- L9-11 `title = isThai ? ... : ...` → `title = \`${ctx.brand.name} ${S.reelScript} — ${ctx.runDate}\`` (simplified; preserve exact Thai title format by reading from `S`)
- L82 `effectLabel` — not language-dependent, keep as-is
- L143 `hookLabel = isThai ? "Hook caption" : "Hook caption"` → `S.hookCaption`
- L144 `voLabel = isThai ? "เสียงบรรยาย" : "Voiceover"` → `S.voiceover`
- L145 `blockLabel = isThai ? "บล็อก subtitle" : "Subtitle blocks"` → `S.subtitleBlocks`
- L150 `isThai ? "ฉาก" : "Scene"` → `S.scene`
- L163 `syncExplainer` — read from lookup or keep inline (it's a longer string; if not in ui-strings, add it)
- L181 `lang="${isThai ? "th" : "en"}"` → `lang="${language}"`
- L322 `statusBadgeHtml(ctx.status, isThai)` → `statusBadgeHtml(ctx.status, language)`
- L344-355 all `isThai ? "X" : "Y"` → corresponding `S.field`
- L364 `isThai ? "คำบรรยายโพสต์" : "Post Caption"` → `S.postCaption`
- L367 `isThai ? "จะโพสต์เป็นคอมเมนต์แรก" : "Will post as first comment"` → `S.willPostAsFirstComment`
- L372 `buildCategoryDiscoveryPanel(..., isThai, ...)` → pass `language`
- L382 `... isThai)` → `... language)`
- L385 `buildApiSourcePanel(ctx.apiSourceMap, isThai)` → `buildApiSourcePanel(ctx.apiSourceMap, language)`
- L389 `stageLogsHtml(ctx.stageLogs ?? [], isThai)` → `stageLogsHtml(ctx.stageLogs ?? [], language)`
- L394 `isThai ? "สคริปต์รีล" : "Reel Script"` → `S.reelScript`
- L402 `statusFooterText(ctx.status, isThai)` → `statusFooterText(ctx.status, language)`

Also update child helper signatures in the same file (L414, L495) from `isThai: boolean` to `language: UiLang` and read from `getUiStrings(language)` internally.

- [ ] **Step 2: Refactor `command-listener.ts` `!help` and `!status` (L941, L1034, L1124-1129)**

Add import at top:

```typescript
import { getUiStrings, type UiLang } from "../i18n/ui-strings.js";
```

At L941 replace `const isThai = brand.language === "th";` with:

```typescript
const language = brand.language as UiLang;
const S = getUiStrings(language);
```

Replace the `!help` body (L1034-1112). The whole `const msg = isThai ? ... : ...` block becomes:

```typescript
const helpBody = S.helpCommandBody.replace("__BRAND_NAME__", escapeHtml(brand.name));
await telegram.sendMessage(chatId, helpBody);
```

Remove the long inline Thai/English help strings — they're now in `UI_STRINGS`.

Replace `!status` block (L1124-1129):

```typescript
const reelReviewLine = latestReel.reviewUrl && latestReel.status === "awaiting_approval"
  ? `\n📄 <a href="${latestReel.reviewUrl}">${S.reelReviewLink}</a>`
  : "";
reelBlock = `\n\n🎬 ${S.latestReel} · <code>${latestReel.id.slice(0, 8)}</code>\n${reelStatusEmoji[latestReel.status] ?? "❓"} ${latestReel.status} — ${latestReel.headline.slice(0, 60)}${reelReviewLine}`;

const msg = `📊 <b>${S.statusHeading} — ${brand.name}</b>${reelBlock}`;
```

For the remaining `isThai ? ... : ...` patterns in the `!voice` command section (L1482-1540), apply the same pattern: build the message from `S.<field>` lookups. Add new fields to `UiStringSet` and `UI_STRINGS` if a needed string isn't already there (e.g. `voiceSearchFailed`, `voiceSaved`, `voiceCleared`). Search the file for `isThai` to find every remaining instance.

- [ ] **Step 3: Search for any remaining `isThai` references**

Run: `grep -n "isThai" src/pipeline/command-listener.ts src/review/reel-html-builder.ts`
Expected: zero matches (all converted to `language` lookup)

- [ ] **Step 4: Run build to find any missed call sites**

Run: `npm run build`
Expected: PASS (or compile errors pointing to missed call sites — fix them)

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/review/reel-html-builder.ts src/pipeline/command-listener.ts src/i18n/ui-strings.ts
git commit -m "2026-07-13-refactor-html-and-telegram-to-i18n"
```

---

## Task 6: Update discovery, stage0, and voice language code

**Files:**
- Modify: `src/stages/stage1-discover.ts` (L219, L232-233, L419, L433-436)
- Modify: `src/stages/stage0-from-url.ts` (L109)
- Modify: `src/stages/reel-stage3-voice.ts` (L271)

- [ ] **Step 1: Update stage1-discover.ts language label**

Add import at top:

```typescript
import { REEL_STRINGS, type ReelLang } from "../i18n/reel-strings.js";
```

At L219 and L419, replace `${brand.language === "th" ? "Thai" : "English"}` with `${REEL_STRINGS[(brand.language as ReelLang) ?? "en"].langLabel}`. (Use the safe lookup: `REEL_STRINGS[brand.language as ReelLang]?.langLabel ?? "English"`.)

- [ ] **Step 2: Add the `ts` geographic rule**

At L232-233 and L433-436, add a new conditional for the `ts` brand. The block becomes:

```typescript
${brand.id === "ds" ? "- Stories MUST be relevant to Thailand or Thai people" : ""}
${brand.id === "ns" ? "- Strongly prefer European stories; only fall back to global if no strong European story exists" : ""}
${brand.id === "ts" ? "- Prioritize German-language stories with direct relevance to DACH (Germany, Austria, Switzerland); fall back to broader European stories only if no strong DACH story exists" : ""}
```

- [ ] **Step 3: Update stage0-from-url.ts (L109)**

Add import:

```typescript
import { REEL_STRINGS, type ReelLang } from "../i18n/reel-strings.js";
```

Replace `ctx.brand.language === "th" ? "Thai" : "English"` with `REEL_STRINGS[ctx.brand.language as ReelLang]?.langLabel ?? "English"`.

- [ ] **Step 4: Update reel-stage3-voice.ts language code (L271)**

Replace `const languageCode = ctx.brand.language === "th" ? "th" : "en";` with:

```typescript
const LANGUAGE_CODE_MAP: Record<string, string> = { th: "th", de: "de", en: "en" };
const languageCode = LANGUAGE_CODE_MAP[ctx.brand.language] ?? "en";
```

- [ ] **Step 5: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/stages/stage1-discover.ts src/stages/stage0-from-url.ts src/stages/reel-stage3-voice.ts
git commit -m "2026-07-13-refactor-discovery-and-voice-to-i18n"
```

---

## Task 7: Create the `ts` brand config

**Files:**
- Create: `src/brands/ts.ts`
- Test: `tests/brands/ts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/brands/ts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ts } from "../../src/brands/ts.js";

describe("ts brand config", () => {
  it("has id 'ts'", () => {
    expect(ts.id).toBe("ts");
  });

  it("has name 'TagesBrief'", () => {
    expect(ts.name).toBe("TagesBrief");
  });

  it("has language 'de'", () => {
    expect(ts.language).toBe("de");
  });

  it("has Europe/Berlin timezone", () => {
    expect(ts.timezone).toBe("Europe/Berlin");
  });

  it("has DACH geographic focus", () => {
    expect(ts.geographicFocus).toContain("DACH");
    expect(ts.geographicFocus).toContain("German");
  });

  it("has German trending config", () => {
    expect(ts.trendingConfig?.googleNewsLang).toBe("de");
    expect(ts.trendingConfig?.youtubeRegionCode).toBe("DE");
  });

  it("has trusted German sources", () => {
    expect(ts.trustedSources.length).toBeGreaterThan(10);
    expect(ts.trustedSources).toContain("spiegel.de");
    expect(ts.trustedSources).toContain("tagesschau.de");
  });

  it("has reels enabled with 4 scenes", () => {
    expect(ts.reels?.enabled).toBe(true);
    expect(ts.reels?.sceneCount).toBe(4);
  });

  it("has telegram enabled, line disabled", () => {
    expect(ts.channels?.telegram?.enabled).toBe(true);
    expect(ts.channels?.line?.enabled).toBe(false);
  });

  it("has instagram disabled", () => {
    expect(ts.instagramEnabled).toBe(false);
  });

  it("has weekday and weekend reel schedules", () => {
    expect(ts.reels?.reelTimes?.length).toBeGreaterThan(0);
    expect(ts.reels?.reelTimesWeekend?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/brands/ts.test.ts`
Expected: FAIL with "Cannot find module '../../src/brands/ts.js'"

- [ ] **Step 3: Create the brand config**

Create `src/brands/ts.ts`:

```typescript
import type { BrandConfig } from "../types.js";
import type { VoiceEntry } from "../services/voice-provider.js";

export const ts: BrandConfig = {
  id: "ts",
  name: "TagesBrief",
  language: "de",
  timezone: "Europe/Berlin",
  postTimes: ["08:00", "20:00"],
  weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: false },

  trustedSources: [
    "spiegel.de",
    "zeit.de",
    "faz.net",
    "sueddeutsche.de",
    "tagesschau.de",
    "deutschlandfunk.de",
    "dw.com/de",
    "handelsblatt.com",
    "wiwo.de",
    "manager-magazin.de",
    "bild.de",
    "rtl.de",
    "n-tv.de",
    "stern.de",
    "focus.de",
    "orf.at",
    "derstandard.at",
    "nzz.ch",
    "admin.ch",
  ],

  geographicFocus: "DACH region (Germany, Austria, Switzerland) — prioritize German-language stories with direct relevance to German-speaking audiences. Fall back to broader European stories only if no strong DACH story exists.",

  viralCheck: false,
  trendingConfig: {
    googleNewsGeos: ["DE", "AT", "CH"],
    googleNewsLang: "de",
    youtubeRegionCode: "DE",
    youtubeQuery: "deutsche nachrichten heute",
  },
  gcsPrefix: "tscontent",
  metaPageId: process.env.TS_META_PAGE_ID ?? "",
  metaPageToken: process.env.TS_META_PAGE_TOKEN ?? "",
  instagramEnabled: false,
  postSourceAsComment: true,
  tikTokEnabled: false,
  tikTokAccessToken: process.env.TS_TIKTOK_ACCESS_TOKEN ?? "",
  channels: {
    telegram: { enabled: true, chatIdEnvVar: "TELEGRAM_TS_CHAT_ID" },
    line: { enabled: false, groupIdEnvVar: "LINE_TS_GROUP_ID" },
  },
  reels: {
    enabled: true,
    scheduleEnabled: true,
    voiceId: process.env.TS_REEL_VOICE_ID ?? "",
    voiceIds: [process.env.TS_REEL_VOICE_ID ?? ""],
    voices: [
      { id: process.env.TS_REEL_VOICE_ID ?? "", provider: "elevenlabs" as const },
    ] satisfies VoiceEntry[],
    voicesFull: [
      { id: process.env.TS_REEL_VOICE_ID ?? "", provider: "elevenlabs" as const },
    ] satisfies VoiceEntry[],
    sceneCount: 4,
    reelTimes: [
      { time: "07:30", category: "trending" },
      { time: "12:00", category: "business" },
      { time: "16:30", category: "trending" },
      { time: "21:00", category: "trending" },
    ],
    reelTimesWeekend: [
      { time: "09:30", category: "trending" },
      { time: "14:30", category: "business" },
      { time: "18:30", category: "trending" },
      { time: "22:00", category: "trending" },
    ],
    musicByCategory: {
      breaking:       ["<repo>/assets/music/breaking-news-1.mp3", "<repo>/assets/music/breaking-news-2.mp3", "<repo>/assets/music/breaking-news-3.mp3", "<repo>/assets/music/breaking-news-4.mp3", "<repo>/assets/music/breaking-news-6.mp3"],
      trending:       ["<repo>/assets/music/trending-1.mp3", "<repo>/assets/music/trending-2.mp3", "<repo>/assets/music/trending-3.mp3", "<repo>/assets/music/trending-5.mp3"],
      human_interest: ["<repo>/assets/music/human-interest-1.mp3", "<repo>/assets/music/human-interest-2.mp3", "<repo>/assets/music/human-interest-3.mp3", "<repo>/assets/music/human-interest-4.mp3", "<repo>/assets/music/human-interest-5.mp3", "<repo>/assets/music/human-interest-6.mp3", "<repo>/assets/music/human-interest-7.mp3", "<repo>/assets/music/human-interest-8.mp3"],
      business:       ["<repo>/assets/music/business-1.mp3", "<repo>/assets/music/business-2.mp3", "<repo>/assets/music/business-3.mp3", "<repo>/assets/music/business-4.mp3"],
      open:           ["<repo>/assets/music/open-1.mp3", "<repo>/assets/music/open-2.mp3", "<repo>/assets/music/open-3.mp3", "<repo>/assets/music/open-4.mp3"],
    },
    cameraEffectByCategory: {
      breaking:       "zoom_in",
      trending:       "ken_burns",
      human_interest: "pan_left",
      business:       "zoom_in",
      open:           "ken_burns",
    },
    cameraPresetByCategory: {
      breaking:       "urgent_push",
      trending:       "cinematic_drift",
      human_interest: "documentary_slide",
      business:       "slow_reveal",
      open:           "cinematic_drift",
    },
    musicFiles: [
      "<repo>/assets/music/breaking-news-1.mp3",
      "<repo>/assets/music/breaking-news-2.mp3",
      "<repo>/assets/music/upbeat-1.mp3",
    ],
    musicVolume: 0.20,
    stage5Renderer: "hyperframes",
    stage5Template: "enhanced-default",
    stage5Performance: {
      effectQuality: "balanced",
    },
  },
  useStockImages: false,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/brands/ts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/brands/ts.ts tests/brands/ts.test.ts
git commit -m "2026-07-13-add-ts-brand-config"
```

---

## Task 8: Register `ts` brand — widen types and fix compile errors

**Files:**
- Modify: `src/types.ts` (L6, L45)
- Modify: `src/brands/index.ts`
- Modify: `src/config.ts` (L2, L4)
- Modify: `src/pipeline/reel-intake.ts` (L5)
- Modify: `src/workers/reel-assembly-worker.ts` (L175)

- [ ] **Step 1: Widen `BrandId` and `language` unions in types.ts**

In `src/types.ts`:

L6: change `export type BrandId = "ds" | "ns";` to `export type BrandId = "ds" | "ns" | "ts";`

L45: change `language: "th" | "en";` to `language: "th" | "en" | "de";`

- [ ] **Step 2: Register ts in brands/index.ts**

Replace the entire contents of `src/brands/index.ts`:

```typescript
import type { BrandConfig, BrandId } from "../types.js";
import { ds } from "./ds.js";
import { ns } from "./ns.js";
import { ts } from "./ts.js";

const brands: Record<BrandId, BrandConfig> = { ds, ns, ts };

export function getBrand(id: BrandId): BrandConfig {
  const brand = brands[id];
  if (!brand) throw new Error(`Unknown brand: ${id}`);
  return brand;
}

export { ds, ns, ts };
```

- [ ] **Step 3: Add ts to ALL_BRANDS in config.ts**

In `src/config.ts`:

L2: change `import { ds, ns } from "./brands/index.js";` to `import { ds, ns, ts } from "./brands/index.js";`

L4: change `const ALL_BRANDS = [ds, ns];` to `const ALL_BRANDS = [ds, ns, ts];`

- [ ] **Step 4: Fix type-literal hardcodes**

In `src/pipeline/reel-intake.ts` L5: change `brand: "ds" | "ns";` to `brand: BrandId;` and add the import at top: `import type { BrandId } from "../types.js";`

In `src/workers/reel-assembly-worker.ts` L175: change `const brand = getBrand(reel.brand as "ds" | "ns");` to `const brand = getBrand(reel.brand as BrandId);` and add `BrandId` to the existing `types.js` import if not already there.

- [ ] **Step 5: Run build — expect zero errors**

Run: `npm run build`
Expected: PASS. If compile errors remain, they point to additional `"ds" | "ns"` literals — fix each by widening to `BrandId`.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/brands/index.ts src/config.ts src/pipeline/reel-intake.ts src/workers/reel-assembly-worker.ts
git commit -m "2026-07-13-register-ts-brand"
```

---

## Task 9: Wire up dashboard, renderer asset map, and schema comment

**Files:**
- Modify: `src/review/dashboard-html-builder.ts` (L69, L103-104)
- Modify: `src/stages/reel-stage5-hyperframes-renderer.ts` (L24-25, L281)
- Modify: `src/db/schema.ts` (L5)

- [ ] **Step 1: Update dashboard brand label and nav (dashboard-html-builder.ts)**

At L69 replace `const brandLabel = data.brandId === "ds" ? "ThaiDaily" : "WorldBrief";` with a map:

```typescript
const BRAND_LABELS: Record<string, string> = {
  ds: "ThaiDaily",
  ns: "WorldBrief",
  ts: "TagesBrief",
};
const brandLabel = BRAND_LABELS[data.brandId] ?? data.brandId;
```

At L103-104, add a third nav link after the WorldBrief link:

```typescript
<a href="/dashboard?brand=ds" class="${brandId === "ds" ? "active" : ""}">ThaiDaily</a>
<a href="/dashboard?brand=ns" class="${brandId === "ns" ? "active" : ""}">WorldBrief</a>
<a href="/dashboard?brand=ts" class="${brandId === "ts" ? "active" : ""}">TagesBrief</a>
```

- [ ] **Step 2: Update renderer logo asset map (reel-stage5-hyperframes-renderer.ts)**

At L24-25, add the `ts` entry to the logo paths map:

```typescript
const LOGO_PATHS: Record<string, string> = {
  ns: path.join("assets", "brands", "worldbrief_logo_white_transparent.png"),
  ds: path.join("assets", "brands", "thaidaily_logo_white_transparent.png"),
  ts: path.join("assets", "brands", "tagesbrief_logo_white_transparent.png"),
};
```

At L281, replace the hardcoded `const assetName = "worldbrief_logo_white_transparent.png";` with a brand-aware lookup. Read the brand from the context (the function has access to `ctx.brand.id`):

```typescript
const assetName = LOGO_PATHS[ctx.brand.id] ?? LOGO_PATHS.ns;
```

(Adjust `ctx.brand.id` to match the actual variable name in scope at L281 — read the surrounding code to confirm.)

- [ ] **Step 3: Update schema comment (db/schema.ts)**

At L5, change the comment `// "ds" | "ns"` to `// "ds" | "ns" | "ts"`.

- [ ] **Step 4: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/dashboard-html-builder.ts src/stages/reel-stage5-hyperframes-renderer.ts src/db/schema.ts
git commit -m "2026-07-13-wire-ts-dashboard-and-renderer"
```

---

## Task 10: Final verification

**Files:** none modified (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS (all existing tests + new i18n/brand tests)

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: PASS with zero TypeScript errors

- [ ] **Step 3: Verify env validation picks up ts**

Run: `npm run cli ts --dry-run --stage 1 2>&1 | head -30`
Expected: either runs (if all env vars set) or fails with a clear "Missing required environment variables" message listing any unset `TS_*` or `TELEGRAM_TS_CHAT_ID` vars. This confirms the brand is registered and validation works.

- [ ] **Step 4: Full dry-run smoke test (if env vars are set)**

Run: `npm run cli ts --dry-run`
Expected: completes all stages (discover → script → voice → images → assemble) in dry-run mode without publishing. Check the logs for German script content and German TTS voice selection.

---

## Rollout (post-implementation)

1. Confirm all env vars in `.env`: `TS_META_PAGE_ID`, `TS_META_PAGE_TOKEN`, `TS_REEL_VOICE_ID`, `TELEGRAM_TS_CHAT_ID`
2. Confirm logo assets at `assets/brands/tagesbrief_logo.png` and `tagesbrief_logo_white_transparent.png`
3. `npm run build`
4. `pm2 restart pipeline` (never `pkill` or `nohup` — per AGENTS.md §2)
5. Send `!status` to the Telegram bot in the `TELEGRAM_TS_CHAT_ID` chat — should respond with German labels
6. Send `!help` — should respond with German command list
7. Trigger first real reel: `!reel` — verify German discovery, script, voice, and rendering
