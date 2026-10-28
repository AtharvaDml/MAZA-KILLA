import { BufferAttribute, BufferGeometry, CatmullRomCurve3, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { getEditor, setEditor, toast } from '../../state/store';
import { uid } from '../util/id';
import { WATER_PRESETS, type WaterData } from '../water/waterData';
import { Tool, type PointerInfo } from './Tool';

const CLOSE_DIST = 3;
const FREEHAND_STEP = 1.2;

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
 * Draw water. AREA kinds (pond, lake, tank): click around a shape and close it.
 * FLOW kinds (moat, river, stream, waterfall): click or sketch a path; double-click / Enter to finish,
 * click the first point (or C) to close a ring — handy for a moat around the walls.
 */
export class WaterTool extends Tool {
  readonly id = 'water' as const;
  cursor = 'crosshair';
  private points: [number, number][] = [];
  private freehand: [number, number][] | null = null;
  private downAt: { x: number; y: number } | null = null;
  private downGround: [number, number] | null = null;
  private cursorPt: [number, number] | null = null;
  private readonly preview: Mesh;
  private dirty = true;
  private sig = '';

  constructor(e: ConstructorParameters<typeof Tool>[0]) {
    super(e);
    this.preview = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }));
    this.preview.renderOrder = 16;
    this.preview.visible = false;
    e.scene.add(this.preview);
  }

  activate() { this.reset(); }
  deactivate() { this.reset(); }

  private kind() { return getEditor().water.kind; }
  private preset() { return WATER_PRESETS[this.kind()]; }

  private reset() {
    this.points = [];
    this.freehand = null;
    this.downAt = null;
    this.preview.visible = false;
    this.e.overlay.setMarkers([], null, 1);
    setEditor((s) => ({ water: { ...s.water, drawing: false, points: 0 } }));
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
      this.freehand = [this.points.length ? this.points[this.points.length - 1] : this.downGround ?? g];
    }
    if (this.freehand) {
      const last = this.freehand[this.freehand.length - 1];
      if (Math.hypot(g[0] - last[0], g[1] - last[1]) >= FREEHAND_STEP) this.freehand.push(g);
    }
  }

  pointerUp(p: PointerInfo) {
    const g = this.ground(p) ?? this.cursorPt;
    const area = this.preset().mode === 'area';
    if (this.freehand) {
      if (g) this.freehand.push(g);
      const simple = rdp(this.freehand, 0.6);
      for (const pt of simple.slice(this.points.length ? 1 : 0)) this.pushPoint(pt);
      this.freehand = null;
      this.downAt = null;
      this.dirty = true;
      // A sketch that returns to its start closes the shape.
      if (this.points.length >= 4) {
        const a = this.points[0], b = this.points[this.points.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < CLOSE_DIST * 1.5) { this.points.pop(); this.finish(true); return; }
      }
      if (area && this.points.length >= 6) { this.finish(true); return; }
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
    if (last && Math.hypot(last[0] - pt[0], last[1] - pt[1]) < 0.8) return;
    this.points.push([pt[0], pt[1]]);
    setEditor((s) => ({ water: { ...s.water, drawing: true, points: this.points.length } }));
  }

  doubleClick() {
    if (this.points.length >= 2) this.finish(this.preset().mode === 'area');
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
      if (this.points.length >= 2) this.finish(this.preset().mode === 'area');
      return true;
    }
    if (ev.code === 'Backspace' && this.points.length) {
      this.points.pop();
      setEditor((s) => ({ water: { ...s.water, drawing: this.points.length > 0, points: this.points.length } }));
      this.dirty = true;
      return true;
    }
    if (ev.code === 'KeyC' && this.points.length >= 3) { this.finish(true); return true; }
    return false;
  }

  cancel(): boolean {
    if (this.points.length || this.freehand) { this.reset(); return true; }
    return false;
  }

  private finish(closed: boolean) {
    const pts = this.points.slice();
    const pr = this.preset();
    const s = getEditor().water;
    if (pr.mode === 'area' && pts.length < 3) { toast('Draw at least three points around the water', 'warn'); return; }
    if (pts.length < 2) { this.reset(); return; }
    const data: WaterData = {
      id: uid(), kind: s.kind, mode: pr.mode, points: pts, closed: pr.mode === 'area' ? true : closed && pts.length >= 3,
      level: null, depth: s.depth, width: pr.mode === 'flow' ? s.width : 0, shore: s.shore, flow: s.flow,
      color: s.color, clarity: s.clarity, reflect: s.reflect, openings: [],
    };
    this.reset();
    const id = this.e.createWater(data, s.carve);
    if (id) this.e.setSelection([{ kind: 'water', id }]);
  }

  update() {
    const p = this.e.input.refreshRay();
    if (p) {
      const g = this.ground(p);
      if (g && (!this.cursorPt || g[0] !== this.cursorPt[0] || g[1] !== this.cursorPt[1])) { this.cursorPt = g; this.dirty = true; }
    }
    const s = getEditor().water;
    const sig = `${s.kind}|${s.width}|${s.shore}`;
    if (sig !== this.sig) { this.sig = sig; this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;

    const pts: [number, number][] = [...this.points];
    if (this.freehand) pts.push(...this.freehand.slice(this.points.length ? 1 : 0));
    else if (this.cursorPt && pts.length) pts.push(this.cursorPt);
    const closable = !this.freehand && this.points.length >= 3 && !!this.cursorPt &&
      Math.hypot(this.points[0][0] - this.cursorPt[0], this.points[0][1] - this.cursorPt[1]) < CLOSE_DIST;
    if (closable) pts.pop();

    const hAt = (x: number, z: number) => this.e.terrain.heightAt(x, z);
    const markers = this.points.map(([x, z]) => new Vector3(x, hAt(x, z) + 1.6, z));
    if (this.cursorPt && !this.freehand) markers.push(new Vector3(this.cursorPt[0], hAt(this.cursorPt[0], this.cursorPt[1]) + 1.6, this.cursorPt[1]));
    this.e.overlay.setMarkers(markers, closable ? 0 : null, 1);

    const area = this.preset().mode === 'area';
    if (pts.length < 2) { this.preview.visible = false; return; }
    const closed = area ? pts.length >= 3 : closable;
    const width = area ? 0.7 : Math.max(0.6, s.width);
    const old = this.preview.geometry;
    this.preview.geometry = drapedRibbon(pts, closed, width, hAt);
    old.dispose();
    this.preview.visible = true;
  }

  hideTransient() {
    this.preview.visible = false;
  }
}

/** A translucent band laid over the ground along the drawn path. */
function drapedRibbon(pts: [number, number][], closed: boolean, width: number, h: (x: number, z: number) => number): BufferGeometry {
  const v = pts.map(([x, z]) => new Vector3(x, 0, z));
  let line: Vector3[];
  if (v.length >= 3) {
    const c = new CatmullRomCurve3(v, closed, 'centripetal', 0.5);
    line = c.getSpacedPoints(Math.max(8, Math.ceil(c.getLength() / 1)));
  } else {
    line = [v[0], v[1]];
    const n = Math.max(2, Math.ceil(v[0].distanceTo(v[1])));
    line = Array.from({ length: n + 1 }, (_, i) => v[0].clone().lerp(v[1], i / n));
  }
  const pos: number[] = [], idx: number[] = [];
  line.forEach((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    for (const s of [-1, 1]) {
      const x = p.x - tz * s * width / 2, z = p.z + tx * s * width / 2;
      pos.push(x, h(x, z) + 0.25, z);
    }
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}
