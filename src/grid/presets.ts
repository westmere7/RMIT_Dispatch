import type { GridConfig, Orientation, PageKind, PageSize } from '../types';

/** Physical page dimensions in mm (portrait orientation). */
const PAGE_MM: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
  'Social-Square': { w: 270, h: 270 },
  'Social-Story': { w: 270, h: 480 },
};

export const PAGE_SIZES: PageSize[] = ['A4', 'A5', 'Letter', 'Social-Square', 'Social-Story'];

/**
 * Grid granularity presets. Only the COLUMN count is a preset — the row
 * count is always derived from the page proportions so that every grid
 * cell is square (see deriveRows / canvasAspect).
 */
export interface GridPreset {
  key: string;
  name: string;
  columns: number;
  recommended?: boolean;
}

export const GRID_PRESETS: GridPreset[] = [
  { key: 'simple', name: 'Simple', columns: 6 },
  { key: 'editorial', name: 'Editorial', columns: 12, recommended: true },
  { key: 'fine', name: 'Fine', columns: 16 },
  { key: 'finer', name: 'Finer', columns: 24 },
  { key: 'ultra', name: 'Ultra', columns: 32 },
  { key: 'micro', name: 'Micro', columns: 48 },
];

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 96;

/** Page dimensions in mm respecting orientation. */
export function pageDimsMm(grid: Pick<GridConfig, 'pageSize' | 'orientation'>): {
  w: number;
  h: number;
} {
  const base = PAGE_MM[grid.pageSize];
  return grid.orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

/** True physical aspect ratio (w/h) of a single page. */
export function pageAspect(grid: Pick<GridConfig, 'pageSize' | 'orientation'>): number {
  const { w, h } = pageDimsMm(grid);
  return w / h;
}

/**
 * Row count that makes cells as close to square as an integer count
 * allows, for a given column count on this page.
 */
export function deriveRows(
  page: { pageSize: PageSize; orientation: Orientation },
  columns: number,
): number {
  return Math.max(1, Math.round(columns / pageAspect(page)));
}

/** Build a complete GridConfig with the row count derived (square cells). */
export function makeGrid(args: {
  pageSize: PageSize;
  orientation: Orientation;
  columns: number;
  marginMm?: number;
  gutterMm?: number;
  spineMm?: number;
}): GridConfig {
  const columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(args.columns)));
  return {
    pageSize: args.pageSize,
    orientation: args.orientation,
    columns,
    rows: deriveRows(args, columns),
    marginMm: args.marginMm ?? 15,
    gutterMm: args.gutterMm ?? 4,
    spineMm: args.spineMm ?? 10,
  };
}

export const DEFAULT_GRID: GridConfig = makeGrid({
  pageSize: 'A4',
  orientation: 'portrait',
  columns: 12,
});

/** Columns across the canvas: a spread is two pages wide. */
export function effectiveColumns(grid: GridConfig, kind: PageKind): number {
  return kind === 'spread' ? grid.columns * 2 : grid.columns;
}

/**
 * Aspect ratio of the whole canvas surface, taken straight from the cell
 * lattice so that **every cell renders exactly 1:1**. The page's physical
 * proportions are approximated by the derived row count rather than
 * imposed here — otherwise cells could not be square for arbitrary
 * column counts. The spine is drawn as a guide line and adds no width,
 * which keeps spread cells square too.
 */
export function canvasAspect(grid: GridConfig, kind: PageKind): number {
  return effectiveColumns(grid, kind) / grid.rows;
}

/** How far the derived grid deviates from the true page proportions (0 = exact). */
export function aspectDeviation(grid: GridConfig): number {
  const target = pageAspect(grid);
  const actual = grid.columns / grid.rows;
  return Math.abs(actual - target) / target;
}

/** Margin as a fraction of the canvas width/height (for guides). */
export function marginFractions(grid: GridConfig, kind: PageKind): { x: number; y: number } {
  const { w, h } = pageDimsMm(grid);
  const canvasWmm = kind === 'spread' ? w * 2 : w;
  return { x: grid.marginMm / canvasWmm, y: grid.marginMm / h };
}

/** Physical size of one grid cell, in mm (square by construction). */
export function cellSizeMm(grid: GridConfig): number {
  const { w } = pageDimsMm(grid);
  return w / grid.columns;
}
