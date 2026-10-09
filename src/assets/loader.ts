import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface ModelInfo {
  name: string;
  template: THREE.Group;
  box: THREE.Box3;      // local-space bounds of the raw model
  size: THREE.Vector3;  // box dimensions
  radius: number;       // bounding-sphere radius from box centre
  center: THREE.Vector3;
}

const registry = new Map<string, ModelInfo>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

function configure(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const key = mat.map?.uuid ?? mat.uuid;
  const existing = materials.get(key);
  if (existing) return existing;
  const tex = mat.map;
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
  }
  mat.roughness = 0.85;
  mat.metalness = 0;
  materials.set(key, mat);
  if (!sharedMaterial) sharedMaterial = mat; // the Halloween palette loads first
  return mat;
}

export async function loadModels(url: string): Promise<void> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  for (const child of gltf.scene.children) {
    const group = child as THREE.Group;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = configure(m.material as THREE.MeshStandardMaterial);
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    registry.set(group.name, {
      name: group.name,
      template: group,
      box,
      size,
      center,
      radius: size.length() / 2,
    });
  }
}

/** The material a model uses (its first mesh). */
export function materialOf(name: string): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | null = null;
  model(name).template.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!found && m.isMesh) found = m.material as THREE.MeshStandardMaterial;
  });
  return found ?? material();
}

export function model(name: string): ModelInfo {
  const m = registry.get(name);
  if (!m) throw new Error(`Unknown model: ${name}`);
  return m;
}

export function hasModel(name: string): boolean {
  return registry.has(name);
}

/** Clone a model as a fresh Group (geometry + material are shared). */
export function cloneModel(name: string): THREE.Group {
  const info = model(name);
  const g = info.template.clone(true);
  g.position.set(0, 0, 0);
  g.rotation.set(0, 0, 0);
  g.scale.set(1, 1, 1);
  return g;
}

export function material(): THREE.MeshStandardMaterial {
  if (!sharedMaterial) throw new Error('Models not loaded');
  return sharedMaterial;
}

export function modelNames(): string[] {
  return [...registry.keys()];
}
