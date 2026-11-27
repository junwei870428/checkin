// 員工資料（F-EMP-1 到 F-EMP-8）：下載範本、匯入預覽與寫入、搜尋列表、匯入紀錄
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPLOYEE_PAGE_SIZE,
  type EmployeeList,
  type ImportBody,
  type ImportLog,
  type ImportPreview,
  type ImportResult,
} from '../../../shared/employees';
import { api, ApiError } from '../../api';
import { useNotify } from '../../components/notify';
import { parseSheet } from '../../excel';
import { fmtDT } from '../../format';
import { ImportPreviewDialog } from './employees/ImportPreviewDialog';
import { downloadTemplate } from './employees/template';

interface PendingImport {
  body: ImportBody;
  preview: ImportPreview;
  numericEmpNo: number;
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '系統發生錯誤，請稍後再試');

export default function EmployeesPage() {
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [list, setList] = useState<EmployeeList | null>(null);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [headerErr, setHeaderErr] = useState<{ error: string; headers: string[] } | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const loadList = useCallback(async () => {
    const seq = ++latest.current;
    const qs = new URLSearchParams({ q: q.trim(), includeInactive: showInactive ? '1' : '0' });
    try {
      const res = await api.get<EmployeeList>(`/employees?${qs}`);
      if (seq === latest.current) setList(res);
    } catch (e) {
      if (seq === latest.current) notify(errMsg(e), 'error');
    }
  }, [q, showInactive, notify]);

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await api.get<ImportLog[]>('/employees/import-logs'));
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  }, [notify]);

  // 輸入搜尋字時稍等再查，避免每打一個字就查一次
  useEffect(() => {
    const t = setTimeout(() => void loadList(), 300);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      let parsed: Awaited<ReturnType<typeof parseSheet>>;
      try {
        parsed = await parseSheet(file, ['empNo', 'name', 'dept', 'plant']);
      } catch {
        notify('無法讀取這個檔案，請確認是 Excel 格式', 'error');
        return;
      }
      if (!parsed.ok) {
        setHeaderErr(parsed);
        return;
      }
      const body: ImportBody = {
        fileName: file.name,
        rows: parsed.rows.map(r => ({ r: r.r, empNo: r.empNo ?? '', name: r.name ?? '', dept: r.dept ?? '', plant: r.plant ?? '' })),
      };
      const preview = await api.post<ImportPreview>('/employees/import/preview', body);
      setPending({ body, preview, numericEmpNo: parsed.numericEmpNo });
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api.post<ImportResult>('/employees/import/commit', pending.body);
      notify(`匯入完成：新增 ${r.added} 人，更新 ${r.updated} 人，停用 ${r.deactivated} 人`, 'success');
      setPending(null);
      void loadList();
      void loadLogs();
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { md: 'center' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>員工資料</Typography>
          <Typography variant="body2" color="text.secondary">
            {list ? `在職 ${list.activeCount} 人，停用 ${list.inactiveCount} 人。` : ''}建議在活動前一天匯入最新名單。
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<DescriptionIcon />} onClick={downloadTemplate}>下載匯入範本</Button>
        <Button variant="contained" startIcon={<UploadFileIcon />} disabled={busy} onClick={() => fileRef.current?.click()}>匯入 Excel</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
        />
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField
          size="small"
          placeholder="搜尋姓名、工號、部門、廠別"
          value={q}
          onChange={e => setQ(e.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <FormControlLabel control={<Switch checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />} label="顯示停用人員" />
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>工號</TableCell>
              <TableCell>姓名</TableCell>
              <TableCell>部門</TableCell>
              <TableCell>廠別</TableCell>
              <TableCell>狀態</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list?.rows.map(e => (
              <TableRow key={e.empNo} hover>
                <TableCell>{e.empNo}</TableCell>
                <TableCell>{e.name}</TableCell>
                <TableCell>{e.dept}</TableCell>
                <TableCell>{e.plant}</TableCell>
                <TableCell>{e.active ? <Chip size="small" color="success" variant="outlined" label="在職" /> : <Chip size="small" label="停用" />}</TableCell>
              </TableRow>
            ))}
            {list?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>沒有符合條件的員工</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {list && list.total > EMPLOYEE_PAGE_SIZE && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          共 {list.total} 筆，只顯示前 {EMPLOYEE_PAGE_SIZE} 筆，請用搜尋縮小範圍。
        </Typography>
      )}

      {logs.length > 0 && (
        <>
          <Typography sx={{ fontWeight: 700, mt: 3, mb: 1 }}>匯入紀錄</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>時間</TableCell>
                  <TableCell>檔案</TableCell>
                  <TableCell>操作人員</TableCell>
                  <TableCell align="right">新增</TableCell>
                  <TableCell align="right">更新</TableCell>
                  <TableCell align="right">停用</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell>{fmtDT(l.createdAt)}</TableCell>
                    <TableCell>{l.fileName}</TableCell>
                    <TableCell>{l.userName}</TableCell>
                    <TableCell align="right">{l.added}</TableCell>
                    <TableCell align="right">{l.updated}</TableCell>
                    <TableCell align="right">{l.deactivated}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <Dialog open={!!headerErr} onClose={() => setHeaderErr(null)} maxWidth="sm" fullWidth>
        <DialogTitle>無法匯入這個檔案</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>{headerErr?.error}</Alert>
          {headerErr && headerErr.headers.length > 0 && (
            <Typography variant="body2">檔案第一列的標題是：{headerErr.headers.join('、')}</Typography>
          )}
          <Typography variant="body2" sx={{ mt: 1 }}>
            第一列需要有部門、工號、廠別、姓名四個標題，順序不拘。也接受「員工編號」「廠區」等常見寫法。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={downloadTemplate}>下載匯入範本</Button>
          <Button variant="contained" onClick={() => setHeaderErr(null)}>關閉</Button>
        </DialogActions>
      </Dialog>

      {pending && (
        <ImportPreviewDialog
          fileName={pending.body.fileName}
          preview={pending.preview}
          numericEmpNo={pending.numericEmpNo}
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={() => void commit()}
        />
      )}
    </>
  );
}
