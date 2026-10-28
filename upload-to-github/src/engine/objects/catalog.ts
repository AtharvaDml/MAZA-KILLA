import {
  BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, IcosahedronGeometry,
  SphereGeometry, TorusGeometry, BoxGeometry, Vector3, Shape,
} from 'three';
import type { MaterialKey } from '../render/materials';
import type { CategoryId } from '../../state/store';
import { mulberry32 } from '../util/noise';
import { PartBuilder, glowQuads, lathe, merlonGeometry, pennantGeometry, quatFromY, starShape, type V3 } from './geo';
import { STONE_TILE, STONE_TINTS } from '../walls/stone';

export interface AssetPart {
  geometry: BufferGeometry;
  material: MaterialKey;
  shadow?: boolean;
  /** Excluded from exact picking (halos, flames). */
  noPick?: boolean;
}

export interface AssetDef {
  id: string;
  name: string;
  category: CategoryId;
  parts: AssetPart[];
  radius: number;
  height: number;
  scale: [number, number];
  jitterScale?: number;
  randomYaw?: boolean;
  align?: boolean;
  scatter?: boolean;
  variants?: { name: string; color: number }[];
  emitter?: { offset: V3; radius: number; intensity: number };
  /** A flat top other things can stand on (local height, radius). */
  platform?: { y: number; r: number };
  info?: string;
  sound?: 'stone' | 'wood' | 'plant' | 'soft' | 'diya' | 'metal';
}

const cyl = (rt: number, rb: number, h: number, seg = 12, hseg = 1, open = false) => new CylinderGeometry(rt, rb, h, seg, hseg, open);
const sph = (r: number, w = 16, h = 12) => new SphereGeometry(r, w, h);
const ico = (r: number, d = 2) => new IcosahedronGeometry(r, d);
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const cone = (r: number, h: number, seg = 8) => new ConeGeometry(r, h, seg);

const SKIN = 0x8d5a3b;
const WOOD = 0x6a4a2c;
const DARK_WOOD = 0x3e2b1e;
const IRON = 0x3a3835;
const BRASS = 0xc9a23a;

// ─────────────────────────────── NATURE ───────────────────────────────

