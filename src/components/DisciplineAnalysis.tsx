import React, { useMemo, useState } from 'react';
import { Transaction, DisciplineGrades, StrategyChecklistItem } from '../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  ScatterChart, Scatter, ZAxis, Cell, Legend, ReferenceLine, LineChart, Line 
} from 'recharts';
import { cn, formatCurrency, formatPnL, getPnLColor, getWinRateColor, getDeltaColor } from '@/lib/utils';
import { 
  Zap, 
  Target, 
  ArrowUpRight, 
  ArrowDownRight, 
  TrendingUp, 
  PieChart, 
  Activity,
  Layers,
  ShieldAlert,
  Info,
  ChevronRight
} from 'lucide-react';
import { logger } from '../lib/logger';

interface DisciplineAnalysisProps {
  transactions: Transaction[];
  grades: DisciplineGrades;
  checklistItems: StrategyChecklistItem[];
}

export const DisciplineAnalysis: React.FC<DisciplineAnalysisProps> = ({ 
  transactions, 
  grades = { S: 90, A: 80, B: 70 },
  checklistItems
}) => {
  const [gradeMetric, setGradeMetric] = useState<'winRate' | 'avgPnL' | 'count'>('winRate');

  // Filter transactions that have a checklist score
  const gradedTrades = useMemo(() => 
    transactions.filter(t => t.result !== 'Open' && typeof t.checklistScore === 'number'),
  [transactions]);

  const getGrade = (score: number) => {
    if (score >= grades.S) return 'S';
    if (score >= grades.A) return 'A';
    if (score >= grades.B) return 'B';
    return 'C';
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'S': return '#22C55E';
      case 'A': return '#3B82F6';
      case 'B': return '#EAB308';
      case 'C': return '#EF4444';
      default: return '#A0A0A0';
    }
  };

  // 1. Grade Statistics (S/A/B/C)
  const gradeStats = useMemo(() => {
    const stats: Record<string, { count: number; wins: number; totalPnL: number }> = {
      S: { count: 0, wins: 0, totalPnL: 0 },
      A: { count: 0, wins: 0, totalPnL: 0 },
      B: { count: 0, wins: 0, totalPnL: 0 },
      C: { count: 0, wins: 0, totalPnL: 0 },
    };

    gradedTrades.forEach(t => {
      const grade = getGrade(t.checklistScore || 0);
      stats[grade].count++;
      if (t.result === 'Profit') stats[grade].wins++;
      stats[grade].totalPnL += t.uValue || 0;
    });

    const categories = ['S', 'A', 'B', 'C'];
    return categories.map(grade => {
      const data = stats[grade];
      return {
        grade,
        count: data.count,
        winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
        avgPnL: data.count > 0 ? data.totalPnL / data.count : 0,
      };
    });
  }, [gradedTrades, grades]);

  const binaryComparison = useMemo(() => {
    const high = { count: 0, wins: 0, totalPnL: 0 };
    const low = { count: 0, wins: 0, totalPnL: 0 };

    gradedTrades.forEach(t => {
      const isHigh = (t.checklistScore || 0) >= 80;
      const target = isHigh ? high : low;
      target.count++;
      if (t.result === 'Profit') target.wins++;
      target.totalPnL += t.uValue || 0;
    });

    return {
      high: {
        winRate: high.count > 0 ? (high.wins / high.count) * 100 : 0,
        avgPnL: high.count > 0 ? high.totalPnL / high.count : 0,
        count: high.count
      },
      low: {
        winRate: low.count > 0 ? (low.wins / low.count) * 100 : 0,
        avgPnL: low.count > 0 ? low.totalPnL / low.count : 0,
        count: low.count
      }
    };
  }, [gradedTrades]);

  // 3. Checklist Contribution Analysis (Detailed)
  const checklistImpact = useMemo(() => {
    const impactMap: Record<string, {
      text: string;
      followed: { count: number; wins: number; totalPnL: number; tradeIds: string[] };
      notFollowed: { count: number; wins: number; totalPnL: number; tradeIds: string[] };
    }> = {};

    // 1. Initialize impactMap with all CURRENT checklist items
    // This solves the bug where a new rule might not show up if count is 0
    // Actually the user wants 0 to be 0, not hidden if it is 0?
    // Wait, "新增一個從未被任何交易使用過的規範項目，分析表必須顯示 0 筆、0%"
    // So we SHOULD include it in the map initially.
    
    const currentItemsMap = new Map(checklistItems.map(i => [i.id, i.text]));
    const whiteListIds = new Set(checklistItems.map(i => i.id));

    // Initialize map with current items
    checklistItems.forEach(item => {
      impactMap[item.id] = {
        text: item.text,
        followed: { count: 0, wins: 0, totalPnL: 0, tradeIds: [] },
        notFollowed: { count: 0, wins: 0, totalPnL: 0, tradeIds: [] }
      };
    });

    console.group('Discipline Analysis Calculation Debug');
    
    gradedTrades.forEach(t => {
      if (!t.checklistSnapshot || !Array.isArray(t.checklistSnapshot)) {
        console.warn(`[Analysis] Trade ${t.id} missing or invalid checklistSnapshot`, t.checklistSnapshot);
        return;
      }
      
      // Use a set to prevent double-counting if same itemId exists multiple times in one snapshot (sanity check)
      const processedItemIds = new Set<string>();

      t.checklistSnapshot.forEach(item => {
        // Validation: Must have a valid itemId and be in current whitelist
        if (!item.itemId || typeof item.itemId !== 'string') {
          return;
        }
        
        if (!whiteListIds.has(item.itemId)) {
          return; 
        }

        if (processedItemIds.has(item.itemId)) {
          return;
        }
        processedItemIds.add(item.itemId);

        const stats = item.checked ? impactMap[item.itemId].followed : impactMap[item.itemId].notFollowed;
        
        stats.count++;
        if (t.result === 'Profit') stats.wins++;
        stats.totalPnL += t.uValue || 0;
        stats.tradeIds.push(t.id);
      });
    });

    // Logging as requested
    checklistItems.forEach(item => {
      const data = impactMap[item.id];
      const total = data.followed.count + data.notFollowed.count;
      console.log(`[Rule Stats] ID: ${item.id} | Name: ${item.text} | Hits: ${total}`);
      if (total > 0) {
        console.log(`  - Followed Trades:`, data.followed.tradeIds);
        console.log(`  - Not Followed Trades:`, data.notFollowed.tradeIds);
      }
    });
    
    console.groupEnd();

    return checklistItems
      .map((item) => {
        const data = impactMap[item.id];
        const wrFollowed = data.followed.count > 0 ? (data.followed.wins / data.followed.count) * 100 : 0;
        const wrNotFollowed = data.notFollowed.count > 0 ? (data.notFollowed.wins / data.notFollowed.count) * 100 : 0;
        const pnlFollowed = data.followed.count > 0 ? data.followed.totalPnL / data.followed.count : 0;
        const pnlNotFollowed = data.notFollowed.count > 0 ? data.notFollowed.totalPnL / data.notFollowed.count : 0;
        
        return {
          id: item.id,
          text: item.text,
          followed: {
            count: data.followed.count,
            winRate: wrFollowed,
            avgPnL: pnlFollowed
          },
          notFollowed: {
            count: data.notFollowed.count,
            winRate: wrNotFollowed,
            avgPnL: pnlNotFollowed
          },
          deltaWR: wrFollowed - wrNotFollowed,
          deltaPnL: pnlFollowed - pnlNotFollowed,
          totalCount: data.followed.count + data.notFollowed.count,
          lowSample: data.followed.count <= 1 || data.notFollowed.count <= 1
        };
      })
      .sort((a, b) => b.deltaWR - a.deltaWR);
  }, [gradedTrades, checklistItems]);

  // 4. Scatter Plot Data
  const scatterData = useMemo(() => 
    gradedTrades.map(t => ({
      score: t.checklistScore,
      pnl: t.uValue,
      symbol: t.symbol,
      result: t.result
    })), 
  [gradedTrades]);

  // 5. Trend Analysis
  const trendData = useMemo(() => {
    const sorted = [...gradedTrades].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    return sorted.map((t, index) => {
      // Calculate MA10
      const last10 = sorted.slice(Math.max(0, index - 9), index + 1);
      const ma10 = last10.reduce((acc, curr) => acc + (curr.checklistScore || 0), 0) / last10.length;
      
      // Calculate MA30
      const last30 = sorted.slice(Math.max(0, index - 29), index + 1);
      const ma30 = last30.reduce((acc, curr) => acc + (curr.checklistScore || 0), 0) / last30.length;

      return {
        date: t.date,
        score: t.checklistScore,
        ma10: Math.round(ma10),
        ma30: Math.round(ma30)
      };
    }).slice(-50); // Show last 50 trades trend
  }, [gradedTrades]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-3 rounded-xl shadow-2xl space-y-1">
          <p className="text-[10px] text-[#A0A0A0] uppercase font-bold">{data.symbol || data.date}</p>
          <div className="flex gap-4">
            <span className="text-xs font-bold text-white">紀律: {data.score}%</span>
            <span className={cn("text-xs font-bold", getPnLColor(data.pnl))}>
              PnL: {formatPnL(data.pnl)}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8 pb-10">
      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-neutral-500 bg-neutral-900/20 rounded-3xl border border-dashed border-neutral-800">
          <ShieldAlert size={48} className="mb-4 opacity-10" />
          <h3 className="text-lg font-bold text-neutral-400">尚無紀律數據</h3>
          <p className="text-sm">系統將根據您的交易核對清單與策略執行度進行分析。</p>
        </div>
      ) : (
        <>
          {/* Header Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[#A0A0A0] uppercase tracking-widest font-black">高紀律勝率 (≥80)</span>
              <Target size={16} className="text-[#22C55E]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-black tabular-nums", getWinRateColor(binaryComparison.high.winRate))}>
                {binaryComparison.high.winRate.toFixed(1)}
              </span>
              <span className="text-sm font-bold text-[#A0A0A0]">%</span>
            </div>
            <p className="text-[10px] text-neutral-500 mt-2">樣本數: {binaryComparison.high.count}</p>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[#A0A0A0] uppercase tracking-widest font-black">低紀律勝率 (&lt;80)</span>
              <ShieldAlert size={16} className="text-[#EF4444]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-black tabular-nums", getWinRateColor(binaryComparison.low.winRate))}>
                {binaryComparison.low.winRate.toFixed(1)}
              </span>
              <span className="text-sm font-bold text-[#A0A0A0]">%</span>
            </div>
            <p className="text-[10px] text-neutral-500 mt-2">樣本數: {binaryComparison.low.count}</p>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[#A0A0A0] uppercase tracking-widest font-black">高紀律平均 PnL</span>
              <TrendingUp size={16} className="text-[#22C55E]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-black tabular-nums", getPnLColor(binaryComparison.high.avgPnL))}>
                {formatPnL(binaryComparison.high.avgPnL)}
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 mt-2">平均每筆回報</p>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-2xl overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-[#A0A0A0] uppercase tracking-widest font-black">低紀律平均 PnL</span>
              <Layers size={16} className="text-[#EF4444]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-black tabular-nums", getPnLColor(binaryComparison.low.avgPnL))}>
                {formatPnL(binaryComparison.low.avgPnL)}
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 mt-2">違規交易平均結果</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {gradeStats.map((stat) => (
          <Card key={stat.grade} className="bg-[#1A1A1A] border-[#2A2A2A] rounded-2xl overflow-hidden relative group">
            <div 
              className="absolute top-0 left-0 w-1 h-full" 
              style={{ backgroundColor: getGradeColor(stat.grade) }}
            />
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span 
                    className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-black text-white"
                    style={{ backgroundColor: getGradeColor(stat.grade) }}
                  >
                    {stat.grade}
                  </span>
                  <span className="text-[10px] text-[#A0A0A0] uppercase tracking-widest font-black">等級統計</span>
                </div>
                <span className="text-[10px] text-neutral-500 font-mono">{stat.count} 筆交易</span>
              </div>
              
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-bold">勝率</span>
                    <span className={cn("text-xs font-black", getWinRateColor(stat.winRate))}>{stat.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                    <div 
                      className="h-full transition-all duration-500 shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                      style={{ 
                        width: `${stat.winRate}%`, 
                        backgroundColor: getGradeColor(stat.grade) 
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold mb-1">平均回報 (PnL)</span>
                  <span className={cn(
                    "text-xl font-black tabular-nums tracking-tight",
                    getPnLColor(stat.avgPnL)
                  )}>
                    {formatPnL(stat.avgPnL)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grade Breakdown (Bar Chart) */}
        <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-3xl overflow-hidden shadow-xl">
          <CardHeader className="border-b border-[#2A2A2A] pb-4 flex flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                <Zap size={16} className="text-yellow-500" /> 等級績效對比
              </CardTitle>
              <CardDescription className="text-xs">各等級在不同維度下的表現</CardDescription>
            </div>
            <div className="flex bg-black p-1 rounded-lg border border-[#2A2A2A]">
              {(['winRate', 'avgPnL', 'count'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setGradeMetric(m)}
                  className={cn(
                    "px-3 py-1 text-[10px] font-black uppercase tracking-tighter rounded-md transition-all",
                    gradeMetric === m ? "bg-[#2A2A2A] text-white" : "text-neutral-500 hover:text-neutral-300"
                  )}
                >
                  {m === 'winRate' ? '勝率' : m === 'avgPnL' ? '平均PnL' : '筆數'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-8">
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gradeStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                  <XAxis 
                    dataKey="grade" 
                    stroke="#A0A0A0" 
                    fontSize={12} 
                    fontWeight="bold"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="#A0A0A0" 
                    fontSize={10} 
                    axisLine={false} 
                    tickLine={false}
                    tickFormatter={(v) => gradeMetric === 'avgPnL' ? `${v}u` : gradeMetric === 'winRate' ? `${v}%` : v}
                  />
                  <Tooltip 
                    cursor={{ fill: '#ffffff05' }}
                    content={({ active, payload }) => {
                      if (active && payload?.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-[#0B0B0B] border border-[#2A2A2A] p-3 rounded-xl shadow-2xl space-y-2">
                            <p className="text-xs font-black uppercase tracking-widest text-[#A0A0A0]">等級 {data.grade}</p>
                            <div className="space-y-1">
                              <p className={cn("text-sm font-bold", getWinRateColor(data.winRate))}>勝率: {data.winRate.toFixed(1)}%</p>
                              <p className={cn("text-sm font-bold", getPnLColor(data.avgPnL))}>
                                平均PnL: {formatPnL(data.avgPnL)}
                              </p>
                              <p className="text-[10px] text-neutral-500">樣本數: {data.count}</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey={gradeMetric} radius={[4, 4, 0, 0]} barSize={40}>
                    {gradeStats.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={
                          gradeMetric === 'avgPnL' 
                            ? (entry.avgPnL >= 0 ? '#22C55E' : '#EF4444')
                            : getGradeColor(entry.grade)
                        } 
                      />
                    ))}
                  </Bar>
                  {gradeMetric === 'avgPnL' && <ReferenceLine y={0} stroke="#404040" />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Scatter Plot */}
        <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-3xl overflow-hidden shadow-xl">
          <CardHeader className="border-b border-[#2A2A2A] pb-4">
            <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <Activity size={16} className="text-blue-500" /> 紀律 vs 盈虧相關性
            </CardTitle>
            <CardDescription className="text-xs">觀察紀律分數與獲利能力的散點分佈</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
                  <XAxis 
                    type="number" 
                    dataKey="score" 
                    name="紀律分數" 
                    unit="%" 
                    stroke="#A0A0A0" 
                    fontSize={10}
                    domain={[0, 100]}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="pnl" 
                    name="PnL" 
                    unit=" u" 
                    stroke="#A0A0A0" 
                    fontSize={10}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="#2A2A2A" strokeWidth={1} />
                  <Scatter data={scatterData}>
                    {scatterData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.pnl >= 0 ? '#22C55E80' : '#EF444480'} 
                        stroke={entry.pnl >= 0 ? '#22C55E' : '#EF4444'}
                        strokeWidth={1}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trend Map */}
      <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-3xl overflow-hidden shadow-xl">
        <CardHeader className="border-b border-[#2A2A2A] pb-4">
          <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-500" /> 紀律趨勢分析 (最近 50 筆)
          </CardTitle>
          <CardDescription className="text-xs">觀察你的紀律執行穩定度</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="h-[250px] w-full">
             <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                  <XAxis dataKey="date" hide />
                  <YAxis stroke="#A0A0A0" fontSize={10} domain={[0, 100]} />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload?.length) {
                        return (
                          <div className="bg-[#0B0B0B] border border-[#2A2A2A] p-3 rounded-xl shadow-2xl space-y-1">
                            <p className="text-[10px] text-[#A0A0A0] font-black">{payload[0].payload.date}</p>
                            <p className="text-xs font-bold text-white">點值: {payload[0].payload.score}%</p>
                            <p className="text-xs font-bold text-blue-400">MA10: {payload[0].payload.ma10}%</p>
                            <p className="text-xs font-bold text-emerald-500 text-opacity-50">MA30: {payload[0].payload.ma30}%</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: 10, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }} />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#3A3A3A" 
                    strokeWidth={1} 
                    dot={false} 
                    name="單次分數"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="ma10" 
                    stroke="#3B82F6" 
                    strokeWidth={3} 
                    dot={false} 
                    name="10筆移動平均"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="ma30" 
                    stroke="#22C55E" 
                    strokeWidth={2} 
                    strokeDasharray="5 5"
                    dot={false} 
                    name="30筆移動平均"
                  />
                </LineChart>
             </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Item Contribution (Impact Table) */}
      <Card className="bg-[#1A1A1A] border-[#2A2A2A] rounded-3xl overflow-hidden shadow-xl">
        <CardHeader className="border-b border-[#2A2A2A] pb-6">
          <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
            <PieChart size={16} className="text-indigo-500" /> 規範貢獻分析 (細節數據)
          </CardTitle>
          <CardDescription className="text-xs">深度比較「遵守」與「違反」單項規範時的實際績效</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="border-b border-[#2A2A2A] bg-black/30">
                  <th className="p-4 text-[10px] uppercase tracking-widest text-[#A0A0A0] font-black">規範項目</th>
                  <th className="p-4 text-[10px] uppercase tracking-widest text-[#A0A0A0] font-black text-center bg-[#22C55E]/5 border-x border-[#22C55E]/10" colSpan={3}>
                    遵守該規範 (Followed)
                  </th>
                  <th className="p-4 text-[10px] uppercase tracking-widest text-[#A0A0A0] font-black text-center bg-[#EF4444]/5 border-x border-[#EF4444]/10" colSpan={3}>
                    未遵守規範 (Unfollowed)
                  </th>
                  <th className="p-4 text-[10px] uppercase tracking-widest text-[#A0A0A0] font-black text-right">績效差異</th>
                </tr>
                <tr className="border-b border-[#2A2A2A] bg-black/10 text-[9px] text-neutral-500 uppercase font-black">
                  <th className="p-2 pl-4">Rule Item</th>
                  <th className="p-2 text-center bg-[#22C55E]/5 border-l border-[#22C55E]/10">筆數</th>
                  <th className="p-2 text-center bg-[#22C55E]/5">勝率</th>
                  <th className="p-2 text-center bg-[#22C55E]/5 border-r border-[#22C55E]/10">平均PnL</th>
                  <th className="p-2 text-center bg-[#EF4444]/5 border-l border-[#EF4444]/10">筆數</th>
                  <th className="p-2 text-center bg-[#EF4444]/5">勝率</th>
                  <th className="p-2 text-center bg-[#EF4444]/5 border-r border-[#EF4444]/10">平均PnL</th>
                  <th className="p-2 text-right pr-4">PnL Δ</th>
                </tr>
              </thead>
              <tbody>
                {checklistImpact.map((item) => (
                  <tr key={item.id} className="border-b border-[#2A2A2A] hover:bg-white/[0.02] transition-colors group">
                    <td className="p-4 relative">
                       <div className="flex items-start gap-2">
                         <span className="text-xs font-bold text-white mt-0.5">{item.text}</span>
                         {item.lowSample && (
                           <div className="group/tip relative flex items-center justify-center">
                             <ShieldAlert size={12} className="text-yellow-600 cursor-help" />
                             <div className="absolute left-full ml-2 w-48 p-2 bg-black border border-yellow-600/50 rounded shadow-2xl opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all z-50">
                               <p className="text-[10px] text-yellow-600 leading-tight">樣本數不足 (單邊筆數 ≤ 1)，數據僅供參考。</p>
                             </div>
                           </div>
                         )}
                       </div>
                    </td>
                    
                    {/* Followed Group */}
                    <td className="p-2 text-center bg-[#22C55E]/[0.02] border-l border-[#22C55E]/5">
                      <span className="text-xs font-mono text-white/50">{item.followed.count}</span>
                    </td>
                    <td className="p-2 text-center bg-[#22C55E]/[0.02]">
                      <span className={cn("text-xs font-black", getWinRateColor(item.followed.winRate))}>
                        {item.followed.winRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-2 text-center bg-[#22C55E]/[0.02] border-r border-[#22C55E]/5">
                      <span className={cn("text-xs font-mono font-bold", getPnLColor(item.followed.avgPnL))}>
                        {formatPnL(item.followed.avgPnL)}
                      </span>
                    </td>

                    {/* Not Followed Group */}
                    <td className="p-2 text-center bg-[#EF4444]/[0.02] border-l border-[#EF4444]/5">
                      <span className="text-xs font-mono text-white/50">{item.notFollowed.count}</span>
                    </td>
                    <td className="p-2 text-center bg-[#EF4444]/[0.02]">
                      <span className={cn("text-xs font-black", getWinRateColor(item.notFollowed.winRate))}>
                        {item.notFollowed.winRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-2 text-center bg-[#EF4444]/[0.02] border-r border-[#EF4444]/5">
                      <span className={cn("text-xs font-mono font-bold", getPnLColor(item.notFollowed.avgPnL))}>
                        {formatPnL(item.notFollowed.avgPnL)}
                      </span>
                    </td>

                    {/* Difference */}
                    <td className="p-4 text-right">
                       <div className="flex flex-col items-end">
                         <div className="flex items-center gap-2">
                           <span className="text-[9px] uppercase font-black text-white/40 tracking-tighter">Δ勝率</span>
                           <span className={cn(
                             "text-sm font-black tabular-nums",
                             getDeltaColor(item.deltaWR)
                           )}>
                             {item.deltaWR >= 0 ? '+' : ''}{item.deltaWR.toFixed(1)}%
                           </span>
                         </div>
                       </div>
                    </td>
                  </tr>
                ))}
                {checklistImpact.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-[#3A3A3A] italic text-xs">
                       缺乏足夠的樣本進行數據交叉對比... 繼續累積交易紀錄
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
};
