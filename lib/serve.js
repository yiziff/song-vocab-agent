import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichOccurrence, lookupGloss, readEnrichCache } from "./enrich.js";
import { llmConfig } from "./env.js";
import { buildDeck, renderLearnHtml } from "./play.js";
import { findWordInSongs } from "./findWord.js";
import { runLearnAssistant, loadCurrentWeekPlan, loadCurrentSessionPlan } from "./learnAssistant.js";
import { acceptWeekPlan } from "./coachPlan.js";
import { createNeteaseClient } from "./netease.js";
import { timedLinesFromSong, parseTlyric, nearestZhLine } from "./lyrics.js";
import { learnSong, listSongsInIndex } from "./learnSong.js";
import {
  loadKnown,
  markKnown,
  knownStats,
} from "./progress.js";
import { generateQuiz, gradeQuiz } from "./quiz.js";
import {
  createChallenge,
  beginVerifyPhase,
  gradeChallenge,
  checkVerifyAnswer,
  localMeaningCorrect,
  gradeBlankWithLlm,
} from "./challenge.js";
import {
  normalizeLevel,
  deckFromIndex,
  availableLevels,
  levelLabel,
} from "./vocabLevel.js";
import {
  DEFAULT_ARTISTS,
  artistSlug,
  listRankingFiles,
  loadRankingByArtist,
  loadSummary,
  summarizeArtistRanking,
} from "./rank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "out");
const DEFAULT_RANKINGS_DIR = path.resolve(OUT_DIR, "rankings");

function indexFileForArtist(artist, demo = false) {
  const slug = artistSlug(artist);
  return path.join(OUT_DIR, `${slug}${demo ? "_demo" : ""}_cet6_index.json`);
}

function listAvailableArtists() {
  const out = [];
  for (const name of DEFAULT_ARTISTS) {
    const file = indexFileForArtist(name);
    if (!fs.existsSync(file)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      out.push({
        id: name,
        artist: j.artist || name,
        song_count: j.song_count ?? null,
        word_count: j.word_count ?? null,
      });
    } catch {
      /* skip broken index */
    }
  }
  return out;
}

