import * as THREE from 'three';
import { CONFIG } from '../config';
import { cloneModel, model, material } from '../assets/loader';
import { makeHalo } from './glow';

/** Layer the ball lives on in addition to the default, so the size gauge can render it alone. */
const BALL_LAYER = 1;

const UP = new THREE.Vector3(0, 1, 0);

export interface Attached {
  obj: THREE.Object3D;
  dir: THREE.Vector3; // unit direction in roll-local space
  itemRadius: number;
  volume: number;
  points: number;
  kind: string;
  name: string;
  /** Ball radius when this was picked up; new growth gradually swallows it. */
  rAt: number;
  /** 0 = sitting on the surface, 1 = fully absorbed into the pumpkin. */
  sink: number;
  /** Hidden by the visible-mesh cap (independent of absorption). */
  capped: boolean;
}

/** The rolling jack-o-lantern. Visual hierarchy: root (position) -> roll (rotation) -> core + attached. */
export class Player {
  readonly root = new THREE.Group();
  readonly roll = new THREE.Group();
  readonly core: THREE.Group;
  readonly light: THREE.PointLight;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  radius: number = CONFIG.player.startRadius;
  volume = 0;
  attached: Attached[] = [];
  private coreScaleBase: number;
  private squash = 0; // 0..1 squash impulse
  /** 1..0 milestone power-up timer: the whole ball pulses and everything stuck to it melts in. */
  private power = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private shadow: THREE.Mesh;
  speedScale = 1;
  /** Ground height under the ball, set by the world each frame. */
  groundY = 0;
  /** Hop state: height above the ground and vertical speed. */
  air = 0;
  vy = 0;
  private baseY = CONFIG.player.startRadius;
  /** Set for one frame when the ball lands. */
  justLanded = false;

