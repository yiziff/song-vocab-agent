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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "out");
const CET4_PATH = path.join(DATA, "cet4_words.txt");
const CET6_PATH = path.join(DATA, "cet6_words.txt");
const KNOWN_PATH = path.join(OUT, "known_words.json");

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

function loadKnown() {
  if (!fs.existsSync(KNOWN_PATH)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(KNOWN_PATH, "utf8"));
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveKnown(set) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(KNOWN_PATH, JSON.stringify([...set].sort(), null, 2));
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
    });

  console.log(`Learn server: ${url}`);
  console.log(`Level: ${lvLabel} · deck ${deckCount} / index ${wordCount}（页内可切换四级/六级/全部）`);
  console.log(`Mode A /api/search · Mode B /api/chat (find_word_in_songs tool)`);
  console.log(`LLM: ${llmConfigured ? `ok (${cfg.model})` : "NOT configured — Mode B needs .env"}`);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === "build") return cmdBuild(args);
  if (cmd === "learn") return cmdLearn(args);
  if (cmd === "serve") return cmdServe(args);
  console.log(`Song Vocab Agent (v1)

Usage:
  node cli.js build --demo --artist "Kanye West"
  node cli.js build --artist "Kanye West" --songs-file data/playlists/kanye_v1.txt
  node cli.js serve --artist "Kanye West"                  # 默认四级+六级，页内可切换
  node cli.js serve --artist "Kanye West" --level cet4     # 只学四级
  node cli.js serve --artist "Kanye West" --level cet6     # 只学六级
  node cli.js learn --artist "Kanye West" --level cet4     # 静态页（无自动 enrich）

Mode A: 网页搜词框 → GET /api/search?word=bound（不经模型）
Mode B: AI 聊天框 → POST /api/chat（模型调用 find_word_in_songs）
Level:  页内「四级 / 六级 / 四级+六级」或 --level cet4|cet6|both

Env (.env):
  OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
  NETEASE_API_BASE   default http://127.0.0.1:3000
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
