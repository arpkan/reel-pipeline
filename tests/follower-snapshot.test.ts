import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/queries.js", () => ({
  upsertFollowerSnapshot: vi.fn(),
}));

vi.mock("../src/services/meta.js", () => ({
  createMetaService: vi.fn().mockReturnValue({
    fetchFollowerCount: vi.fn().mockResolvedValue(3840),
  }),
}));

vi.mock("../src/brands/index.js", () => ({
  getBrand: vi.fn().mockReturnValue({
    metaPageId: "MOCK_PAGE_ID",
    metaPageToken: "MOCK_TOKEN",
  }),
}));

import { collectFollowerSnapshot } from "../src/services/follower-fetch.js";
import { upsertFollowerSnapshot } from "../src/db/queries.js";
import { createMetaService } from "../src/services/meta.js";
import { getBrand } from "../src/brands/index.js";

describe("collectFollowerSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches follower count and upserts snapshot for today", async () => {
    await collectFollowerSnapshot("ns");

    expect(getBrand).toHaveBeenCalledWith("ns");
    expect(createMetaService).toHaveBeenCalled();
    expect(upsertFollowerSnapshot).toHaveBeenCalledWith(
      "ns",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      3840,
    );
  });
});
