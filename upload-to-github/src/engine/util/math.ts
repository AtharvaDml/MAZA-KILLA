export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
export const DEG = Math.PI / 180;

/** Brush falloff: cosine bell with a hard core. falloff ∈ [0,1] (0 = hard disc, 1 = fully soft). */
export function brushFalloff(rn: number, falloff: number): number {
  if (rn >= 1) return 0;
  const hard = clamp(1 - falloff, 0, 0.95);
  if (rn <= hard) return 1;
  return 0.5 * (1 + Math.cos((Math.PI * (rn - hard)) / (1 - hard)));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
