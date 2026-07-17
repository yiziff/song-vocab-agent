/**
 * Unified learn assistant (Mode B + coach + session + revise).
 * Ch.02 loop · Ch.04 stable prefix · Ch.09 checklist/session plans.
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
  buildSessionPlan,
  saveSessionPlan,
  loadCurrentSessionPlan,
  reviseWeekPlan,
  summarizePlansForAgent,
} from "./coachPlan.js";
import { loadSongTags } from "./tagSongs.js";
import { FIND_WORD_TOOL, findWordInSongs } from "./findWord.js";
import { LEARN_SONG_TOOL, learnSong } from "./learnSong.js";
import {
  buildAssistantMessages,
  buildStablePrefix,
} from "./assistantPrompt.js";

const MAX_STEPS = 8;

const PLAN_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_learning_progress",
      description:
        "读取用户已认识词数、今日进度。制定周计划前可先调用。",
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
        "按偏好筛选当前歌手的候选歌曲。出周计划/今晚一场/改口前必须先调用；禁止编造歌曲。",
      parameters: {
        type: "object",
        properties: {
          mellow: { type: "boolean" },
          melodic: { type: "boolean" },
          themes: {
            type: "array",
            items: { type: "string" },
            description:
              "主题：emotion | abstract | narrative | relationship | daily",
          },
          min_unique_words: { type: "number" },
          limit: { type: "number" },
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
        "用确定性算法生成 7 天周计划（须先 get_song_candidates）。成功会自动保存。",
      parameters: {
        type: "object",
        properties: {
          weekly_target: { type: "number" },
          themes: { type: "array", items: { type: "string" } },
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
      description: "把刚生成的周计划写入 out/plans/week_current.json。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_session_plan",
      description:
        "今晚/短时学习：1～2 首歌、约 8 词（可调）。须先 get_song_candidates。适合「今晚 15 分钟」「今天突击一下」。",
      parameters: {
        type: "object",
        properties: {
          word_target: {
            type: "number",
            description: "本场目标词数，默认 8",
          },
          max_songs: { type: "number", description: "最多几首歌，默认 2" },
          minutes_hint: {
            type: "number",
            description: "预估分钟，默认 15",
          },
          themes: { type: "array", items: { type: "string" } },
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
      name: "revise_week_plan",
      description:
        "按新约束重排已有周计划。若候选不足须先 get_song_candidates。" +
        "无周计划时会报错——应改用 build_week_plan 或 build_session_plan。",
      parameters: {
        type: "object",
        properties: {
          weekly_target: { type: "number" },
          themes: { type: "array", items: { type: "string" } },
          mellow: { type: "boolean" },
          melodic: { type: "boolean" },
          drop_day: {
            type: "number",
            description: "可选：丢掉某一天后重编号",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_plans",
      description:
        "查看当前已保存的周计划与今晚一场计划摘要。改口前建议先调用。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

const TOOLS = [FIND_WORD_TOOL, LEARN_SONG_TOOL, ...PLAN_TOOLS];

/**
 * @param {{
 *   fullIndex: object,
 *   message: string,
 *   history?: Array,
 *   level?: string,
 *   weekly_target?: number,
 *   rankingsDir?: string,
 *   top?: number,
 *   known?: Set<string>
 * }} opts
 */
