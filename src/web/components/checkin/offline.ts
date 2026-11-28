// 離線報到：本機名單、已通過紀錄與待上傳佇列。都存在 localStorage，重新整理或關掉分頁不會遺失。
// 500 人的名單約 50 KB，比對在記憶體中進行，不會拖慢手機。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Device, PassedSnapshot, ScanRequest, ScanResponse } from '../../../shared/checkin';
import { api, ApiError } from '../../api';
import { loadPeople } from './data';
import type { OfflineData } from './offlineDecide';

const PROBE_MS = 10_000;
const POLL_MS = 30_000;
const REPLAY_TIMEOUT_MS = 8_000;

export const offlineKey = (staffId: string, name: 'queue' | 'people' | 'passed') => `ck.off.${staffId}.${name}`;

export function readStored<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 無痕模式或容量滿時只留在記憶體
  }
}

/** 連不上伺服器（斷網、逾時）；伺服器有回應的錯誤不算 */
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

/** 區網 http 測試時沒有 crypto.randomUUID，用 getRandomValues 產生 */
export function newClientId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `c-${Array.from(b, x => x.toString(16).padStart(2, '0')).join('')}`;
}

export interface QueueItem {
  clientId: string;
  stationId: string;
  code: string;
  manual: boolean;
  device: Device;
  /** 已用伺服器時間校正的刷卡時間 */
  scannedAt: number;
}

interface StoredPassed {
  cursor: number;
  rehearsal: boolean;
  items: Array<[string, string]>;
}

export type ReplayOutcome = { item: QueueItem; res: ScanResponse } | { item: QueueItem; error: ApiError };

function toPassed(items: Array<[string, string]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [s, e] of items) {
    if (!m.has(s)) m.set(s, new Set());
    m.get(s)!.add(e);
  }
  return m;
}

/**
 * 掃描頁的離線狀態。online 為 false 時新的掃描直接在本機判斷；
 * 有待上傳的紀錄就每 10 秒補送一次，連線時每 30 秒更新一次已通過紀錄。
 */
