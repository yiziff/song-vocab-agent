import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichOccurrence, lookupGloss, readEnrichCache } from "./enrich.js";
import { llmConfig } from "./env.js";
import { buildDeck, renderLearnHtml } from "./play.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

/**
 * @param {{ deck: Array, port?: number, startIndex?: number }} opts
 */
export function startLearnServer(opts) {
  const port = Number(opts.port || process.env.LEARN_PORT || 8787);
  const deck = buildDeck(opts.deck || []);
  // merge existing enrich cache into deck
  for (const item of deck) {
    const cached = readEnrichCache(item.song_id, item.word);
    if (cached) {
      if (cached.story) item.story = cached.story;
      if (cached.line_zh) item.line_zh = cached.line_zh;
      if (cached.gloss) item.gloss = cached.gloss;
    }
    if (!item.gloss) item.gloss = lookupGloss(item.word);
  }

  const cfg = llmConfig();
  const startIndex = opts.startIndex || 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (url.pathname === "/" || url.pathname === "/learn") {
      const html = renderLearnHtml(deck, startIndex, `http://127.0.0.1:${port}`);
      return sendHtml(res, html);
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        llm: cfg.configured,
        model: cfg.model,
        deck: deck.length,
      });
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
        // keep in-memory deck warm
        const hit = deck.find(
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

    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}/learn`,
        llmConfigured: cfg.configured,
      });
    });
  });
}
