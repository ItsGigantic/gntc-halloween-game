import * as THREE from 'three';

let tex: THREE.CanvasTexture | null = null;
/** Soft radial gradient used for ground glows and ghost halos. */
export function glowTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const m = new THREE.Matrix4();
const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const p = new THREE.Vector3();
const sc = new THREE.Vector3();

/** Instanced flat glow discs on the ground, one colour per pool. */
export class GlowPool {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshBasicMaterial;
  private free: number[] = [];
  private used = 0;

  constructor(color: number, readonly capacity: number, parent: THREE.Object3D) {
    this.material = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.count = 0;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO);
    parent.add(this.mesh);
  }

  acquire(): number {
    const i = this.free.length ? this.free.pop()! : this.used++;
    if (i >= this.capacity) return -1;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    return i;
  }

  set(i: number, x: number, z: number, size: number, y = 0): void {
    if (i < 0) return;
    p.set(x, y + 0.05, z);
    sc.set(size, size, 1);
    m.compose(p, q, sc);
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  release(i: number): void {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(i);
  }
}

/** Dark contact shadow discs: same instanced quad, multiplied instead of added. */
export class ShadowPool extends GlowPool {
  constructor(capacity: number, parent: THREE.Object3D) {
    super(0x000015, capacity, parent);
    this.material.blending = THREE.NormalBlending;
    this.material.opacity = 0.5;
    this.mesh.renderOrder = -2;
  }
}

export function makeHalo(color: number, size: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}

/** Purple for skulls, green for ribcages. */
export function badColor(name: string): number {
  return name === 'ribcage' ? 0x5dff7a : 0xb86bff;
}
