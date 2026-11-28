// 操作紀錄（GET /api/audit-logs）

export const AUDIT_LABELS = {
  login: '登入',
  user_create: '新增承辦人',
  user_reset_password: '重設密碼',
  user_disable: '停用帳號',
  user_enable: '啟用帳號',
  event_create: '建立活動',
  event_update: '修改活動',
  event_members: '匯入參加名單',
  event_rehearsal_on: '開啟演練模式',
  event_rehearsal_off: '關閉演練模式',
  event_close: '結束活動',
  event_clear_rehearsal: '清除演練紀錄',
  event_delete: '刪除活動',
  staff_create: '產生報到帳號',
  staff_reset_pin: '重設 PIN 碼',
  staff_disable: '停用報到帳號',
  staff_enable: '啟用報到帳號',
  staff_unlock: '解除報到帳號鎖定',
} as const;

export type AuditAction = keyof typeof AUDIT_LABELS;

/** 列表一次回傳的筆數上限 */
export const AUDIT_LIMIT = 300;

export interface AuditLog {
  id: number;
  createdAt: number;
  /** 操作者，格式「名稱（帳號）」 */
  actor: string;
  action: AuditAction;
  target: string;
}
