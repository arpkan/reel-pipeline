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

  it("Thai wordCountBlock is preserved verbatim with {{sceneCount}} placeholder (ds regression guard)", () => {
    expect(REEL_STRINGS.th.wordCountBlock).toBe(`สำคัญ: แต่ละฉากต้องมี 25-45 คำ ประโยคไม่เกิน 20 คำต่อประโยค ใส่รายละเอียดเฉพาะเจาะจง: ชื่อ ตัวเลข สถานที่ เวลา ข้อเท็จจริงจากแหล่งข่าว
ใช้ประโยคสั้นสลับกับประโยคยาวเพื่อสร้างจังหวะ
สคริปต์รวม {{sceneCount}} ฉาก: ความยาวเสียงรวม 28–35 วินาที (TTS ความเร็วปกติ)`);
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
