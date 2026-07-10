/**
 * Pick best NetEase search hit for a requested title + artist hint.
 * Prefers title similarity and artist names containing Kanye / Ye / common collabs.
 */

import fs from "node:fs";

const COLLAB_HINTS = [
  "kanye",
  "ye",
  "jay-z",
  "jay z",
  "rihanna",
  "paul mccartney",
  "kid cudi",
  "travis scott",
  "chance the rapper",
];

function normTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function artistBlob(song) {
  return String(song.artist || "").toLowerCase();
}

function hasKanyeRelatedArtist(song) {
  const a = artistBlob(song);
  if (/\bkanye\b/.test(a) || /\bye\b/.test(a)) return true;
  return COLLAB_HINTS.some((h) => a.includes(h));
}

function titleScore(wanted, candidate) {
  const w = normTitle(wanted);
  const c = normTitle(candidate);
  if (!w || !c) return 0;
  if (w === c) return 100;
  if (c.startsWith(w) || w.startsWith(c)) return 85;
  if (c.includes(w) || w.includes(c)) return 70;
  const wt = new Set(w.split(" ").filter(Boolean));
  const ct = new Set(c.split(" ").filter(Boolean));
  let hit = 0;
  for (const t of wt) if (ct.has(t)) hit++;
  if (!wt.size) return 0;
  return Math.round((hit / wt.size) * 60);
}

/**
 * @param {string} title
 * @param {Array<{song_id,name,artist,duration_ms}>} candidates
 * @returns {{song: object, score: number} | null}
 */
export function pickBestSongMatch(title, candidates) {
  let best = null;
  for (const song of candidates || []) {
    let score = titleScore(title, song.name);
    if (score < 40) continue;
    if (hasKanyeRelatedArtist(song)) score += 25;
    else score -= 15;
    if (score < 50) continue;
    if (!best || score > best.score) best = { song, score };
  }
  return best;
}

export function loadPlaylistTitles(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}
