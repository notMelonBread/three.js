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
| ① メインビジュアル | `<header class="hero">` | ジャケットのモザイク(背景)、タイトル、「メニュー」ボタン |
| ② J-POP | `<section class="genre" id="jpop">` | 飾り、コラージュの箱、見出し、説明 |
| ③ K-POP | `<section class="genre" id="kpop">` | 同じ |
| ④ 洋楽 | `<section class="genre" id="western">` | 同じ |
| ⑤ おすすめ | `<section class="artists">` | 3 枚のカード |
| クレジット | `<footer>` | Spotify の表記 |

ポイント:

- ②③④は **まったく同じ形** です。中身の文字と `data-file` だけが違います。同じものは同じ書き方にすると、CSS も JavaScript も 1 回書けばすみます。
- `<div class="collage"></div>` と `<div class="hero__bg">` は **空っぽ** です。ジャケットは JavaScript があとから入れます。
- ①だけは `.phone` の **外** にあります。背景を PC でも画面いっぱいに広げたい(塗り足し)ので、文字の部分だけ `.hero__inner` でスマホ幅にしています。
- `<nav class="menu" hidden>` の `hidden` は「隠す」という意味。ボタンを押したときに JavaScript が外します。
- デザイン(Figma)に青い文字で `h2` `h3` `p` `img` と書いてあったのは、「ここはこのタグで作る」という印です。

## 2. CSS で形を作る

### スマホの形にする

```css
.phone {
  max-width: 430px;  /* スマホの横幅まで */
  margin: 0 auto;    /* 左右の余白を自動 = 真ん中に */
}
```

PC で開いても、真ん中にスマホと同じ形で出ます。背景のピンクは `body` に塗ってあるので、PC では画面の端まで広がります(印刷で言う「塗り足し」)。

### 背景を重ねる(メインビジュアル)

```css
.hero { position: relative; }
.hero__bg    { position: absolute; inset: 0; }  /* inset: 0 = 上下左右 0 = 親にぴったり重ねる */
.hero__shade { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); }
.hero__inner { position: relative; }           /* これで背景より手前に来る */
```

モザイク → うすい黒 → 文字、の順に 3 枚を重ねています。HTML で **あとに書いたものが上** に来ます。`.hero__inner` に `position: relative` を書かないと、`absolute` の 2 枚の下に隠れてしまいます。

モザイクは `grid-template-columns: repeat(auto-fill, minmax(90px, 1fr))` で「90px 以上の列を、入るだけ作る」と書いてあるので、スマホでは 4 列、PC では 15 列くらいになります。

### 飾りを好きな場所に置く(position)

```css
.genre { position: relative; }   /* 親に書く: ここを基準にする */
.sticker { position: absolute; } /* 子に書く: 親の中の好きな場所に置ける */
.sticker--heart { top: 1%; right: -6%; width: 30%; }
```

`relative` の親の中で、`absolute` の子は `top / left / right / bottom` で場所を決められます。`right: -6%` のようにマイナスにすると、わざと少しはみ出せます。

### 5 列のマス目(grid)

```css
.collage {
  display: grid;
  grid-template-columns: repeat(5, 1fr); /* 同じ幅の列を 5 つ */
}
.tile { aspect-ratio: 1; } /* 正方形 */
```

これだけで、入れた順に左上から 5 列ずつ並びます。マス目だから **隙間ができません**。

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

`data/` の JSON は、先生側で `scripts/fetch-tracks.mjs` を動かして Spotify の API から取っています(毎週、自動で更新)。くわしくは `README.md`。生徒は JSON を「もらうもの」として使えば OK です。
