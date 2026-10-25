import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { tileFbm, tileNoise2 } from '../util/noise';

let tex: DataTexture | null = null;

/**
 * One small tileable noise texture shared by the terrain and ground shaders, replacing
 * per-pixel hash noise (a single fetch instead of dozens of ALU-heavy hashes).
 * R: broad fBm · G: medium fBm · B: fine value noise · A: second broad fBm (decorrelated)
 */
export function getNoiseTexture(): DataTexture {
  if (tex) return tex;
  const S = 256;
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const k = (y * S + x) * 4;
      d[k] = Math.round(tileFbm(u, v, 4, 5, 701) * 255);
      d[k + 1] = Math.round(tileFbm(u, v, 12, 4, 702) * 255);
      d[k + 2] = Math.round(tileNoise2(u * 48, v * 48, 48, 703) * 255);
      d[k + 3] = Math.round(tileFbm(u, v, 3, 5, 704) * 255);
    }
  }
  tex = new DataTexture(d, S, S, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
