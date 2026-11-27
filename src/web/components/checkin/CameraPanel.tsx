// 相機模式（F-CHK-3）：後鏡頭連續掃描，離開時一定要關閉相機
import { Alert, Box, Paper, Typography } from '@mui/material';
import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useId, useRef, useState } from 'react';

const REPEAT_MS = 3000;

// 相機工作階段一次只跑一個：新的 mount 等上一個 stop、clear 完才 start。
// 這樣 StrictMode 的連續 mount／unmount、或 start 還沒完成就離開，都不會留下開著的相機
let lastSession: Promise<void> = Promise.resolve();

export function CameraPanel({ onCode }: { onCode: (code: string) => void }) {
  const elementId = `qr-${useId().replace(/:/g, '')}`;
  const [error, setError] = useState('');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let cancelled = false;
    let last = { text: '', at: 0 };
    const q = new Html5Qrcode(elementId, false);
    const started = lastSession.then(async () => {
      if (cancelled) return false;
      await q.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (w, h) => {
            const s = Math.max(150, Math.floor(Math.min(w, h) * 0.7));
            return { width: s, height: s };
          },
        },
        text => {
          const now = Date.now();
          if (cancelled || (text === last.text && now - last.at < REPEAT_MS)) return;
          last = { text, at: now };
          onCodeRef.current(text);
        },
        () => {},
      );
      return true;
    });
    started.catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      lastSession = started
        .then(running => (running ? q.stop() : undefined))
        .catch(() => {})
        .then(() => {
          try {
            q.clear();
          } catch {
            // stop 中途失敗時套件仍認為在掃描，clear 會丟例外
          }
        });
    };
  }, [elementId]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box id={elementId} sx={{ width: '100%', overflow: 'hidden', borderRadius: 1 }} />
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>無法開啟相機</Typography>
          <Typography variant="body2">請在瀏覽器允許這個網站使用相機，再重新切換到相機模式。也可以先改用手動模式。</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>{error}</Typography>
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>把識別證或電子 QR code 對準框內</Typography>
      )}
    </Paper>
  );
}
