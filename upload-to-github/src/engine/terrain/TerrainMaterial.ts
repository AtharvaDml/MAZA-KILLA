import { Color, DataArrayTexture, DataTexture, MeshStandardMaterial, Texture, Vector2, Vector3 } from 'three';
import { GLSL_GROUND, GLSL_PERTURB } from '../render/glsl';
import { getNoiseTexture } from '../render/noiseTexture';
import { shared } from '../render/shared';
import { LAYERS, LAYER_COUNT, ROCK_LAYER } from './layers';

export interface TerrainUniforms {
  uLayers: { value: DataArrayTexture };
  uSplat0: { value: Texture | null };
  uSplat1: { value: Texture | null };
  uSplat2: { value: Texture | null };
  uGlowMap: { value: Texture | null };
  uNoise: { value: Texture };
  uLayerTile: { value: number[] };
  uLayerRough: { value: number[] };
  uLayerAvg: { value: Vector3[] };
  uPlotHalf: { value: number };
  uAutoCliff: { value: number };
  uBump: { value: number };
  uBrushOn: { value: number };
  uBrushPos: { value: Vector2 };
  uBrushRadius: { value: number };
  uBrushHard: { value: number };
  uBrushColor: { value: Color };
  uShowBounds: { value: number };
  uGrid: { value: number };
}

/**
 * The terrain surface: PBR standard material extended with height-blended splat layers,
 * auto-cliff rock, derivative bump, lamp glow map and an in-shader brush cursor.
 * `ground: true` builds the variant used for the land around the plot (procedural weights).
 */
