import * as THREE from 'three';
import { CONFIG } from '../config';
import { ITEM_BY_NAME, MILESTONES, milestoneFor } from './items';
import type { World, Entity } from './world';
import type { Player } from './player';
import type { Effects } from './effects';
import type { FollowCamera } from './camera';
import type { Spawner } from './spawner';

export type GameState = 'idle' | 'playing' | 'dead';

export interface RunStats {
  score: number;
  radius: number;
  candies: number;
  items: number;
  time: number;
  milestone: string;
  maxMultiplier: number;
  cause: string;
}

export interface HudState {
  score: number;
  multiplier: number;
  comboFrac: number;
  lives: number;
  radius: number;
  milestone: string;
  time: number;
  /** 0..1 of the golden shield's remaining time, 0 when not charged. */
  charge: number;
}

export interface GameHooks {
  onDeath(stats: RunStats): void;
  onHud(h: HudState): void;
  onMilestone(label: string): void;
  onPickup(kind: string, multiplier: number, name: string, points: number): void;
  onStrike(livesLeft: number): void;
  onComboUp(multiplier: number): void;
  /** Picked up the golden shield (and whether a skull was restored). */
  onPower(restored: boolean): void;
  /** Freeze the world briefly (seconds, time scale). */
  onHitStop(seconds: number, scale: number): void;
}

const MULT_STEPS = [0, 4, 10, 18, 30, 45, 65, 90];
const PINK = new THREE.Color(0xff6ea6);
const ORANGE = new THREE.Color(0xffb347);
const GOLD = new THREE.Color(0xffd36b);
const CYAN = new THREE.Color(0xb86bff);
const RED = new THREE.Color(0xff4d4d);

export class Game {
  state: GameState = 'idle';
  score = 0;
  lives = CONFIG.rules.lives;
  combo = 0;
  comboTimer = 0;
  multiplier = 1;
  maxMultiplier = 1;
  invuln = 0;
  /** Golden shield seconds left. */
  charge = 0;
  /** Highest milestone index celebrated this run. */
  private bestMilestone = 0;
  private sparkT = 0;
  private readonly sparkCol = new THREE.Color();
  candies = 0;
  items = 0;
  time = 0;
  milestone = milestoneFor(CONFIG.player.startRadius);
  private near: Entity[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private hud: HudState = { score: 0, multiplier: 1, comboFrac: 0, lives: 3, radius: 0.5, milestone: '', time: 0, charge: 0 };

  constructor(
    private player: Player,
    private world: World,
    private effects: Effects,
    private camera: FollowCamera,
    private spawner: Spawner,
    private hooks: GameHooks,
  ) {}

  start(): void {
    this.state = 'playing';
    this.score = 0;
    this.lives = CONFIG.rules.lives;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.maxMultiplier = 1;
    this.invuln = 0;
    this.charge = 0;
    this.bestMilestone = 0;
    this.candies = 0;
    this.items = 0;
    this.time = 0;
    this.milestone = milestoneFor(this.player.radius);
    this.spawner.reset();
  }

  update(dt: number): void {
    if (this.state !== 'playing') return;
    this.time += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.charge > 0) this.charge = Math.max(0, this.charge - dt);
    this.player.setCharged(this.charge > 0 ? this.charge / CONFIG.rules.powerSeconds : 0);
    if (this.charge > 0) {
      // Star trail: a steady spray of coloured sparks shed behind the ball.
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.045;
        const p = this.player;
        this.sparkCol.setHSL((this.time * 1.5) % 1, 1, 0.65);
        this.tmp.set(p.pos.x - p.vel.x * 0.06, p.pos.y, p.pos.z - p.vel.z * 0.06);
        this.effects.burst(this.tmp, 2, this.sparkCol, 1.2 + p.radius, 2.5 + p.radius);
      }
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.decayCombo();
    }
    this.collide();
    this.spawner.update(dt);
    this.world.updateHints(this.player.pos.x, this.player.pos.z, this.player.radius, CONFIG.rules.pickRatio);
    // Blink while invulnerable.
    this.player.roll.visible = this.invuln <= 0 || Math.floor(this.invuln * 12) % 2 === 0;

