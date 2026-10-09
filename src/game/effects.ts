import * as THREE from 'three';
import { glowTexture } from './glow';

interface Pop {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
}

/** DOM score pops projected from world space, and a tiny particle burst system. */
export class Effects {
  private pops: Pop[] = [];
  private free: HTMLDivElement[] = [];
  private readonly v = new THREE.Vector3();
  readonly particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pCount = 0;
  private readonly P_MAX = 400;
  /** Suppress text pops (title screen / showcase). */
  quiet = false;

  constructor(private ui: HTMLElement, private camera: THREE.Camera) {
    this.pPos = new Float32Array(this.P_MAX * 3);
    this.pVel = new Float32Array(this.P_MAX * 3);
    this.pLife = new Float32Array(this.P_MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    const colors = new Float32Array(this.P_MAX * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Small round confetti: a soft disc sprite, sized in world units so it stays modest up close.
    const mat = new THREE.PointsMaterial({ size: 0.075, map: glowTexture(), alphaTest: 0.35, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    geo.setDrawRange(0, 0);
  }

  /** Expanding ring at a world position. */
  ring(worldPos: THREE.Vector3, cls = ''): void {
    if (this.quiet) return;
    const el = document.createElement('div');
    el.className = `ring ${cls}`;
    this.ui.appendChild(el);
    this.v.copy(worldPos).project(this.camera);
    const x = (this.v.x * 0.5 + 0.5) * this.ui.clientWidth;
    const y = (-this.v.y * 0.5 + 0.5) * this.ui.clientHeight;
    el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  pop(worldPos: THREE.Vector3, text: string, cls = ''): void {
    if (this.quiet) return;
    if (this.pops.length > 40) this.recycle(this.pops.shift()!);
    const el = this.free.pop() ?? document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    // Bigger numbers, bigger type: +10 is 30px, +100 about 40px, +1000 about 50px.
    const n = /^\+?([\d,]+)/.exec(text);
    const value = n ? Number(n[1].replace(/,/g, '')) : 0;
    el.style.fontSize = cls === 'ms' || cls === 'bad' ? '' : `${16 * Math.round(Math.min(64, 24 + Math.log10(Math.max(10, value)) * 12) / 16)}px`;
    this.ui.appendChild(el);
    const pos = worldPos.clone();
    pos.x += (Math.random() - 0.5) * 0.6; // stagger so rapid pickups don't stack exactly
    this.pops.push({ el, pos, t: 0, life: cls === 'big' ? 2.1 : cls === 'bad' ? 2.0 : 1.6 });
  }

  burst(at: THREE.Vector3, n: number, color: THREE.Color, speed = 4, up = 4): void {
    const col = this.particles.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      const i = this.pCount < this.P_MAX ? this.pCount++ : Math.floor(Math.random() * this.P_MAX);
      this.pPos[i * 3] = at.x;
      this.pPos[i * 3 + 1] = at.y;
      this.pPos[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pVel[i * 3] = Math.cos(a) * s;
      this.pVel[i * 3 + 1] = up * (0.5 + Math.random());
      this.pVel[i * 3 + 2] = Math.sin(a) * s;
      this.pLife[i] = 0.5 + Math.random() * 0.4;
      col.setXYZ(i, color.r, color.g, color.b);
    }
    col.needsUpdate = true;
  }

  private recycle(p: Pop): void {
    p.el.remove();
    this.free.push(p.el);
  }

  update(dt: number): void {
    const w = this.ui.clientWidth;
    const h = this.ui.clientHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.recycle(p);
        this.pops.splice(i, 1);
        continue;
      }
      const k = p.t / p.life;
      // Pop in with an overshoot, hang, then drift up and fade.
      const a = Math.min(1, p.t / 0.16);
      const back = 1 + 2.4 * Math.pow(a - 1, 3) + 1.4 * Math.pow(a - 1, 2); // easeOutBack-ish, ends at 1
      const sc = 0.4 + 0.75 * back;
      this.v.copy(p.pos);
      this.v.y += (1 - Math.pow(1 - k, 2)) * 1.1;
      this.v.project(this.camera);
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const tilt = Math.sin(p.t * 9) * 4 * (1 - k);
      p.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) rotate(${tilt}deg) scale(${sc})`;
      p.el.style.opacity = String(k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25);
      p.el.style.display = this.v.z > 1 ? 'none' : '';
    }

    // Particles.
    let alive = 0;
    for (let i = 0; i < this.pCount; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 14 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -100;
      else alive++;
    }
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.needsUpdate = true;
    this.particles.geometry.setDrawRange(0, alive ? this.pCount : 0);
  }

  clear(): void {
    for (const p of this.pops) this.recycle(p);
    this.pops = [];
    for (let i = 0; i < this.P_MAX; i++) {
      this.pLife[i] = 0;
      this.pPos[i * 3 + 1] = -100;
    }
    this.pCount = 0;
  }
}
