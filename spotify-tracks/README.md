# spotify-tracks

自分の Spotify の「月間いっぱい聞いた曲」を、7×7 のコラージュで並べる静的サイト。
[k4nkan/track-memory](https://github.com/k4nkan/track-memory) のレイアウトを参考に、
データ取得を Spotify の Top Tracks API に置き換えて DB なしで動くようにしたもの。

```
spotify-tracks/
├── index.html / style.css / app.js   フロント(素の HTML + CSS Grid + JS、ビルド不要)
├── data/
│   ├── index.json                    月の一覧
│   └── YYYY-MM.json                  月ごとのトップ曲(スクリプトが生成)
└── scripts/
    ├── get-refresh-token.mjs         初回だけ: ブラウザでログインして refresh token を取る
    ├── fetch-top-tracks.mjs          Top Tracks を取得して data/ に JSON を書く
    └── spotify-auth.mjs              共通処理
.github/workflows/spotify-tracks.yml  毎月 1 日に自動実行して data/ をコミット
```

依存パッケージはなし。Node 22 以上で動く。

## レイアウトの仕組み

- 7×7 = 49 マスの CSS Grid。
- 20 曲を 1 位 → 3×3、2〜8 位 → 2×2、9〜20 位 → 1×1 にすると 9 + 28 + 12 = 49 でぴったり埋まる。
- 大きいタイルから順に「置ける場所を全部列挙 → シャッフルして 1 つ選ぶ」で配置。詰まったらやり直し(最大 200 回)。
- 3×3 をど真ん中 (3,3) には置かない。
- 月ごとのセクションは `scroll-snap` で 1 画面ずつ、`IntersectionObserver` で見えたときに JSON を読む。

## セットアップ

### 1. Spotify のアプリを作る

1. https://developer.spotify.com/dashboard でアプリを作成。
2. Redirect URI に `http://127.0.0.1:8888/callback` を追加(`localhost` は今は使えない)。
3. Client ID と Client Secret を控える。

### 2. refresh token を取る(初回だけ)

```sh
cd spotify-tracks
cp .env.example .env   # CLIENT_ID / CLIENT_SECRET を書く
node scripts/get-refresh-token.mjs
```

表示された URL をブラウザで開いてログインすると、ターミナルに `SPOTIFY_REFRESH_TOKEN=...` が出るので `.env` に追記する。

### 3. データを作る

```sh
node scripts/fetch-top-tracks.mjs                  # 先月分
node scripts/fetch-top-tracks.mjs --month 2026-08  # 月を指定
```

`data/2026-08.json` と `data/index.json` が更新される。同梱の `2026-08.json` はサンプルなので、実行すると上書きされる。

### 4. ローカルで見る

`fetch` を使うので `file://` では動かない。何かで配信する。

```sh
python3 -m http.server 8000
# http://localhost:8000/
```

### 5. 毎月自動更新する(GitHub Actions)

リポジトリの Settings → Secrets and variables → Actions に次の 3 つを登録する。

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

毎月 1 日 09:30 JST に先月分を生成して `data/` にコミットする。Actions タブから手動実行(月指定も可)もできる。
公開は GitHub Pages や Netlify で `spotify-tracks/` を配信すればよい。

## データ形式

```json
{
  "month": "2026-08",
  "time_range": "short_term",
  "generated_at": "2026-09-01T00:30:00.000Z",
  "tracks": [
    {
      "rank": 1,
      "id": "...",
      "name": "曲名",
      "artist": "アーティスト",
      "album": "アルバム",
      "image_url": "https://i.scdn.co/image/...",
      "spotify_url": "https://open.spotify.com/track/...",
      "size": "large"
    }
  ]
}
```

## 元サイトとの違い

- 元は再生履歴を GitHub Actions で定期収集して Supabase に貯め、再生回数で月間ランキングを出している。
- こちらは Spotify の Top Tracks (`time_range=short_term`、直近およそ 4 週間) を月初に 1 回取るだけ。DB 不要だが、再生回数そのものは出ない。
- 再生回数ベースにしたくなったら、`user-read-recently-played` で直近 50 曲を数時間おきに取り続ける仕組み(元サイトの save-spotify-logs 方式)に差し替える。

## 表示上の注意

ジャケット画像とメタデータは Spotify API から取得したものを、Spotify の開発者規約の範囲で表示している。
画像は Spotify の CDN (`i.scdn.co`) から直接読み込み、リポジトリには保存しない。
各タイルは Spotify へリンクし、画像の上に文字や加工を重ねない。ページ下部に Spotify のクレジットを出す。
