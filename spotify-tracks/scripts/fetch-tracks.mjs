// Spotify から曲(またはアルバム)の一覧を取得して data/<name>.json と data/index.json を書き出す。
//
//   node scripts/fetch-tracks.mjs                                  # 今ポピュラーな曲(ログイン不要)
//   node scripts/fetch-tracks.mjs --query "genre:j-pop year:2026" --query "genre:anime year:2026"
//   node scripts/fetch-tracks.mjs --source top --month 2026-08     # 自分の Top Tracks(聴取履歴ベース)
//   node scripts/fetch-tracks.mjs --source playlist --id <URL|ID>  # プレイリストの曲順
//   node scripts/fetch-tracks.mjs --source artist --id <URL|ID>    # アーティストのアルバム/シングル
//   node scripts/fetch-tracks.mjs --source saved-albums            # 自分が保存したアルバム
//   node scripts/fetch-tracks.mjs --source saved-tracks            # 自分の「お気に入りの曲」
//
// 共通オプション:
//   --limit N    曲数(最大 49。20 で 7x7 がぴったり埋まる)
//   --name KEY   出力ファイル名 data/KEY.json(省略時は自動)
//   --label TEXT 画面に出す見出し(省略時はプレイリスト名など)
//   --time-range short_term|medium_term|long_term  (top のみ)
//   --query TEXT --market CC --pool N              (popular のみ。--query は複数回指定できる。既定は
//                                                   year:<今年> と genre 別の数パターン、JP、候補 40 件)
//
// --id には URL (https://open.spotify.com/playlist/xxxx?si=...)、URI (spotify:playlist:xxxx)、
// 生の ID のどれを渡してもよい。
//
// 必要な認証情報:
//   popular / artist            … SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET だけでよい(ログイン不要)
//   top / saved-* / playlist    … 上に加えて SPOTIFY_REFRESH_TOKEN(get-refresh-token.mjs で取得)

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { getAccessToken, getClientCredentialsToken, loadDotenv, requireEnv } from "./spotify-auth.mjs";
import { formatMonth } from "../layout.js";

loadDotenv();
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = requireEnv("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET");
// refresh token は「自分のデータ」(top / saved-*) にだけ必要。playlist / artist は無くても取れる。
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN || "";

const { values: args } = parseArgs({
  options: {
    source: { type: "string", default: "popular" },
    query: { type: "string", multiple: true },
    market: { type: "string", default: "JP" },
    pool: { type: "string", default: "40" },
    id: { type: "string" },
    month: { type: "string" },
    name: { type: "string" },
    label: { type: "string" },
    "time-range": { type: "string", default: "short_term" },
    limit: { type: "string", default: process.env.TRACK_LIMIT || "20" },
    out: { type: "string", default: "data" },
  },
});

const MAX_ITEMS = 49; // 7x7
const limit = Math.min(MAX_ITEMS, Math.max(1, Number(args.limit) || 20));
const outDir = resolve(process.cwd(), args.out);
const API = "https://api.spotify.com/v1";

// ---------- ユーティリティ ----------

function previousMonthKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// URL / URI / 生 ID のどれからでも ID を取り出す
function parseSpotifyId(input, type) {
  if (!input) {
    console.error(`--id に ${type} の URL か ID を指定してください`);
    process.exit(1);
  }
  const fromUrl = input.match(new RegExp(`open\\.spotify\\.com/(?:[a-z-]+/)?${type}/([A-Za-z0-9]+)`));
  if (fromUrl) return fromUrl[1];
  const fromUri = input.match(new RegExp(`^spotify:${type}:([A-Za-z0-9]+)$`));
  if (fromUri) return fromUri[1];
  if (/^[A-Za-z0-9]+$/.test(input)) return input;
  console.error(`${type} の ID として解釈できません: ${input}`);
  process.exit(1);
}

function safeFileName(text) {
  return String(text).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}

// 7x7 = 49 マスに収まるように large / medium / small を割り振る。
// 20 曲なら large 1 / medium 7 / small 12 でぴったり。
function sizeFor(index, total) {
  const largeCount = total <= 41 ? 1 : 0;
  const rest = total - largeCount;
  const mediumCount = Math.max(0, Math.min(rest, Math.floor((MAX_ITEMS - 9 * largeCount - rest) / 3)));
  if (index < largeCount) return "large";
  if (index < largeCount + mediumCount) return "medium";
  return "small";
}

