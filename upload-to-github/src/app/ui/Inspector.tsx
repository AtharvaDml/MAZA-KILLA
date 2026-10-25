import { useState } from 'react';
import { setEditor, useEditor, type Battlement, type InspectorObject, type InspectorWall, type StoneStyle, type TransformMode } from '../../state/store';
import { eng } from '../engine';
import { Segmented, Slider, Toggle } from './controls';
import { I } from './icons';

function ModeSwitch() {
  const mode = useEditor((s) => s.transformMode);
  return (
    <Segmented<TransformMode>
      value={mode}
      onChange={(m) => setEditor({ transformMode: m })}
      options={[
        { value: 'move', label: <><I.Move size={15} /> Move</>, title: 'Drag to move · M' },
        { value: 'rotate', label: <><I.Rotate size={15} /> Rotate</>, title: 'Drag sideways to rotate · R' },
        { value: 'scale', label: <><I.Scale size={15} /> Scale</>, title: 'Drag up/down to scale · T' },
      ]}
    />
  );
}

function ObjectInspector({ s }: { s: InspectorObject }) {
  const showInfo = useEditor((st) => st.showInfo);
  return (
    <>
      <div className="panel-head">
        <h2>{s.name}</h2>
        {s.count > 1 && <span className="badge">{s.count}</span>}
        <button className="panel-close" onClick={() => eng().setSelection([])} aria-label="Deselect"><I.Close size={16} /></button>
      </div>
      {showInfo && s.info && (
        <div className="note"><I.Info size={16} /><span>{s.info}</span></div>
      )}
      <ModeSwitch />
      <div className="panel-gap" />
      <Slider label="Size" value={s.scale} min={0.2} max={4} step={0.01} log format={(v) => `${v.toFixed(2)}×`} onChange={(scale) => eng().applyInspector({ scale })} />
      <Slider label="Rotation" value={s.rotY} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(rotY) => eng().applyInspector({ rotY })} />
      <Slider label="Lift" value={s.lift} min={-3} max={8} step={0.05} format={(v) => v.toFixed(2)} onChange={(lift) => eng().applyInspector({ lift })} />
      {s.variants.length > 0 && (
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="variants">
            {s.variants.map((v, i) => (
              <button key={v.name} className={`variant ${s.variant === i ? 'on' : ''}`} style={{ background: v.css }} onClick={() => eng().applyInspector({ variant: i })} data-tip={v.name} aria-label={v.name} />
            ))}
          </div>
        </div>
      )}
      <div className="actions">
        <button className="act" onClick={() => eng().duplicateSelection()} data-tip="Ctrl+D · or Alt-drag"><I.Copy size={16} /> Duplicate</button>
        <button className="act" onClick={() => eng().focusSelection()} data-tip="F"><I.Focus size={16} /> Focus</button>
        <button className="act act-danger" onClick={() => eng().deleteSelection()} data-tip="Delete"><I.Trash size={16} /> Delete</button>
      </div>
    </>
  );
}

function WallInspector({ s }: { s: InspectorWall }) {
  const showInfo = useEditor((st) => st.showInfo);
  const [spacing, setSpacing] = useState(3.1);
  const set = (p: Parameters<ReturnType<typeof eng>['applyWallInspector']>[0]) => eng().applyWallInspector(p);
  return (
    <>
      <div className="panel-head">
        <h2>Fort Wall</h2>
        <span className="badge badge-soft">{Math.round(s.length)} m</span>
        <button className="panel-close" onClick={() => eng().setSelection([])} aria-label="Deselect"><I.Close size={16} /></button>
      </div>
      {showInfo && (
        <div className="note"><I.Info size={16} /><span>Rounded merlons (kangoore) crown many Deccan fort walls; the gaps between them let defenders watch and fire.</span></div>
      )}
      <p className="panel-hint">Drag the round handles to reshape. Double-click the wall to add a point; click a handle and press Delete to remove it.</p>
      <Slider label="Height" value={s.height} min={2} max={20} step={0.5} format={(v) => v.toFixed(1)} onChange={(height) => set({ height })} />
      <Slider label="Thickness" value={s.thickness} min={1.2} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={(thickness) => set({ thickness })} />
      <div className="field">
        <span className="field-label">Battlements</span>
        <Segmented<Battlement> value={s.battlement} onChange={(battlement) => set({ battlement })}
          options={[{ value: 'kangoore', label: 'Kangoore' }, { value: 'square', label: 'Square' }, { value: 'none', label: 'None' }]} />
      </div>
      <div className="field">
        <span className="field-label">Stone</span>
        <Segmented<StoneStyle> value={s.stone} onChange={(stone) => set({ stone })}
          options={[{ value: 'laterite', label: 'Laterite' }, { value: 'basalt', label: 'Basalt' }, { value: 'weathered', label: 'Weathered' }]} />
      </div>
      <div className="field">
        <span className="field-label">Path</span>
        <Segmented<'smooth' | 'straight'> value={s.smooth ? 'smooth' : 'straight'} onChange={(v) => set({ smooth: v === 'smooth' })}
          options={[{ value: 'smooth', label: 'Curved' }, { value: 'straight', label: 'Straight' }]} />
      </div>
      <div className="row2">
        {s.points >= 3 && <Toggle label="Closed loop" value={s.closed} onChange={(closed) => set({ closed })} />}
        <Toggle label="Flip outer side" value={s.flip} onChange={(flip) => set({ flip })} hint="Which side the parapet faces" />
      </div>
      <div className="diya-line">
        <Slider label="Diya spacing" value={spacing} min={1.55} max={9.3} step={0.05} format={(v) => `${v.toFixed(1)} m`} onChange={setSpacing} />
        <button className="act act-diwali" onClick={() => eng().addDiyasAlongWall(spacing)}><I.Diya size={16} /> Line the wall with diyas</button>
      </div>
      <div className="actions">
        <button className="act" onClick={() => eng().duplicateSelection()}><I.Copy size={16} /> Duplicate</button>
        <button className="act" onClick={() => eng().focusSelection()}><I.Focus size={16} /> Focus</button>
        <button className="act act-danger" onClick={() => eng().deleteSelection()}><I.Trash size={16} /> Delete</button>
      </div>
    </>
  );
}

export function Inspector() {
  const insp = useEditor((s) => s.inspector);
  if (!insp) return null;
  return (
    <aside className="inspector panel" aria-label="Selection">
      {insp.kind === 'object' ? <ObjectInspector s={insp} /> : <WallInspector s={insp} />}
    </aside>
  );
}
