import { Ray, Vector2, Raycaster } from 'three';
import type { Engine } from './Engine';
import type { PointerInfo } from './tools/Tool';
import { getEditor, setEditor } from '../state/store';

type Mode = 'none' | 'tool' | 'orbit' | 'pan' | 'pendingOrbit' | 'pendingPan';
const DRAG_PX = 4;

/**
 * Camera vs. tool arbitration:
 *  • left-drag on empty ground (Select) → orbit; with an active tool → the tool
 *  • middle-drag or Alt+left-drag → orbit, always
 *  • right-drag → pan; right-click without moving → radial menu
 *  • wheel → zoom toward the cursor (tools may claim Shift+wheel)
 */
export class InputRouter {
  private mode: Mode = 'none';
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private pointerId = -1;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  lastPointer: PointerInfo | null = null;

  constructor(private readonly e: Engine, private readonly el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('dblclick', this.onDbl);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.e.rig.clearKeys());
  }

  info(ev: PointerEvent | MouseEvent | WheelEvent): PointerInfo {
    const r = this.el.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    this.ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.e.rig.camera);
    return {
      x, y,
      ray: new Ray().copy(this.raycaster.ray),
      button: 'button' in ev ? ev.button : 0,
      shift: ev.shiftKey,
      ctrl: ev.ctrlKey || ev.metaKey,
      alt: ev.altKey,
    };
  }

  /** Recompute the ray for the last pointer position (camera may have moved). */
  refreshRay(): PointerInfo | null {
    const p = this.lastPointer;
    if (!p) return null;
    const r = this.el.getBoundingClientRect();
    this.ndc.set((p.x / r.width) * 2 - 1, -(p.y / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.e.rig.camera);
    p.ray.copy(this.raycaster.ray);
    return p;
  }

  private onDown = (ev: PointerEvent) => {
    if (this.mode !== 'none') return;
    this.el.focus();
    this.pointerId = ev.pointerId;
    try { this.el.setPointerCapture(ev.pointerId); } catch { /* pointer not active (synthetic) */ }
    const p = this.info(ev);
    this.lastPointer = p;
    this.downX = this.lastX = ev.clientX;
    this.downY = this.lastY = ev.clientY;
    if (getEditor().radial) setEditor({ radial: null });
    const tool = this.e.tool;
    if (ev.button === 1) {
      ev.preventDefault();
      this.startOrbit();
    } else if (ev.button === 2) {
      this.mode = 'pendingPan';
    } else if (ev.button === 0) {
      if (ev.altKey) {
        if (tool.id === 'select' && tool.pointerDown(p)) this.mode = 'tool';
        else this.startOrbit();
      } else if (tool.pointerDown(p)) {
        this.mode = 'tool';
      } else {
        this.mode = 'pendingOrbit';
      }
    }
  };

  private startOrbit() {
    this.mode = 'orbit';
    this.e.rig.beginDrag();
    this.el.style.cursor = 'grabbing';
  }

  private onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - this.lastX, dy = ev.clientY - this.lastY;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    const moved = Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY) > DRAG_PX;
    const p = this.info(ev);
    this.lastPointer = p;
    switch (this.mode) {
      case 'orbit':
        this.e.rig.orbitBy(dx, dy);
        break;
      case 'pan':
        this.e.rig.panBy(dx, dy, this.el.clientHeight);
        break;
      case 'pendingOrbit':
        if (moved) { this.startOrbit(); this.e.rig.orbitBy(ev.clientX - this.downX, ev.clientY - this.downY); }
        break;
      case 'pendingPan':
        if (moved) { this.mode = 'pan'; this.el.style.cursor = 'move'; this.e.rig.panBy(ev.clientX - this.downX, ev.clientY - this.downY, this.el.clientHeight); }
        break;
      case 'tool':
        this.e.tool.pointerMove(p, true);
        break;
      default:
        this.e.tool.pointerMove(p, false);
    }
  };

  private onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== this.pointerId && this.mode !== 'none') return;
    const p = this.info(ev);
    switch (this.mode) {
      case 'pendingOrbit':
        this.e.tool.click(p);
        break;
      case 'pendingPan':
        this.e.openRadial(p);
        break;
      case 'tool':
        this.e.tool.pointerUp(p);
        break;
      case 'orbit':
        this.e.rig.endDrag();
        break;
    }
    this.mode = 'none';
    this.el.style.cursor = this.e.tool.cursor;
    try { this.el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  };

  private onLeave = () => {
    if (this.mode === 'none') this.lastPointer = null;
  };

  private onDbl = (ev: MouseEvent) => {
    if (ev.button !== 0) return;
    this.e.tool.doubleClick(this.info(ev));
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    let dy = ev.deltaY;
    if (ev.deltaMode === 1) dy *= 16;
    else if (ev.deltaMode === 2) dy *= 400;
    if (ev.ctrlKey) dy *= 3; // trackpad pinch arrives as ctrl+wheel with small deltas
    const p = this.info(ev);
    if (this.e.tool.wheel(p, dy)) return;
    const focus = this.e.terrain.raycast(p.ray);
    this.e.rig.zoomBy(dy, focus);
  };

  private typing(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKeyDown = (ev: KeyboardEvent) => {
    if (this.typing(ev)) return;
    if (this.e.handleKey(ev)) {
      ev.preventDefault();
      return;
    }
    if (!ev.ctrlKey && !ev.metaKey && /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Page(Up|Down)|Shift(Left|Right))$/.test(ev.code)) {
      this.e.rig.setKey(ev.code, true);
      if (ev.code.startsWith('Arrow') || ev.code.startsWith('Page')) ev.preventDefault();
    }
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    this.e.rig.setKey(ev.code, false);
  };
}
