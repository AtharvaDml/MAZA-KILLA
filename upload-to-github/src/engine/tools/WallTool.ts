import { Mesh, Vector3 } from 'three';
import { getEditor, setEditor, toast } from '../../state/store';
import { uid } from '../util/id';
import { buildWallGeometry, sampleWall, type WallData } from '../walls/wallGeometry';
import { Tool, type PointerInfo } from './Tool';

const CLOSE_DIST = 3;
const FREEHAND_STEP = 1.1;

/** Simplify a freehand polyline (Ramer–Douglas–Peucker). */
function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/**
 * Draw fort walls: click to drop points, or press-and-drag to sketch a freehand curve.
 * Double-click / Enter finishes, clicking the first point closes the loop, Backspace undoes a point.
 */
export class WallTool extends Tool {
  readonly id = 'wall' as const;
  cursor = 'crosshair';
  private points: [number, number][] = [];
  private freehand: [number, number][] | null = null;
  private downAt: { x: number; y: number } | null = null;
  private downGround: [number, number] | null = null;
  private cursorPt: [number, number] | null = null;
  private preview: Mesh;
  private dirty = true;
  private sig = '';

  constructor(e: ConstructorParameters<typeof Tool>[0]) {
    super(e);
    this.preview = new Mesh(undefined, e.materials.wall.normal);
    this.preview.castShadow = true;
    this.preview.receiveShadow = true;
    this.preview.visible = false;
    this.preview.name = 'wall-preview';
    e.scene.add(this.preview);
  }

  activate() {
    this.reset();
  }

  deactivate() {
    this.reset();
    this.e.terrain.material.userData.k.uBrushOn.value = 0;
  }

  private reset() {
    this.points = [];
    this.freehand = null;
    this.downAt = null;
    this.preview.visible = false;
    this.e.overlay.setMarkers([], null, 1);
    setEditor((s) => ({ wall: { ...s.wall, drawing: false, points: 0 } }));
    this.dirty = true;
  }

  private ground(p: PointerInfo): [number, number] | null {
    const hit = this.e.terrain.raycast(p.ray);
    if (!hit) return null;
    const h = this.e.terrain.half - 1;
    return [Math.max(-h, Math.min(h, hit.x)), Math.max(-h, Math.min(h, hit.z))];
  }

  pointerDown(p: PointerInfo): boolean {
    if (p.button !== 0) return false;
    const g = this.ground(p);
    if (!g) return false;
    this.downAt = { x: p.x, y: p.y };
    this.downGround = g;
    this.cursorPt = g;
    return true;
  }

  pointerMove(p: PointerInfo, captured: boolean) {
    const g = this.ground(p);
    if (g) this.cursorPt = g;
    this.dirty = true;
    if (!captured || !this.downAt || !g) return;
    if (!this.freehand && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 7) {
      // Continue from the last placed point, or start where the press began.
      this.freehand = [this.points.length ? this.points[this.points.length - 1] : this.downGround ?? g];
    }
    if (this.freehand) {
      const last = this.freehand[this.freehand.length - 1];
      if (Math.hypot(g[0] - last[0], g[1] - last[1]) >= FREEHAND_STEP) this.freehand.push(g);
    }
  }

  pointerUp(p: PointerInfo) {
    const g = this.ground(p) ?? this.cursorPt;
    if (this.freehand) {
      if (g) this.freehand.push(g);
      const simple = rdp(this.freehand, 0.45);
      const startIdx = this.points.length ? 1 : 0;
      for (const pt of simple.slice(startIdx)) this.pushPoint(pt);
      this.freehand = null;
      this.downAt = null;
      this.dirty = true;
      // A freehand stroke that returns to its start closes the loop.
      if (this.points.length >= 4) {
        const a = this.points[0], b = this.points[this.points.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < CLOSE_DIST) { this.points.pop(); this.finish(true); }
      }
      return;
    }
    this.downAt = null;
    if (!g) return;
    if (this.points.length >= 3) {
      const a = this.points[0];
      if (Math.hypot(a[0] - g[0], a[1] - g[1]) < CLOSE_DIST) { this.finish(true); return; }
    }
    this.pushPoint(g);
    this.dirty = true;
  }

