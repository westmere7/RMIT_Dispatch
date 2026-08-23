import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronRight } from './Icons';

export type MenuItem =
  | {
      kind: 'item';
      label: string;
      hint?: string;
      icon?: ReactNode;
      /** CSS colour: renders a swatch dot at the end of the row. */
      swatch?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      kind: 'check';
      label: string;
      checked: boolean;
      hint?: string;
      /** CSS colour: renders a swatch dot at the end of the row. */
      swatch?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: 'submenu'; label: string; icon?: ReactNode; disabled?: boolean; items: MenuItem[] }
  | { kind: 'header'; label: string; sub?: string }
  | { kind: 'note'; label: string }
  | { kind: 'separator' };

const MENU_W = 232;
/** Grace period so the pointer can travel from a row into its submenu. */
const CLOSE_GRACE_MS = 140;
/**
 * Hover intent before an already-open submenu is replaced by another
 * row's. Without it, a diagonal move from a row towards its own submenu
 * clips the rows below and swaps the panel out from under the pointer.
 */
const SWITCH_DELAY_MS = 220;

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

interface OpenSub {
  index: number;
  left: number;
  top: number;
}

/**
 * One menu panel. The open submenu is tracked here rather than by each
 * row, so a single state means two siblings can never be open at once —
 * dragging the pointer down a list of submenu rows replaces the open
 * panel instead of stacking overlapping ones.
 */
function Panel({
  items,
  onClose,
  depth = 0,
}: {
  items: MenuItem[];
  onClose: () => void;
  depth?: number;
}) {
  const [open, setOpen] = useState<OpenSub | null>(null);
  const openRef = useRef<OpenSub | null>(null);
  openRef.current = open;

  /** One pending timer for both closing and switching submenus. */
  const timer = useRef<number | null>(null);
  const cancelPending = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const after = (ms: number, fn: () => void) => {
    cancelPending();
    timer.current = window.setTimeout(fn, ms);
  };
  const scheduleClose = () => after(CLOSE_GRACE_MS, () => setOpen(null));
  useEffect(() => cancelPending, []);

  /** Hovering any non-submenu row retires the open submenu. */
  const leaveToPlainRow = () => scheduleClose();

  const geometry = (index: number, el: HTMLElement): OpenSub => {
    const r = el.getBoundingClientRect();
    return { index, left: r.right - 4, top: r.top - 5 };
  };

  const openAt = (index: number, el: HTMLElement | null) => {
    if (!el) return;
    cancelPending();
    setOpen(geometry(index, el));
  };

  /**
   * Open on hover, but only replace a *different* open submenu after a
   * hover-intent delay: the pointer usually reaches a submenu by cutting
   * across the rows beneath its own row, and swapping instantly would
   * unmount the panel it is heading for. Only one submenu is ever open,
   * so waiting cannot produce overlapping panels.
   */
  const hoverOpen = (index: number, el: HTMLElement) => {
    const current = openRef.current;
    if (current?.index === index) {
      cancelPending();
      return;
    }
    if (!current) {
      openAt(index, el);
      return;
    }
    const next = geometry(index, el);
    after(SWITCH_DELAY_MS, () => setOpen(next));
  };

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
          const isOpen = open?.index === i;
          return (
            <button
              key={i}
              className={`ctx-row ${it.disabled ? 'disabled' : ''} ${isOpen ? 'open' : ''}`}
              disabled={it.disabled}
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={isOpen}
              onMouseEnter={(e) => !it.disabled && hoverOpen(i, e.currentTarget)}
              onMouseLeave={scheduleClose}
              onClick={(e) => {
                if (it.disabled) return;
                if (isOpen) setOpen(null);
                else openAt(i, e.currentTarget);
              }}
            >
              {it.icon && <span className="ctx-icon">{it.icon}</span>}
              <span className="ctx-label">{it.label}</span>
              <IconChevronRight size={13} />
            </button>
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
            onMouseEnter={leaveToPlainRow}
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
            {it.swatch && <span className="ctx-swatch" style={{ background: it.swatch }} />}
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        );
      })}

      {open &&
        (() => {
          const item = items[open.index];
          if (!item || item.kind !== 'submenu') return null;
          return createPortal(
            <FloatingPanel
              left={open.left}
              top={open.top}
              onMouseEnter={cancelPending}
              onMouseLeave={scheduleClose}
            >
              <Panel items={item.items} onClose={onClose} depth={depth + 1} />
            </FloatingPanel>,
            document.body,
          );
        })()}
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
