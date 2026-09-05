// 3D 版(デフォルト): 7x7 の配置をそのまま 3D 空間に置き、各曲を CD のジュエルケースにする。
//   - 透明プラスチックの箱(MeshPhysicalMaterial)の中に、ジャケットを貼った紙とトレイ
//   - カーソルの真下を頂点にして周囲のケースがなだらかに持ち上がる、クリックで Spotify を開く
//   - 月の切り替えはケースが奥に飛んでいって入れ替わる

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  GRID_SIZE,
  assignSizes,
  layout,
  placeholderColor,
  readIndexEntries,
} from "./layout.js";

const DATA_DIR = "data";
const CELL = 1; // 1 マスの大きさ(ワールド単位)
const GAP = 0.12; // ケース同士の隙間
const CASE_DEPTH = 0.1;
const FLY_DISTANCE = -9; // 出入りするときの奥行き
const LIFT_HEIGHT = 1.0; // カーソル直下のケースが持ち上がる高さ
const LIFT_RADIUS = 1.6; // 盛り上がりの広がり(マス単位)
const TILT = 0.28; // 盛り上がりの斜面に沿ってケースが傾く強さ

// ---------- レンダラー / シーン ----------

// 画質: "high" はガラスの屈折あり、"low" は半透明のみ(屈折はシーンをもう 1 回描くので重い)。
// ?quality=low / ?quality=high で固定。指定が無ければ起動直後のフレームレートで自動判定する。
const QUALITY_PARAM = new URLSearchParams(location.search).get("quality");
let quality = QUALITY_PARAM === "low" || QUALITY_PARAM === "high" ? QUALITY_PARAM : "high";
const autoQuality = !QUALITY_PARAM;

const canvas = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === "low" ? 1 : 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0c);
scene.fog = new THREE.Fog(0x0b0b0c, 16, 30);

// 透明プラスチックの映り込み用に部屋っぽい環境マップを作る
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0.8, 12);

// グリッド全体(7x7)が画面に収まるカメラ距離。縦長画面では幅に合わせる。
function fitDistance(aspect) {
  const halfHeight = (GRID_SIZE / 2) * CELL * 1.45; // 余白込み
  const halfWidth = (GRID_SIZE / 2) * CELL * 1.15;
  const vFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const byHeight = halfHeight / Math.tan(vFov);
  const byWidth = halfWidth / (Math.tan(vFov) * aspect);
  return Math.max(byHeight, byWidth);
}
let autoFit = true; // ユーザーが操作するまでは画面サイズに追従

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 18;
controls.minPolarAngle = Math.PI / 2 - 0.55;
controls.maxPolarAngle = Math.PI / 2 + 0.35;
controls.minAzimuthAngle = -0.7;
controls.maxAzimuthAngle = 0.7;
controls.addEventListener("start", () => {
  autoFit = false;
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x202028, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(4, 6, 8);
scene.add(key);
const rim = new THREE.PointLight(0x8fb8ff, 30, 30);
rim.position.set(-6, 3, -4);
scene.add(rim);

// ---------- マテリアル(共有) ----------

// ガラス。transmission(屈折)で中のジャケットをガラス越しに見せる。
// opacity での半透明と違い、厚み(thickness)と屈折率(ior)で光が曲がり、縁に環境が映り込む。
const shellMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 1, // 1 = 完全に透過(ガラス)
  thickness: 0.2, // 屈折の計算に使う疑似的な厚み。大きいほど歪む(ジャケットもぼやける)
  ior: 1.5, // ガラスの屈折率
  roughness: 0.03, // 小さいほど澄んだガラス。0.2 くらいで曇りガラス
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  envMapIntensity: 1.6,
  specularIntensity: 1,
  attenuationColor: new THREE.Color(0xdde8ff), // 厚みを通る光がわずかに青みがかる
  attenuationDistance: 3,
});

