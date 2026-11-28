// 紙本簽到表：網路或手機出問題時的備援。依廠別分頁、部門分組，每個關卡一欄勾選框，A4 直式列印。
// 用 ExcelJS 產生（SheetJS 社群版不能寫入框線與字型）。這裡只組活頁簿，不碰 DOM，測試可以直接在 Node 跑；下載在 paperSheetDownload.ts。

import type { Workbook, Worksheet } from 'exceljs';
import type { EventRoster } from '../shared/reports';
import { fmtDT } from './format';

export interface PaperSheetEvent {
  name: string;
  startAt: number;
  endAt: number;
}

const FONT = '微軟正黑體';
const GRID = { style: 'thin', color: { argb: 'FFBFBFBF' } } as const;
const BOX = { top: GRID, left: GRID, bottom: GRID, right: GRID };
const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } }) as const;

/** 表頭佔 5 列：標題、活動資訊、使用說明、空白、欄位名稱 */
const HEADER_ROW = 5;

export const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function buildPaperSheet(wb: Workbook, ev: PaperSheetEvent, r: EventRoster, now: number): Worksheet {
  wb.creator = '活動報到系統';
  const ws = wb.addWorksheet('簽到表', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 },
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
    headerFooter: {
      // 頁尾語法：& 要寫成 &&；字級代碼 &8 後面接數字會被讀成更大的字級（2026 年終尾牙 → &82026），所以先空一格
      oddFooter: `&L&8 ${ev.name.replace(/&/g, '&&')}&C&8 第 &P 頁，共 &N 頁&R&8 列印於 ${fmtDT(now)}`,
    },
  });

  const stationCols = r.stations.map(s => ({ header: s.name, width: Math.max(12, s.name.length * 2.4 + 4) }));
  ws.columns = [
    { header: '序號', width: 6 },
    { header: '工號', width: 13 },
    { header: '姓名', width: 13 },
    ...stationCols,
    { header: '備註', width: 22 },
  ].map(c => ({ width: c.width }));
  const lastCol = 4 + r.stations.length;

  const line = (row: number, text: string, size: number, opts: { bold?: boolean; color?: string; height: number }) => {
    ws.mergeCells(row, 1, row, lastCol);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: FONT, size, bold: opts.bold, color: { argb: opts.color ?? 'FF000000' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(row).height = opts.height;
  };
  line(1, `${ev.name}　紙本簽到表`, 16, { bold: true, height: 30 });
  line(2, `活動時間 ${fmtDT(ev.startAt)} – ${fmtDT(ev.endAt)}　｜　應到 ${r.people.length} 人　｜　列印於 ${fmtDT(now)}`, 10, { color: 'FF595959', height: 18 });
  line(3, '網路或手機無法使用時改用本表：在該關卡欄位打勾並寫上時間。恢復連線後，請在報到頁用「手動」逐筆補登。已打 ✓ 的是列印前已完成的紀錄。', 9, { color: 'FF7F7F7F', height: 28 });
  ws.getRow(4).height = 6;

  const head = ws.getRow(HEADER_ROW);
  head.values = ['序號', '工號', '姓名', ...r.stations.map(s => s.name), '備註'];
  head.height = 22;
  head.eachCell(c => {
    c.font = { name: FONT, size: 10, bold: true };
    c.fill = fill('FFE8E8E8');
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { ...BOX, bottom: { style: 'medium', color: { argb: 'FF7F7F7F' } } };
  });

  let row = HEADER_ROW + 1;
  let seq = 0;
  let plant: string | null = null;
  let dept: string | null = null;
  for (const [i, p] of r.people.entries()) {
    // 每個廠別從新的一頁開始，方便分給不同報到櫃台
    if (plant !== null && p.plant !== plant) ws.getRow(row - 1).addPageBreak();
    if (p.plant !== plant || p.dept !== dept) {
      plant = p.plant;
      dept = p.dept;
      let n = 0;
      for (let k = i; k < r.people.length && r.people[k].plant === plant && r.people[k].dept === dept; k++) n++;
      ws.mergeCells(row, 1, row, lastCol);
      const g = ws.getCell(row, 1);
      g.value = `${plant}　${dept}　${n} 人`;
      g.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF404040' } };
      g.fill = fill('FFF5F5F5');
      g.alignment = { vertical: 'middle', indent: 1 };
      g.border = BOX;
      ws.getRow(row).height = 20;
      row++;
    }
    seq++;
    const cells = [
      seq,
      p.empNo,
      p.name,
      ...r.stations.map(s => (p.passes[s.id] ? `✓ ${hhmm(p.passes[s.id].at)}` : '☐')),
      '',
    ];
    const rr = ws.getRow(row);
    rr.values = cells;
    rr.height = 24;
    rr.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > lastCol) return;
      const station = col >= 4 && col < lastCol;
      const done = station && String(c.value).startsWith('✓');
      c.font = { name: FONT, size: col === 3 ? 12 : station && !done ? 14 : 10, color: { argb: col === 1 ? 'FF7F7F7F' : 'FF000000' } };
      c.alignment = { vertical: 'middle', horizontal: col === 3 || col === lastCol ? 'left' : 'center', indent: col === 3 ? 1 : 0 };
      c.border = BOX;
      // 工號一律當文字，保留前導零
      if (col === 2) c.numFmt = '@';
    });
    row++;
  }
  return ws;
}
