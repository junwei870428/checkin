import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../shared/types';
import { api, ApiError } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** 登出或被系統登出時顯示在登入頁的訊息 */
  notice: string;
  refresh: () => Promise<Me | null>;
  logout: (notice?: string) => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/me');
      setMe(m);
      setNotice('');
      return m;
    } catch (e) {
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
    setMe(null);
    setNotice(msg);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthCtx.Provider value={{ me, loading, notice, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return v;
}
