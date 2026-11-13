import React, { useState, useEffect } from 'react';
import { Transaction, Tag, StrategyChecklistItem } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Calendar, TrendingUp, TrendingDown, Star, DollarSign, ArrowLeft, Maximize2, Trash2, ShieldCheck, Check, ShieldAlert, Monitor as MonitorIcon, Download, ZoomIn, ZoomOut, RotateCcw, Loader2, AlertTriangle } from 'lucide-react';
import { cn, safeFormat, formatCurrency, getPnLColor } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { db, getBlobUrl, revokeBlobUrl, onBlobHydrated } from '../lib/db';
import { auth } from '../firebase';
import { dataService } from '../lib/dataService';
import { syncService } from '../lib/sync';
import { toast } from 'sonner';

interface TransactionDetailProps {
  transaction: Transaction;
  allTags: Tag[];
  checklistItems: StrategyChecklistItem[];
  onClose: () => void;
  onEdit: (t: Transaction) => void;
  onDelete: (id: string) => void;
  onUpdate?: (updated: Transaction) => void;
}

// --- Helper Components ---
const InfoItem = ({ label, value, icon: Icon, color }: any) => (
  <div className="space-y-1">
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Icon size={12} />
      <span className="text-[10px] uppercase tracking-widest font-black">{label}</span>
    </div>
    <div className={cn("text-sm font-black tracking-tighter", color)}>{value}</div>
  </div>
);

