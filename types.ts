export type Side = 'Long' | 'Short';
export type Result = 'Profit' | 'Loss' | 'Open';
export type Rating = 'S' | 'A' | 'B' | 'C';
export type Plan = 'free' | 'pro';
export type DisciplineMode = 'relaxed' | 'semi' | 'strict';

export interface DisciplineGrades {
  S: number; // min score for S, e.g. 90
  A: number; // min score for A, e.g. 80
  B: number; // min score for B, e.g. 70
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  plan: Plan;
  role: 'user' | 'admin';
  disciplineMode: DisciplineMode;
  disciplineGrades?: DisciplineGrades;
  initialCapital: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/**
 * DisciplineTemplate (formerly StrategyTemplate)
 * Defines a set of pre-entry rules/checklist items to follow.
 */
export interface StrategyTemplate {
  id: string;
  userId: string;
  name: string;
  description: string;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/**
 * DisciplineRule (formerly StrategyChecklistItem)
 * A specific rule that must be checked before entering a trade.
 */
export interface StrategyChecklistItem {
  id: string;
  templateId: string;
  text: string;
  weight: number;
  required: boolean;
  sortOrder: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface ChecklistSnapshotItem {
  itemId: string;
  text: string;
  weight: number;
  required: boolean;
  checked: boolean;
  sortOrder: number;
}

export interface Transaction {
  id: string;
  userId: string;
  symbol: string;
  date: string;
  side: Side;
  result: Result;
  rating: Rating;
  uValue: number;
  stopLossReason: string;
  entryReason: string;
  review: string;
  tagIds: string[];
  screenshots: string[]; // Still for legacy Cloud URLs
  imageOriginalId?: string;  // Local IndexedDB ID
  imageThumbnailId?: string; // Local IndexedDB ID
  strategyId?: string;
  checklistScore?: number;
  passedRequiredCheck?: boolean;
  missingRequiredItems?: string[];
  checklistSnapshot?: ChecklistSnapshotItem[];
  forceSubmit?: boolean;
  modeUsed?: DisciplineMode;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  localOnly: boolean;
  syncStatus?: 'pending' | 'synced' | 'failed';
  cloudBackedUpAt?: string;
}

export interface TradeStats {
  totalTrades: number;
  profitCount: number;
  lossCount: number;
  winRate: number;
  totalU: number;
  maxDrawdown: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  initialCapital: number;
  currentStreak: number;
  currentStreakType: 'Profit' | 'Loss' | 'None';
  averageProfit: number;
  averageLoss: number;
  profitLossRatio: number;
}
