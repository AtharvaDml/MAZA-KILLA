import { Group, Mesh, Ray, Raycaster, Vector3, type Intersection } from 'three';
import type { MaterialSet } from '../render/materials';
import { buildWallGeometry, sampleWall, wallFrameAt, type WallData, type WallSamples } from './wallGeometry';

export type { WallData } from './wallGeometry';

interface WallRecord {
  data: WallData;
  mesh: Mesh;
  samples: WallSamples | null;
  bbox: [number, number, number, number];
  hl: 'none' | 'hover' | 'selected';
}

export interface WallHit { id: string; point: Vector3; distance: number; normal: Vector3 }

type HeightFn = (x: number, z: number) => number;

export function cloneWall(d: WallData): WallData {
  return {
    ...d,
    points: d.points.map(([x, z]) => [x, z] as [number, number]),
    openings: d.openings.map((o) => ({ ...o })),
  };
}

export class WallSystem {
  readonly group = new Group();
  private readonly records = new Map<string, WallRecord>();
  private readonly raycaster = new Raycaster();
  version = 0;

  constructor(private readonly materials: MaterialSet, private height: HeightFn) {
    this.group.name = 'walls';
  }

  setHeightFn(fn: HeightFn) {
    this.height = fn;
  }

  get count() {
    return this.records.size;
  }

  add(data: WallData) {
    if (this.records.has(data.id)) return;
    const mesh = new Mesh(undefined, this.materials.wall.normal);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'wall:' + data.id;
    mesh.userData.wallId = data.id;
    const rec: WallRecord = { data: cloneWall(data), mesh, samples: null, bbox: [0, 0, 0, 0], hl: 'none' };
    this.records.set(data.id, rec);
    this.group.add(mesh);
    this.rebuild(rec);
    this.version++;
  }

  remove(id: string): WallData | undefined {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    this.group.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    this.records.delete(id);
    this.version++;
    return cloneWall(rec.data);
  }

  update(data: WallData) {
    const rec = this.records.get(data.id);
    if (!rec) return this.add(data);
    rec.data = cloneWall(data);
    this.rebuild(rec);
    this.version++;
  }

  get(id: string): WallData | undefined {
    const r = this.records.get(id);
    return r ? cloneWall(r.data) : undefined;
  }

  has(id: string) {
    return this.records.has(id);
  }

  all(): WallData[] {
    return [...this.records.values()].map((r) => cloneWall(r.data));
  }

  samples(id: string): WallSamples | null {
    return this.records.get(id)?.samples ?? null;
  }

