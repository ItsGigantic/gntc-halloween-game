import * as THREE from 'three';
import { cloneModel, model, materialOf } from '../assets/loader';
import type { PostGrade } from '../game/grade';
import { Painterly } from './painterly';
import { makePumpkin } from './pumpkin';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Strokes } from './strokes';
import { setupBts } from './bts';
import { applyPsx } from './psx';
import { glowTexture, makeHalo } from '../game/glow';

export const SOCIAL_W = 1080;
export const SOCIAL_H = 1350;
/** Loop length in seconds. Every motion below completes a whole number of cycles in this time. */
export const SOCIAL_LOOP = 5;

export interface SocialScene {
  /** Render the frame at time t (seconds, wraps at SOCIAL_LOOP) and return a canvas holding it. */
  frame(t: number): HTMLCanvasElement;
}

/** Autumn foliage colours, picked per tree. */
const FOLIAGE = [0xe0782a, 0xc8452a, 0xe8a83a, 0xb85a22, 0xd8902e, 0xa83a26];
/** Fallen-leaf colours: the same family, a touch more varied. */
const LEAVES = [0xb4482a, 0xd07a2e, 0xe0a23c, 0x8a3a24];

/**
 * A 4:5 social post for the harvest: a plain pumpkin as the hero, pushed into the lower third so the
 * upper two thirds are golden-hour sky for copy. Hay bales, a hay wagon and gourds, turning trees
 * behind, a low sun, leaves on the ground and leaves drifting across on the breeze.
 * Built once; frame(t) poses the ambient motion and renders.
 */
