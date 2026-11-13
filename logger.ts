/**
 * LOGGER UTILITY
 * 集中管理日誌輸出，避免生產環境曝露過多偵錯資訊。
 */

const ENABLE_DEBUG = import.meta.env.VITE_ENABLE_DEBUG_LOGS === 'true';

export const logger = {
  log: (...args: any[]) => {
    if (ENABLE_DEBUG) {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (ENABLE_DEBUG) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    // 錯誤日誌通常在生產環境也需要保留以便排查
    console.error(...args);
  },
  group: (name: string) => {
    if (ENABLE_DEBUG) {
      console.group(name);
    }
  },
  groupEnd: () => {
    if (ENABLE_DEBUG) {
      console.groupEnd();
    }
  },
  debug: (...args: any[]) => {
    if (ENABLE_DEBUG) {
      console.debug(...args);
    }
  }
};