  private pushPoint(pt: [number, number]) {
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(last[0] - pt[0], last[1] - pt[1]) < 0.6) return;
    this.points.push([pt[0], pt[1]]);
    setEditor((s) => ({ wall: { ...s.wall, drawing: true, points: this.points.length } }));
  }

  doubleClick() {
    if (this.points.length >= 2) this.finish(false);
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
      if (this.points.length >= 2) this.finish(false);
      return true;
    }
    if (ev.code === 'Backspace' && this.points.length) {
      this.points.pop();
      setEditor((s) => ({ wall: { ...s.wall, drawing: this.points.length > 0, points: this.points.length } }));
      this.dirty = true;
      return true;
    }
    if (ev.code === 'KeyC' && this.points.length >= 3) {
      this.finish(true);
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.points.length || this.freehand) { this.reset(); return true; }
    return false;
  }

  private params(): Omit<WallData, 'id' | 'points' | 'closed'> {
    const w = getEditor().wall;
    return { smooth: w.smooth, height: w.height, thickness: w.thickness, battlement: w.battlement, stone: w.stone, flip: false, openings: [] };
  }

  private finish(closed: boolean) {
    const pts = this.points.slice();
    if (pts.length < 2) { this.reset(); return; }
    const data: WallData = { id: uid(), points: pts, closed: closed && pts.length >= 3, ...this.params() };
    this.e.exec(this.e.cmdAddWall(data));
    this.reset();
    this.e.setSelection([{ kind: 'wall', id: data.id }]);
    toast(closed ? 'Fort wall closed. Add gates and buruj next.' : 'Wall built. Keep drawing, or press Esc to edit it.', 'ok', 2600);
  }

  update() {
    const p = this.e.input.refreshRay();
    if (p) {
      const g = this.ground(p);
      if (g && (!this.cursorPt || g[0] !== this.cursorPt[0] || g[1] !== this.cursorPt[1])) { this.cursorPt = g; this.dirty = true; }
    }
    const prm = this.params();
    const sig = JSON.stringify(prm);
    if (sig !== this.sig) { this.sig = sig; this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;

    const pts: [number, number][] = [...this.points];
    if (this.freehand) pts.push(...this.freehand.slice(this.points.length ? 1 : 0));
    else if (this.cursorPt && pts.length) pts.push(this.cursorPt);
    const closable = !this.freehand && this.points.length >= 3 && !!this.cursorPt &&
      Math.hypot(this.points[0][0] - this.cursorPt[0], this.points[0][1] - this.cursorPt[1]) < CLOSE_DIST;
    if (closable) pts.pop();

    // Point markers float above where the wall top will be.
    const markerY = (x: number, z: number) => this.e.terrain.heightAt(x, z) + prm.height + 2.2;
    const markers = this.points.map(([x, z]) => new Vector3(x, markerY(x, z), z));
    if (this.cursorPt && !this.freehand) markers.push(new Vector3(this.cursorPt[0], markerY(this.cursorPt[0], this.cursorPt[1]), this.cursorPt[1]));
    this.e.overlay.setMarkers(markers, closable ? 0 : null, 1);

    if (pts.length < 2) { this.preview.visible = false; return; }
    const data: WallData = { id: '__preview', points: pts, closed: closable, ...prm };
    const S = sampleWall(data, (x, z) => this.e.terrain.heightAt(x, z));
    if (!S) { this.preview.visible = false; return; }
    const old = this.preview.geometry;
    this.preview.geometry = buildWallGeometry(data, S);
    old.dispose();
    this.preview.visible = true;
  }

  hideTransient() {
    this.preview.visible = false;
  }
}
