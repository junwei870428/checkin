import { describe, expect, it } from 'vitest';
import { LOCK_MS, MAX_FAILS, nextFailState, signSession, verifySession, type SessionPayload } from '../src/worker/auth';

const SECRET = 'test-secret';
const NOW = 1_764_000_000_000;
const payload: SessionPayload = { t: 's', id: 'staff-1', ver: 2, exp: NOW + 60_000 };

describe('signSession / verifySession', () => {
  it('簽章後可驗證並取回內容', async () => {
    const token = await signSession(SECRET, payload);
    expect(await verifySession(SECRET, token, NOW)).toEqual(payload);
  });

  it('過期的 Cookie 驗證失敗', async () => {
    const token = await signSession(SECRET, payload);
    expect(await verifySession(SECRET, token, payload.exp)).toBeNull();
  });

  it('不同 secret 簽的 Cookie 驗證失敗', async () => {
    const token = await signSession('other-secret', payload);
    expect(await verifySession(SECRET, token, NOW)).toBeNull();
  });

  it('竄改內容後驗證失敗', async () => {
    const token = await signSession(SECRET, payload);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, id: 'staff-2' })).toString('base64url');
    expect(await verifySession(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
  });

  it('格式錯誤或沒有 Cookie 回傳 null', async () => {
    expect(await verifySession(SECRET, undefined, NOW)).toBeNull();
    expect(await verifySession(SECRET, 'abc', NOW)).toBeNull();
    expect(await verifySession(SECRET, 'a.b.c', NOW)).toBeNull();
  });
});

describe('nextFailState', () => {
  it('前 4 次輸錯只累加次數', () => {
    let fails = 0;
    for (let i = 1; i < MAX_FAILS; i++) {
      const s = nextFailState(fails, NOW);
      expect(s).toEqual({ fails: i, lockUntil: 0, locked: false });
      fails = s.fails;
    }
  });

  it('第 5 次輸錯鎖定 15 分鐘並把次數歸零', () => {
    expect(nextFailState(MAX_FAILS - 1, NOW)).toEqual({ fails: 0, lockUntil: NOW + LOCK_MS, locked: true });
    expect(LOCK_MS).toBe(15 * 60_000);
  });
});
