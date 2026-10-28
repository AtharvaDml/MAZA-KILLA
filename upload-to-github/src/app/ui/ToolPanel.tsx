import { getEditor, setEditor, useEditor, type Battlement, type SculptMode, type StoneStyle, type WaterKind } from '../../state/store';
import { WATER_COLORS, WATER_PRESETS } from '../../engine/water/waterData';
import { assetsForCategory } from '../../engine/objects/catalog';
import { LAYERS } from '../../engine/terrain/layers';
import { eng } from '../engine';
import { Segmented, Slider, Toggle } from './controls';
import { I } from './icons';
import { CATEGORIES } from './Toolbar';

const SCULPT: { id: SculptMode; label: string; icon: JSX.Element; hint: string }[] = [
  { id: 'raise', label: 'Raise', icon: <I.Raise />, hint: 'Pull the earth up into hills' },
  { id: 'lower', label: 'Lower', icon: <I.Lower />, hint: 'Dig trenches, moats and hollows' },
  { id: 'smooth', label: 'Smooth', icon: <I.Smooth />, hint: 'Soften harsh shapes (hold Shift anytime)' },
  { id: 'flatten', label: 'Flatten', icon: <I.Flatten />, hint: 'Level ground to where you first pressed' },
  { id: 'slope', label: 'Slope', icon: <I.Slope />, hint: 'Drag from low to high to make a ramp' },
  { id: 'roughen', label: 'Roughen', icon: <I.Roughen />, hint: 'Add rocky, uneven detail' },
  { id: 'erode', label: 'Erode', icon: <I.Erode />, hint: 'Weather slopes into natural scree' },
];

