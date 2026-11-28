// 報到端的資料載入
import { useEffect, useState } from 'react';
import type { CheckinContext, CheckinPerson } from '../../../shared/checkin';
import { api, ApiError } from '../../api';

// 斷網時重新整理頁面，用最近一次連線時存下的資料（離線報到，見 offline.ts）
const CTX_KEY = 'ck.off.ctx';
const peopleKey = (staffId: string) => `ck.off.${staffId}.people`;
function stored<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 無痕模式或容量滿時不存
  }
}
const offlineFallback = <T>(key: string) => (e: unknown): T => {
  const v = e instanceof ApiError && e.status === 0 ? stored<T>(key) : null;
  if (v) return v;
  throw e;
};

export type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function errorMessage(e: unknown, fallback = '系統發生錯誤，請稍後再試'): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** 掛載時呼叫 load，retry 再呼叫一次；load 換成別的函式不會自動重新讀取 */
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    load().then(
      data => { if (alive) setState({ status: 'ready', data }); },
      (e: unknown) => { if (alive) setState({ status: 'error', message: errorMessage(e) }); },
    );
    return () => { alive = false; };
  }, [attempt]);
  const retry = () => {
    setState({ status: 'loading' });
    setAttempt(n => n + 1);
  };
  return { state, retry };
}

/** 伺服器回傳的最新人數寫回存下的 context，斷網重新整理時人數才不會是舊的 */
export function updateCachedCount(stationId: string, passedCount: number) {
  const c = stored<CheckinContext>(CTX_KEY);
  const s = c?.stations.find(x => x.id === stationId);
  if (!c || !s) return;
  s.passedCount = passedCount;
  store(CTX_KEY, c);
}

export const loadCheckinContext = () =>
  api.get<CheckinContext>('/checkin/context').then(c => { store(CTX_KEY, c); return c; }, offlineFallback<CheckinContext>(CTX_KEY));

// 手動模式名單每個報到帳號只載入一次（規劃書第 9 節）；失敗就丟掉，重試時重新讀取
const peopleCache = new Map<string, Promise<CheckinPerson[]>>();

export function loadPeople(staffId: string): Promise<CheckinPerson[]> {
  const cached = peopleCache.get(staffId);
  if (cached) return cached;
  const p = api.get<CheckinPerson[]>('/checkin/people')
    .then(list => { store(peopleKey(staffId), list); return list; }, offlineFallback<CheckinPerson[]>(peopleKey(staffId)));
  peopleCache.set(staffId, p);
  p.catch(() => { if (peopleCache.get(staffId) === p) peopleCache.delete(staffId); });
  return p;
}
