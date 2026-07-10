/**
 * Parse NetEase-style LRC and YRC into timed lines.
 * LRC: [mm:ss.xx] text
 * YRC: [startMs,dur](wordStart,wordDur,0)word...
 */

function parseLrcTime(stamp) {
  const m = stamp.match(/(\d+):(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) : 0;
  return mins * 60_000 + secs * 1000 + frac;
}

export function parseLrc(lrcText) {
  const lines = [];
  for (const raw of String(lrcText || "").split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+:\d+(?:\.\d+)?)\](.*)$/);
    if (!m) continue;
    const t_ms = parseLrcTime(m[1]);
    const text = m[2].trim();
    if (t_ms == null || !text) continue;
    // skip credit lines that are all metadata-ish
    if (/^(作词|作曲|编曲|制作)/.test(text)) continue;
    lines.push({ t_ms, text, precision: "line" });
  }
  return lines;
}

export function parseYrc(yrcText) {
  const lines = [];
  for (const raw of String(yrcText || "").split(/\r?\n/)) {
    const header = raw.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!header) continue;
    const lineStart = Number(header[1]);
    const rest = header[3];
    const words = [];
    const re = /\((\d+),(\d+),(\d+)\)([^(]*?)(?=\(|$)/g;
    let m;
    while ((m = re.exec(rest)) !== null) {
      const word = m[4];
      if (!word || !word.trim()) continue;
      words.push({ t_ms: Number(m[1]), text: word });
    }
    const text = words.map((w) => w.text).join("");
    if (!text.trim()) continue;
    lines.push({
      t_ms: lineStart,
      text: text.trim(),
      precision: "word",
      words,
    });
  }
  return lines;
}

/** Prefer yrc, else lrc. */
export function timedLinesFromSong(song) {
  if (song.yrc) {
    const lines = parseYrc(song.yrc);
    if (lines.length) return { source: "yrc", lines };
  }
  if (song.lrc) {
    const lines = parseLrc(song.lrc);
    if (lines.length) return { source: "lrc", lines };
  }
  // live API shape
  if (song.lyric_yrc) {
    const lines = parseYrc(song.lyric_yrc);
    if (lines.length) return { source: "yrc", lines };
  }
  if (song.lyric_lrc) {
    const lines = parseLrc(song.lyric_lrc);
    if (lines.length) return { source: "lrc", lines };
  }
  return { source: "none", lines: [] };
}

/** Parse NetEase translated lyric (tlyric), same LRC timestamps. */
export function parseTlyric(tlyricText) {
  return parseLrc(tlyricText);
}

/** Find nearest Chinese line by timestamp (within maxDeltaMs). */
export function nearestZhLine(tlyricLines, t_ms, maxDeltaMs = 2500) {
  if (!tlyricLines?.length) return "";
  let best = null;
  let bestDelta = Infinity;
  for (const row of tlyricLines) {
    const d = Math.abs(row.t_ms - t_ms);
    if (d < bestDelta) {
      bestDelta = d;
      best = row;
    }
  }
  if (!best || bestDelta > maxDeltaMs) return "";
  return best.text || "";
}
