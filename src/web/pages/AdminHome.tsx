// 第 1 階段的後台外框，活動、員工資料、系統帳號在第 2、3 階段實作
import LogoutIcon from '@mui/icons-material/Logout';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { AppBar, Box, Chip, Container, IconButton, Paper, Toolbar, Tooltip, Typography } from '@mui/material';
import { useAuth } from '../auth';

export default function AdminHome() {
  const { me, logout } = useAuth();
  if (me?.type !== 'user') return null;
  return (
    <Box>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1.5 }}>
          <QrCodeScannerIcon />
          <Typography variant="h6" noWrap sx={{ flex: 1, fontWeight: 700 }}>活動報到系統</Typography>
          <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>{me.name}</Typography>
          <Chip size="small" label={me.role === 'admin' ? '系統管理員' : '活動承辦人'} sx={{ bgcolor: 'rgba(255,255,255,.18)', color: 'inherit' }} />
          <Tooltip title="登出">
            <IconButton color="inherit" onClick={() => logout()}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography>已登入管理後台。活動、員工資料與系統帳號功能會在後續階段完成。</Typography>
        </Paper>
      </Container>
    </Box>
  );
}
