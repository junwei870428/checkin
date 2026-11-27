// 參加範圍：資料庫欄位與 Scope 之間的轉換，以及「範圍內在職員工」的 SQL 條件與單人判斷

import type { Scope } from '../shared/event';

const isStr = (v: unknown): v is string => typeof v === 'string';
const isPair = (v: unknown): v is [string, string] => Array.isArray(v) && v.length === 2 && isStr(v[0]) && isStr(v[1]);

/** 解析 events.scope_type 與 events.scope_values，資料不合格時丟出錯誤 */
export function parseScope(scopeType: string, scopeValues: string): Scope {
  switch (scopeType) {
    case 'all':
      return { type: 'all' };
    case 'list':
      return { type: 'list' };
    case 'plants': {
      const v: unknown = JSON.parse(scopeValues);
      if (Array.isArray(v) && v.every(isStr)) return { type: 'plants', plants: v };
      break;
    }
    case 'depts': {
      const v: unknown = JSON.parse(scopeValues);
      if (Array.isArray(v) && v.every(isPair)) return { type: 'depts', depts: v };
      break;
    }
  }
  throw new Error(`參加範圍資料錯誤：${scopeType} ${scopeValues}`);
}

export function serializeScope(scope: Scope): { scope_type: Scope['type']; scope_values: string } {
  switch (scope.type) {
    case 'plants':
      return { scope_type: 'plants', scope_values: JSON.stringify(scope.plants) };
    case 'depts':
      return { scope_type: 'depts', scope_values: JSON.stringify(scope.depts) };
    default:
      return { scope_type: scope.type, scope_values: '[]' };
  }
}

/**
 * 「在參加範圍內且在職」的 SQL 條件，員工表別名必須是 `e`。
 * 廠別與部門以單一 JSON 參數傳入，不受每個查詢 100 個綁定參數的限制。
 */
export function scopeSql(scope: Scope, eventId: string): { sql: string; binds: unknown[] } {
  switch (scope.type) {
    case 'all':
      return { sql: '(e.active = 1)', binds: [] };
    case 'plants':
      return { sql: '(e.active = 1 AND e.plant IN (SELECT value FROM json_each(?)))', binds: [JSON.stringify(scope.plants)] };
    case 'depts':
      return {
        sql: "(e.active = 1 AND EXISTS (SELECT 1 FROM json_each(?) d WHERE json_extract(d.value, '$[0]') = e.plant AND json_extract(d.value, '$[1]') = e.dept))",
        binds: [JSON.stringify(scope.depts)],
      };
    case 'list':
      return {
        sql: '(e.active = 1 AND EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = ? AND m.emp_no = e.emp_no))',
        binds: [eventId],
      };
  }
}

/** 與 scopeSql 相同的判斷，給單一員工用；list 範圍由呼叫端查 event_members 後傳入 isMember */
export function matchesScope(scope: Scope, emp: { plant: string; dept: string; active: number }, isMember: boolean): boolean {
  if (emp.active !== 1) return false;
  switch (scope.type) {
    case 'all':
      return true;
    case 'plants':
      return scope.plants.includes(emp.plant);
    case 'depts':
      return scope.depts.some(([plant, dept]) => plant === emp.plant && dept === emp.dept);
    case 'list':
      return isMember;
  }
}
