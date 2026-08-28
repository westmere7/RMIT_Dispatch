import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FieldMenu } from '../components/editor/FieldMenu';
import { TableBar } from '../components/editor/TableBar';
import {
  ImageProps,
  SIZES,
  ShapeProps,
  activeEditorRoot,
  liveRangeFor,
} from '../components/editor/BlockProps';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconBringFront,
  IconCopy,
  IconImage,
  IconItalic,
  IconLink,
  IconSendBack,
  IconShapes,
  IconSliders,
  IconTable,
  IconTrash,
  IconType,
  IconUnlink,
} from '../components/Icons';
import { FieldPicker } from '../components/editor/FieldPicker';
import { blockTarget, type FieldTarget } from '../lib/fieldtypes';
import { rangeFromSelection, restoreSelectionSoon } from '../lib/richdom';
import { emptyRich } from '../lib/richtext';
import { cellFormatAt, cellsIn, setCellContent, setCellFormat, tableSize } from '../lib/tables';
import { SIZE_LABEL } from '../lib/textsize';
import {
  applyMark,
  applyMarkAll,
  plainText,
  rangeHasMark,
  rangeSize,
  richHasMark,
  type MarkPatch,
  type TextRange,
} from '../lib/richtext';
import type { Block, RichText, TableBlock, TextAlign, TextSize } from '../types';
import { useEditor } from './EditorProvider';
import { useFieldOps } from './useFieldOps';
import { useWorkspace } from './workspaceContext';

/* ============================================================
   Contextual properties bar.

   Everything that used to live in the right-hand Properties tab is
   here, above the canvas, next to the thing it acts on. Frequent
   controls sit inline; the longer-form editors (table cells, image
   upload, shape styling) open in a popover anchored to their button,
   so nothing was lost in the move.
   ============================================================ */

/** A bar button that opens an anchored panel. */
function BarPopover({
  label,
  icon,
  children,
  wide,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="pb-pop-wrap" ref={wrapRef}>
      <button
        className={`btn btn-sm ${open ? 'active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon} {label}
      </button>
      {open && (
        <div className={`pb-pop ${wide ? 'wide' : ''}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </span>
  );
}

/** The live text selection inside a block's on-canvas editor. */
const canvasRoot = activeEditorRoot;

export function PropertiesBar({ enteredField }: { enteredField?: string | null }) {
  const { state, dispatch, readOnly, currentPage } = useEditor();
  // Nothing here does anything without the lock, so in view-only mode the
  // bar is not shown at all and the canvas gets the row back.
  if (!currentPage || readOnly) return null;

  const sel = state.selection;
  const blocks = currentPage.blocks.filter((b) => sel.includes(b.id));
  const editing = state.editingBlockId
    ? currentPage.blocks.find((b) => b.id === state.editingBlockId)
    : undefined;
  // While editing text on the canvas the bar follows that block, even if
  // the click that started the edit changed the selection.
  const single = editing ?? (blocks.length === 1 ? blocks[0] : undefined);

  const table = single?.type === 'table' ? single : null;

  return (
    <div className="properties-stack">
      <div className="canvas-format-bar properties-bar">
      {!single && blocks.length === 0 && (
        <>
          <span className="pb-kind">
            <IconSliders size={12} /> Page
          </span>
          <span className="text-xs muted">
            {state.grid.pageSize} {state.grid.orientation} · {state.grid.columns}×
            {state.grid.rows} · {currentPage.kind}
          </span>
          <span className="text-xs muted" style={{ marginLeft: 'auto' }}>
            Select a block to edit it — shift-click for more than one.
          </span>
        </>
      )}

      {!single && blocks.length > 1 && (
        <MultiControls ids={sel} pageId={currentPage.id} count={blocks.length} />
      )}

      {single && (
        <SingleControls
          block={single}
          pageId={currentPage.id}
          editing={!!editing}
          enteredField={enteredField}
        />
      )}
      </div>

      {/* A table's own controls get a row of their own: crowded into the
          text row they pushed the formatting buttons off the end. */}
      {table && !readOnly && (
        <div className="canvas-format-bar properties-bar table-bar">
          <span className="pb-kind">
            <IconTable size={12} /> Table
          </span>
          <TableBar
            block={table}
            pageId={currentPage.id}
            update={(p) =>
              dispatch({ type: 'UPDATE_BLOCK', pageId: currentPage.id, blockId: table.id, patch: p })
            }
          />
        </div>
      )}
    </div>
  );
}

function MultiControls({
  ids,
  pageId,
  count,
}: {
  ids: string[];
  pageId: string;
  count: number;
}) {
  const { dispatch, readOnly } = useEditor();
  return (
    <>
      <span className="pb-kind">{count} selected</span>
      {!readOnly && (
        <>
          <span className="bar-sep" />
          <button
            className="btn btn-sm"
            onClick={() => dispatch({ type: 'REORDER_BLOCK', pageId, blockId: ids[0], to: 'front' })}
            title="Bring the first selected block to the front"
          >
            <IconBringFront size={13} /> Front
          </button>
          <button
            className="btn btn-sm"
            onClick={() => dispatch({ type: 'DUPLICATE_BLOCKS', pageId, ids })}
          >
            <IconCopy size={13} /> Duplicate
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => dispatch({ type: 'DELETE_BLOCKS', pageId, ids })}
          >
            <IconTrash size={13} /> Delete
          </button>
        </>
      )}
      <span className="text-xs muted" style={{ marginLeft: 'auto' }}>
        Sync and per-block settings need a single block.
      </span>
    </>
  );
}

