// 掃描槍模式（F-CHK-2）：掃描槍等同鍵盤，打完內容後送出 Enter
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { Alert, Button, Paper, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** 使用者正在別的輸入欄位或對話框裡操作時，不要把焦點搶回來 */
function busyElsewhere(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  if (el.closest('[role="dialog"],[role="presentation"]')) return true;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

export function ScannerPanel({ onCode }: { onCode: (code: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    ref.current?.focus();
    const t = setInterval(() => {
      const input = ref.current;
      if (!input) return;
      if (document.activeElement !== input && !busyElsewhere(document.activeElement)) input.focus();
      setFocused(document.activeElement === input && document.hasFocus());
    }, 500);
    return () => clearInterval(t);
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const input = ref.current;
    if (e.key !== 'Enter' || !input) return;
    e.preventDefault();
    const code = input.value;
    input.value = '';
    onCode(code);
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
      <QrCodeScannerIcon sx={{ fontSize: 56, color: 'primary.main' }} />
      <Typography variant="h6">請用掃描槍掃描識別證</Typography>
      <Typography variant="body2" color="text.secondary">游標要停在下方欄位，掃描後會自動送出</Typography>
      <TextField
        inputRef={ref}
        fullWidth
        sx={{ mt: 2 }}
        placeholder="等待掃描…"
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        slotProps={{
          htmlInput: {
            autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false,
            style: { fontSize: 26, textAlign: 'center', letterSpacing: 2 },
          },
        }}
      />
      {!focused && (
        <Alert
          severity="warning"
          sx={{ mt: 2, textAlign: 'left' }}
          action={<Button color="inherit" size="small" onClick={() => ref.current?.focus()}>恢復</Button>}
        >
          欄位目前不在輸入狀態，這時掃描不會有反應
        </Alert>
      )}
    </Paper>
  );
}
