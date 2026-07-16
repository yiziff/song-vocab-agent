import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

/** Load workspace/song-vocab-agent/.env into process.env (does not override existing). */
export function loadEnv(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
  return true;
}

export function llmConfig() {
  loadEnv();
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseURL = (process.env.OPENAI_BASE_URL || "https://api.deepseek.com").replace(
    /\/$/,
    ""
  );
  const model = process.env.OPENAI_MODEL || "deepseek-chat";
  return { apiKey, baseURL, model, configured: Boolean(apiKey) };
}

/** Spotify Client Credentials — for offline tag-songs. */
export function spotifyConfig() {
  loadEnv();
  const clientId = process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && clientSecret),
  };
}

/** Last.fm API key — for offline tag-songs. */
export function lastfmConfig() {
  loadEnv();
  const apiKey = process.env.LASTFM_API_KEY || "";
  return {
    apiKey,
    configured: Boolean(apiKey),
  };
}
