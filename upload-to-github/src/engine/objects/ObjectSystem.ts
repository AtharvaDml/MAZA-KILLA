import {
  BufferGeometry, Color, Euler, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Ray,
  Raycaster, Sphere, Vector3, DynamicDrawUsage, type Intersection,
} from 'three';
import type { MaterialSet } from '../render/materials';
import type { Emitter } from '../terrain/Terrain';
import { buildCatalog, getAsset, type AssetDef } from './catalog';

export interface ObjectData {
  id: string;
  type: string;
  p: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
  v?: number;
  /** Attachment, e.g. 'w:<wallId>' when standing on a wall. */
  att?: string;
  g?: string;
}

interface ObjectRecord {
  data: ObjectData;
  asset: AssetDef;
  slots: number[];
  matrix: Matrix4;
  sphere: Sphere;
  hl: number;
}

const WHITE = new Color(1, 1, 1);

class Batch {
  mesh: InstancedMesh;
  owners: ObjectRecord[] = [];
  private hl: InstancedBufferAttribute;
  private capacity: number;

  constructor(
    readonly asset: AssetDef,
    readonly partIndex: number,
    private readonly geometry: BufferGeometry,
    private readonly materials: MaterialSet,
    private readonly parent: Group,
  ) {
    this.capacity = 16;
    this.hl = new InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.mesh = this.create(this.capacity);
  }

  private create(cap: number): InstancedMesh {
    const part = this.asset.parts[this.partIndex];
    this.hl = new InstancedBufferAttribute(new Float32Array(cap), 1);
    this.hl.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aHL', this.hl);
    const m = new InstancedMesh(this.geometry, this.materials.get(part.material), cap);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.castShadow = !!part.shadow;
    m.receiveShadow = part.material !== 'glow' && part.material !== 'flame';
    m.frustumCulled = false;
    m.name = `${this.asset.id}#${this.partIndex}`;
    m.setColorAt(0, WHITE);
    this.parent.add(m);
    return m;
  }

