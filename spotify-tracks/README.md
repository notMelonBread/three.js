# NOW POPULAR

Spotify で今人気の曲のジャケットを、ジャンルごと(J-POP / K-POP / 洋楽)にコラージュして見せる静的サイト。
HTML / CSS / JavaScript だけで作ってあり、HTML/CSS を学び始めて 1 年未満の人に教える前提で書いてある。
**作り方の解説は [LESSON.md](LESSON.md)。**

公開: https://profound-toffee-8a9ee7.netlify.app

```
spotify-tracks/
├── index.html / style.css / script.js   サイト本体(ライブラリなし)
├── imgs/                                銀色のステッカー画像(Figma のデザインから)
├── data/
│   ├── index.json                       ページの一覧(scripts が生成)
│   └── popular-<genre>.json             ジャンルごとの曲一覧(scripts が生成)
├── scripts/
│   ├── fetch-tracks.mjs                 Spotify から取得して data/ に JSON を書く
│   ├── get-refresh-token.mjs            top / saved-* / playlist を使うときだけ: ログインして refresh token を取る
│   └── spotify-auth.mjs                 共通処理
└── LESSON.md                            教える用の解説
.github/workflows/spotify-tracks.yml     毎週 jpop,kpop,western を自動取得して data/ をコミット
```

## デザイン

Figma の「オリジナルサイト」(node 41-186)と、それを HTML 構造に合わせて整理した「Fri_On-Original」(page naro の `index.html (SP 480)` フレーム)をもとにしている。

- スマホ幅(480px)の縦長 1 カラム。PC でも真ん中に同じ形で出す。
- 背景ピンク `#ff4c85`、文字は白のドット文字。デザインのフォント AB-megadot9 は商用フォントなので、Google Fonts の DotGothic16 で代用。
- 各ジャンルは「飾りのステッカー → コラージュ → `h2` `h3` `p`」の順。Figma の青い `h2` `h3` `p` `img` の注記はタグの指定。
- コラージュは 5 列の CSS grid に正方形を並べ、1 枚ずつ `scale(1.25)` と `translate` で少しずらし、`z-index` を無作為にして重ねる。外側のマスは外側にずらさず、`transform-origin` で内側にだけ広がるので、**全部枠の中に収まり、隙間もできない**。
- おすすめカードは Figma どおり back number / なとり / スピッツ の 3 組。`scripts/fetch-artists.mjs` が名前で検索し、各アーティストのいちばん人気の曲のジャケットとアーティストページのリンクを `data/artists.json` に書く(`--name` で差し替え可。ワークフローの `artists` 入力も同じ)。
- メインビジュアルは Figma のキービジュアル(`imgs/main-visual.jpg`、9:16)。タイトル「MUSIC INTRO」は画像内にあるので `h1 > img` にして `alt` で文字を持たせる。高さは画面いっぱい(`100svh`)、幅は下の section と同じ 480px で、`object-fit: cover` で収める。
- 各ジャンルのコラージュはメインビジュアルと同じ「横幅いっぱい × 9:16」(480 × 864、5 列 × 9 行)。ステッカーの位置・幅・回転は Figma の座標(横幅 480、section 高さ 1040 基準)を % にしたもので、縦位置の % が効くように `.genre` は `aspect-ratio: 480 / 1040` に固定している。
- おすすめカードの矢印は FLIP(前の位置を覚えて並び替え、差分を transform で戻してから transition で 0 にする)で、端のカードが反対側へ回り込むように動く。
- 背景のピンクは `body` に塗ってあるので、PC でも画面の端まで広がる。

## データの作り方(先生側)

必要なのは Spotify アプリの Client ID と Client Secret だけ(ログイン不要)。

1. https://developer.spotify.com/dashboard でアプリを作る(Redirect URI は `http://127.0.0.1:8888/callback` を入れておけばよい。2025 年以降、開発モードのアプリ作成には Premium アカウントが必要)。
2. GitHub のリポジトリ → Settings → Secrets and variables → Actions に `SPOTIFY_CLIENT_ID` と `SPOTIFY_CLIENT_SECRET` を登録。
3. Actions タブ → "Update Spotify tracks" → "Run workflow"。`genres` 欄にカンマ区切りで並べた順にページができる(既定 `jpop,kpop,western`)。毎週月曜 09:30 JST にも自動で更新される。

手元で作るなら:

```sh
cd spotify-tracks
cp .env.example .env      # CLIENT_ID / CLIENT_SECRET を書く
node scripts/fetch-tracks.mjs --genre jpop --order 1
node scripts/fetch-tracks.mjs --genre kpop --order 2
node scripts/fetch-tracks.mjs --genre western --order 3
python3 -m http.server 8000   # http://localhost:8000/ で確認(fetch を使うので file:// では動かない)
```

- `--genre` は `jpop` `kpop` `western` `pop` `hiphop` `rock` `anime`(表は `fetch-tracks.mjs` の `GENRES`)。`--order` がページの並び順。
- `--limit` は既定 45(5 列 × 9 行で、Figma のコラージュとほぼ同じ縦横比)。`index.html` の `data-file` と JSON のファイル名を合わせる。
- 同梱の JSON はサンプル(色板)。実行すると上書きされる。
- `--source top` / `saved-tracks` / `playlist` など自分のアカウントのデータを使うものは `SPOTIFY_REFRESH_TOKEN` が必要(`get-refresh-token.mjs` で取得)。

### 2026 年の Spotify API 制限(開発モードのアプリ)

- 検索の `limit` は最大 10。`popularity` は返らない。`popular` はキーワード検索を複数回まわして集め、検索結果の並び順をランクにしている。
- `genre:` の絞り込みが効かないジャンル(K-POP など)はキーワード検索で代替している。
- プレイリストの中身は本人のものしか読めない。新譜 API などは廃止。アプリのオーナーは Premium 必須。

## データ形式

`data/index.json`:

```json
{ "entries": [ { "file": "popular-jpop", "label": "J-POP", "month": null, "order": 1 } ] }
```

`data/popular-jpop.json`:

```json
{
  "source": "popular", "label": "J-POP", "order": 1, "genre": "jpop",
  "generated_at": "2026-10-09T08:08:00.000Z",
  "tracks": [
    { "rank": 1, "id": "…", "name": "曲名", "artist": "アーティスト", "album": "アルバム",
      "image_url": "https://i.scdn.co/image/…", "spotify_url": "https://open.spotify.com/track/…", "popularity": 0, "size": "small" }
  ]
}
```

## 表示上の注意

ジャケット画像とメタデータは Spotify API から取得したものを、Spotify の開発者規約の範囲で表示している。
画像は Spotify の CDN (`i.scdn.co`) から直接読み込み、リポジトリには保存しない。各タイルは Spotify へリンクし、ページ下部に Spotify のクレジットを出す。
