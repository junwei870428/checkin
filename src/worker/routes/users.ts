// 系統帳號：承辦人建立、重設密碼、停用與啟用（F-ACC-1，規劃書第 8 節）

import { Hono } from 'hono';
import { USERNAME_HINT, USERNAME_PATTERN, type PasswordIssued, type UserAccount } from '../../shared/employees';
import type { Role } from '../../shared/types';
import { audit } from '../audit';
import { requireAuth, requireUser } from '../auth';
import { genPassword, hashSecret, newId, newSalt } from '../crypto';
import { apiError, type AppEnv } from '../env';

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  disabled: number;
  created_at: number;
}

const USER_COLUMNS = 'id, username, name, role, disabled, created_at';

const toAccount = (r: UserRow): UserAccount => ({
  id: r.id,
  username: r.username,
  name: r.name,
  role: r.role,
  disabled: r.disabled === 1,
  createdAt: r.created_at,
});

const userLabel = (r: UserRow) => `${r.name}（${r.username}）`;

export const userRoutes = new Hono<AppEnv>()
  .get('/users', requireAuth, requireUser(['admin']), async c => {
    const { results } = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY role, rowid`).all<UserRow>();
    return c.json(results.map(toAccount));
  })
  .post('/users', requireAuth, requireUser(['admin']), async c => {
    const b = await c.req.json().catch(() => null);
    const username = typeof b?.username === 'string' ? b.username.trim() : '';
    const name = typeof b?.name === 'string' ? b.name.trim() : '';
    if (!USERNAME_PATTERN.test(username)) return apiError(c, 400, 'bad_request', `登入帳號需為 ${USERNAME_HINT}`);
    if (!name || name.length > 64) return apiError(c, 400, 'bad_request', '名稱需為 1 到 64 字');
    const password = genPassword();
    const salt = newSalt();
    const row = await c.env.DB.prepare(
      `INSERT INTO users (id, username, name, role, pwd_salt, pwd_hash, created_at) VALUES (?, ?, ?, 'organizer', ?, ?, ?)
       ON CONFLICT(username) DO NOTHING RETURNING ${USER_COLUMNS}`,
    ).bind(newId(), username, name, salt, await hashSecret(c.env.PEPPER, salt, password), Date.now()).first<UserRow>();
    if (!row) return apiError(c, 409, 'username_taken', '這個帳號已存在');
    await audit(c, 'user_create', userLabel(row));
    const res: PasswordIssued = { user: toAccount(row), password };
    return c.json(res, 201);
  })
  .post('/users/:id/reset-password', requireAuth, requireUser(['admin']), async c => {
    const password = genPassword();
    const salt = newSalt();
    // session_ver + 1 讓舊 Cookie 失效，同時清除失敗次數與鎖定
    const row = await c.env.DB.prepare(
      `UPDATE users SET pwd_salt = ?, pwd_hash = ?, session_ver = session_ver + 1, fails = 0, lock_until = 0 WHERE id = ?
       RETURNING ${USER_COLUMNS}`,
    ).bind(salt, await hashSecret(c.env.PEPPER, salt, password), c.req.param('id')).first<UserRow>();
    if (!row) return apiError(c, 404, 'not_found', '找不到這個帳號');
    await audit(c, 'user_reset_password', userLabel(row));
    const res: PasswordIssued = { user: toAccount(row), password };
    return c.json(res);
  })
  .patch('/users/:id', requireAuth, requireUser(['admin']), async c => {
    const b = await c.req.json().catch(() => null);
    if (typeof b?.disabled !== 'boolean') return apiError(c, 400, 'bad_request', '請指定停用或啟用');
    const id = c.req.param('id');
    if (b.disabled && id === c.get('auth').id) return apiError(c, 400, 'cannot_disable_self', '不能停用自己的帳號');
    const row = await c.env.DB.prepare(
      b.disabled
        ? `UPDATE users SET disabled = 1, session_ver = session_ver + 1 WHERE id = ? RETURNING ${USER_COLUMNS}`
        : `UPDATE users SET disabled = 0 WHERE id = ? RETURNING ${USER_COLUMNS}`,
    ).bind(id).first<UserRow>();
    if (!row) return apiError(c, 404, 'not_found', '找不到這個帳號');
    await audit(c, b.disabled ? 'user_disable' : 'user_enable', userLabel(row));
    return c.json(toAccount(row));
  });
