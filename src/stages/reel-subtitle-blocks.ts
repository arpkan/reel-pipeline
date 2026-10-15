import type { WordTiming } from "../types.js";

export type SubtitleBlock = WordTiming[];

const SENTENCE_END = /[.!?।…]+$/;
const CLAUSE_BREAK = /[,;:]+$/;
const STANDALONE_PUNCT = /^[.!?।…,;:]+$/;
const THAI_RANGE = /[\u0E00-\u0E7F]/;
const MAX_THAI_CHARS = 20;
const MAX_BLOCK_WORDS = 8;

export function splitIntoBlocks(wordTimings: WordTiming[], maxWords = MAX_BLOCK_WORDS): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = [];
  let cur: SubtitleBlock = [];
  let curChars = 0;
  const thai = wordTimings.length > 0 && THAI_RANGE.test(wordTimings[0].word);

  for (const wt of wordTimings) {
    if (STANDALONE_PUNCT.test(wt.word.trim())) {
      const target = cur.length > 0 ? cur : blocks[blocks.length - 1];
      if (target) {
        target[target.length - 1] = { ...target[target.length - 1], word: target[target.length - 1].word + wt.word };
        if (SENTENCE_END.test(wt.word) && cur.length > 0) { blocks.push(cur); cur = []; curChars = 0; }
      }
      continue;
    }

    cur.push(wt);
    curChars += wt.word.length;

    const isSentenceEnd = SENTENCE_END.test(wt.word);
    const isClauseBreak = !isSentenceEnd && CLAUSE_BREAK.test(wt.word);
    const isMaxReached = thai ? curChars >= MAX_THAI_CHARS : cur.length >= maxWords;
    const softBreak = thai ? (isClauseBreak && curChars >= 8) : (isClauseBreak && cur.length >= 4);

    if (isSentenceEnd || isMaxReached || softBreak) {
      blocks.push(cur); cur = []; curChars = 0;
    }
  }

  if (cur.length > 0) blocks.push(cur);
  return avoidOneWordOrphan(blocks, thai);
}

function avoidOneWordOrphan(blocks: SubtitleBlock[], thai: boolean): SubtitleBlock[] {
  if (thai || blocks.length < 2) return blocks;
  const last = blocks[blocks.length - 1];
  const prev = blocks[blocks.length - 2];
  if (last.length !== 1 || prev.length <= 2) return blocks;

  return [
    ...blocks.slice(0, -2),
    prev.slice(0, -1),
    [prev[prev.length - 1], ...last],
  ];
}
