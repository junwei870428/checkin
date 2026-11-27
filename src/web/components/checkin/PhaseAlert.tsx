import { Alert, AlertTitle } from '@mui/material';
import type { EventPhase } from '../../../shared/event';
import { fmtDT } from '../../format';

/** 活動尚未開始或演練模式的提示；其他狀態不顯示 */
export function PhaseAlert({ phase, startAt }: { phase: EventPhase; startAt: number }) {
  if (phase === 'not_started') {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        <AlertTitle>活動尚未開始</AlertTitle>
        活動於 {fmtDT(startAt)} 開始，在那之前掃描都會被拒絕。
      </Alert>
    );
  }
  if (phase === 'rehearsal') {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>演練模式</AlertTitle>
        活動 {fmtDT(startAt)} 開始前的掃描都是演練紀錄，不計入正式人數。開始後自動改為正式報到。
      </Alert>
    );
  }
  return null;
}
