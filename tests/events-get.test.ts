import { describe, expect, it } from 'vitest';
import type { EventDetail } from '../src/shared/event';
import { call, makeEnv, seedEvent, seedScan, seedStaff, seedUser } from './helpers/d1';

const START = Date.now() + 86_400_000;
const END = START + 3 * 3600_000;

async function setup() {
  const env = makeEnv();
  const owner = await seedUser(env);
  const ev = await seedEvent(env, {
    ownerId: owner.id,
    name: '聖誕晚會',
    code: 'XMAS',
    startAt: START,
    endAt: END,
    rehearsal: true,
    scope: { type: 'list' },
    members: ['001', '002', '999'],
  });
  await seedScan(env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '001' });
  return { env, owner, ev };
}

describe('GET /api/events/:id', () => {
  it('承辦人可讀自己的活動，回傳設定、關卡與刪除日期', async () => {
    const { env, owner, ev } = await setup();
    const res = await call<EventDetail>(env, 'GET', `/api/events/${ev.id}`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      id: ev.id,
      name: '聖誕晚會',
      code: 'XMAS',
      ownerId: owner.id,
      startAt: START,
      endAt: END,
      rehearsal: true,
      scope: { type: 'list' },
      memberCount: 3,
      stations: [
        { id: ev.stationIds[0], name: '入場報到', kind: 'checkin', requireCheckin: false, sortOrder: 0, passedCount: 1 },
        { id: ev.stationIds[1], name: '領取禮品', kind: 'gift', requireCheckin: true, sortOrder: 1, passedCount: 0 },
      ],
      deleteAt: END + 10 * 86_400_000,
    });
  });

  it('系統管理員可讀任何人的活動', async () => {
    const { env, ev } = await setup();
    const admin = await seedUser(env, { role: 'admin' });
    const res = await call<EventDetail>(env, 'GET', `/api/events/${ev.id}`, { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(ev.id);
  });

  it('其他承辦人的活動回 404，與不存在的活動相同', async () => {
    const { env, ev } = await setup();
    const other = await seedUser(env);
    for (const id of [ev.id, 'no-such-event']) {
      const res = await call(env, 'GET', `/api/events/${id}`, { cookie: other.cookie });
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ error: { code: 'not_found', message: '找不到這個活動' } });
    }
  });

  it('未登入回 401，報到人員回 403', async () => {
    const { env, ev } = await setup();
    expect((await call(env, 'GET', `/api/events/${ev.id}`)).status).toBe(401);
    const staff = await seedStaff(env, { eventId: ev.id, account: 'XMAS-01' });
    expect((await call(env, 'GET', `/api/events/${ev.id}`, { cookie: staff.cookie })).status).toBe(403);
  });
});
