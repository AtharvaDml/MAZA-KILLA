import { useEditor, type CategoryId } from '../../state/store';
import { eng } from '../engine';
import { I } from './icons';

export const CATEGORIES: { id: CategoryId; label: string; icon: JSX.Element; key: string }[] = [
  { id: 'terrain', label: 'Terrain', icon: <I.Terrain size={22} />, key: '1' },
  { id: 'walls', label: 'Walls', icon: <I.Walls size={22} />, key: '2' },
  { id: 'fort', label: 'Fort', icon: <I.Fort size={22} />, key: '3' },
  { id: 'buildings', label: 'Buildings', icon: <I.House size={22} />, key: '4' },
  { id: 'nature', label: 'Nature', icon: <I.Tree size={22} />, key: '5' },
  { id: 'water', label: 'Water', icon: <I.Water size={22} />, key: '6' },
  { id: 'people', label: 'People', icon: <I.People size={22} />, key: '7' },
  { id: 'decor', label: 'Decor', icon: <I.Decor size={22} />, key: '8' },
  { id: 'diwali', label: 'Diwali', icon: <I.Diya size={22} />, key: '9' },
];

export function Toolbar() {
  const category = useEditor((s) => s.category);
  const tool = useEditor((s) => s.tool);
  return (
    <nav className="toolbar panel" aria-label="Build tools">
      <button
        className={`tb-tool ${tool === 'select' && !category ? 'on' : ''}`}
        onClick={() => eng().selectCategory(null)}
        data-tip="Select & move · 0 / Esc"
      >
        <I.Cursor size={22} />
        <span>Select</span>
      </button>
      <span className="tb-divider" />
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          className={`tb-tool ${category === c.id ? 'on' : ''} ${c.id === 'diwali' ? 'tb-diwali' : ''}`}
          onClick={() => eng().selectCategory(c.id)}
          data-tip={`${c.label} · ${c.key}`}
        >
          {c.icon}
          <span>{c.label}</span>
        </button>
      ))}
    </nav>
  );
}
