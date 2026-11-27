// 產生第一個系統管理員的 SQL（規劃書第 11 節）
//
// 用法：
//   npm run admin:sql -- <帳號> <名稱> > create-admin.sql
//   本機：npx wrangler d1 execute checkin-db --local --file create-admin.sql
//   正式：npx wrangler d1 execute checkin-db --remote --file create-admin.sql
//   執行後刪除 create-admin.sql
//
// PEPPER 取自環境變數；沒有設定時讀取本機開發用的 .dev.vars。
// 正式環境必須用與 `wrangler secret put PEPPER` 相同的值，例如：
//   PEPPER=<正式值> npm run admin:sql -- admin 系統管理員 > create-admin.sql
//
// 密碼只輸出到 stderr（終端機）一次，SQL 輸出到 stdout。

import { readFileSync } from 'node:fs';
import { genPassword, hashSecret, newId, newSalt } from '../src/worker/crypto.ts';

function readPepper(): string {
  if (process.env.PEPPER) return process.env.PEPPER;
  try {
    const m = readFileSync('.dev.vars', 'utf8').match(/^PEPPER\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  } catch {}
  throw new Error('找不到 PEPPER：請設定環境變數 PEPPER，或在 .dev.vars 中設定');
}

const [username, name] = process.argv.slice(2);
if (!username || !name || !/^[A-Za-z0-9._-]{2,64}$/.test(username)) {
  console.error('用法：npm run admin:sql -- <帳號（英數字）> <名稱>');
  process.exit(1);
}

const pepper = readPepper();
const password = genPassword();
const salt = newSalt();
const hash = await hashSecret(pepper, salt, password);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

process.stdout.write(
  `INSERT INTO users (id, username, name, role, pwd_salt, pwd_hash, created_at) VALUES (${q(newId())}, ${q(username)}, ${q(name)}, 'admin', ${q(salt)}, ${q(hash)}, ${Date.now()});\n`,
);
console.error(`系統管理員帳號：${username}\n密碼（只顯示這一次）：${password}`);
