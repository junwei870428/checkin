// 活動存取權限（規劃書第 8 節）：系統管理員可看全部，承辦人只能看自己的活動，其他一律 404

import type { Context } from 'hono';
import type { EventDetail } from '../shared/event';
import { apiError, type AppEnv } from './env';
import { parseScope } from './scope';

/** 解析後的 events 資料列，等於 EventDetail 去掉關卡、名單數與刪除日期 */
export type EventRecord = Omit<EventDetail, 'memberCount' | 'stations' | 'deleteAt'>;

export interface EventRow {
  id: string;
  name: string;
  code: string;
  owner_id: string;
  start_at: number;
  end_at: number;
  rehearsal: number;
  scope_type: string;
  scope_values: string;
}

export const EVENT_COLUMNS = 'id, name, code, owner_id, start_at, end_at, rehearsal, scope_type, scope_values';

export function toEventRecord(r: EventRow): EventRecord {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    ownerId: r.owner_id,
    startAt: r.start_at,
    endAt: r.end_at,
    rehearsal: r.rehearsal === 1,
    scope: parseScope(r.scope_type, r.scope_values),
  };
}

/**
 * 讀取目前登入者可操作的活動。用法：
 *   const r = await loadEventFor(c, c.req.param('id'));
 *   if (!r.ok) return r.response;
 */
export async function loadEventFor(
  c: Context<AppEnv>,
  eventId: string,
): Promise<{ ok: true; event: EventRecord } | { ok: false; response: Response }> {
  const a = c.get('auth');
  const row = a.t === 'u'
    ? await c.env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(eventId).first<EventRow>()
    : null;
  if (!row || a.t !== 'u' || (a.role !== 'admin' && row.owner_id !== a.id)) {
    return { ok: false, response: apiError(c, 404, 'not_found', '找不到這個活動') };
  }
  return { ok: true, event: toEventRecord(row) };
}
