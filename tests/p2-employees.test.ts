import { describe, expect, it } from 'vitest';
import type { EmployeeList, ImportBody, ImportLog, ImportPreview, ImportResult, ImportRow } from '../src/shared/employees';
import type { Bindings } from '../src/worker/env';
import { call, makeEnv, seedEmployees, seedEvent, seedScan, seedUser } from './helpers/d1';

type Emp = { empNo: string; name: string; dept: string; plant: string };

const emp = (empNo: string, o: Partial<Emp> = {}): Emp => ({ empNo, name: `員工${empNo}`, dept: '資訊室', plant: '台中廠', ...o });
const fileOf = (emps: Emp[], fileName = '員工.xlsx'): ImportBody => ({ fileName, rows: emps.map((e, i) => ({ r: i + 2, ...e })) });

/** 每個執行的 D1 語句計一次（batch 內的每個語句各算一次，與 D1 每次請求 50 個查詢的計算方式相同） */
function countQueries(env: Bindings) {
  const db = env.DB as unknown as { execute: (...a: unknown[]) => unknown };
  const execute = db.execute.bind(db);
  const counter = { n: 0 };
  db.execute = (...a) => {
    counter.n++;
    return execute(...a);
  };
  return counter;
}

/** 把 updated_at 設成很久以前，之後若被寫入一定看得出來 */
const ageEmployees = (env: Bindings) => env.DB.prepare('UPDATE employees SET updated_at = 1').run();

async function employeesInDb(env: Bindings) {
  return (await env.DB.prepare('SELECT emp_no, name, dept, plant, active, updated_at FROM employees ORDER BY emp_no').all()).results;
}

async function setup() {
  const env = makeEnv();
  const admin = await seedUser(env, { role: 'admin', name: '管理員' });
  const organizer = await seedUser(env, { role: 'organizer' });
  return { env, admin, organizer };
}

describe('GET /api/employees', () => {
  it('預設只列在職人員，依工號排序並回傳在職與停用人數', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, [{ empNo: '003' }, { empNo: '001', name: '王小明' }, { empNo: '002', active: false }]);
    const res = await call<EmployeeList>(env, 'GET', '/api/employees', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json.rows.map(r => r.empNo)).toEqual(['001', '003']);
    expect(res.json.rows[0]).toMatchObject({ empNo: '001', name: '王小明', dept: '資訊室', plant: '台中廠', active: true });
    expect(res.json).toMatchObject({ total: 2, activeCount: 2, inactiveCount: 1 });
  });

  it('可搜尋姓名、工號、部門、廠別，includeInactive 顯示停用人員', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, [
      { empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠' },
      { empNo: 'A0002', name: '李小華', dept: '人資室', plant: '高雄廠' },
      { empNo: '000999', name: '陳大同', dept: 'IT', plant: '台中廠', active: false },
    ]);
    const q = async (qs: string) =>
      (await call<EmployeeList>(env, 'GET', `/api/employees?${qs}`, { cookie: admin.cookie })).json.rows.map(r => r.empNo);
    expect(await q('q=小明')).toEqual(['001023']);
    expect(await q('q=0010')).toEqual(['001023']);
    expect(await q(`q=${encodeURIComponent('人資')}`)).toEqual(['A0002']);
    expect(await q(`q=${encodeURIComponent('高雄')}`)).toEqual(['A0002']);
    expect(await q('q=a0002')).toEqual(['A0002']);
    expect(await q('q=it')).toEqual([]);
    expect(await q('q=it&includeInactive=1')).toEqual(['000999']);
    expect(await q('q=%25')).toEqual([]); // % 當一般字元比對，不是萬用字元
  });

  it('一頁最多 300 筆，total 是符合條件的總數，page 取下一頁', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, Array.from({ length: 301 }, (_, i) => ({ empNo: String(i).padStart(4, '0') })));
    const p1 = await call<EmployeeList>(env, 'GET', '/api/employees', { cookie: admin.cookie });
    expect(p1.json.rows).toHaveLength(300);
    expect(p1.json.total).toBe(301);
    const p2 = await call<EmployeeList>(env, 'GET', '/api/employees?page=2', { cookie: admin.cookie });
    expect(p2.json.rows.map(r => r.empNo)).toEqual(['0300']);
  });

  it('查詢條件不合格回 400', async () => {
    const { env, admin } = await setup();
    for (const qs of ['page=0', 'page=abc', `q=${'x'.repeat(65)}`]) {
      const res = await call(env, 'GET', `/api/employees?${qs}`, { cookie: admin.cookie });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('bad_request');
    }
  });

  it('承辦人回 403，未登入回 401', async () => {
    const { env, organizer } = await setup();
    expect((await call(env, 'GET', '/api/employees', { cookie: organizer.cookie })).status).toBe(403);
    expect((await call(env, 'GET', '/api/employees')).status).toBe(401);
  });
});

