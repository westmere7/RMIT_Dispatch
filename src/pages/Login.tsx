import { useState, type FormEvent } from 'react';
import { useAuth } from '../store/auth';
import { ThemeToggle } from '../components/ThemeToggle';

export function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const err = await signIn(email, password);
        if (err) setError(err);
      } else {
        const err = await signUp(email, password, displayName.trim() || email.split('@')[0]);
        if (err) setError(err);
        else setNotice('Account created. If email confirmation is enabled, check your inbox — otherwise you are signed in.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'var(--rmit-red)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            R
          </div>
          <div>
            <h1 style={{ lineHeight: 1.2 }}>RMIT Dispatch</h1>
            <div className="muted text-xs">Single source of truth for marketing copy</div>
          </div>
        </div>

        <div className="segmented" role="tablist" style={{ alignSelf: 'flex-start' }}>
          <button
            type="button"
            className={mode === 'signin' ? 'active' : ''}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>

        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Bailey Aurora"
              autoComplete="name"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </div>

        {error && <div className="auth-error">{error}</div>}
        {notice && (
          <div className="pill-success pill" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>
            {notice}
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
