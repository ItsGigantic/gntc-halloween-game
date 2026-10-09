import './style.css';
import * as THREE from 'three';
import { CONFIG, IS_TOUCH, GAME_URL } from './config';
import { FLAGS, aspectRatio } from './showcase';
import { loadModels } from './assets/loader';
import { Input } from './game/input';
import { FollowCamera } from './game/camera';
import { Player } from './game/player';
import { World } from './game/world';
import { Spawner } from './game/spawner';
import { Effects } from './game/effects';
import { Game, type RunStats } from './game/game';
import { Autopilot } from './game/autopilot';
import { audio, sfx, musicControl } from './game/audio';
import { Screens } from './ui/screens';
import { renderTombstone } from './ui/tombstone';
import { renderOgScene } from './ui/ogScene';
import { renderCardScene } from './ui/cardScene';
import type { Occluder } from './game/camera';
import type { Entity } from './game/world';
import { canShareFiles, canvasToBlob, download, shareTombstone } from './ui/share';
import { track } from './analytics';
import { PickupTray } from './ui/tray';
import { SizeWidget } from './ui/sizeWidget';
import { buildOutside } from './game/outside';
import { PostGrade } from './game/grade';
import { LocalLights } from './game/lights';
import { Rng } from './game/rng';

const BASE = import.meta.env.BASE_URL;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

// Rendering tiers. The GPU work per frame is what spins laptop fans up, so the default tier keeps
// resolution, anti-aliasing, dynamic lights and the shadow pass modest; `?quality=high` restores
// everything, `?quality=low` is the fallback for weak hardware.
const QUALITY = {
  low: { dpr: 1, shadow: 1024, shadowEvery: 3, msaa: 0, lights: 2 },
  med: { dpr: 1.25, shadow: 1536, shadowEvery: 2, msaa: 2, lights: 2 },
  high: { dpr: 2, shadow: 2048, shadowEvery: 1, msaa: 4, lights: 4 },
}[FLAGS.quality];
// 'low-power' asks dual-GPU laptops for the integrated GPU; Apple Silicon ignores it.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
let pixelRatio = Math.min(window.devicePixelRatio, IS_TOUCH ? CONFIG.render.mobilePixelRatio : FLAGS.hidpi ? 2 : QUALITY.dpr);
renderer.setPixelRatio(pixelRatio);
const SHADOWS = CONFIG.render.shadowMaps && !IS_TOUCH;
if (SHADOWS) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // hard edges, cheapest
  renderer.shadowMap.autoUpdate = false; // one shadow pass per frame, set before the main render
}

const grade = new PostGrade(2, 2, QUALITY.msaa);
const scene = new THREE.Scene();
const BG = new THREE.Color(0x05061f);
scene.background = BG;
const fog = new THREE.Fog(0x0b0a2e, 24, 70);
scene.fog = fog;

// Moonlit night: cool key from the moon, soft violet bounce from the sky, warm glow from the pumpkin.
const hemi = new THREE.HemisphereLight(0x5f6fe0, 0x2a1838, 0.62);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xc9d4ff, 2.9);
moon.position.set(-8, 10, 3);
scene.add(moon);
scene.add(moon.target);
if (SHADOWS) {
  moon.castShadow = true;
  const sz = QUALITY.shadow;
  moon.shadow.mapSize.set(sz, sz);
  const ext = CONFIG.render.shadowExtent;
  moon.shadow.camera.left = -ext;
  moon.shadow.camera.right = ext;
  moon.shadow.camera.top = ext;
  moon.shadow.camera.bottom = -ext;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 90;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.03;
}
const moonOffset = new THREE.Vector3(-24, 17, 11); // lower moon: longer, more pronounced shadows
// Cool rim from behind separates silhouettes from the ground; warm low fill lifts the pumpkin side.
const rim = new THREE.DirectionalLight(0x6f7cff, 0.55);
rim.position.set(5, 6, -8);
scene.add(rim);
const localLights = new LocalLights(scene, QUALITY.lights);
// The size gauge renders the ball on its own layer; let the scene lights reach it.
for (const l of [hemi, moon, rim, ...localLights.lights]) l.layers.enable(1);
// Apron under the arena; the outside world (hills, forest, sky) is built once after the models load.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.world.size + 10, CONFIG.world.size + 10), new THREE.MeshStandardMaterial({ color: 0x1a1536, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.55;
scene.add(ground);

const follow = new FollowCamera(1);
const input = new Input(canvas, ui);
const effects = new Effects(ui, follow.camera);
scene.add(effects.particles);
const tray = new PickupTray(ui);
const sizeWidget = new SizeWidget(ui, scene);

