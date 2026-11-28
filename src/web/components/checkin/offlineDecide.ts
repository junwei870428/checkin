// 離線時在手機上判斷一次掃描：規則與伺服器的 decideScan 相同，但資料來自最近一次連線時存下的名單與已通過紀錄。
// 名單只有範圍內在職人員，所以查無此人、已停用、不在範圍都歸為「不在本活動名單」。

import type { CheckinPerson, CheckinStation } from '../../../shared/checkin';
import { eventPhase } from '../../../shared/event';

export interface OfflineData {
  /** 工號 → 人員（範圍內在職） */
  people: Map<string, CheckinPerson>;
  /** 關卡 id → 已通過的工號 */
  passed: Map<string, Set<string>>;
  /** passed 是演練紀錄還是正式紀錄 */
  rehearsal: boolean;
}

export type OfflineDecision =
  | { kind: 'queue'; employee: CheckinPerson; rehearsal: boolean }
  | { kind: 'dup'; employee: CheckinPerson; rehearsal: boolean }
  | { kind: 'error'; reason: 'ended' | 'not_started' | 'not_in_list' | 'need_checkin'; employee: CheckinPerson | null; rehearsal: boolean };

export function decideOffline(
  event: { startAt: number; endAt: number; rehearsal: boolean },
  station: CheckinStation,
  stations: CheckinStation[],
  code: string,
  data: OfflineData,
  now: number,
): OfflineDecision {
  const phase = eventPhase(event, now);
  if (phase === 'ended') return { kind: 'error', reason: 'ended', employee: null, rehearsal: false };
  if (phase === 'not_started') return { kind: 'error', reason: 'not_started', employee: null, rehearsal: false };
  const rehearsal = phase === 'rehearsal';
  const employee = data.people.get(code) ?? null;
  if (!employee) return { kind: 'error', reason: 'not_in_list', employee: null, rehearsal };
  // 存下的紀錄若是另一種（例如演練剛轉正式），當作還沒有人通過，交給伺服器補送時判斷
  const passed = (stationId: string) => data.rehearsal === rehearsal && !!data.passed.get(stationId)?.has(code);
  if (passed(station.id)) return { kind: 'dup', employee, rehearsal };
  if (station.kind === 'gift' && station.requireCheckin) {
    const checkin = stations.find(s => s.kind === 'checkin');
    if (checkin && !passed(checkin.id)) return { kind: 'error', reason: 'need_checkin', employee, rehearsal };
  }
  return { kind: 'queue', employee, rehearsal };
}
