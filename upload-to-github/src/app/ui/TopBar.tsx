import { useEffect, useRef, useState } from 'react';
import { setEditor, useEditor, type CameraPreset, type Quality, type TimePreset } from '../../state/store';
import { eng } from '../engine';
import { I } from './icons';
import { IconButton, Popover, Segmented, Toggle, timeAgo } from './controls';

const TIMES: { id: TimePreset; label: string; icon: JSX.Element }[] = [
  { id: 'morning', label: 'Morning', icon: <I.Sunrise /> },
  { id: 'afternoon', label: 'Afternoon', icon: <I.Sun /> },
  { id: 'golden', label: 'Golden Hour', icon: <I.Golden /> },
  { id: 'sunset', label: 'Diwali Sunset', icon: <I.Sunset /> },
  { id: 'night', label: 'Night', icon: <I.Moon /> },
];

const CAMS: { id: CameraPreset; label: string; hint: string }[] = [
  { id: 'iso', label: 'Isometric', hint: 'Classic three-quarter view' },
  { id: 'top', label: 'Top', hint: 'Straight down, like a map' },
  { id: 'ground', label: 'Ground', hint: 'Eye level with the Mavlas' },
  { id: 'cinematic', label: 'Cinematic', hint: 'A slow orbit — touch to stop' },
];

function KillaName() {
  const name = useEditor((s) => s.killa.name);
  const id = useEditor((s) => s.killa.id);
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(name), [name]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) void eng().renameKilla(id, draft);
    else setDraft(name);
  };
  return editing ? (
    <input
      ref={ref}
      className="killa-name-input"
      value={draft}
      maxLength={60}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false); } e.stopPropagation(); }}
    />
  ) : (
    <button className="killa-name" onClick={() => setEditing(true)} data-tip="Rename">
      {name}
      <I.Edit size={14} />
    </button>
  );
}

function SaveStatus() {
  const st = useEditor((s) => s.saveState);
  const at = useEditor((s) => s.lastSavedAt);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 20000); return () => clearInterval(t); }, []);
  const text = st === 'saving' ? 'Saving…' : st === 'dirty' ? 'Unsaved' : st === 'error' ? 'Not saved' : at ? `Saved ${timeAgo(at)}` : 'Saved';
  return (
    <button className={`save-btn save-${st}`} onClick={() => void eng().saveNow()} data-tip="Save now · Ctrl+S">
      {st === 'saved' ? <I.Check size={16} /> : <I.Save size={16} />}
      <span>{text}</span>
    </button>
  );
}

export function TopBar() {
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undoLabel = useEditor((s) => s.undoLabel);
  const redoLabel = useEditor((s) => s.redoLabel);
  const time = useEditor((s) => s.time);
  const quality = useEditor((s) => s.quality);
  const showInfo = useEditor((s) => s.showInfo);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="tb-left panel">
        <div className="brand" title="Majha Killa">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M15 4v22" stroke="#e8d3b0" strokeWidth="1.8" />
            <path d="M16 5c4 1 7 2 11 2-3 1-5 2-6 3 2 1 4 2 6 2-4 1-7 2-11 2z" fill="#f39a2b" />
            <path d="M3 28h26v-6h-3v2h-2.5v-2h-3v2H18v-2h-4v2h-2.5v-2h-3v2H6v-2H3z" fill="#b8542c" />
          </svg>
          <span className="brand-mr">माझा किल्ला</span>
        </div>
        <span className="tb-sep" />
        <KillaName />
      </div>

      <div className="tb-center panel">
        <IconButton icon={<I.Undo />} label={canUndo ? `Undo ${undoLabel}` : 'Nothing to undo'} kbd="Ctrl+Z" disabled={!canUndo} onClick={() => eng().undo()} />
        <IconButton icon={<I.Redo />} label={canRedo ? `Redo ${redoLabel}` : 'Nothing to redo'} kbd="Ctrl+Shift+Z" disabled={!canRedo} onClick={() => eng().redo()} />
        <span className="tb-sep" />
        <SaveStatus />
      </div>

      <div className="tb-right panel">
        <Popover
          align="right"
          trigger={(open, toggle) => <IconButton icon={<I.Camera />} label="Camera views" active={open} onClick={toggle} />}
        >
          {(close) => (
            <div className="menu">
              <div className="menu-title">Camera</div>
              {CAMS.map((c) => (
                <button key={c.id} className="menu-item" onClick={() => { eng().cameraPreset(c.id); close(); }}>
                  <span>{c.label}</span>
                  <small>{c.hint}</small>
                </button>
              ))}
              <div className="menu-foot">Drag to orbit · Right-drag to pan · Scroll to zoom · WASD to travel</div>
            </div>
          )}
        </Popover>

        <div className="time-seg" role="radiogroup" aria-label="Time of day">
          {TIMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={time === t.id} className={time === t.id ? 'on' : ''} onClick={() => eng().setTime(t.id)} data-tip={`${t.label} · N`}>
              {t.icon}
            </button>
          ))}
        </div>

        <span className="tb-sep" />
        <IconButton icon={<I.Killas />} label="My Killas" showLabel onClick={() => { void eng().refreshLibrary(); setEditor({ libraryOpen: true }); }} />

        <Popover
          align="right"
          trigger={(open, toggle) => <IconButton icon={<I.Share />} label="Share" showLabel active={open} onClick={toggle} className="ibtn-accent" />}
        >
          {(close) => (
            <div className="menu">
              <div className="menu-title">Share your Killa</div>
              <button className="menu-item" onClick={() => { void eng().screenshot(); close(); }}>
                <span><I.Image size={16} /> Download image</span>
                <small>A clean PNG of the current view</small>
              </button>
              <button className="menu-item" onClick={() => { void eng().exportKilla(); close(); }}>
                <span><I.Download size={16} /> Export .killa file</span>
                <small>Send it to a friend — they can import it</small>
              </button>
              <button className="menu-item" onClick={() => { fileRef.current?.click(); close(); }}>
                <span><I.Upload size={16} /> Import .killa file</span>
                <small>Opens as a new Killa in your library</small>
              </button>
              <div className="menu-foot">Share links with a view-only mode arrive in Phase 5.</div>
            </div>
          )}
        </Popover>
        <input ref={fileRef} type="file" accept=".killa,application/octet-stream" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void eng().importKilla(f);
          e.target.value = '';
        }} />

        <Popover
          align="right"
          trigger={(open, toggle) => <IconButton icon={<I.Settings />} label="Settings" active={open} onClick={toggle} />}
        >
          {() => (
            <div className="menu menu-pad">
              <div className="menu-title">Graphics quality</div>
              <Segmented<Quality>
                value={quality}
                options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
                onChange={(q) => eng().applyQuality(q, true)}
              />
              <div className="menu-gap" />
              <Toggle label="Show little history notes" value={showInfo} onChange={(v) => setEditor({ showInfo: v })} />
            </div>
          )}
        </Popover>
        <IconButton icon={<I.Help />} label="Controls & shortcuts" kbd="?" onClick={() => setEditor({ helpOpen: true })} />
      </div>
    </header>
  );
}
