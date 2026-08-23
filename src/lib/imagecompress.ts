/* ============================================================
   Client-side image compression. Everything uploaded becomes
   WebP: one format to render, far smaller than the source, and
   supported by every browser this app targets.
   ============================================================ */

export type CompressionLevel = 'low' | 'medium' | 'medium-high' | 'high' | 'original';

export const COMPRESSION_LEVELS: {
  key: CompressionLevel;
  label: string;
  /** WebP quality, 0–1. */
  quality: number;
  /** Longest edge in px; 0 = leave the pixel size alone. */
  maxEdge: number;
  hint: string;
}[] = [
  { key: 'low', label: 'Small', quality: 0.55, maxEdge: 1400, hint: 'smallest files, visible softening' },
  { key: 'medium', label: 'Medium', quality: 0.7, maxEdge: 2000, hint: 'good for web-only output' },
  {
    key: 'medium-high',
    label: 'Medium-high',
    quality: 0.82,
    maxEdge: 2600,
    hint: 'recommended — near-original at a fraction of the size',
  },
  { key: 'high', label: 'High', quality: 0.92, maxEdge: 3600, hint: 'for print-bound artwork' },
  { key: 'original', label: 'Original', quality: 1, maxEdge: 0, hint: 'no re-encoding' },
];

export const DEFAULT_COMPRESSION: CompressionLevel = 'medium-high';

export function compressionSetting(level: CompressionLevel) {
  return COMPRESSION_LEVELS.find((l) => l.key === level) ?? COMPRESSION_LEVELS[2];
}

export interface CompressedImage {
  blob: Blob;
  /** 'webp', or the source extension when left untouched. */
  ext: string;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
}

function loadBitmap(file: File): Promise<{ bmp: ImageBitmap | HTMLImageElement; w: number; h: number }> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file).then((bmp) => ({ bmp, w: bmp.width, h: bmp.height }));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ bmp: img, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/**
 * Re-encode an image as WebP at the chosen level, downscaling if it is
 * larger than the level's longest edge. SVGs and the 'original' level
 * pass through untouched — rasterising a vector would lose its point.
 */
export async function compressImage(
  file: File,
  level: CompressionLevel,
): Promise<CompressedImage> {
  const setting = compressionSetting(level);
  const isSvg = file.type === 'image/svg+xml';

  if (isSvg || level === 'original') {
    return {
      blob: file,
      ext: file.name.split('.').pop()?.toLowerCase() || 'bin',
      width: 0,
      height: 0,
      originalBytes: file.size,
      bytes: file.size,
    };
  }

  const { bmp, w, h } = await loadBitmap(file);
  const scale =
    setting.maxEdge > 0 && Math.max(w, h) > setting.maxEdge ? setting.maxEdge / Math.max(w, h) : 1;
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable, so the image cannot be compressed.');
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, outW, outH);
  if ('close' in bmp && typeof bmp.close === 'function') bmp.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', setting.quality),
  );
  if (!blob) throw new Error('WebP encoding failed in this browser.');

  // A pathological source can encode larger than the original; keep the
  // smaller of the two rather than making the file worse.
  if (blob.size >= file.size && scale === 1) {
    return {
      blob: file,
      ext: file.name.split('.').pop()?.toLowerCase() || 'bin',
      width: outW,
      height: outH,
      originalBytes: file.size,
      bytes: file.size,
    };
  }

  return {
    blob,
    ext: 'webp',
    width: outW,
    height: outH,
    originalBytes: file.size,
    bytes: blob.size,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
