/**
 * Deterministic song filtering for coach: ranking + song_tags + theme seeds.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSongTags } from "./tagSongs.js";
import { filterIndexByLevel } from "./vocabLevel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const THEME_SEEDS_PATH = path.join(ROOT, "data", "theme_seeds.json");

let themeSeedsCache = null;

export function loadThemeSeeds() {
  if (themeSeedsCache) return themeSeedsCache;
  if (!fs.existsSync(THEME_SEEDS_PATH)) {
    themeSeedsCache = {};
    return themeSeedsCache;
  }
  try {
    themeSeedsCache = JSON.parse(fs.readFileSync(THEME_SEEDS_PATH, "utf8"));
  } catch {
    themeSeedsCache = {};
  }
  return themeSeedsCache;
}

export function listThemes() {
  return Object.keys(loadThemeSeeds());
}

/**
 * Count theme word hits for a song in the vocab index.
 */
export function countThemeHits(fullIndex, songId, theme, level = "both") {
  const seeds = loadThemeSeeds();
  const themeKey = String(theme || "").toLowerCase();
  const seedList = seeds[themeKey] || [];
  if (!seedList.length) {
    return { theme: themeKey, hits: 0, words: [] };
  }
  const index = filterIndexByLevel(fullIndex, level);
  const seedSet = new Set(seedList.map((w) => String(w).toLowerCase()));
  const hitWords = [];
  for (const [word, occs] of Object.entries(index.words || {})) {
    if (!seedSet.has(word)) continue;
    const inSong = (occs || []).some((o) => String(o.song_id) === String(songId));
    if (inSong) hitWords.push(word);
  }
  hitWords.sort();
  return { theme: themeKey, hits: hitWords.length, words: hitWords };
}

/**
 * Filter and rank song candidates.
 * @param {{
 *   ranking: object,
 *   fullIndex: object,
 *   artist: string,
 *   level?: string,
 *   top?: number,
 *   mellow?: boolean,
 *   melodic?: boolean,
 *   themes?: string[],
 *   min_unique_words?: number,
 *   limit?: number
 * }} opts
 */
export function filterSongs(opts) {
  const ranking = opts.ranking || { songs: [] };
  const fullIndex = opts.fullIndex || { words: {} };
  const artist = opts.artist || ranking.artist || fullIndex.artist || "";
  const level = opts.level || ranking.level || "both";
  const top = Number(opts.top) || 50;
  const wantMellow = Boolean(opts.mellow);
  const wantMelodic = Boolean(opts.melodic);
  const themes = Array.isArray(opts.themes)
    ? opts.themes.map((t) => String(t).toLowerCase()).filter(Boolean)
    : opts.theme
      ? [String(opts.theme).toLowerCase()]
      : [];
  const minUnique = Number(opts.min_unique_words) || 0;
  const limit = Number(opts.limit) || 20;

  const tagsDoc = loadSongTags(artist, top);
  const tagsAvailable = Boolean(tagsDoc?.songs);
  const tagFilterRequested = wantMellow || wantMelodic;

  let songs = [...(ranking.songs || [])];
  if (minUnique > 0) {
    songs = songs.filter((s) => (s.unique_words || 0) >= minUnique);
  }

  const candidates = songs.map((s) => {
    const songId = String(s.song_id);
    const tagRow = tagsDoc?.songs?.[songId] || null;
    const tags = tagRow?.tags || {};

    const themeHits = themes.map((th) =>
      countThemeHits(fullIndex, songId, th, level)
    );
    const themeHitTotal = themeHits.reduce((n, t) => n + t.hits, 0);
    const themeWords = [
      ...new Set(themeHits.flatMap((t) => t.words)),
    ].slice(0, 12);

    // Mid difficulty preferred: unique_words around 8–25
    const uw = s.unique_words || 0;
    const difficultyFit =
      uw <= 0 ? 0 : uw < 5 ? 0.4 : uw <= 25 ? 1 : uw <= 40 ? 0.7 : 0.4;

    let tagBonus = 0;
    let tagMatch = true;
    if (tagFilterRequested && tagsAvailable) {
      if (wantMellow && !(tags.mellow || tags.mood_calm)) tagMatch = false;
      if (wantMelodic && !(tags.melodic || tags.melodic_hint)) tagMatch = false;
      if (tags.mellow || tags.mood_calm) tagBonus += 2;
      if (tags.melodic || tags.melodic_hint) tagBonus += 1.5;
    } else if (tagFilterRequested && !tagsAvailable) {
      tagMatch = true; // degrade: ignore tag filter
      tagBonus = 0;
    }

    const score =
      themeHitTotal * 3 +
      difficultyFit * 5 +
      tagBonus +
      Math.min(uw, 30) * 0.05;

    return {
      song_id: songId,
      song_name: s.song_name,
      artist: s.artist || artist,
      unique_words: uw,
      cet6_unique_words: s.cet6_unique_words || 0,
      cet4_unique_words: s.cet4_unique_words || 0,
      total_hits: s.total_hits || 0,
      example_words: s.example_words || [],
      top_words: s.top_words || [],
      theme_hits: themeHits,
      theme_hit_total: themeHitTotal,
      theme_words: themeWords,
      tags: tags,
      tags_zh: tagRow?.tags_zh || [],
      match_confidence: tagRow?.match?.confidence || null,
      tag_match: tagMatch,
      score,
    };
  });

  let filtered = candidates;
  if (tagFilterRequested && tagsAvailable) {
    const matched = candidates.filter((c) => c.tag_match);
    // If tag filter empties the list, fall back with note
    if (matched.length >= 3) filtered = matched;
  }

  filtered.sort(
    (a, b) =>
      b.score - a.score ||
      b.theme_hit_total - a.theme_hit_total ||
      a.song_name.localeCompare(b.song_name)
  );

  const sliced = filtered.slice(0, limit);

  return {
    ok: true,
    artist,
    level,
    tags_available: tagsAvailable,
    tag_filter_requested: tagFilterRequested,
    tag_filter_applied: tagFilterRequested && tagsAvailable,
    tag_filter_degraded: tagFilterRequested && !tagsAvailable,
    themes,
    candidate_count: sliced.length,
    candidates: sliced,
    note: !tagsAvailable && tagFilterRequested
      ? `未找到 song_tags JSON。请先运行: node cli.js tag-songs --artist "${artist}" --top ${top}`
      : tagsAvailable
        ? null
        : "尚无 song_tags；仅按词汇与主题排序",
  };
}
