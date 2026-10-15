import type { BrandId, Stage5RendererType, Stage5TemplateName } from "../types.js";
import {
  clearReelIntakeSession as clearReelIntakeSessionQuery,
  getReelIntakeSession as getReelIntakeSessionQuery,
  upsertReelIntakeSession,
} from "../db/queries.js";
import type { ReelIntakeMode, ReelIntakeStep } from "./reel-intake.js";
import { computeReelIntakeExpiry } from "./reel-intake.js";

export function setReelIntakeSession(params: {
  brand: BrandId;
  chatId: string;
  mode: ReelIntakeMode;
  step: ReelIntakeStep;
  sourceInput?: string;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
  ttlMinutes?: number;
}): void {
  upsertReelIntakeSession({
    brand: params.brand,
    chatId: params.chatId,
    mode: params.mode,
    step: params.step,
    sourceInput: params.sourceInput,
    stage5Renderer: params.stage5Renderer,
    stage5Template: params.stage5Template,
    expiresAt: computeReelIntakeExpiry(params.ttlMinutes ?? 15),
  });
}

export function getReelIntakeSession(brand: BrandId, chatId: string): {
  mode: ReelIntakeMode;
  step: ReelIntakeStep;
  sourceInput?: string;
  stage5Renderer?: Stage5RendererType;
  stage5Template?: Stage5TemplateName;
} | null {
  const row = getReelIntakeSessionQuery(brand, chatId);
  if (!row) return null;
  const mode = row.mode === "text" || row.mode === "hint" ? row.mode : null;
  const step = row.step === "awaiting_source" || row.step === "awaiting_content" ? row.step : null;
  if (!mode || !step) return null;
  const stage5Renderer = row.stage5Renderer === "hyperframes" ? row.stage5Renderer : undefined;
  const stage5Template = row.stage5Template === "enhanced-default" ? row.stage5Template : undefined;
  return { mode, step, sourceInput: row.sourceInput ?? undefined, stage5Renderer, stage5Template };
}

export function clearReelIntakeSession(brand: BrandId, chatId: string): void {
  clearReelIntakeSessionQuery(brand, chatId);
}
