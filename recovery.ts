import { db } from './db';
import { auth, db as firestore } from '../firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { Transaction, Tag, StrategyTemplate, StrategyChecklistItem } from '../types';

export interface RecoveryScanResult {
  source: 'firestore' | 'localstorage' | 'indexeddb_legacy';
  type: 'trades' | 'tags' | 'strategies' | 'rules' | 'settings';
  count: number;
  data: any[];
  lastUpdated?: string;
}

/**
 * Generates a stable hash for an item to help with deduplication
 * when official IDs are missing.
 */
function generateItemHash(item: any, type: string): string {
  if (type === 'trades') {
    const symbol = item.symbol || item.ticker || item.pair || '';
    const date = item.date || item.dateString || (item.createdAt && typeof item.createdAt === 'string' ? item.createdAt.split('T')[0] : '');
    const direction = item.side || item.direction || item.type || '';
    const pnlValue = item.uValue || item.pnl || item.profit || item.loss || '';
    
    const parts = [
      symbol,
      date,
      pnlValue,
      direction,
      (item.screenshots && item.screenshots[0]) || ''
    ];
    return parts.join('|').toLowerCase().trim();
  }
  if (type === 'tags' || type === 'strategies') {
    return (item.name || '').toLowerCase().trim();
  }
  return JSON.stringify(item);
}

/**
 * Scans all possible locations for legacy or missing data
 */
export async function scanForLegacyData(): Promise<RecoveryScanResult[]> {
  const results: RecoveryScanResult[] = [];
  const uid = auth?.currentUser?.uid;

  // 1. Scan Firestore (Cloud) - Deep scan
  if (uid && auth && firestore) {
    try {
      const collections = [
        { path: 'trades', type: 'trades' as const },
        { path: 'transactions', type: 'trades' as const },
        { path: 'tags', type: 'tags' as const },
        { path: 'strategies', type: 'strategies' as const },
        { path: 'rules', type: 'rules' as const },
      ];

      for (const col of collections) {
        // Try both subcollections and top-level collections with userId filter
        const paths = [
          collection(firestore, 'users', uid, col.path),
          query(collection(firestore, col.path), where('userId', '==', uid))
        ];

        for (const q of paths) {
          try {
            const snap = await getDocs(q);
            if (!snap.empty) {
              const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
              // Extract last updated if available
              const lastDoc = snap.docs.reduce((prev, curr) => {
                const prevTime = (prev.data().updatedAt as Timestamp)?.toMillis() || 0;
                const currTime = (curr.data().updatedAt as Timestamp)?.toMillis() || 0;
                return currTime > prevTime ? curr : prev;
              });

              results.push({
                source: 'firestore',
                type: col.type,
                count: snap.size,
                data,
                lastUpdated: (lastDoc.data().updatedAt as Timestamp)?.toDate().toISOString()
              });
            }
          } catch (e) {
            // Ignore individual path failures
          }
        }
      }
    } catch (e) {
      console.warn('[Recovery] Firestore scan partial failure:', e);
    }
  }

  // 2. Scan LocalStorage for ALL keys matching keywords
  try {
    const keywords = ['trade', 'journal', 'trading', 'entry', 'strategy', 'tag', 'backup', 'app_state'];
    const storageKeys = Object.keys(localStorage);
    
    for (const key of storageKeys) {
      const lowerKey = key.toLowerCase();
      if (keywords.some(kw => lowerKey.includes(kw))) {
        try {
          const stored = localStorage.getItem(key);
          if (!stored) continue;
          
          let parsed;
          try {
            parsed = JSON.parse(stored);
          } catch (e) {
            continue; // Skip invalid JSON
          }
          
          const data = Array.isArray(parsed) ? parsed : [parsed];
          
          if (data.length > 0) {
            // Determine type based on content
            let type: RecoveryScanResult['type'] = 'settings';
            if (data[0].symbol || data[0].entryPrice) type = 'trades';
            else if (data[0].name && data[0].color) type = 'tags';
            else if (data[0].name && data[0].steps) type = 'strategies';

            results.push({
              source: 'localstorage',
              type,
              count: data.length,
              data,
              lastUpdated: new Date().toISOString() // LocalStorage doesn't keep metadata
            });
          }
        } catch (e) {
          // Key wasn't JSON, skip
        }
      }
    }
  } catch (e) {}

  // 3. Scan for other IndexedDB Databases
  try {
    if ('databases' in indexedDB) {
      const dbs = await (indexedDB as any).databases();
      const legacyDbNames = ['TradingJourney', 'JournalDB', 'TradingLogs', 'FirebaseLocalStorageDb'];
      
      for (const dbInfo of dbs) {
        if (legacyDbNames.some(name => dbInfo.name.includes(name)) && dbInfo.name !== 'TradingJourneyDB') {
          results.push({
            source: 'indexeddb_legacy',
            type: 'trades', // Simplified assumption for scan summary
            count: 1, // Placeholder
            data: [], 
            lastUpdated: '待開啟'
          });
        }
      }
    }
  } catch (e) {}

  return results;
}

