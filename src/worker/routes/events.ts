// 活動 API：第 3 階段（P3）擴充其餘 /api/events*（summary、breakdown、roster 在 reports.ts，帳號在 staff.ts）

import { Hono } from 'hono';
import { RETAIN_MS, type EventDetail, type StationKind } from '../../shared/event';
import { loadEventFor } from '../access';
import { requireAuth, requireUser } from '../auth';
import type { AppEnv } from '../env';

interface StationRow {
  id: string;
  name: string;
  kind: StationKind;
  require_checkin: number;
  sort_order: number;
  passed_count: number;
}

export const eventRoutes = new Hono<AppEnv>()
  .get('/events/:id', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const [st, mc] = await c.env.DB.batch([
      c.env.DB.prepare(
        'SELECT id, name, kind, require_checkin, sort_order, passed_count FROM stations WHERE event_id = ? ORDER BY sort_order, rowid',
      ).bind(ev.id),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM event_members WHERE event_id = ?').bind(ev.id),
    ]);
    const detail: EventDetail = {
      ...ev,
      memberCount: (mc.results[0] as { n: number }).n,
      stations: (st.results as StationRow[]).map(s => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        requireCheckin: s.require_checkin === 1,
        sortOrder: s.sort_order,
        passedCount: s.passed_count,
      })),
      deleteAt: ev.endAt + RETAIN_MS,
    };
    return c.json(detail);
  });
