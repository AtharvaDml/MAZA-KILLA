import {
  AddEquation, Color, CustomBlending, DoubleSide, OneFactor, ZeroFactor, Material, MeshBasicMaterial, MeshStandardMaterial, ShaderMaterial, Texture, Vector2,
} from 'three';
import { GLSL_NOISE, GLSL_PERTURB } from './glsl';
import { LAMP_COUNT, shared } from './shared';
import { createMasonryTextures, createRangoliTexture } from './textures';

export type MaterialKey =
  | 'clay' | 'stone' | 'cloth' | 'flame' | 'glow' | 'window' | 'lantern' | 'metal' | 'rangoli_lotus' | 'rangoli_star' | 'water_small';

interface HandmadeOpts {
  key: string;
  grain: number; // albedo grain amount
  grainScale: number;
  bump: number;
  cloth?: boolean;
  lamp?: { day: number; night: number; dayDiffuse: number };
  hl?: number; // static highlight (non-instanced meshes)
}

/**
 * Extends MeshStandardMaterial with the "handmade miniature" look:
 * tint mask for variants, clay grain + bump, selection rim light, optional cloth wind and lamp glow.
 */
function patchHandmade(mat: MeshStandardMaterial, o: HandmadeOpts) {
  const uHL = { value: o.hl ?? 0 };
  (mat.userData as { uHL?: { value: number } }).uHL = uHL;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uHLColor = shared.uHLColor;
    shader.uniforms.uWind = shared.uWind;
    shader.uniforms.uHL = uHL;
    shader.uniforms.uLampPos = shared.uLampPos;
    shader.uniforms.uLampCol = shared.uLampCol;

    let vs = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute float aTint;
      uniform float uTime;
      uniform float uWind;
      uniform float uHL;
      varying float vKHL;
      varying vec3 vKNP;
      varying vec3 vKWP;
      #ifdef USE_INSTANCING
        attribute float aHL;
      #endif`,
    );
    vs = vs.replace(
      '#include <color_vertex>',
      `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        vColor = vec3(1.0);
      #endif
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor *= mix(vec3(1.0), instanceColor.xyz, aTint);
      #endif`,
    );
    if (o.cloth) {
      vs = vs
        .replace(
          '#include <beginnormal_vertex>',
          `float kU = uv.x;
          float kPh = 0.0;
          #ifdef USE_INSTANCING
            kPh = dot(instanceMatrix[3].xyz, vec3(0.37, 0.11, 0.53));
          #endif
          float kA = 0.16 * uWind, kB = 0.05 * uWind;
          float kArg1 = kU * 6.0 - uTime * 4.6 + kPh;
          float kArg2 = kU * 11.0 - uTime * 7.3 + kPh * 1.7;
          float kZ = (sin(kArg1) * kA + sin(kArg2) * kB) * kU;
          float kDz = (cos(kArg1) * 6.0 * kA + cos(kArg2) * 11.0 * kB) * kU + (sin(kArg1) * kA + sin(kArg2) * kB);
          vec3 objectNormal = normalize(vec3(-kDz / 1.9, 0.0, 1.0));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          transformed.z += kZ;
          transformed.y -= kU * kU * 0.07;`,
        );
    }
    vs = vs.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vKNP = position * ${o.grainScale.toFixed(3)};
      {
        vec4 kWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          kWP = instanceMatrix * kWP;
        #endif
        vKWP = (modelMatrix * kWP).xyz;
      }
      #ifdef USE_INSTANCING
        vKNP += instanceMatrix[3].xyz * 0.73;
        vKHL = aHL;
      #else
        vKHL = uHL;
      #endif`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying float vKHL;
      varying vec3 vKNP;
      varying vec3 vKWP;
      uniform vec3 uHLColor;
      uniform float uNight;
      uniform vec4 uLampPos[${LAMP_COUNT}];
      uniform vec3 uLampCol[${LAMP_COUNT}];
      ${GLSL_NOISE}
      ${GLSL_PERTURB}`,
    );
    fs = fs.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float kg = kNoise3(vKNP) * 0.6 + kNoise3(vKNP * 3.7) * 0.4;
      diffuseColor.rgb *= (1.0 - ${o.grain.toFixed(3)} * 0.5) + kg * ${o.grain.toFixed(3)};
      ${o.lamp ? `diffuseColor.rgb *= ${o.lamp.dayDiffuse.toFixed(3)};` : ''}`,
    );
    fs = fs.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      normal = kPerturbNormal(-vViewPosition, normal, vec2(dFdx(kg), dFdy(kg)) * ${o.bump.toFixed(3)}, faceDirection);`,
    );
    fs = fs.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float kRim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += uHLColor * (kRim * 0.85 + 0.07) * vKHL;
        ${o.lamp ? `totalEmissiveRadiance += vColor.rgb * mix(${o.lamp.day.toFixed(3)}, ${o.lamp.night.toFixed(3)}, uNight);` : ''}
      }`,
    );
    // Lamp clusters: a uniform branch, so daytime pays nothing.
    fs = fs.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      if (uNight > 0.01) {
        vec3 kNW = inverseTransformDirection(normal, viewMatrix);
        for (int i = 0; i < ${LAMP_COUNT}; i++) {
          vec3 L = uLampPos[i].xyz - vKWP;
          float d = length(L);
          float r = uLampPos[i].w;
          if (d < r) {
            float a = 1.0 - d / r;
            a *= a;
            float ndl = clamp(dot(kNW, L / max(d, 1e-3)), 0.0, 1.0) * 0.75 + 0.25;
            reflectedLight.directDiffuse += diffuseColor.rgb * uLampCol[i] * a * ndl * uNight;
          }
        }
      }`,
    );
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => o.key;
}

export interface MaterialSet {
  get(key: MaterialKey): Material;
  /** Late-bound materials that need other systems first (e.g. water reads the terrain + sky). */
  register(key: MaterialKey, m: Material): void;
  wall: { normal: MeshStandardMaterial; hover: MeshStandardMaterial; selected: MeshStandardMaterial };
  ghost: { valid: MeshBasicMaterial; invalid: MeshBasicMaterial; warn: MeshBasicMaterial };
  overlay: MeshBasicMaterial;
  masonry: { map: Texture; normal: Texture };
}

export function createMaterials(): MaterialSet {
  const masonry = createMasonryTextures();

  const clay = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  patchHandmade(clay, { key: 'k-clay', grain: 0.22, grainScale: 2.6, bump: 0.55 });

  const metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.55 });
  patchHandmade(metal, { key: 'k-metal', grain: 0.18, grainScale: 6, bump: 0.25 });

  const makeStone = (key: string, hl: number) => {
    const m = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      map: masonry.map,
      normalMap: masonry.normal,
      normalScale: new Vector2(0.9, 0.9),
    });
    patchHandmade(m, { key, grain: 0.12, grainScale: 0.9, bump: 0.3, hl });
    return m;
  };
  const stone = makeStone('k-stone', 0);
  const wall = { normal: makeStone('k-wall', 0), hover: makeStone('k-wall', 0.4), selected: makeStone('k-wall', 1) };

  const cloth = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: DoubleSide });
  patchHandmade(cloth, { key: 'k-cloth', grain: 0.1, grainScale: 9, bump: 0.15, cloth: true });

  const windowMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  patchHandmade(windowMat, { key: 'k-window', grain: 0.1, grainScale: 4, bump: 0.1, lamp: { day: 0, night: 2.4, dayDiffuse: 0.22 } });

  const lantern = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: DoubleSide });
  patchHandmade(lantern, { key: 'k-lantern', grain: 0.12, grainScale: 5, bump: 0.2, lamp: { day: 0.06, night: 2.6, dayDiffuse: 1 } });

  const flame = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  flame.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float kPh = 0.0;
        #ifdef USE_INSTANCING
          kPh = dot(instanceMatrix[3].xyz, vec3(1.7, 0.3, 2.3));
        #endif
        float kF = 1.0 + 0.16 * sin(uTime * 13.0 + kPh) + 0.09 * sin(uTime * 23.7 + kPh * 2.1);
        float kTop = smoothstep(0.0, 1.0, position.y / 0.2);
        transformed.y *= kF;
        transformed.x += sin(uTime * 5.3 + kPh) * 0.02 * kTop;
        transformed.z += cos(uTime * 4.1 + kPh) * 0.02 * kTop;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(2.2, 5.5, uNight);');
  };
  flame.customProgramCacheKey = () => 'k-flame';

  // Camera-facing additive halo. Geometry: quads whose `aCenter` is the halo centre (asset space) and
  // whose position.xy is the corner offset (already sized).
  const glow = new ShaderMaterial({
    uniforms: { uTime: shared.uTime, uNight: shared.uNight, uColor: { value: new Color(1.0, 0.62, 0.26) } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFlick;
      void main() {
        vec4 c = vec4(aCenter, 1.0);
        float s = 1.0;
        #ifdef USE_INSTANCING
          c = instanceMatrix * c;
          s = length(instanceMatrix[0].xyz);
        #endif
        vec4 mv = modelViewMatrix * c;
        float ph = dot(c.xyz, vec3(1.3, 0.7, 2.1));
        vFlick = 0.86 + 0.09 * sin(uTime * 9.0 + ph) + 0.05 * sin(uTime * 17.0 + ph * 1.9);
        mv.xy += position.xy * s * vFlick;
        mv.z += 0.15 * s; // pull slightly toward camera so it isn't buried in the bowl
        gl_Position = projectionMatrix * mv;
        vUv = uv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uNight;
      varying vec2 vUv;
      varying float vFlick;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.4);
        float core = pow(max(0.0, 1.0 - d * 2.2), 3.0);
        float k = mix(0.08, 1.0, uNight) * vFlick;
        gl_FragColor = vec4(uColor * (a * 1.4 + core * 2.0) * k, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    // Add colour, leave alpha alone (so halos never punch dark squares into transparent targets).
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    toneMapped: false,
  });

  const rangoli = (kind: 'lotus' | 'star') => {
    const m = new MeshStandardMaterial({
      map: createRangoliTexture(kind),
      transparent: true,
      alphaTest: 0.2,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    return m;
  };
  const rangoliLotus = rangoli('lotus');
  const rangoliStar = rangoli('star');

  const table: Partial<Record<MaterialKey, Material>> = {
    clay, stone, cloth, flame, glow, metal,
    window: windowMat,
    lantern,
    rangoli_lotus: rangoliLotus,
    rangoli_star: rangoliStar,
  };

  const ghostMat = (c: number) =>
    new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.42, depthWrite: false });
  return {
    get: (k) => table[k] ?? clay,
    register: (k, m) => { table[k] = m; },
    wall,
    ghost: { valid: ghostMat(0x7be36a), invalid: ghostMat(0xff4a3a), warn: ghostMat(0xffc04a) },
    overlay: new MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }),
    masonry,
  };
}
