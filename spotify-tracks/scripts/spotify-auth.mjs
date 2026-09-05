// 共通: .env 読み込みと Spotify トークン周り(依存パッケージなし)

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const TOKEN_URL = "https://accounts.spotify.com/api/token";
export const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";

export function loadDotenv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (error) {
    console.warn(`.env を読み込めませんでした: ${error.message}`);
  }
}

export function requireEnv(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`環境変数が足りません: ${missing.join(", ")}`);
    console.error(".env.example をコピーして .env を作るか、環境変数を設定してください。");
    process.exit(1);
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function basicAuth(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function postToken(clientId, clientSecret, params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`token request failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

export function exchangeCode(clientId, clientSecret, code, redirectUri) {
  return postToken(clientId, clientSecret, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

// ユーザーのログインなしで取れるトークン(公開プレイリスト、アーティスト情報など)。
// Top Tracks や保存したアルバムなど「自分の」データには使えない。
export async function getClientCredentialsToken(clientId, clientSecret) {
  const json = await postToken(clientId, clientSecret, { grant_type: "client_credentials" });
  return json.access_token;
}

export async function getAccessToken(clientId, clientSecret, refreshToken) {
  const json = await postToken(clientId, clientSecret, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return json.access_token;
}
