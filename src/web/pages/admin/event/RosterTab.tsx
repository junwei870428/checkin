// 名單與報表（F-RPT-2、F-RPT-3）：選關卡、篩選通過狀態、搜尋，畫面最多 300 筆，完整資料請匯出 Excel
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EventRoster } from '../../../../shared/reports';
import { api, ApiError } from '../../../api';
import { Loading } from '../../../components/Loading';
import { useNotify } from '../../../components/notify';
import { downloadRoster } from '../../../export';
import { fmtDT } from '../../../format';
import type { EventTabProps } from '../EventDetailPage';

const MAX_ROWS = 300;

type Filter = 'all' | 'passed' | 'pending';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function RosterTab({ event }: EventTabProps) {
  const notify = useNotify();
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [error, setError] = useState('');
  const [stationId, setStationId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'' | 'reload' | 'export'>('');

  const load = useCallback(async () => {
    const r = await api.get<EventRoster>(`/events/${encodeURIComponent(event.id)}/roster`);
    setRoster(r);
    setError('');
    return r;
  }, [event.id]);

  useEffect(() => {
    load().catch(e => setError(message(e, '無法載入名單，請稍後再試')));
  }, [load]);

  const station = roster?.stations.find(s => s.id === stationId) ?? roster?.stations[0];
  const rows = useMemo(() => {
    if (!roster || !station) return [];
    const k = q.trim().toLowerCase();
    return roster.people.filter(p => {
      const passed = !!p.passes[station.id];
      if ((filter === 'passed' && !passed) || (filter === 'pending' && passed)) return false;
      return !k || [p.name, p.empNo, p.dept, p.plant].some(v => v.toLowerCase().includes(k));
    });
  }, [roster, station, filter, q]);

  // 匯出前重新讀一次名單，檔案內容是當下最新的資料
  const run = (kind: 'reload' | 'export') => {
    setBusy(kind);
    load()
      .then(r => {
        if (kind === 'export') downloadRoster(event.name, r);
      })
      .catch(e => notify(message(e, kind === 'export' ? '匯出失敗，請稍後再試' : '無法載入名單，請稍後再試'), 'error'))
      .finally(() => setBusy(''));
  };

  if (!roster) return error ? <Alert severity="error">{error}</Alert> : <Loading />;

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { md: 'center' } }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="roster-station-label">關卡</InputLabel>
          <Select labelId="roster-station-label" label="關卡" value={station?.id ?? ''} onChange={e => setStationId(e.target.value)}>
            {roster.stations.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </Select>
        </FormControl>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: Filter | null) => v && setFilter(v)}>
          <ToggleButton value="all">全部</ToggleButton>
          <ToggleButton value="passed">已通過</ToggleButton>
          <ToggleButton value="pending">未通過</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="搜尋姓名、工號、部門、廠別"
          value={q}
          onChange={e => setQ(e.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={() => run('reload')} disabled={!!busy}>重新整理</Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => run('export')} disabled={!!busy}>
            {busy === 'export' ? '匯出中…' : '匯出 Excel'}
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        共 {rows.length} 人{rows.length > MAX_ROWS ? `，畫面只顯示前 ${MAX_ROWS} 筆，完整資料請匯出 Excel` : ''}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>工號</TableCell>
              <TableCell>姓名</TableCell>
              <TableCell>部門</TableCell>
              <TableCell>廠別</TableCell>
              <TableCell>狀態</TableCell>
              <TableCell>時間</TableCell>
              <TableCell>處理帳號</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, MAX_ROWS).map(p => {
              const x = station ? p.passes[station.id] : undefined;
              return (
                <TableRow key={p.empNo} hover>
                  <TableCell>{p.empNo}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.dept}</TableCell>
                  <TableCell>{p.plant}</TableCell>
                  <TableCell>
                    {x
                      ? <Chip size="small" color="success" label={x.manual ? '已通過（手動）' : '已通過'} />
                      : <Chip size="small" variant="outlined" label="未通過" />}
                  </TableCell>
                  <TableCell>{x ? fmtDT(x.at) : ''}</TableCell>
                  <TableCell>{x?.by ?? ''}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>沒有符合條件的人員</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        只含正式紀錄。匯出的檔案包含「統計」工作表與每個關卡的完整名單。
      </Typography>
    </>
  );
}
