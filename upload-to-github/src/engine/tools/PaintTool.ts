import { Vector3 } from 'three';
import { getEditor, setEditor } from '../../state/store';
import { LAYERS } from '../terrain/layers';
import { unionRect, type GridRect } from '../terrain/Terrain';
import { clamp } from '../util/math';
import { Tool, type PointerInfo } from './Tool';

/** Paints blended surface materials straight onto the terrain. */
export class PaintTool extends Tool {
  readonly id = 'paint' as const;
  cursor = 'crosshair';
  private before: Uint8Array[] | null = null;
  private rect: GridRect | null = null;
  private hit: Vector3 | null = null;
  private active = false;

  deactivate() {
    if (this.active) this.end();
    this.e.terrain.material.userData.k.uBrushOn.value = 0;
  }

  pointerDown(p: PointerInfo): boolean {
    if (p.button !== 0) return false;
    const hit = this.e.terrain.raycast(p.ray);
    if (!hit || !this.e.terrain.inside(hit.x, hit.z)) return false;
    this.hit = hit;
    this.before = this.e.terrain.snapshotSplat();
    this.rect = null;
    this.active = true;
    return true;
  }

  pointerUp() {
    if (this.active) this.end();
  }

  private end() {
    this.active = false;
    if (!this.rect || !this.before) return;
    const t = this.e.terrain;
    const before = t.extractSplatRect(this.before, this.rect);
    const after = t.extractSplatRect(t.splat, this.rect);
    const layer = LAYERS[getEditor().paint.layer]?.name ?? 'surface';
    this.e.history.push(this.e.cmdSplat(this.rect, before, after, `Paint ${layer}`));
    this.before = null;
    this.rect = null;
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.code === 'BracketLeft' || ev.code === 'BracketRight') {
      const s = getEditor().paint;
      setEditor({ paint: { ...s, size: clamp(s.size * (ev.code === 'BracketLeft' ? 0.85 : 1.18), 1, 50) } });
      return true;
    }
    return false;
  }

  update(dt: number) {
    const p = this.e.input.refreshRay();
    const k = this.e.terrain.material.userData.k;
    const s = getEditor().paint;
    if (p) this.hit = this.e.terrain.raycast(p.ray);
    const hit = this.hit;
    const show = !!p && !!hit && this.e.terrain.inside(hit.x, hit.z);
    k.uBrushOn.value = show ? 1 : 0;
    if (!show || !hit) return;
    k.uBrushPos.value.set(hit.x, hit.z);
    k.uBrushRadius.value = s.size;
    k.uBrushHard.value = clamp(1 - s.falloff, 0.05, 0.95);
    k.uBrushColor.value.setRGB(1.0, 0.92, 0.75);
    if (!this.active) return;
    const r = this.e.terrain.paint(s.layer, hit.x, hit.z, s.size, s.strength, s.falloff, dt);
    this.rect = unionRect(this.rect, r);
  }
}
