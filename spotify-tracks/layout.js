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
      order: Number.isFinite(e.order) ? e.order : null,
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
//   1. タイルはすべて枠の内側に収める(はみ出して切る、ではない)
//   2. 貼り終わったあと、細かい格子で「どこも覆われていないマス」を探し、
//      その隙間を覆う大きさのタイルを枠内に収まる位置で一番下の層に足す。足りなければ下位の曲を繰り返し使う
//   3. 上に乗ったタイルにほぼ隠れてしまった曲は、最前面に引き上げる
//
// 戻り値: [{ track, x, y, size, layer, filler }]  filler は隙間埋めで足したもの(重複の可能性あり)

export function collageFill(
  tracks,
  {
    width = 10,
    height = 7,
    density = 1.9,
    overflow = 0, // タイルの大きさに対して、枠の外にはみ出してよい割合(既定 0 = すべて枠内)
    uniform = true, // true: すべて同じ大きさ。false: ランク上位ほど大きい
    grow = 0.04, // 配置後に全タイルを同じ比率で拡大して、接しているだけの細い隙間を閉じる
    maxFillerRatio = 0.42, // (uniform=false のとき)隙間埋めタイルの最大サイズ(短辺に対する割合)
    candidates = 40,
    maxOverlap = 0.12,
    minSizeRatio = 0.14, // 隙間埋めタイルの最小サイズ(短辺に対する割合)
    random = Math.random,
  } = {},
) {
  const sorted = tracks.slice().sort((a, b) => a.rank - b.rank);
  const n = sorted.length;
  if (n === 0) return [];

  // --- 1. 無作為に貼る ---
  const short = Math.min(width, height);
  // 大きさ: uniform なら全部同じ、そうでなければランク上位ほど大きく(帯の中で少しばらつかせる)
  const items = sorted.map((track, i) => {
    if (uniform) return { track, size: 1 };
    const p = n === 1 ? 0 : i / (n - 1);
    const base = p < 0.08 ? 2.6 : p < 0.3 ? 1.9 : p < 0.6 ? 1.4 : 1.05;
    return { track, size: base * (0.85 + random() * 0.3) };
  });
  // 面積の合計がキャンバスの density 倍になるようにスケール(1 を超える分だけ重なる)
  const totalArea = items.reduce((sum, it) => sum + it.size * it.size, 0);
  const scale = Math.sqrt((density * width * height) / totalArea);
  for (const it of items) it.size = Math.min(it.size * scale, short * 0.7);
  const uniformSize = items[0].size * (1 + grow);

  // 置く位置は、候補をいくつか試して「まだ覆われていない面積」を一番多く覆うものから選ぶ
  // (重なりを避ける基準だと穴が多く残り、埋めるために同じ曲を繰り返すことになる)。
  // 上位 3 候補から無作為に選んで、並びが整然としすぎないようにする。
  const cols = Math.ceil(width / (short / 48));
  const rows = Math.ceil(height / (short / 48));
  const cw = width / cols;
  const ch = height / rows;
  const cell = Math.max(cw, ch);
  const cellCenter = (c, r) => ({ x: -width / 2 + (c + 0.5) * cw, y: -height / 2 + (r + 0.5) * ch });
  const centerCovered = Array.from({ length: rows }, () => Array(cols).fill(false));
  const cellRange = (x, y, size) => ({
    c0: Math.max(0, Math.floor((x - size / 2 + width / 2) / cw)),
    c1: Math.min(cols - 1, Math.floor((x + size / 2 + width / 2) / cw)),
    r0: Math.max(0, Math.floor((y - size / 2 + height / 2) / ch)),
    r1: Math.min(rows - 1, Math.floor((y + size / 2 + height / 2) / ch)),
  });
  const inside = (x, y, size, px, py) => Math.abs(px - x) <= size / 2 && Math.abs(py - y) <= size / 2;
  const newlyCovered = (x, y, size) => {
    const { c0, c1, r0, r1 } = cellRange(x, y, size);
    let count = 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (centerCovered[r][c]) continue;
        const p = cellCenter(c, r);
        if (inside(x, y, size, p.x, p.y)) count += 1;
      }
    }
    return count;
  };
  const markCovered = (x, y, size) => {
    const { c0, c1, r0, r1 } = cellRange(x, y, size);
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const p = cellCenter(c, r);
        if (inside(x, y, size, p.x, p.y)) centerCovered[r][c] = true;
      }
    }
  };

  // まだ覆われていないマスを 1 つ無作為に選ぶ(候補位置の種にする)
  const randomUncoveredCell = () => {
    const open = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) if (!centerCovered[r][c]) open.push({ r, c });
    return open.length ? open[Math.floor(random() * open.length)] : null;
  };

  const placed = [];
  for (const it of items) {
    const halfX = Math.max(0, width / 2 - it.size * (0.5 - overflow));
    const halfY = Math.max(0, height / 2 - it.size * (0.5 - overflow));
    const options = [];
    for (let k = 0; k < candidates; k += 1) {
      let x = (random() * 2 - 1) * halfX;
      let y = (random() * 2 - 1) * halfY;
      // 候補の半分は「未被覆のマスを含む位置」にする。後半のタイルが残った穴を狙えるように
      if (k % 2 === 1) {
        const open = randomUncoveredCell();
        if (open) {
          const p = cellCenter(open.c, open.r);
          x = clamp(p.x + (random() * 2 - 1) * (it.size / 2 - cw), -halfX, halfX);
          y = clamp(p.y + (random() * 2 - 1) * (it.size / 2 - ch), -halfY, halfY);
        }
      }
      options.push({ x, y, score: newlyCovered(x, y, it.size) });
    }
    options.sort((a, b) => b.score - a.score);
    const pick = options[Math.floor(random() * Math.min(3, options.length))];
    placed.push({ ...it, x: pick.x, y: pick.y, layer: 0, filler: false });
    markCovered(pick.x, pick.y, it.size);
  }

  // --- 1.5 細い隙間を閉じる: 全タイルを同じ比率で少し拡大(枠からはみ出す分は内側にずらす) ---
  if (grow > 0) {
    for (const p of placed) {
      p.size = Math.min(p.size * (1 + grow), short);
      p.x = clamp(p.x, -width / 2 + p.size / 2, width / 2 - p.size / 2);
      p.y = clamp(p.y, -height / 2 + p.size / 2, height / 2 - p.size / 2);
    }
  }

  // --- 2. 隙間を探して埋める ---
  // 格子は 1. で作ったものを使う(枠をちょうど割り切るので、端のマスが枠の外にはみ出さない)
  const covers = (tile, px, py) =>
    Math.abs(px - tile.x) <= tile.size / 2 && Math.abs(py - tile.y) <= tile.size / 2;
  // マス全体(四隅)が入っていて初めて「覆われている」とみなす。中心だけだと細い隙間が残る
  // 枠の縁に接するタイルで浮動小数の誤差が出ないよう、わずかに余裕を持たせる
  const eps = short * 1e-6;

  // マスの矩形がタイルの和集合で完全に覆われているかを厳密に判定する。
  // マスに重なるタイルをマスで切り抜き、その辺の座標で小矩形に分割して、
  // どの小矩形もどれかのタイルに入っていれば被覆。点のサンプリングと違って細い隙間を見逃さない。
  const cellCovered = (x0, x1, y0, y1) => {
    const clipped = [];
    for (const tile of placed) {
      const tx0 = Math.max(x0, tile.x - tile.size / 2);
      const tx1 = Math.min(x1, tile.x + tile.size / 2);
      const ty0 = Math.max(y0, tile.y - tile.size / 2);
      const ty1 = Math.min(y1, tile.y + tile.size / 2);
      if (tx1 - tx0 > eps && ty1 - ty0 > eps) clipped.push([tx0, tx1, ty0, ty1]);
    }
    if (clipped.length === 0) return false;
    const xs = [...new Set([x0, x1, ...clipped.flatMap((r) => [r[0], r[1]])])].sort((a, b) => a - b);
    const ys = [...new Set([y0, y1, ...clipped.flatMap((r) => [r[2], r[3]])])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i += 1) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      if (xs[i + 1] - xs[i] <= eps) continue;
      for (let j = 0; j < ys.length - 1; j += 1) {
        if (ys[j + 1] - ys[j] <= eps) continue;
        const my = (ys[j] + ys[j + 1]) / 2;
        if (!clipped.some((r) => mx >= r[0] && mx <= r[1] && my >= r[2] && my <= r[3])) return false;
      }
    }
    return true;
  };
  const coverage = () => {
    const grid = Array.from({ length: rows }, () => Array(cols).fill(false));
    for (let r = 0; r < rows; r += 1) {
      const y0 = -height / 2 + r * ch;
      for (let c = 0; c < cols; c += 1) {
        const x0 = -width / 2 + c * cw;
        grid[r][c] = cellCovered(x0, x0 + cw, y0, y0 + ch);
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

  // 被覆グリッドは最初に全体を計算し、以後は足したタイルの範囲だけ更新する
  const grid = coverage();
  const refresh = (tile) => {
    const c0 = Math.max(0, Math.floor((tile.x - tile.size / 2 + width / 2) / cw));
    const c1 = Math.min(cols - 1, Math.floor((tile.x + tile.size / 2 + width / 2) / cw));
    const r0 = Math.max(0, Math.floor((tile.y - tile.size / 2 + height / 2) / ch));
    const r1 = Math.min(rows - 1, Math.floor((tile.y + tile.size / 2 + height / 2) / ch));
    for (let r = r0; r <= r1; r += 1) {
      const y0 = -height / 2 + r * ch;
      for (let c = c0; c <= c1; c += 1) {
        const x0 = -width / 2 + c * cw;
        grid[r][c] = cellCovered(x0, x0 + cw, y0, y0 + ch);
      }
    }
  };

  for (let guard = 0; guard < 400; guard += 1) {
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
    const boxW = (maxC - minC + 1) * cw;
    const boxH = (maxR - minR + 1) * ch;
    const size = uniform
      ? uniformSize
      : clamp(Math.max(boxW, boxH) * 1.15 + cell, short * minSizeRatio, short * maxFillerRatio);
    // 隙間が 1 枚で覆える大きさなら隙間の中心に。大きすぎるなら、最初に見つけた未被覆マスを
    // 必ず含む位置(そのマスを左下の角にする)に置いて、少しずつ埋めていく。
    // 枠からはみ出す分は内側にずらす(ずらしても最初のマスは含んだまま)
    const fits = size >= boxW && size >= boxH;
    const sc = cellCenter(start.c, start.r);
    const wantX = fits ? -width / 2 + ((minC + maxC + 1) / 2) * cw : sc.x - cw / 2 + size / 2;
    const wantY = fits ? -height / 2 + ((minR + maxR + 1) / 2) * ch : sc.y - ch / 2 + size / 2;
    const cx = clamp(wantX, -width / 2 + size / 2, width / 2 - size / 2);
    const cy = clamp(wantY, -height / 2 + size / 2, height / 2 - size / 2);
    const filler = { track: nextFillerTrack(), size, x: cx, y: cy, layer: 0, filler: true };
    placed.push(filler);
    refresh(filler);
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
