// 這台裝置最近的紀錄與撤銷（F-CHK-8）
import { Box, Button, Divider, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { fmtTime } from '../../format';
import { ConfirmDialog } from '../ConfirmDialog';
import type { ScanRecord, ScanStatus } from './scanRecord';

const DOT: Record<ScanStatus, string> = { ok: 'success.main', dup: 'warning.main', error: 'error.main' };

const who = (r: ScanRecord) => (r.employee ? r.employee.name : r.code);

function summary(r: ScanRecord): string {
  const label = r.voided ? '已撤銷' : r.status === 'ok' ? '通過' : r.status === 'dup' ? '重複' : r.title;
  return [fmtTime(r.at), label, r.manual && '手動', r.rehearsal && '演練'].filter(Boolean).join('｜');
}

export function RecentList({ records, stationName, onVoid }: {
  records: ScanRecord[];
  stationName: string;
  onVoid: (r: ScanRecord) => void;
}) {
  const [pending, setPending] = useState<ScanRecord | null>(null);

  return (
    <>
      <Typography sx={{ fontWeight: 700, mt: 3, mb: 1 }}>這台裝置最近的紀錄</Typography>
      {records.length === 0 ? (
        <Typography variant="body2" color="text.secondary">還沒有掃描紀錄。掃到的結果會列在這裡，掃錯人可以撤銷。</Typography>
      ) : (
        <Paper variant="outlined">
          {records.map((r, i) => (
            <Box key={r.id}>
              {i > 0 && <Divider />}
              <Stack direction="row" spacing={1.5} sx={{ px: 2, py: 1.25, alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: DOT[r.status], flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ textDecoration: r.voided ? 'line-through' : 'none' }}>
                    {r.employee ? `${r.employee.name}（${r.employee.empNo}）` : r.code}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>{summary(r)}</Typography>
                </Box>
                {r.scanId && !r.voided && (
                  <Button size="small" color="inherit" onClick={() => setPending(r)}>撤銷</Button>
                )}
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
      <ConfirmDialog
        open={!!pending}
        title="撤銷這筆紀錄？"
        danger
        confirmText="撤銷"
        body={pending ? `撤銷 ${who(pending)} 的${stationName}紀錄後，可以重新掃描。撤銷會留下紀錄。` : ''}
        onClose={() => setPending(null)}
        onConfirm={() => { if (pending) onVoid(pending); }}
      />
    </>
  );
}
