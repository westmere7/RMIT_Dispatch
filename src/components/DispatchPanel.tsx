import { useEffect, useMemo, useState } from 'react';
import { versionName, type DispatchTarget } from '../lib/dispatch';
import type { DispatchDocument } from '../types';
import { IconDispatch, IconLock, IconX } from './Icons';

/* ============================================================
   Dispatch — the app's namesake action: push a document's
   shared content down to the adaptations that follow it.

   Two shapes, one panel:
   - 'version'   finalising in the editor. Snapshots a new version
                 (its name is being written here) and dispatches.
   - 'propagate' from the project's lineage view. Sends the content
                 that is already there, so there is nothing to name —
                 only the version the adaptations end up following.
   ============================================================ */

export interface DispatchArgs {
  /** Optional extra name for the new version. 'version' mode only. */
  label?: string;
  /** Optional description or notes for the new version. */
  description?: string;
  targetIds: string[];
}

export function DispatchPanel({
  source,
  mode,
  targets,
  loading,
  currentVersion,
  sourceLockedBy,
  onDispatch,
  onClose,
  busy,
}: {
  source: DispatchDocument;
  mode: 'version' | 'propagate';
  targets: DispatchTarget[];
  /** Targets are still being read. */
  loading?: boolean;
  /** Name of the version the adaptations will follow ('propagate' mode). */
  currentVersion?: string | null;
  /** Someone else is editing the source right now ('propagate' mode). */
  sourceLockedBy?: string | null;
  onDispatch: (args: DispatchArgs) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const writable = useMemo(() => targets.filter((t) => !t.blockedBy), [targets]);
  // Everything that can take the dispatch starts selected; the ids are the
  // dependency so a refreshed list of the SAME targets does not undo the
  // user's choices mid-panel.
  const writableIds = writable.map((t) => t.doc.id).join(',');
  useEffect(() => {
    setChosen(new Set(writableIds ? writableIds.split(',') : []));
  }, [writableIds]);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const nextNumber = source.versionCount + 1;
  const preview = versionName(nextNumber, label.trim() || null);

  const chosenTargets = targets.filter((t) => chosen.has(t.doc.id));
  const emptyChosen = chosenTargets.filter((t) => t.syncedCount === 0);
  const nothingSelected = chosen.size === 0;
  // Finalising with nothing to send is legitimate — it is just a version.
  const canConfirm = mode === 'version' ? true : !nothingSelected && !loading;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconDispatch size={16} /> {mode === 'version' ? 'Save & Dispatch' : 'Dispatch changes'}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        {mode === 'version' ? (
          <div style={{ marginBottom: 16, fontSize: '12px', color: 'var(--text-muted)' }}>
            <p style={{ marginBottom: 6, color: 'var(--text)' }}>
              Save your latest changes to <strong>{source.title}</strong> and finish editing.
            </p>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
              <li>
                <strong>Save version only:</strong> Creates a permanent version milestone (v{nextNumber}) without updating child adaptations.
              </li>
              <li>
                <strong>Save &amp; Dispatch:</strong> Saves the version and immediately pushes your shared content to the chosen adaptations.
              </li>
            </ul>
          </div>
        ) : (
          <p className="muted text-xs" style={{ marginBottom: 16 }}>
            Pushes shared content from <strong>{source.title}</strong> to the selected adaptations below.
          </p>
        )}

        {/* ---------- The version ---------- */}
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor={mode === 'version' ? 'disp-label' : undefined}>Version</label>
          {mode === 'version' ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="pill pill-accent" style={{ flexShrink: 0 }}>
                  v{nextNumber}
                </span>
                <input
                  id="disp-label"
                  className="input"
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Optional name — Spring intake, Round 2…"
                />
              </div>
              <textarea
                id="disp-desc"
                className="input"
                style={{
                  marginTop: 8,
                  minHeight: 52,
                  resize: 'vertical',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  padding: '6px 10px',
                }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description or release notes…"
              />
              <span className="muted text-xs" style={{ marginTop: 5, display: 'block' }}>
                Adaptations will follow <strong>{preview}</strong>
              </span>
            </>
          ) : (
            <span className="text-sm">
              {currentVersion ? (
                <>
                  Adaptations will follow <strong>{currentVersion}</strong>
                </>
              ) : (
                <span className="muted">
                  No finalized version yet — adaptations will follow the current working draft.
                </span>
              )}
            </span>
          )}
        </div>

        {sourceLockedBy && (
          <p className="disp-warn text-xs">
            <IconLock size={12} /> {sourceLockedBy} is editing {source.title} right now — whatever
            they have saved so far is what gets dispatched.
          </p>
        )}

        {/* ---------- The targets ---------- */}
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>Dispatch to</span>
            {writable.length > 1 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setChosen(
                    chosen.size === writable.length
                      ? new Set()
                      : new Set(writable.map((t) => t.doc.id)),
                  )
                }
              >
                {chosen.size === writable.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </label>

          {loading ? (
            <div className="spinner" />
          ) : targets.length === 0 ? (
            <p className="muted text-xs">
              No adaptations derive from {source.title} yet — there is nothing to dispatch to.
            </p>
          ) : (
            <div className="disp-list">
              {targets.map((t) => {
                const blocked = !!t.blockedBy;
                return (
                  <label
                    key={t.doc.id}
                    className={`disp-row ${blocked ? 'is-blocked' : ''}`}
                    style={{ ['--disp-depth' as string]: t.depth - 1 }}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(t.doc.id)}
                      disabled={blocked}
                      onChange={() => toggle(t.doc.id)}
                    />
                    <span className="disp-row-body">
                      <span className="disp-row-title">{t.doc.title}</span>
                      <span className="muted text-xs">
                        {t.depth > 1 ? `follows ${t.parentTitle} · ` : ''}v{t.doc.versionCount}
                      </span>
                    </span>
                    {blocked ? (
                      <span className="pill pill-primary">
                        <IconLock size={10} /> {t.blockedBy}
                      </span>
                    ) : t.syncedCount === 0 ? (
                      <span
                        className="pill pill-warning"
                        title={`${t.doc.title} carries no embed that takes content from ${t.parentTitle}`}
                      >
                        nothing synced
                      </span>
                    ) : (
                      <span
                        className="pill pill-success"
                        /* The card's own count includes `up` embeds; this one
                           counts only what a dispatch can actually change. */
                        title={`${t.syncedCount} embed(s) here take their content from upstream`}
                      >
                        {t.syncedCount} synced
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------- Guards ---------- */}
        {!loading && targets.length > 0 && nothingSelected && mode !== 'version' && (
          <p className="disp-warn text-xs">
            Pick at least one adaptation to dispatch to.
          </p>
        )}
        {emptyChosen.length > 0 && (
          <p className="disp-warn text-xs">
            {emptyChosen.map((t) => t.doc.title).join(', ')}{' '}
            {emptyChosen.length === 1 ? 'carries' : 'carry'} no sync fields from {source.title}, so
            nothing will reach {emptyChosen.length === 1 ? 'it' : 'them'}. Embed a field or bind a
            block there first.
          </p>
        )}
        {targets.some((t) => t.blockedBy) && (
          <p className="muted text-xs" style={{ marginTop: 8 }}>
            Documents someone else is editing cannot receive a dispatch — their draft is locked
            until they stop.
          </p>
        )}

        {mode === 'version' ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginTop: 24,
            }}
          >
            <button
              className="btn btn-ghost"
              onClick={onClose}
              disabled={busy}
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                className="btn"
                disabled={busy}
                title={`Save as version v${nextNumber} without updating child adaptations`}
                style={{ fontWeight: 500 }}
                onClick={() =>
                  onDispatch({
                    label: label.trim() || undefined,
                    description: description.trim() || undefined,
                    targetIds: [],
                  })
                }
              >
                Save version only
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                style={{ fontWeight: 600, paddingLeft: 18, paddingRight: 18 }}
                onClick={() =>
                  onDispatch({
                    label: label.trim() || undefined,
                    description: description.trim() || undefined,
                    targetIds: targets.filter((t) => chosen.has(t.doc.id)).map((t) => t.doc.id),
                  })
                }
              >
                <IconDispatch size={13} />{' '}
                {busy
                  ? 'Saving & Dispatching…'
                  : chosen.size > 0
                    ? `Save & Dispatch (${chosen.size})`
                    : 'Save & Dispatch'}
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 24,
            }}
          >
            <button
              className="btn btn-ghost"
              onClick={onClose}
              disabled={busy}
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!canConfirm || busy}
              style={{ fontWeight: 600, paddingLeft: 18, paddingRight: 18 }}
              onClick={() =>
                onDispatch({
                  targetIds: targets.filter((t) => chosen.has(t.doc.id)).map((t) => t.doc.id),
                })
              }
            >
              <IconDispatch size={13} />{' '}
              {busy ? 'Dispatching…' : nothingSelected ? 'Dispatch' : `Dispatch to ${chosen.size}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
