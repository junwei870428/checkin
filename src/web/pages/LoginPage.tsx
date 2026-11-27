import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import BadgeIcon from '@mui/icons-material/Badge';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { Alert, Box, Button, Container, Divider, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';

export default function LoginPage() {
  const { refresh, notice } = useAuth();
  const [tab, setTab] = useState(0);
  const [acc, setAcc] = useState('');
  const [pin, setPin] = useState('');
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent, path: string, body: unknown) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.post(path, body);
      await refresh();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : '登入失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Stack direction="row" spacing={1.5} sx={{ mb: 3, alignItems: 'center' }}>
        <Box sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center' }}>
          <QrCodeScannerIcon />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>活動報到系統</Typography>
          <Typography variant="body2" color="text.secondary">春酒、聖誕晚會等公司活動的報到與領取管理</Typography>
        </Box>
      </Stack>

      {notice && <Alert severity="warning" sx={{ mb: 2 }}>{notice}</Alert>}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, v: number) => { setTab(v); setErr(''); }} variant="fullWidth">
          <Tab icon={<BadgeIcon />} iconPosition="start" label="報到人員" />
          <Tab icon={<AdminPanelSettingsIcon />} iconPosition="start" label="管理後台" />
        </Tabs>
        <Divider />
        <Box sx={{ p: 3 }}>
          {tab === 0 ? (
            <form onSubmit={e => submit(e, '/auth/staff-login', { account: acc.trim(), pin })}>
              <Stack spacing={2}>
                <TextField label="報到帳號" value={acc} onChange={e => setAcc(e.target.value)} placeholder="例如 XMAS-01"
                  autoComplete="off" slotProps={{ htmlInput: { autoCapitalize: 'characters', maxLength: 32 } }} />
                <TextField label="PIN 碼" value={pin} type="password"
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
                {err && <Alert severity="error">{err}</Alert>}
                <Button type="submit" variant="contained" size="large" disabled={!acc.trim() || pin.length !== 6 || busy}>登入報到</Button>
              </Stack>
            </form>
          ) : (
            <form onSubmit={e => submit(e, '/auth/admin-login', { username: user.trim(), password: pw })}>
              <Stack spacing={2}>
                <TextField label="帳號" value={user} onChange={e => setUser(e.target.value)} autoComplete="username" />
                <TextField label="密碼" value={pw} onChange={e => setPw(e.target.value)} type="password" autoComplete="current-password" />
                {err && <Alert severity="error">{err}</Alert>}
                <Button type="submit" variant="contained" size="large" disabled={!user.trim() || !pw || busy}>登入後台</Button>
              </Stack>
            </form>
          )}
        </Box>
      </Paper>
    </Container>
  );
}
