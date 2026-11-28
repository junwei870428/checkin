import { Hono } from 'hono';
import type { Me } from '../../shared/types';
import { writeAudit } from '../audit';
import { adminLogin, clearCookie, issueCookie, requireAuth, staffLogin } from '../auth';
import { apiError, type AppEnv } from '../env';

// 登入失敗一律回 401，前端依 error.code 與 message 顯示
const LOGIN_STATUS = { invalid: 401, locked: 401, disabled: 401, ended: 401 } as const;

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

export const authRoutes = new Hono<AppEnv>()
  .post('/auth/admin-login', async c => {
    const b = await c.req.json().catch(() => null);
    const username = str(b?.username, 64);
    const password = str(b?.password, 128);
    if (!username || !password) return apiError(c, 400, 'bad_request', '請輸入帳號與密碼');
    const r = await adminLogin(c.env, username.trim(), password, Date.now());
    if (!r.ok) return apiError(c, LOGIN_STATUS[r.code], r.code, r.message);
    await writeAudit(c.env.DB, r.payload.id, 'login');
    await issueCookie(c, r.payload);
    return c.json({ ok: true });
  })
  .post('/auth/staff-login', async c => {
    const b = await c.req.json().catch(() => null);
    const account = str(b?.account, 32);
    const pin = str(b?.pin, 6);
    if (!account || !pin || !/^\d{6}$/.test(pin)) return apiError(c, 400, 'bad_request', '請輸入報到帳號與 6 位數 PIN 碼');
    const r = await staffLogin(c.env, account, pin, Date.now());
    if (!r.ok) return apiError(c, LOGIN_STATUS[r.code], r.code, r.message);
    await issueCookie(c, r.payload);
    return c.json({ ok: true });
  })
  .post('/auth/logout', c => {
    clearCookie(c);
    return c.json({ ok: true });
  })
  .get('/me', requireAuth, async c => {
    const a = c.get('auth');
    if (a.t === 'u') {
      const u = await c.env.DB.prepare('SELECT id, username, name, role FROM users WHERE id = ?')
        .bind(a.id).first<{ id: string; username: string; name: string; role: 'admin' | 'organizer' }>();
      const me: Me = { type: 'user', ...u! };
      return c.json(me);
    }
    const [s, st] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT s.id, s.account, e.id AS event_id, e.name, e.start_at, e.end_at, e.rehearsal
           FROM staff_accounts s JOIN events e ON e.id = s.event_id WHERE s.id = ?`,
      ).bind(a.id),
      c.env.DB.prepare('SELECT id, name, kind, require_checkin FROM stations WHERE event_id = ? ORDER BY sort_order, rowid').bind(a.eventId),
    ]);
    const r = s.results[0] as { id: string; account: string; event_id: string; name: string; start_at: number; end_at: number; rehearsal: number };
    const me: Me = {
      type: 'staff',
      id: r.id,
      account: r.account,
      event: { id: r.event_id, name: r.name, startAt: r.start_at, endAt: r.end_at, rehearsal: r.rehearsal === 1 },
      stations: (st.results as Array<{ id: string; name: string; kind: 'checkin' | 'gift'; require_checkin: number }>).map(x => ({
        id: x.id, name: x.name, kind: x.kind, requireCheckin: x.require_checkin === 1,
      })),
    };
    return c.json(me);
  });
