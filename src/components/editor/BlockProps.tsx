import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { useWorkspace } from '../../editor/workspaceContext';
import { effectiveColumns } from '../../grid/presets';
import { uuid } from '../../lib/ids';
import { blockTarget } from '../../lib/fieldtypes';
import { rangeFromAny } from '../../lib/richdom';
import { SIZE_LABEL, TEXT_SIZES } from '../../lib/textsize';
import {
  applyMark,
  applyMarkAll,
  emptyRich,
  plainText,
  rangeHasMark,
  rangeSize,
  richHasMark,
  type TextRange,
} from '../../lib/richtext';
import { autoFieldName } from '../../lib/syncfields';
import { useAuth } from '../../store/auth';
import { createField } from '../../store/fields';
import { deleteMedia, uploadMedia } from '../../store/media';
import {
  COMPRESSION_LEVELS,
  DEFAULT_COMPRESSION,
  formatBytes,
  type CompressionLevel,
} from '../../lib/imagecompress';
import { useSpaces } from '../../store/spaces';
import type {
  Block,
  CellBinding,
  ImageBlock,
  ShapeBlock,
  ShapeKind,
  RichText,
  SyncDirection,
  TableBlock,
  TextAlign,
  TextBlock,
  TextSize,
} from '../../types';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconBringFront,
  IconCopy,
  IconItalic,
  IconLink,
  IconPlus,
  IconSendBack,
  IconTrash,
} from '../Icons';
import { useFieldOps } from '../../editor/useFieldOps';
import { useDialog } from '../Dialog';
import { FieldMenu } from './FieldMenu';
import { FieldPicker } from './FieldPicker';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';

/* ============================================================
   Properties
   ============================================================ */

export function PropertiesPanel() {
  const { state, dispatch, readOnly, currentPage } = useEditor();
  const sel = state.selection;

  if (!currentPage) return <p className="muted text-sm">No page.</p>;

  const blocks = currentPage.blocks.filter((b) => sel.includes(b.id));

  if (blocks.length === 0) {
    return (
      <div>
        <h3 style={{ marginBottom: 6 }}>Page</h3>
        <p className="muted text-xs">
          {state.grid.pageSize} {state.grid.orientation} ·{' '}
          {effectiveColumns(state.grid, currentPage.kind)}×{state.grid.rows} grid ·{' '}
          {currentPage.kind}
        </p>
        <p className="muted text-xs" style={{ marginTop: 8 }}>
          Select a block to edit it. Shift-click for multi-select.
        </p>
      </div>
    );
  }

  if (blocks.length > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3>{blocks.length} selected</h3>
        {!readOnly && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm"
              onClick={() => dispatch({ type: 'DUPLICATE_BLOCKS', pageId: currentPage.id, ids: sel })}
            >
              <IconCopy size={13} /> Duplicate
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => dispatch({ type: 'DELETE_BLOCKS', pageId: currentPage.id, ids: sel })}
            >
              <IconTrash size={13} /> Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  return <SingleBlock block={blocks[0]} pageId={currentPage.id} />;
}

export function SingleBlock({ block, pageId }: { block: Block; pageId: string }) {
  const { dispatch, readOnly } = useEditor();
  const update = (patch: Partial<Block>) =>
    dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch });


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ flex: 1, textTransform: 'capitalize' }}>{block.type} block</h3>
        {!readOnly && (
          <>
            <button
              className="icon-btn"
              title="Bring to front"
              aria-label="Bring to front"
              onClick={() => dispatch({ type: 'REORDER_BLOCK', pageId, blockId: block.id, to: 'front' })}
            >
              <IconBringFront size={14} />
            </button>
            <button
              className="icon-btn"
              title="Send to back"
              aria-label="Send to back"
              onClick={() => dispatch({ type: 'REORDER_BLOCK', pageId, blockId: block.id, to: 'back' })}
            >
              <IconSendBack size={14} />
            </button>
            <button
              className="icon-btn"
              title="Duplicate"
              aria-label="Duplicate"
              onClick={() => dispatch({ type: 'DUPLICATE_BLOCKS', pageId, ids: [block.id] })}
            >
              <IconCopy size={14} />
            </button>
            <button
              className="icon-btn"
              title="Delete"
              aria-label="Delete"
              onClick={() => dispatch({ type: 'DELETE_BLOCKS', pageId, ids: [block.id] })}
            >
              <IconTrash size={14} />
            </button>
          </>
        )}
      </div>

      {/* Sync lives in its own tab, but this is where you land when you
          select a block — so the one-click "make this a field" belongs
          here too. */}
      {!readOnly && <BlockFieldRow block={block} pageId={pageId} />}

      {block.type === 'text' && <TextProps block={block} update={update} />}
      {block.type === 'table' && <TableProps block={block} update={update} pageId={pageId} />}
      {block.type === 'image' && <ImageProps block={block} update={update} />}
      {block.type === 'shape' && <ShapeProps block={block} update={update} />}
    </div>
  );
}


