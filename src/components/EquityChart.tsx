import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Transaction } from '../types';
import { cn, safeFormat, parseLocalDate } from '@/lib/utils';
import { logger } from '../lib/logger';

interface EquityChartProps {
  transactions: Transaction[];
}

export const EquityChart: React.FC<EquityChartProps> = React.memo(({ transactions }) => {
  const chartData = useMemo(() => {
    logger.log('[Perf] chart data recalculated');
    if (transactions.length === 0) return { data: [], off: 0 };
    
    // Sort by date ascending for the chart
    const sorted = [...transactions].sort((a, b) => 
      parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime()
    );

    let cumulativeU = 0;
    const data = sorted.map((t) => {
      const val = t.uValue || 0;
      cumulativeU += val;
      return {
        date: t.date,
        displayDate: safeFormat(t.date, 'MM/dd'),
        uValue: cumulativeU,
        symbol: t.symbol,
        result: t.result,
        rating: t.rating,
      };
    });

    const minU = Math.min(...data.map(d => d.uValue), 0);
    const maxU = Math.max(...data.map(d => d.uValue), 0);
    
    const range = maxU - minU;
    const off = range <= 0 ? (maxU > 0 ? 1 : 0) : Math.max(0, Math.min(1, maxU / range));

    return { data, off };
  }, [transactions]);

  const { data, off } = chartData;

  return (
    <div className="w-full h-[300px] bg-[#0B0B0B] rounded-xl border border-[#2A2A2A] p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
              <stop offset={off} stopColor="#22C55E" stopOpacity={1} />
              <stop offset={off} stopColor="#EF4444" stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" vertical={false} />
          <XAxis 
            dataKey="displayDate" 
            stroke="#3A3A3A" 
            fontSize={10} 
            tickLine={false} 
            axisLine={false}
            dy={10}
          />
          <YAxis 
            stroke="#3A3A3A" 
            fontSize={10} 
            tickLine={false} 
            axisLine={false}
            tickFormatter={(value) => `${value}u`}
          />
          <Tooltip
            contentStyle={{ 
              backgroundColor: '#1A1A1A', 
              border: '1px solid #2A2A2A',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#fff'
            }}
            itemStyle={{ color: '#fff' }}
            cursor={{ stroke: '#2A2A2A', strokeWidth: 1 }}
          />
          <ReferenceLine y={0} stroke="#2A2A2A" strokeWidth={1} />
          <Line
            type="monotone"
            dataKey="uValue"
            stroke="url(#splitColor)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#fff', stroke: '#000', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
