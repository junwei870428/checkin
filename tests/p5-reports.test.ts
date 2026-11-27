import { describe, expect, it } from 'vitest';
import type { Scope } from '../src/shared/event';
import type { EventBreakdown, EventRoster, EventSummary } from '../src/shared/reports';
import { recalcStatements } from '../src/worker/counts';
import type { Bindings } from '../src/worker/env';
import { serializeScope } from '../src/worker/scope';
import { call, makeEnv, seedEmployees, seedEvent, seedScan, seedStaff, seedUser } from './helpers/d1';

const T = Date.now() - 1800_000;

async function setup(o: { startAt?: number; rehearsal?: boolean } = {}) {
  const env = makeEnv();
  await seedEmployees(env, [
    { empNo: '001', name: '王小明', plant: '台中廠', dept: '資訊室' },
    { empNo: '002', name: '李小華', plant: '台中廠', dept: '資訊室' },
    { empNo: '003', name: '陳大同', plant: '台中廠', dept: '人資室' },
    { empNo: '004', name: '林美玲', plant: '高雄廠', dept: '資訊室' },
    { empNo: '005', name: '張志明', plant: '高雄廠', dept: '資訊室', active: false },
  ]);
  const owner = await seedUser(env);
  const ev = await seedEvent(env, { ownerId: owner.id, ...o, endAt: Date.now() + 86_400_000 * 2 });
  const [checkin, gift] = ev.stationIds;
  const scan = (stationId: string, empNo: string, x: Partial<Parameters<typeof seedScan>[1]> = {}) =>
    seedScan(env, { eventId: ev.id, stationId, empNo, scannedAt: T, ...x });
  await scan(checkin, '001', { manual: true, byAccount: 'XMAS-02' });
  await scan(checkin, '002', { scannedAt: T + 1000 });
  await scan(checkin, '004');
  await scan(checkin, '005'); // 已停用的人不計入
  await scan(checkin, '003', { voided: true }); // 已撤銷不計入
  await scan(checkin, '003', { rehearsal: true }); // 演練紀錄不計入
  await scan(gift, '001');
  await recalc(env, ev.id, { type: 'all' });
  return { env, owner, ev, checkin, gift };
}

const recalc = (env: Bindings, eventId: string, scope: Scope) => env.DB.batch(recalcStatements(env.DB, eventId, scope));

const STATIONS = (checkin: string, gift: string) => [
  { id: checkin, name: '入場報到', kind: 'checkin' },
  { id: gift, name: '領取禮品', kind: 'gift' },
];

describe('GET /api/events/:id/summary', () => {
  it('回傳各關卡已通過人數；total=1 時另回傳範圍內在職人數', async () => {
    const { env, owner, ev, checkin, gift } = await setup();
    const res = await call<EventSummary>(env, 'GET', `/api/events/${ev.id}/summary`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ stations: STATIONS(checkin, gift).map((s, i) => ({ ...s, passed: [3, 1][i] })) });

    const withTotal = await call<EventSummary>(env, 'GET', `/api/events/${ev.id}/summary?total=1`, { cookie: owner.cookie });
    expect(withTotal.json.total).toBe(4);
    expect(withTotal.json.rehearsal).toBeUndefined();
  });

  it('演練模式中另回傳各關卡演練人數，不含已撤銷的演練紀錄', async () => {
    const { env, owner, ev, checkin, gift } = await setup({ startAt: Date.now() + 86_400_000, rehearsal: true });
    await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '004', rehearsal: true, voided: true });
    const res = await call<EventSummary>(env, 'GET', `/api/events/${ev.id}/summary`, { cookie: owner.cookie });
    expect(res.json.rehearsal).toEqual({ [checkin]: 1, [gift]: 0 });
  });

  it('尚未開始且沒開演練模式時不回傳演練人數', async () => {
    const { env, owner, ev } = await setup({ startAt: Date.now() + 86_400_000 });
    const res = await call<EventSummary>(env, 'GET', `/api/events/${ev.id}/summary`, { cookie: owner.cookie });
    expect(res.json.rehearsal).toBeUndefined();
  });

  it('total 不是 1 時回 400', async () => {
    const { env, owner, ev } = await setup();
    const res = await call(env, 'GET', `/api/events/${ev.id}/summary?total=yes`, { cookie: owner.cookie });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('bad_request');
  });
});

describe('GET /api/events/:id/breakdown', () => {
  it('依廠別、部門回傳應到與各關卡通過數，含廠別小計', async () => {
    const { env, owner, ev, checkin, gift } = await setup();
    const res = await call<EventBreakdown>(env, 'GET', `/api/events/${ev.id}/breakdown`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      stations: STATIONS(checkin, gift),
      plants: [
        {
          plant: '台中廠', expected: 3, passed: [2, 1],
          depts: [
            { dept: '人資室', expected: 1, passed: [0, 0] },
            { dept: '資訊室', expected: 2, passed: [2, 1] },
          ],
        },
        { plant: '高雄廠', expected: 1, passed: [1, 0], depts: [{ dept: '資訊室', expected: 1, passed: [1, 0] }] },
      ],
    });
  });

  it('範圍內沒有人時回傳空的廠別列表', async () => {
    const { env, owner } = await setup();
    const ev = await seedEvent(env, { ownerId: owner.id, scope: { type: 'list' } });
    const res = await call<EventBreakdown>(env, 'GET', `/api/events/${ev.id}/breakdown`, { cookie: owner.cookie });
    expect(res.json.plants).toEqual([]);
  });
});

