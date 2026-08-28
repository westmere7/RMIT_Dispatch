import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { BlockView } from '../components/editor/BlockView';
import { InlineTableEditor } from '../components/editor/InlineTableEditor';
import { InlineTextEditor, type InlineEditorHandle } from '../components/editor/InlineTextEditor';
import { isContentLocked } from '../lib/syncfields';
import type { Block } from '../types';
import { TableOverlay } from './TableOverlay';
import type { ResizeCorner } from './useDragResize';
import { useWorkspaceOptional } from './workspaceContext';

export interface SpanClickInfo {
  blockId: string;
  fieldId: string;
  para: number;
  path: number[];
}

const CORNERS: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

/**
 * Does the text block's copy exceed its box? `.block-content` clips, so
 * the overflow shows up as scrollHeight beyond clientHeight. Both the
 * static view and the inline editor use that element, so the marker
 * behaves the same while typing.
 *
 * The ResizeObserver catches box and zoom changes; `dep` catches content
 * edits, which can overflow without changing the element's own size.
 */
function useTextOverflow(
  frameRef: React.RefObject<HTMLElement>,
  enabled: boolean,
  dep: unknown,
): boolean {
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    if (!enabled) {
      setOver(false);
      return;
    }
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const el = frame.querySelector('.block-content') as HTMLElement | null;
      if (!el) return;
      // A pixel of slack: sub-pixel line metrics otherwise flicker it on.
      setOver(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    const content = frame.querySelector('.block-content');
    if (content) ro.observe(content);
    return () => ro.disconnect();
  }, [frameRef, enabled, dep]);
  return over;
}

