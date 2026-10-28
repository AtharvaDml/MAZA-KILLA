export type WaterKind = 'pond' | 'lake' | 'tank' | 'moat' | 'river' | 'stream' | 'waterfall';
export type WaterMode = 'area' | 'flow';

export interface WaterData {
  id: string;
  kind: WaterKind;
  mode: WaterMode;
  points: [number, number][];
  closed: boolean;
  /** Area water: absolute surface height (null = auto from the shoreline ground). */
  level: number | null;
  depth: number;
  /** Flowing water channel width. */
  width: number;
  /** Shore softness (world units of slope from bed to bank). */
  shore: number;
  /** Flow speed multiplier (0 = still, e.g. a moat). */
  flow: number;
  color: number;
  clarity: number;
  reflect: number;
  /** Dry crossings along flowing water, centred at arc length t. */
  openings: { t: number; width: number }[];
}

export interface WaterPreset {
  label: string;
  hint: string;
  mode: WaterMode;
  closed: boolean;
  depth: number;
  width: number;
  shore: number;
  flow: number;
  color: number;
}

export const WATER_PRESETS: Record<WaterKind, WaterPreset> = {
  pond: { label: 'Pond', hint: 'Click around an area and close the shape', mode: 'area', closed: true, depth: 1.6, width: 0, shore: 3, flow: 0.2, color: 1 },
  lake: { label: 'Lake', hint: 'A big, deeper body of still water', mode: 'area', closed: true, depth: 3.2, width: 0, shore: 6, flow: 0.15, color: 3 },
  tank: { label: 'Water Tank', hint: 'A stepped stone kund with a low kerb', mode: 'area', closed: true, depth: 2.2, width: 0, shore: 0.8, flow: 0.1, color: 4 },
  moat: { label: 'Moat', hint: 'Draw a path around the walls — close it to ring the fort', mode: 'flow', closed: false, depth: 2, width: 6, shore: 1.6, flow: 0, color: 3 },
  river: { label: 'River', hint: 'Draw from the source downhill; steep drops become falls', mode: 'flow', closed: false, depth: 1.6, width: 7, shore: 3, flow: 1, color: 0 },
  stream: { label: 'Stream', hint: 'A narrow, quick stream — draw it downhill', mode: 'flow', closed: false, depth: 0.8, width: 2.6, shore: 1.6, flow: 1.4, color: 0 },
  waterfall: { label: 'Waterfall', hint: 'Draw from the clifftop down past the drop', mode: 'flow', closed: false, depth: 1, width: 3.4, shore: 1.4, flow: 1.8, color: 0 },
};

/** Shallow / deep colour pairs (sRGB hex). */
export const WATER_COLORS: { name: string; shallow: number; deep: number }[] = [
  { name: 'Clear blue', shallow: 0x6fb7c4, deep: 0x1d4f6b },
  { name: 'Monsoon green', shallow: 0x7aa58a, deep: 0x23463a },
  { name: 'Earthy brown', shallow: 0xa08b62, deep: 0x4a3b24 },
  { name: 'Deep teal', shallow: 0x5aa3a0, deep: 0x123c45 },
  { name: 'Turquoise', shallow: 0x7fd0c8, deep: 0x1f6f78 },
];

export function cloneWater(d: WaterData): WaterData {
  return { ...d, points: d.points.map(([x, z]) => [x, z] as [number, number]), openings: d.openings.map((o) => ({ ...o })) };
}
