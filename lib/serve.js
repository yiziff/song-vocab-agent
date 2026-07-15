import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichOccurrence, lookupGloss, readEnrichCache } from "./enrich.js";
import { llmConfig } from "./env.js";
import { buildDeck, renderLearnHtml } from "./play.js";
import { findWordInSongs } from "./findWord.js";
import { runFindWordAgent } from "./agent.js";
import { createNeteaseClient } from "./netease.js";
import {
  normalizeLevel,
  deckFromIndex,
  availableLevels,
  levelLabel,
} from "./vocabLevel.js";
import {
  DEFAULT_ARTISTS,
  listRankingFiles,
  loadRankingByArtist,
  loadSummary,
  summarizeArtistRanking,
} from "./rank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RANKINGS_DIR = path.resolve(__dirname, "..", "out", "rankings");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function enrichDeckItems(deck) {
  for (const item of deck) {
    const cached = readEnrichCache(item.song_id, item.word);
    if (cached) {
      if (cached.story) item.story = cached.story;
      if (cached.line_zh) item.line_zh = cached.line_zh;
      if (cached.gloss) item.gloss = cached.gloss;
    }
    if (!item.gloss) item.gloss = lookupGloss(item.word);
  }
  return buildDeck(deck);
}

/**
 * @param {{
 *   fullIndex: object,
 *   known?: Set<string>,
 *   level?: string,
 *   port?: number,
 *   startIndex?: number,
 *   rankingsDir?: string,
 * }} opts
 */
