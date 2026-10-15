import type { StoryReelAudienceLanguage } from "../storyreel/types.js";

export interface BotMessages {
  // Setup wizard
  chooseLanguage: string;
  askProfileName: string;
  askAudienceDescription: string;
  skipButton: string;
  confirmSetup: (name: string, lang: string, audience: string) => string;
  confirmButton: string;
  startOverButton: string;
  setupComplete: string;
  setupRequestSent: string;
  setupRejected: string;
  // Run wizard
  askRunNote: string;
  skipRunButton: string;
  confirmRun: (note: string) => string;
  confirmRunButton: string;
  cancelButton: string;
  generatingVideo: string;
  // Tweak wizard
  askTweakNote: string;
  skipTweakButton: string;
  confirmTweakButton: string;
  generatingTweak: string;
  noRecentStory: string;
  // Cancel wizard
  confirmCancelPrompt: string;
  yesClearButton: string;
  keepClipsButton: string;
  cancelComplete: string;
  // Music wizard
  chooseMusicGenre: string;
  musicGenreSet: (genre: string) => string;
  // Story buffer
  clipBuffer: (count: number, maxClips: number, sizeMb: number, durationSec: number) => string;
  runNowButton: string;
  // Help
  helpText: string;
  // Errors / status
  noProfile: string;
  wizardInProgress: string;
  noClips: string;
  alreadyRunning: string;
  profileDisplay: (name: string, lang: string, audience: string, provider: string, voiceId: string, runCount: number) => string;
  clipAccepted: (num: number, max: number, durationSec: number, sizeMb: number) => string;
  clipSizeError: (sizeMb: number) => string;
  clipDurationError: (mins: number, secs: number) => string;
  clipCountError: (count: number) => string;
  clipHorizontalWarning: (num: number) => string;
  adminOnly: string;
  noPendingRequests: string;
  resumingStory: (shortId: string) => string;
  rebuildingStory: (shortId: string, stage: number) => string;
  notApproved: string;
  runOptionsHeader: string;
  runOptionsWithNote: (note: string) => string;
  runOptionsAskNote: string;
  runOptionsSkipNoteButton: string;
  runOptionsConfirmNoteButton: string;
  voiceLabel: (enabled: boolean) => string;
  musicLabel: (enabled: boolean) => string;
  captionsLabel: (enabled: boolean) => string;
  startButton: string;
}

