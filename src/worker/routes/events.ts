// 活動 API（第 3 階段）：列表、建立、設定、名單、演練、結束、刪除與參加範圍選項。
// summary、breakdown、roster 在 reports.ts，報到人員帳號在 staff.ts。

import { Hono, type Context } from 'hono';
import { eventPhase, RETAIN_MS, type EventDetail, type Scope, type StationKind } from '../../shared/event';
import {
  CODE_RE, MAX_MEMBERS, MAX_STATIONS, NAME_MAX, STATION_NAME_MAX,
  type CreateEventBody, type EventListItem, type MembersResult, type ScopeGroup, type ScopeOptions, type StationInput, type UpdateEventBody,
} from '../../shared/events-admin';
import { EVENT_COLUMNS, loadEventFor, toEventRecord, type EventRow } from '../access';
import { requireAuth, requireUser } from '../auth';
import { recalcStatements } from '../counts';
import { newId } from '../crypto';
import { apiError, type AppEnv } from '../env';
import { scopeSql, serializeScope } from '../scope';

interface StationRow {
  id: string;
  name: string;
  kind: StationKind;
  require_checkin: number;
  sort_order: number;
  passed_count: number;
}

const DEFAULT_STATIONS = [
  { name: '入場報到', kind: 'checkin', requireCheckin: 0 },
  { name: '領取禮品', kind: 'gift', requireCheckin: 1 },
] as const;

const bad = (c: Context, message: string) => apiError(c, 400, 'bad_request', message);
const readJson = (c: Context): Promise<any> => c.req.json().catch(() => null);

/* ---------- 請求內容解析（回傳字串代表錯誤訊息） ---------- */

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function parseTimes(b: any): { startAt: number; endAt: number } | string {
  if (!isTime(b?.startAt) || !isTime(b?.endAt)) return '請輸入開始與結束時間';
  if (b.endAt <= b.startAt) return '結束時間必須晚於開始時間';
  return { startAt: b.startAt, endAt: b.endAt };
}

function parseCreate(b: any, now: number): CreateEventBody | string {
  const name = text(b?.name, NAME_MAX);
  if (!name) return `請輸入活動名稱（${NAME_MAX} 字以內）`;
  const code = typeof b?.code === 'string' ? b.code.trim().toUpperCase() : '';
  if (!CODE_RE.test(code)) return '帳號代碼必須是 2 到 8 碼英文字母或數字';
  const t = parseTimes(b);
  if (typeof t === 'string') return t;
  if (t.endAt <= now) return '結束時間必須晚於現在';
  return { name, code, ...t };
}

function uniqStrings(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = new Set<string>();
  for (const x of v) {
    const s = text(x, 100);
    if (!s) return null;
    out.add(s);
  }
  return [...out];
}

function parseScopeInput(v: any): Scope | string {
  switch (v?.type) {
    case 'all':
      return { type: 'all' };
    case 'list':
      return { type: 'list' };
    case 'plants': {
      const plants = uniqStrings(v.plants, 500);
      if (!plants) return '廠別格式錯誤';
      if (!plants.length) return '請至少選擇一個廠別';
      return { type: 'plants', plants };
    }
    case 'depts': {
      if (!Array.isArray(v.depts) || v.depts.length > 2000) return '部門格式錯誤';
      const seen = new Map<string, [string, string]>();
      for (const p of v.depts) {
        const plant = Array.isArray(p) && p.length === 2 ? text(p[0], 100) : null;
        const dept = plant ? text(p[1], 100) : null;
        if (!plant || !dept) return '部門格式錯誤';
        seen.set(JSON.stringify([plant, dept]), [plant, dept]);
      }
      if (!seen.size) return '請至少選擇一個部門';
      return { type: 'depts', depts: [...seen.values()] };
    }
  }
  return '參加範圍格式錯誤';
}

