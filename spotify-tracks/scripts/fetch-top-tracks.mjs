// 月間トップ曲を Spotify から取得して data/YYYY-MM.json と data/index.json を書き出す。
//
//   node scripts/fetch-top-tracks.mjs                 # 先月分として保存
//   node scripts/fetch-top-tracks.mjs --month 2026-08 # 月を指定
//   node scripts/fetch-top-tracks.mjs --time-range medium_term
//
// Spotify の "Top Tracks" (short_term ≒ 直近 4 週間) を使うので、
// 月初に実行すると「先月いっぱい聞いた曲」になる。

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { getAccessToken, loadDotenv, requireEnv } from "./spotify-auth.mjs";

loadDotenv();
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = requireEnv(
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REFRESH_TOKEN",
);

const { values: args } = parseArgs({
  options: {
    month: { type: "string" },
    "time-range": { type: "string", default: "short_term" },
    limit: { type: "string", default: process.env.TRACK_LIMIT || "20" },
    out: { type: "string", default: "data" },
  },
});

function previousMonthKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthKey = args.month || previousMonthKey();
if (!/^\d{4}-\d{2}$/.test(monthKey)) {
  console.error(`--month は YYYY-MM 形式で指定してください: ${monthKey}`);
  process.exit(1);
}
const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
const outDir = resolve(process.cwd(), args.out);

// 20 曲で 7x7 = 49 マスをぴったり埋める: large 1 / medium 7 / small 12
function sizeFor(index, total) {
  const mediumCount = Math.max(0, Math.min(total - 1, Math.floor((41 - total) / 3)));
  if (index === 0) return "large";
  if (index <= mediumCount) return "medium";
  return "small";
}

function pickImage(images) {
  // 300px 前後のものがあればそれ、無ければ一番大きいもの
  const sorted = (images || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return sorted.find((img) => (img.width || 0) >= 300) || sorted.at(-1) || null;
}

async function fetchTopTracks(accessToken) {
  const url = new URL("https://api.spotify.com/v1/me/top/tracks");
  url.search = new URLSearchParams({ time_range: args["time-range"], limit: String(limit) });
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`top tracks request failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.items || [];
}

async function writeIndex() {
  const files = await readdir(outDir);
  const months = files
    .map((file) => file.match(/^(\d{4}-\d{2})\.json$/)?.[1])
    .filter(Boolean)
    .sort()
    .reverse();
  await writeFile(resolve(outDir, "index.json"), `${JSON.stringify({ months }, null, 2)}\n`);
  return months;
}

async function main() {
  const accessToken = await getAccessToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN);
  const items = await fetchTopTracks(accessToken);

  const tracks = items.map((item, i) => ({
    rank: i + 1,
    id: item.id,
    name: item.name,
    artist: (item.artists || []).map((a) => a.name).join(", "),
    album: item.album?.name || "",
    image_url: pickImage(item.album?.images)?.url || "",
    spotify_url: item.external_urls?.spotify || "",
    size: sizeFor(i, items.length),
  }));

  await mkdir(outDir, { recursive: true });
  const payload = {
    month: monthKey,
    time_range: args["time-range"],
    generated_at: new Date().toISOString(),
    tracks,
  };
  await writeFile(resolve(outDir, `${monthKey}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  const months = await writeIndex();

  console.log(`${monthKey}: ${tracks.length} 曲を書き出しました (${outDir})`);
  console.log(`index.json: ${months.join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
