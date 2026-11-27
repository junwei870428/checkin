import { describe, expect, it } from 'vitest';
import type { Me } from '../src/shared/types';
import { call, makeEnv, seedEvent, seedStaff, seedUser } from './helpers/d1';

describe('POST /api/auth/admin-login', () => {
  it('帳密正確時發 Cookie，帶著 Cookie 可讀 /api/me', async () => {
    const env = makeEnv();
    const admin = await seedUser(env, { username: 'boss', name: '系統管理員', role: 'admin' });
    const res = await call(env, 'POST', '/api/auth/admin-login', { body: { username: 'boss', password: admin.password } });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^ck_session=/);

    const me = await call<Me>(env, 'GET', '/api/me', { cookie });
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ type: 'user', id: admin.id, username: 'boss', name: '系統管理員', role: 'admin' });
  });

  it('密碼錯誤回 401 invalid，不發 Cookie', async () => {
    const env = makeEnv();
    await seedUser(env, { username: 'boss', role: 'admin' });
    const res = await call(env, 'POST', '/api/auth/admin-login', { body: { username: 'boss', password: 'wrong' } });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('invalid');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('缺少帳號或密碼回 400', async () => {
    const res = await call(makeEnv(), 'POST', '/api/auth/admin-login', { body: { username: 'boss' } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('bad_request');
  });
});

describe('GET /api/me', () => {
  it('沒有 Cookie 回 401', async () => {
    const res = await call(makeEnv(), 'GET', '/api/me');
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('unauthorized');
  });

  it('報到人員回傳所屬活動與依順序排列的關卡', async () => {
    const env = makeEnv();
    const owner = await seedUser(env);
    const ev = await seedEvent(env, { ownerId: owner.id, name: '聖誕晚會', code: 'XMAS' });
    const staff = await seedStaff(env, { eventId: ev.id, account: 'xmas-01' });
    const res = await call<Me>(env, 'GET', '/api/me', { cookie: staff.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      type: 'staff',
      account: 'XMAS-01',
      event: { id: ev.id, name: '聖誕晚會', rehearsal: false },
      stations: [
        { id: ev.stationIds[0], name: '入場報到', kind: 'checkin', requireCheckin: false },
        { id: ev.stationIds[1], name: '領取禮品', kind: 'gift', requireCheckin: true },
      ],
    });
  });

  it('活動已結束時報到人員被登出', async () => {
    const env = makeEnv();
    const owner = await seedUser(env);
    const ev = await seedEvent(env, { ownerId: owner.id, endAt: Date.now() - 1 });
    const staff = await seedStaff(env, { eventId: ev.id, account: 'END-01' });
    const res = await call(env, 'GET', '/api/me', { cookie: staff.cookie });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe('活動已結束，報到帳號已失效');
  });
});
