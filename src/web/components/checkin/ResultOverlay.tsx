// 全螢幕結果畫面（F-CHK-5）。只是一般的 Box，不搶焦點，掃描槍可以在底下繼續輸入
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import ErrorIcon from '@mui/icons-material/Error';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useEffect } from 'react';
import type { ScanRecord, ScanStatus } from './scanRecord';

// 規劃書第 10 節，不隨深淺色模式改變
const LOOK: Record<ScanStatus, { bg: string; fg: string; Icon: typeof CheckCircleIcon; ms: number }> = {
  ok: { bg: '#1B7F3B', fg: '#FFFFFF', Icon: CheckCircleIcon, ms: 1600 },
  dup: { bg: '#F2A900', fg: '#1F1600', Icon: ErrorIcon, ms: 2600 },
  error: { bg: '#C62828', fg: '#FFFFFF', Icon: CancelIcon, ms: 2600 },
  // 離線待上傳用藍色，避免和重複的黃色混淆
  queued: { bg: '#1565C0', fg: '#FFFFFF', Icon: CloudOffIcon, ms: 1600 },
};

const chipSx = { bgcolor: 'rgba(255,255,255,.25)', color: 'inherit', fontWeight: 700 };

/** onClose 要是穩定的函式；換一筆結果時請用新的 key 重新掛載，計時會重算 */
export function ResultOverlay({ record, onClose }: { record: ScanRecord; onClose: () => void }) {
  const { bg, fg, Icon, ms } = LOOK[record.status];
  const e = record.employee;

  useEffect(() => {
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [onClose, ms]);

  return (
    <Box
      role="alert"
      onClick={onClose}
      onMouseDown={ev => ev.preventDefault()}
      sx={{
        position: 'fixed', inset: 0, zIndex: t => t.zIndex.tooltip, bgcolor: bg, color: fg, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        px: 3, pt: 'calc(24px + env(safe-area-inset-top, 0px))', pb: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        userSelect: 'none',
      }}
    >
      <Icon sx={{ fontSize: { xs: 96, sm: 128 } }} />
      <Typography sx={{ fontSize: { xs: 28, sm: 40 }, fontWeight: 700, mt: 1 }}>{record.title}</Typography>
      {e && <Typography sx={{ fontSize: { xs: 46, sm: 68 }, fontWeight: 700, mt: 2, lineHeight: 1.15 }}>{e.name}</Typography>}
      {e && <Typography sx={{ fontSize: { xs: 18, sm: 24 }, mt: 1, opacity: 0.9 }}>{e.dept}｜{e.plant}｜{e.empNo}</Typography>}
      {record.detail && <Typography sx={{ fontSize: 20, mt: 2, overflowWrap: 'anywhere' }}>{record.detail}</Typography>}
      {(record.rehearsal || record.manual) && (
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {record.rehearsal && <Chip label="演練" sx={chipSx} />}
          {record.manual && <Chip label="手動處理" sx={chipSx} />}
        </Stack>
      )}
      <Typography sx={{ fontSize: 14, mt: 4, opacity: 0.8 }}>點一下畫面繼續</Typography>
    </Box>
  );
}
