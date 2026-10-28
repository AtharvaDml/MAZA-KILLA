import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type CategoryId =
  | 'terrain' | 'walls' | 'fort' | 'buildings' | 'nature' | 'water' | 'people' | 'decor' | 'diwali';
export type ToolId = 'select' | 'sculpt' | 'paint' | 'place' | 'wall' | 'water';
export type WaterKind = 'pond' | 'lake' | 'tank' | 'moat' | 'river' | 'stream' | 'waterfall';
export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'slope' | 'roughen' | 'erode';
export type TimePreset = 'morning' | 'afternoon' | 'golden' | 'sunset' | 'night';
export type Quality = 'low' | 'medium' | 'high';
export type TransformMode = 'move' | 'rotate' | 'scale';
export type Battlement = 'kangoore' | 'square' | 'none';
export type StoneStyle = 'laterite' | 'basalt' | 'weathered';
export type CameraPreset = 'top' | 'iso' | 'ground' | 'cinematic';
export type PlotSizeId = 'small' | 'medium' | 'large';

export interface SelRef { kind: 'object' | 'wall' | 'water'; id: string }

export interface InspectorObject {
  kind: 'object';
  count: number;
  name: string;
  info?: string;
  scale: number;
  rotY: number; // degrees
  lift: number; // height above surface
  variant: number;
  variants: { name: string; css: string }[];
  emitter: boolean;
}
export interface InspectorWall {
  kind: 'wall';
  id: string;
  height: number;
  thickness: number;
  battlement: Battlement;
  stone: StoneStyle;
  smooth: boolean;
  closed: boolean;
  flip: boolean;
  length: number;
  points: number;
  handle: number | null;
}
export interface InspectorWater {
  kind: 'water';
  id: string;
  waterKind: WaterKind;
  mode: 'area' | 'flow';
  level: number;
  levelAuto: boolean;
  depth: number;
  width: number;
  shore: number;
  flow: number;
  color: number;
  clarity: number;
  reflect: number;
  length: number;
  falls: number;
  points: number;
  closed: boolean;
  crossings: number;
}
export type Inspector = InspectorObject | InspectorWall | InspectorWater | null;

export interface Toast { id: number; text: string; tone: 'info' | 'warn' | 'ok' }
export interface RadialState { x: number; y: number; kind: 'terrain' | 'object' | 'wall' | 'water' }

export interface KillaListing {
  id: string;
  name: string;
  size: PlotSizeId;
  location: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  objectCount: number;
}

export interface EditorState {
  ready: boolean;
  loading: string;
  loadingProgress: number;

  category: CategoryId | null;
  tool: ToolId;
  terrainTab: 'sculpt' | 'paint';

  sculpt: { mode: SculptMode; size: number; strength: number; falloff: number };
  paint: { layer: number; size: number; strength: number; falloff: number; autoCliff: boolean };
  place: {
    assetId: string | null;
    scatter: boolean;
    density: number;
    brush: number;
    randomRotate: boolean;
    randomScale: boolean;
    strict: boolean;
    gridSnap: boolean;
    gridSize: number;
  };
  wall: { height: number; thickness: number; battlement: Battlement; stone: StoneStyle; smooth: boolean; drawing: boolean; points: number };
  water: { kind: WaterKind; depth: number; width: number; shore: number; flow: number; color: number; clarity: number; reflect: number; carve: boolean; drawing: boolean; points: number };
  transformMode: TransformMode;

  selection: SelRef[];
  inspector: Inspector;

  time: TimePreset;
  quality: Quality;
  showInfo: boolean;

  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;

  saveState: 'saved' | 'dirty' | 'saving' | 'error';
  lastSavedAt: number;
  killa: { id: string; name: string; size: PlotSizeId };
  library: KillaListing[];

  objectCount: number;
  radial: RadialState | null;
  toasts: Toast[];
  libraryOpen: boolean;
  helpOpen: boolean;
  newOpen: boolean;

  thumbs: Record<string, string>;
  swatches: string[];
  fps: number;
}

export const editorStore = createStore<EditorState>()(() => ({
  ready: false,
  loading: 'Preparing the soil…',
  loadingProgress: 0,

  category: null,
  tool: 'select',
  terrainTab: 'sculpt',

  sculpt: { mode: 'raise', size: 12, strength: 0.5, falloff: 0.7 },
  paint: { layer: 3, size: 8, strength: 0.6, falloff: 0.6, autoCliff: true },
  place: {
    assetId: null,
    scatter: false,
    density: 0.5,
    brush: 6,
    randomRotate: true,
    randomScale: true,
    strict: false,
    gridSnap: false,
    gridSize: 2,
  },
  wall: { height: 7, thickness: 3, battlement: 'kangoore', stone: 'laterite', smooth: true, drawing: false, points: 0 },
  water: { kind: 'pond', depth: 1.6, width: 0, shore: 3, flow: 0.2, color: 1, clarity: 0.55, reflect: 0.8, carve: true, drawing: false, points: 0 },
  transformMode: 'move',

  selection: [],
  inspector: null,

  time: 'afternoon',
  quality: 'high',
  showInfo: true,

  canUndo: false,
  canRedo: false,
  undoLabel: '',
  redoLabel: '',

  saveState: 'saved',
  lastSavedAt: 0,
  killa: { id: '', name: 'My Killa', size: 'medium' },
  library: [],

  objectCount: 0,
  radial: null,
  toasts: [],
  libraryOpen: false,
  helpOpen: false,
  newOpen: false,

  thumbs: {},
  swatches: [],
  fps: 60,
}));

export const getEditor = editorStore.getState;
export const setEditor = editorStore.setState;
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector);
}

let toastSeq = 1;
export function toast(text: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const id = toastSeq++;
  setEditor((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  window.setTimeout(() => setEditor((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/** Subscribe to a derived slice; fires only when the slice changes (shallow for objects). */
export function watch<T>(selector: (s: EditorState) => T, fn: (value: T, prev: T) => void) {
  let prev = selector(editorStore.getState());
  return editorStore.subscribe((state) => {
    const next = selector(state);
    if (!shallowEqual(next, prev)) {
      const p = prev;
      prev = next;
      fn(next, p);
    }
  });
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
