export type ReelLang = "th" | "en" | "de";

export interface ReelStringSet {
  langLabel: string;
  languageLine: string;
  hooksBlock: string;
  ctaBlock: string;
  wordCountBlock: string;
  ttsBlock: string;
  ctaSignals: RegExp[];
  ctaAppends: string[];
}

export const REEL_STRINGS: Record<ReelLang, ReelStringSet> = {
  th: {
    langLabel: "Thai",
    languageLine: "ภาษา: เขียนทั้งหมดเป็นภาษาไทยเท่านั้น ห้ามมีคำภาษาอังกฤษในสคริปต์ ยกเว้นชื่อเฉพาะที่ไม่มีคำแปลไทย (เช่น NASA, WHO, EU)",
    hooksBlock: `
Engagement hooks ที่ใช้ได้:
- "รู้ไหมว่า..."
- "สิ่งที่หลายคนไม่รู้คือ..."
- "เพิ่งเกิดขึ้น..."
- "ฟังดูแปลก แต่..."
ห้ามใช้ clickbait หรือจังหวะยั่วยุ:
❌ "คุณจะไม่เชื่อว่า..."
❌ "ช็อกมาก!"
❌ "นี่คือเรื่องราวที่..."
❌ "ทุกคนกำลังพูดถึงเรื่องนี้"
`,
    ctaBlock: `CTA (Call-to-Action): จบฉากสุดท้ายด้วย CTA แบบใดแบบหนึ่ง:
- ค่านิยม (value-specific): "ติดตาม ThaiDaily เพื่อรับข่าวสำคัญทุกวันก่อนใคร" หรือ "กดติดตามเพื่อไม่พลาดข่าวที่สำคัญที่สุดของวัน"
- ต่อเนื่อง (story-continuation): "อยากรู้ว่าเรื่องนี้จะพัฒนาไปอย่างไร ติดตามเราไว้"
- FOMO: "ข่าวพรุ่งนี้มาแน่ กดติดตามเลย"
ห้ามใช้:
❌ "อย่าลืมกดไลค์ กดแชร์ กดติดตาม"
❌ "ถ้าชอบคลิปนี้..."
`,
    wordCountBlock: `สำคัญ: แต่ละฉากต้องมี 25-45 คำ ประโยคไม่เกิน 20 คำต่อประโยค ใส่รายละเอียดเฉพาะเจาะจง: ชื่อ ตัวเลข สถานที่ เวลา ข้อเท็จจริงจากแหล่งข่าว
ใช้ประโยคสั้นสลับกับประโยคยาวเพื่อสร้างจังหวะ
สคริปต์รวม {{sceneCount}} ฉาก: ความยาวเสียงรวม 28–35 วินาที (TTS ความเร็วปกติ)`,
    ttsBlock: `
ข้อควรระวังสำหรับ TTS:
- ใช้เลขอารบิก (1, 2, 3) ไม่ใช่เลขไทย (๑, ๒, ๓)
- เปอร์เซ็นต์: เขียน "18 เปอร์เซ็นต์" ไม่ใช่ "18%" — TTS มักข้ามสัญลักษณ์ %
- สกุลเงิน: เขียน "200 บาท" ไม่ใช่ "฿200" — TTS ไม่ออกเสียงสัญลักษณ์บาท
- อย่าจบประโยคด้วย "..." (ellipsis) — TTS ออกเสียงจุดสามจุดแปลกๆ ใช้จุดเดียวหรือไม่ใส่เครื่องหมาย
`,
    ctaSignals: [
      /ติดตาม/,
      /กดติดตาม/,
      /ต่อไป/,
      /พรุ่งนี้/,
      /ไม่พลาด/,
      /อย่าพลาด/,
      /เพื่อรับข่าว/,
      /เพื่อไม่พลาด/,
    ],
    ctaAppends: [
      " กดติดตามเพื่อไม่พลาดข่าวสำคัญ",
      " ติดตามเราเพื่อรับข่าวอัปเดตทุกวัน",
      " ติดตามเพื่อดูว่าเรื่องนี้จะจบอย่างไร",
    ],
  },

  en: {
    langLabel: "English",
    languageLine: "LANGUAGE: Write entirely in English.",
    hooksBlock: "",
    ctaBlock: `CTA (Call-to-Action): End the FINAL scene with a clear follow call-to-action:
- Value-specific: "Follow WorldBrief for daily updates" or "Hit follow so you don't miss tomorrow's story."
- Story-continuation: "Follow to see how this develops"
- FOMO: "Follow now — tomorrow's story is even bigger"
Avoid:
❌ "Like, share, and subscribe"
❌ "If you enjoyed this video..."
Weave it naturally into the scene — do not make it sound like an ad.
`,
    wordCountBlock: `CRITICAL: Each scene voiceover must be 20-35 words. Aim for at least 25 words per scene to ensure enough detail. Count carefully — going over 35 words makes the reel too long. Pack each scene with concrete details: names, numbers, locations, times, and specific facts from the source.`,
    ttsBlock: "",
    ctaSignals: [
      /\bfollow\b/i,
      /\bstay tuned\b/i,
      /\bsubscribe\b/i,
      /\bdon't miss\b/i,
      /\bwon't want to miss\b/i,
      /\bhit follow\b/i,
      /\bkeep watching\b/i,
      /\bsee how this\b/i,
      /\bfor more\b/i,
      /\bfor updates\b/i,
      /\bfor daily\b/i,
      /\btomorrow'?s\b/i,
      /\bnext time\b/i,
    ],
    ctaAppends: [
      " Follow for updates.",
      " Follow so you don't miss what happens next.",
      " Hit follow for daily updates.",
      " Stay tuned — this story is far from over.",
    ],
  },

  de: {
    langLabel: "German",
    languageLine: "SPRACHE: Schreibe vollständig auf Deutsch. Keine englischen Wörter im Skript, außer Eigennamen ohne deutsche Übersetzung (z. B. NASA, WHO, EU).",
    hooksBlock: `
Engagement-Hooks, die funktionieren:
- "Wusstest du, dass..."
- "Was viele nicht wissen..."
- "Gerade erst passiert..."
- "Klingt verrückt, aber..."
Keine Klickköder, keine reißerischen Phrasen:
❌ "Du wirst nicht glauben, was..."
❌ "Schockierend!"
❌ "Das ist die Geschichte, die..."
❌ "Alle reden über..."
`,
    ctaBlock: `CTA (Call-to-Action): Beende die LETZTE Szene mit einem klaren Follow-CTA:
- Wertbezogen: "Folge TagesBrief für die wichtigsten Nachrichten jeden Tag" oder "Folge uns, um die Geschichte des Tages nicht zu verpassen."
- Fortsetzung: "Folge uns, um zu sehen, wie sich das entwickelt."
- FOMO: "Jetzt folgen — die Geschichte von morgen wird noch größer."
Vermeide:
❌ "Liken, teilen und abonnieren"
❌ "Wenn dir dieses Video gefallen hat..."
Baue es natürlich in die Szene ein — es darf nicht wie Werbung klingen.`,
    wordCountBlock: `WICHTIG: Jede Szene muss 20-35 Wörter haben. Strebe mindestens 25 Wörter pro Szene an, damit genug Details enthalten sind. Zähle sorgfältig — über 35 Wörter wird das Reel zu lang. Packe konkrete Details in jede Szene: Namen, Zahlen, Orte, Zeiten und Fakten aus der Quelle.`,
    ttsBlock: `
TTS-Hinweise:
- Verwende arabische Ziffern (1, 2, 3), nicht ausgeschriebene Zahlen.
- Prozent: Schreibe "18 Prozent", nicht "18 %" — TTS überspringt oft das %-Symbol.
- Währung: Schreibe "200 Euro", nicht "200 €" — TTS spricht das €-Symbol nicht zuverlässig.
- Keine Auslassungspunkte ("...") am Satzende — TTS spricht drei Punkte seltsam aus. Verwende einen einzelnen Punkt oder kein Zeichen.
`,
    ctaSignals: [
      /\bfolge\b/i,
      /\bfolgenden?\b/i,
      /\babonniere\b/i,
      /\bnicht verpassen\b/i,
      /\bverpasst nicht\b/i,
      /\bmorgen\b/i,
      /\bupdates\b/i,
      /\btages\b/i,
    ],
    ctaAppends: [
      " Folge TagesBrief für tägliche Updates.",
      " Folge uns, um nicht zu verpassen, was als Nächstes passiert.",
      " Jetzt folgen für die wichtigsten Nachrichten jeden Tag.",
      " Bleib dran — diese Geschichte ist noch nicht zu Ende.",
    ],
  },
};
