import Dexie, { type Table } from 'dexie';
import { Transaction, Tag, StrategyTemplate, StrategyChecklistItem } from '../types';
import { auth, db as firestore } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * Local-First Database Configuration
 * Powered by IndexedDB / Dexie.js
 */

export interface LocalBlob {
  id: string; // Typically a UUID
  type: 'original' | 'thumbnail';
  mimeType: string;
  data: Blob;
  createdAt: number;
}

export class TradingDatabase extends Dexie {
  trades!: Table<Transaction & { 
    localOnly: boolean; 
    cloudBackedUpAt?: string;
    imageThumbnailId?: string; // Reference to blobs table
    imageOriginalId?: string;  // Reference to blobs table
  }>;
  
  tags!: Table<Tag>;
  
  strategies!: Table<StrategyTemplate>;
  
  rules!: Table<StrategyChecklistItem>;
  
  blobs!: Table<LocalBlob>;

  constructor() {
    super('TradingJourneyDB');
    
    // Schema versioning
    // We increment to version 2 to ensure updatedAt and deleted are indexed where appropriate
    this.version(2).stores({
      trades: 'id, userId, symbol, date, result, rating, localOnly, createdAt, updatedAt, deleted',
      tags: 'id, userId, name, updatedAt, deleted',
      strategies: 'id, userId, name, updatedAt, deleted',
      rules: 'id, templateId, sortOrder, updatedAt, deleted',
      blobs: 'id, type, createdAt'
    });
  }
}

export const db = new TradingDatabase();

/**
 * Helper to save a file to IndexedDB and get an ID
 */
export async function saveBlob(data: Blob, type: 'original' | 'thumbnail'): Promise<string> {
  const id = crypto.randomUUID();
  await db.blobs.add({
    id,
    type,
    mimeType: data.type,
    data,
    createdAt: Date.now()
  });
  return id;
}

/**
 * Maximum number of active Object URLs in memory.
 * Older URLs are automatically revoked to prevent browser memory leaks on large datasets.
 */
const MAX_BLOB_CACHE_SIZE = 180;

/**
 * LRU Cache for active Object URLs
 */
const blobUrlCache = new Map<string, string>();

/**
 * In-flight promise tracker to deduplicate simultaneous requests for the same blob ID
 */
const pendingBlobPromises = new Map<string, Promise<string | null>>();

/**
 * Subscribers notified whenever cloud blobs are hydrated into local IndexedDB
 */
const blobHydrationListeners = new Set<() => void>();

export function onBlobHydrated(callback: () => void): () => void {
  blobHydrationListeners.add(callback);
  return () => {
    blobHydrationListeners.delete(callback);
  };
}

export function notifyBlobsHydrated(): void {
  blobHydrationListeners.forEach(cb => {
    try {
      cb();
    } catch (_) {}
  });
}

export function clearBlobUrlCache(): void {
  blobUrlCache.forEach((url) => {
    if (url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }
  });
  blobUrlCache.clear();
  pendingBlobPromises.clear();
}

/**
 * Helper to get a Blob's Object URL with caching, deduplication, and memory safety
 */
