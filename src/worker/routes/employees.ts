// 員工資料：列表、匯入預覽、匯入寫入、匯入紀錄（F-EMP-4 到 F-EMP-8，規劃書第 9 節「匯入用單一查詢寫入」）

import { Hono } from 'hono';
import {
  EMP_FIELD_LABEL,
  EMP_FIELDS,
  EMP_MAX_LEN,
  EMPLOYEE_PAGE_SIZE,
  FILE_NAME_MAX_LEN,
  IMPORT_MAX_ROWS,
  type Employee,
  type EmployeeData,
  type EmployeeList,
  type ImportBody,
  type ImportLog,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
  type PreviewRow,
} from '../../shared/employees';
import { requireAuth, requireUser } from '../auth';
import { recalcStatements } from '../counts';
import { newId } from '../crypto';
import { apiError, type AppEnv } from '../env';
import { parseScope } from '../scope';

export interface ExistingEmployee extends EmployeeData {
  active: number;
}

/**
 * 比對檔案與目前的員工資料。預覽與寫入共用，寫入時一律重新比對，不採用前端送來的結果。
 * 錯誤：必填欄位空白、超過長度上限、檔案內工號重複（標在後出現的那一列）。
 */
export function classifyImport(rows: ImportRow[], existing: ExistingEmployee[]): ImportPreview {
  const byNo = new Map(existing.map(e => [e.empNo, e]));
  const firstRow = new Map<string, number>();
  const out: PreviewRow[] = rows.map(row => {
    const errors: string[] = [];
    for (const f of EMP_FIELDS) {
      if (!row[f]) errors.push(`${EMP_FIELD_LABEL[f]}空白`);
      else if (row[f].length > EMP_MAX_LEN[f]) errors.push(`${EMP_FIELD_LABEL[f]}超過 ${EMP_MAX_LEN[f]} 字`);
    }
    if (row.empNo) {
      const first = firstRow.get(row.empNo);
      if (first === undefined) firstRow.set(row.empNo, row.r);
      else errors.push(`工號與第 ${first} 列重複`);
    }
    if (errors.length) return { ...row, status: 'error', errors };
    const ex = byNo.get(row.empNo);
    if (!ex) return { ...row, status: 'new' };
    if (ex.name === row.name && ex.dept === row.dept && ex.plant === row.plant && ex.active === 1) return { ...row, status: 'same' };
    return { ...row, status: 'update', prev: { name: ex.name, dept: ex.dept, plant: ex.plant, active: ex.active === 1 } };
  });
  const deactivate = existing
    .filter(e => e.active === 1 && !firstRow.has(e.empNo))
    .map(({ empNo, name, dept, plant }) => ({ empNo, name, dept, plant }));
  const counts = { new: 0, update: 0, same: 0, error: 0, deactivate: deactivate.length };
  for (const r of out) counts[r.status]++;
  return { rows: out, deactivate, counts, activeCount: existing.filter(e => e.active === 1).length };
}

