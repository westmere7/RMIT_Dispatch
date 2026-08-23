import { useRef, useState } from 'react';
import {
  COMPRESSION_LEVELS,
  DEFAULT_COMPRESSION,
  formatBytes,
  type CompressionLevel,
} from '../../lib/imagecompress';
import { emptyRich } from '../../lib/richtext';
import { mediaUrl } from '../../lib/supabase';
import { deleteMedia, uploadMedia } from '../../store/media';
import { newId } from '../../lib/ids';
import type { FieldPart, FieldValue, ImagePayload, RichText } from '../../types';
import { useDialog } from '../Dialog';
import {
  IconArrowDown,
  IconArrowUp,
  IconImage,
  IconPlus,
  IconTable,
  IconTrash,
  IconType,
} from '../Icons';
import { RichTextEditor } from './RichTextEditor';

/* ============================================================
   Editors for each field kind. Which controls appear depends on
   the kind chosen when the field was created; a combination
   field composes the same editors as reorderable parts.
   ============================================================ */

function emptyTable() {
  return {
    headerRow: true,
    rows: [
      [emptyRich(), emptyRich()],
      [emptyRich(), emptyRich()],
    ] as RichText[][],
  };
}

export function newPart(kind: FieldPart['kind']): FieldPart {
  if (kind === 'text') return { id: newId('pt'), kind: 'text', rich: emptyRich() };
  if (kind === 'table') return { id: newId('pt'), kind: 'table', ...emptyTable() };
  return { id: newId('pt'), kind: 'image', fit: 'contain' };
}

/** Blank starting value for a newly created field of the given kind. */
export function emptyValueFor(kind: FieldValue['kind'], seedText = ''): FieldValue {
  switch (kind) {
    case 'scalar':
      return { kind: 'scalar', text: seedText };
    case 'richtext':
      return { kind: 'richtext', rich: seedText ? [[{ text: seedText }]] : emptyRich() };
    case 'table':
      return { kind: 'table', ...emptyTable() };
    case 'image':
      return { kind: 'image', fit: 'contain', alt: seedText || undefined };
    case 'group':
      return { kind: 'group', parts: [newPart('text')] };
  }
}

/* ---------- Table editor ---------- */

