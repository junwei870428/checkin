import { Alert, Snackbar, type AlertColor } from '@mui/material';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type Notify = (msg: string, severity?: AlertColor) => void;

const NotifyCtx = createContext<Notify | null>(null);

/** 畫面底部的短暫通知，一次顯示一則 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<{ msg: string; severity: AlertColor; key: number } | null>(null);
  const notify = useCallback<Notify>((msg, severity = 'info') => setSnack({ msg, severity, key: Date.now() }), []);
  return (
    <NotifyCtx.Provider value={notify}>
      {children}
      <Snackbar
        key={snack?.key}
        open={!!snack}
        autoHideDuration={3500}
        onClose={(_, reason) => { if (reason !== 'clickaway') setSnack(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : <span />}
      </Snackbar>
    </NotifyCtx.Provider>
  );
}

export function useNotify(): Notify {
  const v = useContext(NotifyCtx);
  if (!v) throw new Error('useNotify 必須在 NotifyProvider 內使用');
  return v;
}
