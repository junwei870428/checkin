// 活動列表與建立活動（F-EVT-1、F-EVT-2、F-RET-3）
import AddIcon from '@mui/icons-material/Add';
import {
  Alert, Box, Button, CardActionArea, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { eventPhase } from '../../../shared/event';
import { CODE_RE, NAME_MAX, type CreateEventBody, type EventListItem } from '../../../shared/events-admin';
import { api, ApiError } from '../../api';
import { EventStatusChip } from '../../components/EventStatusChip';
import { Loading } from '../../components/Loading';
import { useNotify } from '../../components/notify';
import { fmtDate, fmtDT, fromLocalInput, toLocalInput } from '../../format';

export default function EventsPage() {
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get<EventListItem[]>('/events')
      .then(setEvents)
      .catch(e => setError(e instanceof ApiError ? e.message : '無法載入活動，請稍後再試'));
  }, []);

  return (
    <>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>活動</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>建立活動</Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!events && !error && <Loading />}
      {events?.length === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography>還沒有活動。建立第一場活動後，再設定參加範圍、關卡和報到人員帳號。</Typography>
        </Paper>
      )}
      <Stack spacing={1.5}>
        {events?.map(e => <EventCard key={e.id} event={e} />)}
      </Stack>
      <CreateEventDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function EventCard({ event: e }: { event: EventListItem }) {
  return (
    <Paper variant="outlined">
      <CardActionArea component={Link} to={`/admin/events/${encodeURIComponent(e.id)}`} sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{e.name}</Typography>
              <EventStatusChip event={e} />
            </Stack>
            <Typography variant="body2" color="text.secondary">{fmtDT(e.startAt)} 到 {fmtDT(e.endAt)}｜帳號代碼 {e.code}</Typography>
            {eventPhase(e, Date.now()) === 'ended' && (
              <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>資料將於 {fmtDate(e.deleteAt)} 自動刪除</Typography>
            )}
          </Box>
          <Stack direction="row" spacing={3}>
            {e.stations.map(s => (
              <Box key={s.id} sx={{ textAlign: { sm: 'right' } }}>
                <Typography variant="body2" color="text.secondary">{s.name}</Typography>
                <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.passedCount} / {e.total}</Typography>
              </Box>
            ))}
          </Stack>
        </Stack>
      </CardActionArea>
    </Paper>
  );
}

function initialForm() {
  const s = new Date();
  s.setMinutes(0, 0, 0);
  s.setHours(s.getHours() + 1);
  return { name: '', code: '', start: toLocalInput(s.getTime()), end: toLocalInput(s.getTime() + 4 * 3600_000) };
}

function CreateEventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const [f, setF] = useState(initialForm);
  const [codeError, setCodeError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(initialForm());
    setCodeError('');
    setError('');
  }, [open]);

  const startAt = fromLocalInput(f.start);
  const endAt = fromLocalInput(f.end);
  const valid = !!f.name.trim() && CODE_RE.test(f.code) && endAt > startAt;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setCodeError('');
    try {
      const body: CreateEventBody = { name: f.name.trim(), code: f.code, startAt, endAt };
      const r = await api.post<{ id: string }>('/events', body);
      notify('已建立活動', 'success');
      navigate(`/admin/events/${encodeURIComponent(r.id)}?tab=settings`);
    } catch (x) {
      if (x instanceof ApiError && x.code === 'code_taken') setCodeError(x.message);
      else setError(x instanceof ApiError ? x.message : '建立失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>建立活動</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="活動名稱" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="例如 2027 春酒"
              slotProps={{ htmlInput: { maxLength: NAME_MAX } }} />
            <TextField
              label="帳號代碼"
              value={f.code}
              onChange={e => { setCodeError(''); setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) }); }}
              error={!!codeError}
              helperText={codeError || '2 到 8 碼英數字，建立後不能修改。報到人員帳號會以它開頭，例如 SPRING-01'}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="開始時間" type="datetime-local" fullWidth value={f.start} onChange={e => setF({ ...f, start: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="結束時間" type="datetime-local" fullWidth value={f.end} onChange={e => setF({ ...f, end: e.target.value })}
                error={!!f.end && !!f.start && endAt <= startAt}
                helperText="時間一到，報到會關閉，報到人員帳號也會失效"
                slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <Alert severity="info">建立後預設有「入場報到」和「領取禮品」兩個關卡，參加範圍為全公司，可以在活動設定裡修改。</Alert>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={!valid || busy}>建立活動</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
