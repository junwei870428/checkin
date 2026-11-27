// 報到端 API（/api/checkin/*）的共用型別

import type { EventPhase } from './event';
import type { StaffMe, StationInfo } from './types';

/** 掃描被拒的原因，對應規劃書第 4 節第 2 到 6、8 條 */
export type ScanReason = 'ended' | 'not_started' | 'not_found' | 'inactive' | 'out_of_scope' | 'need_checkin';

export type Device = 'mobile' | 'desktop';

/** 範圍內人員，也是掃描結果顯示的員工資料 */
export interface CheckinPerson {
  empNo: string;
  name: string;
  dept: string;
  plant: string;
}

/** POST /api/checkin/scan；device 省略時由 User-Agent 判斷 */
export interface ScanRequest {
  stationId: string;
  code: string;
  manual?: boolean;
  device?: Device;
}

export interface ScanRef {
  id: string;
  scannedAt: number;
  byAccount: string;
}

export interface PreviousScan {
  scannedAt: number;
  byAccount: string;
}

/**
 * 掃描結果，一律 HTTP 200（規劃書第 7 節）。
 * rehearsal 為這次掃描是否視為演練；passedCount 為本關卡人數，演練時是演練紀錄數。
 */
export type ScanResponse = { rehearsal: boolean; passedCount: number } & (
  | { status: 'ok'; reason: null; employee: CheckinPerson; scan: ScanRef; previous: null }
  | { status: 'dup'; reason: null; employee: CheckinPerson; scan: null; previous: PreviousScan }
  | { status: 'error'; reason: 'ended' | 'not_started' | 'not_found'; employee: null; scan: null; previous: null }
  | { status: 'error'; reason: 'inactive' | 'out_of_scope' | 'need_checkin'; employee: CheckinPerson; scan: null; previous: null }
);

/** POST /api/checkin/void */
export interface VoidRequest {
  scanId: string;
}

/** 撤銷後該筆紀錄所屬關卡的人數（正式為 passed_count，演練為演練紀錄數） */
export interface VoidResponse {
  passedCount: number;
}

export interface CheckinStation extends StationInfo {
  /** 正式為 stations.passed_count；演練模式中為未撤銷的演練紀錄數 */
  passedCount: number;
}

/** GET /api/checkin/context */
export interface CheckinContext {
  event: StaffMe['event'];
  phase: EventPhase;
  stations: CheckinStation[];
  /** 範圍內在職人數 */
  scopeTotal: number;
}
