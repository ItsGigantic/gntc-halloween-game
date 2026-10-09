import * as THREE from 'three';

/**
 * PS1-style rendering for the social scenes (?psx=1). Patches every lit mesh material in a scene with
 * the console's signature artefacts:
 * - vertex snapping: positions snap to whole pixels of the low render resolution (the PS1 had no
 *   sub-pixel precision), so geometry jitters as things move;
 * - affine texture mapping: textures interpolate linearly in screen space with no perspective
 *   correction, so they swim and shear across large polygons;
 * - point-sampled textures with no mipmaps.
 * Colour depth (15-bit with the PS1's 4x4 dither) is applied in the grade; the low resolution, no
 * anti-aliasing and blob shadows are set up by the scene.
 */
export function applyPsx(root: THREE.Object3D, width: number, height: number): void {
  const res = { value: new THREE.Vector2(width, height) };
  const done = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.Sprite).isSprite) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (done.has(m) || !(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial || m instanceof THREE.MeshBasicMaterial)) continue;
      done.add(m);
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) textures.add(map);
      const prev = m.onBeforeCompile;
      const prevKey = m.customProgramCacheKey();
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        sh.uniforms.uPsxRes = res;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec2 uPsxRes;\nvarying vec3 vPsxAff;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            {
              // Snap to the pixel grid of the low-res framebuffer.
              vec4 p = gl_Position;
              vec2 hres = uPsxRes * 0.5;
              p.xy = floor(p.xy / p.w * hres + 0.5) / hres * p.w;
              gl_Position = p;
            }
            #ifdef USE_MAP
              // Affine mapping: interpolate uv*w and w perspective-correctly; their ratio is screen-linear.
              vPsxAff = vec3(vMapUv * gl_Position.w, gl_Position.w);
            #endif`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vPsxAff;')
          .replace('#include <map_fragment>', `#ifdef USE_MAP
              diffuseColor *= texture2D(map, vPsxAff.xy / vPsxAff.z);
            #endif`);
      };
      m.customProgramCacheKey = () => `${prevKey}-psx`;
      m.needsUpdate = true;
    }
  });
  for (const t of textures) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.anisotropy = 1;
    t.needsUpdate = true;
  }
}
