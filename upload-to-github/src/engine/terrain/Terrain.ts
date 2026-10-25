import {
  BufferAttribute, BufferGeometry, DataArrayTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh,
  Ray, RGBAFormat, Sphere, Box3, UnsignedByteType, Vector3, ClampToEdgeWrapping,
} from 'three';
import type { PlotSizeId, SculptMode } from '../../state/store';
import { brushFalloff, clamp, smoothstep } from '../util/math';
import { fbm2 } from '../util/noise';
import { createTerrainMaterial } from './TerrainMaterial';
import { LAYER_COUNT } from './layers';

export const PLOT_SIZES: Record<PlotSizeId, { size: number; res: number; splat: number; label: string }> = {
  small: { size: 128, res: 161, splat: 384, label: 'Small' },
  medium: { size: 192, res: 241, splat: 512, label: 'Medium' },
  large: { size: 256, res: 321, splat: 704, label: 'Large' },
};
export const H_MIN = -16;
export const H_MAX = 112;
const EDGE_MARGIN = 6;
const GLOW_RES = 256;

export interface GridRect { i0: number; j0: number; i1: number; j1: number }

export interface StrokeState {
  mode: SculptMode;
  before: Float32Array;
  startX: number;
  startZ: number;
  startH: number;
}

export interface Emitter { x: number; z: number; radius: number; intensity: number }

