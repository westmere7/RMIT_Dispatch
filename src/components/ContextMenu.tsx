import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
const CLOSE_GRACE_MS = 160;

/**
 * A floating panel positioned in viewport coordinates and clamped on
 * screen. Used for the root menu and, via a portal, for every submenu —
 * portalling is what keeps submenus from being clipped by the root
 * panel's own scroll container.
 */
function FloatingPanel({
  left,
  top,
  children,
  onMouseEnter,
  onMouseLeave,
  panelRef,
}: {
  left: number;
  top: number;
  children: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  panelRef?: React.RefObject<HTMLDivElement>;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? innerRef;
  const [pos, setPos] = useState({ left, top });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(6, Math.min(left, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(top, window.innerHeight - r.height - 6)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, top]);

  return (
    <div
      ref={ref}
      className="ctx-float"
      data-ctx-portal="1"
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

/** A submenu row plus its portalled child panel. */
function SubmenuRow({
  item,
  onClose,
  depth,
}: {
  item: Extract<MenuItem, { kind: 'submenu' }>;
  onClose: () => void;
  depth: number;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | null>(null);

  const cancelClose = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  // A grace period so the pointer can travel from the row to the panel.
  const scheduleClose = () => {
    cancelClose();
    timer.current = window.setTimeout(() => setAnchor(null), CLOSE_GRACE_MS);
  };
  useEffect(() => cancelClose, []);

  const open = () => {
    cancelClose();
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({ left: r.right - 4, top: r.top - 5 });
  };

  return (
    <>
      <button
        ref={rowRef}
        className={`ctx-row ${item.disabled ? 'disabled' : ''} ${anchor ? 'open' : ''}`}
        disabled={item.disabled}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={!!anchor}
        onMouseEnter={() => !item.disabled && open()}
        onMouseLeave={scheduleClose}
        onClick={() => !item.disabled && (anchor ? setAnchor(null) : open())}
      >
        {item.icon && <span className="ctx-icon">{item.icon}</span>}
        <span className="ctx-label">{item.label}</span>
        <IconChevronRight size={13} />
      </button>
      {anchor &&
        !item.disabled &&
        createPortal(
          <FloatingPanel
            left={anchor.left}
            top={anchor.top}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <Panel items={item.items} onClose={onClose} depth={depth + 1} />
          </FloatingPanel>,
          document.body,
        )}
    </>
  );
}

function Panel({
  items,
  onClose,
  depth = 0,
}: {
  items: MenuItem[];
  onClose: () => void;
  depth?: number;
}) {
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
          return <SubmenuRow key={i} item={it} onClose={onClose} depth={depth} />;
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

/** Right-click menu anchored at viewport coordinates. */
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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Submenus live in portals outside this subtree, so test the whole
      // menu family rather than just the root element.
      if (!(e.target as HTMLElement).closest('[data-ctx-portal]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
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
    <FloatingPanel left={x} top={y} panelRef={rootRef}>
      <Panel items={items} onClose={onClose} />
    </FloatingPanel>
  );
}
