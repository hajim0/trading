import { db as localDb, saveBlob, blobToBase64, base64ToBlob, LocalBlob, notifyBlobsHydrated } from './db';
import { ensureFirestoreSafeBlob } from './imageUtils';
import { auth, db as firestore } from '../firebase';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  writeBatch
} from 'firebase/firestore';
import { Transaction, Tag, StrategyTemplate, StrategyChecklistItem } from '../types';
import { settingsStore } from './settings';

export interface FullBackupBlob {
  id: string;
  type: 'original' | 'thumbnail';
  mimeType: string;
  base64: string;
}

export interface FullBackupData {
  version: number;
  backupAt: string;
  backupTimestamp: number;
  userId: string;
  userEmail: string;
  totalTrades: number;
  trades: Transaction[];
  tags: Tag[];
  strategies: StrategyTemplate[];
  rules: StrategyChecklistItem[];
  settings: any;
  blobs: FullBackupBlob[];
}

export interface RestoreResult {
  success: boolean;
  tradesCount: number;
  tagsCount: number;
  strategiesCount: number;
  rulesCount: number;
  blobsCount: number;
  backupAt: string;
}

/**
 * Sanitize data for Firestore write (removes undefined, functions, and invalid values)
 */
export function sanitizeForFirestore<T>(data: T): T {
  const clean = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null) return null;
    if (Array.isArray(obj)) return obj.map(clean);
    if (typeof obj === 'object') {
      const res: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          res[key] = clean(value);
        }
      }
      return res;
    }
    return obj;
  };
  return clean(data);
}

