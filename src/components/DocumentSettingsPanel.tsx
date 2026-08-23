import { useMemo, useState } from 'react';
import {
  GRID_PRESETS,
  MAX_COLUMNS,
  PAGE_SIZES,
  cellSizeMm,
  deriveRows,
  makeGrid,
} from '../grid/presets';
import type { DispatchDocument, GridConfig, Orientation, PageSize } from '../types';
import { GridPreview } from './GridPreview';
import { IconX } from './Icons';

export interface DocumentSettingsValues {
  title: string;
  /** Project type — only offered for the master. */
  type?: string;
  grid: GridConfig;
}

/**
 * Settings for ONE document. Every document in a project — the master and
 * each adaptation — carries its own page format and grid, because a flyer
 * is not an A4 guide. The grid may only be refined: coarsening would
 * throw away layout precision this document's blocks already rely on.
 */
export function DocumentSettingsPanel({
  doc,
  isMaster,
  projectType,
  onSubmit,
  onClose,
  busy,
}: {
  doc: DispatchDocument;
  isMaster: boolean;
  projectType?: string;
  onSubmit: (values: DocumentSettingsValues) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const base = doc.grid;
  /** This document's current granularity is the floor. */
  const minColumns = base.columns;

  const [title, setTitle] = useState(doc.title);
  const [type, setType] = useState(projectType ?? '');
  const [pageSize, setPageSize] = useState<PageSize>(base.pageSize);
  const [orientation, setOrientation] = useState<Orientation>(base.orientation);
  const [columns, setColumns] = useState(base.columns);
  const [marginMm, setMarginMm] = useState(base.marginMm);
  const [gutterMm, setGutterMm] = useState(base.gutterMm);
  const [spineMm, setSpineMm] = useState(base.spineMm);

  const grid: GridConfig = useMemo(
    () => makeGrid({ pageSize, orientation, columns, marginMm, gutterMm, spineMm }),
    [pageSize, orientation, columns, marginMm, gutterMm, spineMm],
  );

  const presetRows = (cols: number) => deriveRows({ pageSize, orientation }, cols);
  const gridChanged = grid.columns !== base.columns || grid.rows !== base.rows;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className={`pill ${isMaster ? 'pill-accent' : ''}`}>
            {isMaster ? 'master' : 'adaptation'}
          </span>
          <h2 style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc.title} · settings
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="muted text-xs" style={{ marginBottom: 16 }}>
          These settings apply to this document only. Grid cells are always square — the row count
          follows from the columns and the page proportions — and the grid can only be refined,
          never coarsened.
        </p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="ds-title">{isMaster ? 'Title (project and master)' : 'Title'}</label>
              <input
                id="ds-title"
                className="input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {isMaster && (
              <div className="field">
                <label htmlFor="ds-type">Project type</label>
                <input
                  id="ds-type"
                  className="input"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="Campaign, Guide, Brochure…"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="ds-size">Page size</label>
              <select
                id="ds-size"
                className="input"
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as PageSize)}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Orientation</label>
              <div className="segmented">
                {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={orientation === o ? 'active' : ''}
                    onClick={() => setOrientation(o)}
                  >
                    {o === 'portrait' ? 'Portrait' : 'Landscape'}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Grid granularity</label>
              <div className="segmented" style={{ flexWrap: 'wrap' }}>
                {GRID_PRESETS.map((p) => {
                  const disabled = p.columns < minColumns;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={disabled}
                      className={columns === p.columns ? 'active' : ''}
                      title={
                        disabled
                          ? 'Coarser grids are not available for an existing document'
                          : p.recommended
                            ? 'Recommended'
                            : undefined
                      }
                      onClick={() => setColumns(p.columns)}
                    >
                      {p.name} {p.columns}×{presetRows(p.columns)}
                      {p.recommended ? ' ★' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label htmlFor="ds-cols">
                Custom columns ({minColumns}–{MAX_COLUMNS})
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  id="ds-cols"
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={minColumns}
                  max={MAX_COLUMNS}
                  value={columns}
                  onChange={(e) =>
                    setColumns(
                      Math.max(
                        minColumns,
                        Math.min(MAX_COLUMNS, Number(e.target.value) || minColumns),
                      ),
                    )
                  }
                />
                <span className="muted text-xs">
                  → {grid.columns}×{grid.rows} · cell {cellSizeMm(grid).toFixed(1)}mm square
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Margin (mm)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={marginMm}
                  onChange={(e) => setMarginMm(Number(e.target.value))}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Gutter (mm)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={gutterMm}
                  onChange={(e) => setGutterMm(Number(e.target.value))}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Spine (mm)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={spineMm}
                  onChange={(e) => setSpineMm(Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="text-xs muted" style={{ fontWeight: 600 }}>
              Live preview — spread
            </span>
            <GridPreview grid={grid} kind="spread" width={300} />
            <span className="text-xs muted" style={{ fontWeight: 600 }}>
              Single page
            </span>
            <GridPreview grid={grid} kind="single" width={140} />
            {gridChanged && (
              <p
                className="pill pill-warning"
                style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}
              >
                Refining {base.columns}×{base.rows} → {grid.columns}×{grid.rows}. This document&apos;s
                blocks are rescaled to keep their positions.
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || busy}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                ...(isMaster ? { type: type.trim() } : {}),
                grid,
              })
            }
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
