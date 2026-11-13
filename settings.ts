import { auth, db as firestore } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface UserSettings {
  autoBackup: boolean;
  initialCapital: number;
  disciplineMode: 'relaxed' | 'semi' | 'strict';
  theme: 'dark' | 'light';
  lastSyncAt?: string;
  autoBackupEnabledAt?: string;
}

const SETTINGS_KEY = 'trading_journey_user_settings';

const DEFAULT_SETTINGS: UserSettings = {
  autoBackup: false,
  initialCapital: 0,
  disciplineMode: 'semi',
  theme: 'dark',
};

export const settingsStore = {
  get(): UserSettings {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    try {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      console.error('[Settings] Failed to parse stored settings:', e);
      return DEFAULT_SETTINGS;
    }
  },

  set(settings: Partial<UserSettings>) {
    const current = this.get();
    const updated = { ...current, ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('trading-settings-updated', { detail: updated }));
    }
    return updated;
  },

  async syncToCloud() {
    if (!auth || !firestore) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const settings = this.get();
    try {
      await setDoc(doc(firestore, 'users', uid), {
        settings,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.error('[Settings] Cloud sync failed:', e);
    }
  },

  async fetchFromCloud() {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;

    try {
      const snap = await getDoc(doc(firestore, 'users', uid));
      if (snap.exists() && snap.data().settings) {
        const cloudSettings = snap.data().settings;
        this.set(cloudSettings);
        return cloudSettings;
      }
    } catch (e) {
      console.error('[Settings] Cloud fetch failed:', e);
    }
    return null;
  }
};
