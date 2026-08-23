import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCrumbs } from '../components/AppShell';
import { GridPreview } from '../components/GridPreview';
import { IconLock, IconPlus, IconSettings, IconTrash } from '../components/Icons';
import { NewAdaptationPanel } from '../components/NewAdaptationPanel';
import { ProjectPanel, type ProjectPanelValues } from '../components/ProjectPanel';
import { useDialog } from '../components/Dialog';
import { effectiveColumns } from '../grid/presets';
import { clampPos, rescalePages } from '../lib/blocks';
import { newId } from '../lib/ids';
import { cloneForAdaptation, collectUpstream, collectUsages, stripAllBindings, toFieldMap } from '../lib/syncfields';
import { useAuth } from '../store/auth';
import {
  createDocument,
  deleteDocument,
  fetchDocuments,
  updateDocumentMeta,
} from '../store/documents';
import { fetchDraft, saveDraft } from '../store/drafts';
import { fetchFields } from '../store/fields';
import { fetchProject, updateProjectMeta } from '../store/projects';
import { useSpaces } from '../store/spaces';
import type { DispatchDocument, GridConfig, Page, Project, SyncField } from '../types';

interface DocRow {
  doc: DispatchDocument;
  pages: Page[];
  usageCount: number;
  pendingCount: number;
}

