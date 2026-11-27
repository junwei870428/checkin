// 即時概況（F-RPT-1）：各關卡人數每 20 秒、分組表每 2 分鐘、範圍總人數每 5 分鐘更新，
// 都只在分頁可見時更新（規劃書第 9 節），另有手動重新整理
import HowToRegIcon from '@mui/icons-material/HowToReg';
import RedeemIcon from '@mui/icons-material/Redeem';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { BreakdownCounts, EventBreakdown, EventSummary } from '../../../../shared/reports';
import { api, ApiError } from '../../../api';
import { Loading } from '../../../components/Loading';
import { fmtTime } from '../../../format';
import type { EventTabProps } from '../EventDetailPage';

const TICK_MS = 20_000;
const BREAKDOWN_MS = 120_000;
const TOTAL_MS = 300_000;

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

export default function OverviewTab({ event }: EventTabProps) {
  // total 只有每 5 分鐘那次會回傳，其他時候沿用上一次的值
  const [summary, setSummary] = useState<(EventSummary & { total: number }) | null>(null);
  const [breakdown, setBreakdown] = useState<EventBreakdown | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const due = useRef({ total: 0, breakdown: 0 });

  /** force 時全部重新讀取，否則只讀人數與已到期的項目 */
  const refresh = useCallback(async (force: boolean) => {
    const now = Date.now();
    const withTotal = force || now >= due.current.total;
    const withBreakdown = force || now >= due.current.breakdown;
    const base = `/events/${encodeURIComponent(event.id)}`;
    try {
      const [s, b] = await Promise.all([
        api.get<EventSummary>(`${base}/summary${withTotal ? '?total=1' : ''}`),
        withBreakdown ? api.get<EventBreakdown>(`${base}/breakdown`) : null,
      ]);
      setSummary(prev => ({ ...s, total: s.total ?? prev?.total ?? 0 }));
      if (withTotal) due.current.total = now + TOTAL_MS;
      if (b) {
        setBreakdown(b);
        due.current.breakdown = now + BREAKDOWN_MS;
      }
      setUpdatedAt(Date.now());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '無法更新人數，請稍後再試');
    }
  }, [event.id]);

  useEffect(() => {
    due.current = { total: 0, breakdown: 0 };
    void refresh(true);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(false);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const manualRefresh = () => {
    setBusy(true);
    void refresh(true).finally(() => setBusy(false));
  };

  if (!summary) return error ? <Alert severity="error">{error}</Alert> : <Loading />;
  const { total, rehearsal } = summary;

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Typography variant="body2" color="text.secondary">最後更新 {fmtTime(updatedAt)}</Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={manualRefresh} disabled={busy}>重新整理</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {rehearsal && <Alert severity="warning" sx={{ mb: 2 }}>演練模式中。演練人數另外計算，不計入正式人數與匯出。</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(260px, 1fr))' }, gap: 2, mb: 3 }}>
        {summary.stations.map(s => {
          const p = pct(s.passed, total);
          return (
            <Paper key={s.id} variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {s.kind === 'checkin' ? <HowToRegIcon color="primary" /> : <RedeemIcon color="primary" />}
                <Typography sx={{ fontWeight: 700 }}>{s.name}</Typography>
              </Stack>
              <Typography sx={{ mt: 1 }}>
                <Box component="span" sx={{ fontSize: 36, fontWeight: 700 }}>{s.passed}</Box>
                <Box component="span" sx={{ color: 'text.secondary' }}> / {total} 人，{p}%</Box>
              </Typography>
              <LinearProgress variant="determinate" value={Math.min(p, 100)} sx={{ mt: 1, height: 8, borderRadius: 4 }} />
              {rehearsal && (
                <Typography variant="body2" sx={{ mt: 1, color: 'warning.main', fontWeight: 600 }}>演練 {rehearsal[s.id] ?? 0} 人</Typography>
              )}
            </Paper>
          );
        })}
      </Box>

      <Typography sx={{ fontWeight: 700, mb: 1 }}>依廠別與部門</Typography>
      {breakdown && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>廠別</TableCell>
                <TableCell>部門</TableCell>
                <TableCell align="right">應到</TableCell>
                {breakdown.stations.map(s => <TableCell key={s.id} align="right">{s.name}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {breakdown.plants.map(p => (
                <Fragment key={p.plant}>
                  {p.depts.map(d => (
                    <TableRow key={d.dept}>
                      <TableCell>{p.plant}</TableCell>
                      <TableCell>{d.dept}</TableCell>
                      <CountCells c={d} />
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 700 }}>{p.plant} 小計</TableCell>
                    <TableCell />
                    <CountCells c={p} bold />
                  </TableRow>
                </Fragment>
              ))}
              {breakdown.plants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3 + breakdown.stations.length}>參加範圍內沒有人員，請到活動設定調整。</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        只計算正式紀錄與目前參加範圍內的在職人員。人數每 20 秒更新，分組表每 2 分鐘更新，切到其他分頁時暫停。
      </Typography>
    </>
  );
}

function CountCells({ c, bold }: { c: BreakdownCounts; bold?: boolean }) {
  const sx = bold ? { fontWeight: 700 } : undefined;
  return (
    <>
      <TableCell align="right" sx={sx}>{c.expected}</TableCell>
      {c.passed.map((n, i) => (
        <TableCell key={i} align="right" sx={sx}>{n}（{pct(n, c.expected)}%）</TableCell>
      ))}
    </>
  );
}
