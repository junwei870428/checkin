import { Chip, type ChipProps } from '@mui/material';
import { eventPhase, type EventPhase } from '../../shared/event';

const CHIPS: Record<EventPhase, Pick<ChipProps, 'label' | 'color' | 'variant'>> = {
  not_started: { label: '尚未開始', color: 'info', variant: 'outlined' },
  rehearsal: { label: '演練中', color: 'warning', variant: 'outlined' },
  live: { label: '進行中', color: 'success', variant: 'filled' },
  ended: { label: '已結束', color: 'default', variant: 'filled' },
};

/** 依目前時間顯示活動狀態 */
export function EventStatusChip({ event }: { event: { startAt: number; endAt: number; rehearsal: boolean } }) {
  return <Chip size="small" {...CHIPS[eventPhase(event, Date.now())]} />;
}
