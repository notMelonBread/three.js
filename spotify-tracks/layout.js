// 7x7 グリッドへの配置アルゴリズム(2D 版・3D 版で共用)
//
// large(3x3) / medium(2x2) / small(1x1) のタイルを、大きい順に
// 「置ける場所を全部列挙 → シャッフルして 1 つ選ぶ」で敷き詰める。

export const GRID_SIZE = 7;
export const SPAN = { large: 3, medium: 2, small: 1 };
const MAX_LAYOUT_RETRIES = 200;

// シード付きの乱数生成器(mulberry32)。同じシードなら同じ並びを再現できる。
export function createRandom(seed = Math.floor(Math.random() * 2 ** 32)) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(array, random = Math.random) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
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

function tryLayout(tracks, { skipUnplaceable = false } = {}) {
  const used = createUsedGrid();
  const placements = [];
  for (const track of tracks) {
    const span = SPAN[track.size] || 1;
    const slot = findRandomSlot(used, span);
    if (!slot) {
      if (skipUnplaceable) continue;
      return null;
    }
    markUsed(used, slot.col, slot.row, span);
    placements.push({ track, span, ...slot });
  }
  return placements;
}

/** @returns {{track, span, col, row}[]} col/row は 1 始まり */
export function layout(tracks) {
  const ordered = sortForPlacement(tracks);
  for (let attempt = 0; attempt < MAX_LAYOUT_RETRIES; attempt += 1) {
    const placements = tryLayout(ordered);
    if (placements) return placements;
  }
  // 最後の手段: 置けるものだけ置く
  return tryLayout(ordered, { skipUnplaceable: true });
}

// size が無いデータ用のフォールバック。
// 20 曲なら large 1 / medium 7 / small 12 で 49 マスぴったり。
export function assignSizes(tracks) {
  const sorted = tracks.slice().sort((a, b) => a.rank - b.rank);
  const n = sorted.length;
  const mediumCount = Math.max(0, Math.min(n - 1, Math.floor((41 - n) / 3)));
  return sorted.map((track, i) => {
    if (track.size) return track;
    const size = i === 0 ? "large" : i <= mediumCount ? "medium" : "small";
    return { ...track, size };
  });
}

