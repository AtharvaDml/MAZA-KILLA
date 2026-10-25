import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  log?: boolean;
}) {
  const { label, value, min, max, step = 0.01, format, onChange, log } = props;
  const toT = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t: number) => (log ? min * Math.pow(max / min, t) : min + t * (max - min));
  const t = Math.min(1, Math.max(0, toT(value)));
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="slider-val">{format ? format(value) : value.toFixed(step >= 1 ? 0 : 2)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(t * 1000)}
        style={{ ['--t' as string]: `${t * 100}%` }}
        onChange={(e) => {
          let v = fromT(Number(e.target.value) / 1000);
          if (step) v = Math.round(v / step) * step;
          onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className={`seg ${props.small ? 'seg-sm' : ''}`} role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'on' : ''}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button className={`toggle ${props.value ? 'on' : ''}`} role="switch" aria-checked={props.value} onClick={() => props.onChange(!props.value)} title={props.hint}>
      <span className="toggle-track"><span className="toggle-dot" /></span>
      <span className="toggle-label">{props.label}</span>
    </button>
  );
}

export function IconButton(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  showLabel?: boolean;
  kbd?: string;
  className?: string;
}) {
  return (
    <button
      className={`ibtn ${props.active ? 'on' : ''} ${props.showLabel ? 'ibtn-label' : ''} ${props.className ?? ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      data-tip={props.showLabel ? undefined : props.kbd ? `${props.label} · ${props.kbd}` : props.label}
    >
      {props.icon}
      {props.showLabel && <span>{props.label}</span>}
    </button>
  );
}

/** Click-outside popover anchored under its trigger. */
export function Popover(props: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' | 'center' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', h);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('pointerdown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="pop-wrap" ref={ref}>
      {props.trigger(open, () => setOpen((o) => !o))}
      {open && <div className={`pop pop-${props.align ?? 'right'}`}>{props.children(() => setOpen(false))}</div>}
    </div>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)} d ago`;
  return new Date(ts).toLocaleDateString();
}
