// Cookie 簽章、登入、失敗鎖定與登入檢查 middleware（規劃書第 8 節）

import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { b64urlDecode, b64urlEncode, hashSecret, hmacSha256, timingSafeEqual, verifySecret } from './crypto';
import { apiError, type AppEnv, type Bindings } from './env';

export const COOKIE_NAME = 'ck_session';
export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60_000;
export const USER_SESSION_MS = 12 * 3600_000;
export const STAFF_SESSION_MS = 24 * 3600_000;

export interface SessionPayload {
  t: 'u' | 's';
  id: string;
  ver: number;
  exp: number;
}

/* ---------- 簽章 Cookie ---------- */

export async function signSession(secret: string, p: SessionPayload): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(p)));
  const sig = b64urlEncode(await hmacSha256(secret, body));
  return `${body}.${sig}`;
}

export async function verifySession(secret: string, token: string | undefined, now: number): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = b64urlEncode(await hmacSha256(secret, body));
  if (!timingSafeEqual(sig, expected)) return null;
  const raw = b64urlDecode(body);
  if (!raw) return null;
  let p: SessionPayload;
  try {
    p = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if ((p.t !== 'u' && p.t !== 's') || typeof p.id !== 'string' || typeof p.ver !== 'number' || typeof p.exp !== 'number') return null;
  if (p.exp <= now) return null;
  return p;
}

/* ---------- 失敗鎖定 ---------- */

/** 輸錯一次後的新狀態：第 5 次鎖定 15 分鐘並把次數歸零 */
export function nextFailState(fails: number, now: number): { fails: number; lockUntil: number; locked: boolean } {
  const n = fails + 1;
  if (n >= MAX_FAILS) return { fails: 0, lockUntil: now + LOCK_MS, locked: true };
  return { fails: n, lockUntil: 0, locked: false };
}

const taipeiTime = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtTaipeiTime = (t: number) => taipeiTime.format(new Date(t));

/* ---------- 登入 ---------- */

export type LoginResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; code: 'invalid' | 'locked' | 'disabled' | 'ended'; message: string };

interface Credential {
  id: string;
  salt: string;
  hash: string;
  disabled: number;
  fails: number;
  lock_until: number;
  session_ver: number;
}

// 帳號不存在時仍計算一次雜湊，讓回應時間與帳號存在時相近
const DUMMY_SALT = '00000000000000000000000000000000';

async function checkCredential(
  env: Bindings,
  table: 'users' | 'staff_accounts',
  row: Credential | null,
  secret: string,
  now: number,
  invalidMessage: string,
): Promise<{ ok: true; row: Credential } | Extract<LoginResult, { ok: false }>> {
  if (!row) {
    await hashSecret(env.PEPPER, DUMMY_SALT, secret);
    return { ok: false, code: 'invalid', message: invalidMessage };
  }
  if (row.lock_until > now) {
    return { ok: false, code: 'locked', message: `此帳號已鎖定，請於 ${fmtTaipeiTime(row.lock_until)} 後再試` };
  }
  if (!(await verifySecret(env.PEPPER, row.salt, secret, row.hash))) {
    const s = nextFailState(row.fails, now);
    await env.DB.prepare(`UPDATE ${table} SET fails = ?, lock_until = ? WHERE id = ?`).bind(s.fails, s.lockUntil, row.id).run();
    if (s.locked) return { ok: false, code: 'locked', message: `輸入錯誤次數過多，此帳號已鎖定至 ${fmtTaipeiTime(s.lockUntil)}` };
    return { ok: false, code: 'invalid', message: invalidMessage };
  }
  if (row.fails !== 0 || row.lock_until !== 0) {
    await env.DB.prepare(`UPDATE ${table} SET fails = 0, lock_until = 0 WHERE id = ?`).bind(row.id).run();
  }
  return { ok: true, row };
}

