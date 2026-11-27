import { describe, expect, it } from 'vitest';
import type { Scope } from '../src/shared/event';
import type { Bindings } from '../src/worker/env';
import { recalcStatements } from '../src/worker/counts';
import { makeEnv, seedEmployees, seedEvent, seedScan, seedUser } from './helpers/d1';

const counts = async (env: Bindings, eventId: string) =>
  (await env.DB.prepare('SELECT passed_count FROM stations WHERE event_id = ? ORDER BY sort_order').bind(eventId).raw()).flat();

async function setup() {
  const env = makeEnv();
  await seedEmployees(env, [
    { empNo: '001', plant: '台中廠' },
    { empNo: '002', plant: '台中廠' },
    { empNo: '003', plant: '高雄廠' },
    { empNo: '004', plant: '台中廠', active: false },
  ]);
  const owner = await seedUser(env);
  const scope: Scope = { type: 'plants', plants: ['台中廠'] };
  const ev = await seedEvent(env, { ownerId: owner.id, scope });
  const [checkin, gift] = ev.stationIds;
  const scan = (stationId: string, empNo: string, o: { voided?: boolean; rehearsal?: boolean } = {}) =>
    seedScan(env, { eventId: ev.id, stationId, empNo, ...o });
  await scan(checkin, '001');
  await scan(checkin, '002', { voided: true });
  await scan(checkin, '003');
  await scan(checkin, '004');
  await scan(checkin, '002', { rehearsal: true });
  await scan(gift, '001');
  return { env, owner, ev, scope };
}

describe('recalcStatements', () => {
  it('只計入未撤銷的正式紀錄中，目前在範圍內且在職的人', async () => {
    const { env, ev, scope } = await setup();
    expect(await counts(env, ev.id)).toEqual([3, 1]); // trigger 只管新增，不看範圍與在職
    await env.DB.batch(recalcStatements(env.DB, ev.id, scope));
    expect(await counts(env, ev.id)).toEqual([1, 1]);
  });

  it('範圍改變後依新範圍重算', async () => {
    const { env, ev } = await setup();
    await env.DB.batch(recalcStatements(env.DB, ev.id, { type: 'all' }));
    expect(await counts(env, ev.id)).toEqual([2, 1]);
  });

  it('只更新指定活動的關卡', async () => {
    const { env, owner, ev } = await setup();
    const other = await seedEvent(env, { ownerId: owner.id });
    await seedScan(env, { eventId: other.id, stationId: other.stationIds[0], empNo: '003' });
    await env.DB.batch(recalcStatements(env.DB, ev.id, { type: 'list' }));
    expect(await counts(env, ev.id)).toEqual([0, 0]);
    expect(await counts(env, other.id)).toEqual([1, 0]);
  });
});
