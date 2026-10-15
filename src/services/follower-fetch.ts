import { getBrand } from "../brands/index.js";
import { createMetaService } from "./meta.js";
import { upsertFollowerSnapshot } from "../db/queries.js";
import type { BrandId } from "../types.js";

export async function collectFollowerSnapshot(brandId: BrandId): Promise<void> {
  const brand = getBrand(brandId);
  const meta = createMetaService();

  const count = await meta.fetchFollowerCount(brand.metaPageId, brand.metaPageToken);
  const today = new Date().toISOString().slice(0, 10);

  upsertFollowerSnapshot(brandId, today, count);
  console.log(`[followers] ${brandId}: ${count} followers on ${today}`);
}
