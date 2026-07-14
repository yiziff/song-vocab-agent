/**
 * Core capability: look up a word in a local CET-4/6 song index.
 * Shared by Mode A (direct search) and Mode B (agent tool).
 */

/** Normalize user input to index key. */
export function normalizeWord(word) {
  return String(word || "")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, "");
}

/**
 * @param {{ words?: Record<string, Array>, artist?: string }} index
 * @param {string} word
 * @returns {{ word: string, found: boolean, count: number, artist?: string, occurrences: Array }}
 */
export function findWordInSongs(index, word) {
  const key = normalizeWord(word);
  if (!key) {
    return {
      word: "",
      found: false,
      count: 0,
      artist: index?.artist || "",
      occurrences: [],
      error: "请输入一个英文单词",
    };
  }

  const occs = index?.words?.[key] || [];
  const occurrences = occs.map((o) => ({
    song_id: String(o.song_id),
    song_name: o.song_name,
    artist: o.artist,
    t_ms: Number(o.t_ms) || 0,
    line: o.line || "",
    line_zh: o.line_zh || "",
    precision: o.precision || "line",
  }));

  return {
    word: key,
    found: occurrences.length > 0,
    count: occurrences.length,
    artist: index?.artist || "",
    in_cet6_index: Boolean(index?.words && key in index.words),
    in_vocab_index: Boolean(index?.words && key in index.words),
    occurrences,
  };
}

/** OpenAI/DeepSeek tool definition for Mode B. */
export const FIND_WORD_TOOL = {
  type: "function",
  function: {
    name: "find_word_in_songs",
    description:
      "在用户已选歌手的本地歌词词库中，查找某个英文单词出现在哪些歌、哪一秒、哪一行。" +
      "当用户输入生词、想定位到自己喜欢的歌里学习时使用。" +
      "不要用于只查词典释义；不要用于标记认识/不认识；不要用于播放控制。",
    parameters: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "用户想查找的英文单词，例如 bound 或 admit",
        },
      },
      required: ["word"],
      additionalProperties: false,
    },
  },
};
