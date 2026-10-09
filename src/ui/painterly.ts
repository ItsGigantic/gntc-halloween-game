import * as THREE from 'three';

export interface PainterlyOptions {
  /** Brush radius in pixels of the render target (the social scenes render at 2x). */
  radius?: number;
  /** Strength of the soft ink outline, 0..1. */
  edge?: number;
  /** Strength of the paper grain, 0..1. Static, so it costs a GIF palette nothing. */
  paper?: number;
  /** Strength of the bristle marks along each stroke. */
  stroke?: number;
  /** Bloom strength for bright areas (lamps, sun). */
  bloom?: number;
  /** Five-stop gradient map (dark to light) and how much of it to blend in. */
  ramp?: string[];
  rampMix?: number;
  /** Darkening along the bottom edge, 0..1. */
  bottom?: number;
  /** How far the brush pattern wanders over the loop (noise-space units); 0 holds it still. */
  breathe?: number;
  /** Brush-dab warp in pixels: how ragged painted edges get. */
  warp?: number;
  /** Sector hardness: lower blends strokes more softly. */
  hardness?: number;
  /** Mip level the ink reads from: higher ignores more fine detail. */
  inkLod?: number;
  /** Ink colour for the outlines. */
  ink?: THREE.ColorRepresentation;
}

/**
 * A painterly finish for the social scenes, applied after the colour grade:
 * 1. the local stroke direction is read from the image (a structure tensor on a softened copy), so
 *    strokes follow each form's edges, the way a painter works around a shape;
 * 2. silhouettes ripple in stroke-sized dabs along that direction, rather than fraying per pixel;
 * 3. an anisotropic Kuwahara filter blends colour within an ellipse stretched along the stroke, so
 *    facets and texture noise become brushed colour regions;
 * 4. an optional ink line (off by default), soft bloom, a light shared gradient map, and a gentle
 *    darkening along the bottom edge;
 * 5. bristle marks along each stroke, plus a static paper grain.
 * The dab and bristle fields can drift over the loop (setPhase), so the paint breathes.
 * Usage: render into `input` (e.g. let the grade draw there), then call render() to draw to the canvas.
 */
