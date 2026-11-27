// tests/helpers/d1.ts 必須與 D1 行為一致的地方：各階段的路由測試都依賴這些行為

import { describe, expect, it } from 'vitest';
import { makeEnv, seedEmployees, seedEvent, seedScan, seedUser } from './helpers/d1';

describe('D1 模擬', () => {
  it('已套用 migrations，且強制檢查外鍵', async () => {
    const env = makeEnv();
    await expect(
      env.DB.prepare("INSERT INTO stations (id, event_id, name, kind) VALUES ('s1', 'no-such-event', 'x', 'checkin')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('batch 中任一語句失敗時整批回復', async () => {
    const env = makeEnv();
    const ins = (id: string) =>
      env.DB.prepare("INSERT INTO users (id, username, name, role, pwd_salt, pwd_hash, created_at) VALUES (?, 'dup', 'n', 'admin', 's', 'h', 0)").bind(id);
    await expect(env.DB.batch([ins('a'), ins('b')])).rejects.toThrow(/UNIQUE/);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
  });

  it('meta.changes 與 D1 相同含 trigger 改到的列，ON CONFLICT DO NOTHING 衝突時為 0', async () => {
    const env = makeEnv();
    const owner = await seedUser(env);
    const ev = await seedEvent(env, { ownerId: owner.id });
    const insert = () =>
      env.DB.prepare(
        `INSERT INTO scans (id, event_id, station_id, emp_no, scanned_at, by_account, device)
         VALUES (?, ?, ?, '001', 0, 'A-01', 'desktop') ON CONFLICT DO NOTHING`,
      ).bind(crypto.randomUUID(), ev.id, ev.stationIds[0]).run();
    // 正式紀錄寫入：scans 1 列 + trigger 更新 stations 1 列（wrangler 本機 D1 實測同為 2）
    expect((await insert()).meta.changes).toBe(2);
    expect((await insert()).meta.changes).toBe(0);
    expect(await env.DB.prepare('SELECT passed_count FROM stations WHERE id = ?').bind(ev.stationIds[0]).first('passed_count')).toBe(1);
  });

  it('first 回傳第一列或指定欄位，沒有資料時回傳 null', async () => {
    const env = makeEnv();
    await seedEmployees(env, [{ empNo: '001023', name: '王小明' }]);
    const q = (empNo: string) => env.DB.prepare('SELECT emp_no, name FROM employees WHERE emp_no = ?').bind(empNo);
    expect(await q('001023').first()).toEqual({ emp_no: '001023', name: '王小明' });
    expect(await q('001023').first('name')).toBe('王小明');
    expect(await q('999').first()).toBeNull();
    await expect(q('001023').first('nope')).rejects.toThrow(/Column not found/);
  });

  it('raw 回傳陣列，可附欄位名稱；布林綁定為 1/0', async () => {
    const env = makeEnv();
    await seedEmployees(env, [{ empNo: '001', active: true }, { empNo: '002', active: false }]);
    const q = env.DB.prepare('SELECT emp_no, active FROM employees WHERE active = ? ORDER BY emp_no').bind(true);
    expect(await q.raw()).toEqual([['001', 1]]);
    expect(await q.raw({ columnNames: true })).toEqual([['emp_no', 'active'], ['001', 1]]);
  });

  it('seedScan 寫入的撤銷與演練紀錄不計入 passed_count', async () => {
    const env = makeEnv();
    const owner = await seedUser(env);
    const ev = await seedEvent(env, { ownerId: owner.id });
    await seedScan(env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '001' });
    await seedScan(env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '002', voided: true });
    await seedScan(env, { eventId: ev.id, stationId: ev.stationIds[0], empNo: '003', rehearsal: true });
    expect(await env.DB.prepare('SELECT passed_count FROM stations WHERE id = ?').bind(ev.stationIds[0]).first('passed_count')).toBe(1);
  });
});
