import { describe, expect, it } from 'vitest';
import type { EventDetail } from '../src/shared/event';
import { scopeCount, type EventListItem, type MembersResult, type ScopeOptions } from '../src/shared/events-admin';
import { call, makeEnv, seedEmployees, seedEvent, seedScan, seedStaff, seedUser } from './helpers/d1';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const EMPLOYEES = [
  { empNo: '001', plant: '台中廠', dept: '資訊室' },
  { empNo: '002', plant: '台中廠', dept: '人資室' },
  { empNo: '003', plant: '高雄廠', dept: '資訊室' },
  { empNo: '004', plant: '台中廠', dept: '資訊室', active: false },
  { empNo: '005', plant: '台北廠', dept: '業務部' },
];

async function setup() {
  const env = makeEnv();
  await seedEmployees(env, EMPLOYEES);
  const owner = await seedUser(env);
  const other = await seedUser(env);
  const admin = await seedUser(env, { role: 'admin' });
  return { env, owner, other, admin };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const detail = async (s: Setup, id: string) => (await call<EventDetail>(s.env, 'GET', `/api/events/${id}`, { cookie: s.owner.cookie })).json;

/** 依目前設定組出 PUT 的 body，再套上要改的部分 */
async function putBody(s: Setup, id: string, patch: Record<string, unknown> = {}) {
  const d = await detail(s, id);
  return {
    name: d.name,
    startAt: d.startAt,
    endAt: d.endAt,
    scope: d.scope,
    stations: d.stations.map(x => ({ id: x.id, name: x.name, requireCheckin: x.requireCheckin })),
    ...patch,
  };
}

const passed = async (s: Setup, id: string) => (await detail(s, id)).stations.map(x => x.passedCount);

describe('GET /api/events', () => {
  it('承辦人只看到自己的活動，含各關卡已通過人數與範圍內在職人數', async () => {
    const s = await setup();
    const mine = await seedEvent(s.env, { ownerId: s.owner.id, code: 'MINE', scope: { type: 'plants', plants: ['台中廠'] } });
    await seedEvent(s.env, { ownerId: s.other.id, code: 'OTHER' });
    await seedScan(s.env, { eventId: mine.id, stationId: mine.stationIds[0], empNo: '001' });

    const res = await call<EventListItem[]>(s.env, 'GET', '/api/events', { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toHaveLength(1);
    const [e] = res.json;
    expect(e.code).toBe('MINE');
    expect(e.total).toBe(2); // 台中廠在職：001、002
    expect(e.deleteAt).toBe(e.endAt + 10 * DAY);
    expect(e.stations).toEqual([
      { id: mine.stationIds[0], name: '入場報到', kind: 'checkin', passedCount: 1 },
      { id: mine.stationIds[1], name: '領取禮品', kind: 'gift', passedCount: 0 },
    ]);
  });

  it('系統管理員看到全部活動，依開始時間新到舊', async () => {
    const s = await setup();
    const now = Date.now();
    await seedEvent(s.env, { ownerId: s.owner.id, code: 'OLD', startAt: now - 2 * HOUR, endAt: now + HOUR });
    await seedEvent(s.env, { ownerId: s.other.id, code: 'NEW', startAt: now + DAY, endAt: now + DAY + HOUR, scope: { type: 'list' }, members: ['001', '004', '999'] });
    const res = await call<EventListItem[]>(s.env, 'GET', '/api/events', { cookie: s.admin.cookie });
    expect(res.json.map(e => [e.code, e.total])).toEqual([['NEW', 1], ['OLD', 4]]);
  });

  it('未登入回 401，報到人員回 403', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    expect((await call(s.env, 'GET', '/api/events')).status).toBe(401);
    const staff = await seedStaff(s.env, { eventId: ev.id, account: `${ev.code}-01` });
    expect((await call(s.env, 'GET', '/api/events', { cookie: staff.cookie })).status).toBe(403);
  });
});

describe('POST /api/events', () => {
  const body = () => ({ name: ' 2027 春酒 ', code: 'spring', startAt: Date.now() + DAY, endAt: Date.now() + DAY + 4 * HOUR });

  it('建立活動，代碼轉大寫，範圍為全公司，並產生兩個預設關卡', async () => {
    const s = await setup();
    const b = body();
    const res = await call<{ id: string }>(s.env, 'POST', '/api/events', { cookie: s.owner.cookie, body: b });
    expect(res.status).toBe(201);
    const d = await detail(s, res.json.id);
    expect(d).toMatchObject({
      name: '2027 春酒', code: 'SPRING', ownerId: s.owner.id, startAt: b.startAt, endAt: b.endAt,
      rehearsal: false, scope: { type: 'all' }, memberCount: 0,
    });
    expect(d.stations.map(x => [x.name, x.kind, x.requireCheckin, x.sortOrder])).toEqual([
      ['入場報到', 'checkin', false, 0],
      ['領取禮品', 'gift', true, 1],
    ]);
  });

  it('代碼已被使用時回 400 並說明', async () => {
    const s = await setup();
    await seedEvent(s.env, { ownerId: s.other.id, code: 'SPRING' });
    const res = await call(s.env, 'POST', '/api/events', { cookie: s.owner.cookie, body: body() });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('code_taken');
    expect(res.json.error.message).toContain('SPRING');
  });

  it('同時建立同一代碼時，後到的一筆由唯一索引擋下並回 400', async () => {
    const s = await setup();
    await seedEvent(s.env, { ownerId: s.other.id, code: 'SPRING' });
    // 模擬兩個請求都通過事前檢查：讓代碼檢查查不到既有活動
    const prepare = s.env.DB.prepare.bind(s.env.DB);
    s.env.DB.prepare = ((sql: string) =>
      prepare(sql.startsWith('SELECT 1 FROM events WHERE code') ? 'SELECT 1 WHERE ? IS NULL AND 0' : sql)) as typeof s.env.DB.prepare;
    const res = await call(s.env, 'POST', '/api/events', { cookie: s.owner.cookie, body: body() });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('code_taken');
    s.env.DB.prepare = prepare;
    expect(await s.env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE code = 'SPRING'").first('n')).toBe(1);
  });

  it.each([
    ['代碼太短', { code: 'A' }],
    ['代碼太長', { code: 'ABCDEFGHI' }],
    ['代碼含符號', { code: 'XM-AS' }],
    ['名稱空白', { name: '  ' }],
    ['結束早於開始', { endAt: Date.now() + HOUR }],
    ['結束時間已過', { startAt: Date.now() - 2 * HOUR, endAt: Date.now() - HOUR }],
    ['時間不是數字', { startAt: '明天' }],
  ])('%s回 400', async (_, patch) => {
    const s = await setup();
    const res = await call(s.env, 'POST', '/api/events', { cookie: s.owner.cookie, body: { ...body(), ...patch } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('bad_request');
    expect((await call<EventListItem[]>(s.env, 'GET', '/api/events', { cookie: s.owner.cookie })).json).toEqual([]);
  });
});

describe('PUT /api/events/:id', () => {
  it('改名稱、時間與關卡：修改、新增領取關卡、刪除沒有紀錄的關卡', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, {
      ownerId: s.owner.id,
      stations: [{ name: '入場報到', kind: 'checkin' }, { name: '領取禮品', kind: 'gift', requireCheckin: true }, { name: '摸彩券', kind: 'gift' }],
    });
    const [checkin, gift] = ev.stationIds;
    const startAt = Date.now() - HOUR;
    const endAt = Date.now() + 5 * HOUR;
    const res = await call(s.env, 'PUT', `/api/events/${ev.id}`, {
      cookie: s.owner.cookie,
      body: await putBody(s, ev.id, {
        name: '新名稱',
        startAt,
        endAt,
        stations: [
          { id: gift, name: '領取禮品', requireCheckin: false },
          { id: checkin, name: '報到', requireCheckin: true },
          { name: '領取紀念品', requireCheckin: true },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const d = await detail(s, ev.id);
    expect(d).toMatchObject({ name: '新名稱', startAt, endAt });
    expect(d.stations.map(x => [x.name, x.kind, x.requireCheckin, x.sortOrder])).toEqual([
      ['領取禮品', 'gift', false, 0],
      ['報到', 'checkin', false, 1], // 入場報到關卡不會需要先報到
      ['領取紀念品', 'gift', true, 2],
    ]);
    expect(d.stations.map(x => x.id).slice(0, 2)).toEqual([gift, checkin]);
  });

  it('修改範圍後重新計算已通過人數', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    for (const empNo of ['001', '002', '003']) await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[0], empNo });
    expect(await passed(s, ev.id)).toEqual([3, 0]);
    const res = await call(s.env, 'PUT', `/api/events/${ev.id}`, {
      cookie: s.owner.cookie,
      body: await putBody(s, ev.id, { scope: { type: 'depts', depts: [['台中廠', '資訊室'], ['高雄廠', '資訊室'], ['台中廠', '資訊室']] } }),
    });
    expect(res.status).toBe(200);
    const d = await detail(s, ev.id);
    expect(d.scope).toEqual({ type: 'depts', depts: [['台中廠', '資訊室'], ['高雄廠', '資訊室']] });
    expect(d.stations.map(x => x.passedCount)).toEqual([2, 0]);
  });

  it('刪除入場報到關卡回 400，整個請求不寫入', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    const body = await putBody(s, ev.id, { name: '不該被存', stations: [{ id: ev.stationIds[1], name: '領取禮品', requireCheckin: true }] });
    const res = await call(s.env, 'PUT', `/api/events/${ev.id}`, { cookie: s.owner.cookie, body });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe('入場報到關卡不能刪除');
    const d = await detail(s, ev.id);
    expect(d.name).not.toBe('不該被存');
    expect(d.stations).toHaveLength(2);
  });

  it.each([
    ['已撤銷', { voided: true }],
    ['演練', { rehearsal: true }],
  ])('關卡只有%s紀錄也不能刪除', async (_, scan) => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[1], empNo: '001', ...scan });
    const body = await putBody(s, ev.id, { name: '不該被存', stations: [{ id: ev.stationIds[0], name: '入場報到', requireCheckin: false }] });
    const res = await call(s.env, 'PUT', `/api/events/${ev.id}`, { cookie: s.owner.cookie, body });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe('「領取禮品」已有掃描紀錄，不能刪除');
    expect((await detail(s, ev.id)).stations).toHaveLength(2);
  });

  it('活動已結束：不能改時間，名稱與關卡名稱仍可改', async () => {
    const s = await setup();
    const now = Date.now();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, startAt: now - 3 * HOUR, endAt: now - HOUR });
    const moved = await call(s.env, 'PUT', `/api/events/${ev.id}`, { cookie: s.owner.cookie, body: await putBody(s, ev.id, { endAt: now + HOUR }) });
    expect(moved.status).toBe(400);
    expect(moved.json.error.message).toBe('活動已結束，開始與結束時間不能再修改');
    const renamed = await call(s.env, 'PUT', `/api/events/${ev.id}`, {
      cookie: s.owner.cookie,
      body: await putBody(s, ev.id, {
        name: '已結束的活動',
        stations: [{ id: ev.stationIds[0], name: '進場', requireCheckin: false }, { id: ev.stationIds[1], name: '禮品', requireCheckin: true }],
      }),
    });
    expect(renamed.status).toBe(200);
    const d = await detail(s, ev.id);
    expect(d.name).toBe('已結束的活動');
    expect(d.endAt).toBe(now - HOUR);
    expect(d.stations.map(x => x.name)).toEqual(['進場', '禮品']);
  });

  it.each([
    ['範圍類型不明', { scope: { type: 'company' } }],
    ['指定廠別但沒選', { scope: { type: 'plants', plants: [] } }],
    ['部門不是成對', { scope: { type: 'depts', depts: [['資訊室']] } }],
    ['關卡名稱空白', { stations: [{ name: ' ', requireCheckin: false }] }],
    ['結束早於開始', { endAt: 1 }],
  ])('%s回 400', async (_, patch) => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    const res = await call(s.env, 'PUT', `/api/events/${ev.id}`, { cookie: s.owner.cookie, body: await putBody(s, ev.id, patch) });
    expect(res.status).toBe(400);
  });

  it('帶入其他活動的關卡 id 回 400', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    const another = await seedEvent(s.env, { ownerId: s.owner.id });
    const body = await putBody(s, ev.id);
    body.stations.push({ id: another.stationIds[1], name: '偷渡', requireCheckin: false });
    const res = await call(s.env, 'PUT', `/api/events/${ev.id}`, { cookie: s.owner.cookie, body });
    expect(res.status).toBe(400);
    expect((await detail(s, another.id)).stations[1].name).toBe('領取禮品');
  });

  it('其他承辦人的活動與不存在的活動回 404', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    const body = await putBody(s, ev.id, { name: '被改了' });
    for (const id of [ev.id, 'no-such-event']) {
      const res = await call(s.env, 'PUT', `/api/events/${id}`, { cookie: s.other.cookie, body });
      expect(res.status).toBe(404);
    }
    expect((await detail(s, ev.id)).name).not.toBe('被改了');
  });
});

