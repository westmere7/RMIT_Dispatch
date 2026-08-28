import { useState, type ReactNode } from 'react';
import { fieldShape, fieldShapeLabel } from '../../lib/fieldtypes';
import { plainText } from '../../lib/richtext';
import { mediaUrl } from '../../lib/supabase';
import type { FieldPart, FieldValue, RichText, SyncField } from '../../types';
import {
  IconChevronRight,
  IconImage,
  IconLayers,
  IconLink,
  IconPencil,
  IconTable,
  IconTrash,
  IconType,
  IconUnlink,
  IconX,
} from '../Icons';

/* ============================================================
   Field "peek": lists show a compact chip; the full value only
   ever appears in this popup, together with the field's actions.
   Handles every field kind — value, text, table, image and a
   combination of those.
   ============================================================ */

export function valueText(value: FieldValue): string {
  switch (value.kind) {
    case 'scalar':
      return value.text;
    case 'richtext':
      return plainText(value.rich);
    case 'table':
      return value.rows.map((r) => r.map((c) => plainText(c)).join(' · ')).join('\n');
    case 'image':
      return value.caption || value.alt || 'image';
    case 'group':
      return value.parts
        .map((p) =>
          p.kind === 'text'
            ? plainText(p.rich)
            : p.kind === 'table'
              ? `${p.rows.length}×${p.rows[0]?.length ?? 0} table`
              : p.caption || p.alt || 'image',
        )
        .join('\n');
  }
}

