export function calculateGeminiFlashCostUsd(inputTokens = 0, outputTokens = 0): number {
  const inputCost = inputTokens / 1_000_000 * 0.30;
  const outputCost = outputTokens / 1_000_000 * 2.50;
  return Number((inputCost + outputCost).toFixed(8));
}
