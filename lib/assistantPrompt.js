/**
 * Unified learn-assistant prompt builder (Ch.04).
 * Intent-routing system prefix — not a fixed 1→2→3→4 script.
 */

import { createHash } from "node:crypto";

/**
 * @typedef {{
 *   artist: string,
 *   level: string,
 *   top: number,
 *   weeklyTargetDefault: number,
 *   tagsAvailable: boolean,
 *   themes: string[],
 * }} AssistantSession
 */

/**
 * @param {AssistantSession} session
 * @returns {{ text: string, fingerprint: string }}
 */
export function buildStablePrefix(session) {
  const artist = String(session.artist || "Unknown");
  const level = String(session.level || "both");
  const top = Number(session.top) || 50;
  const weeklyTargetDefault = Number(session.weeklyTargetDefault) || 30;
  const themes = [...(session.themes || [])].map(String).sort();
  const tagsAvailable = Boolean(session.tagsAvailable);

  const tagsLine = tagsAvailable
    ? "已有 song_tags（Spotify+Last.fm），可用 mellow/melodic 过滤。"
    : `尚无 song_tags。若用户要舒缓/旋律，仍可出计划，但须告知先运行：node cli.js tag-songs --artist "${artist}" --top ${top}`;

  const text = [
    `你是听歌学英语的「学词助手」。当前歌手锁定为「${artist}」（不可推荐其他歌手）。`,
    `当前词表等级：${level}。可用主题：${themes.join(", ")}。`,
    tagsLine,
    "根据用户意图选择工具（可多轮、可组合），不要死板按固定顺序：",
    "- 查某个单词在歌里的位置 → find_word_in_songs",
    "- 「我要学某某歌」→ learn_song",
    "- 今晚 / 今天 / 15 分钟 / 短时突击 → get_song_candidates 后 build_session_plan",
    "- 本周 / 7 天 / 周计划 → get_learning_progress（可选）→ get_song_candidates → build_week_plan（会自动保存）",
    "- 改口重排已有周计划（改目标词数、去掉太燥、换主题）→ get_current_plans →（必要时）get_song_candidates → revise_week_plan",
    "- 想看当前计划摘要 → get_current_plans",
    "规则：",
    "1) 禁止编造未出现在 tool 结果中的歌曲或单词。",
    "2) 必须用 get_song_candidates 拿真实歌单后再 build_* / revise。",
    "3) 用户说了数字（词数、分钟）以用户为准；否则周目标默认 " +
      weeklyTargetDefault +
      " 词，今晚一场默认约 8 词 / 15 分钟。",
    "4) 用简洁中文回复；若返回了计划或学歌结果，说明关键数字并引导点击歌名学习。",
    "5) 若需求不清，先问一句澄清，而不是瞎调工具。",
  ].join("\n");

  return {
    text,
    fingerprint: sha256Hex(text),
  };
}

/**
 * @param {{ userMessage: string, history?: Array }} run
 */
export function buildVolatileTail(run) {
  const history = Array.isArray(run.history) ? run.history : [];
  const userMessage = String(run.userMessage || "").trim();
  const messages = [];

  for (const m of history) {
    if (!m || !m.role) continue;
    // Only pass roles the chat API accepts in history
    if (m.role === "user" || m.role === "assistant") {
      messages.push({
        role: m.role,
        content: m.content != null ? String(m.content) : "",
      });
    }
  }

  if (userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  return messages;
}

export function buildAssistantMessages(session, run, tools) {
  const prefix = buildStablePrefix(session);
  const tail = buildVolatileTail(run);
  const messages = [{ role: "system", content: prefix.text }, ...tail];
  const toolsPart = tools != null ? stableStringify(tools) : "";
  const requestFingerprint = sha256Hex(
    prefix.text + "\n---tools---\n" + toolsPart
  );
  return {
    messages,
    prefixFingerprint: prefix.fingerprint,
    requestFingerprint,
  };
}

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeysDeep(value[k]);
    }
    return out;
  }
  return value;
}