export function BlockFrame({
  block,
  pageId,
  cols,
  rows,
  selected,
  editable,
  editing,
  onPointerDown,
  onHandlePointerDown,
  onSpanClick,
  onEnteredField,
  onStartEdit,
  onContentChange,
  onContextMenu,
  editorRef,
}: {
  block: Block;
  pageId: string;
  cols: number;
  rows: number;
  selected: boolean;
  editable: boolean;
  editing: boolean;
  onPointerDown: (e: ReactPointerEvent, blockId: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent, blockId: string, corner: ResizeCorner) => void;
  onSpanClick?: (info: SpanClickInfo) => void;
  onEnteredField?: (fieldId: string | null) => void;
  onStartEdit?: (blockId: string) => void;
  onContentChange?: (blockId: string, patch: Partial<Block>) => void;
  onContextMenu?: (e: ReactMouseEvent, blockId: string, fieldId: string | null) => void;
  editorRef?: React.RefObject<InlineEditorHandle>;
}) {
  const { pos } = block;
  const style = {
    left: `${(pos.col / cols) * 100}%`,
    top: `${(pos.row / rows) * 100}%`,
    width: `${(pos.w / cols) * 100}%`,
    height: `${(pos.h / rows) * 100}%`,
  };

  const dir = block.binding?.direction;
  // The read-only tint marks content this document does not own — a
  // `down` binding only. `up` / `two-way` blocks are authored here.
  const syncedDown = editable && isContentLocked(block.binding);
  const glyph = dir === 'down' ? '↓' : dir === 'up' ? '↑' : dir === 'two-way' ? '⇅' : '';
  const isText = block.type === 'text';

  const isTable = block.type === 'table';
  const ws = useWorkspaceOptional();

  const innerRef = useRef<HTMLDivElement>(null);
  const textOverflow = useTextOverflow(innerRef, isText, block);

  // Focus the inline editor when an edit session opens.
  useEffect(() => {
    if (editing) editorRef?.current?.focus();
  }, [editing, editorRef]);

  const handleClick = (e: ReactMouseEvent) => {
    // A click on a table cell selects it, so the settings panel and the
    // canvas always act on the same cell. Shift extends the selection,
    // which is what merging works on.
    if (isTable && ws) {
      const cellEl = (e.target as HTMLElement).closest('[data-cell-row]');
      if (cellEl) {
        const row = Number(cellEl.getAttribute('data-cell-row'));
        const col = Number(cellEl.getAttribute('data-cell-col'));
        const from = e.shiftKey && ws.activeCell?.blockId === block.id ? ws.activeCell : null;
        ws.setActiveCell({
          blockId: block.id,
          row: from ? from.row : row,
          col: from ? from.col : col,
          toRow: row,
          toCol: col,
        });
      }
    }
    if (!onSpanClick) return;
    const spanEl = (e.target as HTMLElement).closest('[data-fieldspan],[data-field]');
    if (!spanEl) return;
    const fieldId =
      spanEl.getAttribute('data-fieldspan') ?? spanEl.getAttribute('data-field') ?? '';
    if (!fieldId) return;
    const para = Number(spanEl.getAttribute('data-para') ?? 0);
    const path = JSON.parse(spanEl.getAttribute('data-path') ?? '[]') as number[];
    onSpanClick({ blockId: block.id, fieldId, para, path });
  };

  return (
    <div
      ref={innerRef}
      className={`block-frame ${selected ? 'selected' : ''} ${editable ? 'editable' : ''} ${
        syncedDown ? 'synced-down' : ''
      } ${editing ? 'editing' : ''}`}
      style={style}
      onPointerDown={(e) => {
        // While editing, pointer events belong to the text caret.
        if (editing && (e.target as HTMLElement).closest('.inline-editor')) return;
        onPointerDown(e, block.id);
      }}
      onDoubleClick={(e) => {
        // Text blocks and tables open for inline editing on double click
        if (!editable || (!isText && !isTable)) return;
        e.stopPropagation();
        onStartEdit?.(block.id);
      }}
      onClick={handleClick}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        const spanEl = (e.target as HTMLElement).closest('[data-fieldspan],[data-field]');
        const fieldId =
          spanEl?.getAttribute('data-fieldspan') ?? spanEl?.getAttribute('data-field') ?? null;
        onContextMenu(e, block.id, fieldId);
      }}
      data-block-id={block.id}
    >
      {/* Illustrator's overflow marker: the copy does not fit its box. */}
      {textOverflow && (
        <span
          className="overflow-mark"
          title="Text overflows this box — enlarge the box or shorten the copy"
          aria-label="Text overflows this box"
        >
          +
        </span>
      )}

      {selected && block.binding && (
        <span className={`binding-chip ${dir !== 'down' ? 'chip-warning' : ''}`}>
          {glyph} {block.binding.fieldId ? 'field' : 'master'}
        </span>
      )}

      {editing && isText ? (
        <InlineTextEditor
          ref={editorRef}
          body={block.body}
          size={block.size}
          align={block.align}
          bold={block.bold}
          color={block.color}
          onChange={(body) => onContentChange?.(block.id, { body })}
          onSpanClick={(info) => onSpanClick?.({ blockId: block.id, ...info })}
          onEnteredField={onEnteredField}
        />
      ) : editing && isTable ? (
        <InlineTableEditor
          block={block}
          onChange={(patch) => onContentChange?.(block.id, patch as Partial<Block>)}
          onSpanClick={(info) => onSpanClick?.({ blockId: block.id, ...info })}
          onEnteredField={onEnteredField}
          activeCell={ws?.activeCell?.blockId === block.id ? ws.activeCell : null}
        />
      ) : (
        <BlockView block={block} />
      )}

      {/* Sizing is the block's own look, never the field's, so it stays
          available on a table whose CONTENT follows a sync field. */}
      {selected && editable && isTable && (
        <TableOverlay block={block} pageId={pageId} frameRef={innerRef} />
      )}

      {selected && editable && !editing && (isTable || isText) && (
        <span className="edit-hint">double-click to edit</span>
      )}

      {selected &&
        editable &&
        !editing &&
        CORNERS.map((c) => (
          <div
            key={c}
            className={`resize-handle ${c}`}
            onPointerDown={(e) => onHandlePointerDown(e, block.id, c)}
          />
        ))}
    </div>
  );
}
