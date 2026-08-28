import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconHand,
  IconRedo,
  IconUndo,
  IconZoomIn,
  IconZoomOut,
} from '../components/Icons';
import { liveRangeFor } from '../components/editor/BlockProps';
import { FieldEditorDialog } from '../components/editor/FieldEditorDialog';
import { NewTablePanel } from '../components/editor/NewTablePanel';
import type { InlineEditorHandle } from '../components/editor/InlineTextEditor';
import { canvasAspect } from '../grid/presets';
import { isContentLocked } from '../lib/syncfields';
import { useSize } from '../lib/useSize';
import type { Block, SyncField } from '../types';
import type { SpanClickInfo } from './BlockFrame';
import { CanvasContextMenu, type CanvasTarget } from './CanvasContextMenu';
import { useEditor } from './EditorProvider';
import { PageSurface } from './PageSurface';
import { useDragResize } from './useDragResize';
import { PropertiesBar } from './PropertiesBar';
import { useWorkspace } from './workspaceContext';
import { useZoomPan } from './useZoomPan';
import './canvas.css';

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
  const { state, dispatch, readOnly, currentPage, canUndo, canRedo, undo, redo } = useEditor();
  const [stageRef, stageSize] = useSize<HTMLDivElement>();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<InlineEditorHandle>(null);
  const { zoom, panning, panReady, zoomIn, zoomOut, resetZoom, onPointerDownCapture } = useZoomPan(
    stageRef,
    surfaceRef,
  );
  const [menu, setMenu] = useState<CanvasTarget | null>(null);
  const [fieldEdit, setFieldEdit] = useState<SyncField | null>(null);
  /** The insert-a-table panel, opened from the canvas menu. */
  const [newTable, setNewTable] = useState(false);
  const { onBlockPointerDown, onHandlePointerDown } = useDragResize(surfaceRef);
  const { applyUpstream } = useWorkspace();
  const editingId = state.editingBlockId;
  /** Which embed is open for text editing, shown in the properties bar. */
  const [enteredField, setEnteredField] = useState<string | null>(null);
  const prevEnteredFieldRef = useRef<string | null>(null);

  const handleEnteredField = useCallback((fieldId: string | null) => {
    const prev = prevEnteredFieldRef.current;
    prevEnteredFieldRef.current = fieldId;
    setEnteredField(fieldId);
    if (prev && !fieldId) {
      // Exited field isolation mode for `prev` -> commit changes to the variable!
      void applyUpstream(prev);
    }
  }, [applyUpstream]);

  const prevEditingIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevEditingIdRef.current;
    prevEditingIdRef.current = editingId;
    if (prev && !editingId) {
      // Exited block editing -> commit any field changes to the variable!
      void applyUpstream();
    }
  }, [editingId, applyUpstream]);


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
        if (b?.type === 'text' && !isContentLocked(b.binding)) {
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
      if (e.key !== 'Escape') return;
      /*
       * A sync field opened for editing inside the block owns Escape
       * first: leaving the embed is the more specific action, and a
       * second Escape then leaves the block. This is checked against the
       * DOM rather than by listener order — both listeners capture on
       * `window`, where stopPropagation cannot hold off a sibling.
       */
      if (document.querySelector('.field-span.is-entered')) return;
      dispatch({ type: 'EDIT_TEXT', blockId: null });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingId, dispatch]);

  const setContent = useCallback(
    (blockId: string, patch: Partial<Block>) => {
      if (!currentPage) return;
      // A burst of typing in one block is a single undo step — a table
      // cell included, since the patch is still one block's content.
      dispatch({
        type: 'UPDATE_BLOCK',
        pageId: currentPage.id,
        blockId,
        patch,
        coalesce: `content:${blockId}`,
      });
    },
    [currentPage, dispatch],
  );





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

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* One contextual bar for everything about the selection. */}
      <PropertiesBar enteredField={enteredField} />

      <div
        className={`stage ${panning ? 'panning' : ''} ${panReady ? 'pan-ready' : ''}`}
        ref={stageRef}
        onPointerDownCapture={onPointerDownCapture}
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
              onEnteredField={handleEnteredField}
            onStartEdit={(blockId) => dispatch({ type: 'EDIT_TEXT', blockId })}
            onContentChange={setContent}
            onBlockContextMenu={(e, blockId, fieldId) => {
              if (!state.selection.includes(blockId)) dispatch({ type: 'SELECT', ids: [blockId] });
              setMenu({
                x: e.clientX,
                y: e.clientY,
                blockId,
                fieldId,
                // A table has one editor per cell, so the text block's
                // own ref cannot answer for it.
                range: liveRangeFor(blockId, inlineRef.current?.getRange()),
              });
            }}
            onSurfaceContextMenu={(e) =>
              setMenu({ x: e.clientX, y: e.clientY, blockId: null, fieldId: null, range: null })
            }
            onBackgroundPointerDown={() => dispatch({ type: 'CLEAR_SELECT' })}
          />
        )}
      </div>

      {menu && (
        <CanvasContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onEditField={(f) => setFieldEdit(f)}
          onInsertTable={() => setNewTable(true)}
        />
      )}
      {newTable && currentPage && (
        <NewTablePanel
          onClose={() => setNewTable(false)}
          onCreate={(table) => {
            setNewTable(false);
            dispatch({ type: 'ADD_BLOCK', pageId: currentPage.id, blockType: 'table', table });
          }}
        />
      )}
      {fieldEdit && (
        <FieldEditorDialog field={fieldEdit} onClose={() => setFieldEdit(null)} />
      )}

      <div className="zoom-dock">
        <button
          className="icon-btn"
          title={`Undo — ${state.past.length} step${state.past.length === 1 ? '' : 's'} (Ctrl+Z)`}
          aria-label="Undo"
          disabled={!canUndo}
          onClick={undo}
        >
          <IconUndo size={15} />
        </button>
        <button
          className="icon-btn"
          title={`Redo — ${state.future.length} step${state.future.length === 1 ? '' : 's'} (Ctrl+Shift+Z)`}
          aria-label="Redo"
          disabled={!canRedo}
          onClick={redo}
        >
          <IconRedo size={15} />
        </button>
        <span className="dock-sep" />
        <button className="icon-btn" onClick={zoomOut} aria-label="Zoom out" title="Zoom out (Ctrl+−)">
          <IconZoomOut size={15} />
        </button>
        <button
          className="zoom-label"
          onClick={resetZoom}
          title="Reset to 100% (Ctrl+0)"
          aria-label="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" onClick={zoomIn} aria-label="Zoom in" title="Zoom in (Ctrl++)">
          <IconZoomIn size={15} />
        </button>
        <span className="dock-sep" />
        <span
          className={`dock-hint ${panReady ? 'active' : ''}`}
          title="Middle-drag, or hold Space and drag, to pan. Ctrl/⌘ + wheel or a trackpad pinch zooms."
        >
          <IconHand size={14} />
        </span>
      </div>
    </div>
  );
}