const KINDS: Record<string, { label: string; icon: ReactNode }> = {
  text: { label: 'Text', icon: <IconType size={12} /> },
  table: { label: 'Table', icon: <IconTable size={12} /> },
  image: { label: 'Image', icon: <IconImage size={12} /> },
  shape: { label: 'Shape', icon: <IconShapes size={12} /> },
};

function SingleControls({
  block,
  pageId,
  editing,
  enteredField,
}: {
  block: Block;
  pageId: string;
  editing: boolean;
  enteredField?: string | null;
}) {
  const { dispatch, readOnly } = useEditor();
  const kind = KINDS[block.type] ?? { label: block.type, icon: null };
  const update = (patch: Partial<Block>) =>
    dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch });

  return (
    <>
      <span className="pb-kind">
        {kind.icon} {kind.label}
      </span>

      <BlockSync block={block} pageId={pageId} />

      {block.type === 'text' && (
        <TextControls
          blockId={block.id}
          rich={block.body}
          setRich={(body) => update({ body } as Partial<Block>)}
          locked={readOnly}
          size={block.size}
          setSize={(size, cleared) => update({ size, body: cleared } as Partial<Block>)}
          align={block.align}
          setAlign={(a) => update({ align: a } as Partial<Block>)}
          editing={editing}
          enteredField={enteredField}
        />
      )}

      {/* A cell is text, so it gets the very same controls — aimed at
          whichever cell the author last clicked. */}
      {block.type === 'table' && (
        <TableTextControls
          block={block}
          update={update}
          editing={editing}
          enteredField={enteredField}
        />
      )}

      {block.type === 'image' && (
        <>
          <span className="bar-sep" />
          <div className="segmented" style={{ padding: 2 }}>
            {(['cover', 'contain'] as const).map((f) => (
              <button
                key={f}
                className={(block.fit ?? 'cover') === f ? 'active' : ''}
                style={{ height: 22, padding: '0 8px', fontSize: 11 }}
                disabled={readOnly}
                onClick={() => update({ fit: f } as Partial<Block>)}
              >
                {f}
              </button>
            ))}
          </div>
          <BarPopover label="Image" icon={<IconImage size={12} />} wide>
            <ImageProps block={block} update={update} />
          </BarPopover>
        </>
      )}

      {block.type === 'shape' && (
        <>
          <span className="bar-sep" />
          <BarPopover label="Shape style" icon={<IconShapes size={12} />} wide>
            <ShapeProps block={block} update={update} />
          </BarPopover>
        </>
      )}

      {!readOnly && (
        <>
          <span className="bar-sep" style={{ marginLeft: 'auto' }} />
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
    </>
  );
}

/** Field state for the block: promote, bind, or jump to the Sync tab. */
function BlockSync({ block, pageId }: { block: Block; pageId: string }) {
  const { dispatch, readOnly } = useEditor();
  const { fields, setTab } = useWorkspace();
  const { createFieldFromBlock, bindBlockToField } = useFieldOps();
  const target = blockTarget(block);
  if (readOnly || !target) return null;

  const patch = (p: Partial<Block>) =>
    dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch: p });

  if (block.binding) {
    return (
      <>
        <span className="bar-sep" />
        <button
          className="pill pill-accent pb-pill-btn"
          title="Open the sync panel for this block"
          onClick={() => setTab('sync')}
        >
          <IconLink size={11} />{' '}
          {block.binding.fieldId ? 'synced to field' : 'follows master'}
        </button>
        <button
          className="icon-btn"
          title="Unlink this block, keeping a plain copy"
          aria-label="Unlink block"
          onClick={() => patch({ binding: undefined })}
        >
          <IconUnlink size={13} />
        </button>
      </>
    );
  }

  return (
    <>
      <span className="bar-sep" />
      <button
        className="btn btn-sm"
        title="Create a sync field from this block's content"
        onClick={() => void createFieldFromBlock(block).then((p) => p && patch(p))}
      >
        <IconLink size={12} /> Make field
      </button>
      <FieldPicker
        fields={fields}
        target={target}
        label="Use field"
        compact
        onPick={(f) => void bindBlockToField(block, f.id).then((p) => p && patch(p))}
      />
    </>
  );
}

