import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PostGrade } from '../game/grade';
import { Painterly } from '../ui/painterly';
import { Strokes } from '../ui/strokes';
import { setupBts } from '../ui/bts';
import { applyPsx } from '../ui/psx';
import { glowTexture } from '../game/glow';

export const W = 1080;
export const H = 1350;
/** Loop length in seconds. Every motion completes a whole number of cycles in this time. */
export const LOOP = 5;

const KITS: Record<string, string> = {
  h: '/assets-src/holiday-bits/gltf/',
  f: '/assets-src/forest-nature/gltf/',
};

export interface HolidayScene { frame(t: number): HTMLCanvasElement }

type Model = { scene: THREE.Group; box: THREE.Box3 };

/** Names are 'kit:file', e.g. 'h:snowman_B' or 'f:Tree_2_E_Color1'. */
async function loadAll(names: string[]): Promise<Map<string, Model>> {
  const loader = new GLTFLoader();
  const out = new Map<string, Model>();
  await Promise.all([...new Set(names)].map(async (n) => {
    const [kit, file] = n.split(':');
    const g = await loader.loadAsync(`${KITS[kit]}${file}.gltf`);
    g.scene.updateMatrixWorld(true);
    out.set(n, { scene: g.scene, box: new THREE.Box3().setFromObject(g.scene) });
  }));
  return out;
}

const COLOURS = ['red', 'green', 'white', 'yellow', 'blue'] as const;
/**
 * Real-world sizing. One world unit is 0.75 m, so the snowman (1.8 m) is 2.4 units tall and
 * everything else is sized against him: gift boxes 20–45 cm, ground lanterns 45 cm, the lamp post
 * 2.7 m, a young Christmas tree 2 m. Heights below are in world units.
 */
const GIFT_H: Record<string, number> = { A: 0.36, B: 0.58, C: 0.24, D: 0.52, E: 0.24, F: 0.22 };

