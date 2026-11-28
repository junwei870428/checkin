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
import { HOLDER_MAX, parseHolder, STAFF_BATCH_MAX, type StaffAccount, type StaffAction, type StaffSecret } from '../../../../shared/events-admin';
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
  const [names, setNames] = useState('');
  const [renameTarget, setRenameTarget] = useState<StaffAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<StaffSecret[] | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffAccount | null>(null);
  const ended = eventPhase(event, Date.now()) === 'ended';
  const base = `/events/${encodeURIComponent(event.id)}/staff`;

  const load = useCallback(() => {
    api.get<StaffAccount[]>(base).then(setList).catch(e => notify(errMsg(e), 'error'));
  }, [base, notify]);
  useEffect(load, [load]);

  // 一行一位使用人，空行略過；每位產生一組帳號
  const holders = names.split('\n').map(s => s.trim()).filter(Boolean);
  const tooLong = holders.find(h => h.length > HOLDER_MAX);
  const namesError = holders.length > STAFF_BATCH_MAX ? `一次最多 ${STAFF_BATCH_MAX} 位`
    : tooLong ? `「${tooLong.slice(0, 8)}…」超過 ${HOLDER_MAX} 字` : '';
  const namesValid = holders.length > 0 && !namesError;

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
    const r = await api.post<StaffSecret[]>(base, { holders });
    setBatch(r);
    setNames('');
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

  const rename = (s: StaffAccount, holder: string) => run(async () => {
    const r = await api.patch<StaffAccount>(`/staff/${encodeURIComponent(s.id)}`, { holder });
    setList(l => l?.map(x => (x.id === r.id ? r : x)) ?? null);
    setRenameTarget(null);
    notify(`${r.account} 的使用人已改為 ${r.holder}`, 'success');
  });

  const now = Date.now();
  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        報到人員帳號只能登入這場活動，{fmtDT(event.endAt)} 活動結束後會自動失效。連續輸錯 PIN 碼 5 次會鎖定 15 分鐘。
        PIN 碼只在產生或重設時顯示一次，請當場列印或抄下。每組帳號都要填使用人姓名，報表會記下每筆報到是誰刷的。
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'flex-start' } }}>
        <TextField size="small" multiline minRows={3} maxRows={10} label="使用人姓名（一行一位）" value={names}
          onChange={e => setNames(e.target.value)} disabled={ended} placeholder={'王小明\n李小華'}
          error={!!namesError} helperText={namesError || `每位產生一組帳號，一次最多 ${STAFF_BATCH_MAX} 位`} sx={{ width: { sm: 280 } }} />
        <Button variant="contained" startIcon={<GroupAddIcon />} onClick={generate} disabled={ended || !namesValid || busy}>
          {holders.length ? `產生 ${holders.length} 組帳號` : '產生帳號'}
        </Button>
        {ended && <Box sx={{ color: 'text.secondary', typography: 'body2' }}>活動已結束，不能再產生帳號。</Box>}
      </Stack>

      {!list ? <Loading /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>帳號</TableCell><TableCell>使用人</TableCell><TableCell>狀態</TableCell><TableCell align="right">操作</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {list.map(s => {
                const locked = s.lockUntil > now;
                return (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{s.account}</TableCell>
                    <TableCell>{s.holder || <Chip size="small" color="warning" variant="outlined" label="未填" />}</TableCell>
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
                          <Button size="small" disabled={busy} onClick={() => setRenameTarget(s)}>更換使用人</Button>
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
                <TableRow><TableCell colSpan={4}>還沒有報到人員帳號。輸入使用人姓名後按「產生帳號」。</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ConfirmDialog open={!!resetTarget} title={`重設 ${resetTarget?.account ?? ''} 的 PIN 碼？`} confirmText="重設 PIN"
        body="舊的 PIN 碼會失效，正在使用這個帳號的裝置會被登出，需要用新的 PIN 碼重新登入。"
        onClose={() => setResetTarget(null)} onConfirm={() => { if (resetTarget) void resetPin(resetTarget); }} />
      {renameTarget && <RenameDialog target={renameTarget} busy={busy} onClose={() => setRenameTarget(null)} onSave={h => rename(renameTarget, h)} />}
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
          <Box sx={{ fontSize: 13, mt: 0.5 }}>使用人：{s.holder || '（未填）'}</Box>
          <Box sx={{ fontSize: 13, mt: 0.5 }}>PIN 碼</Box>
          <Box sx={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{s.pin}</Box>
          <Box sx={{ fontSize: 12, mt: 0.75, opacity: 0.75 }}>有效至 {fmtDT(event.endAt)}</Box>
        </Box>
      ))}
    </Box>
  );
}

/** 更換使用人：交班時改成接手的人，之後的報到紀錄記新的使用人，不會登出裝置 */
function RenameDialog({ target, busy, onClose, onSave }: { target: StaffAccount; busy: boolean; onClose: () => void; onSave: (holder: string) => void }) {
  const [value, setValue] = useState(target.holder);
  const parsed = parseHolder(value);
  const error = typeof parsed === 'string' ? '' : parsed.error;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>更換 {target.account} 的使用人</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth label="使用人姓名" value={value} onChange={e => setValue(e.target.value)} sx={{ mt: 1 }}
          error={value !== '' && !!error} helperText={(value !== '' && error) || '已經寫入的報到紀錄不會改變，之後的紀錄記新的使用人。'}
          onKeyDown={e => { if (e.key === 'Enter' && typeof parsed === 'string') onSave(parsed); }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={busy || typeof parsed !== 'string'} onClick={() => typeof parsed === 'string' && onSave(parsed)}>儲存</Button>
      </DialogActions>
    </Dialog>
  );
}
