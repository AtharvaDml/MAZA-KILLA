import { BufferAttribute, BufferGeometry, CatmullRomCurve3, ShapeUtils, Vector2, Vector3 } from 'three';
import { smoothstep } from '../util/math';
import type { WaterData } from './waterData';

type HeightFn = (x: number, z: number) => number;

const FLOW_STEP = 0.8;
/** Water sits this far below its banks. */
const FREEBOARD = 0.35;

// ───────────────────────────── area water ─────────────────────────────

/** Smoothed closed outline (organic, never a perfect polygon unless drawn that way). */
export function areaOutline(d: WaterData): Vector2[] {
  const pts = d.points.map(([x, z]) => new Vector3(x, 0, z));
  if (pts.length < 3) return pts.map((p) => new Vector2(p.x, p.z));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const n = Math.max(24, Math.ceil(curve.getLength() / 1.2));
  const out = curve.getSpacedPoints(n).map((p) => new Vector2(p.x, p.z));
  out.pop();
  return out;
}

/** Surface height: explicit, or just below the lowest ground along the shoreline. */
export function areaLevel(d: WaterData, outline: Vector2[], height: HeightFn): number {
  if (d.level !== null && d.level !== undefined) return d.level;
  let lo = Infinity;
  for (const p of outline) lo = Math.min(lo, height(p.x, p.y));
  return (Number.isFinite(lo) ? lo : 0) - 0.25;
}

export function buildAreaGeometry(outline: Vector2[], level: number): BufferGeometry {
  const contour = ShapeUtils.isClockWise(outline) ? outline.slice().reverse() : outline;
  const tris = ShapeUtils.triangulateShape(contour, []);
  const n = contour.length;
  const pos = new Float32Array(n * 3);
  contour.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = level; pos[i * 3 + 2] = p.y; });
  const idx: number[] = [];
  // three's shape triangulation is CCW in XY; on the XZ plane that faces down, so flip.
  for (const [a, b, c] of tris) idx.push(a, c, b);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aDist', new BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aFall', new BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aLane', new BufferAttribute(new Float32Array(n), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function pointInPolygon(x: number, z: number, poly: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolyline(x: number, z: number, poly: Vector2[], closed: boolean): number {
  let best = Infinity;
  const n = poly.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dz = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dz * t - z));
  }
  return best;
}

/** Basin profile for carving: bed at level − depth, rising to the shoreline over `shore`. */
export function areaCarveTarget(d: WaterData, outline: Vector2[], level: number) {
  return (x: number, z: number): number | null => {
    if (!pointInPolygon(x, z, outline)) return null;
    const dist = distToPolyline(x, z, outline, true);
    const prof = smoothstep(0, Math.max(0.3, d.shore), dist);
    return level + 0.3 - (d.depth + 0.3) * prof;
  };
}

export function outlineBounds(outline: Vector2[], pad = 0): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of outline) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

// ───────────────────────────── flowing water ─────────────────────────────

export interface FlowSamples {
  x: Float32Array;
  z: Float32Array;
  nx: Float32Array;
  nz: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  s: Float32Array;
  level: Float32Array;
  /** 0 calm … 1 falling white water. */
  fall: Float32Array;
  count: number;
  length: number;
  /** Bottoms of falls, for splash + mist emitters. */
  falls: { x: number; y: number; z: number; drop: number }[];
}

function centreline(d: WaterData): Vector3[] {
  const pts = d.points.map(([x, z]) => new Vector3(x, 0, z));
  if (pts.length < 2) return pts;
  if (pts.length >= 3) {
    const curve = new CatmullRomCurve3(pts, d.closed, 'centripetal', 0.5);
    const n = Math.max(2, Math.ceil(curve.getLength() / FLOW_STEP));
    const out = curve.getSpacedPoints(n);
    if (d.closed) out.pop();
    return out;
  }
  const out: Vector3[] = [];
  const len = pts[0].distanceTo(pts[1]);
  const n = Math.max(1, Math.ceil(len / FLOW_STEP));
  for (let k = 0; k <= n; k++) out.push(pts[0].clone().lerp(pts[1], k / n));
  return out;
}