describe('POST /api/events/:id/members', () => {
  it('取代名單、去除重複，回傳不在員工資料中的工號並重新計算人數', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, scope: { type: 'list' }, members: ['001', '002', '003'] });
    for (const empNo of ['001', '002']) await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[0], empNo });
    expect(await passed(s, ev.id)).toEqual([2, 0]);

    const res = await call<MembersResult>(s.env, 'POST', `/api/events/${ev.id}/members`, {
      cookie: s.owner.cookie,
      body: { empNos: ['002', ' 004 ', '002', '999', '', '888'] },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ count: 4, unknown: ['888', '999'], active: 1 });
    expect((await detail(s, ev.id)).memberCount).toBe(4);
    expect(await passed(s, ev.id)).toEqual([1, 0]); // 001 已不在名單
  });

  it.each([
    ['不是陣列', { empNos: '001' }],
    ['工號不是字串', { empNos: [1] }],
    ['超過上限', { empNos: Array.from({ length: 5001 }, (_, i) => String(i)) }],
  ])('%s回 400', async (_, body) => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, scope: { type: 'list' }, members: ['001'] });
    const res = await call(s.env, 'POST', `/api/events/${ev.id}/members`, { cookie: s.owner.cookie, body });
    expect(res.status).toBe(400);
    expect((await detail(s, ev.id)).memberCount).toBe(1);
  });

  it('其他承辦人的活動回 404', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, scope: { type: 'list' }, members: ['001'] });
    const res = await call(s.env, 'POST', `/api/events/${ev.id}/members`, { cookie: s.other.cookie, body: { empNos: [] } });
    expect(res.status).toBe(404);
    expect((await detail(s, ev.id)).memberCount).toBe(1);
  });
});

