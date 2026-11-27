import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmText: string;
  /** 刪除等不可復原的操作，確認按鈕改為紅色 */
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** 二次確認對話框；按下確認時先呼叫 onConfirm 再關閉 */
export function ConfirmDialog({ open, title, body, confirmText, danger, onClose, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography component="div">{body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
