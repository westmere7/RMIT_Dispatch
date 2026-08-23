import { useMemo, useState } from 'react';
import { GRID_PRESETS, MAX_COLUMNS, MIN_COLUMNS, PAGE_SIZES, deriveRows, makeGrid } from '../grid/presets';
import type { DispatchDocument, GridConfig, Orientation, PageSize } from '../types';
import { GridPreview } from './GridPreview';
import { IconX } from './Icons';

/** Name + target format (prefilled from the master, changeable). */
export function NewAdaptationPanel({
  master,
  onCreate,
  onClose,
  busy,
}: {
  master: DispatchDocument;
  onCreate: (args: { title: string; grid: GridConfig }) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [pageSize, setPageSize] = useState<PageSize>(master.grid.pageSize);
  const [orientation, setOrientation] = useState<Orientation>(master.grid.orientation);
  const [columns, setColumns] = useState(master.grid.columns);

  const grid: GridConfig = useMemo(
    () =>
      makeGrid({
        pageSize,
        orientation,
        columns,
        marginMm: master.grid.marginMm,
        gutterMm: master.grid.gutterMm,
        spineMm: master.grid.spineMm,
      }),
    [master.grid, pageSize, orientation, columns],
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2>New adaptation</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="muted text-xs" style={{ marginBottom: 16 }}>
          Clones the master — every block starts synced (↓ down) and follows the master live.
          Unlink, narrow or re-direct embeds afterwards.
        </p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="na-title">Name</label>
              <input
                id="na-title"
                className="input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Web banner, Flyer A5…"
              />
            </div>
            <div className="field">
              <label htmlFor="na-size">Page size</label>
              <select
                id="na-size"
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
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Grid granularity</label>
              <div className="segmented" style={{ flexWrap: 'wrap' }}>
                {GRID_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={columns === p.columns ? 'active' : ''}
                    onClick={() => setColumns(p.columns)}
                  >
                    {p.name} {p.columns}×{deriveRows({ pageSize, orientation }, p.columns)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="na-cols">Custom columns</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  id="na-cols"
                  className="input"
                  style={{ width: 90 }}
                  type="number"
                  min={MIN_COLUMNS}
                  max={MAX_COLUMNS}
                  value={columns}
                  onChange={(e) =>
                    setColumns(
                      Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Number(e.target.value) || MIN_COLUMNS)),
                    )
                  }
                />
                <span className="muted text-xs">
                  → {grid.columns}×{grid.rows} square cells
                </span>
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="text-xs muted" style={{ fontWeight: 600 }}>
              Target format
            </span>
            <GridPreview grid={grid} width={180} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || busy}
            onClick={() => onCreate({ title: title.trim(), grid })}
          >
            {busy ? 'Creating…' : 'Create adaptation'}
          </button>
        </div>
      </div>
    </div>
  );
}
