import { describe, it, expect, vi } from "vitest";
import { getBrand } from "../src/brands/index.js";

describe("getBrand", () => {
  it("returns ds config", () => {
    const brand = getBrand("ds");
    expect(brand.id).toBe("ds");
    expect(brand.language).toBe("th");
    expect(brand.timezone).toBe("Asia/Bangkok");
    expect(brand.viralCheck).toBe(true);
    expect(brand.gcsPrefix).toBe("dscontent");
  });

  it("returns ns config", () => {
    const brand = getBrand("ns");
    expect(brand.id).toBe("ns");
    expect(brand.language).toBe("en");
    expect(brand.timezone).toBe("Europe/Berlin");
    expect(brand.viralCheck).toBe(false);
    expect(brand.gcsPrefix).toBe("nscontent");
  });

  it("enables automated reel scheduling for ds", () => {
    const brand = getBrand("ds");

    expect(brand.reels?.enabled).toBe(true);
    expect(brand.reels?.scheduleEnabled).toBe(true);
  });

  it("temporarily limits ds reel voices to elevenlabs", () => {
    const brand = getBrand("ds");

    expect(brand.reels?.voices?.map((v) => v.provider)).toEqual(["elevenlabs", "elevenlabs"]);
    expect(brand.reels?.voicesFull?.map((v) => v.provider)).toEqual(["elevenlabs", "elevenlabs"]);
  });

  it("throws on unknown brand", () => {
    expect(() => getBrand("xx" as "ds")).toThrow();
  });

  it("ignores legacy voice override env vars", async () => {
    process.env.DS_VOICE_OVERRIDE = "TH-ThaptimSD";
    process.env.NS_VOICE_OVERRIDE = "English_expressive_narrator";
    vi.resetModules();

    try {
      const { getBrand: getFreshBrand } = await import("../src/brands/index.js");

      expect(getFreshBrand("ds").reels?.voices?.map((v) => v.id)).toEqual([
        process.env.DS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
        "qWWAqFomnJ99VwQLREfT",
      ]);
      expect(getFreshBrand("ns").reels?.voices?.map((v) => v.id)).toEqual([
        process.env.NS_REEL_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
        "English_expressive_narrator",
      ]);
    } finally {
      delete process.env.DS_VOICE_OVERRIDE;
      delete process.env.NS_VOICE_OVERRIDE;
      vi.resetModules();
    }
  });
});
