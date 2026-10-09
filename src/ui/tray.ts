import * as THREE from 'three';
import { cloneModel, model } from '../assets/loader';
import { labelFor, displaySize } from '../game/items';

/**
 * Katamari-style pickup tray: a small live 3D render of the most recent pickup
 * in the bottom-left corner, with its name, points and the current size.
 */
export class PickupTray {
  readonly el: HTMLDivElement;
  private nameEl: HTMLElement;
  private ptsEl: HTMLElement;
  private sizeEl: HTMLElement;
  private deltaEl: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private holder = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private hideT = 0;
  private spin = 0;
  private popT = 0;
  private lastRadius = 0;
  visible = false;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'tray';
    this.el.innerHTML = `<div class="tray-view"></div><div class="tray-text"><b id="trayName"></b><span id="trayPts"></span><small><i id="traySize"></i><em id="trayDelta"></em></small></div>`;
    ui.appendChild(this.el);
    this.nameEl = this.el.querySelector('#trayName')!;
    this.ptsEl = this.el.querySelector('#trayPts')!;
    this.sizeEl = this.el.querySelector('#traySize')!;
    this.deltaEl = this.el.querySelector('#trayDelta')!;
    this.scene.add(this.holder);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    this.camera.position.set(0, 0.9, 3.2);
    this.camera.lookAt(0, 0, 0);
  }

  show(name: string, points: number, radius: number): void {
    if (this.current) this.holder.remove(this.current);
    const obj = cloneModel(name);
    const info = model(name);
    // Normalise to fit the little viewport, centred on its bounds.
    const s = 1.3 / Math.max(info.size.x, info.size.y, info.size.z);
    obj.scale.setScalar(s);
    obj.position.copy(info.center).multiplyScalar(-s);
    obj.traverse((o) => { o.visible = true; });
    this.holder.add(obj);
    this.current = obj;
    this.nameEl.textContent = labelFor(name);
    this.ptsEl.textContent = points > 0 ? `+${points}` : '';
    this.sizeEl.textContent = displaySize(radius);
    const grew = radius - this.lastRadius;
    const cm = Math.round(grew * 2 * 50);
    this.deltaEl.textContent = this.lastRadius > 0 && cm >= 1 ? `up ${cm} cm` : '';
    this.lastRadius = radius;
    this.hideT = 2.6;
    this.popT = 1;
    this.visible = true;
    this.el.classList.add('on');
    this.el.classList.remove('bounce');
    void this.el.offsetWidth;
    this.el.classList.add('bounce');
  }

  reset(radius: number): void {
    this.lastRadius = radius;
    this.hideT = 0;
    this.visible = false;
    this.el.classList.remove('on');
  }

  /** Call after the main render: draws into the corner using scissor + viewport. */
  render(renderer: THREE.WebGLRenderer, dt: number): void {
    if (!this.visible) return;
    this.hideT -= dt;
    if (this.hideT <= 0) {
      this.visible = false;
      this.el.classList.remove('on');
      return;
    }
    this.spin += dt * 1.6;
    this.popT = Math.max(0, this.popT - dt * 3);
    this.holder.rotation.y = this.spin;
    this.holder.rotation.x = 0.15;
    const pop = 1 + Math.sin(this.popT * Math.PI) * 0.25;
    this.holder.scale.setScalar(pop);
    const r = this.el.querySelector('.tray-view')!.getBoundingClientRect();
    const size = renderer.getSize(new THREE.Vector2());
    const cssH = size.y;
    // Scissor/viewport are in CSS pixels with origin bottom-left.
    const x = Math.round(r.left), y = Math.round(cssH - r.bottom), w = Math.round(r.width), h = Math.round(r.height);
    if (w <= 0 || h <= 0) return;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
  }
}
