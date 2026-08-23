import { useMemo, useState } from 'react';
import { DEFAULT_GRID, GRID_PRESETS, PAGE_SIZES } from '../grid/presets';
import type { GridConfig, Orientation, PageSize } from '../types';
import { GridPreview } from './GridPreview';
import { IconX } from './Icons';

export function NewProjectPanel({
  onCreate,
  onClose,
  busy,
}: {
  onCreate: (args: { title: string; type: string; grid: GridConfig }) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Campaign');
  const [pageSize, setPageSize] = useState<PageSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [presetKey, setPresetKey] = useState('editorial');
  const [customCols, setCustomCols] = useState(12);
  const [customRows, setCustomRows] = useState(16);
  const [marginMm, setMarginMm] = useState(DEFAULT_GRID.marginMm);
  const [gutterMm, setGutterMm] = useState(DEFAULT_GRID.gutterMm);
  const [spineMm, setSpineMm] = useState(DEFAULT_GRID.spineMm);

  const grid: GridConfig = useMemo(() => {
    const preset = GRID_PRESETS.find((p) => p.key === presetKey);
    return {
      pageSize,
      orientation,
      columns: preset ? preset.columns : Math.max(2, Math.min(48, customCols)),
      rows: preset ? preset.rows : Math.max(2, Math.min(64, customRows)),
      marginMm,
      gutterMm,
      spineMm,
    };
  }, [pageSize, orientation, presetKey, customCols, customRows, marginMm, gutterMm, spineMm]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>New project</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="np-title">Title</label>
              <input
                id="np-title"
                className="input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Postgraduate Guide 2026"
              />
            </div>
            <div className="field">
              <label htmlFor="np-type">Type</label>
              <input
                id="np-type"
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="Campaign, Guide, Brochure…"
              />
            </div>
            <div className="field">
              <label htmlFor="np-size">Page size</label>
              <select
                id="np-size"
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
                {GRID_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={presetKey === p.key ? 'active' : ''}
                    onClick={() => setPresetKey(p.key)}
                    title={p.recommended ? 'Recommended' : undefined}
                  >
                    {p.label}
                    {p.recommended ? ' ★' : ''}
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
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || busy}
            onClick={() => onCreate({ title: title.trim(), type: type.trim(), grid })}
          >
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