/**
 * The text controls, aimed at the table cells the author last selected.
 *
 * Alignment and size are written to the CELL rather than to its runs:
 * a paragraph's line box is at least as tall as its own font-size, so
 * setting a size on runs alone leaves small text sitting in a tall line
 * — the "why is the leading bigger when the text is smaller" bug. A
 * text block puts its size on the block for exactly the same reason.
 */
function TableTextControls({
  block,
  update,
  editing,
  enteredField,
}: {
  block: TableBlock;
  update: (p: Partial<Block>) => void;
  editing: boolean;
  enteredField?: string | null;
}) {
  const { readOnly } = useEditor();
  const { activeCell } = useWorkspace();
  const { rows: nRows, cols: nCols } = tableSize(block);
  const sel = activeCell?.blockId === block.id ? activeCell : null;
  const clampR = (v: number) => Math.min(Math.max(0, v), Math.max(0, nRows - 1));
  const clampC = (v: number) => Math.min(Math.max(0, v), Math.max(0, nCols - 1));
  const r = clampR(sel?.row ?? 0);
  const c = clampC(sel?.col ?? 0);
  const range = cellsIn({ row: r, col: c }, { row: clampR(sel?.toRow ?? r), col: clampC(sel?.toCol ?? c) });

  const rich = block.rows[r]?.[c] ?? emptyRich();
  const fmt = cellFormatAt(block, r, c);

  return (
    <TextControls
      blockId={block.id}
      rich={rich}
      setRich={(next) => update({ rows: setCellContent(block, r, c, next) } as Partial<Block>)}
      locked={readOnly}
      // A field embedded here belongs to this cell, not to running text.
      fieldTarget="tableCell"
      size={fmt?.size}
      setSize={(size, cleared) =>
        update({
          cellFormats: setCellFormat(block, range, { size }),
          rows: setCellContent(block, r, c, cleared),
        } as Partial<Block>)
      }
      align={fmt?.align}
      setAlign={(a) => update({ cellFormats: setCellFormat(block, range, { align: a }) } as Partial<Block>)}
      editing={editing}
      enteredField={enteredField}
    />
  );
}

/**
 * Text controls: character formatting applies to the live selection, or
 * to the whole of what is being edited when there is none — the
 * word-processor rule, and the reason these live in a bar rather than a
 * side panel.
 *
 * They take the TEXT rather than a text block, because a table cell is
 * text too: selecting a table and clicking a cell has to reach the same
 * bold, colour, size and field controls as any other copy in the
 * document.
 */