type Filter = 'all' | 'master' | 'adaptation';

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { setCrumbs } = useCrumbs();
  const { canEdit } = useSpaces();
  const { user } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog();

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [fields, setFields] = useState<SyncField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [proj, docs, flds] = await Promise.all([
        fetchProject(projectId),
        fetchDocuments(projectId),
        fetchFields(projectId),
      ]);
      setProject(proj);
      setFields(flds);
      const fieldMap = toFieldMap(flds);
      const withDrafts = await Promise.all(
        docs.map(async (doc) => {
          const draft = await fetchDraft(doc.id);
          const pages = draft?.pages ?? [];
          const usages = collectUsages(pages);
          const pending = collectUpstream(pages, fieldMap);
          return {
            doc,
            pages,
            usageCount: usages.length,
            pendingCount: pending.fields.length + pending.blocks.length,
          };
        }),
      );
      setRows(withDrafts);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCrumbs([
      <Link key="p" to="/">
        Projects
      </Link>,
      project?.title ?? '…',
    ]);
  }, [setCrumbs, project]);

  const master = useMemo(() => rows.find((r) => r.doc.kind === 'master'), [rows]);
  const adaptations = useMemo(() => rows.filter((r) => r.doc.kind === 'adaptation'), [rows]);

  const createAdaptation = async (args: { title: string; grid: GridConfig }) => {
    if (!master || !user || !projectId) return;
    setBusy(true);
    try {
      // Deep-clone the master's pages; every block gets a `down` binding to
      // its master source, then clamp to the target grid.
      const cloned = cloneForAdaptation(master.pages, () => newId('blk'), () => newId('pg'));
      const clamped = cloned.map((page) => {
        const cols = effectiveColumns(args.grid, page.kind);
        return {
          ...page,
          blocks: page.blocks.map((b) => ({ ...b, pos: clampPos(b.pos, cols, args.grid.rows) })),
        };
      });
      const doc = await createDocument({
        projectId,
        kind: 'adaptation',
        parentId: master.doc.id,
        title: args.title,
        grid: args.grid,
        userId: user.uid,
        pages: clamped,
      });
      setShowNew(false);
      navigate(`/docs/${doc.id}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Save project settings. A refined grid rescales the master's blocks so
   * the layout keeps its proportions instead of bunching up top-left.
   */
  const saveSettings = async (values: ProjectPanelValues) => {
    if (!master || !user || !projectId) return;
    setBusy(true);
    try {
      await updateProjectMeta(projectId, { title: values.title, type: values.type });
      const oldGrid = master.doc.grid;
      const gridChanged = JSON.stringify(oldGrid) !== JSON.stringify(values.grid);
      if (gridChanged) {
        await updateDocumentMeta(master.doc.id, { title: values.title, grid: values.grid });
        const draft = await fetchDraft(master.doc.id);
        if (draft) {
          await saveDraft(master.doc.id, rescalePages(draft.pages, oldGrid, values.grid), user.uid);
        }
      } else if (values.title !== master.doc.title) {
        await updateDocumentMeta(master.doc.id, { title: values.title });
      }
      setShowSettings(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteMaster = async () => {
    if (!master || !user) return;
    const ok = await dialog.confirm(`Delete master “${master.doc.title}”?`, {
      message: `All ${adaptations.length} adaptation(s) will be unlinked and keep plain copies of their content. This cannot be undone.`,
      confirmLabel: 'Delete master',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      for (const a of adaptations) {
        const draft = await fetchDraft(a.doc.id);
        if (draft) await saveDraft(a.doc.id, stripAllBindings(draft.pages), user.uid);
        await updateDocumentMeta(a.doc.id, { parentId: null });
      }
      await deleteDocument(master.doc.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteAdaptation = async (row: DocRow) => {
    const ok = await dialog.confirm(`Delete adaptation “${row.doc.title}”?`, {
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteDocument(row.doc.id);
    await load();
  };

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="content-pad">
        <p className="muted">Project not found (or you don&apos;t have access).</p>
      </div>
    );
  }

  const Row = ({ row, isMaster }: { row: DocRow; isMaster: boolean }) => {
    const { doc } = row;
    const accent = doc.lock
      ? 'accent-attention'
      : isMaster
        ? 'accent-master'
        : row.pendingCount > 0
          ? 'accent-pending'
          : 'accent-synced';
    return (
      <div
        className={`card card-accent ${accent}`}
        style={{
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          cursor: 'pointer',
        }}
        onClick={() => navigate(`/docs/${doc.id}`)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && navigate(`/docs/${doc.id}`)}
      >
        <GridPreview grid={doc.grid} page={row.pages[0]} width={72} showGrid={false} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3>{doc.title}</h3>
            {isMaster && <span className="pill pill-accent">Master</span>}
          </div>
          <div className="muted text-xs" style={{ marginTop: 2 }}>
            {doc.grid.pageSize} {doc.grid.orientation} · {doc.grid.columns}×{doc.grid.rows} ·{' '}
            {row.pages.length} page{row.pages.length === 1 ? '' : 's'} · v{doc.versionCount}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isMaster ? (
            <span className="pill">{fields.length} sync fields</span>
          ) : (
            <>
              <span className="pill pill-success">{row.usageCount} synced</span>
              {row.pendingCount > 0 && (
                <span className="pill pill-warning">{row.pendingCount} pending ↑</span>
              )}
            </>
          )}
          {doc.lock && (
            <span className="pill pill-primary">
              <IconLock size={11} /> {doc.lock.displayName}
            </span>
          )}
          {canEdit && (
            <button
              className="icon-btn"
              aria-label={`Delete ${doc.title}`}
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                void (isMaster ? deleteMaster() : deleteAdaptation(row));
              }}
            >
              <IconTrash size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="content-pad" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h2>{project.title}</h2>
          <div className="muted text-xs">{project.type || 'Project'}</div>
        </div>
        <div className="segmented">
          {(['all', 'master', 'adaptation'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'master' ? 'Master' : 'Adaptations'}
            </button>
          ))}
        </div>
        {canEdit && master && (
          <>
            <button className="btn" onClick={() => setShowSettings(true)} disabled={busy}>
              <IconSettings size={15} /> Project settings
            </button>
            <button className="btn btn-primary" onClick={() => setShowNew(true)} disabled={busy}>
              <IconPlus size={15} /> New adaptation
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {master && filter !== 'adaptation' && <Row row={master} isMaster />}

        {filter !== 'master' && adaptations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingLeft: 'var(--space-6)', borderLeft: '1px solid var(--border)', marginLeft: 'var(--space-3)' }}>
            {adaptations.map((row) => (
              <Row key={row.doc.id} row={row} isMaster={false} />
            ))}
          </div>
        )}
        {filter !== 'master' && adaptations.length === 0 && (
          <p className="muted text-sm" style={{ paddingLeft: 'var(--space-6)' }}>
            No adaptations yet — derive a flyer, banner or guide page from the master.
          </p>
        )}
        {!master && <p className="muted">This project has no master document.</p>}
      </div>

      {showSettings && master && (
        <ProjectPanel
          mode="edit"
          initial={{ title: project.title, type: project.type, grid: master.doc.grid }}
          onSubmit={(v) => void saveSettings(v)}
          onClose={() => setShowSettings(false)}
          busy={busy}
        />
      )}

      {showNew && master && (
        <NewAdaptationPanel
          master={master.doc}
          onCreate={(a) => void createAdaptation(a)}
          onClose={() => setShowNew(false)}
          busy={busy}
        />
      )}
    </div>
  );
}
