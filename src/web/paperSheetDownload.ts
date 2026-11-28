// 下載紙本簽到表；ExcelJS 約 256 KB（gzip），按下按鈕時才載入

import type { EventRoster } from '../shared/reports';
import { buildPaperSheet, pad, type PaperSheetEvent } from './paperSheet';

/** 下載「活動名稱_紙本簽到表_YYYYMMDD.xlsx」 */
export async function downloadPaperSheet(ev: PaperSheetEvent, r: EventRoster): Promise<void> {
  const mod = await import('exceljs');
  const Excel = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new Excel.Workbook();
  const now = Date.now();
  buildPaperSheet(wb, ev, r, now);
  const buf = await wb.xlsx.writeBuffer();
  const d = new Date(now);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `${ev.name}_紙本簽到表_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
