# MUSIC INTRO(簡易版)

ページを開いたときに、ブラウザが Spotify から直接ジャケットを取ってきて並べる版。
Node.js、`data/` フォルダ、GitHub Actions(yml)は使わない。

## ファイル

| ファイル | なに |
|---|---|
| `index.html` | ページの骨組み(キービジュアル、ジャンル 3 つ、おすすめカード) |
| `style.css` | 見た目(ピンクの塗り足し、コラージュ、ステッカー、カード) |
| `keys.js` | Spotify の鍵 2 つ。ここだけ自分で書く |
| `script.js` | Spotify に曲を聞く → コラージュを作る → メニュー → カードを回す |
| `imgs/` | キービジュアルとステッカー |

## 使い方

1. `keys.js` の `""` の中に、Spotify Developer Dashboard のアプリの Client ID と Client Secret を貼る
2. VS Code の Live Server(Go Live)で `index.html` を開く
3. Netlify で公開するときは、このフォルダを Publish directory にする

## 注意

鍵は `keys.js` に書くので、公開したページを見た人は鍵を読める。
学習用のアプリの鍵だけ使うこと。鍵を変えたくなったら Dashboard で作り直して `keys.js` を書きかえる。
