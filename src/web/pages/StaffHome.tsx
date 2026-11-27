// 第 1 階段的報到端外框，選擇關卡與掃描在第 4 階段實作
import LogoutIcon from '@mui/icons-material/Logout';
import { Button, Container, Paper, Typography } from '@mui/material';
import { useAuth } from '../auth';

export default function StaffHome() {
  const { me, logout } = useAuth();
  if (me?.type !== 'staff') return null;
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="body2" color="text.secondary">{me.event.name}｜{me.account}</Typography>
      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <Typography>已登入報到端。選擇關卡與掃描功能會在第 4 階段完成。</Typography>
      </Paper>
      <Button sx={{ mt: 3 }} color="inherit" startIcon={<LogoutIcon />} onClick={() => logout()}>登出</Button>
    </Container>
  );
}
