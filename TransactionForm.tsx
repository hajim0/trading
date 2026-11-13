import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Transaction, Side, Result, Rating, Tag, StrategyTemplate, StrategyChecklistItem, ChecklistSnapshotItem, DisciplineMode, DisciplineGrades } from '../types';
import { TagInput } from './TagInput';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  ImagePlus, X, Calendar as CalendarIcon, RefreshCw, 
  AlertCircle, ShieldCheck, ListChecks, ChevronDown, 
  ChevronUp, Check, Zap, BarChart2, ShieldAlert, Lock, Lock as LockIcon 
} from 'lucide-react';
import { logger } from '../lib/logger';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn, safeFormat, getLocalDateString, parseLocalDate, calculateGrade } from '@/lib/utils';
import { toast } from 'sonner';
import { auth, storage } from '../firebase';
import { db, saveBlob, getBlobUrl, revokeBlobUrl, blobToBase64, onBlobHydrated } from '../lib/db';
import { dataService } from '../lib/dataService';
import { syncService } from '../lib/sync';
import { generateThumbnail, compressImage, validateImage, formatBytes, ensureFirestoreSafeBlob } from '../lib/imageUtils';
import { Loader2, UploadCloud, Monitor as MonitorIcon, Eye, CheckCircle2, Trash2 } from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';

interface TransactionFormProps {
  onSubmit: (data: Partial<Transaction>) => Promise<void>;
  initialData?: Transaction;
  onCancel: () => void;
  allTags: Tag[];
  onAddGlobalTag: (tagName: string) => Promise<Tag>;
  canManageTags?: boolean;
  strategies?: StrategyTemplate[];
  checklistItems?: StrategyChecklistItem[];
  disciplineMode?: DisciplineMode;
  disciplineGrades?: DisciplineGrades;
  globalStrategyOnly?: boolean;
}

