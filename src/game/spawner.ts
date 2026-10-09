import * as THREE from 'three';
import { ITEM_BY_NAME } from './items';
import { CONFIG } from '../config';
import type { World } from './world';
import type { Player } from './player';

/** Keeps the arena stocked and ramps the skull pressure over time. */
export class Spawner {
  private candyTimer = 0;
  private propTimer = 0;
  private ghostTimer = 8;
  private hazardTimer = 25;
  private powerTimer = CONFIG.rules.powerFirstAt;
  elapsed = 0;

  constructor(private world: World, private player: Player) {}

  reset(): void {
    this.candyTimer = 0;
    this.propTimer = 0;
    this.ghostTimer = 8;
    this.hazardTimer = 25;
    this.powerTimer = CONFIG.rules.powerFirstAt;
    this.elapsed = 0;
  }

  /** Difficulty 0..1 over roughly the first four minutes. */
  get difficulty(): number {
    return Math.min(1, Math.max((this.elapsed - 20) / 200, this.player.radius / 6.5, 0));
  }

  update(dt: number): void {
    this.elapsed += dt;
    const p = this.player;

    this.candyTimer -= dt;
    if (this.candyTimer <= 0) {
      this.candyTimer = 0.3;
      const target = 280 + Math.round(p.radius * 20);
      this.world.topUpCandy(target, p.pos, 3, true);
    }

    this.propTimer -= dt;
    if (this.propTimer <= 0) {
      this.propTimer = 1.2;
      const minPick = p.radius * 0.6;
      const maxPick = p.radius * 1.15;
      const have = this.world.count((e) => e.def.kind === 'prop' && e.pickRadius >= minPick && e.pickRadius <= maxPick);
      const want = 20;
      if (have < want) this.world.regrowProp(p.pos, minPick, maxPick);
    }

    // A golden shield floats down now and then, a little way ahead, never two at once.
    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      this.powerTimer = 48 + Math.random() * 24;
      if (this.world.count((e) => e.def.kind === 'power') === 0) {
        const def = ITEM_BY_NAME.get('shield')!;
        const spot = this.world.findSpot(1.0, { cx: p.pos.x, cz: p.pos.z, min: 8, max: 15, avoidPaths: false, tries: 80 });
        if (spot) this.world.spawn(def, spot.x, spot.z, Math.random() * 6.28, { animate: 'drop' });
        else this.powerTimer = 4; // crowded here; try again shortly
      }
    }

    // Skulls keep dropping in ahead of the player so no lane stays safe for long.
    this.hazardTimer -= dt;
    if (this.hazardTimer <= 0) {
      this.hazardTimer = Math.max(6, 16 - this.difficulty * 8);
      const sp = Math.hypot(p.vel.x, p.vel.z);
      const dx = sp > 0.5 ? p.vel.x / sp : 1, dz = sp > 0.5 ? p.vel.z / sp : 0;
      const ahead = 9 + p.radius * 2;
      this.world.dropHazard(p.pos.x + dx * ahead, p.pos.z + dz * ahead, 4, p.radius);
    }
    // Static skull floor rises with difficulty (big players crush them, so top up).
    const skulls = this.world.count((e) => e.def.kind === 'skull');
    if (skulls < 12 + Math.round(this.difficulty * 12) && this.hazardTimer > 2) {
      this.world.dropHazard(p.pos.x + this.world.rng.range(-20, 20), p.pos.z + this.world.rng.range(-20, 20), 6, p.radius);
    }

    // Ghost skulls: start after 30s, more and faster over time.
    if (this.elapsed > 30) {
      const d = this.difficulty;
      const maxGhosts = this.elapsed < 70 ? 1 : 2 + Math.floor(d * 2);
      const interval = 14 - d * 7;
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0 && this.world.ghosts.length < maxGhosts) {
        this.ghostTimer = interval;
        const a = this.world.rng.range(0, Math.PI * 2);
        const dist = 24 + this.world.rng.range(0, 8);
        const x = THREE.MathUtils.clamp(p.pos.x + Math.cos(a) * dist, -this.world.half + 2, this.world.half - 2);
        const z = THREE.MathUtils.clamp(p.pos.z + Math.sin(a) * dist, -this.world.half + 2, this.world.half - 2);
        const scale = Math.max(1, p.radius * 1.1);
        const speed = Math.max(3, p.maxSpeed() * (0.36 + d * 0.18));
        this.world.spawnGhost(ITEM_BY_NAME.get('skull')!, x, z, scale, speed);
      }
      // Keep existing ghosts scaled to the player so they stay readable.
      for (const g of this.world.ghosts) {
        const target = Math.max(1, p.radius * 1.1);
        g.scale += (target - g.scale) * Math.min(1, dt * 2);
        g.obj!.scale.setScalar(g.scale);
        g.pickRadius = 0.5 * g.scale;
      }
    }
  }
}