/**
 * Safely migrates found data to the new structure without overwriting
 */
export async function performSafeMigration(items: RecoveryScanResult[]): Promise<{ 
  success: number; 
  skipped: number; 
  failed: number;
  details: { type: string; count: number; source: string }[] 
}> {
  console.log(`[Recovery] Import started. Selected sources count: ${items.length}`);
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const details: { type: string; count: number; source: string }[] = [];

  // Normalize timestamps for migration
  const normalizeTime = (raw: any) => {
    if (!raw) return Date.now();
    if (typeof raw === 'number') return raw;
    if (raw instanceof Timestamp) return raw.toMillis();
    if (raw && typeof raw === 'object' && 'seconds' in raw) return raw.seconds * 1000;
    const parsed = new Date(raw).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  };

  for (const batch of items) {
    console.log(`[Recovery] Importing source: ${batch.source} | type: ${batch.type} | records: ${batch.count}`);
    if (batch.data && batch.data.length > 0) {
      console.log(`[Recovery] First record sample from ${batch.source}:`, batch.data[0]);
    }

    try {
      if (batch.type === 'trades') {
        const currentTrades = await db.trades.toArray();
        const existingHashes = new Set(currentTrades.map(t => generateItemHash(t, 'trades')));
        
        const toAdd = [];
        for (const t of batch.data) {
          const hash = generateItemHash(t, 'trades');
          
          // Skip if record is effectively empty to prevent junk
          if (hash.replace(/\|/g, '').length === 0) {
            skipped++;
            continue;
          }

          if (existingHashes.has(hash)) {
            skipped++;
            continue;
          }

          console.log(`[Recovery] Mapping trade: ${t.symbol || t.ticker || '??'} | Date: ${t.date || t.dateString || '??'}`);
          
          toAdd.push({
            id: t.id || crypto.randomUUID(),
            userId: auth.currentUser?.uid || t.userId || 'local',
            symbol: (t.symbol || t.ticker || t.pair || 'UNKNOWN').toUpperCase(),
            date: t.date || t.dateString || (t.createdAt && typeof t.createdAt === 'string' ? t.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
            uValue: Number(t.uValue || t.pnl || t.profit || t.loss || 0),
            side: (t.side || t.direction || t.type || 'Long') as any,
            result: (t.result || t.outcome || t.status || 'Open') as any,
            rating: (t.rating || 'B') as any,
            tagIds: Array.isArray(t.tagIds) ? t.tagIds : [],
            screenshots: Array.isArray(t.screenshots) ? t.screenshots : [],
            stopLossReason: t.stopLossReason || '',
            entryReason: t.entryReason || t.reason || '',
            review: (t.review || t.notes || t.comment || ''),
            localOnly: 1, // Store as number for sync service compatibility
            createdAt: normalizeTime(t.createdAt),
            updatedAt: normalizeTime(t.updatedAt),
          });
          existingHashes.add(hash);
        }
        
        if (toAdd.length > 0) {
          console.log(`[Recovery] Writing ${toAdd.length} trades to main DB (deduped from ${batch.data.length})`);
          await db.trades.bulkPut(toAdd);
          success += toAdd.length;
          details.push({ type: 'trades', count: toAdd.length, source: batch.source });
        } else {
          console.log(`[Recovery] All trades in this batch were duplicates.`);
        }
      } else if (batch.type === 'tags') {
        const currentTags = await db.tags.toArray();
        const existingHashes = new Set(currentTags.map(t => generateItemHash(t, 'tags')));
        
        const tagsToAdd = [];
        for (const t of batch.data) {
          const hash = generateItemHash(t, 'tags');
          if (existingHashes.has(hash)) {
            skipped++;
            continue;
          }
          tagsToAdd.push({
            id: t.id || crypto.randomUUID(),
            userId: auth.currentUser?.uid || t.userId || 'local',
            name: t.name || 'Unnamed',
            color: t.color || '#888888'
          });
          existingHashes.add(hash);
        }

        if (tagsToAdd.length > 0) {
          await db.tags.bulkPut(tagsToAdd);
          success += tagsToAdd.length;
          details.push({ type: 'tags', count: tagsToAdd.length, source: batch.source });
        }
      } else if (batch.type === 'strategies') {
        const currentStrategies = await db.strategies.toArray();
        const existingHashes = new Set(currentStrategies.map(s => generateItemHash(s, 'strategies')));
        
        const strToAdd = [];
        for (const s of batch.data) {
          const hash = generateItemHash(s, 'strategies');
          if (!hash || existingHashes.has(hash)) {
            skipped++;
            continue;
          }
          strToAdd.push({
            id: s.id || crypto.randomUUID(),
            userId: auth.currentUser?.uid || s.userId || 'local',
            name: s.name || 'Unnamed Strategy',
            description: s.description || '',
            steps: Array.isArray(s.steps) ? s.steps : [],
            isFavorite: !!s.isFavorite,
            createdAt: normalizeTime(s.createdAt),
            updatedAt: normalizeTime(s.updatedAt)
          });
          existingHashes.add(hash);
        }

        if (strToAdd.length > 0) {
          await db.strategies.bulkPut(strToAdd);
          success += strToAdd.length;
          details.push({ type: 'strategies', count: strToAdd.length, source: batch.source });
        }
      } else if (batch.type === 'rules') {
        const currentRules = await db.rules.toArray();
        const existingIds = new Set(currentRules.map(r => r.id));
        
        const rulesToAdd = batch.data.filter(r => !existingIds.has(r.id)).map(r => ({
          id: r.id || crypto.randomUUID(),
          templateId: r.templateId || 'legacy-recovery',
          text: r.text || 'Imported Rule',
          weight: Number(r.weight) || 1,
          required: !!r.required,
          sortOrder: Number(r.sortOrder) || 0,
          active: r.active !== undefined ? !!r.active : true,
          createdAt: normalizeTime(r.createdAt),
          updatedAt: normalizeTime(r.updatedAt)
        }));

        if (rulesToAdd.length > 0) {
          await db.rules.bulkPut(rulesToAdd);
          success += rulesToAdd.length;
          details.push({ type: 'rules', count: rulesToAdd.length, source: batch.source });
        } else {
          skipped += batch.data.length;
        }
      } else if (batch.type === 'settings') {
        // For settings, we just take the first one if found
        if (batch.data.length > 0) {
          const s = batch.data[0];
          const current = localStorage.getItem('trading_journey_user_settings');
          if (!current) {
            localStorage.setItem('trading_journey_user_settings', JSON.stringify(s));
            success++;
            details.push({ type: 'settings', count: 1, source: batch.source });
          } else {
            skipped++;
          }
        }
      }
    } catch (e) {
      console.error(`[Recovery] Migration failed for ${batch.source} ${batch.type}:`, e);
      failed += batch.count;
    }
  }

  console.log(`[Recovery] Import completed. Success: ${success}, Skipped: ${skipped}, Failed: ${failed}`);
  return { success, skipped, failed, details };
}
