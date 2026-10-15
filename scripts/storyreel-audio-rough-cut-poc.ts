import { runStoryReelAudioRoughCutPoc } from "../src/storyreel/audio-rough-cut-poc.js";

try {
  const result = await runStoryReelAudioRoughCutPoc(process.argv.slice(2));
  console.log(`Audio rough cut written to: ${result.videoPath}`);
  console.log(`Artifacts written to: ${result.outputDir}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