export async function buildHolidayScene(renderer: THREE.WebGLRenderer, grade: PostGrade): Promise<HolidayScene> {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.get(k) !== null && Number.isFinite(v) ? v : d; };
  // PS1 mode (?psx=1): a 267x334 framebuffer (shown 3x as crisp pixels), no anti-aliasing, 15-bit colour
  // with the console's dither, vertex snapping, affine textures, blob shadows only, and a gentle camera
  // drift so the vertex wobble shows. See psx.ts.
  const PSX = q.get('psx') === '1';
  const PSXW = num('psxw', 267), PSXH = Math.round(PSXW * 1.25);
  const TAU = Math.PI * 2;
  const w = TAU / LOOP;

  const gifts: string[] = [];
  for (const shape of Object.keys(GIFT_H)) for (const c of COLOURS) gifts.push(`h:present_${shape}_${c}`);
  const forestNames = ['Tree_4_A', 'Tree_4_B', 'Tree_4_C'].map((n) => `f:${n}_Color1`);
  const models = await loadAll([
    'h:snowman_B', 'h:snowman_A', 'h:gingerbread_house', 'h:lantern_mini', 'h:lantern_decorated', 'h:snowball', 'h:snowball_pile',
    'h:candycane_small', ...gifts, ...forestNames,
  ]);

  // Colour-grade looks, picked with ?look=: 'rich' is the chosen default; 'base' (the earlier grade), 'film' (softer contrast, matte
  // lifted blacks, teal shadows and amber highlights) or 'rich' (deeper contrast and colour). Every
  // look darkens the sky a little; ?skydark= overrides how much (1 = as painted).
  const LOOKS: Record<string, { c: number; s: number; e: number; v: number; sh: [number, number, number]; hi: [number, number, number]; lift: [number, number, number]; sky: number }> = {
    base: { c: 1.08, s: 1.04, e: 1.02, v: 0.28, sh: [0.0, 0.02, 0.08], hi: [0.08, 0.045, -0.015] as [number, number, number], lift: [0.008, 0.008, 0.022], sky: 0.8 },
    film: { c: 1.08 * 0.94, s: 1.04 * 0.88, e: 1.02 * 1.03, v: 0.28 + 0.05, sh: [-0.02, 0.05, 0.08], hi: [0.11, 0.06, -0.03], lift: [0.035, 0.03, 0.04], sky: 0.8 },
    rich: { c: 1.08 * 1.08, s: 1.04 * 1.1, e: 1.02 * 0.98, v: 0.28 + 0.12, sh: [0.0, 0.02, 0.1], hi: [0.08, 0.045, -0.015] as [number, number, number], lift: [0.0, 0.0, 0.012], sky: 0.64 },
  };
  const LOOK = LOOKS[q.get('look') ?? 'rich'] ?? LOOKS.rich;
  const SKY = num('skydark', LOOK.sky);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030524);
  scene.fog = new THREE.Fog(num('fogc', 0x16246a), num('fogn', 14), num('fogf', 80));
  const root = new THREE.Group();
  scene.add(root);

  /** Snow settles on anything facing up: blends the surface to snow by how much its normal points skyward. */
  const dust = (o: THREE.Object3D, amount: number, lo = 0.35, hi = 0.8) => o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    if (src.name === 'holiday_glow') return;
    const mat = src.clone();
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWP;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWP;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float n = 0.5 + 0.5 * sin(vWP.x * 7.1 + vWP.z * 5.3) * sin(vWP.z * 6.7 - vWP.y * 4.9);
          float up = smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, normalize(vWN).y + (n - 0.5) * 0.25);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 1.0), up * ${amount.toFixed(2)});`);
    };
    // The patch's source is the same for every setting, so key the program on the values too.
    mat.customProgramCacheKey = () => `dust-${amount}-${lo}-${hi}`;
    m.material = mat;
  });
  const tint = (o: THREE.Object3D, color: number) => o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) { m.material = (m.material as THREE.Material).clone(); (m.material as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(color)); }
  });
  /** Place a model with its base on the ground, scaled to a target height in world units. */
  const placed: { o: THREE.Object3D; r: number }[] = [];
  const put = (name: string, x: number, z: number, ry: number, height: number, y = 0) => {
    const m = models.get(name)!;
    const o = m.scene.clone(true);
    const k = height / (m.box.max.y - m.box.min.y);
    o.scale.setScalar(k);
    o.position.set(x, y - m.box.min.y * k, z);
    o.userData.baseY = -m.box.min.y * k; // so stacked or raised things (y > 0) are skipped
    o.rotation.y = ry;
    root.add(o);
    placed.push({ o, r: 0.5 * Math.max(m.box.max.x - m.box.min.x, m.box.max.z - m.box.min.z) * k });
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

  const footprint = (name: string, height: number) => {
    const b = models.get(name)!.box;
    const k = height / (b.max.y - b.min.y);
    return 0.5 * Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * k;
  };

  const CREST = num('crest', 6.5), VALLEY = num('valley', 8);
  // Lens shift: drops the whole scene down the frame so the copy (down to y=616) sits on clear sky.
  const SHIFT = num('sshift', 80);
  // --- Ground: a snowy clearing, flat where the cast stands, rising into soft drifts at the edges.
  {
    const geo = new THREE.PlaneGeometry(160, 120, 240, 180);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const shade = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i) - 10;
      // The clearing sits on a rise: past a soft snowbank crest the ground falls away into a valley,
      // so the forest beyond can be full-size pines with only their tops showing over the crest.
      const side = THREE.MathUtils.smoothstep(Math.abs(x), 3.5, 9) * THREE.MathUtils.smoothstep(-z, -1, 6);
      const drift = 0.35 * Math.sin(x * 0.45 + 1.3) + 0.25 * Math.sin(x * 0.9 + z * 0.35) + 0.15 * Math.sin(x * 1.9 - z * 0.7);
      const ripple = 0.03 * Math.sin(x * 2.1 + z * 1.6) + 0.025 * Math.sin(x * 3.3 - z * 2.4);
      const crest = (0.45 + 0.25 * drift) * Math.exp(-((z + CREST) ** 2) / 3);
      const drop = THREE.MathUtils.smoothstep(-z, CREST + 0.5, CREST + 6) * VALLEY;
      p.setXYZ(i, x, ripple + side * 0.5 + crest - drop, z);
      // The snow darkens a step toward the crest, so the snowman reads against it.
      const v = 1 - num('bankdark', 0.28) * THREE.MathUtils.smoothstep(-z, 1.5, CREST);
      shade[i * 3] = v; shade[i * 3 + 1] = v; shade[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    geo.computeVertexNormals();
    const snow = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: num('snowc', 0x9aa7d6), roughness: 0.92, metalness: 0, vertexColors: true }));
    snow.receiveShadow = true;
    root.add(snow);
  }

  // Sky: lavender blue hour, mid-toned and hopeful rather than black (and off the logo's pure blue), with a warm rosy glow along the horizon
  // (the lights of a village somewhere over the hill). No stars: it's snowing.
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(80, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color(num('skytop', 0x30347a)) }, uHorizon: { value: new THREE.Color(num('skyhor', 0x6c78be)) }, uGlow: { value: new THREE.Color(num('skyglow', 0xe6b0b4)) }, uSky: { value: SKY } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uTop, uHorizon, uGlow; uniform float uSky; varying vec3 vDir; void main(){ float h = vDir.y; float band = exp(-max(h,0.0)*3.6) * smoothstep(-0.1,0.02,h); vec3 c = mix(uTop, uHorizon, band*0.9); c = mix(c, uGlow, exp(-max(h,0.0)*16.0) * smoothstep(-0.1,0.02,h) * 0.55); gl_FragColor = vec4(c * uSky, 1.0); }',
    }),
  ));

  // --- The cast, arranged like the Halloween piece: a big hero front and centre, a little friend on
  // his left and a stack of gifts on his right, warm lights set back either side, a gingerbread cottage
  // half out of frame on the left, and a carpet of small things running off both edges.
  // Everything is sized in metres against the snowman, so the proportions stay true at any hero size.
  const SNOW_H = num('sh', 3.05);
  const M = SNOW_H / 1.8; // world units per metre
  const camZPos = num('sz', 10.8);
  const hero = put('h:snowman_B', 0, 0.3, num('sry', 0.3), SNOW_H);
  // A cranberry scarf instead of the stock orange, so it stops echoing the carrot. The scarf and the
  // nose share a colour in the atlas, so they're told apart by height on the model.
  hero.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uScarfY = { value: num('scarfy', 1.45) };
      sh.uniforms.uScarf = { value: new THREE.Color(num('scarfc', 0xb8323f)) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nuniform float uScarfY;\nuniform vec3 uScarf;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = diffuseColor.rgb;
            float orange = smoothstep(0.15, 0.3, c.r - c.b) * step(c.g, c.r);
            float l = dot(c, vec3(0.3, 0.59, 0.11));
            if (vOP.y < uScarfY) diffuseColor.rgb = mix(c, uScarf * (0.5 + l * 1.5), orange);
          }`);
    };
    mat.customProgramCacheKey = () => 'scarf';
    m.material = mat;
  });
  const occupied: [number, number, number][] = [[0, 0.3, 1.15]];
  const sprite = (color: number, opacity: number, x: number, y: number, z: number, sx: number, sy = sx) => {
    const m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.set(sx, sy, 1);
    root.add(s);
    return m;
  };
  const pool = (color: number, opacity: number, x: number, z: number, r: number) => {
    const m = new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 40), m);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.03, z);
    root.add(d);
    return m;
  };

  // The little friend: a child's snowman, about 70 cm.
  put('h:snowman_A', num('kidx', -1.4), 1.15, 0.75, num('kid', 0.85) * M);
  occupied.push([num('kidx', -1.4), 1.15, 0.72]);

  // The gift palette: cranberry, pine, cream and kraft, rather than the kit's toy-bright primaries.
  const GIFT_TONE: Record<string, number> = { red: 0xe0a0a8, green: 0xa8c8b4, white: 0xf6ecdc, yellow: 0xd8b088, blue: 0xffffff };
  const giftTone = (o: THREE.Object3D, colour: string) => tint(o, GIFT_TONE[colour] ?? 0xffffff);

  // Gift stack on the right: a big box with a smaller one on top, and one leaning beside.
  const G = (shape: string, c: string, x: number, z: number, ry: number, hM: number, y = 0) => {
    const o = put(`h:present_${shape}_${c}`, x, z, ry, hM * M, y);
    giftTone(o, c);
    dust(o, 0.35, 0.75, 0.95);
    return o;
  };
  G('D', 'red', 1.8, 0.75, -0.35, 0.44);
  G('A', 'yellow', 1.77, 0.73, 0.4, 0.26, 0.44 * M * 0.8);
  G('C', 'white', 2.45, 1.2, 0.9, 0.18);
  G('B', 'green', 1.15, 1.25, -0.2, 0.4);
  occupied.push([1.8, 0.75, 0.6], [2.45, 1.2, 0.4], [1.15, 1.25, 0.3]);

  // The gingerbread cottage, back left and half out of frame, its windows lit.
  // It sits back at the clearing's edge so its roof stays below the copy; the frame edge cuts it.
  const HOUSE = { x: num('hx', -4.6), z: num('hz', -5.6), h: num('hh', 2.5) * M };
  const house = put('h:gingerbread_house', HOUSE.x, HOUSE.z, num('hry', 0.8), HOUSE.h);
  dust(house, 0.6, 0.6, 0.9);
  occupied.push([HOUSE.x, HOUSE.z, 2.4]);
  const houseLight = new THREE.PointLight(0xffa850, 4, 6, 1.6);
  houseLight.position.set(HOUSE.x + 1.9, 0.9, HOUSE.z + 2.4);
  root.add(houseLight);
  const housePool = pool(0xffa040, 0.32, HOUSE.x + 1.2, HOUSE.z + 1.7, 2.8);

  // Ground lanterns in front of the cottage, where the candles were.
  const LANTERNS: [number, number, number][] = [[-2.75, -0.55, 0.45], [-3.1, -0.1, 0.38], [-2.4, -0.25, 0.32]];
  const lanternHalos: THREE.SpriteMaterial[] = [];
  const lanternLights: THREE.PointLight[] = [];
  const lanternPools: THREE.MeshBasicMaterial[] = [];
  void LANTERNS; // the little ground lanterns read as toys next to the snowmen; their light stays as the cottage's spill
  for (const [x, z] of [[-2.75, -0.3]] as const) {
    const l = new THREE.PointLight(0xffa850, 4.5, 5, 1.7);
    l.position.set(x, 0.6, z + 0.2);
    root.add(l);
    lanternLights.push(l);
    lanternPools.push(pool(0xffa040, 0.24, x, z + 0.1, 1.1));
  }

  // A garden lamp post back right, where the lantern was.
  const LAMP = { x: num('lx', 3.2), z: num('lz', -3.6), h: num('lh', 2.5) * M };
  const lamp = put('h:lantern_decorated', LAMP.x, LAMP.z, -0.4, LAMP.h);
  dust(lamp, 0.8, 0.6, 0.9);
  occupied.push([LAMP.x, LAMP.z, 0.4]);
  const lampHead = new THREE.Vector3(LAMP.x, LAMP.h * 0.835, LAMP.z);
  const lampHalo = sprite(0xffb050, 0.55, lampHead.x, lampHead.y, lampHead.z, 1.0);
  const lampLight = new THREE.PointLight(0xffb060, 11, 8, 1.4);
  lampLight.position.copy(lampHead);
  root.add(lampLight);
  const lampPool = pool(0xffa040, 0.22, LAMP.x - 0.2, LAMP.z + 0.4, 1.6);

  // A snowball pile front left, where the skull was, and a few loose snowballs.
  put('h:snowball_pile', -2.75, 1.4, 0.5, 0.32 * M);
  occupied.push([-2.75, 1.4, 0.45]);

  // Footprints in the snow from the cottage door to the snowman: someone came out to build him.
  {
    const fpMat = new THREE.MeshBasicMaterial({ color: num('fpc', 0x7480b8), transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const fpGeo = new THREE.CircleGeometry(0.075, 12);
    fpGeo.scale(1, 1.7, 1);
    const from = new THREE.Vector2(HOUSE.x + 1.6, HOUSE.z + 2.4), to = new THREE.Vector2(-0.9, 0.95);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      // a gentle curve, not a ruler line
      const p = new THREE.Vector2().lerpVectors(from, to, u).add(new THREE.Vector2(Math.sin(u * Math.PI) * 0.5, 0));
      const dir = new THREE.Vector2().subVectors(to, from).normalize();
      const side = (i % 2 ? 1 : -1) * 0.11;
      const fp = new THREE.Mesh(fpGeo, fpMat);
      fp.rotation.set(-Math.PI / 2, 0, Math.atan2(dir.x, dir.y));
      fp.position.set(p.x - dir.y * side, 0.04, p.y + dir.x * side);
      root.add(fp);
    }
  }
  // An amber rim from the lamp side, so the snowman separates from the pale snow behind him.
  const rimWarm = new THREE.PointLight(0xffa850, num('rimw', 6), 5, 1.6);
  rimWarm.position.set(1.7, 2.9, -1.0);
  root.add(rimWarm);
  // Warm key on the snowman's face from the lights around him.
  const key = new THREE.PointLight(0xffc080, 3, 7, 1.6);
  key.position.set(0.4, 2.0, 2.6);
  root.add(key);

  // Bigger gifts half out of frame at the edges, so the haul carries on past them.
  for (const [s, c, x, z, ry, hM] of [
    ['A', 'green', 2.35, 1.95, 0.6, 0.3], ['C', 'red', -1.05, 1.9, 0.3, 0.18], ['A', 'white', 0.95, 2.1, 1.2, 0.27],
    ['D', 'yellow', 3.05, 1.5, 0.2, 0.42], ['D', 'red', -3.15, 2.0, 0.9, 0.4],
  ] as const) {
    G(s, c, x, z, ry, hM);
    occupied.push([x, z, footprint(`h:present_${s}_red`, hM * M)]);
  }

  // The carpet: small gifts, candy canes and snowballs, dense across the foreground and off both sides.
  {
    let cs = num('seed', 101);
    const crnd = () => ((cs = (cs * 16807) % 2147483647) / 2147483647);
    type Kind = { name: string; hM: number; gift?: boolean; lie?: boolean; low?: boolean };
    const kinds: Kind[] = [];
    // Real gift sizes against a 1.8 m snowman: cubes 22–30 cm, flat boxes 14–18 cm high, the odd
    // tall or long one, candy canes 38 cm. Weighted so most are mid-sized cubes and flat boxes.
    // Red, green, gold and white: blue boxes disappear into the cool palette.
    for (const c of COLOURS.filter((k) => k !== 'blue')) {
      kinds.push({ name: `h:present_A_${c}`, hM: 0.26, gift: true }, { name: `h:present_A_${c}`, hM: 0.22, gift: true },
        { name: `h:present_C_${c}`, hM: 0.16, gift: true, low: true }, { name: `h:present_E_${c}`, hM: 0.15, gift: true, low: true },
        { name: `h:present_C_${c}`, hM: 0.15, gift: true, low: true },
        { name: `h:present_D_${c}`, hM: 0.3, gift: true });
    }
    kinds.push({ name: 'h:present_B_red', hM: 0.36, gift: true }, { name: 'h:present_B_white', hM: 0.36, gift: true },
      { name: 'h:present_F_green', hM: 0.13, gift: true, low: true }, { name: 'h:present_F_yellow', hM: 0.13, gift: true, low: true },
      { name: 'h:snowball', hM: 0.09, low: true },
      { name: 'h:candycane_small', hM: 0.3, lie: true, low: true }, { name: 'h:candycane_small', hM: 0.28, lie: true, low: true }, { name: 'h:candycane_small', hM: 0.3, lie: true, low: true });
    let placed = 0;
    const target = num('count', 85);
    for (let tries = 0; tries < 8000 && placed < target; tries++) {
      const z = 0.8 + crnd() * 2.4;
      const half = 0.291 * (camZPos - z) + 0.6; // past the frame edge, so the spill runs off both sides
      const x = (crnd() * 2 - 1) * half;
      const kd = kinds[Math.floor(crnd() * kinds.length)];
      // Height zoning: the lane in front of the snowman only takes low things, so he stays whole;
      // the taller cubes build up toward the frame edges.
      const lane = Math.abs(x) / (0.291 * (camZPos - z));
      if (!kd.low && lane < 0.42) continue;
      if (Math.abs(x) < 1.0 && z < 1.5) continue; // a little breathing room at his base
      const h = kd.hM * M * (0.9 + crnd() * 0.2);
      const r = kd.lie ? 0.3 : footprint(kd.name, h) * 0.92;
      if (occupied.some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < r + or + 0.02)) continue;
      occupied.push([x, z, r]);
      placed++;
      const o = put(kd.name, x, z, crnd() * TAU, h);
      if (kd.lie) { o.rotation.set(-Math.PI / 2, 0, crnd() * TAU); o.position.y = 0.05; }
      if (kd.gift) { giftTone(o, kd.name.split('_').pop()!); dust(o, 0.35, 0.75, 0.95); }
    }
  }

  // --- The forest: rows receding into the snow haze, shaped as a designed silhouette. Each tree's
  // height is solved from where its tip should land on screen: low behind the snowman so the sky
  // stays clear for copy, rising toward the frame edges so the trees cradle the scene.
  {
    let fs = 23;
    const frnd = () => ((fs = (fs * 16807) % 2147483647) / 2147483647);
    const pines = ['Tree_4_A', 'Tree_4_A', 'Tree_4_B', 'Tree_4_B', 'Tree_4_C'];
    const tilt = Math.atan2(num('slook', 3.0) - num('sy', 2.6), camZPos - 0.3);
    const halfFov = THREE.MathUtils.degToRad(num('sfov', 40) / 2);
    const tipAt = (px: number, d: number) => {
      const a = tilt + Math.atan(((H / 2 - px) / (H / 2)) * Math.tan(halfFov));
      return num('sy', 2.6) + d * Math.tan(a);
    };
    const lineY = num('line', 765), rise = num('rise', 70);
    const rows = [
      { z: -13, step: 1.5, off: 45, jit: 35 },
      { z: -18, step: 1.6, off: 15, jit: 40 },
      { z: -25, step: 1.6, off: -15, jit: 45 },
      { z: -34, step: 1.7, off: -40, jit: 50 },
    ];
    const pineTint = num('pinec', 0x2c5a4c);
    for (const r of rows) {
      const halfW = 0.291 * (camZPos - r.z) + 3;
      for (let x = -halfW; x <= halfW; x += r.step * (0.7 + frnd() * 0.6)) {
        const z = r.z + (frnd() - 0.5) * 1.6;
        const d = camZPos - z;
        const sx = Math.abs(x) / (0.291 * d);
        const px = lineY + r.off - rise * THREE.MathUtils.smoothstep(sx, 0.42, 1.05) + (frnd() - 0.5) * 2 * r.jit;
        // Full-size pines standing in the valley: their height runs from the valley floor to the tip.
        const h = tipAt(px - SHIFT, d) + VALLEY; // px is in the final, lens-shifted frame
        const n = pines[Math.floor(frnd() * pines.length)];
        const o = put(`f:${n}_Color1`, x, z, frnd() * TAU, h, -VALLEY - 0.3);
        const slim = num('slim', 0.8) * (0.9 + frnd() * 0.2); // real conifers are slender spires
        o.scale.x *= slim; o.scale.z *= slim;
        tint(o, pineTint);
        dust(o, num('pinedust', 0.95), num('dlo', 0.5), num('dhi', 0.6));
      }
    }
  }
  // A cold haze where the clearing meets the trees.
  const mist: { s: THREE.Sprite; x: number; ph: number }[] = [];
  for (const [x, y, z, sx, ph] of [[-8, 0.4, -14, 20, 0.4], [1, 0.7, -16, 24, 2.2], [9, 0.4, -14, 20, 4.1], [-6, 0.2, -21, 26, 1.3], [7, 0.2, -22, 26, 3.0], [0, 0.6, -29, 40, 4.4], [0, 2.4, -34, 50, 1.0]] as const) {
    const m = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6f8cff, transparent: true, opacity: 0.17, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.set(sx, sx * 0.14, 1);
    root.add(s);
    mist.push({ s, x, ph });
  }

  // --- Snowfall, the core motion. Each flake drifts down a short way over the loop, fading in and out
  // at the ends, so the fall can be slow (a small fraction of the frame per second) and still loop.
  const snowN = num('snow', 1600);
  let ss = 17;
  const srnd = () => ((ss = (ss * 16807) % 2147483647) / 2147483647);
  const sPos = new Float32Array(snowN * 3);
  const sA = new Float32Array(snowN * 4);
  const sB = new Float32Array(snowN * 4);
  const fallRate = num('fall', 0.075); // fraction of the frame height per second
  for (let i = 0; i < snowN; i++) {
    // Depth: a few big soft flakes close to the lens, most in the middle distance, a fine haze far off.
    const layer = srnd();
    const d = layer < 0.03 ? 1.6 + srnd() * 3 : layer < 0.55 ? 4.5 + srnd() * 10 : 14.5 + srnd() * 22;
    const z = camZPos - d;
    const half = 0.291 * d + 0.3;
    const bottom = Math.max(0.2, 2.6 - 0.34 * d);
    const top = 2.6 + 0.42 * d + 0.3;
    const travel = fallRate * 0.728 * d * LOOP * (0.8 + srnd() * 0.45);
    const y0 = bottom + srnd() * (top - bottom + travel * 0.6);
    sPos.set([(srnd() * 2 - 1) * half, y0, z], i * 3);
    // phase, travel, sway amplitude, size
    sA.set([srnd(), travel, (0.04 + srnd() * 0.1) * Math.min(1.5, d * 0.12 + 0.4), 0.7 + srnd() * 0.7], i * 4);
    // sway phase, sway rate (whole cycles per loop), wind drift per second
    sB.set([srnd() * TAU, 1 + Math.floor(srnd() * 2), (0.1 + srnd() * 0.15) * d * 0.06, srnd()], i * 4);
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  snowGeo.setAttribute('aA', new THREE.BufferAttribute(sA, 4));
  snowGeo.setAttribute('aB', new THREE.BufferAttribute(sB, 4));
  const lampPos = [lampHead.clone(), new THREE.Vector3(-2.75, 0.6, -0.3), new THREE.Vector3(HOUSE.x + 1.2, HOUSE.h * 0.35, HOUSE.z + 1.2), new THREE.Vector3(0, -10, 0)];
  const snowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uT: { value: 0 }, uLoop: { value: LOOP }, uScale: { value: (q.get('psx') === '1' ? num('psxw', 267) * 1.25 : H * 2) / 0.728 }, uSize: { value: num('flake', 0.03) },
      uLamps: { value: lampPos }, uWarm: { value: [1.0, 0.7, 0.6, 0.0] },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aA; // phase, travel, sway amplitude, size
      attribute vec4 aB; // sway phase, sway rate, wind drift
      uniform float uT, uLoop, uScale, uSize;
      uniform vec3 uLamps[4];
      uniform float uWarm[4];
      varying float vA;
      varying float vSoft;
      varying vec3 vCol;
      void main() {
        float u = fract(uT / uLoop + aA.x);
        float w = 6.2831853 / uLoop;
        vec3 p = position;
        p.y -= aA.y * u;
        p.x += aA.z * sin(w * aB.y * uT + aB.x) + aB.z * (u - 0.5) * uLoop;
        p.z += aA.z * 0.6 * cos(w * uT + aB.x * 1.3);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        // Up in the copy space the snow is smaller and fainter, so white type sits on a calm field.
        float upper = smoothstep(-0.1, 0.55, gl_Position.y / gl_Position.w);
        gl_PointSize = clamp(uSize * aA.w * uScale / d, 1.5, 70.0) * mix(1.0, 0.75, upper);
        float life = smoothstep(0.0, 0.2, u) * (1.0 - smoothstep(0.8, 1.0, u));
        float ground = smoothstep(0.0, 0.25, p.y);
        float far = 1.0 - smoothstep(10.0, 34.0, d) * 0.6;
        vSoft = smoothstep(4.5, 1.8, d); // close to the lens: out of focus
        vA = life * ground * far * mix(1.0, 0.45, vSoft) * mix(1.0, 0.6, upper);
        // In the copy band only a sparse few flakes fall, so they read as snow, not specks among the type.
        if (aB.w < 0.6 * smoothstep(0.15, 0.45, upper)) vA = 0.0;
        vec3 warm = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          vec3 dl = p - uLamps[i];
          warm += uWarm[i] * exp(-dot(dl, dl) / 1.6) * vec3(1.0, 0.68, 0.36);
        }
        vCol = vec3(0.86, 0.9, 1.0) + warm * 0.9;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying float vSoft;
      varying vec3 vCol;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * mix(4.0, 2.2, vSoft)) * (1.0 - smoothstep(0.9, 1.0, d)) * vA;
        gl_FragColor = vec4(vCol, a * 0.9);
      }`,
  });
  const snowPts = new THREE.Points(snowGeo, snowMat);
  snowPts.frustumCulled = false;
  snowPts.renderOrder = 10;
  // Snow and glints draw after the painterly pass so the brush filter can't smear them away.
  const overlay = new THREE.Scene();
  overlay.add(snowPts);

  // Glints on the snow near the lights.
  const glintN = 140;
  const gPos = new Float32Array(glintN * 3);
  const gPh: number[] = [];
  for (let i = 0; i < glintN; i++) {
    const z = -1.5 + srnd() * 4.5;
    const x = (srnd() * 2 - 1) * (0.291 * (camZPos - z));
    gPos.set([x, 0.04, z], i * 3);
    gPh.push(srnd() * TAU, 1 + Math.floor(srnd() * 3));
  }
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  const glintCol = new THREE.BufferAttribute(new Float32Array(glintN * 3), 3);
  glintGeo.setAttribute('color', glintCol);
  const glints = new THREE.Points(glintGeo, new THREE.PointsMaterial({ map: glowTexture(), vertexColors: true, size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glints.frustumCulled = false;
  overlay.add(glints);

  // Lights: cool moonlight from behind with soft shadows, warm light from the lamps and the tree.
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x2a3060, num('hemi', 0.75)));
  const moon = new THREE.DirectionalLight(0xc6d6ff, num('moon', 2.0));
  moon.position.set(-4, 13, -6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(4096, 4096);
  Object.assign(moon.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 45 });
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.03;
  moon.shadow.radius = 3;
  scene.add(moon);
  const front = new THREE.DirectionalLight(0xc8d4ff, num('front', 0.55));
  front.position.set(0.5, 3, 10);
  scene.add(front);
  const rim = new THREE.DirectionalLight(0x8aa4ff, 2.0);
  rim.position.set(5, 4, -7);
  scene.add(rim);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });

  // The moon is behind and to the left, so contact shadows lean gently toward the camera-right.
  addGroundShadows(placed, 0x1c2058, num('gshadow', 0.72), 0.06, new THREE.Vector2(0.25, 0.4), new Set());
  const camera = new THREE.PerspectiveCamera(num('sfov', 40), W / H, 0.1, 160);
  const camY = num('sy', 2.6), camZ = camZPos, look = num('slook', 3.0);
  camera.setViewOffset(W, H, 0, -SHIFT, W, H);
  const SS = PSX ? PSXW / W : 2;
  const noGrain = q.get('nograin') === '1';
  // Behind-the-scenes shots (?bts=aerial|side|top|over): the set seen from outside, with the post camera drawn in.
  const bts = q.get('bts') ? setupBts(scene, camera, W / H, q.get('bts')!, moon) : null;
  // Storybook finish (see painterly.ts). ?paint=0 shows the plain render; brush/ink/paper tune it.
  const painter = q.get('paint') !== '1' ? null : new Painterly({ radius: num('brush', 8), edge: num('ink', 0), paper: num('paper', 0.035), warp: num('warp', 3.5), hardness: num('hard', 3), breathe: num('breathe', 10), bloom: num('bloom', 0.35), rampMix: num('ramp', 0.12), bottom: num('bottom', 0.18), ramp: ['#2a2440', '#2e3c78', '#6a7cc0', '#d8d8f0', '#fff2dc'] });
  // Brush strokes laid over the paint (see strokes.ts); off by default; ?strokes=1 to turn on.
  const strokes = painter && q.get('strokes') === '1' ? new Strokes(painter.input.texture, { width: W * SS, height: H * SS, opacity: num('sop', 0.8) }) : null;
  const out = document.createElement('canvas');
  out.width = PSX ? PSXW : W; out.height = PSX ? PSXH : H;
  const octx = out.getContext('2d')!;

  if (PSX) {
    renderer.shadowMap.enabled = false; // the PS1 had no shadow maps; the blob shadows carry it
    if (scene.fog instanceof THREE.Fog) { scene.fog.near *= 0.7; scene.fog.far *= 0.75; } // short draw distance
    applyPsx(scene, PSXW, PSXH);
    applyPsx(overlay, PSXW, PSXH);
  }

  return {
    frame(tRaw: number): HTMLCanvasElement {
      const t = ((tRaw % LOOP) + LOOP) % LOOP;
      const s = (k: number, ph = 0) => Math.sin(w * k * t + ph);
      const flicker = (ph: number) => 0.5 * s(6, ph) + 0.3 * s(13, ph * 2.1) + 0.2 * s(23, ph * 3.7);

      housePool.opacity = 0.32 * (1 + 0.06 * flicker(2.6));
      const lf = flicker(0.7);
      lampHalo.opacity = 0.55 * (1 + 0.05 * lf);
      lampPool.opacity = 0.22 * (1 + 0.04 * lf);
      lanternHalos.forEach((m, i) => (m.opacity = 0.5 * (1 + 0.12 * flicker(1.3 + i * 2.2))));
      lanternPools.forEach((m, i) => (m.opacity = 0.24 * (1 + 0.1 * flicker(1.3 + i * 2.2))));
      const gc = glintCol.array as Float32Array;
      for (let i = 0; i < glintN; i++) {
        const v = Math.pow(Math.max(0, Math.sin(w * gPh[i * 2 + 1] * t + gPh[i * 2])), 12) * 0.8;
        gc[i * 3] = v * 0.9; gc[i * 3 + 1] = v * 0.95; gc[i * 3 + 2] = v;
      }
      glintCol.needsUpdate = true;
      for (const m of mist) m.s.position.x = m.x + 0.6 * s(1, m.ph);
      snowMat.uniforms.uT.value = t;

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
      renderer.shadowMap.needsUpdate = true;
      grade.setSize(PSX ? PSXW : W * SS, PSX ? PSXH : H * SS);
      if (PSX) grade.setSamples(0);
      const u = grade.material.uniforms;
      // Grade: cool blue-violet shadows, warm candlelit highlights; contrast up a touch so the snowman
      // pops off the snow, saturation eased so the sky reads as dusk rather than neon.
      u.uContrast.value = num('contrast', LOOK.c); u.uVignette.value = num('vig', LOOK.v); u.uExposure.value = num('exposure', LOOK.e); u.uSaturation.value = num('sat', LOOK.s);
      (u.uShadowTint.value as THREE.Color).setRGB(...LOOK.sh);
      (u.uHighlightTint.value as THREE.Color).setRGB(...LOOK.hi);
      (u.uLift.value as THREE.Color).setRGB(...LOOK.lift);
      u.uGrain.value = noGrain || PSX ? 0 : 0.04;
      u.uPsx.value = PSX ? 1 : 0;
      grade.tick(t);
      if (painter) {
        painter.setSize(W * SS, H * SS);
        // The brush breathes 'on fours': its pattern steps 25 times a loop (every 4th frame at 20 fps),
        // like hand-repainted frames, while snow and leaves move every frame. Static areas hold between
        // steps, which keeps the GIF small.
        painter.setPhase(Math.floor((t / LOOP) * num('bsteps', 25) + 1e-6) / num('bsteps', 25));
        renderer.setRenderTarget(painter.input);
        grade.render(renderer, scene, view);
        renderer.setRenderTarget(null);
        painter.render(renderer);
        if (strokes) { strokes.setPhase(Math.floor((t / LOOP) * num('bsteps', 25) + 1e-6) / num('bsteps', 25)); strokes.render(renderer); }
        renderer.autoClear = false;
        renderer.render(overlay, view);
        renderer.autoClear = true;
      } else {
        grade.render(renderer, scene, view);
        renderer.autoClear = false;
        renderer.render(overlay, view);
        renderer.autoClear = true;
      }
      octx.imageSmoothingEnabled = !PSX;
      octx.imageSmoothingQuality = 'high';
      if (PSX) octx.drawImage(renderer.domElement, 0, 0, PSXW, PSXH, 0, 0, PSXW, PSXH);
      else octx.drawImage(renderer.domElement, 0, 0, W * SS, H * SS, 0, 0, W, H);
      return out;
    },
  };
}
