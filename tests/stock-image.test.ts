import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractSearchQuery,
  searchUnsplash,
  searchPexels,
  searchPixabay,
  StockImageService,
  createStockImageService,
} from "../src/services/stock-image.js";

describe("extractSearchQuery", () => {
  it("takes first comma segment for comma-separated prompts", () => {
    const result = extractSearchQuery(
      "A sunset over the ocean, with golden light reflecting on waves, photorealistic"
    );
    expect(result).toBe("sunset over the ocean");
  });

  it("takes first sentence for sentence-style prompts", () => {
    const result = extractSearchQuery(
      "A city skyline at dusk. The buildings are silhouetted against an orange sky."
    );
    expect(result).toBe("city skyline at dusk");
  });

  it("strips leading articles", () => {
    expect(extractSearchQuery("A beautiful mountain")).toBe("beautiful mountain");
    expect(extractSearchQuery("An ancient temple")).toBe("ancient temple");
    expect(extractSearchQuery("The Eiffel Tower")).toBe("Eiffel Tower");
  });

  it("removes style directives", () => {
    expect(extractSearchQuery("A cat, text reading Hello, no faces")).toBe("cat");
    expect(extractSearchQuery("A dog, aspect ratio 16:9, photorealistic")).toBe("dog");
    expect(extractSearchQuery("A bird, cinematic, high contrast, no frames")).toBe("bird");
    expect(extractSearchQuery("A fish, no social media, sans-serif")).toBe("fish");
  });

  it("removes orientation directives", () => {
    expect(extractSearchQuery("A mountain, vertical, landscape")).toBe("mountain");
    expect(extractSearchQuery("A river, horizontal, square, portrait")).toBe("river");
  });

  it("truncates long queries at word boundary to 100 chars", () => {
    const longPrompt =
      "A very long description of something that keeps going and going and going and going and going and going and going beyond the hundred character limit";
    const result = extractSearchQuery(longPrompt);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.length).toBeGreaterThan(0);
  });

  it("passes short prompts through", () => {
    expect(extractSearchQuery("sunset")).toBe("sunset");
    expect(extractSearchQuery("ocean waves")).toBe("ocean waves");
  });

  it("handles prompt with only style directives after first segment", () => {
    expect(extractSearchQuery("A cat, photorealistic, cinematic")).toBe("cat");
  });
});

describe("searchUnsplash", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns URL on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ urls: { regular: "https://images.unsplash.com/photo-123" } }],
        }),
    });

    const url = await searchUnsplash("cat", "portrait", "test-key");
    expect(url).toBe("https://images.unsplash.com/photo-123");
    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain("unsplash.com");
    expect(callUrl).toContain("query=cat");
    expect(callUrl).toContain("orientation=portrait");
  });

  it("returns null on empty results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const url = await searchUnsplash("cat", "portrait", "test-key");
    expect(url).toBeNull();
  });

  it("returns null on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const url = await searchUnsplash("cat", "portrait", "test-key");
    expect(url).toBeNull();
  });

  it("returns null on fetch exception", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    const url = await searchUnsplash("cat", "portrait", "test-key");
    expect(url).toBeNull();
  });
});

describe("searchPexels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns URL on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          photos: [{ src: { large: "https://images.pexels.com/photo-456" } }],
        }),
    });

    const url = await searchPexels("dog", "portrait", "test-key");
    expect(url).toBe("https://images.pexels.com/photo-456");
    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain("pexels.com");
    expect(callUrl).toContain("query=dog");
  });

  it("returns null on empty results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ photos: [] }),
    });

    const url = await searchPexels("dog", "portrait", "test-key");
    expect(url).toBeNull();
  });

  it("returns null on fetch exception", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

    const url = await searchPexels("dog", "portrait", "test-key");
    expect(url).toBeNull();
  });
});

describe("searchPixabay", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns URL on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          hits: [{ largeImageURL: "https://pixabay.com/get/large-789" }],
        }),
    });

    const url = await searchPixabay("bird", "portrait", "test-key");
    expect(url).toBe("https://pixabay.com/get/large-789");
    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain("pixabay.com");
    expect(callUrl).toContain("key=test-key");
    expect(callUrl).toContain("orientation=vertical");
  });

  it("returns null on empty results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: [] }),
    });

    const url = await searchPixabay("bird", "portrait", "test-key");
    expect(url).toBeNull();
  });

  it("returns null on fetch exception", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

    const url = await searchPixabay("bird", "portrait", "test-key");
    expect(url).toBeNull();
  });

  it("maps square orientation to all for Pixabay", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: [] }),
    });

    await searchPixabay("bird", "square", "test-key");
    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain("orientation=all");
  });
});

