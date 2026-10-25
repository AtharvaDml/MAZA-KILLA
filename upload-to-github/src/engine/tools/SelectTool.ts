import { Plane, Vector3 } from 'three';
import { getEditor, setEditor, type SelRef, type TransformMode } from '../../state/store';
import { getAsset } from '../objects/catalog';
import { cloneData, type ObjectData } from '../objects/ObjectSystem';
import { clamp, DEG } from '../util/math';
import { cloneWall, type WallData } from '../walls/WallSystem';
import { CompositeCommand, type Command } from '../history/History';
import { Tool, type PointerInfo } from './Tool';

/** riderOf: standing on another moving object (e.g. a cannon on a buruj) — keeps its height offset. */
interface ObjStart { d: ObjectData; lift: number; wallLift?: number; riderOf?: string; riderDy?: number }
interface Drag {
  mode: TransformMode;
  startX: number;
  startY: number;
  grab: Vector3;
  plane: Plane;
  center: Vector3;
  objects: ObjStart[];
  exWalls: Set<string>;
  exObjects: Set<string>;
  walls: { token: ReturnType<import('../Engine').Engine['beginWallEdit']>; start: WallData }[];
  moved: boolean;
  copies: boolean;
}

/** Selection and direct manipulation. Drag what you see; the ring only hints at the mode. */
export class SelectTool extends Tool {
  readonly id = 'select' as const;
  private drag: Drag | null = null;
  private handleDrag: { wallId: string; index: number; token: ReturnType<import('../Engine').Engine['beginWallEdit']>; moved: boolean } | null = null;
  private hoverDirty = true;
  private lastHoverAt = 0;
  private hotHandle: number | null = null;
  private activeHandle: { wallId: string; index: number } | null = null;

  activate() {
    this.e.refreshSelectionVisuals();
  }

  deactivate() {
    this.e.setHover(null);
    this.e.overlay.setHandles([], null, 1);
    this.e.overlay.showRing(null, 1, 'move');
  }

  private selectedWall(): string | null {
    const sel = getEditor().selection;
    return sel.length === 1 && sel[0].kind === 'wall' ? sel[0].id : null;
  }

  refreshHandles() {
    const id = this.selectedWall();
    if (!id || this.e.tool !== this) {
      this.e.overlay.setHandles([], null, 1);
      return;
    }
    const pos = this.e.walls.handlePositions(id);
    const scale = clamp(this.e.rig.distance / 90, 0.6, 2.2);
    const hot = this.handleDrag ? this.handleDrag.index : this.activeHandle?.wallId === id ? this.activeHandle.index : this.hotHandle;
    this.e.overlay.setHandles(pos, hot, scale);
  }

