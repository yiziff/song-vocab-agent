/**
 * Coach prompt builder (Ch.04 contract).
 *
 * Audit of the old inline system string (2026-07-17):
 * - No Date.now() / session id / locale formatting in system — OK.
 * - User utterance already in role:user — OK (tail).
 * - Progress / known words via tools, not system — OK.
 * - RISK: listThemes() used Object.keys without sort → non-deterministic
 *   theme order could change prefix bytes across runs/Node versions.
 * - Session-scoped fields (artist, level, tagsAvailable, weeklyTargetDefault)
 *   belong in the frozen prefix for this run; must not be rewritten mid-loop.
 * - Dynamic progress stays in tool results (volatile tail).
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
 * }} CoachSession
 */

/**
 * @typedef {{
 *   userMessage: string,
 *   history?: Array<{ role: string, content?: string|null, tool_calls?: unknown, tool_call_id?: string }>,
 * }} CoachRunState
 */

/**
 * @param {CoachSession} session
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
    `你是听歌学英语的「学习教练」。当前歌手锁定为「${artist}」（不可推荐其他歌手）。`,
    `当前词表等级：${level}。可用主题：${themes.join(", ")}。`,
    tagsLine,
    "工作流程：",
    "1) get_learning_progress",
    "2) get_song_candidates（把用户的舒缓→mellow、旋律好听→melodic、情绪→emotion、抽象→abstract）",
    "3) build_week_plan",
    "4) save_week_plan",
    "5) 用中文简洁说明计划：几天、每天几首歌、为何选这些歌（引用 tool 返回的 tags_zh / theme_words）。",
    "禁止编造未出现在 tool 结果中的歌曲或单词。",
    `默认周目标 ${weeklyTargetDefault} 词；用户若说了数字则以用户为准。`,
  ].join("\n");

  return {
    text,
    fingerprint: sha256Hex(text),
  };
}

/**
 * Volatile tail only — never put timestamps or live progress here as system.
 * @param {CoachRunState} run
 * @returns {Array<object>}
 */
export function buildVolatileTail(run) {
  const history = Array.isArray(run.history) ? run.history : [];
  const userMessage = String(run.userMessage || "").trim();
  const messages = [];

  for (const m of history) {
    if (!m || !m.role) continue;
    messages.push(m);
  }

  if (userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  return messages;
}

/**
 * Full chat messages: frozen system + volatile tail.
 * Mid-loop: only append to the returned array; never rewrite messages[0].
 * @param {CoachSession} session
 * @param {CoachRunState} run
 * @param {unknown} [tools] optional tool schemas included in requestFingerprint
 */
export function buildCoachMessages(session, run, tools) {
  const prefix = buildStablePrefix(session);
  const tail = buildVolatileTail(run);
  const messages = [{ role: "system", content: prefix.text }, ...tail];

  const toolsPart = tools != null ? stableStringify(tools) : "";
  const requestFingerprint = sha256Hex(prefix.text + "\n---tools---\n" + toolsPart);

  return {
    messages,
    prefixFingerprint: prefix.fingerprint,
    requestFingerprint,
  };
}

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** Deterministic JSON for fingerprints (sorted object keys). */
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
