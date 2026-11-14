import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

declare global {
  interface Window {
    __pwaDeferredPrompt?: BeforeInstallPromptEvent | null;
  }
}

export type PWAEcosystem =
  | 'ios-safari'
  | 'ios-inapp'
  | 'ios-browser'
  | 'android-inapp'
  | 'android-chrome'
  | 'android-firefox'
  | 'mac-safari'
  | 'desktop-chromium'
  | 'desktop-firefox'
  | 'other';

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayModes = [
    '(display-mode: standalone)',
    '(display-mode: fullscreen)',
    '(display-mode: minimal-ui)',
    '(display-mode: window-controls-overlay)',
  ];
  const mediaStandalone = displayModes.some((q) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  });
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosStandalone;
}

function detectIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function detectEcosystem(): {
  ecosystem: PWAEcosystem;
  isIOS: boolean;
  isAndroid: boolean;
  isMacSafari: boolean;
  isInAppBrowser: boolean;
} {
  if (typeof navigator === 'undefined') {
    return {
      ecosystem: 'other',
      isIOS: false,
      isAndroid: false,
      isMacSafari: false,
      isInAppBrowser: false,
    };
  }

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isIOS;
  const isInAppBrowser =
    /Line\/|FBAN|FBAV|Instagram|MicroMessenger|Threads|Twitter|Snapchat|WebView|; wv\)/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isSafariEngine =
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|EdgA|EdgiOS|OPR|OPiOS|FxiOS|Firefox|SamsungBrowser|DuckDuckGo/i.test(ua);

  const isMacSafari = isMac && isSafariEngine && !isInAppBrowser;

  let ecosystem: PWAEcosystem = 'other';
  if (isIOS) {
    if (isInAppBrowser) ecosystem = 'ios-inapp';
    else if (isSafariEngine) ecosystem = 'ios-safari';
    else ecosystem = 'ios-browser';
  } else if (isAndroid) {
    if (isInAppBrowser) ecosystem = 'android-inapp';
    else if (isFirefox) ecosystem = 'android-firefox';
    else ecosystem = 'android-chrome';
  } else if (isMacSafari) {
    ecosystem = 'mac-safari';
  } else if (isFirefox) {
    ecosystem = 'desktop-firefox';
  } else {
    ecosystem = 'desktop-chromium';
  }

  return { ecosystem, isIOS, isAndroid, isMacSafari, isInAppBrowser };
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== 'undefined' && window.__pwaDeferredPrompt) {
      return window.__pwaDeferredPrompt;
    }
    return null;
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(() => detectStandalone());
  const [isInIframe] = useState<boolean>(() => detectIframe());
  const [envInfo] = useState(() => detectEcosystem());

  useEffect(() => {
    setIsInstalled(detectStandalone());

    if (window.__pwaDeferredPrompt) {
      setDeferredPrompt(window.__pwaDeferredPrompt);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__pwaDeferredPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handlePromptAvailable = () => {
      if (window.__pwaDeferredPrompt) {
        setDeferredPrompt(window.__pwaDeferredPrompt);
      }
    };

    const handleAppInstalled = () => {
      window.__pwaDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-available', handlePromptAvailable);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('pwa-app-installed', handleAppInstalled);

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayChange = () => setIsInstalled(detectStandalone());
    mediaQuery?.addEventListener?.('change', handleDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-available', handlePromptAvailable);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa-app-installed', handleAppInstalled);
      mediaQuery?.removeEventListener?.('change', handleDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptToUse = deferredPrompt || window.__pwaDeferredPrompt;
    if (!promptToUse) return 'unavailable';

    try {
      await promptToUse.prompt();
      const { outcome } = await promptToUse.userChoice;
      window.__pwaDeferredPrompt = null;
      setDeferredPrompt(null);
      if (outcome === 'accepted') {
        setIsInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.warn('[PWA] Install prompt error:', err);
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    isInstallable: !!deferredPrompt && !isInstalled && !isInIframe,
    isInstalled,
    isStandalone: isInstalled,
    isInIframe,
    isIOS: envInfo.isIOS,
    isAndroid: envInfo.isAndroid,
    isMacSafari: envInfo.isMacSafari,
    isInAppBrowser: envInfo.isInAppBrowser,
    ecosystem: envInfo.ecosystem,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
