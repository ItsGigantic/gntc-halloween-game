import * as THREE from 'three';
import { CONFIG } from '../config';
import { model, materialOf } from '../assets/loader';
import { InstancedPool } from './pool';
import { Rng } from './rng';

const UP = new THREE.Vector3(0, 1, 0);

/** Everything beyond the fence: rolling hills, a dense forest, far-off graves, stars and a moon. */
export function buildOutside(parent: THREE.Object3D, rng: Rng): void {
  const half = CONFIG.world.size / 2;
  const group = new THREE.Group();
  parent.add(group);

  // Rolling hills: a big plane with value-noise height, flat under the arena.
  const size = 460;
  const seg = 64;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const grid = 24;
  const noise: number[] = [];
  for (let i = 0; i < (grid + 1) * (grid + 1); i++) noise.push(rng.next());
  const sample = (x: number, z: number) => {
    const fx = ((x + size / 2) / size) * grid;
    const fz = ((z + size / 2) / size) * grid;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const tx = fx - i0, tz = fz - j0;
    const wrap = (k: number) => ((k % (grid + 1)) + grid + 1) % (grid + 1);
    const n = (i: number, j: number) => noise[wrap(i) * (grid + 1) + wrap(j)];
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(n(i0, j0), n(i0 + 1, j0), sx), THREE.MathUtils.lerp(n(i0, j0 + 1), n(i0 + 1, j0 + 1), sx), sz);
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.max(Math.abs(x), Math.abs(z)) - (half + 4); // distance beyond the fence apron
    const ramp = THREE.MathUtils.smoothstep(d, 0, 26);
    const h = (sample(x, z) - 0.35) * 14 + sample(x * 2.7 + 50, z * 2.7 + 50) * 3;
    pos.setY(i, -0.6 + ramp * Math.max(-0.4, h));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const col = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0x241b4a), high = new THREE.Color(0x4a3d8a), tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + 2) / 12, 0, 1);
    tmpC.copy(low).lerp(high, t * t);
    col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  hills.position.y = 0;
  hills.receiveShadow = true;
  group.add(hills);

  // Forest and relics on the hills, instanced per model.
  const pools = new Map<string, InstancedPool>();
  let foliage: THREE.MeshStandardMaterial | null = null;
  let rock: THREE.MeshStandardMaterial | null = null;
  const pool = (name: string, cap: number) => {
    let p = pools.get(name);
    if (!p) {
      let override: THREE.Material | undefined;
      if (/^(bush|leafy_tree)_/.test(name)) {
        if (!foliage) {
          foliage = materialOf(name).clone();
          foliage.color.set(0x7d8fb0);
        }
        override = foliage;
      } else if (/^(pebble|rock|boulder|crag)_/.test(name)) {
        if (!rock) {
          rock = materialOf(name).clone();
          rock.color.set(0x8a8ea6);
        }
        override = rock;
      }
      p = new InstancedPool(name, cap, group, override, { cast: false, receive: true });
      pools.set(name, p);
    }
    return p;
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const heightAt = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z)) - (half + 4);
    const ramp = THREE.MathUtils.smoothstep(d, 0, 26);
    const h = (sample(x, z) - 0.35) * 14 + sample(x * 2.7 + 50, z * 2.7 + 50) * 3;
    return -0.6 + ramp * Math.max(-0.4, h);
  };
  const put = (name: string, x: number, z: number, cap: number, s = 1) => {
    const p = pool(name, cap);
    if (p.available() <= 0) return;
    const info = model(name);
    q.setFromAxisAngle(UP, rng.range(0, Math.PI * 2));
    v.set(x, heightAt(x, z) - info.box.min.y * s - 0.15, z);
    sc.setScalar(s);
    m.compose(v, q, sc);
    p.set(p.acquire(), m);
  };
  const trees = ['tree_pine_orange_large', 'tree_pine_yellow_large', 'tree_pine_orange_medium', 'tree_pine_yellow_medium', 'tree_dead_large', 'tree_dead_medium', 'leafy_tree_a', 'leafy_tree_b', 'leafy_tree_c', 'bare_tree_c', 'bare_tree_d'];
  // Dense ring just past the fence, thinning with distance.
  for (let i = 0; i < 300; i++) { // instanced trees are never culled per instance, so fewer is cheaper every frame
    const a = rng.range(0, Math.PI * 2);
    const r = half + 5 + Math.pow(rng.next(), 1.7) * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < half + 4 && Math.abs(z) < half + 4) continue;
    put(rng.pick(trees), x, z, 140, 0.9 + rng.next() * 0.6);
  }
  const relics = ['gravestone', 'grave_A', 'grave_B', 'gravemarker_A', 'gravemarker_B', 'pumpkin_orange', 'pumpkin_orange_small', 'pumpkin_yellow', 'post_lantern', 'post_skull', 'fence_seperate_broken', 'haybale', 'scarecrow', 'bench', 'coffin', 'boulder_a', 'boulder_b', 'crag_a', 'crag_b', 'rock_e', 'bush_e'];
  for (let i = 0; i < 110; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = half + 6 + rng.next() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < half + 4 && Math.abs(z) < half + 4) continue;
    put(rng.pick(relics), x, z, 32);
  }
  for (const [name, x, z] of [['crypt', -95, 70], ['crypt', 110, -60], ['wagon_hay', 80, 95], ['arch', -70, -105]] as const) put(name, x, z, 4);

  // Sky dome: the night fades to a faint violet-rose glow along the horizon so the far
  // hills sit against something, instead of a flat navy. Drawn behind the stars, unfogged.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(760, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x07061c) },
        uHorizon: { value: new THREE.Color(0x3b2a66) },
        uWarm: { value: new THREE.Color(0x5a3a6a) },
        uMoonDir: { value: new THREE.Vector3(-320, 0, -360).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uWarm, uMoonDir;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          // Tight band just above the horizon, trailing off into the zenith.
          float band = exp(-max(h, 0.0) * 6.0) * smoothstep(-0.08, 0.02, h);
          // A touch warmer toward the moon's side of the sky.
          float side = 0.5 + 0.5 * dot(normalize(vec3(vDir.x, 0.0, vDir.z)), uMoonDir);
          vec3 glow = mix(uHorizon, uWarm, side * 0.6);
          vec3 c = mix(uTop, glow, band * 0.9);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);

  // Stars on a distant dome and a big moon.
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const t = rng.range(0, Math.PI * 2);
    const u = rng.range(0.08, 1);
    const rr = 700;
    sp[i * 3] = Math.cos(t) * Math.sqrt(1 - u * u) * rr;
    sp[i * 3 + 1] = u * rr;
    sp[i * 3 + 2] = Math.sin(t) * Math.sqrt(1 - u * u) * rr;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  stars.frustumCulled = false;
  group.add(stars);

  const moonTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,243,214,1)');
    g.addColorStop(0.55, 'rgba(255,243,214,1)');
    g.addColorStop(0.62, 'rgba(255,230,180,0.35)');
    g.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, depthWrite: false }));
  moon.position.set(-320, 190, -360);
  moon.scale.setScalar(120);
  group.add(moon);
}