function applyQuality(next) {
  quality = next;
  if (quality === "low") {
    // 屈折をやめて、以前の「半透明の膜」に戻す(シェーダーが変わるので needsUpdate)
    shellMaterial.transmission = 0;
    shellMaterial.transparent = true;
    shellMaterial.opacity = 0.18;
    shellMaterial.depthWrite = false;
    renderer.setPixelRatio(1);
  } else {
    shellMaterial.transmission = 1;
    shellMaterial.transparent = false;
    shellMaterial.opacity = 1;
    shellMaterial.depthWrite = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }
  shellMaterial.needsUpdate = true;
  document.documentElement.dataset.quality = quality;
  requestRender();
}
const trayMaterial = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55 });
const paperBackMaterial = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9 });

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

// ---------- ケースの生成 ----------

function createCase(track, span) {
  const size = span * CELL - GAP;
  const group = new THREE.Group();

  // ジャケット(紙)。前面だけテクスチャ、それ以外は黒い紙。
  const paperSize = size * 0.94;
  const frontMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(paperSize, paperSize, 0.012),
    [paperBackMaterial, paperBackMaterial, paperBackMaterial, paperBackMaterial, frontMaterial, paperBackMaterial],
  );
  paper.position.z = CASE_DEPTH * 0.28;
  group.add(paper);
  loadJacketTexture(track, (texture) => {
    frontMaterial.map = texture;
    frontMaterial.color.set(0xffffff);
    frontMaterial.needsUpdate = true;
    requestRender();
  });

  // トレイ(中の黒いプラスチック)
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(paperSize, paperSize, CASE_DEPTH * 0.5),
    trayMaterial,
  );
  tray.position.z = -CASE_DEPTH * 0.05;
  group.add(tray);

  // 外側のガラスケース。角を丸めるとエッジにハイライトが乗ってガラスらしくなる
  const shell = new THREE.Mesh(
    new RoundedBoxGeometry(size, size, CASE_DEPTH, 3, Math.min(0.035, size * 0.06)),
    shellMaterial,
  );
  group.add(shell);

  group.userData = {
    track,
    hitTarget: shell,
    base: new THREE.Vector3(),
    tween: null,
  };
  return group;
}

function disposeCase(group) {
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material === shellMaterial || material === trayMaterial || material === paperBackMaterial) continue;
      material.map?.dispose();
      material.dispose();
    }
  });
}

// ---------- 月ごとの入れ替え ----------

const casesRoot = new THREE.Group();
scene.add(casesRoot);
let cases = [];
let hovered = null;

