// 報到人員帳號（F-ACC-2）與列印這一批（F-ACC-3）。PIN 只在產生或重設當下顯示一次。
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import PrintIcon from '@mui/icons-material/Print';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, GlobalStyles, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventPhase, type EventDetail } from '../../../../shared/event';
import { STAFF_BATCH_MAX, type StaffAccount, type StaffAction, type StaffSecret } from '../../../../shared/events-admin';
import { api, ApiError } from '../../../api';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Loading } from '../../../components/Loading';
import { useNotify } from '../../../components/notify';
import { fmtDT, fmtTime } from '../../../format';
import type { EventTabProps } from '../EventDetailPage';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '操作失敗，請稍後再試');

export default function StaffTab({ event }: EventTabProps) {
  const notify = useNotify();
  const [list, setList] = useState<StaffAccount[] | null>(null);
  const [count, setCount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<StaffSecret[] | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffAccount | null>(null);
  const ended = eventPhase(event, Date.now()) === 'ended';
  const base = `/events/${encodeURIComponent(event.id)}/staff`;

  const load = useCallback(() => {
    api.get<StaffAccount[]>(base).then(setList).catch(e => notify(errMsg(e), 'error'));
  }, [base, notify]);
  useEffect(load, [load]);

  const n = Number(count);
  const countValid = Number.isInteger(n) && n >= 1 && n <= STAFF_BATCH_MAX;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const generate = () => run(async () => {
    const r = await api.post<StaffSecret[]>(base, { count: n });
    setBatch(r);
    notify(`已產生 ${r.length} 組報到帳號`, 'success');
    load();
  });

  const resetPin = (s: StaffAccount) => run(async () => {
    const r = await api.post<StaffSecret>(`/staff/${encodeURIComponent(s.id)}/reset-pin`);
    setBatch([r]);
    notify(`${r.account} 的 PIN 碼已重設`, 'success');
    load();
  });

  const patch = (s: StaffAccount, action: StaffAction) => run(async () => {
    const r = await api.patch<StaffAccount>(`/staff/${encodeURIComponent(s.id)}`, { action });
    setList(l => l?.map(x => (x.id === r.id ? r : x)) ?? null);
  });

  const now = Date.now();
  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        報到人員帳號只能登入這場活動，{fmtDT(event.endAt)} 活動結束後會自動失效。連續輸錯 PIN 碼 5 次會鎖定 15 分鐘。
        PIN 碼只在產生或重設時顯示一次，請當場列印或抄下。
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField size="small" type="number" label="產生數量" value={count} onChange={e => setCount(e.target.value)} disabled={ended}
          error={!ended && !countValid} sx={{ width: 120 }} slotProps={{ htmlInput: { min: 1, max: STAFF_BATCH_MAX } }} />
        <Button variant="contained" startIcon={<GroupAddIcon />} onClick={generate} disabled={ended || !countValid || busy}>產生帳號</Button>
        {ended && <Box sx={{ color: 'text.secondary', typography: 'body2' }}>活動已結束，不能再產生帳號。</Box>}
      </Stack>

      {!list ? <Loading /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>帳號</TableCell><TableCell>狀態</TableCell><TableCell align="right">操作</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {list.map(s => {
                const locked = s.lockUntil > now;
                return (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{s.account}</TableCell>
                    <TableCell>
                      {ended ? <Chip size="small" label="已失效" />
                        : s.disabled ? <Chip size="small" variant="outlined" label="已停用" />
                        : locked ? <Chip size="small" color="warning" label={`鎖定至 ${fmtTime(s.lockUntil)}`} />
                        : <Chip size="small" color="success" label="可使用" />}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {!ended && (
                        <>
                          {locked && <Button size="small" disabled={busy} onClick={() => patch(s, 'unlock')}>解鎖</Button>}
                          <Button size="small" disabled={busy} onClick={() => setResetTarget(s)}>重設 PIN</Button>
                          <Button size="small" disabled={busy} color={s.disabled ? 'primary' : 'error'} onClick={() => patch(s, s.disabled ? 'enable' : 'disable')}>
                            {s.disabled ? '啟用' : '停用'}
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {list.length === 0 && (
                <TableRow><TableCell colSpan={3}>還沒有報到人員帳號。輸入數量後按「產生帳號」。</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ConfirmDialog open={!!resetTarget} title={`重設 ${resetTarget?.account ?? ''} 的 PIN 碼？`} confirmText="重設 PIN"
        body="舊的 PIN 碼會失效，正在使用這個帳號的裝置會被登出，需要用新的 PIN 碼重新登入。"
        onClose={() => setResetTarget(null)} onConfirm={() => { if (resetTarget) void resetPin(resetTarget); }} />
      {batch && <BatchDialog batch={batch} event={event} list={list ?? []} onClose={() => setBatch(null)} />}
    </>
  );
}

/** 列印時只留下小卡：其他 body 子元素（React 根節點與對話框）一律隱藏 */
const PRINT_STYLES = {
  '.ck-print-slips': { display: 'none' },
  '@media print': {
    'body > *:not(.ck-print-slips)': { display: 'none !important' },
    '.ck-print-slips': { display: 'block !important' },
  },
};

/** 產生或重設後的這一批帳號；只列印未停用的帳號 */
function BatchDialog({ batch, event, list, onClose }: { batch: StaffSecret[]; event: EventDetail; list: StaffAccount[]; onClose: () => void }) {
  const disabled = new Set(list.filter(s => s.disabled).map(s => s.id));
  const printable = batch.filter(s => !disabled.has(s.id));
  return (
    <>
      <Dialog open onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>{batch.length > 1 ? `這一批 ${batch.length} 組報到帳號` : `${batch[0].account} 的新 PIN 碼`}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>PIN 碼只會顯示這一次，關閉後無法再查看。忘記時請重設 PIN。</Alert>
          {printable.length < batch.length && (
            <Alert severity="info" sx={{ mb: 2 }}>已停用的帳號不會列印，啟用後才能登入。</Alert>
          )}
          <Slips items={batch} event={event} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>關閉</Button>
          <Button variant="contained" startIcon={<PrintIcon />} disabled={!printable.length} onClick={() => window.print()}>列印這一批</Button>
        </DialogActions>
      </Dialog>
      <GlobalStyles styles={PRINT_STYLES} />
      {createPortal(
        <div className="ck-print-slips" aria-hidden>
          <Slips items={printable} event={event} print />
        </div>,
        document.body,
      )}
    </>
  );
}

/** 每組一張小卡：活動名稱、帳號、PIN 碼、有效期限（F-ACC-3） */
function Slips({ items, event, print }: { items: StaffSecret[]; event: EventDetail; print?: boolean }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', ...(print && { color: '#000', bgcolor: '#fff' }) }}>
      {items.map(s => (
        <Box key={s.id} sx={{ border: '1px dashed #8a94a3', borderRadius: '8px', p: 1.5, breakInside: 'avoid' }}>
          <Box sx={{ fontSize: 12, opacity: 0.75 }}>{event.name}</Box>
          <Box sx={{ fontSize: 13, mt: 0.75 }}>帳號</Box>
          <Box sx={{ fontSize: 22, fontWeight: 700 }}>{s.account}</Box>
          <Box sx={{ fontSize: 13, mt: 0.5 }}>PIN 碼</Box>
          <Box sx={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{s.pin}</Box>
          <Box sx={{ fontSize: 12, mt: 0.75, opacity: 0.75 }}>有效至 {fmtDT(event.endAt)}</Box>
        </Box>
      ))}
    </Box>
  );
}
