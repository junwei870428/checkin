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
  /** 裝置產生的紀錄編號，同一筆重送只會記一次 */
  clientId?: string;
  /** 補送離線紀錄時帶刷卡當下的時間（已用伺服器時間校正），沒帶就是伺服器現在時間 */
  scannedAt?: number;
}

/** GET /api/checkin/passed?after=：各關卡 rowid 大於 after 的有效紀錄，給離線判斷用 */
export interface PassedSnapshot {
  /** 下次查詢帶的 after */
  cursor: number;
  /** 這次比對的是演練紀錄還是正式紀錄 */
  rehearsal: boolean;
  serverNow: number;
  /** [關卡 id, 工號] */
  items: Array<[string, string]>;
}

export interface ScanRef {
  id: string;
  scannedAt: number;
  byAccount: string;
  /** 掃描當下的帳號使用人，舊資料是空字串 */
  byHolder: string;
}

export interface PreviousScan {
  scannedAt: number;
  byAccount: string;
  byHolder: string;
}

/** 顯示用：XMAS-01（王小明），沒有使用人時只顯示帳號 */
export const staffLabel = (account: string, holder: string) => (holder ? `${account}（${holder}）` : account);

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