/** Short label safe for a tooltip — never the whole value. */
export function shortLabel(value: FieldValue, max = 120): string {
  if (value.kind === 'table') {
    return `${value.rows.length}×${value.rows[0]?.length ?? 0} table`;
  }
  if (value.kind === 'image') return value.alt || value.caption || 'image';
  if (value.kind === 'group') return `${value.parts.length}-part combination`;
  const t = valueText(value).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Chip caption: a hint at the content, not the content itself. */
function chipSummary(value: FieldValue, max = 34): string {
  if (value.kind === 'table') {
    return `${value.rows.length}×${value.rows[0]?.length ?? 0} table`;
  }
  if (value.kind === 'image') return value.alt || value.caption || 'image';
  if (value.kind === 'group') {
    const counts = { text: 0, table: 0, image: 0 } as Record<FieldPart['kind'], number>;
    value.parts.forEach((p) => (counts[p.kind] += 1));
    return (
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(' + ') || 'empty'
    );
  }
  const t = valueText(value).replace(/\s+/g, ' ').trim();
  if (!t) return 'empty';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function shapeIcon(value: FieldValue, size = 11): ReactNode {
  const shape = fieldShape(value);
  if (shape === 'table') return <IconTable size={size} />;
  if (shape === 'image') return <IconImage size={size} />;
  if (shape === 'group') return <IconLayers size={size} />;
  return <IconType size={size} />;
}

function TableGrid({ table }: { table: { headerRow: boolean; rows: RichText[][] } }) {
  const header = table.headerRow ? table.rows[0] : null;
  const body = table.headerRow ? table.rows.slice(1) : table.rows;
  return (
    <table className="fv-table">
      {header && (
        <thead>
          <tr>
            {header.map((c, i) => (
              <th key={i}>{plainText(c)}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri}>
            {row.map((c, ci) => (
              <td key={ci}>{plainText(c)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImageView({
  storagePath,
  alt,
  caption,
  bytes,
  width,
  height,
}: {
  storagePath?: string;
  alt?: string;
  caption?: string;
  bytes?: number;
  width?: number;
  height?: number;
}) {
  if (!storagePath) return <p className="muted">No image uploaded yet.</p>;
  return (
    <figure className="fv-image">
      <img src={mediaUrl(storagePath)} alt={alt ?? ''} />
      <figcaption>
        {caption && <span>{caption}</span>}
        <span className="muted text-xs">
          {width && height ? `${width}×${height}` : ''}
          {bytes ? ` · ${(bytes / 1024).toFixed(0)} kB WebP` : ''}
          {alt ? ` · alt: ${alt}` : ''}
        </span>
      </figcaption>
    </figure>
  );
}

/** Read-only rendering of any field value. */
export function FieldValueView({ value }: { value: FieldValue }) {
  switch (value.kind) {
    case 'table':
      return (
        <div style={{ overflow: 'auto' }}>
          <TableGrid table={value} />
        </div>
      );
    case 'image':
      return <ImageView {...value} />;
    case 'group':
      return (
        <div className="fv-parts">
          {value.parts.length === 0 && <p className="muted">This combination is empty.</p>}
          {value.parts.map((part, i) => (
            <div key={part.id} className="fv-part">
              <span className="fv-part-label">
                {part.kind === 'text' ? (
                  <IconType size={10} />
                ) : part.kind === 'table' ? (
                  <IconTable size={10} />
                ) : (
                  <IconImage size={10} />
                )}
                {i + 1}. {part.kind}
              </span>
              {part.kind === 'text' &&
                part.rich.map((para, pi) => <p key={pi}>{plainText([para]) || ' '}</p>)}
              {part.kind === 'table' && (
                <div style={{ overflow: 'auto' }}>
                  <TableGrid table={part} />
                </div>
              )}
              {part.kind === 'image' && <ImageView {...part} />}
            </div>
          ))}
        </div>
      );
    default:
      return (
        <>
          {valueText(value)
            .split('\n')
            .map((line, i) => (
              <p key={i}>{line || ' '}</p>
            ))}
        </>
      );
  }
}

export interface FieldPeekActions {
  onEdit?: () => void;
  onMove?: () => void;
  onToggleScope?: () => void;
  onDelete?: () => void;
  /** Detach the embed this peek was opened from, when there is one. */
  onUnlinkEmbed?: () => void;
  /** Where the field lives, e.g. a project name. */
  availability?: string;
  extra?: ReactNode;
}

/** Full value plus the field's actions. */
export function FieldPeekDialog({
  field,
  actions,
  onClose,
}: {
  field: SyncField;
  actions?: FieldPeekActions;
  onClose: () => void;
}) {
  const a = actions ?? {};
  const isGlobal = field.scope === 'global';
  const wide = field.value.kind === 'table' || field.value.kind === 'group';

  const run = (fn?: () => void) => {
    if (!fn) return;
    onClose();
    fn();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: wide ? 780 : 560 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span className={`pill ${isGlobal ? 'pill-accent' : ''}`}>
            {shapeIcon(field.value)}
            {isGlobal ? 'global' : 'project'}
          </span>
          <span className="pill" style={{ opacity: 0.85, fontSize: 10 }}>
            {fieldShapeLabel(field.value)}
          </span>
          <h2 style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', margin: 0, fontSize: 16 }}>{field.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        {/* Metadata */}
        <div className="fp-peek-meta">
          <span>Folder: <strong>{field.folder ? field.folder : 'root'}</strong></span>
          {a.availability && (
            <>
              <span>·</span>
              <span>Available to: <strong>{a.availability}</strong></span>
            </>
          )}
        </div>

        {/* Value Section */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Canonical Value
          </span>
          {a.onEdit && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => run(a.onEdit)}
              style={{ color: 'var(--accent)', gap: 4 }}
              title="Edit field value"
            >
              <IconPencil size={11} /> Edit
            </button>
          )}
        </div>

        <div
          className={`fv-full ${a.onEdit ? 'clickable-edit' : ''}`}
          onClick={a.onEdit ? () => run(a.onEdit) : undefined}
          title={a.onEdit ? 'Click to edit' : undefined}
        >
          <FieldValueView value={field.value} />
        </div>

        {a.extra}

        {/* Action Bar with clear visual hierarchy */}
        <div className="fp-peek-actions">
          <div className="fp-peek-actions-secondary">
            {a.onMove && (
              <button className="btn btn-sm" onClick={() => run(a.onMove)}>
                <IconChevronRight size={12} /> Move folder
              </button>
            )}
            {a.onToggleScope && (
              <button className="btn btn-sm" onClick={() => run(a.onToggleScope)}>
                {isGlobal ? <IconUnlink size={12} /> : <IconLink size={12} />}
                {isGlobal ? 'Make project-only' : 'Make global'}
              </button>
            )}
            {a.onUnlinkEmbed && (
              <button className="btn btn-sm" onClick={() => run(a.onUnlinkEmbed)}>
                <IconUnlink size={12} /> Unlink here
              </button>
            )}
            {a.onDelete && (
              <button className="btn btn-danger btn-sm" onClick={() => run(a.onDelete)}>
                <IconTrash size={12} /> Delete
              </button>
            )}
          </div>

          <div className="fp-peek-actions-primary">
            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
            {a.onEdit && (
              <button className="btn btn-sm btn-primary" onClick={() => run(a.onEdit)}>
                <IconPencil size={13} /> Edit value
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact value cell for any field list. The value itself is never shown
 * inline — the chip opens the peek popup, which carries the full value
 * and the field's actions.
 */
export function FieldValuePreview({
  field,
  actions,
}: {
  field: SyncField;
  actions?: FieldPeekActions;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="fv-more-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Show the full value"
      >
        {shapeIcon(field.value)}
        <span className="fv-summary">{chipSummary(field.value)}</span>
        <span className="fv-view">view</span>
      </button>
      {open && (
        <FieldPeekDialog field={field} actions={actions} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
