// 第 4 階段（P4）：選擇關卡（F-CHK-1）
import HowToRegIcon from '@mui/icons-material/HowToReg';
import LogoutIcon from '@mui/icons-material/Logout';
import RedeemIcon from '@mui/icons-material/Redeem';
import { Alert, Box, Button, CardActionArea, Container, Paper, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { loadCheckinContext, useLoad } from '../../components/checkin/data';
import { primeAudio } from '../../components/checkin/feedback';
import { PhaseAlert } from '../../components/checkin/PhaseAlert';
import { Loading } from '../../components/Loading';

export default function StationsPage() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { state, retry } = useLoad(loadCheckinContext);
  if (me?.type !== 'staff') return null;

  const pick = (stationId: string) => {
    primeAudio();
    navigate(`/checkin?station=${encodeURIComponent(stationId)}`);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="body2" color="text.secondary">{me.event.name}｜{me.account}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5, mb: 3 }}>選擇你負責的關卡</Typography>
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>重試</Button>}>
          {state.message}
        </Alert>
      )}
      {state.status === 'ready' && (
        <>
          <PhaseAlert phase={state.data.phase} startAt={state.data.event.startAt} />
          <Stack spacing={1.5}>
            {state.data.stations.map(s => (
              <Paper key={s.id} variant="outlined" sx={{ overflow: 'hidden' }}>
                <CardActionArea onClick={() => pick(s.id)} sx={{ p: 2.5 }}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    {s.kind === 'checkin'
                      ? <HowToRegIcon color="primary" sx={{ fontSize: 36 }} />
                      : <RedeemIcon color="primary" sx={{ fontSize: 36 }} />}
                    <Box>
                      <Typography variant="h6">{s.name}</Typography>
                      {s.kind === 'gift' && s.requireCheckin && (
                        <Typography variant="body2" color="text.secondary">需先完成入場報到才能通過</Typography>
                      )}
                    </Box>
                  </Stack>
                </CardActionArea>
              </Paper>
            ))}
          </Stack>
        </>
      )}
      <Button sx={{ mt: 3 }} color="inherit" startIcon={<LogoutIcon />} onClick={() => logout()}>登出</Button>
    </Container>
  );
}
