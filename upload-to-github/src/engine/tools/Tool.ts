import type { Ray } from 'three';
import type { Engine } from '../Engine';
import type { ToolId } from '../../state/store';

export interface PointerInfo {
  /** Canvas-relative pixels. */
  x: number;
  y: number;
  ray: Ray;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** Editor tool. The InputRouter decides whether a gesture goes to the camera or the tool. */
export abstract class Tool {
  abstract readonly id: ToolId;
  cursor = 'default';
  constructor(protected readonly e: Engine) {}
  activate(): void {}
  deactivate(): void {}
  /** Return true to capture the drag; false lets a left-drag orbit the camera. */
  pointerDown(_p: PointerInfo): boolean { return false; }
  pointerMove(_p: PointerInfo, _captured: boolean): void {}
  pointerUp(_p: PointerInfo): void {}
  /** Left click that was not captured and did not become an orbit. */
  click(_p: PointerInfo): void {}
  doubleClick(_p: PointerInfo): void {}
  /** Return true to consume the wheel (otherwise it zooms). */
  wheel(_p: PointerInfo, _dy: number): boolean { return false; }
  /** Return true if handled. */
  key(_e: KeyboardEvent): boolean { return false; }
  /** Escape. Return true if something was cancelled inside the tool. */
  cancel(): boolean { return false; }
  update(_dt: number): void {}
  /** Hide transient visuals for screenshots. */
  hideTransient(): void {}
}
