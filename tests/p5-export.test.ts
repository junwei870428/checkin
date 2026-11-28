import { describe, expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import type { EventRoster } from '../src/shared/reports';
import { buildRosterWorkbook, sheetName } from '../src/web/export';
import { fmtDT } from '../src/web/format';

const AT = new Date(2026, 11, 24, 18, 30).getTime();

const roster: EventRoster = {
  stations: [
    { id: 'a', name: '入場報到', kind: 'checkin' },
    { id: 'b', name: '領取禮品', kind: 'gift' },
  ],
  people: [
    { empNo: '003', name: '陳大同', plant: '台中廠', dept: '人資室', passes: {} },
    { empNo: '001023', name: '王小明', plant: '台中廠', dept: '資訊室', passes: { a: { at: AT, by: 'XMAS-02', byHolder: '李小華', manual: true }, b: { at: AT, by: 'XMAS-01', byHolder: '王大明', manual: false } } },
    { empNo: '002', name: '李小華', plant: '台中廠', dept: '資訊室', passes: { a: { at: AT, by: 'XMAS-01', byHolder: '', manual: false } } },
    { empNo: '004', name: '林美玲', plant: '高雄廠', dept: '資訊室', passes: { a: { at: AT, by: 'XMAS-01', byHolder: '', manual: false } } },
  ],
};

/** 寫成 xlsx 再讀回來，檢查的是使用者打開檔案會看到的內容 */
function roundTrip(r: EventRoster) {
  return read(write(buildRosterWorkbook(r), { bookType: 'xlsx', type: 'array' }), { type: 'array' });
}

describe('buildRosterWorkbook', () => {
  it('統計工作表依廠別、部門列出應到與各關卡通過數，含廠別小計與合計', () => {
    const wb = roundTrip(roster);
    expect(wb.SheetNames).toEqual(['統計', '入場報到', '領取禮品']);
    expect(utils.sheet_to_json(wb.Sheets['統計'], { header: 1 })).toEqual([
      ['廠別', '部門', '應到', '入場報到', '入場報到比例', '領取禮品', '領取禮品比例'],
      ['台中廠', '人資室', 1, 0, '0%', 0, '0%'],
      ['台中廠', '資訊室', 2, 2, '100%', 1, '50%'],
      ['台中廠 小計', '', 3, 2, '67%', 1, '33%'],
      ['高雄廠', '資訊室', 1, 1, '100%', 0, '0%'],
      ['高雄廠 小計', '', 1, 1, '100%', 0, '0%'],
      ['合計', '', 4, 3, '75%', 1, '25%'],
    ]);
  });

  it('每個關卡一張名單，工號維持文字（保留前導零）', () => {
    const ws = roundTrip(roster).Sheets['領取禮品'];
    expect(utils.sheet_to_json(ws, { header: 1, defval: '' })).toEqual([
      ['廠別', '部門', '工號', '姓名', '狀態', '時間', '處理帳號', '處理人員', '手動處理'],
      ['台中廠', '人資室', '003', '陳大同', '未通過', '', '', '', ''],
      ['台中廠', '資訊室', '001023', '王小明', '已通過', fmtDT(AT), 'XMAS-01', '王大明', ''],
      ['台中廠', '資訊室', '002', '李小華', '未通過', '', '', '', ''],
      ['高雄廠', '資訊室', '004', '林美玲', '未通過', '', '', '', ''],
    ]);
    expect(ws.C3).toMatchObject({ t: 's', v: '001023' });
    expect(utils.sheet_to_json(roundTrip(roster).Sheets['入場報到'], { header: 1 })[2]).toEqual(
      ['台中廠', '資訊室', '001023', '王小明', '已通過', fmtDT(AT), 'XMAS-02', '李小華', '是'],
    );
  });

  it('範圍內沒有人時仍產生統計與各關卡的標題列', () => {
    const wb = roundTrip({ ...roster, people: [] });
    expect(utils.sheet_to_json(wb.Sheets['統計'], { header: 1 })).toEqual([
      ['廠別', '部門', '應到', '入場報到', '入場報到比例', '領取禮品', '領取禮品比例'],
      ['合計', '', 0, 0, '', 0, ''],
    ]);
    expect(utils.sheet_to_json(wb.Sheets['入場報到'], { header: 1 })).toHaveLength(1);
  });
});

describe('sheetName', () => {
  it('去掉 Excel 不允許的字元、限 31 字，重複時加編號且不分大小寫', () => {
    const used = new Set<string>();
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三';
    expect(sheetName('統計', used)).toBe('統計');
    expect(sheetName('統計', used)).toBe('統計(2)');
    expect(sheetName("'領取/禮品:[VIP]*?'", used)).toBe('領取禮品VIP');
    expect(sheetName('Gift', used)).toBe('Gift');
    expect(sheetName('gift', used)).toBe('gift(2)');
    expect(sheetName(long, used)).toBe(long.slice(0, 31));
    expect(sheetName(long, used)).toBe(`${long.slice(0, 28)}(2)`);
    expect(sheetName('[]', used)).toBe('工作表');
  });

  it('重名的關卡各自有工作表，檔案可以正常寫出', () => {
    const r: EventRoster = { ...roster, stations: [...roster.stations, { id: 'c', name: '統計', kind: 'gift' }, { id: 'd', name: '入場報到', kind: 'gift' }] };
    expect(roundTrip(r).SheetNames).toEqual(['統計', '入場報到', '領取禮品', '統計(2)', '入場報到(2)']);
  });
});
