import { useState } from 'react';
import { allFolderPaths, normalizeFolder } from '../../lib/fieldtree';
import type { SyncField } from '../../types';

/**
 * Folder chooser: pick one that already exists, or switch to typing a new
 * path. A plain text input made existing folders invisible, which is how
 * near-duplicate folders get created.
 */
export function FolderField({
  id,
  value,
  fields,
  onChange,
}: {
  id: string;
  value: string;
  fields: SyncField[];
  onChange: (folder: string) => void;
}) {
  const known = allFolderPaths(fields);
  const isKnown = value === '' || known.includes(value);
  const [custom, setCustom] = useState(!isKnown);

  return (
    <div className="field">
      <label htmlFor={id}>Folder</label>
      {custom ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id={id}
            className="input"
            autoFocus
            placeholder="e.g. Pricing/2026"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              onChange('');
              setCustom(false);
            }}
          >
            Pick existing
          </button>
        </div>
      ) : (
        <select
          id={id}
          className="input"
          value={value}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setCustom(true);
              onChange('');
            } else {
              onChange(e.target.value);
            }
          }}
        >
          <option value="">Root (no folder)</option>
          {known.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value="__new__">＋ New folder…</option>
        </select>
      )}
      <span className="muted text-xs">
        {custom
          ? 'Use a slash to nest, e.g. Pricing/2026.'
          : known.length === 0
            ? 'No folders yet — choose “New folder” to make one.'
            : `${known.length} folder${known.length === 1 ? '' : 's'} available.`}
      </span>
    </div>
  );
}

export { normalizeFolder };
