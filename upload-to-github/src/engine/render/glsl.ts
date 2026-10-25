/** Shared GLSL snippets. All identifiers are prefixed with `k` to avoid clashing with three.js chunks. */

export const GLSL_NOISE = /* glsl */ `
float kHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float kNoise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(kHash12(i), kHash12(i + vec2(1.0, 0.0)), u.x),
             mix(kHash12(i + vec2(0.0, 1.0)), kHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float kFbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * kNoise2(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
float kHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float kNoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = kHash13(i), n100 = kHash13(i + vec3(1,0,0)), n010 = kHash13(i + vec3(0,1,0)), n110 = kHash13(i + vec3(1,1,0));
  float n001 = kHash13(i + vec3(0,0,1)), n101 = kHash13(i + vec3(1,0,1)), n011 = kHash13(i + vec3(0,1,1)), n111 = kHash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
`;

export const GLSL_PERTURB = /* glsl */ `
vec3 kPerturbNormal(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

/** Procedural weights for the land around the plot (and the plot's outer rim). Needs `uNoise`. */
export const GLSL_GROUND = /* glsl */ `
void kGroundWeights(vec2 xz, out float wSoil, out float wGrass, out float wDry) {
  float n = texture2D(uNoise, xz / 420.0).r;
  float m = texture2D(uNoise, xz / 96.0 + 0.37).g;
  wDry = smoothstep(0.44, 0.66, n) * 0.8;
  wSoil = smoothstep(0.62, 0.8, m) * 0.5 * (1.0 - wDry);
  wGrass = max(0.0, 1.0 - wDry - wSoil);
}
`;
