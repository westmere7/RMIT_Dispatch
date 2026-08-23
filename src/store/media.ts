import { uuid } from '../lib/ids';
import { supabase } from '../lib/supabase';

/** Upload an image to the `media` bucket; returns the storage path. */
export async function uploadMedia(spaceId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const path = `${spaceId}/${uuid()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  return path;
}
