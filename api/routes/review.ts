import { Hono } from "hono";
import type { ReelContext, ReelCategory } from "../../src/types.js";
import { getBrand } from "../../src/brands/index.js";
import { getReelById } from "../../src/db/queries.js";
import { buildReelReviewHtml } from "../../src/review/reel-html-builder.js";

export const reviewRouter = new Hono();

// GET /review/reel/:reelId — dynamic reel review
reviewRouter.get("/review/reel/:reelId", (c) => {
  const reelId = c.req.param("reelId");
  const reel = getReelById(reelId);
  if (!reel) return c.json({ error: "Reel not found" }, 404);

  let brand: ReturnType<typeof getBrand>;
  try { brand = getBrand(reel.brand as Parameters<typeof getBrand>[0]); }
  catch { return c.json({ error: "Unknown brand" }, 404); }

  const script = reel.script ? JSON.parse(reel.script) : undefined;

  let ctx: ReelContext = {
    runId: reel.id,
    brand,
    runDate: reel.runDate,
    workDir: "",
    category: reel.category as ReelCategory | undefined,
    story: {
      index: 0,
      headline: reel.headline,
      source: (() => { try { return new URL(reel.sourceUrl).hostname; } catch { return reel.sourceUrl; } })(),
      sourceUrl: reel.sourceUrl,
      snippet: reel.snippet ?? "",
      selectionReason: "",
      compositeScore: 0,
      verified: false,
    },
    script,
    videoGcsUrl: reel.videoGcsUrl ?? undefined,
    reviewUrl: reel.reviewUrl ?? undefined,
    status: reel.status as ReelContext["status"],
    stageLogs: [],
  };

  if (reel.context) {
    try {
      const stored = JSON.parse(reel.context) as {
        trendingSignals?: ReelContext["trendingSignals"];
        categorySource?: ReelContext["categorySource"];
        useStockImages?: ReelContext["useStockImages"];
        musicFile?: ReelContext["musicFile"];
        discoveryBias?: string;
        recentTopics?: string[];
        imageSourceMap?: ReelContext["imageSourceMap"];
        apiSourceMap?: ReelContext["apiSourceMap"];
        cameraEffect?: ReelContext["cameraEffect"];
        usedCameraEffect?: ReelContext["usedCameraEffect"];
        usedVoiceId?: ReelContext["usedVoiceId"];
        usedVoiceProvider?: ReelContext["usedVoiceProvider"];
        usedVoiceSpeed?: ReelContext["usedVoiceSpeed"];
        stage5Renderer?: ReelContext["stage5Renderer"];
        stage5Template?: ReelContext["stage5Template"];
        stage5RenderTelemetry?: ReelContext["stage5RenderTelemetry"];
        manualSourceMode?: ReelContext["manualSourceMode"];
        manualSourceInput?: ReelContext["manualSourceInput"];
        manualSourceTextInputType?: ReelContext["manualSourceTextInputType"];
        inputMode?: "manual_text" | "manual_hint" | "url" | "discovery";
        manualSourceLabel?: string;
        manualTextProvided?: boolean;
        manualTextInputType?: "pasted" | "txt_upload";
        sourceReadMode?: "tavily_extract" | "url_model_read";
        sourceExtractAvailable?: boolean;
        sourceExtractChars?: number;
        sourceExtractDownloadUrl?: string;
      };
      ctx = {
        ...ctx,
        context: stored,
        trendingSignals: stored.trendingSignals,
        categorySource: stored.categorySource,
        useStockImages: stored.useStockImages,
        musicFile: stored.musicFile,
        discoveryBias: stored.discoveryBias,
        recentTopics: stored.recentTopics,
        imageSourceMap: stored.imageSourceMap,
        apiSourceMap: stored.apiSourceMap,
        cameraEffect: stored.cameraEffect,
        usedCameraEffect: stored.usedCameraEffect,
        usedVoiceId: stored.usedVoiceId,
        usedVoiceProvider: stored.usedVoiceProvider,
        usedVoiceSpeed: stored.usedVoiceSpeed,
        stage5Renderer: stored.stage5Renderer,
        stage5Template: stored.stage5Template,
        stage5RenderTelemetry: stored.stage5RenderTelemetry,
        manualSourceMode: stored.manualSourceMode ?? (stored.inputMode === "manual_text" ? "text" : stored.inputMode === "manual_hint" ? "hint" : undefined),
        manualSourceInput: stored.manualSourceInput ?? stored.manualSourceLabel,
        manualSourceTextInputType: stored.manualSourceTextInputType ?? stored.manualTextInputType,
        story: {
          ...ctx.story!,
          sourceReadMode: stored.sourceReadMode,
          sourceExtractAvailable: stored.sourceExtractAvailable,
          sourceExtractChars: stored.sourceExtractChars,
          sourceExtractDownloadUrl: stored.sourceExtractDownloadUrl,
        },
      } as ReelContext;
    } catch { /* ignore malformed context */ }
  }

  const html = buildReelReviewHtml(ctx);
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(html);
});
