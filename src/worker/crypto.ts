// 雜湊、簽章與隨機值。只使用 Web Crypto，Workers 與 Node 都能執行。

const enc = new TextEncoder();

// 系統產生密碼用的字元，排除 0、O、o、1、l、I、i 等易混淆字元
export const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function b64urlEncode(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/** 固定時間比較，避免時序攻擊 */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function newSalt(): string {
  return toHex(randomBytes(16));
}

/** HMAC-SHA256(PEPPER, salt + 明文)，回傳 hex */
export async function hashSecret(pepper: string, salt: string, plain: string): Promise<string> {
  return toHex(await hmacSha256(pepper, salt + plain));
}

export async function verifySecret(pepper: string, salt: string, plain: string, hash: string): Promise<boolean> {
  return timingSafeEqual(await hashSecret(pepper, salt, plain), hash);
}

/** 均勻取 [0, max) 的隨機整數（拒絕取樣，避免取餘數造成偏差） */
function randomInt(max: number): number {
  const limit = Math.floor(256 / max) * max;
  for (;;) {
    const [x] = randomBytes(1);
    if (x < limit) return x % max;
  }
}

export function genPassword(len = 10): string {
  let s = '';
  for (let i = 0; i < len; i++) s += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return s;
}

export function genPin(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += String(randomInt(10));
  return s;
}

export function newId(): string {
  return crypto.randomUUID();
}
