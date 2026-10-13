// ==============================
// いま人気の曲 コラージュサイト
// JavaScript のしごとは 3 つ
//   1. data/ の中の JSON ファイル(曲のリスト)を読む
//   2. ジャケットの画像を並べてコラージュを作る
//   3. 「メニュー」ボタンで、メニューを出したり消したりする
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
