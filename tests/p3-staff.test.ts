import { describe, expect, it } from 'vitest';
import type { StaffAccount, StaffSecret } from '../src/shared/events-admin';
import { call, makeEnv, seedEvent, seedStaff, seedUser } from './helpers/d1';

const HOUR = 3600_000;

async function setup(o: { endAt?: number } = {}) {
  const env = makeEnv();
  const owner = await seedUser(env);
  const other = await seedUser(env);
  const ev = await seedEvent(env, { ownerId: owner.id, code: 'XMAS', ...(o.endAt ? { startAt: o.endAt - 2 * HOUR, endAt: o.endAt } : {}) });
  return { env, owner, other, ev };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const list = async (s: Setup) => (await call<StaffAccount[]>(s.env, 'GET', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie })).json;
const login = (s: Setup, account: string, pin: string) => call(s.env, 'POST', '/api/auth/staff-login', { body: { account, pin } });

describe('POST /api/events/:id/staff', () => {
  it('批次產生帳號與 6 位數 PIN，PIN 可以直接登入（帳號不分大小寫）', async () => {
    const s = await setup();
    const res = await call<StaffSecret[]>(s.env, 'POST', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie, body: { count: 3 } });
    expect(res.status).toBe(201);
    expect(res.json.map(x => x.account)).toEqual(['XMAS-01', 'XMAS-02', 'XMAS-03']);
    for (const x of res.json) expect(x.pin).toMatch(/^\d{6}$/);
    expect((await login(s, 'xmas-02', res.json[1].pin)).status).toBe(200);
  });

  it('流水號接在目前最大號之後，超過 99 自然變成 3 位數', async () => {
    const s = await setup();
    for (const account of ['XMAS-01', 'XMAS-98']) await seedStaff(s.env, { eventId: s.ev.id, account });
    const res = await call<StaffSecret[]>(s.env, 'POST', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie, body: { count: 3 } });
    expect(res.json.map(x => x.account)).toEqual(['XMAS-99', 'XMAS-100', 'XMAS-101']);
    expect((await list(s)).map(x => x.account)).toEqual(['XMAS-01', 'XMAS-98', 'XMAS-99', 'XMAS-100', 'XMAS-101']);
  });

  it('一次可產生 50 組', async () => {
    const s = await setup();
    const res = await call<StaffSecret[]>(s.env, 'POST', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie, body: { count: 50 } });
    expect(res.status).toBe(201);
    expect(res.json.at(-1)!.account).toBe('XMAS-50');
    expect(await list(s)).toHaveLength(50);
  });

  it.each([0, 51, 2.5, '3'])('數量 %j 回 400', async count => {
    const s = await setup();
    const res = await call(s.env, 'POST', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie, body: { count } });
    expect(res.status).toBe(400);
    expect(await list(s)).toEqual([]);
  });

  it('活動已結束不能產生', async () => {
    const s = await setup({ endAt: Date.now() - HOUR });
    const res = await call(s.env, 'POST', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie, body: { count: 1 } });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe('活動已結束，報到人員帳號已失效');
  });

  it('其他承辦人的活動回 404', async () => {
    const s = await setup();
    const res = await call(s.env, 'POST', `/api/events/${s.ev.id}/staff`, { cookie: s.other.cookie, body: { count: 1 } });
    expect(res.status).toBe(404);
    expect(await list(s)).toEqual([]);
  });
});