function gridPosition(col, row, span) {
  const x = (col - 1 + span / 2 - GRID_SIZE / 2) * CELL;
  const y = (GRID_SIZE / 2 - (row - 1 + span / 2)) * CELL;
  return new THREE.Vector3(x, y, 0);
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

function startTween(group, { from, to, duration, delay = 0, ease = easeOutCubic, onDone }) {
  group.userData.tween = { from, to, duration, delay, ease, onDone, start: clock.elapsedTime };
}

function showMonth(data) {
  const tracks = assignSizes(data.tracks || []);
  const placements = layout(tracks);
  cases = placements.map(({ track, span, col, row }, i) => {
    const group = createCase(track, span);
    group.userData.base.copy(gridPosition(col, row, span));
    group.position.copy(group.userData.base).setZ(FLY_DISTANCE);
    group.rotation.set(0, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 0.6);
    group.scale.setScalar(0.4);
    casesRoot.add(group);
    startTween(group, { from: "fly", to: "rest", duration: 0.9, delay: 0.05 * i });
    return group;
  });
}

function hideMonth(onDone) {
  const old = cases;
  cases = [];
  hovered = null;
  setCaption(null);
  if (old.length === 0) {
    onDone();
    return;
  }
  let remaining = old.length;
  old.forEach((group, i) => {
    startTween(group, {
      from: "rest",
      to: "fly",
      duration: 0.5,
      delay: 0.02 * i,
      ease: easeInCubic,
      onDone: () => {
        casesRoot.remove(group);
        disposeCase(group);
        remaining -= 1;
        if (remaining === 0) onDone();
      },
    });
  });
}

// ---------- 毎フレームの更新 ----------

const clock = new THREE.Clock();
const tmpEuler = new THREE.Euler();
const restQuat = new THREE.Quaternion();

// カーソルのワールド座標(グリッドの面 z=0 上)と、その有効度 0..1
const cursor = {
  point: new THREE.Vector3(0, 0, 0),
  target: new THREE.Vector3(0, 0, 0),
  strength: 0,
  active: false,
};
const gridPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// 位置と強さをなめらかに追従させる(急に跳ねない)。まだ動いていれば true。
function updateCursor() {
  const targetStrength = cursor.active ? 1 : 0;
  const moving = cursor.point.distanceToSquared(cursor.target) > 1e-6 || Math.abs(cursor.strength - targetStrength) > 1e-3;
  if (!moving) {
    cursor.point.copy(cursor.target);
    cursor.strength = targetStrength;
    return false;
  }
  cursor.point.lerp(cursor.target, 0.18);
  cursor.strength += (targetStrength - cursor.strength) * 0.1;
  return true;
}

function updateCase(group, t) {
  const data = group.userData;
  const { base } = data;

  // 出入りのアニメーション
  if (data.tween) {
    const tw = data.tween;
    const p = Math.min(1, Math.max(0, (t - tw.start - tw.delay) / tw.duration));
    const e = tw.ease(p);
    const toRest = tw.to === "rest";
    const k = toRest ? e : 1 - e;
    group.position.set(base.x, base.y, THREE.MathUtils.lerp(FLY_DISTANCE, 0, k));
    group.scale.setScalar(THREE.MathUtils.lerp(0.4, 1, k));
    if (toRest) {
      group.quaternion.slerp(restQuat, e);
    } else {
      group.rotation.y += 0.04;
    }
    if (p >= 1) {
      data.tween = null;
      tw.onDone?.();
    }
    return;
  }

  // カーソルの真下を頂点にした盛り上がり。
  // 高さはガウス関数 exp(-r^2 / R^2)、傾きはその斜面(勾配)に沿わせる。
  const dx = cursor.point.x - base.x;
  const dy = cursor.point.y - base.y;
  const g = Math.exp(-(dx * dx + dy * dy) / (LIFT_RADIUS * LIFT_RADIUS)) * cursor.strength;

  group.position.set(base.x, base.y, LIFT_HEIGHT * g);
  group.scale.setScalar(1 + 0.04 * g);

  // 頂点(カーソル)に向かって面が起き上がるように傾ける。
  // カーソルが右にあれば右端が手前に(rotation.y < 0)、上にあれば上端が手前に(rotation.x > 0)。
  tmpEuler.set(TILT * dy * g, -TILT * dx * g, 0);
  group.quaternion.setFromEuler(tmpEuler);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width === Math.floor(w * renderer.getPixelRatio()) && canvas.height === Math.floor(h * renderer.getPixelRatio())) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  needsRender = true;
  if (autoFit) {
    const distance = fitDistance(camera.aspect);
    camera.position.set(0, 0.6, distance);
    controls.minDistance = Math.min(controls.minDistance, distance * 0.6);
    controls.maxDistance = Math.max(controls.maxDistance, distance * 1.5);
  }
}

// 何かが動いているときだけ描画する(止まっていれば GPU を使わない)
let needsRender = true;
function requestRender() {
  needsRender = true;
}
controls.addEventListener("change", requestRender);

// 自動画質: 実際に描画したフレームの所要時間を測り、遅ければ low に落とす
const probe = { samples: [], done: !autoQuality, last: 0 };
function probeFrame(now) {
  if (probe.done) return;
  if (probe.last) probe.samples.push(now - probe.last);
  probe.last = now;
  // 入場アニメーション中の 60 フレーム、または描画時間の合計 1.5 秒ぶんを見る
  // (遅い端末ほどフレーム数が稼げないので、時間でも打ち切る)
  const total = probe.samples.reduce((sum, v) => sum + v, 0);
  if (probe.samples.length < 60 && (total < 1500 || probe.samples.length < 5)) return;
  probe.done = true;
  const sorted = probe.samples.slice(Math.min(10, probe.samples.length - 5)).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median > 1000 / 40) {
    console.info(`frame ${median.toFixed(1)}ms → quality: low`);
    applyQuality("low");
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  resize();
  const t = clock.getElapsedTime();

  let active = updateCursor();
  for (const group of casesRoot.children) {
    updateCase(group, t);
    if (group.userData.tween) active = true;
  }
  if (controls.update()) active = true; // ダンピング中も true

  if (!active && !needsRender) {
    probe.last = 0; // 描いていない間は計測しない
    return;
  }
  needsRender = false;
  renderer.render(scene, camera);
  renderCount += 1;
  probeFrame(now);
}
let renderCount = 0; // 動作確認用(?debug=1 で window.__renders から読める)
if (new URLSearchParams(location.search).has("debug")) {
  Object.defineProperty(window, "__renders", { get: () => renderCount });
  window.__probe = probe;
}

