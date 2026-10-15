import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/telegram.js", () => ({
  createTelegramService: vi.fn(() => ({
    sendMessageWithId: vi.fn().mockResolvedValue(42),
    editMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { PostProgress } from "../src/pipeline/progress.js";

describe("PostProgress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders initial pending state for all stages", () => {
    const p = new PostProgress("TestBrand", "run-123", [
      "post-stage2-captions",
      "post-stage3-image-gen",
      "post-stage4-review-notify",
    ]);
    const rendered = (p as any).render("running");
    expect(rendered).toContain("TestBrand");
    expect(rendered).toContain("◻️");
    expect(rendered).not.toContain("✅");
  });

  it("updates stage to running then ok", () => {
    const p = new PostProgress("TestBrand", "run-123", ["post-stage2-captions"]);
    p.stageStart("post-stage2-captions");
    let rendered = (p as any).render("running");
    expect(rendered).toContain("⏳");
    p.stageEnd("post-stage2-captions", 1500);
    rendered = (p as any).render("running");
    expect(rendered).toContain("✅");
    expect(rendered).toContain("(2s)");
  });

  it("renders error state", () => {
    const p = new PostProgress("TestBrand", "run-123", ["post-stage2-captions"]);
    p.stageEnd("post-stage2-captions", 100, "API error");
    const rendered = (p as any).render("failed", undefined, "API error");
    expect(rendered).toContain("❌");
  });

  it("init sends message and stores msgId", async () => {
    const p = new PostProgress("TestBrand", "run-123", ["post-stage2-captions"]);
    await p.init("chat-123");
    const msgId = (p as any).msgId;
    expect(msgId).toBe(42);
  });
});
