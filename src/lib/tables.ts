import type {
  CellBinding,
  CellFormat,
  CellImage,
  CellMerge,
  RichText,
  TableBlock,
} from '../types';
import { emptyRich } from './richtext';

/* ============================================================
   Table geometry: track sizes, merges, and structural edits.

   Two rules run through all of it:

   1. `rows` stays RECTANGULAR. Merging spans cells visually; it never
      removes one. Content and sync bindings therefore keep their
      coordinates, and a table field's value stays a plain grid.
   2. Anything keyed by row/col is TOLERATED when it falls out of range
      rather than trusted. A table bound to a sync field has its shape
      replaced wholesale by `applySyncDown`, so a merge or a cell image
      can outlive the cell it described; reading defensively is what
      stops that from throwing or painting the wrong cell.
   ============================================================ */

export function tableSize(block: TableBlock): { rows: number; cols: number } {
  return { rows: block.rows.length, cols: block.rows[0]?.length ?? 0 };
}

/* ---------- Merges ---------- */

/** The merge anchored exactly at this cell, if any. */
export function mergeAt(block: TableBlock, row: number, col: number): CellMerge | null {
  const { rows, cols } = tableSize(block);
  const m = block.merges?.find((x) => x.row === row && x.col === col);
  if (!m) return null;
  // Clamp rather than trust: a synced table can change shape underneath.
  const rowSpan = Math.max(1, Math.min(m.rowSpan, rows - row));
  const colSpan = Math.max(1, Math.min(m.colSpan, cols - col));
  return rowSpan === 1 && colSpan === 1 ? null : { row, col, rowSpan, colSpan };
}

