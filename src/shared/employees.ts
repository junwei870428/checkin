// 員工資料匯入（F-EMP-1 到 F-EMP-8）與系統帳號（F-ACC-1）API 的前後端共用型別

import type { Role } from './types';

export type EmpField = 'empNo' | 'name' | 'dept' | 'plant';

export const EMP_FIELDS: EmpField[] = ['empNo', 'name', 'dept', 'plant'];

export const EMP_FIELD_LABEL: Record<EmpField, string> = { empNo: '工號', name: '姓名', dept: '部門', plant: '廠別' };

/** 各欄位長度上限；工號與掃描內容上限（64 字元）相同 */
export const EMP_MAX_LEN: Record<EmpField, number> = { empNo: 64, name: 64, dept: 100, plant: 64 };

export const IMPORT_MAX_ROWS = 5000;
export const FILE_NAME_MAX_LEN = 255;

/** 員工列表一頁的筆數，也是畫面最多顯示的筆數 */
export const EMPLOYEE_PAGE_SIZE = 300;

export interface EmployeeData {
  empNo: string;
  name: string;
  dept: string;
  plant: string;
}

/** 匯入的一列，r 為 Excel 列號 */
export interface ImportRow extends EmployeeData {
  r: number;
}

/** POST /api/employees/import/preview 與 /api/employees/import/commit 的 body */
export interface ImportBody {
  fileName: string;
  rows: ImportRow[];
}

export type ImportStatus = 'new' | 'update' | 'same' | 'error';

/** 預覽的一列：update 附上原本的資料，error 附上錯誤說明 */
export type PreviewRow = ImportRow &
  (
    | { status: 'new' | 'same' }
    | { status: 'update'; prev: { name: string; dept: string; plant: string; active: boolean } }
    | { status: 'error'; errors: string[] }
  );

export interface ImportPreview {
  rows: PreviewRow[];
  /** 檔案裡沒有、匯入後會停用的在職員工 */
  deactivate: EmployeeData[];
  counts: Record<ImportStatus | 'deactivate', number>;
  /** 目前在職人數 */
  activeCount: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  deactivated: number;
}

export interface Employee extends EmployeeData {
  active: boolean;
  updatedAt: number;
}

/** GET /api/employees 的回應 */
export interface EmployeeList {
  rows: Employee[];
  /** 符合搜尋條件的總筆數 */
  total: number;
  activeCount: number;
  inactiveCount: number;
}

export interface ImportLog {
  id: string;
  createdAt: number;
  userName: string;
  fileName: string;
  added: number;
  updated: number;
  deactivated: number;
}

export interface UserAccount {
  id: string;
  username: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: number;
}

export interface CreateUserBody {
  username: string;
  name: string;
}

export interface PatchUserBody {
  disabled: boolean;
}

/** 建立帳號與重設密碼的回應，密碼只在這一次回傳 */
export interface PasswordIssued {
  user: UserAccount;
  password: string;
}
