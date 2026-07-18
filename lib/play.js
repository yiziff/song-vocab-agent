import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { lookupGloss } from "./enrich.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export function buildDeck(items) {
  return (items || []).map((it) => {
    const gloss = it.gloss || lookupGloss(it.word);
    return {
      word: it.word,
      song_id: String(it.song_id),
      song_name: it.song_name,
      artist: it.artist,
      t_ms: Number(it.t_ms) || 0,
      line: it.line || "",
      line_zh: it.line_zh || "",
      precision: it.precision || "line",
      gloss,
      gloss_academic: it.gloss_academic || gloss,
      gloss_slang: it.gloss_slang || "",
      artist_note: it.artist_note || "",
      story: it.story || "",
      audioUrl: it.audioUrl || null,
      neteaseWeb: `https://music.163.com/#/song?id=${encodeURIComponent(it.song_id)}`,
    };
  });
}

export function openLearnViewer(items, startIndex = 0, opts = {}) {
  const playerDir = path.join(ROOT, "out", "player");
  fs.mkdirSync(playerDir, { recursive: true });

  const deck = buildDeck(items);
  const idx = Math.max(0, Math.min(startIndex, Math.max(deck.length - 1, 0)));
  const enrichApi = opts.enrichApi || "";
  const file = path.join(playerDir, "learn.html");
  fs.writeFileSync(
    file,
    renderLearnHtml(deck, idx, enrichApi, {
      level: opts.level || "both",
      levelLabel: opts.levelLabel || "四级+六级",
      levels: opts.levels || [
        { id: "cet4", label: "四级" },
        { id: "cet6", label: "六级" },
        { id: "both", label: "四级+六级" },
      ],
      wordCount: opts.wordCount || deck.length,
    }),
    "utf8"
  );

  if (opts.open !== false) openFile(file);

  const cur = deck[idx];
  return {
    ok: true,
    player: cur?.audioUrl ? "html-audio" : "html-preview",
    file,
    t_ms: cur?.t_ms ?? 0,
    index: idx,
    total: deck.length,
    note: "Opened learn viewer",
  };
}

export function playAtTimestamp(opts) {
  return openLearnViewer(
    [
      {
        word: opts.word,
        song_id: opts.song_id,
        song_name: opts.song_name,
        artist: opts.artist,
        t_ms: opts.t_ms,
        line: opts.line,
        line_zh: opts.line_zh,
        precision: opts.precision,
        audioUrl: opts.audioUrl,
      },
    ],
    0
  );
}

function openFile(file) {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", file], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    spawn("open", [file], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [file], { detached: true, stdio: "ignore" }).unref();
  }
}

