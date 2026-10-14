// ==============================
// MUSIC INTRO(簡易版)
// ページを開いたときに、ブラウザが Spotify から直接ジャケットを取ってくる。
// JavaScript のしごとは 4 つ
//   1. Spotify に曲を聞いて、ジャケットのリストを作る
//   2. ジャケットの画像を並べてコラージュを作る
//   3. 「メニュー」ボタンで、メニューを出したり消したりする
//   4. 矢印ボタンで、おすすめのカードをくるっと回す
// ==============================

// ---------- 1. Spotify に曲を聞く ----------

// 入場券(トークン)をもらう。keys.js の 2 つの鍵を見せると、1 時間使える券が返ってくる
async function getToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET,
  });
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", body });
  const json = await response.json();
  if (!json.access_token) {
    throw new Error("トークンが取れなかった。keys.js の鍵を確認しよう: " + JSON.stringify(json));
  }
  return json.access_token;
}

// 入場券を付けて /search に「この条件のものを出して」と頼む(これが API)
// type は "track"(曲) か "artist"(アーティスト)。1 回に 10 件まで返ってくる
async function search(token, q, type, market, offset = 0) {
  const url = new URL("https://api.spotify.com/v1/search");
  url.search = new URLSearchParams({ q, type, market, limit: 10, offset });
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!response.ok) throw new Error(`search 失敗: ${response.status}`);
  return response.json();
}

// ジャンルごとの検索条件。1 つ目で足りなければ 2 つ目、3 つ目…と進む
const year = new Date().getFullYear();
const GENRES = {
  jpop: {
    market: "JP",
    queries: [`genre:j-pop year:${year}`, `genre:j-pop year:${year - 1}`, `j-pop year:${year}`, "jpop"],
  },
  kpop: {
    market: "JP",
    queries: [`genre:k-pop year:${year}`, `genre:k-pop year:${year - 1}`, `k-pop year:${year}`, "kpop"],
  },
  // 洋楽は日本の曲が混ざらないように、アメリカの市場で探す
  western: {
    market: "US",
    queries: [`year:${year}`, `genre:pop year:${year}`, `year:${year - 1}`],
  },
};

// おすすめアーティスト。ここの名前を変えると、カードが変わる
const ARTISTS = ["back number", "なとり", "スピッツ"];

// 1 曲を { name, artist, image_url, spotify_url } の形にそろえる
function toItem(track) {
  return {
    name: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    image_url: track.album.images[1]?.url || track.album.images[0]?.url || "",
    spotify_url: track.external_urls.spotify,
  };
}

// そのジャンルの曲を limit 曲ぶん集める。同じジャケットは 1 曲だけ
async function fetchTracks(token, genre, limit = 45) {
  const { market, queries } = GENRES[genre];
  const tracks = [];
  const seenImages = new Set();

  for (const q of queries) {
    // 10 件ずつ、最大 100 件まで読み進める
    for (let offset = 0; offset < 100 && tracks.length < limit; offset += 10) {
      const json = await search(token, q, "track", market, offset);
      const items = json.tracks.items;
      if (items.length === 0) break; // もう結果がない → 次の条件へ

      for (const track of items) {
        if (track.album.album_type === "compilation") continue; // コンピ盤は同じジャケットが並ぶので除く
        const item = toItem(track);
        if (!item.image_url || seenImages.has(item.image_url)) continue; // 同じジャケットは 1 回だけ
        seenImages.add(item.image_url);
        tracks.push(item);
      }
    }
    if (tracks.length >= limit) break;
  }
  return tracks.slice(0, limit);
}

// アーティスト名から、そのアーティストと 1 曲(検索の 1 件目 ≒ いちばん人気)を探す
async function fetchArtist(token, name) {
  const found = await search(token, name, "artist", "JP");
  const artist = found.artists.items[0];
  if (!artist) return null;

  const result = await search(token, `artist:"${artist.name}"`, "track", "JP");
  const track = result.tracks.items[0];
  return {
    name, // 画面に出す名前は ARTISTS に書いたとおり(Spotify では "SPITZ" のように英語のことがある)
    spotify_url: artist.external_urls.spotify,
    image_url: track ? toItem(track).image_url : artist.images[0]?.url || "",
    track: track ? { name: track.name, spotify_url: track.external_urls.spotify } : null,
  };
}

// ---------- 2. コラージュを作る ----------

// min 以上 max 以下の、てきとうな数を返す
function random(min, max) {
  return min + Math.random() * (max - min);
}

// collage: ジャケットを入れる箱(<div class="collage">)
// tracks:  曲のリスト(fetchTracks で集めたもの)
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
    tile.title = `${track.name} / ${track.artist}`;

    const img = document.createElement("img");
    img.src = track.image_url;
    img.alt = track.name;
    img.loading = "lazy"; // 見えるところまで来てから読み込む
    tile.appendChild(img);

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

    // 大きくするときの「基準点」。外側のマスは、外側の辺を基準にして、内側にだけ広がるようにする。
    const originX = isLeft ? "left" : isRight ? "right" : "center";
    const originY = isTop ? "top" : isBottom ? "bottom" : "center";
    tile.style.transformOrigin = `${originX} ${originY}`;

    collage.appendChild(tile);
  });
}

// ---------- おすすめアーティストのカードを作る ----------

// artist: fetchArtist の結果 { name, spotify_url, image_url, track }
function makeCard(artist) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = artist.spotify_url;
  card.target = "_blank";
  if (artist.track) card.title = `${artist.name} - ${artist.track.name}`;

  const name = document.createElement("span");
  name.textContent = artist.name;
  card.appendChild(name);

  const img = document.createElement("img");
  img.src = artist.image_url;
  img.alt = artist.track ? artist.track.name : artist.name;
  card.appendChild(img);
  return card;
}

// ---------- ページを作る ----------

async function main() {
  const token = await getToken();

  // ジャンルの section を全部。3 つ同時に取りに行く
  const sections = document.querySelectorAll(".genre");
  await Promise.all(
    [...sections].map(async (section) => {
      const tracks = await fetchTracks(token, section.dataset.genre); // HTML の data-genre="..." の値
      makeCollage(section.querySelector(".collage"), tracks);
    }),
  );

  // おすすめアーティストの 3 枚のカード
  const cards = document.getElementById("cards");
  for (const name of ARTISTS) {
    const artist = await fetchArtist(token, name);
    if (artist) cards.appendChild(makeCard(artist));
  }
}

main().catch((error) => {
  console.error(error);
  document.querySelector(".genre h3").textContent = "ジャケットを取れなかった。F12 の Console を見よう";
});

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

// カードは 3 枚とも並んでいて、CSS で「2 番目のカード」だけ大きくしている。
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
