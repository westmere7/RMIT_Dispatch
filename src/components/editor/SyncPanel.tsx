import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEditor } from '../../editor/EditorProvider';
import { useWorkspace } from '../../editor/workspaceContext';
import {
  buildFolderTree,
  matchesQuery,
  normalizeFolder,
  type FolderNode,
} from '../../lib/fieldtree';
import { fieldShapeLabel } from '../../lib/fieldtypes';
import { collectUsages, type FieldUsage } from '../../lib/syncfields';
import { fetchDocuments } from '../../store/documents';
import { fetchDraft } from '../../store/drafts';
import { deleteField, setFieldFolder, setFieldScope } from '../../store/fields';
import type { Block, SyncDirection, SyncField } from '../../types';
import { useDialog } from '../Dialog';
import {
  IconChevronDown,
  IconChevronRight,
  IconLink,
  IconPencil,
  IconSearch,
  IconTrash,
  IconUnlink,
} from '../Icons';
import { FieldEditorDialog } from './FieldEditorDialog';
import { FieldPeekDialog, shortLabel } from './FieldPeek';
import { FieldSpanMenu } from './FieldSpanMenu';

interface UsageRow extends FieldUsage {
  docId: string;
  docTitle: string;
}

const dirGlyph = (d: SyncDirection) => (d === 'down' ? '↓' : d === 'up' ? '↑' : '⇅');

/**
 * Dense, hierarchical field browser. Two scope sections (Global / This
 * project), each a collapsible folder tree, and each field a single
 * compact row: name, shape, usage count and hover actions. The pen opens
 * the isolated field editor.
 */
