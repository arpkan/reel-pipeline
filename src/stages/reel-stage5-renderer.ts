import type {
  ReelContext,
  ReelStage,
  Stage5RendererType,
  Stage5RenderSettings,
  Stage5TemplateName,
} from "../types.js";
import { resolveStage5Performance } from "./reel-stage5-performance.js";

export interface Stage5Renderer {
  readonly renderer: Stage5RendererType;
  run(ctx: ReelContext): Promise<Partial<ReelContext>>;
}

export interface Stage5RendererSelection {
  renderer: Stage5RendererType;
  template?: Stage5TemplateName;
}

const DEFAULT_HYPERFRAMES_TEMPLATE: Stage5TemplateName = "enhanced-default";

export function resolveStage5RendererSelection(ctx: ReelContext): Stage5RendererSelection {
  return {
    renderer: "hyperframes",
    template: ctx.stage5Template ?? ctx.brand.reels?.stage5Template ?? DEFAULT_HYPERFRAMES_TEMPLATE,
  };
}

export function resolveStage5RenderSettings(ctx: ReelContext): Stage5RenderSettings {
  const profile = resolveStage5Performance(ctx.stage5Performance ?? ctx.brand.reels?.stage5Performance);
  const qualityByProfile = {
    fast: "draft",
    balanced: "standard",
    high: "high",
  } as const;

  return {
    fps: profile.targetFps,
    quality: qualityByProfile[profile.effectQuality],
    workers: 1,
    timeoutMs: 30 * 60_000,
    performanceProfile: profile.effectQuality,
  };
}

export async function createStage5Renderer(_ctx: ReelContext): Promise<Stage5Renderer> {
  const { HyperframesStage5Renderer } = await import("./reel-stage5-hyperframes-renderer.js");
  return new HyperframesStage5Renderer();
}

export class ReelStage5Facade implements ReelStage {
  name = "reel-stage5-assemble";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    const selection = resolveStage5RendererSelection(ctx);
    const settings = resolveStage5RenderSettings({ ...ctx, ...selection });
    const selectedCtx = {
      ...ctx,
      stage5Renderer: selection.renderer,
      stage5Template: selection.template,
      stage5RenderSettings: settings,
    };
    const renderer = await createStage5Renderer(selectedCtx);
    const result = await renderer.run(selectedCtx);
    return {
      ...result,
      stage5Renderer: selection.renderer,
      stage5Template: selection.template,
      stage5RenderSettings: settings,
    };
  }
}
