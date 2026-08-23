import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { isConfigured, supabase } from '../lib/supabase';
import type { AppUser } from '../types';

interface AuthCtx {
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  signIn: async () => 'not configured',
  signUp: async () => 'not configured',
  signOut: async () => {},
});

/* Special local test account: "admin" / "admin". Supabase requires an
   email-shaped login and a 6+ char password, so the pair maps to fixed
   internal credentials and is auto-provisioned on first sign-in. It
   behaves like any other account everywhere else. */
const TEST_ACCOUNT = {
  email: 'admin@rmit-dispatch.local',
  password: 'admin!rmit-dispatch',
  displayName: 'Admin',
};

function resolveCredentials(email: string, password: string) {
  const isTest = email.trim().toLowerCase() === 'admin' && password === 'admin';
  return isTest
    ? { email: TEST_ACCOUNT.email, password: TEST_ACCOUNT.password, isTest: true }
    : { email, password, isTest: false };
}

async function toAppUser(uid: string, email: string): Promise<AppUser> {
  const { data } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('uid', uid)
    .maybeSingle();
  return { uid, email, displayName: data?.display_name || email.split('@')[0] };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(isConfigured);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (s?.user && !cancelled) {
        setUser(await toAppUser(s.user.id, s.user.email ?? ''));
      }
      if (!cancelled) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) {
        setUser(null);
        return;
      }
      const u = session.user;
      // Fetch profile asynchronously; fall back to email prefix meanwhile.
      setUser((prev) =>
        prev?.uid === u.id
          ? prev
          : { uid: u.id, email: u.email ?? '', displayName: (u.email ?? '').split('@')[0] },
      );
      void toAppUser(u.id, u.email ?? '').then((au) => {
        if (!cancelled) setUser((prev) => (prev?.uid === au.uid ? au : prev));
      });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const creds = resolveCredentials(email, password);
    const { error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (!error) return null;
    // First use of the admin/admin test account: provision it, then retry.
    if (creds.isTest) {
      const { error: upErr } = await supabase.auth.signUp({
        email: creds.email,
        password: creds.password,
        options: { data: { display_name: TEST_ACCOUNT.displayName } },
      });
      if (upErr) return upErr.message;
      const { error: retryErr } = await supabase.auth.signInWithPassword({
        email: creds.email,
        password: creds.password,
      });
      return retryErr ? retryErr.message : null;
    }
    return error.message;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const creds = resolveCredentials(email, password);
    const { error } = await supabase.auth.signUp({
      email: creds.email,
      password: creds.password,
      options: {
        data: { display_name: creds.isTest ? TEST_ACCOUNT.displayName : displayName },
      },
    });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signIn, signUp, signOut }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
