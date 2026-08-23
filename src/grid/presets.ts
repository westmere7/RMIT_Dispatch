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

export interface GridPreset {
  key: string;
  label: string;
  columns: number;
  rows: number;
  recommended?: boolean;
}

export const GRID_PRESETS: GridPreset[] = [
  { key: 'simple', label: 'Simple 6×8', columns: 6, rows: 8 },
  { key: 'editorial', label: 'Editorial 12×16', columns: 12, rows: 16, recommended: true },
  { key: 'fine', label: 'Fine 16×24', columns: 16, rows: 24 },
];

export const DEFAULT_GRID: GridConfig = {
  pageSize: 'A4',
  orientation: 'portrait',
  columns: 12,
  rows: 16,
  marginMm: 15,
  gutterMm: 4,
  spineMm: 10,
};

/** Page dimensions in mm respecting orientation. */
export function pageDimsMm(grid: GridConfig): { w: number; h: number } {
  const base = PAGE_MM[grid.pageSize];
  return grid.orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

/** Aspect ratio (w/h) of a single page. */
export function pageAspect(grid: GridConfig): number {
  const { w, h } = pageDimsMm(grid);
  return w / h;
}

/** Columns across the canvas: a spread is two pages wide. */
export function effectiveColumns(grid: GridConfig, kind: PageKind): number {
  return kind === 'spread' ? grid.columns * 2 : grid.columns;
}

/** Aspect ratio of the whole canvas surface (spread = 2 pages + spine). */
export function canvasAspect(grid: GridConfig, kind: PageKind): number {
  const { w, h } = pageDimsMm(grid);
  if (kind === 'spread') return (w * 2 + grid.spineMm) / h;
  return w / h;
}

/** Margin as a fraction of the canvas width/height (for guides). */
export function marginFractions(grid: GridConfig, kind: PageKind): { x: number; y: number } {
  const { w, h } = pageDimsMm(grid);
  const canvasW = kind === 'spread' ? w * 2 + grid.spineMm : w;
  return { x: grid.marginMm / canvasW, y: grid.marginMm / h };
}
