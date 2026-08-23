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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
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
