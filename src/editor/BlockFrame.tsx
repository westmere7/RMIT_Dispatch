import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { BlockView } from '../components/editor/BlockView';
import type { Block } from '../types';
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
  onPointerDown,
  onHandlePointerDown,
  onSpanClick,
}: {
  block: Block;
  cols: number;
  rows: number;
  selected: boolean;
  editable: boolean;
  onPointerDown: (e: ReactPointerEvent, blockId: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent, blockId: string, corner: ResizeCorner) => void;
  onSpanClick?: (info: SpanClickInfo) => void;
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

  const handleClick = (e: ReactMouseEvent) => {
    if (!onSpanClick) return;
    const spanEl = (e.target as HTMLElement).closest('[data-fieldspan]');
    if (!spanEl) return;
    const fieldId = spanEl.getAttribute('data-fieldspan')!;
    const para = Number(spanEl.getAttribute('data-para') ?? 0);
    const path = JSON.parse(spanEl.getAttribute('data-path') ?? '[]') as number[];
    onSpanClick({ blockId: block.id, fieldId, para, path });
  };

  return (
    <div
      className={`block-frame ${selected ? 'selected' : ''} ${editable ? 'editable' : ''} ${
        syncedDown ? 'synced-down' : ''
      }`}
      style={style}
      onPointerDown={(e) => onPointerDown(e, block.id)}
      onClick={handleClick}
      data-block-id={block.id}
    >
      {selected && block.binding && (
        <span className={`binding-chip ${dir !== 'down' ? 'chip-warning' : ''}`}>
          {glyph} {block.binding.fieldId ? 'field' : 'master'}
        </span>
      )}
      <BlockView block={block} />
      {selected &&
        editable &&
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
