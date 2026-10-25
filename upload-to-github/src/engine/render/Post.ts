import { HalfFloatType, type Camera, type Scene, type WebGLRenderer } from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, FXAAEffect, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';

/**
 * Merged post stack:
 *   scene (HDR) → [bloom + ACES]  or  [ACES]  → [vignette (+ FXAA)] → screen
 * Bloom has a luminance threshold above 1.0, so only lamps and flames glow — and it only runs when
 * there is something to glow (golden hour → night). Anti-aliasing is MSAA on High, FXAA on Medium.
 */
export class Post {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  private readonly withBloom: EffectPass;
  private readonly noBloom: EffectPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, msaa: number) {
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: msaa });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      resolutionScale: 0.5,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.3,
      intensity: 0.6,
      radius: 0.72,
    });
    this.withBloom = new EffectPass(camera, this.bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    this.noBloom = new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    this.noBloom.enabled = false;
    this.composer.addPass(this.withBloom);
    this.composer.addPass(this.noBloom);
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.composer.addPass(msaa === 0 ? new EffectPass(camera, new FXAAEffect(), vignette) : new EffectPass(camera, vignette));
  }

  setBloomActive(on: boolean) {
    if (this.withBloom.enabled === on) return;
    this.withBloom.enabled = on;
    this.noBloom.enabled = !on;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h, false);
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
