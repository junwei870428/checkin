import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckinContext, CheckinPerson, ScanRequest, ScanResponse } from '../src/shared/checkin';
import type { Scope } from '../src/shared/event';
import type { ApiErrorBody } from '../src/shared/types';
import type { Bindings } from '../src/worker/env';
import { call, makeEnv, seedEmployees, seedEvent, seedScan, seedStaff, seedUser } from './helpers/d1';

const HOUR = 3600_000;
const WANG = { empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠' };
const LEE = { empNo: '002001', name: '李小華', dept: '業務部', plant: '高雄廠' };
const ENDED_401 = { error: { code: 'unauthorized', message: '活動已結束，報到帳號已失效' } };

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(o: { startAt?: number; endAt?: number; rehearsal?: boolean; scope?: Scope; members?: string[] } = {}) {
  const env = makeEnv();
  const owner = await seedUser(env);
  const ev = await seedEvent(env, { ownerId: owner.id, name: '聖誕晚會', code: 'XMAS', ...o });
  await seedEmployees(env, [WANG, LEE, { empNo: '003001', name: '陳停用', active: false }]);
  const staff = await seedStaff(env, { eventId: ev.id, account: 'XMAS-01' });
  const [checkin, gift] = ev.stationIds as [string, string];
  const scan = (body: Partial<ScanRequest> | Record<string, unknown>, cookie = staff.cookie) =>
    call<ScanResponse & Partial<ApiErrorBody>>(env, 'POST', '/api/checkin/scan', { body, cookie });
  const voidScan = (scanId: unknown, cookie = staff.cookie) => call(env, 'POST', '/api/checkin/void', { body: { scanId }, cookie });
  return { env, owner, ev, staff, checkin, gift, scan, voidScan };
}

async function scanRows(env: Bindings) {
  const r = await env.DB.prepare('SELECT * FROM scans ORDER BY scanned_at, rowid').all<Record<string, unknown>>();
  return r.results;
}

async function passedCount(env: Bindings, stationId: string) {
  return env.DB.prepare('SELECT passed_count FROM stations WHERE id = ?').bind(stationId).first<number>('passed_count');
}

describe('POST /api/checkin/scan', () => {
  it('通過時寫入紀錄並回傳員工、紀錄與本關卡人數；工號去除前後空白並保留前導零', async () => {
    const { env, checkin, scan } = await setup();
    const res = await scan({ stationId: checkin, code: ' 001023\r\n' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      status: 'ok',
      reason: null,
      rehearsal: false,
      employee: WANG,
      scan: { id: expect.any(String), scannedAt: expect.any(Number), byAccount: 'XMAS-01' },
      previous: null,
      passedCount: 1,
    });
    const rows = await scanRows(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: res.json.scan!.id, emp_no: '001023', station_id: checkin, rehearsal: 0, by_account: 'XMAS-01', device: 'desktop', manual: 0, voided_at: null });
    expect(await passedCount(env, checkin)).toBe(1);
  });

  it('手動處理與裝置類型照實記錄', async () => {
    const { env, checkin, scan } = await setup();
    expect((await scan({ stationId: checkin, code: '001023', manual: true, device: 'mobile' })).json.status).toBe('ok');
    expect((await scanRows(env))[0]).toMatchObject({ manual: 1, device: 'mobile' });
  });

  it('同一關卡再掃一次回傳重複，附第一次通過的時間與帳號，且不新增紀錄', async () => {
    const { env, ev, checkin, scan } = await setup();
    const first = await scan({ stationId: checkin, code: '001023' });
    const other = await seedStaff(env, { eventId: ev.id, account: 'XMAS-02' });
    const res = await scan({ stationId: checkin, code: '001023' }, other.cookie);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      status: 'dup',
      reason: null,
      rehearsal: false,
      employee: WANG,
      scan: null,
      previous: { scannedAt: first.json.scan!.scannedAt, byAccount: 'XMAS-01' },
      passedCount: 1,
    });
    expect(await scanRows(env)).toHaveLength(1);
  });

  it('另一台裝置在檢核後、寫入前搶先寫入時，由唯一索引擋下並回傳對方的紀錄', async () => {
    const { env, ev, checkin, scan } = await setup();
    const realBatch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async stmts => {
      const out = await realBatch(stmts);
      await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '001023', byAccount: 'XMAS-02', scannedAt: 111 });
      return out;
    });
    const res = await scan({ stationId: checkin, code: '001023' });
    expect(res.json).toMatchObject({ status: 'dup', previous: { scannedAt: 111, byAccount: 'XMAS-02' }, passedCount: 1 });
    expect(await scanRows(env)).toHaveLength(1);
    expect(await passedCount(env, checkin)).toBe(1);
  });

  it('D1 的 meta.changes 含 trigger 改到的列時，結果仍正確', async () => {
    const { env, checkin, scan, voidScan } = await setup();
    // wrangler 本機 D1 實測：正式紀錄寫入時 trigger 也更新 stations，changes 為 2；shim 只算 1。
    // shim 的 rows_written 是 total_changes 差值、含 trigger，用它模擬 D1 的 changes
    const realBatch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, 'batch').mockImplementation(async stmts => {
      const out = await realBatch(stmts);
      for (const r of out) r.meta.changes = r.meta.rows_written;
      return out;
    });
    const first = await scan({ stationId: checkin, code: '001023' });
    expect(first.json).toMatchObject({ status: 'ok', passedCount: 1 });
    expect((await scan({ stationId: checkin, code: '001023' })).json).toMatchObject({ status: 'dup', passedCount: 1 });
    expect((await voidScan(first.json.scan!.id)).json).toEqual({ passedCount: 0 });
    expect((await scan({ stationId: checkin, code: '001023' })).json).toMatchObject({ status: 'ok', passedCount: 1 });
  });

  describe('無法通過的原因', () => {
    const rejected = (reason: string, employee: CheckinPerson | null, o: { rehearsal?: boolean; passedCount?: number } = {}) => ({
      status: 'error', reason, rehearsal: o.rehearsal ?? false, employee, scan: null, previous: null, passedCount: o.passedCount ?? 0,
    });

    it('查無此工號', async () => {
      const { env, checkin, scan } = await setup();
      expect((await scan({ stationId: checkin, code: '999999' })).json).toEqual(rejected('not_found', null));
      expect(await scanRows(env)).toHaveLength(0);
    });

    it('此工號已停用', async () => {
      const { checkin, scan } = await setup();
      const res = await scan({ stationId: checkin, code: '003001' });
      expect(res.json).toEqual(rejected('inactive', { empNo: '003001', name: '陳停用', dept: '資訊室', plant: '台中廠' }));
    });

    it('不在指定廠別', async () => {
      const { checkin, scan } = await setup({ scope: { type: 'plants', plants: ['台中廠'] } });
      expect((await scan({ stationId: checkin, code: '002001' })).json).toEqual(rejected('out_of_scope', LEE));
      expect((await scan({ stationId: checkin, code: '001023' })).json.status).toBe('ok');
    });

    it('不在匯入名單', async () => {
      const { checkin, scan } = await setup({ scope: { type: 'list' }, members: ['001023'] });
      expect((await scan({ stationId: checkin, code: '002001' })).json).toEqual(rejected('out_of_scope', LEE));
      expect((await scan({ stationId: checkin, code: '001023' })).json.status).toBe('ok');
    });

    it('尚未完成入場報到不能領取，報到後可以', async () => {
      const { checkin, gift, scan } = await setup();
      expect((await scan({ stationId: gift, code: '001023' })).json).toEqual(rejected('need_checkin', WANG));
      await scan({ stationId: checkin, code: '001023' });
      expect((await scan({ stationId: gift, code: '001023' })).json).toMatchObject({ status: 'ok', passedCount: 1 });
    });

    it('活動尚未開始且沒開演練模式', async () => {
      const { env, checkin, scan } = await setup({ startAt: Date.now() + HOUR, endAt: Date.now() + 2 * HOUR });
      expect((await scan({ stationId: checkin, code: '001023' })).json).toEqual(rejected('not_started', null));
      expect(await scanRows(env)).toHaveLength(0);
    });

    it('請求剛好跨過結束時間時回傳活動已結束', async () => {
      const end = Date.now() + 60_000;
      const { env, checkin, scan } = await setup({ endAt: end });
      // 登入檢查先讀時間（還沒結束），之後檢核時已過結束時間
      vi.spyOn(Date, 'now').mockReturnValueOnce(end - 1).mockReturnValue(end + 1);
      const res = await scan({ stationId: checkin, code: '001023' });
      expect(res.status).toBe(200);
      expect(res.json).toEqual(rejected('ended', null));
      expect(await scanRows(env)).toHaveLength(0);
    });
  });

  it('演練模式：紀錄標示為演練、人數只算演練，開始後同一人可正式報到', async () => {
    const { env, ev, checkin, scan } = await setup({ startAt: Date.now() + HOUR, endAt: Date.now() + 2 * HOUR, rehearsal: true });
    const first = await scan({ stationId: checkin, code: '001023' });
    expect(first.json).toMatchObject({ status: 'ok', rehearsal: true, passedCount: 1 });
    expect(await passedCount(env, checkin)).toBe(0);

    const again = await scan({ stationId: checkin, code: '001023' });
    expect(again.json).toMatchObject({ status: 'dup', rehearsal: true, passedCount: 1, previous: { byAccount: 'XMAS-01' } });
    expect((await scan({ stationId: checkin, code: '999999' })).json).toMatchObject({ status: 'error', reason: 'not_found', rehearsal: true, passedCount: 1 });

    await env.DB.prepare('UPDATE events SET start_at = ? WHERE id = ?').bind(Date.now() - 1000, ev.id).run();
    const formal = await scan({ stationId: checkin, code: '001023' });
    expect(formal.json).toMatchObject({ status: 'ok', rehearsal: false, passedCount: 1 });
    expect((await scanRows(env)).map(r => r.rehearsal)).toEqual([1, 0]);
  });

  it('其他活動的關卡回 400，不寫入', async () => {
    const { env, owner, scan } = await setup();
    const other = await seedEvent(env, { ownerId: owner.id, code: 'GALA' });
    const res = await scan({ stationId: other.stationIds[0], code: '001023' });
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe('bad_station');
    expect(await scanRows(env)).toHaveLength(0);
  });

  it.each([
    ['缺少關卡', () => ({ code: '001023' })],
    ['空白工號', (stationId: string) => ({ stationId, code: ' \r\n' })],
    ['工號超過 64 字', (stationId: string) => ({ stationId, code: 'x'.repeat(65) })],
    ['manual 不是布林', (stationId: string) => ({ stationId, code: '001023', manual: 'yes' })],
    ['device 不合法', (stationId: string) => ({ stationId, code: '001023', device: 'tablet' })],
  ])('參數錯誤回 400：%s', async (_, body) => {
    const { env, checkin, scan } = await setup();
    const res = await scan(body(checkin));
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe('bad_request');
    expect(await scanRows(env)).toHaveLength(0);
  });

  it('64 字以內的內容可送出，查無時照常回傳', async () => {
    const { checkin, scan } = await setup();
    expect((await scan({ stationId: checkin, code: 'x'.repeat(64) })).json).toMatchObject({ status: 'error', reason: 'not_found' });
  });
});

