import { Euler, Quaternion, Ray, Vector3 } from 'three';
import { getEditor, setEditor, toast } from '../../state/store';
import { getAsset, type AssetDef } from '../objects/catalog';
import type { ObjectData } from '../objects/ObjectSystem';
import { uid } from '../util/id';
import { clamp, DEG } from '../util/math';
import { Tool, type PointerInfo } from './Tool';

interface Candidate { p: Vector3; q: Quaternion; wallId?: string; objectId?: string; state: 'ok' | 'warn' | 'bad'; reason?: string }

const UP = new Vector3(0, 1, 0);

/** Click-to-place with a live ghost, or paint many at once with the scatter brush. */
export class PlaceTool extends Tool {
  readonly id = 'place' as const;
  private assetId: string | null = null;
  private asset: AssetDef | null = null;
  private yaw = 0;
  private scaleK = 1;
  private variant = 0;
  private cand: Candidate | null = null;
  private scatter: { placed: ObjectData[]; removed: ObjectData[]; acc: number; erase: boolean; eraseT: number } | null = null;
  private lastWarn = 0;

  activate() {
    this.assetId = null;
    this.sync();
  }

  deactivate() {
    if (this.scatter) this.endScatter();
    this.e.overlay.setGhost(null);
    this.assetId = null;
    this.e.terrain.material.userData.k.uBrushOn.value = 0;
  }

  private sync() {
    const id = getEditor().place.assetId;
    if (id === this.assetId) return;
    this.assetId = id;
    this.asset = id ? getAsset(id) ?? null : null;
    this.e.overlay.setGhost(this.asset);
    this.randomize(true);
  }

  private scatterMode() {
    return !!this.asset?.scatter && getEditor().place.scatter;
  }

  private randomize(first = false) {
    const a = this.asset;
    if (!a) return;
    const s = getEditor().place;
    if (s.randomRotate && a.randomYaw) this.yaw = Math.random() * Math.PI * 2;
    else if (first) this.yaw = 0;
    this.scaleK = s.randomScale && a.jitterScale ? 1 + (Math.random() * 2 - 1) * a.jitterScale : 1;
    this.variant = a.category === 'nature' && a.variants && s.randomScale ? Math.floor(Math.random() * Math.min(3, a.variants.length)) : 0;
  }

  private candidate(ray: Ray): Candidate | null {
    const a = this.asset!;
    const s = getEditor().place;
    const allowWalls = this.e.wallFriendly(a.id);
    const hit = this.e.surfaceHit(ray, { walls: allowWalls });
    if (!hit) return null;
    let x = hit.point.x, z = hit.point.z, y = hit.point.y;
    let wallId = hit.wallId, objectId = hit.objectId;
    if (s.gridSnap) {
      const g = s.gridSize;
      x = Math.round(x / g) * g;
      z = Math.round(z / g) * g;
      const sh = this.e.surfaceHeight(x, z, undefined, allowWalls);
      y = sh.y;
      wallId = sh.wallId;
      objectId = sh.objectId;
    }
    let snapped = false;
    if (a.platform && !s.gridSnap) {
      // Bastions snap onto a nearby wall line, crowning it just above the parapet.
      const nb = this.e.walls.nearest(x, z);
      const S = nb ? this.e.walls.samples(nb.id) : null;
      if (nb && S && nb.dist < a.radius * this.scaleK + 3) {
        x = S.x[nb.index];
        z = S.z[nb.index];
        y = S.top[nb.index] + S.parapetH + 0.5 - (a.platform.y + 1.2) * this.scaleK;
        wallId = nb.id;
        objectId = undefined;
        snapped = true;
      }
    }
    const q = new Quaternion().setFromAxisAngle(UP, this.yaw);
    if (a.align && !wallId && !objectId) {
      const n = this.e.terrain.normalAt(x, z);
      q.premultiply(new Quaternion().setFromUnitVectors(UP, n));
    }
    const half = this.e.terrain.half;
    let state: Candidate['state'] = 'ok';
    let reason: string | undefined;
    const r = a.radius * this.scaleK;
    if (Math.abs(x) > half - 0.4 || Math.abs(z) > half - 0.4) { state = 'bad'; reason = 'That spot is outside your plot'; }
    else {
      const overlap = this.e.objects.queryCircle(x, z, r * 0.6).filter((o) => {
        const oa = getAsset(o.type);
        return oa && oa.height > 0.3 && Math.abs(o.p[1] - y) < Math.max(oa.height, a.height);
      });
      const onWallFootprint = !wallId && !!this.e.walls.surfaceAt(x, z);
      if (s.strict && ((overlap.length && !objectId) || onWallFootprint)) { state = 'bad'; reason = 'Strict placement: overlapping'; }
      else if (overlap.length > 0 && a.height > 0.3 && !objectId && !snapped) state = 'warn';
    }
    return { p: new Vector3(x, y, z), q, wallId, objectId, state, reason };
  }

  pointerDown(p: PointerInfo): boolean {
    if (p.button !== 0 || !this.asset) return false;
    if (this.scatterMode()) {
      const hit = this.e.terrain.raycast(p.ray);
      if (!hit) return false;
      this.scatter = { placed: [], removed: [], acc: 0, erase: p.ctrl, eraseT: 0 };
      return true;
    }
    const c = this.candidate(p.ray);
    if (!c) return false;
    if (c.state === 'bad') {
      const now = performance.now();
      if (now - this.lastWarn > 1500) { toast(c.reason ?? 'Cannot place there', 'warn', 1600); this.lastWarn = now; }
      return true;
    }
    const e = new Euler().setFromQuaternion(c.q, 'YXZ');
    const k = this.scaleK;
    const data: ObjectData = { id: uid(), type: this.asset.id, p: [c.p.x, c.p.y, c.p.z], r: [e.x, e.y, e.z], s: [k, k, k] };
    if (this.variant) data.v = this.variant;
    const att = this.e.attachFor(c);
    if (att) data.att = att;
    this.e.exec(this.e.cmdAddObjects([data], `Place ${this.asset.name}`));
    this.randomize();
    return true;
  }