/** Is this cell swallowed by a merge anchored somewhere above/left? */
export function isCovered(block: TableBlock, row: number, col: number): boolean {
  for (const m of block.merges ?? []) {
    if (m.row === row && m.col === col) continue;
    const anchor = mergeAt(block, m.row, m.col);
    if (!anchor) continue;
    if (
      row >= anchor.row &&
      row < anchor.row + anchor.rowSpan &&
      col >= anchor.col &&
      col < anchor.col + anchor.colSpan
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Merge a rectangle. Any merge it overlaps is absorbed — two merges
 * sharing a cell would each claim it and the row would render a column
 * short. The anchor keeps its content; the covered cells keep theirs
 * too, hidden but intact, so unmerging restores the table exactly.
 */
export function mergeCells(
  block: TableBlock,
  a: { row: number; col: number },
  b: { row: number; col: number },
): CellMerge[] {
  const row = Math.min(a.row, b.row);
  const col = Math.min(a.col, b.col);
  const rowSpan = Math.abs(a.row - b.row) + 1;
  const colSpan = Math.abs(a.col - b.col) + 1;
  const overlaps = (m: CellMerge) =>
    m.row < row + rowSpan && m.row + m.rowSpan > row && m.col < col + colSpan && m.col + m.colSpan > col;
  const kept = (block.merges ?? []).filter((m) => !overlaps(m));
  return rowSpan === 1 && colSpan === 1 ? kept : [...kept, { row, col, rowSpan, colSpan }];
}

/** Drop whichever merge contains this cell. */
export function unmergeAt(block: TableBlock, row: number, col: number): CellMerge[] {
  return (block.merges ?? []).filter(
    (m) =>
      !(row >= m.row && row < m.row + m.rowSpan && col >= m.col && col < m.col + m.colSpan),
  );
}

/* ---------- Structure ----------
   Inserting or deleting shifts EVERY coordinate the block holds:
   bindings, per-row/col/cell styles, merges and the size arrays. Missing
   one of them is what silently moves a style onto its neighbour, so they
   all go through the same two helpers. */

interface Keyed {
  row?: number;
  col?: number;
}

function shift<T extends Keyed>(items: T[] | undefined, axis: 'row' | 'col', at: number, by: number): T[] {
  return (items ?? []).map((it) => {
    const v = it[axis];
    return v !== undefined && v > at ? { ...it, [axis]: v + by } : it;
  });
}

function dropAt<T extends Keyed>(items: T[] | undefined, axis: 'row' | 'col', at: number): T[] {
  return (items ?? [])
    .filter((it) => it[axis] !== at)
    .map((it) => {
      const v = it[axis];
      return v !== undefined && v > at ? { ...it, [axis]: v - 1 } : it;
    });
}

function spliceArray(arr: number[] | undefined, at: number, remove: number, insert?: number): number[] | undefined {
  if (!arr) return undefined;
  const next = [...arr];
  next.splice(at, remove, ...(insert === undefined ? [] : [insert]));
  return next;
}

/** A merge is stretched when the new line falls inside it, shifted when below. */
function growMerges(merges: CellMerge[] | undefined, axis: 'row' | 'col', at: number): CellMerge[] {
  const span = axis === 'row' ? 'rowSpan' : 'colSpan';
  return (merges ?? []).map((m) => {
    const start = m[axis];
    const size = m[span];
    if (start > at) return { ...m, [axis]: start + 1 };
    if (at < start + size - 1) return { ...m, [span]: size + 1 };
    return m;
  });
}

function shrinkMerges(merges: CellMerge[] | undefined, axis: 'row' | 'col', at: number): CellMerge[] {
  const span = axis === 'row' ? 'rowSpan' : 'colSpan';
  return (merges ?? [])
    .map((m) => {
      const start = m[axis];
      const size = m[span];
      if (start > at) return { ...m, [axis]: start - 1 };
      if (at < start + size) return { ...m, [span]: size - 1 };
      return m;
    })
    .filter((m) => m.rowSpan > 0 && m.colSpan > 0 && !(m.rowSpan === 1 && m.colSpan === 1));
}

export type TablePatch = Partial<TableBlock>;

/** Insert a row directly below `at`. */
export function insertRow(block: TableBlock, at: number): TablePatch {
  const { cols } = tableSize(block);
  const rows = [...block.rows];
  rows.splice(at + 1, 0, Array.from({ length: cols }, () => emptyRich()));
  return {
    rows,
    cellBindings: shift<CellBinding>(block.cellBindings, 'row', at, 1),
    cellImages: shift<CellImage>(block.cellImages, 'row', at, 1),
    cellFormats: shift<CellFormat>(block.cellFormats, 'row', at, 1),
    merges: growMerges(block.merges, 'row', at),
    rowHeights: spliceArray(block.rowHeights, at + 1, 0, 0),
  };
}

export function deleteRow(block: TableBlock, at: number): TablePatch | null {
  if (block.rows.length <= 1) return null;
  return {
    rows: block.rows.filter((_, i) => i !== at),
    cellBindings: dropAt<CellBinding>(block.cellBindings, 'row', at),
    cellImages: dropAt<CellImage>(block.cellImages, 'row', at),
    cellFormats: dropAt<CellFormat>(block.cellFormats, 'row', at),
    merges: shrinkMerges(block.merges, 'row', at),
    rowHeights: spliceArray(block.rowHeights, at, 1),
  };
}

/** Insert a column directly right of `at`. */
export function insertCol(block: TableBlock, at: number): TablePatch {
  return {
    rows: block.rows.map((row) => {
      const next = [...row];
      next.splice(at + 1, 0, emptyRich());
      return next;
    }),
    cellBindings: shift<CellBinding>(block.cellBindings, 'col', at, 1),
    cellImages: shift<CellImage>(block.cellImages, 'col', at, 1),
    cellFormats: shift<CellFormat>(block.cellFormats, 'col', at, 1),
    merges: growMerges(block.merges, 'col', at),
    colWidths: spliceArray(block.colWidths, at + 1, 0, 0),
  };
}

export function deleteCol(block: TableBlock, at: number): TablePatch | null {
  if ((block.rows[0]?.length ?? 0) <= 1) return null;
  return {
    rows: block.rows.map((row) => row.filter((_, i) => i !== at)),
    cellBindings: dropAt<CellBinding>(block.cellBindings, 'col', at),
    cellImages: dropAt<CellImage>(block.cellImages, 'col', at),
    cellFormats: dropAt<CellFormat>(block.cellFormats, 'col', at),
    merges: shrinkMerges(block.merges, 'col', at),
    colWidths: spliceArray(block.colWidths, at, 1),
  };
}

/** Move a row up or down, carrying everything keyed to it. */
export function moveRow(block: TableBlock, from: number, to: number): TablePatch | null {
  const n = block.rows.length;
  if (to < 0 || to >= n || from === to) return null;
  const rows = [...block.rows];
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  const remap = (i: number) => (i === from ? to : i === to ? from : i);
  return {
    rows,
    // Only a straight swap is offered, so the remap is a swap too — any
    // merge touching either row is dropped rather than left mis-anchored.
    cellBindings: (block.cellBindings ?? []).map((b) => ({ ...b, row: remap(b.row) })),
    cellImages: (block.cellImages ?? []).map((i) => ({ ...i, row: remap(i.row) })),
    cellFormats: (block.cellFormats ?? []).map((f) => ({ ...f, row: remap(f.row) })),
    merges: (block.merges ?? []).filter(
      (m) => !(from >= m.row && from < m.row + m.rowSpan) && !(to >= m.row && to < m.row + m.rowSpan),
    ),
    rowHeights: block.rowHeights
      ? block.rowHeights.map((_, i) => block.rowHeights![remap(i)] ?? 0)
      : undefined,
  };
}

/* ---------- Track sizing ----------
   Columns and rows are sized the same way: a list of percentages of the
   table's own box. Percentages rather than absolute lengths because the
   canvas rescales with zoom, and because dragging a divider is then a
   pure exchange between two neighbours — the table never changes size
   as a side effect of resizing something inside it. */

export const MIN_TRACK = 4;

/**
 * Track sizes as percentages. A zero or missing entry shares what the
 * sized tracks leave behind, so setting one column does not oblige the
 * author to set every other one.
 */
export function trackPercents(weights: number[] | undefined, count: number): number[] {
  if (count === 0) return [];
  const w = Array.from({ length: count }, (_, i) => Math.max(0, weights?.[i] ?? 0));
  const sized = w.filter((x) => x > 0);
  if (sized.length === 0) return Array.from({ length: count }, () => 100 / count);

  const total = sized.reduce((a, b) => a + b, 0);
  if (sized.length === count) return w.map((x) => (x / total) * 100);

  // Some sized, some not: the sized keep their share of the whole, capped
  // so the unsized are never squeezed away, and the rest split the gap.
  const claimed = Math.min(total, 100 - (count - sized.length) * MIN_TRACK);
  const each = (100 - claimed) / (count - sized.length);
  return w.map((x) => (x > 0 ? (x / total) * claimed : each));
}

export function columnPercents(block: TableBlock): number[] {
  return trackPercents(block.colWidths, tableSize(block).cols);
}

export function rowPercents(block: TableBlock): number[] {
  return trackPercents(block.rowHeights, tableSize(block).rows);
}

/**
 * Drag a divider: `delta` percentage points move from the track after it
 * to the track before it. Only those two change, so the rest of the
 * table stays exactly where the author put it.
 */
export function resizeTrack(current: number[], index: number, delta: number): number[] {
  const next = [...current];
  const a = next[index];
  const b = next[index + 1];
  if (a === undefined || b === undefined) return next;
  const move = Math.max(MIN_TRACK - a, Math.min(b - MIN_TRACK, delta));
  next[index] = a + move;
  next[index + 1] = b - move;
  return next;
}

/** Set one track's size directly, taking the difference from its neighbour. */
export function setTrack(current: number[], index: number, percent: number): number[] {
  const at = current[index];
  if (at === undefined) return current;
  const target = Math.max(MIN_TRACK, Math.min(100 - MIN_TRACK * (current.length - 1), percent));
  // The last track has no neighbour to its right; borrow from the left.
  const pivot = index < current.length - 1 ? index : index - 1;
  if (pivot < 0) return current;
  return index <= pivot
    ? resizeTrack(current, pivot, target - at)
    : resizeTrack(current, pivot, at - target);
}

/** Equal tracks again — the escape hatch from a layout gone wrong. */
export function evenTracks(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

/* ---------- Cell content ---------- */

export function setCellContent(block: TableBlock, row: number, col: number, rich: RichText): RichText[][] {
  return block.rows.map((r, ri) => r.map((c, ci) => (ri === row && ci === col ? rich : c)));
}

/* ---------- Cell images ---------- */

/** The picture in this cell, if the coordinates still exist. */
export function cellImageAt(block: TableBlock, row: number, col: number): CellImage | null {
  return block.cellImages?.find((i) => i.row === row && i.col === col) ?? null;
}

/** Put a picture in a cell, or clear it by passing null. */
export function setCellImage(
  block: TableBlock,
  row: number,
  col: number,
  image: Omit<CellImage, 'row' | 'col'> | null,
): CellImage[] {
  const rest = (block.cellImages ?? []).filter((i) => !(i.row === row && i.col === col));
  return image ? [...rest, { row, col, ...image }] : rest;
}

/** Every storage path a table owns — the media collector needs these. */
export function tableMediaPaths(block: TableBlock): string[] {
  return (block.cellImages ?? [])
    .map((i) => i.storagePath)
    .filter((p): p is string => !!p);
}

/* ---------- Cell format ---------- */

export function cellFormatAt(block: TableBlock, row: number, col: number): CellFormat | null {
  return block.cellFormats?.find((f) => f.row === row && f.col === col) ?? null;
}

/**
 * Set part of a cell's format, dropping the record once nothing is left
 * on it — an entry holding only its own coordinates is noise in the
 * document and would outlive the reason it was written.
 */
export function setCellFormat(
  block: TableBlock,
  cells: { row: number; col: number }[],
  patch: Omit<CellFormat, 'row' | 'col'>,
): CellFormat[] {
  let list = block.cellFormats ?? [];
  for (const { row, col } of cells) {
    const existing = list.find((f) => f.row === row && f.col === col);
    const merged: CellFormat = { ...(existing ?? { row, col }), ...patch };
    const meaningful = merged.align !== undefined || merged.size !== undefined;
    list = list.filter((f) => !(f.row === row && f.col === col));
    if (meaningful) list = [...list, merged];
  }
  return list;
}

/** Every coordinate in the selected rectangle, for a range edit. */
export function cellsIn(a: { row: number; col: number }, b: { row: number; col: number }) {
  const out: { row: number; col: number }[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) {
      out.push({ row, col });
    }
  }
  return out;
}
