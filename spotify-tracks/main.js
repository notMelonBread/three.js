// 3D 版(デフォルト): 7x7 の配置をそのまま 3D 空間に置き、各曲を CD のジュエルケースにする。
//   - 透明プラスチックの箱(MeshPhysicalMaterial)の中に、ジャケットを貼った紙とトレイ
//   - カーソルの真下を頂点にして周囲のケースがなだらかに持ち上がる、クリックで Spotify を開く
//   - 月の切り替えはケースが奥に飛んでいって入れ替わる

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { collageLayout, placeholderColor, readIndexEntries } from "./layout.js";

const DATA_DIR = "data";
const COLLAGE_SPAN = 7; // コラージュの長辺の長さ(ワールド単位)。横画面では高さ、縦画面では幅の基準
const CASE_DEPTH = 0.12; // ガラスの厚み
const LAYER_GAP = CASE_DEPTH + 0.03; // 重なったケースを積む間隔
const FLY_DISTANCE = -9; // 出入りするときの奥行き
const FOCUS_LIFT = 0.9; // カーソルに一番近いケースが、最前面の層からさらに浮く高さ
const FOCUS_REACH = 0.6; // ケースの縁からこの距離までなら「近い」とみなす
const NEIGHBOR_LIFT = 0.12; // 周囲のケースがわずかに持ち上がる高さ
const NEIGHBOR_RADIUS = 1.8; // その広がり

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

// ガラスの映り込み用の環境マップ。
// RoomEnvironment は正面から見たときに映るもの(カメラの背後)が暗く、ガラスに見えなかった。
// 代わりに、カメラの背後に撮影スタジオのような大きなライトパネルを置いた空間を作り、
// それを PMREM に焼く。正面向きのガラス面にはカメラ背後のものが映るので、
// 各ケースに柔らかい白い窓のような反射が乗り、傾けると滑って動く。
function createStudioEnvironment() {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x0a0a0c);
  const addPanel = (width, height, color, intensity, position) => {
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    material.color.multiplyScalar(intensity); // 1 を超える値で HDR の光源にする
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    panel.position.copy(position);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  };
  // 主光源: カメラの真後ろ、やや上に大きなソフトボックス。
  // 正面向きの面の反射方向は +z なので、+z のすぐ上に置くと各面の上側に白いグラデーションが乗り、
  // 上の段ほど強く映る(実物のガラス棚と同じ)。
  addPanel(14, 6, 0xffffff, 2.5, new THREE.Vector3(0, 4.5, 9));
  // 右に細長い冷たい光: エッジのハイライト用
  addPanel(1.2, 8, 0xd6e4ff, 6, new THREE.Vector3(7, 0, 5));
  // 左下から弱い帯: 下辺と左辺の縁取り
  addPanel(9, 0.8, 0xffffff, 2, new THREE.Vector3(-3, -6, 5));
  // 背後にごく弱い面: 真っ黒にならないように
  addPanel(12, 12, 0x30343c, 1, new THREE.Vector3(0, 0, -10));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(studio, 0.02).texture;
  pmrem.dispose();
  return texture;
}
scene.environment = createStudioEnvironment();

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0.8, 12);

// グリッド全体(7x7)が画面に収まるカメラ距離。縦長画面では幅に合わせる。
// 画面の縦横比に合わせたコラージュの大きさ。横画面は横長、縦画面(スマホ)は縦長にする
function collageDimsFor(aspect) {
  if (aspect >= 1) {
    return { width: THREE.MathUtils.clamp(COLLAGE_SPAN * aspect * 0.92, 5, 13), height: COLLAGE_SPAN };
  }
  const width = COLLAGE_SPAN * 0.78;
  return { width, height: THREE.MathUtils.clamp((width / aspect) * 0.92, 5, 12) };
}

function fitDistance(aspect) {
  const dims = collageDimsFor(aspect);
  const halfHeight = (dims.height / 2) * 1.22; // 余白込み
  const halfWidth = (dims.width / 2) * 1.1;
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
  thickness: CASE_DEPTH, // 屈折の計算に使う疑似的な厚み。大きいほど歪む(ジャケットもぼやける)
  ior: 1.5, // ガラスの屈折率
  roughness: 0.02, // 屈折像のぼけ。小さいほど澄んだガラス(ジャケットがはっきり見える)。0.2 で曇りガラス
  metalness: 0,
  clearcoat: 1, // 表面のもう一層の反射。ライトパネルの映り込みはここに乗る
  clearcoatRoughness: 0.18, // 映り込みの輪郭のぼけ具合(ソフトボックスの縁を柔らかく)
  envMapIntensity: 1.1,
  specularIntensity: 1,
  attenuationColor: new THREE.Color(0xd8e6ff), // 厚みを通る光がわずかに青みがかる
  attenuationDistance: 1.5,
  iridescence: 0.2, // 縁にうっすら虹色(薄膜干渉)。ガラスらしさの補助
  iridescenceIOR: 1.3,
});

