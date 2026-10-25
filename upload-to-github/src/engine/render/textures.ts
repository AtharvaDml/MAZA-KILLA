import { CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearMipmapLinearFilter, ClampToEdgeWrapping } from 'three';
import { mulberry32 } from '../util/noise';

/** Hand-laid fort masonry: irregular coursed stone blocks with mortar, tileable both ways. */
export function createMasonryTextures(): { map: CanvasTexture; normal: CanvasTexture } {
  const S = 1024;
  const rng = mulberry32(4242);
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const hgt = document.createElement('canvas');
  hgt.width = hgt.height = S;
  const c = col.getContext('2d')!;
  const h = hgt.getContext('2d')!;
  c.fillStyle = '#5a4f46';
  c.fillRect(0, 0, S, S);
  h.fillStyle = '#1a1a1a';
  h.fillRect(0, 0, S, S);

  // Course heights summing exactly to S so rows tile vertically.
  const rows: number[] = [];
  let total = 0;
  while (total < S) { const rh = 60 + rng() * 64; rows.push(rh); total += rh; }
  const k = S / total;
  let y = 0;
  for (const r0 of rows) {
    const rh = r0 * k;
    let x = -rng() * 140;
    while (x < S) {
      const w = 95 + rng() * 165;
      const hue = 22 + rng() * 14, sat = 10 + rng() * 18, lit = 40 + rng() * 22;
      const fill = `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${lit.toFixed(1)}%)`;
      const hv = Math.round(170 + rng() * 70);
      const jit = Array.from({ length: 8 }, () => (rng() - 0.5) * 9);
      for (const ox of [-S, 0, S]) {
        stonePath(c, x + ox, y, w, rh, jit);
        c.fillStyle = fill;
        c.fill();
        // Subtle top-left light / bottom-right shade for a chiselled feel
        const g = c.createLinearGradient(x + ox, y, x + ox + w, y + rh);
        g.addColorStop(0, 'rgba(255,240,220,0.10)');
        g.addColorStop(1, 'rgba(0,0,0,0.16)');
        c.fillStyle = g;
        c.fill();
        stonePath(h, x + ox, y, w, rh, jit);
        h.fillStyle = `rgb(${hv},${hv},${hv})`;
        h.fill();
      }
      x += w;
    }
    y += rh;
  }

  // Grain + derive normals from blurred height.
  const blurred = document.createElement('canvas');
  blurred.width = blurred.height = S;
  const b = blurred.getContext('2d')!;
  b.filter = 'blur(3px)';
  b.drawImage(hgt, 0, 0);
  const hd = b.getImageData(0, 0, S, S).data;
  const img = c.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const n = (rng() - 0.5) * 22 + (Math.sin(i * 0.013) * 0.5) * 3;
    d[i * 4] = clamp255(d[i * 4] + n);
    d[i * 4 + 1] = clamp255(d[i * 4 + 1] + n);
    d[i * 4 + 2] = clamp255(d[i * 4 + 2] + n * 0.9);
  }
  c.putImageData(img, 0, 0);

  const nc = document.createElement('canvas');
  nc.width = nc.height = S;
  const nctx = nc.getContext('2d')!;
  const nimg = nctx.createImageData(S, S);
  const H = (x: number, y2: number) => hd[(((y2 + S) % S) * S + ((x + S) % S)) * 4] / 255 + (rng() - 0.5) * 0.015;
  const strength = 3.2;
  for (let yy = 0; yy < S; yy++) {
    for (let xx = 0; xx < S; xx++) {
      const dx = (H(xx + 1, yy) - H(xx - 1, yy)) * strength;
      const dy = (H(xx, yy + 1) - H(xx, yy - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (yy * S + xx) * 4;
      nimg.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const map = new CanvasTexture(col);
  map.colorSpace = SRGBColorSpace;
  const normal = new CanvasTexture(nc);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    t.minFilter = LinearMipmapLinearFilter;
  }
  return { map, normal };
}

function stonePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, j: number[]) {
  const g = 4.5;
  const r = Math.min(14, h * 0.25);
  const x0 = x + g + j[0], y0 = y + g + j[1], x1 = x + w - g + j[2], y1 = y + h - g + j[3];
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0 + j[4] * 0.3);
  ctx.lineTo(x1 - r, y0 + j[5] * 0.3);
  ctx.quadraticCurveTo(x1, y0, x1 + j[6] * 0.2, y0 + r);
  ctx.lineTo(x1, y1 - r);
  ctx.quadraticCurveTo(x1, y1, x1 - r, y1 + j[7] * 0.2);
  ctx.lineTo(x0 + r, y1);
  ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
  ctx.lineTo(x0 + j[4] * 0.2, y0 + r);
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0 + j[4] * 0.3);
  ctx.closePath();
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Rangoli powder patterns drawn on canvas. */
export function createRangoliTexture(kind: 'lotus' | 'star'): CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.translate(S / 2, S / 2);
  const rng = mulberry32(kind === 'lotus' ? 11 : 23);
  const ring = (r: number, n: number, rad: number, color: string) => {
    c.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      c.beginPath();
      c.arc(Math.cos(a) * r, Math.sin(a) * r, rad, 0, Math.PI * 2);
      c.fill();
    }
  };
  const petals = (n: number, r0: number, r1: number, wid: number, fill: string, stroke: string, rot = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      c.save();
      c.rotate(a);
      c.beginPath();
      c.moveTo(r0, 0);
      c.quadraticCurveTo((r0 + r1) / 2, -wid, r1, 0);
      c.quadraticCurveTo((r0 + r1) / 2, wid, r0, 0);
      c.fillStyle = fill;
      c.fill();
      c.lineWidth = 7;
      c.strokeStyle = stroke;
      c.stroke();
      c.restore();
    }
  };
  if (kind === 'lotus') {
    c.beginPath(); c.arc(0, 0, 236, 0, Math.PI * 2); c.fillStyle = '#c2185b'; c.fill();
    c.beginPath(); c.arc(0, 0, 212, 0, Math.PI * 2); c.fillStyle = '#fbc02d'; c.fill();
    petals(16, 60, 205, 34, '#e65100', '#fff3e0', Math.PI / 16);
    petals(8, 50, 160, 46, '#ad1457', '#ffffff');
    c.beginPath(); c.arc(0, 0, 62, 0, Math.PI * 2); c.fillStyle = '#2e7d32'; c.fill();
    c.beginPath(); c.arc(0, 0, 38, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.arc(0, 0, 20, 0, Math.PI * 2); c.fillStyle = '#e65100'; c.fill();
    ring(224, 48, 6, '#ffffff');
  } else {
    c.beginPath(); c.arc(0, 0, 236, 0, Math.PI * 2); c.fillStyle = '#1565c0'; c.fill();
    c.beginPath(); c.arc(0, 0, 222, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.arc(0, 0, 214, 0, Math.PI * 2); c.fillStyle = '#ffeb3b'; c.fill();
    for (const [rot, col] of [[0, '#d32f2f'], [Math.PI / 4, '#ff6f00']] as const) {
      c.save(); c.rotate(rot); c.fillStyle = col; c.fillRect(-140, -140, 280, 280); c.restore();
    }
    for (const [rot, col] of [[0, '#ffffff'], [Math.PI / 4, '#ffffff']] as const) {
      c.save(); c.rotate(rot); c.strokeStyle = col; c.lineWidth = 6; c.strokeRect(-140, -140, 280, 280); c.restore();
    }
    petals(8, 30, 120, 30, '#7b1fa2', '#ffffff', Math.PI / 8);
    c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.fillStyle = '#2e7d32'; c.fill();
    c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fillStyle = '#ffeb3b'; c.fill();
    ring(196, 36, 7, '#c62828');
    ring(226, 60, 4, '#1565c0');
  }
  // Powder grain: break alpha + brightness slightly so it reads as coloured powder, not ink.
  c.setTransform(1, 0, 0, 1, 0, 0);
  const img = c.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const a = img.data[i * 4 + 3];
    if (!a) continue;
    const n = (rng() - 0.5) * 40;
    img.data[i * 4] = clamp255(img.data[i * 4] + n);
    img.data[i * 4 + 1] = clamp255(img.data[i * 4 + 1] + n);
    img.data[i * 4 + 2] = clamp255(img.data[i * 4 + 2] + n);
    const x = (i % S) - S / 2, yy = Math.floor(i / S) - S / 2;
    const edge = Math.hypot(x, yy) > 228 ? rng() : 1;
    img.data[i * 4 + 3] = edge > 0.45 ? a : 0;
  }
  c.putImageData(img, 0, 0);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/** Soft radial gradient used by additive halos. */
export function createGlowSpriteTexture(): CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  return new CanvasTexture(cv);
}
