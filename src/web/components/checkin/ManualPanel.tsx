// 手動模式（F-CHK-4）：名單載入一次後在記憶體中搜尋
import { Alert, Autocomplete, Box, Button, CircularProgress, Paper, TextField, Typography, createFilterOptions } from '@mui/material';
import { useState } from 'react';
import type { CheckinPerson } from '../../../shared/checkin';
import { loadPeople, useLoad } from './data';

const filterOptions = createFilterOptions<CheckinPerson>({ limit: 50, stringify: o => `${o.name} ${o.empNo}` });

export function ManualPanel({ staffId, onCode }: { staffId: string; onCode: (code: string, manual: boolean) => void }) {
  const { state, retry } = useLoad(() => loadPeople(staffId));
  const [value, setValue] = useState<CheckinPerson | null>(null);

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6">手動查詢</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>沒有識別證也沒有電子 QR code 時，用姓名或工號找人</Typography>
      {state.status === 'loading' && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}><CircularProgress /></Box>
      )}
      {state.status === 'error' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>重試</Button>}>
          {state.message}
        </Alert>
      )}
      {state.status === 'ready' && (
        <>
          <Autocomplete
            options={state.data}
            value={value}
            onChange={(_, v) => setValue(v)}
            filterOptions={filterOptions}
            getOptionLabel={o => `${o.name} ${o.empNo}`}
            isOptionEqualToValue={(a, b) => a.empNo === b.empNo}
            renderOption={({ key: _key, ...props }, o) => (
              <li key={o.empNo} {...props}>
                <Box>
                  <Typography>
                    {o.name}
                    <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>{o.empNo}</Typography>
                  </Typography>
                  <Typography variant="body2" color="text.secondary">{o.dept}｜{o.plant}</Typography>
                </Box>
              </li>
            )}
            renderInput={p => <TextField {...p} label="姓名或工號" />}
            noOptionsText="找不到符合的人員"
          />
          <Button
            variant="contained"
            size="large"
            fullWidth
            sx={{ mt: 2 }}
            disabled={!value}
            onClick={() => {
              if (!value) return;
              onCode(value.empNo, true);
              setValue(null);
            }}
          >
            確認通過
          </Button>
        </>
      )}
    </Paper>
  );
}
