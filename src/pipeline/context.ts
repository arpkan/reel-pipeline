import type { RunContext, BrandConfig, Theme } from "../types.js";

export function createRunContext(
  runId: string,
  brand: BrandConfig,
  runDate: string,
  options?: { theme?: Theme, useStockImages?: boolean }
): RunContext {
  return {
    runId,
    brand,
    runDate,
    theme: options?.theme,
    stories: [],
    posts: [],
    stageLogs: [],
    status: "running",
    useStockImages: options?.useStockImages ?? brand.useStockImages,
  };
}

export function mergeStageOutput(
  ctx: RunContext,
  partial: Partial<RunContext>
): RunContext {
  return { ...ctx, ...partial };
}
