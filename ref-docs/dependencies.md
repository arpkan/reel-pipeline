# Dependencies

## Runtime

### HTTP Framework
**`hono` + `@hono/node-server`**
Lightweight, TypeScript-first web framework. Chosen over Express for its first-class TypeScript support, built-in middleware (logger), and clean routing API. `@hono/node-server` adapts Hono's fetch-based handler to Node's `http` module.

### Database
**`better-sqlite3`**
Synchronous SQLite driver for Node. Appropriate for this workload: the pipeline is largely sequential (one run per brand at a time), writes are infrequent, and the simplicity of an embedded database avoids the operational overhead of a separate DB server.

**`drizzle-orm` + `drizzle-kit`**
Type-safe ORM with schema-as-code and migration support. Provides typed query builders over `better-sqlite3` and generates the SQLite schema from TypeScript table definitions.

### AI / ML Services
**`@anthropic-ai/bedrock-sdk`**
AWS Bedrock client used to invoke Claude models for caption and reel script generation. Bedrock was chosen over the direct Anthropic API to leverage existing AWS IAM credentials and keep API costs consolidated under AWS billing.

**`@google/genai`**
Google Generative AI SDK, used for:
- Gemini for story discovery and scoring (chat completions)
- Gemini Imagen for AI image generation
- Two separate API keys are used (`GEMINI_API_KEY` for text, `GEMINI_IMAGE_API_KEY` for image gen) to allow independent quota management.

### Video Rendering
**`@hyperframes/producer`**
HTML-to-video rendering engine used for reel stage 5. Renders a Hyperframes HTML project (scene images + CSS animations + audio) into an MP4 at 24/30/60 fps. Replaced the previous raw ffmpeg scene assembly approach for stage5. ffmpeg is still used for audio pre-mixing and final audio mux steps within the Hyperframes flow.

### Content Credentials
**`@contentauth/c2pa-node`**
C2PA (Coalition for Content Provenance and Authenticity) Node.js binding. Embeds a signed provenance manifest into reel videos that contain AI-generated images. Requires `C2PA_SIGN_CERT` (leaf+CA chain PEM) and `C2PA_SIGN_KEY` (leaf ES-256 private key) env vars. c2pa-rs rejects self-signed certs at sign time, so a CA + leaf pair is used — regenerate with `scripts/regen-c2pa-certs.sh`.

### Cloud Storage
**`@google-cloud/storage`**
GCS (Google Cloud Storage) client. Review HTML pages, generated images, and reel videos are stored in GCS and served via public URLs. GCS was chosen because Vertex AI (image generation) already requires a Google Cloud project, making GCS the natural co-located storage.

### Cloud Infrastructure (Assembly Offload)
**`@aws-sdk/client-sqs`**
AWS SQS client. Used by `assembly-queue.ts` to enqueue stage5 reel assembly jobs when `REEL_ASSEMBLY_OFFLOAD_ENABLED=true`. The EC2 worker polls this queue on startup.

**`@aws-sdk/client-ec2`**
AWS EC2 client. Used by `assembly-launcher.ts` to spawn ephemeral EC2 instances for offloaded stage5 assembly using a pre-configured launch template (`REEL_ASSEMBLY_EC2_LAUNCH_TEMPLATE_ID`).

### Scheduling
**`node-cron`**
In-process cron scheduler with timezone support. Handles pipeline triggers (fires 15 min before post time), reel triggers (fires 30 min before reel time), the 1-minute publisher cron, the stuck-reel heartbeat, and the periodic metrics collector. Kept in-process to avoid an external scheduler dependency.

### Date/Time
**`date-fns-tz`**
Timezone-aware date utilities. Used to resolve "HH:MM" scheduled times in brand-local timezones to UTC-correct `Date` objects. `toZonedTime` / `fromZonedTime` conversions are safer and more explicit than raw `Intl` arithmetic for scheduling.

### Image / HTML Rendering
**`node-html-to-image`**
Converts HTML to PNG images using headless Chrome. Used to render text overlays onto post images (static pipeline). Not used for reel video rendering (that uses `@hyperframes/producer`).

**`puppeteer`**
Headless browser, implicitly used by `node-html-to-image`. Also available for any scraping or rendering needs.

### Validation
**`zod`**
Schema validation library. Used to validate and parse AI model JSON responses, ensuring stage outputs conform to expected shapes before being merged into the run context.

### Environment
**`dotenv`**
Loads `.env` files into `process.env`. Applied at server startup via `import "dotenv/config"`.

---

## Dev Dependencies

**`typescript` + `tsx`**
TypeScript compiler + `tsx` for running `.ts` files directly in development (`npm run dev` / `npm run cli`). `tsx` is used instead of `ts-node` for faster startup and better ESM support.

**`vitest`**
Fast Vite-native test runner. Used for unit tests in the `tests/` directory.

**`@aws-sdk/client-polly`**
AWS Polly TTS client (dev dependency — listed in devDependencies, likely used in early development or as a fallback). ElevenLabs is the primary TTS provider for production reels.

**`drizzle-kit`**
Drizzle migration CLI for generating and running schema migrations.

---

## External Services (no npm package — called via `fetch` or custom clients)

| Service | How Used |
|---------|----------|
| **Tavily API** | News search and URL verification (`TAVILY_API_KEY`) |
| **ElevenLabs API** | Text-to-speech voiceover generation for reels — primary English provider (`ELEVENLABS_API_KEY`) |
| **Botnoi API** | Thai TTS voiceover provider (`BOTNOI_API_KEY`) |
| **UVoice API** | Multi-language TTS voiceover provider (`UVOICE_API_KEY`) |
| **MiniMax API** | Multi-language TTS voiceover provider (`MINIMAX_API_KEY`) |
| **Whisper** | Speech-to-text used to extract word-level timestamps from TTS audio (for subtitle sync in Hyperframes) |
| **Meta Graph API** | Facebook photo/reel publishing, Instagram reel publishing |
| **TikTok Open API v2** | Video publishing (`video.publish` scope) |
| **LINE Messaging API** | Group notifications + command polling via webhook |
| **Telegram Bot API** | Notifications, approval commands, live progress messages |
| **Google Trends** | Trending topic signals for discovery bias |
| **YouTube Data API** | Regional trending videos for discovery bias |
| **Google News RSS** | Language/geo-specific news headlines for discovery bias |
| **Azure Foundry (GPT-Image-2)** | Alternative image generation via Azure OpenAI (`AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`) |