  constructor() {
    this.root.add(this.roll);
    this.core = cloneModel('pumpkin_orange_jackolantern');
    const info = model('pumpkin_orange_jackolantern');
    // Centre the model on its bounding box so it rolls around its middle.
    this.core.position.copy(info.center).multiplyScalar(-1);
    // Lit from inside: the shell gets a little emissive warmth, and an ember sphere sits in the
    // cavity so the carved face reads as a bright hole.
    // The carved face is painted as dark grey in the palette (the mesh is closed, so nothing
    // inside can show through). Patch the shader so those dark cavity texels emit a warm glow,
    // as if lit by a candle inside; the orange skin and the brown stem are untouched.
    const lit = material().clone();
    const glow = { value: 1.3 };
    lit.onBeforeCompile = (shader) => {
      shader.uniforms.uFaceGlow = glow;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFaceGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            float cavity = 1.0 - smoothstep(0.045, 0.065, lum);
            totalEmissiveRadiance += cavity * uFaceGlow * vec3(1.0, 0.58, 0.2);
          }`,
        );
    };
    lit.customProgramCacheKey = () => 'jack-face-glow';
    this.faceGlow = glow;
    this.core.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = lit;
        m.castShadow = true;
      }
    });
    const wrap = new THREE.Group();
    wrap.add(this.core);
    this.roll.add(wrap);
    wrap.traverse((o) => o.layers.enable(BALL_LAYER));
    // The pumpkin is wider than tall; use the horizontal radius so it sits on the ground.
    this.coreScaleBase = 1 / (Math.max(info.size.x, info.size.z) / 2);
    this.coreWrap = wrap;

    this.light = new THREE.PointLight(0xffa040, 6, 8, 1.6);
    this.light.position.set(0, 0.1, 0);
    this.light.layers.enable(BALL_LAYER);
    this.root.add(this.light);
    // Golden shield aura, shown while charged.
    this.halo = makeHalo(0xffd36b, 1);
    this.halo.visible = false;
    this.halo.layers.enable(BALL_LAYER);
    this.root.add(this.halo);

    const shadowGeo = new THREE.CircleGeometry(1, 24);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000015, transparent: true, opacity: 0.45, depthWrite: false });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);

    this.setRadius(this.radius);
  }
  private coreWrap: THREE.Group;
  private faceGlow: { value: number };
  private halo: THREE.Sprite;
  /** 0 when not shielded, else fraction of shield time left. */
  private charged = 0;

  setCharged(frac: number): void {
    this.charged = frac;
  }

  /** Hide the soft blob shadow when a real shadow map is drawing the ball's shadow. */
  setBlobShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  reset(): void {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.groundY = 0;
    this.air = 0;
    this.vy = 0;
    this.baseY = CONFIG.player.startRadius;
    this.volume = 0;
    for (const a of this.attached) this.roll.remove(a.obj);
    this.attached = [];
    this.roll.quaternion.identity();
    this.setRadius(CONFIG.player.startRadius);
    this.speedScale = 1;
    this.power = 0;
    this.roll.scale.setScalar(1);
  }

  setRadius(r: number): void {
    this.radius = r;
    this.coreWrap.scale.setScalar(r * this.coreScaleBase);
    this.baseY = r + this.groundY;
    this.pos.y = this.baseY + this.air;
    this.shadow.scale.setScalar(r * 1.05);
    this.halo.scale.setScalar(r * 3.6);
    this.shadow.position.y = -r + 0.02;
    this.light.distance = 6 + r * 4;
    this.light.intensity = 4 + r * 3;
    for (const a of this.attached) this.placeAttached(a, 0);
  }

  /**
   * Items sit on the surface when eaten and are continuously subsumed: they sink in a little
   * every second (small things faster than big ones), and new growth covering them speeds it up.
   */
  private placeAttached(a: Attached, dt: number): void {
    const r = this.radius;
    if (a.sink < 1) {
      // Steady absorption: roughly 7 s for something tiny on a big ball, 18 s for a big bite.
      const rel = Math.min(1, a.itemRadius / r);
      a.sink += dt / (7 + 11 * rel);
      // A milestone swallows everything on the surface in about a third of a second.
      if (this.power > 0) a.sink += dt * 3;
      // Growth since pickup buries it faster, like a new layer of skin forming over it.
      const grown = (r - a.rAt) / (a.itemRadius * 1.6);
      a.sink = Math.max(a.sink, Math.min(1, grown * 0.8));
      if (a.sink >= 1) a.sink = 1;
    }
    const t = a.sink * a.sink * (3 - 2 * a.sink);
    const offset = Math.max(0.05, r - a.itemRadius * 0.35 - t * a.itemRadius * 1.25);
    a.obj.position.copy(a.dir).multiplyScalar(offset);
    const sc = 1 - 0.25 * t;
    a.obj.scale.setScalar(sc);
    a.obj.visible = !a.capped && a.sink < 1;
  }

  /** Radius implied by the core volume plus everything eaten. */
  static radiusFor(volume: number): number {
    const r0 = CONFIG.player.startRadius;
    return Math.cbrt(r0 * r0 * r0 + volume);
  }

  /** A little hop. Only from the ground; bigger balls hop a bit higher. */
  jump(): boolean {
    if (this.air > 0 || this.vy > 0) return false;
    this.vy = CONFIG.player.jumpSpeed + this.radius * 0.9;
    this.air = 0.001;
    return true;
  }

  /** Height of the ball's underside above the ground. */
  get clearance(): number {
    return this.air;
  }

  maxSpeed(): number {
    return (CONFIG.player.maxSpeedBase + CONFIG.player.maxSpeedPerRadius * this.radius) * this.speedScale;
  }

  /** Attach a world-space object at the contact point and grow. */
  attach(obj: THREE.Object3D, worldPos: THREE.Vector3, itemRadius: number, volume: number, points: number, kind: string, name: string): void {
    // Direction from ball centre to the item in roll-local space.
    const dirWorld = this.tmp.copy(worldPos).sub(this.pos);
    if (dirWorld.lengthSq() < 1e-6) dirWorld.set(Math.random() - 0.5, 0.2, Math.random() - 0.5);
    dirWorld.normalize();
    const invQ = this.roll.quaternion.clone().invert();
    const dir = dirWorld.clone().applyQuaternion(invQ);
    obj.position.copy(dir).multiplyScalar(Math.max(0.05, this.radius - itemRadius * 0.35));
    // Keep the item's world orientation at the moment of pickup.
    obj.quaternion.copy(invQ).multiply(obj.quaternion);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      o.layers.enable(BALL_LAYER);
    });
    this.roll.add(obj);
    const a: Attached = { obj, dir, itemRadius, volume, points, kind, name, rAt: this.radius, sink: 0, capped: false };
    this.attached.push(a);
    if (this.attached.length > CONFIG.player.maxAttachedVisible) {
      // Hide the oldest so the mesh count stays bounded; it still counts.
      const old = this.attached[this.attached.length - 1 - CONFIG.player.maxAttachedVisible];
      old.capped = true;
      old.obj.visible = false;
    }
    this.volume += volume;
    this.setRadius(Player.radiusFor(this.volume));
    this.squash = 1;
  }

  /** Milestone celebration: pulse the whole ball and absorb everything stuck to it. */
  powerUp(): void {
    this.power = 1;
  }

  /** Remove a fraction of attached items (newest first) and return them for scattering. */
  shed(fraction: number): Attached[] {
    // Shed a handful of the oldest (smallest) things, so a hit stings without undoing the run.
    const n = Math.min(this.attached.length, Math.max(1, Math.min(10, Math.round(this.attached.length * fraction))));
    const out: Attached[] = [];
    for (let i = 0; i < n; i++) {
      const a = this.attached.shift()!;
      this.roll.remove(a.obj);
      a.obj.visible = true;
      a.obj.scale.setScalar(1);
      a.sink = 0;
      this.volume = Math.max(0, this.volume - a.volume);
      out.push(a);
    }
    // Re-show items that fall back inside the visible cap.
    const from = Math.max(0, this.attached.length - CONFIG.player.maxAttachedVisible);
    for (let i = from; i < this.attached.length; i++) this.attached[i].capped = false;
    this.setRadius(Player.radiusFor(this.volume));
    return out;
  }

  /** World position of an attached item (for scattering). */
  attachedWorldPos(a: Attached, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(a.dir).applyQuaternion(this.roll.quaternion).multiplyScalar(this.radius).add(this.pos);
  }

  update(dt: number, moveX: number, moveZ: number, fwd: THREE.Vector3, right: THREE.Vector3): void {
    const p = CONFIG.player;
    // Desired acceleration in world space from camera-relative input.
    const ax = fwd.x * moveZ + right.x * moveX;
    const az = fwd.z * moveZ + right.z * moveX;
    const inputMag = Math.min(1, Math.hypot(moveX, moveZ));
    const mass = 1 + 0.12 * (this.radius - CONFIG.player.startRadius);
    this.vel.x += (ax * p.accel * dt) / mass;
    this.vel.z += (az * p.accel * dt) / mass;
    // Friction: stronger when there is no input so the ball settles quickly; big balls coast longer.
    const fr = (p.friction * (inputMag > 0.05 ? 0.55 : 1)) / mass;
    const damp = Math.exp(-fr * dt);
    this.vel.x *= damp;
    this.vel.z *= damp;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const max = this.maxSpeed() * (inputMag > 0.05 ? Math.max(0.35, inputMag) : 1);
    if (speed > max) {
      this.vel.x *= max / speed;
      this.vel.z *= max / speed;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // Hop: simple ballistic height above the ground.
    this.justLanded = false;
    if (this.air > 0 || this.vy > 0) {
      this.vy -= CONFIG.player.gravity * dt;
      this.air += this.vy * dt;
      if (this.air <= 0) {
        this.air = 0;
        this.vy = 0;
        this.justLanded = true;
        this.squash = 1;
      }
    }
    // Ease onto terraces instead of snapping; add the hop on top.
    const targetY = this.radius + this.groundY;
    this.baseY += (targetY - this.baseY) * Math.min(1, dt * 10);
    this.pos.y = this.baseY + this.air;

    // Rolling: rotate about the axis perpendicular to velocity by distance / radius.
    const dist = speed * dt;
    if (dist > 1e-5) {
      this.tmp.set(this.vel.x, 0, this.vel.z).normalize();
      this.axis.crossVectors(UP, this.tmp).normalize();
      this.q.setFromAxisAngle(this.axis, dist / this.radius);
      this.roll.quaternion.premultiply(this.q);
    }

    // Squash and stretch on pickups.
    for (const a of this.attached) this.placeAttached(a, dt);
    if (this.squash > 0) {
      this.squash = Math.max(0, this.squash - dt * 5);
      const s = Math.sin(this.squash * Math.PI) * 0.12;
      this.root.scale.set(1 + s, 1 - s, 1 + s);
    } else {
      this.root.scale.set(1, 1, 1);
    }
    if (this.power > 0) {
      // Three quick swells that shrink as they go, like a growth mushroom taking hold.
      this.power = Math.max(0, this.power - dt / 0.75);
      const k = 1 - this.power;
      const s = 1 + 0.16 * Math.abs(Math.sin(k * Math.PI * 3)) * this.power;
      this.roll.scale.setScalar(s);
    } else if (this.roll.scale.x !== 1) {
      this.roll.scale.setScalar(1);
    }
    this.root.position.copy(this.pos);
    // Flicker the inner light a little.
    this.light.intensity = (4 + this.radius * 3) * (0.9 + 0.1 * Math.sin(performance.now() * 0.02));
    // The face flickers with the same candle, a touch slower so it reads as breathing.
    this.faceGlow.value = 1.3 + 0.18 * Math.sin(performance.now() * 0.011) + 0.08 * Math.sin(performance.now() * 0.037) + 2.2 * this.power;
    this.light.intensity *= 1 + 1.5 * this.power;
    if (this.charged > 0) {
      // Shielded: a warm gold aura and a brighter face; it blinks in the last fifth, like a star running out.
      const ending = this.charged < 0.2 && Math.floor(performance.now() / 110) % 2 === 0;
      this.halo.visible = !ending;
      (this.halo.material as THREE.SpriteMaterial).opacity = 0.42 + 0.14 * Math.sin(performance.now() * 0.012);
      this.faceGlow.value += 1.0;
      this.light.intensity *= 1.6;
    } else if (this.halo.visible) {
      this.halo.visible = false;
    }
  }
}
