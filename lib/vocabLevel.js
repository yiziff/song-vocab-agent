import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWordSet } from "./match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "..", "data");
const CET4_PATH = path.join(DATA, "cet4_words.txt");
const CET6_PATH = path.join(DATA, "cet6_words.txt");

/** @typedef {"cet4"|"cet6"|"both"} VocabLevel */

const LABELS = {
  cet4: "四级",
  cet6: "六级",
  both: "四级+六级",
};

let lexiconCache = null;

export function levelLabel(level) {
  return LABELS[normalizeLevel(level)] || LABELS.both;
}

/** @returns {VocabLevel} */
export function normalizeLevel(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "cet4" || s === "4" || s === "四级") return "cet4";
  if (s === "cet6" || s === "6" || s === "六级") return "cet6";
  if (s === "both" || s === "all" || s === "cet46" || s === "四六级" || s === "全部") {
    return "both";
  }
  return "both";
}

function loadLexicons() {
  if (lexiconCache) return lexiconCache;
  lexiconCache = {
    cet4: loadWordSet(CET4_PATH),
    cet6: loadWordSet(CET6_PATH),
  };
  return lexiconCache;
}

/** Word set used to decide membership for a level. */
export function lexiconForLevel(level) {
  const lv = normalizeLevel(level);
  const { cet4, cet6 } = loadLexicons();
  if (lv === "cet4") return cet4;
  if (lv === "cet6") return cet6;
  const both = new Set(cet4);
  for (const w of cet6) both.add(w);
  return both;
}

/**
 * Filter a full (CET-4∪CET-6) song index down to one level.
 * @param {{ words?: Record<string, Array>, artist?: string, song_count?: number, word_count?: number }} fullIndex
 * @param {string} level
 */
export function filterIndexByLevel(fullIndex, level) {
  const lv = normalizeLevel(level);
  const words = fullIndex?.words || {};
  if (lv === "both") {
    return {
      ...fullIndex,
      level: lv,
      level_label: levelLabel(lv),
      word_count: Object.keys(words).length,
      words,
    };
  }
  const lex = lexiconForLevel(lv);
  /** @type {Record<string, Array>} */
  const filtered = {};
  for (const [w, occs] of Object.entries(words)) {
    if (lex.has(w)) filtered[w] = occs;
  }
  return {
    ...fullIndex,
    level: lv,
    level_label: levelLabel(lv),
    word_count: Object.keys(filtered).length,
    words: filtered,
  };
}

/**
 * @param {object} fullIndex
 * @param {string} level
 * @param {Set<string>} [known]
 */
export function deckFromIndex(fullIndex, level, known) {
  const filtered = filterIndexByLevel(fullIndex, level);
  const skip = known instanceof Set ? known : new Set();
  const entries = Object.entries(filtered.words)
    .filter(([w]) => !skip.has(w))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const deck = entries.map(([word, occs]) => ({ word, ...occs[0] }));
  return {
    level: filtered.level,
    level_label: filtered.level_label,
    word_count: filtered.word_count,
    unknown_count: deck.length,
    deck,
    index: filtered,
  };
}

export function availableLevels() {
  return [
    { id: "cet4", label: LABELS.cet4 },
    { id: "cet6", label: LABELS.cet6 },
    { id: "both", label: LABELS.both },
  ];
}