describe("StockImageService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when all keys are empty", async () => {
    const svc = new StockImageService("", "", "");
    const result = await svc.tryStockImage("A cat", "portrait");
    expect(result).toBeNull();
  });

  it("returns { buffer, provider } on Unsplash hit", async () => {
    const svc = new StockImageService("u-key", "p-key", "x-key");
    const imageBuf = new Uint8Array([1, 2, 3, 4]);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("unsplash.com/search")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ urls: { regular: "https://img.unsplash.com/abc" } }],
              }),
          });
        }
        if (urlStr.includes("pexels.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ photos: [] }) });
        }
        if (urlStr.includes("pixabay.com")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: [] }) });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(imageBuf.buffer),
        });
      }
    );

    const result = await svc.tryStockImage("A beautiful cat", "portrait");
    expect(result).not.toBeNull();
    expect(result!.buffer).toBeInstanceOf(Buffer);
    expect(Buffer.from(imageBuf).equals(result!.buffer)).toBe(true);
    expect(result!.provider).toBe("unsplash");
  });

  it("returns null when all APIs fail", async () => {
    const svc = new StockImageService("u-key", "p-key", "x-key");

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], photos: [], hits: [] }),
    });

    const result = await svc.tryStockImage("A cat", "portrait");
    expect(result).toBeNull();
  });

  it("returns null without throwing when fetch throws", async () => {
    const svc = new StockImageService("u-key", "", "");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const result = await svc.tryStockImage("A cat", "portrait");
    expect(result).toBeNull();
  });

  it("falls back to Pexels when Unsplash returns null", async () => {
    const svc = new StockImageService("u-key", "p-key", "");
    const imageBuf = new Uint8Array([5, 6, 7]);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("unsplash.com/search")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
        }
        if (urlStr.includes("pexels.com/v1/search")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                photos: [{ src: { large: "https://images.pexels.com/xyz" } }],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(imageBuf.buffer),
        });
      }
    );

    const result = await svc.tryStockImage("A dog", "portrait");
    expect(result).not.toBeNull();
    expect(result!.buffer).toBeInstanceOf(Buffer);
    expect(result!.provider).toBe("pexels");
  });

  it("falls back to Pixabay when Unsplash and Pexels return null", async () => {
    const svc = new StockImageService("u-key", "p-key", "x-key");
    const imageBuf = new Uint8Array([8, 9, 10]);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("unsplash.com/search")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
        }
        if (urlStr.includes("pexels.com/v1/search")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ photos: [] }) });
        }
        if (urlStr.includes("pixabay.com/api/")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                hits: [{ largeImageURL: "https://pixabay.com/large" }],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(imageBuf.buffer),
        });
      }
    );

    const result = await svc.tryStockImage("A bird", "square");
    expect(result).not.toBeNull();
    expect(result!.buffer).toBeInstanceOf(Buffer);
    expect(result!.provider).toBe("pixabay");
  });
});

describe("createStockImageService", () => {
  it("creates service with empty keys when env vars not set", () => {
    const origUnsplash = process.env.UNSPLASH_ACCESS_KEY;
    const origPexels = process.env.PEXELS_API_KEY;
    const origPixabay = process.env.PIXABAY_API_KEY;
    delete process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.PEXELS_API_KEY;
    delete process.env.PIXABAY_API_KEY;

    const svc = createStockImageService();
    expect(svc).toBeInstanceOf(StockImageService);

    if (origUnsplash) process.env.UNSPLASH_ACCESS_KEY = origUnsplash;
    if (origPexels) process.env.PEXELS_API_KEY = origPexels;
    if (origPixabay) process.env.PIXABAY_API_KEY = origPixabay;
  });

  it("reads keys from environment", () => {
    const origUnsplash = process.env.UNSPLASH_ACCESS_KEY;
    const origPexels = process.env.PEXELS_API_KEY;
    const origPixabay = process.env.PIXABAY_API_KEY;
    process.env.UNSPLASH_ACCESS_KEY = "test-u";
    process.env.PEXELS_API_KEY = "test-p";
    process.env.PIXABAY_API_KEY = "test-x";

    const svc = createStockImageService();
    expect(svc).toBeInstanceOf(StockImageService);

    if (origUnsplash) process.env.UNSPLASH_ACCESS_KEY = origUnsplash;
    else delete process.env.UNSPLASH_ACCESS_KEY;
    if (origPexels) process.env.PEXELS_API_KEY = origPexels;
    else delete process.env.PEXELS_API_KEY;
    if (origPixabay) process.env.PIXABAY_API_KEY = origPixabay;
    else delete process.env.PIXABAY_API_KEY;
  });
});