export function TableEditor({
  table,
  onChange,
}: {
  table: { headerRow: boolean; rows: RichText[][] };
  onChange: (t: { headerRow: boolean; rows: RichText[][] }) => void;
}) {
  const nCols = table.rows[0]?.length ?? 0;

  const setCell = (r: number, c: number, value: RichText) =>
    onChange({
      ...table,
      rows: table.rows.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? value : cell))),
    });

  return (
    <div className="field">
      <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1 }}>
          Cells ({table.rows.length}×{nCols})
        </span>
        <label className="text-xs muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={table.headerRow}
            onChange={(e) => onChange({ ...table, headerRow: e.target.checked })}
          />
          header row
        </label>
      </label>

      <div
        style={{
          overflow: 'auto',
          maxHeight: 300,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <table className="field-grid">
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                <td className="field-grid-gutter">
                  <button
                    className="icon-btn"
                    style={{ width: 20, height: 20 }}
                    title={`Delete row ${r + 1}`}
                    aria-label={`Delete row ${r + 1}`}
                    disabled={table.rows.length <= 1}
                    onClick={() => onChange({ ...table, rows: table.rows.filter((_, i) => i !== r) })}
                  >
                    −
                  </button>
                </td>
                {row.map((cell, c) => (
                  <td key={c} className={table.headerRow && r === 0 ? 'is-header' : ''}>
                    <div className="field-cell">
                      <RichTextEditor value={cell} onChange={(v) => setCell(r, c, v)} compact />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="field-grid-gutter" />
              {Array.from({ length: nCols }, (_, c) => (
                <td key={c} className="field-grid-gutter">
                  <button
                    className="icon-btn"
                    style={{ width: 20, height: 20 }}
                    title={`Delete column ${c + 1}`}
                    aria-label={`Delete column ${c + 1}`}
                    disabled={nCols <= 1}
                    onClick={() =>
                      onChange({ ...table, rows: table.rows.map((row) => row.filter((_, i) => i !== c)) })
                    }
                  >
                    −
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          className="btn btn-sm"
          onClick={() =>
            onChange({
              ...table,
              rows: [...table.rows, Array.from({ length: nCols || 1 }, () => emptyRich())],
            })
          }
        >
          + Row
        </button>
        <button
          className="btn btn-sm"
          onClick={() => onChange({ ...table, rows: table.rows.map((row) => [...row, emptyRich()]) })}
        >
          + Column
        </button>
      </div>
    </div>
  );
}

/* ---------- Image editor ---------- */

export function ImageEditor({
  image,
  spaceId,
  onChange,
}: {
  image: ImagePayload;
  spaceId: string;
  onChange: (img: ImagePayload) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<CompressionLevel>(DEFAULT_COMPRESSION);
  const [saved, setSaved] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setSaved(null);
    try {
      const previous = image.storagePath;
      const res = await uploadMedia(spaceId, file, level);
      onChange({
        ...image,
        storagePath: res.storagePath,
        width: res.width || undefined,
        height: res.height || undefined,
        bytes: res.bytes,
      });
      // The old object is unreferenced the moment the new one lands.
      if (previous) await deleteMedia(previous);
      const pct = Math.round((1 - res.bytes / Math.max(1, res.originalBytes)) * 100);
      setSaved(
        res.ext === 'webp'
          ? `${formatBytes(res.originalBytes)} → ${formatBytes(res.bytes)} WebP (${pct > 0 ? `${pct}% smaller` : 'no gain'})`
          : `stored as-is (${formatBytes(res.bytes)})`,
      );
    } catch (e) {
      await dialog.alert('Upload failed', { message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const ok = await dialog.confirm('Remove this image?', {
      message: 'The file is deleted from storage as well.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const previous = image.storagePath;
    onChange({ ...image, storagePath: undefined, width: undefined, height: undefined, bytes: undefined });
    await deleteMedia(previous);
    setSaved(null);
  };

  return (
    <>
      <div className="field">
        <label>Image</label>
        {image.storagePath ? (
          <div className="fv-image" style={{ marginBottom: 8 }}>
            <img src={mediaUrl(image.storagePath)} alt={image.alt ?? ''} />
            <figcaption>
              <span className="muted text-xs">
                {image.width && image.height ? `${image.width}×${image.height}` : ''}
                {image.bytes ? ` · ${formatBytes(image.bytes)}` : ''}
              </span>
            </figcaption>
          </div>
        ) : (
          <p className="muted text-xs">No image yet.</p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Compressing…' : image.storagePath ? 'Replace image' : 'Upload image'}
          </button>
          {image.storagePath && (
            <button className="btn btn-danger btn-sm" onClick={() => void clear()} disabled={busy}>
              <IconTrash size={12} /> Remove
            </button>
          )}
        </div>
        {saved && <span className="muted text-xs">{saved}</span>}
      </div>

      <div className="field">
        <label htmlFor={`cmp-${image.storagePath ?? 'new'}`}>Compression</label>
        <select
          id={`cmp-${image.storagePath ?? 'new'}`}
          className="input"
          value={level}
          onChange={(e) => setLevel(e.target.value as CompressionLevel)}
        >
          {COMPRESSION_LEVELS.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label} — {l.hint}
            </option>
          ))}
        </select>
        <span className="muted text-xs">
          Applied on the next upload. Everything is stored as WebP unless you pick Original.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Fit</label>
          <div className="segmented">
            {(['cover', 'contain'] as const).map((f) => (
              <button
                key={f}
                className={(image.fit ?? 'contain') === f ? 'active' : ''}
                onClick={() => onChange({ ...image, fit: f })}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <label>Alt text</label>
        <input
          className="input"
          value={image.alt ?? ''}
          onChange={(e) => onChange({ ...image, alt: e.target.value || undefined })}
          placeholder="Described for screen readers"
        />
      </div>
      <div className="field">
        <label>Caption</label>
        <input
          className="input"
          value={image.caption ?? ''}
          onChange={(e) => onChange({ ...image, caption: e.target.value || undefined })}
        />
      </div>
    </>
  );
}

/* ---------- Combination editor ---------- */

export function GroupEditor({
  parts,
  spaceId,
  onChange,
}: {
  parts: FieldPart[];
  spaceId: string;
  onChange: (parts: FieldPart[]) => void;
}) {
  const dialog = useDialog();

  const replace = (id: string, next: FieldPart) =>
    onChange(parts.map((p) => (p.id === id ? next : p)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= parts.length) return;
    const next = [...parts];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = async (part: FieldPart) => {
    const ok = await dialog.confirm(`Remove this ${part.kind} part?`, {
      message:
        part.kind === 'image' && part.storagePath
          ? 'Its image file is deleted from storage as well.'
          : 'This cannot be undone.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    if (part.kind === 'image' && part.storagePath) await deleteMedia(part.storagePath);
    onChange(parts.filter((p) => p.id !== part.id));
  };

  return (
    <div className="field">
      <label>Parts ({parts.length})</label>
      <div className="grp-list">
        {parts.length === 0 && (
          <p className="muted text-xs">Empty — add a text, table or image part below.</p>
        )}
        {parts.map((part, i) => (
          <div key={part.id} className="grp-part">
            <div className="grp-part-head">
              <span className="pill">
                {part.kind === 'text' ? (
                  <IconType size={11} />
                ) : part.kind === 'table' ? (
                  <IconTable size={11} />
                ) : (
                  <IconImage size={11} />
                )}
                {i + 1}. {part.kind}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Move up"
                aria-label={`Move part ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <IconArrowUp size={12} />
              </button>
              <button
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Move down"
                aria-label={`Move part ${i + 1} down`}
                disabled={i === parts.length - 1}
                onClick={() => move(i, 1)}
              >
                <IconArrowDown size={12} />
              </button>
              <button
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Remove part"
                aria-label={`Remove part ${i + 1}`}
                onClick={() => void remove(part)}
              >
                <IconTrash size={12} />
              </button>
            </div>

            <div className="grp-part-body">
              {part.kind === 'text' && (
                <RichTextEditor
                  value={part.rich}
                  onChange={(rich) => replace(part.id, { ...part, rich })}
                />
              )}
              {part.kind === 'table' && (
                <TableEditor
                  table={part}
                  onChange={(t) => replace(part.id, { ...part, ...t })}
                />
              )}
              {part.kind === 'image' && (
                <ImageEditor
                  image={part}
                  spaceId={spaceId}
                  onChange={(img) => replace(part.id, { ...part, ...img })}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {(['text', 'table', 'image'] as FieldPart['kind'][]).map((k) => (
          <button
            key={k}
            className="btn btn-sm"
            onClick={() => onChange([...parts, newPart(k)])}
          >
            <IconPlus size={12} /> {k}
          </button>
        ))}
      </div>
    </div>
  );
}
