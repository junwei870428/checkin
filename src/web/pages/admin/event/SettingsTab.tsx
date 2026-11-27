// 第 3 階段（P3）：活動設定
import { Paper, Typography } from '@mui/material';
import type { EventTabProps } from '../EventDetailPage';

export default function SettingsTab(_props: EventTabProps) {
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">此功能開發中</Typography>
    </Paper>
  );
}