describe('POST /api/checkin/void', () => {
  it('撤銷後人數重算、留下撤銷人與時間，同一人可重新通過', async () => {
    const { env, checkin, scan, voidScan } = await setup();
    const first = await scan({ stationId: checkin, code: '001023' });
    const res = await voidScan(first.json.scan!.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ passedCount: 0 });
    expect(await passedCount(env, checkin)).toBe(0);
    expect((await scanRows(env))[0]).toMatchObject({ voided_at: expect.any(Number), voided_by: 'XMAS-01' });

    const again = await scan({ stationId: checkin, code: '001023' });
    expect(again.json).toMatchObject({ status: 'ok', passedCount: 1 });
    expect((await scanRows(env)).map(r => r.voided_at === null)).toEqual([false, true]);
  });

  it('已撤銷的紀錄再撤銷回 400', async () => {
    const { checkin, scan, voidScan } = await setup();
    const id = (await scan({ stationId: checkin, code: '001023' })).json.scan!.id;
    await voidScan(id);
    const res = await voidScan(id);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: { code: 'already_voided', message: '此紀錄已撤銷' } });
  });

  it('可撤銷同一活動其他帳號的紀錄', async () => {
    const { env, ev, checkin, scan, voidScan } = await setup();
    const other = await seedStaff(env, { eventId: ev.id, account: 'XMAS-02' });
    const id = (await scan({ stationId: checkin, code: '001023' }, other.cookie)).json.scan!.id;
    expect((await voidScan(id)).status).toBe(200);
    expect((await scanRows(env))[0]).toMatchObject({ by_account: 'XMAS-02', voided_by: 'XMAS-01' });
  });

  it('撤銷入場報到不連動撤銷領取紀錄', async () => {
    const { env, checkin, gift, scan, voidScan } = await setup();
    const ck = (await scan({ stationId: checkin, code: '001023' })).json.scan!.id;
    await scan({ stationId: gift, code: '001023' });
    expect((await voidScan(ck)).json).toEqual({ passedCount: 0 });
    expect(await passedCount(env, gift)).toBe(1);
  });

  it('撤銷演練紀錄回傳演練人數，不動正式人數', async () => {
    const { env, ev, checkin, voidScan } = await setup({ startAt: Date.now() + HOUR, endAt: Date.now() + 2 * HOUR, rehearsal: true });
    const id = await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '001023', rehearsal: true });
    await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '002001', rehearsal: true });
    expect((await voidScan(id)).json).toEqual({ passedCount: 1 });
    expect(await passedCount(env, checkin)).toBe(0);
  });

  it('其他活動或不存在的紀錄回 404，缺少 scanId 回 400', async () => {
    const { env, owner, voidScan } = await setup();
    const other = await seedEvent(env, { ownerId: owner.id, code: 'GALA' });
    const foreign = await seedScan(env, { eventId: other.id, stationId: other.stationIds[0], empNo: '001023' });
    for (const id of [foreign, 'no-such-scan']) {
      const res = await voidScan(id);
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe('not_found');
    }
    expect((await scanRows(env))[0]!.voided_at).toBeNull();
    expect((await voidScan(undefined)).status).toBe(400);
  });
});