function parseUpdate(b: any): UpdateEventBody | string {
  const name = text(b?.name, NAME_MAX);
  if (!name) return `請輸入活動名稱（${NAME_MAX} 字以內）`;
  const t = parseTimes(b);
  if (typeof t === 'string') return t;
  const scope = parseScopeInput(b?.scope);
  if (typeof scope === 'string') return scope;
  if (!Array.isArray(b?.stations) || b.stations.length > MAX_STATIONS) return `關卡最多 ${MAX_STATIONS} 個`;
  const stations: StationInput[] = [];
  for (const s of b.stations) {
    const sname = text(s?.name, STATION_NAME_MAX);
    if (!sname) return `請輸入關卡名稱（${STATION_NAME_MAX} 字以內）`;
    if (s.id !== undefined && typeof s.id !== 'string') return '關卡格式錯誤';
    stations.push({ id: s.id, name: sname, requireCheckin: s.requireCheckin === true });
  }
  return { name, ...t, scope, stations };
}

function parseEmpNos(v: unknown): string[] | string {
  if (!Array.isArray(v) || v.length > MAX_MEMBERS * 2) return `名單最多 ${MAX_MEMBERS} 人`;
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || x.trim().length > 64) return '工號格式錯誤';
    if (x.trim()) out.add(x.trim());
  }
  if (out.size > MAX_MEMBERS) return `名單最多 ${MAX_MEMBERS} 人`;
  return [...out];
}

/* ---------- 關卡異動（F-EVT-4） ---------- */

interface CurrentStation {
  id: string;
  name: string;
  kind: StationKind;
  used: number;
}

interface StationPlan {
  updates: Array<{ id: string; name: string; requireCheckin: boolean; sortOrder: number }>;
  inserts: Array<{ name: string; requireCheckin: boolean; sortOrder: number }>;
  deletes: string[];
}

/** 比對目前關卡與送來的完整陣列；入場報到關卡或已有掃描紀錄的關卡被刪除時回傳錯誤訊息，整個請求不寫入 */
function planStations(current: CurrentStation[], input: StationInput[]): StationPlan | string {
  const byId = new Map(current.map(s => [s.id, s]));
  const kept = new Set<string>();
  const plan: StationPlan = { updates: [], inserts: [], deletes: [] };
  for (const [sortOrder, s] of input.entries()) {
    if (s.id === undefined) {
      plan.inserts.push({ name: s.name, requireCheckin: s.requireCheckin, sortOrder });
      continue;
    }
    const cur = byId.get(s.id);
    if (!cur || kept.has(s.id)) return '關卡資料已變更，請重新整理後再試';
    kept.add(s.id);
    plan.updates.push({ id: s.id, name: s.name, requireCheckin: cur.kind === 'gift' && s.requireCheckin, sortOrder });
  }
  for (const s of current) {
    if (kept.has(s.id)) continue;
    if (s.kind === 'checkin') return '入場報到關卡不能刪除';
    if (s.used) return `「${s.name}」已有掃描紀錄，不能刪除`;
    plan.deletes.push(s.id);
  }
  return plan;
}

/* ---------- 路由 ---------- */