const ActivityIcon = ({ size, className }: any) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const TransactionDetail: React.FC<TransactionDetailProps> = ({
  transaction,
  allTags,
  checklistItems,
  onClose,
  onEdit,
  onDelete,
  onUpdate,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState<boolean>(true);
  const [imageError, setImageError] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [showDeleteImageConfirm, setShowDeleteImageConfirm] = useState(false);
  const [isDeletingImage, setIsDeletingImage] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoadingImage(true);
      setImageError(false);
      try {
        // 1. Try original high-res image
        if (transaction.imageOriginalId) {
          const url = await getBlobUrl(transaction.imageOriginalId);
          if (active && url) {
            setLocalImageUrl(url);
            setIsLoadingImage(false);
            return;
          }
        }
        // 2. Fallback to thumbnail if original not loaded
        if (transaction.imageThumbnailId) {
          const url = await getBlobUrl(transaction.imageThumbnailId);
          if (active && url) {
            setLocalImageUrl(url);
            setIsLoadingImage(false);
            return;
          }
        }
        // 3. Fallback to screenshots array
        if (transaction.screenshots?.[0]) {
          if (active) {
            setLocalImageUrl(transaction.screenshots[0]);
            setIsLoadingImage(false);
            return;
          }
        }
        if (active) {
          setLocalImageUrl(null);
          setIsLoadingImage(false);
        }
      } catch (err) {
        if (active) {
          setImageError(true);
          setIsLoadingImage(false);
        }
      }
    }
    load();
    const unsubHydrate = onBlobHydrated(() => {
      if (active) load();
    });
    return () => { 
      active = false;
      unsubHydrate();
    };
  }, [transaction.imageOriginalId, transaction.imageThumbnailId, transaction.screenshots]);

  // Keyboard shortcut support for full-screen viewer
  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImage(null);
      } else if (e.key === '=' || e.key === '+') {
        setZoomScale(prev => Math.min(3, prev + 0.25));
      } else if (e.key === '-' || e.key === '_') {
        setZoomScale(prev => Math.max(0.5, prev - 0.25));
      } else if (e.key === '0') {
        setZoomScale(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage]);

  const displayImage = localImageUrl || transaction.screenshots?.[0];

  const handleDownloadImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!displayImage) return;
    const a = document.createElement('a');
    a.href = displayImage;
    a.download = `Trade-${transaction.symbol}-${safeFormat(transaction.date, 'yyyyMMdd')}.webp`;
    a.click();
  };

  const handleDeleteImage = async () => {
    setIsDeletingImage(true);
    const toastId = toast.loading('正在刪除交易截圖...');
    try {
      // 1. Revoke and delete local blobs
      if (transaction.imageOriginalId) {
        revokeBlobUrl(transaction.imageOriginalId);
        await db.blobs.delete(transaction.imageOriginalId).catch(() => {});
      }
      if (transaction.imageThumbnailId) {
        revokeBlobUrl(transaction.imageThumbnailId);
        await db.blobs.delete(transaction.imageThumbnailId).catch(() => {});
      }

      // 2. Update trade in IndexedDB
      const updatedTrade: Transaction = {
        ...transaction,
        imageOriginalId: undefined,
        imageThumbnailId: undefined,
        screenshots: [],
        updatedAt: Date.now(),
        syncStatus: 'synced'
      };
      await dataService.saveTrade(updatedTrade, auth?.currentUser || null);

      // 3. Reset local states
      setLocalImageUrl(null);
      setSelectedImage(null);
      setShowDeleteImageConfirm(false);

      // 4. Trigger sync and notify parent
      syncService.queueSync('trades');
      if (onUpdate) {
        onUpdate(updatedTrade);
      }

      toast.success('交易截圖已成功刪除', { id: toastId });
    } catch (err) {
      console.error('刪除截圖失敗:', err);
      toast.error('刪除截圖失敗，請重試', { id: toastId });
    } finally {
      setIsDeletingImage(false);
    }
  };

  // Whitelist items based on global config (Rule 2 & 5)
  const activeIds = new Set(checklistItems.map(i => i.id));
  const filteredSnapshot = (transaction.checklistSnapshot || []).filter(item => activeIds.has(item.itemId));

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-emerald-600 dark:text-emerald-400";
    if (score >= 70) return "text-yellow-600 dark:text-yellow-400";
    if (score >= 50) return "text-red-600 dark:text-red-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground hover:text-foreground gap-2">
          <ArrowLeft size={16} /> 返回列表
        </Button>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onDelete(transaction.id)} 
            className="border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            <Trash2 size={16} className="mr-2" /> 刪除紀錄
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(transaction)} className="border-border hover:bg-accent">
            編輯紀錄
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-card border-border text-card-foreground shadow-sm">
          <CardHeader className="border-b border-border flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl font-black tracking-tight uppercase text-foreground">{transaction.symbol}</CardTitle>
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono">
                <Calendar size={12} />
                {safeFormat(transaction.date, 'yyyy年MM月dd日')}
              </div>
            </div>
            <div className={cn(
              "px-4 py-2 rounded-lg border font-mono text-lg font-black tracking-tight",
              transaction.uValue > 0 ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10" :
              transaction.uValue < 0 ? "text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10" :
              "text-muted-foreground border-border bg-muted/50"
            )}>
              {formatCurrency(transaction.uValue)}
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <InfoItem 
                label="方向" 
                value={transaction.side === 'Long' ? '多 (LONG)' : '空 (SHORT)'} 
                icon={transaction.side === 'Long' ? TrendingUp : TrendingDown}
                color={transaction.side === 'Long' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
              />
              <InfoItem 
                label="評分" 
                value={`等級 ${transaction.rating}`} 
                icon={Star}
                color="text-foreground"
              />
                <InfoItem 
                  label="狀態" 
                  value={transaction.result === 'Profit' ? '盈利' : transaction.result === 'Loss' ? '虧損' : '進行中'} 
                  icon={ActivityIcon}
                  color={transaction.result === 'Profit' ? 'text-emerald-600 dark:text-emerald-400' : transaction.result === 'Loss' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}
                />
              <InfoItem 
                label="盈虧金額" 
                value={formatCurrency(transaction.uValue)} 
                icon={DollarSign}
                color={getPnLColor(transaction.uValue)}
              />
            </div>

            <div className="space-y-6">
              {transaction.checklistScore !== undefined && transaction.checklistSnapshot && transaction.checklistSnapshot.length > 0 && (
                <section className="space-y-4 p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] uppercase tracking-[0.2em] text-primary font-extrabold flex items-center gap-2">
                      <ShieldCheck size={14} /> 出手前紀律核對
                    </h3>
                    <div className="flex items-center gap-4">
                      {transaction.forceSubmit && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] font-black uppercase">
                          <ShieldAlert size={10} /> 違規強制提交
                        </div>
                      )}
                      <div className={cn("text-lg font-black font-mono", getScoreColor(transaction.checklistScore))}>
                        {transaction.checklistScore}%
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredSnapshot.map((item, idx) => (
                      <div key={`snapshot-${idx}`} className="flex items-center gap-2 text-xs">
                        <div className={cn(
                          "w-4 h-4 rounded flex items-center justify-center",
                          item.checked ? "bg-primary text-white" : "border border-neutral-300 text-transparent"
                        )}>
                          <Check size={10} strokeWidth={4} />
                        </div>
                        <span className={cn(item.checked ? "text-foreground font-medium" : "text-neutral-400")}>
                          {item.text}
                          {item.required && <span className="ml-1 text-[8px] text-red-500 opacity-70">(必)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {transaction.tagIds && transaction.tagIds.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-bold">市場特徵與技術訊號 (Signals)</h3>
                  <div className="flex flex-wrap gap-2">
                    {transaction.tagIds.map((id, idx) => {
                      const tag = allTags.find(t => t.id === id);
                      if (!tag) return null;
                      return (
                        <span key={`${transaction.id}-${id}-${idx}`} className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 text-xs rounded-full border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400">
                          {tag.name}
                        </span>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-bold">進場理由</h3>
                <p className="text-sm text-black leading-relaxed bg-white p-4 rounded-lg border border-neutral-200">
                  {transaction.entryReason || '未填寫'}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-bold">止損計畫 / 原因</h3>
                <p className="text-sm text-black leading-relaxed bg-white p-4 rounded-lg border border-neutral-200">
                  {transaction.stopLossReason || '未填寫'}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-bold">復盤總結</h3>
                <p className="text-sm text-black leading-relaxed bg-white p-4 rounded-lg border border-neutral-200">
                  {transaction.review || '未填寫'}
                </p>
              </section>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="bg-card border-border">
            <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs uppercase tracking-widest text-neutral-500">交易截圖</CardTitle>
              {displayImage && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadImage}
                    className="h-7 text-xs text-neutral-400 hover:text-white gap-1.5 px-2"
                  >
                    <Download size={13} /> 下載
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteImageConfirm(true)}
                    className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5 px-2"
                  >
                    <Trash2 size={13} /> 刪除圖片
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-4">
              {isLoadingImage ? (
                <div className="py-20 flex flex-col items-center justify-center text-neutral-500 gap-3 border border-neutral-800 rounded-xl bg-black/40">
                  <Loader2 size={24} className="animate-spin text-neutral-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">正在載入清晰圖檔...</span>
                </div>
              ) : displayImage && !imageError ? (
                <div className="grid grid-cols-1 gap-4">
                  <div 
                    className="relative group rounded-lg overflow-hidden border border-neutral-800 cursor-zoom-in bg-black/40" 
                    onClick={() => {
                      setZoomScale(1);
                      setSelectedImage(displayImage);
                    }}
                  >
                    <img 
                      src={displayImage} 
                      alt="Trade Screenshot" 
                      decoding="async"
                      className="w-full h-auto object-contain max-h-[420px]" 
                      onError={() => setImageError(true)}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <span className="px-3 py-1.5 rounded-full bg-black/80 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur-md border border-white/10">
                        <Maximize2 size={14} /> 點擊全螢幕清晰檢視 (支援快捷鍵 +/- 縮放, Esc 退出)
                      </span>
                    </div>
                  </div>
                </div>
              ) : imageError ? (
                <div className="py-16 flex flex-col items-center justify-center text-neutral-500 gap-3 border border-dashed border-red-900/40 rounded-xl bg-red-950/10">
                  <AlertTriangle size={28} className="text-red-400 opacity-80" />
                  <span className="text-xs font-bold text-red-400">圖片檔案載入失敗或已損毀</span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setImageError(false);
                      setIsLoadingImage(true);
                      if (transaction.imageOriginalId) {
                        getBlobUrl(transaction.imageOriginalId).then(u => {
                          setLocalImageUrl(u);
                          setIsLoadingImage(false);
                        });
                      }
                    }}
                    className="text-xs border-neutral-700 text-neutral-300"
                  >
                    重新整理載入
                  </Button>
                </div>
              ) : (
                <div className="py-20 flex flex-col items-center justify-center text-muted-foreground gap-3 border border-dashed border-border rounded-xl">
                  <MonitorIcon size={32} className="opacity-30" />
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-60">無截圖紀錄</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 md:p-8 select-none"
            onClick={() => setSelectedImage(null)}
          >
            {/* Top Toolbar */}
            <div 
              className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900/90 border border-neutral-700/80 backdrop-blur-md z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-neutral-300 hover:text-white"
                onClick={() => setZoomScale(prev => Math.max(0.5, prev - 0.25))}
                title="縮小"
              >
                <ZoomOut size={16} />
              </Button>
              <span className="text-xs font-mono text-neutral-400 min-w-[45px] text-center font-bold">
                {Math.round(zoomScale * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-neutral-300 hover:text-white"
                onClick={() => setZoomScale(prev => Math.min(3, prev + 0.25))}
                title="放大"
              >
                <ZoomIn size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-neutral-300 hover:text-white"
                onClick={() => setZoomScale(1)}
                title="重設大小"
              >
                <RotateCcw size={14} />
              </Button>
              <div className="w-[1px] h-4 bg-neutral-700 mx-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-neutral-300 hover:text-white gap-1 px-2"
                onClick={handleDownloadImage}
                title="下載圖片"
              >
                <Download size={14} />
                <span>儲存</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/20 gap-1 px-2"
                onClick={() => setShowDeleteImageConfirm(true)}
                title="刪除截圖"
              >
                <Trash2 size={14} />
                <span>刪除</span>
              </Button>
            </div>

            {/* Close button */}
            <button 
              className="absolute top-5 right-5 p-2 rounded-full bg-neutral-900/80 hover:bg-neutral-800 text-white/70 hover:text-white transition-all border border-neutral-700 z-10"
              onClick={() => setSelectedImage(null)}
            >
              <X size={22} />
            </button>

            {/* Scrollable image container for high zoom */}
            <div 
              className="w-full h-full flex items-center justify-center overflow-auto p-4"
              onClick={() => setSelectedImage(null)}
            >
              <motion.img
                initial={{ scale: 0.95 }}
                animate={{ scale: zoomScale }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                src={selectedImage}
                className="max-w-full max-h-full object-contain rounded shadow-2xl transition-transform"
                style={{ cursor: zoomScale > 1 ? 'grab' : 'zoom-in' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomScale(prev => (prev === 1 ? 1.75 : 1));
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal for Image Deletion */}
      <AnimatePresence>
        {showDeleteImageConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={() => setShowDeleteImageConfirm(false)}
          >
            <div 
              className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-red-400">
                <div className="p-2.5 rounded-full bg-red-500/10 border border-red-500/20">
                  <Trash2 size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">刪除交易截圖</h4>
                  <p className="text-xs text-neutral-400 mt-0.5">確定要刪除這張交易截圖嗎？</p>
                </div>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                此操作將會永久從本地儲存及同步紀錄中清除此張圖片，交易數據與其餘欄位將會完整保留。
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteImageConfirm(false)}
                  disabled={isDeletingImage}
                  className="text-neutral-400 hover:text-white"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleDeleteImage}
                  disabled={isDeletingImage}
                  className="bg-red-600 hover:bg-red-500 text-white gap-1.5"
                >
                  {isDeletingImage ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      正在刪除...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      確認刪除
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
