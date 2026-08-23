import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_COMPRESSION, type CompressionLevel } from '../lib/imagecompress';
import { supabase } from '../lib/supabase';
import type { Orientation, PageSize } from '../types';
import { useAuth } from './auth';

/* ============================================================
   Account settings. Stored per user in Postgres so they follow
   the person between machines, with a local mirror so the first
   paint never waits on the network.
   ============================================================ */

export type ThemeMode = 'system' | 'light' | 'dark';

export interface UserSettings {
  /* Appearance */
  theme: ThemeMode;
  /** Interface zoom, percent. */
  uiScale: number;
  reduceMotion: boolean;

  /* Editing */
  /** How many undo steps to keep per document. */
  undoSteps: number;
  /** Draft autosave debounce, ms. */
  autosaveMs: number;
  confirmDeletes: boolean;
  showGridLines: boolean;
  /** Arrow-key nudge distance, in cells. */
  nudgeCells: number;

  /* Media */
  imageCompression: CompressionLevel;

  /* Sync fields */
  defaultFieldScope: 'local' | 'global';

  /* New documents */
  defaultPageSize: PageSize;
  defaultOrientation: Orientation;
  defaultColumns: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  uiScale: 100,
  reduceMotion: false,
  undoSteps: 50,
  autosaveMs: 600,
  confirmDeletes: true,
  showGridLines: true,
  nudgeCells: 1,
  imageCompression: DEFAULT_COMPRESSION,
  defaultFieldScope: 'local',
  defaultPageSize: 'A4',
  defaultOrientation: 'portrait',
  defaultColumns: 12,
};

export const LIMITS = {
  undoSteps: { min: 10, max: 200 },
  uiScale: { min: 80, max: 140 },
  autosaveMs: { min: 300, max: 3000 },
  nudgeCells: { min: 1, max: 5 },
};

const LS_KEY = 'rmit-dispatch-settings';

function clampSettings(s: UserSettings): UserSettings {
  const cl = (v: number, k: keyof typeof LIMITS) =>
    Math.max(LIMITS[k].min, Math.min(LIMITS[k].max, Math.round(v)));
  return {
    ...s,
    undoSteps: cl(s.undoSteps, 'undoSteps'),
    uiScale: cl(s.uiScale, 'uiScale'),
    autosaveMs: cl(s.autosaveMs, 'autosaveMs'),
    nudgeCells: cl(s.nudgeCells, 'nudgeCells'),
  };
}

function readLocal(): UserSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return clampSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

function sameSettings(a: UserSettings, b: UserSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[]).every((k) => a[k] === b[k]);
}

interface SettingsCtx {
  /** What the app runs on: the draft, so edits preview live. */
  settings: UserSettings;
  /** What is actually stored, for Discard and the dirty check. */
  saved: UserSettings;
  /** Edit the draft. Nothing is written until `save()`. */
  update: (patch: Partial<UserSettings>) => void;
  /** Draft differs from what is stored. */
  dirty: boolean;
  /**
   * Commit the draft. An override commits a value straight away without
   * going through the draft first — used by one-click controls like the
   * top-bar theme toggle, which have no Save button of their own.
   */
  save: (override?: Partial<UserSettings>) => Promise<void>;
  /** Throw the draft away and go back to the stored values. */
  discard: () => void;
  /** Load the defaults into the draft (still needs saving). */
  reset: () => void;
  loading: boolean;
  saving: boolean;
}

const Ctx = createContext<SettingsCtx>({
  settings: DEFAULT_SETTINGS,
  saved: DEFAULT_SETTINGS,
  update: () => {},
  dirty: false,
  save: async () => {},
  discard: () => {},
  reset: () => {},
  loading: false,
  saving: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  /**
   * Two copies: `saved` is what is stored, `draft` is what the app runs
   * on. Editing only touches the draft, so appearance changes preview
   * immediately while Save/Discard still mean something.
   */
  const [saved, setSaved] = useState<UserSettings>(readLocal);
  const [draft, setDraft] = useState<UserSettings>(saved);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Pull the account's settings once signed in; the local mirror has
  // already painted, so this only reconciles.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('settings')
        .eq('user_id', user.uid)
        .maybeSingle();
      if (!cancelled) {
        if (!error && data?.settings) {
          const next = clampSettings({ ...DEFAULT_SETTINGS, ...data.settings });
          setSaved(next);
          // Don't stomp on edits the user started before this landed.
          if (sameSettings(draftRef.current, readLocal())) setDraft(next);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const update = useCallback((patch: Partial<UserSettings>) => {
    setDraft((prev) => clampSettings({ ...prev, ...patch }));
  }, []);

  /** Commit the draft: local mirror first, then the account. */
  const save = useCallback(
    async (override?: Partial<UserSettings>) => {
    const next = override ? clampSettings({ ...draftRef.current, ...override }) : draftRef.current;
    if (override) setDraft(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setSaved(next);
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.uid, settings: next }, { onConflict: 'user_id' });
    if (error) console.warn('settings save failed', error.message);
    setSaving(false);
    },
    [user],
  );

  const discard = useCallback(() => setDraft(saved), [saved]);
  const reset = useCallback(() => setDraft(DEFAULT_SETTINGS), []);

  // Apply the settings that affect the whole shell — from the draft, so
  // scale and motion preview before they are saved.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(draft.uiScale / 100));
    root.setAttribute('data-reduce-motion', draft.reduceMotion ? 'true' : 'false');
  }, [draft.uiScale, draft.reduceMotion]);

  const dirty = !sameSettings(draft, saved);

  const value = useMemo(
    () => ({
      settings: draft,
      saved,
      update,
      dirty,
      save,
      discard,
      reset,
      loading,
      saving,
    }),
    [draft, saved, update, dirty, save, discard, reset, loading, saving],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  return useContext(Ctx);
}