  private grow() {
    const old = this.mesh;
    const oldHl = this.hl;
    this.capacity *= 2;
    const m = this.create(this.capacity);
    (m.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (old.instanceColor && m.instanceColor) (m.instanceColor.array as Float32Array).set(old.instanceColor.array as Float32Array);
    (this.hl.array as Float32Array).set(oldHl.array as Float32Array);
    m.count = old.count;
    this.parent.remove(old);
    old.dispose();
    this.mesh = m;
    this.touch();
  }

  add(rec: ObjectRecord, color: Color): number {
    if (this.owners.length >= this.capacity) this.grow();
    const slot = this.owners.length;
    this.owners.push(rec);
    this.mesh.count = this.owners.length;
    this.mesh.setMatrixAt(slot, rec.matrix);
    this.mesh.setColorAt(slot, color);
    this.hl.setX(slot, rec.hl);
    this.touch();
    return slot;
  }

  /** Swap-remove. Returns the record that moved into `slot` (if any). */
  remove(slot: number): ObjectRecord | null {
    const last = this.owners.length - 1;
    let moved: ObjectRecord | null = null;
    if (slot !== last) {
      moved = this.owners[last];
      this.owners[slot] = moved;
      const m = new Matrix4();
      this.mesh.getMatrixAt(last, m);
      this.mesh.setMatrixAt(slot, m);
      const c = new Color();
      this.mesh.getColorAt(last, c);
      this.mesh.setColorAt(slot, c);
      this.hl.setX(slot, this.hl.getX(last));
    }
    this.owners.pop();
    this.mesh.count = this.owners.length;
    this.touch();
    return moved;
  }

  setMatrix(slot: number, m: Matrix4) {
    this.mesh.setMatrixAt(slot, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(slot: number, c: Color) {
    this.mesh.setColorAt(slot, c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  setHL(slot: number, v: number) {
    this.hl.setX(slot, v);
    this.hl.needsUpdate = true;
  }

  private touch() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.hl.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

export interface PickHit { id: string; point: Vector3; distance: number }

/** All placed props, rendered as GPU instances (one draw call per asset part). */
export class ObjectSystem {
  readonly group = new Group();
  private readonly records = new Map<string, ObjectRecord>();
  private readonly batches = new Map<string, Batch[]>();
  private readonly pickMesh = new Mesh();
  private readonly raycaster = new Raycaster();
  /** Bumped whenever emitters (lamps) change so the glow map can be rebuilt lazily. */
  emitterVersion = 0;
  version = 0;

  constructor(private readonly materials: MaterialSet) {
    this.group.name = 'objects';
    this.pickMesh.matrixAutoUpdate = false;
  }

  get count() {
    return this.records.size;
  }

  private batchesFor(asset: AssetDef): Batch[] {
    let b = this.batches.get(asset.id);
    if (!b) {
      // Each batch owns a geometry clone so its instanced attributes are independent.
      b = asset.parts.map((p, i) => new Batch(asset, i, p.geometry.clone(), this.materials, this.group));
      this.batches.set(asset.id, b);
    }
    return b;
  }

  static composeMatrix(d: ObjectData, out = new Matrix4()): Matrix4 {
    return out.compose(
      new Vector3(d.p[0], d.p[1], d.p[2]),
      new Quaternion().setFromEuler(new Euler(d.r[0], d.r[1], d.r[2], 'YXZ')),
      new Vector3(d.s[0], d.s[1], d.s[2]),
    );
  }

  private colorFor(asset: AssetDef, v?: number): Color {
    if (!asset.variants?.length) return WHITE;
    const vv = asset.variants[Math.min(v ?? 0, asset.variants.length - 1)];
    return new Color(vv.color);
  }

  private updateSphere(rec: ObjectRecord) {
    const geo = rec.asset.parts[0].geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    rec.sphere.center.copy(bs.center).applyMatrix4(rec.matrix);
    rec.sphere.radius = Math.max(bs.radius, rec.asset.height * 0.5) * Math.max(rec.data.s[0], rec.data.s[1], rec.data.s[2]);
  }

  add(data: ObjectData): boolean {
    const asset = getAsset(data.type);
    if (!asset || this.records.has(data.id)) return false;
    const rec: ObjectRecord = { data: cloneData(data), asset, slots: [], matrix: ObjectSystem.composeMatrix(data), sphere: new Sphere(), hl: 0 };
    this.updateSphere(rec);
    const color = this.colorFor(asset, data.v);
    this.batchesFor(asset).forEach((b) => rec.slots.push(b.add(rec, color)));
    this.records.set(data.id, rec);
    if (asset.emitter) this.emitterVersion++;
    this.version++;
    return true;
  }

  remove(id: string): ObjectData | undefined {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    const bs = this.batchesFor(rec.asset);
    bs.forEach((b, pi) => {
      const moved = b.remove(rec.slots[pi]);
      if (moved) moved.slots[pi] = rec.slots[pi];
    });
    this.records.delete(id);
    if (rec.asset.emitter) this.emitterVersion++;
    this.version++;
    return cloneData(rec.data);
  }

  update(data: ObjectData) {
    const rec = this.records.get(data.id);
    if (!rec) return;
    const variantChanged = rec.data.v !== data.v;
    rec.data = cloneData(data);
    ObjectSystem.composeMatrix(data, rec.matrix);
    this.updateSphere(rec);
    const bs = this.batchesFor(rec.asset);
    const color = variantChanged ? this.colorFor(rec.asset, data.v) : null;
    bs.forEach((b, pi) => {
      b.setMatrix(rec.slots[pi], rec.matrix);
      if (color) b.setColor(rec.slots[pi], color);
    });
    if (rec.asset.emitter) this.emitterVersion++;
    this.version++;
  }

  get(id: string): ObjectData | undefined {
    const r = this.records.get(id);
    return r ? cloneData(r.data) : undefined;
  }

  has(id: string) {
    return this.records.has(id);
  }

  assetOf(id: string): AssetDef | undefined {
    return this.records.get(id)?.asset;
  }

  setHighlight(id: string, v: number) {
    const rec = this.records.get(id);
    if (!rec || rec.hl === v) return;
    rec.hl = v;
    this.batchesFor(rec.asset).forEach((b, pi) => b.setHL(rec.slots[pi], v));
  }

  all(): ObjectData[] {
    return [...this.records.values()].map((r) => cloneData(r.data));
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  forEach(fn: (d: Readonly<ObjectData>, asset: AssetDef) => void) {
    for (const r of this.records.values()) fn(r.data, r.asset);
  }

  clear() {
    for (const list of this.batches.values()) list.forEach((b) => b.dispose());
    this.batches.clear();
    this.records.clear();
    this.emitterVersion++;
    this.version++;
  }

  sphereOf(id: string): Sphere | undefined {
    return this.records.get(id)?.sphere;
  }

  emitters(): Emitter[] {
    const out: Emitter[] = [];
    for (const r of this.records.values()) {
      const e = r.asset.emitter;
      if (!e) continue;
      const off = new Vector3(...e.offset).applyMatrix4(r.matrix);
      const s = r.data.s[0];
      out.push({ x: off.x, z: off.z, radius: e.radius * Math.sqrt(s), intensity: e.intensity });
    }
    return out;
  }

  emitterPoints(): { p: Vector3; intensity: number }[] {
    const out: { p: Vector3; intensity: number }[] = [];
    for (const r of this.records.values()) {
      const e = r.asset.emitter;
      if (!e) continue;
      out.push({ p: new Vector3(...e.offset).applyMatrix4(r.matrix), intensity: e.intensity });
    }
    return out;
  }

  /** Bounding-sphere broadphase, then exact triangle test on the few candidates. */
  pick(ray: Ray, exclude?: Set<string>): PickHit | null {
    const cands: { rec: ObjectRecord; t: number }[] = [];
    const tmp = new Vector3();
    for (const rec of this.records.values()) {
      if (exclude?.has(rec.data.id)) continue;
      const s = rec.sphere;
      tmp.subVectors(s.center, ray.origin);
      const t = tmp.dot(ray.direction);
      const d2 = tmp.lengthSq() - t * t;
      if (d2 > s.radius * s.radius || t < -s.radius) continue;
      cands.push({ rec, t });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.t - b.t);
    this.raycaster.ray.copy(ray);
    let best: PickHit | null = null as PickHit | null;
    const hits: Intersection[] = [];
    for (const { rec, t } of cands.slice(0, 24)) {
      if (best && t - rec.sphere.radius > best.distance) break;
      for (const part of rec.asset.parts) {
        if (part.noPick) continue;
        this.pickMesh.geometry = part.geometry;
        this.pickMesh.matrixWorld.copy(rec.matrix);
        hits.length = 0;
        this.pickMesh.raycast(this.raycaster, hits);
        for (const h of hits) {
          if (!best || h.distance < best.distance) best = { id: rec.data.id, point: h.point.clone(), distance: h.distance };
        }
      }
    }
    // Tiny props (grass, diyas) are hard to hit exactly; accept a near miss on the sphere.
    if (!best) {
      const small = cands.find((c) => c.rec.sphere.radius < 0.8);
      if (small) best = { id: small.rec.data.id, point: ray.at(small.t, new Vector3()), distance: small.t };
    }
    return best;
  }

  /** Ray against flat tops (e.g. a buruj platform). */
  platformHit(ray: Ray, exclude?: Set<string>): { id: string; point: Vector3; distance: number } | null {
    let best: { id: string; point: Vector3; distance: number } | null = null;
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    for (const rec of this.records.values()) {
      const pf = rec.asset.platform;
      if (!pf || exclude?.has(rec.data.id)) continue;
      const y = rec.data.p[1] + pf.y * rec.data.s[1];
      const t = (y - ray.origin.y) / ray.direction.y;
      if (t <= 0 || (best && t >= best.distance)) continue;
      const x = ray.origin.x + ray.direction.x * t, z = ray.origin.z + ray.direction.z * t;
      if (Math.hypot(x - rec.data.p[0], z - rec.data.p[2]) > pf.r * rec.data.s[0]) continue;
      best = { id: rec.data.id, point: new Vector3(x, y, z), distance: t };
    }
    return best;
  }

  /** Highest platform under x,z. */
  platformAt(x: number, z: number, exclude?: Set<string>): { y: number; id: string } | null {
    let best: { y: number; id: string } | null = null;
    for (const rec of this.records.values()) {
      const pf = rec.asset.platform;
      if (!pf || exclude?.has(rec.data.id)) continue;
      if (Math.hypot(x - rec.data.p[0], z - rec.data.p[2]) > pf.r * rec.data.s[0]) continue;
      const y = rec.data.p[1] + pf.y * rec.data.s[1];
      if (!best || y > best.y) best = { y, id: rec.data.id };
    }
    return best;
  }

  /** Objects whose footprint overlaps a circle (for strict placement / scatter spacing). */
  queryCircle(x: number, z: number, r: number, exclude?: Set<string>): ObjectData[] {
    const out: ObjectData[] = [];
    for (const rec of this.records.values()) {
      if (exclude?.has(rec.data.id)) continue;
      const rr = rec.asset.radius * rec.data.s[0] + r;
      const dx = rec.data.p[0] - x, dz = rec.data.p[2] - z;
      if (dx * dx + dz * dz < rr * rr) out.push(rec.data);
    }
    return out;
  }

  /** Objects whose base lies in an XZ rectangle. */
  inRect(x0: number, z0: number, x1: number, z1: number): ObjectData[] {
    const out: ObjectData[] = [];
    for (const rec of this.records.values()) {
      const [x, , z] = rec.data.p;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) out.push(rec.data);
    }
    return out;
  }

  attachedTo(att: string): ObjectData[] {
    const out: ObjectData[] = [];
    for (const rec of this.records.values()) if (rec.data.att === att) out.push(cloneData(rec.data));
    return out;
  }

  /** Make sure every asset's batch exists so shaders compile up front. */
  warm() {
    for (const a of buildCatalog()) this.batchesFor(a);
  }
}

export function cloneData(d: ObjectData): ObjectData {
  const o: ObjectData = { id: d.id, type: d.type, p: [d.p[0], d.p[1], d.p[2]], r: [d.r[0], d.r[1], d.r[2]], s: [d.s[0], d.s[1], d.s[2]] };
  if (d.v !== undefined) o.v = d.v;
  if (d.att) o.att = d.att;
  if (d.g) o.g = d.g;
  return o;
}
