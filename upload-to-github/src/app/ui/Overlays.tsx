import { useEffect, useState } from 'react';
import { getEditor, setEditor, useEditor } from '../../state/store';
import { eng } from '../engine';
import { I } from './icons';

interface RadialItem { label: string; icon: JSX.Element; run: () => void; danger?: boolean }

export function RadialMenu() {
  const r = useEditor((s) => s.radial);
  if (!r) return null;
  const close = () => setEditor({ radial: null });
  const e = eng();
  let items: RadialItem[];
  if (r.kind === 'terrain') {
    items = [
      { label: 'Build', icon: <I.Walls />, run: () => e.selectCategory('walls') },
      { label: 'Sculpt', icon: <I.Terrain />, run: () => { setEditor({ terrainTab: 'sculpt' }); e.selectCategory('terrain'); } },
      { label: 'Paint', icon: <I.Brush />, run: () => { setEditor({ terrainTab: 'paint' }); e.selectCategory('terrain'); } },
      { label: 'Decorate', icon: <I.Diya />, run: () => e.selectCategory('diwali') },
      { label: 'Plant', icon: <I.Tree />, run: () => e.selectCategory('nature') },
    ];
  } else {
    items = [
      { label: 'Move', icon: <I.Move />, run: () => setEditor({ transformMode: 'move', tool: 'select', category: null }) },
      { label: 'Rotate', icon: <I.Rotate />, run: () => setEditor({ transformMode: 'rotate', tool: 'select', category: null }) },
      { label: 'Copy', icon: <I.Copy />, run: () => e.duplicateSelection() },
      ...(r.kind === 'wall' ? [{ label: 'Diyas', icon: <I.Diya />, run: () => e.addDiyasAlongWall() }] : []),
      { label: 'Customise', icon: <I.Settings />, run: () => setEditor({ tool: 'select', category: null }) },
      { label: 'Delete', icon: <I.Trash />, run: () => e.deleteSelection(), danger: true },
    ];
  }
  const R = 78;
  return (
    <div className="radial-catch" onPointerDown={close} onContextMenu={(ev) => { ev.preventDefault(); close(); }}>
      <div className="radial" style={{ left: r.x, top: r.y }} onPointerDown={(ev) => ev.stopPropagation()}>
        <div className="radial-ring" />
        {items.map((it, i) => {
          const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
          return (
            <button key={it.label} className={`radial-item ${it.danger ? 'danger' : ''}`} style={{ transform: `translate(${Math.cos(a) * R}px, ${Math.sin(a) * R}px)`, animationDelay: `${i * 18}ms` }}
              onClick={() => { it.run(); close(); }}>
              {it.icon}
              <span>{it.label}</span>
            </button>
          );
        })}
        <button className="radial-center" onClick={close} aria-label="Close"><I.Close size={14} /></button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

export function StatusBar() {
  const n = useEditor((s) => s.objectCount);
  const fps = useEditor((s) => s.fps);
  const pct = Math.min(1, n / 4000);
  return (
    <div className="statusbar">
      <div className="meter" data-tip={n > 4000 ? 'Your Killa is getting complex' : 'Objects in this Killa'}>
        <span>{n.toLocaleString()} objects</span>
        <span className="meter-bar"><span style={{ width: `${pct * 100}%`, background: pct > 0.85 ? 'var(--warn)' : undefined }} /></span>
      </div>
      <span className="fps">{fps} fps</span>
    </div>
  );
}

/** A single gentle nudge on an untouched plot (full guided onboarding lands in Phase 6). */
export function FirstHint() {
  const canUndo = useEditor((s) => s.canUndo);
  const objects = useEditor((s) => s.objectCount);
  const category = useEditor((s) => s.category);
  const ready = useEditor((s) => s.ready);
  const killa = useEditor((s) => s.killa.id);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    // Only for plots that are still flat soil when opened.
    const t = setTimeout(() => {
      try { setFresh(eng().walls.count === 0 && eng().objects.count === 0 && !getEditor().canUndo && eng().terrain.heights.every((h) => h === 0)); } catch { setFresh(false); }
    }, 50);
    return () => clearTimeout(t);
  }, [killa, ready]);
  if (!ready || !fresh || canUndo || objects > 0 || category || dismissed === killa) return null;
  return (
    <div className="first-hint panel">
      <div>
        <strong>This land is yours.</strong>
        <span>Start the way every Killa starts — pull the earth up into a hill.</span>
      </div>
      <button className="act act-accent" onClick={() => { setEditor({ terrainTab: 'sculpt', sculpt: { ...getEditor().sculpt, mode: 'raise', size: 22, strength: 0.6 } }); eng().selectCategory('terrain'); }}>
        <I.Raise size={16} /> Raise a hill
      </button>
      <button className="panel-close" onClick={() => setDismissed(killa)} aria-label="Dismiss"><I.Close size={14} /></button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Left-drag (empty ground)', 'Orbit the camera'],
  ['Right-drag', 'Pan'],
  ['Scroll / pinch', 'Zoom toward the cursor'],
  ['Middle-drag · Alt+drag', 'Orbit, even while a tool is active'],
  ['W A S D · arrows', 'Travel (Shift = faster)'],
  ['Right-click', 'Radial menu'],
  ['1 – 9 · 0', 'Tool categories · Select'],
  ['Click · Shift+click', 'Select · add to selection'],
  ['Drag a selected item', 'Move / rotate / scale (by mode)'],
  ['M · R · T', 'Move · Rotate · Scale mode'],
  ['Q / E', 'Rotate selection or ghost (Shift = fine)'],
  ['Alt+drag item', 'Drag a copy'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Delete selection / wall point'],
  ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · Redo'],
  ['Ctrl+S', 'Save now (it also autosaves)'],
  ['[ · ]', 'Brush size'],
  ['Shift / Ctrl while sculpting', 'Smooth / invert'],
  ['G', 'Grid snap on/off'],
  ['F', 'Focus the selection'],
  ['N', 'Next time of day'],
  ['Esc', 'Cancel · back to Select'],
];

export function HelpModal() {
  const open = useEditor((s) => s.helpOpen);
  if (!open) return null;
  return (
    <div className="modal-back" onPointerDown={() => setEditor({ helpOpen: false })}>
      <div className="modal panel help" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Controls">
        <div className="panel-head">
          <I.Keyboard size={20} />
          <h2>Controls</h2>
          <button className="panel-close" onClick={() => setEditor({ helpOpen: false })} aria-label="Close"><I.Close size={16} /></button>
        </div>
        <div className="help-grid">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="help-row"><kbd>{k}</kbd><span>{v}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Loading() {
  const ready = useEditor((s) => s.ready);
  const text = useEditor((s) => s.loading);
  const p = useEditor((s) => s.loadingProgress);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 1100);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div className={`loading ${ready ? 'out' : ''}`}>
      <div className="loading-inner">
        <svg className="loading-flag" width="64" height="64" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M15 4v24" stroke="#e8d3b0" strokeWidth="1.2" />
          <path className="flag-cloth" d="M16 5c4 1 7 2 11 2-3 1-5 2-6 3 2 1 4 2 6 2-4 1-7 2-11 2z" fill="#f39a2b" />
        </svg>
        <h1 className="loading-title">माझा किल्ला</h1>
        <p className="loading-sub">Majha Killa · build the Diwali Killa you remember</p>
        <div className="loading-bar"><span style={{ width: `${Math.round(p * 100)}%` }} /></div>
        <p className="loading-text">{text}</p>
      </div>
    </div>
  );
}