    const h = this.hud;
    h.score = this.score;
    h.multiplier = this.multiplier;
    h.comboFrac = this.comboTimer / CONFIG.rules.comboWindow;
    h.lives = this.lives;
    h.radius = this.player.radius;
    h.milestone = this.milestone;
    h.charge = this.charge > 0 ? this.charge / CONFIG.rules.powerSeconds : 0;
    h.time = this.time;
    this.hooks.onHud(h);
  }

  /** A lapse costs one multiplier step, not the whole streak. */
  private decayCombo(): void {
    if (this.multiplier <= 1) {
      this.resetCombo();
      return;
    }
    this.multiplier -= 1;
    this.combo = MULT_STEPS[this.multiplier - 1];
    this.comboTimer = CONFIG.rules.comboWindow;
  }

  private resetCombo(): void {
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
  }

  private collide(): void {
    const p = this.player;
    const w = this.world;
    const near = w.hash.query(p.pos.x, p.pos.z, p.radius + 6, this.near);
    const ratio = CONFIG.rules.pickRatio;
    const clearance = p.clearance;
    for (const e of near) {
      if (e.state !== 'free') continue;
      const dx = p.pos.x - e.x;
      const dz = p.pos.z - e.z;
      const d = Math.hypot(dx, dz);
      // Airborne: anything shorter than the ball's underside is cleared (hazards included).
      if (clearance > 0.05) {
        const top = this.world.modelInfo(e.def.name).size.y * e.scale;
        if (top < clearance) continue;
      }
      if (e.def.kind === 'power') {
        if (d < p.radius + e.pickRadius * 1.1) this.takePower(e);
        continue;
      }
      if (e.def.kind === 'skull') {
        // Hazards stay dangerous until the ball is many times their size; the hit zone matches the glow ring.
        const hitDist = p.radius + e.pickRadius * 1.35;
        if (p.radius > e.pickRadius * CONFIG.rules.crushRatio || this.charge > 0) {
          // Shielded: anything inside the hit zone gets eaten instead of hurting.
          if (d < (this.charge > 0 ? hitDist : p.radius + e.pickRadius * 0.9)) this.pickup(e, 25);
        } else if (d < hitDist) {
          // While invulnerable the ball rolls straight through, so a knockback never pins you
          // against the same skull for a second hit the moment the flashing stops.
          if (this.invuln > 0) continue;
          this.pushOut(dx, dz, d, hitDist);
          this.strike('skull', e.x, e.z);
        } else if (d < hitDist + 0.9 && this.time - e.t > 4 && Math.hypot(p.vel.x, p.vel.z) > 4) {
          // Skimming past a skull at speed: a small nerve bonus, once per skull every few seconds.
          e.t = this.time;
          const bonus = 15 * this.multiplier;
          this.score += bonus;
          this.effects.pop(this.tmp.set(e.x, e.y + 0.4, e.z), `close call +${bonus}`, 'ms');
        }
        continue;
      }
      if (e.pickRadius <= p.radius * ratio) {
        if (d < p.radius + e.pickRadius * 0.7) this.pickup(e);
      } else if (d < p.radius + e.collideRadius) {
        this.pushOut(dx, dz, d, p.radius + e.collideRadius);
      }
    }
    for (let i = w.ghosts.length - 1; i >= 0; i--) {
      const g = w.ghosts[i];
      const d = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
      // Ghosts float at ball height, so a hop only clears them at its peak.
      if (clearance > g.pickRadius * 2 + 0.4) continue;
      if (d < p.radius + g.pickRadius * 1.2) {
        this.tmp.set(g.x, g.y, g.z);
        this.effects.burst(this.tmp, 24, CYAN, 5, 3);
        w.removeGhost(g);
        if (this.charge > 0) {
          // Shielded: the ghost bursts and pays out instead.
          const bonus = 50 * this.multiplier;
          this.score += bonus;
          this.effects.pop(this.tmp, `+${bonus}`, 'big');
          continue;
        }
        this.strike('ghost', g.x, g.z);
      }
    }
    // Arena bounds.
    const half = w.half - p.radius * 0.6;
    if (Math.abs(p.pos.x) > half) { p.pos.x = Math.sign(p.pos.x) * half; p.vel.x *= -0.25; }
    if (Math.abs(p.pos.z) > half) { p.pos.z = Math.sign(p.pos.z) * half; p.vel.z *= -0.25; }
  }

  private pushOut(dx: number, dz: number, d: number, minDist: number): void {
    const p = this.player;
    if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
    const nx = dx / d;
    const nz = dz / d;
    const overlap = minDist - d;
    p.pos.x += nx * overlap;
    p.pos.z += nz * overlap;
    const dot = p.vel.x * nx + p.vel.z * nz;
    if (dot < 0) {
      p.vel.x -= nx * dot * 1.25;
      p.vel.z -= nz * dot * 1.25;
    }
  }

  private pickup(e: Entity, pointsOverride?: number, label?: string): void {
    const p = this.player;
    const pos = this.tmp.set(e.x, e.y, e.z);
    const kind = e.def.kind;
    const pts = pointsOverride ?? e.def.points;
    const obj = this.world.detach(e);
    const before = p.radius;
    // Growth: gain is a fraction of the ball's own volume so small things matter early
    // and big things give a satisfying but bounded jump later.
    const ballVol = p.radius ** 3;
    const x = e.volume / ballVol;
    const gain = ballVol * Math.min(CONFIG.rules.maxGainFrac, CONFIG.rules.gainSlope * x);
    p.attach(obj, pos, e.pickRadius, gain, pts, kind, e.def.name);
    this.items++;
    if (kind === 'candy') this.candies++;

    this.combo++;
    this.comboTimer = CONFIG.rules.comboWindow;
    let m = 1;
    for (let i = 0; i < MULT_STEPS.length; i++) if (this.combo >= MULT_STEPS[i]) m = i + 1;
    m = Math.min(CONFIG.rules.comboMax, m);
    const gained = pts * m;
    this.score += gained;
    if (m > this.multiplier) {
      this.multiplier = m;
      this.maxMultiplier = Math.max(this.maxMultiplier, m);
      this.effects.pop(pos, `×${m}`, 'big');
      this.effects.ring(p.pos, 'orange');
      this.effects.burst(p.pos, 18, ORANGE, 4 + p.radius * 2, 5);
      this.hooks.onComboUp(m);
    }
    if (label) this.effects.pop(pos, label, 'big');
    else if (gained > 0) this.effects.pop(pos, `+${gained}`, pts >= 100 ? 'big' : '');
    if (pts >= 100 || e.pickRadius > p.radius * 0.8) {
      // Big bite: a camera punch and a frame of hit-stop sell the weight.
      this.camera.kick(pts >= 300 ? 6 : 3.5);
      this.hooks.onHitStop(pts >= 300 ? 0.09 : 0.05, 0.2);
    }
    this.effects.ring(pos, kind === 'candy' ? 'pink' : kind === 'skull' ? 'cyan' : 'orange');
    this.effects.burst(pos, kind === 'candy' ? 8 : 12, kind === 'candy' ? PINK : ORANGE, 3 + e.pickRadius * 2, 3 + e.pickRadius);
    this.hooks.onPickup(kind, m, e.def.name, gained);

    if (p.radius > before) this.world.flashNewlyEdible(before * CONFIG.rules.pickRatio, p.radius * CONFIG.rules.pickRatio, p.pos.x, p.pos.z);
    const ms = milestoneFor(p.radius);
    if (ms !== this.milestone && p.radius > before) {
      this.milestone = ms;
      // Celebrate each milestone once per run: after a strike sheds you below a threshold,
      // crossing it again is a recovery, not news.
      const idx = MILESTONES.findIndex((m) => m[1] === ms);
      if (idx <= this.bestMilestone) return;
      this.bestMilestone = idx;
      // Celebration: the ball pulses and swallows its cargo, gold bursts out, the camera breathes.
      p.powerUp();
      const at = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
      this.effects.ring(at, 'orange');
      this.effects.burst(at, 36, GOLD, 5 + p.radius * 2.5, 5 + p.radius * 1.5);
      this.effects.burst(at, 18, PINK, 3 + p.radius * 2, 4 + p.radius);
      this.camera.kick(7);
      this.camera.shake(0.25, 0.3);
      this.hooks.onHitStop(0.1, 0.15);
      this.hooks.onMilestone(ms);
    }
  }

  /** The golden shield: a stretch of invincibility, one skull back, and skulls become snacks. */
  private takePower(e: Entity): void {
    const p = this.player;
    this.world.remove(e);
    const restored = this.lives < CONFIG.rules.lives;
    if (restored) this.lives++;
    this.charge = CONFIG.rules.powerSeconds;
    this.invuln = 0;
    const bonus = e.def.points * this.multiplier;
    this.score += bonus;
    const at = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
    this.effects.pop(at, `+${bonus}`, 'big');
    this.effects.ring(at, 'orange');
    this.effects.burst(at, 40, GOLD, 6 + p.radius * 2, 6 + p.radius);
    this.camera.kick(6);
    this.hooks.onHitStop(0.08, 0.15);
    this.hooks.onPower(restored);
  }

  private strike(cause: string, fromX = NaN, fromZ = NaN): void {
    if (this.invuln > 0 || this.charge > 0) return;
    const p = this.player;
    // Knockback: shove the ball away from whatever hit it.
    if (!Number.isNaN(fromX)) {
      let kx = p.pos.x - fromX, kz = p.pos.z - fromZ;
      const kl = Math.hypot(kx, kz) || 1;
      kx /= kl; kz /= kl;
      const push = 9 + p.radius * 2;
      p.vel.x = kx * push;
      p.vel.z = kz * push;
    }
    this.effects.pop(p.pos, '-1', 'bad');
    this.lives--;
    this.invuln = CONFIG.rules.invulnSeconds;
    this.resetCombo();
    this.camera.shake(0.5, 0.4);
    this.effects.burst(p.pos, 30, RED, 6, 6);
    // Shed some of the load.
    const shed = p.shed(CONFIG.rules.shedFraction);
    for (const a of shed) {
      const def = ITEM_BY_NAME.get(a.name);
      if (!def) continue;
      const wp = p.attachedWorldPos(a, this.tmp2).clone();
      const dir = this.tmp.copy(wp).sub(p.pos).setY(0).normalize();
      if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      const vel = dir.multiplyScalar(5 + Math.random() * 5);
      vel.y = 6 + Math.random() * 5;
      const scale = a.obj.scale.x;
      a.obj.rotation.set(0, Math.random() * 6.28, 0);
      this.world.scatter(a.obj, def, wp, vel, scale);
    }
    this.hooks.onStrike(this.lives);
    if (this.lives <= 0) this.die(cause);
  }

  private die(cause: string): void {
    this.state = 'dead';
    this.player.roll.visible = true;
    this.hooks.onDeath({
      score: this.score,
      radius: this.player.radius,
      candies: this.candies,
      items: this.items,
      time: this.time,
      milestone: this.milestone,
      maxMultiplier: this.maxMultiplier,
      cause,
    });
  }
}