function treeRound(): AssetPart[] {
  const b = new PartBuilder();
  b.add(cyl(0.16, 0.3, 3.0, 9, 4), { color: 0x5b3e2b, pos: [0, 1.5, 0], jitter: 0.04, jitterFreq: 3, smooth: true, colorNoise: 0.2, ao: [0, 1.2, 0.6] });
  b.add(cyl(0.05, 0.1, 1.3, 6, 2), { color: 0x5b3e2b, pos: [0.38, 2.7, 0.1], rot: [0, 0, -0.8], smooth: true });
  b.add(cyl(0.05, 0.1, 1.2, 6, 2), { color: 0x5b3e2b, pos: [-0.32, 2.9, -0.2], rot: [0.3, 0, 0.7], smooth: true });
  const blobs: [number, number, number, number][] = [
    [0, 4.0, 0, 1.75], [1.0, 3.5, 0.4, 1.3], [-0.9, 3.6, -0.5, 1.35], [0.2, 4.9, -0.3, 1.3],
    [-0.3, 3.3, 1.0, 1.15], [0.7, 4.3, -0.9, 1.2], [-0.8, 4.6, 0.5, 1.1],
  ];
  blobs.forEach(([x, y, z, r], i) =>
    b.add(ico(r, 2), { color: 0x4f6e2b, tint: 1, pos: [x, y, z], jitter: 0.24 * r, jitterFreq: 1.4, smooth: true, colorNoise: 0.24, colorFreq: 2.4, ao: [2.4, 5.4, 0.5], seed: 10 + i }),
  );
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function treeTall(): AssetPart[] {
  const b = new PartBuilder();
  b.add(cyl(0.12, 0.2, 2.4, 8, 3), { color: 0x4f3626, pos: [0, 1.2, 0], smooth: true, jitter: 0.03, ao: [0, 1, 0.6] });
  const parts: [number, V3][] = [[3.5, [1.15, 2.3, 1.15]], [5.4, [0.95, 1.8, 0.95]], [6.9, [0.6, 1.2, 0.6]]];
  parts.forEach(([y, s], i) =>
    b.add(ico(1, 2), { color: 0x34552a, tint: 1, pos: [0, y, 0], scale: s, jitter: 0.17, jitterFreq: 2.1, smooth: true, colorNoise: 0.22, colorFreq: 3, ao: [2, 6, 0.55], seed: 20 + i }),
  );
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function treeLarge(): AssetPart[] {
  const b = new PartBuilder();
  b.add(cyl(0.38, 0.62, 3.4, 11, 4), { color: 0x56402e, pos: [0, 1.7, 0], smooth: true, jitter: 0.07, jitterFreq: 2, colorNoise: 0.22, ao: [0, 1.5, 0.55] });
  const branches: [V3, V3][] = [[[0.9, 3.6, 0.2], [0, 0, -0.9]], [[-0.8, 3.7, -0.3], [0.3, 0, 0.9]], [[0.1, 3.8, 0.9], [0.9, 0, 0]]];
  branches.forEach(([p, r]) => b.add(cyl(0.12, 0.22, 2.2, 7, 2), { color: 0x56402e, pos: p, rot: r, smooth: true }));
  const blobs: [number, number, number, number][] = [[0, 5.7, 0, 2.4], [0, 6.6, 0.6, 1.6], [-0.6, 6.4, -0.8, 1.5]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    blobs.push([Math.cos(a) * 2.3, 4.7 + (i % 2) * 0.5, Math.sin(a) * 2.3, 1.75 + (i % 3) * 0.15]);
  }
  blobs.forEach(([x, y, z, r], i) =>
    b.add(ico(r, 2), { color: 0x3f6126, tint: 1, pos: [x, y, z], jitter: 0.24 * r, jitterFreq: 1.2, smooth: true, colorNoise: 0.24, colorFreq: 2, ao: [3.4, 6.5, 0.5], seed: 30 + i }),
  );
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function treeDry(): AssetPart[] {
  const b = new PartBuilder();
  const rng = mulberry32(77);
  const grow = (start: Vector3, dir: Vector3, len: number, rad: number, depth: number) => {
    const q = quatFromY(dir);
    const mid = start.clone().addScaledVector(dir, len / 2);
    b.add(cyl(rad * 0.65, rad, len, 7, 2), { color: 0x6d5a48, quat: q, pos: [mid.x, mid.y, mid.z], smooth: true, jitter: rad * 0.15, colorNoise: 0.2, ao: [0, 1.5, 0.6] });
    if (depth <= 0) return;
    const end = start.clone().addScaledVector(dir, len);
    const kids = 2 + (rng() > 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const yaw = rng() * Math.PI * 2;
      const tilt = 0.45 + rng() * 0.5;
      const nd = new Vector3(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw)).lerp(dir, 0.35).normalize();
      grow(end, nd, len * (0.62 + rng() * 0.15), rad * 0.6, depth - 1);
    }
  };
  grow(new Vector3(0, -0.2, 0), new Vector3(0.05, 1, 0).normalize(), 2.6, 0.26, 3);
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function bush(): AssetPart[] {
  const b = new PartBuilder();
  const blobs: [number, number, number, number][] = [[0, 0.55, 0, 0.72], [0.55, 0.42, 0.2, 0.52], [-0.5, 0.4, -0.15, 0.55], [0.1, 0.4, -0.55, 0.5], [-0.1, 0.38, 0.55, 0.48]];
  blobs.forEach(([x, y, z, r], i) =>
    b.add(ico(r, 2), { color: 0x4a6b2c, tint: 1, pos: [x, y, z], jitter: 0.2 * r, jitterFreq: 2.4, smooth: true, colorNoise: 0.25, colorFreq: 4, ao: [0, 1.0, 0.5], seed: 40 + i }),
  );
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function grassTuft(): AssetPart[] {
  const b = new PartBuilder();
  const rng = mulberry32(51);
  for (let i = 0; i < 11; i++) {
    const h = 0.45 + rng() * 0.45;
    const a = rng() * Math.PI * 2, r = rng() * 0.22;
    b.add(cone(0.05, h, 3), {
      color: rng() > 0.7 ? 0x8a9a3a : 0x6c8f2e, tint: 1,
      pos: [Math.cos(a) * r, h * 0.42, Math.sin(a) * r],
      rot: [(rng() - 0.5) * 0.7, rng() * Math.PI, (rng() - 0.5) * 0.7],
      colorNoise: 0.2, ao: [0, h * 0.8, 0.4], seed: 50 + i,
    });
  }
  return [{ geometry: b.build(), material: 'clay', shadow: false }];
}

function flowers(): AssetPart[] {
  const b = new PartBuilder();
  const rng = mulberry32(61);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(ico(0.2, 1), { color: 0x4d6e2a, pos: [Math.cos(a) * 0.18, 0.14, Math.sin(a) * 0.18], scale: [1, 0.7, 1], smooth: true, jitter: 0.04, seed: 60 + i });
  }
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, r = 0.05 + rng() * 0.25, y = 0.32 + rng() * 0.2;
    b.add(cyl(0.012, 0.012, y, 4), { color: 0x4d6e2a, pos: [Math.cos(a) * r, y / 2, Math.sin(a) * r] });
    b.add(sph(0.085 + rng() * 0.04, 8, 6), { color: rng() > 0.45 ? 0xff8a12 : 0xffc21a, pos: [Math.cos(a) * r, y, Math.sin(a) * r], jitter: 0.015, jitterFreq: 30, smooth: true, colorNoise: 0.18, seed: 70 + i });
  }
  return [{ geometry: b.build(), material: 'clay', shadow: false }];
}

function rockSmall(): AssetPart[] {
  const b = new PartBuilder();
  b.add(ico(0.55, 2), { color: 0x6e675e, pos: [0, 0.16, 0], scale: [1, 0.62, 0.85], jitter: 0.16, jitterFreq: 2.4, smooth: true, colorNoise: 0.28, colorFreq: 3, seed: 81 });
  b.add(ico(0.28, 1), { color: 0x766f66, pos: [0.55, 0.06, 0.25], scale: [1, 0.7, 1], jitter: 0.06, jitterFreq: 4, smooth: true, colorNoise: 0.25, seed: 82 });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function boulder(): AssetPart[] {
  const b = new PartBuilder();
  const top = { color: 0x5d6b3b, from: 1.0, to: 1.8 };
  b.add(ico(1.4, 2), { color: 0x625b54, pos: [0, 0.65, 0], scale: [1.1, 0.8, 1], jitter: 0.3, jitterFreq: 1.3, smooth: true, colorNoise: 0.3, top, seed: 91 });
  b.add(ico(1.0, 2), { color: 0x6a625a, pos: [1.15, 0.38, 0.5], jitter: 0.24, jitterFreq: 1.6, smooth: true, colorNoise: 0.3, top, seed: 92 });
  b.add(ico(0.8, 2), { color: 0x5c564f, pos: [-0.95, 0.28, -0.6], jitter: 0.2, jitterFreq: 1.8, smooth: true, colorNoise: 0.3, top, seed: 93 });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function rockFormation(): AssetPart[] {
  const b = new PartBuilder();
  const cols: [number, number, number, number][] = [[0, 0, 1.25, 6.8], [1.6, 0.6, 0.95, 4.8], [-1.35, 0.85, 0.85, 3.9], [0.65, -1.45, 0.8, 3.3], [-0.75, -1.05, 0.62, 2.5]];
  cols.forEach(([x, z, r, h], i) => {
    const top = { color: 0x56663a, from: h * 0.82, to: h + 0.2 };
    b.add(cyl(r * 0.62, r, h + 0.6, 7, 6), { color: 0x55504a, pos: [x, h / 2 - 0.3, z], jitter: r * 0.26, jitterFreq: 1.1, colorNoise: 0.25, colorFreq: 1.5, top, seed: 100 + i });
    b.add(ico(r * 0.66, 1), { color: 0x55504a, pos: [x, h, z], scale: [1, 0.6, 1], jitter: r * 0.15, jitterFreq: 1.4, top, seed: 110 + i });
  });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

// ─────────────────────────────── FORT ───────────────────────────────

function buruj(): AssetPart[] {
  const b = new PartBuilder(true);
  const R0 = 4.3, R1 = 3.7, H = 8.5, P = 1.2, PT = 0.55;
  const around = (r: number) => Math.max(1, Math.round((Math.PI * 2 * r) / STONE_TILE));
  const wallUv = (r: number) => (p: Vector3, uv: { x: number }) => [uv.x * around(r), p.y / STONE_TILE] as [number, number];
  b.add(lathe([[R0, -2.5], [R0, 0], [R1, H]], 44), { color: 0xffffff, tint: 1, ao: [0, 2, 0.6], uvFn: wallUv(R0) });
  b.add(lathe([[R1, H], [R1, H + P], [R1 - PT, H + P], [R1 - PT, H]], 44), { color: 0xffffff, tint: 1, uvFn: wallUv(R1) });
  b.add(new CircleGeometry(R1 - PT, 40), {
    color: 0xcabba6, tint: 1, rot: [-Math.PI / 2, 0, 0], pos: [0, H, 0],
    uvFn: (p) => [p.x / STONE_TILE, p.z / STONE_TILE],
  });
  const n = Math.round((Math.PI * 2 * (R1 - PT / 2)) / 1.55);
  const m = merlonGeometry('kangoore', 0.85, 0.95, PT);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R1 - PT / 2;
    b.add(m.clone(), {
      color: 0xffffff, tint: 1,
      pos: [Math.cos(a) * r, H + P, Math.sin(a) * r],
      rot: [0, -a + Math.PI / 2, 0],
      uvFn: (_p, uv) => [uv.x / STONE_TILE, uv.y / STONE_TILE],
    });
  }
  return [{ geometry: b.build(), material: 'stone', shadow: true }];
}

function flagSaffron(): AssetPart[] {
  const pole = new PartBuilder();
  pole.add(cyl(0.05, 0.075, 5.2, 8, 2), { color: 0x6b4a2e, pos: [0, 2.6, 0], smooth: true, colorNoise: 0.15 });
  pole.add(sph(0.11, 10, 8), { color: BRASS, pos: [0, 5.26, 0], smooth: true });
  pole.add(cyl(0.22, 0.28, 0.25, 10), { color: 0x7d7064, pos: [0, 0.1, 0], jitter: 0.02 });
  const cloth = pennantGeometry(1.9, 1.15, 0.42, 0xff7a12);
  cloth.translate(0.05, 3.95, 0);
  return [
    { geometry: pole.build(), material: 'clay', shadow: true },
    { geometry: cloth, material: 'cloth', shadow: true },
  ];
}

// ─────────────────────────────── BUILDINGS ───────────────────────────────

function houseSmall(): AssetPart[] {
  const b = new PartBuilder();
  const W = 4.2, D = 3.4, WH = 2.6, PL = 0.4;
  b.add(box(W + 0.5, PL, D + 0.5), { color: 0x7a6d5d, pos: [0, PL / 2 - 0.1, 0], jitter: 0.03, jitterFreq: 3, colorNoise: 0.15 });
  b.add(box(W, WH, D), { color: 0xf6f1e8, tint: 1, pos: [0, PL + WH / 2 - 0.1, 0], jitter: 0.035, jitterFreq: 2.5, colorNoise: 0.1, ao: [0.2, 1.4, 0.7] });
  // gables
  const eave = PL + WH - 0.1;
  const ang = 0.5;
  const rise = (D / 2) * Math.tan(ang);
  const gable = new ExtrudeGeometry(
    (() => { const s = new Shape(); s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(0, rise); s.lineTo(-D / 2, 0); return s; })(),
    { depth: W - 0.02, bevelEnabled: false },
  );
  gable.rotateY(Math.PI / 2);
  b.add(gable, { color: 0xf6f1e8, tint: 1, pos: [-(W - 0.02) / 2, eave, 0], colorNoise: 0.1 });
  // roof slabs with clay-tile banding
  const over = 0.4;
  const slope = (D / 2 + over) / Math.cos(ang);
  const tileBands = (p: Vector3, c: { multiplyScalar: (k: number) => unknown }) => {
    const d = Math.abs(p.z) * 3.2;
    c.multiplyScalar(0.82 + 0.18 * (d % 1 > 0.5 ? 1 : 0.6));
  };
  for (const sgn of [1, -1]) {
    const cz = sgn * (slope / 2) * Math.cos(ang);
    const cy = eave + rise - (slope / 2) * Math.sin(ang) + 0.08;
    b.add(box(W + 0.7, 0.14, slope), { color: 0xa4512f, pos: [0, cy, cz], rot: [sgn * ang, 0, 0], jitter: 0.03, jitterFreq: 2, colorNoise: 0.15, colorFn: tileBands, seed: 7 });
  }
  b.add(cyl(0.11, 0.11, W + 0.8, 8), { color: 0x8a3f25, pos: [0, eave + rise + 0.14, 0], rot: [0, 0, Math.PI / 2] });
  b.add(box(0.8, 1.6, 0.08), { color: DARK_WOOD, pos: [0, PL + 0.7, D / 2 + 0.02], colorNoise: 0.15 });
  b.add(box(1.0, 0.12, 0.14), { color: 0x5a4030, pos: [0, PL + 1.56, D / 2 + 0.04] });
  b.add(box(1.6, 0.16, 0.6), { color: 0x857766, pos: [0, 0.32, D / 2 + 0.5], jitter: 0.02 });
  const win = new PartBuilder();
  for (const x of [-1.35, 1.35]) {
    win.add(box(0.55, 0.55, 0.06), { color: 0xffa04a, pos: [x, PL + 1.25, D / 2 + 0.02], colorNoise: 0.05 });
  }
  win.add(box(0.06, 0.55, 0.55), { color: 0xffa04a, pos: [W / 2 + 0.02, PL + 1.25, 0] });
  const frames = new PartBuilder();
  for (const x of [-1.35, 1.35]) frames.add(box(0.7, 0.08, 0.1), { color: 0x4a3526, pos: [x, PL + 1.56, D / 2 + 0.04] });
  b.add(frames.build(), { color: 0x4a3526 });
  return [
    { geometry: b.build(), material: 'clay', shadow: true },
    { geometry: win.build(), material: 'window', shadow: false },
  ];
}

function hutRound(): AssetPart[] {
  const b = new PartBuilder();
  b.add(cyl(1.65, 1.75, 2.1, 20, 3), { color: 0xf6f1e8, tint: 1, pos: [0, 1.0, 0], jitter: 0.05, jitterFreq: 2, smooth: true, colorNoise: 0.12, ao: [0, 1.2, 0.65] });
  b.add(cone(2.3, 2.1, 22), {
    color: 0xb59a55, pos: [0, 3.0, 0], jitter: 0.07, jitterFreq: 3, smooth: true, colorNoise: 0.3, colorFreq: 8,
    colorFn: (p, c) => { const k = 0.85 + 0.15 * Math.sin(Math.atan2(p.z, p.x) * 40); c.multiplyScalar(k); },
  });
  b.add(cyl(0.08, 0.12, 0.5, 6), { color: 0x8a7340, pos: [0, 4.2, 0] });
  b.add(box(0.75, 1.5, 0.1), { color: DARK_WOOD, pos: [0, 0.78, 1.66], rot: [0, 0, 0] });
  const glow = new PartBuilder();
  glow.add(box(0.5, 1.2, 0.04), { color: 0xff9640, pos: [0, 0.7, 1.72] });
  return [
    { geometry: b.build(), material: 'clay', shadow: true },
    { geometry: glow.build(), material: 'window', shadow: false },
  ];
}

// ─────────────────────────────── PEOPLE ───────────────────────────────

function humanBase(b: PartBuilder, o: { legs: number; tunic: number; tunicTint: number; sash?: number; lowerFlare?: number }) {
  b.add(cyl(0.085, 0.1, 0.86, 8, 2), { color: o.legs, pos: [-0.11, 0.43, 0], smooth: true });
  b.add(cyl(0.085, 0.1, 0.86, 8, 2), { color: o.legs, pos: [0.11, 0.43, 0], smooth: true });
  b.add(box(0.12, 0.07, 0.24), { color: 0x4a3122, pos: [-0.11, 0.035, 0.04] });
  b.add(box(0.12, 0.07, 0.24), { color: 0x4a3122, pos: [0.11, 0.035, 0.04] });
  b.add(cyl(0.24, o.lowerFlare ?? 0.33, 0.5, 14, 2), { color: o.tunic, tint: o.tunicTint, pos: [0, 1.0, 0], smooth: true, colorNoise: 0.06 });
  b.add(cyl(0.21, 0.25, 0.5, 14, 2), { color: o.tunic, tint: o.tunicTint, pos: [0, 1.45, 0], smooth: true, colorNoise: 0.06 });
  if (o.sash !== undefined) b.add(cyl(0.265, 0.27, 0.1, 14), { color: o.sash, tint: 1, pos: [0, 1.22, 0], smooth: true });
  b.add(sph(0.12, 10, 8), { color: o.tunic, tint: o.tunicTint, pos: [-0.25, 1.63, 0], smooth: true });
  b.add(sph(0.12, 10, 8), { color: o.tunic, tint: o.tunicTint, pos: [0.25, 1.63, 0], smooth: true });
  b.add(cyl(0.07, 0.08, 0.12, 8), { color: SKIN, pos: [0, 1.74, 0] });
  b.add(sph(0.16, 16, 12), { color: SKIN, pos: [0, 1.87, 0.01], scale: [0.95, 1.06, 1], smooth: true, colorNoise: 0.05 });
}

function pheta(b: PartBuilder, color: number, tint: number) {
  b.add(new TorusGeometry(0.14, 0.066, 8, 18), { color, tint, pos: [0, 1.96, 0], rot: [Math.PI / 2, 0, 0], smooth: true, jitter: 0.012, jitterFreq: 20 });
  b.add(sph(0.155, 14, 10), { color, tint, pos: [0, 2.0, 0], scale: [1, 0.55, 1], smooth: true });
  b.add(box(0.12, 0.34, 0.03), { color, tint, pos: [0, 1.8, -0.16], rot: [0.22, 0, 0] });
}

function mavla(): AssetPart[] {
  const b = new PartBuilder();
  humanBase(b, { legs: 0xe3d8c2, tunic: 0xf1e9d8, tunicTint: 0, sash: 0xf6f1e8 });
  pheta(b, 0xf6f1e8, 1);
  b.add(cyl(0.06, 0.07, 0.62, 8), { color: 0xf1e9d8, pos: [-0.3, 1.33, 0.02], rot: [0, 0, 0.12], smooth: true });
  b.add(cyl(0.06, 0.07, 0.6, 8), { color: 0xf1e9d8, pos: [0.31, 1.4, 0.12], rot: [-0.55, 0, -0.12], smooth: true });
  b.add(sph(0.07, 8, 6), { color: SKIN, pos: [-0.34, 1.03, 0.03] });
  b.add(sph(0.07, 8, 6), { color: SKIN, pos: [0.35, 1.16, 0.27] });
  // dhal (shield) with brass bosses
  b.add(cyl(0.28, 0.28, 0.05, 22), { color: 0x3a2a1f, pos: [-0.43, 1.25, 0.05], rot: [0, 0, Math.PI / 2], colorNoise: 0.12 });
  for (const [dy, dz] of [[0.09, 0.09], [-0.09, 0.09], [0.09, -0.09], [-0.09, -0.09]]) {
    b.add(sph(0.03, 6, 5), { color: BRASS, pos: [-0.465, 1.25 + dy, 0.05 + dz] });
  }
  // bhala (spear)
  b.add(cyl(0.022, 0.022, 2.75, 6), { color: 0x4a3423, pos: [0.36, 1.35, 0.27] });
  b.add(cone(0.045, 0.26, 6), { color: 0xa09d96, pos: [0.36, 2.85, 0.27] });
  b.add(sph(0.05, 6, 5), { color: 0xb8322a, pos: [0.36, 2.66, 0.27] });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function villagerMan(): AssetPart[] {
  const b = new PartBuilder();
  humanBase(b, { legs: 0xece6d8, tunic: 0xf6f1e8, tunicTint: 1, lowerFlare: 0.3 });
  b.add(cyl(0.14, 0.24, 0.62, 12, 2), { color: 0xf3eee2, pos: [0, 0.55, 0], smooth: true }); // dhoti
  pheta(b, 0xf6f1e4, 0);
  b.add(cyl(0.06, 0.07, 0.62, 8), { color: 0xf6f1e8, tint: 1, pos: [-0.3, 1.33, 0.02], rot: [0, 0, 0.1], smooth: true });
  b.add(cyl(0.06, 0.07, 0.62, 8), { color: 0xf6f1e8, tint: 1, pos: [0.3, 1.33, 0.02], rot: [0, 0, -0.1], smooth: true });
  b.add(sph(0.07, 8, 6), { color: SKIN, pos: [-0.34, 1.03, 0.03] });
  b.add(sph(0.07, 8, 6), { color: SKIN, pos: [0.34, 1.03, 0.03] });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function villagerWoman(): AssetPart[] {
  const b = new PartBuilder();
  b.add(box(0.12, 0.07, 0.22), { color: 0x4a3122, pos: [-0.1, 0.035, 0.05] });
  b.add(box(0.12, 0.07, 0.22), { color: 0x4a3122, pos: [0.1, 0.035, 0.05] });
  b.add(cyl(0.2, 0.34, 0.98, 16, 3), { color: 0xf6f1e8, tint: 1, pos: [0, 0.52, 0], smooth: true, colorNoise: 0.06 }); // nauvari
  b.add(cyl(0.19, 0.22, 0.45, 14, 2), { color: 0x7a1f2b, pos: [0, 1.22, 0], smooth: true }); // choli
  b.add(box(0.12, 0.62, 0.42), { color: 0xf6f1e8, tint: 1, pos: [0.04, 1.2, 0.02], rot: [0, 0, -0.55] }); // pallu
  b.add(sph(0.11, 10, 8), { color: 0x7a1f2b, pos: [-0.22, 1.4, 0], smooth: true });
  b.add(sph(0.11, 10, 8), { color: 0xf6f1e8, tint: 1, pos: [0.22, 1.4, 0], smooth: true });
  b.add(cyl(0.05, 0.06, 0.58, 8), { color: SKIN, pos: [-0.27, 1.12, 0.02], rot: [0, 0, 0.1], smooth: true });
  b.add(cyl(0.05, 0.06, 0.58, 8), { color: SKIN, pos: [0.27, 1.12, 0.02], rot: [0, 0, -0.1], smooth: true });
  b.add(cyl(0.065, 0.075, 0.12, 8), { color: SKIN, pos: [0, 1.5, 0] });
  b.add(sph(0.15, 16, 12), { color: SKIN, pos: [0, 1.63, 0.01], scale: [0.95, 1.06, 1], smooth: true });
  b.add(sph(0.155, 14, 10), { color: 0x1d1612, pos: [0, 1.68, -0.02], scale: [1, 0.9, 1], smooth: true }); // hair
  b.add(sph(0.09, 10, 8), { color: 0x1d1612, pos: [0, 1.66, -0.16], smooth: true }); // bun
  b.add(sph(0.03, 6, 5), { color: 0xc8202a, pos: [0, 1.7, 0.145] }); // kumkum
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function horse(): AssetPart[] {
  const b = new PartBuilder();
  const coat = 0xf6f1e8;
  b.add(sph(1, 22, 16), { color: coat, tint: 1, pos: [0, 1.35, 0], scale: [0.5, 0.55, 1.15], smooth: true, colorNoise: 0.06 });
  b.add(sph(0.5, 16, 12), { color: coat, tint: 1, pos: [0, 1.42, 0.75], scale: [0.9, 1, 0.9], smooth: true });
  b.add(cyl(0.22, 0.32, 1.05, 12, 3), { color: coat, tint: 1, pos: [0, 1.9, 1.08], rot: [0.62, 0, 0], smooth: true });
  b.add(sph(1, 16, 12), { color: coat, tint: 1, pos: [0, 2.3, 1.55], rot: [0.95, 0, 0], scale: [0.2, 0.22, 0.46], smooth: true });
  b.add(sph(0.14, 10, 8), { color: 0x2a1f18, pos: [0, 2.05, 1.86], scale: [1, 0.9, 1.1], smooth: true });
  b.add(cone(0.05, 0.17, 6), { color: coat, tint: 1, pos: [-0.08, 2.58, 1.42] });
  b.add(cone(0.05, 0.17, 6), { color: coat, tint: 1, pos: [0.08, 2.58, 1.42] });
  b.add(box(0.07, 0.2, 1.0), { color: 0x241811, pos: [0, 2.05, 1.0], rot: [0.62, 0, 0], jitter: 0.03, jitterFreq: 6 });
  for (const [x, z] of [[-0.22, 0.72], [0.22, 0.72], [-0.22, -0.72], [0.22, -0.72]]) {
    b.add(cyl(0.07, 0.1, 1.1, 8, 3), { color: coat, tint: 1, pos: [x, 0.6, z], smooth: true });
    b.add(cyl(0.08, 0.09, 0.1, 8), { color: 0x241811, pos: [x, 0.05, z] });
  }
  b.add(cone(0.14, 1.0, 8), { color: 0x241811, pos: [0, 1.0, -1.25], rot: [-2.65, 0, 0], jitter: 0.04, jitterFreq: 5 });
  b.add(box(0.78, 0.05, 0.85), { color: 0x9a2a22, pos: [0, 1.89, -0.05], colorNoise: 0.1 });
  b.add(sph(0.3, 12, 8), { color: 0x4a2c1a, pos: [0, 1.92, -0.05], scale: [1, 0.35, 1.2], smooth: true });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

function cow(): AssetPart[] {
  const b = new PartBuilder();
  const coat = 0xf6f1e8;
  b.add(sph(1, 20, 14), { color: coat, tint: 1, pos: [0, 1.15, 0], scale: [0.55, 0.58, 1.05], smooth: true });
  b.add(sph(0.32, 12, 10), { color: coat, tint: 1, pos: [0, 1.68, 0.62], scale: [1, 0.9, 1.2], smooth: true });
  b.add(sph(1, 14, 10), { color: coat, tint: 1, pos: [0, 1.38, 1.3], rot: [0.55, 0, 0], scale: [0.24, 0.27, 0.44], smooth: true });
  b.add(sph(0.13, 10, 8), { color: 0x3a2e28, pos: [0, 1.15, 1.62], smooth: true });
  b.add(sph(0.2, 10, 8), { color: coat, tint: 1, pos: [0, 0.98, 1.0], scale: [0.7, 1.2, 0.6], smooth: true });
  for (const s of [-1, 1]) {
    b.add(cone(0.05, 0.42, 6), { color: 0xd8c8a0, pos: [s * 0.2, 1.72, 1.12], rot: [0.2, 0, s * -0.7] });
    b.add(sph(0.08, 8, 6), { color: coat, tint: 1, pos: [s * 0.25, 1.5, 1.18], scale: [1.4, 0.6, 0.6] });
  }
  for (const [x, z] of [[-0.25, 0.65], [0.25, 0.65], [-0.25, -0.65], [0.25, -0.65]]) {
    b.add(cyl(0.08, 0.1, 0.82, 8, 2), { color: coat, tint: 1, pos: [x, 0.42, z], smooth: true });
    b.add(cyl(0.085, 0.095, 0.1, 8), { color: 0x2b221c, pos: [x, 0.05, z] });
  }
  b.add(cyl(0.025, 0.03, 0.9, 6), { color: coat, tint: 1, pos: [0, 0.9, -1.08], rot: [0.25, 0, 0] });
  b.add(sph(0.07, 6, 5), { color: 0x2b221c, pos: [0, 0.45, -1.2] });
  return [{ geometry: b.build(), material: 'clay', shadow: true }];
}

// ─────────────────────────────── DECOR ───────────────────────────────

function cannon(): AssetPart[] {
  const wood = new PartBuilder();
  for (const x of [-0.3, 0.3]) wood.add(box(0.1, 0.45, 1.5), { color: WOOD, pos: [x, 0.62, -0.15], jitter: 0.02, jitterFreq: 4, colorNoise: 0.18 });
  wood.add(box(0.52, 0.15, 0.22), { color: WOOD, pos: [0, 0.45, -0.75] });
  wood.add(box(0.42, 0.12, 0.95), { color: WOOD, pos: [0, 0.22, -1.15], rot: [0.25, 0, 0], colorNoise: 0.18 });
  for (const x of [-0.53, 0.53]) {
    wood.add(cyl(0.5, 0.5, 0.12, 22), { color: 0x5e412a, pos: [x, 0.5, 0.25], rot: [0, 0, Math.PI / 2], colorNoise: 0.2 });
  }
  const metal = new PartBuilder();
  metal.add(
    lathe([[0, -0.15], [0.2, -0.15], [0.25, -0.05], [0.27, 0.05], [0.24, 0.15], [0.23, 0.9], [0.25, 0.95], [0.25, 1.02], [0.21, 1.05], [0.19, 1.9], [0.22, 1.95], [0.22, 2.08], [0.1, 2.08], [0.1, 1.9]], 20),
    { color: IRON, pos: [0, 0.86, -0.62], rot: [Math.PI / 2 - 0.1, 0, 0], colorNoise: 0.12, smooth: true },
  );
  metal.add(sph(0.09, 8, 6), { color: IRON, pos: [0, 0.84, -0.8] });
  metal.add(cyl(0.065, 0.065, 0.72, 8), { color: IRON, pos: [0, 0.86, 0.15], rot: [0, 0, Math.PI / 2] });
  metal.add(cyl(0.06, 0.06, 1.25, 8), { color: IRON, pos: [0, 0.5, 0.25], rot: [0, 0, Math.PI / 2] });
  for (const x of [-0.53, 0.53]) {
    metal.add(new TorusGeometry(0.47, 0.045, 6, 26), { color: 0x2c2a27, pos: [x, 0.5, 0.25], rot: [0, Math.PI / 2, 0] });
  }
  return [
    { geometry: wood.build(), material: 'clay', shadow: true },
    { geometry: metal.build(), material: 'metal', shadow: true },
  ];
}

function cannonballs(): AssetPart[] {
  const b = new PartBuilder();
  const r = 0.13;
  let i = 0;
  for (let layer = 0; layer < 3; layer++) {
    const n = 3 - layer;
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
      const off = (n - 1) / 2;
      b.add(sph(r, 10, 8), { color: 0x2f2d2a, pos: [(x - off) * r * 2, r + layer * r * 1.45, (z - off) * r * 2], colorNoise: 0.15, seed: i++ });
    }
  }
  return [{ geometry: b.build(), material: 'metal', shadow: true }];
}

function torchStand(): AssetPart[] {
  const b = new PartBuilder();
  b.add(cyl(0.05, 0.07, 2.4, 8, 2), { color: 0x5b3e28, pos: [0, 1.2, 0], smooth: true, colorNoise: 0.15 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(cyl(0.03, 0.04, 0.6, 6), { color: 0x5b3e28, pos: [Math.cos(a) * 0.16, 0.26, Math.sin(a) * 0.16], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] });
  }
  b.add(cyl(0.11, 0.12, 0.2, 10), { color: 0x2e2118, pos: [0, 2.52, 0], jitter: 0.015, jitterFreq: 12 });
  const metal = new PartBuilder();
  metal.add(lathe([[0.05, 0], [0.14, 0.04], [0.19, 0.18], [0.17, 0.2], [0.12, 0.08], [0.05, 0.06]], 12), { color: IRON, pos: [0, 2.36, 0], smooth: true });
  const flame = new PartBuilder();
  flame.add(lathe([[0, 0], [0.035, 0.02], [0.045, 0.06], [0.03, 0.12], [0.012, 0.17], [0, 0.2]], 10), {
    color: 0xfff2c0, scale: [3.2, 3.6, 3.2], pos: [0, 2.58, 0], top: { color: 0xff7a1a, from: 2.7, to: 3.2 },
  });
  return [
    { geometry: b.build(), material: 'clay', shadow: true },
    { geometry: metal.build(), material: 'metal', shadow: true },
    { geometry: flame.build(), material: 'flame', noPick: true },
    { geometry: glowQuads([{ c: [0, 2.9, 0], size: 3.4 }]), material: 'glow', noPick: true },
  ];
}

function diya(): AssetPart[] {
  const b = new PartBuilder();
  const spout = (p: Vector3) => {
    const a = Math.atan2(p.z, p.x);
    const k = Math.exp(-(a * a) / 0.14);
    const r = Math.hypot(p.x, p.z);
    const nr = r * (1 + 0.42 * k * Math.min(1, r / 0.2));
    p.x = Math.cos(a * (1 - 0.3 * k)) * nr;
    p.z = Math.sin(a * (1 - 0.3 * k)) * nr;
  };
  b.add(lathe([[0, 0], [0.14, 0], [0.22, 0.04], [0.27, 0.1], [0.28, 0.14], [0.25, 0.145], [0.2, 0.09], [0.1, 0.075], [0, 0.075]], 28), {
    color: 0xb5562a, smooth: true, deform: spout, colorNoise: 0.14, colorFreq: 8,
  });
  b.add(new CircleGeometry(0.2, 20), { color: 0x5a3d12, rot: [-Math.PI / 2, 0, 0], pos: [0, 0.085, 0], deform: spout });
  b.add(cyl(0.014, 0.02, 0.09, 5), { color: 0xeee2c8, pos: [0.3, 0.12, 0], rot: [0, 0, -0.7] });
  const flame = new PartBuilder();
  flame.add(lathe([[0, 0], [0.035, 0.02], [0.045, 0.06], [0.03, 0.12], [0.012, 0.17], [0, 0.2]], 10), {
    color: 0xfff2c0, pos: [0.32, 0.13, 0], top: { color: 0xff7a1a, from: 0.2, to: 0.33 },
  });
  return [
    { geometry: b.build(), material: 'clay', shadow: true },
    { geometry: flame.build(), material: 'flame', noPick: true },
    { geometry: glowQuads([{ c: [0.32, 0.24, 0], size: 2.3 }]), material: 'glow', noPick: true },
  ];
}

function akashKandil(): AssetPart[] {
  const b = new PartBuilder();
  b.add(cyl(0.045, 0.06, 3.7, 8, 3), { color: 0xa8874f, pos: [0, 1.85, 0], smooth: true, colorNoise: 0.12,
    colorFn: (p, c) => { if (Math.abs((p.y % 0.9) - 0.45) < 0.03) c.multiplyScalar(0.7); } });
  b.add(cyl(0.03, 0.035, 1.0, 6), { color: 0xa8874f, pos: [0.45, 3.55, 0], rot: [0, 0, Math.PI / 2] });
  b.add(cyl(0.008, 0.008, 0.38, 4), { color: 0x333333, pos: [0.88, 3.36, 0] });
  const paper = new PartBuilder();
  const star = new ExtrudeGeometry(starShape(0.55, 0.25, 5), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4 });
  star.translate(0, 0, -0.15);
  paper.add(star, { color: 0xf6f1e8, tint: 1, pos: [0.88, 2.65, 0], colorNoise: 0.08 });
  paper.add(cyl(0.12, 0.12, 0.34, 10, 1), { color: 0xfff1d0, pos: [0.88, 2.65, 0], rot: [Math.PI / 2, 0, 0] });
  for (const dx of [-0.14, 0, 0.14]) {
    paper.add(box(0.05, 0.75, 0.012), { color: 0xf6f1e8, tint: 1, pos: [0.88 + dx, 1.82 - Math.abs(dx) * 0.6, 0], rot: [0, 0, dx * 0.6] });
  }
  return [
    { geometry: b.build(), material: 'clay', shadow: true },
    { geometry: paper.build(), material: 'lantern', shadow: true },
    { geometry: glowQuads([{ c: [0.88, 2.65, 0], size: 2.6 }]), material: 'glow', noPick: true },
  ];
}

// ─────────────────────────────── WATER PROPS ───────────────────────────────

function well(): AssetPart[] {
  const b = new PartBuilder(true);
  const stoneUv = (p: Vector3, uv: { x: number }) => [uv.x * 2, p.y / STONE_TILE] as [number, number];
  b.add(lathe([[1.15, -0.6], [1.15, 0.95], [1.12, 1.05], [0.8, 1.05], [0.8, -0.4]], 28), { color: 0xffffff, tint: 1, uvFn: stoneUv, ao: [0, 0.8, 0.6] });
  const wood = new PartBuilder();
  for (const x of [-1.0, 1.0]) wood.add(cyl(0.07, 0.09, 2.3, 8, 2), { color: 0x5b3e28, pos: [x, 1.9, 0], smooth: true, colorNoise: 0.15 });
  wood.add(cyl(0.05, 0.05, 2.2, 8), { color: 0x5b3e28, pos: [0, 2.95, 0], rot: [0, 0, Math.PI / 2] });
  wood.add(new TorusGeometry(0.22, 0.05, 6, 16), { color: 0x4a3423, pos: [0, 2.95, 0], rot: [0, Math.PI / 2, 0] });
  wood.add(cyl(0.012, 0.012, 1.4, 4), { color: 0x9a8a6a, pos: [0.22, 2.25, 0] });
  wood.add(lathe([[0, 0], [0.16, 0], [0.19, 0.24], [0.17, 0.26], [0.14, 0.03], [0, 0.03]], 12), { color: 0x7a6a5a, pos: [0.22, 1.42, 0], smooth: true });
  const water = new PartBuilder();
  water.add(new CircleGeometry(0.8, 28), { color: 0xffffff, rot: [-Math.PI / 2, 0, 0], pos: [0, 0.55, 0] });
  return [
    { geometry: b.build(), material: 'stone', shadow: true },
    { geometry: wood.build(), material: 'clay', shadow: true },
    { geometry: water.build(), material: 'water_small', noPick: true },
  ];
}

function fountain(): AssetPart[] {
  const b = new PartBuilder(true);
  const stoneUv = (p: Vector3, uv: { x: number }) => [uv.x * 3, p.y / STONE_TILE] as [number, number];
  // Lotus-edged basin with a carved central pedestal and bowl.
  b.add(lathe([[2.3, -0.3], [2.3, 0.55], [2.15, 0.62], [1.95, 0.6], [1.95, 0.1], [0.4, 0.1]], 8), { color: 0xffffff, tint: 1, uvFn: stoneUv, ao: [0, 0.5, 0.65] });
  b.add(lathe([[0.32, 0.1], [0.26, 1.2], [0.3, 1.3], [0.9, 1.45], [0.95, 1.6], [0.8, 1.62], [0.25, 1.5], [0.1, 1.9], [0.14, 2.05], [0, 2.1]], 16), { color: 0xffffff, tint: 1, uvFn: stoneUv, smooth: true });
  const water = new PartBuilder();
  water.add(new CircleGeometry(1.95, 32), { color: 0xffffff, rot: [-Math.PI / 2, 0, 0], pos: [0, 0.48, 0] });
  water.add(new CircleGeometry(0.8, 20), { color: 0xffffff, rot: [-Math.PI / 2, 0, 0], pos: [0, 1.56, 0] });
  return [
    { geometry: b.build(), material: 'stone', shadow: true },
    { geometry: water.build(), material: 'water_small', noPick: true },
  ];
}

function rangoliPart(key: 'rangoli_lotus' | 'rangoli_star'): AssetPart[] {
  const b = new PartBuilder(true);
  b.add(new CircleGeometry(1.4, 48), { color: 0xffffff, rot: [-Math.PI / 2, 0, 0], pos: [0, 0.035, 0] });
  return [{ geometry: b.build(), material: key, shadow: false }];
}

// ─────────────────────────────── REGISTRY ───────────────────────────────

const GREEN_VARIANTS = [
  { name: 'Monsoon green', color: 0xffffff },
  { name: 'Deep green', color: 0xb8d0b0 },
  { name: 'Fresh green', color: 0xd8f5a0 },
  { name: 'Olive', color: 0xe8d890 },
  { name: 'Autumn', color: 0xffc070 },
];
const CLOTH_VARIANTS = [
  { name: 'Saffron', color: 0xf08c24 },
  { name: 'White', color: 0xf4efe4 },
  { name: 'Red', color: 0xc0392b },
  { name: 'Maroon', color: 0x8e2a3a },
  { name: 'Green', color: 0x5d8a3c },
];
const STONE_VARIANTS = [
  { name: 'Laterite', color: STONE_TINTS.laterite },
  { name: 'Basalt', color: STONE_TINTS.basalt },
  { name: 'Weathered', color: STONE_TINTS.weathered },
];

let cache: AssetDef[] | null = null;

export function buildCatalog(): AssetDef[] {
  if (cache) return cache;
  const defs: AssetDef[] = [
    // FORT
    { id: 'buruj_round', name: 'Round Buruj', category: 'fort', parts: buruj(), radius: 4.3, height: 10.6, scale: [0.4, 1.8], variants: STONE_VARIANTS, sound: 'stone', platform: { y: 8.5, r: 3.1 },
      info: 'Buruj (bastions) project out from fort walls so defenders can watch and cover the wall faces on either side.' },
    { id: 'flag_saffron', name: 'Bhagwa Flag', category: 'fort', parts: flagSaffron(), radius: 0.4, height: 5.4, scale: [0.6, 2.5], sound: 'wood',
      info: 'The saffron, swallow-tailed Bhagwa Dhwaj is the flag associated with the Maratha forts.' },
    { id: 'cannon', name: 'Cannon', category: 'fort', parts: cannon(), radius: 1.3, height: 1.2, scale: [0.7, 1.6], sound: 'metal',
      info: 'Forts mounted cannons (tof) on bastions and gateways, commanding the approaches.' },
    { id: 'cannonballs', name: 'Cannonballs', category: 'fort', parts: cannonballs(), radius: 0.4, height: 0.5, scale: [0.7, 1.5], randomYaw: true, sound: 'metal' },
    { id: 'torch', name: 'Mashaal', category: 'fort', parts: torchStand(), radius: 0.35, height: 3.2, scale: [0.7, 1.5], sound: 'wood',
      emitter: { offset: [0, 2.8, 0], radius: 7, intensity: 1.2 },
      info: 'A mashaal — cloth wrapped on an iron cup and soaked in oil — lit gateways and ramparts at night.' },

    // BUILDINGS
    { id: 'house_small', name: 'Village House', category: 'buildings', parts: houseSmall(), radius: 2.7, height: 4.4, scale: [0.7, 1.6], sound: 'wood',
      variants: [{ name: 'Mud plaster', color: 0xd4b48a }, { name: 'Whitewash', color: 0xf3eee4 }, { name: 'Ochre', color: 0xdba65a }, { name: 'Indigo', color: 0x9fb0d6 }, { name: 'Red earth', color: 0xc4866a }] },
    { id: 'hut_round', name: 'Round Hut', category: 'buildings', parts: hutRound(), radius: 2.2, height: 4.4, scale: [0.7, 1.5], sound: 'wood',
      variants: [{ name: 'Mud', color: 0xbb8c5e }, { name: 'Lime wash', color: 0xefe9dd }, { name: 'Red earth', color: 0xb5704f }] },

    // NATURE
    { id: 'tree_round', name: 'Round Tree', category: 'nature', parts: treeRound(), radius: 1.6, height: 6, scale: [0.5, 1.8], jitterScale: 0.25, randomYaw: true, scatter: true, variants: GREEN_VARIANTS, sound: 'plant' },
    { id: 'tree_tall', name: 'Ashoka Tree', category: 'nature', parts: treeTall(), radius: 1.2, height: 7.8, scale: [0.5, 1.8], jitterScale: 0.25, randomYaw: true, scatter: true, variants: GREEN_VARIANTS, sound: 'plant' },
    { id: 'tree_large', name: 'Banyan Tree', category: 'nature', parts: treeLarge(), radius: 2.8, height: 8.5, scale: [0.5, 1.8], jitterScale: 0.2, randomYaw: true, scatter: true, variants: GREEN_VARIANTS, sound: 'plant' },
    { id: 'tree_dry', name: 'Dry Tree', category: 'nature', parts: treeDry(), radius: 1.2, height: 6, scale: [0.5, 1.8], jitterScale: 0.25, randomYaw: true, scatter: true, sound: 'plant' },
    { id: 'bush', name: 'Bush', category: 'nature', parts: bush(), radius: 0.9, height: 1.2, scale: [0.5, 2], jitterScale: 0.3, randomYaw: true, scatter: true, variants: GREEN_VARIANTS, sound: 'plant' },
    { id: 'grass', name: 'Grass Tuft', category: 'nature', parts: grassTuft(), radius: 0.3, height: 0.8, scale: [0.5, 2.2], jitterScale: 0.35, randomYaw: true, scatter: true, align: true, variants: GREEN_VARIANTS, sound: 'plant' },
    { id: 'flowers', name: 'Marigolds', category: 'nature', parts: flowers(), radius: 0.35, height: 0.55, scale: [0.6, 2], jitterScale: 0.3, randomYaw: true, scatter: true, align: true, sound: 'plant' },
    { id: 'rock_small', name: 'Stones', category: 'nature', parts: rockSmall(), radius: 0.6, height: 0.5, scale: [0.4, 3], jitterScale: 0.4, randomYaw: true, scatter: true, align: true, sound: 'stone' },
    { id: 'boulder', name: 'Boulder', category: 'nature', parts: boulder(), radius: 1.7, height: 1.9, scale: [0.4, 3], jitterScale: 0.3, randomYaw: true, scatter: true, align: true, sound: 'stone' },
    { id: 'rock_formation', name: 'Sahyadri Rocks', category: 'nature', parts: rockFormation(), radius: 2.2, height: 7, scale: [0.4, 3], jitterScale: 0.25, randomYaw: true, sound: 'stone' },

    // PEOPLE
    { id: 'mavla', name: 'Mavla', category: 'people', parts: mavla(), radius: 0.45, height: 2.9, scale: [0.85, 1.25], variants: CLOTH_VARIANTS, sound: 'soft',
      info: 'Mavlas — hill people of the Maval region of the Sahyadri — formed the backbone of the Maratha infantry.' },
    { id: 'villager_man', name: 'Villager', category: 'people', parts: villagerMan(), radius: 0.4, height: 2.05, scale: [0.85, 1.2], sound: 'soft',
      variants: [{ name: 'White', color: 0xf1ece0 }, { name: 'Indigo', color: 0x4a5f9a }, { name: 'Ochre', color: 0xd9a441 }, { name: 'Leaf', color: 0x7da35a }] },
    { id: 'villager_woman', name: 'Villager (Nauvari)', category: 'people', parts: villagerWoman(), radius: 0.4, height: 1.82, scale: [0.85, 1.2], sound: 'soft',
      variants: [{ name: 'Green', color: 0x2e7d4f }, { name: 'Maroon', color: 0x8e2443 }, { name: 'Purple', color: 0x5e3a8c }, { name: 'Turmeric', color: 0xd9a520 }, { name: 'Rani pink', color: 0xc2477a }] },
    { id: 'horse', name: 'Horse', category: 'people', parts: horse(), radius: 1.3, height: 2.6, scale: [0.85, 1.25], sound: 'soft',
      variants: [{ name: 'Bay', color: 0x6b4226 }, { name: 'Chestnut', color: 0x8a4b22 }, { name: 'White', color: 0xe8e2d6 }, { name: 'Black', color: 0x2a2421 }, { name: 'Grey', color: 0x8d8a85 }] },
    { id: 'cow', name: 'Cow', category: 'people', parts: cow(), radius: 1.2, height: 1.9, scale: [0.85, 1.25], sound: 'soft',
      variants: [{ name: 'White', color: 0xe9e4d8 }, { name: 'Brown', color: 0x8a5a3a }, { name: 'Grey', color: 0x9a958e }] },

    // DIWALI
    { id: 'diya', name: 'Diya', category: 'diwali', parts: diya(), radius: 0.32, height: 0.4, scale: [0.6, 3], align: false, sound: 'diya',
      emitter: { offset: [0.3, 0.2, 0], radius: 4, intensity: 0.8 },
      info: 'Rows of clay diyas are lit on Diwali evenings — on thresholds, walls and, of course, on the killa.' },
    { id: 'akash_kandil', name: 'Akash Kandil', category: 'diwali', parts: akashKandil(), radius: 0.9, height: 3.8, scale: [0.6, 2], sound: 'wood',
      emitter: { offset: [0.88, 2.65, 0], radius: 5.5, intensity: 0.9 },
      variants: [{ name: 'Saffron', color: 0xff8a1f }, { name: 'Red', color: 0xd8342a }, { name: 'Yellow', color: 0xffcf2a }, { name: 'Pink', color: 0xff5fa2 }, { name: 'Green', color: 0x3fbf6a }, { name: 'Blue', color: 0x3f7fdf }],
      info: 'The akash kandil — a star-shaped paper lantern — is hung outside Maharashtrian homes through Diwali.' },
    { id: 'rangoli_lotus', name: 'Rangoli · Lotus', category: 'diwali', parts: rangoliPart('rangoli_lotus'), radius: 1.4, height: 0.05, scale: [0.4, 4], align: true, sound: 'soft',
      info: 'Rangoli is drawn with coloured powder at thresholds and courtyards to welcome guests and festivity.' },
    { id: 'rangoli_star', name: 'Rangoli · Star', category: 'diwali', parts: rangoliPart('rangoli_star'), radius: 1.4, height: 0.05, scale: [0.4, 4], align: true, sound: 'soft' },

    // WATER props (water bodies themselves are drawn with the Water tool)
    { id: 'well', name: 'Well (Vihir)', category: 'water', parts: well(), radius: 1.3, height: 3.1, scale: [0.6, 1.8], variants: STONE_VARIANTS, sound: 'stone',
      info: 'Wells (vihir) and stepwells (barav) kept forts and villages supplied with water through the dry months.' },
    { id: 'fountain', name: 'Fountain (Karanje)', category: 'water', parts: fountain(), radius: 2.4, height: 2.1, scale: [0.6, 2.5], variants: STONE_VARIANTS, sound: 'stone' },
  ];
  cache = defs;
  return defs;
}

const DECOR_IDS = ['cannon', 'cannonballs', 'torch', 'diya', 'akash_kandil', 'flag_saffron', 'rock_small'];

export function assetsForCategory(cat: CategoryId): AssetDef[] {
  const all = buildCatalog();
  if (cat === 'decor') return DECOR_IDS.map((id) => all.find((a) => a.id === id)!).filter(Boolean);
  return all.filter((a) => a.category === cat);
}

export function getAsset(id: string): AssetDef | undefined {
  return buildCatalog().find((a) => a.id === id);
}
