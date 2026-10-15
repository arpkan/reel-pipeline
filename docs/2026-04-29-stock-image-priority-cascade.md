# Stock Image — Sequential Priority Cascade with Pixabay Editorial Filter

**Date:** 2026-04-29
**Goal:** Replace the parallel "first-non-null wins" stock-image lookup with an explicit sequential cascade ordered by curation quality, and tighten Pixabay's quality floor by filtering for staff picks.

---

## Why

Today `StockImageService.tryStockImage` fires Unsplash, Pexels, and Pixabay searches **in parallel** and then iterates results in array order, returning the first non-null. Functionally Unsplash already wins by priority, but:

- Two of the three searches always run with their results discarded — wasted API quota.
- The priority is an accident of array ordering, not a stated intent.
- Pixabay (the lowest-curation source) accepts every public upload, so when it does serve as a fallback, quality is highly variable.

---

## Final design

1. **Sequential cascade.** Try the highest-priority provider first; only call the next provider if the previous returned no match (or the URL failed to download). Stops calling once a downloadable image is in hand.
2. **Default order:** Unsplash → Pexels → Pixabay. Unsplash is the most editorially curated; Pixabay is the broadest but loosest, so it sits last as a coverage fallback.
3. **Pixabay editorial filter.** When Pixabay is queried, append `&editors_choice=true` so only staff-picked images are returned. Editor's Choice is a few hundred thousand photos out of ~4M — narrow, but high quality.
4. **`STOCK_PROVIDER_ORDER` env var.** Optional comma-separated list of provider names (e.g. `pixabay,unsplash,pexels`) overrides the default order without redeploy. Validates against the known set; unknown values are ignored. Empty/unset → default order.

---

## Files

### `src/services/stock-image.ts`

Two changes:

1. `searchPixabay` URL gains `&editors_choice=true`.
2. `StockImageService.tryStockImage`:
   - Replace `Promise.all` with a `for` loop that walks providers in resolved order.
   - Resolve order at call time: parse `STOCK_PROVIDER_ORDER` if set, else use default. De-duplicate; drop unknown names; drop providers with empty keys.
   - For each provider in order: search → if URL → download → if download succeeds, return. Otherwise continue.
   - If all providers exhaust, return `null` (unchanged).

Sketch:
```ts
type ProviderName = "unsplash" | "pexels" | "pixabay";
const DEFAULT_ORDER: ProviderName[] = ["unsplash", "pexels", "pixabay"];

function resolveOrder(): ProviderName[] {
  const raw = process.env.STOCK_PROVIDER_ORDER ?? "";
  if (!raw.trim()) return DEFAULT_ORDER;
  const parsed = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<ProviderName>();
  const out: ProviderName[] = [];
  for (const name of parsed) {
    if ((DEFAULT_ORDER as string[]).includes(name) && !seen.has(name as ProviderName)) {
      seen.add(name as ProviderName);
      out.push(name as ProviderName);
    }
  }
  return out.length > 0 ? out : DEFAULT_ORDER;
}
```

The cascade body:
```ts
async tryStockImage(prompt, orientation) {
  if (!this.unsplashKey && !this.pexelsKey && !this.pixabayKey) return null;
  const query = extractSearchQuery(prompt);
  const order = resolveOrder();

  for (const provider of order) {
    let imageUrl: string | null = null;
    if (provider === "unsplash" && this.unsplashKey) imageUrl = await searchUnsplash(query, orientation, this.unsplashKey);
    else if (provider === "pexels" && this.pexelsKey) imageUrl = await searchPexels(query, orientation, this.pexelsKey);
    else if (provider === "pixabay" && this.pixabayKey) imageUrl = await searchPixabay(query, orientation, this.pixabayKey);
    if (!imageUrl) continue;
    try {
      const res = await fetch(imageUrl);
      if (res.ok) return { buffer: Buffer.from(await res.arrayBuffer()), provider };
    } catch { /* fall through */ }
  }
  return null;
}
```

### `.env.example`

Add a line near the existing stock-image keys:
```
# Stock image provider priority — comma-separated, e.g. "unsplash,pexels,pixabay" (default).
# Override to test alternate orderings without code changes.
STOCK_PROVIDER_ORDER=
```

---

## Tests

- Existing tests in `tests/stock-image.test.ts` (if any) continue to apply — no contract change for the public method signatures.
- No new test required; cascade is a straight loop and providers are individually exercised.

## Build & Deploy

```bash
npm run build
pm2 restart pipeline --update-env
```

`--update-env` is needed if you set `STOCK_PROVIDER_ORDER` after the process is running.

## Verification

- Trigger a reel and watch logs — only one stock provider should be hit per scene that needs stock (no longer three parallel calls).
- Set `STOCK_PROVIDER_ORDER=pixabay,unsplash,pexels` in `.env`, restart with `--update-env`, trigger a reel — Pixabay should be queried first.
- Pixabay results should now be staff picks only (visually noticeably more polished than the unfiltered baseline).

## Out of scope

- LLM-based re-ranking across providers (the bigger lever for fit-to-prompt — separate doc when ready).
- Caching results across scenes / reels.
- Per-brand provider order. `STOCK_PROVIDER_ORDER` is process-wide.
