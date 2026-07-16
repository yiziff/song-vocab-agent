/**
 * Offline song tagging: Spotify audio features + Last.fm tags → JSON.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchTrack as spotifySearch, getAudioFeatures, isSpotifyConfigured } from "./spotify.js";
import { searchTrack as lastfmSearch, getTrackTags, isLastfmConfigured } from "./lastfm.js";
import { normalizeSongQuery } from "./learnSong.js";
import { artistSlug } from "./rank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const TAGS_DIR = path.join(ROOT, "data", "song_tags");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function tagsFilePath(artist, top = 50) {
  return path.join(TAGS_DIR, `${artistSlug(artist)}_top${Number(top) || 50}.json`);
}

export function loadSongTags(artist, top = 50) {
  const file = tagsFilePath(artist, top);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function loadSongTagsFromDir(artist, top = 50) {
  return loadSongTags(artist, top);
}

/** Clean song name for external search. */
export function cleanSongName(name) {
  let s = normalizeSongQuery(name);
  s = s
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || normalizeSongQuery(name);
}

/**
 * Derive boolean tags from Spotify audio features.
 */
export function deriveTagsFromAudio(audio) {
  if (!audio || typeof audio !== "object") {
    return {
      mellow: false,
      energetic: false,
      melodic: false,
      slow: false,
      mood_calm: false,
    };
  }
  const energy = Number(audio.energy) || 0;
  const tempo = Number(audio.tempo) || 0;
  const danceability = Number(audio.danceability) || 0;
  const instrumentalness = Number(audio.instrumentalness) || 0;
  const acousticness = Number(audio.acousticness) || 0;

  const mellow = energy < 0.45 && tempo < 115;
  const energetic = energy > 0.7;
  const melodic = danceability > 0.5 && instrumentalness < 0.4;
  const slow = tempo < 95;
  const mood_calm = mellow || (energy < 0.4 && acousticness > 0.25);

  return { mellow, energetic, melodic, slow, mood_calm };
}

/**
 * Merge Last.fm tag strings into boolean flags.
 */
export function deriveTagsFromLastfm(lastfmTags) {
  const tags = (lastfmTags || []).map((t) => String(t).toLowerCase());
  const has = (...words) => tags.some((t) => words.some((w) => t.includes(w)));
  return {
    mood_calm: has("chill", "mellow", "slow", "calm", "soft", "relax"),
    melodic_hint: has("beautiful", "melodic", "melody", "ballad"),
    energetic_hint: has("energetic", "party", "upbeat", "dance"),
  };
}

function tagsZh(tags) {
  const out = [];
  if (tags.mellow || tags.mood_calm) out.push("偏舒缓");
  if (tags.energetic) out.push("偏躁动");
  if (tags.melodic || tags.melodic_hint) out.push("旋律线明显");
  if (tags.slow) out.push("节奏偏慢");
  return out;
}

function pickAudioFields(features) {
  if (!features) return null;
  return {
    energy: Number(features.energy) || 0,
    valence: Number(features.valence) || 0,
    tempo: Number(features.tempo) || 0,
    acousticness: Number(features.acousticness) || 0,
    danceability: Number(features.danceability) || 0,
    instrumentalness: Number(features.instrumentalness) || 0,
    loudness: Number(features.loudness) || 0,
  };
}

function confidenceFromMatch(spotifyOk, lastfmOk, durationOk) {
  if (spotifyOk && lastfmOk && durationOk !== false) return "high";
  if (spotifyOk || lastfmOk) return durationOk === false ? "low" : "medium";
  return "none";
}

/**
 * Tag a list of ranking songs.
 * @param {{ artist: string, songs: Array, top?: number, force?: boolean, delayMs?: number, onProgress?: Function }} opts
 */
