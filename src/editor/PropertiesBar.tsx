import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FieldMenu } from '../components/editor/FieldMenu';
import {
  ImageProps,
  SIZES,
  ShapeProps,
  TableProps,
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
import { blockTarget } from '../lib/fieldtypes';
import { rangeFromSelection, restoreSelectionSoon } from '../lib/richdom';
import { SIZE_LABEL } from '../lib/textsize';
import {
  applyMark,
  applyMarkAll,
  rangeHasMark,
  rangeSize,
  richHasMark,
  type MarkPatch,
  type TextRange,
} from '../lib/richtext';
import type { Block, RichText, TextAlign, TextBlock, TextSize } from '../types';
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
function canvasRoot(blockId: string): HTMLElement | null {
  return document.querySelector(`[data-block-id="${blockId}"] .inline-editor-body`);
}

export function PropertiesBar({ enteredField }: { enteredField?: string | null }) {
  const { state, readOnly, currentPage } = useEditor();
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

  return (
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
          block={block}
          pageId={pageId}
          editing={editing}
          enteredField={enteredField}
        />
      )}

      {block.type === 'table' && (
        <>
          <span className="bar-sep" />
          <label className="pb-check">
            <input
              type="checkbox"
              checked={block.headerRow}
              disabled={readOnly}
              onChange={(e) => update({ headerRow: e.target.checked } as Partial<Block>)}
            />
            Header row
          </label>
          <BarPopover label="Cells" icon={<IconTable size={12} />} wide>
            <TableProps block={block} update={update} pageId={pageId} />
          </BarPopover>
        </>
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
 * Text controls: character formatting applies to the live selection, or
 * to the whole block when there is none — the word-processor rule, and
 * the reason these live in a bar rather than a side panel.
 */
function TextControls({
  block,
  pageId,
  editing,
  enteredField,
}: {
  block: TextBlock;
  pageId: string;
  editing: boolean;
  enteredField?: string | null;
}) {
  const { dispatch, readOnly } = useEditor();
  const { fieldMap } = useWorkspace();
  const boundDown = block.binding && block.binding.direction !== 'up';
  const locked = readOnly || !!boundDown;

  const setBody = (body: RichText) =>
    dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch: { body } });

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
  const applySize = (size: TextSize) => {
    const r = range();
    if (r) {
      setBody(applyMark(block.body, r, { size }));
      keep(r);
      return;
    }
    dispatch({
      type: 'UPDATE_BLOCK',
      pageId,
      blockId: block.id,
      patch: { size, body: applyMarkAll(block.body, { size: undefined }) },
    });
  };
  const activeSize = (): TextSize => {
    const r = range();
    return (r ? rangeSize(block.body, r) : null) ?? block.size ?? 'md';
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
            onClick={() =>
              dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch: { align: a } })
            }
          >
            <Icon size={12} />
          </button>
        ))}
      </div>

      {!locked && (
        <>
          <span className="bar-sep" />
          <FieldMenu
            compact
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
            Edit text
          </button>
        )
      )}
    </>
  );
}
