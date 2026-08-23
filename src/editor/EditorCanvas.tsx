import { useEffect, useRef, useState } from 'react';
import { canvasAspect } from '../grid/presets';
import { useSize } from '../lib/useSize';
import { IconZoomIn, IconZoomOut } from '../components/Icons';
import type { SpanClickInfo } from './BlockFrame';
import { useEditor } from './EditorProvider';
import { PageSurface } from './PageSurface';
import { useDragResize } from './useDragResize';
import './canvas.css';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const STAGE_PAD = 64;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

export function EditorCanvas({ onSpanClick }: { onSpanClick?: (info: SpanClickInfo) => void }) {
  const { state, dispatch, readOnly, currentPage } = useEditor();
  const [stageRef, stageSize] = useSize<HTMLDivElement>();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const { onBlockPointerDown, onHandlePointerDown } = useDragResize(surfaceRef);

  // Keyboard shortcuts (ignored while typing in inputs/editors).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const page = currentPage;
      if (!page) return;
      const sel = state.selection;

      if (e.key === 'Escape') {
        dispatch({ type: 'CLEAR_SELECT' });
        return;
      }
      if (readOnly || sel.length === 0) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({ type: 'DELETE_BLOCKS', pageId: page.id, ids: sel });
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        dispatch({ type: 'DUPLICATE_BLOCKS', pageId: page.id, ids: sel });
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const dCol = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dRow = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        dispatch({ type: 'NUDGE', pageId: page.id, ids: sel, dCol, dRow });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selection, currentPage, readOnly, dispatch]);

  if (!currentPage) {
    return (
      <div className="stage" ref={stageRef}>
        <div className="muted">No pages yet.</div>
      </div>
    );
  }

  const aspect = canvasAspect(state.grid, currentPage.kind);
  const availW = Math.max(0, stageSize.width - STAGE_PAD);
  const availH = Math.max(0, stageSize.height - STAGE_PAD);
  const fitWidth = Math.max(120, Math.min(availW, availH * aspect));
  const widthPx = fitWidth * zoom;

  const zoomIdx = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001);
  const zoomIn = () => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (zoomIdx < 0 ? 3 : zoomIdx) + 1)]);
  const zoomOut = () => setZoom(ZOOM_STEPS[Math.max(0, (zoomIdx < 0 ? 3 : zoomIdx) - 1)]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        className="stage"
        ref={stageRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) dispatch({ type: 'CLEAR_SELECT' });
        }}
      >
        {stageSize.width > 0 && (
          <PageSurface
            ref={surfaceRef}
            page={currentPage}
            grid={state.grid}
            widthPx={widthPx}
            editMode={!readOnly}
            selection={state.selection}
            onBlockPointerDown={onBlockPointerDown}
            onHandlePointerDown={onHandlePointerDown}
            onSpanClick={onSpanClick}
            onBackgroundPointerDown={() => dispatch({ type: 'CLEAR_SELECT' })}
          />
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          boxShadow: 'var(--shadow-sm)',
          padding: 2,
        }}
      >
        <button className="icon-btn" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
          <IconZoomOut size={15} />
        </button>
        <button
          className="zoom-label"
          style={{ border: 'none', background: 'transparent' }}
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
          <IconZoomIn size={15} />
        </button>
      </div>
    </div>
  );
}