export function useOffline(staffId: string, onReplay: (outcomes: ReplayOutcome[]) => void) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>(() => readStored<QueueItem[]>(offlineKey(staffId, 'queue')) ?? []);
  const queueRef = useRef(queue);
  const onlineRef = useRef(online);
  const offsetRef = useRef(0);
  const flushing = useRef(false);
  const lastPoll = useRef(0);
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;

  const [stored] = useState(() => readStored<StoredPassed>(offlineKey(staffId, 'passed')));
  const cursor = useRef(stored?.cursor ?? 0);
  const passedItems = useRef<Array<[string, string]>>(stored?.items ?? []);
  const data = useRef<OfflineData>({ people: new Map(), passed: toPassed(passedItems.current), rehearsal: stored?.rehearsal ?? false });

  const setQ = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setQueue(next);
    writeStored(offlineKey(staffId, 'queue'), next);
  }, [staffId]);

  const setOn = useCallback((v: boolean) => {
    onlineRef.current = v;
    setOnline(v);
  }, []);

  const savePassed = useCallback(() => {
    writeStored(offlineKey(staffId, 'passed'), { cursor: cursor.current, rehearsal: data.current.rehearsal, items: passedItems.current });
  }, [staffId]);

  const addPassed = useCallback((stationId: string, empNo: string) => {
    const set = data.current.passed.get(stationId) ?? new Set<string>();
    if (set.has(empNo)) return;
    set.add(empNo);
    data.current.passed.set(stationId, set);
    passedItems.current.push([stationId, empNo]);
    savePassed();
  }, [savePassed]);

  const removePassed = useCallback((stationId: string, empNo: string) => {
    data.current.passed.get(stationId)?.delete(empNo);
    passedItems.current = passedItems.current.filter(([s, e]) => !(s === stationId && e === empNo));
    savePassed();
  }, [savePassed]);

  /** 更新已通過紀錄；full 時從頭讀，演練與正式切換時也會從頭讀 */
  const refresh = useCallback(async (full = false) => {
    const s = await api.get<PassedSnapshot>(`/checkin/passed?after=${full ? 0 : cursor.current}`);
    offsetRef.current = s.serverNow - Date.now();
    if (!full && s.rehearsal !== data.current.rehearsal) return refresh(true);
    if (full) passedItems.current = [];
    passedItems.current.push(...s.items);
    data.current.passed = toPassed(passedItems.current);
    data.current.rehearsal = s.rehearsal;
    cursor.current = s.cursor;
    lastPoll.current = Date.now();
    savePassed();
  }, [savePassed]);

  /** 依序補送；斷線就停下等下一輪，伺服器有回應的錯誤（例如 400）也算處理完，避免卡住後面的紀錄 */
  const flush = useCallback(async () => {
    if (flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    const outcomes: ReplayOutcome[] = [];
    try {
      for (const item of [...queueRef.current]) {
        const body: ScanRequest = { stationId: item.stationId, code: item.code, manual: item.manual, device: item.device, clientId: item.clientId, scannedAt: item.scannedAt };
        try {
          outcomes.push({ item, res: await api.post<ScanResponse>('/checkin/scan', body, { timeoutMs: REPLAY_TIMEOUT_MS }) });
        } catch (e) {
          if (isNetworkError(e)) {
            setOn(false);
            break;
          }
          // 401 由 AuthProvider 登出，佇列留著，用同一個帳號登入後繼續補送
          if (e instanceof ApiError && e.status === 401) break;
          outcomes.push({ item, error: e instanceof ApiError ? e : new ApiError(500, 'unknown', '補送失敗') });
        }
        setQ(queueRef.current.filter(q => q.clientId !== item.clientId));
      }
      if (!queueRef.current.length) {
        setOn(true);
        await refresh().catch(() => {});
      }
    } finally {
      flushing.current = false;
      if (outcomes.length) onReplayRef.current(outcomes);
    }
  }, [refresh, setOn, setQ]);

  // 載入名單與已通過紀錄；連不上就用上次存下的
  useEffect(() => {
    loadPeople(staffId).then(list => { data.current.people = new Map(list.map(p => [p.empNo, p])); }).catch(() => {});
    refresh(true).catch(e => { if (isNetworkError(e)) setOn(false); });
  }, [staffId, refresh, setOn]);

  useEffect(() => {
    const tick = () => {
      if (queueRef.current.length) void flush();
      else if (!onlineRef.current) refresh().then(() => setOn(true)).catch(() => {});
      else if (Date.now() - lastPoll.current >= POLL_MS) refresh().catch(e => { if (isNetworkError(e)) setOn(false); });
    };
    const t = setInterval(tick, PROBE_MS);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', tick);
    };
  }, [flush, refresh, setOn]);

  const enqueue = useCallback((item: QueueItem, empNo: string) => {
    setQ([...queueRef.current, item]);
    addPassed(item.stationId, empNo);
  }, [addPassed, setQ]);

  /** 撤銷還沒上傳的紀錄：從佇列移除，本機也不再算通過 */
  const dequeue = useCallback((clientId: string, empNo: string | null) => {
    const item = queueRef.current.find(q => q.clientId === clientId);
    if (!item) return false;
    setQ(queueRef.current.filter(q => q.clientId !== clientId));
    if (empNo) removePassed(item.stationId, empNo);
    return true;
  }, [removePassed, setQ]);

  return {
    online,
    queue,
    data: data.current,
    /** 用伺服器時間校正過的現在時間 */
    now: () => Date.now() + offsetRef.current,
    markOffline: () => setOn(false),
    notePassed: (stationId: string, empNo: string, rehearsal: boolean) => {
      if (rehearsal === data.current.rehearsal) addPassed(stationId, empNo);
    },
    enqueue,
    dequeue,
  };
}
