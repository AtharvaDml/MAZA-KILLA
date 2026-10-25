import { Color, DirectionalLight, Fog, Group, HemisphereLight, Scene, Vector3 } from 'three';
import type { TimePreset } from '../../state/store';
import { LAMP_COUNT, shared } from '../render/shared';
import type { Environment } from '../env/Environment';
import { DEG } from '../util/math';

interface Preset {
  sunAz: number;
  sunEl: number;
  sunColor: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  disc: number;
  discSize: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  night: number;
  stars: number;
  bloom: number;
}

export const TIME_PRESETS: Record<TimePreset, Preset & { label: string }> = {
  morning: {
    label: 'Morning', sunAz: 118, sunEl: 17, sunColor: 0xffd7aa, sunI: 2.7, hemiSky: 0xbcd4ec, hemiGround: 0x7a644a, hemiI: 1.55,
    skyTop: 0x6c9fd4, skyHorizon: 0xf2d8bd, skyBottom: 0x9a9a80, disc: 0xffd9aa, discSize: 0.0018,
    fog: 0xdad3c4, fogNear: 180, fogFar: 1500, night: 0, stars: 0, bloom: 0.35,
  },
  afternoon: {
    label: 'Afternoon', sunAz: 22, sunEl: 55, sunColor: 0xfff3e2, sunI: 3.1, hemiSky: 0xc6dcf0, hemiGround: 0x806c52, hemiI: 1.65,
    skyTop: 0x4b8ad2, skyHorizon: 0xcfe0ec, skyBottom: 0xa0a48c, disc: 0xfff6e8, discSize: 0.0015,
    fog: 0xcad6dd, fogNear: 220, fogFar: 1700, night: 0, stars: 0, bloom: 0.3,
  },
  golden: {
    label: 'Golden Hour', sunAz: 78, sunEl: 9, sunColor: 0xffae62, sunI: 2.9, hemiSky: 0xcdbcae, hemiGround: 0x6a5038, hemiI: 1.3,
    skyTop: 0x5a82bd, skyHorizon: 0xffc183, skyBottom: 0x8a7a60, disc: 0xffc078, discSize: 0.0022,
    fog: 0xe2bc92, fogNear: 160, fogFar: 1400, night: 0.05, stars: 0, bloom: 0.45,
  },
  sunset: {
    label: 'Diwali Sunset', sunAz: 212, sunEl: 4, sunColor: 0xff8a45, sunI: 2.7, hemiSky: 0xb08ab0, hemiGround: 0x5a3c2c, hemiI: 1.25,
    skyTop: 0x34407e, skyHorizon: 0xff9a5c, skyBottom: 0x6a4a50, disc: 0xffa060, discSize: 0.0032,
    fog: 0xd8957a, fogNear: 220, fogFar: 1300, night: 0.5, stars: 0.15, bloom: 0.75,
  },
  night: {
    label: 'Night', sunAz: 70, sunEl: 38, sunColor: 0x9db2e2, sunI: 0.42, hemiSky: 0x33456e, hemiGround: 0x1a140f, hemiI: 0.85,
    skyTop: 0x060c1c, skyHorizon: 0x1d2843, skyBottom: 0x0c1016, disc: 0xdfe6ff, discSize: 0.0009,
    fog: 0x131b31, fogNear: 160, fogFar: 1000, night: 1, stars: 1, bloom: 1.05,
  },
};

interface State {
  sunDir: Vector3;
  sunColor: Color;
  sunI: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
  skyTop: Color;
  skyHorizon: Color;
  skyBottom: Color;
  disc: Color;
  discSize: number;
  fog: Color;
  fogNear: number;
  fogFar: number;
  night: number;
  stars: number;
  bloom: number;
}

function toState(p: Preset): State {
  const az = p.sunAz * DEG, el = p.sunEl * DEG;
  return {
    sunDir: new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize(),
    sunColor: new Color(p.sunColor), sunI: p.sunI,
    hemiSky: new Color(p.hemiSky), hemiGround: new Color(p.hemiGround), hemiI: p.hemiI,
    skyTop: new Color(p.skyTop), skyHorizon: new Color(p.skyHorizon), skyBottom: new Color(p.skyBottom),
    disc: new Color(p.disc), discSize: p.discSize,
    fog: new Color(p.fog), fogNear: p.fogNear, fogFar: p.fogFar,
    night: p.night, stars: p.stars, bloom: p.bloom,
  };
}

