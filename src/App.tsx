import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { isConfigured } from './lib/supabase';
import { GlobalFields } from './pages/GlobalFields';
import { Login } from './pages/Login';
import { NotConfigured } from './pages/NotConfigured';
import { NotFound } from './pages/NotFound';
import { Projects } from './pages/Projects';
import { ProjectView } from './pages/ProjectView';
import { SpaceSettings } from './pages/SpaceSettings';
import { Workspace } from './pages/Workspace';
import { useAuth } from './store/auth';

export default function App() {
  const { user, loading } = useAuth();

  if (!isConfigured) return <NotConfigured />;

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
      <Route element={<AppShell />}>
        <Route path="/" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectView />} />
        <Route path="/docs/:documentId" element={<Workspace />} />
        <Route path="/fields" element={<GlobalFields />} />
        <Route path="/space" element={<SpaceSettings />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
