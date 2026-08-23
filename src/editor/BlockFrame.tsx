import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  onEnteredField?: (fieldId: string | null) => void;
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
  const textOverflow = useTextOverflow(innerRef, isText, block);

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
          block={block}
          onChange={(body) => onBodyChange?.(block.id, body)}
          onSpanClick={(info) => onSpanClick?.({ blockId: block.id, ...info })}
          onEnteredField={onEnteredField}
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
