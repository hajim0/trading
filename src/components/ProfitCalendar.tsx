import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { cn, getLocalDateString } from '@/lib/utils';
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
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="border-b border-border py-4">
        <CardTitle className="text-xs uppercase tracking-[0.2em] text-neutral-500 font-bold">
          盈虧日曆 (Profit & Loss Calendar)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex justify-center">
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
            profit: "bg-[#22C55E]/20 text-[#22C55E] font-bold rounded-md",
            loss: "bg-[#EF4444]/20 text-[#EF4444] font-bold rounded-md"
          }}
          components={{
            DayButton: ({ day, modifiers, ...props }: any) => {
              const dateStr = getLocalDateString(day.date);
              const profit = dailyStats[dateStr];
              
              return (
                <div className="relative group/day-cell w-full h-full flex items-center justify-center p-0.5">
                  <button
                    {...props}
                    className={cn(
                      "w-10 h-10 rounded-md text-xs transition-colors flex flex-col items-center justify-between py-1 relative",
                      modifiers.profit && "bg-[#22C55E]/10 text-[#22C55E] font-bold border border-[#22C55E]/40",
                      modifiers.loss && "bg-[#EF4444]/10 text-[#EF4444] font-bold border border-[#EF4444]/40",
                      !modifiers.profit && !modifiers.loss && "hover:bg-[#2A2A2A]"
                    )}
                  >
                    <span className="text-[10px] opacity-50 self-start px-1">{day.date.getDate()}</span>
                    <div className="flex-1 flex items-center justify-center w-full">
                      {profit !== undefined && (
                        <span className={cn(
                          "text-[9px] font-mono leading-none font-bold",
                          profit > 0 ? "text-[#22C55E]" : "text-[#EF4444]"
                        )}>
                          {profit > 0 ? '+' : ''}{Math.round(profit)}
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
      <div className="px-6 pb-4 flex gap-4 text-[10px] uppercase tracking-widest text-[#A0A0A0]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#22C55E]/30" /> 盈利日
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#EF4444]/30" /> 虧損日
        </div>
      </div>
    </Card>
  );
});
