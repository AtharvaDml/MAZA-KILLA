import {
  BufferAttribute, BufferGeometry, Group, Mesh, Points, Ray, Raycaster, ShaderMaterial, Vector2, Vector3, type Intersection,
} from 'three';
import type { Terrain } from '../terrain/Terrain';
import { mulberry32 } from '../util/noise';
import { WATER_COLORS, cloneWater, type WaterData } from './waterData';
import {
  areaCarveTarget, areaLevel, areaOutline, buildAreaGeometry, buildFlowGeometry, flowBounds, flowCarveTarget,
  nearestOnSamples, outlineBounds, pointInPolygon, sampleFlow, type FlowSamples,
} from './waterGeometry';
import { createSprayMaterial, createWaterMaterial, type WaterEnv } from './WaterMaterial';

interface WaterRecord {
  data: WaterData;
  mesh: Mesh;
  material: ShaderMaterial;
  spray: Points | null;
  outline: Vector2[] | null;
  samples: FlowSamples | null;
  level: number;
  bbox: [number, number, number, number];
}

export interface WaterHit { id: string; point: Vector3; distance: number }

/** Ponds, lakes, tanks, moats, rivers, streams and waterfalls. Rendered as shader surfaces, never simulated. */
export class WaterSystem {
  readonly group = new Group();
  private readonly records = new Map<string, WaterRecord>();
  private readonly raycaster = new Raycaster();
  private readonly spray = createSprayMaterial();
  readonly env: WaterEnv;
  version = 0;

  constructor(private terrain: Terrain, sky: Record<string, { value: unknown }>) {
    this.group.name = 'water';
    this.env = {
      uHeight: { value: terrain.heightTex },
      uGlow: { value: terrain.glowTex },
      uPlotHalf: { value: terrain.half },
      uRes: { value: terrain.res },
      uTop: sky.uTop,
      uHorizon: sky.uHorizon,
      uSunDir: sky.uSunDir,
      uSunColor: sky.uSunColor,
    };
  }

  setTerrain(t: Terrain) {
    this.terrain = t;
    this.env.uHeight.value = t.heightTex;
    this.env.uGlow.value = t.glowTex;
    this.env.uPlotHalf.value = t.half;
    this.env.uRes.value = t.res;
  }

  setViewportHeight(px: number) {
    this.spray.uniforms.uPx.value = px * 0.5;
  }

  get count() { return this.records.size; }
  has(id: string) { return this.records.has(id); }
  get(id: string) { const r = this.records.get(id); return r ? cloneWater(r.data) : undefined; }
  all() { return [...this.records.values()].map((r) => cloneWater(r.data)); }

  private height = (x: number, z: number) => this.terrain.heightAt(x, z);

  add(data: WaterData) {
    if (this.records.has(data.id)) return;
    const c = WATER_COLORS[data.color] ?? WATER_COLORS[0];
    const material = createWaterMaterial(this.env, { shallow: c.shallow, deep: c.deep, clarity: data.clarity, reflect: data.reflect });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.renderOrder = 2;
    mesh.name = 'water:' + data.id;
    const rec: WaterRecord = { data: cloneWater(data), mesh, material, spray: null, outline: null, samples: null, level: 0, bbox: [0, 0, 0, 0] };
    this.records.set(data.id, rec);
    this.group.add(mesh);
    this.rebuild(rec);
    this.version++;
  }

  remove(id: string): WaterData | undefined {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    this.group.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    rec.material.dispose();
    this.dropSpray(rec);
    this.records.delete(id);
    this.version++;
    return cloneWater(rec.data);
  }

  update(data: WaterData) {
    const rec = this.records.get(data.id);
    if (!rec) return this.add(data);
    rec.data = cloneWater(data);
    const c = WATER_COLORS[data.color] ?? WATER_COLORS[0];
    rec.material.uniforms.uShallow.value.set(c.shallow);
    rec.material.uniforms.uDeep.value.set(c.deep);
    rec.material.uniforms.uClarity.value = data.clarity;
    rec.material.uniforms.uReflect.value = data.reflect;
    this.rebuild(rec);
    this.version++;
  }

  clear() {
    for (const id of [...this.records.keys()]) this.remove(id);
  }

  private dropSpray(rec: WaterRecord) {
    if (!rec.spray) return;
    this.group.remove(rec.spray);
    rec.spray.geometry.dispose();
    rec.spray = null;
  }

  private rebuild(rec: WaterRecord) {
    const d = rec.data;
    const old = rec.mesh.geometry;
    this.dropSpray(rec);
    if (d.mode === 'area') {
      if (d.points.length < 3) { rec.mesh.visible = false; return; }
      rec.outline = areaOutline(d);
      rec.level = areaLevel(d, rec.outline, this.height);
      rec.mesh.geometry = buildAreaGeometry(rec.outline, rec.level);
      rec.bbox = outlineBounds(rec.outline, 1);
      rec.samples = null;
    } else {
      const S = sampleFlow(d, this.height);
      if (!S) { rec.mesh.visible = false; return; }
      rec.samples = S;
      rec.outline = null;
      rec.mesh.geometry = buildFlowGeometry(d, S);
      rec.bbox = flowBounds(d, S);
      rec.level = S.level[0];
      if (S.falls.length) rec.spray = this.buildSpray(S.falls, d.width);
    }
    rec.mesh.visible = true;
    old.dispose();
  }

