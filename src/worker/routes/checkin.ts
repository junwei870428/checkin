// 報到端 API（規劃書第 7 節 /api/checkin/*）：只接受報到人員，且只能存取自己活動的關卡與紀錄

import { Hono, type Context } from 'hono';
import type { CheckinContext, CheckinPerson, Device, ScanResponse, VoidResponse } from '../../shared/checkin';
import { eventPhase, type StationKind } from '../../shared/event';
import { EVENT_COLUMNS, toEventRecord, type EventRow } from '../access';
import { requireAuth, requireStaff } from '../auth';
import { recalcStatements } from '../counts';
import { newId } from '../crypto';
import { apiError, type AppEnv } from '../env';
import { decideScan, type ScanDecision } from '../scan';
import { scopeSql } from '../scope';

const MAX_CODE = 64;

const first = <T>(r: D1Result) => r.results[0] as T | undefined;

/** requireStaff 之後的身分 */
function staffOf(c: Context<AppEnv>) {
  const a = c.get('auth');
  if (a.t !== 's') throw new Error('報到 API 缺少 requireStaff');
  return a;
}

const eventStmt = (db: D1Database, eventId: string) => db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(eventId);
const accountStmt = (db: D1Database, staffId: string) => db.prepare('SELECT account FROM staff_accounts WHERE id = ?').bind(staffId);

/** 關卡人數：正式讀 passed_count 快取；演練不快取，以 COUNT 計算（只在活動開始前發生） */
function countStmt(db: D1Database, stationId: string, rehearsal: boolean) {
  return rehearsal
    ? db.prepare('SELECT COUNT(*) AS n FROM scans WHERE station_id = ? AND rehearsal = 1 AND voided_at IS NULL').bind(stationId)
    : db.prepare('SELECT passed_count AS n FROM stations WHERE id = ?').bind(stationId);
}

interface ScanInput {
  stationId: string;
  code: string;
  manual: boolean;
  device: Device;
}

function parseScan(b: unknown, userAgent: string | undefined): { ok: true; value: ScanInput } | { ok: false; message: string } {
  if (typeof b !== 'object' || b === null) return { ok: false, message: '掃描資料格式錯誤' };
  const { stationId, code, manual = false, device } = b as Record<string, unknown>;
  if (typeof stationId !== 'string' || !stationId) return { ok: false, message: '請選擇關卡' };
  const empNo = typeof code === 'string' ? code.trim() : '';
  if (!empNo) return { ok: false, message: '沒有讀到工號' };
  if (empNo.length > MAX_CODE) return { ok: false, message: `掃描內容超過 ${MAX_CODE} 個字元，不是識別證的 QR code` };
  if (typeof manual !== 'boolean') return { ok: false, message: '掃描資料格式錯誤' };
  if (device !== undefined && device !== 'mobile' && device !== 'desktop') return { ok: false, message: '掃描資料格式錯誤' };
  const fromUA: Device = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? '') ? 'mobile' : 'desktop';
  return { ok: true, value: { stationId, code: empNo, manual, device: device ?? fromUA } };
}

function toResponse(d: Exclude<ScanDecision, { kind: 'insert' }>, passedCount: number): ScanResponse {
  const base = { rehearsal: d.rehearsal, passedCount, scan: null };
  if (d.kind === 'dup') return { ...base, status: 'dup', reason: null, employee: d.employee, previous: d.previous };
  return 'employee' in d
    ? { ...base, status: 'error', reason: d.reason, employee: d.employee, previous: null }
    : { ...base, status: 'error', reason: d.reason, employee: null, previous: null };
}

