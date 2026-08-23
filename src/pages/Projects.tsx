import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useCrumbs } from '../components/AppShell';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { useDialog } from '../components/Dialog';
import { GridPreview } from '../components/GridPreview';
import {
  IconChevronDown,
  IconChevronRight,
  IconDot,
  IconFile,
  IconLayers,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
} from '../components/Icons';
import { ProjectPanel } from '../components/ProjectPanel';
import { canvasAspect } from '../grid/presets';
import { normalizeFolder } from '../lib/fieldtree';
import { FLAGS, flagColor, flagLabel } from '../lib/flags';
import { isMissingColumn, PROJECT_MIGRATION_HINT } from '../lib/schemaerr';
import { useAuth } from '../store/auth';
import { fetchDocumentsForProjects } from '../store/documents';
import { fetchFirstPages } from '../store/drafts';
import {
  createProject,
  deleteProject,
  fetchProjects,
  renameProjectFolder,
  setProjectFlag,
  setProjectFolder,
  updateProjectMeta,
} from '../store/projects';
import { createSpace, useSpaces } from '../store/spaces';
import type { DispatchDocument, GridConfig, Page, Project, ProjectFlag } from '../types';

interface CardData {
  project: Project;
  master?: DispatchDocument;
  adaptationCount: number;
  firstPage?: Page;
  locked: boolean;
}

/** Thumbnail frame — fixed, so every card is the same height. */
const THUMB_W = 168;
const THUMB_H = 104;

interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
  cards: CardData[];
  total: number;
}

