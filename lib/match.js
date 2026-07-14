import fs from "node:fs";
import { tokenize } from "./tokenize.js";
import { timedLinesFromSong, parseTlyric, nearestZhLine } from "./lyrics.js";

/** Load one or more word-list files (one word per line) into a Set. */
export function loadWordSet(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const set = new Set();
  for (const p of list) {
    if (!p || !fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const w = line.trim().toLowerCase();
      if (w) set.add(w);
    }
  }
  return set;
}

/** @deprecated Prefer loadWordSet — kept for callers expecting CET-6-only naming. */
export function loadCet6Set(path) {
  return loadWordSet(path);
}

/**
 * Build word -> occurrences index (CET-4 ∪ CET-6 ∩ lyrics).
 * @returns {{ artist, built_at, song_count, word_count, words: Record<string, Array> }}
 */
export function buildVocabIndex(songs, vocabSet, artist) {
  /** @type {Record<string, Array>} */
  const words = {};

  for (const song of songs) {
    const { source, lines } = timedLinesFromSong(song);
    if (source === "none") continue;
    const tlyricLines = parseTlyric(song.lyric_tlyric || song.tlyric || "");

    for (const line of lines) {
      const line_zh = nearestZhLine(tlyricLines, line.t_ms);
      if (line.words?.length) {
        for (const w of line.words) {
          for (const tok of tokenize(w.text)) {
            if (!vocabSet.has(tok)) continue;
            pushOcc(words, tok, {
              song_id: String(song.song_id),
              song_name: song.name,
              artist: song.artist,
              t_ms: w.t_ms,
              line: line.text,
              line_zh: nearestZhLine(tlyricLines, w.t_ms) || line_zh,
              precision: "word",
            });
          }
        }
      } else {
        const toks = new Set(tokenize(line.text));
        for (const tok of toks) {
          if (!vocabSet.has(tok)) continue;
          pushOcc(words, tok, {
            song_id: String(song.song_id),
            song_name: song.name,
            artist: song.artist,
            t_ms: line.t_ms,
            line: line.text,
            line_zh,
            precision: "line",
          });
        }
      }
    }
  }

  return {
    artist,
    built_at: new Date().toISOString(),
    song_count: songs.length,
    word_count: Object.keys(words).length,
    words,
  };
}

/** @deprecated Prefer buildVocabIndex */
export function buildCet6Index(songs, cet6Set, artist) {
  return buildVocabIndex(songs, cet6Set, artist);
}

function pushOcc(map, word, occ) {
  if (!map[word]) map[word] = [];
  const key = `${occ.song_id}@${occ.t_ms}`;
  if (map[word].some((x) => `${x.song_id}@${x.t_ms}` === key)) return;
  map[word].push(occ);
}