export async function tagSongsForArtist(opts) {
  const artist = opts.artist;
  const songs = opts.songs || [];
  const top = Number(opts.top) || 50;
  const force = Boolean(opts.force);
  const delayMs = Number(opts.delayMs) || 200;
  const onProgress = opts.onProgress || (() => {});

  const spotifyOn = isSpotifyConfigured();
  const lastfmOn = isLastfmConfigured();
  if (!spotifyOn && !lastfmOn) {
    throw new Error(
      "请至少配置 SPOTIFY_CLIENT_ID+SPOTIFY_CLIENT_SECRET 或 LASTFM_API_KEY"
    );
  }

  const existing = force ? null : loadSongTags(artist, top);
  const songsMap = { ...(existing?.songs || {}) };

  let matched = 0;
  let lowConfidence = 0;
  let failed = 0;
  let skipped = 0;

  const slice = songs.slice(0, top);

  for (let i = 0; i < slice.length; i++) {
    const song = slice[i];
    const songId = String(song.song_id || "");
    const songName = song.song_name || "";
    if (!songId || !songName) {
      failed++;
      continue;
    }

    if (!force && songsMap[songId]?.match?.confidence === "high") {
      skipped++;
      onProgress({ i, total: slice.length, songName, status: "skip" });
      continue;
    }

    const clean = cleanSongName(songName);
    let spotifyTrack = null;
    let audio = null;
    let lastfmTrack = null;
    let lastfmTags = [];
    let durationOk = true;

    try {
      if (spotifyOn) {
        spotifyTrack = await spotifySearch(artist, clean);
        await sleep(delayMs);
        if (spotifyTrack?.id) {
          const features = await getAudioFeatures(spotifyTrack.id);
          audio = pickAudioFields(features);
          await sleep(delayMs);
          const refDur = Number(song.duration_ms) || 0;
          if (refDur > 0 && spotifyTrack.duration_ms > 0) {
            const ratio =
              Math.abs(spotifyTrack.duration_ms - refDur) / refDur;
            if (ratio > 0.15) durationOk = false;
          }
        }
      }
    } catch (e) {
      onProgress({
        i,
        total: slice.length,
        songName,
        status: "spotify_error",
        error: String(e.message || e),
      });
    }

    try {
      if (lastfmOn) {
        lastfmTrack = await lastfmSearch(artist, clean);
        await sleep(delayMs);
        if (lastfmTrack) {
          lastfmTags = await getTrackTags(
            lastfmTrack.artist || artist,
            lastfmTrack.name || clean,
            lastfmTrack.mbid
          );
          await sleep(delayMs);
        }
      }
    } catch (e) {
      onProgress({
        i,
        total: slice.length,
        songName,
        status: "lastfm_error",
        error: String(e.message || e),
      });
    }

    const fromAudio = deriveTagsFromAudio(audio);
    const fromLf = deriveTagsFromLastfm(lastfmTags);
    const tags = {
      mellow: fromAudio.mellow || fromLf.mood_calm,
      energetic: fromAudio.energetic || fromLf.energetic_hint,
      melodic: fromAudio.melodic || fromLf.melodic_hint,
      slow: fromAudio.slow,
      mood_calm: fromAudio.mood_calm || fromLf.mood_calm,
      melodic_hint: fromLf.melodic_hint || false,
    };

    const conf = confidenceFromMatch(
      Boolean(spotifyTrack?.id),
      Boolean(lastfmTrack),
      durationOk
    );

    if (conf === "none") failed++;
    else if (conf === "low") lowConfidence++;
    else matched++;

    songsMap[songId] = {
      song_name: songName,
      song_id: songId,
      artist: song.artist || artist,
      match: {
        spotify_track_id: spotifyTrack?.id || null,
        spotify_name: spotifyTrack?.name || null,
        lastfm_mbid: lastfmTrack?.mbid || null,
        lastfm_name: lastfmTrack?.name || null,
        confidence: conf,
        duration_ok: durationOk,
      },
      audio,
      lastfm_tags: lastfmTags,
      tags,
      tags_zh: tagsZh(tags),
    };

    onProgress({
      i,
      total: slice.length,
      songName,
      status: conf,
      tags: tags_zh_preview(tags),
    });
  }

  const doc = {
    artist,
    top,
    built_at: new Date().toISOString(),
    source: "hybrid_spotify_lastfm",
    spotify_configured: spotifyOn,
    lastfm_configured: lastfmOn,
    stats: {
      total: slice.length,
      matched,
      low_confidence: lowConfidence,
      failed,
      skipped,
    },
    songs: songsMap,
  };

  fs.mkdirSync(TAGS_DIR, { recursive: true });
  const outFile = tagsFilePath(artist, top);
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2), "utf8");
  return { doc, outFile };
}

function tags_zh_preview(tags) {
  return tagsZh(tags).join(",") || "-";
}
