import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { llmConfig } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENRICH_DIR = path.join(ROOT, "out", "enrich");
/** Prefer merged CET-4+6 glossary; fall back to separate files. */
const GLOSSARY_PATHS = [
  path.join(ROOT, "data", "cet46_glossary.json"),
  path.join(ROOT, "data", "cet6_glossary.json"),
  path.join(ROOT, "data", "cet4_glossary.json"),
];

let glossaryCache = null;

export function loadGlossary() {
  if (glossaryCache) return glossaryCache;
  glossaryCache = {};
  for (const p of GLOSSARY_PATHS) {
    if (!fs.existsSync(p)) continue;
    try {
      const part = JSON.parse(fs.readFileSync(p, "utf8"));
      // First file wins for a key (cet46 already prefers richer cet6 glosses).
      for (const [k, v] of Object.entries(part)) {
        if (!(k in glossaryCache)) glossaryCache[k] = v;
      }
    } catch {
      /* ignore bad glossary file */
    }
  }
  return glossaryCache;
}

export function lookupGloss(word) {
  const g = loadGlossary();
  return g[String(word || "").toLowerCase()] || "";
}

export function enrichCacheKey(songId, word) {
  const safe = String(word || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
  return `${songId}__${safe}.json`;
}

export function readEnrichCache(songId, word) {
  const file = path.join(ENRICH_DIR, enrichCacheKey(songId, word));
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeEnrichCache(songId, word, data) {
  fs.mkdirSync(ENRICH_DIR, { recursive: true });
  const file = path.join(ENRICH_DIR, enrichCacheKey(songId, word));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Cache is usable only when dual-gloss fields are present. */
function cacheHasDualGloss(cached) {
  return Boolean(
    cached &&
      String(cached.gloss_slang || "").trim() &&
      String(cached.artist_note || "").trim()
  );
}

/**
 * @param {{ word, song_id, song_name, artist, line, line_zh?, t_ms?, gloss?, force? }} input
 */
export async function enrichOccurrence(input) {
  const word = String(input.word || "").toLowerCase();
  const songId = String(input.song_id || "");
  if (!word || !songId) throw new Error("word and song_id required");

  if (!input.force) {
    const cached = readEnrichCache(songId, word);
    if (cacheHasDualGloss(cached)) {
      return {
        ...cached,
        gloss_academic: cached.gloss_academic || cached.gloss || lookupGloss(word),
        cached: true,
      };
    }
  }

  const gloss = input.gloss || lookupGloss(word);
  const cfg = llmConfig();
  if (!cfg.configured) {
    return {
      word,
      song_id: songId,
      gloss,
      gloss_academic: gloss,
      gloss_slang: "",
      artist_note: "",
      line_zh: input.line_zh || "",
      story: "",
      error: "未配置 OPENAI_API_KEY（请在 .env 中填写 DeepSeek Key）",
      cached: false,
    };
  }

  const payload = await callDeepSeek(cfg, {
    word,
    song_name: input.song_name || "",
    artist: input.artist || "",
    line: input.line || "",
    line_zh: input.line_zh || "",
    gloss,
  });

  const result = {
    word,
    song_id: songId,
    song_name: input.song_name || "",
    artist: input.artist || "",
    line: input.line || "",
    gloss,
    gloss_academic: gloss,
    gloss_slang: payload.gloss_slang || "",
    artist_note: payload.artist_note || "",
    line_zh: payload.line_zh || input.line_zh || "",
    story: payload.story || "",
    model: cfg.model,
    created_at: new Date().toISOString(),
    cached: false,
  };
  writeEnrichCache(songId, word, result);
  return result;
}

async function callDeepSeek(cfg, ctx) {
  const system = `你是听歌学英语助手。根据「歌手、歌名、目标词、英文歌词行、词典义」用中文做简短讲解。
要求：
1. 返回严格 JSON 对象，键为 line_zh、story、gloss_slang、artist_note，不要 markdown。
2. line_zh：该英文歌词行的通顺中文翻译（若已有译文可润色，不要空）。
3. gloss_slang：该词在本句歌词里的「街头义 / 口语义 / 隐喻义」，1～2 句中文。若用法与词典义几乎相同，也要写清「歌里就是…」；不要只重复词典义。
4. artist_note：用接近该歌手口吻的一句中文点评（可带一点态度），帮助记忆；学习向，不人身攻击，不煽动仇恨。
5. story：2～4 句中文。先点明这句在歌里的场景，再解释目标词在此语境的用意（深度语义缝合）。
6. 不编造与歌词无关的情节；不确定就写「从这句字面看…」。
7. 不要复述整首歌剧情，聚焦这一行与这个词。`;

  const user = JSON.stringify(
    {
      artist: ctx.artist,
      song_name: ctx.song_name,
      word: ctx.word,
      line_en: ctx.line,
      line_zh_hint: ctx.line_zh || null,
      dictionary: ctx.gloss || null,
    },
    null,
    2
  );

  const url = `${cfg.baseURL}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }
  return {
    line_zh: String(parsed.line_zh || "").trim(),
    story: String(parsed.story || "").trim(),
    gloss_slang: String(parsed.gloss_slang || "").trim(),
    artist_note: String(parsed.artist_note || "").trim(),
  };
}
