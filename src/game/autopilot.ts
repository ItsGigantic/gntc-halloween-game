import * as THREE from 'three';
import type { World, Entity } from './world';
import type { Player } from './player';
import { CONFIG } from '../config';

/** Steers toward the juiciest reachable item while avoiding skulls. Used by the title screen and showcase mode. */
export class Autopilot {
  private target: Entity | null = null;
  private retarget = 0;
  private near: Entity[] = [];
  private stuckT = 0;
  private escape = new THREE.Vector3();
  private escapeT = 0;
  private banned = new Map<Entity, number>();
  private clock = 0;
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(private world: World, private player: Player) {}

  /** Returns camera-relative move (x right, y forward). */
  steer(dt: number, fwd: THREE.Vector3, right: THREE.Vector3, out: { x: number; y: number }): void {
    const p = this.player;
    this.retarget -= dt;
    this.clock += dt;
    // Stuck detection: low speed for a while -> give up on that target for a while and wander off.
    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.stuckT = speed < 1.2 ? this.stuckT + dt : 0;
    if (this.stuckT > 0.7) {
      this.stuckT = 0;
      this.escapeT = 1.0;
      if (this.target) this.banned.set(this.target, this.clock + 8);
      // Back away from the direction we were pushing.
      const a = Math.atan2(this.dir.z, this.dir.x) + Math.PI + (Math.random() - 0.5) * 1.5;
      this.escape.set(Math.cos(a), 0, Math.sin(a));
      this.target = null;
      this.retarget = 1.0;
    }
    // Ghosts nearby: run first, eat later.
    let fleeX = 0, fleeZ = 0, fleeing = false;
    for (const g of this.world.ghosts) {
      const gx = p.pos.x - g.x, gz = p.pos.z - g.z;
      const gd = Math.hypot(gx, gz);
      if (gd < 7 + p.radius * 2) {
        fleeX += gx / gd; fleeZ += gz / gd; fleeing = true;
      }
    }
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      out.x = this.escape.dot(right);
      out.y = this.escape.dot(fwd);
      return;
    }
    if (!this.target || this.target.state !== 'free' || this.retarget <= 0) {
      this.retarget = 0.6;
      this.target = this.pick();
    }
    if (fleeing) this.dir.set(fleeX, 0, fleeZ);
    else if (this.target) this.dir.set(this.target.x - p.pos.x, 0, this.target.z - p.pos.z);
    else this.dir.set(-p.pos.x, 0, -p.pos.z);
    if (this.dir.lengthSq() < 0.01) this.dir.set(1, 0, 0);
    this.dir.normalize();

    // Repel from skulls and ghosts.
    const near = this.world.hash.query(p.pos.x, p.pos.z, p.radius + 7, this.near);
    for (const e of near) {
      if (e.state !== 'free' || e.def.kind === 'scenery') continue;
      if (e.def.kind === 'skull') {
        if (p.radius <= e.pickRadius * CONFIG.rules.crushRatio) this.repel(e.x, e.z, p.radius + e.pickRadius * 1.6 + 2.5);
      } else if (e.def.kind !== 'power' && e.pickRadius > p.radius * CONFIG.rules.pickRatio) {
        // Too big to eat: steer around it.
        this.repel(e.x, e.z, p.radius + e.collideRadius + 1.5);
      }
    }
    for (const g of this.world.ghosts) this.repel(g.x, g.z, p.radius + g.pickRadius + 3.5);
    // Stay away from the fence.
    const h = this.world.half - 3;
    if (p.pos.x > h) this.dir.x -= 1; if (p.pos.x < -h) this.dir.x += 1;
    if (p.pos.z > h) this.dir.z -= 1; if (p.pos.z < -h) this.dir.z += 1;
    this.dir.normalize();
    out.x = this.dir.dot(right);
    out.y = this.dir.dot(fwd);
  }

  /** True if an uneatable prop sits on the straight line to (tx,tz). */
  private blockedLine(x: number, z: number, tx: number, tz: number, r: number): boolean {
    const dx = tx - x, dz = tz - z;
    const len = Math.hypot(dx, dz) || 1;
    const near = this.world.hash.query((x + tx) / 2, (z + tz) / 2, len / 2 + 3, this.near);
    for (const e of near) {
      if (e.state !== 'free' || e.def.kind === 'scenery') continue;
      const skull = e.def.kind === 'skull' && r <= e.pickRadius * CONFIG.rules.crushRatio;
      if (!skull && e.pickRadius <= r * CONFIG.rules.pickRatio) continue;
      if (e.def.kind === 'skull' && !skull) continue;
      const t = ((e.x - x) * dx + (e.z - z) * dz) / (len * len);
      if (t <= 0.05 || t >= 0.95) continue;
      const px = x + dx * t, pz = z + dz * t;
      // A live skull on the line is a no-go lane, with a wider berth than a mere blocker.
      const berth = skull ? e.pickRadius * 1.35 + r + 1.2 : e.collideRadius + r + 0.3;
      if (Math.hypot(e.x - px, e.z - pz) < berth) return true;
    }
    return false;
  }

  private repel(x: number, z: number, range: number): void {
    const p = this.player;
    this.tmp.set(p.pos.x - x, 0, p.pos.z - z);
    const d = this.tmp.length();
    if (d < range && d > 1e-3) this.dir.addScaledVector(this.tmp.normalize(), (range - d) / range * 3.2);
  }

  private pick(): Entity | null {
    const p = this.player;
    let best: Entity | null = null;
    let bestScore = -Infinity;
    const ratio = CONFIG.rules.pickRatio;
    for (const [e, until] of this.banned) if (until < this.clock) this.banned.delete(e);
    for (const e of this.world.entities) {
      if (e.state !== 'free' || e.def.kind === 'scenery' || e.def.kind === 'skull') continue;
      const power = e.def.kind === 'power';
      if (!power && e.pickRadius > p.radius * ratio) continue;
      if (this.banned.has(e)) continue;
      const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
      if (d > 26 || this.blockedLine(p.pos.x, p.pos.z, e.x, e.z, p.radius)) continue;
      // Prefer close, valuable things; bigger things matter more as we grow. The shield is worth a detour.
      const s = (power ? 4000 : e.def.points + e.volume * 40) / (1 + d * 0.9);
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  }
}
