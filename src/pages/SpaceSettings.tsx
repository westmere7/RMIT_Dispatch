import { useCallback, useEffect, useState } from 'react';
import { useCrumbs } from '../components/AppShell';
import { RoleBadge } from '../components/RoleBadge';
import { useDialog } from '../components/Dialog';
import { useAuth } from '../store/auth';
import {
  addMember,
  fetchMembers,
  removeMember,
  renameSpace,
  updateMemberRole,
  useSpaces,
} from '../store/spaces';
import type { Role, SpaceMember } from '../types';

const ROLES: Role[] = ['admin', 'editor', 'designer'];

export function SpaceSettings() {
  const { setCrumbs } = useCrumbs();
  const { currentSpace, isAdmin, refresh } = useSpaces();
  const { user } = useAuth();
  const dialog = useDialog();
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => setCrumbs(['Space settings']), [setCrumbs]);
  useEffect(() => setName(currentSpace?.name ?? ''), [currentSpace]);

  const load = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    try {
      setMembers(await fetchMembers(currentSpace.id));
    } finally {
      setLoading(false);
    }
  }, [currentSpace]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentSpace) {
    return (
      <div className="content-pad">
        <p className="muted">Create or select a space first.</p>
      </div>
    );
  }

  const invite = async () => {
    setError(null);
    const err = await addMember(currentSpace.id, inviteEmail, inviteRole);
    if (err) setError(err);
    else {
      setInviteEmail('');
      await load();
    }
  };

  return (
    <div className="content-pad" style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ marginBottom: 12 }}>Space</h2>
        <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            aria-label="Space name"
          />
          {isAdmin && (
            <button
              className="btn"
              disabled={!name.trim() || name === currentSpace.name}
              onClick={async () => {
                await renameSpace(currentSpace.id, name.trim());
                await refresh();
              }}
            >
              Rename
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-5)' }}>
        <h2 style={{ marginBottom: 4 }}>Members</h2>
        <p className="muted text-xs" style={{ marginBottom: 16 }}>
          Admin/editor: create, edit, finalize. Designer: read-only + comments.
        </p>

        {isAdmin && (
          <form
            style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <input
              className="input"
              style={{ flex: '2 1 200px' }}
              type="email"
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              aria-label="Invite email"
            />
            <select
              className="input"
              style={{ flex: '0 0 120px' }}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              aria-label="Invite role"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" type="submit" disabled={!inviteEmail.trim()}>
              Invite
            </button>
          </form>
        )}
        {error && (
          <div className="auth-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="spinner" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {members.map((m, i) => (
              <div
                key={m.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span className="avatar">{(m.displayName || m.email)[0]?.toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {m.displayName || m.email}
                    {m.userId === user?.uid && <span className="muted text-xs"> (you)</span>}
                  </div>
                  <div className="muted text-xs">{m.email}</div>
                </div>
                {isAdmin && m.userId !== user?.uid ? (
                  <>
                    <select
                      className="input"
                      style={{ width: 110 }}
                      value={m.role}
                      onChange={async (e) => {
                        await updateMemberRole(m.spaceId, m.userId, e.target.value as Role);
                        await load();
                      }}
                      aria-label={`Role for ${m.email}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={async () => {
                        const ok = await dialog.confirm(
                          `Remove ${m.displayName || m.email}?`,
                          {
                            message: 'They lose access to every project in this space.',
                            confirmLabel: 'Remove',
                            danger: true,
                          },
                        );
                        if (ok) {
                          await removeMember(m.spaceId, m.userId);
                          await load();
                        }
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <RoleBadge role={m.role} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
