// 活動的共用型別與狀態判斷（前後端共用）

/** 活動結束後保留資料的時間，到期由排程刪除（F-RET-2） */
export const RETAIN_MS = 10 * 86_400_000;

/** 參加範圍。部門以 [廠別, 部門] 成對表示，不同廠的同名部門是不同部門；list 的名單在 event_members */
export type Scope =
  | { type: 'all' }
  | { type: 'plants'; plants: string[] }
  | { type: 'depts'; depts: Array<[plant: string, dept: string]> }
  | { type: 'list' };

export type EventPhase = 'not_started' | 'rehearsal' | 'live' | 'ended';

/** 演練模式只在開始時間前有效，開始後一律是正式（F-EVT-7） */
export function eventPhase(e: { startAt: number; endAt: number; rehearsal: boolean }, now: number): EventPhase {
  if (now >= e.endAt) return 'ended';
  if (now < e.startAt) return e.rehearsal ? 'rehearsal' : 'not_started';
  return 'live';
}

export type StationKind = 'checkin' | 'gift';

export interface StationDetail {
  id: string;
  name: string;
  kind: StationKind;
  requireCheckin: boolean;
  sortOrder: number;
  /** 正式紀錄通過人數快取（stations.passed_count） */
  passedCount: number;
}

/** GET /api/events/:id 的回應 */
export interface EventDetail {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  startAt: number;
  endAt: number;
  rehearsal: boolean;
  scope: Scope;
  /** event_members 筆數，也就是匯入名單的工號數（含不在員工資料中的工號） */
  memberCount: number;
  stations: StationDetail[];
  /** 排程刪除時間，endAt + RETAIN_MS */
  deleteAt: number;
}
