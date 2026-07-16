/**
 * Deterministic learn_song: resolve song → vocab deck sorted by t_ms.
 */

import { lookupGloss } from "./enrich.js";
import { filterIndexByLevel } from "./vocabLevel.js";

export function normalizeSongQuery(q) {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/^["'《]|["'》]$/g, "")
    .replace(/\s+/g, " ");
}

/**
 * List unique songs in an index (optionally level-filtered).
 * @param {object} index
 */
export function listSongsInIndex(index) {
  /** @type {Map<string, { song_id: string, song_name: string, artist: string }>} */
  const map = new Map();
  for (const occs of Object.values(index?.words || {})) {
    for (const o of occs || []) {
      const id = String(o.song_id);
      if (!map.has(id)) {
        map.set(id, {
          song_id: id,
          song_name: o.song_name || "",
          artist: o.artist || index?.artist || "",
        });
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    a.song_name.localeCompare(b.song_name)
  );
}

/**
 * Fuzzy match song by name.
 * @returns {{ song_id, song_name, artist } | null}
 */
export function resolveSong(index, songName) {
  const q = normalizeSongQuery(songName);
  if (!q) return null;
  const songs = listSongsInIndex(index);
  if (!songs.length) return null;

  // Exact (case-insensitive)
  let hit = songs.find((s) => normalizeSongQuery(s.song_name) === q);
  if (hit) return hit;

  // Includes either way
  hit = songs.find((s) => {
    const n = normalizeSongQuery(s.song_name);
    return n.includes(q) || q.includes(n);
  });
  if (hit) return hit;

  // Strip featuring / parenthetical noise
  const bare = q.replace(/\s*\(.*?\)\s*/g, "").trim();
  if (bare && bare !== q) {
    hit = songs.find((s) => normalizeSongQuery(s.song_name).includes(bare));
    if (hit) return hit;
  }

  return null;
}

/**
 * Build per-song vocab list from index (one occurrence per word, earliest t_ms).
 * @param {object} fullIndex
 * @param {string} songName
 * @param {{ level?: string, known?: Set<string> }} [opts]
 */
export function learnSong(fullIndex, songName, opts = {}) {
  const level = opts.level || fullIndex?.level || "both";
  const index = filterIndexByLevel(fullIndex, level);
  const known = opts.known instanceof Set ? opts.known : new Set();

  const q = String(songName || "").trim();
  if (!q) {
    return {
      ok: false,
      recoverable: true,
      code: "missing_song_name",
      message: "需要 song_name",
      hint: "请提供歌名，例如 Runaway",
      suggestions: listSongsInIndex(index)
        .slice(0, 8)
        .map((s) => s.song_name),
    };
  }

  const song = resolveSong(index, q);
  if (!song) {
    return {
      ok: false,
      recoverable: true,
      code: "song_not_found",
      message: `未找到歌曲：${q}`,
      hint: "试试更短的歌名，或从 suggestions 里选一首已建库的歌",
      suggestions: listSongsInIndex(index)
        .slice(0, 12)
        .map((s) => s.song_name),
    };
  }

  /** @type {Map<string, object>} */
  const byWord = new Map();
  for (const [word, occs] of Object.entries(index.words || {})) {
    if (known.has(word)) continue;
    for (const o of occs || []) {
      if (String(o.song_id) !== song.song_id) continue;
      const prev = byWord.get(word);
      const t = Number(o.t_ms) || 0;
      if (!prev || t < (Number(prev.t_ms) || 0)) {
        byWord.set(word, {
          word,
          song_id: song.song_id,
          song_name: song.song_name,
          artist: o.artist || song.artist,
          t_ms: t,
          line: o.line || "",
          line_zh: o.line_zh || "",
          precision: o.precision || "line",
          gloss: lookupGloss(word),
        });
      }
    }
  }

  const words = [...byWord.values()].sort(
    (a, b) => (a.t_ms || 0) - (b.t_ms || 0) || a.word.localeCompare(b.word)
  );

  if (!words.length) {
    return {
      ok: false,
      recoverable: true,
      code: "no_vocab_in_song",
      message: `《${song.song_name}》在当前词表等级下没有可学单词`,
      hint: "可切换 level 为 both，或换一首歌",
      song,
      words: [],
      first: null,
      level: index.level,
      level_label: index.level_label,
    };
  }

  return {
    ok: true,
    song,
    words,
    first: words[0],
    count: words.length,
    level: index.level,
    level_label: index.level_label,
    seek_hint: formatSeekHint(words[0].t_ms),
  };
}

export function formatSeekHint(tMs) {
  const ms = Number(tMs) || 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `约 ${m}:${String(s).padStart(2, "0")}（请手动拖进度条）`;
}

/** OpenAI/DeepSeek tool definition for Mode B. */
export const LEARN_SONG_TOOL = {
  type: "function",
  function: {
    name: "learn_song",
    description:
      "按歌名开始学习：从本地歌词词库抽出该歌的四六级难点词，按出现时间排序，并返回第一词时间戳。" +
      "当用户说「我要学某某歌」「学 Runaway」「打开某首歌的词卡」时使用。" +
      "不要用于只查单个单词（用 find_word_in_songs）；不要用于播放控制。",
    parameters: {
      type: "object",
      properties: {
        song_name: {
          type: "string",
          description: "歌名，例如 Runaway 或 All of the Lights",
        },
      },
      required: ["song_name"],
      additionalProperties: false,
    },
  },
};