export function renderLearnHtml(deck, startIndex, apiBase = "", meta = {}) {
  const dataJson = JSON.stringify(deck).replace(/</g, "\\u003c");
  const apiJson = JSON.stringify(apiBase || "");
  const level = meta.level || "both";
  const levels = meta.levels || [
    { id: "cet4", label: "四级" },
    { id: "cet6", label: "六级" },
    { id: "both", label: "四级+六级" },
  ];
  const levelJson = JSON.stringify(level);
  const levelsJson = JSON.stringify(levels).replace(/</g, "\\u003c");
  const artist = meta.artist || "";
  const artists = Array.isArray(meta.artists) ? meta.artists : [];
  const artistJson = JSON.stringify(artist);
  const artistsJson = JSON.stringify(artists).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Song Vocab Learn</title>
  <style>
    :root {
      color-scheme: light;
      --accent: #007aff;
      --accent-fill: rgba(0, 122, 255, 0.15);
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --glass: rgba(255, 255, 255, 0.52);
      --glass-strong: rgba(255, 255, 255, 0.72);
      --line: rgba(0, 0, 0, 0.08);
      --panel: rgba(255, 255, 255, 0.42);
      --radius-window: 14px;
      --radius-control: 8px;
      --shadow-window: 0 22px 70px rgba(0, 0, 0, 0.35);
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    /* macOS-like thin scrollbars (Chrome/Edge/Safari + Firefox) */
    * {
      scrollbar-width: thin;
      scrollbar-color: rgba(0, 0, 0, 0.28) transparent;
    }
    *::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    *::-webkit-scrollbar-track {
      background: transparent;
    }
    *::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.22);
      border-radius: 999px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 0, 0, 0.38);
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-button {
      display: none;
      width: 0;
      height: 0;
    }
    *::-webkit-scrollbar-corner {
      background: transparent;
    }
    body.desktop {
      font-family: var(--font);
      margin: 0;
      color: var(--ink);
      min-height: 100vh;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      overflow: auto;
    }
    #cover-bg {
      position: fixed; inset: 0; z-index: 0;
      background: linear-gradient(145deg, #1c2541 0%, #3a506b 45%, #5bc0be 100%);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transition: background-image .35s ease;
    }
    #cover-bg.has-cover::after {
      content: "";
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.42);
      pointer-events: none;
    }
    .macos-window {
      position: relative; z-index: 1;
      width: min(1080px, 96vw);
      max-height: calc(100vh - 2.5rem);
      display: flex; flex-direction: column;
      border-radius: var(--radius-window);
      background: var(--glass);
      border: 1px solid rgba(255, 255, 255, 0.45);
      box-shadow: var(--shadow-window), inset 0 1px 0 rgba(255, 255, 255, 0.55);
      backdrop-filter: blur(40px) saturate(1.8);
      -webkit-backdrop-filter: blur(40px) saturate(1.8);
      overflow: hidden;
      transition: width .25s ease, max-height .25s ease, border-radius .25s ease;
    }
    .macos-window.is-zoomed {
      width: 100%;
      max-height: 100vh;
      border-radius: 0;
      height: 100vh;
    }
    .macos-window.is-minimized {
      transform: scale(0.92);
      opacity: 0.55;
      pointer-events: none;
    }
    .titlebar {
      display: flex; align-items: center; justify-content: center;
      position: relative;
      height: 44px; flex-shrink: 0;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.28);
    }
    .traffic-lights {
      position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
      display: flex; gap: 8px; align-items: center;
    }
    .tl {
      width: 12px; height: 12px; border-radius: 50%; border: none; padding: 0;
      cursor: default; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,.12);
    }
    .tl.close { background: #ff5f57; }
    .tl.minimize { background: #febc2e; }
    .tl.zoom { background: #28c840; cursor: pointer; }
    .tl:active { filter: brightness(0.92); }
    .titlebar .title {
      font-size: .82rem; font-weight: 600; color: var(--muted);
      letter-spacing: -0.01em; user-select: none;
    }
    .app-header {
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.18);
      border-bottom: 1px solid var(--line);
    }
    .tabs {
      display: flex; gap: .35rem; padding: .55rem .9rem .65rem;
      overflow-x: auto;
    }
    .tab {
      font: inherit; font-size: .88rem; padding: .4rem .85rem; cursor: pointer;
      border: none; background: transparent; color: var(--muted);
      border-radius: 999px; white-space: nowrap;
    }
    .tab:hover { color: var(--ink); background: rgba(0, 0, 0, 0.04); }
    .tab.active {
      color: var(--accent); background: var(--accent-fill); font-weight: 600;
    }
    main {
      flex: 1; overflow: auto;
      padding: 1.15rem 1.35rem 1.5rem;
      max-width: none; margin: 0;
    }
    main:has(#view-rank.active) { max-width: none; }
    .view { display: none; }
    .view.active { display: block; }
    #view-learn.active { position: relative; min-height: 0; padding: 0; }
    #view-learn .learn-inner { position: relative; z-index: 1; max-width: 100%; margin: 0; }
    .panel {
      background: var(--panel);
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 12px;
      padding: 1.15rem 1.25rem;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }
    .panel.learn-hero {
      background: transparent;
      border: none;
      box-shadow: none;
      padding: 0;
      border-radius: 0;
    }
    .learn-split {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.95fr);
      gap: 1.25rem;
      align-items: start;
    }
    .learn-col-main { min-width: 0; }
    .learn-col-player {
      min-width: 0;
      position: sticky;
      top: 0;
    }
    .learn-col-player .player-card {
      margin-top: 0;
    }
    /* Viewport shows ~5 bilingual lyric rows; full list stays scrollable inside. */
    .learn-col-player .lyrics-panel {
      max-height: 18rem;
      overflow-y: auto;
    }
    @media (max-width: 860px) {
      .learn-split { grid-template-columns: 1fr; }
      .learn-col-player { position: static; }
      .learn-col-player .lyrics-panel { max-height: 18rem; }
    }
    .panel h2 { font-size: .95rem; margin: 0 0 .75rem; color: var(--accent); font-weight: 600; }
    .panel .sub { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; line-height: 1.45; }
    .row { display: flex; gap: .5rem; }
    input[type=text] {
      flex: 1; font: inherit; padding: .55rem .85rem;
      border: 1px solid transparent; border-radius: 999px;
      background: rgba(0, 0, 0, 0.06); color: var(--ink);
      outline: none;
    }
    input[type=text]:focus {
      background: rgba(255, 255, 255, 0.78);
      box-shadow: 0 0 0 3px var(--accent-fill);
    }
    button.action, .nav button, .level-btn {
      font: inherit; font-size: .9rem; padding: .5rem .95rem; cursor: pointer;
      border: 1px solid var(--line); background: var(--glass-strong); color: var(--ink);
      border-radius: var(--radius-control); white-space: nowrap;
    }
    button.action:hover, .nav button:hover:not(:disabled), .level-btn:hover {
      border-color: rgba(0, 122, 255, 0.35); color: var(--accent);
    }
    .nav { display: flex; gap: .75rem; margin-top: 1.5rem; }
    .nav button { flex: 1; }
    .nav button:disabled { opacity: .4; cursor: not-allowed; }
    .level-switch, .artist-switch { display: flex; flex-wrap: wrap; gap: .5rem; }
    .learn-top-chips { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; }
    .challenge-meta { color: var(--muted); font-size: .9rem; margin: 0 0 1.1rem; line-height: 1.45; }
    .challenge-progress {
      font-size: .88rem; color: var(--muted); margin: 0 0 .35rem;
      font-variant-numeric: tabular-nums;
    }
    .challenge-step-tag {
      display: inline-block; font-size: .75rem; padding: .18rem .55rem;
      border-radius: 999px; background: var(--accent-fill); color: var(--accent);
      margin: 0 0 .55rem;
    }
    #challenge-word { font-size: 2.2rem; margin: 0 0 .35rem; letter-spacing: -.03em; }
    .challenge-lines {
      margin: .35rem 0 0;
      font-size: 1.02rem;
      line-height: 1.55;
      color: var(--ink);
    }
    .challenge-lines p { margin: .2rem 0; }
    .challenge-lines .challenge-line-focus { font-weight: 600; }
    .challenge-prompt {
      margin: .55rem 0 0;
      font-size: 1.05rem;
      line-height: 1.5;
      font-style: italic;
      color: var(--ink);
    }
    .challenge-know-actions {
      display: flex; gap: .65rem; margin-top: 1.25rem;
    }
    .challenge-know-actions button {
      flex: 1; font: inherit; font-size: 1rem; font-weight: 600;
      padding: .85rem 1rem; cursor: pointer; border-radius: 10px;
    }
    #challenge-know-btn {
      border: none; background: var(--accent); color: #fff;
      box-shadow: 0 1px 2px rgba(0, 122, 255, 0.35);
    }
    #challenge-unknown-btn {
      border: 1px solid var(--line); background: var(--glass-strong); color: var(--ink);
    }
    .challenge-verify-actions {
      display: flex; flex-direction: column; gap: .5rem; margin-top: 1.1rem;
    }
    .challenge-verify-actions button {
      font: inherit; font-size: .95rem; text-align: left;
      padding: .75rem .9rem; cursor: pointer; border-radius: 10px;
      border: 1px solid var(--line); background: var(--glass-strong); color: var(--ink);
    }
    .challenge-verify-actions button:hover:not(:disabled) {
      border-color: rgba(0,122,255,.35); color: var(--accent); background: var(--accent-fill);
    }
    .challenge-verify-actions button:disabled { opacity: .55; cursor: wait; }
    .challenge-blank-wrap {
      display: flex; gap: .5rem; margin-top: 1.1rem; align-items: stretch;
    }
    .challenge-blank-wrap[hidden],
    .challenge-verify-actions[hidden],
    .challenge-know-actions[hidden] { display: none !important; }
    .challenge-blank-input {
      flex: 1; min-width: 0; font: inherit; font-size: 1rem;
      padding: .75rem .9rem; border-radius: 10px;
      border: 1px solid var(--line); background: var(--glass-strong); color: var(--ink);
    }
    .challenge-blank-input:focus {
      outline: none; border-color: rgba(0,122,255,.45);
    }
    #challenge-blank-submit {
      flex: 0 0 auto; font: inherit; font-weight: 600;
      padding: .75rem 1rem; border-radius: 10px; border: none;
      background: var(--accent); color: #fff; cursor: pointer;
    }
    #challenge-blank-submit:disabled { opacity: .55; cursor: wait; }
    .challenge-bust {
      position: fixed; inset: 0; z-index: 80;
      display: grid; place-items: center;
      background: rgba(0,0,0,.45); padding: 1rem;
    }
    .challenge-bust[hidden] { display: none !important; }
    .challenge-bust-card {
      width: min(22rem, 100%);
      background: var(--panel, #fff);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 1.25rem 1.2rem 1.1rem;
      text-align: center;
      box-shadow: 0 16px 48px rgba(0,0,0,.28);
    }
    .challenge-bust-title {
      margin: 0 0 .4rem; font-size: 1.2rem; font-weight: 700; color: var(--accent);
    }
    .challenge-bust-body {
      margin: 0 0 .65rem; font-size: .92rem; line-height: 1.45; color: var(--muted);
    }
    .challenge-bust-answer {
      margin: 0 0 1rem; padding: .65rem .75rem;
      border-radius: 10px; background: rgba(0,0,0,.06);
      font-size: .95rem; line-height: 1.4; color: var(--fg, #111);
    }
    .challenge-bust-answer strong { color: var(--accent); }
    .challenge-bust-answer[hidden] { display: none !important; }
    .challenge-tier {
      font-size: 1.35rem; font-weight: 700; color: var(--accent); margin: 0 0 .35rem;
    }
    .challenge-score {
      font-size: 1.7rem; font-weight: 700; letter-spacing: -.02em; margin: 0 0 .5rem;
    }
    .challenge-share-card {
      display: flex; gap: .85rem; align-items: stretch;
      margin: 1rem 0; padding: 1rem;
      border-radius: 12px; border: 1px solid var(--line);
      background: rgba(255,255,255,.55);
    }
    .challenge-share-cover {
      width: 72px; height: 72px; flex-shrink: 0; border-radius: 10px;
      background: rgba(0,0,0,.1) center/cover no-repeat;
    }
    .challenge-share-body { min-width: 0; flex: 1; }
    .challenge-share-title { font-weight: 650; margin-bottom: .35rem; }
    .challenge-share-line {
      font-size: .9rem; line-height: 1.45; color: var(--ink); margin-bottom: .4rem;
    }
    .challenge-share-foot { font-size: .8rem; color: var(--muted); }
    #challenge-share-text {
      width: 100%; box-sizing: border-box; font: inherit; font-size: .88rem;
      padding: .75rem .85rem; border-radius: 10px; border: 1px solid var(--line);
      background: rgba(255,255,255,.55); color: var(--ink); resize: vertical;
      margin: 0 0 .85rem;
    }
    .challenge-result-actions {
      display: flex; flex-wrap: wrap; gap: .5rem;
    }
    .level-btn.active {
      border-color: transparent; background: var(--accent); color: #fff; font-weight: 600;
    }
    .level-meta { color: var(--muted); font-size: .85rem; margin-top: .75rem; }
    .hit {
      display: block; width: 100%; text-align: left; margin: .4rem 0; padding: .65rem .75rem;
      border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,.45); cursor: pointer;
    }
    .hit:hover { border-color: rgba(0, 122, 255, 0.4); background: var(--accent-fill); }
    .hit .t { font-weight: 600; }
    .hit .l { color: var(--muted); font-size: .85rem; margin-top: .25rem; }
    #search-empty, #chat-status { color: var(--muted); font-size: .9rem; min-height: 1.2em; }
    #chat-log { max-height: 200px; overflow: auto; margin-bottom: .75rem; font-size: .9rem; line-height: 1.45; }
    .bubble { margin: .4rem 0; padding: .5rem .7rem; border-radius: 10px; }
    .bubble.user { background: var(--accent-fill); }
    .bubble.bot { background: rgba(255,255,255,.55); border: 1px solid var(--line); }
    .bubble .tag { font-size: .75rem; color: var(--muted); margin-bottom: .2rem; }
    .learn-top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
    .level-chip {
      font: inherit; font-size: .78rem; padding: .3rem .7rem; border-radius: 999px;
      border: 1px solid var(--line); background: var(--glass-strong); color: var(--muted); cursor: pointer;
    }
    .level-chip:hover { color: var(--accent); border-color: rgba(0, 122, 255, 0.35); }
    .counter { color: var(--muted); font-size: .88rem; font-variant-numeric: tabular-nums; }
    h1 { font-size: 2.35rem; margin: 0 0 .4rem; letter-spacing: -0.03em; font-weight: 700; }
    .gloss { margin: 0 0 1rem; line-height: 1.55; font-size: 1.05rem; }
    .dual-gloss { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin: 0 0 1rem; }
    @media (max-width: 640px) { .dual-gloss { grid-template-columns: 1fr; } }
    .dual-gloss .col {
      background: rgba(255,255,255,.42); border: 1px solid var(--line); border-radius: 10px;
      padding: .75rem .9rem;
    }
    .dual-gloss .col h3 {
      margin: 0 0 .4rem; font-size: .78rem; color: var(--accent); font-weight: 600;
    }
    .dual-gloss .col p { margin: 0; line-height: 1.5; font-size: .95rem; }
    .artist-note {
      margin: 0 0 1rem; padding: .75rem 1rem; border-left: 3px solid var(--accent);
      background: rgba(255,255,255,.35); border-radius: 0 10px 10px 0;
      font-size: .95rem; line-height: 1.5; font-style: italic;
    }
    .artist-note[hidden] { display: none !important; }
    .learn-song-bar {
      display: flex; flex-wrap: wrap; gap: .5rem; margin: 0 0 1rem; align-items: center;
    }
    .learn-song-bar input { flex: 1; min-width: 140px; }
    .song-focus { font-size: .85rem; color: var(--muted); margin: 0 0 .75rem; min-height: 1.2em; }
    .seek-banner {
      margin: 0 0 1rem; padding: .65rem .9rem; border-radius: 10px;
      background: var(--accent-fill); border: 1px solid rgba(0, 122, 255, 0.22);
      font-size: .95rem; line-height: 1.45;
    }
    .seek-banner strong { color: var(--accent); }
    .quiz-panel { margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--line); }
    .quiz-panel h2 { font-size: .95rem; margin: 0 0 .5rem; color: var(--accent); }
    .quiz-q { margin: .75rem 0; }
    .quiz-q label { display: block; font-size: .9rem; margin-bottom: .35rem; line-height: 1.45; }
    .quiz-q input { width: 100%; box-sizing: border-box; border-radius: var(--radius-control); }
    .quiz-feedback { margin-top: .75rem; font-size: .9rem; line-height: 1.5; color: var(--muted); }
    .meta { color: var(--muted); margin-bottom: 1rem; font-size: .95rem; }
    .line {
      font-size: 1.12rem; line-height: 1.55; margin: 0 0 .5rem; padding: 1rem 1.15rem;
      border-left: 3px solid var(--accent); background: rgba(255,255,255,.4);
      border-radius: 0 10px 10px 0;
    }
    .line-zh { font-size: 1.02rem; color: var(--muted); margin: 0 0 1.15rem; padding: 0 .25rem 0 1.25rem; }
    .line-play-row {
      display: flex; align-items: center; gap: .65rem;
      margin: 0 0 1.15rem; padding: 0 .15rem;
    }
    .line-play-row[hidden] { display: none !important; }
    #line-play-btn {
      font: inherit; font-size: .92rem; font-weight: 600;
      padding: .55rem 1.15rem; cursor: pointer;
      border: none; border-radius: 999px;
      background: var(--accent); color: #fff;
      box-shadow: 0 1px 2px rgba(0, 122, 255, 0.35);
    }
    #line-play-btn:hover { filter: brightness(1.05); }
    #line-play-btn:disabled { opacity: .45; cursor: not-allowed; filter: none; }
    .line-play-hint { color: var(--muted); font-size: .8rem; }
    .story-box {
      background: rgba(255,255,255,.4); padding: 1rem 1.15rem; margin: 1.15rem 0 0;
      border: 1px solid var(--line); border-radius: 10px;
    }
    .story-box h2 { font-size: .92rem; margin: 0 0 .5rem; color: var(--accent); font-weight: 600; }
    .story-box p { margin: 0; line-height: 1.6; white-space: pre-wrap; }
    .hl { color: var(--accent); font-weight: 700; }
    a { color: var(--accent); }
    .badge {
      display: inline-block; font-size: .72rem; padding: .18rem .55rem;
      border: 1px solid var(--line); border-radius: 999px; color: var(--muted);
      background: rgba(255,255,255,.4); margin-bottom: .35rem;
    }
    .hint { margin-top: 1rem; color: rgba(255,255,255,.82); font-size: .82rem; text-align: center;
      text-shadow: 0 1px 2px rgba(0,0,0,.35); }
    .status { color: var(--muted); font-size: .9rem; min-height: 1.2em; }
    .player-card {
      margin: 0; padding: 1rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.48);
      border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255,255,255,.55);
    }
    .player-card-top {
      display: flex; gap: .9rem; align-items: center; margin-bottom: .85rem;
    }
    #cover-thumb {
      width: 64px; height: 64px; flex-shrink: 0;
      border-radius: 10px;
      background: rgba(0,0,0,.12) center/cover no-repeat;
      box-shadow: 0 4px 14px rgba(0,0,0,.18);
    }
    #cover-thumb.empty { background-image: none; background-color: rgba(0,0,0,.1); }
    .player-meta-text { min-width: 0; flex: 1; }
    .player-meta-text .song-title {
      font-weight: 600; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .player-meta-text .song-sub {
      color: var(--muted); font-size: .82rem; margin-top: .15rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .player-box { margin: 1.15rem 0 0; }
    .player-box iframe {
      display: block; width: 100%; height: 86px; border: 0; border-radius: 10px;
      background: rgba(255,255,255,.7);
    }
    .player-hint { margin: .55rem 0 0; color: var(--muted); font-size: .82rem; line-height: 1.45; }
    #audio-wrap { margin: 0; }
    #audio-wrap audio { display: none; }
    .scrubber {
      display: flex; align-items: center; gap: .55rem; margin: 0 0 .65rem;
    }
    .scrubber .t {
      font-size: .72rem; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 2.4em;
    }
    #seek-range {
      flex: 1; -webkit-appearance: none; appearance: none;
      height: 18px; border-radius: 999px;
      background: transparent;
      outline: none; cursor: pointer;
    }
    #seek-range::-webkit-slider-runnable-track {
      height: 4px; border-radius: 999px;
      background: rgba(0, 0, 0, 0.12);
    }
    #seek-range::-moz-range-track {
      height: 4px; border-radius: 999px;
      background: rgba(0, 0, 0, 0.12);
      border: none;
    }
    #seek-range::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff; border: 0.5px solid rgba(0,0,0,.12);
      box-shadow: 0 1px 4px rgba(0,0,0,.25); cursor: pointer;
      margin-top: -5px; /* center thumb on 4px track */
    }
    #seek-range::-moz-range-thumb {
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff; border: 0.5px solid rgba(0,0,0,.12);
      box-shadow: 0 1px 4px rgba(0,0,0,.25); cursor: pointer;
    }
    .player-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: .15rem 0 0; }
    .player-actions button {
      font: inherit; font-size: .82rem; padding: .4rem .8rem; cursor: pointer;
      border: 1px solid var(--line); background: var(--glass-strong); border-radius: var(--radius-control);
    }
    .player-actions button:hover { border-color: rgba(0,122,255,.35); color: var(--accent); }
    #start-quiz-btn:disabled { opacity: .45; cursor: not-allowed; }
    .lyrics-panel {
      position: relative;
      margin: .85rem 0 0;
      max-height: 18rem; /* ~5 visible bilingual lyric rows */
      overflow-y: auto;
      border: 1px solid var(--line); border-radius: 10px;
      background: rgba(255,255,255,.4); padding: .5rem .65rem;
      font-size: .9rem; line-height: 1.45;
    }
    .lyrics-panel[hidden] { display: none !important; }
    .lyric-row {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: .35rem .4rem; margin: 0; cursor: pointer; border-radius: 6px;
      font: inherit; color: var(--ink);
    }
    .lyric-row:hover { background: var(--accent-fill); }
    .lyric-row.active {
      background: var(--accent-fill); color: var(--accent); font-weight: 600;
    }
    .lyric-row .zh { display: block; color: var(--muted); font-size: .8rem; font-weight: 400; }
    .lyric-row .t { color: var(--muted); font-size: .75rem; margin-right: .4rem; font-weight: 400; }
    .reveal-block[hidden] { display: none !important; }
    .quiz { display: flex; gap: .6rem; margin-top: 1.35rem; }
    .quiz button {
      flex: 1; font: inherit; font-size: 1rem; padding: .85rem 1rem; cursor: pointer;
      border-radius: 10px; font-weight: 600;
    }
    #know-btn {
      border: none; background: var(--accent); color: #fff;
      box-shadow: 0 1px 2px rgba(0, 122, 255, 0.35);
    }
    #know-btn:hover { filter: brightness(1.05); }
    #unknown-btn {
      border: 1px solid var(--line); background: var(--glass-strong); color: var(--ink);
    }
    #unknown-btn:hover { background: rgba(255,255,255,.9); }
    #skip-btn {
      flex: 0.72;
      border: 1px dashed var(--line); background: transparent; color: var(--muted);
      font-weight: 500;
    }
    #skip-btn:hover { color: var(--ink); border-color: rgba(0,0,0,.22); background: rgba(255,255,255,.45); }
    .fold-toggle {
      display: inline-flex; align-items: center; gap: .35rem;
      margin: .55rem 0 0; padding: .35rem .7rem;
      font: inherit; font-size: .82rem; cursor: pointer;
      border: 1px solid var(--line); border-radius: 999px;
      background: var(--glass-strong); color: var(--muted);
    }
    .fold-toggle:hover { color: var(--accent); border-color: rgba(0,122,255,.35); }
    .fold-toggle[hidden] { display: none !important; }
    #deep-body[hidden] { display: none !important; }
    .quiz[hidden] { display: none !important; }
    .nav[hidden] { display: none !important; }
    .quiz-done-note { color: var(--muted); font-size: .9rem; margin-top: .75rem; text-align: center; }
    details.chat-exp {
      margin-top: 1.25rem; border: 1px dashed var(--line); border-radius: 10px;
      padding: .75rem 1rem; background: rgba(255,255,255,.35);
    }
    details.chat-exp summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
    details.chat-exp[open] summary { margin-bottom: .75rem; }
    #view-rank .panel { background: transparent; border: 0; box-shadow: none; padding: 0; }
    #view-rank .panel h2 {
      color: var(--ink); font-size: 1.2rem; font-weight: 650; letter-spacing: -.02em;
    }
    .rank-summary {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: .75rem; margin: 0 0 1.5rem;
    }
    .rank-stat {
      background: rgba(255,255,255,.5); border: 1px solid var(--line); border-radius: 10px;
      padding: .95rem 1rem; transition: background .2s ease, transform .2s ease;
    }
    .rank-stat:hover { background: rgba(255,255,255,.72); transform: translateY(-1px); }
    .rank-stat .k {
      color: var(--muted); font-size: .72rem; margin-bottom: .35rem;
      text-transform: uppercase; letter-spacing: .06em;
    }
    .rank-stat .v {
      color: var(--accent); font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em;
    }
    .rank-artists, .rank-levels { display: flex; flex-wrap: wrap; gap: .5rem; margin: 0 0 1rem; }
    .rank-row {
      display: block; width: 100%; text-align: left; margin: .45rem 0; padding: .85rem 1rem;
      border: 1px solid var(--line); border-radius: 10px; cursor: default;
      background: rgba(255,255,255,.45);
      transition: background .2s ease, transform .2s ease, box-shadow .2s ease;
    }
    .rank-row:hover {
      background: rgba(255,255,255,.72);
      box-shadow: 0 8px 24px rgba(0,0,0,.08);
      transform: translateY(-1px);
    }
    .rank-row .title {
      display: grid; grid-template-columns: 64px minmax(0, 1fr) auto;
      align-items: center; gap: .85rem;
    }
    .rank-number {
      color: rgba(29, 29, 31, 0.28);
      font-size: 2rem; font-weight: 300; line-height: 1; letter-spacing: -.04em;
      font-variant-numeric: tabular-nums;
    }
    .rank-song { color: var(--ink); font-size: .98rem; font-weight: 650; line-height: 1.25; }
    .rank-metric {
      color: var(--accent); font-size: .9rem; font-weight: 650; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .rank-row .meta { color: var(--muted); font-size: .82rem; margin: .3rem 0 0 76px; }
    .rank-row .chips { margin: .5rem 0 0 76px; display: flex; flex-wrap: wrap; gap: .35rem; }
    .word-chip {
      font: inherit; font-size: .78rem; padding: .2rem .55rem; border-radius: 999px;
      border: 1px solid var(--line); background: rgba(255,255,255,.6); color: var(--ink); cursor: pointer;
    }
    .word-chip:hover { border-color: rgba(0,122,255,.4); color: var(--accent); background: var(--accent-fill); }
    .rank-empty { color: var(--muted); font-size: .9rem; margin-top: .75rem; }
    .coach-input {
      width: 100%; min-height: 72px; resize: vertical; box-sizing: border-box;
      font: inherit; padding: .65rem .85rem; border: 1px solid var(--line); border-radius: 10px;
      background: rgba(255,255,255,.55); color: inherit; line-height: 1.45;
    }
    .coach-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: .75rem 0; align-items: center; }
    .coach-log {
      max-height: 280px; overflow: auto; margin: .75rem 0; padding: .5rem;
      border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,.35);
    }
    .coach-log .bubble {
      margin: .4rem 0; padding: .55rem .7rem; border-radius: 10px; font-size: .9rem;
      line-height: 1.45; white-space: pre-wrap;
    }
    .coach-log .bubble.user { background: var(--accent-fill); margin-left: 1.5rem; }
    .coach-log .bubble.bot { background: rgba(255,255,255,.7); border: 1px solid var(--line); margin-right: 1.5rem; }
    .coach-log .bubble .tag { font-size: .75rem; color: var(--muted); margin-bottom: .25rem; }
    .coach-reply {
      margin: .75rem 0; padding: .75rem .9rem; border-radius: 10px;
      background: rgba(255,255,255,.5); border: 1px solid var(--line); white-space: pre-wrap;
      font-size: .92rem; line-height: 1.5;
    }
    .coach-day {
      margin: .75rem 0; padding: .75rem .9rem; border: 1px solid var(--line);
      border-radius: 10px; background: rgba(255,255,255,.4);
    }
    .coach-day h3 { margin: 0 0 .5rem; font-size: .95rem; color: var(--accent); }
    .coach-song-btn {
      display: block; width: 100%; text-align: left; margin: .35rem 0; padding: .55rem .7rem;
      border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,.65); cursor: pointer;
      font: inherit; color: inherit;
    }
    .coach-song-btn:hover { border-color: rgba(0,122,255,.4); background: var(--accent-fill); }
    .coach-song-btn .t { font-weight: 600; }
    .coach-song-btn .w { color: var(--muted); font-size: .85rem; margin-top: .25rem; }
    .coach-song-btn .r { color: var(--muted); font-size: .8rem; margin-top: .2rem; }
    .coach-meta { color: var(--muted); font-size: .85rem; margin: .5rem 0; }
    .coach-status { color: var(--muted); font-size: .9rem; min-height: 1.2em; }
    .artist-card {
      display: block; width: 100%; text-align: left; margin: .4rem 0; padding: .7rem .85rem;
      border: 1px solid var(--line); border-radius: 10px;
      background: rgba(255,255,255,.5); color: var(--ink); cursor: pointer;
    }
    .artist-card:hover { border-color: rgba(0,122,255,.35); background: var(--accent-fill); }
    .artist-card.active {
      border-color: transparent; background: var(--accent); color: #fff;
    }
    .artist-card .t { font-weight: 600; }
    .artist-card .l { color: var(--muted); font-size: .85rem; margin-top: .25rem; }
    .artist-card.active .l { color: rgba(255,255,255,.78); }
    @media (max-width: 620px) {
      body.desktop { padding: .5rem; }
      .macos-window { max-height: calc(100vh - 1rem); border-radius: 12px; }
      .rank-row .title { grid-template-columns: 52px minmax(0, 1fr); gap: .7rem; }
      .rank-number { font-size: 1.7rem; }
      .rank-metric { grid-column: 2; }
      .rank-row .meta, .rank-row .chips { margin-left: 59px; }
    }
  </style>
