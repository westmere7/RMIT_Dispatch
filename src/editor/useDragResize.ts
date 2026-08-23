import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { effectiveColumns } from '../grid/presets';
import { clampPos } from '../lib/blocks';
import type { GridPos } from '../types';
import { useEditor } from './EditorProvider';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

interface GestureData {
  mode: 'move' | 'resize';
  pageId: string;
  startX: number;
  startY: number;
  /** Captured start positions of every selected block (move) or the
      single resized block. */
  starts: { id: string; pos: GridPos }[];
  corner?: ResizeCorner;
  lastDCol: number;
  lastDRow: number;
  moved: boolean;
}

/**
 * Pointer-based move + resize with pointer capture. Pixel deltas are
 * converted to CELL deltas from the LIVE measured surface rect (so the
 * math is automatically zoom-correct), snapped to whole cells, and a
 * position update is dispatched ONLY when the cell delta changes.
 */
export function useDragResize(surfaceRef: RefObject<HTMLElement>) {
  const { state, dispatch, readOnly, currentPage } = useEditor();
  const gesture = useRef<GestureData | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;

  const cellSize = useCallback(() => {
    const el = surfaceRef.current;
    const page = pageRef.current;
    if (!el || !page) return null;
    const rect = el.getBoundingClientRect();
    const cols = effectiveColumns(stateRef.current.grid, page.kind);
    const rows = stateRef.current.grid.rows;
    if (rect.width === 0 || rect.height === 0) return null;
    return { cellW: rect.width / cols, cellH: rect.height / rows, cols, rows };
  }, [surfaceRef]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const cs = cellSize();
      if (!cs) return;
      const dCol = Math.round((e.clientX - g.startX) / cs.cellW);
      const dRow = Math.round((e.clientY - g.startY) / cs.cellH);
      if (dCol === g.lastDCol && dRow === g.lastDRow) return; // natural throttle
      g.lastDCol = dCol;
      g.lastDRow = dRow;
      if (dCol !== 0 || dRow !== 0) g.moved = true;

      if (g.mode === 'move') {
        const positions = g.starts.map(({ id, pos }) => ({
          id,
          pos: clampPos({ ...pos, col: pos.col + dCol, row: pos.row + dRow }, cs.cols, cs.rows),
        }));
        dispatch({ type: 'SET_POSITIONS', pageId: g.pageId, positions });
      } else {
        const { id, pos } = g.starts[0];
        let { col, row, w, h } = pos;
        const c = g.corner!;
        if (c === 'se') {
          w = pos.w + dCol;
          h = pos.h + dRow;
        } else if (c === 'sw') {
          col = pos.col + dCol;
          w = pos.w - dCol;
          h = pos.h + dRow;
        } else if (c === 'ne') {
          w = pos.w + dCol;
          row = pos.row + dRow;
          h = pos.h - dRow;
        } else {
          col = pos.col + dCol;
          w = pos.w - dCol;
          row = pos.row + dRow;
          h = pos.h - dRow;
        }
        // Keep the anchored edge fixed when the size bottoms out.
        if (w < 1) {
          if (c === 'sw' || c === 'nw') col = pos.col + pos.w - 1;
          w = 1;
        }
        if (h < 1) {
          if (c === 'ne' || c === 'nw') row = pos.row + pos.h - 1;
          h = 1;
        }
        dispatch({
          type: 'SET_POSITIONS',
          pageId: g.pageId,
          positions: [{ id, pos: clampPos({ col, row, w, h }, cs.cols, cs.rows) }],
        });
      }
    },
    [cellSize, dispatch],
  );

  const endGesture = useCallback((e: PointerEvent) => {
    const target = e.target as HTMLElement;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', endGesture);
    target.removeEventListener('pointercancel', endGesture);
    gesture.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMove]);

  /** pointerdown on a block: select + begin a move gesture. */
  const onBlockPointerDown = useCallback(
    (e: ReactPointerEvent, blockId: string) => {
      const page = pageRef.current;
      if (!page) return;
      if (e.button !== 0) return;

      // Selection happens on pointerdown; shift-click toggles.
      let selection = stateRef.current.selection;
      if (e.shiftKey) {
        dispatch({ type: 'TOGGLE_SELECT', id: blockId });
        return; // shift-click is selection-only, never a drag
      }
      if (!selection.includes(blockId)) {
        selection = [blockId];
        dispatch({ type: 'SELECT', ids: selection });
      }
      if (readOnly) return;

      const blocks = page.blocks.filter((b) => selection.includes(b.id));
      if (blocks.length === 0) return;

      e.preventDefault();
      const target = e.target as HTMLElement;
      target.setPointerCapture(e.pointerId);
      gesture.current = {
        mode: 'move',
        pageId: page.id,
        startX: e.clientX,
        startY: e.clientY,
        starts: blocks.map((b) => ({ id: b.id, pos: { ...b.pos } })),
        lastDCol: 0,
        lastDRow: 0,
        moved: false,
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', endGesture);
      target.addEventListener('pointercancel', endGesture);
    },
    [dispatch, readOnly, onMove, endGesture],
  );

  /** pointerdown on a corner handle: begin a resize gesture. */
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, blockId: string, corner: ResizeCorner) => {
      const page = pageRef.current;
      if (!page || readOnly || e.button !== 0) return;
      const block = page.blocks.find((b) => b.id === blockId);
      if (!block) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      target.setPointerCapture(e.pointerId);
      gesture.current = {
        mode: 'resize',
        pageId: page.id,
        startX: e.clientX,
        startY: e.clientY,
        starts: [{ id: blockId, pos: { ...block.pos } }],
        corner,
        lastDCol: 0,
        lastDRow: 0,
        moved: false,
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', endGesture);
      target.addEventListener('pointercancel', endGesture);
    },
    [readOnly, onMove, endGesture],
  );

  return { onBlockPointerDown, onHandlePointerDown };
}
