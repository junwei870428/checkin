import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface Bindings {
  DB: D1Database;
  SESSION_SECRET: string;
  PEPPER: string;
}

/** 通過登入檢查後放在 context 的身分 */
export type AuthInfo =
  | { t: 'u'; id: string; role: 'admin' | 'organizer' }
  | { t: 's'; id: string; eventId: string };

export interface AppEnv {
  Bindings: Bindings;
  Variables: { auth: AuthInfo };
}

export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}
