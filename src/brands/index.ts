import type { BrandConfig, BrandId } from "../types.js";
import { ds } from "./ds.js";
import { ns } from "./ns.js";
import { ts } from "./ts.js";

const brands: Record<BrandId, BrandConfig> = { ds, ns, ts };

export function getBrand(id: BrandId): BrandConfig {
  const brand = brands[id];
  if (!brand) throw new Error(`Unknown brand: ${id}`);
  return brand;
}

export { ds, ns, ts };
