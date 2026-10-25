import { useEffect, useRef, useState } from 'react';
import { setEditor, useEditor, type KillaListing, type PlotSizeId } from '../../state/store';
import { PLOT_SIZES } from '../../engine/terrain/Terrain';
import { eng } from '../engine';
import { Segmented, timeAgo } from './controls';
import { I } from './icons';

function Card({ k, current }: { k: KillaListing; current: boolean }) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm'>('idle');
  const [name, setName] = useState(k.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mode === 'rename') inputRef.current?.select(); }, [mode]);
  const open = async () => {
    setEditor({ libraryOpen: false });
    if (!current) await eng().openKilla(k.id);
  };
  return (
    <div className={`kcard ${current ? 'current' : ''}`}>
      <button className="kcard-thumb" onClick={open} aria-label={`Open ${k.name}`}>
        {k.thumbnail ? <img src={k.thumbnail} alt="" draggable={false} /> : <span className="kcard-empty"><I.Fort size={32} /></span>}
        {current && <span className="kcard-tag">Open now</span>}
      </button>
      <div className="kcard-body">
        {mode === 'rename' ? (
          <input
            ref={inputRef}
            className="kcard-input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { void eng().renameKilla(k.id, name); setMode('idle'); }
              if (e.key === 'Escape') { setName(k.name); setMode('idle'); }
            }}
            onBlur={() => { if (name.trim() && name !== k.name) void eng().renameKilla(k.id, name); setMode('idle'); }}
          />
        ) : (
          <div className="kcard-name">{k.name}</div>
        )}
        <div className="kcard-meta">{PLOT_SIZES[k.size]?.label ?? k.size} · {k.objectCount} objects · edited {timeAgo(k.updatedAt)}</div>
        {mode === 'confirm' ? (
          <div className="kcard-actions">
            <span className="kcard-warn">Delete forever?</span>
            <button className="act act-danger" onClick={() => { void eng().deleteKilla(k.id); setMode('idle'); }}>Delete</button>
            <button className="act" onClick={() => setMode('idle')}>Keep</button>
          </div>
        ) : (
          <div className="kcard-actions">
            <button className="act act-accent" onClick={open}>Open</button>
            <button className="ibtn" data-tip="Duplicate" aria-label="Duplicate" onClick={() => void eng().duplicateKilla(k.id)}><I.Copy size={16} /></button>
            <button className="ibtn" data-tip="Rename" aria-label="Rename" onClick={() => setMode('rename')}><I.Edit size={16} /></button>
            <button className="ibtn" data-tip="Delete" aria-label="Delete" onClick={() => setMode('confirm')}><I.Trash size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LibraryModal() {
  const open = useEditor((s) => s.libraryOpen);
  const library = useEditor((s) => s.library);
  const current = useEditor((s) => s.killa.id);
  if (!open) return null;
  return (
    <div className="modal-back" onPointerDown={() => setEditor({ libraryOpen: false })}>
      <div className="modal panel library" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="My Killas">
        <div className="panel-head">
          <I.Killas size={20} />
          <h2>My Killas</h2>
          <span className="badge badge-soft">{library.length}</span>
          <button className="panel-close" onClick={() => setEditor({ libraryOpen: false })} aria-label="Close"><I.Close size={16} /></button>
        </div>
        <div className="kgrid">
          <button className="kcard knew" onClick={() => setEditor({ libraryOpen: false, newOpen: true })}>
            <span className="knew-icon"><I.Plus size={28} /></span>
            <strong>Build a new Killa</strong>
            <span>Start from a fresh patch of soil</span>
          </button>
          {library.map((k) => <Card key={k.id} k={k} current={k.id === current} />)}
        </div>
        <p className="library-foot">Killas are saved in this browser automatically. Use Share → Export to keep a copy or send one to a friend.</p>
      </div>
    </div>
  );
}

export function NewKillaModal() {
  const open = useEditor((s) => s.newOpen);
  const count = useEditor((s) => s.library.length);
  const [name, setName] = useState('');
  const [size, setSize] = useState<PlotSizeId>('medium');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(`Diwali Killa ${new Date().getFullYear()}${count ? ` · ${count + 1}` : ''}`); setBusy(false); } }, [open, count]);
  if (!open) return null;
  const create = async () => {
    setBusy(true);
    await eng().newKilla(name || 'My Killa', size);
    setEditor({ newOpen: false });
  };
  return (
    <div className="modal-back" onPointerDown={() => setEditor({ newOpen: false })}>
      <div className="modal panel newk" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="New Killa">
        <div className="panel-head">
          <I.Plus size={20} />
          <h2>Build a new Killa</h2>
          <button className="panel-close" onClick={() => setEditor({ newOpen: false })} aria-label="Close"><I.Close size={16} /></button>
        </div>
        <label className="field">
          <span className="field-label">Name your Killa</span>
          <input className="text-input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !busy) void create(); }} />
        </label>
        <div className="field">
          <span className="field-label">Starting size</span>
          <Segmented<PlotSizeId>
            value={size}
            onChange={setSize}
            options={(Object.keys(PLOT_SIZES) as PlotSizeId[]).map((k) => ({ value: k, label: <span className="size-opt"><b>{PLOT_SIZES[k].label}</b><small>{PLOT_SIZES[k].size} m</small></span> }))}
          />
        </div>
        <div className="field">
          <span className="field-label">Location</span>
          <div className="loc-row">
            <span className="loc on">Open Ground</span>
            {['Hill', 'Courtyard', 'Riverside', 'Sahyadri Valley'].map((l) => <span key={l} className="loc soon-chip" data-tip="With the world map in Phase 4">{l}</span>)}
          </div>
        </div>
        <button className="act act-accent act-big" disabled={busy} onClick={() => void create()}>
          {busy ? 'Preparing the soil…' : <>Start building <I.Fort size={18} /></>}
        </button>
      </div>
    </div>
  );
}
