import { describe, expect, it } from 'vitest';
import type { PasswordIssued, UserAccount } from '../src/shared/employees';
import { PASSWORD_ALPHABET } from '../src/worker/crypto';
import type { Bindings } from '../src/worker/env';
import { call, makeEnv, seedUser } from './helpers/d1';

const login = (env: Bindings, username: string, password: string) =>
  call(env, 'POST', '/api/auth/admin-login', { body: { username, password } });

async function setup() {
  const env = makeEnv();
  const admin = await seedUser(env, { username: 'boss', name: '系統管理員', role: 'admin' });
  const organizer = await seedUser(env, { username: 'xmas', name: '彰化廠福委會', role: 'organizer' });
  return { env, admin, organizer };
}

describe('GET /api/users', () => {
  it('列出所有系統帳號，管理員在前，不含密碼雜湊', async () => {
    const { env, admin, organizer } = await setup();
    await seedUser(env, { username: 'old', role: 'organizer', disabled: true });
    const res = await call<UserAccount[]>(env, 'GET', '/api/users', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json.map(u => [u.username, u.role, u.disabled])).toEqual([
      ['boss', 'admin', false],
      ['xmas', 'organizer', false],
      ['old', 'organizer', true],
    ]);
    expect(res.json[1]).toEqual({ id: organizer.id, username: 'xmas', name: '彰化廠福委會', role: 'organizer', disabled: false, createdAt: expect.any(Number) });
  });

  it('承辦人回 403，未登入回 401', async () => {
    const { env, organizer } = await setup();
    expect((await call(env, 'GET', '/api/users', { cookie: organizer.cookie })).status).toBe(403);
    expect((await call(env, 'GET', '/api/users')).status).toBe(401);
  });
});

describe('POST /api/users', () => {
  it('建立承辦人並回傳一次性的 10 碼密碼，可用它登入', async () => {
    const { env, admin } = await setup();
    const res = await call<PasswordIssued>(env, 'POST', '/api/users', { cookie: admin.cookie, body: { username: ' santa ', name: ' 聖誕晚會小組 ' } });
    expect(res.status).toBe(201);
    expect(res.json.user).toEqual({ id: expect.any(String), username: 'santa', name: '聖誕晚會小組', role: 'organizer', disabled: false, createdAt: expect.any(Number) });
    expect(res.json.password).toHaveLength(10);
    expect([...res.json.password].every(ch => PASSWORD_ALPHABET.includes(ch))).toBe(true);
    expect((await login(env, 'santa', res.json.password)).status).toBe(200);
  });

  it('帳號已存在回 409', async () => {
    const { env, admin } = await setup();
    const res = await call(env, 'POST', '/api/users', { cookie: admin.cookie, body: { username: 'xmas', name: '別人' } });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('username_taken');
  });

  it('帳號或名稱不合格回 400', async () => {
    const { env, admin } = await setup();
    for (const body of [{ name: '小組' }, { username: 'a b', name: '小組' }, { username: 'x'.repeat(65), name: '小組' }, { username: 'ok', name: ' ' }]) {
      const res = await call(env, 'POST', '/api/users', { cookie: admin.cookie, body });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('bad_request');
    }
  });

  it('承辦人回 403', async () => {
    const { env, organizer } = await setup();
    const res = await call(env, 'POST', '/api/users', { cookie: organizer.cookie, body: { username: 'santa', name: '小組' } });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/reset-password', () => {
  it('回傳新密碼，舊密碼與舊 Cookie 立即失效，並解除鎖定', async () => {
    const { env, admin, organizer } = await setup();
    await env.DB.prepare('UPDATE users SET fails = 3, lock_until = ? WHERE id = ?').bind(Date.now() + 600_000, organizer.id).run();
    const res = await call<PasswordIssued>(env, 'POST', `/api/users/${organizer.id}/reset-password`, { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json.user.username).toBe('xmas');
    expect(res.json.password).toHaveLength(10);
    expect((await call(env, 'GET', '/api/me', { cookie: organizer.cookie })).status).toBe(401);
    expect((await login(env, 'xmas', organizer.password)).status).toBe(401);
    expect((await login(env, 'xmas', res.json.password)).status).toBe(200);
  });

  it('找不到帳號回 404', async () => {
    const { env, admin } = await setup();
    const res = await call(env, 'POST', '/api/users/no-such-user/reset-password', { cookie: admin.cookie });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('not_found');
  });

  it('承辦人回 403，密碼不變', async () => {
    const { env, admin, organizer } = await setup();
    const res = await call(env, 'POST', `/api/users/${admin.id}/reset-password`, { cookie: organizer.cookie });
    expect(res.status).toBe(403);
    expect((await login(env, 'boss', admin.password)).status).toBe(200);
  });
});

describe('PATCH /api/users/:id', () => {
  it('停用後舊 Cookie 立即失效、無法登入；啟用後可再登入', async () => {
    const { env, admin, organizer } = await setup();
    const off = await call<UserAccount>(env, 'PATCH', `/api/users/${organizer.id}`, { cookie: admin.cookie, body: { disabled: true } });
    expect(off.status).toBe(200);
    expect(off.json).toMatchObject({ id: organizer.id, disabled: true });
    expect((await call(env, 'GET', '/api/me', { cookie: organizer.cookie })).status).toBe(401);
    const denied = await login(env, 'xmas', organizer.password);
    expect(denied.status).toBe(401);
    expect(denied.json.error.code).toBe('disabled');

    const on = await call<UserAccount>(env, 'PATCH', `/api/users/${organizer.id}`, { cookie: admin.cookie, body: { disabled: false } });
    expect(on.json.disabled).toBe(false);
    expect((await login(env, 'xmas', organizer.password)).status).toBe(200);
  });

  it('不能停用自己', async () => {
    const { env, admin } = await setup();
    const res = await call(env, 'PATCH', `/api/users/${admin.id}`, { cookie: admin.cookie, body: { disabled: true } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('cannot_disable_self');
    expect((await call(env, 'GET', '/api/me', { cookie: admin.cookie })).status).toBe(200);
  });

  it('body 不合格回 400，找不到帳號回 404', async () => {
    const { env, admin, organizer } = await setup();
    const bad = await call(env, 'PATCH', `/api/users/${organizer.id}`, { cookie: admin.cookie, body: { disabled: 'yes' } });
    expect(bad.status).toBe(400);
    const missing = await call(env, 'PATCH', '/api/users/no-such-user', { cookie: admin.cookie, body: { disabled: true } });
    expect(missing.status).toBe(404);
  });

  it('承辦人回 403', async () => {
    const { env, admin, organizer } = await setup();
    const res = await call(env, 'PATCH', `/api/users/${admin.id}`, { cookie: organizer.cookie, body: { disabled: true } });
    expect(res.status).toBe(403);
  });
});