function TextControls({
  blockId,
  rich,
  setRich,
  locked,
  fieldTarget = 'inline',
  size,
  setSize,
  align,
  setAlign,
  editing,
  enteredField,
}: {
  blockId: string;
  rich: RichText;
  setRich: (r: RichText) => void;
  locked: boolean;
  /** Where an embed created here lands — a cell is not running text. */
  fieldTarget?: FieldTarget;
  size?: TextSize;
  setSize?: (size: TextSize, cleared: RichText) => void;
  align?: TextAlign;
  setAlign?: (a: TextAlign) => void;
  editing: boolean;
  enteredField?: string | null;
}) {
  const { dispatch, readOnly } = useEditor();
  const { fieldMap } = useWorkspace();

  const setBody = setRich;
  const block = { id: blockId, body: rich, align, size };

  const range = () => liveRangeFor(block.id, undefined);

  /**
   * Keep the user's selection after a formatting change. Marking
   * re-renders the editor, which drops the DOM selection — and losing it
   * means re-selecting the same words for every single mark.
   */
  const keep = (r: TextRange) => restoreSelectionSoon(() => canvasRoot(block.id), r);

  const mark = (patch: MarkPatch) => {
    const r = range();
    setBody(r ? applyMark(block.body, r, patch) : applyMarkAll(block.body, patch));
    if (r) keep(r);
  };
  const toggle = (m: 'bold' | 'italic') => {
    const r = range();
    mark({ [m]: !(r ? rangeHasMark(block.body, r, m) : richHasMark(block.body, m)) });
  };
  /**
   * Selecting ALL of the text and picking a size means the same thing as
   * picking one with nothing selected, so both set the container's size
   * rather than marking runs.
   *
   * That is not a nicety. A paragraph's line box is at least as tall as
   * the paragraph's own font-size, so runs marked small inside a
   * normal-size paragraph sit in a tall line and read as though the
   * leading had been opened up — which is exactly what select-all-then-
   * shrink produced in a table cell.
   */
  const coversEverything = (r: TextRange | null): boolean =>
    !r || (block.body.length === 1 && r.para === 0 && r.start === 0 && r.end >= plainText(block.body).length);

  const applySize = (next: TextSize) => {
    const r = range();
    if (r && !coversEverything(r)) {
      setBody(applyMark(block.body, r, { size: next }));
      keep(r);
      return;
    }
    // The container carries the size and its runs are cleared, so the
    // text reads evenly and the line box matches what is in it.
    const cleared = applyMarkAll(block.body, { size: undefined });
    if (setSize) setSize(next, cleared);
    else setBody(applyMarkAll(block.body, { size: next }));
    if (r) keep(r);
  };
  const activeSize = (): TextSize => {
    const r = range();
    if (r && !coversEverything(r)) return rangeSize(block.body, r) ?? block.size ?? 'md';
    return block.size ?? 'md';
  };

  return (
    <>
      {/* Unmistakable while a field's text is open for editing: the span
          itself is outlined on the canvas, and this says which one. */}
      {enteredField && (
        <>
          <span className="bar-sep" />
          <span className="pill pb-entered" title="Esc leaves the field">
            <IconLink size={11} /> editing field ·{' '}
            {fieldMap.get(enteredField)?.name ?? 'field'} · Esc
          </span>
        </>
      )}

      <span className="bar-sep" />
      <button
        className="icon-btn"
        title="Bold"
        aria-label="Bold"
        disabled={locked}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => toggle('bold')}
      >
        <IconBold size={13} />
      </button>
      <button
        className="icon-btn"
        title="Italic"
        aria-label="Italic"
        disabled={locked}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => toggle('italic')}
      >
        <IconItalic size={13} />
      </button>
      <label className="icon-btn" title="Text colour" style={{ position: 'relative', cursor: 'pointer' }}>
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
          aria-label="Text colour"
          disabled={locked}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => mark({ color: e.target.value })}
        />
      </label>
      <button
        className="icon-btn"
        title="Clear formatting"
        aria-label="Clear formatting"
        disabled={locked}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => mark({ bold: undefined, italic: undefined, color: undefined, size: undefined })}
      >
        <span style={{ fontSize: 11 }}>⌀</span>
      </button>

      <span className="bar-sep" />
      <div className="segmented" style={{ padding: 2 }}>
        {SIZES.map((s) => (
          <button
            key={s}
            className={activeSize() === s ? 'active' : ''}
            style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            disabled={locked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applySize(s)}
          >
            {SIZE_LABEL[s]}
          </button>
        ))}
      </div>

      {setAlign && (
        <>
          <span className="bar-sep" />
          <div className="segmented" style={{ padding: 2 }}>
            {(
              [
                ['left', IconAlignLeft],
                ['center', IconAlignCenter],
                ['right', IconAlignRight],
              ] as [TextAlign, typeof IconAlignLeft][]
            ).map(([a, Icon]) => (
              <button
                key={a}
                className={(block.align ?? 'left') === a ? 'active' : ''}
                style={{ height: 22, padding: '0 7px' }}
                aria-label={`Align ${a}`}
                disabled={readOnly}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setAlign(a)}
              >
                <Icon size={12} />
              </button>
            ))}
          </div>
        </>
      )}

      {!locked && (
        <>
          <span className="bar-sep" />
          <FieldMenu
            compact
            target={fieldTarget}
            getRange={() => rangeFromSelection(canvasRoot(block.id))}
            rich={block.body}
            onRich={setBody}
          />
        </>
      )}

      <span className="bar-sep" />
      {editing ? (
        <button
          className="btn btn-sm"
          onClick={() => dispatch({ type: 'EDIT_TEXT', blockId: null })}
        >
          Done
        </button>
      ) : (
        !locked && (
          <button
            className="btn btn-sm"
            title="Edit the text on the canvas"
            onClick={() => dispatch({ type: 'EDIT_TEXT', blockId: block.id })}
          >
            Edit
          </button>
        )
      )}
    </>
  );
}
