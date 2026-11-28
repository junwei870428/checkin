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
import { errorMessage, loadCheckinContext, updateCachedCount, useLoad } from '../../components/checkin/data';
import { feedback, primeAudio } from '../../components/checkin/feedback';
import { ManualPanel } from '../../components/checkin/ManualPanel';
import { PhaseAlert } from '../../components/checkin/PhaseAlert';
import { RecentList } from '../../components/checkin/RecentList';
import { ResultOverlay } from '../../components/checkin/ResultOverlay';
import { phaseAfterScan, recordFromError, recordFromResponse, useRecent, type ScanRecord } from '../../components/checkin/scanRecord';
import { ScannerPanel } from '../../components/checkin/ScannerPanel';
import { useWakeLock } from '../../components/checkin/wakeLock';
import { isNetworkError, newClientId, useOffline, type ReplayOutcome } from '../../components/checkin/offline';
import { decideOffline } from '../../components/checkin/offlineDecide';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Loading } from '../../components/Loading';
import { useNotify } from '../../components/notify';

// iPadOS 的 Safari 預設回報 Macintosh，要用觸控點數分辨
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const DEVICE: Device = MOBILE ? 'mobile' : 'desktop';
const DAY_MS = 86_400_000;
/** 連線時超過這個時間沒有回應，就改成離線記錄 */
const SCAN_TIMEOUT_MS = 5_000;

const OFFLINE_TITLE: Record<'ended' | 'not_started' | 'not_in_list' | 'need_checkin', string> = {
  ended: '活動已結束',
  not_started: '活動尚未開始',
  not_in_list: '不在本活動名單',
  need_checkin: '尚未完成入場報到',
};

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
  const [count, setCountState] = useState(station.passedCount);
  const setCount = useCallback((n: number) => {
    setCountState(n);
    updateCachedCount(station.id, n);
  }, [station.id]);
  const [overlay, setOverlay] = useState<ScanRecord | null>(null);
  const { list, add, markVoided, update } = useRecent(station.id);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useWakeLock();
  const [logoutAsk, setLogoutAsk] = useState(false);

  // 補送結果寫回最近紀錄，並提示有幾筆重複或失敗
  const onReplay = useCallback((outcomes: ReplayOutcome[]) => {
    let dup = 0;
    let failed = 0;
    for (const o of outcomes) {
      if ('error' in o) {
        failed++;
        update(o.item.clientId, { status: 'error', title: `補送失敗：${o.error.message}`, detail: null });
        continue;
      }
      const r = recordFromResponse(o.res, { code: o.item.code, manual: o.item.manual }, station, ctx.stations);
      if (o.res.status === 'ok') {
        update(o.item.clientId, { status: 'ok', title: r.title, detail: '已補送', scanId: r.scanId });
        if (o.item.stationId === station.id && o.res.rehearsal === (phase === 'rehearsal')) setCount(o.res.passedCount);
      } else {
        if (o.res.status === 'dup') dup++;
        else failed++;
        update(o.item.clientId, { status: o.res.status, title: `補送時發現：${r.title}`, detail: r.detail });
      }
    }
    const extra = [dup && `其中 ${dup} 筆別台已刷過`, failed && `${failed} 筆被拒絕`].filter(Boolean).join('，');
    notify(`已補送 ${outcomes.length} 筆離線紀錄${extra ? `，${extra}，請看最近紀錄` : ''}`, extra ? 'warning' : 'success');
  }, [update, station, ctx.stations, phase, notify]);
  const off = useOffline(me.id, onReplay);
  const pendingHere = off.queue.filter(q => q.stationId === station.id).length;

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
    const clientId = newClientId();
    let record: ScanRecord | null = null;
    if (off.online) {
      try {
        const body: ScanRequest = { stationId: station.id, code, manual, device: DEVICE, clientId };
        const res = await api.post<ScanResponse>('/checkin/scan', body, { timeoutMs: SCAN_TIMEOUT_MS });
        setCount(res.passedCount);
        setPhase(phaseAfterScan(res));
        if (res.employee && res.status !== 'error') off.notePassed(station.id, res.employee.empNo, res.rehearsal);
        record = recordFromResponse(res, attempt, station, ctx.stations);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        if (isNetworkError(e)) off.markOffline();
        else record = recordFromError(errorMessage(e), attempt);
      }
    }
    // 離線：用手機上的名單與已通過紀錄判斷，通過的先存起來，恢復連線後補送（同一個 clientId，伺服器不會重複記）
    if (!record) {
      const now = off.now();
      const d = decideOffline(ctx.event, station, ctx.stations, code, off.data, now);
      const base = { ...attempt, id: clientId, clientId, at: now, rehearsal: d.rehearsal, employee: d.employee, scanId: null, voided: false };
      if (d.kind === 'queue') {
        off.enqueue({ clientId, stationId: station.id, code, manual, device: DEVICE, scannedAt: now }, d.employee.empNo);
        record = { ...base, status: 'queued', title: `${station.name}已記錄（待上傳）`, detail: '離線中，恢復連線後自動上傳' };
      } else if (d.kind === 'dup') {
        record = { ...base, status: 'dup', title: `此人已${station.name}`, detail: '離線判斷：這台手機的紀錄顯示已通過' };
      } else {
        const checkin = ctx.stations.find(s => s.kind === 'checkin');
        const detail = d.reason === 'need_checkin' && checkin ? `請先到「${checkin.name}」報到（離線判斷）` : d.reason === 'not_in_list' ? `讀到的內容：${code}（離線判斷）` : null;
        record = { ...base, status: 'error', title: OFFLINE_TITLE[d.reason], detail };
      }
    }
    feedback(record.status);
    setOverlay(record);
    add(record);
  }, [station, ctx.stations, ctx.event, add, off]);

  const voidScan = async (r: ScanRecord) => {
    // 還沒上傳的紀錄直接從佇列移除
    if (r.status === 'queued' && r.clientId) {
      if (off.dequeue(r.clientId, r.employee?.empNo ?? null)) update(r.clientId, { voided: true });
      notify(`已撤銷 ${r.employee?.name ?? r.code} 的${station.name}（尚未上傳）`, 'info');
      return;
    }
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
            <IconButton color="inherit" onClick={() => (off.queue.length ? setLogoutAsk(true) : void logout())}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ py: 2 }}>
        <PhaseAlert phase={phase} startAt={startAt} />
        {(!off.online || off.queue.length > 0) && (
          <Alert severity={off.online ? 'info' : 'warning'} sx={{ mb: 2 }}>
            {off.online
              ? `正在上傳離線紀錄，還有 ${off.queue.length} 筆`
              : `離線中：刷卡會先存在這台手機，恢復連線後自動上傳。待上傳 ${off.queue.length} 筆`}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">{rehearsal ? '演練人數' : '已通過'}</Typography>
            <Typography>
              <Box component="span" sx={{ fontSize: 30, fontWeight: 700 }}>{count + pendingHere}</Box>
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
      <ConfirmDialog
        open={logoutAsk}
        title="還有紀錄沒有上傳"
        confirmText="仍要登出"
        danger
        body={`這台手機還有 ${off.queue.length} 筆離線紀錄沒有上傳。登出後紀錄會留在這台手機，用同一個帳號重新登入、恢復連線後會繼續上傳。`}
        onClose={() => setLogoutAsk(false)}
        onConfirm={() => void logout()}
      />
    </Box>
  );
}
