// 後台外框：系統管理員有「活動／員工資料／系統帳號」分頁，承辦人只看活動
import LogoutIcon from '@mui/icons-material/Logout';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { AppBar, Box, Chip, Container, IconButton, Tab, Tabs, Toolbar, Tooltip, Typography } from '@mui/material';
import { Suspense } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { Loading } from '../../components/Loading';

const TABS = [
  { to: '/admin/events', label: '活動' },
  { to: '/admin/employees', label: '員工資料' },
  { to: '/admin/accounts', label: '系統帳號' },
];

export default function AdminLayout() {
  const { me, logout } = useAuth();
  const { pathname } = useLocation();
  if (me?.type !== 'user') return null;
  const isAdmin = me.role === 'admin';
  const tab = TABS.find(t => pathname.startsWith(t.to))?.to ?? false;
  return (
    <Box>
      <AppBar position="sticky" sx={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <Toolbar sx={{ gap: 1.5 }}>
          <QrCodeScannerIcon />
          <Typography variant="h6" noWrap sx={{ flex: 1, fontWeight: 700 }}>活動報到系統</Typography>
          <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>{me.name}</Typography>
          <Chip size="small" label={isAdmin ? '系統管理員' : '活動承辦人'} sx={{ bgcolor: 'rgba(255,255,255,.18)', color: 'inherit' }} />
          <Tooltip title="登出">
            <IconButton color="inherit" onClick={() => logout()}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
        {isAdmin && (
          <Tabs
            value={tab}
            textColor="inherit"
            variant="scrollable"
            sx={{ px: 1 }}
            slotProps={{ indicator: { sx: { bgcolor: 'currentColor', height: 3 } } }}
          >
            {TABS.map(t => <Tab key={t.to} value={t.to} label={t.label} component={Link} to={t.to} />)}
          </Tabs>
        )}
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </Container>
    </Box>
  );
}
