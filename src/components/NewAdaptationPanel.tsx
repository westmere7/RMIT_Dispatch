import { useMemo, useState } from 'react';
import { GRID_PRESETS, PAGE_SIZES } from '../grid/presets';
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
  const [presetKey, setPresetKey] = useState(() => {
    const found = GRID_PRESETS.find(
      (p) => p.columns === master.grid.columns && p.rows === master.grid.rows,
    );
    return found?.key ?? 'custom';
  });
  const [customCols, setCustomCols] = useState(master.grid.columns);
  const [customRows, setCustomRows] = useState(master.grid.rows);

  const grid: GridConfig = useMemo(() => {
    const preset = GRID_PRESETS.find((p) => p.key === presetKey);
    return {
      ...master.grid,
      pageSize,
      orientation,
      columns: preset ? preset.columns : Math.max(2, Math.min(48, customCols)),
      rows: preset ? preset.rows : Math.max(2, Math.min(64, customRows)),
    };
  }, [master.grid, pageSize, orientation, presetKey, customCols, customRows]);

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
              <label>Grid</label>
              <div className="segmented" style={{ flexWrap: 'wrap' }}>
                {GRID_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={presetKey === p.key ? 'active' : ''}
                    onClick={() => setPresetKey(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={presetKey === 'custom' ? 'active' : ''}
                  onClick={() => setPresetKey('custom')}
                >
                  Custom
                </button>
              </div>
            </div>
            {presetKey === 'custom' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Columns</label>
                  <input
                    className="input"
                    type="number"
                    min={2}
                    max={48}
                    value={customCols}
                    onChange={(e) => setCustomCols(Number(e.target.value))}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Rows</label>
                  <input
                    className="input"
                    type="number"
                    min={2}
                    max={64}
                    value={customRows}
                    onChange={(e) => setCustomRows(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
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