describe('POST /api/events/:id/rehearsal', () => {
  it('尚未開始時可開啟與關閉', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, startAt: Date.now() + DAY, endAt: Date.now() + DAY + HOUR });
    for (const on of [true, false]) {
      const res = await call(s.env, 'POST', `/api/events/${ev.id}/rehearsal`, { cookie: s.owner.cookie, body: { on } });
      expect(res.status).toBe(200);
      expect((await detail(s, ev.id)).rehearsal).toBe(on);
    }
  });

  it('活動已開始或已結束時回 400', async () => {
    const s = await setup();
    const now = Date.now();
    const live = await seedEvent(s.env, { ownerId: s.owner.id });
    const ended = await seedEvent(s.env, { ownerId: s.owner.id, startAt: now - 2 * HOUR, endAt: now - HOUR });
    for (const [ev, message] of [[live, '活動已開始，不能切換演練模式'], [ended, '活動已結束，不能切換演練模式']] as const) {
      const res = await call(s.env, 'POST', `/api/events/${ev.id}/rehearsal`, { cookie: s.owner.cookie, body: { on: true } });
      expect(res.status).toBe(400);
      expect(res.json.error.message).toBe(message);
      expect((await detail(s, ev.id)).rehearsal).toBe(false);
    }
  });

  it('沒有指定 on 回 400，其他承辦人的活動回 404', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, startAt: Date.now() + DAY, endAt: Date.now() + DAY + HOUR });
    expect((await call(s.env, 'POST', `/api/events/${ev.id}/rehearsal`, { cookie: s.owner.cookie, body: { on: 'yes' } })).status).toBe(400);
    expect((await call(s.env, 'POST', `/api/events/${ev.id}/rehearsal`, { cookie: s.other.cookie, body: { on: true } })).status).toBe(404);
  });
});

