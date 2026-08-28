import { useState } from 'react';
import { DEFAULT_TABLE, MAX_TABLE, type TableSpec } from '../../lib/blocks';
import { IconX } from '../Icons';

/* ============================================================
   How big, before the table exists.

   Inserting a fixed 2×2 and then rebuilding it is the slowest way to
   get a five-column table, and reshaping one afterwards means keeping
   merges, bindings and track sizes in step for edits the author only
   made because the starting size was wrong.
   ============================================================ */

const MAX_PREVIEW = 8;

export function NewTablePanel({
  onCreate,
  onClose,
}: {
  onCreate: (spec: TableSpec) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(DEFAULT_TABLE.rows);
  const [cols, setCols] = useState(DEFAULT_TABLE.cols);
  const [headerRow, setHeaderRow] = useState(DEFAULT_TABLE.headerRow);

  const clamp = (n: number) => Math.max(1, Math.min(MAX_TABLE, Math.round(n) || 1));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        style={{ maxWidth: 400 }}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ rows: clamp(rows), cols: clamp(cols), headerRow });
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2>New table</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="nt-cols">Columns</label>
            <input
              id="nt-cols"
              className="input"
              type="number"
              min={1}
              max={MAX_TABLE}
              autoFocus
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="nt-rows">Rows</label>
            <input
              id="nt-rows"
              className="input"
              type="number"
              min={1}
              max={MAX_TABLE}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </div>
        </div>

        <label className="pb-check" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={headerRow}
            onChange={(e) => setHeaderRow(e.target.checked)}
          />
          First row is a header
        </label>

        {/* Shows what the numbers mean, header included — the header is
            the one choice that is hard to picture from a checkbox. */}
        <div className="nt-preview" aria-hidden="true">
          {Array.from({ length: Math.min(clamp(rows), MAX_PREVIEW) }, (_, ri) => (
            <div key={ri} className="nt-prow">
              {Array.from({ length: Math.min(clamp(cols), MAX_PREVIEW) }, (_, ci) => (
                <span key={ci} className={`nt-pcell ${headerRow && ri === 0 ? 'head' : ''}`} />
              ))}
              {clamp(cols) > MAX_PREVIEW && <span className="nt-more">…</span>}
            </div>
          ))}
          {clamp(rows) > MAX_PREVIEW && <div className="nt-more">…</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Insert {clamp(cols)}×{clamp(rows)} table
          </button>
        </div>
      </form>
    </div>
  );
}
