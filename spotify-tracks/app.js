// 7x7 のグリッドに、月間トップ曲のジャケットを
// large(3x3) / medium(2x2) / small(1x1) でランダムに敷き詰める。

const GRID_SIZE = 7;
const SPAN = { large: 3, medium: 2, small: 1 };
const MAX_LAYOUT_RETRIES = 200;
const DATA_DIR = "data";

// ---------- 配置アルゴリズム ----------

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createUsedGrid() {
  // CSS Grid に合わせて 1 始まりで扱う
  return Array.from({ length: GRID_SIZE + 2 }, () =>
    Array(GRID_SIZE + 2).fill(false),
  );
}

function canPlace(used, col, row, span) {
  for (let r = row; r < row + span; r += 1) {
    for (let c = col; c < col + span; c += 1) {
      if (used[r][c]) return false;
    }
  }
  return true;
}

function markUsed(used, col, row, span) {
  for (let r = row; r < row + span; r += 1) {
    for (let c = col; c < col + span; c += 1) {
      used[r][c] = true;
    }
  }
}

function findRandomSlot(used, span) {
  const candidates = [];
  const last = GRID_SIZE - span + 1;
  for (let row = 1; row <= last; row += 1) {
    for (let col = 1; col <= last; col += 1) {
      // 3x3 をど真ん中に置くと単調になるので候補から外す
      if (span === 3 && col === 3 && row === 3) continue;
      if (canPlace(used, col, row, span)) candidates.push({ col, row });
    }
  }
  return shuffle(candidates)[0] || null;
}

function sortForPlacement(tracks) {
  // 大きいものから置くと失敗しにくい。同サイズ内は順位順。
  return tracks.slice().sort((a, b) => {
    const spanDiff = SPAN[b.size] - SPAN[a.size];
    return spanDiff !== 0 ? spanDiff : a.rank - b.rank;
  });
}

function tryLayout(tracks) {
  const used = createUsedGrid();
  const placements = [];
  for (const track of tracks) {
    const span = SPAN[track.size] || 1;
    const slot = findRandomSlot(used, span);
    if (!slot) return null;
    markUsed(used, slot.col, slot.row, span);
    placements.push({ track, span, ...slot });
  }
  return placements;
}

function layout(tracks) {
  const ordered = sortForPlacement(tracks);
  for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt += 1) {
    const placements = tryLayout(ordered);
    if (placements) return placements;
  }
  // 最後の手段: 置けるものだけ置く
  const used = createUsedGrid();
  const placements = [];
  for (const track of ordered) {
    const span = SPAN[track.size] || 1;
    const slot = findRandomSlot(used, span);
    if (!slot) continue;
    markUsed(used, slot.col, slot.row, span);
    placements.push({ track, span, ...slot });
  }
  return placements;
}

// size が無いデータ用のフォールバック。
// 20 曲なら large 1 / medium 7 / small 12 で 49 マスぴったり。
function assignSizes(tracks) {
  const sorted = tracks.slice().sort((a, b) => a.rank - b.rank);
  const n = sorted.length;
  const mediumCount = Math.max(0, Math.min(n - 1, Math.floor((41 - n) / 3)));
  return sorted.map((track, i) => {
    if (track.size) return track;
    const size = i === 0 ? "large" : i <= mediumCount ? "medium" : "small";
    return { ...track, size };
  });
}

// ---------- 描画 ----------

function placeholderColor(seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 35% 28%)`;
}

function formatMonth(key) {
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

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
