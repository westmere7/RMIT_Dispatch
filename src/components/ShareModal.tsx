import { useEffect, useState } from 'react';
import { useAuth } from '../store/auth';
import {
  createShareLink,
  deleteShareLink,
  fetchDocShares,
  type ShareLink,
} from '../store/shares';
import type { DispatchDocument, Version } from '../types';
import { fetchVersions } from '../store/versions';
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconExternalLink,
  IconGlobe,
  IconLock,
  IconShare,
  IconTrash,
  IconX,
} from './Icons';

export function ShareModal({
  doc,
  onClose,
}: {
  doc: DispatchDocument;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Form states
  const [expiration, setExpiration] = useState<'never' | '24h' | '7d' | '30d'>('7d');
  const [requireLogin, setRequireLogin] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('latest');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [newlyCreatedShare, setNewlyCreatedShare] = useState<ShareLink | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchDocShares(doc.id), fetchVersions(doc.id)]).then(([sList, vList]) => {
      if (!active) return;
      setShares(sList);
      setVersions(vList);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [doc.id]);

  const handleGenerate = async () => {
    if (!user) return;
    setCreating(true);

    let expiresAt: string | null = null;
    const now = Date.now();
    if (expiration === '24h') {
      expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    } else if (expiration === '7d') {
      expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (expiration === '30d') {
      expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const versionObj =
      selectedVersionId !== 'latest'
        ? versions.find((v) => v.id === selectedVersionId)
        : null;

    const newShare = await createShareLink({
      documentId: doc.id,
      versionId: versionObj?.id ?? null,
      versionNumber: versionObj?.number ?? null,
      expiresAt,
      requireLogin,
      allowCopy: true,
      userId: user.uid,
      userName: user.displayName,
    });

    setShares((prev) => [newShare, ...prev.filter((x) => x.id !== newShare.id)]);
    setNewlyCreatedShare(newShare);
    setCreating(false);

    // Auto copy link to clipboard
    const fullUrl = `${window.location.origin}/preview/${newShare.token}`;
    void navigator.clipboard.writeText(fullUrl);
    setCopiedToken(newShare.token);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const copyUrl = (token: string) => {
    const fullUrl = `${window.location.origin}/preview/${token}`;
    void navigator.clipboard.writeText(fullUrl);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const handleDelete = async (shareId: string) => {
    await deleteShareLink(shareId);
    setShares((prev) => prev.filter((s) => s.id !== shareId));
    if (newlyCreatedShare?.id === shareId) setNewlyCreatedShare(null);
  };

  // Keyboard Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        style={{ maxWidth: 540 }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconShare size={18} style={{ color: 'var(--primary)' }} />
            <div>
              <h2 style={{ margin: 0, fontSize: '16px' }}>Share Publication</h2>
              <div className="muted text-xs" style={{ marginTop: 2 }}>
                {doc.title} · <span className="text-capitalize">{doc.kind}</span>
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="text-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            Generate a shareable preview link for other teams to review and copy text or table
            contents directly into their software.
          </p>

          {/* Creation Box */}
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {/* Expiration */}
            <div className="field" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconClock size={13} /> Link Expiration
              </label>
              <div className="segmented" style={{ width: '100%' }}>
                <button
                  type="button"
                  className={expiration === 'never' ? 'active' : ''}
                  onClick={() => setExpiration('never')}
                >
                  Never
                </button>
                <button
                  type="button"
                  className={expiration === '24h' ? 'active' : ''}
                  onClick={() => setExpiration('24h')}
                >
                  24 hours
                </button>
                <button
                  type="button"
                  className={expiration === '7d' ? 'active' : ''}
                  onClick={() => setExpiration('7d')}
                >
                  7 days
                </button>
                <button
                  type="button"
                  className={expiration === '30d' ? 'active' : ''}
                  onClick={() => setExpiration('30d')}
                >
                  30 days
                </button>
              </div>
            </div>

            {/* Version select */}
            {versions.length > 0 && (
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px' }}>Publication Snapshot</label>
                <select
                  className="input"
                  style={{ fontSize: '13px', padding: '6px 10px' }}
                  value={selectedVersionId}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                >
                  <option value="latest">Latest version / Current working draft</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.number} {v.label ? `— ${v.label}` : ''} ({new Date(v.createdAt).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Access control */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>Require RMIT Sign-in</div>
                <div className="muted text-xs">
                  {requireLogin
                    ? 'Only authenticated team members can open this link.'
                    : 'Anyone with the link can view and copy contents.'}
                </div>
              </div>
              <input
                type="checkbox"
                id="requireLoginCheck"
                checked={requireLogin}
                onChange={(e) => setRequireLogin(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', gap: 6 }}
              onClick={() => void handleGenerate()}
              disabled={creating}
            >
              <IconShare size={14} /> {creating ? 'Generating link...' : 'Generate Share Link'}
            </button>
          </div>

          {/* Newly Created Notification */}
          {newlyCreatedShare && (
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--accent-wash)',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>
                  ✓ Link generated &amp; copied to clipboard!
                </span>
                <a
                  href={`/preview/${newlyCreatedShare.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-sm btn-ghost"
                  style={{ padding: '2px 8px', fontSize: '11px', gap: 4 }}
                >
                  Open Preview <IconExternalLink size={12} />
                </a>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  readOnly
                  className="input"
                  style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  value={`${window.location.origin}/preview/${newlyCreatedShare.token}`}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ flexShrink: 0, gap: 4 }}
                  onClick={() => copyUrl(newlyCreatedShare.token)}
                >
                  {copiedToken === newlyCreatedShare.token ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  {copiedToken === newlyCreatedShare.token ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Active Shares List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="muted text-xs" style={{ fontWeight: 600, textTransform: 'uppercase' }}>
                Active Share Links ({shares.length})
              </span>
            </div>

            {loading && <div className="spinner" />}

            {!loading && shares.length === 0 && !newlyCreatedShare && (
              <div className="muted text-xs" style={{ padding: '8px 0' }}>
                No active share links yet. Generate one above to share this publication.
              </div>
            )}

            {shares.map((s) => {
              const isExpired = !!s.expiresAt && new Date(s.expiresAt).getTime() < Date.now();
              return (
                <div
                  key={s.id}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {s.requireLogin ? (
                        <IconLock size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      ) : (
                        <IconGlobe size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      )}
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.versionNumber ? `Version ${s.versionNumber}` : 'Latest version'}
                      </span>
                      {isExpired ? (
                        <span className="pill pill-danger" style={{ fontSize: '10px', padding: '1px 5px' }}>
                          Expired
                        </span>
                      ) : (
                        <span className="pill pill-success" style={{ fontSize: '10px', padding: '1px 5px' }}>
                          Active
                        </span>
                      )}
                    </div>
                    <div className="muted text-xs" style={{ fontSize: '11px' }}>
                      {s.expiresAt
                        ? `Expires: ${new Date(s.expiresAt).toLocaleDateString()}`
                        : 'No expiration'}
                      {' · '}
                      Created {new Date(s.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {!isExpired && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ padding: '3px 8px', fontSize: '11px', gap: 4 }}
                        onClick={() => copyUrl(s.token)}
                        title="Copy link"
                      >
                        {copiedToken === s.token ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        {copiedToken === s.token ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ padding: '4px' }}
                      title="Revoke share link"
                      onClick={() => void handleDelete(s.id)}
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
