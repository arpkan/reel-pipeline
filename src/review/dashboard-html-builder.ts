import { escapeHtml, brandThemeCss, brandLogoHtml } from "./utils.js";

export interface ReelRow {
  id: string;
  headline: string;
  brand: string;
  theme: string | null;
  category: string | null;
  voiceId: string | null;
  views: number | null;
  likes: number | null;
  shares: number | null;
  engRate: number | null;
  overallScore: number | null;
  watchTimeSec: number | null;
  followersGained: number | null;
  publishedLabel: string | null;
  publishedAt: string | null;
}

export interface BreakdownRow {
  value: string;
  avgViews: number | null;
  avgEngRate: number | null;
  avgWatchTime: number | null;
  sampleCount: number;
  trend: "up" | "down" | "flat" | "new";
}

export interface CmpProgress {
  watchMinutes60d: number;
  totalFollowers: number | null;
  followersGained7d: number | null;
  followersGainedPrior7d: number | null;
}

export interface DataHealthItem {
  label: string;
  status: "ok" | "warning" | "critical" | "missing";
  detail: string;
  updatedLabel: string;
}

export interface DashboardData {
  brandId: string;
  dataHealth: DataHealthItem[];
  cmpProgress: CmpProgress;
  scorecard: {
    totalReels7d: number;
    totalReels30d: number;
    totalViews7d: number;
    totalViews30d: number;
    avgEngRate7d: number;
    avgEngRate30d: number;
    topDimension: { dimension: string; value: string; avgEngRate: number } | null;
  };
  dailyViews: Array<{ date: string; views: number }>;
  dailyFollowerGain: Array<{ date: string; gain: number }>;
  reels: ReelRow[];
  breakdowns: {
    theme: BreakdownRow[];
    voice: BreakdownRow[];
    music: BreakdownRow[];
    postingTime: BreakdownRow[];
  };
}

const BRAND_LABELS: Record<string, string> = {
  ds: "ThaiDaily",
  ns: "WorldBrief",
  ts: "TagesBrief",
};

export function buildDashboardPage(data: DashboardData): string {
  const brandLabel = BRAND_LABELS[data.brandId] ?? data.brandId;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(brandLabel)} Performance Dashboard</title>
<style>${brandThemeCss(data.brandId)}${DASHBOARD_CSS}</style>
</head>
<body>
<div class="shell">
  ${buildHeaderHtml(brandLabel, data.brandId)}
  <div class="sub-header">
    ${buildDataHealthHtml(data.dataHealth)}
  </div>
  ${buildCmpHtml(data.cmpProgress)}
  ${buildHeroHtml(data.dailyViews, data.dailyFollowerGain, data.scorecard, data.cmpProgress)}
  ${buildReelListHtml(data.reels, data.brandId)}
  ${buildBreakdownsHtml(data.breakdowns)}
