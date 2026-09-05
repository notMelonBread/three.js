# spotify-tracks

Spotify から取ってきた曲やアルバムのジャケットを、7×7 のコラージュで並べる静的サイト。
[k4nkan/track-memory](https://github.com/k4nkan/track-memory) のレイアウトを参考にしつつ、
データ取得を Spotify Web API 直叩きにして DB なしで動くようにしたもの。

取れるもの(`--source`):

| source | 内容 | 並び順 |
|---|---|---|
| `top`(既定) | 聴取履歴から Spotify が出す Top Tracks(直近およそ 4 週間) | よく聴いた順 |
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
.github/workflows/spotify-tracks.yml  毎月 1 日に Top Tracks を自動取得して data/ をコミット
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
要求するスコープは `user-top-read`(Top Tracks)、`user-library-read`(保存したアルバム・曲)、`playlist-read-private`(非公開プレイリスト)。スコープを変えたら取り直す。

### 3. データを作る

```sh
# 聴取履歴ベース(先月の Top Tracks / 月を指定)
node scripts/fetch-tracks.mjs
node scripts/fetch-tracks.mjs --month 2026-08

# 履歴に関係なく取る
node scripts/fetch-tracks.mjs --source playlist --id "https://open.spotify.com/playlist/xxxx"
node scripts/fetch-tracks.mjs --source artist --id "https://open.spotify.com/artist/xxxx" --limit 30
node scripts/fetch-tracks.mjs --source saved-albums
node scripts/fetch-tracks.mjs --source saved-tracks --name likes --label "Liked Songs"
```

- `--id` は URL、`spotify:playlist:...` 形式の URI、生の ID のどれでもよい。
- `--limit` は最大 49(7×7)。20 だとぴったり埋まり、それ以外は空きマスが出るか 1 マスの比率が増える。
- `--name` で出力ファイル名、`--label` で画面の見出しを変えられる。
- 実行すると `data/<name>.json` が書かれ、`data/index.json` が `data/` の中身から作り直される。並びは月ものが新しい順、それ以外は生成が新しい順。
- 2D 版・3D 版とも同じ JSON を読む。同梱の `2026-08.json` はサンプルなので、実行すると上書きされる。
- Spotify 公式のエディトリアル / アルゴリズム系プレイリスト(Today's Top Hits など)は 2024 年 11 月以降、開発モードのアプリからは取れない。自分や他ユーザーが作ったプレイリストは取れる。

### 4. ローカルで見る

`fetch` を使うので `file://` では動かない。何かで配信する。

```sh
python3 -m http.server 8000
# http://localhost:8000/        3D 版
# http://localhost:8000/grid.html  2D 版
```

### 5. 毎月自動更新する(GitHub Actions)

リポジトリの Settings → Secrets and variables → Actions に次の 3 つを登録する。

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

毎月 1 日 09:30 JST に先月分を生成して `data/` にコミットする。Actions タブから手動実行(月指定も可)もできる。
公開は GitHub Pages や Netlify で `spotify-tracks/` を配信すればよい。

## データ形式

`data/index.json`:

```json
{ "entries": [ { "file": "2026-08", "label": "2026年8月", "month": "2026-08" } ] }
```

`data/<name>.json`(`month` は `top` のときだけ):

```json
{
  "source": "top",
  "label": "2026年8月",
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
- こちらは Spotify Web API を直接叩くだけ。月間ものは Top Tracks (`time_range=short_term`、直近およそ 4 週間) を月初に 1 回取る。DB 不要だが、再生回数そのものは出ない。
- 再生回数ベースにしたくなったら、`user-read-recently-played` で直近 50 曲を数時間おきに取り続ける仕組み(元サイトの save-spotify-logs 方式)に差し替える。

## 表示上の注意

ジャケット画像とメタデータは Spotify API から取得したものを、Spotify の開発者規約の範囲で表示している。
画像は Spotify の CDN (`i.scdn.co`) から直接読み込み、リポジトリには保存しない。
各タイルは Spotify へリンクし、画像の上に文字や加工を重ねない。ページ下部に Spotify のクレジットを出す。