export function placeholderColor(seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 35% 28%)`;
}

export function formatMonth(key) {
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

// data/index.json を「ページの一覧」に正規化する。
// 新形式: { entries: [{ file, label, month }] }
// 旧形式: { months: ["2026-08", ...] } も読めるようにしておく。
export function readIndexEntries(index) {
  if (Array.isArray(index?.entries)) {
    return index.entries.filter((e) => e && e.file).map((e) => ({
      file: e.file,
      label: e.label || (e.month ? formatMonth(e.month) : e.file),
      month: e.month || null,
    }));
  }
  return (index?.months || [])
    .slice()
    .sort()
    .reverse()
    .map((month) => ({ file: month, label: formatMonth(month), month }));
}

// ---------- コラージュ配置(3D 版) ----------
//
// マス目ではなく、大きさをランクでばらつかせた正方形を無作為に貼る。
// 重なりは許すが、候補位置をいくつか試して重なりの少ない場所を選ぶ(傾けない)。
// 重なったタイルは「相手の上の層」に積む。層の数は実際に重なった分だけ増える。
//
// 戻り値: [{ track, x, y, size, layer }]  x/y は中心座標(原点中心)、layer は 0 始まり
// width/height の単位は任意(3D 版はワールド単位、2D 版はピクセル)。random にシード付き乱数を渡せる。

function rectOverlapArea(ax, ay, asize, bx, by, bsize) {
  const w = Math.min(ax + asize / 2, bx + bsize / 2) - Math.max(ax - asize / 2, bx - bsize / 2);
  const h = Math.min(ay + asize / 2, by + bsize / 2) - Math.max(ay - asize / 2, by - bsize / 2);
  return w > 0 && h > 0 ? w * h : 0;
}

export function collageLayout(
  tracks,
  { width = 10, height = 7, density = 1.3, candidates = 48, maxOverlap = 0.1, random = Math.random } = {},
) {
  const sorted = tracks.slice().sort((a, b) => a.rank - b.rank);
  const n = sorted.length;
  if (n === 0) return [];

  // ランク上位ほど大きく。同じ帯の中でも少しばらつかせる
  const items = sorted.map((track, i) => {
    const p = n === 1 ? 0 : i / (n - 1);
    const base = p < 0.08 ? 2.6 : p < 0.3 ? 1.9 : p < 0.6 ? 1.4 : 1.05;
    return { track, size: base * (0.85 + random() * 0.3) };
  });

  // 面積の合計がキャンバスの density 倍になるようにスケール(1 を超えると重なりが出る)
  const totalArea = items.reduce((sum, it) => sum + it.size * it.size, 0);
  const scale = Math.sqrt((density * width * height) / totalArea);
  for (const it of items) it.size = Math.min(it.size * scale, Math.min(width, height) * 0.6);

  // 大きい順に、候補位置の中で既存タイルとの重なりが最も少ない場所に置く
  const placed = [];
  for (const it of items.slice().sort((a, b) => b.size - a.size)) {
    const freeW = Math.max(0, width - it.size);
    const freeH = Math.max(0, height - it.size);
    let best = null;
    for (let k = 0; k < candidates; k += 1) {
      const x = (random() - 0.5) * freeW;
      const y = (random() - 0.5) * freeH;
      let overlap = 0;
      for (const p of placed) overlap += rectOverlapArea(x, y, it.size, p.x, p.y, p.size);
      const score = overlap / (it.size * it.size);
      if (!best || score < best.score) best = { x, y, score };
      if (score <= maxOverlap) break;
    }
    placed.push({ ...it, x: best.x, y: best.y, layer: 0 });
  }

  // 層: 重なり順は無作為(大きいものが常に下にならないように)。
  // 自分より先に積まれたタイルと重なっていれば、その一番上の層の 1 つ上に乗る。
  const order = shuffle(placed, random);
  const stacked = [];
  for (const it of order) {
    let layer = 0;
    for (const p of stacked) {
      if (rectOverlapArea(it.x, it.y, it.size, p.x, p.y, p.size) > 0) layer = Math.max(layer, p.layer + 1);
    }
    it.layer = layer;
    stacked.push(it);
  }
  return stacked;
}

// ---------- 隙間なく埋めるコラージュ ----------
//
// collageLayout と同じ「無作為に貼る・重なる・傾けない」に加えて、長方形を必ず埋める。
//   1. タイルは枠の外へはみ出してもよい(はみ出し分は表示側で切る)
//   2. 貼り終わったあと、細かい格子で「どこも覆われていないマス」を探し、
//      その隙間を覆う大きさのタイルを一番下の層に足す。足りなければ下位の曲を繰り返し使う
//   3. 上に乗ったタイルにほぼ隠れてしまった曲は、最前面に引き上げる
//
// 戻り値: [{ track, x, y, size, layer, filler }]  filler は隙間埋めで足したもの(重複の可能性あり)

export function collageFill(
  tracks,
  {
    width = 10,
    height = 7,
    density = 1.5,
    overflow = 0.35, // タイルの大きさに対して、枠の外にはみ出してよい割合
    candidates = 40,
    maxOverlap = 0.12,
    minSizeRatio = 0.14, // 隙間埋めタイルの最小サイズ(短辺に対する割合)
    random = Math.random,
  } = {},
) {
  const sorted = tracks.slice().sort((a, b) => a.rank - b.rank);
  const n = sorted.length;
  if (n === 0) return [];
  const short = Math.min(width, height);

  // --- 1. 無作為に貼る(collageLayout と同じ考え方、ただし枠の外にはみ出せる) ---
  const items = sorted.map((track, i) => {
    const p = n === 1 ? 0 : i / (n - 1);
    const base = p < 0.08 ? 2.6 : p < 0.3 ? 1.9 : p < 0.6 ? 1.4 : 1.05;
    return { track, size: base * (0.85 + random() * 0.3) };
  });
  const totalArea = items.reduce((sum, it) => sum + it.size * it.size, 0);
  const scale = Math.sqrt((density * width * height) / totalArea);
  for (const it of items) it.size = Math.min(it.size * scale, short * 0.7);

  const placed = [];
  for (const it of items.slice().sort((a, b) => b.size - a.size)) {
    const halfX = Math.max(0, width / 2 - it.size * (0.5 - overflow));
    const halfY = Math.max(0, height / 2 - it.size * (0.5 - overflow));
    let best = null;
    for (let k = 0; k < candidates; k += 1) {
      const x = (random() * 2 - 1) * halfX;
      const y = (random() * 2 - 1) * halfY;
      let overlap = 0;
      for (const p of placed) overlap += rectOverlapArea(x, y, it.size, p.x, p.y, p.size);
      const score = overlap / (it.size * it.size);
      if (!best || score < best.score) best = { x, y, score };
      if (score <= maxOverlap) break;
    }
    placed.push({ ...it, x: best.x, y: best.y, layer: 0, filler: false });
  }

  // --- 2. 隙間を探して埋める ---
  const cell = short / 48;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cellCenter = (c, r) => ({ x: -width / 2 + (c + 0.5) * cell, y: -height / 2 + (r + 0.5) * cell });
  const covers = (tile, px, py) =>
    Math.abs(px - tile.x) <= tile.size / 2 && Math.abs(py - tile.y) <= tile.size / 2;
  // マス全体(四隅)が入っていて初めて「覆われている」とみなす。中心だけだと細い隙間が残る
  const coversCell = (tile, px, py) =>
    Math.abs(px - tile.x) + cell / 2 <= tile.size / 2 && Math.abs(py - tile.y) + cell / 2 <= tile.size / 2;

  const coverage = () => {
    const grid = Array.from({ length: rows }, () => Array(cols).fill(false));
    for (const tile of placed) {
      const c0 = Math.max(0, Math.floor((tile.x - tile.size / 2 + width / 2) / cell));
      const c1 = Math.min(cols - 1, Math.floor((tile.x + tile.size / 2 + width / 2) / cell));
      const r0 = Math.max(0, Math.floor((tile.y - tile.size / 2 + height / 2) / cell));
      const r1 = Math.min(rows - 1, Math.floor((tile.y + tile.size / 2 + height / 2) / cell));
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
          const { x, y } = cellCenter(c, r);
          if (coversCell(tile, x, y)) grid[r][c] = true;
        }
      }
    }
    return grid;
  };

  // 隙間埋めに使う曲: まだ使っていない曲があればそれ、無ければ下位から繰り返し
  let fillerIndex = 0;
  const nextFillerTrack = () => {
    const track = sorted[n - 1 - (fillerIndex % n)];
    fillerIndex += 1;
    return track;
  };

  for (let guard = 0; guard < 200; guard += 1) {
    const grid = coverage();
    // 未被覆のマスをひとつ選び、隣接する未被覆マスをまとめて外接矩形をとる
    let start = null;
    outer: for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (!grid[r][c]) {
          start = { r, c };
          break outer;
        }
      }
    }
    if (!start) break;
    const stack = [start];
    const seen = new Set([`${start.r},${start.c}`]);
    let minR = start.r, maxR = start.r, minC = start.c, maxC = start.c;
    while (stack.length) {
      const { r, c } = stack.pop();
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        const key = `${nr},${nc}`;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || grid[nr][nc] || seen.has(key)) continue;
        seen.add(key);
        stack.push({ r: nr, c: nc });
      }
    }
    const boxW = (maxC - minC + 1) * cell;
    const boxH = (maxR - minR + 1) * cell;
    const size = Math.max(short * minSizeRatio, boxW, boxH) * 1.15 + cell;
    const cx = -width / 2 + ((minC + maxC + 1) / 2) * cell;
    const cy = -height / 2 + ((minR + maxR + 1) / 2) * cell;
    placed.push({ track: nextFillerTrack(), size: Math.min(size, short), x: cx, y: cy, layer: 0, filler: true });
  }

  // --- 3. 層: 隙間埋めは一番下、それ以外は無作為な順に積む ---
  const order = [...placed.filter((p) => p.filler), ...shuffle(placed.filter((p) => !p.filler), random)];
  const stacked = [];
  for (const it of order) {
    let layer = 0;
    for (const p of stacked) {
      if (rectOverlapArea(it.x, it.y, it.size, p.x, p.y, p.size) > 0) layer = Math.max(layer, p.layer + 1);
    }
    it.layer = layer;
    stacked.push(it);
  }

  // --- 4. ほとんど隠れてしまった曲を最前面へ ---
  const topmost = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const { x, y } = cellCenter(c, r);
      let top = null;
      for (const tile of stacked) if (covers(tile, x, y) && (!top || tile.layer > top.layer)) top = tile;
      topmost[r][c] = top;
    }
  }
  const visibleCells = new Map();
  const totalCells = new Map();
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const { x, y } = cellCenter(c, r);
      for (const tile of stacked) {
        if (!covers(tile, x, y)) continue;
        totalCells.set(tile, (totalCells.get(tile) || 0) + 1);
        if (topmost[r][c] === tile) visibleCells.set(tile, (visibleCells.get(tile) || 0) + 1);
      }
    }
  }
  let maxLayer = Math.max(...stacked.map((p) => p.layer));
  for (const tile of stacked) {
    if (tile.filler) continue;
    const total = totalCells.get(tile) || 0;
    const visible = visibleCells.get(tile) || 0;
    if (total > 0 && visible / total < 0.2) {
      maxLayer += 1;
      tile.layer = maxLayer;
    }
  }
  return stacked;
}
