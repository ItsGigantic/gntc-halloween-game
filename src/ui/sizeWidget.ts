import * as THREE from 'three';
import { METRES_PER_UNIT } from '../game/items';
import type { Player } from '../game/player';

export const BALL_LAYER = 1;

/**
 * Katamari-style size gauge: a circular live view of the ball on its own layer, with a
 * reference ring. The ball grows toward the ring; when it reaches it the scale doubles and
 * the view zooms out, so growth always reads as progress.
 */
export class SizeWidget {
  readonly el: HTMLDivElement;
  private readout: HTMLElement;
  private unit: HTMLElement;
  private refLabel: HTMLElement;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly dir = new THREE.Vector3(0.55, 0.5, 1).normalize();
  private refDiameter = 2.2;       // world units that fill the ring
  private zoom = 1;                // current ortho half-extent in world units
  private zoomTarget = 1;
  private readonly ringFrac = 0.78; // ring diameter / view size
  private lights: THREE.Object3D[] = [];
  private backdrop: THREE.Mesh;
  visible = false;

  constructor(ui: HTMLElement, scene: THREE.Scene) {
    this.el = document.createElement('div');
    this.el.id = 'sizeWidget';
    this.el.innerHTML = `${webSvg()}<div class="sw-view"><i class="sw-ring"></i><em class="sw-ref"></em></div><div class="sw-text"><b class="sw-readout"><span class="sw-num">55</span><span class="sw-unit">cm</span></b></div>`;
    ui.appendChild(this.el);
    this.readout = this.el.querySelector('.sw-num')!;
    this.unit = this.el.querySelector('.sw-unit')!;
    this.refLabel = this.el.querySelector('.sw-ref')!;
    this.camera.layers.set(BALL_LAYER);
    // A little extra fill so the ball reads at thumbnail size; the scene's own lights also light this layer.
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(3, 5, 4);
    fill.layers.set(BALL_LAYER);
    scene.add(fill);
    this.lights.push(fill);
    // A dark disc behind the ball gives the circle a clean backdrop without clearing the square region.
    this.backdrop = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x090a2a, toneMapped: false }));
    this.backdrop.layers.set(BALL_LAYER);
    this.backdrop.visible = false; // kept for a possible opaque mode; the gauge draws straight over the game
    this.setZoomFor(this.refDiameter, true);
    this.refLabel.textContent = this.refText();
  }

  private refText(): string {
    const m = this.refDiameter * METRES_PER_UNIT;
    return m < 1 ? `${Math.round(m * 100)} cm` : `${+m.toFixed(1)} m`;
  }

  private setZoomFor(refDiameter: number, snap = false): void {
    // Half-extent so that `refDiameter` spans ringFrac of the view.
    this.zoomTarget = refDiameter / this.ringFrac / 2;
    if (snap) this.zoom = this.zoomTarget;
  }

  show(): void {
    this.visible = true;
    this.el.classList.add('on');
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('on');
  }

  reset(radius: number): void {
    this.refDiameter = 2.2;
    while (radius * 2 > this.refDiameter * 0.92) this.refDiameter *= 2;
    this.setZoomFor(this.refDiameter, true);
    this.refLabel.textContent = this.refText();
  }

  update(player: Player, dt: number): void {
    const d = player.radius * 2;
    if (d > this.refDiameter * 0.95) {
      this.refDiameter *= 2;
      this.setZoomFor(this.refDiameter);
      this.refLabel.textContent = this.refText();
      this.el.classList.remove('step');
      void this.el.offsetWidth;
      this.el.classList.add('step');
    }
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 5);
    const m = player.radius * 2 * METRES_PER_UNIT;
    const num = m < 1 ? String(Math.round(m * 100)) : m.toFixed(2);
    const unit = m < 1 ? 'cm' : 'm';
    if (this.readout.textContent !== num) this.readout.textContent = num;
    if (this.unit.textContent !== unit) this.unit.textContent = unit;
    // Frame the ball: ortho camera on a fixed world direction, following the ball.
    const c = this.camera;
    c.left = -this.zoom; c.right = this.zoom; c.top = this.zoom; c.bottom = -this.zoom;
    c.position.copy(player.pos).addScaledVector(this.dir, 30);
    c.lookAt(player.pos);
    c.updateProjectionMatrix();
    // Backdrop disc sits behind the ball, facing the camera, filling the circular view.
    this.backdrop.position.copy(player.pos).addScaledVector(this.dir, -(player.radius + 4));
    this.backdrop.quaternion.copy(c.quaternion);
    this.backdrop.scale.setScalar(this.zoom);
  }

  /** Call after the main render. Draws into the circular viewport with scissor + viewport. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.visible) return;
    const r = this.el.querySelector('.sw-view')!.getBoundingClientRect();
    const size = renderer.getSize(new THREE.Vector2());
    const x = Math.round(r.left), y = Math.round(size.y - r.bottom), w = Math.round(r.width), h = Math.round(r.height);
    if (w <= 0 || h <= 0) return;
    const prevFog = scene.fog;
    const prevBg = scene.background;
    scene.fog = null;
    scene.background = null;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, this.camera);
    renderer.autoClear = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    scene.fog = prevFog;
    scene.background = prevBg;
  }
}

/** A corner spider web: spokes from the bottom-right corner with sagging threads between them. */
function webSvg(): string {
  const S = 320;
  const cx = S, cy = S;
  const spokes = 7;
  let d = '';
  const angles: number[] = [];
  for (let i = 0; i <= spokes; i++) {
    const a = Math.PI + (i / spokes) * (Math.PI / 2); // from pointing left (180°) to up (270°)
    angles.push(a);
    d += `M${cx},${cy} L${(cx + Math.cos(a) * S * 1.05).toFixed(1)},${(cy + Math.sin(a) * S * 1.05).toFixed(1)} `;
  }
  for (let r = 48; r < S * 1.02; r += 46) {
    for (let i = 0; i < spokes; i++) {
      const a0 = angles[i], a1 = angles[i + 1];
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      const am = (a0 + a1) / 2, sag = r * 0.93;
      const qx = cx + Math.cos(am) * sag, qy = cy + Math.sin(am) * sag;
      d += `M${x0.toFixed(1)},${y0.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} `;
    }
  }
  return `<svg class="sw-web" viewBox="0 0 ${S} ${S}" aria-hidden="true"><path d="${d}"/></svg>`;
}
