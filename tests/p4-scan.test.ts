import { describe, expect, it } from 'vitest';
import { decideScan, type ActiveScan, type ScanSnapshot } from '../src/worker/scan';

const NOW = 1_800_000_000_000;
const HOUR = 3600_000;
const EMP = { empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠' };

function snap(o: Partial<Omit<ScanSnapshot, 'event'>> & { event?: Partial<ScanSnapshot['event']> } = {}): ScanSnapshot {
  return {
    station: { id: 'ck', kind: 'checkin', requireCheckin: false },
    employee: { ...EMP, active: 1 },
    isMember: false,
    activeScans: [],
    ...o,
    event: { startAt: NOW - HOUR, endAt: NOW + HOUR, rehearsal: false, scope: { type: 'all' }, ...o.event },
  };
}

const GIFT = { id: 'gift', kind: 'gift', requireCheckin: true } as const;
const PRE_START = { startAt: NOW + HOUR, endAt: NOW + 2 * HOUR };

function scan(o: Partial<ActiveScan> = {}): ActiveScan {
  return { stationId: 'ck', stationKind: 'checkin', rehearsal: false, scannedAt: NOW - 60_000, byAccount: 'XMAS-03', ...o };
}

describe('decideScan', () => {
  it('進行中且全部通過時寫入正式紀錄', () => {
    expect(decideScan(snap(), NOW)).toEqual({ kind: 'insert', rehearsal: false, employee: EMP });
  });

  it('活動已結束時拒絕，比查無此工號優先', () => {
    expect(decideScan(snap({ employee: null }), NOW + HOUR)).toEqual({ kind: 'reject', reason: 'ended', rehearsal: false });
  });

  it('結束時間優先於演練模式', () => {
    const s = snap({ event: { startAt: NOW + HOUR, endAt: NOW, rehearsal: true } });
    expect(decideScan(s, NOW)).toEqual({ kind: 'reject', reason: 'ended', rehearsal: false });
  });

  it('尚未開始且沒開演練模式時拒絕，比查無此工號優先', () => {
    const s = snap({ event: PRE_START, employee: null });
    expect(decideScan(s, NOW)).toEqual({ kind: 'reject', reason: 'not_started', rehearsal: false });
  });

  it('尚未開始但開了演練模式時寫入演練紀錄', () => {
    const s = snap({ event: { ...PRE_START, rehearsal: true } });
    expect(decideScan(s, NOW)).toEqual({ kind: 'insert', rehearsal: true, employee: EMP });
  });

  it('開始後演練模式失效，寫入正式紀錄', () => {
    expect(decideScan(snap({ event: { rehearsal: true } }), NOW)).toEqual({ kind: 'insert', rehearsal: false, employee: EMP });
  });

  it('查無此工號', () => {
    expect(decideScan(snap({ employee: null }), NOW)).toEqual({ kind: 'reject', reason: 'not_found', rehearsal: false });
  });

  it('演練中被拒也標示為演練', () => {
    const s = snap({ event: { ...PRE_START, rehearsal: true }, employee: null });
    expect(decideScan(s, NOW)).toEqual({ kind: 'reject', reason: 'not_found', rehearsal: true });
  });

  it('停用比不在範圍優先', () => {
    const s = snap({ employee: { ...EMP, active: 0 }, event: { scope: { type: 'plants', plants: ['高雄廠'] } } });
    expect(decideScan(s, NOW)).toEqual({ kind: 'reject', reason: 'inactive', rehearsal: false, employee: EMP });
  });

  it.each([
    ['plants', { type: 'plants', plants: ['高雄廠'] }, false],
    ['depts 同名部門不同廠', { type: 'depts', depts: [['高雄廠', '資訊室']] }, false],
    ['list 不在名單', { type: 'list' }, false],
  ] as const)('不在參加範圍：%s', (_, scope, isMember) => {
    const s = snap({ event: { scope: scope as ScanSnapshot['event']['scope'] }, isMember });
    expect(decideScan(s, NOW)).toEqual({ kind: 'reject', reason: 'out_of_scope', rehearsal: false, employee: EMP });
  });

  it('list 範圍內的名單成員可通過', () => {
    expect(decideScan(snap({ event: { scope: { type: 'list' } }, isMember: true }), NOW).kind).toBe('insert');
  });

  it('不在範圍比重複優先', () => {
    const s = snap({ event: { scope: { type: 'list' } }, activeScans: [scan()] });
    expect(decideScan(s, NOW)).toMatchObject({ kind: 'reject', reason: 'out_of_scope' });
  });

  it('同一關卡已有紀錄時回傳第一次通過的時間與帳號', () => {
    const s = snap({ activeScans: [scan({ scannedAt: 123, byAccount: 'XMAS-03' })] });
    expect(decideScan(s, NOW)).toEqual({ kind: 'dup', rehearsal: false, employee: EMP, previous: { scannedAt: 123, byAccount: 'XMAS-03' } });
  });

  it('其他關卡的紀錄不算重複', () => {
    const s = snap({ activeScans: [scan({ stationId: 'gift', stationKind: 'gift' })] });
    expect(decideScan(s, NOW).kind).toBe('insert');
  });

  it('重複比尚未完成入場報到優先', () => {
    const s = snap({ station: GIFT, activeScans: [scan({ stationId: 'gift', stationKind: 'gift' })] });
    expect(decideScan(s, NOW).kind).toBe('dup');
  });

  it('領取關卡需先報到而沒有入場紀錄時拒絕', () => {
    expect(decideScan(snap({ station: GIFT }), NOW)).toEqual({ kind: 'reject', reason: 'need_checkin', rehearsal: false, employee: EMP });
  });

  it('已完成入場報到可領取', () => {
    expect(decideScan(snap({ station: GIFT, activeScans: [scan()] }), NOW).kind).toBe('insert');
  });

  it('領取關卡沒設定需先報到時直接通過', () => {
    expect(decideScan(snap({ station: { ...GIFT, requireCheckin: false } }), NOW).kind).toBe('insert');
  });

  it('入場報到關卡不看需先報到設定', () => {
    expect(decideScan(snap({ station: { id: 'ck', kind: 'checkin', requireCheckin: true } }), NOW).kind).toBe('insert');
  });

  describe('正式與演練紀錄互不比對', () => {
    const rehearsalEvent = { ...PRE_START, rehearsal: true };

    it('演練中，正式紀錄不算重複', () => {
      expect(decideScan(snap({ event: rehearsalEvent, activeScans: [scan()] }), NOW)).toMatchObject({ kind: 'insert', rehearsal: true });
    });

    it('演練中，演練紀錄算重複', () => {
      const s = snap({ event: rehearsalEvent, activeScans: [scan({ rehearsal: true })] });
      expect(decideScan(s, NOW)).toMatchObject({ kind: 'dup', rehearsal: true });
    });

    it('正式時，演練紀錄不算重複', () => {
      expect(decideScan(snap({ activeScans: [scan({ rehearsal: true })] }), NOW)).toMatchObject({ kind: 'insert', rehearsal: false });
    });

    it('正式時，只有演練入場紀錄不能領取', () => {
      const s = snap({ station: GIFT, activeScans: [scan({ rehearsal: true })] });
      expect(decideScan(s, NOW)).toMatchObject({ kind: 'reject', reason: 'need_checkin' });
    });

    it('演練中，演練入場紀錄可領取演練', () => {
      const s = snap({ event: rehearsalEvent, station: GIFT, activeScans: [scan({ rehearsal: true })] });
      expect(decideScan(s, NOW)).toMatchObject({ kind: 'insert', rehearsal: true });
    });

    it('演練中，只有正式入場紀錄不能領取', () => {
      const s = snap({ event: rehearsalEvent, station: GIFT, activeScans: [scan()] });
      expect(decideScan(s, NOW)).toMatchObject({ kind: 'reject', reason: 'need_checkin', rehearsal: true });
    });
  });
});