export const checkinRoutes = new Hono<AppEnv>()
  .get('/checkin/context', requireAuth, requireStaff, async c => {
    const a = staffOf(c);
    const db = c.env.DB;
    const [evRes, stRes] = await db.batch([
      eventStmt(db, a.eventId),
      db.prepare('SELECT id, name, kind, require_checkin, passed_count FROM stations WHERE event_id = ? ORDER BY sort_order, rowid').bind(a.eventId),
    ]);
    const ev = toEventRecord(first<EventRow>(evRes)!);
    const phase = eventPhase(ev, Date.now());
    const s = scopeSql(ev.scope, ev.id);
    const [totalRes, rehearsalRes] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS n FROM employees e WHERE ${s.sql}`).bind(...s.binds),
      ...(phase === 'rehearsal'
        ? [db.prepare('SELECT station_id, COUNT(*) AS n FROM scans WHERE event_id = ? AND rehearsal = 1 AND voided_at IS NULL GROUP BY station_id').bind(ev.id)]
        : []),
    ]);
    const rehearsalCounts = new Map((rehearsalRes?.results as Array<{ station_id: string; n: number }> | undefined)?.map(r => [r.station_id, r.n]));
    const stations = stRes.results as Array<{ id: string; name: string; kind: StationKind; require_checkin: number; passed_count: number }>;
    const body: CheckinContext = {
      event: { id: ev.id, name: ev.name, startAt: ev.startAt, endAt: ev.endAt, rehearsal: ev.rehearsal },
      phase,
      stations: stations.map(x => ({
        id: x.id,
        name: x.name,
        kind: x.kind,
        requireCheckin: x.require_checkin === 1,
        passedCount: phase === 'rehearsal' ? rehearsalCounts.get(x.id) ?? 0 : x.passed_count,
      })),
      scopeTotal: first<{ n: number }>(totalRes)!.n,
    };
    return c.json(body);
  })
  .get('/checkin/people', requireAuth, requireStaff, async c => {
    const a = staffOf(c);
    const db = c.env.DB;
    const ev = toEventRecord((await eventStmt(db, a.eventId).first<EventRow>())!);
    const s = scopeSql(ev.scope, ev.id);
    const { results } = await db.prepare(
      `SELECT e.emp_no AS empNo, e.name, e.dept, e.plant FROM employees e WHERE ${s.sql} ORDER BY e.plant, e.dept, e.emp_no`,
    ).bind(...s.binds).all<CheckinPerson>();
    return c.json(results);
  })
  .post('/checkin/scan', requireAuth, requireStaff, async c => {
    const a = staffOf(c);
    const p = parseScan(await c.req.json().catch(() => null), c.req.header('user-agent'));
    if (!p.ok) return apiError(c, 400, 'bad_request', p.message);
    const { stationId, code, manual, device } = p.value;
    const db = c.env.DB;

    // 一次取齊第 4 節要比對的資料，全部是索引點查
    const [evRes, accRes, stRes, empRes, memRes, scansRes] = await db.batch([
      eventStmt(db, a.eventId),
      accountStmt(db, a.id),
      db.prepare('SELECT kind, require_checkin, passed_count FROM stations WHERE id = ? AND event_id = ?').bind(stationId, a.eventId),
      db.prepare('SELECT emp_no, name, dept, plant, active FROM employees WHERE emp_no = ?').bind(code),
      db.prepare('SELECT 1 FROM event_members WHERE event_id = ? AND emp_no = ?').bind(a.eventId, code),
      db.prepare(
        `SELECT s.station_id, st.kind, s.rehearsal, s.scanned_at, s.by_account
           FROM stations st JOIN scans s ON s.station_id = st.id
          WHERE st.event_id = ? AND s.emp_no = ? AND s.voided_at IS NULL`,
      ).bind(a.eventId, code),
    ]);
    const station = first<{ kind: StationKind; require_checkin: number; passed_count: number }>(stRes);
    if (!station) return apiError(c, 400, 'bad_station', '這個關卡不屬於本活動');
    const ev = toEventRecord(first<EventRow>(evRes)!);
    const emp = first<{ emp_no: string; name: string; dept: string; plant: string; active: number }>(empRes);
    const scans = scansRes.results as Array<{ station_id: string; kind: StationKind; rehearsal: number; scanned_at: number; by_account: string }>;

    const now = Date.now();
    const d = decideScan({
      event: { startAt: ev.startAt, endAt: ev.endAt, rehearsal: ev.rehearsal, scope: ev.scope },
      station: { id: stationId, kind: station.kind, requireCheckin: station.require_checkin === 1 },
      employee: emp ? { empNo: emp.emp_no, name: emp.name, dept: emp.dept, plant: emp.plant, active: emp.active } : null,
      isMember: memRes.results.length > 0,
      activeScans: scans.map(x => ({
        stationId: x.station_id,
        stationKind: x.kind,
        rehearsal: x.rehearsal === 1,
        scannedAt: x.scanned_at,
        byAccount: x.by_account,
      })),
    }, now);

    if (d.kind !== 'insert') {
      const passedCount = d.rehearsal ? (await countStmt(db, stationId, true).first<number>('n'))! : station.passed_count;
      return c.json(toResponse(d, passedCount));
    }

    // 多台裝置同時掃到同一人時由部分唯一索引擋下，寫入 0 列就回傳先寫入的那筆
    const id = newId();
    const account = first<{ account: string }>(accRes)!.account;
    const rehearsal = d.rehearsal ? 1 : 0;
    const [ins, activeRes, countRes] = await db.batch([
      db.prepare(
        `INSERT INTO scans (id, event_id, station_id, emp_no, rehearsal, scanned_at, by_account, device, manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ).bind(id, a.eventId, stationId, d.employee.empNo, rehearsal, now, account, device, manual ? 1 : 0),
      db.prepare('SELECT scanned_at, by_account FROM scans WHERE station_id = ? AND emp_no = ? AND rehearsal = ? AND voided_at IS NULL')
        .bind(stationId, d.employee.empNo, rehearsal),
      countStmt(db, stationId, d.rehearsal),
    ]);
    const passedCount = first<{ n: number }>(countRes)!.n;
    // 只能看是否為 0：D1 的 changes 含 trigger 改到的列，正式紀錄寫入時是 2
    if (ins.meta.changes === 0) {
      const prev = first<{ scanned_at: number; by_account: string }>(activeRes)!;
      const previous = { scannedAt: prev.scanned_at, byAccount: prev.by_account };
      return c.json(toResponse({ kind: 'dup', rehearsal: d.rehearsal, employee: d.employee, previous }, passedCount));
    }
    const body: ScanResponse = {
      status: 'ok', reason: null, rehearsal: d.rehearsal, employee: d.employee,
      scan: { id, scannedAt: now, byAccount: account }, previous: null, passedCount,
    };
    return c.json(body);
  })
  .post('/checkin/void', requireAuth, requireStaff, async c => {
    const a = staffOf(c);
    const b: unknown = await c.req.json().catch(() => null);
    const scanId = typeof b === 'object' && b !== null ? (b as Record<string, unknown>).scanId : undefined;
    if (typeof scanId !== 'string' || !scanId) return apiError(c, 400, 'bad_request', '請指定要撤銷的紀錄');
    const db = c.env.DB;
    const [scanRes, evRes, accRes] = await db.batch([
      db.prepare('SELECT station_id, rehearsal, voided_at FROM scans WHERE id = ? AND event_id = ?').bind(scanId, a.eventId),
      eventStmt(db, a.eventId),
      accountStmt(db, a.id),
    ]);
    const scan = first<{ station_id: string; rehearsal: number; voided_at: number | null }>(scanRes);
    if (!scan) return apiError(c, 404, 'not_found', '找不到這筆紀錄');
    if (scan.voided_at !== null) return apiError(c, 400, 'already_voided', '此紀錄已撤銷');
    const ev = toEventRecord(first<EventRow>(evRes)!);
    const rehearsal = scan.rehearsal === 1;
    // 撤銷只填 voided_at、voided_by；正式紀錄撤銷後以 COUNT 重算人數，同一批完成
    const results = await db.batch([
      db.prepare('UPDATE scans SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL')
        .bind(Date.now(), first<{ account: string }>(accRes)!.account, scanId),
      ...(rehearsal ? [] : recalcStatements(db, ev.id, ev.scope)),
      countStmt(db, scan.station_id, rehearsal),
    ]);
    // 兩台裝置同時撤銷同一筆時，後到的那台不會再改到資料
    if (results[0].meta.changes === 0) return apiError(c, 400, 'already_voided', '此紀錄已撤銷');
    const body: VoidResponse = { passedCount: first<{ n: number }>(results[results.length - 1])!.n };
    return c.json(body);
  });
