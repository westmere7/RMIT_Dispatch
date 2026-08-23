import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { BlockView } from '../components/editor/BlockView';
import { InlineTextEditor, type InlineEditorHandle } from '../components/editor/InlineTextEditor';
import type { Block, RichText } from '../types';
import type { ResizeCorner } from './useDragResize';

export interface SpanClickInfo {
  blockId: string;
  fieldId: string;
  para: number;
  path: number[];
}

const CORNERS: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

export function BlockFrame({
  block,
  cols,
  rows,
  selected,
  editable,
  editing,
  onPointerDown,
  onHandlePointerDown,
  onSpanClick,
  onStartEdit,
  onBodyChange,
  onContextMenu,
  editorRef,
}: {
  block: Block;
  cols: number;
  rows: number;
  selected: boolean;
  editable: boolean;
  editing: boolean;
  onPointerDown: (e: ReactPointerEvent, blockId: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent, blockId: string, corner: ResizeCorner) => void;
  onSpanClick?: (info: SpanClickInfo) => void;
  onStartEdit?: (blockId: string) => void;
  onBodyChange?: (blockId: string, body: RichText) => void;
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
  const syncedDown = editable && dir && dir !== 'up';
  const glyph = dir === 'down' ? '↓' : dir === 'up' ? '↑' : dir === 'two-way' ? '⇅' : '';
  const isText = block.type === 'text';
  const bodyLocked = !!syncedDown;

  const innerRef = useRef<HTMLDivElement>(null);

  // Focus the inline editor when an edit session opens.
  useEffect(() => {
    if (editing) editorRef?.current?.focus();
  }, [editing, editorRef]);

  const handleClick = (e: ReactMouseEvent) => {
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
        if (!editable || !isText || bodyLocked) return;
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
      {selected && block.binding && (
        <span className={`binding-chip ${dir !== 'down' ? 'chip-warning' : ''}`}>
          {glyph} {block.binding.fieldId ? 'field' : 'master'}
        </span>
      )}

      {editing && isText ? (
        <InlineTextEditor
          ref={editorRef}
          block={block}
          onChange={(body) => onBodyChange?.(block.id, body)}
          onSpanClick={(info) => onSpanClick?.({ blockId: block.id, ...info })}
        />
      ) : (
        <BlockView block={block} />
      )}

      {selected && editable && !editing && isText && !bodyLocked && (
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
