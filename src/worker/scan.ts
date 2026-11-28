// 規劃書第 4 節的報到檢核：由掃描當下的資料快照決定結果，不碰資料庫

import type { CheckinPerson, PreviousScan, ScanReason } from '../shared/checkin';
import { eventPhase, type Scope, type StationKind } from '../shared/event';
import { matchesScope } from './scope';

export interface SnapshotEmployee extends CheckinPerson {
  active: number;
}

/** 此員工在本活動各關卡未撤銷的紀錄（正式與演練都在內） */
export interface ActiveScan extends PreviousScan {
  stationId: string;
  stationKind: StationKind;
  rehearsal: boolean;
}

export interface ScanSnapshot {
  event: { startAt: number; endAt: number; rehearsal: boolean; scope: Scope };
  station: { id: string; kind: StationKind; requireCheckin: boolean };
  /** 以掃到的工號查到的員工，查無此人為 null */
  employee: SnapshotEmployee | null;
  /** 是否在 event_members（只有 list 範圍會用到） */
  isMember: boolean;
  activeScans: ActiveScan[];
}

/** rehearsal 是這次掃描是否視為演練；第 2、3 條被拒時一律為 false */
export type ScanDecision =
  | { kind: 'reject'; reason: Extract<ScanReason, 'ended' | 'not_started' | 'not_found'>; rehearsal: boolean }
  | { kind: 'reject'; reason: Extract<ScanReason, 'inactive' | 'out_of_scope' | 'need_checkin'>; rehearsal: boolean; employee: CheckinPerson }
  | { kind: 'dup'; rehearsal: boolean; employee: CheckinPerson; previous: PreviousScan }
  | { kind: 'insert'; rehearsal: boolean; employee: CheckinPerson };

/** 依第 4 節順序檢核，命中第一個失敗條件就回傳 */
export function decideScan(s: ScanSnapshot, now: number): ScanDecision {
  const phase = eventPhase(s.event, now);
  if (phase === 'ended') return { kind: 'reject', reason: 'ended', rehearsal: false };
  if (phase === 'not_started') return { kind: 'reject', reason: 'not_started', rehearsal: false };
  // 演練時以下各條都只比對演練紀錄
  const rehearsal = phase === 'rehearsal';

  const emp = s.employee;
  if (!emp) return { kind: 'reject', reason: 'not_found', rehearsal };
  const employee: CheckinPerson = { empNo: emp.empNo, name: emp.name, dept: emp.dept, plant: emp.plant };
  if (emp.active !== 1) return { kind: 'reject', reason: 'inactive', rehearsal, employee };
  if (!matchesScope(s.event.scope, emp, s.isMember)) return { kind: 'reject', reason: 'out_of_scope', rehearsal, employee };

  const mine = s.activeScans.filter(x => x.rehearsal === rehearsal);
  const prev = mine.find(x => x.stationId === s.station.id);
  if (prev) return { kind: 'dup', rehearsal, employee, previous: { scannedAt: prev.scannedAt, byAccount: prev.byAccount, byHolder: prev.byHolder } };

  if (s.station.kind === 'gift' && s.station.requireCheckin && !mine.some(x => x.stationKind === 'checkin')) {
    return { kind: 'reject', reason: 'need_checkin', rehearsal, employee };
  }
  return { kind: 'insert', rehearsal, employee };
}
