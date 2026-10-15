import "dotenv/config";
import { createSearchService } from "../src/services/search.js";
import { getBrand } from "../src/brands/index.js";

const brand = getBrand("ds");
const search = createSearchService();

const queries = brand.searchQueries["standard"].slice(0, 4);
console.log(`Running ${queries.length} queries...\n`);

const seen = new Set<string>();
let index = 0;

for (const query of queries) {
  console.log(`\n── Query: "${query}" ──`);
  const results = await search.search(query, { maxResults: 5, searchDepth: "basic" });

  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    console.log(`  [${index}] ${r.title}`);
    console.log(`       ${r.url}`);
    console.log(`       score: ${r.score.toFixed(3)} | snippet: ${r.content.slice(0, 120)}...`);
    index++;
  }
}

console.log(`\nTotal unique candidates: ${index}`);
