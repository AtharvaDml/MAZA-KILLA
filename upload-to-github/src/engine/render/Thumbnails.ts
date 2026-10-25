import {
  ACESFilmicToneMapping, Box3, Color, DirectionalLight, HemisphereLight, InstancedBufferAttribute, InstancedMesh, Matrix4,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import type { AssetDef } from '../objects/catalog';
import type { MaterialSet } from './materials';

/** Renders each catalogue asset once into a small image for the build menu. */
export async function renderAssetThumbnails(assets: AssetDef[], materials: MaterialSet, size = 160): Promise<Record<string, string>> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const hemi = new HemisphereLight(0xfff3e0, 0x6b5640, 1.25);
  const key = new DirectionalLight(0xfff0dc, 2.6);
  key.position.set(4, 6, 5);
  const rim = new DirectionalLight(0xffc890, 1.0);
  rim.position.set(-5, 3, -4);
  scene.add(hemi, key, rim);
  const camera = new PerspectiveCamera(30, 1, 0.05, 200);
  const out: Record<string, string> = {};
  const box = new Box3();
  const tmp = new Box3();

  for (const a of assets) {
    const meshes: InstancedMesh[] = [];
    box.makeEmpty();
    const color = a.variants?.length ? new Color(a.variants[0].color) : new Color(1, 1, 1);
    for (const part of a.parts) {
      const g = part.geometry.clone();
      g.setAttribute('aHL', new InstancedBufferAttribute(new Float32Array(1), 1));
      const m = new InstancedMesh(g, materials.get(part.material), 1);
      m.setMatrixAt(0, new Matrix4());
      m.setColorAt(0, color);
      m.frustumCulled = false;
      scene.add(m);
      meshes.push(m);
      if (part.material !== 'glow') {
        g.computeBoundingBox();
        tmp.copy(g.boundingBox!);
        box.union(tmp);
      }
    }
    const c = box.getCenter(new Vector3());
    const sz = box.getSize(new Vector3());
    const r = Math.max(sz.x, sz.y * 1.05, sz.z) * 0.62 + 0.05;
    const flat = sz.y < 0.2;
    const dir = flat ? new Vector3(0.0, 1, 0.35).normalize() : new Vector3(0.78, 0.5, 1).normalize();
    const dist = r / Math.tan((camera.fov * Math.PI) / 360) * 1.05;
    camera.position.copy(c).addScaledVector(dir, dist);
    camera.lookAt(c);
    camera.near = dist * 0.05;
    camera.far = dist * 4;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    out[a.id] = canvas.toDataURL('image/png');
    for (const m of meshes) {
      scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    await new Promise((r2) => setTimeout(r2, 0));
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