export async function adminLogin(env: Bindings, username: string, password: string, now: number): Promise<LoginResult> {
  const row = await env.DB.prepare(
    'SELECT id, pwd_salt AS salt, pwd_hash AS hash, disabled, fails, lock_until, session_ver FROM users WHERE username = ?',
  ).bind(username).first<Credential>();
  const r = await checkCredential(env, 'users', row, password, now, '帳號或密碼錯誤');
  if (!r.ok) return r;
  if (r.row.disabled) return { ok: false, code: 'disabled', message: '此帳號已停用' };
  return { ok: true, payload: { t: 'u', id: r.row.id, ver: r.row.session_ver, exp: now + USER_SESSION_MS } };
}

export async function staffLogin(env: Bindings, account: string, pin: string, now: number): Promise<LoginResult> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.pin_salt AS salt, s.pin_hash AS hash, s.disabled, s.fails, s.lock_until, s.session_ver, e.end_at
       FROM staff_accounts s JOIN events e ON e.id = s.event_id WHERE s.account = ?`,
  ).bind(account.trim().toUpperCase()).first<Credential & { end_at: number }>();
  const r = await checkCredential(env, 'staff_accounts', row, pin, now, '帳號或 PIN 碼錯誤');
  if (!r.ok) return r.code === 'locked' ? { ...r, message: `${r.message}，或請活動承辦人解鎖` } : r;
  if (r.row.disabled) return { ok: false, code: 'disabled', message: '此帳號已停用，請洽活動承辦人' };
  const endAt = row!.end_at;
  if (endAt <= now) return { ok: false, code: 'ended', message: '活動已結束，報到帳號已失效' };
  return { ok: true, payload: { t: 's', id: r.row.id, ver: r.row.session_ver, exp: Math.min(endAt, now + STAFF_SESSION_MS) } };
}

export async function issueCookie(c: Parameters<MiddlewareHandler<AppEnv>>[0], p: SessionPayload) {
  setCookie(c, COOKIE_NAME, await signSession(c.env.SESSION_SECRET, p), {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    expires: new Date(p.exp),
  });
}

export function clearCookie(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });
}

/* ---------- 登入檢查 middleware ---------- */

/** 驗證簽章後，以主鍵讀一次帳號，確認未停用、session_ver 相符；報到人員另確認活動未結束 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const now = Date.now();
  const p = await verifySession(c.env.SESSION_SECRET, getCookie(c, COOKIE_NAME), now);
  const unauth = (message = '請重新登入') => {
    clearCookie(c);
    return apiError(c, 401, 'unauthorized', message);
  };
  if (!p) return unauth();
  if (p.t === 'u') {
    const u = await c.env.DB.prepare('SELECT role, disabled, session_ver FROM users WHERE id = ?')
      .bind(p.id).first<{ role: 'admin' | 'organizer'; disabled: number; session_ver: number }>();
    if (!u || u.disabled || u.session_ver !== p.ver) return unauth();
    c.set('auth', { t: 'u', id: p.id, role: u.role });
  } else {
    const s = await c.env.DB.prepare(
      'SELECT s.event_id, s.disabled, s.session_ver, e.end_at FROM staff_accounts s JOIN events e ON e.id = s.event_id WHERE s.id = ?',
    ).bind(p.id).first<{ event_id: string; disabled: number; session_ver: number; end_at: number }>();
    if (!s || s.disabled || s.session_ver !== p.ver) return unauth();
    if (s.end_at <= now) return unauth('活動已結束，報到帳號已失效');
    c.set('auth', { t: 's', id: p.id, eventId: s.event_id });
  }
  await next();
};

export function requireUser(roles: Array<'admin' | 'organizer'> = ['admin', 'organizer']): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const a = c.get('auth');
    if (a.t !== 'u' || !roles.includes(a.role)) return apiError(c, 403, 'forbidden', '沒有權限');
    await next();
  };
}

export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('auth').t !== 's') return apiError(c, 403, 'forbidden', '沒有權限');
  await next();
};
