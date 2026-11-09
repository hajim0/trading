import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  CloudUpload, CloudDownload, Download, Upload, FileJson, 
  RefreshCw, CheckCircle2, Database as DatabaseIcon,
  ShieldCheck, Loader2, Image as ImageIcon, AlertCircle,
  FileCheck, HardDrive, AlertTriangle, X
} from 'lucide-react';
import { User } from 'firebase/auth';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { cn } from '@/lib/utils';
import { syncService } from '../lib/sync';
import { dataService } from '../lib/dataService';

interface DataManagementProps {
  user?: User | null;
  isStandalone?: boolean;
  isInIframe?: boolean;
  isInstallable?: boolean;
  handleInstallClick?: () => void;
}

export function DataManagement({ 
  user,
  isStandalone, 
  isInIframe, 
  isInstallable, 
  handleInstallClick 
}: DataManagementProps) {
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isImportingJson, setIsImportingJson] = useState(false);
  const [cloudInfo, setCloudInfo] = useState<{ updatedAt: number, tradeCount: number } | null>(null);
  const [lastOpResult, setLastOpResult] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<'cloud-restore' | 'import-json' | null>(null);
  const [selectedJsonFile, setSelectedJsonFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUserId = user?.uid || 'local-user';

  // Live queries strictly isolated to current active user
  const localTrades = useLiveQuery(
    () => db.trades.filter(t => t.userId === currentUserId && !t.deleted).toArray(),
    [currentUserId]
  ) || [];

  const localTags = useLiveQuery(
    () => db.tags.filter(t => t.userId === currentUserId && !t.deleted).toArray(),
    [currentUserId]
  ) || [];

  const localStrategies = useLiveQuery(
    () => db.strategies.filter(s => s.userId === currentUserId && !s.deleted).toArray(),
    [currentUserId]
  ) || [];

  const localRules = useLiveQuery(
    () => db.rules.filter(r => !r.deleted).toArray(),
    [currentUserId]
  ) || [];

  const localBlobs = useLiveQuery(
    () => db.blobs.toArray(),
    []
  ) || [];

  const localLastUpdate = Math.max(
    ...localTrades.map(t => t.updatedAt || 0),
    ...localTags.map(t => t.updatedAt || 0),
    ...localStrategies.map(t => t.updatedAt || 0),
    0
  );

  const loadCloudInfo = async () => {
    if (user) {
      try {
        const info = await dataService.getCloudBackupInfo(user);
        setCloudInfo(info);
      } catch (e) {
        console.warn('Failed to load cloud backup info:', e);
      }
    } else {
      setCloudInfo(null);
    }
  };

  useEffect(() => {
    loadCloudInfo();
  }, [user, isBackingUp, isRestoring]);

  // --- Handlers ---

  const handleExportJson = async () => {
    setIsExportingJson(true);
    setLastOpResult('exporting-json');
    try {
      const res = await syncService.exportToJson();
      setLastOpResult(`success-exported-${res.totalTrades}-trades`);
    } catch (e: any) {
      setLastOpResult(`error: ${e?.message || '匯出失敗'}`);
    } finally {
      setIsExportingJson(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedJsonFile(file);
    setConfirmAction('import-json');
  };

  const executeImportJson = async () => {
    if (!selectedJsonFile) return;

    setIsImportingJson(true);
    setConfirmAction(null);
    setLastOpResult('importing-json');

    try {
      const res = await syncService.importFromJson(selectedJsonFile);
      setLastOpResult(`success-imported-${res.tradesCount}-trades`);
      toast.success(`成功匯入 ${res.tradesCount} 筆交易紀錄與 ${res.blobsCount} 個圖片附件！`);
      await loadCloudInfo();
    } catch (e: any) {
      console.error('[Backup Center] Import error:', e);
      const errorMsg = e?.message || String(e);
      setLastOpResult(`error: ${errorMsg}`);
      toast.error(`匯入失敗：${errorMsg}`);
    } finally {
      setIsImportingJson(false);
      setSelectedJsonFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCloudUpload = async () => {
    if (!user) {
      toast.error('請先登入 Google 帳號以使用雲端備份功能');
      return;
    }
    
    setIsBackingUp(true);
    setLastOpResult('starting-upload');
    const toastId = toast.loading('正在同步並備份最新資料至雲端...');

    try {
      const res = await dataService.cloudBackup(user);
      setLastOpResult(`success-backed-up-${res.tradeCount}-trades`);
      toast.success(`雲端備份成功！已更新 ${res.tradeCount} 筆交易、${res.tagsCount} 個標籤至雲端`, { id: toastId });
      await loadCloudInfo();
    } catch (e: any) {
      console.error('[Backup Center] Cloud upload error:', e);
      const errorMsg = e?.message || String(e);
      setLastOpResult(`error: ${errorMsg}`);
      toast.error(`雲端備份失敗：${errorMsg}`, { id: toastId });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleCloudDownloadClick = () => {
    if (!user) {
      toast.error('請先登入 Google 帳號以從雲端還原');
      return;
    }
    setConfirmAction('cloud-restore');
  };

  const executeCloudRestore = async () => {
    if (!user) return;

    setConfirmAction(null);
    setIsRestoring(true);
    setLastOpResult('restoring');
    const toastId = toast.loading('正在從雲端下載並還原備份資料...');

    try {
      const res = await dataService.cloudRestore(user);
      setLastOpResult(`success-restored-${res.tradeCount}-trades`);
      toast.success(
        `已成功從雲端還原 ${res.tradeCount} 筆交易紀錄、${res.tagsCount} 個標籤！`, 
        { id: toastId }
      );
      await loadCloudInfo();
    } catch (e: any) {
      console.error('[Backup Center] Cloud restore error:', e);
      const errorMsg = e?.message || String(e);
      setLastOpResult(`error: ${errorMsg}`);
      toast.error(`還原失敗：${errorMsg}`, { id: toastId });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-8 pb-10 max-w-5xl mx-auto">
      {/* Hidden File Input for JSON Restore */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />

      {/* Main Backup Center Card */}
      <Card className="bg-[#141414] border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-6 md:p-8 border-b border-neutral-800/80 bg-gradient-to-r from-blue-500/10 via-purple-500/5 to-transparent">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <DatabaseIcon size={24} />
              </div>
              <div>
                <CardTitle className="text-xl font-black text-white">資料備份與還原中心</CardTitle>
                <CardDescription className="text-xs text-neutral-400 mt-0.5">
                  支援本機離線 JSON 檔案完整匯出（含圖片）與個人雲端雙向同步覆蓋
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 border border-neutral-800 text-[11px] font-mono text-neutral-300">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>帳號：{user?.email || '訪客模式 (本地)'}</span>
            </div>
          </div>
        </div>

        <CardContent className="p-6 md:p-8 space-y-8 relative">
          {/* Progress Overlay */}
          <AnimatePresence>
            {(isBackingUp || isRestoring || isExportingJson || isImportingJson) && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-[#141414]/90 backdrop-blur-md flex flex-col items-center justify-center gap-4 rounded-3xl"
              >
                <div className="relative">
                  <RefreshCw className="text-blue-500 animate-spin" size={48} />
                  <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full animate-pulse" />
                </div>
                <div className="text-center space-y-1">
                  <h4 className="text-white font-bold text-lg">
                    {isBackingUp ? "正在上傳雲端備份..." : 
                     isRestoring ? "正在從雲端還原資料..." :
                     isExportingJson ? "正在生成並下載 JSON 備份檔..." : "正在驗證並匯入資料..."}
                  </h4>
                  <p className="text-xs text-neutral-400 animate-pulse">
                    正在執行資料庫操作，請勿關閉視窗
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Real-time Status Display */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between text-neutral-400">
                <div className="flex items-center gap-2">
                  <HardDrive size={16} className="text-blue-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-neutral-300">本機目前資料 (Local)</span>
                </div>
                <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                  即時狀態
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-white tabular-nums">
                  {localTrades.length} <span className="text-sm font-normal text-neutral-400">筆交易紀錄</span>
                </p>
                <p className="text-xs text-neutral-400 mt-1 flex items-center gap-2 flex-wrap">
                  <span>標籤 {localTags.length} 個</span>
                  <span>•</span>
                  <span>策略 {localStrategies.length} 組</span>
                  <span>•</span>
                  <span>圖片附件 {localBlobs.length} 個</span>
                </p>
              </div>
              <p className="text-[10px] text-neutral-500 font-mono pt-1 border-t border-neutral-800/60">
                最後更新：{localLastUpdate > 0 ? new Date(localLastUpdate).toLocaleString() : '尚無紀錄'}
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between text-neutral-400">
                <div className="flex items-center gap-2">
                  <CloudUpload size={16} className="text-green-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-neutral-300">雲端備份狀態 (Cloud)</span>
                  {user && (
                    <button
                      type="button"
                      onClick={() => {
                        loadCloudInfo();
                        toast.info('已重新檢查雲端最新狀態');
                      }}
                      className="p-1 text-neutral-500 hover:text-white transition-colors"
                      title="重新整理雲端狀態"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                </div>
                <span className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded-full border",
                  cloudInfo 
                    ? "bg-green-500/10 text-green-400 border-green-500/20" 
                    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                )}>
                  {cloudInfo ? '已備份' : '未備份'}
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-white tabular-nums">
                  {cloudInfo ? cloudInfo.tradeCount : 0} <span className="text-sm font-normal text-neutral-400">筆雲端紀錄</span>
                </p>
                <p className="text-xs text-neutral-400 mt-1">
                  {user ? `使用者 ID: ${user.uid.slice(0, 10)}...` : '尚未登入雲端帳號'}
                </p>
              </div>
              <p className="text-[10px] text-neutral-500 font-mono pt-1 border-t border-neutral-800/60">
                最後上傳：{cloudInfo ? new Date(cloudInfo.updatedAt).toLocaleString() : '尚無雲端備份'}
              </p>
            </div>
          </div>

          {/* Section 1: JSON File Backup & Restore (Offline & Complete with Images) */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 text-white">
              <FileJson size={18} className="text-yellow-400" />
              <h3 className="font-black text-sm uppercase tracking-wider">JSON 檔案備份與還原 (可離線永久保存)</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button 
                type="button"
                onClick={handleExportJson}
                disabled={isBackingUp || isRestoring || isExportingJson || isImportingJson}
                size="lg"
                className="h-28 w-full rounded-2xl bg-gradient-to-br from-yellow-600 to-amber-700 hover:from-yellow-500 hover:to-amber-600 text-white flex flex-col gap-2 items-center justify-center shadow-xl shadow-amber-950/20 cursor-pointer border-none transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-2.5 font-black text-lg">
                  {isExportingJson ? <Loader2 className="animate-spin" size={22} /> : <Download size={22} />}
                  <span>下載 JSON 完整備份</span>
                </div>
                <span className="text-[11px] opacity-90 font-medium text-center px-4">
                  即時擷取目前最新 {localTrades.length} 筆交易、標籤及所有圖片 Base64，下載至裝置
                </span>
              </Button>

              <Button 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBackingUp || isRestoring || isExportingJson || isImportingJson}
                size="lg"
                variant="outline"
                className="h-28 w-full rounded-2xl border-2 border-neutral-700 hover:border-yellow-500/50 bg-[#0A0A0A] hover:bg-yellow-500/5 text-neutral-200 hover:text-white flex flex-col gap-2 items-center justify-center cursor-pointer transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-2.5 font-black text-lg">
                  {isImportingJson ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} className="text-yellow-400" />}
                  <span>匯入 JSON 備份檔案</span>
                </div>
                <span className="text-[11px] text-neutral-400 font-medium text-center px-4">
                  驗證並還原備份檔案中的所有交易紀錄、策略與截圖圖片，自動同步至資料庫
                </span>
              </Button>
            </div>
          </div>

          {/* Section 2: Cloud Firestore Sync (Online & Cross-Device) */}
          <div className="space-y-4 pt-4 border-t border-neutral-800">
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <CloudUpload size={18} className="text-blue-400" />
                <h3 className="font-black text-sm uppercase tracking-wider">個人雲端同步備份 (Google 帳號綁定)</h3>
              </div>
              {!user && (
                <span className="text-[11px] text-yellow-400 font-bold flex items-center gap-1">
                  <AlertCircle size={12} />
                  需登入才能使用雲端功能
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button 
                type="button"
                onClick={handleCloudUpload}
                disabled={!user || isBackingUp || isRestoring || isExportingJson || isImportingJson}
                size="lg"
                className="h-28 w-full rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white flex flex-col gap-2 items-center justify-center shadow-xl shadow-blue-950/20 cursor-pointer border-none transition-all active:scale-[0.98] disabled:opacity-40"
              >
                <div className="flex items-center gap-2.5 font-black text-lg">
                  {isBackingUp ? <Loader2 className="animate-spin" size={22} /> : <CloudUpload size={24} />}
                  <span>備份到個人雲端</span>
                </div>
                <span className="text-[11px] opacity-90 font-medium text-center px-4">
                  將本機目前 {localTrades.length} 筆最新交易同步覆蓋至雲端，實現跨裝置使用
                </span>
              </Button>

              <Button 
                type="button"
                onClick={handleCloudDownloadClick}
                disabled={!user || isRestoring || isBackingUp || isExportingJson || isImportingJson}
                size="lg"
                variant="outline"
                className="h-28 w-full rounded-2xl border-2 border-neutral-700 hover:border-blue-500/50 bg-[#0A0A0A] hover:bg-blue-500/5 text-blue-400 flex flex-col gap-2 items-center justify-center cursor-pointer transition-all active:scale-[0.98] disabled:opacity-40"
              >
                <div className="flex items-center gap-2.5 font-black text-lg">
                  {isRestoring ? <Loader2 className="animate-spin" size={22} /> : <CloudDownload size={24} />}
                  <span>從雲端還原資料</span>
                </div>
                <span className="text-[11px] text-neutral-400 font-medium text-center px-4">
                  自個人雲端取得最新備份覆蓋本機，同步多台裝置或新手機資料
                </span>
              </Button>
            </div>
          </div>

          {/* Operation Status Log */}
          {lastOpResult && (
            <div className="p-3.5 rounded-xl bg-black/50 border border-neutral-800 text-center">
              <span className="text-[11px] font-mono text-neutral-300">
                最近操作狀態：{lastOpResult}
              </span>
            </div>
          )}

          {/* Confirmation Modal for Cloud Restore */}
          <AnimatePresence>
            {confirmAction === 'cloud-restore' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
                onClick={() => setConfirmAction(null)}
              >
                <div 
                  className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl space-y-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-3 text-blue-400">
                    <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 shrink-0">
                      <CloudDownload size={24} />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white">確認從個人雲端還原資料？</h4>
                      <p className="text-xs text-neutral-400 mt-0.5">自 Google 帳號雲端儲存庫取得最新紀錄並同步覆蓋至本機。</p>
                    </div>
                  </div>

                  <div className="p-4 bg-neutral-950 rounded-2xl border border-neutral-800 space-y-2 text-xs">
                    <div className="flex justify-between text-neutral-400">
                      <span>綁定 Google 帳號：</span>
                      <span className="text-white font-mono">{user?.email}</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>雲端最新紀錄：</span>
                      <span className="text-blue-400 font-bold font-mono">
                        {cloudInfo ? `${cloudInfo.tradeCount} 筆交易紀錄` : '即時讀取中'}
                      </span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>雲端最後更新時間：</span>
                      <span className="text-neutral-300 font-mono">
                        {cloudInfo?.updatedAt ? new Date(cloudInfo.updatedAt).toLocaleString() : '即時最新'}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-950/60 p-3 rounded-xl border border-neutral-800/60">
                    ⚠️ 提示：還原操作將以雲端上的最新紀錄同步至這台裝置，若本機有尚未備份的新交易，請先點擊「備份到個人雲端」避免遺失。
                  </p>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmAction(null)}
                      className="text-neutral-400 hover:text-white"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={executeCloudRestore}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2 px-5 rounded-xl shadow-lg shadow-blue-950/40"
                    >
                      <CloudDownload size={15} />
                      確認從雲端還原
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Confirmation Modal for JSON Import */}
          <AnimatePresence>
            {confirmAction === 'import-json' && selectedJsonFile && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
                onClick={() => { setConfirmAction(null); setSelectedJsonFile(null); }}
              >
                <div 
                  className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl space-y-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-3 text-yellow-400">
                    <div className="p-3 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 shrink-0">
                      <FileJson size={24} />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white">確認匯入 JSON 備份檔案？</h4>
                      <p className="text-xs text-neutral-400 mt-0.5">解析備份檔並合併還原交易紀錄與圖片附件。</p>
                    </div>
                  </div>

                  <div className="p-4 bg-neutral-950 rounded-2xl border border-neutral-800 space-y-2 text-xs">
                    <div className="flex justify-between text-neutral-400">
                      <span>檔案名稱：</span>
                      <span className="text-white font-mono truncate max-w-[220px]">{selectedJsonFile.name}</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>檔案大小：</span>
                      <span className="text-yellow-400 font-mono">
                        {(selectedJsonFile.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-950/60 p-3 rounded-xl border border-neutral-800/60">
                    匯入完成後，系統將會自動驗證資料完整性，並將新增的交易同步至本地資料庫與雲端（若已登入）。
                  </p>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setConfirmAction(null); setSelectedJsonFile(null); }}
                      className="text-neutral-400 hover:text-white"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={executeImportJson}
                      className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold gap-2 px-5 rounded-xl shadow-lg shadow-amber-950/40"
                    >
                      <Upload size={15} />
                      確認匯入還原
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      <InstallAppSection 
        isStandalone={isStandalone} 
        isInIframe={isInIframe} 
        isInstallable={isInstallable} 
        handleInstallClick={handleInstallClick} 
      />
    </div>
  );
}

const InstallAppSection = ({ isStandalone, isInIframe, isInstallable, handleInstallClick }: any) => (
  <Card className="bg-[#141414] border-neutral-800 rounded-3xl p-6 md:p-8 shadow-xl flex flex-col md:flex-row items-center gap-6">
    <div className="p-4 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
      <Download size={28} />
    </div>
    <div className="text-left flex-1 space-y-1">
      <h3 className="font-bold text-base text-white">安裝 Elite Trader 應用程式 (PWA)</h3>
      <p className="text-[11px] text-neutral-400 leading-relaxed">
        將應用程式加入主螢幕以獲得更穩定的離線存取與閃電般的啟動速度。即使在沒有網路的環境下，仍可正常記錄交易並於連線後同步。
      </p>
    </div>
    
    <div className="w-full md:w-auto shrink-0">
      {isStandalone ? (
        <div className="px-5 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2 font-mono text-xs">
          <ShieldCheck size={16} />
          <span className="font-bold uppercase tracking-wider">APP MODE ACTIVE</span>
        </div>
      ) : (
        isInIframe ? (
          <Button onClick={() => window.open(window.location.href, '_blank')} className="bg-white text-black hover:bg-neutral-200 h-11 rounded-xl text-xs font-bold px-8 cursor-pointer">開啟獨立分頁安裝</Button>
        ) : isInstallable ? (
          <Button onClick={handleInstallClick} className="bg-white text-black hover:bg-neutral-200 h-11 rounded-xl text-xs font-bold px-8 animate-pulse cursor-pointer">立即安裝</Button>
        ) : (
          <p className="text-[10px] text-neutral-500 italic">請使用瀏覽器選單「加入主畫面」</p>
        )
      )}
    </div>
  </Card>
);
