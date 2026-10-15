import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const saveMock = vi.fn(async () => undefined);
  const fileMock = vi.fn(() => ({ save: saveMock }));
  const bucketMock = vi.fn(() => ({ file: fileMock }));
  const storageMock = vi.fn(() => ({ bucket: bucketMock }));
  return { saveMock, fileMock, bucketMock, storageMock };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: hoisted.storageMock,
}));

describe("GcsService video uploads", () => {
  it("returns a fresh cache-busted URL for repeated uploads to the same reel object", async () => {
    const { GcsService } = await import("../src/services/gcs.js");
    const gcs = new GcsService("bucket");

    const first = await gcs.uploadVideo("prefix", "run-1", "reel.mp4", Buffer.from("first"));
    const second = await gcs.uploadVideo("prefix", "run-1", "reel.mp4", Buffer.from("second"));

    expect(first).toMatch(/^https:\/\/storage\.googleapis\.com\/bucket\/prefix\/run-1\/reel\.mp4\?v=.+/u);
    expect(second).toMatch(/^https:\/\/storage\.googleapis\.com\/bucket\/prefix\/run-1\/reel\.mp4\?v=.+/u);
    expect(second).not.toBe(first);
    expect(hoisted.fileMock).toHaveBeenCalledWith("prefix/run-1/reel.mp4");
  });
});
