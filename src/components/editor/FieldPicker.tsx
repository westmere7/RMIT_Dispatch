import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fieldShapeLabel, partitionByFit, type FieldTarget } from '../../lib/fieldtypes';
import type { SyncField } from '../../types';
import { IconSearch } from '../Icons';
import { shortLabel } from './FieldPeek';

/** Short preview of any field shape, for menu rows and tooltips. */
export function fieldPreview(field: SyncField): string {
  return shortLabel(field.value);
}

/**
 * Drop-down list of existing fields for a given target. Grouped by scope
 * then folder so long lists stay navigable, filterable by name, and with
 * type-incompatible fields kept visible but disabled and explained.
 */
export function FieldPicker({
  fields,
  target,
  label,
  icon,
  onPick,
  onCreate,
  createLabel,
  compact,
  align = 'left',
}: {
  fields: SyncField[];
  target: FieldTarget;
  label: string;
  icon?: ReactNode;
  onPick: (field: SyncField) => void;
  onCreate?: () => void;
  createLabel?: string;
  compact?: boolean;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) => f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q),
    );
  }, [fields, query]);

  const { fits, unfit } = partitionByFit(matching, target);

  /** Group the usable fields: global first, then folder within scope. */
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: SyncField[] }[] = [];
    for (const scope of ['global', 'local'] as const) {
      const scoped = fits.filter((f) => (scope === 'global' ? f.scope === 'global' : f.scope !== 'global'));
      const folders = [...new Set(scoped.map((f) => f.folder))].sort((a, b) => a.localeCompare(b));
      for (const folder of folders) {
        out.push({
          key: `${scope}:${folder}`,
          label: `${scope === 'global' ? 'Global' : 'Project'}${folder ? ` · ${folder}` : ''}`,
          items: scoped.filter((f) => f.folder === folder),
        });
      }
    }
    return out;
  }, [fits]);

  return (
    <span style={{ position: 'relative' }} ref={wrapRef}>
      <button
        className="btn btn-sm"
        style={{ height: compact ? 24 : 26 }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div
          className="space-switcher-menu"
          style={{
            left: align === 'left' ? 0 : 'auto',
            right: align === 'right' ? 0 : 'auto',
            maxHeight: 320,
            overflow: 'auto',
            minWidth: 240,
          }}
        >
          {onCreate && (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  onCreate();
                  setOpen(false);
                }}
              >
                ＋ {createLabel ?? 'New field from selection'}
              </button>
              <hr className="divider" style={{ margin: '4px 0' }} />
            </>
          )}

          {fields.length > 6 && (
            <div className="fp-search" style={{ margin: '0 2px 4px' }}>
              <IconSearch size={11} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                aria-label="Filter fields"
              />
            </div>
          )}

          {fields.length === 0 && (
            <div className="fp-empty">No sync fields in this project yet.</div>
          )}
          {fields.length > 0 && fits.length === 0 && unfit.length === 0 && (
            <div className="fp-empty">Nothing matches.</div>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              <div className="fp-group-label">{g.label}</div>
              {g.items.map((f) => (
                <button
                  key={f.id}
                  className="menu-item"
                  title={fieldPreview(f)}
                  onClick={() => {
                    onPick(f);
                    setOpen(false);
                  }}
                >
                  <span className={`fp-dot ${f.scope === 'global' ? 'is-global' : ''}`} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.name}
                  </span>
                  <span className="ctx-hint">{fieldShapeLabel(f.value)}</span>
                </button>
              ))}
            </div>
          ))}

          {unfit.length > 0 && (
            <>
              <hr className="divider" style={{ margin: '4px 0' }} />
              <div className="fp-group-label">Not usable here</div>
              {unfit.map(({ field, reason }) => (
                <button key={field.id} className="menu-item" disabled title={reason}>
                  <span className={`fp-dot ${field.scope === 'global' ? 'is-global' : ''}`} />
                  <span
                    style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.55 }}
                  >
                    {field.name}
                  </span>
                  <span className="ctx-hint">{fieldShapeLabel(field.value)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </span>
  );
}
