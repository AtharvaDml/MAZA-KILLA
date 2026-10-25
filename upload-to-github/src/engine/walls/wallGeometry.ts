import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Battlement, StoneStyle } from '../../state/store';
import { merlonGeometry } from '../objects/geo';
import { STONE_TILE, STONE_TINTS } from './stone';
import { smoothstep } from '../util/math';

export interface WallData {
  id: string;
  points: [number, number][];
  closed: boolean;
  smooth: boolean;
  height: number;
  thickness: number;
  battlement: Battlement;
  stone: StoneStyle;
  flip: boolean;
  /** Arc-length centred openings (gates, Phase 2). */
  openings: { t: number; width: number }[];
}

/** Sampled centreline + profile, kept for snapping, handles and diya lines. */
export interface WallSamples {
  x: Float32Array;
  z: Float32Array;
  /** Side normal pointing to the OUTER face. */
  nx: Float32Array;
  nz: Float32Array;
  miter: Float32Array;
  ground: Float32Array;
  top: Float32Array;
  s: Float32Array;
  length: number;
  count: number;
  halfTop: number;
  halfBase: number;
  parapetT: number;
  parapetH: number;
}

type HeightFn = (x: number, z: number) => number;

const STEP = 0.6;
const SINK = 1.4;

export function wallProfile(d: Pick<WallData, 'thickness' | 'height'>) {
  const halfBase = d.thickness / 2;
  const halfTop = halfBase * 0.82;
  const parapetT = Math.min(0.62, d.thickness * 0.2);
  const parapetH = Math.min(1.2, 0.5 + d.height * 0.09);
  return { halfBase, halfTop, parapetT, parapetH };
}

function centreline(points: [number, number][], closed: boolean, smooth: boolean): Vector3[] {
  const pts = points.map(([x, z]) => new Vector3(x, 0, z));
  if (pts.length < 2) return pts;
  if (smooth && pts.length >= 3) {
    const curve = new CatmullRomCurve3(pts, closed, 'centripetal', 0.5);
    const len = curve.getLength();
    const n = Math.max(2, Math.ceil(len / STEP));
    const out = curve.getSpacedPoints(n);
    if (closed) out.pop();
    return out;
  }
  const out: Vector3[] = [];
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
  }
  if (!closed) out.push(pts[pts.length - 1].clone());
  return out;
}

export function sampleWall(d: WallData, height: HeightFn): WallSamples | null {
  const P = centreline(d.points, d.closed, d.smooth);
  const n = P.length;
  if (n < 2) return null;
  const prof = wallProfile(d);
  const S: WallSamples = {
    x: new Float32Array(n), z: new Float32Array(n), nx: new Float32Array(n), nz: new Float32Array(n),
    miter: new Float32Array(n), ground: new Float32Array(n), top: new Float32Array(n), s: new Float32Array(n),
    length: 0, count: n, ...prof,
  };
  // Outer side: for closed loops pick the side away from the interior; open walls default to left.
  let outer = 1;
  if (d.closed) {
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      area += a.x * b.z - b.x * a.z;
    }
    outer = area > 0 ? -1 : 1;
  }
  if (d.flip) outer = -outer;

  let acc = 0;
  for (let i = 0; i < n; i++) {
    const prev = d.closed ? P[(i - 1 + n) % n] : P[Math.max(0, i - 1)];
    const next = d.closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
    const cur = P[i];
    let d0x = cur.x - prev.x, d0z = cur.z - prev.z;
    let d1x = next.x - cur.x, d1z = next.z - cur.z;
    const l0 = Math.hypot(d0x, d0z) || 1, l1 = Math.hypot(d1x, d1z) || 1;
    d0x /= l0; d0z /= l0; d1x /= l1; d1z /= l1;
    if (i === 0 && !d.closed) { d0x = d1x; d0z = d1z; }
    if (i === n - 1 && !d.closed) { d1x = d0x; d1z = d0z; }
    // left normals
    const n0x = -d0z, n0z = d0x, n1x = -d1z, n1z = d1x;
    let ax = n0x + n1x, az = n0z + n1z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const miter = 1 / Math.max(0.45, ax * n0x + az * n0z);
    S.x[i] = cur.x; S.z[i] = cur.z;
    S.nx[i] = ax * outer; S.nz[i] = az * outer;
    S.miter[i] = miter;
    if (i > 0) acc += Math.hypot(cur.x - P[i - 1].x, cur.z - P[i - 1].z);
    S.s[i] = acc;
  }
  S.length = d.closed ? acc + Math.hypot(P[0].x - P[n - 1].x, P[0].z - P[n - 1].z) : acc;

  // Terrain conformance: base under the lowest footprint point; top follows smoothed centre ground.
  const gC = new Float32Array(n), gMax = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const hw = prof.halfBase * S.miter[i];
    const c = height(S.x[i], S.z[i]);
    const l = height(S.x[i] + S.nx[i] * hw, S.z[i] + S.nz[i] * hw);
    const r = height(S.x[i] - S.nx[i] * hw, S.z[i] - S.nz[i] * hw);
    gC[i] = c;
    gMax[i] = Math.max(c, l, r);
    S.ground[i] = Math.min(c, l, r) - SINK;
  }
  const W = Math.max(1, Math.round(2.4 / STEP));
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -W; k <= W; k++) {
      let j = i + k;
      if (d.closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      sum += gC[j];
      cnt++;
    }
    S.top[i] = Math.max(sum / cnt + d.height, gMax[i] + d.height * 0.55);
  }
  return S;
}

