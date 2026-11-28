// 寫入操作紀錄。在操作成功後呼叫，操作失敗的請求不留紀錄。

import type { Context } from 'hono';
import type { AuditAction } from '../shared/audit';
import type { AppEnv } from './env';

export const writeAudit = (db: D1Database, actorId: string, action: AuditAction, target = '') =>
  db.prepare('INSERT INTO audit_logs (created_at, actor_id, action, target) VALUES (?, ?, ?, ?)')
    .bind(Date.now(), actorId, action, target).run();

/** 操作者為目前登入的系統帳號 */
export const audit = (c: Context<AppEnv>, action: AuditAction, target = '') => writeAudit(c.env.DB, c.get('auth').id, action, target);

export const eventLabel = (ev: { name: string; code: string }) => `${ev.name}（${ev.code}）`;
