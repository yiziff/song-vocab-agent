# Song Vocab Agent（最小可跑原型）
![Uploading image.png…]()

用喜欢的欧美歌手歌词 ∩ 四级/六级词表（可切换），点生词跳到歌曲时间点学习。  
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

# 2) 启动学习页（默认可在页内切换四级 / 六级 / 全部）
node cli.js serve --artist "Kanye West"
# 或启动时就指定等级：
node cli.js serve --artist "Kanye West" --level cet4
node cli.js serve --artist "Kanye West" --level cet6
# 浏览器打开 http://127.0.0.1:8787/learn
```

学习页包含：

- **词表等级**：顶部切换「四级 / 六级 / 四级+六级」（基于同一歌单词库过滤，不必重建）  
- **方式 A · 网页搜词**：输入生词 → 直接查当前等级下的索引（不经模型）  
- **方式 B · AI 聊天**：人话提问 → 模型调用 tool `find_word_in_songs` → 用人话回答（练 Ch.01）  
- 学习卡片：词典释义、中英歌词、「在这首歌里」（enrich 缓存）、上一个/下一个  
- 同一核心函数：`lib/findWord.js` → `findWordInSongs`  

## Demo（不连网易云 / 可不配 Key）

```bash
node cli.js build --demo --artist "Kanye West"
node cli.js learn --demo
```

## 产物

- `data/cet4_words.txt` / `cet6_words.txt` — 四、六级词表（建库取并集；学习时按等级过滤）  
- `data/cet46_glossary.json` — 四六级合并释义（另有分册 `cet4_glossary.json` / `cet6_glossary.json`）  
- `out/kanye_west_cet6_index.json` — 歌单词库索引（含四级+六级命中；文件名沿用旧后缀）  
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
