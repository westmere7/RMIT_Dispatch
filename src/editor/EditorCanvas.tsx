import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconItalic,
  IconZoomIn,
  IconZoomOut,
} from '../components/Icons';
import { FieldMenu } from '../components/editor/FieldMenu';
import type { InlineEditorHandle } from '../components/editor/InlineTextEditor';
import { canvasAspect } from '../grid/presets';
import { applyMark, rangeHasMark } from '../lib/richtext';
import { useSize } from '../lib/useSize';
import type { RichText, TextAlign, TextSize } from '../types';
import type { SpanClickInfo } from './BlockFrame';
import { CanvasContextMenu, type CanvasTarget } from './CanvasContextMenu';
import { useEditor } from './EditorProvider';
import { PageSurface } from './PageSurface';
import { useDragResize } from './useDragResize';
import './canvas.css';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const STAGE_PAD = 64;
const SIZES: TextSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

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
  const inlineRef = useRef<InlineEditorHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<CanvasTarget | null>(null);
  const { onBlockPointerDown, onHandlePointerDown } = useDragResize(surfaceRef);

  const editingId = state.editingBlockId;
  const editingBlock =
    currentPage?.blocks.find((b) => b.id === editingId && b.type === 'text') ?? null;

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

      // Enter opens inline text editing for a single selected text block.
      if (e.key === 'Enter' && sel.length === 1) {
        const b = page.blocks.find((x) => x.id === sel[0]);
        const locked = b?.binding && b.binding.direction !== 'up';
        if (b?.type === 'text' && !locked) {
          e.preventDefault();
          dispatch({ type: 'EDIT_TEXT', blockId: b.id });
        }
        return;
      }
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

  // Esc leaves an inline edit session (captured inside the editor).
  useEffect(() => {
    if (!editingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'EDIT_TEXT', blockId: null });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingId, dispatch]);

  const setBody = useCallback(
    (blockId: string, body: RichText) => {
      if (!currentPage) return;
      dispatch({ type: 'UPDATE_BLOCK', pageId: currentPage.id, blockId, patch: { body } });
    },
    [currentPage, dispatch],
  );

  const withRange = (fn: (r: NonNullable<ReturnType<InlineEditorHandle['getRange']>>) => void) => {
    const r = inlineRef.current?.getRange();
    if (!r || r.start === r.end) return;
    fn(r);
  };

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
  const zoomIn = () =>
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (zoomIdx < 0 ? 3 : zoomIdx) + 1)]);
  const zoomOut = () => setZoom(ZOOM_STEPS[Math.max(0, (zoomIdx < 0 ? 3 : zoomIdx) - 1)]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Formatting bar for the block being edited on the canvas. */}
      {editingBlock && editingBlock.type === 'text' && (
        <div className="canvas-format-bar">
          <span className="text-xs muted" style={{ fontWeight: 600, marginRight: 2 }}>
            TEXT
          </span>
          <button
            className="icon-btn"
            title="Bold"
            aria-label="Bold"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              withRange((r) =>
                setBody(
                  editingBlock.id,
                  applyMark(editingBlock.body, r, {
                    bold: !rangeHasMark(editingBlock.body, r, 'bold'),
                  }),
                ),
              )
            }
          >
            <IconBold size={13} />
          </button>
          <button
            className="icon-btn"
            title="Italic"
            aria-label="Italic"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              withRange((r) =>
                setBody(
                  editingBlock.id,
                  applyMark(editingBlock.body, r, {
                    italic: !rangeHasMark(editingBlock.body, r, 'italic'),
                  }),
                ),
              )
            }
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
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                withRange((r) =>
                  setBody(editingBlock.id, applyMark(editingBlock.body, r, { color: e.target.value })),
                )
              }
            />
          </label>

          <span className="bar-sep" />
          <div className="segmented" style={{ padding: 2 }}>
            {SIZES.map((s) => (
              <button
                key={s}
                className={(editingBlock.size ?? 'md') === s ? 'active' : ''}
                style={{ height: 22, padding: '0 8px', fontSize: 11 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_BLOCK',
                    pageId: currentPage.id,
                    blockId: editingBlock.id,
                    patch: { size: s },
                  })
                }
              >
                {s.toUpperCase()}
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
                className={(editingBlock.align ?? 'left') === a ? 'active' : ''}
                style={{ height: 22, padding: '0 7px' }}
                aria-label={`Align ${a}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_BLOCK',
                    pageId: currentPage.id,
                    blockId: editingBlock.id,
                    patch: { align: a },
                  })
                }
              >
                <Icon size={12} />
              </button>
            ))}
          </div>

          <span className="bar-sep" />
          <FieldMenu
            compact
            getRange={() => inlineRef.current?.getRange() ?? null}
            rich={editingBlock.body}
            onRich={(body) => setBody(editingBlock.id, body)}
          />
          <button
            className="btn btn-sm"
            style={{ height: 24, marginLeft: 'auto' }}
            onClick={() => dispatch({ type: 'EDIT_TEXT', blockId: null })}
          >
            Done
          </button>
        </div>
      )}

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
            editingBlockId={editingId}
            inlineEditorRef={inlineRef}
            onBlockPointerDown={onBlockPointerDown}
            onHandlePointerDown={onHandlePointerDown}
              onSpanClick={onSpanClick}
            onStartEdit={(blockId) => dispatch({ type: 'EDIT_TEXT', blockId })}
            onBodyChange={setBody}
            onBlockContextMenu={(e, blockId, fieldId) => {
              if (!state.selection.includes(blockId)) dispatch({ type: 'SELECT', ids: [blockId] });
              setMenu({
                x: e.clientX,
                y: e.clientY,
                blockId,
                fieldId,
                range: inlineRef.current?.getRange() ?? null,
              });
            }}
            onSurfaceContextMenu={(e) =>
              setMenu({ x: e.clientX, y: e.clientY, blockId: null, fieldId: null, range: null })
            }
            onBackgroundPointerDown={() => dispatch({ type: 'CLEAR_SELECT' })}
          />
        )}
      </div>

      {menu && <CanvasContextMenu target={menu} onClose={() => setMenu(null)} />}

      <div className="zoom-dock">
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