  clear() {
    for (const r of this.records.values()) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
    }
    this.records.clear();
    this.version++;
  }

  private rebuild(rec: WallRecord) {
    const S = sampleWall(rec.data, this.height);
    rec.samples = S;
    const old = rec.mesh.geometry;
    if (S) {
      rec.mesh.geometry = buildWallGeometry(rec.data, S);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < S.count; i++) {
        x0 = Math.min(x0, S.x[i]); x1 = Math.max(x1, S.x[i]);
        z0 = Math.min(z0, S.z[i]); z1 = Math.max(z1, S.z[i]);
      }
      const pad = S.halfBase * 1.6;
      rec.bbox = [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
      rec.mesh.visible = true;
    } else {
      rec.mesh.visible = false;
    }
    if (old && old !== rec.mesh.geometry) old.dispose();
  }

  /** Re-conform walls whose footprint overlaps an XZ rect (after terrain edits). Returns ids rebuilt. */
  regenerateInRect(x0: number, z0: number, x1: number, z1: number): string[] {
    const out: string[] = [];
    for (const rec of this.records.values()) {
      const [a, b, c, d] = rec.bbox;
      if (c < x0 || a > x1 || d < z0 || b > z1) continue;
      this.rebuild(rec);
      out.push(rec.data.id);
    }
    if (out.length) this.version++;
    return out;
  }

  regenerateAll() {
    for (const rec of this.records.values()) this.rebuild(rec);
    this.version++;
  }

  setHighlight(id: string, hl: 'none' | 'hover' | 'selected') {
    const rec = this.records.get(id);
    if (!rec || rec.hl === hl) return;
    rec.hl = hl;
    rec.mesh.material = hl === 'selected' ? this.materials.wall.selected : hl === 'hover' ? this.materials.wall.hover : this.materials.wall.normal;
  }

  pick(ray: Ray, exclude?: Set<string>): WallHit | null {
    this.raycaster.ray.copy(ray);
    let best: WallHit | null = null;
    const hits: Intersection[] = [];
    for (const rec of this.records.values()) {
      if (exclude?.has(rec.data.id) || !rec.mesh.visible) continue;
      hits.length = 0;
      rec.mesh.raycast(this.raycaster, hits);
      for (const h of hits) {
        if (!best || h.distance < best.distance) {
          best = {
            id: rec.data.id,
            point: h.point.clone(),
            distance: h.distance,
            normal: h.face ? h.face.normal.clone() : new Vector3(0, 1, 0),
          };
        }
      }
    }
    return best;
  }

  /** Height of a wall's walkable top (walkway or parapet) at x,z, if that point lies on a wall. */
  surfaceAt(x: number, z: number, exclude?: Set<string>): { y: number; wallId: string } | null {
    let best: { y: number; wallId: string } | null = null;
    for (const rec of this.records.values()) {
      if (exclude?.has(rec.data.id)) continue;
      const S = rec.samples;
      if (!S) continue;
      const [a, b, c, d] = rec.bbox;
      if (x < a || x > c || z < b || z > d) continue;
      let bi = -1, bd = Infinity;
      for (let i = 0; i < S.count; i++) {
        const dx = x - S.x[i], dz = z - S.z[i];
        const dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; bi = i; }
      }
      if (bi < 0) continue;
      const m = S.miter[bi];
      const lat = (x - S.x[bi]) * S.nx[bi] + (z - S.z[bi]) * S.nz[bi];
      const along2 = bd - lat * lat;
      if (along2 > 0.7 * 0.7) continue;
      let y: number | null = null;
      if (lat <= S.halfTop * m && lat >= (S.halfTop - S.parapetT) * m) y = S.top[bi] + S.parapetH;
      else if (lat < (S.halfTop - S.parapetT) * m && lat >= -S.halfTop * m) y = S.top[bi];
      if (y !== null && (!best || y > best.y)) best = { y, wallId: rec.data.id };
    }
    return best;
  }

  /** Control-point handle positions (above the wall top). */
  handlePositions(id: string): Vector3[] {
    const rec = this.records.get(id);
    if (!rec?.samples) return [];
    const S = rec.samples;
    return rec.data.points.map(([x, z]) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < S.count; i++) {
        const dd = (x - S.x[i]) ** 2 + (z - S.z[i]) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      }
      return new Vector3(x, S.top[bi] + S.parapetH + 1.4, z);
    });
  }

  /** Arc-length positions along the outer parapet, for diya lines. */
  parapetPoints(id: string, spacing: number): { x: number; y: number; z: number; yaw: number }[] {
    const rec = this.records.get(id);
    const S = rec?.samples;
    if (!rec || !S) return [];
    const out: { x: number; y: number; z: number; yaw: number }[] = [];
    const total = rec.data.closed ? S.length : S.s[S.count - 1];
    const merlonSpacing = 1.55;
    const start = rec.data.battlement === 'none' ? spacing / 2 : merlonSpacing;
    const step = rec.data.battlement === 'none' ? spacing : Math.max(1, Math.round(spacing / merlonSpacing)) * merlonSpacing;
    for (let s = start; s < total - 0.4; s += step) {
      if (rec.data.openings.some((o) => Math.abs(o.t - s) < o.width / 2 + 0.5)) continue;
      const f = wallFrameAt(S, s);
      const off = (S.halfTop - S.parapetT / 2) * f.miter;
      out.push({ x: f.x + f.nx * off, y: f.top + S.parapetH, z: f.z + f.nz * off, yaw: Math.atan2(f.nx, f.nz) });
    }
    return out;
  }

  /** Nearest wall + arc length to a point (for inserting control points / snapping). */
  nearest(x: number, z: number): { id: string; index: number; dist: number } | null {
    let best: { id: string; index: number; dist: number } | null = null;
    for (const rec of this.records.values()) {
      const S = rec.samples;
      if (!S) continue;
      for (let i = 0; i < S.count; i++) {
        const d = Math.hypot(x - S.x[i], z - S.z[i]);
        if (!best || d < best.dist) best = { id: rec.data.id, index: i, dist: d };
      }
    }
    return best;
  }

  bbox(id: string) {
    return this.records.get(id)?.bbox;
  }
}