function lerpState(a: State, b: State, t: number, out: State) {
  out.sunDir.copy(a.sunDir).lerp(b.sunDir, t).normalize();
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.skyTop.copy(a.skyTop).lerp(b.skyTop, t);
  out.skyHorizon.copy(a.skyHorizon).lerp(b.skyHorizon, t);
  out.skyBottom.copy(a.skyBottom).lerp(b.skyBottom, t);
  out.disc.copy(a.disc).lerp(b.disc, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  for (const k of ['sunI', 'hemiI', 'discSize', 'fogNear', 'fogFar', 'night', 'stars', 'bloom'] as const) out[k] = a[k] + (b[k] - a[k]) * t;
}

const cloneState = (s: State): State => {
  const o = toState(TIME_PRESETS.afternoon);
  lerpState(s, s, 0, o);
  return o;
};

/** Curated lighting states with smooth transitions (no 24h simulation). */
export class Lighting {
  readonly group = new Group();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: Fog;
  private from: State;
  private to: State;
  readonly state: State;
  private t = 1;
  private readonly duration = 2.4;
  private plotHalf = 96;
  /** Set true for one frame whenever the sun moved (shadow map must refresh). */
  sunMoved = true;

  constructor(scene: Scene, private readonly env: Environment, preset: TimePreset) {
    this.group.name = 'lighting';
    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.group.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xffffff, 0x444444, 1);
    this.group.add(this.hemi);
    this.fog = new Fog(0xcad6dd, 200, 1600);
    scene.fog = this.fog;
    this.state = toState(TIME_PRESETS[preset]);
    this.from = cloneState(this.state);
    this.to = cloneState(this.state);
    this.apply();
  }

  setPlot(half: number) {
    this.plotHalf = half;
    const c = this.sun.shadow.camera;
    const e = half * 1.18;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e;
    c.near = 1; c.far = 900;
    c.updateProjectionMatrix();
    this.sunMoved = true;
  }

  setShadowSize(px: number) {
    if (this.sun.shadow.mapSize.x === px) return;
    this.sun.shadow.mapSize.set(px, px);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sunMoved = true;
  }

  setPreset(p: TimePreset, instant = false) {
    this.from = cloneState(this.state);
    this.to = toState(TIME_PRESETS[p]);
    this.t = instant ? 1 : 0;
    if (instant) lerpState(this.to, this.to, 0, this.state);
    this.apply();
  }

  get transitioning() {
    return this.t < 1;
  }

  update(dt: number) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    const e = this.t < 0.5 ? 4 * this.t ** 3 : 1 - (-2 * this.t + 2) ** 3 / 2;
    lerpState(this.from, this.to, e, this.state);
    this.apply();
  }

  private apply() {
    const s = this.state;
    this.sun.position.copy(s.sunDir).multiplyScalar(400);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunI;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiI;
    this.fog.color.copy(s.fog);
    this.fog.near = s.fogNear;
    this.fog.far = s.fogFar;
    shared.uNight.value = s.night;
    this.env.setSky({ top: s.skyTop, horizon: s.skyHorizon, bottom: s.skyBottom, sunDir: s.sunDir, sunColor: s.disc, sunSize: s.discSize, stars: s.stars });
    this.sunMoved = true;
  }

  /** Point the shader lamp pool at the densest clusters of diyas and torches. */
  setLampClusters(points: { p: Vector3; intensity: number }[]) {
    const cell = 20;
    const buckets = new Map<string, { x: number; y: number; z: number; w: number }>();
    for (const { p, intensity } of points) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      const b = buckets.get(key) ?? { x: 0, y: 0, z: 0, w: 0 };
      b.x += p.x * intensity; b.y += p.y * intensity; b.z += p.z * intensity; b.w += intensity;
      buckets.set(key, b);
    }
    const list = [...buckets.values()].sort((a, b) => b.w - a.w);
    for (let i = 0; i < LAMP_COUNT; i++) {
      const b = list[i];
      const pos = shared.uLampPos.value[i], col = shared.uLampCol.value[i];
      if (!b) { pos.set(0, -1000, 0, 0.001); col.set(0, 0, 0); continue; }
      // A soft warm wash, not floodlighting: the diyas themselves should be the stars.
      const k = Math.min(1.5, 0.35 + b.w * 0.09);
      pos.set(b.x / b.w, b.y / b.w + 1.2, b.z / b.w, Math.min(24, 9 + Math.sqrt(b.w) * 2.6));
      col.set(1.0 * k, 0.56 * k, 0.22 * k);
    }
  }

  get bloom() {
    return this.state.bloom;
  }

  get halfExtent() {
    return this.plotHalf;
  }
}