describe('POST /api/events/:id/close', () => {
  it('立即結束：結束時間設為現在，報到人員帳號馬上失效', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    const staff = await seedStaff(s.env, { eventId: ev.id, account: `${ev.code}-01` });
    expect((await call(s.env, 'GET', '/api/me', { cookie: staff.cookie })).status).toBe(200);

    const before = Date.now();
    const res = await call<{ endAt: number }>(s.env, 'POST', `/api/events/${ev.id}/close`, { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    const d = await detail(s, ev.id);
    expect(d.endAt).toBeGreaterThanOrEqual(before);
    expect(d.endAt).toBeLessThanOrEqual(Date.now());
    const me = await call(s.env, 'GET', '/api/me', { cookie: staff.cookie });
    expect(me.status).toBe(401);
    expect(me.json.error.message).toBe('活動已結束，報到帳號已失效');
  });

  it('尚未開始就結束時，開始時間不會晚於結束時間', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, startAt: Date.now() + DAY, endAt: Date.now() + DAY + HOUR });
    expect((await call(s.env, 'POST', `/api/events/${ev.id}/close`, { cookie: s.owner.cookie })).status).toBe(200);
    const d = await detail(s, ev.id);
    expect(d.startAt).toBeLessThanOrEqual(d.endAt);
  });

  it('已結束回 400，其他承辦人的活動回 404', async () => {
    const s = await setup();
    const now = Date.now();
    const ended = await seedEvent(s.env, { ownerId: s.owner.id, startAt: now - 2 * HOUR, endAt: now - HOUR });
    expect((await call(s.env, 'POST', `/api/events/${ended.id}/close`, { cookie: s.owner.cookie })).status).toBe(400);
    const live = await seedEvent(s.env, { ownerId: s.owner.id });
    expect((await call(s.env, 'POST', `/api/events/${live.id}/close`, { cookie: s.other.cookie })).status).toBe(404);
    expect((await detail(s, live.id)).endAt).toBeGreaterThan(Date.now());
  });
});

