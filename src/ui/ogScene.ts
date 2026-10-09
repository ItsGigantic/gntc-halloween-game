import * as THREE from 'three';
import { cloneModel, model } from '../assets/loader';
import type { PostGrade } from '../game/grade';
import { Player } from '../game/player';
import { glowTexture, makeHalo } from '../game/glow';

const W = 1200;
const H = 630;

/**
 * The Open Graph image: a staged graveyard with a candy-covered jack-o-lantern dead centre,
 * composed for a 1.91:1 frame (and for the square crop some networks take from its middle).
 * Rendered with the live renderer and grade so it matches the game, then the logo is laid on.
 */
export async function renderOgScene(renderer: THREE.WebGLRenderer, grade: PostGrade, logoUrl: string): Promise<HTMLCanvasElement> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05061f);
  scene.fog = new THREE.Fog(0x0b0a2e, 8, 24);
  const root = new THREE.Group();
  scene.add(root);

  // Ground: dirt tiles wide enough for the frame.
  for (let i = -3; i <= 3; i++) {
    for (let j = -2; j <= 1; j++) {
      const t = cloneModel('floor_dirt');
      t.position.set(i * 4, -0.03, j * 4);
      t.rotation.y = ((i + j + 8) % 4) * Math.PI * 0.5;
      root.add(t);
    }
  }
  const put = (name: string, x: number, z: number, ry = 0, s = 1) => {
    const o = cloneModel(name);
    const inf = model(name);
    o.position.set(x, -inf.box.min.y * s, z);
    o.rotation.y = ry;
    o.scale.setScalar(s);
    root.add(o);
    return o;
  };

  // The hero: a clean jack-o-lantern, facing the camera with a playful lean and a nod up.
  const R = 0.92;
  const hero = new Player();
  (hero as unknown as { faceGlow: { value: number } }).faceGlow.value = 2.3;
  // A warmer shell for the poster shot so the orange reads against the moonlit backlight.
  hero.roll.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && m.emissive) {
      m.emissiveIntensity = 0.12;
      m.roughness = 0.62; // a little sheen so the moon shapes the facets
    }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  const ball = new THREE.Group();
  ball.add(hero.roll);
  ball.scale.setScalar(R / hero.radius);
  ball.position.set(0, R, 0.3);
  hero.roll.quaternion.setFromEuler(new THREE.Euler(-0.12, 0.1, -0.08));
  root.add(ball);
  // Light from inside: a warm point light for the surroundings, a spot that throws the face's
  // light onto the ground in front, a soft halo around the ball and a glow pool beneath it.
  const ember = new THREE.PointLight(0xffa040, 3.2, 6, 1.7);
  ember.position.set(0, R + 0.1, 0.5);
  root.add(ember);
  const faceSpill = new THREE.SpotLight(0xffb050, 9, 8, 0.5, 0.75, 1.3);
  faceSpill.position.set(0, R, 0.6);
  faceSpill.target.position.set(0, 0, 4.2);
  root.add(faceSpill);
  root.add(faceSpill.target);
  const halo = makeHalo(0xff8a30, R * 2.5);
  halo.position.set(0, R, 0.3);
  (halo.material as THREE.SpriteMaterial).opacity = 0.22;
  root.add(halo);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(R * 1.9, 40),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff8a30, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.015, 0.5);
  root.add(pool);
  // Contact shadow: a soft dark disc so the ball sits on the ground instead of floating in glow.
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(R * 1.05, 40),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000015, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.02, 0.3);
  contact.renderOrder = 1;
  root.add(contact);

  // Company: a small pumpkin leaning in at the hero's side, a bucket spilling candy on the other.
  put('pumpkin_orange_small', -1.65, 0.85, 0.5, 1.0);
  put('candy_bucket_B_decorated', 1.75, 0.85, -0.5, 0.68);

  // Candy on the ground around them, all well inside the frame.
  for (const [n, x, z, ry, sc] of [
    ['candycorn', -0.95, 1.15, 0.8, 0.5], ['candy_pink_B', 0.95, 1.1, 2.4, 0.42], ['lollipop_orange', -1.95, 0.4, 0.3, 0.44],
    ['candy_green_B', 1.25, 0.45, 1.1, 0.42], ['candy_blue_A', -0.35, 1.35, 0.4, 0.42], ['candycorn', 2.05, 0.4, 2.0, 0.5],
    ['candy_purple_A', -2.0, 1.2, 0.6, 0.42], ['candy_orange_A', 0.45, 1.4, 1.7, 0.42], ['candycorn', -2.35, 0.1, 0.2, 0.5],
    ['candy_green_A', 2.2, 1.25, 0.9, 0.42], ['lollipop_pink', 1.75, 1.35, 2.9, 0.44], ['candy_pink_A', -1.45, 1.4, 0.3, 0.42],
    ['candy_blue_B', 1.15, 1.4, 2.2, 0.42], ['candy_purple_B', 1.85, 1.0, 1.4, 0.42], ['candycorn', 0.1, 1.1, 2.3, 0.5],
    ['candy_orange_B', -2.4, 0.75, 2.6, 0.42], ['candy_brown_A', 2.45, 0.85, 1.3, 0.42], ['lollipop_blue', -2.15, 1.25, 1.6, 0.44],
    ['bone_A', 2.3, 1.3, 1.9, 0.7], ['candy_green_C', -0.7, 1.5, 1.2, 0.42], ['candycorn', 1.5, 1.5, 0.6, 0.5],
  ] as const) put(n, x, z, ry, sc);

  // Mid ground: candles and a signpost on the left, a lantern, hay and a gravestone on the right.
  put('candle_triple', -2.7, -0.6, 0.4, 0.9);
  put('candle', -3.1, -0.1, 0, 0.8);
  put('sign_both', -2.95, -2.1, 0.3, 0.72);
  put('lantern_standing', 2.6, -0.3, 0.3, 0.95);
  put('haybale', 4.2, -3.8, 0.35, 0.72);
  put('gravestone', -3.4, -2.6, -0.2, 1);
  put('skull', 3.3, 0.3, -0.6, 0.55);
  put('bush_b', 4.3, -3.0, 0.2, 1.3);
  put('bush_a', -4.9, -2.7, 1.1, 1.2);
  put('grave_A', 4.2, -3.6, 0.25, 1);
  put('grave_B', -4.6, -3.9, -0.2, 1);
  put('scarecrow', 3.4, -4.4, -0.2, 1.3);
  put('post_lantern', -1.9, -4.4, Math.PI, 1);
  for (const x of [-10, -6, -2, 2, 6, 10]) put('fence_seperate', x, -5.2, 0);
  for (const x of [-8, -4, 0, 4, 8]) put('fence_pillar', x, -5.2, 0);

  // Fireflies: a scatter of tiny warm lights drifting over the yard.
  const ffGeo = new THREE.BufferGeometry();
  const ffN = 64;
  const ffP = new Float32Array(ffN * 3);
  let fseed = 11;
  const frnd = () => ((fseed = (fseed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < ffN; i++) {
    ffP[i * 3] = (frnd() - 0.5) * 9;
    ffP[i * 3 + 1] = 0.3 + frnd() * 2.2;
    ffP[i * 3 + 2] = -4.5 + frnd() * 6.5;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffP, 3));
  const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffd36b, size: 0.2, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  root.add(fireflies);

  // Backdrop beyond the fence: trees and graves receding into fog under the moon.
  for (const [n, x, z, ry, sc] of [
    ['tree_pine_orange_large', -8.5, -10, 0.3, 1.3], ['tree_pine_yellow_medium', -4.2, -11, 1.0, 1.3], ['tree_dead_large', 0.6, -10.5, 0.6, 1.5],
    ['tree_pine_orange_medium', 6.2, -11, 2.1, 1.3], ['tree_pine_yellow_large', 11, -11, 0.2, 1.3], ['tree_dead_medium', -12, -10, 1.4, 1.5],
    ['bare_tree_d', 8.5, -7.5, 0.9, 1.5], ['bare_tree_c', -6.5, -7.2, 0.5, 1.5], ['gravemarker_B', -1.8, -7.0, 0.2, 1], ['grave_A', 4.6, -7.2, 0.4, 1],
    ['pumpkin_orange', -9, -6.4, 0.7, 1], ['tree_pine_orange_small', 13.5, -7.5, 1.1, 1.4], ['tree_pine_yellow_small', -14, -7.8, 0.4, 1.4],
    ['gravestone', -4.8, -6.6, -0.3, 1], ['grave_B', 1.6, -7.6, 0.1, 1],
  ] as const) put(n, x, z, ry, sc);

  // Stars and moon, upper right.
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(320 * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 320; i++) {
    const t = rnd() * Math.PI * 2, u = 0.12 + rnd() * 0.88;
    sp[i * 3] = Math.cos(t) * Math.sqrt(1 - u * u) * 90; sp[i * 3 + 1] = u * 60 + 2; sp[i * 3 + 2] = -Math.abs(Math.sin(t)) * 90 - 10;
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
  moonSprite.position.set(-3.4, 5.9, -30); moonSprite.scale.setScalar(5.6);
  scene.add(moonSprite);

  // Lights: cool moon with hard shadows from the right-back, warm pools from the candles and lanterns.
  scene.add(new THREE.HemisphereLight(0x5f6fe0, 0x1a1030, 0.8));
  const moon = new THREE.DirectionalLight(0xc9d4ff, 3.2);
  moon.position.set(-7, 7.5, -4);
  scene.add(moon);
  if (renderer.shadowMap.enabled) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(4096, 4096);
    moon.shadow.camera.left = -10; moon.shadow.camera.right = 10;
    moon.shadow.camera.top = 10; moon.shadow.camera.bottom = -10;
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 40;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }
  const rim = new THREE.DirectionalLight(0x8a6cff, 1.8);
  rim.position.set(5, 3, -6);
  scene.add(rim);
  const warmL = new THREE.PointLight(0xffb060, 3.0, 5, 1.8); warmL.position.set(-2.75, 0.7, -0.3); root.add(warmL);
  const warmR = new THREE.PointLight(0xffb060, 2.8, 5, 1.8); warmR.position.set(2.6, 0.9, -0.3); root.add(warmR);
  const postL = new THREE.PointLight(0xffb060, 3.0, 7, 1.6); postL.position.set(-1.9, 2.6, -4.1); root.add(postL);
  const fill = new THREE.DirectionalLight(0xffd6b0, 0.32);
  fill.position.set(2.5, 1.5, 6);
  scene.add(fill);

  // Camera: low and frontal, the hero centred and a little above the frame's middle.
  const camera = new THREE.PerspectiveCamera(26, W / H, 0.1, 100);
  camera.position.set(0, 1.85, 6.9);
  camera.lookAt(0, 0.98, 0.3);
  camera.updateMatrixWorld();

  const prevPR = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevClear = renderer.getClearAlpha();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
  grade.setSize(W, H);
  grade.render(renderer, scene, camera);
  const image = document.createElement('canvas');
  image.width = W;
  image.height = H;
  const ctx = image.getContext('2d')!;
  ctx.drawImage(renderer.domElement, 0, 0, W, H, 0, 0, W, H);
  renderer.setPixelRatio(prevPR);
  renderer.setSize(prevSize.x, prevSize.y, false);
  renderer.setClearColor(0x000000, prevClear);
  scene.clear();

  void logoUrl; // no mark on the image: the pumpkin is the brand here
  return image;
}