/**
 * Promote the selected block to a sync field, or bind it to an existing
 * one — no text selection required, the block's own content is the
 * value. Hidden for shapes (nothing to share) and for blocks that are
 * already bound, which the Sync tab handles.
 */
export function BlockFieldRow({ block, pageId }: { block: Block; pageId: string }) {
  const { dispatch } = useEditor();
  const { fields, setTab } = useWorkspace();
  const { createFieldFromBlock, bindBlockToField } = useFieldOps();
  const target = blockTarget(block);
  if (!target) return null;

  const patch = (p: Partial<Block>) =>
    dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch: p });

  if (block.binding) {
    const label = block.binding.fieldId ? 'Synced to a field' : 'Follows the master block';
    return (
      <div className="bi-sync-row">
        <span className="pill pill-accent">
          <IconLink size={11} /> {label}
        </span>
        <button className="btn btn-sm" onClick={() => setTab('sync')}>
          Sync options
        </button>
      </div>
    );
  }

  return (
    <div className="bi-sync-row">
      <button
        className="btn btn-sm btn-primary"
        title="Create a field from this block's content"
        onClick={() => void createFieldFromBlock(block).then((p) => p && patch(p))}
      >
        <IconLink size={11} /> Make a sync field
      </button>
      <FieldPicker
        fields={fields}
        target={target}
        label="Use existing"
        compact
        align="right"
        onPick={(f) => void bindBlockToField(block, f.id).then((p) => p && patch(p))}
      />
    </div>
  );
}

/* ---------- Text ---------- */

/** Re-exported for the bar; the scale itself lives in lib/textsize.ts. */
export const SIZES = TEXT_SIZES;

/**
 * The live text selection for a block: this panel's editor if it has
 * one, otherwise the on-canvas editor for the same block. That is what
 * lets the panel's B / I / colour / size act on a selection the user
 * made out on the canvas.
 */
export function liveRangeFor(blockId: string, own: TextRange | null | undefined): TextRange | null {
  if (own && own.end > own.start) return own;
  const canvasRoot = document.querySelector(
    `[data-block-id="${blockId}"] .inline-editor-body`,
  ) as HTMLElement | null;
  const onCanvas = rangeFromAny([canvasRoot]);
  return onCanvas && onCanvas.end > onCanvas.start ? onCanvas : null;
}

