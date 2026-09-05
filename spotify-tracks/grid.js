// 7x7 のグリッドに、月間トップ曲のジャケットを
// large(3x3) / medium(2x2) / small(1x1) でランダムに敷き詰める(2D 版)。
// 配置アルゴリズムは layout.js に切り出してあり、3D 版 (main.js) と共用。

import { assignSizes, formatMonth, layout, placeholderColor } from "./layout.js";

const DATA_DIR = "data";

// ---------- 描画 ----------

function renderGrid(section, data) {
  const grid = section.querySelector(".grid");
  const caption = section.querySelector(".grid__caption");
  grid.replaceChildren();

  const tracks = assignSizes(data.tracks || []);
  if (tracks.length === 0) {
    grid.classList.add("grid--empty");
    grid.textContent = "データがありません";
    return;
  }

  const showCaption = (track) => {
    caption.replaceChildren();
    if (!track) return;
    const name = document.createElement("strong");
    name.textContent = `#${track.rank} ${track.name}`;
    caption.append(name, ` / ${track.artist}`);
  };

  for (const { track, col, row, span } of layout(tracks)) {
    const tile = document.createElement("a");
    tile.className = `tile tile--${track.size}`;
    tile.href = track.spotify_url || "#";
    tile.target = "_blank";
    tile.rel = "noopener";
    tile.title = `#${track.rank} ${track.name} / ${track.artist}`;
    tile.setAttribute("aria-label", tile.title);
    tile.style.gridColumn = `${col} / span ${span}`;
    tile.style.gridRow = `${row} / span ${span}`;
    if (track.image_url) {
      tile.style.backgroundImage = `url("${track.image_url}")`;
    } else {
      tile.style.backgroundColor = placeholderColor(track.name);
    }
    tile.addEventListener("mouseenter", () => showCaption(track));
    tile.addEventListener("focus", () => showCaption(track));
    tile.addEventListener("mouseleave", () => showCaption(null));
    tile.addEventListener("blur", () => showCaption(null));
    grid.append(tile);
  }
}

function createSection(monthKey) {
  const section = document.createElement("section");
  section.className = "month";
  section.dataset.month = monthKey;
  section.innerHTML = `
    <h2 class="month__title">${formatMonth(monthKey)}</h2>
    <div class="grid" role="list"></div>
    <p class="grid__caption"></p>
  `;
  return section;
}

async function loadMonth(section) {
  if (section.dataset.loaded) return;
  section.dataset.loaded = "true";
  const key = section.dataset.month;
  try {
    const response = await fetch(`${DATA_DIR}/${key}.json`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    if (data.demo) {
      section.querySelector(".month__title").insertAdjacentHTML(
        "beforeend",
        "<small>サンプル</small>",
      );
    }
    renderGrid(section, data);
  } catch (error) {
    console.error(`failed to load ${key}`, error);
    const grid = section.querySelector(".grid");
    grid.classList.add("grid--empty");
    grid.textContent = "読み込みに失敗しました";
  }
}

async function main() {
  const container = document.getElementById("months");
  const loading = document.getElementById("loading");

  try {
    const response = await fetch(`${DATA_DIR}/index.json`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const index = await response.json();
    const months = (index.months || []).slice().sort().reverse();

    if (months.length === 0) {
      container.innerHTML = '<section class="month"><p>まだデータがありません。</p></section>';
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          loadMonth(entry.target);
        }
      },
      { rootMargin: "200px 0px" },
    );

    for (const key of months) {
      const section = createSection(key);
      container.append(section);
      observer.observe(section);
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = '<section class="month"><p>データの読み込みに失敗しました。</p></section>';
  } finally {
    loading.classList.add("is-hidden");
  }
}

main();
