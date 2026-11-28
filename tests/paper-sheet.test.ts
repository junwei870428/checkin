import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { EventRoster } from '../src/shared/reports';
import { buildPaperSheet } from '../src/web/paperSheet';

const AT = new Date(2026, 11, 24, 18, 32).getTime();
const roster: EventRoster = {
  stations: [
    { id: 'a', name: '入場報到', kind: 'checkin' },
    { id: 'b', name: '領取禮品', kind: 'gift' },
  ],
  people: [
    { empNo: '003', name: '陳大同', plant: '台中廠', dept: '人資室', passes: {} },
    { empNo: '001023', name: '王小明', plant: '台中廠', dept: '資訊室', passes: { a: { at: AT, by: 'XMAS-01', byHolder: '', manual: false } } },
    { empNo: '002', name: '李小華', plant: '台中廠', dept: '資訊室', passes: {} },
    { empNo: '004', name: '林美玲', plant: '高雄廠', dept: '資訊室', passes: {} },
  ],
};
const ev = { name: 'R&D 尾牙', startAt: new Date(2026, 11, 24, 18, 0).getTime(), endAt: new Date(2026, 11, 24, 22, 0).getTime() };

/** 寫成 xlsx 再讀回來，檢查的是使用者打開檔案會看到的內容 */
async function roundTrip() {
  const wb = new Workbook();
  buildPaperSheet(wb, ev, roster, AT);
  const back = new Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  return back.getWorksheet('簽到表')!;
}

const text = (ws: Awaited<ReturnType<typeof roundTrip>>, row: number) =>
  Array.from({ length: 6 }, (_, i) => ws.getCell(row, i + 1).value ?? '');

describe('buildPaperSheet', () => {
  it('表頭有活動名稱、時間與應到人數', async () => {
    const ws = await roundTrip();
    expect(ws.getCell('A1').value).toBe('R&D 尾牙　紙本簽到表');
    expect(ws.getCell('A2').value).toBe('活動時間 12/24 18:00 – 12/24 22:00　｜　應到 4 人　｜　列印於 12/24 18:32');
    expect(text(ws, 5)).toEqual(['序號', '工號', '姓名', '入場報到', '領取禮品', '備註']);
  });

  it('依廠別、部門分組，每個關卡一欄勾選框，已完成的顯示 ✓ 與時間', async () => {
    const ws = await roundTrip();
    const rows = Array.from({ length: 7 }, (_, i) => text(ws, 6 + i));
    expect(rows).toEqual([
      ['台中廠　人資室　1 人', '台中廠　人資室　1 人', '台中廠　人資室　1 人', '台中廠　人資室　1 人', '台中廠　人資室　1 人', '台中廠　人資室　1 人'],
      [1, '003', '陳大同', '☐', '☐', ''],
      ['台中廠　資訊室　2 人', '台中廠　資訊室　2 人', '台中廠　資訊室　2 人', '台中廠　資訊室　2 人', '台中廠　資訊室　2 人', '台中廠　資訊室　2 人'],
      [2, '001023', '王小明', '✓ 18:32', '☐', ''],
      [3, '002', '李小華', '☐', '☐', ''],
      ['高雄廠　資訊室　1 人', '高雄廠　資訊室　1 人', '高雄廠　資訊室　1 人', '高雄廠　資訊室　1 人', '高雄廠　資訊室　1 人', '高雄廠　資訊室　1 人'],
      [4, '004', '林美玲', '☐', '☐', ''],
    ]);
  });

  it('A4 直式、每頁重複欄位名稱、換廠別時換頁，頁尾的 & 有跳脫', async () => {
    const wb = new Workbook();
    const ws = buildPaperSheet(wb, ev, roster, AT);
    expect(ws.pageSetup).toMatchObject({ paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:5' });
    // 台中廠最後一列是第 10 列，之後換頁
    expect(ws.getRow(10).getCell(3).value).toBe('李小華');
    expect((ws as unknown as { rowBreaks: Array<{ id: number }> }).rowBreaks.map(b => b.id)).toEqual([10]);
    expect(ws.headerFooter.oddFooter).toContain('&L&8 R&&D 尾牙');
  });

  it('活動名稱以數字開頭時，頁尾字級代碼後面有空格，不會被讀成超大字級', () => {
    const ws = buildPaperSheet(new Workbook(), { ...ev, name: '2026 年終尾牙' }, roster, AT);
    expect(ws.headerFooter.oddFooter).toMatch(/^&L&8 2026 年終尾牙&C/);
  });
});
