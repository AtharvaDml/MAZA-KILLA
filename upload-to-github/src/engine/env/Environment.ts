import {
  BackSide, BufferAttribute, BufferGeometry, Color, DataArrayTexture, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, Quaternion, ShaderMaterial, SphereGeometry, Vector3, Euler, Camera,
} from 'three';
import { createTerrainMaterial } from '../terrain/TerrainMaterial';
import type { MaterialSet } from '../render/materials';
import { CylinderGeometry, IcosahedronGeometry } from 'three';
import { PartBuilder } from '../objects/geo';
import { fbm2, mulberry32 } from '../util/noise';
import { smoothstep } from '../util/math';

export interface SkyState {
  top: Color;
  horizon: Color;
  bottom: Color;
  sunDir: Vector3;
  sunColor: Color;
  sunSize: number;
  stars: number;
}

/**
 * Low-detail stand-ins for the distant forest (~200 triangles instead of ~2,500):
 * they are only ever seen far away, through haze.
 */
function backgroundTree(kind: string): BufferGeometry {
  const b = new PartBuilder();
  const green = kind === 'tree_tall' ? 0x34552a : kind === 'tree_large' ? 0x3f6126 : 0x4f6e2b;
  if (kind === 'bush') {
    b.add(new IcosahedronGeometry(0.8, 1), { color: 0x4a6b2c, pos: [0, 0.5, 0], scale: [1.3, 0.8, 1.1], smooth: true, jitter: 0.15, colorNoise: 0.2 });
    return b.build();
  }
  const H = kind === 'tree_large' ? 3.2 : 2.6;
  b.add(new CylinderGeometry(0.15, 0.3, H, 5), { color: 0x56402e, pos: [0, H / 2, 0] });
  const blobs: [number, number, number, number][] =
    kind === 'tree_tall' ? [[0, 3.6, 0, 1.2], [0, 5.4, 0, 0.95], [0, 6.8, 0, 0.6]]
    : kind === 'tree_large' ? [[0, 5.6, 0, 2.5], [1.8, 4.8, 0.6, 1.8], [-1.7, 4.9, -0.7, 1.8], [0.4, 4.6, -1.9, 1.7]]
    : [[0, 4.0, 0, 1.8], [0.9, 3.5, 0.5, 1.3], [-0.8, 3.7, -0.5, 1.3]];
  blobs.forEach(([x, y, z, r], i) =>
    b.add(new IcosahedronGeometry(r, 1), {
      color: green, tint: 1, pos: [x, y, z], scale: kind === 'tree_tall' ? [1.1, 1.9, 1.1] : 1,
      smooth: true, jitter: r * 0.18, jitterFreq: 1.4, colorNoise: 0.2, ao: [2.4, 5.4, 0.55], seed: 300 + i,
    }),
  );
  return b.build();
}

export class Environment {
  readonly group = new Group();
  readonly sky: Mesh;
  readonly skyUniforms: Record<string, { value: unknown }>;
  private ground: Mesh | null = null;
  private trees: InstancedMesh[] = [];
  private readonly groundMat: ReturnType<typeof createTerrainMaterial>;