export function SyncPanel() {
  const { doc, project, fields, setFields, activeSpan } = useWorkspace();
  const { state, dispatch, readOnly } = useEditor();
  const navigate = useNavigate();
  const dialog = useDialog();

  const [usages, setUsages] = useState<UsageRow[] | null>(null);
  const [editing, setEditing] = useState<SyncField | null>(null);
  const [peeking, setPeeking] = useState<SyncField | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  const filtered = useMemo(() => fields.filter((f) => matchesQuery(f, query)), [fields, query]);
  const globalTree = useMemo(
    () => buildFolderTree(filtered.filter((f) => f.scope === 'global')),
    [filtered],
  );
  const localTree = useMemo(
    () => buildFolderTree(filtered.filter((f) => f.scope !== 'global')),
    [filtered],
  );

  const usageCount = (id: string) => (usages ?? []).filter((u) => u.fieldId === id).length;

  const selectedBlock = (() => {
    if (state.selection.length !== 1) return null;
    for (const p of state.pages) {
      const b = p.blocks.find((x) => x.id === state.selection[0]);
      // Shapes are decoration and have no sync surface at all.
      if (b) return b.type === 'shape' ? null : { block: b, pageId: p.id };
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

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const removeField = async (f: SyncField) => {
    const ok = await dialog.confirm(`Delete field “${f.name}”?`, {
      message:
        f.scope === 'global'
          ? 'Every project in the space loses it. Embeds keep their current text but stop syncing.'
          : 'Embeds keep their current text but stop syncing.',
      confirmLabel: 'Delete field',
      danger: true,
    });
    if (!ok) return;
    await deleteField(f.id);
    setFields((prev) => prev.filter((x) => x.id !== f.id));
  };

  const moveField = async (f: SyncField) => {
    const folder = await dialog.prompt('Move to folder', {
      message: 'Use a slash to nest, e.g. Pricing/2026. Leave empty for the root.',
      defaultValue: f.folder,
      confirmLabel: 'Move',
    });
    if (folder === null) return;
    const clean = normalizeFolder(folder);
    await setFieldFolder(f.id, clean);
    setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, folder: clean } : x)));
  };

  const toggleScope = async (f: SyncField) => {
    const next = f.scope === 'global' ? 'local' : 'global';
    const ok = await dialog.confirm(
      next === 'global' ? `Make “${f.name}” global?` : `Make “${f.name}” project-only?`,
      {
        message:
          next === 'global'
            ? 'Every project in this space will be able to use it.'
            : `Only ${project.title} keeps it. Other projects using it will stop seeing it.`,
        confirmLabel: next === 'global' ? 'Make global' : 'Make project-only',
      },
    );
    if (!ok) return;
    await setFieldScope(f.id, next, next === 'local' ? project.id : null);
    setFields((prev) =>
      prev.map((x) =>
        x.id === f.id ? { ...x, scope: next, projectId: next === 'global' ? null : project.id } : x,
      ),
    );
  };

  /** One compact field row. */
  const FieldRow = ({ f, depth }: { f: SyncField; depth: number }) => {
    const n = usageCount(f.id);
    // A short label only — the pen opens the full value.
    return (
      <div className="fp-row" style={{ paddingLeft: 6 + depth * 11 }} title={shortLabel(f.value)}>
        <span className={`fp-dot ${f.scope === 'global' ? 'is-global' : ''}`} />
        <button
          className="fp-name fp-name-btn"
          onClick={() => setPeeking(f)}
          title="Show the full value and actions"
        >
          {f.name}
        </button>
        <span className="fp-shape">{fieldShapeLabel(f.value)}</span>
        {n > 0 && (
          <span className="fp-count" title={`${n} embed(s) in this document`}>
            {n}
          </span>
        )}
        <span className="fp-actions">
          <button
            className="icon-btn"
            title="Edit field in isolation"
            aria-label={`Edit ${f.name}`}
            onClick={() => setEditing(f)}
          >
            <IconPencil size={11} />
          </button>
          {!readOnly && (
            <>
              <button
                className="icon-btn"
                title={f.scope === 'global' ? 'Make project-only' : 'Make global'}
                aria-label={`Change scope of ${f.name}`}
                onClick={() => void toggleScope(f)}
              >
                {f.scope === 'global' ? <IconUnlink size={11} /> : <IconLink size={11} />}
              </button>
              <button
                className="icon-btn"
                title="Move to folder"
                aria-label={`Move ${f.name}`}
                onClick={() => void moveField(f)}
              >
                <IconChevronRight size={11} />
              </button>
              <button
                className="icon-btn"
                title="Delete field"
                aria-label={`Delete ${f.name}`}
                onClick={() => void removeField(f)}
              >
                <IconTrash size={11} />
              </button>
            </>
          )}
        </span>
      </div>
    );
  };

  /** Recursive folder + fields renderer. */
  const Tree = ({
    node,
    depth,
    keyPrefix,
  }: {
    node: FolderNode;
    depth: number;
    keyPrefix: string;
  }) => (
    <>
      {node.children.map((child) => {
        const id = `${keyPrefix}:${child.path}`;
        const isCollapsed = collapsed.has(id) && !query;
        return (
          <div key={id}>
            <button
              className="fp-folder"
              style={{ paddingLeft: 4 + depth * 11 }}
              onClick={() => toggle(id)}
            >
              {isCollapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
              <span className="fp-folder-name">{child.name}</span>
              <span className="fp-count">{child.totalCount}</span>
            </button>
            {!isCollapsed && <Tree node={child} depth={depth + 1} keyPrefix={keyPrefix} />}
          </div>
        );
      })}
      {node.fields.map((f) => (
        <FieldRow key={f.id} f={f} depth={depth} />
      ))}
    </>
  );

  const Section = ({
    title,
    hint,
    tree,
    keyPrefix,
  }: {
    title: string;
    hint: string;
    tree: FolderNode;
    keyPrefix: string;
  }) => {
    const id = `${keyPrefix}:__section`;
    const isCollapsed = collapsed.has(id) && !query;
    return (
      <div className="fp-section">
        <button className="fp-section-head" onClick={() => toggle(id)}>
          {isCollapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
          <span className="fp-section-title">{title}</span>
          <span className="fp-count">{tree.totalCount}</span>
        </button>
        {!isCollapsed &&
          (tree.totalCount === 0 ? (
            <div className="fp-empty">{hint}</div>
          ) : (
            <Tree node={tree} depth={0} keyPrefix={keyPrefix} />
          ))}
      </div>
    );
  };

  return (
    <div className="fp-panel">
      {activeSpan && <FieldSpanMenu />}
      {selectedBlock && (
        <BlockBindingCard block={selectedBlock.block} pageId={selectedBlock.pageId} />
      )}

      <div className="fp-search">
        <IconSearch size={12} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter fields…"
          aria-label="Filter fields"
        />
        <Link className="btn btn-sm" to="/fields" title="Manage global fields outside any project">
          Manage
        </Link>
      </div>

      <Section
        title="GLOBAL"
        hint="No global fields yet. Promote a field to share it across projects."
        tree={globalTree}
        keyPrefix="g"
      />
      <Section
        title="THIS PROJECT"
        hint="No project fields yet. Select text and use Field to make one."
        tree={localTree}
        keyPrefix="l"
      />

      {usages && usages.length > 0 && (
        <div className="fp-section">
          <span className="fp-section-title" style={{ padding: '4px 6px', display: 'block' }}>
            WHERE USED
          </span>
          {usages.slice(0, 40).map((u, i) => {
            const f = fields.find((x) => x.id === u.fieldId);
            if (!f) return null;
            return (
              <button key={i} className="fp-usage" onClick={() => jump(u)} title="Jump to usage">
                <span className="fp-usage-dir">{dirGlyph(u.direction)}</span>
                <span className="fp-name">{f.name}</span>
                <span className="fp-shape">{u.kind}</span>
                <span className="fp-usage-doc">{u.docTitle}</span>
              </button>
            );
          })}
        </div>
      )}

      {peeking && (
        <FieldPeekDialog
          field={peeking}
          onClose={() => setPeeking(null)}
          actions={{
            availability:
              peeking.scope === 'global' ? 'every project in the space' : project.title,
            onEdit: () => setEditing(peeking),
            onMove: readOnly ? undefined : () => void moveField(peeking),
            onToggleScope: readOnly ? undefined : () => void toggleScope(peeking),
            onDelete: readOnly ? undefined : () => void removeField(peeking),
          }}
        />
      )}

      {editing && (
        <FieldEditorDialog
          field={editing}
          allFields={fields}
          projectId={project.id}
          onClose={() => setEditing(null)}
        />
      )}
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
    <div className="fp-binding">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="pill pill-accent">block</span>
        <strong style={{ flex: 1, fontSize: 'var(--fs-xs)' }}>
          {fieldName ?? 'follows master block'}
        </strong>
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            className="input"
            style={{ height: 26, flex: 1 }}
            value={b.direction}
            aria-label="Block sync direction"
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_BLOCK',
                pageId,
                blockId: block.id,
                patch: { binding: { ...b, direction: e.target.value as SyncDirection } },
              })
            }
          >
            <option value="down">↓ down</option>
            <option value="up">↑ up</option>
            <option value="two-way">⇅ two-way</option>
          </select>
          <button
            className="btn btn-sm"
            title="Unlink block, keeping a plain copy"
            onClick={() =>
              dispatch({
                type: 'UPDATE_BLOCK',
                pageId,
                blockId: block.id,
                patch: { binding: undefined },
              })
            }
          >
            <IconUnlink size={11} />
          </button>
        </div>
      )}
      {doc.kind === 'adaptation' && masterDoc && (
        <Link className="text-xs" to={`/docs/${masterDoc.id}`}>
          Go to master →
        </Link>
      )}
    </div>
  );
}
