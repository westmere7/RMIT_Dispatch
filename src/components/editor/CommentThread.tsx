import { useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { useWorkspace } from '../../editor/workspaceContext';
import { useAuth } from '../../store/auth';
import { addComment, deleteComment, setCommentResolved } from '../../store/comments';
import { IconCheck, IconTrash } from '../Icons';

export function CommentThread() {
  const { doc, comments, setComments } = useWorkspace();
  const { state } = useEditor();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [anchorToBlock, setAnchorToBlock] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const selectedBlockId = state.selection.length === 1 ? state.selection[0] : null;

  const submit = async () => {
    if (!user || !body.trim()) return;
    const c = await addComment({
      documentId: doc.id,
      blockId: anchorToBlock && selectedBlockId ? selectedBlockId : null,
      body: body.trim(),
      userId: user.uid,
      userName: user.displayName,
    });
    setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    setBody('');
  };

  const visible = comments.filter((c) => showResolved || !c.resolved);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h3 style={{ flex: 1 }}>Comments</h3>
        <label className="text-xs muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          resolved
        </label>
      </div>

      {visible.length === 0 && <p className="muted text-xs">No comments yet.</p>}

      {visible.map((c) => (
        <div
          key={c.id}
          className={`card card-accent ${c.resolved ? 'accent-synced' : 'accent-attention'}`}
          style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, opacity: c.resolved ? 0.65 : 1 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="avatar avatar-sm">{c.authorName[0]?.toUpperCase() ?? '?'}</span>
            <strong style={{ flex: 1, fontSize: 'var(--fs-xs)' }}>{c.authorName}</strong>
            <span className="muted text-xs">{new Date(c.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
            {c.body}
          </p>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {c.blockId && <span className="pill">on block</span>}
            <span style={{ flex: 1 }} />
            <button
              className="icon-btn"
              style={{ width: 24, height: 24 }}
              title={c.resolved ? 'Reopen' : 'Resolve'}
              aria-label={c.resolved ? 'Reopen comment' : 'Resolve comment'}
              onClick={async () => {
                await setCommentResolved(c.id, !c.resolved);
                setComments((prev) =>
                  prev.map((x) => (x.id === c.id ? { ...x, resolved: !c.resolved } : x)),
                );
              }}
            >
              <IconCheck size={12} />
            </button>
            {user?.uid === c.authorId && (
              <button
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                title="Delete"
                aria-label="Delete comment"
                onClick={async () => {
                  await deleteComment(c.id);
                  setComments((prev) => prev.filter((x) => x.id !== c.id));
                }}
              >
                <IconTrash size={12} />
              </button>
            )}
          </div>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <textarea
          className="input"
          rows={3}
          placeholder="Write a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {selectedBlockId && (
          <label className="text-xs muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={anchorToBlock}
              onChange={(e) => setAnchorToBlock(e.target.checked)}
            />
            Anchor to the selected block
          </label>
        )}
        <button className="btn btn-primary btn-sm" type="submit" disabled={!body.trim()}>
          Comment
        </button>
      </form>
    </div>
  );
}
