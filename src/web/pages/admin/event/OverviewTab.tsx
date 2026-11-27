// 第 5 階段（P5）：即時概況
import { Paper, Typography } from '@mui/material';
import type { EventTabProps } from '../EventDetailPage';

export default function OverviewTab(_props: EventTabProps) {
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">此功能開發中</Typography>
    </Paper>
  );
}
