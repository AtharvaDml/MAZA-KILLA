import { Color, DoubleSide, NormalBlending, ShaderMaterial, Texture, Vector3 } from 'three';
import { LAMP_COUNT, shared } from '../render/shared';
import { getNoiseTexture } from '../render/noiseTexture';

/** Uniform objects owned by other systems that every water surface reads. */
export interface WaterEnv {
  uHeight: { value: Texture | null };
  uGlow: { value: Texture | null };
  uPlotHalf: { value: number };
  uRes: { value: number };
  uTop: { value: unknown };
  uHorizon: { value: unknown };
  uSunDir: { value: unknown };
  uSunColor: { value: unknown };
}

const VERT = /* glsl */ `
attribute vec2 aFlow;
attribute float aDist;
attribute float aFall;
attribute float aLane;
varying vec3 vW;
varying vec2 vFlow;
varying float vDist;
varying float vFall;
varying float vLane;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 w = modelMatrix * p;
  vW = w.xyz;
  vFlow = aFlow;
  vDist = aDist;
  vFall = aFall;
  vLane = aLane;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime, uNight, uPlotHalf, uRes, uFixed, uClarity, uReflect, uHL;
uniform highp sampler2D uHeight;
uniform sampler2D uGlow;
uniform sampler2D uNoise;
uniform vec3 uShallow, uDeep, uTop, uHorizon, uSunDir, uSunColor, uHLColor;
uniform vec4 uLampPos[${LAMP_COUNT}];
uniform vec3 uLampCol[${LAMP_COUNT}];
varying vec3 vW;
varying vec2 vFlow;
varying float vDist;
varying float vFall;
varying float vLane;
#include <common>
#include <fog_pars_fragment>

float terrainH(vec2 xz) {
  vec2 g = (xz + uPlotHalf) / (2.0 * uPlotHalf) * (uRes - 1.0);
  if (g.x < 0.0 || g.y < 0.0 || g.x > uRes - 1.0 || g.y > uRes - 1.0) return 0.0;
  ivec2 i = min(ivec2(floor(g)), ivec2(int(uRes) - 2));
  vec2 f = g - vec2(i);
  float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r, d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float hN(vec2 uv) { return texture2D(uNoise, uv).g; }
vec2 gradN(vec2 uv, float e) {
  return vec2(hN(uv + vec2(e, 0.0)) - hN(uv - vec2(e, 0.0)), hN(uv + vec2(0.0, e)) - hN(uv - vec2(0.0, e))) / (2.0 * e);
}

void main() {
  float depth = uFixed > 0.0 ? uFixed : vW.y - terrainH(vW.xz);
  if (depth < -0.05) discard;
  float speed = length(vFlow);
  vec2 dir = speed > 1e-3 ? vFlow / speed : vec2(0.7071, 0.7071);
  float t = uTime;
  vec2 uv1 = vW.xz / 9.0 - dir * t * (0.012 + speed * 0.09);
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vW.xz / 4.1 - dir * t * (0.008 + speed * 0.14);
  vec2 g = gradN(uv1, 0.004) * 0.024 + gradN(uv2, 0.004) * 0.016;
  float rough = 1.0 + vFall * 2.5;
  vec3 N = normalize(vec3(-g.x * rough, 1.0, -g.y * rough));
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uTop, smoothstep(-0.05, 0.55, R.y));
  vec3 L = normalize(uSunDir);
  vec3 spec = uSunColor * pow(max(dot(R, L), 0.0), mix(320.0, 1100.0, uNight)) * mix(2.6, 1.6, uNight) * step(0.0, L.y);

  // Night: diya / torch clusters glint on the ripples, and the glow map paints warm reflections.
  vec3 warm = vec3(0.0);
  if (uNight > 0.01) {
    for (int i = 0; i < ${LAMP_COUNT}; i++) {
      vec3 Lp = uLampPos[i].xyz - vW;
      float d = length(Lp);
      float r = uLampPos[i].w * 1.8;
      if (d < r) {
        vec3 H = normalize(Lp / d + V);
        spec += uLampCol[i] * pow(max(dot(N, H), 0.0), 140.0) * (1.0 - d / r) * 5.0 * uNight;
      }
    }
    float glow = texture2D(uGlow, (vW.xz + uPlotHalf) / (2.0 * uPlotHalf)).r;
    warm = vec3(1.0, 0.55, 0.22) * glow * glow * uNight * (0.45 + 0.9 * fres + 0.7 * smoothstep(0.45, 0.8, hN(uv2 * 2.7)));
  }

  float dk = smoothstep(0.0, mix(0.8, 3.2, uClarity), depth);
  float lit = mix(1.0, 0.14, uNight) * (0.82 + 0.18 * max(dot(N, L), 0.0));
  vec3 body = mix(uShallow, uDeep * 0.8, dk) * lit;
  vec3 col = mix(body, sky, clamp(fres * uReflect, 0.0, 1.0)) + spec + warm;

  // Foam: a broken line at the shore, and white streaks running down falls.
  vec2 perp = vec2(-dir.y, dir.x);
  float lat = dot(vW.xz, perp);
  float shoreFoam = (1.0 - smoothstep(0.0, 0.12, depth)) * smoothstep(0.5, 0.72, hN(uv1 * 6.0 + t * 0.01)) * 0.5;
  float streak = vFall * smoothstep(0.38, 0.7, texture2D(uNoise, vec2(lat * 0.21, vDist * 0.03 - t * (0.25 + speed * 0.35))).g);
  float foam = clamp(shoreFoam + streak * 0.9 + vFall * 0.12, 0.0, 1.0);
  col = mix(col, vec3(0.95, 0.97, 1.0) * mix(1.0, 0.22, uNight), foam);
  col += uHLColor * uHL * (0.12 + 0.25 * fres);

  float alpha = mix(0.2, 0.9, smoothstep(0.0, mix(0.5, 2.2, uClarity), depth));
  alpha = max(alpha, fres * uReflect * 0.85);
  alpha = max(alpha, vFall * 0.75);
  alpha = max(alpha, foam);
  alpha *= smoothstep(-0.05, 0.07, depth);
  // Ribbon edges only show where they meet a bank, never hanging over lower ground.
  alpha *= 1.0 - smoothstep(0.55, 1.0, vLane) * smoothstep(0.6, 1.6, depth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface WaterLook { shallow: number; deep: number; clarity: number; reflect: number; fixedDepth?: number }

export function createWaterMaterial(env: WaterEnv, look: WaterLook): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uNight: shared.uNight,
      uLampPos: shared.uLampPos,
      uLampCol: shared.uLampCol,
      uHLColor: shared.uHLColor,
      uNoise: { value: getNoiseTexture() },
      uHeight: env.uHeight,
      uGlow: env.uGlow,
      uPlotHalf: env.uPlotHalf,
      uRes: env.uRes,
      uTop: env.uTop,
      uHorizon: env.uHorizon,
      uSunDir: env.uSunDir,
      uSunColor: env.uSunColor,
      uShallow: { value: new Color(look.shallow) },
      uDeep: { value: new Color(look.deep) },
      uClarity: { value: look.clarity },
      uReflect: { value: look.reflect },
      uFixed: { value: look.fixedDepth ?? 0 },
      uHL: { value: 0 },
      fogColor: { value: new Color() },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
      fogDensity: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
    blending: NormalBlending,
  });
}

/** Splash + mist: every particle animates on the GPU from a seed; no CPU work per frame. */
export function createSprayMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: shared.uTime, uNight: shared.uNight, uPx: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute vec2 aKind; // x: 0 splash / 1 mist, y: drop height
      uniform float uTime;
      uniform float uPx;
      varying float vA;
      varying float vMist;
      void main() {
        float mist = aKind.x;
        float rate = mix(1.1, 0.22, mist) * (0.7 + aSeed.x * 0.6);
        float life = fract(uTime * rate + aSeed.y);
        float ang = aSeed.z * 6.2831853;
        float rad = mix(0.4 + aSeed.w * 1.6, 0.8 + aSeed.w * 3.2, mist);
        vec3 p = position;
        if (mist < 0.5) {
          p += vec3(cos(ang) * rad * life, sin(life * 3.14159) * (0.5 + aSeed.w) * min(2.2, aKind.y * 0.3), sin(ang) * rad * life);
        } else {
          p += vec3(cos(ang) * rad * (0.3 + life * 0.7), life * min(6.0, 1.0 + aKind.y * 0.45), sin(ang) * rad * (0.3 + life * 0.7));
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = mix(0.12 + aSeed.x * 0.12, 1.4 + aSeed.w * 1.6, mist);
        gl_PointSize = size * uPx / max(0.5, -mv.z);
        vA = mist < 0.5 ? (1.0 - life) * 0.75 : sin(life * 3.14159) * 0.16;
        vMist = mist;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vA;
      varying float vMist;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float a = vMist > 0.5 ? (1.0 - smoothstep(0.0, 1.0, d)) : (1.0 - smoothstep(0.6, 1.0, d));
        gl_FragColor = vec4(vec3(0.94, 0.97, 1.0) * mix(1.0, 0.3, uNight), a * vA);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export const WATER_UP = new Vector3(0, 1, 0);
