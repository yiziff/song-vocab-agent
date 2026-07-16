/**
 * Deterministic week plan builder (Ch.09 checklist).
 * No LLM — allocates unknown words across 7 days from song candidates.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { learnSong } from "./learnSong.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const PLANS_DIR = path.join(ROOT, "out", "plans");

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Pick words for a song from learnSong result, preferring theme words.
 */
function pickWordsForSong(fullIndex, songName, opts) {
  const {
    level,
    known,
    themeWords = [],
    wordsPerSong = 4,
  } = opts;
  const result = learnSong(fullIndex, songName, { level, known });
  if (!result.ok) return { ok: false, result, words: [] };

  const themeSet = new Set(
    (themeWords || []).map((w) => String(w).toLowerCase())
  );
  const all = result.words || [];
  const themeFirst = all.filter((w) => themeSet.has(w.word));
  const rest = all.filter((w) => !themeSet.has(w.word));
  const picked = [...themeFirst, ...rest].slice(0, wordsPerSong);

  return {
    ok: true,
    song: result.song,
    words: picked.map((w) => ({
      word: w.word,
      t_ms: w.t_ms,
      line: w.line || "",
      gloss: w.gloss || "",
    })),
    seek_hint: result.seek_hint,
    available: all.length,
  };
}

/**
 * Build a 7-day checklist plan.
 * @param {{
 *   fullIndex: object,
 *   candidates: Array,
 *   known?: Set<string>,
 *   weekly_target?: number,
 *   level?: string,
 *   themes?: string[],
 *   constraints?: object,
 *   words_per_song?: number,
 *   songs_per_day?: number
 * }} opts
 */
export function buildWeekPlan(opts) {
  const fullIndex = opts.fullIndex;
  const candidates = opts.candidates || [];
  const known = opts.known instanceof Set ? opts.known : new Set();
  const weeklyTarget = Math.max(1, Number(opts.weekly_target) || 30);
  const level = opts.level || "both";
  const themes = opts.themes || [];
  const wordsPerSong = Math.max(2, Number(opts.words_per_song) || 4);
  const songsPerDay = Math.max(1, Math.min(2, Number(opts.songs_per_day) || 1));
  const daysCount = 7;

  const usedWords = new Set();
  const usedSongs = new Set();
  const days = [];
  let allocated = 0;
  let candIdx = 0;

  for (let day = 1; day <= daysCount && allocated < weeklyTarget; day++) {
    const daySongs = [];
    for (let s = 0; s < songsPerDay && allocated < weeklyTarget; s++) {
      // find next unused candidate with enough unknown words
      let picked = null;
      let attempts = 0;
      while (candIdx < candidates.length && attempts < candidates.length) {
        const c = candidates[candIdx % candidates.length];
        candIdx++;
        attempts++;
        const sid = String(c.song_id);
        if (usedSongs.has(sid)) continue;

        const need = Math.min(
          wordsPerSong,
          weeklyTarget - allocated
        );
        const themeWords = c.theme_words || [];
        const pw = pickWordsForSong(fullIndex, c.song_name, {
          level,
          known: new Set([...known, ...usedWords]),
          themeWords,
          wordsPerSong: need,
        });
        if (!pw.ok || !pw.words.length) continue;

        usedSongs.add(sid);
        for (const w of pw.words) usedWords.add(w.word);
        allocated += pw.words.length;

        picked = {
          song_id: sid,
          song_name: c.song_name,
          artist: c.artist || fullIndex.artist || "",
          tags_zh: c.tags_zh || [],
          tags: c.tags || {},
          theme_words: (c.theme_words || []).slice(0, 6),
          words: pw.words,
          seek_hint: pw.seek_hint,
          reason:
            (c.tags_zh || []).length
              ? `标签: ${(c.tags_zh || []).join("、")}` +
                (c.theme_hit_total
                  ? `；主题命中 ${c.theme_hit_total}`
                  : "")
              : c.theme_hit_total
                ? `主题词命中 ${c.theme_hit_total}：${(c.theme_words || []).slice(0, 4).join(", ")}`
                : `词汇量适中（${c.unique_words} unique）`,
        };
        break;
      }
      if (picked) daySongs.push(picked);
    }

    days.push({
      day,
      status: "pending",
      songs: daySongs,
      word_count: daySongs.reduce((n, x) => n + x.words.length, 0),
    });
  }

  // Drop empty trailing days
  while (days.length && days[days.length - 1].word_count === 0) {
    days.pop();
  }

  const planId = `week_${todayKey()}_${Date.now().toString(36)}`;
  const plan = {
    plan_id: planId,
    objective: `本周掌握 ${weeklyTarget} 个词`,
    artist: fullIndex.artist || "",
    level,
    themes,
    constraints: opts.constraints || {},
    progress: {
      target: weeklyTarget,
      allocated,
      remaining_to_allocate: Math.max(0, weeklyTarget - allocated),
      known_at_plan_time: known.size,
    },
    days,
    tags_note: opts.tags_note || null,
    built_at: new Date().toISOString(),
  };

  return {
    ok: allocated > 0,
    plan,
    message:
      allocated > 0
        ? `已分配 ${allocated}/${weeklyTarget} 词到 ${days.length} 天`
        : "无法从候选歌中分配单词；请确认已建库且有未认识词",
  };
}

export function saveWeekPlan(plan) {
  fs.mkdirSync(PLANS_DIR, { recursive: true });
  const dateKey = todayKey();
  const dated = path.join(PLANS_DIR, `week_${dateKey}.json`);
  const current = path.join(PLANS_DIR, "week_current.json");
  const payload = { ...plan, saved_at: new Date().toISOString() };
  fs.writeFileSync(dated, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(current, JSON.stringify(payload, null, 2), "utf8");
  return { dated, current, plan_id: plan.plan_id };
}

export function loadCurrentWeekPlan() {
  const current = path.join(PLANS_DIR, "week_current.json");
  if (!fs.existsSync(current)) return null;
  try {
    return JSON.parse(fs.readFileSync(current, "utf8"));
  } catch {
    return null;
  }
}

export function acceptWeekPlan(planId) {
  const plan = loadCurrentWeekPlan();
  if (!plan) return { ok: false, error: "没有当前计划" };
  if (planId && plan.plan_id !== planId) {
    return { ok: false, error: "plan_id 不匹配" };
  }
  plan.accepted = true;
  plan.accepted_at = new Date().toISOString();
  for (const d of plan.days || []) {
    if (d.status === "pending") d.status = "accepted";
  }
  saveWeekPlan(plan);
  return { ok: true, plan };
}
