import * as THREE from 'three';
import { model } from '../assets/loader';
import type { World, Entity } from './world';

const LIT = /candle|lantern|jackolantern|shrine_candles|plaque_candles/;

/**
 * A fixed budget of point lights that jump to the nearest lit props (lanterns, candles,
 * jack-o-lanterns). Real falloff on the ground and neighbours, at a flat cost of four lights.
 */
export class LocalLights {
  readonly lights: THREE.PointLight[] = [];
  private owners: (Entity | null)[] = [];
  private targets: number[] = [];
  private retime = 0;
  private scratch: Entity[] = [];

  constructor(scene: THREE.Scene, readonly budget = 4) {
    for (let i = 0; i < budget; i++) {
      const l = new THREE.PointLight(0xffa24a, 0, 16, 1.6);
      scene.add(l);
      this.lights.push(l);
      this.owners.push(null);
      this.targets.push(0);
    }
  }

  private static intensityFor(name: string): number {
    if (name.startsWith('post_')) return 34;
    if (name.includes('lantern')) return 24;
    if (name.includes('jackolantern')) return 16;
    if (name.includes('shrine') || name.includes('plaque')) return 14;
    if (name.includes('triple')) return 11;
    return 7; // single candles
  }

  update(world: World, px: number, pz: number, dt: number): void {
    this.retime -= dt;
    if (this.retime <= 0) {
      this.retime = 0.25;
      const near = world.hash.query(px, pz, 26, this.scratch);
      const cands: { e: Entity; d: number }[] = [];
      for (const e of near) {
        if (e.state !== 'free' || !LIT.test(e.def.name)) continue;
        cands.push({ e, d: Math.hypot(e.x - px, e.z - pz) });
      }
      cands.sort((a, b) => a.d - b.d);
      const chosen = cands.slice(0, this.budget).map((c) => c.e);
      // Keep lights that still own a chosen entity; reassign the rest.
      const free: number[] = [];
      for (let i = 0; i < this.budget; i++) {
        const o = this.owners[i];
        if (o && chosen.includes(o) && o.state === 'free') continue;
        this.owners[i] = null;
        this.targets[i] = 0;
        free.push(i);
      }
      for (const e of chosen) {
        if (this.owners.includes(e)) continue;
        const i = free.shift();
        if (i === undefined) break;
        this.owners[i] = e;
        const info = model(e.def.name);
        const h = info.box.max.y * e.scale * 0.85;
        this.lights[i].position.set(e.x, e.y + h, e.z);
        this.lights[i].distance = 12 + Math.min(10, info.box.max.y * e.scale * 1.8);
        this.targets[i] = LocalLights.intensityFor(e.def.name);
      }
    }
    for (let i = 0; i < this.budget; i++) {
      const l = this.lights[i];
      const flicker = this.owners[i] && /candle|jackolantern/.test(this.owners[i]!.def.name) ? 0.9 + 0.1 * Math.sin(performance.now() * 0.013 + i * 2) : 1;
      l.intensity += (this.targets[i] * flicker - l.intensity) * Math.min(1, dt * 6);
    }
  }

  reset(): void {
    for (let i = 0; i < this.budget; i++) {
      this.owners[i] = null;
      this.targets[i] = 0;
      this.lights[i].intensity = 0;
    }
  }
}
