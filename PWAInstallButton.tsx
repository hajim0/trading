import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Monitor,
  Share,
  Smartphone,
  WifiOff,
  X,
  PlusSquare,
  MoreVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PWAEcosystem, useOnlineStatus, usePWAInstall } from '@/hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'header' | 'banner' | 'button';
  className?: string;
}

type GuideTab = 'ios' | 'android' | 'desktop' | 'macos';

function getDefaultTab(ecosystem: PWAEcosystem): GuideTab {
  if (ecosystem.startsWith('ios')) return 'ios';
  if (ecosystem.startsWith('android')) return 'android';
  if (ecosystem === 'mac-safari') return 'macos';
  return 'desktop';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'sidebar',
  className,
}) => {
  const {
    isInstallable,
    isInstalled,
    isInIframe,
    isInAppBrowser,
    ecosystem,
    install,
  } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<GuideTab>(() => getDefaultTab(ecosystem));
  const [copied, setCopied] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInIframe) {
      setActiveTab(getDefaultTab(ecosystem));
      setShowGuide(true);
      return;
    }

    if (isInstallable) {
      const result = await install();
      if (result === 'accepted') {
        toast.success('Elite Trader 已成功加入您的裝置！');
      } else if (result === 'unavailable') {
        setActiveTab(getDefaultTab(ecosystem));
        setShowGuide(true);
      }
      return;
    }

    setActiveTab(getDefaultTab(ecosystem));
    setShowGuide(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success('網址已複製，請貼上至 Safari 或 Chrome 開啟');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('無法自動複製，請手動複製網址列連結');
    }
  };

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '/';

  const renderTrigger = () => {
    if (variant === 'header') {
      return (
        <button
          type="button"
          onClick={handleAction}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors border',
            isInstallable
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-muted text-foreground border-border hover:bg-accent',
            className
          )}
          title="安裝應用程式"
        >
          <Download size={14} />
          <span>安裝 App</span>
        </button>
      );
    }

    if (variant === 'button') {
      return (
        <button
          type="button"
          onClick={handleAction}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-xl px-5 h-11 text-xs font-bold transition-all cursor-pointer shadow-sm',
            isInstallable
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-secondary text-secondary-foreground border border-border hover:bg-accent',
            className
          )}
        >
          {isInIframe ? <ExternalLink size={15} /> : <Download size={15} />}
          <span>
            {isInIframe
              ? '開啟獨立分頁安裝'
              : isInstallable
              ? '一鍵安裝應用程式'
              : '安裝應用程式教學'}
          </span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={handleAction}
        className={cn(
          'flex items-center gap-3 px-[14px] h-[44px] rounded-[14px] transition-all duration-200 w-full text-left select-none border',
          isInstallable
            ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15 font-bold'
            : 'bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-accent border-border font-medium',
          className
        )}
      >
        {isInIframe ? <ExternalLink size={17} /> : <Download size={17} />}
        <span className="text-[13px] tracking-tight truncate">
          {isInIframe
            ? '開啟獨立分頁安裝'
            : isInstallable
            ? '安裝桌面 / 手機 App'
            : '安裝 App 到主畫面'}
        </span>
      </button>
    );
  };

  return (
    <>
      {renderTrigger()}

      {showGuide && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card text-card-foreground border border-border p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Download size={18} className="text-primary" />
                  安裝 Elite Trader 應用程式
                </h3>
                <p className="text-xs text-muted-foreground">
                  支援 iOS、Android、Windows、macOS 獨立視窗執行與離線記帳。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="關閉"
              >
                <X size={18} />
              </button>
            </div>

            {isInIframe && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  目前處於預覽框架 (iFrame) 中，瀏覽器會限制直接安裝。
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  請先在新分頁開啟完整網址後，即可使用一鍵安裝或「加入主畫面」：
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    <ExternalLink size={14} />
                    <span>在新分頁開啟</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-muted text-foreground border border-border text-xs font-semibold hover:bg-accent transition-colors"
                  >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    <span>{copied ? '已複製' : '複製網址'}</span>
                  </button>
                </div>
              </div>
            )}

            {isInAppBrowser && !isInIframe && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  偵測到您正在使用社群 / App 內建瀏覽器 (如 LINE / IG / FB)
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  App 內建瀏覽器不支援安裝 PWA，請點擊右上角或右下角選單，選擇{' '}
                  <strong className="text-foreground">「以 Safari 開啟」</strong> 或{' '}
                  <strong className="text-foreground">「在預設瀏覽器 (Chrome) 開啟」</strong>。
                </p>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground border border-border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  <span>{copied ? '已複製網址' : '複製網址到瀏覽器開啟'}</span>
                </button>
              </div>
            )}

            {/* Platform Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-muted border border-border">
              {(
                [
                  { id: 'ios', label: 'iPhone/iPad' },
                  { id: 'android', label: 'Android' },
                  { id: 'desktop', label: 'Windows/PC' },
                  { id: 'macos', label: 'Mac Safari' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all truncate',
                    activeTab === tab.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'ios' && (
              <div className="space-y-3 rounded-xl bg-muted/40 border border-border p-4 text-xs">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Smartphone size={16} className="text-primary" />
                  <span>iOS / iPadOS (建議使用 Safari)</span>
                </div>
                <ol className="space-y-2.5 text-muted-foreground list-decimal list-inside leading-relaxed">
                  <li>
                    若目前非 Safari，請先複製網址並在 <strong className="text-foreground">Safari</strong> 開啟（iOS 16.4+ Chrome/Edge 亦支援分享選單安裝）。
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span>1.</span>
                    <span>
                      點擊工具列上的 <strong className="text-foreground inline-flex items-center gap-1"><Share size={13} /> 分享</strong> 按鈕。
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span>2.</span>
                    <span>
                      向下滑動並選擇 <strong className="text-foreground inline-flex items-center gap-1"><PlusSquare size={13} /> 加入主畫面</strong>。
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span>3.</span>
                    <span>
                      點擊右上角 <strong className="text-foreground">「新增」</strong>，即可從主畫面全螢幕啟動。
                    </span>
                  </li>
                </ol>
              </div>
            )}

            {activeTab === 'android' && (
              <div className="space-y-3 rounded-xl bg-muted/40 border border-border p-4 text-xs">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Smartphone size={16} className="text-primary" />
                  <span>Android (Chrome / Edge / Samsung / Firefox)</span>
                </div>
                <ol className="space-y-2.5 text-muted-foreground leading-relaxed">
                  <li>
                    1. 點擊瀏覽器右上角 <strong className="text-foreground inline-flex items-center gap-0.5"><MoreVertical size={13} /> 選單</strong>。
                  </li>
                  <li>
                    2. 選擇 <strong className="text-foreground">「安裝應用程式」</strong> 或 <strong className="text-foreground">「加到主畫面」</strong>。
                  </li>
                  <li>
                    3. 確認安裝後，應用程式將建立獨立圖示並支援離線開啟。
                  </li>
                </ol>
              </div>
            )}

            {activeTab === 'desktop' && (
              <div className="space-y-3 rounded-xl bg-muted/40 border border-border p-4 text-xs">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Monitor size={16} className="text-primary" />
                  <span>桌面版 Chrome / Edge / Arc / Brave</span>
                </div>
                <ol className="space-y-2.5 text-muted-foreground leading-relaxed">
                  <li>
                    1. 查看網址列右側是否出現 <strong className="text-foreground">安裝 (電腦下載圖示)</strong>，點擊即可安裝。
                  </li>
                  <li>
                    2. 若未顯示，請點擊右上角 <strong className="text-foreground">⋮ 選單 →「投放、儲存並分享」→「安裝此網站為應用程式」</strong>（Edge 為「應用程式 → 安裝此網站」）。
                  </li>
                  <li>
                    3. 若曾關閉過安裝提示，請透過網址列右側圖示或上述選單隨時重新安裝。
                  </li>
                </ol>
              </div>
            )}

            {activeTab === 'macos' && (
              <div className="space-y-3 rounded-xl bg-muted/40 border border-border p-4 text-xs">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Monitor size={16} className="text-primary" />
                  <span>macOS Safari (macOS Sonoma 14+)</span>
                </div>
                <ol className="space-y-2.5 text-muted-foreground leading-relaxed">
                  <li>
                    1. 點擊 Safari 頂部選單列的 <strong className="text-foreground">「檔案 (File)」→「加到 Dock」(Add to Dock)</strong>，或工具列的 <strong className="text-foreground">分享 →「加到 Dock」</strong>。
                  </li>
                  <li>
                    2. 點擊 <strong className="text-foreground">「加入」</strong>，即可從 Dock 或 Spotlight 像原生 App 一樣開啟。
                  </li>
                </ol>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted hover:bg-accent text-foreground border border-border text-xs font-semibold transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                <span>{copied ? '已複製網址' : '複製 App 網址'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-black shadow-lg border border-amber-400">
      <WifiOff size={14} className="shrink-0" />
      <span>離線模式運行中 — 異動將保存於本機並在恢復連線後同步</span>
    </div>
  );
};
