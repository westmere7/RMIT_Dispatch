import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

/** Single shared client. Only touch through src/store/* repositories. */
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'anon-key-not-configured',
);

/** Public URL for an object in the `media` bucket. */
export function mediaUrl(storagePath: string): string {
  return supabase.storage.from('media').getPublicUrl(storagePath).data.publicUrl;
}
