// 活動設定與報到人員帳號 API 的共用型別（第 3 階段，規劃書 F-EVT-1 到 F-EVT-9、F-ACC-2、F-ACC-3）

import type { Scope, StationKind } from './event';

/** 帳號代碼：2 到 8 碼大寫英數（F-EVT-1） */
export const CODE_RE = /^[A-Z0-9]{2,8}$/;
export const NAME_MAX = 60;
export const STATION_NAME_MAX = 30;
export const MAX_STATIONS = 10;
/** 匯入名單的工號數上限 */
export const MAX_MEMBERS = 5000;
/** 一次產生的報到帳號數（F-ACC-2） */
export const STAFF_BATCH_MAX = 50;

/** GET /api/events 的一筆 */
export interface EventListItem {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  startAt: number;
  endAt: number;
  rehearsal: boolean;
  deleteAt: number;
  /** 範圍內在職人數 */
  total: number;
  stations: Array<{ id: string; name: string; kind: StationKind; passedCount: number }>;
}

/** POST /api/events */
export interface CreateEventBody {
  name: string;
  code: string;
  startAt: number;
  endAt: number;
}

/** 有 id 是修改既有關卡，沒有 id 是新增領取關卡；入場報到關卡只能修改名稱 */
export interface StationInput {
  id?: string;
  name: string;
  requireCheckin: boolean;
}

/** PUT /api/events/:id：關卡帶完整陣列，原本有、這次沒帶的視為刪除 */
export interface UpdateEventBody {
  name: string;
  startAt: number;
  endAt: number;
  scope: Scope;
  stations: StationInput[];
}

/** POST /api/events/:id/members 的回應 */
export interface MembersResult {
  /** 去除重複後的名單人數 */
  count: number;
  /** 不在員工資料中的工號 */
  unknown: string[];
  /** 名單中在職的人數，也就是 list 範圍的範圍內人數 */
  active: number;
}

/** 在職員工依廠別、部門分組的人數 */
export interface ScopeGroup {
  plant: string;
  dept: string;
  count: number;
}

/** GET /api/scope-options；帶 eventId 時另回傳該活動名單中的在職人數 */
export interface ScopeOptions {
  groups: ScopeGroup[];
  listActive?: number;
}

/** 依分組人數計算範圍內在職人數；list 範圍由後端算好傳入 */
export function scopeCount(scope: Scope, groups: ScopeGroup[], listActive: number): number {
  const sum = (keep: (g: ScopeGroup) => boolean) => groups.reduce((n, g) => (keep(g) ? n + g.count : n), 0);
  switch (scope.type) {
    case 'all':
      return sum(() => true);
    case 'plants':
      return sum(g => scope.plants.includes(g.plant));
    case 'depts':
      return sum(g => scope.depts.some(([p, d]) => p === g.plant && d === g.dept));
    case 'list':
      return listActive;
  }
}

/** GET /api/events/:id/staff 的一筆，不含 PIN */
export interface StaffAccount {
  id: string;
  account: string;
  /** 使用人姓名；舊資料可能是空字串 */
  holder: string;
  disabled: boolean;
  lockUntil: number;
}

/** 產生或重設後回傳一次的帳號與 PIN */
export interface StaffSecret {
  id: string;
  account: string;
  holder: string;
  pin: string;
}

/** 使用人姓名長度上限 */
export const HOLDER_MAX = 20;

/** POST /api/events/:id/staff：每位使用人產生一組帳號，依順序配發流水號 */
export interface CreateStaffBody {
  holders: string[];
}

/** PATCH /api/staff/:id 的 action；改使用人改送 { holder } */
export type StaffAction = 'disable' | 'enable' | 'unlock';

/** 驗證並整理使用人姓名，回傳錯誤訊息或整理後的姓名 */
export function parseHolder(v: unknown): string | { error: string } {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { error: '請填寫使用人姓名' };
  if (s.length > HOLDER_MAX) return { error: `使用人姓名最多 ${HOLDER_MAX} 字` };
  return s;
}
