import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { isConfigured } from './lib/supabase';
import { GlobalFields } from './pages/GlobalFields';
import { Login } from './pages/Login';
import { NotConfigured } from './pages/NotConfigured';
import { NotFound } from './pages/NotFound';
import { PreviewPage } from './pages/PreviewPage';
import { Projects } from './pages/Projects';
import { ProjectView } from './pages/ProjectView';
import { Settings } from './pages/Settings';
import { SpaceSettings } from './pages/SpaceSettings';
import { Workspace } from './pages/Workspace';
import { useAuth } from './store/auth';

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (!isConfigured) return <NotConfigured />;

  // Allow public access to preview/share routes without requiring login
  if (location.pathname.startsWith('/preview/') || location.pathname.startsWith('/share/')) {
    return (
      <Routes>
        <Route path="/preview/:token" element={<PreviewPage />} />
        <Route path="/share/:token" element={<PreviewPage />} />
      </Routes>
    );
  }

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/preview/:token" element={<PreviewPage />} />
      <Route path="/share/:token" element={<PreviewPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectView />} />
        <Route path="/docs/:documentId" element={<Workspace />} />
        <Route path="/fields" element={<GlobalFields />} />
        <Route path="/space" element={<SpaceSettings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