export async function getBlobUrl(id: string): Promise<string | null> {
  if (!id) return null;

  // 1. If it's already a direct web URL, data URI, or blob URL, return as-is
  if (
    id.startsWith('data:') || 
    id.startsWith('blob:') || 
    id.startsWith('http://') || 
    id.startsWith('https://')
  ) {
    return id;
  }

  // 2. Check LRU cache: if exists, bump to latest position and return
  if (blobUrlCache.has(id)) {
    const cachedUrl = blobUrlCache.get(id)!;
    // Re-insert to refresh LRU recency
    blobUrlCache.delete(id);
    blobUrlCache.set(id, cachedUrl);
    return cachedUrl;
  }

  // 3. Check in-flight promises to deduplicate concurrent requests
  if (pendingBlobPromises.has(id)) {
    return pendingBlobPromises.get(id)!;
  }

  // 4. Create new query promise
  const queryPromise = (async (): Promise<string | null> => {
    try {
      let blobRecord = await db.blobs.get(id);

      // If not in local IndexedDB, ensure auth state is resolved and fetch from Cloud Firestore
      if ((!blobRecord || !blobRecord.data) && firestore) {
        if (auth && typeof auth.authStateReady === 'function') {
          await auth.authStateReady().catch(() => {});
        }
        if (auth?.currentUser) {
          try {
            const blobRef = doc(firestore, 'users', auth.currentUser.uid, 'blobs', id);
            const snap = await getDoc(blobRef);
            if (snap.exists()) {
              const cloudBlob = snap.data();
              if (cloudBlob && cloudBlob.base64) {
                const restoredBlob = await base64ToBlob(cloudBlob.base64);
                blobRecord = {
                  id,
                  type: cloudBlob.type || 'thumbnail',
                  mimeType: cloudBlob.mimeType || restoredBlob.type || 'image/webp',
                  data: restoredBlob,
                  createdAt: cloudBlob.createdAt || Date.now()
                };
                // Persist into local IndexedDB so all future requests are instant and offline-available!
                await db.blobs.put(blobRecord);
                console.log(`[db] Hydrated blob ${id} from Firestore into local IndexedDB`);
              }
            }
          } catch (fetchErr) {
            console.warn(`[db] Cloud fetch failed for blob ${id}:`, fetchErr);
          }
        }
      }

      if (!blobRecord || !blobRecord.data) {
        return null;
      }

      let url: string;
      const rawData = blobRecord.data as any;

      // Handle standard Blob instance
      if (rawData instanceof Blob) {
        url = URL.createObjectURL(rawData);
      } 
      // Handle ArrayBuffer or typed array
      else if (rawData instanceof ArrayBuffer || ArrayBuffer.isView(rawData)) {
        const blob = new Blob([rawData as BlobPart], { 
          type: blobRecord.mimeType || 'image/webp' 
        });
        url = URL.createObjectURL(blob);
      }
      // Handle string if stored as data URL or base64
      else if (typeof rawData === 'string') {
        if (rawData.startsWith('data:')) {
          url = rawData;
        } else {
          const blob = await base64ToBlob(rawData);
          url = URL.createObjectURL(blob);
        }
      } else {
        return null;
      }

      // Maintain LRU cache size limit: evict oldest if needed
      if (blobUrlCache.size >= MAX_BLOB_CACHE_SIZE) {
        const oldestKey = blobUrlCache.keys().next().value;
        if (oldestKey) {
          const oldestUrl = blobUrlCache.get(oldestKey);
          if (oldestUrl && oldestUrl.startsWith('blob:')) {
            try { URL.revokeObjectURL(oldestUrl); } catch (_) {}
          }
          blobUrlCache.delete(oldestKey);
        }
      }

      blobUrlCache.set(id, url);
      return url;
    } catch (err) {
      console.warn(`[db] Failed to load blob URL for ${id}:`, err);
      return null;
    } finally {
      pendingBlobPromises.delete(id);
    }
  })();

  pendingBlobPromises.set(id, queryPromise);
  return queryPromise;
}

/**
 * Preload an array of blob IDs in batches to make scrolling smooth
 */
export async function preloadBlobUrls(ids: string[]): Promise<void> {
  const validIds = ids.filter(id => id && !blobUrlCache.has(id));
  if (validIds.length === 0) return;

  // Process in small parallel chunks to avoid blocking the main thread
  const CHUNK = 8;
  for (let i = 0; i < validIds.length; i += CHUNK) {
    const chunk = validIds.slice(i, i + CHUNK);
    await Promise.allSettled(chunk.map(id => getBlobUrl(id)));
  }
}

/**
 * Evict a Blob Object URL when deleted or updated
 */
export function revokeBlobUrl(id: string): void {
  const existing = blobUrlCache.get(id);
  if (existing) {
    if (existing.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(existing);
      } catch (e) {
        // Ignore
      }
    }
    blobUrlCache.delete(id);
  }
  pendingBlobPromises.delete(id);
}

/**
 * Helper to convert Blob to Base64
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Robust helper to convert Base64 to Blob with fallback
 */
export async function base64ToBlob(base64: string): Promise<Blob> {
  if (!base64) return new Blob([]);
  try {
    const response = await fetch(base64);
    return await response.blob();
  } catch (err) {
    // Robust manual fallback for environments where fetch data-URL fails
    try {
      const parts = base64.split(',');
      const mimeMatch = parts[0]?.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
      const bstr = atob(parts[1] || parts[0]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (manualErr) {
      console.error('[db] base64ToBlob failed:', manualErr);
      return new Blob([]);
    }
  }
}

/**
 * Helper to get a Blob record
 */
export async function getBlobRecord(id: string): Promise<LocalBlob | null> {
  return await db.blobs.get(id) || null;
}