/** 檢查匯入 body 的結構；欄位空白與長度留給 classifyImport 標成該列的錯誤 */
export function parseImportBody(b: unknown): { ok: true; body: ImportBody } | { ok: false; message: string } {
  const o = b as { fileName?: unknown; rows?: unknown } | null;
  const fileName = typeof o?.fileName === 'string' ? o.fileName.trim() : '';
  if (!fileName || fileName.length > FILE_NAME_MAX_LEN) return { ok: false, message: '檔名格式不正確' };
  if (!Array.isArray(o?.rows)) return { ok: false, message: '匯入資料格式不正確' };
  if (o.rows.length === 0) return { ok: false, message: '檔案裡沒有員工資料' };
  if (o.rows.length > IMPORT_MAX_ROWS) return { ok: false, message: `一次最多匯入 ${IMPORT_MAX_ROWS} 列` };
  const rows: ImportRow[] = [];
  for (const raw of o.rows as unknown[]) {
    const x = raw as Record<string, unknown> | null;
    if (!x || typeof x !== 'object' || !Number.isInteger(x.r) || (x.r as number) < 1) return { ok: false, message: '匯入資料格式不正確' };
    const row: ImportRow = { r: x.r as number, empNo: '', name: '', dept: '', plant: '' };
    for (const f of EMP_FIELDS) {
      const v = x[f];
      if (typeof v === 'string') row[f] = v.trim();
      else if (v !== undefined && v !== null) return { ok: false, message: '匯入資料格式不正確' };
    }
    rows.push(row);
  }
  return { ok: true, body: { fileName, rows } };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

const SELECT_ALL_EMPLOYEES = 'SELECT emp_no AS empNo, name, dept, plant, active FROM employees';

export const employeeRoutes = new Hono<AppEnv>()
  .get('/employees', requireAuth, requireUser(['admin']), async c => {
    const q = (c.req.query('q') ?? '').trim();
    const includeInactive = ['1', 'true'].includes(c.req.query('includeInactive') ?? '');
    const page = Number(c.req.query('page') ?? '1');
    if (q.length > 64 || !Number.isInteger(page) || page < 1) return apiError(c, 400, 'bad_request', '查詢條件格式不正確');

    const conds: string[] = [];
    const binds: unknown[] = [];
    if (!includeInactive) conds.push('active = 1');
    if (q) {
      const like = `%${escapeLike(q)}%`;
      conds.push("(emp_no LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR dept LIKE ? ESCAPE '\\' OR plant LIKE ? ESCAPE '\\')");
      binds.push(like, like, like, like);
    }
    const where = conds.length ? conds.join(' AND ') : '1';
    const db = c.env.DB;
    const [rows, stats] = await db.batch([
      db.prepare(`SELECT emp_no, name, dept, plant, active, updated_at FROM employees WHERE ${where} ORDER BY emp_no LIMIT ? OFFSET ?`)
        .bind(...binds, EMPLOYEE_PAGE_SIZE, (page - 1) * EMPLOYEE_PAGE_SIZE),
      db.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(active), 0) AS active, COALESCE(SUM(CASE WHEN ${where} THEN 1 ELSE 0 END), 0) AS matched FROM employees`,
      ).bind(...binds),
    ]);
    const s = stats.results[0] as { n: number; active: number; matched: number };
    const res: EmployeeList = {
      rows: (rows.results as Array<{ emp_no: string; name: string; dept: string; plant: string; active: number; updated_at: number }>).map(
        (r): Employee => ({ empNo: r.emp_no, name: r.name, dept: r.dept, plant: r.plant, active: r.active === 1, updatedAt: r.updated_at }),
      ),
      total: s.matched,
      activeCount: s.active,
      inactiveCount: s.n - s.active,
    };
    return c.json(res);
  })
  .get('/employees/import-logs', requireAuth, requireUser(['admin']), async c => {
    const { results } = await c.env.DB.prepare(
      `SELECT l.id, l.created_at, l.file_name, l.added, l.updated, l.deactivated, COALESCE(u.name, '') AS user_name
         FROM import_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 20`,
    ).all<{ id: string; created_at: number; file_name: string; added: number; updated: number; deactivated: number; user_name: string }>();
    const logs: ImportLog[] = results.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      userName: r.user_name,
      fileName: r.file_name,
      added: r.added,
      updated: r.updated,
      deactivated: r.deactivated,
    }));
    return c.json(logs);
  })
  .post('/employees/import/preview', requireAuth, requireUser(['admin']), async c => {
    const p = parseImportBody(await c.req.json().catch(() => null));
    if (!p.ok) return apiError(c, 400, 'bad_request', p.message);
    const { results } = await c.env.DB.prepare(SELECT_ALL_EMPLOYEES).all<ExistingEmployee>();
    return c.json(classifyImport(p.body.rows, results));
  })
  .post('/employees/import/commit', requireAuth, requireUser(['admin']), async c => {
    const p = parseImportBody(await c.req.json().catch(() => null));
    if (!p.ok) return apiError(c, 400, 'bad_request', p.message);
    const db = c.env.DB;
    const now = Date.now();
    const [emps, events] = await db.batch([
      db.prepare(SELECT_ALL_EMPLOYEES),
      db.prepare('SELECT id, scope_type, scope_values FROM events WHERE end_at > ?').bind(now),
    ]);
    const preview = classifyImport(p.body.rows, emps.results as ExistingEmployee[]);
    if (preview.counts.error) {
      return apiError(c, 400, 'invalid_rows', `有 ${preview.counts.error} 列資料有問題，請修正 Excel 後重新匯入`);
    }
    const changed = preview.rows.filter(r => r.status === 'new' || r.status === 'update').map(r => [r.empNo, r.name, r.dept, r.plant]);
    const result: ImportResult = { added: preview.counts.new, updated: preview.counts.update, deactivated: preview.counts.deactivate };
    await db.batch([
      // 整批一個查詢：沒有變動的員工不寫入（規劃書第 9 節）。SELECT 必須帶 WHERE，SQLite 才不會把 ON CONFLICT 當成 JOIN 條件
      db.prepare(
        `INSERT INTO employees (emp_no, name, dept, plant, active, updated_at)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), 1, ?
           FROM json_each(?) WHERE true
         ON CONFLICT(emp_no) DO UPDATE SET name = excluded.name, dept = excluded.dept, plant = excluded.plant, active = 1, updated_at = excluded.updated_at
          WHERE employees.name <> excluded.name OR employees.dept <> excluded.dept OR employees.plant <> excluded.plant OR employees.active <> 1`,
      ).bind(now, JSON.stringify(changed)),
      db.prepare('UPDATE employees SET active = 0, updated_at = ? WHERE active = 1 AND emp_no IN (SELECT value FROM json_each(?))')
        .bind(now, JSON.stringify(preview.deactivate.map(e => e.empNo))),
      db.prepare('INSERT INTO import_logs (id, created_at, user_id, file_name, added, updated, deactivated) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(newId(), now, c.get('auth').id, p.body.fileName, result.added, result.updated, result.deactivated),
      ...(events.results as Array<{ id: string; scope_type: string; scope_values: string }>).flatMap(e =>
        recalcStatements(db, e.id, parseScope(e.scope_type, e.scope_values)),
      ),
    ]);
    return c.json(result);
  });
