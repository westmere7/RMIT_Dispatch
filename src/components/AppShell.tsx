import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useSpaces } from '../store/spaces';
import { IconBell, IconGrid, IconLink, IconLogout, IconSearch, IconUsers } from './Icons';
import { RoleBadge } from './RoleBadge';
import { SpaceSwitcher } from './SpaceSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { createContext, useContext, useState, type ReactNode } from 'react';

/* Pages can set the breadcrumb via this context. */
interface CrumbCtx {
  crumbs: ReactNode[];
  setCrumbs: (c: ReactNode[]) => void;
}
const Crumbs = createContext<CrumbCtx>({ crumbs: [], setCrumbs: () => {} });
export function useCrumbs() {
  return useContext(Crumbs);
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const { role } = useSpaces();
  const location = useLocation();
  const navigate = useNavigate();
  const [crumbs, setCrumbs] = useState<ReactNode[]>([]);
  const [search, setSearch] = useState('');

  const isWorkspace = location.pathname.startsWith('/docs/');

  return (
    <Crumbs.Provider value={{ crumbs, setCrumbs }}>
      <div className="app-frame">
        <div className="app-panel">
          <nav className="rail" aria-label="Main navigation">
            <Link to="/" className="rail-brand" title="RMIT Dispatch" aria-label="RMIT Dispatch home">
              R
            </Link>
            <button
              className={`rail-btn ${!isWorkspace && location.pathname !== '/space' && location.pathname !== '/fields' ? 'active' : ''}`}
              data-tip="Projects"
              aria-label="Projects"
              onClick={() => navigate('/')}
            >
              <IconGrid size={19} />
            </button>
            <button
              className={`rail-btn ${location.pathname === '/fields' ? 'active' : ''}`}
              data-tip="Sync fields"
              aria-label="Sync fields"
              onClick={() => navigate('/fields')}
            >
              <IconLink size={19} />
            </button>
            <button
              className={`rail-btn ${location.pathname === '/space' ? 'active' : ''}`}
              data-tip="Space settings"
              aria-label="Space settings"
              onClick={() => navigate('/space')}
            >
              <IconUsers size={19} />
            </button>
            <div className="rail-spacer" />
            <button
              className="rail-btn"
              data-tip="Sign out"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <IconLogout size={19} />
            </button>
          </nav>

          <div className="app-main">
            <header className="topbar">
              <div className="topbar-title">
                {crumbs.length > 0 ? (
                  crumbs.map((c, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {i > 0 && <span className="crumb-sep">/</span>}
                      {i < crumbs.length - 1 ? <span className="crumb">{c}</span> : c}
                    </span>
                  ))
                ) : (
                  <span>RMIT Dispatch</span>
                )}
              </div>
              <div className="topbar-search">
                <div className="search-wrap">
                  <IconSearch size={15} />
                  <input
                    type="search"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search"
                  />
                </div>
              </div>
              <div className="topbar-right">
                <ThemeToggle />
                <button className="icon-btn" aria-label="Notifications" title="Notifications">
                  <IconBell />
                </button>
                <SpaceSwitcher />
                {user && (
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    title={user.email}
                  >
                    <span className="avatar">{initials(user.displayName)}</span>
                    {role && <RoleBadge role={role} />}
                  </span>
                )}
              </div>
            </header>
            <main className="content">
              <Outlet context={{ search }} />
            </main>
          </div>
        </div>
      </div>
    </Crumbs.Provider>
  );
}
