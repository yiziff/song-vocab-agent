/**
 * Deterministic song / artist vocab ranking from a full CET-4∪CET-6 index.
 * No LLM — counts come from index.words only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeLevel,
  levelLabel,
  lexiconForLevel,
  filterIndexByLevel,
} from "./vocabLevel.js";
import { loadWordSet } from "./match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "..", "data");
const CET4_PATH = path.join(DATA, "cet4_words.txt");
const CET6_PATH = path.join(DATA, "cet6_words.txt");

export const DEFAULT_ARTISTS = ["Kanye West", "Taylor Swift", "J. Cole"];

function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "artist"
  );
}

export function artistSlug(artist) {
  return slug(artist);
}

export function rankingFileName(artist, top, level) {
  const lv = normalizeLevel(level);
  return `${artistSlug(artist)}_top${Number(top) || 50}_${lv}.json`;
}

export function summaryFileName(top, level) {
  const lv = normalizeLevel(level);
  return `artists_top${Number(top) || 50}_${lv}_summary.json`;
}

function wordLevels(word, cet4, cet6) {
  const in4 = cet4.has(word);
  const in6 = cet6.has(word);
  return {
    in_cet4: in4,
    in_cet6: in6,
    tags: [in4 ? "cet4" : null, in6 ? "cet6" : null].filter(Boolean),
  };
}

/**
 * Build per-song stats from a full index, filtered by level.
 * @param {object} fullIndex
 * @param {string} [level]
 */
export function rankSongsByVocab(fullIndex, level = "both") {
  const lv = normalizeLevel(level);
  const filtered = filterIndexByLevel(fullIndex, lv);
  const words = filtered.words || {};
  const cet4 = loadWordSet(CET4_PATH);
  const cet6 = loadWordSet(CET6_PATH);

  /** @type {Map<string, {
   *   song_id: string,
   *   song_name: string,
   *   artist: string,
   *   unique: Set<string>,
   *   cet4_unique: Set<string>,
   *   cet6_unique: Set<string>,
   *   total_hits: number,
   *   cet4_hits: number,
   *   cet6_hits: number,
   *   hit_lines: Set<string>,
   *   wordHits: Map<string, number>,
   * }>} */
  const bySong = new Map();

  for (const [word, occs] of Object.entries(words)) {
    if (!Array.isArray(occs) || !occs.length) continue;
    const tags = wordLevels(word, cet4, cet6);
    for (const occ of occs) {
      const sid = String(occ.song_id || "");
      if (!sid) continue;
      let row = bySong.get(sid);
      if (!row) {
        row = {
          song_id: sid,
          song_name: occ.song_name || "",
          artist: occ.artist || fullIndex.artist || "",
          unique: new Set(),
          cet4_unique: new Set(),
          cet6_unique: new Set(),
          total_hits: 0,
          cet4_hits: 0,
          cet6_hits: 0,
          hit_lines: new Set(),
          wordHits: new Map(),
        };
        bySong.set(sid, row);
      }
      if (occ.song_name && !row.song_name) row.song_name = occ.song_name;
      row.unique.add(word);
      row.total_hits += 1;
      row.wordHits.set(word, (row.wordHits.get(word) || 0) + 1);
      const lineKey = `${occ.t_ms}|${occ.line || ""}`;
      row.hit_lines.add(lineKey);
      if (tags.in_cet4) {
        row.cet4_unique.add(word);
        row.cet4_hits += 1;
      }
      if (tags.in_cet6) {
        row.cet6_unique.add(word);
        row.cet6_hits += 1;
      }
    }
  }

  const songs = [...bySong.values()]
    .map((row) => {
      const unique_words = row.unique.size;
      const hit_line_count = row.hit_lines.size;
      const top_words = [...row.wordHits.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([w, n]) => ({ word: w, hits: n, ...wordLevels(w, cet4, cet6) }));
      const example_words = [...row.unique].sort().slice(0, 12);
      return {
        song_id: row.song_id,
        song_name: row.song_name,
        artist: row.artist,
        unique_words,
        total_hits: row.total_hits,
        cet4_unique_words: row.cet4_unique.size,
        cet6_unique_words: row.cet6_unique.size,
        cet4_total_hits: row.cet4_hits,
        cet6_total_hits: row.cet6_hits,
        hit_line_count,
        hits_per_hit_line:
          hit_line_count > 0
            ? Math.round((row.total_hits / hit_line_count) * 100) / 100
            : 0,
        top_words,
        example_words,
        score: unique_words * 1000 + row.total_hits,
      };
    })
    .sort(
      (a, b) =>
        b.unique_words - a.unique_words ||
        b.total_hits - a.total_hits ||
        a.song_name.localeCompare(b.song_name)
    )
    .map((s, i) => ({ rank: i + 1, ...s }));

  const artistUnique = new Set(Object.keys(words));
  let cet4Artist = 0;
  let cet6Artist = 0;
  for (const w of artistUnique) {
    if (cet4.has(w)) cet4Artist++;
    if (cet6.has(w)) cet6Artist++;
  }

  const ranking = {
    artist: fullIndex.artist || "",
    level: lv,
    level_label: levelLabel(lv),
    built_at: new Date().toISOString(),
    source_index_built_at: fullIndex.built_at || null,
    song_count: fullIndex.song_count ?? songs.length,
    ranked_song_count: songs.length,
    artist_unique_words: artistUnique.size,
    artist_cet4_unique_words: cet4Artist,
    artist_cet6_unique_words: cet6Artist,
    artist_total_hits: songs.reduce((n, s) => n + s.total_hits, 0),
    hardest_song: songs[0]
      ? {
          song_id: songs[0].song_id,
          song_name: songs[0].song_name,
          unique_words: songs[0].unique_words,
          total_hits: songs[0].total_hits,
        }
      : null,
    songs,
  };

  return ranking;
}

