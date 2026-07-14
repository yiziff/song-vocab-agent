/**
 * Mode B: one-shot agent loop with a single tool find_word_in_songs (Ch.01).
 */

import { llmConfig } from "./env.js";
import { FIND_WORD_TOOL, findWordInSongs } from "./findWord.js";

/**
 * @param {{ index: object, message: string, history?: Array, level?: string }} opts
 */
export async function runFindWordAgent(opts) {
  const { index, message } = opts;
  const history = Array.isArray(opts.history) ? opts.history : [];
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
    };
  }

  if (!String(message || "").trim()) {
    return {
      ok: false,
      error: "请输入一句话，例如：帮我找找 bound 在歌里哪",
      reply: "",
      tool_calls: [],
      search: null,
    };
  }

  const messages = [
    {
      role: "system",
      content:
        `你是听歌学${levelHint}助手。用户想在自己喜欢的歌手歌词库里定位生词。` +
        "需要查词在歌里的位置时，必须调用 find_word_in_songs。" +
        "拿到 tool 结果后，用简洁中文回答：词、命中几处、列出歌名与大致时间；" +
        `若未找到，如实说明可能不在当前词库（${levelHint}∩已选歌曲）。` +
        "不要编造没有返回的歌曲。",
    },
    ...history.filter((m) => m && m.role && m.content),
    { role: "user", content: String(message).trim() },
  ];

  const first = await chat(cfg, messages, [FIND_WORD_TOOL]);
  const toolCalls = first?.tool_calls || [];
  const debugCalls = [];
  let search = null;

  if (!toolCalls.length) {
    return {
      ok: true,
      reply: first?.content || "（模型未调用搜词工具，也未返回文字）",
      tool_calls: [],
      search: null,
    };
  }

  const follow = [...messages, { role: "assistant", content: first.content || null, tool_calls: toolCalls }];

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
    } else {
      result = { error: `未知 tool: ${name}` };
    }

    follow.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(result),
    });
  }

  const second = await chat(cfg, follow, [FIND_WORD_TOOL]);
  return {
    ok: true,
    reply: second?.content || "",
    tool_calls: debugCalls,
    search,
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
