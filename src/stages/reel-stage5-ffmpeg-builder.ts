export interface ReelStage5EncodeTailArgsInput {
  finalVideoLabel: string;
  audioLabel: string;
  totalDuration: number;
  outputPath: string;
  preset?: string;
}

export function buildReelStage5EncodeTailArgs(
  input: ReelStage5EncodeTailArgsInput,
): string[] {
  const preset = input.preset ?? "medium";

  return [
    "-map", `[${input.finalVideoLabel}]`, "-map", `[${input.audioLabel}]`,
    "-c:v", "libx264", "-preset", preset, "-tune", "stillimage",
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(input.totalDuration), "-pix_fmt", "yuv420p",
    input.outputPath,
  ];
}
