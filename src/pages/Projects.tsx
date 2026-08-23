import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useCrumbs } from '../components/AppShell';
import { GridPreview } from '../components/GridPreview';
import { IconPlus } from '../components/Icons';
import { NewProjectPanel } from '../components/NewProjectPanel';
import { useAuth } from '../store/auth';
import { fetchDocumentsForProjects } from '../store/documents';
import { fetchFirstPages } from '../store/drafts';
import { createProject, fetchProjects } from '../store/projects';
import { createSpace, useSpaces } from '../store/spaces';
import type { DispatchDocument, GridConfig, Page, Project } from '../types';

interface CardData {
  project: Project;
  master?: DispatchDocument;
  adaptationCount: number;
  firstPage?: Page;
}

export function Projects() {
  const { setCrumbs } = useCrumbs();
  const { user } = useAuth();
  const { currentSpace, canEdit, loading: spacesLoading, refresh, selectSpace } = useSpaces();
  const { search } = useOutletContext<{ search: string }>();
  const navigate = useNavigate();

  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');

  useEffect(() => setCrumbs(['Projects']), [setCrumbs]);

  const load = useCallback(async () => {
    if (!currentSpace) {
      setCards([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const projects = await fetchProjects(currentSpace.id);
      if (projects.length === 0) {
        setCards([]);
        return;
      }
      const docs = await fetchDocumentsForProjects(projects.map((p) => p.id));
      const masters = docs.filter((d) => d.kind === 'master');
      const pagesByDoc: Map<string, Page | undefined> = await fetchFirstPages(masters.map((m) => m.id));
      setCards(
        projects.map((project) => {
          const master = masters.find((m) => m.projectId === project.id);
          return {
            project,
            master,
            adaptationCount: docs.filter((d) => d.projectId === project.id && d.kind === 'adaptation').length,
            firstPage: master ? pagesByDoc.get(master.id) : undefined,
          };
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [currentSpace]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) => c.project.title.toLowerCase().includes(q) || c.project.type.toLowerCase().includes(q),
    );
  }, [cards, search]);

  const handleCreate = async (args: { title: string; type: string; grid: GridConfig }) => {
    if (!user || !currentSpace) return;
    setBusy(true);
    try {
      const project = await createProject({
        spaceId: currentSpace.id,
        title: args.title,
        type: args.type,
        grid: args.grid,
        userId: user.uid,
      });
      setShowNew(false);
      navigate(`/projects/${project.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (!spacesLoading && !currentSpace) {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 420, padding: 'var(--space-6)' }}>
          <h2 style={{ marginBottom: 8 }}>Create your first space</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Spaces are teams — projects, members and roles live inside them.
          </p>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!user || !newSpaceName.trim()) return;
              const s = await createSpace(newSpaceName.trim(), user.uid);
              await refresh();
              selectSpace(s.id);
            }}
          >
            <input
              className="input"
              placeholder="Marketing team"
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
            />
            <button className="btn btn-primary" type="submit">
              Create
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="content-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ flex: 1 }}>
          {currentSpace?.name} <span className="muted text-sm">· {filtered.length} projects</span>
        </h2>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <IconPlus size={15} /> New project
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div className="spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
          <p className="muted">
            {cards.length === 0
              ? 'No projects yet. Create one to start writing the master copy.'
              : 'No projects match your search.'}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {filtered.map(({ project, master, adaptationCount, firstPage }) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="card card-accent accent-master"
              style={{
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                color: 'inherit',
              }}
            >
              {master && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <GridPreview grid={master.grid} page={firstPage} width={150} showGrid={false} />
                </div>
              )}
              <div>
                <h3>{project.title}</h3>
                <div className="muted text-xs" style={{ marginTop: 2 }}>
                  {project.type || 'Project'}
                  {master && ` · ${master.grid.pageSize} ${master.grid.orientation}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="pill pill-accent">Master</span>
                <span className="pill">{adaptationCount} adaptations</span>
                {master?.lock && <span className="pill pill-primary">Locked</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <NewProjectPanel onCreate={(a) => void handleCreate(a)} onClose={() => setShowNew(false)} busy={busy} />
      )}
    </div>
  );
}