  /** Screen-space handle hit test (forgiving, ~16px). */
  private handleAt(p: PointerInfo): number | null {
    const id = this.selectedWall();
    if (!id) return null;
    const cam = this.e.rig.camera;
    const el = this.e.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    let best: number | null = null, bd = 18;
    this.e.walls.handlePositions(id).forEach((v, i) => {
      const s = v.clone().project(cam);
      if (s.z > 1) return;
      const sx = (s.x * 0.5 + 0.5) * w, sy = (-s.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  pointerDown(p: PointerInfo): boolean {
    if (p.button !== 0) return false;
    // Wall control point?
    const hi = this.handleAt(p);
    const wallId = this.selectedWall();
    if (hi !== null && wallId) {
      this.handleDrag = { wallId, index: hi, token: this.e.beginWallEdit(wallId), moved: false };
      this.activeHandle = { wallId, index: hi };
      setEditor((s) => ({ inspector: s.inspector?.kind === 'wall' ? { ...s.inspector, handle: hi } : s.inspector }));
      this.e.setCursor('grabbing');
      return true;
    }
    const hit = this.e.pick(p.ray);
    if (!hit) {
      // Alt-drag on empty space orbits; plain drag on empty space orbits too.
      return false;
    }
    const ref: SelRef = { kind: hit.kind, id: hit.id };
    this.activeHandle = null;
    if (p.shift) {
      const sel = getEditor().selection;
      const exists = this.e.isSelected(ref);
      this.e.setSelection(exists ? sel.filter((r) => !(r.kind === ref.kind && r.id === ref.id)) : [...sel, ref]);
      return true;
    }
    if (!this.e.isSelected(ref)) this.e.setSelection([ref]);
    let copies = false;
    if (p.alt) {
      this.e.duplicateSelection(false);
      copies = true;
    }
    this.beginDrag(p, hit.point, copies);
    return true;
  }

  private beginDrag(p: PointerInfo, grabPoint: Vector3, copies: boolean) {
    const sel = getEditor().selection;
    const objIds = new Set(sel.filter((r) => r.kind === 'object').map((r) => r.id));
    const wallIds = sel.filter((r) => r.kind === 'wall').map((r) => r.id);
    // Objects standing on a selected wall travel with it.
    for (const w of wallIds) for (const o of this.e.objects.attachedTo('w:' + w)) objIds.add(o.id);
    // ...and so do things standing on a moving object (cannons on a buruj).
    for (const id of [...objIds]) for (const r of this.e.objects.attachedTo('o:' + id)) objIds.add(r.id);
    const exWalls = new Set(wallIds);
    const objects: ObjStart[] = [...objIds].map((id) => {
      const d = this.e.objects.get(id)!;
      const base = d.att?.startsWith('o:') && objIds.has(d.att.slice(2)) ? this.e.objects.get(d.att.slice(2)) : undefined;
      const surf = this.e.surfaceHeight(d.p[0], d.p[2], exWalls, this.allowWalls(d), objIds).y;
      const onMovingWall = d.att?.startsWith('w:') && exWalls.has(d.att.slice(2));
      const ws = onMovingWall ? this.e.walls.surfaceAt(d.p[0], d.p[2]) : null;
      return { d, lift: d.p[1] - surf, wallLift: ws ? d.p[1] - ws.y : undefined, riderOf: base?.id, riderDy: base ? d.p[1] - base.p[1] : undefined };
    }).filter((o) => o.d).sort((a, b) => Number(!!a.riderOf) - Number(!!b.riderOf));
    const sc = this.e.selectionCenter();
    const center = sc ? sc.center.clone() : grabPoint.clone();
    const grabSurf = this.e.surfaceHit(p.ray, { excludeObjects: objIds, excludeWalls: exWalls });
    const grab = grabSurf ? grabSurf.point.clone() : grabPoint.clone();
    this.drag = {
      mode: getEditor().transformMode,
      startX: p.x,
      startY: p.y,
      grab,
      plane: new Plane(new Vector3(0, 1, 0), -grab.y),
      center,
      objects,
      exWalls,
      exObjects: objIds,
      // Attached objects move with the drag itself, so the wall edit must not re-seat them.
      walls: wallIds.map((id) => ({ token: this.e.beginWallEdit(id, false), start: this.e.walls.get(id)! })),
      moved: false,
      copies,
    };
    this.e.setCursor('grabbing');
  }

  private allowWalls(d: ObjectData) {
    return !!d.att || this.e.wallFriendly(d.type);
  }

  pointerMove(p: PointerInfo, captured: boolean) {
    if (!captured) { this.hoverDirty = true; return; }
    if (this.handleDrag) {
      const g = this.e.terrain.raycast(p.ray);
      if (!g) return;
      const w = this.e.walls.get(this.handleDrag.wallId);
      if (!w) return;
      const h = this.e.terrain.half - 1;
      w.points[this.handleDrag.index] = [clamp(g.x, -h, h), clamp(g.z, -h, h)];
      this.e.walls.update(w);
      this.handleDrag.moved = true;
      this.refreshHandles();
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) < 3) return;
    d.moved = true;
    const { exObjects, exWalls } = d;
    const snap = getEditor().place.gridSnap ? getEditor().place.gridSize : 0;

    if (d.mode === 'move') {
      const hit = this.e.surfaceHit(p.ray, { excludeObjects: exObjects, excludeWalls: exWalls }) ;
      const pt = hit?.point ?? p.ray.intersectPlane(d.plane, new Vector3());
      if (!pt) return;
      let dx = pt.x - d.grab.x, dz = pt.z - d.grab.z;
      if (snap && d.objects.length) {
        const a = d.objects[0].d.p;
        dx = Math.round((a[0] + dx) / snap) * snap - a[0];
        dz = Math.round((a[2] + dz) / snap) * snap - a[2];
      }
      this.applyMove(d, dx, dz);
    } else if (d.mode === 'rotate') {
      let ang = (p.x - d.startX) * 0.012;
      if (p.shift) ang = Math.round(ang / (15 * DEG)) * 15 * DEG;
      this.applyRotate(d, ang);
    } else {
      const f = clamp(Math.exp((d.startY - p.y) * 0.007 + (p.x - d.startX) * 0.002), 0.15, 8);
      this.applyScale(d, f);
    }
    this.e.refreshSelectionVisuals();
  }

  private placeObject(o: ObjStart, x: number, z: number, d: Drag): ObjectData {
    const n = cloneData(o.d);
    const h = this.e.terrain.half - 0.3;
    n.p[0] = clamp(x, -h, h);
    n.p[2] = clamp(z, -h, h);
    if (o.riderOf) {
      const base = this.e.objects.get(o.riderOf);
      n.p[1] = (base?.p[1] ?? n.p[1]) + (o.riderDy ?? 0);
      return n;
    }
    const s = this.e.surfaceHeight(n.p[0], n.p[2], d.exWalls, this.allowWalls(o.d), d.exObjects);
    n.p[1] = s.y + o.lift;
    const att = this.e.attachFor(s);
    if (att) n.att = att;
    else if (o.d.att?.startsWith('w:') && d.exWalls.has(o.d.att.slice(2))) { /* riding a moving wall */ }
    else {
      // Leaving a wall: big things settle back onto the ground.
      if (o.d.att && !this.e.wallFriendly(o.d.type)) n.p[1] = s.y;
      delete n.att;
    }
    return n;
  }

  private applyMove(d: Drag, dx: number, dz: number) {
    for (const w of d.walls) {
      const n = cloneWall(w.start);
      n.points = n.points.map(([x, z]) => [x + dx, z + dz]);
      this.e.walls.update(n);
    }
    for (const o of d.objects) this.e.objects.update(this.placeObject(o, o.d.p[0] + dx, o.d.p[2] + dz, d));
  }

  private applyRotate(d: Drag, ang: number) {
    const c = d.center;
    const cs = Math.cos(-ang), sn = Math.sin(-ang);
    const rot = (x: number, z: number): [number, number] => {
      const dx = x - c.x, dz = z - c.z;
      return [c.x + dx * cs - dz * sn, c.z + dx * sn + dz * cs];
    };
    for (const w of d.walls) {
      const n = cloneWall(w.start);
      n.points = n.points.map(([x, z]) => rot(x, z));
      this.e.walls.update(n);
    }
    const multi = d.objects.length > 1 || d.walls.length > 0;
    for (const o of d.objects) {
      const [x, z] = multi ? rot(o.d.p[0], o.d.p[2]) : [o.d.p[0], o.d.p[2]];
      const n = this.placeObject(o, x, z, d);
      n.r[1] = o.d.r[1] + ang;
      this.e.objects.update(n);
    }
  }

  private applyScale(d: Drag, f: number) {
    const c = d.center;
    for (const w of d.walls) {
      const n = cloneWall(w.start);
      n.points = n.points.map(([x, z]) => [c.x + (x - c.x) * f, c.z + (z - c.z) * f]);
      this.e.walls.update(n);
    }
    const multi = d.objects.length > 1 || d.walls.length > 0;
    for (const o of d.objects) {
      const a = getAsset(o.d.type);
      const lo = (a?.scale[0] ?? 0.3) * 0.5, hi = (a?.scale[1] ?? 3) * 1.5;
      const x = multi ? c.x + (o.d.p[0] - c.x) * f : o.d.p[0];
      const z = multi ? c.z + (o.d.p[2] - c.z) * f : o.d.p[2];
      const n = this.placeObject(o, x, z, d);
      const k = clamp(o.d.s[0] * f, lo, hi);
      n.s = [k, k * (o.d.s[1] / o.d.s[0]), k * (o.d.s[2] / o.d.s[0])];
      this.e.objects.update(n);
    }
  }

  pointerUp() {
    this.e.setCursor(this.cursor);
    if (this.handleDrag) {
      const hd = this.handleDrag;
      this.handleDrag = null;
      if (hd.moved) {
        this.e.commitWallEdit(hd.token, 'Move wall point');
        this.e.refreshInspector();
      }
      this.refreshHandles();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.moved) {
      if (d.copies) this.e.undo(); // Alt-click without dragging: discard the copies
      return;
    }
    // Re-seat objects that rode along on a moved wall exactly on its regenerated top.
    for (const o of d.objects) {
      if (o.wallLift === undefined) continue;
      const cur = this.e.objects.get(o.d.id);
      const s = cur && this.e.walls.surfaceAt(cur.p[0], cur.p[2]);
      if (cur && s) { cur.p[1] = s.y + o.wallLift; cur.att = 'w:' + s.wallId; this.e.objects.update(cur); }
    }
    const cmds: Command[] = [];
    const before = d.objects.map((o) => o.d);
    const after = before.map((o) => this.e.objects.get(o.id)!).filter(Boolean);
    if (before.length) cmds.push(this.e.cmdUpdateObjects(before, after, 'Move'));
    for (const w of d.walls) {
      const c = this.e.commitWallEdit(w.token, 'Move wall', undefined, false);
      if (c) cmds.push(c);
    }
    const label = d.mode === 'move' ? 'Move' : d.mode === 'rotate' ? 'Rotate' : 'Scale';
    if (cmds.length) this.e.history.push(cmds.length === 1 ? Object.assign(cmds[0], { label }) : new CompositeCommand(label, cmds));
    this.e.refreshInspector();
    this.e.refreshSelectionVisuals();
  }

  click(p: PointerInfo) {
    // Plain click on empty ground clears the selection.
    if (!p.shift) {
      this.activeHandle = null;
      this.e.setSelection([]);
    }
  }

  doubleClick(p: PointerInfo) {
    const wallId = this.selectedWall();
    const hit = this.e.pick(p.ray);
    if (wallId && hit?.kind === 'wall' && hit.id === wallId) {
      // Insert a control point on the nearest segment.
      const w = this.e.walls.get(wallId)!;
      const P = w.points;
      let bi = 0, bd = Infinity;
      const segs = w.closed ? P.length : P.length - 1;
      for (let i = 0; i < segs; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = clamp(((hit.point.x - a[0]) * dx + (hit.point.z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(a[0] + dx * t - hit.point.x, a[1] + dz * t - hit.point.z);
        if (d < bd) { bd = d; bi = i; }
      }
      const token = this.e.beginWallEdit(wallId);
      w.points.splice(bi + 1, 0, [hit.point.x, hit.point.z]);
      this.e.walls.update(w);
      this.e.commitWallEdit(token, 'Add wall point');
      this.activeHandle = { wallId, index: bi + 1 };
      this.e.refreshInspector();
      this.refreshHandles();
      return;
    }
    if (hit) this.e.focusSelection();
  }

  key(ev: KeyboardEvent): boolean {
    if ((ev.code === 'Delete' || ev.code === 'Backspace') && this.activeHandle) {
      const { wallId, index } = this.activeHandle;
      this.activeHandle = null;
      this.e.deleteWallPoint(wallId, index);
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.activeHandle) { this.activeHandle = null; this.refreshHandles(); return true; }
    return false;
  }

  update() {
    if (this.drag || this.handleDrag) return;
    const now = performance.now();
    if (!this.hoverDirty && !this.e.rig.moving) return;
    if (now - this.lastHoverAt < 40) return;
    this.lastHoverAt = now;
    this.hoverDirty = false;
    const p = this.e.input.refreshRay();
    if (!p) { this.e.setHover(null); return; }
    const hi = this.handleAt(p);
    if (hi !== this.hotHandle) { this.hotHandle = hi; this.refreshHandles(); }
    if (hi !== null) { this.e.setCursor('grab'); this.e.setHover(null); return; }
    const hit = this.e.pick(p.ray);
    this.e.setHover(hit ? { kind: hit.kind, id: hit.id } : null);
    this.e.setCursor(hit ? 'pointer' : 'default');
    if (this.e.rig.moving && this.selectedWall()) this.refreshHandles();
  }
}
