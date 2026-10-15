import "dotenv/config";
import { StockImageService } from "../src/services/stock-image.js";
import fs from "fs";

async function main() {
  const service = new StockImageService(
    process.env.UNSPLASH_ACCESS_KEY ?? "",
    "",
    "",
  );

  const queries = [
    "Berlin cityscape at sunset, dramatic lighting, photorealistic",
    "factory workers in hard hats, warm tones, no faces",
    "futuristic robot assembly line, neon lights, cinematic",
    "Thai temple golden sunset, peaceful atmosphere",
  ];

  fs.mkdirSync("tmp-stock-test", { recursive: true });

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log(`\nQuery: "${q}"`);
    const buf = await service.tryStockImage(q, "portrait");
    if (buf) {
      const filename = `tmp-stock-test/stock-${i + 1}.jpg`;
      fs.writeFileSync(filename, buf);
      console.log(`  -> Saved to ${filename} (${buf.length} bytes)`);
    } else {
      console.log("  -> No result (will fallback to Imagen)");
    }
  }
}

main().catch(console.error);
