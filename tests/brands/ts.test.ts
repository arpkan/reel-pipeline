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
