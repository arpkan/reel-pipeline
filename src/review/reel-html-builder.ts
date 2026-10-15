import type { ReelCategory, ReelContext, RunContext, BrandConfig, CategorySource } from "../types.js";
import type { TrendingSignals } from "../services/trending.js";
import { escapeHtml, statusBadgeHtml, statusFooterText, stageLogsHtml, brandThemeCss, brandLogoHtml } from "./utils.js";
import { buildTrendingSection } from "./html-builder.js";
import { buildReelCaption } from "../pipeline/reel-runner.js";
import { getUiStrings, type UiLang } from "../i18n/ui-strings.js";

export function buildReelReviewHtml(ctx: ReelContext): string {
  const language = ctx.brand.language as UiLang;
  const S = getUiStrings(language);
  const title = `${ctx.brand.name} Reel — ${ctx.runDate}`;

  const story  = ctx.story!;
  const script = ctx.script!;
  const sourceUrlIsHttp = /^https?:\/\//i.test(story.sourceUrl);

  // Post caption — shares buildReelCaption with the command-listener approve handler and reel-scheduler
  const hashtags = script.hashtags?.length ? script.hashtags : [];
  const { caption, sourceComment } = buildReelCaption(story.headline, hashtags, story.sourceUrl, ctx.brand.postSourceAsComment ?? false);

  // Discovery context — may be passed directly on ctx or as a serialised `context` blob from DB
  const reelContext = (ctx as ReelContext & { context?: unknown }).context as {
    trendingSignals?: TrendingSignals;
    categorySource?: CategorySource; discoveryBias?: string; recentTopics?: string[];
    inputMode?: "manual_text" | "manual_hint" | "url" | "discovery";
    manualSourceLabel?: string;
    manualTextProvided?: boolean;
    manualTextInputType?: "pasted" | "txt_upload";
    sourceReadMode?: "tavily_extract" | "url_model_read";
    sourceExtractAvailable?: boolean;
    sourceExtractChars?: number;
    sourceExtractDownloadUrl?: string;
    stage5Renderer?: ReelContext["stage5Renderer"];
    stage5Template?: ReelContext["stage5Template"];
    stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
  } | undefined;
  const trendingSignals = ctx.trendingSignals ?? reelContext?.trendingSignals;
  const categorySource  = ctx.categorySource ?? reelContext?.categorySource;
  const discoveryBias   = ctx.discoveryBias  ?? reelContext?.discoveryBias;
  const recentTopics    = ctx.recentTopics   ?? reelContext?.recentTopics ?? [];

  const discoveryCtx: RunContext = {
    runId:           ctx.runId,
    brand:           ctx.brand as BrandConfig,
    runDate:         ctx.runDate,
    theme:           ctx.theme,
    trendingSignals,
    stories:         [],
    posts:           [],
    stageLogs:       [],
    status:          ctx.status as RunContext["status"],
  };

  // ── Category Discovery panel ────────────────────────────────────────────────
  const categorySourceLabels: Record<string, string> = {
    scheduled:  "🕐 Scheduled slot",
    manual:     "👤 Manual (!reel)",
    rerescript: "🔄 Rerescript",
  };
  const categorySourceLabel = categorySource ? categorySourceLabels[categorySource] ?? categorySource : undefined;

  // Category badge
  const category: ReelCategory = (script.category ?? ctx.category ?? "open") as ReelCategory;
  const categoryMeta: Record<ReelCategory, { emoji: string; label: string; color: string }> = {
    breaking:       { emoji: "🔴", label: "Breaking",       color: "#c0392b" },
    trending:       { emoji: "📈", label: "Trending",       color: "#2980b9" },
    human_interest: { emoji: "❤️",  label: "Human Interest", color: "#8e44ad" },
    business:       { emoji: "💼", label: "Business",       color: "#16a085" },
    open:           { emoji: "🎯", label: "Open",           color: "#555" },
  };
  const catMeta = categoryMeta[category] ?? categoryMeta.open;
  const categoryBadge = `<span style="display:inline-block;background:${catMeta.color};color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;letter-spacing:0.04em;">${catMeta.emoji} ${catMeta.label.toUpperCase()}</span>`;

  // Per-run metadata
  const voiceSpeed  = ctx.usedVoiceSpeed ?? ctx.brand.reels?.voiceSpeed ?? 1.2;
  const voiceId     = ctx.usedVoiceId ?? "auto";
  const voiceProvider = ctx.usedVoiceProvider ?? "auto";
  const providerLabels: Record<string, string> = { elevenlabs: "ElevenLabs", uvoice: "uVoice", minimax: "Minimax", botnoi: "Botnoi" };
  const providerLabel = providerLabels[voiceProvider] ?? voiceProvider;
  const sceneCount  = script.scenes.length;
  const musicVol    = ctx.brand.reels?.musicVolume ?? 0.13;
  const effectLabel = ctx.usedCameraEffect ?? ctx.cameraEffect ?? (language === "th" ? "อัตโนมัติ" : "Auto");
  const presetLabel = ctx.usedCameraPreset ?? ctx.cameraPreset ?? undefined;
  const renderTelemetry = ctx.stage5RenderTelemetry ?? reelContext?.stage5RenderTelemetry;
  const rendererLabel = ctx.stage5Renderer ?? renderTelemetry?.renderer ?? reelContext?.stage5Renderer ?? "hyperframes";
  const templateLabel = ctx.stage5Template ?? renderTelemetry?.template ?? reelContext?.stage5Template ?? "n/a";
  const renderProfileParts = [
    ...(typeof renderTelemetry?.fps === "number" ? [`${renderTelemetry.fps}fps`] : []),
    ...(renderTelemetry?.quality ? [renderTelemetry.quality] : []),
  ];
  const renderProfile = renderProfileParts.length > 0 ? renderProfileParts.join(" · ") : "n/a";
  const renderTime = typeof renderTelemetry?.durationMs === "number"
    ? `${(renderTelemetry.durationMs / 1000).toFixed(1)}s`
    : "n/a";
  const effectIcon: Record<string, string> = {
    zoom_in: "🔍", zoom_out: "🔎", pan_left: "◀️", pan_right: "▶️",
    pan_up: "⬆️", pan_down: "⬇️", ken_burns: "🎥", none: "⏹️",
    auto: "🔄", "อัตโนมัติ": "🔄",
  };
  const presetIcon: Record<string, string> = {
    cinematic_drift: "🎬", urgent_push: "⚡", slow_reveal: "🔍",
    documentary_slide: "📽️", portrait_float: "🌀", locked_frame: "⏹️",
  };

  const scenesHtml = script.scenes.map((scene) => {
    // Rebuild subtitle blocks for display — must match splitIntoBlocks logic in reel-stage4-assemble.ts
    const SENT_END   = /[.!?।…]+$/;
    const CLAUSE_BR  = /[,;:]+$/;
    const SOLO_PUNCT = /^[.!?।…,;:]+$/;
    const THAI_RE    = /[\u0E00-\u0E7F]/;
    const MAX_THAI_CHARS_HTML = 20;
    const wtList = scene.wordTimings ?? [];
    const isThaiScene = wtList.length > 0 && THAI_RE.test(wtList[0].word);
    const blocks: string[][] = [];
    let cur: string[] = [];
    let curChars = 0;
    for (const wt of wtList) {
      if (SOLO_PUNCT.test(wt.word.trim())) {
        const target = cur.length > 0 ? cur : blocks[blocks.length - 1];
        if (target) { target[target.length - 1] = target[target.length - 1] + wt.word; }
        if (SENT_END.test(wt.word) && cur.length > 0) { blocks.push(cur); cur = []; curChars = 0; }
        continue;
      }
      cur.push(wt.word);
      curChars += wt.word.length;
      const isSentEnd  = SENT_END.test(wt.word);
      const isClause   = !isSentEnd && CLAUSE_BR.test(wt.word);
      const maxReached = isThaiScene ? curChars >= MAX_THAI_CHARS_HTML : cur.length >= 6;
      const softBreak  = isThaiScene ? (isClause && curChars >= 8) : (isClause && cur.length >= 4);
      if (isSentEnd || maxReached || softBreak) { blocks.push(cur); cur = []; curChars = 0; }
    }
    if (cur.length > 0) blocks.push(cur);

    const joiner = isThaiScene ? "" : " ";
    const blocksHtml = blocks.length > 0
      ? `<div class="subtitle-blocks">${
          blocks.map(b => `<span class="subtitle-block">${escapeHtml(b.join(joiner))}</span>`).join("")
        }</div>`
      : `<div class="no-timings">${S.noTimings}</div>`;

    const audioDur   = scene.durationSeconds ?? 0;
    const totalDur   = 2.0 + audioDur;
    const hookLabel  = S.hookCaption;
    const voLabel    = S.voiceover;
    const blockLabel = S.subtitleBlocks;

    return `
    <div class="scene">
      <div class="scene-header">
        <span class="scene-num">${S.scene} ${scene.sceneNumber}${buildSceneSourceBadge(ctx.imageSourceMap?.[scene.sceneNumber])}</span>
        <span class="scene-dur">2s + ${audioDur.toFixed(1)}s = ${totalDur.toFixed(1)}s</span>
      </div>
      <div class="field-label">${hookLabel}</div>
      <div class="scene-caption">${escapeHtml(scene.caption)}</div>
      <div class="field-label">${voLabel}</div>
      <div class="scene-voiceover">${escapeHtml(scene.voiceover)}</div>
      <div class="field-label">${blockLabel}</div>
      ${blocksHtml}
      ${scene.imagePrompt ? `<details class="prompt-details"><summary>🎨 Image prompt</summary><p>${escapeHtml(scene.imagePrompt)}</p></details>` : ""}
    </div>`;
  }).join("\n");

  const syncExplainer = `<div class="sync-explainer">
        <h4>${S.syncExplainerHeading}</h4>
        <div class="sync-step"><span class="dot">1.</span><span>${S.syncExplainerSteps[0]}</span></div>
        <div class="sync-step"><span class="dot">2.</span><span>${S.syncExplainerSteps[1]}</span></div>
        <div class="sync-step"><span class="dot">3.</span><span>${S.syncExplainerSteps[2]}</span></div>
        <div class="sync-step"><span class="dot">4.</span><span>${S.syncExplainerSteps[3]}</span></div>
      </div>`;

  const brandId = ctx.brand.id;
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    ${brandThemeCss(brandId)}
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--c-bg); color: #e0e0e0;
           margin: 0; padding: 0 0 40px; }

    header { background: linear-gradient(135deg, var(--c-accent-dim) 0%, #0d1020 100%); border-bottom: 2px solid var(--c-accent);
             color: white; padding: 18px 28px; display: flex; align-items: center;
             justify-content: space-between; gap: 14px; flex-wrap: wrap; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-logo { height: 44px; width: 44px; object-fit: contain; border-radius: 8px; flex-shrink: 0; }
    .header-text .brand { font-size: 20px; font-weight: 700; }
    .header-text .meta  { font-size: 13px; opacity: 0.65; margin-top: 2px; }
    .status-badge { font-size: 11px; font-weight: 700; padding: 3px 10px;
                    border-radius: 20px; letter-spacing: 0.04em; }

    .layout { max-width: 1100px; margin: 0 auto; padding: 24px 20px;
              display: grid; grid-template-columns: 380px 1fr; gap: 24px; align-items: start; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }

    /* ── Left column ── */
    .video-panel { background: var(--c-card); border-radius: 14px; overflow: hidden; }
    .video-panel video { width: 100%; display: block; background: #000; }
    .video-meta { padding: 14px 16px 16px; }
    .headline { font-size: 14px; font-weight: 700; color: #fff; line-height: 1.4; margin-bottom: 6px; }
    .source-link { font-size: 11px; color: var(--c-accent-text); text-decoration: none; word-break: break-all; }
    .source-link:hover { text-decoration: underline; }

    /* Run metadata card */
    .meta-card { background: var(--c-card); border-radius: 14px; padding: 14px 16px; margin-top: 14px; }
    .meta-row { display: flex; justify-content: space-between; font-size: 12px;
                padding: 5px 0; border-bottom: 1px solid var(--c-border); }
    .meta-row:last-child { border-bottom: none; }
    .meta-key   { color: #666; }
    .meta-value { color: #ccc; font-weight: 600; }

    /* Caption preview */
    .caption-card { background: var(--c-card); border-radius: 14px; padding: 16px; margin-top: 14px; }
    .card-title { font-size: 11px; font-weight: 700; color: var(--c-accent-text); text-transform: uppercase;
                  letter-spacing: 0.07em; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
    .card-title svg { flex-shrink: 0; }
    .caption-body { white-space: pre-wrap; font-size: 13px; color: #ccc; line-height: 1.6;
                    background: var(--c-bg); border-radius: 8px; padding: 12px; word-break: break-word; }

    /* Stage logs (dark variant) */
    .stage-logs-details { background: var(--c-card); border-radius: 10px; margin-top: 14px;
                          border: 1px solid var(--c-border); overflow: hidden; }
    .stage-logs-details summary { color: var(--c-accent-text); background: transparent;
                                   box-shadow: none; border-bottom: 1px solid var(--c-border); }
    .stage-logs-details summary::before { color: var(--c-accent-text); }
    .stage-logs-body { padding: 10px 16px; }
    .stage-row { display: flex; align-items: baseline; gap: 8px; padding: 4px 0;
                 border-bottom: 1px solid var(--c-border); font-size: 12px; flex-wrap: wrap; }
    .stage-row:last-child { border-bottom: none; }
    .stage-icon { flex-shrink: 0; }
    .stage-name { color: #ccc; flex: 1; font-family: monospace; }
    .stage-dur  { color: #555; min-width: 48px; text-align: right; }
    .stage-error { width: 100%; color: #ef9a9a; font-size: 11px; padding: 4px 8px;
                   background: rgba(183,28,28,0.2); border-radius: 4px; margin-top: 2px; }

    /* ── Right column ── */
    .script-panel { background: var(--c-card); border-radius: 14px; padding: 18px; }
    .script-heading { font-size: 13px; font-weight: 700; color: var(--c-accent-text); text-transform: uppercase;
                      letter-spacing: 0.06em; margin-bottom: 16px; }
    .video-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 18px;
                   padding-bottom: 14px; border-bottom: 1px solid var(--c-border); }

    .scene { border-left: 3px solid var(--c-accent-dim); padding: 12px 14px; margin-bottom: 14px;
             background: var(--c-bg); border-radius: 0 8px 8px 0; }
    .scene:hover { border-left-color: var(--c-accent); }
    .scene-header { display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 10px; flex-wrap: wrap; gap: 6px; }
    .scene-num  { font-size: 11px; font-weight: 700; color: var(--c-accent-text); text-transform: uppercase; }
    .scene-dur  { font-size: 11px; color: #555; }
    .field-label { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase;
                   letter-spacing: 0.06em; margin: 8px 0 3px; }
    .scene > .field-label:first-of-type { margin-top: 0; }
    .scene-caption   { font-size: 14px; font-weight: 700; color: #fff; line-height: 1.4; }
    .scene-voiceover { font-size: 13px; color: #aaa; line-height: 1.55; }

    .subtitle-blocks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .subtitle-block  { font-size: 11px; background: rgba(0,0,0,0.5); color: rgba(255,255,255,0.55);
                       border: 1px solid var(--c-border); padding: 3px 8px; border-radius: 4px;
                       font-family: monospace; }
    .no-timings { font-size: 11px; color: #444; font-style: italic; margin-top: 4px; }
    .prompt-details { margin-top: 8px; }
    .prompt-details summary { font-size: 10px; color: #555; cursor: pointer; user-select: none; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 700; }
    .prompt-details summary:hover { color: var(--c-accent-text); }
    .prompt-details p { font-size: 11px; color: #888; line-height: 1.6; margin: 6px 0 0; white-space: pre-wrap; background: var(--c-inner); padding: 8px 10px; border-radius: 4px; border: 1px solid var(--c-border); }

    .sync-explainer { background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 10px;
                      padding: 14px; margin-top: 16px; }
    .sync-explainer h4 { font-size: 12px; font-weight: 700; color: var(--c-accent-text); margin: 0 0 10px;
                         text-transform: uppercase; letter-spacing: 0.06em; }
    .sync-step { font-size: 12px; color: #888; margin-bottom: 6px; display: flex; gap: 8px; }
    .sync-step .dot { width: 20px; flex-shrink: 0; color: var(--c-accent-text); font-weight: 700; }

    footer { background: var(--c-inner); color: #5a7a9a; text-align: center;
             padding: 16px; font-size: 13px; margin-top: 32px; }

    /* Discovery panels */
    .discovery-panels details { background: var(--c-card); border-radius: 10px;
      box-shadow: none; border: 1px solid var(--c-border); margin-bottom: 10px; overflow: hidden; }
    .discovery-panels details[open] summary { border-bottom: 1px solid var(--c-border); }
    .discovery-panels summary { padding: 10px 14px; font-size: 12px; font-weight: 700;
      color: var(--c-accent-text); cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
      background: transparent; box-shadow: none; }
    .discovery-panels summary::-webkit-details-marker { display: none; }
    .discovery-panels summary::before { content: "▶"; font-size: 10px; color: var(--c-accent-text); transition: transform 0.15s; }
    .discovery-panels details[open] summary::before { transform: rotate(90deg); }
    .discovery-panels .panel-body { padding: 12px 14px; font-size: 12px; line-height: 1.6; color: #ccc; }
    .discovery-panels .panel-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 5px; }
    .discovery-panels .panel-label { color: #555; min-width: 100px; flex-shrink: 0; }
    .discovery-panels .panel-value { color: #ccc; }
    .discovery-panels .pill { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 12px; margin: 1px 2px; }
    .discovery-panels .pill-blue  { background: var(--c-accent-dim); color: var(--c-accent-text); }
    .discovery-panels .pill-green { background: #1a3a2a; color: #6abf88; }
    .discovery-panels .pill-amber { background: #3a2a0a; color: #d4a84b; }
    .discovery-panels .pill-grey  { background: var(--c-inner); color: #888; border: 1px solid var(--c-border); }
    .discovery-panels .signals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .discovery-panels .signal-col h4 { margin: 0 0 5px; font-size: 11px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .discovery-panels .signal-col ul { margin: 0; padding: 0 0 0 12px; color: #aaa; font-size: 11px; }
    .discovery-panels .signal-col li { margin-bottom: 2px; }
    .discovery-panels .signal-filter-note { font-size: 11px; color: #d4a84b; margin-bottom: 8px; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      ${brandLogoHtml(brandId, "header-logo")}
      <div class="header-text">
        <div class="brand">${escapeHtml(ctx.brand.name)} Reel</div>
        <div class="meta">${escapeHtml(ctx.runDate)} · ${escapeHtml(story.source)}</div>
      </div>
    </div>
    ${statusBadgeHtml(ctx.status, ctx.brand.language)}
  </header>

  <div class="layout">

    <!-- ── Left: Video + metadata + caption + stage logs ── -->
    <div>
      <div class="video-panel">
        <video controls playsinline>
          <source src="${escapeHtml(ctx.videoGcsUrl ?? "")}" type="video/mp4">
        </video>
        <div class="video-meta">
          <div style="margin-bottom:6px;">${categoryBadge}</div>
          <div class="headline">${escapeHtml(story.headline)}</div>
          ${sourceUrlIsHttp
            ? `<a class="source-link" href="${escapeHtml(story.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.sourceUrl)}</a>`
            : `<span class="source-link">${escapeHtml(story.sourceUrl)}</span>`}
        </div>
      </div>

      <!-- Run metadata -->
      <div class="meta-card">
        <div class="meta-row"><span class="meta-key">${S.category}</span><span class="meta-value">${catMeta.emoji} ${catMeta.label}</span></div>
        <div class="meta-row"><span class="meta-key">${S.voice}</span><span class="meta-value">${voiceId} (${providerLabel})</span></div>
        <div class="meta-row"><span class="meta-key">${S.voiceSpeed}</span><span class="meta-value">${voiceSpeed}×</span></div>
        <div class="meta-row"><span class="meta-key">${S.scenes}</span><span class="meta-value">${sceneCount}</span></div>
        <div class="meta-row"><span class="meta-key">${S.musicVolume}</span><span class="meta-value">${musicVol}</span></div>
        <div class="meta-row"><span class="meta-key">${S.music}</span><span class="meta-value">${ctx.musicFile ?? S.noneLabel}</span></div>
        <div class="meta-row"><span class="meta-key">${S.language}</span><span class="meta-value">${ctx.brand.language.toUpperCase()}</span></div>
        <div class="meta-row"><span class="meta-key">${S.cameraEffect}</span><span class="meta-value">${effectIcon[effectLabel] ?? "🎬"} ${effectLabel} ${presetLabel ? `<span style="display:inline-block;background:#4a5568;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;letter-spacing:0.04em;">${presetIcon[presetLabel] ?? "🎬"} ${(presetLabel ?? "").toUpperCase()}</span>` : ""}</span></div>
        <div class="meta-row"><span class="meta-key">Renderer</span><span class="meta-value">${escapeHtml(rendererLabel)}</span></div>
        <div class="meta-row"><span class="meta-key">Template</span><span class="meta-value">${escapeHtml(templateLabel)}</span></div>
        <div class="meta-row"><span class="meta-key">Render profile</span><span class="meta-value">${escapeHtml(renderProfile)}</span></div>
        <div class="meta-row"><span class="meta-key">Render time</span><span class="meta-value">${escapeHtml(renderTime)}</span></div>
      </div>

      <!-- Caption preview -->
      <div class="caption-card">
        <div class="card-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent-text)" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          ${S.postCaption}
        </div>
        <div class="caption-body">${escapeHtml(caption)}</div>
        ${sourceComment ? `<div class="caption-body" style="margin-top:8px; opacity:0.75; font-size:12px;">📌 ${S.willPostAsFirstComment}: ${escapeHtml(sourceComment)}</div>` : ""}
      </div>

      <!-- Discovery panels -->
      <div class="discovery-panels" style="margin-top:14px;">
        ${buildCategoryDiscoveryPanel(category, catMeta, categorySourceLabel, discoveryBias, story.selectionReason, recentTopics, language, ctx.useStockImages)}
        ${buildManualSourcePanel(story.sourceUrl, {
          inputMode: reelContext?.inputMode ?? (ctx.manualSourceMode === "text" ? "manual_text" : ctx.manualSourceMode === "hint" ? "manual_hint" : undefined),
          manualSourceLabel: reelContext?.manualSourceLabel ?? (!/^https?:\/\//i.test(ctx.manualSourceInput ?? "") ? ctx.manualSourceInput : undefined),
          manualTextProvided: reelContext?.manualTextProvided ?? Boolean(ctx.manualSourceMode),
          manualTextInputType: reelContext?.manualTextInputType ?? ctx.manualSourceTextInputType,
          sourceReadMode: reelContext?.sourceReadMode ?? story.sourceReadMode,
          sourceExtractAvailable: reelContext?.sourceExtractAvailable ?? story.sourceExtractAvailable,
          sourceExtractChars: reelContext?.sourceExtractChars ?? story.sourceExtractChars,
          sourceExtractDownloadUrl: reelContext?.sourceExtractDownloadUrl ?? story.sourceExtractDownloadUrl,
        }, language)}
        ${ctx.theme ? buildReelThemePanel(ctx.theme) : ""}
        ${buildTrendingSection(discoveryCtx, ctx.brand as BrandConfig)}
        ${buildApiSourcePanel(ctx.apiSourceMap, language)}
      </div>

      <!-- Stage logs -->
      ${stageLogsHtml(ctx.stageLogs ?? [], ctx.brand.language)}
    </div>

    <!-- ── Right: Script + subtitle sync explainer ── -->
    <div class="script-panel">
      <div class="script-heading">${S.reelScript}</div>
      <div class="video-title">${escapeHtml(script.title)}</div>
      ${scenesHtml}
      ${syncExplainer}
    </div>

  </div>

  <footer>${statusFooterText(ctx.status, ctx.brand.language)}</footer>
</body>
</html>`;
}

function buildCategoryDiscoveryPanel(
  category: ReelCategory,
  catMeta: { emoji: string; label: string; color: string },
  categorySourceLabel: string | undefined,
  discoveryBias: string | undefined,
  selectionReason: string | undefined,
  recentTopics: string[],
  language: string,
  useStockImages: boolean | undefined,
): string {
  const S = getUiStrings(language as UiLang);
  const categoryBadge = `<span style="display:inline-block;background:${catMeta.color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">${catMeta.emoji} ${catMeta.label.toUpperCase()}</span>`;
  const sourceTag = categorySourceLabel
    ? ` <span class="pill pill-grey">${escapeHtml(categorySourceLabel)}</span>`
    : "";

  const stockRow = `<div class="panel-row">
    <span class="panel-label">Stock Images</span>
    <span class="panel-value">
      ${useStockImages !== false 
        ? `<span class="pill pill-green">On</span>` 
        : `<span class="pill pill-amber">Off</span>`}
    </span>
  </div>`;

  const biasRow = discoveryBias
    ? `<div class="panel-row">
        <span class="panel-label">${S.discoveryBias}</span>
        <span class="panel-value" style="color:#aaa;font-style:italic">${escapeHtml(discoveryBias)}</span>
      </div>`
    : "";

  const reasonRow = selectionReason
    ? `<div class="panel-row">
        <span class="panel-label">${S.selectionReason}</span>
        <span class="panel-value">${escapeHtml(selectionReason)}</span>
      </div>`
    : "";

  const topicsRow = recentTopics.length
    ? `<div class="panel-row">
        <span class="panel-label">${S.topicsAvoided}</span>
        <span class="panel-value">
          <ul style="margin:2px 0 0 0;padding-left:14px;color:#888;font-size:11px;">
            ${recentTopics.map((t) => `<li>${escapeHtml(t.slice(0, 80))}</li>`).join("")}
          </ul>
        </span>
      </div>`
    : "";

  return `<details open>
  <summary>🎯 ${S.categoryDiscovery}</summary>
  <div class="panel-body">
    <div class="panel-row">
      <span class="panel-label">${S.category}</span>
      <span class="panel-value">${categoryBadge}${sourceTag}</span>
    </div>
    ${stockRow}
    ${biasRow}
    ${reasonRow}
    ${topicsRow}
  </div>
</details>`;
}

function buildReelThemePanel(theme: string): string {
  return `<details>
  <summary>🏷️ Theme</summary>
  <div class="panel-body">
    <div class="panel-row">
      <span class="panel-label">Theme</span>
      <span class="panel-value"><strong>${escapeHtml(theme)}</strong></span>
    </div>
  </div>
</details>`;
}

function buildManualSourcePanel(
  storySourceUrl: string,
  reelContext: {
    inputMode?: "manual_text" | "manual_hint" | "url" | "discovery";
    manualSourceLabel?: string;
    manualTextProvided?: boolean;
    manualTextInputType?: "pasted" | "txt_upload";
    sourceReadMode?: "tavily_extract" | "url_model_read";
    sourceExtractAvailable?: boolean;
    sourceExtractChars?: number;
    sourceExtractDownloadUrl?: string;
  } | undefined,
  language: string,
): string {
  const S = getUiStrings(language as UiLang);
  const inputMode = reelContext?.inputMode;
  if (!inputMode) return "";

  const modeLabels: Record<string, string> = {
    manual_text: "👤 Manual text",
    manual_hint: "🧭 Manual hint",
    url: "🔗 URL",
    discovery: "🤖 Discovery",
  };

  const sourceType = /^https?:\/\//i.test(storySourceUrl) ? "URL" : "Label";
  const sourceValue = sourceType === "URL" ? storySourceUrl : (reelContext?.manualSourceLabel ?? storySourceUrl);
  const inputTypeLabel = reelContext?.manualTextInputType === "txt_upload" ? ".txt upload" : "pasted text";
  const hasText = reelContext?.manualTextProvided ? "yes" : "no";
  const readModeLabel = reelContext?.sourceReadMode === "tavily_extract"
    ? "Tavily extract"
    : reelContext?.sourceReadMode === "url_model_read"
      ? "Model URL read"
      : "Unknown";
  const extractStatus = reelContext?.sourceExtractAvailable
    ? `available${typeof reelContext.sourceExtractChars === "number" ? ` (${reelContext.sourceExtractChars.toLocaleString()} chars)` : ""}`
    : "unavailable";
  const extractUrl = reelContext?.sourceExtractDownloadUrl?.trim();
  const extractUrlIsHttp = !!extractUrl && /^https?:\/\//i.test(extractUrl);
  const extractLink = reelContext?.sourceExtractAvailable && extractUrl
    ? (extractUrlIsHttp
      ? `<div class="panel-row"><span class="panel-label">Extract file</span><span class="panel-value"><a href="${escapeHtml(extractUrl)}" target="_blank" rel="noopener noreferrer">Download .txt</a></span></div>`
      : `<div class="panel-row"><span class="panel-label">Extract file</span><span class="panel-value">${escapeHtml(extractUrl)}</span></div>`)
    : "";

  return `<details open>
  <summary>🧾 ${S.sourceProvenanceHeading}</summary>
  <div class="panel-body">
    <div class="panel-row"><span class="panel-label">Mode</span><span class="panel-value"><span class="pill pill-blue">${escapeHtml(modeLabels[inputMode] ?? inputMode)}</span></span></div>
    <div class="panel-row"><span class="panel-label">Source type</span><span class="panel-value"><span class="pill pill-grey">${escapeHtml(sourceType)}</span></span></div>
    <div class="panel-row"><span class="panel-label">Source</span><span class="panel-value" style="word-break:break-all">${escapeHtml(sourceValue)}</span></div>
    <div class="panel-row"><span class="panel-label">Source basis</span><span class="panel-value">${escapeHtml(readModeLabel)}</span></div>
    <div class="panel-row"><span class="panel-label">Tavily text</span><span class="panel-value">${escapeHtml(extractStatus)}</span></div>
    ${extractLink}
    <div class="panel-row"><span class="panel-label">Manual text</span><span class="panel-value">${escapeHtml(hasText)}</span></div>
    ${reelContext?.manualTextProvided ? `<div class="panel-row"><span class="panel-label">Input</span><span class="panel-value">${escapeHtml(inputTypeLabel)}</span></div>` : ""}
  </div>
</details>`;
}

function buildApiSourcePanel(apiSourceMap: import("../types.js").ApiSourceMap | undefined, language: string): string {
  if (!apiSourceMap) return "";
  const S = getUiStrings(language as UiLang);
  const rows = [
    { key: "captions", label: S.apiSourceCaptions, source: apiSourceMap.captions },
    { key: "discovery", label: "Discovery", source: apiSourceMap.discovery },
    { key: "images", label: S.apiSourceImages, source: apiSourceMap.images },
  ].filter(r => r.source);

  if (rows.length === 0) return "";

  const pills = rows.map(r => {
    const label = r.source === "azure" ? "Azure" : "Native";
    const cls = "pill-grey";
    const icon = "🔧";
    return `<div class="panel-row"><span class="panel-label">${r.label}</span><span class="panel-value"><span class="pill ${cls}">${icon} ${label}</span></span></div>`;
  }).join("\n");

  const heading = `🔌 ${S.apiSources}`;
  return `<details open><summary>${heading}</summary><div class="panel-body">${pills}</div></details>`;
}

function buildSceneSourceBadge(source: import("../types.js").ImageSource | undefined): string {
  if (!source) return "";
  if (source.type === "stock") {
    const label = source.provider.charAt(0).toUpperCase() + source.provider.slice(1);
    return ` <span style="font-size:10px;font-weight:400;color:#5b9dd9;margin-left:6px;">📷 ${label}</span>`;
  }
  if (source.type === "ai") {
    const provTag = source.provider ? " (🔧)" : "";
    return ` <span style="font-size:10px;font-weight:400;color:#888;margin-left:6px;">🤖 ${source.model}${provTag}</span>`;
  }
  return "";
}
