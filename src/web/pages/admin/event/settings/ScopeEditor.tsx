// 參加範圍（F-EVT-3）：全公司、指定廠別、指定部門（廠別／部門成對）、匯入名單，並即時顯示範圍內在職人數
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { Alert, Autocomplete, Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { EventDetail, Scope } from '../../../../../shared/event';
import { scopeCount, type MembersResult, type ScopeGroup, type ScopeOptions } from '../../../../../shared/events-admin';
import { api, ApiError } from '../../../../api';
import { useNotify } from '../../../../components/notify';
import { parseSheet } from '../../../../excel';

const TYPE_LABEL: Record<Scope['type'], string> = {
  all: '全公司在職員工',
  plants: '指定廠別',
  depts: '指定部門',
  list: '匯入名單（Excel）',
};

function emptyScope(type: Scope['type']): Scope {
  switch (type) {
    case 'plants':
      return { type, plants: [] };
    case 'depts':
      return { type, depts: [] };
    default:
      return { type };
  }
}

const deptKey = (g: { plant: string; dept: string }) => `${g.plant}／${g.dept}`;

interface ImportNote {
  unknown: string[];
  numeric: number;
}

export function ScopeEditor({ event, scope, onChange, onMembersChanged }: {
  event: EventDetail;
  scope: Scope;
  onChange: (scope: Scope) => void;
  /** 名單已寫入後端，需要重新讀取活動（名單人數） */
  onMembersChanged: () => void;
}) {
  const notify = useNotify();
  const [opts, setOpts] = useState<ScopeOptions | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<ImportNote | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<ScopeOptions>(`/scope-options?eventId=${encodeURIComponent(event.id)}`)
      .then(setOpts)
      .catch(e => notify(e instanceof ApiError ? e.message : '無法載入廠別與部門', 'error'));
  }, [event.id, notify]);

  const groups = opts?.groups ?? [];
  const plantCounts = new Map<string, number>();
  for (const g of groups) plantCounts.set(g.plant, (plantCounts.get(g.plant) ?? 0) + g.count);

  // 已選但員工資料裡已經沒有的廠別或部門仍列為選項，人數顯示 0
  const plantOptions = [...new Set([...plantCounts.keys(), ...(scope.type === 'plants' ? scope.plants : [])])].sort();
  const deptValue: ScopeGroup[] = scope.type === 'depts'
    ? scope.depts.map(([plant, dept]) => groups.find(g => g.plant === plant && g.dept === dept) ?? { plant, dept, count: 0 })
    : [];
  const deptOptions = [...groups, ...deptValue.filter(v => !groups.includes(v))]
    .sort((a, b) => a.plant.localeCompare(b.plant) || a.dept.localeCompare(b.dept));

  const importList = async (file: File) => {
    setImporting(true);
    setNote(null);
    try {
      const p = await parseSheet(file, ['empNo']);
      if (!p.ok) {
        notify(p.error, 'error');
        return;
      }
      const empNos = p.rows.map(r => r.empNo ?? '').filter(Boolean);
      const r = await api.post<MembersResult>(`/events/${encodeURIComponent(event.id)}/members`, { empNos });
      setOpts(o => o && { ...o, listActive: r.active });
      setNote({ unknown: r.unknown, numeric: p.numericEmpNo });
      notify(`已匯入 ${r.count} 人`, 'success');
      onMembersChanged();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '無法讀取這個檔案，請確認是 Excel 格式', 'error');
    } finally {
      setImporting(false);
    }
  };

  const total = opts ? scopeCount(scope, groups, opts.listActive ?? 0) : null;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography sx={{ fontWeight: 700, mb: 2 }}>參加範圍</Typography>
      <Stack spacing={2}>
        <FormControl fullWidth>
          <InputLabel id="scope-type">誰可以參加</InputLabel>
          <Select labelId="scope-type" label="誰可以參加" value={scope.type} onChange={e => onChange(emptyScope(e.target.value as Scope['type']))}>
            {(Object.keys(TYPE_LABEL) as Array<Scope['type']>).map(t => <MenuItem key={t} value={t}>{TYPE_LABEL[t]}</MenuItem>)}
          </Select>
        </FormControl>

        {scope.type === 'plants' && (
          <Autocomplete
            multiple
            options={plantOptions}
            value={scope.plants}
            onChange={(_, v) => onChange({ type: 'plants', plants: v })}
            renderOption={({ key, ...props }, p) => (
              <Box component="li" key={key} {...props} sx={{ justifyContent: 'space-between !important' }}>
                {p}<Typography variant="body2" color="text.secondary">{plantCounts.get(p) ?? 0} 人</Typography>
              </Box>
            )}
            renderInput={p => <TextField {...p} label="選擇廠別" error={!scope.plants.length} helperText={scope.plants.length ? '' : '請至少選擇一個廠別'} />}
          />
        )}

        {scope.type === 'depts' && (
          <Autocomplete
            multiple
            options={deptOptions}
            value={deptValue}
            groupBy={g => g.plant}
            getOptionLabel={deptKey}
            isOptionEqualToValue={(a, b) => a.plant === b.plant && a.dept === b.dept}
            onChange={(_, v) => onChange({ type: 'depts', depts: v.map(g => [g.plant, g.dept]) })}
            renderOption={({ key, ...props }, g) => (
              <Box component="li" key={key} {...props} sx={{ justifyContent: 'space-between !important' }}>
                {g.dept}<Typography variant="body2" color="text.secondary">{g.count} 人</Typography>
              </Box>
            )}
            renderInput={p => (
              <TextField {...p} label="選擇部門（廠別／部門）" error={!scope.depts.length}
                helperText={scope.depts.length ? '不同廠的同名部門視為不同部門' : '請至少選擇一個部門'} />
            )}
          />
        )}

        {scope.type === 'list' && (
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <Button variant="outlined" startIcon={<UploadFileIcon />} disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? '匯入中…' : '匯入名單'}
              </Button>
              <Typography variant="body2" color="text.secondary">
                目前名單 {event.memberCount} 人。Excel 只需要「工號」一欄，匯入後立即取代原本的名單。
              </Typography>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importList(f); }} />
            </Stack>
            {event.scope.type !== 'list' && <Alert severity="info">按「儲存設定」後，參加範圍才會改為匯入名單。</Alert>}
            {note && note.unknown.length > 0 && (
              <Alert severity="warning">
                有 {note.unknown.length} 個工號不在員工資料裡：{note.unknown.slice(0, 20).join('、')}{note.unknown.length > 20 ? ' 等' : ''}
              </Alert>
            )}
            {note && note.numeric > 0 && (
              <Alert severity="warning">工號欄有 {note.numeric} 格是數字格式，前導零可能已遺失，請確認 Excel 工號欄設為文字格式。</Alert>
            )}
          </Stack>
        )}

        <Typography variant="body2" color="text.secondary">
          儲存後，範圍內的在職人數：{total === null ? '計算中…' : `${total} 人`}
        </Typography>
      </Stack>
    </Paper>
  );
}
