import {
  Color, ConeGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, RingGeometry,
  SphereGeometry, Vector3, BoxGeometry, Material,
} from 'three';
import type { TransformMode } from '../../state/store';
import type { AssetDef } from '../objects/catalog';
import type { MaterialSet } from '../render/materials';

const MAX_HANDLES = 256;

/** Lightweight editor visuals, never shadowed and never saved. */
export class Overlay {
  readonly group = new Group();
  private readonly ringGroup = new Group();
  private readonly ring: Mesh;
  private readonly glyphs: Record<TransformMode, Group>;
  private readonly handles: InstancedMesh;
  private readonly markers: InstancedMesh;
  private readonly baseRings: InstancedMesh;
  private ghost: Group | null = null;
  private ghostAsset: string | null = null;
  private ghostState: 'ok' | 'warn' | 'bad' = 'ok';
  private readonly handleColor = new Color(0xfff1d6);
  private readonly handleHot = new Color(0xffa63d);

  constructor(private readonly materials: MaterialSet) {
    this.group.name = 'overlay';
    const ringMat = new MeshBasicMaterial({ color: 0xffe7c2, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });
    this.ring = new Mesh(new RingGeometry(0.97, 1.0, 96), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 20;
    this.ringGroup.add(this.ring);
    this.glyphs = { move: new Group(), rotate: new Group(), scale: new Group() };
    const glyphMat = new MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const arrow = new Mesh(new ConeGeometry(0.06, 0.14, 3), glyphMat);
      arrow.position.set(Math.cos(a) * 1.08, 0, Math.sin(a) * 1.08);
      arrow.rotation.set(0, -a, -Math.PI / 2);
      arrow.renderOrder = 21;
      this.glyphs.move.add(arrow);
      const tick = new Mesh(new BoxGeometry(0.02, 0.01, 0.14), glyphMat);
      tick.position.set(Math.cos(a + Math.PI / 4) * 1.0, 0, Math.sin(a + Math.PI / 4) * 1.0);
      tick.rotation.y = -(a + Math.PI / 4) + Math.PI / 2;
      tick.renderOrder = 21;
      this.glyphs.rotate.add(tick);
      const sq = new Mesh(new BoxGeometry(0.09, 0.01, 0.09), glyphMat);
      sq.position.set(Math.cos(a + Math.PI / 4) * 1.0, 0, Math.sin(a + Math.PI / 4) * 1.0);
      sq.rotation.y = -(a + Math.PI / 4);
      sq.renderOrder = 21;
      this.glyphs.scale.add(sq);
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const t = new Mesh(new BoxGeometry(0.012, 0.01, 0.06), glyphMat);
      t.position.set(Math.cos(a) * 0.93, 0, Math.sin(a) * 0.93);
      t.rotation.y = -a + Math.PI / 2;
      t.renderOrder = 21;
      this.glyphs.rotate.add(t);
    }
    Object.values(this.glyphs).forEach((g) => this.ringGroup.add(g));
    this.ringGroup.visible = false;
    this.group.add(this.ringGroup);

    const hMat = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
    this.handles = new InstancedMesh(new SphereGeometry(0.4, 16, 12), hMat, MAX_HANDLES);
    this.handles.count = 0;
    this.handles.renderOrder = 30;
    this.handles.frustumCulled = false;
    this.group.add(this.handles);

    const mMat = new MeshBasicMaterial({ color: 0xffa63d, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
    this.markers = new InstancedMesh(new SphereGeometry(0.45, 14, 10), mMat, MAX_HANDLES);
    this.markers.count = 0;
    this.markers.renderOrder = 30;
    this.markers.frustumCulled = false;
    this.group.add(this.markers);

    const bMat = new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
    const bGeo = new RingGeometry(0.9, 1.0, 48);
    bGeo.rotateX(-Math.PI / 2);
    this.baseRings = new InstancedMesh(bGeo, bMat, 1024);
    this.baseRings.count = 0;
    this.baseRings.renderOrder = 19;
    this.baseRings.frustumCulled = false;
    this.group.add(this.baseRings);
  }

  // ── transform ring ──
  showRing(center: Vector3 | null, radius: number, mode: TransformMode) {
    if (!center) { this.ringGroup.visible = false; return; }
    this.ringGroup.visible = true;
    this.ringGroup.position.set(center.x, center.y + 0.08, center.z);
    this.ringGroup.scale.setScalar(Math.max(0.8, radius));
    for (const k of Object.keys(this.glyphs) as TransformMode[]) this.glyphs[k].visible = k === mode;
  }

  setBaseRings(items: { p: Vector3; r: number }[]) {
    const m = new Matrix4();
    const n = Math.min(items.length, 1024);
    for (let i = 0; i < n; i++) {
      const { p, r } = items[i];
      m.makeScale(r, 1, r).setPosition(p.x, p.y + 0.06, p.z);
      this.baseRings.setMatrixAt(i, m);
    }
    this.baseRings.count = n;
    this.baseRings.instanceMatrix.needsUpdate = true;
  }

  // ── wall handles ──
  setHandles(pos: Vector3[], hot: number | null, scale: number) {
    const m = new Matrix4();
    const n = Math.min(pos.length, MAX_HANDLES);
    for (let i = 0; i < n; i++) {
      const s = scale * (i === hot ? 1.35 : 1);
      m.makeScale(s, s, s).setPosition(pos[i]);
      this.handles.setMatrixAt(i, m);
      this.handles.setColorAt(i, i === hot ? this.handleHot : this.handleColor);
    }
    this.handles.count = n;
    this.handles.instanceMatrix.needsUpdate = true;
    if (this.handles.instanceColor) this.handles.instanceColor.needsUpdate = true;
  }

  setMarkers(pos: Vector3[], hot: number | null, scale: number) {
    const m = new Matrix4();
    const n = Math.min(pos.length, MAX_HANDLES);
    for (let i = 0; i < n; i++) {
      const s = scale * (i === hot ? 1.6 : 1);
      m.makeScale(s, s, s).setPosition(pos[i]);
      this.markers.setMatrixAt(i, m);
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
  }

  // ── placement ghost ──
  setGhost(asset: AssetDef | null) {
    if (this.ghostAsset === (asset?.id ?? null)) return;
    if (this.ghost) this.group.remove(this.ghost);
    this.ghost = null;
    this.ghostAsset = asset?.id ?? null;
    if (!asset) return;
    const g = new Group();
    for (const part of asset.parts) {
      if (part.material === 'glow' || part.material === 'flame') continue;
      const mesh = new Mesh(part.geometry, this.ghostMaterial());
      mesh.renderOrder = 15;
      g.add(mesh);
    }
    g.visible = false;
    this.ghost = g;
    this.group.add(g);
  }

  private ghostMaterial(): Material {
    return this.ghostState === 'bad' ? this.materials.ghost.invalid : this.ghostState === 'warn' ? this.materials.ghost.warn : this.materials.ghost.valid;
  }

  updateGhost(pos: Vector3 | null, quat: Quaternion, scale: number, state: 'ok' | 'warn' | 'bad') {
    if (!this.ghost) return;
    if (!pos) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghost.position.copy(pos);
    this.ghost.quaternion.copy(quat);
    this.ghost.scale.setScalar(scale);
    if (state !== this.ghostState) {
      this.ghostState = state;
      const mat = this.ghostMaterial();
      this.ghost.children.forEach((c: Object3D) => ((c as Mesh).material = mat));
    }
  }

  hideAll() {
    this.ringGroup.visible = false;
    this.handles.count = 0;
    this.markers.count = 0;
    this.baseRings.count = 0;
    if (this.ghost) this.ghost.visible = false;
  }
}
