import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import type { Role, Space, SpaceMember } from '../types';
import { useAuth } from './auth';

/* ---------- Repository ---------- */

export async function fetchMySpaces(userId: string): Promise<{ space: Space; role: Role }[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('role, spaces ( id, name, created_by, created_at )')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.spaces)
    .map((r) => {
      const s = r.spaces as unknown as {
        id: string;
        name: string;
        created_by: string;
        created_at: string;
      };
      return {
        role: r.role as Role,
        space: { id: s.id, name: s.name, createdBy: s.created_by, createdAt: s.created_at },
      };
    });
}

export async function createSpace(name: string, userId: string): Promise<Space> {
  const { data, error } = await supabase
    .from('spaces')
    .insert({ name, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  const { error: mErr } = await supabase
    .from('space_members')
    .insert({ space_id: data.id, user_id: userId, role: 'admin' });
  if (mErr) throw mErr;
  return { id: data.id, name: data.name, createdBy: data.created_by, createdAt: data.created_at };
}

export async function fetchMembers(spaceId: string): Promise<SpaceMember[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('space_id, user_id, role, profiles ( email, display_name )')
    .eq('space_id', spaceId);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const p = r.profiles as unknown as { email: string; display_name: string } | null;
    return {
      spaceId: r.space_id,
      userId: r.user_id,
      role: r.role as Role,
      email: p?.email ?? '',
      displayName: p?.display_name ?? '',
    };
  });
}

/** Invite by email: looks the user up in profiles. */
export async function addMember(spaceId: string, email: string, role: Role): Promise<string | null> {
  const { data: prof, error } = await supabase
    .from('profiles')
    .select('uid')
    .ilike('email', email.trim())
    .maybeSingle();
  if (error) return error.message;
  if (!prof) return 'No user with that email has signed up yet.';
  const { error: insErr } = await supabase
    .from('space_members')
    .insert({ space_id: spaceId, user_id: prof.uid, role });
  if (insErr) {
    return insErr.code === '23505' ? 'Already a member of this space.' : insErr.message;
  }
  return null;
}

export async function updateMemberRole(spaceId: string, userId: string, role: Role) {
  const { error } = await supabase
    .from('space_members')
    .update({ role })
    .eq('space_id', spaceId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function removeMember(spaceId: string, userId: string) {
  const { error } = await supabase
    .from('space_members')
    .delete()
    .eq('space_id', spaceId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function renameSpace(spaceId: string, name: string) {
  const { error } = await supabase.from('spaces').update({ name }).eq('id', spaceId);
  if (error) throw error;
}

/* ---------- Context: current space ---------- */

interface SpacesCtx {
  spaces: { space: Space; role: Role }[];
  loading: boolean;
  currentSpace: Space | null;
  role: Role | null;
  canEdit: boolean;
  isAdmin: boolean;
  selectSpace: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SpacesCtx>({
  spaces: [],
  loading: true,
  currentSpace: null,
  role: null,
  canEdit: false,
  isAdmin: false,
  selectSpace: () => {},
  refresh: async () => {},
});

const LS_KEY = 'rmit-dispatch-space';

export function SpacesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [spaces, setSpaces] = useState<{ space: Space; role: Role }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });

  const refresh = useCallback(async () => {
    if (!user) {
      setSpaces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchMySpaces(user.uid);
      setSpaces(list);
    } catch {
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = useMemo(() => {
    if (spaces.length === 0) return null;
    return spaces.find((s) => s.space.id === currentId) ?? spaces[0];
  }, [spaces, currentId]);

  const selectSpace = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value: SpacesCtx = {
    spaces,
    loading,
    currentSpace: current?.space ?? null,
    role: current?.role ?? null,
    canEdit: current?.role === 'admin' || current?.role === 'editor',
    isAdmin: current?.role === 'admin',
    selectSpace,
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSpaces() {
  return useContext(Ctx);
}
