import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TradeStats } from '../types';
import { TrendingDown, Flame, Scale, Activity, Target, ShieldAlert } from 'lucide-react';
import { cn, formatCurrency, formatPnL, formatCompactPnL, getPnLColor, getWinRateColor } from '@/lib/utils';

interface StatsOverviewProps {
  stats: TradeStats;
}

export const StatsOverview: React.FC<StatsOverviewProps> = React.memo(({ stats }) => {
  const items = useMemo(() => {
    const isLargeTotal = Math.abs(stats.totalU) >= 100_000;
    const formattedTotal = isLargeTotal 
      ? formatCompactPnL(stats.totalU) 
      : formatCurrency(stats.totalU).replace(' u', '');

    return [
      {
        label: '累積盈虧',
        num: formattedTotal,
        fullNum: formatPnL(stats.totalU),
        unit: isLargeTotal ? '' : 'u',
        icon: Activity,
        color: getPnLColor(stats.totalU),
      },
      {
        label: '勝率',
        num: (stats.winRate * 100).toFixed(1),
        fullNum: `${(stats.winRate * 100).toFixed(2)}%`,
        unit: '%',
        icon: Target,
        color: getWinRateColor(stats.winRate * 100),
      },
      {
        label: '盈虧比',
        num: stats.profitLossRatio.toFixed(2),
        fullNum: `盈虧比: ${stats.profitLossRatio.toFixed(2)}`,
        unit: '',
        icon: Scale,
        color: stats.profitLossRatio >= 2 
          ? 'text-emerald-600 dark:text-emerald-400' 
          : stats.profitLossRatio >= 1 
          ? 'text-foreground' 
          : 'text-red-600 dark:text-red-400',
      },
      {
        label: '最大回撤',
        num: stats.maxDrawdown.toFixed(2),
        fullNum: `最大回撤: ${stats.maxDrawdown.toFixed(2)}%`,
        unit: '%',
        icon: ShieldAlert,
        color: 'text-red-600 dark:text-red-400',
      },
      {
        label: stats.currentStreakType === 'Loss' ? '當前連敗' : '當前連勝',
        num: stats.currentStreak.toString(),
        fullNum: `${stats.currentStreak} 次`,
        unit: '次',
        icon: stats.currentStreakType === 'Loss' ? TrendingDown : Flame,
        color: stats.currentStreakType === 'Loss' 
          ? 'text-red-600 dark:text-red-400' 
          : stats.currentStreakType === 'Profit' 
          ? 'text-emerald-600 dark:text-emerald-400' 
          : 'text-foreground',
      },
    ];
  }, [stats]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
      {items.map((item, i) => (
        <Card 
          key={`stat-${i}-${item.label}`} 
          title={item.fullNum}
          className="bg-card border-border text-card-foreground rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
        >
          <CardContent className="p-4 sm:p-5 h-full flex flex-col justify-between gap-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold truncate">
                {item.label}
              </span>
              <item.icon size={15} className="text-muted-foreground/60 shrink-0" />
            </div>
            
            <div className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
              <span className={cn(
                "text-2xl sm:text-3xl font-extrabold tracking-tight leading-none tabular-nums truncate max-w-full",
                item.color
              )}>
                {item.num}
              </span>
              {item.unit && (
                <span className="text-xs sm:text-sm font-semibold text-muted-foreground shrink-0 leading-none">
                  {item.unit}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
});

