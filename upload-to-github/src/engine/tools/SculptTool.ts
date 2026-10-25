import { Vector3 } from 'three';
import { getEditor, setEditor, type SculptMode } from '../../state/store';
import { unionRect, type GridRect, type StrokeState } from '../terrain/Terrain';
import { clamp } from '../util/math';
import { Tool, type PointerInfo } from './Tool';

const BRUSH_COLORS: Record<SculptMode, [number, number, number]> = {
  raise: [1.0, 0.86, 0.6],
  lower: [0.75, 0.86, 1.0],
  smooth: [0.85, 1.0, 0.8],
  flatten: [1.0, 0.95, 0.75],
  slope: [1.0, 0.78, 0.55],
  roughen: [0.95, 0.8, 0.7],
  erode: [0.9, 0.82, 1.0],
};

/** Brush-based terrain sculpting — feels like pushing wet mud. */
export class SculptTool extends Tool {
  readonly id = 'sculpt' as const;
  cursor = 'crosshair';
  private stroke: StrokeState | null = null;
  private strokeRect: GridRect | null = null;
  private followRect: GridRect | null = null;
  private followOld: Float32Array | null = null;
  private followTimer = 0;
  private hit: Vector3 | null = null;
  private mods = { shift: false, ctrl: false };
  private lastPx: [number, number] | null = null;

  activate() {
    this.e.terrain.material.userData.k.uBrushOn.value = 0;
  }

  deactivate() {
    if (this.stroke) this.endStroke();
    this.e.terrain.material.userData.k.uBrushOn.value = 0;
  }

  private mode(): SculptMode {
    const base = getEditor().sculpt.mode;
    if (this.mods.shift) return 'smooth';
    if (this.mods.ctrl) return base === 'raise' ? 'lower' : base === 'lower' ? 'raise' : base;
    return base;
  }

  pointerDown(p: PointerInfo): boolean {
    if (p.button !== 0) return false;
    this.mods = { shift: p.shift, ctrl: p.ctrl };
    const hit = this.e.terrain.raycast(p.ray);
    if (!hit || !this.e.terrain.inside(hit.x, hit.z)) return false;
    this.hit = hit;
    this.stroke = this.e.terrain.beginStroke(this.mode(), hit.x, hit.z);
    this.strokeRect = null;
    this.followRect = null;
    this.followOld = this.e.terrain.heights.slice();
    this.followTimer = 0;
    return true;
  }

  pointerMove(p: PointerInfo) {
    this.mods = { shift: p.shift, ctrl: p.ctrl };
  }

  pointerUp() {
    if (this.stroke) this.endStroke();
  }

  private endStroke() {
    const s = this.stroke!;
    this.stroke = null;
    this.flushFollow();
    if (!this.strokeRect) return;
    const t = this.e.terrain;
    const r = this.strokeRect;
    const before = t.extractRect(s.before, r);
    const after = t.extractRect(t.heights, r);
    const labels: Record<SculptMode, string> = { raise: 'Raise', lower: 'Lower', smooth: 'Smooth', flatten: 'Flatten', slope: 'Slope', roughen: 'Roughen', erode: 'Erode' };
    this.e.history.push(this.e.cmdHeights(r, before, after, `${labels[s.mode]} terrain`));
    this.strokeRect = null;
  }

  private flushFollow() {
    if (this.followRect && this.followOld) {
      this.e.followTerrain(this.followRect, this.followOld);
      this.followOld = this.e.terrain.heights.slice();
      this.followRect = null;
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.code === 'BracketLeft' || ev.code === 'BracketRight') {
      const s = getEditor().sculpt;
      const size = clamp(s.size * (ev.code === 'BracketLeft' ? 0.85 : 1.18), 1.5, 60);
      setEditor({ sculpt: { ...s, size } });
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.stroke) { this.endStroke(); return true; }
    return false;
  }

  update(dt: number) {
    const p = this.e.input.refreshRay();
    const k = this.e.terrain.material.userData.k;
    const s = getEditor().sculpt;
    if (p) {
      if (!this.stroke) this.mods = { shift: p.shift, ctrl: p.ctrl };
      // Holding still keeps the brush where you pressed; otherwise a rising hill would pull the
      // cursor's ground point toward the camera and smear the mound into a ridge.
      const still = !!this.stroke && !!this.hit && !!this.lastPx && this.lastPx[0] === p.x && this.lastPx[1] === p.y && !this.e.rig.moving;
      if (!still) this.hit = this.e.terrain.raycast(p.ray);
      this.lastPx = [p.x, p.y];
    }
    const hit = this.hit;
    const show = !!hit && this.e.terrain.inside(hit.x, hit.z) && !!p;
    k.uBrushOn.value = show ? 1 : 0;
    if (!hit || !show) return;
    k.uBrushPos.value.set(hit.x, hit.z);
    k.uBrushRadius.value = s.size;
    k.uBrushHard.value = clamp(1 - s.falloff, 0.05, 0.95);
    const mode = this.mode();
    k.uBrushColor.value.setRGB(...BRUSH_COLORS[mode]);
    if (!this.stroke) return;
    this.stroke.mode = mode;
    const rect = this.e.terrain.sculpt(this.stroke, mode, hit.x, hit.z, s.size, s.strength, s.falloff, dt);
    if (rect) {
      this.strokeRect = unionRect(this.strokeRect, rect);
      this.followRect = unionRect(this.followRect, rect);
    }
    this.followTimer += dt;
    if (this.followTimer > 0.12) {
      this.followTimer = 0;
      this.flushFollow();
    }
  }
}
