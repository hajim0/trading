import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Zap, CheckCircle2, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { ENABLE_PREMIUM_BETA } from '../lib/permissions';

interface PaywallProps {
  featureName: string;
  description: string;
  onUpgrade?: () => void;
}

export const Paywall: React.FC<PaywallProps> = ({ 
  featureName, 
  description,
  onUpgrade 
}) => {
  if (ENABLE_PREMIUM_BETA) return null;

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg"
      >
        <Card className="border-primary/20 bg-background/50 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          {/* Neon Background Effect */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[64px] -translate-y-1/2 translate-x-1/2" />
          
          <CardHeader className="text-center pt-10 pb-6">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/20">
              <Lock className="text-primary h-8 w-8" />
            </div>
            <CardTitle className="text-3xl font-black tracking-tighter uppercase mb-2">
              Premium Feature
            </CardTitle>
            <CardDescription className="text-neutral-500 text-lg">
              「{featureName}」是進階版功能的專屬內容
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-8 pb-10 px-8">
            <p className="text-sm text-neutral-400 text-center leading-relaxed">
              {description}
            </p>

            <div className="space-y-3 bg-neutral-900/50 p-6 rounded-2xl border border-white/5">
              <h4 className="text-xs font-black uppercase tracking-widest text-[#A0A0A0] mb-4">Elite 版包含：</h4>
              <div className="grid grid-cols-1 gap-3">
                {[
                  '無限量交易標籤與獲利統計',
                  '進階紀律執行分析與等級評鑑',
                  '全域策略模板與核對清單',
                  '未來支援多端同步與大數據回測'
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs font-bold text-neutral-300">
                    <CheckCircle2 size={16} className="text-primary shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Button 
                onClick={onUpgrade}
                size="lg"
                className="w-full bg-white text-black hover:bg-neutral-200 h-14 rounded-2xl font-black text-lg uppercase group"
              >
                <Zap size={18} className="fill-current" />
                立即升級專業版
                <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
              <p className="text-[10px] text-neutral-500 text-center uppercase tracking-[0.2em] font-black">
                Beta 測試階段：目前完全免費
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};
