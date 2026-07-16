/**
 * Spotify Web API client (Client Credentials).
 * Used offline by tag-songs — not during coach chat.
 */

import { spotifyConfig } from "./env.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

let cachedToken = null;
let tokenExpiresAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAccessToken() {
  const cfg = spotifyConfig();
  if (!cfg.configured) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET 未配置");
  }
  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) {
    return cachedToken;
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    "base64"
  );
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

async function spotifyGet(path, query = {}) {
  const token = await getAccessToken();
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After") || 2);
    await sleep(retry * 1000);
    return spotifyGet(path, query);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify ${url.pathname} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Search for a track by artist + song name.
 * @returns {{ id, name, artists, duration_ms } | null}
 */
export async function searchTrack(artist, songName) {
  const q = `track:${songName} artist:${artist}`;
  const data = await spotifyGet("/search", {
    q,
    type: "track",
    limit: 5,
  });
  const items = data?.tracks?.items || [];
  if (!items.length) return null;
  const artistLower = String(artist || "").toLowerCase();
  const songLower = String(songName || "").toLowerCase();
  let best = items[0];
  for (const t of items) {
    const names = (t.artists || []).map((a) => String(a.name || "").toLowerCase());
    const title = String(t.name || "").toLowerCase();
    if (
      names.some((n) => n.includes(artistLower) || artistLower.includes(n)) &&
      (title.includes(songLower) || songLower.includes(title.split(" - ")[0]))
    ) {
      best = t;
      break;
    }
  }
  return {
    id: best.id,
    name: best.name,
    artists: (best.artists || []).map((a) => a.name),
    duration_ms: Number(best.duration_ms) || 0,
  };
}

/**
 * @param {string} trackId
 * @returns {object | null} audio features
 */
export async function getAudioFeatures(trackId) {
  if (!trackId) return null;
  try {
    return await spotifyGet(`/audio-features/${trackId}`);
  } catch {
    return null;
  }
}

export function isSpotifyConfigured() {
  return spotifyConfig().configured;
}