export function unionRect(a: GridRect | null, b: GridRect): GridRect {
  if (!a) return { ...b };
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

export class Terrain {
  readonly sizeId: PlotSizeId;
  readonly size: number;
  readonly res: number;
  readonly half: number;
  readonly spacing: number;
  readonly splatRes: number;

  readonly heights: Float32Array;
  private readonly edge: Float32Array;
  private readonly scratch: Float32Array;
  private readonly roughField: Float32Array;

  readonly splat: Uint8Array[];
  readonly splatTex: DataTexture[];
  private splatDirty = false;
  readonly glowTex: DataTexture;
  private readonly glowData: Uint8Array;

  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly material: ReturnType<typeof createTerrainMaterial>;
  private pending: GridRect | null = null;

  constructor(sizeId: PlotSizeId, layers: DataArrayTexture, layerAvg: [number, number, number][]) {
    const cfg = PLOT_SIZES[sizeId];
    this.sizeId = sizeId;
    this.size = cfg.size;
    this.res = cfg.res;
    this.half = cfg.size / 2;
    this.spacing = cfg.size / (cfg.res - 1);
    this.splatRes = cfg.splat;

    const n = this.res * this.res;
    this.heights = new Float32Array(n);
    this.scratch = new Float32Array(n);
    this.edge = new Float32Array(n);
    this.roughField = new Float32Array(n);
    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        const x = -this.half + i * this.spacing, z = -this.half + j * this.spacing;
        const d = Math.min(this.half - Math.abs(x), this.half - Math.abs(z));
        this.edge[j * this.res + i] = smoothstep(0, EDGE_MARGIN, d);
        this.roughField[j * this.res + i] = (fbm2(x * 0.22, z * 0.22, 4, 909) - 0.5) * 2;
      }
    }

    // Splat maps: 3 × RGBA = up to 12 layers.
    this.splat = [0, 1, 2].map(() => new Uint8Array(this.splatRes * this.splatRes * 4));
    this.splatTex = this.splat.map((d) => {
      const t = new DataTexture(d, this.splatRes, this.splatRes, RGBAFormat, UnsignedByteType);
      t.magFilter = LinearFilter;
      t.minFilter = LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    });
    this.glowData = new Uint8Array(GLOW_RES * GLOW_RES * 4);
    this.glowTex = new DataTexture(this.glowData, GLOW_RES, GLOW_RES, RGBAFormat, UnsignedByteType);
    this.glowTex.magFilter = LinearFilter;
    this.glowTex.minFilter = LinearFilter;
    this.glowTex.needsUpdate = true;

    this.geometry = this.buildGeometry();
    this.material = createTerrainMaterial(layers, { splats: this.splatTex, glow: this.glowTex, plotHalf: this.half, avg: layerAvg });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.resetSplat();
  }

  private buildGeometry(): BufferGeometry {
    const { res, spacing, half } = this;
    const pos = new Float32Array(res * res * 3);
    const nor = new Float32Array(res * res * 3);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = (j * res + i) * 3;
        pos[k] = -half + i * spacing;
        pos[k + 1] = 0;
        pos[k + 2] = -half + j * spacing;
        nor[k + 1] = 1;
      }
    }
    const idx = new Uint32Array((res - 1) * (res - 1) * 6);
    let p = 0;
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = j * res + i, b = a + 1, c = a + res, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }
    const g = new BufferGeometry();
    const pa = new BufferAttribute(pos, 3);
    const na = new BufferAttribute(nor, 3);
    pa.setUsage(35048 /* DynamicDrawUsage */);
    na.setUsage(35048);
    g.setAttribute('position', pa);
    g.setAttribute('normal', na);
    g.setIndex(new BufferAttribute(idx, 1));
    g.boundingSphere = new Sphere(new Vector3(0, (H_MIN + H_MAX) / 2, 0), Math.hypot(half * 1.42, (H_MAX - H_MIN) / 2));
    g.boundingBox = new Box3(new Vector3(-half, H_MIN, -half), new Vector3(half, H_MAX, half));
    return g;
  }

  // ───────────────────────────── sampling ─────────────────────────────

  inside(x: number, z: number, margin = 0): boolean {
    return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
  }

  heightAt(x: number, z: number, src: Float32Array = this.heights): number {
    const gx = (x + this.half) / this.spacing, gz = (z + this.half) / this.spacing;
    const r = this.res;
    if (gx < 0 || gz < 0 || gx > r - 1 || gz > r - 1) return 0;
    const i = Math.min(Math.floor(gx), r - 2), j = Math.min(Math.floor(gz), r - 2);
    const fx = gx - i, fz = gz - j;
    const k = j * r + i;
    const h00 = src[k], h10 = src[k + 1], h01 = src[k + r], h11 = src[k + r + 1];
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
  }

  normalAt(x: number, z: number, out = new Vector3()): Vector3 {
    const e = this.spacing;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  /** Heightfield ray-march + bisection; falls back to the y=0 ground plane outside the plot. */
  raycast(ray: Ray, out = new Vector3()): Vector3 | null {
    const o = ray.origin, d = ray.direction;
    const h = this.half;
    // Slab test against plot AABB
    let t0 = 0, t1 = 20000;
    const bmin = [-h, H_MIN - 1, -h], bmax = [h, H_MAX + 1, h];
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    let hitBox = true;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(da[a]) < 1e-9) {
        if (oa[a] < bmin[a] || oa[a] > bmax[a]) { hitBox = false; break; }
      } else {
        let ta = (bmin[a] - oa[a]) / da[a], tb = (bmax[a] - oa[a]) / da[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) { hitBox = false; break; }
      }
    }
    if (hitBox) {
      const step = this.spacing * 0.5;
      let tPrev = t0;
      let fPrev = o.y + d.y * t0 - this.heightAt(o.x + d.x * t0, o.z + d.z * t0);
      if (fPrev < 0) return out.set(o.x + d.x * t0, this.heightAt(o.x + d.x * t0, o.z + d.z * t0), o.z + d.z * t0);
      for (let t = t0 + step; t <= t1 + step; t += step) {
        const tt = Math.min(t, t1);
        const x = o.x + d.x * tt, z = o.z + d.z * tt;
        const f = o.y + d.y * tt - this.heightAt(x, z);
        if (f <= 0) {
          let lo = tPrev, hi = tt;
          for (let k = 0; k < 10; k++) {
            const m = (lo + hi) / 2;
            const fm = o.y + d.y * m - this.heightAt(o.x + d.x * m, o.z + d.z * m);
            if (fm > 0) lo = m; else hi = m;
          }
          const tm = (lo + hi) / 2;
          const hx = o.x + d.x * tm, hz = o.z + d.z * tm;
          return out.set(hx, this.heightAt(hx, hz), hz);
        }
        tPrev = tt;
        fPrev = f;
        if (tt >= t1) break;
      }
    }
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0) {
        const x = o.x + d.x * t, z = o.z + d.z * t;
        if (!this.inside(x, z)) return out.set(x, 0, z);
      }
    }
    return null;
  }

  // ───────────────────────────── sculpting ─────────────────────────────

  gridRect(cx: number, cz: number, r: number, pad = 0): GridRect {
    const s = this.spacing, h = this.half, n = this.res;
    return {
      i0: clamp(Math.floor((cx - r + h) / s) - pad, 1, n - 2),
      j0: clamp(Math.floor((cz - r + h) / s) - pad, 1, n - 2),
      i1: clamp(Math.ceil((cx + r + h) / s) + pad, 1, n - 2),
      j1: clamp(Math.ceil((cz + r + h) / s) + pad, 1, n - 2),
    };
  }

  beginStroke(mode: SculptMode, x: number, z: number): StrokeState {
    return { mode, before: this.heights.slice(), startX: x, startZ: z, startH: this.heightAt(x, z) };
  }

  /** Applies one frame of a brush. Returns the touched rect (or null). */
  sculpt(stroke: StrokeState, mode: SculptMode, cx: number, cz: number, radius: number, strength: number, falloff: number, dt: number): GridRect | null {
    const H = this.heights, S = this.scratch, E = this.edge, n = this.res, sp = this.spacing, half = this.half;
    const rect = this.gridRect(cx, cz, radius);
    if (rect.i0 > rect.i1 || rect.j0 > rect.j1) return null;
    const r2 = radius * radius;
    const rate = strength * (1.5 + radius * 0.45);
    const fall = (i: number, j: number) => {
      const x = -half + i * sp - cx, z = -half + j * sp - cz;
      const d2 = x * x + z * z;
      if (d2 >= r2) return 0;
      return brushFalloff(Math.sqrt(d2) / radius, falloff);
    };
    const smoothPass = (amount: number) => {
      S.set(H);
      for (let j = rect.j0; j <= rect.j1; j++) {
        for (let i = rect.i0; i <= rect.i1; i++) {
          const f = fall(i, j);
          if (f <= 0) continue;
          const k = j * n + i;
          const avg = (S[k - 1] + S[k + 1] + S[k - n] + S[k + n] + S[k - n - 1] + S[k - n + 1] + S[k + n - 1] + S[k + n + 1] + S[k] * 2) / 10;
          H[k] += (avg - S[k]) * clamp(amount * f, 0, 1) * E[k];
        }
      }
    };

    switch (mode) {
      case 'raise':
      case 'lower': {
        const sign = mode === 'raise' ? 1 : -1;
        for (let j = rect.j0; j <= rect.j1; j++) {
          for (let i = rect.i0; i <= rect.i1; i++) {
            const f = fall(i, j);
            if (f <= 0) continue;
            const k = j * n + i;
            H[k] += sign * rate * dt * f * E[k];
          }
        }
        smoothPass(dt * 3.2); // wet-mud settling
        break;
      }
      case 'smooth': {
        // Wide, brush-scaled blur so big brushes can soften whole mountains, not just ridges.
        const k = clamp(Math.round(radius / (sp * 7)), 1, 10);
        const B = this.boxBlur(rect, k);
        const w = rect.i1 - rect.i0 + 1;
        const amt = clamp(strength * dt * 6, 0, 1);
        for (let j = rect.j0; j <= rect.j1; j++) {
          for (let i = rect.i0; i <= rect.i1; i++) {
            const f = fall(i, j);
            if (f <= 0) continue;
            const q = j * n + i;
            H[q] += (B[(j - rect.j0) * w + (i - rect.i0)] - H[q]) * amt * f * E[q];
          }
        }
        smoothPass(strength * dt * 8);
        break;
      }
      case 'flatten': {
        const target = stroke.startH;
        const k0 = clamp(strength * dt * 8, 0, 1);
        for (let j = rect.j0; j <= rect.j1; j++) {
          for (let i = rect.i0; i <= rect.i1; i++) {
            const f = fall(i, j);
            if (f <= 0) continue;
            const k = j * n + i;
            H[k] += (target - H[k]) * k0 * f * E[k];
          }
        }
        break;
      }
      case 'slope': {
        const ax = stroke.startX, az = stroke.startZ, ah = stroke.startH;
        const bh = this.heightAt(cx, cz, stroke.before);
        const dx = cx - ax, dz = cz - az;
        const len2 = dx * dx + dz * dz;
        if (len2 < 0.25) break;
        const k0 = clamp(strength * dt * 10, 0, 1);
        for (let j = rect.j0; j <= rect.j1; j++) {
          for (let i = rect.i0; i <= rect.i1; i++) {
            const f = fall(i, j);
            if (f <= 0) continue;
            const x = -half + i * sp, z = -half + j * sp;
            const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
            const target = ah + (bh - ah) * t;
            const k = j * n + i;
            H[k] += (target - H[k]) * k0 * f * E[k];
          }
        }
        break;
      }
      case 'roughen': {
        const amp = 0.6 + radius * 0.12;
        const k0 = clamp(strength * dt * 4, 0, 1);
        for (let j = rect.j0; j <= rect.j1; j++) {
          for (let i = rect.i0; i <= rect.i1; i++) {
            const f = fall(i, j);
            if (f <= 0) continue;
            const k = j * n + i;
            const target = stroke.before[k] + this.roughField[k] * amp;
            H[k] += (target - H[k]) * k0 * f * E[k];
          }
        }
        break;
      }
      case 'erode': {
        const talus = sp * 0.55;
        const amt = clamp(strength * dt * 9, 0, 0.5);
        for (let it = 0; it < 3; it++) {
          S.set(H);
          for (let j = rect.j0; j <= rect.j1; j++) {
            for (let i = rect.i0; i <= rect.i1; i++) {
              const f = fall(i, j);
              if (f <= 0) continue;
              const k = j * n + i;
              const h = S[k];
              const nb = [k - 1, k + 1, k - n, k + n];
              for (const q of nb) {
                const d = h - S[q];
                if (d > talus) {
                  const m = (d - talus) * 0.22 * amt * f * E[k];
                  H[k] -= m;
                  H[q] += m * 0.92; // a little material washes away
                }
              }
            }
          }
        }
        smoothPass(strength * dt * 2.5);
        break;
      }
    }
    for (let j = rect.j0 - 1; j <= rect.j1 + 1; j++) {
      for (let i = rect.i0 - 1; i <= rect.i1 + 1; i++) {
        const k = j * n + i;
        H[k] = clamp(H[k], H_MIN, H_MAX);
      }
    }
    const touched = { i0: rect.i0 - 1, j0: rect.j0 - 1, i1: rect.i1 + 1, j1: rect.j1 + 1 };
    this.markDirty(touched);
    return touched;
  }

  /** Separable box blur of heights over `rect` (half-width k), via running sums. */
  private boxBlur(rect: GridRect, k: number): Float32Array {
    const n = this.res, H = this.heights;
    const w = rect.i1 - rect.i0 + 1, h = rect.j1 - rect.j0 + 1;
    const rows = h + 2 * k;
    const tmp = new Float32Array(w * rows);
    // horizontal pass over rows j0-k .. j1+k
    for (let r = 0; r < rows; r++) {
      const j = clamp(rect.j0 - k + r, 0, n - 1);
      const base = j * n;
      let sum = 0;
      for (let d = -k; d <= k; d++) sum += H[base + clamp(rect.i0 + d, 0, n - 1)];
      for (let i = 0; i < w; i++) {
        tmp[r * w + i] = sum / (2 * k + 1);
        sum += H[base + clamp(rect.i0 + i + k + 1, 0, n - 1)] - H[base + clamp(rect.i0 + i - k, 0, n - 1)];
      }
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < w; i++) {
      let sum = 0;
      for (let d = 0; d <= 2 * k; d++) sum += tmp[d * w + i];
      for (let j = 0; j < h; j++) {
        out[j * w + i] = sum / (2 * k + 1);
        if (j + 2 * k + 1 < rows) sum += tmp[(j + 2 * k + 1) * w + i] - tmp[j * w + i];
      }
    }
    return out;
  }

  markDirty(r: GridRect) {
    this.pending = unionRect(this.pending, r);
  }

  /** Writes pending height changes to the GPU: positions + analytic normals for the touched rows only. */
  flush(): boolean {
    let changed = false;
    if (this.pending) {
      this.syncRect(this.pending);
      this.pending = null;
      changed = true;
    }
    if (this.splatDirty) {
      for (const t of this.splatTex) t.needsUpdate = true;
      this.splatDirty = false;
      changed = true;
    }
    return changed;
  }

  private syncRect(r0: GridRect) {
    const n = this.res, H = this.heights, s2 = this.spacing * 2;
    const r = { i0: clamp(r0.i0 - 1, 0, n - 1), j0: clamp(r0.j0 - 1, 0, n - 1), i1: clamp(r0.i1 + 1, 0, n - 1), j1: clamp(r0.j1 + 1, 0, n - 1) };
    const pa = this.geometry.getAttribute('position') as BufferAttribute;
    const na = this.geometry.getAttribute('normal') as BufferAttribute;
    const pos = pa.array as Float32Array, nor = na.array as Float32Array;
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const k = j * n + i;
        pos[k * 3 + 1] = H[k];
        const hl = H[j * n + Math.max(i - 1, 0)], hr = H[j * n + Math.min(i + 1, n - 1)];
        const hd = H[Math.max(j - 1, 0) * n + i], hu = H[Math.min(j + 1, n - 1) * n + i];
        let nx = hl - hr, ny = s2, nz = hd - hu;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv; ny *= inv; nz *= inv;
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      }
    }
    const start = r.j0 * n * 3, count = (r.j1 - r.j0 + 1) * n * 3;
    pa.addUpdateRange(start, count);
    na.addUpdateRange(start, count);
    pa.needsUpdate = true;
    na.needsUpdate = true;
  }

  syncAll() {
    this.pending = { i0: 0, j0: 0, i1: this.res - 1, j1: this.res - 1 };
    this.flush();
  }

  extractRect(src: Float32Array, r: GridRect): Float32Array {
    const w = r.i1 - r.i0 + 1, h = r.j1 - r.j0 + 1;
    const out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) out.set(src.subarray((r.j0 + j) * this.res + r.i0, (r.j0 + j) * this.res + r.i0 + w), j * w);
    return out;
  }

  writeRect(r: GridRect, data: Float32Array) {
    const w = r.i1 - r.i0 + 1, h = r.j1 - r.j0 + 1;
    for (let j = 0; j < h; j++) this.heights.set(data.subarray(j * w, (j + 1) * w), (r.j0 + j) * this.res + r.i0);
    this.markDirty(r);
  }

  /** World-space AABB of a grid rect (x0,z0,x1,z1). */
  rectBounds(r: GridRect): [number, number, number, number] {
    const s = this.spacing, h = this.half;
    return [-h + r.i0 * s, -h + r.j0 * s, -h + r.i1 * s, -h + r.j1 * s];
  }

  // ───────────────────────────── painting ─────────────────────────────

  texelRect(cx: number, cz: number, r: number): GridRect {
    const W = this.splatRes, ts = this.size / W, h = this.half;
    return {
      i0: clamp(Math.floor((cx - r + h) / ts), 0, W - 1),
      j0: clamp(Math.floor((cz - r + h) / ts), 0, W - 1),
      i1: clamp(Math.ceil((cx + r + h) / ts), 0, W - 1),
      j1: clamp(Math.ceil((cz + r + h) / ts), 0, W - 1),
    };
  }

  paint(layer: number, cx: number, cz: number, radius: number, strength: number, falloff: number, dt: number): GridRect {
    const W = this.splatRes, ts = this.size / W, h = this.half;
    const rect = this.texelRect(cx, cz, radius);
    const amount = clamp(strength * dt * 7, 0, 1);
    const w = new Float32Array(12);
    const [A, B, C] = this.splat;
    const tex = layer >> 2, ch = layer & 3;
    for (let j = rect.j0; j <= rect.j1; j++) {
      for (let i = rect.i0; i <= rect.i1; i++) {
        const x = (i + 0.5) * ts - h - cx, z = (j + 0.5) * ts - h - cz;
        const d = Math.sqrt(x * x + z * z);
        if (d >= radius) continue;
        const f = brushFalloff(d / radius, falloff) * amount;
        if (f <= 0) continue;
        const k = (j * W + i) * 4;
        for (let c = 0; c < 4; c++) { w[c] = A[k + c]; w[4 + c] = B[k + c]; w[8 + c] = C[k + c]; }
        const L = tex * 4 + ch;
        const wl = w[L] / 255;
        const nl = wl + (1 - wl) * f;
        const scale = wl < 0.999 ? (1 - nl) / (1 - wl) : 0;
        for (let c = 0; c < 12; c++) w[c] = c === L ? nl * 255 : w[c] * scale;
        for (let c = 0; c < 4; c++) { A[k + c] = Math.round(w[c]); B[k + c] = Math.round(w[4 + c]); C[k + c] = Math.round(w[8 + c]); }
      }
    }
    this.splatDirty = true;
    return rect;
  }

  snapshotSplat(): Uint8Array[] {
    return this.splat.map((s) => s.slice());
  }

  extractSplatRect(src: Uint8Array[], r: GridRect): Uint8Array[] {
    const W = this.splatRes, w = (r.i1 - r.i0 + 1) * 4, h = r.j1 - r.j0 + 1;
    return src.map((s) => {
      const out = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) out.set(s.subarray(((r.j0 + j) * W + r.i0) * 4, ((r.j0 + j) * W + r.i0) * 4 + w), j * w);
      return out;
    });
  }

  writeSplatRect(r: GridRect, data: Uint8Array[]) {
    const W = this.splatRes, w = (r.i1 - r.i0 + 1) * 4, h = r.j1 - r.j0 + 1;
    data.forEach((d, t) => {
      for (let j = 0; j < h; j++) this.splat[t].set(d.subarray(j * w, (j + 1) * w), ((r.j0 + j) * W + r.i0) * 4);
    });
    this.splatDirty = true;
  }

  /** The starting patch: a soft island of red earth inside grass. */
  resetSplat() {
    const W = this.splatRes, ts = this.size / W, h = this.half;
    const [A, B, C] = this.splat;
    A.fill(0); B.fill(0); C.fill(0);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) * ts - h, z = (j + 0.5) * ts - h;
        const r = Math.hypot(x, z) / (h * 0.66) + (fbm2(x * 0.03, z * 0.03, 3, 77) - 0.5) * 0.5;
        const soil = 1 - smoothstep(0.72, 1.0, r);
        const dry = smoothstep(0.55, 0.75, fbm2(x * 0.02 + 9, z * 0.02, 3, 78)) * (1 - soil) * 0.8;
        const dark = smoothstep(0.62, 0.8, fbm2(x * 0.05, z * 0.05 + 3, 2, 79)) * soil * 0.35;
        const grass = Math.max(0, 1 - soil - dry);
        const k = (j * W + i) * 4;
        A[k] = Math.round((soil - dark) * 255);
        A[k + 1] = Math.round(dark * 255);
        A[k + 3] = Math.round(grass * 255);
        B[k] = Math.round(dry * 255);
      }
    }
    this.splatDirty = true;
  }

  // ───────────────────────────── lamp glow map ─────────────────────────────

  setEmitters(emitters: Emitter[]) {
    const G = GLOW_RES, ts = this.size / G, h = this.half;
    const acc = new Float32Array(G * G);
    for (const e of emitters) {
      const i0 = clamp(Math.floor((e.x - e.radius + h) / ts), 0, G - 1), i1 = clamp(Math.ceil((e.x + e.radius + h) / ts), 0, G - 1);
      const j0 = clamp(Math.floor((e.z - e.radius + h) / ts), 0, G - 1), j1 = clamp(Math.ceil((e.z + e.radius + h) / ts), 0, G - 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * ts - h - e.x, z = (j + 0.5) * ts - h - e.z;
          const d = Math.sqrt(x * x + z * z) / e.radius;
          if (d >= 1) continue;
          const f = (1 - d) * (1 - d);
          acc[j * G + i] += f * e.intensity;
        }
      }
    }
    for (let k = 0; k < G * G; k++) {
      const v = 1 - Math.exp(-acc[k] * 1.3);
      this.glowData[k * 4] = Math.round(v * 255);
    }
    this.glowTex.needsUpdate = true;
  }

  // ───────────────────────────── persistence ─────────────────────────────

  encodeHeights(): Uint16Array {
    const out = new Uint16Array(this.heights.length);
    const k = 65535 / (H_MAX - H_MIN);
    for (let i = 0; i < out.length; i++) out[i] = Math.round((clamp(this.heights[i], H_MIN, H_MAX) - H_MIN) * k);
    return out;
  }

  decodeHeights(src: Uint16Array) {
    const k = (H_MAX - H_MIN) / 65535;
    for (let i = 0; i < this.heights.length && i < src.length; i++) this.heights[i] = H_MIN + src[i] * k;
    this.syncAll();
  }

  setSplat(data: Uint8Array[]) {
    data.forEach((d, i) => this.splat[i].set(d.subarray(0, this.splat[i].length)));
    this.splatDirty = true;
  }

  set autoCliff(v: boolean) {
    this.material.userData.k.uAutoCliff.value = v ? 1 : 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.splatTex.forEach((t) => t.dispose());
    this.glowTex.dispose();
  }
}

export { LAYER_COUNT };
