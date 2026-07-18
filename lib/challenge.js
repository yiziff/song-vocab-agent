/**
 * Artist vocab challenge: sample words, mixed verify (choice + blank),
 * two-line lyric context, score + share copy.
 * Challenge "know" answers do NOT touch known_words.
 */
import { lookupGloss, loadGlossary } from "./enrich.js";
import { llmConfig } from "./env.js";
import { filterIndexByLevel, levelLabel, normalizeLevel } from "./vocabLevel.js";

export const CHALLENGE_SAMPLE_SIZE = 25;
/** Spot-check size — sample from claimed-known, not every word. */
export const CHALLENGE_VERIFY_COUNT = 15;
/** Of the 15 verifies: this many are multiple-choice; rest are fill-in blanks. */
export const CHALLENGE_VERIFY_CHOICE = 8;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOccurrence(occs) {
  const list = Array.isArray(occs) ? occs : [];
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAnswer(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'\-\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Build unique timed lines for a song from the vocab index (cheap, no API).
 */
function songLinesFromIndex(fullIndex, songId) {
  const id = String(songId || "");
  const map = new Map();
  for (const occs of Object.values(fullIndex?.words || {})) {
    if (!Array.isArray(occs)) continue;
    for (const o of occs) {
      if (String(o.song_id || "") !== id) continue;
      const line = String(o.line || "").trim();
      if (!line) continue;
      const t = Number(o.t_ms) || 0;
      const key = `${t}|${line}`;
      if (!map.has(key)) {
        map.set(key, { t_ms: t, line, line_zh: o.line_zh || "" });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.t_ms - b.t_ms || a.line.localeCompare(b.line));
}

/** Pick current line + neighbor for two-line context. */
export function twoLineContext(fullIndex, songId, t_ms, line) {
  const lines = songLinesFromIndex(fullIndex, songId);
  const cur = String(line || "").trim();
  if (!lines.length) {
    return cur ? [cur] : [];
  }
  let idx = lines.findIndex(
    (row) => row.line === cur || Math.abs(row.t_ms - (Number(t_ms) || 0)) < 80
  );
  if (idx < 0) {
    // nearest by time
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const d = Math.abs(lines[i].t_ms - (Number(t_ms) || 0));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    idx = best;
  }
  if (idx > 0) return [lines[idx - 1].line, lines[idx].line];
  if (idx < lines.length - 1) return [lines[idx].line, lines[idx + 1].line];
  return [lines[idx].line];
}

/**
 * Sample unique words from filtered index for the know/unknown round.
 */
export function sampleChallengeWords(fullIndex, level, count = CHALLENGE_SAMPLE_SIZE) {
  const lv = normalizeLevel(level);
  const filtered = filterIndexByLevel(fullIndex, lv);
  const words = filtered.words || {};
  const keys = Object.keys(words);
  const total = keys.length;
  const n = Math.min(Math.max(Number(count) || CHALLENGE_SAMPLE_SIZE, 1), 40, total);
  if (n < 1) {
    return {
      items: [],
      total_words: 0,
      level: lv,
      level_label: levelLabel(lv),
      artist: fullIndex.artist || "",
    };
  }
  const picked = shuffle(keys).slice(0, n);
  const items = [];
  for (const word of picked) {
    const occ = pickOccurrence(words[word]);
    if (!occ) continue;
    const gloss = lookupGloss(word) || occ.gloss || "";
    const lines = twoLineContext(fullIndex, occ.song_id, occ.t_ms, occ.line);
    items.push({
      id: `w_${items.length}`,
      type: "know",
      word,
      song_id: String(occ.song_id || ""),
      song_name: occ.song_name || "",
      artist: occ.artist || fullIndex.artist || "",
      line: occ.line || "",
      lines,
      t_ms: Number(occ.t_ms) || 0,
      precision: occ.precision || "line",
      gloss,
    });
  }
  return {
    items,
    total_words: total,
    level: lv,
    level_label: levelLabel(lv),
    artist: fullIndex.artist || "",
  };
}

function blankMeaningPrompt(word) {
  const w = String(word || "").trim();
  return w
    ? `用中文写出「${w}」在歌词里的意思（可简写）`
    : "用中文写出这个词在歌词里的意思（可简写）";
}

function makeBlankQuestion(target, lines, glossary) {
  const gloss = String(target.gloss || glossary[target.word] || "").trim();
  return {
    id: `v_${0}`, // overwritten by caller
    type: "verify",
    mode: "blank",
    word: target.word,
    line: target.line || "",
    lines,
    song_name: target.song_name || "",
    song_id: target.song_id || "",
    prompt: blankMeaningPrompt(target.word),
    // Reference Chinese gloss for local/LLM grading (not the English word)
    _correct: gloss,
  };
}

/**
 * Build mixed verify set: choice + blank, up to `count` from know items.
 * Blank = see English word, write Chinese meaning (LLM-graded).
 */
export function buildVerifyQuestions(
  knowItems,
  count = CHALLENGE_VERIFY_COUNT,
  choiceCount = CHALLENGE_VERIFY_CHOICE
) {
  const glossary = loadGlossary();
  const pool = (knowItems || []).filter((it) => it && it.word);
  if (!pool.length) return [];

  const n = Math.min(Number(count) || CHALLENGE_VERIFY_COUNT, pool.length);
  const targets = shuffle(pool).slice(0, n);
  const nChoice = Math.min(
    Math.max(0, Number(choiceCount) || 0),
    targets.length
  );
  const glossPool = Object.keys(glossary);
  const questions = [];

  targets.forEach((target, idx) => {
    const mode = idx < nChoice ? "choice" : "blank";
    const lines = Array.isArray(target.lines) && target.lines.length
      ? target.lines
      : target.line
        ? [target.line]
        : [];

    if (mode === "blank") {
      const q = makeBlankQuestion(target, lines, glossary);
      q.id = `v_${questions.length}`;
      questions.push(q);
      return;
    }

    const correct = String(target.gloss || glossary[target.word] || "").trim();
    if (!correct) {
      // No gloss for choice → fall back to meaning blank (LLM can still judge from word+line)
      const q = makeBlankQuestion(target, lines, glossary);
      q.id = `v_${questions.length}`;
      questions.push(q);
      return;
    }

    const distractors = [];
    const used = new Set([correct]);
    for (const other of shuffle(pool)) {
      if (other.word === target.word) continue;
      const g = String(other.gloss || glossary[other.word] || "").trim();
      if (!g || used.has(g)) continue;
      distractors.push(g);
      used.add(g);
      if (distractors.length >= 3) break;
    }
    for (const key of shuffle(glossPool)) {
      if (distractors.length >= 3) break;
      if (key === target.word) continue;
      const g = String(glossary[key] || "").trim();
      if (!g || used.has(g)) continue;
      distractors.push(g);
      used.add(g);
    }
    if (!distractors.length) {
      const q = makeBlankQuestion(target, lines, glossary);
      q.id = `v_${questions.length}`;
      questions.push(q);
      return;
    }
    while (distractors.length < 3) {
      distractors.push(distractors[distractors.length - 1] + "…");
    }
    const options = shuffle([correct, ...distractors.slice(0, 3)]);
    questions.push({
      id: `v_${questions.length}`,
      type: "verify",
      mode: "choice",
      word: target.word,
      line: target.line || "",
      lines,
      song_name: target.song_name || "",
      song_id: target.song_id || "",
      options,
      _correct: correct,
    });
  });

  return shuffle(questions);
}

/**
 * Interleave spot-checks inside the 25: know → (optional verify for that word).
 * About 15 of the 25 words get a follow-up choice/blank right after 「认识」.
 */
export function buildChallengeSteps(knowItems, verifyQuestions) {
  const steps = [];
  const secret = {};
  const verifyByWord = new Map();
  for (const v of verifyQuestions || []) {
    if (v?.word && !verifyByWord.has(v.word)) verifyByWord.set(v.word, v);
  }

  for (const it of knowItems || []) {
    if (!it?.word) continue;
    const lines = Array.isArray(it.lines) && it.lines.length ? it.lines : it.line ? [it.line] : [];
    steps.push({
      id: it.id,
      type: "know",
      word: it.word,
      song_id: it.song_id,
      song_name: it.song_name,
      artist: it.artist,
      line: it.line,
      lines,
      t_ms: it.t_ms,
      precision: it.precision,
    });
    secret[it.id] = { type: "know", word: it.word, item: it };

    const v = verifyByWord.get(it.word);
    if (v) {
      pushVerifyStep(steps, secret, v, { after_id: it.id });
      verifyByWord.delete(it.word);
    }
  }
  // Orphans (shouldn't happen) — append
  for (const v of verifyByWord.values()) {
    pushVerifyStep(steps, secret, v, {});
  }
  return { steps, secret };
}

function pushVerifyStep(steps, secret, v, opts = {}) {
  const lines = Array.isArray(v.lines) && v.lines.length ? v.lines : v.line ? [v.line] : [];
  const isBlank = (v.mode || "choice") === "blank";
  const pub = {
    id: v.id,
    type: "verify",
    mode: v.mode || "choice",
    word: v.word,
    song_name: v.song_name,
    song_id: v.song_id,
    line: v.line || "",
    lines,
  };
  if (opts.after_id) pub.after_id = opts.after_id;
  if (isBlank) {
    // Show English word; user writes Chinese meaning
    pub.prompt = v.prompt || blankMeaningPrompt(v.word);
  } else {
    pub.options = v.options;
  }
  steps.push(pub);
  secret[v.id] = {
    type: "verify",
    mode: v.mode || "choice",
    word: v.word,
    correct: v._correct,
    line: v.line || "",
    after_id: opts.after_id || null,
  };
}

export function tierFromRate(rate) {
  const r = Number(rate) || 0;
  if (r >= 0.75) return { id: "lexicon", label: "词典本尊" };
  if (r >= 0.5) return { id: "lyric", label: "歌词党" };
  if (r >= 0.25) return { id: "listener", label: "真听歌" };
  return { id: "passerby", label: "路人粉" };
}

export function percentileFromRate(rate) {
  const r = Math.min(1, Math.max(0, Number(rate) || 0));
  return Math.round(8 + r * r * 88);
}

/** Local exact / near match for English answers (legacy helpers). */
export function localBlankCorrect(expected, got) {
  const a = normalizeAnswer(expected);
  const b = normalizeAnswer(got);
  if (!a || !b) return false;
  if (a === b) return true;
  // allow simple inflection: interest/interested, bound/bounds
  if (a.startsWith(b) || b.startsWith(a)) {
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length >= b.length ? b : a;
    if (longer.length - shorter.length <= 3) return true;
  }
  return false;
}

/** Local Chinese-meaning match against glossary gloss. */
export function localMeaningCorrect(referenceGloss, userAnswer) {
  const got = String(userAnswer || "").trim();
  if (!got) return false;
  const gloss = String(referenceGloss || "").trim();
  if (!gloss) return false;

  // Extract Chinese chunks from dictionary gloss (ignore POS / IPA noise)
  const chunks = gloss.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const compactGot = got.replace(/\s+/g, "");
  for (const c of chunks) {
    if (compactGot.includes(c) || c.includes(compactGot)) return true;
  }
  // Short single-char senses like「钱」
  const singles = gloss.match(/[\u4e00-\u9fff]/g) || [];
  if (compactGot.length <= 4 && singles.some((c) => compactGot.includes(c))) {
    // only accept if user answer is mostly Chinese and overlaps
    if (/^[\u4e00-\u9fffA-Za-z0-9·\-，,、；;\s]+$/.test(got) && compactGot.length >= 1) {
      const hit = singles.filter((c) => compactGot.includes(c)).length;
      if (hit >= Math.min(2, singles.length) || (singles.length === 1 && hit === 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * LLM judge: user wrote Chinese meaning for an English lyric word.
 * @param {string} word English word
 * @param {string} userAnswer Chinese meaning from user
 * @param {string} line lyric context
 * @param {string} [referenceGloss] dictionary gloss hint
 */
export async function gradeBlankWithLlm(word, userAnswer, line, referenceGloss = "") {
  const cfg = llmConfig();
  if (!cfg.configured) return null;
  const en = String(word || "").trim();
  const gloss = String(referenceGloss || "").trim();
  const got = String(userAnswer || "").trim();
  if (!got) return false;
  if (gloss && localMeaningCorrect(gloss, got)) return true;

  try {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'You grade Chinese meaning answers for English lyric words. Reply ONLY JSON: {"correct":true|false}. Mark correct if the student\'s Chinese captures the core sense of the English word in the lyric (paraphrase OK, short answers OK). Mark false if unrelated, empty, or clearly wrong. Dictionary gloss is a hint, not the only acceptable wording.',
          },
          {
            role: "user",
            content: JSON.stringify({
              english_word: en,
              reference_gloss_zh: gloss || null,
              user_answer_zh: got,
              lyric_line: line || "",
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return Boolean(parsed.correct);
  } catch {
    return null;
  }
}

/**
 * Live-check one verify answer. Updates session.answers / session.busted.
 */
export async function checkVerifyAnswer(session, stepId, payload) {
  const secret = session.secret || {};
  const meta = secret[stepId];
  if (!meta || meta.type !== "verify") {
    return { ok: false, error: "无效的校验题" };
  }
  session.answers = session.answers || {};
  session.busted = session.busted instanceof Set
    ? session.busted
    : new Set(session.busted || []);

  let correct = false;
  if (meta.mode === "blank") {
    const blank = String(payload?.blank ?? payload?.choice ?? "").trim();
    session.answers[stepId] = { id: stepId, blank, mode: "blank" };
    if (localMeaningCorrect(meta.correct, blank)) {
      correct = true;
    } else {
      const llm = await gradeBlankWithLlm(meta.word, blank, meta.line, meta.correct);
      correct = llm === null ? false : llm;
    }
  } else {
    const choice = String(payload?.choice ?? "").trim();
    session.answers[stepId] = { id: stepId, choice, mode: "choice" };
    correct = Boolean(choice && choice === meta.correct);
  }

  // Only punish if user previously claimed to know this word
  let claimedKnown = false;
  for (const [id, m] of Object.entries(secret)) {
    if (m.type === "know" && m.word === meta.word) {
      const a = session.answers[id];
      if (a && a.known === true) claimedKnown = true;
    }
  }

  let busted = false;
  if (!correct && claimedKnown) {
    session.busted.add(meta.word);
    busted = true;
  }

  const mode = meta.mode || "choice";
  // Reveal reference Chinese gloss (blank) or choice gloss when wrong
  const correctAnswer = !correct ? String(meta.correct || meta.word || "") : null;

  return {
    ok: true,
    correct,
    busted,
    word: meta.word,
    mode,
    correct_answer: correctAnswer,
    message: busted
      ? "不要欺骗自己哦——你标了「认识」，但这题没答对，已从得分里扣掉。"
      : correct
        ? "校验通过"
        : "答错了",
    busted_count: session.busted.size,
  };
}

/**
 * Grade full challenge. Uses session.answers (including live verify checks).
 */
export function gradeChallenge(session, answers) {
  const secret = session.secret || {};
  const itemsByWord = new Map();
  for (const it of session.items || []) {
    itemsByWord.set(it.word, it);
  }

  // Merge client answers with any server-side live answers
  const answerMap = new Map();
  for (const a of answers || []) {
    if (a && a.id) answerMap.set(a.id, a);
  }
  for (const [id, a] of Object.entries(session.answers || {})) {
    if (!answerMap.has(id)) answerMap.set(id, a);
  }

  const claimedKnown = new Set();
  const claimedUnknown = new Set();
  let verifyTotal = 0;
  let verifyCorrect = 0;
  const busted = new Set(
    session.busted instanceof Set ? session.busted : session.busted || []
  );

  for (const [id, meta] of Object.entries(secret)) {
    if (meta.type !== "know") continue;
    const ans = answerMap.get(id);
    if (ans && ans.known === true) claimedKnown.add(meta.word);
    else claimedUnknown.add(meta.word);
  }

  for (const [id, meta] of Object.entries(secret)) {
    if (meta.type !== "verify") continue;
    const ans = answerMap.get(id);
    // Skipped because user marked 「不认识」— don't count
    if (!ans && !claimedKnown.has(meta.word)) continue;

    verifyTotal++;
    let ok = false;
    if (!ans) {
      ok = false;
    } else if (meta.mode === "blank") {
      const blank = String(ans?.blank ?? ans?.choice ?? "").trim();
      if (typeof ans?.correct === "boolean") ok = ans.correct;
      else ok = localMeaningCorrect(meta.correct, blank);
    } else {
      const choice = String(ans?.choice || "").trim();
      if (typeof ans?.correct === "boolean") ok = ans.correct;
      else ok = Boolean(choice && choice === meta.correct);
    }
    if (ok) verifyCorrect++;
    else if (claimedKnown.has(meta.word)) busted.add(meta.word);
  }

  const effectiveWords = [...claimedKnown].filter((w) => !busted.has(w));
  const sampleSize = (session.items || []).length || CHALLENGE_SAMPLE_SIZE;
  let effectiveKnown = effectiveWords.length;
  // Extra penalty: if verify accuracy < 50%, shave another 10%.
  const verifyRate = verifyTotal > 0 ? verifyCorrect / verifyTotal : 1;
  if (verifyTotal >= 3 && verifyRate < 0.5) {
    effectiveKnown = Math.max(0, Math.floor(effectiveKnown * 0.9));
  }
  const rate = sampleSize > 0 ? effectiveKnown / sampleSize : 0;
  const totalWords = Number(session.total_words) || sampleSize;
  const estimatedKnown = Math.round(rate * totalWords);
  const tier = tierFromRate(rate);
  const percentile = percentileFromRate(rate);

  const unknownWords = [];
  const seen = new Set();
  for (const w of [...claimedUnknown, ...busted]) {
    if (seen.has(w)) continue;
    seen.add(w);
    const it = itemsByWord.get(w);
    if (it) unknownWords.push(it);
  }

  const artist = session.artist || "";
  const levelLabelText = session.level_label || levelLabel(session.level);
  const shareText = [
    `我刚测了自己对 ${artist} 歌词里${levelLabelText}词的熟悉度`,
    `有效认识约 ${estimatedKnown} / ${totalWords} 个 ·「${tier.label}」`,
    `约超过同档挑战者的 ${percentile}%`,
    verifyTotal
      ? `抽查校验 ${verifyCorrect}/${verifyTotal}${busted.size ? `（挤掉水分 ${busted.size}）` : ""}`
      : "",
    `你也来测测？ Song Vocab · 认词挑战`,
  ]
    .filter(Boolean)
    .join("\n");

  const highlight =
    unknownWords[0] || (session.items && session.items[0]) || null;

  return {
    ok: true,
    artist,
    level: session.level,
    level_label: levelLabelText,
    sample_size: sampleSize,
    total_words: totalWords,
    claimed_known: claimedKnown.size,
    effective_known: effectiveKnown,
    estimated_known: estimatedKnown,
    rate,
    tier,
    percentile,
    verify_total: verifyTotal,
    verify_correct: verifyCorrect,
    verify_rate: verifyTotal > 0 ? verifyRate : null,
    busted_count: busted.size,
    unknown_words: unknownWords,
    highlight: highlight
      ? {
          word: highlight.word,
          line: highlight.line,
          lines: highlight.lines || (highlight.line ? [highlight.line] : []),
          song_name: highlight.song_name,
          song_id: highlight.song_id,
        }
      : null,
    share_text: shareText,
    summary:
      `你认识约 ${estimatedKnown} / ${totalWords} 个${levelLabelText}词 · ${tier.label}` +
      (verifyTotal
        ? `（抽查 ${verifyCorrect}/${verifyTotal}${busted.size ? `，挤掉水分 ${busted.size}` : ""}）`
        : ""),
  };
}

/**
 * After the know round: sample up to 15 from claimed-known (not every word),
 * mixed choice + blank. Returns public verify steps only.
 */
export function beginVerifyPhase(session, answers) {
  if (!session) {
    return { ok: false, error: "挑战会话不存在" };
  }
  if (session.phase === "verify" && Array.isArray(session.verify_steps)) {
    return {
      ok: true,
      verify_count: session.verify_steps.length,
      steps: session.verify_steps,
      claimed_known: session.claimed_known_count || 0,
      skipped: session.verify_steps.length === 0,
    };
  }

  // Merge latest know answers into session
  session.answers = session.answers || {};
  for (const a of answers || []) {
    if (a?.id) {
      session.answers[a.id] = {
        ...session.answers[a.id],
        id: a.id,
        known: a.known,
        choice: a.choice,
        blank: a.blank,
      };
    }
  }

  const secret = session.secret || {};
  const claimedKnown = [];
  for (const [id, meta] of Object.entries(secret)) {
    if (meta.type !== "know") continue;
    const ans = session.answers[id];
    if (ans && ans.known === true) {
      const item = meta.item || (session.items || []).find((it) => it.word === meta.word);
      if (item) claimedKnown.push(item);
    }
  }
  session.claimed_known_count = claimedKnown.length;

  if (!claimedKnown.length) {
    session.phase = "verify";
    session.verify_steps = [];
    return {
      ok: true,
      verify_count: 0,
      steps: [],
      claimed_known: 0,
      skipped: true,
      message: "你没有标「认识」的词，跳过抽查直接结算。",
    };
  }

  // Cap at 15 — never spot-check every claimed word when pool is larger
  const n = Math.min(CHALLENGE_VERIFY_COUNT, claimedKnown.length);
  const choiceCount = Math.min(
    CHALLENGE_VERIFY_CHOICE,
    Math.max(1, Math.round(n * (CHALLENGE_VERIFY_CHOICE / CHALLENGE_VERIFY_COUNT)))
  );
  const verifies = buildVerifyQuestions(claimedKnown, n, choiceCount);
  const publicSteps = [];
  for (const v of verifies) {
    pushVerifyStep(publicSteps, secret, v);
  }
  session.secret = secret;
  session.phase = "verify";
  session.verify_steps = publicSteps;

  const nChoice = publicSteps.filter((s) => s.mode === "choice").length;
  const nBlank = publicSteps.filter((s) => s.mode === "blank").length;
  return {
    ok: true,
    verify_count: publicSteps.length,
    steps: publicSteps,
    claimed_known: claimedKnown.length,
    skipped: publicSteps.length === 0,
    message:
      publicSteps.length > 0
        ? `从「认识」的 ${claimedKnown.length} 个里随机抽查 ${publicSteps.length} 题（选择 ${nChoice} + 填空 ${nBlank}），不是每个都查。`
        : "抽查题生成失败，将按自评结算。",
  };
}

export function createChallenge(fullIndex, level) {
  const sampled = sampleChallengeWords(fullIndex, level, CHALLENGE_SAMPLE_SIZE);
  if (!sampled.items.length) {
    return {
      ok: false,
      error: "当前歌手/词表下没有可挑战的词，请先建库或切换等级。",
    };
  }
  // Spot-check ~15 of the 25, interleaved right after that word's know step
  const verifies = buildVerifyQuestions(
    sampled.items,
    CHALLENGE_VERIFY_COUNT,
    CHALLENGE_VERIFY_CHOICE
  );
  const { steps, secret } = buildChallengeSteps(sampled.items, verifies);
  const challengeId =
    "ch_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const knowCount = sampled.items.length;
  const verifyCount = verifies.length;

  return {
    ok: true,
    challenge_id: challengeId,
    public: {
      challenge_id: challengeId,
      artist: sampled.artist,
      level: sampled.level,
      level_label: sampled.level_label,
      total_words: sampled.total_words,
      sample_size: knowCount,
      verify_count: verifyCount,
      phase: "interleaved",
      steps,
    },
    session: {
      challenge_id: challengeId,
      artist: sampled.artist,
      level: sampled.level,
      level_label: sampled.level_label,
      total_words: sampled.total_words,
      items: sampled.items,
      secret,
      answers: {},
      busted: new Set(),
      phase: "interleaved",
      created_at: Date.now(),
    },
  };
}
