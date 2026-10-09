import * as THREE from 'three';
import { CONFIG } from '../config';

const UP = new THREE.Vector3(0, 1, 0);

export interface Occluder { x: number; z: number; r: number; h: number }

/** Follow camera that sits behind the ball's direction of travel and backs off as it grows. */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Smoothed facing direction on the XZ plane. */
  readonly dir = new THREE.Vector3(0, 0, -1);
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private shakeT = 0;
  private shakeAmp = 0;
  private fovKick = 0;
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.1, 200);
  }

  /** Brief field-of-view punch on a big pickup. */
  kick(deg = 4): void {
    this.fovKick = Math.max(this.fovKick, deg);
  }

  shake(amp = 0.35, t = 0.35): void {
    this.shakeAmp = amp;
    this.shakeT = t;
  }

  /** Camera-relative basis: forward and right on the XZ plane. */
  basis(forward: THREE.Vector3, right: THREE.Vector3): void {
    forward.copy(this.dir).setY(0).normalize();
    right.crossVectors(forward, UP).normalize();
  }

  update(dt: number, ballPos: THREE.Vector3, ballVel: THREE.Vector3, radius: number, occluders: Occluder[] = []): void {
    const c = CONFIG.camera;
    const speed = Math.hypot(ballVel.x, ballVel.z);
    if (speed > 0.6) {
      this.tmp.set(ballVel.x, 0, ballVel.z).normalize();
      // Rotate dir towards velocity with a rate that is faster when moving fast.
      const k = 1 - Math.exp(-c.dirLerp * dt * Math.min(1, speed / 4));
      this.dir.lerp(this.tmp, k).normalize();
    }
    let dist = c.distBase + c.distPerRadius * radius;
    let height = c.heightBase + c.heightPerRadius * radius;
    // Pull the camera in when a tall object sits between it and the ball.
    const bx = ballPos.x, bz = ballPos.z;
    const dx = -this.dir.x, dz = -this.dir.z; // direction from ball to camera (XZ)
    let limit = dist;
    for (const o of occluders) {
      if (o.h < ballPos.y + height * 0.5) continue;
      const ox = o.x - bx, oz = o.z - bz;
      const t = ox * dx + oz * dz; // distance along the ray to the closest point
      if (t < 0 || t > limit) continue;
      const px = ox - dx * t, pz = oz - dz * t;
      const side = Math.hypot(px, pz);
      const rr = o.r + 0.6;
      if (side >= rr) continue;
      const enter = t - Math.sqrt(rr * rr - side * side);
      limit = Math.max(2.2, Math.min(limit, enter - 0.2));
    }
    if (limit < dist) {
      const k = limit / dist;
      dist = limit;
      height = height * (0.6 + 0.4 * k) + (1 - k) * 1.5; // look down a little more when close
    }
    const desired = this.tmp.copy(ballPos).addScaledVector(this.dir, -dist);
    desired.y = ballPos.y + height;
    if (!this.initialised) {
      this.pos.copy(desired);
      this.initialised = true;
    } else {
      const k = 1 - Math.exp(-c.posLerp * dt);
      this.pos.lerp(desired, k);
    }
    this.target.copy(ballPos).addScaledVector(this.dir, c.lookAhead * (0.5 + radius * 0.5));
    this.target.y = ballPos.y;
    this.camera.position.copy(this.pos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * (this.shakeT / 0.35);
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.target);
    if (this.fovKick > 0.01) {
      this.fovKick *= Math.exp(-dt * 9);
      this.camera.fov = CONFIG.camera.fov + this.fovKick;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.fov !== CONFIG.camera.fov) {
      this.camera.fov = CONFIG.camera.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  snapBehind(ballPos: THREE.Vector3, radius: number): void {
    this.initialised = false;
    this.update(0, ballPos, new THREE.Vector3(), radius);
  }
}