export const eventRoutes = new Hono<AppEnv>()
  .get('/events', requireAuth, requireUser(), async c => {
    const a = c.get('auth');
    const db = c.env.DB;
    const rows = (a.t === 'u' && a.role === 'admin'
      ? await db.prepare(`SELECT ${EVENT_COLUMNS} FROM events ORDER BY start_at DESC`).all<EventRow>()
      : await db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE owner_id = ? ORDER BY start_at DESC`).bind(a.id).all<EventRow>()
    ).results;
    if (!rows.length) return c.json([] satisfies EventListItem[]);
    const events = rows.map(toEventRecord);
    // 每場活動一個 COUNT；活動結束 10 天後即刪除，同時存在的活動數遠低於每次請求 50 個查詢的上限
    const [st, ...totals] = await db.batch([
      db.prepare(
        `SELECT event_id, id, name, kind, passed_count FROM stations
          WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, rowid`,
      ).bind(JSON.stringify(events.map(e => e.id))),
      ...events.map(e => {
        const s = scopeSql(e.scope, e.id);
        return db.prepare(`SELECT COUNT(*) AS n FROM employees e WHERE ${s.sql}`).bind(...s.binds);
      }),
    ]);
    const stations = st.results as Array<{ event_id: string; id: string; name: string; kind: StationKind; passed_count: number }>;
    const list: EventListItem[] = events.map((e, i) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      ownerId: e.ownerId,
      startAt: e.startAt,
      endAt: e.endAt,
      rehearsal: e.rehearsal,
      deleteAt: e.endAt + RETAIN_MS,
      total: (totals[i].results[0] as { n: number }).n,
      stations: stations.filter(s => s.event_id === e.id).map(s => ({ id: s.id, name: s.name, kind: s.kind, passedCount: s.passed_count })),
    }));
    return c.json(list);
  })

  .post('/events', requireAuth, requireUser(), async c => {
    const now = Date.now();
    const b = parseCreate(await readJson(c), now);
    if (typeof b === 'string') return bad(c, b);
    const db = c.env.DB;
    const id = newId();
    const codeTaken = () => apiError(c, 400, 'code_taken', `帳號代碼 ${b.code} 已被其他活動使用，請換一個`);
    if (await db.prepare('SELECT 1 FROM events WHERE code = ?').bind(b.code).first()) return codeTaken();
    // 兩人同時建立同一代碼時，上面的檢查都會通過，由唯一索引擋下後到的那一筆
    try {
      await db.batch([
        db.prepare(
          `INSERT INTO events (id, name, code, owner_id, start_at, end_at, rehearsal, scope_type, scope_values, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'all', '[]', ?)`,
        ).bind(id, b.name, b.code, c.get('auth').id, b.startAt, b.endAt, now),
        ...DEFAULT_STATIONS.map((s, i) =>
          db.prepare('INSERT INTO stations (id, event_id, name, kind, require_checkin, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(newId(), id, s.name, s.kind, s.requireCheckin, i),
        ),
      ]);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE constraint failed: events.code')) return codeTaken();
      throw e;
    }
    return c.json({ id }, 201);
  })

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
  })

  .put('/events/:id', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const u = parseUpdate(await readJson(c));
    if (typeof u === 'string') return bad(c, u);
    if (eventPhase(ev, Date.now()) === 'ended' && (u.startAt !== ev.startAt || u.endAt !== ev.endAt)) {
      return bad(c, '活動已結束，開始與結束時間不能再修改');
    }
    const db = c.env.DB;
    const { results: current } = await db.prepare(
      `SELECT s.id, s.name, s.kind, EXISTS (SELECT 1 FROM scans x WHERE x.event_id = s.event_id AND x.station_id = s.id) AS used
         FROM stations s WHERE s.event_id = ?`,
    ).bind(ev.id).all<CurrentStation>();
    const plan = planStations(current, u.stations);
    if (typeof plan === 'string') return bad(c, plan);

    const next = serializeScope(u.scope);
    const prev = serializeScope(ev.scope);
    const scopeChanged = next.scope_type !== prev.scope_type || next.scope_values !== prev.scope_values;
    await db.batch([
      db.prepare('UPDATE events SET name = ?, start_at = ?, end_at = ?, scope_type = ?, scope_values = ? WHERE id = ?')
        .bind(u.name, u.startAt, u.endAt, next.scope_type, next.scope_values, ev.id),
      // 檢查後到寫入前若剛好有人掃描，這一筆不刪除，避免外鍵連帶刪掉掃描紀錄
      ...plan.deletes.map(id =>
        db.prepare('DELETE FROM stations WHERE id = ? AND NOT EXISTS (SELECT 1 FROM scans WHERE event_id = ? AND station_id = ?)')
          .bind(id, ev.id, id),
      ),
      ...plan.updates.map(s =>
        db.prepare('UPDATE stations SET name = ?, require_checkin = ?, sort_order = ? WHERE id = ?')
          .bind(s.name, s.requireCheckin ? 1 : 0, s.sortOrder, s.id),
      ),
      ...plan.inserts.map(s =>
        db.prepare("INSERT INTO stations (id, event_id, name, kind, require_checkin, sort_order) VALUES (?, ?, ?, 'gift', ?, ?)")
          .bind(newId(), ev.id, s.name, s.requireCheckin ? 1 : 0, s.sortOrder),
      ),
      ...(scopeChanged ? recalcStatements(db, ev.id, u.scope) : []),
    ]);
    return c.json({ ok: true });
  })

  .post('/events/:id/members', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const empNos = parseEmpNos((await readJson(c))?.empNos);
    if (typeof empNos === 'string') return bad(c, empNos);
    const db = c.env.DB;
    const list = scopeSql({ type: 'list' }, ev.id);
    const res = await db.batch([
      db.prepare('DELETE FROM event_members WHERE event_id = ?').bind(ev.id),
      db.prepare('INSERT INTO event_members (event_id, emp_no) SELECT ?, value FROM json_each(?)').bind(ev.id, JSON.stringify(empNos)),
      ...(ev.scope.type === 'list' ? recalcStatements(db, ev.id, ev.scope) : []),
      db.prepare(
        'SELECT m.emp_no FROM event_members m WHERE m.event_id = ? AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.emp_no = m.emp_no) ORDER BY m.emp_no',
      ).bind(ev.id),
      db.prepare(`SELECT COUNT(*) AS n FROM employees e WHERE ${list.sql}`).bind(...list.binds),
    ]);
    const unknown = res.at(-2)!.results as Array<{ emp_no: string }>;
    const out: MembersResult = {
      count: empNos.length,
      unknown: unknown.map(x => x.emp_no),
      active: (res.at(-1)!.results[0] as { n: number }).n,
    };
    return c.json(out);
  })

  .post('/events/:id/rehearsal', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const on = (await readJson(c))?.on;
    if (typeof on !== 'boolean') return bad(c, '請指定開啟或關閉演練模式');
    const phase = eventPhase(r.event, Date.now());
    if (phase !== 'not_started' && phase !== 'rehearsal') {
      return bad(c, phase === 'ended' ? '活動已結束，不能切換演練模式' : '活動已開始，不能切換演練模式');
    }
    await c.env.DB.prepare('UPDATE events SET rehearsal = ? WHERE id = ?').bind(on ? 1 : 0, r.event.id).run();
    return c.json({ rehearsal: on });
  })

  .post('/events/:id/close', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const now = Date.now();
    if (eventPhase(r.event, now) === 'ended') return bad(c, '活動已經結束');
    // 尚未開始就結束時，開始時間一併設為現在，避免開始晚於結束
    await c.env.DB.prepare('UPDATE events SET end_at = ?, start_at = MIN(start_at, ?) WHERE id = ?').bind(now, now, r.event.id).run();
    return c.json({ endAt: now });
  })

  .post('/events/:id/clear-rehearsal', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const db = c.env.DB;
    const [del] = await db.batch([
      db.prepare('DELETE FROM scans WHERE event_id = ? AND rehearsal = 1').bind(r.event.id),
      db.prepare('UPDATE events SET rehearsal = 0 WHERE id = ?').bind(r.event.id),
    ]);
    return c.json({ deleted: del.meta.changes });
  })

  .delete('/events/:id', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const db = c.env.DB;
    const id = r.event.id;
    await db.batch(
      ['scans', 'staff_accounts', 'event_members', 'stations'].map(t => db.prepare(`DELETE FROM ${t} WHERE event_id = ?`).bind(id))
        .concat(db.prepare('DELETE FROM events WHERE id = ?').bind(id)),
    );
    return c.json({ ok: true });
  })

  // 規劃書第 7 節沒有列出，設定參加範圍時需要廠別、部門選項與即時人數（F-EVT-3）
  .get('/scope-options', requireAuth, requireUser(), async c => {
    const db = c.env.DB;
    const groups = db.prepare(
      'SELECT plant, dept, COUNT(*) AS count FROM employees WHERE active = 1 GROUP BY plant, dept ORDER BY plant, dept',
    );
    const eventId = c.req.query('eventId');
    if (!eventId) {
      const out: ScopeOptions = { groups: (await groups.all<ScopeGroup>()).results };
      return c.json(out);
    }
    const r = await loadEventFor(c, eventId);
    if (!r.ok) return r.response;
    const list = scopeSql({ type: 'list' }, r.event.id);
    const [g, m] = await db.batch([groups, db.prepare(`SELECT COUNT(*) AS n FROM employees e WHERE ${list.sql}`).bind(...list.binds)]);
    const out: ScopeOptions = { groups: g.results as unknown as ScopeGroup[], listActive: (m.results[0] as { n: number }).n };
    return c.json(out);
  });