</div>
${DASHBOARD_JS}
</body>
</html>`;
}

function buildHeaderHtml(brandLabel: string, brandId: string): string {
  return `
  <header class="topbar">
    <div class="topbar-left">
      ${brandLogoHtml(brandId)}
      <div class="topbar-title"><strong>${escapeHtml(brandLabel)}</strong> Performance Dashboard</div>
    </div>
    <div class="topbar-right">
      <div class="brand-switch">
        <a href="/dashboard?brand=ds" class="${brandId === "ds" ? "active" : ""}">ThaiDaily</a>
        <a href="/dashboard?brand=ns" class="${brandId === "ns" ? "active" : ""}">WorldBrief</a>
        <a href="/dashboard?brand=ts" class="${brandId === "ts" ? "active" : ""}">TagesBrief</a>
      </div>
    </div>
  </header>`;
}

function buildDataHealthHtml(items: DataHealthItem[]): string {
  const rows = items.map(item => `
    <div class="health-item ${item.status}" title="${escapeHtml(item.detail)} · ${escapeHtml(item.updatedLabel)}">
      <span class="health-label">${escapeHtml(item.label)}</span>
      <span class="health-pill ${item.status}">${escapeHtml(item.status)}</span>
    </div>`).join("");

  return `
  <section class="health-card">
    <div class="health-row">${rows}</div>
  </section>`;
}

function buildCmpHtml(cmp: CmpProgress): string {
  const followerPct = cmp.totalFollowers != null
    ? Math.min(100, (cmp.totalFollowers / 10000) * 100).toFixed(1)
    : "0";
  const watchPct = Math.min(100, (cmp.watchMinutes60d / 600000) * 100).toFixed(1);

  const followerDisplay = cmp.totalFollowers != null
    ? `${formatNum(cmp.totalFollowers)} / 10,000`
    : "No data yet";

  let etaLabel = "—";
  if (cmp.totalFollowers != null && cmp.followersGained7d != null && cmp.followersGained7d > 0) {
    const dailyFollowerRate = cmp.followersGained7d / 7;
    const dailyWatchRate = cmp.watchMinutes60d / 60;
    const daysForFollowers = (10000 - cmp.totalFollowers) / dailyFollowerRate;
    const daysForWatch = Math.max(0, (600000 - cmp.watchMinutes60d) / Math.max(dailyWatchRate, 1));
    const daysTotal = Math.max(daysForFollowers, daysForWatch);
    etaLabel = `~${(daysTotal / 30).toFixed(1)} months to eligibility`;
  }

  return `
  <section class="cmp-section">
    <div class="cmp-header">
      <span class="cmp-label">Content Monetization Progress</span>
      <span class="cmp-eta">${escapeHtml(etaLabel)}</span>
    </div>
    <div class="cmp-bars">
      <div class="cmp-bar-group">
        <div class="cmp-bar-row">
          <span class="cmp-bar-name">Followers</span>
          <span class="cmp-bar-nums"><strong>${escapeHtml(followerDisplay)}</strong></span>
        </div>
        <div class="cmp-track"><div class="cmp-fill amber" style="width:${followerPct}%"></div></div>
      </div>
      <div class="cmp-bar-group">
        <div class="cmp-bar-row">
          <span class="cmp-bar-name">Watch Minutes (60d)</span>
          <span class="cmp-bar-nums"><strong>${formatNum(Math.round(cmp.watchMinutes60d))} / 600,000</strong></span>
        </div>
        <div class="cmp-track"><div class="cmp-fill blue" style="width:${watchPct}%"></div></div>
      </div>
    </div>
  </section>`;
}

function buildHeroHtml(
  dailyViews: DashboardData["dailyViews"],
  dailyFollowerGain: DashboardData["dailyFollowerGain"],
  sc: DashboardData["scorecard"],
  cmp: CmpProgress,
): string {
  const viewsDelta = sc.totalViews30d > 0
    ? ((sc.totalViews7d / (sc.totalViews30d / 4)) - 1) * 100 : 0;
  const engDelta = sc.avgEngRate30d > 0
    ? ((sc.avgEngRate7d / sc.avgEngRate30d) - 1) * 100 : 0;
  const followersDelta = (cmp.followersGained7d != null && cmp.followersGainedPrior7d != null && cmp.followersGainedPrior7d > 0)
    ? ((cmp.followersGained7d / cmp.followersGainedPrior7d) - 1) * 100 : null;

  const maxViews = Math.max(...dailyViews.map(d => d.views), 1);
  const bars = dailyViews.map(d => {
    const pct = (d.views / maxViews) * 100;
    const lbl = d.date.slice(5);
    return `<div class="bar-col" title="${escapeHtml(d.date)}: ${formatNum(d.views)} views">
      <div class="bar" style="height:${pct}%"></div>
      <div class="bar-lbl">${lbl}</div>
    </div>`;
  }).join("");

  const followersKpiValue = cmp.followersGained7d != null
    ? `+${formatNum(cmp.followersGained7d)}`
    : "—";
  const followersDeltaHtml = followersDelta != null
    ? deltaHtml(followersDelta)
    : `<span class="delta-flat">no prior data</span>`;

  let followerChartHtml: string;
  if (dailyFollowerGain.length === 0) {
    followerChartHtml = `<div class="empty" style="font-size:11px;padding:8px 0">No follower data yet</div>`;
  } else {
    const absGains = dailyFollowerGain.map(d => Math.abs(d.gain)).sort((a, b) => a - b);
    const p90 = absGains[Math.floor(absGains.length * 0.9)] ?? 1;
    const maxGain = Math.max(p90, 1);
    const gainBars = dailyFollowerGain.map(d => {
      const pct = Math.min((Math.abs(d.gain) / maxGain) * 100, 100);
      const lbl = d.date.slice(5);
      const color = d.gain >= 0 ? "var(--c-accent2)" : "#ef4444";
      const sign = d.gain >= 0 ? "+" : "";
      return `<div class="bar-col" title="${escapeHtml(d.date)}: ${sign}${d.gain} followers">
        <div class="bar" style="height:${pct}%;background:${color}"></div>
        <div class="bar-lbl">${lbl}</div>
      </div>`;
    }).join("");
    followerChartHtml = `<div class="bar-chart">${gainBars}</div>`;
  }

  return `
  <div class="hero">
    <div class="chart-card">
      <div class="chart-label">Daily views — last 30 days</div>
      <div class="bar-chart">${bars}</div>
      <div class="chart-label" style="margin-top:16px">Daily follower gain — last 30 days</div>
      ${followerChartHtml}
    </div>
    <div class="kpi-stack">
      <div class="kpi-card">
        <div class="kpi-label">Views (7d)</div>
        <div class="kpi-value">${formatNum(sc.totalViews7d)}</div>
        <div class="kpi-delta">${deltaHtml(viewsDelta)} vs avg week</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Engagement (7d)</div>
        <div class="kpi-value">${(sc.avgEngRate7d * 100).toFixed(2)}%</div>
        <div class="kpi-delta">${deltaHtml(engDelta)} vs 30d avg</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Reels Published</div>
        <div class="kpi-value">${sc.totalReels7d} <span class="kpi-sub">/ ${sc.totalReels30d}</span></div>
        <div class="kpi-delta kpi-flat">7d / 30d</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Followers Gained (7d)</div>
        <div class="kpi-value kpi-accent2">${escapeHtml(followersKpiValue)}</div>
        <div class="kpi-delta">${followersDeltaHtml} vs prior 7d</div>
      </div>
    </div>
  </div>`;
}

function buildReelListHtml(reels: ReelRow[], brandId: string): string {
  if (!reels.length) {
    return `<section class="reel-section"><div class="section-header"><span class="section-title">Reels — last 14 days</span></div><div class="empty">No reels with metrics yet</div></section>`;
  }

  const reelJson = JSON.stringify(reels.map(r => ({
    id: r.id,
    title: r.headline.slice(0, 80),
    score: r.overallScore,
    views: r.views,
    eng: r.engRate != null ? r.engRate * 100 : null,
    watchTime: r.watchTimeSec,
    followers: r.followersGained,
    theme: r.theme ?? "",
    published: r.publishedLabel ?? "",
    publishedTs: r.publishedAt ? new Date(r.publishedAt).getTime() : 0,
    color: r.overallScore == null ? "gray" : r.overallScore >= 1.2 ? "green" : r.overallScore >= 0.8 ? "yellow" : "red",
    href: `/review/reel/${r.id}`,
  })));

  return `
  <section class="reel-section">
    <div class="section-header">
      <span class="section-title">Reels — last 14 days</span>
      <div class="sort-controls">
        <button class="sort-btn active" onclick="sortReels('score',this)">Score</button>
        <button class="sort-btn" onclick="sortReels('views',this)">Views</button>
        <button class="sort-btn" onclick="sortReels('eng',this)">Eng %</button>
        <button class="sort-btn" onclick="sortReels('watchTime',this)">Watch Time</button>
        <button class="sort-btn" onclick="sortReels('followers',this)">Followers</button>
        <button class="sort-btn" onclick="sortReels('publishedTs',this)">Published</button>
      </div>
    </div>
    <div class="score-legend">
      <span class="legend-item"><span class="dot green"></span> ≥1.2x above target</span>
      <span class="legend-item"><span class="dot yellow"></span> ≥0.8x on target</span>
      <span class="legend-item"><span class="dot red"></span> below target</span>
      <span class="legend-item"><span class="dot gray"></span> no score yet</span>
    </div>
    <div class="reels-list" id="reelsList"></div>
    <script>var REEL_DATA = ${reelJson};</script>
  </section>`;
}

function buildBreakdownsHtml(breakdowns: DashboardData["breakdowns"]): string {
  const panels = [
    { id: "theme", title: "By Theme", rows: breakdowns.theme },
    { id: "voice", title: "By Voice", rows: breakdowns.voice },
    { id: "music", title: "By Music", rows: breakdowns.music },
  ];
  const mainPanels = panels.map(p => buildBreakdownPanel(p.id, p.title, p.rows)).join("");
  const timingPanel = buildBreakdownPanel("posting-time", "By Posting Time", breakdowns.postingTime);

  return `
  <section class="breakdowns">
    <div class="section-header"><span class="section-title">Breakdowns — last 30 days</span></div>
    <div class="breakdown-grid">${mainPanels}</div>
    <div class="breakdown-full">${timingPanel}</div>
  </section>`;
}

function buildBreakdownPanel(id: string, title: string, rows: BreakdownRow[]): string {
  if (!rows.length) {
    return `<div class="breakdown-panel"><div class="panel-header" onclick="togglePanel('panel-${id}')"><span class="panel-title">${title}</span><span class="panel-toggle">▾</span></div><div class="panel-body"><div class="empty">No data</div></div></div>`;
  }

  const maxEng = Math.max(...rows.map(r => r.avgEngRate ?? 0), 0.0001);
  const body = rows.map(r => {
    const engPct = r.avgEngRate != null ? `${(r.avgEngRate * 100).toFixed(2)}%` : "—";
    const barWidth = r.avgEngRate != null ? ((r.avgEngRate / maxEng) * 100).toFixed(1) : "0";
    const avgV = r.avgViews != null ? formatNum(Math.round(r.avgViews)) : "—";
    return `<div class="bar-row">
      <div class="bar-row-header">
        <span class="bar-row-label">${escapeHtml(r.value)}</span>
        <span class="bar-row-value">${engPct}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${barWidth}%"></div></div>
      <div class="bar-meta">${avgV} avg views · ${r.sampleCount} reels</div>
    </div>`;
  }).join("");

  return `
  <div class="breakdown-panel" id="panel-${id}">
    <div class="panel-header" onclick="togglePanel('panel-${id}')">
      <span class="panel-title">${title}</span>
      <span class="panel-toggle">▾</span>
    </div>
    <div class="panel-body">${body}</div>
  </div>`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function deltaHtml(pct: number): string {
  if (Math.abs(pct) < 0.5) return `<span class="delta-flat">—</span>`;
  const cls = pct > 0 ? "delta-up" : "delta-down";
  const sign = pct > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
}

const DASHBOARD_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--c-bg); color: #e0e0e0; line-height: 1.5; }
  .shell { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }

  /* Header */
  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .topbar-left { display: flex; align-items: center; gap: 10px; }
  .brand-logo { height: 36px; width: 36px; object-fit: contain; border-radius: 6px; flex-shrink: 0; }
  .topbar-title { font-size: 15px; font-weight: 600; color: #aaa; }
  .topbar-title strong { color: #fff; }
  .brand-switch { display: flex; gap: 6px; }
  .brand-switch a { padding: 5px 14px; border-radius: 5px; font-size: 12px; font-weight: 500; text-decoration: none; }
  .brand-switch a.active { background: var(--c-accent); color: #fff; }
  .brand-switch a:not(.active) { background: var(--c-card); color: #666; border: 1px solid var(--c-border); }

  /* Data health */
  .sub-header { display: flex; justify-content: flex-end; margin-bottom: 8px; }
  .health-card { display: inline-flex; }
  .health-row { display: flex; gap: 6px; align-items: center; }
  .health-item { display: inline-flex; align-items: center; gap: 5px; background: var(--c-inner); border: 1px solid var(--c-border); border-radius: 6px; padding: 3px 8px; font-size: 10px; }
  .health-item.warning { border-color: #e8a02044; }
  .health-item.critical, .health-item.missing { border-color: #ef444444; }
  .health-label { font-size: 10px; font-weight: 600; color: #aaa; white-space: nowrap; }
  .health-pill { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; padding: 1px 5px; border-radius: 999px; }
  .health-pill.ok { color: #22c55e; background: #22c55e18; }
  .health-pill.warning { color: #e8a020; background: #e8a02018; }
  .health-pill.critical, .health-pill.missing { color: #ef4444; background: #ef444418; }

  /* CMP */
  .cmp-section { background: var(--c-card); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
  .cmp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .cmp-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .8px; }
  .cmp-eta { font-size: 11px; color: #eab308; font-weight: 500; }
  .cmp-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .cmp-bar-group { display: flex; flex-direction: column; gap: 5px; }
  .cmp-bar-row { display: flex; justify-content: space-between; }
  .cmp-bar-name { font-size: 12px; color: #ccc; }
  .cmp-bar-nums { font-size: 11px; color: #888; }
  .cmp-bar-nums strong { color: #ccc; }
  .cmp-track { background: var(--c-inner); border-radius: 4px; height: 8px; }
  .cmp-fill { height: 8px; border-radius: 4px; }
  .cmp-fill.amber { background: linear-gradient(90deg, #78350f, #eab308); }
  .cmp-fill.blue { background: linear-gradient(90deg, var(--c-accent-dim), var(--c-accent)); }

  /* Hero */
  .hero { display: grid; grid-template-columns: 1fr 220px; gap: 16px; margin-bottom: 28px; }
  .chart-card { background: var(--c-card); border: 1px solid var(--c-border); border-radius: 12px; padding: 20px; }
  .chart-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 16px; }
  .bar-chart { display: flex; align-items: flex-end; gap: 3px; height: 100px; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; cursor: default; }
  .bar { width: 100%; background: var(--c-bar); border-radius: 3px 3px 0 0; min-height: 2px; transition: background .15s; }
  .bar:hover { background: var(--c-accent); }
  .bar-lbl { font-size: 8px; color: #777; margin-top: 4px; }
  .kpi-stack { display: flex; flex-direction: column; gap: 10px; }
  .kpi-card { background: var(--c-card); border: 1px solid var(--c-border); border-radius: 10px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .kpi-sub { font-size: 14px; color: #777; font-weight: 400; }
  .kpi-accent2 { color: var(--c-accent2); }
  .kpi-delta { font-size: 11px; margin-top: 3px; }
  .kpi-flat { color: #555; }
  .delta-up { color: #22c55e; }
  .delta-down { color: #ef4444; }
  .delta-flat { color: #555; }

  /* Reel section */
  .reel-section { margin-bottom: 28px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .section-title { font-size: 12px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .8px; }
  .sort-controls { display: flex; gap: 6px; }
  .sort-btn { padding: 4px 10px; font-size: 11px; border-radius: 4px; border: 1px solid var(--c-border); background: var(--c-card); color: #999; cursor: pointer; }
  .sort-btn.active { background: var(--c-accent-dim); border-color: var(--c-accent); color: var(--c-accent-text); }
  .score-legend { display: flex; gap: 14px; margin-bottom: 12px; font-size: 10px; color: #888; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .dot.green { background: #22c55e; } .dot.yellow { background: #eab308; }
  .dot.red { background: #ef4444; } .dot.gray { background: #333; }
  .reels-list { display: flex; flex-direction: column; gap: 8px; }
  .reel-card { display: flex; align-items: center; background: var(--c-card); border: 1px solid var(--c-border); border-radius: 8px; overflow: hidden; text-decoration: none; color: inherit; }
  .reel-card:hover { border-color: var(--c-accent); }
  .reel-stripe { width: 4px; align-self: stretch; flex-shrink: 0; }
  .reel-stripe.green { background: #22c55e; } .reel-stripe.yellow { background: #eab308; }
  .reel-stripe.red { background: #ef4444; } .reel-stripe.gray { background: #272b3a; }
  .reel-body { display: flex; align-items: center; gap: 12px; padding: 11px 16px; flex: 1; min-width: 0; }
  .reel-score { width: 44px; flex-shrink: 0; text-align: center; }
  .score-badge { display: inline-block; padding: 3px 6px; border-radius: 5px; font-size: 11px; font-weight: 700; }
  .score-badge.green { background: #22c55e1a; color: #22c55e; border: 1px solid #22c55e33; }
  .score-badge.yellow { background: #eab3081a; color: #eab308; border: 1px solid #eab30833; }
  .score-badge.red { background: #ef44441a; color: #ef4444; border: 1px solid #ef444433; }
  .score-badge.gray { background: var(--c-inner); color: #555; border: 1px solid var(--c-border); }
  .reel-headline { flex: 1; min-width: 0; }
  .reel-title { font-size: 13px; color: #d0d0d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .reel-chips { display: flex; gap: 5px; margin-top: 4px; }
  .chip { font-size: 9px; padding: 2px 7px; border-radius: 3px; background: var(--c-inner); color: #888; border: 1px solid var(--c-border); text-transform: uppercase; }
  .chip.dim { color: #888; text-transform: none; }
  .reel-metrics { display: flex; gap: 16px; flex-shrink: 0; }
  .metric { text-align: right; }
  .metric-val { font-size: 13px; font-weight: 600; color: #c0c0c0; }
  .metric-val.blue { color: var(--c-accent-text); }
  .metric-val.accent2 { color: var(--c-accent2); }
  .metric-lbl { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: .4px; margin-top: 1px; }

  /* Breakdowns */
  .breakdowns { margin-top: 8px; }
  .breakdown-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .breakdown-full { }
  .breakdown-panel { background: var(--c-card); border: 1px solid var(--c-border); border-radius: 10px; overflow: hidden; }
  .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid var(--c-border); user-select: none; }
  .panel-header:hover { background: var(--c-accent-dim); opacity: 0.8; }
  .panel-title { font-size: 11px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .7px; }
  .panel-toggle { font-size: 11px; color: #777; transition: transform .2s; }
  .panel-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; }
  .breakdown-panel.collapsed .panel-body { display: none; }
  .breakdown-panel.collapsed .panel-toggle { transform: rotate(-90deg); }
  .bar-row { display: flex; flex-direction: column; gap: 3px; }
  .bar-row-header { display: flex; justify-content: space-between; align-items: baseline; }
  .bar-row-label { font-size: 12px; color: #c0c0c0; }
  .bar-row-value { font-size: 11px; font-weight: 600; color: var(--c-accent-text); }
  .bar-track { background: var(--c-inner); border-radius: 3px; height: 6px; }
  .bar-fill { height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--c-accent-dim), var(--c-accent)); }
  .bar-meta { font-size: 9px; color: #777; }

  .empty { color: #888; font-size: 13px; padding: 16px 0; }

  @media (max-width: 768px) {
    .hero { grid-template-columns: 1fr; }
    .kpi-stack { display: grid; grid-template-columns: 1fr 1fr; }
    .sub-header { justify-content: flex-start; }
    .health-row { flex-wrap: wrap; }
    .cmp-bars { grid-template-columns: 1fr; }
    .breakdown-grid { grid-template-columns: 1fr; }
  }
`;