interface Builder {
  pos: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

const tint = new Color();

/** Builds the wall mesh geometry from samples. */
export function buildWallGeometry(d: WallData, S: WallSamples): BufferGeometry {
  const B: Builder = { pos: [], uv: [], col: [], idx: [] };
  tint.set(STONE_TINTS[d.stone]);
  const { halfBase, halfTop, parapetT, parapetH } = S;
  const n = S.count;
  const T = STONE_TILE;

  // Runs between openings.
  const runs: [number, number][] = [];
  const blocked = new Uint8Array(n);
  for (const o of d.openings) {
    for (let i = 0; i < n; i++) if (Math.abs(S.s[i] - o.t) < o.width / 2) blocked[i] = 1;
  }
  let i = 0;
  while (i < n) {
    while (i < n && blocked[i]) i++;
    if (i >= n) break;
    const a = i;
    while (i < n && !blocked[i]) i++;
    runs.push([a, i - 1]);
  }
  const fullLoop = d.closed && runs.length === 1 && runs[0][0] === 0 && runs[0][1] === n - 1;

  // Cross-section corners at sample k: returns [x, y, z] for each named corner.
  const corner = (k: number, name: 'OB' | 'OT' | 'PI' | 'PW' | 'IW' | 'IB'): [number, number, number] => {
    const m = S.miter[k];
    const x = S.x[k], z = S.z[k], nx = S.nx[k], nz = S.nz[k];
    const top = S.top[k], base = S.ground[k];
    switch (name) {
      case 'OB': return [x + nx * halfBase * m, base, z + nz * halfBase * m];
      case 'OT': return [x + nx * halfTop * m, top + parapetH, z + nz * halfTop * m];
      case 'PI': return [x + nx * (halfTop - parapetT) * m, top + parapetH, z + nz * (halfTop - parapetT) * m];
      case 'PW': return [x + nx * (halfTop - parapetT) * m, top, z + nz * (halfTop - parapetT) * m];
      case 'IW': return [x - nx * halfTop * m, top, z - nz * halfTop * m];
      case 'IB': return [x - nx * halfBase * m, base, z - nz * halfBase * m];
    }
  };
  const groundAt = (k: number) => S.ground[k] + SINK;

  const shade = (y: number, k: number, kind: 'face' | 'top' | 'walk') => {
    const gy = groundAt(k);
    let a = 0.5 + 0.5 * smoothstep(gy - 0.2, gy + 1.8, y);
    if (kind === 'top') a *= 1.06;
    if (kind === 'walk') a *= 0.92;
    return a;
  };

  type Corner = 'OB' | 'OT' | 'PI' | 'PW' | 'IW' | 'IB';
  /** One quad strip between two cross-section corners. `ss` carries arc length so closed loops don't seam. */
  const strip = (ks: number[], ss: number[], c0: Corner, c1: Corner, kind: 'face' | 'top' | 'walk', uvMode: 'vertical' | 'lateral', flipWinding: boolean) => {
    const base = B.pos.length / 3;
    const width = kind === 'walk' ? halfTop * 2 - parapetT : parapetT;
    ks.forEach((k, q) => {
      for (const c of [c0, c1]) {
        const p = corner(k, c);
        B.pos.push(p[0], p[1], p[2]);
        const u = ss[q] / T;
        const v = uvMode === 'vertical' ? p[1] / T : ((c === c0 ? 0 : 1) * width) / T;
        B.uv.push(u, v);
        const a = shade(p[1], k, kind);
        if (kind === 'walk') B.col.push(tint.r * a * 0.86, tint.g * a * 0.82, tint.b * a * 0.76);
        else B.col.push(tint.r * a, tint.g * a, tint.b * a);
      }
    });
    for (let q = 0; q < ks.length - 1; q++) {
      const a = base + q * 2, b = a + 1, c = a + 2, e = a + 3;
      if (flipWinding) B.idx.push(a, c, b, b, c, e);
      else B.idx.push(a, b, c, b, e, c);
    }
  };

  /** End cap facing along dirSign × tangent. */
  const cap = (k: number, dirSign: number) => {
    const names: Corner[] = ['OB', 'OT', 'PI', 'PW', 'IW', 'IB'];
    const base = B.pos.length / 3;
    names.forEach((nm) => {
      const p = corner(k, nm);
      B.pos.push(p[0], p[1], p[2]);
      const lat = (p[0] - S.x[k]) * S.nx[k] + (p[2] - S.z[k]) * S.nz[k];
      B.uv.push(lat / T, p[1] / T);
      const a = shade(p[1], k, 'face');
      B.col.push(tint.r * a, tint.g * a, tint.b * a);
    });
    const ka = Math.max(0, k - 1), kb = Math.min(n - 1, k + 1);
    const tx = S.x[kb] - S.x[ka], tz = S.z[kb] - S.z[ka];
    const p0 = corner(k, 'OB'), p1 = corner(k, 'OT'), p2 = corner(k, 'PI');
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const fx = e1[1] * e2[2] - e1[2] * e2[1], fz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = (fx * tx + fz * tz) * dirSign < 0;
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]]) {
      if (flip) B.idx.push(base + a, base + c, base + b);
      else B.idx.push(base + a, base + b, base + c);
    }
  };

  // Strip windings decided once from sample 0's frame (consistent along the wall).
  const windOuter = needsFlip(corner, 0, 'OB', 'OT', [S.nx[0], 0, S.nz[0]], S);
  const windTop = needsFlip(corner, 0, 'OT', 'PI', [0, 1, 0], S);
  const windPin = needsFlip(corner, 0, 'PI', 'PW', [-S.nx[0], 0, -S.nz[0]], S);
  const windWalk = needsFlip(corner, 0, 'PW', 'IW', [0, 1, 0], S);
  const windInner = needsFlip(corner, 0, 'IW', 'IB', [-S.nx[0], 0, -S.nz[0]], S);

  for (const [a, b] of runs) {
    const ks: number[] = [];
    const ss: number[] = [];
    for (let k = a; k <= b; k++) { ks.push(k); ss.push(S.s[k]); }
    if (fullLoop) { ks.push(0); ss.push(S.length); }
    if (ks.length < 2) continue;
    strip(ks, ss, 'OB', 'OT', 'face', 'vertical', windOuter);
    strip(ks, ss, 'OT', 'PI', 'top', 'lateral', windTop);
    strip(ks, ss, 'PI', 'PW', 'face', 'vertical', windPin);
    strip(ks, ss, 'PW', 'IW', 'walk', 'lateral', windWalk);
    strip(ks, ss, 'IW', 'IB', 'face', 'vertical', windInner);
    if (!fullLoop) {
      cap(ks[0], -1);
      cap(ks[ks.length - 1], 1);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(B.pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(B.uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(B.col), 3));
  g.setIndex(B.idx);
  g.computeVertexNormals();

  // Merlons along the parapet.
  if (d.battlement !== 'none') {
    const mw = 0.82, mh = d.battlement === 'kangoore' ? 0.95 : 0.7, spacing = 1.55;
    const merlon = merlonGeometry(d.battlement === 'kangoore' ? 'kangoore' : 'square', mw, mh, parapetT);
    const mg: BufferGeometry[] = [g];
    const total = d.closed ? S.length : S.s[n - 1];
    const q = new Quaternion();
    const m4 = new Matrix4();
    let cursor = 0;
    for (let s = spacing / 2; s < total - 0.3; s += spacing) {
      while (cursor < n - 1 && S.s[cursor + 1] < s) cursor++;
      if (blocked[cursor] || (cursor + 1 < n && blocked[cursor + 1])) continue;
      const k0 = cursor, k1 = Math.min(n - 1, cursor + 1);
      const span = S.s[k1] - S.s[k0] || 1;
      const t = Math.min(1, Math.max(0, (s - S.s[k0]) / span));
      const lerp = (arr: Float32Array) => arr[k0] + (arr[k1] - arr[k0]) * t;
      const x = lerp(S.x), z = lerp(S.z), nx = lerp(S.nx), nz = lerp(S.nz), top = lerp(S.top), m = lerp(S.miter);
      const off = (halfTop - parapetT / 2) * m;
      // merlon local: x along wall, z across (depth). Align local +z with outer normal.
      const yaw = Math.atan2(nx, nz);
      q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      m4.compose(new Vector3(x + nx * off, top + parapetH - 0.02, z + nz * off), q, new Vector3(1, 1, 1));
      const c = merlon.clone().applyMatrix4(m4);
      const cnt = c.getAttribute('position').count;
      const uvA = c.getAttribute('uv') as BufferAttribute;
      for (let v = 0; v < cnt; v++) uvA.setXY(v, uvA.getX(v) / T + s / T, uvA.getY(v) / T);
      const cols = new Float32Array(cnt * 3);
      for (let v = 0; v < cnt; v++) { cols[v * 3] = tint.r * 1.04; cols[v * 3 + 1] = tint.g * 1.04; cols[v * 3 + 2] = tint.b * 1.04; }
      c.setAttribute('color', new BufferAttribute(cols, 3));
      for (const name of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) c.deleteAttribute(name);
      mg.push(c.index ? c.toNonIndexed() : c);
    }
    if (mg.length > 1) {
      const base = g.toNonIndexed();
      mg[0] = base;
      const merged = mergeGeometries(mg, false);
      if (merged) {
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        return merged;
      }
    }
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** True if the default (a,b,c / b,e,c) winding would face away from `hint`. */
function needsFlip(
  corner: (k: number, name: 'OB' | 'OT' | 'PI' | 'PW' | 'IW' | 'IB') => [number, number, number],
  k: number, c0: 'OB' | 'OT' | 'PI' | 'PW' | 'IW' | 'IB', c1: 'OB' | 'OT' | 'PI' | 'PW' | 'IW' | 'IB',
  hint: [number, number, number], S: WallSamples,
): boolean {
  const k1 = Math.min(k + 1, S.count - 1);
  const a = corner(k, c0), b = corner(k, c1), c = corner(k1, c0);
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  return nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
}

/** Point on the wall's centreline at arc length s, plus its outer normal and top height. */
export function wallFrameAt(S: WallSamples, s: number) {
  const n = S.count;
  let k = 0;
  while (k < n - 1 && S.s[k + 1] < s) k++;
  const k1 = Math.min(n - 1, k + 1);
  const span = S.s[k1] - S.s[k] || 1;
  const t = Math.min(1, Math.max(0, (s - S.s[k]) / span));
  const l = (arr: Float32Array) => arr[k] + (arr[k1] - arr[k]) * t;
  return { x: l(S.x), z: l(S.z), nx: l(S.nx), nz: l(S.nz), top: l(S.top), miter: l(S.miter) };
}