export async function runLearnAssistant(opts) {
  const fullIndex = opts.fullIndex || { words: {}, artist: "" };
  const artist = fullIndex.artist || "Unknown";
  const level = opts.level || "both";
  const weeklyTargetDefault = Number(opts.weekly_target) || 30;
  const rankingsDir = opts.rankingsDir;
  const top = Number(opts.top) || 50;
  const known =
    opts.known instanceof Set ? opts.known : loadKnown();
  const message = String(opts.message || "").trim();
  const history = Array.isArray(opts.history) ? opts.history : [];
  const cfg = llmConfig();

  if (!cfg.configured) {
    return emptyFail("未配置 OPENAI_API_KEY（学词助手需要 DeepSeek）");
  }
  if (!message) {
    return emptyFail(
      "请输入需求，例如：今晚学 15 分钟舒缓歌 / 这周 30 个六级词 / 我要学 Runaway / bound 在哪"
    );
  }

  const tagsDoc = loadSongTags(artist, top);
  const session = {
    artist,
    level,
    top,
    weeklyTargetDefault,
    tagsAvailable: Boolean(tagsDoc),
    themes: listThemes(),
  };

  const state = {
    lastCandidates: null,
    lastFilterMeta: null,
    lastWeekPlan: null,
    lastSessionPlan: null,
    search: null,
    learn: null,
  };

  const ranking = resolveRanking(fullIndex, rankingsDir, artist, level, top);

  const built = buildAssistantMessages(
    session,
    { userMessage: message, history },
    TOOLS
  );
  const messages = built.messages;
  const debugCalls = [];
  let finalReply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    if (messages[0]?.role === "system") {
      const expected = buildStablePrefix(session).text;
      if (messages[0].content !== expected) {
        throw new Error(
          "Ch.04 prefix drift: system message mutated mid-loop"
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

  if (!finalReply) {
    if (state.lastSessionPlan) {
      finalReply = summarizeSession(state.lastSessionPlan, state.lastFilterMeta);
    } else if (state.lastWeekPlan) {
      finalReply = summarizeWeek(state.lastWeekPlan, state.lastFilterMeta);
    } else if (state.learn?.ok) {
      finalReply = `已打开「${state.learn.song?.song_name || ""}」：约 ${state.learn.count || 0} 个难点词。请在学习区拖进度条。`;
    } else if (state.search) {
      finalReply = state.search.found
        ? `找到「${state.search.word}」共 ${state.search.count} 处。`
        : `词库中未找到「${state.search.word || ""}」。`;
    }
  }

  return {
    ok: true,
    reply: finalReply || "",
    tool_calls: debugCalls,
    search: state.search,
    learn: state.learn,
    plan: state.lastWeekPlan,
    week_plan: state.lastWeekPlan,
    session_plan: state.lastSessionPlan,
    plan_id: state.lastWeekPlan?.plan_id || null,
    tags_available: Boolean(tagsDoc),
    filter_note: state.lastFilterMeta?.note || null,
    prefix_fingerprint: built.prefixFingerprint,
    request_fingerprint: built.requestFingerprint,
  };
}

function emptyFail(error) {
  return {
    ok: false,
    error,
    reply: "",
    tool_calls: [],
    search: null,
    learn: null,
    plan: null,
    week_plan: null,
    session_plan: null,
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

  if (name === "find_word_in_songs") {
    const search = findWordInSongs(fullIndex, args.word);
    state.search = search;
    return search;
  }

  if (name === "learn_song") {
    const learn = learnSong(fullIndex, args.song_name, { level, known });
    state.learn = learn;
    return {
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
  }

  if (name === "get_learning_progress") {
    const target = Number(args.weekly_target) || weeklyTargetDefault;
    const stats = knownStats();
    return {
      ok: true,
      artist,
      level,
      weekly_target: target,
      known_count: stats.known_count,
      today_count: stats.today_count,
      today_words: stats.today_words,
      remaining_for_week_estimate: Math.max(
        0,
        target - (stats.today_count || 0)
      ),
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
      return { ok: false, error: "请先调用 get_song_candidates" };
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
      state.lastWeekPlan = built.plan;
      try {
        saveWeekPlan(built.plan);
      } catch {
        /* ignore */
      }
    }
    return clipWeekPlanResult(built);
  }

  if (name === "save_week_plan") {
    if (!state.lastWeekPlan) {
      return { ok: false, error: "没有可保存的周计划" };
    }
    const saved = saveWeekPlan(state.lastWeekPlan);
    return {
      ok: true,
      plan_id: saved.plan_id,
      path: saved.current,
      message: "周计划已保存",
    };
  }

  if (name === "build_session_plan") {
    if (!state.lastCandidates?.length) {
      return { ok: false, error: "请先调用 get_song_candidates" };
    }
    const built = buildSessionPlan({
      fullIndex,
      candidates: state.lastCandidates,
      known,
      word_target: Number(args.word_target) || 8,
      max_songs: Number(args.max_songs) || 2,
      minutes_hint: Number(args.minutes_hint) || 15,
      level,
      themes: args.themes || state.lastFilterMeta?.themes || [],
      constraints: {
        mellow: Boolean(args.mellow),
        melodic: Boolean(args.melodic),
      },
      tags_note: state.lastFilterMeta?.note || null,
    });
    if (built.ok) {
      state.lastSessionPlan = built.plan;
      try {
        saveSessionPlan(built.plan);
      } catch {
        /* ignore */
      }
    }
    return clipSessionPlanResult(built);
  }

  if (name === "revise_week_plan") {
    const candidates = state.lastCandidates?.length
      ? state.lastCandidates
      : null;
    if (!candidates?.length) {
      return {
        ok: false,
        error: "请先调用 get_song_candidates，再 revise_week_plan",
      };
    }
    const revised = reviseWeekPlan({
      fullIndex,
      candidates,
      known,
      weekly_target:
        args.weekly_target != null
          ? Number(args.weekly_target)
          : undefined,
      level,
      themes: args.themes,
      constraints: {
        mellow: Boolean(args.mellow),
        melodic: Boolean(args.melodic),
      },
      tags_note: state.lastFilterMeta?.note || null,
      drop_day: args.drop_day != null ? Number(args.drop_day) : undefined,
    });
    if (revised.ok && revised.plan) {
      state.lastWeekPlan = revised.plan;
    }
    return clipWeekPlanResult(revised);
  }

  if (name === "get_current_plans") {
    return summarizePlansForAgent();
  }

  return { ok: false, error: `未知 tool: ${name}` };
}

function clipWeekPlanResult(built) {
  return {
    ok: built.ok,
    message: built.message,
    error: built.error,
    saved: Boolean(built.ok && built.plan),
    plan: built.plan
      ? {
          plan_id: built.plan.plan_id,
          kind: "week",
          objective: built.plan.objective,
          progress: built.plan.progress,
          tags_note: built.plan.tags_note,
          revise_note: built.plan.revise_note,
          days: (built.plan.days || []).map((d) => ({
            day: d.day,
            status: d.status,
            word_count: d.word_count,
            songs: (d.songs || []).map((s) => ({
              song_name: s.song_name,
              song_id: s.song_id,
              words: (s.words || []).map((w) => w.word),
              tags_zh: s.tags_zh,
              reason: s.reason,
            })),
          })),
        }
      : null,
  };
}

function clipSessionPlanResult(built) {
  return {
    ok: built.ok,
    message: built.message,
    saved: Boolean(built.ok && built.plan),
    plan: built.plan
      ? {
          plan_id: built.plan.plan_id,
          kind: "session",
          objective: built.plan.objective,
          minutes_hint: built.plan.minutes_hint,
          word_count: built.plan.word_count,
          progress: built.plan.progress,
          songs: (built.plan.songs || []).map((s) => ({
            song_name: s.song_name,
            song_id: s.song_id,
            words: (s.words || []).map((w) => w.word),
            tags_zh: s.tags_zh,
            reason: s.reason,
          })),
        }
      : null,
  };
}

function summarizeWeek(plan, filterMeta) {
  const lines = [
    `已为「${plan.artist}」生成周计划：目标 ${plan.progress?.target} 词，已分配 ${plan.progress?.allocated} 词。`,
  ];
  if (plan.revise_note) lines.push(plan.revise_note);
  if (filterMeta?.tag_filter_degraded || plan.tags_note) {
    lines.push(plan.tags_note || filterMeta.note || "");
  }
  for (const d of plan.days || []) {
    const songs = (d.songs || [])
      .map((s) => `${s.song_name}（${s.words.map((w) => w.word).join(", ")}）`)
      .join("；");
    lines.push(`第 ${d.day} 天：${songs || "（空）"}`);
  }
  lines.push("点击某首歌即可进入学习词卡。");
  return lines.filter(Boolean).join("\n");
}

function summarizeSession(plan, filterMeta) {
  const lines = [
    `今晚一场（约 ${plan.minutes_hint || 15} 分钟）：已分配 ${plan.word_count || plan.progress?.allocated || 0} 词。`,
  ];
  if (filterMeta?.tag_filter_degraded || plan.tags_note) {
    lines.push(plan.tags_note || filterMeta.note || "");
  }
  for (const s of plan.songs || []) {
    lines.push(
      `· ${s.song_name}：${(s.words || []).map((w) => w.word).join(", ")}`
    );
  }
  lines.push("点击歌名开始学。");
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

export {
  loadCurrentWeekPlan,
  loadCurrentSessionPlan,
  TOOLS as ASSISTANT_TOOLS,
};
