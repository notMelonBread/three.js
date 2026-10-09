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

## 見た目とレイアウト

スマホの縦横比(幅 : 高さ = 9 : 19.5)の縦長カラムを画面中央に置き、PC でもスマホと同じ形で見せる。スマホではカラムを画面いっぱいに広げる。外側は `chrome.css` / `chrome.js` で 2D 版・3D 版共通(右上に他方へのリンク、Spotify のクレジット、カラム左上にジャンル名、下端にキャプション、右端にページ送りの丸)。

**ジャンルごとに 1 ページ。** `data/index.json` の順(J-POP → K-POP …)に縦に並び、スクロール(2D 版はスナップスクロール、3D 版はホイール・縦スワイプ・矢印キー・右の丸)で 1 ページずつ送る。

コラージュの配置は 2D 版と 3D 版で同じ `collageFill()`(`layout.js`)を使う。単位が違うだけ(2D はピクセル、3D はワールド座標)。

- **すべてのタイルは同じ大きさ。** 面積の合計がカラムの `density`(既定 1.7)倍になる大きさにするので、必ず重なる。
- 置く位置は候補を複数試し、「まだ覆われていない面積」を一番多く覆うものから選ぶ(候補の半分は未被覆のマスを含む位置から作る)。傾けない。**すべてのタイルは枠の内側に収まる**。
- 配置後に全タイルを同じ比率(`grow`、既定 4%)で拡大し、接しているだけの細い隙間を閉じる。
- **長方形は必ず埋まる。** 残った穴は細かい格子で探し、そのマスを含む位置に同じ大きさのタイルを一番下の層に足す(40 曲で平均 6 枚前後。下位の曲を繰り返す)。被覆判定はマスの矩形がタイルの和集合で完全に覆われているかを厳密に計算する。
- 重なったタイルは相手の 1 つ上の層に乗る(2D は z-index、3D は z 座標)。上に乗られてほとんど隠れた曲は最前面に引き上げる。
- カーソル位置に中心が一番近いタイルが一番上に来て浮き上がる。タッチでは 1 回目のタップで浮き、浮いているものをもう一度タップすると Spotify を開く。
- 2D 版はシード付き乱数で、リサイズしても同じ配置を再現する。
- 旧来の 7×7 グリッド配置(`layout()` / `assignSizes()`)と、隙間を許す `collageLayout()` も `layout.js` に残してある。

## 3D 版 (index.html)

three.js で、厚みのある板にジャケットを貼って貼り集めたもの。配置は上の「見た目とレイアウト」のとおり。

- 板は `BoxGeometry` に 6 面分のマテリアル配列を渡し、前面だけ `map` を差す。照明は使わず `MeshBasicMaterial` で画像の色をそのまま出す。
- ジャケットは `TextureLoader` で Spotify の CDN から直接読む (`crossOrigin = "anonymous"`)。読めなかったときはランクと曲名を描いた `CanvasTexture` に落ちる。
- カメラは枠の長方形にぴったり合わせる(z=0 の面で高さ 8 がちょうど画面に収まる距離)。回すと枠の外が見えるので回転・ズームは無し。奥行きは浮き上がりと遠近で出す。
- ジャンルのページは y 方向に `PAGE_PITCH` ずつずらして全部シーンに置き、カメラの y をページに合わせてなめらかに動かす。
- `Raycaster` と z=0 平面との交点でカーソル位置を求め、中心が一番近い板を最前面の層より手前に浮かせる。周囲はごくわずかに持ち上がる。
- 何も動いていないフレームは `renderer.render` を呼ばない。
- 以前のガラス表現(`MeshPhysicalMaterial` の transmission)と画質の自動切り替えは廃止した。

three.js は既存の練習ファイルと同じく importmap で CDN (`three@0.175.0`) から読む。

## セットアップ

必要なものは取得元によって違う。

| 取得元 | 必要なもの |
|---|---|
| `popular` / `artist` | Spotify アプリの Client ID と Client Secret だけ(手順 1 のみ) |
| `top` / `saved-albums` / `saved-tracks` / `playlist` | 上に加えて、自分でログインして取る refresh token(手順 2 も) |

