// 第 4 階段（P4）：掃描槍、相機、手動報到
import KeyboardIcon from '@mui/icons-material/Keyboard';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Alert, AppBar, Box, Button, Chip, Container, IconButton, LinearProgress, Paper, Stack,
  ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { CheckinContext, CheckinStation, Device, ScanRequest, ScanResponse, VoidRequest, VoidResponse } from '../../../shared/checkin';
import type { StaffMe } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { CameraPanel } from '../../components/checkin/CameraPanel';
import { errorMessage, loadCheckinContext, useLoad } from '../../components/checkin/data';
import { feedback, primeAudio } from '../../components/checkin/feedback';
import { ManualPanel } from '../../components/checkin/ManualPanel';
import { PhaseAlert } from '../../components/checkin/PhaseAlert';
import { RecentList } from '../../components/checkin/RecentList';
import { ResultOverlay } from '../../components/checkin/ResultOverlay';
import { phaseAfterScan, recordFromError, recordFromResponse, useRecent, type ScanRecord } from '../../components/checkin/scanRecord';
import { ScannerPanel } from '../../components/checkin/ScannerPanel';
import { useWakeLock } from '../../components/checkin/wakeLock';
import { Loading } from '../../components/Loading';
import { useNotify } from '../../components/notify';

// iPadOS 的 Safari 預設回報 Macintosh，要用觸控點數分辨
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const DEVICE: Device = MOBILE ? 'mobile' : 'desktop';
const DAY_MS = 86_400_000;

type Mode = 'scanner' | 'camera' | 'manual';

export default function ScanPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const stationId = params.get('station');
  const { state, retry } = useLoad(loadCheckinContext);

  if (me?.type !== 'staff') return null;
  if (!stationId) return <Navigate to="/checkin/stations" replace />;
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>重試</Button>}>
          {state.message}
        </Alert>
      </Container>
    );
  }
  const station = state.data.stations.find(s => s.id === stationId);
  if (!station) return <Navigate to="/checkin/stations" replace />;
  return <ScanScreen key={station.id} ctx={state.data} station={station} me={me} />;
}

function ScanScreen({ ctx, station, me }: { ctx: CheckinContext; station: CheckinStation; me: StaffMe }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const { logout } = useAuth();
  const narrow = useMediaQuery('(max-width:700px)', { noSsr: true });
  const [mode, setMode] = useState<Mode>(() => (MOBILE || narrow ? 'camera' : 'scanner'));
  const [phase, setPhase] = useState(ctx.phase);
  const [count, setCount] = useState(station.passedCount);
  const [overlay, setOverlay] = useState<ScanRecord | null>(null);
  const { list, add, markVoided } = useRecent(station.id);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useWakeLock();

  useEffect(() => {
    const opts = { capture: true };
    document.addEventListener('pointerdown', primeAudio, opts);
    document.addEventListener('keydown', primeAudio, opts);
    return () => {
      document.removeEventListener('pointerdown', primeAudio, opts);
      document.removeEventListener('keydown', primeAudio, opts);
    };
  }, []);

  // 開始時間一到，演練或尚未開始的狀態與人數改為正式
  const startAt = ctx.event.startAt;
  useEffect(() => {
    const delay = startAt + 1000 - Date.now();
    if (delay <= 0 || delay > DAY_MS) return;
    const t = setTimeout(() => {
      loadCheckinContext()
        .then(c => {
          setPhase(c.phase);
          const s = c.stations.find(x => x.id === station.id);
          if (s) setCount(s.passedCount);
        })
        .catch(() => {});
    }, delay);
    return () => clearTimeout(t);
  }, [startAt, station.id]);

  const handleCode = useCallback(async (raw: string, manual = false) => {
    const code = raw.trim();
    if (!code) return;
    const attempt = { code, manual };
    let record: ScanRecord;
    try {
      const body: ScanRequest = { stationId: station.id, code, manual, device: DEVICE };
      const res = await api.post<ScanResponse>('/checkin/scan', body);
      setCount(res.passedCount);
      setPhase(phaseAfterScan(res));
      record = recordFromResponse(res, attempt, station, ctx.stations);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      record = recordFromError(errorMessage(e), attempt);
    }
    feedback(record.status);
    setOverlay(record);
    add(record);
  }, [station, ctx.stations, add]);

  const voidScan = async (r: ScanRecord) => {
    const scanId = r.scanId;
    if (!scanId) return;
    const body: VoidRequest = { scanId };
    try {
      const res = await api.post<VoidResponse>('/checkin/void', body);
      markVoided(scanId);
      // 活動開始後撤銷演練紀錄，回傳的是演練人數，不能蓋掉正式人數
      if (r.rehearsal === (phase === 'rehearsal')) setCount(res.passedCount);
      notify(`已撤銷 ${r.employee?.name ?? r.code} 的${station.name}`, 'info');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      const already = e instanceof ApiError && e.code === 'already_voided';
      if (already) markVoided(scanId);
      notify(errorMessage(e), already ? 'info' : 'error');
    }
  };

  const rehearsal = phase === 'rehearsal';
  const pct = ctx.scopeTotal ? Math.min(100, Math.round((count / ctx.scopeTotal) * 100)) : 0;

  return (
    <Box sx={{ minHeight: '100%' }}>
      <AppBar position="sticky" sx={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" noWrap sx={{ opacity: 0.85, display: 'block' }}>{ctx.event.name}</Typography>
            <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>{station.name}</Typography>
          </Box>
          {rehearsal && <Chip size="small" color="warning" label="演練" sx={{ fontWeight: 700 }} />}
          <Chip size="small" label={me.account} sx={{ bgcolor: 'rgba(255,255,255,.18)', color: 'inherit' }} />
          {ctx.stations.length > 1 && (
            <Tooltip title="切換關卡">
              <IconButton color="inherit" onClick={() => navigate('/checkin/stations')}><SwapHorizIcon /></IconButton>
            </Tooltip>
          )}
          <Tooltip title="登出">
            <IconButton color="inherit" onClick={() => logout()}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ py: 2 }}>
        <PhaseAlert phase={phase} startAt={startAt} />
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">{rehearsal ? '演練人數' : '已通過'}</Typography>
            <Typography>
              <Box component="span" sx={{ fontSize: 30, fontWeight: 700 }}>{count}</Box>
              <Box component="span" sx={{ color: 'text.secondary' }}> / {ctx.scopeTotal} 人</Box>
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={rehearsal ? 'warning' : 'primary'}
            sx={{ mt: 1, height: 8, borderRadius: 4 }}
          />
        </Paper>

        <ToggleButtonGroup
          exclusive
          fullWidth
          color="primary"
          value={mode}
          onChange={(_, v: Mode | null) => { if (v) setMode(v); }}
          sx={{ mb: 2 }}
        >
          <ToggleButton value="scanner"><KeyboardIcon sx={{ mr: 1 }} />掃描槍</ToggleButton>
          <ToggleButton value="camera"><PhotoCameraIcon sx={{ mr: 1 }} />相機</ToggleButton>
          <ToggleButton value="manual"><PersonSearchIcon sx={{ mr: 1 }} />手動</ToggleButton>
        </ToggleButtonGroup>

        {mode === 'scanner' && <ScannerPanel onCode={handleCode} />}
        {mode === 'camera' && <CameraPanel onCode={handleCode} />}
        {mode === 'manual' && <ManualPanel staffId={me.id} onCode={handleCode} />}

        <RecentList records={list} stationName={station.name} onVoid={voidScan} />
      </Container>

      {overlay && <ResultOverlay key={overlay.id} record={overlay} onClose={closeOverlay} />}
    </Box>
  );
}
