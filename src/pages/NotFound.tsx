import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="center-screen" style={{ flexDirection: 'column', gap: 12 }}>
      <h1>Page not found</h1>
      <p className="muted">That page doesn&apos;t exist in this space.</p>
      <Link className="btn" to="/">
        Back to projects
      </Link>
    </div>
  );
}