function loadArtistIndex(artist) {
  const wanted = String(artist || "").trim();
  if (!wanted) return null;
  // Accept either canonical DEFAULT_ARTISTS name or index.artist field.
  const candidates = [wanted];
  for (const name of DEFAULT_ARTISTS) {
    if (name.toLowerCase() === wanted.toLowerCase()) candidates.push(name);
  }
  for (const name of candidates) {
    const file = indexFileForArtist(name);
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* try next */
    }
  }
  return null;
}

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
      if (cached.gloss_academic) item.gloss_academic = cached.gloss_academic;
      if (cached.gloss_slang) item.gloss_slang = cached.gloss_slang;
      if (cached.artist_note) item.artist_note = cached.artist_note;
    }
    if (!item.gloss) item.gloss = lookupGloss(item.word);
    if (!item.gloss_academic) item.gloss_academic = item.gloss;
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
  let fullIndex = opts.fullIndex || opts.index || { words: {} };
  let known = opts.known instanceof Set ? opts.known : loadKnown();
  const rankingsDir = opts.rankingsDir || DEFAULT_RANKINGS_DIR;
  let level = normalizeLevel(opts.level || "both");

  /** Optional song-scoped deck from learn_song */
  let songFocus = null;

  /** In-memory challenge sessions (cleared on process restart). */
  /** @type {Map<string, object>} */
  const challengeSessions = new Map();

  /** @type {{ deck: Array, index: object, level: string, level_label: string, word_count: number, unknown_count: number }} */
  let state = applyLevel(level);

  function applyLevel(nextLevel) {
    level = normalizeLevel(nextLevel);
    known = loadKnown();
    const sliced = deckFromIndex(fullIndex, level, known);
    const deck = enrichDeckItems(sliced.deck);
    songFocus = null;
    return {
      deck,
      index: sliced.index,
      level: sliced.level,
      level_label: sliced.level_label,
      word_count: sliced.word_count,
      unknown_count: sliced.unknown_count,
    };
  }

  function activeDeck() {
    return songFocus?.deck || state.deck;
  }

  const cfg = llmConfig();
  const startIndex = opts.startIndex || 0;
  const netease = createNeteaseClient();
  /** @type {Map<string, string|null>} */
  const coverCache = new Map();
  /** @type {Map<string, object>} */
  const playCache = new Map();

  function applyArtist(nextArtist) {
    const loaded = loadArtistIndex(nextArtist);
    if (!loaded) {
      return {
        ok: false,
        error: `未找到歌手索引：${nextArtist}。请先 build，或确认 out/*_cet6_index.json 存在。`,
        artists: listAvailableArtists(),
      };
    }
    fullIndex = loaded;
    state = applyLevel(level);
    coverCache.clear();
    playCache.clear();
    return {
      ok: true,
      artist: fullIndex.artist || String(nextArtist),
      level: state.level,
      level_label: state.level_label,
      word_count: state.word_count,
      deck_count: state.deck.length,
      song_count: fullIndex.song_count ?? null,
      deck: state.deck,
      artists: listAvailableArtists(),
    };
  }

  async function runAssistantRequest(body) {
    known = loadKnown();
    const result = await runLearnAssistant({
      fullIndex,
      message: body.message || "",
      history: body.history || [],
      level: body.level || state.level,
      weekly_target: body.weekly_target,
      rankingsDir,
      top: Number(body.top) || 50,
      known,
    });
    if (result.learn?.ok && result.learn.words?.length) {
      const deck = enrichDeckItems(result.learn.words);
      songFocus = { song: result.learn.song, deck };
      result.learn = {
        ...result.learn,
        words: deck,
        first: deck[0] || null,
        deck,
      };
    }
    if (result.week_plan || result.plan) {
      const week = loadCurrentWeekPlan();
      if (week) {
        result.plan = week;
        result.week_plan = week;
      }
    }
    if (result.session_plan) {
      const session = loadCurrentSessionPlan();
      if (session) result.session_plan = session;
    }
    return result;
  }

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
      const qArtist = url.searchParams.get("artist");
      if (qArtist) {
        const switched = applyArtist(qArtist);
        if (!switched.ok) {
          /* keep previous artist if query is invalid */
        }
      }
      const html = renderLearnHtml(activeDeck(), startIndex, `http://127.0.0.1:${port}`, {
        level: state.level,
        levelLabel: state.level_label,
        levels: availableLevels(),
        wordCount: state.word_count,
        artist: fullIndex.artist || "",
        artists: listAvailableArtists(),
      });
      return sendHtml(res, html);
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        llm: cfg.configured,
        model: cfg.model,
        deck: activeDeck().length,
        index_words: state.word_count,
        artist: fullIndex.artist || "",
        level: state.level,
        level_label: state.level_label,
        known_count: known.size,
        song_focus: songFocus?.song || null,
        artists: listAvailableArtists(),
      });
    }

    if (url.pathname === "/api/artists" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        artist: fullIndex.artist || "",
        artists: listAvailableArtists(),
        level: state.level,
        deck_count: activeDeck().length,
        word_count: state.word_count,
      });
    }

    if (url.pathname === "/api/artist" && (req.method === "POST" || req.method === "GET")) {
      let next = url.searchParams.get("artist");
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.artist) next = body.artist;
      }
      if (!next) {
        return sendJson(res, 400, {
          ok: false,
          error: "需要 artist，例如 artist=Taylor%20Swift",
          artists: listAvailableArtists(),
        });
      }
      const result = applyArtist(next);
      return sendJson(res, result.ok ? 200 : 404, result);
    }

    if (url.pathname === "/api/challenge/start" && req.method === "POST") {
      const body = await readBody(req);
      const lv = normalizeLevel(body.level || state.level);
      const created = createChallenge(fullIndex, lv);
      if (!created.ok) {
        return sendJson(res, 400, created);
      }
      challengeSessions.set(created.challenge_id, created.session);
      // Prune old sessions (keep last ~40)
      if (challengeSessions.size > 40) {
        const keys = [...challengeSessions.keys()];
        for (const k of keys.slice(0, keys.length - 40)) {
          challengeSessions.delete(k);
        }
      }
      return sendJson(res, 200, { ok: true, ...created.public });
    }

    if (url.pathname === "/api/challenge/progress" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.challenge_id || "").trim();
      if (!id) {
        return sendJson(res, 400, { ok: false, error: "需要 challenge_id" });
      }
      const session = challengeSessions.get(id);
      if (!session) {
        return sendJson(res, 404, {
          ok: false,
          error: "挑战已过期或不存在，请重新开始",
        });
      }
      session.answers = session.answers || {};
      const ans = body.answer || {};
      if (ans.id) {
        session.answers[ans.id] = {
          id: ans.id,
          known: ans.known,
          choice: ans.choice,
          blank: ans.blank,
        };
      }
      return sendJson(res, 200, { ok: true });
    }

    // After know round: build spot-check from claimed-known words only
    if (url.pathname === "/api/challenge/verify" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.challenge_id || "").trim();
      if (!id) {
        return sendJson(res, 400, { ok: false, error: "需要 challenge_id" });
      }
      const session = challengeSessions.get(id);
      if (!session) {
        return sendJson(res, 404, {
          ok: false,
          error: "挑战已过期或不存在，请重新开始",
        });
      }
      const result = beginVerifyPhase(session, body.answers || []);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === "/api/challenge/check" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.challenge_id || "").trim();
      const stepId = String(body.id || "").trim();
      if (!id || !stepId) {
        return sendJson(res, 400, { ok: false, error: "需要 challenge_id 与 id" });
      }
      const session = challengeSessions.get(id);
      if (!session) {
        return sendJson(res, 404, {
          ok: false,
          error: "挑战已过期或不存在，请重新开始",
        });
      }
      // Merge any know answers so far (for bust detection)
      session.answers = session.answers || {};
      for (const a of body.answers_so_far || []) {
        if (a && a.id) {
          session.answers[a.id] = {
            ...session.answers[a.id],
            id: a.id,
            known: a.known,
            choice: a.choice,
            blank: a.blank,
          };
        }
      }
      const result = await checkVerifyAnswer(session, stepId, {
        choice: body.choice,
        blank: body.blank,
      });
      if (result.ok && session.answers[stepId]) {
        session.answers[stepId].correct = result.correct;
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === "/api/challenge/finish" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.challenge_id || "").trim();
      if (!id) {
        return sendJson(res, 400, { ok: false, error: "需要 challenge_id" });
      }
      const session = challengeSessions.get(id);
      if (!session) {
        return sendJson(res, 404, {
          ok: false,
          error: "挑战已过期或不存在，请重新开始",
        });
      }
      // For any blank verifies not live-checked, run LLM grade before final score
      const secret = session.secret || {};
      session.answers = session.answers || {};
      for (const a of body.answers || []) {
        if (a && a.id) {
          session.answers[a.id] = {
            ...session.answers[a.id],
            id: a.id,
            known: a.known,
            choice: a.choice,
            blank: a.blank,
          };
        }
      }
      for (const [stepId, meta] of Object.entries(secret)) {
        if (meta.type !== "verify" || meta.mode !== "blank") continue;
        const ans = session.answers[stepId];
        if (!ans || typeof ans.correct === "boolean") continue;
        const blank = String(ans.blank ?? ans.choice ?? "").trim();
        let ok = localMeaningCorrect(meta.correct, blank);
        if (!ok) {
          const llm = await gradeBlankWithLlm(
            meta.word,
            blank,
            meta.line,
            meta.correct
          );
          ok = llm === null ? false : llm;
        }
        ans.correct = ok;
      }
      const graded = gradeChallenge(session, body.answers || []);
      challengeSessions.delete(id);
      return sendJson(res, 200, graded);
    }

    if (url.pathname === "/api/challenge/learn-unknowns" && req.method === "POST") {
      const body = await readBody(req);
      const words = Array.isArray(body.words) ? body.words : [];
      if (!words.length) {
        return sendJson(res, 400, { ok: false, error: "需要 words 数组" });
      }
      const deckItems = [];
      const indexWords = state.index?.words || fullIndex.words || {};
      for (const raw of words) {
        const word =
          typeof raw === "string"
            ? raw.toLowerCase()
            : String(raw?.word || "").toLowerCase();
        if (!word) continue;
        let occ = typeof raw === "object" && raw ? raw : null;
        if (!occ?.song_id && indexWords[word]?.[0]) {
          occ = { word, ...indexWords[word][0] };
        }
        if (!occ?.song_id) continue;
        deckItems.push({
          word,
          song_id: String(occ.song_id),
          song_name: occ.song_name || "",
          artist: occ.artist || fullIndex.artist || "",
          t_ms: Number(occ.t_ms) || 0,
          line: occ.line || "",
          line_zh: occ.line_zh || "",
          precision: occ.precision || "line",
          gloss: occ.gloss || lookupGloss(word),
        });
      }
      if (!deckItems.length) {
        return sendJson(res, 400, {
          ok: false,
          error: "这些词在当前词库里找不到可学条目",
        });
      }
      const deck = enrichDeckItems(deckItems);
      songFocus = {
        song: {
          name: "挑战复习",
          artist: fullIndex.artist || "",
          from: "challenge",
        },
        deck,
      };
      return sendJson(res, 200, {
        ok: true,
        deck,
        count: deck.length,
        song_focus: songFocus.song,
        artist: fullIndex.artist || "",
        level: state.level,
      });
    }

    if (url.pathname === "/api/levels" && req.method === "GET") {
      return sendJson(res, 200, {
        level: state.level,
        level_label: state.level_label,
        levels: availableLevels(),
        word_count: state.word_count,
        deck_count: activeDeck().length,
        artist: fullIndex.artist || "",
      });
    }

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
        artist: fullIndex.artist || "",
      });
    }

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

    /** Same-origin cover bytes for canvas palette extraction (Ambient Glow). */
    if (url.pathname === "/api/cover-image" && req.method === "GET") {
      const songId = String(url.searchParams.get("song_id") || "").trim();
      if (!songId) {
        return sendJson(res, 400, { ok: false, error: "需要 song_id" });
      }
      try {
        let coverUrl = coverCache.has(songId) ? coverCache.get(songId) : null;
        if (coverUrl === undefined || coverUrl === null) {
          if (!coverCache.has(songId)) {
            coverUrl = await netease.getSongCover(songId);
            coverCache.set(songId, coverUrl || null);
          }
        }
        if (!coverUrl) {
          return sendJson(res, 404, { ok: false, error: "无封面" });
        }
        const imgRes = await fetch(coverUrl);
        if (!imgRes.ok) {
          return sendJson(res, 502, {
            ok: false,
            error: `封面拉取失败 HTTP ${imgRes.status}`,
          });
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const ctype = imgRes.headers.get("content-type") || "image/jpeg";
        res.writeHead(200, {
          "Content-Type": ctype,
          "Content-Length": buf.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        });
        return res.end(buf);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    // Native play: audio URL + full timed lyrics (requires local api-enhanced)
    if (url.pathname === "/api/play" && req.method === "GET") {
      const songId = String(url.searchParams.get("song_id") || "").trim();
      if (!songId) {
        return sendJson(res, 400, { ok: false, error: "需要 song_id" });
      }
      if (playCache.has(songId) && url.searchParams.get("refresh") !== "1") {
        return sendJson(res, 200, { ...playCache.get(songId), cached: true });
      }
      try {
        const [audioUrl, lyr] = await Promise.all([
          netease.songPlayUrl(songId),
          netease.getTimedLyrics(songId),
        ]);
        const { source, lines: timed } = timedLinesFromSong(lyr);
        const zhLines = parseTlyric(lyr.lyric_tlyric || "");
        const lines = timed.map((row) => ({
          t_ms: row.t_ms,
          text: row.text,
          text_zh: nearestZhLine(zhLines, row.t_ms) || "",
        }));
        const payload = {
          ok: Boolean(audioUrl),
          song_id: songId,
          audio_url: audioUrl || "",
          lyric_source: source,
          lines,
          line_count: lines.length,
          error: audioUrl
            ? ""
            : "暂无可用播放地址（版权/地区限制），已降级为外链播放器",
        };
        playCache.set(songId, payload);
        return sendJson(res, 200, { ...payload, cached: false });
      } catch (e) {
        return sendJson(res, 200, {
          ok: false,
          song_id: songId,
          audio_url: "",
          lines: [],
          error: String(e.message || e),
        });
      }
    }

    if (url.pathname === "/api/search" && req.method === "GET") {
      const word = url.searchParams.get("word") || "";
      return sendJson(res, 200, {
        ...findWordInSongs(state.index, word),
        level: state.level,
        level_label: state.level_label,
      });
    }

    if (url.pathname === "/api/songs" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        artist: fullIndex.artist || "",
        songs: listSongsInIndex(state.index),
      });
    }

    if (url.pathname === "/api/learn-song" && req.method === "POST") {
      try {
        const body = await readBody(req);
        known = loadKnown();
        const result = learnSong(fullIndex, body.song_name || body.song, {
          level: state.level,
          known,
        });
        if (!result.ok) {
          return sendJson(res, 404, result);
        }
        const deck = enrichDeckItems(result.words);
        songFocus = { song: result.song, deck };
        return sendJson(res, 200, {
          ...result,
          words: deck,
          first: deck[0] || null,
          deck,
        });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/learn-song/clear" && req.method === "POST") {
      songFocus = null;
      return sendJson(res, 200, {
        ok: true,
        deck: state.deck,
        deck_count: state.deck.length,
      });
    }

    if (url.pathname === "/api/known" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, ...knownStats() });
    }

    if (url.pathname === "/api/known" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = markKnown({
          word: body.word,
          song_id: body.song_id,
          song_name: body.song_name,
          line: body.line,
          artist: body.artist,
        });
        known = loadKnown();
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/quiz" && req.method === "POST") {
      try {
        const body = await readBody(req);
        // Only from today's learned CET words — never current-song random pool
        const result = await generateQuiz({
          fullIndex,
          level: state.level,
          count: body.count || 3,
        });
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/quiz/grade" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, 200, gradeQuiz(body));
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = await runAssistantRequest(body);
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/assistant/chat" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = await runAssistantRequest(body);
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/coach/plan" && req.method === "GET") {
      const plan = loadCurrentWeekPlan();
      const session = loadCurrentSessionPlan();
      return sendJson(res, 200, {
        ok: Boolean(plan || session),
        plan: plan || null,
        session_plan: session || null,
        artist: fullIndex.artist || "",
        level: state.level,
      });
    }

    if (url.pathname === "/api/coach/plan" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = await runAssistantRequest(body);
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/coach/plan/accept" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = acceptWeekPlan(body.plan_id);
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
        const deck = activeDeck();
        const hit = deck.find(
          (d) => d.word === result.word && String(d.song_id) === String(result.song_id)
        );
        if (hit) {
          if (result.story) hit.story = result.story;
          if (result.line_zh) hit.line_zh = result.line_zh;
          if (result.gloss) hit.gloss = result.gloss;
          if (result.gloss_academic) hit.gloss_academic = result.gloss_academic;
          if (result.gloss_slang) hit.gloss_slang = result.gloss_slang;
          if (result.artist_note) hit.artist_note = result.artist_note;
        }
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }

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

    if (url.pathname === "/api/ranking/summary" && req.method === "GET") {
      const lv = normalizeLevel(url.searchParams.get("level") || "both");
      const top = Number(url.searchParams.get("top") || 50);
      let summary = loadSummary(rankingsDir, lv, top);
      if (!summary) {
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