export function summarizeArtistRanking(ranking) {
  if (!ranking) return null;
  return {
    artist: ranking.artist,
    level: ranking.level,
    level_label: ranking.level_label,
    song_count: ranking.song_count,
    ranked_song_count: ranking.ranked_song_count,
    artist_unique_words: ranking.artist_unique_words,
    artist_cet4_unique_words: ranking.artist_cet4_unique_words,
    artist_cet6_unique_words: ranking.artist_cet6_unique_words,
    artist_total_hits: ranking.artist_total_hits,
    hardest_song: ranking.hardest_song,
    top3: (ranking.songs || []).slice(0, 3).map((s) => ({
      rank: s.rank,
      song_name: s.song_name,
      unique_words: s.unique_words,
      total_hits: s.total_hits,
    })),
  };
}

/**
 * @param {Array<object>} rankings
 */
export function compareArtistRankings(rankings) {
  const list = (rankings || [])
    .map(summarizeArtistRanking)
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.artist_unique_words - a.artist_unique_words ||
        b.artist_total_hits - a.artist_total_hits ||
        a.artist.localeCompare(b.artist)
    )
    .map((r, i) => ({ rank: i + 1, ...r }));

  return {
    built_at: new Date().toISOString(),
    level: list[0]?.level || "both",
    level_label: list[0]?.level_label || levelLabel("both"),
    artist_count: list.length,
    artists: list,
  };
}

export function writeRanking(outDir, ranking, top = 50) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(
    outDir,
    rankingFileName(ranking.artist, top, ranking.level)
  );
  fs.writeFileSync(file, JSON.stringify(ranking, null, 2), "utf8");
  return file;
}

export function writeSummary(outDir, summary, top = 50) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, summaryFileName(top, summary.level));
  fs.writeFileSync(file, JSON.stringify(summary, null, 2), "utf8");
  return file;
}

export function listRankingFiles(rankingsDir) {
  if (!fs.existsSync(rankingsDir)) return [];
  return fs
    .readdirSync(rankingsDir)
    .filter((f) => f.endsWith(".json") && !f.includes("_summary"))
    .map((f) => {
      const full = path.join(rankingsDir, f);
      let meta = {};
      try {
        const j = JSON.parse(fs.readFileSync(full, "utf8"));
        meta = {
          artist: j.artist,
          level: j.level,
          level_label: j.level_label,
          artist_unique_words: j.artist_unique_words,
          ranked_song_count: j.ranked_song_count,
          built_at: j.built_at,
        };
      } catch {
        // ignore
      }
      return { file: f, path: full, ...meta };
    })
    .sort((a, b) =>
      String(a.artist || "").localeCompare(String(b.artist || "")) ||
      String(a.level || "").localeCompare(String(b.level || ""))
    );
}

export function loadRankingByArtist(rankingsDir, artist, level = "both", top = 50) {
  const file = path.join(rankingsDir, rankingFileName(artist, top, level));
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadSummary(rankingsDir, level = "both", top = 50) {
  const file = path.join(rankingsDir, summaryFileName(top, level));
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Ensure lexicon helpers stay importable for tests / callers */
export function activeLexicon(level) {
  return lexiconForLevel(level);
}