export class Painterly {
  readonly input: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(opts: PainterlyOptions = {}) {
    // Mipmapped, so the ink pass can read a softened copy and ignore pixel-scale detail.
    this.input = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: this.input.texture },
        uRes: { value: new THREE.Vector2(2, 2) },
        uRadius: { value: opts.radius ?? 5 },
        uEdge: { value: opts.edge ?? 0 },
        uPaper: { value: opts.paper ?? 0.06 },
        uInk: { value: new THREE.Color(opts.ink ?? 0x2a1a24) },
        uInkLod: { value: opts.inkLod ?? 1.5 },
        uWarp: { value: opts.warp ?? 3.5 },
        uPhase: { value: 0 },
        uBreathe: { value: opts.breathe ?? 2.5 },
        uBloom: { value: opts.bloom ?? 0.35 },
        uRamp: { value: (opts.ramp ?? ['#2a2440', '#5a4a6a', '#a08a90', '#e8d2c0', '#fff2dc']).map((c) => new THREE.Color(c)) },
        uRampMix: { value: opts.rampMix ?? 0.12 },
        uBottom: { value: opts.bottom ?? 0.18 },
        uHard: { value: opts.hardness ?? 3.0 },
        uStroke: { value: opts.stroke ?? 0.12 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tSrc;
        uniform vec2 uRes;
        uniform float uRadius, uEdge, uPaper, uInkLod, uWarp, uHard, uBloom, uRampMix, uBottom, uPhase, uBreathe, uStroke;
        uniform vec3 uRamp[5];
        uniform vec3 uInk;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        #define MAXR 9
        void main() {
          vec2 px = 1.0 / uRes;
          float r = uRadius;
          vec2 sp = vUv * uRes;
          vec2 breath = uBreathe * vec2(cos(uPhase), sin(uPhase));

          // 1. Which way do the strokes run here? A structure tensor from a softened (mip) copy gives
          //    the local edge direction; strokes run along it (the tangent), the way a painter follows a
          //    form. Flat areas, which have no edge direction, fall back to a gentle diagonal.
          vec2 te = px * 6.0;
          float E = 0.0, F = 0.0, G = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 c0 = vUv + vec2(float(i), float(j)) * te * 1.5;
            float lx = luma(textureLod(tSrc, c0 + vec2(te.x, 0.0), 3.0).rgb) - luma(textureLod(tSrc, c0 - vec2(te.x, 0.0), 3.0).rgb);
            float ly = luma(textureLod(tSrc, c0 + vec2(0.0, te.y), 3.0).rgb) - luma(textureLod(tSrc, c0 - vec2(0.0, te.y), 3.0).rgb);
            E += lx * lx; F += lx * ly; G += ly * ly;
          }
          float disc = sqrt((E - G) * (E - G) + 4.0 * F * F);
          float l1 = 0.5 * (E + G + disc), l2 = 0.5 * (E + G - disc);
          vec2 tdir = vec2(l1 - E, -F);
          tdir = length(tdir) > 1e-6 ? normalize(tdir) : vec2(0.0, 1.0);
          float A = (l1 + l2) > 1e-6 ? (l1 - l2) / (l1 + l2) : 0.0;
          A *= smoothstep(0.0, 0.002, l1); // only trust it where there's a real edge
          tdir = normalize(mix(normalize(vec2(0.8, 0.6)), tdir, A));
          // Snap the direction and stretch to fixed steps. Moving snow, leaves and flicker nudge the
          // tensor slightly everywhere; unsnapped, every stroke would shimmer from frame to frame (and
          // the GIF would balloon). Snapped, strokes only move when the breathing says so.
          float ang = atan(tdir.y, tdir.x);
          ang = floor(ang / (3.14159265 / 24.0) + 0.5) * (3.14159265 / 24.0);
          tdir = vec2(cos(ang), sin(ang));
          A = floor(A * 6.0 + 0.5) / 6.0;
          vec2 ndir = vec2(-tdir.y, tdir.x);

          // 2. Dabbed edges: nudge the sample point across the stroke by a noise that varies slowly
          //    along it, so silhouettes ripple in stroke-sized lobes instead of fraying pixel by pixel.
          float along = dot(sp, tdir), across = dot(sp, ndir);
          float dab = vnoise(vec2(along * 0.03, across * 0.01) + breath * 0.25) - 0.5;
          dab += 0.25 * (vnoise(vec2(along * 0.08, across * 0.03) + 13.7 + breath * 0.4) - 0.5);
          vec2 uv0 = vUv + ndir * dab * 2.0 * uWarp * px;

          // 3. Anisotropic Kuwahara: the brush footprint is an ellipse stretched along the stroke.
          float aniso = 1.0 + 1.6 * A;
          vec2 axT = tdir * r * aniso, axN = ndir * r / aniso;
          // Generalised Kuwahara sector weights (Kyprianidis et al.), on the unit disc.
          float zeta = 2.0 / float(MAXR);
          float zc = 1.75;
          float sinz = sin(zc);
          float eta = (zeta + cos(zc)) / (sinz * sinz);
          vec4 m[8];
          vec3 s[8];
          for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
          for (int y = -MAXR; y <= MAXR; y++) {
            for (int x = -MAXR; x <= MAXR; x++) {
              vec2 v = vec2(float(x), float(y)) / float(MAXR);
              if (dot(v, v) > 1.0) continue;
              vec3 c = texture2D(tSrc, uv0 + (axT * v.x + axN * v.y) * px).rgb;
              float w[8];
              float sum = 0.0, z, vxx, vyy;
              vxx = zeta - eta * v.x * v.x;
              vyy = zeta - eta * v.y * v.y;
              z = max(0.0, v.y + vxx); w[0] = z * z; sum += w[0];
              z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
              z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
              z = max(0.0, v.x + vyy); w[6] = z * z; sum += w[6];
              vec2 d = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
              vxx = zeta - eta * d.x * d.x;
              vyy = zeta - eta * d.y * d.y;
              z = max(0.0, d.y + vxx); w[1] = z * z; sum += w[1];
              z = max(0.0, -d.x + vyy); w[3] = z * z; sum += w[3];
              z = max(0.0, -d.y + vxx); w[5] = z * z; sum += w[5];
              z = max(0.0, d.x + vyy); w[7] = z * z; sum += w[7];
              float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-5);
              for (int k = 0; k < 8; k++) {
                float wk = w[k] * g;
                m[k] += vec4(c * wk, wk);
                s[k] += c * c * wk;
              }
            }
          }
          vec4 outc = vec4(0.0);
          for (int k = 0; k < 8; k++) {
            vec3 mean = m[k].rgb / max(m[k].w, 1e-5);
            vec3 var = abs(s[k] / max(m[k].w, 1e-5) - mean * mean);
            float sigma2 = var.r + var.g + var.b;
            // Lower hardness blends the sectors, for soft wet-into-wet transitions instead of hard cells.
            float wk = 1.0 / (1.0 + pow(8.0 * 1000.0 * sigma2, uHard * 0.5));
            outc += vec4(mean * wk, wk);
          }
          vec3 col = outc.rgb / max(outc.w, 1e-5);

