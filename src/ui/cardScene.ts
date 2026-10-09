import * as THREE from 'three';
import { cloneModel, model } from '../assets/loader';
import type { PostGrade } from '../game/grade';

export interface Inscription {
  name: string;
  score: string;
  milestone: string;
  stats: string;
  best: boolean;
}

export interface CardRender {
  image: HTMLCanvasElement;
  /** Pixel rect of the gravestone's front face in the image (for laying out text). */
  face: { x: number; y: number; w: number; h: number };
}

const W = 1080;
const H = 1350;

/**
 * Renders a small staged scene (gravestone, dirt, candles, the player's candy ball) with the
 * live renderer at card resolution and returns it as a transparent canvas.
 */
export function renderCardScene(
  renderer: THREE.WebGLRenderer,
  ballRoll: THREE.Object3D,
  ballRadius: number,
  stoneName = 'grave_A',
  seedRot = 0,
  grade?: PostGrade,
  inscription?: Inscription,
): CardRender {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05061f);
  scene.fog = new THREE.Fog(0x0b0a2e, 9, 26);
  const root = new THREE.Group();
  scene.add(root);

  // Ground: a 3x3 patch of dirt tiles.
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const t = cloneModel('floor_dirt');
      t.position.set(i * 4, -0.03, j * 4);
      t.rotation.y = ((i + j + 4) % 4) * Math.PI * 0.5;
      root.add(t);
    }
  }
  // The stone, facing the camera.
  const stone = cloneModel(stoneName);
  const info = model(stoneName);
  stone.position.set(0, 0, 0);
  stone.rotation.y = seedRot;
  root.add(stone);
  if (inscription) {
    // A stone plaque fitted over the headstone face (covers the relief), with the text in its texture.
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.22, 1.56),
      new THREE.MeshStandardMaterial({ map: inscriptionTexture(inscription), transparent: true, roughness: 0.95, metalness: 0 }),
    );
    plaque.position.set(0, 0.5 + 0.78, 0.215);
    plaque.receiveShadow = false;
    stone.add(plaque);
  }

  // Dressing.
  const put = (name: string, x: number, z: number, ry = 0, s = 1) => {
    const o = cloneModel(name);
    const inf = model(name);
    o.position.set(x, -inf.box.min.y * s, z);
    o.rotation.y = ry;
    o.scale.setScalar(s);
    root.add(o);
    return o;
  };
  // A composed scene: candles and a pumpkin left, a lantern right, a bare tree behind the fence,
  // bones and candy in the foreground, boulders and markers filling the sides.
  put('candle_triple', -1.35, 0.95, 0.4, 0.85);
  put('candle', -1.05, 1.35, 0, 0.75);
  put('candle_melted', -1.7, 1.3, 1.2, 0.8);
  put('pumpkin_orange_small', -2.1, 0.5, 0.6, 1.0);
  put('pumpkin_orange', -2.6, 1.6, 2.2, 0.9);
  put('lantern_standing', 1.75, 0.55, 0.3, 0.95);
  put('candycorn', -0.55, 1.75, 0.8);
  put('candy_pink_A', 0.3, 2.0, 2.6);
  put('candy_green_B', -1.6, 2.1, 1.1);
  put('bone_B', 1.0, 1.9, 2.2, 0.9);
  put('bone_A', -0.3, 2.3, 0.4, 0.9);
  put('skull', 2.3, 1.3, -0.5, 0.55);
  put('gravemarker_A', -3.1, -1.2, 0.3);
  put('gravestone', 3.0, -1.4, -0.4);
  put('rock_e', 2.6, -0.4, 1.2);
  put('rock_a', -2.9, 0.2, 0.4);
  put('bare_tree_c', -3.6, -2.6, 0.5, 1.5);
  put('tree_dead_medium', 3.9, -3.2, 1.1, 1.3);
  put('fence_seperate', -2, -2.8, 0);
  put('fence_seperate', 2, -2.8, 0);
  put('bush_a', 3.2, -2.2, 0.2, 1.4);
  // Backdrop beyond the fence: a graveyard receding into fog under a moon.
  for (const [n, x, z, ry, sc] of [
    ['tree_pine_orange_large', -5.5, -7, 0.3, 1.3], ['tree_pine_yellow_medium', -2.2, -8.5, 1.0, 1.3], ['tree_dead_large', 1.6, -7.5, 0.6, 1.5],
    ['tree_pine_orange_medium', 4.8, -8, 2.1, 1.3], ['tree_pine_yellow_large', 8, -9, 0.2, 1.3], ['tree_dead_medium', -8, -8, 1.4, 1.5],
    ['bare_tree_d', 6.5, -5.5, 0.9, 1.5], ['grave_B', -4.2, -4.6, 0.2, 1], ['gravestone', -1.2, -5.2, -0.3, 1], ['grave_A', 3.2, -4.8, 0.4, 1],
    ['gravemarker_B', 5.6, -4.2, 0.1, 1], ['pumpkin_orange', -6.5, -4.4, 0.7, 1], ['post_lantern', -3.3, -3.9, Math.PI, 1],
  ] as const) put(n, x, z, ry, sc);
  // Moon and stars.
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) {
    const t = Math.random() * Math.PI * 2, u = 0.15 + Math.random() * 0.85;
    sp[i * 3] = Math.cos(t) * Math.sqrt(1 - u * u) * 80; sp[i * 3 + 1] = u * 60 + 2; sp[i * 3 + 2] = -Math.abs(Math.sin(t)) * 80 - 10;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
  const moonC = document.createElement('canvas'); moonC.width = moonC.height = 128;
  const mctx = moonC.getContext('2d')!;
  const mg = mctx.createRadialGradient(64, 64, 30, 64, 64, 64);
  mg.addColorStop(0, 'rgba(255,243,214,1)'); mg.addColorStop(0.55, 'rgba(255,243,214,1)'); mg.addColorStop(0.62, 'rgba(255,230,180,0.3)'); mg.addColorStop(1, 'rgba(255,230,180,0)');
  mctx.fillStyle = mg; mctx.fillRect(0, 0, 128, 128);
  const moonTex = new THREE.CanvasTexture(moonC); moonTex.colorSpace = THREE.SRGBColorSpace;
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, depthWrite: false }));
  moonSprite.position.set(-9, 11, -26); moonSprite.scale.setScalar(5.5);
  scene.add(moonSprite);

  // The player's ball, normalised to a display radius so every card composes the same.
  const R = 0.4;
  const ballGroup = new THREE.Group();
  const roll = ballRoll.clone(true);
  roll.traverse((o) => {
    o.visible = true;
  });
  ballGroup.add(roll);
  ballGroup.scale.setScalar(R / ballRadius);
  ballGroup.position.set(1.35, R, 1.7);
  root.add(ballGroup);
  const glow = new THREE.PointLight(0xffa040, 3.5, 4.5, 1.8);
  glow.position.set(1.35, R + 0.3, 1.7);
  root.add(glow);

  scene.add(new THREE.HemisphereLight(0xa9b8ff, 0x2a1b3d, 1.7));
  const moon = new THREE.DirectionalLight(0xdbe4ff, 2.2);
  moon.position.set(-4, 8, 5);
  scene.add(moon);
  if (renderer.shadowMap.enabled) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -14; moon.shadow.camera.right = 14;
    moon.shadow.camera.top = 14; moon.shadow.camera.bottom = -14;
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 40;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    // The inscription plane must not cast: the shadow pass ignores its alpha and would print a rectangle on the stone.
    const plaque = stone.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.type === 'PlaneGeometry') as THREE.Mesh | undefined;
    if (plaque) { plaque.castShadow = false; plaque.receiveShadow = false; }
  }
  const rim = new THREE.DirectionalLight(0x6a7cff, 1.0);
  rim.position.set(3, 4, -6);
  scene.add(rim);

  // Nearly frontal so the inscription stays legible; a touch of elevation for depth.
  // Wide enough to show the dressing either side; the stone still owns about two thirds of the height.
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  camera.position.set(0, 1.7, 7.2);
  camera.lookAt(0, 1.05, 0);
  const face = new THREE.DirectionalLight(0xe9eeff, 0.8);
  face.position.set(0.4, 2.2, 6);
  scene.add(face);
  camera.updateMatrixWorld();

  // Render at card resolution with the live renderer, then restore it.
  const prevPR = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevClear = renderer.getClearAlpha();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  // The main loop updates shadow maps manually once per frame; this scene has its own light, so force a pass.
  if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
  if (grade) {
    grade.setSize(W, H);
    grade.render(renderer, scene, camera);
  } else {
    renderer.render(scene, camera);
  }
  const image = document.createElement('canvas');
  image.width = W;
  image.height = H;
  image.getContext('2d')!.drawImage(renderer.domElement, 0, 0, W, H, 0, 0, W, H);
  renderer.setPixelRatio(prevPR);
  renderer.setSize(prevSize.x, prevSize.y, false);
  renderer.setClearColor(0x000000, prevClear);

  // Project the stone's front face to find where text can go.
  const b = info.box;
  const corners = [
    new THREE.Vector3(b.min.x, b.min.y, b.max.z),
    new THREE.Vector3(b.max.x, b.min.y, b.max.z),
    new THREE.Vector3(b.min.x, b.max.y, b.max.z),
    new THREE.Vector3(b.max.x, b.max.y, b.max.z),
  ];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    c.applyMatrix4(stone.matrixWorld.identity().makeRotationY(seedRot)).project(camera);
    const px = (c.x * 0.5 + 0.5) * W;
    const py = (-c.y * 0.5 + 0.5) * H;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  // Clean up clones (geometry/material are shared, so just drop references).
  scene.clear();
  return { image, face: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

// Real headstones are cut in Roman capitals (Trajan-style inscriptional serifs), letterspaced,
// with a quieter italic for the epitaph. Cinzel is the open-source cut of that tradition.
const ROMAN = '"Cinzel", "Trajan Pro", Georgia, serif';
const ITALIC = '"EB Garamond", Georgia, "Times New Roman", serif';

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: (px: number) => string, start: number, min: number): number {
  let px = start;
  for (; px > min; px -= 2) {
    ctx.font = font(px);
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = font(px);
  return px;
}

/**
 * Carved lettering. Three passes sell the recess: a light lip below the letterform where the
 * moon catches the cut edge, a soft dark shadow inside the cut, then the dark fill with a crisp edge.
 */
function carve(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dark = '#232640'): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillText(text, x, y + 4);
  ctx.fillStyle = 'rgba(8,9,22,0.45)';
  ctx.fillText(text, x, y - 2);
  ctx.fillStyle = dark;
  ctx.fillText(text, x, y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(8,9,22,0.55)';
  ctx.strokeText(text, x, y);
  ctx.restore();
}

/** A short carved rule with a diamond at its centre, the way masons break a stone's sections. */
function carveRule(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number): void {
  const line = (dy: number, color: string, lw: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y + dy);
    ctx.lineTo(cx - 14, y + dy);
    ctx.moveTo(cx + 14, y + dy);
    ctx.lineTo(cx + w / 2, y + dy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, y + dy - 9);
    ctx.lineTo(cx + 9, y + dy);
    ctx.lineTo(cx, y + dy + 9);
    ctx.lineTo(cx - 9, y + dy);
    ctx.closePath();
    ctx.stroke();
  };
  ctx.save();
  line(3, 'rgba(255,255,255,0.55)', 3);
  line(0, '#232640', 3);
  ctx.restore();
}

