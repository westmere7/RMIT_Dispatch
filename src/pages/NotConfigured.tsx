export function NotConfigured() {
  return (
    <div className="center-screen">
      <div className="card" style={{ maxWidth: 520, padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--rmit-red)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            R
          </div>
          <h1>RMIT Dispatch</h1>
        </div>
        <p style={{ marginBottom: 12 }}>
          Supabase isn&apos;t configured yet, so the app can&apos;t start.
        </p>
        <ol style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            Create a free project at <a href="https://supabase.com">supabase.com</a>
          </li>
          <li>
            Run <code>supabase/schema.sql</code> in the SQL editor
          </li>
          <li>
            Create <code>.env.local</code> in the project root:
          </li>
        </ol>
        <pre
          style={{
            background: 'var(--surface-2)',
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-xs)',
            overflow: 'auto',
          }}
        >
          {`VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_ANON_KEY=your-anon-key`}
        </pre>
        <p className="muted text-xs" style={{ marginTop: 12 }}>
          Then restart the dev server. Full steps are in the README.
        </p>
      </div>
    </div>
  );
}