export function buildSocialScene(renderer: THREE.WebGLRenderer, grade: PostGrade): SocialScene {
  const W = SOCIAL_W, H = SOCIAL_H;
  const TAU = Math.PI * 2;
  const w = TAU / SOCIAL_LOOP;
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.get(k) !== null && Number.isFinite(v) ? v : d; };
  // PS1 mode (?psx=1): a 267x334 framebuffer (shown 3x as crisp pixels), no anti-aliasing, 15-bit colour
  // with the console's dither, vertex snapping, affine textures, blob shadows only, and a gentle camera
  // drift so the vertex wobble shows. See psx.ts.
  const PSX = q.get('psx') === '1';
  const PSXW = num('psxw', 267), PSXH = Math.round(PSXW * 1.25);

  // The post is rendered offline, so it always gets proper soft shadows, whatever the game's
  // device-based setting (which turns them off on touch devices).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Colour-grade looks, picked with ?look=: 'rich' is the chosen default; 'base' (the earlier grade), 'film' (softer contrast, matte
  // lifted blacks, teal shadows and amber highlights) or 'rich' (deeper contrast and colour). Every
  // look darkens the sky a little; ?skydark= overrides how much (1 = as painted).
  const LOOKS: Record<string, { c: number; s: number; e: number; v: number; sh: [number, number, number]; hi: [number, number, number]; lift: [number, number, number]; sky: number }> = {
    base: { c: 1.1, s: 1.06, e: 1.0, v: 0.3, sh: [-0.01, 0.035, 0.06], hi: [0.09, 0.055, -0.02] as [number, number, number], lift: [0.008, 0.008, 0.022], sky: 0.8 },
    film: { c: 1.1 * 0.94, s: 1.06 * 0.88, e: 1.0 * 1.03, v: 0.3 + 0.05, sh: [-0.02, 0.05, 0.08], hi: [0.11, 0.06, -0.03], lift: [0.035, 0.03, 0.04], sky: 0.8 },
    rich: { c: 1.1 * 1.08, s: 1.06 * 1.1, e: 1.0 * 0.98, v: 0.3 + 0.12, sh: [-0.01, 0.035, 0.08], hi: [0.09, 0.055, -0.02] as [number, number, number], lift: [0.0, 0.0, 0.012], sky: 0.74 },
  };
  const LOOK = LOOKS[q.get('look') ?? 'rich'] ?? LOOKS.rich;
  const SKY = num('skydark', LOOK.sky);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1230);
  scene.fog = new THREE.Fog(num('fogc', 0x5a3028), 12, 48);
  const root = new THREE.Group();
  scene.add(root);
  if (q.get('debug') === '1') (window as unknown as { __socialScene: THREE.Scene }).__socialScene = scene;

  // Ground: warm earth.
  const floorMat = materialOf('floor_dirt').clone();
  floorMat.color.set(num('floorc', 0x9c7a56));
  // The ground falls into shade behind the pumpkin, so its sides read against a darker middle distance.
  floorMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - ${num('middark', 0.65).toFixed(2)} * smoothstep(0.0, -4.5, vWP.z);`);
  };
  floorMat.customProgramCacheKey = () => 'floor-shade';
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 1; j++) {
      const t = cloneModel('floor_dirt');
      t.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = floorMat; });
      t.position.set(i * 4, -0.03, j * 4 + 1.5);
      t.rotation.y = ((i + j + 8) % 4) * Math.PI * 0.5;
      root.add(t);
    }
  }
  // Beyond the yard, a stubble field runs on to the trees.
  {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, -0.05, -60);
    root.add(g);
  }
  // Sky: one warm autumn sunset. Deep russet at the top into burnt sienna, dark enough for white type
  // across the whole copy area, warming to gold only in a band right at the horizon.
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(80, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(num('skytop', 0x4a2824)) },
        uMid: { value: new THREE.Color(num('skymid', 0x9c4c30)) },
        uHorizon: { value: new THREE.Color(num('skyhor', 0xf6c070)) },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop, uMid, uHorizon; varying vec3 vDir;
        void main(){
          float h = max(vDir.y, 0.0);
          vec3 c = mix(uMid, uTop, smoothstep(0.02, 0.4, h));
          // Gold only in a tight band at the horizon, under the copy, so white type stays readable.
          c = mix(c, uHorizon, exp(-h * ${num('hz', 45).toFixed(1)}) * smoothstep(-0.12, 0.0, vDir.y) * 0.92);
          gl_FragColor = vec4(c * ${SKY.toFixed(3)}, 1.0);
        }`,
    }),
  ));

  const placed: { o: THREE.Object3D; r: number }[] = [];
  const put = (name: string, x: number, z: number, ry = 0, s = 1) => {
    const o = cloneModel(name);
    const inf = model(name);
    o.position.set(x, -inf.box.min.y * s, z);
    o.userData.baseY = o.position.y;
    o.rotation.y = ry;
    o.scale.setScalar(s);
    root.add(o);
    placed.push({ o, r: 0.5 * Math.max(inf.size.x, inf.size.z) * s });
    return o;
  };
  // Grounding shadows: a soft, dark-cored contact shadow under every object standing on the ground,
  // so nothing floats. Built once from everything put() placed (ground level, within the yard).
  const addGroundShadows = (items: { o: THREE.Object3D; r: number }[], colour: number, opacity: number, y: number, lean: THREE.Vector2, skip: Set<THREE.Object3D>) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(0.8, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const list = items.filter(({ o }) => !skip.has(o) && o.position.z > -6 && o.position.y > -0.5 && o.position.y < 0.12 + (o.userData.baseY ?? 0));
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: colour, transparent: true, opacity, depthWrite: false }), list.length);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach(({ o, r }, i) => {
      // Small things get a minimum size and a bit more lean, so the shadow shows beside them rather
      // than hiding underneath.
      const d = r * 2.6 + 0.22;
      const shift = r * 0.45 + 0.07;
      p.set(o.position.x + lean.x * shift, y, o.position.z + lean.y * shift);
      qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(lean.x, lean.y));
      sc.set(d, 1, d * (1 + 0.4 * lean.length()));
      m.compose(p, qt, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    root.add(mesh);
  };

  /** Place scaled to a target height. */
  const putH = (name: string, x: number, z: number, ry: number, h: number, y = 0) => {
    const inf = model(name);
    const s = h / inf.size.y;
    const o = put(name, x, z, ry, s);
    o.position.y += y;
    return o;
  };
  const tint = (o: THREE.Object3D, color: number) => o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) { m.material = (m.material as THREE.Material).clone(); (m.material as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(color)); }
  });
  /** Turn green foliage to an autumn colour, keeping the texture's shading; trunks are left alone. */
  const autumnize = (o: THREE.Object3D, color: number, dim = 1) => o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    const leaf = new THREE.Color(color);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLeaf = { value: leaf };
      sh.uniforms.uDim = { value: dim };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uLeaf;\nuniform float uDim;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = diffuseColor.rgb;
            float green = smoothstep(0.02, 0.12, c.g - max(c.r, c.b));
            float l = dot(c, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(c, uLeaf * (0.35 + l * 2.4), green) * uDim;
          }`);
    };
    mat.customProgramCacheKey = () => 'autumnize';
    m.material = mat;
  });

  /** Swap a model's warm (orange/yellow) texels for another colour, keeping their shading. */
  const recolour = (o: THREE.Object3D, color: number) => o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    const to = new THREE.Color(color);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTo = { value: to };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTo;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = diffuseColor.rgb;
            float warm = smoothstep(0.08, 0.25, c.r - c.b) * step(c.g, c.r);
            float l = dot(c, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(c, uTo * (0.45 + l * 1.6), warm);
          }`);
    };
    mat.customProgramCacheKey = () => 'recolour';
    m.material = mat;
  });
  /** Turn a lantern's black iron to warm brass. */
  const brass = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          {
            float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(vec3(0.6, 0.42, 0.2), diffuseColor.rgb, smoothstep(0.06, 0.2, l));
          }`);
      };
      mat.customProgramCacheKey = () => 'brass';
      mat.metalness = 0.3;
      mat.roughness = 0.5;
      m.material = mat;
    });
    return o;
  };

  // --- The hero: a plain harvest pumpkin, the one thing in the frame that's lit like a portrait.
  const R = num('pr', 1.4); // half its width: big enough to own the frame
  const camZPos = num('sz', 10.8);
  // Lens shift: drops the whole scene a little down the frame, for clear air under the date line.
  const SHIFT = num('sshift', 45);
  // A purpose-built pumpkin (see pumpkin.ts): the KayKit models are too low-poly and flat-coloured to
  // hold up as the hero at this size.
  const hero = makePumpkin({ radius: R, ribs: num('ribs', 10), squash: num('squash', 0.74), groove: num('groove', 0.11), segments: PSX ? [40, 12] : undefined });
  hero.position.set(0, 0, 0.3);
  hero.rotation.set(-0.04, num('pry', 0.35), 0.04);
  hero.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.add(hero);
  // Contact shadow: a dark core right where the pumpkin meets the ground, so it sits on the earth.
  const contactTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.72, 'rgba(255,255,255,0.95)'); g.addColorStop(0.86, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(R * num('contactr', 1.42), 48),
    new THREE.MeshBasicMaterial({ map: contactTex, color: 0x0e0402, transparent: true, opacity: num('contactop', 0.92), depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.09, 0.3); // above the leaf litter
  contact.renderOrder = 1;
  root.add(contact);

  // The harvest cast, arranged like the Halloween piece: a little pumpkin friend on the left, a hay
  // bale with a pumpkin on top on the right, a lantern on a hay bale back left, a hay wagon back right,
  // and a spill of gourds among the fallen leaves running off both edges.
  put('pumpkin_yellow_small', -1.95, 1.05, 0.5, 1.0).rotation.z = -0.12; // leaning in toward its big friend
  const bale = (x: number, z: number, ry: number, h: number, y = 0) => { const o = putH('haybale', x, z, ry, h, y); tint(o, num('hayc', 0xb49a78)); return o; };
  bale(2.05, 0.8, 1.45, 0.55);
  put('pumpkin_orange_small', 2.0, 0.8, 0.4, 0.55).position.y += 0.55;
  bale(-2.55, -0.55, 0.25, 0.7);
  bale(-2.75, -1.45, -0.15, 0.7);
  bale(-2.65, -1.0, 0.1, 0.62, 0.7);
  const lanternL = brass(put('lantern_standing', -2.6, -0.5, 0.4, 0.85));
  lanternL.position.y += 0.7;
  brass(put('lantern_standing', 2.95, -0.7, 0.3, 0.95));
  putH('pitchfork', 2.45, -1.25, 0.6, 1.5).rotation.z = -0.28;
  const WG = { x: num('wgx', 3.9), z: num('wgz', -2.9), h: num('wgh', 2.1) };
  tint(putH('wagon_hay', WG.x, WG.z, num('wgr', -0.95), WG.h), num('hayc', 0xb49a78));
  // The haul: pumpkins heaped on the hay.
  for (const [dx, dz, sc, n] of [[-0.55, 0.35, 0.55, 'pumpkin_orange_small'], [-0.05, 0.05, 0.6, 'pumpkin_orange_small'], [-0.35, -0.35, 0.5, 'pumpkin_yellow_small'], [0.3, 0.45, 0.5, 'pumpkin_orange_small']] as const) {
    put(n, WG.x + dx, WG.z + dz, dx * 3, sc).position.y += WG.h * num('wgtop', 0.9);
  }

  // Gourds at the edges, half out of frame, so the harvest carries on past them.
  put('pumpkin_orange_small', 2.45, 1.2, 1.1, 0.8);
  put('pumpkin_yellow_small', -1.0, 1.8, 2.0, 0.6);
  put('pumpkin_orange_small', 1.2, 1.95, 0.7, 0.55);
  put('pumpkin_orange_small', 2.95, 1.95, 2.2, 0.85);
  put('pumpkin_yellow_small', -3.05, 1.95, 0.9, 0.8);
  put('pumpkin_orange_small', -2.45, 1.25, 0.3, 0.65);
  const keepOut: [number, number, number][] = [
    [0, 0.3, R + 0.3], [-1.95, 1.05, 0.55], [1.95, 0.75, 0.75], [-2.45, 1.25, 0.4], [2.45, 1.2, 0.45],
    [-1.0, 1.8, 0.38], [1.2, 1.95, 0.36], [2.95, -0.7, 0.5], [-2.6, -0.6, 0.9], [2.95, 1.95, 0.5], [-3.05, 1.95, 0.5],
  ];
  // Little gourds gathered in clusters, at the bale bases, by the wagon and at the front corners,
  // rather than scattered like confetti.
  {
    let cs = 101;
    const crnd = () => ((cs = (cs * 16807) % 2147483647) / 2147483647);
    const kinds: [string, number][] = [
      ['pumpkin_orange_small', 0.34], ['pumpkin_yellow_small', 0.32], ['pumpkin_orange_small', 0.28], ['pumpkin_yellow_small', 0.26],
    ];
    const placed: [number, number][] = [];
    const anchors: [number, number, number][] = [
      [-2.05, 0.25, 4], [1.55, 1.35, 3], [3.15, -1.55, 4], [-1.85, 2.35, 4], [2.15, 2.5, 4], [-3.3, 1.0, 3], [0.65, 2.65, 2], [-0.85, 2.7, 2],
    ];
    for (const [ax, az, count] of anchors) {
      let n = 0;
      for (let tries = 0; tries < 200 && n < count; tries++) {
        const x = ax + (crnd() - 0.5) * 0.9, z = az + (crnd() - 0.5) * 0.7;
        if (keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
        if (placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < 0.4)) continue;
        placed.push([x, z]);
        n++;
        const [name, sc] = kinds[Math.floor(crnd() * kinds.length)];
        const g = put(name, x, z, crnd() * TAU, sc * (0.85 + crnd() * 0.3));
        // A market mix: some heirloom cream and sage gourds among the orange.
        const roll = crnd();
        if (roll < 0.22) recolour(g, 0xeadfc6); else if (roll < 0.36) recolour(g, 0x93a27a);
      }
    }
  }

  // --- Leaves: maple and elm shapes, gently cupped, a touch lighter at the edges than at the veins.
  const shapeLeaf = (outline: [number, number][], stemLen: number) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))), 6);
    const stem = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.018, 0.02), new THREE.Vector2(0.018, 0.02), new THREE.Vector2(0.008, -stemLen), new THREE.Vector2(-0.008, -stemLen)]));
    const merged = mergeGeometries([g, stem])!;
    const p = merged.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const r = Math.hypot(x, y);
      p.setZ(i, 0.14 * r * r + 0.1 * Math.abs(x)); // cupped, folded along the midrib
      const v = 0.82 + 0.3 * Math.min(1, r / 0.5) - (Math.abs(x) < 0.02 ? 0.1 : 0);
      col.set([v, v * 0.97, v * 0.92], i * 3);
    }
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    merged.computeVertexNormals();
    return merged;
  };
  const mapleGeo = (() => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 90; i++) {
      const th = (i / 90) * TAU; // from +y, clockwise
      let r = 0.5 + 0.5 * Math.pow(Math.abs(Math.cos(2.5 * th)), 0.75); // five lobes, a notch at the stem
      r *= 1 + 0.045 * Math.sin(th * 30); // fine serration
      pts.push([0.5 * r * Math.sin(th), 0.5 * r * Math.cos(th) + 0.05]);
    }
    return shapeLeaf(pts, 0.28);
  })();
  const elmGeo = (() => {
    const half: [number, number][] = [[0, -0.42], [0.16, -0.32], [0.24, -0.12], [0.25, 0.08], [0.2, 0.26], [0.1, 0.4], [0, 0.5]];
    return shapeLeaf([...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])], 0.12);
  })();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  // Leaves are thin: light shines through them, so they keep their colour even when backlit.
  const translucent = (m: THREE.MeshStandardMaterial, fade: boolean) => {
    m.onBeforeCompile = (sh) => {
      if (fade) {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
          .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vAlpha;');
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.28;');
    };
    m.customProgramCacheKey = () => (fade ? 'leaf-fade' : 'leaf');
    return m;
  };
  translucent(leafMat, false);
  let ls = 57;
  const lrnd = () => ((ls = (ls * 16807) % 2147483647) / 2147483647);
  const dummy = new THREE.Object3D();
  const leafColour = (c: THREE.Color) => c.set(LEAVES[Math.floor(lrnd() * LEAVES.length)]).multiplyScalar(0.8 + lrnd() * 0.14);
  // On the ground: drifts and bare patches of earth, maples and elms mixed, a few overlapping.
  {
    const n = num('leaves', 520);
    const maples = new THREE.InstancedMesh(mapleGeo, leafMat, n);
    const elms = new THREE.InstancedMesh(elmGeo, leafMat, n);
    let nm = 0, ne = 0;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const z = -5 + Math.pow(lrnd(), 0.6) * 8.2;
      const half = 0.29 * (camZPos - z) + 0.8;
      const x = (lrnd() * 2 - 1) * half;
      if (Math.abs(x) < 1.7 && z > 0.4 && z < 2.6 && lrnd() < 0.75) continue; // calmer ground round the hero, so its shadow reads
      const dens = 0.5 + 0.5 * Math.sin(x * 1.3 + z * 0.7 + 0.8) * Math.sin(z * 1.9 - x * 0.45);
      if (lrnd() > 0.2 + 0.8 * dens) continue;
      const maple = lrnd() < 0.6;
      const size = (maple ? 0.46 : 0.4) * (0.75 + lrnd() * 0.5);
      dummy.position.set(x, 0.012 + lrnd() * 0.025, z);
      dummy.rotation.set(-Math.PI / 2 + (lrnd() - 0.5) * 0.35, (lrnd() - 0.5) * 0.3, lrnd() * TAU, 'XZY');
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      const im = maple ? maples : elms;
      const k = maple ? nm++ : ne++;
      im.setMatrixAt(k, dummy.matrix);
      im.setColorAt(k, leafColour(c));
    }
    maples.count = nm; elms.count = ne;
    for (const im of [maples, elms]) { im.receiveShadow = true; root.add(im); }
  }
  // In the air: a few leaves drift down slowly the way real ones do, rocking side to side as they
  // fall (each swing tilts the leaf and lifts it a little), fading in and out at the ends of their
  // paths. All paths stay below the copy band (world y < ~2.6 + 0.025d at depth d).
  type Faller = { x0: number; y0: number; z: number; dx: number; dy: number; ph: number; size: number; amp: number; rock: number; k: number; f: number };
  const fallers: Faller[] = [];
  const fallN = num('fall', 14);
  for (let i = 0; i < fallN; i++) {
    const z = -2.5 + lrnd() * 9;
    const d = camZPos - z;
    const half = 0.29 * d;
    let x0 = (lrnd() * 2 - 1) * half * 0.9;
    if (Math.abs(x0) < 1.8 && z > -1.5) x0 = Math.sign(x0 || 1) * (1.8 + lrnd() * 1.2); // don't crowd the hero
    fallers.push({
      x0, y0: 1.6 + lrnd() * (1.0 + 0.02 * d), z,
      dx: 0.5 + lrnd() * 0.7, dy: -(0.7 + lrnd() * 0.5), ph: lrnd(), size: 0.36 + lrnd() * 0.12,
      amp: 0.18 + lrnd() * 0.16, rock: 0.5 + lrnd() * 0.35, k: 2 + Math.floor(lrnd() * 2), f: lrnd() * TAU,
    });
  }
  const airGeo = mapleGeo.clone();
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(fallN), 1);
  airGeo.setAttribute('aAlpha', alpha);
  const air = new THREE.InstancedMesh(airGeo, translucent(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, transparent: true, depthWrite: false }), true), fallN);
  {
    const c = new THREE.Color();
    for (let i = 0; i < fallN; i++) air.setColorAt(i, leafColour(c));
  }
  air.frustumCulled = false;
  root.add(air);

  // --- Backdrop: turning trees beyond the field, shaped as a silhouette that stays low behind the
  // pumpkin (clear sky for copy) and rises toward the frame edges.
  {
    let fs = 23;
    const frnd = () => ((fs = (fs * 16807) % 2147483647) / 2147483647);
    const tilt = Math.atan2(num('slook', 3.0) - num('sy', 2.6), camZPos - 0.3);
    const halfFov = THREE.MathUtils.degToRad(num('sfov', 40) / 2);
    const tipAt = (px: number, d: number) => num('sy', 2.6) + d * Math.tan(tilt + Math.atan(((H / 2 - px) / (H / 2)) * Math.tan(halfFov)));
    const lineY = num('line', 805), rise = num('rise', 50);
    const rows = [
      { z: -9.5, step: 1.15, off: 40, jit: 25 },
      { z: -13, step: 1.25, off: 22, jit: 28 },
      { z: -17, step: 1.35, off: 5, jit: 30 },
      { z: -22, step: 1.45, off: -12, jit: 35 },
    ];
    const kinds = ['tree_pine_orange_medium', 'tree_pine_yellow_medium', 'leafy_tree_c', 'leafy_tree_a', 'tree_pine_yellow_medium', 'leafy_tree_c', 'tree_pine_orange_large'];
    for (const r of rows) {
      const halfW = 0.291 * (camZPos - r.z) + 3;
      for (let x = -halfW; x <= halfW; x += r.step * (0.7 + frnd() * 0.6)) {
        const z = r.z + (frnd() - 0.5) * 1.8;
        const d = camZPos - z;
        const sx = Math.abs(x) / (0.291 * d);
        const px = lineY + r.off - rise * THREE.MathUtils.smoothstep(sx, 0.42, 1.05) + (frnd() - 0.5) * 2 * r.jit;
        const h = Math.max(2.5, tipAt(px - SHIFT, d)); // px is in the final, lens-shifted frame
        let n = kinds[Math.floor(frnd() * kinds.length)];
        if (sx < 0.2 && n.startsWith('leafy')) n = 'tree_pine_orange_medium'; // no round crown behind the stem
        const o = putH(n, x, z, frnd() * TAU, h);
        // Darker and deeper than the hero, so the lit pumpkin stands clear of them.
        if (n === 'leafy_tree_c') tint(o, 0x5a6a52); // a few evergreens for cool relief
        else if (n.startsWith('leafy')) autumnize(o, FOLIAGE[Math.floor(frnd() * FOLIAGE.length)], num('treedim', 0.4));
        else tint(o, num('pinedim', 0x7a5a5a));
      }
    }
  }

  // Distant hills, painted flat in the warm haze, on the right where the copy is short.
  for (const [x, y, z, sx, sy, col] of [[num('hlx', 17), num('hly', -4), -62, 15, 12.5, 0x8a4e44], [27, -5, -70, 13, 11, 0xa26050], [9, -6, -66, 12, 9.5, 0x96584a]] as const) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: col, fog: false }));
    hill.scale.set(sx, sy, 6);
    hill.position.set(x, y, z);
    scene.add(hill);
  }
  // Sunset streaks: long, low-contrast bands of cloud across the sky, darker than the sky behind them
  // (so white type still reads) and caught with gold along their upper edges by the setting sun.
  const streakTex = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
    const ctx = c.getContext('2d')!;
    let cr = 9;
    const r = () => ((cr = (cr * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 18; i++) {
      const x = 120 + r() * 784, y = 70 + (r() - 0.5) * 22, rx = 120 + r() * 220, ry = 14 + r() * 14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.6, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // tint: dusky body, gold along the top edge
    ctx.globalCompositeOperation = 'source-atop';
    const tint = ctx.createLinearGradient(0, 30, 0, 110);
    tint.addColorStop(0, 'rgb(246,178,104)'); tint.addColorStop(0.3, 'rgb(150,70,50)'); tint.addColorStop(1, 'rgb(96,40,34)');
    ctx.fillStyle = tint; ctx.fillRect(0, 0, 1024, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const streaks: { s: THREE.Sprite; x: number; ph: number; amp: number }[] = [];
  for (const [x, y, w, hgt, op, ph] of [[-4, 9.5, 34, 2.0, 0.55, 0.3], [9, 13.5, 30, 1.6, 0.45, 2.1], [-10, 17.5, 36, 1.8, 0.4, 4.0], [6, 22, 40, 1.5, 0.32, 1.2]] as const) {
    if (num('streak', 0) <= 0) continue; // off by default: the sky behind the copy reads best as one smooth gradient
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: streakTex, transparent: true, opacity: num('streak', 0) * op, depthWrite: false, fog: false }));
    sp.position.set(x, y, -56);
    sp.scale.set(w, hgt * 2.2, 1);
    sp.renderOrder = -1;
    scene.add(sp);
    streaks.push({ s: sp, x, ph, amp: 0.8 });
  }

  // Painted clouds: soft cumulus low on the right, lit warm from below by the low sun, clear of the copy.
  const cloudTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const ctx = c.getContext('2d')!;
    let cr = 5;
    const r = () => ((cr = (cr * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = 80 + r() * 352, y = 150 - Math.sin(((x - 80) / 352) * Math.PI) * (50 + r() * 50) + r() * 30, rad = 40 + r() * 55;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(255,250,242,0.75)'); g.addColorStop(1, 'rgba(255,245,230,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    // warm, slightly darker underside
    ctx.globalCompositeOperation = 'source-atop';
    const under = ctx.createLinearGradient(0, 90, 0, 230);
    under.addColorStop(0, 'rgba(255,255,255,0)'); under.addColorStop(1, 'rgba(240,170,120,0.55)');
    ctx.fillStyle = under; ctx.fillRect(0, 0, 512, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const clouds: { s: THREE.Sprite; x: number; ph: number }[] = [];
  for (const [x, y, z, w, ph, flip] of [[num('clx', 13.5), num('cly', 3.4), -46, num('clw', 9.5), 0.5, 1], [20, 4.4, -52, 12, 2.6, -1]] as const) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0xffc8a0, transparent: true, opacity: num('cloud', 0.75), depthWrite: false, fog: false }));
    sp.position.set(x, y, z);
    sp.scale.set(w * flip, w * 0.5, 1);
    scene.add(sp);
    clouds.push({ s: sp, x, ph });
  }

  // A low hedge of turning shrubs and a band of ground haze at the field's edge, so there's no hard
  // horizon line behind the pumpkin.
  {
    let bs = 77;
    const brnd = () => ((bs = (bs * 16807) % 2147483647) / 2147483647);
    const shrubs = ['bush_a', 'bush_b', 'bush_c', 'bush_d', 'bush_e'];
    for (let x = -9; x <= 9; x += 0.9 + brnd() * 0.8) {
      const o = putH(shrubs[Math.floor(brnd() * shrubs.length)], x, -7.2 + (brnd() - 0.5) * 1.2, brnd() * TAU, 0.6 + brnd() * 0.5);
      autumnize(o, brnd() < 0.4 ? [0x6b6a3a, 0x7a7a40, 0x5e6a3a][Math.floor(brnd() * 3)] : FOLIAGE[Math.floor(brnd() * FOLIAGE.length)], 0.38);
    }
    for (const [x, z] of [[-5.2, -6.4], [4.6, -6.2]] as const) tint(bale(x, z, brnd() * 0.6, 0.6), 0x8a7060);
    const haze = new THREE.MeshBasicMaterial({ map: glowTexture(), color: num('hazec', 0xb07050), transparent: true, opacity: 0.05, depthWrite: false });
    for (const [x, z, w] of [[-6, -9, 16], [5, -10, 16], [0, -12, 22]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2), haze);
      m.position.set(x, 0.7, z);
      root.add(m);
    }
  }

  // The sun, low and golden, sinking just behind the pumpkin's right shoulder.
  const sunC = document.createElement('canvas'); sunC.width = sunC.height = 256;
  const mctx = sunC.getContext('2d')!;
  const mg = mctx.createRadialGradient(128, 128, 60, 128, 128, 128);
  mg.addColorStop(0, 'rgba(255,246,214,1)'); mg.addColorStop(0.5, 'rgba(255,232,180,1)'); mg.addColorStop(0.6, 'rgba(255,200,120,0.4)'); mg.addColorStop(1, 'rgba(255,180,100,0)');
  mctx.fillStyle = mg; mctx.fillRect(0, 0, 256, 256);
  const sunTex = new THREE.CanvasTexture(sunC); sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: 0xffe0a8, opacity: num('mop', 0.95), fog: false, transparent: true, depthWrite: false }));
  sunSprite.position.set(num('smx', 5.5), num('smy', 2.95), -45);
  sunSprite.scale.setScalar(num('sms', 5.5));
  sunSprite.renderOrder = -1;
  scene.add(sunSprite);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, opacity: 0.35, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunGlow.position.copy(sunSprite.position).add(new THREE.Vector3(0, 0, 1));
  sunGlow.scale.setScalar(num('sms', 5.5) * 2.6);
  scene.add(sunGlow);
  // Low golden haze drifting over the field.
  const mist: { s: THREE.Sprite; x: number; amp: number; ph: number }[] = [];
  for (const [x, y, z, sc, amp, ph] of [[-2, 0.5, -2.5, 7, 0.9, 0], [2.5, 0.4, -1, 6, 0.7, 2.1], [0, 0.7, -4, 9, 1.1, 4.0], [-5, 0.5, -5, 11, 1.0, 0.4], [0, 0.5, -5, 11, 1.0, 2.2], [5, 0.5, -5, 11, 1.0, 4.1]] as const) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xe0a070, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(x, y, z);
    s.scale.set(sc, sc * 0.2, 1);
    root.add(s);
    mist.push({ s, x, amp, ph });
  }

  // Lights: low golden sun behind, soft sky above, a warm key on the front, and the two lanterns.
  scene.add(new THREE.HemisphereLight(num('hemisky', 0xc0c8e8), 0x5a3e2a, num('hemi', 0.62)));
  const sun = new THREE.DirectionalLight(0xffc070, num('sun', 3.6));
  // From the sun's side but steeper than the disc in the sky, so the pumpkin throws a solid shadow
  // forward-left onto lit ground (a grazing angle stretches it into the dark and loses it).
  sun.position.set(num('sunx', 8), num('suny', 8), num('sunz', -2.5));
  scene.add(sun);
  if (renderer.shadowMap.enabled) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }
  const key = new THREE.DirectionalLight(0xffdcae, num('key', 0.6));
  key.position.set(-6, 3.5, 6);
  const coolFill = new THREE.DirectionalLight(0xa8bce0, num('cool', 0.6));
  coolFill.position.set(6, 2, 6);
  scene.add(coolFill);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffa860, 1.2);
  rim.position.set(5, 3, -7);
  scene.add(rim);
  // The hero is lit like a portrait: a warm spot that falls mostly on the pumpkin, a golden rim from
  // the low sun behind it, and a soft pool of light on the ground around it.
  const heroSpot = new THREE.SpotLight(0xffd6a0, num('spot', 4.2), 0, num('spota', 0.2), 0.55, 0);
  heroSpot.position.set(-3.5, 7, 7);
  heroSpot.target.position.set(0, 0.9, 0.3);
  root.add(heroSpot, heroSpot.target);
  if (renderer.shadowMap.enabled) {
    heroSpot.castShadow = true;
    heroSpot.shadow.mapSize.set(2048, 2048);
    heroSpot.shadow.bias = -0.0008;
    heroSpot.shadow.normalBias = 0.02;
    heroSpot.shadow.radius = 4;
  }
  const heroRim = new THREE.SpotLight(0xffb45a, num('rimspot', 7), 0, 0.32, 0.6, 0);
  heroRim.position.set(3.2, 3.2, -4.5);
  heroRim.target.position.set(0, 0.9, 0.3);
  root.add(heroRim, heroRim.target);
  {
    const m = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffb060, transparent: true, opacity: num('heropool', 0.22), blending: THREE.AdditiveBlending, depthWrite: false });
    const d = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), m);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0.9, 0.016, 1.0); // on the sunlit side, so it doesn't fill the shadow in
    root.add(d);
  }
  // A painted cast shadow along the sun's direction (forward-left). The real shadow is there too, but on
  // mid-brown leaf litter it barely reads; this gives the pumpkin the grounded shadow the snowmen get.
  {
    const dir = new THREE.Vector2(-num('sunx', 8), -num('sunz', -2.5)).normalize();
    // A solid core with a soft penumbra, darkest right at the base where the pumpkin meets the ground.
    const shadowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 40, 4, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.1, 0.3); // just above the leaf litter, which would otherwise hide it
    pivot.rotation.y = Math.atan2(dir.x, dir.y);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x1a0a06, transparent: true, opacity: num('castop', 0.88), depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(R * 2.2, R * 3.4, 1);
    shadow.position.set(0, 0, R * 1.15);
    shadow.renderOrder = 2;
    pivot.add(shadow);
    root.add(pivot);
  }
  const warmL = new THREE.PointLight(0xffb060, 3.0, 4.5, 1.7); warmL.position.set(-2.55, 1.25, -0.35); root.add(warmL);
  const warmR = new THREE.PointLight(0xffb060, 3.0, 4.5, 1.7); warmR.position.set(2.95, 0.75, -0.6); root.add(warmR);
  const glowL = makeHalo(0xffa040, 1.2); glowL.position.set(-2.6, 1.25, -0.5); root.add(glowL);
  const glowR = makeHalo(0xffa040, 1.0); glowR.position.set(2.95, 0.8, -0.7); root.add(glowR);
  const poolL = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa040, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
  const poolLm = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), poolL);
  poolLm.rotation.x = -Math.PI / 2; poolLm.position.set(-2.3, 0.014, 0.1); root.add(poolLm);
  const poolR = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa040, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
  const poolRm = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), poolR);
  poolRm.rotation.x = -Math.PI / 2; poolRm.position.set(2.85, 0.013, -0.45); root.add(poolRm);

  {
    const sunDir = new THREE.Vector2(-num('sunx', 8), -num('sunz', -2.5)).normalize();
    addGroundShadows(placed, 0x140604, num('gshadow', 0.75), 0.06, sunDir, new Set());
  }
  // Camera: low, tilted up, so the cast fills the lower third and the sky the rest.
  const camera = new THREE.PerspectiveCamera(num('sfov', 40), W / H, 0.1, 160);
  const camY = num('sy', 2.6), camZ = camZPos, look = num('slook', 3.0);
  camera.setViewOffset(W, H, 0, -SHIFT, W, H);

  const SS = PSX ? PSXW / W : 2; // render at 2x and downsample, for clean edges (PS1: render small)
  const noGrain = q.get('nograin') === '1';
  // Behind-the-scenes shots (?bts=aerial|side|top|over): the set seen from outside, with the post camera drawn in.
  const bts = q.get('bts') ? setupBts(scene, camera, W / H, q.get('bts')!, sun) : null;
  // Storybook finish (see painterly.ts). ?paint=0 shows the plain render; brush/ink/paper tune it.
  const painter = q.get('paint') !== '1' ? null : new Painterly({ radius: num('brush', 8), edge: num('ink', 0), paper: num('paper', 0.035), warp: num('warp', 3.5), hardness: num('hard', 3), breathe: num('breathe', 10), bloom: num('bloom', 0.35), rampMix: num('ramp', 0.12), bottom: num('bottom', 0.18), ramp: ['#1f2a3a', '#5a3a3a', '#b8643a', '#f0b25a', '#fff2dc'] });
  // Brush strokes laid over the paint (see strokes.ts); off by default; ?strokes=1 to turn on.
  const strokes = painter && q.get('strokes') === '1' ? new Strokes(painter.input.texture, { width: W * SS, height: H * SS, opacity: num('sop', 0.8) }) : null;
  const out = document.createElement('canvas');
  out.width = PSX ? PSXW : W;
  out.height = PSX ? PSXH : H;
  const octx = out.getContext('2d')!;

  if (PSX) {
    renderer.shadowMap.enabled = false; // the PS1 had no shadow maps; the blob shadows carry it
    if (scene.fog instanceof THREE.Fog) { scene.fog.near *= 0.7; scene.fog.far *= 0.75; } // short draw distance
    applyPsx(scene, PSXW, PSXH);
  }

  return {
    frame(tRaw: number): HTMLCanvasElement {
      const t = ((tRaw % SOCIAL_LOOP) + SOCIAL_LOOP) % SOCIAL_LOOP;
      const s = (k: number, ph = 0) => Math.sin(w * k * t + ph);
      const flicker = (ph: number) => 0.5 * s(6, ph) + 0.3 * s(13, ph * 2.1) + 0.2 * s(23, ph * 3.7);
      const fL = flicker(1.9), fR = flicker(3.3);
      // Point lights stay steady (a flickering light re-shades everything it touches, which a GIF
      // palette can't hold); the glow sprites and pools carry the flicker.
      (glowL.material as THREE.SpriteMaterial).opacity = 0.24 * (1 + 0.1 * fL);
      (glowR.material as THREE.SpriteMaterial).opacity = 0.22 * (1 + 0.08 * fR);
      poolL.opacity = 0.16 * (1 + 0.08 * fL);
      poolR.opacity = 0.16 * (1 + 0.08 * fR);
      // Falling leaves: a slow drift with a pendulum rock (two or three swings per loop).
      for (let i = 0; i < fallN; i++) {
        const f = fallers[i];
        const u = (t / SOCIAL_LOOP + f.ph) % 1;
        const sw = Math.sin(w * f.k * t + f.f);
        dummy.position.set(
          f.x0 + f.dx * (u - 0.5) + f.amp * sw,
          f.y0 + f.dy * (u - 0.5) + 0.35 * f.amp * (1 - Math.cos(2 * (w * f.k * t + f.f))) * 0.5,
          f.z,
        );
        dummy.rotation.set(-1.1 + 0.25 * Math.cos(w * f.k * t + f.f), w * t + f.f, f.rock * sw, 'XYZ');
        dummy.scale.setScalar(f.size);
        dummy.updateMatrix();
        air.setMatrixAt(i, dummy.matrix);
        alpha.setX(i, THREE.MathUtils.smoothstep(u, 0, 0.18) * (1 - THREE.MathUtils.smoothstep(u, 0.82, 1)));
      }
      alpha.needsUpdate = true;
      air.instanceMatrix.needsUpdate = true;
      (sunGlow.material as THREE.SpriteMaterial).opacity = 0.24 * (1 + 0.05 * s(1, 0.4));
      for (const m of mist) m.s.position.x = m.x + m.amp * 0.35 * s(1, m.ph);
      for (const c of clouds) c.s.position.x = c.x + 0.6 * s(1, c.ph);
      for (const k of streaks) k.s.position.x = k.x + k.amp * s(1, k.ph);

      // The camera holds still; the leaves do the moving.
      camera.position.set(0, camY, camZ);
      if (PSX) {
        // The camera drifts in steps (every other frame at 20 fps), like a PS1 game's lower update rate;
        // snow and leaves still move every frame.
        const tc = Math.floor(t * 10 + 1e-6) / 10;
        camera.position.add(new THREE.Vector3(num('psxcam', 0.18) * Math.sin(w * tc), num('psxcam', 0.18) * 0.4 * Math.sin(2 * w * tc + 0.7), 0));
      }
      camera.lookAt(0, look, 0.3);
      camera.updateMatrixWorld();
      bts?.update();
      const view = bts ? bts.camera : camera;

      renderer.setPixelRatio(1);
      renderer.setSize(PSX ? PSXW : W * SS, PSX ? PSXH : H * SS, false);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
      grade.setSize(PSX ? PSXW : W * SS, PSX ? PSXH : H * SS);
      if (PSX) grade.setSamples(0);
      const u = grade.material.uniforms;
      // Grade: a touch more contrast so the lit hero leads, saturation eased back, cool teal in the
      // shadows against golden highlights (complementary, so the oranges sing without going muddy).
      u.uContrast.value = num('contrast', LOOK.c); u.uVignette.value = num('vig', LOOK.v); u.uExposure.value = num('exposure', LOOK.e); u.uSaturation.value = num('sat', LOOK.s);
      (u.uShadowTint.value as THREE.Color).setRGB(...LOOK.sh);
      (u.uHighlightTint.value as THREE.Color).setRGB(...LOOK.hi);
      (u.uLift.value as THREE.Color).setRGB(...LOOK.lift);
      // ?nograin=1 for GIF exports: per-frame grain is noise a 256-colour palette can't hold.
      u.uGrain.value = noGrain || PSX ? 0 : 0.04;
      u.uPsx.value = PSX ? 1 : 0;
      grade.tick(t);
      if (painter) {
        painter.setSize(W * SS, H * SS);
        // The brush breathes 'on fours': its pattern steps 25 times a loop (every 4th frame at 20 fps),
        // like hand-repainted frames, while snow and leaves move every frame. Static areas hold between
        // steps, which keeps the GIF small.
        painter.setPhase(Math.floor((t / SOCIAL_LOOP) * num('bsteps', 25) + 1e-6) / num('bsteps', 25));
        renderer.setRenderTarget(painter.input);
        grade.render(renderer, scene, view);
        renderer.setRenderTarget(null);
        painter.render(renderer);
        if (strokes) { strokes.setPhase(Math.floor((t / SOCIAL_LOOP) * num('bsteps', 25) + 1e-6) / num('bsteps', 25)); strokes.render(renderer); }
      } else grade.render(renderer, scene, view);
      octx.imageSmoothingEnabled = !PSX;
      octx.imageSmoothingQuality = 'high';
      if (PSX) octx.drawImage(renderer.domElement, 0, 0, PSXW, PSXH, 0, 0, PSXW, PSXH);
      else octx.drawImage(renderer.domElement, 0, 0, W * SS, H * SS, 0, 0, W, H);
      return out;
    },
  };
}
