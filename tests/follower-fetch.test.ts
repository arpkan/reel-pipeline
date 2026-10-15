import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch before importing anything that uses it
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { MetaService } from "../src/services/meta.js";

describe("MetaService.fetchFollowerCount", () => {
  let svc: MetaService;
  beforeEach(() => {
    svc = new MetaService();
    vi.clearAllMocks();
  });

  it("returns fan_count from page response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "123", fan_count: 4200 }),
    });

    const count = await svc.fetchFollowerCount("PAGE_ID", "TOKEN");

    expect(count).toBe(4200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("PAGE_ID"),
    );
    expect(mockFetch.mock.calls[0][0]).toContain("fan_count");
    expect(mockFetch.mock.calls[0][0]).toContain("TOKEN");
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" });

    await expect(svc.fetchFollowerCount("PAGE_ID", "TOKEN")).rejects.toThrow("401");
  });
});
