// SheetJS 匯入解析與下載（F-EMP-2、F-EMP-3、F-EMP-5、F-EVT-3）。只在瀏覽器端解析，後端只收整理好的 JSON。

import { read, utils, writeFileXLSX, type CellObject, type WorkBook, type WorkSheet } from 'xlsx';

export type Field = 'empNo' | 'name' | 'dept' | 'plant';

export const FIELD_ALIASES: Record<Field, string[]> = {
  empNo: ['工號', '員工編號', '員工工號', '員編', '員工代號', 'empno', 'employeeid', 'employeeno'],
  name: ['姓名', '員工姓名', '名字', '中文姓名', 'name'],
  dept: ['部門', '部門名稱', '單位', '所屬部門', 'dept', 'department'],
  plant: ['廠別', '廠區', '廠', '廠名', 'plant', 'site', 'factory'],
};

export const FIELD_LABEL: Record<Field, string> = { empNo: '工號', name: '姓名', dept: '部門', plant: '廠別' };

/** 標題比對前先去除空白、全形空白與括號，再轉小寫 */
export const normHeader = (h: unknown) => String(h ?? '').replace(/[\s　（）()]/g, '').toLowerCase();

/** r 為 Excel 列號（從 1 起算），欄位值一律是去除前後空白的顯示文字 */
export type SheetRow = { r: number } & Partial<Record<Field, string>>;

export type ParsedSheet =
  | { ok: true; sheet: string; rows: SheetRow[]; numericEmpNo: number }
  | { ok: false; error: string; headers: string[] };

interface RawRow {
  r: number;
  cells: string[];
  types: Array<CellObject['t'] | null>;
}

function sheetRows(ws: WorkSheet | undefined): RawRow[] {
  if (!ws?.['!ref']) return [];
  const range = utils.decode_range(ws['!ref']);
  const out: RawRow[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    const types: RawRow['types'] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[utils.encode_cell({ r, c })] as CellObject | undefined;
      // 取顯示文字 cell.w，前導零才不會因為儲存格是數字而遺失
      cells.push(cell ? String(cell.w ?? cell.v ?? '').trim() : '');
      types.push(cell ? cell.t : null);
    }
    out.push({ r: r + 1, cells, types });
  }
  return out;
}

/**
 * 讀第一個工作表，第一個非空白列當標題，依別名找欄位（不看欄位位置，容許多餘欄位）。
 * numericEmpNo 是工號欄為數字型態的儲存格數，大於 0 時要提示前導零可能已遺失。
 */
export async function parseSheet(file: File, required: Field[]): Promise<ParsedSheet> {
  const wb = read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.SheetNames[0];
  const rows = sheetRows(wb.Sheets[sheet]).filter(x => x.cells.some(v => v !== ''));
  if (!rows.length) return { ok: false, error: '檔案裡沒有資料', headers: [] };

  const [header, ...body] = rows;
  const col: Partial<Record<Field, number>> = {};
  header.cells.forEach((h, i) => {
    const n = normHeader(h);
    for (const f of Object.keys(FIELD_ALIASES) as Field[]) {
      if (col[f] === undefined && FIELD_ALIASES[f].some(a => normHeader(a) === n)) col[f] = i;
    }
  });
  const missing = required.filter(f => col[f] === undefined);
  if (missing.length) {
    return { ok: false, error: `找不到這些欄位：${missing.map(f => FIELD_LABEL[f]).join('、')}`, headers: header.cells.filter(Boolean) };
  }

  let numericEmpNo = 0;
  const found = Object.entries(col) as Array<[Field, number]>;
  const data = body.map(x => {
    if (col.empNo !== undefined && x.types[col.empNo] === 'n') numericEmpNo++;
    const o: SheetRow = { r: x.r };
    for (const [f, i] of found) o[f] = x.cells[i];
    return o;
  });
  return { ok: true, sheet, rows: data, numericEmpNo };
}

/** 讓瀏覽器下載活頁簿，filename 需以 .xlsx 結尾 */
export function downloadWorkbook(filename: string, wb: WorkBook): void {
  writeFileXLSX(wb, filename, { compression: true });
}
