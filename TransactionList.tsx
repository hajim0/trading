import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Transaction, Result, Rating, Side, Tag } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Search, Filter, ArrowUpDown, MoreVertical, Eye, 
  Edit2, Trash2, CheckCircle2, Circle, CloudOff, 
  CloudCheck, Clock, TrendingUp, TrendingDown, Image as ImageIcon,
  CheckSquare, Square, AlertTriangle, Check, CheckCheck, Loader2
} from 'lucide-react';
import { cn, safeFormat, formatPnL, getPnLColor } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Button, buttonVariants } from '@/components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { db, getBlobUrl, preloadBlobUrls, onBlobHydrated } from '../lib/db';

interface TransactionListProps {
  transactions: Transaction[];
  allTags: Tag[];
  onView: (t: Transaction) => void;
  onEdit: (t: Transaction) => void;
  onDelete: (id: string) => void;
  onBulkDelete?: (ids: string[]) => void;
}

/**
 * Modern Monitor Icon for placeholders
 */
const MonitorIcon = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="1.5" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </svg>
);

/**
 * High-performance thumbnail with IntersectionObserver lazy-loading,
 * memory-efficient blob retrieval, and fallback error recovery.
 */
const TradeThumbnail = React.memo(({ t }: { t: Transaction }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [isInView, setIsInView] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lazy loading: Only query database when card approaches viewport (300px threshold)
  useEffect(() => {
    if (isInView) return;
    const el = containerRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });

    observer.observe(el);
    return () => observer.disconnect();
  }, [isInView]);

  useEffect(() => {
    if (!isInView) return;
    let active = true;

    async function load() {
      setIsLoading(true);
      setHasError(false);
      try {
        // 1. First priority: fast lightweight thumbnail blob
        if (t.imageThumbnailId) {
          const blobUrl = await getBlobUrl(t.imageThumbnailId);
          if (active && blobUrl) {
            setUrl(blobUrl);
            setIsLoading(false);
            return;
          }
        }
        // 2. Second priority: original high-res blob
        if (t.imageOriginalId) {
          const blobUrl = await getBlobUrl(t.imageOriginalId);
          if (active && blobUrl) {
            setUrl(blobUrl);
            setIsLoading(false);
            return;
          }
        }
        // 3. Fallback: cloud screenshots array
        if (t.screenshots?.length) {
          if (active) {
            setUrl(t.screenshots[0]);
            setIsLoading(false);
            return;
          }
        }
        if (active) {
          setUrl(null);
          setIsLoading(false);
        }
      } catch (err) {
        if (active) {
          setHasError(true);
          setIsLoading(false);
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
  }, [isInView, t.imageThumbnailId, t.imageOriginalId, t.screenshots]);

  const handleImageError = () => {
    // If thumbnail failed to render, try original image as fallback
    if (t.imageOriginalId && url) {
      getBlobUrl(t.imageOriginalId).then(fallbackUrl => {
        if (fallbackUrl && fallbackUrl !== url) {
          setUrl(fallbackUrl);
        } else {
          setHasError(true);
        }
      }).catch(() => setHasError(true));
    } else {
      setHasError(true);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-[16/10] bg-muted/30 border-b border-border overflow-hidden flex items-center justify-center select-none"
    >
      {/* Loading Shimmer / Placeholder while loading from IndexedDB */}
      {isLoading && (
        <div className="absolute inset-0 bg-muted/60 flex items-center justify-center animate-pulse">
          <MonitorIcon className="w-8 h-8 opacity-25 text-muted-foreground" />
        </div>
      )}

      {url && !hasError ? (
        <img 
          src={url} 
          alt={t.symbol} 
          decoding="async"
          loading="lazy"
          onLoad={() => setIsImageLoaded(true)}
          onError={handleImageError}
          className={cn(
            "w-full h-full object-cover group-hover:scale-105 transition-all duration-500 ease-out",
            isImageLoaded ? "opacity-100" : "opacity-0"
          )} 
        />
      ) : !isLoading ? (
        <div className="flex flex-col items-center justify-center text-neutral-800 gap-2">
          <MonitorIcon className="w-10 h-10 opacity-10" />
          <span className="text-[8px] font-black uppercase tracking-[0.3em] opacity-20">
            {hasError ? 'Load Error' : 'No Image'}
          </span>
        </div>
      ) : null}
      
      {/* Side Badge Overlay */}
      <div className={cn(
        "absolute bottom-3 left-3 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-black/70 backdrop-blur-md border transition-all z-10",
        t.side === 'Long' ? "text-emerald-400 border-emerald-500/40" : "text-red-400 border-red-500/40"
      )}>
        {t.side}
      </div>

      {/* Sync Status Badge Overlay */}
      <div className="absolute top-3 right-3 z-10">
        {t.localOnly ? (
          <div className="flex items-center gap-1.5 p-1 px-2 rounded-full bg-black/60 backdrop-blur-sm border border-yellow-500/20 text-yellow-500/80">
             <CloudOff size={10} />
             <span className="text-[7px] font-black uppercase tracking-widest">Local</span>
          </div>
        ) : (
          <div className="p-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-emerald-500/20 text-emerald-400">
            <CloudCheck size={12} />
          </div>
        )}
      </div>

      {/* Grade Overlay */}
      <div className={cn(
        "absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/80 backdrop-blur-md border flex items-center justify-center font-mono font-black text-xs shadow-2xl z-10",
        t.rating === 'S' && "text-emerald-400 border-emerald-500/40",
        t.rating === 'A' && "text-blue-400 border-blue-400/40",
        t.rating === 'B' && "text-yellow-400 border-yellow-400/40",
        t.rating === 'C' && "text-red-400 border-red-400/40"
      )}>
        {t.rating}
      </div>
    </div>
  );
});

interface TransactionCardProps {
  t: Transaction;
  tagMap: Map<string, string>;
  onView: (t: Transaction) => void;
  onEdit: (t: Transaction) => void;
  onRequestDelete: (t: Transaction) => void;
  isMultiSelectMode: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPressSelect?: (id: string) => void;
}

const TransactionCard: React.FC<TransactionCardProps> = ({ 
  t, 
  tagMap, 
  onView, 
  onEdit, 
  onRequestDelete, 
  isMultiSelectMode,
  isSelected, 
  onToggleSelect,
  onLongPressSelect
}) => {
  const [isPressing, setIsPressing] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only primary button
    if (e.button !== 0) return;
    
    isLongPressRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    setIsPressing(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setIsPressing(false);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(50); } catch (_) {}
      }
      onLongPressSelect?.(t.id);
    }, 450);
  }, [t.id, onLongPressSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!startPosRef.current || !timerRef.current) return;
    const dx = Math.abs(e.clientX - startPosRef.current.x);
    const dy = Math.abs(e.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimer();
    }
  }, [clearTimer]);

  const handlePointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const handlePointerCancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault();
      e.stopPropagation();
      isLongPressRef.current = false;
      return;
    }

    if (isMultiSelectMode) {
      onToggleSelect?.(t.id);
    } else {
      onView(t);
    }
  }, [isMultiSelectMode, onToggleSelect, onView, t]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="group h-full"
    >
      <Card 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={cn(
          "bg-card border-border hover:border-border/80 text-card-foreground transition-all cursor-pointer relative overflow-hidden h-full flex flex-col shadow-sm hover:shadow-md select-none",
          isSelected && "ring-2 ring-blue-500 border-blue-500/50 bg-blue-500/[0.04] shadow-[0_0_25px_rgba(59,130,246,0.15)]",
          isPressing && !isMultiSelectMode && "scale-[0.985] border-blue-500/40 bg-blue-500/[0.03]"
        )}
      >
        <div className="relative">
          <TradeThumbnail t={t} />

          {/* Multi-select check badge overlay */}
          {isMultiSelectMode && (
            <button 
              type="button"
              aria-label={isSelected ? "取消選取此交易" : "選取此交易"}
              className="absolute top-3 left-3 z-20 cursor-pointer p-0 bg-transparent border-none outline-none"
              onClick={(e) => { 
                e.stopPropagation(); 
                onToggleSelect?.(t.id); 
              }}
            >
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-xl backdrop-blur-md",
                isSelected 
                  ? "bg-blue-600 text-white ring-2 ring-blue-400 scale-105" 
                  : "bg-background/80 text-muted-foreground border border-border hover:scale-105"
              )}>
                {isSelected ? <Check size={15} strokeWidth={3} /> : <div className="w-2.5 h-2.5 rounded-full border border-muted-foreground/40" />}
              </div>
            </button>
          )}
        </div>

        <CardContent className="p-4 flex-1 flex flex-col">
          {/* Header Row */}
          <div className="flex justify-between items-start mb-3">
            <div className="min-w-0 flex-1 mr-2">
              <h3 className="text-sm font-black tracking-tight uppercase truncate leading-none mb-1 text-foreground">{t.symbol}</h3>
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider font-semibold">
                {safeFormat(t.date, 'yyyy.MM.dd')}
              </p>
            </div>

            <div className="text-right shrink-0">
              <div className={cn(
                "text-sm font-mono font-black tabular-nums leading-none mb-1",
                getPnLColor(t.uValue)
              )}>
                {formatPnL(t.uValue)}
              </div>
              <div className="text-[9px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                {t.result}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-4 overflow-hidden h-[20px]">
            {t.tagIds?.slice(0, 2).map(id => (
              <span key={id} className="text-[8px] px-2 py-0.5 bg-muted text-muted-foreground rounded-md border border-border font-bold uppercase tracking-tight truncate max-w-[100px]">
                {tagMap.get(id)}
              </span>
            ))}
            {(t.tagIds?.length || 0) > 2 && (
              <span className="text-[8px] text-muted-foreground/60 font-bold uppercase self-center">+{t.tagIds.length - 2}</span>
            )}
          </div>

          {/* Notes Preview */}
          <div className="flex-1 min-h-[40px]">
            {t.entryReason ? (
              <p className="text-[11px] text-muted-foreground line-clamp-2 italic leading-relaxed font-normal">
                "{t.entryReason}"
              </p>
            ) : (
              <div className="h-4 border-b border-border/60 w-12" />
            )}
          </div>

          {/* Action Row */}
          <div className="mt-5 pt-3 border-t border-border flex items-center justify-between">
            <div 
              className="flex items-center gap-2 cursor-pointer select-none py-1 group/chk"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect?.(t.id);
              }}
            >
              <div 
                className={cn(
                  "h-4 w-4 rounded flex items-center justify-center transition-all",
                  isSelected
                    ? "bg-blue-600 border border-blue-400 text-white shadow-sm"
                    : "bg-muted border border-border group-hover/chk:border-muted-foreground/50",
                  isMultiSelectMode ? "opacity-100 ring-1 ring-blue-400/40" : "hover:opacity-100 opacity-0 group-hover:opacity-100"
                )}
              >
                {isSelected && <Check size={11} strokeWidth={3} className="text-white" />}
              </div>
              <span className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider group-hover/chk:text-foreground transition-colors">
                ID: {t.id.slice(0, 6)}
              </span>
            </div>

            <div 
              className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={(e) => { e.stopPropagation(); onEdit(t); }}
                title="編輯交易紀錄"
              >
                <Edit2 size={12} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger 
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={12} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover text-popover-foreground border-border shadow-2xl">
                  <DropdownMenuItem onClick={() => onView(t)} className="text-[10px] font-black uppercase tracking-widest py-3 hover:bg-accent hover:text-accent-foreground cursor-pointer">
                    <Eye size={14} className="mr-3 opacity-50" /> 檢視詳情
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(t)} className="text-[10px] font-black uppercase tracking-widest py-3 hover:bg-accent hover:text-accent-foreground cursor-pointer">
                    <Edit2 size={14} className="mr-3 opacity-50" /> 編輯紀錄
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => onRequestDelete(t)} 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 text-[10px] font-black uppercase tracking-widest py-3 cursor-pointer"
                  >
                    <Trash2 size={14} className="mr-3 opacity-50" /> 刪除紀錄
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  allTags,
  onView,
  onEdit,
  onDelete,
  onBulkDelete,
}) => {
  const [search, setSearch] = useState('');
  const [filterResult, setFilterResult] = useState<Result | 'All'>('All');
  const [filterRating, setFilterRating] = useState<Rating | 'All'>('All');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'pnl-desc' | 'pnl-asc'>('date-desc');
  const PAGE_SIZE = 24;
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'single' | 'bulk';
    ids: string[];
    singleTransaction?: Transaction;
  } | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const tagMap = useMemo(() => new Map(allTags.map(t => [t.id, t.name])), [allTags]);

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(t => {
        const matchesSearch = t.symbol.toLowerCase().includes(search.toLowerCase()) || 
                             t.entryReason.toLowerCase().includes(search.toLowerCase());
        const matchesResult = filterResult === 'All' || t.result === filterResult;
        const matchesRating = filterRating === 'All' || t.rating === filterRating;
        return matchesSearch && matchesResult && matchesRating;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'date-desc': return new Date(b.date).getTime() - new Date(a.date).getTime();
          case 'date-asc': return new Date(a.date).getTime() - new Date(b.date).getTime();
          case 'pnl-desc': return (b.uValue || 0) - (a.uValue || 0);
          case 'pnl-asc': return (a.uValue || 0) - (b.uValue || 0);
          default: return 0;
        }
      });
  }, [transactions, search, filterResult, filterRating, sortBy]);

  // Reset pagination batch to beginning whenever search or filters change
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [search, filterResult, filterRating, sortBy]);

  // Windowed visible slice for 60fps rendering without DOM bloat
  const visibleTransactions = useMemo(() => {
    return filteredTransactions.slice(0, visibleLimit);
  }, [filteredTransactions, visibleLimit]);

  const hasMore = visibleLimit < filteredTransactions.length;

  // Infinite scroll observer for loading more items smoothly as user scrolls
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleLimit(filteredTransactions.length);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleLimit(prev => Math.min(prev + PAGE_SIZE, filteredTransactions.length));
      }
    }, { rootMargin: '350px' });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, filteredTransactions.length]);

  // Preload next batch's images in the background for zero-wait display
  useEffect(() => {
    if (!hasMore) return;
    const nextChunk = filteredTransactions.slice(visibleLimit, visibleLimit + PAGE_SIZE);
    const idsToPreload = nextChunk
      .map(t => t.imageThumbnailId || t.imageOriginalId)
      .filter((id): id is string => Boolean(id));

    if (idsToPreload.length > 0) {
      preloadBlobUrls(idsToPreload);
    }
  }, [visibleLimit, filteredTransactions, hasMore]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setIsMultiSelectMode(false);
      else setIsMultiSelectMode(true);
      return next;
    });
  }, []);

  const handleLongPressSelect = useCallback((id: string) => {
    setIsMultiSelectMode(true);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const isAllFilteredSelected = useMemo(() => {
    if (filteredTransactions.length === 0) return false;
    return filteredTransactions.every(t => selectedIds.has(t.id));
  }, [filteredTransactions, selectedIds]);

  const isPartiallySelected = useMemo(() => {
    return selectedIds.size > 0 && !isAllFilteredSelected;
  }, [selectedIds, isAllFilteredSelected]);

  const toggleSelectAll = useCallback(() => {
    if (filteredTransactions.length === 0) return;

    if (isAllFilteredSelected) {
      // If currently all filtered transactions are selected, deselect them
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredTransactions.forEach(t => next.delete(t.id));
        if (next.size === 0) setIsMultiSelectMode(false);
        return next;
      });
    } else {
      // Select all filtered transactions in 1 click
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredTransactions.forEach(t => next.add(t.id));
        return next;
      });
      setIsMultiSelectMode(true);
    }
  }, [isAllFilteredSelected, filteredTransactions]);

  const invertSelection = useCallback(() => {
    if (filteredTransactions.length === 0) return;
    setSelectedIds(prev => {
      const next = new Set<string>();
      filteredTransactions.forEach(t => {
        if (!prev.has(t.id)) {
          next.add(t.id);
        }
      });
      if (next.size === 0) setIsMultiSelectMode(false);
      else setIsMultiSelectMode(true);
      return next;
    });
  }, [filteredTransactions]);

  // Global Keyboard Shortcut: Ctrl+A / Cmd+A to select all, Escape to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        const target = e.target as HTMLElement | null;
        const isInput = target && (
          target.tagName === 'INPUT' || 
          target.tagName === 'TEXTAREA' || 
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox'
        );
        if (!isInput && filteredTransactions.length > 0) {
          e.preventDefault();
          toggleSelectAll();
        }
      } else if (e.key === 'Escape' && (isMultiSelectMode || selectedIds.size > 0)) {
        setSelectedIds(new Set());
        setIsMultiSelectMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredTransactions, toggleSelectAll, isMultiSelectMode, selectedIds]);

  const handleRequestSingleDelete = useCallback((t: Transaction) => {
    setDeleteTarget({
      type: 'single',
      ids: [t.id],
      singleTransaction: t,
    });
  }, []);

  const handleTriggerBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 1) {
      const single = transactions.find(t => t.id === ids[0]);
      setDeleteTarget({
        type: 'single',
        ids,
        singleTransaction: single,
      });
    } else {
      setDeleteTarget({
        type: 'bulk',
        ids,
      });
    }
  }, [selectedIds, transactions]);

  const handleExecuteDelete = useCallback(() => {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'single') {
      const id = deleteTarget.ids[0];
      onDelete(id);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        if (next.size === 0) setIsMultiSelectMode(false);
        return next;
      });
    } else {
      if (onBulkDelete) {
        onBulkDelete(deleteTarget.ids);
      } else {
        deleteTarget.ids.forEach(id => onDelete(id));
      }
      setSelectedIds(new Set());
      setIsMultiSelectMode(false);
    }

    setDeleteTarget(null);
  }, [deleteTarget, onDelete, onBulkDelete]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sticky top-0 z-20 bg-background/90 backdrop-blur-xl pb-5 border-b border-border">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-foreground transition-colors w-4 h-4" />
            <Input
              placeholder="SEARCH SYMBOL / NOTES..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 bg-card border-border text-foreground placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary/20 text-[11px] font-bold uppercase tracking-wider h-12 rounded-xl transition-all shadow-sm"
            />
          </div>
          
          <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
            <Select value={filterResult} onValueChange={(val: any) => setFilterResult(val)}>
              <SelectTrigger className="w-[105px] bg-card border-border text-foreground text-[10px] font-bold uppercase tracking-widest h-12 rounded-xl shadow-sm hover:bg-accent/50">
                <SelectValue placeholder="RESULT" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl">
                <SelectItem value="All" className="text-[10px] uppercase font-bold tracking-widest py-3">ALL RESULTS</SelectItem>
                <SelectItem value="Profit" className="text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest py-3">PROFIT</SelectItem>
                <SelectItem value="Loss" className="text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-widest py-3">LOSS</SelectItem>
                <SelectItem value="Open" className="text-[10px] uppercase font-bold tracking-widest py-3 text-muted-foreground">OPEN</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterRating} onValueChange={(val: any) => setFilterRating(val)}>
              <SelectTrigger className="w-[105px] bg-card border-border text-foreground text-[10px] font-bold uppercase tracking-widest h-12 rounded-xl shadow-sm hover:bg-accent/50">
                <SelectValue placeholder="GRADE" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl">
                <SelectItem value="All" className="text-[10px] uppercase font-bold tracking-widest py-3 text-muted-foreground">ALL GRADES</SelectItem>
                <SelectItem value="S" className="text-emerald-600 dark:text-emerald-400 font-bold py-3">S GRADE</SelectItem>
                <SelectItem value="A" className="text-blue-500 font-bold py-3">A GRADE</SelectItem>
                <SelectItem value="B" className="text-amber-500 font-bold py-3">B GRADE</SelectItem>
                <SelectItem value="C" className="text-red-500 font-bold py-3">C GRADE</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
              <SelectTrigger className="hidden md:flex w-[150px] bg-card border-border text-foreground text-[10px] font-bold uppercase tracking-widest h-12 rounded-xl shadow-sm hover:bg-accent/50">
                <ArrowUpDown className="w-3 h-3 mr-2 text-muted-foreground" />
                <SelectValue placeholder="SORT" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl">
                <SelectItem value="date-desc" className="text-[10px] uppercase font-bold tracking-widest py-3">DATE (NEWEST)</SelectItem>
                <SelectItem value="date-asc" className="text-[10px] uppercase font-bold tracking-widest py-3">DATE (OLDEST)</SelectItem>
                <SelectItem value="pnl-desc" className="text-[10px] uppercase font-bold tracking-widest py-3">PNL (HIGH-LOW)</SelectItem>
                <SelectItem value="pnl-asc" className="text-[10px] uppercase font-bold tracking-widest py-3">PNL (LOW-HIGH)</SelectItem>
              </SelectContent>
            </Select>

            <Button
              id="btn-select-all"
              type="button"
              variant={isAllFilteredSelected ? "default" : isMultiSelectMode ? "secondary" : "outline"}
              onClick={toggleSelectAll}
              disabled={filteredTransactions.length === 0}
              className={cn(
                "h-12 px-3.5 text-[10px] font-bold uppercase tracking-widest rounded-xl gap-2 transition-all shrink-0 select-none shadow-sm",
                isAllFilteredSelected
                  ? "bg-blue-600 text-white hover:bg-blue-500 border-transparent shadow-lg shadow-blue-500/25 ring-1 ring-blue-400"
                  : isPartiallySelected
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                  : isMultiSelectMode
                  ? "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80"
                  : "bg-card border-border text-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              title={
                isAllFilteredSelected 
                  ? "取消全選 (快捷鍵 Esc)" 
                  : "一鍵全部選取 (快捷鍵 Ctrl+A / ⌘A)"
              }
            >
              {isAllFilteredSelected ? (
                <>
                  <CheckCheck size={15} className="text-white shrink-0" />
                  <span>取消全選</span>
                </>
              ) : isPartiallySelected ? (
                <>
                  <CheckSquare size={14} className="text-blue-500 shrink-0" />
                  <span>一鍵全選 ({filteredTransactions.length})</span>
                </>
              ) : (
                <>
                  <CheckSquare size={14} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                  <span>一鍵全選</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Long press & shortcut guidance hint */}
        {!isMultiSelectMode && filteredTransactions.length > 0 && (
          <div className="flex items-center justify-between text-[11px] text-neutral-500 px-1">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              提示：可直接點擊「一鍵全選」或「長按」卡片進入選取模式，支援批量刪除 (快捷鍵: Ctrl+A / ⌘A 全選，Esc 取消)
            </span>
            <span className="font-mono text-neutral-600 text-[10px]">
              共 {filteredTransactions.length} 筆
            </span>
          </div>
        )}

        {/* Multi-select Action Bar */}
        <AnimatePresence>
          {isMultiSelectMode && (
            <motion.div 
              initial={{ height: 0, opacity: 0, y: -6 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -6 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-blue-950/40 border border-blue-500/30 rounded-2xl backdrop-blur-md shadow-2xl">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-xl text-blue-300 font-bold text-xs">
                    <CheckSquare size={14} />
                    <span>已選取 {selectedIds.size} / 共 {filteredTransactions.length} 筆</span>
                  </div>

                  {/* 一鍵全部選取 / 取消全選按鈕 */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="h-8 text-xs font-bold text-neutral-200 hover:text-white hover:bg-blue-500/20 gap-1.5 px-3 rounded-lg border border-blue-500/30 transition-all"
                  >
                    {isAllFilteredSelected ? (
                      <>
                        <Square size={13} />
                        取消全選
                      </>
                    ) : (
                      <>
                        <CheckCheck size={14} className="text-blue-400" />
                        一鍵全部選取 ({filteredTransactions.length})
                      </>
                    )}
                  </Button>

                  {/* 反向選取按鈕 */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={invertSelection}
                    className="h-8 text-xs font-bold text-neutral-400 hover:text-white hover:bg-white/5 gap-1.5 px-2.5 rounded-lg transition-colors"
                    title="反向選取清單中的項目"
                  >
                    <ArrowUpDown size={12} />
                    反向選取
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="sm" 
                    onClick={() => { setSelectedIds(new Set()); setIsMultiSelectMode(false); }}
                    className="h-8 text-xs font-bold text-neutral-400 hover:text-white hover:bg-white/5 px-3 rounded-lg"
                  >
                    結束選取
                  </Button>
                  <Button 
                    type="button"
                    variant="destructive" 
                    size="sm" 
                    disabled={selectedIds.size === 0}
                    onClick={handleTriggerBulkDelete}
                    className="h-8 bg-red-600 hover:bg-red-500 text-white text-xs font-bold tracking-wide px-3.5 rounded-xl shadow-lg gap-1.5"
                  >
                    <Trash2 size={13} />
                    {selectedIds.size > 1 ? `批量刪除 (${selectedIds.size} 筆)` : selectedIds.size === 1 ? '刪除選取 (1 筆)' : '刪除選取'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Gallery Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        <AnimatePresence mode="popLayout">
          {visibleTransactions.map((t) => (
            <TransactionCard
              key={t.id}
              t={t}
              tagMap={tagMap}
              onView={onView}
              onEdit={onEdit}
              onRequestDelete={handleRequestSingleDelete}
              isMultiSelectMode={isMultiSelectMode}
              isSelected={selectedIds.has(t.id)}
              onToggleSelect={toggleSelect}
              onLongPressSelect={handleLongPressSelect}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Progressive Infinite Scroll Sentinel & Manual Trigger */}
      {hasMore && (
        <div ref={sentinelRef} className="py-8 flex flex-col items-center justify-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            <span>自動載入更多紀錄中 (已顯示 {visibleTransactions.length} / 共 {filteredTransactions.length} 筆)</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleLimit(prev => Math.min(prev + PAGE_SIZE, filteredTransactions.length))}
            className="border-border bg-card text-foreground hover:bg-accent text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm"
          >
            立即載入下一批 (還有 {filteredTransactions.length - visibleTransactions.length} 筆)
          </Button>
        </div>
      )}

      {!hasMore && filteredTransactions.length > PAGE_SIZE && (
        <div className="py-6 text-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-t border-border">
          ✓ 已完整載入全部 {filteredTransactions.length} 筆交易紀錄
        </div>
      )}

      {filteredTransactions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-40 space-y-6 border border-dashed border-border rounded-[2.5rem] bg-card/40">
          <div className="p-6 rounded-full bg-muted border border-border">
            <Clock className="w-10 h-10 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-[0.3em] mb-1">NO RECORDS FOUND</p>
            <p className="text-[9px] text-muted-foreground/80 font-bold uppercase tracking-widest">Adjust your filters or add a new trade</p>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <div 
              className="w-full max-w-md bg-card border border-border text-card-foreground rounded-2xl p-6 shadow-2xl space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-red-500">
                <div className="p-3 rounded-full bg-red-500/10 border border-red-500/20 shrink-0">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h4 className="text-base font-bold text-foreground">
                    {deleteTarget.type === 'bulk' 
                      ? `確認批量刪除 ${deleteTarget.ids.length} 筆交易？` 
                      : `確認刪除交易紀錄？`}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {deleteTarget.type === 'bulk'
                      ? `即將從本地永久刪除選取的 ${deleteTarget.ids.length} 筆歷史交易紀錄。`
                      : `即將從本地永久刪除此筆交易紀錄。`}
                  </p>
                </div>
              </div>

              {/* Single item detail preview */}
              {deleteTarget.type === 'single' && deleteTarget.singleTransaction && (
                <div className="p-3.5 bg-muted/50 rounded-xl border border-border flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground text-sm">{deleteTarget.singleTransaction.symbol}</span>
                      <span className={cn(
                        "text-[9px] font-black px-1.5 py-0.5 rounded uppercase",
                        deleteTarget.singleTransaction.side === 'Long' ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-red-500/20 text-red-600 dark:text-red-400"
                      )}>
                        {deleteTarget.singleTransaction.side}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono mt-1">
                      {safeFormat(deleteTarget.singleTransaction.date, 'yyyy.MM.dd')}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={cn(
                      "font-mono font-bold text-sm",
                      getPnLColor(deleteTarget.singleTransaction.uValue)
                    )}>
                      {formatPnL(deleteTarget.singleTransaction.uValue)}
                    </span>
                    <p className="text-[9px] text-muted-foreground font-bold uppercase mt-0.5">
                      {deleteTarget.singleTransaction.result}
                    </p>
                  </div>
                </div>
              )}

              {/* Bulk items summary preview */}
              {deleteTarget.type === 'bulk' && (
                <div className="p-3 bg-muted/50 rounded-xl border border-border text-xs text-muted-foreground space-y-1.5 max-h-32 overflow-y-auto">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">包含項目:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {deleteTarget.ids.slice(0, 8).map(id => {
                      const tr = transactions.find(item => item.id === id);
                      return (
                        <span key={id} className="text-[10px] font-mono px-2 py-0.5 bg-background border border-border rounded text-foreground">
                          {tr ? tr.symbol : id.slice(0, 6)}
                        </span>
                      );
                    })}
                    {deleteTarget.ids.length > 8 && (
                      <span className="text-[10px] font-mono px-2 py-0.5 text-muted-foreground">
                        ...等共 {deleteTarget.ids.length} 筆
                      </span>
                    )}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground leading-relaxed bg-muted/40 p-3 rounded-lg border border-border">
                此操作將自本地資料庫清除，若交易內附帶交易截圖檔案亦將一併銷毀。
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleExecuteDelete}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold gap-1.5"
                >
                  <Trash2 size={14} />
                  {deleteTarget.type === 'bulk' 
                    ? `確認批量刪除 (${deleteTarget.ids.length} 筆)` 
                    : '確認刪除'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