// ---------- ホバー / クリック ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const caption = document.getElementById("caption");
let pointerDown = null;

function setCaption(track) {
  caption.replaceChildren();
  if (!track) return;
  const name = document.createElement("strong");
  name.textContent = `#${track.rank} ${track.name}`;
  caption.append(name, ` / ${track.artist}`);
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
}

function pickCase(event) {
  updatePointer(event);
  const targets = cases.filter((g) => !g.userData.tween).map((g) => g.userData.hitTarget);
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit ? hit.object.parent : null;
}

canvas.addEventListener("pointermove", (event) => {
  // カーソルがグリッドの面のどこを指しているか(ケースの外でも盛り上がる)
  updatePointer(event);
  const hit = raycaster.ray.intersectPlane(gridPlane, cursor.target);
  cursor.active = hit !== null;
  requestRender();

  const next = pickCase(event);
  if (next !== hovered) {
    hovered = next;
    setCaption(hovered?.userData.track || null);
    canvas.style.cursor = hovered ? "pointer" : "";
  }
});

canvas.addEventListener("pointerleave", () => {
  cursor.active = false;
  requestRender();
  hovered = null;
  setCaption(null);
  canvas.style.cursor = "";
});

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved > 6) return; // ドラッグ(回転)はクリック扱いにしない
  const target = pickCase(event);
  const url = target?.userData.track.spotify_url;
  if (url) window.open(url, "_blank", "noopener");
});

// ---------- 月のナビゲーション ----------

const navEl = document.querySelector(".nav");
const titleEl = document.getElementById("month-title");
const prevButton = document.getElementById("prev");
const nextButton = document.getElementById("next");
let entries = []; // 表示するページの一覧(月やプレイリストなど)
let current = 0; // entries は新しい順なので、prev = 古いもの = index + 1
let switching = false;

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function goTo(index) {
  if (switching || index < 0 || index >= entries.length) return;
  switching = true;
  current = index;
  const entry = entries[current];
  prevButton.disabled = current >= entries.length - 1;
  nextButton.disabled = current <= 0;
  titleEl.textContent = entry.label;
  // ページが 1 つだけなら見出しも矢印も要らない
  navEl.hidden = entries.length <= 1;

  let data;
  try {
    data = await fetchJson(`${DATA_DIR}/${entry.file}.json`);
  } catch (error) {
    console.error(error);
    data = { tracks: [] };
  }
  if (data.demo) {
    const small = document.createElement("small");
    small.textContent = "サンプル";
    titleEl.append(small);
  }
  hideMonth(() => {
    showMonth(data);
    switching = false;
    requestRender();
  });
}

prevButton.addEventListener("click", () => goTo(current + 1));
nextButton.addEventListener("click", () => goTo(current - 1));
window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") goTo(current + 1);
  if (event.key === "ArrowRight") goTo(current - 1);
});

async function main() {
  applyQuality(quality);
  requestAnimationFrame(animate);
  try {
    entries = readIndexEntries(await fetchJson(`${DATA_DIR}/index.json`));
    if (entries.length === 0) {
      titleEl.textContent = "まだデータがありません";
    } else {
      await goTo(0);
    }
  } catch (error) {
    console.error(error);
    titleEl.textContent = "読み込みに失敗しました";
  } finally {
    document.getElementById("loading").classList.add("is-hidden");
  }
}

main();
