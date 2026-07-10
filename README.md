# Song Vocab Agent（最小可跑原型）

用喜欢的欧美歌手歌词 ∩ 六级词表，点生词跳到歌曲时间点学习。  
设计说明见 [`docs/song-vocab-agent-canvas.md`](../../docs/song-vocab-agent-canvas.md)。

## 你需要什么

- **Node.js 18+**
- Live 建库：本机 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（`http://127.0.0.1:3000`）
- 深度语义：项目根目录 `.env`（DeepSeek，勿提交、勿发到聊天）

本项目本身无需 `npm install`（零依赖）。

## DeepSeek `.env`

在 `workspace/song-vocab-agent/.env`：

```env
OPENAI_API_KEY=sk-你的密钥
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

## 推荐用法（释义 + 双语 + 深度语义）

```bash
# 1) api-enhanced 已在 3000 端口运行时，按歌单建库（含网易云译文对齐）
node cli.js build --artist "Kanye West" --songs-file data/playlists/kanye_v1.txt

# 2) 启动学习页（读 .env，翻词自动生成「在这首歌里」）
node cli.js serve --artist "Kanye West"
# 浏览器打开 http://127.0.0.1:8787/learn
```

学习页包含：

- 六级词典释义  
- 英文歌词行 + 中文对照（网易云 tlyric，缺则由 DeepSeek 补）  
- 「在这首歌里」深度语义（DeepSeek，缓存到 `out/enrich/`）  
- 上一个 / 下一个，时间显示为 `1:54`  

## Demo（不连网易云 / 可不配 Key）

```bash
node cli.js build --demo --artist "Kanye West"
node cli.js learn --demo
```

## 产物

- `data/cet6_glossary.json` — 六级释义  
- `out/kanye_west_cet6_index.json` — 词库（含 `line_zh`）  
- `out/enrich/*.json` — 深度语义缓存  
- `out/player/learn.html` — 静态页备份  

## 和课程的对应

| 概念 | 这里落在哪 |
|------|------------|
| Ch.01–03 tools | build / enrich / play |
| Ch.04 context | enrich prompt：词+行+歌名+词典义 → story |
| Ch.13 connectors | api-enhanced、DeepSeek |
| Ch.22 canvas | `docs/song-vocab-agent-canvas.md` |

## 自用与版权

仅供个人学习实验。不要分发歌词/音轨；API Key 只放本机 `.env`。