function SculptPanel() {
  const s = useEditor((st) => st.sculpt);
  const set = (p: Partial<typeof s>) => setEditor({ sculpt: { ...getEditor().sculpt, ...p } });
  const cur = SCULPT.find((m) => m.id === s.mode)!;
  return (
    <>
      <div className="mode-grid">
        {SCULPT.map((m) => (
          <button key={m.id} className={`mode-btn ${s.mode === m.id ? 'on' : ''}`} onClick={() => set({ mode: m.id })} data-tip={m.hint}>
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="panel-hint">{cur.hint}</p>
      <Slider label="Brush size" value={s.size} min={1.5} max={60} step={0.5} log format={(v) => v.toFixed(1)} onChange={(size) => set({ size })} />
      <Slider label="Strength" value={s.strength} min={0.05} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(strength) => set({ strength })} />
      <Slider label="Falloff" value={s.falloff} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(falloff) => set({ falloff })} />
      <div className="kbd-row"><kbd>Shift</kbd> smooth <kbd>Ctrl</kbd> invert <kbd>[</kbd><kbd>]</kbd> size</div>
    </>
  );
}

function PaintPanel() {
  const s = useEditor((st) => st.paint);
  const swatches = useEditor((st) => st.swatches);
  const set = (p: Partial<typeof s>) => setEditor({ paint: { ...getEditor().paint, ...p } });
  return (
    <>
      <div className="swatch-grid">
        {LAYERS.map((l, i) => (
          <button key={l.id} className={`swatch ${s.layer === i ? 'on' : ''}`} onClick={() => set({ layer: i })}>
            <span className="swatch-img" style={{ backgroundImage: swatches[i] ? `url(${swatches[i]})` : undefined }} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      <Slider label="Brush size" value={s.size} min={1} max={50} step={0.5} log format={(v) => v.toFixed(1)} onChange={(size) => set({ size })} />
      <Slider label="Strength" value={s.strength} min={0.05} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(strength) => set({ strength })} />
      <Slider label="Falloff" value={s.falloff} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(falloff) => set({ falloff })} />
      <Toggle label="Rock on steep slopes" value={s.autoCliff} onChange={(autoCliff) => set({ autoCliff })} hint="Cliffs turn to rock automatically" />
    </>
  );
}

function WallPanel() {
  const w = useEditor((st) => st.wall);
  const set = (p: Partial<typeof w>) => setEditor({ wall: { ...getEditor().wall, ...p } });
  return (
    <>
      <p className="panel-hint">
        {w.drawing
          ? `${w.points} point${w.points === 1 ? '' : 's'} · double-click or Enter to finish · click the first point (or C) to close the loop · Backspace removes the last point`
          : 'Click to drop points, or press and drag to sketch a curve. Walls follow the hills by themselves.'}
      </p>
      <Slider label="Height" value={w.height} min={2} max={20} step={0.5} format={(v) => v.toFixed(1)} onChange={(height) => set({ height })} />
      <Slider label="Thickness" value={w.thickness} min={1.2} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={(thickness) => set({ thickness })} />
      <div className="field">
        <span className="field-label">Battlements</span>
        <Segmented<Battlement> value={w.battlement} onChange={(battlement) => set({ battlement })}
          options={[{ value: 'kangoore', label: 'Kangoore' }, { value: 'square', label: 'Square' }, { value: 'none', label: 'None' }]} />
      </div>
      <div className="field">
        <span className="field-label">Stone</span>
        <Segmented<StoneStyle> value={w.stone} onChange={(stone) => set({ stone })}
          options={[{ value: 'laterite', label: 'Laterite' }, { value: 'basalt', label: 'Basalt' }, { value: 'weathered', label: 'Weathered' }]} />
      </div>
      <div className="field">
        <span className="field-label">Path</span>
        <Segmented<'smooth' | 'straight'> value={w.smooth ? 'smooth' : 'straight'} onChange={(v) => set({ smooth: v === 'smooth' })}
          options={[{ value: 'smooth', label: 'Curved' }, { value: 'straight', label: 'Straight' }]} />
      </div>
      <div className="soon">
        <I.Sparkle size={16} />
        <span>Next build: gates that cut openings, buruj that snap to walls, and stone steps &amp; paths.</span>
      </div>
    </>
  );
}

function AssetPanel({ cat }: { cat: NonNullable<ReturnType<typeof getEditor>['category']> }) {
  const assets = assetsForCategory(cat);
  const thumbs = useEditor((st) => st.thumbs);
  const place = useEditor((st) => st.place);
  const tool = useEditor((st) => st.tool);
  const set = (p: Partial<typeof place>) => setEditor({ place: { ...getEditor().place, ...p } });
  const current = assets.find((a) => a.id === place.assetId);
  const canScatter = !!current?.scatter;
  return (
    <>
      <div className="asset-grid">
        {assets.map((a) => (
          <button
            key={a.id}
            className={`asset ${place.assetId === a.id && tool === 'place' ? 'on' : ''}`}
            onClick={() => {
              const s = getEditor();
              const same = s.place.assetId === a.id && s.tool === 'place';
              setEditor({ place: { ...s.place, assetId: same ? null : a.id }, tool: same ? 'select' : 'place' });
            }}
          >
            <span className="asset-img">{thumbs[a.id] ? <img src={thumbs[a.id]} alt="" draggable={false} /> : <span className="asset-ph" />}</span>
            <span className="asset-name">{a.name}</span>
          </button>
        ))}
      </div>
      {tool === 'place' && current ? (
        <>
          <p className="panel-hint">
            {canScatter && place.scatter ? 'Paint to plant. Hold Ctrl to clear.' : 'Click to place. Keep clicking to place more.'}
          </p>
          {canScatter && (
            <>
              <Toggle label="Scatter brush" value={place.scatter} onChange={(scatter) => set({ scatter })} hint="Paint many at once" />
              {place.scatter && (
                <>
                  <Slider label="Brush size" value={place.brush} min={1.5} max={40} step={0.5} log format={(v) => v.toFixed(1)} onChange={(brush) => set({ brush })} />
                  <Slider label="Density" value={place.density} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(density) => set({ density })} />
                </>
              )}
            </>
          )}
          <Toggle label="Random rotation" value={place.randomRotate} onChange={(randomRotate) => set({ randomRotate })} />
          <Toggle label="Size variation" value={place.randomScale} onChange={(randomScale) => set({ randomScale })} />
          <Toggle label="Strict placement" value={place.strict} onChange={(strict) => set({ strict })} hint="Refuse overlapping placements" />
          <Toggle label="Grid snap · G" value={place.gridSnap} onChange={(gridSnap) => set({ gridSnap })} />
          {place.gridSnap && (
            <Segmented<number> small value={place.gridSize} onChange={(gridSize) => set({ gridSize })}
              options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 4, label: '4' }, { value: 8, label: '8' }]} />
          )}
          <div className="kbd-row"><kbd>Q</kbd><kbd>E</kbd> rotate <kbd>Shift</kbd>+wheel rotate <kbd>Esc</kbd> done</div>
        </>
      ) : (
        <p className="panel-hint">Pick something to place.</p>
      )}
    </>
  );
}

const WATER_ICONS: Record<WaterKind, JSX.Element> = {
  pond: <I.Pond />, lake: <I.Lake />, tank: <I.Tank />, moat: <I.Moat />, river: <I.River />, stream: <I.Stream />, waterfall: <I.Waterfall />,
};

export const waterSwatchCss = (i: number) => {
  const c = WATER_COLORS[i];
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  return `linear-gradient(135deg, ${hex(c.shallow)} 0%, ${hex(c.deep)} 100%)`;
};

