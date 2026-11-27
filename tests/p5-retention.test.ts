import { describe, expect, it } from 'vitest';
import { RETAIN_MS } from '../src/shared/event';
import type { Bindings } from '../src/worker/env';
import { runRetention } from '../src/worker/retention';
import { makeEnv, seedEmployees, seedEvent, seedScan, seedStaff, seedUser } from './helpers/d1';

const NOW = Date.now();

/** 一場已結束的活動：名單 2 人、報到帳號 1 組、n 筆掃描（直接用 SQL 大量寫入） */
async function seedEnded(env: Bindings, ownerId: string, endAt: number, scans: number) {
  const ev = await seedEvent(env, { ownerId, startAt: endAt - 3 * 3600_000, endAt, scope: { type: 'list' }, members: ['001', '002'] });
  await seedStaff(env, { eventId: ev.id, account: `${ev.code}-01` });
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO scans (id, event_id, station_id, emp_no, rehearsal, scanned_at, by_account, device, manual)
     SELECT ? || '-' || i, ?, ?, printf('%06d', i), 0, ?, 'TEST-01', 'desktop', 0 FROM n`,
  ).bind(scans, ev.id, ev.id, ev.stationIds[0], endAt - 3600_000).run();
  return ev;
}

async function rows(env: Bindings, eventId: string) {
  const n = (sql: string) => env.DB.prepare(sql).bind(eventId).first<number>('n');
  return {
    scans: await n('SELECT COUNT(*) AS n FROM scans WHERE event_id = ?'),
    staff_accounts: await n('SELECT COUNT(*) AS n FROM staff_accounts WHERE event_id = ?'),
    event_members: await n('SELECT COUNT(*) AS n FROM event_members WHERE event_id = ?'),
    stations: await n('SELECT COUNT(*) AS n FROM stations WHERE event_id = ?'),
    events: await n('SELECT COUNT(*) AS n FROM events WHERE id = ?'),
  };
}

const GONE = { scans: 0, staff_accounts: 0, event_members: 0, stations: 0, events: 0 };

/** 記錄 runRetention 送給 D1 的每個語句寫入的列數（測試用 D1 含外鍵連帶刪除），用來檢查查詢數與每個語句的刪除上限 */
function metered(env: Bindings) {
  const changes: number[] = [];
  const wrap = (st: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(st, {
      get(t, k) {
        if (k === 'bind') return (...v: unknown[]) => wrap(t.bind(...v));
        if (k === 'run' || k === 'all') return async () => { const r = await t[k](); changes.push(r.meta.rows_written); return r; };
        if (k === 'first' || k === 'raw') return (...a: never[]) => { changes.push(0); return (t[k] as (...a: never[]) => unknown)(...a); };
        return Reflect.get(t, k);
      },
    });
  const DB = new Proxy(env.DB, {
    get(t, k) {
      if (k === 'prepare') return (sql: string) => wrap(t.prepare(sql));
      if (k === 'batch') return async (s: D1PreparedStatement[]) => { const r = await t.batch(s); changes.push(...r.map(x => x.meta.rows_written)); return r; };
      return Reflect.get(t, k);
    },
  });
  return { env: { ...env, DB }, changes };
}

describe('runRetention', () => {
  it('刪除結束滿 10 天的活動與所有相關資料，含超過 1,000 筆掃描；未滿 10 天與員工資料不動', async () => {
    const env = makeEnv();
    await seedEmployees(env, [{ empNo: '001' }, { empNo: '002' }]);
    const owner = await seedUser(env);
    const exactly = await seedEnded(env, owner.id, NOW - RETAIN_MS, 2500);
    const older = await seedEnded(env, owner.id, NOW - RETAIN_MS - 86_400_000, 3);
    const recent = await seedEnded(env, owner.id, NOW - RETAIN_MS + 1, 3);
    const live = await seedEvent(env, { ownerId: owner.id });
    await seedScan(env, { eventId: live.id, stationId: live.stationIds[0], empNo: '001' });

    await runRetention(env, NOW);

    expect(await rows(env, exactly.id)).toEqual(GONE);
    expect(await rows(env, older.id)).toEqual(GONE);
    expect(await rows(env, recent.id)).toEqual({ scans: 3, staff_accounts: 1, event_members: 2, stations: 2, events: 1 });
    expect(await rows(env, live.id)).toEqual({ scans: 1, staff_accounts: 0, event_members: 0, stations: 2, events: 1 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM employees').first('n')).toBe(2);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(owner.id).first('n')).toBe(1);
  });

  it('重跑不會出錯，也不會多刪', async () => {
    const env = makeEnv();
    const owner = await seedUser(env);
    const old = await seedEnded(env, owner.id, NOW - RETAIN_MS - 1, 10);
    const recent = await seedEnded(env, owner.id, NOW, 10);
    await runRetention(env, NOW);
    await runRetention(env, NOW);
    expect(await rows(env, old.id)).toEqual(GONE);
    expect(await rows(env, recent.id)).toEqual({ scans: 10, staff_accounts: 1, event_members: 2, stations: 2, events: 1 });
  });

  it('每次最多 40 個查詢、每個語句最多刪 1,000 列，刪不完的下一次繼續', async () => {
    const base = makeEnv();
    const owner = await seedUser(base);
    const ev = await seedEnded(base, owner.id, NOW - RETAIN_MS - 1, 41_500);

    const first = metered(base);
    await runRetention(first.env, NOW);
    expect(first.changes.length).toBeLessThanOrEqual(40);
    expect(Math.max(...first.changes)).toBeLessThanOrEqual(1000);
    const left = await rows(base, ev.id);
    expect(left.scans).toBeGreaterThan(0);
    expect(left.events).toBe(1);

    const second = metered(base);
    await runRetention(second.env, NOW);
    expect(second.changes.length).toBeLessThanOrEqual(40);
    expect(Math.max(...second.changes)).toBeLessThanOrEqual(1000);
    expect(await rows(base, ev.id)).toEqual(GONE);
  });
});