  constructor(layers: DataArrayTexture, layerAvg: [number, number, number][], private readonly materials: MaterialSet, plotHalf: number) {
    this.group.name = 'environment';
    this.skyUniforms = {
      uTop: { value: new Color(0x4f8fd6) },
      uHorizon: { value: new Color(0xcfe2f2) },
      uBottom: { value: new Color(0x9aa38a) },
      uSunDir: { value: new Vector3(0.4, 0.6, 0.3).normalize() },
      uSunColor: { value: new Color(1, 0.95, 0.85) },
      uSunSize: { value: 0.0016 },
      uStars: { value: 0 },
      uTime: { value: 0 },
    };
    const skyMat = new ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
        uniform float uSunSize, uStars, uTime;
        varying vec3 vDir;
        float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.55, h), 0.75));
          col = mix(col, uBottom, smoothstep(0.0, -0.2, h));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.45);
          col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, sd) * 3.5;
          if (uStars > 0.001 && h > 0.0) {
            vec3 p = d * 220.0;
            vec3 i = floor(p);
            vec3 f = fract(p) - 0.5 - (vec3(h31(i), h31(i + 7.1), h31(i + 3.3)) - 0.5) * 0.6;
            float r = h31(i + 11.7);
            float tw = 0.65 + 0.35 * sin(uTime * (1.0 + r * 3.0) + r * 60.0);
            float star = step(0.985, r) * smoothstep(0.16, 0.0, length(f)) * tw;
            col += vec3(1.0, 0.95, 0.85) * star * uStars * smoothstep(0.02, 0.3, h) * 1.6;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new Mesh(new SphereGeometry(3000, 32, 18), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.groundMat = createTerrainMaterial(layers, { ground: true, plotHalf, avg: layerAvg });
    this.group.add(this.buildHills());
    this.setPlot(plotHalf);
  }

  /** Flat-topped plateaus with steep scarps ring the valley, Deccan-trap style. */
  private buildHills(): Mesh {
    const NA = 300, NR = 28, R0 = 380, R1 = 1700;
    const pos = new Float32Array((NA + 1) * (NR + 1) * 3);
    const col = new Float32Array((NA + 1) * (NR + 1) * 3);
    const low = new Color(0x5e6b3f), mid = new Color(0x6d6a4c), rock = new Color(0x4d4740), top = new Color(0x6c7a44);
    const c = new Color();
    for (let j = 0; j <= NR; j++) {
      const r = R0 + (R1 - R0) * Math.pow(j / NR, 1.4);
      const env = smoothstep(R0, R0 + 260, r);
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const n = fbm2(x * 0.0022, z * 0.0022, 5, 501);
        const m = fbm2(x * 0.0009 + 4, z * 0.0009, 3, 502);
        // terrace: broad base, a steep scarp, then a flat top
        let t = smoothstep(0.32, 0.5, n) * 0.55 + smoothstep(0.56, 0.6, n) * 0.45;
        t *= 0.55 + 0.9 * m;
        const hgt = t * 260 * env + (fbm2(x * 0.02, z * 0.02, 2, 503) - 0.5) * 8 * env;
        const k = (j * (NA + 1) + i) * 3;
        pos[k] = x; pos[k + 1] = Math.max(-2, hgt); pos[k + 2] = z;
        const steep = smoothstep(0.42, 0.56, n) * (1 - smoothstep(0.6, 0.64, n));
        c.copy(low).lerp(mid, smoothstep(10, 90, hgt)).lerp(rock, steep * 0.7).lerp(top, smoothstep(0.62, 0.7, n) * 0.6);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < NR; j++) {
      for (let i = 0; i < NA; i++) {
        const a = j * (NA + 1) + i, b = a + 1, cc = a + NA + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Fix winding if normals point down.
    const nrm = g.getAttribute('normal');
    if (nrm.getY(Math.floor(nrm.count / 2)) < 0) {
      const ix = g.getIndex()!.array as Uint16Array | Uint32Array;
      for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; }
      g.computeVertexNormals();
    }
    const mesh = new Mesh(g, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.name = 'hills';
    return mesh;
  }

  setPlot(plotHalf: number) {
    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
    }
    this.groundMat.userData.k.uPlotHalf.value = plotHalf;
    // Square ring from the plot edge outward (the plot mesh fills the hole).
    const R = 1800, h = plotHalf;
    const v = [
      -R, -R, R, -R, R, R, -R, R, // outer
      -h, -h, h, -h, h, h, -h, h, // inner
    ];
    const pos = new Float32Array(8 * 3);
    for (let i = 0; i < 8; i++) { pos[i * 3] = v[i * 2]; pos[i * 3 + 1] = -0.02; pos[i * 3 + 2] = v[i * 2 + 1]; }
    const idx = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7, 3, 7, 0, 0, 7, 4];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(8 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    // ensure upward-facing winding
    const a = new Vector3(...pos.slice(0, 3)), b = new Vector3(...pos.slice(12, 15)), cc = new Vector3(...pos.slice(3, 6));
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(cc, a));
    if (n.y < 0) {
      for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
      g.setIndex(idx);
    }
    this.ground = new Mesh(g, this.groundMat);
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.group.add(this.ground);
    this.scatterTrees(plotHalf);
  }

  private scatterTrees(plotHalf: number) {
    for (const t of this.trees) { this.group.remove(t); t.dispose(); }
    this.trees = [];
    const rng = mulberry32(2026);
    const kinds = ['tree_round', 'tree_tall', 'tree_large', 'bush'];
    const mats: Matrix4[][] = kinds.map(() => []);
    const q = new Quaternion();
    let placed = 0, tries = 0;
    while (placed < 360 && tries < 5000) {
      tries++;
      const a = rng() * Math.PI * 2;
      const r = plotHalf + 14 + Math.pow(rng(), 0.8) * 420;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) < plotHalf + 10) continue;
      const clump = fbm2(x * 0.012, z * 0.012, 3, 404);
      if (clump < 0.5 && rng() > 0.15) continue;
      const k = rng() < 0.12 ? 3 : rng() < 0.45 ? 0 : rng() < 0.6 ? 1 : 2;
      const s = 0.8 + rng() * 0.8;
      q.setFromEuler(new Euler(0, rng() * Math.PI * 2, 0));
      mats[k].push(new Matrix4().compose(new Vector3(x, 0, z), q, new Vector3(s, s * (0.9 + rng() * 0.25), s)));
      placed++;
    }
    kinds.forEach((id, k) => {
      if (!mats[k].length) return;
      const geo = backgroundTree(id);
      geo.setAttribute('aHL', new InstancedBufferAttribute(new Float32Array(mats[k].length), 1));
      const im = new InstancedMesh(geo, this.materials.get('clay'), mats[k].length);
      mats[k].forEach((m, i) => im.setMatrixAt(i, m));
      const tint = new Color();
      const greens = [0xffffff, 0xd0e0b8, 0xe8e0a0, 0xc8d8b0];
      for (let i = 0; i < mats[k].length; i++) im.setColorAt(i, tint.set(greens[i % greens.length]));
      im.castShadow = false;
      im.receiveShadow = true;
      im.name = 'bg-' + id;
      this.trees.push(im);
      this.group.add(im);
    });
  }

  setSky(s: SkyState) {
    (this.skyUniforms.uTop.value as Color).copy(s.top);
    (this.skyUniforms.uHorizon.value as Color).copy(s.horizon);
    (this.skyUniforms.uBottom.value as Color).copy(s.bottom);
    (this.skyUniforms.uSunDir.value as Vector3).copy(s.sunDir);
    (this.skyUniforms.uSunColor.value as Color).copy(s.sunColor);
    this.skyUniforms.uSunSize.value = s.sunSize;
    this.skyUniforms.uStars.value = s.stars;
  }

  update(camera: Camera, time: number) {
    this.sky.position.copy(camera.position);
    this.skyUniforms.uTime.value = time;
  }
}
