import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../shared/types';
import { api, ApiError, setUnauthorizedHandler } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** 登出或被系統登出時顯示在登入頁的訊息 */
  notice: string;
  refresh: () => Promise<Me | null>;
  logout: (notice?: string) => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

// 報到人員斷網時重新整理頁面，用上次的登入資料繼續離線報到；後台帳號不存
const ME_KEY = 'ck.off.me';
function cachedStaff(): Me | null {
  try {
    const m = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as Me | null;
    return m?.type === 'staff' ? m : null;
  } catch {
    return null;
  }
}
/** 登出時清掉名單等個資；待上傳的紀錄留著，用同一個帳號登入後繼續補送 */
function clearOfflineCache() {
  try {
    const m = cachedStaff();
    localStorage.removeItem(ME_KEY);
    localStorage.removeItem('ck.off.ctx');
    if (m) for (const k of ['people', 'passed']) localStorage.removeItem(`ck.off.${m.id}.${k}`);
  } catch {
    // localStorage 不能用時沒有東西要清
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/me');
      try {
        if (m.type === 'staff') localStorage.setItem(ME_KEY, JSON.stringify(m));
        else clearOfflineCache();
      } catch {
        // 無痕模式時不存
      }
      setMe(m);
      setNotice('');
      return m;
    } catch (e) {
      const offline = e instanceof ApiError && e.status === 0 ? cachedStaff() : null;
      if (offline) {
        setMe(offline);
        return offline;
      }
      if (e instanceof ApiError && e.status === 401) clearOfflineCache();
      setMe(null);
      // 已登入卻被拒（例如活動結束）時，把原因帶到登入頁
      if (e instanceof ApiError && e.status === 401 && e.message !== '請重新登入') setNotice(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (msg = '') => {
    await api.post('/auth/logout').catch(() => {});
    clearOfflineCache();
    setMe(null);
    setNotice(msg);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(msg => {
      clearOfflineCache();
      setMe(null);
      setNotice(msg === '請重新登入' ? '登入已逾時，請重新登入' : msg);
    });
    void refresh();
  }, [refresh]);

  return <AuthCtx.Provider value={{ me, loading, notice, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return v;
}
