import type { RunStatus } from "../types.js";
export type { RunStatus };

export type UiLang = "th" | "en" | "de";

export interface UiStringSet {
  statusLabels: Record<RunStatus, string>;
  statusFooterText: Record<RunStatus, string>;
  stageLogsLabel: string;
  reelReviewLink: string;
  latestReel: string;
  statusHeading: string;
  category: string;
  voice: string;
  voiceSpeed: string;
  scenes: string;
  musicVolume: string;
  music: string;
  noneLabel: string;
  language: string;
  cameraEffect: string;
  hookCaption: string;
  voiceover: string;
  subtitleBlocks: string;
  scene: string;
  noTimings: string;
  postCaption: string;
  willPostAsFirstComment: string;
  discoveryBias: string;
  selectionReason: string;
  topicsAvoided: string;
  categoryDiscovery: string;
  reelScript: string;
  apiSources: string;
  apiSourceCaptions: string;
  apiSourceImages: string;
  sourceProvenanceHeading: string;
  helpCommandBody: string;
  syncExplainerHeading: string;
  syncExplainerSteps: [string, string, string, string];
 }

export const UI_STRINGS: Record<UiLang, UiStringSet> = {
  th: {
    statusLabels: {
      awaiting_approval: "รอการอนุมัติ",
      approved:          "อนุมัติแล้ว",
      published:         "เผยแพร่แล้ว",
      rejected:          "ปฏิเสธแล้ว",
      failed:            "ล้มเหลว",
      running:           "กำลังทำงาน",
      cancelled:         "ยกเลิกแล้ว",
    },
    statusFooterText: {
      awaiting_approval: "⏳ รอการอนุมัติ — ตอบกลับใน Telegram เพื่ออนุมัติ แก้ไข หรือปฏิเสธ",
      approved:          "✅ อนุมัติแล้ว — รอการเผยแพร่",
      published:         "🚀 เผยแพร่แล้ว",
      rejected:          "🚫 ปฏิเสธแล้ว",
      failed:            "❌ เกิดข้อผิดพลาด",
      running:           "⏳ กำลังดำเนินการ...",
      cancelled:         "🛑 ยกเลิกแล้ว",
    },
    stageLogsLabel: "บันทึกขั้นตอน",
    reelReviewLink: "ดูรีวิว",
    latestReel: "Reel ล่าสุด",
    statusHeading: "สถานะ",
    category: "หมวดหมู่",
    voice: "เสียง",
    voiceSpeed: "ความเร็วเสียง",
    scenes: "จำนวนฉาก",
    musicVolume: "ระดับเพลง",
    music: "เพลง",
    noneLabel: "ไม่มี",
    language: "ภาษา",
    cameraEffect: "เอฟเฟกต์กล้อง",
    hookCaption: "Hook caption",
    voiceover: "เสียงบรรยาย",
    subtitleBlocks: "บล็อก subtitle",
    scene: "ฉาก",
    noTimings: "ไม่มีข้อมูล word timing",
    postCaption: "คำบรรยายโพสต์",
    willPostAsFirstComment: "จะโพสต์เป็นคอมเมนต์แรก",
    discoveryBias: "Discovery bias",
    selectionReason: "เหตุผลที่เลือก",
    topicsAvoided: "หัวข้อที่หลีกเลี่ยง",
    categoryDiscovery: "Category Discovery",
    reelScript: "สคริปต์รีล",
    apiSources: "แหล่ง API",
    apiSourceCaptions: "คำบรรยาย",
    apiSourceImages: "รูปภาพ",
    sourceProvenanceHeading: "ข้อมูลแหล่งที่มา",
    helpCommandBody: `📋 <b>คำสั่งทั้งหมด — __BRAND_NAME__</b>

<b>Status</b>
• !status — ดูสถานะทั้งหมด

<b>Reels</b>
• !reel [-stock] — สร้าง reel (auto discovery + auto category)
• !reel text — เริ่มโหมดข้อความต้นทางแบบใช้เนื้อหาโดยตรง (ต้องระบุ source)
• !reel hint — เริ่มโหมดข้อความใบ้เพื่อช่วย discovery (ต้องระบุ source)
• !reel &lt;theme&gt; [-stock] — สร้าง reel ด้วย theme ที่กำหนด
• !reel &lt;url&gt; [-stock] — สร้าง reel จาก URL
• !reel &lt;url&gt; &lt;category&gt; [-stock] — สร้าง reel จาก URL ด้วย category ที่กำหนด
• !reel &lt;category&gt; [-stock] — สร้าง reel ด้วย category: breaking, trending, human_interest, business, open
• !reel &lt;category&gt; &lt;effect&gt; [-stock] — สร้าง reel ด้วย category + camera effect: zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, ken_burns, none
• !reel &lt;effect&gt; [-stock] — สร้าง reel (auto category) ด้วย camera effect เฉพาะ
• !reel list — ดู reel ล่าสุด 5 รายการ
• !reel approve — อนุมัติและเผยแพร่ reel ล่าสุดทันที
• !reel approve HH:MM — อนุมัติและตั้งเวลาเผยแพร่วันนี้
• !reel approve HH:MM tmr — อนุมัติและตั้งเวลาเผยแพร่พรุ่งนี้
• !reel approve &lt;id&gt; — เผยแพร่ reel ที่ระบุทันที
• !reel approve &lt;id&gt; HH:MM [tmr] — ตั้งเวลาเผยแพร่ reel ที่ระบุ
• !reel cancel — ยกเลิก reel ที่กำลังทำงาน
• !reel reject [id] — ยกเลิก reel
• !reel skip — ข้ามรอบถัดไป
• !reel skip cancel — ลด skip 1 รอบ · skip cancel all — ยกเลิกทั้งหมด
• !reel status — ดูสถานะ reel ล่าสุด + ลิงก์รีวิว
• !reel confirm &lt;id&gt; — ยืนยัน headline แล้วเริ่มสร้าง script/voice/images/video
• !reel resume &lt;id&gt; — ต่อจาก stage ที่ค้างอยู่ (ข้ามงานที่เสร็จแล้ว)
• !reel rebuild [id] — สร้างเสียง+รูป+วิดีโอใหม่ทั้งหมด (ใช้ script เดิม)
• !reel rescript [id] [category] [effect] — สร้าง script ใหม่ให้ reel ที่ระบุ
• !reel re-voice [id] [voice-id|speed] [speed] — regenerate voice + re-assemble video
• !reel re-images [id] [-stock] — regenerate images + re-assemble video
• !reel re-music [id] [track] — regenerate music mix only (track optional: index or filename)
• !reel re-effect [id] &lt;effect&gt; — re-assemble video with different camera effect

<b>Batch</b>
• !batch N — เตรียม N reels แบบข้ามคืน (batch image API)
• !batch status — ดูสถานะ batch runs
`,
    syncExplainerHeading: "การซิงค์เสียง–คำบรรยาย",
    syncExplainerSteps: [
      "แบ่งคำพูดเป็นบล็อก ≤20 ตัวอักษร (ตัดที่เครื่องหมายวรรคตอน)",
      "แต่ละบล็อกมี base PNG: คำทุกคำสีจาง บน dark box — วาดครั้งเดียว ไม่เปลี่ยนระหว่างบล็อก",
      "แต่ละคำมี highlight PNG: เฉพาะคำนั้นสีเหลือง พื้นหลังโปร่งใส — สลับทับ base",
      "เสียงดีเลย์ 2 วินาที เริ่มหลัง hook caption จางหาย",
    ],
  },

  en: {
    statusLabels: {
      awaiting_approval: "AWAITING APPROVAL",
      approved:          "APPROVED",
      published:         "PUBLISHED",
      rejected:          "REJECTED",
      failed:            "FAILED",
      running:           "RUNNING",
      cancelled:         "CANCELLED",
    },
    statusFooterText: {
      awaiting_approval: "⏳ Awaiting approval — reply in Telegram to approve, edit, or reject",
      approved:          "✅ Approved — scheduled for publishing",
      published:         "🚀 Published",
      rejected:          "🚫 Rejected",
      failed:            "❌ Pipeline failed",
      running:           "⏳ Running...",
      cancelled:         "🛑 Cancelled",
    },
    stageLogsLabel: "Stage Logs",
    reelReviewLink: "Review page",
    latestReel: "Latest reel",
    statusHeading: "Status",
    category: "Category",
    voice: "Voice",
    voiceSpeed: "Voice speed",
    scenes: "Scenes",
    musicVolume: "Music volume",
    music: "Music",
    noneLabel: "None",
    language: "Language",
    cameraEffect: "Camera effect",
    hookCaption: "Hook caption",
    voiceover: "Voiceover",
    subtitleBlocks: "Subtitle blocks",
    scene: "Scene",
    noTimings: "No word timings",
    postCaption: "Post Caption",
    willPostAsFirstComment: "Will post as first comment",
    discoveryBias: "Discovery bias",
    selectionReason: "Selection reason",
    topicsAvoided: "Topics avoided",
    categoryDiscovery: "Category Discovery",
    reelScript: "Reel Script",
    apiSources: "API Sources",
    apiSourceCaptions: "Captions",
    apiSourceImages: "Images",
    sourceProvenanceHeading: "Source provenance",
    helpCommandBody: `📋 <b>Commands — __BRAND_NAME__</b>

<b>Status</b>
• !status — show combined status

<b>Reels</b>
• !reel [-stock] — generate reel (auto discovery + auto category)
• !reel text — start manual authoritative text intake (source required)
• !reel hint — start hint intake for discovery guidance (source required)
• !reel &lt;theme&gt; [-stock] — generate reel with specific theme
• !reel &lt;url&gt; [-stock] — generate reel from URL
• !reel &lt;url&gt; &lt;category&gt; [-stock] — generate reel from URL with specific category
• !reel &lt;category&gt; [-stock] — generate reel with category: breaking, trending, human_interest, business, open
• !reel &lt;category&gt; &lt;effect&gt; [-stock] — generate reel with category + camera effect: zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, ken_burns, none
• !reel &lt;effect&gt; [-stock] — generate reel (auto category) with specific camera effect
• !reel list — show last 5 reels
• !reel approve — publish latest reel immediately
• !reel approve HH:MM — approve &amp; schedule latest reel today
• !reel approve HH:MM tmr — approve &amp; schedule latest reel tomorrow
• !reel approve &lt;id&gt; — publish specific reel immediately
• !reel approve &lt;id&gt; HH:MM [tmr] — approve &amp; schedule specific reel
• !reel cancel — cancel the currently running reel
• !reel reject [id] — reject reel
• !reel skip — skip the next scheduled run
• !reel skip cancel — reduce skip by 1 · skip cancel all — cancel all
• !reel status — show latest reel status + review link
• !reel confirm &lt;id&gt; — confirm headline and continue to script/voice/images/video
• !reel resume &lt;id&gt; — resume from last completed stage (skips done work)
• !reel rebuild [id] — force re-run voice + images + video (keeps script)
• !reel rescript [id] [category] [effect] — regenerate script + video for a reel
• !reel re-voice [id] [voice-id|speed] [speed] — regenerate voice + re-assemble video
• !reel re-images [id] [-stock] — regenerate images + re-assemble video
• !reel re-music [id] [track] — regenerate music mix only (track optional: index or filename)
• !reel re-effect [id] &lt;effect&gt; — re-assemble video with different camera effect

<b>Batch</b>
• !batch N — prep N reels overnight (batch image API, 50% cheaper)
• !batch status — show batch run history
`,
    syncExplainerHeading: "Voiceover–Subtitle sync",
    syncExplainerSteps: [
      "Words split into blocks of ≤8 (breaks at punctuation).",
      "Each block: static base PNG — all words dimmed on dark box, rendered once.",
      "Each word: highlight PNG — only that word in yellow, transparent bg, swaps on top.",
      "Audio delayed 2s so voice starts after hook caption fades out.",
    ],
  },

  de: {
    statusLabels: {
      awaiting_approval: "AUF FREIGABE WARTEND",
      approved:          "GENEHMIGT",
      published:         "VERÖFFENTLICHT",
      rejected:          "ABGELEHNT",
      failed:            "FEHLGESCHLAGEN",
      running:           "LÄUFT",
      cancelled:         "ABGEBROCHEN",
    },
    statusFooterText: {
      awaiting_approval: "⏳ Wartet auf Freigabe — antworte in Telegram zum Genehmigen, Bearbeiten oder Ablehnen",
      approved:          "✅ Genehmigt — zur Veröffentlichung eingeplant",
      published:         "🚀 Veröffentlicht",
      rejected:          "🚫 Abgelehnt",
      failed:            "❌ Pipeline fehlgeschlagen",
      running:           "⏳ Läuft...",
      cancelled:         "🛑 Abgebrochen",
    },
    stageLogsLabel: "Ablaufprotokoll",
    reelReviewLink: "Review-Seite",
    latestReel: "Neuestes Reel",
    statusHeading: "Status",
    category: "Kategorie",
    voice: "Stimme",
    voiceSpeed: "Sprechgeschwindigkeit",
    scenes: "Szenen",
    musicVolume: "Musiklautstärke",
    music: "Musik",
    noneLabel: "Keine",
    language: "Sprache",
    cameraEffect: "Kameraeffekt",
    hookCaption: "Hook-Beschriftung",
    voiceover: "Voiceover",
    subtitleBlocks: "Untertitel-Blöcke",
    scene: "Szene",
    noTimings: "Keine Word-Timings",
    postCaption: "Beitragsbeschriftung",
    willPostAsFirstComment: "Wird als erster Kommentar gepostet",
    discoveryBias: "Discovery-Bias",
    selectionReason: "Auswahlgrund",
    topicsAvoided: "Vermiedene Themen",
    categoryDiscovery: "Kategorie-Discovery",
    reelScript: "Reel-Skript",
    apiSources: "API-Quellen",
    apiSourceCaptions: "Beschriftungen",
    apiSourceImages: "Bilder",
    sourceProvenanceHeading: "Quellen-Nachweis",
    helpCommandBody: `📋 <b>Befehle — __BRAND_NAME__</b>

<b>Status</b>
• !status — kombinierten Status anzeigen

<b>Reels</b>
• !reel [-stock] — Reel generieren (auto discovery + auto category)
• !reel text — manuelle Text-Eingabe starten (Quelle erforderlich)
• !reel hint — Hint-Eingabe für Discovery-Unterstützung starten (Quelle erforderlich)
• !reel &lt;theme&gt; [-stock] — Reel mit spezifischem Theme generieren
• !reel &lt;url&gt; [-stock] — Reel aus URL generieren
• !reel &lt;url&gt; &lt;category&gt; [-stock] — Reel aus URL mit spezifischer Kategorie
• !reel &lt;category&gt; [-stock] — Reel mit Kategorie: breaking, trending, human_interest, business, open
• !reel &lt;category&gt; &lt;effect&gt; [-stock] — Reel mit Kategorie + Kameraeffekt: zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, ken_burns, none
• !reel &lt;effect&gt; [-stock] — Reel (auto category) mit spezifischem Kameraeffekt
• !reel list — letzte 5 Reels anzeigen
• !reel approve — neuestes Reel sofort veröffentlichen
• !reel approve HH:MM — neuestes Reel heute veröffentlichen um HH:MM
• !reel approve HH:MM tmr — neuestes Reel morgen veröffentlichen um HH:MM
• !reel approve &lt;id&gt; — spezifisches Reel sofort veröffentlichen
• !reel approve &lt;id&gt; HH:MM [tmr] — spezifisches Reel einplanen
• !reel cancel — laufendes Reel abbrechen
• !reel reject [id] — Reel ablehnen
• !reel skip — nächsten geplanten Lauf überspringen
• !reel skip cancel — Skip um 1 reduzieren · skip cancel all — alle abbrechen
• !reel status — neuesten Reel-Status + Review-Link anzeigen
• !reel confirm &lt;id&gt; — Schlagzeile bestätigen und mit script/voice/images/video fortfahren
• !reel resume &lt;id&gt; — ab letzter abgeschlossener Stage fortsetzen (überspringt fertige Arbeit)
• !reel rebuild [id] — Voice + Bilder + Video neu generieren (behält Skript)
• !reel rescript [id] [category] [effect] — Skript + Video für ein Reel neu generieren
• !reel re-voice [id] [voice-id|speed] [speed] — Voice neu generieren + Video neu assemblieren
• !reel re-images [id] [-stock] — Bilder neu generieren + Video neu assembrieren
• !reel re-music [id] [track] — Musik-Mix neu generieren (Track optional: Index oder Dateiname)
• !reel re-effect [id] &lt;effect&gt; — Video mit anderem Kameraeffekt neu assembrieren

<b>Batch</b>
• !batch N — N Reels über Nacht vorbereiten (Batch Image API, 50% günstiger)
• !batch status — Batch-Lauf-Historie anzeigen
`,
    syncExplainerHeading: "Voiceover–Untertitel-Synchronisation",
    syncExplainerSteps: [
      "Wörter werden in Blöcke von ≤8 geteilt (Umbruch bei Satzzeichen).",
      "Jeder Block: statisches Base-PNG — alle Wörter abgedunkelt auf dunklem Kasten, einmal gerendert.",
      "Jedes Wort: Highlight-PNG — nur dieses Wort in Gelb, transparenter Hintergrund, wird darübergelegt.",
      "Audio 2s verzögert, damit die Stimme einsetzt, nachdem die Hook-Beschriftung ausgeblendet ist.",
    ],
  },
};

export function getUiStrings(lang: UiLang): UiStringSet {
  const s = UI_STRINGS[lang];
  if (!s) throw new Error(`Unknown UI language: ${lang}`);
  return s;
}
