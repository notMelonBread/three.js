// 3D 版: 7x7 の配置をそのまま 3D 空間に置き、各曲を CD のジュエルケースにする。
//   - 透明プラスチックの箱(MeshPhysicalMaterial)の中に、ジャケットを貼った紙とトレイ
//   - ホバーで持ち上がって少し回る(Raycaster)、クリックで Spotify を開く
//   - 月の切り替えはケースが奥に飛んでいって入れ替わる

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  GRID_SIZE,
  assignSizes,
  formatMonth,
  layout,
  placeholderColor,
} from "./layout.js";

const DATA_DIR = "data";
const CELL = 1; // 1 マスの大きさ(ワールド単位)
const GAP = 0.12; // ケース同士の隙間
const CASE_DEPTH = 0.1;
const FLY_DISTANCE = -9; // 出入りするときの奥行き

// ---------- レンダラー / シーン ----------

const canvas = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

const shellMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.06,
  metalness: 0,
  transparent: true,
  opacity: 0.16,
  clearcoat: 1,
  clearcoatRoughness: 0.08,
  envMapIntensity: 1.4,
  depthWrite: false,
});
const trayMaterial = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55 });
const paperBackMaterial = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9 });

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

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
  });

  // トレイ(中の黒いプラスチック)
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(paperSize, paperSize, CASE_DEPTH * 0.5),
    trayMaterial,
  );
  tray.position.z = -CASE_DEPTH * 0.05;
  group.add(tray);

  // 外側の透明ケース
  const shell = new THREE.Mesh(new THREE.BoxGeometry(size, size, CASE_DEPTH), shellMaterial);
  shell.renderOrder = 1;
  group.add(shell);

  group.userData = {
    track,
    hitTarget: shell,
    base: new THREE.Vector3(),
    phase: Math.random() * Math.PI * 2,
    hover: 0, // 0..1 でホバー状態を滑らかに
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
const tmpQuat = new THREE.Quaternion();
const restQuat = new THREE.Quaternion();
const hoverQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.45, 0));

function updateCase(group, t) {
  const data = group.userData;
  const { base, phase } = data;

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

  // ホバー状態を 0..1 でなめらかに追従
  const target = group === hovered ? 1 : 0;
  data.hover += (target - data.hover) * 0.12;
  const h = data.hover;

  // アイドル時のゆらぎ + ホバーで持ち上げ
  const bob = Math.sin(t * 1.1 + phase) * 0.025;
  group.position.set(base.x, base.y + bob, THREE.MathUtils.lerp(0, 0.9, h));
  group.scale.setScalar(1 + 0.06 * h);

  const idleY = Math.sin(t * 0.6 + phase) * 0.05;
  tmpQuat.setFromEuler(new THREE.Euler(0, idleY, 0));
  group.quaternion.copy(tmpQuat).slerp(hoverQuat, h);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width === Math.floor(w * renderer.getPixelRatio()) && canvas.height === Math.floor(h * renderer.getPixelRatio())) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (autoFit) {
    const distance = fitDistance(camera.aspect);
    camera.position.set(0, 0.6, distance);
    controls.minDistance = Math.min(controls.minDistance, distance * 0.6);
    controls.maxDistance = Math.max(controls.maxDistance, distance * 1.5);
  }
}

function animate() {
  resize();
  const t = clock.getElapsedTime();
  for (const group of casesRoot.children) updateCase(group, t);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
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

function pickCase(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const targets = cases.filter((g) => !g.userData.tween).map((g) => g.userData.hitTarget);
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit ? hit.object.parent : null;
}

canvas.addEventListener("pointermove", (event) => {
  const next = pickCase(event);
  if (next !== hovered) {
    hovered = next;
    setCaption(hovered?.userData.track || null);
    canvas.style.cursor = hovered ? "pointer" : "";
  }
});

canvas.addEventListener("pointerleave", () => {
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

const titleEl = document.getElementById("month-title");
const prevButton = document.getElementById("prev");
const nextButton = document.getElementById("next");
let months = [];
let current = 0; // months は新しい順なので、prev = 古い月 = index + 1
let switching = false;

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function goTo(index) {
  if (switching || index < 0 || index >= months.length) return;
  switching = true;
  current = index;
  const key = months[current];
  prevButton.disabled = current >= months.length - 1;
  nextButton.disabled = current <= 0;
  titleEl.textContent = formatMonth(key);

  let data;
  try {
    data = await fetchJson(`${DATA_DIR}/${key}.json`);
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
  });
}

prevButton.addEventListener("click", () => goTo(current + 1));
nextButton.addEventListener("click", () => goTo(current - 1));
window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") goTo(current + 1);
  if (event.key === "ArrowRight") goTo(current - 1);
});

async function main() {
  animate();
  try {
    const index = await fetchJson(`${DATA_DIR}/index.json`);
    months = (index.months || []).slice().sort().reverse();
    if (months.length === 0) {
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
