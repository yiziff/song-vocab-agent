/**
 * Persist known words for retention loop (Ch.08-lite).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");
export const KNOWN_PATH = path.join(OUT, "known_words.json");

/** Quiz unlocks only after learning more than this many words today. */
export const QUIZ_UNLOCK_AFTER_TODAY = 5;

/**
 * Shape:
 * {
 *   words: string[],
 *   by_song?: { [song_id]: string[] },
 *   today?: {
 *     date: "YYYY-MM-DD",
 *     words: string[],
 *     items?: Array<{ word, line, song_name, artist, song_id }>
 *   },
 *   updated_at?: string
 * }
 * Legacy: bare string[] is still accepted.
 */

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function emptyToday() {
  return { date: todayKey(), words: [], items: [] };
}

function normalizeToday(rawToday) {
  if (!rawToday || rawToday.date !== todayKey()) {
    return emptyToday();
  }
  const words = Array.isArray(rawToday.words)
    ? rawToday.words.map((w) => String(w).toLowerCase())
    : [];
  const items = Array.isArray(rawToday.items)
    ? rawToday.items
        .filter((it) => it && it.word)
        .map((it) => ({
          word: String(it.word).toLowerCase(),
          line: String(it.line || ""),
          song_name: String(it.song_name || ""),
          artist: String(it.artist || ""),
          song_id: String(it.song_id || ""),
        }))
    : [];
  return { date: rawToday.date, words, items };
}

export function loadKnownDoc() {
  if (!fs.existsSync(KNOWN_PATH)) {
    return { words: [], by_song: {}, today: emptyToday() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(KNOWN_PATH, "utf8"));
    if (Array.isArray(raw)) {
      return {
        words: raw.map(String),
        by_song: {},
        today: emptyToday(),
      };
    }
    const words = Array.isArray(raw.words) ? raw.words.map(String) : [];
    const by_song =
      raw.by_song && typeof raw.by_song === "object" ? raw.by_song : {};
    return {
      words,
      by_song,
      today: normalizeToday(raw.today),
      updated_at: raw.updated_at,
    };
  } catch {
    return { words: [], by_song: {}, today: emptyToday() };
  }
}

export function loadKnown() {
  return new Set(loadKnownDoc().words);
}

export function saveKnownDoc(doc) {
  fs.mkdirSync(OUT, { recursive: true });
  const today = normalizeToday(doc.today);
  const payload = {
    words: [...new Set((doc.words || []).map(String))].sort(),
    by_song: doc.by_song || {},
    today,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(KNOWN_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

export function saveKnown(set) {
  const doc = loadKnownDoc();
  doc.words = [...set];
  return saveKnownDoc(doc);
}

/**
 * Mark a word as known. Returns updated doc + stats.
 * @param {{ word: string, song_id?: string, song_name?: string, line?: string, artist?: string }} input
 */
export function markKnown(input) {
  const word = String(input.word || "")
    .trim()
    .toLowerCase();
  if (!word) throw new Error("word required");

  const doc = loadKnownDoc();
  const words = new Set(doc.words);
  words.add(word);
  doc.words = [...words];

  const songId = String(input.song_id || "").trim();
  if (songId) {
    if (!doc.by_song[songId]) doc.by_song[songId] = [];
    const set = new Set(doc.by_song[songId].map(String));
    set.add(word);
    doc.by_song[songId] = [...set].sort();
  }

  doc.today = normalizeToday(doc.today);
  const todaySet = new Set(doc.today.words);
  todaySet.add(word);
  doc.today.words = [...todaySet].sort();

  const item = {
    word,
    line: String(input.line || ""),
    song_name: String(input.song_name || ""),
    artist: String(input.artist || ""),
    song_id: songId,
  };
  const items = (doc.today.items || []).filter((it) => it.word !== word);
  items.push(item);
  doc.today.items = items;

  const saved = saveKnownDoc(doc);
  const songsTouched = Object.keys(saved.by_song || {}).length;
  const todayCount = saved.today.words.length;
  return {
    ok: true,
    word,
    known_count: saved.words.length,
    today_count: todayCount,
    songs_touched: songsTouched,
    today_words: saved.today.words,
    quiz_unlocked: todayCount > QUIZ_UNLOCK_AFTER_TODAY,
    quiz_need: Math.max(0, QUIZ_UNLOCK_AFTER_TODAY + 1 - todayCount),
    doc: saved,
  };
}

export function knownStats() {
  const doc = loadKnownDoc();
  const todayCount = (doc.today?.words || []).length;
  return {
    known_count: doc.words.length,
    today_count: todayCount,
    songs_touched: Object.keys(doc.by_song || {}).length,
    today_words: doc.today?.words || [],
    today_items: doc.today?.items || [],
    words: doc.words,
    quiz_unlocked: todayCount > QUIZ_UNLOCK_AFTER_TODAY,
    quiz_need: Math.max(0, QUIZ_UNLOCK_AFTER_TODAY + 1 - todayCount),
    quiz_unlock_after: QUIZ_UNLOCK_AFTER_TODAY,
  };
}

/**
 * Build quiz pool strictly from today's learned CET words (+ lyric context).
 * Falls back to index occurrence if item has no line.
 * @param {object} fullIndex
 * @param {Set<string>} [vocabSet] optional CET filter; if provided, drop non-vocab words
 */
export function todayLearnedQuizPool(fullIndex, vocabSet) {
  const doc = loadKnownDoc();
  const today = normalizeToday(doc.today);
  const wordsMap = fullIndex?.words || {};
  /** @type {Map<string, { word, line, song_name, artist, song_id }>} */
  const byWord = new Map();

  for (const it of today.items || []) {
    const w = String(it.word || "").toLowerCase();
    if (!w) continue;
    if (vocabSet && !vocabSet.has(w)) continue;
    if (!wordsMap[w]) continue; // must be in current artist CET index
    byWord.set(w, {
      word: w,
      line: it.line || wordsMap[w][0]?.line || "",
      song_name: it.song_name || wordsMap[w][0]?.song_name || "",
      artist: it.artist || wordsMap[w][0]?.artist || fullIndex.artist || "",
      song_id: it.song_id || String(wordsMap[w][0]?.song_id || ""),
    });
  }

  // Words listed today but missing from items (legacy)
  for (const w of today.words || []) {
    const key = String(w).toLowerCase();
    if (byWord.has(key)) continue;
    if (vocabSet && !vocabSet.has(key)) continue;
    const occs = wordsMap[key];
    if (!occs?.length) continue;
    const o = occs[0];
    byWord.set(key, {
      word: key,
      line: o.line || "",
      song_name: o.song_name || "",
      artist: o.artist || fullIndex.artist || "",
      song_id: String(o.song_id || ""),
    });
  }

  return [...byWord.values()];
}
