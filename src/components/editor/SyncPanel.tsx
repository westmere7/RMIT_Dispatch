import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEditor } from '../../editor/EditorProvider';
import { useFieldOps } from '../../editor/useFieldOps';
import { useWorkspace } from '../../editor/workspaceContext';
import { ContextMenu, type MenuItem } from '../ContextMenu';
import {
  buildFolderTree,
  matchesQuery,
  normalizeFolder,
  type FolderNode,
} from '../../lib/fieldtree';
import { blockTarget, fieldShapeLabel } from '../../lib/fieldtypes';
import { collectUsages, type FieldUsage } from '../../lib/syncfields';
import { fetchDocuments } from '../../store/documents';
import { fetchDraft } from '../../store/drafts';
import { deleteField, setFieldFolder, setFieldScope } from '../../store/fields';
import type { Block, SyncDirection, SyncField } from '../../types';
import { useDialog } from '../Dialog';
import {
  IconChevronDown,
  IconChevronRight,
  IconImage,
  IconLink,
  IconMore,
  IconPencil,
  IconSearch,
  IconTable,
  IconTrash,
  IconType,
  IconUnlink,
} from '../Icons';
import { FieldPicker } from './FieldPicker';
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
  const [menu, setMenu] = useState<{ x: number; y: number; field: SyncField } | null>(null);

  /**
   * Usages in the OTHER documents of this project. This one is excluded
   * on purpose: its rows are recomputed from the live pages below, so
   * counts stay correct while you edit instead of going stale after the
   * one fetch.
   */
  const loadUsages = useCallback(async () => {
    const docs = await fetchDocuments(project.id);
    const rows: UsageRow[] = [];
    for (const d of docs) {
      if (d.id === doc.id) continue;
      const pages = (await fetchDraft(d.id))?.pages ?? [];
      for (const u of collectUsages(pages)) {
        rows.push({ ...u, docId: d.id, docTitle: d.title });
      }
    }
    setUsages(rows);
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

  /** Usages of THIS document, recomputed as it is edited. */
  const localUsages = useMemo(() => collectUsages(state.pages), [state.pages]);

  /** This document (live) plus the rest of the project (fetched). */
  const allUsages = useMemo<UsageRow[]>(
    () => [
      ...localUsages.map((u) => ({ ...u, docId: doc.id, docTitle: doc.title })),
      ...(usages ?? []),
    ],
    [localUsages, usages, doc.id, doc.title],
  );

  const usageCount = (id: string) => allUsages.filter((u) => u.fieldId === id).length;

  const selectedBlock = (() => {
    if (state.selection.length !== 1) return null;
    for (const p of state.pages) {
      const b = p.blocks.find((x) => x.id === state.selection[0]);
      // Shapes are decoration and have no sync surface at all.
      if (b) return b.type === 'shape' ? null : { block: b, pageId: p.id };
    }
    return null;
  })();

  /**
   * Fields the current selection involves: the span the caret is in, the
   * selected block's own binding, and every field embedded inside the
   * selected blocks. These rows get highlighted so the list answers
   * "which field is this?" without opening anything.
   */
  const activeFieldIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSpan) ids.add(activeSpan.fieldId);
    const selected = new Set(state.selection);
    for (const p of state.pages) {
      for (const b of p.blocks) {
        if (!selected.has(b.id)) continue;
        if (b.binding?.fieldId) ids.add(b.binding.fieldId);
      }
    }
    for (const u of localUsages) {
      if (selected.has(u.blockId)) ids.add(u.fieldId);
    }
    return ids;
  }, [activeSpan, state.selection, state.pages, localUsages]);

  /** Does a folder subtree contain a highlighted field? */
  const subtreeActive = (node: FolderNode): boolean =>
    node.fields.some((f) => activeFieldIds.has(f.id)) || node.children.some(subtreeActive);

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

  /** Actions for one field, all behind the row's overflow button. */
  const fieldMenu = (f: SyncField): MenuItem[] => {
    const mine = allUsages.filter((u) => u.fieldId === f.id);
    const items: MenuItem[] = [
      {
        kind: 'header',
        label: f.name,
        sub: `${fieldShapeLabel(f.value)} · ${f.scope === 'global' ? 'global' : 'this project'}${
          f.folder ? ` · ${f.folder}` : ''
        }`,
      },
      { kind: 'item', label: 'Show value…', onSelect: () => setPeeking(f) },
      {
        kind: 'item',
        label: 'Edit in isolation…',
        icon: <IconPencil size={13} />,
        onSelect: () => setEditing(f),
      },
    ];
    if (mine.length) {
      items.push({
        kind: 'submenu',
        label: `Jump to usage (${mine.length})`,
        items: mine.slice(0, 20).map<MenuItem>((u) => ({
          kind: 'item',
          label: u.docTitle,
          hint: `${dirGlyph(u.direction)} ${u.kind}`,
          onSelect: () => jump(u),
        })),
      });
    }
    if (!readOnly) {
      items.push(
        { kind: 'separator' },
        {
          kind: 'item',
          label: f.scope === 'global' ? 'Make project-only' : 'Make global',
          icon: f.scope === 'global' ? <IconUnlink size={13} /> : <IconLink size={13} />,
          onSelect: () => void toggleScope(f),
        },
        {
          kind: 'item',
          label: 'Move to folder…',
          icon: <IconChevronRight size={13} />,
          onSelect: () => void moveField(f),
        },
        {
          kind: 'item',
          label: 'Delete field',
          danger: true,
          icon: <IconTrash size={13} />,
          onSelect: () => void removeField(f),
        },
      );
    }
    return items;
  };

  /**
   * One compact field row: name, shape, usage count, and a single
   * overflow button. Everything else — the value, where it is used, the
   * actions — lives behind a click, so a long list stays readable.
   */
  const FieldRow = ({ f, depth }: { f: SyncField; depth: number }) => {
    const n = usageCount(f.id);
    const active = activeFieldIds.has(f.id);
    return (
      <div
        className={`fp-row ${active ? 'is-active' : ''}`}
        style={{ paddingLeft: 6 + depth * 11 }}
        title={shortLabel(f.value)}
      >
        <span className={`fp-dot ${f.scope === 'global' ? 'is-global' : ''}`} />
        <button
          className="fp-name fp-name-btn"
          onClick={() => setPeeking(f)}
          title="Show the full value and actions"
        >
          {f.name}
        </button>
        <span className="fp-shape">{fieldShapeLabel(f.value)}</span>
        <span className={`fp-count ${n === 0 ? 'is-zero' : ''}`} title={`${n} embed(s)`}>
          {n}
        </span>
        <button
          className="icon-btn fp-more"
          title={`Actions for ${f.name}`}
          aria-label={`Actions for ${f.name}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 4, y: r.bottom + 2, field: f });
          }}
        >
          <IconMore size={12} />
        </button>
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
              className={`fp-folder ${subtreeActive(child) ? 'has-active' : ''}`}
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
      {selectedBlock &&
        (selectedBlock.block.binding ? (
          <BlockBindingCard block={selectedBlock.block} pageId={selectedBlock.pageId} />
        ) : (
          <BlockSyncCard block={selectedBlock.block} pageId={selectedBlock.pageId} />
        ))}
      {state.selection.length > 1 && (
        <div className="fp-binding">
          <span className="text-xs muted">
            {state.selection.length} blocks selected — syncing works on one block at a time.
          </span>
        </div>
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

      {/* Usages are shown for what is selected. The full list per field
          is one click away in its overflow menu, which keeps this panel
          from turning into a wall of rows. */}
      {activeFieldIds.size > 0 &&
        (() => {
          const rows = allUsages.filter((u) => activeFieldIds.has(u.fieldId));
          if (rows.length === 0) return null;
          return (
            <div className="fp-section">
              <span className="fp-section-title" style={{ padding: '4px 6px', display: 'block' }}>
                WHERE USED · SELECTION
              </span>
              {rows.slice(0, 30).map((u, i) => {
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
          );
        })()}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={fieldMenu(menu.field)}
          onClose={() => setMenu(null)}
        />
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

/* ---------- Turning a whole block into a field ---------- */

const BLOCK_KIND: Record<string, { label: string; icon: React.ReactNode; shape: string }> = {
  text: { label: 'text block', icon: <IconType size={12} />, shape: 'text field' },
  table: { label: 'table', icon: <IconTable size={12} />, shape: 'table field' },
  image: { label: 'image', icon: <IconImage size={12} />, shape: 'image field' },
};

/**
 * Shown for a single unbound block. Promoting the whole block needs no
 * text selection — the block's own content becomes the field value, and
 * the field takes the shape that matches the block.
 */
function BlockSyncCard({ block, pageId }: { block: Block; pageId: string }) {
  const { dispatch, readOnly } = useEditor();
  const { fields } = useWorkspace();
  const { createFieldFromBlock, bindBlockToField } = useFieldOps();
  const target = blockTarget(block);
  const kind = BLOCK_KIND[block.type];
  if (readOnly || !target || !kind) return null;

  const patch = (p: Partial<Block>) =>
    dispatch({ type: 'UPDATE_BLOCK', pageId, blockId: block.id, patch: p });

  return (
    <div className="fp-binding">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="pill">{kind.icon} {kind.label}</span>
        <span className="text-xs muted" style={{ flex: 1 }}>
          not synced
        </span>
      </div>
      <button
        className="btn btn-primary btn-sm"
        title={`Create a ${kind.shape} from this block's content`}
        onClick={() => void createFieldFromBlock(block).then((p) => p && patch(p))}
      >
        <IconLink size={12} /> Make this {kind.label} a sync field
      </button>
      <FieldPicker
        fields={fields}
        target={target}
        label="Bind to an existing field"
        icon={<IconLink size={12} />}
        compact
        onPick={(f) => void bindBlockToField(block, f.id).then((p) => p && patch(p))}
      />
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
