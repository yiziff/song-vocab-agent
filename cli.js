#!/usr/bin/env node
/**
 * Song Vocab Agent — minimal CLI
 *
 *   node cli.js build --demo --artist "Kanye West"
 *   node cli.js learn --demo
 *   node cli.js build --artist "Kanye West" --limit 30   # needs api-enhanced
 *   node cli.js learn
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { loadWordSet, buildVocabIndex } from "./lib/match.js";
import { createNeteaseClient, pingApi } from "./lib/netease.js";
import { openLearnViewer } from "./lib/play.js";
import { loadPlaylistTitles, pickBestSongMatch } from "./lib/songMatch.js";
import { startLearnServer } from "./lib/serve.js";
import { loadEnv, llmConfig } from "./lib/env.js";
import {
  normalizeLevel,
  deckFromIndex,
  availableLevels,
} from "./lib/vocabLevel.js";
import {
  DEFAULT_ARTISTS,
  rankSongsByVocab,
  compareArtistRankings,
  writeRanking,
  writeSummary,
  loadRankingByArtist,
} from "./lib/rank.js";
import { loadKnown } from "./lib/progress.js";
import { tagSongsForArtist } from "./lib/tagSongs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "out");
const RANKINGS_DIR = path.join(OUT, "rankings");
const CET4_PATH = path.join(DATA, "cet4_words.txt");
const CET6_PATH = path.join(DATA, "cet6_words.txt");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "artist";
}

function indexPath(artist, demo) {
  return path.join(OUT, `${slug(artist)}${demo ? "_demo" : ""}_cet6_index.json`);
}

async function enrichWithLyrics(client, songs) {
  const enriched = [];
  let withLyrics = 0;
  let noLyrics = 0;
  for (const s of songs) {
    process.stdout.write(`  · ${s.name} ... `);
    try {
      const lyr = await client.getTimedLyrics(s.song_id);
      enriched.push({ ...s, ...lyr });
      const kind = lyr.lyric_yrc ? "yrc" : lyr.lyric_lrc ? "lrc" : "none";
      if (kind === "none") noLyrics++;
      else withLyrics++;
      console.log(kind);
    } catch {
      console.log("fail");
      noLyrics++;
      enriched.push(s);
    }
    await sleep(200);
  }
  return { enriched, withLyrics, noLyrics };
}

async function buildFromPlaylist(client, artist, songsFile) {
  const resolved = path.isAbsolute(songsFile)
    ? songsFile
    : path.resolve(ROOT, songsFile);
  if (!fs.existsSync(resolved)) {
    console.error(`Songs file not found: ${resolved}`);
    process.exit(1);
  }
  const titles = loadPlaylistTitles(resolved);
  console.log(`Playlist: ${titles.length} titles from ${resolved}`);

  const matched = [];
  const unmatched = [];

  for (const title of titles) {
    process.stdout.write(`  ? ${title} ... `);
    try {
      const hits = await client.searchSongs(`${title} ${artist}`, 12);
      const best = pickBestSongMatch(title, hits);
      if (!best) {
        console.log("UNMATCHED");
        unmatched.push(title);
      } else {
        console.log(
          `→ ${best.song.name} [${best.song.song_id}] (${best.song.artist}) score=${best.score}`
        );
        matched.push({ ...best.song, query_title: title });
      }
    } catch (e) {
      console.log(`fail (${e.message})`);
      unmatched.push(title);
    }
    await sleep(150);
  }

  console.log(`\nFetching lyrics for ${matched.length} matched songs...`);
  const { enriched, withLyrics, noLyrics } = await enrichWithLyrics(client, matched);
  return { songs: enriched, unmatched, withLyrics, noLyrics, matchedCount: matched.length };
}

async function buildFromArtistHot(client, artist, limit) {
  console.log(`Searching artist: ${artist}`);
  const artists = await client.searchArtist(artist);
  if (!artists.length) {
    console.error("No artist found. Try a different spelling.");
    process.exit(1);
  }
  const picked = artists[0];
  console.log(`Using artist #${picked.id} ${picked.name}`);
  const songs = await client.artistSongs(picked.id, limit);
  console.log(`Fetching lyrics for ${songs.length} songs...`);
  const { enriched, withLyrics, noLyrics } = await enrichWithLyrics(client, songs);
  return { songs: enriched, unmatched: [], withLyrics, noLyrics, matchedCount: songs.length };
}

async function cmdBuild(args) {
  const artist = args.artist || "Kanye West";
  const limit = Number(args.limit || 30);
  const demo = Boolean(args.demo);
  const songsFile = args["songs-file"] || null;
  const vocab = loadWordSet([CET4_PATH, CET6_PATH]);

  let songs;
  let unmatched = [];
  let withLyrics = 0;
  let noLyrics = 0;
  let matchedCount = 0;

  if (demo) {
    const fixture = path.join(DATA, "fixtures", "kanye_demo.json");
    songs = JSON.parse(fs.readFileSync(fixture, "utf8"));
    matchedCount = songs.length;
    withLyrics = songs.length;
    console.log(`[demo] loaded ${songs.length} fixture songs for "${artist}"`);
  } else {
    const client = createNeteaseClient();
    const ok = await pingApi(client.base);
    if (!ok) {
      console.error(
        `Cannot reach api-enhanced at ${client.base}.\n` +
          `Start it locally, or use: node cli.js build --demo --artist "${artist}"`
      );
      process.exit(1);
    }

    const result = songsFile
      ? await buildFromPlaylist(client, artist, songsFile)
      : await buildFromArtistHot(client, artist, limit);
    songs = result.songs;
    unmatched = result.unmatched;
    withLyrics = result.withLyrics;
    noLyrics = result.noLyrics;
    matchedCount = result.matchedCount;
  }

  const index = buildVocabIndex(songs, vocab, artist);
  index.vocab = { cet4: true, cet6: true, lexicon_size: vocab.size };
  if (songsFile) {
    index.source = { type: "playlist", file: songsFile, unmatched };
  }
  fs.mkdirSync(OUT, { recursive: true });
  const outFile = indexPath(artist, demo);
  fs.writeFileSync(outFile, JSON.stringify(index, null, 2));

  console.log(
    `\nBuilt index: ${index.word_count} CET-4/6 words (lexicon ${vocab.size}) across ${index.song_count} songs`
  );
  console.log(
    `Matched: ${matchedCount} · with lyrics: ${withLyrics} · no lyrics: ${noLyrics} · unmatched: ${unmatched.length}`
  );
  if (unmatched.length) {
    console.log("Unmatched titles:");
    for (const t of unmatched) console.log(`  - ${t}`);
  }
  console.log(`Wrote ${outFile}`);
}

async function cmdLearn(args) {
  const artist = args.artist || "Kanye West";
  const demo = Boolean(args.demo);
  const level = normalizeLevel(args.level || "both");
  const file = args.index || indexPath(artist, demo);
  if (!fs.existsSync(file)) {
    console.error(`Index not found: ${file}`);
    console.error(`Run: node cli.js build ${demo ? "--demo " : ""}--artist "${artist}"`);
    process.exit(1);
  }

  const fullIndex = JSON.parse(fs.readFileSync(file, "utf8"));
  const known = loadKnown();
  const sliced = deckFromIndex(fullIndex, level, known);

  if (!sliced.deck.length) {
    console.log(`No unknown ${sliced.level_label} words left in this index. Nice.`);
    return;
  }

  console.log(
    `Artist: ${fullIndex.artist} · level=${sliced.level_label} · ${sliced.unknown_count} unknown (of ${sliced.word_count})`
  );
  console.log(
    `推荐：node cli.js serve --artist "Kanye West" --level ${level}  （页内可再切换四级/六级）`
  );
  console.log("本命令仅打开静态页；深度语义需 serve。\n");

  const show = sliced.deck.slice(0, 30);
  show.forEach((o, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${o.word.padEnd(16)}  ${o.song_name} @ ${(o.t_ms / 1000).toFixed(1)}s (${o.precision})`
    );
  });
  if (sliced.deck.length > 30) console.log(`  ... and ${sliced.deck.length - 30} more`);

  const opened = openLearnViewer(sliced.deck, 0, {
    enrichApi: "",
    level: sliced.level,
    levelLabel: sliced.level_label,
    levels: availableLevels(),
    wordCount: sliced.word_count,
  });
  console.log(`\nOpened static learn page: ${opened.file}`);
  console.log(`For DeepSeek enrich: node cli.js serve --artist "${artist}" --level ${level}`);
}

async function cmdServe(args) {
  loadEnv();
  const artist = args.artist || "Kanye West";
  const demo = Boolean(args.demo);
  const level = normalizeLevel(args.level || "both");
  const file = args.index || indexPath(artist, demo);
  if (!fs.existsSync(file)) {
    console.error(`Index not found: ${file}`);
    process.exit(1);
  }

  const fullIndex = JSON.parse(fs.readFileSync(file, "utf8"));
  const known = loadKnown();
  const cfg = llmConfig();

  const { url, llmConfigured, levelLabel: lvLabel, deckCount, wordCount } =
    await startLearnServer({
      fullIndex,
      known,
      level,
      port: Number(args.port || 8787),
      startIndex: 0,
      rankingsDir: RANKINGS_DIR,
    });

  console.log(`Learn server: ${url}`);
  console.log(`Level: ${lvLabel} · deck ${deckCount} / index ${wordCount}（页内可切换四级/六级/全部）`);
  console.log(`Mode A /api/search · Mode B /api/chat · Coach /api/coach/plan`);
  console.log(`Rankings: GET /api/rankings · /api/ranking · /api/ranking/summary`);
  console.log(`LLM: ${llmConfigured ? `ok (${cfg.model})` : "NOT configured — Mode B / Coach need .env"}`);
  console.log("Press Ctrl+C to stop.");

  // open browser
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

function printRankingPreview(ranking, limit = 20) {
  console.log(
    `\n${ranking.artist} · ${ranking.level_label} · ` +
      `歌手唯一词 ${ranking.artist_unique_words} · 总命中 ${ranking.artist_total_hits} · ` +
      `有词歌曲 ${ranking.ranked_song_count}/${ranking.song_count}`
  );
  if (ranking.hardest_song) {
    console.log(
      `最难歌: ${ranking.hardest_song.song_name} ` +
        `(${ranking.hardest_song.unique_words} unique / ${ranking.hardest_song.total_hits} hits)`
    );
  }
  const rows = (ranking.songs || []).slice(0, limit);
  for (const s of rows) {
    const sample = (s.example_words || []).slice(0, 5).join(", ");
    console.log(
      `  ${String(s.rank).padStart(2)}. ${String(s.unique_words).padStart(3)}u ` +
        `${String(s.total_hits).padStart(4)}h  ${s.song_name}` +
        (sample ? `  [${sample}]` : "")
    );
  }
  if ((ranking.songs || []).length > limit) {
    console.log(`  ... and ${ranking.songs.length - limit} more`);
  }
}

async function ensureIndex(artist, { top, autoBuild, demo }) {
  const file = indexPath(artist, demo);
  if (fs.existsSync(file)) return file;
  if (!autoBuild) {
    console.error(`Index not found: ${file}`);
    console.error(
      `Run: node cli.js build --artist "${artist}" --limit ${top}\n` +
        `Or:  node cli.js rank --artist "${artist}" --top ${top} --build`
    );
    process.exit(1);
  }
  console.log(`[rank] index missing, building hot top ${top} for "${artist}"...`);
  await cmdBuild({ artist, limit: top, demo: Boolean(demo) });
  if (!fs.existsSync(file)) {
    console.error(`Build finished but index still missing: ${file}`);
    process.exit(1);
  }
  return file;
}

async function cmdRank(args) {
  const artist = args.artist || "Kanye West";
  const top = Number(args.top || args.limit || 50);
  const level = normalizeLevel(args.level || "both");
  const demo = Boolean(args.demo);
  const autoBuild = Boolean(args.build);
  const file = await ensureIndex(artist, { top, autoBuild, demo });
  const fullIndex = JSON.parse(fs.readFileSync(file, "utf8"));
  const ranking = rankSongsByVocab(fullIndex, level);
  ranking.top = top;
  ranking.source_index = path.basename(file);
  const outFile = writeRanking(RANKINGS_DIR, ranking, top);
  printRankingPreview(ranking, 20);
  console.log(`\nWrote ${outFile}`);
  return ranking;
}

async function cmdRankAll(args) {
  const top = Number(args.top || args.limit || 50);
  const level = normalizeLevel(args.level || "both");
  const demo = Boolean(args.demo);
  // rank-all defaults to auto-building missing indexes; pass --no-build to skip.
  const autoBuild = !Boolean(args["no-build"]);
  const artists = DEFAULT_ARTISTS;
  const rankings = [];

  console.log(
    `Rank-all: ${artists.join(" · ")} · top ${top} · ${level}` +
      (autoBuild ? " · auto-build if missing" : " · no-build")
  );

  for (const artist of artists) {
    console.log(`\n=== ${artist} ===`);
    try {
      const ranking = await cmdRank({
        artist,
        top,
        level,
        demo,
        build: autoBuild,
      });
      rankings.push(ranking);
    } catch (e) {
      console.error(`[rank-all] ${artist} failed: ${e.message || e}`);
    }
  }

  if (!rankings.length) {
    console.error("No rankings produced.");
    process.exit(1);
  }

  const summary = compareArtistRankings(rankings);
  summary.top = top;
  const summaryFile = writeSummary(RANKINGS_DIR, summary, top);
  console.log(`\n=== Artist summary (${summary.level_label}) ===`);
  for (const a of summary.artists) {
    console.log(
      `  #${a.rank} ${a.artist.padEnd(16)}  unique=${String(a.artist_unique_words).padStart(4)}  ` +
        `hits=${String(a.artist_total_hits).padStart(5)}  hardest=${a.hardest_song?.song_name || "-"}`
    );
  }
  console.log(`\nWrote ${summaryFile}`);
}

async function cmdTagSongs(args) {
  loadEnv();
  const artist = args.artist || "Kanye West";
  const top = Number(args.top || args.limit || 50);
  const level = normalizeLevel(args.level || "both");
  const force = Boolean(args.force);
  const demo = Boolean(args.demo);

  let ranking = loadRankingByArtist(RANKINGS_DIR, artist, level, top);
  if (!ranking?.songs?.length) {
    console.log(`[tag-songs] ranking missing, computing from index...`);
    const file = await ensureIndex(artist, {
      top,
      autoBuild: Boolean(args.build),
      demo,
    });
    const fullIndex = JSON.parse(fs.readFileSync(file, "utf8"));
    ranking = rankSongsByVocab(fullIndex, level);
    ranking.top = top;
    writeRanking(RANKINGS_DIR, ranking, top);
  }

  console.log(
    `Tag-songs: ${artist} · top ${top} · ${force ? "force" : "skip high-confidence"}`
  );

  const { doc, outFile } = await tagSongsForArtist({
    artist,
    songs: ranking.songs,
    top,
    force,
    delayMs: 200,
    onProgress: ({ i, total, songName, status, error }) => {
      const n = String(i + 1).padStart(2);
      if (status === "skip") {
        process.stdout.write(`  ${n}/${total} skip ${songName}\n`);
      } else if (error) {
        process.stdout.write(`  ${n}/${total} ${status} ${songName}: ${error}\n`);
      } else {
        process.stdout.write(`  ${n}/${total} ${status} ${songName}\n`);
      }
    },
  });

  console.log(
    `\nStats: matched=${doc.stats.matched} low=${doc.stats.low_confidence} ` +
      `failed=${doc.stats.failed} skipped=${doc.stats.skipped}`
  );
  console.log(`Wrote ${outFile}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === "build") return cmdBuild(args);
  if (cmd === "learn") return cmdLearn(args);
  if (cmd === "serve") return cmdServe(args);
  if (cmd === "rank") return cmdRank(args);
  if (cmd === "rank-all") return cmdRankAll(args);
  if (cmd === "tag-songs") return cmdTagSongs(args);
  console.log(`Song Vocab Agent (v1)

Usage:
  node cli.js build --demo --artist "Kanye West"
  node cli.js build --artist "Kanye West" --songs-file data/playlists/kanye_v1.txt
  node cli.js build --artist "Taylor Swift" --limit 50
  node cli.js rank --artist "Kanye West" --top 50 --level cet6
  node cli.js rank --artist "J. Cole" --top 50 --level both --build
  node cli.js rank-all --top 50 --level both          # Kanye / Taylor / J. Cole
  node cli.js tag-songs --artist "Kanye West" --top 50   # Spotify+Last.fm → song_tags JSON
  node cli.js tag-songs --artist "Kanye West" --top 50 --force
  node cli.js serve --artist "Kanye West"                  # 默认四级+六级，页内可切换
  node cli.js serve --artist "Kanye West" --level cet4     # 只学四级
  node cli.js serve --artist "Kanye West" --level cet6     # 只学六级
  node cli.js learn --artist "Kanye West" --level cet4     # 静态页（无自动 enrich）

Mode A: 网页搜词框 → GET /api/search?word=bound（不经模型）
Mode B: AI 聊天框 → POST /api/chat（模型调用 find_word_in_songs）
Coach:  学习页「学习教练」→ POST /api/coach/plan（周计划）
Rank:   热门歌曲四六级词汇排行榜（确定性统计，不经模型）
Tags:   tag-songs 离线写 data/song_tags/（教练读 JSON，不实时联网）
Level:  页内「四级 / 六级 / 四级+六级」或 --level cet4|cet6|both

Env (.env):
  OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
  NETEASE_API_BASE   default http://127.0.0.1:3000
  SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET   # tag-songs
  LASTFM_API_KEY                              # tag-songs
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