function pickImage(images) {
  // 300px 前後のものがあればそれ、無ければ一番大きいもの
  const sorted = (images || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return sorted.find((img) => (img.width || 0) >= 300) || sorted.at(-1) || null;
}

function trackToItem(track) {
  return {
    id: track.id,
    name: track.name,
    artist: (track.artists || []).map((a) => a.name).join(", "),
    album: track.album?.name || "",
    image_url: pickImage(track.album?.images)?.url || "",
    spotify_url: track.external_urls?.spotify || "",
  };
}

function albumToItem(album) {
  return {
    id: album.id,
    name: album.name,
    artist: (album.artists || []).map((a) => a.name).join(", "),
    album: album.name,
    image_url: pickImage(album.images)?.url || "",
    spotify_url: album.external_urls?.spotify || "",
  };
}

// ---------- Spotify API ----------

let accessToken = "";

async function api(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hint = explainApiError(path, response.status, json);
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(json)}${hint ? `\n→ ${hint}` : ""}`);
  }
  return json;
}

// 2026 年の開発モード制限で出やすいエラーに補足を付ける
function explainApiError(path, status, json) {
  const message = json?.error?.message || "";
  if (status === 400 && /invalid limit/i.test(message)) {
    return "limit が上限を超えています(検索は最大 10)。";
  }
  if (status === 403 && path.includes("/playlists/")) {
    return "開発モードのアプリは自分のプレイリストしか読めません。他人のプレイリストや旧 /tracks エンドポイントは 403 になります。";
  }
  if (status === 404 && path.includes("/playlists/")) {
    return "Spotify 公式(編集部/アルゴリズム)のプレイリストは開発モードのアプリから見えません。";
  }
  if (status === 401) {
    return "トークンが無効です。Client ID / Secret / Refresh Token を確認してください。";
  }
  if (status === 403 && /premium/i.test(message)) {
    return "開発モードのアプリはオーナーが Spotify Premium である必要があります。";
  }
  return "";
}

// ページングしながら最大 limit 件集める
async function collect(path, params, mapItem) {
  const items = [];
  let offset = 0;
  while (items.length < limit) {
    const page = await api(path, { ...params, limit: Math.min(50, limit - items.length), offset });
    for (const raw of page.items || []) {
      const item = mapItem(raw);
      if (item) items.push(item);
    }
    if (!page.next || (page.items || []).length === 0) break;
    offset += page.items.length;
  }
  return items.slice(0, limit);
}

const sources = {
  // 今ポピュラーな曲。Spotify 公式のチャート系プレイリストは開発モードのアプリから取れないので、
  // 検索で候補を集める。2026 年の開発モード制限で、検索は 1 回あたり数件しか返らず、
  // popularity フィールドも返らない(常に 0)ことがある。そのため:
  //   - offset を進めながら、新しい曲が出なくなるまでページングする
  //   - クエリを複数用意して(--query を複数回指定可)、足りなければ次のクエリに進む
  //   - 順位は popularity があればそれ、無ければ検索結果の並び(Spotify 側の関連度順)
  async popular() {
    const year = new Date().getUTCFullYear();
    const queries = args.query?.length
      ? args.query
      : [`year:${year}`, `year:${year} genre:j-pop`, `year:${year} genre:pop`, `year:${year} genre:hip-hop`, `year:${year - 1}`];
    const market = args.market;
    const pageSize = 10; // 2026 年 2 月以降の上限
    const poolSize = Math.max(limit, Math.min(200, Number(args.pool) || 40));
    const seen = new Set();
    const pool = [];

    for (const query of queries) {
      if (pool.length >= poolSize) break;
      for (let offset = 0; offset < 200 && pool.length < poolSize; offset += pageSize) {
        let json;
        try {
          json = await api("/search", { q: query, type: "track", market, limit: pageSize, offset });
        } catch (error) {
          if (pool.length === 0) throw error;
          console.warn(`search "${query}" offset=${offset} で中断: ${error.message}`);
          break;
        }
        const page = json.tracks?.items || [];
        let added = 0;
        for (const track of page) {
          if (!track?.id) continue;
          // 同じ曲の別エディション(Deluxe 版など)を除く
          const key = `${track.name}|${track.artists?.[0]?.name || ""}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          pool.push({ ...trackToItem(track), popularity: track.popularity ?? 0 });
          added += 1;
        }
        console.log(`search "${query}" offset=${offset}: ${page.length} 件 (新規 ${added}, 累計 ${pool.length})`);
        // 空ページ、または新しい曲が出なくなったらこのクエリは終わり
        if (page.length === 0 || added === 0) break;
      }
    }

    if (pool.length < limit) {
      console.warn(`候補が ${pool.length} 件しか集まりませんでした(目標 ${limit} 件)。--query を追加してみてください。`);
    }
    // popularity が取れていれば降順、全部 0 なら検索順のまま(sort は安定)
    pool.sort((a, b) => b.popularity - a.popularity);
    return { name: "popular", label: "Popular", meta: { queries, market }, items: pool.slice(0, limit) };
  },

  // 聴取履歴から Spotify が出す Top Tracks(short_term ≒ 直近 4 週間)
  async top() {
    const month = args.month || previousMonthKey();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month は YYYY-MM 形式で指定してください: ${month}`);
    const json = await api("/me/top/tracks", { time_range: args["time-range"], limit });
    return {
      name: month,
      label: formatMonth(month),
      month,
      meta: { time_range: args["time-range"] },
      items: (json.items || []).map(trackToItem),
    };
  },

  // プレイリストの曲を並び順のまま。
  // 2026 年 3 月以降、開発モードのアプリが中身を読めるのは「ログインした本人のプレイリスト」だけ
  // (他人のは metadata のみ、Spotify 公式のは 404)。エンドポイントも /tracks から /items に変わった。
  async playlist() {
    const id = parseSpotifyId(args.id, "playlist");
    const info = await api(`/playlists/${id}`, { fields: "name,external_urls,owner(display_name)" });
    const items = await collect(
      `/playlists/${id}/items`,
      { fields: "next,items(item(id,name,artists(name),album(name,images),external_urls))" },
      (row) => {
        const track = row.item || row.track; // 旧形式が返っても拾う
        return track && track.id ? trackToItem(track) : null; // ローカルファイル等は除外
      },
    );
    if (items.length === 0) {
      throw new Error(
        `プレイリスト "${info.name}" の中身が取れませんでした。開発モードのアプリでは自分のプレイリストしか読めません` +
          `(SPOTIFY_REFRESH_TOKEN を設定し、自分が作ったプレイリストを指定してください)。`,
      );
    }
    return { name: `playlist-${id}`, label: info.name, meta: { playlist_url: info.external_urls?.spotify }, items };
  },

  // アーティストのアルバム / シングルをリリース順(新しい順)で。
  // 開発モードのアプリではカタログ系の制限で失敗することがある(Extended Quota Mode が必要)。
  async artist() {
    const id = parseSpotifyId(args.id, "artist");
    const info = await api(`/artists/${id}`);
    const seen = new Set();
    const items = await collect(
      `/artists/${id}/albums`,
      { include_groups: "album,single", market: "from_token" },
      (album) => {
        const key = album.name.toLowerCase();
        if (seen.has(key)) return null; // 同名の別リージョン版を除外
        seen.add(key);
        return albumToItem(album);
      },
    );
    return { name: `artist-${id}`, label: info.name, meta: { artist_url: info.external_urls?.spotify }, items };
  },

  // 自分が保存したアルバム(新しく保存した順)
  async "saved-albums"() {
    const items = await collect("/me/albums", {}, (row) => (row.album ? albumToItem(row.album) : null));
    return { name: "saved-albums", label: "Saved Albums", items };
  },

  // 自分の「お気に入りの曲」(新しく保存した順)
  async "saved-tracks"() {
    const items = await collect("/me/tracks", {}, (row) => (row.track ? trackToItem(row.track) : null));
    return { name: "saved-tracks", label: "Liked Songs", items };
  },
};

// ---------- index.json ----------

async function writeIndex() {
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".json") && f !== "index.json");
  const entries = [];
  for (const file of files) {
    try {
      const data = JSON.parse(await readFile(resolve(outDir, file), "utf8"));
      const key = file.replace(/\.json$/, "");
      entries.push({
        file: key,
        label: data.label || (data.month ? formatMonth(data.month) : key),
        month: data.month || null,
        generated_at: data.generated_at || "",
      });
    } catch (error) {
      console.warn(`${file} を読み飛ばしました: ${error.message}`);
    }
  }
  // 月ものを新しい順に先、それ以外は生成日時の新しい順
  entries.sort((a, b) => {
    if (a.month && b.month) return b.month.localeCompare(a.month);
    if (a.month) return -1;
    if (b.month) return 1;
    return b.generated_at.localeCompare(a.generated_at);
  });
  const slim = entries.map(({ file, label, month }) => ({ file, label, month }));
  await writeFile(resolve(outDir, "index.json"), `${JSON.stringify({ entries: slim }, null, 2)}\n`);
  return slim;
}

// ---------- main ----------

async function main() {
  const fetchSource = sources[args.source];
  if (!fetchSource) {
    console.error(`--source は ${Object.keys(sources).join(" | ")} のどれかです: ${args.source}`);
    process.exit(1);
  }

  const needsUser = ["top", "saved-albums", "saved-tracks", "playlist"].includes(args.source);
  if (SPOTIFY_REFRESH_TOKEN) {
    accessToken = await getAccessToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN);
  } else if (needsUser) {
    console.error(`--source ${args.source} は自分のアカウントのデータなので SPOTIFY_REFRESH_TOKEN が必要です。`);
    console.error("node scripts/get-refresh-token.mjs で取得するか、--source popular を使ってください。");
    process.exit(1);
  } else {
    accessToken = await getClientCredentialsToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
  }
  const result = await fetchSource();

  if (result.items.length === 0) {
    console.error("取得できた曲が 0 件でした。");
    process.exit(1);
  }

  const tracks = result.items.map((item, i) => ({
    rank: i + 1,
    ...item,
    size: sizeFor(i, result.items.length),
  }));

  const name = safeFileName(args.name || result.name);
  const payload = {
    source: args.source,
    label: args.label || result.label,
    month: result.month || null,
    ...result.meta,
    generated_at: new Date().toISOString(),
    tracks,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  const entries = await writeIndex();

  console.log(`${name}.json: "${payload.label}" ${tracks.length} 件を書き出しました (${outDir})`);
  console.log(`index.json: ${entries.map((e) => e.file).join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
