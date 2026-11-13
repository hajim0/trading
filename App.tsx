import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Transaction, TradeStats, Tag, UserProfile, Plan, StrategyTemplate, StrategyChecklistItem, DisciplineMode, DisciplineGrades } from './types';
import { auth, googleProvider, signInWithPopup, signOut, db, OperationType, handleFirestoreError } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot, query, orderBy, deleteDoc, serverTimestamp, Timestamp, writeBatch, getCountFromServer, where } from 'firebase/firestore';
import { EquityChart } from './components/EquityChart';
import { StatsOverview } from './components/StatsOverview';
import { TransactionList } from './components/TransactionList';
import { TransactionForm } from './components/TransactionForm';
import { TransactionDetail } from './components/TransactionDetail';
import { ProfitCalendar } from './components/ProfitCalendar';
import { TagAnalysis } from './components/TagAnalysis';
import { DisciplineAnalysis } from './components/DisciplineAnalysis';
import { TagManagement } from './components/TagManagement';
import { StrategyManagement } from './components/StrategyManagement';
import { Paywall } from './components/Paywall';
import { getFeatureAccess, ENABLE_PREMIUM_BETA } from './lib/permissions';
import { FloatingActionButton } from './components/FloatingActionButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { db as localDb, revokeBlobUrl, clearBlobUrlCache } from './lib/db';
import { dataService } from './lib/dataService';
import { useLiveQuery } from 'dexie-react-hooks';
import { DataManagement } from './components/BackupCenter';
import { Plus, LayoutDashboard, History, Settings, LogOut, Menu, X, Moon, Sun, BarChart2, Tags, Wifi, RefreshCw, ShieldAlert, Lock, Zap, Download, CloudUpload, Database as DatabaseIcon, LifeBuoy, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { settingsStore } from './lib/settings';
import { syncService } from './lib/sync';
import { scanForLegacyData, performSafeMigration, RecoveryScanResult } from './lib/recovery';
import { cn, calculateTradeStats, calculateGrade, calculateDisciplineScore, calculatePassedRequired } from '@/lib/utils';
import { Toaster, toast } from 'sonner';
import { logger } from './lib/logger';
import { Card, CardContent } from '@/components/ui/card';

type View = 'dashboard' | 'list' | 'add' | 'edit' | 'detail' | 'analysis' | 'tags' | 'settings' | 'strategies' | 'backup';

// --- Helper Components ---
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
    <path d="M3.964 10.711c-.18-.54-.282-1.117-.282-1.711 0-.594.102-1.17.282-1.711V4.957H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.043l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.957l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

const NavItem = ({ icon: Icon, label, active, locked, onClick }: any) => (
  <button
    onClick={onClick}
    disabled={locked}
    className={cn(
      "w-full h-[48px] flex items-center gap-3 px-[14px] rounded-[14px] transition-all duration-200 relative group select-none",
      active 
        ? "bg-accent text-accent-foreground font-bold shadow-sm" 
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      locked && "opacity-50 cursor-not-allowed"
    )}
  >
    {active && (
      <motion.div 
        layoutId="activeNavIndicator"
        className="absolute left-0 w-[3px] h-6 bg-primary rounded-full"
      />
    )}
    <div className={cn(
      "shrink-0 transition-all duration-200",
      active ? "scale-105 text-primary" : "group-hover:scale-105"
    )}>
      <Icon size={19} strokeWidth={active ? 2.5 : 2} />
    </div>
    <span className="text-[13px] tracking-tight font-medium truncate">{label}</span>
    {locked && !ENABLE_PREMIUM_BETA && <Lock size={12} className="ml-auto opacity-50 shrink-0" />}
  </button>
);

export default function App() {
  // --- Auth & Profile State ---
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    return localStorage.getItem('guest_mode') === 'true';
  });
  const effectiveUserId = user?.uid || (isGuestMode ? 'local-user' : null);
  const isEffectiveLoggedIn = Boolean(user || isGuestMode);

  // --- Local-First Data with Strict User Isolation ---
  const rawTransactions = useLiveQuery(
    () => {
      if (!effectiveUserId) return [];
      return localDb.trades.filter(t => t.userId === effectiveUserId && !t.deleted).toArray();
    },
    [effectiveUserId]
  );
  const transactions = Array.isArray(rawTransactions) ? rawTransactions : [];
  
  const rawTags = useLiveQuery(
    () => {
      if (!effectiveUserId) return [];
      return localDb.tags.filter(t => t.userId === effectiveUserId && !t.deleted).toArray();
    },
    [effectiveUserId]
  );
  const tags = Array.isArray(rawTags) ? rawTags : [];
  
  const rawStrategies = useLiveQuery(
    () => {
      if (!effectiveUserId) return [];
      return localDb.strategies.filter(s => s.userId === effectiveUserId && !s.deleted).toArray();
    },
    [effectiveUserId]
  );
  const strategies = Array.isArray(rawStrategies) ? rawStrategies : [];
  
  const rawChecklistItems = useLiveQuery(
    () => localDb.rules.filter(t => !t.deleted).toArray()
  );
  const checklistItems = Array.isArray(rawChecklistItems) ? rawChecklistItems : [];

  // --- App State ---
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [disciplineMode, setDisciplineMode] = useState<DisciplineMode>('semi');
  const [disciplineGrades, setDisciplineGrades] = useState<DisciplineGrades>({ S: 90, A: 80, B: 70 });
  const [tempGrades, setTempGrades] = useState<DisciplineGrades>({ S: 90, A: 80, B: 70 });
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [initialCapital, setInitialCapital] = useState<number | null>(null);
  const [localSettingsCapital, setLocalSettingsCapital] = useState<string>('10000');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const deleteTimers = useRef<Record<string, any>>({});
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [legacyResults, setLegacyResults] = useState<RecoveryScanResult[]>([]);
  const [showLegacyBanner, setShowLegacyBanner] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // --- Debug Assistant ---
  const DebugPanel = () => {
    // Disabled for Safe Boot as requested
    return null;
  };

  // --- Initialize & Sync Settings ---
  useEffect(() => {
    const applySettings = (s: ReturnType<typeof settingsStore.get>) => {
      setInitialCapital(s.initialCapital);
      setDisciplineMode(s.disciplineMode);
      setTheme(s.theme);
      setLocalSettingsCapital(String(s.initialCapital || '10000'));
    };

    applySettings(settingsStore.get());
    setDisciplineGrades({ S: 90, A: 80, B: 70 }); // Default

    const handleSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        applySettings(customEvent.detail);
      } else {
        applySettings(settingsStore.get());
      }
    };

    window.addEventListener('trading-settings-updated', handleSettingsUpdated);
    return () => window.removeEventListener('trading-settings-updated', handleSettingsUpdated);
  }, []);

  /**
   * Automatic Startup Scan (Delayed)
   */
  useEffect(() => {
    // Delay non-essential startup tasks
    const timer = setTimeout(() => {
      const runScan = async () => {
        try {
          const results = await scanForLegacyData();
          if (results && results.length > 0) {
            setLegacyResults(results);
            setShowLegacyBanner(true);
          }
        } catch (e: any) {
          console.warn('[Recovery] Auto-scan failed (silent skip):', e);
        }
      };
      if (user) runScan();
    }, 5000);
    return () => clearTimeout(timer);
  }, [user]);

  // --- Refs for cleanup ---
  const unsubscribes = React.useRef<(() => void)[]>([]);
  const itemUnsubscribes = React.useRef<Record<string, () => void>>({});
  const prevView = React.useRef<View>('dashboard');

  useEffect(() => {
    prevView.current = currentView;
  }, [currentView]);

  const cleanupListeners = () => {
    if (unsubscribes.current.length > 0) {
      console.log(`[Perf] old listeners cleaned: ${unsubscribes.current.length}`);
      unsubscribes.current.forEach(unsub => unsub());
      unsubscribes.current = [];
    }
    (Object.values(itemUnsubscribes.current) as (() => void)[]).forEach(unsub => unsub());
    itemUnsubscribes.current = {};
  };

  const resetAppState = () => {
    console.log('[Auth] Resetting app state for clean context');
    setUserProfile(null);
    setSelectedTransaction(null);
    setInitialCapital(null);
    setIsProfileLoading(true);
    setCurrentView('dashboard');
  };

  
  const [initTime, setInitTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setInitTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const showLoadingTimeout = initTime > 8;

  const handleEnterGuestMode = () => {
    setIsGuestMode(true);
    setIsAuthLoading(false);
    setIsProfileLoading(false);
    localStorage.setItem('guest_mode', 'true');
    toast.success('已切換至本地離線模式');
  };

  const handleForceStart = () => {
    handleEnterGuestMode();
  };

  const handleEmergencyReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  // --- Feature Gating ---
  const features = getFeatureAccess(userProfile, import.meta.env);
  
  // --- Version Check & Cache Invalidation ---
  useEffect(() => {
    const APP_VERSION = '2026.05.17.v1';
    const lastVersion = localStorage.getItem('app_version');
    if (lastVersion !== APP_VERSION) {
      console.log(`[Version] New version detected: ${APP_VERSION}. Cleaning caches...`);
      localStorage.setItem('app_version', APP_VERSION);
      // Optional: window.location.reload() if we want to force cleanup on first hit
    }
  }, []);

  // --- App Start Mechanism ---
  useEffect(() => {
    try {
      if (!auth || !db) {
        console.warn('[App] Firebase components missing, running in local-only mode.');
        // Don't throw, just log.
      } else {
        console.log('[App] Core system boot initialized.');
      }
    } catch (e: any) {
      console.error('[App] Initialization warning:', e);
    }
  }, []);

  // Load user profile and initial capital
  useEffect(() => {
    // Already handled by onSnapshot in auth listener to avoid redundancy/overwriting
  }, [userProfile]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Detect iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // Check if already installed
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setIsStandalone(standalone);
    
    if (standalone) {
      setIsInstallable(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  useEffect(() => {
    if (!auth) {
      console.warn('[Auth] Auth system is not available, running in offline-only mode.');
      setIsAuthLoading(false);
      return;
    }

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      console.log('[Auth] current uid:', u?.uid || 'Logged out');
      
      // 1. Always cleanup old listeners and reset state first
      cleanupListeners();
      resetAppState();

      if (!u) {
        setUser(null);
        setIsAuthLoading(false);
        setIsProfileLoading(false);
        setIsSwitching(false);
        return;
      }

      setUser(u);
      
      try {
        if (!db) {
          console.warn('[Firestore] DB not available, running profile in local cache mode');
          setIsProfileLoading(false);
          return;
        }

        // Setup real-time sync for User Profile
        const profileRef = doc(db, 'users', u.uid);
        const unsubProfile = onSnapshot(profileRef, (snapshot) => {
          if (snapshot.exists()) {
            const updatedData = snapshot.data() as UserProfile;
            setUserProfile(updatedData);
            
            // Rule: Firestore is source of truth.
            if (updatedData.initialCapital !== undefined) {
              setInitialCapital(updatedData.initialCapital);
              // Only update settings input if it's NOT focused to avoid cursor jumps
              // Actually we will use force sync for settings input only on first load or when saved
              setLocalSettingsCapital(updatedData.initialCapital.toString());
              localStorage.setItem(`initial_capital_${u.uid}`, updatedData.initialCapital.toString());
            }
            
            if (updatedData.disciplineMode) {
              setDisciplineMode(updatedData.disciplineMode);
            }
            if (updatedData.disciplineGrades) {
              setDisciplineGrades(updatedData.disciplineGrades);
              setTempGrades(updatedData.disciplineGrades);
            } else {
              setTempGrades({ S: 90, A: 80, B: 70 });
            }
          } else {
            // Profile doesn't exist, create it once
            const savedFallback = localStorage.getItem(`initial_capital_${u.uid}`);
            const initialCap = savedFallback ? parseFloat(savedFallback) : 10000;
            
            const profileData: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              photoURL: u.photoURL || '',
              initialCapital: initialCap,
              plan: 'free',
              role: 'user',
              disciplineMode: 'semi',
              disciplineGrades: { S: 90, A: 80, B: 70 },
              createdAt: serverTimestamp() as any,
              updatedAt: serverTimestamp() as any,
            };
            setDoc(profileRef, profileData);
            setInitialCapital(initialCap);
            setLocalSettingsCapital(initialCap.toString());
          }
          setIsProfileLoading(false);
          setIsAuthLoading(false);
          setIsSwitching(false);
        }, (error) => {
          console.error("Profile listen error:", error);
          setIsProfileLoading(false);
          setIsAuthLoading(false);
        });
        unsubscribes.current.push(unsubProfile);

        // Hydrate all user trades, tags, strategies and rules from Cloud Firestore
        dataService.syncUserFromCloud(u).then(syncStats => {
          console.log('[Auth] Successfully hydrated data from Cloud Firestore:', syncStats);
        }).catch(err => {
          console.warn('[Auth] Cloud sync notice:', err);
        });

      } catch (error) {
        console.error('[Auth] Error during initialization:', error);
      } finally {
        setIsAuthLoading(false);
      }
    });

    return () => {
      unsubAuth();
      cleanupListeners();
    };
  }, []);

  useEffect(() => {
    // SyncAll is no longer needed as we use onSnapshot
  }, [isOnline, user]);

  const displayTransactions = useMemo(() => 
    (Array.isArray(transactions) ? transactions : []).filter(t => t && !pendingDeleteIds.has(t.id)), 
  [transactions, pendingDeleteIds]);

  const stats = useMemo<TradeStats>(() => {
    try {
      logger.log('[Perf] stats recalculated');
      const safeTransactions = Array.isArray(displayTransactions) ? displayTransactions : [];
      return calculateTradeStats(safeTransactions, initialCapital ?? 10000);
    } catch (e) {
      console.error('[Stats] Error calculating stats:', e);
      return calculateTradeStats([], initialCapital ?? 10000); // Fallback
    }
  }, [displayTransactions, initialCapital]);

  const handleAddGlobalTag = useCallback(async (name: string): Promise<Tag> => {
    if (!effectiveUserId) {
      throw new Error('User not logged in');
    }
    
    const normalized = name.trim();
    const existing = tags.find(t => t.name.toLowerCase() === normalized.toLowerCase());
    if (existing) return existing;

    const tagId = crypto.randomUUID();
    try {
      const tagData: Tag = {
        id: tagId,
        userId: effectiveUserId,
        name: normalized,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await dataService.saveTag(tagData, user);
      return tagData;
    } catch (error) {
      console.error('Save tag failed:', error);
      throw error;
    }
  }, [effectiveUserId, tags, user]);

  const handleRenameTag = useCallback(async (id: string, newName: string) => {
    if (!effectiveUserId || !features.canUseTagManagement) return;
    try {
      const tag = tags.find(t => t.id === id);
      if (tag) {
        await dataService.saveTag({ ...tag, name: newName, updatedAt: Date.now() }, user);
      }
    } catch (error) {
      console.error('Rename tag failed:', error);
    }
  }, [effectiveUserId, features.canUseTagManagement, tags, user]);

  const syncTagsToTrades = useCallback(async (
    targetTransactions: Transaction[],
    currentTags: Tag[]
  ) => {
    if (!effectiveUserId || targetTransactions.length === 0) return;

    const activeTagIds = new Set(currentTags.filter(t => !t.deleted).map(t => t.id));

    const tradesToUpdate = targetTransactions.filter(tx => {
      if (!tx.tagIds || tx.tagIds.length === 0) return false;
      const cleaned = tx.tagIds.filter(id => activeTagIds.has(id));
      return cleaned.length !== tx.tagIds.length;
    });

    if (tradesToUpdate.length === 0) return;

    const toastId = toast.loading(`正在同步 ${tradesToUpdate.length} 筆交易標籤...`);
    
    for (const tx of tradesToUpdate) {
      const cleaned = tx.tagIds.filter(id => activeTagIds.has(id));
      const updatedTx = { ...tx, tagIds: cleaned, updatedAt: Date.now() };
      await dataService.saveTrade(updatedTx, user);
    }
    
    toast.success('標籤同步完成', { id: toastId });
  }, [effectiveUserId, user]);

  const handleDeleteTag = useCallback(async (id: string) => {
    if (!effectiveUserId || !features.canUseTagManagement) return;
    const toastId = toast.loading('正在刪除標籤...');
    try {
      await dataService.deleteTag(id, user);
      
      const remainingTags = tags.filter(t => t.id !== id);
      await syncTagsToTrades(transactions, remainingTags);
      
      toast.success('標籤已移除', { id: toastId });
    } catch (error) {
      toast.error('刪除標籤失敗', { id: toastId });
    }
  }, [effectiveUserId, features.canUseTagManagement, transactions, tags, syncTagsToTrades, user]);

  const handleAdd = useCallback(async (data: Partial<Transaction>) => {
    setCurrentView('dashboard');
    toast.success("交易紀錄已儲存至本地");
  }, []);

  const handleUpdate = useCallback(async (data: Partial<Transaction>) => {
    if (selectedTransaction) {
      setSelectedTransaction(prev => prev ? ({ ...prev, ...data } as Transaction) : null);
    }
    setCurrentView('detail');
    toast.success("交易紀錄已更新至本地");
  }, [selectedTransaction]);

  const handleDelete = useCallback(async (id: string) => {
    if (!effectiveUserId) return;

    try {
      await dataService.deleteTrade(id, user);

      toast.success("交易紀錄已刪除");

      if (selectedTransaction?.id === id) {
        setSelectedTransaction(null);
        setCurrentView('list');
      }
    } catch (error) {
      console.error('Delete operation failed:', error);
      toast.error("刪除失敗");
    }
  }, [effectiveUserId, selectedTransaction, user]);

  const handleBulkDelete = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const toastId = toast.loading(`正在刪除 ${ids.length} 筆交易...`);
    try {
      await dataService.bulkDeleteTrades(ids, user);

      if (selectedTransaction && ids.includes(selectedTransaction.id)) {
        setSelectedTransaction(null);
        setCurrentView('list');
      }
      toast.success(`已刪除 ${ids.length} 筆交易`, { id: toastId });
    } catch (error) {
      console.error('Bulk delete failed:', error);
      toast.error('批量刪除失敗', { id: toastId });
    }
  }, [selectedTransaction, user]);

  const handleLogin = async () => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code !== 'auth/cancelled-popup-request' && error.code !== 'auth/popup-closed-by-user') {
        console.error('Login failed:', error);
        setAuthError(error.message || '登入失敗，請稍後再試');
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    console.log('[Auth] Switching account, cleaning up...');
    setIsSwitching(true);
    try {
      cleanupListeners();
      clearBlobUrlCache();
      await signOut(auth);
      resetAppState();
      
      // Trigger login once logged out
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code !== 'auth/cancelled-popup-request' && error.code !== 'auth/popup-closed-by-user') {
        console.error('Account switch failed:', error);
        toast.error('切換帳戶失敗');
      }
    } finally {
      setIsSwitching(false);
    }
  };

  const handleLogout = async () => {
    try {
      cleanupListeners();
      clearBlobUrlCache();
      if (user) {
        await signOut(auth);
      }
      setIsGuestMode(false);
      localStorage.removeItem('guest_mode');
      resetAppState();
      toast.success('已成功退出系統');
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('登出失敗');
    }
  };

  const syncTradeDiscipline = useCallback(async (
    targetTransactions: Transaction[],
    currentItems: StrategyChecklistItem[],
    grades: DisciplineGrades
  ) => {
    if (!effectiveUserId || targetTransactions.length === 0) return;
    
    // Rule 1 & 3 & 4: Ensure deleted items are RIPPED OUT from snapshots
    const activeGlobalItems = currentItems.filter(i => i.active);
    const activeGlobalItemIds = new Set(activeGlobalItems.map(i => i.id));
    
    // We will do this in chunks to avoid overwhelming the client/server
    const CHUNK_SIZE = 50;
    const tradesToUpdate = targetTransactions.filter(t => {
      const existingSnapshot = t.checklistSnapshot || [];
      
      // Clean the snapshot: remove items that are no longer in activeGlobalItems
      const cleanedExistingSnapshot = existingSnapshot.filter(s => activeGlobalItemIds.has(s.itemId));
      const checkedMap = new Map(cleanedExistingSnapshot.map(s => [s.itemId, s.checked]));
      
      const newSnapshot = activeGlobalItems.map(gi => ({
        itemId: gi.id,
        text: gi.text,
        weight: gi.weight,
        required: gi.required,
        checked: checkedMap.get(gi.id) || false,
        sortOrder: gi.sortOrder
      }));
      
      const newScore = calculateDisciplineScore(newSnapshot);
      const newPassed = calculatePassedRequired(newSnapshot);
      const newRating = calculateGrade(newScore, grades);
      
      const hasGhostItems = existingSnapshot.length !== cleanedExistingSnapshot.length;

      return (
        hasGhostItems ||
        newScore !== t.checklistScore || 
        newPassed !== t.passedRequiredCheck || 
        newRating !== t.rating ||
        JSON.stringify(newSnapshot) !== JSON.stringify(existingSnapshot)
      );
    });

    if (tradesToUpdate.length === 0) return;

    if (!db) {
      toast.error('Firestore 系統未啟動，無法執行批量更新');
      return;
    }

    const toastId = toast.loading(`正在更新 ${tradesToUpdate.length} 筆交易紀律數據...`);
    console.log(`[Sync] Found ${tradesToUpdate.length} trades needing updates`);
    
    // Process in chunks
    for (let i = 0; i < tradesToUpdate.length; i += CHUNK_SIZE) {
      const chunk = tradesToUpdate.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      
      chunk.forEach(t => {
        const existingSnapshot = t.checklistSnapshot || [];
        // Clean snapshot: ensure only currently defined rules are carried over
        const cleanedExistingSnapshot = existingSnapshot.filter(s => activeGlobalItemIds.has(s.itemId));
        const checkedMap = new Map(cleanedExistingSnapshot.map(s => [s.itemId, s.checked]));
        
        const newSnapshot = activeGlobalItems.map(gi => ({
          itemId: gi.id,
          text: gi.text,
          weight: gi.weight,
          required: gi.required,
          checked: checkedMap.get(gi.id) || false,
          sortOrder: gi.sortOrder
        }));
        
        const newScore = calculateDisciplineScore(newSnapshot);
        const newPassed = calculatePassedRequired(newSnapshot);
        const newRating = calculateGrade(newScore, grades);

        const tradeRef = doc(db, 'trades', t.id);
        batch.update(tradeRef, {
          checklistScore: newScore,
          passedRequiredCheck: newPassed,
          rating: newRating,
          checklistSnapshot: newSnapshot,
          updatedAt: serverTimestamp()
        });
      });

      try {
        await batch.commit();
      } catch (err) {
        console.error('[Sync] Batch update failed:', err);
      }
    }
    
    toast.success('歷史交易資料已同步完成', { id: toastId });
    console.log(`[Sync] Successfully updated ${tradesToUpdate.length} trades`);
  }, [effectiveUserId]);


  // --- Discipline Mode Logic ---
  const updateDisciplineMode = async (mode: DisciplineMode) => {
    setDisciplineMode(mode);
    settingsStore.set({ disciplineMode: mode });
    toast.success(`已切換至 ${mode === 'relaxed' ? '寬鬆' : mode === 'semi' ? '半強制' : '嚴格'} 模式 (僅限本地)`);
  };

  const handleSaveGrades = async () => {
    if (!effectiveUserId) return;

    if (!tempGrades || tempGrades.S <= tempGrades.A || tempGrades.A <= tempGrades.B || tempGrades.B <= 0 || tempGrades.S > 100) {
      toast.error('區間設定錯誤，請確保 S > A > B > 0 且 S <= 100');
      return;
    }

    if (tempGrades.S - tempGrades.A < 5 || tempGrades.A - tempGrades.B < 5 || tempGrades.B < 5) {
      toast.error('每個區間至少需有 5 分');
      return;
    }

    const toastId = toast.loading('正在儲存設定並同步歷史交易...');
    try {
      setDisciplineGrades(tempGrades);
      
      if (db) {
        const profileRef = doc(db, 'users', effectiveUserId);
        await setDoc(profileRef, {
          disciplineGrades: tempGrades,
          updatedAt: serverTimestamp()
        }, { merge: true });

        // Update locally affected transactions
        const tradesToUpdate = transactions.filter(t => typeof t.checklistScore === 'number');
        const updatePromises = tradesToUpdate.map(t => {
          const newRating = calculateGrade(t.checklistScore!, tempGrades);
          if (newRating !== t.rating) {
            return updateDoc(doc(db, 'users', effectiveUserId, 'trades', t.id), { rating: newRating });
          }
          return Promise.resolve();
        });

        await Promise.all(updatePromises);
      }
      
      toast.success('評分區間與歷史資料已成功同步更新', { id: toastId });
    } catch (error) {
      console.error('Failed to update discipline grades:', error);
      toast.error('更新失敗', { id: toastId });
    }
  };
  
  // --- Swipe Gesture Logic ---
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && isSidebarOpen) {
      // Swipe left to close
      setIsSidebarOpen(false);
    } else if (isRightSwipe && !isSidebarOpen) {
      // Swipe right (anywhere) to open
      setIsSidebarOpen(true);
    }
  };

  // --- Integrity Check & Auto-Sync ---
  useEffect(() => {
    if (isAuthLoading || !effectiveUserId || transactions.length === 0 || checklistItems.length === 0) return;
    
    // Integrity check removed in favor of strict local state
  }, [transactions.length, checklistItems.length, tags.length, effectiveUserId, isAuthLoading]);

  return (
    <div 
      className="min-h-screen bg-background text-foreground flex flex-col md:flex-row font-sans transition-colors duration-300"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <Toaster position="top-center" richColors />
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border sticky top-0 bg-background z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-black rotate-45" />
          </div>
          <span className="font-bold tracking-tighter text-lg uppercase">Elite Trader</span>
        </div>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2">
          {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border p-5 flex flex-col gap-6 transition-transform duration-300 overflow-y-auto custom-scrollbar shadow-2xl md:shadow-none text-foreground",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="flex items-center gap-3.5 px-2">
          <div className="w-10 h-10 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-md">
            <div className="w-5 h-5 border-[3px] border-primary-foreground rotate-45" />
          </div>
          <div className="flex flex-col">
            <span className="font-black tracking-tight text-xl leading-none text-foreground uppercase italic">Elite</span>
            <span className="text-[10px] text-muted-foreground tracking-[0.35em] font-black uppercase mt-0.5 ml-0.5">Trader</span>
          </div>
        </div>

        <nav className="space-y-1 min-w-0">
          <NavItem 
            icon={LayoutDashboard} 
            label="總覽面板" 
            active={currentView === 'dashboard'} 
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={History} 
            label="交易紀錄" 
            active={currentView === 'list'} 
            onClick={() => { setCurrentView('list'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={BarChart2} 
            label="進階分析" 
            active={currentView === 'analysis'} 
            locked={!features.canUseTagAnalysis} 
            onClick={() => { setCurrentView('analysis'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={Zap} 
            label="策略與規範" 
            active={currentView === 'strategies'} 
            onClick={() => { setCurrentView('strategies'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={Tags} 
            label="標籤管理" 
            active={currentView === 'tags'} 
            locked={!features.canUseTagManagement} 
            onClick={() => { setCurrentView('tags'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={Settings} 
            label="系統設定" 
            active={currentView === 'settings'} 
            onClick={() => { setCurrentView('settings'); setIsSidebarOpen(false); }} 
          />
          
          <div className="py-2.5 px-2">
             <div className="h-px bg-border" />
          </div>
          
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-3 px-[14px] h-[48px] rounded-[14px] transition-all duration-200 w-full text-left text-muted-foreground hover:text-foreground hover:bg-accent select-none"
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            <span className="text-[13px] tracking-tight font-medium">{theme === 'dark' ? '切換淺色' : '切換深色'}</span>
          </button>

          {effectiveUserId && (
            <>
              <button
                onClick={() => {
                  setCurrentView('add');
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-[14px] h-[48px] rounded-[14px] transition-all duration-200 w-full text-left mt-1 select-none",
                  currentView === 'add'
                    ? "bg-accent text-accent-foreground font-bold shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Plus size={19} />
                <span className="text-[13px] tracking-tight font-medium">新增交易紀錄</span>
              </button>
              
              <button 
                onClick={handleLogout}
                className="flex items-center gap-3 px-[14px] h-[48px] rounded-[14px] transition-all duration-200 w-full text-left text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 select-none"
              >
                <LogOut size={19} />
                <span className="text-[13px] tracking-tight font-medium">退出系統</span>
              </button>
            </>
          )}
        </nav>

        <div className="mt-auto pt-4 border-t border-border space-y-3">
          {user ? (
              <div className="flex flex-col gap-2.5">
                <div className="px-3.5 py-2.5 bg-muted/60 rounded-xl border border-border flex items-center gap-3">
                  <img src={user?.photoURL || ''} className="w-8 h-8 rounded-full ring-1 ring-border" referrerPolicy="no-referrer" />
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold truncate text-foreground">{user?.displayName || 'Elite Trader'}</span>
                      {features.hasPremiumAccess && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-primary text-primary-foreground rounded text-[8px] font-black uppercase tracking-widest">
                          <Zap size={8} />
                          PRO
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate">{user?.email}</span>
                  </div>
                </div>
              
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={handleSwitchAccount}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-muted hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors border border-border"
                >
                  <RefreshCw size={12} />
                  切換帳戶
                </button>
                <button 
                  onClick={handleLogout}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-muted hover:bg-red-500/10 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors border border-border"
                >
                  <LogOut size={12} />
                  登出
                </button>
              </div>
            </div>
          ) : isGuestMode ? (
            <div className="flex flex-col gap-2.5">
              <div className="px-3.5 py-2.5 bg-muted/60 rounded-xl border border-border flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                  離線
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold truncate text-foreground">本地離線模式</span>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-[8px] font-black uppercase tracking-widest">
                      LOCAL
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate">資料保存在此裝置</span>
                </div>
              </div>
              <Button 
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-10 rounded-xl font-bold text-xs shadow-sm"
                onClick={handleLogin}
              >
                <GoogleIcon />
                <span>Google 登入同步</span>
              </Button>
            </div>
          ) : (
            <Button 
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-3 h-11 rounded-xl shadow-md font-bold"
              onClick={handleLogin}
            >
              <GoogleIcon />
              <span>Google 登入</span>
            </Button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 lg:p-12 min-h-screen relative">
        {isSwitching && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            <p className="text-sm font-medium animate-pulse">正在切換帳戶...</p>
          </div>
        )}
        
        <div className="max-w-5xl mx-auto">
          {/* Main Content Area - Rendered even if auth is loading to show framework */}
          {isEffectiveLoggedIn ? (
            <AnimatePresence mode="wait">
              {showLegacyBanner && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mb-8"
                >
                  <Card className="bg-amber-500/10 border-amber-500/30 overflow-hidden relative shadow-lg">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                    <CardContent className="p-5 flex flex-col sm:flex-row items-center justify-between gap-5">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-500 shadow-inner">
                          <LifeBuoy size={24} />
                        </div>
                        <div className="text-center sm:text-left">
                          <h4 className="text-sm font-black text-amber-500 uppercase tracking-widest">發現可恢復的舊資料來源</h4>
                          <p className="text-[11px] text-amber-500/70 font-medium leading-relaxed mt-1">
                            深層掃描發現了 {legacyResults.reduce((a, b) => a + (b?.count || 0), 0)} 筆在其他路徑 or 版本中的交易紀錄。
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setShowLegacyBanner(false)}
                          className="border-amber-500/30 text-amber-500/60 hover:bg-amber-500/10 h-10 px-4 rounded-xl text-[11px] font-bold"
                        >
                          暫時略過
                        </Button>
                        <Button 
                          size="sm" 
                          onClick={() => {
                            setCurrentView('backup');
                            setShowLegacyBanner(false);
                          }}
                          className="bg-amber-500 text-black hover:bg-amber-400 h-10 px-6 rounded-xl text-[11px] font-black uppercase shadow-xl"
                        >
                          前往恢復資料
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {currentView === 'dashboard' && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  {!db && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-3 mb-4">
                      <AlertCircle className="text-amber-500" size={18} />
                      <p className="text-[11px] text-amber-500 font-bold uppercase tracking-wider">目前以本地離線模式運行，部分雲端功能受限</p>
                    </div>
                  )}
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-4">
                        <h1 className="text-3xl font-bold tracking-tight">交易總覽</h1>
                      </div>
                      <p className="text-neutral-500 text-sm">歡迎回來，這是您目前的資產走勢與統計。</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="bg-primary text-primary-foreground border-transparent hover:bg-primary/90 text-xs h-8">全部</Button>
                      <Button variant="outline" size="sm" className="bg-muted text-muted-foreground border-border hover:bg-accent hover:text-foreground text-xs h-8">近 30 天</Button>
                      <Button variant="outline" size="sm" className="bg-muted text-muted-foreground border-border hover:bg-accent hover:text-foreground text-xs h-8">近 7 天</Button>
                    </div>
                  </div>

                  <StatsOverview stats={stats} />
                  
                  {displayTransactions.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-center space-y-6 border border-dashed border-border rounded-3xl bg-card">
                      <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center">
                        <Plus size={32} className="text-muted-foreground" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-bold text-foreground">尚無交易紀錄</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto text-sm">
                          開始記錄您的第一筆交易，建立屬於您的專業交易日誌。
                        </p>
                      </div>
                      <Button 
                        onClick={() => setCurrentView('add')}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-11 px-6 rounded-xl font-bold shadow-sm"
                      >
                        <Plus size={18} />
                        新增第一筆交易
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-4">
                          <div className="flex items-center justify-between">
                            <h2 className="text-[10px] uppercase tracking-[0.3em] text-neutral-500 font-bold">資產走勢圖 (Equity Curve)</h2>
                            <div className="flex items-center gap-4 text-[10px] font-mono text-neutral-500 uppercase">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-green-500" /> 盈利區
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-red-500" /> 虧損區
                              </div>
                            </div>
                          </div>
                          <EquityChart transactions={displayTransactions} />
                        </div>
                        <div className="space-y-4">
                          <ProfitCalendar transactions={displayTransactions} />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-[10px] uppercase tracking-[0.3em] text-neutral-500 font-bold">近期交易紀錄</h2>
                          <Button variant="link" onClick={() => setCurrentView('list')} className="text-neutral-500 text-xs h-auto p-0">查看全部</Button>
                        </div>
                        <TransactionList 
                          transactions={displayTransactions.slice(0, 5)} 
                          allTags={tags}
                          onView={(t) => { setSelectedTransaction(t); setCurrentView('detail'); }}
                          onEdit={(t) => { setSelectedTransaction(t); setCurrentView('edit'); }}
                          onDelete={handleDelete}
                          onBulkDelete={handleBulkDelete}
                        />
                      </div>
                    </>
                  )}
                </motion.div>
              )}

            {currentView === 'list' && (
              <motion.div
                key="list"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="space-y-1">
                  <h1 className="text-3xl font-bold tracking-tight">交易歷史</h1>
                  <p className="text-neutral-500 text-sm">管理與篩選您所有的歷史交易紀錄。</p>
                </div>
                <TransactionList 
                  transactions={displayTransactions} 
                  allTags={tags}
                  onView={(t) => { setSelectedTransaction(t); setCurrentView('detail'); }}
                  onEdit={(t) => { setSelectedTransaction(t); setCurrentView('edit'); }}
                  onDelete={handleDelete}
                  onBulkDelete={handleBulkDelete}
                />
              </motion.div>
            )}

            {currentView === 'add' && (
              <motion.div
                key="add"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <TransactionForm 
                  allTags={tags}
                  onAddGlobalTag={handleAddGlobalTag}
                  onSubmit={handleAdd} 
                  onCancel={() => setCurrentView('dashboard')} 
                  canManageTags={features.canUseTagManagement}
                  strategies={strategies}
                  checklistItems={checklistItems}
                  disciplineMode={disciplineMode}
                  disciplineGrades={disciplineGrades}
                  globalStrategyOnly={!features.canUseStrategies}
                />
              </motion.div>
            )}

            {currentView === 'edit' && (
              selectedTransaction ? (
                <motion.div
                  key="edit"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <TransactionForm 
                    initialData={selectedTransaction}
                    allTags={tags}
                    onAddGlobalTag={handleAddGlobalTag}
                    onSubmit={handleUpdate} 
                    onCancel={() => {
                      const prev = prevView.current;
                      if (prev === 'detail' && selectedTransaction) {
                        setCurrentView('detail');
                      } else {
                        setSelectedTransaction(null);
                        setCurrentView('dashboard');
                      }
                    }} 
                    canManageTags={features.canUseTagManagement}
                    strategies={strategies}
                    checklistItems={checklistItems}
                    disciplineMode={disciplineMode}
                    disciplineGrades={disciplineGrades}
                    globalStrategyOnly={!features.canUseStrategies}
                  />
                </motion.div>
              ) : (
                <div className="py-16 text-center space-y-4">
                  <p className="text-neutral-500">未選取要編輯的交易紀錄</p>
                  <Button onClick={() => setCurrentView('dashboard')} variant="outline">
                    返回總覽
                  </Button>
                </div>
              )
            )}

            {currentView === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="space-y-1">
                  <h1 className="text-3xl font-bold tracking-tight">系統設定</h1>
                  <p className="text-neutral-500 text-sm">調整您的交易日誌偏好設定。</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 rounded-xl border border-border bg-card space-y-4">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-bold">初始資金設定</h3>
                      <p className="text-xs text-neutral-500">設定您的帳戶起始金額，用於計算回撤百分比。</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-neutral-500 uppercase tracking-wider">初始金額 (u)</Label>
                      {isProfileLoading ? (
                        <div className="h-10 bg-neutral-900 animate-pulse rounded border border-[#2A2A2A]" />
                      ) : (
                        <div className="flex gap-2">
                          <Input 
                            type="number"
                            value={localSettingsCapital}
                            onChange={(e) => setLocalSettingsCapital(e.target.value)}
                            className="bg-background border-border font-mono flex-1"
                          />
                          <Button 
                            variant="default"
                            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold h-10 px-4"
                            onClick={async () => {
                              const val = Number(localSettingsCapital);
                              if (isNaN(val)) {
                                toast.error('請輸入有效的數字');
                                return;
                              }
                              
                              const toastId = toast.loading('正在更新設定...');
                              setInitialCapital(val);
                              settingsStore.set({ initialCapital: val });
                              await settingsStore.syncToCloud();
                              toast.success('初始資金已儲存', { id: toastId });
                            }}
                          >
                            存
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-6 rounded-2xl border border-border bg-card space-y-4">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-bold text-foreground">介面主題</h3>
                      <p className="text-xs text-muted-foreground">選擇您偏好的視覺風格。</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setTheme('dark')}
                        className={cn(
                          "flex-1 py-4 rounded-xl border transition-all flex flex-col items-center gap-2",
                          theme === 'dark' 
                            ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-700" />
                        <span className="text-xs font-bold uppercase tracking-widest">深色模式</span>
                      </button>
                      <button
                        onClick={() => setTheme('light')}
                        className={cn(
                          "flex-1 py-4 rounded-xl border transition-all flex flex-col items-center gap-2",
                          theme === 'light' 
                            ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-neutral-100 border border-neutral-300" />
                        <span className="text-xs font-bold uppercase tracking-widest">淺色模式</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card space-y-4">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-bold flex items-center gap-2">
                        <ShieldAlert size={18} className="text-primary" />
                        交易規範強制模式 (Discipline Mode)
                      </h3>
                      <p className="text-xs text-neutral-500">決定在違反核心規範時，系統該如何引導您的交易紀錄。</p>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <button 
                        onClick={() => updateDisciplineMode('relaxed')}
                        className={cn(
                          "flex flex-col items-start gap-1 p-4 rounded-xl border transition-all text-left",
                          disciplineMode === 'relaxed' ? "bg-primary/5 border-primary" : "bg-neutral-900/50 border-neutral-800 hover:border-neutral-700"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-black uppercase tracking-widest", disciplineMode === 'relaxed' ? "text-primary" : "text-neutral-400")}>寬鬆模式 (Relaxed)</span>
                        </div>
                        <p className="text-[10px] text-neutral-500">不阻擋任何儲存，僅在畫面顯示規範達成分數與提示。</p>
                      </button>

                      <button 
                        onClick={() => updateDisciplineMode('semi')}
                        className={cn(
                          "flex flex-col items-start gap-1 p-4 rounded-xl border transition-all text-left",
                          disciplineMode === 'semi' ? "bg-primary/5 border-primary" : "bg-neutral-900/50 border-neutral-800 hover:border-neutral-700"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-black uppercase tracking-widest", disciplineMode === 'semi' ? "text-primary" : "text-neutral-400")}>半強制模式 (Semi-Strict)</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">預設推薦</span>
                        </div>
                        <p className="text-[10px] text-neutral-500">缺少「必要項」時會跳出二次確認視窗，提醒您是否真的要違規交易。</p>
                      </button>

                      <button 
                        onClick={() => updateDisciplineMode('strict')}
                        className={cn(
                          "flex flex-col items-start gap-1 p-4 rounded-xl border transition-all text-left",
                          disciplineMode === 'strict' ? "bg-primary/5 border-primary" : "bg-neutral-900/50 border-neutral-800 hover:border-neutral-700"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-black uppercase tracking-widest", disciplineMode === 'strict' ? "text-primary" : "text-neutral-400")}>嚴格模式 (Strict)</span>
                          <Lock size={12} className={disciplineMode === 'strict' ? "text-primary" : "text-neutral-500"} />
                        </div>
                        <p className="text-[10px] text-neutral-500">必須補齊所有「必要項」才允許儲存。強制執行交易紀律，告別情緒單。</p>
                      </button>
                    </div>
                  </div>

                  <div className="p-6 rounded-xl border border-border bg-card space-y-6">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-bold flex items-center gap-2">
                        <Zap size={18} className="text-primary" />
                        執行評分自動化區間設定
                      </h3>
                      <p className="text-xs text-neutral-500">自訂紀律分數對應的執行等級範圍。修改後將同步更新歷史交易紀錄。</p>
                    </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="space-y-3">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">Grade S 門檻 (極優)</Label>
                            <div className="flex items-center gap-2">
                              <Input 
                                type="text"
                                inputMode="numeric"
                                value={tempGrades.S} 
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '');
                                  const num = parseInt(val) || 0;
                                  if (num <= 100) setTempGrades({...tempGrades, S: num});
                                }}
                                className="bg-background border-border font-mono h-11 text-center font-bold text-foreground"
                              />
                              <span className="text-xs text-muted-foreground font-bold shrink-0">~ 100</span>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">Grade A 門檻 (良好)</Label>
                            <div className="flex items-center gap-2">
                              <Input 
                                type="text"
                                inputMode="numeric"
                                value={tempGrades.A} 
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '');
                                  const num = parseInt(val) || 0;
                                  if (num <= 100) setTempGrades({...tempGrades, A: num});
                                }}
                                className="bg-background border-border font-mono h-11 text-center font-bold text-foreground"
                              />
                              <span className="text-xs text-muted-foreground font-bold shrink-0">~ {tempGrades.S - 1}</span>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-black">Grade B 門檻 (普通)</Label>
                            <div className="flex items-center gap-2">
                              <Input 
                                type="text"
                                inputMode="numeric"
                                value={tempGrades.B} 
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '');
                                  const num = parseInt(val) || 0;
                                  if (num <= 100) setTempGrades({...tempGrades, B: num});
                                }}
                                className="bg-background border-border font-mono h-11 text-center font-bold text-foreground"
                              />
                              <span className="text-xs text-muted-foreground font-bold shrink-0">~ {tempGrades.A - 1}</span>
                            </div>
                          </div>
                        </div>

                    <div className="p-4 rounded-xl bg-muted/30 border border-border text-xs text-muted-foreground">
                      <p>• 低於 Grade B 門檻 ({tempGrades.B}) 的分數將自動歸類為 Grade C。</p>
                      <p>• 建議每個等級區間至少保持 10 分的間隔。</p>
                    </div>

                    <Button 
                      onClick={handleSaveGrades}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-11 rounded-xl font-bold"
                    >
                      <RefreshCw size={16} />
                      儲存並套用至所有紀錄
                    </Button>
                  </div>

                  <section className="col-span-1 md:col-span-2 space-y-8 pt-10 border-t border-[#1A1A1A]">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-bold flex items-center gap-2 text-xl">
                        <DatabaseIcon size={22} className="text-amber-500" />
                        資料同步與救回 (Data Management)
                      </h3>
                      <p className="text-sm text-neutral-500">管理裝置端的備份同步、匯入匯出，以及尋找遺失的舊版資料。</p>
                    </div>
                    <DataManagement 
                      user={user}
                      isStandalone={isStandalone}
                      isInIframe={isInIframe}
                      isInstallable={isInstallable}
                      handleInstallClick={handleInstallClick}
                    />
                  </section>
                </div>
              </motion.div>
            )}

            {currentView === 'detail' && (
              selectedTransaction ? (
                <motion.div
                  key="detail"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <TransactionDetail 
                    transaction={selectedTransaction}
                    allTags={tags}
                    checklistItems={checklistItems}
                    onClose={() => setCurrentView('list')}
                    onEdit={(t) => { setSelectedTransaction(t); setCurrentView('edit'); }}
                    onDelete={handleDelete}
                    onUpdate={(updated) => setSelectedTransaction(updated)}
                  />
                </motion.div>
              ) : (
                <div className="py-16 text-center space-y-4">
                  <p className="text-neutral-500">未選取任何交易紀錄</p>
                  <Button onClick={() => setCurrentView('list')} variant="outline">
                    返回交易清單
                  </Button>
                </div>
              )
            )}

            {currentView === 'analysis' && (
              <motion.div
                key="analysis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {!features.canUseTagAnalysis && !features.canUseDisciplineAnalysis ? (
                  <Paywall 
                    featureName="進階數據分析"
                    description="透過標籤獲利統計與紀律度分析，找出您的交易盲點並透過數據提升勝率。"
                    onUpgrade={() => toast.info('Beta 測試期間暫無收費，請直接使用')}
                  />
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <h1 className="text-3xl font-bold tracking-tight">數據分析</h1>
                      <p className="text-neutral-500 text-sm">深入了解您的交易表現與紀律執行度。</p>
                    </div>

                    <div className="space-y-8">
                      <section className="space-y-4">
                        <h2 className="text-[10px] uppercase font-black tracking-[0.3em] text-neutral-500 border-l-2 border-primary pl-3">紀律執行分析</h2>
                        <DisciplineAnalysis 
                          transactions={displayTransactions} 
                          grades={disciplineGrades} 
                          checklistItems={checklistItems} 
                        />
                      </section>

                      <section className="space-y-4">
                        <h2 className="text-[10px] uppercase font-black tracking-[0.3em] text-neutral-500 border-l-2 border-primary pl-3">標籤獲利分析</h2>
                        <TagAnalysis transactions={displayTransactions} allTags={tags} />
                      </section>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {currentView === 'strategies' && (
              <motion.div
                key="strategies"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {!features.canUseStrategies ? (
                  <Paywall 
                    featureName="交易策略與規範管理"
                    description="建立專屬於您的交易模板與出手核對清單，將紀律轉化為可重複的成功模式。"
                    onUpgrade={() => toast.info('Beta 測試期間暫無收費，請直接使用')}
                  />
                ) : (
                  <StrategyManagement 
                    userId={effectiveUserId!} 
                    strategies={strategies} 
                    checklistItems={checklistItems} 
                    transactions={transactions}
                    onSyncAllTrades={() => {
                      syncTradeDiscipline(transactions, checklistItems, disciplineGrades);
                    }}
                  />
                )}
              </motion.div>
            )}

            {currentView === 'tags' && (
              <motion.div
                key="tags"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {!features.canUseTagManagement ? (
                  <Paywall 
                    featureName="標籤管理系統"
                    description="集中管理您的交易標籤，透過系統化的分類追蹤找出最具優勢的技術訊號。"
                    onUpgrade={() => toast.info('Beta 測試期間暫無收費，請直接使用')}
                  />
                ) : (
                  <TagManagement 
                    tags={tags}
                    onRenameTag={handleRenameTag}
                    onDeleteTag={handleDeleteTag}
                    onAddTag={handleAddGlobalTag}
                  />
                )}
              </motion.div>
            )}

            {currentView === 'backup' && (
              <motion.div
                key="backup"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <DataManagement user={user} />
              </motion.div>
            )}
          </AnimatePresence>
          ) : (
            <div className="h-[80vh] flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-foreground rounded-2xl flex items-center justify-center shadow-2xl">
                <div className="w-10 h-10 border-[4px] border-background rotate-45" />
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tighter uppercase">Elite Journal</h1>
                <p className="text-neutral-500 max-w-xs">專業交易員的雲端日誌系統。支援 Google 登入、雲端同步與離線使用。</p>
              </div>
              <div className="flex flex-col gap-3 w-full max-w-xs">
                {authError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-left">
                    <ShieldAlert className="text-red-400 shrink-0" size={16} />
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-red-400">登入發生錯誤</p>
                      <p className="text-[10px] text-red-400/80 leading-relaxed">{authError}</p>
                    </div>
                  </div>
                )}
                <Button 
                  size="lg"
                  className="bg-card text-foreground hover:bg-accent border border-border gap-3 h-14 px-8 rounded-2xl font-bold text-lg shadow-md"
                  onClick={handleLogin}
                  disabled={isAuthLoading}
                >
                  <GoogleIcon />
                  <span>使用 Google 帳號登入</span>
                </Button>
                
                <Button 
                  variant="outline" 
                  size="lg" 
                  className="bg-muted/40 text-muted-foreground border-border hover:bg-accent hover:text-foreground gap-2 h-12 rounded-2xl font-semibold"
                  onClick={handleEnterGuestMode}
                >
                  <Zap size={14} className="text-amber-500" />
                  <span>直接以本地離線模式使用 (免登入)</span>
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Wifi size={12} />
                <span>支援離線模式，網路恢復後自動同步</span>
              </div>
            </div>
          )}
        </div>
      </main>
      {/* Floating Action Button */}
      {effectiveUserId && currentView !== 'add' && currentView !== 'edit' && (
        <FloatingActionButton 
          onClick={() => setCurrentView('add')} 
          onQuickRecord={() => setCurrentView('add')}
          onImport={() => {}} // Placeholder for now
        />
      )}
      
      {/* Internal Debug Panel */}
      <DebugPanel />
    </div>
  );
}
