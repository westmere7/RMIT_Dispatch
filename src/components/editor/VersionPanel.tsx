import { useEffect, useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { applySyncDown } from '../../lib/syncfields';
import { useWorkspace } from '../../pages/Workspace';
import { fetchVersions } from '../../store/versions';
import type { Version } from '../../types';
import { IconHistory } from '../Icons';

export function VersionPanel() {
  const { doc, fieldMap, masterBlocks, isLockHolder, versionsKey } = useWorkspace();
  const { dispatch } = useEditor();
  const [versions, setVersions] = useState<Version[] | null>(null);

  useEffect(() => {
    void fetchVersions(doc.id).then(setVersions);
  }, [doc.id, doc.versionCount, versionsKey]);

  const restore = (v: Version) => {
    if (!isLockHolder) {
      alert('Take the lock (Edit) before restoring a version.');
      return;
    }
    if (!confirm(`Restore version ${v.number} into the working draft?`)) return;
    // Bindings restore too; embeds re-resolve against current field values.
    const pages = applySyncDown(v.snapshot.pages, fieldMap, masterBlocks ?? undefined);
    dispatch({ type: 'RESTORE_PAGES', pages });
  };

  if (!versions) return <div className="spinner" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3>Versions</h3>
      {versions.length === 0 && (
        <p className="muted text-xs">
          No versions yet. <strong>Finalize</strong> writes an immutable snapshot and releases the
          lock.
        </p>
      )}
      {versions.map((v) => {
        const isCurrent = doc.currentVersionId === v.id;
        return (
          <div
            key={v.id}
            className={`card card-accent ${isCurrent ? 'accent-synced' : 'accent-neutral'}`}
            style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconHistory size={13} />
              <strong style={{ flex: 1 }}>
                v{v.number}
                {v.label ? ` — ${v.label}` : ''}
              </strong>
              {isCurrent && <span className="pill pill-success">current</span>}
            </div>
            <span className="muted text-xs">
              {v.createdByName || 'Unknown'} · {new Date(v.createdAt).toLocaleString()} ·{' '}
              {v.snapshot.pages.length} page{v.snapshot.pages.length === 1 ? '' : 's'}
            </span>
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => restore(v)}>
              Restore
            </button>
          </div>
        );
      })}
    </div>
  );
}
