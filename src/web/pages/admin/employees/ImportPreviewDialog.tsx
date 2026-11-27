// 匯入前預覽（F-EMP-4、F-EMP-5、F-EMP-6）：各狀態筆數與明細、前導零與大量停用警告，有錯誤時不可匯入
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type ChipProps,
} from '@mui/material';
import { useState } from 'react';
import type { EmployeeData, ImportPreview, PreviewRow } from '../../../../shared/employees';

/** 停用人數超過在職人數的這個比例時加強警告 */
const DEACTIVATE_WARN_RATIO = 0.3;
const MAX_SHOWN = 300;

type Filter = 'all' | PreviewRow['status'] | 'deactivate';

const STATUS: Record<Exclude<Filter, 'all'>, { label: string; color: ChipProps['color'] }> = {
  new: { label: '新增', color: 'success' },
  update: { label: '更新', color: 'info' },
  same: { label: '不變', color: 'default' },
  deactivate: { label: '停用', color: 'warning' },
  error: { label: '錯誤', color: 'error' },
};

const FILTERS: Filter[] = ['all', 'new', 'update', 'same', 'deactivate', 'error'];

/** 更新列的變動說明，例如「部門：資訊室 → 總務室」 */
function changeNotes(r: Extract<PreviewRow, { status: 'update' }>): string[] {
  const notes: string[] = [];
  if (r.prev.name !== r.name) notes.push(`姓名：${r.prev.name} → ${r.name}`);
  if (r.prev.dept !== r.dept) notes.push(`部門：${r.prev.dept} → ${r.dept}`);
  if (r.prev.plant !== r.plant) notes.push(`廠別：${r.prev.plant} → ${r.plant}`);
  if (!r.prev.active) notes.push('重新啟用');
  return notes;
}

interface Line {
  key: string;
  r: number | null;
  emp: EmployeeData;
  status: Exclude<Filter, 'all'>;
  notes: string[];
}

function lines(preview: ImportPreview, filter: Filter): Line[] {
  if (filter === 'deactivate') {
    return preview.deactivate.map(e => ({ key: `d-${e.empNo}`, r: null, emp: e, status: 'deactivate', notes: [] }));
  }
  return preview.rows
    .filter(r => filter === 'all' || r.status === filter)
    .map(r => ({
      key: `r-${r.r}`,
      r: r.r,
      emp: r,
      status: r.status,
      notes: r.status === 'error' ? r.errors : r.status === 'update' ? changeNotes(r) : [],
    }));
}

export interface ImportPreviewDialogProps {
  fileName: string;
  preview: ImportPreview;
  numericEmpNo: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ImportPreviewDialog({ fileName, preview, numericEmpNo, busy, onClose, onConfirm }: ImportPreviewDialogProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const { counts, activeCount } = preview;
  const bigDeactivate = activeCount > 0 && counts.deactivate > activeCount * DEACTIVATE_WARN_RATIO;
  const shown = lines(preview, filter);
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>確認匯入：{fileName}</DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap' }}>
          {(['new', 'update', 'same', 'deactivate'] as const).map(k => (
            <Chip key={k} color={STATUS[k].color} label={`${STATUS[k].label} ${counts[k]}`} />
          ))}
          {counts.error > 0 && <Chip color="error" label={`錯誤 ${counts.error}`} />}
        </Stack>
        <Stack spacing={1} sx={{ mb: 2 }}>
          {counts.error > 0 && <Alert severity="error">有 {counts.error} 列資料有問題，請修正 Excel 後重新匯入。</Alert>}
          {numericEmpNo > 0 && (
            <Alert severity="warning">
              有 {numericEmpNo} 個工號在 Excel 裡是數字格式，開頭的 0 可能已經不見了。請把工號欄設成「文字」格式，再確認一次。
            </Alert>
          )}
          {counts.deactivate > 0 && (
            <Alert severity={bigDeactivate ? 'warning' : 'info'}>
              這份檔案裡沒有的 {counts.deactivate} 位在職員工會被設為停用（不會刪除）。
              {bigDeactivate && '人數超過在職人數的 30%，請確認這是完整的員工名單。'}
            </Alert>
          )}
        </Stack>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: Filter | null) => v && setFilter(v)} sx={{ mb: 1, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <ToggleButton key={f} value={f}>{f === 'all' ? '全部' : STATUS[f].label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TableContainer sx={{ maxHeight: 360 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>列</TableCell>
                <TableCell>部門</TableCell>
                <TableCell>工號</TableCell>
                <TableCell>廠別</TableCell>
                <TableCell>姓名</TableCell>
                <TableCell>結果</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.slice(0, MAX_SHOWN).map(l => (
                <TableRow key={l.key}>
                  <TableCell>{l.r ?? '—'}</TableCell>
                  <TableCell>{l.emp.dept}</TableCell>
                  <TableCell>{l.emp.empNo}</TableCell>
                  <TableCell>{l.emp.plant}</TableCell>
                  <TableCell>{l.emp.name}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS[l.status].color} label={STATUS[l.status].label} />
                    {l.notes.map(n => (
                      <Typography key={n} variant="caption" color={l.status === 'error' ? 'error' : 'text.secondary'} sx={{ display: 'block' }}>
                        {n}
                      </Typography>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>沒有資料</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {shown.length > MAX_SHOWN && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            只顯示前 {MAX_SHOWN} 筆，共 {shown.length} 筆。
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" disabled={counts.error > 0 || busy} onClick={onConfirm}>確認匯入</Button>
      </DialogActions>
    </Dialog>
  );
}
