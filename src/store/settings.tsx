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

interface SettingsCtx {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => void;
  reset: () => void;
  loading: boolean;
  saving: boolean;
}

const Ctx = createContext<SettingsCtx>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
  loading: false,
  saving: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(readLocal);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | null>(null);

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
          setSettings(clampSettings({ ...DEFAULT_SETTINGS, ...data.settings }));
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Mirror locally at once, and upsert to the account debounced.
  const persist = useCallback(
    (next: UserSettings) => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      if (!user) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setSaving(true);
        void supabase
          .from('user_settings')
          .upsert({ user_id: user.uid, settings: next }, { onConflict: 'user_id' })
          .then(({ error }) => {
            if (error) console.warn('settings save failed', error.message);
            setSaving(false);
          });
      }, 400);
    },
    [user],
  );

  const update = useCallback(
    (patch: Partial<UserSettings>) => {
      setSettings((prev) => {
        const next = clampSettings({ ...prev, ...patch });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    persist(DEFAULT_SETTINGS);
  }, [persist]);

  // Apply the settings that affect the whole shell.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(settings.uiScale / 100));
    root.setAttribute('data-reduce-motion', settings.reduceMotion ? 'true' : 'false');
  }, [settings.uiScale, settings.reduceMotion]);

  const value = useMemo(
    () => ({ settings, update, reset, loading, saving }),
    [settings, update, reset, loading, saving],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  return useContext(Ctx);
}
