import type { ReelCategory, ReelContext, ReelStage, ReelScript } from "../types.js";
import { createBedrockService } from "../services/bedrock.js";
import { REEL_STRINGS, type ReelLang } from "../i18n/reel-strings.js";

interface CategoryRule {
  label: string;
  discoveryBias: string;   // injected into Gemini discovery prompt when category is explicit
  tone: string;
  structure: string;
  voiceRules: string;
  sentencesPerScene: string;
  maxWordsPerSentence: number;
  pacing: string;
  example: string;
}

const CATEGORY_RULES: Record<ReelCategory, CategoryRule> = {
  breaking: {
    label: "Breaking News",
    discoveryBias: "Prefer stories that are time-sensitive, confirmed hard news, published within the last 24 hours — breaking politics, economy, disasters, or major events.",
    tone: "Urgent, fast-paced, matter-of-fact",
    structure: "Hook with a shocking fact or number → key confirmed facts only → impact on viewers → follow call-to-action",
    voiceRules: "Active voice, present tense. Use power words: 'breaking', 'just confirmed', 'announced'. No speculation — stick to confirmed facts only. End with natural follow CTA: 'Follow for updates' or 'Stay tuned for more'.",
    sentencesPerScene: "1-3 short sentences",
    maxWordsPerSentence: 15,
    pacing: "Fast — short punchy sentences, high urgency throughout",
    example: '"Breaking news. The government just confirmed a nationwide fuel price freeze starting tomorrow. Millions of drivers will see immediate relief at the pump. Follow for updates."',
  },
  trending: {
    label: "Trending",
    discoveryBias: "Prefer stories that are widely shared on social media, have viral potential, are conversation-starting — Reddit/Twitter trending topics, surprising revelations, counter-intuitive findings.",
    tone: "Conversational, energetic, curious — makes people want to share",
    structure: "Question or surprising statement hook → story with emotional/social angle → engagement CTA",
    voiceRules: "Second person ('you', 'your'). Use curiosity gaps: 'You won't believe...', 'Here's what nobody's talking about...'. Casual phrasing, not formal news speak.",
    sentencesPerScene: "2-4 sentences",
    maxWordsPerSentence: 20,
    pacing: "Medium — builds curiosity, keeps viewer hooked to the end",
    example: `"Everyone's talking about this. A study just revealed that working from home actually makes you MORE productive — not less. But here's the part companies don't want you to know. Drop a comment if your boss still doesn't believe it."`,
  },
  human_interest: {
    label: "Human Interest",
    discoveryBias: "Prefer stories centered on individuals or communities — personal journeys, acts of kindness, underdogs, people overcoming adversity, emotional transformations.",
    tone: "Warm, empathetic, inspiring — creates emotional connection",
    structure: "Introduce the person or situation → their journey with vivid human details → emotional payoff or lesson",
    voiceRules: "Narrative style, third person. Use names when possible. Vivid human details — emotions, relationships, specific moments. Slower, warmer pacing. No jargon.",
    sentencesPerScene: "3-4 sentences",
    maxWordsPerSentence: 25,
    pacing: "Slow and warm — let the story breathe, build emotional connection",
    example: '"Meet Somchai, a street food vendor who saved for 20 years to send his daughter to university. Last week, she graduated as a doctor. He was crying in the front row. This is what real sacrifice looks like."',
  },
  business: {
    label: "Business / Tech",
    discoveryBias: "Prefer stories about companies, markets, technology, economic data, industry shifts — earnings, product launches, mergers, economic indicators, tech breakthroughs.",
    tone: "Professional but accessible — informative without being dry",
    structure: "Key metric or business change hook → context and comparison → industry impact",
    voiceRules: "Active voice. Lead with numbers, percentages, comparisons. Explain complex concepts simply — avoid jargon or define it immediately. Data-driven credibility throughout.",
    sentencesPerScene: "2-3 sentences",
    maxWordsPerSentence: 18,
    pacing: "Medium — educational, each scene adds a layer of context",
    example: '"Thailand\'s EV sales just hit a record — up 340% in one year. That\'s more growth than any other Southeast Asian market. Three Chinese brands now control 60% of the market, completely reshaping the auto industry."',
  },
  open: {
    label: "Open",
    discoveryBias: "",
    tone: "Natural, engaging — match the tone to the story",
    structure: "Strong hook → key information → memorable takeaway or CTA",
    voiceRules: "Natural spoken language. Match tone and pacing to the story. Conversational but informative.",
    sentencesPerScene: "1-3 sentences",
    maxWordsPerSentence: 20,
    pacing: "Flexible — match pacing to story energy",
    example: '"This story is worth knowing about. [Key facts clearly stated]. Follow for more stories like this."',
  },
};

