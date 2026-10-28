import {
  ACESFilmicToneMapping, Clock, NoToneMapping, PCFSoftShadowMap, Ray, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import {
  editorStore, getEditor, setEditor, toast, watch,
  type CameraPreset, type InspectorObject, type InspectorWall, type InspectorWater, type KillaListing, type PlotSizeId, type Quality,
  type SelRef, type TimePreset, type ToolId, type CategoryId,
} from '../state/store';
import { CameraRig } from './CameraRig';
import { InputRouter } from './InputRouter';
import { Environment } from './env/Environment';
import { CompositeCommand, History, type Command } from './history/History';
import { Lighting } from './lighting/Lighting';
import { buildCatalog, getAsset } from './objects/catalog';
import { ObjectSystem, cloneData, type ObjectData } from './objects/ObjectSystem';
import { createMaterials, type MaterialSet } from './render/materials';
import { Post } from './render/Post';
import { shared } from './render/shared';
import { renderAssetThumbnails } from './render/Thumbnails';
import { decodeKilla, encodeKilla, FORMAT, VERSION, type KillaMeta } from './save/format';
import { LocalRepository, lastOpened } from './save/repository';
import { generateTerrainLayers, type TerrainLayerSet } from './terrain/layers';
import { PLOT_SIZES, Terrain, type GridRect } from './terrain/Terrain';
import { Overlay } from './tools/Overlay';
import { PaintTool } from './tools/PaintTool';
import { PlaceTool } from './tools/PlaceTool';
import { SculptTool } from './tools/SculptTool';
import { SelectTool } from './tools/SelectTool';
import type { PointerInfo, Tool } from './tools/Tool';
import { WallTool } from './tools/WallTool';
import { WaterTool } from './tools/WaterTool';
import { WaterSystem } from './water/WaterSystem';
import { createWaterMaterial } from './water/WaterMaterial';
import { cloneWater, type WaterData } from './water/waterData';
import { uid } from './util/id';
import { DEG, clamp } from './util/math';
import { WallSystem, cloneWall, type WallData } from './walls/WallSystem';

export interface SurfaceHit { point: Vector3; normal: Vector3; wallId?: string; objectId?: string; distance: number }

const QUALITY: Record<Quality, { pixelRatio: number; shadow: number; msaa: number; post: boolean }> = {
  low: { pixelRatio: 1, shadow: 1024, msaa: 0, post: false },
  medium: { pixelRatio: 1, shadow: 2048, msaa: 0, post: true },
  high: { pixelRatio: 1.5, shadow: 4096, msaa: 4, post: true },
};
const SOFT_LIMIT = 4000;
const AUTOSAVE_QUIET_MS = 1200;

/** Things that stand on walls by default (others stay on the ground). */
const WALL_FRIENDLY = new Set(['flag_saffron', 'cannon', 'cannonballs', 'torch', 'diya', 'akash_kandil', 'mavla', 'villager_man', 'villager_woman', 'horse', 'rock_small', 'grass', 'flowers', 'rangoli_lotus', 'rangoli_star']);

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly history = new History();
  readonly repo = new LocalRepository();
  materials!: MaterialSet;
  layers!: TerrainLayerSet;
  terrain!: Terrain;
  objects!: ObjectSystem;
  walls!: WallSystem;
  water!: WaterSystem;
  env!: Environment;
  lighting!: Lighting;
  overlay!: Overlay;
  input!: InputRouter;
  tool!: Tool;
  private tools!: Record<ToolId, Tool>;
  private post: Post | null = null;
  private readonly clock = new Clock();
  private running = false;
  private lastObjVersion = -1;
  private lastWallVersion = -1;
  private lastEmitterVersion = -1;
  private shadowsDirty = true;
  private frames = 0;
  private fpsAt = 0;
  meta: KillaMeta = this.freshMeta('My First Killa', 'medium');
  private saveTimer = 0;
  private saving: Promise<void> | null = null;
  private saveQueued = false;
  private dirty = false;
  private loadingDoc = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.outline = 'none';
    this.renderer.domElement.className = 'killa-canvas';
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(1);
    this.scene.add(this.rig.camera);
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async init() {
    const progress = (p: number, text?: string) => setEditor({ loadingProgress: p, ...(text ? { loading: text } : {}) });
    progress(0.02, 'Preparing the soil…');
    this.layers = await generateTerrainLayers((p) => progress(0.05 + p * 0.5));
    progress(0.58, 'Shaping stones and figurines…');
    await tick();
    this.materials = createMaterials();
    buildCatalog();
    progress(0.72, 'Laying out the land…');
    await tick();

    const q = this.loadQuality();
    this.terrain = new Terrain('medium', this.layers.texture, this.layers.avg);
    this.scene.add(this.terrain.mesh);
    this.env = new Environment(this.layers.texture, this.layers.avg, this.materials, this.terrain.half);
    this.scene.add(this.env.group);
    this.lighting = new Lighting(this.scene, this.env, getEditor().time);
    this.scene.add(this.lighting.group);
    this.lighting.setPlot(this.terrain.half);
    this.objects = new ObjectSystem(this.materials);
    this.scene.add(this.objects.group);
    this.walls = new WallSystem(this.materials, (x, z) => this.terrain.heightAt(x, z));
    this.scene.add(this.walls.group);
    this.water = new WaterSystem(this.terrain, this.env.skyUniforms);
    this.scene.add(this.water.group);
    this.materials.register('water_small', createWaterMaterial(this.water.env, { shallow: 0x6fb7c4, deep: 0x1d4f6b, clarity: 0.4, reflect: 0.9, fixedDepth: 0.9 }));
    this.overlay = new Overlay(this.materials);
    this.scene.add(this.overlay.group);
    this.rig.heightAt = (x, z) => this.terrain.heightAt(x, z);
    this.rig.setBounds(this.terrain.half);

    this.tools = {
      select: new SelectTool(this),
      sculpt: new SculptTool(this),
      paint: new PaintTool(this),
      place: new PlaceTool(this),
      wall: new WallTool(this),
      water: new WaterTool(this),
    };
    this.tool = this.tools.select;
    this.input = new InputRouter(this, this.renderer.domElement);
    this.applyQuality(q);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.container);
    setEditor({ swatches: this.layers.swatches, quality: q });

    this.history.onChange = () => this.onHistoryChange();
    this.bindStore();

    progress(0.82, 'Opening your Killa…');
    await this.refreshLibrary();
    const last = lastOpened.get();
    const lib = getEditor().library;
    const target = (last && lib.find((l) => l.id === last)) || lib[0];
    if (target) {
      try { await this.openKilla(target.id, true); } catch (err) { console.error(err); await this.newKilla('My First Killa', 'medium', true); }
    } else {
      await this.newKilla('My First Killa', 'medium', true);
    }

    // Warm all shaders behind the loading screen, then start.
    this.objects.warm();
    this.renderer.compile(this.scene, this.rig.camera);
    progress(1, 'Ready');
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.frame);
    setEditor({ ready: true });

    // Build-menu thumbnails in the background.
    renderAssetThumbnails(buildCatalog(), this.materials).then((thumbs) => setEditor({ thumbs }));

    setInterval(() => { if (this.dirty) this.scheduleSave(0); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && this.dirty) void this.saveNow(false); });
    window.addEventListener('beforeunload', () => { if (this.dirty) void this.saveNow(false); });
  }

  private bindStore() {
    watch((s) => s.tool, (t) => this.setTool(t));
    watch((s) => s.time, (t) => this.lighting.setPreset(t));
    watch((s) => s.paint.autoCliff, (v) => { this.terrain.autoCliff = v; this.shadowsDirty = true; });
    watch((s) => [s.place.gridSnap, s.place.gridSize, s.tool] as const, () => {
      const s = getEditor();
      this.terrain.material.userData.k.uGrid.value = s.place.gridSnap && (s.tool === 'place' || s.tool === 'select') ? s.place.gridSize : 0;
    });
    watch((s) => s.transformMode, () => this.refreshSelectionVisuals());
  }

  private freshMeta(name: string, size: PlotSizeId): KillaMeta {
    const now = Date.now();
    return { id: uid(), name, size, location: 'Open Ground', createdAt: now, updatedAt: now };
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.rig.resize(w / h);
    this.water?.setViewportHeight(h * this.renderer.getPixelRatio());
    this.post?.setSize(w, h);
  }

  private frame = () => {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    shared.uTime.value += dt;
    this.rig.update(dt);
    this.tool.update(dt);
    this.lighting.update(dt);

    if (this.terrain.flush()) this.shadowsDirty = true;
    if (this.objects.emitterVersion !== this.lastEmitterVersion) {
      this.lastEmitterVersion = this.objects.emitterVersion;
      this.terrain.setEmitters(this.objects.emitters());
      this.lighting.setLampClusters(this.objects.emitterPoints());
    }
    if (this.objects.version !== this.lastObjVersion || this.walls.version !== this.lastWallVersion) {
      this.lastObjVersion = this.objects.version;
      this.lastWallVersion = this.walls.version;
      this.shadowsDirty = true;
      const n = this.objects.count;
      if (n !== getEditor().objectCount) setEditor({ objectCount: n });
    }
    if (this.lighting.sunMoved) { this.shadowsDirty = true; this.lighting.sunMoved = false; }
    if (this.shadowsDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    this.env.update(this.rig.camera, shared.uTime.value);

    this.renderNow(dt);

    this.frames++;
    const now = performance.now();
    if (now - this.fpsAt > 1000) {
      setEditor({ fps: Math.round((this.frames * 1000) / (now - this.fpsAt)) });
      this.frames = 0;
      this.fpsAt = now;
    }
  };

  private captureCanvas(w: number, h: number, type = 'image/jpeg', q = 0.82): string {
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const sa = src.width / src.height, da = w / h;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sa > da) { sw = sh * da; sx = (src.width - sw) / 2; } else { sh = sw / da; sy = (src.height - sh) / 2; }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return c.toDataURL(type, q);
  }

  /** Hide editor overlays, wait for the next rendered frame, run `fn` while the drawing buffer is valid. */
  private captureNextFrame<T>(fn: () => T): Promise<T | null> {
    // Render synchronously and read the drawing buffer in the same task. Waiting for the next
    // animation frame would never resolve in a hidden tab (and would stall autosave).
    if (!this.running) return Promise.resolve(null);
    const k = this.terrain.material.userData.k;
    const prev = { ov: this.overlay.group.visible, brush: k.uBrushOn.value, bounds: k.uShowBounds.value };
    this.overlay.group.visible = false;
    k.uBrushOn.value = 0;
    k.uShowBounds.value = 0;
    try {
      this.renderNow(0);
      return Promise.resolve(fn());
    } catch (err) {
      console.warn('capture failed', err);
      return Promise.resolve(null);
    } finally {
      this.overlay.group.visible = prev.ov;
      k.uBrushOn.value = prev.brush;
      k.uShowBounds.value = prev.bounds;
    }
  }

  private renderNow(dt: number) {
    if (this.post) {
      // Bloom only when lamps actually glow (golden hour → night).
      this.post.setBloomActive(shared.uNight.value > 0.02);
      this.post.bloom.intensity = 0.25 + this.lighting.bloom * 0.9;
      this.post.render(dt);
    } else {
      this.renderer.render(this.scene, this.rig.camera);
    }
  }

  // ───────────────────────────── quality ─────────────────────────────

  private loadQuality(): Quality {
    try {
      const q = localStorage.getItem('mk:quality') as Quality | null;
      if (q && q in QUALITY) return q;
    } catch { /* ignore */ }
    return this.detectQuality();
  }

  /** First-run default from the GPU class (full AUTO tuning from frame times lands in Phase 6). */
  private detectQuality(): Quality {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (/nvidia|geforce|rtx|quadro|radeon rx|radeon pro|arc a\d/i.test(name)) return 'high';
      if (/swiftshader|llvmpipe|software/i.test(name)) return 'low';
      return 'medium';
    } catch {
      return 'medium';
    }
  }

  /** `persist` only for an explicit user choice, so detected defaults can keep improving. */
  applyQuality(q: Quality, persist = false) {
    const cfg = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    this.lighting.setShadowSize(cfg.shadow);
    this.post?.dispose();
    this.post = null;
    if (cfg.post) {
      this.renderer.toneMapping = NoToneMapping;
      this.post = new Post(this.renderer, this.scene, this.rig.camera, cfg.msaa);
    } else {
      this.renderer.toneMapping = ACESFilmicToneMapping;
    }
    this.resize();
    this.shadowsDirty = true;
    if (persist) { try { localStorage.setItem('mk:quality', q); } catch { /* ignore */ } }
    setEditor({ quality: q });
  }

  // ───────────────────────────── tools ─────────────────────────────

  setTool(id: ToolId) {
    const next = this.tools[id];
    if (!next || next === this.tool) return;
    this.tool.deactivate();
    this.tool = next;
    this.tool.activate();
    this.renderer.domElement.style.cursor = this.tool.cursor;
    if (getEditor().tool !== id) setEditor({ tool: id });
  }

  /** Category buttons on the toolbar map to tools here. */
  selectCategory(cat: CategoryId | null) {
    const s = getEditor();
    if (cat === null || cat === s.category) {
      setEditor({ category: null, tool: 'select' });
      return;
    }
    let tool: ToolId = 'select';
    if (cat === 'terrain') tool = s.terrainTab === 'paint' ? 'paint' : 'sculpt';
    else if (cat === 'walls') tool = 'wall';
    else if (cat === 'water') tool = s.place.assetId && categoryOf(s.place.assetId, 'water') ? 'place' : 'water';
    else tool = s.place.assetId && getAsset(s.place.assetId) && categoryOf(s.place.assetId, cat) ? 'place' : 'select';
    setEditor({ category: cat, tool });
  }

  setCursor(c: string) {
    this.renderer.domElement.style.cursor = c;
  }

  // ───────────────────────────── queries ─────────────────────────────

  /** Nearest walkable surface under a ray: wall tops (walkway / parapet) or terrain. */
  surfaceHit(ray: Ray, opts: { excludeObjects?: Set<string>; excludeWalls?: Set<string>; walls?: boolean } = {}): SurfaceHit | null {
    const t = this.terrain.raycast(ray);
    let best: SurfaceHit | null = t ? { point: t, normal: this.terrain.normalAt(t.x, t.z), distance: t.distanceTo(ray.origin) } : null;
    if (opts.walls !== false) {
      const pf = this.objects.platformHit(ray, opts.excludeObjects);
      if (pf && (!best || pf.distance < best.distance)) best = { point: pf.point, normal: new Vector3(0, 1, 0), objectId: pf.id, distance: pf.distance };
    }
    if (opts.walls !== false) {
      const w = this.walls.pick(ray, opts.excludeWalls);
      if (w && (!best || w.distance < best.distance)) {
        const s = this.walls.surfaceAt(w.point.x, w.point.z, opts.excludeWalls);
        if (s && w.normal.y > 0.5) {
          best = { point: new Vector3(w.point.x, s.y, w.point.z), normal: new Vector3(0, 1, 0), wallId: s.wallId, distance: w.distance };
        } else if (w.normal.y > 0.5) {
          best = { point: w.point.clone(), normal: new Vector3(0, 1, 0), wallId: w.id, distance: w.distance };
        } else {
          // Hit a wall face: stand at its foot, on the camera side.
          const n = new Vector3(w.normal.x, 0, w.normal.z).normalize();
          const x = w.point.x + n.x * 0.8, z = w.point.z + n.z * 0.8;
          best = { point: new Vector3(x, this.terrain.heightAt(x, z), z), normal: this.terrain.normalAt(x, z), distance: w.distance };
        }
      }
    }
    return best;
  }

  surfaceHeight(x: number, z: number, excludeWalls?: Set<string>, allowWalls = true, excludeObjects?: Set<string>): { y: number; wallId?: string; objectId?: string } {
    const g = this.terrain.heightAt(x, z);
    if (!allowWalls) return { y: g };
    let best: { y: number; wallId?: string; objectId?: string } = { y: g };
    const w = this.walls.surfaceAt(x, z, excludeWalls);
    if (w && w.y > best.y) best = { y: w.y, wallId: w.wallId };
    const p = this.objects.platformAt(x, z, excludeObjects);
    if (p && p.y > best.y) best = { y: p.y, objectId: p.id };
    return best;
  }

  /** Everything standing on object `id` (platform riders), recursively. */
  ridersOf(id: string, out: ObjectData[] = []): ObjectData[] {
    for (const r of this.objects.attachedTo('o:' + id)) {
      if (out.some((o) => o.id === r.id)) continue;
      out.push(r);
      this.ridersOf(r.id, out);
    }
    return out;
  }

  /** Move an object vertically and carry its riders by the same amount. */
  private liftWithRiders(d: ObjectData, dy: number) {
    const n = cloneData(d);
    n.p[1] += dy;
    this.objects.update(n);
    for (const r of this.ridersOf(d.id)) { r.p[1] += dy; this.objects.update(r); }
  }

  /** Attachment string for a surface. */
  attachFor(s: { wallId?: string; objectId?: string }): string | undefined {
    return s.objectId ? 'o:' + s.objectId : s.wallId ? 'w:' + s.wallId : undefined;
  }

  wallFriendly(type: string) {
    return WALL_FRIENDLY.has(type);
  }

  pick(ray: Ray): (SelRef & { point: Vector3; distance: number }) | null {
    const o = this.objects.pick(ray);
    const w = this.walls.pick(ray);
    if (o && (!w || o.distance <= w.distance + 0.05)) return { kind: 'object', id: o.id, point: o.point, distance: o.distance };
    if (w) return { kind: 'wall', id: w.id, point: w.point, distance: w.distance };
    const wa = this.water.pick(ray);
    if (wa) return { kind: 'water', id: wa.id, point: wa.point, distance: wa.distance };
    return null;
  }

  /** Does the thing a selection points at still exist? */
  hasRef(r: SelRef) {
    return r.kind === 'object' ? this.objects.has(r.id) : r.kind === 'wall' ? this.walls.has(r.id) : this.water.has(r.id);
  }

  private highlightRef(r: SelRef, level: 'none' | 'hover' | 'selected') {
    if (r.kind === 'object') this.objects.setHighlight(r.id, level === 'selected' ? 1 : level === 'hover' ? 0.45 : 0);
    else if (r.kind === 'wall') this.walls.setHighlight(r.id, level);
    else this.water.setHighlight(r.id, level === 'selected' ? 1 : level === 'hover' ? 0.5 : 0);
  }

  // ───────────────────────────── commands ─────────────────────────────

  exec(cmd: Command) {
    cmd.redo();
    this.history.push(cmd);
  }

  cmdAddObjects(datas: ObjectData[], label = 'Place'): Command {
    const copies = datas.map(cloneData);
    return {
      label,
      bytes: copies.length * 160,
      redo: () => { copies.forEach((d) => this.objects.add(d)); },
      undo: () => { copies.forEach((d) => this.objects.remove(d.id)); this.pruneSelection(); },
    };
  }

  cmdRemoveObjects(datas: ObjectData[], label = 'Delete'): Command {
    const copies = datas.map(cloneData);
    return {
      label,
      bytes: copies.length * 160,
      redo: () => { copies.forEach((d) => this.objects.remove(d.id)); this.pruneSelection(); },
      undo: () => { copies.forEach((d) => this.objects.add(d)); },
    };
  }

  cmdUpdateObjects(before: ObjectData[], after: ObjectData[], label: string, coalesceKey?: string): Command {
    const cmd = {
      label,
      coalesceKey,
      bytes: before.length * 320,
      before: before.map(cloneData),
      after: after.map(cloneData),
      redo() { /* replaced below */ },
      undo() { /* replaced below */ },
      merge(next: Command) {
        const n = next as typeof cmd;
        if (!n.after || n.after.length !== this.after.length || n.after.some((d, i) => d.id !== this.after[i].id)) return false;
        this.after = n.after;
        return true;
      },
    };
    cmd.redo = () => { cmd.after.forEach((d) => this.objects.update(d)); this.refreshInspector(); };
    cmd.undo = () => { cmd.before.forEach((d) => this.objects.update(d)); this.refreshInspector(); };
    return cmd;
  }

  cmdAddWall(data: WallData, label = 'Build wall'): Command {
    const d = cloneWall(data);
    return {
      label,
      bytes: 512 + d.points.length * 16,
      redo: () => this.walls.add(d),
      undo: () => { this.walls.remove(d.id); this.pruneSelection(); },
    };
  }

  cmdRemoveWall(data: WallData, label = 'Delete wall'): Command {
    const d = cloneWall(data);
    return {
      label,
      bytes: 512 + d.points.length * 16,
      redo: () => { this.walls.remove(d.id); this.pruneSelection(); },
      undo: () => this.walls.add(d),
    };
  }

  /**
   * Snapshot a wall plus the objects standing on it, so an edit can carry them along.
   * Call before modifying; pass the token to `commitWallEdit` afterwards.
   */
  beginWallEdit(id: string, withAttached = true) {
    const before = this.walls.get(id)!;
    const attached = withAttached ? this.objects.attachedTo('w:' + id).map((o) => ({ o, surf: this.walls.surfaceAt(o.p[0], o.p[2])?.y })) : [];
    const riders = attached.flatMap(({ o }) => this.ridersOf(o.id).map((r) => ({ r, base: o.id })));
    return { id, before, attached, riders };
  }

  commitWallEdit(token: ReturnType<Engine['beginWallEdit']>, label: string, coalesceKey?: string, push = true): Command | null {
    const after = this.walls.get(token.id);
    if (!after) return null;
    const objBefore = [...token.attached.map((a) => cloneData(a.o)), ...token.riders.map((x) => cloneData(x.r))];
    const baseAfter = token.attached.map(({ o, surf }) => {
      const n = cloneData(o);
      const s = this.walls.surfaceAt(n.p[0], n.p[2]);
      if (s && s.wallId === token.id && surf !== undefined) n.p[1] += s.y - surf;
      else if (!s) {
        const lift = surf !== undefined ? n.p[1] - surf : 0;
        n.p[1] = this.terrain.heightAt(n.p[0], n.p[2]) + Math.max(0, lift);
        delete n.att;
      }
      return n;
    });
    const deltas = new Map(baseAfter.map((n, i) => [n.id, n.p[1] - token.attached[i].o.p[1]]));
    const riderAfter = token.riders.map(({ r, base }) => {
      const n = cloneData(r);
      n.p[1] += deltas.get(base) ?? 0;
      return n;
    });
    const objAfter = [...baseAfter, ...riderAfter];
    objAfter.forEach((d) => this.objects.update(d));
    const cmd = {
      label,
      coalesceKey,
      bytes: 1024 + after.points.length * 32 + objAfter.length * 320,
      before: cloneWall(token.before),
      after: cloneWall(after),
      objBefore,
      objAfter,
      redo() { /* set below */ },
      undo() { /* set below */ },
      merge(next: Command) {
        const n = next as typeof cmd;
        if (!n.after || n.after.id !== this.after.id) return false;
        this.after = n.after;
        const map = new Map(n.objAfter.map((o) => [o.id, o]));
        this.objAfter = this.objAfter.map((o) => map.get(o.id) ?? o);
        return true;
      },
    };
    cmd.redo = () => { this.walls.update(cmd.after); cmd.objAfter.forEach((d) => this.objects.update(d)); this.refreshSelectionVisuals(); };
    cmd.undo = () => { this.walls.update(cmd.before); cmd.objBefore.forEach((d) => this.objects.update(d)); this.refreshSelectionVisuals(); };
    if (push) this.history.push(cmd);
    return cmd;
  }

  cmdAddWater(data: WaterData, label = 'Add water'): Command {
    const d = cloneWater(data);
    return {
      label, bytes: 512 + d.points.length * 16,
      redo: () => this.water.add(d),
      undo: () => { this.water.remove(d.id); this.pruneSelection(); },
    };
  }

  cmdRemoveWater(data: WaterData, label = 'Remove water'): Command {
    const d = cloneWater(data);
    return {
      label, bytes: 512 + d.points.length * 16,
      redo: () => { this.water.remove(d.id); this.pruneSelection(); },
      undo: () => this.water.add(d),
    };
  }

  cmdUpdateWater(before: WaterData, after: WaterData, label: string, coalesceKey?: string): Command {
    const cmd = {
      label, coalesceKey, bytes: 1024,
      before: cloneWater(before), after: cloneWater(after),
      redo() { /* set below */ }, undo() { /* set below */ },
      merge(next: Command) {
        const n = next as typeof cmd;
        if (!n.after || n.after.id !== this.after.id) return false;
        this.after = n.after;
        return true;
      },
    };
    cmd.redo = () => { this.water.update(cmd.after); this.refreshInspector(); this.refreshSelectionVisuals(); };
    cmd.undo = () => { this.water.update(cmd.before); this.refreshInspector(); this.refreshSelectionVisuals(); };
    return cmd;
  }

  /**
   * Create a water body, optionally digging its bed into the terrain, as ONE undo step.
   * A water tank also gets a low stone kerb along its edge.
   */
  createWater(data: WaterData, carve: boolean): string | null {
    const cmds: Command[] = [];
    if (carve) {
      const plan = this.water.carvePlan(data);
      if (plan) {
        const old = this.terrain.heights.slice();
        const rect = this.terrain.carve(plan.bounds[0], plan.bounds[1], plan.bounds[2], plan.bounds[3], plan.target);
        if (rect) {
          this.followTerrain(rect, old);
          cmds.push(this.cmdHeights(rect, this.terrain.extractRect(old, rect), this.terrain.extractRect(this.terrain.heights, rect), 'Dig water bed'));
        }
      }
    }
    const add = this.cmdAddWater(data, `Add ${data.kind}`);
    add.redo();
    cmds.push(add);
    if (data.kind === 'tank') {
      const kerb: WallData = {
        id: uid(), points: data.points.map(([x, z]) => [x, z]), closed: true, smooth: true, height: 1.1, thickness: 1.1,
        battlement: 'none', stone: 'basalt', flip: false, openings: [],
      };
      const wc = this.cmdAddWall(kerb, 'Tank kerb');
      wc.redo();
      cmds.push(wc);
    }
    const labels: Record<string, string> = { pond: 'Pond', lake: 'Lake', tank: 'Water tank', moat: 'Moat', river: 'River', stream: 'Stream', waterfall: 'Waterfall' };
    this.history.push(new CompositeCommand(`Add ${labels[data.kind] ?? 'water'}`, cmds));
    const falls = this.water.fallsOf(data.id);
    toast(falls ? `${labels[data.kind]} added — ${falls} fall${falls > 1 ? 's' : ''} where the ground drops` : `${labels[data.kind]} added`, 'ok', 2400);
    return data.id;
  }

  applyWaterInspector(patch: Partial<Pick<WaterData, 'level' | 'width' | 'shore' | 'flow' | 'color' | 'clarity' | 'reflect' | 'closed'>>) {
    const sel = getEditor().selection;
    if (sel.length !== 1 || sel[0].kind !== 'water') return;
    const before = this.water.get(sel[0].id);
    if (!before) return;
    const after = { ...cloneWater(before), ...patch };
    this.exec(this.cmdUpdateWater(before, after, 'Edit water', 'water:' + Object.keys(patch).join(',')));
  }

  /** Leave a dry crossing (land bridge) in a moat or river at the point nearest the camera's focus. */
  addWaterCrossing() {
    const sel = getEditor().selection;
    if (sel.length !== 1 || sel[0].kind !== 'water') return;
    const before = this.water.get(sel[0].id);
    if (!before || before.mode !== 'flow') return;
    const t = this.water.arcLengthNear(before.id, this.rig.target.x, this.rig.target.z);
    const after = cloneWater(before);
    after.openings.push({ t, width: Math.max(4, before.width * 0.8) });
    this.exec(this.cmdUpdateWater(before, after, 'Add crossing'));
    toast('Crossing added where the camera is looking', 'ok', 1800);
  }

  deleteWaterPoint(id: string, index: number) {
    const w = this.water.get(id);
    if (!w) return;
    const min = w.mode === 'area' ? 3 : 2;
    if (w.points.length <= min) { toast('This water needs more points than that', 'warn'); return; }
    const after = cloneWater(w);
    after.points.splice(index, 1);
    this.exec(this.cmdUpdateWater(w, after, 'Remove water point'));
  }

  /** Terrain edit command: before/after heights for a rect; followers re-conform both ways. */
  cmdHeights(rect: GridRect, before: Float32Array, after: Float32Array, label: string): Command {
    return {
      label,
      bytes: before.byteLength * 2,
      redo: () => this.applyHeights(rect, after),
      undo: () => this.applyHeights(rect, before),
    };
  }

  private applyHeights(rect: GridRect, data: Float32Array) {
    const old = this.terrain.heights.slice();
    this.terrain.writeRect(rect, data);
    this.followTerrain(rect, old);
  }

  cmdSplat(rect: GridRect, before: Uint8Array[], after: Uint8Array[], label: string): Command {
    return {
      label,
      bytes: before.reduce((a, b) => a + b.byteLength * 2, 0),
      redo: () => this.terrain.writeSplatRect(rect, after),
      undo: () => this.terrain.writeSplatRect(rect, before),
    };
  }

  /** Ground objects ride the terrain; walls re-conform; objects on walls re-snap to the new wall top. */
  followTerrain(rect: GridRect, old: Float32Array) {
    const [x0, z0, x1, z1] = this.terrain.rectBounds(rect);
    const pad = 2;
    const wallIds = this.walls.all().filter((w) => {
      const b = this.walls.bbox(w.id);
      return b && !(b[2] < x0 - pad || b[0] > x1 + pad || b[3] < z0 - pad || b[1] > z1 + pad);
    }).map((w) => w.id);
    const attached: { o: ObjectData; surf?: number }[] = [];
    for (const id of wallIds) for (const o of this.objects.attachedTo('w:' + id)) attached.push({ o, surf: this.walls.surfaceAt(o.p[0], o.p[2])?.y });
    if (wallIds.length) this.walls.regenerateInRect(x0 - pad, z0 - pad, x1 + pad, z1 + pad);
    this.water.regenerateInRect(x0 - pad, z0 - pad, x1 + pad, z1 + pad);
    for (const d of this.objects.inRect(x0 - pad, z0 - pad, x1 + pad, z1 + pad)) {
      if (d.att) continue;
      const dy = this.terrain.heightAt(d.p[0], d.p[2]) - this.terrain.heightAt(d.p[0], d.p[2], old);
      if (Math.abs(dy) < 1e-5) continue;
      this.liftWithRiders(d, dy);
    }
    for (const { o, surf } of attached) {
      const s = this.walls.surfaceAt(o.p[0], o.p[2]);
      if (!s || surf === undefined) continue;
      this.liftWithRiders(o, s.y - surf);
    }
  }

  // ───────────────────────────── selection ─────────────────────────────

  get selection(): SelRef[] {
    return getEditor().selection;
  }

  setSelection(refs: SelRef[]) {
    const prev = getEditor().selection;
    for (const r of prev) this.highlightRef(r, 'none');
    const clean = refs.filter((r) => this.hasRef(r));
    for (const r of clean) this.highlightRef(r, 'selected');
    setEditor({ selection: clean });
    this.refreshInspector();
    this.refreshSelectionVisuals();
  }

  isSelected(ref: SelRef) {
    return getEditor().selection.some((r) => r.kind === ref.kind && r.id === ref.id);
  }

  pruneSelection() {
    const sel = getEditor().selection;
    const clean = sel.filter((r) => this.hasRef(r));
    if (clean.length !== sel.length) this.setSelection(clean);
    else { this.refreshInspector(); this.refreshSelectionVisuals(); }
  }

  private hovered: SelRef | null = null;
  setHover(ref: SelRef | null) {
    const h = this.hovered;
    if (h && ref && h.kind === ref.kind && h.id === ref.id) return;
    if (h && !this.isSelected(h) && this.hasRef(h)) this.highlightRef(h, 'none');
    this.hovered = ref;
    if (ref && !this.isSelected(ref)) this.highlightRef(ref, 'hover');
  }

  selectionCenter(): { center: Vector3; radius: number } | null {
    const sel = getEditor().selection;
    if (!sel.length) return null;
    const pts: { p: Vector3; r: number }[] = [];
    for (const r of sel) {
      if (r.kind === 'object') {
        const d = this.objects.get(r.id);
        const a = this.objects.assetOf(r.id);
        if (d && a) pts.push({ p: new Vector3(...d.p), r: a.radius * d.s[0] });
      } else if (r.kind === 'wall') {
        const w = this.walls.get(r.id);
        if (w) for (const [x, z] of w.points) pts.push({ p: new Vector3(x, this.terrain.heightAt(x, z), z), r: w.thickness });
      } else {
        const w = this.water.get(r.id);
        if (w) for (const [x, z] of w.points) pts.push({ p: new Vector3(x, this.terrain.heightAt(x, z), z), r: Math.max(1, w.width / 2) });
      }
    }
    if (!pts.length) return null;
    const c = new Vector3();
    pts.forEach((q) => c.add(q.p));
    c.divideScalar(pts.length);
    let radius = 0;
    for (const q of pts) radius = Math.max(radius, Math.hypot(q.p.x - c.x, q.p.z - c.z) + q.r);
    c.y = Math.min(...pts.map((q) => q.p.y));
    return { center: c, radius: radius + 0.4 };
  }

  refreshSelectionVisuals() {
    const s = getEditor();
    const sc = this.selectionCenter();
    const onlyWall = s.selection.length === 1 && s.selection[0].kind !== 'object';
    this.overlay.showRing(sc && !onlyWall && s.tool === 'select' ? sc.center : null, sc?.radius ?? 1, s.transformMode);
    const rings: { p: Vector3; r: number }[] = [];
    if (s.selection.length > 1) {
      for (const r of s.selection) {
        if (r.kind !== 'object') continue;
        const d = this.objects.get(r.id);
        const a = this.objects.assetOf(r.id);
        if (d && a) rings.push({ p: new Vector3(...d.p), r: Math.max(0.4, a.radius * d.s[0]) });
      }
    }
    this.overlay.setBaseRings(rings);
    (this.tools?.select as SelectTool | undefined)?.refreshHandles();
  }

  refreshInspector() {
    const sel = getEditor().selection;
    if (!sel.length) { setEditor({ inspector: null }); return; }
    if (sel.length === 1 && sel[0].kind === 'wall') {
      const w = this.walls.get(sel[0].id);
      const S = this.walls.samples(sel[0].id);
      if (!w) { setEditor({ inspector: null }); return; }
      const prev = getEditor().inspector;
      const insp: InspectorWall = {
        kind: 'wall', id: w.id, height: w.height, thickness: w.thickness, battlement: w.battlement, stone: w.stone,
        smooth: w.smooth, closed: w.closed, flip: w.flip, length: S ? S.length : 0, points: w.points.length,
        handle: prev?.kind === 'wall' && prev.id === w.id ? prev.handle : null,
      };
      setEditor({ inspector: insp });
      return;
    }
    if (sel.length === 1 && sel[0].kind === 'water') {
      const w = this.water.get(sel[0].id);
      if (!w) { setEditor({ inspector: null }); return; }
      const insp: InspectorWater = {
        kind: 'water', id: w.id, waterKind: w.kind, mode: w.mode, level: Math.round(this.water.levelOf(w.id) * 100) / 100,
        levelAuto: w.level === null, depth: w.depth, width: w.width, shore: w.shore, flow: w.flow, color: w.color,
        clarity: w.clarity, reflect: w.reflect, length: this.water.lengthOf(w.id), falls: this.water.fallsOf(w.id),
        points: w.points.length, closed: w.closed, crossings: w.openings.length,
      };
      setEditor({ inspector: insp });
      return;
    }
    const objs = sel.filter((r) => r.kind === 'object').map((r) => this.objects.get(r.id)).filter(Boolean) as ObjectData[];
    if (!objs.length) { setEditor({ inspector: null }); return; }
    const first = objs[0];
    const asset = getAsset(first.type)!;
    const same = objs.every((o) => o.type === first.type);
    const surf = this.surfaceHeight(first.p[0], first.p[2], undefined, !!first.att || this.wallFriendly(first.type), new Set([first.id]));
    const insp: InspectorObject = {
      kind: 'object',
      count: sel.length,
      name: same ? asset.name : `${sel.length} items`,
      info: same ? asset.info : undefined,
      scale: first.s[0],
      rotY: Math.round(((((first.r[1] / DEG) % 360) + 540) % 360) - 180),
      lift: Math.round((first.p[1] - surf.y) * 100) / 100,
      variant: first.v ?? 0,
      variants: same && asset.variants ? asset.variants.map((v) => ({ name: v.name, css: '#' + v.color.toString(16).padStart(6, '0') })) : [],
      emitter: !!asset.emitter,
    };
    setEditor({ inspector: insp });
  }

  // ───────────────────────────── edit actions ─────────────────────────────

  deleteSelection() {
    const sel = getEditor().selection;
    if (!sel.length) return;
    const cmds: Command[] = [];
    const objIds = sel.filter((r) => r.kind === 'object').map((r) => r.id);
    const objs = objIds.map((id) => this.objects.get(id)).filter(Boolean) as ObjectData[];
    if (objs.length) {
      const riders = objs.flatMap((o) => this.objects.attachedTo('o:' + o.id)).filter((r) => !objIds.includes(r.id));
      if (riders.length) {
        const after = riders.map((r) => { const n = cloneData(r); n.p[1] = this.terrain.heightAt(n.p[0], n.p[2]); delete n.att; return n; });
        cmds.push(this.cmdUpdateObjects(riders, after, 'Drop'));
      }
      cmds.push(this.cmdRemoveObjects(objs));
    }
    for (const r of sel.filter((r) => r.kind === 'wall')) {
      const w = this.walls.get(r.id);
      if (!w) continue;
      // Objects on a deleted wall drop to the ground.
      const on = this.objects.attachedTo('w:' + w.id).filter((o) => !objIds.includes(o.id));
      if (on.length) {
        const after = on.map((o) => { const n = cloneData(o); n.p[1] = this.terrain.heightAt(n.p[0], n.p[2]); delete n.att; return n; });
        cmds.push(this.cmdUpdateObjects(on, after, 'Drop'));
      }
      cmds.push(this.cmdRemoveWall(w));
    }
    for (const r of sel.filter((r) => r.kind === 'water')) {
      const w = this.water.get(r.id);
      if (w) cmds.push(this.cmdRemoveWater(w));
    }
    this.setSelection([]);
    this.exec(new CompositeCommand(sel.length === 1 ? 'Delete' : `Delete ${sel.length}`, cmds));
  }

  duplicateSelection(offset = true): SelRef[] {
    const sel = getEditor().selection;
    if (!sel.length) return [];
    const cmds: Command[] = [];
    const out: SelRef[] = [];
    const yaw = this.rig.yaw;
    const ox = offset ? Math.cos(yaw) * 3 : 0, oz = offset ? -Math.sin(yaw) * 3 : 0;
    const datas: ObjectData[] = [];
    for (const r of sel) {
      if (r.kind === 'object') {
        const d = this.objects.get(r.id);
        if (!d) continue;
        const n = cloneData(d);
        n.id = uid();
        if (offset) {
          const surfOld = this.surfaceHeight(d.p[0], d.p[2], undefined, !!d.att).y;
          n.p[0] = clamp(n.p[0] + ox, -this.terrain.half + 1, this.terrain.half - 1);
          n.p[2] = clamp(n.p[2] + oz, -this.terrain.half + 1, this.terrain.half - 1);
          const s = this.surfaceHeight(n.p[0], n.p[2], undefined, !!d.att || this.wallFriendly(d.type));
          n.p[1] = s.y + (d.p[1] - surfOld);
          if (s.wallId) n.att = 'w:' + s.wallId; else delete n.att;
        }
        datas.push(n);
        out.push({ kind: 'object', id: n.id });
      } else if (r.kind === 'wall') {
        const w = this.walls.get(r.id);
        if (!w) continue;
        const n = cloneWall(w);
        n.id = uid();
        if (offset) n.points = n.points.map(([x, z]) => [x + ox * 2, z + oz * 2]);
        cmds.push(this.cmdAddWall(n, 'Duplicate wall'));
        out.push({ kind: 'wall', id: n.id });
      } else {
        const w = this.water.get(r.id);
        if (!w) continue;
        const n = cloneWater(w);
        n.id = uid();
        if (offset) n.points = n.points.map(([x, z]) => [x + ox * 2, z + oz * 2]);
        cmds.push(this.cmdAddWater(n, 'Duplicate water'));
        out.push({ kind: 'water', id: n.id });
      }
    }
    if (datas.length) cmds.unshift(this.cmdAddObjects(datas, 'Duplicate'));
    this.exec(new CompositeCommand('Duplicate', cmds));
    this.setSelection(out);
    return out;
  }

  rotateSelection(deltaRad: number) {
    const sel = getEditor().selection.filter((r) => r.kind === 'object');
    if (!sel.length) return;
    const before = sel.map((r) => this.objects.get(r.id)!).filter(Boolean);
    const sc = this.selectionCenter();
    const after = before.map((d) => {
      const n = cloneData(d);
      n.r[1] += deltaRad;
      if (before.length > 1 && sc) {
        const dx = n.p[0] - sc.center.x, dz = n.p[2] - sc.center.z;
        const c = Math.cos(-deltaRad), s = Math.sin(-deltaRad);
        n.p[0] = sc.center.x + dx * c - dz * s;
        n.p[2] = sc.center.z + dx * s + dz * c;
        const surf = this.surfaceHeight(d.p[0], d.p[2], undefined, !!d.att).y;
        const ns = this.surfaceHeight(n.p[0], n.p[2], undefined, !!d.att || this.wallFriendly(d.type));
        n.p[1] = ns.y + (d.p[1] - surf);
      }
      return n;
    });
    this.exec(this.cmdUpdateObjects(before, after, 'Rotate', 'rot-key'));
    this.refreshSelectionVisuals();
  }

  /** Inspector edits (coalesced per field while dragging a slider). */
  applyInspector(patch: { scale?: number; rotY?: number; lift?: number; variant?: number }) {
    const sel = getEditor().selection.filter((r) => r.kind === 'object');
    const before = sel.map((r) => this.objects.get(r.id)).filter(Boolean) as ObjectData[];
    if (!before.length) return;
    const after = before.map((d) => {
      const n = cloneData(d);
      if (patch.scale !== undefined) n.s = [patch.scale, patch.scale, patch.scale];
      if (patch.rotY !== undefined) n.r[1] = patch.rotY * DEG;
      if (patch.lift !== undefined) {
        const surf = this.surfaceHeight(d.p[0], d.p[2], undefined, !!d.att || this.wallFriendly(d.type), new Set([d.id]));
        n.p[1] = surf.y + patch.lift;
      }
      if (patch.variant !== undefined) n.v = patch.variant;
      return n;
    });
    const key = 'insp:' + Object.keys(patch).join(',');
    this.exec(this.cmdUpdateObjects(before, after, 'Customise', key));
    this.refreshSelectionVisuals();
  }

  applyWallInspector(patch: Partial<Pick<WallData, 'height' | 'thickness' | 'battlement' | 'stone' | 'smooth' | 'closed' | 'flip'>>) {
    const sel = getEditor().selection;
    if (sel.length !== 1 || sel[0].kind !== 'wall') return;
    const token = this.beginWallEdit(sel[0].id);
    const w = { ...cloneWall(token.before), ...patch };
    if (w.closed && w.points.length < 3) w.closed = false;
    this.walls.update(w);
    this.commitWallEdit(token, 'Edit wall', 'wall:' + Object.keys(patch).join(','));
    this.refreshInspector();
    this.refreshSelectionVisuals();
  }

  deleteWallPoint(id: string, index: number) {
    const w = this.walls.get(id);
    if (!w || w.points.length <= 2) { toast('A wall needs at least two points', 'warn'); return; }
    const token = this.beginWallEdit(id);
    w.points.splice(index, 1);
    if (w.closed && w.points.length < 3) w.closed = false;
    this.walls.update(w);
    this.commitWallEdit(token, 'Remove wall point');
    this.refreshInspector();
    this.refreshSelectionVisuals();
  }

  addDiyasAlongWall(spacing = 3.1) {
    const sel = getEditor().selection;
    if (sel.length !== 1 || sel[0].kind !== 'wall') return;
    const id = sel[0].id;
    const pts = this.walls.parapetPoints(id, spacing);
    if (!pts.length) return;
    const datas: ObjectData[] = pts.map((p) => ({ id: uid(), type: 'diya', p: [p.x, p.y, p.z], r: [0, p.yaw + Math.PI / 2, 0], s: [1, 1, 1], att: 'w:' + id }));
    this.exec(this.cmdAddObjects(datas, 'Diyas along wall'));
    toast(`${datas.length} diyas placed along the wall`, 'ok');
  }

  focusSelection() {
    const sc = this.selectionCenter();
    if (!sc) return;
    this.rig.focusOn(sc.center.clone().setY(sc.center.y + 1), Math.max(10, sc.radius * 4));
  }

  cameraPreset(p: CameraPreset) {
    this.rig.preset(p, this.terrain.half);
  }

  setTime(t: TimePreset) {
    setEditor({ time: t });
  }

  undo() {
    const c = this.history.undo();
    if (c) toast(`Undo · ${c.label}`, 'info', 1400);
    this.pruneSelection();
  }

  redo() {
    const c = this.history.redo();
    if (c) toast(`Redo · ${c.label}`, 'info', 1400);
    this.pruneSelection();
  }

  openRadial(p: PointerInfo) {
    const hit = this.pick(p.ray);
    if (hit) {
      if (!this.isSelected(hit)) this.setSelection([{ kind: hit.kind, id: hit.id }]);
      setEditor({ radial: { x: p.x, y: p.y, kind: hit.kind } });
    } else {
      setEditor({ radial: { x: p.x, y: p.y, kind: 'terrain' } });
    }
  }

  /** Global shortcuts. Returns true if handled. */
  handleKey(ev: KeyboardEvent): boolean {
    const ctrl = ev.ctrlKey || ev.metaKey;
    const s = getEditor();
    if (ctrl && ev.code === 'KeyZ') { if (ev.shiftKey) this.redo(); else this.undo(); return true; }
    if (ctrl && ev.code === 'KeyY') { this.redo(); return true; }
    if (ctrl && ev.code === 'KeyS') { void this.saveNow(); return true; }
    if (ctrl && ev.code === 'KeyD') { this.duplicateSelection(); return true; }
    if (this.tool.key(ev)) return true;
    if (ev.code === 'Escape') {
      if (s.radial) { setEditor({ radial: null }); return true; }
      if (s.helpOpen || s.libraryOpen || s.newOpen) { setEditor({ helpOpen: false, libraryOpen: false, newOpen: false }); return true; }
      if (this.tool.cancel()) return true;
      if (s.tool !== 'select') { setEditor({ tool: 'select', category: null }); return true; }
      if (s.selection.length) { this.setSelection([]); return true; }
      return false;
    }
    if (ctrl) return false;
    if (ev.code === 'Delete' || ev.code === 'Backspace') { this.deleteSelection(); return true; }
    if (ev.code === 'KeyQ' || ev.code === 'KeyE') {
      const dir = ev.code === 'KeyQ' ? 1 : -1;
      const step = (ev.shiftKey ? 5 : 15) * DEG;
      if (s.selection.some((r) => r.kind === 'object')) this.rotateSelection(dir * step);
      else this.rig.goal.yaw += dir * step;
      return true;
    }
    if (ev.code === 'KeyM') { setEditor({ transformMode: 'move' }); return true; }
    if (ev.code === 'KeyR') { setEditor({ transformMode: 'rotate' }); return true; }
    if (ev.code === 'KeyT') { setEditor({ transformMode: 'scale' }); return true; }
    if (ev.code === 'KeyF') { this.focusSelection(); return true; }
    if (ev.code === 'KeyG') { setEditor({ place: { ...s.place, gridSnap: !s.place.gridSnap } }); toast(`Grid snap ${!s.place.gridSnap ? 'on' : 'off'}`, 'info', 1200); return true; }
    if (ev.key === '?') { setEditor({ helpOpen: !s.helpOpen }); return true; }
    if (ev.code === 'KeyN') {
      const order: TimePreset[] = ['morning', 'afternoon', 'golden', 'sunset', 'night'];
      this.setTime(order[(order.indexOf(s.time) + 1) % order.length]);
      return true;
    }
    const cats: (CategoryId | null)[] = [null, 'terrain', 'walls', 'fort', 'buildings', 'nature', 'water', 'people', 'decor', 'diwali'];
    const m = /^Digit(\d)$/.exec(ev.code);
    if (m) { this.selectCategory(cats[Number(m[1])] ?? null); return true; }
    return false;
  }

  // ───────────────────────────── documents ─────────────────────────────

  private onHistoryChange() {
    const h = this.history;
    setEditor({ canUndo: h.canUndo, canRedo: h.canRedo, undoLabel: h.undoLabel, redoLabel: h.redoLabel });
    if (this.loadingDoc) return;
    this.dirty = true;
    if (getEditor().saveState !== 'saving') setEditor({ saveState: 'dirty' });
    this.scheduleSave(AUTOSAVE_QUIET_MS);
    const n = this.objects.count;
    if (n > SOFT_LIMIT && n - 1 <= SOFT_LIMIT) toast('Your Killa is getting complex — consider Low quality if it slows down.', 'warn', 5000);
  }

  private scheduleSave(ms: number) {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), ms);
  }

  async saveNow(withThumb = true): Promise<void> {
    if (this.saving) { this.saveQueued = true; return this.saving; }
    window.clearTimeout(this.saveTimer);
    setEditor({ saveState: 'saving' });
    this.dirty = false;
    this.saving = (async () => {
      try {
        this.meta.updatedAt = Date.now();
        const blob = await this.encodeCurrent();
        const thumb = withThumb && this.running
          ? await this.captureNextFrame(() => this.captureCanvas(384, 240))
          : getEditor().library.find((l) => l.id === this.meta.id)?.thumbnail;
        const listing: KillaListing = {
          id: this.meta.id, name: this.meta.name, size: this.meta.size, location: this.meta.location,
          createdAt: this.meta.createdAt, updatedAt: this.meta.updatedAt, thumbnail: thumb || undefined, objectCount: this.objects.count,
        };
        await this.repo.save(listing, blob);
        lastOpened.set(this.meta.id);
        setEditor((s) => ({
          saveState: this.dirty ? 'dirty' : 'saved',
          lastSavedAt: Date.now(),
          library: [listing, ...s.library.filter((l) => l.id !== listing.id)],
        }));
      } catch (err) {
        console.error('Save failed', err);
        this.dirty = true;
        setEditor({ saveState: 'error' });
        toast('Could not save to this browser. Your work is still open.', 'warn', 5000);
      }
    })();
    await this.saving;
    this.saving = null;
    if (this.saveQueued) { this.saveQueued = false; await this.saveNow(withThumb); }
  }

  private async encodeCurrent(): Promise<Blob> {
    return encodeKilla({
      header: {
        format: FORMAT,
        version: VERSION,
        meta: { ...this.meta },
        terrain: { res: this.terrain.res, size: this.terrain.size, hMin: -16, hMax: 112, splatRes: this.terrain.splatRes },
        walls: this.walls.all().map((w) => ({ ...w, points: w.points.map(([x, z]) => [q3(x), q3(z)] as [number, number]) })),
        water: this.water.all().map((w) => ({ ...w, points: w.points.map(([x, z]) => [q3(x), q3(z)] as [number, number]) })),
        objects: this.objects.all().map(compactObject),
        env: { time: getEditor().time },
        camera: this.rig.state,
      },
      heights: this.terrain.encodeHeights(),
      splat: this.terrain.splat.map((s) => s.slice()),
    });
  }

  async refreshLibrary() {
    try {
      const library = await this.repo.list();
      setEditor({ library });
    } catch (err) {
      console.error(err);
      toast('Browser storage is unavailable — saving is disabled in this window.', 'warn', 6000);
    }
  }

  private ensureTerrain(size: PlotSizeId) {
    if (this.terrain.sizeId === size) return;
    this.scene.remove(this.terrain.mesh);
    this.terrain.dispose();
    this.terrain = new Terrain(size, this.layers.texture, this.layers.avg);
    this.terrain.autoCliff = getEditor().paint.autoCliff;
    this.scene.add(this.terrain.mesh);
    this.env.setPlot(this.terrain.half);
    this.lighting.setPlot(this.terrain.half);
    this.rig.setBounds(this.terrain.half);
    this.walls.setHeightFn((x, z) => this.terrain.heightAt(x, z));
    this.water.setTerrain(this.terrain);
    this.lastEmitterVersion = -1;
    this.tool.deactivate();
    this.tool.activate();
  }

  private resetWorld() {
    this.setSelection([]);
    this.objects.clear();
    this.walls.clear();
    this.water.clear();
    this.history.clear();
  }

  async newKilla(name: string, size: PlotSizeId, silent = false) {
    if (this.dirty) await this.saveNow();
    this.loadingDoc = true;
    this.ensureTerrain(size);
    this.resetWorld();
    this.terrain.heights.fill(0);
    this.terrain.syncAll();
    this.terrain.resetSplat();
    this.meta = this.freshMeta(name.trim() || 'My Killa', size);
    setEditor({ killa: { id: this.meta.id, name: this.meta.name, size }, tool: 'select', category: null });
    this.rig.setState({ target: [0, 0, 0], yaw: 0.75, pitch: 38 * DEG, distance: this.terrain.half * 1.9 }, !silent);
    if (!silent) this.rig.setState({ target: [0, 0, 0], yaw: 0.75, pitch: 34 * DEG, distance: this.terrain.half * 1.7 }, false);
    this.loadingDoc = false;
    this.dirty = true;
    await this.saveNow(this.running);
    if (!silent) toast('This land is yours. Build anything.', 'ok', 3600);
  }

  async openKilla(id: string, silent = false) {
    if (this.dirty && id !== this.meta.id) await this.saveNow();
    const blob = await this.repo.load(id);
    if (!blob) throw new Error('Killa not found');
    await this.loadBlob(blob, id);
    if (!silent) toast(`Opened ${this.meta.name}`, 'ok', 1800);
  }

  private async loadBlob(blob: Blob, overrideId?: string) {
    const doc = await decodeKilla(blob);
    const h = doc.header;
    this.loadingDoc = true;
    const size = (Object.keys(PLOT_SIZES) as PlotSizeId[]).find((k) => PLOT_SIZES[k].res === h.terrain.res) ?? h.meta.size;
    this.ensureTerrain(size);
    this.resetWorld();
    // Progressive: terrain → walls → objects, so the Killa appears quickly.
    this.terrain.decodeHeights(doc.heights);
    this.terrain.setSplat(doc.splat);
    this.meta = { ...h.meta, id: overrideId ?? h.meta.id, size };
    setEditor({ killa: { id: this.meta.id, name: this.meta.name, size }, time: h.env?.time ?? 'afternoon', tool: 'select', category: null });
    this.lighting.setPreset(h.env?.time ?? 'afternoon', true);
    if (h.camera) this.rig.setState(h.camera);
    await tick();
    for (const w of h.walls) this.walls.add({ ...w, openings: w.openings ?? [] });
    for (const w of h.water ?? []) this.water.add({ ...w, openings: w.openings ?? [] });
    const objs = h.objects;
    for (let i = 0; i < objs.length; i += 600) {
      for (const o of objs.slice(i, i + 600)) this.objects.add(o);
      if (this.running) await tick();
    }
    this.history.clear();
    this.loadingDoc = false;
    this.dirty = false;
    setEditor({ saveState: 'saved' });
    lastOpened.set(this.meta.id);
  }

  async renameKilla(id: string, name: string) {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    if (id === this.meta.id) {
      this.meta.name = clean;
      setEditor((s) => ({ killa: { ...s.killa, name: clean } }));
      await this.saveNow(false);
      return;
    }
    const blob = await this.repo.load(id);
    const listing = getEditor().library.find((l) => l.id === id);
    if (!blob || !listing) return;
    const doc = await decodeKilla(blob);
    doc.header.meta.name = clean;
    const out = await encodeKilla(doc);
    const next = { ...listing, name: clean };
    await this.repo.save(next, out);
    setEditor((s) => ({ library: s.library.map((l) => (l.id === id ? next : l)) }));
  }

  async duplicateKilla(id: string) {
    const blob = id === this.meta.id ? await this.encodeCurrent() : await this.repo.load(id);
    const listing = getEditor().library.find((l) => l.id === id);
    if (!blob || !listing) return;
    const doc = await decodeKilla(blob);
    const now = Date.now();
    doc.header.meta = { ...doc.header.meta, id: uid(), name: `${doc.header.meta.name} (copy)`, createdAt: now, updatedAt: now };
    const out = await encodeKilla(doc);
    const next: KillaListing = { ...listing, id: doc.header.meta.id, name: doc.header.meta.name, createdAt: now, updatedAt: now };
    await this.repo.save(next, out);
    setEditor((s) => ({ library: [next, ...s.library] }));
    toast(`Duplicated as “${next.name}”`, 'ok');
  }

  async deleteKilla(id: string) {
    await this.repo.remove(id);
    const library = getEditor().library.filter((l) => l.id !== id);
    setEditor({ library });
    if (id === this.meta.id) {
      this.dirty = false;
      if (library[0]) await this.openKilla(library[0].id, true);
      else await this.newKilla('My Killa', 'medium');
    }
  }

  async exportKilla() {
    const blob = await this.encodeCurrent();
    downloadBlob(blob, `${safeName(this.meta.name)}.killa`);
  }

  async importKilla(file: File) {
    try {
      if (this.dirty) await this.saveNow();
      await this.loadBlob(file, uid());
      const now = Date.now();
      this.meta.createdAt = now;
      this.dirty = true;
      await this.saveNow();
      toast(`Imported “${this.meta.name}”`, 'ok');
    } catch (err) {
      console.error(err);
      toast('That file is not a Majha Killa file.', 'warn');
    }
  }

  async screenshot() {
    const png = await this.captureNextFrame(() => {
      const src = this.renderer.domElement;
      return this.captureCanvas(src.width, src.height, 'image/png', 1);
    });
    if (!png) return;
    const a = document.createElement('a');
    a.href = png;
    a.download = `${safeName(this.meta.name)}.png`;
    a.click();
  }
}

function categoryOf(assetId: string, cat: CategoryId) {
  const a = getAsset(assetId);
  if (!a) return false;
  if (cat === 'decor') return ['cannon', 'cannonballs', 'torch', 'diya', 'akash_kandil', 'flag_saffron', 'rock_small'].includes(assetId);
  if (cat === 'water') return a.category === 'water';
  return a.category === cat;
}

/** Yield a frame (or a macrotask when the tab is hidden, where rAF never fires). */
const tick = () => new Promise<void>((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => r())));
const q3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 10000) / 10000;
/** Millimetre positions / 1e-4 rad rotations: visually lossless, and it compresses far better. */
function compactObject(o: ObjectData): ObjectData {
  return { ...o, p: [q3(o.p[0]), q3(o.p[1]), q3(o.p[2])], r: [q4(o.r[0]), q4(o.r[1]), q4(o.r[2])], s: [q3(o.s[0]), q3(o.s[1]), q3(o.s[2])] };
}
const safeName = (s: string) => s.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'killa';

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { editorStore };
