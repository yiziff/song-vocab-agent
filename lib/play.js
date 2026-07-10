import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { lookupGloss } from "./enrich.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Build deck items for the learn viewer.
 * @param {Array} items
 */
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

/**
 * @param {Array} items
 * @param {number} startIndex
 * @param {{ enrichApi?: string, open?: boolean }} opts
 */
export function openLearnViewer(items, startIndex = 0, opts = {}) {
  const playerDir = path.join(ROOT, "out", "player");
  fs.mkdirSync(playerDir, { recursive: true });

  const deck = buildDeck(items);
  const idx = Math.max(0, Math.min(startIndex, Math.max(deck.length - 1, 0)));
  const enrichApi = opts.enrichApi || "";
  const file = path.join(playerDir, "learn.html");
  fs.writeFileSync(file, renderLearnHtml(deck, idx, enrichApi), "utf8");

  if (opts.open !== false) openFile(file);

  const cur = deck[idx];
  return {
    ok: true,
    player: cur?.audioUrl ? "html-audio" : "html-preview",
    file,
    t_ms: cur?.t_ms ?? 0,
    index: idx,
    total: deck.length,
    note: "Opened learn viewer with prev/next + enrich",
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

export function renderLearnHtml(deck, startIndex, enrichApi = "") {
  const dataJson = JSON.stringify(deck).replace(/</g, "\\u003c");
  const apiJson = JSON.stringify(enrichApi || "");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Song Vocab Learn</title>
  <style>
    :root { color-scheme: light; --ink:#1a1a1a; --muted:#666; --accent:#c62f2f; --bg:#f7f4ef; --line:#ddd; }
    body { font-family: "Segoe UI", "PingFang SC", sans-serif; margin:0; background:var(--bg); color:var(--ink); }
    main { max-width: 640px; margin: 6vh auto; padding: 2rem; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
    .counter { color:var(--muted); font-size:.9rem; }
    h1 { font-size: 2rem; margin: 0 0 .35rem; letter-spacing: -0.02em; }
    .gloss { color: var(--ink); margin: 0 0 1rem; line-height: 1.5; }
    .meta { color: var(--muted); margin-bottom: 1rem; }
    .line { font-size: 1.2rem; line-height: 1.55; margin: 1rem 0 .5rem; padding: 1rem 1.25rem;
            border-left: 4px solid var(--accent); background: #fff; }
    .line-zh { font-size: 1.05rem; color: var(--muted); margin: 0 0 1rem; padding: 0 1.25rem 0 1.4rem; }
    .story-box { background:#fff; padding:1rem 1.25rem; margin: 1rem 0; border:1px solid var(--line); }
    .story-box h2 { font-size:.95rem; margin:0 0 .5rem; color:var(--accent); font-weight:600; }
    .story-box p { margin:0; line-height:1.6; white-space:pre-wrap; }
    .hl { color: var(--accent); font-weight: 700; }
    audio { width: 100%; margin-top: 1rem; }
    a { color: var(--accent); }
    .badge { display:inline-block; font-size:.75rem; padding:.15rem .5rem; border:1px solid #ccc; border-radius:4px; }
    .nav { display:flex; gap:.75rem; margin-top:1.5rem; }
    button {
      flex:1; font: inherit; font-size:1rem; padding:.75rem 1rem; cursor:pointer;
      border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:6px;
    }
    button:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
    button:disabled { opacity:.4; cursor:not-allowed; }
    .hint { margin-top:1rem; color:var(--muted); font-size:.85rem; }
    .status { color:var(--muted); font-size:.9rem; min-height:1.2em; }
    #fallback { margin-top:1rem; }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <span class="badge" id="badge"></span>
      <span class="counter" id="counter"></span>
    </div>
    <h1 id="word"></h1>
    <p class="gloss" id="gloss"></p>
    <p class="meta" id="meta"></p>
    <div class="line" id="line"></div>
    <div class="line-zh" id="lineZh"></div>
    <div class="story-box">
      <h2>在这首歌里</h2>
      <p id="story" class="status">加载中…</p>
    </div>
    <div id="audio-wrap" hidden><audio id="audio" controls></audio></div>
    <div id="fallback"></div>
    <div class="nav">
      <button type="button" id="prev">← 上一个</button>
      <button type="button" id="next">下一个 →</button>
    </div>
    <p class="hint">快捷键：← / → 翻词 · 空格打开网易云。深度语义需本机 serve（读 .env 里的 DeepSeek Key）。</p>
  </main>
  <script>
    const DECK = ${dataJson};
    const ENRICH_API = ${apiJson};
    let i = ${Number(startIndex) || 0};
    let enrichSeq = 0;

    const el = {
      badge: document.getElementById('badge'),
      counter: document.getElementById('counter'),
      word: document.getElementById('word'),
      gloss: document.getElementById('gloss'),
      meta: document.getElementById('meta'),
      line: document.getElementById('line'),
      lineZh: document.getElementById('lineZh'),
      story: document.getElementById('story'),
      audioWrap: document.getElementById('audio-wrap'),
      audio: document.getElementById('audio'),
      fallback: document.getElementById('fallback'),
      prev: document.getElementById('prev'),
      next: document.getElementById('next'),
    };

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
      let out = '';
      let pos = 0;
      while (pos < raw.length) {
        const at = lower.indexOf(needle, pos);
        if (at < 0) {
          out += esc(raw.slice(pos));
          break;
        }
        out += esc(raw.slice(pos, at)) + '<span class="hl">' + esc(raw.slice(at, at + w.length)) + '</span>';
        pos = at + w.length;
      }
      return out;
    }

    async function enrichCurrent() {
      const seq = ++enrichSeq;
      const p = DECK[i];
      if (!p) return;

      if (p.story) {
        el.story.textContent = p.story;
        if (p.line_zh) el.lineZh.textContent = p.line_zh;
        return;
      }

      if (!ENRICH_API) {
        el.story.textContent = '未连接 enrich 服务。请运行：node cli.js serve --artist "Kanye West"';
        return;
      }

      el.story.textContent = '生成中…';
      try {
        const q = new URLSearchParams({
          word: p.word,
          song_id: p.song_id,
          song_name: p.song_name,
          artist: p.artist,
          line: p.line,
          line_zh: p.line_zh || '',
          t_ms: String(p.t_ms || 0),
        });
        const res = await fetch(ENRICH_API + '/api/enrich?' + q.toString());
        const data = await res.json();
        if (seq !== enrichSeq) return;
        if (data.error && !data.story) {
          el.story.textContent = data.error;
          return;
        }
        if (data.line_zh) {
          p.line_zh = data.line_zh;
          el.lineZh.textContent = data.line_zh;
        }
        if (data.story) {
          p.story = data.story;
          el.story.textContent = data.story;
        } else {
          el.story.textContent = '暂无解说';
        }
        if (data.gloss) {
          p.gloss = data.gloss;
          el.gloss.textContent = data.gloss;
        }
      } catch (e) {
        if (seq !== enrichSeq) return;
        el.story.textContent = 'enrich 请求失败：请确认 serve 已启动（' + ENRICH_API + '）';
      }
    }

    function render() {
      if (!DECK.length) {
        el.word.textContent = '没有可学的词';
        el.prev.disabled = true;
        el.next.disabled = true;
        return;
      }
      i = Math.max(0, Math.min(i, DECK.length - 1));
      const p = DECK[i];
      document.title = p.word + ' @ ' + p.song_name;
      el.badge.textContent = p.precision + ' · ' + formatClock(p.t_ms);
      el.counter.textContent = (i + 1) + ' / ' + DECK.length;
      el.word.textContent = p.word;
      el.gloss.textContent = p.gloss || '（词典暂无释义）';
      el.meta.textContent = p.artist + ' — ' + p.song_name;
      el.line.innerHTML = highlight(p.line, p.word);
      el.lineZh.textContent = p.line_zh || '';
      el.prev.disabled = i <= 0;
      el.next.disabled = i >= DECK.length - 1;

      if (p.audioUrl) {
        el.audioWrap.hidden = false;
        el.fallback.innerHTML = '';
        el.audio.src = p.audioUrl;
        const t = (Number(p.t_ms) || 0) / 1000;
        el.audio.onloadedmetadata = () => { el.audio.currentTime = t; el.audio.play().catch(()=>{}); };
      } else {
        el.audioWrap.hidden = true;
        el.audio.removeAttribute('src');
        const clock = formatClock(p.t_ms);
        el.fallback.innerHTML =
          '<p>当前没有可直链音源。你可以：</p>' +
          '<p><a href="' + esc(p.neteaseWeb) + '" target="_blank" rel="noreferrer">在网易云网页打开这首歌</a>，手动拖到约 <strong>' + clock + '</strong>。</p>';
      }

      enrichCurrent();
    }

    function go(delta) {
      const n = i + delta;
      if (n < 0 || n >= DECK.length) return;
      i = n;
      render();
    }

    el.prev.addEventListener('click', () => go(-1));
    el.next.addEventListener('click', () => go(1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === ' ' && DECK[i]) {
        e.preventDefault();
        window.open(DECK[i].neteaseWeb, '_blank', 'noopener');
      }
    });

    render();
  </script>
</body>
</html>`;
}
