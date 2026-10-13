// おすすめアーティスト(ページ下の 3 枚のカード)のデータを Spotify から取って data/artists.json に書き出す。
//
//   node scripts/fetch-artists.mjs                                   # 既定: back number / なとり / スピッツ
//   node scripts/fetch-artists.mjs --name "back number" --name "YOASOBI" --name "SPITZ"
//
// 名前で検索して、いちばん近いアーティストの代表曲のジャケットと、
// アーティストの Spotify ページへのリンクを保存する。ログイン不要(client credentials)。
// (開発モードのアプリでは /artists/{id}/top-tracks が 403 になるので、曲は search で探す)

import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { getClientCredentialsToken, loadDotenv, requireEnv } from "./spotify-auth.mjs";

loadDotenv();
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = requireEnv("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET");

const { values: args } = parseArgs({
  options: {
    name: { type: "string", multiple: true },
    market: { type: "string", default: "JP" },
    out: { type: "string", default: "data" },
  },
});

const names = args.name?.length ? args.name : ["back number", "なとり", "スピッツ"];
const API = "https://api.spotify.com/v1";
const accessToken = await getClientCredentialsToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);

async function api(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

function pickImage(images) {
  const sorted = (images || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return sorted.find((img) => (img.width || 0) >= 300) || sorted.at(-1) || null;
}

const normalize = (s) => s.toLowerCase().replace(/\s+/g, "");

async function findArtist(name) {
  const json = await api("/search", { q: name, type: "artist", market: args.market, limit: 10 });
  const found = json.artists?.items || [];
  if (found.length === 0) return null;
  // 名前が完全に同じものがあればそれ、無ければ検索の 1 件目
  return found.find((a) => normalize(a.name) === normalize(name)) || found[0];
}

// そのアーティストの曲を検索して 1 曲目(検索順 ≒ 人気順)を返す
async function findTrack(artist) {
  const json = await api("/search", { q: `artist:"${artist.name}"`, type: "track", market: args.market, limit: 10 });
  const tracks = json.tracks?.items || [];
  return tracks.find((t) => (t.artists || []).some((a) => a.id === artist.id)) || tracks[0] || null;
}

const artists = [];
for (const name of names) {
  try {
    const artist = await findArtist(name);
    if (!artist) {
      console.warn(`"${name}" は見つかりませんでした`);
      continue;
    }
    const track = await findTrack(artist);
    artists.push({
      name, // 画面に出す名前は、指定したとおり(Spotify では "SPITZ" のように英語表記のことがある)
      spotify_name: artist.name,
      spotify_url: artist.external_urls?.spotify || "",
      image_url: pickImage(track?.album?.images)?.url || pickImage(artist.images)?.url || "",
      track: track ? { name: track.name, spotify_url: track.external_urls?.spotify || "" } : null,
    });
    console.log(`${name} → ${artist.name}: ${track?.name || "(曲なし)"}`);
  } catch (error) {
    console.warn(`"${name}" の取得に失敗: ${error.message}`);
  }
}

if (artists.length === 0) {
  console.error("アーティストが 1 組も取得できませんでした。");
  process.exit(1);
}

const outDir = resolve(args.out);
await mkdir(outDir, { recursive: true });
await writeFile(
  resolve(outDir, "artists.json"),
  `${JSON.stringify({ generated_at: new Date().toISOString(), artists }, null, 2)}\n`,
);
console.log(`artists.json: ${artists.length} 組を書き出しました (${outDir})`);