const DASHBOARD_JS = `<script>
function eh(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sc(s){return s===null?'gray':s>=1.2?'green':s>=0.8?'yellow':'red';}
function st(s){return s===null?'—':s.toFixed(2)+'x';}
function fv(v){return v===null?'—':v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(Math.round(v));}
function fe(e){return e===null?'—':e.toFixed(1)+'%';}
function fw(w){return w===null?'—':Math.round(w)+'s';}
function ff(f){return f===null?'—':f>0?'+'+f:String(f);}

function renderReels(sorted){
  const list=document.getElementById('reelsList');
  if(!list)return;
  list.innerHTML=sorted.map(r=>\`
    <a class="reel-card" href="\${eh(r.href)}">
      <div class="reel-stripe \${r.color}"></div>
      <div class="reel-body">
        <div class="reel-score"><span class="score-badge \${sc(r.score)}">\${st(r.score)}</span></div>
        <div class="reel-headline">
          <div class="reel-title">\${eh(r.title)}</div>
          <div class="reel-chips">
            \${r.theme?'<span class="chip">'+eh(r.theme)+'</span>':''}
            \${r.published?'<span class="chip dim">'+eh(r.published)+'</span>':''}
          </div>
        </div>
        <div class="reel-metrics">
          <div class="metric"><div class="metric-val">\${fv(r.views)}</div><div class="metric-lbl">Views</div></div>
          <div class="metric"><div class="metric-val">\${fe(r.eng)}</div><div class="metric-lbl">Eng</div></div>
          <div class="metric"><div class="metric-val blue">\${fw(r.watchTime)}</div><div class="metric-lbl">Watch</div></div>
          <div class="metric"><div class="metric-val accent2">\${ff(r.followers)}</div><div class="metric-lbl">Followers</div></div>
        </div>
      </div>
    </a>\`).join('');
}

function sortReels(by,btn){
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderReels([...REEL_DATA].sort((a,b)=>((b[by]??-Infinity)-(a[by]??-Infinity))));
}

function togglePanel(id){document.getElementById(id).classList.toggle('collapsed');}

if(typeof REEL_DATA!=='undefined')renderReels(REEL_DATA);
</script>`;