</head>
<body class="desktop">
  <div id="cover-bg" aria-hidden="true"></div>
  <div class="macos-window" id="macos-window">
    <div class="titlebar">
      <div class="traffic-lights">
        <button type="button" class="tl close" id="tl-close" title="关闭" aria-label="关闭"></button>
        <button type="button" class="tl minimize" id="tl-minimize" title="最小化" aria-label="最小化"></button>
        <button type="button" class="tl zoom" id="tl-zoom" title="缩放" aria-label="缩放"></button>
      </div>
      <div class="title">Song Vocab</div>
    </div>
  <header class="app-header">
    <nav class="tabs" role="tablist">
      <button type="button" class="tab active" data-tab="learn" role="tab" aria-selected="true">学习</button>
      <button type="button" class="tab" data-tab="challenge" role="tab" aria-selected="false">挑战</button>
      <button type="button" class="tab" data-tab="coach" role="tab" aria-selected="false">学词助手</button>
      <button type="button" class="tab" data-tab="search" role="tab" aria-selected="false">搜词</button>
      <button type="button" class="tab" data-tab="rank" role="tab" aria-selected="false">排行榜</button>
      <button type="button" class="tab" data-tab="settings" role="tab" aria-selected="false">设置</button>
    </nav>
  </header>

  <main>
    <section id="view-learn" class="view active" role="tabpanel">
      <div class="learn-inner">
      <div class="panel learn-hero">
        <div class="learn-top">
          <div class="learn-top-chips">
            <button type="button" class="level-chip" id="artist-chip" title="切换歌手">歌手</button>
            <button type="button" class="level-chip" id="level-chip" title="词表设置">词表</button>
          </div>
          <span class="counter" id="counter"></span>
        </div>
        <div class="learn-song-bar">
          <input type="text" id="learn-song-input" placeholder="学哪首歌？如 Runaway" autocomplete="off" />
          <button type="button" class="action" id="learn-song-btn">学这首</button>
          <button type="button" class="action" id="clear-song-btn" title="回到全部待学词">全部</button>
          <button type="button" class="action" id="start-quiz-btn">小测</button>
        </div>
        <p class="song-focus" id="song-focus"></p>
        <div class="learn-split">
          <div class="learn-col-main">
            <div class="seek-banner reveal-block" id="seek-banner" hidden></div>
            <span class="badge" id="badge"></span>
            <h1 id="word"></h1>
            <div class="dual-gloss reveal-block" id="dual-gloss" hidden>
              <div class="col">
                <h3>词典义（学术）</h3>
                <p id="gloss-academic"></p>
              </div>
              <div class="col">
                <h3>歌里义（街头）</h3>
                <p id="gloss-slang"></p>
              </div>
            </div>
            <p class="gloss reveal-block" id="gloss" hidden></p>
            <p class="meta" id="meta"></p>
            <div class="line" id="line"></div>
            <div class="line-play-row" id="line-play-row">
              <button type="button" id="line-play-btn">播放原句</button>
              <span class="line-play-hint" id="line-play-hint">从目标时间前 2 秒开始</span>
            </div>
            <div class="line-zh reveal-block" id="lineZh" hidden></div>
            <div class="reveal-block" id="deep-wrap" hidden>
              <button type="button" class="fold-toggle" id="deep-toggle">展开深度讲解</button>
              <div id="deep-body" hidden>
                <p class="artist-note" id="artist-note"></p>
                <div class="story-box" id="story-box">
                  <h2>在这首歌里</h2>
                  <p id="story" class="status"></p>
                </div>
              </div>
            </div>
            <div class="quiz" id="quiz">
              <button type="button" id="know-btn">认识</button>
              <button type="button" id="unknown-btn">不认识</button>
              <button type="button" id="skip-btn">跳过</button>
            </div>
            <div class="nav" id="nav" hidden>
              <button type="button" id="prev">← 上一个</button>
              <button type="button" id="next">下一个 →</button>
            </div>
            <p class="quiz-done-note" id="quiz-done" hidden></p>
            <div class="quiz-panel" id="quiz-panel" hidden>
              <h2>生成式小测</h2>
              <div id="quiz-questions"></div>
              <button type="button" class="action" id="quiz-submit-btn" hidden>提交</button>
              <p class="quiz-feedback" id="quiz-feedback"></p>
            </div>
          </div>
          <aside class="learn-col-player">
            <div id="audio-wrap" class="player-card" hidden>
              <div class="player-card-top">
                <div id="cover-thumb" class="empty" aria-hidden="true"></div>
                <div class="player-meta-text">
                  <div class="song-title" id="player-song-title"></div>
                  <div class="song-sub" id="player-song-sub"></div>
                </div>
              </div>
              <audio id="audio" preload="metadata"></audio>
              <div class="scrubber">
                <span class="t" id="time-cur">0:00</span>
                <input type="range" id="seek-range" min="0" max="1000" value="0" step="1" aria-label="播放进度" />
                <span class="t" id="time-dur">0:00</span>
              </div>
              <div class="player-actions">
                <button type="button" id="seek-target-btn">跳到目标时间</button>
                <button type="button" id="play-pause-btn">播放</button>
              </div>
              <p class="player-hint" id="audio-hint"></p>
              <div class="lyrics-panel" id="lyrics-panel" hidden></div>
            </div>
            <div id="fallback" class="player-box"></div>
          </aside>
        </div>
      </div>
      <p class="hint">先点「认识 / 不认识」看释义 · 「跳过」直接下一词 · 「学这首」按歌切词卡</p>
      </div>
    </section>

    <section id="view-challenge" class="view" role="tabpanel" hidden>
      <div class="panel" id="challenge-panel">
        <div id="challenge-intro">
          <h2>认词挑战</h2>
          <p class="sub" id="challenge-intro-sub">测测你是不是真懂这位歌手——25 个词认词过程中穿插抽查约 15 题（选择 + 填空）。点「认识」后可能立刻考你；答错当场公布答案并扣分，约 3～4 分钟。</p>
          <p class="challenge-meta" id="challenge-intro-meta"></p>
          <button type="button" class="action" id="challenge-start-btn">开始挑战</button>
          <p class="status" id="challenge-intro-status"></p>
        </div>
        <div id="challenge-play" hidden>
          <div class="challenge-progress" id="challenge-progress"></div>
          <p class="challenge-step-tag" id="challenge-step-tag"></p>
          <h1 id="challenge-word"></h1>
          <p class="meta" id="challenge-song"></p>
          <div class="challenge-lines" id="challenge-lines"></div>
          <p class="challenge-prompt" id="challenge-prompt" hidden></p>
          <div class="challenge-know-actions" id="challenge-know-actions">
            <button type="button" id="challenge-know-btn">认识</button>
            <button type="button" id="challenge-unknown-btn">不认识</button>
          </div>
          <div class="challenge-verify-actions" id="challenge-verify-actions" hidden></div>
          <div class="challenge-blank-wrap" id="challenge-blank-wrap" hidden>
            <input type="text" id="challenge-blank-input" class="challenge-blank-input" placeholder="用中文写出这个词的意思" autocomplete="off" spellcheck="false" />
            <button type="button" id="challenge-blank-submit">提交</button>
          </div>
        </div>
        <div id="challenge-bust" class="challenge-bust" hidden role="dialog" aria-modal="true">
          <div class="challenge-bust-card">
            <p class="challenge-bust-title" id="challenge-bust-title">答错了</p>
            <p class="challenge-bust-body" id="challenge-bust-body">这题没答对。</p>
            <p class="challenge-bust-answer" id="challenge-bust-answer" hidden></p>
            <button type="button" class="action" id="challenge-bust-ok">知道了</button>
          </div>
        </div>
        <div id="challenge-result" hidden>
          <h2>挑战结果</h2>
          <p class="challenge-tier" id="challenge-tier"></p>
          <p class="challenge-score" id="challenge-score"></p>
          <p class="sub" id="challenge-summary"></p>
          <div class="challenge-share-card" id="challenge-share-card">
            <div class="challenge-share-cover" id="challenge-share-cover"></div>
            <div class="challenge-share-body">
              <div class="challenge-share-title" id="challenge-share-title"></div>
              <div class="challenge-share-line" id="challenge-share-line"></div>
              <div class="challenge-share-foot" id="challenge-share-foot"></div>
            </div>
          </div>
          <textarea id="challenge-share-text" readonly rows="5" aria-label="分享文案"></textarea>
          <div class="challenge-result-actions">
            <button type="button" class="action" id="challenge-copy-btn">复制分享文案</button>
            <button type="button" class="action" id="challenge-learn-btn">学这些不认识的词</button>
            <button type="button" class="action" id="challenge-retry-btn">再测一次</button>
          </div>
          <p class="status" id="challenge-result-status"></p>
        </div>
      </div>
    </section>

    <section id="view-coach" class="view" role="tabpanel" hidden>
      <div class="panel">
        <h2>学词助手</h2>
        <p class="sub">统一入口：搜词、学某首歌、今晚一场、周计划、改口重排。多轮对话（刷新页面会清空历史）。当前歌手与词表等级已锁定。</p>
        <div class="coach-log" id="coach-log" aria-live="polite"></div>
        <textarea class="coach-input" id="coach-input" placeholder="例如：今晚 15 分钟舒缓一点 / 这周学 30 个六级偏 emotion / 我要学 Runaway / bound 在哪 / 改成 20 个词去掉太燥的"></textarea>
        <div class="coach-actions">
          <button type="button" class="action" id="coach-btn">发送</button>
          <button type="button" class="action" id="coach-clear-btn">清空对话</button>
          <button type="button" class="action" id="coach-reload-btn">刷新已存计划</button>
        </div>
        <p class="coach-status" id="coach-status"></p>
        <p class="coach-meta" id="coach-meta"></p>
        <div id="coach-session-plan"></div>
        <div id="coach-plan"></div>
      </div>
    </section>

    <section id="view-search" class="view" role="tabpanel" hidden>
      <div class="panel">
        <h2>搜词</h2>
        <p class="sub">查本地词库，定位单词在哪首歌、哪一句。点击结果会跳回学习页。</p>
        <div class="row">
          <input type="text" id="search-input" placeholder="输入英文生词，如 bound / admit" autocomplete="off" />
          <button type="button" class="action" id="search-btn">搜索</button>
        </div>
        <div id="search-empty" style="margin-top:.75rem"></div>
        <div id="search-hits"></div>
        <details class="chat-exp">
          <summary>AI 聊天（与「学词助手」同一后端；建议直接用学词助手 Tab）</summary>
          <div id="chat-log"></div>
          <div class="row">
            <input type="text" id="chat-input" placeholder="例如：帮我找找 bound / 我要学 Runaway / 今晚学 15 分钟" autocomplete="off" />
            <button type="button" class="action" id="chat-btn">发送</button>
          </div>
          <div id="chat-status" style="margin-top:.5rem"></div>
        </details>
      </div>
    </section>

    <section id="view-rank" class="view" role="tabpanel" hidden>
      <div class="panel">
        <h2>热门 50 · 四六级词汇排行榜</h2>
        <p class="sub">确定性统计（不经模型）：歌手热门歌 ∩ 四级/六级词。先 build / rank-all 生成数据。</p>
        <div class="rank-artists" id="rank-artists"></div>
        <div class="rank-levels" id="rank-levels"></div>
        <div class="rank-summary" id="rank-summary"></div>
        <div id="rank-artist-board"></div>
        <h2 style="margin-top:1.5rem">三位歌手总览</h2>
        <div id="rank-summary-board"></div>
        <p class="rank-empty" id="rank-empty"></p>
      </div>
    </section>

    <section id="view-settings" class="view" role="tabpanel" hidden>
      <div class="panel">
        <h2>歌手</h2>
        <p class="sub">在已建库的歌手间切换（Kanye / Taylor / J. Cole），无需重启服务。</p>
        <div class="artist-switch" id="artist-switch"></div>
        <div class="level-meta" id="artist-meta"></div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <h2>词表等级</h2>
        <p class="sub">切换四级 / 六级 / 全部。基于同一歌单词库过滤，无需重新建库。</p>
        <div class="level-switch" id="level-switch"></div>
        <div class="level-meta" id="level-meta"></div>
      </div>
    </section>
  </main>
  </div>
  <script>
    let DECK = ${dataJson};
    const API = ${apiJson};
    const LEVELS = ${levelsJson};
    let currentLevel = ${levelJson};
    let ARTISTS = ${artistsJson};
    let currentArtist = ${artistJson};
    let i = ${Number(startIndex) || 0};
    let enrichSeq = 0;
    let lastCoverSongId = '';
    let coverSeq = 0;
    let revealed = false;
    const sessionKnown = new Set();
    let songFocusLabel = '';
    let quizState = null;
    /** @type {Map<string, object>} */
    const playCache = new Map();
    let playSeq = 0;
    let lastPlaySongId = '';
    let lyricLines = [];
    let lyricsFocusMs = 0;
    const RANK_ARTISTS = ['Kanye West', 'Taylor Swift', 'J. Cole'];
    let rankArtist = 'Kanye West';
    let rankLevel = currentLevel || 'both';
    let rankLoaded = false;

    const el = {
      badge: document.getElementById('badge'),
      counter: document.getElementById('counter'),
      levelChip: document.getElementById('level-chip'),
      artistChip: document.getElementById('artist-chip'),
      artistSwitch: document.getElementById('artist-switch'),
      artistMeta: document.getElementById('artist-meta'),
      coverBg: document.getElementById('cover-bg'),
      coverThumb: document.getElementById('cover-thumb'),
      macosWindow: document.getElementById('macos-window'),
      tlClose: document.getElementById('tl-close'),
      tlMinimize: document.getElementById('tl-minimize'),
      tlZoom: document.getElementById('tl-zoom'),
      viewLearn: document.getElementById('view-learn'),
      word: document.getElementById('word'),
      gloss: document.getElementById('gloss'),
      dualGloss: document.getElementById('dual-gloss'),
      glossAcademic: document.getElementById('gloss-academic'),
      glossSlang: document.getElementById('gloss-slang'),
      artistNote: document.getElementById('artist-note'),
      seekBanner: document.getElementById('seek-banner'),
      songFocus: document.getElementById('song-focus'),
      learnSongInput: document.getElementById('learn-song-input'),
      learnSongBtn: document.getElementById('learn-song-btn'),
      clearSongBtn: document.getElementById('clear-song-btn'),
      startQuizBtn: document.getElementById('start-quiz-btn'),
      quizPanel: document.getElementById('quiz-panel'),
      quizQuestions: document.getElementById('quiz-questions'),
      quizSubmitBtn: document.getElementById('quiz-submit-btn'),
      quizFeedback: document.getElementById('quiz-feedback'),
      meta: document.getElementById('meta'),
      line: document.getElementById('line'),
      lineZh: document.getElementById('lineZh'),
      story: document.getElementById('story'),
      storyBox: document.getElementById('story-box'),
      audioWrap: document.getElementById('audio-wrap'),
      audio: document.getElementById('audio'),
      seekRange: document.getElementById('seek-range'),
      timeCur: document.getElementById('time-cur'),
      timeDur: document.getElementById('time-dur'),
      playerSongTitle: document.getElementById('player-song-title'),
      playerSongSub: document.getElementById('player-song-sub'),
      seekTargetBtn: document.getElementById('seek-target-btn'),
      playPauseBtn: document.getElementById('play-pause-btn'),
      linePlayRow: document.getElementById('line-play-row'),
      linePlayBtn: document.getElementById('line-play-btn'),
      audioHint: document.getElementById('audio-hint'),
      lyricsPanel: document.getElementById('lyrics-panel'),
      fallback: document.getElementById('fallback'),
      quiz: document.getElementById('quiz'),
      knowBtn: document.getElementById('know-btn'),
      unknownBtn: document.getElementById('unknown-btn'),
      skipBtn: document.getElementById('skip-btn'),
      deepWrap: document.getElementById('deep-wrap'),
      deepToggle: document.getElementById('deep-toggle'),
      deepBody: document.getElementById('deep-body'),
      nav: document.getElementById('nav'),
      quizDone: document.getElementById('quiz-done'),
      prev: document.getElementById('prev'),
      next: document.getElementById('next'),
      searchInput: document.getElementById('search-input'),
      searchBtn: document.getElementById('search-btn'),
      searchHits: document.getElementById('search-hits'),
      searchEmpty: document.getElementById('search-empty'),
      chatLog: document.getElementById('chat-log'),
      chatInput: document.getElementById('chat-input'),
      chatBtn: document.getElementById('chat-btn'),
      chatStatus: document.getElementById('chat-status'),
      coachInput: document.getElementById('coach-input'),
      coachBtn: document.getElementById('coach-btn'),
      coachClearBtn: document.getElementById('coach-clear-btn'),
      coachReloadBtn: document.getElementById('coach-reload-btn'),
      coachStatus: document.getElementById('coach-status'),
      coachLog: document.getElementById('coach-log'),
      coachMeta: document.getElementById('coach-meta'),
      coachPlan: document.getElementById('coach-plan'),
      coachSessionPlan: document.getElementById('coach-session-plan'),
      levelSwitch: document.getElementById('level-switch'),
      levelMeta: document.getElementById('level-meta'),
      rankArtists: document.getElementById('rank-artists'),
      rankLevels: document.getElementById('rank-levels'),
      rankSummary: document.getElementById('rank-summary'),
      rankArtistBoard: document.getElementById('rank-artist-board'),
      rankSummaryBoard: document.getElementById('rank-summary-board'),
      rankEmpty: document.getElementById('rank-empty'),
      challengeIntro: document.getElementById('challenge-intro'),
      challengeIntroSub: document.getElementById('challenge-intro-sub'),
      challengeIntroMeta: document.getElementById('challenge-intro-meta'),
      challengeIntroStatus: document.getElementById('challenge-intro-status'),
      challengeStartBtn: document.getElementById('challenge-start-btn'),
      challengePlay: document.getElementById('challenge-play'),
      challengeProgress: document.getElementById('challenge-progress'),
      challengeStepTag: document.getElementById('challenge-step-tag'),
      challengeWord: document.getElementById('challenge-word'),
      challengeSong: document.getElementById('challenge-song'),
      challengeLines: document.getElementById('challenge-lines'),
      challengePrompt: document.getElementById('challenge-prompt'),
      challengeKnowActions: document.getElementById('challenge-know-actions'),
      challengeVerifyActions: document.getElementById('challenge-verify-actions'),
      challengeBlankWrap: document.getElementById('challenge-blank-wrap'),
      challengeBlankInput: document.getElementById('challenge-blank-input'),
      challengeBlankSubmit: document.getElementById('challenge-blank-submit'),
      challengeKnowBtn: document.getElementById('challenge-know-btn'),
      challengeUnknownBtn: document.getElementById('challenge-unknown-btn'),
      challengeBust: document.getElementById('challenge-bust'),
      challengeBustTitle: document.getElementById('challenge-bust-title'),
      challengeBustBody: document.getElementById('challenge-bust-body'),
      challengeBustAnswer: document.getElementById('challenge-bust-answer'),
      challengeBustOk: document.getElementById('challenge-bust-ok'),
      challengeResult: document.getElementById('challenge-result'),
      challengeTier: document.getElementById('challenge-tier'),
      challengeScore: document.getElementById('challenge-score'),
      challengeSummary: document.getElementById('challenge-summary'),
      challengeShareCard: document.getElementById('challenge-share-card'),
      challengeShareCover: document.getElementById('challenge-share-cover'),
      challengeShareTitle: document.getElementById('challenge-share-title'),
      challengeShareLine: document.getElementById('challenge-share-line'),
      challengeShareFoot: document.getElementById('challenge-share-foot'),
      challengeShareText: document.getElementById('challenge-share-text'),
      challengeCopyBtn: document.getElementById('challenge-copy-btn'),
      challengeLearnBtn: document.getElementById('challenge-learn-btn'),
      challengeRetryBtn: document.getElementById('challenge-retry-btn'),
      challengeResultStatus: document.getElementById('challenge-result-status'),
      tabs: document.querySelectorAll('.tab'),
      views: {
        learn: document.getElementById('view-learn'),
        challenge: document.getElementById('view-challenge'),
        coach: document.getElementById('view-coach'),
        search: document.getElementById('view-search'),
        rank: document.getElementById('view-rank'),
        settings: document.getElementById('view-settings'),
      },
    };
    let scrubbing = false;
    // When user manually scrolls lyrics, pause auto-follow so playback doesn't fight them.
    let lyricsFollowPaused = false;
    let lyricsFollowResumeTimer = null;
    let lyricsProgrammaticScroll = false;
    let deepExpanded = false;

    function pauseLyricsFollow() {
      lyricsFollowPaused = true;
      if (lyricsFollowResumeTimer) clearTimeout(lyricsFollowResumeTimer);
      lyricsFollowResumeTimer = setTimeout(() => {
        lyricsFollowPaused = false;
        lyricsFollowResumeTimer = null;
      }, 4000);
    }

    function resumeLyricsFollowNow() {
      lyricsFollowPaused = false;
      if (lyricsFollowResumeTimer) {
        clearTimeout(lyricsFollowResumeTimer);
        lyricsFollowResumeTimer = null;
      }
    }

    function applyDualGloss(p) {
      const academic = p.gloss_academic || p.gloss || '（词典暂无释义）';
      const slang = p.gloss_slang || '';
      el.glossAcademic.textContent = academic;
      el.glossSlang.textContent = slang || '生成中…';
      el.gloss.textContent = academic;
      if (p.artist_note) {
        el.artistNote.textContent = '「' + p.artist_note + '」';
        el.artistNote.hidden = false;
      } else {
        el.artistNote.textContent = '';
        el.artistNote.hidden = true;
      }
    }

    function setDeepExpanded(on) {
      deepExpanded = Boolean(on);
      if (el.deepBody) el.deepBody.hidden = !deepExpanded;
      if (el.deepToggle) {
        el.deepToggle.textContent = deepExpanded ? '收起深度讲解' : '展开深度讲解';
      }
    }

    // Lead-in before the target lyric so the ear has a brief buffer.
    const SEEK_LEAD_MS = 2000;
    function targetSeekMs(tMs) {
      return Math.max(0, (Number(tMs) || 0) - SEEK_LEAD_MS);
    }

    function applySeekBanner(p) {
      if (!p) {
        el.seekBanner.hidden = true;
        el.seekBanner.textContent = '';
        return;
      }
      el.seekBanner.innerHTML =
        '目标 <strong>' + formatClock(p.t_ms) + '</strong>（提前 2 秒）';
      el.seekBanner.hidden = !revealed;
    }

    function seekToMs(tMs, autoplay) {
      const sec = Math.max(0, (Number(tMs) || 0) / 1000);
      const a = el.audio;
      const go = () => {
        const syncAfterSeek = () => {
          resumeLyricsFollowNow();
          highlightLyricAt(a.currentTime * 1000, { forceScroll: true });
          syncScrubber();
        };
        try { a.currentTime = sec; } catch (_) {}
        // Immediate feedback at intended time; re-sync after the browser finishes seeking.
        resumeLyricsFollowNow();
        highlightLyricAt(sec * 1000, { forceScroll: true });
        a.addEventListener('seeked', syncAfterSeek, { once: true });
        if (autoplay) {
          a.play().catch(() => {});
        }
      };
      if (a.readyState >= 1) go();
      else a.addEventListener('loadedmetadata', go, { once: true });
    }

    function paintLyricsPanel(focusMs) {
      if (focusMs != null) lyricsFocusMs = Number(focusMs) || 0;
      if (!lyricLines.length) {
        el.lyricsPanel.hidden = true;
        el.lyricsPanel.innerHTML = '';
        return;
      }
      // Always keep the full list; CSS viewport shows ~5 rows and stays scrollable
      // both before and after 认识/不认识.
      el.lyricsPanel.hidden = false;
      el.lyricsPanel.innerHTML = '';
      lyricLines.forEach((row, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lyric-row';
        btn.dataset.idx = String(idx);
        btn.dataset.t = String(row.t_ms || 0);
        btn.innerHTML =
          '<span class="t">' + formatClock(row.t_ms) + '</span>' +
          esc(row.text || '') +
          (row.text_zh ? '<span class="zh">' + esc(row.text_zh) + '</span>' : '');
        btn.addEventListener('click', () => seekToMs(row.t_ms, true));
        el.lyricsPanel.appendChild(btn);
      });
      highlightLyricAt(lyricsFocusMs, { forceScroll: true });
    }

    function renderLyricsPanel(lines, focusMs) {
      lyricLines = Array.isArray(lines) ? lines.slice() : [];
      lyricLines.sort((a, b) => (a.t_ms || 0) - (b.t_ms || 0));
      paintLyricsPanel(focusMs || 0);
    }

    function highlightLyricAt(tMs, opts) {
      if (!el.lyricsPanel || el.lyricsPanel.hidden) return;
      const forceScroll = opts && opts.forceScroll;
      const rows = el.lyricsPanel.querySelectorAll('.lyric-row');
      if (!rows.length) return;
      let best = -1;
      rows.forEach((node, i) => {
        if (Number(node.dataset.t || 0) <= tMs + 80) best = i;
      });
      let activeNode = null;
      rows.forEach((node, i) => {
        const on = i === best;
        node.classList.toggle('active', on);
        if (on) activeNode = node;
      });
      // Keep highlighting the current line, but don't steal the scroll while user is browsing.
      if (!activeNode || (lyricsFollowPaused && !forceScroll)) return;
      const panel = el.lyricsPanel;
      const panelRect = panel.getBoundingClientRect();
      const rowRect = activeNode.getBoundingClientRect();
      const delta = rowRect.top - panelRect.top - panel.clientHeight / 3;
      if (Math.abs(delta) > 24) {
        lyricsProgrammaticScroll = true;
        panel.scrollTop = Math.max(0, panel.scrollTop + delta);
        requestAnimationFrame(() => { lyricsProgrammaticScroll = false; });
      }
    }

    function showIframeFallback(p, clock) {
      el.audioWrap.hidden = true;
      el.audio.removeAttribute('src');
      const songId = encodeURIComponent(String(p.song_id || ''));
      const outchain =
        'https://music.163.com/outchain/player?type=2&id=' + songId + '&auto=0&height=66';
      el.fallback.innerHTML =
        '<iframe title="网易云外链播放器" frameborder="no" border="0" marginwidth="0" marginheight="0" ' +
        'width="100%" height="86" src="' + outchain + '"></iframe>' +
        '<p class="player-hint">直链不可用，已降级外链 · 目标约 <strong>' + clock + '</strong> · ' +
        '<a href="' + esc(p.neteaseWeb) + '" target="_blank" rel="noreferrer">在网易云打开</a></p>';
    }

    async function setupPlayer(p) {
      const clock = formatClock(p.t_ms);
      const songId = String(p.song_id || '');
      if (el.playerSongTitle) el.playerSongTitle.textContent = p.song_name || '';
      if (el.playerSongSub) el.playerSongSub.textContent = (p.artist || '') + (p.word ? ' · ' + p.word : '');
      if (!API || !songId) {
        showIframeFallback(p, clock);
        return;
      }
      const seq = ++playSeq;
      el.fallback.innerHTML = '';
      el.audioHint.textContent = '加载播放地址与歌词…';
      el.audioWrap.hidden = false;
      el.lyricsPanel.hidden = true;

      let data = playCache.get(songId);
      if (!data) {
        try {
          const res = await fetch(API + '/api/play?song_id=' + encodeURIComponent(songId));
          data = await res.json();
          if (data && (data.audio_url || data.lines)) playCache.set(songId, data);
        } catch (e) {
          if (seq !== playSeq) return;
          showIframeFallback(p, clock);
          el.audioHint.textContent = '加载失败：' + e.message;
          return;
        }
      }
      if (seq !== playSeq) return;

      if (!data.audio_url) {
        showIframeFallback(p, clock);
        if (data.lines && data.lines.length) {
          el.audioWrap.hidden = false;
          el.audioHint.textContent = data.error || '无直链，仅展示歌词';
          renderLyricsPanel(data.lines, p.t_ms);
        }
        return;
      }

      el.fallback.innerHTML = '';
      el.audioWrap.hidden = false;
      const sameSong = lastPlaySongId === songId && el.audio.src;
      if (!sameSong) {
        lastPlaySongId = songId;
        el.audio.src = data.audio_url;
        el.audio.load();
        if (el.seekRange) el.seekRange.value = '0';
        if (el.timeCur) el.timeCur.textContent = '0:00';
        if (el.timeDur) el.timeDur.textContent = '0:00';
      }
      el.audioHint.innerHTML =
        '本页直链播放 · 目标 <strong>' + clock + '</strong> · 可拖进度条，或点「跳到目标时间」/ 点歌词行 · ' +
        '<a href="' + esc(p.neteaseWeb) + '" target="_blank" rel="noreferrer">网易云</a>';
      renderLyricsPanel(data.lines || [], p.t_ms);
      // Auto-seek to target − 2s lead-in (no forced autoplay — browser policy)
      seekToMs(targetSeekMs(p.t_ms), false);
      el.playPauseBtn.textContent = el.audio.paused ? '播放' : '暂停';
      syncScrubber();
    }

    function switchTab(name) {
      const tab =
        name === 'search' || name === 'settings' || name === 'rank' || name === 'coach' || name === 'challenge'
          ? name
          : 'learn';
      el.tabs.forEach((btn) => {
        const on = btn.dataset.tab === tab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.entries(el.views).forEach(([key, node]) => {
        const on = key === tab;
        node.classList.toggle('active', on);
        node.hidden = !on;
      });
      history.replaceState(null, '', tab === 'learn' ? location.pathname + location.search : '#/' + tab);
      if (tab === 'rank') loadRankings(false);
      if (tab === 'coach') loadCoachPlan(false);
      if (tab === 'challenge') renderChallengeIntro();
    }

    // --- Artist vocab challenge ---
    let challengeId = '';
    let challengeSteps = [];
    let challengeIndex = 0;
    let challengeAnswers = [];
    let challengeResult = null;
    let challengeBusy = false;
    let challengeBustPending = null;
    let challengeKnowCount = 0;
    let challengeVerifyCount = 0;
    let challengeKnowDone = 0; // how many know items answered

    function showChallengePhase(phase) {
      if (el.challengeIntro) el.challengeIntro.hidden = phase !== 'intro';
      if (el.challengePlay) el.challengePlay.hidden = phase !== 'play';
      if (el.challengeResult) el.challengeResult.hidden = phase !== 'result';
      if (phase !== 'play' && el.challengeBust) el.challengeBust.hidden = true;
    }

    function renderChallengeIntro() {
      showChallengePhase('intro');
      const artist = currentArtist || '这位歌手';
      if (el.challengeIntroSub) {
        el.challengeIntroSub.textContent =
          '测测你是不是真懂 ' + artist + '——25 个词认词时穿插抽查约 15 题（选择 + 填空，不是每个都查）。点「认识」后可能马上出题；答错当场公布正确答案并扣分。挑战不写入「已认识」。';
      }
      if (el.challengeIntroMeta) {
        el.challengeIntroMeta.textContent =
          '当前歌手：' + artist + ' · 词表：' + levelName(currentLevel) + ' · 待学词库约 ' + DECK.length + ' 词';
      }
      if (el.challengeIntroStatus) el.challengeIntroStatus.textContent = '';
      if (el.challengeStartBtn) el.challengeStartBtn.disabled = !API;
    }

    function challengeLineHtml(step, opts) {
      const options = opts || {};
      const lines = Array.isArray(step.lines) && step.lines.length
        ? step.lines
        : (step.line ? [step.line] : []);
      if (!lines.length) return '';
      const focus = String(step.line || lines[lines.length - 1] || '');
      const highlightWord = options.highlightWord || '';
      return lines.map((ln) => {
        const isFocus = ln === focus;
        const body = highlightWord ? highlight(ln, highlightWord) : esc(ln);
        return '<p class="' + (isFocus ? 'challenge-line-focus' : '') + '">' + body + '</p>';
      }).join('');
    }

    function setChallengeVerifyBusy(busy) {
      challengeBusy = busy;
      if (el.challengeBlankSubmit) el.challengeBlankSubmit.disabled = busy;
      if (el.challengeBlankInput) el.challengeBlankInput.disabled = busy;
      if (el.challengeVerifyActions) {
        el.challengeVerifyActions.querySelectorAll('button').forEach((b) => {
          b.disabled = busy;
        });
      }
    }

    function knowOrdinalForIndex(idx) {
      let n = 0;
      for (let i = 0; i <= idx && i < challengeSteps.length; i++) {
        if (challengeSteps[i].type === 'know') n++;
      }
      return n;
    }

    function renderChallengeStep() {
      const step = challengeSteps[challengeIndex];
      if (!step) return;
      const knowOrd = knowOrdinalForIndex(challengeIndex);
      if (step.type === 'verify') {
        el.challengeProgress.textContent =
          '认词 ' + knowOrd + ' / ' + challengeKnowCount +
          ' · 当场抽查（约 ' + challengeVerifyCount + ' 题）';
      } else {
        el.challengeProgress.textContent =
          '认词 ' + knowOrd + ' / ' + challengeKnowCount;
      }
      challengeBusy = false;
      if (el.challengePrompt) {
        el.challengePrompt.hidden = true;
        el.challengePrompt.textContent = '';
      }
      if (el.challengeBlankWrap) el.challengeBlankWrap.hidden = true;
      if (el.challengeBlankInput) {
        el.challengeBlankInput.value = '';
        el.challengeBlankInput.disabled = false;
      }
      if (el.challengeBlankSubmit) el.challengeBlankSubmit.disabled = false;
      el.challengeVerifyActions.innerHTML = '';
      el.challengeVerifyActions.hidden = true;
      el.challengeKnowActions.hidden = true;

      if (step.type === 'verify') {
        const isBlank = step.mode === 'blank';
        el.challengeStepTag.textContent = isBlank
          ? '抽查 · 填空（写出中文意思）'
          : '抽查 · 选择题（选最接近的释义）';
        el.challengeWord.textContent = step.word || (isBlank ? '填空抽查' : '');
        el.challengeSong.textContent = step.song_name ? ('出自 · ' + step.song_name) : '';
        el.challengeLines.innerHTML = challengeLineHtml(step, {
          highlightWord: step.word || '',
        });
        if (isBlank) {
          if (el.challengePrompt) {
            el.challengePrompt.hidden = false;
            el.challengePrompt.textContent =
              step.prompt || '用中文写出这个词在歌词里的意思';
          }
          if (el.challengeBlankWrap) el.challengeBlankWrap.hidden = false;
          if (el.challengeBlankInput) {
            setTimeout(() => el.challengeBlankInput.focus(), 0);
          }
        } else {
          el.challengeVerifyActions.hidden = false;
          (step.options || []).forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = opt;
            btn.addEventListener('click', () => answerChallengeVerify({ choice: opt }));
            el.challengeVerifyActions.appendChild(btn);
          });
        }
      } else {
        el.challengeStepTag.textContent = '认识这个词吗？（看两行歌词）';
        el.challengeWord.textContent = step.word;
        el.challengeSong.textContent = (step.artist || '') + (step.song_name ? ' — ' + step.song_name : '');
        el.challengeLines.innerHTML = challengeLineHtml(step, { highlightWord: step.word });
        el.challengeKnowActions.hidden = false;
      }
    }

    async function startChallenge() {
      if (!API) {
        el.challengeIntroStatus.textContent = '请通过 serve 打开本页';
        return;
      }
      el.challengeStartBtn.disabled = true;
      el.challengeIntroStatus.textContent = '出题中…';
      try {
        const res = await fetch(API + '/api/challenge/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: currentLevel }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '出题失败');
        challengeId = data.challenge_id;
        challengeSteps = Array.isArray(data.steps) ? data.steps : [];
        challengeIndex = 0;
        challengeAnswers = [];
        challengeResult = null;
        challengeBustPending = null;
        challengeKnowCount = challengeSteps.filter((s) => s.type === 'know').length;
        challengeVerifyCount = challengeSteps.filter((s) => s.type === 'verify').length;
        challengeKnowDone = 0;
        if (!challengeSteps.length) throw new Error('没有可挑战的词');
        showChallengePhase('play');
        renderChallengeStep();
        el.challengeIntroStatus.textContent = '';
      } catch (e) {
        el.challengeIntroStatus.textContent = '出题失败：' + e.message;
      } finally {
        el.challengeStartBtn.disabled = false;
      }
    }

    function advanceChallenge() {
      challengeIndex++;
      if (challengeIndex >= challengeSteps.length) {
        finishChallenge();
        return;
      }
      renderChallengeStep();
    }

    /** After 「不认识」, skip the immediate follow-up verify for that same word. */
    function skipVerifyIfUnknown(knowId, known) {
      if (known) return;
      const next = challengeSteps[challengeIndex + 1];
      if (next && next.type === 'verify' && next.after_id === knowId) {
        challengeIndex++; // jump over the verify step
      }
    }

    function showChallengeFeedback(data) {
      return new Promise((resolve) => {
        challengeBustPending = resolve;
        const busted = Boolean(data && data.busted);
        const correctAnswer = data && data.correct_answer ? String(data.correct_answer) : '';
        const mode = data && data.mode ? data.mode : '';
        const word = data && data.word ? String(data.word) : '';

        if (el.challengeBustTitle) {
          el.challengeBustTitle.textContent = busted ? '不要欺骗自己哦' : '答错了';
        }
        if (el.challengeBustBody) {
          el.challengeBustBody.textContent = busted
            ? (data.message || '你标了「认识」，但这题没答对，已从得分里扣掉。')
            : (data.message || '这题没答对。');
        }
        if (el.challengeBustAnswer) {
          if (correctAnswer) {
            let line = '';
            if (mode === 'blank') {
              line =
                (word ? '<strong>' + esc(word) + '</strong> · ' : '') +
                '参考释义：<strong>' + esc(correctAnswer) + '</strong>';
            } else if (word) {
              line =
                '<strong>' + esc(word) + '</strong> 的正确释义：<strong>' +
                esc(correctAnswer) + '</strong>';
            } else {
              line = '正确答案：<strong>' + esc(correctAnswer) + '</strong>';
            }
            el.challengeBustAnswer.innerHTML = line;
            el.challengeBustAnswer.hidden = false;
          } else {
            el.challengeBustAnswer.innerHTML = '';
            el.challengeBustAnswer.hidden = true;
          }
        }
        if (el.challengeBust) el.challengeBust.hidden = false;
      });
    }

    function dismissChallengeBust() {
      if (el.challengeBust) el.challengeBust.hidden = true;
      const done = challengeBustPending;
      challengeBustPending = null;
      if (typeof done === 'function') done();
    }

    async function persistChallengeAnswer(answer) {
      if (!API || !challengeId || !answer) return;
      try {
        await fetch(API + '/api/challenge/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge_id: challengeId, answer }),
        });
      } catch (_) {}
    }

    async function answerChallengeKnow(known) {
      const step = challengeSteps[challengeIndex];
      if (!step || step.type !== 'know' || challengeBusy) return;
      const answer = { id: step.id, known: Boolean(known) };
      challengeAnswers.push(answer);
      challengeKnowDone++;
      persistChallengeAnswer(answer);
      skipVerifyIfUnknown(step.id, Boolean(known));
      advanceChallenge();
    }

    async function answerChallengeVerify(payload) {
      const step = challengeSteps[challengeIndex];
      if (!step || step.type !== 'verify' || challengeBusy) return;
      const choice = payload && payload.choice != null ? String(payload.choice) : '';
      const blank = payload && payload.blank != null ? String(payload.blank).trim() : '';
      if (step.mode === 'blank' && !blank) return;

      setChallengeVerifyBusy(true);
      try {
        const res = await fetch(API + '/api/challenge/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge_id: challengeId,
            id: step.id,
            choice,
            blank,
            answers_so_far: challengeAnswers,
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '校验失败');
        const answer = {
          id: step.id,
          choice: step.mode === 'blank' ? blank : choice,
          blank: step.mode === 'blank' ? blank : undefined,
          correct: Boolean(data.correct),
        };
        challengeAnswers.push(answer);
        if (!data.correct) {
          await showChallengeFeedback(data);
        }
        advanceChallenge();
      } catch (e) {
        challengeAnswers.push({
          id: step.id,
          choice: step.mode === 'blank' ? blank : choice,
          blank: step.mode === 'blank' ? blank : undefined,
        });
        advanceChallenge();
      } finally {
        setChallengeVerifyBusy(false);
      }
    }

    function submitChallengeBlank() {
      if (!el.challengeBlankInput) return;
      answerChallengeVerify({ blank: el.challengeBlankInput.value });
    }

    async function finishChallenge() {
      showChallengePhase('result');
      el.challengeTier.textContent = '结算中…';
      el.challengeScore.textContent = '';
      el.challengeSummary.textContent = '';
      el.challengeResultStatus.textContent = '';
      try {
        const res = await fetch(API + '/api/challenge/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge_id: challengeId, answers: challengeAnswers }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '结算失败');
        challengeResult = data;
        el.challengeTier.textContent = (data.tier && data.tier.label) || '挑战完成';
        el.challengeScore.textContent =
          '约 ' + data.estimated_known + ' / ' + data.total_words + ' 个' + (data.level_label || '') + '词';
        let summary = (data.summary || '') + ' · 约超过同档挑战者的 ' + data.percentile + '%';
        if (data.busted_count) {
          summary += ' · 抽查挤掉水分 ' + data.busted_count + ' 个';
        }
        el.challengeSummary.textContent = summary;
        el.challengeShareText.value = data.share_text || '';
        el.challengeShareTitle.textContent =
          (data.artist || currentArtist || '') + ' · ' + ((data.tier && data.tier.label) || '');
        if (data.highlight) {
          el.challengeShareLine.innerHTML =
            '<strong>' + esc(data.highlight.word) + '</strong> · ' + esc(data.highlight.line || '');
          el.challengeShareFoot.textContent = data.highlight.song_name || '';
          if (data.highlight.song_id) {
            fetch(API + '/api/cover?song_id=' + encodeURIComponent(data.highlight.song_id))
              .then((r) => r.json())
              .then((c) => {
                if (c && c.cover_url) {
                  const safe = String(c.cover_url).replace(/"/g, '');
                  el.challengeShareCover.style.backgroundImage = 'url("' + safe + '")';
                }
              })
              .catch(() => {});
          }
        } else {
          el.challengeShareLine.textContent = '';
          el.challengeShareFoot.textContent = '';
        }
        el.challengeLearnBtn.disabled = !(data.unknown_words && data.unknown_words.length);
        el.challengeLearnBtn.textContent = data.unknown_words && data.unknown_words.length
          ? ('学这些不认识的词（' + data.unknown_words.length + '）')
          : '没有不认识的词';
      } catch (e) {
        el.challengeTier.textContent = '结算失败';
        el.challengeResultStatus.textContent = e.message;
      }
    }

    async function learnChallengeUnknowns() {
      if (!challengeResult || !challengeResult.unknown_words || !challengeResult.unknown_words.length) {
        el.challengeResultStatus.textContent = '没有可导入的词';
        return;
      }
      el.challengeLearnBtn.disabled = true;
      el.challengeResultStatus.textContent = '导入学习页…';
      try {
        const res = await fetch(API + '/api/challenge/learn-unknowns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: challengeResult.unknown_words }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '导入失败');
        DECK = Array.isArray(data.deck) ? data.deck : [];
        i = 0;
        songFocusLabel = '挑战复习 · ' + DECK.length + ' 词';
        if (el.songFocus) el.songFocus.textContent = songFocusLabel;
        sessionKnown.clear();
        revealed = false;
        switchTab('learn');
        render();
        el.challengeResultStatus.textContent = '';
      } catch (e) {
        el.challengeResultStatus.textContent = '导入失败：' + e.message;
        el.challengeLearnBtn.disabled = false;
      }
    }

    /** Shared multi-turn history for assistant (browser memory only). */
    let assistantHistory = [];
    const ASSISTANT_HISTORY_MAX = 12;

    function trimAssistantHistory() {
      if (assistantHistory.length > ASSISTANT_HISTORY_MAX) {
        assistantHistory = assistantHistory.slice(-ASSISTANT_HISTORY_MAX);
      }
    }

    function appendCoachBubble(role, text, tag) {
      if (!el.coachLog) return;
      const div = document.createElement('div');
      div.className = 'bubble ' + (role === 'user' ? 'user' : 'bot');
      div.innerHTML =
        (tag ? '<div class="tag">' + esc(tag) + '</div>' : '') +
        '<div>' + esc(text) + '</div>';
      el.coachLog.appendChild(div);
      el.coachLog.scrollTop = el.coachLog.scrollHeight;
    }

    function songButtonsFor(container, songs) {
      (songs || []).forEach((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'coach-song-btn';
        const words = (s.words || []).map((w) => (typeof w === 'string' ? w : w.word)).join(', ');
        btn.innerHTML =
          '<div class="t">' + esc(s.song_name) + '</div>' +
          '<div class="w">' + esc(words) + '</div>' +
          (s.reason ? '<div class="r">' + esc(s.reason) + '</div>' : '') +
          ((s.tags_zh && s.tags_zh.length) ? '<div class="r">' + esc(s.tags_zh.join(' · ')) + '</div>' : '');
        btn.addEventListener('click', () => {
          el.learnSongInput.value = s.song_name || '';
          switchTab('learn');
          doLearnSong();
        });
        container.appendChild(btn);
      });
    }

    function renderSessionPlan(plan) {
      if (!el.coachSessionPlan) return;
      el.coachSessionPlan.innerHTML = '';
      if (!plan || !(plan.songs || []).length) return;
      const box = document.createElement('div');
      box.className = 'coach-day';
      const h = document.createElement('h3');
      h.textContent =
        '今晚一场 · 约 ' + (plan.minutes_hint || 15) + ' 分钟 · ' +
        (plan.word_count || plan.progress?.allocated || 0) + ' 词';
      box.appendChild(h);
      if (plan.objective) {
        const p = document.createElement('p');
        p.className = 'coach-meta';
        p.textContent = plan.objective + (plan.tags_note ? ' · ' + plan.tags_note : '');
        box.appendChild(p);
      }
      songButtonsFor(box, plan.songs);
      el.coachSessionPlan.appendChild(box);
    }

    function renderCoachPlan(plan, replyText) {
      if (replyText) {
        appendCoachBubble('bot', replyText, '助手');
      }
      if (!plan) {
        el.coachPlan.innerHTML = '';
        if (!el.coachSessionPlan?.childElementCount) {
          el.coachMeta.textContent = '';
        }
        return;
      }
      // Session-shaped plan (no days)
      if (plan.kind === 'session' || (plan.songs && !plan.days)) {
        renderSessionPlan(plan);
        el.coachMeta.textContent =
          (plan.objective || '今晚一场') +
          (plan.tags_note ? ' · ' + plan.tags_note : '');
        return;
      }
      const prog = plan.progress || {};
      el.coachMeta.textContent =
        (plan.objective || '') +
        ' · 已分配 ' + (prog.allocated ?? '?') + '/' + (prog.target ?? '?') +
        (plan.revise_note ? ' · ' + plan.revise_note : '') +
        (plan.tags_note ? ' · ' + plan.tags_note : '') +
        (plan.accepted ? ' · 已确认' : '');
      el.coachPlan.innerHTML = '';
      (plan.days || []).forEach((day) => {
        const box = document.createElement('div');
        box.className = 'coach-day';
        const h = document.createElement('h3');
        h.textContent = '第 ' + day.day + ' 天 · ' + (day.word_count || 0) + ' 词 · ' + (day.status || 'pending');
        box.appendChild(h);
        songButtonsFor(box, day.songs);
        el.coachPlan.appendChild(box);
      });
    }

    async function loadCoachPlan(force) {
      if (!API) {
        el.coachStatus.textContent = '请通过 serve 打开';
        return;
      }
      if (!force && el.coachPlan.childElementCount > 0) return;
      el.coachStatus.textContent = '加载已存计划…';
      try {
        const res = await fetch(API + '/api/coach/plan');
        const data = await res.json();
        if (data.session_plan) renderSessionPlan(data.session_plan);
        if (data.plan) {
          renderCoachPlan(data.plan, null);
          el.coachStatus.textContent = '已加载当前计划';
        } else if (data.session_plan) {
          el.coachStatus.textContent = '已加载今晚一场';
        } else {
          el.coachStatus.textContent = '尚无计划，发一条消息试试';
        }
      } catch (e) {
        el.coachStatus.textContent = '加载失败：' + e.message;
      }
    }

    async function postAssistant(message, statusEl, btnEl) {
      if (!message) {
        if (statusEl) statusEl.textContent = '请先输入内容';
        return null;
      }
      if (!API) {
        if (statusEl) statusEl.textContent = '请通过 serve 打开';
        return null;
      }
      if (btnEl) btnEl.disabled = true;
      if (statusEl) statusEl.textContent = '助手思考中（可能多轮 tools）…';
      try {
        const res = await fetch(API + '/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            history: assistantHistory,
          }),
        });
        const data = await res.json();
        assistantHistory.push({ role: 'user', content: message });
        if (data.reply) {
          assistantHistory.push({ role: 'assistant', content: data.reply });
        }
        trimAssistantHistory();
        return data;
      } catch (e) {
        if (statusEl) statusEl.textContent = '失败：' + e.message;
        return { ok: false, error: e.message };
      } finally {
        if (btnEl) btnEl.disabled = false;
      }
    }

    function applyAssistantResult(data, opts) {
      const intoCoach = opts && opts.intoCoach;
      if (!data) return;
      if (data.tool_calls && data.tool_calls.length && intoCoach) {
        const names = data.tool_calls.map((t) => t.name).join(', ');
        appendCoachBubble('bot', names, 'tools');
      }
      if (data.error && !data.reply && intoCoach) {
        appendCoachBubble('bot', data.error, '错误');
        el.coachStatus.textContent = data.error;
        return;
      }
      if (data.reply && intoCoach) {
        appendCoachBubble('bot', data.reply, '助手');
      }
      if (data.session_plan) renderSessionPlan(data.session_plan);
      const week = data.week_plan || data.plan;
      if (week && (week.days || week.kind === 'week')) {
        renderCoachPlan(week, null);
      }
      if (data.learn && data.learn.ok) {
        applyLearnResult(data.learn);
        if (intoCoach) el.coachStatus.textContent = '已打开学歌词卡（见学习 Tab）';
      } else if (data.search && data.search.found) {
        renderHits(data.search);
        el.searchInput.value = data.search.word || '';
        if (intoCoach) {
          el.coachStatus.textContent = '已找到词条（可到搜词 Tab 查看）';
        } else {
          switchTab('search');
        }
      } else if (intoCoach) {
        el.coachStatus.textContent = data.ok
          ? (data.tags_available === false
            ? '完成（尚无 song_tags，舒缓/旋律可能已降级）'
            : '完成')
          : (data.error || '未完成');
      }
    }

    async function doCoachPlan() {
      const message = el.coachInput.value.trim();
      if (!message) {
        el.coachStatus.textContent = '请先输入';
        return;
      }
      appendCoachBubble('user', message);
      el.coachInput.value = '';
      const data = await postAssistant(message, el.coachStatus, el.coachBtn);
      applyAssistantResult(data, { intoCoach: true });
    }

    function clearCoachChat() {
      assistantHistory = [];
      if (el.coachLog) el.coachLog.innerHTML = '';
      el.coachStatus.textContent = '对话已清空（已存计划仍在下方，可点刷新）';
    }

    function updateLevelChip() {
      el.levelChip.textContent = levelName(currentLevel) + ' · ' + DECK.length + ' 词';
      updateArtistChip();
    }

    function updateArtistChip() {
      if (!el.artistChip) return;
      el.artistChip.textContent = currentArtist ? currentArtist : '歌手';
    }

    function renderArtistSwitch() {
      if (!el.artistSwitch) return;
      el.artistSwitch.innerHTML = '';
      const list = Array.isArray(ARTISTS) ? ARTISTS : [];
      if (!list.length) {
        if (el.artistMeta) {
          el.artistMeta.textContent = API
            ? '暂无可用歌手索引（请先 build）'
            : '静态页无法切换歌手，请用 serve';
        }
        updateArtistChip();
        return;
      }
      list.forEach((a) => {
        const name = a.artist || a.id || '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (name === currentArtist ? ' active' : '');
        btn.textContent = name;
        btn.disabled = !API;
        btn.title = (a.song_count != null ? a.song_count + ' 首 · ' : '') +
          (a.word_count != null ? a.word_count + ' 词' : '');
        btn.addEventListener('click', () => setArtist(name));
        el.artistSwitch.appendChild(btn);
      });
      if (el.artistMeta) {
        const hit = list.find((x) => (x.artist || x.id) === currentArtist);
        el.artistMeta.textContent = currentArtist
          ? ('当前：' + currentArtist +
            (hit && hit.song_count != null ? ' · ' + hit.song_count + ' 首' : '') +
            ' · 待学 ' + DECK.length + ' 词')
          : '请选择歌手';
        if (!API) el.artistMeta.textContent += '（静态页无法切换，请用 serve）';
      }
      updateArtistChip();
    }

    async function setArtist(next) {
      if (!API || !next || next === currentArtist) return;
      if (el.artistMeta) el.artistMeta.textContent = '切换中…';
      try {
        const res = await fetch(API + '/api/artist?artist=' + encodeURIComponent(next));
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '切换失败');
        currentArtist = data.artist || next;
        if (Array.isArray(data.artists)) ARTISTS = data.artists;
        if (data.level) currentLevel = data.level;
        DECK = Array.isArray(data.deck) ? data.deck : [];
        i = 0;
        songFocusLabel = '';
        sessionKnown.clear();
        playCache.clear();
        lastPlaySongId = '';
        lyricLines = [];
        if (el.songFocus) el.songFocus.textContent = '';
        if (el.searchHits) el.searchHits.innerHTML = '';
        if (el.searchEmpty) el.searchEmpty.textContent = '';
        if (el.audio) {
          try { el.audio.pause(); } catch (_) {}
          el.audio.removeAttribute('src');
        }
        rankArtist = currentArtist;
        rankLoaded = false;
        const params = new URLSearchParams(location.search);
        params.set('artist', currentArtist);
        params.set('level', currentLevel);
        history.replaceState(null, '', '?' + params.toString());
        renderArtistSwitch();
        renderLevelSwitch();
        render();
        switchTab('learn');
      } catch (e) {
        if (el.artistMeta) el.artistMeta.textContent = '切换失败：' + e.message;
      }
    }

    function clearCover() {
      lastCoverSongId = '';
      if (el.coverBg) {
        el.coverBg.style.backgroundImage = '';
        el.coverBg.classList.remove('has-cover');
      }
      if (el.coverThumb) {
        el.coverThumb.style.backgroundImage = '';
        el.coverThumb.classList.add('empty');
      }
      if (el.viewLearn) el.viewLearn.classList.remove('has-cover-bg');
      document.body.classList.remove('has-cover-bg');
    }

    function applyCoverUrl(url) {
      const safe = String(url || '').replace(/"/g, '\\"');
      if (!safe) {
        clearCover();
        return;
      }
      el.coverBg.style.backgroundImage = 'url("' + safe + '")';
      el.coverBg.classList.add('has-cover');
      if (el.coverThumb) {
        el.coverThumb.style.backgroundImage = 'url("' + safe + '")';
        el.coverThumb.classList.remove('empty');
      }
      if (el.viewLearn) el.viewLearn.classList.add('has-cover-bg');
      document.body.classList.add('has-cover-bg');
    }

    async function setCoverForSong(songId) {
      const id = String(songId || '');
      if (!id) {
        clearCover();
        return;
      }
      if (id === lastCoverSongId && el.coverBg?.classList.contains('has-cover')) return;
      if (!API) {
        clearCover();
        return;
      }
      const seq = ++coverSeq;
      try {
        const res = await fetch(API + '/api/cover?song_id=' + encodeURIComponent(id));
        const data = await res.json();
        if (seq !== coverSeq) return;
        if (data.ok && data.cover_url) {
          lastCoverSongId = id;
          applyCoverUrl(data.cover_url);
        } else {
          clearCover();
        }
      } catch {
        if (seq !== coverSeq) return;
        clearCover();
      }
    }

    function formatSec(sec) {
      const total = Math.max(0, Math.floor(Number(sec) || 0));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m + ':' + String(s).padStart(2, '0');
    }

    function syncScrubber() {
      if (!el.audio || !el.seekRange || scrubbing) return;
      const dur = el.audio.duration;
      const cur = el.audio.currentTime || 0;
      if (el.timeCur) el.timeCur.textContent = formatSec(cur);
      if (Number.isFinite(dur) && dur > 0) {
        if (el.timeDur) el.timeDur.textContent = formatSec(dur);
        el.seekRange.value = String(Math.round((cur / dur) * 1000));
      } else {
        if (el.timeDur) el.timeDur.textContent = '0:00';
        el.seekRange.value = '0';
      }
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatClock(ms) {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m + ':' + String(s).padStart(2, '0');
    }

    function highlight(line, word) {
      const raw = String(line ?? '');
      const w = String(word ?? '');
      if (!w) return esc(raw);
      const lower = raw.toLowerCase();
      const needle = w.toLowerCase();
      let out = '', pos = 0;
      while (pos < raw.length) {
        const at = lower.indexOf(needle, pos);
        if (at < 0) { out += esc(raw.slice(pos)); break; }
        out += esc(raw.slice(pos, at)) + '<span class="hl">' + esc(raw.slice(at, at + w.length)) + '</span>';
        pos = at + w.length;
      }
      return out;
    }

    function levelName(id) {
      const hit = LEVELS.find((x) => x.id === id);
      return hit ? hit.label : id;
    }

    function renderLevelSwitch() {
      el.levelSwitch.innerHTML = '';
      LEVELS.forEach((lv) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (lv.id === currentLevel ? ' active' : '');
        btn.textContent = lv.label;
        btn.disabled = !API;
        btn.addEventListener('click', () => setLevel(lv.id));
        el.levelSwitch.appendChild(btn);
      });
      el.levelMeta.textContent = '当前：' + levelName(currentLevel) + ' · 待学 ' + DECK.length + ' 词'
        + (API ? '' : '（静态页无法切换，请用 serve）');
      updateLevelChip();
    }

    async function setLevel(next) {
      if (!API || next === currentLevel) return;
      el.levelMeta.textContent = '切换中…';
      try {
        const res = await fetch(API + '/api/level?level=' + encodeURIComponent(next));
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '切换失败');
        currentLevel = data.level;
        DECK = Array.isArray(data.deck) ? data.deck : [];
        i = 0;
        songFocusLabel = '';
        el.songFocus.textContent = '';
        el.searchHits.innerHTML = '';
        el.searchEmpty.textContent = '';
        history.replaceState(null, '', '?level=' + encodeURIComponent(currentLevel));
        renderLevelSwitch();
        render();
        switchTab('learn');
      } catch (e) {
        el.levelMeta.textContent = '切换失败：' + e.message;
      }
    }

    function applyLearnResult(data) {
      if (!data || !data.ok) {
        el.songFocus.textContent = (data && (data.message || data.error)) || '未找到歌曲';
        if (data && data.suggestions && data.suggestions.length) {
          el.songFocus.textContent += ' · 可试：' + data.suggestions.slice(0, 5).join(' / ');
        }
        return false;
      }
      DECK = Array.isArray(data.deck)
        ? data.deck
        : Array.isArray(data.words)
          ? data.words
          : [];
      i = 0;
      songFocusLabel = (data.song && data.song.song_name) || '';
      el.songFocus.textContent =
        '正在学 《' + songFocusLabel + '》 · ' + DECK.length + ' 个难点词 · ' +
        (data.seek_hint || '');
      switchTab('learn');
      render();
      return true;
    }

    async function doLearnSong() {
      const name = el.learnSongInput.value.trim();
      if (!API) {
        el.songFocus.textContent = '请通过 node cli.js serve 打开本页';
        return;
      }
      if (!name) {
        el.songFocus.textContent = '请输入歌名';
        return;
      }
      el.songFocus.textContent = '定位中…';
      el.learnSongBtn.disabled = true;
      try {
        const res = await fetch(API + '/api/learn-song', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ song_name: name }),
        });
        const data = await res.json();
        applyLearnResult(data);
      } catch (e) {
        el.songFocus.textContent = '学歌失败：' + e.message;
      }
      el.learnSongBtn.disabled = false;
    }

    async function clearSongFocus() {
      if (!API) return;
      try {
        const res = await fetch(API + '/api/learn-song/clear', { method: 'POST' });
        const data = await res.json();
        DECK = Array.isArray(data.deck) ? data.deck : DECK;
        i = 0;
        songFocusLabel = '';
        el.songFocus.textContent = '已回到全部待学词';
        el.learnSongInput.value = '';
        renderLevelSwitch();
        render();
      } catch (e) {
        el.songFocus.textContent = '清除失败：' + e.message;
      }
    }

    async function refreshQuizButton() {
      if (!el.startQuizBtn) return;
      if (!API) {
        el.startQuizBtn.disabled = true;
        el.startQuizBtn.title = '请通过 serve 打开';
        el.startQuizBtn.textContent = '小测';
        return;
      }
      try {
        const res = await fetch(API + '/api/known');
        const data = await res.json();
        applyQuizUnlock(data);
      } catch (_) {
        el.startQuizBtn.disabled = true;
        el.startQuizBtn.title = '无法读取今日进度';
      }
    }

    function applyQuizUnlock(stats) {
      if (!el.startQuizBtn) return;
      const today = Number(stats.today_count) || 0;
      const need = stats.quiz_need != null
        ? Number(stats.quiz_need)
        : Math.max(0, 6 - today);
      const unlocked = Boolean(stats.quiz_unlocked) || today > 5;
      el.startQuizBtn.disabled = !unlocked;
      if (unlocked) {
        el.startQuizBtn.textContent = '小测';
        el.startQuizBtn.title = '根据今日已认识的四六级词出填空题（今日 ' + today + ' 个）';
      } else {
        el.startQuizBtn.textContent = '小测(还差' + need + ')';
        el.startQuizBtn.title =
          '今日点「认识」超过 5 个词后解锁（当前 ' + today + ' 个，还需 ' + need + ' 个）';
      }
    }

    async function startQuiz() {
      if (!API) {
        el.quizFeedback.textContent = '请通过 serve 打开本页';
        el.quizPanel.hidden = false;
        return;
      }
      if (el.startQuizBtn.disabled) {
        el.quizPanel.hidden = false;
        el.quizQuestions.innerHTML = '';
        el.quizFeedback.textContent = el.startQuizBtn.title || '今日学习未达解锁条件';
        return;
      }
      el.quizPanel.hidden = false;
      el.quizQuestions.innerHTML = '出题中…（仅用今日已认识的词）';
      el.quizSubmitBtn.hidden = true;
      el.quizFeedback.textContent = '';
      try {
        const res = await fetch(API + '/api/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 3 }),
        });
        const data = await res.json();
        if (data.stats) applyQuizUnlock(data.stats);
        if (!data.ok || !data.questions || !data.questions.length) {
          el.quizQuestions.innerHTML = '';
          el.quizFeedback.textContent = data.error || '暂时出不了题';
          return;
        }
        quizState = data.questions;
        el.quizQuestions.innerHTML = '';
        data.questions.forEach((q) => {
          const wrap = document.createElement('div');
          wrap.className = 'quiz-q';
          wrap.innerHTML =
            '<label for="quiz-a-' + esc(q.id) + '">' + esc(q.prompt) + '</label>' +
            '<input type="text" id="quiz-a-' + esc(q.id) + '" data-qid="' + esc(q.id) + '" autocomplete="off" />';
          el.quizQuestions.appendChild(wrap);
        });
        el.quizSubmitBtn.hidden = false;
        el.quizFeedback.textContent =
          (data.feedback || '') +
          (data.pool_size != null ? ' · 今日可出题词库 ' + data.pool_size + ' 个' : '');
      } catch (e) {
        el.quizQuestions.innerHTML = '';
        el.quizFeedback.textContent = '出题失败：' + e.message;
      }
    }

    async function submitQuiz() {
      if (!quizState || !API) return;
      const answers = quizState.map((q) => {
        const input = document.getElementById('quiz-a-' + q.id);
        return { id: q.id, answer: input ? input.value : '' };
      });
      el.quizSubmitBtn.disabled = true;
      try {
        const res = await fetch(API + '/api/quiz/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions: quizState, answers }),
        });
        const data = await res.json();
        el.quizFeedback.textContent =
          (data.feedback || '') +
          ' · 明细：' +
          (data.results || [])
            .map((r) => r.word + (r.correct ? '✓' : '✗(' + r.expected + ')'))
            .join(' ');
      } catch (e) {
        el.quizFeedback.textContent = '判分失败：' + e.message;
      }
      el.quizSubmitBtn.disabled = false;
    }

    function jumpToWord(word, songId) {
      const w = String(word || '').toLowerCase();
      let idx = DECK.findIndex((d) => d.word === w && (!songId || String(d.song_id) === String(songId)));
      if (idx < 0) idx = DECK.findIndex((d) => d.word === w);
      if (idx < 0) {
        el.searchEmpty.textContent = '词库有命中，但不在当前待学列表里（可能已标记认识）。词：' + w;
        return;
      }
      i = idx;
      switchTab('learn');
      render();
      el.word.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderHits(data) {
      el.searchHits.innerHTML = '';
      if (data.error) {
        el.searchEmpty.textContent = data.error;
        return;
      }
      if (!data.found) {
        el.searchEmpty.textContent = '词库中未找到「' + (data.word || '') + '」（可能不在' + levelName(currentLevel) + '∩当前歌单）。';
        return;
      }
      el.searchEmpty.textContent = '找到 ' + data.count + ' 处（' + levelName(currentLevel) + ' · ' + (data.artist || '') + '）';
      data.occurrences.forEach((o) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hit';
        btn.innerHTML =
          '<div class="t">' + esc(o.song_name) + ' · ' + formatClock(o.t_ms) + '</div>' +
          '<div class="l">' + esc(o.line) + '</div>';
        btn.addEventListener('click', () => jumpToWord(data.word, o.song_id));
        el.searchHits.appendChild(btn);
      });
    }

    async function doSearch() {
      const word = el.searchInput.value.trim();
      if (!API) {
        el.searchEmpty.textContent = '请通过 node cli.js serve 打开本页';
        return;
      }
      el.searchEmpty.textContent = '搜索中…';
      el.searchHits.innerHTML = '';
      try {
        const res = await fetch(API + '/api/search?word=' + encodeURIComponent(word));
        const data = await res.json();
        renderHits(data);
      } catch (e) {
        el.searchEmpty.textContent = '搜索失败：' + e.message;
      }
    }

    function renderRankControls() {
      el.rankArtists.innerHTML = '';
      RANK_ARTISTS.forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (name === rankArtist ? ' active' : '');
        btn.textContent = name;
        btn.addEventListener('click', () => {
          rankArtist = name;
          loadRankings(true);
        });
        el.rankArtists.appendChild(btn);
      });
      el.rankLevels.innerHTML = '';
      LEVELS.forEach((lv) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (lv.id === rankLevel ? ' active' : '');
        btn.textContent = lv.label;
        btn.addEventListener('click', () => {
          rankLevel = lv.id;
          loadRankings(true);
        });
        el.rankLevels.appendChild(btn);
      });
    }

    function renderArtistRanking(data) {
      el.rankSummary.innerHTML = '';
      el.rankArtistBoard.innerHTML = '';
      if (!data || !data.ok) {
        el.rankEmpty.textContent =
          (data && data.error) ||
          '未找到「' + rankArtist + '」排行榜。请先：node cli.js rank --artist "' +
            rankArtist +
            '" --top 50 --level ' +
            rankLevel;
        return;
      }
      el.rankEmpty.textContent = '';
      const stats = [
        ['唯一词', data.artist_unique_words],
        ['总命中', data.artist_total_hits],
        ['有词歌曲', (data.ranked_song_count || 0) + '/' + (data.song_count || 0)],
        ['四级唯一', data.artist_cet4_unique_words],
        ['六级唯一', data.artist_cet6_unique_words],
      ];
      stats.forEach(([k, v]) => {
        const div = document.createElement('div');
        div.className = 'rank-stat';
        div.innerHTML = '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>';
        el.rankSummary.appendChild(div);
      });
      if (data.hardest_song) {
        const hard = document.createElement('div');
        hard.className = 'rank-stat';
        hard.innerHTML =
          '<div class="k">最难歌</div><div class="v" style="font-size:1rem">' +
          esc(data.hardest_song.song_name) +
          '</div>';
        el.rankSummary.appendChild(hard);
      }
      (data.songs || []).slice(0, 50).forEach((s) => {
        const row = document.createElement('div');
        row.className = 'rank-row';
        const chips = (s.example_words || s.top_words || [])
          .slice(0, 8)
          .map((w) => {
            const word = typeof w === 'string' ? w : w.word;
            return (
              '<button type="button" class="word-chip" data-word="' +
              esc(word) +
              '">' +
              esc(word) +
              '</button>'
            );
          })
          .join('');
        row.innerHTML =
          '<div class="title"><span class="rank-number">#' +
          esc(s.rank) +
          '</span><span class="rank-song">' +
          esc(s.song_name) +
          '</span><span class="rank-metric">' +
          esc(s.unique_words) +
          'u · ' +
          esc(s.total_hits) +
          'h</span></div>' +
          '<div class="meta">四级 ' +
          esc(s.cet4_unique_words) +
          ' · 六级 ' +
          esc(s.cet6_unique_words) +
          ' · 命中行 ' +
          esc(s.hit_line_count) +
          '</div>' +
          (chips ? '<div class="chips">' + chips + '</div>' : '');
        row.querySelectorAll('.word-chip').forEach((btn) => {
          btn.addEventListener('click', () => {
            const w = btn.getAttribute('data-word') || '';
            el.searchInput.value = w;
            switchTab('search');
            doSearch();
          });
        });
        el.rankArtistBoard.appendChild(row);
      });
    }

    function renderArtistSummary(data) {
      el.rankSummaryBoard.innerHTML = '';
      const artists = (data && data.artists) || [];
      if (!artists.length) {
        const p = document.createElement('p');
        p.className = 'rank-empty';
        p.textContent =
          '尚未生成三位歌手总览。运行：node cli.js rank-all --top 50 --level ' + rankLevel;
        el.rankSummaryBoard.appendChild(p);
        return;
      }
      artists.forEach((a) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'artist-card' + (a.artist === rankArtist ? ' active' : '');
        btn.innerHTML =
          '<div class="t">#' +
          esc(a.rank) +
          ' ' +
          esc(a.artist) +
          '</div><div class="l">唯一词 ' +
          esc(a.artist_unique_words) +
          ' · 命中 ' +
          esc(a.artist_total_hits) +
          (a.hardest_song ? ' · 最难 ' + esc(a.hardest_song.song_name) : '') +
          '</div>';
        btn.addEventListener('click', () => {
          rankArtist = a.artist;
          loadRankings(true);
        });
        el.rankSummaryBoard.appendChild(btn);
      });
    }

    async function loadRankings(force) {
      renderRankControls();
      if (!API) {
        el.rankEmpty.textContent = '请通过 node cli.js serve 打开本页查看排行榜';
        return;
      }
      if (rankLoaded && !force) return;
      el.rankEmpty.textContent = '加载排行榜…';
      try {
        const q =
          '?artist=' +
          encodeURIComponent(rankArtist) +
          '&level=' +
          encodeURIComponent(rankLevel) +
          '&top=50';
        const [artistRes, summaryRes] = await Promise.all([
          fetch(API + '/api/ranking' + q),
          fetch(API + '/api/ranking/summary?level=' + encodeURIComponent(rankLevel) + '&top=50'),
        ]);
        const artistData = await artistRes.json();
        const summaryData = await summaryRes.json();
        renderArtistRanking(artistData);
        renderArtistSummary(summaryData);
        rankLoaded = true;
      } catch (e) {
        el.rankEmpty.textContent = '排行榜加载失败：' + e.message;
      }
    }

    function appendChat(role, text, tag) {
      const div = document.createElement('div');
      div.className = 'bubble ' + (role === 'user' ? 'user' : 'bot');
      div.innerHTML =
        (tag ? '<div class="tag">' + esc(tag) + '</div>' : '') +
        '<div>' + esc(text) + '</div>';
      el.chatLog.appendChild(div);
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    }

    async function doChat() {
      const message = el.chatInput.value.trim();
      if (!message) return;
      appendChat('user', message);
      el.chatInput.value = '';
      const data = await postAssistant(message, el.chatStatus, el.chatBtn);
      if (!data) return;
      if (data.tool_calls && data.tool_calls.length) {
        appendChat('bot', data.tool_calls.map((t) => t.name).join(', '), 'tools');
      }
      if (data.error && !data.reply) {
        appendChat('bot', data.error, '错误');
      } else if (data.reply) {
        appendChat('bot', data.reply, '助手');
      }
      applyAssistantResult(data, { intoCoach: false });
      el.chatStatus.textContent = data.ok ? '' : (data.error || '');
    }

    async function enrichCurrent() {
      const seq = ++enrichSeq;
      const p = DECK[i];
      if (!p || !revealed) return;
      const hasDual = Boolean(p.gloss_slang && p.artist_note);
      if (p.story && hasDual) {
        el.story.textContent = p.story;
        if (p.line_zh) el.lineZh.textContent = p.line_zh;
        applyDualGloss(p);
        return;
      }
      if (!API) {
        el.story.textContent = '未连接服务';
        applyDualGloss(p);
        return;
      }
      el.story.textContent = '生成中…';
      el.glossSlang.textContent = p.gloss_slang || '生成中…';
      try {
        const q = new URLSearchParams({
          word: p.word, song_id: p.song_id, song_name: p.song_name,
          artist: p.artist, line: p.line, line_zh: p.line_zh || '', t_ms: String(p.t_ms || 0),
        });
        const res = await fetch(API + '/api/enrich?' + q.toString());
        const data = await res.json();
        if (seq !== enrichSeq || !revealed) return;
        if (data.error && !data.story && !data.gloss_slang) {
          el.story.textContent = data.error;
          applyDualGloss(p);
          return;
        }
        if (data.line_zh) { p.line_zh = data.line_zh; el.lineZh.textContent = data.line_zh; }
        if (data.story) { p.story = data.story; el.story.textContent = data.story; }
        else el.story.textContent = '暂无解说';
        if (data.gloss) p.gloss = data.gloss;
        if (data.gloss_academic) p.gloss_academic = data.gloss_academic;
        if (data.gloss_slang) p.gloss_slang = data.gloss_slang;
        if (data.artist_note) p.artist_note = data.artist_note;
        applyDualGloss(p);
      } catch (e) {
        if (seq !== enrichSeq) return;
        el.story.textContent = 'enrich 失败';
      }
    }

    function syncPlayButtons() {
      const label = el.audio && !el.audio.paused ? '暂停' : '播放';
      if (el.playPauseBtn) el.playPauseBtn.textContent = label;
      if (el.linePlayBtn) {
        el.linePlayBtn.textContent = el.audio && !el.audio.paused ? '暂停' : '播放原句';
      }
    }

    function applyReveal() {
      const show = revealed;
      el.gloss.hidden = true; // prefer dual-gloss
      el.dualGloss.hidden = !show;
      el.seekBanner.hidden = !show;
      el.lineZh.hidden = !show;
      // Initial habit: play control sits under the lyric line; after reveal use the right player.
      if (el.linePlayRow) el.linePlayRow.hidden = show;
      if (el.deepWrap) el.deepWrap.hidden = !show;
      // Depth stays collapsed by default; lyrics expand to full after reveal.
      if (!show) setDeepExpanded(false);
      else if (!deepExpanded) setDeepExpanded(false);
      if (el.storyBox) el.storyBox.hidden = false;
      el.quiz.hidden = show;
      el.nav.hidden = !show;
      if (!show) {
        el.quizDone.hidden = true;
        el.quizDone.textContent = '';
        el.story.textContent = '';
        el.artistNote.textContent = '';
      }
      syncPlayButtons();
    }

    async function onKnow() {
      const p = DECK[i];
      if (!p) return;
      revealed = true;
      sessionKnown.add(p.word);
      applyReveal();
      applyDualGloss(p);
      applySeekBanner(p);
      enrichCurrent();
      if (API) {
        try {
          const res = await fetch(API + '/api/known', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              word: p.word,
              song_id: p.song_id,
              song_name: p.song_name,
              line: p.line,
              artist: p.artist,
            }),
          });
          const data = await res.json();
          if (data.ok) {
            applyQuizUnlock(data);
            el.quizDone.hidden = false;
            let note =
              data.today_count != null
                ? '已记住 · 今日 ' + data.today_count + ' · 累计 ' + data.known_count
                : '已记住';
            if (data.quiz_unlocked) note += ' · 小测已解锁';
            else if (data.quiz_need != null) note += ' · 小测还差 ' + data.quiz_need + ' 个';
            if (i >= DECK.length - 1) note += ' · 已到本词表最后一词';
            el.quizDone.textContent = note;
          }
        } catch (_) {
          /* ignore persist errors for UX */
        }
      } else if (i >= DECK.length - 1) {
        el.quizDone.hidden = false;
        el.quizDone.textContent = '已到本词表最后一词';
      }
    }

    function onUnknown() {
      const p = DECK[i];
      revealed = true;
      applyReveal();
      if (p) {
        applyDualGloss(p);
        applySeekBanner(p);
      }
      enrichCurrent();
    }

    function nextUnrevealedIndex(from, delta) {
      if (!DECK.length) return from;
      let n = from + delta;
      while (n >= 0 && n < DECK.length && sessionKnown.has(DECK[n].word)) {
        n += delta;
      }
      if (n < 0 || n >= DECK.length) return from;
      return n;
    }

    function render() {
      if (!DECK.length) {
        el.word.textContent = '没有可学的词';
        el.glossAcademic.textContent = '换一个词表等级试试，或重新 build 歌单。';
        el.glossSlang.textContent = '';
        el.dualGloss.hidden = false;
        el.gloss.hidden = true;
        el.artistNote.hidden = true;
        el.seekBanner.hidden = true;
        el.meta.textContent = '';
        el.line.textContent = '';
        el.lineZh.textContent = '';
        el.story.textContent = '';
        if (el.deepWrap) el.deepWrap.hidden = true;
        setDeepExpanded(false);
        el.fallback.innerHTML = '';
        el.badge.textContent = levelName(currentLevel);
        el.counter.textContent = '0 / 0';
        updateLevelChip();
        clearCover();
        revealed = true;
        el.quiz.hidden = true;
        el.nav.hidden = true;
        el.quizDone.hidden = false;
        el.quizDone.textContent = '没有可学的词';
        return;
      }
      // 跳过本会话已点「认识」的词
      if (sessionKnown.has(DECK[i]?.word)) {
        const n = nextUnrevealedIndex(i, 1);
        if (n !== i) {
          i = n;
        } else {
          const b = nextUnrevealedIndex(i, -1);
          if (b !== i) i = b;
        }
      }
      i = Math.max(0, Math.min(i, DECK.length - 1));
      const p = DECK[i];
      revealed = false;
      applyReveal();
      document.title = p.word + ' @ ' + p.song_name;
      el.badge.textContent = p.precision + ' · ' + formatClock(p.t_ms);
      el.counter.textContent = (i + 1) + ' / ' + DECK.length;
      updateLevelChip();
      el.word.textContent = p.word;
      applyDualGloss(p);
      applySeekBanner(p);
      el.meta.textContent = p.artist + ' — ' + p.song_name;
      el.line.innerHTML = highlight(p.line, p.word);
      el.lineZh.textContent = p.line_zh || '';
      el.story.textContent = '';
      el.prev.disabled = i <= 0;
      el.next.disabled = i >= DECK.length - 1;
      setupPlayer(p);
      setCoverForSong(p.song_id);
      // enrich 仅在揭开后触发
    }

    function go(delta) {
      const n = nextUnrevealedIndex(i, delta);
      if (n === i && delta !== 0) {
        // 没有可跳的下一张时，若方向是前进且当前已认识，停在当前
        if (sessionKnown.has(DECK[i]?.word) && delta > 0) {
          revealed = true;
          applyReveal();
          el.quizDone.hidden = false;
          el.quizDone.textContent = '后面没有未点「认识」的词了';
        }
        return;
      }
      i = n;
      render();
    }

    el.prev.addEventListener('click', () => go(-1));
    el.next.addEventListener('click', () => go(1));
    el.knowBtn.addEventListener('click', onKnow);
    el.unknownBtn.addEventListener('click', onUnknown);
    if (el.skipBtn) {
      el.skipBtn.addEventListener('click', () => {
        // Skip current card without marking as known.
        go(1);
      });
    }
    if (el.deepToggle) {
      el.deepToggle.addEventListener('click', () => setDeepExpanded(!deepExpanded));
    }
    el.searchBtn.addEventListener('click', doSearch);
    el.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    el.chatBtn.addEventListener('click', doChat);
    el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doChat(); });
    el.coachBtn.addEventListener('click', doCoachPlan);
    el.coachInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doCoachPlan();
      }
    });
    if (el.coachClearBtn) el.coachClearBtn.addEventListener('click', clearCoachChat);
    el.coachReloadBtn.addEventListener('click', () => loadCoachPlan(true));
    el.learnSongBtn.addEventListener('click', doLearnSong);
    el.learnSongInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLearnSong(); });
    el.clearSongBtn.addEventListener('click', clearSongFocus);
    el.startQuizBtn.addEventListener('click', startQuiz);
    el.quizSubmitBtn.addEventListener('click', submitQuiz);
    el.seekTargetBtn.addEventListener('click', () => {
      const p = DECK[i];
      if (p) seekToMs(targetSeekMs(p.t_ms), true);
    });
    function togglePlayPause() {
      if (!el.audio) return;
      if (el.audio.paused) {
        el.audio.play().catch(() => {});
      } else {
        el.audio.pause();
      }
      syncPlayButtons();
    }
    el.playPauseBtn.addEventListener('click', togglePlayPause);
    if (el.linePlayBtn) {
      el.linePlayBtn.addEventListener('click', () => {
        const p = DECK[i];
        if (!p || !el.audio) return;
        // First tap on the card: jump to the lyric and play; later taps toggle pause/resume.
        if (el.audio.paused) {
          seekToMs(targetSeekMs(p.t_ms), true);
        } else {
          el.audio.pause();
        }
        syncPlayButtons();
      });
    }
    el.audio.addEventListener('timeupdate', () => {
      highlightLyricAt(el.audio.currentTime * 1000);
      syncPlayButtons();
      syncScrubber();
    });
    el.audio.addEventListener('loadedmetadata', syncScrubber);
    el.audio.addEventListener('durationchange', syncScrubber);
    el.audio.addEventListener('play', syncPlayButtons);
    el.audio.addEventListener('pause', syncPlayButtons);
    if (el.seekRange) {
      // Important: do NOT syncScrubber() on pointerup before applying the seek.
      // Otherwise the range value is reset to the old currentTime, and the later
      // change event seeks back to the previous position (click feels broken).
      function applyRangeSeek() {
        const dur = el.audio.duration;
        if (!Number.isFinite(dur) || dur <= 0) return;
        const ratio = Math.min(1, Math.max(0, Number(el.seekRange.value) / 1000));
        const sec = ratio * dur;
        try { el.audio.currentTime = sec; } catch (_) {}
        if (el.timeCur) el.timeCur.textContent = formatSec(sec);
        resumeLyricsFollowNow();
        highlightLyricAt(sec * 1000, { forceScroll: true });
      }
      function endScrub() {
        if (!scrubbing) {
          syncScrubber();
          return;
        }
        applyRangeSeek();
        scrubbing = false;
        syncScrubber();
      }
      el.seekRange.addEventListener('pointerdown', () => { scrubbing = true; });
      el.seekRange.addEventListener('input', () => {
        scrubbing = true;
        const dur = el.audio.duration;
        if (!Number.isFinite(dur) || dur <= 0) return;
        const ratio = Number(el.seekRange.value) / 1000;
        if (el.timeCur) el.timeCur.textContent = formatSec(ratio * dur);
      });
      el.seekRange.addEventListener('change', endScrub);
      el.seekRange.addEventListener('pointerup', endScrub);
      el.seekRange.addEventListener('pointercancel', endScrub);
    }
    if (el.lyricsPanel) {
      el.lyricsPanel.addEventListener('wheel', pauseLyricsFollow, { passive: true });
      el.lyricsPanel.addEventListener('touchstart', pauseLyricsFollow, { passive: true });
      el.lyricsPanel.addEventListener('pointerdown', (e) => {
        // Dragging the scrollbar / panel itself — not a lyric-row click seek.
        if (e.target && e.target.closest && e.target.closest('.lyric-row')) return;
        pauseLyricsFollow();
      });
      el.lyricsPanel.addEventListener('scroll', () => {
        if (!lyricsProgrammaticScroll) pauseLyricsFollow();
      }, { passive: true });
    }
    if (el.tlZoom && el.macosWindow) {
      el.tlZoom.addEventListener('click', () => {
        el.macosWindow.classList.toggle('is-zoomed');
        el.macosWindow.classList.remove('is-minimized');
      });
    }
    if (el.tlMinimize && el.macosWindow) {
      el.tlMinimize.addEventListener('click', () => {
        el.macosWindow.classList.toggle('is-minimized');
      });
    }
    if (el.tlClose && el.macosWindow) {
      el.tlClose.addEventListener('click', () => {
        el.macosWindow.style.opacity = '0.35';
        setTimeout(() => { el.macosWindow.style.opacity = ''; }, 280);
      });
    }
    el.levelChip.addEventListener('click', () => switchTab('settings'));
    if (el.artistChip) el.artistChip.addEventListener('click', () => switchTab('settings'));
    if (el.challengeStartBtn) el.challengeStartBtn.addEventListener('click', startChallenge);
    if (el.challengeKnowBtn) el.challengeKnowBtn.addEventListener('click', () => answerChallengeKnow(true));
    if (el.challengeUnknownBtn) el.challengeUnknownBtn.addEventListener('click', () => answerChallengeKnow(false));
    if (el.challengeBlankSubmit) el.challengeBlankSubmit.addEventListener('click', submitChallengeBlank);
    if (el.challengeBlankInput) {
      el.challengeBlankInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitChallengeBlank();
        }
      });
    }
    if (el.challengeBustOk) el.challengeBustOk.addEventListener('click', dismissChallengeBust);
    if (el.challengeCopyBtn) {
      el.challengeCopyBtn.addEventListener('click', async () => {
        const text = el.challengeShareText ? el.challengeShareText.value : '';
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          el.challengeResultStatus.textContent = '已复制到剪贴板';
        } catch (_) {
          el.challengeShareText.select();
          el.challengeResultStatus.textContent = '请手动复制文案';
        }
      });
    }
    if (el.challengeLearnBtn) el.challengeLearnBtn.addEventListener('click', learnChallengeUnknowns);
    if (el.challengeRetryBtn) {
      el.challengeRetryBtn.addEventListener('click', () => {
        showChallengePhase('intro');
        renderChallengeIntro();
        startChallenge();
      });
    }
    el.tabs.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!el.views.learn.classList.contains('active') || !revealed) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    });

    const hashTab = (location.hash || '').replace(/^#\\/?/, '');
    if (hashTab === 'search' || hashTab === 'settings' || hashTab === 'rank' || hashTab === 'coach' || hashTab === 'challenge') {
      switchTab(hashTab);
    }

    if (!currentArtist && ARTISTS.length) currentArtist = ARTISTS[0].artist || ARTISTS[0].id || '';
    if (currentArtist) rankArtist = currentArtist;
    renderArtistSwitch();
    renderLevelSwitch();
    renderRankControls();
    refreshQuizButton();
    render();
  </script>
</body>
</html>`;
}
