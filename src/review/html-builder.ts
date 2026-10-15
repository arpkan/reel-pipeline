import type { RunContext, BrandConfig } from "../types.js";
import { escapeHtml } from "./utils.js";

export function buildTrendingSection(ctx: RunContext, brand: BrandConfig): string {
  const signals = ctx.trendingSignals;
  const isCustomTheme = !!ctx.theme;

  if (!signals && !brand.trendingConfig) return "";

  const hasSignals = signals && (signals.youtube.length > 0 || signals.googleNews.length > 0);

  const filterNote = isCustomTheme && ctx.theme
    ? `<div class="signal-filter-note">🎯 Filtered for theme: <strong>${escapeHtml(ctx.theme)}</strong> — irrelevant signals were ignored</div>`
    : "";

  const noSignalsNote = !hasSignals
    ? `<div style="color:#999;font-size:12px">No signals fetched (all sources failed or returned empty)</div>`
    : "";

  const cols: string[] = [];
  if (signals?.youtube.length) {
    cols.push(`<div class="signal-col">
      <h4>▶️ YouTube Top Videos</h4>
      <ul>${signals.youtube.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
    </div>`);
  }
  if (signals?.googleNews.length) {
    cols.push(`<div class="signal-col">
      <h4>📰 Google News</h4>
      <ul>${signals.googleNews.map((item) => `<li>${escapeHtml(item.title)}</li>`).join("")}</ul>
    </div>`);
  }

  return `<details>
  <summary>📡 Trending Signals</summary>
  <div class="panel-body">
    ${filterNote}
    ${noSignalsNote}
    <div class="signals-grid">${cols.join("\n")}</div>
  </div>
</details>`;
}
