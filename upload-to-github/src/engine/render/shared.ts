import { Color, Vector3, Vector4 } from 'three';

export const LAMP_COUNT = 6;

/** Uniform objects shared by every patched material, so one write updates the whole world. */
export const shared = {
  uTime: { value: 0 },
  /** 0 = full day, 1 = full night. Drives lamp glow, windows, halos. */
  uNight: { value: 0 },
  uHLColor: { value: new Color(1.0, 0.72, 0.38) },
  uGlowColor: { value: new Color(1.0, 0.55, 0.2) },
  uWind: { value: 1 },
  /** Clustered lamp lights evaluated in our own shaders (xyz = position, w = range). */
  uLampPos: { value: Array.from({ length: LAMP_COUNT }, () => new Vector4(0, -1000, 0, 0.001)) },
  uLampCol: { value: Array.from({ length: LAMP_COUNT }, () => new Vector3()) },
};
