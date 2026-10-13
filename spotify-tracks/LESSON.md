# このサイトの作り方(中学生向けの解説)

Spotify で今人気の曲のジャケットを、ジャンルごとにコラージュして見せるサイトです。
使っているのは **HTML・CSS・JavaScript の 3 つだけ**。ライブラリやフレームワークは使っていません。

```
index.html   ページの「骨組み」。どこに何があるか
style.css    ページの「見た目」。色・大きさ・位置
script.js    ページの「動き」。データを読んでジャケットを並べる、メニューを開く
data/        曲のデータ(JSON ファイル)。先生が用意する
imgs/        銀色のステッカー画像
```

## 1. まず HTML を見てみよう

`index.html` は上から順に、こう並んでいます。

| 場所 | タグ | 中身 |
|---|---|---|
| ① メインビジュアル | `<header class="hero">` | キービジュアルの画像(`h1`)、「メニュー」ボタン |
| ② J-POP | `<section class="genre" id="jpop">` | 飾り、コラージュの箱、見出し、説明 |
| ③ K-POP | `<section class="genre" id="kpop">` | 同じ |
| ④ 洋楽 | `<section class="genre" id="western">` | 同じ |
| ⑤ おすすめ | `<section class="artists">` | 左右の矢印ボタンと 3 枚のカード(back number / なとり / スピッツ。`data/artists.json` から作る) |
| クレジット | `<footer>` | Spotify の表記 |

ポイント:

- ②③④は **まったく同じ形** です。中身の文字と `data-file` だけが違います。同じものは同じ書き方にすると、CSS も JavaScript も 1 回書けばすみます。
- `<div class="collage"></div>` は **空っぽ** です。ジャケットは JavaScript があとから入れます。
- ①だけは `.phone` の **外** にあります。高さを画面いっぱいにしたいからで、幅は `.hero__inner` で同じスマホ幅(480px)にそろえています。
- タイトルの「MUSIC INTRO」は画像の中に描いてあるので、`<h1>` の中に `<img>` を入れ、`alt` に文字を書いています(見えなくても、検索や読み上げには文字として伝わる)。
- `<nav class="menu" hidden>` の `hidden` は「隠す」という意味。ボタンを押したときに JavaScript が外します。
- デザイン(Figma)に青い文字で `h2` `h3` `p` `img` と書いてあったのは、「ここはこのタグで作る」という印です。

## 2. CSS で形を作る

### スマホの形にする

```css
.phone {
  max-width: 480px;  /* スマホの横幅まで */
  padding-top: 48px; /* メインビジュアルとの間の余白 */
  margin: 0 auto;    /* 左右の余白を自動 = 真ん中に */
}
```

PC で開いても、真ん中にスマホと同じ形で出ます。背景のピンクは `body` に塗ってあるので、PC では画面の端まで広がります(印刷で言う「塗り足し」)。

### 画面いっぱいのメインビジュアル

```css
.hero { height: 100vh; }                       /* vh = 画面の高さの 1%。100vh で画面いっぱい */
.hero__inner { max-width: 480px; height: 100%; margin: 0 auto; }
.hero__title img { width: 100%; height: 100%; object-fit: cover; } /* 箱いっぱいに広げて、はみ出しは切る */
```

`object-fit: cover` は「画像をゆがめずに箱いっぱいに広げて、はみ出した分を切る」という意味です。画面の縦横比が画像(9:16)とちがっても、きれいに収まります。

### 飾りを好きな場所に置く(position)

```css
.genre { position: relative; }   /* 親に書く: ここを基準にする */
.sticker { position: absolute; } /* 子に書く: 親の中の好きな場所に置ける */
.sticker--heart { left: 75%; top: 7.1%; width: 26.7%; transform: rotate(14.9deg); }
```

`relative` の親の中で、`absolute` の子は `top / left / right / bottom` で場所を決められます。`left: -13.7%` のようにマイナスにすると、わざと少しはみ出せます。`transform: rotate(14.9deg)` で傾けられます。

### Figma の数字を % にする

Figma の画面はスマホ幅 480 で描いてあります。これをそのまま px にすると、スマホの幅が変わったときにずれるので、**割合(%)** に直します。

```
横の位置・幅 = Figma の数字 ÷ 480 × 100
例: ハートの幅 144 ÷ 480 = 30%
```

縦の位置の `top: ○%` は「親の高さ」に対する割合です。親(section)の高さは中身で変わってしまうので、

```css
.genre { aspect-ratio: 480 / 1040; }  /* 横 : 縦 の比率を固定 */
```

と **Figma と同じ縦横比に固定** しておきます。こうすると `top: 34%` が、どの幅のスマホでも Figma と同じ場所になります。

### 5 列のマス目(grid)

```css
.collage {
  display: grid;
  grid-template-columns: repeat(5, 1fr); /* 同じ幅の列を 5 つ */
}
.tile { aspect-ratio: 1; } /* 正方形 */
```

これだけで、入れた順に左上から 5 列ずつ並びます。マス目だから **隙間ができません**。曲は 45 曲なので 5 列 × 9 行。横幅いっぱい(480px)にすると 1 枚 96px、全体は 480 × 864 で、メインビジュアル(9:16)とほぼ同じ形になります。

### コラージュっぽく見せる(transform)

マス目のままだとただのタイルなので、1 枚ずつ **少し大きくして、少しずらします**。

```css
.tile {
  transform: translate(var(--dx), var(--dy)) scale(1.25);
  z-index: var(--z);
}
```

