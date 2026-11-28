// 操作紀錄：系統帳號的登入與修改操作，最新的在最上面
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { AUDIT_LABELS, AUDIT_LIMIT, type AuditLog } from '../../../shared/audit';
import { api, ApiError } from '../../api';
import { Loading } from '../../components/Loading';
import { useNotify } from '../../components/notify';
import { fmtDate, fmtTime } from '../../format';

export default function AuditPage() {
  const notify = useNotify();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    api.get<AuditLog[]>('/audit-logs').then(setLogs, e => {
      notify(e instanceof ApiError ? e.message : '系統發生錯誤，請稍後再試', 'error');
      setLogs([]);
    });
  }, [notify]);

  if (!logs) return <Loading />;

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>操作紀錄</Typography>
        <Typography variant="body2" color="text.secondary">
          系統帳號的登入、帳號與活動設定的變更。顯示最近 {AUDIT_LIMIT} 筆，報到與撤銷紀錄請看各活動的報表。
        </Typography>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>時間</TableCell>
              <TableCell>操作者</TableCell>
              <TableCell>動作</TableCell>
              <TableCell>對象</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.map(l => (
              <TableRow key={l.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(l.createdAt)} {fmtTime(l.createdAt)}</TableCell>
                <TableCell>{l.actor}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{AUDIT_LABELS[l.action] ?? l.action}</TableCell>
                <TableCell>{l.target}</TableCell>
              </TableRow>
            ))}
            {!logs.length && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 4 }}>目前沒有紀錄</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
