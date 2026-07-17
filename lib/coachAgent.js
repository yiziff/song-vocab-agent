/**
 * Learning coach agent (Ch.02 loop + Ch.09 checklist + Ch.04 stable prefix).
 * LLM parses intent; deterministic tools build the week plan.
 */

import { llmConfig } from "./env.js";
import { knownStats, loadKnown } from "./progress.js";
import {
  loadRankingByArtist,
  rankSongsByVocab,
} from "./rank.js";
import { filterSongs, listThemes } from "./filterSongs.js";
import {
  buildWeekPlan,
  saveWeekPlan,
  loadCurrentWeekPlan,
} from "./coachPlan.js";
import { loadSongTags } from "./tagSongs.js";
import { buildCoachMessages, buildStablePrefix } from "./coachPrompt.js";

const MAX_STEPS = 6;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_learning_progress",
      description:
        "读取用户已认识词数、今日进度，以及相对周目标还差多少词。制定计划前应先调用。",
      parameters: {
        type: "object",
        properties: {
          weekly_target: {
            type: "number",
            description: "本周目标词数，默认 30",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_song_candidates",
      description:
        "按偏好筛选当前歌手的候选歌曲（词汇统计 + 可选舒缓/旋律标签 + 主题种子词）。" +
        "必须调用此工具获取真实歌单，禁止编造歌曲。",
      parameters: {
        type: "object",
        properties: {
          mellow: {
            type: "boolean",
            description: "用户要求舒缓/冷静/不燥时为 true",
          },
          melodic: {
            type: "boolean",
            description: "用户要求旋律好听时为 true",
          },
          themes: {
            type: "array",
            items: { type: "string" },
            description:
              "主题：emotion | abstract | narrative | relationship | daily",
          },
          min_unique_words: {
            type: "number",
            description: "最少唯一词数，默认 3",
          },
          limit: {
            type: "number",
            description: "返回候选数量，默认 15",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_week_plan",
      description:
        "根据最近一次 get_song_candidates 的结果，用确定性算法生成 7 天 checklist 周计划。" +
        "必须先调用 get_song_candidates。",
      parameters: {
        type: "object",
        properties: {
          weekly_target: { type: "number", description: "周目标词数，默认 30" },
          themes: {
            type: "array",
            items: { type: "string" },
          },
          mellow: { type: "boolean" },
          melodic: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_week_plan",
      description: "把刚生成的周计划写入磁盘（out/plans/week_current.json）。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

/**
 * @param {{
 *   fullIndex: object,
 *   message: string,
 *   level?: string,
 *   weekly_target?: number,
 *   rankingsDir?: string,
 *   top?: number,
 *   known?: Set<string>
 * }} opts
 */
export async function runCoachAgent(opts) {
  const fullIndex = opts.fullIndex || { words: {}, artist: "" };
  const artist = fullIndex.artist || "Unknown";
  const level = opts.level || "both";
  const weeklyTargetDefault = Number(opts.weekly_target) || 30;
  const rankingsDir = opts.rankingsDir;
  const top = Number(opts.top) || 50;
  const known =
    opts.known instanceof Set ? opts.known : loadKnown();
  const message = String(opts.message || "").trim();
  const cfg = llmConfig();

  if (!cfg.configured) {
    return {
      ok: false,
      error: "未配置 OPENAI_API_KEY（学习教练需要 DeepSeek）",
      reply: "",
      plan: null,
      tool_calls: [],
    };
  }
  if (!message) {
    return {
      ok: false,
      error: "请描述你的学习需求，例如：这周学 30 个六级词，要舒缓一点，偏情绪词",
      reply: "",
      plan: null,
      tool_calls: [],
    };
  }

  const tagsDoc = loadSongTags(artist, top);

  /** Frozen session snapshot — never rewrite mid-loop (Ch.04 immutability). */
  const session = {
    artist,
    level,
    top,
    weeklyTargetDefault,
    tagsAvailable: Boolean(tagsDoc),
    themes: listThemes(),
  };

  /** session state shared across tool calls (working memory, Ch.05) */
  const state = {
    lastCandidates: null,
    lastPlan: null,
    lastFilterMeta: null,
  };

  const ranking = resolveRanking(fullIndex, rankingsDir, artist, level, top);

  const built = buildCoachMessages(
    session,
    { userMessage: message },
    TOOLS
  );
  const messages = built.messages;
  const prefixFingerprint = built.prefixFingerprint;
  const requestFingerprint = built.requestFingerprint;

  const debugCalls = [];
  let finalReply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    // Guard: system prefix must stay byte-identical across steps
    if (messages[0]?.role === "system") {
      const expected = buildStablePrefix(session).text;
      if (messages[0].content !== expected) {
        throw new Error(
          "Ch.04 prefix drift: system message mutated mid-loop (immutability violated)"
        );
      }
    }

    const response = await chat(cfg, messages, TOOLS);
    const toolCalls = response?.tool_calls || [];

    if (!toolCalls.length) {
      finalReply = response?.content || "";
      break;
    }

    messages.push({
      role: "assistant",
      content: response.content || null,
      tool_calls: toolCalls,
    });

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
      try {
        result = executeTool(name, args, {
          fullIndex,
          artist,
          level,
          top,
          known,
          ranking,
          weeklyTargetDefault,
          state,
        });
      } catch (e) {
        result = { ok: false, error: String(e.message || e) };
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  // If model never produced text but we have a plan, summarize deterministically
  if (!finalReply && state.lastPlan) {
    finalReply = summarizePlan(state.lastPlan, state.lastFilterMeta);
  }

  return {
    ok: true,
    reply: finalReply,
    plan: state.lastPlan,
    plan_id: state.lastPlan?.plan_id || null,
    tags_available: Boolean(tagsDoc),
    tool_calls: debugCalls,
    filter_note: state.lastFilterMeta?.note || null,
    prefix_fingerprint: prefixFingerprint,
    request_fingerprint: requestFingerprint,
  };
}

function resolveRanking(fullIndex, rankingsDir, artist, level, top) {
  if (rankingsDir) {
    const fromDisk = loadRankingByArtist(rankingsDir, artist, level, top);
    if (fromDisk?.songs?.length) return fromDisk;
  }
  return rankSongsByVocab(fullIndex, level);
}

function executeTool(name, args, ctx) {
  const {
    fullIndex,
    artist,
    level,
    top,
    known,
    ranking,
    weeklyTargetDefault,
    state,
  } = ctx;

  if (name === "get_learning_progress") {
    const target = Number(args.weekly_target) || weeklyTargetDefault;
    const stats = knownStats();
    const remaining = Math.max(0, target - (stats.today_count || 0));
    return {
      ok: true,
      artist,
      level,
      weekly_target: target,
      known_count: stats.known_count,
      today_count: stats.today_count,
      today_words: stats.today_words,
      remaining_for_week_estimate: remaining,
      note: "remaining_for_week_estimate 用今日已学粗估；正式分配以 build_week_plan 为准",
    };
  }

  if (name === "get_song_candidates") {
    const filtered = filterSongs({
      ranking,
      fullIndex,
      artist,
      level,
      top,
      mellow: Boolean(args.mellow),
      melodic: Boolean(args.melodic),
      themes: args.themes || [],
      min_unique_words: Number(args.min_unique_words) || 3,
      limit: Number(args.limit) || 15,
    });
    state.lastCandidates = filtered.candidates;
    state.lastFilterMeta = filtered;
    // Clip for model context
    return {
      ok: filtered.ok,
      tags_available: filtered.tags_available,
      tag_filter_applied: filtered.tag_filter_applied,
      tag_filter_degraded: filtered.tag_filter_degraded,
      note: filtered.note,
      themes: filtered.themes,
      candidate_count: filtered.candidate_count,
      candidates: (filtered.candidates || []).map((c) => ({
        song_id: c.song_id,
        song_name: c.song_name,
        unique_words: c.unique_words,
        theme_hit_total: c.theme_hit_total,
        theme_words: c.theme_words,
        tags_zh: c.tags_zh,
        tags: {
          mellow: Boolean(c.tags?.mellow || c.tags?.mood_calm),
          melodic: Boolean(c.tags?.melodic || c.tags?.melodic_hint),
          energetic: Boolean(c.tags?.energetic),
        },
        score: Math.round(c.score * 100) / 100,
        reason_hint: c.tags_zh?.length
          ? c.tags_zh.join("、")
          : `unique=${c.unique_words}`,
      })),
    };
  }

  if (name === "build_week_plan") {
    if (!state.lastCandidates?.length) {
      return {
        ok: false,
        error: "请先调用 get_song_candidates",
      };
    }
    const target = Number(args.weekly_target) || weeklyTargetDefault;
    const built = buildWeekPlan({
      fullIndex,
      candidates: state.lastCandidates,
      known,
      weekly_target: target,
      level,
      themes: args.themes || state.lastFilterMeta?.themes || [],
      constraints: {
        mellow: Boolean(args.mellow),
        melodic: Boolean(args.melodic),
      },
      tags_note: state.lastFilterMeta?.note || null,
    });
    if (built.ok) {
      state.lastPlan = built.plan;
      // Persist immediately so GET /api/coach/plan works even if model skips save
      try {
        saveWeekPlan(built.plan);
      } catch {
        /* ignore disk errors; save_week_plan tool can retry */
      }
    }
    return {
      ok: built.ok,
      message: built.message,
      saved: Boolean(built.ok),
      plan: built.plan
        ? {
            plan_id: built.plan.plan_id,
            objective: built.plan.objective,
            progress: built.plan.progress,
            tags_note: built.plan.tags_note,
            days: (built.plan.days || []).map((d) => ({
              day: d.day,
              status: d.status,
              word_count: d.word_count,
              songs: (d.songs || []).map((s) => ({
                song_name: s.song_name,
                song_id: s.song_id,
                words: s.words.map((w) => w.word),
                tags_zh: s.tags_zh,
                reason: s.reason,
              })),
            })),
          }
        : null,
    };
  }

  if (name === "save_week_plan") {
    if (!state.lastPlan) {
      return { ok: false, error: "没有可保存的计划，请先 build_week_plan" };
    }
    const saved = saveWeekPlan(state.lastPlan);
    return {
      ok: true,
      plan_id: saved.plan_id,
      path: saved.current,
      message: "计划已保存到 out/plans/week_current.json",
    };
  }

  return { ok: false, error: `未知 tool: ${name}` };
}

function summarizePlan(plan, filterMeta) {
  const lines = [
    `已为「${plan.artist}」生成周计划：目标 ${plan.progress?.target} 词，已分配 ${plan.progress?.allocated} 词。`,
  ];
  if (filterMeta?.tag_filter_degraded || plan.tags_note) {
    lines.push(plan.tags_note || filterMeta.note || "");
  }
  for (const d of plan.days || []) {
    const songs = (d.songs || [])
      .map(
        (s) =>
          `${s.song_name}（${s.words.map((w) => w.word).join(", ")}）`
      )
      .join("；");
    lines.push(`第 ${d.day} 天：${songs || "（空）"}`);
  }
  lines.push("点击某首歌即可进入学习词卡。");
  return lines.filter(Boolean).join("\n");
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

export { loadCurrentWeekPlan };