export function TextProps({ block, update }: { block: TextBlock; update: (p: Partial<Block>) => void }) {
  const { readOnly } = useEditor();
  const editorRef = useRef<RichTextEditorHandle>(null);

  /** Size is local formatting: the selection if there is one, else the
      whole block (which also clears per-run sizes so it reads evenly). */
  const applySize = (size: TextSize) => {
    const range = liveRangeFor(block.id, editorRef.current?.getRange());
    if (range) {
      update({ body: applyMark(block.body, range, { size }) });
      return;
    }
    update({ size, body: applyMarkAll(block.body, { size: undefined }) });
  };

  const activeSize = (): TextSize => {
    const range = liveRangeFor(block.id, editorRef.current?.getRange());
    return (range ? rangeSize(block.body, range) : null) ?? block.size ?? 'md';
  };
  const boundDown = block.binding && block.binding.direction !== 'up';
  const locked = readOnly || !!boundDown;

  return (
    <>
      {/* No separate heading: a heading is just text the author made
          bigger or bolder, so the formatting controls cover it. */}
      <div className="field">
        <label>Text</label>
        {boundDown && (
          <p className="muted text-xs" style={{ marginBottom: 4 }}>
            This block follows {block.binding?.fieldId ? 'a sync field' : 'the master'} (↓). Unlink
            it in the Sync tab to edit.
          </p>
        )}
        <RichTextBody block={block} update={update} editorRef={editorRef} locked={locked} />
      </div>

      <div className="field">
        <label>Size</label>
        <div className="segmented">
          {SIZES.map((s) => (
            <button
              key={s}
              disabled={readOnly}
              className={activeSize() === s ? 'active' : ''}
              onClick={() => applySize(s)}
            >
              {SIZE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Align</label>
        <div className="segmented">
          {(
            [
              ['left', IconAlignLeft],
              ['center', IconAlignCenter],
              ['right', IconAlignRight],
            ] as [TextAlign, typeof IconAlignLeft][]
          ).map(([a, Icon]) => (
            <button
              key={a}
              disabled={readOnly}
              className={(block.align ?? 'left') === a ? 'active' : ''}
              onClick={() => update({ align: a })}
              aria-label={`Align ${a}`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Rich text body editor with mark + field toolbar. */
export function RichTextBody({
  block,
  update,
  editorRef,
  locked,
}: {
  block: TextBlock;
  update: (p: Partial<Block>) => void;
  editorRef: React.RefObject<RichTextEditorHandle>;
  locked: boolean;
}) {
  const { setActiveSpan, setTab } = useWorkspace();
  const setBody = (body: RichText) => update({ body });

  const liveRange = () => liveRangeFor(block.id, editorRef.current?.getRange());

  /**
   * Formatting applies to the selected characters, or — with no
   * selection — to the whole block of text. Nothing to select is never
   * an error here.
   */
  const toggleMark = (mark: 'bold' | 'italic') => {
    const range = liveRange();
    if (range) {
      setBody(applyMark(block.body, range, { [mark]: !rangeHasMark(block.body, range, mark) }));
    } else {
      setBody(applyMarkAll(block.body, { [mark]: !richHasMark(block.body, mark) }));
    }
  };

  const setColor = (color: string) => {
    const range = liveRange();
    const patch = { color: color || undefined };
    setBody(range ? applyMark(block.body, range, patch) : applyMarkAll(block.body, patch));
  };

  return (
    <RichTextEditor
      ref={editorRef}
      value={block.body}
      onChange={setBody}
      readOnly={locked}
      onSpanClick={(info) => {
        setActiveSpan({ blockId: block.id, ...info });
        setTab('sync');
      }}
      toolbar={
        <>
          <button className="icon-btn" title="Bold" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleMark('bold')}>
            <IconBold size={13} />
          </button>
          <button className="icon-btn" title="Italic" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleMark('italic')}>
            <IconItalic size={13} />
          </button>
          <label
            className="icon-btn"
            title="Text color"
            style={{ position: 'relative', cursor: 'pointer' }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 3,
                background:
                  'conic-gradient(var(--rmit-red), var(--warning), var(--success), var(--accent), var(--rmit-red))',
              }}
            />
            <input
              type="color"
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Text color"
            />
          </label>
          <button
            className="icon-btn"
            title="Clear color"
            aria-label="Clear color"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setColor('')}
          >
            <span style={{ fontSize: 11 }}>⌀</span>
          </button>
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '2px 2px' }} />
          <FieldMenu
            getRange={() => editorRef.current?.getRange() ?? null}
            rich={block.body}
            onRich={(body) => update({ body })}
          />
        </>
      }
    />
  );
}

/* ---------- Table ---------- */

export function TableProps({
  block,
  update,
  pageId,
}: {
  block: TableBlock;
  update: (p: Partial<Block>) => void;
  pageId: string;
}) {
  void pageId;
  const { readOnly } = useEditor();
  const { doc, project, fields, setFields, fieldMap } = useWorkspace();
  const { user } = useAuth();
  const [cell, setCell] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const cellEditorRef = useRef<RichTextEditorHandle>(null);
  const { insertField, checkFit } = useFieldOps();

  const nRows = block.rows.length;
  const nCols = block.rows[0]?.length ?? 0;
  const r = Math.min(cell.r, nRows - 1);
  const c = Math.min(cell.c, nCols - 1);
  const current = block.rows[r]?.[c] ?? emptyRich();
  const binding = block.cellBindings?.find((b) => b.row === r && b.col === c);
  const boundDown = binding && binding.direction !== 'up';

  const setRows = (rows: RichText[][], cellBindings?: CellBinding[]) =>
    update({ rows, ...(cellBindings !== undefined ? { cellBindings } : {}) } as Partial<Block>);

  const setCurrentCell = (rich: RichText) => {
    const rows = block.rows.map((row, ri) => row.map((cc, ci) => (ri === r && ci === c ? rich : cc)));
    setRows(rows);
  };

  const insertRow = () => {
    const rows = [...block.rows];
    rows.splice(r + 1, 0, Array.from({ length: nCols }, () => emptyRich()));
    const cb = (block.cellBindings ?? []).map((b) => (b.row > r ? { ...b, row: b.row + 1 } : b));
    setRows(rows, cb);
  };
  const deleteRow = () => {
    if (nRows <= 1) return;
    const rows = block.rows.filter((_, ri) => ri !== r);
    const cb = (block.cellBindings ?? [])
      .filter((b) => b.row !== r)
      .map((b) => (b.row > r ? { ...b, row: b.row - 1 } : b));
    setRows(rows, cb);
    setCell({ r: Math.max(0, r - 1), c });
  };
  const insertCol = () => {
    const rows = block.rows.map((row) => {
      const next = [...row];
      next.splice(c + 1, 0, emptyRich());
      return next;
    });
    const cb = (block.cellBindings ?? []).map((b) => (b.col > c ? { ...b, col: b.col + 1 } : b));
    setRows(rows, cb);
  };
  const deleteCol = () => {
    if (nCols <= 1) return;
    const rows = block.rows.map((row) => row.filter((_, ci) => ci !== c));
    const cb = (block.cellBindings ?? [])
      .filter((b) => b.col !== c)
      .map((b) => (b.col > c ? { ...b, col: b.col - 1 } : b));
    setRows(rows, cb);
    setCell({ r, c: Math.max(0, c - 1) });
  };

  const bindCell = async (fieldId: string, createNew: boolean) => {
    if (!user) return;
    const direction: SyncDirection = doc.kind === 'master' ? 'two-way' : 'down';
    if (!createNew) {
      const f = fieldMap.get(fieldId);
      // A table field owns a whole table; it can't live in one cell.
      if (!f || !(await checkFit(f, 'tableCell'))) return;
    }
    if (createNew) {
      const name = autoFieldName(plainText(current), new Set(fields.map((f) => f.name)));
      const field = await createField({
        id: fieldId,
        projectId: project.id,
        spaceId: project.spaceId,
        scope: 'local',
        name,
        value: { kind: 'richtext', rich: current },
        userId: user.uid,
      });
      setFields((prev) => [...prev, field]);
    }
    const cb = [
      ...(block.cellBindings ?? []).filter((b) => !(b.row === r && b.col === c)),
      { row: r, col: c, fieldId, direction },
    ];
    update({ cellBindings: cb } as Partial<Block>);
  };

  const unbindCell = () => {
    update({
      cellBindings: (block.cellBindings ?? []).filter((b) => !(b.row === r && b.col === c)),
    } as Partial<Block>);
  };


  return (
    <>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={block.headerRow}
            disabled={readOnly}
            onChange={(e) => update({ headerRow: e.target.checked } as Partial<Block>)}
            style={{ marginRight: 6 }}
          />
          First row is a header
        </label>
      </div>

      <div className="field">
        <label>
          Cells ({nRows}×{nCols}) — selected: R{r + 1} C{c + 1}
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${nCols}, 1fr)`,
            gap: 2,
            maxHeight: 140,
            overflow: 'auto',
          }}
        >
          {block.rows.map((row, ri) =>
            row.map((cc, ci) => {
              const isSel = ri === r && ci === c;
              const hasBind = block.cellBindings?.some((b) => b.row === ri && b.col === ci);
              return (
                <button
                  key={`${ri}-${ci}`}
                  onClick={() => setCell({ r: ri, c: ci })}
                  title={plainText(cc)}
                  style={{
                    height: 24,
                    fontSize: 10,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 3,
                    background: hasBind ? 'var(--accent-wash)' : isSel ? 'var(--surface-2)' : 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0 3px',
                  }}
                >
                  {plainText(cc) || '·'}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {!readOnly && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={insertRow}>
            + Row
          </button>
          <button className="btn btn-sm" onClick={deleteRow} disabled={nRows <= 1}>
            − Row
          </button>
          <button className="btn btn-sm" onClick={insertCol}>
            + Col
          </button>
          <button className="btn btn-sm" onClick={deleteCol} disabled={nCols <= 1}>
            − Col
          </button>
        </div>
      )}

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Cell content
          {binding && (
            <span className={`pill ${binding.direction === 'down' ? 'pill-accent' : 'pill-warning'}`}>
              {binding.direction === 'down' ? '↓' : binding.direction === 'up' ? '↑' : '⇅'}{' '}
              {fieldMap.get(binding.fieldId)?.name ?? 'field'}
            </span>
          )}
        </label>
        <RichTextEditor
          ref={cellEditorRef}
          value={current}
          onChange={setCurrentCell}
          readOnly={readOnly || !!boundDown}
          compact
        />
        {!readOnly && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, position: 'relative', flexWrap: 'wrap' }}>
            {binding ? (
              <>
                <select
                  className="input"
                  style={{ width: 110, height: 28 }}
                  value={binding.direction}
                  onChange={(e) =>
                    update({
                      cellBindings: (block.cellBindings ?? []).map((b) =>
                        b.row === r && b.col === c
                          ? { ...b, direction: e.target.value as SyncDirection }
                          : b,
                      ),
                    } as Partial<Block>)
                  }
                  aria-label="Cell sync direction"
                >
                  <option value="down">↓ down</option>
                  <option value="up">↑ up</option>
                  <option value="two-way">⇅ two-way</option>
                </select>
                <button className="btn btn-sm" onClick={unbindCell}>
                  Unlink cell
                </button>
              </>
            ) : (
              <FieldPicker
                fields={fields}
                target="tableCell"
                label="Bind cell to field"
                icon={<IconLink size={12} />}
                compact
                createLabel="New field from cell"
                onCreate={() => void bindCell(uuid(), true)}
                onPick={(f) => void bindCell(f.id, false)}
              />
            )}
            {/* Insert a field inside the cell's text, rather than owning
                the whole cell. */}
            {!boundDown && (
              <FieldPicker
                fields={fields}
                target="tableCell"
                label="Insert in cell"
                icon={<IconPlus size={12} />}
                compact
                onPick={(f) => {
                  void insertField(current, cellEditorRef.current?.getRange() ?? null, f.id, {
                    target: 'tableCell',
                  }).then((next) => next && setCurrentCell(next));
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Image ---------- */

export function ImageProps({ block, update }: { block: ImageBlock; update: (p: Partial<Block>) => void }) {
  const { readOnly } = useEditor();
  const { currentSpace } = useSpaces();
  const dialog = useDialog();
  const [uploading, setUploading] = useState(false);
  const [level, setLevel] = useState<CompressionLevel>(DEFAULT_COMPRESSION);
  const [saved, setSaved] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const memoFit = useMemo(() => block.fit ?? 'cover', [block.fit]);
  /** A bound block's image belongs to the field, not to this block. */
  const ownsImage = !block.binding?.fieldId;

  const onFile = async (file: File) => {
    if (!currentSpace) return;
    setUploading(true);
    setSaved(null);
    try {
      const previous = block.storagePath;
      const res = await uploadMedia(currentSpace.id, file, level);
      update({ storagePath: res.storagePath } as Partial<Block>);
      if (previous && ownsImage) await deleteMedia(previous);
      const pct = Math.round((1 - res.bytes / Math.max(1, res.originalBytes)) * 100);
      setSaved(
        res.ext === 'webp'
          ? `${formatBytes(res.originalBytes)} → ${formatBytes(res.bytes)} WebP${pct > 0 ? ` (${pct}% smaller)` : ''}`
          : `stored as-is (${formatBytes(res.bytes)})`,
      );
    } catch (e) {
      console.error(e);
      await dialog.alert('Upload failed', {
        message: (e as Error).message || 'Check that the `media` storage bucket exists.',
      });
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    const ok = await dialog.confirm('Remove this image?', {
      message: ownsImage
        ? 'The file is deleted from storage as well.'
        : 'This block follows a field, so only the local copy is cleared.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const previous = block.storagePath;
    update({ storagePath: undefined } as Partial<Block>);
    if (ownsImage) await deleteMedia(previous);
    setSaved(null);
  };

  return (
    <>
      {!readOnly && (
        <div className="field">
          <label>Image</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Compressing…' : block.storagePath ? 'Replace' : 'Upload image'}
            </button>
            {block.storagePath && (
              <button className="btn btn-danger btn-sm" onClick={() => void removeImage()} disabled={uploading}>
                <IconTrash size={12} /> Remove
              </button>
            )}
          </div>
          {saved && <span className="muted text-xs">{saved}</span>}
        </div>
      )}
      {!readOnly && (
        <div className="field">
          <label htmlFor="img-cmp">Compression</label>
          <select
            id="img-cmp"
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
            Applied on the next upload; images are stored as WebP unless you pick Original.
          </span>
        </div>
      )}
      <div className="field">
        <label>Fit</label>
        <div className="segmented">
          {(['cover', 'contain'] as const).map((f) => (
            <button
              key={f}
              disabled={readOnly}
              className={memoFit === f ? 'active' : ''}
              onClick={() => update({ fit: f } as Partial<Block>)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Alt text</label>
        <input
          className="input"
          disabled={readOnly}
          value={block.alt ?? ''}
          onChange={(e) => update({ alt: e.target.value || undefined } as Partial<Block>)}
        />
      </div>
      <div className="field">
        <label>Caption</label>
        <input
          className="input"
          disabled={readOnly}
          value={block.caption ?? ''}
          onChange={(e) => update({ caption: e.target.value || undefined } as Partial<Block>)}
        />
      </div>
    </>
  );
}

/* ---------- Shape ---------- */

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'rounded', label: 'Rounded' },
  { kind: 'circle', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'line', label: 'Line' },
  { kind: 'arrow', label: 'Arrow' },
];

const SWATCHES = ['#e61e2a', '#000054', '#15803d', '#b45309', '#16181d', '#ffffff'];

/**
 * Shapes are decoration, so this panel is purely visual — there is no
 * sync section, because a shape holds no content to share.
 */
export function ShapeProps({
  block,
  update,
}: {
  block: ShapeBlock;
  update: (p: Partial<Block>) => void;
}) {
  const { readOnly } = useEditor();

  return (
    <>
      <div className="field">
        <label htmlFor="sh-kind">Shape</label>
        <select
          id="sh-kind"
          className="input"
          disabled={readOnly}
          value={block.shape}
          onChange={(e) => update({ shape: e.target.value as ShapeKind } as Partial<Block>)}
        >
          {SHAPES.map((s) => (
            <option key={s.kind} value={s.kind}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Fill</label>
        <div className="sh-swatches">
          <button
            className={`sh-swatch none ${!block.fill || block.fill === 'none' ? 'active' : ''}`}
            title="No fill"
            aria-label="No fill"
            disabled={readOnly}
            onClick={() => update({ fill: 'none' } as Partial<Block>)}
          />
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`sh-swatch ${block.fill === c ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Fill ${c}`}
              disabled={readOnly}
              onClick={() => update({ fill: c } as Partial<Block>)}
            />
          ))}
          <label className="sh-swatch custom" title="Custom fill">
            <input
              type="color"
              disabled={readOnly}
              onChange={(e) => update({ fill: e.target.value } as Partial<Block>)}
              aria-label="Custom fill colour"
            />
          </label>
        </div>
      </div>

      <div className="field">
        <label>Outline</label>
        <div className="sh-swatches">
          <button
            className={`sh-swatch none ${block.stroke === 'none' ? 'active' : ''}`}
            title="No outline"
            aria-label="No outline"
            disabled={readOnly}
            onClick={() => update({ stroke: 'none' } as Partial<Block>)}
          />
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`sh-swatch ${block.stroke === c ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Outline ${c}`}
              disabled={readOnly}
              onClick={() => update({ stroke: c } as Partial<Block>)}
            />
          ))}
          <label className="sh-swatch custom" title="Custom outline">
            <input
              type="color"
              disabled={readOnly}
              onChange={(e) => update({ stroke: e.target.value } as Partial<Block>)}
              aria-label="Custom outline colour"
            />
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="sh-sw">Outline width</label>
          <input
            id="sh-sw"
            className="input"
            type="number"
            min={0}
            max={20}
            disabled={readOnly}
            value={block.strokeWidth ?? 2}
            onChange={(e) => update({ strokeWidth: Number(e.target.value) } as Partial<Block>)}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="sh-op">Opacity %</label>
          <input
            id="sh-op"
            className="input"
            type="number"
            min={5}
            max={100}
            disabled={readOnly}
            value={block.opacity ?? 100}
            onChange={(e) => update({ opacity: Number(e.target.value) } as Partial<Block>)}
          />
        </div>
      </div>

      <p className="muted text-xs">
        Shapes are decoration only — they are not synced between the master and its adaptations.
      </p>
    </>
  );
}
