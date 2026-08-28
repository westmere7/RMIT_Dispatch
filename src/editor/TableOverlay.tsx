import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  columnPercents,
  evenTracks,
  resizeTrack,
  rowPercents,
  tableSize,
} from '../lib/tables';
import type { TableBlock } from '../types';
import { useEditor } from './EditorProvider';
import { useWorkspaceOptional } from './workspaceContext';

/* ============================================================
   Direct manipulation on a table: drag a divider to resize the
   column or row beside it.

   Sizes are percentages of the table's own box and a drag only ever
   moves size BETWEEN two neighbours, so the table never grows or
   shrinks as a side effect and the columns the author already settled
   stay put.
   ============================================================ */

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The table's box in frame coordinates.
 *
 * Measured rather than derived: `.block-content` pads by a percentage of
 * its WIDTH on all four sides, so the table's top edge cannot be worked
 * out from the frame's height. The observer catches zoom (which changes
 * the rendered width) and content growth alike.
 */
function useTableRect(frameRef: React.RefObject<HTMLElement>, dep: unknown): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const table = frame.querySelector('.block-table') as HTMLElement | null;
      if (!table) {
        setRect(null);
        return;
      }
      const f = frame.getBoundingClientRect();
      const t = table.getBoundingClientRect();
      setRect((prev) => {
        const next = {
          left: t.left - f.left,
          top: t.top - f.top,
          width: t.width,
          height: t.height,
        };
        // Identical rects must not restart the render loop.
        return prev &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.height === next.height
          ? prev
          : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    const table = frame.querySelector('.block-table');
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [frameRef, dep]);
  return rect;
}

/** Percentage span of tracks `from`..`to`, and where it starts. */
function bandOf(percents: number[], from: number, to: number): { start: number; size: number } {
  let start = 0;
  for (let i = 0; i < from; i++) start += percents[i] ?? 0;
  let size = 0;
  for (let i = from; i <= to; i++) size += percents[i] ?? 0;
  return { start, size };
}

/** Running totals, so divider i sits after track i. */
function boundaries(percents: number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < percents.length - 1; i++) {
    sum += percents[i];
    out.push(sum);
  }
  return out;
}

export function TableOverlay({
  block,
  pageId,
  frameRef,
}: {
  block: TableBlock;
  pageId: string;
  frameRef: React.RefObject<HTMLElement>;
}) {
  const { dispatch } = useEditor();
  const ws = useWorkspaceOptional();
  const rect = useTableRect(frameRef, block);
  /** The percentages the current drag started from. */
  const drag = useRef<{ axis: 'col' | 'row'; index: number; start: number; from: number[] } | null>(
    null,
  );

  const { rows: nRows, cols: nCols } = tableSize(block);
  const cols = columnPercents(block);
  const rows = rowPercents(block);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent, axis: 'col' | 'row', index: number) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = {
        axis,
        index,
        start: axis === 'col' ? e.clientX : e.clientY,
        from: axis === 'col' ? columnPercents(block) : rowPercents(block),
      };
    },
    [block],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = drag.current;
      if (!g || !rect) return;
      const span = g.axis === 'col' ? rect.width : rect.height;
      if (span <= 0) return;
      const moved = (g.axis === 'col' ? e.clientX : e.clientY) - g.start;
      const next = resizeTrack(g.from, g.index, (moved / span) * 100);
      dispatch({
        type: 'UPDATE_BLOCK',
        pageId,
        blockId: block.id,
        patch: (g.axis === 'col' ? { colWidths: next } : { rowHeights: next }) as Partial<TableBlock>,
        // One gesture, one undo step — the same rule drag and resize use.
        coalesce: `table:${block.id}:${g.axis}:${g.index}`,
      });
    },
    [rect, dispatch, pageId, block.id],
  );

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    dispatch({ type: 'END_COALESCE' });
  }, [dispatch]);

  /** Double-click a divider: even tracks again, the way Excel does. */
  const onDoubleClick = useCallback(
    (e: React.MouseEvent, axis: 'col' | 'row') => {
      e.preventDefault();
      e.stopPropagation();
      dispatch({
        type: 'UPDATE_BLOCK',
        pageId,
        blockId: block.id,
        patch: (axis === 'col'
          ? { colWidths: evenTracks(nCols) }
          : { rowHeights: evenTracks(nRows) }) as Partial<TableBlock>,
      });
    },
    [dispatch, pageId, block.id, nCols, nRows],
  );

  if (!rect || nCols === 0 || nRows === 0) return null;

  /* The ring around what the settings panel is acting on. A merge is
     followed out to its full span, or the ring would cover the anchor
     cell only and point at the wrong thing. */
  const active = ws?.activeCell?.blockId === block.id ? ws.activeCell : null;
  let ring: { left: number; top: number; width: number; height: number } | null = null;
  if (active) {
    let r0 = Math.min(active.row, active.toRow);
    let r1 = Math.max(active.row, active.toRow);
    let c0 = Math.min(active.col, active.toCol);
    let c1 = Math.max(active.col, active.toCol);
    for (const m of block.merges ?? []) {
      const hit = m.row <= r1 && m.row + m.rowSpan > r0 && m.col <= c1 && m.col + m.colSpan > c0;
      if (!hit) continue;
      r0 = Math.min(r0, m.row);
      r1 = Math.max(r1, m.row + m.rowSpan - 1);
      c0 = Math.min(c0, m.col);
      c1 = Math.max(c1, m.col + m.colSpan - 1);
    }
    const x = bandOf(cols, c0, Math.min(c1, nCols - 1));
    const y = bandOf(rows, r0, Math.min(r1, nRows - 1));
    ring = { left: x.start, top: y.start, width: x.size, height: y.size };
  }

  return (
    <div className="tbl-overlay" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      {ring && (
        <div
          className="tbl-sel"
          style={{
            left: `${ring.left}%`,
            top: `${ring.top}%`,
            width: `${ring.width}%`,
            height: `${ring.height}%`,
          }}
        />
      )}
      {boundaries(cols).map((pct, i) => (
        <div
          key={`c${i}`}
          className="tbl-grip col"
          style={{ left: `${pct}%` }}
          title={`Drag to resize column ${i + 1} · double-click for even columns`}
          onPointerDown={(e) => onPointerDown(e, 'col', i)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(e) => onDoubleClick(e, 'col')}
        />
      ))}
      {boundaries(rows).map((pct, i) => (
        <div
          key={`r${i}`}
          className="tbl-grip row"
          style={{ top: `${pct}%` }}
          title={`Drag to resize row ${i + 1} · double-click for even rows`}
          onPointerDown={(e) => onPointerDown(e, 'row', i)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(e) => onDoubleClick(e, 'row')}
        />
      ))}
    </div>
  );
}
