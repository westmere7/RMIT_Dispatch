import { forwardRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { InlineEditorHandle } from '../components/editor/InlineTextEditor';
import { canvasAspect, effectiveColumns, marginFractions, pageDimsMm } from '../grid/presets';
import type { GridConfig, Page, RichText } from '../types';
import { BlockFrame, type SpanClickInfo } from './BlockFrame';
import type { ResizeCorner } from './useDragResize';

/**
 * Fixed-aspect page surface, sized in px through `widthPx` (zoom drives
 * the rendered width — never a CSS transform). Blocks are absolutely
 * positioned by percentage; grid lines are a background overlay.
 */
export const PageSurface = forwardRef<HTMLDivElement, {
  page: Page;
  grid: GridConfig;
  widthPx: number;
  editMode: boolean;
  selection: string[];
  editingBlockId?: string | null;
  inlineEditorRef?: React.RefObject<InlineEditorHandle>;
  onBlockPointerDown: (e: ReactPointerEvent, blockId: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent, blockId: string, corner: ResizeCorner) => void;
  onSpanClick?: (info: SpanClickInfo) => void;
  onEnteredField?: (fieldId: string | null) => void;
  onStartEdit?: (blockId: string) => void;
  onBodyChange?: (blockId: string, body: RichText) => void;
  onBlockContextMenu?: (e: ReactMouseEvent, blockId: string, fieldId: string | null) => void;
  onSurfaceContextMenu?: (e: ReactMouseEvent) => void;
  onBackgroundPointerDown?: () => void;
}>(function PageSurface(
  {
    page,
    grid,
    widthPx,
    editMode,
    selection,
    editingBlockId,
    inlineEditorRef,
    onBlockPointerDown,
    onHandlePointerDown,
    onSpanClick,
    onEnteredField,
    onStartEdit,
    onBodyChange,
    onBlockContextMenu,
    onSurfaceContextMenu,
    onBackgroundPointerDown,
  },
  ref,
) {
  const aspect = canvasAspect(grid, page.kind);
  const cols = effectiveColumns(grid, page.kind);
  const rows = grid.rows;
  const { x: mx, y: my } = marginFractions(grid, page.kind);

  const isSpread = page.kind === 'spread';
  const dims = pageDimsMm(grid);
  const canvasWmm = isSpread ? dims.w * 2 + grid.spineMm : dims.w;
  const pageWFrac = dims.w / canvasWmm;

  return (
    <div
      ref={ref}
      className={`page-surface ${editMode ? 'edit-mode' : ''}`}
      style={{ width: widthPx, aspectRatio: `${aspect}`, fontSize: Math.max(8, widthPx / 46) }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onBackgroundPointerDown?.();
      }}
      onContextMenu={(e) => {
        if (!onSurfaceContextMenu) return;
        e.preventDefault();
        onSurfaceContextMenu(e);
      }}
    >
      {editMode && (
        <div
          className="grid-overlay"
          style={{ backgroundSize: `${100 / cols}% ${100 / rows}%` }}
        />
      )}

      {editMode &&
        (isSpread ? (
          <>
            <div
              className="margin-guide"
              style={{
                left: `${mx * 100}%`,
                right: `${(1 - pageWFrac + mx) * 100}%`,
                top: `${my * 100}%`,
                bottom: `${my * 100}%`,
              }}
            />
            <div
              className="margin-guide"
              style={{
                left: `${(1 - pageWFrac + mx) * 100}%`,
                right: `${mx * 100}%`,
                top: `${my * 100}%`,
                bottom: `${my * 100}%`,
              }}
            />
            <div className="spine-guide" style={{ left: '50%' }} />
          </>
        ) : (
          <div
            className="margin-guide"
            style={{
              left: `${mx * 100}%`,
              right: `${mx * 100}%`,
              top: `${my * 100}%`,
              bottom: `${my * 100}%`,
            }}
          />
        ))}

      {page.blocks.map((block) => (
        <BlockFrame
          key={block.id}
          block={block}
          cols={cols}
          rows={rows}
          selected={selection.includes(block.id)}
          editable={editMode}
          editing={editingBlockId === block.id}
          editorRef={editingBlockId === block.id ? inlineEditorRef : undefined}
          onPointerDown={onBlockPointerDown}
          onHandlePointerDown={onHandlePointerDown}
          onSpanClick={onSpanClick}
          onEnteredField={onEnteredField}
          onStartEdit={onStartEdit}
          onBodyChange={onBodyChange}
          onContextMenu={onBlockContextMenu}
        />
      ))}
    </div>
  );
});
