import * as THREE from 'three';

/**
 * Single-pass colour grade. The scene renders into an MSAA target, then one fullscreen
 * quad applies a filmic curve, contrast, saturation, split toning and a vignette.
 * One extra draw call; the only real cost is one fragment per screen pixel.
 */
export class PostGrade {
  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: THREE.ShaderMaterial;

  constructor(width: number, height: number, samples = 2) {
    this.target = new THREE.WebGLRenderTarget(width, height, {
      samples, // 2x MSAA is plenty for flat-shaded low-poly; 0 on the low tier
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uExposure: { value: 0.88 },
        uContrast: { value: 1.16 },
        uSaturation: { value: 1.12 },
        uShadowTint: { value: new THREE.Color(0.03, 0.0, 0.14) },
        uHighlightTint: { value: new THREE.Color(0.09, 0.04, -0.02) },
        uLift: { value: new THREE.Color(0.008, 0.008, 0.022) },
        uVignette: { value: 0.42 },
        uGrain: { value: 0.045 },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(width, height) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uExposure, uContrast, uSaturation, uVignette;
        uniform float uGrain, uTime;
        uniform vec2 uRes;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        uniform vec3 uShadowTint, uHighlightTint, uLift;
        varying vec2 vUv;
        // ACES fitted curve (Narkowicz).
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
          c = aces(c);
          c = pow(c, vec3(1.0 / 2.2));                 // to display space
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(l), c, uSaturation);           // saturation
          c = (c - 0.5) * uContrast + 0.5;            // contrast about mid grey
          l = dot(c, vec3(0.299, 0.587, 0.114));
          c += uShadowTint * (1.0 - l) * (1.0 - l);   // violet into the shadows
          c += uHighlightTint * l * l;                // warmth into the highlights
          c = max(c, uLift);                          // lifted, blue-black floor
          float d = distance(vUv, vec2(0.5)) * 1.25;
          float v = smoothstep(1.0, 0.45, d);
          c *= mix(1.0, v, uVignette);
          // Fine film grain, strongest in the mids and shadows, re-rolled every frame.
          float g = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 100.0) - 0.5;
          l = dot(c, vec3(0.299, 0.587, 0.114));
          c += g * uGrain * (1.0 - l * 0.6);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  tick(seconds: number): void {
    this.material.uniforms.uTime.value = seconds;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
    (this.material.uniforms.uRes.value as THREE.Vector2).set(Math.max(1, width), Math.max(1, height));
  }

  /** Render `scene` through the grade onto whatever the renderer is currently targeting (the canvas). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.render(this.quadScene, this.quadCam);
  }
}
