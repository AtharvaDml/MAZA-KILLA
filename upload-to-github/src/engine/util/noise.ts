/** Deterministic hashing / value noise used for procedural textures, geometry jitter and terrain. */

export function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hash2(ix: number, iy: number, seed = 0): number {
  return hash32(Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 1, 1442695041)) / 4294967296;
}

export function hash3(ix: number, iy: number, iz: number, seed = 0): number {
  return (
    hash32(Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2246822519) ^ Math.imul(seed + 1, 1442695041)) /
    4294967296
  );
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable value noise: lattice wraps every `period` cells. x,y in lattice units. */
export function tileNoise2(x: number, y: number, period: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const x0 = ((ix % period) + period) % period, y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fBm over a unit tile (u,v in [0,1)). Returns ~[0,1]. */
export function tileFbm(u: number, v: number, basePeriod: number, octaves: number, seed = 0, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += tileNoise2(u * period, v * period, period, seed + o * 17) * amp;
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return sum / norm;
}

export function fbm2(x: number, y: number, octaves: number, seed = 0, gain = 0.5, lac = 2): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(x * f, y * f, seed + o * 31) * amp;
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz, seed), c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed), c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed), c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed), c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w);
}

/** Tileable Voronoi (F1, F2, cell id hash) over a unit tile with `period` cells per side. */
export function tileVoronoi(u: number, v: number, period: number, seed = 0): [number, number, number] {
  const x = u * period, y = v * period;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 7);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 13); }
      else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