export const dataService = {
  /**
   * Save a local blob into Firestore users/{userId}/blobs/{blobId}
   */
  async saveBlobToCloud(blobId: string, userId: string): Promise<void> {
    if (!firestore || !userId || !blobId) return;
    try {
      const localBlob = await localDb.blobs.get(blobId);
      if (!localBlob || !localBlob.data) return;

      const blobRef = doc(firestore, 'users', userId, 'blobs', blobId);
      const snap = await getDoc(blobRef);
      if (snap.exists()) return; // Already uploaded

      const safeBlob = await ensureFirestoreSafeBlob(localBlob.data);
      const base64 = await blobToBase64(safeBlob);
      await setDoc(blobRef, sanitizeForFirestore({
        id: blobId,
        userId,
        type: localBlob.type || 'thumbnail',
        mimeType: safeBlob.type || localBlob.mimeType || 'image/webp',
        base64,
        createdAt: localBlob.createdAt || Date.now(),
        updatedAt: Date.now()
      }));
      console.log(`[dataService] Uploaded blob ${blobId} to Firestore successfully`);
    } catch (err) {
      console.warn(`[dataService] saveBlobToCloud failed for ${blobId}:`, err);
    }
  },

  /**
   * Sync any locally stored blobs referenced by user trades to Firestore in background
   */
  async syncMissingLocalBlobsToCloud(userId: string): Promise<number> {
    if (!firestore || !userId) return 0;
    try {
      const userTrades = await localDb.trades
        .filter(t => t.userId === userId && !t.deleted)
        .toArray();
      
      const blobIds = new Set<string>();
      for (const t of userTrades) {
        if (t.imageThumbnailId) blobIds.add(t.imageThumbnailId);
        if (t.imageOriginalId) blobIds.add(t.imageOriginalId);
      }

      let syncedCount = 0;
      for (const bId of blobIds) {
        const localBlob = await localDb.blobs.get(bId);
        if (localBlob && localBlob.data) {
          const blobRef = doc(firestore, 'users', userId, 'blobs', bId);
          const snap = await getDoc(blobRef);
          if (!snap.exists()) {
            const safeBlob = await ensureFirestoreSafeBlob(localBlob.data);
            const base64 = await blobToBase64(safeBlob);
            await setDoc(blobRef, sanitizeForFirestore({
              id: bId,
              userId,
              type: localBlob.type || 'thumbnail',
              mimeType: safeBlob.type || localBlob.mimeType || 'image/webp',
              base64,
              createdAt: localBlob.createdAt || Date.now(),
              updatedAt: Date.now()
            }));
            syncedCount++;
          }
        }
      }

      // Also backfill lightweight thumbnail into screenshots[0] for trades that still have empty screenshots
      for (const t of userTrades) {
        if (t.imageThumbnailId && (!t.screenshots || t.screenshots.length === 0)) {
          const thumbBlob = await localDb.blobs.get(t.imageThumbnailId);
          if (thumbBlob && thumbBlob.data) {
            const thumbBase64 = await blobToBase64(thumbBlob.data);
            if (thumbBase64 && thumbBase64.length <= 220_000) {
              const updatedTrade = sanitizeForFirestore({
                ...t,
                screenshots: [thumbBase64]
              });
              await localDb.trades.put(updatedTrade);
              await setDoc(doc(firestore, 'users', userId, 'trades', t.id), updatedTrade, { merge: true });
            }
          }
        }
      }

      return syncedCount;
    } catch (err) {
      console.warn('[dataService] syncMissingLocalBlobsToCloud warning:', err);
      return 0;
    }
  },

  /**
   * Save or update a trade in both Local IndexedDB and Cloud Firestore
   */
  async saveTrade(trade: Transaction, user: User | null): Promise<void> {
    const now = Date.now();
    const cleanTrade = sanitizeForFirestore({
      ...trade,
      userId: user ? user.uid : (trade.userId || 'local-user'),
      updatedAt: now,
      localOnly: !user,
      syncStatus: 'pending' as const
    });

    // 1. Save to Local IndexedDB first
    await localDb.trades.put(cleanTrade);

    // 2. If logged in, save to Cloud Firestore and await blob uploads so switching devices/logging out never loses images
    if (user && firestore) {
      try {
        const syncedTrade = sanitizeForFirestore({
          ...cleanTrade,
          localOnly: false,
          syncStatus: 'synced' as const
        });
        const tradeRef = doc(firestore, 'users', user.uid, 'trades', trade.id);
        await setDoc(tradeRef, syncedTrade);

        const blobUploads: Promise<void>[] = [];
        if (trade.imageThumbnailId) {
          blobUploads.push(dataService.saveBlobToCloud(trade.imageThumbnailId, user.uid));
        }
        if (trade.imageOriginalId) {
          blobUploads.push(dataService.saveBlobToCloud(trade.imageOriginalId, user.uid));
        }
        if (blobUploads.length > 0) {
          await Promise.all(blobUploads);
        }

        // Mark local record as synced once cloud commit succeeds
        await localDb.trades.put(syncedTrade);
      } catch (err) {
        console.error('[dataService] Failed to sync trade to Firestore:', err);
        throw err;
      }
    }
  },

  /**
   * Check whether a blobId is still referenced by any remaining local trade
   */
  async isBlobReferencedLocally(blobId: string, excludeTradeIds: Set<string>): Promise<boolean> {
    if (!blobId) return false;
    const refTrade = await localDb.trades
      .filter(t => !excludeTradeIds.has(t.id) && (t.imageOriginalId === blobId || t.imageThumbnailId === blobId))
      .first();
    return Boolean(refTrade);
  },

  /**
   * Delete a trade from Local IndexedDB and LIVE Cloud Firestore
   * Note: Isolated cloud backup snapshots (backup_trades, backup_blobs) are NEVER touched here.
   */
  async deleteTrade(id: string, user: User | null): Promise<void> {
    const trade = await localDb.trades.get(id);
    const excludeIds = new Set([id]);

    // 1. Delete associated local blobs only if not referenced by another trade
    const deleteOriginalBlob = trade?.imageOriginalId
      ? !(await this.isBlobReferencedLocally(trade.imageOriginalId, excludeIds))
      : false;
    const deleteThumbBlob = trade?.imageThumbnailId
      ? !(await this.isBlobReferencedLocally(trade.imageThumbnailId, excludeIds))
      : false;

    if (deleteOriginalBlob && trade?.imageOriginalId) {
      await localDb.blobs.delete(trade.imageOriginalId).catch(() => {});
    }
    if (deleteThumbBlob && trade?.imageThumbnailId) {
      await localDb.blobs.delete(trade.imageThumbnailId).catch(() => {});
    }

    // 2. Delete from Local IndexedDB
    await localDb.trades.delete(id);

    // 3. If logged in, delete from LIVE Cloud Firestore (backup snapshots remain untouched!)
    if (user && firestore) {
      try {
        const tradeRef = doc(firestore, 'users', user.uid, 'trades', id);
        await deleteDoc(tradeRef);

        if (deleteOriginalBlob && trade?.imageOriginalId) {
          await deleteDoc(doc(firestore, 'users', user.uid, 'blobs', trade.imageOriginalId)).catch(() => {});
        }
        if (deleteThumbBlob && trade?.imageThumbnailId) {
          await deleteDoc(doc(firestore, 'users', user.uid, 'blobs', trade.imageThumbnailId)).catch(() => {});
        }
      } catch (err) {
        console.error('[dataService] Failed to delete trade from Firestore:', err);
        throw err;
      }
    }
  },

  /**
   * Bulk delete trades from Local IndexedDB and LIVE Cloud Firestore
   * Note: Isolated cloud backup snapshots (backup_trades, backup_blobs) are NEVER touched here.
   */
  async bulkDeleteTrades(ids: string[], user: User | null): Promise<void> {
    if (!ids || ids.length === 0) return;

    const excludeSet = new Set(ids);
    const candidateBlobIds = new Set<string>();

    // 1. Collect candidate blobs & delete trades from local database
    for (const id of ids) {
      const trade = await localDb.trades.get(id);
      if (trade?.imageOriginalId) candidateBlobIds.add(trade.imageOriginalId);
      if (trade?.imageThumbnailId) candidateBlobIds.add(trade.imageThumbnailId);
      await localDb.trades.delete(id);
    }

    const blobIdsToDelete: string[] = [];
    for (const bId of candidateBlobIds) {
      const stillReferenced = await this.isBlobReferencedLocally(bId, excludeSet);
      if (!stillReferenced) {
        blobIdsToDelete.push(bId);
        await localDb.blobs.delete(bId).catch(() => {});
      }
    }

    // 2. If logged in, batch delete trades and unreferenced live blobs from Cloud Firestore
    if (user && firestore) {
      try {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
          const chunk = ids.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(firestore);
          for (const id of chunk) {
            const tradeRef = doc(firestore, 'users', user.uid, 'trades', id);
            batch.delete(tradeRef);
          }
          await batch.commit();
        }
        for (let i = 0; i < blobIdsToDelete.length; i += CHUNK_SIZE) {
          const chunk = blobIdsToDelete.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(firestore);
          for (const bId of chunk) {
            batch.delete(doc(firestore, 'users', user.uid, 'blobs', bId));
          }
          await batch.commit();
        }
      } catch (err) {
        console.error('[dataService] Failed to bulk delete from Firestore:', err);
        throw err;
      }
    }
  },

  /**
   * Save or update a tag
   */
  async saveTag(tag: Tag, user: User | null): Promise<void> {
    const cleanTag = sanitizeForFirestore({
      ...tag,
      userId: user ? user.uid : (tag.userId || 'local-user'),
      updatedAt: Date.now()
    });

    await localDb.tags.put(cleanTag);

    if (user && firestore) {
      try {
        const tagRef = doc(firestore, 'users', user.uid, 'tags', tag.id);
        await setDoc(tagRef, cleanTag);
      } catch (err) {
        console.error('[dataService] Failed to save tag to Firestore:', err);
      }
    }
  },

  /**
   * Delete a tag
   */
  async deleteTag(id: string, user: User | null): Promise<void> {
    await localDb.tags.delete(id);

    if (user && firestore) {
      try {
        const tagRef = doc(firestore, 'users', user.uid, 'tags', id);
        await deleteDoc(tagRef);
      } catch (err) {
        console.error('[dataService] Failed to delete tag from Firestore:', err);
      }
    }
  },

  /**
   * Save or update a strategy template
   */
  async saveStrategy(strategy: StrategyTemplate, user: User | null): Promise<void> {
    const cleanStrategy = sanitizeForFirestore({
      ...strategy,
      userId: user ? user.uid : (strategy.userId || 'local-user'),
      updatedAt: Date.now()
    });

    await localDb.strategies.put(cleanStrategy);

    if (user && firestore) {
      try {
        const stratRef = doc(firestore, 'users', user.uid, 'strategies', strategy.id);
        await setDoc(stratRef, cleanStrategy);
      } catch (err) {
        console.error('[dataService] Failed to save strategy to Firestore:', err);
      }
    }
  },

  /**
   * Delete a strategy template
   */
  async deleteStrategy(id: string, user: User | null): Promise<void> {
    await localDb.strategies.delete(id);

    if (user && firestore) {
      try {
        const stratRef = doc(firestore, 'users', user.uid, 'strategies', id);
        await deleteDoc(stratRef);
      } catch (err) {
        console.error('[dataService] Failed to delete strategy from Firestore:', err);
      }
    }
  },

  /**
   * Save or update a strategy checklist rule
   */
  async saveRule(rule: StrategyChecklistItem, user: User | null): Promise<void> {
    const cleanRule = sanitizeForFirestore({
      ...rule,
      updatedAt: Date.now()
    });

    await localDb.rules.put(cleanRule);

    if (user && firestore) {
      try {
        const ruleRef = doc(firestore, 'users', user.uid, 'rules', rule.id);
        await setDoc(ruleRef, cleanRule);
      } catch (err) {
        console.error('[dataService] Failed to save rule to Firestore:', err);
      }
    }
  },

  /**
   * Delete a strategy checklist rule
   */
  async deleteRule(id: string, user: User | null): Promise<void> {
    await localDb.rules.delete(id);

    if (user && firestore) {
      try {
        const ruleRef = doc(firestore, 'users', user.uid, 'rules', id);
        await deleteDoc(ruleRef);
      } catch (err) {
        console.error('[dataService] Failed to delete rule from Firestore:', err);
      }
    }
  },

  /**
   * Sync all user collections from Cloud Firestore to Local IndexedDB Cache
   * and push any unsynced local records up to Firestore
   */
  async syncUserFromCloud(user: User): Promise<{
    tradesCount: number;
    tagsCount: number;
    strategiesCount: number;
    rulesCount: number;
  }> {
    if (!firestore || !user?.uid) {
      return { tradesCount: 0, tagsCount: 0, strategiesCount: 0, rulesCount: 0 };
    }

    try {
      console.log(`[dataService] Hydrating data for user ${user.uid} from Firestore...`);

      // 1. Fetch trades
      const tradesCol = collection(firestore, 'users', user.uid, 'trades');
      const tradesSnap = await getDocs(tradesCol);
      const cloudTrades: Transaction[] = [];
      tradesSnap.forEach(d => {
        cloudTrades.push(d.data() as Transaction);
      });

      // 2. Fetch tags
      const tagsCol = collection(firestore, 'users', user.uid, 'tags');
      const tagsSnap = await getDocs(tagsCol);
      const cloudTags: Tag[] = [];
      tagsSnap.forEach(d => {
        cloudTags.push(d.data() as Tag);
      });

      // 3. Fetch strategies
      const stratCol = collection(firestore, 'users', user.uid, 'strategies');
      const stratSnap = await getDocs(stratCol);
      const cloudStrats: StrategyTemplate[] = [];
      stratSnap.forEach(d => {
        cloudStrats.push(d.data() as StrategyTemplate);
      });

      // 4. Fetch rules
      const rulesCol = collection(firestore, 'users', user.uid, 'rules');
      const rulesSnap = await getDocs(rulesCol);
      const cloudRules: StrategyChecklistItem[] = [];
      rulesSnap.forEach(d => {
        cloudRules.push(d.data() as StrategyChecklistItem);
      });

      // Hydrate into local IndexedDB cleanly (respecting newer offline edits & cross-device deletions)
      const localUserTradesBefore = await localDb.trades
        .filter(t => t.userId === user.uid && !t.deleted)
        .toArray();
      const localTradesMap = new Map(localUserTradesBefore.map(t => [t.id, t]));

      const tradesToPutLocally: any[] = [];
      for (const ct of cloudTrades) {
        const normalizedCloud = {
          ...ct,
          userId: user.uid,
          localOnly: false,
          syncStatus: 'synced' as const
        };
        const lt = localTradesMap.get(ct.id);
        if (!lt || !lt.localOnly || (ct.updatedAt || 0) >= (lt.updatedAt || 0)) {
          tradesToPutLocally.push(normalizedCloud);
        }
      }
      if (tradesToPutLocally.length > 0) {
        await localDb.trades.bulkPut(tradesToPutLocally);
      }
      if (cloudTags.length > 0) {
        await localDb.tags.bulkPut(cloudTags.map(tg => ({ ...tg, userId: user.uid })));
      }
      if (cloudStrats.length > 0) {
        await localDb.strategies.bulkPut(cloudStrats.map(s => ({ ...s, userId: user.uid })));
      }
      if (cloudRules.length > 0) {
        await localDb.rules.bulkPut(cloudRules);
      }

      // Reconcile local trades missing from live Firestore:
      // - If localOnly === true (created offline or never pushed): push to Firestore & mark synced
      // - If localOnly === false (was already synced earlier, now absent in cloud): deleted on another device -> remove locally
      const cloudTradeIds = new Set(cloudTrades.map(t => t.id));
      for (const lt of localUserTradesBefore) {
        if (!cloudTradeIds.has(lt.id)) {
          if (lt.localOnly || lt.syncStatus === 'pending') {
            const syncedTrade = sanitizeForFirestore({
              ...lt,
              userId: user.uid,
              localOnly: false,
              syncStatus: 'synced' as const
            });
            const tradeRef = doc(firestore, 'users', user.uid, 'trades', lt.id);
            await setDoc(tradeRef, syncedTrade);
            await localDb.trades.put(syncedTrade);
          } else {
            await localDb.trades.delete(lt.id);
          }
        }
      }

      const localUserTrades = await localDb.trades
        .filter(t => t.userId === user.uid && !t.deleted)
        .toArray();

      // 5. Pre-fetch user blobs from Firestore into local IndexedDB
      try {
        const blobsCol = collection(firestore, 'users', user.uid, 'blobs');
        const blobsSnap = await getDocs(blobsCol);
        let hydratedCount = 0;
        for (const bDoc of blobsSnap.docs) {
          const bData = bDoc.data();
          if (bData && bData.id && bData.base64) {
            const existing = await localDb.blobs.get(bData.id);
            if (!existing) {
              const blobObj = await base64ToBlob(bData.base64);
              await localDb.blobs.put({
                id: bData.id,
                type: bData.type || 'thumbnail',
                mimeType: bData.mimeType || blobObj.type || 'image/webp',
                data: blobObj,
                createdAt: bData.createdAt || Date.now()
              });
              hydratedCount++;
            }
          }
        }
        if (hydratedCount > 0) {
          notifyBlobsHydrated();
        }
      } catch (bErr) {
        console.warn('[dataService] Error pre-hydrating blobs from cloud:', bErr);
      }

      // 6. Background sync: push any locally created blobs (and backfill missing thumbnails) to cloud
      dataService.syncMissingLocalBlobsToCloud(user.uid).catch(() => {});

      console.log(`[dataService] Sync complete: ${Math.max(cloudTrades.length, localUserTrades.length)} trades`);

      return {
        tradesCount: Math.max(cloudTrades.length, localUserTrades.length),
        tagsCount: cloudTags.length,
        strategiesCount: cloudStrats.length,
        rulesCount: cloudRules.length
      };
    } catch (err) {
      console.error('[dataService] syncUserFromCloud error:', err);
      throw err;
    }
  },

  /**
   * Package complete fresh backup of user data (including images as Base64)
   */
  async packageFullBackup(userId: string, userEmail?: string): Promise<FullBackupData> {
    // 1. Fetch fresh records from local database
    const trades = await localDb.trades
      .filter(t => t.userId === userId && !t.deleted)
      .toArray();

    const tags = await localDb.tags
      .filter(t => t.userId === userId && !t.deleted)
      .toArray();

    const strategies = await localDb.strategies
      .filter(s => s.userId === userId && !s.deleted)
      .toArray();

    const rules = await localDb.rules
      .filter(r => !r.deleted)
      .toArray();

    const settings = settingsStore.get();

    // 2. Gather all image blobs referenced by these trades
    const referencedBlobIds = new Set<string>();
    trades.forEach(t => {
      if (t.imageOriginalId) referencedBlobIds.add(t.imageOriginalId);
      if (t.imageThumbnailId) referencedBlobIds.add(t.imageThumbnailId);
    });

    const backupBlobs: FullBackupBlob[] = [];
    for (const blobId of referencedBlobIds) {
      try {
        const record = await localDb.blobs.get(blobId);
        if (record && record.data) {
          const base64 = await blobToBase64(record.data);
          backupBlobs.push({
            id: record.id,
            type: record.type,
            mimeType: record.mimeType,
            base64
          });
        }
      } catch (e) {
        console.warn(`[dataService] Failed to encode blob ${blobId}:`, e);
      }
    }

    return {
      version: 2,
      backupAt: new Date().toISOString(),
      backupTimestamp: Date.now(),
      userId,
      userEmail: userEmail || 'user@trading.app',
      totalTrades: trades.length,
      trades,
      tags,
      strategies,
      rules,
      settings,
      blobs: backupBlobs
    };
  },

  /**
   * Export complete backup to downloadable JSON file
   */
  async exportJsonBackup(userId: string, userEmail?: string): Promise<{
    filename: string;
    totalTrades: number;
    totalBlobs: number;
  }> {
    const backupData = await this.packageFullBackup(userId, userEmail);
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `trading-backup-${dateStr}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up url
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);

    return {
      filename,
      totalTrades: backupData.totalTrades,
      totalBlobs: backupData.blobs.length
    };
  },

  /**
   * Import complete backup from JSON file and restore to LocalDB & Firestore
   */
  async importJsonBackup(file: File, currentUserId: string): Promise<RestoreResult> {
    const text = await file.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('檔案解析失敗，這不是有效的 JSON 檔案');
    }

    if (!data || !data.trades || !Array.isArray(data.trades)) {
      throw new Error('備份檔案格式無效：缺少交易紀錄 (trades) 陣列');
    }

    const backupTrades: Transaction[] = data.trades.map((t: any) => ({
      ...t,
      userId: currentUserId // Remap to current active user
    }));

    const backupTags: Tag[] = (data.tags || []).map((t: any) => ({
      ...t,
      userId: currentUserId
    }));

    const backupStrategies: StrategyTemplate[] = (data.strategies || []).map((s: any) => ({
      ...s,
      userId: currentUserId
    }));

    const backupRules: StrategyChecklistItem[] = data.rules || [];

    // Restore blobs if present
    let restoredBlobsCount = 0;
    if (data.blobs && Array.isArray(data.blobs)) {
      for (const b of data.blobs) {
        if (b.id && b.base64) {
          try {
            const blobObj = await base64ToBlob(b.base64);
            await localDb.blobs.put({
              id: b.id,
              type: b.type || 'original',
              mimeType: b.mimeType || blobObj.type || 'image/jpeg',
              data: blobObj,
              createdAt: Date.now()
            });
            restoredBlobsCount++;
          } catch (err) {
            console.warn(`[dataService] Failed to restore blob ${b.id}:`, err);
          }
        }
      }
    }

    // Overwrite / put into local IndexedDB
    await localDb.trades.bulkPut(backupTrades);
    if (backupTags.length > 0) await localDb.tags.bulkPut(backupTags);
    if (backupStrategies.length > 0) await localDb.strategies.bulkPut(backupStrategies);
    if (backupRules.length > 0) await localDb.rules.bulkPut(backupRules);

    // Restore settings
    if (data.settings) {
      settingsStore.set(data.settings);
    }

    // Sync restored data to Cloud Firestore if logged in
    const currentUser = auth?.currentUser;
    if (currentUser && firestore) {
      try {
        console.log('[dataService] Syncing imported records to Cloud Firestore...');
        const syncedTrades = backupTrades.map(t => ({
          ...t,
          userId: currentUser.uid,
          localOnly: false,
          syncStatus: 'synced' as const
        }));
        await Promise.all([
          this.writeDocsInChunks(currentUser.uid, 'trades', syncedTrades as any),
          this.writeDocsInChunks(currentUser.uid, 'tags', backupTags as any),
          this.writeDocsInChunks(currentUser.uid, 'strategies', backupStrategies as any),
          this.writeDocsInChunks(currentUser.uid, 'rules', backupRules as any)
        ]);
        if (syncedTrades.length > 0) {
          await localDb.trades.bulkPut(syncedTrades as any);
        }
        await this.syncMissingLocalBlobsToCloud(currentUser.uid);
      } catch (err) {
        console.error('[dataService] Failed to push imported records to Firestore:', err);
      }
    }

    notifyBlobsHydrated();

    return {
      success: true,
      tradesCount: backupTrades.length,
      tagsCount: backupTags.length,
      strategiesCount: backupStrategies.length,
      rulesCount: backupRules.length,
      blobsCount: restoredBlobsCount,
      backupAt: data.backupAt || new Date().toISOString()
    };
  },

  /**
   * Helper: write an array of docs with IDs to users/{userId}/{subcollection} in safe batches of 400
   */
  async writeDocsInChunks(
    userId: string,
    subcollection: string,
    items: Array<{ id: string } & Record<string, any>>
  ): Promise<void> {
    if (!firestore || items.length === 0) return;
    const CHUNK_SIZE = 400;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const item of chunk) {
        const ref = doc(firestore, 'users', userId, subcollection, item.id);
        batch.set(ref, sanitizeForFirestore(item));
      }
      await batch.commit();
    }
  },

  /**
   * Helper: delete stale doc IDs from users/{userId}/{subcollection} that are no longer in keepIds
   */
  async reconcileCollection(
    userId: string,
    subcollection: string,
    keepIds: Set<string>
  ): Promise<void> {
    if (!firestore) return;
    const snap = await getDocs(collection(firestore, 'users', userId, subcollection));
    const staleIds: string[] = [];
    snap.forEach(d => {
      if (!keepIds.has(d.id)) {
        staleIds.push(d.id);
      }
    });
    const CHUNK_SIZE = 400;
    for (let i = 0; i < staleIds.length; i += CHUNK_SIZE) {
      const chunk = staleIds.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const id of chunk) {
        batch.delete(doc(firestore, 'users', userId, subcollection, id));
      }
      await batch.commit();
    }
  },

  /**
   * One-click Cloud Backup:
   * Saves an ISOLATED point-in-time snapshot into backup_trades / backup_tags / backup_strategies / backup_rules / backup_blobs
   * (so deleting live trades later NEVER deletes your cloud backup!) AND syncs live collections.
   */
  async cloudBackup(user: User): Promise<{ 
    tradeCount: number; 
    tagsCount: number; 
    strategiesCount: number; 
    rulesCount: number;
    blobsCount: number;
    updatedAt: number 
  }> {
    if (!firestore || !user?.uid) {
      throw new Error('未登入或 Firebase 未連線，無法執行雲端備份');
    }

    console.log(`[dataService] Starting isolated cloud backup snapshot for user ${user.uid}...`);

    // 1. Fetch fresh local records for this user
    const rawTrades = await localDb.trades
      .filter(t => t.userId === user.uid && !t.deleted)
      .toArray();

    const tags = await localDb.tags
      .filter(t => t.userId === user.uid && !t.deleted)
      .toArray();

    const strategies = await localDb.strategies
      .filter(s => s.userId === user.uid && !s.deleted)
      .toArray();

    const rules = await localDb.rules
      .filter(r => !r.deleted)
      .toArray();

    const settings = settingsStore.get();
    const now = Date.now();
    const backedUpAtIso = new Date(now).toISOString();

    const trades = rawTrades.map(t => ({
      ...t,
      userId: user.uid,
      localOnly: false,
      syncStatus: 'synced' as const,
      cloudBackedUpAt: backedUpAtIso,
      updatedAt: t.updatedAt || now
    }));

    const normalizedTags = tags.map(tg => ({
      ...tg,
      userId: user.uid,
      updatedAt: tg.updatedAt || now
    }));

    const normalizedStrategies = strategies.map(s => ({
      ...s,
      userId: user.uid,
      updatedAt: s.updatedAt || now
    }));

    const normalizedRules = rules.map(r => ({
      ...r,
      updatedAt: r.updatedAt || now
    }));

    // 2. Write to LIVE subcollections AND ISOLATED backup_* snapshot subcollections
    await Promise.all([
      this.writeDocsInChunks(user.uid, 'trades', trades),
      this.writeDocsInChunks(user.uid, 'backup_trades', trades),
      this.writeDocsInChunks(user.uid, 'tags', normalizedTags),
      this.writeDocsInChunks(user.uid, 'backup_tags', normalizedTags),
      this.writeDocsInChunks(user.uid, 'strategies', normalizedStrategies),
      this.writeDocsInChunks(user.uid, 'backup_strategies', normalizedStrategies),
      this.writeDocsInChunks(user.uid, 'rules', normalizedRules),
      this.writeDocsInChunks(user.uid, 'backup_rules', normalizedRules)
    ]);

    // Update local trades to reflect synced & backed-up state
    if (trades.length > 0) {
      await localDb.trades.bulkPut(trades);
    }

    // 3. Reconcile stale docs in backup_* collections (safe AFTER all current docs are written)
    await Promise.all([
      this.reconcileCollection(user.uid, 'backup_trades', new Set(trades.map(t => t.id))),
      this.reconcileCollection(user.uid, 'backup_tags', new Set(normalizedTags.map(t => t.id))),
      this.reconcileCollection(user.uid, 'backup_strategies', new Set(normalizedStrategies.map(s => s.id))),
      this.reconcileCollection(user.uid, 'backup_rules', new Set(normalizedRules.map(r => r.id)))
    ]);

    // 4. Backup all referenced blobs into BOTH live `blobs` and isolated `backup_blobs`
    const referencedBlobIds = new Set<string>();
    for (const t of trades) {
      if (t.imageThumbnailId) referencedBlobIds.add(t.imageThumbnailId);
      if (t.imageOriginalId) referencedBlobIds.add(t.imageOriginalId);
    }

    // First ensure any local blobs are uploaded to live `blobs`
    await this.syncMissingLocalBlobsToCloud(user.uid).catch(err => {
      console.warn('[dataService] Live blob sync notice:', err);
    });

    // Check which blobs are already present in `backup_blobs` to avoid redundant uploads
    const existingBackupBlobsSnap = await getDocs(collection(firestore, 'users', user.uid, 'backup_blobs'));
    const existingBackupBlobIds = new Set<string>();
    existingBackupBlobsSnap.forEach(d => existingBackupBlobIds.add(d.id));

    let totalBackupBlobsCount = 0;
    const blobIdsList = Array.from(referencedBlobIds);

    // Upload missing blobs in safe small parallel batches of 4
    const BLOB_CONCURRENCY = 4;
    for (let i = 0; i < blobIdsList.length; i += BLOB_CONCURRENCY) {
      const chunk = blobIdsList.slice(i, i + BLOB_CONCURRENCY);
      await Promise.all(chunk.map(async (bId) => {
        if (existingBackupBlobIds.has(bId)) {
          totalBackupBlobsCount++;
          return;
        }
        try {
          // Prefer local blob; fallback to live cloud `blobs` doc if device only had cloud copy
          const localBlob = await localDb.blobs.get(bId);
          if (localBlob && localBlob.data) {
            const safeBlob = await ensureFirestoreSafeBlob(localBlob.data);
            const base64 = await blobToBase64(safeBlob);
            await setDoc(doc(firestore!, 'users', user.uid, 'backup_blobs', bId), sanitizeForFirestore({
              id: bId,
              userId: user.uid,
              type: localBlob.type || 'thumbnail',
              mimeType: safeBlob.type || localBlob.mimeType || 'image/webp',
              base64,
              createdAt: localBlob.createdAt || now,
              updatedAt: now
            }));
            totalBackupBlobsCount++;
          } else {
            const liveBlobSnap = await getDoc(doc(firestore!, 'users', user.uid, 'blobs', bId));
            if (liveBlobSnap.exists()) {
              await setDoc(doc(firestore!, 'users', user.uid, 'backup_blobs', bId), sanitizeForFirestore({
                ...liveBlobSnap.data(),
                updatedAt: now
              }));
              totalBackupBlobsCount++;
            }
          }
        } catch (blobErr) {
          console.warn(`[dataService] Failed to backup blob ${bId}:`, blobErr);
        }
      }));
    }

    // Reconcile stale blobs in backup_blobs
    await this.reconcileCollection(user.uid, 'backup_blobs', referencedBlobIds);

    // 5. Write summary cloud backup manifest doc (version 3 = isolated snapshot collections)
    const backupSummary = sanitizeForFirestore({
      version: 3,
      snapshotVersion: 3,
      exportedAt: now,
      updatedAt: now,
      userId: user.uid,
      userEmail: user.email || '',
      tradeCount: trades.length,
      tagsCount: normalizedTags.length,
      strategiesCount: normalizedStrategies.length,
      rulesCount: normalizedRules.length,
      blobsCount: totalBackupBlobsCount,
      settings
    });

    const backupRef = doc(firestore, 'backups', user.uid);
    await setDoc(backupRef, backupSummary);

    // Also update users/{user.uid} profile summary
    try {
      await setDoc(doc(firestore, 'users', user.uid), sanitizeForFirestore({
        uid: user.uid,
        email: user.email || '',
        updatedAt: now,
        tradeCount: trades.length
      }), { merge: true });
    } catch (_) {}

    console.log(`[dataService] Cloud backup snapshot complete: ${trades.length} trades, ${normalizedTags.length} tags, ${totalBackupBlobsCount} blobs`);

    return {
      tradeCount: trades.length,
      tagsCount: normalizedTags.length,
      strategiesCount: normalizedStrategies.length,
      rulesCount: normalizedRules.length,
      blobsCount: totalBackupBlobsCount,
      updatedAt: now
    };
  },

  /**
   * One-click Cloud Restore:
   * Restores from isolated cloud backup snapshots (`backup_trades`, `backup_blobs`, etc.)
   * and pushes the restored records back into BOTH Local IndexedDB AND Live Cloud Firestore!
   */
  async cloudRestore(user: User): Promise<{ 
    tradeCount: number; 
    tagsCount: number; 
    strategiesCount: number; 
    rulesCount: number;
    blobsCount: number;
    updatedAt: number 
  }> {
    if (!firestore || !user?.uid) {
      throw new Error('未登入或 Firebase 未連線，無法執行雲端還原');
    }

    console.log(`[dataService] Starting comprehensive cloud restore for user ${user.uid}...`);

    // 1. Check backup manifest doc
    const backupRef = doc(firestore, 'backups', user.uid);
    let backupData: Record<string, any> | null = null;
    let backupUpdatedAt = Date.now();
    try {
      const backupSnap = await getDoc(backupRef);
      if (backupSnap.exists()) {
        backupData = backupSnap.data();
        backupUpdatedAt = backupData.exportedAt || backupData.updatedAt || Date.now();
      }
    } catch (e) {
      console.warn('[dataService] Failed reading backups manifest:', e);
    }

    // 2. Fetch from isolated backup_* snapshot collections first
    const [bTradesSnap, bTagsSnap, bStratsSnap, bRulesSnap] = await Promise.all([
      getDocs(collection(firestore, 'users', user.uid, 'backup_trades')),
      getDocs(collection(firestore, 'users', user.uid, 'backup_tags')),
      getDocs(collection(firestore, 'users', user.uid, 'backup_strategies')),
      getDocs(collection(firestore, 'users', user.uid, 'backup_rules'))
    ]);

    const cloudTradesMap = new Map<string, Transaction>();
    const cloudTagsMap = new Map<string, Tag>();
    const cloudStratsMap = new Map<string, StrategyTemplate>();
    const cloudRulesMap = new Map<string, StrategyChecklistItem>();

    bTradesSnap.forEach(d => {
      const data = d.data() as Transaction;
      if (data && data.id) {
        cloudTradesMap.set(data.id, {
          ...data,
          userId: user.uid,
          localOnly: false,
          syncStatus: 'synced'
        } as any);
      }
    });
    bTagsSnap.forEach(d => {
      const data = d.data() as Tag;
      if (data && data.id) cloudTagsMap.set(data.id, { ...data, userId: user.uid });
    });
    bStratsSnap.forEach(d => {
      const data = d.data() as StrategyTemplate;
      if (data && data.id) cloudStratsMap.set(data.id, { ...data, userId: user.uid });
    });
    bRulesSnap.forEach(d => {
      const data = d.data() as StrategyChecklistItem;
      if (data && data.id) cloudRulesMap.set(data.id, data);
    });

    const hasSnapshotV3 = (backupData?.snapshotVersion ?? 0) >= 3 ||
      cloudTradesMap.size > 0 || cloudTagsMap.size > 0 || cloudStratsMap.size > 0;

    // Legacy fallback: if no v3 snapshot exists yet, merge from embedded backupData arrays and live subcollections
    if (!hasSnapshotV3) {
      if (backupData) {
        if (Array.isArray(backupData.trades)) {
          for (const t of backupData.trades) {
            if (t && t.id && !cloudTradesMap.has(t.id)) {
              cloudTradesMap.set(t.id, { ...t, userId: user.uid, localOnly: false, syncStatus: 'synced' } as any);
            }
          }
        }
        if (Array.isArray(backupData.tags)) {
          for (const tg of backupData.tags) {
            if (tg && tg.id && !cloudTagsMap.has(tg.id)) {
              cloudTagsMap.set(tg.id, { ...tg, userId: user.uid });
            }
          }
        }
        if (Array.isArray(backupData.strategies)) {
          for (const s of backupData.strategies) {
            if (s && s.id && !cloudStratsMap.has(s.id)) {
              cloudStratsMap.set(s.id, { ...s, userId: user.uid });
            }
          }
        }
        if (Array.isArray(backupData.rules)) {
          for (const r of backupData.rules) {
            if (r && r.id && !cloudRulesMap.has(r.id)) {
              cloudRulesMap.set(r.id, r);
            }
          }
        }
      }

      const [liveTradesSnap, liveTagsSnap, liveStratsSnap, liveRulesSnap] = await Promise.all([
        getDocs(collection(firestore, 'users', user.uid, 'trades')),
        getDocs(collection(firestore, 'users', user.uid, 'tags')),
        getDocs(collection(firestore, 'users', user.uid, 'strategies')),
        getDocs(collection(firestore, 'users', user.uid, 'rules'))
      ]);
      liveTradesSnap.forEach(d => {
        const data = d.data() as Transaction;
        if (data && data.id && !cloudTradesMap.has(data.id)) {
          cloudTradesMap.set(data.id, { ...data, userId: user.uid, localOnly: false, syncStatus: 'synced' } as any);
        }
      });
      liveTagsSnap.forEach(d => {
        const data = d.data() as Tag;
        if (data && data.id && !cloudTagsMap.has(data.id)) cloudTagsMap.set(data.id, { ...data, userId: user.uid });
      });
      liveStratsSnap.forEach(d => {
        const data = d.data() as StrategyTemplate;
        if (data && data.id && !cloudStratsMap.has(data.id)) cloudStratsMap.set(data.id, { ...data, userId: user.uid });
      });
      liveRulesSnap.forEach(d => {
        const data = d.data() as StrategyChecklistItem;
        if (data && data.id && !cloudRulesMap.has(data.id)) cloudRulesMap.set(data.id, data);
      });
    }

    const finalTrades = Array.from(cloudTradesMap.values());
    const finalTags = Array.from(cloudTagsMap.values());
    const finalStrategies = Array.from(cloudStratsMap.values());
    const finalRules = Array.from(cloudRulesMap.values());

    if (finalTrades.length === 0 && finalTags.length === 0 && finalStrategies.length === 0) {
      throw new Error('雲端目前尚無備份紀錄。請先於有資料的裝置點擊「備份到個人雲端」。');
    }

    // 3. Restore settings (locally + to user profile)
    if (backupData?.settings) {
      settingsStore.set(backupData.settings);
      try {
        const profileUpdates: Record<string, any> = { updatedAt: Date.now() };
        if (typeof backupData.settings.initialCapital === 'number' && !isNaN(backupData.settings.initialCapital)) {
          profileUpdates.initialCapital = backupData.settings.initialCapital;
        }
        if (backupData.settings.disciplineMode) {
          profileUpdates.disciplineMode = backupData.settings.disciplineMode;
        }
        await setDoc(doc(firestore, 'users', user.uid), sanitizeForFirestore(profileUpdates), { merge: true });
      } catch (_) {}
    }

    // 4. Restore image blobs from `backup_blobs` (falling back to live `blobs` if legacy) into BOTH Local IndexedDB and Live Firestore `blobs`
    let restoredBlobsCount = 0;
    try {
      const backupBlobsSnap = await getDocs(collection(firestore, 'users', user.uid, 'backup_blobs'));
      const blobDocsToRestore = new Map<string, any>();
      backupBlobsSnap.forEach(d => blobDocsToRestore.set(d.id, d.data()));

      if (blobDocsToRestore.size === 0) {
        const liveBlobsSnap = await getDocs(collection(firestore, 'users', user.uid, 'blobs'));
        liveBlobsSnap.forEach(d => blobDocsToRestore.set(d.id, d.data()));
      }

      // Also check existing live blobs to avoid unnecessary re-writes
      const existingLiveBlobsSnap = await getDocs(collection(firestore, 'users', user.uid, 'blobs'));
      const existingLiveBlobIds = new Set<string>();
      existingLiveBlobsSnap.forEach(d => existingLiveBlobIds.add(d.id));

      for (const [bId, bData] of blobDocsToRestore.entries()) {
        if (bData && bData.base64) {
          // Restore into local IndexedDB
          const existingLocal = await localDb.blobs.get(bId);
          if (!existingLocal) {
            const blobObj = await base64ToBlob(bData.base64);
            await localDb.blobs.put({
              id: bId,
              type: bData.type || 'thumbnail',
              mimeType: bData.mimeType || blobObj.type || 'image/webp',
              data: blobObj,
              createdAt: bData.createdAt || Date.now()
            });
          }
          // Restore back into LIVE Firestore `users/{uid}/blobs/{bId}` if missing (e.g. deleted along with trade!)
          if (!existingLiveBlobIds.has(bId)) {
            await setDoc(doc(firestore, 'users', user.uid, 'blobs', bId), sanitizeForFirestore({
              ...bData,
              id: bId,
              userId: user.uid,
              updatedAt: Date.now()
            }));
          }
          restoredBlobsCount++;
        }
      }
      notifyBlobsHydrated();
    } catch (bErr) {
      console.warn('[dataService] Error restoring blobs in cloudRestore:', bErr);
    }

    // 5. Replace Local IndexedDB user records with restored snapshot
    await localDb.trades.filter(t => t.userId === user.uid).delete();
    await localDb.tags.filter(t => t.userId === user.uid).delete();
    await localDb.strategies.filter(s => s.userId === user.uid).delete();

    if (finalTrades.length > 0) await localDb.trades.bulkPut(finalTrades as any);
    if (finalTags.length > 0) await localDb.tags.bulkPut(finalTags);
    if (finalStrategies.length > 0) await localDb.strategies.bulkPut(finalStrategies);
    if (finalRules.length > 0) await localDb.rules.bulkPut(finalRules);

    // 6. Push restored snapshot back into LIVE Firestore subcollections & reconcile deletions
    // so reloading / logging out & back in / opening mobile keeps all restored trades intact!
    await Promise.all([
      this.writeDocsInChunks(user.uid, 'trades', finalTrades as any),
      this.writeDocsInChunks(user.uid, 'tags', finalTags as any),
      this.writeDocsInChunks(user.uid, 'strategies', finalStrategies as any),
      this.writeDocsInChunks(user.uid, 'rules', finalRules as any)
    ]);

    await Promise.all([
      this.reconcileCollection(user.uid, 'trades', new Set(finalTrades.map(t => t.id))),
      this.reconcileCollection(user.uid, 'tags', new Set(finalTags.map(t => t.id))),
      this.reconcileCollection(user.uid, 'strategies', new Set(finalStrategies.map(s => s.id))),
      this.reconcileCollection(user.uid, 'rules', new Set(finalRules.map(r => r.id)))
    ]);

    console.log(`[dataService] Cloud restore completed: ${finalTrades.length} trades, ${finalTags.length} tags, ${restoredBlobsCount} blobs`);

    return {
      tradeCount: finalTrades.length,
      tagsCount: finalTags.length,
      strategiesCount: finalStrategies.length,
      rulesCount: finalRules.length,
      blobsCount: restoredBlobsCount,
      updatedAt: backupUpdatedAt
    };
  },

  /**
   * Get latest cloud backup info from isolated snapshot manifest and collections
   */
  async getCloudBackupInfo(user: User | null): Promise<{ 
    updatedAt: number; 
    tradeCount: number;
    tagsCount: number;
    strategiesCount: number;
    blobsCount: number;
  } | null> {
    if (!firestore || !user?.uid) return null;

    try {
      // 1. Check backup manifest doc
      const backupRef = doc(firestore, 'backups', user.uid);
      const snap = await getDoc(backupRef);
      const backupData = snap.exists() ? snap.data() : null;

      // 2. Verify actual isolated backup snapshot counts
      const [bTradesSnap, bTagsSnap, bStratsSnap, bBlobsSnap] = await Promise.all([
        getDocs(collection(firestore, 'users', user.uid, 'backup_trades')),
        getDocs(collection(firestore, 'users', user.uid, 'backup_tags')),
        getDocs(collection(firestore, 'users', user.uid, 'backup_strategies')),
        getDocs(collection(firestore, 'users', user.uid, 'backup_blobs'))
      ]);

      if (bTradesSnap.size > 0 || bTagsSnap.size > 0 || bStratsSnap.size > 0 || (backupData && (backupData.snapshotVersion ?? 0) >= 3)) {
        return {
          updatedAt: backupData?.exportedAt || backupData?.updatedAt || Date.now(),
          tradeCount: bTradesSnap.size || backupData?.tradeCount || 0,
          tagsCount: bTagsSnap.size || backupData?.tagsCount || 0,
          strategiesCount: bStratsSnap.size || backupData?.strategiesCount || 0,
          blobsCount: bBlobsSnap.size || backupData?.blobsCount || 0
        };
      }

      // 3. Legacy fallback before v3 snapshots existed
      const [tradesSnap, tagsSnap, stratSnap, blobsSnap] = await Promise.all([
        getDocs(collection(firestore, 'users', user.uid, 'trades')),
        getDocs(collection(firestore, 'users', user.uid, 'tags')),
        getDocs(collection(firestore, 'users', user.uid, 'strategies')),
        getDocs(collection(firestore, 'users', user.uid, 'blobs'))
      ]);

      const tradeCount = tradesSnap.size || (Array.isArray(backupData?.trades) ? backupData.trades.length : 0);
      const tagsCount = tagsSnap.size || (Array.isArray(backupData?.tags) ? backupData.tags.length : 0);
      const strategiesCount = stratSnap.size || (Array.isArray(backupData?.strategies) ? backupData.strategies.length : 0);
      const blobsCount = blobsSnap.size || 0;

      if (tradeCount > 0 || tagsCount > 0 || strategiesCount > 0) {
        return {
          updatedAt: backupData?.exportedAt || backupData?.updatedAt || Date.now(),
          tradeCount,
          tagsCount,
          strategiesCount,
          blobsCount
        };
      }

      return null;
    } catch (e) {
      console.warn('[dataService] getCloudBackupInfo error:', e);
      return null;
    }
  }
};
