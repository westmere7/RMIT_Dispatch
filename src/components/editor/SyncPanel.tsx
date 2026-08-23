import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEditor } from '../../editor/EditorProvider';
import { uuid } from '../../lib/ids';
import { plainText } from '../../lib/richtext';
import { collectUsages, valueAsRich, type FieldUsage } from '../../lib/syncfields';
import { useWorkspace } from '../../pages/Workspace';
import { useAuth } from '../../store/auth';
import { fetchDocuments } from '../../store/documents';
import { fetchDraft } from '../../store/drafts';
import { createField, deleteField, renameField } from '../../store/fields';
import type { Block, SyncDirection, SyncField } from '../../types';
import { IconLink, IconPencil, IconTrash, IconUnlink } from '../Icons';
import { FieldSpanMenu } from './FieldSpanMenu';

interface UsageRow extends FieldUsage {
  docId: string;
  docTitle: string;
}

export function SyncPanel() {
  const { doc, project, fields, setFields, activeSpan } = useWorkspace();
  const { state, dispatch, readOnly } = useEditor();
  const navigate = useNavigate();
  const [usages, setUsages] = useState<UsageRow[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const loadUsages = useCallback(async () => {
    const docs = await fetchDocuments(project.id);
    const rows: UsageRow[] = [];
    for (const d of docs) {
      const pages = d.id === doc.id ? state.pages : ((await fetchDraft(d.id))?.pages ?? []);
      for (const u of collectUsages(pages)) {
        rows.push({ ...u, docId: d.id, docTitle: d.title });
      }
    }
    setUsages(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, doc.id]);

  useEffect(() => {
    void loadUsages();
  }, [loadUsages]);

  const selectedBlock = (() => {
    if (state.selection.length !== 1) return null;
    for (const p of state.pages) {
      const b = p.blocks.find((x) => x.id === state.selection[0]);
      if (b) return { block: b, pageId: p.id };
    }
    return null;
  })();

  const jump = (u: UsageRow) => {
    if (u.docId !== doc.id) {
      navigate(`/docs/${u.docId}`);
      return;
    }
    dispatch({ type: 'SET_PAGE', pageId: u.pageId });
    dispatch({ type: 'SELECT', ids: [u.blockId] });
  };

  const dirGlyph = (d: SyncDirection) => (d === 'down' ? '↓' : d === 'up' ? '↑' : '⇅');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {activeSpan && <FieldSpanMenu />}

      {selectedBlock && (
        <BlockBindingCard block={selectedBlock.block} pageId={selectedBlock.pageId} />
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ flex: 1 }}>Project fields</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => void loadUsages()}>
            Refresh
          </button>
        </div>
        {fields.length === 0 && (
          <p className="muted text-xs">
            No sync fields yet. In the master, select text in a block&apos;s body and use the
            <strong> Field</strong> toolbar button.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {fields.map((f) => (
            <FieldCard
              key={f.id}
              field={f}
              usages={(usages ?? []).filter((u) => u.fieldId === f.id)}
              renaming={renaming === f.id}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              startRename={() => {
                setRenaming(f.id);
                setRenameValue(f.name);
              }}
              commitRename={async () => {
                const name = renameValue.trim();
                if (name && name !== f.name) {
                  await renameField(f.id, name);
                  setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, name } : x)));
                }
                setRenaming(null);
              }}
              onDelete={async () => {
                if (
                  confirm(
                    `Delete field "${f.name}"? Embeds keep their current text but stop syncing.`,
                  )
                ) {
                  await deleteField(f.id);
                  setFields((prev) => prev.filter((x) => x.id !== f.id));
                }
              }}
              jump={jump}
              dirGlyph={dirGlyph}
              readOnly={readOnly && doc.kind === 'master' ? true : readOnly}
            />
          ))}
        </div>
      </div>

      {!readOnly && selectedBlock && selectedBlock.block.type === 'text' && !selectedBlock.block.binding && (
        <BindWholeBlock block={selectedBlock.block} pageId={selectedBlock.pageId} />
      )}
    </div>
  );
}

