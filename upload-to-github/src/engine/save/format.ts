import type { PlotSizeId, TimePreset } from '../../state/store';
import type { ObjectData } from '../objects/ObjectSystem';
import type { WallData } from '../walls/wallGeometry';
import type { CameraState } from '../CameraRig';
import type { WaterData } from '../water/waterData';

export const FORMAT = 'majha-killa';
/** v2 adds optional `water`. v1 files load unchanged. */
export const VERSION = 2;
const MAGIC = [0x4b, 0x49, 0x4c, 0x41]; // 'KILA'

export interface KillaMeta {
  id: string;
  name: string;
  size: PlotSizeId;
  location: string;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

export interface KillaHeader {
  format: typeof FORMAT;
  version: number;
  meta: KillaMeta;
  terrain: { res: number; size: number; hMin: number; hMax: number; splatRes: number; sections: Record<string, [number, number]> };
  walls: WallData[];
  water?: WaterData[];
  objects: ObjectData[];
  env: { time: TimePreset };
  camera?: CameraState;
}

export interface KillaPayload {
  header: Omit<KillaHeader, 'terrain'> & { terrain: Omit<KillaHeader['terrain'], 'sections'> };
  heights: Uint16Array;
  splat: Uint8Array[];
}

/**
 * Binary container → gzip. Only procedural data is stored (heightmap, splat weights, wall splines,
 * object transforms, settings) so files stay small enough to share.
 */
export async function encodeKilla(p: KillaPayload): Promise<Blob> {
  const bins: [string, Uint8Array][] = [
    ['heights', new Uint8Array(p.heights.buffer, p.heights.byteOffset, p.heights.byteLength)],
    ...p.splat.map((s, i) => [`splat${i}`, s] as [string, Uint8Array]),
  ];
  const sections: Record<string, [number, number]> = {};
  let off = 0;
  for (const [name, b] of bins) {
    sections[name] = [off, b.byteLength];
    off += align4(b.byteLength);
  }
  const header: KillaHeader = { ...p.header, terrain: { ...p.header.terrain, sections } } as KillaHeader;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headLen = 8 + align4(json.byteLength);
  const buf = new Uint8Array(headLen + off);
  buf.set(MAGIC, 0);
  new DataView(buf.buffer).setUint32(4, json.byteLength, true);
  buf.set(json, 8);
  for (const [name, b] of bins) buf.set(b, headLen + sections[name][0]);
  return gzip(buf);
}

export async function decodeKilla(blob: Blob): Promise<KillaPayload> {
  const raw = await gunzip(blob);
  if (raw[0] !== MAGIC[0] || raw[1] !== MAGIC[1] || raw[2] !== MAGIC[2] || raw[3] !== MAGIC[3]) throw new Error('Not a Majha Killa file');
  const jsonLen = new DataView(raw.buffer, raw.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + jsonLen))) as KillaHeader;
  if (header.format !== FORMAT) throw new Error('Unknown format');
  if (header.version > VERSION) throw new Error('This Killa was made with a newer version');
  const headLen = 8 + align4(jsonLen);
  const sec = (name: string) => {
    const [o, l] = header.terrain.sections[name];
    return raw.slice(headLen + o, headLen + o + l);
  };
  const hb = sec('heights');
  const heights = new Uint16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2);
  const splat = [0, 1, 2].map((i) => sec(`splat${i}`));
  const { sections: _s, ...terrain } = header.terrain;
  return { header: { ...header, terrain }, heights, splat };
}

const align4 = (n: number) => (n + 3) & ~3;

async function gzip(data: Uint8Array): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([data]);
  const cs = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(cs).blob();
}

async function gunzip(blob: Blob): Promise<Uint8Array> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const ds = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return new Uint8Array(await blob.arrayBuffer());
}
