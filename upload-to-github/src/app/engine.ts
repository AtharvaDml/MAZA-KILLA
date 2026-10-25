import { Engine } from '../engine/Engine';

let engine: Engine | null = null;

export function createEngine(container: HTMLElement): Engine {
  if (!engine) {
    engine = new Engine(container);
    if (import.meta.env.DEV) (window as unknown as { __killa: Engine }).__killa = engine;
  }
  return engine;
}

/** The engine instance (only valid once the app has mounted). */
export function eng(): Engine {
  if (!engine) throw new Error('Engine not created yet');
  return engine;
}
