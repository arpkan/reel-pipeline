/**
 * Test script for stage1b viral check
 * Usage: npx tsx bin/test-viral.ts
 */
import "dotenv/config";
import { createSearchService } from "../src/services/search.js";
import type { SearchResult } from "../src/services/search.js";

// ─── Copy of scoring logic from stage1b (to test without running the pipeline) ─

async function fetchThaiTrends(): Promise<string[]> {
  const res = await fetch("https://trends24.in/thailand/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsPipeline/1.0)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`trends24 returned ${res.status}`);
  const html = await res.text();
  const matches = [...html.matchAll(/<li[^>]*>.*?<a[^>]*>([^<]+)<\/a>/gs)];
  return matches.map((m) => m[1].trim().toLowerCase()).filter(Boolean);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calcViralScore(
  xResults: SearchResult[],
  lineResults: SearchResult[],
  thaiTrends: string[],
  headline: string,
  today: string,
  yesterday: string,
): number {
  let score = 0;
  const breakdown: string[] = [];

  if (xResults.length > 0) {
    const xCount = xResults.length * 10;
    const xAvg = avg(xResults.map((r) => r.score)) * 100;
    score += xCount + xAvg;
    breakdown.push(`X: ${xResults.length} results (+${xCount}) avg score (+${xAvg.toFixed(1)})`);
  }

  if (lineResults.length > 0) {
    const lCount = lineResults.length * 10;
    const lAvg = avg(lineResults.map((r) => r.score)) * 100;
    score += lCount + lAvg;
    breakdown.push(`LINE: ${lineResults.length} results (+${lCount}) avg score (+${lAvg.toFixed(1)})`);
  }

  if (thaiTrends.length > 0) {
    const words = headline.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const matchedWord = words.find((word) => thaiTrends.some((trend) => trend.includes(word)));
    if (matchedWord) {
      score += 50;
      breakdown.push(`Trends24 match: "${matchedWord}" (+50)`);
    }
  }

  const allResults = [...xResults, ...lineResults];
  const mostRecent = allResults
    .map((r) => r.publishedDate?.slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop();

  if (mostRecent === today) {
    score += 30;
    breakdown.push(`Published today (+30)`);
  } else if (mostRecent === yesterday) {
    score += 15;
    breakdown.push(`Published yesterday (+15)`);
  }

  return Math.round(score);
}

// ─── Test stories ─────────────────────────────────────────────────────────────

const TEST_HEADLINES = [
  "ราคาน้ำมันพุ่งสูงสุดในรอบ 3 เดือน หลังโอเปกประกาศลดกำลังผลิต",
  "นักศึกษาไทยคว้าเหรียญทองโอลิมปิกวิชาการ คณิตศาสตร์ระดับนานาชาติ",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const search = createSearchService();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const yesterday = offsetDate(today, -1);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`📅 Today: ${today}  Yesterday: ${yesterday}`);

  // Step 1: Fetch trends24
  console.log(`\n${"─".repeat(60)}`);
  console.log("🔥 Fetching Thai trending topics from trends24.in...");
  let thaiTrends: string[] = [];
  try {
    thaiTrends = await fetchThaiTrends();
    console.log(`✅ ${thaiTrends.length} topics fetched`);
    console.log("Top 10:", thaiTrends.slice(0, 10).join(", "));
  } catch (err) {
    console.error(`❌ Failed: ${err instanceof Error ? err.message : err}`);
  }

  // Step 2: Score each test headline
  for (const headline of TEST_HEADLINES) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📰 "${headline}"`);

    const keyword = headline.slice(0, 50);

    const [xResults, lineResults] = await Promise.all([
      search.search(`site:twitter.com OR site:x.com "${keyword}" Thailand trending`, { maxResults: 5, searchDepth: "basic" })
        .catch(() => [] as SearchResult[]),
      search.search(`site:today.line.me "${keyword}"`, { maxResults: 5, searchDepth: "basic" })
        .catch(() => [] as SearchResult[]),
    ]);

    console.log(`  X results (${xResults.length}):`);
    xResults.forEach((r) => console.log(`    • [${r.score.toFixed(2)}] ${r.url}`));

    console.log(`  LINE results (${lineResults.length}):`);
    lineResults.forEach((r) => console.log(`    • [${r.score.toFixed(2)}] ${r.url}`));

    // Check trends24 match
    const words = headline.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const matchedTrend = words.find((w) => thaiTrends.some((t) => t.includes(w)));
    console.log(`  Trends24 match: ${matchedTrend ? `✅ "${matchedTrend}"` : "none"}`);

    const score = calcViralScore(xResults, lineResults, thaiTrends, headline, today, yesterday);
    console.log(`  ⚡ Viral score: ${score}  ${score > 0 ? "(VIRAL)" : "(normal)"}`);
  }

  // Step 3: Show sort order
  console.log(`\n${"─".repeat(60)}`);
  console.log("📊 Post order after sort (highest score → Post 1):");
  const scored = await Promise.all(TEST_HEADLINES.map(async (headline, i) => {
    const keyword = headline.slice(0, 50);
    const [xResults, lineResults] = await Promise.all([
      search.search(`site:twitter.com OR site:x.com "${keyword}" Thailand trending`, { maxResults: 5, searchDepth: "basic" }).catch(() => [] as SearchResult[]),
      search.search(`site:today.line.me "${keyword}"`, { maxResults: 5, searchDepth: "basic" }).catch(() => [] as SearchResult[]),
    ]);
    return { headline, score: calcViralScore(xResults, lineResults, thaiTrends, headline, today, yesterday) };
  }));

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => console.log(`  Post ${i + 1}: [score=${s.score}] "${s.headline.slice(0, 50)}"`));

  console.log(`\n${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
