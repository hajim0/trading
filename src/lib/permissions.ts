/**
 * FEATURE ACCESS CONTROL
 * 集中管理所有功能的存取權限。
 */

export const getFeatureAccess = (userProfile: any, env: any) => {
  const ENABLE_PREMIUM_BETA = env?.VITE_ENABLE_PREMIUM_BETA === 'true';

  const isPro = userProfile?.plan === 'pro';
  const isAdmin = userProfile?.role === 'admin';

  const hasPremiumAccess = ENABLE_PREMIUM_BETA
    ? true
    : (isPro || isAdmin);

  return {
    hasPremiumAccess,
    canUseTagManagement: hasPremiumAccess,
    canUseTagAnalysis: hasPremiumAccess,
    canUseDisciplineAnalysis: hasPremiumAccess,
    canUseStrategies: hasPremiumAccess,
    shouldShowPaywall: !hasPremiumAccess,
  };
};

export const ENABLE_PREMIUM_BETA = import.meta.env.VITE_ENABLE_PREMIUM_BETA === 'true';