export function sampleFlow(d: WaterData, height: HeightFn): FlowSamples | null {
  const P = centreline(d);
  const n = P.length;
  if (n < 2) return null;
  const S: FlowSamples = {
    x: new Float32Array(n), z: new Float32Array(n), nx: new Float32Array(n), nz: new Float32Array(n),
    tx: new Float32Array(n), tz: new Float32Array(n), s: new Float32Array(n), level: new Float32Array(n),
    fall: new Float32Array(n), count: n, length: 0, falls: [],
  };
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const prev = d.closed ? P[(i - 1 + n) % n] : P[Math.max(0, i - 1)];
    const next = d.closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x, tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    S.x[i] = P[i].x; S.z[i] = P[i].z; S.tx[i] = tx; S.tz[i] = tz; S.nx[i] = -tz; S.nz[i] = tx;
    if (i > 0) acc += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    S.s[i] = acc;
  }
  S.length = d.closed ? acc + Math.hypot(P[0].x - P[n - 1].x, P[0].z - P[n - 1].z) : acc;

  // Levels come from the banks (outside the carved channel) so re-sampling after carving is stable.
  const off = d.width / 2 + d.shore + 0.6;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = height(S.x[i] + S.nx[i] * off, S.z[i] + S.nz[i] * off);
    const r = height(S.x[i] - S.nx[i] * off, S.z[i] - S.nz[i] * off);
    raw[i] = Math.min(l, r) - FREEBOARD;
  }
  const W = 3;
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -W; k <= W; k++) {
      let j = i + k;
      if (d.closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      sum += raw[j]; cnt++;
    }
    S.level[i] = Math.min(raw[i] + 0.15, sum / cnt);
  }
  // Rivers only ever run downhill from where they were drawn.
  if (d.flow > 0 && !d.closed) {
    for (let i = 1; i < n; i++) S.level[i] = Math.min(S.level[i], S.level[i - 1]);
    // Even out the staircase the clamp leaves on slopes (it reads as jagged ledges), then re-clamp.
    const tmp = S.level.slice();
    for (let i = 1; i < n - 1; i++) S.level[i] = Math.min(raw[i] + 0.15, (tmp[i - 1] + tmp[i] * 2 + tmp[i + 1]) / 4);
    for (let i = 1; i < n; i++) S.level[i] = Math.min(S.level[i], S.level[i - 1]);
  }

  // Falls: steep descents turn to white water; a foam pool trails after each. Still water (moats) never foams.
  let inFall = false, fallTop = 0;
  for (let i = 1; i < n && d.flow > 0; i++) {
    const step = Math.max(1e-3, S.s[i] - S.s[i - 1]);
    const slope = (S.level[i - 1] - S.level[i]) / step;
    const f = smoothstep(0.45, 1.3, slope);
    S.fall[i] = Math.max(S.fall[i], f);
    if (f > 0.5 && !inFall) { inFall = true; fallTop = S.level[i - 1]; }
    if (inFall && (f < 0.3 || i === n - 1)) {
      inFall = false;
      const drop = fallTop - S.level[i];
      if (drop > 1.2) S.falls.push({ x: S.x[i], y: S.level[i], z: S.z[i], drop });
      for (let k = 1; k <= 6 && i + k < n; k++) S.fall[i + k] = Math.max(S.fall[i + k], 0.55 * (1 - k / 7));
    }
  }
  return S;
}

function blocked(d: WaterData, s: number) {
  return d.openings.some((o) => Math.abs(o.t - s) < o.width / 2);
}

/** Ribbon across the channel, extended into the banks (the terrain hides what is above ground). */
export function buildFlowGeometry(d: WaterData, S: FlowSamples): BufferGeometry {
  const pos: number[] = [], flow: number[] = [], dist: number[] = [], fall: number[] = [], lanesA: number[] = [], idx: number[] = [];
  const half = d.width / 2 + d.shore * 0.6 + 0.3;
  const lanes = [-1, -0.5, 0, 0.5, 1];
  const L = lanes.length;
  const fullLoop = d.closed && !d.openings.length;
  const ks: number[] = [];
  for (let i = 0; i < S.count; i++) ks.push(i);
  if (fullLoop) ks.push(0);
  let prevRow = -1;
  ks.forEach((k, q) => {
    const s = q === ks.length - 1 && fullLoop ? S.length : S.s[k];
    if (blocked(d, s)) { prevRow = -1; return; }
    const base = pos.length / 3;
    for (const lane of lanes) {
      const w = half * lane;
      pos.push(S.x[k] + S.nx[k] * w, S.level[k], S.z[k] + S.nz[k] * w);
      flow.push(S.tx[k] * d.flow, S.tz[k] * d.flow);
      dist.push(s);
      fall.push(S.fall[k] * (1 - Math.abs(lane) * 0.25));
      lanesA.push(Math.abs(lane));
    }
    if (prevRow >= 0) {
      for (let c = 0; c < L - 1; c++) {
        const a = prevRow + c, b = prevRow + c + 1, e = base + c, f = base + c + 1;
        idx.push(a, e, b, b, e, f);
      }
    }
    prevRow = base;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow), 2));
  g.setAttribute('aDist', new BufferAttribute(new Float32Array(dist), 1));
  g.setAttribute('aFall', new BufferAttribute(new Float32Array(fall), 1));
  g.setAttribute('aLane', new BufferAttribute(new Float32Array(lanesA), 1));
  g.setIndex(idx);
  // Make sure the ribbon faces up regardless of drawing direction.
  if (idx.length >= 3) {
    const p = (i: number) => new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const a = p(idx[0]), b = p(idx[1]), c = p(idx[2]);
    const ny = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y;
    if (ny < 0) {
      for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
      g.setIndex(idx);
    }
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function flowBounds(d: WaterData, S: FlowSamples): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < S.count; i++) { x0 = Math.min(x0, S.x[i]); x1 = Math.max(x1, S.x[i]); z0 = Math.min(z0, S.z[i]); z1 = Math.max(z1, S.z[i]); }
  const pad = d.width / 2 + d.shore + 1.5;
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

/** Channel profile for carving: bed at level − depth, banks just above the water. Openings stay dry land. */
export function flowCarveTarget(d: WaterData, S: FlowSamples) {
  const half = d.width / 2;
  const reach = half + Math.max(0.4, d.shore);
  return (x: number, z: number): number | null => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < S.count; i++) {
      const dx = x - S.x[i], dz = z - S.z[i];
      const dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; bi = i; }
    }
    if (bi < 0) return null;
    const dist = Math.sqrt(bd);
    if (dist > reach || blocked(d, S.s[bi])) return null;
    const prof = 1 - smoothstep(half * 0.55, reach, dist);
    return S.level[bi] + 0.4 * (1 - prof) - d.depth * prof;
  };
}

/** Nearest point on any shoreline-ish location (used by animals going to drink, Phase B). */
export function nearestOnSamples(S: FlowSamples, x: number, z: number): { x: number; z: number; y: number; d: number } {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < S.count; i++) {
    const dd = (x - S.x[i]) ** 2 + (z - S.z[i]) ** 2;
    if (dd < bd) { bd = dd; bi = i; }
  }
  return { x: S.x[bi], z: S.z[bi], y: S.level[bi], d: Math.sqrt(bd) };
}