describe('POST /api/events/:id/clear-rehearsal', () => {
  it('只刪除演練紀錄並關閉演練模式，正式紀錄保留', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, startAt: Date.now() + DAY, endAt: Date.now() + DAY + HOUR, rehearsal: true });
    await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '001', rehearsal: true });
    await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[1], empNo: '001', rehearsal: true, voided: true });
    await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '002' });

    const res = await call<{ deleted: number }>(s.env, 'POST', `/api/events/${ev.id}/clear-rehearsal`, { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json.deleted).toBe(2);
    expect((await detail(s, ev.id)).rehearsal).toBe(false);
    const left = await s.env.DB.prepare('SELECT emp_no, rehearsal FROM scans WHERE event_id = ?').bind(ev.id).all();
    expect(left.results).toEqual([{ emp_no: '002', rehearsal: 0 }]);
  });

  it('其他承辦人的活動回 404，紀錄不動', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, startAt: Date.now() + DAY, endAt: Date.now() + DAY + HOUR, rehearsal: true });
    await seedScan(s.env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '001', rehearsal: true });
    expect((await call(s.env, 'POST', `/api/events/${ev.id}/clear-rehearsal`, { cookie: s.other.cookie })).status).toBe(404);
    expect((await detail(s, ev.id)).rehearsal).toBe(true);
  });
});

