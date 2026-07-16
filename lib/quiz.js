/**
 * Generative fill-in-the-blank quiz from lyric lines (local grading).
 * Pool = today's learned CET words only; unlock after >5 today.
 */
import { llmConfig } from "./env.js";
import {
  knownStats,
  todayLearnedQuizPool,
  QUIZ_UNLOCK_AFTER_TODAY,
} from "./progress.js";
import { lexiconForLevel } from "./vocabLevel.js";

export { QUIZ_UNLOCK_AFTER_TODAY };

/**
 * @param {{
 *   fullIndex: object,
 *   level?: string,
 *   count?: number,
 * }} opts
 */
export async function generateQuiz(opts) {
  const stats = knownStats();
  const cfg = llmConfig();
  const count = Math.min(Math.max(Number(opts.count) || 3, 1), 5);

  if (!stats.quiz_unlocked) {
    return {
      ok: false,
      code: "quiz_locked",
      error: `今日需点「认识」超过 ${QUIZ_UNLOCK_AFTER_TODAY} 个词才能小测（还需 ${stats.quiz_need} 个）`,
      questions: [],
      stats,
    };
  }

  const level = opts.level || "both";
  const vocabSet = lexiconForLevel(level);
  const pool = todayLearnedQuizPool(opts.fullIndex || { words: {} }, vocabSet);

  if (pool.length < 1) {
    return {
      ok: false,
      code: "no_learned_pool",
      error:
        "今日已认识的词里，没有可在当前词库出题的四六级词。请继续点「认识」学习。",
      questions: [],
      stats,
    };
  }

  // Prefer up to `count` from today's learned; never invent outside pool
  const picked = shuffle(pool).slice(0, Math.min(count, pool.length));

  if (!cfg.configured) {
    const questions = picked.map((p, i) => localBlank(p, i));
    return {
      ok: true,
      questions,
      feedback: checkInFeedback(stats, null),
      stats,
      pool_size: pool.length,
      model: null,
      offline: true,
    };
  }

  try {
    const questions = await callDeepSeekQuiz(cfg, picked);
    return {
      ok: true,
      questions,
      feedback: checkInFeedback(stats, questions.length),
      stats,
      pool_size: pool.length,
      model: cfg.model,
      offline: false,
    };
  } catch (e) {
    const questions = picked.map((p, i) => localBlank(p, i));
    return {
      ok: true,
      questions,
      feedback: checkInFeedback(stats, questions.length),
      stats,
      pool_size: pool.length,
      model: null,
      offline: true,
      warning: String(e.message || e),
    };
  }
}

/**
 * Local grade — do not trust the model as judge.
 * @param {{ answers: Array<{ id: string|number, answer: string }>, questions: Array }} input
 */
export function gradeQuiz(input) {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const answers = Array.isArray(input.answers) ? input.answers : [];
  const byId = new Map(
    answers.map((a) => [String(a.id), String(a.answer || "")])
  );

  const results = questions.map((q) => {
    const id = String(q.id);
    const expected = normalizeAnswer(q.answer || q.word);
    const got = normalizeAnswer(byId.get(id) || "");
    const correct = Boolean(expected) && got === expected;
    return {
      id,
      word: q.word,
      expected,
      got,
      correct,
      prompt: q.prompt,
      song_name: q.song_name || "",
    };
  });

  const correctCount = results.filter((r) => r.correct).length;
  const stats = knownStats();
  return {
    ok: true,
    correct_count: correctCount,
    total: results.length,
    results,
    feedback: checkInFeedback(stats, results.length, correctCount),
    stats,
  };
}

function checkInFeedback(stats, quizLen, correctCount) {
  const known = stats.known_count || 0;
  const today = stats.today_count || 0;
  const songs = stats.songs_touched || 0;
  const parts = [];
  if (known > 0) parts.push(`你已掌握 ${known} 个词`);
  if (today > 0) parts.push(`今天新点亮 ${today} 个`);
  if (songs > 0) parts.push(`涉及 ${songs} 首歌`);
  if (typeof correctCount === "number" && quizLen) {
    parts.push(`本轮测验 ${correctCount}/${quizLen}`);
  }
  if (!parts.length) {
    return "先学几张词卡，再来小测，会更有成就感。";
  }
  return parts.join(" · ") + "。继续保持，音乐里的词会越记越牢。";
}

function localBlank(p, i) {
  const word = String(p.word || "").toLowerCase();
  const line = String(p.line || "");
  const re = new RegExp(`\\b${escapeReg(word)}\\b`, "i");
  const prompt = re.test(line)
    ? `把挖空处填回你今天学过的词：\n${line.replace(re, "____")}`
    : `（${p.song_name || "歌词"}）填入今天学过的词 ____`;
  return {
    id: String(i + 1),
    word,
    answer: word,
    prompt,
    song_name: p.song_name || "",
    artist: p.artist || "",
  };
}

async function callDeepSeekQuiz(cfg, picked) {
  const system = `你是英语歌词填空出题助手。
题目必须严格基于用户「今天已学过」的单词及其歌词行，禁止编造词表外的词。
要求：
1. 返回严格 JSON：{ "questions": [ { "id", "word", "answer", "prompt", "song_name" } ] }
2. prompt 用中文引导 + 挖空后的英文歌词行（目标词用 ____ 替换）。
3. answer 必须是输入里的目标英文单词小写原形。
4. 不要编造未提供的歌词；每题对应一条输入；题数与输入条数一致。`;

  const user = JSON.stringify(
    {
      items: picked.map((p, i) => ({
        id: String(i + 1),
        word: p.word,
        line: p.line,
        song_name: p.song_name,
        artist: p.artist,
      })),
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
      temperature: 0.3,
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
  const raw = Array.isArray(parsed.questions) ? parsed.questions : [];
  const allowed = new Set(picked.map((p) => String(p.word).toLowerCase()));
  return picked.map((p, i) => {
    const q = raw[i] || {};
    const word = String(p.word || "").toLowerCase();
    let prompt = String(q.prompt || "").trim();
    if (!prompt || !prompt.includes("____")) {
      prompt = localBlank(p, i).prompt;
    }
    // Never accept a model answer outside the learned pool
    const modelAns = normalizeAnswer(q.answer || q.word);
    const answer = allowed.has(modelAns) && modelAns === word ? word : word;
    return {
      id: String(q.id || i + 1),
      word,
      answer,
      prompt,
      song_name: p.song_name || String(q.song_name || ""),
      artist: p.artist || "",
    };
  });
}

function normalizeAnswer(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, "");
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