type Phase = 'title' | 'playing' | 'dying' | 'dead';
let phase: Phase = 'title';
let player: Player;
let world: World;
let spawner: Spawner;
let game: Game;
let autopilot: Autopilot;
let dyingT = 0;
let lastStats: RunStats | null = null;
let tombstone: HTMLCanvasElement | null = null;
let tombstoneUrl = '';
let logoImg: HTMLImageElement | null = null;
let hudVisible = !FLAGS.showcase;
let hitStopT = 0;
let hitStopScale = 1;
let dustAcc = 0;
const DUST = new THREE.Color(0x5a5f8a);
const SPARK = new THREE.Color(0xffd27a);

interface Best { score: number; name: string; milestone: string; date: string }
function loadBest(): Best | null {
  try {
    const raw = localStorage.getItem('gg.best');
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}
function saveBest(b: Best): void {
  try {
    localStorage.setItem('gg.best', JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

const screens = new Screens(ui, {
  onPlay(name) {
    audio.unlock();
    sfx.click();
    musicControl.start();
    musicControl.level(1, 2);
    startRun(name);
  },
  onAgain() {
    audio.unlock();
    sfx.click();
    musicControl.start();
    musicControl.level(1, 2);
    startRun(screens.name);
  },
  onMute(m) {
    audio.unlock();
    audio.setMuted(m);
  },
  onDownload() {
    if (!tombstone) return;
    void canvasToBlob(tombstone).then((b) => download(b, 'gigantic-gourd-tombstone.png'));
  },
  onShare() {
    if (!tombstone || !lastStats) return;
    const text = `I grew as big as ${lastStats.milestone} and scored ${lastStats.score.toLocaleString('en-US')} in Gigantic Gourd. Beat me?`;
    void canvasToBlob(tombstone).then(async (b) => {
      const ok = await shareTombstone(b, text, GAME_URL);
      if (!ok) download(b, 'gigantic-gourd-tombstone.png');
    });
  },
}, BASE);
if (FLAGS.mute) audio.setMuted(true);
screens.setMuted(audio.muted);
screens.setShareAvailable(canShareFiles() || !!navigator.share);

let debugEl: HTMLDivElement | null = null;
if (FLAGS.stats) {
  debugEl = document.createElement('div');
  debugEl.id = 'debug';
  ui.appendChild(debugEl);
}

function resize(): void {
  const ratio = aspectRatio();
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (ratio) {
    if (w / h > ratio) w = Math.round(h * ratio);
    else h = Math.round(w / ratio);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${Math.round((window.innerWidth - w) / 2)}px`;
    canvas.style.top = `${Math.round((window.innerHeight - h) / 2)}px`;
    ui.style.left = canvas.style.left;
    ui.style.top = canvas.style.top;
    ui.style.width = canvas.style.width;
    ui.style.height = canvas.style.height;
  }
  renderer.setSize(w, h, false);
  grade.setSize(Math.round(w * pixelRatio), Math.round(h * pixelRatio));
  follow.camera.aspect = w / h;
  follow.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

function buildWorld(): void {
  if (world) scene.remove(world.group);
  localLights.reset();
  world = new World(FLAGS.seed, FLAGS.map);
  world.generate();
  scene.add(world.group);
  player.reset();
  player.root.scale.setScalar(1);
  player.root.visible = true;
  spawner = new Spawner(world, player);
  autopilot = new Autopilot(world, player);
  game = new Game(player, world, effects, follow, spawner, {
    onDeath: (s) => beginDeath(s),
    onHud: (h) => {
      if (hudVisible) screens.updateHud(h);
      musicControl.intensity((h.multiplier - 1) / 4);
      musicControl.star(h.charge > 0);
      musicControl.progress((h.radius - CONFIG.player.startRadius) / (6.5 - CONFIG.player.startRadius));
    },
    onMilestone: (label) => {
      if (phase !== 'playing') return;
      sfx.milestone();
      if (hudVisible) screens.flashMilestone(label);
    },
    onPickup: (kind, _mult, name, pts) => {
      if (phase !== 'playing') return;
      if (hudVisible) tray.show(name, pts, player.radius);
      if (kind === 'skull') sfx.crunch();
      else sfx.pickup(game.combo, pts >= 100);
      if (hudVisible) screens.bumpScore();
    },
    onStrike: () => { if (phase === 'playing') sfx.bonk(); },
    onComboUp: (m) => { if (phase === 'playing') sfx.comboUp(m); },
    onPower: (restored) => {
      if (phase !== 'playing') return;
      sfx.power();
      if (hudVisible) screens.flash(restored ? 'Skull restored. For a moment,' : 'For a moment,', 'Invincible');
    },
    onHitStop: (sec, scale) => { hitStopT = sec; hitStopScale = scale; },
  });
  effects.clear();
  follow.snapBehind(player.pos, player.radius);
  if (FLAGS.debug) {
    (window as unknown as { __dbg: unknown }).__dbg = { game, player, world, spawner, startRun, beginDeath, audio, renderer };
    (window as unknown as { __audioTest: unknown }).__audioTest = async () => (await import('./game/audioTest')).runAudioTest(audio.master);
  }
}

function showTitle(): void {
  phase = 'title';
  ui.classList.remove('playing');
  effects.quiet = true;
  buildWorld();
  game.start();
  input.enabled = false;
  sizeWidget.hide();
  screens.showTitle(loadBest());
}

function startRun(name: string): void {
  phase = 'playing';
  ui.classList.add('playing');
  effects.quiet = !hudVisible;
  buildWorld();
  game.start();
  input.enabled = true;
  input.releaseAll();
  if (hudVisible) screens.showHud();
  else screens.hideHud();
  tray.reset(player.radius);
  sizeWidget.reset(player.radius);
  if (hudVisible) sizeWidget.show();
  else sizeWidget.hide();
  track('start', { name_set: name.length > 0, touch: IS_TOUCH });
}

function beginDeath(stats: RunStats): void {
  if (phase !== 'playing') return;
  phase = 'dying';
  ui.classList.remove('playing');
  dyingT = 0;
  lastStats = stats;
  input.enabled = false;
  input.releaseAll();
  sfx.death();
  tray.reset(player.radius);
  sizeWidget.hide();
  world.clearHints();
  screens.updateMarkers([]);
  follow.shake(0.8, 0.5);
}

function inscriptionFor(name: string, stats: RunStats, best: boolean) {
  const m = Math.floor(stats.time / 60);
  const sec = Math.floor(stats.time % 60).toString().padStart(2, '0');
  return {
    name: name || 'A nameless gourd',
    score: stats.score.toLocaleString('en-US'),
    milestone: stats.milestone,
    stats: `${stats.candies} candies  ·  ${m}:${sec}  ·  combo x${stats.maxMultiplier}`,
    best,
  };
}

function finishDeath(): void {
  phase = 'dead';
  const stats = lastStats!;
  const prev = loadBest();
  // Scripted runs (showcase / autopilot) don't count toward the local best.
  const isBest = !FLAGS.autopilot && !FLAGS.showcase && stats.score > 0 && (!prev || stats.score > prev.score);
  const name = screens.name;
  if (isBest) saveBest({ score: stats.score, name, milestone: stats.milestone, date: new Date().toISOString() });
  const card = renderCardScene(renderer, player.roll, player.radius, FLAGS.stone, 0, grade, inscriptionFor(name, stats, isBest));
  void renderTombstone({ name, stats, card, isBest, url: GAME_URL, logo: logoImg }).then(async (c) => {
    tombstone = c;
    const b = await canvasToBlob(c);
    if (tombstoneUrl) URL.revokeObjectURL(tombstoneUrl);
    tombstoneUrl = URL.createObjectURL(b);
    screens.showDeath(tombstoneUrl, stats, isBest);
  });
  track('game_over', { score: stats.score, radius: Number(stats.radius.toFixed(2)), time: Math.round(stats.time), candies: stats.candies, best: isBest });
}

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const occluders: Occluder[] = [];
const markerPts: { x: number; y: number; front: boolean }[] = [];
const mv = new THREE.Vector3();
function updateGhostMarkers(): void {
  markerPts.length = 0;
  for (const g of world.ghosts) {
    mv.set(g.x, g.y, g.z).project(follow.camera);
    markerPts.push({ x: mv.x, y: mv.y, front: mv.z < 1 });
  }
  screens.updateMarkers(markerPts);
}
const nearScratch: Entity[] = [];
function gatherOccluders(): void {
  occluders.length = 0;
  const reach = CONFIG.camera.distBase + CONFIG.camera.distPerRadius * player.radius + 2;
  const near = world.hash.query(player.pos.x, player.pos.z, reach, nearScratch);
  for (const e of near) {
    if (e.state !== 'free' || e.pickRadius < 1.2) continue;
    const h = world.modelInfo(e.def.name).size.y * e.scale;
    if (h < 2.5) continue;
    occluders.push({ x: e.x, z: e.z, r: e.collideRadius, h });
  }
}
const move = { x: 0, y: 0 };
let last = performance.now();
let frames = 0;
let fpsTimer = 0;
let fps = 0;
let mainCalls = 0;
let mainTris = 0;

let frameN = 0;
let slowFrames = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  // Frame cap: 120 Hz displays would otherwise render twice the frames for no visible gain.
  if (now - last < 1000 / FLAGS.fps - 1.5) return;
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frameN++;
  // Adaptive resolution: if frames keep running long, step the pixel ratio down (never below 1).
  if (rawDt > 0.024) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slowFrames = 0;
  }
  let dt = rawDt * FLAGS.timescale;
  if (hitStopT > 0) {
    hitStopT -= rawDt;
    dt *= hitStopScale;
  }
  input.update();
  follow.basis(fwd, right);
  const auto = phase === 'title' || (FLAGS.autopilot && Math.hypot(input.x, input.y) < 0.05);
  if (auto) autopilot.steer(dt, fwd, right, move);
  else { move.x = input.x; move.y = input.y; }

  if (phase === 'playing' || phase === 'title') {
    player.groundY = world.groundHeight(player.pos.x, player.pos.z);
    player.update(dt, move.x, move.y, fwd, right);
    game.update(dt);
    if (player.justLanded) {
      effects.burst(new THREE.Vector3(player.pos.x, player.groundY + 0.1, player.pos.z), 10, DUST, 2.5, 1.8);
      if (phase === 'playing') sfx.land();
    }
    // Rolling dust behind the ball, and a sparkle trail when the combo is hot.
    const speed = Math.hypot(player.vel.x, player.vel.z);
    dustAcc += dt * speed;
    if (speed > 4.5 && dustAcc > 0.9) {
      dustAcc = 0;
      const back = new THREE.Vector3(player.pos.x - (player.vel.x / speed) * player.radius * 0.6, player.groundY + 0.08, player.pos.z - (player.vel.z / speed) * player.radius * 0.6);
      effects.burst(back, 2, DUST, 1.2, 1.6);
      if (phase === 'playing' && game.multiplier >= 4) effects.burst(back, 2, SPARK, 2, 3);
    }
    if (phase === 'title' && game.state === 'dead') showTitle();
  } else if (phase === 'dying') {
    dyingT += dt;
    const k = Math.min(1, dyingT / 1.1);
    const wob = 1 + Math.sin(dyingT * 28) * 0.12 * (1 - k);
    const s = (1 - k * k) * wob;
    player.root.scale.set(s * (1 + k * 0.3), Math.max(0.001, s * (1 - k * 0.3)), s * (1 + k * 0.3));
    player.light.intensity = (4 + player.radius * 3) * (1 - k);
    if (k >= 1) {
      player.root.visible = false;
      effects.burst(player.pos, 60, new THREE.Color(0xffb347), 6 + player.radius * 2, 7);
      finishDeath();
    }
  }
  world.update(dt, player.pos);
  localLights.update(world, player.pos.x, player.pos.z, dt);
  if (SHADOWS) {
    // Keep the shadow window centred on the ball; snap to texel-sized steps to avoid shimmer.
    const step = (CONFIG.render.shadowExtent * 2) / QUALITY.shadow * 4;
    const sx = Math.round(player.pos.x / step) * step;
    const sz2 = Math.round(player.pos.z / step) * step;
    moon.target.position.set(sx, 0, sz2);
    moon.position.set(sx + moonOffset.x, moonOffset.y, sz2 + moonOffset.z);
  }
  if (phase === 'playing' && hudVisible) updateGhostMarkers();
  gatherOccluders();
  follow.update(dt, player.pos, player.vel, player.radius, occluders);
  if (FLAGS.overhead) {
    follow.camera.position.set(0, 96, 0.01);
    follow.camera.lookAt(0, 0, 0);
  }
  const camDist = CONFIG.camera.distBase + CONFIG.camera.distPerRadius * player.radius;
  fog.near = FLAGS.overhead ? 150 : camDist + 18;
  fog.far = FLAGS.overhead ? 400 : camDist + 110;
  effects.update(dt);
  // Hard shadows every other frame: the lag is a few centimetres at full speed and invisible.
  if (SHADOWS && frameN % QUALITY.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
  grade.tick(now / 1000);
  // The grade pass does two renders (scene, then the quad); count the whole frame, not the last call.
  renderer.info.autoReset = false;
  renderer.info.reset();
  grade.render(renderer, scene, follow.camera);
  mainCalls = renderer.info.render.calls;
  mainTris = renderer.info.render.triangles;
  if (phase === 'playing') {
    tray.render(renderer, dt);
    sizeWidget.update(player, dt);
    sizeWidget.render(renderer, scene);
  }

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
    if (debugEl) {
      debugEl.textContent = `fps ${fps}  ${phase}  q=${FLAGS.quality} ${renderer.domElement.width}x${renderer.domElement.height}\ndraw ${mainCalls}  tris ${mainTris}\nr ${player.radius.toFixed(2)}  v ${Math.hypot(player.vel.x, player.vel.z).toFixed(1)}\nattached ${player.attached.length}  ents ${world.entities.length}  ghosts ${world.ghosts.length}\nt ${game.time.toFixed(0)}s  dpr ${pixelRatio.toFixed(2)}`;
    }
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && (FLAGS.showcase || FLAGS.debug)) {
    hudVisible = !hudVisible;
    if (phase === 'playing') { if (hudVisible) { screens.showHud(); sizeWidget.show(); } else { screens.hideHud(); sizeWidget.hide(); } }
  }
  if (e.code === 'KeyR' && (phase === 'dead' || FLAGS.showcase || FLAGS.debug)) startRun(screens.name);
  if (e.code === 'Enter' && phase === 'dead') startRun(screens.name);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) last = performance.now();
});
input.onAnyInput = () => { audio.unlock(); musicControl.start(); };
// The waltz starts softly on the title screen at the first gesture (browsers need one to unlock
// audio); Play brings it up to full.
const titleMusic = () => {
  if (phase !== 'title') return;
  audio.unlock();
  musicControl.level(0.45, 0.1);
  musicControl.start();
};
window.addEventListener('pointerdown', titleMusic, { capture: true });
window.addEventListener('keydown', titleMusic, { capture: true });
input.onJump = () => {
  if (phase === 'playing' && player.jump()) sfx.hop();
};

async function boot(): Promise<void> {
  // The share card carries the Gigantic wordmark; the title screen uses the Halloween mark via its own markup.
  const logo = new Image();
  logo.onload = () => (logoImg = logo);
  logo.src = `${BASE}brand/wordmark-white.svg`;
  await Promise.all([loadModels(`${BASE}assets/halloween.glb`), document.fonts.load('48px "DotGothic16"').catch(() => null), document.fonts.load('100px "Creepster"').catch(() => null), document.fonts.load('700 100px "Cinzel"').catch(() => null), document.fonts.load('italic 400 60px "EB Garamond"').catch(() => null)]);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('off');
    setTimeout(() => loading.remove(), 400);
  }
  player = new Player();
  player.setBlobShadow(!SHADOWS);
  scene.add(player.root);
  buildOutside(scene, new Rng(FLAGS.seed || 1));
  resize();
  if (FLAGS.og) {
    const c = await renderOgScene(renderer, grade, `${BASE}brand/wordmark-white.svg`);
    (window as unknown as { __ogCanvas: HTMLCanvasElement }).__ogCanvas = c;
    const img = document.createElement('img');
    img.id = 'cardPreview';
    img.src = c.toDataURL('image/png');
    ui.appendChild(img);
    return;
  }
  if (FLAGS.card) {
    // Preview the share card with the title-screen ball after it has eaten a bit.
    showTitle();
    setTimeout(async () => {
      const stats: RunStats = { score: Number(new URLSearchParams(location.search).get('score') ?? 12340), radius: player.radius, candies: 37, items: 52, time: 72, milestone: 'a gravestone', maxMultiplier: 4, cause: 'skull' };
      const previewName = new URLSearchParams(location.search).get('name') || screens.name || 'Ben';
      const card = renderCardScene(renderer, player.roll, player.radius, FLAGS.stone, 0, grade, inscriptionFor(previewName, stats, true));
      const c = await renderTombstone({ name: previewName, stats, card, isBest: true, url: GAME_URL, logo: logoImg });
      const img = document.createElement('img');
      img.id = 'cardPreview';
      img.src = c.toDataURL('image/png');
      ui.appendChild(img);
    }, 4000);
  } else if (FLAGS.showcase) {
    buildWorld();
    phase = 'playing';
    game.start();
    input.enabled = true;
    screens.hideHud();
    ui.classList.add('showcase');
  } else {
    showTitle();
  }
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot().catch((e) => {
  console.error(e);
  ui.innerHTML = `<pre style="color:#f88;padding:16px">${String(e)}</pre>`;
});