describe('DELETE /api/events/:id', () => {
  const countRows = async (s: Setup, eventId: string) => {
    const out: Record<string, number> = {};
    for (const t of ['scans', 'staff_accounts', 'event_members', 'stations']) {
      out[t] = (await s.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE event_id = ?`).bind(eventId).first<{ n: number }>())!.n;
    }
    return out;
  };

  it('連同名單、帳號、關卡與紀錄一起刪除，其他活動不受影響', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, scope: { type: 'list' }, members: ['001'] });
    const keep = await seedEvent(s.env, { ownerId: s.owner.id, scope: { type: 'list' }, members: ['001'] });
    for (const e of [ev, keep]) {
      await seedStaff(s.env, { eventId: e.id, account: `${e.code}-01` });
      await seedScan(s.env, { eventId: e.id, stationId: e.stationIds[0], empNo: '001' });
    }
    const res = await call(s.env, 'DELETE', `/api/events/${ev.id}`, { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    expect((await call(s.env, 'GET', `/api/events/${ev.id}`, { cookie: s.owner.cookie })).status).toBe(404);
    expect(await countRows(s, ev.id)).toEqual({ scans: 0, staff_accounts: 0, event_members: 0, stations: 0 });
    expect(await countRows(s, keep.id)).toEqual({ scans: 1, staff_accounts: 1, event_members: 1, stations: 2 });
  });

  it('其他承辦人的活動與不存在的活動回 404', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    for (const id of [ev.id, 'no-such-event']) {
      expect((await call(s.env, 'DELETE', `/api/events/${id}`, { cookie: s.other.cookie })).status).toBe(404);
    }
    expect((await call(s.env, 'GET', `/api/events/${ev.id}`, { cookie: s.owner.cookie })).status).toBe(200);
  });
});

describe('GET /api/scope-options', () => {
  it('回傳在職員工依廠別、部門分組的人數', async () => {
    const s = await setup();
    const res = await call<ScopeOptions>(s.env, 'GET', '/api/scope-options', { cookie: s.owner.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      groups: [
        { plant: '台中廠', dept: '人資室', count: 1 },
        { plant: '台中廠', dept: '資訊室', count: 1 },
        { plant: '台北廠', dept: '業務部', count: 1 },
        { plant: '高雄廠', dept: '資訊室', count: 1 },
      ],
    });
  });

  it('帶 eventId 時另回傳名單中的在職人數', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id, scope: { type: 'list' }, members: ['001', '003', '004', '999'] });
    const res = await call<ScopeOptions>(s.env, 'GET', `/api/scope-options?eventId=${ev.id}`, { cookie: s.owner.cookie });
    expect(res.json.listActive).toBe(2);
  });

  it('eventId 是其他承辦人的活動回 404，未登入回 401', async () => {
    const s = await setup();
    const ev = await seedEvent(s.env, { ownerId: s.owner.id });
    expect((await call(s.env, 'GET', `/api/scope-options?eventId=${ev.id}`, { cookie: s.other.cookie })).status).toBe(404);
    expect((await call(s.env, 'GET', '/api/scope-options')).status).toBe(401);
  });
});

describe('scopeCount', () => {
  const groups = [
    { plant: '台中廠', dept: '資訊室', count: 10 },
    { plant: '台中廠', dept: '人資室', count: 3 },
    { plant: '高雄廠', dept: '資訊室', count: 7 },
  ];

  it('依範圍加總分組人數，不同廠的同名部門分開算', () => {
    expect(scopeCount({ type: 'all' }, groups, 0)).toBe(20);
    expect(scopeCount({ type: 'plants', plants: ['台中廠'] }, groups, 0)).toBe(13);
    expect(scopeCount({ type: 'depts', depts: [['高雄廠', '資訊室']] }, groups, 0)).toBe(7);
    expect(scopeCount({ type: 'list' }, groups, 42)).toBe(42);
  });
});