function applyQuality(next) {
  quality = next;
  if (quality === "low") {
    // 屈折(重い)だけをやめる。クリアコートの映り込みは残るのでガラスには見える
    shellMaterial.transmission = 0;
    shellMaterial.transparent = true;
    shellMaterial.opacity = 0.2;
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

function createCase(track, size) {
  const group = new THREE.Group();

  // ジャケット(紙)。前面だけテクスチャ、それ以外は黒い紙。
  const paperSize = size * 0.94;
  const frontMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(paperSize, paperSize, 0.012),
    [paperBackMaterial, paperBackMaterial, paperBackMaterial, paperBackMaterial, frontMaterial, paperBackMaterial],
  );
  paper.position.z = 0.006; // ケース中央。前面ガラスとの間に隙間ができ、傾けると屈折でずれて見える
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
  tray.position.z = -CASE_DEPTH * 0.25; // ジャケットの後ろ
  group.add(tray);

  // 外側のガラスケース。角を丸めるとエッジにハイライトが乗ってガラスらしくなる
  const shell = new THREE.Mesh(
    new RoundedBoxGeometry(size, size, CASE_DEPTH, 4, Math.min(0.05, size * 0.07)),
    shellMaterial,
  );
  group.add(shell);

  group.userData = {
    track,
    size,
    hitTarget: shell,
    base: new THREE.Vector3(),
    focus: 0, // 0..1 で「最前面に浮いている」度合いをなめらかに追従
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
let focused = null; // カーソルに一番近いケース
let topZ = 0; // 一番上の層の z

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

function startTween(group, { from, to, duration, delay = 0, ease = easeOutCubic, onDone }) {
  group.userData.tween = { from, to, duration, delay, ease, onDone, start: clock.elapsedTime };
}

function showMonth(data) {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const placements = collageLayout(data.tracks || [], collageDimsFor(aspect));
  topZ = Math.max(0, ...placements.map((p) => p.layer)) * LAYER_GAP;
  cases = placements.map(({ track, size, x, y, layer }, i) => {
    const group = createCase(track, size);
    group.userData.base.set(x, y, layer * LAYER_GAP);
    group.position.copy(group.userData.base).setZ(FLY_DISTANCE);
    group.rotation.set(0, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 0.6);
    group.scale.setScalar(0.4);
    casesRoot.add(group);
    startTween(group, { from: "fly", to: "rest", duration: 0.9, delay: 0.03 * i });
    return group;
  });
}

function hideMonth(onDone) {
  const old = cases;
  cases = [];
  focused = null;
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

// まだ動いていれば true を返す(止まっていれば描画を省ける)
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
    group.position.set(base.x, base.y, THREE.MathUtils.lerp(FLY_DISTANCE, base.z, k));
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
    return true;
  }

  // カーソルに一番近いケースは、最前面の層よりさらに手前へ。それ以外は自分の層へ戻る。
  const focusTarget = group === focused ? 1 : 0;
  const moving = Math.abs(data.focus - focusTarget) > 1e-3;
  data.focus = moving ? data.focus + (focusTarget - data.focus) * 0.14 : focusTarget;

  // 周囲のケースはカーソルの近さに応じてごくわずかに持ち上がる(傾けない)
  const dx = cursor.point.x - base.x;
  const dy = cursor.point.y - base.y;
  const g = Math.exp(-(dx * dx + dy * dy) / (NEIGHBOR_RADIUS * NEIGHBOR_RADIUS)) * cursor.strength;

  const liftedZ = topZ + FOCUS_LIFT;
  const z = THREE.MathUtils.lerp(base.z + NEIGHBOR_LIFT * g, liftedZ, data.focus);
  group.position.set(base.x, base.y, z);
  group.scale.setScalar(1 + 0.05 * data.focus);
  group.quaternion.copy(restQuat);
  return moving;
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
    if (updateCase(group, t)) active = true;
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
  window.__applyQuality = applyQuality;
  window.__state = () => ({
    focused: focused?.userData.track.name ?? null,
    cases: cases.length,
    tweening: cases.filter((g) => g.userData.tween).length,
    cursor: cursor.target.toArray().map((v) => +v.toFixed(2)),
    active: cursor.active,
  });
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

// レイで当たったケース(クリック用。重なりの一番上が返る)
function pickCase(event) {
  updatePointer(event);
  const targets = cases.filter((g) => !g.userData.tween).map((g) => g.userData.hitTarget);
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit ? hit.object.parent : null;
}

// カーソル位置に中心が一番近いケース。縁から FOCUS_REACH 以上離れていたら無し
function nearestCase(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const group of cases) {
    if (group.userData.tween) continue;
    const { base, size } = group.userData;
    const distance = Math.hypot(point.x - base.x, point.y - base.y);
    if (distance > size / 2 + FOCUS_REACH) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = group;
    }
  }
  return best;
}

canvas.addEventListener("pointermove", (event) => {
  // カーソルがコラージュの面のどこを指しているか
  updatePointer(event);
  const hit = raycaster.ray.intersectPlane(gridPlane, cursor.target);
  cursor.active = hit !== null;
  requestRender();

  const next = hit ? nearestCase(cursor.target) : null;
  if (next !== focused) {
    focused = next;
    setCaption(focused?.userData.track || null);
    canvas.style.cursor = focused ? "pointer" : "";
  }
});

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return; // タッチは指を離すたびに leave が来るので無視(タップで浮かせた状態を保つ)
  cursor.active = false;
  requestRender();
  focused = null;
  setCaption(null);
  canvas.style.cursor = "";
});

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY, wasFocused: focused };
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  const { wasFocused } = pointerDown;
  pointerDown = null;
  if (moved > 6) return; // ドラッグ(回転)はクリック扱いにしない

  updatePointer(event);
  const onPlane = raycaster.ray.intersectPlane(gridPlane, cursor.target) !== null;
  const nearest = onPlane ? nearestCase(cursor.target) : null;

  if (event.pointerType === "touch") {
    // タッチにはホバーが無いので、1 回目のタップで浮かせ、浮いているものをもう一度タップしたら開く
    cursor.active = onPlane;
    if (nearest && nearest === wasFocused) {
      const url = nearest.userData.track.spotify_url;
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    focused = nearest;
    setCaption(focused?.userData.track || null);
    requestRender();
    return;
  }

  // マウス: 浮いているケースがカーソルの下にあればそれ、無ければレイで当たったもの
  const hit = pickCase(event);
  const target = hit === focused ? focused : hit || focused;
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
