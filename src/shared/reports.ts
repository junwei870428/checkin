// 報表 API 的回應型別（F-RPT-1、F-RPT-2）。人數一律只算未撤銷的正式紀錄中，目前在參加範圍內且在職的人（規劃書第 4 節）

import type { StationKind } from './event';

/** 報表用的關卡資訊，依活動設定的順序排列 */
export interface ReportStation {
  id: string;
  name: string;
  kind: StationKind;
}

/** GET /api/events/:id/summary：輕量即時人數 */
export interface EventSummary {
  /** passed 是 stations.passed_count 快取 */
  stations: Array<ReportStation & { passed: number }>;
  /** 範圍內在職人數，只在 ?total=1 時回傳（需要 COUNT，前端每 5 分鐘取一次） */
  total?: number;
  /** 演練模式中才回傳：各關卡的演練人數，鍵為關卡 id */
  rehearsal?: Record<string, number>;
}

/** 應到人數與各關卡通過人數，passed 的順序與 stations 相同 */
export interface BreakdownCounts {
  expected: number;
  passed: number[];
}

export interface BreakdownDept extends BreakdownCounts {
  dept: string;
}

/** 廠別本身的數字是該廠小計 */
export interface BreakdownPlant extends BreakdownCounts {
  plant: string;
  depts: BreakdownDept[];
}

/** GET /api/events/:id/breakdown：依廠別、部門排序 */
export interface EventBreakdown {
  stations: ReportStation[];
  plants: BreakdownPlant[];
}

/** 某人在某關卡的正式通過紀錄 */
export interface RosterPass {
  at: number;
  by: string;
  /** 掃描當下的帳號使用人，舊資料是空字串 */
  byHolder: string;
  manual: boolean;
}

export interface RosterPerson {
  empNo: string;
  name: string;
  dept: string;
  plant: string;
  /** 鍵為關卡 id，只含已通過的關卡 */
  passes: Record<string, RosterPass>;
}

/** GET /api/events/:id/roster：範圍內在職人員，依廠別、部門、工號排序 */
export interface EventRoster {
  stations: ReportStation[];
  people: RosterPerson[];
}
