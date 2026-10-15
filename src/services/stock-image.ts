import type { StockProvider } from "../types.js";

type Orientation = "portrait" | "square" | "landscape";

const STYLE_DIRECTIVES = [
  "text reading",
  "no faces",
  "aspect ratio",
  "photorealistic",
  "cinematic",
  "high contrast",
  "no frames",
  "no social media",
  "sans-serif",
  "vertical",
  "horizontal",
  "square",
  "portrait",
  "landscape",
];

export function extractSearchQuery(prompt: string): string {
  let segment: string;
  if (prompt.includes(",")) {
    segment = prompt.split(",")[0];
  } else if (prompt.includes(".")) {
    segment = prompt.split(".")[0];
  } else {
    segment = prompt;
  }

  segment = segment.replace(/^(A|An|The)\s+/i, "").trim();

  let remaining = prompt;
  for (const dir of STYLE_DIRECTIVES) {
    const re = new RegExp(`,?\\s*\\b${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^,]*`, "gi");
    remaining = remaining.replace(re, "");
  }

  if (remaining.length > 0 && remaining !== prompt) {
    const cleaned = remaining
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (cleaned.length > 0) {
      segment = cleaned[0];
      segment = segment.replace(/^(A|An|The)\s+/i, "").trim();
    }
  }

  for (const dir of STYLE_DIRECTIVES) {
    const re = new RegExp(`\\b${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    segment = segment.replace(re, "").trim();
  }

  segment = segment.replace(/^(A|An|The)\s+/i, "").trim();

  if (segment.length > 100) {
    segment = segment.slice(0, 100);
    const lastSpace = segment.lastIndexOf(" ");
    if (lastSpace > 0) segment = segment.slice(0, lastSpace);
  }

  return segment;
}

export async function searchUnsplash(
  query: string,
  orientation: Orientation,
  apiKey: string
): Promise<string | null> {
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=3`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ urls?: { regular?: string } }> };
    return data.results?.[0]?.urls?.regular ?? null;
  } catch {
    return null;
  }
}

export async function searchPexels(
  query: string,
  orientation: Orientation,
  apiKey: string
): Promise<string | null> {
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=3`;
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { photos?: Array<{ src?: { large?: string } }> };
    return data.photos?.[0]?.src?.large ?? null;
  } catch {
    return null;
  }
}

export async function searchPixabay(
  query: string,
  orientation: Orientation,
  apiKey: string
): Promise<string | null> {
  try {
    const pixabayOrientation = orientation === "portrait" ? "vertical" : orientation === "landscape" ? "horizontal" : "all";
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${pixabayOrientation}&editors_choice=true&per_page=3`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { hits?: Array<{ largeImageURL?: string }> };
    return data.hits?.[0]?.largeImageURL ?? null;
  } catch {
    return null;
  }
}

const DEFAULT_PROVIDER_ORDER: StockProvider[] = ["unsplash", "pexels", "pixabay"];

function resolveProviderOrder(): StockProvider[] {
  const raw = process.env.STOCK_PROVIDER_ORDER ?? "";
  if (!raw.trim()) return DEFAULT_PROVIDER_ORDER;
  const valid = new Set<StockProvider>(DEFAULT_PROVIDER_ORDER);
  const seen = new Set<StockProvider>();
  const out: StockProvider[] = [];
  for (const raw_name of raw.split(",")) {
    const name = raw_name.trim().toLowerCase() as StockProvider;
    if (valid.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out.length > 0 ? out : DEFAULT_PROVIDER_ORDER;
}

export class StockImageService {
  private readonly unsplashKey: string;
  private readonly pexelsKey: string;
  private readonly pixabayKey: string;

  constructor(unsplashKey: string, pexelsKey: string, pixabayKey: string) {
    this.unsplashKey = unsplashKey;
    this.pexelsKey = pexelsKey;
    this.pixabayKey = pixabayKey;
  }

  private async searchOne(provider: StockProvider, query: string, orientation: Orientation): Promise<string | null> {
    if (provider === "unsplash" && this.unsplashKey) return searchUnsplash(query, orientation, this.unsplashKey);
    if (provider === "pexels"   && this.pexelsKey)   return searchPexels(query, orientation, this.pexelsKey);
    if (provider === "pixabay"  && this.pixabayKey)  return searchPixabay(query, orientation, this.pixabayKey);
    return null;
  }

  async tryStockImage(
    prompt: string,
    orientation: "portrait" | "square"
  ): Promise<{ buffer: Buffer; provider: StockProvider } | null> {
    try {
      if (!this.unsplashKey && !this.pexelsKey && !this.pixabayKey) return null;

      const query = extractSearchQuery(prompt);
      const order = resolveProviderOrder();

      for (const provider of order) {
        const imageUrl = await this.searchOne(provider, query, orientation);
        if (!imageUrl) continue;

        try {
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const arrBuf = await imgRes.arrayBuffer();
            return { buffer: Buffer.from(arrBuf), provider };
          }
        } catch {
          // download failed — fall through to next provider
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}

export function createStockImageService(): StockImageService {
  return new StockImageService(
    process.env.UNSPLASH_ACCESS_KEY ?? "",
    process.env.PEXELS_API_KEY ?? "",
    process.env.PIXABAY_API_KEY ?? ""
  );
}
