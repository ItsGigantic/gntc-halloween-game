// Keyboard (WASD / arrows) + floating touch joystick. Output is a 2D vector
// in screen space: x right, y forward (up on screen), length 0..1.
export class Input {
  x = 0;
  y = 0;
  private keys = new Set<string>();
  private pointerId: number | null = null;
  private anchor = { x: 0, y: 0 };
  private joy: HTMLDivElement;
  private knob: HTMLDivElement;
  private readonly radius = 50;
  private touchVec = { x: 0, y: 0 };
  onAnyInput: (() => void) | null = null;
  onJump: (() => void) | null = null;
  enabled = true;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.joy = document.createElement('div');
    this.joy.className = 'joy';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.joy.appendChild(this.knob);
    ui.appendChild(this.joy);
    // Touch: a hop button (hidden on pointer devices by CSS).
    const jump = document.createElement('button');
    jump.id = 'jumpBtn';
    jump.setAttribute('aria-label', 'Hop');
    jump.textContent = 'Hop';
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.enabled) this.onJump?.();
      this.onAnyInput?.();
    });
    ui.appendChild(jump);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onAnyInput?.();
      if (e.code === 'Space' && this.enabled) {
        e.preventDefault();
        this.onJump?.();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.anchor = { x: e.clientX, y: e.clientY };
      this.joy.style.left = `${e.clientX}px`;
      this.joy.style.top = `${e.clientY}px`;
      this.joy.classList.add('on');
      this.knob.style.transform = 'translate(0,0)';
      canvas.setPointerCapture(e.pointerId);
      this.onAnyInput?.();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      let dx = e.clientX - this.anchor.x;
      let dy = e.clientY - this.anchor.y;
      let len = Math.hypot(dx, dy);
      if (len > this.radius) {
        // Drifting base: the stick follows the thumb, so a long drag re-centres instead of pinning.
        const over = len - this.radius;
        this.anchor.x += (dx / len) * over;
        this.anchor.y += (dy / len) * over;
        this.joy.style.left = `${this.anchor.x}px`;
        this.joy.style.top = `${this.anchor.y}px`;
        dx *= this.radius / len;
        dy *= this.radius / len;
        len = this.radius;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Small dead zone, linear response, and the outer fifth snaps to full speed.
      const n = len / this.radius;
      const mag = n < 0.06 ? 0 : n > 0.8 ? 1 : (n - 0.06) / 0.74;
      const inv = len > 0 ? mag / len : 0;
      this.touchVec = { x: dx * inv, y: -dy * inv };
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.touchVec = { x: 0, y: 0 };
      this.joy.classList.remove('on');
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  update(): void {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky -= 1;
    const kl = Math.hypot(kx, ky);
    if (kl > 1) {
      kx /= kl;
      ky /= kl;
    }
    if (!this.enabled) {
      this.x = 0;
      this.y = 0;
      return;
    }
    if (kl > 0) {
      this.x = kx;
      this.y = ky;
    } else {
      this.x = this.touchVec.x;
      this.y = this.touchVec.y;
    }
  }

  releaseAll(): void {
    this.keys.clear();
    this.touchVec = { x: 0, y: 0 };
    this.pointerId = null;
    this.joy.classList.remove('on');
  }
}