export const TransactionForm: React.FC<TransactionFormProps> = React.memo(({
  onSubmit,
  initialData,
  onCancel,
  allTags,
  onAddGlobalTag,
  canManageTags = true,
  strategies = [],
  checklistItems = [],
  disciplineMode = 'semi',
  disciplineGrades = { S: 90, A: 80, B: 70 },
  globalStrategyOnly = false,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<'validating' | 'compressing' | 'uploading' | 'done' | 'idle'>('idle');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const [imageCompressionInfo, setImageCompressionInfo] = useState<{ originalSize: number; compressedSize: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);

  // Load local image preview if exists (prefer original for sharpness, fallback to thumbnail or screenshots)
  React.useEffect(() => {
    let active = true;
    async function loadPreview() {
      if (initialData?.imageOriginalId) {
        const url = await getBlobUrl(initialData.imageOriginalId);
        if (active && url) {
          setLocalImageUrl(url);
          return;
        }
      }
      if (initialData?.imageThumbnailId) {
        const url = await getBlobUrl(initialData.imageThumbnailId);
        if (active && url) {
          setLocalImageUrl(url);
          return;
        }
      }
      if (initialData?.screenshots?.[0]) {
        if (active) setLocalImageUrl(initialData.screenshots[0]);
      }
    }
    loadPreview();
    const unsubHydrate = onBlobHydrated(() => {
      if (active) loadPreview();
    });
    return () => {
      active = false;
      unsubHydrate();
    };
  }, [initialData]);

  // Core reusable file processing function
  const processImageFile = async (file: File) => {
    const validation = validateImage(file);
    if (!validation.valid) {
      toast.error(validation.error || '無效的圖片檔案');
      return;
    }

    setUploadStage('compressing');
    setIsUploading(true);

    try {
      // 1. High-clarity compression + lightweight thumbnail
      const [rawOriginalBlob, thumbBlob] = await Promise.all([
        compressImage(file, 2048, 2048, 0.82),
        generateThumbnail(file)
      ]);
      const originalBlob = await ensureFirestoreSafeBlob(rawOriginalBlob);

      // 2. Save both Blobs to IndexedDB and encode lightweight thumbnail Base64
      const [originalId, thumbId, thumbBase64] = await Promise.all([
        saveBlob(originalBlob, 'original'),
        saveBlob(thumbBlob, 'thumbnail'),
        blobToBase64(thumbBlob)
      ]);

      // 3. Immediately create/get reliable display URL from the compressed blob
      const displayUrl = await getBlobUrl(originalId);
      if (displayUrl) {
        setLocalImageUrl(displayUrl);
      }

      setImageCompressionInfo({
        originalSize: file.size,
        compressedSize: originalBlob.size
      });

      // 4. Update Form State (store lightweight thumbnail Base64 in screenshots for immediate cross-device display)
      setFormData(prev => ({
        ...prev,
        imageOriginalId: originalId,
        imageThumbnailId: thumbId,
        localOnly: true,
        screenshots: thumbBase64 && thumbBase64.length <= 220_000 ? [thumbBase64] : []
      }));

      const ratio = Math.round((1 - originalBlob.size / file.size) * 100);
      toast.success(`圖片已壓縮優化 (節省 ${ratio > 0 ? ratio : 0}% 空間)`);
    } catch (err) {
      console.error("[LocalDB] Image processing failed:", err);
      toast.error("圖片壓縮處理失敗，請重試");
    } finally {
      setIsUploading(false);
      setUploadStage('idle');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processImageFile(files[0]);
    if (e.target) e.target.value = '';
  };

  const handleDropImage = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveImage = async () => {
    // If a newly generated blob in this editing session exists and wasn't part of initialData, delete immediately
    if (formData.imageOriginalId && formData.imageOriginalId !== initialData?.imageOriginalId) {
      revokeBlobUrl(formData.imageOriginalId);
      await db.blobs.delete(formData.imageOriginalId).catch(() => {});
    }
    if (formData.imageThumbnailId && formData.imageThumbnailId !== initialData?.imageThumbnailId) {
      revokeBlobUrl(formData.imageThumbnailId);
      await db.blobs.delete(formData.imageThumbnailId).catch(() => {});
    }
    setLocalImageUrl(null);
    setImageCompressionInfo(null);
    setFormData(prev => ({ ...prev, imageOriginalId: undefined, imageThumbnailId: undefined, screenshots: [] }));
    toast.info("已移除交易截圖 (儲存後生效)");
  };

  // Support clipboard paste (Ctrl+V / Cmd+V) anywhere on the form
  React.useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            toast.info('已自剪貼簿取得截圖，正在壓縮處理...');
            await processImageFile(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);
  const defaultData: Partial<Transaction> = {
    symbol: '',
    date: getLocalDateString(),
    side: 'Long',
    result: 'Open',
    rating: 'B',
    uValue: 0,
    stopLossReason: '',
    entryReason: '',
    review: '',
    tagIds: [],
    screenshots: [],
    strategyId: '',
    checklistScore: 0,
    passedRequiredCheck: true,
    missingRequiredItems: [],
    checklistSnapshot: [],
  };

  const [formData, setFormData] = useState<Partial<Transaction>>({
    ...defaultData,
    ...initialData
  });

  const [isLossMode, setIsLossMode] = useState<boolean>(() => {
    if (initialData?.uValue && initialData.uValue < 0) return true;
    if (initialData?.result === 'Loss') return true;
    return false;
  });

  const [rawUValue, setRawUValue] = useState<string>(() => {
    if (initialData?.uValue !== undefined) {
      return initialData.uValue === 0 ? '' : Math.abs(initialData.uValue).toString();
    }
    return '';
  });

  const [calculatedRating, setCalculatedRating] = useState<Rating>(() => {
    return calculateGrade(initialData?.checklistScore || 0, disciplineGrades);
  });

  // Local state for text fields to prevent typing lag
  const [localSymbol, setLocalSymbol] = useState(formData.symbol || '');
  const [localEntryReason, setLocalEntryReason] = useState(formData.entryReason || '');
  const [localStopLossReason, setLocalStopLossReason] = useState(formData.stopLossReason || '');
  const [localReview, setLocalReview] = useState(formData.review || '');

  const handleBlurText = (field: keyof Transaction, localValue: string) => {
    setFormData(prev => ({ ...prev, [field]: localValue }));
  };

  const [isChecklistExpanded, setIsChecklistExpanded] = useState(true);
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(() => {
    if (initialData?.checklistSnapshot) {
      return new Set(initialData.checklistSnapshot.filter(i => i.checked).map(i => i.itemId));
    }
    return new Set();
  });

  // Calculate current strategy metrics
  const currentStrategyItems = useMemo(() => {
    if (!formData.strategyId) return [];
    return checklistItems
      .filter(item => item.templateId === formData.strategyId && item.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [formData.strategyId, checklistItems]);

  const metrics = useMemo(() => {
    if (currentStrategyItems.length === 0) return { score: 0, passed: true, missing: [] };

    let totalWeight = 0;
    let checkedWeight = 0;
    const missing: string[] = [];
    let allRequiredChecked = true;

    currentStrategyItems.forEach(item => {
      totalWeight += item.weight;
      const isChecked = checkedItemIds.has(item.id);
      if (isChecked) {
        checkedWeight += item.weight;
      } else if (item.required) {
        allRequiredChecked = false;
        missing.push(item.text);
      }
    });

    const score = totalWeight > 0 ? Math.round((checkedWeight / totalWeight) * 100) : 0;
    
    return { score, passed: allRequiredChecked, missing };
  }, [currentStrategyItems, checkedItemIds]);

  // Auto-select strategy if global mode is on
  React.useEffect(() => {
    if (globalStrategyOnly && strategies.length > 0 && !formData.strategyId) {
      setFormData(prev => ({ ...prev, strategyId: strategies[0].id }));
    }
  }, [globalStrategyOnly, strategies, formData.strategyId]);

  // Sync calculated rating whenever score or grades change
  React.useEffect(() => {
    setCalculatedRating(calculateGrade(metrics.score, disciplineGrades));
  }, [metrics.score, disciplineGrades]);

  const handleToggleCheck = (itemId: string) => {
    setCheckedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.symbol?.trim()) {
      newErrors.symbol = '請輸入幣種 / 商品名稱';
    }
    if (!formData.date) {
      newErrors.date = '請選擇日期';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddTag = async (tagName: string) => {
    try {
      const newTag = await onAddGlobalTag(tagName);
      setFormData(prev => ({
        ...prev,
        tagIds: [...(prev.tagIds || []), newTag.id]
      }));
    } catch (error) {
      console.error('Failed to add tag:', error);
      toast.error('新增標籤失敗');
    }
  };

  const handleSelectTag = (tagId: string) => {
    if (!formData.tagIds?.includes(tagId)) {
      setFormData(prev => ({
        ...prev,
        tagIds: [...(prev.tagIds || []), tagId]
      }));
    }
  };

  const handleRemoveTag = (tagId: string) => {
    setFormData(prev => ({
      ...prev,
      tagIds: prev.tagIds?.filter(id => id !== tagId)
    }));
  };

  const removeImage = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      screenshots: prev.screenshots?.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (isSubmitting || isUploading) return;
    
    if (!validate()) {
      toast.error("請填寫必填欄位");
      return;
    }

    // --- Discipline Mode Logic ---
    if (formData.strategyId && currentStrategyItems.length > 0) {
      if (!metrics.passed) {
        if (disciplineMode === 'strict') {
          toast.error(`嚴格模式：您還有 ${metrics.missing.length} 項必要規範未達成，無法儲存交易紀錄。`);
          return;
        }
        
        if (disciplineMode === 'semi' && !showConfirmDialog) {
          setShowConfirmDialog(true);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setShowConfirmDialog(false);
    const toastId = toast.loading(initialData ? "正在更新交易 (本地)..." : "正在儲存交易 (本地)...");

    try {
      const numericU = parseFloat(rawUValue) || 0;
      const finalSignedU = isLossMode ? -Math.abs(numericU) : Math.abs(numericU);

      const snapshot: ChecklistSnapshotItem[] = currentStrategyItems.map(item => ({
        itemId: item.id,
        text: item.text,
        weight: item.weight,
        required: item.required,
        checked: checkedItemIds.has(item.id),
        sortOrder: item.sortOrder
      }));

      const finalData: Transaction = {
        ...formData,
        id: initialData?.id || crypto.randomUUID(),
        userId: auth.currentUser?.uid || 'local-user',
        symbol: localSymbol,
        entryReason: localEntryReason,
        stopLossReason: localStopLossReason,
        review: localReview,
        uValue: finalSignedU,
        rating: calculatedRating,
        checklistScore: metrics.score,
        passedRequiredCheck: metrics.passed,
        missingRequiredItems: metrics.missing,
        checklistSnapshot: snapshot,
        modeUsed: disciplineMode,
        createdAt: initialData?.createdAt || Date.now(),
        updatedAt: Date.now(),
        localOnly: true,
        syncStatus: 'pending'
      } as Transaction;

      // SAVE TO IndexedDB and Cloud Firestore
      await dataService.saveTrade(finalData, auth?.currentUser || null);

      // Clean up previous blobs if image was removed or replaced
      if (initialData?.imageOriginalId && initialData.imageOriginalId !== finalData.imageOriginalId) {
        revokeBlobUrl(initialData.imageOriginalId);
        await db.blobs.delete(initialData.imageOriginalId).catch(() => {});
      }
      if (initialData?.imageThumbnailId && initialData.imageThumbnailId !== finalData.imageThumbnailId) {
        revokeBlobUrl(initialData.imageThumbnailId);
        await db.blobs.delete(initialData.imageThumbnailId).catch(() => {});
      }
      
      toast.success(initialData ? "交易紀錄已更新並同步" : "交易紀錄已儲存並同步", { id: toastId });
      
      await onSubmit(finalData);
      onCancel();
    } catch (err) {
      console.error("[dataService] Save failed", err);
      toast.error(`儲存失敗：${err instanceof Error ? err.message : '請檢查網路與資料庫狀態'}`, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-[#22C55E]";
    if (score >= 70) return "text-yellow-500";
    if (score >= 50) return "text-[#EF4444]";
    return "text-[#EF4444]";
  };

  return (
    <Card className="bg-card border-border text-card-foreground max-w-2xl mx-auto shadow-sm relative overflow-hidden">
      <AnimatePresence>
        {isUploading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-background/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="w-full max-w-xs space-y-6">
              <div className="relative mx-auto w-16 h-16">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-t-2 border-primary rounded-full"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <UploadCloud className="text-primary w-6 h-6" />
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-lg font-black uppercase tracking-tight text-foreground">
                  {uploadStage === 'validating' && "檢查檔案中..."}
                  {uploadStage === 'compressing' && "正在優化圖片容量..."}
                  {uploadStage === 'uploading' && "正在同步至雲端系統"}
                  {uploadStage === 'done' && "同步完成"}
                  {uploadStage === 'idle' && "準備中..."}
                </h3>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                  完成進度 ({uploadProgress}%)
                </p>
              </div>

              <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                  className="bg-primary h-full"
                />
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-black tracking-tight uppercase text-foreground">
          {initialData ? '編輯交易紀錄' : '新增交易紀錄'}
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="p-6 space-y-8">
          {/* Section: Discipline Rules */}
          <div className="space-y-4 p-4 rounded-xl bg-muted/30 border border-border">
            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] font-black flex items-center gap-2">
                <ShieldCheck size={14} /> {globalStrategyOnly ? "紀律規範核對 (Global Rule)" : "核心紀律規範 (Rule Template)"}
              </Label>
              {!globalStrategyOnly ? (
                <Select
                  value={formData.strategyId || ''}
                  onValueChange={(value) => {
                    setFormData({ ...formData, strategyId: value });
                    setCheckedItemIds(new Set()); // Reset checks when switching strategy
                  }}
                >
                  <SelectTrigger className="bg-background text-foreground border-border focus:ring-0 focus:ring-offset-0 h-11 font-bold">
                    <SelectValue placeholder="選擇適用的紀律規範模板..." />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl">
                    <SelectItem value="">不使用規範模板 (自由交易)</SelectItem>
                    {strategies.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="h-11 flex items-center px-4 rounded-md border border-border bg-muted/50 text-xs font-bold text-muted-foreground">
                  <Lock size={12} className="mr-2 opacity-50" />
                  套用全域規範：{strategies[0]?.name || '載入中...'}
                </div>
              )}
            </div>

            <AnimatePresence>
              {formData.strategyId && currentStrategyItems.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border border-border rounded-lg bg-card"
                >
                  <div className="p-3 border-b border-border flex items-center justify-between cursor-pointer group" onClick={() => setIsChecklistExpanded(!isChecklistExpanded)}>
                    <div className="flex items-center gap-2">
                      <ListChecks className="text-muted-foreground h-4 w-4" />
                      <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">出手前紀律核對</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={cn("text-base font-black font-mono", getScoreColor(metrics.score))}>
                        DISCIPLINE: {metrics.score}%
                      </div>
                      {isChecklistExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                  
                  {isChecklistExpanded && (
                    <div className="p-3 space-y-3">
                      <div className="grid grid-cols-1 gap-2">
                        {currentStrategyItems.map(item => (
                          <div 
                            key={item.id} 
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-lg transition-all cursor-pointer border",
                              checkedItemIds.has(item.id) ? "bg-emerald-500/10 border-emerald-500/30" : "bg-card border-border hover:border-primary/50"
                            )}
                            onClick={() => handleToggleCheck(item.id)}
                          >
                            <div className={cn(
                              "w-4 h-4 rounded-sm flex items-center justify-center transition-colors border",
                              checkedItemIds.has(item.id) ? "bg-emerald-500 border-emerald-500" : "border-border bg-background"
                            )}>
                              {checkedItemIds.has(item.id) && <Check size={12} className="text-white font-black" />}
                            </div>
                            <div className="flex-1">
                              <p className={cn("text-xs font-bold uppercase tracking-tight text-foreground", !checkedItemIds.has(item.id) && "text-muted-foreground")}>
                                {item.text}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {item.required && <span className="text-[8px] px-1.5 py-0.5 bg-destructive/10 text-destructive rounded font-black uppercase">必達</span>}
                              <span className="text-[10px] font-mono text-muted-foreground font-bold">W{item.weight}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-2 p-2 bg-muted/40 rounded flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-widest font-black">
                         <span className="text-muted-foreground">符合: {checkedItemIds.size} / {currentStrategyItems.length}</span>
                         {!metrics.passed && (
                           <span className="text-[#EF4444] flex items-center gap-1">
                             <AlertCircle size={10} /> 缺失必要項: {metrics.missing.length}
                           </span>
                         )}
                         {metrics.passed && checkedItemIds.size > 0 && (
                           <span className="text-[#22C55E] flex items-center gap-1">
                             <ShieldCheck size={10} /> 紀律檢核通過
                           </span>
                         )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Section: Symbol & Meta */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[#3A3A3A] mb-2">
              <Zap size={14} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">交易資訊</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className={cn(
                "text-[10px] uppercase tracking-widest font-black",
                errors.symbol ? "text-red-500" : "text-muted-foreground"
              )}>
                幣種 / 商品
              </Label>
              <div className="relative">
                <Input
                  placeholder="BTC, ETH, XAU..."
                  value={localSymbol}
                  maxLength={10}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase().slice(0, 10);
                    setLocalSymbol(val);
                    if (errors.symbol) setErrors(prev => ({ ...prev, symbol: '' }));
                  }}
                  onBlur={() => handleBlurText('symbol', localSymbol)}
                  className={cn(
                    "bg-background text-foreground border-border focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 h-11 pr-16 font-black uppercase tracking-tight",
                    errors.symbol && "border-red-500"
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60 font-mono">
                  {localSymbol.length}/10
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className={cn(
                "text-[10px] uppercase tracking-widest font-black",
                errors.date ? "text-red-500" : "text-muted-foreground"
              )}>
                交易日期
              </Label>
              <Popover>
                <PopoverTrigger
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-start text-left font-bold bg-background text-foreground border-border hover:bg-muted h-11",
                    !formData.date && "text-muted-foreground/50",
                    errors.date && "border-red-500 text-red-500"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {formData.date ? safeFormat(formData.date, "PPP") : <span>選擇日期</span>}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover border-border text-popover-foreground shadow-xl">
                  <Calendar
                    mode="single"
                  selected={formData.date ? parseLocalDate(formData.date) : undefined}
                  onSelect={(date) => {
                    setFormData({ ...formData, date: date ? getLocalDateString(date) : '' });
                    if (errors.date) setErrors(prev => ({ ...prev, date: '' }));
                  }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">方向</Label>
              <Select
                value={formData.side || 'Long'}
                onValueChange={(value: Side) => setFormData({ ...formData, side: value })}
              >
                <SelectTrigger className="bg-background text-foreground border-border focus:ring-0 h-11 font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl">
                  <SelectItem value="Long">LONG (多)</SelectItem>
                  <SelectItem value="Short">SHORT (空)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">盈虧結果</Label>
              <Select
                value={formData.result || 'Open'}
                onValueChange={(value: Result) => {
                  setFormData({ ...formData, result: value });
                  if (value === 'Profit') setIsLossMode(false);
                  if (value === 'Loss') setIsLossMode(true);
                }}
              >
                <SelectTrigger className="bg-background text-foreground border-border focus:ring-0 h-11 font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl">
                  <SelectItem value="Profit" className="text-emerald-600 dark:text-emerald-400 font-bold">PROFIT (+)</SelectItem>
                  <SelectItem value="Loss" className="text-red-600 dark:text-red-400 font-bold">LOSS (-)</SelectItem>
                  <SelectItem value="Open" className="text-muted-foreground font-bold">OPEN (進行中)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">執行評分 (Auto)</Label>
              <div className={cn(
                "h-11 flex items-center px-4 rounded-md border font-black tabular-nums transition-all border-border bg-muted/40",
                calculatedRating === 'S' ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30" :
                calculatedRating === 'A' ? "text-blue-500 border-blue-500/30" :
                calculatedRating === 'B' ? "text-amber-500 border-amber-500/30" :
                "text-red-500 border-red-500/30"
              )}>
                {calculatedRating ? `Grade ${calculatedRating}` : '--'}
              </div>
              <p className="text-[9px] text-muted-foreground italic">由紀律分數 ({metrics.score}%) 自動計算得出</p>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">u 盈虧金額</Label>
              <div className="flex gap-2">
                <div className="flex bg-muted border border-border rounded-md p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLossMode(false);
                      setFormData(prev => ({ ...prev, result: 'Profit' }));
                    }}
                    className={cn(
                      "px-3 py-1 text-[10px] font-black uppercase tracking-tight rounded transition-all",
                      !isLossMode ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Profit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsLossMode(true);
                      setFormData(prev => ({ ...prev, result: 'Loss' }));
                    }}
                    className={cn(
                      "px-3 py-1 text-[10px] font-black uppercase tracking-tight rounded transition-all",
                      isLossMode ? "bg-red-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Loss
                  </button>
                </div>
                <div className="relative flex-1">
                  <span className={cn(
                    "absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-black",
                    isLossMode ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  )}>
                    {isLossMode ? '-' : '+'}
                  </span>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={rawUValue}
                    onFocus={(e) => {
                      if (rawUValue === '0') {
                        setRawUValue('');
                      } else {
                        e.target.select();
                      }
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Handle direct minus/plus input if they type it
                      if (val.startsWith('-')) {
                        setIsLossMode(true);
                        setFormData(prev => ({ ...prev, result: 'Loss' }));
                        setRawUValue(val.replace('-', ''));
                      } else if (val.startsWith('+')) {
                        setIsLossMode(false);
                        setFormData(prev => ({ ...prev, result: 'Profit' }));
                        setRawUValue(val.replace('+', ''));
                      } else {
                        setRawUValue(val);
                      }
                    }}
                    className={cn(
                      "bg-background text-foreground border-border font-mono focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 h-11 pl-7 font-black",
                      isLossMode ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

          {/* Section: Signals & Reasons */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <BarChart2 size={14} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">技術訊號與復盤</span>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">
                  標籤 (例如: FVG, MSS, OB)
                </Label>
                <TagInput
                  selectedTagIds={formData.tagIds || []}
                  allTags={allTags}
                  onAddTag={handleAddTag}
                  onSelectTag={handleSelectTag}
                  onRemoveTag={handleRemoveTag}
                  canAddTag={canManageTags}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">進場邏輯</Label>
                  <span className="text-[9px] text-muted-foreground/60 font-mono">{localEntryReason.length}/150</span>
                </div>
                <Textarea
                  placeholder="為什麼要在這裡出手..."
                  value={localEntryReason}
                  maxLength={150}
                  onChange={(e) => setLocalEntryReason(e.target.value.slice(0, 150))}
                  onBlur={() => handleBlurText('entryReason', localEntryReason)}
                  className="bg-background text-foreground border-border min-h-[100px] focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 font-medium"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">止損原因</Label>
              <span className="text-[9px] text-muted-foreground/60 font-mono">{localStopLossReason.length}/150</span>
            </div>
            <Textarea
              placeholder="止損或減倉計畫..."
              value={localStopLossReason}
              maxLength={150}
              onChange={(e) => setLocalStopLossReason(e.target.value.slice(0, 150))}
              onBlur={() => handleBlurText('stopLossReason', localStopLossReason)}
              className="bg-background text-foreground border-border min-h-[100px] focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 font-medium"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">復盤</Label>
              <span className="text-[9px] text-muted-foreground/60 font-mono">{localReview.length}/150</span>
            </div>
            <Textarea
              placeholder="總結心得..."
              value={localReview}
              maxLength={150}
              onChange={(e) => setLocalReview(e.target.value.slice(0, 150))}
              onBlur={() => handleBlurText('review', localReview)}
              className="bg-background text-foreground border-border min-h-[120px] focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/50 font-medium"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-[#A0A0A0] uppercase tracking-widest font-black flex items-center gap-2">
                <ImagePlus size={14} /> 交易截圖 (高畫質壓縮保存)
              </Label>
              <div className="flex items-center gap-2">
                {imageCompressionInfo && (
                  <span className="text-[9px] text-[#22C55E] font-mono flex items-center gap-1">
                    <CheckCircle2 size={11} />
                    已壓縮: {formatBytes(imageCompressionInfo.originalSize)} → {formatBytes(imageCompressionInfo.compressedSize)}
                  </span>
                )}
                {(localImageUrl || formData.screenshots?.[0]) && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="text-[10px] text-red-400 hover:text-red-300 font-bold flex items-center gap-1 hover:underline transition-colors ml-2"
                    title="刪除此交易截圖"
                  >
                    <Trash2 size={12} />
                    刪除圖片
                  </button>
                )}
              </div>
            </div>

            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={handleDropImage}
              className={cn(
                "relative group aspect-video bg-muted/20 rounded-xl overflow-hidden border transition-all flex items-center justify-center",
                isDraggingOver ? "border-primary bg-primary/10 scale-[1.01]" : "border-border hover:border-primary/50"
              )}
            >
              {localImageUrl || formData.screenshots?.[0] ? (
                <>
                  <img
                    src={localImageUrl || formData.screenshots?.[0]}
                    alt="Trade Preview"
                    className="w-full h-full object-contain cursor-zoom-in"
                    onClick={() => setShowFullPreview(true)}
                  />
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10">
                    <button
                      type="button"
                      onClick={() => setShowFullPreview(true)}
                      className="p-2 bg-black/70 hover:bg-black/90 rounded-full text-white backdrop-blur-sm border border-white/10"
                      title="放大檢視"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="px-2.5 py-1.5 bg-red-600/80 hover:bg-red-600 rounded-full text-white text-xs font-bold flex items-center gap-1 transition-all backdrop-blur-sm border border-white/10 shadow-lg"
                      title="刪除此截圖"
                    >
                      <Trash2 size={13} />
                      <span>刪除圖片</span>
                    </button>
                  </div>
                  <div className="absolute bottom-2 left-3 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] bg-black/75 px-2 py-0.5 rounded text-neutral-300 font-mono border border-white/10">
                      點擊圖片放大檢視
                    </span>
                  </div>
                </>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-accent/40 transition-all p-4 text-center">
                  <div className="p-4 rounded-full bg-muted border border-border mb-2.5 group-hover:scale-105 group-hover:border-primary/40 transition-all">
                    <ImagePlus className="w-7 h-7 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <span className="text-[11px] text-foreground font-bold tracking-wider mb-1">
                    點擊上傳、拖放檔案，或直接按 Ctrl+V 貼上
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    自動採 WebP/雙向降採樣技術：保持 K 線與數值清晰，每張僅約 80KB 不占空間
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              )}

              {isUploading && (
                <div className="absolute inset-0 bg-background/85 flex flex-col items-center justify-center backdrop-blur-md z-20">
                  <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
                  <span className="text-xs text-foreground font-bold tracking-wider">正在無失真壓縮 K 線細節...</span>
                  <span className="text-[9px] text-muted-foreground mt-1">產生清晰原圖與極速縮圖</span>
                </div>
              )}
            </div>

            {/* Modal preview within form */}
            <AnimatePresence>
              {showFullPreview && (localImageUrl || formData.screenshots?.[0]) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 md:p-8 backdrop-blur-sm"
                  onClick={() => setShowFullPreview(false)}
                >
                  <button 
                    type="button" 
                    className="absolute top-5 right-5 p-2 rounded-full bg-neutral-900 border border-neutral-700 text-white hover:bg-neutral-800"
                    onClick={() => setShowFullPreview(false)}
                  >
                    <X size={20} />
                  </button>
                  <img
                    src={localImageUrl || formData.screenshots?.[0]}
                    alt="Full Preview"
                    className="max-w-full max-h-[90vh] object-contain rounded-lg border border-neutral-800 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex gap-3 pt-6 border-t border-border">
            <Button 
              type="button"
              variant="outline" 
              className="flex-1 border-border h-12 font-black uppercase tracking-widest text-muted-foreground hover:bg-accent hover:text-foreground" 
              onClick={onCancel} 
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              className={cn(
                "flex-1 h-12 font-black uppercase tracking-widest shadow-2xl transition-all",
                (disciplineMode === 'strict' && !metrics.passed && formData.strategyId) 
                  ? "bg-muted text-muted-foreground/40 cursor-not-allowed" 
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )} 
              disabled={isSubmitting || isUploading}
            >
              {isSubmitting ? 'Saving...' : (disciplineMode === 'strict' && !metrics.passed && formData.strategyId) ? 'Locked' : 'Save Record'}
            </Button>
          </div>
        </CardContent>

        {/* Confirmation Dialog for Semi-Strict Mode */}
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent className="border border-red-500/30 bg-card shadow-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-500">
                <ShieldAlert size={18} />
                紀律警示：尚未完成必要規範
              </DialogTitle>
              <DialogDescription className="text-neutral-400">
                您選擇了「{strategies.find(s => s.id === formData.strategyId)?.name}」模板，但有 <span className="text-red-500 font-bold">{metrics.missing.length}</span> 項必要項未勾選：
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-2 space-y-2">
              {metrics.missing.map((msg, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-neutral-300 bg-red-500/5 p-2 rounded-lg border border-red-500/10">
                  <AlertCircle size={12} className="text-red-500 shrink-0" />
                  <span>{msg}</span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed italic border-t border-border pt-3">
              目前的交易紀律分數為 <span className={cn("font-bold", getScoreColor(metrics.score))}>{metrics.score}%</span>。
              頻繁違反必要紀律規範是虧損的主要原因，您確定要忽略這些規範並儲存交易嗎？
            </p>

            <DialogFooter className="gap-2">
              <Button 
                variant="outline" 
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 bg-transparent border-neutral-800"
              >
                返回補齊
              </Button>
              <Button 
                className="flex-1 bg-red-500 hover:bg-red-600 text-white border-none font-bold"
                onClick={() => handleSubmit()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "儲存中..." : "我確定，我要違規送出"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </form>
    </Card>
  );
});
