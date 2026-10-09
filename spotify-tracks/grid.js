// 2D 版: three.js を使わず、DOM だけでコラージュを作る。
// 配置アルゴリズム(collageFill)は 3D 版 (main.js) と共用。
//   - ランク上位ほど大きいタイルを無作為に貼る。重なりは許す。傾けない。枠の外にはみ出した分は切る
//   - 画面の長方形は必ず埋まる(隙間は下位の曲を繰り返して埋める)
//   - 重なったタイルは相手の 1 つ上の層(z-index)に乗る
//   - カーソル位置に中心が一番近いタイルが一番上に来て浮き上がる
//   - タッチ: 1 回目のタップで浮かせ、浮いているものをもう一度タップで Spotify を開く

import { collageFill, createRandom, placeholderColor, readIndexEntries } from "./layout.js";
import { createPager, hideLoading, setCaption } from "./chrome.js";

const DATA_DIR = "data";
const FOCUS_REACH_RATIO = 0.35; // タイルの大きさに対して、縁からどこまでを「近い」とみなすか

function createCollage(container, tracks, caption) {
  const seed = Math.floor(Math.random() * 2 ** 32); // リサイズしても同じ配置を再現するために固定
  let placements = [];
  let tiles = [];
  let focused = null;
  let lastPointerType = "mouse";

  function setFocus(next) {
    if (next === focused) return;
    focused?.tile.classList.remove("is-focus");
    focused = next;
    focused?.tile.classList.add("is-focus");
    setCaption(focused?.placement.track || null, caption);
    container.style.cursor = focused ? "pointer" : "";
  }

  // コンテナ内の座標 (px) に中心が一番近いタイル。縁から一定以上離れていたら無し
  function nearest(px, py) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    let best = null;
    let bestDistance = Infinity;
    placements.forEach((placement, i) => {
      const cx = w / 2 + placement.x;
      const cy = h / 2 - placement.y;
      const distance = Math.hypot(px - cx, py - cy);
      if (distance > placement.size / 2 + placement.size * FOCUS_REACH_RATIO) return;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { placement, tile: tiles[i] };
      }
    });
    return best;
  }

  function layout() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    placements = collageFill(tracks, { width: w, height: h, random: createRandom(seed) });
    for (const tile of tiles) tile.remove();
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
      tile.addEventListener("click", (event) => {
        if (lastPointerType !== "touch") return; // マウスはそのまま開く
        if (focused?.tile === tile) return; // 2 回目のタップ: そのまま開く
        event.preventDefault();
        setFocus({ placement, tile });
      });
      container.prepend(tile); // キャプション等のオーバーレイより下に
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

  // 画面サイズが変わったら同じシードで並べ直す
  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  }).observe(container);

  layout();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.json();
}

// ジャンルごとに 1 ページ(縦長カラム)。見えたときに JSON を読んでコラージュを作る
function createPage(entry) {
  const page = document.createElement("section");
  page.className = "page";
  page.dataset.file = entry.file;
  page.innerHTML = `
    <div class="frame">
      <div class="screen">
        <p class="screen__label"></p>
        <p class="screen__caption"></p>
      </div>
    </div>
  `;
  page.querySelector(".screen__label").textContent = entry.label;
  return page;
}

async function loadPage(page) {
  if (page.dataset.loaded) return;
  page.dataset.loaded = "true";
  const screen = page.querySelector(".screen");
  const caption = page.querySelector(".screen__caption");
  try {
    const data = await fetchJson(`${DATA_DIR}/${page.dataset.file}.json`);
    if (data.demo) page.querySelector(".screen__label").textContent += "(サンプル)";
    createCollage(screen, data.tracks || [], caption);
  } catch (error) {
    console.error(error);
    setCaption({ rank: "-", name: "読み込みに失敗しました", artist: "" }, caption);
  }
}

async function main() {
  const deck = document.getElementById("deck");
  try {
    const entries = readIndexEntries(await fetchJson(`${DATA_DIR}/index.json`));
    if (entries.length === 0) throw new Error("no entries");

    const pages = entries.map(createPage);
    deck.append(...pages);
    const pager = createPager(
      entries.map((e) => e.label),
      (i) => pages[i].scrollIntoView({ behavior: "smooth" }),
    );

    // 見えたページから順に読み込む。ページ送りの丸も追従
    const observer = new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue;
          loadPage(item.target);
          if (item.intersectionRatio > 0.5) pager.setCurrent(pages.indexOf(item.target));
        }
      },
      { root: deck, threshold: [0.01, 0.6] },
    );
    for (const page of pages) observer.observe(page);
  } catch (error) {
    console.error(error);
    deck.innerHTML = '<section class="page"><p>データの読み込みに失敗しました。</p></section>';
  } finally {
    hideLoading();
  }
}

main();
