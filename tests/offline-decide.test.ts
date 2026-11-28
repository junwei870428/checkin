import { describe, expect, it } from 'vitest';
import type { CheckinStation } from '../src/shared/checkin';
import { decideOffline, type OfflineData } from '../src/web/components/checkin/offlineDecide';

const NOW = 1_800_000_000_000;
const HOUR = 3600_000;
const WANG = { empNo: '001023', name: '王小明', dept: '資訊室', plant: '台中廠' };
const CHECKIN: CheckinStation = { id: 'ck', name: '入場報到', kind: 'checkin', requireCheckin: false, passedCount: 0 };
const GIFT: CheckinStation = { id: 'gf', name: '領取禮品', kind: 'gift', requireCheckin: true, passedCount: 0 };
const LIVE = { startAt: NOW - HOUR, endAt: NOW + HOUR, rehearsal: false };

const data = (passed: Record<string, string[]> = {}, rehearsal = false): OfflineData => ({
  people: new Map([[WANG.empNo, WANG]]),
  passed: new Map(Object.entries(passed).map(([k, v]) => [k, new Set(v)])),
  rehearsal,
});
const decide = (station: CheckinStation, code: string, d: OfflineData, event = LIVE, now = NOW) =>
  decideOffline(event, station, [CHECKIN, GIFT], code, d, now);

describe('decideOffline', () => {
  it('名單內、還沒通過的人先記錄待上傳', () => {
    expect(decide(CHECKIN, '001023', data())).toEqual({ kind: 'queue', employee: WANG, rehearsal: false });
  });

  it('本機紀錄已通過的回傳重複', () => {
    expect(decide(CHECKIN, '001023', data({ ck: ['001023'] }))).toMatchObject({ kind: 'dup', employee: WANG });
  });

  it('名單沒有這個工號時回傳不在名單', () => {
    expect(decide(CHECKIN, '999', data())).toMatchObject({ kind: 'error', reason: 'not_in_list', employee: null });
  });

  it('領取禮品需要先入場報到', () => {
    expect(decide(GIFT, '001023', data())).toMatchObject({ kind: 'error', reason: 'need_checkin' });
    expect(decide(GIFT, '001023', data({ ck: ['001023'] }))).toMatchObject({ kind: 'queue' });
  });

  it('活動結束或尚未開始時不記錄', () => {
    expect(decide(CHECKIN, '001023', data(), { ...LIVE, endAt: NOW })).toMatchObject({ kind: 'error', reason: 'ended' });
    expect(decide(CHECKIN, '001023', data(), { ...LIVE, startAt: NOW + 1 })).toMatchObject({ kind: 'error', reason: 'not_started' });
  });

  it('演練期間記成演練；存下的若是正式紀錄則不拿來比對', () => {
    const ev = { startAt: NOW + HOUR, endAt: NOW + 2 * HOUR, rehearsal: true };
    expect(decide(CHECKIN, '001023', data({ ck: ['001023'] }, true), ev)).toMatchObject({ kind: 'dup', rehearsal: true });
    expect(decide(CHECKIN, '001023', data({ ck: ['001023'] }, false), ev)).toMatchObject({ kind: 'queue', rehearsal: true });
  });
});