### 2026 年の Spotify API 制限(開発モードのアプリ)

2026 年 2〜3 月の変更で、開発モードのアプリにはかなり制限がかかっている。このツールに関係するもの:

- 検索 (`GET /search`) の `limit` は最大 10(以前は 50)。実際には 1 回あたり 5 件程度しか返らず、`popularity` フィールドも 0 になる。`popular` は複数クエリと offset で候補を集める。
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

`--genre` は `jpop`, `kpop`, `pop`, `hiphop`, `rock`, `anime` から選ぶ(表は `fetch-tracks.mjs` の `GENRES`。クエリ・見出し・ファイル名 `popular-<genre>.json` が決まる)。Actions の "Run workflow" では `genres` 欄にカンマ区切りで並べた順にページができる(既定 `jpop,kpop`)。

`popular` は Spotify の検索 API で今年の曲を候補として集めたもの。Spotify 公式の「Top 50」などのチャートプレイリストは開発モードのアプリからは取れないための代替。
開発モードでは検索が 1 回あたり数件しか返らず、`popularity` も返らない(常に 0)ので、offset を進めつつ複数のクエリ(既定: `year:今年`、`year:今年 genre:j-pop`、`genre:pop`、`genre:hip-hop`、`year:去年`)で候補を積み上げ、順位は検索結果の並び順(Spotify 側の関連度順)をそのまま使う。
`--query` は複数回指定でき、与えると既定のクエリ群の代わりになる(例: `--query "genre:j-pop year:2026" --query "genre:anime year:2026"`)。`--market` は既定 `JP`、`--pool` で候補数を変えられる(既定 40、最大 200)。

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
# ジャンル別(ログイン不要)。--order がページの並び順になる
node scripts/fetch-tracks.mjs --genre jpop --order 1
node scripts/fetch-tracks.mjs --genre kpop --order 2
# 総合、または検索条件を直接指定
node scripts/fetch-tracks.mjs
node scripts/fetch-tracks.mjs --query "genre:j-pop year:2026" --query "genre:anime year:2026" --name jpop-anime --label "J-POP / ANIME" --order 3

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
- `--limit` は既定 40、最大 49。3D 版は何件でもよい。2D 版(7×7)は 20 でぴったり埋まり、それ以外は空きマスが出るか 1 マスの比率が増える。
- `--name` で出力ファイル名、`--label` で画面の見出しを変えられる。
- 実行すると `data/<name>.json` が書かれ、`data/index.json` が `data/` の中身から作り直される。並びは `--order` 指定のあるものがその順、次に月ものが新しい順、それ以外は生成が新しい順。
- 2D 版・3D 版とも同じ JSON を読む。同梱の `popular-jpop.json` / `popular-kpop.json` はサンプル(色板)なので、実行すると上書きされる。
- ページが 1 つだけのときは右端のページ送りを出さない。
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

毎週月曜 09:30 JST に `jpop,kpop` の 2 ページを更新して `data/` にコミットする(スケジュール実行はデフォルトブランチでのみ動く)。
Actions タブの "Run workflow" からは取得元・URL・件数を指定して任意のブランチで手動実行できる。
公開は GitHub Pages や Netlify で `spotify-tracks/` を配信すればよい(リポジトリ直下の `netlify.toml` で設定済み)。

## データ形式

`data/index.json`:

```json
{ "entries": [ { "file": "popular-jpop", "label": "J-POP", "month": null, "order": 1 }, { "file": "popular-kpop", "label": "K-POP", "month": null, "order": 2 } ] }
```

`data/<name>.json`(`month` は `top` のときだけ、`popularity` は `popular` のときだけ):

```json
{
  "source": "popular",
  "label": "J-POP",
  "order": 1,
  "genre": "jpop",
  "queries": ["genre:j-pop year:2026", "genre:j-pop year:2025", "genre:japanese year:2026"],
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
