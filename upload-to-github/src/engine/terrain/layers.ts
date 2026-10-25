import {
  DataArrayTexture, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType,
} from 'three';
import { tileFbm, tileNoise2, tileVoronoi } from '../util/noise';
import { smoothstep } from '../util/math';

/** Terrain surface layers. Order is the channel order in the splat maps. */
export const LAYERS = [
  { id: 'red-soil', name: 'Red Soil', rough: 0.95, tile: 7 },
  { id: 'dark-soil', name: 'Dark Soil', rough: 0.93, tile: 7 },
  { id: 'mud', name: 'Mud', rough: 0.6, tile: 9 },
  { id: 'grass', name: 'Grass', rough: 0.92, tile: 5 },
  { id: 'dry-grass', name: 'Dry Grass', rough: 0.95, tile: 6 },
  { id: 'rock', name: 'Rock', rough: 0.82, tile: 19 },
  { id: 'sand', name: 'Sand', rough: 0.96, tile: 6 },
  { id: 'stone', name: 'Stone', rough: 0.78, tile: 5 },
  { id: 'wet-earth', name: 'Wet Earth', rough: 0.42, tile: 8 },
] as const;
export const LAYER_COUNT = LAYERS.length;
export const ROCK_LAYER = 5;

type RGBH = [number, number, number, number];
type Col = [number, number, number];
const mix = (a: Col, b: Col, t: number): Col => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: Col, k: number): Col => [a[0] * k, a[1] * k, a[2] * k];
const TAU = Math.PI * 2;

const GEN: ((u: number, v: number) => RGBH)[] = [
  // Red laterite soil with scattered pebbles
  (u, v) => {
    const n = tileFbm(u, v, 16, 4, 11);
    const g = tileNoise2(u * 96, v * 96, 96, 12);
    const [f1, , id] = tileVoronoi(u, v, 22, 13);
    const peb = smoothstep(0.34, 0.16, f1) * (id > 0.6 ? 1 : 0);
    let c = mul(mix([0.5, 0.23, 0.13], [0.6, 0.31, 0.18], n), 0.84 + 0.32 * g);
    c = mix(c, mul([0.62, 0.48, 0.38], 0.75 + 0.5 * ((id * 7.3) % 1)), peb);
    return [c[0], c[1], c[2], 0.32 + 0.25 * n + 0.13 * g + 0.33 * peb];
  },
  // Dark (black cotton) soil with clods and cracks
  (u, v) => {
    const [f1, f2, id] = tileVoronoi(u, v, 10, 21);
    const crack = smoothstep(0.0, 0.07, f2 - f1);
    const n = tileFbm(u, v, 16, 4, 22);
    const g = tileNoise2(u * 96, v * 96, 96, 23);
    const c = mul([0.19, 0.15, 0.12], (0.78 + 0.4 * n) * (0.85 + 0.3 * g) * (0.55 + 0.45 * crack) * (0.9 + 0.2 * id));
    return [c[0], c[1], c[2], (0.3 + 0.35 * n) * crack + 0.15 * g + 0.1 * (1 - f1)];
  },
  // Smooth wet clay mud
  (u, v) => {
    const n = tileFbm(u, v, 12, 4, 31);
    const s = tileFbm(u, v, 16, 3, 32);
    const c = mul(mix([0.32, 0.2, 0.12], [0.41, 0.27, 0.17], n), 0.9 + 0.16 * s);
    return [c[0], c[1], c[2], 0.3 + 0.25 * n + 0.1 * s];
  },
  // Miniature turf: Voronoi tufts read as blades without any lattice grid
  (u, v) => {
    const [f1, , id] = tileVoronoi(u, v, 90, 41);
    const [g1, , gid] = tileVoronoi(u, v, 170, 44);
    const tuft = smoothstep(0.62, 0.0, f1), fine = smoothstep(0.55, 0.0, g1);
    const m = tileFbm(u, v, 24, 3, 42);
    let c = mix([0.12, 0.21, 0.05], [0.36, 0.48, 0.13], tuft * 0.5 + fine * 0.3 + m * 0.2);
    c = mul(c, 0.86 + 0.18 * id + 0.08 * gid);
    return [c[0], c[1], c[2], tuft * 0.55 + fine * 0.3 + m * 0.15];
  },
  // Dry grass / straw
  (u, v) => {
    const [f1, , id] = tileVoronoi(u, v, 80, 51);
    const [g1, , gid] = tileVoronoi(u, v, 160, 54);
    const straw = smoothstep(0.62, 0.0, f1), fine = smoothstep(0.5, 0.0, g1);
    const n = tileFbm(u, v, 24, 3, 52);
    let c = mix([0.44, 0.35, 0.17], [0.74, 0.63, 0.38], straw * 0.5 + fine * 0.3 + n * 0.2);
    c = mul(c, 0.88 + 0.16 * id + 0.06 * gid);
    return [c[0], c[1], c[2], straw * 0.55 + fine * 0.3 + n * 0.15];
  },
  // Deccan basalt rock: cracked, faintly layered, with lichen
  (u, v) => {
    const [f1, f2, id] = tileVoronoi(u, v, 4, 61);
    const crack = smoothstep(0.0, 0.03, f2 - f1);
    const n = tileFbm(u, v, 8, 5, 62);
    const strata = 0.5 + 0.5 * Math.sin((v + n * 0.12) * TAU * 9);
    const l = tileFbm(u, v, 10, 3, 63);
    let c = mul([0.47, 0.42, 0.37], (0.74 + 0.34 * n) * (0.86 + 0.2 * strata) * (0.78 + 0.22 * crack) * (0.92 + 0.16 * id));
    c = mix(c, [0.5, 0.49, 0.35], smoothstep(0.66, 0.8, l) * 0.5);
    return [c[0], c[1], c[2], (0.4 + 0.4 * n) * crack + 0.1 * strata + 0.1 * (1 - f1)];
  },
  // Fine sand with ripples
  (u, v) => {
    const g = tileNoise2(u * 192, v * 192, 192, 71);
    const n = tileFbm(u, v, 16, 3, 72);
    const ripple = 0.5 + 0.5 * Math.sin((u + n * 0.15) * TAU * 14);
    const c = mul(mix([0.66, 0.54, 0.36], [0.8, 0.69, 0.5], n), (0.92 + 0.12 * g) * (0.95 + 0.07 * ripple));
    return [c[0], c[1], c[2], 0.35 + 0.2 * ripple + 0.2 * g];
  },
  // Cobbled stone paving
  (u, v) => {
    const [f1, f2, id] = tileVoronoi(u, v, 9, 81);
    const edge = smoothstep(0.02, 0.13, f2 - f1);
    const n = tileFbm(u, v, 16, 3, 82);
    const stone = mul(mix([0.42, 0.39, 0.35], [0.63, 0.57, 0.48], id), 0.84 + 0.26 * n);
    const c = mix([0.27, 0.23, 0.19], stone, edge);
    return [c[0], c[1], c[2], edge * (0.55 + 0.25 * n) + 0.15 * (1 - f1)];
  },
  // Wet earth with damp pools
  (u, v) => {
    const n = tileFbm(u, v, 16, 4, 91);
    const p = tileFbm(u, v, 8, 3, 92);
    const puddle = smoothstep(0.64, 0.72, p);
    const c = mul([0.21, 0.12, 0.08], (0.8 + 0.35 * n) * (1 - 0.3 * puddle));
    return [c[0], c[1], c[2], 0.4 + 0.3 * n - 0.3 * puddle];
  },
];

