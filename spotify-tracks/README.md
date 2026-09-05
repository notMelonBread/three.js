# spotify-tracks

Spotify から取ってきた曲やアルバムのジャケットを、7×7 のコラージュで並べる静的サイト。
[k4nkan/track-memory](https://github.com/k4nkan/track-memory) のレイアウトを参考にしつつ、
データ取得を Spotify Web API 直叩きにして DB なしで動くようにしたもの。

取れるもの(`--source`):

| source | 内容 | 並び順 |
|---|---|---|
| `popular`(既定) | 今ポピュラーな曲。検索で集めて Spotify の popularity で並べる | popularity 順 |
| `top` | 聴取履歴から Spotify が出す Top Tracks(直近およそ 4 週間) | よく聴いた順 |
| `playlist` | 任意のプレイリスト(自分のでも他人の公開でも) | プレイリストの曲順 |
| `artist` | アーティストのアルバム / シングル | リリースが新しい順 |
| `saved-albums` | 自分が保存したアルバム | 保存が新しい順 |
| `saved-tracks` | 自分の「お気に入りの曲」 | 保存が新しい順 |

```
spotify-tracks/
├── index.html / main.js              3D 版(デフォルト。three.js でジャケットを CD ケースにして並べる)
├── grid.html / style.css / grid.js   2D 版(素の HTML + CSS Grid + JS)
├── layout.js                         7x7 の配置アルゴリズム(2D / 3D 共用)
├── data/
│   ├── index.json                    表示するページの一覧(スクリプトが生成)
│   └── <name>.json                   ページごとの曲一覧(スクリプトが生成)
└── scripts/
    ├── get-refresh-token.mjs         初回だけ: ブラウザでログインして refresh token を取る
    ├── fetch-tracks.mjs              Spotify から取得して data/ に JSON を書く
    └── spotify-auth.mjs              共通処理
.github/workflows/spotify-tracks.yml  毎週 popular を自動取得して data/ をコミット(手動実行で他の source も可)
```

依存パッケージはなし。Node 22 以上で動く。

## レイアウトの仕組み

- 7×7 = 49 マスの CSS Grid。
- 20 曲を 1 位 → 3×3、2〜8 位 → 2×2、9〜20 位 → 1×1 にすると 9 + 28 + 12 = 49 でぴったり埋まる。
- 大きいタイルから順に「置ける場所を全部列挙 → シャッフルして 1 つ選ぶ」で配置。詰まったらやり直し(最大 200 回)。
- 3×3 をど真ん中 (3,3) には置かない。
- 月ごとのセクションは `scroll-snap` で 1 画面ずつ、`IntersectionObserver` で見えたときに JSON を読む。

## 3D 版 (index.html)

同じ 7x7 の配置を three.js で 3D 空間に置いたもの。1 曲 = 1 枚の CD ジュエルケース。

- `BoxGeometry` を 3 枚重ねてケースにしている: 透明プラスチックの外側 (`MeshPhysicalMaterial`、clearcoat + 半透明)、中の黒いトレイ、前面にだけジャケットを貼った紙 (`BoxGeometry` に 6 面分のマテリアル配列を渡し、前面だけ `map` を差す)。
- ジャケットは `TextureLoader` で Spotify の CDN から直接読む (`crossOrigin = "anonymous"`)。読めなかったときはランクと曲名を描いた `CanvasTexture` に落ちる。
- 映り込みは `RoomEnvironment` + `PMREMGenerator` の環境マップ。
- カーソルの位置をグリッドの面 (z=0) に投影し、そこを頂点にしたガウス関数 `exp(-r²/R²)` で周囲のケースを持ち上げる。傾きはその斜面(勾配)に沿わせるので、面がカーソルの下で盛り上がっているように見える。
- `Raycaster` でカーソル直下のケースを判定してキャプションを出し、クリックで Spotify を開く(ドラッグと区別するため移動量で判定)。
- `OrbitControls` で回せる範囲を狭めに制限。グリッド全体が収まるカメラ距離は画面サイズから計算する。
- 月の切り替えは、今のケースを奥に飛ばしてから次の月を手前に飛ばしてくる。← → キーでも切り替え可。

three.js は既存の練習ファイルと同じく importmap で CDN (`three@0.175.0`) から読む。

## セットアップ

必要なものは取得元によって違う。

| 取得元 | 必要なもの |
|---|---|
| `popular` / `artist` | Spotify アプリの Client ID と Client Secret だけ(手順 1 のみ) |
| `top` / `saved-albums` / `saved-tracks` / `playlist` | 上に加えて、自分でログインして取る refresh token(手順 2 も) |

### 2026 年の Spotify API 制限(開発モードのアプリ)

2026 年 2〜3 月の変更で、開発モードのアプリにはかなり制限がかかっている。このツールに関係するもの:

- 検索 (`GET /search`) の `limit` は最大 10(以前は 50)。`popular` は 10 件ずつページングして候補を集める。
- プレイリストの中身は **ログインした本人のプレイリストだけ** 読める。他人のプレイリストはメタデータのみ、Spotify 公式のプレイリスト(Top 50 など)は 404。エンドポイントも `/tracks` から `/items` に変わった。
- 新譜 (`/browse/new-releases`)、アーティストの人気曲、他ユーザーのプロフィールとプレイリスト一覧などは廃止。
- アプリのオーナーは Spotify Premium である必要がある。1 開発者につきアプリ 1 つ、利用ユーザーは 5 人まで。
- Client Credentials(ログインなしのトークン)はカタログ系から段階的に外されている。`popular` が通らなくなったら、refresh token を設定してユーザートークンで叩くようにする(スクリプトは refresh token があればそちらを優先する)。

Extended Quota Mode(組織向け、MAU 25 万以上)のアプリはこれらの影響を受けないが、個人では申請できない。


### 最短ルート(今ポピュラーな曲を GitHub Actions から取る)

1. 手順 1 で Spotify アプリを作る(Redirect URI の登録は不要)。
2. GitHub のリポジトリ → Settings → Secrets and variables → Actions に `SPOTIFY_CLIENT_ID` と `SPOTIFY_CLIENT_SECRET` を登録する。
3. Actions タブ → "Update Spotify tracks" → "Run workflow" で、ブランチを選んでそのまま実行する(source は `popular` が既定)。
4. 成功すると `data/popular.json` がコミットされ、Netlify が自動で再デプロイする。以後は毎週月曜に自動更新(デフォルトブランチの場合)。

`popular` は Spotify の検索 API で今年の曲を候補として集め(10 件ずつ、既定 100 件)、各曲の popularity(0-100)で並べ替えたもの。
Spotify 公式の「Top 50」などのチャートプレイリストは開発モードのアプリからは取れないための代替。
`--query` で検索条件を変えられる(例: `"genre:j-pop year:2026"`、`"year:2020-2026"`)。`--market` は既定 `JP`、`--pool` で候補数を変えられる(最大 200)。

### 1. Spotify のアプリを作る

1. https://developer.spotify.com/dashboard でアプリを作成。
2. Client ID と Client Secret を控える。
3. refresh token も取るなら、Redirect URI に `http://127.0.0.1:8888/callback` を追加しておく(`localhost` は今は使えない)。

### 2. refresh token を取る(top / saved-* を使うときだけ、初回のみ)

```sh
cd spotify-tracks
cp .env.example .env   # CLIENT_ID / CLIENT_SECRET を書く
node scripts/get-refresh-token.mjs
```

表示された URL をブラウザで開いてログインすると、ターミナルに `SPOTIFY_REFRESH_TOKEN=...` が出るので `.env` に追記する。
要求するスコープは `user-top-read`(Top Tracks)、`user-library-read`(保存したアルバム・曲)、`playlist-read-private` と `playlist-read-collaborative`(自分のプレイリスト)。スコープを変えたら取り直す。

### 3. データを作る

```sh
# 今ポピュラーな曲(ログイン不要)
node scripts/fetch-tracks.mjs
node scripts/fetch-tracks.mjs --query "genre:j-pop year:2026"

# 聴取履歴ベース(先月の Top Tracks / 月を指定。refresh token が必要)
node scripts/fetch-tracks.mjs --source top
node scripts/fetch-tracks.mjs --source top --month 2026-08

# その他
node scripts/fetch-tracks.mjs --source playlist --id "https://open.spotify.com/playlist/xxxx"
node scripts/fetch-tracks.mjs --source artist --id "https://open.spotify.com/artist/xxxx" --limit 30
node scripts/fetch-tracks.mjs --source saved-albums
node scripts/fetch-tracks.mjs --source saved-tracks --name likes --label "Liked Songs"
```

- `--id` は URL、`spotify:playlist:...` 形式の URI、生の ID のどれでもよい。
- `--limit` は最大 49(7×7)。20 だとぴったり埋まり、それ以外は空きマスが出るか 1 マスの比率が増える。
- `--name` で出力ファイル名、`--label` で画面の見出しを変えられる。
- 実行すると `data/<name>.json` が書かれ、`data/index.json` が `data/` の中身から作り直される。並びは月ものが新しい順、それ以外は生成が新しい順。
- 2D 版・3D 版とも同じ JSON を読む。同梱の `popular.json` はサンプルなので、実行すると上書きされる。
- ページが 1 つだけのときは見出しと ← → を出さない。2 つ以上あると切り替え UI が出る。
- `playlist` で中身が取れるのは自分が作った(または共同編集している)プレイリストだけ。他人のプレイリストや Spotify 公式のプレイリストは取れない。

### 4. ローカルで見る

`fetch` を使うので `file://` では動かない。何かで配信する。

```sh
python3 -m http.server 8000
# http://localhost:8000/        3D 版
# http://localhost:8000/grid.html  2D 版
```

### 5. 自動更新する(GitHub Actions)

リポジトリの Settings → Secrets and variables → Actions に登録する。

- `SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET`(必須)
- `SPOTIFY_REFRESH_TOKEN`(top / saved-* を使うときだけ)

毎週月曜 09:30 JST に `popular` を更新して `data/` にコミットする(スケジュール実行はデフォルトブランチでのみ動く)。
Actions タブの "Run workflow" からは取得元・URL・件数を指定して任意のブランチで手動実行できる。
公開は GitHub Pages や Netlify で `spotify-tracks/` を配信すればよい(リポジトリ直下の `netlify.toml` で設定済み)。

## データ形式

`data/index.json`:

```json
{ "entries": [ { "file": "popular", "label": "Popular", "month": null } ] }
```

`data/<name>.json`(`month` は `top` のときだけ、`popularity` は `popular` のときだけ):

```json
{
  "source": "popular",
  "label": "Popular",
  "query": "year:2026",
  "market": "JP",
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
      "popularity": 92,
      "size": "large"
    }
  ]
}
```

## 元サイトとの違い

- 元は再生履歴を GitHub Actions で定期収集して Supabase に貯め、再生回数で月間ランキングを出している。
- こちらは Spotify Web API を直接叩くだけ。月間ものは Top Tracks (`time_range=short_term`、直近およそ 4 週間) を月初に 1 回取る。DB 不要だが、再生回数そのものは出ない。
- 再生回数ベースにしたくなったら、`user-read-recently-played` で直近 50 曲を数時間おきに取り続ける仕組み(元サイトの save-spotify-logs 方式)に差し替える。

## 表示上の注意

ジャケット画像とメタデータは Spotify API から取得したものを、Spotify の開発者規約の範囲で表示している。
画像は Spotify の CDN (`i.scdn.co`) から直接読み込み、リポジトリには保存しない。
各タイルは Spotify へリンクし、画像の上に文字や加工を重ねない。ページ下部に Spotify のクレジットを出す。