  private buildSpray(falls: FlowSamples['falls'], width: number): Points {
    const per = 70;
    const n = falls.length * per;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), kind = new Float32Array(n * 2);
    const rng = mulberry32(falls.length * 977 + Math.round(falls[0].x * 13));
    falls.forEach((f, fi) => {
      for (let k = 0; k < per; k++) {
        const i = fi * per + k;
        const spread = width * 0.35;
        pos[i * 3] = f.x + (rng() - 0.5) * spread;
        pos[i * 3 + 1] = f.y + 0.05;
        pos[i * 3 + 2] = f.z + (rng() - 0.5) * spread;
        seed[i * 4] = rng(); seed[i * 4 + 1] = rng(); seed[i * 4 + 2] = rng(); seed[i * 4 + 3] = rng();
        kind[i * 2] = k < per * 0.7 ? 0 : 1;
        kind[i * 2 + 1] = f.drop;
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 4));
    g.setAttribute('aKind', new BufferAttribute(kind, 2));
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 6;
    const p = new Points(g, this.spray);
    p.renderOrder = 3;
    p.frustumCulled = true;
    this.group.add(p);
    return p;
  }

  /** Re-derive levels/ribbons for water near a terrain edit. */
  regenerateInRect(x0: number, z0: number, x1: number, z1: number) {
    let any = false;
    for (const rec of this.records.values()) {
      const [a, b, c, d] = rec.bbox;
      if (c < x0 || a > x1 || d < z0 || b > z1) continue;
      this.rebuild(rec);
      any = true;
    }
    if (any) this.version++;
  }

  /** Bounds + profile for digging this water's bed into the terrain. */
  carvePlan(d: WaterData): { bounds: [number, number, number, number]; target: (x: number, z: number) => number | null } | null {
    if (d.mode === 'area') {
      if (d.points.length < 3) return null;
      const outline = areaOutline(d);
      const level = areaLevel(d, outline, this.height);
      return { bounds: outlineBounds(outline, 1), target: areaCarveTarget(d, outline, level) };
    }
    const S = sampleFlow(d, this.height);
    if (!S) return null;
    return { bounds: flowBounds(d, S), target: flowCarveTarget(d, S) };
  }

  levelOf(id: string) { return this.records.get(id)?.level ?? 0; }
  lengthOf(id: string) { return this.records.get(id)?.samples?.length ?? 0; }
  fallsOf(id: string) { return this.records.get(id)?.samples?.falls.length ?? 0; }
  outlineOf(id: string) { return this.records.get(id)?.outline ?? null; }

  setHighlight(id: string, v: number) {
    const rec = this.records.get(id);
    if (rec) rec.material.uniforms.uHL.value = v;
  }

  pick(ray: Ray): WaterHit | null {
    this.raycaster.ray.copy(ray);
    let best: WaterHit | null = null;
    const hits: Intersection[] = [];
    for (const rec of this.records.values()) {
      if (!rec.mesh.visible) continue;
      hits.length = 0;
      rec.mesh.raycast(this.raycaster, hits);
      for (const h of hits) {
        // Ignore hits on the part of the surface that is underground.
        if (h.point.y < this.terrain.heightAt(h.point.x, h.point.z) - 0.05) continue;
        if (!best || h.distance < best.distance) best = { id: rec.data.id, point: h.point.clone(), distance: h.distance };
      }
    }
    return best;
  }

  handlePositions(id: string): Vector3[] {
    const rec = this.records.get(id);
    if (!rec) return [];
    return rec.data.points.map(([x, z]) => {
      let y = rec.level;
      if (rec.samples) y = nearestOnSamples(rec.samples, x, z).y;
      return new Vector3(x, Math.max(y, this.terrain.heightAt(x, z)) + 1.6, z);
    });
  }

  /** Nearest drinkable water to (x,z) within `radius` (Phase B animals). */
  nearestWater(x: number, z: number, radius: number): { x: number; y: number; z: number } | null {
    let best: { x: number; y: number; z: number; d: number } | null = null;
    for (const rec of this.records.values()) {
      if (rec.samples) {
        const n = nearestOnSamples(rec.samples, x, z);
        if (n.d < radius && (!best || n.d < best.d)) best = { x: n.x, y: n.y, z: n.z, d: n.d };
      } else if (rec.outline) {
        for (const p of rec.outline) {
          const dd = Math.hypot(p.x - x, p.y - z);
          if (dd < radius && (!best || dd < best.d)) best = { x: p.x, y: rec.level, z: p.y, d: dd };
        }
      }
    }
    return best;
  }

  /** Is (x,z) on open water? Used to keep objects and animals off the surface. */
  isWater(x: number, z: number): boolean {
    for (const rec of this.records.values()) {
      const [a, b, c, d] = rec.bbox;
      if (x < a || x > c || z < b || z > d) continue;
      if (rec.outline && pointInPolygon(x, z, rec.outline) && this.terrain.heightAt(x, z) < rec.level) return true;
      if (rec.samples) {
        const n = nearestOnSamples(rec.samples, x, z);
        if (n.d < rec.data.width / 2 && this.terrain.heightAt(x, z) < n.y) return true;
      }
    }
    return false;
  }

  bbox(id: string) { return this.records.get(id)?.bbox; }

  /** Arc length along flowing water nearest to (x,z). */
  arcLengthNear(id: string, x: number, z: number): number {
    const S = this.records.get(id)?.samples;
    if (!S) return 0;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < S.count; i++) {
      const dd = (x - S.x[i]) ** 2 + (z - S.z[i]) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    }
    return S.s[bi];
  }
}
