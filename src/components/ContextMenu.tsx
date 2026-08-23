import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconChevronRight } from './Icons';

export type MenuItem =
  | {
      kind: 'item';
      label: string;
      hint?: string;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      kind: 'check';
      label: string;
      checked: boolean;
      hint?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: 'submenu'; label: string; icon?: ReactNode; disabled?: boolean; items: MenuItem[] }
  | { kind: 'header'; label: string; sub?: string }
  | { kind: 'note'; label: string }
  | { kind: 'separator' };

const MENU_W = 232;

/** One menu panel; submenus recurse. */
function Panel({
  items,
  onClose,
  depth = 0,
}: {
  items: MenuItem[];
  onClose: () => void;
  depth?: number;
}) {
  const [openSub, setOpenSub] = useState<number | null>(null);

  return (
    <div className="ctx-panel" style={{ minWidth: MENU_W }} role="menu">
      {items.map((it, i) => {
        if (it.kind === 'separator') return <hr key={i} className="ctx-sep" />;
        if (it.kind === 'header') {
          return (
            <div key={i} className="ctx-header">
              <span className="ctx-header-label">{it.label}</span>
              {it.sub && <span className="ctx-header-sub">{it.sub}</span>}
            </div>
          );
        }
        if (it.kind === 'note') {
          return (
            <div key={i} className="ctx-note">
              {it.label}
            </div>
          );
        }
        if (it.kind === 'submenu') {
          const open = openSub === i;
          return (
            <div
              key={i}
              className="ctx-row-wrap"
              onMouseEnter={() => setOpenSub(i)}
              onMouseLeave={() => setOpenSub((c) => (c === i ? null : c))}
            >
              <button
                className={`ctx-row ${it.disabled ? 'disabled' : ''}`}
                disabled={it.disabled}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={open}
              >
                {it.icon && <span className="ctx-icon">{it.icon}</span>}
                <span className="ctx-label">{it.label}</span>
                <IconChevronRight size={13} />
              </button>
              {open && !it.disabled && (
                <div className="ctx-sub" style={{ left: MENU_W - 6 }}>
                  <Panel items={it.items} onClose={onClose} depth={depth + 1} />
                </div>
              )}
            </div>
          );
        }
        const checked = it.kind === 'check' && it.checked;
        return (
          <button
            key={i}
            className={`ctx-row ${it.disabled ? 'disabled' : ''} ${
              it.kind === 'item' && it.danger ? 'danger' : ''
            }`}
            disabled={it.disabled}
            role="menuitem"
            onClick={() => {
              if (it.disabled) return;
              it.onSelect();
              onClose();
            }}
          >
            {it.kind === 'check' ? (
              <span className="ctx-icon">{checked ? <IconCheck size={13} /> : null}</span>
            ) : (
              it.icon && <span className="ctx-icon">{it.icon}</span>
            )}
            <span className="ctx-label">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Right-click menu anchored at viewport coordinates, clamped on screen. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6));
    const top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6));
    setPos({ left, top });
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture so the canvas' own Escape handler doesn't also fire.
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-root"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Panel items={items} onClose={onClose} />
    </div>
  );
}
