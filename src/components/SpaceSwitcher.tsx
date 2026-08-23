import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../store/auth';
import { createSpace, useSpaces } from '../store/spaces';
import { IconCheck, IconChevronDown, IconPlus } from './Icons';

export function SpaceSwitcher() {
  const { spaces, currentSpace, selectSpace, refresh } = useSpaces();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const submit = async () => {
    if (!user || !name.trim()) return;
    const space = await createSpace(name.trim(), user.uid);
    await refresh();
    selectSpace(space.id);
    setName('');
    setCreating(false);
    setOpen(false);
  };

  return (
    <div className="space-switcher" ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        {currentSpace?.name ?? 'No space'}
        <IconChevronDown size={14} />
      </button>
      {open && (
        <div className="space-switcher-menu">
          {spaces.map(({ space }) => (
            <button
              key={space.id}
              className={`menu-item ${space.id === currentSpace?.id ? 'active' : ''}`}
              onClick={() => {
                selectSpace(space.id);
                setOpen(false);
              }}
            >
              <span style={{ flex: 1 }}>{space.name}</span>
              {space.id === currentSpace?.id && <IconCheck size={14} />}
            </button>
          ))}
          {spaces.length > 0 && <hr className="divider" style={{ margin: '4px 0' }} />}
          {creating ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              style={{ display: 'flex', gap: 4, padding: 4 }}
            >
              <input
                className="input"
                autoFocus
                placeholder="Space name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="btn btn-sm btn-primary" type="submit">
                Add
              </button>
            </form>
          ) : (
            <button className="menu-item" onClick={() => setCreating(true)}>
              <IconPlus size={14} />
              New space
            </button>
          )}
        </div>
      )}
    </div>
  );
}
