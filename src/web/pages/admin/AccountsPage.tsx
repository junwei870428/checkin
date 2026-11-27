// 系統帳號（F-ACC-1）：承辦人列表、新增、重設密碼、停用與啟用；密碼由系統產生，只顯示一次
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { CreateUserBody, PasswordIssued, UserAccount } from '../../../shared/employees';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Loading } from '../../components/Loading';
import { useNotify } from '../../components/notify';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '系統發生錯誤，請稍後再試');

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: PasswordIssued) => void }) {
  const [f, setF] = useState<CreateUserBody>({ name: '', username: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setF({ name: '', username: '' });
    setError('');
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<PasswordIssued>('/users', f);
      close();
      onCreated(r);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>新增活動承辦人</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="名稱" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="例如 彰化廠福委會" />
          <TextField
            label="登入帳號"
            value={f.username}
            onChange={e => {
              setF({ ...f, username: e.target.value.replace(/\s/g, '') });
              setError('');
            }}
            error={!!error}
            helperText={error}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>取消</Button>
        <Button variant="contained" disabled={!f.name.trim() || !f.username || busy} onClick={() => void submit()}>新增</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function AccountsPage() {
  const { me, logout } = useAuth();
  const notify = useNotify();
  const [users, setUsers] = useState<UserAccount[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<PasswordIssued | null>(null);
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const myId = me?.type === 'user' ? me.id : '';

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<UserAccount[]>('/users'));
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = async (u: UserAccount) => {
    try {
      setIssued(await api.post<PasswordIssued>(`/users/${u.id}/reset-password`));
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  const toggle = async (u: UserAccount) => {
    try {
      await api.patch<UserAccount>(`/users/${u.id}`, { disabled: !u.disabled });
      notify(u.disabled ? `已啟用 ${u.name}` : `已停用 ${u.name}`, 'success');
      void load();
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  // 重設自己的密碼後舊登入已失效，關閉密碼對話框時直接登出
  const closeIssued = () => {
    const self = issued?.user.id === myId;
    setIssued(null);
    if (self) void logout('密碼已重設，請用新密碼登入');
    else void load();
  };

  if (!users) return <Loading />;

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>系統帳號</Typography>
          <Typography variant="body2" color="text.secondary">活動承辦人只能看到和管理自己建立的活動。密碼由系統產生。</Typography>
        </Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setCreateOpen(true)}>新增承辦人</Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>名稱</TableCell>
              <TableCell>帳號</TableCell>
              <TableCell>角色</TableCell>
              <TableCell>狀態</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id} hover>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.username}</TableCell>
                <TableCell>{u.role === 'admin' ? '系統管理員' : '活動承辦人'}</TableCell>
                <TableCell>{u.disabled ? <Chip size="small" label="已停用" /> : <Chip size="small" color="success" variant="outlined" label="可使用" />}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Button size="small" onClick={() => setResetTarget(u)}>重設密碼</Button>
                  {u.id !== myId && (
                    <Button size="small" color={u.disabled ? 'primary' : 'error'} onClick={() => void toggle(u)}>
                      {u.disabled ? '啟用' : '停用'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={r => setIssued(r)}
      />

      <ConfirmDialog
        open={!!resetTarget}
        title="重設密碼"
        body={
          resetTarget?.id === myId
            ? '重設後舊密碼立即失效，你需要用新密碼重新登入。'
            : `重設後 ${resetTarget?.name ?? ''} 的舊密碼立即失效，已登入的裝置也會被登出。`
        }
        confirmText="重設密碼"
        onClose={() => setResetTarget(null)}
        onConfirm={() => resetTarget && void reset(resetTarget)}
      />

      <Dialog open={!!issued} maxWidth="xs" fullWidth>
        <DialogTitle>帳號密碼</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>密碼只會顯示這一次，請記下來交給承辦人。</Alert>
          <Typography>帳號：<b>{issued?.user.username}</b></Typography>
          <Typography sx={{ mt: 1 }}>密碼：<b style={{ letterSpacing: 1, fontFamily: 'monospace', fontSize: '1.1em' }}>{issued?.password}</b></Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={closeIssued}>我記下來了</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
