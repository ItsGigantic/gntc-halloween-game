import * as THREE from 'three';

export interface StrokeOptions {
  /** Output size in pixels (the render target the strokes are drawn over). */
  width: number;
  height: number;
  /** Brush layers, coarse to fine: stroke length and spacing in pixels. */
  layers?: { size: number; spacing: number }[];
  /** Overall stroke opacity. */
  opacity?: number;
  seed?: number;
}

/**
 * Stroke-based painting: thousands of brush strokes laid over the frame in layers, coarse to fine,
 * each taking its colour from the render beneath it and oriented along the local form (from a
 * structure tensor of the image). Fine strokes only appear where there is detail, so flat sky and
 * ground stay broad and loose while edges and the hero stay readable.
 *
 * Strokes are placed once, in screen space. The camera never moves, so they stay put from frame to
 * frame and only their colour updates; that keeps the paint from shimmering, and a small cyclic sway
 * (setPhase) makes it breathe.
 */
export class Strokes {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(src: THREE.Texture, opts: StrokeOptions) {
    const W = opts.width, H = opts.height;
    const layers = opts.layers ?? [
      { size: 70, spacing: 30 },
      { size: 36, spacing: 14 },
      { size: 16, spacing: 6 },
    ];
    let s = opts.seed ?? 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const data: number[] = [];
    const layerOf: number[] = [];
    layers.forEach((L, li) => {
      const pts: number[][] = [];
      for (let y = -L.spacing; y < H + L.spacing; y += L.spacing) {
        for (let x = -L.spacing; x < W + L.spacing; x += L.spacing) {
          pts.push([(x + (rnd() - 0.5) * L.spacing) / W, (y + (rnd() - 0.5) * L.spacing) / H, L.size * (0.8 + rnd() * 0.4), rnd()]);
        }
      }
      // Shuffle so overlaps within a layer look hand-laid, not row by row.
      for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
      for (const p of pts) { data.push(...p); layerOf.push(li / Math.max(1, layers.length - 1)); }
    });
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('aStroke', new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(new Float32Array(layerOf), 1));
    geo.instanceCount = layerOf.length;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: src },
        uRes: { value: new THREE.Vector2(W, H) },
        uPhase: { value: 0 },
        uBreathe: { value: 1 },
        uOpacity: { value: opts.opacity ?? 0.9 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aStroke; // centre (uv), length (px), seed
        attribute float aLayer; // 0 = coarsest, 1 = finest
        uniform sampler2D tSrc;
        uniform vec2 uRes;
        uniform float uPhase, uBreathe;
        varying vec2 vQ;
        varying vec3 vCol;
        varying float vSeed, vAlpha;
        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        void main() {
          vec2 c = aStroke.xy;
          float sz = aStroke.z, seed = aStroke.w;
          float lod = log2(max(sz * 0.3, 1.0));
          vec3 col = textureLod(tSrc, c, lod).rgb;

          // Local stroke direction: the structure tensor at this stroke's scale.
          vec2 te = vec2(sz * 0.5) / uRes;
          float lt = lod + 0.5;
          float lx = luma(textureLod(tSrc, c + vec2(te.x, 0.0), lt).rgb) - luma(textureLod(tSrc, c - vec2(te.x, 0.0), lt).rgb);
          float ly = luma(textureLod(tSrc, c + vec2(0.0, te.y), lt).rgb) - luma(textureLod(tSrc, c - vec2(0.0, te.y), lt).rgb);
          float g = length(vec2(lx, ly));
          float strength = smoothstep(0.01, 0.06, g);
          // Strokes run along edges (perpendicular to the gradient); flat areas get a loose diagonal.
          float edgeAng = atan(lx, -ly);
          float freeAng = 0.55 + (seed - 0.5) * 0.9;
          float ang = mix(freeAng, edgeAng, strength);
          ang = floor(ang / (3.14159265 / 16.0) + 0.5) * (3.14159265 / 16.0); // steady from frame to frame
          ang += 0.12 * uBreathe * sin(uPhase + seed * 6.2831853);

          // Fine strokes only where there is detail worth describing.
          vec3 coarse = textureLod(tSrc, c, lod + 2.0).rgb;
          float detail = length(col - coarse) + g * 0.6;
          // Big strokes stay in the broad areas (they'd smear across edges); fine strokes carry the edges.
          vAlpha = aLayer < 0.01 ? 1.0 - 0.85 * smoothstep(0.03, 0.09, detail) : smoothstep(0.02 + 0.03 * aLayer, 0.06 + 0.05 * aLayer, detail);
          vSeed = seed;
          // Each stroke a touch lighter or darker than its neighbours, the way mixed paint varies.
          vCol = col * (1.0 + (fract(seed * 17.13) - 0.5) * 0.09);
          vQ = position.xy + 0.5;
          if (vAlpha < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec2 ext = vec2(sz, sz * (0.38 + 0.12 * fract(seed * 7.7)));
          vec2 q = position.xy * ext;
          vec2 off = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
          vec2 sway = 0.6 * uBreathe * vec2(cos(uPhase + seed * 9.0), sin(uPhase + seed * 5.0));
          vec2 p = c * uRes + off + sway;
          gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vQ;
        varying vec3 vCol;
        varying float vSeed, vAlpha;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          float along = vQ.x, across = vQ.y;
          // Bristles: fine streaks running the length of the stroke.
          float bristle = vnoise(vec2(across * 22.0, vSeed * 40.0));
          // Body: soft sides with a slightly ragged edge; ends tapered and broken, dry at the tail.
          float side = 1.0 - abs(across * 2.0 - 1.0);
          float rag = 0.12 * vnoise(vec2(along * 7.0, vSeed * 13.0));
          float body = smoothstep(0.0, 0.22 + rag, side);
          float head = smoothstep(0.0, 0.14 + 0.1 * vnoise(vec2(across * 6.0, vSeed * 3.0)), along);
          float tail = smoothstep(0.0, 0.22, 1.0 - along);
          float dry = mix(1.0, smoothstep(0.3, 0.6, bristle), smoothstep(0.55, 1.0, along) * 0.7);
          float a = body * head * tail * dry * (0.8 + 0.2 * bristle) * vAlpha * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol * (0.95 + 0.1 * bristle), a);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Where we are in the loop, 0..1, for the breathing sway. */
  setPhase(u: number): void {
    this.material.uniforms.uPhase.value = u * Math.PI * 2;
  }

  /** Draw the strokes over whatever the renderer currently targets, without clearing it. */
  render(renderer: THREE.WebGLRenderer): void {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = auto;
  }
}
