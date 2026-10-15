// tests/story-messages.test.ts
import { describe, expect, it } from "vitest";
import { getMessages } from "../src/pipeline/story-messages.js";

describe("getMessages", () => {
  it("returns english messages by default", () => {
    const m = getMessages();
    expect(m.chooseLanguage).toBe("Choose your language:");
    expect(m.confirmButton).toBe("Confirm");
  });

  it("returns thai messages", () => {
    const m = getMessages("thai");
    expect(typeof m.chooseLanguage).toBe("string");
    expect(m.chooseLanguage.length).toBeGreaterThan(0);
    expect(m.confirmButton).toBe("ยืนยัน");
  });

  it("returns german messages", () => {
    const m = getMessages("german");
    expect(m.confirmButton).toBe("Bestätigen");
  });

  it("all three languages have the same keys", () => {
    const en = getMessages("english");
    const th = getMessages("thai");
    const de = getMessages("german");
    const keys = Object.keys(en);
    for (const key of keys) {
      expect(th).toHaveProperty(key);
      expect(de).toHaveProperty(key);
    }
  });

  it("confirmSetup formats name/lang/audience", () => {
    const m = getMessages("english");
    expect(m.confirmSetup("MyBrand", "english", "Dog owners")).toContain("MyBrand");
  });

  it("confirmSetup shows 'none' when audience is empty", () => {
    const m = getMessages("english");
    expect(m.confirmSetup("MyBrand", "english", "")).toContain("none");
  });
});
