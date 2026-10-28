import { useState } from 'react';
import { setEditor, useEditor, type Battlement, type InspectorObject, type InspectorWall, type InspectorWater, type StoneStyle, type TransformMode } from '../../state/store';
import { WATER_COLORS, WATER_PRESETS } from '../../engine/water/waterData';
import { waterSwatchCss } from './ToolPanel';
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

function WaterInspector({ s }: { s: InspectorWater }) {
  const showInfo = useEditor((st) => st.showInfo);
  const set = (p: Parameters<ReturnType<typeof eng>['applyWaterInspector']>[0]) => eng().applyWaterInspector(p);
  const pr = WATER_PRESETS[s.waterKind];
  const flow = s.mode === 'flow';
  // Pin the level slider's range when this water is selected so it doesn't drift while dragging.
  const [base] = useState(s.level);
  return (
    <>
      <div className="panel-head">
        <h2>{pr.label}</h2>
        {flow && <span className="badge badge-soft">{Math.round(s.length)} m</span>}
        <button className="panel-close" onClick={() => eng().setSelection([])} aria-label="Deselect"><I.Close size={16} /></button>
      </div>
      {showInfo && s.waterKind === 'moat' && (
        <div className="note"><I.Info size={16} /><span>Ground forts were often ringed by a moat (khandak), so attackers had to cross water under the walls.</span></div>
      )}
      {showInfo && s.waterKind === 'tank' && (
        <div className="note"><I.Info size={16} /><span>Hill forts stored monsoon rain in rock-cut tanks so the garrison had water all year.</span></div>
      )}
      <p className="panel-hint">Drag the round handles to reshape it. Double-click the water to add a point; click a handle and press Delete to remove it.{s.falls ? ` ${s.falls} fall${s.falls > 1 ? 's' : ''} where the ground drops.` : ''}</p>
      {!flow && (
        <>
          <Slider label="Water level" value={s.level} min={base - 6} max={base + 6} step={0.05} format={(v) => v.toFixed(2)} onChange={(level) => set({ level })} />
          {!s.levelAuto && <button className="act" onClick={() => set({ level: null })}>Reset level to the shoreline</button>}
        </>
      )}
      {flow && <Slider label="Width" value={s.width} min={1} max={24} step={0.2} format={(v) => v.toFixed(1)} onChange={(width) => set({ width })} />}
      {flow && s.waterKind !== 'moat' && <Slider label="Flow speed" value={s.flow} min={0} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(f) => set({ flow: f })} />}
      <div className="field">
        <span className="field-label">Water colour</span>
        <div className="variants">
          {WATER_COLORS.map((c, i) => (
            <button key={c.name} className={`variant ${s.color === i ? 'on' : ''}`} style={{ background: waterSwatchCss(i) }} onClick={() => set({ color: i })} data-tip={c.name} aria-label={c.name} />
          ))}
        </div>
      </div>
      <Slider label="Clarity" value={s.clarity} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(clarity) => set({ clarity })} />
      <Slider label="Reflection" value={s.reflect} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(reflect) => set({ reflect })} />
      {flow && s.points >= 3 && <Toggle label="Closed ring" value={s.closed} onChange={(closed) => set({ closed })} />}
      {flow && (
        <button className="act" style={{ width: '100%', marginTop: 8 }} onClick={() => eng().addWaterCrossing()} data-tip="Leaves a land bridge where the camera is looking">
          <I.Walls size={16} /> Add a dry crossing{s.crossings ? ` (${s.crossings})` : ''}
        </button>
      )}
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
      {insp.kind === 'object' ? <ObjectInspector s={insp} /> : insp.kind === 'wall' ? <WallInspector s={insp} /> : <WaterInspector key={insp.id} s={insp} />}
    </aside>
  );
}