describe('GET /api/events/:id/staff', () => {
  it('列出帳號狀態，不含 PIN 與雜湊', async () => {
    const s = await setup();
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01' });
    await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-02', disabled: true });
    const res = await call<StaffAccount[]>(s.env, 'GET', `/api/events/${s.ev.id}/staff`, { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json[0]).toEqual({ id: a.id, account: 'XMAS-01', disabled: false, lockUntil: 0 });
    expect(res.json[1].disabled).toBe(true);
  });

  it('其他承辦人的活動與不存在的活動回 404', async () => {
    const s = await setup();
    for (const id of [s.ev.id, 'no-such-event']) {
      expect((await call(s.env, 'GET', `/api/events/${id}/staff`, { cookie: s.other.cookie })).status).toBe(404);
    }
  });
});

describe('POST /api/staff/:id/reset-pin', () => {
  it('回傳新 PIN：新 PIN 可登入、舊 PIN 與舊登入失效，並清除鎖定', async () => {
    const s = await setup();
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01', pin: '111111' });
    await s.env.DB.prepare('UPDATE staff_accounts SET fails = 4, lock_until = ? WHERE id = ?').bind(Date.now() + HOUR, a.id).run();

    const res = await call<StaffSecret>(s.env, 'POST', `/api/staff/${a.id}/reset-pin`, { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: a.id, account: 'XMAS-01' });
    expect(res.json.pin).toMatch(/^\d{6}$/);
    expect((await list(s))[0].lockUntil).toBe(0);
    expect((await call(s.env, 'GET', '/api/me', { cookie: a.cookie })).status).toBe(401);
    if (res.json.pin !== '111111') expect((await login(s, 'XMAS-01', '111111')).status).toBe(401);
    expect((await login(s, 'XMAS-01', res.json.pin)).status).toBe(200);
  });

  it('其他承辦人的帳號與不存在的帳號回 404', async () => {
    const s = await setup();
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01', pin: '111111' });
    for (const id of [a.id, 'no-such-staff']) {
      const res = await call(s.env, 'POST', `/api/staff/${id}/reset-pin`, { cookie: s.other.cookie });
      expect(res.status).toBe(404);
      expect(res.json.error.message).toBe('找不到這個報到帳號');
    }
    expect((await login(s, 'XMAS-01', '111111')).status).toBe(200);
  });

  it('活動已結束回 400', async () => {
    const s = await setup({ endAt: Date.now() - HOUR });
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01' });
    expect((await call(s.env, 'POST', `/api/staff/${a.id}/reset-pin`, { cookie: s.owner.cookie })).status).toBe(400);
  });
});

describe('PATCH /api/staff/:id', () => {
  it('停用後舊登入立即失效、不能登入；啟用後可再登入', async () => {
    const s = await setup();
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01', pin: '111111' });
    const off = await call<StaffAccount>(s.env, 'PATCH', `/api/staff/${a.id}`, { cookie: s.owner.cookie, body: { action: 'disable' } });
    expect(off.status).toBe(200);
    expect(off.json).toEqual({ id: a.id, account: 'XMAS-01', disabled: true, lockUntil: 0 });
    expect((await call(s.env, 'GET', '/api/me', { cookie: a.cookie })).status).toBe(401);
    expect((await login(s, 'XMAS-01', '111111')).json.error.code).toBe('disabled');

    const on = await call<StaffAccount>(s.env, 'PATCH', `/api/staff/${a.id}`, { cookie: s.owner.cookie, body: { action: 'enable' } });
    expect(on.json.disabled).toBe(false);
    expect((await login(s, 'XMAS-01', '111111')).status).toBe(200);
  });

  it('解鎖後可立即登入', async () => {
    const s = await setup();
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01', pin: '111111' });
    await s.env.DB.prepare('UPDATE staff_accounts SET lock_until = ? WHERE id = ?').bind(Date.now() + HOUR, a.id).run();
    expect((await login(s, 'XMAS-01', '111111')).json.error.code).toBe('locked');
    const res = await call<StaffAccount>(s.env, 'PATCH', `/api/staff/${a.id}`, { cookie: s.owner.cookie, body: { action: 'unlock' } });
    expect(res.json.lockUntil).toBe(0);
    expect((await login(s, 'XMAS-01', '111111')).status).toBe(200);
  });

  it('不明的操作回 400，其他承辦人的帳號回 404', async () => {
    const s = await setup();
    const a = await seedStaff(s.env, { eventId: s.ev.id, account: 'XMAS-01' });
    expect((await call(s.env, 'PATCH', `/api/staff/${a.id}`, { cookie: s.owner.cookie, body: { action: 'delete' } })).status).toBe(400);
    expect((await call(s.env, 'PATCH', `/api/staff/${a.id}`, { cookie: s.other.cookie, body: { action: 'disable' } })).status).toBe(404);
    expect((await list(s))[0].disabled).toBe(false);
  });
});
