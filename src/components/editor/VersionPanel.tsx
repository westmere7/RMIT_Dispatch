import { useEffect, useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { applySyncDown } from '../../lib/syncfields';
import { useWorkspace } from '../../editor/workspaceContext';
import { fetchVersions } from '../../store/versions';
import type { Block, Page, Version } from '../../types';
import { useDialog } from '../Dialog';
import { IconChevronDown, IconFileText, IconHistory } from '../Icons';

interface VersionDiff {
  added: number;
  modified: number;
  removed: number;
  pageDelta: number;
  isInitial: boolean;
}

function computeVersionDiff(currPages: Page[], prevPages?: Page[] | null): VersionDiff {
  if (!prevPages || prevPages.length === 0) {
    const totalBlocks = currPages.reduce((acc, p) => acc + (p.blocks?.length ?? 0), 0);
    return {
      added: totalBlocks,
      modified: 0,
      removed: 0,
      pageDelta: currPages.length,
      isInitial: true,
    };
  }

  const currBlocks = new Map<string, Block>();
  for (const p of currPages) {
    for (const b of p.blocks ?? []) {
      currBlocks.set(b.id, b);
    }
  }

  const prevBlocks = new Map<string, Block>();
  for (const p of prevPages) {
    for (const b of p.blocks ?? []) {
      prevBlocks.set(b.id, b);
    }
  }

  let added = 0;
  let modified = 0;
  let removed = 0;

  for (const [id, currB] of currBlocks.entries()) {
    const prevB = prevBlocks.get(id);
    if (!prevB) {
      added++;
    } else {
      if (JSON.stringify(currB) !== JSON.stringify(prevB)) {
        modified++;
      }
    }
  }

  for (const id of prevBlocks.keys()) {
    if (!currBlocks.has(id)) {
      removed++;
    }
  }

  const pageDelta = currPages.length - prevPages.length;

  return { added, modified, removed, pageDelta, isInitial: false };
}

export function VersionPanel() {
  const { doc, fieldMap, masterBlocks, isLockHolder, versionsKey } = useWorkspace();
  const { dispatch } = useEditor();
  const dialog = useDialog();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(new Set());
  const [showOlder, setShowOlder] = useState(false);

  useEffect(() => {
    void fetchVersions(doc.id).then(setVersions);
  }, [doc.id, doc.versionCount, versionsKey]);

  const toggleDesc = (id: string) => {
    setExpandedDesc((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const restore = async (v: Version) => {
    if (!isLockHolder) {
      await dialog.alert('Take the lock first', {
        message: 'Press Edit to take the document lock before restoring a version.',
      });
      return;
    }
    const ok = await dialog.confirm(`Restore version ${v.number}?`, {
      message: 'Its snapshot replaces the current working draft. Bindings restore too.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    // Bindings restore too; embeds re-resolve against current field values.
    const pages = applySyncDown(v.snapshot.pages, fieldMap, masterBlocks ?? undefined);
    dispatch({ type: 'RESTORE_PAGES', pages });
  };

  if (!versions) return <div className="spinner" />;

  const recentVersions = versions.slice(0, 3);
  const olderVersions = versions.slice(3);

  const renderVersionCard = (v: Version, index: number) => {
    const isCurrent = doc.currentVersionId === v.id;
    const isExpanded = expandedDesc.has(v.id);
    // Compare to previous version (next item in descending list)
    const prevV = versions[index + 1];
    const diff = computeVersionDiff(v.snapshot.pages, prevV ? prevV.snapshot.pages : null);

    return (
      <div
        key={v.id}
        className={`card card-accent ${isCurrent ? 'accent-synced' : 'accent-neutral'}`}
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Row 1: Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <IconHistory size={14} style={{ opacity: 0.75, flexShrink: 0 }} />
              <strong style={{ fontSize: '14px', lineHeight: '1.2' }}>v{v.number}</strong>
              {isCurrent && (
                <span
                  className="pill pill-success"
                  style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '1.3' }}
                >
                  current
                </span>
              )}
            </div>
            {v.label && (
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--text)',
                  wordBreak: 'break-word',
                  lineHeight: '1.35',
                }}
              >
                {v.label}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {v.description && (
              <button
                type="button"
                className="icon-btn"
                style={{
                  padding: '3px 5px',
                  height: '24px',
                  minWidth: '24px',
                  color: isExpanded ? 'var(--primary)' : 'var(--text-muted)',
                  background: isExpanded ? 'var(--surface-3)' : undefined,
                  borderRadius: 4,
                }}
                title={isExpanded ? 'Hide version notes' : 'View version notes'}
                onClick={() => toggleDesc(v.id)}
              >
                <IconFileText size={13} />
              </button>
            )}

            <button
              className="btn btn-sm"
              style={{
                padding: '2px 9px',
                fontSize: '11px',
                height: '24px',
                flexShrink: 0,
              }}
              onClick={() => void restore(v)}
            >
              Restore
            </button>
          </div>
        </div>

        {/* Row 2: Diff / Change breakdown */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {diff.isInitial ? (
            <span
              className="pill"
              style={{
                background: 'var(--surface-3)',
                fontSize: '10.5px',
                color: 'var(--text-muted)',
              }}
            >
              Initial version · {diff.added} block{diff.added === 1 ? '' : 's'}
            </span>
          ) : diff.added === 0 &&
            diff.modified === 0 &&
            diff.removed === 0 &&
            diff.pageDelta === 0 ? (
            <span
              className="pill"
              style={{
                background: 'var(--surface-3)',
                fontSize: '10.5px',
                color: 'var(--text-muted)',
              }}
            >
              No content changes
            </span>
          ) : (
            <>
              {diff.added > 0 && (
                <span
                  className="pill pill-success"
                  style={{ fontSize: '10.5px', padding: '1px 6px' }}
                >
                  +{diff.added} new
                </span>
              )}
              {diff.modified > 0 && (
                <span
                  className="pill pill-accent"
                  style={{ fontSize: '10.5px', padding: '1px 6px' }}
                >
                  ~{diff.modified} changed
                </span>
              )}
              {diff.removed > 0 && (
                <span
                  className="pill pill-danger"
                  style={{ fontSize: '10.5px', padding: '1px 6px' }}
                >
                  -{diff.removed} removed
                </span>
              )}
              {diff.pageDelta !== 0 && (
                <span
                  className="pill"
                  style={{
                    background: 'var(--surface-3)',
                    fontSize: '10.5px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {diff.pageDelta > 0 ? `+${diff.pageDelta} pg` : `${diff.pageDelta} pg`}
                </span>
              )}
            </>
          )}
        </div>

        {/* Row 3: Metadata */}
        <div
          className="muted text-xs"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            lineHeight: 1.2,
          }}
        >
          <span>
            {v.createdByName || 'Unknown'} · {new Date(v.createdAt).toLocaleString()}
          </span>
          <span>
            {v.snapshot.pages.length} page{v.snapshot.pages.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Expandable Notes */}
        {isExpanded && v.description && (
          <div
            style={{
              marginTop: 2,
              padding: '8px 10px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              fontSize: '12px',
              lineHeight: '1.4',
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <div
              className="muted"
              style={{
                fontSize: '10px',
                fontWeight: 700,
                marginBottom: 3,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Notes
            </div>
            {v.description}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Versions</h3>
        <span className="muted text-xs">{versions.length} total</span>
      </div>

      {versions.length === 0 && (
        <p className="muted text-xs">
          No versions yet. Save a version or run Save &amp; Dispatch to snapshot this document.
        </p>
      )}

      {recentVersions.map((v, i) => renderVersionCard(v, i))}

      {olderVersions.length > 0 && (
        <>
          {showOlder && olderVersions.map((v, i) => renderVersionCard(v, i + 3))}

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 2,
              padding: '8px 12px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border)',
              borderRadius: 6,
            }}
            onClick={() => setShowOlder((prev) => !prev)}
          >
            <IconChevronDown
              size={13}
              style={{
                transform: showOlder ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s ease',
              }}
            />
            {showOlder
              ? 'Hide earlier versions'
              : `Show ${olderVersions.length} earlier version${olderVersions.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  );
}
