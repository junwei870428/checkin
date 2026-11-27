// 以 node:sqlite 模擬 D1，讓路由測試不用起 wrangler。
// 只實作路由會用到的部分：prepare().bind().first/all/run/raw、batch（單一交易）、exec。
// meta.changes 與 D1 相同只算該語句本身影響的列（不含 trigger），rows_read 一律為 0，量讀取請用 wrangler dev 實測。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { Scope, StationKind } from '../../src/shared/event';
import type { Role } from '../../src/shared/types';
import { COOKIE_NAME, signSession } from '../../src/worker/auth';
import { hashSecret, newId, newSalt } from '../../src/worker/crypto';
import type { Bindings } from '../../src/worker/env';
import worker from '../../src/worker/index';
import { serializeScope } from '../../src/worker/scope';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

type Row = Record<string, unknown>;

function toParam(v: unknown): SQLInputValue {
  if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
}

class ShimD1 {
  private readonly db = new DatabaseSync(':memory:');
  private readonly totalChanges: StatementSync;
  private readonly lastWrite: StatementSync;

  constructor() {
    this.db.exec('PRAGMA foreign_keys = ON');
    for (const f of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
      this.db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    }
    this.totalChanges = this.db.prepare('SELECT total_changes() AS n');
    this.lastWrite = this.db.prepare('SELECT changes() AS n, last_insert_rowid() AS id');
  }

  /** 同步執行一個語句；batch 靠同步執行保證整批不被其他請求插隊 */
  execute(sql: string, params: SQLInputValue[], arrays: boolean) {
    try {
      const stmt = this.db.prepare(sql);
      stmt.setReturnArrays(arrays);
      const before = this.totalChanges.get()!.n as number;
      const results = stmt.all(...params) as unknown[];
      const written = (this.totalChanges.get()!.n as number) - before;
      const last = this.lastWrite.get()!;
      return {
        results: arrays ? results : results.map(r => ({ ...(r as Row) })),
        columns: stmt.columns().map(c => c.name),
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: 0,
          rows_written: written,
          last_row_id: last.id as number,
          changed_db: written > 0,
          changes: written > 0 ? (last.n as number) : 0,
        },
      };
    } catch (e) {
      throw new Error(`D1_ERROR: ${(e as Error).message}`, { cause: e });
    }
  }

  prepare(sql: string) {
    return new ShimStatement(this, sql, []);
  }

  async batch(stmts: ShimStatement[]) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map(s => s.result());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return { count: sql.split(';').filter(s => s.trim()).length, duration: 0 };
  }
}

class ShimStatement {
  constructor(private readonly d1: ShimD1, private readonly sql: string, private readonly params: SQLInputValue[]) {}

  bind(...values: unknown[]) {
    return new ShimStatement(this.d1, this.sql, values.map(toParam));
  }

  result(): D1Result<Row> {
    const { results, meta } = this.d1.execute(this.sql, this.params, false);
    return { success: true, results: results as Row[], meta };
  }

  async all() {
    return this.result();
  }

  async run() {
    return this.result();
  }

  async first(col?: string) {
    const row = this.result().results[0];
    if (!row) return null;
    if (col === undefined) return row;
    if (!(col in row)) throw new Error('D1_ERROR: Column not found');
    return row[col];
  }

  async raw(opts?: { columnNames?: boolean }) {
    const { results, columns } = this.d1.execute(this.sql, this.params, true);
    return opts?.columnNames ? [columns, ...results] : results;
  }
}

/* ---------- 測試用環境與請求 ---------- */

/** 每次呼叫都是一個全新的記憶體資料庫，已套用 migrations/ 與外鍵檢查 */
export function makeEnv(): Bindings {
  return { DB: new ShimD1() as unknown as D1Database, SESSION_SECRET: 'test-session-secret', PEPPER: 'test-pepper' };
}

/** 直接簽一個有效 1 小時的登入 Cookie，回傳可放進 Cookie header 的字串 */
export async function cookieFor(env: Bindings, p: { t: 'u' | 's'; id: string; ver?: number }): Promise<string> {
  const token = await signSession(env.SESSION_SECRET, { t: p.t, id: p.id, ver: p.ver ?? 0, exp: Date.now() + 3600_000 });
  return `${COOKIE_NAME}=${token}`;
}

export interface CallResult<T> {
  status: number;
  json: T;
  headers: Headers;
}

