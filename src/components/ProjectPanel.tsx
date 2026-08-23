import { useMemo, useState } from 'react';
import {
  DEFAULT_GRID,
  GRID_PRESETS,
  MAX_COLUMNS,
  MIN_COLUMNS,
  PAGE_SIZES,
  cellSizeMm,
  deriveRows,
  makeGrid,
} from '../grid/presets';
import type { GridConfig, Orientation, PageSize } from '../types';
import { GridPreview } from './GridPreview';
import { IconX } from './Icons';

export interface ProjectPanelValues {
  title: string;
  type: string;
  grid: GridConfig;
}

/**
 * Create a project, or edit an existing one's settings. In edit mode the
 * grid may only be refined: coarser granularities are disabled, because
 * enlarging cells would irreversibly lose layout precision in every
 * document already laid out on the finer grid.
 */
export function ProjectPanel({
  mode,
  initial,
  onSubmit,
  onClose,
  busy,
}: {
  mode: 'create' | 'edit';
  initial?: ProjectPanelValues;
  onSubmit: (values: ProjectPanelValues) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const base = initial?.grid ?? DEFAULT_GRID;
  const isEdit = mode === 'edit';
  /** Existing granularity: the floor for any change in edit mode. */
  const minColumns = isEdit ? base.columns : MIN_COLUMNS;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState(initial?.type ?? 'Campaign');
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
  const tooCoarse = (cols: number) => cols < minColumns;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2>{isEdit ? 'Project settings' : 'New project'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="muted text-xs" style={{ marginBottom: 16 }}>
          Grid cells are always square — the row count follows from the columns and the page
          proportions.
          {isEdit && ' The grid can only be refined, never coarsened.'}
        </p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="pp-title">Title</label>
              <input
                id="pp-title"
                className="input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Postgraduate Guide 2026"
              />
            </div>
            <div className="field">
              <label htmlFor="pp-type">Type</label>
              <input
                id="pp-type"
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="Campaign, Guide, Brochure…"
              />
            </div>
            <div className="field">
              <label htmlFor="pp-size">Page size</label>
              <select
                id="pp-size"
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
                  const disabled = tooCoarse(p.columns);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={disabled}
                      className={columns === p.columns ? 'active' : ''}
                      title={
                        disabled
                          ? 'Coarser grids are not available once a project exists'
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
              <label htmlFor="pp-cols">
                Custom columns ({minColumns}–{MAX_COLUMNS})
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  id="pp-cols"
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={minColumns}
                  max={MAX_COLUMNS}
                  value={columns}
                  onChange={(e) =>
                    setColumns(
                      Math.max(minColumns, Math.min(MAX_COLUMNS, Number(e.target.value) || minColumns)),
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
            {isEdit && grid.columns !== base.columns && (
              <p className="pill pill-warning" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>
                Refining {base.columns}×{base.rows} → {grid.columns}×{grid.rows}. Existing blocks are
                rescaled to keep their positions.
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
            onClick={() => onSubmit({ title: title.trim(), type: type.trim(), grid })}
          >
            {busy ? 'Saving…' : isEdit ? 'Save settings' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