function FieldCard({
  field,
  usages,
  renaming,
  renameValue,
  setRenameValue,
  startRename,
  commitRename,
  onDelete,
  jump,
  dirGlyph,
  readOnly,
}: {
  field: SyncField;
  usages: UsageRow[];
  renaming: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  startRename: () => void;
  commitRename: () => Promise<void>;
  onDelete: () => Promise<void>;
  jump: (u: UsageRow) => void;
  dirGlyph: (d: SyncDirection) => string;
  readOnly: boolean;
}) {
  const preview = plainText(valueAsRich(field.value));
  return (
    <div className="card card-accent accent-synced" style={{ padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {renaming ? (
          <form
            style={{ flex: 1, display: 'flex', gap: 4 }}
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename();
            }}
          >
            <input
              className="input"
              style={{ height: 26 }}
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => void commitRename()}
            />
          </form>
        ) : (
          <strong
            style={{
              flex: 1,
              fontSize: 'var(--fs-sm)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {field.name}
          </strong>
        )}
        {!readOnly && !renaming && (
          <>
            <button className="icon-btn" style={{ width: 24, height: 24 }} title="Rename" aria-label={`Rename ${field.name}`} onClick={startRename}>
              <IconPencil size={12} />
            </button>
            <button className="icon-btn" style={{ width: 24, height: 24 }} title="Delete field" aria-label={`Delete ${field.name}`} onClick={() => void onDelete()}>
              <IconTrash size={12} />
            </button>
          </>
        )}
      </div>
      <div
        className="muted text-xs"
        style={{ margin: '4px 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={preview}
      >
        “{preview}”
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {usages.length === 0 && <span className="muted text-xs">Not embedded anywhere yet.</span>}
        {usages.map((u, i) => (
          <button
            key={i}
            className="text-xs"
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px 0',
              textAlign: 'left',
            }}
            onClick={() => jump(u)}
            title="Jump to usage"
          >
            <span className="pill" style={{ height: 18 }}>
              {dirGlyph(u.direction)} {u.kind}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {u.docTitle}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Whole-block binding controls ---------- */

function BlockBindingCard({ block, pageId }: { block: Block; pageId: string }) {
  const { dispatch, readOnly } = useEditor();
  const { fieldMap, masterDoc, doc } = useWorkspace();
  if (!block.binding) return null;
  const b = block.binding;
  const fieldName = b.fieldId ? (fieldMap.get(b.fieldId)?.name ?? 'deleted field') : null;

  return (
    <div className="card" style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="pill pill-accent">block binding</span>
        <strong style={{ flex: 1 }}>{fieldName ?? 'master block'}</strong>
      </div>
      {!readOnly && (
        <>
          <div className="field">
            <label>Direction</label>
            <select
              className="input"
              value={b.direction}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_BLOCK',
                  pageId,
                  blockId: block.id,
                  patch: { binding: { ...b, direction: e.target.value as SyncDirection } },
                })
              }
            >
              <option value="down">↓ down — follow {fieldName ? 'the field' : 'the master'}</option>
              <option value="up">↑ up — push local content on save</option>
              <option value="two-way">⇅ two-way</option>
            </select>
          </div>
          <button
            className="btn btn-sm"
            onClick={() =>
              dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch: { binding: undefined } })
            }
          >
            <IconUnlink size={12} /> Unlink block (keep a plain copy)
          </button>
        </>
      )}
      {doc.kind === 'adaptation' && masterDoc && (
        <Link className="btn btn-ghost btn-sm" to={`/docs/${masterDoc.id}`}>
          Go to master
        </Link>
      )}
    </div>
  );
}

/** In the master: turn a whole text block into a sync field. */
function BindWholeBlock({ block, pageId }: { block: Block; pageId: string }) {
  const { doc, project, fields, setFields } = useWorkspace();
  const { dispatch } = useEditor();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (block.type !== 'text' || doc.kind !== 'master' || !user) return null;

  const make = async () => {
    setBusy(true);
    try {
      const id = uuid();
      const name = autoName(plainText(block.body), fields.map((f) => f.name));
      const field = await createField({
        id,
        projectId: project.id,
        name,
        value: { kind: 'richtext', rich: block.body },
        userId: user.uid,
      });
      setFields((prev) => [...prev, field]);
      dispatch({
        type: 'UPDATE_BLOCK',
        pageId,
        blockId: block.id,
        patch: { binding: { fieldId: id, sourceBlockId: block.id, direction: 'two-way' } },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm" onClick={() => void make()} disabled={busy}>
      <IconLink size={12} /> Make whole block a sync field
    </button>
  );
}

function autoName(text: string, existing: string[]): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .slice(0, 40) || 'block';
  let name = base;
  let i = 2;
  while (existing.includes(name)) name = `${base}-${i++}`;
  return name;
}