const THAI_CATEGORY_RULES: Record<ReelCategory, CategoryRule> = {
  breaking: {
    label: "ข่าวด่วน",
    discoveryBias: "Prefer stories that are time-sensitive, confirmed hard news, published within the last 24 hours — breaking politics, economy, disasters, or major events.",
    tone: "ด่วน เร็ว ตรงไปตรงมา",
    structure: "เปิดด้วยข้อเท็จจริงที่แน่ชัด → รายละเอียดสำคัญที่ยืนยันแล้ว → ผลกระทบต่อผู้ชม → CTA",
    voiceRules: "ใช้ประโยคบอกเล่าตรงๆ ไม่คาดเดา ไม่ใช้ภาษาฉาวโฉ่ ยึดข้อเท็จจริงที่ยืนยันแล้วเท่านั้น จบด้วย CTA ตามธรรมชาติ",
    sentencesPerScene: "1-3 ประโยคสั้น",
    maxWordsPerSentence: 20,
    pacing: "เร็ว — ประโยคสั้นกระแทก รักษาความเร่งด่วนตลอดทั้งคลิป",
    example: '"ข่าวด่วน รัฐบาลประกาศแช่แข็งราคาน้ำมันทั่วประเทศมีผลทันที\nนายกฯ ยืนยันมาตรการดังกล่าวจะคงอยู่อย่างน้อย 90 วัน\nราคาน้ำมันเบนซินจะไม่เปลี่ยนแปลงแม้ต้นทุนโลกจะขึ้น\nผู้เชี่ยวชาญชี้อาจส่งผลต่อรายได้รัฐหลายพันล้านบาท"',
  },
  trending: {
    label: "ไวรัล",
    discoveryBias: "Prefer stories that are widely shared on social media, have viral potential, are conversation-starting — trending topics, surprising revelations, counter-intuitive findings.",
    tone: "สนทนา กระตือรือร้น น่าสนใจ — ทำให้คนอยากแชร์",
    structure: "ตั้งคำถามหรือข้อความน่าแปลกใจ → เล่าเรื่องจากมุมอารมณ์/สังคม → CTA สร้างการมีส่วนร่วม",
    voiceRules: "ใช้สรรพนามบุรุษที่ 2 พูดกับผู้ชมโดยตรง ใช้คำถามกระตุ้นความอยากรู้ ภาษาพูดธรรมชาติ ไม่เป็นทางการเกินไป",
    sentencesPerScene: "2-4 ประโยค",
    maxWordsPerSentence: 25,
    pacing: "ปานกลาง — สร้างความอยากรู้ รักษาความสนใจไปจนจบ",
    example: '"ตอนนี้หลายคนกำลังพูดถึงเรื่องนี้กัน\nงานวิจัยล่าสุดพบว่าคนทำงานที่บ้านนอนหลับได้นานกว่าออฟฟิศเฉลี่ย 45 นาทีต่อคืน\nแต่รายงานระบุด้วยว่าขอบเขตระหว่างงานกับชีวิตส่วนตัวพร่าเลือนมากขึ้น\nคุณเป็นแบบนี้ด้วยไหม?"',
  },
  human_interest: {
    label: "เรื่องคน",
    discoveryBias: "Prefer stories centered on individuals or communities — personal journeys, acts of kindness, underdogs, people overcoming adversity, emotional transformations.",
    tone: "อบอุ่น เห็นอกเห็นใจ สร้างความผูกพันทางอารมณ์",
    structure: "แนะนำตัวละครหรือสถานการณ์ → เล่าเรื่องราวตามลำดับเหตุการณ์พร้อมรายละเอียดชีวิตจริง → บทสรุปหรือบทเรียน",
    voiceRules: "เล่าเรื่อง สรรพนามบุรุษที่ 3 ใช้ชื่อคนเมื่อทราบ รายละเอียดชีวิตจริง — อารมณ์ ความสัมพันธ์ ช่วงเวลาเฉพาะเจาะจง จังหวะช้ากว่า อบอุ่นกว่า ไม่ใช้ศัพท์เทคนิค",
    sentencesPerScene: "3-4 ประโยค",
    maxWordsPerSentence: 30,
    pacing: "ช้าและอบอุ่น — ให้เรื่องราวมีช่องว่างหายใจ สร้างความผูกพันทางอารมณ์",
    example: '"สมชายขายข้าวแกงข้างทางมา 20 ปีเพื่อเก็บเงินส่งลูกเรียน\nเช้าวันหนึ่งลูกสาวของเขาส่งรูปในชุดครุยมหาวิทยาลัยให้ดู\nสมชายบอกว่านั่นคือวันที่รู้สึกว่าตัวเองรวยที่สุดในชีวิต\nต่อมาภาพดังกล่าวถูกแชร์กว่าสองแสนครั้งในชั่วคืน"',
  },
  business: {
    label: "ธุรกิจ / เทคโนโลยี",
    discoveryBias: "Prefer stories about companies, markets, technology, economic data, industry shifts — earnings, product launches, mergers, economic indicators, tech breakthroughs.",
    tone: "มืออาชีพแต่เข้าใจง่าย — ให้ข้อมูลโดยไม่แห้งแล้ว",
    structure: "เปิดด้วยตัวเลขหรือการเปลี่ยนแปลงที่วัดได้ → อธิบายบริบทและเปรียบเทียบ → ผลกระทบต่ออุตสาหกรรมหรือคนธรรมดา",
    voiceRules: "เริ่มด้วยตัวเลข เปอร์เซ็นต์ การเปรียบเทียบ อธิบายความซับซ้อนอย่างเข้าใจง่าย — หลีกเลี่ยงศัพท์เทคนิคหรืออธิบายทันที น่าเชื่อถือตลอดทั้งเรื่อง",
    sentencesPerScene: "2-3 ประโยค",
    maxWordsPerSentence: 22,
    pacing: "ปานกลาง — ให้ความรู้ แต่ละฉากเพิ่มบริบททีละชั้น",
    example: '"ราคาไข่ไก่พุ่งขึ้น 18 เปอร์เซ็นต์เดือนเดียว\nผู้ผลิตอ้างต้นทุนอาหารสัตว์และค่าพลังงานที่เพิ่มขึ้น\nนักวิเคราะห์คาดราคาจะทรงตัวในระดับนี้ไปอีกอย่างน้อยหนึ่งไตรมาส\nสำหรับครัวเรือนที่กินไข่ทุกวัน นั่นหมายถึงค่าใช้จ่ายเพิ่มประมาณ 200 บาทต่อเดือน"',
  },
  open: {
    label: "ทั่วไป",
    discoveryBias: "",
    tone: "ธรรมชาติ น่าสนใจ — ปรับโทนให้เข้ากับเรื่อง",
    structure: "เปิดด้วยจุดดึงดูด → ข้อมูลสำคัญ → ข้อความจำหรือ CTA",
    voiceRules: "ภาษาพูดธรรมชาติ ปรับโทนและจังหวะให้เข้ากับเรื่อง สนทนาแต่ให้ข้อมูล",
    sentencesPerScene: "1-3 ประโยค",
    maxWordsPerSentence: 25,
    pacing: "ยืดหยุ่น — ปรับจังหวะให้เข้ากับพลังของเรื่อง",
    example: '"นักวิทยาศาสตร์เพิ่งค้นพบว่าปลาหมึกสามารถฝันได้\nและระหว่างนอนหลับผิวของมันจะเปลี่ยนสีเร็วมากเหมือนกำลังแสดงหนัง\nยังไม่มีใครรู้ว่ามันฝันถึงอะไร\nแต่นักวิจารณ์บอกว่านี่อาจเปลี่ยนความเข้าใจเรื่องจิตสำนึกของสัตว์ทั้งหมด"',
  },
};