  pointerUp() {
    if (this.scatter) this.endScatter();
  }

  private endScatter() {
    const s = this.scatter!;
    this.scatter = null;
    if (s.placed.length) this.e.history.push(this.e.cmdAddObjects(s.placed, `Plant ${s.placed.length} ${this.asset?.name ?? ''}`.trim()));
    if (s.removed.length) this.e.history.push(this.e.cmdRemoveObjects(s.removed, `Clear ${s.removed.length}`));
  }

  wheel(p: PointerInfo, dy: number): boolean {
    if (!p.shift || !this.asset) return false;
    this.yaw += Math.sign(dy) * 15 * DEG;
    return true;
  }

  key(ev: KeyboardEvent): boolean {
    if (!this.asset) return false;
    if (ev.code === 'KeyQ' || ev.code === 'KeyE') {
      this.yaw += (ev.code === 'KeyQ' ? 1 : -1) * (ev.shiftKey ? 5 : 15) * DEG;
      return true;
    }
    if ((ev.code === 'BracketLeft' || ev.code === 'BracketRight') && this.scatterMode()) {
      const s = getEditor().place;
      setEditor({ place: { ...s, brush: clamp(s.brush * (ev.code === 'BracketLeft' ? 0.85 : 1.18), 1.5, 40) } });
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.scatter) { this.endScatter(); return true; }
    return false;
  }

  update(dt: number) {
    this.sync();
    const p = this.e.input.refreshRay();
    const k = this.e.terrain.material.userData.k;
    const a = this.asset;
    if (!a || !p) {
      this.e.overlay.updateGhost(null, new Quaternion(), 1, 'ok');
      k.uBrushOn.value = 0;
      return;
    }
    if (this.scatterMode()) {
      this.e.overlay.updateGhost(null, new Quaternion(), 1, 'ok');
      const hit = this.e.terrain.raycast(p.ray);
      const s = getEditor().place;
      k.uBrushOn.value = hit && this.e.terrain.inside(hit.x, hit.z) ? 1 : 0;
      if (!hit) return;
      k.uBrushPos.value.set(hit.x, hit.z);
      k.uBrushRadius.value = s.brush;
      k.uBrushHard.value = 0.7;
      if (this.scatter?.erase || (p.ctrl && !this.scatter)) k.uBrushColor.value.setRGB(1, 0.55, 0.45);
      else k.uBrushColor.value.setRGB(0.75, 1, 0.65);
      if (this.scatter) this.scatterStep(hit, dt);
      return;
    }
    k.uBrushOn.value = 0;
    this.cand = this.candidate(p.ray);
    if (!this.cand) {
      this.e.overlay.updateGhost(null, new Quaternion(), 1, 'ok');
      return;
    }
    this.e.overlay.updateGhost(this.cand.p, this.cand.q, this.scaleK, this.cand.state);
  }

  private scatterStep(hit: Vector3, dt: number) {
    const a = this.asset!;
    const st = this.scatter!;
    const s = getEditor().place;
    const R = s.brush;
    if (st.erase) {
      st.eraseT += dt;
      if (st.eraseT < 0.05) return;
      st.eraseT = 0;
      const victims = this.e.objects.queryCircle(hit.x, hit.z, R * 0.6).filter((o) => getAsset(o.type)?.scatter).slice(0, 25);
      for (const v of victims) {
        const d = this.e.objects.remove(v.id);
        if (d) st.removed.push(d);
      }
      return;
    }
    const area = Math.PI * R * R;
    const footprint = Math.max(0.15, a.radius * a.radius * 3);
    const rate = ((0.08 + s.density * 1.4) * area) / footprint * 0.5;
    st.acc += rate * dt;
    let n = Math.min(40, Math.floor(st.acc));
    st.acc -= n;
    const half = this.e.terrain.half;
    while (n-- > 0) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R;
      const x = hit.x + Math.cos(ang) * rr, z = hit.z + Math.sin(ang) * rr;
      if (Math.abs(x) > half - 0.5 || Math.abs(z) > half - 0.5) continue;
      const k = s.randomScale && a.jitterScale ? 1 + (Math.random() * 2 - 1) * a.jitterScale : 1;
      const spacing = a.radius * k * (1.6 - s.density * 0.9);
      if (this.e.objects.queryCircle(x, z, spacing).some((o) => o.type === a.id)) continue;
      if (this.e.walls.surfaceAt(x, z)) continue;
      const y = this.e.terrain.heightAt(x, z);
      const q = new Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2);
      if (a.align) q.premultiply(new Quaternion().setFromUnitVectors(UP, this.e.terrain.normalAt(x, z)));
      const e = new Euler().setFromQuaternion(q, 'YXZ');
      const data: ObjectData = { id: uid(), type: a.id, p: [x, y, z], r: [e.x, e.y, e.z], s: [k, k, k] };
      if (a.variants) {
        const v = Math.floor(Math.random() * Math.min(3, a.variants.length));
        if (v) data.v = v;
      }
      this.e.objects.add(data);
      st.placed.push(data);
    }
  }

  hideTransient() {
    this.e.overlay.updateGhost(null, new Quaternion(), 1, 'ok');
  }
}
