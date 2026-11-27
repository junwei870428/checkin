import { describe, expect, it } from 'vitest';
import type { Scope } from '../src/shared/event';
import { matchesScope, parseScope, scopeSql, serializeScope } from '../src/worker/scope';
import { makeEnv, seedEmployees, seedEvent, seedUser } from './helpers/d1';

describe('parseScope / serializeScope', () => {
  const scopes: Scope[] = [
    { type: 'all' },
    { type: 'list' },
    { type: 'plants', plants: ['台中廠', '高雄廠'] },
    { type: 'depts', depts: [['台中廠', '資訊室'], ['高雄廠', '資訊室']] },
  ];

  it.each(scopes)('序列化後可原樣解析回來：$type', scope => {
    const { scope_type, scope_values } = serializeScope(scope);
    expect(parseScope(scope_type, scope_values)).toEqual(scope);
  });

  it('不合格的資料丟出錯誤', () => {
    expect(() => parseScope('company', '[]')).toThrow();
    expect(() => parseScope('plants', '{"a":1}')).toThrow();
    expect(() => parseScope('plants', '[1]')).toThrow();
    expect(() => parseScope('plants', 'not json')).toThrow();
    expect(() => parseScope('depts', '["資訊室"]')).toThrow();
    expect(() => parseScope('depts', '[["台中廠"]]')).toThrow();
  });
});

describe('matchesScope', () => {
  const emp = { plant: '台中廠', dept: '資訊室', active: 1 };

  it('停用的員工不在任何範圍內', () => {
    expect(matchesScope({ type: 'all' }, { ...emp, active: 0 }, true)).toBe(false);
    expect(matchesScope({ type: 'list' }, { ...emp, active: 0 }, true)).toBe(false);
  });

  it('指定部門要廠別與部門都相符，不同廠的同名部門不算', () => {
    expect(matchesScope({ type: 'depts', depts: [['台中廠', '資訊室']] }, emp, false)).toBe(true);
    expect(matchesScope({ type: 'depts', depts: [['高雄廠', '資訊室']] }, emp, false)).toBe(false);
  });

  it('指定廠別與名單', () => {
    expect(matchesScope({ type: 'plants', plants: ['台中廠'] }, emp, false)).toBe(true);
    expect(matchesScope({ type: 'plants', plants: ['高雄廠'] }, emp, false)).toBe(false);
    expect(matchesScope({ type: 'list' }, emp, true)).toBe(true);
    expect(matchesScope({ type: 'list' }, emp, false)).toBe(false);
  });
});

describe('scopeSql', () => {
  const employees = [
    { empNo: '001', plant: '台中廠', dept: '資訊室' },
    { empNo: '002', plant: '台中廠', dept: '人資室' },
    { empNo: '003', plant: '高雄廠', dept: '資訊室' },
    { empNo: '004', plant: '台中廠', dept: '資訊室', active: false },
    { empNo: '005', plant: '台北廠', dept: '業務部' },
  ];
  const members = ['001', '004', '999'];
  const cases: Array<[Scope, string[]]> = [
    [{ type: 'all' }, ['001', '002', '003', '005']],
    [{ type: 'plants', plants: ['台中廠'] }, ['001', '002']],
    [{ type: 'plants', plants: [] }, []],
    [{ type: 'depts', depts: [['高雄廠', '資訊室'], ['台中廠', '人資室']] }, ['002', '003']],
    [{ type: 'list' }, ['001']],
  ];

  it.each(cases)('篩出範圍內的在職員工，且與 matchesScope 一致：%j', async (scope, expected) => {
    const env = makeEnv();
    await seedEmployees(env, employees);
    const owner = await seedUser(env);
    const ev = await seedEvent(env, { ownerId: owner.id, scope, members });
    const s = scopeSql(scope, ev.id);
    const rows = await env.DB.prepare(`SELECT emp_no FROM employees e WHERE ${s.sql} ORDER BY emp_no`).bind(...s.binds).raw();
    expect(rows.flat()).toEqual(expected);

    const pure = employees
      .filter(e => matchesScope(scope, { ...e, active: e.active === false ? 0 : 1 }, members.includes(e.empNo)))
      .map(e => e.empNo);
    expect(pure).toEqual(expected);
  });
});
