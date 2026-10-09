// 3D 版: スマホ縦横比の画面に、同じ大きさのジャケット板を隙間なく貼ったコラージュ。
//   - 配置は layout.js の collageFill()(2D 版と共用)。すべて枠内、長方形を必ず埋める
//   - 重なった板は 1 つ上の層に積む(z 座標)
//   - カーソルに一番近い板が最前面の層よりさらに手前に浮く。周囲はわずかに持ち上がる
//   - クリック(タッチは 2 回目のタップ)で Spotify を開く
//   - 何も動いていないフレームは描画しない

import * as THREE from "three";
import { collageFill, placeholderColor, readIndexEntries } from "./layout.js";
import { hideLoading, setCaption } from "./chrome.js";

const DATA_DIR = "data";
const VIEW_HEIGHT = 8; // 画面(canvas)の高さに相当するワールド単位。幅は canvas の縦横比から決める
const TILE_DEPTH = 0.08; // 板の厚み
const LAYER_GAP = TILE_DEPTH + 0.02; // 重なった板を積む間隔
const FLY_DISTANCE = -9; // 出入りするときの奥行き
const FOCUS_LIFT = 0.9; // カーソルに一番近い板が、最前面の層からさらに浮く高さ
const FOCUS_REACH = 0.3; // 板の縁からこの距離までなら「近い」とみなす
const NEIGHBOR_LIFT = 0.1; // 周囲の板がわずかに持ち上がる高さ
const NEIGHBOR_RADIUS = 1.6; // その広がり

// ---------- レンダラー / シーン / カメラ ----------

const canvas = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0c); // 板で埋まる前提

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

// z=0 の面で高さ VIEW_HEIGHT がちょうど画面に収まるカメラ距離(余白なし)
function fitDistance() {
  return VIEW_HEIGHT / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}

// ジャケットは MeshBasicMaterial(照明なし)で、画像の色をそのまま出す
const sideMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2a30 }); // 板の側面(厚み)。背景と区別がつく程度の濃いグレー

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const maxAnisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

function prepareTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

// 画像が無い/読めないときの代わり。ここは自前の絵なので文字を乗せてよい。
function createPlaceholderTexture(track) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = placeholderColor(track.name);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "500 40px ui-monospace, Menlo, monospace";
  ctx.fillText(`#${track.rank}`, 36, 76);
  ctx.font = "500 34px ui-monospace, Menlo, monospace";
  ctx.fillText(track.name.slice(0, 14), 36, size - 96);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "26px ui-monospace, Menlo, monospace";
  ctx.fillText(track.artist.slice(0, 18), 36, size - 52);
  return prepareTexture(new THREE.CanvasTexture(c));
}

function loadJacketTexture(track, onReady) {
  if (!track.image_url) {
    onReady(createPlaceholderTexture(track));
    return;
  }
  textureLoader.load(
    track.image_url,
    (texture) => onReady(prepareTexture(texture)),
    undefined,
    () => onReady(createPlaceholderTexture(track)),
  );
}

// ---------- 板の生成 ----------

function createTile(track, size) {
  const frontMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, TILE_DEPTH),
    [sideMaterial, sideMaterial, sideMaterial, sideMaterial, frontMaterial, sideMaterial],
  );
  loadJacketTexture(track, (texture) => {
    frontMaterial.map = texture;
    frontMaterial.color.set(0xffffff);
    frontMaterial.needsUpdate = true;
    requestRender();
  });
  mesh.userData = {
    track,
    size,
    base: new THREE.Vector3(),
    focus: 0, // 0..1 で「最前面に浮いている」度合いをなめらかに追従
    tween: null,
  };
  return mesh;
}

function disposeTile(mesh) {
  mesh.geometry.dispose();
  const front = mesh.material[4];
  front.map?.dispose();
  front.dispose();
}

// ---------- 入れ替え ----------

const tilesRoot = new THREE.Group();
scene.add(tilesRoot);
let tiles = [];
let focused = null; // カーソルに一番近い板
let topZ = 0; // 一番上の層の z

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function startTween(mesh, { duration, delay = 0, ease = easeOutCubic }) {
  mesh.userData.tween = { duration, delay, ease, start: clock.elapsedTime };
}

function showCollage(data) {
  for (const mesh of tiles) {
    tilesRoot.remove(mesh);
    disposeTile(mesh);
  }
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const placements = collageFill(data.tracks || [], { width: VIEW_HEIGHT * aspect, height: VIEW_HEIGHT });
  topZ = Math.max(0, ...placements.map((p) => p.layer)) * LAYER_GAP;
  tiles = placements.map(({ track, size, x, y, layer }, i) => {
    const mesh = createTile(track, size);
    mesh.userData.base.set(x, y, layer * LAYER_GAP);
    mesh.position.copy(mesh.userData.base).setZ(FLY_DISTANCE);
    mesh.scale.setScalar(0.4);
    tilesRoot.add(mesh);
    startTween(mesh, { duration: 0.8, delay: 0.02 * i });
    return mesh;
  });
  focused = null;
  setCaption(null);
  requestRender();
}

// ---------- 毎フレームの更新 ----------

const clock = new THREE.Clock();

