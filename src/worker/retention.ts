// 刪除結束滿 10 天的活動（F-RET-2），由 index.ts 的 scheduled() 每小時呼叫。
// 依 scans、staff_accounts、event_members、stations、events 的順序刪除，每個語句最多 1,000 列（規劃書第 9 節）。
// 每次最多 40 個查詢（免費方案每次呼叫上限 50），刪不完的留給下一小時。
// 每一步都只看資料表目前的內容，重跑或中途停止都會收斂到同樣結果。

import { RETAIN_MS } from '../shared/event';
import type { Bindings } from './env';

const BATCH = 1000;
const MAX_QUERIES = 40;

type Table = 'scans' | 'staff_accounts' | 'event_members' | 'stations' | 'events';

const deleteChildren = (t: Table) =>
  `DELETE FROM ${t} WHERE rowid IN (SELECT rowid FROM ${t} WHERE event_id IN (SELECT id FROM events WHERE end_at <= ?) LIMIT ?)`;

// 子表先刪完才刪活動列，活動列刪除時就不會連帶 cascade 超過 1,000 列
const STEPS: Array<[Table, string]> = [
  ['scans', deleteChildren('scans')],
  ['staff_accounts', deleteChildren('staff_accounts')],
  ['event_members', deleteChildren('event_members')],
  ['stations', deleteChildren('stations')],
  ['events', 'DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE end_at <= ? LIMIT ?)'],
];

export interface RetentionResult {
  deleted: Record<Table, number>;
  queries: number;
  /** false 表示查詢數用完，剩下的由下一次排程繼續 */
  done: boolean;
}

export async function runRetention(env: Bindings, now: number): Promise<RetentionResult> {
  const cutoff = now - RETAIN_MS;
  const res: RetentionResult = {
    deleted: { scans: 0, staff_accounts: 0, event_members: 0, stations: 0, events: 0 },
    queries: 0,
    done: true,
  };
  for (const [table, sql] of STEPS) {
    let changes = BATCH;
    while (changes === BATCH && res.queries < MAX_QUERIES) {
      changes = (await env.DB.prepare(sql).bind(cutoff, BATCH).run()).meta.changes;
      res.queries++;
      res.deleted[table] += changes;
    }
    if (changes === BATCH) {
      res.done = false;
      break;
    }
  }
  console.log(`retention ${JSON.stringify(res)}`);
  return res;
}
