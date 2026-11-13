import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { cn, getLocalDateString, formatCompactPnL, formatPnL, getPnLColor } from '@/lib/utils';
import { logger } from '../lib/logger';

interface ProfitCalendarProps {
  transactions: Transaction[];
}

export const ProfitCalendar: React.FC<ProfitCalendarProps> = React.memo(({ transactions }) => {
  // Group transactions by date and calculate daily profit/loss
  const dailyStats = useMemo(() => {
    logger.log('[Perf] daily stats recalculated for calendar');
    return transactions.reduce((acc, t) => {
      const dateStr = t.date.split('T')[0];
      if (!acc[dateStr]) {
        acc[dateStr] = 0;
      }
      const val = t.uValue || 0;
      acc[dateStr] += val;
      return acc;
    }, {} as Record<string, number>);
  }, [transactions]);

  return (
    <Card className="bg-card border-border overflow-hidden shadow-sm">
      <CardHeader className="border-b border-border py-4">
        <CardTitle className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-bold">
          盈虧日曆 (Profit & Loss Calendar)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex justify-center overflow-x-auto">
        <Calendar
          mode="single"
          className="p-0"
          modifiers={{
            profit: (date) => {
              const dateStr = getLocalDateString(date);
              return dailyStats[dateStr] > 0;
            },
            loss: (date) => {
              const dateStr = getLocalDateString(date);
              return dailyStats[dateStr] < 0;
            }
          }}
          modifiersClassNames={{
            profit: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold rounded-lg",
            loss: "bg-red-500/15 text-red-600 dark:text-red-400 font-bold rounded-lg"
          }}
          components={{
            DayButton: ({ day, modifiers, ...props }: any) => {
              const dateStr = getLocalDateString(day.date);
              const profit = dailyStats[dateStr];
              const formattedCompact = profit !== undefined ? formatCompactPnL(profit) : '';
              const fullTooltip = profit !== undefined ? `${dateStr}: ${formatPnL(profit)}` : dateStr;
              
              return (
                <div className="relative group/day-cell w-full h-full flex items-center justify-center p-0.5">
                  <button
                    {...props}
                    title={fullTooltip}
                    className={cn(
                      "w-10 h-10 rounded-lg text-xs transition-colors flex flex-col items-center justify-between py-1 relative overflow-hidden select-none border border-transparent",
                      modifiers.profit && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border-emerald-500/30 dark:border-emerald-500/40",
                      modifiers.loss && "bg-red-500/10 text-red-600 dark:text-red-400 font-bold border-red-500/30 dark:border-red-500/40",
                      !modifiers.profit && !modifiers.loss && "hover:bg-muted text-foreground"
                    )}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground self-start px-1 leading-none">{day.date.getDate()}</span>
                    <div className="flex-1 flex items-center justify-center w-full min-w-0 px-0.5">
                      {profit !== undefined && (
                        <span className={cn(
                          "text-[9px] font-mono leading-none font-bold tracking-tight truncate max-w-full text-center tabular-nums",
                          getPnLColor(profit)
                        )}>
                          {formattedCompact}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              );
            }
          }}
        />
      </CardContent>
      <div className="px-6 pb-4 flex gap-5 text-[11px] font-medium text-muted-foreground border-t border-border/50 pt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>盈利日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span>虧損日</span>
        </div>
      </div>
    </Card>
  );
});
