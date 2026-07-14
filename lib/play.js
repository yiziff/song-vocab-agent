import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { lookupGloss } from "./enrich.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export function buildDeck(items) {
  return (items || []).map((it) => ({
    word: it.word,
    song_id: String(it.song_id),
    song_name: it.song_name,
    artist: it.artist,
    t_ms: Number(it.t_ms) || 0,
    line: it.line || "",
    line_zh: it.line_zh || "",
    precision: it.precision || "line",
    gloss: it.gloss || lookupGloss(it.word),
    story: it.story || "",
    audioUrl: it.audioUrl || null,
    neteaseWeb: `https://music.163.com/#/song?id=${encodeURIComponent(it.song_id)}`,
  }));
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
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Song Vocab Learn</title>
  <style>
    :root { color-scheme: light; --ink:#1a1a1a; --muted:#666; --accent:#c62f2f; --bg:#f7f4ef; --line:#ddd; --panel:#fff; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", "PingFang SC", sans-serif; margin:0; background:var(--bg); color:var(--ink); min-height:100vh; }
    .app-header { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--line); }
    .tabs { display: flex; max-width: 720px; margin: 0 auto; padding: 0 1rem; }
    .tab {
      flex: 1; font: inherit; font-size: .95rem; padding: .85rem .5rem; cursor: pointer;
      border: none; background: none; color: var(--muted); border-bottom: 2px solid transparent;
    }
    .tab:hover { color: var(--ink); }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
    main { max-width: 720px; margin: 0 auto; padding: 1.25rem 1.5rem 2rem; }
    main:has(#view-learn.active) { max-width: none; padding: 0; }
    .view { display: none; }
    .view.active { display: block; }
    #view-learn.active {
      position: relative;
      min-height: calc(100vh - 49px);
      padding: 1.25rem 1.5rem 2rem;
    }
    #cover-bg {
      position: absolute; inset: 0; z-index: 0;
      background-color: var(--bg);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transition: background-image .25s ease;
    }
    #cover-bg.has-cover::after {
      content: "";
      position: absolute; inset: 0;
      background: rgba(0,0,0,.38);
      pointer-events: none;
    }
    #view-learn .learn-inner {
      position: relative; z-index: 1;
      max-width: 720px; margin: 0 auto;
    }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:1.25rem 1.5rem; }
    .panel.learn-hero {
      background: rgba(255, 255, 255, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.65);
      backdrop-filter: blur(18px) saturate(1.2);
      -webkit-backdrop-filter: blur(18px) saturate(1.2);
    }
    .panel.learn-hero .line {
      background: rgba(255, 255, 255, 0.45);
      border-left-color: var(--accent);
    }
    .panel.learn-hero .story-box {
      background: rgba(255, 255, 255, 0.4);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .panel.learn-hero .level-chip,
    .panel.learn-hero .nav button,
    .panel.learn-hero .quiz button {
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .panel.learn-hero .quiz button {
      border-radius: 6px 6px 0 0;
    }
    .panel.learn-hero .badge {
      background: rgba(255, 255, 255, 0.55);
      border-color: rgba(255, 255, 255, 0.65);
    }
    .panel h2 { font-size:.95rem; margin:0 0 .75rem; color:var(--accent); }
    .panel .sub { color:var(--muted); font-size:.85rem; margin:0 0 1rem; line-height:1.45; }
    .row { display:flex; gap:.5rem; }
    input[type=text] {
      flex:1; font:inherit; padding:.65rem .75rem; border:1px solid var(--line); border-radius:6px;
    }
    button.action, .nav button, .level-btn {
      font: inherit; font-size:.95rem; padding:.65rem 1rem; cursor:pointer;
      border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:6px; white-space:nowrap;
    }
    button.action:hover, .nav button:hover:not(:disabled), .level-btn:hover { border-color:var(--accent); color:var(--accent); }
    .nav { display:flex; gap:.75rem; margin-top:1.5rem; }
    .nav button { flex:1; }
    .nav button:disabled { opacity:.4; cursor:not-allowed; }
    .level-switch { display:flex; flex-wrap:wrap; gap:.5rem; }
    .level-btn.active { border-color:var(--accent); background:#fff5f5; color:var(--accent); font-weight:600; }
    .level-meta { color:var(--muted); font-size:.85rem; margin-top:.75rem; }
    .hit {
      display:block; width:100%; text-align:left; margin:.4rem 0; padding:.65rem .75rem;
      border:1px solid var(--line); border-radius:6px; background:#fafafa; cursor:pointer;
    }
    .hit:hover { border-color:var(--accent); }
    .hit .t { font-weight:600; }
    .hit .l { color:var(--muted); font-size:.85rem; margin-top:.25rem; }
    #search-empty, #chat-status { color:var(--muted); font-size:.9rem; min-height:1.2em; }
    #chat-log { max-height:200px; overflow:auto; margin-bottom:.75rem; font-size:.9rem; line-height:1.45; }
    .bubble { margin:.4rem 0; padding:.5rem .7rem; border-radius:6px; }
    .bubble.user { background:#f0ebe3; }
    .bubble.bot { background:#f7f7f7; border:1px solid var(--line); }
    .bubble .tag { font-size:.75rem; color:var(--muted); margin-bottom:.2rem; }
    .learn-top { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.25rem; }
    .level-chip {
      font: inherit; font-size:.8rem; padding:.35rem .65rem; border-radius:999px;
      border:1px solid var(--line); background:#fff; color:var(--muted); cursor:pointer;
    }
    .level-chip:hover { border-color:var(--accent); color:var(--accent); }
    .counter { color:var(--muted); font-size:.9rem; }
    h1 { font-size: 2.35rem; margin: 0 0 .4rem; letter-spacing: -0.02em; }
    .gloss { margin: 0 0 1rem; line-height: 1.55; font-size: 1.05rem; }
    .meta { color: var(--muted); margin-bottom: 1.25rem; }
    .line { font-size: 1.15rem; line-height: 1.55; margin: 0 0 .5rem; padding: 1rem 1.25rem;
            border-left: 4px solid var(--accent); background: #fff; border-radius: 0 6px 6px 0; }
    .line-zh { font-size: 1.05rem; color: var(--muted); margin: 0 0 1.25rem; padding: 0 .25rem 0 1.4rem; }
    .story-box { background:#fff; padding:1rem 1.25rem; margin: 1.25rem 0 0; border:1px solid var(--line); border-radius:6px; }
    .story-box h2 { font-size:.95rem; margin:0 0 .5rem; color:var(--accent); font-weight:600; }
    .story-box p { margin:0; line-height:1.6; white-space:pre-wrap; }
    .hl { color: var(--accent); font-weight: 700; }
    a { color: var(--accent); }
    .badge { display:inline-block; font-size:.75rem; padding:.15rem .5rem; border:1px solid #ccc; border-radius:4px; color:var(--muted); }
    .hint { margin-top:1rem; color:var(--muted); font-size:.85rem; text-align:center; }
    #view-learn.has-cover-bg .hint { color: rgba(255,255,255,.88); text-shadow: 0 1px 2px rgba(0,0,0,.45); }
    .status { color:var(--muted); font-size:.9rem; min-height:1.2em; }
    .player-box { margin: 1.25rem 0 0; }
    .player-box iframe {
      display: block; width: 100%; height: 86px; border: 0; border-radius: 6px;
      background: #fff;
    }
    .player-hint {
      margin: .55rem 0 0; color: var(--muted); font-size: .85rem; line-height: 1.45;
    }
    .reveal-block[hidden] { display: none !important; }
    .quiz {
      display: flex; gap: 1rem; margin-top: 1.35rem;
    }
    .quiz button {
      flex: 1; font: inherit; font-size: 1.05rem; padding: .85rem 1rem; cursor: pointer;
      border: none; background: transparent; color: var(--ink);
      border-bottom: 3px solid transparent;
    }
    .quiz button#know-btn { border-bottom-color: #2f9e66; }
    .quiz button#unknown-btn { border-bottom-color: #c62f2f; }
    .quiz button:hover { opacity: .85; }
    .quiz[hidden] { display: none !important; }
    .nav[hidden] { display: none !important; }
    .quiz-done-note { color: var(--muted); font-size: .9rem; margin-top: .75rem; text-align: center; }
    details.chat-exp { margin-top:1.25rem; border:1px dashed var(--line); border-radius:8px; padding:.75rem 1rem; background:#fafafa; }
    details.chat-exp summary { cursor:pointer; color:var(--muted); font-size:.85rem; }
    details.chat-exp[open] summary { margin-bottom:.75rem; }
  </style>
</head>
<body>
  <header class="app-header">
    <nav class="tabs" role="tablist">
      <button type="button" class="tab active" data-tab="learn" role="tab" aria-selected="true">学习</button>
      <button type="button" class="tab" data-tab="search" role="tab" aria-selected="false">搜词</button>
      <button type="button" class="tab" data-tab="settings" role="tab" aria-selected="false">设置</button>
    </nav>
  </header>

  <main>
    <section id="view-learn" class="view active" role="tabpanel">
      <div id="cover-bg" aria-hidden="true"></div>
      <div class="learn-inner">
      <div class="panel learn-hero">
        <div class="learn-top">
          <button type="button" class="level-chip" id="level-chip" title="词表设置">词表</button>
          <span class="counter" id="counter"></span>
        </div>
        <span class="badge" id="badge"></span>
        <h1 id="word"></h1>
        <p class="gloss reveal-block" id="gloss" hidden></p>
        <p class="meta" id="meta"></p>
        <div class="line" id="line"></div>
        <div class="line-zh" id="lineZh"></div>
        <div class="story-box reveal-block" id="story-box" hidden>
          <h2>在这首歌里</h2>
          <p id="story" class="status"></p>
        </div>
        <div id="audio-wrap" hidden><audio id="audio" controls></audio></div>
        <div id="fallback" class="player-box"></div>
        <div class="quiz" id="quiz">
          <button type="button" id="know-btn">认识</button>
          <button type="button" id="unknown-btn">不认识</button>
        </div>
        <div class="nav" id="nav">
          <button type="button" id="prev">← 上一个</button>
          <button type="button" id="next">下一个 →</button>
        </div>
        <p class="quiz-done-note" id="quiz-done" hidden></p>
      </div>
      <p class="hint">先判断是否认识，再看释义 · ← → 可翻词 · 搜词请切到「搜词」页</p>
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
          <summary>AI 聊天（实验 · Ch.01 练手，非主路径）</summary>
          <div id="chat-log"></div>
          <div class="row">
            <input type="text" id="chat-input" placeholder="例如：帮我找找 bound 在歌里哪" autocomplete="off" />
            <button type="button" class="action" id="chat-btn">发送</button>
          </div>
          <div id="chat-status" style="margin-top:.5rem"></div>
        </details>
      </div>
    </section>

    <section id="view-settings" class="view" role="tabpanel" hidden>
      <div class="panel">
        <h2>词表等级</h2>
        <p class="sub">切换四级 / 六级 / 全部。基于同一歌单词库过滤，无需重新建库。</p>
        <div class="level-switch" id="level-switch"></div>
        <div class="level-meta" id="level-meta"></div>
      </div>
    </section>
  </main>
  <script>
    let DECK = ${dataJson};
    const API = ${apiJson};
    const LEVELS = ${levelsJson};
    let currentLevel = ${levelJson};
    let i = ${Number(startIndex) || 0};
    let enrichSeq = 0;
    let lastCoverSongId = '';
    let coverSeq = 0;
    let revealed = false;
    const sessionKnown = new Set();

    const el = {
      badge: document.getElementById('badge'),
      counter: document.getElementById('counter'),
      levelChip: document.getElementById('level-chip'),
      coverBg: document.getElementById('cover-bg'),
      viewLearn: document.getElementById('view-learn'),
      word: document.getElementById('word'),
      gloss: document.getElementById('gloss'),
      meta: document.getElementById('meta'),
      line: document.getElementById('line'),
      lineZh: document.getElementById('lineZh'),
      story: document.getElementById('story'),
      storyBox: document.getElementById('story-box'),
      audioWrap: document.getElementById('audio-wrap'),
      audio: document.getElementById('audio'),
      fallback: document.getElementById('fallback'),
      quiz: document.getElementById('quiz'),
      knowBtn: document.getElementById('know-btn'),
      unknownBtn: document.getElementById('unknown-btn'),
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
      levelSwitch: document.getElementById('level-switch'),
      levelMeta: document.getElementById('level-meta'),
      tabs: document.querySelectorAll('.tab'),
      views: {
        learn: document.getElementById('view-learn'),
        search: document.getElementById('view-search'),
        settings: document.getElementById('view-settings'),
      },
    };

    function switchTab(name) {
      const tab = name === 'search' || name === 'settings' ? name : 'learn';
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
    }

    function updateLevelChip() {
      el.levelChip.textContent = levelName(currentLevel) + ' · ' + DECK.length + ' 词';
    }

    function clearCover() {
      lastCoverSongId = '';
      if (el.coverBg) {
        el.coverBg.style.backgroundImage = '';
        el.coverBg.classList.remove('has-cover');
      }
      if (el.viewLearn) el.viewLearn.classList.remove('has-cover-bg');
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
          el.coverBg.style.backgroundImage = 'url("' + String(data.cover_url).replace(/"/g, '\\"') + '")';
          el.coverBg.classList.add('has-cover');
          el.viewLearn.classList.add('has-cover-bg');
        } else {
          clearCover();
        }
      } catch {
        if (seq !== coverSeq) return;
        clearCover();
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
      if (!API) {
        el.chatStatus.textContent = '请通过 serve 打开';
        return;
      }
      appendChat('user', message);
      el.chatInput.value = '';
      el.chatStatus.textContent = '模型思考 / 可能正在点 find_word_in_songs…';
      el.chatBtn.disabled = true;
      try {
        const res = await fetch(API + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        const data = await res.json();
        if (data.tool_calls && data.tool_calls.length) {
          const names = data.tool_calls.map((t) => t.name + '(' + JSON.stringify(t.arguments) + ')').join(', ');
          appendChat('bot', names, 'tool_calls（模型点菜）');
        }
        if (data.error && !data.reply) {
          appendChat('bot', data.error, '错误');
        } else {
          appendChat('bot', data.reply || '（无回复）', '助手');
        }
        if (data.search && data.search.found) {
          renderHits(data.search);
          el.searchInput.value = data.search.word || '';
          switchTab('search');
        }
        el.chatStatus.textContent = '';
      } catch (e) {
        appendChat('bot', e.message, '错误');
        el.chatStatus.textContent = '';
      }
      el.chatBtn.disabled = false;
    }

    async function enrichCurrent() {
      const seq = ++enrichSeq;
      const p = DECK[i];
      if (!p || !revealed) return;
      if (p.story) {
        el.story.textContent = p.story;
        if (p.line_zh) el.lineZh.textContent = p.line_zh;
        return;
      }
      if (!API) {
        el.story.textContent = '未连接服务';
        return;
      }
      el.story.textContent = '生成中…';
      try {
        const q = new URLSearchParams({
          word: p.word, song_id: p.song_id, song_name: p.song_name,
          artist: p.artist, line: p.line, line_zh: p.line_zh || '', t_ms: String(p.t_ms || 0),
        });
        const res = await fetch(API + '/api/enrich?' + q.toString());
        const data = await res.json();
        if (seq !== enrichSeq || !revealed) return;
        if (data.error && !data.story) { el.story.textContent = data.error; return; }
        if (data.line_zh) { p.line_zh = data.line_zh; el.lineZh.textContent = data.line_zh; }
        if (data.story) { p.story = data.story; el.story.textContent = data.story; }
        else el.story.textContent = '暂无解说';
        if (data.gloss) { p.gloss = data.gloss; el.gloss.textContent = data.gloss; }
      } catch (e) {
        if (seq !== enrichSeq) return;
        el.story.textContent = 'enrich 失败';
      }
    }

    function applyReveal() {
      const show = revealed;
      el.gloss.hidden = !show;
      el.storyBox.hidden = !show;
      el.quiz.hidden = show;
      el.nav.hidden = false;
      if (!show) {
        el.quizDone.hidden = true;
        el.quizDone.textContent = '';
        el.story.textContent = '';
      }
    }

    function onKnow() {
      const p = DECK[i];
      if (!p) return;
      revealed = true;
      sessionKnown.add(p.word);
      applyReveal();
      enrichCurrent();
      if (i >= DECK.length - 1) {
        el.quizDone.hidden = false;
        el.quizDone.textContent = '已到本词表最后一词';
        return;
      }
      // 短暂展示释义后跳下一张
      setTimeout(() => {
        if (!revealed) return;
        go(1);
      }, 350);
    }

    function onUnknown() {
      revealed = true;
      applyReveal();
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
        el.gloss.textContent = '换一个词表等级试试，或重新 build 歌单。';
        el.gloss.hidden = false;
        el.meta.textContent = '';
        el.line.textContent = '';
        el.lineZh.textContent = '';
        el.story.textContent = '';
        el.storyBox.hidden = true;
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
      el.gloss.textContent = p.gloss || '（词典暂无释义）';
      el.meta.textContent = p.artist + ' — ' + p.song_name;
      el.line.innerHTML = highlight(p.line, p.word);
      el.lineZh.textContent = p.line_zh || '';
      el.story.textContent = '';
      el.prev.disabled = i <= 0;
      el.next.disabled = i >= DECK.length - 1;
      el.audioWrap.hidden = true;
      el.audio.removeAttribute('src');
      const clock = formatClock(p.t_ms);
      const songId = encodeURIComponent(String(p.song_id || ''));
      const outchain =
        'https://music.163.com/outchain/player?type=2&id=' + songId + '&auto=0&height=66';
      el.fallback.innerHTML =
        '<iframe title="网易云外链播放器" frameborder="no" border="0" marginwidth="0" marginheight="0" ' +
        'width="100%" height="86" src="' + outchain + '"></iframe>' +
        '<p class="player-hint">目标约 <strong>' + clock + '</strong> · 点播放后拖进度条到该处 · ' +
        '<a href="' + esc(p.neteaseWeb) + '" target="_blank" rel="noreferrer">在网易云打开</a></p>';
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
    el.searchBtn.addEventListener('click', doSearch);
    el.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    el.chatBtn.addEventListener('click', doChat);
    el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doChat(); });
    el.levelChip.addEventListener('click', () => switchTab('settings'));
    el.tabs.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (el.views.learn.classList.contains('active')) {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      }
    });

    const hashTab = (location.hash || '').replace(/^#\\/?/, '');
    if (hashTab === 'search' || hashTab === 'settings') switchTab(hashTab);

    renderLevelSwitch();
    render();
  </script>
</body>
</html>`;
}
