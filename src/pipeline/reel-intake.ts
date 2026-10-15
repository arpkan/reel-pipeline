import type { BrandId } from "../types.js";

export type ReelIntakeMode = "text" | "hint";
export type ReelIntakeStep = "awaiting_source" | "awaiting_content";

export interface ReelIntakeSession {
  brand: BrandId;
  chatId: string;
  mode: ReelIntakeMode;
  step: ReelIntakeStep;
  sourceInput?: string;
  expiresAt: string;
}

export function computeReelIntakeExpiry(ttlMinutes = 15): string {
  return new Date(Date.now() + ttlMinutes * 60_000).toISOString();
}

export function isNonEmptySourceInput(input: string): boolean {
  return input.trim().length > 0;
}