/** 經過 src/worker/index.ts 的完整 app 打一次 API；path 含 /api。非 GET 一律送 JSON（body 預設 {}） */
export async function call<T = any>(
  env: Bindings,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<CallResult<T>> {
  const write = method !== 'GET' && method !== 'HEAD';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (write) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers.Cookie = opts.cookie;
  const req = new Request(`http://localhost${path}`, { method, headers, body: write ? JSON.stringify(opts.body ?? {}) : undefined });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

/* ---------- 種子資料（直接寫入資料表） ---------- */

export async function seedUser(
  env: Bindings,
  o: { username?: string; name?: string; role?: Role; password?: string; disabled?: boolean } = {},
) {
  const id = newId();
  const username = o.username ?? `user-${id.slice(0, 8)}`;
  const password = o.password ?? 'test-password';
  const salt = newSalt();
  await env.DB.prepare(
    'INSERT INTO users (id, username, name, role, pwd_salt, pwd_hash, disabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, username, o.name ?? username, o.role ?? 'organizer', salt, await hashSecret(env.PEPPER, salt, password), o.disabled ? 1 : 0, Date.now()).run();
  return { id, username, password, cookie: await cookieFor(env, { t: 'u', id }) };
}

export interface SeedStation {
  name: string;
  kind: StationKind;
  requireCheckin?: boolean;
}

/** 與建立活動時相同的預設關卡（F-EVT-2） */
export const DEFAULT_STATIONS: SeedStation[] = [
  { name: '入場報到', kind: 'checkin' },
  { name: '領取禮品', kind: 'gift', requireCheckin: true },
];

/** 預設為進行中的活動（1 小時前開始、1 小時後結束）、範圍全公司、兩個預設關卡 */
export async function seedEvent(
  env: Bindings,
  o: {
    ownerId: string;
    name?: string;
    code?: string;
    startAt?: number;
    endAt?: number;
    rehearsal?: boolean;
    scope?: Scope;
    members?: string[];
    stations?: SeedStation[];
  },
) {
  const id = newId();
  const now = Date.now();
  const code = o.code ?? `E${id.replace(/-/g, '').slice(0, 7).toUpperCase()}`;
  const { scope_type, scope_values } = serializeScope(o.scope ?? { type: 'all' });
  const stations = (o.stations ?? DEFAULT_STATIONS).map((s, i) => ({ ...s, id: newId(), sortOrder: i }));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events (id, name, code, owner_id, start_at, end_at, rehearsal, scope_type, scope_values, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, o.name ?? `活動 ${code}`, code, o.ownerId, o.startAt ?? now - 3600_000, o.endAt ?? now + 3600_000, o.rehearsal ? 1 : 0, scope_type, scope_values, now),
    ...(o.members ?? []).map(empNo => env.DB.prepare('INSERT INTO event_members (event_id, emp_no) VALUES (?, ?)').bind(id, empNo)),
    ...stations.map(s =>
      env.DB.prepare('INSERT INTO stations (id, event_id, name, kind, require_checkin, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(s.id, id, s.name, s.kind, s.requireCheckin ? 1 : 0, s.sortOrder),
    ),
  ]);
  return { id, code, stationIds: stations.map(s => s.id) };
}

export async function seedEmployees(
  env: Bindings,
  rows: Array<{ empNo: string; name?: string; dept?: string; plant?: string; active?: boolean }>,
) {
  if (!rows.length) return;
  await env.DB.batch(rows.map(r =>
    env.DB.prepare('INSERT INTO employees (emp_no, name, dept, plant, active, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(r.empNo, r.name ?? `員工${r.empNo}`, r.dept ?? '資訊室', r.plant ?? '台中廠', r.active === false ? 0 : 1, Date.now()),
  ));
}

export async function seedStaff(env: Bindings, o: { eventId: string; account: string; pin?: string; disabled?: boolean }) {
  const id = newId();
  const account = o.account.toUpperCase();
  const pin = o.pin ?? '123456';
  const salt = newSalt();
  await env.DB.prepare(
    'INSERT INTO staff_accounts (id, event_id, account, pin_salt, pin_hash, disabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, o.eventId, account, salt, await hashSecret(env.PEPPER, salt, pin), o.disabled ? 1 : 0, Date.now()).run();
  return { id, account, pin, cookie: await cookieFor(env, { t: 's', id }) };
}

/** 直接寫入一筆掃描紀錄；正式且未撤銷時 trigger 會把 passed_count 加 1，與實際掃描相同 */
export async function seedScan(
  env: Bindings,
  o: { eventId: string; stationId: string; empNo: string; rehearsal?: boolean; voided?: boolean; manual?: boolean; byAccount?: string; scannedAt?: number },
) {
  const id = newId();
  const at = o.scannedAt ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO scans (id, event_id, station_id, emp_no, rehearsal, scanned_at, by_account, device, manual, voided_at, voided_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'desktop', ?, ?, ?)`,
  ).bind(id, o.eventId, o.stationId, o.empNo, o.rehearsal ? 1 : 0, at, o.byAccount ?? 'TEST-01', o.manual ? 1 : 0,
    o.voided ? at : null, o.voided ? (o.byAccount ?? 'TEST-01') : null).run();
  return id;
}
