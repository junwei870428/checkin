// 活動設定：基本資料、參加範圍、關卡、演練模式與進階操作（F-EVT-3 到 F-EVT-9）
import SaveIcon from '@mui/icons-material/Save';
import { Alert, Box, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { eventPhase, type EventDetail, type Scope } from '../../../../shared/event';
import { NAME_MAX, type UpdateEventBody } from '../../../../shared/events-admin';
import { api, ApiError } from '../../../api';
import { useNotify } from '../../../components/notify';
import { fromLocalInput, toLocalInput } from '../../../format';
import type { EventTabProps } from '../EventDetailPage';
import { AdvancedActions } from './settings/AdvancedActions';
import { ScopeEditor } from './settings/ScopeEditor';
import { StationsEditor, toDraftStation, type DraftStation } from './settings/StationsEditor';

interface Draft {
  name: string;
  start: string;
  end: string;
  scope: Scope;
  stations: DraftStation[];
}

const toDraft = (e: EventDetail): Draft => ({
  name: e.name,
  start: toLocalInput(e.startAt),
  end: toLocalInput(e.endAt),
  scope: e.scope,
  stations: e.stations.map(toDraftStation),
});

export default function SettingsTab({ event, reload }: EventTabProps) {
  const notify = useNotify();
  const [draft, setDraft] = useState(() => toDraft(event));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 儲存或立即結束後，等重新讀到活動再把草稿換成新的設定；切換演練或匯入名單不會蓋掉還沒儲存的修改
  const resetOnReload = useRef(false);

  useEffect(() => {
    if (!resetOnReload.current) return;
    resetOnReload.current = false;
    setDraft(toDraft(event));
  }, [event]);

  const reloadAndReset = () => {
    resetOnReload.current = true;
    reload();
  };

  const phase = eventPhase(event, Date.now());
  const ended = phase === 'ended';
  const startAt = ended ? event.startAt : fromLocalInput(draft.start);
  const endAt = ended ? event.endAt : fromLocalInput(draft.end);
  const scopeEmpty = (draft.scope.type === 'plants' && !draft.scope.plants.length) || (draft.scope.type === 'depts' && !draft.scope.depts.length);
  const valid = !!draft.name.trim() && endAt > startAt && !scopeEmpty && draft.stations.every(s => s.name.trim());

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body: UpdateEventBody = {
        name: draft.name.trim(),
        startAt,
        endAt,
        scope: draft.scope,
        stations: draft.stations.map(s => ({ id: s.id, name: s.name.trim(), requireCheckin: s.requireCheckin })),
      };
      await api.put(`/events/${encodeURIComponent(event.id)}`, body);
      notify('已儲存活動設定', 'success');
      reloadAndReset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '儲存失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography sx={{ fontWeight: 700, mb: 2 }}>基本資料</Typography>
        <Stack spacing={2}>
          <TextField label="活動名稱" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
            error={!draft.name.trim()} slotProps={{ htmlInput: { maxLength: NAME_MAX } }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="開始時間" type="datetime-local" fullWidth disabled={ended} value={draft.start}
              onChange={e => setDraft({ ...draft, start: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="結束時間" type="datetime-local" fullWidth disabled={ended} value={draft.end}
              onChange={e => setDraft({ ...draft, end: e.target.value })} error={!ended && endAt <= startAt}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          {ended && <Typography variant="body2" color="text.secondary">活動已結束，開始與結束時間不能再修改。</Typography>}
          <Typography variant="body2" color="text.secondary">帳號代碼：{event.code}（建立後不能修改）</Typography>
        </Stack>
      </Paper>

      <ScopeEditor event={event} scope={draft.scope} onChange={scope => setDraft({ ...draft, scope })} onMembersChanged={reload} />
      <StationsEditor stations={draft.stations} onChange={stations => setDraft({ ...draft, stations })} />

      <Stack spacing={1.5}>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1.5}>
          <Button variant="contained" size="large" startIcon={<SaveIcon />} disabled={!valid || busy} onClick={save}>儲存設定</Button>
          <Button size="large" disabled={busy} onClick={() => { setDraft(toDraft(event)); setError(''); }}>還原</Button>
        </Stack>
      </Stack>

      <RehearsalCard event={event} reload={reload} />
      <AdvancedActions event={event} onClosed={reloadAndReset} reload={reload} />
    </Stack>
  );
}

/** 演練模式（F-EVT-7）：只在活動開始前可以切換 */
function RehearsalCard({ event, reload }: EventTabProps) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const phase = eventPhase(event, Date.now());
  const editable = phase === 'not_started' || phase === 'rehearsal';

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await api.post(`/events/${encodeURIComponent(event.id)}/rehearsal`, { on });
      notify(on ? '已開啟演練模式' : '已關閉演練模式', 'success');
      reload();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '操作失敗，請稍後再試', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>演練模式</Typography>
          <Typography variant="body2" color="text.secondary">
            {editable
              ? '開啟後，報到人員可以在開始時間前用正式設備與名單試掃。演練紀錄與正式紀錄分開，不計入報表與匯出；開始時間一到自動失效。'
              : '活動已開始，演練模式已失效，之後的掃描都是正式紀錄。'}
          </Typography>
        </Box>
        <FormControlLabel
          control={<Switch checked={editable && event.rehearsal} disabled={!editable || busy} onChange={e => void toggle(e.target.checked)} />}
          label={editable && event.rehearsal ? '演練中' : '關閉'}
        />
      </Stack>
    </Paper>
  );
}