describe('POST /api/employees/import/preview', () => {
  it('逐列標出新增、更新、不變、錯誤，列出會停用的在職員工，且不寫入', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, [
      { empNo: '001', name: '王小明', dept: '資訊室', plant: '台中廠' },
      { empNo: '002', name: '李小華', dept: '資訊室', plant: '台中廠' },
      { empNo: '003', name: '陳大同', dept: '資訊室', plant: '台中廠', active: false },
      { empNo: '004', name: '林小美', dept: '人資室', plant: '高雄廠' },
      { empNo: '005', name: '已停用', dept: '人資室', plant: '高雄廠', active: false },
    ]);
    const before = await employeesInDb(env);
    const rows: ImportRow[] = [
      { r: 2, empNo: '001', name: '王小明', dept: '資訊室', plant: '台中廠' },
      { r: 3, empNo: '002', name: '李小華', dept: '總務室', plant: '台中廠' },
      { r: 4, empNo: '003', name: '陳大同', dept: '資訊室', plant: '台中廠' },
      { r: 5, empNo: '000777', name: '新同事', dept: '資訊室', plant: '台中廠' },
      { r: 6, empNo: '', name: '沒工號', dept: '', plant: '台中廠' },
      { r: 7, empNo: '000777', name: '重複', dept: '資訊室', plant: '台中廠' },
      { r: 8, empNo: '008', name: 'x'.repeat(65), dept: '資訊室', plant: '台中廠' },
    ];
    const res = await call<ImportPreview>(env, 'POST', '/api/employees/import/preview', {
      cookie: admin.cookie,
      body: { fileName: '員工.xlsx', rows },
    });
    expect(res.status).toBe(200);
    expect(res.json.rows).toEqual([
      { ...rows[0], status: 'same' },
      { ...rows[1], status: 'update', prev: { name: '李小華', dept: '資訊室', plant: '台中廠', active: true } },
      { ...rows[2], status: 'update', prev: { name: '陳大同', dept: '資訊室', plant: '台中廠', active: false } },
      { ...rows[3], status: 'new' },
      { ...rows[4], status: 'error', errors: ['工號空白', '部門空白'] },
      { ...rows[5], status: 'error', errors: ['工號與第 5 列重複'] },
      { ...rows[6], status: 'error', errors: ['姓名超過 64 字'] },
    ]);
    expect(res.json.deactivate).toEqual([{ empNo: '004', name: '林小美', dept: '人資室', plant: '高雄廠' }]);
    expect(res.json.counts).toEqual({ new: 1, update: 2, same: 1, error: 3, deactivate: 1 });
    expect(res.json.activeCount).toBe(3);
    expect(await employeesInDb(env)).toEqual(before);
  });

  it('欄位前後空白去除後再比對，前導零工號保持字串', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, [{ empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠' }]);
    const res = await call<ImportPreview>(env, 'POST', '/api/employees/import/preview', {
      cookie: admin.cookie,
      body: { fileName: ' 員工.xlsx ', rows: [{ r: 2, empNo: ' 001023 ', name: '王小明 ', dept: '資訊室', plant: '台中廠' }] },
    });
    expect(res.json.rows).toEqual([{ r: 2, empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠', status: 'same' }]);
  });

  it('結構不合格回 400', async () => {
    const { env, admin } = await setup();
    const row = { r: 2, ...emp('001') };
    const bad: unknown[] = [
      { fileName: '', rows: [row] },
      { fileName: 'a.xlsx', rows: 'x' },
      { fileName: 'a.xlsx', rows: [] },
      { fileName: 'a.xlsx', rows: [{ ...row, r: 0 }] },
      { fileName: 'a.xlsx', rows: [{ ...row, empNo: 1023 }] },
      { fileName: 'a.xlsx', rows: Array.from({ length: 5001 }, (_, i) => ({ ...row, r: i + 2 })) },
    ];
    for (const body of bad) {
      const res = await call(env, 'POST', '/api/employees/import/preview', { cookie: admin.cookie, body });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('bad_request');
    }
  });

  it('承辦人回 403', async () => {
    const { env, organizer } = await setup();
    const res = await call(env, 'POST', '/api/employees/import/preview', { cookie: organizer.cookie, body: fileOf([emp('001')]) });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/employees/import/commit', () => {
  it('新增、更新、停用不在檔案中的在職員工，沒有變動的不寫入，並記錄匯入紀錄', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, [
      { empNo: '001', name: '王小明', dept: '資訊室', plant: '台中廠' },
      { empNo: '002', name: '李小華', dept: '資訊室', plant: '台中廠' },
      { empNo: '003', name: '陳大同', dept: '資訊室', plant: '台中廠', active: false },
      { empNo: '004', name: '林小美', dept: '人資室', plant: '高雄廠' },
    ]);
    await ageEmployees(env);
    const sameBefore = (await employeesInDb(env))[0];
    const res = await call<ImportResult>(env, 'POST', '/api/employees/import/commit', {
      cookie: admin.cookie,
      body: fileOf([
        emp('001', { name: '王小明', dept: '資訊室', plant: '台中廠' }),
        emp('002', { name: '李小華', dept: '總務室', plant: '台中廠' }),
        emp('003', { name: '陳大同', dept: '資訊室', plant: '台中廠' }),
        emp('000777', { name: '新同事', dept: '資訊室', plant: '台中廠' }),
      ], '1127 員工.xlsx'),
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ added: 1, updated: 2, deactivated: 1 });

    const after = await employeesInDb(env);
    expect(after.map(e => [e.emp_no, e.name, e.dept, e.plant, e.active])).toEqual([
      ['000777', '新同事', '資訊室', '台中廠', 1],
      ['001', '王小明', '資訊室', '台中廠', 1],
      ['002', '李小華', '總務室', '台中廠', 1],
      ['003', '陳大同', '資訊室', '台中廠', 1],
      ['004', '林小美', '人資室', '高雄廠', 0],
    ]);
    expect(after[1]).toEqual(sameBefore);

    const logs = await call<ImportLog[]>(env, 'GET', '/api/employees/import-logs', { cookie: admin.cookie });
    expect(logs.json).toEqual([
      { id: expect.any(String), createdAt: expect.any(Number), userName: '管理員', fileName: '1127 員工.xlsx', added: 1, updated: 2, deactivated: 1 },
    ]);
  });

  it('同一份檔案再匯入一次不再寫入員工資料', async () => {
    const { env, admin } = await setup();
    const body = fileOf([emp('001'), emp('002')]);
    await call(env, 'POST', '/api/employees/import/commit', { cookie: admin.cookie, body });
    await ageEmployees(env);
    const before = await employeesInDb(env);
    const res = await call<ImportResult>(env, 'POST', '/api/employees/import/commit', { cookie: admin.cookie, body });
    expect(res.json).toEqual({ added: 0, updated: 0, deactivated: 0 });
    expect(await employeesInDb(env)).toEqual(before);
  });

  it('有錯誤列時回 400，整批不寫入', async () => {
    const { env, admin } = await setup();
    await seedEmployees(env, [{ empNo: '001' }]);
    const before = await employeesInDb(env);
    const res = await call(env, 'POST', '/api/employees/import/commit', {
      cookie: admin.cookie,
      body: fileOf([emp('002'), emp('002')]),
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_rows');
    expect(await employeesInDb(env)).toEqual(before);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM import_logs').first('n')).toBe(0);
  });

  it('重新計算未結束活動的關卡人數，已結束的活動不動', async () => {
    const { env, admin, organizer } = await setup();
    await seedEmployees(env, [{ empNo: '001' }, { empNo: '002' }]);
    const live = await seedEvent(env, { ownerId: organizer.id });
    const ended = await seedEvent(env, { ownerId: organizer.id, startAt: Date.now() - 7200_000, endAt: Date.now() - 1 });
    for (const ev of [live, ended]) {
      await seedScan(env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '001' });
      await seedScan(env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '002' });
    }
    const passed = async (stationId: string) => env.DB.prepare('SELECT passed_count FROM stations WHERE id = ?').bind(stationId).first('passed_count');

    await call(env, 'POST', '/api/employees/import/commit', { cookie: admin.cookie, body: fileOf([emp('001')]) });
    expect(await passed(live.stationIds[0])).toBe(1);
    expect(await passed(ended.stationIds[0])).toBe(2);
  });

  it('500 人匯入在 3 場未結束活動下只用 9 個 D1 查詢', async () => {
    const { env, admin, organizer } = await setup();
    await seedEmployees(env, Array.from({ length: 500 }, (_, i) => ({ empNo: String(i).padStart(6, '0') })));
    for (let i = 0; i < 3; i++) await seedEvent(env, { ownerId: organizer.id });
    const file = Array.from({ length: 500 }, (_, i) => emp(String(i + 250).padStart(6, '0')));
    const queries = countQueries(env);
    const res = await call<ImportResult>(env, 'POST', '/api/employees/import/commit', { cookie: admin.cookie, body: fileOf(file) });
    expect(res.json).toEqual({ added: 250, updated: 0, deactivated: 250 });
    // 登入檢查 1、讀員工與活動 2、寫入員工 1、停用 1、匯入紀錄 1、每場活動重算 1
    expect(queries.n).toBe(9);
  });

  it('承辦人回 403', async () => {
    const { env, organizer } = await setup();
    const res = await call(env, 'POST', '/api/employees/import/commit', { cookie: organizer.cookie, body: fileOf([emp('001')]) });
    expect(res.status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM employees').first('n')).toBe(0);
  });
});

describe('GET /api/employees/import-logs', () => {
  it('回傳最近 20 筆，新的在前', async () => {
    const { env, admin } = await setup();
    await env.DB.batch(Array.from({ length: 21 }, (_, i) =>
      env.DB.prepare("INSERT INTO import_logs (id, created_at, user_id, file_name, added, updated, deactivated) VALUES (?, ?, ?, ?, 0, 0, 0)")
        .bind(`log-${i}`, 1000 + i, admin.id, `f${i}.xlsx`),
    ));
    const res = await call<ImportLog[]>(env, 'GET', '/api/employees/import-logs', { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toHaveLength(20);
    expect(res.json[0]).toEqual({ id: 'log-20', createdAt: 1020, userName: '管理員', fileName: 'f20.xlsx', added: 0, updated: 0, deactivated: 0 });
    expect(res.json[19].id).toBe('log-1');
  });

  it('承辦人回 403', async () => {
    const { env, organizer } = await setup();
    expect((await call(env, 'GET', '/api/employees/import-logs', { cookie: organizer.cookie })).status).toBe(403);
  });
});
