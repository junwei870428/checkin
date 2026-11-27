import { describe, expect, it } from 'vitest';
import { eventPhase } from '../src/shared/event';

const START = 1_764_000_000_000;
const END = START + 3 * 3600_000;
const ev = (rehearsal: boolean) => ({ startAt: START, endAt: END, rehearsal });

describe('eventPhase', () => {
  it('開始前未開演練是尚未開始，開了演練是演練中', () => {
    expect(eventPhase(ev(false), START - 1)).toBe('not_started');
    expect(eventPhase(ev(true), START - 1)).toBe('rehearsal');
  });

  it('開始時間一到就是進行中，演練模式自動失效', () => {
    expect(eventPhase(ev(false), START)).toBe('live');
    expect(eventPhase(ev(true), START)).toBe('live');
    expect(eventPhase(ev(true), END - 1)).toBe('live');
  });

  it('結束時間一到就是已結束，不論演練模式', () => {
    expect(eventPhase(ev(false), END)).toBe('ended');
    expect(eventPhase(ev(true), END)).toBe('ended');
  });

  it('立即結束後結束時間早於開始時間，仍是已結束', () => {
    expect(eventPhase({ startAt: START, endAt: START - 60_000, rehearsal: true }, START - 1)).toBe('ended');
  });
});
