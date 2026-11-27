// 員工資料匯入範本（F-EMP-1）：欄位順序為部門、工號、廠別、姓名，工號欄設為文字格式，附一列範例

import { utils, type WorkBook } from 'xlsx';
import { downloadWorkbook } from '../../../excel';

export const TEMPLATE_FILE_NAME = '員工資料匯入範本.xlsx';

/** 預先設成文字格式的工號儲存格列數，之後在這些儲存格輸入的工號才會保留前導零 */
const TEXT_ROWS = 2000;

export function templateWorkbook(): WorkBook {
  const ws = utils.aoa_to_sheet([
    ['部門', '工號', '廠別', '姓名'],
    ['資訊室', '001234', '台中廠', '王小明'],
  ]);
  ws.B2 = { t: 's', v: '001234', z: '@' };
  for (let r = 3; r <= TEXT_ROWS + 1; r++) ws[`B${r}`] = { t: 's', v: '', z: '@' };
  ws['!ref'] = `A1:D${TEXT_ROWS + 1}`;
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, '員工資料');
  return wb;
}

export function downloadTemplate(): void {
  downloadWorkbook(TEMPLATE_FILE_NAME, templateWorkbook());
}
