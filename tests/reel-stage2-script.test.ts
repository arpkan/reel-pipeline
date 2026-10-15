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

  it("does not include English hooks when Thai", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).not.toContain("You won't believe");
  });

  it("includes Thai engagement hooks and anti-patterns", () => {
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

  it("includes Thai word count and rhythm guidance", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("25-45 คำ");
    expect(prompt).toContain("ประโยคสั้นสลับกับประโยคยาว");
    expect(prompt).toContain("28–35 วินาที");
  });

  it("keeps English word count rule for English brand", () => {
    const prompt = buildSystemPrompt(nsContext);
    expect(prompt).toContain("20-35 words");
    expect(prompt).not.toContain("25-45 คำ");
  });

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

  it("Thai prompt has explicit Thai-only output instruction", () => {
    const prompt = buildSystemPrompt(dsContext);
    expect(prompt).toContain("ห้ามมีคำภาษาอังกฤษในสคริปต์");
  });
});
