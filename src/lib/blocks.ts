import type { Block, BlockType, GridConfig, GridPos, Page, RichText, ShapeKind } from '../types';
import { effectiveColumns } from '../grid/presets';
import { newId } from './ids';
import { emptyRich, richFromText } from './richtext';

/* ---------- Geometry ---------- */

export function clampPos(pos: GridPos, cols: number, rows: number): GridPos {
  const w = Math.max(1, Math.min(pos.w, cols));
  const h = Math.max(1, Math.min(pos.h, rows));
  const col = Math.max(0, Math.min(pos.col, cols - w));
  const row = Math.max(0, Math.min(pos.row, rows - h));
  return { col, row, w, h };
}

export function overlaps(a: GridPos, b: GridPos): boolean {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** First slot (scanning rows then cols) where a w×h block fits without
    overlap; falls back to top-left clamped in-page. */
export function findFreeSlot(page: Page, cols: number, rows: number, w: number, h: number): GridPos {
  const cw = Math.min(w, cols);
  const ch = Math.min(h, rows);
  for (let row = 0; row + ch <= rows; row++) {
    for (let col = 0; col + cw <= cols; col++) {
      const cand = { col, row, w: cw, h: ch };
      if (!page.blocks.some((b) => overlaps(b.pos, cand))) return cand;
    }
  }
  return clampPos({ col: 0, row: 0, w: cw, h: ch }, cols, rows);
}

/* ---------- Creation ---------- */

const DEFAULT_SIZES: Record<BlockType, { w: number; h: number }> = {
  text: { w: 6, h: 3 },
  table: { w: 8, h: 4 },
  image: { w: 5, h: 4 },
  shape: { w: 3, h: 3 },
};

export function createBlock(
  type: BlockType,
  page: Page,
  grid: GridConfig,
  opts: { shape?: ShapeKind; body?: RichText } = {},
): Block {
  const cols = effectiveColumns(grid, page.kind);
  const rows = grid.rows;
  // Defaults are tuned for a 12-column page; cells are square, so the same
  // scale applies to both axes at any granularity.
  const scale = grid.columns / 12;
  const base = DEFAULT_SIZES[type];
  const w = Math.max(2, Math.min(cols, Math.round(base.w * scale)));
  const h = Math.max(2, Math.min(rows, Math.round(base.h * scale)));
  const pos = findFreeSlot(page, cols, rows, w, h);
  const id = newId('blk');

  switch (type) {
    case 'text':
      return {
        id,
        type,
        pos,
        body: opts.body ?? richFromText('New text block'),
        size: 'md',
        align: 'left',
      };
    case 'shape':
      return {
        id,
        type,
        pos,
        shape: opts.shape ?? 'rect',
        fill: 'var(--accent-wash)',
        stroke: 'var(--accent)',
        strokeWidth: 2,
      };
    case 'table':
      return {
        id,
        type,
        pos,
        headerRow: true,
        rows: [
          [richFromText('Header 1'), richFromText('Header 2')],
          [emptyRich(), emptyRich()],
        ],
      };
    case 'image':
      return { id, type, pos, fit: 'cover' };
  }
}

/**
 * Re-map every block onto a new grid, preserving relative position and
 * size. Used when a project's grid granularity is refined so the layout
 * stays put instead of collapsing into the top-left.
 */
export function rescalePages(pages: Page[], oldGrid: GridConfig, newGrid: GridConfig): Page[] {
  return pages.map((page) => {
    const oldCols = effectiveColumns(oldGrid, page.kind);
    const newCols = effectiveColumns(newGrid, page.kind);
    const fx = newCols / oldCols;
    const fy = newGrid.rows / oldGrid.rows;
    return {
      ...page,
      blocks: page.blocks.map((b) => ({
        ...b,
        pos: clampPos(
          {
            col: Math.round(b.pos.col * fx),
            row: Math.round(b.pos.row * fy),
            w: Math.max(1, Math.round(b.pos.w * fx)),
            h: Math.max(1, Math.round(b.pos.h * fy)),
          },
          newCols,
          newGrid.rows,
        ),
      })),
    };
  });
}

/** Duplicate a block with a fresh id, nudged one cell (clamped). */
export function duplicateBlock(block: Block, cols: number, rows: number): Block {
  const copy = JSON.parse(JSON.stringify(block)) as Block;
  copy.id = newId('blk');
  copy.pos = clampPos({ ...copy.pos, col: copy.pos.col + 1, row: copy.pos.row + 1 }, cols, rows);
  return copy;
}