          // Soft ink: a Sobel on a softened (mip) copy of the source, so it follows shapes and skips
          // pixel-scale detail like leaf texture and specks.
          vec2 e = px * 2.0 * exp2(uInkLod);
          #define LS(o) luma(textureLod(tSrc, vUv + (o), uInkLod).rgb)
          float tl = LS(vec2(-e.x, e.y)), t = LS(vec2(0.0, e.y)), tr = LS(vec2(e.x, e.y));
          float l = LS(vec2(-e.x, 0.0)), rr = LS(vec2(e.x, 0.0));
          float bl = LS(vec2(-e.x, -e.y)), b = LS(vec2(0.0, -e.y)), br = LS(vec2(e.x, -e.y));
          float gx = (tr + 2.0 * rr + br) - (tl + 2.0 * l + bl);
          float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
          float edge = smoothstep(0.12, 0.45, length(vec2(gx, gy)));
          if (uEdge > 0.0) col = mix(col, col * uInk * 2.2, edge * uEdge);

          // Bloom: lights and bright sky bleed softly into their surroundings, read from blurred mips.
          vec3 b1 = textureLod(tSrc, vUv, 3.0).rgb, b2 = textureLod(tSrc, vUv, 5.0).rgb;
          vec3 glow = max(b1 - 0.72, 0.0) * 0.6 + max(b2 - 0.66, 0.0) * 0.8;
          col += glow * uBloom;

          // Series unifier: a light gradient map on luminance, shared anchors in both posts.
          float L = clamp(luma(col), 0.0, 1.0);
          float fi = L * 4.0;
          vec3 ramp = mix(uRamp[0], uRamp[1], clamp(fi, 0.0, 1.0));
          ramp = mix(ramp, uRamp[2], clamp(fi - 1.0, 0.0, 1.0));
          ramp = mix(ramp, uRamp[3], clamp(fi - 2.0, 0.0, 1.0));
          ramp = mix(ramp, uRamp[4], clamp(fi - 3.0, 0.0, 1.0));
          col = mix(col, ramp, uRampMix);

          // A gentle darkening along the bottom edge frames the foreground and keeps the eye up.
          col *= 1.0 - uBottom * smoothstep(0.2, 0.0, vUv.y);

          // Paper: a fixed fibrous grain (fbm stretched along x) plus a faint canvas tooth.
          vec2 p = vUv * uRes;
          float fib = vnoise(p * vec2(0.035, 0.11)) * 0.5 + vnoise(p * vec2(0.09, 0.25)) * 0.3 + vnoise(p * 0.6) * 0.2;
          float tooth = 0.5 + 0.5 * sin(p.x * 0.9) * sin(p.y * 0.9);
          float grain = (fib - 0.5) + (tooth - 0.5) * 0.35;
          col *= 1.0 + grain * uPaper * 2.0;
          // Bristle marks: fine striations running along each stroke, broken into stroke lengths, so
          // surfaces carry visible paint texture that follows the form.
          float bristle = vnoise(vec2(along * 0.025, across * 0.45) + breath * 0.3) - 0.5;
          float strokeLen = smoothstep(0.25, 0.75, vnoise(vec2(along * 0.02, across * 0.06) + 5.3 + breath * 0.2));
          col *= 1.0 + bristle * uStroke * (0.4 + 0.6 * strokeLen);

          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Where we are in the loop, 0..1, for the breathing brush. */
  setPhase(u: number): void {
    this.material.uniforms.uPhase.value = u * Math.PI * 2;
  }

  setSize(w: number, h: number): void {
    this.input.setSize(w, h);
    (this.material.uniforms.uRes.value as THREE.Vector2).set(w, h);
  }

  /** Draw the stylised frame to whatever the renderer currently targets (usually the canvas). */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.cam);
  }
}
