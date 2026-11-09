import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Transaction, Side, Tag } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { TrendingUp, TrendingDown, BarChart2, Filter, Search, Tag as TagIcon, Layers, AlertCircle, ChevronRight, X as CloseIcon } from 'lucide-react';
import { cn, formatPnL, getPnLColor, getWinRateColor } from '@/lib/utils';
import { logger } from '../lib/logger';

interface TagAnalysisProps {
  transactions: Transaction[];
  allTags: Tag[];
}

interface TagStats {
  tag: string;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalProfit: number;
  maxLoss: number;
  profitCount: number;
  lossCount: number;
}

interface CombinationStats {
  tagNames: string[];
  name: string;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalProfit: number;
  profitCount: number;
  lossCount: number;
  transactionIds: string[];
}

// Helper to generate combinations of a specific size
function getCombinations<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  function helper(start: number, current: T[]) {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < array.length; i++) {
      current.push(array[i]);
      helper(i + 1, current);
      current.pop();
    }
  }
  helper(0, []);
  return result;
}

export const TagAnalysis: React.FC<TagAnalysisProps> = React.memo(({ transactions, allTags }) => {
  const [filterTag, setFilterTag] = useState<string>('all');
  const [filterSymbol, setFilterSymbol] = useState<string>('');
  const [filterSide, setFilterSide] = useState<string>('all');
  const [minTrades, setMinTrades] = useState<number>(2);
  const [comboSort, setComboSort] = useState<'profitCount' | 'avgReturn' | 'totalProfit'>('profitCount');
  const [selectedCombo, setSelectedCombo] = useState<CombinationStats | null>(null);

  // Create a tag map for O(1) lookup
  const tagMap = useMemo(() => {
    const map = new Map<string, string>();
    allTags.forEach(tag => map.set(tag.id, tag.name));
    return map;
  }, [allTags]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // Exclude 'Open' trades from analysis
      if (t.result === 'Open') return false;
      
      const matchTag = filterTag === 'all' || (t.tagIds && t.tagIds.includes(filterTag));
      const matchSymbol = !filterSymbol || t.symbol.toLowerCase().includes(filterSymbol.toLowerCase());
      const matchSide = filterSide === 'all' || t.side === filterSide;
      return matchTag && matchSymbol && matchSide;
    });
  }, [transactions, filterTag, filterSymbol, filterSide]);

  const tagStats = useMemo(() => {
    logger.log('[Perf] tag stats recalculated');
    const statsMap = new Map<string, TagStats>();

    // Rule 1 & 5: Single Source of Truth - Initialize from allTags
    allTags.forEach(tag => {
      statsMap.set(tag.id, {
        tag: tag.name,
        totalTrades: 0,
        winRate: 0,
        avgReturn: 0,
        totalProfit: 0,
        maxLoss: 0,
        profitCount: 0,
        lossCount: 0,
      });
    });

    filteredTransactions.forEach(t => {
      if (!t.tagIds || t.tagIds.length === 0) return;

      t.tagIds.forEach(tagId => {
        const stats = statsMap.get(tagId);
        if (!stats) {
          // Rule 6: Handle ghost tags
          console.warn(`[TagAnalysis] Found ghost tag ${tagId} in trade ${t.id}. Skipping.`);
          return;
        }

        stats.totalTrades++;
        
        const val = t.uValue || 0;
        stats.totalProfit += val;
        
        if (t.result === 'Profit') {
          stats.profitCount++;
        } else if (t.result === 'Loss') {
          stats.lossCount++;
          if (val < stats.maxLoss) {
            stats.maxLoss = val;
          }
        }
      });
    });

    return Array.from(statsMap.values())
      .filter(s => s.totalTrades > 0 && s.tag && s.tag.trim() !== '' && s.tag !== '---') // Rule 6: Filter empty or invalid names
      .map(stats => ({
        ...stats,
        winRate: stats.totalTrades > 0 ? stats.profitCount / (stats.profitCount + stats.lossCount || 1) : 0,
        avgReturn: stats.totalTrades > 0 ? stats.totalProfit / stats.totalTrades : 0,
      }))
      .sort((a, b) => b.totalProfit - a.totalProfit);
  }, [filteredTransactions, allTags]);

  const combinationStats = useMemo(() => {
    console.log('[Perf] combination stats recalculated');
    const comboMap = new Map<string, CombinationStats>();

    // Only analyze profitable transactions for this specific section
    const profitableTxs = filteredTransactions.filter(t => t.result === 'Profit');

    profitableTxs.forEach(t => {
      if (!t.tagIds || t.tagIds.length < 2) return;

      // Rule 1 & 5: Filter tagIds against global allTags
      const validTagIds = t.tagIds.filter(id => allTags.some(tag => tag.id === id));
      
      const tagNames = validTagIds
        .map(id => tagMap.get(id))
        .filter((name): name is string => !!name)
        .sort((a, b) => a.localeCompare(b));

      if (tagNames.length < 2) return;

      // Generate pairs (size 2) and triples (size 3)
      const pairs: string[][] = getCombinations<string>(tagNames, 2);
      const triples: string[][] = tagNames.length >= 3 ? getCombinations<string>(tagNames, 3) : [];
      
      const allSubCombos: string[][] = [...pairs, ...triples];

      allSubCombos.forEach(combo => {
        const comboKey = combo.join(' + ');

        if (!comboMap.has(comboKey)) {
          comboMap.set(comboKey, {
            tagNames: combo,
            name: comboKey,
            totalTrades: 0,
            winRate: 1, // Always 1 since we only filter profits
            avgReturn: 0,
            totalProfit: 0,
            profitCount: 0,
            lossCount: 0,
            transactionIds: [],
          });
        }

        const stats = comboMap.get(comboKey)!;
        stats.totalTrades++;
        stats.profitCount++;
        stats.transactionIds.push(t.id);
        
        const val = t.uValue || 0;
        stats.totalProfit += val;
      });
    });

    return Array.from(comboMap.values())
      .map(stats => ({
        ...stats,
        avgReturn: stats.profitCount > 0 ? stats.totalProfit / stats.profitCount : 0,
      }))
      .sort((a, b) => {
        if (comboSort === 'profitCount') {
          if (b.profitCount !== a.profitCount) return b.profitCount - a.profitCount;
          return b.totalProfit - a.totalProfit;
        }
        if (comboSort === 'avgReturn') return b.avgReturn - a.avgReturn;
        return b.totalProfit - a.totalProfit;
      });
  }, [filteredTransactions, tagMap, comboSort]);

  const summaryStats = useMemo(() => {
    logger.log('[Perf] tag analysis summary recalculated');
    const bestTag = tagStats.length > 0 ? tagStats[0] : null;
    const worstTag = tagStats.length > 0 ? tagStats[tagStats.length - 1] : null;

    const filteredCombos = combinationStats.filter(c => c.profitCount >= minTrades);
    const bestCombo = filteredCombos.length > 0 ? [...filteredCombos].sort((a,b) => b.profitCount - a.profitCount)[0] : null;
    const highestProfitCombo = filteredCombos.length > 0 ? [...filteredCombos].sort((a,b) => b.totalProfit - a.totalProfit)[0] : null;

    return { bestTag, worstTag, filteredCombos, bestCombo, highestProfitCombo };
  }, [tagStats, combinationStats, minTrades]);

  const { bestTag, worstTag, filteredCombos, bestCombo, highestProfitCombo } = summaryStats;

  const selectedComboTransactions = useMemo(() => {
    if (!selectedCombo) return [];
    return transactions.filter(t => selectedCombo.transactionIds.includes(t.id));
  }, [selectedCombo, transactions]);

  return (
    <div className="space-y-6 pb-10">
      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-neutral-500 bg-neutral-900/20 rounded-3xl border border-dashed border-neutral-800">
          <BarChart2 size={48} className="mb-4 opacity-10" />
          <h3 className="text-lg font-bold text-neutral-400">尚無分析數據</h3>
          <p className="text-sm">新增交易紀錄後，系統將自動分析標籤表現。</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">進場理由標籤分析</h2>
          <p className="text-neutral-500 text-sm mt-1">分析不同進場策略的實際表現與優勢</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-wider text-neutral-500">標籤篩選</Label>
              <Select value={filterTag} onValueChange={setFilterTag}>
                <SelectTrigger className="bg-white text-black border-neutral-200">
                  <SelectValue placeholder="所有標籤" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">所有標籤</SelectItem>
                  {allTags.map(tag => (
                    <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-wider text-neutral-500">幣種搜尋</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
                <Input
                  placeholder="搜尋幣種..."
                  value={filterSymbol}
                  onChange={(e) => setFilterSymbol(e.target.value)}
                  className="pl-9 bg-white text-black border-neutral-200"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-wider text-neutral-500">交易方向</Label>
              <Select value={filterSide} onValueChange={setFilterSide}>
                <SelectTrigger className="bg-white text-black border-neutral-200">
                  <SelectValue placeholder="所有方向" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">所有方向</SelectItem>
                  <SelectItem value="Long">多 (Long)</SelectItem>
                  <SelectItem value="Short">空 (Short)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] uppercase tracking-widest text-neutral-500 flex items-center gap-2">
              <TrendingUp size={14} className="text-green-500" />
              表現最佳單一標籤 (Best Tag)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bestTag ? (
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold text-green-500">{bestTag.tag}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    總收益: <span className={cn("font-mono", getPnLColor(bestTag.totalProfit))}>{formatPnL(bestTag.totalProfit)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn("text-sm font-medium", getWinRateColor(bestTag.winRate * 100))}>勝率: {(bestTag.winRate * 100).toFixed(1)}%</div>
                  <div className="text-xs text-neutral-500">交易數: {bestTag.totalTrades}</div>
                </div>
              </div>
            ) : (
              <div className="text-neutral-500 italic text-sm">尚無數據</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] uppercase tracking-widest text-neutral-500 flex items-center gap-2">
              <TrendingDown size={14} className="text-red-500" />
              表現最差單一標籤 (Worst Tag)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {worstTag && worstTag !== bestTag ? (
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold text-red-500">{worstTag.tag}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    總收益: <span className={cn("font-mono", getPnLColor(worstTag.totalProfit))}>{formatPnL(worstTag.totalProfit)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn("text-sm font-medium", getWinRateColor(worstTag.winRate * 100))}>勝率: {(worstTag.winRate * 100).toFixed(1)}%</div>
                  <div className="text-xs text-neutral-500">交易數: {worstTag.totalTrades}</div>
                </div>
              </div>
            ) : (
              <div className="text-neutral-500 italic text-sm">尚無數據</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Combination Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] uppercase tracking-widest text-neutral-500 flex items-center gap-2">
              <Layers size={14} className="text-emerald-500" />
              最常出現的盈利組合 (Most Frequent Profitable)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bestCombo ? (
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-lg font-bold text-emerald-500 leading-tight">{bestCombo.name}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    盈利次數: <span className="text-white font-mono">{bestCombo.profitCount} 次</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white flex flex-col items-end">
                    <span>總收益: {formatPnL(bestCombo.totalProfit)}</span>
                    <span className="text-[10px] text-neutral-500">平均收益: {formatPnL(Math.round(bestCombo.avgReturn))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-neutral-500 italic text-sm">尚無組合數據</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] uppercase tracking-widest text-neutral-500 flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-500" />
              最高收益盈利組合 (Highest Profit Combination)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {highestProfitCombo ? (
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-lg font-bold text-blue-500 leading-tight">{highestProfitCombo.name}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    總收益: <span className="text-white font-mono">{highestProfitCombo.totalProfit > 0 ? '+' : ''}{highestProfitCombo.totalProfit.toLocaleString()} u</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white flex flex-col items-end">
                    <span>總收益: {formatPnL(highestProfitCombo.totalProfit)}</span>
                    <span className="text-[10px] text-neutral-500">平均收益: {formatPnL(Math.round(highestProfitCombo.avgReturn))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-neutral-500 italic text-sm">尚無組合數據</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Strategy Combination Analysis */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="border-b border-border flex flex-row items-center justify-between py-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers size={16} className="text-neutral-400" />
            獲利策略共通模式分析 (Profitable Strategy Patterns)
          </CardTitle>
          <p className="text-[10px] text-neutral-500 mt-1 ml-6">從盈利交易中拆解出反覆共現的策略組合（兩兩或三三組合）</p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-[10px] uppercase text-neutral-500">最小盈利次數:</Label>
              <Select value={minTrades.toString()} onValueChange={(v) => setMinTrades(parseInt(v))}>
                <SelectTrigger className="h-7 w-16 bg-white text-black text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] uppercase text-neutral-500">排序方式:</Label>
              <Select value={comboSort} onValueChange={(v: any) => setComboSort(v)}>
                <SelectTrigger className="h-7 w-28 bg-white text-black text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="profitCount">盈利次數</SelectItem>
                  <SelectItem value="totalProfit">總收益</SelectItem>
                  <SelectItem value="avgReturn">平均收益</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-neutral-50 dark:bg-neutral-900/50">
                  <th className="text-left py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">策略組合</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">盈利出現次數</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">總收益</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">平均收益 (u)</th>
                  <th className="text-right py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCombos.map((stats) => (
                  <tr 
                    key={stats.name} 
                    className="hover:bg-neutral-50 dark:hover:bg-neutral-900/30 transition-colors cursor-pointer group"
                    onClick={() => setSelectedCombo(stats)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {stats.tagNames.map(name => (
                          <span key={name} className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-medium text-neutral-600 dark:text-neutral-400">
                            {name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center">
                        <span className="font-mono font-bold text-emerald-500">{stats.profitCount}</span>
                        {stats.profitCount < 2 && (
                          <span className="text-[9px] text-orange-500 flex items-center gap-0.5">
                            <AlertCircle size={8} /> 樣本不足
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <div className={cn(
                        "px-2 py-0.5 rounded text-xs font-bold bg-black/40 border border-border",
                        getPnLColor(stats.totalProfit)
                      )}>
                        {formatPnL(stats.totalProfit)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                       <span className={getPnLColor(stats.avgReturn)}>
                        {formatPnL(Math.round(stats.avgReturn))}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <ChevronRight size={14} className="inline text-neutral-400 group-hover:text-white transition-colors" />
                    </td>
                  </tr>
                ))}
                {filteredCombos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-neutral-500 italic">
                      尚無符合條件的獲利策略組合模式
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Drill-down Transactions Modal-like Overlay */}
      <AnimatePresence>
        {selectedCombo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedCombo(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-card border border-border w-full max-w-4xl max-h-[80vh] overflow-hidden rounded-xl shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-border flex items-center justify-between bg-neutral-900/50">
                <div>
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Layers size={18} className="text-emerald-500" />
                    組合交易紀錄: {selectedCombo.name}
                  </h3>
                  <p className="text-xs text-neutral-500">共 {selectedCombo.totalTrades} 筆交易</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedCombo(null)} className="h-8 w-8 p-0">
                  <CloseIcon size={18} />
                </Button>
              </div>
              <div className="overflow-y-auto p-0 max-h-[calc(80vh-70px)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10 border-b border-border">
                    <tr className="bg-neutral-50 dark:bg-neutral-900">
                      <th className="text-left py-3 px-4 text-[10px] uppercase text-neutral-500">日期</th>
                      <th className="text-left py-3 px-4 text-[10px] uppercase text-neutral-500">幣種</th>
                      <th className="text-center py-3 px-4 text-[10px] uppercase text-neutral-500">方向</th>
                      <th className="text-center py-3 px-4 text-[10px] uppercase text-neutral-500">結果</th>
                      <th className="text-right py-3 px-4 text-[10px] uppercase text-neutral-500">收益 (u)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedComboTransactions.map(t => (
                      <tr key={t.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/30">
                        <td className="py-3 px-4 font-mono text-xs">{new Date(t.date).toLocaleDateString()}</td>
                        <td className="py-3 px-4 font-bold">{t.symbol}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                            t.side === 'Long' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                          )}>
                            {t.side}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                            t.result === 'Profit' ? "bg-green-500/10 text-green-500" : t.result === 'Loss' ? "bg-red-500/10 text-red-500" : "bg-neutral-500/10 text-neutral-500"
                          )}>
                            {t.result}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-bold">
                          <div className={getPnLColor(t.uValue)}>
                            {formatPnL(t.uValue)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats Table */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart2 size={16} className="text-neutral-400" />
            策略標籤詳細數據
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-neutral-50 dark:bg-neutral-900/50">
                  <th className="text-left py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">標籤</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">交易次數</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">勝率</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">平均報酬 (u)</th>
                  <th className="text-center py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">總收益貢獻</th>
                  <th className="text-right py-3 px-4 font-medium text-neutral-500 uppercase tracking-tighter text-[10px]">最大虧損</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tagStats.map((stats) => (
                  <tr key={stats.tag} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <TagIcon size={12} className="text-neutral-400" />
                        <span className="font-medium">{stats.tag}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">{stats.totalTrades}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={cn(
                          "font-bold",
                          getWinRateColor(stats.winRate * 100)
                        )}>
                          {(stats.winRate * 100).toFixed(1)}%
                        </span>
                        <div className="w-16 h-1 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full",
                              stats.winRate >= 0.5 ? "bg-green-500" : "bg-red-500"
                            )}
                            style={{ width: `${stats.winRate * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span className={getPnLColor(stats.avgReturn)}>
                        {formatPnL(Math.round(stats.avgReturn))}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <div className={cn(
                        "px-2 py-0.5 rounded text-xs font-bold inline-block border border-border bg-black/40",
                        getPnLColor(stats.totalProfit)
                      )}>
                        {formatPnL(stats.totalProfit)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                       <span className={getPnLColor(stats.maxLoss)}>{formatPnL(stats.maxLoss)}</span>
                    </td>
                  </tr>
                ))}
                {tagStats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-neutral-500 italic">
                      尚無標籤數據，請在交易紀錄中加入標籤
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
});
