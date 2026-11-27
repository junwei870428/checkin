import { describe, expect, it } from 'vitest';
import { read, write } from 'xlsx';
import { parseSheet } from '../src/web/excel';
import { templateWorkbook } from '../src/web/pages/admin/employees/template';

const templateBytes = () => write(templateWorkbook(), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

describe('員工資料匯入範本', () => {
  it('標題依序為部門、工號、廠別、姓名，範例列可直接匯入且保留前導零', async () => {
    const wb = read(templateBytes(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(['A1', 'B1', 'C1', 'D1'].map(a => ws[a].v)).toEqual(['部門', '工號', '廠別', '姓名']);

    const parsed = await parseSheet(new File([templateBytes()], '範本.xlsx'), ['empNo', 'name', 'dept', 'plant']);
    expect(parsed).toEqual({
      ok: true,
      sheet: '員工資料',
      numericEmpNo: 0,
      rows: [{ r: 2, empNo: '001234', name: '王小明', dept: '資訊室', plant: '台中廠' }],
    });
  });

  it('工號欄設為文字格式，範例列以下的空白儲存格也是', () => {
    const ws = read(templateBytes(), { type: 'array', cellNF: true }).Sheets['員工資料'];
    expect(ws.B2.z).toBe('@');
    expect(ws.B3.z).toBe('@');
    expect(ws.B2001.z).toBe('@');
  });
});