const MESSAGES: Record<StoryReelAudienceLanguage, BotMessages> = {
  english: {
    chooseLanguage: "Choose your language:",
    askProfileName: "What's your profile name?",
    askAudienceDescription: "Describe your audience: (or tap Skip)",
    skipButton: "Skip",
    confirmSetup: (name, lang, audience) =>
      `Profile:\nName: ${name}\nLanguage: ${lang}\nAudience: ${audience || "none"}`,
    confirmButton: "Confirm",
    startOverButton: "Start over",
    setupComplete: "Profile created. Send clips and use !run to start.",
    setupRequestSent: "StoryReel setup request sent for admin approval.",
    setupRejected: "StoryReel setup request was rejected.",
    askRunNote: "Any context note for this story?",
    skipRunButton: "Skip — run now",
    confirmRun: (note) => `Run with note: "${note}"`,
    confirmRunButton: "Confirm",
    cancelButton: "Cancel",
    generatingVideo: "Generating StoryReel video...",
    askTweakNote: "What would you like to change?",
    skipTweakButton: "Skip — re-run as-is",
    confirmTweakButton: "Confirm tweak",
    generatingTweak: "Regenerating StoryReel video with your note...",
    noRecentStory: "No previous story found for this channel. Send clips and use !run to start one.",
    confirmCancelPrompt: "Clear all clips?",
    yesClearButton: "Yes, clear",
    keepClipsButton: "Keep clips",
    cancelComplete: "Intake cleared. Send clips to start a new story.",
    chooseMusicGenre: "Choose a music genre:",
    musicGenreSet: (genre) => `Music set to ${genre}. Will apply on next !run.`,
    clipBuffer: (count, max, sizeMb, durationSec) =>
      `${count}/${max} clips (${sizeMb}MB, ${durationSec}s). Send more or !run to start.`,
    runNowButton: "Run now",
    helpText: [
      "<b>StoryReel Commands</b>",
      "",
      "Send video clips, then use !run to generate your story.",
      "",
      "<b>!setup</b> — Create or update your channel profile",
      "<b>!profile</b> — Show current profile settings",
      "<b>!story</b> — Show clips currently in the buffer",
      "<b>!run</b> — Start generating a story from buffered clips",
      "<b>!tweak</b> — Re-run the last story with a new note",
      "<b>!music</b> — Choose a music genre for the next run",
      "<b>!cancel</b> — Clear the clip buffer",
      "<b>!story resume &lt;id&gt;</b> — Resume a failed run from its last checkpoint",
      "<b>!story rebuild &lt;id&gt; &lt;stage&gt;</b> — Force re-run from a specific stage (1–4)",
      "<b>!voice set -p &lt;provider&gt; -id &lt;id&gt;</b> — Save preferred voice provider and ID",
      "<b>!voice reset</b> — Clear saved voice and auto-select on next run",
      "<b>!help</b> — Show this message",
    ].join("\n"),
    noProfile: "StoryReel is not set up for this chat yet. Send !setup to get started.",
    wizardInProgress: "You're in the middle of a conversation. Re-send the original command to start over.",
    noClips: "No clips in buffer. Send clips before using !run.",
    alreadyRunning: "A story is already being generated for this channel. Wait for it to finish.",
    profileDisplay: (name, lang, audience, provider, voiceId, runCount) =>
      `Profile: ${name}\nLanguage: ${{ thai: "ไทย", english: "English", german: "Deutsch" }[lang] ?? lang}\nAudience: ${audience || "none"}\nPreferred voice: ${provider}/${voiceId}\nRuns completed: ${runCount}`,
    clipAccepted: (num, max, durationSec, sizeMb) => {
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      return `Clip ${num}/${max} received (${mins}m${String(secs).padStart(2, "0")}s, ${sizeMb}MB). Send more or !run to start.`;
    },
    clipSizeError: (sizeMb) => `This clip is ${sizeMb}MB — max is 50MB. Please compress and resend.`,
    clipDurationError: (mins, secs) => `This clip is ${mins}m${String(secs).padStart(2, "0")}s — max is 3 minutes. Please trim and resend.`,
    clipCountError: (count) => `You've already sent ${count} clips. Use !run to start or !cancel to clear.`,
    clipHorizontalWarning: (num) => `Clip ${num} is horizontal (16:9) and will be centre-cropped to 9:16. Subjects near the left/right edges may be cut off.`,
    adminOnly: "Only the StoryReel admin can use !admin commands.",
    noPendingRequests: "No pending StoryReel setup requests.",
    resumingStory: (id) => `Resuming StoryReel <code>${id}</code>...`,
    rebuildingStory: (id, stage) => `Rebuilding StoryReel <code>${id}</code> from stage ${stage}...`,
    notApproved: "StoryReel is not approved for this chat yet. Run !setup to request access.",
    runOptionsHeader: "⚙️ <b>StoryReel Options</b>",
    runOptionsWithNote: (note) => `⚙️ <b>StoryReel Options</b>\n\n📝 ${note}`,
    runOptionsAskNote: "Any context note for this story?",
    runOptionsSkipNoteButton: "Skip — run now",
    runOptionsConfirmNoteButton: "Confirm",
    voiceLabel: (on) => on ? "✅ Voice" : "❌ Voice",
    musicLabel: (on) => on ? "✅ Music" : "❌ Music",
    captionsLabel: (on) => on ? "✅ Captions" : "❌ Captions",
    startButton: "▶️ Start",
  },

  thai: {
    chooseLanguage: "เลือกภาษาของคุณ:",
    askProfileName: "ชื่อโปรไฟล์ของคุณคืออะไร?",
    askAudienceDescription: "อธิบายกลุ่มผู้ชมของคุณ: (หรือกด ข้ามไป)",
    skipButton: "ข้ามไป",
    confirmSetup: (name, lang, audience) =>
      `โปรไฟล์:\nชื่อ: ${name}\nภาษา: ${lang}\nผู้ชม: ${audience || "ไม่ระบุ"}`,
    confirmButton: "ยืนยัน",
    startOverButton: "เริ่มใหม่",
    setupComplete: "สร้างโปรไฟล์แล้ว ส่งคลิปและใช้ !run เพื่อเริ่ม",
    setupRequestSent: "ส่งคำขอตั้งค่า StoryReel เพื่อรออนุมัติจากแอดมินแล้ว",
    setupRejected: "คำขอตั้งค่า StoryReel ถูกปฏิเสธ",
    askRunNote: "มีบันทึกเพิ่มเติมสำหรับวิดีโอนี้ไหม?",
    skipRunButton: "ข้าม — เริ่มเลย",
    confirmRun: (note) => `เริ่มด้วยบันทึก: "${note}"`,
    confirmRunButton: "ยืนยัน",
    cancelButton: "ยกเลิก",
    generatingVideo: "กำลังสร้างวิดีโอ StoryReel...",
    askTweakNote: "คุณต้องการเปลี่ยนแปลงอะไร?",
    skipTweakButton: "ข้าม — เริ่มซ้ำแบบเดิม",
    confirmTweakButton: "ยืนยันการแก้ไข",
    generatingTweak: "กำลังสร้างวิดีโอ StoryReel ใหม่พร้อมบันทึกของคุณ...",
    noRecentStory: "ไม่พบวิดีโอล่าสุดสำหรับช่องนี้ ส่งคลิปและใช้ !run เพื่อเริ่ม",
    confirmCancelPrompt: "ล้างคลิปทั้งหมด?",
    yesClearButton: "ใช่ ล้างเลย",
    keepClipsButton: "เก็บคลิปไว้",
    cancelComplete: "ล้างคลิปแล้ว ส่งคลิปใหม่เพื่อเริ่มเรื่องใหม่",
    chooseMusicGenre: "เลือกแนวเพลง:",
    musicGenreSet: (genre) => `ตั้งดนตรีเป็น ${genre} แล้ว จะใช้ใน !run ครั้งถัดไป`,
    clipBuffer: (count, max, sizeMb, durationSec) =>
      `${count}/${max} คลิป (${sizeMb}MB, ${durationSec}s) ส่งเพิ่มหรือใช้ !run เพื่อเริ่ม`,
    runNowButton: "เริ่มเลย",
    helpText: [
      "<b>คำสั่ง StoryReel</b>",
      "",
      "ส่งคลิปวิดีโอ แล้วใช้ !run เพื่อสร้างวิดีโอ",
      "",
      "<b>!setup</b> — สร้างหรืออัปเดตโปรไฟล์ช่องของคุณ",
      "<b>!profile</b> — แสดงการตั้งค่าโปรไฟล์ปัจจุบัน",
      "<b>!story</b> — แสดงคลิปในคิว",
      "<b>!run</b> — เริ่มสร้างวิดีโอจากคลิปในคิว",
      "<b>!tweak</b> — สร้างวิดีโอล่าสุดใหม่พร้อมบันทึกใหม่",
      "<b>!music</b> — เลือกแนวเพลงสำหรับรันถัดไป",
      "<b>!cancel</b> — ล้างคิวคลิป",
      "<b>!story resume &lt;id&gt;</b> — ดำเนินการต่อจากจุดที่หยุด",
      "<b>!story rebuild &lt;id&gt; &lt;stage&gt;</b> — เริ่มใหม่จาก stage ที่กำหนด (1–4)",
      "<b>!voice set -p &lt;provider&gt; -id &lt;id&gt;</b> — บันทึก provider และ voice id",
      "<b>!voice reset</b> — ล้างเสียงที่บันทึกไว้และเลือกเสียงใหม่อัตโนมัติในครั้งถัดไป",
      "<b>!help</b> — แสดงข้อความนี้",
    ].join("\n"),
    noProfile: "ยังไม่ได้ตั้งค่า StoryReel สำหรับแชทนี้ ส่ง !setup เพื่อเริ่ม",
    wizardInProgress: "คุณกำลังอยู่ระหว่างการสนทนา ส่งคำสั่งเดิมซ้ำเพื่อเริ่มใหม่",
    noClips: "ไม่มีคลิปในคิว ส่งคลิปก่อนใช้ !run",
    alreadyRunning: "กำลังสร้างวิดีโออยู่แล้ว กรุณารอให้เสร็จก่อน",
    profileDisplay: (name, lang, audience, provider, voiceId, runCount) =>
      `โปรไฟล์: ${name}\nภาษา: ${{ thai: "ไทย", english: "English", german: "Deutsch" }[lang] ?? lang}\nผู้ชม: ${audience || "ไม่ระบุ"}\nเสียง: ${provider}/${voiceId}\nวิดีโอที่สร้าง: ${runCount}`,
    clipAccepted: (num, max, durationSec, sizeMb) => {
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      return `คลิป ${num}/${max} ได้รับแล้ว (${mins}m${String(secs).padStart(2, "0")}s, ${sizeMb}MB) ส่งเพิ่มหรือใช้ !run`;
    },
    clipSizeError: (sizeMb) => `คลิปนี้ ${sizeMb}MB — สูงสุด 50MB กรุณาบีบอัดและส่งใหม่`,
    clipDurationError: (mins, secs) => `คลิปนี้ ${mins}m${String(secs).padStart(2, "0")}s — สูงสุด 3 นาที กรุณาตัดและส่งใหม่`,
    clipCountError: (count) => `ส่งมาแล้ว ${count} คลิป ใช้ !run เพื่อเริ่มหรือ !cancel เพื่อล้าง`,
    clipHorizontalWarning: (num) => `คลิป ${num} เป็นแนวนอน (16:9) จะถูกครอปตรงกลางเป็น 9:16 วัตถุใกล้ขอบซ้าย/ขวาอาจถูกตัด`,
    adminOnly: "คำสั่ง !admin ใช้ได้เฉพาะแอดมิน StoryReel เท่านั้น",
    noPendingRequests: "ไม่มีคำขอตั้งค่า StoryReel ที่รอดำเนินการ",
    resumingStory: (id) => `กำลังดำเนินการต่อ StoryReel <code>${id}</code>...`,
    rebuildingStory: (id, stage) => `กำลังสร้าง StoryReel <code>${id}</code> ใหม่จาก stage ${stage}...`,
    notApproved: "StoryReel ยังไม่ได้รับการอนุมัติสำหรับแชทนี้ ส่ง !setup เพื่อขออนุมัติ",
    runOptionsHeader: "⚙️ <b>ตัวเลือก StoryReel</b>",
    runOptionsWithNote: (note) => `⚙️ <b>ตัวเลือก StoryReel</b>\n\n📝 ${note}`,
    runOptionsAskNote: "มีบันทึกเพิ่มเติมสำหรับวิดีโอนี้ไหม?",
    runOptionsSkipNoteButton: "ข้าม — เริ่มเลย",
    runOptionsConfirmNoteButton: "ยืนยัน",
    voiceLabel: (on) => on ? "✅ เสียงพากย์" : "❌ เสียงพากย์",
    musicLabel: (on) => on ? "✅ เพลง" : "❌ เพลง",
    captionsLabel: (on) => on ? "✅ คำบรรยาย" : "❌ คำบรรยาย",
    startButton: "▶️ เริ่ม",
  },

  german: {
    chooseLanguage: "Wähle deine Sprache:",
    askProfileName: "Wie lautet dein Profilname?",
    askAudienceDescription: "Beschreibe dein Publikum: (oder tippe Überspringen)",
    skipButton: "Überspringen",
    confirmSetup: (name, lang, audience) =>
      `Profil:\nName: ${name}\nSprache: ${lang}\nPublikum: ${audience || "keine Angabe"}`,
    confirmButton: "Bestätigen",
    startOverButton: "Von vorne",
    setupComplete: "Profil erstellt. Sende Clips und nutze !run zum Starten.",
    setupRequestSent: "StoryReel-Einrichtungsanfrage zur Admin-Genehmigung gesendet.",
    setupRejected: "StoryReel-Einrichtungsanfrage wurde abgelehnt.",
    askRunNote: "Hast du eine Notiz für dieses Video?",
    skipRunButton: "Überspringen — jetzt starten",
    confirmRun: (note) => `Starten mit Notiz: "${note}"`,
    confirmRunButton: "Bestätigen",
    cancelButton: "Abbrechen",
    generatingVideo: "StoryReel-Video wird erstellt...",
    askTweakNote: "Was möchtest du ändern?",
    skipTweakButton: "Überspringen — erneut ausführen",
    confirmTweakButton: "Anpassung bestätigen",
    generatingTweak: "StoryReel-Video wird mit deiner Notiz neu erstellt...",
    noRecentStory: "Kein vorheriges Video für diesen Kanal gefunden. Sende Clips und nutze !run.",
    confirmCancelPrompt: "Alle Clips löschen?",
    yesClearButton: "Ja, löschen",
    keepClipsButton: "Clips behalten",
    cancelComplete: "Puffer geleert. Sende Clips für eine neue Geschichte.",
    chooseMusicGenre: "Wähle ein Musikgenre:",
    musicGenreSet: (genre) => `Musik auf ${genre} gesetzt. Wird beim nächsten !run verwendet.`,
    clipBuffer: (count, max, sizeMb, durationSec) =>
      `${count}/${max} Clips (${sizeMb}MB, ${durationSec}s). Sende mehr oder !run zum Starten.`,
    runNowButton: "Jetzt starten",
    helpText: [
      "<b>StoryReel Befehle</b>",
      "",
      "Sende Videoclips, dann nutze !run um deine Geschichte zu erstellen.",
      "",
      "<b>!setup</b> — Kanalprofil erstellen oder aktualisieren",
      "<b>!profile</b> — Aktuelle Profileinstellungen anzeigen",
      "<b>!story</b> — Clips im Puffer anzeigen",
      "<b>!run</b> — Geschichte aus gepufferten Clips erstellen",
      "<b>!tweak</b> — Letzte Geschichte mit neuer Notiz neu erstellen",
      "<b>!music</b> — Musikgenre für den nächsten Run wählen",
      "<b>!cancel</b> — Clip-Puffer leeren",
      "<b>!story resume &lt;id&gt;</b> — Fehlgeschlagenen Run fortsetzen",
      "<b>!story rebuild &lt;id&gt; &lt;stage&gt;</b> — Ab einer bestimmten Stage neu starten (1–4)",
      "<b>!voice set -p &lt;provider&gt; -id &lt;id&gt;</b> — Bevorzugte Stimme und Provider speichern",
      "<b>!voice reset</b> — Gespeicherte Stimme löschen und beim nächsten Run automatisch wählen",
      "<b>!help</b> — Diese Nachricht anzeigen",
    ].join("\n"),
    noProfile: "StoryReel ist für diesen Chat noch nicht eingerichtet. Sende !setup.",
    wizardInProgress: "Du befindest dich mitten in einer Konversation. Sende den ursprünglichen Befehl erneut zum Neustart.",
    noClips: "Keine Clips im Puffer. Sende Clips vor der Nutzung von !run.",
    alreadyRunning: "Es wird bereits ein Video für diesen Kanal erstellt. Bitte warte.",
    profileDisplay: (name, lang, audience, provider, voiceId, runCount) =>
      `Profil: ${name}\nSprache: ${{ thai: "ไทย", english: "English", german: "Deutsch" }[lang] ?? lang}\nPublikum: ${audience || "keine Angabe"}\nBevorzugte Stimme: ${provider}/${voiceId}\nAbgeschlossene Runs: ${runCount}`,
    clipAccepted: (num, max, durationSec, sizeMb) => {
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      return `Clip ${num}/${max} empfangen (${mins}m${String(secs).padStart(2, "0")}s, ${sizeMb}MB). Mehr senden oder !run.`;
    },
    clipSizeError: (sizeMb) => `Dieser Clip ist ${sizeMb}MB — max. 50MB. Bitte komprimieren und erneut senden.`,
    clipDurationError: (mins, secs) => `Dieser Clip ist ${mins}m${String(secs).padStart(2, "0")}s — max. 3 Minuten. Bitte kürzen.`,
    clipCountError: (count) => `Du hast bereits ${count} Clips gesendet. !run zum Starten oder !cancel zum Leeren.`,
    clipHorizontalWarning: (num) => `Clip ${num} ist horizontal (16:9) und wird auf 9:16 zugeschnitten. Motive am Rand können abgeschnitten werden.`,
    adminOnly: "Nur der StoryReel-Admin kann !admin-Befehle verwenden.",
    noPendingRequests: "Keine ausstehenden StoryReel-Einrichtungsanfragen.",
    resumingStory: (id) => `StoryReel <code>${id}</code> wird fortgesetzt...`,
    rebuildingStory: (id, stage) => `StoryReel <code>${id}</code> wird ab Stage ${stage} neu erstellt...`,
    notApproved: "StoryReel ist für diesen Chat noch nicht freigegeben. Sende !setup zur Anfrage.",
    runOptionsHeader: "⚙️ <b>StoryReel Optionen</b>",
    runOptionsWithNote: (note) => `⚙️ <b>StoryReel Optionen</b>\n\n📝 ${note}`,
    runOptionsAskNote: "Hast du eine Notiz für dieses Video?",
    runOptionsSkipNoteButton: "Überspringen — jetzt starten",
    runOptionsConfirmNoteButton: "Bestätigen",
    voiceLabel: (on) => on ? "✅ Stimme" : "❌ Stimme",
    musicLabel: (on) => on ? "✅ Musik" : "❌ Musik",
    captionsLabel: (on) => on ? "✅ Untertitel" : "❌ Untertitel",
    startButton: "▶️ Start",
  },
};

export function getMessages(lang: StoryReelAudienceLanguage = "english"): BotMessages {
  return MESSAGES[lang] ?? MESSAGES.english;
}
