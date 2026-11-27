import { describe, expect, it } from 'vitest';
import type { Scope } from '../src/shared/event';
import { matchesScope, parseScope, serializeScope } from '../src/worker/scope';

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
