import fs from "node:fs";
import { tokenize } from "./tokenize.js";
import { timedLinesFromSong, parseTlyric, nearestZhLine } from "./lyrics.js";

export function loadCet6Set(path) {
  const text = fs.readFileSync(path, "utf8");
  return new Set(
    text
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Build word -> occurrences index.
 * @returns {{ artist, built_at, song_count, word_count, words: Record<string, Array> }}
 */
export function buildCet6Index(songs, cet6Set, artist) {
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
            if (!cet6Set.has(tok)) continue;
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
          if (!cet6Set.has(tok)) continue;
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

function pushOcc(map, word, occ) {
  if (!map[word]) map[word] = [];
  const key = `${occ.song_id}@${occ.t_ms}`;
  if (map[word].some((x) => `${x.song_id}@${x.t_ms}` === key)) return;
  map[word].push(occ);
}