describe('GET /api/events/:id/roster', () => {
  it('回傳範圍內在職人員與各關卡的正式通過紀錄，依廠別、部門、工號排序', async () => {
    const { env, owner, ev, checkin, gift } = await setup();
    const res = await call<EventRoster>(env, 'GET', `/api/events/${ev.id}/roster`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
    const pass = (at: number, by = 'TEST-01', manual = false) => ({ at, by, manual });
    expect(res.json).toEqual({
      stations: STATIONS(checkin, gift),
      people: [
        { empNo: '003', name: '陳大同', plant: '台中廠', dept: '人資室', passes: {} },
        { empNo: '001', name: '王小明', plant: '台中廠', dept: '資訊室', passes: { [checkin]: pass(T, 'XMAS-02', true), [gift]: pass(T) } },
        { empNo: '002', name: '李小華', plant: '台中廠', dept: '資訊室', passes: { [checkin]: pass(T + 1000) } },
        { empNo: '004', name: '林美玲', plant: '高雄廠', dept: '資訊室', passes: { [checkin]: pass(T) } },
      ],
    });
  });

  it('撤銷後重新通過的人只回傳未撤銷的那筆', async () => {
    const { env, owner, ev, checkin } = await setup();
    await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '003', scannedAt: T + 5000, byAccount: 'XMAS-03' });
    const res = await call<EventRoster>(env, 'GET', `/api/events/${ev.id}/roster`, { cookie: owner.cookie });
    expect(res.json.people.find(p => p.empNo === '003')?.passes).toEqual({ [checkin]: { at: T + 5000, by: 'XMAS-03', manual: false } });
  });
});

describe('三支報表 API 的人數一致', () => {
  async function report(env: Bindings, cookie: string, id: string) {
    const s = (await call<EventSummary>(env, 'GET', `/api/events/${id}/summary?total=1`, { cookie })).json;
    const b = (await call<EventBreakdown>(env, 'GET', `/api/events/${id}/breakdown`, { cookie })).json;
    const r = (await call<EventRoster>(env, 'GET', `/api/events/${id}/roster`, { cookie })).json;
    return {
      summary: { total: s.total, passed: s.stations.map(x => x.passed) },
      breakdown: {
        total: b.plants.reduce((n, p) => n + p.expected, 0),
        passed: b.stations.map((_, i) => b.plants.reduce((n, p) => n + p.passed[i], 0)),
      },
      roster: { total: r.people.length, passed: r.stations.map(st => r.people.filter(p => p.passes[st.id]).length) },
    };
  }

  it('已通過的人被移出範圍或停用後，重算人數，三者一致', async () => {
    const { env, owner, ev } = await setup();
    const before = await report(env, owner.cookie, ev.id);
    expect(before.summary).toEqual({ total: 4, passed: [3, 1] });
    expect(before.breakdown).toEqual(before.summary);
    expect(before.roster).toEqual(before.summary);

    // 001 兩關都通過後被停用；範圍改成只有台中廠，移出已報到的 004
    const scope: Scope = { type: 'plants', plants: ['台中廠'] };
    const { scope_type, scope_values } = serializeScope(scope);
    await env.DB.batch([
      env.DB.prepare("UPDATE employees SET active = 0 WHERE emp_no = '001'"),
      env.DB.prepare('UPDATE events SET scope_type = ?, scope_values = ? WHERE id = ?').bind(scope_type, scope_values, ev.id),
      ...recalcStatements(env.DB, ev.id, scope),
    ]);

    const after = await report(env, owner.cookie, ev.id);
    expect(after.summary).toEqual({ total: 2, passed: [1, 0] });
    expect(after.breakdown).toEqual(after.summary);
    expect(after.roster).toEqual(after.summary);
  });
});

describe.each(['summary', 'breakdown', 'roster'])('GET /api/events/:id/%s 權限', route => {
  it('系統管理員可讀任何人的活動', async () => {
    const { env, ev } = await setup();
    const admin = await seedUser(env, { role: 'admin' });
    expect((await call(env, 'GET', `/api/events/${ev.id}/${route}`, { cookie: admin.cookie })).status).toBe(200);
  });

  it('其他承辦人的活動與不存在的活動都回 404', async () => {
    const { env, ev } = await setup();
    const other = await seedUser(env);
    for (const id of [ev.id, 'no-such-event']) {
      const res = await call(env, 'GET', `/api/events/${id}/${route}`, { cookie: other.cookie });
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe('not_found');
    }
  });

  it('未登入回 401，報到人員回 403', async () => {
    const { env, ev } = await setup();
    expect((await call(env, 'GET', `/api/events/${ev.id}/${route}`)).status).toBe(401);
    const staff = await seedStaff(env, { eventId: ev.id, account: 'XMAS-01' });
    expect((await call(env, 'GET', `/api/events/${ev.id}/${route}`, { cookie: staff.cookie })).status).toBe(403);
  });
});
