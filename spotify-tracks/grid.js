// 2D 版: three.js を使わず、DOM だけでコラージュを作る。
// 配置アルゴリズム(collageLayout)は 3D 版 (main.js) と共用。
//   - ランク上位ほど大きいタイルを無作為に貼る。重なりは許すが少なめ。傾けない
//   - 重なったタイルは相手の 1 つ上の層(z-index)に乗る
//   - カーソル位置に中心が一番近いタイルが一番上に来て浮き上がる
//   - タッチ: 1 回目のタップで浮かせ、浮いているものをもう一度タップで Spotify を開く

import { collageLayout, createRandom, placeholderColor, readIndexEntries } from "./layout.js";

const DATA_DIR = "data";
const FOCUS_REACH_RATIO = 0.35; // タイルの大きさに対して、縁からどこまでを「近い」とみなすか

const caption = document.getElementById("caption");

function setCaption(track) {
  caption.replaceChildren();
  if (!track) return;
  const name = document.createElement("strong");
  name.textContent = `#${track.rank} ${track.name}`;
  caption.append(name, ` / ${track.artist}`);
}

// ---------- 1 ページぶんのコラージュ ----------

function createCollage(container, tracks) {
  const seed = Math.floor(Math.random() * 2 ** 32); // リサイズしても同じ配置を再現するために固定
  let placements = [];
  let tiles = [];
  let focused = null;
  let lastPointerType = "mouse";

  const tileFor = (placement) => tiles[placements.indexOf(placement)];

  function setFocus(next) {
    if (next === focused) return;
    focused?.tile.classList.remove("is-focus");
    focused = next;
    focused?.tile.classList.add("is-focus");
    setCaption(focused?.placement.track || null);
    container.style.cursor = focused ? "pointer" : "";
  }

  // コンテナ内の座標 (px) に中心が一番近いタイル。縁から一定以上離れていたら無し
  function nearest(px, py) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    let best = null;
    let bestDistance = Infinity;
    for (const placement of placements) {
      const cx = w / 2 + placement.x;
      const cy = h / 2 - placement.y;
      const distance = Math.hypot(px - cx, py - cy);
      if (distance > placement.size / 2 + placement.size * FOCUS_REACH_RATIO) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { placement, tile: tileFor(placement) };
      }
    }
    return best;
  }

  function layout() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    placements = collageLayout(tracks, { width: w, height: h, random: createRandom(seed) });
    container.replaceChildren();
    tiles = placements.map((placement) => {
      const { track, x, y, size, layer } = placement;
      const tile = document.createElement("a");
      tile.className = "tile";
      tile.href = track.spotify_url || "#";
      tile.target = "_blank";
      tile.rel = "noopener";
      tile.title = `#${track.rank} ${track.name} / ${track.artist}`;
      tile.setAttribute("aria-label", tile.title);
      tile.style.width = `${size}px`;
      tile.style.height = `${size}px`;
      tile.style.left = `${w / 2 + x - size / 2}px`;
      tile.style.top = `${h / 2 - y - size / 2}px`;
      tile.style.zIndex = String(layer + 1);
      if (track.image_url) {
        tile.style.backgroundImage = `url("${track.image_url}")`;
      } else {
        tile.style.backgroundColor = placeholderColor(track.name);
      }
      // タッチ: 浮いていないタイルのタップはまず浮かせるだけ
      tile.addEventListener("click", (event) => {
        if (lastPointerType !== "touch") return; // マウスはそのまま開く
        if (focused?.tile === tile) return; // 2 回目のタップ: そのまま開く
        event.preventDefault();
        setFocus({ placement, tile });
      });
      container.append(tile);
      return tile;
    });
    setFocus(null);
  }

  container.addEventListener("pointermove", (event) => {
    lastPointerType = event.pointerType;
    if (event.pointerType === "touch") return;
    const rect = container.getBoundingClientRect();
    setFocus(nearest(event.clientX - rect.left, event.clientY - rect.top));
  });
  container.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch") return; // タッチは指を離すたびに leave が来るので無視
    setFocus(null);
  });
  container.addEventListener("pointerdown", (event) => {
    lastPointerType = event.pointerType;
    if (event.pointerType !== "touch") return;
    const rect = container.getBoundingClientRect();
    const next = nearest(event.clientX - rect.left, event.clientY - rect.top);
    if (next?.tile !== focused?.tile) setFocus(next);
  });

  // 画面サイズが変わったら同じシードで並べ直す(縦横比が変わっても同じ雰囲気になる)
  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  }).observe(container);

  layout();
}

// ---------- ページ(エントリ)ごとの読み込み ----------

function createSection(entry, single) {
  const section = document.createElement("section");
  section.className = "page";
  section.dataset.file = entry.file;
  section.innerHTML = `
    <h2 class="page__title"></h2>
    <div class="collage"></div>
  `;
  const title = section.querySelector(".page__title");
  title.textContent = entry.label;
  if (single) title.hidden = true;
  return section;
}

async function loadSection(section) {
  if (section.dataset.loaded) return;
  section.dataset.loaded = "true";
  const key = section.dataset.file;
  const collage = section.querySelector(".collage");
  try {
    const response = await fetch(`${DATA_DIR}/${key}.json`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    if (data.demo) {
      const small = document.createElement("small");
      small.textContent = "サンプル";
      section.querySelector(".page__title").append(small);
    }
    const tracks = data.tracks || [];
    if (tracks.length === 0) {
      collage.classList.add("collage--empty");
      collage.textContent = "データがありません";
      return;
    }
    createCollage(collage, tracks);
  } catch (error) {
    console.error(`failed to load ${key}`, error);
    collage.classList.add("collage--empty");
    collage.textContent = "読み込みに失敗しました";
  }
}

async function main() {
  const container = document.getElementById("pages");
  const loading = document.getElementById("loading");

  try {
    const response = await fetch(`${DATA_DIR}/index.json`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const entries = readIndexEntries(await response.json());

    if (entries.length === 0) {
      container.innerHTML = '<section class="page is-visible"><p>まだデータがありません。</p></section>';
    }

    const observer = new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue;
          item.target.classList.add("is-visible");
          loadSection(item.target);
        }
      },
      { rootMargin: "200px 0px" },
    );

    for (const entry of entries) {
      const section = createSection(entry, entries.length <= 1);
      container.append(section);
      observer.observe(section);
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = '<section class="page is-visible"><p>データの読み込みに失敗しました。</p></section>';
  } finally {
    loading.classList.add("is-hidden");
  }
}

main();
