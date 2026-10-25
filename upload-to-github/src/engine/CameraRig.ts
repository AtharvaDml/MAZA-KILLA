import { PerspectiveCamera, Vector3 } from 'three';
import type { CameraPreset } from '../state/store';
import { clamp, DEG, wrapAngle } from './util/math';

const MIN_PITCH = 3 * DEG;
const MAX_PITCH = 88 * DEG;

export interface CameraState { target: [number, number, number]; yaw: number; pitch: number; distance: number }

/**
 * Orbit/pan/zoom rig with exponential damping toward goal values, release inertia,
 * zoom-toward-cursor, WASD travel and terrain clearance. Nothing ever snaps.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly target = new Vector3();
  yaw = 0.75;
  pitch = 0.62;
  distance = 170;
  readonly goal = { target: new Vector3(), yaw: 0.75, pitch: 0.62, distance: 170 };
  private yawVel = 0;
  private pitchVel = 0;
  private lastOrbitAt = 0;
  private dragging = false;
  private readonly keys = new Set<string>();
  private cinematic = false;
  minDist = 2.5;
  maxDist = 560;
  bound = 160;
  heightAt: (x: number, z: number) => number = () => 0;
  /** True while anything is still moving (used to skip work when idle). */
  moving = true;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(40, aspect, 0.3, 6000);
    this.applyPose();
  }

  setBounds(plotHalf: number) {
    this.bound = plotHalf + 70;
    this.maxDist = Math.max(360, plotHalf * 4.2);
  }

  setKey(code: string, down: boolean) {
    if (down) this.keys.add(code); else this.keys.delete(code);
    if (down) this.cinematic = false;
  }

  clearKeys() {
    this.keys.clear();
  }

  beginDrag() {
    this.dragging = true;
    this.cinematic = false;
    this.yawVel = 0;
    this.pitchVel = 0;
  }

  endDrag() {
    this.dragging = false;
    if (performance.now() - this.lastOrbitAt > 80) { this.yawVel = 0; this.pitchVel = 0; }
  }

  orbitBy(dx: number, dy: number) {
    const now = performance.now();
    const dt = Math.max(8, now - this.lastOrbitAt) / 1000;
    const dyaw = -dx * 0.0056, dpitch = dy * 0.0046;
    this.goal.yaw += dyaw;
    this.goal.pitch = clamp(this.goal.pitch + dpitch, MIN_PITCH, MAX_PITCH);
    // Smoothed release velocity for inertia.
    this.yawVel = this.yawVel * 0.6 + (dyaw / dt) * 0.4;
    this.pitchVel = this.pitchVel * 0.6 + (dpitch / dt) * 0.4;
    this.lastOrbitAt = now;
    this.cinematic = false;
  }

  panBy(dx: number, dy: number, viewportH: number) {
    const scale = (2 * this.goal.distance * Math.tan((this.camera.fov * DEG) / 2)) / viewportH;
    const sy = Math.sin(this.goal.yaw), cy = Math.cos(this.goal.yaw);
    // right = (cos, 0, -sin); forward(ground) = (-sin, 0, -cos)
    const fwdK = 1 / Math.max(0.35, Math.sin(this.goal.pitch) * 0.6 + 0.4);
    this.goal.target.x += (-dx * cy - dy * sy * fwdK) * scale;
    this.goal.target.z += (dx * sy - dy * cy * fwdK) * scale;
    this.clampTarget();
    this.cinematic = false;
  }

  /** deltaY > 0 zooms out. `focus` keeps the point under the cursor under the cursor. */
  zoomBy(deltaY: number, focus?: Vector3 | null) {
    const factor = Math.exp(clamp(deltaY, -240, 240) * 0.0012);
    const nd = clamp(this.goal.distance * factor, this.minDist, this.maxDist);
    const f = nd / this.goal.distance;
    this.goal.distance = nd;
    if (focus) {
      const t = 1 - f;
      this.goal.target.x += (focus.x - this.goal.target.x) * t;
      this.goal.target.z += (focus.z - this.goal.target.z) * t;
      this.goal.target.y += (focus.y - this.goal.target.y) * Math.max(0, t);
      this.clampTarget();
    }
    this.cinematic = false;
  }

  focusOn(p: Vector3, distance?: number) {
    this.goal.target.copy(p);
    if (distance) this.goal.distance = clamp(distance, this.minDist, this.maxDist);
    this.clampTarget();
  }

  private clampTarget() {
    const b = this.bound;
    this.goal.target.x = clamp(this.goal.target.x, -b, b);
    this.goal.target.z = clamp(this.goal.target.z, -b, b);
  }

  preset(p: CameraPreset, plotHalf: number) {
    const g = this.goal;
    this.cinematic = false;
    switch (p) {
      case 'top':
        g.pitch = MAX_PITCH;
        g.distance = plotHalf * 3.1;
        g.target.set(0, 0, 0);
        break;
      case 'iso':
        g.pitch = 35 * DEG;
        g.yaw = Math.round((g.yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
        g.distance = plotHalf * 2.5;
        g.target.set(0, 0, 0);
        break;
      case 'ground':
        g.pitch = 6 * DEG;
        g.distance = 26;
        g.target.y = this.heightAt(g.target.x, g.target.z) + 1.5;
        break;
      case 'cinematic':
        g.pitch = 19 * DEG;
        g.distance = plotHalf * 1.75;
        g.target.set(0, Math.max(0, this.heightAt(0, 0)) * 0.6, 0);
        this.cinematic = true;
        break;
    }
  }

  update(dt: number) {
    const g = this.goal;
    if (!this.dragging) {
      if (this.cinematic) {
        g.yaw += dt * 0.11;
      } else if (Math.abs(this.yawVel) + Math.abs(this.pitchVel) > 1e-4) {
        g.yaw += this.yawVel * dt;
        g.pitch = clamp(g.pitch + this.pitchVel * dt, MIN_PITCH, MAX_PITCH);
        const decay = Math.exp(-dt * 3.8);
        this.yawVel *= decay;
        this.pitchVel *= decay;
      }
    }
    // WASD / arrows travel relative to the view.
    if (this.keys.size) {
      let f = 0, r = 0, u = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
      if (this.keys.has('PageUp')) u += 1;
      if (this.keys.has('PageDown')) u -= 1;
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.5 : 1;
      const speed = Math.max(12, g.distance * 0.9) * fast * dt;
      const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
      g.target.x += (-sy * f + cy * r) * speed;
      g.target.z += (-cy * f - sy * r) * speed;
      if (f || r) g.target.y += (Math.max(0, this.heightAt(g.target.x, g.target.z)) - g.target.y) * Math.min(1, dt * 3);
      g.distance = clamp(g.distance * Math.exp(-u * dt * 1.2), this.minDist, this.maxDist);
      this.clampTarget();
    }

    const k = 1 - Math.exp(-dt * 9);
    const prevYaw = this.yaw, prevPitch = this.pitch, prevD = this.distance;
    const prevT = this.target.clone();
    this.yaw += wrapAngle(g.yaw - this.yaw) * k;
    this.pitch += (g.pitch - this.pitch) * k;
    this.distance = Math.exp(Math.log(this.distance) + (Math.log(g.distance) - Math.log(this.distance)) * k);
    this.target.lerp(g.target, k);
    this.applyPose();
    this.moving =
      Math.abs(this.yaw - prevYaw) > 1e-5 || Math.abs(this.pitch - prevPitch) > 1e-5 ||
      Math.abs(this.distance - prevD) > 1e-4 || this.target.distanceToSquared(prevT) > 1e-8 || this.cinematic;
  }

  private applyPose() {
    const cp = Math.cos(this.pitch);
    const pos = this.camera.position;
    pos.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    // Terrain clearance: lift the camera rather than clipping into hills.
    const floor = this.heightAt(pos.x, pos.z) + 0.9;
    if (pos.y < floor) {
      const need = Math.asin(clamp((floor - this.target.y) / this.distance, -1, 1));
      this.pitch = Math.max(this.pitch, need);
      this.goal.pitch = Math.max(this.goal.pitch, need);
      const cp2 = Math.cos(this.pitch);
      pos.set(
        this.target.x + this.distance * cp2 * Math.sin(this.yaw),
        this.target.y + this.distance * Math.sin(this.pitch),
        this.target.z + this.distance * cp2 * Math.cos(this.yaw),
      );
    }
    this.camera.lookAt(this.target);
  }

  get state(): CameraState {
    return { target: [this.goal.target.x, this.goal.target.y, this.goal.target.z], yaw: this.goal.yaw, pitch: this.goal.pitch, distance: this.goal.distance };
  }

  setState(s: CameraState, instant = true) {
    this.goal.target.set(...s.target);
    this.goal.yaw = s.yaw;
    this.goal.pitch = clamp(s.pitch, MIN_PITCH, MAX_PITCH);
    this.goal.distance = clamp(s.distance, this.minDist, this.maxDist);
    if (instant) {
      this.target.copy(this.goal.target);
      this.yaw = this.goal.yaw;
      this.pitch = this.goal.pitch;
      this.distance = this.goal.distance;
      this.applyPose();
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