/** Stone-coloured plaque with a rounded top and the inscription, 1024 x 1288 (matches a 1.24 x 1.56 plane). */
function inscriptionTexture(ins: Inscription): THREE.CanvasTexture {
  const W2 = 1024, H2 = 1288;
  const c = document.createElement('canvas');
  c.width = W2;
  c.height = H2;
  const ctx = c.getContext('2d')!;
  // Rounded-top silhouette.
  const r = W2 / 2;
  ctx.beginPath();
  ctx.moveTo(0, H2);
  ctx.lineTo(0, r);
  ctx.arc(r, r, r, Math.PI, 0);
  ctx.lineTo(W2, H2);
  ctx.closePath();
  ctx.clip();
  // Stone fill close to the pack's palette (it brightens under the moonlight), with speckle.
  const g = ctx.createLinearGradient(0, 0, 0, H2);
  g.addColorStop(0, '#8e93a9');
  g.addColorStop(1, '#757a92');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W2, H2);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = 125 + rnd() * 80;
    ctx.fillStyle = `rgba(${v},${v + 4},${v + 18},${0.12 + rnd() * 0.2})`;
    ctx.fillRect(rnd() * W2, rnd() * H2, 2 + rnd() * 4, 2 + rnd() * 3);
  }
  // Inner bevel line.
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(44, H2 - 44);
  ctx.lineTo(44, r);
  ctx.arc(r, r, r - 44, Math.PI, 0);
  ctx.lineTo(W2 - 44, H2 - 44);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,22,40,0.3)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = W2 / 2;
  const spaced = (em: number, px: number) => {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(em * px).toFixed(1)}px`;
  };
  const name = ins.name.toUpperCase();
  // Inscriptional hierarchy, top to bottom: a small letterspaced "HERE LIES", the name in large
  // Roman capitals, a carved rule, the score as the hero numerals, "POINTS" small, and the
  // epitaph as a single italic line. Stats are left off the stone; they would only compete.
  const epitaph = `Grew as big as ${ins.milestone}`;
  spaced(0.1, 100);
  const namePx = fit(ctx, name, W2 - 190, (px) => { spaced(0.1, px); return `700 ${px}px ${ROMAN}`; }, 136, 76);
  // Tight tracking on the numerals so six-figure scores still fit at a good size.
  spaced(-0.03, 100);
  const scorePx = fit(ctx, ins.score, W2 - 150, (px) => { spaced(-0.03, px); return `700 ${px}px ${ROMAN}`; }, 270, 140);
  spaced(0, 100);
  const epiPx = fit(ctx, epitaph, W2 - 170, (px) => `italic 500 ${px}px ${ITALIC}`, 70, 50);
  const hl = 54, pts = 52, rule = 10;
  const g1 = 0.95 * hl;          // here lies -> name
  const g2 = 0.5 * namePx;       // name -> rule
  const g3 = 0.5 * namePx;       // rule -> score
  const g4 = 0.28 * scorePx;     // score -> points
  const g5 = 1.5 * pts;          // points -> epitaph
  const block = hl + g1 + namePx + g2 + rule + g3 + scorePx + g4 + pts + g5 + epiPx;
  let y = Math.max(230, (H2 - block) / 2 + 64) + hl * 0.5;
  spaced(0.28, hl);
  ctx.font = `600 ${hl}px ${ROMAN}`;
  carve(ctx, 'HERE LIES', cx, y);
  y += hl * 0.5 + g1 + namePx * 0.5;
  spaced(0.1, namePx);
  ctx.font = `700 ${namePx}px ${ROMAN}`;
  carve(ctx, name, cx, y + namePx * 0.04, '#1e2138');
  y += namePx * 0.5 + g2 + rule * 0.5;
  carveRule(ctx, cx, y, 300);
  y += rule * 0.5 + g3 + scorePx * 0.5;
  spaced(-0.03, scorePx);
  ctx.font = `700 ${scorePx}px ${ROMAN}`;
  carve(ctx, ins.score, cx, y + scorePx * 0.04, '#15172c');
  y += scorePx * 0.5 + g4 + pts * 0.5;
  spaced(0.28, pts);
  ctx.font = `600 ${pts}px ${ROMAN}`;
  carve(ctx, ins.best ? 'POINTS  ·  NEW BEST' : 'POINTS', cx, y);
  y += pts * 0.5 + g5 + epiPx * 0.5;
  spaced(0, epiPx);
  ctx.font = `italic 500 ${epiPx}px ${ITALIC}`;
  carve(ctx, epitaph, cx, y);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