function buildTree(cards: CardData[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [], cards: [], total: 0 };
  const ensure = (path: string): FolderNode => {
    if (!path) return root;
    let node = root;
    let acc = '';
    for (const seg of path.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.children.find((c) => c.name === seg);
      if (!next) {
        next = { path: acc, name: seg, children: [], cards: [], total: 0 };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const c of cards) ensure(normalizeFolder(c.project.folder)).cards.push(c);
  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.cards.sort((a, b) => a.project.title.localeCompare(b.project.title));
    n.total = n.cards.length + n.children.reduce((s, c) => s + finish(c), 0);
    return n.total;
  };
  finish(root);
  return root;
}

export function Projects() {
  const { setCrumbs } = useCrumbs();
  const { user } = useAuth();
  const { currentSpace, canEdit, loading: spacesLoading, refresh, selectSpace } = useSpaces();
  const { search } = useOutletContext<{ search: string }>();
  const navigate = useNavigate();
  const dialog = useDialog();

  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; card: CardData } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [flagFilter, setFlagFilter] = useState<ProjectFlag | 'all'>('all');

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
      const pages = await fetchFirstPages(masters.map((m) => m.id));
      setCards(
        projects.map((project) => {
          const master = masters.find((m) => m.projectId === project.id);
          const mine = docs.filter((d) => d.projectId === project.id);
          return {
            project,
            master,
            adaptationCount: mine.filter((d) => d.kind === 'adaptation').length,
            firstPage: master ? pages.get(master.id) : undefined,
            locked: mine.some((d) => d.lock),
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
    return cards
      .filter((c) => (flagFilter === 'all' ? true : c.project.flag === flagFilter))
      .filter(
        (c) =>
          !q ||
          c.project.title.toLowerCase().includes(q) ||
          c.project.type.toLowerCase().includes(q) ||
          c.project.folder.toLowerCase().includes(q),
      );
  }, [cards, search, flagFilter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const allFolders = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) {
      const segs = normalizeFolder(c.project.folder).split('/').filter(Boolean);
      let acc = '';
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s;
        set.add(acc);
      }
    }
    return [...set].sort();
  }, [cards]);

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

  /* ---------- Mutations ---------- */

  /** Names the migration when the database is behind the app. */
  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      if (isMissingColumn(err)) await dialog.alert('Migration needed', { message: PROJECT_MIGRATION_HINT });
      else throw err;
    }
  };

  const move = async (project: Project, folder: string) => {
    const clean = normalizeFolder(folder);
    if (clean === project.folder) return;
    await guard(async () => {
      await setProjectFolder(project.id, clean);
      setCards((prev) =>
        prev.map((c) =>
          c.project.id === project.id ? { ...c, project: { ...c.project, folder: clean } } : c,
        ),
      );
    });
  };

  const flag = async (project: Project, next: ProjectFlag | null) => {
    await guard(async () => {
      await setProjectFlag(project.id, next);
      setCards((prev) =>
        prev.map((c) =>
          c.project.id === project.id ? { ...c, project: { ...c.project, flag: next } } : c,
        ),
      );
    });
  };

  const rename = async (project: Project) => {
    const title = await dialog.prompt('Rename project', {
      defaultValue: project.title,
      confirmLabel: 'Rename',
    });
    if (!title?.trim()) return;
    await updateProjectMeta(project.id, { title: title.trim() });
    await load();
  };

  const remove = async (card: CardData) => {
    const ok = await dialog.confirm(`Delete “${card.project.title}”?`, {
      message: `Its master and ${card.adaptationCount} adaptation(s) are deleted with it. This cannot be undone.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    await deleteProject(card.project.id);
    setCards((prev) => prev.filter((c) => c.project.id !== card.project.id));
  };

  const newFolderFor = async (project: Project) => {
    const folder = await dialog.prompt('Move to a new folder', {
      message: 'Use a slash to nest, e.g. Campaigns/2026.',
      defaultValue: project.folder,
      confirmLabel: 'Move',
    });
    if (folder === null) return;
    await move(project, folder);
  };

  const renameFolder = async (path: string) => {
    const next = await dialog.prompt('Rename folder', {
      message: 'Everything inside it moves with it.',
      defaultValue: path,
      confirmLabel: 'Rename',
    });
    const clean = normalizeFolder(next ?? '');
    if (!clean || clean === path) return;
    await renameProjectFolder(
      cards.map((c) => c.project),
      path,
      clean,
    );
    await load();
  };

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  /* ---------- No space yet ---------- */
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

  /* ---------- One card ---------- */
  const Card = ({ card }: { card: CardData }) => {
    const { project, master, adaptationCount, firstPage, locked } = card;
    const color = flagColor(project.flag);
    const thumbW = master
      ? Math.min(THUMB_W, THUMB_H * canvasAspect(master.grid, 'single'))
      : THUMB_W;

    return (
      <div
        className={`pj-card ${dragId === project.id ? 'dragging' : ''}`}
        style={color ? ({ ['--pj-flag' as string]: color } as React.CSSProperties) : undefined}
        role="button"
        tabIndex={0}
        draggable={canEdit}
        onDragStart={(e) => {
          setDragId(project.id);
          e.dataTransfer.setData('text/plain', project.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTarget(null);
        }}
        onClick={() => navigate(`/projects/${project.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${project.id}`)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, card });
        }}
      >
        <div className="pj-thumb">
          {master ? (
            <GridPreview grid={master.grid} page={firstPage} width={thumbW} showGrid={false} />
          ) : (
            <span className="muted text-xs">No master</span>
          )}
        </div>

        <div className="pj-body">
          <div className="pj-title-row">
            {color && <span className="pj-flag-dot" title={flagLabel(project.flag) ?? undefined} />}
            <span className="pj-title">{project.title}</span>
          </div>
          <div className="pj-meta">
            {project.type || 'Project'}
            {master && ` · ${master.grid.pageSize} ${master.grid.orientation}`}
          </div>
          <div className="pj-tags">
            <span className="pill">
              <IconLayers size={11} /> {adaptationCount}
            </span>
            <span className="pill">
              <IconFile size={11} /> v{master?.versionCount ?? 0}
            </span>
            {locked && (
              <span className="pill pill-primary">
                <IconLock size={11} /> locked
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ---------- Folder + cards, recursive ---------- */
  const Folder = ({ node, depth }: { node: FolderNode; depth: number }) => {
    const isCollapsed = collapsed.has(node.path) && !search;
    const isDropping = dropTarget === node.path;
    return (
      <section
        className={`pj-folder ${isDropping ? 'dropping' : ''}`}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(node.path);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          setDropTarget((t) => (t === node.path ? null : t));
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData('text/plain') || dragId;
          const p = cards.find((c) => c.project.id === id)?.project;
          setDropTarget(null);
          setDragId(null);
          if (p) void move(p, node.path);
        }}
      >
        <header className="pj-folder-head" style={{ paddingLeft: depth * 14 }}>
          <button className="pj-folder-toggle" onClick={() => toggle(node.path)}>
            {isCollapsed ? <IconChevronRight size={13} /> : <IconChevronDown size={13} />}
            <span className="pj-folder-name">{node.name || 'Ungrouped'}</span>
            <span className="fp-count">{node.total}</span>
          </button>
          {canEdit && node.path && (
            <button
              className="icon-btn"
              title="Rename folder"
              aria-label={`Rename folder ${node.name}`}
              onClick={() => void renameFolder(node.path)}
            >
              <IconPencil size={12} />
            </button>
          )}
          {isDropping && <span className="pj-drop-hint">Drop to move here</span>}
        </header>

        {!isCollapsed && (
          <>
            {node.cards.length > 0 && (
              <div className="pj-grid" style={{ marginLeft: depth * 14 }}>
                {node.cards.map((c) => (
                  <Card key={c.project.id} card={c} />
                ))}
              </div>
            )}
            {node.children.map((child) => (
              <Folder key={child.path} node={child} depth={depth + 1} />
            ))}
          </>
        )}
      </section>
    );
  };

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const { card } = menu;
    const p = card.project;
    const items: MenuItem[] = [
      { kind: 'header', label: p.title, sub: p.folder || 'Ungrouped' },
      { kind: 'item', label: 'Open', onSelect: () => navigate(`/projects/${p.id}`) },
    ];
    if (!canEdit) return items;
    items.push(
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Flag',
        icon: <IconDot size={13} />,
        items: [
          ...FLAGS.map<MenuItem>((f) => ({
            kind: 'check',
            label: f.label,
            swatch: f.color,
            checked: p.flag === f.flag,
            onSelect: () => void flag(p, f.flag),
          })),
          { kind: 'separator' },
          { kind: 'item', label: 'Clear flag', onSelect: () => void flag(p, null) },
        ],
      },
      {
        kind: 'submenu',
        label: 'Move to folder',
        items: [
          {
            kind: 'check',
            label: 'Ungrouped (root)',
            checked: p.folder === '',
            onSelect: () => void move(p, ''),
          },
          ...allFolders.map<MenuItem>((f) => ({
            kind: 'check',
            label: f,
            checked: p.folder === f,
            onSelect: () => void move(p, f),
          })),
          { kind: 'separator' },
          { kind: 'item', label: '＋ New folder…', onSelect: () => void newFolderFor(p) },
        ],
      },
      { kind: 'separator' },
      { kind: 'item', label: 'Rename…', icon: <IconPencil size={13} />, onSelect: () => void rename(p) },
      {
        kind: 'item',
        label: 'Delete project',
        danger: true,
        icon: <IconTrash size={13} />,
        onSelect: () => void remove(card),
      },
    );
    return items;
  };

  return (
    <div className="content-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{currentSpace?.name}</h2>
          <div className="muted text-xs">
            {filtered.length} of {cards.length} project{cards.length === 1 ? '' : 's'}
            {allFolders.length > 0 && ` · ${allFolders.length} folder${allFolders.length === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className="pj-flag-filter">
          <button
            className={`pj-flag-chip all ${flagFilter === 'all' ? 'active' : ''}`}
            onClick={() => setFlagFilter('all')}
            title="All flags"
          >
            All
          </button>
          {FLAGS.map((f) => (
            <button
              key={f.flag}
              className={`pj-flag-chip ${flagFilter === f.flag ? 'active' : ''}`}
              style={{ ['--pj-flag' as string]: f.color } as React.CSSProperties}
              onClick={() => setFlagFilter((cur) => (cur === f.flag ? 'all' : f.flag))}
              title={`${f.label} — ${cards.filter((c) => c.project.flag === f.flag).length}`}
              aria-label={f.label}
            />
          ))}
        </div>

        {canEdit && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <IconPlus size={15} /> New project
          </button>
        )}
      </div>

      {canEdit && cards.length > 0 && (
        <p className="muted text-xs" style={{ marginBottom: 14 }}>
          Drag a card onto a folder to move it. Right-click for flags, folders and renaming.
        </p>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div className="spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
          <p className="muted">
            {cards.length === 0
              ? 'No projects yet. Create one to start writing the master copy.'
              : 'Nothing matches this filter.'}
          </p>
        </div>
      ) : (
        <div className="pj-board">
          {/* Root cards first, then each folder. */}
          {tree.cards.length > 0 && (
            <section
              className={`pj-folder ${dropTarget === '' ? 'dropping' : ''}`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropTarget('');
              }}
              onDragLeave={() => setDropTarget((t) => (t === '' ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragId;
                const p = cards.find((c) => c.project.id === id)?.project;
                setDropTarget(null);
                setDragId(null);
                if (p) void move(p, '');
              }}
            >
              <header className="pj-folder-head">
                <span className="pj-folder-name muted">Ungrouped</span>
                <span className="fp-count">{tree.cards.length}</span>
                {dropTarget === '' && <span className="pj-drop-hint">Drop to move here</span>}
              </header>
              <div className="pj-grid">
                {tree.cards.map((c) => (
                  <Card key={c.project.id} card={c} />
                ))}
              </div>
            </section>
          )}
          {tree.children.map((child) => (
            <Folder key={child.path} node={child} depth={0} />
          ))}
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}

      {showNew && (
        <ProjectPanel
          onSubmit={(a) => void handleCreate(a)}
          onClose={() => setShowNew(false)}
          busy={busy}
        />
      )}
    </div>
  );
}
