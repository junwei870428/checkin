// fetch 包裝：一律送 JSON，錯誤轉成 ApiError，前端直接顯示 message

import type { ApiErrorBody } from '../shared/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// 已登入的請求收到 401（登入逾時、帳號停用、活動結束）時通知 AuthProvider 登出
let onUnauthorized: (message: string) => void = () => {};
export function setUnauthorizedHandler(fn: (message: string) => void) {
  onUnauthorized = fn;
}

export interface RequestOptions {
  /** 超過這個時間沒有回應就當作連不上（ApiError status 0） */
  timeoutMs?: number;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : 0;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal: ctrl?.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network', '無法連線，請確認網路後再試');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    const err = new ApiError(res.status, e?.code ?? 'unknown', e?.message ?? `系統發生錯誤（${res.status}）`);
    if (res.status === 401 && !path.startsWith('/auth/') && path !== '/me') onUnauthorized(err.message);
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
