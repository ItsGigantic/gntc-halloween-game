import * as THREE from 'three';

/** Viewpoints for the behind-the-scenes shots, as [camera position, look-at target]. */
const SHOTS: Record<string, [THREE.Vector3Tuple, THREE.Vector3Tuple]> = {
  // A high three-quarter view of the whole set, the post camera included.
  aerial: [[19, 15, 30], [0, 0.5, -2]],
  // From the side: how the layers stack up from the foreground to the backdrop.
  side: [[-60, 10, -4], [0, 0.5, -4]],
  // Plan view, straight down.
  top: [[0, 44, -1], [0, 0, -1]],
  // Just behind and above the post camera, looking down its lens at the set.
  over: [[3.5, 6.5, 17], [0, 1.5, -1]],
};

export interface Bts {
  camera: THREE.PerspectiveCamera;
  update(): void;
}

/**
 * Behind-the-scenes mode (?bts=aerial|side|top|over): renders the set from outside, on a studio
 * backdrop, with the post's own camera drawn as a wireframe (its framing pyramid shows exactly what
 * ends up in the frame), a ground grid and the key light's direction. Fog is turned off so the whole
 * set is visible, including the parts the post never shows.
 */
export function setupBts(scene: THREE.Scene, postCamera: THREE.PerspectiveCamera, aspect: number, shot: string, keyLight?: THREE.DirectionalLight): Bts {
  const [pos, look] = SHOTS[shot] ?? SHOTS.aerial;
  const camera = new THREE.PerspectiveCamera(shot === 'top' ? 50 : 38, aspect, 0.1, 400);
  camera.position.set(...pos);
  // Plan view: north (into the set) at the top, so the post camera sits at the bottom looking up the frame.
  if (shot === 'top') camera.up.set(0, 0, -1);
  camera.lookAt(new THREE.Vector3(...look));
  scene.fog = null;
  scene.background = new THREE.Color(0x1b1c22);
  // Hide the sky dome (a sphere seen from inside) so the set sits on the studio backdrop.
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material).side === THREE.BackSide) m.visible = false;
  });

  const grid = new THREE.GridHelper(60, 60, 0x6a6e80, 0x3a3d4a);
  grid.position.y = 0.14;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  scene.add(grid);

  // The post camera's framing: a short frustum so the pyramid reads, in a bright, easy-to-follow colour.
  const proxy = postCamera.clone();
  proxy.far = 10;
  proxy.updateProjectionMatrix();
  const helper = new THREE.CameraHelper(proxy);
  helper.setColors(new THREE.Color(0x02fff9), new THREE.Color(0x02fff9), new THREE.Color(0xffd36b), new THREE.Color(0xff6ea6), new THREE.Color(0x02fff9));
  scene.add(helper);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.7), new THREE.MeshBasicMaterial({ color: 0x02fff9, wireframe: true }));
  scene.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.3, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x02fff9, wireframe: true }));
  scene.add(lens);

  let lightHelper: THREE.DirectionalLightHelper | null = null;
  if (keyLight) {
    lightHelper = new THREE.DirectionalLightHelper(keyLight, 1.2, 0xffd36b);
    scene.add(lightHelper);
  }

  return {
    camera,
    update() {
      proxy.position.copy(postCamera.position);
      proxy.quaternion.copy(postCamera.quaternion);
      proxy.updateMatrixWorld();
      helper.update();
      body.position.copy(postCamera.position);
      body.quaternion.copy(postCamera.quaternion);
      body.translateZ(0.35);
      lens.position.copy(postCamera.position);
      lens.quaternion.copy(postCamera.quaternion);
      lens.translateZ(-0.05);
      lightHelper?.update();
    },
  };
}
