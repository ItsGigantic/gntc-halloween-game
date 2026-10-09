import * as THREE from 'three';
import { model } from '../assets/loader';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();

/** One InstancedMesh per sub-mesh of a model, addressed by a shared instance index. */
export class InstancedPool {
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly local: THREE.Matrix4[] = [];
  private free: number[] = [];
  private used = 0;

  constructor(readonly name: string, readonly capacity: number, scene: THREE.Object3D, materialOverride?: THREE.Material, shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true }) {
    const info = model(name);
    info.template.updateMatrixWorld(true);
    info.template.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const inst = new THREE.InstancedMesh(m.geometry, materialOverride ?? m.material, capacity);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      inst.castShadow = shadows.cast;
      inst.receiveShadow = shadows.receive;
      inst.count = 0;
      for (let i = 0; i < capacity; i++) inst.setMatrixAt(i, ZERO);
      // Matrix of this sub-mesh relative to the model group.
      const rel = new THREE.Matrix4().copy(info.template.matrixWorld).invert().multiply(m.matrixWorld);
      this.meshes.push(inst);
      this.local.push(rel);
      scene.add(inst);
    });
  }

  acquire(): number {
    const i = this.free.length ? this.free.pop()! : this.used++;
    if (i >= this.capacity) throw new Error(`Pool ${this.name} exhausted (${this.capacity})`);
    for (const m of this.meshes) m.count = Math.max(m.count, i + 1);
    return i;
  }

  available(): number {
    return this.capacity - this.used + this.free.length;
  }

  set(index: number, matrix: THREE.Matrix4): void {
    for (let i = 0; i < this.meshes.length; i++) {
      tmpM.multiplyMatrices(matrix, this.local[i]);
      this.meshes[i].setMatrixAt(index, tmpM);
      this.meshes[i].instanceMatrix.needsUpdate = true;
    }
  }

  /** Per-instance tint (requires the material colour to be white for a faithful result). */
  setColor(index: number, color: THREE.Color): void {
    for (const m of this.meshes) {
      m.setColorAt(index, color);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  release(index: number): void {
    for (const m of this.meshes) {
      m.setMatrixAt(index, ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
    this.free.push(index);
  }
}
