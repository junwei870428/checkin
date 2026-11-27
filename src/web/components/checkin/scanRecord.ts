// 一次掃描的結果：結果畫面與最近紀錄共用同一份資料
import { useCallback, useEffect, useState } from 'react';
import type { CheckinPerson, CheckinStation, ScanReason, ScanResponse } from '../../../shared/checkin';
import type { EventPhase } from '../../../shared/event';
import { fmtDT } from '../../format';

export type ScanStatus = ScanResponse['status'];

export interface ScanRecord {
  id: string;
  status: ScanStatus;
  /** 結果畫面的大標題 */
  title: string;
  /** 標題下方的補充，例如重複時第一次通過的時間 */
  detail: string | null;
  employee: CheckinPerson | null;
  /** 送出的內容，查無此工號時顯示 */
  code: string;
  at: number;
  manual: boolean;
  rehearsal: boolean;
  /** 通過的紀錄才有，撤銷用 */
  scanId: string | null;
  voided: boolean;
}

export interface ScanAttempt {
  code: string;
  manual: boolean;
}

const REASON_TITLE: Record<ScanReason, string> = {
  ended: '活動已結束',
  not_started: '活動尚未開始',
  not_found: '查無此工號',
  inactive: '此工號已停用',
  out_of_scope: '不在本活動名單',
  need_checkin: '尚未完成入場報到',
};

// 區網用 http 測試時沒有 crypto.randomUUID
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function recordFromResponse(
  res: ScanResponse,
  attempt: ScanAttempt,
  station: CheckinStation,
  stations: CheckinStation[],
): ScanRecord {
  const base = { ...attempt, id: newId(), at: Date.now(), rehearsal: res.rehearsal, employee: res.employee, scanId: null, voided: false };
  switch (res.status) {
    case 'ok':
      return { ...base, status: 'ok', title: `${station.name}完成`, detail: null, scanId: res.scan.id };
    case 'dup':
      return { ...base, status: 'dup', title: `此人已${station.name}`, detail: `${fmtDT(res.previous.scannedAt)} 由 ${res.previous.byAccount} 處理` };
    case 'error': {
      let detail: string | null = null;
      if (res.reason === 'not_found') detail = `讀到的內容：${attempt.code}`;
      if (res.reason === 'need_checkin') {
        const checkin = stations.find(s => s.kind === 'checkin');
        if (checkin) detail = `請先到「${checkin.name}」報到`;
      }
      return { ...base, status: 'error', title: REASON_TITLE[res.reason], detail };
    }
  }
}

/** 連線失敗或 API 回錯誤時，以紅色結果顯示錯誤訊息 */
export function recordFromError(message: string, attempt: ScanAttempt): ScanRecord {
  return { ...attempt, id: newId(), at: Date.now(), status: 'error', title: message, detail: null, employee: null, rehearsal: false, scanId: null, voided: false };
}

export function phaseAfterScan(res: ScanResponse): EventPhase {
  if (res.reason === 'not_started') return 'not_started';
  return res.rehearsal ? 'rehearsal' : 'live';
}

const RECENT_LIMIT = 12;
const recentKey = (stationId: string) => `checkin.recent.${stationId}`;

function loadRecent(stationId: string): ScanRecord[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(recentKey(stationId)) ?? '[]');
    return Array.isArray(v) ? (v as ScanRecord[]).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** 本關卡在這個分頁最近 12 筆結果，存在 sessionStorage，重新整理後仍在 */
export function useRecent(stationId: string) {
  const [list, setList] = useState(() => loadRecent(stationId));
  useEffect(() => {
    try {
      sessionStorage.setItem(recentKey(stationId), JSON.stringify(list));
    } catch {
      // 無痕模式或容量滿時只留在記憶體
    }
  }, [stationId, list]);
  const add = useCallback((r: ScanRecord) => setList(l => [r, ...l].slice(0, RECENT_LIMIT)), []);
  const markVoided = useCallback(
    (scanId: string) => setList(l => l.map(r => (r.scanId === scanId ? { ...r, voided: true } : r))),
    [],
  );
  return { list, add, markVoided };
}