describe('GET /api/checkin/context', () => {
  it('進行中：回傳活動、各關卡正式人數與範圍內在職人數', async () => {
    const { env, ev, checkin, gift, staff } = await setup({ scope: { type: 'plants', plants: ['台中廠'] } });
    await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '001023' });
    const res = await call<CheckinContext>(env, 'GET', '/api/checkin/context', { cookie: staff.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      event: { id: ev.id, name: '聖誕晚會', startAt: expect.any(Number), endAt: expect.any(Number), rehearsal: false },
      phase: 'live',
      stations: [
        { id: checkin, name: '入場報到', kind: 'checkin', requireCheckin: false, passedCount: 1 },
        { id: gift, name: '領取禮品', kind: 'gift', requireCheckin: true, passedCount: 0 },
      ],
      scopeTotal: 1,
    });
  });

  it('演練模式：關卡人數改為未撤銷的演練紀錄數', async () => {
    const { env, ev, checkin, gift, staff } = await setup({ startAt: Date.now() + HOUR, endAt: Date.now() + 2 * HOUR, rehearsal: true });
    await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '001023', rehearsal: true });
    await seedScan(env, { eventId: ev.id, stationId: checkin, empNo: '002001', rehearsal: true, voided: true });
    await seedScan(env, { eventId: ev.id, stationId: gift, empNo: '001023' });
    const res = await call<CheckinContext>(env, 'GET', '/api/checkin/context', { cookie: staff.cookie });
    expect(res.json.phase).toBe('rehearsal');
    expect(res.json.stations.map(s => s.passedCount)).toEqual([1, 0]);
    expect(res.json.scopeTotal).toBe(2);
  });

  it('尚未開始', async () => {
    const { env, staff } = await setup({ startAt: Date.now() + HOUR, endAt: Date.now() + 2 * HOUR });
    const res = await call<CheckinContext>(env, 'GET', '/api/checkin/context', { cookie: staff.cookie });
    expect(res.json).toMatchObject({ phase: 'not_started', event: { rehearsal: false } });
  });
});

