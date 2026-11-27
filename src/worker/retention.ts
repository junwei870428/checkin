// 第 5 階段（P5）：刪除結束滿 10 天的活動（F-RET-2），由 index.ts 的 scheduled() 每小時呼叫

import type { Bindings } from './env';

export async function runRetention(env: Bindings, now: number): Promise<void> {}
