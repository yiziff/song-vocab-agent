/**
 * Last.fm API client — track search + tags.
 * Used offline by tag-songs — not during coach chat.
 */

import { lastfmConfig } from "./env.js";

const API_BASE = "https://ws.audioscrobbler.com/2.0/";

async function lastfmGet(method, params = {}) {
  const cfg = lastfmConfig();
  if (!cfg.configured) {
    throw new Error("LASTFM_API_KEY 未配置");
  }
  const url = new URL(API_BASE);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", cfg.apiKey);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Last.fm ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Search track; return best match or null.
 * @returns {{ name, artist, mbid, listeners } | null}
 */
export async function searchTrack(artist, songName) {
  const data = await lastfmGet("track.search", {
    track: songName,
    artist: artist,
    limit: 5,
  });
  const matches = data?.results?.trackmatches?.track;
  const list = Array.isArray(matches) ? matches : matches ? [matches] : [];
  if (!list.length) return null;
  const artistLower = String(artist || "").toLowerCase();
  const songLower = String(songName || "").toLowerCase();
  let best = list[0];
  for (const t of list) {
    const a = String(t.artist || "").toLowerCase();
    const n = String(t.name || "").toLowerCase();
    if (
      (a.includes(artistLower) || artistLower.includes(a)) &&
      (n.includes(songLower) || songLower.includes(n))
    ) {
      best = t;
      break;
    }
  }
  return {
    name: best.name,
    artist: best.artist,
    mbid: best.mbid || "",
    listeners: Number(best.listeners) || 0,
  };
}

/**
 * Get top tags for a track.
 * @returns {string[]} tag names (lowercase)
 */
export async function getTrackTags(artist, songName, mbid = "") {
  const params = mbid
    ? { mbid }
    : { artist, track: songName };
  try {
    const data = await lastfmGet("track.getTopTags", params);
    const tags = data?.toptags?.tag;
    const list = Array.isArray(tags) ? tags : tags ? [tags] : [];
    return list
      .map((t) => String(t.name || "").toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 15);
  } catch {
    return [];
  }
}

export function isLastfmConfigured() {
  return lastfmConfig().configured;
}
