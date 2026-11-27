// 時間顯示與輸入，一律用瀏覽器本地時間

const pad = (n: number) => String(n).padStart(2, '0');

/** 12/24 18:30 */
export function fmtDT(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 18:30:05 */
export function fmtTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 2026/12/24 */
export function fmtDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 給 <input type="datetime-local"> 的值 */
export function toLocalInput(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(s: string): number {
  return new Date(s).getTime();
}
