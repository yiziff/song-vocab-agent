/**
 * Thin client for a local api-enhanced instance.
 * Default: http://127.0.0.1:3000
 */

const DEFAULT_BASE = process.env.NETEASE_API_BASE || "http://127.0.0.1:3000";

async function getJson(base, path, query = {}) {
  const url = new URL(path, base.endsWith("/") ? base : base + "/");
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API ${url.pathname} HTTP ${res.status}`);
  }
  return res.json();
}

export function createNeteaseClient(base = DEFAULT_BASE) {
  return {
    base,

    async searchArtist(keyword) {
      const data = await getJson(base, "/cloudsearch", {
        keywords: keyword,
        type: 100,
        limit: 5,
      });
      const artists = data?.result?.artists || [];
      return artists.map((a) => ({
        id: a.id,
        name: a.name,
        albumSize: a.albumSize,
      }));
    },

    async artistSongs(artistId, limit = 50) {
      // /artist/songs paginates; take first page sized to limit
      const data = await getJson(base, "/artist/songs", {
        id: artistId,
        order: "hot",
        limit,
        offset: 0,
      });
      const songs = data?.songs || data?.hotSongs || [];
      return songs.slice(0, limit).map((s) => ({
        song_id: String(s.id),
        name: s.name,
        artist: (s.ar || s.artists || []).map((x) => x.name).join(", "),
        duration_ms: s.dt ?? s.duration ?? null,
      }));
    },

    async searchSongs(keyword, limit = 30) {
      const data = await getJson(base, "/cloudsearch", {
        keywords: keyword,
        type: 1,
        limit,
      });
      const songs = data?.result?.songs || [];
      return songs.map((s) => ({
        song_id: String(s.id),
        name: s.name,
        artist: (s.ar || s.artists || []).map((x) => x.name).join(", "),
        duration_ms: s.dt ?? s.duration ?? null,
      }));
    },

    async getTimedLyrics(songId) {
      // Prefer /lyric/new for yrc; fall back to /lyric
      let yrc = "";
      let lrc = "";
      let tlyric = "";
      try {
        const neu = await getJson(base, "/lyric/new", { id: songId });
        yrc = neu?.yrc?.lyric || "";
        lrc = neu?.lrc?.lyric || "";
        tlyric = neu?.tlyric?.lyric || "";
      } catch {
        // ignore
      }
      if (!lrc || !tlyric) {
        try {
          const old = await getJson(base, "/lyric", { id: songId });
          if (!lrc) lrc = old?.lrc?.lyric || "";
          if (!tlyric) tlyric = old?.tlyric?.lyric || "";
        } catch {
          // ignore
        }
      }
      return {
        song_id: String(songId),
        lyric_yrc: yrc,
        lyric_lrc: lrc,
        lyric_tlyric: tlyric,
      };
    },

    async songPlayUrl(songId) {
      try {
        const data = await getJson(base, "/song/url/v1", {
          id: songId,
          level: "standard",
        });
        const u = data?.data?.[0]?.url;
        return u || null;
      } catch {
        return null;
      }
    },
  };
}

export async function pingApi(base = DEFAULT_BASE) {
  try {
    const res = await fetch(new URL("/", base.endsWith("/") ? base : base + "/"));
    return res.ok || res.status === 404; // many builds 404 on /
  } catch {
    return false;
  }
}