function WaterPanel() {
  const w = useEditor((st) => st.water);
  const tool = useEditor((st) => st.tool);
  const set = (p: Partial<typeof w>) => setEditor({ water: { ...getEditor().water, ...p } });
  const pick = (kind: WaterKind) => {
    const pr = WATER_PRESETS[kind];
    setEditor({
      tool: 'water',
      place: { ...getEditor().place, assetId: null },
      water: { ...getEditor().water, kind, depth: pr.depth, width: pr.width, shore: pr.shore, flow: pr.flow, color: pr.color },
    });
  };
  const pr = WATER_PRESETS[w.kind];
  const drawing = tool === 'water';
  return (
    <>
      <div className="mode-grid">
        {(Object.keys(WATER_PRESETS) as WaterKind[]).map((k) => (
          <button key={k} className={`mode-btn ${w.kind === k && drawing ? 'on' : ''}`} onClick={() => pick(k)} data-tip={WATER_PRESETS[k].hint}>
            {WATER_ICONS[k]}
            <span>{WATER_PRESETS[k].label}</span>
          </button>
        ))}
      </div>
      {drawing && (
        <>
          <p className="panel-hint">
            {w.drawing
              ? pr.mode === 'area'
                ? `${w.points} point${w.points === 1 ? '' : 's'} · click the first point, double-click or Enter to fill it · Backspace removes a point`
                : `${w.points} point${w.points === 1 ? '' : 's'} · double-click or Enter to finish · click the first point (or C) to close a ring`
              : pr.hint + (pr.mode === 'area' ? '. Press and drag to sketch freely.' : '. Steep drops turn into falls with mist.')}
          </p>
          <Slider label="Depth" value={w.depth} min={0.3} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={(depth) => set({ depth })} />
          {pr.mode === 'flow' && <Slider label="Width" value={w.width} min={1} max={24} step={0.2} format={(v) => v.toFixed(1)} onChange={(width) => set({ width })} />}
          <Slider label="Shore softness" value={w.shore} min={0.3} max={10} step={0.1} format={(v) => v.toFixed(1)} onChange={(shore) => set({ shore })} />
          {pr.mode === 'flow' && w.kind !== 'moat' && <Slider label="Flow speed" value={w.flow} min={0} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(flow) => set({ flow })} />}
          <div className="field">
            <span className="field-label">Water colour</span>
            <div className="variants">
              {WATER_COLORS.map((c, i) => (
                <button key={c.name} className={`variant ${w.color === i ? 'on' : ''}`} style={{ background: waterSwatchCss(i) }} onClick={() => set({ color: i })} data-tip={c.name} aria-label={c.name} />
              ))}
            </div>
          </div>
          <Slider label="Clarity" value={w.clarity} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(clarity) => set({ clarity })} />
          <Slider label="Reflection" value={w.reflect} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(reflect) => set({ reflect })} />
          <Toggle label="Dig the bed into the ground" value={w.carve} onChange={(carve) => set({ carve })} hint="Carves a basin or channel so the water sits naturally" />
        </>
      )}
      <div className="panel-gap" />
      <div className="field-label">Wells &amp; fountains</div>
      <AssetPanel cat="water" />
    </>
  );
}

export function ToolPanel() {
  const category = useEditor((s) => s.category);
  const terrainTab = useEditor((s) => s.terrainTab);
  if (!category) return null;
  const meta = CATEGORIES.find((c) => c.id === category)!;
  return (
    <aside className="toolpanel panel" aria-label={`${meta.label} tools`}>
      <div className="panel-head">
        <span className="panel-icon">{meta.icon}</span>
        <h2>{category === 'walls' ? 'Fort Walls' : meta.label}</h2>
        <button className="panel-close" onClick={() => eng().selectCategory(null)} aria-label="Close"><I.Close size={16} /></button>
      </div>
      {category === 'terrain' && (
        <>
          <Segmented<'sculpt' | 'paint'>
            value={terrainTab}
            onChange={(t) => setEditor({ terrainTab: t, tool: t })}
            options={[{ value: 'sculpt', label: <><I.Terrain size={16} /> Sculpt</> }, { value: 'paint', label: <><I.Brush size={16} /> Paint</> }]}
          />
          <div className="panel-gap" />
          {terrainTab === 'sculpt' ? <SculptPanel /> : <PaintPanel />}
        </>
      )}
      {category === 'walls' && <WallPanel />}
      {category === 'water' && <WaterPanel />}
      {!['terrain', 'walls', 'water'].includes(category) && <AssetPanel cat={category} />}
    </aside>
  );
}
