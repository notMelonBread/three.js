// 7x7 グリッドへの配置アルゴリズム(2D 版・3D 版で共用)
//
// large(3x3) / medium(2x2) / small(1x1) のタイルを、大きい順に
// 「置ける場所を全部列挙 → シャッフルして 1 つ選ぶ」で敷き詰める。

export const GRID_SIZE = 7;
export const SPAN = { large: 3, medium: 2, small: 1 };
const MAX_LAYOUT_RETRIES = 200;

export function shuffle(array) {
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
