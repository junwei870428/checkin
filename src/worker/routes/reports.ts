// 報表 API（F-RPT-1、F-RPT-2）：/api/events/:id/summary、breakdown、roster。
// 人數定義與 recalcStatements 相同：未撤銷的正式紀錄中，目前在參加範圍內且在職的人（規劃書第 4 節）。
// breakdown 與 roster 在 SQL 端 GROUP BY 彙總，Worker 只依群組或人數組回應，不逐筆比對紀錄（規劃書第 9 節）。

import { Hono } from 'hono';
import { eventPhase } from '../../shared/event';
import type {
  BreakdownDept,
  BreakdownPlant,
  EventBreakdown,
  EventRoster,
  EventSummary,
  ReportStation,
  RosterPerson,
} from '../../shared/reports';
import { loadEventFor } from '../access';
import { requireAuth, requireUser } from '../auth';
import { apiError, type AppEnv } from '../env';
import { scopeSql } from '../scope';

/** 正式且未撤銷的掃描紀錄（scans 別名 s） */
const FORMAL = 's.rehearsal = 0 AND s.voided_at IS NULL';

const STATIONS_SQL = 'SELECT id, name, kind FROM stations WHERE event_id = ? ORDER BY sort_order, rowid';

/** 規劃書第 9 節要求記錄每個 API 的 meta.rows_read，括號內是各查詢的值；登入檢查與讀活動的主鍵查詢不在此計入 */
function logRowsRead(route: string, results: D1Result[]) {
  const each = results.map(r => r.meta.rows_read);
  console.log(`${route} rows_read=${each.reduce((a, b) => a + b, 0)} (${each.join('+')})`);
}

export const reportRoutes = new Hono<AppEnv>()
  .get('/events/:id/summary', requireAuth, requireUser(), async c => {
    const total = c.req.query('total');
    if (total !== undefined && total !== '1') return apiError(c, 400, 'bad_request', '參數 total 只能是 1');
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const db = c.env.DB;
    const sc = scopeSql(ev.scope, ev.id);
    const [st, tot, reh] = await Promise.all([
      db.prepare('SELECT id, name, kind, passed_count AS passed FROM stations WHERE event_id = ? ORDER BY sort_order, rowid')
        .bind(ev.id).all<EventSummary['stations'][number]>(),
      total ? db.prepare(`SELECT COUNT(*) AS n FROM employees e WHERE ${sc.sql}`).bind(...sc.binds).all<{ n: number }>() : null,
      eventPhase(ev, Date.now()) === 'rehearsal'
        ? db.prepare(`SELECT s.station_id AS id, COUNT(*) AS n FROM scans s WHERE s.event_id = ? AND s.rehearsal = 1 AND s.voided_at IS NULL GROUP BY s.station_id`)
          .bind(ev.id).all<{ id: string; n: number }>()
        : null,
    ]);
    logRowsRead('summary', [st, tot, reh].filter(x => x !== null));
    const body: EventSummary = { stations: st.results };
    if (tot) body.total = tot.results[0].n;
    if (reh) {
      const n = new Map(reh.results.map(x => [x.id, x.n]));
      body.rehearsal = Object.fromEntries(st.results.map(x => [x.id, n.get(x.id) ?? 0]));
    }
    return c.json(body);
  })

  .get('/events/:id/breakdown', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const db = c.env.DB;
    const sc = scopeSql(ev.scope, ev.id);
    const [st, exp, pass] = await db.batch([
      db.prepare(STATIONS_SQL).bind(ev.id),
      db.prepare(`SELECT e.plant, e.dept, COUNT(*) AS n FROM employees e WHERE ${sc.sql} GROUP BY e.plant, e.dept ORDER BY e.plant, e.dept`)
        .bind(...sc.binds),
      db.prepare(
        `SELECT e.plant, e.dept, s.station_id AS stationId, COUNT(*) AS n
           FROM scans s JOIN employees e ON e.emp_no = s.emp_no
          WHERE s.event_id = ? AND ${FORMAL} AND ${sc.sql}
          GROUP BY e.plant, e.dept, s.station_id`,
      ).bind(ev.id, ...sc.binds),
    ]);
    logRowsRead('breakdown', [st, exp, pass]);

    const stations = st.results as unknown as ReportStation[];
    const col = new Map(stations.map((x, i) => [x.id, i]));
    const plants: BreakdownPlant[] = [];
    const groups = new Map<string, { plant: BreakdownPlant; dept: BreakdownDept }>();
    for (const g of exp.results as Array<{ plant: string; dept: string; n: number }>) {
      let plant = plants.at(-1);
      if (plant?.plant !== g.plant) plants.push(plant = { plant: g.plant, expected: 0, passed: stations.map(() => 0), depts: [] });
      const dept = { dept: g.dept, expected: g.n, passed: stations.map(() => 0) };
      plant.expected += g.n;
      plant.depts.push(dept);
      groups.set(`${g.plant}\u0000${g.dept}`, { plant, dept });
    }
    // 兩個查詢用同一個範圍條件，通過人數的群組一定也在應到的群組裡
    for (const g of pass.results as Array<{ plant: string; dept: string; stationId: string; n: number }>) {
      const { plant, dept } = groups.get(`${g.plant}\u0000${g.dept}`)!;
      const i = col.get(g.stationId)!;
      dept.passed[i] += g.n;
      plant.passed[i] += g.n;
    }
    const body: EventBreakdown = { stations, plants };
    return c.json(body);
  })

  .get('/events/:id/roster', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const db = c.env.DB;
    const sc = scopeSql(ev.scope, ev.id);
    const [st, people] = await db.batch([
      db.prepare(STATIONS_SQL).bind(ev.id),
      // 先把每人的正式紀錄依工號 GROUP BY 成 { 關卡 id: 紀錄 }，再接到範圍內在職員工
      db.prepare(
        `SELECT e.emp_no AS empNo, e.name, e.dept, e.plant, p.passes
           FROM employees e
           LEFT JOIN (
             SELECT s.emp_no, json_group_object(s.station_id, json_object(
                      'at', s.scanned_at, 'by', s.by_account, 'manual', json(iif(s.manual = 1, 'true', 'false')))) AS passes
               FROM scans s WHERE s.event_id = ? AND ${FORMAL}
              GROUP BY s.emp_no
           ) p ON p.emp_no = e.emp_no
          WHERE ${sc.sql}
          ORDER BY e.plant, e.dept, e.emp_no`,
      ).bind(ev.id, ...sc.binds),
    ]);
    logRowsRead('roster', [st, people]);
    const body: EventRoster = {
      stations: st.results as unknown as ReportStation[],
      people: (people.results as Array<Omit<RosterPerson, 'passes'> & { passes: string | null }>)
        .map(p => ({ ...p, passes: p.passes ? JSON.parse(p.passes) : {} })),
    };
    return c.json(body);
  });
