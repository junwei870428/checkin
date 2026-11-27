import { describe, expect, it } from 'vitest';
import { utils, write, type WorkSheet } from 'xlsx';
import { parseSheet } from '../src/web/excel';

function xlsxFile(ws: WorkSheet): File {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, '員工資料');
  return new File([write(wb, { bookType: 'xlsx', type: 'array' })], 'employees.xlsx');
}

describe('parseSheet', () => {
  it('依標題別名找欄位，不看欄位順序，忽略多餘欄位與空白列', async () => {
    const ws = utils.aoa_to_sheet([
      ['備註', ' 廠區 ', '姓　名', '所屬部門', '員工編號'],
      ['新人', '台中廠', '王小明', '資訊室', ' 001023 '],
      [],
      ['', '高雄廠', '李小華', '人資室', 'A0001'],
    ]);
    const res = await parseSheet(xlsxFile(ws), ['empNo', 'name', 'dept', 'plant']);
    expect(res).toEqual({
      ok: true,
      sheet: '員工資料',
      numericEmpNo: 0,
      rows: [
        { r: 2, empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠' },
        { r: 4, empNo: 'A0001', name: '李小華', dept: '人資室', plant: '高雄廠' },
      ],
    });
  });

  it('工號取顯示文字，格式化的數字保留前導零，並計算數字型態的工號數', async () => {
    const ws = utils.aoa_to_sheet([['EmpNo'], [1023], ['001024']]);
    ws.A2 = { t: 'n', v: 1023, z: '000000' };
    const res = await parseSheet(xlsxFile(ws), ['empNo']);
    expect(res).toEqual({ ok: true, sheet: '員工資料', numericEmpNo: 1, rows: [{ r: 2, empNo: '001023' }, { r: 3, empNo: '001024' }] });
  });

  it('缺少必要欄位時回傳錯誤與檔案中的標題', async () => {
    const ws = utils.aoa_to_sheet([['姓名', '部門', ''], ['王小明', '資訊室', '']]);
    expect(await parseSheet(xlsxFile(ws), ['empNo', 'name', 'plant'])).toEqual({
      ok: false,
      error: '找不到這些欄位：工號、廠別',
      headers: ['姓名', '部門'],
    });
  });

  it('空白工作表回傳錯誤', async () => {
    expect(await parseSheet(xlsxFile(utils.aoa_to_sheet([])), ['empNo'])).toEqual({ ok: false, error: '檔案裡沒有資料', headers: [] });
  });
});