export function createTerrainMaterial(
  layers: DataArrayTexture,
  opts: { ground?: boolean; splats?: DataTexture[]; glow?: DataTexture; plotHalf: number; avg: [number, number, number][] },
): MeshStandardMaterial & { userData: { k: TerrainUniforms } } {
  const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff }) as MeshStandardMaterial & {
    userData: { k: TerrainUniforms };
  };
  const u: TerrainUniforms = {
    uLayers: { value: layers },
    uSplat0: { value: opts.splats?.[0] ?? null },
    uSplat1: { value: opts.splats?.[1] ?? null },
    uSplat2: { value: opts.splats?.[2] ?? null },
    uGlowMap: { value: opts.glow ?? null },
    uNoise: { value: getNoiseTexture() },
    uLayerTile: { value: LAYERS.map((l) => l.tile) },
    uLayerRough: { value: LAYERS.map((l) => l.rough) },
    uLayerAvg: { value: opts.avg.map((a) => new Vector3(...a)) },
    uPlotHalf: { value: opts.plotHalf },
    uAutoCliff: { value: 1 },
    uBump: { value: 1.1 },
    uBrushOn: { value: 0 },
    uBrushPos: { value: new Vector2() },
    uBrushRadius: { value: 10 },
    uBrushHard: { value: 0.3 },
    uBrushColor: { value: new Color(1.0, 0.86, 0.62) },
    uShowBounds: { value: 1 },
    uGrid: { value: 0 },
  };
  mat.userData.k = u;
  const ground = !!opts.ground;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uNight: shared.uNight, uGlowColor: shared.uGlowColor });
    if (ground) shader.defines = { ...(shader.defines ?? {}), K_GROUND: '' };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vKWorld;\nvarying vec3 vKNormal;`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vKWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vKNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vKWorld;
        varying vec3 vKNormal;
        uniform highp sampler2DArray uLayers;
        uniform sampler2D uSplat0; uniform sampler2D uSplat1; uniform sampler2D uSplat2;
        uniform sampler2D uGlowMap;
        uniform sampler2D uNoise;
        uniform float uLayerTile[${LAYER_COUNT}];
        uniform float uLayerRough[${LAYER_COUNT}];
        uniform vec3 uLayerAvg[${LAYER_COUNT}];
        uniform float uPlotHalf, uAutoCliff, uBump, uNight;
        uniform float uBrushOn, uBrushRadius, uBrushHard, uShowBounds, uGrid;
        uniform vec2 uBrushPos;
        uniform vec3 uBrushColor, uGlowColor;
        ${GLSL_PERTURB}
        ${GLSL_GROUND}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        float kw[${LAYER_COUNT}];
        for (int i = 0; i < ${LAYER_COUNT}; i++) kw[i] = 0.0;
        float kEdgeD = 1000.0;
        vec2 kSuv = vec2(0.0);
        #ifdef K_GROUND
          { float gS, gG, gD; kGroundWeights(vKWorld.xz, gS, gG, gD); kw[0] = gS; kw[3] = gG; kw[4] = gD; }
        #else
          kSuv = (vKWorld.xz + uPlotHalf) / (2.0 * uPlotHalf);
          vec4 s0 = texture2D(uSplat0, kSuv), s1 = texture2D(uSplat1, kSuv), s2 = texture2D(uSplat2, kSuv);
          kw[0] = s0.r; kw[1] = s0.g; kw[2] = s0.b; kw[3] = s0.a;
          kw[4] = s1.r; kw[5] = s1.g; kw[6] = s1.b; kw[7] = s1.a; kw[8] = s2.r;
          kEdgeD = uPlotHalf - max(abs(vKWorld.x), abs(vKWorld.z));
          float kEdge = smoothstep(0.0, 5.0, kEdgeD);
          if (kEdge < 1.0) {
            float gS, gG, gD; kGroundWeights(vKWorld.xz, gS, gG, gD);
            for (int i = 0; i < ${LAYER_COUNT}; i++) kw[i] *= kEdge;
            kw[0] += gS * (1.0 - kEdge); kw[3] += gG * (1.0 - kEdge); kw[4] += gD * (1.0 - kEdge);
          }
        #endif
        vec3 kN = normalize(vKNormal);
        float kSlope = 1.0 - clamp(kN.y, 0.0, 1.0);
        float kCliff = smoothstep(0.36, 0.6, kSlope + (texture2D(uNoise, vKWorld.xz / 21.0).b - 0.5) * 0.16) * uAutoCliff;
        for (int i = 0; i < ${LAYER_COUNT}; i++) kw[i] *= (1.0 - kCliff);
        kw[${ROCK_LAYER}] += kCliff;

        vec2 kDx = dFdx(vKWorld.xz), kDy = dFdy(vKWorld.xz);
        mat2 kRot = mat2(0.8, -0.6, 0.6, 0.8);
        vec4 kS[${LAYER_COUNT}];
        float kMax = -1.0;
        for (int i = 0; i < ${LAYER_COUNT}; i++) {
          kS[i] = vec4(0.0);
          if (kw[i] > 0.004) {
            float t = uLayerTile[i];
            if (i == ${ROCK_LAYER}) {
              vec3 bw = pow(abs(kN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
              vec3 dpx = dFdx(vKWorld) / t, dpy = dFdy(vKWorld) / t;
              kS[i] = textureGrad(uLayers, vec3(vKWorld.zy / t, float(i)), dpx.zy, dpy.zy) * bw.x
                    + textureGrad(uLayers, vec3(vKWorld.xz / t, float(i)), dpx.xz, dpy.xz) * bw.y
                    + textureGrad(uLayers, vec3(vKWorld.xy / t, float(i)), dpx.xy, dpy.xy) * bw.z;
            } else {
              // Two scales, the second rotated, so the tile period never reads as a grid.
              vec4 a = textureGrad(uLayers, vec3(vKWorld.xz / t, float(i)), kDx / t, kDy / t);
              float t2 = t * 3.7;
              vec2 r = kRot * vKWorld.xz;
              vec4 b = textureGrad(uLayers, vec3(r / t2 + 0.37, float(i)), (kRot * kDx) / t2, (kRot * kDy) / t2);
              kS[i] = vec4(a.rgb * mix(vec3(1.0), b.rgb / max(vec3(0.05), uLayerAvg[i]), 0.42), mix(a.a, b.a, 0.35));
            }
            kMax = max(kMax, kw[i] + kS[i].a * 0.6);
          }
        }
        float kSum = 0.0, kR = 0.0, kH = 0.0;
        vec3 kAlb = vec3(0.0);
        for (int i = 0; i < ${LAYER_COUNT}; i++) {
          if (kw[i] > 0.004) {
            float b = max(kw[i] + kS[i].a * 0.6 - kMax + 0.22, 0.0);
            kSum += b; kAlb += kS[i].rgb * b; kR += uLayerRough[i] * b; kH += kS[i].a * b;
          }
        }
        float kInv = 1.0 / max(kSum, 1e-4);
        kAlb *= kInv; kR *= kInv; kH *= kInv;
        // World-space variation (the layer textures are deliberately uniform at large scales).
        vec4 kN1 = texture2D(uNoise, vKWorld.xz / 150.0);
        vec4 kN2 = texture2D(uNoise, vKWorld.xz / 37.0 + 0.5);
        float kMacro = kN1.a * 0.6 + kN2.g * 0.4;
        kAlb *= 0.82 + 0.36 * kMacro;
        // sun-dried, yellowing patches and a little hue drift
        kAlb = mix(kAlb, kAlb * vec3(1.12, 1.02, 0.74), smoothstep(0.5, 0.78, kN1.r) * 0.55);
        kAlb = mix(kAlb, kAlb * vec3(0.9, 1.0, 1.06), smoothstep(0.55, 0.8, kN2.r) * 0.35);
        diffuseColor.rgb *= kAlb;
        `,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = kR;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float kBumpFade = 1.0 - smoothstep(50.0, 260.0, length(vViewPosition));
        normal = kPerturbNormal(-vViewPosition, normal, vec2(dFdx(kH), dFdy(kH)) * uBump * kBumpFade, faceDirection);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#ifndef K_GROUND
          float kGlow = texture2D(uGlowMap, kSuv).r;
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uGlowColor * kGlow * kGlow * uNight * 2.4;
        #endif
        #include <aomap_fragment>`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#ifndef K_GROUND
        {
          float kLine = 1.0 - smoothstep(0.0, fwidth(kEdgeD) * 1.5 + 0.02, abs(kEdgeD - 0.4));
          outgoingLight = mix(outgoingLight, vec3(1.0, 0.88, 0.66) * mix(0.9, 0.25, uNight), kLine * 0.4 * uShowBounds);
          if (uGrid > 0.0) {
            vec2 gq = vKWorld.xz / uGrid;
            vec2 gl = abs(fract(gq - 0.5) - 0.5) / fwidth(gq);
            float line = 1.0 - min(min(gl.x, gl.y), 1.0);
            outgoingLight = mix(outgoingLight, vec3(1.0, 0.95, 0.85), line * 0.16);
          }
          if (uBrushOn > 0.5) {
            float d = distance(vKWorld.xz, uBrushPos);
            float aa = fwidth(d) * 1.2 + 1e-4;
            float ring = 1.0 - smoothstep(aa * 0.6, aa * 1.9, abs(d - uBrushRadius));
            float inner = (1.0 - smoothstep(aa * 0.3, aa * 1.1, abs(d - uBrushRadius * uBrushHard))) * 0.45;
            float fill = (1.0 - smoothstep(uBrushRadius * 0.97, uBrushRadius, d)) * 0.07;
            outgoingLight = mix(outgoingLight, uBrushColor, clamp(ring * 0.9 + inner * 0.6 + fill, 0.0, 1.0));
          }
        }
        #endif
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => (ground ? 'k-ground' : 'k-terrain');
  return mat;
}
