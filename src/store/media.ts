import {
  compressImage,
  DEFAULT_COMPRESSION,
  type CompressionLevel,
  type CompressedImage,
} from '../lib/imagecompress';
import { uuid } from '../lib/ids';
import { supabase } from '../lib/supabase';

export interface UploadResult extends Omit<CompressedImage, 'blob'> {
  storagePath: string;
}

/**
 * Compress to WebP, then upload to the `media` bucket. Returns the
 * storage path plus the size figures so the UI can show what was saved.
 */
export async function uploadMedia(
  spaceId: string,
  file: File,
  level: CompressionLevel = DEFAULT_COMPRESSION,
): Promise<UploadResult> {
  const out = await compressImage(file, level);
  const path = `${spaceId}/${uuid()}.${out.ext}`;
  const { error } = await supabase.storage.from('media').upload(path, out.blob, {
    cacheControl: '3600',
    upsert: false,
    contentType: out.ext === 'webp' ? 'image/webp' : file.type || undefined,
  });
  if (error) throw error;
  return {
    storagePath: path,
    ext: out.ext,
    width: out.width,
    height: out.height,
    originalBytes: out.originalBytes,
    bytes: out.bytes,
  };
}

/**
 * Remove an object from storage. Called when the thing that owned it is
 * deleted or replaced, so the bucket does not accumulate orphans.
 * Failures are swallowed: a missing object is the desired end state, and
 * a storage hiccup must not block the user's edit.
 */
export async function deleteMedia(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  const { error } = await supabase.storage.from('media').remove([storagePath]);
  if (error) console.warn('media delete failed', storagePath, error.message);
}

/** Remove several objects at once (deleting a document or a group field). */
export async function deleteMediaMany(paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return;
  const { error } = await supabase.storage.from('media').remove(list);
  if (error) console.warn('media bulk delete failed', error.message);
}