describe('GET /api/checkin/people', () => {
  it('只回傳範圍內在職人員的工號、姓名、部門、廠別', async () => {
    const { env, staff } = await setup();
    const res = await call<CheckinPerson[]>(env, 'GET', '/api/checkin/people', { cookie: staff.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual([WANG, LEE]);
  });

  it('匯入名單範圍只含名單上的在職人員', async () => {
    const { env, staff } = await setup({ scope: { type: 'list' }, members: ['002001', '003001', '404404'] });
    const res = await call<CheckinPerson[]>(env, 'GET', '/api/checkin/people', { cookie: staff.cookie });
    expect(res.json).toEqual([LEE]);
  });
});

describe('登入與權限', () => {
  const requests = (stationId: string) => [
    ['GET', '/api/checkin/context', undefined],
    ['GET', '/api/checkin/people', undefined],
    ['POST', '/api/checkin/scan', { stationId, code: '001023' }],
    ['POST', '/api/checkin/void', { scanId: 'x' }],
  ] as const;

  it('活動已結束時所有報到 API 回 401', async () => {
    const { env, checkin, staff } = await setup({ startAt: Date.now() - 2 * HOUR, endAt: Date.now() - 1000 });
    for (const [method, path, body] of requests(checkin)) {
      const res = await call(env, method, path, { body, cookie: staff.cookie });
      expect(res.status, path).toBe(401);
      expect(res.json).toEqual(ENDED_401);
    }
  });

  it('未登入回 401，後台帳號回 403', async () => {
    const { env, checkin, owner } = await setup();
    for (const [method, path, body] of requests(checkin)) {
      expect((await call(env, method, path, { body })).status, path).toBe(401);
      expect((await call(env, method, path, { body, cookie: owner.cookie })).status, path).toBe(403);
    }
  });
});
