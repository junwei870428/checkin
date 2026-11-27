// 報到端的資料載入
import { useEffect, useState } from 'react';
import type { CheckinContext, CheckinPerson } from '../../../shared/checkin';
import { api, ApiError } from '../../api';

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

export const loadCheckinContext = () => api.get<CheckinContext>('/checkin/context');

// 手動模式名單每個報到帳號只載入一次（規劃書第 9 節）；失敗就丟掉，重試時重新讀取
const peopleCache = new Map<string, Promise<CheckinPerson[]>>();

export function loadPeople(staffId: string): Promise<CheckinPerson[]> {
  const cached = peopleCache.get(staffId);
  if (cached) return cached;
  const p = api.get<CheckinPerson[]>('/checkin/people');
  peopleCache.set(staffId, p);
  p.catch(() => { if (peopleCache.get(staffId) === p) peopleCache.delete(staffId); });
  return p;
}