function buildCategoryPrompt(forced: ReelCategory | undefined, lang: string): string {
  const rules = lang === "Thai" ? THAI_CATEGORY_RULES : CATEGORY_RULES;
  const categoriesList = (Object.entries(rules) as [ReelCategory, CategoryRule][])
    .map(([key, rule]) => `## ${key} — ${rule.label}
  Tone: ${rule.tone}
  Structure: ${rule.structure}
  Voice rules: ${rule.voiceRules}
  Sentences per scene: ${rule.sentencesPerScene} (max ${rule.maxWordsPerSentence} words/sentence)
  Pacing: ${rule.pacing}
  Example style: ${rule.example}`)
    .join("\n\n");

  if (forced) {
    return `CATEGORY: Use category "${forced}" — ${rules[forced].label}. Apply its rules strictly.

${categoriesList}`;
  }

  return `CATEGORY SELECTION: Analyse the story and select the single most appropriate category. Return it as the "category" field in your JSON. Use "open" only as a fallback if the story does not clearly fit any other category.

${categoriesList}`;
}

export { CATEGORY_RULES, THAI_CATEGORY_RULES };

export function buildSystemPrompt(ctx: {
  brand: { language: string };
  category?: ReelCategory;
  sceneCount: number;
}): string {
  const lang: ReelLang = ctx.brand.language in REEL_STRINGS
    ? (ctx.brand.language as ReelLang)
    : "en";
  const S = REEL_STRINGS[lang];
  const langLabel = S.langLabel;
  const sceneCount = ctx.sceneCount;
  const wordCountBlock = S.wordCountBlock.replace(/{{sceneCount}}/g, String(sceneCount));

  return `You are a social media video scriptwriter. You write short, engaging ${langLabel} scripts for vertical video reels (Instagram/Facebook/TikTok style).

${S.languageLine}

GENERAL RULES:
- Captions are short punchy text (max 8 words) shown on screen
- Image prompts should be vivid, photorealistic, vertical 9:16 portrait composition
- Hook scene 1 immediately — first 3 seconds decide whether people keep watching
${S.hooksBlock}
- ${S.ctaBlock}
- Total video should feel complete in ${sceneCount} scenes (~45-60 seconds)
- ${wordCountBlock}
- CRITICAL: Do NOT use honorary titles, royal titles, or formal positions unless you are certain they are current. Source articles often use outdated titles. NEVER use "Prince Andrew" or "the Duke of York" — he is no longer a working royal; just say "Andrew" and identify him by context (e.g. "Andrew, who lives at Royal Lodge"). Apply this principle to all public figures: when in doubt, drop the title and use the name only.
- CRITICAL: Do NOT state a specific calendar date (e.g. "on July 10th") for when an event happened unless the source material explicitly narrates that as the event date. A date attached to a photo caption or byline is not necessarily the event date. If it's unclear or the story is still developing, use relative time framing ("overnight", "this week", "in the past 24 hours") instead of asserting a specific date.
- CRITICAL: You are writing values inside a JSON string. If a voiceover or caption needs to quote a nickname, alias, or short phrase (e.g. a nickname like เดียร์), use curly quotes "..." — never a straight double-quote ("...") — since a straight quote inside a JSON string breaks the JSON. Do not use the " character anywhere inside a voiceover, caption, or title value.

${buildCategoryPrompt(ctx.category, langLabel)}
${S.ttsBlock}
Respond ONLY with valid JSON matching this exact structure:
{
  "category": "breaking",
  "title": "short video title",
  "hashtags": ["#Hashtag1", "#Hashtag2", "#Hashtag3", "#Hashtag4", "#Hashtag5"],
  "scenes": [
    {
      "sceneNumber": 1,
      "voiceover": "spoken text for this scene",
      "caption": "on-screen text overlay",
      "imagePrompt": "detailed image generation prompt, vertical 9:16 framing, photorealistic"
    }
  ]
}

For hashtags: generate 4-5 relevant tags. Mix specific (e.g. #SpainAirspace) and broad (e.g. #BreakingNews). Write in ${langLabel}.`;
}

