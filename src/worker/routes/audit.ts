// 操作紀錄列表，只有系統管理員能看，新到舊排列

import { Hono } from 'hono';
import { AUDIT_LIMIT, type AuditAction, type AuditLog } from '../../shared/audit';
import { requireAuth, requireUser } from '../auth';
import type { AppEnv } from '../env';

export const auditRoutes = new Hono<AppEnv>()
  .get('/audit-logs', requireAuth, requireUser(['admin']), async c => {
    const { results } = await c.env.DB.prepare(
      `SELECT a.id, a.created_at, u.name, u.username, a.action, a.target
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.id DESC LIMIT ?`,
    ).bind(AUDIT_LIMIT).all<{ id: number; created_at: number; name: string | null; username: string | null; action: AuditAction; target: string }>();
    const out: AuditLog[] = results.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      actor: r.username ? `${r.name}（${r.username}）` : '（已不存在的帳號）',
      action: r.action,
      target: r.target,
    }));
    return c.json(out);
  });
