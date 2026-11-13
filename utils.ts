import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, isValid } from 'date-fns';
import { DisciplineGrades, Rating } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateGrade(score: number, grades: DisciplineGrades): Rating {
  if (score >= (grades?.S ?? 90)) return 'S';
  if (score >= (grades?.A ?? 80)) return 'A';
  if (score >= (grades?.B ?? 70)) return 'B';
  return 'C';
}

export function calculateDisciplineScore(snapshot: any[]): number {
  if (!snapshot || snapshot.length === 0) return 0;
  // Handle items that might have been deactivated in the global config but are in the snapshot
  // Actually, the snapshot should only contain items that were active at the time or 
  // currently we want to recalculate based on ACTIVE items.
  const activeItems = snapshot.filter((s: any) => s.active !== false); 
  if (activeItems.length === 0) return 0;
  
  const totalWeight = activeItems.reduce((acc, curr) => acc + curr.weight, 0);
  const checkedWeight = activeItems.reduce((acc, curr) => acc + (curr.checked ? curr.weight : 0), 0);
  
  return totalWeight > 0 ? Math.round((checkedWeight / totalWeight) * 100) : 0;
}

export function calculatePassedRequired(snapshot: any[]): boolean {
  if (!snapshot || snapshot.length === 0) return true;
  return snapshot
    .filter((s: any) => s.active !== false && s.required)
    .every((s: any) => s.checked);
}

export function formatCompactNumber(value: number, options?: { showSign?: boolean; unit?: string }): string {
  if (value === 0 || isNaN(value)) return options?.unit ? `0 ${options.unit}` : '0';
  const abs = Math.abs(value);
  const sign = value > 0 ? (options?.showSign ? '+' : '') : '-';
  const unitSuffix = options?.unit ? ` ${options.unit}` : '';

  let formatted = '';
  if (abs >= 1_000_000_000) {
    const val = abs / 1_000_000_000;
    formatted = (val >= 100 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'B';
  } else if (abs >= 1_000_000) {
    const val = abs / 1_000_000;
    formatted = (val >= 100 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'm';
  } else if (abs >= 1_000) {
    const val = abs / 1_000;
    formatted = (val >= 100 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'k';
  } else {
    formatted = abs >= 10 ? Math.round(abs).toString() : (abs % 1 === 0 ? abs.toString() : abs.toFixed(1));
  }

  return `${sign}${formatted}${unitSuffix}`;
}

export function formatCompactPnL(value: number, unit = ''): string {
  return formatCompactNumber(value, { showSign: true, unit: unit || undefined });
}

export function formatPnL(value: number) {
  if (value === 0 || isNaN(value)) return '0 u';
  const absValue = Math.abs(value);
  const sign = value > 0 ? '+' : '-';
  return `${sign}${absValue.toLocaleString()} u`;
}

export function getPnLColor(value: number) {
  if (value > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

export function getWinRateColor(rate: number | null | undefined) {
  if (rate === null || rate === undefined) return 'text-muted-foreground';
  if (rate >= 50) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-red-600 dark:text-red-400';
}

export function getDeltaColor(value: number) {
  if (value > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

export function formatCurrency(value: number) {
  return formatPnL(value);
}

/**
 * 將 yyyy-MM-dd 字串或 Date 物件轉為本地顯示字串
 * 解決 timezone 偏移導致選 A 電變 B 電的問題
 */
export function safeFormat(date: string | Date | undefined | null, formatStr: string, fallback: string = '--'): string {
  if (!date) return fallback;
  
  let d: Date;
  if (typeof date === 'string') {
    // 如果是 yyyy-MM-dd 格式，手動解析，避免 new Date('yyyy-MM-dd') 被當成 UTC 0 點而偏移
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [year, month, day] = date.split('-').map(Number);
      d = new Date(year, month - 1, day);
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }

  if (!isValid(d)) return fallback;
  return format(d, formatStr);
}

/**
 * 取得今天本地日期的 yyyy-MM-dd 字串 (強制使用 Asia/Taipei 時區)
 */
export function getLocalDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * 專為時區不偏移設計的日期解析
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(date: string | Date) {
  if (!date) return '--';
  const formatted = safeFormat(date, 'yyyy.MM.dd');
  return formatted === '--' ? '--' : formatted;
}

export function calculateTradeStats(transactions: any[], initialCapital: number) {
  const closedTrades = transactions.filter(t => t.result !== 'Open');
  const totalTrades = closedTrades.length;
  
  // Based on uValue sign rather than result string for more robustness if possible, 
  // but we should respect result for WIN rate. 
  const profitCount = closedTrades.filter(t => t.result === 'Profit').length;
  const lossCount = closedTrades.filter(t => t.result === 'Loss').length;
  
  // Total U is now just a simple sum of signed values
  const totalU = closedTrades.reduce((acc, t) => acc + (t.uValue || 0), 0);
  
  const winRate = totalTrades > 0 ? profitCount / (profitCount + lossCount || 1) : 0;

  const sortedTx = [...closedTrades].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  let currentEquity = initialCapital;
  let peakEquity = initialCapital;
  let maxDDPercent = 0;
  
  let currentWins = 0;
  let maxWins = 0;
  let currentLosses = 0;
  let maxLosses = 0;
  
  let activeStreak = 0;
  let activeStreakType: 'Profit' | 'Loss' | 'None' = 'None';

  sortedTx.forEach(t => {
    const val = t.uValue || 0;
    currentEquity += val;
    
    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    
    const ddAmount = peakEquity - currentEquity;
    const ddPercent = peakEquity > 0 ? (ddAmount / peakEquity) * 100 : 0;
    
    if (ddPercent > maxDDPercent) {
      maxDDPercent = ddPercent;
    }

    if (t.result === 'Profit') {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxWins) maxWins = currentWins;
      activeStreak = currentWins;
      activeStreakType = 'Profit';
    } else if (t.result === 'Loss') {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxLosses) maxLosses = currentLosses;
      activeStreak = currentLosses;
      activeStreakType = 'Loss';
    }
  });

  const profitTrades = closedTrades.filter(t => (t.uValue || 0) > 0);
  const lossTrades = closedTrades.filter(t => (t.uValue || 0) < 0);
  
  const avgProfit = profitTrades.length > 0 
    ? profitTrades.reduce((acc, t) => acc + Math.abs(t.uValue), 0) / profitTrades.length 
    : 0;
  const avgLoss = lossTrades.length > 0 
    ? lossTrades.reduce((acc, t) => acc + Math.abs(t.uValue), 0) / lossTrades.length 
    : 0;
  const plRatio = avgLoss > 0 ? avgProfit / avgLoss : 0;

  return { 
    totalTrades, 
    profitCount, 
    lossCount, 
    winRate, 
    totalU,
    maxDrawdown: maxDDPercent,
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses,
    initialCapital,
    currentStreak: activeStreak,
    currentStreakType: activeStreakType,
    averageProfit: avgProfit,
    averageLoss: avgLoss,
    profitLossRatio: plRatio
  };
}
