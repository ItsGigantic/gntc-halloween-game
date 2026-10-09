import * as THREE from 'three';

export interface PumpkinOptions {
  /** Half the width, in world units. */
  radius: number;
  /** Number of ribs around the body. */
  ribs?: number;
  /** Height as a fraction of width. */
  squash?: number;
  /** Groove depth as a fraction of radius. */
  groove?: number;
  seed?: number;
  /** Sphere segments [around, up]; low values give a PS1-era faceted look. */
  segments?: [number, number];
}

/**
 * A hero pumpkin built for close-ups: evenly rounded ribs with soft grooves, a dimpled top and
 * base, a curved and ridged stem, and colour painted into the vertices (deeper grooves, a warmer
 * shoulder, a darker base and faint vertical streaks) so it reads as a pumpkin under any light.
 * The group's origin is the bottom centre.
 */
export function makePumpkin(opts: PumpkinOptions): THREE.Group {
  const R = opts.radius;
  const N = opts.ribs ?? 10;
  const squash = opts.squash ?? 0.74;
  const depth = opts.groove ?? 0.11;
  let s = opts.seed ?? 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Small per-rib variation so it doesn't look turned on a lathe.
  const ribScale = Array.from({ length: N }, () => 0.96 + rnd() * 0.08);

  const group = new THREE.Group();

  // --- Body: a sphere pushed into lobes.
  const [segU, segV] = opts.segments ?? [160, 96];
  const body = new THREE.SphereGeometry(1, segU, segV);
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0xe8781e), grooveC = new THREE.Color(0xa8441a), shoulder = new THREE.Color(0xf6a640);
  const bottomC = new THREE.Color(0xb8501c), crown = new THREE.Color(0xc89a3a);
  const c = new THREE.Color();
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rxz = Math.hypot(x, z);
    const phi = Math.atan2(z, x);
    const lobe = 0.5 + 0.5 * Math.cos(N * phi); // 1 at a rib's centre, 0 in a groove
    const k = Math.floor(((phi + Math.PI) / (2 * Math.PI)) * N) % N;
    const equator = Math.pow(rxz, 0.8); // grooves fade out toward the poles
    const m = (1 - depth * equator * (1 - Math.pow(lobe, 0.45))) * (0.97 + 0.03 * ribScale[k]);
    let px = x * m * R, pz = z * m * R;
    let py = y * squash * R;
    // Dimples where the stem sits and underneath; a broad, flattened top.
    const pole = 1 - Math.min(1, rxz / 0.5);
    if (y > 0) py -= 0.24 * R * pole * pole + 0.06 * R * y * y;
    else py += 0.12 * R * pole * pole;
    // Broad shoulders and a fuller lower body, blended smoothly (no seam at the equator).
    const bulge = 1 + 0.05 * (1 - y * y) - 0.03 * y;
    px *= bulge; pz *= bulge;
    pos.setXYZ(i, px, py, pz);
    minY = Math.min(minY, py);
    // Colour: grooves deeper, ribs' shoulders warmer, base darker, a hint of green-gold at the crown.
    const v = (y + 1) / 2;
    c.copy(base).lerp(grooveC, (1 - Math.pow(lobe, 0.6)) * 0.55 * equator);
    c.lerp(shoulder, Math.max(0, Math.pow(lobe, 2) * (v - 0.45)) * 0.9);
    c.lerp(bottomC, Math.max(0, 0.45 - v) * 0.9);
    c.lerp(crown, Math.pow(pole, 3) * (y > 0 ? 0.7 : 0));
    const streak = Math.sin(phi * N * 5 + Math.sin(phi * 7) * 2) * 0.5 + 0.5;
    c.multiplyScalar(0.96 + 0.06 * streak);
    col.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.translate(0, -minY, 0);
  body.computeVertexNormals();
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
  group.add(bodyMesh);
  const topY = squash * R - minY; // the shoulder height; the stem sits down in the dimple below it

  // --- Stem: tapered, ridged, flared at the base and bent over at the top.
  const stemH = 0.42 * R;
  const stem = new THREE.CylinderGeometry(0.075 * R, 0.13 * R, stemH, segU < 60 ? 6 : 24, segU < 60 ? 3 : 16, false);
  const sp = stem.getAttribute('position') as THREE.BufferAttribute;
  const scol = new Float32Array(sp.count * 3);
  const dark = new THREE.Color(0x4a3a20), light = new THREE.Color(0x8a7a42);
  for (let i = 0; i < sp.count; i++) {
    let x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const u = (y + stemH / 2) / stemH; // 0 at the base, 1 at the tip
    const a = Math.atan2(z, x);
    const ridge = 1 + 0.12 * Math.cos(a * 6);
    const flare = 1 + 0.6 * Math.pow(1 - u, 3);
    x *= ridge * flare; z *= ridge * flare;
    x += 0.5 * stemH * u * u; // bend
    y = u * stemH;
    sp.setXYZ(i, x, y, z);
    c.copy(dark).lerp(light, 0.35 + 0.45 * u + 0.15 * Math.cos(a * 6));
    scol.set([c.r, c.g, c.b], i * 3);
  }
  stem.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  stem.computeVertexNormals();
  const stemMesh = new THREE.Mesh(stem, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  stemMesh.position.set(0, topY - 0.32 * R, 0);
  stemMesh.rotation.y = 0.6;
  group.add(stemMesh);
  return group;
}
