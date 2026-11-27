import { describe, expect, it } from 'vitest';
import {
  b64urlDecode, b64urlEncode, genPassword, genPin, hashSecret, newSalt, PASSWORD_ALPHABET, timingSafeEqual, verifySecret,
} from '../src/worker/crypto';

describe('hashSecret / verifySecret', () => {
  it('相同 pepper、salt、明文得到相同雜湊，可驗證成功', async () => {
    const salt = newSalt();
    const h = await hashSecret('pepper', salt, '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSecret('pepper', salt, '123456')).toBe(h);
    expect(await verifySecret('pepper', salt, '123456', h)).toBe(true);
  });

  it('明文、salt 或 pepper 不同時驗證失敗', async () => {
    const salt = newSalt();
    const h = await hashSecret('pepper', salt, '123456');
    expect(await verifySecret('pepper', salt, '123457', h)).toBe(false);
    expect(await verifySecret('pepper', newSalt(), '123456', h)).toBe(false);
    expect(await verifySecret('other', salt, '123456', h)).toBe(false);
  });

  it('salt 為 16 bytes 隨機 hex', () => {
    expect(newSalt()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSalt()).not.toBe(newSalt());
  });
});

describe('timingSafeEqual', () => {
  it('比對相同與不同字串', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('genPassword / genPin', () => {
  it('密碼為 10 碼，且不含易混淆字元', () => {
    for (let i = 0; i < 200; i++) {
      const p = genPassword();
      expect(p).toHaveLength(10);
      for (const ch of p) expect(PASSWORD_ALPHABET).toContain(ch);
      expect(p).not.toMatch(/[0O1lIio]/);
    }
  });

  it('PIN 為 6 位數字，可有前導零', () => {
    const pins = Array.from({ length: 500 }, genPin);
    for (const p of pins) expect(p).toMatch(/^\d{6}$/);
    expect(new Set(pins).size).toBeGreaterThan(490);
  });
});

describe('base64url', () => {
  it('編碼後可還原', () => {
    const b = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const s = b64urlEncode(b);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(b64urlDecode(s)!)).toEqual(Array.from(b));
  });

  it('非法字元回傳 null', () => {
    expect(b64urlDecode('ab+c')).toBeNull();
  });
});
