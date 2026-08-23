import { canvasAspect, effectiveColumns, marginFractions } from '../grid/presets';
import type { GridConfig, Page, PageKind } from '../types';

/**
 * To-scale miniature of a page/spread: grid lines, margin guide and
 * block footprints. Used on project cards and the new-project preview.
 */
export function GridPreview({
  grid,
  kind = 'single',
  page,
  width = 200,
  showGrid = true,
}: {
  grid: GridConfig;
  kind?: PageKind;
  page?: Page;
  width?: number;
  showGrid?: boolean;
}) {
  const k = page?.kind ?? kind;
  const aspect = canvasAspect(grid, k);
  const cols = effectiveColumns(grid, k);
  const rows = grid.rows;
  const { x: mx, y: my } = marginFractions(grid, k);

  return (
    <div
      style={{
        width,
        aspectRatio: `${aspect}`,
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        overflow: 'hidden',
        maxWidth: '100%',
      }}
    >
      {showGrid && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
            backgroundSize: `${100 / cols}% ${100 / rows}%`,
            opacity: 0.5,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: `${mx * 100}%`,
          right: `${mx * 100}%`,
          top: `${my * 100}%`,
          bottom: `${my * 100}%`,
          border: '1px dashed var(--border-strong)',
          opacity: 0.6,
        }}
      />
      {k === 'spread' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            borderLeft: '1px solid var(--border-strong)',
          }}
        />
      )}
      {page?.blocks.map((b) => (
        <div
          key={b.id}
          style={{
            position: 'absolute',
            left: `${(b.pos.col / cols) * 100}%`,
            top: `${(b.pos.row / rows) * 100}%`,
            width: `${(b.pos.w / cols) * 100}%`,
            height: `${(b.pos.h / rows) * 100}%`,
            background: b.type === 'image' ? 'var(--accent-wash)' : 'var(--surface-2)',
            border: '1px solid var(--border-strong)',
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}