function ensureCTA(script: ReelScript, language: string): void {
  if (!script.scenes.length) return;
  const lastScene = script.scenes[script.scenes.length - 1];
  const voiceover = lastScene.voiceover;
  const lang: ReelLang = language in REEL_STRINGS ? (language as ReelLang) : "en";
  const S = REEL_STRINGS[lang];

  const hasCTA = S.ctaSignals.some((re) => re.test(voiceover));
  if (hasCTA) return;

  const append = S.ctaAppends[Math.floor(Math.random() * S.ctaAppends.length)];
  lastScene.voiceover = voiceover.replace(/\.?\s*$/, append);
  console.log(`  [CTA fix] Appended missing CTA to scene ${lastScene.sceneNumber}`);
}

export class ReelStage2Script implements ReelStage {
  name = "reel-stage2-script";

  async run(ctx: ReelContext): Promise<Partial<ReelContext>> {
    const story = ctx.story;
    if (!story) throw new Error("No story in context — run story fetch first");

    const bedrock = createBedrockService();
    const sceneCount = ctx.brand.reels?.sceneCount ?? 4;
    const forcedCategory = ctx.category;

    const systemPrompt = buildSystemPrompt({
      brand: ctx.brand,
      category: forcedCategory,
      sceneCount,
    });

    const previousScriptBlock = ctx.previousScript
      ? `\n\nIMPORTANT — THIS IS A RESCRIPT. The previous script is shown below. You MUST write a COMPLETELY different version:\n- Use a DIFFERENT opening hook (do not start with the same words or structure)\n- Take a DIFFERENT narrative angle or focus\n- Restructure the scenes in a DIFFERENT order or emphasis\n- Create a NEW title that is different from the source headline and from the previous script's title\n- Do NOT repeat any scene voiceover from the previous script\n\nPrevious script:\n${JSON.stringify(ctx.previousScript, null, 2)}`
      : "\n\nCreate an original title for this reel that is different from the source headline — make it catchy and engaging for social media.";

    const userMessage = `Create a ${sceneCount}-scene reel script based on this story:

Headline: ${story.headline}
Source: ${story.source}

${story.snippet.slice(0, 4000)}${previousScriptBlock}`;

    const maxAttempts = 2;
    let script: ReelScript | undefined;
    let source: import("../types.js").ApiProvider | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await bedrock.converse(systemPrompt, userMessage);
      const raw = result.text;
      source = result.source;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        script = JSON.parse(jsonMatch?.[0] ?? raw);
        break;
      } catch {
        if (attempt === maxAttempts - 1) {
          throw new Error(`Failed to parse script JSON after ${maxAttempts} attempts:\n${raw.slice(0, 500)}`);
        }
        console.log(`  [reel-stage2-script] JSON parse failed on attempt ${attempt + 1} — retrying`);
      }
    }

    if (!script) {
      throw new Error("Failed to parse script JSON: no attempts succeeded");
    }

    // Normalise category — fall back to forced or "open"
    const category: ReelCategory =
      (["breaking", "trending", "human_interest", "business", "open"].includes(script.category ?? "")
        ? script.category!
        : (forcedCategory ?? "open"));
    script.category = category;

    ensureCTA(script, ctx.brand.language);

    console.log(`  Category: ${category} (${CATEGORY_RULES[category].label})`);
    console.log(`  Title: ${script.title}`);
    for (const scene of script.scenes) {
      console.log(`  Scene ${scene.sceneNumber}: ${scene.voiceover.slice(0, 60)}...`);
    }

    return { script, category, apiSourceMap: { ...ctx.apiSourceMap, captions: source } };
  }
}
