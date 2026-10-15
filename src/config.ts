import type { BrandId } from "./types.js";
import { ds, ns, ts } from "./brands/index.js";

const ALL_BRANDS = [ds, ns, ts];

// Vars required regardless of which brand is running
const ALWAYS_REQUIRED: { key: string; reason: string }[] = [
  { key: "GOOGLE_APPLICATION_CREDENTIALS", reason: "GCS + Vertex AI" },
  { key: "GOOGLE_CLOUD_PROJECT",           reason: "Vertex AI" },
  { key: "GCS_BUCKET",                     reason: "image + video upload" },
  { key: "TAVILY_API_KEY",                 reason: "news discovery" },
  { key: "TELEGRAM_BOT_TOKEN",             reason: "Telegram bot token" },
  { key: "PIPELINE_DB_PATH",               reason: "database path" },
  { key: "PIPELINE_BASE_URL",              reason: "review page URL prefix" },
];

export function isStoryReelEnabled(): boolean {
  return (process.env.STORYREEL_ENABLED ?? "false").toLowerCase() === "true";
}

export function getStoryReelGeminiModel(): string {
  return process.env.STORYREEL_GEMINI_MODEL ?? "gemini-2.5-flash";
}

export function getStoryReelBotToken(): string | undefined {
  return process.env.STORYREEL_BOT_TOKEN;
}

export function getStoryReelAdminChatId(): string | undefined {
  return process.env.STORYREEL_ADMIN_CHAT_ID;
}

export function isReelAssemblyOffloadEnabled(): boolean {
  return (process.env.REEL_ASSEMBLY_OFFLOAD_ENABLED ?? "").toLowerCase() === "true";
}

export function validateEnv(brandId?: BrandId): void {
  const missing: string[] = [];

  // Always-required vars
  for (const { key, reason } of ALWAYS_REQUIRED) {
    if (!process.env[key]) missing.push(`  - ${key}  (${reason})`);
  }

  // LLM vars
  const urlClassifierProvider = (process.env.URL_CLASSIFIER_PROVIDER ?? "gemini").toLowerCase();
  const discoveryProvider = (process.env.DISCOVERY_PROVIDER ?? "gemini").toLowerCase();
  const urlUsesAzure = urlClassifierProvider === "azure_gpt55" || urlClassifierProvider === "gpt55";
  const discoveryUsesAzure = discoveryProvider === "azure_gpt55" || discoveryProvider === "gpt55";

  if (urlUsesAzure || discoveryUsesAzure) {
    if (!process.env.AZURE_OPENAI_ENDPOINT) missing.push(`  - AZURE_OPENAI_ENDPOINT  (Azure OpenAI endpoint for GPT-5.5)`);
    if (!process.env.AZURE_OPENAI_API_KEY) missing.push(`  - AZURE_OPENAI_API_KEY  (Azure OpenAI key for GPT-5.5)`);
  }

  if (!urlUsesAzure || !discoveryUsesAzure) {
    if (!process.env.GEMINI_API_KEY) missing.push(`  - GEMINI_API_KEY  (Gemini)`);
  }

  if (!process.env.GEMINI_IMAGE_API_KEY) missing.push(`  - GEMINI_IMAGE_API_KEY  (Image Gen)`);

  const bedrockEffort = process.env.BEDROCK_EFFORT;
  if (bedrockEffort && !["low", "medium", "high"].includes(bedrockEffort)) {
    missing.push(`  - BEDROCK_EFFORT  (must be low, medium or high — got "${bedrockEffort}")`);
  }

  // Brand-specific vars — check all brands if no brand specified (server startup),
  // or just the given brand (run startup)
  const brandsToCheck = brandId
    ? ALL_BRANDS.filter((b) => b.id === brandId)
    : ALL_BRANDS;

  for (const brand of brandsToCheck) {
    const prefix = brand.id.toUpperCase();

    // Telegram chat ID
    const tgConfig = brand.channels?.telegram;
    if (tgConfig?.enabled) {
      const chatIdVar = tgConfig.chatIdEnvVar;
      if (!process.env[chatIdVar]) missing.push(`  - ${chatIdVar}  (Telegram chat for ${brand.id})`);
    }

    // LINE
    const lineConfig = brand.channels?.line;
    if (lineConfig?.enabled) {
      if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) missing.push(`  - LINE_CHANNEL_ACCESS_TOKEN  (LINE bot — ${brand.id} has LINE enabled)`);
      if (!process.env.LINE_CHANNEL_SECRET)       missing.push(`  - LINE_CHANNEL_SECRET  (LINE bot — ${brand.id} has LINE enabled)`);
      const groupIdVar = lineConfig.groupIdEnvVar;
      if (!process.env[groupIdVar]) missing.push(`  - ${groupIdVar}  (LINE group for ${brand.id})`);
    }

    // Meta (Facebook)
    if (!process.env[`${prefix}_META_PAGE_ID`])    missing.push(`  - ${prefix}_META_PAGE_ID  (Facebook page for ${brand.id})`);
    if (!process.env[`${prefix}_META_PAGE_TOKEN`]) missing.push(`  - ${prefix}_META_PAGE_TOKEN  (Facebook token for ${brand.id})`);
  }

  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    missing.forEach((m) => console.error(m));
    process.exit(1);
  }
}
