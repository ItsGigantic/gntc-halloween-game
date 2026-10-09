import * as THREE from 'three';
import { CONFIG, IS_TOUCH } from '../config';
import { cloneModel, material, materialOf, model } from '../assets/loader';
import { ITEM_BY_NAME, ITEMS, collideRadiusOf, pickRadiusOf, restHeight, volumeOf, type ItemDef } from './items';
import { InstancedPool } from './pool';
import { SpatialHash } from './collision';
import { Rng } from './rng';
import { GlowPool, ShadowPool, badColor, makeHalo } from './glow';

export type EntityState = 'free' | 'spawning' | 'flying' | 'ghost' | 'gone';

export interface Entity {
  id: number;
  def: ItemDef;
  x: number;
  z: number;
  y: number;        // current height of the model origin
  restY: number;    // height when resting on the ground
  rotY: number;
  scale: number;
  pickRadius: number;
  collideRadius: number;
  volume: number;
  state: EntityState;
  pool: InstancedPool | null;
  index: number;
  obj: THREE.Object3D | null;
  vel: THREE.Vector3 | null;
  t: number;
  /** Ghost skulls drift toward the player. */
  speed: number;
  glow: number;
  glowPool: GlowPool | null;
  shadow: number;
  /** Floating halo sprite for hazards. */
  halo: THREE.Sprite | null;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function capacityFor(def: ItemDef): number {
  if (def.name === 'floor_dirt') return 400;
  if (def.name === 'floor_dirt_grave') return 24;
  if (def.name === 'fence' || def.name === 'fence_broken') return 60;
  if (def.name.startsWith('path_')) return 40;
  if (def.name.startsWith('pebble_')) return 40;
  if (def.name === 'candycorn') return 80;
  if (def.kind === 'candy') return 48;
  if (def.kind === 'skull') return 32;
  if (def.tier >= 3) return 12;
  return 24;
}

const POWER_LIFETIME = 30;

export class World {
  readonly group = new THREE.Group();
  readonly entities: Entity[] = [];
  readonly hash = new SpatialHash<Entity>(4);
  readonly ghosts: Entity[] = [];
  readonly half: number;
  private pools = new Map<string, InstancedPool>();
  private nextId = 1;
  private flying: Entity[] = [];
  private spawning: Entity[] = [];
  private ghostMaterial: THREE.MeshStandardMaterial | null = null;
  private floorMaterial: THREE.MeshStandardMaterial | null = null;
  private badMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private warmMaterial: THREE.MeshStandardMaterial | null = null;
  private foliageMaterial: THREE.MeshStandardMaterial | null = null;
  private tileMaterial: THREE.MeshStandardMaterial | null = null;
  private rockMaterial: THREE.MeshStandardMaterial | null = null;
  private goldMaterial: THREE.MeshStandardMaterial | null = null;
  private glowPools = new Map<number, GlowPool>();
  private glowT = 0;
  /** Soft white rings under the nearest things the player can eat. */
  private shadows: ShadowPool | null = null;
  private hintPool: GlowPool | null = null;
  private hintCount = 0;
  /** Orange flashes on props that have just become edible. */
  private flashPool: GlowPool | null = null;
  private flashes: { e: Entity; t: number; idx: number }[] = [];
  rng: Rng;
  /** Per-tile ground height (terraced), tile grid is CONFIG.world.size / 4 per side. */
  private tiles = Math.ceil(CONFIG.world.size / 4);
  private tileH = new Float32Array(this.tiles * this.tiles);
  private pit = new Uint8Array(this.tiles * this.tiles);
  /** Path tile positions, used to bias candy toward the lanes. */
  pathNodes: { x: number; z: number }[] = [];

  constructor(seed: number, readonly layout: 'a' | 'b' = 'a') {
    this.rng = new Rng(seed || (Math.random() * 1e9) | 0);
    this.half = CONFIG.world.size / 2 - 2;
  }

  private tileIx(x: number, z: number): number {
    const half = CONFIG.world.size / 2;
    const i = THREE.MathUtils.clamp(Math.floor((x + half) / 4), 0, this.tiles - 1);
    const j = THREE.MathUtils.clamp(Math.floor((z + half) / 4), 0, this.tiles - 1);
    return i * this.tiles + j;
  }

  nearPath(x: number, z: number, d: number): boolean {
    for (const n of this.pathNodes) if (Math.abs(n.x - x) < d && Math.abs(n.z - z) < d && Math.hypot(n.x - x, n.z - z) < d) return true;
    return false;
  }

  isPit(x: number, z: number): boolean {
    return this.pit[this.tileIx(x, z)] === 1;
  }