export function startLearnServer(opts) {
  const port = Number(opts.port || process.env.LEARN_PORT || 8787);
  const fullIndex = opts.fullIndex || opts.index || { words: {} };
  const known = opts.known instanceof Set ? opts.known : new Set();
  const rankingsDir = opts.rankingsDir || DEFAULT_RANKINGS_DIR;
  let level = normalizeLevel(opts.level || "both");

  /** @type {{ deck: Array, index: object, level: string, level_label: string, word_count: number, unknown_count: number }} */
  let state = applyLevel(level);

  function applyLevel(nextLevel) {
    level = normalizeLevel(nextLevel);
    const sliced = deckFromIndex(fullIndex, level, known);
    const deck = enrichDeckItems(sliced.deck);
    return {
      deck,
      index: sliced.index,
      level: sliced.level,
      level_label: sliced.level_label,
      word_count: sliced.word_count,
      unknown_count: sliced.unknown_count,
    };
  }

  const cfg = llmConfig();
  const startIndex = opts.startIndex || 0;
  const netease = createNeteaseClient();
  /** @type {Map<string, string|null>} */
  const coverCache = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (url.pathname === "/" || url.pathname === "/learn") {
      const qLevel = url.searchParams.get("level");
      if (qLevel) state = applyLevel(qLevel);
      const html = renderLearnHtml(state.deck, startIndex, `http://127.0.0.1:${port}`, {
        level: state.level,
        levelLabel: state.level_label,
        levels: availableLevels(),
        wordCount: state.word_count,
      });
      return sendHtml(res, html);
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        llm: cfg.configured,
        model: cfg.model,
        deck: state.deck.length,
        index_words: state.word_count,
        artist: fullIndex.artist || "",
        level: state.level,
        level_label: state.level_label,
      });
    }

    if (url.pathname === "/api/levels" && req.method === "GET") {
      return sendJson(res, 200, {
        level: state.level,
        level_label: state.level_label,
        levels: availableLevels(),
        word_count: state.word_count,
        deck_count: state.deck.length,
      });
    }

    // Switch CET-4 / CET-6 / both without rebuilding lyrics index
    if (url.pathname === "/api/level" && (req.method === "POST" || req.method === "GET")) {
      let next = url.searchParams.get("level");
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.level) next = body.level;
      }
      if (!next) {
        return sendJson(res, 400, { ok: false, error: "需要 level=cet4|cet6|both" });
      }
      state = applyLevel(next);
      return sendJson(res, 200, {
        ok: true,
        level: state.level,
        level_label: state.level_label,
        word_count: state.word_count,
        deck_count: state.deck.length,
        deck: state.deck,
      });
    }

    // Album cover for learn-page background
    if (url.pathname === "/api/cover" && req.method === "GET") {
      const songId = String(url.searchParams.get("song_id") || "").trim();
      if (!songId) {
        return sendJson(res, 400, { ok: false, error: "需要 song_id" });
      }
      if (coverCache.has(songId)) {
        const cached = coverCache.get(songId);
        return sendJson(res, 200, {
          ok: Boolean(cached),
          song_id: songId,
          cover_url: cached || "",
          cached: true,
        });
      }
      try {
        const coverUrl = await netease.getSongCover(songId);
        coverCache.set(songId, coverUrl || null);
        return sendJson(res, 200, {
          ok: Boolean(coverUrl),
          song_id: songId,
          cover_url: coverUrl || "",
          cached: false,
        });
      } catch (e) {
        coverCache.set(songId, null);
        return sendJson(res, 200, {
          ok: false,
          song_id: songId,
          cover_url: "",
          error: String(e.message || e),
        });
      }
    }

    // Mode A: direct search (no LLM) — scoped to current level
    if (url.pathname === "/api/search" && req.method === "GET") {
      const word = url.searchParams.get("word") || "";
      return sendJson(res, 200, {
        ...findWordInSongs(state.index, word),
        level: state.level,
        level_label: state.level_label,
      });
    }

    // Mode B: chat agent with find_word_in_songs tool
    if (url.pathname === "/api/chat" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = await runFindWordAgent({
          index: state.index,
          message: body.message || "",
          history: body.history || [],
          level: state.level,
        });
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/enrich") {
      try {
        const q = Object.fromEntries(url.searchParams.entries());
        const result = await enrichOccurrence({
          word: q.word,
          song_id: q.song_id,
          song_name: q.song_name,
          artist: q.artist,
          line: q.line,
          line_zh: q.line_zh,
          t_ms: q.t_ms,
          force: q.force === "1",
        });
        const hit = state.deck.find(
          (d) => d.word === result.word && String(d.song_id) === String(result.song_id)
        );
        if (hit) {
          if (result.story) hit.story = result.story;
          if (result.line_zh) hit.line_zh = result.line_zh;
          if (result.gloss) hit.gloss = result.gloss;
        }
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }

    // Rankings: list generated leaderboard files
    if (url.pathname === "/api/rankings" && req.method === "GET") {
      const files = listRankingFiles(rankingsDir);
      return sendJson(res, 200, {
        ok: true,
        rankings_dir: rankingsDir,
        default_artists: DEFAULT_ARTISTS,
        levels: availableLevels(),
        items: files,
      });
    }

    // Rankings: artist summary across default artists
    if (url.pathname === "/api/ranking/summary" && req.method === "GET") {
      const lv = normalizeLevel(url.searchParams.get("level") || "both");
      const top = Number(url.searchParams.get("top") || 50);
      let summary = loadSummary(rankingsDir, lv, top);
      if (!summary) {
        // Fall back to synthesizing from individual ranking files
        const artists = [];
        for (const name of DEFAULT_ARTISTS) {
          const r = loadRankingByArtist(rankingsDir, name, lv, top);
          if (r) artists.push(summarizeArtistRanking(r));
        }
        artists.sort(
          (a, b) =>
            b.artist_unique_words - a.artist_unique_words ||
            b.artist_total_hits - a.artist_total_hits
        );
        summary = {
          built_at: null,
          level: lv,
          level_label: levelLabel(lv),
          artist_count: artists.length,
          artists: artists.map((a, i) => ({ rank: i + 1, ...a })),
          synthetic: true,
        };
      }
      return sendJson(res, 200, { ok: true, top, ...summary });
    }

    // Rankings: one artist leaderboard
    if (url.pathname === "/api/ranking" && req.method === "GET") {
      const artist = String(url.searchParams.get("artist") || "").trim();
      const lv = normalizeLevel(url.searchParams.get("level") || "both");
      const top = Number(url.searchParams.get("top") || 50);
      if (!artist) {
        return sendJson(res, 400, {
          ok: false,
          error: "需要 artist，例如 artist=Kanye%20West",
        });
      }
      const ranking = loadRankingByArtist(rankingsDir, artist, lv, top);
      if (!ranking) {
        return sendJson(res, 404, {
          ok: false,
          error: `未找到排行榜：${artist} / ${lv} / top${top}。请先运行 node cli.js rank --artist "${artist}" --top ${top} --level ${lv}`,
          artist,
          level: lv,
          top,
        });
      }
      return sendJson(res, 200, { ok: true, ...ranking });
    }

    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}/learn?level=${state.level}`,
        llmConfigured: cfg.configured,
        level: state.level,
        levelLabel: levelLabel(state.level),
        wordCount: state.word_count,
        deckCount: state.deck.length,
      });
    });
  });
}
