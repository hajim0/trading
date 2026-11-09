import { db as localDb, saveBlob, blobToBase64, base64ToBlob, LocalBlob } from './db';
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
   * Save or update a trade in both Local IndexedDB and Cloud Firestore
   */
  async saveTrade(trade: Transaction, user: User | null): Promise<void> {
    const cleanTrade = sanitizeForFirestore({
      ...trade,
      userId: user ? user.uid : (trade.userId || 'local-user'),
      updatedAt: Date.now()
    });

    // 1. Save to Local IndexedDB
    await localDb.trades.put(cleanTrade);

    // 2. If logged in, save to Cloud Firestore
    if (user && firestore) {
      try {
        const tradeRef = doc(firestore, 'users', user.uid, 'trades', trade.id);
        await setDoc(tradeRef, cleanTrade);
      } catch (err) {
        console.error('[dataService] Failed to sync trade to Firestore:', err);
        throw err;
      }
    }
  },

  /**
   * Delete a trade from both Local IndexedDB and Cloud Firestore
   */
  async deleteTrade(id: string, user: User | null): Promise<void> {
    // 1. Delete associated blobs
    const trade = await localDb.trades.get(id);
    if (trade?.imageOriginalId) {
      await localDb.blobs.delete(trade.imageOriginalId).catch(() => {});
    }
    if (trade?.imageThumbnailId) {
      await localDb.blobs.delete(trade.imageThumbnailId).catch(() => {});
    }

    // 2. Delete from Local IndexedDB
    await localDb.trades.delete(id);

    // 3. If logged in, delete from Cloud Firestore
    if (user && firestore) {
      try {
        const tradeRef = doc(firestore, 'users', user.uid, 'trades', id);
        await deleteDoc(tradeRef);
      } catch (err) {
        console.error('[dataService] Failed to delete trade from Firestore:', err);
      }
    }
  },

  /**
   * Bulk delete trades from both Local IndexedDB and Cloud Firestore
   */
  async bulkDeleteTrades(ids: string[], user: User | null): Promise<void> {
    if (!ids || ids.length === 0) return;

    // 1. Delete from local database and blobs
    for (const id of ids) {
      const trade = await localDb.trades.get(id);
      if (trade?.imageOriginalId) {
        await localDb.blobs.delete(trade.imageOriginalId).catch(() => {});
      }
      if (trade?.imageThumbnailId) {
        await localDb.blobs.delete(trade.imageThumbnailId).catch(() => {});
      }
      await localDb.trades.delete(id);
    }

    // 2. If logged in, batch delete from Cloud Firestore
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
      } catch (err) {
        console.error('[dataService] Failed to bulk delete from Firestore:', err);
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

      // Hydrate into local IndexedDB
      if (cloudTrades.length > 0) {
        await localDb.trades.bulkPut(cloudTrades);
      }
      if (cloudTags.length > 0) {
        await localDb.tags.bulkPut(cloudTags);
      }
      if (cloudStrats.length > 0) {
        await localDb.strategies.bulkPut(cloudStrats);
      }
      if (cloudRules.length > 0) {
        await localDb.rules.bulkPut(cloudRules);
      }

      // Check if local DB has trades for this user that are not yet in Firestore
      const localUserTrades = await localDb.trades
        .filter(t => t.userId === user.uid && !t.deleted)
        .toArray();

      if (localUserTrades.length > 0 && cloudTrades.length === 0) {
        console.log(`[dataService] Cloud trades empty, syncing ${localUserTrades.length} local trades up to Firestore...`);
        for (const t of localUserTrades) {
          const tradeRef = doc(firestore, 'users', user.uid, 'trades', t.id);
          await setDoc(tradeRef, sanitizeForFirestore(t));
        }
      }

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
        for (const t of backupTrades) {
          await setDoc(doc(firestore, 'users', currentUser.uid, 'trades', t.id), sanitizeForFirestore(t));
        }
        for (const tg of backupTags) {
          await setDoc(doc(firestore, 'users', currentUser.uid, 'tags', tg.id), sanitizeForFirestore(tg));
        }
        for (const s of backupStrategies) {
          await setDoc(doc(firestore, 'users', currentUser.uid, 'strategies', s.id), sanitizeForFirestore(s));
        }
        for (const r of backupRules) {
          await setDoc(doc(firestore, 'users', currentUser.uid, 'rules', r.id), sanitizeForFirestore(r));
        }
      } catch (err) {
        console.error('[dataService] Failed to push imported records to Firestore:', err);
      }
    }

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
   * One-click Cloud Backup (saves metadata and records to users/{userId} subcollections and backup summary)
   */
  async cloudBackup(user: User): Promise<{ 
    tradeCount: number; 
    tagsCount: number; 
    strategiesCount: number; 
    rulesCount: number; 
    updatedAt: number 
  }> {
    if (!firestore || !user?.uid) {
      throw new Error('未登入或 Firebase 未連線，無法執行雲端備份');
    }

    console.log(`[dataService] Starting comprehensive cloud backup for user ${user.uid}...`);

    // 1. Fetch fresh local records for this user
    const trades = await localDb.trades
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

    // 2. Batch write trades to users/{user.uid}/trades in chunks of 400
    const CHUNK_SIZE = 400;
    for (let i = 0; i < trades.length; i += CHUNK_SIZE) {
      const chunk = trades.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const t of chunk) {
        const tradeRef = doc(firestore, 'users', user.uid, 'trades', t.id);
        batch.set(tradeRef, sanitizeForFirestore({
          ...t,
          userId: user.uid,
          updatedAt: t.updatedAt || now
        }));
      }
      await batch.commit();
    }

    // Batch write tags
    for (let i = 0; i < tags.length; i += CHUNK_SIZE) {
      const chunk = tags.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const tg of chunk) {
        const tagRef = doc(firestore, 'users', user.uid, 'tags', tg.id);
        batch.set(tagRef, sanitizeForFirestore({
          ...tg,
          userId: user.uid,
          updatedAt: tg.updatedAt || now
        }));
      }
      await batch.commit();
    }

    // Batch write strategies
    for (let i = 0; i < strategies.length; i += CHUNK_SIZE) {
      const chunk = strategies.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const s of chunk) {
        const stratRef = doc(firestore, 'users', user.uid, 'strategies', s.id);
        batch.set(stratRef, sanitizeForFirestore({
          ...s,
          userId: user.uid,
          updatedAt: s.updatedAt || now
        }));
      }
      await batch.commit();
    }

    // Batch write rules
    for (let i = 0; i < rules.length; i += CHUNK_SIZE) {
      const chunk = rules.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(firestore);
      for (const r of chunk) {
        const ruleRef = doc(firestore, 'users', user.uid, 'rules', r.id);
        batch.set(ruleRef, sanitizeForFirestore({
          ...r,
          updatedAt: r.updatedAt || now
        }));
      }
      await batch.commit();
    }

    // 3. Write summary cloud backup doc (with metadata and settings)
    const backupSummary = sanitizeForFirestore({
      version: 2,
      exportedAt: now,
      updatedAt: now,
      userId: user.uid,
      userEmail: user.email || '',
      tradeCount: trades.length,
      tagsCount: tags.length,
      strategiesCount: strategies.length,
      rulesCount: rules.length,
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

    console.log(`[dataService] Cloud backup complete: ${trades.length} trades, ${tags.length} tags, ${strategies.length} strategies`);

    return {
      tradeCount: trades.length,
      tagsCount: tags.length,
      strategiesCount: strategies.length,
      rulesCount: rules.length,
      updatedAt: now
    };
  },

  /**
   * One-click Cloud Restore (combines live subcollections and backup snapshot)
   */
  async cloudRestore(user: User): Promise<{ 
    tradeCount: number; 
    tagsCount: number; 
    strategiesCount: number; 
    rulesCount: number; 
    updatedAt: number 
  }> {
    if (!firestore || !user?.uid) {
      throw new Error('未登入或 Firebase 未連線，無法執行雲端還原');
    }

    console.log(`[dataService] Starting comprehensive cloud restore for user ${user.uid}...`);

    // 1. Fetch live subcollections from Firestore
    // Trades
    const tradesCol = collection(firestore, 'users', user.uid, 'trades');
    const tradesSnap = await getDocs(tradesCol);
    const cloudTradesMap = new Map<string, Transaction>();
    tradesSnap.forEach(d => {
      const data = d.data() as Transaction;
      if (data && data.id) {
        cloudTradesMap.set(data.id, { ...data, userId: user.uid });
      }
    });

    // Tags
    const tagsCol = collection(firestore, 'users', user.uid, 'tags');
    const tagsSnap = await getDocs(tagsCol);
    const cloudTagsMap = new Map<string, Tag>();
    tagsSnap.forEach(d => {
      const data = d.data() as Tag;
      if (data && data.id) {
        cloudTagsMap.set(data.id, { ...data, userId: user.uid });
      }
    });

    // Strategies
    const stratCol = collection(firestore, 'users', user.uid, 'strategies');
    const stratSnap = await getDocs(stratCol);
    const cloudStratsMap = new Map<string, StrategyTemplate>();
    stratSnap.forEach(d => {
      const data = d.data() as StrategyTemplate;
      if (data && data.id) {
        cloudStratsMap.set(data.id, { ...data, userId: user.uid });
      }
    });

    // Rules
    const rulesCol = collection(firestore, 'users', user.uid, 'rules');
    const rulesSnap = await getDocs(rulesCol);
    const cloudRulesMap = new Map<string, StrategyChecklistItem>();
    rulesSnap.forEach(d => {
      const data = d.data() as StrategyChecklistItem;
      if (data && data.id) {
        cloudRulesMap.set(data.id, data);
      }
    });

    // 2. Also check backups/{userId} document for snapshot/settings
    const backupRef = doc(firestore, 'backups', user.uid);
    let backupUpdatedAt = Date.now();

    try {
      const backupSnap = await getDoc(backupRef);
      if (backupSnap.exists()) {
        const backupData = backupSnap.data();
        backupUpdatedAt = backupData.exportedAt || backupData.updatedAt || Date.now();

        // If backup doc contains embedded trades array, merge any that might be missing from subcollection
        if (Array.isArray(backupData.trades)) {
          for (const t of backupData.trades) {
            if (t && t.id && !cloudTradesMap.has(t.id)) {
              cloudTradesMap.set(t.id, { ...t, userId: user.uid });
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
        if (backupData.settings) {
          settingsStore.set(backupData.settings);
        }
      }
    } catch (e) {
      console.warn('[dataService] Optional backup summary doc fetch error (continuing with subcollections):', e);
    }

    const finalTrades = Array.from(cloudTradesMap.values());
    const finalTags = Array.from(cloudTagsMap.values());
    const finalStrategies = Array.from(cloudStratsMap.values());
    const finalRules = Array.from(cloudRulesMap.values());

    // Check if there is anything in cloud
    if (finalTrades.length === 0 && finalTags.length === 0 && finalStrategies.length === 0) {
      throw new Error('雲端目前尚無備份紀錄。請先於有資料的裝置點擊「備份到個人雲端」。');
    }

    // 3. Clear existing local user records and replace with fresh cloud records
    await localDb.trades.filter(t => t.userId === user.uid).delete();
    await localDb.tags.filter(t => t.userId === user.uid).delete();
    await localDb.strategies.filter(s => s.userId === user.uid).delete();

    // Bulk put restored items
    if (finalTrades.length > 0) {
      await localDb.trades.bulkPut(finalTrades);
    }
    if (finalTags.length > 0) {
      await localDb.tags.bulkPut(finalTags);
    }
    if (finalStrategies.length > 0) {
      await localDb.strategies.bulkPut(finalStrategies);
    }
    if (finalRules.length > 0) {
      await localDb.rules.bulkPut(finalRules);
    }

    console.log(`[dataService] Cloud restore completed: ${finalTrades.length} trades, ${finalTags.length} tags, ${finalStrategies.length} strategies`);

    return {
      tradeCount: finalTrades.length,
      tagsCount: finalTags.length,
      strategiesCount: finalStrategies.length,
      rulesCount: finalRules.length,
      updatedAt: backupUpdatedAt
    };
  },

  /**
   * Get latest cloud backup info
   */
  async getCloudBackupInfo(user: User | null): Promise<{ 
    updatedAt: number; 
    tradeCount: number;
    tagsCount: number;
    strategiesCount: number;
  } | null> {
    if (!firestore || !user?.uid) return null;

    try {
      // 1. Check backup doc
      const backupRef = doc(firestore, 'backups', user.uid);
      const snap = await getDoc(backupRef);
      let backupData = snap.exists() ? snap.data() : null;

      // 2. Check live subcollections count
      const tradesCol = collection(firestore, 'users', user.uid, 'trades');
      const tradesSnap = await getDocs(tradesCol);

      const tagsCol = collection(firestore, 'users', user.uid, 'tags');
      const tagsSnap = await getDocs(tagsCol);

      const stratCol = collection(firestore, 'users', user.uid, 'strategies');
      const stratSnap = await getDocs(stratCol);

      const tradeCount = Math.max(backupData?.tradeCount ?? 0, tradesSnap.size);
      const tagsCount = Math.max(backupData?.tagsCount ?? 0, tagsSnap.size);
      const strategiesCount = Math.max(backupData?.strategiesCount ?? 0, stratSnap.size);

      if (tradeCount > 0 || tagsCount > 0 || strategiesCount > 0 || backupData) {
        return {
          updatedAt: backupData?.exportedAt || backupData?.updatedAt || Date.now(),
          tradeCount,
          tagsCount,
          strategiesCount
        };
      }

      return null;
    } catch (e) {
      console.warn('[dataService] getCloudBackupInfo error:', e);
      return null;
    }
  }
};