// カーソルのワールド座標(z=0 の面上)と、その有効度 0..1
const cursor = {
  point: new THREE.Vector3(),
  target: new THREE.Vector3(),
  strength: 0,
  active: false,
};
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// 位置と強さをなめらかに追従させる。まだ動いていれば true
function updateCursor() {
  const targetStrength = cursor.active ? 1 : 0;
  const moving =
    cursor.point.distanceToSquared(cursor.target) > 1e-6 || Math.abs(cursor.strength - targetStrength) > 1e-3;
  if (!moving) {
    cursor.point.copy(cursor.target);
    cursor.strength = targetStrength;
    return false;
  }
  cursor.point.lerp(cursor.target, 0.18);
  cursor.strength += (targetStrength - cursor.strength) * 0.1;
  return true;
}

// まだ動いていれば true を返す
function updateTile(mesh, t) {
  const data = mesh.userData;
  const { base } = data;

  if (data.tween) {
    const tw = data.tween;
    const p = Math.min(1, Math.max(0, (t - tw.start - tw.delay) / tw.duration));
    const e = tw.ease(p);
    mesh.position.set(base.x, base.y, THREE.MathUtils.lerp(FLY_DISTANCE, base.z, e));
    mesh.scale.setScalar(THREE.MathUtils.lerp(0.4, 1, e));
    if (p >= 1) data.tween = null;
    return true;
  }

  const focusTarget = mesh === focused ? 1 : 0;
  const moving = Math.abs(data.focus - focusTarget) > 1e-3;
  data.focus = moving ? data.focus + (focusTarget - data.focus) * 0.14 : focusTarget;

  const dx = cursor.point.x - base.x;
  const dy = cursor.point.y - base.y;
  const g = Math.exp(-(dx * dx + dy * dy) / (NEIGHBOR_RADIUS * NEIGHBOR_RADIUS)) * cursor.strength;

  const z = THREE.MathUtils.lerp(base.z + NEIGHBOR_LIFT * g, topZ + FOCUS_LIFT, data.focus);
  mesh.position.set(base.x, base.y, z);
  mesh.scale.setScalar(1 + 0.04 * data.focus);
  return moving;
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  const ratio = renderer.getPixelRatio();
  if (canvas.width === Math.floor(w * ratio) && canvas.height === Math.floor(h * ratio)) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, fitDistance());
  camera.lookAt(0, 0, 0);
  needsRender = true;
}

// 何かが動いているときだけ描画する
let needsRender = true;
function requestRender() {
  needsRender = true;
}

function animate() {
  requestAnimationFrame(animate);
  resize();
  const t = clock.getElapsedTime();
  let active = updateCursor();
  for (const mesh of tiles) if (updateTile(mesh, t)) active = true;
  if (!active && !needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
}

// ---------- ポインタ ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// レイで当たった板(クリック用。重なりの一番上が返る)
function pickTile(event) {
  updatePointer(event);
  const hit = raycaster.intersectObjects(tiles.filter((m) => !m.userData.tween), false)[0];
  return hit ? hit.object : null;
}

// カーソル位置に中心が一番近い板。縁から FOCUS_REACH 以上離れていたら無し
function nearestTile(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const mesh of tiles) {
    if (mesh.userData.tween) continue;
    const { base, size } = mesh.userData;
    const distance = Math.hypot(point.x - base.x, point.y - base.y);
    if (distance > size / 2 + FOCUS_REACH) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mesh;
    }
  }
  return best;
}

function setFocused(next) {
  if (next === focused) return;
  focused = next;
  setCaption(focused?.userData.track || null);
  canvas.style.cursor = focused ? "pointer" : "";
  requestRender();
}

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  updatePointer(event);
  const hit = raycaster.ray.intersectPlane(plane, cursor.target);
  cursor.active = hit !== null;
  requestRender();
  setFocused(hit ? nearestTile(cursor.target) : null);
});

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return; // タッチは指を離すたびに leave が来るので無視
  cursor.active = false;
  setFocused(null);
  requestRender();
});

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY, wasFocused: focused };
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  const { wasFocused } = pointerDown;
  pointerDown = null;
  if (moved > 6) return;

  updatePointer(event);
  const onPlane = raycaster.ray.intersectPlane(plane, cursor.target) !== null;
  const nearest = onPlane ? nearestTile(cursor.target) : null;

  if (event.pointerType === "touch") {
    // タッチにはホバーが無いので、1 回目のタップで浮かせ、浮いているものをもう一度タップしたら開く
    cursor.active = onPlane;
    if (nearest && nearest === wasFocused) {
      const url = nearest.userData.track.spotify_url;
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    setFocused(nearest);
    return;
  }

  // マウス: 浮いている板がカーソルの下にあればそれ、無ければレイで当たったもの
  const hit = pickTile(event);
  const target = hit === focused ? focused : hit || focused;
  const url = target?.userData.track.spotify_url;
  if (url) window.open(url, "_blank", "noopener");
});

// ---------- データの読み込み ----------

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  requestAnimationFrame(animate);
  try {
    const entries = readIndexEntries(await fetchJson(`${DATA_DIR}/index.json`));
    if (entries.length === 0) throw new Error("no entries");
    const data = await fetchJson(`${DATA_DIR}/${entries[0].file}.json`); // 一覧の先頭(最新)を表示
    showCollage(data);
  } catch (error) {
    console.error(error);
    setCaption({ rank: "-", name: "データの読み込みに失敗しました", artist: "" });
  } finally {
    hideLoading();
  }
}

main();
