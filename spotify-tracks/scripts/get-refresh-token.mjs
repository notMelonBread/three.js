// 初回だけ実行する: ブラウザで Spotify にログインして refresh token を取得する。
//
//   node scripts/get-refresh-token.mjs
//
// 事前に Spotify Developer Dashboard でアプリを作り、Redirect URI に
//   http://127.0.0.1:8888/callback
// を登録しておくこと(localhost ではなく 127.0.0.1)。

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  AUTHORIZE_URL,
  exchangeCode,
  loadDotenv,
  requireEnv,
} from "./spotify-auth.mjs";

loadDotenv();
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = requireEnv(
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
);

const PORT = Number(process.env.SPOTIFY_AUTH_PORT || 8888);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
// user-top-read: Top Tracks / user-library-read: 保存したアルバム・曲
// playlist-read-private, playlist-read-collaborative: 自分のプレイリスト(非公開・共同も)
const SCOPES = "user-top-read user-library-read playlist-read-private playlist-read-collaborative";
const state = randomBytes(12).toString("hex");

const authUrl = new URL(AUTHORIZE_URL);
authUrl.search = new URLSearchParams({
  client_id: SPOTIFY_CLIENT_ID,
  response_type: "code",
  redirect_uri: REDIRECT_URI,
  scope: SCOPES,
  state,
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const finish = (status, message) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
    server.close();
  };
  try {
    if (url.searchParams.get("state") !== state) throw new Error("state が一致しません");
    const error = url.searchParams.get("error");
    if (error) throw new Error(`Spotify から拒否されました: ${error}`);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("code がありません");

    const token = await exchangeCode(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, code, REDIRECT_URI);
    console.log("\n取得できました。以下を .env / GitHub Secrets に設定してください:\n");
    console.log(`SPOTIFY_REFRESH_TOKEN=${token.refresh_token}\n`);
    finish(200, "OK! このタブは閉じて大丈夫です。ターミナルに戻ってください。");
  } catch (error) {
    console.error(error.message);
    finish(400, `失敗: ${error.message}`);
    process.exitCode = 1;
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("ブラウザで次の URL を開いて Spotify にログインしてください:\n");
  console.log(authUrl.toString());
  console.log(`\n(${REDIRECT_URI} で待ち受け中...)`);
});
