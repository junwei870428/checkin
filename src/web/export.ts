// 匯出 Excel（F-RPT-3）：「統計」工作表加上每個關卡一張名單，只含正式紀錄，在瀏覽器端用 SheetJS 產生

import { utils, type WorkBook } from 'xlsx';
import type { EventRoster, RosterPerson } from '../shared/reports';
import { downloadWorkbook } from './excel';
import { fmtDT } from './format';

/** Excel 工作表名稱：去掉 []:*?/\ 與頭尾單引號、最多 31 字，不分大小寫不可重複 */
export function sheetName(name: string, used: Set<string>): string {
  const base = [...(name.replace(/[[\]:*?/\\]/g, '').replace(/^'+|'+$/g, '').trim() || '工作表')];
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '' : `(${i})`;
    const n = base.slice(0, 31 - suffix.length).join('') + suffix;
    if (!used.has(n.toLowerCase())) {
      used.add(n.toLowerCase());
      return n;
    }
  }
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '');

/** 廠別、部門的應到與各關卡通過數，含廠別小計與合計，數字與即時概況的分組表相同 */
function statsRows(r: EventRoster): Array<Array<string | number>> {
  const counts = (people: RosterPerson[]) => [
    people.length,
    ...r.stations.flatMap(s => {
      const n = people.filter(p => p.passes[s.id]).length;
      return [n, pct(n, people.length)];
    }),
  ];
  // 名單已依廠別、部門排序，Map 保留這個順序
  const plants = new Map<string, Map<string, RosterPerson[]>>();
  for (const p of r.people) {
    if (!plants.has(p.plant)) plants.set(p.plant, new Map());
    const depts = plants.get(p.plant)!;
    if (!depts.has(p.dept)) depts.set(p.dept, []);
    depts.get(p.dept)!.push(p);
  }
  const rows: Array<Array<string | number>> = [['廠別', '部門', '應到', ...r.stations.flatMap(s => [s.name, `${s.name}比例`])]];
  for (const [plant, depts] of plants) {
    for (const [dept, people] of depts) rows.push([plant, dept, ...counts(people)]);
    rows.push([`${plant} 小計`, '', ...counts([...depts.values()].flat())]);
  }
  rows.push(['合計', '', ...counts(r.people)]);
  return rows;
}

export function buildRosterWorkbook(r: EventRoster): WorkBook {
  const wb = utils.book_new();
  const used = new Set<string>();
  const stats = utils.aoa_to_sheet(statsRows(r));
  stats['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 8 }, ...r.stations.flatMap(() => [{ wch: 10 }, { wch: 8 }])];
  utils.book_append_sheet(wb, stats, sheetName('統計', used));
  for (const s of r.stations) {
    const rows = r.people.map(p => {
      const x = p.passes[s.id];
      return [p.plant, p.dept, p.empNo, p.name, x ? '已通過' : '未通過', x ? fmtDT(x.at) : '', x?.by ?? '', x?.byHolder ?? '', x?.manual ? '是' : ''];
    });
    const ws = utils.aoa_to_sheet([['廠別', '部門', '工號', '姓名', '狀態', '時間', '處理帳號', '處理人員', '手動處理'], ...rows]);
    ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }];
    utils.book_append_sheet(wb, ws, sheetName(s.name, used));
  }
  return wb;
}

/** 下載「活動名稱_報到紀錄_YYYYMMDD.xlsx」 */
export function downloadRoster(eventName: string, r: EventRoster): void {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  downloadWorkbook(`${eventName}_報到紀錄_${ymd}.xlsx`, buildRosterWorkbook(r));
}
