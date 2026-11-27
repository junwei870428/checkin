// 活動詳情外框：標題、狀態、時間、結束提醒，以及四個分頁的插槽
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Alert, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { eventPhase, type EventDetail } from '../../../shared/event';
import { api, ApiError } from '../../api';
import { EventStatusChip } from '../../components/EventStatusChip';
import { Loading } from '../../components/Loading';
import { fmtDate, fmtDT } from '../../format';
import OverviewTab from './event/OverviewTab';
import RosterTab from './event/RosterTab';
import SettingsTab from './event/SettingsTab';
import StaffTab from './event/StaffTab';

export interface EventTabProps {
  event: EventDetail;
  /** 重新讀取活動詳情，例如儲存設定或立即結束之後 */
  reload: () => void;
}

const TABS = [
  { value: 'overview', label: '即時概況', Panel: OverviewTab },
  { value: 'roster', label: '名單與報表', Panel: RosterTab },
  { value: 'staff', label: '報到人員帳號', Panel: StaffTab },
  { value: 'settings', label: '活動設定', Panel: SettingsTab },
];

export default function EventDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api.get<EventDetail>(`/events/${encodeURIComponent(id)}`)
      .then(e => { setEvent(e); setError(''); })
      .catch(e => setError(e instanceof ApiError ? e.message : '無法載入活動，請稍後再試'));
  }, [id]);

  useEffect(() => {
    setEvent(null);
    setError('');
    reload();
  }, [reload]);

  const back = (
    <Button component={Link} to="/admin/events" color="inherit" startIcon={<ArrowBackIcon />} sx={{ mb: 1 }}>所有活動</Button>
  );
  if (!event) return error ? <>{back}<Alert severity="error">{error}</Alert></> : <Loading />;

  const tab = TABS.find(t => t.value === params.get('tab')) ?? TABS[0];
  return (
    <>
      {back}
      <Stack direction="row" spacing={1.5} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{event.name}</Typography>
        <EventStatusChip event={event} />
      </Stack>
      <Typography variant="body2" color="text.secondary">{fmtDT(event.startAt)} 到 {fmtDT(event.endAt)}</Typography>
      {eventPhase(event, Date.now()) === 'ended' && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          活動已結束，報到人員帳號已失效。資料將於 {fmtDate(event.deleteAt)} 自動刪除，需要的話請先匯出報表。
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Tabs
        value={tab.value}
        onChange={(_, v: string) => setParams({ tab: v }, { replace: true })}
        variant="scrollable"
        sx={{ mt: 2, mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map(t => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      <tab.Panel event={event} reload={reload} />
    </>
  );
}
