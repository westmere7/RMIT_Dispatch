import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { useWorkspace } from '../../editor/workspaceContext';
import { applyMark, cloneRich, emptyRich, plainText, rangeHasMark } from '../../lib/richtext';
import { collectUsages, valueAsRich, valueAsTable } from '../../lib/syncfields';
import { useAuth } from '../../store/auth';
import { renameField, updateFieldValue } from '../../store/fields';
import type { FieldValue, RichText, SyncField } from '../../types';
import { IconBold, IconItalic, IconTable, IconX } from '../Icons';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';

/**
 * Edit a sync field's canonical value in isolation. Saving writes the
 * field itself, so every document embedding it updates downstream —
 * no need to open the documents that use it.
 *
 * Simple fields (a line or paragraphs of rich text) edit as text.
 * Table fields expose every cell, with header toggle and row/column
 * editing, so the whole structure stays editable in the right format.
 */
export function FieldEditorDialog({
  field,
  onClose,
}: {
  field: SyncField;
  onClose: () => void;
}) {
  const { setFields } = useWorkspace();
  const { state } = useEditor();
  const { user } = useAuth();

  const initialTable = valueAsTable(field.value);
  const [name, setName] = useState(field.name);
  const [rich, setRich] = useState<RichText>(() =>
    initialTable ? emptyRich() : cloneRich(valueAsRich(field.value)),
  );
  const [table, setTable] = useState(() =>
    initialTable
      ? { headerRow: initialTable.headerRow, rows: initialTable.rows.map((r) => r.map(cloneRich)) }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<RichTextEditorHandle>(null);

  const usageCount = useMemo(
    () => collectUsages(state.pages).filter((u) => u.fieldId === field.id).length,
    [state.pages, field.id],
  );

  const isScalar = field.value.kind === 'scalar';

  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const value: FieldValue = table
        ? { kind: 'table', headerRow: table.headerRow, rows: table.rows }
        : isScalar
          ? { kind: 'scalar', text: plainText(rich) }
          : { kind: 'richtext', rich };
      await updateFieldValue(field.id, value, user.uid);
      if (name.trim() && name.trim() !== field.name) {
        await renameField(field.id, name.trim());
      }
      setFields((prev) =>
        prev.map((f) =>
          f.id === field.id ? { ...f, value, name: name.trim() || f.name, updatedBy: user.uid } : f,
        ),
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /* ---------- table helpers ---------- */
  const nCols = table?.rows[0]?.length ?? 0;

  const setCell = (r: number, c: number, value: RichText) =>
    setTable((t) =>
      t ? { ...t, rows: t.rows.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? value : cell))) } : t,
    );

  const addRow = () =>
    setTable((t) =>
      t ? { ...t, rows: [...t.rows, Array.from({ length: nCols || 1 }, () => emptyRich())] } : t,
    );
  const removeRow = (r: number) =>
    setTable((t) => (t && t.rows.length > 1 ? { ...t, rows: t.rows.filter((_, i) => i !== r) } : t));
  const addCol = () =>
    setTable((t) => (t ? { ...t, rows: t.rows.map((row) => [...row, emptyRich()]) } : t));
  const removeCol = (c: number) =>
    setTable((t) =>
      t && nCols > 1 ? { ...t, rows: t.rows.map((row) => row.filter((_, i) => i !== c)) } : t,
    );

  const markToolbar = (
    <>
      <button
        className="icon-btn"
        title="Bold"
        aria-label="Bold"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const r = editorRef.current?.getRange();
          if (!r || r.start === r.end) return;
          setRich((cur) => applyMark(cur, r, { bold: !rangeHasMark(cur, r, 'bold') }));
        }}
      >
        <IconBold size={13} />
      </button>
      <button
        className="icon-btn"
        title="Italic"
        aria-label="Italic"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const r = editorRef.current?.getRange();
          if (!r || r.start === r.end) return;
          setRich((cur) => applyMark(cur, r, { italic: !rangeHasMark(cur, r, 'italic') }));
        }}
      >
        <IconItalic size={13} />
      </button>
    </>
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: table ? 780 : 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="pill pill-accent">
            {table ? (
              <>
                <IconTable size={11} /> table field
              </>
            ) : isScalar ? (
              'value field'
            ) : (
              'text field'
            )}
          </span>
          <h2 style={{ flex: 1 }}>Edit sync field</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="muted text-xs" style={{ marginBottom: 16 }}>
          Saving updates the field itself — every document that embeds it follows immediately.
          {usageCount > 0 && ` Used ${usageCount}× in this document.`}
        </p>

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="fe-name">Field name</label>
          <input
            id="fe-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {table ? (
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>
                Cells ({table.rows.length}×{nCols})
              </span>
              <label className="text-xs muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={table.headerRow}
                  onChange={(e) => setTable((t) => (t ? { ...t, headerRow: e.target.checked } : t))}
                />
                header row
              </label>
            </label>

            <div style={{ overflow: 'auto', maxHeight: 340, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
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
                          onClick={() => removeRow(r)}
                        >
                          −
                        </button>
                      </td>
                      {row.map((cell, c) => (
                        <td key={c} className={table.headerRow && r === 0 ? 'is-header' : ''}>
                          <FieldCellEditor value={cell} onChange={(v) => setCell(r, c, v)} />
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
                          onClick={() => removeCol(c)}
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
              <button className="btn btn-sm" onClick={addRow}>
                + Row
              </button>
              <button className="btn btn-sm" onClick={addCol}>
                + Column
              </button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Value</label>
            <RichTextEditor
              ref={editorRef}
              value={rich}
              onChange={setRich}
              toolbar={isScalar ? undefined : markToolbar}
              compact={isScalar}
            />
            <p className="muted text-xs" style={{ marginTop: 4 }}>
              {isScalar
                ? 'Plain value — formatting is not stored for this field.'
                : 'Nested fields inside this value keep syncing from their own definitions.'}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save field'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One table cell: a compact rich-text editor keeping inline formatting. */
function FieldCellEditor({ value, onChange }: { value: RichText; onChange: (v: RichText) => void }) {
  const ref = useRef<RichTextEditorHandle>(null);
  return (
    <div className="field-cell">
      <RichTextEditor ref={ref} value={value} onChange={onChange} compact />
    </div>
  );
}
