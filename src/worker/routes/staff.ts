// 報到人員帳號 API（F-ACC-2）：/api/events/:id/staff、/api/staff/*。PIN 只在產生或重設當下回傳一次。

import { Hono, type Context } from 'hono';
import { eventPhase } from '../../shared/event';
import { parseHolder, STAFF_BATCH_MAX, type StaffAccount, type StaffAction, type StaffSecret } from '../../shared/events-admin';
import { loadEventFor, type EventRecord } from '../access';
import { audit, eventLabel } from '../audit';
import { requireAuth, requireUser } from '../auth';
import { genPin, hashSecret, newId, newSalt } from '../crypto';
import { apiError, type AppEnv } from '../env';

interface StaffRow {
  id: string;
  account: string;
  holder: string;
  disabled: number;
  lock_until: number;
}

const STAFF_COLUMNS = 'id, account, holder, disabled, lock_until';

const toStaffAccount = (r: StaffRow): StaffAccount => ({ id: r.id, account: r.account, holder: r.holder, disabled: r.disabled === 1, lockUntil: r.lock_until });

/** 帳號格式「代碼-流水號」，流水號至少 2 位數，例如 XMAS-01、XMAS-100 */
export const staffAccountName = (code: string, n: number) => `${code}-${String(n).padStart(2, '0')}`;

/** 目前已用到的最大流水號，新的一批從下一號開始 */
function maxSerial(code: string, accounts: string[]): number {
  let max = 0;
  for (const a of accounts) {
    const n = Number(a.slice(code.length + 1));
    if (a.startsWith(`${code}-`) && Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/** 讀取報到帳號並確認登入者可操作它所屬的活動；不存在與無權限都回同樣的 404 */
async function loadStaffFor(
  c: Context<AppEnv>,
  id: string,
): Promise<{ ok: true; staff: StaffRow; event: EventRecord } | { ok: false; response: Response }> {
  const staff = await c.env.DB.prepare(`SELECT ${STAFF_COLUMNS}, event_id FROM staff_accounts WHERE id = ?`)
    .bind(id).first<StaffRow & { event_id: string }>();
  const r = staff ? await loadEventFor(c, staff.event_id) : null;
  if (!staff || !r?.ok) return { ok: false, response: apiError(c, 404, 'not_found', '找不到這個報到帳號') };
  return { ok: true, staff, event: r.event };
}

const ENDED_MESSAGE = '活動已結束，報到人員帳號已失效';

const ACTION_SQL: Record<StaffAction, string> = {
  disable: 'disabled = 1, session_ver = session_ver + 1',
  enable: 'disabled = 0',
  unlock: 'fails = 0, lock_until = 0',
};

export const staffRoutes = new Hono<AppEnv>()
  .get('/events/:id/staff', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const { results } = await c.env.DB.prepare(
      `SELECT ${STAFF_COLUMNS} FROM staff_accounts WHERE event_id = ? ORDER BY length(account), account`,
    ).bind(r.event.id).all<StaffRow>();
    return c.json(results.map(toStaffAccount));
  })

  .post('/events/:id/staff', requireAuth, requireUser(), async c => {
    const r = await loadEventFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const ev = r.event;
    const raw = (await c.req.json().catch(() => null))?.holders;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > STAFF_BATCH_MAX) {
      return apiError(c, 400, 'bad_request', `一次可產生 1 到 ${STAFF_BATCH_MAX} 組帳號，每組都要填使用人姓名`);
    }
    const holders: string[] = [];
    for (const [i, v] of raw.entries()) {
      const h = parseHolder(v);
      if (typeof h !== 'string') return apiError(c, 400, 'bad_request', `第 ${i + 1} 組：${h.error}`);
      holders.push(h);
    }
    const count = holders.length;
    const now = Date.now();
    if (eventPhase(ev, now) === 'ended') return apiError(c, 400, 'ended', ENDED_MESSAGE);
    const db = c.env.DB;
    const { results } = await db.prepare('SELECT account FROM staff_accounts WHERE event_id = ?').bind(ev.id).all<{ account: string }>();
    const first = maxSerial(ev.code, results.map(x => x.account)) + 1;
    const batch: StaffSecret[] = [];
    const rows: Array<{ id: string; account: string; holder: string; salt: string; hash: string }> = [];
    for (let i = 0; i < count; i++) {
      const s: StaffSecret = { id: newId(), account: staffAccountName(ev.code, first + i), holder: holders[i], pin: genPin() };
      const salt = newSalt();
      batch.push(s);
      rows.push({ id: s.id, account: s.account, holder: s.holder, salt, hash: await hashSecret(c.env.PEPPER, salt, s.pin) });
    }
    // 整批用一個查詢寫入，50 組也不會超過每次請求的查詢數上限
    await db.prepare(
      `INSERT INTO staff_accounts (id, event_id, account, holder, pin_salt, pin_hash, created_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.account'), json_extract(value, '$.holder'), json_extract(value, '$.salt'), json_extract(value, '$.hash'), ?
         FROM json_each(?)`,
    ).bind(ev.id, now, JSON.stringify(rows)).run();
    await audit(c, 'staff_create', `${eventLabel(ev)}：${count} 組`);
    return c.json(batch, 201);
  })

  .post('/staff/:id/reset-pin', requireAuth, requireUser(), async c => {
    const r = await loadStaffFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    if (eventPhase(r.event, Date.now()) === 'ended') return apiError(c, 400, 'ended', ENDED_MESSAGE);
    const pin = genPin();
    const salt = newSalt();
    await c.env.DB.prepare(
      'UPDATE staff_accounts SET pin_salt = ?, pin_hash = ?, session_ver = session_ver + 1, fails = 0, lock_until = 0 WHERE id = ?',
    ).bind(salt, await hashSecret(c.env.PEPPER, salt, pin), r.staff.id).run();
    await audit(c, 'staff_reset_pin', r.staff.account);
    const out: StaffSecret = { id: r.staff.id, account: r.staff.account, holder: r.staff.holder, pin };
    return c.json(out);
  })

  .patch('/staff/:id', requireAuth, requireUser(), async c => {
    const r = await loadStaffFor(c, c.req.param('id'));
    if (!r.ok) return r.response;
    const b = await c.req.json().catch(() => null);
    // 送 holder 是更換使用人；之後的掃描紀錄記新的使用人，已經寫入的紀錄不變
    if (b && typeof b === 'object' && 'holder' in b) {
      const h = parseHolder(b.holder);
      if (typeof h !== 'string') return apiError(c, 400, 'bad_request', h.error);
      const row = await c.env.DB.prepare(`UPDATE staff_accounts SET holder = ? WHERE id = ? RETURNING ${STAFF_COLUMNS}`)
        .bind(h, r.staff.id).first<StaffRow>();
      if (h !== r.staff.holder) await audit(c, 'staff_rename', `${r.staff.account}：${r.staff.holder || '（未填）'} → ${h}`);
      return c.json(toStaffAccount(row!));
    }
    const action = b?.action;
    if (!Object.hasOwn(ACTION_SQL, action)) return apiError(c, 400, 'bad_request', '操作必須是 disable、enable 或 unlock');
    const row = await c.env.DB.prepare(`UPDATE staff_accounts SET ${ACTION_SQL[action as StaffAction]} WHERE id = ? RETURNING ${STAFF_COLUMNS}`)
      .bind(r.staff.id).first<StaffRow>();
    await audit(c, `staff_${action as StaffAction}` as const, r.staff.account);
    return c.json(toStaffAccount(row!));
  });
