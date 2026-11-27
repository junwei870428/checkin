// 進階操作：立即結束活動（F-EVT-5）、清除演練紀錄（F-EVT-8）、刪除活動（F-EVT-9），都要二次確認
import { Button, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { eventPhase, type EventDetail } from '../../../../../shared/event';
import { api, ApiError } from '../../../../api';
import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { useNotify } from '../../../../components/notify';

type Action = 'close' | 'clear' | 'delete';

export function AdvancedActions({ event, onClosed, reload }: {
  event: EventDetail;
  /** 立即結束後，設定畫面要改用新的結束時間 */
  onClosed: () => void;
  reload: () => void;
}) {
  const notify = useNotify();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/events/${encodeURIComponent(event.id)}`;
  const ended = eventPhase(event, Date.now()) === 'ended';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '操作失敗，請稍後再試', 'error');
    } finally {
      setBusy(false);
    }
  };

  const actions: Record<Action, () => Promise<void>> = {
    close: async () => {
      await api.post(`${path}/close`);
      notify('活動已結束', 'success');
      onClosed();
    },
    clear: async () => {
      const r = await api.post<{ deleted: number }>(`${path}/clear-rehearsal`);
      notify(`已清除 ${r.deleted} 筆演練紀錄，演練模式已關閉`, 'success');
      reload();
    },
    delete: async () => {
      await api.del(path);
      notify('已刪除活動', 'success');
      navigate('/admin/events', { replace: true });
    },
  };

  const row = (action: Action, label: string, hint: string) => (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
      <Button variant="outlined" color="error" disabled={busy} onClick={() => setConfirm(action)} sx={{ flexShrink: 0 }}>{label}</Button>
      <Typography variant="body2" color="text.secondary">{hint}</Typography>
    </Stack>
  );

  return (
    <Paper variant="outlined" sx={{ p: 3, borderColor: 'error.main' }}>
      <Typography color="error" sx={{ fontWeight: 700, mb: 2 }}>進階操作</Typography>
      <Stack spacing={2}>
        {!ended && row('close', '立即結束活動', '關閉報到，所有報到人員帳號立即失效。')}
        {row('clear', '清除演練紀錄', '刪除這場活動所有演練紀錄並關閉演練模式。名單、帳號與正式紀錄會保留。')}
        {row('delete', '刪除活動', '活動、名單、帳號與紀錄會一併刪除。')}
      </Stack>

      <ConfirmDialog open={confirm === 'close'} title="立即結束活動？" danger confirmText="結束活動"
        body="報到和領取會馬上關閉，所有報到人員都會被登出，開始與結束時間之後不能再修改。資料會保留 10 天後自動刪除。"
        onClose={() => setConfirm(null)} onConfirm={() => void run(actions.close)} />
      <ConfirmDialog open={confirm === 'clear'} title="清除演練紀錄？" danger confirmText="清除演練紀錄"
        body="這場活動的所有演練紀錄都會刪除，無法復原，演練模式也會關閉。正式紀錄只能在報到端逐筆撤銷，不受影響。"
        onClose={() => setConfirm(null)} onConfirm={() => void run(actions.clear)} />
      <ConfirmDialog open={confirm === 'delete'} title="刪除這場活動？" danger confirmText="刪除活動"
        body={`「${event.name}」的參加名單、報到人員帳號和所有紀錄都會刪除，無法復原。`}
        onClose={() => setConfirm(null)} onConfirm={() => void run(actions.delete)} />
    </Paper>
  );
}