export const LAYER_RES = 512;

export interface TerrainLayerSet {
  texture: DataArrayTexture;
  swatches: string[];
  /** Mean linear colour per layer (for detail-ratio blending in the shader). */
  avg: [number, number, number][];
}

const toByte = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255));

/** Generates every layer, yielding between layers so the loading screen can update. */
export async function generateTerrainLayers(onProgress?: (p: number) => void): Promise<TerrainLayerSet> {
  const R = LAYER_RES;
  const data = new Uint8Array(R * R * 4 * LAYER_COUNT);
  const swatches: string[] = [];
  const avg: [number, number, number][] = [];
  const lin = (b: number) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  for (let l = 0; l < LAYER_COUNT; l++) {
    let sr = 0, sg = 0, sb = 0;
    const fn = GEN[l];
    const off = l * R * R * 4;
    for (let y = 0; y < R; y++) {
      const v = y / R;
      for (let x = 0; x < R; x++) {
        const [r, g, b, h] = fn(x / R, v);
        const k = off + (y * R + x) * 4;
        data[k] = toByte(r);
        data[k + 1] = toByte(g);
        data[k + 2] = toByte(b);
        data[k + 3] = toByte(h);
        sr += lin(data[k]); sg += lin(data[k + 1]); sb += lin(data[k + 2]);
      }
    }
    avg.push([sr / (R * R), sg / (R * R), sb / (R * R)]);
    swatches.push(makeSwatch(data, off, R));
    onProgress?.((l + 1) / LAYER_COUNT);
    await new Promise((r) => setTimeout(r, 0));
  }
  const tex = new DataArrayTexture(data, R, R, LAYER_COUNT);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return { texture: tex, swatches, avg };
}

function makeSwatch(data: Uint8Array, off: number, R: number): string {
  const S = 72;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const step = R / 2 / S; // show half a tile so detail reads at swatch size
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = Math.floor(x * step), sy = Math.floor(y * step);
      const k = off + (sy * R + sx) * 4;
      const o = (y * S + x) * 4;
      img.data[o] = data[k];
      img.data[o + 1] = data[k + 1];
      img.data[o + 2] = data[k + 2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