- `scale(1.25)` … 1.25 倍に大きくする。マスからはみ出して、隣と重なる
- `translate(…)` … ずらす。`--dx` と `--dy` は JavaScript が 1 枚ずつ決める
- `z-index` … 重なり順。大きい数ほど上。これも JavaScript が決める

`var(--dx)` は **CSS の変数** です。JavaScript から `style.setProperty("--dx", "5%")` のように値を入れられます。

### マウスを乗せたら大きく(:hover)

```css
.tile:hover {
  z-index: 100;        /* 一番上に */
  transform: translate(var(--dx), var(--dy)) scale(1.5);
}
```

## 3. JavaScript でデータを入れる

### データの形

`data/popular-jpop.json` はこんな形です(JSON = JavaScript のデータの書き方)。

```json
{
  "label": "J-POP",
  "tracks": [
    { "rank": 1, "name": "曲名", "artist": "アーティスト", "image_url": "https://…jpg", "spotify_url": "https://open.spotify.com/track/…" }
  ]
}
```

### 読み込む(fetch)

```js
const response = await fetch("data/popular-jpop.json"); // ファイルを取りに行く
const data = await response.json();                     // JSON として読む
```

`await` は「終わるまで待つ」。ファイルを取りに行くのは時間がかかるので、待ってから次に進みます。`await` を使う関数には `async` を付けます。

### 1 枚ずつ作って入れる(createElement / appendChild)

```js
const tile = document.createElement("a"); // <a> を作る
tile.className = "tile";                  // class を付ける(CSS が効くように)
tile.href = track.spotify_url;            // クリック先
collage.appendChild(tile);                // 箱の中に入れる
```

`tracks.forEach((track, i) => { … })` で、曲の数だけこれをくり返します。`i` は何番目か(0 から)。

### 外側のマスだけ特別あつかい

はみ出した分を「隠す」のではなく、**最初から枠の中に収まるように** しています。

- 外側のマスは、外側の方向にはずらさない(`dx = 0`)
- 大きくするときの基準点(`transform-origin`)を外側の辺にして、内側にだけ広がるようにする

```js
const dx = isLeft || isRight ? 0 : random(-10, 10);
tile.style.transformOrigin = `${originX} ${originY}`;
```

`条件 ? A : B` は「条件が本当なら A、そうでなければ B」です。

### メニューの開け閉め

```js
menuButton.addEventListener("click", () => {
  menu.hidden = !menu.hidden; // 反対にする
});
```

`!` は「反対」。隠れていたら出す、出ていたら隠す。

**ひっかかりやすいところ:** `.menu` に `display: flex;` を書くと、`hidden` の「消す」より強くなって、メニューがずっと出っぱなしになります。CSS に

```css
.menu[hidden] {
  display: none;
}
```

を足して、「`hidden` がついているときは消す」とはっきり書くと直ります。

### 矢印でカードを回す

```js
cards.appendChild(cards.firstElementChild); // 先頭のカードを最後に移す
```

カードは 3 枚とも HTML に並んでいて、CSS の `.card:nth-child(2)` で **2 番目だけ大きく** しています。だから JavaScript は並び順を変えるだけで、真ん中のカードが入れかわります。`appendChild` は「もうあるものを渡すと移動になる」のがポイントです。

ただ、これだけだと一瞬で切りかわって「回った」感じがしません。そこで、

1. 動かす前に、それぞれのカードの場所を `getBoundingClientRect()` で覚える
2. 並び順を変える
3. 「前の場所 − 新しい場所」の差を `transform: translate(...)` に入れて、見た目だけ前の場所に戻す
4. 次の瞬間に `transition` をつけて `transform` を消す → 前の場所から新しい場所へすべる

という手順にしています(FLIP という有名なやり方です)。端から端へ飛ぶカードは `z-index: 0` と薄い色にして、うしろ側を通って回っているように見せています。

## 4. 作る順番(おすすめ)

1. `index.html` に文字だけで ①〜⑤ を書く。まだ CSS なし。ブラウザで開いて、上から順に見えることを確かめる
2. `style.css` で色と幅(`.phone`、`.hero`、`.genre`)を付ける
3. コラージュの箱に、手で `<a class="tile">` を 10 個くらい書いて、grid で並ぶことを確かめる
4. `transform` と `z-index` を付けて、コラージュっぽくなるのを見る
5. 手で書いた `<a>` を消して、`script.js` で作るように変える
6. ステッカーを `position: absolute` で置く
7. メニューの開け閉め

## 5. 自分で変えてみよう

- `grid-template-columns: repeat(5, 1fr)` と `COLUMNS = 5` を 4 にしたら?(両方いっしょに変える)
- `scale(1.25)` を `1.1` や `1.5` にしたら?
- `random(-10, 10)` を `random(-20, 20)` にしたら、枠からはみ出す?(ヒント: 1.25 倍だと片側に 12.5% しか余裕がない)
- ステッカーの `width` や `rotate()` を変える
- 新しいジャンルの section を足す(`data-file` を変えて、`data/` に JSON を置く)

## データはどうやって作っている?

`data/` の JSON は、先生側で `scripts/fetch-tracks.mjs`(曲)と `scripts/fetch-artists.mjs`(おすすめの 3 組)を動かして Spotify の API から取っています(毎週、自動で更新)。くわしくは `README.md`。生徒は JSON を「もらうもの」として使えば OK です。
