// ==============================
// いま人気の曲 コラージュサイト
// JavaScript のしごとは 4 つ
//   1. data/ の中の JSON ファイル(曲のリスト)を読む
//   2. ジャケットの画像を並べてコラージュを作る
//   3. 「メニュー」ボタンで、メニューを出したり消したりする
//   4. 矢印ボタンで、おすすめのカードをくるっと回す
// ==============================

// ---------- 2. コラージュを作る ----------

// min 以上 max 以下の、てきとうな数を返す
function random(min, max) {
  return min + Math.random() * (max - min);
}

// collage: ジャケットを入れる箱(<div class="collage">)
// tracks:  曲のリスト(JSON から読んだもの)
function makeCollage(collage, tracks) {
  const COLUMNS = 5; // CSS の grid-template-columns と同じ数にする
  const rows = Math.ceil(tracks.length / COLUMNS); // 行の数(切り上げ)

  tracks.forEach((track, i) => {
    // 何列目・何行目のマスか
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);

    // 1 枚のジャケット。クリックすると Spotify が開くように <a> にする
    const tile = document.createElement("a");
    tile.className = "tile";
    tile.href = track.spotify_url;
    tile.target = "_blank";
    tile.title = `#${track.rank} ${track.name} / ${track.artist}`;

    if (track.image_url) {
      const img = document.createElement("img");
      img.src = track.image_url;
      img.alt = track.name;
      img.loading = "lazy"; // 見えるところまで来てから読み込む
      tile.appendChild(img);
    } else {
      // 画像がないときは、色と曲名で代わりにする
      tile.style.background = `hsl(${(i * 47) % 360} 40% 45%)`;
      const name = document.createElement("span");
      name.textContent = track.name;
      tile.appendChild(name);
    }

    // --- ここがコラージュっぽく見せるコツ ---
    // 1 枚ずつ「ずらす量」と「重なり順」をてきとうに決める。
    // ただし、いちばん外側のマスは、枠の外にはみ出さないように、外側の方向にはずらさない。
    const isLeft = col === 0;
    const isRight = col === COLUMNS - 1;
    const isTop = row === 0;
    const isBottom = row === rows - 1;

    const dx = isLeft || isRight ? 0 : random(-10, 10); // % (マスの幅に対して)
    const dy = isTop || isBottom ? 0 : random(-10, 10);
    tile.style.setProperty("--dx", `${dx}%`);
    tile.style.setProperty("--dy", `${dy}%`);
    tile.style.setProperty("--z", Math.floor(random(1, 50)));

    // 大きくするときの「基準点」。
    // 外側のマスは、外側の辺を基準にして、内側にだけ広がるようにする。
    const originX = isLeft ? "left" : isRight ? "right" : "center";
    const originY = isTop ? "top" : isBottom ? "bottom" : "center";
    tile.style.transformOrigin = `${originX} ${originY}`;

    collage.appendChild(tile);
  });
}

// ---------- おすすめアーティストのカードを作る ----------

// artist: data/artists.json の 1 組分 { name, spotify_url, image_url, track }
function makeCard(artist) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = artist.spotify_url;
  card.target = "_blank";
  if (artist.track) card.title = `${artist.name} - ${artist.track.name}`;

  const name = document.createElement("span");
  name.textContent = artist.name;
  card.appendChild(name);

  if (artist.image_url) {
    const img = document.createElement("img");
    img.src = artist.image_url;
    img.alt = artist.track ? artist.track.name : artist.name;
    card.appendChild(img);
  } else {
    // 画像がないときは、ただの丸を置く
    const circle = document.createElement("div");
    circle.className = "no-image";
    card.appendChild(circle);
  }
  return card;
}

// ---------- 1. データを読んで、ページを作る ----------

async function main() {
  const sections = document.querySelectorAll(".genre"); // ジャンルの section を全部

  for (const section of sections) {
    const file = section.dataset.file; // HTML の data-file="..." の値
    const response = await fetch(`data/${file}.json`);
    const data = await response.json();

    // コラージュを作る
    makeCollage(section.querySelector(".collage"), data.tracks);

    // サンプルのデータなら、見出しに書いておく
    if (data.demo) {
      section.querySelector("h2").textContent += "(サンプル)";
    }
  }

  // おすすめアーティストの 3 枚のカード
  const response = await fetch("data/artists.json");
  const data = await response.json();
  const cards = document.getElementById("cards");
  for (const artist of data.artists) {
    cards.appendChild(makeCard(artist));
  }
}

main();

// ---------- 3. メニューを出したり消したりする ----------

const menuButton = document.getElementById("menu-button");
const menu = document.getElementById("menu");

menuButton.addEventListener("click", () => {
  menu.hidden = !menu.hidden; // 隠れていたら出す、出ていたら隠す
});

// メニューの中のリンクを押したら、メニューを閉じる
menu.addEventListener("click", () => {
  menu.hidden = true;
});

// ---------- 4. 矢印でカードを回す ----------

// カードは 3 枚とも HTML の中に並んでいて、CSS で「2 番目のカード」だけ大きくしている。
// だから、並び順を変えるだけで「真ん中のカード」が入れかわる。
// それだけだと一瞬で切りかわるので、「前の場所」から「新しい場所」へすべらせて、回って見えるようにする。
const cards = document.getElementById("cards");

function rotateCards(direction) {
  // 1. 動かす前の、それぞれのカードの場所と大きさを覚えておく
  const before = new Map();
  for (const card of cards.children) {
    before.set(card, card.getBoundingClientRect());
  }

  // 2. 並び順を変える(端のカードが反対の端へ移る)
  const moved = direction === "right" ? cards.firstElementChild : cards.lastElementChild;
  if (direction === "right") {
    cards.appendChild(moved); // 先頭を最後へ → 全体が左に 1 つ回る
  } else {
    cards.prepend(moved); // 最後を先頭へ → 全体が右に 1 つ回る
  }

  // 3. 新しい場所と前の場所の差を transform に入れて、見た目だけ「前の場所」に戻す
  for (const card of cards.children) {
    const from = before.get(card);
    const to = card.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const scale = from.width / to.width;
    card.classList.remove("moving"); // transition を切ってから
    card.style.transformOrigin = "top left";
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    card.style.zIndex = card === moved ? 0 : 1; // 端から端へ飛ぶカードは、うしろ側を通る
    card.style.opacity = card === moved ? 0.4 : 1;
  }

  // 4. 次の瞬間に transition をつけて transform を 0 に戻す → すべるように動く
  requestAnimationFrame(() => {
    for (const card of cards.children) {
      card.classList.add("moving");
      card.style.transform = "";
      card.style.opacity = "";
    }
  });
}

document.getElementById("arrow-right").addEventListener("click", () => rotateCards("right"));
document.getElementById("arrow-left").addEventListener("click", () => rotateCards("left"));
