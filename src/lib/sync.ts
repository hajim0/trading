import { dataService, FullBackupData, RestoreResult } from './dataService';
import { auth } from '../firebase';
import { toast } from 'sonner';

export type BackupData = FullBackupData;

export const syncService = {
  /**
   * Pack all user data dynamically (fresh at call time)
   */
  async packageLocalData(): Promise<FullBackupData> {
    const currentUid = auth?.currentUser?.uid || 'local-user';
    const email = auth?.currentUser?.email || undefined;
    return await dataService.packageFullBackup(currentUid, email);
  },

  /**
   * Upload Local Data and Overwrite Cloud
   */
  async uploadBackup() {
    const user = auth?.currentUser;
    if (!user) {
      throw new Error('未偵測到登入狀態，請先登入 Google 帳號再進行雲端備份');
    }
    const result = await dataService.cloudBackup(user);
    return true;
  },

  /**
   * Download Cloud Backup and Overwrite Local
   */
  async downloadBackup() {
    const user = auth?.currentUser;
    if (!user) {
      throw new Error('未偵測到登入狀態，請先登入 Google 帳號再進行雲端還原');
    }
    const result = await dataService.cloudRestore(user);
    return true;
  },

  /**
   * JSON Export with complete trades, tags, strategies, rules, settings, and base64 images
   */
  async exportToJson() {
    const toastId = toast.loading('正在擷取最新資料並封裝圖片...');
    try {
      const currentUid = auth?.currentUser?.uid || 'local-user';
      const email = auth?.currentUser?.email || undefined;
      const res = await dataService.exportJsonBackup(currentUid, email);
      toast.success(`備份檔案下載成功！包含 ${res.totalTrades} 筆交易與 ${res.totalBlobs} 個附件`, { id: toastId });
      return res;
    } catch (e: any) {
      console.error('[syncService] exportToJson error:', e);
      toast.error(`匯出失敗：${e?.message || '未知錯誤'}`, { id: toastId });
      throw e;
    }
  },

  /**
   * JSON Import with validation, image reconstruction, and auto-sync to cloud
   */
  async importFromJson(file: File): Promise<RestoreResult> {
    const toastId = toast.loading('正在驗證並還原備份檔案...');
    try {
      const currentUid = auth?.currentUser?.uid || 'local-user';
      const result = await dataService.importJsonBackup(file, currentUid);
      toast.success(
        `還原成功！已匯入 ${result.tradesCount} 筆交易與 ${result.blobsCount} 個圖片附件`,
        { id: toastId }
      );
      return result;
    } catch (e: any) {
      console.error('[syncService] importFromJson error:', e);
      toast.error(`匯入失敗: ${e?.message || '格式不正確'}`, { id: toastId });
      throw e;
    }
  },

  /**
   * Get Cloud Backup Info
   */
  async getCloudBackupInfo() {
    const user = auth?.currentUser || null;
    return await dataService.getCloudBackupInfo(user);
  },

  // Legacy/Stub for compatibility during migration
  queueSync(_entity?: string) {
    // No-op
  }
};
