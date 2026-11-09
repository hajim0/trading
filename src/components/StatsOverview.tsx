import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TradeStats } from '../types';
import { TrendingUp, TrendingDown, Activity, Target, ShieldAlert, Flame, Scale } from 'lucide-react';
import { COLORS } from '../constants';
import { cn, formatCurrency, getPnLColor, getWinRateColor } from '@/lib/utils';

interface StatsOverviewProps {
  stats: TradeStats;
}

export const StatsOverview: React.FC<StatsOverviewProps> = React.memo(({ stats }) => {
  const items = useMemo(() => {
    return [
      {
        label: '累積盈虧',
        num: formatCurrency(stats.totalU).replace(' u', ''),
        unit: 'u',
        icon: Activity,
        color: getPnLColor(stats.totalU),
      },
      {
        label: '勝率',
        num: (stats.winRate * 100).toFixed(1),
        unit: '%',
        icon: Target,
        color: getWinRateColor(stats.winRate * 100),
      },
      {
        label: '盈虧比',
        num: stats.profitLossRatio.toFixed(2),
        unit: '',
        icon: Scale,
        color: stats.profitLossRatio >= 2 ? 'text-[#22C55E]' : stats.profitLossRatio >= 1 ? 'text-white' : 'text-[#EF4444]',
      },
      {
        label: '最大回撤',
        num: stats.maxDrawdown.toFixed(2),
        unit: '%',
        icon: ShieldAlert,
        color: 'text-[#EF4444]',
      },
      {
        label: stats.currentStreakType === 'Loss' ? '當前連敗' : '當前連勝',
        num: stats.currentStreak.toString(),
        unit: '次',
        icon: stats.currentStreakType === 'Loss' ? TrendingDown : Flame,
        color: stats.currentStreakType === 'Loss' ? 'text-[#EF4444]' : stats.currentStreakType === 'Profit' ? 'text-[#22C55E]' : 'text-white',
      },
    ];
  }, [stats]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {items.map((item, i) => (
        <Card key={`stat-${i}-${item.label}`} className="bg-[#1A1A1A] border-[#2A2A2A] rounded-[16px] overflow-visible border-[1px] shadow-sm">
          <CardContent className="p-5 h-full flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between">
              <span className="text-[11px] uppercase tracking-[0.1em] text-[#A0A0A0] font-medium">
                {item.label}
              </span>
              <item.icon size={14} className="text-[#3A3A3A] opacity-50" />
            </div>
            
            <div className="flex items-center justify-between min-w-0">
              <div className="flex items-baseline gap-[6px] min-w-0">
                <span className={cn(
                  "text-[28px] md:text-[34px] font-bold tracking-tighter leading-[1.1] whitespace-nowrap",
                  item.color
                )}>
                  {item.num}
                </span>
                {item.unit && (
                  <span className="text-[15px] md:text-[18px] font-semibold text-white/40 whitespace-nowrap">
                    {item.unit}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
});

