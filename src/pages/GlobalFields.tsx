import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCrumbs } from '../components/AppShell';
import { useDialog } from '../components/Dialog';
import { FieldEditorDialog } from '../components/editor/FieldEditorDialog';
import { FieldValuePreview } from '../components/editor/FieldValuePreview';
import {
  IconChevronDown,
  IconChevronRight,
  IconLink,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../components/Icons';
import { buildFolderTree, matchesQuery, normalizeFolder, type FolderNode } from '../lib/fieldtree';
import { fieldShapeLabel } from '../lib/fieldtypes';
import { isMissingColumn, MIGRATION_HINT } from '../lib/schemaerr';
import { useAuth } from '../store/auth';
import {
  createField,
  deleteField,
  fetchAllSpaceFields,
  fetchProjectTitles,
  renameFolder,
  setFieldFolder,
  setFieldScope,
} from '../store/fields';
import { useSpaces } from '../store/spaces';
import type { SyncField } from '../types';

type ScopeFilter = 'global' | 'local' | 'all';

/** A tree flattened to rows, so every row shares one grid and stays aligned. */
type Row =
  | { kind: 'folder'; key: string; depth: number; node: FolderNode; collapsed: boolean }
  | { kind: 'field'; key: string; depth: number; field: SyncField };

function flatten(node: FolderNode, depth: number, collapsed: Set<string>, out: Row[]): void {
  for (const child of node.children) {
    const isCollapsed = collapsed.has(child.path);
    out.push({ kind: 'folder', key: `f:${child.path}`, depth, node: child, collapsed: isCollapsed });
    if (!isCollapsed) flatten(child, depth + 1, collapsed, out);
  }
  for (const f of node.fields) {
    out.push({ kind: 'field', key: f.id, depth, field: f });
  }
}

/**
 * Space-level sync-field manager, outside any project. Global fields can
 * be created, organised into folders and edited here without opening a
 * document; project-local fields are listed so they can be promoted.
 */
export function GlobalFields() {
  const { setCrumbs } = useCrumbs();
  const { currentSpace, canEdit } = useSpaces();
  const { user } = useAuth();
  const dialog = useDialog();

  const [fields, setFields] = useState<SyncField[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('global');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SyncField | null>(null);

  useEffect(() => setCrumbs(['Sync fields']), [setCrumbs]);

  const load = useCallback(async () => {
    if (!currentSpace) {
      setFields([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [all, t] = await Promise.all([
        fetchAllSpaceFields(currentSpace.id),
        fetchProjectTitles(currentSpace.id),
      ]);
      setFields(all);
      setTitles(t);
    } catch (e) {
      setLoadError(isMissingColumn(e) ? MIGRATION_HINT : (e as Error).message);
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [currentSpace]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      fields
        .filter((f) => (scopeFilter === 'all' ? true : f.scope === scopeFilter))
        .filter((f) => matchesQuery(f, query)),
    [fields, scopeFilter, query],
  );

  const rows = useMemo(() => {
    const out: Row[] = [];
    // While filtering, ignore collapse — a collapsed folder would hide hits.
    flatten(buildFolderTree(visible), 0, query ? new Set<string>() : collapsed, out);
    return out;
  }, [visible, collapsed, query]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const createGlobal = async () => {
    if (!user || !currentSpace) return;
    const name = await dialog.prompt('New global field', {
      message: 'Every project in this space will be able to use it, e.g. intake-year.',
      confirmLabel: 'Create',
    });
    if (!name?.trim()) return;
    const folder = await dialog.prompt('Folder (optional)', {
      message: 'Use a slash to nest, e.g. Pricing/2026.',
      confirmLabel: 'Create field',
    });
    const field = await createField({
      projectId: null,
      spaceId: currentSpace.id,
      scope: 'global',
      folder: normalizeFolder(folder ?? ''),
      name: name.trim(),
      value: { kind: 'richtext', rich: [[{ text: name.trim() }]] },
      userId: user.uid,
    });
    setFields((prev) => [...prev, field]);
    setEditing(field);
  };

  const remove = async (f: SyncField) => {
    const ok = await dialog.confirm(`Delete field “${f.name}”?`, {
      message: 'Embeds everywhere keep their current text but stop syncing.',
      confirmLabel: 'Delete field',
      danger: true,
    });
    if (!ok) return;
    await deleteField(f.id);
    setFields((prev) => prev.filter((x) => x.id !== f.id));
  };

  const move = async (f: SyncField) => {
    const folder = await dialog.prompt('Move to folder', {
      message: 'Use a slash to nest. Leave empty for the root.',
      defaultValue: f.folder,
      confirmLabel: 'Move',
    });
    if (folder === null) return;
    const clean = normalizeFolder(folder);
    await setFieldFolder(f.id, clean);
    setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, folder: clean } : x)));
  };

  const promote = async (f: SyncField) => {
    const ok = await dialog.confirm(`Make “${f.name}” global?`, {
      message: `It belongs to ${titles.get(f.projectId ?? '') ?? 'one project'}. Every project in the space will be able to use it.`,
      confirmLabel: 'Make global',
    });
    if (!ok) return;
    await setFieldScope(f.id, 'global', null);
    setFields((prev) =>
      prev.map((x) => (x.id === f.id ? { ...x, scope: 'global', projectId: null } : x)),
    );
  };

  const renameFolderPath = async (path: string) => {
    const next = await dialog.prompt('Rename folder', {
      message: 'Everything inside it moves with it.',
      defaultValue: path,
      confirmLabel: 'Rename',
    });
    if (!next) return;
    const clean = normalizeFolder(next);
    if (!clean || clean === path) return;
    await renameFolder(fields, path, clean);
    await load();
  };

  if (!currentSpace) {
    return (
      <div className="content-pad">
        <p className="muted">Create or select a space first.</p>
      </div>
    );
  }

  const globalCount = fields.filter((f) => f.scope === 'global').length;

  return (
    <div className="content-pad" style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <h2>Sync fields</h2>
          <div className="muted text-xs">
            {currentSpace.name} · {globalCount} global, {fields.length - globalCount} project-local
          </div>
        </div>
        <div className="segmented">
          {(['global', 'local', 'all'] as ScopeFilter[]).map((s) => (
            <button
              key={s}
              className={scopeFilter === s ? 'active' : ''}
              onClick={() => setScopeFilter(s)}
            >
              {s === 'global' ? 'Global' : s === 'local' ? 'Project-local' : 'All'}
            </button>
          ))}
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => void createGlobal()}>
            <IconPlus size={15} /> New global field
          </button>
        )}
      </div>

      <p className="muted text-xs" style={{ marginBottom: 16, maxWidth: 660 }}>
        Global fields are shared by every project in the space — edit one here and every document
        that embeds it updates. Field values hold plain content: styling comes from the block that
        embeds them, while a table field keeps its own row and column structure.
      </p>

      {loadError && (
        <div className="auth-error" style={{ marginBottom: 12 }}>
          {loadError}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="gf-toolbar">
          <IconSearch size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or folder…"
            aria-label="Filter fields"
          />
          <span className="muted text-xs">
            {visible.length} of {fields.length}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : rows.length === 0 ? (
          <div className="fp-empty" style={{ padding: 24, textAlign: 'center' }}>
            {fields.length === 0
              ? 'No sync fields in this space yet.'
              : 'Nothing matches this filter.'}
          </div>
        ) : (
          <div className="gf-grid" role="table">
            {/* The header shares the row grid, so columns line up exactly.
                Indentation lives inside the name cell only — that is what
                keeps nested rows aligned with their siblings. */}
            <div className="gf-head" role="row">
              <span role="columnheader">Field</span>
              <span role="columnheader">Type</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Available in</span>
              <span role="columnheader" className="gf-col-actions">
                {canEdit ? 'Actions' : ''}
              </span>
            </div>

            {rows.map((row) =>
              row.kind === 'folder' ? (
                <div className="gf-frow" role="row" key={row.key}>
                  <span className="gf-cell-name">
                    <span className="gf-indent" style={{ width: row.depth * 16 }} />
                    <button
                      className="gf-folder-toggle"
                      onClick={() => toggle(row.node.path)}
                      aria-expanded={!row.collapsed}
                    >
                      {row.collapsed ? (
                        <IconChevronRight size={12} />
                      ) : (
                        <IconChevronDown size={12} />
                      )}
                      <span className="gf-folder-name">{row.node.name}</span>
                      <span className="fp-count">{row.node.totalCount}</span>
                    </button>
                  </span>
                  <span />
                  <span />
                  <span />
                  <span className="gf-col-actions">
                    {canEdit && (
                      <button
                        className="icon-btn"
                        title="Rename folder"
                        aria-label={`Rename folder ${row.node.name}`}
                        onClick={() => void renameFolderPath(row.node.path)}
                      >
                        <IconPencil size={11} />
                      </button>
                    )}
                  </span>
                </div>
              ) : (
                <div className="gf-drow" role="row" key={row.key}>
                  <span className="gf-cell-name">
                    <span className="gf-indent" style={{ width: row.depth * 16 }} />
                    <span className={`fp-dot ${row.field.scope === 'global' ? 'is-global' : ''}`} />
                    <span className="gf-name" title={row.field.name}>
                      {row.field.name}
                    </span>
                  </span>
                  <span className="gf-type">{fieldShapeLabel(row.field.value)}</span>
                  <span className="gf-value">
                    <FieldValuePreview value={row.field.value} />
                  </span>
                  <span className="gf-home">
                    {row.field.scope === 'global'
                      ? 'all projects'
                      : (titles.get(row.field.projectId ?? '') ?? 'project')}
                  </span>
                  <span className="gf-col-actions fp-actions gf-actions">
                    {canEdit && (
                      <>
                        <button
                          className="icon-btn"
                          title="Edit field in isolation"
                          aria-label={`Edit ${row.field.name}`}
                          onClick={() => setEditing(row.field)}
                        >
                          <IconPencil size={12} />
                        </button>
                        {row.field.scope === 'global' ? (
                          <button
                            className="icon-btn"
                            title="Move to folder"
                            aria-label={`Move ${row.field.name}`}
                            onClick={() => void move(row.field)}
                          >
                            <IconChevronRight size={12} />
                          </button>
                        ) : (
                          <button
                            className="icon-btn"
                            title="Make global"
                            aria-label={`Make ${row.field.name} global`}
                            onClick={() => void promote(row.field)}
                          >
                            <IconLink size={12} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title="Delete field"
                          aria-label={`Delete ${row.field.name}`}
                          onClick={() => void remove(row.field)}
                        >
                          <IconTrash size={12} />
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {editing && (
        <FieldEditorDialog
          field={editing}
          allFields={fields}
          projectId={editing.projectId}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