  /** Smooth ground height: bilinear blend of the four nearest tile centres. */
  groundHeight(x: number, z: number): number {
    const half = CONFIG.world.size / 2;
    const fx = (x + half) / 4 - 0.5;
    const fz = (z + half) / 4 - 0.5;
    const i0 = THREE.MathUtils.clamp(Math.floor(fx), 0, this.tiles - 1);
    const j0 = THREE.MathUtils.clamp(Math.floor(fz), 0, this.tiles - 1);
    const i1 = Math.min(i0 + 1, this.tiles - 1);
    const j1 = Math.min(j0 + 1, this.tiles - 1);
    const tx = THREE.MathUtils.clamp(fx - i0, 0, 1);
    const tz = THREE.MathUtils.clamp(fz - j0, 0, 1);
    // Smoothstep keeps flats flat and softens the step edges.
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const h = (i: number, j: number) => this.tileH[i * this.tiles + j];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(i0, j0), h(i1, j0), sx), THREE.MathUtils.lerp(h(i0, j1), h(i1, j1), sx), sz);
  }

  pool(name: string): InstancedPool {
    let p = this.pools.get(name);
    if (!p) {
      const def = ITEM_BY_NAME.get(name);
      if (!def) throw new Error(`No item def for ${name}`);
      let override: THREE.Material | undefined;
      if (def.kind === 'skull') {
        const col = badColor(name);
        let bm = this.badMaterials.get(col);
        if (!bm) {
          bm = material().clone();
          bm.emissive = new THREE.Color(col);
          bm.emissiveIntensity = 0.35;
          this.badMaterials.set(col, bm);
        }
        override = bm;
      } else if (/^(pebble|rock|boulder|crag)_/.test(name)) {
        // Stone: the pack's pale grey goes to a cooler mid-grey so rocks sit in the night.
        if (!this.rockMaterial) {
          this.rockMaterial = materialOf(name).clone();
          this.rockMaterial.color.set(0x8a8ea6);
        }
        override = this.rockMaterial;
      } else if (/^(bush|leafy_tree)_/.test(name)) {
        // Night foliage: pull the pack's bright greens toward a dusky blue-green.
        if (!this.foliageMaterial) {
          this.foliageMaterial = materialOf(name).clone();
          this.foliageMaterial.color.set(0x7d8fb0);
        }
        override = this.foliageMaterial;
      } else if (def.kind === 'power') {
        if (!this.goldMaterial) {
          this.goldMaterial = material().clone();
          this.goldMaterial.emissive = new THREE.Color(0xffb640);
          this.goldMaterial.emissiveIntensity = 0.5;
        }
        override = this.goldMaterial;
      } else if (/^candle|jackolantern$/.test(name)) {
        // Only the flame-bearing things get a touch of emissive; real light comes from LocalLights.
        if (!this.warmMaterial) {
          this.warmMaterial = material().clone();
          this.warmMaterial.emissive = new THREE.Color(0xff9a3c);
          this.warmMaterial.emissiveIntensity = 0.08;
        }
        override = this.warmMaterial;
      } else if (name === 'floor_dirt') {
        // Floor tiles are tinted per instance (dirt to grass), so the material stays white.
        if (!this.tileMaterial) {
          this.tileMaterial = material().clone();
          this.tileMaterial.color.set(0xffffff);
        }
        override = this.tileMaterial;
      } else if (name.startsWith('path_')) {
        if (!this.floorMaterial) {
          this.floorMaterial = material().clone();
          this.floorMaterial.color.set(0x5d6286);
        }
        override = this.floorMaterial;
      }
      const ground = name === 'floor_dirt' || name === 'floor_dirt_grave' || name.startsWith('path_');
      p = new InstancedPool(name, capacityFor(def), this.group, override, { cast: !ground && def.kind !== 'candy' && !name.startsWith('pebble_'), receive: true });
      this.pools.set(name, p);
    }
    return p;
  }

  private glowPool(color: number): GlowPool {
    let g = this.glowPools.get(color);
    if (!g) {
      g = new GlowPool(color, color === 0xff9a3c ? 128 : color === 0xff6ea6 ? 16 : 64, this.group);
      this.glowPools.set(color, g);
    }
    return g;
  }

  private attachShadow(e: Entity): void {
    if (e.def.kind === 'scenery') return;
    if (CONFIG.render.shadowMaps && !IS_TOUCH && e.def.kind !== 'candy') return; // real shadows cover these
    if (!this.shadows) this.shadows = new ShadowPool(1200, this.group);
    e.shadow = this.shadows.acquire();
    const r = e.def.kind === 'candy' ? e.pickRadius * 2.4 : e.collideRadius * 2.6;
    this.shadows.set(e.shadow, e.x, e.z, Math.max(0.5, r), this.groundHeight(e.x, e.z) - 0.02);
  }

  private releaseShadow(e: Entity): void {
    if (this.shadows && e.shadow >= 0) this.shadows.release(e.shadow);
    e.shadow = -1;
  }

  private attachGlow(e: Entity): void {
    const n = e.def.name;
    const bucket = n.startsWith('candy_bucket') || n === 'treasure_chest';
    const power = e.def.kind === 'power';
    if (e.def.kind !== 'skull' && !bucket && !power) return;
    const pool = this.glowPool(e.def.kind === 'skull' ? badColor(n) : power ? 0xffd36b : 0xff6ea6);
    e.glowPool = pool;
    e.glow = pool.acquire();
    const size = e.def.kind === 'skull' ? e.pickRadius * 6 : power ? e.pickRadius * 7 : e.pickRadius * 5.5;
    pool.set(e.glow, e.x, e.z, size, this.groundHeight(e.x, e.z));
    if (power) {
      const halo = makeHalo(0xffd36b, e.pickRadius * 7);
      halo.position.set(e.x, e.y + 0.6, e.z);
      this.group.add(halo);
      e.halo = halo;
    }
    if (e.def.kind === 'skull') {
      // A soft floating halo so the hazard reads from any angle, not just on the ground.
      const halo = makeHalo(badColor(n), e.pickRadius * 4);
      halo.position.set(e.x, e.y + e.pickRadius * 0.9, e.z);
      this.group.add(halo);
      e.halo = halo;
    }
  }

  private releaseGlow(e: Entity): void {
    if (e.glowPool) e.glowPool.release(e.glow);
    e.glowPool = null;
    e.glow = -1;
    if (e.halo) {
      this.group.remove(e.halo);
      e.halo = null;
    }
  }

  private writeInstance(e: Entity): void {
    if (e.halo) e.halo.position.set(e.x, e.y + e.pickRadius * 0.9, e.z);
    if (!e.pool) return;
    tmpQ.setFromAxisAngle(UP, e.rotY);
    tmpP.set(e.x, e.y, e.z);
    tmpS.setScalar(e.scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    e.pool.set(e.index, tmpM);
  }

  /** Place a resting item. Scenery is drawn but never collides. */
  spawn(def: ItemDef, x: number, z: number, rotY = 0, opts: { animate?: 'drop' | 'rise'; scale?: number } = {}): Entity {
    const scale = opts.scale ?? def.scale ?? 1;
    // pickRadiusOf/collideRadiusOf/volumeOf already include def.scale; only an explicit override scales further.
    const k = scale / (def.scale ?? 1);
    const restY = restHeight(def) * k + (def.kind === 'scenery' ? 0 : this.groundHeight(x, z));
    const e: Entity = {
      id: this.nextId++,
      def,
      x, z,
      y: restY,
      restY,
      rotY,
      scale,
      pickRadius: pickRadiusOf(def) * k,
      collideRadius: collideRadiusOf(def) * k,
      volume: volumeOf(def) * k * k * k,
      state: 'free',
      pool: null,
      index: -1,
      obj: null,
      vel: null,
      t: 0,
      speed: 0,
      glow: -1,
      glowPool: null,
      shadow: -1,
      halo: null,
    };
    const pool = this.pool(def.name);
    if (pool.available() <= 0) {
      e.state = 'gone';
      return e;
    }
    e.pool = pool;
    e.index = pool.acquire();
    if (opts.animate === 'drop') {
      e.state = 'spawning';
      e.y = restY + 7;
      e.vel = new THREE.Vector3(0, 0, 0);
      this.spawning.push(e);
    } else if (opts.animate === 'rise') {
      e.state = 'spawning';
      e.t = 0;
      e.scale = 0.001;
      this.spawning.push(e);
    }
    this.writeInstance(e);
    this.entities.push(e);
    if (def.kind !== 'scenery') this.hash.insert(e);
    this.attachGlow(e);
    this.attachShadow(e);
    return e;
  }

  /** Remove an entity from the world entirely. */
  remove(e: Entity): void {
    if (e.state === 'gone') return;
    if (e.pool && e.index >= 0) {
      e.pool.release(e.index);
      e.pool = null;
      e.index = -1;
    }
    if (e.obj) {
      this.group.remove(e.obj);
      e.obj = null;
    }
    if (e.def.kind !== 'scenery') this.hash.remove(e);
    this.releaseGlow(e);
    this.releaseShadow(e);
    e.state = 'gone';
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
  }

  /** Convert a free entity into a standalone object (for attaching to the ball). */
  detach(e: Entity): THREE.Object3D {
    const obj = cloneModel(e.def.name);
    obj.scale.setScalar(e.scale);
    obj.rotation.y = e.rotY;
    obj.position.set(e.x, e.y, e.z);
    this.remove(e);
    return obj;
  }

  /** Throw an object; it lands and becomes a free entity again. */
  scatter(obj: THREE.Object3D, def: ItemDef, from: THREE.Vector3, vel: THREE.Vector3, scale: number): void {
    obj.position.copy(from);
    this.group.add(obj);
    const e: Entity = {
      id: this.nextId++,
      def,
      x: from.x, z: from.z, y: from.y,
      restY: restHeight(def) * (scale / (def.scale ?? 1)),
      rotY: this.rng.range(0, Math.PI * 2),
      scale,
      pickRadius: pickRadiusOf(def) * (scale / (def.scale ?? 1)),
      collideRadius: collideRadiusOf(def) * (scale / (def.scale ?? 1)),
      volume: volumeOf(def) * Math.pow(scale / (def.scale ?? 1), 3),
      state: 'flying',
      pool: null,
      index: -1,
      obj,
      vel: vel.clone(),
      t: 0,
      speed: 0,
      glow: -1,
      glowPool: null,
      shadow: -1,
      halo: null,
    };
    this.flying.push(e);
  }

  spawnGhost(def: ItemDef, x: number, z: number, scale: number, speed: number): Entity {
    if (!this.ghostMaterial) {
      this.ghostMaterial = material().clone();
      this.ghostMaterial.transparent = true;
      this.ghostMaterial.opacity = 0.78;
      this.ghostMaterial.emissive = new THREE.Color(0xb86bff);
      this.ghostMaterial.emissiveIntensity = 0.6;
      this.ghostMaterial.depthWrite = false;
    }
    const obj = cloneModel(def.name);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = this.ghostMaterial!;
    });
    obj.scale.setScalar(scale);
    const halo = makeHalo(0xb86bff, 3.4);
    halo.position.y = 0.3;
    obj.add(halo);
    this.group.add(obj);
    const e: Entity = {
      id: this.nextId++,
      def,
      x, z, y: 1,
      restY: 1,
      rotY: 0,
      scale,
      pickRadius: pickRadiusOf(def) * (scale / (def.scale ?? 1)),
      collideRadius: 0,
      volume: 0,
      state: 'ghost',
      pool: null,
      index: -1,
      obj,
      vel: null,
      t: this.rng.range(0, 10),
      speed,
      glow: -1,
      glowPool: null,
      shadow: -1,
      halo: null,
    };
    this.ghosts.push(e);
    return e;
  }

  removeGhost(e: Entity): void {
    if (e.obj) this.group.remove(e.obj);
    e.obj = null;
    e.state = 'gone';
    const i = this.ghosts.indexOf(e);
    if (i >= 0) this.ghosts.splice(i, 1);
  }

  /** True if a circle at (x,z) overlaps any non-scenery entity (with padding). */
  isBlocked(x: number, z: number, r: number, pad = 0.3): boolean {
    const near = this.hash.query(x, z, r + 6, this.scratch);
    for (const e of near) {
      if (e.state === 'gone') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < r + e.collideRadius + pad) return true;
    }
    return false;
  }
  private scratch: Entity[] = [];

  /**
   * Find a free spot. `ring` restricts to an annulus around (cx,cz).
   * Returns null if nothing fits after `tries` attempts.
   */
  findSpot(r: number, opts: { cx?: number; cz?: number; min?: number; max?: number; tries?: number; avoidX?: number; avoidZ?: number; avoidR?: number; avoidPaths?: boolean } = {}): { x: number; z: number } | null {
    const tries = opts.tries ?? 24;
    for (let i = 0; i < tries; i++) {
      let x: number;
      let z: number;
      if (opts.cx !== undefined && opts.cz !== undefined && opts.max !== undefined) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(opts.min ?? 0, opts.max);
        x = opts.cx + Math.cos(a) * d;
        z = opts.cz + Math.sin(a) * d;
      } else {
        x = this.rng.range(-this.half + r, this.half - r);
        z = this.rng.range(-this.half + r, this.half - r);
      }
      if (Math.abs(x) > this.half - r || Math.abs(z) > this.half - r) continue;
      if (opts.avoidX !== undefined && opts.avoidZ !== undefined && Math.hypot(x - opts.avoidX, z - opts.avoidZ) < (opts.avoidR ?? 0) + r) continue;
      if (this.isPit(x, z)) continue;
      if (opts.avoidPaths !== false && this.nearPath(x, z, r + 0.9)) continue;
      if (!this.isBlocked(x, z, r)) return { x, z };
    }
    return null;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.glowT += dt;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0 || f.e.state !== 'free') {
        this.flashPool!.release(f.idx);
        this.flashes.splice(i, 1);
        continue;
      }
      const pulse = 1 + 0.25 * Math.sin(this.glowT * 9);
      this.flashPool!.set(f.idx, f.e.x, f.e.z, f.e.pickRadius * 3.2 * pulse, this.groundHeight(f.e.x, f.e.z));
    }
    if (this.flashPool) this.flashPool.material.opacity = 0.35 + 0.2 * Math.sin(this.glowT * 9);
    const pulse = 0.72 + 0.22 * Math.sin(this.glowT * 3.5);
    for (const g of this.glowPools.values()) g.material.opacity = pulse;
    for (const bm of this.badMaterials.values()) bm.emissiveIntensity = 0.45 + 0.3 * Math.sin(this.glowT * 3.5);
    for (const e of this.entities) if (e.halo) (e.halo.material as THREE.SpriteMaterial).opacity = 0.3 + 0.12 * Math.sin(this.glowT * 3.5 + e.id);
    // Power-ups hover, spin and shine; they fade out after half a minute if nobody grabs them.
    for (const e of this.entities) {
      if (e.def.kind !== 'power' || e.state !== 'free') continue;
      e.t += dt;
      const life = POWER_LIFETIME - e.t;
      if (life <= 0) { this.remove(e); continue; }
      e.y = e.restY + 0.55 + 0.18 * Math.sin(e.t * 2.4);
      e.rotY += dt * 1.8;
      const s = e.def.scale ?? 1;
      e.scale = life < 4 ? s * (0.75 + 0.25 * Math.abs(Math.sin(life * 8))) : s;
      this.writeInstance(e);
      if (e.halo) e.halo.position.y = e.y + 0.3;
    }
    // Dropping / rising spawns.
    for (let i = this.spawning.length - 1; i >= 0; i--) {
      const e = this.spawning[i];
      if (e.state !== 'spawning') {
        this.spawning.splice(i, 1);
        continue;
      }
      if (e.vel) {
        e.vel.y -= 28 * dt;
        e.y += e.vel.y * dt;
        if (e.y <= e.restY) {
          e.y = e.restY;
          if (e.vel.y < -4) e.vel.y = -e.vel.y * 0.35;
          else {
            e.vel = null;
            e.state = 'free';
            this.spawning.splice(i, 1);
          }
        }
      } else {
        e.t += dt;
        const k = Math.min(1, e.t / 0.55);
        // Overshoot ease for a cute pop.
        const s = 1 + 0.3 * Math.sin(k * Math.PI) * (1 - k);
        e.scale = Math.max(0.001, k * s);
        if (k >= 1) {
          e.scale = 1;
          e.state = 'free';
          this.spawning.splice(i, 1);
        }
      }
      this.writeInstance(e);
    }

    // Thrown items.
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const e = this.flying[i];
      const v = e.vel!;
      v.y -= 26 * dt;
      e.x += v.x * dt;
      e.z += v.z * dt;
      e.y += v.y * dt;
      e.rotY += dt * 4;
      e.obj!.position.set(e.x, e.y, e.z);
      e.obj!.rotation.y = e.rotY;
      e.restY = restHeight(e.def) * (e.scale / (e.def.scale ?? 1)) + this.groundHeight(e.x, e.z);
      if (e.y <= e.restY && v.y < 0) {
        if (v.y < -5) {
          e.y = e.restY;
          v.y = -v.y * 0.4;
          v.x *= 0.6;
          v.z *= 0.6;
        } else {
          // Land: back into the instanced pool as a free entity.
          this.flying.splice(i, 1);
          this.group.remove(e.obj!);
          e.obj = null;
          e.vel = null;
          e.x = THREE.MathUtils.clamp(e.x, -this.half + 1, this.half - 1);
          e.z = THREE.MathUtils.clamp(e.z, -this.half + 1, this.half - 1);
          e.restY = restHeight(e.def) * (e.scale / (e.def.scale ?? 1)) + this.groundHeight(e.x, e.z);
          e.y = e.restY;
          const pool = this.pool(e.def.name);
          if (pool.available() > 0) {
            e.pool = pool;
            e.index = pool.acquire();
            e.state = 'free';
            this.writeInstance(e);
            this.entities.push(e);
            this.hash.insert(e);
            this.attachGlow(e);
            this.attachShadow(e);
          } else {
            e.state = 'gone';
          }
        }
      }
    }

    // Ghost skulls drift toward the player and bob.
    for (const g of this.ghosts) {
      g.t += dt;
      const dx = playerPos.x - g.x;
      const dz = playerPos.z - g.z;
      const d = Math.hypot(dx, dz) || 1;
      // Slight sideways wobble so they feel alive.
      const wob = Math.sin(g.t * 1.7) * 0.6;
      // Every ~6 s a 1.5 s lunge at 1.8x speed, so a moving player still has to dodge.
      const lunge = (g.t % 7) < 1.2 ? 1.5 : 1;
      g.x += (dx / d) * g.speed * lunge * dt + (-dz / d) * wob * dt;
      g.z += (dz / d) * g.speed * lunge * dt + (dx / d) * wob * dt;
      g.y = playerPos.y + Math.sin(g.t * 2.2) * 0.25 * g.scale;
      g.obj!.position.set(g.x, g.y, g.z);
      g.obj!.rotation.y = Math.atan2(dx, dz) + Math.PI;
      g.obj!.rotation.z = Math.sin(g.t * 2.2) * 0.12;
    }
  }

  /** Show soft rings under up to `max` of the nearest edible props within `range`. */
  updateHints(px: number, pz: number, playerRadius: number, pickRatio: number, range = 11, max = 5): void {
    if (!this.hintPool) this.hintPool = new GlowPool(0xffffff, 8, this.group);
    const pool = this.hintPool;
    const near = this.hash.query(px, pz, range, this.scratch);
    const cands: { e: Entity; d: number }[] = [];
    for (const e of near) {
      if (e.state !== 'free' || e.def.kind === 'skull' || e.def.kind === 'scenery') continue;
      if (e.def.kind === 'candy' && !e.def.name.startsWith('candy_bucket')) continue;
      if (e.pickRadius > playerRadius * pickRatio || e.pickRadius < playerRadius * 0.45) continue;
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < range) cands.push({ e, d });
    }
    cands.sort((a, b) => a.d - b.d);
    const n = Math.min(max, cands.length);
    for (let i = 0; i < 8; i++) {
      if (i < n) {
        if (i >= this.hintCount) pool.acquire();
        const { e } = cands[i];
        pool.set(i, e.x, e.z, Math.max(1.2, e.pickRadius * 2.6), this.groundHeight(e.x, e.z));
      } else if (i < this.hintCount) {
        pool.release(i);
      }
    }
    this.hintCount = n;
    pool.material.opacity = 0.22 + 0.08 * Math.sin(this.glowT * 5);
  }

  clearHints(): void {
    if (!this.hintPool) return;
    for (let i = 0; i < this.hintCount; i++) this.hintPool.release(i);
    this.hintCount = 0;
  }

  /** Flash props whose pickup radius falls in (lo, hi]: they just became edible. */
  flashNewlyEdible(lo: number, hi: number, px: number, pz: number): void {
    if (!this.flashPool) this.flashPool = new GlowPool(0xffb347, 24, this.group);
    for (const e of this.entities) {
      if (e.state !== 'free' || e.def.kind !== 'prop') continue;
      if (e.pickRadius <= lo || e.pickRadius > hi) continue;
      if (Math.hypot(e.x - px, e.z - pz) > 34) continue;
      if (this.flashes.some((f) => f.e === e)) continue;
      const idx = this.flashPool.acquire();
      if (idx < 0) break;
      this.flashes.push({ e, t: 3.2, idx });
    }
  }

  /** Count free (resting) non-scenery entities that satisfy the predicate. */
  count(pred: (e: Entity) => boolean): number {
    let n = 0;
    for (const e of this.entities) if (e.state === 'free' && e.def.kind !== 'scenery' && pred(e)) n++;
    return n;
  }

  // ---------------------------------------------------------------- generation

  generate(): void {
    if (this.layout === 'b') {
      this.generateB();
      return;
    }
    const rng = this.rng;
    const def = (n: string) => ITEM_BY_NAME.get(n)!;
    const half = CONFIG.world.size / 2;
    const T = this.tiles;

    // Terraced terrain: seeded value noise quantised to three steps, flat in the middle and at the fence.
    const noise = new Float32Array((T + 1) * (T + 1));
    for (let i = 0; i < noise.length; i++) noise[i] = rng.next();
    const coarse = (i: number, j: number) => {
      const ci = i / 3, cj = j / 3;
      const i0 = Math.floor(ci), j0 = Math.floor(cj);
      const n = (a: number, b: number) => noise[Math.min(a, T) * (T + 1) + Math.min(b, T)];
      const tx = ci - i0, tz = cj - j0;
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(n(i0, j0), n(i0 + 1, j0), tx), THREE.MathUtils.lerp(n(i0, j0 + 1), n(i0 + 1, j0 + 1), tx), tz);
    };
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        const cx = -half + 2 + i * 4, cz = -half + 2 + j * 4;
        const d = Math.hypot(cx, cz);
        const edge = i === 0 || j === 0 || i === T - 1 || j === T - 1;
        let h = 0;
        if (!edge && d > 9) {
          const v = coarse(i, j);
          h = v > 0.72 ? 0.26 : v > 0.5 ? 0.13 : 0;
        }
        this.tileH[i * T + j] = h;
      }
    }

    // Plan the paths first so pits, graves and props can keep off them.
    const planned: { x: number; z: number }[][] = [];
    const planPath = (pts: [number, number][]) => {
      const P = [pts[0], ...pts, pts[pts.length - 1]];
      const out: { x: number; z: number }[] = [];
      for (let k = 1; k < P.length - 2; k++) {
        const [p0, p1, p2, p3] = [P[k - 1], P[k], P[k + 1], P[k + 2]];
        const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const steps = Math.max(1, Math.round(segLen / 1.7));
        for (let st = 0; st < steps; st++) {
          const t = st / steps, t2 = t * t, t3 = t2 * t;
          const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
          const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
          out.push({ x, z });
        }
      }
      planned.push(out);
      for (const n of out) this.pathNodes.push(n);
    };
    // Main avenue: gate -> centre -> up the west edge of the pumpkin patch.
    planPath([[0, -31], [1, -22], [-1.5, -12], [0, 0], [3, 6], [6.5, 12], [6.5, 20], [8, 27]]);
    // Graveyard aisle: between the rows at z = -14 and z = -9, then up to the crypt door.
    planPath([[0, 0], [-5, -4], [-8, -11.5], [-16, -11.5], [-24, -11.5], [-25, -16]]);
    // East lane to the shrine, and a short north-west walk to the copse.
    planPath([[0, 0], [8, -3], [16, -8], [22, -13]]);
    planPath([[0, 0], [-6, 6], [-13, 12], [-20, 17]]);

    // Floor tiles, tinted per tile from dirt to grass by a smooth field, with sunken grave pits in
    // the graveyard that never sit under a path or a row of graves.
    const floor = def('floor_dirt');
    const pitDef = def('floor_dirt_grave');
    const graveRows = [-24, -19, -14, -9];
    const dirtCol = new THREE.Color(0x5d6286), grassCol = new THREE.Color(0x6b9458), tint = new THREE.Color();
    const sat = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
    const grassiness = (x: number, z: number, i: number, j: number): number => {
      // Pumpkin patch: a soft-edged rectangle. Copse: a soft disc. Meadows: smooth noise.
      const patch = sat(Math.min(x - 6, z - 6, 31 - x, 31 - z) / 6);
      const copse = sat((11 - Math.hypot(x + 20, z - 20)) / 6);
      const meadow = 0.7 * sat((coarse(i + 7, j + 3) - 0.68) / 0.16);
      const graveyard = x < -6 && x > -31 && z < -2 && z > -31 ? 1 : 0;
      const centre = sat((8 - Math.hypot(x, z)) / 4);
      return Math.min(0.85, Math.max(patch, copse, meadow)) * (1 - graveyard) * (1 - centre);
    };
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        const cx = -half + 2 + i * 4, cz = -half + 2 + j * 4;
        const inGraveyard = cx < -8 && cx > -30 && cz < -4 && cz > -30 && Math.hypot(cx + 24, cz + 22) > 8;
        const onRow = graveRows.some((rz) => Math.abs(rz - cz) < 2.6);
        const usePit = inGraveyard && !onRow && this.tileH[i * T + j] === 0 && !this.nearPath(cx, cz, 3.2) && rng.next() < 0.35;
        const e = this.spawn(usePit ? pitDef : floor, cx, cz, rng.int(0, 3) * Math.PI * 0.5);
        e.y = -0.03 + this.tileH[i * T + j];
        this.writeInstance(e);
        if (usePit) this.pit[i * T + j] = 1;
        else if (e.pool) {
          const g = grassiness(cx, cz, i, j) * (0.9 + rng.next() * 0.1);
          tint.copy(dirtCol).lerp(grassCol, g);
          e.pool.setColor(e.index, tint);
        }
      }
    }
    // Perimeter fence.
    const fenceDefs = [def('fence'), def('fence'), def('fence'), def('fence_broken')];
    for (let i = 0; i < T; i++) {
      const p = -half + 2 + i * 4;
      this.spawn(rng.pick(fenceDefs), p, -half + 0.3, 0);
      this.spawn(rng.pick(fenceDefs), p, half - 0.3, Math.PI);
      this.spawn(rng.pick(fenceDefs), -half + 0.3, p, Math.PI / 2);
      this.spawn(rng.pick(fenceDefs), half - 0.3, p, -Math.PI / 2);
    }
    // Lay the planned paths as stone tiles.
    const paths = ['path_A', 'path_B', 'path_C', 'path_D'].map(def);
    for (const line of planned) {
      for (const n of line) {
        if (this.isPit(n.x, n.z)) continue;
        const e = this.spawn(rng.pick(paths), n.x + rng.range(-0.25, 0.25), n.z + rng.range(-0.25, 0.25), rng.range(0, 6.28));
        e.y = this.groundHeight(n.x, n.z);
        this.writeInstance(e);
      }
    }

    const place = (name: string, n: number, area: { cx?: number; cz?: number; min?: number; max?: number } = {}, avoidR = 6) => {
      const d = def(name);
      const r = collideRadiusOf(d);
      for (let i = 0; i < n; i++) {
        const s = this.findSpot(r, { ...area, avoidX: 0, avoidZ: 0, avoidR, tries: 30, avoidPaths: d.kind !== 'skull' });
        if (s && !(d.kind !== 'candy' && Math.abs(s.x) < 2.5 && s.z > -2 && s.z < 14)) this.spawn(d, s.x, s.z, rng.range(0, Math.PI * 2));
      }
    };
    const tryPlace = (name: string, x: number, z: number, ry: number) => {
      const d = def(name);
      if (Math.abs(x) > this.half - 1 || Math.abs(z) > this.half - 1) return null;
      if (this.isPit(x, z) || this.nearPath(x, z, collideRadiusOf(d) + 0.7) || this.isBlocked(x, z, collideRadiusOf(d), 0.2)) return null;
      return this.spawn(d, x, z, ry);
    };

    // Avenue dressing: lamp posts at intervals, benches facing the path, signposts at junctions.
    const avenue = planned[0];
    for (let k = 6; k < avenue.length - 4; k += 7) {
      const n = avenue[k], m = avenue[Math.min(k + 1, avenue.length - 1)];
      const dx = m.x - n.x, dz = m.z - n.z, len = Math.hypot(dx, dz) || 1;
      const side = k % 14 === 6 ? 1 : -1;
      tryPlace('post_lantern', n.x + (-dz / len) * 2.0 * side, n.z + (dx / len) * 2.0 * side, Math.atan2(dx, dz));
    }
    const aisle = planned[1];
    for (let k = 5; k < aisle.length - 2; k += 8) {
      const n = aisle[k];
      tryPlace('post_lantern', n.x, n.z + 2.1, Math.PI);
    }
    tryPlace('bench', 3.2, -16, Math.PI / 2); tryPlace('bench', -3.2, -6, -Math.PI / 2);
    tryPlace('bench_decorated', 9.5, 16, Math.PI / 2); tryPlace('bench', -4, 9, Math.PI * 0.75);
    tryPlace('sign_both', 2.6, -2.4, -0.3); tryPlace('sign_left', 9, 7.5, 0.5); tryPlace('sign_right', -7.5, -6.5, -0.4);

    // Landmarks.
    this.spawn(def('crypt'), -24, -22, Math.PI * 0.15);
    this.spawn(def('arch'), 0, -27, 0);
    this.spawn(def('tractor'), 24.5, 22, -Math.PI * 0.3);
    this.spawn(def('wagon_hay'), 19, 27.5, Math.PI * 0.6);
    this.spawn(def('wooden_gate_halloween'), 27, -14, Math.PI / 2);
    this.spawn(def('shrine_candles'), 23, -16, -Math.PI / 2);

    // Graveyard (SW): rows of graves with candles, loosely fenced.
    const graveTypes = ['grave_A', 'grave_B', 'gravestone', 'grave_A_destroyed', 'gravemarker_A', 'gravemarker_B', 'grave_B', 'gravestone'];
    for (const z of [-24, -19, -14, -9]) {
      for (let x = -27; x <= -9; x += 3) {
        if (Math.hypot(x + 24, z + 22) < 7) continue; // crypt
        if (rng.next() < 0.18) continue;
        const e = tryPlace(rng.pick(graveTypes), x + rng.range(-0.5, 0.5), z + rng.range(-0.4, 0.4), rng.range(-0.25, 0.25));
        if (e && rng.next() < 0.45) tryPlace(rng.pick(['candle', 'candle_thin', 'candle_melted', 'candle_triple']), x + rng.range(-0.8, 0.8), z + 1.1, rng.range(0, 6.28));
      }
    }
    for (let x = -28; x <= -6; x += 4) tryPlace(rng.next() < 0.75 ? 'fence_seperate' : 'fence_seperate_broken', x, -5.5, 0);
    for (let z = -28; z <= -8; z += 4) tryPlace(rng.next() < 0.75 ? 'fence_seperate' : 'fence_seperate_broken', -5.5, z, Math.PI / 2);
    place('coffin', 2, { cx: -17, cz: -15, min: 0, max: 12 }); place('coffin_decorated', 1, { cx: -17, cz: -15, min: 0, max: 12 });
    place('plaque_candles', 2, { cx: -17, cz: -15, min: 0, max: 12 }); place('skull_candle', 3, { cx: -17, cz: -15, min: 0, max: 12 });
    place('pillar', 2, { cx: -17, cz: -15, min: 4, max: 12 });

    // Pumpkin patch (NE): rows of pumpkins, a line of hay, scarecrows.
    const pumpkins = ['pumpkin_orange_small', 'pumpkin_orange', 'pumpkin_yellow_small', 'pumpkin_orange_small', 'pumpkin_yellow', 'pumpkin_orange'];
    for (const z of [10, 14, 18, 22, 26]) {
      for (let x = 9; x <= 21; x += 2.4) {
        if (rng.next() < 0.22) continue;
        tryPlace(rng.pick(pumpkins), x + rng.range(-0.5, 0.5), z + rng.range(-0.5, 0.5), rng.range(0, 6.28));
      }
    }
    for (let z = 9; z <= 25; z += 3.2) tryPlace('haybale', 26 + rng.range(-0.3, 0.3), z, rng.range(-0.15, 0.15));
    tryPlace('scarecrow', 12, 24.5, 0.3); tryPlace('scarecrow', 20, 9, -0.4);
    tryPlace('pitchfork', 14.5, 27, 0.9);
    tryPlace('pumpkin_yellow_jackolantern', 11, 12.5, 0.4); tryPlace('pumpkin_yellow_jackolantern', 19, 21, -0.6);

    // Farm stores by the machinery, the crypt's hoard, brew at the shrine, ruins by the crypt.
    place('barrel', 3, { cx: 23, cz: 24, min: 1, max: 5 }, 12); place('big_barrel', 1, { cx: 23, cz: 24, min: 1, max: 5 }, 12);
    place('keg', 1, { cx: 20, cz: 27, min: 1, max: 4 }, 12); place('crate', 3, { cx: 22, cz: 20, min: 1, max: 5 }, 12);
    place('big_crate', 1, { cx: 22, cz: 20, min: 1, max: 5 }, 12); place('crate_stack', 1, { cx: 26, cz: 18, min: 0, max: 3 }, 12);
    place('trunk_small', 2, { cx: -22, cz: -18, min: 3, max: 7 }, 12); place('trunk_medium', 2, { cx: -22, cz: -18, min: 3, max: 8 }, 12);
    place('trunk_large', 1, { cx: -20, cz: -16, min: 2, max: 6 }, 12); place('treasure_chest', 1, { cx: -21, cz: -17, min: 1, max: 4 }, 14);
    place('crypt_key', 2, { cx: -22, cz: -18, min: 2, max: 8 }, 12);
    place('rubble', 1, { cx: -27, cz: -14, min: 0, max: 4 }, 14); place('ruins', 1, { cx: -16, cz: -27, min: 0, max: 3 }, 16);
    place('potion_a', 3, { cx: 23, cz: -16, min: 1, max: 5 }, 12); place('potion_b', 2, { cx: 23, cz: -16, min: 1, max: 5 }, 12); place('potion_c', 2, { cx: 23, cz: -16, min: 1, max: 5 }, 12);

    // Shrine corner (SE): the jackpot, guarded.
    place('candy_bucket_A_decorated', 1, { cx: 23, cz: -16, min: 1, max: 4 }, 12);
    place('candy_bucket_B_decorated', 1, { cx: 23, cz: -16, min: 1, max: 4 }, 12);
    place('candy_bucket_A', 1, { cx: 23, cz: -16, min: 2, max: 6 }, 12);
    place('ribcage', 2, { cx: 23, cz: -16, min: 3, max: 7 }, 12);
    place('skull', 6, { cx: 23, cz: -16, min: 3, max: 9 }, 12);
    place('lantern_standing', 3, { cx: 23, cz: -16, min: 2, max: 7 }, 12);

    // Dead copse (NW) and the forest ring.
    place('tree_dead_large', 3, { cx: -20, cz: 20, min: 0, max: 9 }, 14);
    place('tree_dead_medium', 4, { cx: -20, cz: 20, min: 0, max: 10 }, 14);
    place('tree_dead_small', 5, { cx: -20, cz: 20, min: 0, max: 11 }, 12);
    place('tree_dead_large_decorated', 2, { cx: -20, cz: 20, min: 2, max: 9 }, 14);
    place('post_skull', 2, { cx: -20, cz: 20, min: 2, max: 10 }, 12);
    place('bone_A', 6, { cx: -20, cz: 20, min: 0, max: 11 }, 8); place('bone_C', 4, { cx: -20, cz: 20, min: 0, max: 11 }, 8);
    const ring = { cx: 0, cz: 0, min: 28, max: 33 };
    place('tree_pine_orange_large', 4, ring, 20); place('tree_pine_yellow_large', 4, ring, 20);
    place('tree_pine_orange_medium', 5, ring, 20); place('tree_pine_yellow_medium', 5, ring, 20);
    place('tree_pine_orange_small', 4, { cx: 0, cz: 0, min: 20, max: 30 }, 12);
    place('tree_pine_yellow_small', 4, { cx: 0, cz: 0, min: 20, max: 30 }, 12);
    place('tree_dead_medium', 3, { cx: 0, cz: 0, min: 14, max: 30 }, 10);

    // Forest pack: rocks in clusters, bushes along the fences, bare trees in the copse, grass everywhere.
    for (let k = 0; k < 7; k++) {
      const cx = rng.range(-26, 26), cz = rng.range(-26, 26);
      if (Math.hypot(cx, cz) < 9) continue;
      place(rng.pick(['boulder_a', 'boulder_b', 'boulder_c']), 1, { cx, cz, min: 0, max: 2 }, 9);
      place(rng.pick(['rock_e', 'rock_f', 'rock_g']), 2, { cx, cz, min: 1, max: 4 }, 7);
      place(rng.pick(['rock_a', 'rock_b', 'rock_c', 'rock_d']), 3, { cx, cz, min: 1, max: 5 }, 5);
      place(rng.pick(['pebble_a', 'pebble_b', 'pebble_c']), 4, { cx, cz, min: 1, max: 6 }, 3);
    }
    place('crag_a', 1, { cx: 0, cz: 0, min: 22, max: 31 }, 20); place('crag_b', 1, { cx: 0, cz: 0, min: 22, max: 31 }, 20);
    for (const [bx, bz] of [[-12, 30], [12, 30], [30, 12], [30, -12], [-30, 10], [-30, -8], [8, -31], [-10, -31]] as const) {
      place(rng.pick(['bush_a', 'bush_b', 'bush_c', 'bush_d']), 3, { cx: bx, cz: bz, min: 0, max: 4 }, 8);
      place('bush_e', 1, { cx: bx, cz: bz, min: 0, max: 4 }, 8);
    }
    place('bare_tree_a', 3, { cx: -20, cz: 20, min: 0, max: 11 }, 12); place('bare_tree_b', 2, { cx: -20, cz: 20, min: 0, max: 11 }, 12);
    place('bare_tree_c', 2, { cx: -20, cz: 20, min: 0, max: 11 }, 12); place('bare_tree_d', 2, { cx: -17, cz: -15, min: 4, max: 12 }, 12);
    place('pebble_a', 10, {}, 3); place('pebble_b', 10, {}, 3); place('rock_a', 6, {}, 5); place('rock_b', 6, {}, 5);

    // Scattered everywhere.
    place('lantern_standing', 6);
    place('fence_pillar', 3); place('fence_pillar_broken', 3);
    place('candle_thin', 6); place('candle', 5);
    place('pumpkin_orange_small', 6, {}, 4); place('pumpkin_orange', 3, {}, 6);
    place('bone_A', 5, {}, 3); place('bone_B', 8, {}, 3);
    place('candy_bucket_B', 2, {}, 10);
    place('skull', 14, {}, 11); place('ribcage', 2, {}, 13); place('skull_candle', 2, {}, 11);

    // Candy carpet, denser along the paths.
    this.topUpCandy(300, null);
  }

  /**
   * Map B, "The Hollow": a round plaza in the middle with a ring road and four spokes.
   * Zones sit around the ring so each reads from a distance: the approach (S), graveyard (W),
   * the hollow (NW), the farm (NE), the shrine (E) and a rock garden (SE). Terrain steps up to the north.
   */
  generateB(): void {
    const rng = this.rng;
    const def = (n: string) => ITEM_BY_NAME.get(n)!;
    const half = CONFIG.world.size / 2;
    const T = this.tiles;

    // Terrain: terraces that climb toward the north, flat through the plaza and the ring road.
    const noise = new Float32Array((T + 1) * (T + 1));
    for (let i = 0; i < noise.length; i++) noise[i] = rng.next();
    const coarse = (i: number, j: number) => {
      const ci = i / 3, cj = j / 3;
      const i0 = Math.floor(ci), j0 = Math.floor(cj);
      const n = (a: number, b: number) => noise[Math.min(a, T) * (T + 1) + Math.min(b, T)];
      const tx = ci - i0, tz = cj - j0;
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(n(i0, j0), n(i0 + 1, j0), tx), THREE.MathUtils.lerp(n(i0, j0 + 1), n(i0 + 1, j0 + 1), tx), tz);
    };
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        const cx = -half + 2 + i * 4, cz = -half + 2 + j * 4;
        const d = Math.hypot(cx, cz);
        const edge = i === 0 || j === 0 || i === T - 1 || j === T - 1;
        let h = 0;
        if (!edge && d > 11 && Math.abs(d - 18) > 3) {
          const v = coarse(i, j) + 0.25 * (cz / half);
          h = v > 0.82 ? 0.26 : v > 0.58 ? 0.13 : 0;
        }
        this.tileH[i * T + j] = h;
      }
    }

    // Paths: the ring road, the southern approach, and spokes to each zone.
    const planned: { x: number; z: number }[][] = [];
    const planPath = (pts: [number, number][], loop = false) => {
      const P = loop ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
      const out: { x: number; z: number }[] = [];
      for (let k = 1; k < P.length - 2; k++) {
        const [p0, p1, p2, p3] = [P[k - 1], P[k], P[k + 1], P[k + 2]];
        const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const steps = Math.max(1, Math.round(segLen / 1.7));
        for (let st = 0; st < steps; st++) {
          const t = st / steps, t2 = t * t, t3 = t2 * t;
          const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
          const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
          out.push({ x, z });
        }
      }
      planned.push(out);
      for (const n of out) this.pathNodes.push(n);
    };
    const ring: [number, number][] = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const r = 18 + Math.sin(a * 3) * 1.2;
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    planPath(ring, true);
    const plaza: [number, number][] = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      plaza.push([Math.cos(a) * 6, Math.sin(a) * 6]);
    }
    planPath(plaza, true);
    planPath([[0, -33], [0.5, -27], [0, -18], [0, -6]]);                 // approach
    planPath([[-6, 0], [-12, -1], [-18, -2], [-26, -6]]);                // west spoke -> graveyard
    planPath([[-4.5, 4.5], [-10, 11], [-14, 17], [-20, 24]]);            // north-west -> the hollow
    planPath([[4.5, 4.5], [10, 11], [16, 15], [24, 20]]);                // north-east -> the farm
    planPath([[6, 0], [12, -2], [18, -4], [27, -8]]);                    // east -> the shrine

    // Floor, with grass on the farm and the hollow, blended smoothly; pits only in the graveyard.
    const floor = def('floor_dirt');
    const pitDef = def('floor_dirt_grave');
    const dirtCol = new THREE.Color(0x5d6286), grassCol = new THREE.Color(0x6b9458), tint = new THREE.Color();
    const sat = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
    const grassiness = (x: number, z: number, i: number, j: number) => {
      const farm = sat((13 - Math.hypot(x - 22, z - 20)) / 6);
      const hollow = sat((11 - Math.hypot(x + 20, z - 22)) / 6);
      const meadow = 0.6 * sat((coarse(i + 5, j + 9) - 0.7) / 0.15);
      const ringBand = sat((3.5 - Math.abs(Math.hypot(x, z) - 18)) / 2);
      const plazaM = sat((9 - Math.hypot(x, z)) / 3);
      return Math.min(0.85, Math.max(farm, hollow, meadow)) * (1 - ringBand) * (1 - plazaM);
    };
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        const cx = -half + 2 + i * 4, cz = -half + 2 + j * 4;
        const inGraveyard = cx < -12 && cx > -33 && cz > -20 && cz < 8;
        const usePit = inGraveyard && this.tileH[i * T + j] === 0 && !this.nearPath(cx, cz, 3.2) && rng.next() < 0.3;
        const e = this.spawn(usePit ? pitDef : floor, cx, cz, rng.int(0, 3) * Math.PI * 0.5);
        e.y = -0.03 + this.tileH[i * T + j];
        this.writeInstance(e);
        if (usePit) this.pit[i * T + j] = 1;
        else if (e.pool) {
          tint.copy(dirtCol).lerp(grassCol, grassiness(cx, cz, i, j) * (0.9 + rng.next() * 0.1));
          e.pool.setColor(e.index, tint);
        }
      }
    }
    const fenceDefs = [def('fence'), def('fence'), def('fence'), def('fence_broken')];
    for (let i = 0; i < T; i++) {
      const p = -half + 2 + i * 4;
      this.spawn(rng.pick(fenceDefs), p, -half + 0.3, 0);
      this.spawn(rng.pick(fenceDefs), p, half - 0.3, Math.PI);
      this.spawn(rng.pick(fenceDefs), -half + 0.3, p, Math.PI / 2);
      this.spawn(rng.pick(fenceDefs), half - 0.3, p, -Math.PI / 2);
    }
    const paths = ['path_A', 'path_B', 'path_C', 'path_D'].map(def);
    for (const line of planned) {
      for (const n of line) {
        if (this.isPit(n.x, n.z)) continue;
        const e = this.spawn(rng.pick(paths), n.x + rng.range(-0.25, 0.25), n.z + rng.range(-0.25, 0.25), rng.range(0, 6.28));
        e.y = this.groundHeight(n.x, n.z);
        this.writeInstance(e);
      }
    }

    const place = (name: string, n: number, area: { cx?: number; cz?: number; min?: number; max?: number } = {}, avoidR = 7) => {
      const d = def(name);
      const r = collideRadiusOf(d);
      for (let i = 0; i < n; i++) {
        const s = this.findSpot(r, { ...area, avoidX: 0, avoidZ: 0, avoidR, tries: 30, avoidPaths: d.kind !== 'skull' });
        if (s) this.spawn(d, s.x, s.z, rng.range(0, Math.PI * 2));
      }
    };
    const tryPlace = (name: string, x: number, z: number, ry: number) => {
      const d = def(name);
      if (Math.abs(x) > this.half - 1 || Math.abs(z) > this.half - 1) return null;
      if (this.isPit(x, z) || this.nearPath(x, z, collideRadiusOf(d) + 0.7) || this.isBlocked(x, z, collideRadiusOf(d), 0.2)) return null;
      return this.spawn(d, x, z, ry);
    };

    // Plaza: a shrine in the middle ringed by candles and four lamp posts at the spoke mouths.
    this.spawn(def('shrine_candles'), 0, 0, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      tryPlace(k % 2 ? 'candle' : 'candle_triple', Math.cos(a) * 2.6, Math.sin(a) * 2.6, rng.range(0, 6.28));
    }
    for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) tryPlace('post_lantern', Math.cos(a) * 8.6, Math.sin(a) * 8.6, a + Math.PI);
    tryPlace('bench', 8.2, -2.6, Math.PI / 2); tryPlace('bench', -8.2, 2.6, -Math.PI / 2);
    tryPlace('sign_both', 2.8, -8.8, -0.2);

    // The approach (S): the gate arch, lamp posts and signs lining the avenue.
    this.spawn(def('arch'), 0, -30, 0);
    for (const z of [-24, -16]) { tryPlace('post_lantern', -3.2, z, Math.PI / 2); tryPlace('post_lantern', 3.2, z + 4, -Math.PI / 2); }
    tryPlace('sign_left', -3.5, -12, 0.3); tryPlace('bench', 4.2, -21, Math.PI / 2);
    tryPlace('pumpkin_orange', -5, -27, 0.4); tryPlace('pumpkin_orange_small', 5, -28, 1.1); tryPlace('pumpkin_yellow_small', 6.2, -26.5, 2);

    // Graveyard (W): graves in arcs facing the plaza, the crypt at the back on the terrace.
    this.spawn(def('crypt'), -29, -2, Math.PI / 2);
    const graveTypes = ['grave_A', 'grave_B', 'gravestone', 'grave_A_destroyed', 'gravemarker_A', 'gravemarker_B', 'grave_B', 'gravestone'];
    for (const r of [14.5, 19.5, 24.5]) {
      for (let a = Math.PI * 0.68; a <= Math.PI * 1.32; a += Math.PI * 0.075) {
        if (Math.abs(a - Math.PI) < 0.2 && r < 22) continue; // keep the spoke open
        if (rng.next() < 0.2) continue;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const e = tryPlace(rng.pick(graveTypes), x, z, a + Math.PI / 2 + rng.range(-0.15, 0.15));
        if (e && rng.next() < 0.5) tryPlace(rng.pick(['candle', 'candle_thin', 'candle_melted']), Math.cos(a) * (r - 1.2), Math.sin(a) * (r - 1.2), rng.range(0, 6.28));
      }
    }
    for (let k = 0; k < 9; k++) {
      const a = Math.PI * 0.62 + k * Math.PI * 0.095;
      tryPlace(rng.next() < 0.75 ? 'fence_seperate' : 'fence_seperate_broken', Math.cos(a) * 12, Math.sin(a) * 12, a + Math.PI / 2);
    }
    place('coffin', 2, { cx: -22, cz: 2, min: 0, max: 8 }); place('coffin_decorated', 1, { cx: -22, cz: -8, min: 0, max: 6 });
    place('plaque_candles', 2, { cx: -20, cz: 0, min: 2, max: 9 }); place('skull_candle', 4, { cx: -20, cz: 0, min: 2, max: 10 });
    place('pillar', 2, { cx: -25, cz: -12, min: 0, max: 5 }); place('post_skull', 2, { cx: -24, cz: 8, min: 0, max: 5 });

    // The hollow (NW): dead trees, bones, boulders and the odd ribcage on the high terrace.
    const hollow = { cx: -20, cz: 22, min: 0, max: 10 };
    place('tree_dead_large', 3, hollow, 12); place('tree_dead_large_decorated', 1, hollow, 12);
    place('tree_dead_medium', 4, hollow, 12); place('tree_dead_small', 4, hollow, 10);
    place('bare_tree_a', 3, hollow, 10); place('bare_tree_c', 2, hollow, 10);
    place('bone_A', 6, hollow, 6); place('bone_B', 6, hollow, 6); place('bone_C', 4, hollow, 6);
    place('boulder_b', 2, hollow, 10); place('rock_e', 3, hollow, 8); place('rock_a', 5, hollow, 6);
    place('ribcage', 2, hollow, 10); place('skull', 5, hollow, 8);
    place('lantern_standing', 2, hollow, 8);

    // The farm (NE): pumpkin rows in a fan, hay stacked along the fence, machinery and scarecrows.
    const pumpkins = ['pumpkin_orange_small', 'pumpkin_orange', 'pumpkin_yellow_small', 'pumpkin_orange_small', 'pumpkin_yellow', 'pumpkin_orange'];
    for (const r of [15, 18.5, 22, 25.5, 29]) {
      for (let a = Math.PI * 0.12; a <= Math.PI * 0.42; a += Math.PI * 0.045) {
        if (rng.next() < 0.22) continue;
        tryPlace(rng.pick(pumpkins), Math.cos(a) * r + rng.range(-0.4, 0.4), Math.sin(a) * r + rng.range(-0.4, 0.4), rng.range(0, 6.28));
      }
    }
    for (let z = 10; z <= 30; z += 3.4) tryPlace('haybale', 31.5 + rng.range(-0.3, 0.3), z, rng.range(-0.15, 0.15));
    for (let x = 12; x <= 30; x += 3.4) tryPlace('haybale', x, 32 + rng.range(-0.3, 0.3), Math.PI / 2 + rng.range(-0.15, 0.15));
    this.spawn(def('tractor'), 27, 28, -Math.PI * 0.75);
    this.spawn(def('wagon_hay'), 31, 13, Math.PI * 0.5);
    this.spawn(def('wooden_gate_halloween'), 12, 32, 0);
    tryPlace('scarecrow', 13, 19, 0.6); tryPlace('scarecrow', 24, 12, -0.6); tryPlace('pitchfork', 17, 29, 1.2);
    tryPlace('pumpkin_yellow_jackolantern', 15, 14, 0.4); tryPlace('pumpkin_yellow_jackolantern', 21, 25, -0.5);
    tryPlace('sign_right', 8.5, 9.5, 0.6);

    // The shrine (E): candy buckets in a horseshoe of skulls, lanterns marking the way in.
    this.spawn(def('wooden_gate_halloween'), 30, -8, Math.PI / 2);
    this.spawn(def('shrine_candles'), 26, -13, -Math.PI * 0.4);
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI * 0.9 + (k / 6) * Math.PI * 1.1;
      tryPlace('skull', 26 + Math.cos(a) * 4.5, -13 + Math.sin(a) * 4.5, rng.range(0, 6.28));
    }
    tryPlace('candy_bucket_A_decorated', 24.5, -12, 0.3); tryPlace('candy_bucket_B_decorated', 27.5, -14.5, -0.6);
    tryPlace('candy_bucket_A', 25.5, -15.5, 1.1); tryPlace('ribcage', 29, -17, 0.5);
    tryPlace('lantern_standing', 20, -5.5, 0); tryPlace('lantern_standing', 23, -3.5, 0); tryPlace('post_lantern', 14, -5.2, Math.PI);

    // Dungeon pack: stores on the farm, the crypt's hoard with its key, brew at the shrine, ruins by the crypt.
    place('barrel', 3, { cx: 28, cz: 24, min: 0, max: 4 }, 12); place('big_barrel', 1, { cx: 28, cz: 24, min: 1, max: 4 }, 12);
    place('keg', 1, { cx: 30, cz: 18, min: 0, max: 3 }, 12); place('crate', 3, { cx: 24, cz: 28, min: 0, max: 4 }, 12);
    place('big_crate', 1, { cx: 24, cz: 28, min: 1, max: 4 }, 12); place('crate_stack', 1, { cx: 20, cz: 30, min: 0, max: 3 }, 12);
    place('trunk_small', 2, { cx: -26, cz: 1, min: 2, max: 6 }, 12); place('trunk_medium', 2, { cx: -26, cz: -5, min: 2, max: 6 }, 12);
    place('trunk_large', 1, { cx: -24, cz: 3, min: 1, max: 5 }, 12); place('treasure_chest', 1, { cx: -25, cz: -2, min: 2, max: 4 }, 14);
    place('crypt_key', 2, { cx: -24, cz: 0, min: 3, max: 8 }, 12);
    place('rubble', 1, { cx: -28, cz: 8, min: 0, max: 3 }, 14); place('ruins', 1, { cx: -27, cz: -13, min: 0, max: 3 }, 16);
    place('potion_a', 3, { cx: 26, cz: -13, min: 2, max: 6 }, 12); place('potion_b', 2, { cx: 26, cz: -13, min: 2, max: 6 }, 12); place('potion_c', 2, { cx: 26, cz: -13, min: 2, max: 6 }, 12);

    // Rock garden (SE): boulders, crags and bushes, the late-game larder.
    const rocks = { cx: 20, cz: -24, min: 0, max: 9 };
    place('crag_a', 1, rocks, 16); place('crag_b', 1, rocks, 16);
    place('boulder_a', 2, rocks, 12); place('boulder_c', 2, rocks, 12);
    place('rock_e', 3, rocks, 10); place('rock_f', 3, rocks, 10); place('rock_g', 2, rocks, 10);
    place('rock_a', 6, rocks, 8); place('rock_b', 6, rocks, 8); place('pebble_a', 8, rocks, 6); place('pebble_b', 8, rocks, 6);
    place('bush_e', 3, rocks, 10); place('bush_a', 4, rocks, 8); place('bush_c', 4, rocks, 8);
    place('tree_pine_orange_small', 2, rocks, 12); place('bench_decorated', 1, rocks, 10);

    // Forest ring just inside the fence, thinner on the farm side.
    const ringArea = { cx: 0, cz: 0, min: 29, max: 33 };
    place('tree_pine_orange_large', 4, ringArea, 24); place('tree_pine_yellow_large', 4, ringArea, 24);
    place('tree_pine_orange_medium', 5, ringArea, 24); place('tree_pine_yellow_medium', 4, ringArea, 24);
    place('tree_dead_large', 3, ringArea, 24); place('bare_tree_d', 3, ringArea, 24);

    // Bushes along the ring road verges and a few lanterns on the ring.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.13;
      tryPlace(rng.pick(['bush_a', 'bush_b', 'bush_c', 'bush_d']), Math.cos(a) * 21.5, Math.sin(a) * 21.5, rng.range(0, 6.28));
      if (k % 3 === 0) tryPlace('lantern_standing', Math.cos(a + 0.1) * 15.5, Math.sin(a + 0.1) * 15.5, 0);
    }
    // Loose early pickups everywhere, and hazards sprinkled along the ring (the candy lane).
    place('pumpkin_orange_small', 6, {}, 4); place('bone_B', 8, {}, 4); place('pebble_a', 10, {}, 3);
    place('candle_thin', 6, {}, 5); place('candle', 5, {}, 5); place('rock_c', 5, {}, 6);
    place('candy_bucket_B', 1, { cx: -20, cz: 22, min: 2, max: 8 }, 12);
    place('skull', 11, {}, 11); place('skull_candle', 2, {}, 11); place('ribcage', 1, {}, 14);
    this.topUpCandy(300, null);
  }

  /** Spawn candy until `target` free candies exist. Optionally keep away from the player. */
  topUpCandy(target: number, playerPos: THREE.Vector3 | null, maxPerCall = Infinity, animate = false): number {
    const candies = ITEMS.filter((d) => d.kind === 'candy' && d.tier === 0);
    const weights = candies.map((d) => [d, d.weight] as const);
    let n = this.count((e) => e.def.kind === 'candy' && e.def.tier === 0);
    let spawned = 0;
    while (n < target && spawned < maxPerCall) {
      const d = this.rng.weighted(weights);
      const r = collideRadiusOf(d);
      let s: { x: number; z: number } | null = null;
      if (!playerPos && this.pathNodes.length && this.rng.next() < 0.45) {
        const n = this.rng.pick(this.pathNodes);
        s = this.findSpot(r, { cx: n.x, cz: n.z, min: 0.5, max: 2.6, tries: 6, avoidX: 0, avoidZ: 0, avoidR: 1.5, avoidPaths: false });
      }
      if (!s) {
        s = playerPos
          ? this.findSpot(r, { cx: playerPos.x, cz: playerPos.z, min: 9, max: 30, tries: 12, avoidPaths: false })
          : this.findSpot(r, { avoidX: 0, avoidZ: 0, avoidR: 1.5, tries: 12, avoidPaths: false });
      }
      if (!s) break;
      const e = this.spawn(d, s.x, s.z, this.rng.range(0, Math.PI * 2), { animate: animate ? 'drop' : undefined });
      if (e.state === 'gone') break;
      n++;
      spawned++;
    }
    return spawned;
  }

  /** Drop a skull near (x,z) with the falling animation. Returns false if no room. */
  dropHazard(x: number, z: number, radius = 5, playerRadius = 0.55): boolean {
    const roll = this.rng.next();
    const d = ITEM_BY_NAME.get(roll < 0.5 ? 'skull' : roll < 0.8 ? 'skull_candle' : 'ribcage')!;
    // Hazards keep pace with the player so a strike is always possible.
    const grow = Math.max(1, playerRadius * 1.1);
    const s = this.findSpot(collideRadiusOf(d) * grow, { cx: x, cz: z, min: 0.5, max: radius, tries: 12, avoidPaths: false });
    if (!s) return false;
    const e = this.spawn(d, s.x, s.z, this.rng.range(0, Math.PI * 2), { animate: 'drop', scale: (d.scale ?? 1) * grow });
    return e.state !== 'gone';
  }

  /** Spawn a prop sized for the player. Returns false if nothing fitted. */
  regrowProp(playerPos: THREE.Vector3, minPick: number, maxPick: number): boolean {
    const cands = ITEMS.filter((d) => d.kind === 'prop' && d.weight > 0).filter((d) => {
      const pr = pickRadiusOf(d);
      return pr >= minPick && pr <= maxPick;
    });
    if (!cands.length) return false;
    const d = this.rng.weighted(cands.map((c) => [c, c.weight] as const));
    const r = collideRadiusOf(d);
    const s = this.findSpot(Math.max(r, pickRadiusOf(d) * 0.7), { cx: playerPos.x, cz: playerPos.z, min: 14, max: 34, tries: 20 });
    if (!s) return false;
    const e = this.spawn(d, s.x, s.z, this.rng.range(0, Math.PI * 2), { animate: 'rise' });
    return e.state !== 'gone';
  }

  modelInfo(name: string) {
    return model(name);
  }
}
