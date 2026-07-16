/**
 * Mode B: one-shot agent loop with find_word_in_songs + learn_song.
 */

import { llmConfig } from "./env.js";
import { FIND_WORD_TOOL, findWordInSongs } from "./findWord.js";
import { LEARN_SONG_TOOL, learnSong } from "./learnSong.js";

const TOOLS = [FIND_WORD_TOOL, LEARN_SONG_TOOL];

/**
 * @param {{ index: object, message: string, history?: Array, level?: string, known?: Set<string> }} opts
 */
export async function runFindWordAgent(opts) {
  const { index, message } = opts;
  const history = Array.isArray(opts.history) ? opts.history : [];
  const known = opts.known instanceof Set ? opts.known : new Set();
  const cfg = llmConfig();
  const level = String(opts.level || index?.level || "both");
  const levelHint =
    level === "cet4" ? "四级词" : level === "cet6" ? "六级词" : "四级∪六级词";

  if (!cfg.configured) {
    return {
      ok: false,
      error: "未配置 OPENAI_API_KEY（Mode B 需要 DeepSeek）",
      reply: "",
      tool_calls: [],
      search: null,
      learn: null,
    };
  }

  if (!String(message || "").trim()) {
    return {
      ok: false,
      error: "请输入一句话，例如：帮我找找 bound 在歌里哪 / 我要学 Runaway",
      reply: "",
      tool_calls: [],
      search: null,
      learn: null,
    };
  }

  const messages = [
    {
      role: "system",
      content:
        `你是听歌学${levelHint}助手。` +
        "需要查某个单词在歌里的位置时，调用 find_word_in_songs。" +
        "用户要学某一首歌（如「我要学 Runaway」）时，调用 learn_song。" +
        "拿到 tool 结果后，用简洁中文回答。" +
        "若是 learn_song：说明歌名、有多少难点词、第一词与时间戳提示，提醒用户在学习页拖进度条。" +
        "若是搜词：列出歌名与大致时间；未找到则如实说明。" +
        "不要编造没有返回的歌曲或单词。",
    },
    ...history.filter((m) => m && m.role && m.content),
    { role: "user", content: String(message).trim() },
  ];

  const first = await chat(cfg, messages, TOOLS);
  const toolCalls = first?.tool_calls || [];
  const debugCalls = [];
  let search = null;
  let learn = null;

  if (!toolCalls.length) {
    return {
      ok: true,
      reply: first?.content || "（模型未调用工具，也未返回文字）",
      tool_calls: [],
      search: null,
      learn: null,
    };
  }

  const follow = [
    ...messages,
    { role: "assistant", content: first.content || null, tool_calls: toolCalls },
  ];

  for (const tc of toolCalls) {
    const name = tc.function?.name;
    let args = {};
    try {
      args = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      args = {};
    }
    debugCalls.push({ id: tc.id, name, arguments: args });

    let result;
    if (name === "find_word_in_songs") {
      search = findWordInSongs(index, args.word);
      result = search;
    } else if (name === "learn_song") {
      learn = learnSong(index, args.song_name, { level, known });
      // Clip words for model context; full list goes to frontend via `learn`
      result = {
        ok: learn.ok,
        song: learn.song,
        count: learn.count || (learn.words || []).length,
        first: learn.first,
        seek_hint: learn.seek_hint,
        words_preview: (learn.words || []).slice(0, 8).map((w) => ({
          word: w.word,
          t_ms: w.t_ms,
        })),
        message: learn.message,
        hint: learn.hint,
        suggestions: learn.suggestions,
        code: learn.code,
      };
    } else {
      result = { error: `未知 tool: ${name}` };
    }

    follow.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(result),
    });
  }

  const second = await chat(cfg, follow, TOOLS);
  return {
    ok: true,
    reply: second?.content || "",
    tool_calls: debugCalls,
    search,
    learn,
  };
}

async function chat(cfg, messages, tools) {
  const url = `${cfg.baseURL}/v1/chat/completions`;
  const body = {
    model: cfg.model,
    temperature: 0.3,
    messages,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message || {};
}
