import { describe, expect, it } from 'vitest';
import type { AuditLog } from '../src/shared/audit';
import { call, makeEnv, seedEvent, seedStaff, seedUser } from './helpers/d1';

async function setup() {
  const env = makeEnv();
  const admin = await seedUser(env, { username: 'boss', name: '管理員', role: 'admin' });
  const logs = async () => (await call<AuditLog[]>(env, 'GET', '/api/audit-logs', { cookie: admin.cookie })).json;
  return { env, admin, logs };
}

describe('操作紀錄', () => {
  it('登入成功記錄操作者，失敗不記錄', async () => {
    const { env, admin, logs } = await setup();
    await call(env, 'POST', '/api/auth/admin-login', { body: { username: 'boss', password: 'wrong' } });
    await call(env, 'POST', '/api/auth/admin-login', { body: { username: 'boss', password: admin.password } });
    expect(await logs()).toMatchObject([{ actor: '管理員（boss）', action: 'login', target: '' }]);
  });

  it('重設密碼與停用帳號記錄對象，新的排在前面', async () => {
    const { env, admin, logs } = await setup();
    const org = await seedUser(env, { username: 'org1', name: '福委會' });
    await call(env, 'POST', `/api/users/${org.id}/reset-password`, { cookie: admin.cookie });
    await call(env, 'PATCH', `/api/users/${org.id}`, { cookie: admin.cookie, body: { disabled: true } });
    expect((await logs()).map(l => [l.action, l.target])).toEqual([
      ['user_disable', '福委會（org1）'],
      ['user_reset_password', '福委會（org1）'],
    ]);
  });

  it('找不到對象的操作不記錄', async () => {
    const { env, admin, logs } = await setup();
    expect((await call(env, 'POST', '/api/users/nope/reset-password', { cookie: admin.cookie })).status).toBe(404);
    expect(await logs()).toEqual([]);
  });

  it('活動刪除後紀錄仍保留活動名稱，承辦人的操作記在承辦人名下', async () => {
    const { env, logs } = await setup();
    const org = await seedUser(env, { username: 'org1', name: '福委會' });
    const ev = await seedEvent(env, { ownerId: org.id, name: '尾牙', code: 'XMAS' });
    expect((await call(env, 'DELETE', `/api/events/${ev.id}`, { cookie: org.cookie })).status).toBe(200);
    expect(await logs()).toMatchObject([{ actor: '福委會（org1）', action: 'event_delete', target: '尾牙（XMAS）' }]);
  });

  it('報到帳號的產生與停用', async () => {
    const { env, admin, logs } = await setup();
    const ev = await seedEvent(env, { ownerId: admin.id, name: '尾牙', code: 'XMAS' });
    const st = await seedStaff(env, { eventId: ev.id, account: 'XMAS-01' });
    await call(env, 'POST', `/api/events/${ev.id}/staff`, { cookie: admin.cookie, body: { holders: ['甲', '乙', '丙'] } });
    await call(env, 'PATCH', `/api/staff/${st.id}`, { cookie: admin.cookie, body: { action: 'disable' } });
    expect((await logs()).map(l => [l.action, l.target])).toEqual([
      ['staff_disable', 'XMAS-01'],
      ['staff_create', '尾牙（XMAS）：3 組'],
    ]);
  });

  it('只有系統管理員能看', async () => {
    const { env } = await setup();
    const org = await seedUser(env);
    expect((await call(env, 'GET', '/api/audit-logs', { cookie: org.cookie })).status).toBe(403);
  });
});
