/**
 * Image Utilities for Frontend Processing
 * High-clarity, ultra-low storage compression tailored for financial / trading charts.
 */

export interface ProcessedImageResult {
  originalBlob: Blob;
  thumbBlob: Blob;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
  format: 'webp' | 'jpeg';
}

/**
 * Check if the browser supports WebP canvas export
 */
let isWebpSupportedCache: boolean | null = null;
export function isWebpSupported(): boolean {
  if (isWebpSupportedCache !== null) return isWebpSupportedCache;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    isWebpSupportedCache = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch (e) {
    isWebpSupportedCache = false;
  }
  return isWebpSupportedCache;
}

/**
 * Compresses an image file for storage or preview.
 * - Supports high max dimensions (up to 2048px) so candlestick/K-line charts, numbers, and indicators stay razor sharp.
 * - Uses WebP (quality ~0.80) with automatic JPEG fallback for maximal compression efficiency (typically 60-150KB per trade screenshot).
 * - Uses bicubic/bilinear image smoothing for crisp text and axis lines.
 */
export async function compressImage(
  file: File | Blob,
  maxWidth: number = 2048,
  maxHeight: number = 2048,
  quality: number = 0.82
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectURL;
    
    img.onload = () => {
      URL.revokeObjectURL(objectURL);
      const canvas = document.createElement('canvas');
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Calculate new dimensions preserving aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        reject(new Error('無法取得繪圖環境'));
        return;
      }

      // Optimize canvas rendering for chart clarity
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Fill dark/white background in case of transparent PNG charts
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = isWebpSupported() ? 'image/webp' : 'image/jpeg';

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else {
            // Fallback to jpeg if webp export failed
            canvas.toBlob(
              (fallbackBlob) => {
                if (fallbackBlob) resolve(fallbackBlob);
                else reject(new Error('圖片壓縮輸出失敗'));
              },
              'image/jpeg',
              quality
            );
          }
        },
        mimeType,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectURL);
      reject(new Error('圖片載入失敗，檔案可能損壞或格式不支援'));
    };
  });
}

/**
 * Generates a lightweight thumbnail for lists and gallery cards.
 * Max dimension 480px, quality 0.70 (typically 15-30KB) - instant loading without lag.
 */
export async function generateThumbnail(file: File | Blob): Promise<Blob> {
  return compressImage(file, 480, 480, 0.72);
}

/**
 * Validates image file type and size.
 */
export function validateImage(file: File): { valid: boolean; error?: string } {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  if (ext === 'heic' || ext === 'heif' || file.type.includes('heic') || file.type.includes('heif')) {
    return { valid: false, error: '目前不支援 Apple HEIC/HEIF 原始格式，請先在手機或電腦轉為 JPG/PNG 後上傳' };
  }

  if (file.type && !allowedTypes.includes(file.type)) {
    if (ext && !['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
      return { valid: false, error: '只支援常見圖片格式 (JPG, PNG, WEBP, BMP)' };
    }
  }

  // Maximum 25MB raw file limit before compression
  const maxSize = 25 * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: '原始檔案過大（超過 25MB），請先進行簡單裁切或縮小' };
  }

  return { valid: true };
}

/**
 * Helper to format byte sizes into clean human-readable strings
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Ensures a Blob fits safely under Firestore's 1MB document limit (~680KB binary -> ~910KB Base64).
 */
export async function ensureFirestoreSafeBlob(blob: Blob, maxBytes: number = 680 * 1024): Promise<Blob> {
  if (!blob || blob.size <= maxBytes) return blob;

  const steps: Array<[number, number]> = [
    [1600, 0.72],
    [1280, 0.65],
    [1024, 0.56],
    [800, 0.48],
  ];

  let current = blob;
  for (const [dim, quality] of steps) {
    try {
      current = await compressImage(current, dim, dim, quality);
      if (current.size <= maxBytes) return current;
    } catch {
      break;
    }
  }
  return current;
}
