// 關卡（F-EVT-4）：改名、新增領取關卡、切換「需先完成入場報到」、刪除領取關卡。
// 已有掃描紀錄的關卡由後端擋下並說明，入場報到關卡沒有刪除按鈕。
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import RedeemIcon from '@mui/icons-material/Redeem';
import { Box, Button, FormControlLabel, IconButton, Paper, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import type { StationDetail, StationKind } from '../../../../../shared/event';
import { MAX_STATIONS, STATION_NAME_MAX } from '../../../../../shared/events-admin';

/** 編輯中的關卡；key 給 React 列表用，新關卡還沒有 id */
export interface DraftStation {
  key: string;
  id?: string;
  name: string;
  kind: StationKind;
  requireCheckin: boolean;
}

let seq = 0;

export const toDraftStation = (s: StationDetail): DraftStation =>
  ({ key: s.id, id: s.id, name: s.name, kind: s.kind, requireCheckin: s.requireCheckin });

const newGiftStation = (): DraftStation => ({ key: `new-${++seq}`, name: '領取紀念品', kind: 'gift', requireCheckin: true });

export function StationsEditor({ stations, onChange }: { stations: DraftStation[]; onChange: (s: DraftStation[]) => void }) {
  const set = (key: string, patch: Partial<DraftStation>) => onChange(stations.map(s => (s.key === key ? { ...s, ...patch } : s)));
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>關卡</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        每個關卡各自記錄，同一張識別證在同一個關卡只能通過一次。已有掃描紀錄（含已撤銷與演練紀錄）的關卡不能刪除。
      </Typography>
      <Stack spacing={1.5}>
        {stations.map(s => (
          <Stack key={s.key} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            {s.kind === 'checkin' ? <HowToRegIcon color="primary" /> : <RedeemIcon color="primary" />}
            <TextField size="small" label="關卡名稱" value={s.name} onChange={e => set(s.key, { name: e.target.value })}
              error={!s.name.trim()} sx={{ minWidth: 200 }} slotProps={{ htmlInput: { maxLength: STATION_NAME_MAX } }} />
            {s.kind === 'gift'
              ? <FormControlLabel control={<Switch checked={s.requireCheckin} onChange={e => set(s.key, { requireCheckin: e.target.checked })} />} label="需先完成入場報到" />
              : <Typography variant="body2" color="text.secondary">入場報到關卡</Typography>}
            <Box sx={{ flex: 1 }} />
            {s.kind === 'gift' && (
              <Tooltip title="刪除關卡">
                <IconButton aria-label={`刪除${s.name}`} onClick={() => onChange(stations.filter(x => x.key !== s.key))}><DeleteIcon /></IconButton>
              </Tooltip>
            )}
          </Stack>
        ))}
        <Box>
          <Button startIcon={<AddIcon />} disabled={stations.length >= MAX_STATIONS} onClick={() => onChange([...stations, newGiftStation()])}>
            新增領取關卡
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
